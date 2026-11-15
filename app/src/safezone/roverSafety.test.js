// Safety checks for the on-foot and with-rover versions of every EVA.
// Run from app/:  node src/safezone/roverSafety.test.js
import assert from 'node:assert/strict'
import { makeGrid, xyToCell } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { checkEvaVersion, driveMinutes, ROVER } from './roverSafety.js'
import { checkAllEvas, loadFiles } from './checkEvaVersions.js'
import { evaSetup, parkingSpot } from './evaSetup.js'
import { buildGedizRoute, buildTerrainRoute } from '../terrainRoute.js'
import { calculateMissionSchedule } from '../missionSchedule.js'

const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`)

// 1. Drive time: 5 km/h plus 10 min on/off. EVA-08's 3.8 km is 55.6 min.
close(driveMinutes(3800), 3.8 / 5 * 60 + 10, 1e-9, 'drive 3.8 km')
assert.equal(driveMinutes(0), ROVER.onOffMinutes)
assert.throws(() => driveMinutes(-1), /0 or more/)

// 2. A toy map: 2 km flat square, one steep cell. Habitat in the south-west corner.
const n = 20
const square = (data) => ({ width: n, height: n, cellSize: 100, data })
const slope = Array(n * n).fill(2)
slope[xyToCell(makeGrid({ elevation: square(Array(n * n).fill(0)) }), 1550, 1550)] = 20 // too steep for the rover, still walkable
const grid = makeGrid({ elevation: square(Array(n * n).fill(0)), slope: square(slope), roughness: square(Array(n * n).fill(0)) })
const habitat = { id: 'H', x: 50, y: 50 }
const timeHome = homeArrows(grid, xyToCell(grid, habitat.x, habitat.y)).timeHome
const stops = [{ id: 'a', name: 'Stop A', x: 1450, y: 1450, stop_minutes: 20 }]
const roomy = { max_walk_minutes: 480, reserve_minutes: 120 }

const foot = checkEvaVersion({ grid, mission: roomy, habitat, stops, timeHome })
assert.equal(foot.version, 'foot')
assert.ok(foot.ok, foot.problems.join(' '))
assert.equal(foot.driveOut, 0)
assert.equal(foot.checks.walkBack, undefined, 'no walk-back check on foot')
close(foot.total, foot.walking + 20, 1e-9, 'on foot = walking + science')

const roverAt = (parking) => ({ parking, driveDistanceM: 2000, timeToRover: homeArrows(grid, xyToCell(grid, parking.x, parking.y)).timeHome })
const near = roverAt({ id: 'P', x: 1350, y: 1350 })
const rover = checkEvaVersion({ grid, mission: roomy, habitat, stops, timeHome, rover: near })
assert.equal(rover.version, 'rover')
assert.ok(rover.ok, rover.problems.join(' '))
close(rover.driveOut, driveMinutes(2000), 1e-9, 'drive out')
close(rover.total, 2 * driveMinutes(2000) + rover.walking + 20, 1e-9, 'rover = 2 drives + walking + science')
assert.ok(rover.walking < foot.walking, 'walking from the rover is shorter')
close(rover.checks.walkBack.arriveMinutes, rover.driveOut + rover.walking + 20 + timeHome[xyToCell(grid, 1350, 1350)] / 60, 1e-9, 'walk-back: back at the rover, then walk home')
// Storm at stop A: walk to the rover, then drive home
const stormA = rover.checks.stormPlan.stops[0]
close(stormA.arriveMinutes, rover.driveOut + rover.walking - near.timeToRover[xyToCell(grid, 1450, 1450)] / 60 + 20 + stormA.walkMinutes + rover.driveHome, 1e-3, 'storm plan from stop A')

// 3. Failures are reported
const steep = checkEvaVersion({ grid, mission: roomy, habitat, stops, timeHome, rover: roverAt({ id: 'S', x: 1550, y: 1550 }) })
assert.equal(steep.checks.parking.ok, false)
assert.match(steep.problems.join(' '), /rover limit 15°/)

const short = { max_walk_minutes: 70, reserve_minutes: 20 } // 50 min before the reserve
const tight = checkEvaVersion({ grid, mission: short, habitat, stops, timeHome, rover: near })
assert.equal(tight.checks.fits.ok, false)
assert.equal(tight.checks.walkBack.level, 'fail', 'walking home 1.9 km after the loop runs past a 70 min suit')
assert.ok(tight.problems.some((p) => /breaks down/.test(p)))

// 4. The real EVAs (6 km map)
const files = loadFiles()
const results = checkAllEvas(files)
assert.deepEqual(results.map((r) => r.id), ['EVA-07', 'EVA-08', 'EVA-09', 'EVA-10', 'EVA-11', 'EVA-12'])
for (const r of results) {
  assert.ok(r.foot.checks.fits.ok, `${r.id} on foot fits the 6 h before the reserve`)
  assert.ok(r.foot.checks.stormPlan.ok, `${r.id} on foot storm plan stays inside the suit`)
}

// On foot matches the Planning schedule for EVA-07 (same planner, same stops).
const eva07 = buildTerrainRoute(files.template, files.area, files.terrain, files.boxwork).route
close(results[0].foot.total, calculateMissionSchedule(eva07).total, 1e-6, 'EVA-07 on foot = Planning schedule')

// EVA-08 with rover: parking at G2, same walk as the Planning EVA-08 route.
const eva08 = results[1]
assert.equal(eva08.parking.id, 'G2')
assert.deepEqual([eva08.parking.x, eva08.parking.y], [3192.5, 3542.5], 'G2 projected position matches the app')
assert.ok(eva08.rover.ok, eva08.rover.problems.join(' '))
assert.ok(eva08.rover.checks.parking.slopeDeg <= 15)
assert.equal(eva08.rover.checks.walkBack.level, 'ok', 'EVA-08: walking home from G2 after the loop keeps the reserve')
const gediz = calculateMissionSchedule(buildGedizRoute(files.template, files.area, files.terrain, files.gediz).route)
close(eva08.rover.walking + eva08.rover.science, gediz.walking + gediz.science, 1e-6, 'EVA-08 walk loop = Planning schedule')
// EVA-08 on foot from H1 fits, but only just (Gediz is 3.8 km away).
assert.ok(eva08.foot.spare < 30, 'EVA-08 on foot is tight')

// Spots not chosen yet are reported as waiting, not as passing.
for (const r of results.filter((x) => x.eva !== '08')) {
  assert.equal(r.rover, null)
  assert.match(r.waiting, /Nigel/)
}
assert.equal(parkingSpot('07', files), null)
assert.equal(evaSetup('10', files).habitat.id, 'H2')

console.log('Rover safety passed: drive time, on-foot and rover plans, storm plan, walk-back, parking slope; all six EVAs fit on foot; EVA-08 rover from G2 passes.')
