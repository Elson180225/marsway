// EVA-07 and EVA-08 as the Planning screen's EVA picker loads them (?eva=07 / ?eva=08), both on the
// 6 km map. Covers what gedizPlanning.test.js and scenarios.test.js don't: EVA-07's times on the
// 6 km map, the walk back to the rover on EVA-08, stops staying on their waypoints, and the
// pre-calculated home files (home-h1-6km, home-g2-6km) being used instead of a live search.
// Run from the app folder: node src/eva-07-08.test.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadRouteForEva } from './terrainRoute.js'
import { createTerrainNavigation } from './terrainNavigation.js'
import { decodeHomeFile } from './safezone/homeFile.js'

const publicDir = new URL('../public/', import.meta.url)
const json = async (path) => JSON.parse(await readFile(new URL(path, publicDir), 'utf8'))
const fetcher = async (url) => ({ ok: true, json: () => json(url.slice(1)) })
const homeFile = async (name) => decodeHomeFile(await json(`safezone/${name}.json`), await readFile(new URL(`safezone/${name}.bin`, publicDir)))
const minutes = (items) => items.map((item) => item.walk_minutes)
const km = (route) => route.legs.reduce((sum, leg) => sum + leg.distance_m, 0) / 1000

const [eva07, eva08] = await Promise.all([loadRouteForEva('07', fetcher), loadRouteForEva('08', fetcher)])
const [boxwork, gediz] = await Promise.all([json('routes/science-stops.json'), json('routes/gediz-stops.json')])

// Both EVAs on the same 6 km map.
for (const { route, grid } of [eva07, eva08]) assert.deepEqual([grid.width, grid.height, grid.sizeX], [1200, 1200, 6000], `${route.mission.id} on the 6 km map`)

// EVA-07: from H1, the same walk and times as on the old 3 km map.
const r07 = eva07.route
assert.equal(r07.mission.id, 'EVA-07')
assert.deepEqual([r07.stops[0].x, r07.stops[0].y], [1047.5, 917.5], 'H1 on the 6 km map')
assert.deepEqual(r07.stops.map((s) => s.id), ['hab', 'boxwork-lookout', 'ridge-sample', 'hollow-comparison', 'mineral-investigation', 'home'])
assert.deepEqual(minutes(r07.legs), [50, 2, 7, 11, 71])
assert.deepEqual(minutes(r07.returns).slice(1, -1), [53, 52, 60, 71], 'EVA-07 times home to H1')
assert.equal(r07.stops.filter((s) => s.is_bonus).map((s) => s.id).join(), 'mineral-investigation')
assert.ok(!r07.mission.drive_out_minutes && !r07.mission.drive_home_minutes, 'EVA-07 is on foot: no drive')

// EVA-08: from the rover at G2, with the 55 min drive each way.
const r08 = eva08.route
assert.equal(r08.mission.id, 'EVA-08')
assert.deepEqual([r08.stops[0].x, r08.stops[0].y], [3192.5, 3542.5], 'rover at G2')
assert.deepEqual(r08.stops.map((s) => s.id), ['g2', 'mineral-king', 'sulfur-crystals', 'kings-canyon', 'channel-panorama', 'home'])
assert.deepEqual(minutes(r08.legs), [17, 13, 4, 11, 10])
assert.deepEqual(minutes(r08.returns).slice(1, -1), [15, 18, 19, 10], 'EVA-08 walks back to the rover')
assert.equal(r08.stops.filter((s) => s.is_bonus).map((s) => s.id).join(), 'channel-panorama')
assert.deepEqual([r08.mission.drive_out_minutes, r08.mission.drive_home_minutes], [55, 55], 'EVA-08 keeps the 55 min drive each way')

// Every science stop is exactly where the reviewed stop file puts it (on its Curiosity waypoint).
for (const [route, source] of [[r07, boxwork], [r08, gediz]]) {
  for (const stop of source.stops) {
    const placed = route.stops.find((s) => s.id === stop.id)
    assert.deepEqual([placed?.x, placed?.y], [stop.x, stop.y], `${route.mission.id} ${stop.id} moved off its waypoint`)
  }
}

// The phone uses the pre-calculated way home on both, not a live search.
for (const [{ route, grid }, name] of [[eva07, 'home-h1-6km'], [eva08, 'home-g2-6km']]) {
  const source = createTerrainNavigation(route, grid, { homeFile: await homeFile(name) }).source
  assert.equal(source, 'home file', `${name} does not match ${route.mission.id}: rebuild with buildHomeFile.js`)
}

console.log(`EVA-07 / EVA-08 passed: both on the 6 km map; EVA-07 ${km(r07).toFixed(2)} km from H1, EVA-08 ${km(r08).toFixed(2)} km from the rover at G2 ` +
  '(55 min drive each way); stops on their waypoints; home-h1-6km and home-g2-6km used.')
