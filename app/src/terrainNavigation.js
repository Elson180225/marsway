import { routeLeg } from './pathfinding/astar.js'
import { xyToCell, suitSpeedMps } from './pathfinding/walkingTime.js'

// The Walk model receives this provider, keeping DOM-free maths testable.
// Returns are routed in the actual walking direction, never by reversing outbound time.
export function createTerrainNavigation(route, grid) {
  const home = route.stops[0]
  const homeCell = xyToCell(grid, home.x, home.y)
  const cache = new Map()
  return {
    homeFrom(point) {
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw new Error('Invalid simulated position.')
      const cell = xyToCell(grid, point.x, point.y)
      if (cell < 0 || grid.blocked[cell]) throw new Error('Simulated position is outside walkable terrain. Return estimate unavailable.')
      const key = `${point.x},${point.y}`
      if (cache.has(key)) return cache.get(key)
      let leg
      if (cell === homeCell) {
        // A* has no edge within one cell. Use flat, suited speed and this cell's
        // roughness for the final few metres; this sub-cell estimate is explicit.
        const metres = Math.hypot(home.x - point.x, home.y - point.y)
        const seconds = metres / suitSpeedMps(0, grid.suit) * grid.factor[cell]
        leg = { distance_m: metres, seconds, path: metres ? [{ ...point }, { x: home.x, y: home.y }] : [{ x: home.x, y: home.y }], warnings: [] }
      } else {
        leg = routeLeg(grid, point, home)
        if (!leg || !Number.isFinite(leg.seconds)) throw new Error('No return path from the simulated position. Return estimate unavailable.')
      }
      const result = { ...leg, walk_minutes: leg.seconds / 60 }
      if (cache.size >= 128) cache.delete(cache.keys().next().value)
      cache.set(key, result)
      return result
    },
  }
}
