/**
 * Stop checker: is every stop safe to walk to from H1, and does the whole walk fit the suit?
 *
 * Run from the app folder:
 *   node src/pathfinding/checkStops.js                        checks public/routes/science-stops.json
 *   node src/pathfinding/checkStops.js path/to/stops.json     checks another stops file
 *   node src/pathfinding/checkStops.js 1561,1640 1633,1591    checks x,y points (in visit order)
 *
 * A stops file is { stops: [{ id, name, x, y, stop_minutes?, is_bonus? }] } or just the array.
 * Exits with code 1 if any stop can't be reached, so it can be used in scripts.
 */
import { planRoute, reachableFrom, snapToReachable, routeLeg } from './astar.js'
import { xyToCell, cellToXY } from './walkingTime.js'
import { loadTerrain, readAppJson } from './nodeTerrain.js'
import { readFileSync } from 'node:fs'

const SUIT_MINUTES = 480 // 8 h suit
const RESERVE_MINUTES = 120 // 2 h never planned to be used
const USABLE = SUIT_MINUTES - RESERVE_MINUTES

function readStops(args) {
  if (!args.length) return readAppJson('public/routes/science-stops.json').stops
  if (args.every((a) => /^-?[\d.]+,-?[\d.]+$/.test(a))) {
    return args.map((a, k) => {
      const [x, y] = a.split(',').map(Number)
      return { id: `p${k + 1}`, name: `Point ${k + 1} (${x}, ${y})`, x, y }
    })
  }
  const file = JSON.parse(readFileSync(args[0], 'utf8'))
  return Array.isArray(file) ? file : file.stops
}

const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`)

const { grid, habitat, habitatCell } = loadTerrain()
const stops = readStops(process.argv.slice(2))
const reachable = reachableFrom(grid, habitatCell)

// ---- 1. Each stop on its own ----
console.log(`Checking ${stops.length} stop(s) from ${habitat.name} at (${habitat.x}, ${habitat.y})\n`)
let problems = 0
for (const s of stops) {
  const cell = xyToCell(grid, s.x, s.y)
  if (cell < 0) {
    console.log(`  ✗ ${s.name}: outside the map`)
    problems++
    continue
  }
  const snapped = snapToReachable(grid, reachable, s.x, s.y, 50)
  const slope = grid.slope[cell].toFixed(0)
  if (snapped < 0) {
    console.log(`  ✗ ${s.name}: slope ${slope}°, NO safe ground within 50 m: pick another spot`)
    problems++
    continue
  }
  const p = cellToXY(grid, snapped)
  const moved = snapped === cell ? 0 : Math.round(Math.hypot(p.x - s.x, p.y - s.y))
  const out = routeLeg(grid, habitat, p)
  const back = routeLeg(grid, p, habitat)
  const where = moved ? `would be moved ${moved} m to safe ground` : 'on safe ground'
  const steep = slope > grid.suit.slopeWarnDeg ? ' (steep spot)' : ''
  console.log(`  ✓ ${s.name}: slope ${slope}°${steep}, ${where}. Direct from H1: ${out.walk_minutes} min out, ${back.walk_minutes} min back`)
}
if (problems) {
  console.log(`\n${problems} stop(s) need changing before a route can be planned.`)
  process.exit(1)
}

// ---- 2. The whole walk in order ----
const plan = planRoute(grid, [habitat, ...stops, { id: 'home', name: 'Home (H1)', x: habitat.x, y: habitat.y }])
console.log('\nThe walk, in order:')
let walk = 0
let distance = 0
for (const leg of plan.legs) {
  walk += leg.seconds / 60
  distance += leg.distance_m
  const to = plan.stops.find((s) => s.id === leg.to_stop_id)
  console.log(`  → ${to.name}: ${leg.distance_m} m, ${leg.walk_minutes} min`)
  for (const w of leg.warnings) console.log(`      [${w.level}] ${w.message}`)
}

// ---- 3. Does it fit the suit? ----
const work = stops.reduce((sum, s) => sum + (Number(s.stop_minutes) || 0), 0)
const bonus = stops.filter((s) => s.is_bonus)
const total = walk + work
console.log(`\nTotal: ${(distance / 1000).toFixed(2)} km, walking ${mins(walk)}${work ? ` + science ${mins(work)} = ${mins(total)}` : ' (no stop_minutes given, walking only)'}`)
console.log(`Usable suit time: ${mins(USABLE)} (8 h suit minus 2 h reserve)`)
if (total <= USABLE) console.log(`✓ Fits, with ${mins(USABLE - total)} to spare${bonus.length ? ` (bonus stop: ${bonus.map((b) => b.name).join(', ')})` : ''}.`)
else console.log(`✗ Too long by ${mins(total - USABLE)}: drop or move a stop.`)

const worst = plan.returns.reduce((a, r) => (r.walk_minutes > a.walk_minutes ? r : a))
console.log(`Farthest from home: ${plan.stops.find((s) => s.id === worst.from_stop_id).name}, ${worst.walk_minutes} min walk back.`)
