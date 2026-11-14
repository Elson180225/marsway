const minutesLabel = (minutes) => {
  const rounded = Math.round(minutes)
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, '0')}m`
}
const utc = (start, minutes) => new Date(start + Math.round(minutes) * 60000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

// A scenario estimate using the planner's directional walking seconds, not a live suit clock.
export function calculateMissionSchedule(route) {
  const { stops, legs, mission } = route
  const start = Date.parse(mission.start_time)
  const budget = mission.max_walk_minutes - mission.reserve_minutes
  if (!Array.isArray(stops) || !Array.isArray(legs) || !Number.isFinite(start) || !Number.isFinite(budget) || budget <= 0 || legs.length !== stops.length - 1) throw new Error('Incomplete mission schedule.')
  let walking = 0
  let science = 0
  const rows = legs.map((leg, index) => {
    // Rounding every leg first can lose a minute over a multi-stop EVA.
    // Older route files may only have walk_minutes; use them as a fallback.
    const legSeconds = leg.seconds ?? leg.walk_minutes * 60
    if (!Number.isFinite(legSeconds) || legSeconds < 0) throw new Error('Invalid walking time in the mission schedule.')
    const stop = stops[index + 1]
    const visit = stop.type === 'home' ? 0 : (stop.stop_minutes ?? 0)
    if (!Number.isFinite(visit) || visit < 0) throw new Error(`Invalid visit time for ${stop.id}.`)
    walking += legSeconds / 60
    const arrival = walking + science
    science += visit
    return { id: stop.id, name: stop.name, arrival, visit, departure: arrival + visit, isBonus: stop.is_bonus === true, isHome: stop.type === 'home' }
  })
  return { rows, walking, science, total: walking + science, budget, margin: budget - walking - science, start, hasBonus: rows.some((row) => row.isBonus) }
}

export function renderMissionSchedule(container, route) {
  const plan = calculateMissionSchedule(route)
  const el = (tag, className, value) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (value !== undefined) node.textContent = value
    return node
  }
  const panel = el('div', 'mission-schedule')
  panel.append(el('span', 'eyebrow', 'SIMULATED EVA / UTC'), el('h2', '', 'Planned walk and science time'))
  panel.append(el('p', `ms-summary${plan.margin < 0 ? ' ms-over-budget' : ''}`, `${minutesLabel(plan.total)} total · ${plan.margin >= 0 ? `${minutesLabel(plan.margin)} before reserve` : `${minutesLabel(-plan.margin)} into reserve`}`))
  panel.append(el('p', 'ms-breakdown', `${minutesLabel(plan.walking)} walking + ${minutesLabel(plan.science)} science${plan.hasBonus ? ' · Includes bonus stop' : ''}`))
  const list = el('ol', 'ms-list')
  for (const row of plan.rows) {
    const item = el('li', 'ms-row')
    const name = el('strong', '', row.name)
    if (row.isBonus) name.append(el('span', 'ms-bonus', 'OPTIONAL BONUS'))
    item.append(name, el('span', '', `Arrive ${utc(plan.start, row.arrival)}${row.isHome ? ' · EVA complete' : ` · Science ${row.visit} min · Depart ${utc(plan.start, row.departure)}`}`))
    list.append(item)
  }
  const more = el('details', 'ms-more')
  more.append(el('summary', '', 'View stop-by-stop schedule'), list, el('p', 'ms-note', `Suit budget ${minutesLabel(route.mission.max_walk_minutes)} includes a protected ${minutesLabel(route.mission.reserve_minutes)} reserve. This total includes every listed stop; skipping the bonus requires a new route calculation. Walking seconds are summed before display rounding. Start time and position are simulated.`))
  panel.append(more)
  container.replaceChildren(panel)
}
