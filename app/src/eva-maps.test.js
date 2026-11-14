// EVA-07 and EVA-08 on the shared 6 km map (Planning screen).
// Run from the app folder: node src/eva-maps.test.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadTerrainRoute, MISSIONS } from './terrainRoute.js'

const publicDir = new URL('../public/', import.meta.url)
const fetcher = async (url) => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(url.slice(1), publicDir), 'utf8')) })
const summary = ({ route }) => ({
  stops: route.stops.map((stop) => stop.id),
  legs: route.legs.map((leg) => leg.walk_minutes),
  returns: route.returns.map((item) => item.walk_minutes),
  metres: route.legs.reduce((sum, leg) => sum + leg.distance_m, 0),
})

// Both Planning missions use the same 6 km map.
assert.deepEqual(Object.keys(MISSIONS), ['EVA-07', 'EVA-08'])
assert.equal(MISSIONS['EVA-07'].terrain, MISSIONS['EVA-08'].terrain)

const old07 = await loadTerrainRoute(fetcher) // no mission: the original 3 km EVA-07 (Walk screen)
const new07 = await loadTerrainRoute(fetcher, 'EVA-07')
const eva08 = await loadTerrainRoute(fetcher, 'EVA-08')
assert.equal(old07.grid.width, 600)
assert.equal(new07.grid.width, 1200)
assert.equal(eva08.grid.width, 1200)

// EVA-07 is the same walk on either map: the 6 km map is the 3 km map plus more around it.
assert.deepEqual(summary(new07), summary(old07), 'EVA-07 must not change when it moves to the 6 km map')
for (const [index, stop] of old07.route.stops.entries()) {
  const moved = new07.route.stops[index]
  assert.ok(Math.abs(moved.x - (stop.x + 600)) < 0.2 && Math.abs(moved.y - (stop.y + 400)) < 0.2, `${stop.id} not shifted by +600, +400`)
}
assert.equal(new07.route.stops[0].name, 'Habitat (H1)')
assert.deepEqual([new07.route.stops[0].x, new07.route.stops[0].y], [1047.5, 917.5])

// EVA-08: the four Gediz stops from the rover at G2, none moved off its Curiosity waypoint.
const s08 = summary(eva08)
assert.deepEqual(s08.stops, ['hab', 'mineral-king', 'sulfur-crystals', 'kings-canyon', 'channel-panorama', 'home'])
assert.equal(eva08.route.stops[0].name, 'Rover at G2')
assert.deepEqual([eva08.route.stops[0].x, eva08.route.stops[0].y], [3192.5, 3542.5])
assert.deepEqual(s08.legs, [17, 13, 4, 11, 10])
assert.deepEqual(s08.returns.slice(1, 5), [15, 18, 19, 10])
for (const route of [new07.route, eva08.route]) assert.ok(route.stops.every((stop) => !stop.moved_m), `${route.mission.id}: a stop was snapped`)
assert.equal(eva08.route.stops.filter((stop) => stop.is_bonus).map((stop) => stop.id).join(), 'channel-panorama')

console.log(`EVA maps passed: EVA-07 identical on the 3 km and 6 km maps (${(s08 && summary(new07).metres / 1000).toFixed(2)} km), EVA-08 ${(s08.metres / 1000).toFixed(2)} km from the rover at G2, both on one 6 km map.`)
