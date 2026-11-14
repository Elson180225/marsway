// Walk-screen way home on the real terrain: Mia's pre-calculated home file vs Nigel's A*.
// Run from app/:  node src/terrainNavigation.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTerrainRoute } from './terrainRoute.js'
import { createTerrainNavigation } from './terrainNavigation.js'
import { routeLeg } from './pathfinding/astar.js'
import { decodeHomeFile } from './safezone/homeFile.js'
import { pointAlong } from './screens/Walk/walk-model.js'

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url))
const json = (path) => JSON.parse(read(path))

let route, grid, homeFile
try {
  ;({ route, grid } = buildTerrainRoute(json('routes/sample-route.json'), json('terrain/area.json'),
    { elevation: json('terrain/elevation.json'), slope: json('terrain/slope.json'), roughness: json('terrain/roughness.json') },
    json('routes/science-stops.json')))
  homeFile = decodeHomeFile(json('safezone/home-h1-6km.json'), read('safezone/home-h1-6km.bin'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  console.log('Skipped: terrain or home files not in this workspace.')
  process.exit(0)
}
const home = route.stops[0]
const timed = (fn) => { const t = performance.now(); const value = fn(); return [value, performance.now() - t] }

// 1. The file matches this terrain, so the phone uses it instead of searching.
const [fromFile, checkMs] = timed(() => createTerrainNavigation(route, grid, { homeFile }))
const [fromTerrain, searchMs] = timed(() => createTerrainNavigation(route, grid))
assert.equal(fromFile.source, 'home file')
assert.equal(fromTerrain.source, 'terrain')

// 2. Along every leg, the way home agrees with Nigel's A* and starts and ends in the right places.
let worst = 0
let calls = 0
let callMs = 0
for (const leg of route.legs) {
  for (let k = 1; k < 40; k++) {
    const { point } = pointAlong(leg.path, k / 40)
    const expected = routeLeg(grid, point, home)
    for (const nav of [fromFile, fromTerrain]) {
      const [got, ms] = timed(() => nav.homeFrom(point))
      calls++
      callMs += ms
      worst = Math.max(worst, Math.abs(got.seconds - expected.seconds))
      assert.deepEqual(got.path[0], { x: point.x, y: point.y })
      assert.deepEqual(got.path.at(-1), { x: home.x, y: home.y })
      assert.ok(Array.isArray(got.warnings))
      assert.ok(got.distance_m > 0 && Math.abs(got.walk_minutes - got.seconds / 60) < 1e-12)
    }
  }
}
assert.ok(worst < 0.5, `way home differs from A* by ${worst.toFixed(3)} s`)

// 3. A file that doesn't match is never used: the phone works the way home out itself.
const changedTerrain = { ...grid, elevation: grid.elevation.slice() }
for (let row = 295; row < 305; row++) for (let col = 295; col < 305; col++) changedTerrain.elevation[row * grid.width + col] += 2 // 50 m patch raised 2 m
const rejected = {
  'another habitat': { ...homeFile, habitatCell: homeFile.habitatCell + 1 },
  'old suit numbers': { ...homeFile, stale: true },
}
for (const [why, file] of Object.entries(rejected)) {
  assert.equal(createTerrainNavigation(route, grid, { homeFile: file }).source, 'terrain', why)
}
assert.equal(createTerrainNavigation(route, changedTerrain, { homeFile }).source, 'terrain', 'changed terrain')
assert.equal(createTerrainNavigation(route, grid, { homeFile: null }).source, 'terrain', 'missing file')

console.log(`Way home passed: home file used (checked in ${checkMs.toFixed(0)} ms vs ${searchMs.toFixed(0)} ms to search), `
  + `matches A* within ${worst.toFixed(3)} s at ${calls} spots, ${(callMs / calls).toFixed(2)} ms per lookup; `
  + 'wrong habitat, old suit numbers, changed terrain and a missing file all fall back to searching.')
