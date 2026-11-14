/**
 * MarsWay route-finding (Pathfinder 1): A* search for the quickest walk between stops.
 *
 * planRoute() returns legs and returns in the same shape as
 * app/public/routes/sample-route.json, so the app can show real routes directly.
 */
import { forEachNeighbour, stepSeconds, maxSpeedMps, cellToXY, xyToCell } from './walkingTime.js'

/** Small binary min-heap of cell indices keyed by priority. */
class MinHeap {
  constructor() {
    this.keys = []
    this.vals = []
  }
  get size() {
    return this.vals.length
  }
  push(val, key) {
    const { keys, vals } = this
    let i = vals.length
    keys.push(key)
    vals.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= key) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = key
    vals[i] = val
  }
  pop() {
    const { keys, vals } = this
    const top = vals[0]
    const key = keys.pop()
    const val = vals.pop()
    const n = vals.length
    if (n > 0) {
      let i = 0
      while (true) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && keys[c + 1] < keys[c]) c++
        if (keys[c] >= key) break
        keys[i] = keys[c]
        vals[i] = vals[c]
        i = c
      }
      keys[i] = key
      vals[i] = val
    }
    return top
  }
}

/**
 * Quickest path between two cells.
 * Returns { cells: [cell indices, start..goal], seconds } or null if there is no safe path.
 * useHeuristic: false turns A* into plain Dijkstra (used by the tests to check A*).
 */
export function findPathCells(grid, start, goal, { useHeuristic = true } = {}) {
  const { width, cellSize, blocked } = grid
  if (blocked[goal]) return null
  const n = width * grid.height
  const time = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)

  // Heuristic: straight-line distance at the fastest possible speed. It never
  // overestimates, so A* still finds the truly quickest path.
  const goalRow = (goal / width) | 0
  const goalCol = goal - goalRow * width
  const secPerCell = useHeuristic ? cellSize / maxSpeedMps(grid.suit) : 0
  const h = (i) => {
    const r = (i / width) | 0
    return Math.hypot(r - goalRow, i - r * width - goalCol) * secPerCell
  }

  const open = new MinHeap()
  time[start] = 0
  open.push(start, h(start))
  while (open.size) {
    const i = open.pop()
    if (done[i]) continue
    done[i] = 1
    if (i === goal) break
    const ti = time[i]
    forEachNeighbour(grid, i, (j, len) => {
      if (done[j]) return
      const t = ti + stepSeconds(grid, i, j, len)
      if (t < time[j]) {
        time[j] = t
        cameFrom[j] = i
        open.push(j, t + h(j))
      }
    })
  }
  if (time[goal] === Infinity) return null

  const cells = []
  for (let i = goal; i !== -1; i = cameFrom[i]) cells.push(i)
  cells.reverse()
  return { cells, seconds: time[goal] }
}

/** Keep only the cells where the path changes direction, so the line on the map stays light. */
export function simplify(grid, cells) {
  if (cells.length <= 2) return cells.slice()
  const out = [cells[0]]
  for (let k = 1; k < cells.length - 1; k++) {
    if (cells[k] - cells[k - 1] !== cells[k + 1] - cells[k]) out.push(cells[k])
  }
  out.push(cells[cells.length - 1])
  return out
}

/**
 * Notices for a leg. Each is { type, level, message, distance_m } where distance_m is how many
 * metres of the leg it covers (so screens can filter, e.g. hide rough ground of 15 m or less,
 * without reading the message text). Steep slopes also have max_slope_deg.
 */
export function legWarnings(grid, cells) {
  const { suit, slope, roughness, cellSize } = grid
  const warnings = []
  if (slope) {
    const steep = cells.filter((i) => slope[i] > suit.slopeWarnDeg)
    if (steep.length) {
      const maxDeg = Math.max(...steep.map((i) => slope[i]))
      warnings.push({
        type: 'steep_slope',
        level: 'caution',
        message: `About ${steep.length * cellSize} m of this leg is steeper than ${suit.slopeWarnDeg}° (up to ${maxDeg.toFixed(0)}°).`,
        distance_m: steep.length * cellSize,
        max_slope_deg: Math.round(maxDeg),
      })
    }
  }
  if (roughness) {
    const rough = cells.filter((i) => roughness[i] > suit.roughWarnDeg)
    if (rough.length) {
      warnings.push({
        type: 'rough_ground',
        level: 'info',
        message: `About ${rough.length * cellSize} m of rocky or uneven ground on this leg.`,
        distance_m: rough.length * cellSize,
      })
    }
  }
  return warnings
}

/** Every cell you can walk to from `start` (1 = reachable). Cheap: one pass over the grid. */
export function reachableFrom(grid, start) {
  const seen = new Uint8Array(grid.width * grid.height)
  const stack = [start]
  seen[start] = 1
  while (stack.length) {
    const i = stack.pop()
    forEachNeighbour(grid, i, (j, len) => {
      if (!seen[j] && stepSeconds(grid, i, j, len) < Infinity) {
        seen[j] = 1
        stack.push(j)
      }
    })
  }
  return seen
}

/**
 * Nearest reachable cell to (x, y), searching up to maxMetres away. Returns -1 if none.
 * Stops picked on a boxwork ridge often land in small pockets surrounded by no-go ground.
 */
export function snapToReachable(grid, reachable, x, y, maxMetres = 50) {
  const i0 = xyToCell(grid, x, y)
  if (i0 >= 0 && reachable[i0]) return i0
  const { width, height, cellSize } = grid
  const col0 = Math.floor(x / cellSize)
  const row0 = Math.floor((grid.sizeY - y) / cellSize)
  const maxR = Math.ceil(maxMetres / cellSize)
  let best = -1
  let bestD = Infinity
  for (let dr = -maxR; dr <= maxR; dr++) {
    for (let dc = -maxR; dc <= maxR; dc++) {
      const r = row0 + dr
      const c = col0 + dc
      if (r < 0 || c < 0 || r >= height || c >= width || !reachable[r * width + c]) continue
      const d = Math.hypot(dr, dc)
      if (d < bestD && d * cellSize <= maxMetres) {
        bestD = d
        best = r * width + c
      }
    }
  }
  return best
}

/**
 * Route one leg between two points in local metres ({x, y}).
 * Returns { distance_m, walk_minutes, seconds, path: [{x,y}], warnings } or null if unreachable.
 */
export function routeLeg(grid, from, to) {
  const start = xyToCell(grid, from.x, from.y)
  const goal = xyToCell(grid, to.x, to.y)
  if (start < 0 || goal < 0) throw new Error('A stop is outside the map.')
  const found = findPathCells(grid, start, goal)
  if (!found) return null

  let distance = 0 // along the ground, including going up and down
  for (let k = 1; k < found.cells.length; k++) {
    const a = cellToXY(grid, found.cells[k - 1])
    const b = cellToXY(grid, found.cells[k])
    const dh = grid.elevation[found.cells[k]] - grid.elevation[found.cells[k - 1]]
    distance += Math.hypot(b.x - a.x, b.y - a.y, dh)
  }

  const path = simplify(grid, found.cells).map((i) => cellToXY(grid, i))
  path[0] = { x: from.x, y: from.y } // start and end exactly on the stops
  path[path.length - 1] = { x: to.x, y: to.y }

  return {
    distance_m: Math.round(distance),
    walk_minutes: Math.round(found.seconds / 60),
    seconds: found.seconds,
    path,
    warnings: legWarnings(grid, found.cells),
  }
}

/**
 * Plan the whole walk. stops = [{ id, name, x, y, ... }] in visit order, stops[0] = habitat.
 * Returns { stops, legs, returns } shaped like sample-route.json.
 *   stops:   copies of the input stops. A stop on unreachable ground is moved to the
 *            nearest reachable spot (max 50 m) and gets moved_m and original {x, y}.
 *   returns: returns[k] is the quickest way home from stops[k] (for the "can we get back?" panel).
 */
export function planRoute(grid, inputStops, { maxSnapMetres = 50 } = {}) {
  const hab = inputStops[0]
  const habCell = xyToCell(grid, hab.x, hab.y)
  if (habCell < 0) throw new Error(`${hab.name ?? hab.id} is outside the map.`)
  if (grid.blocked[habCell]) throw new Error(`${hab.name ?? hab.id} is on no-go ground.`)
  const reachable = reachableFrom(grid, habCell)

  const stops = inputStops.map((s) => {
    const cell = snapToReachable(grid, reachable, s.x, s.y, maxSnapMetres)
    if (cell < 0) throw new Error(`${s.name ?? s.id} can't be reached safely from ${hab.name ?? hab.id} (no walkable ground within ${maxSnapMetres} m).`)
    if (cell === xyToCell(grid, s.x, s.y)) return { ...s }
    const p = cellToXY(grid, cell)
    return { ...s, x: p.x, y: p.y, original: { x: s.x, y: s.y }, moved_m: Math.round(Math.hypot(p.x - s.x, p.y - s.y)) }
  })

  const legs = []
  for (let k = 0; k < stops.length - 1; k++) {
    const a = stops[k]
    const b = stops[k + 1]
    const leg = routeLeg(grid, a, b)
    if (!leg) throw new Error(`No safe path from ${a.name ?? a.id} to ${b.name ?? b.id}.`)
    if (b.moved_m) {
      leg.warnings.unshift({
        type: 'stop_moved',
        level: 'caution',
        message: `${b.name ?? b.id} is surrounded by no-go slopes, so the route ends ${b.moved_m} m away on safe ground.`,
      })
    }
    legs.push({ id: `leg-${k + 1}`, from_stop_id: a.id, to_stop_id: b.id, ...leg })
  }
  const home = stops[0]
  const returns = stops.map((s) => {
    if (s.x === home.x && s.y === home.y) return { from_stop_id: s.id, distance_m: 0, walk_minutes: 0, path: [{ x: s.x, y: s.y }] }
    const leg = routeLeg(grid, s, home)
    if (!leg) throw new Error(`No safe path home from ${s.name ?? s.id}.`)
    return { from_stop_id: s.id, distance_m: leg.distance_m, walk_minutes: leg.walk_minutes, path: leg.path }
  })
  return { stops, legs, returns }
}
