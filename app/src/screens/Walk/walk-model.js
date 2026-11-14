// Pure route maths for the Walk screen. No DOM or Leaflet here, so it can be tested in Node.
// Coordinates are local metres from the shared route contract: x = east, y = north.

const LEVEL_RANK = { danger: 0, caution: 1, info: 2 }

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
 * state: { mode: 'outbound' | 'return' | 'complete', legIndex, progress, returnTrip }
 * Returns { path, distance_m, walk_minutes, warnings, from, to }.
 */
export function currentTrip(route, state) {
  if (state.mode === 'return') return state.returnTrip
  const leg = route.legs[Math.min(state.legIndex, route.legs.length - 1)]
  return {
    path: leg.path,
    distance_m: leg.distance_m,
    walk_minutes: leg.walk_minutes,
    warnings: leg.warnings || [],
    from: route.stops[state.legIndex],
    to: route.stops[state.legIndex + 1],
  }
}

// Build the trip home from the crew's current spot: walk back along the current leg, then follow
// the planned return path from the stop they last left.
export function buildReturnTrip(route, state) {
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
export function minutesHome(route, state) {
  if (state.mode === 'complete') return 0
  const trip = currentTrip(route, state)
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
export function safetyStatus(route, state, clockMs) {
  const { mission } = route
  const suitEnd = Date.parse(mission.start_time) + mission.max_walk_minutes * 60000
  const homeMinutes = minutesHome(route, state)
  const reserveAtHome = (suitEnd - clockMs) / 60000 - homeMinutes
  const turnbackIn = reserveAtHome - mission.reserve_minutes

  let nextStopOk = null
  const trip = currentTrip(route, state)
  if (state.mode === 'outbound' && trip.to.type !== 'home') {
    const arriveMs = clockMs + trip.walk_minutes * (1 - state.progress) * 60000
    const homeFromNext = returnFor(route, trip.to.id).walk_minutes
    nextStopOk = (suitEnd - arriveMs) / 60000 - homeFromNext >= mission.reserve_minutes
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
  if (nextStopOk === false) return result('caution', `Skip ${trip.to.name}?`, 'Reaching it would leave too little time to get home with the reserve intact.')
  if (turnbackIn <= 30) return result('caution', 'Turn back soon', 'Less than 30 minutes before you must start heading home.')
  return result('ok', 'On plan', 'Enough suit time to reach home with the reserve intact.')
}

// Alerts from the route file, e.g. solar storms. Shelter must be an existing stop or null.
export const ALERT_LEVELS = ['info', 'caution', 'danger']

export function shelterFor(route, alert) {
  return alert.shelter_stop_id == null ? null : route.stops.find((stop) => stop.id === alert.shelter_stop_id) || null
}
