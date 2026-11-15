// Planning-only simulation. A speed factor changes travel after the chosen UTC
// start; it does not change the geometry or claim a measured Mars wind speed.
// endUtc is optional: leave it out and the storm lasts to the end of the walk
// (as before); give it and walking goes back to normal speed after it.
export function weatherScenario(startUtc = '', speedFactor = 0.6, endUtc = '') {
  if (!startUtc) return null
  const start = Date.parse(startUtc)
  if (!Number.isFinite(start) || !Number.isFinite(speedFactor) || speedFactor <= 0 || speedFactor > 1) {
    throw new Error('Choose a valid UTC storm start and a speed factor above 0 and at most 1.')
  }
  const scenario = { startUtc: new Date(start).toISOString(), speedFactor }
  if (endUtc) {
    const end = Date.parse(endUtc)
    if (!Number.isFinite(end) || end <= start) throw new Error('The storm end must be a valid UTC time after the start.')
    scenario.endUtc = new Date(end).toISOString()
  }
  return scenario
}

// Storm window in elapsed mission minutes: [start, end). end is Infinity when the storm has no end.
function stormWindow(missionStart, scenario) {
  const start = (Date.parse(scenario.startUtc) - missionStart) / 60000
  const end = scenario.endUtc ? (Date.parse(scenario.endUtc) - missionStart) / 60000 : Infinity
  return { start, end }
}

// timeMinutes is elapsed mission time at departure; duration is walking time
// in calm conditions. Before the storm, walking is unchanged; during it, it
// slows; after it ends, it is back to normal.
export function adjustedTravelMinutes(duration, timeMinutes, missionStart, scenario = null) {
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(timeMinutes) || !Number.isFinite(missionStart)) throw new Error('Invalid planned travel time.')
  if (!scenario) return duration
  if (!Number.isFinite(Date.parse(scenario.startUtc)) || !Number.isFinite(scenario.speedFactor) || scenario.speedFactor <= 0 || scenario.speedFactor > 1) throw new Error('Invalid weather scenario.')
  if (scenario.endUtc && !Number.isFinite(Date.parse(scenario.endUtc))) throw new Error('Invalid weather scenario.')
  const { start, end } = stormWindow(missionStart, scenario)
  let t = timeMinutes
  let work = duration // calm-weather walking minutes still to do
  if (t < start) {
    const calm = Math.min(work, start - t)
    t += calm
    work -= calm
  }
  if (work > 0 && t < end) {
    const capacity = (end - t) * scenario.speedFactor // calm minutes that fit before the storm ends
    if (work <= capacity) {
      t += work / scenario.speedFactor
      work = 0
    } else {
      work -= capacity
      t = end
    }
  }
  return t + work - timeMinutes
}

// "Turn back in" is the time until the latest safe departure, not simply
// remaining budget minus the return duration if the crew left right now.
export function latestTurnbackMinutes(baseHome, elapsed, available, missionStart, scenario = null) {
  if (!scenario) return available - elapsed - baseHome
  if (elapsed + adjustedTravelMinutes(baseHome, elapsed, missionStart, scenario) > available) {
    return available - elapsed - adjustedTravelMinutes(baseHome, elapsed, missionStart, scenario)
  }
  let low = elapsed
  let high = available
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2
    if (mid + adjustedTravelMinutes(baseHome, mid, missionStart, scenario) <= available) low = mid
    else high = mid
  }
  return low - elapsed
}

export function stormMinutes(startElapsed, endElapsed, missionStart, scenario = null) {
  if (!scenario) return 0
  const { start, end } = stormWindow(missionStart, scenario)
  return Math.max(0, Math.min(endElapsed, end) - Math.max(startElapsed, start))
}
