import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadRouteForEva } from './terrainRoute.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { plannedCsv } from './planningCsv.js'
import { planningTravelVersions, travelComparison } from './planningTravel.js'

const pub = new URL('../public/', import.meta.url)
const json = async (path) => JSON.parse(await readFile(new URL(path, pub), 'utf8'))
const fetcher = async (url) => {
  assert.ok(!url.includes('/safezone/'), 'Planning should not fetch every rover home file')
  return { ok: true, json: () => json(url.slice(1)) }
}
const [area, catalog, parking] = await Promise.all(['terrain/area.json', 'routes/scenarios.json', 'routes/rover-parking.json'].map(json))
for (const eva of ['07', '08', '09', '10', '11', '12']) {
  const initial = await loadRouteForEva(eva, fetcher)
  const versions = planningTravelVersions(initial, area, catalog, parking)
  assert.equal(versions.defaultMode, eva === '08' ? 'rover' : 'foot')
  if (eva !== '08') assert.equal(versions.rover.stops[0].rover_parking, true)
  for (const mode of ['foot', 'rover']) {
    const route = versions[mode]
    assert.equal(route.stops.length, initial.route.stops.length)
    assert.deepEqual(route.stops.slice(1, -1).map((s) => s.id), initial.route.stops.slice(1, -1).map((s) => s.id))
    assert.ok(route.returns.every((r) => r.path.length), `${eva} ${mode} can return`)
    assert.ok(calculateMissionSchedule(route).margin >= 0, `${eva} ${mode} preserves reserve`)
  }
  assert.ok(travelComparison(versions).startsWith('With rover:'))
}
const eva08 = planningTravelVersions(await loadRouteForEva('08', fetcher), area, catalog, parking)
assert.deepEqual([eva08.rover.mission.drive_out_minutes, eva08.rover.mission.drive_home_minutes], [56, 56])
assert.equal(Math.round(calculateMissionSchedule(eva08.foot).margin), 3)
assert.match(plannedCsv(eva08.rover).timeline, /planned_drive_arrival/)
console.log('Planning travel versions passed: six defaults, both routes per EVA, 56 min G2 drives, selected-only data and CSV.')
