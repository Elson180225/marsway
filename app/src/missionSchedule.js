import { adjustedTravelMinutes, stormMinutes } from './planningWeather.js'
import { walkDoseMSv, careerTotal } from './safezone/radiation.js'

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

// previousCareerMSv: career dose before this EVA, typed in by the planner; null = not entered.
const percentLabel = (value) => `${value < 1 ? value.toFixed(3) : value.toFixed(1)}%`

// plan: optional, e.g. planningEventEffects().plan, so the panel shows the event-adjusted times.
export function renderMissionSchedule(container, route, scenario = null, { previousCareerMSv = null, plan: given = null } = {}) {
  const plan = given ?? calculateMissionSchedule(route, scenario)
  const el = (tag, className, value) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (value !== undefined) node.textContent = value
    return node
  }
  const panel = el('div', 'mission-schedule')
  panel.append(el('span', 'eyebrow', 'SIMULATED EVA · MISSION TIME (UTC)'), el('h2', '', 'Planned walk and science time'))
  panel.append(el('p', `ms-summary${plan.margin < 0 ? ' ms-over-budget' : ''}`, `${minutesLabel(plan.total)} total · ${plan.margin >= 0 ? `${minutesLabel(plan.margin)} before reserve` : `${minutesLabel(-plan.margin)} into reserve`}`))
  const breakdown = el('div', 'ms-breakdown ms-chips')
  if (plan.driveOut) breakdown.append(el('span', 'ms-chip', `🚙 ${minutesLabel(plan.driveOut)}`))
  breakdown.append(el('span', 'ms-chip', `🚶 ${minutesLabel(plan.walking)}`))
  breakdown.append(el('span', 'ms-chip', `🔬 ${minutesLabel(plan.science)}`))
  if (plan.driveHome) breakdown.append(el('span', 'ms-chip', `🚙 ${minutesLabel(plan.driveHome)}`))
  if (plan.hasBonus) breakdown.append(el('span', 'ms-chip', 'Includes bonus stop'))
  panel.append(breakdown)
  const habitat = route.mission.habitat_label ?? 'H1'
  const rover = route.mission.home_label ?? 'G2'
  if (plan.driveOut) {
    const driveInfo = el('details', 'ms-info')
    driveInfo.append(
      el('summary', '', 'ⓘ Rover-drive assumptions'),
      el('p', 'ms-note', `${habitat} → ${rover}: ${minutesLabel(plan.driveOut)} suited drive (about ${(route.mission.drive_distance_m / 1000).toFixed(1)} km at an assumed 5 km/h plus 10 min to board and disembark). Open rover; no storm shelter.`)
    )
    panel.append(driveInfo)
  }
  const career = careerTotal({ previousMSv: previousCareerMSv ?? 0, evaDosesMSv: [plan.baselineDoseMSv] })
  panel.append(el('p', 'ms-dose',
    `Dose ${plan.baselineDoseMSv.toFixed(3)} mSv · ${previousCareerMSv == null ? `${percentLabel(career.percentOfLimit)} of career limit` : `Career total ${percentLabel(career.percentOfLimit)} of limit`}`
  ))
  const doseInfo = el('details', 'ms-info')
  doseInfo.append(
    el('summary', '', 'ⓘ Radiation estimate'),
    el('p', 'ms-note', `RAD baseline estimate, not a measured personal dose. NASA career limit used: ${career.limitMSv} mSv. ${previousCareerMSv == null ? 'Previous career dose not entered.' : `Previous career dose: ${previousCareerMSv.toFixed(3)} mSv. Running total: ${career.totalMSv.toFixed(3)} mSv; ${career.remainingMSv.toFixed(1)} mSv remaining.`} ${scenario ? `Simulated storm exposure: ${minutesLabel(plan.stormExposure)}. Dust-storm simulation changes walking time only; radiation effects and shielding are not modelled.` : ''}`)
  )
  panel.append(doseInfo)
  const list = el('ol', 'ms-list')
  for (const row of plan.rows) {
    const item = el('li', 'ms-row')
    const name = el('strong', '', row.name)
    if (row.isBonus) name.append(el('span', 'ms-bonus', 'OPTIONAL BONUS'))
    item.append(name, el('span', '', `Arrive ${utc(plan.start, row.arrival)}${row.isHome ? (row.note ? ` · ${row.note}` : plan.driveHome ? ` · Board rover for ${habitat}` : ' · EVA complete') : ` · Science ${Math.round(row.visit)} min${row.cutShort ? ' (cut short)' : ''} · Depart ${utc(plan.start, row.departure)}`}`))
    list.append(item)
  }
  if (plan.driveHome) {
    const item = el('li', 'ms-row')
    item.append(el('strong', '', `Drive ${rover} → ${habitat}`), el('span', '', `Arrive ${utc(plan.start, plan.total)} · EVA complete · Assumed ${minutesLabel(plan.driveHome)} suited drive`))
    list.append(item)
  }
  const more = el('details', 'ms-more')
  more.append(el('summary', '', 'View stop-by-stop schedule'), list, el('p', 'ms-note', `Suit budget ${minutesLabel(route.mission.max_walk_minutes)} includes a protected ${minutesLabel(route.mission.reserve_minutes)} reserve. ${plan.driveOut ? 'Suited open-rover drives count against the budget; drive speed and time are team assumptions. ' : ''}This total includes every listed stop; skipping the bonus requires a new route calculation. Walking seconds are summed before display rounding. Start time and position are simulated.`))
  panel.append(more)
  container.replaceChildren(panel)
}
