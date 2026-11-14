/**
 * For the pitch: walking in a straight line vs our safe route, from H1 to the boxwork.
 *
 * Run from the app folder:
 *   node src/pathfinding/pitchCompare.js [out.svg]
 * Prints the numbers and writes a picture (default: straight-vs-route.svg in the current folder).
 * Open the SVG in a browser and screenshot it, or drop it straight into the slides.
 *
 * Target: the first science stop in public/routes/science-stops.json (Boxwork Lookout).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { xyToCell, cellToXY, suitSpeedMps, heightAt } from './walkingTime.js'
import { findPathCells, routeLeg } from './astar.js'
import { loadTerrain, readAppJson } from './nodeTerrain.js'

const { grid, habitat, habitatCell } = loadTerrain()
const target = readAppJson('public/routes/science-stops.json').stops[0]
const { slope, elevation, suit, cellSize } = grid
const NOGO = suit.slopeNoGoDeg
const WARN = suit.slopeWarnDeg

// ---- Straight line, sampled every metre ----
const dx = target.x - habitat.x
const dy = target.y - habitat.y
const length = Math.hypot(dx, dy)
const samples = []
for (let m = 0; m <= length; m++) {
  const x = habitat.x + (dx * m) / length
  const y = habitat.y + (dy * m) / length
  samples.push({ m, x, y, cell: xyToCell(grid, x, y) })
}
let nogoM = 0
let steepM = 0
let maxSlope = 0
const nogoRuns = [] // [startMetre, endMetre] stretches over the no-go limit
for (const s of samples) {
  const deg = slope[s.cell]
  maxSlope = Math.max(maxSlope, deg)
  if (deg > NOGO) {
    nogoM++
    const last = nogoRuns.at(-1)
    if (last && s.m - last[1] <= 10) last[1] = s.m // gaps under 10 m are the same slope
    else nogoRuns.push([s.m, s.m])
  } else if (deg > WARN) steepM++
}
// Walking time on the straight line if the cliffs weren't there (same Tobler + suit + roughness model, 5 m steps).
let straightSec = 0
let straightUp = 0
let straightDown = 0
for (let m = cellSize; m <= length; m += cellSize) {
  const a = samples[Math.round(m - cellSize)]
  const b = samples[Math.min(Math.round(m), samples.length - 1)]
  const dh = heightAt(grid, b.x, b.y) - heightAt(grid, a.x, a.y)
  if (dh > 0) straightUp += dh
  else straightDown -= dh
  straightSec += (cellSize / suitSpeedMps(dh / cellSize, suit)) * ((grid.factor[a.cell] + grid.factor[b.cell]) / 2)
}

// ---- Our route ----
const leg = routeLeg(grid, habitat, target)
const cells = findPathCells(grid, habitatCell, xyToCell(grid, target.x, target.y)).cells
const routeMax = Math.max(...cells.map((i) => slope[i]))
let routeUp = 0
let routeDown = 0
for (let k = 1; k < cells.length; k++) {
  const dh = elevation[cells[k]] - elevation[cells[k - 1]]
  if (dh > 0) routeUp += dh
  else routeDown -= dh
}

const r = (n) => Math.round(n)
const straightMin = r(straightSec / 60)
console.log(`From ${habitat.name} to ${target.name}\n`)
console.log(`STRAIGHT LINE  ${(length / 1000).toFixed(2)} km, about ${straightMin} min if it were walkable; climbs ${r(straightUp)} m, descends ${r(straightDown)} m`)
console.log(`  crosses ${nogoRuns.length} no-go slopes (over ${NOGO}°): ${nogoM} m in total, up to ${r(maxSlope)}°`)
console.log(`  plus ${steepM} m of steep ground (${WARN}–${NOGO}°)`)
console.log(`OUR ROUTE      ${(leg.distance_m / 1000).toFixed(2)} km, ${leg.walk_minutes} min; climbs ${r(routeUp)} m, descends ${r(routeDown)} m`)
console.log(`  never steeper than ${r(routeMax)}°; 0 m of no-go ground`)
for (const w of leg.warnings) console.log(`  [${w.level}] ${w.message}`)
const extraM = r(leg.distance_m - length)
const dMin = leg.walk_minutes - straightMin
console.log(`\nOur route is ${extraM} m longer, but ${dMin <= 0 ? `${-dMin} min QUICKER` : `only ${dMin} min slower`}, and it never touches no-go ground.`)

// ---- Picture ----
const outFile = process.argv[2] ?? 'straight-vs-route.svg'
const png = (f) => 'data:image/png;base64,' + readFileSync(new URL('../../public/terrain/' + f, import.meta.url)).toString('base64')
const size = grid.sizeX
const Y = (y) => size - y // SVG y goes down, map y goes up
const routePts = cells.map((i) => cellToXY(grid, i))
const xs = [habitat.x, target.x, ...routePts.map((p) => p.x)]
const ys = [habitat.y, target.y, ...routePts.map((p) => p.y)]
const pad = 220
const vx = Math.max(0, Math.min(...xs) - pad)
const vy = Math.max(0, Y(Math.max(...ys)) - pad * 1.8) // room for the key at the top
const vw = Math.min(size, Math.max(...xs) + pad * 2) - vx // room for the stop name on the right
const vh = Math.min(size, Y(Math.min(...ys)) + pad) - vy
const fs = r(vw / 42)
const line = (pts) => pts.map((p) => `${p.x.toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
const nogoSegs = nogoRuns
  .map(([a, b]) => `<polyline points="${line([samples[a], samples[b]])}" stroke="#ff1f4b" stroke-width="${fs * 0.5}" stroke-linecap="round" fill="none"/>`)
  .join('')
const label = (x, y, text, anchor = 'start') =>
  `<text x="${x}" y="${Y(y)}" font-size="${fs}" text-anchor="${anchor}" fill="#fff" stroke="#000" stroke-width="${fs / 5}" paint-order="stroke" font-family="Arial, sans-serif" font-weight="bold">${text}</text>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="1600" height="${r((1600 * vh) / vw)}">
  <image href="${png('basemap.png')}" x="0" y="0" width="${size}" height="${size}"/>
  <image href="${png('slope.png')}" x="0" y="0" width="${size}" height="${size}" opacity="0.5" style="image-rendering:pixelated"/>
  <polyline points="${line([habitat, target])}" stroke="#fff" stroke-width="${fs / 4}" stroke-dasharray="${fs} ${fs * 0.6}" fill="none"/>
  ${nogoSegs}
  <polyline points="${line(routePts)}" stroke="#000" stroke-width="${fs * 0.55}" stroke-linejoin="round" fill="none" opacity="0.6"/>
  <polyline points="${line(routePts)}" stroke="#2fd3ff" stroke-width="${fs * 0.32}" stroke-linejoin="round" fill="none"/>
  <circle cx="${habitat.x}" cy="${Y(habitat.y)}" r="${fs * 0.6}" fill="#fff" stroke="#000" stroke-width="${fs / 6}"/>
  <circle cx="${target.x}" cy="${Y(target.y)}" r="${fs * 0.6}" fill="#ffd34d" stroke="#000" stroke-width="${fs / 6}"/>
  ${label(habitat.x + fs, habitat.y - fs * 0.3, 'Habitat H1')}
  ${label(target.x + fs, target.y - fs * 0.3, target.name)}
  <g transform="translate(${vx + fs} ${vy + fs})" font-family="Arial, sans-serif" font-size="${fs}">
    <rect width="${fs * 25}" height="${fs * 10.2}" rx="${fs / 2}" fill="#000" opacity="0.75"/>
    <line x1="${fs * 0.8}" y1="${fs * 1.6}" x2="${fs * 3}" y2="${fs * 1.6}" stroke="#fff" stroke-width="${fs / 4}" stroke-dasharray="${fs * 0.6} ${fs * 0.4}"/>
    <text x="${fs * 3.6}" y="${fs * 1.95}" fill="#fff">Straight line: ${(length / 1000).toFixed(2)} km</text>
    <line x1="${fs * 0.8}" y1="${fs * 3.1}" x2="${fs * 3}" y2="${fs * 3.1}" stroke="#ff1f4b" stroke-width="${fs / 2}" stroke-linecap="round"/>
    <text x="${fs * 3.6}" y="${fs * 3.45}" fill="#ff8aa0">${nogoRuns.length} no-go slopes crossed (up to ${r(maxSlope)}°)</text>
    <line x1="${fs * 0.8}" y1="${fs * 4.9}" x2="${fs * 3}" y2="${fs * 4.9}" stroke="#2fd3ff" stroke-width="${fs / 3}"/>
    <text x="${fs * 3.6}" y="${fs * 5.25}" fill="#2fd3ff">MarsWay route: ${(leg.distance_m / 1000).toFixed(2)} km, ${leg.walk_minutes} min, max ${r(routeMax)}°</text>
    <text x="${fs * 0.8}" y="${fs * 7.0}" fill="#fff" font-weight="bold">${dMin <= 0 ? `${extraM} m longer, but ${-dMin} min quicker, and safe` : `${extraM} m longer, only ${dMin} min slower, and safe`}</text>
    <rect x="${fs * 0.8}" y="${fs * 8.2}" width="${fs * 0.9}" height="${fs * 0.9}" fill="#d7301f"/>
    <text x="${fs * 2}" y="${fs * 9}" fill="#ddd" font-size="${fs * 0.8}">too steep, over ${NOGO}°</text>
    <rect x="${fs * 11}" y="${fs * 8.2}" width="${fs * 0.9}" height="${fs * 0.9}" fill="#fc8d59"/>
    <text x="${fs * 12.2}" y="${fs * 9}" fill="#ddd" font-size="${fs * 0.8}">steep, ${WARN}–${NOGO}°</text>
  </g>
</svg>
`
writeFileSync(outFile, svg)
console.log(`\nPicture written to ${outFile}`)
