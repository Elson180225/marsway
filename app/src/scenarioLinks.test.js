// Planning and Walk show the same random events for one scenario number (Mia's README, "Random events").
// Run from the app folder:  node src/scenarioLinks.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRouteForEva } from './terrainRoute.js'
import { planningTravelVersions } from './planningTravel.js'
import { scenarioEvents, scenarioFromSearch, withScenario, plannedWalkMinutes } from './scenarioEvents.js'

const ok = (msg) => console.log('  ok  ' + msg)
const pub = new URL('../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
const fetcher = async (url) => ({ ok: true, json: async () => load('.' + url) })

// ---------- 1. The number survives every Planning link ----------
console.log('Scenario number in the links')
const seed = scenarioFromSearch('?eva=07&scenario=4821')
assert.equal(seed, 4821)
for (const link of ['/?eva=09', '/?eva=09&travel=foot', '/?eva=09&travel=rover', '/walk.html?eva=09']) {
  const href = withScenario(link, seed)
  assert.equal(scenarioFromSearch(href.slice(href.indexOf('?'))), 4821, href)
  assert.ok(href.startsWith(link), `${href} keeps eva and travel`)
}
assert.equal(withScenario('/?eva=09&travel=rover', null), '/?eva=09&travel=rover', 'no scenario: link unchanged')
ok('EVA buttons, On foot / With rover and the Walk link all keep ?scenario=4821')

// ---------- 2. Same walk length, same events, on both screens ----------
console.log('\nPlanning (On foot) and Walk build the same events')
const area = load('terrain/area.json')
const catalog = load('routes/scenarios.json')
const parking = load('routes/rover-parking.json')
for (const eva of ['07', '09', '10', '11', '12']) { // EVA-08 has no Walk screen yet
  const initial = await loadRouteForEva(eva, fetcher) // what Walk loads
  const planning = planningTravelVersions(initial, area, catalog, parking).foot // what Planning shows On foot
  const walk = initial.route
  const minutes = plannedWalkMinutes(walk)
  assert.equal(plannedWalkMinutes(planning), minutes, `EVA-${eva}: same walk length`)
  let busy = 0
  for (let s = 1; s <= 500; s++) {
    const p = scenarioEvents(planning, s)
    assert.deepEqual(p, scenarioEvents(walk, s), `EVA-${eva} scenario #${s}: same events`)
    if (p.events.length) busy++
  }
  assert.equal(scenarioEvents(planning, 4821).version, 'foot')
  ok(`EVA-${eva}: ${minutes.toFixed(1)} min on both screens; 500 scenarios identical (${busy} with events)`)
}

console.log('\nScenario link tests passed.')
