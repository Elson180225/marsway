import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './walk.css'
import { loadRouteForEva, loadScenarioCatalog } from '../../terrainRoute.js'
import { createTerrainNavigation } from '../../terrainNavigation.js'
import { loadHomeFile } from '../../safezone/homeFile.js'
import { directionsFor } from '../../pathfinding/directions.js'
import { RAD_SURFACE_MSV_PER_DAY, SOLAR_STORM_FACTOR } from '../../safezone/radiation.js'
import { photoFileName, photosFor, savePhoto } from './stopPhotos.js'
import { openFakeCamera } from './fakeCamera.js'
import { seedFromText } from './marsScene.js'
import { randomSeed } from '../../safezone/randomEvents.js'
import { scenarioEvents, scenarioFromSearch, withScenario } from '../../scenarioEvents.js'
import {
  ALERT_LEVELS, advance, arrivalTimes, bearing, bonusStatus, buildReturnTrip, canHeadHome, cardinal, currentTrip, directionLine,
  eventAlerts, eventEffects, eventSolarStorms, groundAt, hazardSpots, headHome, minutesBehindPlan, pathGround, pathLength, photoStop, pointAlong, radiationDose,
  safetyStatus, segmentLength, shelterFor, sortWarnings, walkPace,
} from './walk-model.js'
// Solar storm shelter route (Nigel's pathfinding/shelter.js)
import { demoStormEvents, stormShelter } from './walk-model.js'
import { currentSolarStorm } from '../../pathfinding/shelter.js'
import { activeEvents } from '../../safezone/randomEvents.js'

const root = document.querySelector('#walk')
// ?eva=09 etc. picks the scenario, as on the Planning screen. No ?eva is EVA-07.
const eva = new URLSearchParams(location.search).get('eva')
const planningHref = eva ? `/?eva=${encodeURIComponent(eva)}` : '/'
const SPEEDS = [1, 60, 300] // simulated minutes per real minute
const TICK_MS = 250
const STAY_MINUTES = 30 // demo button: the crew stays this much longer at a stop
// Demo: "📷 Take photo" makes a simulated photo (fakeCamera.js). true = open the phone's real camera
// again (capture="environment"), with "Choose from the gallery" when there is no camera.
const REAL_CAMERA = false
const SLOW_PACE = 1.3 // demo button: the crew walks 30% slower than planned

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

const HOME_COLOR = '#8ce0d6' // dashed path home (--w-home in walk.css)
const SHELTER_COLOR = '#ff7b6e' // the path home in a solar storm: Nigel's shelter route (--w-danger)

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
  let slowWalk = false // demo: the simulated crew walks slower than planned
  const initialState = () => ({
    mode: 'outbound', legIndex: 0, progress: 0, playing: false, returnTrip: null, scienceLeft: 0, cutShortAt: null,
    clockMs: Date.parse(mission.start_time), simPace: slowWalk ? SLOW_PACE : 1, paceLog: null,
    solarStorms: [], // [{ startMs, endMs }] on the walk clock, for the radiation counter (endMs null = still on)
  })
  let state = initialState()
  let speedIndex = 1
  let follow = true
  let homeArmedUntil = 0
  let photoKey = ''
  let simAlert = null

  // Mia's random events (safezone/randomEvents.js): ?scenario=4821 gives a repeatable set of dust storms,
  // dust devils and solar storms. scenarioEvents() uses the same walk length as Planning, so one number
  // gives the same events on both screens; the number stays in this page's link and the link back.
  let scenario = null
  function setScenario(seed) {
    scenario = null
    if (seed) {
      try { scenario = scenarioEvents(route, seed) }
      catch (error) { console.warn(`Random events unavailable (${error.message}).`) }
    }
    history.replaceState(history.state, '', withScenario(location.pathname + location.search + location.hash, scenario?.seed))
    root.querySelector('.walk-brand')?.setAttribute('href', withScenario(planningHref, scenario?.seed))
  }
  setScenario(scenarioFromSearch(location.search))
  const minutesOut = () => (state.clockMs - Date.parse(mission.start_time)) / 60000
  // Every alert now: from the route file, the ☀︎ Storm demo button, the random events under way, and a
  // solar storm the crew has been warned about (it has not started yet, so it is not "under way").
  const currentAlerts = () => [
    ...(route.alerts || []), ...(simAlert ? [simAlert] : []), ...(scenario ? eventAlerts(route, scenario.events, minutesOut()) : []),
    ...(shelterNow?.storm.phase === 'warning' ? [stormWarning(shelterNow.storm)] : []),
  ]
  // Solar storms for the radiation counter: the demo button and the random ones.
  const solarStorms = () => [...state.solarStorms, ...(scenario ? eventSolarStorms(route, scenario.events) : [])]
  // Dust storm and dust devil: set state.weatherPace and state.waitLeft from the clock (walk-model.js),
  // so advance() moves the crew slower or not at all, and the ETAs include the wait.
  const applyEventEffects = () => eventEffects(state, scenario?.events, minutesOut())

  // Nigel's shelter route (pathfinding/shelter.js) while a solar storm is warned or on: the quickest way
  // into the habitat from where the crew is, how long, and the extra dose. It is a route search, so it
  // is worked out again only when the storm changes, the crew has moved 50 m or a minute has passed,
  // and at most once a second.
  let shelterNow = null
  let shelterKey = ''
  let shelterAt = null
  const stormEvents = () => [...(scenario?.events ?? []), ...demoStormEvents(route, state.solarStorms)]
  function updateShelter(point) {
    const now = minutesOut()
    const storm = state.mode === 'complete' ? null : currentSolarStorm(stormEvents(), Math.max(0, now))
    if (!storm) { shelterNow = null; shelterKey = ''; return }
    const key = `${storm.startMin}:${storm.phase}:${activeEvents(stormEvents(), now).some((e) => e.type === 'dust_storm')}`
    const recent = shelterAt && Date.now() - shelterAt.realMs < 1000
    const near = shelterAt && now - shelterAt.min < 1 && segmentLength(shelterAt.point, point) < 50
    if (key === shelterKey && (recent || near)) return
    try { shelterNow = stormShelter(route, grid, stormEvents(), now, point) }
    catch (error) { shelterNow = null; console.warn(`Shelter route unavailable (${error.message}).`) }
    shelterKey = key
    shelterAt = { point, min: now, realMs: Date.now() }
  }
  const stormWarning = (storm) => {
    const startMs = Date.parse(mission.start_time) + storm.startMin * 60000
    return {
      type: 'solar_storm', level: 'danger', simulated: true, warning: true, shelter_stop_id: stops[0].id, startMs,
      endMs: storm.durationMin == null ? null : startMs + storm.durationMin * 60000,
      message: 'Solar storm warning: radiation will double outside. Head for shelter now.',
    }
  }

  root.innerHTML = `
    <div class="walk" data-view="main">
      <header class="walk-top">
        <a class="walk-brand" href="${withScenario(planningHref, scenario?.seed)}" aria-label="MarsWay — back to Planning"><span class="walk-brand-mark"><img src="/marsway-mark.svg" alt="" width="28" height="28"></span>MARS<span>WAY</span></a>
        <div class="walk-mission"><span>${safe(mission.id)}</span><strong id="w-clock">--:--:--</strong><small>UTC</small></div>
      </header>

      <section id="w-status" class="walk-status" role="status" aria-live="polite"></section>


      <div id="w-main" class="walk-main">
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
            <small id="w-eta">–</small>
          </div>
        </div>
        <p id="w-turn" class="walk-turn" hidden></p>
        <p id="w-times" class="walk-times" hidden></p>
        <div id="w-stop-row" class="walk-stop-row" hidden>
          <small id="w-plan">On plan</small>
          <button type="button" id="w-stay" class="walk-btn walk-btn-quiet" title="Simulate staying longer at this stop (demo)">+${STAY_MINUTES}m here</button>
        </div>
      </section>

      <section id="w-map-card" class="walk-map-card" aria-label="Route map">
        <div class="walk-map-wrap">
          <div id="w-map" role="img" aria-label="Map of the current leg, your simulated position, the path home and pop-ups for stops, hazards and alerts"></div>
          <button type="button" id="w-recenter" class="walk-recenter" aria-label="Recenter the map on me" title="Recenter the map on me" hidden>⌖</button>
        </div>
        <ul class="walk-legend" aria-label="Map key">
          <li><span class="walk-legend-line"></span>This leg</li>
          <li><span class="walk-legend-dash"></span><span class="walk-legend-home">Path home</span><span class="walk-legend-shelter">Shelter route</span></li>
          <li><span class="walk-me walk-legend-me"></span>Crew</li>
          <li><span class="walk-stop is-home walk-legend-stop">⌂</span>Habitat</li>
          <li><span class="walk-stop is-bonus walk-legend-stop"></span>Bonus stop</li>
          <li><span class="walk-hazard is-caution walk-legend-sign"><i>!</i></span>Steep</li>
          <li><span class="walk-hazard is-caution walk-legend-sign"><i>≈</i></span>Rough</li>
        </ul>
      </section>
      <p id="w-turnback-line" class="walk-turnback-line" hidden></p>
      <nav class="walk-pages" aria-label="More about this walk">
        <button type="button" id="w-open-science" class="walk-page-btn"><span><i aria-hidden="true">🔬</i>Science</span><small id="w-science-hint">–</small></button>
        <button type="button" id="w-open-data" class="walk-page-btn"><span><i aria-hidden="true">📊</i>Data</span><small id="w-data-hint">Radiation, storms, terrain</small></button>
      </nav>
      </div>
      <p id="w-announce" class="walk-sr" aria-live="assertive"></p>

      <section id="w-science-page" class="walk-page" aria-labelledby="w-science-title" hidden>
        <div class="walk-page-head"><button type="button" class="walk-back" data-back>← Back to map</button><h2 id="w-science-title" tabindex="-1">Science stop</h2></div>
        <p id="w-photo-none" class="walk-page-empty" hidden></p>
        <section id="w-shots" class="walk-data-card walk-shots" aria-labelledby="w-shots-title" hidden>
          <h3 id="w-shots-title">Your photos</h3>
          <button type="button" id="w-shot-take" class="walk-btn walk-btn-camera"><span aria-hidden="true">📷</span> Take photo</button>
          ${REAL_CAMERA ? `<button type="button" id="w-shot-pick" class="walk-shot-pick">No camera? Choose from the gallery</button>
          <input id="w-shot-camera" type="file" accept="image/*" capture="environment" hidden>
          <input id="w-shot-gallery" type="file" accept="image/*" hidden>` : ''}
          <p id="w-shot-status" class="walk-shot-status" role="status"></p>
          <ul id="w-shot-list" class="walk-shot-list"></ul>
          ${REAL_CAMERA ? '<p class="walk-data-source">Kept on this phone only, never uploaded. Each photo is labelled with the stop, the EVA, the mission time and your simulated position.</p>' : ''}
        </section>
      </section>
      <div id="w-shutter" class="walk-shutter" aria-hidden="true"></div>

      <section id="w-data-page" class="walk-page" aria-labelledby="w-data-title" hidden>
        <div class="walk-page-head"><button type="button" class="walk-back" data-back>← Back to map</button><h2 id="w-data-title" tabindex="-1">Data</h2></div>
      <section class="walk-tiles" aria-label="Turn-back timer, time home, bonus stop and radiation">
        <div class="walk-tile" id="w-turnback-tile"><span>TURN BACK IN</span><strong id="w-turnback">–</strong><small id="w-turnback-by">–</small></div>
        <div class="walk-tile"><span>HOME FROM HERE</span><strong id="w-home">–</strong><small id="w-reserve">–</small></div>
        <div class="walk-tile" id="w-bonus-tile" hidden><span>BONUS STOP</span><strong id="w-bonus">–</strong><small id="w-bonus-note">–</small></div>
        <div class="walk-tile" id="w-rad-tile" title="Estimate: about 0.67 mSv a day on the surface at Gale Crater, measured by Curiosity's RAD instrument (Hassler et al. 2014). Doubled during a solar storm (team assumption from the September 2017 event). Not a measured personal dose."><span>RADIATION SO FAR</span><strong id="w-rad">–</strong><small id="w-rad-note">–</small></div>
      </section>
        <section class="walk-data-card" aria-labelledby="w-data-rad-title">
          <h3 id="w-data-rad-title">Radiation</h3>
          <dl id="w-data-rad" class="walk-rows"></dl>
          <p class="walk-data-source">Estimate, not a personal dose: about ${RAD_SURFACE_MSV_PER_DAY} mSv a day on the surface at Gale Crater, measured by Curiosity's RAD instrument (Hassler et al. 2014). ×${SOLAR_STORM_FACTOR} during a solar storm, from the September 2017 event.</p>
        </section>
        <section class="walk-data-card" aria-labelledby="w-data-alerts-title">
          <h3 id="w-data-alerts-title">Storms and alerts</h3>
          <div class="walk-scenario">
            <span id="w-scenario-label">Random events off</span>
            <button type="button" id="w-scenario-new" class="walk-btn walk-btn-quiet">🎲 Random events</button>
            <button type="button" id="w-scenario-off" class="walk-btn walk-btn-quiet" hidden>Off</button>
          </div>
          <div id="w-data-alerts"></div>
          <ul id="w-scenario-log" class="walk-scenario-log" hidden></ul>
        </section>
        <section class="walk-data-card" aria-labelledby="w-data-ground-title">
          <h3 id="w-data-ground-title">Terrain</h3>
          <dl id="w-data-ground" class="walk-rows"></dl>
          <ul id="w-data-hazards" class="walk-hazard-list"></ul>
        </section>
      </section>

      <div class="walk-actions">
        <button type="button" id="w-primary" class="walk-btn walk-btn-primary"></button>
        <div class="walk-actions-row">
          <button type="button" id="w-home-btn" class="walk-btn walk-btn-home">⌂ Head home</button>
          <button type="button" id="w-speed" class="walk-btn walk-btn-quiet" title="Simulation speed"></button>
          <button type="button" id="w-slow" class="walk-btn walk-btn-quiet" title="Simulate the crew walking 30% slower than planned (demo)"></button>
          <button type="button" id="w-storm" class="walk-btn walk-btn-quiet" title="Simulate a solar storm alert (demo)"></button>
        </div>
      </div>
    </div>`

  const $ = (id) => document.getElementById(id)

  // Map
  const map = L.map('w-map', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, zoomSnap: 0.25, zoomControl: false, attributionControl: false })
  L.imageOverlay(route.map.basemap_url, route.map.bounds, { opacity: 0.8, interactive: false }).addTo(map).on('error', () => {
    $('w-map-card').insertAdjacentHTML('beforeend', '<p class="walk-map-note">No basemap. Routing still uses the terrain.</p>')
  })
  const scienceStops = stops.filter((stop, index) => index > 0 && stop.type !== 'home' && stop.type !== 'habitat')
  const allPoints = legs.flatMap((leg) => leg.path.map(mapPoint))
  map.fitBounds(L.latLngBounds(allPoints).pad(0.15))
  legs.forEach((leg) => L.polyline(leg.path.map(mapPoint), { color: '#f6b77c', weight: 3, opacity: 0.25 }).addTo(map))
  const legLine = L.polyline([], { color: '#fff0ce', weight: 6, opacity: 0.95, lineCap: 'round' }).addTo(map)
  const homeLine = L.polyline([], { color: HOME_COLOR, weight: 4, opacity: 0.95, dashArray: '8 9' }).addTo(map)
  stops.forEach((stop, index) => {
    if (index > 0 && stop.type === 'home') return
    const kind = index === 0 ? 'is-home' : stop.is_bonus ? 'is-bonus' : ''
    const icon = L.divIcon({ className: 'walk-stop-icon', html: `<span class="walk-stop ${kind}">${index === 0 ? '⌂' : index}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] })
    const science = scienceStops.includes(stop) // tap a science stop to open its page
    const marker = L.marker(mapPoint(stop), { icon, interactive: science, keyboard: science, title: science ? `${stop.name}: open the science stop page` : '' }).addTo(map)
    if (science) marker.on('click', () => openPage('science', stop.id))
  })
  const shelterRing = L.circleMarker([0, 0], { radius: 22, color: '#ff7b6e', weight: 3, fill: false, dashArray: '4 5', interactive: false })
  const me = L.marker([0, 0], {
    icon: L.divIcon({ className: 'walk-me-icon', html: '<span class="walk-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 2000,
  }).addTo(map)
  map.on('dragstart', () => { follow = false; $('w-recenter').hidden = false })
  $('w-recenter').addEventListener('click', () => { follow = true; $('w-recenter').hidden = true; update() })

  // Pages: the map view, the Science stop page and the Data page. They are views of this same page
  // (#science/<stop id>, #data), so the walk keeps running and the phone's back button returns to the map.
  let view = 'main'
  let scienceId = null // the stop shown on the Science stop page
  let pushed = false // we added a history entry, so "Back to map" can go back
  let autoOpened = false // the Science stop page opened by itself when the crew arrived
  let openedFrom = null // focus returns here on the way back to the map
  let arrivalSeen = '' // the stop the crew last arrived at, so arriving opens its page only once
  let crewPoint = null // simulated position, for labelling photos

  function showView(hash) {
    const [name, rawId] = hash.replace(/^#/, '').split('/')
    const id = decodeURIComponent(rawId || '')
    view = name === 'data' ? 'data' : name === 'science' ? 'science' : 'main'
    if (view === 'science') scienceId = scienceStops.some((stop) => stop.id === id) ? id : photoStop(route, state)?.stop.id ?? null
    if (view !== 'science') autoOpened = false
    root.querySelector('.walk').dataset.view = view // the walk controls show on the map only (walk.css)
    $('w-main').hidden = view !== 'main'
    $('w-science-page').hidden = view !== 'science'
    $('w-data-page').hidden = view !== 'data'
    window.scrollTo(0, 0)
    update()
    ;(view === 'main' ? openedFrom : $(`w-${view}-title`))?.focus({ preventScroll: true })
  }
  function openPage(name, stopId = null, { auto = false } = {}) {
    openedFrom = auto ? null : document.activeElement
    autoOpened = auto
    pushed = true
    location.hash = name === 'science' && stopId ? `science/${encodeURIComponent(stopId)}` : name
  }
  function backToMap() {
    if (pushed) history.back()
    else { history.replaceState(null, '', location.pathname + location.search); showView('') }
  }
  window.addEventListener('hashchange', () => { if (!location.hash) pushed = false; showView(location.hash) })
  $('w-open-science').addEventListener('click', () => openPage('science', photoStop(route, state)?.stop.id))
  $('w-open-data').addEventListener('click', () => openPage('data'))
  root.querySelectorAll('[data-back]').forEach((button) => button.addEventListener('click', backToMap))
  $('w-scenario-new').addEventListener('click', () => { setScenario(randomSeed()); update() })
  $('w-scenario-off').addEventListener('click', () => { setScenario(null); update() })

  // Photos at a stop, saved on this device only (stopPhotos.js, IndexedDB). For the demo, "Take photo"
  // opens a simulated camera showing a made-up Mars landscape (fakeCamera.js, marsScene.js); with REAL_CAMERA it opens the phone's back camera
  // (capture="environment") or the gallery if there is no camera. Only errors show as text; a saved
  // photo just appears in "Your photos" (and is announced to screen readers).
  let shotUrls = []
  let shotsKey = ''
  let freshShotId = null // the photo just taken, so its thumbnail can pop in
  const shotStatus = (text, level = '') => { $('w-shot-status').textContent = text; $('w-shot-status').dataset.level = level }
  const currentScienceStop = () => scienceStops.find((item) => item.id === scienceId)
  async function keepPhoto(stop, blob, { simTimeMs = state.clockMs, position = crewPoint, generated = false } = {}) {
    const saved = await savePhoto({ blob, eva: mission.id, stopId: stop.id, stopName: stop.name, simTimeMs, position, generated })
    shotStatus('')
    $('w-announce').textContent = `Photo saved at ${utcTime(simTimeMs)} UTC.`
    freshShotId = saved.id
    shotsKey = ''
    renderShots(stop)
  }
  // The camera moment: the shutter blinks and flashes (walk.css), then the photo is in the list.
  function shutter() {
    const flash = $('w-shutter')
    flash.classList.remove('is-on')
    void flash.offsetWidth // restart the animation on quick repeat taps
    flash.classList.add('is-on')
  }
  $('w-shutter').addEventListener('animationend', () => $('w-shutter').classList.remove('is-on'))
  // The simulated camera: each stop has its own made-up view (the same seed every time). The shutter
  // flashes and the photo is saved with the mission time and position at that moment.
  function openCamera() {
    const stop = currentScienceStop()
    if (!stop) return
    openFakeCamera({
      seed: seedFromText(`${mission.id}:${stop.id}`),
      label: stop.name,
      onShot: async (blob) => {
        shutter()
        try { await keepPhoto(stop, blob, { generated: true }) }
        catch (error) { shotStatus(`Photo not saved: ${error.message}`, 'danger') }
      },
    })
  }
  $('w-shot-take').addEventListener('click', () => (REAL_CAMERA ? $('w-shot-camera').click() : openCamera()))
  if (REAL_CAMERA) {
    $('w-shot-pick').addEventListener('click', () => $('w-shot-gallery').click())
    for (const input of [$('w-shot-camera'), $('w-shot-gallery')]) {
      input.addEventListener('change', async () => {
        const file = input.files?.[0]
        input.value = ''
        const stop = currentScienceStop()
        if (!file || !stop) return
        shotStatus('Saving…')
        try { await keepPhoto(stop, file) }
        catch (error) { shotStatus(`Photo not saved: ${error.message}`, 'danger') }
      })
    }
  }

  // Thumbnails of this stop's photos, newest last, each with a way to keep a copy.
  async function renderShots(stop) {
    const key = `${mission.id}:${stop.id}`
    if (key === shotsKey) return
    shotsKey = key
    let list = []
    try { list = await photosFor(mission.id, stop.id) }
    catch (error) { shotStatus(`Photos can't be shown: ${error.message}`, 'danger'); return }
    if (shotsKey !== key) return // the page moved on to another stop meanwhile
    shotUrls.forEach((url) => URL.revokeObjectURL(url))
    shotUrls = list.map((record) => URL.createObjectURL(record.blob))
    const where = (record) => record.position ? ` · x ${Math.round(record.position.x)} m, y ${Math.round(record.position.y)} m` : ''
    const photosApp = window.Capacitor?.isPluginAvailable?.('MarsWayPhotos') ? window.Capacitor.Plugins.MarsWayPhotos : null
    const saveLabel = photosApp ? 'Save to Photos' : 'Download'
    $('w-shot-list').innerHTML = list.map((record, k) => `
      <li${record.id === freshShotId ? ' class="is-new"' : ''}><a class="walk-shot-open" href="${shotUrls[k]}" target="_blank" rel="noopener"><img src="${shotUrls[k]}" alt="${record.generated ? 'Simulated photo' : record.sampleCredit ? 'Sample photo' : 'Your photo'} at ${safe(record.stopName)}, ${utcTime(record.simTimeMs, true)} UTC" loading="lazy"></a>
        <span>${utcTime(record.simTimeMs, true)} UTC${where(record)}${record.generated ? '<br>Simulated photo' : record.sampleCredit ? `<br>Sample image: ${safe(record.sampleCredit)}` : ''}</span>
        <a class="walk-shot-save" href="${shotUrls[k]}" download="${safe(photoFileName(record))}" data-index="${k}">${saveLabel}</a></li>`).join('')
    $('w-shot-list').hidden = !list.length
    freshShotId = null
    // In the Android app, the page can't download files: save to the phone's Photos instead
    // (MarsWayPhotosPlugin.java).
    if (photosApp) {
      $('w-shot-list').querySelectorAll('.walk-shot-save').forEach((link) => link.addEventListener('click', async (event) => {
        event.preventDefault()
        const record = list[Number(link.dataset.index)]
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1])
            reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'))
            reader.readAsDataURL(record.blob)
          })
          await photosApp.savePhoto({ data, fileName: photoFileName(record), mimeType: record.type })
          shotStatus('Saved to the phone\'s Photos (MarsWay album).', 'ok')
        } catch (error) {
          shotStatus(`Not saved to Photos: ${error.message}`, 'danger')
        }
      }))
    }
  }

  // Simulation (advance() in walk-model.js moves the clock, the crew and the science time at stops)
  const atStop = () => state.mode === 'outbound' && state.progress === 0 && state.legIndex > 0

  $('w-primary').addEventListener('click', () => {
    if (state.mode === 'complete') {
      state = initialState()
      if (simAlert) state.solarStorms.push({ startMs: state.clockMs, endMs: null }) // storm still on for the new walk
    }
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
  // The crew really walks slower; the screen notices from the walking (walkPace), not from this switch.
  $('w-slow').addEventListener('click', () => { slowWalk = !slowWalk; state.simPace = slowWalk ? SLOW_PACE : 1; update() })
  $('w-storm').addEventListener('click', () => {
    simAlert = simAlert ? null : simulatedStorm(route)
    // Note when the storm starts and ends on the walk clock: the dose rate doubles in between.
    if (simAlert) state.solarStorms.push({ startMs: state.clockMs, endMs: null })
    else { const open = state.solarStorms.at(-1); if (open && open.endMs == null) open.endMs = state.clockMs }
    update()
  })

  // Map pop-ups: every notice (storm or other alert, turn back, arriving at a stop, hazards ahead,
  // the bonus GO / NO-GO) is a small pop-up pinned where it applies, instead of a text card.
  const popUp = (direction, offset) => L.tooltip({ permanent: true, direction, offset, opacity: 1, className: 'walk-pop' })
  const crewPop = popUp('top', [0, -14]) // alerts and turn back, on the crew
  const stopPop = popUp('bottom', [0, 14]) // the stop the crew is at
  const bonusPop = popUp('top', [0, -14]) // the bonus decision, on the bonus stop
  const popHtml = new Map()
  const hazardLayer = L.layerGroup().addTo(map)
  let hazards = [] // [{ spot, marker, pinned }] for the trip being walked
  let hazardsKey = ''
  let hazardLength = 1
  let announced = new Set()

  function showPop(pop, latlng, level, title, line = '') {
    if (!title) { if (map.hasLayer(pop)) pop.remove(); return null }
    const html = `<b>${safe(title)}</b>${line ? `<span>${safe(line)}</span>` : ''}`
    pop.setLatLng(latlng)
    if (popHtml.get(pop) !== html) { pop.setContent(html); popHtml.set(pop, html) }
    if (!map.hasLayer(pop)) pop.addTo(map)
    pop.getElement().dataset.level = level
    return { id: title, text: `${title}. ${line}` }
  }

  const alertName = (alert) => {
    const name = alert.warning ? `Solar storm in ${duration(Math.max(0, alert.startMs - state.clockMs) / 60000)}`
      : String(alert.type || 'alert').replaceAll('_', ' ')
    return `${alert.type === 'solar_storm' ? '☀︎ ' : '⚠︎ '}${name[0].toUpperCase()}${name.slice(1)}${alert.simulated ? ' (sim)' : ''}`
  }
  // Nigel's shelter route in a few words: "Head to Habitat (H1): walk 53m, +0.015 mSv extra".
  function shelterRouteLine(route) {
    if (route.atShelter) return `Stay inside ${route.shelter.name}`
    const outcome = route.beforeStorm ? 'inside before it starts' : `+${route.extraDoseMSv.toFixed(3)} mSv extra`
    return `Head to ${route.shelter.name}: walk ${duration(route.minutes)}, ${outcome}`
  }

  // The line under an alert's name in its map pop-up: what to do, and until when.
  function alertLine(alert, point, shelter) {
    const left = alert.endMs ? duration((alert.endMs - state.clockMs) / 60000) : ''
    if (alert.type === 'dust_storm') return `Walking slows to ${alert.event?.speedFactor ?? 0.6}×${alert.endMs ? ` until ${utcTime(alert.endMs)}` : ''}`
    if (alert.type === 'dust_devil') return `Stop and wait${left ? `, about ${left}` : ''}`
    if (alert.type === 'global_dust_storm') return 'NO-GO: walk cancelled'
    if (alert.type === 'rover_breakdown') return 'Use the walk-back plan'
    if (alert.type === 'solar_storm' && shelterNow) return shelterRouteLine(shelterNow)
    return shelterLine(point, shelter) // solar storm and route alerts: where to shelter
  }

  function shelterLine(point, shelter) {
    if (!shelter) return 'No shelter nearby'
    const metres = segmentLength(point, shelter)
    if (metres < 1) return `Shelter here: ${shelter.name}`
    return `Go to ${shelter.name}, ${distance(metres)} ${cardinal(bearing(point, shelter))}`
  }

  // Hazard signs for the leg being walked, at the worst spot of each planner warning on it.
  function placeHazards(trip) {
    const key = `${state.mode}:${state.legIndex}`
    if (key === hazardsKey) return
    hazardsKey = key
    hazardLayer.clearLayers()
    hazardLength = Math.max(1, pathLength(trip.path))
    hazards = state.mode === 'complete' ? [] : hazardSpots(grid, trip).map((spot) => {
      const steep = spot.type === 'steep_slope'
      const icon = L.divIcon({ className: 'walk-stop-icon', html: `<span class="walk-hazard is-${safe(spot.level)}"><i>${steep ? '!' : '≈'}</i></span>`, iconSize: [24, 24], iconAnchor: [12, 12] })
      const marker = L.marker(mapPoint(spot.point), { icon, keyboard: false, zIndexOffset: -1000, title: steep ? 'Steep ground' : 'Rough ground' }).addTo(hazardLayer)
      marker.bindTooltip('', { permanent: true, direction: 'right', offset: [12, 0], opacity: 1, className: 'walk-pop' }).closeTooltip()
      const hazard = { spot, marker, pinned: false, title: steep ? 'Steep ground' : 'Rough ground' }
      marker.on('click', () => { hazard.pinned = !hazard.pinned; update() }) // tap a sign to show or hide it
      return hazard
    })
  }

  // While walking, the most serious sign within 300 m ahead (or just passed) opens by itself, one at
  // a time so pop-ups don't pile up. Any sign opens with a tap.
  function renderHazards() {
    const walked = state.progress * hazardLength
    const notes = []
    const onTheMove = state.mode !== 'complete' && !atStop()
    const near = hazards.filter((hazard) => onTheMove && hazard.spot.along - walked >= -25 && hazard.spot.along - walked <= 300)
    const rank = (hazard) => (hazard.spot.level === 'danger' ? 0 : hazard.spot.level === 'caution' ? 1 : 2)
    const auto = near.sort((a, b) => rank(a) - rank(b) || Math.abs(a.spot.along - walked) - Math.abs(b.spot.along - walked))[0]
    for (const hazard of hazards) {
      const ahead = hazard.spot.along - walked
      const tooltip = hazard.marker.getTooltip()
      if (hazard !== auto && !hazard.pinned) { hazard.marker.closeTooltip(); continue }
      const line = ahead > 25 ? `${distance(ahead)} ahead` : ahead >= -25 ? 'Here, take care' : 'Passed'
      const html = `<b>${hazard.title}</b><span>${line}</span>`
      if (tooltip.getContent() !== html) tooltip.setContent(html)
      if (!hazard.marker.isTooltipOpen()) hazard.marker.openTooltip()
      tooltip.getElement().dataset.level = hazard.spot.level
      if (hazard === auto) notes.push({ id: hazard.title, text: `${hazard.title}. ${line}` })
    }
    return notes
  }

  function renderNotices(trip, point, safety, bonus) {
    const notes = []
    // On the crew: the most serious alert (storm first), else "turn back" when the suit time is short.
    const alerts = sortWarnings(currentAlerts())
    const alert = state.mode === 'complete' ? null : alerts[0]
    const shelter = alert ? shelterFor(route, alert) : null
    let crewLevel = ''
    if (alert) {
      crewLevel = alert.level
      notes.push(showPop(crewPop, mapPoint(point), alert.level, alertName(alert), alertLine(alert, point, shelter)))
    } else if (safety.level === 'danger' && state.mode !== 'complete') {
      crewLevel = 'danger'
      notes.push(showPop(crewPop, mapPoint(point), 'danger', safety.title, `Home ${duration(safety.homeMinutes)}`))
    } else showPop(crewPop)
    if (shelter && alert.level !== 'info') shelterRing.setLatLng(mapPoint(shelter)).addTo(map)
    else shelterRing.remove()
    $('w-map-card').dataset.level = crewLevel

    // On a stop: arriving, the science countdown, then "walk on"; and "home" at the end.
    const scienceLeft = state.scienceLeft || 0
    if (atStop()) {
      const here = trip.from
      notes.push(showPop(stopPop, mapPoint(here), here.is_bonus ? 'caution' : 'info', here.name,
        scienceLeft ? `Science, ${duration(scienceLeft)} left` : 'Science done, walk on'))
    } else if (state.mode === 'complete') {
      notes.push(showPop(stopPop, mapPoint(trip.to), 'ok', 'Back home', 'EVA complete'))
    } else showPop(stopPop)

    // On the bonus stop, while it is the next stop: GO, tight or NO-GO from Mia's check.
    if (bonus?.phase === 'ahead' && bonus.decideNow && Number.isFinite(bonus.spareMinutes)) {
      const tight = bonus.go && bonus.level === 'caution'
      notes.push(showPop(bonusPop, mapPoint(bonus.stop), bonus.go ? (tight ? 'caution' : 'ok') : 'danger',
        `Bonus ${bonus.go ? (tight ? 'tight' : 'GO') : 'NO-GO'}`,
        bonus.spareMinutes >= 0 ? `${duration(bonus.spareMinutes)} to spare` : `Skip it, uses ${duration(-bonus.spareMinutes)} of reserve`))
    } else showPop(bonusPop)

    notes.push(...renderHazards())
    // Read each new pop-up aloud once for screen readers (the map itself is a picture to them).
    const shown = notes.filter(Boolean)
    const fresh = shown.filter((note) => !announced.has(note.id))
    announced = new Set(shown.map((note) => note.id))
    if (fresh.length) $('w-announce').textContent = fresh.map((note) => note.text).join(' ')
  }

  // Turn-by-turn steps for the trip being walked (Nigel's directionsFor), worked out once per trip.
  let stepsPath = null
  let steps = null
  function tripSteps(trip) {
    if (trip.path === stepsPath) return steps
    stepsPath = trip.path
    const toName = trip.to.type === 'home' ? stops[0].name : trip.to.name // "Arrive at Habitat (H1)", not "at Return to Habitat"
    try { steps = directionsFor(grid, trip, { toName }) }
    catch (error) { steps = null; console.warn(`No turn-by-turn directions for this leg (${error.message}).`) }
    return steps
  }

  function renderTurn(trip, complete) {
    const line = complete ? null : directionLine(tripSteps(trip), state.progress * pathLength(trip.path))
    const turn = $('w-turn')
    turn.hidden = !line
    if (!line) return
    const keep = (text) => safe(text).replace(/(\d) (k?m)\b/g, '$1&nbsp;$2') // "700 m" never splits across lines
    const html = `<b>${keep(line.lead)}</b>${keep(line.rest)}`
    if (turn.innerHTML !== html) turn.innerHTML = html
  }

  // Arrival times at the stops after the next one, and home (Nigel's etaFor, at the measured pace).
  // Stop numbers match the map. Home turns amber when it would use the reserve, red past the suit limit.
  function renderTimes(arrivals) {
    const later = state.mode === 'outbound' ? arrivals.stops.slice(1) : []
    const times = $('w-times')
    times.hidden = !later.length
    if (!later.length) return
    const suitEnd = Date.parse(mission.start_time) + mission.max_walk_minutes * 60000
    const reserveFrom = suitEnd - mission.reserve_minutes * 60000
    const chips = later.map((stop, k) => {
      const index = state.legIndex + 2 + k
      const home = index === stops.length - 1
      const level = home ? (stop.arrive_ms > suitEnd ? 'danger' : stop.arrive_ms > reserveFrom ? 'caution' : '') : ''
      const mark = home ? '<i class="walk-stop is-home">⌂</i>' : `<i class="walk-stop${stop.is_bonus ? ' is-bonus' : ''}">${index}</i>`
      const label = home
        ? `Home ${utcTime(stop.arrive_ms)} UTC${level ? `, ${duration((stop.arrive_ms - reserveFrom) / 60000)} into the reserve` : ''}`
        : `${stop.name} ${utcTime(stop.arrive_ms)} UTC`
      return `<span class="walk-time${level ? ` is-${level}` : ''}" title="${safe(label)}" aria-label="${safe(label)}">${mark}${utcTime(stop.arrive_ms)}</span>`
    }).join('')
    const html = `<span class="walk-times-label">Then</span>${chips}`
    if (times.innerHTML !== html) times.innerHTML = html
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
    applyEventEffects() // after every change of clock or scenario, so the times shown include a dust devil wait
    try { updateView() } catch (error) { stopOnRouteError(error) }
  }

  function updateView() {
    const trip = currentTrip(route, state)
    const { point, nextIndex } = pointAlong(trip.path, state.progress)
    crewPoint = point
    updateShelter(point) // before the alerts: a storm warning is one of them
    const remainingPath = [point, ...trip.path.slice(nextIndex)]
    const ahead = trip.path.slice(nextIndex).find((p) => p.x !== point.x || p.y !== point.y)
    const pace = walkPace(state)
    const leftMinutes = trip.walk_minutes * (1 - state.progress) * pace
    const arrivals = arrivalTimes(route, state)
    let safety = safetyStatus(route, state, state.clockMs, navigation)
    // A danger alert (e.g. a solar storm) outranks the suit-time status.
    const urgent = sortWarnings(currentAlerts()).find((a) => a.level === 'danger')
    if (urgent && state.mode !== 'complete') {
      const shelter = shelterFor(route, urgent)
      safety = urgent.type === 'global_dust_storm'
        ? { ...safety, level: 'danger', title: 'Walk cancelled', message: 'Global dust storm: NO-GO. Stay in the habitat.' }
        : { ...safety, level: 'danger', title: shelter ? `Go to shelter: ${shelter.name}` : 'Danger alert', message: shelter?.id === stops[0].id ? 'Shelter is the habitat. Use Head home to follow the planned return path.' : 'See the alert on the map.' }
      // A solar storm: Nigel's message, e.g. "Solar storm in 20 min. Head to Habitat (H1) now: walk 53 min. …"
      if (urgent.type === 'solar_storm' && shelterNow) {
        safety = { ...safety, title: urgent.warning ? `${alertName(urgent).replace(' (sim)', '')}: go to shelter` : safety.title, message: shelterNow.message }
      }
    }
    // A dust storm or dust devil under way also shows in the status line (seen from every page), unless
    // something more serious is already there.
    const randomNow = state.mode !== 'complete' && sortWarnings(currentAlerts()).find((a) => a.event && a.level === 'caution')
    if (randomNow && safety.level === 'ok') safety = { ...safety, level: 'caution', title: randomNow.event.title, message: randomNow.message }
    const complete = state.mode === 'complete'

    $('w-clock').textContent = utcTime(state.clockMs, true)

    const status = $('w-status')
    status.className = `walk-status is-${safety.level}`
    status.innerHTML = `<span class="walk-status-icon">${safety.level === 'ok' ? '✓' : safety.level === 'info' ? '⌂' : '!'}</span><strong>${safe(safety.title)}</strong><span class="walk-sr">${safe(safety.message)}</span>${isSample ? '<span class="walk-sim" title="Simulated clock, suit budget and position on terrain route estimates. Not live navigation.">Simulation</span>' : ''}`
    status.title = safety.message

    const scienceLeft = state.scienceLeft || 0
    const waitLeft = complete ? 0 : state.waitLeft || 0 // a dust devil: standing still while the clock runs
    $('w-next-label').textContent = complete ? 'EVA COMPLETE' : state.mode === 'return' ? 'HEADING HOME' : trip.to.is_bonus ? 'NEXT STOP · BONUS' : 'NEXT STOP'
    $('w-next-name').textContent = trip.to.name
    $('w-phase').textContent = complete ? 'Done'
      : waitLeft ? `${state.playing ? 'Waiting' : 'Paused'} · dust devil ${duration(waitLeft)}`
      : scienceLeft ? `${state.playing ? 'Science' : 'Paused'} · ${duration(scienceLeft)} left`
        : state.playing ? 'Walking' : state.progress === 0 ? `At ${trip.from.name}` : 'Paused'
    $('w-distance').textContent = complete ? 'Arrived' : distance(trip.distance_m * (1 - state.progress))
    if (ahead && !complete) {
      const deg = bearing(point, ahead)
      $('w-arrow').style.transform = `rotate(${deg}deg)`
      $('w-arrow').toggleAttribute('hidden', false)
      $('w-arrow').parentElement.title = `Heading ${cardinal(deg)}, ${Math.round(deg)}°`
    } else {
      $('w-arrow').toggleAttribute('hidden', true)
      $('w-arrow').parentElement.title = ''
    }
    const arrive = arrivals.stops[0]?.arrive_ms ?? state.clockMs
    const slower = Math.round((pace - 1) * 100)
    $('w-eta').innerHTML = complete ? 'Back at the habitat'
      : `${waitLeft ? `${duration(waitLeft)} wait + ` : ''}${scienceLeft ? `${duration(scienceLeft)} science + ` : ''}${duration(leftMinutes)} walk · arrive ${utcTime(arrive)}${slower >= 5
        ? ` <span class="walk-pace" title="Walking about ${slower}% slower than planned over the last few minutes. All times here use this pace.">${slower}% slower</span>` : ''}`
    renderTurn(trip, complete)
    renderTimes(arrivals)

    // Turn-back = suit deadline − reserve − time home from here, so it shrinks faster while walking away.
    const outbound = state.mode === 'outbound'
    const turnbackIn = safety.turnbackIn
    $('w-turnback').textContent = outbound ? (turnbackIn > 0 ? duration(turnbackIn) : 'NOW') : '—'
    $('w-turnback-by').textContent = outbound
      ? (turnbackIn > 0 ? `by ${utcTime(state.clockMs + turnbackIn * 60000)} UTC` : 'head home now')
      : complete ? 'walk finished' : 'heading home'
    $('w-turnback-tile').className = `walk-tile ${outbound && turnbackIn <= 0 ? 'is-danger' : outbound && turnbackIn <= 30 ? 'is-caution' : ''}`
    $('w-home').textContent = complete ? '0m' : duration(safety.homeMinutes)
    $('w-reserve').textContent = `${duration(safety.reserveAtHome)} suit left at home`
    // The main safety number stays on the map view; the full tiles are on the Data page.
    const turnbackLine = $('w-turnback-line')
    turnbackLine.hidden = !outbound
    turnbackLine.dataset.level = outbound && turnbackIn <= 0 ? 'danger' : outbound && turnbackIn <= 30 ? 'caution' : ''
    turnbackLine.innerHTML = turnbackIn > 0
      ? `Turn back in <b>${duration(turnbackIn)}</b> · by ${utcTime(state.clockMs + turnbackIn * 60000)} UTC`
      : '<b>Turn back now</b> · head home'

    // At a stop: how the crew is doing against the planned times, and the demo "+30m here" button.
    $('w-stop-row').hidden = !atStop()
    const behind = minutesBehindPlan(route, state, state.clockMs) ?? 0
    $('w-plan').textContent = behind < 0.5 ? 'On schedule' : `${duration(behind)} behind schedule`
    $('w-plan').classList.toggle('is-late', behind >= 0.5)
    let bonus
    try { bonus = bonusStatus(route, state, state.clockMs, { grid, timeHome: navigation.timeHome }) }
    catch (error) { bonus = { phase: 'error', error } }
    renderBonus(bonus)
    renderRadiation()

    // Science stop page: opens by itself when the crew arrives at a stop, and goes back to the map
    // when they walk on (only if it opened by itself). The Science button names the stop it opens.
    const arrivedAt = atStop() && scienceStops.includes(trip.from) ? trip.from.id : ''
    if (arrivedAt && arrivedAt !== arrivalSeen && view === 'main') openPage('science', arrivedAt, { auto: true })
    if (!arrivedAt && autoOpened && view === 'science') { autoOpened = false; backToMap() }
    arrivalSeen = arrivedAt
    const nextStop = photoStop(route, state)
    $('w-science-hint').textContent = nextStop ? `${nextStop.here ? 'Here' : 'Next'}: ${nextStop.stop.name}` : 'Tap a stop on the map'
    const alertsOn = complete ? [] : sortWarnings(currentAlerts())
    $('w-data-hint').textContent = alertsOn.length ? `${alertName(alertsOn[0])}${alertsOn[0].warning ? '' : ' on'}` : scenario ? scenario.label : 'Radiation, storms, terrain'
    $('w-open-data').dataset.level = alertsOn[0]?.level ?? ''
    if (view === 'science') renderScience()

    // Map
    legLine.setLatLngs(complete ? [] : remainingPath.map(mapPoint))
    // In a solar storm the dashed line home is Nigel's shelter route, in the danger colour.
    const shelterPath = shelterNow ? shelterNow.legs.flatMap((leg) => leg.path) : null
    const homePath = complete ? [] : shelterPath ?? (state.mode === 'return' ? remainingPath : buildReturnTrip(route, state, navigation).path)
    homeLine.setLatLngs(homePath.map(mapPoint))
    const homeColor = shelterPath ? SHELTER_COLOR : HOME_COLOR
    if (homeLine.options.color !== homeColor) homeLine.setStyle({ color: homeColor })
    $('w-map-card').dataset.shelter = shelterPath ? 'on' : ''
    me.setLatLng(mapPoint(point))
    if (follow) map.panTo(mapPoint(point), { animate: false })
    placeHazards(trip)
    renderNotices(trip, point, safety, bonus)
    if (view === 'data') renderData(trip, point, alertsOn)

    // Buttons
    const primary = $('w-primary')
    primary.textContent = complete
      ? '↺ Restart simulation'
      : state.playing ? '❚❚ Pause'
        : scienceLeft ? `▶\uFE0E Resume science · ${duration(scienceLeft)} left`
          : state.progress > 0 ? '▶\uFE0E Resume'
            : state.mode === 'return' ? '▶\uFE0E Start walking home' : `▶\uFE0E Walk to ${trip.to.name}`
    primary.classList.toggle('is-paused', state.playing)
    // A global dust storm (random events) means NO-GO: the walk can't start.
    const cancelled = Boolean(scenario?.cancelled) && state.mode === 'outbound' && state.legIndex === 0 && state.progress === 0
    primary.disabled = cancelled
    if (cancelled) { primary.textContent = '✕ Walk cancelled: global dust storm'; state.playing = false }
    const homeBtn = $('w-home-btn')
    homeBtn.disabled = !canHeadHome(route, state)
    const armed = Date.now() <= homeArmedUntil
    homeBtn.textContent = armed ? 'Tap again to head home' : '⌂ Head home'
    homeBtn.classList.toggle('is-armed', armed)
    $('w-speed').textContent = `${SPEEDS[speedIndex]}×`
    $('w-slow').textContent = slowWalk ? '✕ Slow' : 'Slow'
    $('w-slow').setAttribute('aria-pressed', String(slowWalk))
    $('w-storm').textContent = simAlert ? '✕ Storm' : '☀︎ Storm'
    $('w-storm').setAttribute('aria-pressed', String(Boolean(simAlert)))
  }

  // Bonus stop GO / NO-GO from Mia's check. Before the stop it answers "if we keep to the plan".
  function renderBonus(bonus) {
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

  // Science stop page: only the camera and this stop's photos (the stop the crew is at, the next stop
  // while walking, or the stop tapped on the map).
  function renderScience() {
    const stop = currentScienceStop() ?? null
    $('w-photo-none').hidden = Boolean(stop)
    $('w-photo-none').textContent = state.mode === 'outbound' ? 'Tap a stop on the map to see its science page.' : 'No science stops on the way home. Tap a stop on the map to see its photos.'
    $('w-shots').hidden = !stop
    if (!stop) return
    if (stop.id !== photoKey) { photoKey = stop.id; shotStatus('') } // a new stop: clear an old error
    renderShots(stop)
  }

  // Radiation counter: dose so far (×2 while a solar storm is on), next to the dose for the whole
  // walking budget at the normal rate (0.17 mSv for 6 h).
  function renderRadiation() {
    const dose = radiationDose(route, state.clockMs, solarStorms())
    const hours = Number.isInteger(dose.walkHours) ? `${dose.walkHours}h` : duration(dose.walkHours * 60)
    // 3 decimals so the faster climb during a short storm shows (0.006 → 0.009, not 0.00 → 0.01).
    $('w-rad').textContent = `${dose.soFarMSv.toFixed(3)} mSv`
    // Once a solar storm has been on, say how long and how much it added (dose rate ×2 meanwhile).
    // Kept short so it fits on one line on a phone.
    $('w-rad-note').textContent = dose.stormMinutes > 0
      ? `☀︎ ${duration(dose.stormMinutes)} storm, +${dose.stormExtraMSv.toFixed(3)} mSv`
      : `full ${hours} walk: ${dose.fullWalkMSv.toFixed(2)} mSv`
  }

  // Data page: radiation, storms and alerts, and the terrain, in numbers and words. The map keeps its
  // pop-ups; this page has the detail behind them.
  let groundPath = null
  let groundLeg = null
  // Under an alert's full text on the Data page: where to shelter (solar storm, route alerts), or until when.
  function dataAlertLine(alert, point) {
    if (alert.type === 'solar_storm' && shelterNow) return shelterNow.message // Nigel's whole message
    if (!alert.event || alert.type === 'solar_storm') return shelterLine(point, shelterFor(route, alert))
    return alert.endMs ? `Until ${utcTime(alert.endMs)} UTC` : ''
  }

  function renderData(trip, point, alerts) {
    const set = (id, html) => { const element = $(id); if (element.innerHTML !== html) element.innerHTML = html }
    const rows = (list) => list.map(([label, value, level = '']) => `<dt>${label}</dt><dd${level ? ` data-level="${level}"` : ''}>${value}</dd>`).join('')

    const dose = radiationDose(route, state.clockMs, solarStorms())
    const hours = Number.isInteger(dose.walkHours) ? `${dose.walkHours}h` : duration(dose.walkHours * 60)
    const stormNow = state.mode !== 'complete' && solarStorms().some((storm) => storm.startMs <= state.clockMs && (storm.endMs == null || storm.endMs > state.clockMs))
    set('w-data-rad', rows([
      ['So far', `${dose.soFarMSv.toFixed(3)} mSv`],
      ['Dose rate now', `${(RAD_SURFACE_MSV_PER_DAY * (stormNow ? SOLAR_STORM_FACTOR : 1)).toFixed(2)} mSv a day${stormNow ? ` · storm ×${SOLAR_STORM_FACTOR}` : ''}`, stormNow ? 'danger' : ''],
      ['In solar storms', dose.stormMinutes > 0 ? `${duration(dose.stormMinutes)} · +${dose.stormExtraMSv.toFixed(3)} mSv` : 'none yet'],
      [`Full ${hours} walk`, `${dose.fullWalkMSv.toFixed(2)} mSv at the normal rate`],
    ]))

    set('w-data-alerts', `${alerts.length
      ? `<ul class="walk-alert-list">${alerts.map((alert) => `<li data-level="${safe(alert.level)}"><b>${safe(alertName(alert))}</b><span>${safe(alert.message)}</span><span>${safe(dataAlertLine(alert, point))}</span></li>`).join('')}</ul>`
      : '<p class="walk-page-empty">No storms or other alerts right now.</p>'}
      <p class="walk-data-source">A solar storm doubles the radiation dose rate but doesn't slow walking. The habitat is the shelter.</p>`)

    // Random events: the scenario number, and the events so far (not the ones still to come).
    $('w-scenario-label').textContent = scenario ? `${scenario.label}${scenario.calm ? ' · calm day' : ''}` : 'Random events off'
    $('w-scenario-new').textContent = scenario ? '🎲 New scenario' : '🎲 Random events'
    $('w-scenario-off').hidden = !scenario
    const started = scenario ? scenario.events.filter((event) => event.startMin <= minutesOut()) : []
    const log = started.map((event) => {
      const at = Date.parse(mission.start_time) + event.startMin * 60000
      const over = event.durationMin != null && event.startMin + event.durationMin <= minutesOut()
      return `<li><b>${utcTime(at)}</b> ${safe(event.title)}${event.durationMin != null ? ` · ${duration(event.durationMin)}` : ''}${over ? ' · over' : ' · now'}</li>`
    }).join('')
    set('w-scenario-log', log)
    $('w-scenario-log').hidden = !log

    const { slopeWarnDeg, slopeNoGoDeg, roughWarnDeg } = grid.suit
    const here = groundAt(grid, point)
    if (groundPath !== trip.path) { groundPath = trip.path; groundLeg = trip.path.length > 1 ? pathGround(grid, trip.path) : null }
    const slopeText = (deg) => `${Math.round(deg)}°${deg > slopeNoGoDeg ? ' · no-go' : deg > slopeWarnDeg ? ' · steep' : ''}`
    const slopeLevel = (deg) => (deg > slopeNoGoDeg ? 'danger' : deg > slopeWarnDeg ? 'caution' : '')
    set('w-data-ground', rows([
      ...(here ? [
        ['Height here', `${Math.round(here.heightM).toLocaleString('en-GB')} m <small>(Mars datum)</small>`],
        ...(here.slopeDeg == null ? [] : [['Slope here', slopeText(here.slopeDeg), slopeLevel(here.slopeDeg)]]),
        ...(here.roughDeg == null ? [] : [['Roughness here', `${here.roughDeg.toFixed(1)}°${here.roughDeg > roughWarnDeg ? ' · rough' : ''}`, here.roughDeg > roughWarnDeg ? 'caution' : '']]),
      ] : []),
      ...(groundLeg ? [
        [state.mode === 'return' ? 'Way home' : 'This leg', `${distance(trip.distance_m)} · up ${Math.round(groundLeg.climbM)} m, down ${Math.round(groundLeg.descentM)} m`],
        ['Steepest on it', slopeText(groundLeg.steepestDeg), slopeLevel(groundLeg.steepestDeg)],
      ] : []),
      ['Suit limits', `steep over ${slopeWarnDeg}°, no-go over ${slopeNoGoDeg}°, rough over ${roughWarnDeg}°`],
    ]))
    // The planner's warnings for this leg, with how far ahead the worst spot is (the signs on the map).
    const walked = state.progress * hazardLength
    const warnings = state.mode === 'complete' ? [] : trip.warnings || []
    set('w-data-hazards', warnings.length ? warnings.map((warning) => {
      const spot = hazards.find((hazard) => hazard.spot.type === warning.type)?.spot
      const gap = spot ? spot.along - walked : null
      const where = gap == null ? '' : gap > 25 ? ` · ${distance(gap)} ahead` : gap >= -25 ? ' · here' : ' · passed'
      const title = warning.type === 'steep_slope' ? 'Steep ground' : warning.type === 'rough_ground' ? 'Rough ground' : String(warning.type || 'Note').replaceAll('_', ' ')
      return `<li data-level="${safe(warning.level)}"><b>${safe(title)}${where}</b><span>${safe(warning.message)}</span></li>`
    }).join('') : `<li>${state.mode === 'complete' ? 'Walk complete.' : 'No steep or rough ground on this leg.'}</li>`)
  }

  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    const wasPlaying = state.playing
    if (wasPlaying) {
      applyEventEffects() // a dust storm slows the crew, a dust devil stops them (the clock runs on)
      advance(route, state, ((now - last) / 60000) * SPEEDS[speedIndex])
    }
    last = now
    // Redraw while walking, on the tick that arrives at a stop, and while "head home" is armed.
    const armExpired = homeArmedUntil && Date.now() > homeArmedUntil
    if (armExpired) homeArmedUntil = 0
    if (wasPlaying || homeArmedUntil || armExpired) update()
  }, TICK_MS)

  update()
  // The map container's size settles after fonts, layout and phone toolbars; re-measure whenever it changes.
  new ResizeObserver(() => { map.invalidateSize(); update() }).observe($('w-map'))
  if (location.hash) showView(location.hash) // opened straight on #data or #science/<stop>
}

root.innerHTML = '<div class="walk-loading">Loading the walk route…</div>'
// Mia's pre-calculated way home saves the phone a search. Without it, the terrain is enough.
// Each habitat has its own file (public/safezone/home-<habitat>-6km.*); scenarios.json says which habitat this EVA uses.
const habitat = loadScenarioCatalog()
  .then((catalog) => catalog.scenarios.find((item) => item.eva === (eva || '07'))?.habitat ?? 'H1')
  .catch(() => 'H1')
const homeFile = habitat
  .then((id) => loadHomeFile(`/safezone/home-${id.toLowerCase()}-6km`))
  .catch((error) => {
    console.warn(`Home file unavailable (${error.message}). Working out the way home on the phone.`)
    return null
  })
Promise.all([loadRouteForEva(eva), homeFile, habitat])
  .then(([{ route, grid }, file, id]) => {
    if (route.mission.drive_out_minutes) throw new Error(`${route.mission.id} includes a rover drive, which the Walk screen does not model yet. Open it on the Planning screen.`)
    assertRoute(route)
    const navigation = createTerrainNavigation(route, grid, { homeFile: file })
    if (file && navigation.source !== 'home file') console.warn(`Home file does not match this terrain, so the phone worked out the way home itself. Rebuild it: node src/safezone/buildHomeFile.js --home <x,y> --id ${id} --out home-${id.toLowerCase()}-6km`)
    start(route, navigation, grid)
  })
  .catch((error) => { root.innerHTML = `<div class="walk-loading is-error"><h1>Unable to load the route</h1><p>${safe(error.message)}</p><p><a href="${withScenario(planningHref, scenarioFromSearch(location.search))}">Back to Planning</a></p></div>` })
