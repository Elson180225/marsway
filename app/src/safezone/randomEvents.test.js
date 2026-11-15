// Random events: same seed → same events, believable odds, events stay inside the walk.
// Run from app/:  node src/safezone/randomEvents.test.js
import assert from 'node:assert/strict'
import { randomEvents, activeEvents, randomSeed, EVENT_RULES } from './randomEvents.js'

const walk = { eva: '08', durationMinutes: 261 }

// Same seed gives the same events
assert.deepEqual(randomEvents({ seed: 4821, version: 'rover', ...walk }), randomEvents({ seed: 4821, version: 'rover', ...walk }))

// Scenario #4821 (the example shared with Aaron and Russell) stays the same
const example = randomEvents({ seed: 4821, version: 'rover', ...walk })
assert.equal(example.label, 'Scenario #4821')
assert.deepEqual(example.events.map((e) => [e.type, e.startMin, e.durationMin]), [['dust_devil', 54, 7], ['dust_storm', 184, 43]])

// Foot and rover versions of one seed get the same weather (only the breakdown differs)
const weather = (r) => r.events.filter((e) => e.type !== 'rover_breakdown')
for (let seed = 1; seed <= 500; seed++) {
  assert.deepEqual(weather(randomEvents({ seed, version: 'foot', ...walk })), weather(randomEvents({ seed, version: 'rover', ...walk })))
}

// Over every seed: odds look sensible and every event is inside the walk
const count = { calm: 0, cancelled: 0, dust_storm: 0, dust_devil: 0, solar_storm: 0, rover_breakdown: 0 }
const SEEDS = 9999
for (let seed = 1; seed <= SEEDS; seed++) {
  const foot = randomEvents({ seed, version: 'foot', ...walk })
  const rover = randomEvents({ seed, version: 'rover', ...walk })
  assert.equal(foot.label, `Scenario #${seed}`)
  assert.ok(!foot.events.some((e) => e.type === 'rover_breakdown'), 'no rover breakdown on foot')
  assert.equal(foot.calm, foot.events.length === 0)
  if (foot.cancelled) {
    count.cancelled++
    assert.deepEqual(foot.events.map((e) => e.type), ['global_dust_storm'], 'a global storm comes alone')
  }
  if (foot.calm) count.calm++
  for (const e of [...foot.events, ...rover.events]) {
    assert.ok(e.startMin >= 0 && e.startMin < walk.durationMinutes, `${e.type} starts inside the walk (seed ${seed})`)
    if (e.durationMin !== null) {
      assert.ok(e.durationMin > 0, `${e.type} has a length`)
      assert.ok(e.startMin + e.durationMin <= walk.durationMinutes, `${e.type} ends inside the walk (seed ${seed})`)
    }
    assert.ok(e.title && e.message, 'has pop-up text')
  }
  for (let i = 1; i < rover.events.length; i++) assert.ok(rover.events[i - 1].startMin <= rover.events[i].startMin, 'sorted by start')
  for (const e of foot.events) if (e.type in count) count[e.type]++
  for (const e of rover.events) if (e.type === 'rover_breakdown') count.rover_breakdown++
}
const share = (n) => n / SEEDS
assert.ok(share(count.calm) > 0.3 && share(count.calm) < 0.5, `about 4 in 10 calm: ${share(count.calm)}`)
assert.ok(count.dust_storm > 2 * count.solar_storm, 'dust storms more common than solar storms')
assert.ok(share(count.cancelled) < 0.04, `global storms are rare: ${share(count.cancelled)}`)
assert.ok(share(count.rover_breakdown) > 0.05 && share(count.rover_breakdown) < 0.15, 'rover breakdown about 1 in 10')

// Lengths follow EVENT_RULES
for (let seed = 1; seed <= 2000; seed++) {
  for (const e of randomEvents({ seed, version: 'foot', durationMinutes: 480 }).events) {
    const rule = EVENT_RULES[e.type]
    if (rule.maxLength) assert.ok(e.durationMin <= rule.maxLength, `${e.type} not longer than ${rule.maxLength}`)
  }
}

// Short walks still work (60 min is the shortest allowed)
for (let seed = 1; seed <= 2000; seed++) {
  for (const e of randomEvents({ seed, version: 'rover', durationMinutes: 60 }).events) {
    assert.ok(e.startMin >= 0 && e.startMin < 60, 'short walk: starts inside')
    if (e.durationMin !== null) assert.ok(e.startMin + e.durationMin <= 60, 'short walk: ends inside')
  }
}

// activeEvents
const events = [{ type: 'dust_storm', startMin: 95, durationMin: 40 }, { type: 'rover_breakdown', startMin: 180, durationMin: null }]
assert.deepEqual(activeEvents(events, 94), [])
assert.equal(activeEvents(events, 95).length, 1)
assert.equal(activeEvents(events, 135).length, 0, 'storm over at start + length')
assert.equal(activeEvents(events, 250)[0].type, 'rover_breakdown', 'null length lasts to the end')

// randomSeed gives a valid scenario number
for (let i = 0; i < 1000; i++) {
  const seed = randomSeed()
  assert.ok(Number.isInteger(seed) && seed >= 1 && seed <= 9999)
}

// Bad input
assert.throws(() => randomEvents({ seed: 0, ...walk }), /Seed/)
assert.throws(() => randomEvents({ seed: 1.5, ...walk }), /Seed/)
assert.throws(() => randomEvents({ seed: 1, version: 'car', ...walk }), /Version/)
assert.throws(() => randomEvents({ seed: 1, durationMinutes: 30 }), /60 minutes/)

console.log('Random events passed:', Object.entries(count).map(([k, v]) => `${k} ${(share(v) * 100).toFixed(0)}%`).join(', '))
