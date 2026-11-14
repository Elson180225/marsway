// Make the pre-calculated time-home file for H1 (see homeFile.js).
// Run from the app folder:  node src/safezone/buildHomeFile.js
// Re-run it whenever the terrain files or Nigel's SUIT numbers change.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { makeGrid } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { encodeHomeFile } from './homeFile.js'

const terrain = new URL('../../public/terrain/', import.meta.url) // the same files the app loads
const outDir = new URL('../../public/safezone/', import.meta.url)
const load = (f) => JSON.parse(readFileSync(new URL(f, terrain), 'utf8'))

const area = load('area.json')
const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })
const h1 = area.habitatCandidates.find((h) => h.id === 'H1' || h.name === 'H1') ?? area.habitatCandidates[0]
const hab = h1.row * grid.width + h1.col

const { meta, bytes } = encodeHomeFile(grid, homeArrows(grid, hab), { id: 'H1', ...h1 })
mkdirSync(outDir, { recursive: true })
writeFileSync(new URL('home-h1.json', outDir), JSON.stringify(meta, null, 2) + '\n')
writeFileSync(new URL('home-h1.bin', outDir), bytes)
console.log(`wrote public/safezone/home-h1.json and home-h1.bin (${(bytes.length / 1e6).toFixed(1)} MB)`)
