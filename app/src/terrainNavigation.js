import { legWarnings, simplify } from './pathfinding/astar.js'
import { cellToXY, stepSeconds, suitSpeedMps, xyToCell } from './pathfinding/walkingTime.js'
import { homeArrows } from './safezone/timeHome.js'

// The Walk model receives this provider, keeping DOM-free maths testable.
// Returns are routed in the actual walking direction, never by reversing outbound time.
//
// The way home follows Mia's next-step-home arrows (safezone/timeHome.js): one search from the
// habitat, done once, then every lookup is instant. The phone can skip even that search by loading
// her pre-calculated arrows (public/safezone/home-h1.*), but only if they match this terrain.
// Time, distance and warnings are added up along the arrows on the terrain itself, exactly as
// Nigel's routeLeg() does for a planned leg, so the numbers match the route planner.
export function createTerrainNavigation(route, grid, { homeFile = null } = {}) {
  const home = route.stops[0]
  const homeCell = xyToCell(grid, home.x, home.y)
  const useFile = homeFileMatches(grid, homeFile, homeCell)
  const { timeHome, nextHome } = useFile ? homeFile.arrows : homeArrows(grid, homeCell)
  const cache = new Map()
  return {
    source: useFile ? 'home file' : 'terrain',
    homeFrom(point) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('Invalid simulated position.')
      const cell = xyToCell(grid, point.x, point.y)
      if (cell < 0 || grid.blocked[cell]) throw new Error('Simulated position is outside walkable terrain. Return estimate unavailable.')
      const key = `${point.x},${point.y}`
      if (cache.has(key)) return cache.get(key)
      let leg
      if (cell === homeCell) {
        // There is no step within one cell. Use flat, suited speed and this cell's
        // roughness for the final few metres; this sub-cell estimate is explicit.
        const metres = Math.hypot(home.x - point.x, home.y - point.y)
        const seconds = metres / suitSpeedMps(0, grid.suit) * grid.factor[cell]
        leg = { distance_m: metres, seconds, path: metres ? [{ ...point }, { x: home.x, y: home.y }] : [{ x: home.x, y: home.y }], warnings: [] }
      } else {
        if (!(timeHome[cell] < Infinity)) throw new Error('No return path from the simulated position. Return estimate unavailable.')
        leg = legAlongArrows(grid, nextHome, cell, point, home)
      }
      const result = { ...leg, walk_minutes: leg.seconds / 60 }
      if (cache.size >= 128) cache.delete(cache.keys().next().value)
      cache.set(key, result)
      return result
    },
  }
}

// Same shape as Nigel's routeLeg(): { distance_m, seconds, path, warnings }. Steps are added up
// from the crew towards home, in the same order as his A*, so the times agree with it.
function legAlongArrows(grid, nextHome, start, from, to) {
  const cells = [start]
  for (let i = start; nextHome[i] !== -1; i = nextHome[i]) {
    cells.push(nextHome[i])
    if (cells.length > nextHome.length) throw new Error('The way home goes round in a loop. Return estimate unavailable.')
  }
  let seconds = 0
  let distance = 0 // along the ground, including going up and down
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1]
    const b = cells[k]
    seconds += stepSeconds(grid, a, b, stepLength(grid, a, b))
    const pa = cellToXY(grid, a)
    const pb = cellToXY(grid, b)
    distance += Math.hypot(pb.x - pa.x, pb.y - pa.y, grid.elevation[b] - grid.elevation[a])
  }
  if (!Number.isFinite(seconds)) throw new Error('No return path from the simulated position. Return estimate unavailable.')
  const path = simplify(grid, cells).map((i) => cellToXY(grid, i))
  path[0] = { x: from.x, y: from.y } // start exactly at the crew and end exactly at the habitat
  path[path.length - 1] = { x: to.x, y: to.y }
  return { distance_m: Math.round(distance), seconds, path, warnings: legWarnings(grid, cells) }
}

// Step length in cells between two neighbouring cells: 1 straight, √2 diagonal.
function stepLength(grid, a, b) {
  const { width } = grid
  return a % width !== b % width && ((a / width) | 0) !== ((b / width) | 0) ? Math.SQRT2 : 1
}

// Trust the pre-calculated arrows only if they were made for this habitat and this exact terrain:
// every arrow must step onto walkable ground, and its saved time home must equal the next cell's time
// plus that one step on today's terrain. The file stores whole seconds, hence about 1 s of slack.
// If anything differs (new terrain, new suit numbers, another habitat), work the arrows out instead.
function homeFileMatches(grid, file, homeCell) {
  if (!file?.arrows || file.stale || file.habitatCell !== homeCell) return false
  if (file.grid.width !== grid.width || file.grid.height !== grid.height || file.grid.cellSize !== grid.cellSize) return false
  const { timeHome, nextHome } = file.arrows
  if (timeHome.length !== grid.width * grid.height || timeHome[homeCell] !== 0) return false
  for (let i = 0; i < nextHome.length; i++) {
    const j = nextHome[i]
    if (j === -1) {
      if (i !== homeCell && timeHome[i] < Infinity) return false
      continue
    }
    if (grid.blocked[i] || grid.blocked[j]) return false
    if (!(Math.abs(timeHome[i] - timeHome[j] - stepSeconds(grid, i, j, stepLength(grid, i, j))) <= 1.01)) return false
  }
  return true
}
