/**
 * Pick the rover parking spot for the "With rover" version of each EVA (Pathfinder 1), and work out
 * the drive route and drive time. Fills in public/routes/rover-parking.json for Mia's checks.
 *
 * Run from the app folder:
 *   node src/pathfinding/pickRoverParking.js           pick spots and write rover-parking.json
 *   node src/pathfinding/pickRoverParking.js --dry     only print what it would pick
 * Then Mia's steps: node src/safezone/buildRoverHomeFiles.js --force && node src/safezone/checkEvaVersions.js
 *
 * A spot is kept as it is if someone chose it by hand (no "chosen_by" field), like EVA-08's G2.
 *
 * How a spot is chosen. Every cell the rover can drive to from the habitat is a candidate if it is
 *   - flat: slope at most PARKING.flatDeg (the rover limit is 15°, but people get on and off here)
 *   - walkable, and at least PARKING.minFromStopM from every stop (don't drive over a science site)
 * and its plan passes the team's safety rules (same as Mia's roverSafety.js):
 *   - walk-back: if the rover is found broken on returning to it, walking home ends within the 8 h suit
 *   - storm plan: from the end of every stop, walk back to the rover and drive home within the 8 h suit
 * Of those, the one with the least suit time wins: drive out + walk the stops from the rover + walk
 * back to it + drive home. Walking between the stops and science time are the same wherever the
 * rover parks, so this comes down to "short drive, short walk to the first stop and back from the last".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { makeGrid, xyToCell, cellToXY } from './walkingTime.js'
import { routeLeg } from './astar.js'
import { makeRoverGrid, driveDistanceMap, driveMinutes, driveRoute, roverRulesFrom } from './rover.js'
import { walkTimeMap } from '../safezone/timeHome.js'
import { EVAS, evaSetup } from '../safezone/evaSetup.js'

export const PARKING = { flatDeg: 5, minFromStopM: 50 }

/**
 * Best parking spot for one EVA, or null if the rover can't help (no candidate passes the rules).
 * Returns { cell, x, y, slopeDeg, driveM, driveMinutes, totalMinutes, walkBackMinutes, walkBackArrive,
 *           stormWorstArrive, footMinutes } (all minutes are suit minutes from the start of the EVA).
 */
export function pickParking({ grid, roverGrid, rules, mission, habitat, stops, settings = PARKING }) {
  const suit = mission.max_walk_minutes
  const cellOf = (p) => {
    const c = xyToCell(grid, p.x, p.y)
    if (c < 0) throw new Error(`${p.name ?? p.id} is outside the map.`)
    return c
  }
  const habCell = cellOf(habitat)
  const drive = driveDistanceMap(roverGrid, habCell)
  const toFirst = walkTimeMap(grid, cellOf(stops[0]), 'to').time // seconds, spot -> first stop
  const fromStop = stops.map((s) => walkTimeMap(grid, cellOf(s), 'from').time) // seconds, stop -> spot
  const walkHome = walkTimeMap(grid, habCell, 'to').time // seconds, spot -> habitat (walk-back)

  // Walking between the stops and the science: the same wherever the rover is.
  // doneAt[k] = minutes from reaching the first stop to finishing the science at stop k.
  const doneAt = []
  let t = 0
  stops.forEach((s, k) => {
    if (k > 0) {
      const leg = routeLeg(grid, stops[k - 1], s)
      if (!leg) throw new Error(`No safe walk from ${stops[k - 1].name} to ${s.name}.`)
      t += leg.seconds / 60
    }
    t += s.stop_minutes ?? 0
    doneAt.push(t)
  })
  const loop = doneAt.at(-1)

  // On foot, for comparison: habitat -> stops -> habitat.
  const footMinutes = toFirst[habCell] / 60 + loop + fromStop.at(-1)[habCell] / 60

  const minFromStop2 = settings.minFromStopM ** 2
  let best = null
  for (let i = 0; i < drive.length; i++) {
    if (!(drive[i] < Infinity) || grid.blocked[i] || grid.slope[i] > settings.flatDeg) continue
    const { x, y } = cellToXY(grid, i)
    if (stops.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < minFromStop2)) continue
    const driveMin = driveMinutes(drive[i], rules)
    const out = toFirst[i] / 60
    const back = fromStop.at(-1)[i] / 60
    if (!(out < Infinity && back < Infinity && walkHome[i] < Infinity)) continue
    const total = 2 * driveMin + out + loop + back
    if (best && total + 0.1 * grid.slope[i] >= best.score) continue // cheap test first
    // Walk-back: rover broken when the crew gets back to it.
    const walkBackArrive = driveMin + out + loop + back + walkHome[i] / 60
    if (walkBackArrive > suit) continue
    // Storm plan: from the end of every stop, walk to the rover and drive home.
    let stormWorst = 0
    for (let k = 0; k < stops.length; k++) stormWorst = Math.max(stormWorst, driveMin + out + doneAt[k] + fromStop[k][i] / 60 + driveMin)
    if (stormWorst > suit) continue
    best = {
      score: total + 0.1 * grid.slope[i], // a little preference for flatter ground
      cell: i, x, y, slopeDeg: grid.slope[i], driveM: drive[i], driveMinutes: driveMin, totalMinutes: total,
      walkBackMinutes: walkHome[i] / 60, walkBackArrive, stormWorstArrive: stormWorst, footMinutes,
    }
  }
  return best
}

const round1 = (v) => Math.round(v * 10) / 10

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pub = new URL('../../public/', import.meta.url)
  const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
  const files = {
    area: load('terrain/area.json'),
    catalog: load('routes/scenarios.json'),
    boxwork: load('routes/science-stops.json'),
    gediz: load('routes/gediz-stops.json'),
    parking: load('routes/rover-parking.json'),
  }
  const mission = load('routes/sample-route.json').mission
  const grid = makeGrid({ elevation: load('terrain/elevation.json'), slope: load('terrain/slope.json'), roughness: load('terrain/roughness.json') })
  const rules = roverRulesFrom(files.parking)
  const roverGrid = makeRoverGrid(grid, rules)
  const { west, south } = files.area.boundsProjected
  const m = (v) => `${Math.round(v)} min`

  for (const eva of EVAS) {
    const entry = files.parking.evas.find((e) => e.eva === eva)
    const { habitat, stops } = evaSetup(eva, files)
    if (entry?.spot && !entry.spot.chosen_by) {
      // Chosen by hand (EVA-08's G2): keep it, but show the real rover route for comparison.
      const spot = { x: entry.spot.easting - west, y: entry.spot.northing - south }
      const d = driveRoute(grid, habitat, spot, rules, roverGrid)
      console.log(`EVA-${eva}: keeping ${entry.spot.id}. Rover route from ${habitat.id}: ${d ? `${d.distance_m} m, ${m(d.minutes)} (file says ${entry.spot.drive_distance_m} m)` : 'none: the rover cannot reach it'}`)
      continue
    }
    const best = pickParking({ grid, roverGrid, rules, mission, habitat, stops })
    if (!best) {
      console.log(`EVA-${eva}: no parking spot passes the rules; the rover version is not possible.`)
      if (entry) entry.spot = null
      continue
    }
    const route = driveRoute(grid, habitat, best, rules, roverGrid)
    const id = `R${eva}`
    entry.spot = {
      id,
      name: `Rover parking (EVA-${eva})`,
      easting: best.x + west,
      northing: best.y + south,
      drive_distance_m: route.distance_m,
      drive_minutes: round1(route.minutes),
      slope_deg: round1(best.slopeDeg),
      max_drive_slope_deg: round1(route.max_slope_deg),
      walk_back_minutes: round1(best.walkBackMinutes),
      home_file: `home-${id.toLowerCase()}-6km`,
      drive_path: route.path.map((p) => [p.x + west, p.y + south]),
      chosen_by: 'pickRoverParking.js',
      note: `Flat spot (${round1(best.slopeDeg)}°) the rover reaches from ${habitat.id} on ground up to ${rules.maxSlopeDeg}°. Picked for the least suit time; re-run pickRoverParking.js if the stops or terrain change.`,
    }
    console.log(`EVA-${eva} (${habitat.id}): ${id} at x ${best.x}, y ${best.y} (${best.slopeDeg.toFixed(1)}°). Drive ${route.distance_m} m, ${m(route.minutes)} each way.`
      + ` Plan ${m(best.totalMinutes)} with rover vs ${m(best.footMinutes)} on foot. Walk-back ${m(best.walkBackMinutes)}, home by ${m(best.walkBackArrive)}; storm worst home by ${m(best.stormWorstArrive)}.`)
  }

  if (process.argv.includes('--dry')) console.log('\n--dry: rover-parking.json not changed.')
  else {
    writeFileSync(new URL('routes/rover-parking.json', pub), JSON.stringify(files.parking, null, 1) + '\n')
    console.log('\nWrote public/routes/rover-parking.json. Next (Mia): node src/safezone/buildRoverHomeFiles.js --force')
  }
}
