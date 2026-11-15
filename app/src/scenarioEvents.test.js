// One scenario number, same events on Planning and Walk. Run from app/: node src/scenarioEvents.test.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadRouteForEva } from './terrainRoute.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { planningTravelVersions } from './planningTravel.js'
import { plannedWalkMinutes, scenarioEvents, scenarioFromSearch, withScenario } from './scenarioEvents.js'

// The number in the link.
assert.equal(scenarioFromSearch('?eva=07&scenario=4821'), 4821)
assert.equal(scenarioFromSearch('?scenario=7'), 7)
for (const bad of ['', '?eva=07', '?scenario=0', '?scenario=10000', '?scenario=abc', '?scenario=12.5', '?scenario=-4']) {
  assert.equal(scenarioFromSearch(bad), null, `${bad || 'no link'}: no scenario`)
}
assert.equal(withScenario('/walk.html?eva=07', 4821), '/walk.html?eva=07&scenario=4821')
assert.equal(withScenario('/?eva=07&scenario=4', 4821), '/?eva=07&scenario=4821')
assert.equal(withScenario('/?eva=07&scenario=4', null), '/?eva=07')
assert.equal(withScenario('/', 8), '/?scenario=8')
assert.equal(withScenario('/', null), '/')
assert.equal(withScenario('/walk.html?eva=09#data', 4), '/walk.html?eva=09&scenario=4#data')

// The same walk length and events on both screens, for every EVA. Walk loads the route straight from
// loadRouteForEva(); Planning shows its travel version (on foot, or with rover for EVA-08).
const pub = new URL('../public/', import.meta.url)
const json = async (path) => JSON.parse(await readFile(new URL(path, pub), 'utf8'))
const fetcher = async (url) => ({ ok: true, json: () => json(url.slice(1)) })
const [area, catalog, parking] = await Promise.all(['terrain/area.json', 'routes/scenarios.json', 'routes/rover-parking.json'].map(json))
const order = (result) => result.events.map((e) => e.type).filter((type) => type !== 'rover_breakdown')
const lengths = []
for (const eva of ['07', '08', '09', '10', '11', '12']) {
  const walk = (await loadRouteForEva(eva, fetcher)).route
  const versions = planningTravelVersions(await loadRouteForEva(eva, fetcher), area, catalog, parking)
  const planning = versions[versions.defaultMode]
  assert.equal(plannedWalkMinutes(walk), calculateMissionSchedule(walk).total)
  assert.equal(plannedWalkMinutes(walk), plannedWalkMinutes(planning), `EVA-${eva}: same walk length on both screens`)
  assert.equal(scenarioEvents(planning, 4).version, versions.defaultMode, `EVA-${eva}: Planning's travel version`)
  for (const seed of [4, 7, 8, 4821, 551]) {
    assert.deepEqual(scenarioEvents(walk, seed), scenarioEvents(planning, seed), `EVA-${eva} #${seed}: same events on both screens`)
  }
  // Mia's README demo scenarios.
  assert.deepEqual(order(scenarioEvents(walk, 4)), ['dust_storm', 'dust_devil'], `EVA-${eva} #4: dust storm, then a dust devil`)
  assert.equal(scenarioEvents(walk, 7).cancelled, true, `EVA-${eva} #7: global storm, walk cancelled`)
  assert.equal(scenarioEvents(walk, 8).calm, true, `EVA-${eva} #8: calm day`)
  assert.deepEqual(order(scenarioEvents(walk, 4821)), ['dust_devil', 'dust_storm'], `EVA-${eva} #4821: dust devil, then a dust storm`)
  lengths.push(`EVA-${eva} ${plannedWalkMinutes(walk).toFixed(1)} min`)
}

console.log(`Scenario events passed: same walk length and events on Planning and Walk (${lengths.join(', ')}); README scenarios #4, #7, #8, #4821 hold on every EVA.`)
