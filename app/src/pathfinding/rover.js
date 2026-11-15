/**
 * MarsWay rover driving (Pathfinder 1): where the open rover can drive, the drive route and its time.
 *
 * Team rules (same as EVA-08, numbers in public/routes/rover-parking.json "rules"):
 *   - The rover only drives on ground up to about 15° (slope.json, the same slopes the walking
 *     no-go rule uses). Walking no-go ground is never driveable either.
 *   - 5 km/h average along the ground, plus 10 min to get on and off for each drive.
 *   - Open rover, suits on: the drive counts against the 8 h suit (Mia's roverSafety.js checks that).
 *
 * The drive route is the shortest one along the ground (counting up and down). At a steady 5 km/h
 * the shortest drive is also the quickest.
 */
import { findPathCells, simplify, MinHeap } from './astar.js'
import { forEachNeighbour, cellToXY, xyToCell } from './walkingTime.js'

export const ROVER_RULES = { speedKmh: 5, onOffMinutes: 10, maxSlopeDeg: 15 }

/** Default displayed by the Planning travel-mode picker. */
export function defaultTravelMode(eva) {
  return String(eva).replace(/^EVA-/, '') === '08' ? 'rover' : 'foot'
}

/** The "rules" block of rover-parking.json in ROVER_RULES form (missing values use the defaults). */
export function roverRulesFrom(file) {
  const r = file?.rules ?? {}
  return {
    speedKmh: r.speed_kmh ?? ROVER_RULES.speedKmh,
    onOffMinutes: r.on_off_minutes ?? ROVER_RULES.onOffMinutes,
    maxSlopeDeg: r.max_slope_deg ?? ROVER_RULES.maxSlopeDeg,
  }
}

/** Minutes for one drive: distance at the average speed, plus getting on and off. */
export function driveMinutes(distanceM, rules = ROVER_RULES) {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error('Drive distance must be 0 or more metres.')
  return (distanceM / 1000 / rules.speedKmh) * 60 + rules.onOffMinutes
}

/**
 * The same grid, but with every cell steeper than the rover limit blocked.
 * Needs the slope file: without it there is no way to tell where the rover can go.
 */
export function makeRoverGrid(grid, rules = ROVER_RULES) {
  if (!grid.slope) throw new Error('The rover needs slope.json to know where it can drive.')
  const blocked = new Uint8Array(grid.blocked.length)
  for (let i = 0; i < blocked.length; i++) blocked[i] = grid.blocked[i] || grid.slope[i] > rules.maxSlopeDeg ? 1 : 0
  return { ...grid, blocked, rover: rules }
}

/** Metres along the ground for one step between neighbouring cells (len = 1 or √2 cells). */
export function driveStepMetres(grid, from, to, len) {
  return Math.hypot(len * grid.cellSize, grid.elevation[to] - grid.elevation[from])
}

/**
 * Shortest drive from `startCell` to every cell the rover can reach, in metres (Infinity = can't).
 * roverGrid from makeRoverGrid(). Used to pick parking spots.
 */
export function driveDistanceMap(roverGrid, startCell) {
  const n = roverGrid.width * roverGrid.height
  const dist = new Float64Array(n).fill(Infinity)
  if (startCell < 0 || roverGrid.blocked[startCell]) return dist
  const done = new Uint8Array(n)
  const open = new MinHeap()
  dist[startCell] = 0
  open.push(startCell, 0)
  while (open.size) {
    const i = open.pop()
    if (done[i]) continue
    done[i] = 1
    forEachNeighbour(roverGrid, i, (j, len) => {
      const d = dist[i] + driveStepMetres(roverGrid, i, j, len)
      if (d < dist[j]) {
        dist[j] = d
        open.push(j, d)
      }
    })
  }
  return dist
}

/**
 * The drive between two points in local metres ({x, y}).
 * grid: the normal terrain grid (makeGrid); the rover limit is applied here.
 * Returns { distance_m, minutes, path: [{x, y}] } (minutes include getting on and off), or null if
 * the rover can't get there. The way back is the same route reversed, with the same time.
 */
export function driveRoute(grid, from, to, rules = ROVER_RULES, roverGrid = makeRoverGrid(grid, rules)) {
  const start = xyToCell(grid, from.x, from.y)
  const goal = xyToCell(grid, to.x, to.y)
  if (start < 0 || goal < 0) throw new Error('A drive end is outside the map.')
  if (roverGrid.blocked[start]) return null
  const found = findPathCells(roverGrid, start, goal, { stepCost: driveStepMetres, minCostPerMetre: 1 })
  if (!found) return null
  const path = simplify(grid, found.cells).map((i) => cellToXY(grid, i))
  path[0] = { x: from.x, y: from.y }
  path[path.length - 1] = { x: to.x, y: to.y }
  const maxSlope = Math.max(...found.cells.map((i) => grid.slope[i]))
  return { distance_m: Math.round(found.seconds), minutes: driveMinutes(found.seconds, rules), max_slope_deg: maxSlope, path }
}
