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

export const TIGHT_MINUTES = 15 // GO, but with less than this to spare: show it as a caution

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
 * Returns { go, level, title, message, walkThereMinutes, stopMinutes, homeFromBonusMinutes, spareMinutes }
 *   go      true = there is time, false = skip it
 *   level   'ok' | 'caution' | 'danger' (same levels as the walk screen)
 *   spareMinutes  minutes left before the reserve after doing the bonus stop and walking home
 */
export function bonusStopCheck(grid, timeHome, options) {
  const { here, bonus, elapsedMinutes, stopMinutes = 20, settings = SAFE_ZONE } = options
  const result = (go, level, title, message, extra = {}) => ({
    go, level, title, message, walkThereMinutes: null, stopMinutes, homeFromBonusMinutes: null, spareMinutes: null, ...extra,
  })

  const bonusCell = homeCellNear(grid, timeHome, bonus)
  if (bonusCell < 0) return result(false, 'danger', 'No safe way home', 'There is no walkable way home from the bonus stop.')

  let walkThereMinutes = options.walkThereMinutes
  if (walkThereMinutes == null) {
    if (!grid.blocked) throw new Error('bonusStopCheck needs the full terrain grid, or pass walkThereMinutes.')
    const hereCell = homeCellNear(grid, timeHome, here)
    const found = hereCell < 0 ? null : findPathCells(grid, hereCell, bonusCell)
    if (!found) return result(false, 'danger', 'Can\'t reach it', 'There is no safe walking route to the bonus stop from here.')
    walkThereMinutes = found.seconds / 60
  }

  const homeFromBonusMinutes = timeHome[bonusCell] / 60
  const leftMinutes = (settings.suitHours - settings.reserveHours) * 60 - elapsedMinutes
  const spareMinutes = leftMinutes - walkThereMinutes - stopMinutes - homeFromBonusMinutes
  const numbers = { walkThereMinutes, homeFromBonusMinutes, spareMinutes }
  const plan = `${Math.round(walkThereMinutes)} min there + ${stopMinutes} min stop + ${Math.round(homeFromBonusMinutes)} min home`

  if (spareMinutes < 0) {
    return result(false, 'danger', 'NO-GO: skip the bonus stop', `${plan} would eat ${Math.round(-spareMinutes)} min into the reserve.`, numbers)
  }
  if (spareMinutes < TIGHT_MINUTES) {
    return result(true, 'caution', 'GO, but tight', `${plan}. Only ${Math.round(spareMinutes)} min to spare before the reserve.`, numbers)
  }
  return result(true, 'ok', 'GO', `${plan}. ${Math.round(spareMinutes)} min to spare before the reserve.`, numbers)
}
