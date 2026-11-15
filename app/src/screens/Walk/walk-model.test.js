// Walk screen: science time at stops, bonus-stop GO / NO-GO and the radiation counter.
// Run from app/:  node src/screens/Walk/walk-model.test.js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { buildTerrainRoute } from '../../terrainRoute.js'
import { createTerrainNavigation } from '../../terrainNavigation.js'
import { bonusStopCheck, TIGHT_MINUTES } from '../../safezone/bonusStop.js'
import { xyToCell } from '../../pathfinding/walkingTime.js'
import { stopMetadata } from '../../stopDetails.js'
import { directionsFor } from '../../pathfinding/directions.js'
import {
  advance, arrivalTimes, bonusStatus, canHeadHome, currentTrip, directionLine, eventAlerts, eventEffects, eventSolarStorms, groundAt, hazardSpots, headHome, minutesBehindPlan, minutesHome, pathGround,
  pathLength, photoDistance, photoStop, pointAlong, radiationDose, safetyStatus, walkPace,
} from './walk-model.js'

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

// 6. Photo panel: the next stop while walking (and at the habitat), the stop the crew is at,
//    nothing on the way home or after the walk.
assert.deepEqual(photoStop(route, at(0, 0)), { stop: route.stops[1], here: false })
assert.deepEqual(photoStop(route, at(1, 60)), { stop: route.stops[1], here: true })
assert.deepEqual(photoStop(route, at(1, 70, { progress: 0.5 })), { stop: route.stops[2], here: false })
assert.deepEqual(photoStop(route, at(3, 200)), { stop: route.stops[3], here: true })
assert.equal(photoStop(route, at(3, 230, { progress: 0.5 })), null)
assert.equal(photoStop(route, at(1, 60, { mode: 'return' })), null)
assert.equal(photoStop(route, at(3, 300, { mode: 'complete', progress: 1 })), null)
// "Nearby view, about N m away" only when that photo's distance is known; never when it is unverified.
assert.equal(photoDistance({ photo_view: 'nearby', photo_offset_m: 19.5 }), 20)
assert.equal(photoDistance({ photo_view: 'nearby', photo_offset_m: 178.8 }), 179)
assert.equal(photoDistance({ photo_view: 'nearby' }), null)
assert.equal(photoDistance({ photo_view: 'nearby', photo_offset_m: null, photo_offset_status: 'unverified' }), null)
assert.equal(photoDistance({ photo_view: 'nearby', photo_offset_m: 6, photo_offset_status: 'unverified' }), null, 'unverified wins over a number')
assert.equal(photoDistance({ photo_offset_m: 19.5 }), null, 'not a nearby view')

// 7. Radiation: about 0.67 mSv a day, so the 6 h walking budget (8 h suit - 2 h reserve) is 0.17 mSv.
const dose = radiationDose(route, start + 6 * 3600000)
assert.equal(dose.walkHours, 6)
assert.equal(dose.fullWalkMSv.toFixed(2), '0.17')
close(dose.soFarMSv, dose.fullWalkMSv, 1e-12, 'dose after 6 h out')
assert.equal(radiationDose(route, start).soFarMSv, 0)
assert.equal(radiationDose(route, start - 60000).soFarMSv, 0)
// Solar storm for 1 h of the 6 h: that hour counts double, so 7 h worth of normal dose.
const storm1h = radiationDose(route, start + 6 * 3600000, [{ startMs: start + 3600000, endMs: start + 2 * 3600000 }])
close(storm1h.stormMinutes, 60, 1e-9, 'storm minutes')
close(storm1h.soFarMSv, dose.fullWalkMSv * 7 / 6, 1e-12, 'dose with a 1 h storm')
close(storm1h.stormExtraMSv, dose.fullWalkMSv / 6, 1e-12, 'extra dose from the storm')
// A storm still on (no end) counts up to the walk clock only.
close(radiationDose(route, start + 2 * 3600000, [{ startMs: start + 3600000, endMs: null }]).stormMinutes, 60, 1e-9, 'open storm')

// 7b. Map pins for hazards: the steepest spot of a steep leg, at its distance along the path.
const firstLeg = currentTrip(route, at(0, 0))
const midway = pointAlong(firstLeg.path, 0.5).point
const steepGrid = { ...grid, slope: Float32Array.from(grid.slope) }
steepGrid.slope[xyToCell(grid, midway.x, midway.y)] = grid.suit.slopeWarnDeg + 10
const [pin, ...extra] = hazardSpots(steepGrid, { ...firstLeg, warnings: [{ type: 'steep_slope', level: 'caution' }] })
assert.equal(extra.length, 0)
assert.deepEqual([pin.type, pin.level, xyToCell(grid, pin.point.x, pin.point.y)], ['steep_slope', 'caution', xyToCell(grid, midway.x, midway.y)])
assert.ok(Math.abs(pin.along - pathLength(firstLeg.path) / 2) <= grid.cellSize, 'pin is about halfway along the leg')
assert.deepEqual(hazardSpots(steepGrid, { ...firstLeg, warnings: [] }), [], 'no warning from the planner, no pin')
assert.deepEqual(hazardSpots(grid, { ...firstLeg, warnings: [{ type: 'steep_slope', level: 'caution' }] }), [], 'flat ground, no pin')

// 9. Walking slower (demo "Slow"): the crew really walks 30% slower, the screen measures it from the
//    walking (walkPace), and every walking time it shows (home, turn back, bonus, arrivals) uses it.
const slow = at(0, 0, { playing: true, simPace: 1.3 })
advance(route, slow, 4)
assert.equal(walkPace(slow), 1, 'not trusted before about 5 planned minutes of walking')
close(slow.progress, 4 / (walk[0] * 1.3), 1e-9, 'the leg takes 30% longer')
advance(route, slow, 20)
close(walkPace(slow), 1.3, 1e-9, 'measured pace')
// Walk on (science skipped here: it is not walking, so it doesn't change the pace).
const walkOn = (state, minutes) => { for (let t = 0; t < minutes; t += 0.25) { state.scienceLeft = 0; state.playing = true; advance(route, state, 0.25) } }
slow.simPace = 1 // back to the planned speed: the measured pace follows within about 10 planned minutes
walkOn(slow, 4)
assert.ok(walkPace(slow) > 1.05 && walkPace(slow) < 1.3, `easing back: ${walkPace(slow)}`)
walkOn(slow, 40)
assert.ok(walkPace(slow) < 1.01, `back on pace: ${walkPace(slow)}`)
assert.equal(slow.mode, 'outbound', 'fixture: still walking')
const paced = (state, pace) => ({ ...state, paceLog: { planned: 10, actual: 10 * pace } })
const mid = at(1, 60, { progress: 0.4 })
close(minutesHome(route, paced(mid, 1.3), navigation), minutesHome(route, mid, navigation) * 1.3, 1e-9, 'time home at 1.3x')
const midSafety = safetyStatus(route, mid, mid.clockMs, navigation)
close(safetyStatus(route, paced(mid, 1.3), mid.clockMs, navigation).turnbackIn, midSafety.turnbackIn - midSafety.homeMinutes * 0.3, 1e-9, 'turn back comes sooner')
// The bonus check at stop B: walking there and home from it both take 30% longer.
close(bonusStatus(route, paced(decide(0), 1.3), decide(0).clockMs, safezone).spareMinutes, planSpare - 0.3 * (walk[2] + homeFromBonus), 1e-6, 'bonus spare time at 1.3x')
for (let late = planSpare - 30; late < planSpare; late += 0.5) {
  const state = paced(decide(late), 1.3)
  assert.equal(safetyStatus(route, state, state.clockMs, navigation).nextStopOk, bonusStatus(route, state, state.clockMs, safezone).go, `status and GO / NO-GO agree at 1.3x, ${late.toFixed(2)} min late`)
}

// 10. Arrival times: every stop left and home, with the science at each stop; walking only scales with pace.
const plan = arrivalTimes(route, at(0, 0))
assert.deepEqual(plan.stops.map((stop) => stop.id), route.stops.slice(1).map((stop) => stop.id))
close((plan.stops[1].arrive_ms - start) / 60000, walk[0] + 15 + walk[1], 1e-9, 'arrive at B')
close((plan.home_ms - start) / 60000, walk.reduce((sum, m) => sum + m) + 15 + 30 + 20, 1e-9, 'home on plan')
close((arrivalTimes(route, paced(at(0, 0), 1.3)).home_ms - start) / 60000, walk.reduce((sum, m) => sum + m) * 1.3 + 65, 1e-9, 'home at 1.3x')
const atA = arrivalTimes(route, at(1, walk[0], { scienceLeft: 15 }))
close((atA.stops[0].arrive_ms - start) / 60000, walk[0] + 15 + walk[1], 1e-9, 'science left at A, then walk to B')
const homeward = headHome(route, at(1, 70, { progress: 0.5 }), navigation)
close((arrivalTimes(route, homeward).home_ms - homeward.clockMs) / 60000, homeward.returnTrip.walk_minutes, 1e-9, 'on the way home: just home')
assert.deepEqual(arrivalTimes(route, at(3, 300, { mode: 'complete', progress: 1 })).stops, [])

// 11. Turn-by-turn line: the first step before setting off, then the next turn, then arriving.
const legSteps = directionsFor(grid, firstLeg, { toName: 'Stop A' })
const legLength = pathLength(firstLeg.path)
assert.match(directionLine(legSteps, 0).text, /^Head /)
assert.equal(directionLine(legSteps, legLength - 5).text, 'Arriving at Stop A')
for (const metres of [0, legLength * 0.3, legLength * 0.7, legLength]) {
  const line = directionLine(legSteps, metres)
  assert.equal(line.lead + line.rest, line.text, 'lead + rest is the whole line')
}
const turnLine = directionLine([{ turn: 'start', start_m: 0, text: 'Head east, on fairly flat ground, for 300 m' }, { turn: 'slight_left', start_m: 300, text: 'Bear left to head north-east, gently uphill, for 200 m' }, { turn: 'arrive', start_m: 500, text: 'Arrive at Stop A' }], 100)
assert.deepEqual([turnLine.turn, turnLine.lead, turnLine.rest], ['slight_left', 'In 200 m, bear left', ' to head north-east, gently uphill, for 200 m'])
assert.equal(directionLine(null, 0), null)

// 12. Data page terrain: the ground here against the suit limits, and up / down / steepest along a leg.
//     The made-up map rises 10 m for every 100 m east.
assert.equal(groundAt(grid, { x: 950, y: 950 }).level, 'ok')
assert.equal(groundAt(grid, { x: -50, y: 950 }), null, 'off the map')
const midCell = xyToCell(grid, midway.x, midway.y)
assert.equal(groundAt(steepGrid, midway).level, 'caution', 'steeper than the warning limit')
const noGoGrid = { ...grid, slope: Float32Array.from(grid.slope) }
noGoGrid.slope[midCell] = grid.suit.slopeNoGoDeg + 1
assert.equal(groundAt(noGoGrid, midway).level, 'danger', 'steeper than the no-go limit')
const roughGrid = { ...grid, roughness: Float32Array.from(grid.roughness) }
roughGrid.roughness[midCell] = grid.suit.roughWarnDeg + 1
assert.equal(groundAt(roughGrid, midway).level, 'caution', 'rough ground')
const east = pathGround(grid, [{ x: 250, y: 950 }, { x: 1250, y: 950 }])
close(east.climbM, 100, 1e-6, 'climb over 1 km east')
close(east.descentM, 0, 1e-6, 'no descent going east')
const west = pathGround(grid, [{ x: 1250, y: 950 }, { x: 250, y: 950 }])
close(west.descentM, 100, 1e-6, 'descent coming back west')
assert.equal(pathGround(steepGrid, firstLeg.path).steepestDeg, grid.suit.slopeWarnDeg + 10, 'steepest spot on the leg')

// 13. Mia's random events on the Walk screen: a pop-up (alert) only while each event is under way,
//     and random solar storms doubling the radiation. (Same events as Planning: src/scenarioEvents.test.js.)
const events = [
  { type: 'dust_storm', startMin: 30, durationMin: 20, speedFactor: 0.6, title: 'Dust storm', message: 'Walking slows.' },
  { type: 'solar_storm', startMin: 60, durationMin: 60, radiationFactor: 2, title: 'Solar storm', message: 'Radiation doubled.' },
]
assert.deepEqual(eventAlerts(route, events, 29.9), [], 'nothing before it starts')
const [dust] = eventAlerts(route, events, 30)
assert.deepEqual([dust.type, dust.level, dust.simulated, dust.shelter_stop_id, dust.endMs - start], ['dust_storm', 'caution', true, null, 50 * 60000])
assert.deepEqual(eventAlerts(route, events, 50), [], 'gone when it ends')
const [solar] = eventAlerts(route, events, 90)
assert.deepEqual([solar.level, solar.shelter_stop_id], ['danger', route.stops[0].id], 'solar storm: shelter at the habitat')
assert.equal(eventAlerts(route, [{ type: 'global_dust_storm', startMin: 0, durationMin: null, title: 'Global dust storm', message: '' }], 400)[0].endMs, null, 'lasts to the end')
const stormHour = radiationDose(route, start + 6 * 3600000, eventSolarStorms(route, events))
close(stormHour.soFarMSv, dose.fullWalkMSv * 7 / 6, 1e-12, 'a 1 h random solar storm counts double')
close(stormHour.stormMinutes, 60, 1e-9, 'storm minutes')

// 14. Random events change the walking too: a dust storm slows the crew to 0.6×, a dust devil stops
//     them while the clock runs. Like the Walk screen's tick: eventEffects() before and after advance().
const out = (state) => (state.clockMs - start) / 60000
const tick = (state, evts, minutes) => { eventEffects(state, evts, out(state)); advance(route, state, minutes); eventEffects(state, evts, out(state)); return state }
//   Dust storm: 1 / 0.6 slower while it is on, stacking with the demo "Slow", then back to normal.
const dustNow = [{ type: 'dust_storm', startMin: 0, durationMin: 3, speedFactor: 0.6, title: 'Dust storm', message: '' }]
const windy = tick(at(0, 0, { playing: true }), dustNow, 2)
close(windy.progress, 2 / (walk[0] / 0.6), 1e-9, 'the leg takes 1 / 0.6 longer in the storm')
close(tick(at(0, 0, { playing: true, simPace: 1.3 }), dustNow, 2).progress, 2 / (walk[0] * 1.3 / 0.6), 1e-9, 'storm and Slow together')
tick(windy, dustNow, 1.5)
assert.equal(windy.weatherPace, 1, 'storm over: normal speed')
//   Dust devil: stand still, the clock runs, then walk on by itself. The wait is in every time shown.
const devilAt1 = [{ type: 'dust_devil', startMin: 1, durationMin: 7, pauseMinutes: 7, title: 'Dust devil', message: '' }]
const gusty = tick(at(0, 0, { playing: true }), devilAt1, 1)
close(gusty.waitLeft, 7, 1e-9, 'dust devil starts: 7 min wait')
const before = gusty.progress
const calm = { ...gusty, waitLeft: 0 }
close(minutesHome(route, gusty, navigation) - minutesHome(route, calm, navigation), 7, 1e-9, 'time home includes the wait')
close((arrivalTimes(route, gusty).home_ms - arrivalTimes(route, calm).home_ms) / 60000, 7, 1e-9, 'arrival times include the wait')
close(safetyStatus(route, calm, calm.clockMs, navigation).turnbackIn - safetyStatus(route, gusty, gusty.clockMs, navigation).turnbackIn, 7, 1e-9, 'turn back comes 7 min sooner')
tick(gusty, devilAt1, 3)
assert.equal(gusty.progress, before, 'standing still')
close(out(gusty), 4, 1e-9, 'the clock still runs')
close(gusty.waitLeft, 4, 1e-9, '4 min left')
tick(gusty, devilAt1, 5)
assert.equal(gusty.waitLeft, 0)
close(gusty.progress, before + 1 / walk[0], 1e-9, 'walked on for the minute left over')
assert.equal(gusty.playing, true, 'no tap needed to walk on')
//   The clock jumped into it (e.g. "+30m here"): only the rest of it is a wait. Science waits too.
close(eventEffects(at(0, 5), devilAt1, 5).waitLeft, 3, 1e-9, 'only the rest of the dust devil')
const busy = tick(at(1, 1, { scienceLeft: 10, playing: true }), devilAt1, 4)
assert.deepEqual([busy.scienceLeft, busy.waitLeft], [10, 3], 'no science during the dust devil')
assert.deepEqual(eventEffects(at(0, 5, { mode: 'complete' }), devilAt1, 5), { weatherPace: 1, waitLeft: 0 }, 'nothing once home')

console.log(`Walk screen passed: science time at stops, bonus GO / tight / NO-GO matching the status line, skipped / here / done / incomplete, photo panel stop, hazard pins, radiation ${dose.fullWalkMSv.toFixed(2)} mSv for ${dose.walkHours} h, measured pace 1.3x in times home / turn back / bonus / arrivals, turn-by-turn line.`)

// 8. The real route with Kelly's stops (skipped if the terrain files are not in this workspace).
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
  // Every science stop has what the photo panel shows: a photo file, a credit, a source link and a task.
  const science = kelly.stops.filter((stop) => stop.type !== 'habitat' && stop.type !== 'home')
  for (const stop of science) {
    const meta = stopMetadata(stop, 'http://localhost/')
    assert.ok(meta.photo && existsSync(new URL(`../../../public${new URL(meta.photo).pathname}`, import.meta.url)), `${stop.id}: photo file exists`)
    assert.ok(meta.credit && meta.source?.startsWith('https://') && stop.why, `${stop.id}: credit, source link and task`)
  }
  assert.equal(photoStop(kelly, { mode: 'outbound', legIndex: 0, progress: 0 }).stop.id, science[0].id)
  // Kelly's photo distances: Boxwork Lookout "about 20 m" (19.5 m recorded); every reviewed Gediz photo has none.
  assert.equal(photoDistance(kelly.stops.find((stop) => stop.id === 'boxwork-lookout')), 20)
  for (const stop of json('routes/gediz-stops.json').stops) assert.equal(photoDistance(stop), null, `${stop.id}: unverified, no number`)
  // Every warning the planner raised on the first leg gets a pin on that leg's path.
  const leg0 = currentTrip(kelly, { mode: 'outbound', legIndex: 0, progress: 0 })
  const pins = hazardSpots(kellyGrid, leg0)
  assert.deepEqual(pins.map((p) => p.type).sort(), leg0.warnings.map((w) => w.type).sort())
  for (const p of pins) assert.ok(p.along >= 0 && p.along <= pathLength(leg0.path) + 1e-6, `${p.type} pin is on the leg`)
  const planned = legs.reduce((sum, m) => sum + m) + kelly.stops.reduce((sum, stop) => sum + (stop.stop_minutes || 0), 0)
  // Directions and arrival times on the real terrain: every leg has turn-by-turn steps that end at its stop.
  kelly.legs.forEach((leg, k) => {
    const legSteps = directionsFor(kellyGrid, leg, { toName: kelly.stops[k + 1].name })
    assert.equal(legSteps.at(-1).text, `Arrive at ${kelly.stops[k + 1].name}`)
    assert.match(directionLine(legSteps, 0).text, /^(Head |Arriv)/, `leg ${k + 1} starts with a heading`)
  })
  close((arrivalTimes(kelly, { mode: 'outbound', legIndex: 0, progress: 0, scienceLeft: 0, clockMs: kellyStart }).home_ms - kellyStart) / 60000, planned, 1e-6, 'home on plan')
  // Data page on the real terrain: a leg the planner calls steep is steep on the Data page too.
  const steepLeg = kelly.legs.find((leg) => leg.warnings?.some((w) => w.type === 'steep_slope'))
  if (steepLeg) assert.ok(pathGround(kellyGrid, steepLeg.path).steepestDeg > kellyGrid.suit.slopeWarnDeg, 'steep leg shows as steep')
  assert.ok(Number.isFinite(groundAt(kellyGrid, kelly.stops[0]).heightM), 'height at the habitat')
  console.log(`Real route passed: ${kelly.stops[b].name} is GO with ${Math.round(ours.spareMinutes)} min to spare on plan `
    + `(NO-GO once ${Math.round(ours.spareMinutes)} min behind); full plan ${Math.round(planned)} min, radiation ${radiationDose(kelly, kellyStart + planned * 60000).soFarMSv.toFixed(2)} mSv; `
    + `${science.length} stop photos with credits.`)
}
