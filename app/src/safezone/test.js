// Run from the app folder:  node src/safezone/test.js
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { makeGrid, gridFileFromRows, stepSeconds, cellToXY } from '../pathfinding/walkingTime.js'
import { findPathCells, reachableFrom, snapToReachable, routeLeg } from '../pathfinding/astar.js'
import { timeHomeMap, timeFromMap, homeArrows } from './timeHome.js'
import { turnBackTimer } from './turnBack.js'
import { stormRoute } from './storm.js'
import { walkDoseMSv } from './radiation.js'
import { safeZone, zoneToPixels, ZONE } from './safeZone.js'

const ok = (msg) => console.log('  ok  ' + msg)
// Seconds for one step between two neighbouring cells (len 1 straight, √2 diagonal).
const stepOf = (grid, a, b) => {
  const da = Math.abs((a % grid.width) - (b % grid.width)) + Math.abs(((a / grid.width) | 0) - ((b / grid.width) | 0))
  return stepSeconds(grid, a, b, da === 2 ? Math.SQRT2 : 1)
}

// ---------- 1. Pretend 10 x 10 grid: flat ground with a cliff ----------
console.log('Pretend grid (10 x 10, 5 m squares): flat, with a cliff')
const W = 10
const cliff = (c, r) => (c === 4 || c === 5) && r >= 1 && r <= 6 // two columns of no-go squares
const rows = []
for (let r = 0; r < W; r++) rows.push(Array.from({ length: W }, (_, c) => (cliff(c, r) ? 30 : 0)))
const elevation = gridFileFromRows(rows, 5)
const slope = gridFileFromRows(rows.map((row) => row.map((h) => (h > 0 ? 40 : 0))), 5)
const toy = makeGrid({ elevation, slope })
const home = 3 * W + 2 // col 2, row 3
const t = timeHomeMap(toy, home)

for (let r = 0; r < W; r++) {
  let line = ''
  for (let c = 0; c < W; c++) {
    const i = r * W + c
    line += (i === home ? '  H' : toy.blocked[i] ? '###' : String(Math.round(t[i])).padStart(3)) + ' '
  }
  console.log('    ' + line)
}
console.log('    (seconds to walk home; H = habitat, ### = cliff)')

assert.equal(t[home], 0)
ok('habitat is 0')
assert.ok(t[3 * W + 3] < t[3 * W + 7], 'squares behind the cliff should take longer')
ok(`right next to home: ${t[3 * W + 3].toFixed(0)} s; straight across the cliff: ${t[3 * W + 7].toFixed(0)} s (had to walk around)`)
for (let i = 0; i < W * W; i++) if (toy.blocked[i]) assert.equal(t[i], Infinity)
ok('cliff squares are never reachable')

// Safe zone on the pretend grid: give the crew only 60 s left and see what stays green.
const tiny = safeZone(toy, home, { settings: { suitHours: 60 / 3600, reserveHours: 0 } })
for (let i = 0; i < W * W; i++) {
  const total = timeFromMap(toy, home)[i] + t[i]
  assert.equal(tiny.zone[i] === ZONE.SAFE, total <= 60, `cell ${i}: safe must mean out + back <= 60 s`)
}
assert.equal(tiny.zone[home], ZONE.SAFE)
assert.equal(tiny.zone[3 * W + 7], ZONE.OUT, 'behind the cliff is too far for 60 s')
// Arrows: following next-step-home from every square must add up to its time home.
const toyArrows = homeArrows(toy, home)
for (let i = 0; i < W * W; i++) {
  if (toy.blocked[i]) { assert.equal(toyArrows.nextHome[i], -1); continue }
  let sum = 0
  for (let c = i; c !== home; c = toyArrows.nextHome[c]) sum += stepOf(toy, c, toyArrows.nextHome[c])
  assert.ok(Math.abs(sum - t[i]) < 0.01, `arrows from ${i} should add up to ${t[i]}, got ${sum}`)
}
ok('next-step-home arrows: following them from any square takes exactly its time home')

ok(`60 s of suit time: ${tiny.safeCells} squares safe, habitat safe, behind the cliff not`)

// ---------- 2. Real terrain: must match Nigel's route planner ----------
const dataDir = new URL('../../../data/processed/', import.meta.url)
if (!existsSync(dataDir)) {
  console.log('\n(skipping real terrain: data/processed not found)')
} else {
  console.log('\nReal terrain: 600 x 600 squares at 5 m, habitat H1')
  const load = (f) => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'))
  const area = load('area.json')
  const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })
  const h1 = area.habitatCandidates[0]
  const hab = h1.row * grid.width + h1.col

  const start = performance.now()
  const real = timeHomeMap(grid, hab)
  const ms = performance.now() - start
  ok(`whole map done in ${ms.toFixed(0)} ms`)

  const reach = real.filter((s) => s < Infinity).length
  ok(`can get home from ${((reach / real.length) * 100).toFixed(0)}% of the map (Elson said about 75%)`)

  // Check against Nigel: walking boxwork -> H1 with his A* must give the same time.
  // The exact centre is on no-go ground; move it to safe ground like Nigel's planner does.
  const box = snapToReachable(grid, reachableFrom(grid, hab), 1500, 1500)
  const nigel = findPathCells(grid, box, hab)
  const mine = real[box]
  console.log(`      boxwork centre -> home:  mine ${(mine / 60).toFixed(1)} min,  Nigel's route ${(nigel.seconds / 60).toFixed(1)} min`)
  assert.ok(Math.abs(mine - nigel.seconds) < 1, 'time-home must match the route planner')
  ok('matches Nigel\'s route planner')

  const there = findPathCells(grid, hab, box)
  ok(`direction matters: out ${(there.seconds / 60).toFixed(1)} min, back ${(mine / 60).toFixed(1)} min`)

  // ---------- 3. Safe zone on real terrain ----------
  console.log('\nSafe zone (8 h suit, 2 h reserve)')
  const pct = (cells) => `${((cells / real.length) * 100).toFixed(0)}%`

  // Before leaving: everywhere you can get home from is a safe round trip (the area is only 3 km).
  const before = safeZone(grid, hab, { timeHome: real })
  assert.equal(before.safeCells, reach)
  ok(`before leaving: ${pct(before.safeCells)} of the map safe, i.e. all of it you can get home from`)

  // The time-home map has to agree with a fresh outward search: walk out H1 -> box with A*.
  assert.ok(Math.abs(before.timeFrom[box] - there.seconds) < 1, 'walk-out map must match the route planner')
  ok('walk-out times match Nigel\'s route planner too')

  // EVA-07: crew at the boxwork, 4 h 30 m used. Is there time for a 20 min bonus stop?
  const s = safeZone(grid, hab, { here: box, elapsedSeconds: 4.5 * 3600, stopSeconds: 20 * 60, timeHome: real })
  ok(`at the boxwork after 4 h 30 m: ${(s.secondsLeft / 60).toFixed(0)} min left before reserve`)
  ok(`bonus stop (20 min) possible on ${pct(s.safeCells)} of the map, ${pct(s.reserveCells)} more only by using the reserve`)
  ok(`turn-back timer: ${(s.spareSeconds / 60).toFixed(0)} min spare before they must head home`)
  assert.equal(s.zone[box] === ZONE.SAFE, s.timeHome[box] + 20 * 60 <= s.secondsLeft)

  // Every green square must really work: plan it with Nigel's A* and add it up.
  const greens = []
  for (let i = 0; i < s.zone.length; i++) if (s.zone[i] === ZONE.SAFE) greens.push(i)
  for (let k = 0; k < 20; k++) {
    const c = greens[Math.floor((k / 20) * greens.length)]
    const total = findPathCells(grid, box, c).seconds + 20 * 60 + findPathCells(grid, c, hab).seconds
    assert.ok(total <= s.secondsLeft + 1, `green square ${c} is not actually safe`)
  }
  ok('20 green squares checked with Nigel\'s A*: all get home in time')

  // More time used means a smaller zone, and late enough means "turn back now".
  const later = safeZone(grid, hab, { here: box, elapsedSeconds: 5.5 * 3600, timeHome: real })
  assert.ok(later.safeCells < s.safeCells)
  assert.ok(later.spareSeconds < s.spareSeconds)
  const late = safeZone(grid, hab, { here: box, elapsedSeconds: 6 * 3600 - 30 * 60, timeHome: real })
  assert.ok(late.spareSeconds < 0, '30 min left but 47.7 min from home: must be told to turn back')
  ok(`30 min before reserve: ${late.safeCells} safe squares, spare ${(late.spareSeconds / 60).toFixed(0)} min, so TURN BACK`)

  const timed = performance.now()
  safeZone(grid, hab, { here: box, elapsedSeconds: 4.5 * 3600, timeHome: real })
  const px = zoneToPixels(s.zone, grid)
  assert.equal(px.data.length, 600 * 600 * 4)
  // Spare minutes for Aaron: same story as the zone, as a number.
  for (let i = 0; i < s.zone.length; i++) assert.equal(s.spareMinutes[i] >= 0, s.zone[i] === ZONE.SAFE)
  const bestSpare = s.spareMinutes.reduce((a, b) => Math.max(a, b), -Infinity)
  ok(`spare-minutes map agrees with the zone (most spare anywhere: ${bestSpare.toFixed(0)} min)`)

  ok(`new zone + picture in ${(performance.now() - timed).toFixed(0)} ms (fast enough to redo every minute on the walk)`)
}
// ---------- 4. Turn-back timer, storm route, radiation ----------
if (existsSync(dataDir)) {
  console.log('\nTurn-back timer, solar storm route, radiation')
  const load = (f) => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'))
  const area = load('area.json')
  const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })
  const h1 = area.habitatCandidates[0]
  const hab = h1.row * grid.width + h1.col
  const arrows = homeArrows(grid, hab)
  const box = snapToReachable(grid, reachableFrom(grid, hab), 1500, 1500)
  const crew = cellToXY(grid, box)

  // Turn-back timer: must give the same answer as the safe zone's spare time.
  const tb = turnBackTimer(grid, arrows.timeHome, crew, 270)
  const sz = safeZone(grid, hab, { here: box, elapsedSeconds: 270 * 60, timeHome: arrows.timeHome })
  assert.ok(Math.abs(tb.turnbackIn - sz.spareSeconds / 60) < 0.01)
  ok(`at the boxwork after 4 h 30 m: ${tb.title}, turn back in ${tb.turnbackIn.toFixed(0)} min (home is ${tb.homeMinutes.toFixed(1)} min away)`)
  assert.equal(turnBackTimer(grid, arrows.timeHome, crew, 300).level, 'caution')
  assert.equal(turnBackTimer(grid, arrows.timeHome, crew, 315).level, 'danger')
  ok('after 5 h: "Turn back soon"; after 5 h 15 m: "Turn back now"')
  // Standing on a cliff edge (no-go square): uses the nearest safe square instead of failing.
  const cliff = grid.blocked.indexOf(1, box)
  assert.ok(turnBackTimer(grid, arrows.timeHome, cellToXY(grid, cliff), 0).homeMinutes < Infinity)
  ok('GPS on a no-go square still gets a time (nearest safe square)')
  assert.equal(turnBackTimer(grid, arrows.timeHome, { x: -100, y: 50 }, 0).level, 'danger')
  ok('off the map: "No safe way home"')

  // Storm route: follow the arrows home. Same time as the map, and as quick as Nigel's route.
  const storm = stormRoute(grid, arrows, crew)
  const nigel = routeLeg(grid, crew, cellToXY(grid, hab))
  assert.ok(Math.abs(storm.seconds - arrows.timeHome[box]) < 0.01)
  assert.ok(Math.abs(storm.seconds - nigel.seconds) < 1, 'storm route must be as quick as the route planner')
  const end = storm.path[storm.path.length - 1]
  assert.deepEqual(end, cellToXY(grid, hab))
  ok(`storm route from the boxwork: ${storm.walk_minutes} min, ${(storm.distance_m / 1000).toFixed(2)} km, ends at H1 (Nigel: ${nigel.walk_minutes} min, ${(nigel.distance_m / 1000).toFixed(2)} km)`)
  const timed = performance.now()
  for (let k = 0; k < 100; k++) stormRoute(grid, arrows, crew)
  ok(`storm route takes ${((performance.now() - timed) / 100).toFixed(2)} ms (no new search)`)
  assert.equal(stormRoute(grid, arrows, { x: -100, y: 50 }), null)

  // Radiation: 0.67 mSv/day from Curiosity's RAD.
  assert.ok(Math.abs(walkDoseMSv(24) - 0.67) < 1e-9)
  ok(`radiation: 6 h walk ≈ ${walkDoseMSv(6).toFixed(3)} mSv, full 8 h suit ≈ ${walkDoseMSv(8).toFixed(3)} mSv`)
}

console.log('\nAll time-home and safe-zone checks passed.')
