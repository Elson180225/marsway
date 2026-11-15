/**
 * MarsWay walking-time maths (Pathfinder 1, shared with Pathfinder 2).
 *
 * Everything about how fast a suited astronaut can walk lives in THIS file.
 * Route-finding (A*) and the safe zone (Dijkstra) must both use stepSeconds()
 * from here, so route times and safe-zone times always agree.
 *
 * All numbers in SUIT are our own estimates, not official NASA figures.
 */

export const SUIT = {
  speedFactor: 0.5, // suited walking speed as a fraction of normal hiking speed
  slopeWarnDeg: 15, // steeper than this: warning on the route
  slopeNoGoDeg: 25, // steeper than this: never walk here
  roughnessPerDeg: 0.02, // each degree of roughness (roughness.json) adds 2% walking time
  roughWarnDeg: 8, // roughness above this: "rough ground" warning on the route
}

/** Tobler's hiking function. gradient = rise / run (positive = uphill). Returns km/h. */
export function toblerKmh(gradient) {
  return 6 * Math.exp(-3.5 * Math.abs(gradient + 0.05))
}

/** Suited astronaut walking speed in metres per second. */
export function suitSpeedMps(gradient, suit = SUIT) {
  return (toblerKmh(gradient) * suit.speedFactor) / 3.6
}

/** The fastest a suited astronaut ever walks (gentle 5% downhill). A* uses this. */
export function maxSpeedMps(suit = SUIT) {
  return suitSpeedMps(-0.05, suit)
}

export function slopeDegFromGradient(gradient) {
  return (Math.atan(Math.abs(gradient)) * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// Grids
//
// Grid files use Elson's format (data/processed/README.md):
//   { width, height, cellSize, data: [...] }   row 0 = NORTH edge, row by row, west to east
//   value of cell (col, row) = data[row * width + col]
// A cell is referred to by its index i = row * width + col.
// ---------------------------------------------------------------------------

/** Turn a pretend grid written as rows of numbers into the same format as Elson's files. */
export function gridFileFromRows(rows, cellSize) {
  return { width: rows[0].length, height: rows.length, cellSize, data: rows.flat() }
}

/**
 * Build the grid both pathfinders search.
 *   elevation  (required) heights in metres, e.g. elevation.json
 *   slope      (optional) degrees, e.g. slope.json. Cells steeper than slopeNoGoDeg are blocked.
 *   roughness  (optional) degrees, e.g. roughness.json. Makes rocky ground slower.
 */
export function makeGrid({ elevation, slope = null, roughness = null }, suit = SUIT) {
  const { width, height, cellSize } = elevation
  const n = width * height
  for (const [name, f] of Object.entries({ slope, roughness })) {
    if (f && (f.width !== width || f.height !== height)) throw new Error(`${name} grid size does not match elevation`)
  }
  const blocked = new Uint8Array(n)
  const factor = new Float32Array(n).fill(1)
  for (let i = 0; i < n; i++) {
    if (slope && slope.data[i] > suit.slopeNoGoDeg) blocked[i] = 1
    if (roughness) factor[i] = 1 + suit.roughnessPerDeg * roughness.data[i]
  }
  return {
    width,
    height,
    cellSize,
    sizeX: width * cellSize,
    sizeY: height * cellSize,
    elevation: Float32Array.from(elevation.data),
    slope: slope ? Float32Array.from(slope.data) : null,
    roughness: roughness ? Float32Array.from(roughness.data) : null,
    blocked, // 1 = no-go cell
    factor, // walking-time multiplier per cell (always >= 1)
    suit,
  }
}

// [dCol, dRow, step length in cells]. 8 directions, so routes can go diagonally.
const DIRS = [
  [0, -1, 1], [0, 1, 1], [-1, 0, 1], [1, 0, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
]

/** Calls visit(j, len) for every walkable neighbour j of cell i. len = step length in cells. */
export function forEachNeighbour(grid, i, visit) {
  const { width, height, blocked } = grid
  const row = (i / width) | 0
  const col = i - row * width
  for (const [dc, dr, len] of DIRS) {
    const c = col + dc
    const r = row + dr
    if (c < 0 || r < 0 || c >= width || r >= height) continue
    const j = r * width + c
    if (blocked[j]) continue
    if (dc && dr && (blocked[row * width + c] || blocked[r * width + col])) continue // no cutting corners
    visit(j, len)
  }
}

/**
 * Seconds to walk from cell `from` to its neighbour `to` (len = 1 or √2 cells).
 *
 * No-go rule: if the grid has a slope file, no-go cells come ONLY from it (so routes
 * agree with the red areas on slope.png). Single 5 m steps between cells are often
 * steeper than the smoothed slope, and Tobler already makes those very slow.
 * Without a slope file (pretend grids), a step steeper than the limit is Infinity.
 *
 * NOTE for the safe zone: walking is NOT symmetric (uphill out = downhill back).
 * "Time to get home" from cell j is a Dijkstra from the habitat where moving
 * from cell i to neighbour j costs stepSeconds(grid, j, i, len)  <- reversed order.
 */
export function stepSeconds(grid, from, to, len) {
  const run = len * grid.cellSize
  const gradient = (grid.elevation[to] - grid.elevation[from]) / run
  if (!grid.slope && slopeDegFromGradient(gradient) > grid.suit.slopeNoGoDeg) return Infinity
  const factor = (grid.factor[from] + grid.factor[to]) / 2
  return (run / suitSpeedMps(gradient, grid.suit)) * factor
}

// ---------------------------------------------------------------------------
// Coordinates: local metres, x = east of the west edge, y = north of the south edge
// (same as area.json and the app's Leaflet map, which uses [y, x]).
// ---------------------------------------------------------------------------

export function cellToXY(grid, i) {
  const row = (i / grid.width) | 0
  const col = i - row * grid.width
  return { x: (col + 0.5) * grid.cellSize, y: grid.sizeY - (row + 0.5) * grid.cellSize }
}

/**
 * Height at any point, blended smoothly between the 4 nearest cell centres. Using whole cells
 * instead would turn a slope into 5 m stairs and overstate the climbing.
 */
export function heightAt(grid, x, y) {
  const { cellSize, width, height, elevation } = grid
  const fc = Math.min(Math.max(x / cellSize - 0.5, 0), width - 1.001)
  const fr = Math.min(Math.max((grid.sizeY - y) / cellSize - 0.5, 0), height - 1.001)
  const c = Math.floor(fc)
  const r = Math.floor(fr)
  const u = fc - c
  const v = fr - r
  const e = (cc, rr) => elevation[rr * width + cc]
  return (1 - u) * (1 - v) * e(c, r) + u * (1 - v) * e(c + 1, r) + (1 - u) * v * e(c, r + 1) + u * v * e(c + 1, r + 1)
}

/** Cell index containing point (x, y), or -1 if it is outside the map. */
export function xyToCell(grid, x, y) {
  const col = Math.floor(x / grid.cellSize)
  const row = Math.floor((grid.sizeY - y) / grid.cellSize)
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return -1
  return row * grid.width + col
}
