import { xyToCell } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { safeZone } from './safeZone.js'
import { turnBackTimer } from './turnBack.js'
import { stormRoute } from './storm.js'
import { walkDoseMSv, RAD_SURFACE_MSV_PER_DAY } from './radiation.js'

// Mia's calculations are reused unchanged; mission settings come from the shared app wrapper.
export function createPlanningSafety(grid, habitat, mission) {
  const suitMinutes = mission?.max_walk_minutes
  const reserveMinutes = mission?.reserve_minutes
  if (!Number.isFinite(suitMinutes) || suitMinutes <= 0 || !Number.isFinite(reserveMinutes) || reserveMinutes < 0 || reserveMinutes >= suitMinutes) throw new Error('Invalid suit budget or protected reserve.')
  if (!Number.isFinite(habitat?.x) || !Number.isFinite(habitat?.y)) throw new Error('Invalid H1 coordinates.')
  const habitatCell = xyToCell(grid, habitat.x, habitat.y)
  if (habitatCell < 0 || grid.blocked[habitatCell]) throw new Error('H1 is outside walkable terrain.')
  const settings = { suitHours: suitMinutes / 60, reserveHours: reserveMinutes / 60 }
  // One reversed Dijkstra per grid/habitat, then reuse its time and next-home arrays.
  const arrows = homeArrows(grid, habitatCell)
  return {
    evaluate({ position, elapsedMinutes, stopMinutes }) {
      if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes > suitMinutes || !Number.isFinite(stopMinutes) || stopMinutes < 0) throw new Error('Elapsed time must be within the suit budget; candidate-stop minutes must be non-negative.')
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw new Error('Invalid crew reference position.')
      const here = xyToCell(grid, position.x, position.y)
      // Do not silently move the Planning reference onto a nearby cell.
      if (here < 0 || grid.blocked[here] || !Number.isFinite(arrows.timeHome[here])) throw new Error('The selected reference has no walkable route to H1.')
      const zone = safeZone(grid, habitatCell, {
        here, elapsedSeconds: elapsedMinutes * 60, stopSeconds: stopMinutes * 60,
        settings, timeHome: arrows.timeHome,
      })
      const timer = turnBackTimer(grid, arrows.timeHome, position, elapsedMinutes, settings)
      const storm = stormRoute(grid, arrows, position)
      return {
        zone: zone.zone, spareMinutes: zone.spareMinutes,
        safeCells: zone.safeCells, reserveCells: zone.reserveCells,
        timer, storm,
        elapsedDoseMSv: walkDoseMSv(elapsedMinutes / 60),
        rateMSvPerDay: RAD_SURFACE_MSV_PER_DAY,
        reserveAtHomeMinutes: suitMinutes - elapsedMinutes - timer.homeMinutes,
        elapsedMinutes, stopMinutes, position: { x: position.x, y: position.y },
      }
    },
  }
}
