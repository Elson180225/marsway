// Route to shelter from a solar storm. Run from the app folder:  node src/pathfinding/shelter.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeGrid } from './walkingTime.js'
import { routeLeg } from './astar.js'
import { stormPhase, currentSolarStorm, shelterRoute, roverBreakdown, walkBackRoute } from './shelter.js'
import { evaSetup, parkingSpot } from '../safezone/evaSetup.js'
import { RAD_SURFACE_MSV_PER_DAY, SOLAR_STORM_FACTOR } from '../safezone/radiation.js'
import { randomEvents } from '../safezone/randomEvents.js'

const ok = (msg) => console.log('  ok  ' + msg)
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// ---------- 1. Storm phase ----------
console.log('Storm phase')
const storm = { type: 'solar_storm', startMin: 100, durationMin: 60, warningMin: 20 }
assert.equal(stormPhase(storm, 50), 'ahead')
assert.equal(stormPhase(storm, 80), 'warning')
assert.equal(stormPhase(storm, 100), 'on')
assert.equal(stormPhase(storm, 160), 'over')
assert.equal(stormPhase({ startMin: 100, durationMin: null }, 9999), 'on', 'no end = on to the end of the walk')
assert.equal(stormPhase({ startMin: 100, durationMin: 60 }, 99), 'ahead', 'no warningMin = no warning')
const events = [{ type: 'dust_storm', startMin: 70, durationMin: 50 }, storm]
assert.equal(currentSolarStorm(events, 50), null)
assert.equal(currentSolarStorm(events, 85).phase, 'warning')
assert.equal(currentSolarStorm(events, 120).phase, 'on')
assert.equal(currentSolarStorm(events, 170), null)
ok('ahead → warning → on → over; dust storms ignored')

// ---------- 2. Real terrain ----------
const pub = new URL('../../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
const files = {
  area: load('terrain/area.json'), catalog: load('routes/scenarios.json'), boxwork: load('routes/science-stops.json'),
  gediz: load('routes/gediz-stops.json'), parking: load('routes/rover-parking.json'),
}
const grid = makeGrid({ elevation: load('terrain/elevation.json'), slope: load('terrain/slope.json'), roughness: load('terrain/roughness.json') })
const roverFor = (eva, extra = {}) => {
  const spot = parkingSpot(eva, files)
  const entry = files.parking.evas.find((e) => e.eva === eva).spot
  const { west, south } = files.area.boundsProjected
  return { ...spot, driveMinutes: entry.drive_minutes, drivePath: entry.drive_path?.map(([e, n]) => ({ x: e - west, y: n - south })), ...extra }
}

console.log('\nEVA-07 at Boxwork Lookout, storm in 20 min for 60 min')
const eva07 = evaSetup('07', files)
const habitat = { ...eva07.habitat, name: 'H1' }
const crew = eva07.stops[0]
const now = 120
const sunStorm = { type: 'solar_storm', startMin: now + 20, durationMin: 60 }

const foot = shelterRoute({ grid, crew, nowMin: now, storm: sunStorm, habitat })
const walkHome = routeLeg(grid, crew, habitat).seconds / 60
assert.equal(foot.via, 'walk')
close(foot.minutes, walkHome, 1e-9, 'on foot = walking time home')
assert.equal(foot.beforeStorm, false)
close(foot.stormMinutesOutside, walkHome - 20, 1e-6, 'minutes outside in the storm')
close(foot.extraDoseMSv, (RAD_SURFACE_MSV_PER_DAY * (SOLAR_STORM_FACTOR - 1) * (walkHome - 20)) / 1440, 1e-12, 'extra dose = Mia\'s storm rate')
close(foot.doseMSv, (RAD_SURFACE_MSV_PER_DAY * (walkHome + (walkHome - 20))) / 1440, 1e-12, 'dose on the way')
assert.equal(foot.other, null)
assert.match(foot.message, /Solar storm in 20 min\. Head to H1 now: walk \d+ min\. \d+ min outside in the storm/)
ok(`on foot: ${foot.message}`)

const r07 = roverFor('07')
const rover = shelterRoute({ grid, crew, nowMin: now, storm: sunStorm, habitat, rover: r07 })
assert.equal(rover.via, 'rover', 'R07 is next to the lookout, so the rover is quicker')
assert.deepEqual(rover.legs.map((l) => l.mode), ['walk', 'drive'])
close(rover.legs[1].minutes, r07.driveMinutes, 1e-9, 'drive = rover-parking.json drive_minutes')
assert.deepEqual(rover.legs[1].path.at(-1), { x: habitat.x, y: habitat.y }, 'drive ends at the habitat')
assert.ok(rover.minutes < foot.minutes && rover.other.via === 'walk')
assert.ok(rover.extraDoseMSv < foot.extraDoseMSv, 'quicker = less storm dose')
ok(`with rover: ${rover.message}`)

const broken = shelterRoute({ grid, crew, nowMin: now, storm: sunStorm, habitat, rover: roverFor('07', { available: false }) })
assert.equal(broken.via, 'walk')
close(broken.minutes, foot.minutes, 1e-9, 'broken rover = walk home')
assert.match(broken.message, /rover is out of action/)
ok(`rover broken: ${broken.message}`)

const dusty = shelterRoute({ grid, crew, nowMin: now, storm: sunStorm, habitat, walkSpeed: 0.6 })
close(dusty.minutes, walkHome / 0.6, 1e-9, 'dust storm: walking at 0.6×')
ok(`dust storm too: ${Math.round(dusty.minutes)} min home instead of ${Math.round(foot.minutes)}`)

const early = shelterRoute({ grid, crew, nowMin: now, storm: { ...sunStorm, startMin: now + 90 }, habitat })
assert.equal(early.beforeStorm, true)
assert.equal(early.extraDoseMSv, 0)
assert.match(early.message, /Inside \d+ min before it starts\./)
ok(`warned in time: ${early.message}`)

const during = shelterRoute({ grid, crew, nowMin: now, storm: { ...sunStorm, startMin: now - 10, durationMin: 120 }, habitat })
assert.equal(during.startsInMin, 0)
close(during.stormMinutesOutside, walkHome, 1e-6, 'storm already on: every minute outside counts')
assert.match(during.message, /^Solar storm now/)
ok(`already on: ${during.message}`)

// Already at the habitat (e.g. before setting out): nothing to walk, so "stay inside".
assert.equal(foot.atShelter, false)
const atHome = shelterRoute({ grid, crew: { x: habitat.x, y: habitat.y }, nowMin: now, storm: sunStorm, habitat })
assert.equal(atHome.atShelter, true)
assert.equal(atHome.message, 'Solar storm in 20 min. Stay inside H1.')
const atHomeOn = shelterRoute({ grid, crew: { x: habitat.x, y: habitat.y }, nowMin: now, storm: { ...sunStorm, startMin: now - 10 }, habitat, rover: r07 })
assert.equal(atHomeOn.message, 'Solar storm now: radiation is doubled outside. Stay inside H1.')
ok(`at the habitat: ${atHome.message} / ${atHomeOn.message}`)

console.log('\nEVA-12 at its first stop, rover parked next to H4')
const eva12 = evaSetup('12', files)
const h4 = shelterRoute({ grid, crew: eva12.stops[0], nowMin: now, storm: sunStorm, habitat: { ...eva12.habitat, name: 'H4' }, rover: roverFor('12') })
assert.equal(h4.via, 'walk', 'walking straight home beats walking to R12 and driving 304 m')
assert.equal(h4.other.via, 'rover')
assert.match(h4.message, /quicker than going back to the rover/)
ok(`${h4.message} (rover way: ${Math.round(h4.other.minutes)} min)`)

// ---------- 3. Rover breakdown: walk back ----------
console.log('\nRover breakdown')
const mission = load('routes/sample-route.json').mission // 8 h suit, 2 h reserve
assert.equal(roverBreakdown([{ type: 'rover_breakdown', startMin: 200, durationMin: null }], 199), null)
assert.equal(roverBreakdown([{ type: 'rover_breakdown', startMin: 200, durationMin: null }], 200).startMin, 200)
// EVA-07 with rover: back at R07 after the loop (the worst moment), same as Mia's walk-back check.
const atRover = r07
const walkFromR07 = routeLeg(grid, atRover, habitat).seconds / 60
const back = walkBackRoute({ grid, crew: atRover, nowMin: 169, habitat, mission })
close(back.minutes, walkFromR07, 1e-9, 'walk-back = walking time home')
assert.equal(back.level, 'ok')
close(back.spareMinutes, 360 - 169 - walkFromR07, 1e-9, 'spare before the reserve')
assert.match(back.message, /^Rover broken down\. Walk home to H1: \d+ min, [\d.]+ km\. Home with \d+ min to spare before the reserve\.$/)
ok(back.message)
const late = walkBackRoute({ grid, crew: atRover, nowMin: 340, habitat, mission })
assert.equal(late.level, 'reserve')
assert.match(late.message, /uses \d+ min of the reserve: leave now/)
ok(`late in the walk: ${late.message}`)
const tooLate = walkBackRoute({ grid, crew: atRover, nowMin: 460, habitat, mission })
assert.equal(tooLate.level, 'fail')
ok(`very late: ${tooLate.message}`)
// A breakdown plus a solar storm: shelterRoute with the rover out of action gives the same walk.
const both = shelterRoute({ grid, crew: atRover, nowMin: 169, storm: { startMin: 180, durationMin: 60 }, habitat, rover: { ...r07, available: false } })
close(both.minutes, back.minutes, 1e-9, 'storm + breakdown = the walk-back route')
ok('storm + breakdown: shelter route = walk-back route')

// ---------- 4. With Mia's random events ----------
console.log("\nMia's randomEvents(): every solar storm and breakdown in 300 scenarios gets a route home")
let storms = 0
let breakdowns = 0
for (let seed = 1; seed <= 300; seed++) {
  const { events } = randomEvents({ seed, eva: '07', version: 'rover', durationMinutes: 203 })
  const sun = events.find((e) => e.type === 'solar_storm')
  if (sun) {
    const at = currentSolarStorm(events, sun.startMin)
    assert.equal(at.phase, 'on')
    const r = shelterRoute({ grid, crew, nowMin: sun.startMin, storm: at, habitat, rover: r07 })
    assert.ok(r && Number.isFinite(r.minutes) && r.extraDoseMSv > 0, `seed ${seed}`)
    storms++
  }
  const broke = roverBreakdown(events, 999)
  if (broke) {
    const r = walkBackRoute({ grid, crew: atRover, nowMin: broke.startMin, habitat, mission })
    assert.ok(r && r.level !== 'fail', `seed ${seed}: walk-back fits`)
    breakdowns++
  }
}
assert.ok(storms > 20 && breakdowns > 10)
ok(`${storms} solar storms and ${breakdowns} rover breakdowns, all with a route home`)

console.log('\nShelter tests passed.')
