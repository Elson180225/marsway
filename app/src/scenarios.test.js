import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildScenarioRoute, localFromProjected } from './terrainRoute.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { createTerrainNavigation } from './terrainNavigation.js'
import { decodeHomeFile } from './safezone/homeFile.js'

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const [template, area, elevation, slope, roughness, catalog, track] = await Promise.all([
  json('../public/routes/sample-route.json'), json('../public/terrain/area.json'),
  json('../public/terrain/elevation.json'), json('../public/terrain/slope.json'), json('../public/terrain/roughness.json'),
  json('../public/routes/scenarios.json'), json('../public/terrain/curiosity_track.json'),
])
const terrain = { elevation, slope, roughness }
const usable = template.mission.max_walk_minutes - template.mission.reserve_minutes

// The picker lists the two built-in walks first, then one scenario per habitat.
assert.deepEqual(catalog.scenarios.map((s) => s.eva), ['07', '08', '09', '10', '11', '12'])
assert.deepEqual(new Set(catalog.scenarios.slice(2).map((s) => s.habitat)), new Set(['H1', 'H2', 'H3', 'H4']))
assert.equal(new Set(catalog.scenarios.map((s) => s.id)).size, catalog.scenarios.length, 'scenario ids are unique')

// H1 here must be the same point as the confirmed H1 used by EVA-07.
assert.deepEqual(localFromProjected(area, catalog.habitats.H1), { x: 1047.5, y: 917.5 })
// H2-H4 are the flat-site candidates in area.json.
for (const [id, k] of [['H2', 0], ['H3', 1], ['H4', 2]]) {
  const { x, y } = localFromProjected(area, catalog.habitats[id])
  assert.deepEqual([x, y], [area.habitatCandidates[k].x, area.habitatCandidates[k].y], `${id} matches habitatCandidates[${k}]`)
}

const bySol = new Map(track.points.map((p) => [p.sol, p]))
for (const scenario of catalog.scenarios.filter((s) => s.stops)) {
  // Every stop is a real Curiosity waypoint at its recorded position.
  for (const stop of scenario.stops) {
    const p = bySol.get(stop.waypoint_sol)
    assert.ok(p, `${scenario.id} ${stop.id}: sol ${stop.waypoint_sol} is a Curiosity waypoint`)
    const { x, y } = localFromProjected(area, stop)
    assert.ok(Math.hypot(x - p.x, y - p.y) < 0.01, `${scenario.id} ${stop.id} sits on its waypoint`)
  }
  assert.equal(scenario.stops.filter((s) => s.is_bonus).length, 1, `${scenario.id} has one bonus stop`)
  assert.equal(scenario.stops.at(-1).id, scenario.bonus_stop_id, `${scenario.id} bonus stop is last`)

  const { route, grid } = buildScenarioRoute(template, area, terrain, catalog, scenario.eva)
  // The Walk screen loads this habitat's pre-calculated way home; it must match this terrain.
  const base = `../public/safezone/home-${scenario.habitat.toLowerCase()}-6km`
  const homeFile = decodeHomeFile(await json(`${base}.json`), await readFile(new URL(`${base}.bin`, import.meta.url)))
  assert.equal(createTerrainNavigation(route, grid, { homeFile }).source, 'home file', `${base} matches ${scenario.id}: rebuild with buildHomeFile.js`)
  assert.equal(route.mission.id, scenario.id)
  assert.equal(route.mission.home_label, scenario.habitat)
  assert.equal(route.stops[0].habitat_id, scenario.habitat)
  assert.ok(route.stops.every((s) => !s.moved_m), `${scenario.id}: no stop had to be moved off no-go ground`)
  const plan = calculateMissionSchedule(route)
  assert.ok(plan.total <= usable, `${scenario.id} fits the usable suit time (${Math.round(plan.total)} of ${usable} min)`)
  assert.ok(plan.margin >= 60, `${scenario.id} leaves at least an hour spare`)
  console.log(`${scenario.id} from ${scenario.habitat}: walk ${Math.round(plan.walking)} + science ${plan.science} = ${Math.round(plan.total)} min, ${Math.round(plan.margin)} min spare`)
}

assert.throws(() => buildScenarioRoute(template, area, terrain, catalog, '99'), /EVA-99 has no stop list/)
assert.throws(() => buildScenarioRoute(template, area, terrain, catalog, '07'), /EVA-07 has no stop list/, 'built-in walks are not rebuilt from the catalog')
console.log('Scenario catalog passed: EVA-09 to EVA-12 route on the 6 km map from H1-H4.')
