// Radiation: dose rate, solar storm, habitat shielding, Russell's doseSoFar() and the career total.
// Run from app/:  node src/safezone/radiation.test.js
import assert from 'node:assert/strict'
import {
  RAD_SURFACE_MSV_PER_DAY, SOLAR_STORM_FACTOR, HABITAT_SHIELDING_FACTOR, CAREER_LIMIT_MSV,
  walkDoseMSv, doseRateMSvPerDay, doseSoFar, careerTotal,
} from './radiation.js'

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`)
const H = 3600000
const t0 = Date.parse('2026-11-14T08:00:00Z')

// Rates
close(doseRateMSvPerDay(), RAD_SURFACE_MSV_PER_DAY, 'outside, normal')
close(doseRateMSvPerDay({ solarStorm: true }), 0.67 * SOLAR_STORM_FACTOR, 'outside, storm')
close(doseRateMSvPerDay({ inside: true }), 0.67 * HABITAT_SHIELDING_FACTOR, 'inside, normal')
close(doseRateMSvPerDay({ inside: true, solarStorm: true }), 0.67 * HABITAT_SHIELDING_FACTOR * SOLAR_STORM_FACTOR, 'inside, storm')

// No storm: same as walkDoseMSv
const calm = doseSoFar({ periods: [{ startMs: t0, endMs: t0 + 6 * H, inside: false }] })
close(calm.doseMSv, walkDoseMSv(6), '6 h outside')
assert.equal(calm.stormMinutes, 0)
close(calm.outsideMinutes, 360, 'outside minutes')

// 4 h outside, then 2 h inside; a storm from hour 3 to hour 5 (1 h outside, 1 h inside)
const day = 24
const mixed = doseSoFar({
  periods: [{ startMs: t0, endMs: t0 + 4 * H, inside: false }, { startMs: t0 + 4 * H, endMs: t0 + 6 * H, inside: true }],
  storms: [{ startMs: t0 + 3 * H, endMs: t0 + 5 * H }],
})
const expected = (0.67 / day) * (3 + 1 * 2) + (0.67 * 0.5 / day) * (1 * 2 + 1)
close(mixed.doseMSv, expected, 'outside + inside with storm')
close(mixed.stormMinutes, 120, 'storm minutes inside and outside')
close(mixed.stormExtraMSv, (0.67 / day) * 1 + (0.67 * 0.5 / day) * 1, 'extra from storm')
close(mixed.insideMinutes, 120, 'inside minutes')

// nowMs cuts the timeline; an open period / open storm runs up to now
const live = doseSoFar({ periods: [{ startMs: t0, endMs: null }], storms: [{ startMs: t0 + H }], nowMs: t0 + 2 * H })
close(live.doseMSv, (0.67 / day) * (1 + 2), 'live: 1 h normal + 1 h storm')
close(live.stormMinutes, 60, 'live storm minutes')

// Overlapping storms are not counted twice
const overlap = doseSoFar({ periods: [{ startMs: t0, endMs: t0 + 2 * H }], storms: [{ startMs: t0, endMs: t0 + H }, { startMs: t0 + 0.5 * H, endMs: t0 + 1.5 * H }] })
close(overlap.stormMinutes, 90, 'overlapping storms merged')

assert.throws(() => doseSoFar({ periods: [{ startMs: t0 }] }), /endMs/)

// Career total
const career = careerTotal({ previousMSv: 100, evaDosesMSv: [0.15, 0.2] })
close(career.totalMSv, 100.35, 'career total')
assert.equal(career.limitMSv, CAREER_LIMIT_MSV)
close(career.percentOfLimit, 100.35 / 6, 'percent of 600')
close(career.remainingMSv, 499.65, 'remaining')
close(careerTotal().totalMSv, 0, 'empty total')
assert.throws(() => careerTotal({ previousMSv: -1 }), /0 or more/)

console.log('Radiation passed: storm ×2, habitat ×0.5, doseSoFar timeline, career total vs 600 mSv.')
