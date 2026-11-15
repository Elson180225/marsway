// Pure route maths for the Walk screen. No DOM or Leaflet here, so it can be tested in Node.
// Coordinates are local metres from the shared route contract: x = east, y = north.
import { bonusStopCheck } from '../../safezone/bonusStop.js'
import { walkDoseMSv, doseSoFar } from '../../safezone/radiation.js'
import { heightAt, xyToCell } from '../../pathfinding/walkingTime.js'
import { etaFor, paceFactor } from '../../pathfinding/navigation.js'
import { nextDirection } from '../../pathfinding/directions.js'
import { activeEvents } from '../../safezone/randomEvents.js'
import { currentSolarStorm, shelterRoute } from '../../pathfinding/shelter.js'

const LEVEL_RANK = { danger: 0, caution: 1, info: 2 }
export const PACE_WINDOW_MINUTES = 10 // the pace is measured over about the last 10 planned minutes of walking

// Walking minutes for a leg: the terrain estimate in seconds when there is one.
function legMinutes(leg) {
  return Number.isFinite(leg.seconds) ? leg.seconds / 60 : leg.walk_minutes
}

// Science time planned at a stop (Kelly's stop_minutes). The habitat and home have none.
export function scienceMinutes(stop) {
  if (!stop || stop.type === 'habitat' || stop.type === 'home') return 0
  return Number.isFinite(stop.stop_minutes) && stop.stop_minutes > 0 ? stop.stop_minutes : 0
}

export function segmentLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function pathLength(path) {
  let total = 0
  for (let i = 1; i < path.length; i++) total += segmentLength(path[i - 1], path[i])
  return total
}

// Point at a fraction (0..1) of the path's geometric length, plus the index of the next vertex ahead.
export function pointAlong(path, fraction) {
  if (path.length === 1) return { point: { ...path[0] }, nextIndex: 0 }
  const target = Math.min(Math.max(fraction, 0), 1) * pathLength(path)
  let walked = 0
  for (let i = 1; i < path.length; i++) {
    const length = segmentLength(path[i - 1], path[i])
    if (walked + length >= target && length > 0) {
      const t = (target - walked) / length
      const a = path[i - 1]
      const b = path[i]
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, nextIndex: i }
    }
    walked += length
  }
  return { point: { ...path[path.length - 1] }, nextIndex: path.length - 1 }
}

// Portion of a path from its start up to `fraction`, as a list of points.
export function pathUntil(path, fraction) {
  const { point, nextIndex } = pointAlong(path, fraction)
  return [...path.slice(0, nextIndex), point]
}

// Compass bearing in degrees clockwise from north (map up).
export function bearing(from, to) {
  return (Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI + 360) % 360
}

export function cardinal(degrees) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return names[Math.round(degrees / 45) % 8]
}

// Where the leg's warnings are worst, so the map can pin them: the steepest spot for "steep_slope",
// the roughest for "rough_ground". Only warnings the route planner raised for this trip get a spot.
// The path is sampled every half cell. Returns [{ type, level, point, along }], where `along` is
// metres from the start of trip.path (compare with progress * pathLength(trip.path)).
const HAZARD_LAYERS = { steep_slope: ['slope', 'slopeWarnDeg'], rough_ground: ['roughness', 'roughWarnDeg'] }

export function hazardSpots(grid, trip) {
  const spots = []
  for (const warning of trip.warnings || []) {
    const [layer, limitName] = HAZARD_LAYERS[warning.type] || []
    const values = grid?.[layer]
    const limit = grid?.suit?.[limitName]
    if (!values || !Number.isFinite(limit)) continue
    let best = null
    let walked = 0
    for (let i = 1; i < trip.path.length; i++) {
      const a = trip.path[i - 1]
      const b = trip.path[i]
      const length = segmentLength(a, b)
      const steps = Math.max(1, Math.ceil(length / (grid.cellSize / 2)))
      for (let s = 0; s <= steps; s++) {
        const point = { x: a.x + (b.x - a.x) * (s / steps), y: a.y + (b.y - a.y) * (s / steps) }
        const cell = xyToCell(grid, point.x, point.y)
        const value = cell < 0 ? -Infinity : values[cell]
        if (value > limit && (!best || value > best.value)) best = { type: warning.type, level: warning.level, point, along: walked + length * (s / steps), value }
      }
      walked += length
    }
    if (best) spots.push(best)
  }
  return spots
}

/**
 * The ground at a point, for the Data page: height, slope and roughness from the terrain grid, and how
 * it compares with the suit's limits (warning above slopeWarnDeg or roughWarnDeg, no-go above slopeNoGoDeg).
 * Returns { heightM, slopeDeg, roughDeg, level: 'ok' | 'caution' | 'danger' }, or null off the map.
 */
export function groundAt(grid, point) {
  const cell = xyToCell(grid, point.x, point.y)
  if (cell < 0) return null
  const slopeDeg = grid.slope ? grid.slope[cell] : null
  const roughDeg = grid.roughness ? grid.roughness[cell] : null
  const { slopeWarnDeg, slopeNoGoDeg, roughWarnDeg } = grid.suit
  const level = slopeDeg > slopeNoGoDeg ? 'danger' : slopeDeg > slopeWarnDeg || roughDeg > roughWarnDeg ? 'caution' : 'ok'
  return { heightM: heightAt(grid, point.x, point.y), slopeDeg, roughDeg, level }
}

/**
 * Up, down and the worst ground along a path (one leg), checked every grid cell, for the Data page.
 * Returns { climbM, descentM, steepestDeg, roughestDeg }.
 */
export function pathGround(grid, path) {
  const step = grid.cellSize
  let climbM = 0
  let descentM = 0
  let steepestDeg = 0
  let roughestDeg = 0
  let last = null
  const visit = (x, y) => {
    const h = heightAt(grid, x, y)
    if (last !== null) { if (h > last) climbM += h - last; else descentM += last - h }
    last = h
    const cell = xyToCell(grid, x, y)
    if (cell < 0) return
    if (grid.slope) steepestDeg = Math.max(steepestDeg, grid.slope[cell])
    if (grid.roughness) roughestDeg = Math.max(roughestDeg, grid.roughness[cell])
  }
  if (path.length) visit(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const n = Math.max(1, Math.ceil(segmentLength(a, b) / step))
    for (let k = 1; k <= n; k++) visit(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n)
  }
  return { climbM, descentM, steepestDeg, roughestDeg }
}

export function sortWarnings(warnings) {
  return [...warnings].sort((a, b) => (LEVEL_RANK[a.level] ?? 3) - (LEVEL_RANK[b.level] ?? 3))
}

export function returnFor(route, stopId) {
  return route.returns.find((item) => item.from_stop_id === stopId)
}

/**
 * The leg the crew is walking right now.
 * state: { mode: 'outbound' | 'return' | 'complete', legIndex, progress, returnTrip, scienceLeft, cutShortAt }
 *   scienceLeft: minutes of science still to do at the stop the crew is at (progress 0), else 0.
 *   cutShortAt:  id of the stop the crew headed home from before its science was done, else null.
 * Returns { path, distance_m, walk_minutes, warnings, from, to }.
 */
export function currentTrip(route, state) {
  if (state.mode === 'complete') {
    const home = route.stops.at(-1)
    return { path: [{ x: home.x, y: home.y }], distance_m: 0, walk_minutes: 0, warnings: [], from: home, to: home }
  }
  if (state.mode === 'return') return state.returnTrip
  const leg = route.legs[Math.min(state.legIndex, route.legs.length - 1)]
  return {
    path: leg.path,
    distance_m: leg.distance_m,
    walk_minutes: legMinutes(leg),
    warnings: leg.warnings || [],
    from: route.stops[state.legIndex],
    to: route.stops[state.legIndex + 1],
  }
}

// Build the trip home from the crew's current spot: walk back along the current leg, then follow
// the planned return path from the stop they last left.
export function buildReturnTrip(route, state, navigation = null) {
  if (navigation) {
    const trip = currentTrip(route, state)
    const { point } = pointAlong(trip.path, state.progress)
    return { ...navigation.homeFrom(point), from: trip.from, to: route.stops.at(-1) }
  }
  const leg = route.legs[state.legIndex]
  const fromStop = route.stops[state.legIndex]
  const home = returnFor(route, fromStop.id)
  const back = state.progress > 0 ? pathUntil(leg.path, state.progress).reverse() : []
  const path = back.length ? [...back, ...home.path.slice(1)] : home.path
  return {
    path,
    distance_m: Math.round(state.progress * leg.distance_m + home.distance_m),
    walk_minutes: state.progress * leg.walk_minutes + home.walk_minutes,
    warnings: state.progress > 0 ? leg.warnings || [] : [],
    from: fromStop,
    to: route.stops.find((stop) => stop.type === 'home') || route.stops[0],
  }
}

/**
 * How much slower than planned the crew is walking: 1 = on plan, 1.3 = 30% slower. Measured from the
 * walking timed so far (state.paceLog, kept by advance()) with Nigel's paceFactor(), so it stays 1
 * until about 5 planned minutes have been walked. Science time is not part of it.
 */
export function walkPace(state) {
  const log = state.paceLog
  return log ? paceFactor({ plannedMinutes: log.planned, actualMinutes: log.actual }) : 1
}

// Add walking to the pace log. Older walking fades out, so the pace follows the last few minutes.
function logPace(state, plannedMinutes, actualMinutes) {
  const log = state.paceLog ?? (state.paceLog = { planned: 0, actual: 0 })
  log.planned += plannedMinutes
  log.actual += actualMinutes
  if (log.planned > PACE_WINDOW_MINUTES) {
    const keep = PACE_WINDOW_MINUTES / log.planned
    log.planned *= keep
    log.actual *= keep
  }
}

// Estimated minutes to walk home from the current position, at the crew's measured pace.
export function minutesHome(route, state, navigation = null) {
  if (state.mode === 'complete') return 0
  const pace = walkPace(state)
  const trip = currentTrip(route, state)
  if (navigation) return navigation.homeFrom(pointAlong(trip.path, state.progress).point).walk_minutes * pace
  if (state.mode === 'return' || trip.to?.type === 'home') return trip.walk_minutes * (1 - state.progress) * pace
  const fromHome = returnFor(route, trip.from.id).walk_minutes
  const toHome = returnFor(route, trip.to.id).walk_minutes
  return (fromHome + (toHome - fromHome) * state.progress) * pace
}

/**
 * Safety check against the suit budget. Turn-back is computed, not taken from the route file:
 *   turn back by = suit deadline − protected reserve − time to walk home from here
 * Walking times are at the crew's measured pace (walkPace), so walking slower brings turn-back closer.
 * Returns { level, title, message, homeMinutes, reserveAtHome, turnbackIn, nextStopOk }.
 *   turnbackIn: minutes until the crew must start heading home (negative = already late).
 *   nextStopOk: false when walking on to the next stop would leave too little time to get home
 *               with the reserve intact (null when the next stop is home or not applicable).
 */
export function safetyStatus(route, state, clockMs, navigation = null) {
  const { mission } = route
  const suitEnd = Date.parse(mission.start_time) + mission.max_walk_minutes * 60000
  const homeMinutes = minutesHome(route, state, navigation)
  const reserveAtHome = (suitEnd - clockMs) / 60000 - homeMinutes
  const turnbackIn = reserveAtHome - mission.reserve_minutes

  let nextStopOk = null
  const trip = currentTrip(route, state)
  const nextScience = scienceMinutes(trip.to)
  if (state.mode === 'outbound' && trip.to.type !== 'home') {
    // Finish the science here, walk there, do the science planned there, then walk home.
    const pace = walkPace(state)
    const arriveMs = clockMs + ((state.scienceLeft || 0) + trip.walk_minutes * (1 - state.progress) * pace) * 60000
    const homeFromNext = (navigation ? navigation.homeFrom(trip.to).walk_minutes : returnFor(route, trip.to.id).walk_minutes) * pace
    nextStopOk = (suitEnd - arriveMs) / 60000 - nextScience - homeFromNext >= mission.reserve_minutes
  }

  const result = (level, title, message) => ({ level, title, message, homeMinutes, reserveAtHome, turnbackIn, nextStopOk })
  if (state.mode === 'complete') return result('info', 'EVA complete', 'Crew is back at the habitat.')
  if (reserveAtHome <= 0) return result('danger', 'Suit time short', 'Projected to run out before reaching the habitat. Head home now.')
  if (state.mode === 'return') {
    return turnbackIn < 0
      ? result('caution', 'Using reserve', 'Getting home will use part of the protected suit reserve.')
      : result('ok', 'Heading home', 'Reserve stays intact on the way home.')
  }
  if (turnbackIn <= 0) return result('danger', 'Turn back now', 'Heading home now already uses part of the protected reserve.')
  if (nextStopOk === false) return result('caution', `Skip ${trip.to.name}?`, nextScience ? `Reaching it and doing its ${Math.round(nextScience)} min of science would leave too little time to get home with the reserve intact.` : 'Reaching it would leave too little time to get home with the reserve intact.')
  if (turnbackIn <= 30) return result('caution', 'Turn back soon', 'Less than 30 minutes before you must start heading home.')
  return result('ok', 'On plan', 'Enough suit time to reach home with the reserve intact.')
}

/**
 * Move the simulation on by `minutes` of mission time. Changes and returns `state`.
 * Arriving at a stop starts the science planned there (state.scienceLeft), which uses suit time
 * like walking does. The walk pauses when that science is done (or on arrival if none is planned),
 * so the crew can choose to walk on or head home.
 * state.simPace (demo, default 1) is how much slower than planned the simulated crew really walks.
 * The screen doesn't use it for its estimates: it measures the pace from the walking (walkPace).
 */
export function advance(route, state, minutes) {
  if (state.mode === 'complete' || !(minutes > 0)) return state
  if (state.scienceLeft > 0) {
    const used = Math.min(minutes, state.scienceLeft)
    state.clockMs += used * 60000
    state.scienceLeft -= used
    if (state.scienceLeft < 1e-9) {
      state.scienceLeft = 0
      state.playing = false
    }
    return state
  }
  const trip = currentTrip(route, state)
  const slower = state.simPace > 0 ? state.simPace : 1
  const legMinutesNow = trip.walk_minutes * slower // how long this leg really takes the crew
  const used = Math.min(minutes, Math.max(0, (1 - state.progress) * legMinutesNow))
  state.clockMs += used * 60000
  state.progress += used / legMinutesNow
  logPace(state, used / slower, used)
  if (state.progress < 1 - 1e-9) return state
  if (state.mode === 'return' || trip.to.type === 'home') {
    state.mode = 'complete'
    state.progress = 1
    state.playing = false
  } else {
    state.legIndex += 1
    state.progress = 0
    state.scienceLeft = scienceMinutes(route.stops[state.legIndex])
    if (!state.scienceLeft) state.playing = false
  }
  return state
}

// "Head home" is for the way out, once the crew has left the habitat. When the next stop is home,
// walking on already heads home, but the crew can still cut the science at this last stop short.
export function canHeadHome(route, state) {
  if (state.mode !== 'outbound') return false
  if (state.legIndex === 0 && state.progress === 0) return false
  return state.scienceLeft > 0 || currentTrip(route, state).to.type !== 'home'
}

/**
 * Turn for home from where the crew is now. Changes and returns `state` (unchanged if the way home
 * can't be worked out: buildReturnTrip throws). This clears scienceLeft, so a stop left before its
 * science was done is kept in state.cutShortAt; the bonus tile must not call that visit "done".
 */
export function headHome(route, state, navigation = null) {
  const returnTrip = buildReturnTrip(route, state, navigation)
  state.cutShortAt = state.scienceLeft > 0 ? currentTrip(route, state).from.id : null
  state.returnTrip = returnTrip
  state.mode = 'return'
  state.progress = 0
  state.scienceLeft = 0
  state.playing = true
  return state
}

// Minutes from now until the crew arrives at stop `target` (outbound): the science still to do here,
// the rest of this leg, then the science and walking at each stop in between. Walking is at the
// crew's measured pace.
export function minutesToReach(route, state, target) {
  const pace = walkPace(state)
  let minutes = (state.scienceLeft || 0) + legMinutes(route.legs[state.legIndex]) * (1 - state.progress) * pace
  for (let k = state.legIndex + 1; k < target; k++) minutes += scienceMinutes(route.stops[k]) + legMinutes(route.legs[k]) * pace
  return minutes
}

/**
 * Arrival time at every stop still ahead and at home, at the crew's measured pace (Nigel's etaFor()).
 * Outbound this follows the plan: every stop left, then home. On the way home it is just home.
 * Returns etaFor()'s { stops: [{ id, name, is_bonus, arrive_ms, leave_ms, science_minutes }], home_ms, ... }
 */
export function arrivalTimes(route, state) {
  const nowMs = state.clockMs
  if (state.mode === 'complete') return { stops: [], home_ms: nowMs, walking_minutes: 0, science_minutes: 0, minutes_left: 0 }
  const options = { nowMs, progress: state.progress, paceFactor: walkPace(state) }
  if (state.mode === 'return') {
    const trip = currentTrip(route, state)
    return etaFor({ stops: [trip.from, trip.to], legs: [trip] }, options)
  }
  return etaFor(route, { ...options, legIndex: state.legIndex, scienceLeft: state.scienceLeft || 0 })
}

/**
 * The turn-by-turn line for the next-stop card, from Nigel's directionsFor() steps for this trip.
 * metresAlong: how far along the trip's path the crew is (progress × pathLength(path)).
 * Before setting off it is the first step ("Head north-east, gently uphill, for 180 m"); after that
 * the next turn ("In 200 m, bear left to head north, …").
 * Returns { turn, lead, rest, text }: lead is the part to read first ("In 200 m, bear left"), rest the
 * part after it (" to head north, downhill (about 8°), for 350 m"), text both together.
 */
export function directionLine(steps, metresAlong) {
  if (!steps?.length) return null
  const { next, text } = metresAlong < 1 && steps[0].turn === 'start'
    ? { next: steps[0], text: steps[0].text }
    : nextDirection(steps, metresAlong)
  const cut = text.indexOf(' to head ')
  return { turn: next.turn, lead: cut < 0 ? text : text.slice(0, cut), rest: cut < 0 ? '' : text.slice(cut), text }
}

// Minutes behind the planned walking and science times (e.g. after staying longer at a stop).
// null once heading home, because the plan no longer applies.
export function minutesBehindPlan(route, state, clockMs) {
  if (state.mode !== 'outbound') return null
  let planned = state.progress * legMinutes(route.legs[state.legIndex]) - (state.scienceLeft || 0)
  for (let k = 0; k < state.legIndex; k++) planned += legMinutes(route.legs[k]) + scienceMinutes(route.stops[k + 1])
  return (clockMs - Date.parse(route.mission.start_time)) / 60000 - planned
}

/**
 * Bonus-stop GO / NO-GO with Mia's bonusStopCheck() (safezone/bonusStop.js), so the phone agrees
 * with the safe zone on the Planning map. "Walk there" is the planned time from here to the bonus
 * stop (minutesToReach), so far from it this answers "if we keep to the plan, will it fit?".
 * Walking there and home from it are at the crew's measured pace (walkPace).
 * safezone: { grid, timeHome }, the terrain grid and the time-home map (navigation.timeHome).
 * Returns null if the route has no bonus stop, otherwise { stop, phase, decideNow, ...Mia's result }
 *   phase      'ahead' (still to come) | 'here' (at it) | 'done' (its science was finished)
 *              | 'incomplete' (headed home during its science) | 'skipped' (went home first)
 *   decideNow  the bonus stop is the next stop, so this is the moment to choose
 *   Mia's result (phase 'ahead' only): { go, level, title, message, spareMinutes, homeFromBonusMinutes, ... }
 */
export function bonusStatus(route, state, clockMs, { grid, timeHome }) {
  const index = route.stops.findIndex((stop) => stop.is_bonus === true && stop.type !== 'home')
  if (index < 0) return null
  const stop = route.stops[index]
  const reached = state.legIndex >= index
  if (state.mode !== 'outbound') {
    const phase = state.cutShortAt === stop.id ? 'incomplete' : reached ? 'done' : 'skipped'
    return { stop, phase, decideNow: false }
  }
  if (reached) return { stop, phase: state.legIndex === index && state.progress === 0 ? 'here' : 'done', decideNow: false }
  const { mission } = route
  const check = bonusStopCheck(grid, timeHome, {
    here: pointAlong(currentTrip(route, state).path, state.progress).point,
    bonus: stop,
    elapsedMinutes: (clockMs - Date.parse(mission.start_time)) / 60000,
    stopMinutes: scienceMinutes(stop),
    walkThereMinutes: minutesToReach(route, state, index),
    settings: { suitHours: mission.max_walk_minutes / 60, reserveHours: mission.reserve_minutes / 60 },
    paceFactor: walkPace(state), // walking home from it at the crew's measured pace too
  })
  return { ...check, stop, phase: 'ahead', decideNow: state.legIndex === index - 1 }
}

// The stop whose photo and task the Walk screen shows: the stop the crew is at, or the next stop
// while walking there. None on the way home or once the walk is over.
//   Returns { stop, here } (here = the crew is at it) or null.
export function photoStop(route, state) {
  if (state.mode !== 'outbound') return null
  const trip = currentTrip(route, state)
  const here = state.progress === 0 && state.legIndex > 0
  const stop = here ? trip.from : trip.to
  return stop && stop.type !== 'home' && stop.type !== 'habitat' ? { stop, here } : null
}

// How far from the stop a "nearby view" photo was taken, in whole metres (19.5 m -> 20), or null when
// that photo's distance isn't known. Kelly: no number when it is unverified (photo_offset_status
// 'unverified', e.g. the reviewed Gediz photos), even if a number is filled in.
export function photoDistance(stop) {
  if (stop?.photo_view !== 'nearby' || stop.photo_offset_status === 'unverified') return null
  return Number.isFinite(stop.photo_offset_m) ? Math.round(stop.photo_offset_m) : null
}

// Radiation so far, and for the whole walking budget (suit time minus the reserve: 8 h - 2 h = 6 h),
// from Mia's radiation.js: about 0.67 mSv a day on the surface at Gale Crater (Curiosity's RAD),
// doubled while a solar storm is on. The crew is outside from the start until now (the walk clock
// stops once they are home). storms: [{ startMs, endMs }] solar storm windows, endMs null = still on.
// Returns { soFarMSv, walkHours, fullWalkMSv, stormMinutes, stormExtraMSv }.
export function radiationDose(route, clockMs, storms = []) {
  const { mission } = route
  const walkHours = (mission.max_walk_minutes - mission.reserve_minutes) / 60
  const startMs = Date.parse(mission.start_time)
  const dose = doseSoFar({ periods: [{ startMs, endMs: Math.max(startMs, clockMs), inside: false }], storms })
  return { soFarMSv: dose.doseMSv, walkHours, fullWalkMSv: walkDoseMSv(walkHours), stormMinutes: dose.stormMinutes, stormExtraMSv: dose.stormExtraMSv }
}

// Mia's random events (safezone/randomEvents.js) on the Walk screen. The events themselves come from
// scenarioEvents() in src/scenarioEvents.js, the same as on Planning.
const EVENT_LEVELS = { global_dust_storm: 'danger', solar_storm: 'danger', rover_breakdown: 'danger', dust_storm: 'caution', dust_devil: 'caution' }
const eventTimes = (route, event) => {
  const startMs = Date.parse(route.mission.start_time) + event.startMin * 60000
  return { startMs, endMs: event.durationMin == null ? null : startMs + event.durationMin * 60000 }
}

/**
 * The random events happening `minutesOut` minutes into the walk, as alerts for the map pop-up and the
 * Data page (same shape as route alerts). A solar storm's shelter is the habitat.
 * Each: { type, level, message, simulated: true, shelter_stop_id, startMs, endMs (null = to the end), event }
 */
export function eventAlerts(route, events, minutesOut) {
  return activeEvents(events, minutesOut).map((event) => ({
    type: event.type, level: EVENT_LEVELS[event.type] ?? 'caution', message: event.message, simulated: true,
    shelter_stop_id: event.type === 'solar_storm' ? route.stops[0].id : null, ...eventTimes(route, event), event,
  }))
}

/** The random solar storms as { startMs, endMs } windows on the walk clock, for doseSoFar() (radiation ×2). */
export function eventSolarStorms(route, events) {
  return events.filter((event) => event.type === 'solar_storm').map((event) => eventTimes(route, event))
}

// Alerts from the route file, e.g. solar storms. Shelter must be an existing stop or null.
export const ALERT_LEVELS = ['info', 'caution', 'danger']

export function shelterFor(route, alert) {
  return alert.shelter_stop_id == null ? null : route.stops.find((stop) => stop.id === alert.shelter_stop_id) || null
}

/**
 * Nigel's shelter route (pathfinding/shelter.js) for the solar storm the crew should react to now:
 * warned about (Mia's warningMin) or on. The Walk screen is on foot, so the shelter is the habitat and
 * there is no rover. Walking is slower in a dust storm under way (its speedFactor, 0.6).
 *   events   Mia's events plus the ☀︎ Storm demo button's storms, as { type, startMin, durationMin }
 *   crew     { x, y } where the crew is now
 * Returns shelterRoute()'s result plus `storm` (with its phase: 'warning' | 'on'), or null when no
 * storm needs a reaction (or there is no way home from here).
 */
export function stormShelter(route, grid, events, minutesOut, crew) {
  const nowMin = Math.max(0, minutesOut)
  const storm = currentSolarStorm(events, nowMin)
  if (!storm) return null
  const dust = activeEvents(events, nowMin).find((event) => event.type === 'dust_storm')
  const home = route.stops[0]
  const result = shelterRoute({
    grid, crew, nowMin, storm, rover: null, walkSpeed: dust?.speedFactor ?? 1,
    habitat: { id: home.id, name: home.name, x: home.x, y: home.y },
  })
  if (!result) return null
  // Already at the habitat (e.g. before setting out): nothing to walk, so say "stay inside".
  const atShelter = result.minutes < 0.5
  const message = !atShelter ? result.message
    : `Solar storm ${storm.phase === 'warning' ? `in ${Math.round(result.startsInMin)} min` : 'now'}: stay inside ${home.name}.`
  return { ...result, storm, atShelter, message }
}

/** The ☀︎ Storm demo button's storms ({ startMs, endMs } on the walk clock) as solar storm events. */
export function demoStormEvents(route, storms) {
  const startMs = Date.parse(route.mission.start_time)
  return storms.map((storm) => ({
    type: 'solar_storm', startMin: (storm.startMs - startMs) / 60000,
    durationMin: storm.endMs == null ? null : (storm.endMs - storm.startMs) / 60000,
  }))
}
