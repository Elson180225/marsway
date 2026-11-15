/**
 * Route to shelter from a solar storm (Pathfinder 1).
 *
 * A solar storm doubles the radiation outside (Mia's radiation.js). The only shelter is the habitat:
 * the open rover is not a shelter. So:
 *   On foot      walk to the habitat.
 *   With rover   walk back to the rover and drive home, unless walking straight home is quicker
 *                (e.g. the rover is parked next to the habitat) or the rover has broken down.
 *
 * Storms come from Mia's randomEvents() (safezone/randomEvents.js): { type: 'solar_storm', startMin,
 * durationMin, warningMin? }. Times are minutes from the start of the walk, like her events.
 * durationMin null = lasts to the end of the walk. warningMin (optional) = how many minutes before
 * startMin the crew is warned.
 *
 * The dose on the way comes from Mia's doseSoFar(), so it matches the radiation tile everywhere.
 * Mia's storms are flat (×2 from start to end), so "before the peak" means before the storm starts.
 * The storm odds, lengths and warning time are team simulation assumptions (EVENT_RULES in
 * randomEvents.js), not forecasts.
 */
import { routeLeg } from './astar.js'
import { doseSoFar } from '../safezone/radiation.js'

const MS = 60000

/**
 * Where a storm is relative to `nowMin`:
 *   'ahead'    not started and no warning yet
 *   'warning'  warned (now is within warningMin before the start), not started yet
 *   'on'       happening now
 *   'over'     finished
 */
export function stormPhase(storm, nowMin) {
  const end = storm.durationMin == null ? Infinity : storm.startMin + storm.durationMin
  if (nowMin >= end) return 'over'
  if (nowMin >= storm.startMin) return 'on'
  return nowMin >= storm.startMin - (storm.warningMin ?? 0) ? 'warning' : 'ahead'
}

/**
 * The solar storm the crew should react to now: one that is on, or one they have been warned about.
 * events: the list from randomEvents(). Returns the event (with its phase) or null.
 */
export function currentSolarStorm(events, nowMin) {
  for (const storm of events ?? []) {
    if (storm.type !== 'solar_storm') continue
    const phase = stormPhase(storm, nowMin)
    if (phase === 'on' || phase === 'warning') return { ...storm, phase }
  }
  return null
}

/**
 * Quickest way to shelter, starting now.
 *
 *   grid       terrain grid (makeGrid)
 *   crew       { x, y } where the crew is now (local metres)
 *   nowMin     minutes since the walk started
 *   storm      the solar storm event ({ startMin, durationMin, warningMin? })
 *   habitat    { id, name, x, y } the shelter
 *   rover      null on foot. With rover: { id, name, x, y, driveMinutes, drivePath?, available? }
 *              driveMinutes: one drive, including getting on and off (rover-parking.json drive_minutes,
 *              or driveMinutes() in rover.js). drivePath: [{ x, y }] from the habitat to the rover
 *              (rover-parking.json drive_path in local metres), drawn reversed for the way home.
 *              available: false when the rover has broken down.
 *   walkSpeed  walking speed as a fraction of normal (0.6 in a dust storm). Driving is not affected.
 *
 * Returns {
 *   via            'walk' (straight to the habitat) | 'rover' (walk to the rover, drive home)
 *   shelter        the habitat
 *   legs           [{ mode: 'walk' | 'drive', from, to, minutes, distance_m, path }]
 *   minutes        door to door, from now
 *   arriveMin      walk-clock minute they are inside
 *   startsInMin    minutes until the storm starts (0 if it is on)
 *   beforeStorm    true if they are inside before the storm starts
 *   stormMinutesOutside   minutes outside while the storm is on
 *   doseMSv        dose on the way (outside, storm counted)
 *   extraDoseMSv   the part of doseMSv the storm adds
 *   other          the option not taken, { via, minutes } (null if there was none), to show why
 *   atShelter      true if the crew is already at the habitat (under half a minute away): stay inside
 *   message        one line for the alert
 * }  or null if there is no safe way to the habitat at all.
 */
export function shelterRoute({ grid, crew, nowMin, storm, habitat, rover = null, walkSpeed = 1 }) {
  if (!Number.isFinite(nowMin) || nowMin < 0) throw new Error('nowMin must be 0 or more minutes.')
  if (!storm || !Number.isFinite(storm.startMin)) throw new Error('A solar storm needs a startMin.')
  if (!(walkSpeed > 0)) throw new Error('walkSpeed must be more than 0.')
  const walk = (from, to) => {
    const leg = routeLeg(grid, from, to)
    return leg && { mode: 'walk', from, to, minutes: leg.seconds / 60 / walkSpeed, distance_m: leg.distance_m, path: leg.path }
  }

  const options = []
  const direct = walk(crew, habitat)
  if (direct) options.push({ via: 'walk', legs: [direct] })
  if (rover && rover.available !== false) {
    const toRover = walk(crew, rover)
    if (toRover) {
      const drive = { mode: 'drive', from: rover, to: habitat, minutes: rover.driveMinutes, distance_m: rover.driveDistanceM ?? null, path: rover.drivePath ? [...rover.drivePath].reverse() : [rover, habitat] }
      options.push({ via: 'rover', legs: [toRover, drive] })
    }
  }
  if (!options.length) return null
  for (const o of options) o.minutes = o.legs.reduce((sum, leg) => sum + leg.minutes, 0)
  options.sort((a, b) => a.minutes - b.minutes)
  const best = options[0]

  const end = storm.durationMin == null ? null : storm.startMin + storm.durationMin
  const arriveMin = nowMin + best.minutes
  const dose = doseSoFar({
    periods: [{ startMs: nowMin * MS, endMs: arriveMin * MS, inside: false }],
    storms: [{ startMs: storm.startMin * MS, endMs: end == null ? null : end * MS }],
  })
  const startsInMin = Math.max(0, storm.startMin - nowMin)
  const beforeStorm = arriveMin <= storm.startMin
  const result = {
    via: best.via,
    shelter: habitat,
    legs: best.legs,
    minutes: best.minutes,
    arriveMin,
    startsInMin,
    beforeStorm,
    stormMinutesOutside: dose.stormMinutes,
    doseMSv: dose.doseMSv,
    extraDoseMSv: dose.stormExtraMSv,
    other: options[1] ? { via: options[1].via, minutes: options[1].minutes } : null,
    atShelter: best.minutes < 0.5,
  }
  result.message = shelterMessage(result, rover)
  return result
}

/** The rover breakdown that has happened by `nowMin` (Mia's 'rover_breakdown' event), or null. */
export function roverBreakdown(events, nowMin) {
  return (events ?? []).find((e) => e.type === 'rover_breakdown' && nowMin >= e.startMin) ?? null
}

/**
 * Walk-back when the rover breaks down: the walk home to the habitat from where the crew is, and
 * whether it fits the suit. Same levels as Mia's walk-back check (roverSafety.js).
 *
 *   grid, crew, habitat, walkSpeed   as in shelterRoute()
 *   nowMin    suit minutes used so far (minutes since the EVA started, like the events)
 *   mission   { max_walk_minutes, reserve_minutes } (8 h suit, 2 h reserve)
 *
 * Returns {
 *   legs          [{ mode: 'walk', from, to, minutes, distance_m, path }]
 *   minutes       walk home from now
 *   arriveMin     suit minutes used when they get home
 *   level         'ok' (home before the reserve) | 'reserve' (uses the reserve, within the suit) | 'fail'
 *   spareMinutes  minutes left before the reserve when home (negative = into the reserve)
 *   message       one line for the alert
 * }  or null if there is no safe walk home from here.
 */
export function walkBackRoute({ grid, crew, nowMin, habitat, mission, walkSpeed = 1 }) {
  if (!Number.isFinite(nowMin) || nowMin < 0) throw new Error('nowMin must be 0 or more minutes.')
  if (!(walkSpeed > 0)) throw new Error('walkSpeed must be more than 0.')
  const suit = mission.max_walk_minutes
  const usable = suit - mission.reserve_minutes
  const leg = routeLeg(grid, crew, habitat)
  if (!leg) return null
  const minutes = leg.seconds / 60 / walkSpeed
  const arriveMin = nowMin + minutes
  const level = arriveMin <= usable ? 'ok' : arriveMin <= suit ? 'reserve' : 'fail'
  const spareMinutes = usable - arriveMin
  const min = (m) => `${Math.round(m)} min`
  const name = habitat.name ?? habitat.id
  const outcome = level === 'ok' ? `Home with ${min(spareMinutes)} to spare before the reserve.`
    : level === 'reserve' ? `This uses ${min(-spareMinutes)} of the reserve: leave now.`
      : `Not enough suit time: ${min(arriveMin - suit)} short. Call for help.`
  return {
    legs: [{ mode: 'walk', from: crew, to: habitat, minutes, distance_m: leg.distance_m, path: leg.path }],
    minutes, arriveMin, level, spareMinutes,
    message: `Rover broken down. Walk home to ${name}: ${min(minutes)}, ${(leg.distance_m / 1000).toFixed(1)} km. ${outcome}`,
  }
}

function shelterMessage(r, rover) {
  const min = (m) => `${Math.round(m)} min`
  const name = r.shelter.name ?? r.shelter.id
  const how = r.via === 'rover'
    ? `walk ${min(r.legs[0].minutes)} to the rover${rover?.id ? ` (${rover.id})` : ''}, then drive ${min(r.legs[1].minutes)}`
    : rover && rover.available === false ? `walk ${min(r.minutes)} (the rover is out of action)`
      : `walk ${min(r.minutes)}${rover ? ' (quicker than going back to the rover)' : ''}`
  const when = r.startsInMin > 0 ? `Solar storm in ${min(r.startsInMin)}.` : 'Solar storm now: radiation is doubled outside.'
  if (r.atShelter) return `${when} Stay inside ${name}.` // not "walk 0 min. Inside 0 min before it starts"
  const outcome = r.beforeStorm
    ? `Inside ${min(r.startsInMin - r.minutes)} before it starts.`
    : `${min(r.stormMinutesOutside)} outside in the storm, +${r.extraDoseMSv.toFixed(3)} mSv extra.`
  return `${when} Head to ${name} now: ${how}. ${outcome}`
}
