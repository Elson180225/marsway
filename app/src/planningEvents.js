// What Mia's random events do to a planned EVA, for the Planning screen (Aaron).
// One call: planningEventEffects({ route, grid, seed }). It uses the same events as Walk
// (scenarioEvents in scenarioEvents.js), so one ?scenario= number means the same walk on both screens.
//
//   dust_storm       walking at 0.6× only while it lasts (weatherScenario with an end time)
//   dust_devil       the crew stops for pauseMinutes; everything after it moves later
//   solar_storm      radiation ×2 (plannedDose), and the quickest way to shelter from where the crew
//                    is when the warning comes (Nigel's shelterRoute)
//   rover_breakdown  rover versions: the walk home from where the crew is (Nigel's walkBackRoute)
//   global_dust_storm  NO-GO, walk cancelled
//
// Times are minutes since the EVA started (the walk clock of the events), including the drive out.
// The crew position at a moment is worked out from the planned schedule; during a drive the crew is
// taken to be at the habitat (drive out) or at the rover (drive home). These are simulation estimates.
import { calculateMissionSchedule } from './missionSchedule.js'
import { weatherScenario } from './planningWeather.js'
import { scenarioEvents } from './scenarioEvents.js'
import { plannedDose } from './safezone/radiation.js'
import { shelterRoute, walkBackRoute } from './pathfinding/shelter.js'

const iso = (startMs, minutes) => new Date(startMs + minutes * 60000).toISOString()

function pathPoint(path, fraction) {
  if (path.length === 1) return { ...path[0] }
  const lengths = path.slice(1).map((p, k) => Math.hypot(p.x - path[k].x, p.y - path[k].y))
  let target = Math.min(Math.max(fraction, 0), 1) * lengths.reduce((a, b) => a + b, 0)
  for (let k = 0; k < lengths.length; k++) {
    if (target <= lengths[k] && lengths[k] > 0) {
      const t = target / lengths[k]
      return { x: path[k].x + t * (path[k + 1].x - path[k].x), y: path[k].y + t * (path[k + 1].y - path[k].y) }
    }
    target -= lengths[k]
  }
  return { ...path.at(-1) }
}

/**
 * Where the crew is `minute` minutes into the EVA, by the schedule (calculateMissionSchedule rows).
 * pause: { atMin, minutes } a dust devil (the crew stands still for it). Returns { x, y, doing }.
 * doing: 'drive-out' | 'walking' | 'science' | 'drive-home' | 'home'
 */
export function crewAt(route, schedule, minute, pause = null, habitat = route.stops[0]) {
  let t = minute
  if (pause && t > pause.atMin) t -= Math.min(pause.minutes, t - pause.atMin) // stood still during the pause
  const { rows, driveOut, driveHome, total } = schedule
  const base = route.stops[0]
  if (t < driveOut) return { ...habitat, doing: 'drive-out' }
  let depart = driveOut
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k]
    if (t < row.arrival) {
      const leg = route.legs[k]
      const p = pathPoint(leg.path, row.travel > 0 ? (t - depart) / row.travel : 1)
      return { x: p.x, y: p.y, doing: 'walking' }
    }
    if (t < row.departure) return { x: row.x, y: row.y, doing: 'science' }
    depart = row.departure
  }
  if (driveHome && t < total) return { x: base.x, y: base.y, doing: 'drive-home' }
  return { x: habitat.x, y: habitat.y, doing: 'home' }
}

/**
 * Everything the Planning screen needs for one scenario number.
 *   route  the route on screen (On foot or With rover, from planningTravelVersions)
 *   grid   terrain grid
 *   seed   scenario number 1–9999 (scenarioFromSearch(location.search))
 * Returns {
 *   events, label, cancelled, calm
 *   weather        the dust storm as a weatherScenario (pass to the schedule and to safety.setWeather), or null
 *   schedule       calculateMissionSchedule(route, weather), before the dust devil pause
 *   pauseMinutes   dust devil wait inside the EVA (0 if none)
 *   total, spare   EVA minutes with the events, and minutes left before the reserve (negative = into it)
 *   dose           plannedDose(total, events): { doseMSv, stormExtraMSv, stormMinutes, … }
 *   shelter        { atMin, crew, storm, route: shelterRoute() result } or null
 *   breakdown      { atMin, crew, route: walkBackRoute() result } or null (rover versions only)
 *   endMin         when the crew is really back, if a storm or breakdown sends them home early
 *   lines          [{ kind: 'shelter' | 'walk-back' | 'drive', path: [{x,y}] }] to draw on the map
 *   verdict        { level: 'go' | 'caution' | 'no-go', title, reasons: [string] }
 * }
 */
export function planningEventEffects({ route, grid, seed }) {
  const { mission } = route
  const roverMode = Boolean(mission.drive_out_minutes)
  const habitat = roverMode
    ? { id: mission.habitat_label ?? 'H1', name: `Habitat (${mission.habitat_label ?? 'H1'})`, ...(mission.habitat_position ?? {}) }
    : { ...route.stops[0], name: route.stops[0].name }
  const rover = roverMode
    ? { id: mission.home_label ?? route.stops[0].id, name: route.stops[0].name, x: route.stops[0].x, y: route.stops[0].y,
      driveMinutes: mission.drive_home_minutes, drivePath: route.drivePath ?? null }
    : null
  const result = scenarioEvents(route, seed)
  const { events } = result
  const startMs = Date.parse(mission.start_time)
  const usable = mission.max_walk_minutes - mission.reserve_minutes
  const reasons = []

  if (result.cancelled) {
    return { ...result, weather: null, schedule: calculateMissionSchedule(route), plan: null, departureMin: {}, pauseMinutes: 0, total: 0, spare: usable, dose: plannedDose(0, []),
      shelter: null, breakdown: null, endMin: 0, lines: [], verdict: { level: 'no-go', title: 'NO-GO: walk cancelled', reasons: ['Global dust storm: the EVA does not go ahead.'] } }
  }

  const dust = events.find((e) => e.type === 'dust_storm')
  const weather = dust ? weatherScenario(iso(startMs, dust.startMin), dust.speedFactor, dust.durationMin == null ? '' : iso(startMs, dust.startMin + dust.durationMin)) : null
  const schedule = calculateMissionSchedule(route, weather)
  const devil = events.find((e) => e.type === 'dust_devil' && e.startMin < schedule.total)
  const pause = devil ? { atMin: devil.startMin, minutes: devil.pauseMinutes ?? devil.durationMin } : null
  const pauseMinutes = pause?.minutes ?? 0
  const total = schedule.total + pauseMinutes
  if (dust) reasons.push(`Dust storm at ${dust.startMin} min for ${dust.durationMin} min: walking at ${dust.speedFactor}× while it lasts.`)
  if (devil) reasons.push(`Dust devil at ${devil.startMin} min: ${pauseMinutes} min wait.`)

  const dustOn = (minute) => dust && minute >= dust.startMin && (dust.durationMin == null || minute < dust.startMin + dust.durationMin)
  const lines = []
  if (rover?.drivePath?.length > 1) lines.push({ kind: 'drive', path: rover.drivePath })
  let level = 'go'
  const worse = (next) => { if (next === 'no-go' || (next === 'caution' && level === 'go')) level = next }
  let endMin = total

  const broke = roverMode ? events.find((e) => e.type === 'rover_breakdown' && e.startMin < total) : null
  let breakdown = null
  if (broke) {
    const crew = crewAt(route, schedule, broke.startMin, pause, habitat)
    const walk = walkBackRoute({ grid, crew, nowMin: broke.startMin, habitat, mission, walkSpeed: dustOn(broke.startMin) ? dust.speedFactor : 1 })
    breakdown = { atMin: broke.startMin, crew, route: walk }
    if (!walk) { worse('no-go'); reasons.push(`Rover breakdown at ${broke.startMin} min: no walkable way home.`) }
    else {
      endMin = Math.min(endMin, walk.arriveMin)
      if (!walk.atShelter) lines.push({ kind: 'walk-back', path: walk.legs[0].path })
      worse(walk.level === 'ok' ? 'caution' : walk.level === 'reserve' ? 'caution' : 'no-go')
      reasons.push(`Rover breakdown at ${broke.startMin} min: ${walk.message}`)
    }
  }

  const sun = events.find((e) => e.type === 'solar_storm')
  let shelter = null
  if (sun) {
    const atMin = Math.max(0, sun.startMin - (sun.warningMin ?? 0)) // the crew reacts when warned
    if (atMin < endMin) {
      const crew = crewAt(route, schedule, atMin, pause, habitat)
      const roverOk = rover && !(broke && broke.startMin <= atMin)
      const from = crew.doing === 'drive-home' && roverOk ? rover : crew
      const go = shelterRoute({ grid, crew: from, nowMin: atMin, storm: sun, habitat, rover: roverOk ? { ...rover, available: true } : rover ? { ...rover, available: false } : null, walkSpeed: dustOn(atMin) ? dust.speedFactor : 1 })
      shelter = { atMin, crew, storm: sun, route: go }
      if (!go) { worse('no-go'); reasons.push(`Solar storm at ${sun.startMin} min: no safe way to shelter.`) }
      else {
        endMin = Math.min(endMin, go.arriveMin)
        for (const leg of go.atShelter ? [] : go.legs) lines.push({ kind: 'shelter', path: leg.path })
        if (!go.beforeStorm) worse('caution')
        reasons.push(`Solar storm at ${sun.startMin} min${sun.warningMin ? ` (warned ${sun.warningMin} min before)` : ''}: ${go.message}`)
      }
    } else reasons.push(`Solar storm at ${sun.startMin} min: the crew is already home.`)
  }

  const dose = plannedDose(endMin, events)
  const spare = usable - total
  if (spare < 0) { worse('no-go'); reasons.unshift(`The plan with these events takes ${Math.round(total)} min: ${Math.round(-spare)} min into the reserve.`) }
  else if (dust || devil) worse('caution')
  const title = level === 'go' ? (result.calm ? 'GO: calm day' : 'GO') : level === 'caution' ? 'GO with caution' : 'NO-GO'

  // The one schedule every Planning panel should show (timeline, totals, CSV): see eventPlan().
  const emergencies = [
    shelter?.route && { atMin: shelter.atMin, endMin: shelter.route.arriveMin, name: `${habitat.name} (solar storm shelter)`, note: 'Solar storm: crew back in the habitat', why: 'simulated_shelter' },
    breakdown?.route && { atMin: breakdown.atMin, endMin: breakdown.route.arriveMin, name: `${habitat.name} (walked back)`, note: 'Rover breakdown: crew walked home', why: 'simulated_walk_back' },
  ].filter(Boolean).sort((a, b) => a.endMin - b.endMin)
  const at = (minute) => { const p = crewAt(route, schedule, minute, pause, habitat); return { name: 'Crew position', x: p.x, y: p.y } }
  const extraEvents = []
  if (devil) extraEvents.push({ elapsed: devil.startMin, phase: 'simulated_dust_devil', stop: at(devil.startMin), event: `SIMULATED dust devil: crew waits ${pauseMinutes} min` })
  if (dust) {
    extraEvents.push({ elapsed: dust.startMin, phase: 'simulated_dust_storm_start', stop: at(dust.startMin), event: `SIMULATED dust storm: walking at ${dust.speedFactor}x` })
    if (dust.durationMin != null) extraEvents.push({ elapsed: dust.startMin + dust.durationMin, phase: 'simulated_dust_storm_end', stop: at(dust.startMin + dust.durationMin), event: 'SIMULATED dust storm over: normal walking speed' })
  }
  if (shelter) extraEvents.push({ elapsed: shelter.atMin, phase: 'simulated_solar_warning', stop: at(shelter.atMin), event: `SIMULATED solar storm ${shelter.atMin < sun.startMin ? `warning (starts at +${Math.round(sun.startMin)} min)` : 'started'}: head for shelter` })
  if (breakdown) extraEvents.push({ elapsed: breakdown.atMin, phase: 'simulated_rover_breakdown', stop: at(breakdown.atMin), event: 'SIMULATED rover breakdown: walk home' })
  const plan = eventPlan({ schedule, pause, pauseMinutes, emergency: emergencies[0] && emergencies[0].endMin < total - 1e-9 ? emergencies[0] : null, habitat, dose, extraEvents })
  const departureMin = Object.fromEntries(plan.rows.filter((r) => !r.isHome).map((r) => [r.id, r.departure]))
  return { ...result, weather, schedule, plan, departureMin, pauseMinutes, total, spare, dose, shelter, breakdown, endMin, lines, verdict: { level, title, reasons } }
}

/**
 * The schedule with the events in it, the same shape as calculateMissionSchedule(), so
 * renderMissionSchedule(…, { plan }) and plannedCsv(…, { plan }) show the same times:
 *   - times after a dust devil move later by its pause
 *   - if a solar storm or a rover breakdown sends the crew home early, stops after that moment are
 *     dropped, the science under way is cut short, and the last row is the emergency arrival home
 *   - baselineDoseMSv is Mia's plannedDose (solar storms count double); extraEvents are CSV rows
 */
function eventPlan({ schedule, pause, pauseMinutes, emergency, habitat, dose, extraEvents }) {
  const shift = (minute) => (pause && minute > pause.atMin ? minute + pause.minutes : minute)
  let rows = schedule.rows.map((r) => ({ ...r, arrival: shift(r.arrival), departure: shift(r.departure) }))
  let driveHome = schedule.driveHome
  let total = schedule.total + pauseMinutes
  if (emergency) {
    const cutAt = emergency.atMin
    rows = rows.filter((r) => !r.isHome && r.arrival <= cutAt)
      .map((r) => (r.departure > cutAt ? { ...r, departure: cutAt, visit: Math.max(0, cutAt - r.arrival), cutShort: true } : r))
    rows.push({ id: 'emergency-home', name: emergency.name, x: habitat.x, y: habitat.y, arrival: emergency.endMin, visit: 0, departure: emergency.endMin,
      travel: emergency.endMin - cutAt, isBonus: false, isHome: true, note: emergency.note })
    driveHome = 0 // the emergency arrival already includes any drive
    total = emergency.endMin
  }
  const science = rows.reduce((sum, r) => sum + (r.isHome ? 0 : r.visit), 0)
  const paused = pause && pause.atMin < total ? pauseMinutes : 0
  return {
    ...schedule, rows, driveHome, total, margin: schedule.budget - total, science,
    walking: total - schedule.driveOut - driveHome - science - paused, pauseMinutes: paused,
    hasBonus: rows.some((r) => r.isBonus), cutShort: emergency ? { atMin: emergency.atMin, reason: emergency.why, note: emergency.note } : null,
    baselineDoseMSv: dose.doseMSv, stormExtraMSv: dose.stormExtraMSv, extraEvents: extraEvents.filter((e) => e.elapsed <= total),
  }
}

const clock = (minutes) => { const m = Math.round(minutes); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` }

/** One line per expected event, for the Conditions box. Pure, so Node can test it. */
export function conditionLines(fx) {
  if (!fx) return ['No scenario: clear-weather plan. Press 🎲 for random conditions.']
  if (fx.cancelled) return ['Global dust storm: the walk is cancelled (NO-GO).']
  if (fx.calm) return ['Calm day: no events expected.']
  return fx.events.map((e) => {
    const length = e.durationMin == null ? 'to the end of the walk' : `for ${Math.round(e.durationMin)} min`
    switch (e.type) {
      case 'dust_storm': return `🌪 Dust storm at ${clock(e.startMin)}, ${length}: walking ${e.speedFactor}×`
      case 'dust_devil': return `💨 Dust devil at ${clock(e.startMin)}: ${Math.round(e.pauseMinutes ?? e.durationMin)} min wait`
      case 'solar_storm': return `☀️ Solar storm at ${clock(e.startMin)}, ${length}: radiation ×2${e.warningMin ? ` (warned ${Math.round(e.warningMin)} min before)` : ''}`
      case 'rover_breakdown': return `🚙 Rover breakdown at ${clock(e.startMin)}: walk home`
      default: return `${e.title} at ${clock(e.startMin)}`
    }
  })
}
