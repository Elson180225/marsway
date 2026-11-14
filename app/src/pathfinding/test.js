// Run from the app folder:  node src/pathfinding/test.js
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { suitSpeedMps, makeGrid, gridFileFromRows, cellToXY, xyToCell } from './walkingTime.js'
import { findPathCells, planRoute } from './astar.js'

const ok = (msg) => console.log('  ok  ' + msg)

// ---------- 1. Walking speed ----------
console.log('Walking speed')
const flat = suitSpeedMps(0)
assert.ok(Math.abs(flat - 0.7) < 0.001, `flat suited speed should be ~0.70 m/s, got ${flat}`)
ok(`flat ground: ${flat.toFixed(2)} m/s (${(flat * 3.6).toFixed(2)} km/h), 1 km in ${(1000 / flat / 60).toFixed(0)} min`)
assert.ok(suitSpeedMps(0.1) < suitSpeedMps(-0.1))
ok(`10% uphill ${suitSpeedMps(0.1).toFixed(2)} m/s is slower than 10% downhill ${suitSpeedMps(-0.1).toFixed(2)} m/s`)

// ---------- 2. Pretend grid: a ridge with one gap ----------
console.log('\nPretend grid (10 m cells): a steep ridge with a gap')
const W = 40
const H = 15
const rows = []
for (let r = 0; r < H; r++) {
  const row = []
  for (let c = 0; c < W; c++) row.push(c >= 18 && c <= 21 && r !== 11 ? 30 : 0) // 30 m high ridge, gap at row 11
  rows.push(row)
}
const elevation = gridFileFromRows(rows, 10)
const slope = gridFileFromRows(rows.map((row, r) => row.map((_, c) => (rows[r][c] > 0 ? 40 : 0))), 10)
const toy = makeGrid({ elevation, slope })
const A = { id: 'hab', name: 'Habitat', ...cellToXY(toy, 2 * W + 2) }
const B = { id: 'goal', name: 'Goal', ...cellToXY(toy, 2 * W + 37) }
const toyPath = findPathCells(toy, xyToCell(toy, A.x, A.y), xyToCell(toy, B.x, B.y))
assert.ok(toyPath, 'should find a path through the gap')
assert.ok(toyPath.cells.every((i) => !toy.blocked[i]), 'path must avoid no-go cells')
const onPath = new Set(toyPath.cells)
for (let r = 0; r < H; r++) {
  let line = ''
  for (let c = 0; c < W; c++) {
    const i = r * W + c
    line += i === toyPath.cells[0] ? 'S' : i === toyPath.cells.at(-1) ? 'G' : onPath.has(i) ? '*' : toy.blocked[i] ? '#' : '.'
  }
  console.log('    ' + line)
}
ok(`goes round the ridge through the gap: ${(toyPath.seconds / 60).toFixed(1)} min`)

// ---------- 3. A* gives the same answer as plain Dijkstra ----------
console.log('\nA* vs Dijkstra on a random bumpy grid')
let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const N = 80
const bumpy = []
for (let r = 0; r < N; r++) {
  const row = []
  for (let c = 0; c < N; c++) row.push(20 * Math.sin(r / 7) * Math.cos(c / 9) + 8 * rand())
  bumpy.push(row)
}
const bg = makeGrid({ elevation: gridFileFromRows(bumpy, 5) })
for (let t = 0; t < 20; t++) {
  const s = Math.floor(rand() * N * N)
  const g = Math.floor(rand() * N * N)
  const a = findPathCells(bg, s, g)
  const d = findPathCells(bg, s, g, { useHeuristic: false })
  assert.equal(!!a, !!d)
  if (a) assert.ok(Math.abs(a.seconds - d.seconds) < 1e-6, `A* ${a.seconds} != Dijkstra ${d.seconds}`)
}
ok('20 random trips: A* always matches Dijkstra')

// ---------- 4. Real terrain from Elson ----------
const dataDir = new URL('../../../data/processed/', import.meta.url)
if (!existsSync(new URL('elevation.json', dataDir))) {
  console.log('\n(skipping real terrain: data/processed not found)')
} else {
  console.log('\nReal terrain: Mount Sharp boxwork, 600 x 600 cells at 5 m')
  const load = (f) => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'))
  const area = load('area.json')
  const t0 = performance.now()
  const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })
  const rough = Array.from(grid.roughness).sort((a, b) => a - b)
  const pct = (p) => rough[Math.floor((rough.length - 1) * p)].toFixed(1)
  ok(`loaded in ${(performance.now() - t0).toFixed(0)} ms; no-go cells ${(100 * grid.blocked.reduce((s, v) => s + v, 0) / grid.blocked.length).toFixed(1)}%; roughness median ${pct(0.5)}°, 90th pct ${pct(0.9)}°`)

  const h1 = area.habitatCandidates[0]
  const stops = [
    { id: 'hab', name: 'Habitat (H1)', x: h1.x, y: h1.y },
    { id: 'boxwork', name: 'Boxwork centre (test)', x: 1500, y: 1500 },
    { id: 'home', name: 'Return to Habitat', x: h1.x, y: h1.y },
  ]
  const t1 = performance.now()
  const plan = planRoute(grid, stops)
  const { legs, returns } = plan
  const ms = performance.now() - t1
  for (const s of plan.stops) if (s.moved_m) console.log(`      ${s.name} moved ${s.moved_m} m to reachable ground`)
  for (const leg of legs) {
    console.log(`      ${leg.from_stop_id} -> ${leg.to_stop_id}: ${leg.distance_m} m, ${leg.walk_minutes} min, ${leg.path.length} map points`)
    for (const w of leg.warnings) console.log(`        [${w.level}] ${w.message}`)
  }
  assert.equal(returns.length, stops.length)
  ok(`planned ${legs.length} legs + ${returns.length} returns in ${ms.toFixed(0)} ms`)
}

console.log('\nAll tests passed.')
