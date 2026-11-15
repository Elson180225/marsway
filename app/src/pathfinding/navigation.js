/**
 * Live navigation helpers (Pathfinder 1): off-route check, reroute and ETAs.
 * Pure maths, no DOM, so the Walk screen can call them and Node can test them.
 *
 *   checkOffRoute(path, crew)                       on the line, drifting, or off route? how far along?
 *   rerouteFrom(grid, crew, stopsLeft, home, opts)  new route from where the crew really is,
 *                                                    dropping stops if the suit time no longer fits
 *   etaFor(plan, { nowMs, legIndex, progress, scienceLeft, paceFactor })
 *                                                    arrival time at every stop left and at home
 *   paceFactor({ plannedMinutes, actualMinutes, weather })
 *                                                    how much slower than planned the crew is walking
 *
 * Positions are local metres { x, y }. Distances along a path are on the map (like the Walk screen's
 * pointAlong()), so progress = along_m / path length matches its `progress`.
 *
 * Mars has no GPS: the crew position would come from the suit's own navigation (step counting and
 * motion sensors, corrected by cameras and habitat beacons). In the demo it is simulated.
 */
import { routeLeg, reachableFrom, snapToReachable } from './astar.js'
import { xyToCell, cellToXY } from './walkingTime.js'

export const OFF_ROUTE = {
  driftM: 15, // further than this from the line: "drifting"
  offM: 30, // further than this: off route, offer a new route
  windowM: 150, // when the last position is known, look for the line near it (paths can double back)
}

/** Length of a path on the map, in metres. */
export function pathLength2D(path) {
  let total = 0
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  return total
}

/**
 * Nearest point on the path to `point`.
 * nearAlongM: where along the path the crew was last time (optional). Then only the part of the
 * path within windowM of it is searched, so a path that comes back past itself doesn't jump.
 * Returns { distance_m, along_m, point: {x, y}, segment }.
 */
export function projectOnPath(path, point, { nearAlongM = null, windowM = OFF_ROUTE.windowM } = {}) {
  if (path.length === 1) return { distance_m: Math.hypot(point.x - path[0].x, point.y - path[0].y), along_m: 0, point: { ...path[0] }, segment: 0 }
  let best = null
  let along = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const t = len ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (len * len))) : 0
    const q = { x: a.x + t * dx, y: a.y + t * dy }
    const d = Math.hypot(point.x - q.x, point.y - q.y)
    const at = along + t * len
    const inWindow = nearAlongM == null || Math.abs(at - nearAlongM) <= windowM
    if (inWindow && (!best || d < best.distance_m)) best = { distance_m: d, along_m: at, point: q, segment: i - 1 }
    along += len
  }
  return best ?? projectOnPath(path, point)
}

/**
 * Is the crew on the planned line?
 * Returns { status: 'on' | 'drifting' | 'off', offRoute, distance_m, along_m, progress, point, segment }
 *   progress  0..1 along the path (same meaning as the Walk screen's state.progress)
 */
export function checkOffRoute(path, crew, { driftM = OFF_ROUTE.driftM, offM = OFF_ROUTE.offM, nearAlongM = null, windowM = OFF_ROUTE.windowM } = {}) {
  const p = projectOnPath(path, crew, { nearAlongM, windowM })
  const total = pathLength2D(path)
  const status = p.distance_m > offM ? 'off' : p.distance_m > driftM ? 'drifting' : 'on'
  return { status, offRoute: status === 'off', ...p, distance_m: Math.round(p.distance_m * 10) / 10, progress: total ? p.along_m / total : 1 }
}

/**
 * Plan again from where the crew really is: crew → stopsLeft (in order) → home.
 *
 * crew        { x, y } where they are. If that square is no-go ground (a position fix on a ridge edge),
 *             the route starts from the nearest walkable square within maxSnapMetres.
 * stopsLeft   stops still to visit, in order: { id, name, x, y, stop_minutes?, is_bonus? }
 * home        the habitat (or the rover): { id, name, x, y }
 * options
 *   minutesLeft      suit time left before the protected reserve (suit end - now - reserve).
 *                    Leave out to skip the suit check.
 *   scienceLeftHere  minutes of science still to finish where the crew is (default 0)
 *   paceFactor       1 = planned speed, 1.3 = walking 30% slower (see paceFactor())
 *
 * If walking + science doesn't fit minutesLeft, stops are dropped until it does: the bonus stop
 * first, then from the end of the list. If even going straight home doesn't fit, fits is false and
 * the route is just the way home.
 *
 * Returns { start, stops, legs, dropped, unreachable, walk_minutes, science_minutes, total_minutes,
 *           spare_minutes, fits, message }
 *   stops   [start, ...kept stops, home], legs between them shaped like planRoute()'s legs
 *   spare_minutes  minutes before the reserve once home (null when minutesLeft was not given)
 */
export function rerouteFrom(grid, crew, stopsLeft, home, { minutesLeft = null, scienceLeftHere = 0, paceFactor = 1, maxSnapMetres = 50 } = {}) {
  const crewCell = xyToCell(grid, crew.x, crew.y)
  if (crewCell < 0) throw new Error('Your position is outside the map.')
  let startCell = crewCell
  if (grid.blocked[crewCell]) {
    const walkable = new Uint8Array(grid.blocked.length)
    for (let i = 0; i < walkable.length; i++) walkable[i] = grid.blocked[i] ? 0 : 1
    startCell = snapToReachable(grid, walkable, crew.x, crew.y, maxSnapMetres)
    if (startCell < 0) throw new Error(`No walkable ground within ${maxSnapMetres} m of your position.`)
  }
  const start = { id: 'here', name: 'Your position', type: 'waypoint', x: crew.x, y: crew.y }
  if (startCell !== crewCell) {
    const p = cellToXY(grid, startCell)
    Object.assign(start, { x: p.x, y: p.y, original: { x: crew.x, y: crew.y }, moved_m: Math.round(Math.hypot(p.x - crew.x, p.y - crew.y)) })
  }

  // Stops on unreachable ground move up to maxSnapMetres, like planRoute() does.
  const reachable = reachableFrom(grid, startCell)
  const place = (s) => {
    const cell = snapToReachable(grid, reachable, s.x, s.y, maxSnapMetres)
    if (cell < 0) return null
    if (cell === xyToCell(grid, s.x, s.y)) return { ...s }
    const p = cellToXY(grid, cell)
    return { ...s, x: p.x, y: p.y, original: { x: s.x, y: s.y }, moved_m: Math.round(Math.hypot(p.x - s.x, p.y - s.y)) }
  }
  const homeStop = place(home)
  if (!homeStop) throw new Error('No safe way home from your position.')
  const unreachable = []
  let keep = []
  for (const s of stopsLeft) {
    const placed = place(s)
    if (placed) keep.push(placed)
    else unreachable.push(s)
  }

  const cache = new Map()
  const legBetween = (a, b) => {
    const key = `${a.x},${a.y}>${b.x},${b.y}`
    if (!cache.has(key)) cache.set(key, routeLeg(grid, a, b))
    return cache.get(key)
  }
  const science = (list) => scienceLeftHere + list.reduce((sum, s) => sum + (Number.isFinite(s.stop_minutes) && s.stop_minutes > 0 ? s.stop_minutes : 0), 0)
  const plan = (list) => {
    const stops = [start, ...list, homeStop]
    const legs = []
    let walk = 0
    for (let k = 0; k < stops.length - 1; k++) {
      const a = stops[k]
      const b = stops[k + 1]
      const leg = legBetween(a, b)
      if (!leg) return null
      const warnings = [...leg.warnings]
      if (b.moved_m) warnings.unshift({ type: 'stop_moved', level: 'caution', message: `${b.name ?? b.id} is surrounded by no-go slopes, so the route ends ${b.moved_m} m away on safe ground.`, distance_m: 0 })
      legs.push({ id: `reroute-${k + 1}`, from_stop_id: a.id, to_stop_id: b.id, ...leg, warnings })
      walk += (leg.seconds / 60) * paceFactor
    }
    const sci = science(list)
    const total = walk + sci
    return { stops, legs, walk_minutes: walk, science_minutes: sci, total_minutes: total, fits: minutesLeft == null || total <= minutesLeft }
  }

  let result = plan(keep)
  const dropped = []
  while ((!result || !result.fits) && keep.length) {
    const bonus = keep.findIndex((s) => s.is_bonus)
    const drop = bonus >= 0 ? bonus : keep.length - 1
    dropped.push(keep[drop])
    keep = keep.filter((_, k) => k !== drop)
    result = plan(keep)
  }
  if (!result) throw new Error('No safe way home from your position.')

  const spare = minutesLeft == null ? null : minutesLeft - result.total_minutes
  const m = (x) => `${Math.round(x)} min`
  const names = (list) => list.map((s) => s.name ?? s.id).join(', ')
  let message
  if (!result.fits) message = `Head straight home now: even the direct walk home (${m(result.walk_minutes)}) uses part of the reserve.`
  else if (dropped.length) message = `Not enough suit time for every stop: skip ${names(dropped)}. ${keep.length ? `New route to ${names(keep)}, then home` : 'Head home'} with ${m(spare)} to spare.`
  else message = `New route: ${keep.length ? `${names(keep)}, then home` : 'straight home'}. ${m(result.walk_minutes)} walking${result.science_minutes ? ` + ${m(result.science_minutes)} science` : ''}${spare == null ? '' : `, ${m(spare)} to spare`}.`
  if (unreachable.length) message += ` Can't reach ${names(unreachable)} from here.`

  return { start, ...result, dropped, unreachable, spare_minutes: spare, message }
}

/**
 * Arrival time at every stop still ahead, and at home.
 *
 * plan     { stops, legs } from planRoute(), the route file, or rerouteFrom(). legs[k] goes from
 *          stops[k] to stops[k + 1]; the last stop is home. Science time is each stop's stop_minutes
 *          (none at the habitat, at home, or at the crew's own position).
 * nowMs    the mission clock now (ms)
 * legIndex the leg the crew is on (0 = first)
 * progress 0..1 along that leg (checkOffRoute().progress, or the Walk screen's state.progress)
 * scienceLeft  minutes of science still to do before walking on (at stops[legIndex], progress 0)
 * paceFactor   1 = as planned, 1.3 = walking 30% slower. Only walking is scaled; science is not.
 *
 * Returns { stops: [{ id, name, is_bonus, arrive_ms, leave_ms, science_minutes }], home_ms,
 *           walking_minutes, science_minutes, minutes_left }
 */
export function etaFor(plan, { nowMs, legIndex = 0, progress = 0, scienceLeft = 0, paceFactor = 1 }) {
  const last = plan.stops.length - 1
  const scienceAt = (stop, k) => {
    if (k === last || ['habitat', 'home', 'waypoint'].includes(stop.type)) return 0
    return Number.isFinite(stop.stop_minutes) && stop.stop_minutes > 0 ? stop.stop_minutes : 0
  }
  const legMinutes = (leg) => (Number.isFinite(leg.seconds) ? leg.seconds / 60 : leg.walk_minutes) * paceFactor
  let t = nowMs + scienceLeft * 60000
  let walking = 0
  let science = scienceLeft
  const stops = []
  for (let k = legIndex; k < plan.legs.length; k++) {
    const w = legMinutes(plan.legs[k]) * (k === legIndex ? 1 - progress : 1)
    walking += w
    t += w * 60000
    const stop = plan.stops[k + 1]
    const s = scienceAt(stop, k + 1)
    stops.push({ id: stop.id, name: stop.name, is_bonus: !!stop.is_bonus, arrive_ms: t, leave_ms: t + s * 60000, science_minutes: s })
    science += s
    t += s * 60000
  }
  return { stops, home_ms: stops.length ? stops.at(-1).arrive_ms : nowMs, walking_minutes: walking, science_minutes: science, minutes_left: walking + science }
}

/**
 * How much slower (or faster) than planned the crew is walking: 1 = on plan, 1.3 = 30% slower.
 * plannedMinutes  planned walking time for the ground covered so far (or recently)
 * actualMinutes   how long it really took
 * weather         walking speed in the conditions ahead, as a fraction of normal (e.g. 0.6 in a dust
 *                 storm). Times scale with 1 / speed, so 0.6 makes everything ahead take 1.67x longer.
 * Until at least minPlannedMinutes of walking have been timed, the measured pace is not trusted (1).
 * The result is kept between min and max so one slow minute doesn't swing every ETA.
 */
export function paceFactor({ plannedMinutes = 0, actualMinutes = 0, weather = 1, minPlannedMinutes = 5, min = 0.5, max = 3 } = {}) {
  const measured = plannedMinutes >= minPlannedMinutes && actualMinutes > 0 ? actualMinutes / plannedMinutes : 1
  const w = weather > 0 ? weather : 1
  return Math.min(max, Math.max(min, measured / w))
}
