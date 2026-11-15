// Make the home file for every rover parking spot in public/routes/rover-parking.json
// (home = the parked rover). Run from the app folder after Nigel adds or moves a spot:
//
//   node src/safezone/buildRoverHomeFiles.js           build the spots that have no home file yet
//   node src/safezone/buildRoverHomeFiles.js --force   rebuild every spot (after terrain or SUIT changes)
//
// Writes public/safezone/<home_file>.json and .bin (default name home-<spot id>-6km), the same format
// as buildHomeFile.js, so the Planning and Walk screens load them like the habitat files.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { makeGrid, xyToCell, cellToXY } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { encodeHomeFile } from './homeFile.js'
import { EVAS, parkingSpot } from './evaSetup.js'

const pub = new URL('../../public/', import.meta.url)
const load = (path) => JSON.parse(readFileSync(new URL(path, pub), 'utf8'))
const force = process.argv.includes('--force')

const area = load('terrain/area.json')
const parking = load('routes/rover-parking.json')
const grid = makeGrid({ elevation: load('terrain/elevation.json'), slope: load('terrain/slope.json'), roughness: load('terrain/roughness.json') })
const outDir = new URL('safezone/', pub)
mkdirSync(outDir, { recursive: true })

const built = new Set()
for (const eva of EVAS) {
  const spot = parkingSpot(eva, { area, parking })
  if (!spot) { console.log(`EVA-${eva}: no parking spot yet (Nigel)`); continue }
  if (built.has(spot.homeFile)) continue // two EVAs sharing one spot
  if (!force && existsSync(new URL(`${spot.homeFile}.bin`, outDir))) { console.log(`EVA-${eva}: ${spot.homeFile} already built (use --force to rebuild)`); continue }
  const cell = xyToCell(grid, spot.x, spot.y)
  if (cell < 0) throw new Error(`EVA-${eva} parking ${spot.id} is outside the map.`)
  if (grid.blocked[cell]) throw new Error(`EVA-${eva} parking ${spot.id} is on no-go ground. Pick a flat spot.`)
  const centre = cellToXY(grid, cell)
  const home = { id: spot.id, col: cell % grid.width, row: Math.floor(cell / grid.width), x: centre.x, y: centre.y }
  const arrows = homeArrows(grid, cell)
  const { meta, bytes } = encodeHomeFile(grid, arrows, home)
  meta.description = `Pre-calculated time and route back to the parked rover (${spot.id}) for every cell. See app/src/safezone/homeFile.js.`
  meta.bin = `${spot.homeFile}.bin`
  writeFileSync(new URL(`${spot.homeFile}.json`, outDir), JSON.stringify(meta, null, 2) + '\n')
  writeFileSync(new URL(`${spot.homeFile}.bin`, outDir), bytes)
  built.add(spot.homeFile)
  console.log(`EVA-${eva}: wrote public/safezone/${spot.homeFile}.json and .bin (home = rover at ${spot.id}, x ${home.x}, y ${home.y})`)
}
