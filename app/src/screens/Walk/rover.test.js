// Rover version of the Walk screen ("With rover"): drive out, walk the stops from the parked rover,
// drive home. Run from app/: node src/screens/Walk/rover.test.js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadRouteForEva } from '../../terrainRoute.js'
import { planningTravelVersions } from '../../planningTravel.js'
import { calculateMissionSchedule } from '../../missionSchedule.js'
import {
  advance, arrivalTimes, currentTrip, driveHomeMinutes, habitatOf, isRoverRoute, minutesHome, radiationDose, safetyStatus,
} from './walk-model.js'

const pub = new URL('../../../public/', import.meta.url)
const json = async (path) => JSON.parse(await readFile(new URL(path, pub), 'utf8'))
const fetcher = async (url) => ({ ok: true, json: () => json(url.slice(1)) })
const [area, catalog, parking] = await Promise.all(['terrain/area.json', 'routes/scenarios.json', 'routes/rover-parking.json'].map(json))
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

for (const eva of ['08', '07']) {
  const versions = planningTravelVersions(await loadRouteForEva(eva, fetcher), area, catalog, parking)
  const route = versions.rover
  const { mission } = route
  const start = Date.parse(mission.start_time)
  assert.ok(isRoverRoute(route), `EVA-${eva}: rover route`)
  assert.equal(isRoverRoute(versions.foot), false, `EVA-${eva}: on foot is not`)
  const drive = mission.drive_out_minutes
  const driveHome = driveHomeMinutes(route)
  assert.ok(drive > 0 && driveHome > 0)

  // Drive out: the dot moves along the drive path, the clock runs, nothing else happens.
  const state = { mode: 'drive-out', legIndex: 0, progress: 0, playing: true, returnTrip: null, scienceLeft: 0, cutShortAt: null, clockMs: start, simPace: 1, paceLog: null }
  const out = currentTrip(route, state)
  assert.equal(out.drive, true)
  assert.deepEqual([out.from.label, out.from.x, out.from.y], [versions.foot.mission.home_label, versions.foot.stops[0].x, versions.foot.stops[0].y], 'drives from the habitat')
  assert.equal(out.to.id, route.stops[0].id, 'drives to the parked rover')
  const status = safetyStatus(route, state, state.clockMs)
  assert.match(status.title, new RegExp(`^🚙 Driving to ${mission.home_label}… ${Math.ceil(drive)} min$`))
  assert.equal(status.level, 'info')
  // The walk plan and the drive home both come after the rest of the drive out.
  const eta = arrivalTimes(route, state)
  close((eta.home_ms - start) / 60000, calculateMissionSchedule(route).walking + calculateMissionSchedule(route).science + drive + driveHome, 1, `EVA-${eva}: home on plan`)
  advance(route, state, drive / 2)
  close(state.progress, 0.5, 1e-9, 'half way')
  close(minutesHome(route, state), drive / 2, 1e-9, 'drive back the way they came')
  advance(route, state, drive) // only the rest of the drive is used
  assert.deepEqual([state.mode, state.legIndex, state.progress], ['outbound', 0, 0], 'at the rover, ready to walk')
  close((state.clockMs - start) / 60000, drive, 1e-9, 'the drive counts against suit time')

  // Walking: the time home includes the drive home, so the turn-back timer does too.
  const walkBack = minutesHome(route, state) - driveHome
  close(walkBack, 0, 1e-6, 'at the rover, walking home is nothing')
  close(safetyStatus(route, state, state.clockMs).homeMinutes, driveHome, 1e-6, 'home = the drive home')

  // Walk every stop, then the drive home, then complete at the habitat.
  let guard = 0
  while (state.mode !== 'complete' && guard++ < 200) { state.playing = true; advance(route, state, 30) }
  assert.equal(state.mode, 'complete')
  assert.deepEqual(currentTrip(route, state).to, habitatOf(route), 'ends at the habitat')
  const total = (state.clockMs - start) / 60000
  close(total, calculateMissionSchedule(route).total, 1, `EVA-${eva}: same length as Planning's rover plan`)
  // Radiation counts the whole time outside, drives included.
  close(radiationDose(route, state.clockMs).soFarMSv, radiationDose(route, start + total * 60000).soFarMSv, 1e-12, 'dose')
  assert.ok(radiationDose(route, start + drive * 60000).soFarMSv > 0, 'radiation during the drive')
  console.log(`EVA-${eva} by rover passed: drive ${Math.round(drive)} min to ${mission.home_label}, walk, drive ${Math.round(driveHome)} min home; ${Math.round(total)} min in all.`)
}

// Every EVA, on foot and by rover, walks to the end in exactly Planning's planned time.
for (const eva of ['07', '08', '09', '10', '11', '12']) {
  const versions = planningTravelVersions(await loadRouteForEva(eva, fetcher), area, catalog, parking)
  for (const mode of ['foot', 'rover']) {
    const route = versions[mode]
    const start = Date.parse(route.mission.start_time)
    const state = { mode: isRoverRoute(route) ? 'drive-out' : 'outbound', legIndex: 0, progress: 0, playing: true, returnTrip: null, scienceLeft: 0, cutShortAt: null, clockMs: start, simPace: 1, paceLog: null }
    let guard = 0
    while (state.mode !== 'complete' && guard++ < 300) { state.playing = true; advance(route, state, 20) }
    assert.equal(state.mode, 'complete', `EVA-${eva} ${mode}: finishes`)
    close((state.clockMs - start) / 60000, calculateMissionSchedule(route).total, 1e-6, `EVA-${eva} ${mode}: Planning's time`)
  }
}
console.log('All EVAs, on foot and by rover, take Planning\'s planned time.')
