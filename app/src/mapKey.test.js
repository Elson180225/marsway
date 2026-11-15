// Planning map key. Run from the app folder:  node src/mapKey.test.js
import assert from 'node:assert/strict'
import { mapKeySections } from './mapKey.js'
import { SUIT } from './pathfinding/walkingTime.js'
import { ROVER_RULES } from './pathfinding/rover.js'

const titles = (sections) => sections.map((s) => s.title)
const labels = (sections, title) => sections.find((s) => s.title.startsWith(title)).rows.map((r) => r.label)

// Default Planning map: basemap and safe zone on.
const start = mapKeySections({ active: new Set(['terrain', 'safety']), elevation: { min: -4226.6, max: -2998.7 } })
assert.deepEqual(titles(start), ['Route', 'Basemap', 'Safe zone (from the safety-check point and time)'])
assert.match(labels(start, 'Basemap')[0], /dark = low \(-4227 m\), light = high \(-2999 m\)/)
assert.equal(labels(start, 'Route').some((l) => /Rover drive/.test(l)), false, 'no drive line on foot')
assert.match(labels(start, 'Route')[0], /^Habitat/)
assert.deepEqual(labels(start, 'Safe zone').map((l) => l.split(':')[0]), ['Green', 'Amber', 'Red', 'No colour', 'White dot'])
console.log('  ok  default: route, basemap with real heights, safe zone green/amber/red/clear')

// Slope labels use the same limits as the route planner and the rover.
const slope = labels(mapKeySections({ active: new Set(['slope']) }), 'Slope')
assert.equal(slope.length, 4)
assert.match(slope[1], new RegExp(`10–${ROVER_RULES.maxSlopeDeg}°: .*OK for the rover`))
assert.match(slope[2], new RegExp(`${SUIT.slopeWarnDeg}–${SUIT.slopeNoGoDeg}°: steep.*too steep for the rover`))
assert.match(slope[3], new RegExp(`Over ${SUIT.slopeNoGoDeg}°: no-go`))
assert.match(labels(mapKeySections({ active: new Set(['roughness']) }), 'Roughness')[0], new RegExp(`Over ${SUIT.roughWarnDeg}°`))
console.log(`  ok  slope ${SUIT.slopeWarnDeg}°/${SUIT.slopeNoGoDeg}° and rover ${ROVER_RULES.maxSlopeDeg}° match the planner; roughness note at ${SUIT.roughWarnDeg}°`)

// With rover: the start is the rover, and the drive line is explained.
const rover = labels(mapKeySections({ active: new Set(), roverMode: true }), 'Route')
assert.match(rover[0], /^Rover parking/)
assert.ok(rover.some((l) => /Rover drive/.test(l)))
console.log('  ok  With rover: rover parking marker and drive line')

// Science layers point to their own note; nothing switched on = just the route.
assert.match(labels(mapKeySections({ active: new Set(['crismHyd']) }), 'Orbital')[0], /^CRISM hydrated: .*note below/)
assert.deepEqual(titles(mapKeySections({ active: new Set() })), ['Route'])
console.log('  ok  orbital layers point to their note; layers off = only the route key')
console.log('\nMap key tests passed.')
