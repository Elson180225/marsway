import assert from 'node:assert/strict'
import { calculateMissionSchedule } from './missionSchedule.js'

const starts = [{ id: 'hab', name: 'Habitat', type: 'habitat' },
  { id: 'lookout', name: 'Boxwork Lookout', stop_minutes: 15 },
  { id: 'ridge', name: 'Ridge Sample', stop_minutes: 30 },
  { id: 'hollow', name: 'Hollow Comparison', stop_minutes: 30 },
  { id: 'mineral', name: 'Mineral Investigation', stop_minutes: 20, is_bonus: true },
  { id: 'home', name: 'Return to Habitat', type: 'home' }]
// Individual rounded legs add to 141 min; the unrounded seconds add to 142 min.
const legs = [50.2, 2.2, 7.2, 11.2, 71.2].map((minutes) => ({ seconds: minutes * 60, walk_minutes: Math.round(minutes) }))
const mission = { start_time: '2026-11-14T08:00:00Z', max_walk_minutes: 480, reserve_minutes: 120 }
const plan = calculateMissionSchedule({ mission, stops: starts, legs })
assert.equal(Math.round(plan.walking), 142)
assert.equal(Math.round(plan.science), 95)
assert.equal(Math.round(plan.total), 237)
assert.equal(Math.round(plan.margin), 123)
assert.equal(new Date(plan.start + Math.round(plan.rows.at(-1).arrival) * 60000).toISOString(), '2026-11-14T11:57:00.000Z')
assert.equal(plan.hasBonus, true)
assert.equal(calculateMissionSchedule({ mission, stops: starts, legs: legs.map(({ walk_minutes }) => ({ walk_minutes })) }).total, 236)
console.log('Mission schedule timing passed: total 3h57, 11:57 UTC finish and 2h03 reserve margin.')
