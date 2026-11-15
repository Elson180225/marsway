import { makeGrid } from './pathfinding/walkingTime.js'
import { planRoute } from './pathfinding/astar.js'
import { driveMinutes, roverRulesFrom } from './pathfinding/rover.js'

export function validateTerrain({ elevation, slope, roughness }) {
  for (const [name, file] of Object.entries({ elevation, slope, roughness })) {
    if (!file || !Number.isInteger(file.width) || !Number.isInteger(file.height) || file.width < 1 || file.height < 1 || !Number.isFinite(file.cellSize) || file.cellSize <= 0 || !Array.isArray(file.data) || file.data.length !== file.width * file.height || !file.data.every(Number.isFinite)) {
      throw new Error(`Invalid ${name} grid: check dimensions, cellSize and finite data values.`)
    }
    if (file.width !== elevation.width || file.height !== elevation.height || file.cellSize !== elevation.cellSize) throw new Error(`${name} is not aligned with elevation.`)
  }
}

function checkStops(selected, grid) {
  const ids = new Set(['hab', 'home'])
  return selected.map((stop) => {
    if (!stop || typeof stop.id !== 'string' || !stop.id.trim() || ids.has(stop.id) || typeof stop.name !== 'string' || !stop.name.trim() || !Number.isFinite(stop.x) || !Number.isFinite(stop.y) || stop.x < 0 || stop.x >= grid.sizeX || stop.y <= 0 || stop.y > grid.sizeY || stop.type === 'home' || stop.type === 'habitat' || stop.type === 'start') throw new Error('Science stops need unique ids (excluding hab/home), names and in-bounds x/y coordinates. Do not include the habitat.')
    ids.add(stop.id)
    return { ...stop, type: stop.type || 'science_stop', description: stop.description || 'Science details pending.' }
  })
}

function checkLegs(result) {
  for (const leg of result.legs) {
    if (!Number.isFinite(leg.seconds) || leg.seconds <= 0 || leg.path.length < 2) throw new Error('Two consecutive stops occupy the same grid cell. Choose distinct, separated stops.')
  }
}

async function getJson(fetcher, url) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`${url} unavailable (${response.status}).`)
  return response.json()
}

/** Projected metres (easting/northing) to this crop's local x/y, using area.json boundsProjected. */
export function localFromProjected(area, point) {
  const b = area?.boundsProjected
  if (!b || !Number.isFinite(point?.easting) || !Number.isFinite(point?.northing)) throw new Error('Scenario points need easting/northing and area.json needs boundsProjected.')
  return { x: point.easting - b.west, y: point.northing - b.south }
}

export function buildTerrainRoute(template, area, terrain, science = { status: 'pending', stops: [] }) {
  validateTerrain(terrain)
  const grid = makeGrid(terrain)
  // H1 is fixed in projected metres. The 6 km crop changes its local x/y,
  // and its automatically generated candidate list need not contain H1.
  const projected = area?.boundsProjected
  const expected = projected
    ? { x: 8142047.5 - projected.west, y: -286082.5 - projected.south }
    : { x: 447.5, y: 517.5 } // synthetic/legacy fixtures
  const h1 = area?.habitatCandidates?.find((item) => Math.abs(item?.x - expected.x) < 1e-6 && Math.abs(item?.y - expected.y) < 1e-6) ?? (projected ? expected : null)
  if (!h1 || !Number.isFinite(h1.x) || !Number.isFinite(h1.y) || h1.x < 0 || h1.x >= grid.sizeX || h1.y <= 0 || h1.y > grid.sizeY) throw new Error('Confirmed H1 is outside this terrain crop.')
  if (!template?.mission || template.schema_version !== 1) throw new Error('Mission template is missing or unsupported.')
  const mission = template.mission
  if (!Number.isFinite(Date.parse(mission.start_time)) || !Number.isFinite(mission.max_walk_minutes) || mission.max_walk_minutes <= 0 || !Number.isFinite(mission.reserve_minutes) || mission.reserve_minutes < 0 || mission.reserve_minutes >= mission.max_walk_minutes) throw new Error('Invalid mission start, suit budget or protected reserve.')
  if (!science || !['pending', 'ready'].includes(science.status) || !Array.isArray(science.stops)) throw new Error('science-stops.json needs status pending/ready and a stops array.')
  if (science.status === 'pending' && science.stops.length) throw new Error('Set science stop status to ready to use the supplied stops.')
  if (science.status === 'ready' && !science.stops.length) throw new Error('Ready science stops cannot be empty.')
  const selected = science.status === 'ready' ? science.stops : [
    { id: 'boxwork', name: 'Boxwork centre (test target)', type: 'science_stop', x: grid.sizeX / 2, y: grid.sizeY / 2, description: "Grid-centre demonstration target from Nigel's test. Kelly's science stops are pending." },
  ]
  const stops = checkStops(selected, grid)
  const result = planRoute(grid, [
    { id: 'hab', name: 'Habitat (H1)', type: 'habitat', x: h1.x, y: h1.y, description: 'Confirmed H1 habitat candidate from area.json.' },
    ...stops,
    { id: 'home', name: 'Return to Habitat', type: 'home', x: h1.x, y: h1.y, description: 'Return to H1.' },
  ])
  checkLegs(result)
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
      map: { bounds: [[0, 0], [grid.sizeY, grid.sizeX]], basemap_url: '/terrain/basemap.webp' },
      ...result,
      provenance: { terrain: area.source || 'Elson processed terrain', routing: 'Nigel pathfinding', target_status: science.status, targets: science.status === 'ready' ? 'Kelly science stops' : 'H1 and grid-centre demo target; Kelly stops pending', safety: 'Terrain-based estimates under team suit assumptions. Position, clock and suit budget are a simulation; Mia safe-zone integration is pending.' },
    },
  }
}

export async function loadTerrainRoute(fetcher = fetch) {
  async function json(url) {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`${url} unavailable (${response.status}).`)
    return response.json()
  }
  const [template, area, elevation, slope, roughness, science] = await Promise.all([
    json('/routes/sample-route.json'), json('/terrain/area.json'), json('/terrain/elevation.json'), json('/terrain/slope.json'), json('/terrain/roughness.json'), json('/routes/science-stops.json'),
  ])
  return buildTerrainRoute(template, area, { elevation, slope, roughness }, science)
}

// EVA-08 starts and ends on foot at the parked open rover, G2. The two
// H1/G2 drive legs are labelled assumptions in the Planning schedule.
export function buildGedizRoute(template, area, terrain, science, parking) {
  validateTerrain(terrain)
  const grid = makeGrid(terrain)
  if (area?.sizeMetres !== 6000 || science?.stops?.length !== 4) throw new Error('EVA-08 needs the 6 km terrain and four Gediz stops.')
  const g2 = { id: 'g2', name: 'Rover staging (G2)', type: 'habitat', x: 3192.5, y: 3542.5, description: 'Open-rover staging point. The rover is not storm shelter.' }
  const spot = parking?.evas?.find((item) => item.eva === '08')?.spot
  if (spot?.id !== 'G2' || !Number.isFinite(spot.drive_distance_m)) throw new Error('EVA-08 needs G2 drive distance from rover-parking.json.')
  const drive = Math.round(driveMinutes(spot.drive_distance_m, roverRulesFrom(parking)))
  const result = planRoute(grid, [g2, ...science.stops, { ...g2, id: 'home', name: 'Return to rover (G2)', type: 'home' }])
  const mission = { ...template.mission, id: 'EVA-08', name: 'The Gediz Vallis Walk', data_status: 'TERRAIN_ESTIMATE', latest_turnback_time: null,
    drive_out_minutes: drive, drive_home_minutes: drive, drive_distance_m: spot.drive_distance_m }
  return { grid, route: { ...template, mission, ...result,
    coordinate_system: { ...template.coordinate_system, unit: 'meter', origin_note: area.localCoords, description: '6 km terrain grid; local metres x east, y north. Leaflet [y,x].' },
    map: { bounds: [[0, 0], [grid.sizeY, grid.sizeX]], basemap_url: '/terrain/basemap.webp' },
    provenance: { terrain: area.source, routing: 'Nigel pathfinding from G2', target_status: science.status, targets: science.status === 'ready' ? 'Kelly reviewed Gediz science stops' : 'Gediz stops; science review pending', safety: 'Simulation. Rover is open, not storm shelter. Suited drives use the 8 h budget; 2 h reserve protected.' } } }
}

export async function loadGedizRoute(fetcher = fetch) {
  const json = async (url) => {
    const response = await fetcher(url)
    if (!response.ok) throw new Error(`${url} unavailable (${response.status}).`)
    return response.json()
  }
  const [template, area, elevation, slope, roughness, science, parking] = await Promise.all([
    json('/routes/sample-route.json'), json('/terrain/area.json'), json('/terrain/elevation.json'), json('/terrain/slope.json'), json('/terrain/roughness.json'), json('/routes/gediz-stops.json'), json('/routes/rover-parking.json'),
  ])
  return buildGedizRoute(template, area, { elevation, slope, roughness }, science, parking)
}

// EVA-09 onward: one walking loop per habitat (H1-H4), listed in public/routes/scenarios.json.
// Habitats and stops are stored in projected metres, so they survive a change of map crop.
export function buildScenarioRoute(template, area, terrain, catalog, eva) {
  validateTerrain(terrain)
  const grid = makeGrid(terrain)
  const scenario = catalog?.scenarios?.find((item) => item.eva === eva)
  if (!scenario || !Array.isArray(scenario.stops) || !scenario.stops.length) throw new Error(`EVA-${eva} has no stop list in scenarios.json.`)
  const habitat = catalog.habitats?.[scenario.habitat]
  if (!habitat) throw new Error(`${scenario.id} uses unknown habitat ${scenario.habitat}.`)
  const h = localFromProjected(area, habitat)
  if (h.x < 0 || h.x >= grid.sizeX || h.y <= 0 || h.y > grid.sizeY) throw new Error(`${scenario.habitat} is outside this terrain crop.`)
  if (!template?.mission || template.schema_version !== 1) throw new Error('Mission template is missing or unsupported.')
  const stops = checkStops(scenario.stops.map((stop) => ({ ...stop, ...localFromProjected(area, stop) })), grid)
  const label = scenario.habitat
  const result = planRoute(grid, [
    { id: 'hab', name: `Habitat (${label})`, type: 'habitat', habitat_id: label, x: h.x, y: h.y, description: habitat.note },
    ...stops,
    { id: 'home', name: `Return to Habitat (${label})`, type: 'home', habitat_id: label, x: h.x, y: h.y, description: `Return to ${label}.` },
  ])
  checkLegs(result)
  const mission = { ...template.mission, id: scenario.id, name: scenario.name, home_label: label, latest_turnback_time: null, data_status: 'TERRAIN_ESTIMATE' }
  return { grid, route: { ...template, mission, ...result,
    coordinate_system: { ...template.coordinate_system, unit: 'meter', origin_note: area.localCoords, description: '6 km terrain grid; local metres x east, y north. Leaflet [y,x].' },
    map: { bounds: [[0, 0], [grid.sizeY, grid.sizeX]], basemap_url: '/terrain/basemap.webp' },
    provenance: { terrain: area.source, routing: `Nigel pathfinding from ${label}`, target_status: catalog.status, targets: catalog.science_review?.summary || 'Curiosity waypoints; names, science and photos pending Kelly review', safety: `Simulation. ${label} ${habitat.status === 'confirmed' ? 'is the confirmed habitat' : 'is a candidate habitat site'}; terrain-based estimates under team suit assumptions.` } } }
}

export function loadScenarioCatalog(fetcher = fetch) {
  return getJson(fetcher, '/routes/scenarios.json')
}

export async function loadScenarioRoute(eva, fetcher = fetch) {
  const [template, area, elevation, slope, roughness, catalog] = await Promise.all([
    '/routes/sample-route.json', '/terrain/area.json', '/terrain/elevation.json', '/terrain/slope.json', '/terrain/roughness.json', '/routes/scenarios.json',
  ].map((url) => getJson(fetcher, url)))
  return buildScenarioRoute(template, area, { elevation, slope, roughness }, catalog, eva)
}

/** ?eva=07 (or none) is the Boxwork walk, 08 is Gediz, anything else comes from scenarios.json. */
export function loadRouteForEva(eva, fetcher = fetch) {
  if (!eva || eva === '07') return loadTerrainRoute(fetcher)
  if (eva === '08') return loadGedizRoute(fetcher)
  return loadScenarioRoute(eva, fetcher)
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
