/**
 * MarsWay radiation estimate (Pathfinder 2).
 *
 * Curiosity's RAD instrument (Radiation Assessment Detector) measured the radiation dose on the
 * surface of Gale Crater, our site. We use about 0.67 mSv per day, the team's figure.
 * Source: Hassler et al. 2014, "Mars' Surface Radiation Environment Measured with the Mars Science
 * Laboratory's Curiosity Rover", Science 343. (The paper gives 0.64 ± 0.12 mSv/day, so 0.67 is
 * inside its range.) Rough estimate only: real dose changes with the sun, the season and shielding.
 *
 * Planning assumptions on top of the baseline. These are team demo values, not measurements of a
 * crew member. Change them here and every screen follows.
 *
 * SOLAR_STORM_FACTOR = 2: during a solar storm (solar particle event) the dose rate is doubled.
 *   The largest event Curiosity has seen on the surface (11 Sept 2017) "more than doubled" RAD's
 *   readings for over two days (NASA JPL, 29 Sept 2017), and dose rates rose 2-3x for several hours
 *   (Hassler et al. 2018, Space Weather, doi:10.1029/2018SW001959). Measured as dose equivalent the
 *   peak was only about 1.5x (Zeitlin et al. 2018, GRL, doi:10.1029/2018GL077760), so 2x is cautious.
 *   A solar storm is radiation, not dust: it does not change walking speed.
 *
 * HABITAT_SHIELDING_FACTOR = 0.5: inside the habitat the dose is half the outside dose. No Mars
 *   habitat has been measured, so this is an assumption between published shielding studies:
 *   about 41% less behind 1 m of regolith (Planetary and Space Science, 2022) and more than 90% less
 *   behind 2.5 m (TU Delft, MGS-1 study).
 *
 * CAREER_LIMIT_MSV = 600: NASA's career limit for every astronaut (NASA-STD-3001 Vol. 1; NASA OCHMO
 *   radiation protection technical brief).
 */
export const RAD_SURFACE_MSV_PER_DAY = 0.67
export const SOLAR_STORM_FACTOR = 2
export const HABITAT_SHIELDING_FACTOR = 0.5
export const CAREER_LIMIT_MSV = 600

const MS_PER_DAY = 24 * 3600000

/** Dose in millisieverts for `hours` spent outside on the surface, normal (no solar storm) rate. */
export function walkDoseMSv(hours) {
  return (RAD_SURFACE_MSV_PER_DAY / 24) * hours
}

/** Dose rate in mSv per day: outside or inside the habitat, with or without a solar storm. */
export function doseRateMSvPerDay({ inside = false, solarStorm = false } = {}) {
  return RAD_SURFACE_MSV_PER_DAY * (inside ? HABITAT_SHIELDING_FACTOR : 1) * (solarStorm ? SOLAR_STORM_FACTOR : 1)
}

// Sorted, non-overlapping storm windows clipped to [from, to]. A storm with no end is still going.
function stormWindows(storms, from, to) {
  const clipped = storms
    .map((storm) => [Math.max(from, storm.startMs), Math.min(to, storm.endMs ?? Infinity)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  const merged = []
  for (const window of clipped) {
    const last = merged.at(-1)
    if (last && window[0] <= last[1]) last[1] = Math.max(last[1], window[1])
    else merged.push(window)
  }
  return merged
}

/**
 * Radiation so far for a walk timeline. This is the function for the Walk screen (Russell).
 *
 * timeline = {
 *   periods: [{ startMs, endMs, inside }]  where the crew was: outside (inside false) or in the habitat
 *   storms:  [{ startMs, endMs }]          solar storm windows; endMs null or missing = still going
 *   nowMs                                  optional: count only up to this time (default: everything)
 * }
 * Returns {
 *   doseMSv         total dose so far
 *   stormMinutes    minutes spent in a solar storm (outside or inside)
 *   stormExtraMSv   the part of doseMSv that the storm added
 *   outsideMinutes, insideMinutes
 * }
 */
export function doseSoFar({ periods = [], storms = [], nowMs = Infinity } = {}) {
  const result = { doseMSv: 0, stormMinutes: 0, stormExtraMSv: 0, outsideMinutes: 0, insideMinutes: 0 }
  for (const period of periods) {
    const start = period.startMs
    const end = Math.min(period.endMs ?? nowMs, nowMs)
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Each period needs a startMs and an endMs (or nowMs).')
    if (end <= start) continue
    const inside = Boolean(period.inside)
    const stormMs = stormWindows(storms, start, end).reduce((sum, [a, b]) => sum + (b - a), 0)
    const normalRate = doseRateMSvPerDay({ inside })
    const stormRate = doseRateMSvPerDay({ inside, solarStorm: true })
    result.doseMSv += (normalRate * (end - start - stormMs) + stormRate * stormMs) / MS_PER_DAY
    result.stormExtraMSv += ((stormRate - normalRate) * stormMs) / MS_PER_DAY
    result.stormMinutes += stormMs / 60000
    result[inside ? 'insideMinutes' : 'outsideMinutes'] += (end - start) / 60000
  }
  return result
}

/**
 * Running total across walks, compared with NASA's 600 mSv career limit.
 * previousMSv: career dose before these walks (unknown → leave 0 and say so on screen).
 * evaDosesMSv: the dose of each walk to add.
 */
export function careerTotal({ previousMSv = 0, evaDosesMSv = [] } = {}) {
  if (!Number.isFinite(previousMSv) || previousMSv < 0) throw new Error('Previous career dose must be 0 or more mSv.')
  const totalMSv = evaDosesMSv.reduce((sum, dose) => sum + dose, previousMSv)
  return { totalMSv, limitMSv: CAREER_LIMIT_MSV, percentOfLimit: (totalMSv / CAREER_LIMIT_MSV) * 100, remainingMSv: CAREER_LIMIT_MSV - totalMSv }
}
