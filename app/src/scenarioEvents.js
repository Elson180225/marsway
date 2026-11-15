// One scenario number gives the same random events on Planning and Walk (Mia's randomEvents.js).
// Both screens call scenarioEvents(route, seed), so they always pass the same seed, version and
// planned walk length. The number goes between screens in the link: ?scenario=4821.
//
//   scenarioFromSearch('?eva=07&scenario=4821')   -> 4821 (null if missing or not 1 to 9999)
//   withScenario('/walk.html?eva=07', 4821)        -> '/walk.html?eva=07&scenario=4821'
//   plannedWalkMinutes(route)                      -> the Planning schedule total, no weather
//   scenarioEvents(route, 4821)                    -> randomEvents() result for this route
import { calculateMissionSchedule } from './missionSchedule.js'
import { randomEvents } from './safezone/randomEvents.js'

export function scenarioFromSearch(search) {
  const text = new URLSearchParams(search).get('scenario') ?? ''
  const seed = /^\d{1,4}$/.test(text) ? Number(text) : 0
  return seed >= 1 && seed <= 9999 ? seed : null
}

// Adds (or with no seed, removes) ?scenario= on a link, keeping its other parameters.
export function withScenario(href, seed) {
  const [beforeHash, hash] = href.split('#')
  const [path, query = ''] = beforeHash.split('?')
  const params = new URLSearchParams(query)
  if (seed) params.set('scenario', String(seed))
  else params.delete('scenario')
  const text = params.toString()
  return `${path}${text ? `?${text}` : ''}${hash === undefined ? '' : `#${hash}`}`
}

export function plannedWalkMinutes(route) {
  return calculateMissionSchedule(route).total
}

// version: 'rover' when the route starts with a rover drive (Planning's "With rover"), otherwise 'foot'.
export function scenarioEvents(route, seed) {
  return randomEvents({
    seed,
    eva: route.mission.id.replace(/^EVA-/, ''),
    version: route.mission.drive_out_minutes ? 'rover' : 'foot',
    durationMinutes: plannedWalkMinutes(route),
  })
}
