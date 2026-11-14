import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './walk.css'
import {
  bearing, buildReturnTrip, cardinal, currentTrip, pointAlong, safetyStatus, sortWarnings,
} from './walk-model.js'

const root = document.querySelector('#walk')
const SPEEDS = [1, 60, 300] // simulated minutes per real minute
const TICK_MS = 250

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function duration(minutes) {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}

function distance(metres) {
  const value = Math.max(0, Math.round(metres))
  return value >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${value} m`
}

function utcTime(ms, seconds = false) {
  return new Date(ms).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), timeZone: 'UTC',
  })
}

function mapPoint(point) {
  return [point.y, point.x] // Leaflet CRS.Simple uses [northing, easting].
}

function assertRoute(route) {
  if (route.schema_version !== 1 || route.coordinate_system?.unit !== 'meter') throw new Error('Unsupported route data format.')
  if (!Array.isArray(route.stops) || !Array.isArray(route.legs) || !Array.isArray(route.returns)) throw new Error('Route data is incomplete.')
  if (route.legs.length !== route.stops.length - 1) throw new Error('A route leg is missing.')
  route.legs.forEach((leg, index) => {
    if (leg.from_stop_id !== route.stops[index].id || leg.to_stop_id !== route.stops[index + 1].id) throw new Error('Route legs are out of order.')
    if (!Array.isArray(leg.path) || leg.path.length < 2 || !(leg.walk_minutes > 0)) throw new Error(`Leg ${leg.id} is incomplete.`)
  })
  for (const stop of route.stops) {
    if (!route.returns.some((item) => item.from_stop_id === stop.id)) throw new Error(`No return route for ${stop.id}.`)
  }
}

function start(route) {
  const { mission, stops, legs } = route
  const isSample = mission.data_status !== 'VALIDATED'
  const initialState = () => ({
    mode: 'outbound', legIndex: 0, progress: 0, playing: false, returnTrip: null,
    clockMs: Date.parse(mission.start_time),
  })
  let state = initialState()
  let speedIndex = 1
  let follow = true
  let homeArmedUntil = 0
  let warningsKey = ''

  root.innerHTML = `
    <div class="walk">
      <header class="walk-top">
        <a class="walk-brand" href="/" aria-label="Back to the Planning screen"><span class="walk-brand-mark">✦</span>MARS<span>WAY</span></a>
        <div class="walk-mission"><span>${safe(mission.id)}</span><strong id="w-clock">--:--:--</strong><small>UTC</small></div>
      </header>
      ${isSample ? '<p class="walk-sample"><span class="walk-dot"></span>Sample route and simulated position. This is not live navigation.</p>' : ''}

      <section id="w-status" class="walk-status" role="status" aria-live="polite"></section>

      <section class="walk-next" aria-label="Next stop">
        <div class="walk-next-head">
          <span id="w-next-label" class="walk-eyebrow">NEXT STOP</span>
          <span id="w-phase" class="walk-phase"></span>
        </div>
        <h1 id="w-next-name">–</h1>
        <div class="walk-nav">
          <div class="walk-compass" aria-hidden="true"><span class="walk-compass-n">N</span><svg id="w-arrow" class="walk-arrow" viewBox="0 0 40 40"><path d="M20 3 L33 35 L20 27 L7 35 Z" /></svg></div>
          <div class="walk-nav-copy">
            <strong id="w-distance">–</strong>
            <span id="w-heading">–</span>
            <small id="w-eta">–</small>
          </div>
        </div>
      </section>

      <section class="walk-tiles" aria-label="Suit and turn-back timers">
        <div class="walk-tile" id="w-turnback-tile"><span>TURN BACK IN</span><strong id="w-turnback">–</strong><small>by ${safe(utcTime(Date.parse(mission.latest_turnback_time)))} UTC</small></div>
        <div class="walk-tile"><span>HOME FROM HERE</span><strong id="w-home">–</strong><small id="w-reserve">–</small></div>
      </section>

      <section class="walk-map-card" aria-label="Route map">
        <div id="w-map" role="img" aria-label="Map of the current leg, your simulated position and the path home"></div>
        <button type="button" id="w-recenter" class="walk-recenter" hidden>⌖ Recenter</button>
        <div class="walk-legend"><span class="walk-legend-line"></span>This leg<span class="walk-legend-dash"></span>Path home</div>
      </section>

      <section class="walk-warnings" aria-label="Warnings for this leg">
        <h2 class="walk-eyebrow">WARNINGS ON THIS LEG</h2>
        <div id="w-warnings"></div>
      </section>

      <div class="walk-actions">
        <button type="button" id="w-primary" class="walk-btn walk-btn-primary"></button>
        <div class="walk-actions-row">
          <button type="button" id="w-home-btn" class="walk-btn walk-btn-home">⌂ Head home</button>
          <button type="button" id="w-speed" class="walk-btn walk-btn-quiet" title="Simulation speed"></button>
        </div>
      </div>
    </div>`

  const $ = (id) => document.getElementById(id)

  // Map
  const map = L.map('w-map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25, zoomControl: false, attributionControl: false })
  const allPoints = legs.flatMap((leg) => leg.path.map(mapPoint))
  map.fitBounds(L.latLngBounds(allPoints).pad(0.15))
  legs.forEach((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 3, opacity: 0.25 }).addTo(map))
  const legLine = L.polyline([], { color: '#fff0ce', weight: 6, opacity: 0.95, lineCap: 'round' }).addTo(map)
  const homeLine = L.polyline([], { color: '#8ce0d6', weight: 4, opacity: 0.95, dashArray: '8 9' }).addTo(map)
  stops.forEach((stop, index) => {
    if (index > 0 && stop.type === 'home') return
    const icon = L.divIcon({ className: 'walk-stop-icon', html: `<span class="walk-stop ${index === 0 ? 'is-home' : ''}">${index === 0 ? '⌂' : index}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    L.marker(mapPoint(stop), { icon, interactive: false, keyboard: false }).addTo(map)
  })
  const me = L.marker([0, 0], {
    icon: L.divIcon({ className: 'walk-me-icon', html: '<span class="walk-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 2000,
  }).addTo(map)
  map.on('dragstart', () => { follow = false; $('w-recenter').hidden = false })
  $('w-recenter').addEventListener('click', () => { follow = true; $('w-recenter').hidden = true; update() })

  // Simulation
  function advance(minutes) {
    const trip = currentTrip(route, state)
    state.clockMs += minutes * 60000
    state.progress += minutes / trip.walk_minutes
    if (state.progress < 1) return
    state.playing = false
    if (state.mode === 'return' || trip.to.type === 'home') {
      state.mode = 'complete'
      state.progress = 1
    } else {
      state.legIndex += 1
      state.progress = 0
    }
  }

  function canHeadHome() {
    if (state.mode !== 'outbound') return false
    if (state.legIndex === 0 && state.progress === 0) return false
    return currentTrip(route, state).to.type !== 'home'
  }

  $('w-primary').addEventListener('click', () => {
    if (state.mode === 'complete') state = initialState()
    else state.playing = !state.playing
    update()
  })
  $('w-home-btn').addEventListener('click', () => {
    if (!canHeadHome()) return
    // Two taps to confirm, so a glove bump doesn't abort the walk.
    if (Date.now() > homeArmedUntil) { homeArmedUntil = Date.now() + 3000; update(); return }
    homeArmedUntil = 0
    state.returnTrip = buildReturnTrip(route, state)
    state.mode = 'return'
    state.progress = 0
    state.playing = true
    update()
  })
  $('w-speed').addEventListener('click', () => { speedIndex = (speedIndex + 1) % SPEEDS.length; update() })

  // Rendering
  function update() {
    const trip = currentTrip(route, state)
    const { point, nextIndex } = pointAlong(trip.path, state.progress)
    const remainingPath = [point, ...trip.path.slice(nextIndex)]
    const ahead = trip.path.slice(nextIndex).find((p) => p.x !== point.x || p.y !== point.y)
    const leftMinutes = trip.walk_minutes * (1 - state.progress)
    const safety = safetyStatus(route, state, state.clockMs)
    const turnbackMs = Date.parse(mission.latest_turnback_time) - state.clockMs
    const complete = state.mode === 'complete'

    $('w-clock').textContent = utcTime(state.clockMs, true)

    const status = $('w-status')
    status.className = `walk-status is-${safety.level}`
    status.innerHTML = `<span class="walk-status-icon">${safety.level === 'ok' ? '✓' : safety.level === 'info' ? '⌂' : '!'}</span><div><strong>${safe(safety.title)}</strong><small>${safe(safety.message)}</small></div>`

    $('w-next-label').textContent = complete ? 'EVA COMPLETE' : state.mode === 'return' ? 'HEADING HOME' : 'NEXT STOP'
    $('w-next-name').textContent = trip.to.name
    $('w-phase').textContent = complete ? 'Done' : state.playing ? 'Walking' : state.progress === 0 ? `At ${trip.from.name}` : 'Paused'
    $('w-distance').textContent = complete ? 'Arrived' : distance(trip.distance_m * (1 - state.progress))
    if (ahead && !complete) {
      const deg = bearing(point, ahead)
      $('w-arrow').style.transform = `rotate(${deg}deg)`
      $('w-arrow').toggleAttribute('hidden', false)
      $('w-heading').textContent = `Head ${cardinal(deg)} · ${Math.round(deg)}°`
    } else {
      $('w-arrow').toggleAttribute('hidden', true)
      $('w-heading').textContent = complete ? 'Back at the habitat' : '–'
    }
    $('w-eta').textContent = complete ? '' : `${duration(leftMinutes)} walking · arrive ${utcTime(state.clockMs + leftMinutes * 60000)} UTC`

    $('w-turnback').textContent = state.mode === 'outbound' ? (turnbackMs > 0 ? duration(turnbackMs / 60000) : 'NOW') : '—'
    $('w-turnback-tile').className = `walk-tile ${state.mode === 'outbound' && turnbackMs <= 0 ? 'is-danger' : state.mode === 'outbound' && turnbackMs <= 30 * 60000 ? 'is-caution' : ''}`
    $('w-home').textContent = complete ? '0m' : duration(safety.homeMinutes)
    $('w-reserve').textContent = `${duration(safety.reserveAtHome)} suit time left at home`

    // Map
    legLine.setLatLngs(complete ? [] : remainingPath.map(mapPoint))
    const homePath = complete ? [] : state.mode === 'return' ? remainingPath : buildReturnTrip(route, state).path
    homeLine.setLatLngs(homePath.map(mapPoint))
    me.setLatLng(mapPoint(point))
    if (follow) map.panTo(mapPoint(point), { animate: false })

    // Warnings only re-render when the leg changes.
    const key = `${state.mode}:${state.legIndex}`
    if (key !== warningsKey) {
      warningsKey = key
      const items = sortWarnings(trip.warnings)
      $('w-warnings').innerHTML = complete
        ? '<p class="walk-none">Route finished.</p>'
        : items.length
          ? items.map((w) => `<div class="walk-warning is-${safe(w.level)}"><span>${w.level === 'info' ? 'i' : '!'}</span><div><strong>${safe(String(w.type).replaceAll('_', ' '))} · ${safe(w.level)}</strong><small>${safe(w.message)}</small></div></div>`).join('')
          : '<p class="walk-none">No warnings on this leg.</p>'
    }

    // Buttons
    const primary = $('w-primary')
    primary.textContent = complete
      ? '↺ Restart simulation'
      : state.playing ? '❚❚ Pause'
        : state.progress > 0 ? '▶\uFE0E Resume'
          : state.mode === 'return' ? '▶\uFE0E Start walking home' : `▶\uFE0E Walk to ${trip.to.name}`
    primary.classList.toggle('is-paused', state.playing)
    const homeBtn = $('w-home-btn')
    homeBtn.disabled = !canHeadHome()
    const armed = Date.now() <= homeArmedUntil
    homeBtn.textContent = armed ? 'Tap again to head home' : '⌂ Head home'
    homeBtn.classList.toggle('is-armed', armed)
    $('w-speed').textContent = `Sim ${SPEEDS[speedIndex]}×`
  }

  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const wasPlaying = state.playing
    if (wasPlaying) advance(((now - last) / 60000) * SPEEDS[speedIndex])
    last = now
    // Redraw while walking, on the tick that arrives at a stop, and while "head home" is armed.
    const armExpired = homeArmedUntil && Date.now() > homeArmedUntil
    if (armExpired) homeArmedUntil = 0
    if (wasPlaying || homeArmedUntil || armExpired) update()
  }, TICK_MS)

  update()
  // The map container's size settles after fonts, layout and phone toolbars; re-measure whenever it changes.
  new ResizeObserver(() => { map.invalidateSize(); update() }).observe($('w-map'))
}

root.innerHTML = '<div class="walk-loading">Loading the walk route…</div>'
fetch('/routes/sample-route.json')
  .then((response) => { if (!response.ok) throw new Error(`Route file unavailable (${response.status}).`); return response.json() })
  .then((route) => { assertRoute(route); start(route) })
  .catch((error) => { root.innerHTML = `<div class="walk-loading is-error"><h1>Unable to load the route</h1><p>${safe(error.message)}</p></div>` })
