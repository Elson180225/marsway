import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './style.css'
import './scienceLayers.css'
import './planningCompact.css'
import './missionSchedule.css'
import './planningTravel.css'
import { mountPlanningScenario } from './planningScenario.js'
import { mountPlanningSidebarControls } from './planningSidebar.js'
import './planningSidebar.css'
import { showScienceLayerInfo } from './scienceLayerInfo.js'
import { mountPlanningSafety } from './safezone/planningPanel.js'
import './stopDetails.css'
import './mapKey.css'
import { mountMapKey } from './mapKey.js'
import { renderStopDetails } from './stopDetails.js'
import { loadRouteForEva, loadScenarioCatalog, roughnessImage } from './terrainRoute.js'
import { planningTravelVersions, travelComparison } from './planningTravel.js'
import { scenarioFromSearch, withScenario } from './scenarioEvents.js'

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

function render(route, grid, scenarios = BUILTIN_SCENARIOS, versions = null, mode = 'foot') {
  const { mission, stops, legs } = route
  // Mia's scenario number (?scenario=4821) stays in every link, so Planning and Walk show the same events.
  const seed = scenarioFromSearch(location.search)
  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance_m, 0)
  const totalMinutes = Math.round(legs.reduce((sum, leg) => sum + (leg.seconds ?? leg.walk_minutes * 60), 0) / 60)
  const warnings = prominentWarnings(legs.flatMap((leg) => leg.warnings || []))
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-symbol"><img src="/marsway-mark.svg" alt="" width="36" height="36"></span><span>MARS<span class="brand-accent">WAY</span><small>EXPEDITION CONTROL</small></span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-label">MISSION CONTROL</div>
        <nav aria-label="Application"><a class="nav-item active" href="#planning"><span>▦</span> EVA Planning</a>${mission.drive_out_minutes || mission.id === 'EVA-08' ? `<span class="nav-item quiet" title="The Walk screen does not support this travel version yet"><span>⌖</span> Walk screen <small>${mission.id === 'EVA-08' ? 'Not available for EVA-08' : 'On foot only'}</small></span>` : `<a class="nav-item" href="${withScenario(`/walk.html?eva=${encodeURIComponent(mission.id.replace('EVA-', ''))}`, seed)}"><span>⌖</span> Walk screen <small>Russell's view</small></a>`}<a class="nav-item" href="/terrain-lab.html"><span>◇</span> Terrain in 3D <small>5 km view</small></a></nav>
        <div class="planning-sidebar-controls" aria-label="Planning controls">
          <section class="planning-sidebar-section" aria-labelledby="sidebar-weather-title"><h2 id="sidebar-weather-title">Conditions</h2><div id="sidebar-weather-form"></div></section>
          <section class="planning-sidebar-section" aria-labelledby="sidebar-safety-title"><h2 id="sidebar-safety-title">Safety check</h2><div id="sidebar-safety-form"></div></section>
        </div>
        <div class="sidebar-bottom"><div class="sample-pulse"></div><div><strong>Prototype mode</strong><span>Terrain route estimates</span></div></div>
      </aside>
      <main id="planning" class="main">
        <header class="topbar"><div><span class="eyebrow">MISSION / ${safe(mission.id)}</span></div><div class="top-badge"><span class="sample-pulse"></span> TERRAIN ROUTING DEMO</div></header>
        <div class="notice" role="note"><span>Demo mission · ${route.provenance.target_status === 'draft' ? 'proposed Gediz stops' : route.provenance.target_status === 'ready' ? 'terrain estimates' : 'test target'} · no live telemetry</span></div>
        <nav class="eva-picker" aria-label="Select EVA">${scenarios.map((item) => `<a href="${withScenario(`/?eva=${encodeURIComponent(item.eva)}`, seed)}" aria-current="${mission.id === item.id ? 'page' : 'false'}">${safe(item.label)}</a>`).join('')}</nav>
        ${versions ? `<nav class="travel-picker" aria-label="Travel version"><a href="${withScenario(`/?eva=${encodeURIComponent(mission.id.slice(-2))}&travel=foot`, seed)}" aria-current="${mode === 'foot' ? 'page' : 'false'}">On foot</a><a href="${withScenario(`/?eva=${encodeURIComponent(mission.id.slice(-2))}&travel=rover`, seed)}" aria-current="${mode === 'rover' ? 'page' : 'false'}">With rover</a><span>${safe(travelComparison(versions))}</span></nav>` : ''}
        <section class="metrics" aria-label="Mission summary">
          <div class="metric"><span>${mission.drive_out_minutes ? 'WALK DISTANCE' : 'DISTANCE'}</span><strong>${distance(totalDistance)}</strong><small>${mission.drive_out_minutes ? 'Rover loop; suited drive below' : 'Round trip'}</small></div>
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

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2.5, zoomSnap: 0.25, zoomControl: false })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  const bounds = L.latLngBounds([[0, 0], [grid.sizeY, grid.sizeX]])
  map.setMaxBounds(bounds.pad(0.2))
  map.options.maxBoundsViscosity = 0.7
  L.rectangle(bounds, { color: '#b68f65', weight: 1, opacity: 0.2, fillOpacity: 0 }).addTo(map)
  const terrain = L.imageOverlay('/terrain/basemap.png', bounds, { opacity: 0.92, interactive: false }).addTo(map)
  const slope = L.imageOverlay('/terrain/slope.png', bounds, { opacity: 0.55, interactive: false })
  const roughness = L.imageOverlay(roughnessImage(grid), bounds, { opacity: 0.7, interactive: false })
  // Kelly's orbital crops cover the original 3 km square inside the 6 km grid.
  const scienceBounds = L.latLngBounds([[0, 0], [6000, 6000]])
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
  let view3d = null
  let safetyImage = null
  let sync3dLayers = () => {}
  mountMapKey(document.querySelector('.map-panel'), { route, grid })
  const safety = mountPlanningSafety({ root: document.querySelector('#planning-safety'), map, grid, route,
    onOverlayChange: (url) => { safetyImage = url; sync3dLayers() } })
  mountPlanningScenario(document.querySelector('#mission-schedule'), route, (scenario) => safety.setWeather(scenario), { grid })
  mountPlanningSidebarControls(document.querySelector('.sidebar'))
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
    sync3dLayers()
  }))
  const lineLayers = legs.map((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 5, opacity: 0.86, lineCap: 'round' }).addTo(map))
  if (route.drivePath?.length > 1) L.polyline(route.drivePath.map(mapPoint), { color: '#e0b485', weight: 3, opacity: 0.8, dashArray: '6 8', interactive: false }).addTo(map)
  const returnLayer = L.polyline([], { color: '#8ce0d6', weight: 3, opacity: 0.92, dashArray: '8 9' }).addTo(map)
  const markers = stops.slice(0, -1).map((stop, index) => {
    const icon = L.divIcon({ className: 'stop-icon', html: `<span class="stop-marker ${index === 0 ? 'home-marker' : ''}">${index === 0 ? '⌂' : index}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
    return L.marker(mapPoint(stop), { icon }).addTo(map).on('click', () => selectStop(index))
  })
  map.fitBounds(bounds.pad(0.03), { padding: [18, 18] })

    // ---- 3D view ----
  const map3dEl = document.querySelector('#map3d')
  const scienceBox = { x0: 0, y0: 0, x1: 6000, y1: 6000 }
  const layers3d = {
    slope: { url: '/terrain/slope.png' },
    roughness: { url: roughnessImage(grid) },
    ctx: { url: '/terrain/ctx.png', bounds: scienceBox },
    crismHyd: { url: '/terrain/crism_hyd.png', bounds: scienceBox },
    crismAlt: { url: '/terrain/crism_alt.png', bounds: scienceBox },
    themis: { url: '/terrain/themis_night.png', bounds: scienceBox },
  }
  sync3dLayers = () => {
    if (!view3d) return
    layers3d.safety = safetyImage ? { url: safetyImage, opacity: 0.85 } : null
    view3d.setLayers(Object.keys(layers3d).filter((key) => layers3d[key] && map.hasLayer(layerMap[key])), map.hasLayer(terrain))
  }
  let switching3d = false
  let view2d = null
  document.querySelector('#toggle3d').addEventListener('click', async (event) => {
    if (switching3d) return
    switching3d = true
    const button = event.currentTarget
    const on = button.getAttribute('aria-pressed') !== 'true'
    try {
      if (on) {
        const { createPlanning3D, webglAvailable } = await import('./planning3d.js')
        if (!webglAvailable()) { button.textContent = '3D not supported here'; return }
        view2d = { center: map.getCenter(), zoom: map.getZoom() }
        map3dEl.hidden = false
        document.querySelector('#map').hidden = true
        if (!view3d) view3d = createPlanning3D(map3dEl, { grid, basemapUrl: '/terrain/basemap.webp', layers: layers3d, legs, stops, onSelectStop: (i) => selectStop(i, false) })
        sync3dLayers()
      } else {
        map3dEl.hidden = true
        document.querySelector('#map').hidden = false
        map.invalidateSize({ pan: false })
        if (view2d) map.setView(view2d.center, view2d.zoom, { animate: false })
      }
      button.setAttribute('aria-pressed', String(on))
      button.textContent = on ? '🧭 2D view' : '🧭 3D view'
    } catch (error) {
      map3dEl.hidden = true
      document.querySelector('#map').hidden = false
      map.invalidateSize({ pan: false })
      button.setAttribute('aria-pressed', 'false')
      button.textContent = '3D unavailable'
      console.error('Planning 3D view failed:', error)
    } finally { switching3d = false }
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
const params = new URLSearchParams(location.search)
const eva = params.get('eva') || '07'
Promise.all([loadRouteForEva(eva), loadScenarioCatalog(), fetch('/terrain/area.json').then((r) => r.json()), fetch('/routes/rover-parking.json').then((r) => r.json())])
  .then(([initial, catalog, area, parking]) => {
    const versions = planningTravelVersions(initial, area, catalog, parking)
    const requested = params.get('travel')
    const mode = requested === 'foot' || requested === 'rover' ? requested : versions.defaultMode
    const route = versions[mode]
    assertRoute(route)
    render(route, initial.grid, catalog.scenarios, versions, mode)
  })
  .catch((error) => { root.innerHTML = `<div class="error-screen"><h1>Unable to calculate the route</h1><p>${safe(error.message)}</p><p>Check the terrain files in <code>public/terrain/</code> and the mission template in <code>public/routes/sample-route.json</code>. No sample route has been substituted.</p></div>` })
