// Walk screen: science time at stops, bonus-stop GO / NO-GO and the radiation counter.
// Run from app/:  node src/screens/Walk/walk-model.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTerrainRoute } from '../../terrainRoute.js'
import { createTerrainNavigation } from '../../terrainNavigation.js'
import { bonusStopCheck, TIGHT_MINUTES } from '../../safezone/bonusStop.js'
import { xyToCell } from '../../pathfinding/walkingTime.js'
import { advance, bonusStatus, canHeadHome, headHome, minutesBehindPlan, radiationDose, safetyStatus } from './walk-model.js'

const close = (a, b, tolerance, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`)

// A small made-up map (2 km square, ground rising to the east) with three stops. The last is the bonus.
const square = (data = Array(400).fill(0)) => ({ width: 20, height: 20, cellSize: 100, data })
const terrain = { elevation: square(Array.from({ length: 400 }, (_, i) => (i % 20) * 10)), slope: square(), roughness: square() }
const template = { schema_version: 1, coordinate_system: { unit: 'meter' }, mission: { id: 'TEST', start_time: '2026-11-14T08:00:00Z', max_walk_minutes: 480, reserve_minutes: 120 } }
const area = { habitatCandidates: [{ x: 447.5, y: 517.5 }] }
const science = {
  status: 'ready',
  stops: [
    { id: 'a', name: 'Stop A', x: 950, y: 950, stop_minutes: 15 },
    { id: 'b', name: 'Stop B', x: 1450, y: 1250, stop_minutes: 30 },
    { id: 'bonus', name: 'Bonus', x: 1650, y: 1650, stop_minutes: 20, is_bonus: true },
  ],
}
const { route, grid } = buildTerrainRoute(template, area, terrain, science)
const navigation = createTerrainNavigation(route, grid)
const safezone = { grid, timeHome: navigation.timeHome }
const start = Date.parse(template.mission.start_time)
const walk = route.legs.map((leg) => leg.seconds / 60)
const at = (legIndex, minutesOut, extra = {}) => ({ mode: 'outbound', legIndex, progress: 0, playing: false, returnTrip: null, scienceLeft: 0, clockMs: start + minutesOut * 60000, ...extra })

// 1. Arriving at a stop starts its science, which uses suit time. The walk pauses when it is done.
const sim = at(0, 0, { playing: true })
advance(route, sim, 1e6) // walks to stop A; minutes left over on arrival are not carried on
assert.deepEqual([sim.legIndex, sim.progress, sim.scienceLeft, sim.playing], [1, 0, 15, true])
close((sim.clockMs - start) / 60000, walk[0], 1e-9, 'clock on arrival at A')
advance(route, sim, 10)
assert.deepEqual([sim.scienceLeft, sim.playing], [5, true])
advance(route, sim, 60)
assert.deepEqual([sim.scienceLeft, sim.playing], [0, false])
close((sim.clockMs - start) / 60000, walk[0] + 15, 1e-9, 'clock after the science at A')

// 2. On plan, the bonus check gives the same spare time all the way to the bonus stop, and the
//    whole walk takes the planned walking + science time.
const homeFromBonus = navigation.timeHome[xyToCell(grid, 1650, 1650)] / 60
const atB = walk[0] + 15 + walk[1] + 30 // minutes out when the science at B is done, on plan
const planSpare = 360 - atB - walk[2] - 20 - homeFromBonus
assert.ok(planSpare > TIGHT_MINUTES + 5, 'fixture: the plan leaves plenty of time for the bonus stop')
const run = at(0, 0)
const phases = new Set()
for (let steps = 0; run.mode !== 'complete'; steps++) {
  assert.ok(steps < 10000, 'the walk finishes')
  const bonus = bonusStatus(route, run, run.clockMs, safezone)
  phases.add(bonus.phase)
  if (bonus.phase === 'ahead') {
    assert.equal(bonus.go, true)
    close(bonus.spareMinutes, planSpare, 1e-6, 'spare time on plan')
  }
  close(minutesBehindPlan(route, run, run.clockMs), 0, 1e-6, 'on schedule')
  run.playing = true // the crew taps "Walk to ..." whenever the walk pauses
  advance(route, run, 0.7)
}
assert.deepEqual([...phases], ['ahead', 'here', 'done'])
close((run.clockMs - start) / 60000, walk.reduce((sum, m) => sum + m) + 15 + 30 + 20, 1e-6, 'walking + science time')

// 3. At stop B the bonus stop is next: GO on plan, "GO, but tight" when running late, NO-GO when it
//    would eat into the reserve. The status line ("Skip Bonus?") agrees with the GO / NO-GO.
const decide = (late) => at(2, atB + late)
const check = (late) => bonusStatus(route, decide(late), decide(late).clockMs, safezone)
assert.equal(check(0).decideNow, true)
assert.deepEqual([check(0).go, check(0).level], [true, 'ok'])
assert.deepEqual([check(planSpare - TIGHT_MINUTES / 2).go, check(planSpare - TIGHT_MINUTES / 2).level], [true, 'caution'])
assert.deepEqual([check(planSpare + 1).go, check(planSpare + 1).level], [false, 'danger'])
close(check(planSpare + 1).spareMinutes, -1, 1e-6, 'one minute into the reserve')
for (let late = planSpare - 5.25; late < planSpare + 5; late += 0.5) {
  const state = decide(late)
  const status = safetyStatus(route, state, state.clockMs, navigation)
  assert.equal(status.nextStopOk, check(late).go, `status and GO / NO-GO agree ${late.toFixed(2)} min late`)
}
const late = safetyStatus(route, decide(planSpare + 1), decide(planSpare + 1).clockMs, navigation)
assert.ok(late.turnbackIn > 0)
assert.deepEqual([late.level, late.title], ['caution', 'Skip Bonus?'])
assert.match(late.message, /20 min of science/)
close(minutesBehindPlan(route, decide(45), decide(45).clockMs), 45, 1e-9, 'behind schedule')

// 4. Heading home before the bonus stop skips it. At the stop it is "here", then "done".
assert.equal(bonusStatus(route, at(1, 60, { mode: 'return' }), start, safezone).phase, 'skipped')
assert.equal(bonusStatus(route, at(1, 90, { mode: 'complete', progress: 1 }), start, safezone).phase, 'skipped')
assert.equal(bonusStatus(route, at(3, 200, { scienceLeft: 20 }), start, safezone).phase, 'here')
assert.equal(bonusStatus(route, at(3, 230, { progress: 0.5 }), start, safezone).phase, 'done')
assert.equal(bonusStatus(route, at(3, 300, { mode: 'complete', progress: 1 }), start, safezone).phase, 'done')
assert.equal(minutesBehindPlan(route, at(1, 60, { mode: 'return' }), start), null)

// 4b. Heading home during the bonus science makes it "incomplete", never "done", all the way home.
//     Head home clears scienceLeft, so headHome() keeps the stop whose science was cut short.
const cut = at(3, 200, { scienceLeft: 20, playing: true })
advance(route, cut, 5)
assert.equal(canHeadHome(route, cut), true, 'can cut the science at the last stop short')
headHome(route, cut, navigation)
assert.deepEqual([cut.mode, cut.scienceLeft, cut.cutShortAt], ['return', 0, 'bonus'])
assert.equal(bonusStatus(route, cut, cut.clockMs, safezone).phase, 'incomplete')
advance(route, cut, 1e6)
assert.deepEqual([cut.mode, bonusStatus(route, cut, cut.clockMs, safezone).phase], ['complete', 'incomplete'])
// Once that science is done, walking on is the way home, so Head home is off and the stop is "done".
const finished = at(3, 200, { scienceLeft: 20, playing: true })
advance(route, finished, 20)
assert.deepEqual([finished.scienceLeft, finished.playing, canHeadHome(route, finished)], [0, false, false])
// Cutting the science short at an earlier stop: the bonus stop is "skipped".
const early = at(1, 60, { scienceLeft: 10 })
headHome(route, early, navigation)
assert.deepEqual([early.cutShortAt, bonusStatus(route, early, early.clockMs, safezone).phase], ['a', 'skipped'])

// 5. A route without a bonus stop has no bonus tile.
const noBonus = buildTerrainRoute(template, area, terrain, { ...science, stops: science.stops.map((stop) => ({ ...stop, is_bonus: false })) }).route
assert.equal(bonusStatus(noBonus, at(0, 0), start, safezone), null)

// 6. Radiation: about 0.67 mSv a day, so the 6 h walking budget (8 h suit - 2 h reserve) is 0.17 mSv.
const dose = radiationDose(route, start + 6 * 3600000)
assert.equal(dose.walkHours, 6)
assert.equal(dose.fullWalkMSv.toFixed(2), '0.17')
close(dose.soFarMSv, dose.fullWalkMSv, 1e-12, 'dose after 6 h out')
assert.equal(radiationDose(route, start).soFarMSv, 0)
assert.equal(radiationDose(route, start - 60000).soFarMSv, 0)

console.log(`Walk screen passed: science time at stops, bonus GO / tight / NO-GO matching the status line, skipped / here / done / incomplete, radiation ${dose.fullWalkMSv.toFixed(2)} mSv for ${dose.walkHours} h.`)

// 7. The real route with Kelly's stops (skipped if the terrain files are not in this workspace).
const json = (path) => JSON.parse(readFileSync(new URL(`../../../public/${path}`, import.meta.url)))
let real = null
try {
  real = buildTerrainRoute(json('routes/sample-route.json'), json('terrain/area.json'),
    { elevation: json('terrain/elevation.json'), slope: json('terrain/slope.json'), roughness: json('terrain/roughness.json') },
    json('routes/science-stops.json'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  console.log('Real-route check skipped: terrain files not in this workspace.')
}
if (real) {
  const { route: kelly, grid: kellyGrid } = real
  const nav = createTerrainNavigation(kelly, kellyGrid)
  const kellyStart = Date.parse(kelly.mission.start_time)
  const legs = kelly.legs.map((leg) => leg.seconds / 60)
  const b = kelly.stops.findIndex((stop) => stop.is_bonus)
  assert.ok(b > 1, 'Kelly marked a bonus stop after other stops')
  let out = 0 // minutes out when the science at the stop before the bonus is done, on plan
  for (let k = 0; k < b - 1; k++) out += legs[k] + kelly.stops[k + 1].stop_minutes
  const state = { mode: 'outbound', legIndex: b - 1, progress: 0, scienceLeft: 0, clockMs: kellyStart + out * 60000 }
  const ours = bonusStatus(kelly, state, state.clockMs, { grid: kellyGrid, timeHome: nav.timeHome })
  const mias = bonusStopCheck(kellyGrid, nav.timeHome, {
    here: kelly.stops[b - 1], bonus: kelly.stops[b], elapsedMinutes: out, stopMinutes: kelly.stops[b].stop_minutes,
    walkThereMinutes: legs[b - 1], settings: { suitHours: 8, reserveHours: 2 },
  })
  assert.deepEqual([ours.decideNow, ours.go, ours.level], [true, true, 'ok'])
  close(ours.spareMinutes, mias.spareMinutes, 1e-9, "same as Mia's check at the decision point")
  const fromHab = bonusStatus(kelly, { mode: 'outbound', legIndex: 0, progress: 0, scienceLeft: 0 }, kellyStart, { grid: kellyGrid, timeHome: nav.timeHome })
  close(fromHab.spareMinutes, ours.spareMinutes, 1e-6, 'same spare time from the habitat on plan')
  // Reach the bonus stop, start its science, then head home before it is done: "incomplete".
  const cut = { mode: 'outbound', legIndex: b, progress: 0, scienceLeft: kelly.stops[b].stop_minutes, playing: true, clockMs: kellyStart + (out + legs[b - 1]) * 60000 }
  advance(kelly, cut, 5)
  assert.equal(canHeadHome(kelly, cut), true, `Head home works during the science at ${kelly.stops[b].name}`)
  headHome(kelly, cut, nav)
  assert.equal(bonusStatus(kelly, cut, cut.clockMs, { grid: kellyGrid, timeHome: nav.timeHome }).phase, 'incomplete')
  const planned = legs.reduce((sum, m) => sum + m) + kelly.stops.reduce((sum, stop) => sum + (stop.stop_minutes || 0), 0)
  console.log(`Real route passed: ${kelly.stops[b].name} is GO with ${Math.round(ours.spareMinutes)} min to spare on plan `
    + `(NO-GO once ${Math.round(ours.spareMinutes)} min behind); full plan ${Math.round(planned)} min, radiation ${radiationDose(kelly, kellyStart + planned * 60000).soFarMSv.toFixed(2)} mSv.`)
}
