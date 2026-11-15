/**
 * Random events for a walk (Pathfinder 2).
 *
 * The same seed always gives the same events, so a good scenario can be replayed in the demo.
 * The odds and lengths below are TEAM ASSUMPTIONS based on Russell's research summary
 * (15 Nov 2026), not numbers worked out from the Mars Climate Database. Change them here
 * and every screen follows.
 *
 * - Local dust storm: can come out of season with little warning (MY37 "rocket" storm). Walking 0.6×.
 * - Dust devil: very common (1,039 tracked in a 2025 study). The crew stops and waits it out.
 * - Solar storm: radiation ×2 (SOLAR_STORM_FACTOR in radiation.js). The crew gets 10–45 min warning
 *   (warningMin) before it starts: our assumption, roughly the time between a flare being seen and
 *   the particles arriving.
 * - Global dust storm: lasts weeks to months, so it is known before the walk. The walk is cancelled.
 * - Rover breakdown: rover versions only. The crew uses the walk-back plan.
 */
import { SOLAR_STORM_FACTOR } from './radiation.js'

export const EVENT_RULES = {
  global_dust_storm: { chance: 0.02 },
  dust_storm: { chance: 0.35, minLength: 20, maxLength: 90, speedFactor: 0.6 },
  dust_devil: { chance: 0.3, minLength: 5, maxLength: 10 },
  solar_storm: { chance: 0.15, minLength: 30, maxLength: 180, radiationFactor: SOLAR_STORM_FACTOR, minWarning: 10, maxWarning: 45 },
  rover_breakdown: { chance: 0.1 },
}

// [title, message, endMessage]. endMessage is shown when the event is over; null for events that
// last until the end of the walk (they never end while the crew is out).
const TEXT = {
  global_dust_storm: ['Global dust storm', 'A planet-wide dust storm is under way. NO-GO: the walk is cancelled.', null],
  dust_storm: ['Dust storm', 'Walking slows to 0.6× while it lasts. Check the turn-back timer.', 'Dust storm over. Walking is back to normal pace.'],
  dust_devil: ['Dust devil', 'Stop and wait for it to pass. The wait counts against suit time.', 'Dust devil has passed. Walk on.'],
  solar_storm: ['Solar storm', 'Radiation is doubled while it lasts. Head for shelter if you can.', 'Solar storm over. Radiation is back to normal.'],
  rover_breakdown: ['Rover breakdown', 'The rover can’t drive. Use the walk-back plan to the habitat.', null],
}

/** Small seeded random number generator (mulberry32). Same seed → same numbers. */
export function makeRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A new random scenario number from 1 to 9999 (the only part that is not repeatable). */
export function randomSeed() {
  return 1 + Math.floor(Math.random() * 9999)
}

function makeEvent(type, startMin, durationMin, extra = {}) {
  const [title, message, endText] = TEXT[type]
  const endMessage = durationMin === null ? null : endText
  return { type, startMin, durationMin, title, message, endMessage, ...extra }
}

/**
 * randomEvents({ seed, eva, version, durationMinutes })
 *   seed            whole number 1–9999
 *   eva             '07' … '12' (only shown, it does not change the odds)
 *   version         'foot' or 'rover'
 *   durationMinutes how long the walk is (planned)
 * Returns { seed, label, eva, version, calm, cancelled, events }, with events sorted by startMin.
 * durationMin null = lasts until the end of the walk.
 */
export function randomEvents({ seed, eva = '', version = 'foot', durationMinutes }) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 9999) throw new Error('Seed must be a whole number from 1 to 9999.')
  if (version !== 'foot' && version !== 'rover') throw new Error("Version must be 'foot' or 'rover'.")
  if (!Number.isFinite(durationMinutes) || durationMinutes < 60) throw new Error('The walk must be at least 60 minutes.')

  const random = makeRandom(seed)
  const roll = (chance) => random() < chance
  const between = (low, high) => low + Math.floor(random() * (Math.max(low, high) - low + 1))
  const end = Math.floor(durationMinutes)
  const R = EVENT_RULES
  const result = { seed, label: `Scenario #${seed}`, eva, version, calm: false, cancelled: false, events: [] }

  // Always make every roll in the same order, so the foot and rover versions of one seed get the same weather.
  const globalStorm = roll(R.global_dust_storm.chance)

  const dust = roll(R.dust_storm.chance)
  const dustStart = between(30, end - 30)
  const dustLength = between(R.dust_storm.minLength, R.dust_storm.maxLength)

  const devil = roll(R.dust_devil.chance)
  const devilStart = between(15, end - 15)
  const devilLength = between(R.dust_devil.minLength, R.dust_devil.maxLength)

  const solar = roll(R.solar_storm.chance)
  const solarStart = between(0, end - 30)
  const solarLength = between(R.solar_storm.minLength, R.solar_storm.maxLength)

  const breakdown = roll(R.rover_breakdown.chance)
  const breakdownStart = between(Math.min(60, end - 30), end - 30)

  // Added later: keep new rolls at the end, so every seed still gives the same events as before.
  const solarWarning = between(R.solar_storm.minWarning, R.solar_storm.maxWarning)

  if (globalStorm) {
    result.cancelled = true
    result.events = [makeEvent('global_dust_storm', 0, null)]
    return result
  }
  if (dust) result.events.push(makeEvent('dust_storm', dustStart, Math.min(dustLength, end - dustStart), { speedFactor: R.dust_storm.speedFactor }))
  if (devil) result.events.push(makeEvent('dust_devil', devilStart, Math.min(devilLength, end - devilStart), { pauseMinutes: Math.min(devilLength, end - devilStart) }))
  if (solar) result.events.push(makeEvent('solar_storm', solarStart, Math.min(solarLength, end - solarStart), { radiationFactor: R.solar_storm.radiationFactor, warningMin: solarWarning }))
  if (breakdown && version === 'rover') result.events.push(makeEvent('rover_breakdown', breakdownStart, null))

  result.events.sort((a, b) => a.startMin - b.startMin)
  result.calm = result.events.length === 0
  return result
}

/** The events happening at `minute` of the walk (for pop-ups and the ×2 radiation tile). */
export function activeEvents(events, minute) {
  return events.filter((e) => minute >= e.startMin && (e.durationMin === null || minute < e.startMin + e.durationMin))
}
