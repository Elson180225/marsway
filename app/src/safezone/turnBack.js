/**
 * MarsWay turn-back timer (Pathfinder 2), for Russell's walk screen.
 *
 *   turn back in = suit time left − reserve − minutes to walk home from here
 *
 * Same formula as safetyStatus() in screens/Walk/walk-model.js, but "minutes home" comes from the
 * real-terrain time-home map for the crew's exact spot, instead of guessing between two stops.
 * It only looks up one number, so it is instant: fine to call every second.
 */
import { SAFE_ZONE } from './safeZone.js'
import { homeCellNear } from './timeHome.js'

export const CAUTION_MINUTES = 30 // same "turn back soon" line as the walk screen

/**
 * grid            from makeGrid()
 * timeHome        timeHomeMap(grid, habitat), worked out once
 * position        where the crew is, local metres { x, y }
 * elapsedMinutes  how long they have been out (suit time used)
 *
 * Returns { homeMinutes, turnbackIn, level, title, message }
 *   turnbackIn  minutes before they must start walking home. 0 or less = turn back now.
 *   level       'ok' | 'caution' | 'danger' (same levels as the walk screen)
 */
export function turnBackTimer(grid, timeHome, position, elapsedMinutes, settings = SAFE_ZONE) {
  const cell = homeCellNear(grid, timeHome, position)
  if (cell < 0) {
    return { homeMinutes: Infinity, turnbackIn: -Infinity, level: 'danger', title: 'No safe way home', message: 'No walkable way home from this spot. Move back onto the planned route.' }
  }
  const homeMinutes = timeHome[cell] / 60
  const turnbackIn = (settings.suitHours - settings.reserveHours) * 60 - elapsedMinutes - homeMinutes

  const result = (level, title, message) => ({ homeMinutes, turnbackIn, level, title, message })
  if (turnbackIn <= 0) return result('danger', 'Turn back now', 'Heading home now already uses part of the protected reserve.')
  if (turnbackIn <= CAUTION_MINUTES) return result('caution', 'Turn back soon', `Less than ${CAUTION_MINUTES} minutes before you must start heading home.`)
  return result('ok', 'On plan', 'Enough suit time to reach home with the reserve intact.')
}
