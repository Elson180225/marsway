/**
 * MarsWay pre-calculated "time to home" file (Pathfinder 2).
 *
 * H1 never moves, so the time-home map, the next-step-home arrows and the distance home are the
 * same every time. We work them out once on a laptop (buildHomeFile.js) and save them in
 * app/public/safezone/. The phone then downloads one small file instead of 6 MB of terrain, and
 * does no searching at all.
 *
 * Two files:
 *   home-h1.json  what the data is (grid size, habitat, suit numbers it was made with)
 *   home-h1.bin   the numbers, one block after another, little-endian:
 *                   timeHome  Uint16 x cells  seconds to walk home   (65535 = no way home)
 *                   distHome  Uint16 x cells  metres to walk home    (65535 = no way home)
 *                   nextHome  Uint8  x cells  direction of the next step home (see DIRS below,
 *                                             255 = none: the habitat itself, or no way home)
 *   Cells are in Elson's order: index = row * width + col, row 0 = north edge.
 *
 * Times are rounded to the nearest second and distances to the nearest metre.
 */
import { SUIT } from '../pathfinding/walkingTime.js'

export const NONE16 = 65535
export const NONE8 = 255

// Direction code -> [dCol, dRow]. Code = (dRow + 1) * 3 + (dCol + 1); 4 would be "stay put".
const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/**
 * Pack homeArrows() into the two files.
 * habitat: { id, col, row, x, y } from area.json.
 * Returns { meta, bytes } (bytes is a Uint8Array to write as the .bin file).
 */
export function encodeHomeFile(grid, { timeHome, nextHome, distHome }, habitat) {
  const { width, height } = grid
  const n = width * height
  const bytes = new Uint8Array(n * 5)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < n; i++) {
    const ok = timeHome[i] < Infinity
    const t = ok ? Math.round(timeHome[i]) : NONE16
    const d = ok ? Math.round(distHome[i]) : NONE16
    if (ok && (t >= NONE16 || d >= NONE16)) throw new Error(`cell ${i} is too far from home to fit in the file`)
    view.setUint16(i * 2, t, true)
    view.setUint16(n * 2 + i * 2, d, true)

    let code = NONE8
    if (nextHome[i] !== -1) {
      const dc = (nextHome[i] % width) - (i % width)
      const dr = ((nextHome[i] / width) | 0) - ((i / width) | 0)
      code = (dr + 1) * 3 + (dc + 1)
    }
    bytes[n * 4 + i] = code
  }
  const meta = {
    format: 'marsway-home-v1',
    description: 'Pre-calculated time and route home to the habitat for every cell. See app/src/safezone/homeFile.js.',
    habitat: { id: habitat.id ?? 'H1', col: habitat.col, row: habitat.row, x: habitat.x, y: habitat.y },
    width,
    height,
    cellSize: grid.cellSize,
    suit: { ...grid.suit }, // the walking numbers it was made with: if SUIT changes, rebuild the file
    bin: 'home-h1.bin',
  }
  return { meta, bytes }
}

/**
 * Unpack the two files. Returns
 *   grid      a small grid object (no heights) that turnBackTimer() and stormRoute() accept
 *   arrows    { timeHome, nextHome, distHome } in the same form homeArrows() returns
 *   habitatCell
 *   stale     true if the file was made with different SUIT numbers than Nigel's current ones
 */
export function decodeHomeFile(meta, buffer) {
  if (meta.format !== 'marsway-home-v1') throw new Error(`Unknown home file format: ${meta.format}`)
  const { width, height, cellSize } = meta
  const n = width * height
  const bytes = new Uint8Array(buffer)
  if (bytes.length !== n * 5) throw new Error(`Home file is ${bytes.length} bytes, expected ${n * 5}.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const timeHome = new Float32Array(n)
  const distHome = new Float32Array(n)
  const nextHome = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const t = view.getUint16(i * 2, true)
    const d = view.getUint16(n * 2 + i * 2, true)
    timeHome[i] = t === NONE16 ? Infinity : t
    distHome[i] = d === NONE16 ? Infinity : d
    const code = bytes[n * 4 + i]
    if (code === NONE8) nextHome[i] = -1
    else {
      const [dc, dr] = DIRS[code]
      nextHome[i] = i + dr * width + dc
    }
  }

  const grid = { width, height, cellSize, sizeX: width * cellSize, sizeY: height * cellSize }
  const stale = Object.keys(SUIT).some((k) => meta.suit?.[k] !== SUIT[k])
  return {
    grid,
    arrows: { timeHome, nextHome, distHome },
    habitatCell: meta.habitat.row * width + meta.habitat.col,
    habitat: meta.habitat,
    stale,
  }
}

/** Browser / phone: download and unpack the home file. */
export async function loadHomeFile(base = '/safezone/home-h1', fetcher = fetch) {
  const metaResponse = await fetcher(`${base}.json`)
  if (!metaResponse.ok) throw new Error(`${base}.json unavailable (${metaResponse.status}).`)
  const meta = await metaResponse.json()
  const binResponse = await fetcher(`${base}.bin`)
  if (!binResponse.ok) throw new Error(`${base}.bin unavailable (${binResponse.status}).`)
  const home = decodeHomeFile(meta, await binResponse.arrayBuffer())
  if (home.stale) console.warn('home-h1 was made with different SUIT numbers: run node src/safezone/buildHomeFile.js')
  return home
}
