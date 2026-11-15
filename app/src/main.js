import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './style.css'
import './scienceLayers.css'
import './planningCompact.css'
import './missionSchedule.css'
import { mountPlanningScenario } from './planningScenario.js'
import { showScienceLayerInfo } from './scienceLayerInfo.js'
import { mountPlanningSafety } from './safezone/planningPanel.js'
import './stopDetails.css'
import { renderStopDetails } from './stopDetails.js'
import { loadRouteForEva, loadScenarioCatalog, roughnessImage } from './terrainRoute.js'

const root = document.querySelector('#app')

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character])
}

function duration(minutes) {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}h ${rest ? `${rest}m` : ''}`.trim() : `${rest}m`
}

function distance(metres) {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${metres} m`
}

function localTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' })
}

function mapPoint(point) {
  return [point.y, point.x] // Leaflet CRS.Simple uses [northing, easting].
}

function prominentWarnings(warnings) {
  return warnings.filter((warning) => {
    if (warning.type !== 'rough_ground') return true
    const metres = Number.isFinite(warning.distance_m)
      ? warning.distance_m
      : Number(/^About (\d+) m of rocky or uneven ground/.exec(warning.message)?.[1])
    return !Number.isFinite(metres) || metres > 15
  })
}

function assertRoute(route) {
  if (route.schema_version !== 1 || route.coordinate_system?.unit !== 'meter') throw new Error('Unsupported route data format.')
  if (!Array.isArray(route.stops) || !Array.isArray(route.legs) || !Array.isArray(route.returns)) throw new Error('Route data is incomplete.')
  const stops = new Map(route.stops.map((stop) => [stop.id, stop]))
  if (stops.size !== route.stops.length || route.stops.length < 2) throw new Error('Route stops are missing or repeated.')
  for (const [index, leg] of route.legs.entries()) {
    if (leg.from_stop_id !== route.stops[index]?.id || leg.to_stop_id !== route.stops[index + 1]?.id) throw new Error('Route legs are out of order.')
    if (!Array.isArray(leg.path) || leg.path.length < 2 || !Number.isFinite(leg.distance_m) || !Number.isFinite(leg.walk_minutes)) throw new Error('A route leg is incomplete.')
  }
  if (route.legs.length !== route.stops.length - 1) throw new Error('A route leg is missing.')
  for (const stop of route.stops) {
    const home = route.returns.find((item) => item.from_stop_id === stop.id)
    if (!home || !Array.isArray(home.path) || !home.path.length) throw new Error(`No return route for ${stop.id}.`)
  }
}

// Used if public/routes/scenarios.json cannot be loaded.
const BUILTIN_SCENARIOS = [
  { eva: '07', id: 'EVA-07', label: 'EVA-07 · Boxwork' },
  { eva: '08', id: 'EVA-08', label: 'EVA-08 · Gediz' },
]

function render(route, grid, scenarios = BUILTIN_SCENARIOS) {
  const { mission, stops, legs } = route
  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance_m, 0)
  const totalMinutes = Math.round(legs.reduce((sum, leg) => sum + (leg.seconds ?? leg.walk_minutes * 60), 0) / 60)
  const warnings = prominentWarnings(legs.flatMap((leg) => leg.warnings || []))
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-symbol"><img src="/marsway-mark.svg" alt="" width="36" height="36"></span><span>MARS<span class="brand-accent">WAY</span><small>EXPEDITION CONTROL</small></span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-label">MISSION CONTROL</div>
        <nav aria-label="Application"><a class="nav-item active" href="#planning"><span>▦</span> EVA Planning</a><a class="nav-item" href="/walk.html${mission.drive_out_minutes ? '' : `?eva=${encodeURIComponent(mission.id.replace('EVA-', ''))}`}"><span>⌖</span> Walk screen <small>Russell's view</small></a><a class="nav-item" href="/terrain-lab.html"><span>◇</span> Terrain in 3D <small>5 km view</small></a></nav>
        <div class="sidebar-bottom"><div class="sample-pulse"></div><div><strong>Prototype mode</strong><span>Terrain route estimates</span></div></div>
      </aside>
      <main id="planning" class="main">
        <header class="topbar"><div><span class="eyebrow">MISSION / ${safe(mission.id)}</span></div><div class="top-badge"><span class="sample-pulse"></span> TERRAIN ROUTING DEMO</div></header>
        <div class="notice" role="note"><span>Demo mission · ${route.provenance.target_status === 'draft' ? 'proposed Gediz stops' : route.provenance.target_status === 'ready' ? 'terrain estimates' : 'test target'} · no live telemetry</span></div>
        <nav class="eva-picker" aria-label="Select EVA">${scenarios.map((item) => `<a href="/?eva=${encodeURIComponent(item.eva)}" aria-current="${mission.id === item.id ? 'page' : 'false'}">${safe(item.label)}</a>`).join('')}</nav>
        <section class="metrics" aria-label="Mission summary">
          <div class="metric"><span>${mission.drive_out_minutes ? 'WALK DISTANCE' : 'DISTANCE'}</span><strong>${distance(totalDistance)}</strong><small>${mission.drive_out_minutes ? 'G2 loop; suited drive below' : 'Round trip'}</small></div>
          <div class="metric"><span>WALKING</span><strong id="planning-walking">${duration(totalMinutes)}</strong><small>Science time below</small></div>
          <div class="metric"><span>TURN BACK IN</span><strong id="planning-turnback">Calculating</strong><small id="planning-turnback-note">From selected reference</small></div>
          <div class="metric"><span>TERRAIN NOTES</span><strong>${warnings.length}</strong><small>Across the route</small></div>
        </section>

        <section class="workspace" aria-label="Route planner">
          <div class="map-panel">
            <div class="panel-header"><div><span class="eyebrow">GALE CRATER / LOCAL GRID</span><h2>Route overview</h2></div><span class="map-scale">LOCAL METRES · TERRAIN GRID</span></div>
            <div class="layer-toolbar" role="group" aria-label="Terrain map layers"><span>LAYERS</span><button type="button" data-layer="terrain" aria-pressed="true">◈ Basemap</button><button type="button" data-layer="slope" aria-pressed="false">▥ Slope</button><button type="button" data-layer="roughness" aria-pressed="false">⁙ Roughness</button><button type="button" data-layer="safety" aria-pressed="true">Safe zone</button><button type="button" data-layer="ctx" aria-pressed="false">CTX photo</button><button type="button" data-layer="crismHyd" aria-pressed="false">CRISM hydrated</button><button type="button" data-layer="crismAlt" aria-pressed="false">CRISM alteration</button><button type="button" data-layer="themis" aria-pressed="false">THEMIS night</button><button type="button" id="toggle3d" aria-pressed="false">🧭 3D view</button></div>
            <div id="map" role="img" aria-label="Terrain map showing ordered route stops and calculated return path"></div>
            <div id="map3d" hidden style="flex:1;min-height:68vh"></div>
            <div class="map-footer"><div><span class="legend-line"></span> Planned path <span class="legend-dash"></span> Return from selected stop</div><span>Drag to explore · scroll to zoom</span></div>
            <div id="science-layer-note" class="science-layer-note" role="status" aria-live="polite">Orbital layers: select to see legend, credit and source.</div>
          </div>
        </section>
        <div class="planning-columns">
          <div class="planning-left">
            <section id="mission-schedule" aria-label="Planned EVA schedule"></section>
            <section id="planning-safety" aria-label="Safe-to-go planning scenario"></section>
          </div>
          <div class="planning-right">
            <section id="selected-stop-science" aria-label="Selected stop science and photo"></section>
            <section class="details"><div class="details-heading"><div><span class="eyebrow">NEXT LEG</span><h2 id="leg-title">Route details</h2></div><span id="leg-distance"></span></div><div id="warning-list" class="warning-list"></div></section>
          </div>
        </div>
        <footer>Built for the NASA Space Apps Challenge · MarsWay planning prototype · No official NASA route or hazard assessment</footer>
      </main>
    </div>`

  // Bring the map and ordered stops above the deeper safety and schedule sections.
  document.querySelector('.eva-picker').after(document.querySelector('.workspace'))

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -1.7, maxZoom: 1.2, zoomSnap: 0.25, zoomControl: false })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  const bounds = L.latLngBounds([[0, 0], [grid.sizeY, grid.sizeX]])
  L.rectangle(bounds, { color: '#b68f65', weight: 1, opacity: 0.2, fillOpacity: 0 }).addTo(map)
  const terrain = L.imageOverlay('/terrain/basemap.png', bounds, { opacity: 0.92, interactive: false }).addTo(map)
  const slope = L.imageOverlay('/terrain/slope.png', bounds, { opacity: 0.55, interactive: false })
  const roughness = L.imageOverlay(roughnessImage(grid), bounds, { opacity: 0.7, interactive: false })
  // Kelly's orbital crops cover the original 3 km square inside the 6 km grid.
  const scienceBounds = L.latLngBounds([[400, 600], [3400, 3600]])
  const science = {
    ctx: L.imageOverlay('/terrain/ctx.png', scienceBounds, { opacity: 0.85, interactive: false }),
    crismHyd: L.imageOverlay('/terrain/crism_hyd.png', scienceBounds, { opacity: 0.7, interactive: false }),
    crismAlt: L.imageOverlay('/terrain/crism_alt.png', scienceBounds, { opacity: 0.7, interactive: false }),
    themis: L.imageOverlay('/terrain/themis_night.png', scienceBounds, { opacity: 0.75, interactive: false }),
  }
  const scienceNote = document.querySelector('#science-layer-note')
  for (const [name, layer] of Object.entries(science)) layer.on('error', () => {
    if (map.hasLayer(layer)) showScienceLayerInfo(scienceNote, name, true)
  })
  for (const layer of [terrain, slope]) layer.on('error', () => {
    const notice = document.querySelector('.notice span')
    notice.textContent = 'A terrain image failed to load. Check public/terrain/basemap.png and slope.png. Route calculations use the JSON grids.'
  })
  const safety = mountPlanningSafety({ root: document.querySelector('#planning-safety'), map, grid, route })
  mountPlanningScenario(document.querySelector('#mission-schedule'), route, (scenario) => safety.setWeather(scenario))
  const safetyNotes = document.createElement('details')
  safetyNotes.className = 'planning-model-notes'
  const safetyNotesTitle = document.createElement('summary')
  safetyNotesTitle.textContent = 'How these estimates work'
  safetyNotes.append(safetyNotesTitle, ...document.querySelectorAll('#planning-safety .ps-note'))
  document.querySelector('#planning-safety').append(safetyNotes)
  const layerMap = { terrain, slope, roughness, safety: safety.layer, ...science }
  document.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.layer
    const layer = layerMap[key]
    const enabled = button.getAttribute('aria-pressed') !== 'true'
    if (enabled && science[key]) for (const [other, otherLayer] of Object.entries(science)) {
      if (other === key) continue
      map.removeLayer(otherLayer)
      document.querySelector(`[data-layer="${other}"]`).setAttribute('aria-pressed', 'false')
    }
    button.setAttribute('aria-pressed', String(enabled))
    if (enabled) layer.addTo(map)
    else map.removeLayer(layer)
    const active = Object.entries(science).find(([, value]) => map.hasLayer(value))
    showScienceLayerInfo(scienceNote, active?.[0] ?? null)
    // Re-toggling imagery must not cover the route or the selected return path.
    if (map.hasLayer(terrain)) terrain.bringToBack()
    lineLayers.forEach((line) => line.bringToFront())
    returnLayer.bringToFront()
  }))
  const lineLayers = legs.map((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 5, opacity: 0.86, lineCap: 'round' }).addTo(map))
  const returnLayer = L.polyline([], { color: '#8ce0d6', weight: 3, opacity: 0.92, dashArray: '8 9' }).addTo(map)
  const markers = stops.slice(0, -1).map((stop, index) => {
    const icon = L.divIcon({ className: 'stop-icon', html: `<span class="stop-marker ${index === 0 ? 'home-marker' : ''}">${index === 0 ? '⌂' : index}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
    return L.marker(mapPoint(stop), { icon }).addTo(map).on('click', () => selectStop(index))
  })
  map.fitBounds(bounds.pad(0.03), { padding: [18, 18] })

    // ---- 3D view ----
  let view3d = null
  const map3dEl = document.querySelector('#map3d')
  const scienceBox = { x0: 600, y0: 400, x1: 3600, y1: 3400 }
  const layers3d = {
    slope: { url: '/terrain/slope.png' },
    roughness: { url: roughnessImage(grid) },
    ctx: { url: '/terrain/ctx.png', bounds: scienceBox },
    crismHyd: { url: '/terrain/crism_hyd.png', bounds: scienceBox },
    crismAlt: { url: '/terrain/crism_alt.png', bounds: scienceBox },
    themis: { url: '/terrain/themis_night.png', bounds: scienceBox },
  }
  document.querySelector('#toggle3d').addEventListener('click', async (event) => {
    const button = event.currentTarget
    const on = button.getAttribute('aria-pressed') !== 'true'
    const { createPlanning3D, webglAvailable } = await import('./planning3d.js')
    if (on && !webglAvailable()) { button.textContent = '3D not supported here'; return }
    button.setAttribute('aria-pressed', String(on))
    if (view3d) view3d.setLayer(enabled && layers3d[key] ? key : 'terrain')
    document.querySelector('#map').hidden = on
    map3dEl.hidden = !on
    if (on && !view3d) view3d = createPlanning3D(map3dEl, { grid, basemapUrl: '/terrain/basemap.webp', layers: layers3d, legs, stops, onSelectStop: (i) => selectStop(i, false) })
    if (!on) map.invalidateSize()
  })

  function selectStop(index, pan = true) {
    const stop = stops[index]
    safety.selectStop(stop)
    renderStopDetails(document.querySelector('#selected-stop-science'), stop, { targetStatus: route.provenance?.target_status })
    const leg = legs[index] || legs[legs.length - 1]
    const home = route.returns.find((item) => item.from_stop_id === stop.id)
    if (view3d) { view3d.select(index); view3d.setReturnPath(home?.path) }

    document.querySelector('#leg-title').textContent = index < legs.length ? `${stop.name} → ${stops[index + 1].name}` : 'EVA complete'
    document.querySelector('#leg-distance').textContent = index < legs.length ? `${distance(leg.distance_m)}  /  ${duration(leg.walk_minutes)}` : ''
    document.querySelector('#warning-list').innerHTML = index < legs.length ? prominentWarnings(leg.warnings || []).map((warning) => `<div class="warning ${safe(warning.level)}"><span>${warning.level === 'danger' ? '!' : '⚑'}</span><div><strong>${safe(warning.type.replaceAll('_', ' '))} · ${safe(warning.level)}</strong><small>${safe(warning.message)}</small></div></div>`).join('') || '<span class="no-warning">No significant terrain notices for this leg. Route safety is estimated.</span>' : '<span class="no-warning">End of planned route.</span>'
    lineLayers.forEach((layer, number) => layer.setStyle({ color: number === index ? '#fff0ce' : '#f6b77c', weight: number === index ? 7 : 5, opacity: number === index ? 1 : 0.55 }))
    returnLayer.setLatLngs(home.path.map(mapPoint))
    markers.forEach((marker, number) => marker.setZIndexOffset(number === index ? 1000 : 0))
    if (pan) map.panTo(mapPoint(stop), { animate: true, duration: 0.4 })
  }

  selectStop(0, false)
}

root.innerHTML = '<div class="loading-screen">Loading terrain and calculating the demo route…</div>'
const catalog = loadScenarioCatalog().then((file) => (Array.isArray(file?.scenarios) && file.scenarios.length ? file.scenarios : BUILTIN_SCENARIOS)).catch(() => BUILTIN_SCENARIOS)
Promise.all([loadRouteForEva(new URLSearchParams(location.search).get('eva')), catalog])
  .then(([{ route, grid }, scenarios]) => { assertRoute(route); render(route, grid, scenarios) })
  .catch((error) => { root.innerHTML = `<div class="error-screen"><h1>Unable to calculate the route</h1><p>${safe(error.message)}</p><p>Check the terrain files in <code>public/terrain/</code> and the mission template in <code>public/routes/sample-route.json</code>. No sample route has been substituted.</p></div>` })
