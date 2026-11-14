// Run from the app folder:  node src/pathfinding/navigation.test.js
// Turn-by-turn directions, off-route check, reroute and ETAs.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { makeGrid, gridFileFromRows } from './walkingTime.js'
import { planRoute, routeLeg } from './astar.js'
import { directionsFor, nextDirection, distanceText } from './directions.js'
import { checkOffRoute, projectOnPath, rerouteFrom, etaFor, paceFactor, pathLength2D } from './navigation.js'

const ok = (msg) => console.log('  ok  ' + msg)
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

// A pretend 300 m x 300 m map (5 m cells). height(x, y) in metres.
function pretendGrid(height, size = 60) {
  const rows = []
  for (let r = 0; r < size; r++) {
    const row = []
    for (let c = 0; c < size; c++) row.push(height((c + 0.5) * 5, size * 5 - (r + 0.5) * 5))
    rows.push(row)
  }
  return makeGrid({ elevation: gridFileFromRows(rows, 5) })
}
const flat = pretendGrid(() => 0)

// ---------- 1. Directions ----------
console.log('Turn-by-turn directions')
{
  // East 200 m, then north 150 m.
  const path = [{ x: 12.5, y: 12.5 }, { x: 212.5, y: 12.5 }, { x: 212.5, y: 162.5 }]
  const steps = directionsFor(flat, path, { toName: 'Ridge Sample' })
  assert.deepEqual(steps.map((s) => s.turn), ['start', 'left', 'arrive'])
  assert.equal(steps[0].compass, 'east')
  assert.equal(steps[0].distance_m, 200)
  assert.equal(steps[1].compass, 'north')
  assert.equal(steps[1].start_m, 200)
  assert.equal(steps[0].slope, 'flat')
  assert.equal(steps[0].text, 'Head east, on fairly flat ground, for 200 m')
  assert.equal(steps[1].text, 'Turn left to head north, on fairly flat ground, for 150 m')
  assert.equal(steps[2].text, 'Arrive at Ridge Sample')
  ok(steps.map((s) => s.text).join(' | '))

  const at50 = nextDirection(steps, 50)
  assert.equal(at50.in_m, 150)
  assert.equal(at50.text, 'In 150 m, turn left to head north, on fairly flat ground, for 150 m')
  assert.match(nextDirection(steps, 195).text, /^Now: turn left/)
  assert.equal(nextDirection(steps, 345).text, 'Arriving at Ridge Sample')
  ok(`at 50 m: "${at50.text}"`)

  // A grid route zig-zags: 2 cells east, 1 cell north-east, again and again. That is one straight walk.
  const zig = [{ x: 2.5, y: 2.5 }]
  for (let k = 0; k < 20; k++) {
    const p = zig.at(-1)
    zig.push({ x: p.x + 10, y: p.y }, { x: p.x + 15, y: p.y + 5 })
  }
  const zs = directionsFor(flat, zig)
  assert.equal(zs.length, 2, 'zig-zag is one step + arrive')
  ok(`grid zig-zag of ${zig.length - 1} small moves = 1 direction: "${zs[0].text}"`)

  // Ground rising 15% to the north: uphill going north, downhill coming back.
  const hill = pretendGrid((x, y) => 0.15 * y)
  const up = directionsFor(hill, [{ x: 150, y: 10 }, { x: 150, y: 260 }])
  assert.equal(up[0].slope, 'up')
  assert.equal(up[0].text, 'Head north, uphill (about 9°), for 250 m')
  const down = directionsFor(hill, [{ x: 150, y: 260 }, { x: 150, y: 10 }])
  assert.equal(down[0].slope, 'down')
  close(up[0].climb_m, 37.5, 0.5, 'climb')
  ok(`"${up[0].text}" / "${down[0].text}"`)

  // A short jog sideways (under 40 m) is not its own direction.
  const jog = directionsFor(flat, [{ x: 10, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 30 }, { x: 290, y: 30 }])
  assert.equal(jog.length, 2)
  ok('a 20 m jog sideways is folded into the walk')
  assert.equal(distanceText(1234), '1.2 km')
  assert.equal(distanceText(3), '10 m')
}

// ---------- 2. Off route ----------
console.log('\nOff-route check')
{
  const path = [{ x: 0, y: 0 }, { x: 200, y: 0 }]
  assert.equal(checkOffRoute(path, { x: 50, y: 10 }).status, 'on')
  assert.equal(checkOffRoute(path, { x: 50, y: 20 }).status, 'drifting')
  const off = checkOffRoute(path, { x: 50, y: 40 })
  assert.equal(off.status, 'off')
  assert.equal(off.offRoute, true)
  close(off.along_m, 50, 1e-9, 'along')
  close(off.progress, 0.25, 1e-9, 'progress')
  ok('10 m away = on route, 20 m = drifting, 40 m = off route; progress 25%')

  // Out and back past the same spot: the last known position decides which side we are on.
  const loop = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 20 }, { x: 0, y: 20 }]
  close(projectOnPath(loop, { x: 100, y: 10 }).along_m, 100, 1e-9, 'first pass')
  close(projectOnPath(loop, { x: 100, y: 10 }, { nearAlongM: 310 }).along_m, 320, 1e-9, 'way back')
  ok('a path that doubles back: stays on the right side using the last position')
}

// ---------- 3. ETA and pace ----------
console.log('\nETAs')
{
  const t0 = Date.parse('2026-11-14T08:00:00Z')
  const plan = {
    stops: [{ id: 'hab', type: 'habitat' }, { id: 'a', stop_minutes: 10 }, { id: 'b', stop_minutes: 20, is_bonus: true }, { id: 'home', type: 'home' }],
    legs: [{ seconds: 600 }, { seconds: 1200 }, { seconds: 300 }],
  }
  const eta = etaFor(plan, { nowMs: t0 })
  const min = (ms) => (ms - t0) / 60000
  assert.deepEqual(eta.stops.map((s) => [s.id, min(s.arrive_ms), min(s.leave_ms)]), [['a', 10, 20], ['b', 40, 60], ['home', 65, 65]])
  assert.equal(eta.minutes_left, 65)
  ok('on plan: stop a 08:10, bonus b 08:40, home 09:05')

  // Halfway to b, walking 2x slower than planned, 30 min into the walk.
  const late = etaFor(plan, { nowMs: t0 + 30 * 60000, legIndex: 1, progress: 0.5, paceFactor: 2 })
  assert.deepEqual(late.stops.map((s) => min(s.arrive_ms)), [50, 80])
  ok('half way to b, walking 2x slower: b at 08:50, home 09:20')

  assert.equal(paceFactor({ plannedMinutes: 20, actualMinutes: 30 }), 1.5)
  assert.equal(paceFactor({ plannedMinutes: 2, actualMinutes: 10 }), 1, 'too little walking to judge')
  close(paceFactor({ weather: 0.6 }), 1 / 0.6, 1e-9, 'dust storm')
  assert.equal(paceFactor({ plannedMinutes: 10, actualMinutes: 100 }), 3, 'capped')
  ok('pace: 30 min for 20 planned = 1.5x; dust storm at 60% speed = 1.67x')
}

// ---------- 4. Reroute on a pretend map ----------
console.log('\nReroute')
{
  const home = { id: 'home', name: 'Habitat', x: 22.5, y: 22.5 }
  const stops = [
    { id: 's1', name: 'Stop 1', x: 222.5, y: 22.5, stop_minutes: 10 },
    { id: 'bonus', name: 'Bonus', x: 222.5, y: 222.5, stop_minutes: 20, is_bonus: true },
  ]
  const crew = { x: 102.5, y: 72.5 } // wandered 50 m off the line home → Stop 1
  const all = rerouteFrom(flat, crew, stops, home, { minutesLeft: 120 })
  assert.equal(all.fits, true)
  assert.deepEqual(all.stops.map((s) => s.id), ['here', 's1', 'bonus', 'home'])
  assert.equal(all.legs.length, 3)
  assert.equal(all.science_minutes, 30)
  ok(all.message)

  const tight = rerouteFrom(flat, crew, stops, home, { minutesLeft: all.total_minutes - 1 })
  assert.deepEqual(tight.dropped.map((s) => s.id), ['bonus'], 'bonus goes first')
  assert.equal(tight.fits, true)
  ok(tight.message)

  const none = rerouteFrom(flat, crew, stops, home, { minutesLeft: 1 })
  assert.equal(none.fits, false)
  assert.deepEqual(none.stops.map((s) => s.id), ['here', 'home'])
  ok(none.message)

  const slow = rerouteFrom(flat, crew, stops, home, { minutesLeft: 120, paceFactor: 2 })
  close(slow.walk_minutes, 2 * all.walk_minutes, 1e-9, 'pace doubles walking')
  ok('walking 2x slower doubles the walking minutes')
}

// ---------- 5. Kelly's real walk ----------
if (!existsSync(new URL('../../public/terrain/elevation.json', import.meta.url))) {
  console.log('\n(skipping real terrain: public/terrain not found)')
} else {
  const { loadTerrain, readAppJson } = await import('./nodeTerrain.js')
  const { grid, habitat } = loadTerrain()
  const science = readAppJson('public/routes/science-stops.json').stops
  const home = { id: 'home', name: 'Home (H1)', type: 'home', x: habitat.x, y: habitat.y }
  const plan = planRoute(grid, [{ ...habitat, type: 'habitat' }, ...science, home])
  console.log(`\nKelly's walk on the real terrain (${grid.width} x ${grid.height} cells)`)

  for (const leg of plan.legs) {
    const to = plan.stops.find((s) => s.id === leg.to_stop_id)
    const steps = directionsFor(grid, leg, { toName: to.name })
    const length = pathLength2D(leg.path)
    assert.equal(steps.at(-1).turn, 'arrive')
    close(steps.at(-2).end_m, length, 1, 'steps cover the whole leg')
    for (let k = 0; k < steps.length - 2; k++) assert.equal(steps[k].end_m, steps[k + 1].start_m, 'steps join up')
    if (steps.length > 2) assert.ok(steps.slice(0, -1).every((s) => s.distance_m >= 40), 'no tiny steps')
    console.log(`    → ${to.name} (${leg.distance_m} m): ${steps.length - 1} direction(s)`)
    for (const s of steps) console.log(`        ${s.text}${s.caution ? `   ⚠ ${s.caution}` : ''}`)
  }
  ok('every leg: directions join up, cover the whole leg, none shorter than 40 m')

  // ETA from the start matches the whole-walk plan: 2 h 22 walking + 1 h 35 science.
  const start = Date.parse('2026-11-14T08:00:00Z')
  const eta = etaFor(plan, { nowMs: start })
  const walk = plan.legs.reduce((s, l) => s + l.seconds / 60, 0)
  close(eta.minutes_left, walk + 95, 1e-6, 'ETA total')
  const hhmm = (ms) => new Date(Math.round(ms / 60000) * 60000).toISOString().slice(11, 16)
  ok(`ETAs: ${eta.stops.map((s) => `${s.name} ${hhmm(s.arrive_ms)}`).join(', ')}`)

  // The crew wanders 60 m off the first leg, half way along, then asks for a new route.
  const leg = plan.legs[0]
  const half = projectOnPath(leg.path, leg.path[Math.floor(leg.path.length / 2)])
  const seg = leg.path[half.segment + 1]
  const dir = Math.atan2(seg.y - half.point.y, seg.x - half.point.x) || 0
  const crew = { x: half.point.x - 60 * Math.sin(dir), y: half.point.y + 60 * Math.cos(dir) }
  const where = checkOffRoute(leg.path, crew)
  assert.equal(where.status, 'off')
  const t = performance.now()
  const minutesLeft = 360 - 25 // 25 min into a 6 h usable budget
  const again = rerouteFrom(grid, crew, science, home, { minutesLeft })
  const ms = performance.now() - t
  assert.equal(again.fits, true)
  assert.equal(again.legs.length, science.length + 1)
  ok(`${Math.round(where.distance_m)} m off route → new route in ${ms.toFixed(0)} ms: ${again.message}`)
  const tight = rerouteFrom(grid, crew, science, home, { minutesLeft: again.total_minutes - 5 })
  assert.deepEqual(tight.dropped.map((s) => s.id), [science.find((s) => s.is_bonus).id])
  ok(`5 min short: ${tight.message}`)
}

console.log('\nAll navigation tests passed.')
