import { makeGrid } from './pathfinding/walkingTime.js'
import { planRoute } from './pathfinding/astar.js'

export function validateTerrain({ elevation, slope, roughness }) {
  for (const [name, file] of Object.entries({ elevation, slope, roughness })) {
    if (!file || !Number.isInteger(file.width) || !Number.isInteger(file.height) || file.width < 1 || file.height < 1 || !Number.isFinite(file.cellSize) || file.cellSize <= 0 || !Array.isArray(file.data) || file.data.length !== file.width * file.height || !file.data.every(Number.isFinite)) {
      throw new Error(`Invalid ${name} grid: check dimensions, cellSize and finite data values.`)
    }
    if (file.width !== elevation.width || file.height !== elevation.height || file.cellSize !== elevation.cellSize) throw new Error(`${name} is not aligned with elevation.`)
  }
}

export function buildTerrainRoute(template, area, terrain) {
  validateTerrain(terrain)
  const grid = makeGrid(terrain)
  const h1 = area?.habitatCandidates?.find((item) => item.id === 'H1' || item.name === 'H1') ?? area?.habitatCandidates?.[0]
  if (!Number.isFinite(h1?.x) || !Number.isFinite(h1?.y)) throw new Error('H1 coordinates are missing from area.json.')
  if (!template?.mission || template.schema_version !== 1) throw new Error('Mission template is missing or unsupported.')
  // This repeats Nigel's terrain test. It is a demo target, pending Kelly's science stops.
  const result = planRoute(grid, [
    { id: 'hab', name: 'Habitat (H1)', type: 'habitat', x: h1.x, y: h1.y, description: 'H1 habitat candidate from area.json.' },
    { id: 'boxwork', name: 'Boxwork centre (test target)', type: 'science_stop', x: grid.sizeX / 2, y: grid.sizeY / 2, description: 'Grid-centre demonstration target from Nigel\'s test. Science location and photos await Kelly.' },
    { id: 'home', name: 'Return to Habitat', type: 'home', x: h1.x, y: h1.y, description: 'Return to H1.' },
  ])
  return {
    grid,
    route: {
      ...template,
      coordinate_system: { ...template.coordinate_system, unit: 'meter', description: 'Local metres: x east from west edge, y north from south edge. Leaflet [y,x].' },
      mission: { ...template.mission, latest_turnback_time: null },
      ...result,
      provenance: { terrain: 'Elson data/processed; verify README dataset attribution', routing: 'Nigel feat/pathfinding', targets: 'H1 and grid-centre demo target', safety: 'Estimated walking times under team suit assumptions. Return deadline not calculated.' },
    },
  }
}

export async function loadTerrainRoute(fetcher = fetch) {
  async function json(url) {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`${url} unavailable (${response.status}).`)
    return response.json()
  }
  const [template, area, elevation, slope, roughness] = await Promise.all([
    json('/routes/sample-route.json'), json('/terrain/area.json'), json('/terrain/elevation.json'), json('/terrain/slope.json'), json('/terrain/roughness.json'),
  ])
  return buildTerrainRoute(template, area, { elevation, slope, roughness })
}

export function roughnessImage(grid) {
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const context = canvas.getContext('2d')
  const pixels = context.createImageData(grid.width, grid.height)
  for (let i = 0; i < grid.roughness.length; i++) {
    const offset = i * 4
    pixels.data[offset] = 242
    pixels.data[offset + 1] = 172
    pixels.data[offset + 2] = 80
    pixels.data[offset + 3] = Math.round(Math.min(1, Math.max(0, grid.roughness[i] / 20)) * 190)
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL()
}
