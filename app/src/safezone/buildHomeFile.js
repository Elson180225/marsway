// Make the pre-calculated time-home file (see homeFile.js).
// Run from the app folder. Re-run it whenever the terrain files or Nigel's SUIT numbers change.
//
//   node src/safezone/buildHomeFile.js
//       EVA-07: home = H1 on the 3 km map (public/terrain/) -> public/safezone/home-h1.*
//
//   node src/safezone/buildHomeFile.js --terrain ../data/processed/area-5km/ --home 3192.5,3542.5 --id G2 --out home-g2
//       EVA-08: home = the rover parked at staging point G2 on the 5 km map -> public/safezone/home-g2.*
//
// Options
//   --terrain <folder>  folder with area.json, elevation.json, slope.json, roughness.json
//                       (default public/terrain/, the same files the app loads)
//   --home <x,y>        home position in local metres on that map (default: H1 from area.json)
//   --id <name>         name saved in the file (default H1)
//   --out <name>        output file name in public/safezone/, without extension (default home-<id>)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeGrid, xyToCell, cellToXY } from '../pathfinding/walkingTime.js'
import { homeArrows } from './timeHome.js'
import { encodeHomeFile } from './homeFile.js'

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const terrain = option('terrain')
  ? pathToFileURL(resolve(option('terrain')) + '/')
  : new URL('../../public/terrain/', import.meta.url)
const outDir = new URL('../../public/safezone/', import.meta.url)
const load = (f) => JSON.parse(readFileSync(new URL(f, terrain), 'utf8'))

const area = load('area.json')
const grid = makeGrid({ elevation: load('elevation.json'), slope: load('slope.json'), roughness: load('roughness.json') })

let home
if (option('home')) {
  const [x, y] = option('home').split(',').map(Number)
  const cell = xyToCell(grid, x, y)
  if (cell < 0) throw new Error(`--home ${x},${y} is outside this map (0-${grid.sizeX} by 0-${grid.sizeY} m).`)
  if (grid.blocked[cell]) throw new Error(`--home ${x},${y} is on no-go ground. Pick a flat spot.`)
  const centre = cellToXY(grid, cell)
  home = { id: option('id') ?? 'HOME', col: cell % grid.width, row: Math.floor(cell / grid.width), x: centre.x, y: centre.y }
} else {
  const h1 = area.habitatCandidates.find((h) => h.id === 'H1' || h.name === 'H1') ?? area.habitatCandidates[0]
  home = { id: option('id') ?? 'H1', ...h1 }
}
const homeCell = home.row * grid.width + home.col
const name = option('out') ?? `home-${String(home.id).toLowerCase()}`

const arrows = homeArrows(grid, homeCell)
const { meta, bytes } = encodeHomeFile(grid, arrows, home)
meta.bin = `${name}.bin`
mkdirSync(outDir, { recursive: true })
writeFileSync(new URL(`${name}.json`, outDir), JSON.stringify(meta, null, 2) + '\n')
writeFileSync(new URL(`${name}.bin`, outDir), bytes)
const reachable = arrows.timeHome.reduce((n, t) => n + (t < Infinity), 0)
console.log(`wrote public/safezone/${name}.json and ${name}.bin (${(bytes.length / 1e6).toFixed(1)} MB): home ${home.id} at x ${home.x}, y ${home.y}; ` +
  `${(100 * reachable / arrows.timeHome.length).toFixed(0)}% of the map has a walkable way home`)
