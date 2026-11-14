/**
 * For the pitch: the whole walk on one picture. H1 → Kelly's science stops → home,
 * with arrival times, visit times and the way home if the bonus stop is a NO-GO.
 *
 * Run from the app folder:
 *   node src/pathfinding/pitchLoop.js [out.svg]      (default: whole-walk.svg in the current folder)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { planRoute, routeLeg } from './astar.js'
import { loadTerrain, readAppJson } from './nodeTerrain.js'

const { grid, habitat } = loadTerrain()
const science = readAppJson('public/routes/science-stops.json').stops
const mission = readAppJson('public/routes/sample-route.json').mission
const USABLE = mission.max_walk_minutes - mission.reserve_minutes
const home = { id: 'home', name: 'Home (H1)', x: habitat.x, y: habitat.y }
const plan = planRoute(grid, [habitat, ...science, home])
const stops = plan.stops.slice(1, -1)
const bonus = stops.find((s) => s.is_bonus)

// ---- Timeline ----
const start = new Date(mission.start_time)
const clock = (min) => new Date(start.getTime() + Math.round(min) * 60000).toISOString().slice(11, 16) // nearest minute
let t = 0
const arrive = {}
for (const leg of plan.legs) {
  t += leg.seconds / 60
  arrive[leg.to_stop_id] = t
  t += plan.stops.find((s) => s.id === leg.to_stop_id).stop_minutes || 0
}
const total = t
const walk = plan.legs.reduce((s, l) => s + l.seconds / 60, 0)
const distance = plan.legs.reduce((s, l) => s + l.distance_m, 0)
// If the bonus stop is a NO-GO: go home from the stop before it.
const beforeBonus = bonus ? plan.stops[plan.stops.indexOf(bonus) - 1] : null
const skipHome = beforeBonus ? routeLeg(grid, beforeBonus, home) : null

const r = Math.round
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(r(m % 60)).padStart(2, '0')} min` : `${r(m)} min`)
console.log(`Whole walk: ${(distance / 1000).toFixed(2)} km, walking ${mins(walk)}, total with science ${mins(total)}, back at ${clock(total)} UTC`)
for (const s of stops) console.log(`  ${s.name}: arrive ${clock(arrive[s.id])}, ${s.stop_minutes || 0} min${s.is_bonus ? ' (bonus)' : ''}`)

// ---- Picture ----
const outFile = process.argv[2] ?? 'whole-walk.svg'
const png = (f) => 'data:image/png;base64,' + readFileSync(new URL('../../public/terrain/' + f, import.meta.url)).toString('base64')
const size = grid.sizeX
const Y = (y) => size - y
const allPts = [...plan.legs.flatMap((l) => l.path), ...(skipHome ? skipHome.path : [])]
const pad = 200
const vx = Math.max(0, Math.min(...allPts.map((p) => p.x)) - pad * 3) // room for labels on the left
const vy = Math.max(0, Y(Math.max(...allPts.map((p) => p.y))) - pad * 2.2) // room for the key at the top
const vw = Math.min(size, Math.max(...allPts.map((p) => p.x)) + pad * 3.6) - vx
const vh = Math.min(size, Y(Math.min(...allPts.map((p) => p.y))) + pad) - vy
const fs = r(Math.max(vw, vh) / 48)
const pts = (path) => path.map((p) => `${p.x.toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
const OUT = '#2fd3ff'
const BACK = '#c792ff'
const line = (path, colour, width, extra = '') =>
  `<polyline points="${pts(path)}" stroke="#000" stroke-width="${width + fs * 0.25}" stroke-linejoin="round" fill="none" opacity="0.55" ${extra}/>` +
  `<polyline points="${pts(path)}" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round" fill="none" ${extra}/>`
const text = (x, y, s, { size = fs, anchor = 'start', colour = '#fff', bold = true } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${colour}" stroke="#000" stroke-width="${size / 5}" paint-order="stroke" font-family="Arial, sans-serif"${bold ? ' font-weight="bold"' : ''}>${s}</text>`
const pill = (p, s, dx = 0) => {
  const w = s.length * fs * 0.55 + fs * 0.8
  const x = p.x + dx
  return `<rect x="${x - w / 2}" y="${Y(p.y) - fs * 0.75}" width="${w}" height="${fs * 1.2}" rx="${fs * 0.6}" fill="#000" opacity="0.75"/>` + text(x, Y(p.y) + fs * 0.25, s, { size: fs * 0.8, anchor: 'middle' })
}
const along = (path, fraction) => {
  // point a given fraction of the way along the path, by distance
  let len = 0
  const seg = path.slice(1).map((p, k) => (len += Math.hypot(p.x - path[k].x, p.y - path[k].y)))
  const k = seg.findIndex((d) => d >= len * fraction)
  return path[k + 1]
}

// The way home mostly follows the way out, so it is drawn wider and underneath:
// where they share a corridor you see blue with a purple edge.
let legs = ''
let legLabels = ''
const homeLeg = plan.legs.at(-1)
legs += line(homeLeg.path, BACK, fs * 0.62)
for (const leg of plan.legs.slice(0, -1)) {
  const isBonus = bonus && leg.to_stop_id === bonus.id
  legs += line(leg.path, OUT, fs * 0.28, isBonus ? `stroke-dasharray="${fs * 0.7} ${fs * 0.4}"` : '')
  if (leg.walk_minutes >= 10) legLabels += pill(along(leg.path, 0.5), `${leg.walk_minutes} min`)
}
// Near the stops, where the way home has its own path; nudged right, off the line.
legLabels += pill(along(homeLeg.path, 0.16), `${homeLeg.walk_minutes} min home`, fs * 3.6)
const skipLine = skipHome ? line(skipHome.path, BACK, fs * 0.16, `stroke-dasharray="${fs * 0.5} ${fs * 0.35}"`) : ''

// Stop markers. Neighbouring stops are close together, so labels alternate left and right.
let markers = ''
stops.forEach((s, k) => {
  const left = k % 2 === 0
  const dx = left ? -fs * 1.1 : fs * 1.1
  const anchor = left ? 'end' : 'start'
  markers += `<circle cx="${s.x}" cy="${Y(s.y)}" r="${fs * 0.75}" fill="${s.is_bonus ? '#ffd34d' : '#fff'}" stroke="#000" stroke-width="${fs / 6}"/>`
  markers += text(s.x, Y(s.y) + fs * 0.35, k + 1, { size: fs, anchor: 'middle', colour: '#000' }).replace(/stroke="#000" stroke-width="[^"]*" paint-order="stroke" /, '')
  markers += text(s.x + dx, Y(s.y) - fs * 0.1, `${s.name}${s.is_bonus ? ' ★' : ''}`, { anchor })
  markers += text(s.x + dx, Y(s.y) + fs * 1.0, `arrive ${clock(arrive[s.id])} · ${s.stop_minutes || 0} min science`, { anchor, size: fs * 0.75, bold: false })
  if (s.is_bonus) markers += text(s.x + dx, Y(s.y) + fs * 2.0, 'optional bonus stop', { anchor, size: fs * 0.75, colour: '#ffd34d' })
})
markers += `<circle cx="${habitat.x}" cy="${Y(habitat.y)}" r="${fs * 0.85}" fill="${BACK}" stroke="#000" stroke-width="${fs / 6}"/>`
markers += text(habitat.x + fs * 1.3, Y(habitat.y) - fs * 0.1, 'Habitat H1 (start and home)')
markers += text(habitat.x + fs * 1.3, Y(habitat.y) + fs * 1.0, `leave ${clock(0)} · back ${clock(total)} UTC`, { size: fs * 0.75, bold: false })

const keyW = fs * 24
const key = `<g transform="translate(${vx + fs} ${vy + fs})">
  <rect width="${keyW}" height="${fs * 8.6}" rx="${fs / 2}" fill="#000" opacity="0.75"/>
  ${text(fs * 0.8, fs * 1.6, `The Boxwork Walk: ${(distance / 1000).toFixed(1)} km, ${stops.length} stops`)}
  ${text(fs * 0.8, fs * 2.9, `Walking ${mins(walk)} + science ${mins(total - walk)} = ${mins(total)}`, { size: fs * 0.8, bold: false })}
  ${text(fs * 0.8, fs * 4.1, `${mins(USABLE - total)} spare of ${mins(USABLE)} usable suit time`, { size: fs * 0.8, bold: false, colour: '#8fffa0' })}
  <line x1="${fs * 0.8}" y1="${fs * 5.3}" x2="${fs * 3}" y2="${fs * 5.3}" stroke="${OUT}" stroke-width="${fs * 0.32}"/>
  ${text(fs * 3.5, fs * 5.6, 'Way out between stops', { size: fs * 0.75, bold: false })}
  <line x1="${fs * 13.2}" y1="${fs * 5.3}" x2="${fs * 15.4}" y2="${fs * 5.3}" stroke="${BACK}" stroke-width="${fs * 0.32}"/>
  ${text(fs * 15.9, fs * 5.6, 'Way home', { size: fs * 0.75, bold: false })}
  ${bonus ? `<line x1="${fs * 0.8}" y1="${fs * 6.7}" x2="${fs * 3}" y2="${fs * 6.7}" stroke="${OUT}" stroke-width="${fs * 0.32}" stroke-dasharray="${fs * 0.7} ${fs * 0.4}"/>
  ${text(fs * 3.5, fs * 7.0, 'To the optional bonus stop', { size: fs * 0.75, bold: false })}
  <line x1="${fs * 0.8}" y1="${fs * 7.9}" x2="${fs * 3}" y2="${fs * 7.9}" stroke="${BACK}" stroke-width="${fs * 0.16}" stroke-dasharray="${fs * 0.5} ${fs * 0.35}"/>
  ${text(fs * 3.5, fs * 8.2, `Home if the bonus is NO-GO: ${skipHome.walk_minutes} min from ${beforeBonus.name}`, { size: fs * 0.75, bold: false })}` : ''}
</g>`

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="1600" height="${r((1600 * vh) / vw)}">
  <image href="${png('basemap.png')}" x="0" y="0" width="${size}" height="${size}"/>
  <image href="${png('slope.png')}" x="0" y="0" width="${size}" height="${size}" opacity="0.35" style="image-rendering:pixelated"/>
  ${skipLine}
  ${legs}
  ${legLabels}
  ${markers}
  ${key}
</svg>
`
writeFileSync(outFile, svg)
console.log(`Picture written to ${outFile}`)
