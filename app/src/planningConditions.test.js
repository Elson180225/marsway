// The Planning "Conditions" box text. Run from the app folder:  node src/planningConditions.test.js
import assert from 'node:assert/strict'
import { conditionLines } from './planningEvents.js'

assert.match(conditionLines(null)[0], /No scenario: clear-weather plan/)
assert.match(conditionLines({ cancelled: true, events: [] })[0], /walk is cancelled/)
assert.match(conditionLines({ calm: true, events: [] })[0], /Calm day/)
const lines = conditionLines({ events: [
  { type: 'dust_devil', startMin: 49, durationMin: 7, pauseMinutes: 7 },
  { type: 'dust_storm', startMin: 165, durationMin: 43, speedFactor: 0.6 },
  { type: 'solar_storm', startMin: 197, durationMin: 60, warningMin: 26 },
  { type: 'rover_breakdown', startMin: 103, durationMin: null },
] })
assert.deepEqual(lines, [
  '💨 Dust devil at 0h49: 7 min wait',
  '🌪 Dust storm at 2h45, for 43 min: walking 0.6×',
  '☀️ Solar storm at 3h17, for 60 min: radiation ×2 (warned 26 min before)',
  '🚙 Rover breakdown at 1h43: walk home',
])
console.log('Conditions box text passed.')
