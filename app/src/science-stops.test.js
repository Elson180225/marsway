import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildTerrainRoute } from './terrainRoute.js'
import { xyToCell } from './pathfinding/walkingTime.js'

const publicDir = new URL('../public/', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, publicDir), 'utf8'))
const science = await readJson('routes/science-stops.json')
const expected = ['boxwork-lookout', 'ridge-sample', 'hollow-comparison', 'mineral-investigation']

assert.equal(science.status, 'ready')
assert.deepEqual(science.stops.map((stop) => stop.id), expected)
assert.deepEqual(science.stops.map((stop) => stop.order), [1, 2, 3, 4])
assert.deepEqual(science.stops.map((stop) => stop.stop_minutes), [15, 30, 30, 20])
assert.deepEqual(science.stops.filter((stop) => stop.is_bonus).map((stop) => stop.id), ['mineral-investigation'])
assert.equal(science.bonus_stop_id, 'mineral-investigation')
for (const file of ['routes/stops.json', '../../data/processed/stops.json']) {
  assert.deepEqual(await readJson(file), science, `${file} handoff is out of date`)
}
const ids = new Set()
for (const stop of science.stops) {
  assert.equal(typeof stop.id, 'string')
  assert.ok(!ids.has(stop.id) && !['hab', 'home'].includes(stop.id))
  ids.add(stop.id)
  assert.equal(typeof stop.name, 'string')
  assert.equal(stop.type, 'science_stop')
  assert.equal(stop.location_status, 'curiosity_waypoint')
  assert.ok(Number.isFinite(stop.x) && stop.x >= 0 && stop.x < 3000)
  assert.ok(Number.isFinite(stop.y) && stop.y > 0 && stop.y <= 3000)
  assert.ok(stop.description.length > 80)
  assert.ok(stop.photo_url.startsWith('/photos/') && !stop.photo_url.includes('localhost'))
  assert.ok(stop.photo_source_url.startsWith('https://science.nasa.gov/'))
  assert.ok(stop.photo_credit.startsWith('NASA/'))
  assert.ok(stop.sol && stop.camera && stop.photo_product_id && stop.waypoint_sol)
  if (stop.photo_view === 'nearby') assert.notEqual(String(stop.sol), String(stop.waypoint_sol), `${stop.id} nearby photo must keep its own sol`)
  else assert.equal(String(stop.sol), String(stop.waypoint_sol))
  const photo = await readFile(new URL(stop.photo_url.slice(1), publicDir))
  assert.ok(photo.length > 20000 && photo.length < 1_500_000, `${stop.id} photo size ${photo.length}`)
  assert.deepEqual([photo[0], photo[1]], [0xff, 0xd8], `${stop.id} photo is not a JPEG`)
}
assert.equal(science.stops[0].photo_view, 'nearby')
assert.equal(science.stops[1].photo_view, undefined)
assert.equal(science.stops[2].photo_view, 'nearby')
assert.equal(science.stops[3].photo_view, 'nearby')
assert.ok(Math.hypot(science.stops[0].x - science.stops[1].x, science.stops[0].y - science.stops[1].y) > 50)
assert.ok(Math.hypot(science.stops[1].x - science.stops[2].x, science.stops[1].y - science.stops[2].y) > 150)
assert.ok(Math.hypot(science.stops[2].x - science.stops[3].x, science.stops[2].y - science.stops[3].y) > 150)

const template = {
  schema_version: 1,
  coordinate_system: { unit: 'meter' },
  mission: { id: 'EVA-07', name: 'The Boxwork Walk', site: 'Gale Crater', start_time: '2026-11-14T08:00:00Z', max_walk_minutes: 480, reserve_minutes: 120 },
}
const [area, elevation, slope, roughness] = await Promise.all([
  readJson('terrain/area.json'), readJson('terrain/elevation.json'), readJson('terrain/slope.json'), readJson('terrain/roughness.json'),
])
const { route, grid } = buildTerrainRoute(template, area, { elevation, slope, roughness }, science)
assert.deepEqual(route.stops.map((stop) => stop.id), ['hab', ...expected, 'home'])
assert.equal(route.provenance.target_status, 'ready')
assert.equal(route.stops[0].x, 447.5)
assert.equal(route.stops[0].y, 517.5)
for (const stop of route.stops.filter((stop) => stop.type === 'science_stop')) {
  const original = science.stops.find((item) => item.id === stop.id)
  for (const field of ['order', 'stop_minutes', 'is_bonus', 'photo_url', 'photo_credit', 'photo_source_url']) {
    assert.equal(stop[field], original[field], `${stop.id}: shared route lost ${field}`)
  }
  assert.equal(stop.moved_m, undefined, `${stop.id} was snapped off its waypoint`)
  const index = xyToCell(grid, stop.x, stop.y)
  assert.equal(grid.blocked[index], 0)
  assert.ok(grid.slope[index] < 15, `${stop.id} slope ${grid.slope[index]}`)
}
const outbound = route.legs.slice(0, -1)
const outboundMinutes = outbound.reduce((sum, leg) => sum + leg.walk_minutes, 0)
const homeFromMineral = route.returns.find((item) => item.from_stop_id === 'mineral-investigation')
assert.ok(outboundMinutes > 30 && outboundMinutes < 180, `outbound ${outboundMinutes} min`)
assert.ok(homeFromMineral.walk_minutes > 20 && homeFromMineral.walk_minutes < 150)
console.log(`Science-stop tests passed: 4 Curiosity waypoints, no snap, outbound ${outboundMinutes} min, return from mineral stop ${homeFromMineral.walk_minutes} min.`)
