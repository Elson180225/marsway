import { xyToCell } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { safeZone } from './safeZone.js'
import { turnBackTimer, CAUTION_MINUTES } from './turnBack.js'
import { stormRoute } from './storm.js'
import { walkDoseMSv, RAD_SURFACE_MSV_PER_DAY } from './radiation.js'
import { bonusStopCheck, TIGHT_MINUTES } from './bonusStop.js'
import { ZONE } from './safeZone.js'
import { adjustedTravelMinutes, latestTurnbackMinutes } from '../planningWeather.js'

function weatherBonus(check, elapsedMinutes, stopMinutes, missionStart, weather, available) {
  if (!weather || check.walkThereMinutes == null || check.homeFromBonusMinutes == null) return check
  const there = adjustedTravelMinutes(check.walkThereMinutes, elapsedMinutes, missionStart, weather)
  const home = adjustedTravelMinutes(check.homeFromBonusMinutes, elapsedMinutes + there + stopMinutes, missionStart, weather)
  const spareMinutes = available - elapsedMinutes - there - stopMinutes - home
  const go = spareMinutes >= 0
  const level = !go ? 'danger' : spareMinutes < TIGHT_MINUTES ? 'caution' : 'ok'
  const reason = !go ? 'reserve' : level === 'caution' ? 'tight' : 'fits'
  return { ...check, go, level, reason, spareMinutes, walkThereMinutes: there, homeFromBonusMinutes: home,
    title: !go ? 'NO-GO: skip the bonus stop' : level === 'caution' ? 'GO, but tight' : 'GO',
    message: `${Math.round(there)} min there + ${stopMinutes} min stop + ${Math.round(home)} min home. ${go ? `${Math.round(spareMinutes)} min before reserve.` : `Would use ${Math.round(-spareMinutes)} min of reserve.`}` }
}

// Mia's calculations are reused unchanged; mission settings come from the shared app wrapper.
export function createPlanningSafety(grid, habitat, mission) {
  const suitMinutes = mission?.max_walk_minutes
  const reserveMinutes = mission?.reserve_minutes
  if (!Number.isFinite(suitMinutes) || suitMinutes <= 0 || !Number.isFinite(reserveMinutes) || reserveMinutes < 0 || reserveMinutes >= suitMinutes) throw new Error('Invalid suit budget or protected reserve.')
  if (!Number.isFinite(habitat?.x) || !Number.isFinite(habitat?.y)) throw new Error('Invalid H1 coordinates.')
  const habitatCell = xyToCell(grid, habitat.x, habitat.y)
  if (habitatCell < 0 || grid.blocked[habitatCell]) throw new Error('H1 is outside walkable terrain.')
  const settings = { suitHours: suitMinutes / 60, reserveHours: reserveMinutes / 60 }
  const missionStart = Date.parse(mission.start_time)
  const available = suitMinutes - reserveMinutes
  // One reversed Dijkstra per grid/habitat, then reuse its time and next-home arrays.
  const arrows = homeArrows(grid, habitatCell)
  // Mia's bonus-stop GO / NO-GO from the crew reference. The walk there comes from Nigel's
  // planner on the full grid, so the verdict matches the safe-zone colour at that spot.
  const checkBonus = ({ position, bonus, elapsedMinutes, stopMinutes, weather = null }) => {
    if (weather && !Number.isFinite(missionStart)) throw new Error('Weather scenario needs a valid mission start time.')
    if (!Number.isFinite(bonus?.x) || !Number.isFinite(bonus?.y)) throw new Error('Invalid bonus-stop position.')
    const check = bonusStopCheck(grid, arrows.timeHome, { here: position, bonus, elapsedMinutes, stopMinutes, settings })
    return weatherBonus(check, elapsedMinutes, stopMinutes, missionStart, weather, available)
  }
  return {
    checkBonus,
    evaluate({ position, elapsedMinutes, stopMinutes, bonusStop, weather = null }) {
      if (weather && !Number.isFinite(missionStart)) throw new Error('Weather scenario needs a valid mission start time.')
      if (!Number.isFinite(elapsedMinutes) || elapsedMinutes < 0 || elapsedMinutes > suitMinutes || !Number.isFinite(stopMinutes) || stopMinutes < 0) throw new Error('Elapsed time must be within the suit budget; candidate-stop minutes must be non-negative.')
      if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) throw new Error('Invalid crew reference position.')
      const here = xyToCell(grid, position.x, position.y)
      // Do not silently move the Planning reference onto a nearby cell.
      if (here < 0 || grid.blocked[here] || !Number.isFinite(arrows.timeHome[here])) throw new Error('The selected reference has no walkable route to H1.')
      const zone = safeZone(grid, habitatCell, {
        here, elapsedSeconds: elapsedMinutes * 60, stopSeconds: stopMinutes * 60,
        settings, timeHome: arrows.timeHome,
      })
      if (weather) {
        // The underlying terrain maps remain unchanged. Apply the storm clock
        // to each outward leg, stop, and return in order, preserving direction.
        zone.safeCells = 0
        zone.reserveCells = 0
        for (let i = 0; i < zone.zone.length; i++) {
          const outward = zone.timeFrom[i]
          const home = zone.timeHome[i]
          if (!Number.isFinite(outward) || !Number.isFinite(home)) {
            zone.zone[i] = ZONE.OUT
            zone.spareMinutes[i] = -Infinity
            continue
          }
          const there = adjustedTravelMinutes(outward / 60, elapsedMinutes, missionStart, weather)
          const back = adjustedTravelMinutes(home / 60, elapsedMinutes + there + stopMinutes, missionStart, weather)
          const spare = available - elapsedMinutes - there - stopMinutes - back
          zone.spareMinutes[i] = spare
          zone.zone[i] = spare >= 0 ? ZONE.SAFE : spare >= -reserveMinutes ? ZONE.RESERVE : ZONE.OUT
          if (zone.zone[i] === ZONE.SAFE) zone.safeCells++
          if (zone.zone[i] === ZONE.RESERVE) zone.reserveCells++
        }
      }
      const timer = turnBackTimer(grid, arrows.timeHome, position, elapsedMinutes, settings)
      if (weather && Number.isFinite(timer.homeMinutes)) {
        const baseHome = timer.homeMinutes
        timer.homeMinutes = adjustedTravelMinutes(timer.homeMinutes, elapsedMinutes, missionStart, weather)
        timer.turnbackIn = latestTurnbackMinutes(baseHome, elapsedMinutes, available, missionStart, weather)
        timer.level = timer.turnbackIn <= 0 ? 'danger' : timer.turnbackIn <= CAUTION_MINUTES ? 'caution' : 'ok'
        timer.title = timer.level === 'danger' ? 'Turn back now' : timer.level === 'caution' ? 'Turn back soon' : 'On plan'
        timer.message = timer.level === 'danger' ? 'Heading home now uses the protected reserve.' : timer.level === 'caution' ? `Less than ${CAUTION_MINUTES} minutes before heading home.` : 'Enough suit time to reach home with reserve intact.'
      }
      const storm = stormRoute(grid, arrows, position)
      if (weather && storm) {
        storm.seconds = adjustedTravelMinutes(storm.seconds / 60, elapsedMinutes, missionStart, weather) * 60
        storm.walk_minutes = Math.round(storm.seconds / 60)
      }
      return {
        zone: zone.zone, spareMinutes: zone.spareMinutes,
        safeCells: zone.safeCells, reserveCells: zone.reserveCells,
        timer, storm,
        elapsedDoseMSv: walkDoseMSv(elapsedMinutes / 60),
        rateMSvPerDay: RAD_SURFACE_MSV_PER_DAY,
        reserveAtHomeMinutes: suitMinutes - elapsedMinutes - timer.homeMinutes,
        elapsedMinutes, stopMinutes, position: { x: position.x, y: position.y },
        // The route's bonus stop uses its own visit time when it has one.
        bonusCheck: bonusStop ? { ...checkBonus({ position, bonus: bonusStop, elapsedMinutes, stopMinutes: bonusStop.stopMinutes ?? stopMinutes, weather }), name: bonusStop.name } : null,
      }
    },
  }
}
