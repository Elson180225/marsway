import { adjustedTravelMinutes, stormMinutes } from './planningWeather.js'
import { walkDoseMSv } from './safezone/radiation.js'

const minutesLabel = (minutes) => {
  const rounded = Math.round(minutes)
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, '0')}m`
}
const utc = (start, minutes) => new Date(start + Math.round(minutes) * 60000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

// A scenario estimate using the planner's directional walking seconds, not a live suit clock.
export function calculateMissionSchedule(route, scenario = null) {
  const { stops, legs, mission } = route
  const start = Date.parse(mission.start_time)
  const budget = mission.max_walk_minutes - mission.reserve_minutes
  const driveOut = mission.drive_out_minutes ?? 0
  const driveHome = mission.drive_home_minutes ?? 0
  if (!Array.isArray(stops) || !Array.isArray(legs) || !Number.isFinite(start) || !Number.isFinite(budget) || budget <= 0 || legs.length !== stops.length - 1) throw new Error('Incomplete mission schedule.')
  if (![driveOut, driveHome].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Invalid assumed drive time.')
  let walking = 0
  let science = 0
  let stormExposure = 0
  const rows = legs.map((leg, index) => {
    // Rounding every leg first can lose a minute over a multi-stop EVA.
    // Older route files may only have walk_minutes; use them as a fallback.
    const legSeconds = leg.seconds ?? leg.walk_minutes * 60
    if (!Number.isFinite(legSeconds) || legSeconds < 0) throw new Error('Invalid walking time in the mission schedule.')
    const stop = stops[index + 1]
    const visit = stop.type === 'home' ? 0 : (stop.stop_minutes ?? 0)
    if (!Number.isFinite(visit) || visit < 0) throw new Error(`Invalid visit time for ${stop.id}.`)
    const departForLeg = driveOut + walking + science
    const travel = adjustedTravelMinutes(legSeconds / 60, departForLeg, start, scenario)
    walking += travel
    const arrival = driveOut + walking + science
    stormExposure += stormMinutes(departForLeg, arrival, start, scenario)
    stormExposure += stormMinutes(arrival, arrival + visit, start, scenario)
    science += visit
    return { id: stop.id, name: stop.name, x: stop.x, y: stop.y, arrival, visit, departure: arrival + visit, travel, isBonus: stop.is_bonus === true, isHome: stop.type === 'home' }
  })
  const total = driveOut + walking + science + driveHome
  stormExposure += stormMinutes(0, driveOut, start, scenario) + stormMinutes(total - driveHome, total, start, scenario)
  return { rows, walking, science, driveOut, driveHome, total, budget, margin: budget - total, start, hasBonus: rows.some((row) => row.isBonus), stormExposure, baselineDoseMSv: walkDoseMSv(total / 60) }
}

export function renderMissionSchedule(container, route, scenario = null) {
  const plan = calculateMissionSchedule(route, scenario)
  const el = (tag, className, value) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (value !== undefined) node.textContent = value
    return node
  }
  const panel = el('div', 'mission-schedule')
  panel.append(el('span', 'eyebrow', 'SIMULATED EVA · MISSION TIME (UTC)'), el('h2', '', 'Planned walk and science time'))
  panel.append(el('p', `ms-summary${plan.margin < 0 ? ' ms-over-budget' : ''}`, `${minutesLabel(plan.total)} total · ${plan.margin >= 0 ? `${minutesLabel(plan.margin)} before reserve` : `${minutesLabel(-plan.margin)} into reserve`}`))
  panel.append(el('p', 'ms-breakdown', `${plan.driveOut ? `${minutesLabel(plan.driveOut)} drive out + ` : ''}${minutesLabel(plan.walking)} walking + ${minutesLabel(plan.science)} science${plan.driveHome ? ` + ${minutesLabel(plan.driveHome)} drive home` : ''}${plan.hasBonus ? ' · Includes bonus stop' : ''}`))
  if (plan.driveOut) panel.append(el('p', 'ms-note', `H1 → G2: ${minutesLabel(plan.driveOut)} suited drive (about ${(route.mission.drive_distance_m / 1000).toFixed(1)} km at an assumed 5 km/h, including boarding). Open rover; no storm shelter.`))
  panel.append(el('p', 'ms-dose', `Planned surface dose: ${plan.baselineDoseMSv.toFixed(3)} mSv (RAD baseline${scenario ? '; storm radiation excluded' : ''}).${scenario ? ` Simulated storm exposure: ${minutesLabel(plan.stormExposure)}.` : ''}`))
  const list = el('ol', 'ms-list')
  for (const row of plan.rows) {
    const item = el('li', 'ms-row')
    const name = el('strong', '', row.name)
    if (row.isBonus) name.append(el('span', 'ms-bonus', 'OPTIONAL BONUS'))
    item.append(name, el('span', '', `Arrive ${utc(plan.start, row.arrival)}${row.isHome ? (plan.driveHome ? ' · Board rover for H1' : ' · EVA complete') : ` · Science ${row.visit} min · Depart ${utc(plan.start, row.departure)}`}`))
    list.append(item)
  }
  if (plan.driveHome) {
    const item = el('li', 'ms-row')
    item.append(el('strong', '', 'Drive G2 → H1'), el('span', '', `Arrive ${utc(plan.start, plan.total)} · EVA complete · Assumed ${minutesLabel(plan.driveHome)} suited drive`))
    list.append(item)
  }
  const more = el('details', 'ms-more')
  more.append(el('summary', '', 'View stop-by-stop schedule'), list, el('p', 'ms-note', `Suit budget ${minutesLabel(route.mission.max_walk_minutes)} includes a protected ${minutesLabel(route.mission.reserve_minutes)} reserve. ${plan.driveOut ? 'Suited open-rover drives count against the budget; drive speed and time are team assumptions. ' : ''}This total includes every listed stop; skipping the bonus requires a new route calculation. Walking seconds are summed before display rounding. Start time and position are simulated.`))
  panel.append(more)
  container.replaceChildren(panel)
}
