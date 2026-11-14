/**
 * MarsWay time-home map (Pathfinder 2).
 *
 * For every square on the map, how many seconds it takes to walk back to the habitat.
 * The safe zone, turn-back timer and storm alert all read this one result.
 *
 * Walking times come from Nigel's stepSeconds() (../pathfinding/walkingTime.js), so the
 * times here always agree with the route planner.
 */
import { forEachNeighbour, stepSeconds, xyToCell, cellToXY } from '../pathfinding/walkingTime.js'

/**
 * Dijkstra spreading outward from the habitat.
 *
 * Returns a Float32Array with one number per cell: seconds to walk home from that cell.
 * Cells you can't get home from (blocked, or cut off by cliffs) are Infinity.
 *
 * Direction matters: when the ripple spreads from cell i to its neighbour j, the astronaut
 * at j would walk j -> i on the way home, so the cost is stepSeconds(grid, j, i, len).
 */
export function timeHomeMap(grid, habitatCell) {
  return walkTimeMap(grid, habitatCell, 'to').time
}

/**
 * Time home AND the way home.
 *   timeHome[i]  seconds to walk home from cell i (Infinity = no way home)
 *   nextHome[i]  the neighbour to step to next on the quickest way home (-1 at the habitat
 *                and on cells with no way home). Follow the arrows to get home: see storm.js.
 *   distHome[i]  metres to walk home along those arrows (Infinity = no way home)
 */
export function homeArrows(grid, habitatCell) {
  const { time, next } = walkTimeMap(grid, habitatCell, 'to')
  return { timeHome: time, nextHome: next, distHome: distanceHome(grid, time, next) }
}

/**
 * distHome[i] = metres along the ground (including up and down) when following the arrows home
 * from cell i. Same distance as Nigel's routeLeg(). Infinity where there is no way home.
 */
function distanceHome(grid, time, next) {
  const n = next.length
  const dist = new Float32Array(n).fill(NaN)
  const step = (a, b) => {
    const a2 = cellToXY(grid, a)
    const b2 = cellToXY(grid, b)
    return Math.hypot(b2.x - a2.x, b2.y - a2.y, grid.elevation[b] - grid.elevation[a])
  }
  const chain = []
  for (let i = 0; i < n; i++) {
    // Walk the arrows until we reach a cell we already know, then fill the chain in backwards.
    let c = i
    while (Number.isNaN(dist[c]) && next[c] !== -1) {
      chain.push(c)
      c = next[c]
    }
    if (Number.isNaN(dist[c])) dist[c] = time[c] === 0 ? 0 : Infinity // no arrow: the habitat, or no way home
    while (chain.length) {
      const d = chain.pop()
      dist[d] = dist[next[d]] + step(d, next[d])
    }
  }
  return dist
}

/**
 * The opposite: seconds to walk FROM `startCell` out to every other cell.
 * The safe zone uses this from wherever the crew is standing right now.
 * (Nigel's reachableFrom() only says yes/no, so we need this for the actual times.)
 */
export function timeFromMap(grid, startCell) {
  return walkTimeMap(grid, startCell, 'from').time
}

/**
 * One Dijkstra for both directions.
 *   'to'   : time[i] = seconds to walk from i TO `cell`;  next[i] = next step towards `cell`
 *   'from' : time[i] = seconds to walk FROM `cell` to i;  next[i] = previous step on the way out
 */
export function walkTimeMap(grid, cell, direction) {
  if (direction !== 'to' && direction !== 'from') throw new Error(`direction must be 'to' or 'from'`)
  const toward = direction === 'to'
  const n = grid.width * grid.height
  const time = new Float32Array(n).fill(Infinity)
  const next = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const queue = new MinHeap()

  time[cell] = 0
  queue.push(cell, 0)

  while (queue.size) {
    const i = queue.pop() // the closest square we haven't finished yet
    if (done[i]) continue // already finished with a quicker time
    done[i] = 1

    forEachNeighbour(grid, i, (j, len) => {
      const t = time[i] + (toward ? stepSeconds(grid, j, i, len) : stepSeconds(grid, i, j, len))
      if (t < time[j]) {
        time[j] = t
        next[j] = i
        queue.push(j, t)
      }
    })
  }
  return { time, next }
}

/**
 * The cell for a point in local metres ({x, y}). If that exact spot has no way home (a no-go
 * slope, e.g. GPS puts the crew on a ridge edge), use the nearest cell within maxMetres that does.
 * Returns -1 if the point is off the map or nothing nearby has a way home.
 */
export function homeCellNear(grid, timeHome, { x, y }, maxMetres = 50) {
  const i0 = xyToCell(grid, x, y)
  if (i0 >= 0 && timeHome[i0] < Infinity) return i0
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
      if (r < 0 || c < 0 || r >= height || c >= width || !(timeHome[r * width + c] < Infinity)) continue
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
 * Small binary min-heap of cell indices keyed by time.
 * Copied from Nigel's astar.js (not exported there) so his files stay untouched.
 */
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
