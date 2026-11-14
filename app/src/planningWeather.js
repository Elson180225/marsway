// Planning-only simulation. A speed factor changes travel after the chosen UTC
// start; it does not change the geometry or claim a measured Mars wind speed.
export function weatherScenario(startUtc = '', speedFactor = 0.6) {
  if (!startUtc) return null
  const start = Date.parse(startUtc)
  if (!Number.isFinite(start) || !Number.isFinite(speedFactor) || speedFactor <= 0 || speedFactor > 1) {
    throw new Error('Choose a valid UTC storm start and a speed factor above 0 and at most 1.')
  }
  return { startUtc: new Date(start).toISOString(), speedFactor }
}

// timeMinutes is elapsed mission time at departure; duration is walking time
// in calm conditions. Before the storm, walking is unchanged; after, it slows.
export function adjustedTravelMinutes(duration, timeMinutes, missionStart, scenario = null) {
  if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(timeMinutes) || !Number.isFinite(missionStart)) throw new Error('Invalid planned travel time.')
  if (!scenario) return duration
  if (!Number.isFinite(Date.parse(scenario.startUtc)) || !Number.isFinite(scenario.speedFactor) || scenario.speedFactor <= 0 || scenario.speedFactor > 1) throw new Error('Invalid weather scenario.')
  const untilStorm = (Date.parse(scenario.startUtc) - missionStart) / 60000 - timeMinutes
  const before = Math.min(duration, Math.max(0, untilStorm))
  return before + (duration - before) / scenario.speedFactor
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
  const stormElapsed = (Date.parse(scenario.startUtc) - missionStart) / 60000
  return Math.max(0, endElapsed - Math.max(startElapsed, stormElapsed))
}
