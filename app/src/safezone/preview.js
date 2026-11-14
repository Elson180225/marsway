// Draw the safe zone over a shaded terrain picture so you can check it without the website.
// Run from the app folder:  node src/safezone/preview.js out.png [hoursUsed] [bonusStopMinutes]
//   default: crew at the boxwork after 4.5 h, 20 min bonus stop
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { makeGrid } from '../pathfinding/walkingTime.js'
import { reachableFrom, snapToReachable } from '../pathfinding/astar.js'
import { safeZone, zoneToPixels } from './safeZone.js'

const [out, hours = '4.5', stopMin = '20'] = process.argv.slice(2)
if (!out) throw new Error('usage: node src/safezone/preview.js out.png [hoursUsed] [bonusStopMinutes]')

const dataDir = new URL('../../../data/processed/', import.meta.url)
const load = (f) => JSON.parse(readFileSync(new URL(f, dataDir), 'utf8'))
const area = load('area.json')
const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })
const h1 = area.habitatCandidates[0]
const hab = h1.row * grid.width + h1.col
const box = snapToReachable(grid, reachableFrom(grid, hab), 1500, 1500)

const s = safeZone(grid, hab, { here: box, elapsedSeconds: Number(hours) * 3600, stopSeconds: Number(stopMin) * 60 })
const zone = zoneToPixels(s.zone, grid)

// Grey hillshade from elevation, no-go ground tinted red, then the zone on top.
const { width: W, height: H, elevation: e, cellSize, blocked } = grid
const rgb = Buffer.alloc(W * H * 3)
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r * W + c
    const dx = (e[r * W + Math.min(c + 1, W - 1)] - e[r * W + Math.max(c - 1, 0)]) / (2 * cellSize)
    const dy = (e[Math.min(r + 1, H - 1) * W + c] - e[Math.max(r - 1, 0) * W + c]) / (2 * cellSize)
    let v = Math.max(0, Math.min(255, 150 - 220 * (dx - dy)))
    let px = blocked[i] ? [v * 0.6 + 90, v * 0.4, v * 0.4] : [v, v * 0.92, v * 0.85]
    const a = zone.data[i * 4 + 3] / 255
    for (let k = 0; k < 3; k++) px[k] = px[k] * (1 - a) + zone.data[i * 4 + k] * a
    rgb.set(px.map(Math.round), i * 3)
  }
}
const dot = (cell, colour) => {
  const r0 = (cell / W) | 0, c0 = cell % W
  for (let r = r0 - 4; r <= r0 + 4; r++) for (let c = c0 - 4; c <= c0 + 4; c++)
    if (r >= 0 && c >= 0 && r < H && c < W && (r - r0) ** 2 + (c - c0) ** 2 <= 16) rgb.set(colour, (r * W + c) * 3)
}
dot(hab, [255, 255, 255]) // habitat: white
dot(box, [60, 170, 255]) // crew: blue

writeFileSync(out, png(W, H, rgb))
console.log(`wrote ${out}: ${(s.secondsLeft / 60).toFixed(0)} min left, ${(s.spareSeconds / 60).toFixed(0)} min spare, ` +
  `${s.safeCells} safe / ${s.reserveCells} reserve squares`)

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
    return n >>> 0
  })
  const crc = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0 }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type), body])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(tb))
    return Buffer.concat([len, tb, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
