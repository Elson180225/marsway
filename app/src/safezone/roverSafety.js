/**
 * MarsWay safety checks for the two versions of every EVA (Pathfinder 2).
 *
 *   On foot      walk from the habitat to the stops and back.
 *   With rover   drive (open rover, suits on) from the habitat to a parking spot, walk the stops
 *                from the rover, walk back to the rover, drive home.
 *
 * Team rules (same as EVA-08):
 *   - The drive counts against the 8 h suit time; the 2 h reserve stays protected.
 *   - Rover: 5 km/h average plus 10 min on/off per drive; only on slopes up to about 15°.
 *   - Walk-back check: if the rover breaks down, the crew can still walk home to the habitat.
 *   - Storm plan: back to the rover, then drive home. (The rover is open: it is not a shelter.)
 *
 * Checks, all in suit minutes from the start of the EVA:
 *   fits        drive out + walking + science + drive home <= suit time before the reserve (6 h)
 *   stormPlan   from every stop, at the end of its science: walk to the rover (or habitat when on
 *               foot) + drive home. "ok" before the reserve, "reserve" if it needs the reserve
 *               (allowed in an emergency), "fail" if it runs past the 8 h suit.
 *   walkBack    rover only. The rover is found broken on returning to it (the latest, worst moment):
 *               walk from the parking spot to the habitat. Same ok / reserve / fail levels.
 *   parking     rover only. The parking spot is walkable and no steeper than the rover limit.
 */
import { planRoute } from '../pathfinding/astar.js'
import { xyToCell } from '../pathfinding/walkingTime.js'

export const ROVER = { speedKmh: 5, onOffMinutes: 10, maxSlopeDeg: 15 }

/** Minutes for one drive of `distanceM` metres: 5 km/h plus 10 min to get on and off. */
export function driveMinutes(distanceM, rover = ROVER) {
  if (!Number.isFinite(distanceM) || distanceM < 0) throw new Error('Drive distance must be 0 or more metres.')
  return (distanceM / 1000 / rover.speedKmh) * 60 + rover.onOffMinutes
}

// ok before the reserve, reserve if it needs the reserve, fail past the suit time
function level(arriveMinutes, usable, suit) {
  return arriveMinutes <= usable ? 'ok' : arriveMinutes <= suit ? 'reserve' : 'fail'
}

/**
 * Check one version of one EVA.
 *   grid          terrain grid (makeGrid)
 *   mission       { max_walk_minutes, reserve_minutes } (8 h and 2 h)
 *   habitat       { id, x, y } where the crew lives
 *   stops         science stops in visit order, each { id, name, x, y, stop_minutes }
 *   timeHome      seconds home to the habitat from every cell (homeArrows(grid, habitatCell).timeHome)
 *   rover         null for on foot; otherwise { parking: { id, x, y }, driveDistanceM, timeToRover }
 *                 timeToRover: seconds to the parking spot from every cell (its home file)
 * Returns { version, ok, total, usable, spare, driveOut, driveHome, walking, science, checks, problems }
 */
export function checkEvaVersion({ grid, mission, habitat, stops, timeHome, rover = null, roverRules = ROVER }) {
  const suit = mission.max_walk_minutes
  const usable = suit - mission.reserve_minutes
  const base = rover ? rover.parking : habitat
  const problems = []
  const checks = {}

  if (rover) {
    const cell = xyToCell(grid, base.x, base.y)
    const slope = cell >= 0 && grid.slope ? grid.slope[cell] : NaN
    const walkable = cell >= 0 && !grid.blocked[cell]
    checks.parking = { slopeDeg: slope, walkable, ok: walkable && slope <= roverRules.maxSlopeDeg }
    if (!checks.parking.ok) problems.push(`Parking spot ${base.id} is ${walkable ? `${slope.toFixed(1)}° (rover limit ${roverRules.maxSlopeDeg}°)` : 'not walkable'}.`)
  }

  const driveOut = rover ? driveMinutes(rover.driveDistanceM, roverRules) : 0
  const driveHome = driveOut
  const { stops: planned, legs } = planRoute(grid, [
    { ...base, type: 'habitat' }, ...stops, { ...base, id: 'home', name: `Back to ${base.id}`, type: 'home' },
  ])
  // Walk times to the rover (with rover) or home (on foot) from every cell.
  const toBase = rover ? rover.timeToRover : timeHome

  let clock = driveOut
  let walking = 0
  let science = 0
  const storm = []
  legs.forEach((leg, k) => {
    walking += leg.seconds / 60
    clock += leg.seconds / 60
    const stop = planned[k + 1]
    if (stop.type === 'home') return
    const visit = stop.stop_minutes ?? 0
    science += visit
    clock += visit
    // Storm while finishing this stop: walk to the rover (or home), then drive home.
    const cell = xyToCell(grid, stop.x, stop.y)
    const walkBack = cell >= 0 ? toBase[cell] / 60 : Infinity
    const arrive = clock + walkBack + driveHome
    storm.push({ stop: stop.id, name: stop.name, walkMinutes: walkBack, arriveMinutes: arrive, level: level(arrive, usable, suit) })
  })
  const total = driveOut + walking + science + driveHome
  checks.fits = { total, usable, spare: usable - total, ok: total <= usable }
  if (!checks.fits.ok) problems.push(`Plan takes ${Math.round(total)} min, more than the ${usable} min before the reserve.`)

  const worst = storm.reduce((a, b) => (b.arriveMinutes > a.arriveMinutes ? b : a), storm[0] ?? { arriveMinutes: 0, level: 'ok' })
  checks.stormPlan = { worst, stops: storm, ok: storm.every((s) => s.level !== 'fail') }
  if (!checks.stormPlan.ok) problems.push(`Storm plan from ${worst.name} runs past the ${suit} min suit time (${Math.round(worst.arriveMinutes)} min).`)

  if (rover) {
    const cell = xyToCell(grid, base.x, base.y)
    const walkHome = cell >= 0 ? timeHome[cell] / 60 : Infinity
    const backAtRover = driveOut + walking + science
    const arrive = backAtRover + walkHome
    checks.walkBack = { walkHomeMinutes: walkHome, arriveMinutes: arrive, level: level(arrive, usable, suit), ok: arrive <= suit }
    if (!checks.walkBack.ok) problems.push(`If the rover breaks down, walking home from ${base.id} takes ${Number.isFinite(walkHome) ? `${Math.round(walkHome)} min and ends at ${Math.round(arrive)} min, past the ${suit} min suit` : 'forever: no walkable way home'}.`)
  }

  return { version: rover ? 'rover' : 'foot', ok: problems.length === 0, total, usable, spare: usable - total, driveOut, driveHome, walking, science, checks, problems }
}
