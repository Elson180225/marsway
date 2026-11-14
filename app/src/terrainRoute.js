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

export function buildTerrainRoute(template, area, terrain, science = { status: 'pending', stops: [] }) {
  validateTerrain(terrain)
  const grid = makeGrid(terrain)
  if (!template?.mission || template.schema_version !== 1) throw new Error('Mission template is missing or unsupported.')
  const mission = template.mission
  // EVA-07 (no mission.home): confirmed team decision, H1 is (447.5, 517.5), rounded to (448, 518) in chat.
  // Candidate order and optional names must never select a different habitat.
  // EVA-08 and later: the mission template names its own home, e.g. the rover at G2.
  let home
  if (mission.home) {
    const h = mission.home
    if (typeof h.name !== 'string' || !Number.isFinite(h.x) || !Number.isFinite(h.y) || h.x < 0 || h.x >= grid.sizeX || h.y <= 0 || h.y > grid.sizeY) throw new Error('Mission home needs a name and in-bounds x/y coordinates.')
    home = { name: h.name, x: h.x, y: h.y, description: h.description || `${h.name}: start and end of this EVA.` }
  } else {
    const h1 = area?.habitatCandidates?.find((item) => Number.isFinite(item?.x) && Number.isFinite(item?.y) && Math.abs(item.x - 447.5) < 1e-6 && Math.abs(item.y - 517.5) < 1e-6)
    if (!h1) throw new Error('Confirmed H1 (447.5, 517.5) is missing from area.json. Review the habitat decision; no alternative was selected.')
    home = { name: 'Habitat (H1)', x: h1.x, y: h1.y, description: 'Confirmed H1 habitat candidate from area.json.' }
  }
  if (!Number.isFinite(Date.parse(mission.start_time)) || !Number.isFinite(mission.max_walk_minutes) || mission.max_walk_minutes <= 0 || !Number.isFinite(mission.reserve_minutes) || mission.reserve_minutes < 0 || mission.reserve_minutes >= mission.max_walk_minutes) throw new Error('Invalid mission start, suit budget or protected reserve.')
  if (!science || !['pending', 'ready'].includes(science.status) || !Array.isArray(science.stops)) throw new Error('science-stops.json needs status pending/ready and a stops array.')
  if (science.status === 'pending' && science.stops.length) throw new Error('Set science stop status to ready to use the supplied stops.')
  if (science.status === 'ready' && !science.stops.length) throw new Error('Ready science stops cannot be empty.')
  const selected = science.status === 'ready' ? science.stops : [
    { id: 'boxwork', name: 'Boxwork centre (test target)', type: 'science_stop', x: grid.sizeX / 2, y: grid.sizeY / 2, description: "Grid-centre demonstration target from Nigel's test. Kelly's science stops are pending." },
  ]
  const ids = new Set(['hab', 'home'])
  const stops = selected.map((stop) => {
    if (!stop || typeof stop.id !== 'string' || !stop.id.trim() || ids.has(stop.id) || typeof stop.name !== 'string' || !stop.name.trim() || !Number.isFinite(stop.x) || !Number.isFinite(stop.y) || stop.x < 0 || stop.x >= grid.sizeX || stop.y <= 0 || stop.y > grid.sizeY || stop.type === 'home' || stop.type === 'habitat' || stop.type === 'start') throw new Error('Science stops need unique ids (excluding hab/home), names and in-bounds x/y coordinates. Do not include the habitat.')
    ids.add(stop.id)
    return { ...stop, type: stop.type || 'science_stop', description: stop.description || 'Science details pending.' }
  })
  const result = planRoute(grid, [
    { id: 'hab', name: home.name, type: 'habitat', x: home.x, y: home.y, description: home.description },
    ...stops,
    { id: 'home', name: mission.home ? `Return to ${home.name}` : 'Return to Habitat', type: 'home', x: home.x, y: home.y, description: mission.home ? `Return to ${home.name}.` : 'Return to H1.' },
  ])
  for (const leg of result.legs) {
    if (!Number.isFinite(leg.seconds) || leg.seconds <= 0 || leg.path.length < 2) throw new Error('Two consecutive stops occupy the same grid cell. Choose distinct, separated stops.')
  }
  if (template.alerts !== undefined) {
    if (!Array.isArray(template.alerts)) throw new Error('Mission alerts must be a list.')
    for (const alert of template.alerts) {
      if (!['info', 'caution', 'danger'].includes(alert.level) || (alert.shelter_stop_id != null && !result.stops.some((s) => s.id === alert.shelter_stop_id))) throw new Error('Mission alert has an invalid level or unknown shelter stop id.')
    }
  }
  return {
    grid,
    route: {
      ...template,
      coordinate_system: { ...template.coordinate_system, unit: 'meter', origin_note: area.localCoords || 'Local terrain grid; origin at southwest edge.', description: 'Local metres: x east from west edge, y north from south edge. Leaflet [y,x].' },
      mission: { ...template.mission, latest_turnback_time: null, data_status: 'TERRAIN_ESTIMATE' },
      map: { bounds: [[0, 0], [grid.sizeY, grid.sizeX]], basemap_url: `${template.terrain_dir || '/terrain/'}basemap.png` },
      ...result,
      provenance: { terrain: area.source || 'Elson processed terrain', routing: 'Nigel pathfinding', target_status: science.status, targets: science.status === 'ready' ? 'Kelly science stops' : 'H1 and grid-centre demo target; Kelly stops pending', safety: 'Terrain-based estimates under team suit assumptions. Position, clock and suit budget are a simulation; Mia safe-zone integration is pending.' },
    },
  }
}

// The EVAs the Planning screen can show. EVA-07 is the original 3 km boxwork walk (unchanged);
// EVA-08 is the rover-assisted Gediz Vallis walk on the 6 km map, with home = the rover at G2.
export const MISSIONS = {
  'EVA-07': { label: 'EVA-07 · Boxwork', template: '/routes/sample-route.json', terrain: '/terrain/', stops: '/routes/science-stops.json', scienceLayers: true },
  'EVA-08': { label: 'EVA-08 · Gediz Vallis', template: '/routes/eva-08.json', terrain: '/terrain-6km/', stops: '/routes/gediz-stops.json', scienceLayers: false },
}
export const DEFAULT_MISSION = 'EVA-07'

export async function loadTerrainRoute(fetcher = fetch, missionId = DEFAULT_MISSION) {
  const files = MISSIONS[missionId]
  if (!files) throw new Error(`Unknown mission ${missionId}.`)
  async function json(url) {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`${url} unavailable (${response.status}).`)
    return response.json()
  }
  const [template, area, elevation, slope, roughness, science] = await Promise.all([
    json(files.template), json(`${files.terrain}area.json`), json(`${files.terrain}elevation.json`), json(`${files.terrain}slope.json`), json(`${files.terrain}roughness.json`), json(files.stops),
  ])
  return buildTerrainRoute({ ...template, terrain_dir: files.terrain }, area, { elevation, slope, roughness }, science)
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
