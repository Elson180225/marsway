/**
 * MarsWay bonus-stop GO / NO-GO (Pathfinder 2, with Russell's walk screen).
 *
 * "We're at a stop. Is there time for one more before heading home?"
 *
 *   GO if   walk to the bonus stop + time there + walk home from it   <=   suit time left before the reserve
 *
 * This is the safe-zone rule for one spot, so the answer always agrees with the green area on
 * the map. "Walk home from it" comes from the time-home map (or the phone's home file).
 * "Walk to it" comes from Nigel's route planner, or from a leg in the route file if the phone
 * has no terrain loaded.
 */
import { findPathCells } from '../pathfinding/astar.js'
import { SAFE_ZONE } from './safeZone.js'
import { homeCellNear } from './timeHome.js'
import { xyToCell } from '../pathfinding/walkingTime.js'

export const TIGHT_MINUTES = 30 // GO, but with less than this to spare: show it as a caution (matches the amber band on the Planning map)

/**
 * grid            from makeGrid() (needed for Nigel's planner), or the small grid from loadHomeFile()
 *                 if you pass walkThereMinutes
 * timeHome        timeHomeMap() / homeArrows().timeHome / loadHomeFile().arrows.timeHome
 * options
 *   here              crew position now, local metres { x, y }
 *   bonus             the bonus stop, local metres { x, y }
 *   elapsedMinutes    suit time used so far
 *   stopMinutes       time to spend at the bonus stop (default 20)
 *   walkThereMinutes  optional: walking time to the bonus stop if you already know it (e.g. from a
 *                     route-file leg). If left out, Nigel's planner works it out on the terrain.
 *   settings          override SAFE_ZONE (suit hours, reserve hours)
 *
 * Returns { go, level, title, message, reason, walkThereMinutes, stopMinutes, homeFromBonusMinutes, spareMinutes }
 *   go      true = there is time, false = skip it
 *   level   'ok' | 'caution' | 'danger' (same levels as the walk screen)
 *   spareMinutes  minutes left before the reserve after doing the bonus stop and walking home
 *   reason  why: 'fits' | 'tight' | 'reserve' (eats into the reserve) | 'off-map' | 'no-go-ground'
 *           | 'no-way-home' (no walkable way back to H1 from the stop) | 'crew-lost' (no way home
 *           from where the crew is) | 'cant-reach' (no walkable way from the crew to the stop)
 *
 * The bonus stop is checked at its exact spot. Unlike the crew's position (where GPS can land on a
 * ridge edge and is moved to the nearest safe square), a target on a no-go slope is a NO-GO: the
 * safe-zone map shows that square as out, and the answer must agree with the map.
 */
export function bonusStopCheck(grid, timeHome, options) {
  const { here, bonus, elapsedMinutes, stopMinutes = 20, settings = SAFE_ZONE } = options
  const result = (go, level, reason, title, message, extra = {}) => ({
    go, level, reason, title, message, walkThereMinutes: null, stopMinutes, homeFromBonusMinutes: null, spareMinutes: null, ...extra,
  })
  const noGo = (reason, title, message) => result(false, 'danger', reason, `NO-GO: ${title}`, message)

  // 1. The bonus stop itself: on the map, walkable, and with a way back to H1.
  const bonusCell = xyToCell(grid, bonus.x, bonus.y)
  if (bonusCell < 0) return noGo('off-map', 'off the map', 'The bonus stop is outside the terrain map.')
  if (grid.blocked?.[bonusCell]) return noGo('no-go-ground', 'no-go ground', 'The bonus stop is on ground too steep or rough to walk on. Pick a spot nearby on walkable ground.')
  if (!(timeHome[bonusCell] < Infinity)) return noGo('no-way-home', 'no safe way home', 'There is no walkable way back to H1 from the bonus stop: it is cut off by no-go ground.')

  // 2. The walk there from the crew.
  let walkThereMinutes = options.walkThereMinutes
  if (walkThereMinutes == null) {
    if (!grid.blocked) throw new Error('bonusStopCheck needs the full terrain grid, or pass walkThereMinutes.')
    const hereCell = homeCellNear(grid, timeHome, here)
    if (hereCell < 0) return noGo('crew-lost', 'no way home from here', 'The crew position has no walkable way back to H1, so no extra stop can be planned from it.')
    const found = findPathCells(grid, hereCell, bonusCell)
    if (!found) return noGo('cant-reach', 'can\'t reach it', 'There is no safe walking route from the crew to the bonus stop.')
    walkThereMinutes = found.seconds / 60
  }
  if (!Number.isFinite(walkThereMinutes) || walkThereMinutes < 0) return noGo('cant-reach', 'can\'t reach it', 'There is no safe walking route from the crew to the bonus stop.')

  const homeFromBonusMinutes = timeHome[bonusCell] / 60
  const leftMinutes = (settings.suitHours - settings.reserveHours) * 60 - elapsedMinutes
  const spareMinutes = leftMinutes - walkThereMinutes - stopMinutes - homeFromBonusMinutes
  const numbers = { walkThereMinutes, homeFromBonusMinutes, spareMinutes }
  const plan = `${Math.round(walkThereMinutes)} min there + ${stopMinutes} min stop + ${Math.round(homeFromBonusMinutes)} min home`

  if (spareMinutes < 0) {
    return result(false, 'danger', 'reserve', 'NO-GO: skip the bonus stop', `${plan} would eat ${Math.round(-spareMinutes)} min into the reserve.`, numbers)
  }
  if (spareMinutes < TIGHT_MINUTES) {
    return result(true, 'caution', 'tight', 'GO, but tight', `${plan}. Only ${Math.round(spareMinutes)} min to spare before the reserve.`, numbers)
  }
  return result(true, 'ok', 'fits', 'GO', `${plan}. ${Math.round(spareMinutes)} min to spare before the reserve.`, numbers)
}
