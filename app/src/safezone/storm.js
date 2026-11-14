/**
 * MarsWay solar storm button (Pathfinder 2): "get to shelter now".
 *
 * From where the crew is, follow the next-step-home arrows (homeArrows() in timeHome.js) back to
 * the habitat. No new search is needed, so it is instant, and it is always the quickest way home
 * on our terrain because the arrows come from the same Dijkstra as the time-home map.
 *
 * Returns the same shape as a leg from Nigel's routeLeg(), so the map can draw it the same way:
 *   { distance_m, walk_minutes, seconds, path: [{ x, y }, ...] }
 * or null if there is no walkable way home from that spot.
 */
import { cellToXY } from '../pathfinding/walkingTime.js'
import { homeCellNear } from './timeHome.js'

/**
 * grid       from makeGrid()
 * arrows     homeArrows(grid, habitat), worked out once: { timeHome, nextHome }
 * position   where the crew is, local metres { x, y }
 */
export function stormRoute(grid, { timeHome, nextHome }, position) {
  const start = homeCellNear(grid, timeHome, position)
  if (start < 0) return null

  const cells = [start]
  for (let i = start; nextHome[i] !== -1; i = nextHome[i]) {
    cells.push(nextHome[i])
    if (cells.length > timeHome.length) throw new Error('next-step-home arrows go round in a loop')
  }

  let distance = 0 // along the ground, including going up and down (same as Nigel's)
  for (let k = 1; k < cells.length; k++) {
    const a = cellToXY(grid, cells[k - 1])
    const b = cellToXY(grid, cells[k])
    distance += Math.hypot(b.x - a.x, b.y - a.y, grid.elevation[cells[k]] - grid.elevation[cells[k - 1]])
  }

  const path = cornersOnly(cells).map((i) => cellToXY(grid, i))
  path[0] = { x: position.x, y: position.y } // start exactly where the crew is

  return {
    distance_m: Math.round(distance),
    walk_minutes: Math.round(timeHome[start] / 60),
    seconds: timeHome[start],
    path,
  }
}

// Keep only the cells where the path turns, so the line on the map stays light (like Nigel's simplify()).
function cornersOnly(cells) {
  if (cells.length <= 2) return cells.slice()
  const out = [cells[0]]
  for (let k = 1; k < cells.length - 1; k++) {
    if (cells[k] - cells[k - 1] !== cells[k + 1] - cells[k]) out.push(cells[k])
  }
  out.push(cells[cells.length - 1])
  return out
}
