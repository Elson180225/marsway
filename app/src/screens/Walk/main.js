import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './walk.css'
import { loadTerrainRoute } from '../../terrainRoute.js'
import { createTerrainNavigation } from '../../terrainNavigation.js'
import { loadHomeFile } from '../../safezone/homeFile.js'
import {
  ALERT_LEVELS, advance, bearing, bonusStatus, buildReturnTrip, canHeadHome, cardinal, currentTrip, headHome,
  minutesBehindPlan, pointAlong, radiationDose, safetyStatus, segmentLength, shelterFor, sortWarnings,
} from './walk-model.js'

const root = document.querySelector('#walk')
const SPEEDS = [1, 60, 300] // simulated minutes per real minute
const TICK_MS = 250
const STAY_MINUTES = 30 // demo button: the crew stays this much longer at a stop

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
  // `alerts` is optional: [{ type, level, message, shelter_stop_id }]
  if (route.alerts !== undefined) {
    if (!Array.isArray(route.alerts)) throw new Error('Route alerts must be a list.')
    for (const alert of route.alerts) {
      if (!ALERT_LEVELS.includes(alert.level)) throw new Error(`Unknown alert level "${alert.level}".`)
      if (alert.shelter_stop_id != null && !route.stops.some((stop) => stop.id === alert.shelter_stop_id)) throw new Error(`Alert shelter "${alert.shelter_stop_id}" is not a stop.`)
    }
  }
}

// Demo only. Clearly labelled as simulated wherever it appears.
function simulatedStorm(route) {
  return {
    type: 'solar_storm', level: 'danger', simulated: true, shelter_stop_id: route.stops[0].id,
    message: 'Solar particle event expected. Stop the walk and move to shelter.',
  }
}

function start(route, navigation, grid) {
  const { mission, stops, legs } = route
  const isSample = mission.data_status !== 'VALIDATED'
  const initialState = () => ({
    mode: 'outbound', legIndex: 0, progress: 0, playing: false, returnTrip: null, scienceLeft: 0, cutShortAt: null,
    clockMs: Date.parse(mission.start_time),
  })
  let state = initialState()
  let speedIndex = 1
  let follow = true
  let homeArmedUntil = 0
  let warningsKey = ''
  let alertsKey = ''
  let simAlert = null

  root.innerHTML = `
    <div class="walk">
      <header class="walk-top">
        <a class="walk-brand" href="/" aria-label="Back to the Planning screen"><span class="walk-brand-mark">✦</span>MARS<span>WAY</span></a>
        <div class="walk-mission"><span>${safe(mission.id)}</span><strong id="w-clock">--:--:--</strong><small>UTC</small></div>
      </header>
      ${isSample ? '<p class="walk-sample"><span class="walk-dot"></span>Terrain route estimates; simulated clock, suit budget and position. Not live navigation.</p>' : ''}

      <section id="w-alerts" class="walk-alerts" aria-label="Alerts" aria-live="assertive"></section>

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
        <div id="w-stop-row" class="walk-stop-row" hidden>
          <small id="w-plan">On plan</small>
          <button type="button" id="w-stay" class="walk-btn walk-btn-quiet" title="Simulate staying longer at this stop (demo)">+${STAY_MINUTES}m here</button>
        </div>
      </section>

      <section class="walk-tiles" aria-label="Turn-back timer, time home, bonus stop and radiation">
        <div class="walk-tile" id="w-turnback-tile"><span>TURN BACK IN</span><strong id="w-turnback">–</strong><small id="w-turnback-by">–</small></div>
        <div class="walk-tile"><span>HOME FROM HERE</span><strong id="w-home">–</strong><small id="w-reserve">–</small></div>
        <div class="walk-tile" id="w-bonus-tile" hidden><span>BONUS STOP</span><strong id="w-bonus">–</strong><small id="w-bonus-note">–</small></div>
        <div class="walk-tile" id="w-rad-tile" title="Estimate: about 0.67 mSv a day on the surface at Gale Crater, measured by Curiosity's RAD instrument (Hassler et al. 2014)."><span>RADIATION SO FAR</span><strong id="w-rad">–</strong><small id="w-rad-note">–</small></div>
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
          <button type="button" id="w-storm" class="walk-btn walk-btn-quiet" title="Simulate a solar storm alert (demo)"></button>
        </div>
      </div>
    </div>`

  const $ = (id) => document.getElementById(id)

  // Map
  const map = L.map('w-map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25, zoomControl: false, attributionControl: false })
  L.imageOverlay(route.map.basemap_url, route.map.bounds, { opacity: 0.8, interactive: false }).addTo(map).on('error', () => {
    const notice = document.querySelector('.walk-sample')
    if (notice) notice.textContent = 'Basemap unavailable. Terrain routing is still active; position and suit budget are simulated.'
  })
  const allPoints = legs.flatMap((leg) => leg.path.map(mapPoint))
  map.fitBounds(L.latLngBounds(allPoints).pad(0.15))
  legs.forEach((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 3, opacity: 0.25 }).addTo(map))
  const legLine = L.polyline([], { color: '#fff0ce', weight: 6, opacity: 0.95, lineCap: 'round' }).addTo(map)
  const homeLine = L.polyline([], { color: '#8ce0d6', weight: 4, opacity: 0.95, dashArray: '8 9' }).addTo(map)
  stops.forEach((stop, index) => {
    if (index > 0 && stop.type === 'home') return
    const kind = index === 0 ? 'is-home' : stop.is_bonus ? 'is-bonus' : ''
    const icon = L.divIcon({ className: 'walk-stop-icon', html: `<span class="walk-stop ${kind}">${index === 0 ? '⌂' : index}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    L.marker(mapPoint(stop), { icon, interactive: false, keyboard: false }).addTo(map)
  })
  const shelterRing = L.circleMarker([0, 0], { radius: 22, color: '#ff7b6e', weight: 3, fill: false, dashArray: '4 5', interactive: false })
  const me = L.marker([0, 0], {
    icon: L.divIcon({ className: 'walk-me-icon', html: '<span class="walk-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 2000,
  }).addTo(map)
  map.on('dragstart', () => { follow = false; $('w-recenter').hidden = false })
  $('w-recenter').addEventListener('click', () => { follow = true; $('w-recenter').hidden = true; update() })

  // Simulation (advance() in walk-model.js moves the clock, the crew and the science time at stops)
  const atStop = () => state.mode === 'outbound' && state.progress === 0 && state.legIndex > 0

  $('w-primary').addEventListener('click', () => {
    if (state.mode === 'complete') state = initialState()
    else state.playing = !state.playing
    update()
  })
  $('w-home-btn').addEventListener('click', () => {
    if (!canHeadHome(route, state)) return
    // Two taps to confirm, so a glove bump doesn't abort the walk.
    if (Date.now() > homeArmedUntil) { homeArmedUntil = Date.now() + 3000; update(); return }
    homeArmedUntil = 0
    try { headHome(route, state, navigation) } // remembers a stop whose science was cut short
    catch (error) { stopOnRouteError(error); return }
    update()
  })
  $('w-stay').addEventListener('click', () => {
    if (!atStop()) return
    state.clockMs += STAY_MINUTES * 60000 // demo: the crew stayed longer than planned
    update()
  })
  $('w-speed').addEventListener('click', () => { speedIndex = (speedIndex + 1) % SPEEDS.length; update() })
  $('w-storm').addEventListener('click', () => { simAlert = simAlert ? null : simulatedStorm(route); update() })

  function renderAlerts(point) {
    const alerts = sortWarnings([...(route.alerts || []), ...(simAlert ? [simAlert] : [])])
    const key = `${alerts.length}:${simAlert ? 1 : 0}:${Math.round(point.x / 25)}:${Math.round(point.y / 25)}`
    if (key === alertsKey) return
    alertsKey = key
    const shelterStops = []
    $('w-alerts').innerHTML = alerts.map((alert) => {
      const shelter = shelterFor(route, alert)
      if (shelter && alert.level !== 'info') shelterStops.push(shelter)
      let shelterLine = '<small class="walk-alert-shelter">No shelter identified.</small>'
      if (shelter) {
        const deg = bearing(point, shelter)
        const metres = segmentLength(point, shelter)
        shelterLine = metres < 1
          ? `<small class="walk-alert-shelter">Shelter: ${safe(shelter.name)} · you are here</small>`
          : `<small class="walk-alert-shelter">Shelter: <b>${safe(shelter.name)}</b> · ${distance(metres)} ${cardinal(deg)} in a straight line (not a planned route)</small>`
      }
      return `<div class="walk-alert is-${safe(alert.level)}">
        <div class="walk-alert-head"><strong>${safe(String(alert.type).replaceAll('_', ' '))}</strong>${alert.simulated ? '<span class="walk-alert-sim">SIMULATED</span>' : ''}</div>
        <p>${safe(alert.message)}</p>${shelterLine}
      </div>`
    }).join('')
    if (shelterStops.length) shelterRing.setLatLng(mapPoint(shelterStops[0])).addTo(map)
    else shelterRing.remove()
  }

  // Rendering
  function stopOnRouteError(error) {
    state.playing = false
    const status = $('w-status')
    status.className = 'walk-status is-danger'
    status.innerHTML = `<div><strong>Return estimate unavailable</strong><small>${safe(error.message)}</small></div>`
    $('w-turnback').textContent = 'Unavailable'
    $('w-turnback-by').textContent = 'Do not use this countdown'
    $('w-home').textContent = 'Unavailable'
    $('w-reserve').textContent = 'Route calculation failed'
  }

  function update() {
    try { updateView() } catch (error) { stopOnRouteError(error) }
  }

  function updateView() {
    const trip = currentTrip(route, state)
    const { point, nextIndex } = pointAlong(trip.path, state.progress)
    const remainingPath = [point, ...trip.path.slice(nextIndex)]
    const ahead = trip.path.slice(nextIndex).find((p) => p.x !== point.x || p.y !== point.y)
    const leftMinutes = trip.walk_minutes * (1 - state.progress)
    let safety = safetyStatus(route, state, state.clockMs, navigation)
    // A danger alert (e.g. a solar storm) outranks the suit-time status.
    const urgent = [...(route.alerts || []), ...(simAlert ? [simAlert] : [])].find((a) => a.level === 'danger')
    if (urgent && state.mode !== 'complete') {
      const shelter = shelterFor(route, urgent)
      safety = { ...safety, level: 'danger', title: shelter ? `Go to shelter: ${shelter.name}` : 'Danger alert', message: shelter?.id === stops[0].id ? 'Shelter is the habitat. Use Head home to follow the planned return path.' : 'See the alert above.' }
    }
    const complete = state.mode === 'complete'
    renderAlerts(point)

    $('w-clock').textContent = utcTime(state.clockMs, true)

    const status = $('w-status')
    status.className = `walk-status is-${safety.level}`
    status.innerHTML = `<span class="walk-status-icon">${safety.level === 'ok' ? '✓' : safety.level === 'info' ? '⌂' : '!'}</span><div><strong>${safe(safety.title)}</strong><small>${safe(safety.message)}</small></div>`

    const scienceLeft = state.scienceLeft || 0
    $('w-next-label').textContent = complete ? 'EVA COMPLETE' : state.mode === 'return' ? 'HEADING HOME' : trip.to.is_bonus ? 'NEXT STOP · BONUS' : 'NEXT STOP'
    $('w-next-name').textContent = trip.to.name
    $('w-phase').textContent = complete ? 'Done'
      : scienceLeft ? `${state.playing ? 'Science' : 'Paused'} · ${duration(scienceLeft)} left`
        : state.playing ? 'Walking' : state.progress === 0 ? `At ${trip.from.name}` : 'Paused'
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
    $('w-eta').textContent = complete ? '' : `${scienceLeft ? `${duration(scienceLeft)} science, then ` : ''}${duration(leftMinutes)} walking · arrive ${utcTime(state.clockMs + (scienceLeft + leftMinutes) * 60000)} UTC`

    // Turn-back = suit deadline − reserve − time home from here, so it shrinks faster while walking away.
    const outbound = state.mode === 'outbound'
    const turnbackIn = safety.turnbackIn
    $('w-turnback').textContent = outbound ? (turnbackIn > 0 ? duration(turnbackIn) : 'NOW') : '—'
    $('w-turnback-by').textContent = outbound
      ? (turnbackIn > 0 ? `start home by ${utcTime(state.clockMs + turnbackIn * 60000)} UTC` : 'start heading home')
      : complete ? 'walk finished' : 'already heading home'
    $('w-turnback-tile').className = `walk-tile ${outbound && turnbackIn <= 0 ? 'is-danger' : outbound && turnbackIn <= 30 ? 'is-caution' : ''}`
    $('w-home').textContent = complete ? '0m' : duration(safety.homeMinutes)
    $('w-reserve').textContent = `${duration(safety.reserveAtHome)} suit time left at home`

    // At a stop: how the crew is doing against the planned times, and the demo "+30m here" button.
    $('w-stop-row').hidden = !atStop()
    const behind = minutesBehindPlan(route, state, state.clockMs) ?? 0
    $('w-plan').textContent = behind < 0.5 ? 'On schedule' : `${duration(behind)} behind schedule`
    $('w-plan').classList.toggle('is-late', behind >= 0.5)
    renderBonus()
    renderRadiation()

    // Map
    legLine.setLatLngs(complete ? [] : remainingPath.map(mapPoint))
    const homePath = complete ? [] : state.mode === 'return' ? remainingPath : buildReturnTrip(route, state, navigation).path
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
        : scienceLeft ? `▶\uFE0E Resume science · ${duration(scienceLeft)} left`
          : state.progress > 0 ? '▶\uFE0E Resume'
            : state.mode === 'return' ? '▶\uFE0E Start walking home' : `▶\uFE0E Walk to ${trip.to.name}`
    primary.classList.toggle('is-paused', state.playing)
    const homeBtn = $('w-home-btn')
    homeBtn.disabled = !canHeadHome(route, state)
    const armed = Date.now() <= homeArmedUntil
    homeBtn.textContent = armed ? 'Tap again to head home' : '⌂ Head home'
    homeBtn.classList.toggle('is-armed', armed)
    $('w-speed').textContent = `${SPEEDS[speedIndex]}×`
    $('w-storm').textContent = simAlert ? '✕ Storm' : '☀︎ Storm'
    $('w-storm').setAttribute('aria-pressed', String(Boolean(simAlert)))
  }

  // Bonus stop GO / NO-GO from Mia's check. Before the stop it answers "if we keep to the plan".
  function renderBonus() {
    let bonus
    try { bonus = bonusStatus(route, state, state.clockMs, { grid, timeHome: navigation.timeHome }) }
    catch (error) { bonus = { phase: 'error', error } }
    const tile = $('w-bonus-tile')
    tile.hidden = !bonus
    $('w-rad-tile').classList.toggle('is-wide', !bonus)
    if (!bonus) return
    let value = '–'
    let note = ''
    let level = ''
    if (bonus.phase === 'error') note = 'check unavailable'
    else if (bonus.phase === 'here') { value = 'HERE'; note = state.scienceLeft > 0 ? `science ${duration(state.scienceLeft)} left` : 'science done' }
    else if (bonus.phase === 'done') { value = 'DONE'; note = 'science done' }
    else if (bonus.phase === 'incomplete') { value = 'INCOMPLETE'; note = 'science not finished' }
    else if (bonus.phase === 'skipped') { value = 'SKIPPED'; note = 'headed home instead' }
    else if (!bonus.go) {
      value = 'NO-GO'
      level = 'danger'
      note = bonus.spareMinutes < 0 ? `would use ${duration(-bonus.spareMinutes)} of reserve` : bonus.title.replace(/^NO-GO:\s*/, '')
    } else {
      value = 'GO'
      level = bonus.level === 'caution' ? 'caution' : 'ok'
      note = `${level === 'caution' ? 'tight: ' : ''}${duration(bonus.spareMinutes)} to spare`
    }
    const why = bonus.phase === 'error' ? bonus.error.message
      : bonus.phase === 'ahead' && Number.isFinite(bonus.spareMinutes)
        ? `${bonus.decideNow ? '' : 'If you keep to the plan: '}${duration(bonus.walkThereMinutes)} to get there, ${Math.round(bonus.stopMinutes)} min of science, ${duration(bonus.homeFromBonusMinutes)} back to the habitat.`
        : note
    tile.className = `walk-tile${level ? ` is-${level}` : ''}${value.length > 7 ? ' is-long' : ''}`
    tile.title = `${bonus.stop?.name ?? 'Bonus stop'}: ${why}`
    $('w-bonus').textContent = value
    $('w-bonus-note').textContent = note
  }

  // Radiation counter: dose so far, next to the dose for the whole walking budget (0.17 mSv for 6 h).
  function renderRadiation() {
    const dose = radiationDose(route, state.clockMs)
    const hours = Number.isInteger(dose.walkHours) ? `${dose.walkHours}h` : duration(dose.walkHours * 60)
    $('w-rad').textContent = `${dose.soFarMSv.toFixed(2)} mSv`
    $('w-rad-note').textContent = `${dose.fullWalkMSv.toFixed(2)} mSv for a full ${hours} walk`
  }

  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const wasPlaying = state.playing
    if (wasPlaying) advance(route, state, ((now - last) / 60000) * SPEEDS[speedIndex])
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
// Mia's pre-calculated way home saves the phone a search. Without it, the terrain is enough.
const homeFile = loadHomeFile().catch((error) => {
  console.warn(`Home file unavailable (${error.message}). Working out the way home on the phone.`)
  return null
})
Promise.all([loadTerrainRoute(), homeFile])
  .then(([{ route, grid }, file]) => {
    assertRoute(route)
    const navigation = createTerrainNavigation(route, grid, { homeFile: file })
    if (file && navigation.source !== 'home file') console.warn('Home file does not match this terrain, so the phone worked out the way home itself. Rebuild it: node src/safezone/buildHomeFile.js')
    start(route, navigation, grid)
  })
  .catch((error) => { root.innerHTML = `<div class="walk-loading is-error"><h1>Unable to load the route</h1><p>${safe(error.message)}</p></div>` })
