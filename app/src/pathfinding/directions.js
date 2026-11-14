/**
 * Turn-by-turn directions for one leg (Pathfinder 1).
 *
 * Mars has no roads or street names, so a direction is a turn, a compass heading, the slope and a
 * distance, worked out from the route line and the terrain heights:
 *
 *   Head north-east, gently uphill, for 180 m
 *   Bear left to head north, downhill (about 8°), for 350 m      caution: Steep for about 30 m (up to 18°)
 *   Arrive at Ridge Sample
 *
 * A route on a 5 m grid zig-zags a little all the time, so small wiggles are not turns: the line is
 * straightened first (wiggles under 12 m are ignored), headings within 25° are joined, and stretches
 * under 40 m are folded into a neighbour. All distances are along the map (not counting up and down).
 *
 *   const steps = directionsFor(grid, leg, { toName: 'Ridge Sample' })
 *   nextDirection(steps, metresAlong).text   →  "In 200 m, bear left to head north, downhill (about 8°), for 350 m"
 *
 * metresAlong is how far along this leg's path the crew is (checkOffRoute() in navigation.js gives it).
 */
import { heightAt, xyToCell } from './walkingTime.js'

export const DIRECTIONS = {
  straightenM: 12, // wiggles in the route smaller than this are not turns
  minTurnDeg: 25, // changes of heading smaller than this are "keep going"
  minStepM: 40, // stretches shorter than this are folded into a neighbour
  sampleM: 5, // the route is checked every 5 m (one grid cell)
  nowM: 15, // closer than this to the next turn: "Now: ..."
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/**
 * grid     from makeGrid()
 * leg      a leg from routeLeg() / planRoute() (anything with .path = [{x, y}]), or the path itself
 * toName   name of the stop at the end, for "Arrive at ..."
 * Returns the steps in order. The last one is always the arrival. Each step:
 *   { index, turn, turn_deg, bearing_deg, compass, start_m, end_m, distance_m,
 *     climb_m, descent_m, slope_deg, slope, steep_m, max_slope_deg, at: {x, y}, text, caution }
 *   turn     'start' | 'straight' | 'slight_left' | 'left' | 'sharp_left' | (same for right) | 'arrive'
 *   slope    'flat' | 'rolling' | 'gentle_up' | 'up' | 'steep_up' | 'gentle_down' | 'down' | 'steep_down'
 *   slope_deg  average slope of the stretch, + uphill / - downhill
 *   caution  null, or a short warning when part of the stretch is steeper than the suit's warning limit
 */
export function directionsFor(grid, leg, { toName = 'the stop', settings = {} } = {}) {
  const opt = { ...DIRECTIONS, ...settings }
  const path = Array.isArray(leg) ? leg : leg.path
  if (!path?.length) throw new Error('directionsFor needs a path.')
  const pts = densify(path, opt.sampleM)
  const total = pts.at(-1).d
  const last = pts.at(-1)
  const arrive = {
    index: 0, turn: 'arrive', turn_deg: 0, bearing_deg: null, compass: null,
    start_m: Math.round(total), end_m: Math.round(total), distance_m: 0,
    climb_m: 0, descent_m: 0, slope_deg: 0, slope: 'flat', steep_m: 0, max_slope_deg: 0,
    at: { x: last.x, y: last.y }, text: `Arrive at ${toName}`, caution: null,
  }
  if (total < 1) return [arrive]

  const keys = straighten(pts, opt.straightenM)
  let stretches = keys.slice(1).map((k, n) => stretch(pts, keys[n], k))
  stretches = tidy(pts, stretches, opt)

  const steps = stretches.map((s, n) => describe(grid, pts, s, n ? stretches[n - 1] : null, opt))
  steps.push(arrive)
  steps.forEach((s, n) => (s.index = n))
  return steps
}

/**
 * What to show the crew now. metresAlong = how far along the leg's path they are.
 * Returns { current, next, in_m, text }, e.g. text "In 200 m, bear left to head north, ..."
 */
export function nextDirection(steps, metresAlong, { nowM = DIRECTIONS.nowM } = {}) {
  let n = steps.findIndex((s) => s.start_m > metresAlong)
  if (n < 0) n = steps.length - 1
  const current = steps[Math.max(0, n - 1)]
  const next = steps[n]
  const inM = Math.max(0, next.start_m - metresAlong)
  const what = lowerFirst(next.text)
  const text = inM < nowM ? (next.turn === 'arrive' ? `Arriving at ${next.text.replace(/^Arrive at /, '')}` : `Now: ${what}`) : `In ${distanceText(inM)}, ${what}`
  return { current, next, in_m: Math.round(inM), text }
}

/** "40 m", "350 m", "1.2 km". */
export function distanceText(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`
}

// ---------------------------------------------------------------------------

// Points every `step` metres along the path, with d = metres along (on the map).
function densify(path, step) {
  const out = [{ x: path[0].x, y: path[0].y, d: 0 }]
  let d = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) continue
    const n = Math.max(1, Math.round(len / step))
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n, d: d + (len * k) / n })
    d += len
  }
  return out
}

// Douglas-Peucker: keep only the points where the line really bends by more than `tol` metres.
function straighten(pts, tol) {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let worst = -1
    let worstD = tol
    for (let i = a + 1; i < b; i++) {
      const dd = distanceToSegment(pts[i], pts[a], pts[b])
      if (dd > worstD) {
        worstD = dd
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  const out = []
  keep.forEach((k, i) => k && out.push(i))
  return out
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function bearingOf(a, b) {
  return ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360
}

// Change of heading from b1 to b2, -180..180 (positive = to the right).
function turnDeg(b1, b2) {
  return ((b2 - b1 + 540) % 360) - 180
}

function stretch(pts, i0, i1) {
  return { i0, i1, len: pts[i1].d - pts[i0].d, bearing: bearingOf(pts[i0], pts[i1]) }
}

// Join stretches that point the same way, and fold very short ones into a neighbour.
function tidy(pts, list, opt) {
  const join = (a, b) => stretch(pts, a.i0, b.i1)
  let changed = true
  while (changed && list.length > 1) {
    changed = false
    for (let n = 1; n < list.length; n++) {
      if (Math.abs(turnDeg(list[n - 1].bearing, list[n].bearing)) < opt.minTurnDeg) {
        list.splice(n - 1, 2, join(list[n - 1], list[n]))
        changed = true
        break
      }
    }
    if (changed) continue
    let short = -1
    list.forEach((s, n) => {
      if (s.len < opt.minStepM && (short < 0 || s.len < list[short].len)) short = n
    })
    if (short < 0) break
    const prev = list[short - 1]
    const next = list[short + 1]
    const intoPrev = !next || (prev && Math.abs(turnDeg(prev.bearing, list[short].bearing)) <= Math.abs(turnDeg(list[short].bearing, next.bearing)))
    if (intoPrev) list.splice(short - 1, 2, join(prev, list[short]))
    else list.splice(short, 2, join(list[short], next))
    changed = true
  }
  return list
}

function describe(grid, pts, s, prev, opt) {
  // Up and down along the stretch, on smoothly blended heights.
  let climb = 0
  let descent = 0
  const h0 = heightAt(grid, pts[s.i0].x, pts[s.i0].y)
  let h = h0
  for (let i = s.i0 + 1; i <= s.i1; i++) {
    const hh = heightAt(grid, pts[i].x, pts[i].y)
    if (hh > h) climb += hh - h
    else descent += h - hh
    h = hh
  }
  const slopeDeg = s.len > 0 ? (Math.atan((h - h0) / s.len) * 180) / Math.PI : 0

  // Steep ground on this stretch (same limit as the route warnings).
  let steep = 0
  let maxSlope = 0
  let firstSteep = null // metres into the stretch where the steep ground starts and ends
  let lastSteep = null
  if (grid.slope) {
    const seen = new Set()
    for (let i = s.i0; i <= s.i1; i++) {
      const c = xyToCell(grid, pts[i].x, pts[i].y)
      if (c < 0 || seen.has(c)) continue
      seen.add(c)
      if (grid.slope[c] > grid.suit.slopeWarnDeg) {
        steep += grid.cellSize
        maxSlope = Math.max(maxSlope, grid.slope[c])
        firstSteep ??= pts[i].d - pts[s.i0].d
        lastSteep = pts[i].d - pts[s.i0].d
      }
    }
  }

  const { slope, words } = slopeWords(slopeDeg, climb, descent, s.len)
  const compass = COMPASS[Math.round(s.bearing / 45) % 8]
  const delta = prev ? turnDeg(prev.bearing, s.bearing) : 0
  const turn = prev ? turnOf(delta, opt) : { turn: 'start', words: 'Head' }
  const how = `${compass}, ${words}, for ${distanceText(s.len)}`
  return {
    index: 0,
    turn: turn.turn,
    turn_deg: Math.round(delta),
    bearing_deg: Math.round(s.bearing),
    compass,
    start_m: Math.round(pts[s.i0].d),
    end_m: Math.round(pts[s.i1].d),
    distance_m: Math.round(s.len),
    climb_m: Math.round(climb),
    descent_m: Math.round(descent),
    slope_deg: Math.round(slopeDeg * 10) / 10,
    slope,
    steep_m: steep,
    max_slope_deg: Math.round(maxSlope),
    at: { x: pts[s.i0].x, y: pts[s.i0].y },
    text: prev ? `${turn.words} to head ${how}` : `Head ${how}`,
    caution: steep ? `Steep for about ${steep} m${whereOnStretch(firstSteep, lastSteep, s.len)} (up to ${Math.round(maxSlope)}°): take it slowly` : null,
  }
}

// " near the start" / " half way" / " near the end" / " after about 600 m", or "" for a short stretch
// or steep ground spread along most of it.
function whereOnStretch(first, last, len) {
  if (len < 120 || last - first > len * 0.6) return ''
  const mid = (first + last) / 2
  if (mid < len / 3) return ' near the start'
  if (mid > (2 * len) / 3) return len >= 400 ? ` after about ${distanceText(first)}` : ' near the end'
  return ' half way along'
}

function slopeWords(deg, climb, descent, len) {
  const a = Math.abs(deg)
  const up = deg > 0
  if (a < 2) {
    return climb + descent > Math.max(6, len * 0.06)
      ? { slope: 'rolling', words: 'over small rises and dips' }
      : { slope: 'flat', words: 'on fairly flat ground' }
  }
  if (a < 6) return { slope: up ? 'gentle_up' : 'gentle_down', words: up ? 'gently uphill' : 'gently downhill' }
  if (a < 12) return { slope: up ? 'up' : 'down', words: `${up ? 'uphill' : 'downhill'} (about ${Math.round(a)}°)` }
  return { slope: up ? 'steep_up' : 'steep_down', words: `steeply ${up ? 'uphill' : 'downhill'} (about ${Math.round(a)}°)` }
}

function turnOf(delta, opt) {
  const a = Math.abs(delta)
  const side = delta > 0 ? 'right' : 'left'
  if (a < opt.minTurnDeg) return { turn: 'straight', words: 'Keep going' }
  if (a < 60) return { turn: `slight_${side}`, words: `Bear ${side}` }
  if (a < 120) return { turn: side, words: `Turn ${side}` }
  return { turn: `sharp_${side}`, words: `Turn sharp ${side}` }
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}
