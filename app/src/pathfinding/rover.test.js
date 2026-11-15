// Rover driving and parking spots. Run from the app folder:  node src/pathfinding/rover.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeGrid, gridFileFromRows, cellToXY, xyToCell } from './walkingTime.js'
import { findPathCells } from './astar.js'
import { ROVER_RULES, driveMinutes, makeRoverGrid, driveDistanceMap, driveRoute, roverRulesFrom } from './rover.js'
import { PARKING } from './pickRoverParking.js'
import { localFromProjected } from '../terrainRoute.js'

const ok = (msg) => console.log('  ok  ' + msg)

// ---------- 1. Drive time ----------
console.log('Drive time')
assert.equal(driveMinutes(5000), 70) // 5 km at 5 km/h = 60 min, plus 10 min on and off
assert.equal(driveMinutes(0), 10)
assert.throws(() => driveMinutes(-1))
ok('5 km = 60 min driving + 10 min on and off')

// ---------- 2. Pretend grid: walkable 20° slope the rover must go around ----------
console.log('\nPretend grid (10 m cells): a 20° band with a gentle gap at row 9')
const W = 30
const H = 12
const slopeRows = []
for (let r = 0; r < H; r++) slopeRows.push(Array.from({ length: W }, (_, c) => (c >= 12 && c <= 14 && r !== 9 ? 20 : 2)))
const flatRows = slopeRows.map((row) => row.map(() => 0))
const toy = makeGrid({ elevation: gridFileFromRows(flatRows, 10), slope: gridFileFromRows(slopeRows, 10) })
const from = cellToXY(toy, 2 * W + 2)
const to = cellToXY(toy, 2 * W + 27)
assert.ok(!toy.blocked.some(Boolean), 'people can walk on 20°')
const walk = findPathCells(toy, xyToCell(toy, from.x, from.y), xyToCell(toy, to.x, to.y))
const drive = driveRoute(toy, from, to)
const roverToy = makeRoverGrid(toy)
assert.ok(drive, 'the rover finds the gap')
assert.ok(drive.max_slope_deg <= ROVER_RULES.maxSlopeDeg, 'the rover never drives over 15°')
assert.ok(walk.cells.some((i) => toy.slope[i] > 15), 'walking goes straight over the band')
assert.ok(drive.distance_m > 250, `the drive detours through the gap (${drive.distance_m} m)`)
const map = driveDistanceMap(roverToy, xyToCell(toy, from.x, from.y))
assert.ok(Math.abs(map[xyToCell(toy, to.x, to.y)] - drive.distance_m) < 1, 'A* drive = Dijkstra distance map')
assert.deepEqual([drive.path[0], drive.path.at(-1)], [from, to])
ok(`drive ${drive.distance_m} m through the gap (walking goes straight over), ${drive.minutes.toFixed(1)} min`)
const walled = makeGrid({ elevation: gridFileFromRows(flatRows, 10), slope: gridFileFromRows(slopeRows.map((row) => row.map((v, c) => (c >= 12 && c <= 14 ? 20 : v))), 10) })
assert.equal(driveRoute(walled, from, to), null)
ok('no gap: no drive (null)')

// ---------- 3. Real parking spots (public/routes/rover-parking.json) ----------
console.log('\nRover parking spots on the 6 km map')
const pub = new URL('../../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
const area = load('terrain/area.json')
const parking = load('routes/rover-parking.json')
const catalog = load('routes/scenarios.json')
const grid = makeGrid({ elevation: load('terrain/elevation.json'), slope: load('terrain/slope.json'), roughness: load('terrain/roughness.json') })
const rules = roverRulesFrom(parking)
assert.deepEqual(rules, ROVER_RULES, 'rover-parking.json rules match the team rules')
const roverGrid = makeRoverGrid(grid, rules)
for (const entry of parking.evas) {
  const spot = entry.spot
  assert.ok(spot, `EVA-${entry.eva} has a parking spot`)
  const habitat = localFromProjected(area, catalog.habitats[entry.habitat])
  const at = localFromProjected(area, spot)
  const route = driveRoute(grid, habitat, at, rules, roverGrid)
  assert.ok(route, `EVA-${entry.eva}: the rover can drive from ${entry.habitat} to ${spot.id}`)
  if (!spot.chosen_by) { ok(`EVA-${entry.eva} ${spot.id}: chosen by hand, rover route ${route.distance_m} m`); continue }
  const cell = xyToCell(grid, at.x, at.y)
  assert.ok(grid.slope[cell] <= PARKING.flatDeg, `${spot.id} is flat`)
  assert.ok(Math.abs(route.distance_m - spot.drive_distance_m) <= 1, `${spot.id} drive_distance_m matches the route`)
  assert.ok(Math.abs(route.minutes - spot.drive_minutes) <= 0.1, `${spot.id} drive_minutes matches the route`)
  assert.ok(route.max_slope_deg <= rules.maxSlopeDeg, `${spot.id} drive stays at or under ${rules.maxSlopeDeg}°`)
  assert.deepEqual(spot.drive_path[0], [catalog.habitats[entry.habitat].easting, catalog.habitats[entry.habitat].northing], `${spot.id} drive starts at the habitat`)
  assert.deepEqual(spot.drive_path.at(-1), [spot.easting, spot.northing], `${spot.id} drive ends at the spot`)
  ok(`EVA-${entry.eva} ${spot.id}: ${grid.slope[cell].toFixed(1)}° flat, drive ${spot.drive_distance_m} m / ${spot.drive_minutes} min, max ${route.max_slope_deg.toFixed(1)}°`)
}
console.log('\nRover tests passed.')
