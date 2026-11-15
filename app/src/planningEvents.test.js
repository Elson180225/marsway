// Random events on the Planning screen. Run from the app folder:  node src/planningEvents.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadRouteForEva } from './terrainRoute.js'
import { planningTravelVersions } from './planningTravel.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { scenarioEvents } from './scenarioEvents.js'
import { plannedDose } from './safezone/radiation.js'
import { shelterRoute } from './pathfinding/shelter.js'
import { planningEventEffects, crewAt } from './planningEvents.js'

const ok = (msg) => console.log('  ok  ' + msg)
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)
const pub = new URL('../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
const fetcher = async (url) => ({ ok: true, json: async () => load('.' + url) })
const files = [load('terrain/area.json'), load('routes/scenarios.json'), load('routes/rover-parking.json')]
const versionsFor = async (eva) => {
  const initial = await loadRouteForEva(eva, fetcher)
  return { initial, ...planningTravelVersions(initial, ...files) }
}
const v07 = await versionsFor('07')
const grid = v07.initial.grid
const find = (route, test) => { for (let s = 1; s <= 9999; s++) if (test(scenarioEvents(route, s))) return s; throw new Error('no seed found') }
const has = (type) => (r) => r.events.some((e) => e.type === type)

console.log('EVA-07 On foot')
const foot = v07.foot
const calm = calculateMissionSchedule(foot)

// Same events as the Walk screen for the same number.
for (const seed of [4, 8, 4821]) assert.deepEqual(planningEventEffects({ route: foot, grid, seed }).events, scenarioEvents(v07.initial.route, seed).events)
ok('same events as Walk for #4, #8, #4821')

// Where the crew is.
assert.deepEqual([crewAt(foot, calm, 0).x, crewAt(foot, calm, 0).y], [foot.stops[0].x, foot.stops[0].y])
const first = calm.rows[0]
assert.equal(crewAt(foot, calm, first.arrival + 1).doing, 'science')
assert.equal(crewAt(foot, calm, first.arrival / 2).doing, 'walking')
assert.equal(crewAt(foot, calm, calm.total + 5).doing, 'home')
assert.equal(crewAt(foot, calm, first.arrival + 1, { atMin: first.arrival - 10, minutes: 30 }).doing, 'walking', 'a 30 min dust devil holds the crew back')
ok('crew position: habitat at the start, walking, at a stop, home; a pause holds them back')

// Calm day.
const calmSeed = find(foot, (r) => r.calm)
const calmDay = planningEventEffects({ route: foot, grid, seed: calmSeed })
assert.equal(calmDay.verdict.level, 'go')
close(calmDay.total, calm.total, 1e-9, 'calm total = plan')
ok(`#${calmSeed} calm: ${calmDay.verdict.title}, ${Math.round(calmDay.total)} min, ${Math.round(calmDay.spare)} min spare`)

// Dust storm: slower only while it lasts.
const dustSeed = find(foot, (r) => has('dust_storm')(r) && !has('dust_devil')(r) && !has('solar_storm')(r))
const dusty = planningEventEffects({ route: foot, grid, seed: dustSeed })
const storm = dusty.events.find((e) => e.type === 'dust_storm')
assert.ok(dusty.weather.endUtc, 'the storm has an end')
assert.ok(dusty.total > calm.total, 'slower')
const endless = calculateMissionSchedule(foot, { ...dusty.weather, endUtc: undefined })
assert.ok(dusty.total < endless.total, 'back to normal speed after it ends')
assert.equal(dusty.verdict.level, 'caution')
ok(`#${dustSeed} dust storm ${storm.startMin}–${storm.startMin + storm.durationMin} min: ${Math.round(dusty.total - calm.total)} min longer (would be ${Math.round(endless.total - calm.total)} if it never ended)`)

// Dust devil: the pause is added.
const devilSeed = find(foot, (r) => has('dust_devil')(r) && r.events.length === 1)
const devil = planningEventEffects({ route: foot, grid, seed: devilSeed })
const d = devil.events[0]
assert.equal(devil.pauseMinutes, d.pauseMinutes)
close(devil.total, calm.total + d.pauseMinutes, 1e-9, 'total = plan + pause')
close(devil.spare, 360 - calm.total - d.pauseMinutes, 1e-9, 'suit time left')
ok(`#${devilSeed} dust devil at ${d.startMin} min: +${d.pauseMinutes} min on the EVA and off the spare suit time`)

// Solar storm: shelter from where the crew is when warned, dose ×2.
const sunSeed = find(foot, (r) => r.events.length === 1 && has('solar_storm')(r) && r.events[0].startMin > 60)
const sunny = planningEventEffects({ route: foot, grid, seed: sunSeed })
const sun = sunny.events[0]
assert.equal(sunny.shelter.atMin, sun.startMin - sun.warningMin)
const crew = crewAt(foot, sunny.schedule, sunny.shelter.atMin)
const direct = shelterRoute({ grid, crew, nowMin: sunny.shelter.atMin, storm: sun, habitat: foot.stops[0] })
close(sunny.shelter.route.minutes, direct.minutes, 1e-9, 'shelter route = shelterRoute from the crew position')
close(sunny.endMin, direct.arriveMin, 1e-9, 'EVA ends when they are inside')
assert.deepEqual(sunny.dose, plannedDose(sunny.endMin, sunny.events), 'dose = Mia\'s plannedDose')
assert.ok(sunny.lines.some((l) => l.kind === 'shelter'))
ok(`#${sunSeed} solar storm at ${sun.startMin} min, warned at ${sunny.shelter.atMin}: ${sunny.shelter.route.message}`)

console.log('\nEVA-07 With rover')
const rover = v07.rover
const brokeSeed = find(rover, (r) => has('rover_breakdown')(r) && r.events.length === 1)
const broke = planningEventEffects({ route: rover, grid, seed: brokeSeed })
const b = broke.events[0]
assert.equal(broke.breakdown.atMin, b.startMin)
assert.ok(['ok', 'reserve'].includes(broke.breakdown.route.level))
assert.match(broke.breakdown.route.message, /Walk home to Habitat \(H1\)|already at/)
close(broke.endMin, broke.breakdown.route.arriveMin, 1e-9, 'EVA ends when they walk in')
assert.ok(broke.lines.some((l) => l.kind === 'drive') && broke.lines.some((l) => l.kind === 'walk-back'))
assert.equal(broke.verdict.level, 'caution')
ok(`#${brokeSeed} breakdown at ${b.startMin} min (crew ${broke.breakdown.crew.doing}): ${broke.breakdown.route.message}`)
assert.equal(planningEventEffects({ route: foot, grid, seed: brokeSeed }).breakdown, null, 'no breakdown on foot')
ok('on foot the same number has no breakdown')

const sunRoverSeed = find(rover, (r) => r.events.length === 1 && has('solar_storm')(r) && r.events[0].startMin > 60)
const sunRover = planningEventEffects({ route: rover, grid, seed: sunRoverSeed })
ok(`#${sunRoverSeed} solar storm with rover: ${sunRover.shelter.route.message}`)

const cancelSeed = find(foot, (r) => r.cancelled)
assert.equal(planningEventEffects({ route: foot, grid, seed: cancelSeed }).verdict.level, 'no-go')
ok(`#${cancelSeed} global dust storm: NO-GO`)

console.log('\nEvery EVA, both versions, 100 scenarios each')
let runs = 0
const levels = { go: 0, caution: 0, 'no-go': 0 }
for (const eva of ['07', '08', '09', '10', '11', '12']) {
  const v = eva === '07' ? v07 : await versionsFor(eva)
  for (const route of [v.foot, v.rover]) {
    for (let seed = 1; seed <= 100; seed++) {
      const e = planningEventEffects({ route, grid: v.initial.grid, seed })
      assert.ok(Number.isFinite(e.total) && Number.isFinite(e.endMin) && Number.isFinite(e.dose.doseMSv), `EVA-${eva} #${seed}`)
      assert.ok(e.endMin <= e.total + 1e-9)
      levels[e.verdict.level]++
      runs++
    }
  }
}
ok(`${runs} plans: ${levels.go} GO, ${levels.caution} caution, ${levels['no-go']} NO-GO`)
console.log('\nPlanning events tests passed.')
