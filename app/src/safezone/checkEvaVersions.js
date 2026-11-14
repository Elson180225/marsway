// Safety checks for both versions of every EVA (EVA-07 to 12): on foot and with rover.
// Run from the app folder:  node src/safezone/checkEvaVersions.js
// Add --json to print the full results as JSON.
//
// Uses the habitat home files (home-h1-6km ... home-h4-6km) and the rover home files from
// buildRoverHomeFiles.js. A rover version shows "waiting" until Nigel adds its parking spot
// and its home file is built. See roverSafety.js for what each check means.
import { readFileSync, existsSync } from 'node:fs'
import { makeGrid } from '../pathfinding/walkingTime.js'
import { decodeHomeFile } from './homeFile.js'
import { checkEvaVersion, ROVER } from './roverSafety.js'
import { EVAS, evaSetup, parkingSpot } from './evaSetup.js'

const pub = new URL('../../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))

export function loadFiles() {
  return {
    area: load('terrain/area.json'),
    catalog: load('routes/scenarios.json'),
    boxwork: load('routes/science-stops.json'),
    gediz: load('routes/gediz-stops.json'),
    parking: load('routes/rover-parking.json'),
    template: load('routes/sample-route.json'),
    terrain: { elevation: load('terrain/elevation.json'), slope: load('terrain/slope.json'), roughness: load('terrain/roughness.json') },
  }
}

const homeFiles = new Map()
function timeHomeFrom(name) {
  if (!homeFiles.has(name)) {
    const meta = new URL(`safezone/${name}.json`, pub)
    const bin = new URL(`safezone/${name}.bin`, pub)
    if (!existsSync(meta) || !existsSync(bin)) homeFiles.set(name, null)
    else {
      const file = decodeHomeFile(JSON.parse(readFileSync(meta, 'utf8')), readFileSync(bin))
      if (file.stale) throw new Error(`${name} was built with old suit numbers: rebuild it.`)
      homeFiles.set(name, file.arrows.timeHome)
    }
  }
  return homeFiles.get(name)
}

/** Results for every EVA: [{ eva, id, habitat, foot, rover, parking }] (rover null = waiting, with reason). */
export function checkAllEvas(files = loadFiles()) {
  const grid = makeGrid(files.terrain)
  const rules = files.parking.rules
    ? { speedKmh: files.parking.rules.speed_kmh, onOffMinutes: files.parking.rules.on_off_minutes, maxSlopeDeg: files.parking.rules.max_slope_deg }
    : ROVER
  const mission = files.template.mission
  return EVAS.map((eva) => {
    const { id, habitat, stops } = evaSetup(eva, files)
    const timeHome = timeHomeFrom(`home-${habitat.id.toLowerCase()}-6km`)
    if (!timeHome) throw new Error(`Missing home file for ${habitat.id}: run buildHomeFile.js.`)
    const foot = checkEvaVersion({ grid, mission, habitat, stops, timeHome, roverRules: rules })
    const spot = parkingSpot(eva, files)
    let rover = null
    let waiting = null
    if (!spot) waiting = 'no parking spot yet (Nigel)'
    else {
      const timeToRover = timeHomeFrom(spot.homeFile)
      if (!timeToRover) waiting = `home file ${spot.homeFile} not built yet (run buildRoverHomeFiles.js)`
      else rover = checkEvaVersion({ grid, mission, habitat, stops, timeHome, roverRules: rules, rover: { parking: spot, driveDistanceM: spot.driveDistanceM, timeToRover } })
    }
    return { eva, id, habitat: habitat.id, parking: spot, foot, rover, waiting }
  })
}

const m = (minutes) => (Number.isFinite(minutes) ? `${Math.floor(Math.round(minutes) / 60)}h ${String(Math.round(minutes) % 60).padStart(2, '0')}m` : 'none')
const mark = (lvl) => ({ ok: '✅', reserve: '⚠️ reserve', fail: '❌' })[lvl] ?? lvl

function line(result) {
  const { checks } = result
  const parts = [
    `${checks.fits.ok ? '✅' : '❌'} plan ${m(result.total)} of ${m(result.usable)} (${m(result.spare)} spare)`,
    `storm plan ${mark(checks.stormPlan.worst.level)} (worst: ${checks.stormPlan.worst.name ?? '-'}, home at ${m(checks.stormPlan.worst.arriveMinutes)})`,
  ]
  if (checks.walkBack) parts.push(`walk-back ${mark(checks.walkBack.level)} (${m(checks.walkBack.walkHomeMinutes)} walk, home at ${m(checks.walkBack.arriveMinutes)})`)
  if (checks.parking) parts.push(`parking ${checks.parking.ok ? '✅' : '❌'} ${checks.parking.slopeDeg.toFixed(1)}°`)
  return parts.join(' · ')
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const results = checkAllEvas()
  if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
  else {
    console.log('Safety checks: on foot and with rover (8 h suit, 2 h reserve protected)\n')
    for (const r of results) {
      console.log(`${r.id} (${r.habitat})`)
      console.log(`  On foot     ${line(r.foot)}`)
      console.log(r.rover ? `  With rover  ${line(r.rover)}  [drive ${m(r.rover.driveOut)} each way to ${r.parking.id}]` : `  With rover  waiting: ${r.waiting}`)
      for (const p of [...r.foot.problems.map((x) => `on foot: ${x}`), ...(r.rover?.problems ?? []).map((x) => `rover: ${x}`)]) console.log(`    ! ${p}`)
    }
  }
}
