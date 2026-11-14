import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildTerrainRoute, loadTerrainRoute } from './terrainRoute.js'
import { createTerrainNavigation } from './terrainNavigation.js'
import { routeLeg } from './pathfinding/astar.js'
import { buildReturnTrip, currentTrip, minutesHome, pointAlong, safetyStatus } from './screens/Walk/walk-model.js'

const file = (data = Array(400).fill(0)) => ({ width: 20, height: 20, cellSize: 100, data })
const terrain = { elevation: file(Array.from({ length: 400 }, (_, i) => (i % 20) * 10)), slope: file(), roughness: file() }
const template = { schema_version: 1, coordinate_system: { unit: 'meter', origin_note: 'old sample' }, mission: { id: 'TEST', start_time: '2026-11-14T08:00:00Z', max_walk_minutes: 480, reserve_minutes: 120, latest_turnback_time: '2026-11-14T14:00:00Z' } }
const area = { habitatCandidates: [{ x: 1732.5, y: 142.5 }, { x: 447.5, y: 517.5 }], source: 'Synthetic test fixture', localCoords: 'Local metres' }
const { route, grid } = buildTerrainRoute(template, area, terrain)
const navigation = createTerrainNavigation(route, grid)
assert.equal(route.mission.latest_turnback_time, null)
assert.equal(route.mission.data_status, 'TERRAIN_ESTIMATE')
assert.equal(route.stops[0].x, 447.5)
assert.equal(route.stops[0].y, 517.5)
const reordered = buildTerrainRoute(template, { ...area, habitatCandidates: [...area.habitatCandidates].reverse() }, terrain).route
assert.deepEqual(reordered.stops[0], route.stops[0], 'candidate order must not change H1')
assert.throws(() => buildTerrainRoute(template, { ...area, habitatCandidates: [{ x: 1732.5, y: 142.5 }] }, terrain), /Confirmed H1/, 'missing H1 must fail without fallback')
assert.equal(route.coordinate_system.origin_note, 'Local metres')
assert.equal(route.provenance.target_status, 'pending')
assert.equal(template.mission.latest_turnback_time, '2026-11-14T14:00:00Z')
assert.notEqual(route.legs[0].seconds, route.legs[1].seconds, 'uphill and downhill times differ')

const state = { mode: 'outbound', legIndex: 0, progress: 0.5, returnTrip: null }
const point = pointAlong(route.legs[0].path, state.progress).point
const actualHome = routeLeg(grid, point, route.stops[0])
assert.ok(Math.abs(minutesHome(route, state, navigation) - actualHome.seconds / 60) < 1e-9)
const tripHome = buildReturnTrip(route, state, navigation)
assert.deepEqual(tripHome.path[0], point, 'return starts at current simulated point')
assert.deepEqual(tripHome.path.at(-1), { x: 447.5, y: 517.5 })
assert.ok(Math.abs(tripHome.walk_minutes - actualHome.seconds / 60) < 1e-9)
assert.notEqual(tripHome.walk_minutes, state.progress * route.legs[0].walk_minutes, 'return does not reuse outbound minutes')

const suitEnd = Date.parse(template.mission.start_time) + template.mission.max_walk_minutes * 60000
const clock = suitEnd - (template.mission.reserve_minutes + tripHome.walk_minutes + 5) * 60000
assert.ok(Math.abs(safetyStatus(route, state, clock, navigation).turnbackIn - 5) < 1e-7)
assert.equal(safetyStatus(route, state, suitEnd, navigation).level, 'danger')
assert.equal(minutesHome(route, { ...state, mode: 'complete' }, navigation), 0)
assert.equal(currentTrip(route, { ...state, mode: 'complete' }).to.type, 'home')
assert.ok(navigation.homeFrom({ x: 448.5, y: 517.5 }).walk_minutes > 0, 'final same-cell metres have a positive estimate')
assert.equal(navigation.homeFrom({ x: 447.5, y: 517.5 }).walk_minutes, 0)
assert.throws(() => navigation.homeFrom({ x: -1, y: 150 }), /walkable/)

const science = { status: 'ready', stops: [{ id: 'kelly-1', name: 'Science fixture', x: 650, y: 250, description: 'Fixture only', photo_url: '/photos/fixture.jpg' }] }
const ready = buildTerrainRoute(template, area, terrain, science).route
assert.deepEqual(ready.stops.map((s) => s.id), ['hab', 'kelly-1', 'home'])
assert.equal(ready.stops[1].photo_url, '/photos/fixture.jpg')
assert.equal(ready.provenance.target_status, 'ready')
assert.throws(() => buildTerrainRoute(template, area, terrain, { status: 'ready', stops: [] }), /empty/)
assert.throws(() => buildTerrainRoute(template, area, terrain, { ...science, stops: [...science.stops, ...science.stops] }), /unique/)
assert.throws(() => buildTerrainRoute(template, area, terrain, { ...science, stops: [{ ...science.stops[0], x: 2000 }] }), /in-bounds/)
assert.throws(() => buildTerrainRoute(template, area, terrain, { status: 'pending', stops: science.stops }), /ready/)
assert.throws(() => buildTerrainRoute({ ...template, alerts: [{ level: 'danger', shelter_stop_id: 'missing' }] }, area, terrain), /shelter/)
assert.throws(() => buildTerrainRoute(template, area, { ...terrain, slope: { ...file(), cellSize: 5 } }), /aligned/)
await assert.rejects(loadTerrainRoute(async () => ({ ok: false, status: 404 })), /404/)
console.log('Shared-route tests passed: directional returns, reserve budget, complete state, science stops and failure handling.')

// Also test the actual JSON grids installed on this laptop. No browser or network required.
const publicDir = new URL('../public/', import.meta.url)
const fetchLocal = async (url) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(url.replace(/^\//, ''), publicDir), 'utf8')) })
try {
  const { route: real, grid: realGrid } = await loadTerrainRoute(fetchLocal)
  const nav = createTerrainNavigation(real, realGrid)
  for (let k = 0; k < real.legs.length; k++) {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const s = { mode: 'outbound', legIndex: k, progress, returnTrip: null }
      assert.ok(Number.isFinite(minutesHome(real, s, nav)), 'real-route return estimate must be finite')
    }
  }
  console.log(`Real terrain passed: ${real.stops.length} stops, ${real.legs.length} legs; H1 (${real.stops[0].x}, ${real.stops[0].y}).`)
} catch (error) {
  // Fixture-only workspaces may lack terrain. Any other failure is a test failure.
  if (error.code !== 'ENOENT') throw error
  console.log('Real-terrain check skipped: public terrain files not supplied in this workspace.')
}
