/**
 * MarsWay safe zone (Pathfinder 2).
 *
 * "Where can the crew still go and get home before the suit reserve runs low?"
 *
 * From where the crew is standing now, a square is SAFE if
 *     walk there  +  time at the stop  +  walk home   <=   suit time left before the reserve
 * where "walk there" is timeFromMap(here) and "walk home" is timeHomeMap(habitat).
 * Both use Nigel's stepSeconds(), so the zone agrees with the route planner.
 *
 * Squares that only work by using up the reserve are RESERVE (amber): reachable, but
 * the crew would come home on their emergency time. Everything else is OUT.
 *
 * All numbers in SAFE_ZONE are our own estimates (README "Assumptions"), not NASA figures.
 * They are the same as mission.max_walk_minutes (480) and mission.reserve_minutes (120) in the
 * shared route file. They live here, not in Nigel's SUIT, because SUIT only holds walking numbers
 * and we don't edit his file.
 */
import { timeHomeMap, timeFromMap } from './timeHome.js'

export const SAFE_ZONE = {
  suitHours: 8, // total suit time
  reserveHours: 2, // never plan to use this; it's for emergencies
}

export const ZONE = { OUT: 0, RESERVE: 1, SAFE: 2 }

/**
 * Work out the safe zone.
 *
 *   grid        from makeGrid()
 *   habitatCell the habitat (where "home" is)
 *   options
 *     here            cell the crew is at now (default: the habitat, i.e. before leaving)
 *     elapsedSeconds  suit time already used (default 0)
 *     stopSeconds     time to spend at the new spot, e.g. sampling at a bonus stop (default 0)
 *     timeHome        pass timeHomeMap(grid, habitatCell) if you already have it (it never changes
 *                     for one habitat, so work it out once and reuse it)
 *     settings        override SAFE_ZONE
 *
 * Returns
 *   spareMinutes    Float32Array, one number per cell, for Aaron's map: minutes of suit time left
 *                   over (before the reserve) if the crew goes there, stops, and walks home.
 *                   Big = plenty (green), near 0 = cutting it close (red), below 0 = not safe,
 *                   -Infinity = can't get there or can't get home from there.
 *   zone            Uint8Array, one ZONE value per cell (SAFE: spare >= 0, RESERVE: only by using
 *                   the reserve, OUT: otherwise)
 *   timeHome        seconds home from each cell (reuse it next time)
 *   timeFrom        seconds from `here` to each cell
 *   secondsLeft     suit time left before the reserve
 *   spareSeconds    how long the crew could wait at `here` and still get home on time.
 *                   Negative = they are already late: turn back now. (The turn-back timer.)
 *   safeCells, reserveCells   how many cells are in each band
 */
export function safeZone(grid, habitatCell, options = {}) {
  const {
    here = habitatCell,
    elapsedSeconds = 0,
    stopSeconds = 0,
    settings = SAFE_ZONE,
  } = options
  const timeHome = options.timeHome ?? timeHomeMap(grid, habitatCell)
  const timeFrom = timeFromMap(grid, here)

  const reserve = settings.reserveHours * 3600
  const secondsLeft = (settings.suitHours - settings.reserveHours) * 3600 - elapsedSeconds

  const n = grid.width * grid.height
  const spareMinutes = new Float32Array(n)
  const zone = new Uint8Array(n)
  let safeCells = 0
  let reserveCells = 0
  for (let i = 0; i < n; i++) {
    const total = timeFrom[i] + stopSeconds + timeHome[i] // Infinity if either half is impossible
    spareMinutes[i] = (secondsLeft - total) / 60
    if (total <= secondsLeft) {
      zone[i] = ZONE.SAFE
      safeCells++
    } else if (total <= secondsLeft + reserve) {
      zone[i] = ZONE.RESERVE
      reserveCells++
    }
  }

  return {
    spareMinutes,
    zone,
    timeHome,
    timeFrom,
    secondsLeft,
    spareSeconds: secondsLeft - timeHome[here],
    safeCells,
    reserveCells,
  }
}

// ---------------------------------------------------------------------------
// Drawing (for Aaron and Russell)
//
// The zone is one pixel per cell, row 0 = north, exactly like Elson's slope.png, so it lines up
// with the basemap using the same Leaflet bounds:
//
//   import { safeZone, zoneToDataURL } from './safezone/safeZone.js'
//   const sz = safeZone(grid, habitatCell, { here, elapsedSeconds })
//   L.imageOverlay(zoneToDataURL(sz.zone, grid), [[0, 0], [3000, 3000]], { opacity: 0.9 }).addTo(map)
// ---------------------------------------------------------------------------

export const ZONE_COLOURS = {
  [ZONE.SAFE]: [70, 200, 120], // green
  [ZONE.RESERVE]: [240, 175, 60], // amber
}

/**
 * RGBA pixels for the zone: green / amber, see-through elsewhere.
 * The edge of each band is drawn stronger so the boundary is easy to see.
 * Returns { width, height, data } (data is a Uint8ClampedArray, same layout as canvas ImageData).
 */
export function zoneToPixels(zone, grid, { fillAlpha = 90, edgeAlpha = 230 } = {}) {
  const { width, height } = grid
  const data = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const z = zone[i]
      if (z === ZONE.OUT) continue
      const edge =
        (col > 0 && zone[i - 1] !== z) ||
        (col < width - 1 && zone[i + 1] !== z) ||
        (row > 0 && zone[i - width] !== z) ||
        (row < height - 1 && zone[i + width] !== z)
      const [r, g, b] = ZONE_COLOURS[z]
      data.set([r, g, b, edge ? edgeAlpha : fillAlpha], i * 4)
    }
  }
  return { width, height, data }
}

/** Browser only: the zone as a PNG data URL, ready for L.imageOverlay(). */
export function zoneToDataURL(zone, grid, style) {
  const { width, height, data } = zoneToPixels(zone, grid, style)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}
