import { calculateMissionSchedule } from './missionSchedule.js'
import { walkDoseMSv, careerTotal, RAD_SURFACE_MSV_PER_DAY } from './safezone/radiation.js'

export const SUMMARY_COLUMNS = 'eva_id,crew,date_utc,start_utc,end_utc,duration_min,distance_km,stops_visited,bonus_done,storm_exposure_min,dose_msv,running_total_msv'
export const TIMELINE_COLUMNS = 'time_utc,phase,location,x,y,dose_rate_msv_per_day,dose_so_far_msv,suit_minutes_left,event'

const utc = (start, elapsed) => new Date(start + elapsed * 60000).toISOString()
const csv = (items) => items.map((item) => {
  if (item == null) return ''
  const value = String(item)
  // Names from route data should remain data when a CSV opens in a spreadsheet.
  const escaped = /^[=+@\-\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped
}).join(',')

// These files describe a proposed schedule. Fields implying actual crew
// activity remain blank until a real log supplies them. running_total_msv is filled only when the
// planner enters a previous career dose (previousCareerMSv); otherwise it stays blank.
export function plannedCsv(route, scenario = null, { previousCareerMSv = null } = {}) {
  const plan = calculateMissionSchedule(route, scenario)
  const date = new Date(plan.start).toISOString().slice(0, 10)
  const summary = [SUMMARY_COLUMNS, csv([
    route.mission.id, 'SIMULATED CREW', date, utc(plan.start, 0), utc(plan.start, plan.total),
    plan.total.toFixed(1), ((route.legs.reduce((sum, leg) => sum + leg.distance_m, 0) + 2 * (route.mission.drive_distance_m ?? 0)) / 1000).toFixed(2),
    '', '', plan.stormExposure.toFixed(1), plan.baselineDoseMSv.toFixed(3),
    previousCareerMSv == null ? '' : careerTotal({ previousMSv: previousCareerMSv, evaDosesMSv: [plan.baselineDoseMSv] }).totalMSv.toFixed(3),
  ])].join('\r\n') + '\r\n'
  const h1 = { name: 'Habitat (H1)', x: 1047.5, y: 917.5 }
  const events = [{ elapsed: 0, phase: 'planned_start', stop: plan.driveOut ? h1 : route.stops[0], event: 'SIMULATED plan begins' }]
  if (plan.driveOut) events.push({ elapsed: plan.driveOut, phase: 'planned_drive_arrival', stop: route.stops[0], event: 'SIMULATED suited drive H1 to G2; assumed time' })
  for (const row of plan.rows) {
    const stop = route.stops.find((s) => s.id === row.id)
    events.push({ elapsed: row.arrival, phase: row.isHome ? (plan.driveHome ? 'planned_rover_return' : 'planned_home') : 'planned_arrival', stop, event: row.isHome ? (plan.driveHome ? 'SIMULATED return to G2 rover; drive to H1 follows' : 'SIMULATED EVA complete') : `SIMULATED arrival${row.isBonus ? ' at optional bonus stop' : ''}` })
    if (!row.isHome) events.push({ elapsed: row.departure, phase: 'planned_departure', stop, event: `SIMULATED science activity: ${row.visit} min` })
  }
  if (plan.driveHome) events.push({ elapsed: plan.total, phase: 'planned_home', stop: h1, event: 'SIMULATED suited drive G2 to H1 complete; assumed time' })
  const timeline = [TIMELINE_COLUMNS, ...events.map(({ elapsed, phase, stop, event }) => csv([
    utc(plan.start, elapsed), phase, stop.name, stop.x, stop.y,
    RAD_SURFACE_MSV_PER_DAY, walkDoseMSv(elapsed / 60).toFixed(3),
    Math.max(0, route.mission.max_walk_minutes - elapsed).toFixed(1), event,
  ]))].join('\r\n') + '\r\n'
  return { summary, timeline }
}

export function downloadCsv(name, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
