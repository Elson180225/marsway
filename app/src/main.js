import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './style.css'
import { mountPlanningSafety } from './safezone/planningPanel.js'
import './stopDetails.css'
import { renderStopDetails } from './stopDetails.js'
import { loadTerrainRoute, roughnessImage } from './terrainRoute.js'

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

function render(route, grid) {
  const { mission, stops, legs } = route
  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance_m, 0)
  const totalMinutes = legs.reduce((sum, leg) => sum + leg.walk_minutes, 0)
  const warnings = legs.flatMap((leg) => leg.warnings || [])
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-symbol">✦</span><span>MARS<span class="brand-accent">WAY</span><small>EXPEDITION CONTROL</small></span></div>
        <div class="sidebar-divider"></div>
        <div class="sidebar-label">MISSION CONTROL</div>
        <nav aria-label="Application"><a class="nav-item active" href="#planning"><span>▦</span> EVA Planning</a><a class="nav-item" href="/walk.html"><span>⌖</span> Walk screen <small>Russell's view</small></a></nav>
        <div class="sidebar-bottom"><div class="sample-pulse"></div><div><strong>Prototype mode</strong><span>Terrain route estimates</span></div></div>
      </aside>
      <main id="planning" class="main">
        <header class="topbar"><div><span class="eyebrow">MISSION / ${safe(mission.id)}</span><h1>Plan the walk. <em>Get home safely.</em></h1><p>${safe(mission.site)} · ${safe(mission.name)}</p></div><div class="top-badge"><span class="sample-pulse"></span> TERRAIN ROUTING DEMO</div></header>
        <div class="notice" role="note"><strong>Terrain-based route estimates</strong><span>Elson's terrain + Nigel's planner. Suit speed and slope limits are team assumptions. ${route.provenance.target_status === 'ready' ? 'Kelly science stops are loaded.' : 'The grid-centre target is for demonstration; Kelly science stops are pending.'} Planning and Walk use the same route loader. Mission clock and suit budget are simulated; Planning safe-zone and turn-back estimates use Mia's model.</span></div>
        <section class="metrics" aria-label="Mission summary">
          <div class="metric"><span>ROUTE DISTANCE</span><strong>${distance(totalDistance)}</strong><small>Round trip · ${legs.length} legs</small></div>
          <div class="metric"><span>WALKING TIME</span><strong>${duration(totalMinutes)}</strong><small>Excludes science and rest stops</small></div>
          <div class="metric"><span>TURN BACK IN</span><strong id="planning-turnback">Calculating</strong><small id="planning-turnback-note">From selected reference</small></div>
          <div class="metric"><span>ROUTE NOTICES</span><strong>${warnings.length}</strong><small>Planner warnings to review</small></div>
        </section>
        <section id="planning-safety" aria-label="Safe-to-go planning scenario"></section>
        <section class="workspace" aria-label="Route planner">
          <div class="map-panel">
            <div class="panel-header"><div><span class="eyebrow">GALE CRATER / LOCAL GRID</span><h2>Route overview</h2></div><span class="map-scale">LOCAL METRES · TERRAIN GRID</span></div>
            <div class="layer-toolbar" role="group" aria-label="Terrain map layers"><span>LAYERS</span><button type="button" data-layer="terrain" aria-pressed="true">◈ Basemap</button><button type="button" data-layer="slope" aria-pressed="false">▥ Slope</button><button type="button" data-layer="roughness" aria-pressed="false">⁙ Roughness</button><button type="button" data-layer="safety" aria-pressed="true">Safe zone</button></div>
            <div id="map" role="img" aria-label="Terrain map showing the ordered demo stops and calculated return path"></div>
            <div class="map-footer"><div><span class="legend-line"></span> Planned path <span class="legend-dash"></span> Return from selected stop</div><span>Drag to explore · scroll to zoom</span></div>
          </div>
          <div class="route-panel">
            <div class="panel-header"><div><span class="eyebrow">EVA-07 / FLIGHT PLAN</span><h2>Route stops</h2></div><span class="count">${stops.length} STOPS</span></div>
            <div id="stop-list" class="stop-list"></div>
            <div id="return-summary" class="return-summary" aria-live="polite"></div>
          </div>
        </section>
        <section id="selected-stop-science" aria-label="Selected stop science and photo"></section>
        <section class="details"><div class="details-heading"><div><span class="eyebrow">SELECTED LEG</span><h2 id="leg-title">Route details</h2></div><span id="leg-distance"></span></div><p id="leg-description"></p><div id="warning-list" class="warning-list"></div></section>
        <footer>Built for the NASA Space Apps Challenge · MarsWay planning prototype · No official NASA route or hazard assessment</footer>
      </main>
    </div>`

  const map = L.map('map', { crs: L.CRS.Simple, minZoom: -1.7, maxZoom: 1.2, zoomSnap: 0.25, zoomControl: false })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  const bounds = L.latLngBounds([[0, 0], [grid.sizeY, grid.sizeX]])
  L.rectangle(bounds, { color: '#b68f65', weight: 1, opacity: 0.2, fillOpacity: 0 }).addTo(map)
  const terrain = L.imageOverlay('/terrain/basemap.png', bounds, { opacity: 0.92, interactive: false }).addTo(map)
  const slope = L.imageOverlay('/terrain/slope.png', bounds, { opacity: 0.55, interactive: false })
  const roughness = L.imageOverlay(roughnessImage(grid), bounds, { opacity: 0.7, interactive: false })
  for (const layer of [terrain, slope]) layer.on('error', () => {
    const notice = document.querySelector('.notice span')
    notice.textContent = 'A terrain image failed to load. Check public/terrain/basemap.png and slope.png. Route calculations use the JSON grids.'
  })
  const safety = mountPlanningSafety({ root: document.querySelector('#planning-safety'), map, grid, route })
  const layerMap = { terrain, slope, roughness, safety: safety.layer }
  document.querySelectorAll('[data-layer]').forEach((button) => button.addEventListener('click', () => {
    const layer = layerMap[button.dataset.layer]
    const enabled = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', String(enabled))
    if (enabled) layer.addTo(map)
    else map.removeLayer(layer)
  }))
  const lineLayers = legs.map((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 5, opacity: 0.86, lineCap: 'round' }).addTo(map))
  const returnLayer = L.polyline([], { color: '#8ce0d6', weight: 3, opacity: 0.92, dashArray: '8 9' }).addTo(map)
  const markers = stops.slice(0, -1).map((stop, index) => {
    const icon = L.divIcon({ className: 'stop-icon', html: `<span class="stop-marker ${index === 0 ? 'home-marker' : ''}">${index === 0 ? '⌂' : index}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] })
    return L.marker(mapPoint(stop), { icon }).addTo(map).on('click', () => selectStop(index))
  })
  map.fitBounds(bounds.pad(0.03), { padding: [18, 18] })

  function selectStop(index, pan = true) {
    const stop = stops[index]
    safety.selectStop(stop)
    renderStopDetails(document.querySelector('#selected-stop-science'), stop, { targetStatus: route.provenance?.target_status })
    const leg = legs[index] || legs[legs.length - 1]
    const home = route.returns.find((item) => item.from_stop_id === stop.id)
    document.querySelector('#stop-list').innerHTML = stops.map((item, number) => {
      const next = legs[number]
      return `<button type="button" class="stop-row ${number === index ? 'selected' : ''}" data-stop="${number}" aria-pressed="${number === index}"><span class="timeline-node">${number === 0 || item.type === 'home' ? '⌂' : number}</span><span class="stop-copy"><strong>${safe(item.name)}</strong><small>${safe(item.type.replace('_', ' '))}${next ? ` · ${distance(next.distance_m)} to next` : ''}</small></span><span class="stop-arrow">›</span></button>`
    }).join('')
    document.querySelectorAll('[data-stop]').forEach((button) => button.addEventListener('click', () => selectStop(Number(button.dataset.stop))))
    document.querySelector('#return-summary').innerHTML = `<span class="eyebrow">RETURN FROM ${safe(stop.name.toUpperCase())}</span><strong>${distance(home.distance_m)} · ${duration(home.walk_minutes)}</strong><small>Calculated return estimate to habitat</small>`
    document.querySelector('#leg-title').textContent = index < legs.length ? `${stop.name} → ${stops[index + 1].name}` : 'EVA complete'
    document.querySelector('#leg-distance').textContent = index < legs.length ? `${distance(leg.distance_m)}  /  ${duration(leg.walk_minutes)}` : ''
    document.querySelector('#leg-description').textContent = index < legs.length ? `${stop.description} Select a stop above to inspect its next leg and return route.` : 'Return to habitat.'
    document.querySelector('#warning-list').innerHTML = index < legs.length ? (leg.warnings || []).map((warning) => `<div class="warning ${safe(warning.level)}"><span>${warning.level === 'danger' ? '!' : '⚑'}</span><div><strong>${safe(warning.type.replaceAll('_', ' '))} · ${safe(warning.level)}</strong><small>${safe(warning.message)}</small></div></div>`).join('') || '<span class="no-warning">No planner warnings for this leg. This does not certify safety.</span>' : '<span class="no-warning">End of planned route.</span>'
    lineLayers.forEach((layer, number) => layer.setStyle({ color: number === index ? '#fff0ce' : '#f6b77c', weight: number === index ? 7 : 5, opacity: number === index ? 1 : 0.55 }))
    returnLayer.setLatLngs(home.path.map(mapPoint))
    markers.forEach((marker, number) => marker.setZIndexOffset(number === index ? 1000 : 0))
    if (pan) map.panTo(mapPoint(stop), { animate: true, duration: 0.4 })
  }

  selectStop(0, false)
}

root.innerHTML = '<div class="loading-screen">Loading terrain and calculating the demo route…</div>'
loadTerrainRoute()
  .then(({ route, grid }) => { assertRoute(route); render(route, grid) })
  .catch((error) => { root.innerHTML = `<div class="error-screen"><h1>Unable to calculate the route</h1><p>${safe(error.message)}</p><p>Check the terrain files in <code>public/terrain/</code> and the mission template in <code>public/routes/sample-route.json</code>. No sample route has been substituted.</p></div>` })
