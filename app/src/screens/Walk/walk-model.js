// Pure route maths for the Walk screen. No DOM or Leaflet here, so it can be tested in Node.
// Coordinates are local metres from the shared route contract: x = east, y = north.
import { bonusStopCheck } from '../../safezone/bonusStop.js'
import { walkDoseMSv } from '../../safezone/radiation.js'

const LEVEL_RANK = { danger: 0, caution: 1, info: 2 }

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

// Estimated minutes to walk home from the current position.
export function minutesHome(route, state, navigation = null) {
  if (state.mode === 'complete') return 0
  const trip = currentTrip(route, state)
  if (navigation) return navigation.homeFrom(pointAlong(trip.path, state.progress).point).walk_minutes
  if (state.mode === 'return' || trip.to?.type === 'home') return trip.walk_minutes * (1 - state.progress)
  const fromHome = returnFor(route, trip.from.id).walk_minutes
  const toHome = returnFor(route, trip.to.id).walk_minutes
  return fromHome + (toHome - fromHome) * state.progress
}

/**
 * Safety check against the suit budget. Turn-back is computed, not taken from the route file:
 *   turn back by = suit deadline − protected reserve − time to walk home from here
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
    const arriveMs = clockMs + ((state.scienceLeft || 0) + trip.walk_minutes * (1 - state.progress)) * 60000
    const homeFromNext = navigation ? navigation.homeFrom(trip.to).walk_minutes : returnFor(route, trip.to.id).walk_minutes
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
  const used = Math.min(minutes, Math.max(0, (1 - state.progress) * trip.walk_minutes))
  state.clockMs += used * 60000
  state.progress += used / trip.walk_minutes
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

// Planned minutes from now until the crew arrives at stop `target` (outbound): the science still to
// do here, the rest of this leg, then the science and walking at each stop in between.
export function minutesToReach(route, state, target) {
  let minutes = (state.scienceLeft || 0) + legMinutes(route.legs[state.legIndex]) * (1 - state.progress)
  for (let k = state.legIndex + 1; k < target; k++) minutes += scienceMinutes(route.stops[k]) + legMinutes(route.legs[k])
  return minutes
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
  })
  return { ...check, stop, phase: 'ahead', decideNow: state.legIndex === index - 1 }
}

// Radiation so far, and for the whole walking budget (suit time minus the reserve: 8 h - 2 h = 6 h),
// from Mia's walkDoseMSv(): about 0.67 mSv a day on the surface at Gale Crater (Curiosity's RAD).
export function radiationDose(route, clockMs) {
  const { mission } = route
  const walkHours = (mission.max_walk_minutes - mission.reserve_minutes) / 60
  const hoursOut = Math.max(0, clockMs - Date.parse(mission.start_time)) / 3600000
  return { soFarMSv: walkDoseMSv(hoursOut), walkHours, fullWalkMSv: walkDoseMSv(walkHours) }
}

// Alerts from the route file, e.g. solar storms. Shelter must be an existing stop or null.
export const ALERT_LEVELS = ['info', 'caution', 'danger']

export function shelterFor(route, alert) {
  return alert.shelter_stop_id == null ? null : route.stops.find((stop) => stop.id === alert.shelter_stop_id) || null
}
