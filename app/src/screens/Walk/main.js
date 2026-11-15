import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './walk.css'
import { loadRouteForEva, loadScenarioCatalog } from '../../terrainRoute.js'
import { createTerrainNavigation } from '../../terrainNavigation.js'
import { loadHomeFile } from '../../safezone/homeFile.js'
import { stopMetadata } from '../../stopDetails.js'
import { directionsFor } from '../../pathfinding/directions.js'
import {
  ALERT_LEVELS, advance, arrivalTimes, bearing, bonusStatus, buildReturnTrip, canHeadHome, cardinal, currentTrip, directionLine,
  hazardSpots, headHome, minutesBehindPlan, pathLength, photoDistance, photoStop, pointAlong, radiationDose, safetyStatus, segmentLength,
  shelterFor, sortWarnings, walkPace,
} from './walk-model.js'

const root = document.querySelector('#walk')
// ?eva=09 etc. picks the scenario, as on the Planning screen. No ?eva is EVA-07.
const eva = new URLSearchParams(location.search).get('eva')
const planningHref = eva ? `/?eva=${encodeURIComponent(eva)}` : '/'
const SPEEDS = [1, 60, 300] // simulated minutes per real minute
const TICK_MS = 250
const STAY_MINUTES = 30 // demo button: the crew stays this much longer at a stop
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

  root.innerHTML = `
    <div class="walk">
      <header class="walk-top">
        <a class="walk-brand" href="${planningHref}" aria-label="MarsWay — back to Planning"><span class="walk-brand-mark"><img src="/marsway-mark.svg" alt="" width="28" height="28"></span>MARS<span>WAY</span></a>
        <div class="walk-mission"><span>${safe(mission.id)}</span><strong id="w-clock">--:--:--</strong><small>UTC</small></div>
      </header>

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
        <div class="walk-legend"><span class="walk-legend-line"></span>This leg<span class="walk-legend-dash"></span>Path home<span class="walk-hazard is-caution walk-legend-sign"><i>!</i></span>Hazard</div>
      </section>
      <p id="w-announce" class="walk-sr" aria-live="assertive"></p>

      <section class="walk-tiles" aria-label="Turn-back timer, time home, bonus stop and radiation">
        <div class="walk-tile" id="w-turnback-tile"><span>TURN BACK IN</span><strong id="w-turnback">–</strong><small id="w-turnback-by">–</small></div>
        <div class="walk-tile"><span>HOME FROM HERE</span><strong id="w-home">–</strong><small id="w-reserve">–</small></div>
        <div class="walk-tile" id="w-bonus-tile" hidden><span>BONUS STOP</span><strong id="w-bonus">–</strong><small id="w-bonus-note">–</small></div>
        <div class="walk-tile" id="w-rad-tile" title="Estimate: about 0.67 mSv a day on the surface at Gale Crater, measured by Curiosity's RAD instrument (Hassler et al. 2014). Doubled during a solar storm (team assumption from the September 2017 event). Not a measured personal dose."><span>RADIATION SO FAR</span><strong id="w-rad">–</strong><small id="w-rad-note">–</small></div>
      </section>

      <section id="w-photo" class="walk-photo" aria-label="Photo and task for this stop" hidden></section>

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
    const name = String(alert.type || 'alert').replaceAll('_', ' ')
    return `${alert.type === 'solar_storm' ? '☀︎ ' : '⚠︎ '}${name[0].toUpperCase()}${name.slice(1)}${alert.simulated ? ' (sim)' : ''}`
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
    const alerts = sortWarnings([...(route.alerts || []), ...(simAlert ? [simAlert] : [])])
    const alert = state.mode === 'complete' ? null : alerts[0]
    const shelter = alert ? shelterFor(route, alert) : null
    let crewLevel = ''
    if (alert) {
      crewLevel = alert.level
      notes.push(showPop(crewPop, mapPoint(point), alert.level, alertName(alert), shelterLine(point, shelter)))
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
    try { updateView() } catch (error) { stopOnRouteError(error) }
  }

  function updateView() {
    const trip = currentTrip(route, state)
    const { point, nextIndex } = pointAlong(trip.path, state.progress)
    const remainingPath = [point, ...trip.path.slice(nextIndex)]
    const ahead = trip.path.slice(nextIndex).find((p) => p.x !== point.x || p.y !== point.y)
    const pace = walkPace(state)
    const leftMinutes = trip.walk_minutes * (1 - state.progress) * pace
    const arrivals = arrivalTimes(route, state)
    let safety = safetyStatus(route, state, state.clockMs, navigation)
    // A danger alert (e.g. a solar storm) outranks the suit-time status.
    const urgent = [...(route.alerts || []), ...(simAlert ? [simAlert] : [])].find((a) => a.level === 'danger')
    if (urgent && state.mode !== 'complete') {
      const shelter = shelterFor(route, urgent)
      safety = { ...safety, level: 'danger', title: shelter ? `Go to shelter: ${shelter.name}` : 'Danger alert', message: shelter?.id === stops[0].id ? 'Shelter is the habitat. Use Head home to follow the planned return path.' : 'See the alert on the map.' }
    }
    const complete = state.mode === 'complete'

    $('w-clock').textContent = utcTime(state.clockMs, true)

    const status = $('w-status')
    status.className = `walk-status is-${safety.level}`
    status.innerHTML = `<span class="walk-status-icon">${safety.level === 'ok' ? '✓' : safety.level === 'info' ? '⌂' : '!'}</span><strong>${safe(safety.title)}</strong><span class="walk-sr">${safe(safety.message)}</span>${isSample ? '<span class="walk-sim" title="Simulated clock, suit budget and position on terrain route estimates. Not live navigation.">Simulation</span>' : ''}`
    status.title = safety.message

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
      $('w-arrow').parentElement.title = `Heading ${cardinal(deg)}, ${Math.round(deg)}°`
    } else {
      $('w-arrow').toggleAttribute('hidden', true)
      $('w-arrow').parentElement.title = ''
    }
    const arrive = arrivals.stops[0]?.arrive_ms ?? state.clockMs
    const slower = Math.round((pace - 1) * 100)
    $('w-eta').innerHTML = complete ? 'Back at the habitat'
      : `${scienceLeft ? `${duration(scienceLeft)} science + ` : ''}${duration(leftMinutes)} walk · arrive ${utcTime(arrive)}${slower >= 5
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
    renderPhoto()

    // Map
    legLine.setLatLngs(complete ? [] : remainingPath.map(mapPoint))
    const homePath = complete ? [] : state.mode === 'return' ? remainingPath : buildReturnTrip(route, state, navigation).path
    homeLine.setLatLngs(homePath.map(mapPoint))
    me.setLatLng(mapPoint(point))
    if (follow) map.panTo(mapPoint(point), { animate: false })
    placeHazards(trip)
    renderNotices(trip, point, safety, bonus)

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

  // Photo and task for the stop the crew is at, or the next stop while walking (Kelly's stop data,
  // read through the Planning screen's stopMetadata so both screens show the same credits).
  function renderPhoto() {
    const current = photoStop(route, state)
    const key = current ? `${current.stop.id}:${current.here}` : ''
    if (key === photoKey) return
    photoKey = key
    const panel = $('w-photo')
    panel.hidden = !current
    if (!current) { panel.replaceChildren(); return }
    const { stop, here } = current
    const meta = stopMetadata(stop, window.location.href)
    const metres = photoDistance(stop) // only when it is known for this photo
    const away = metres === null ? '' : `, about ${metres} m away`
    const shot = [meta.sol ? `Sol ${meta.sol}` : null, meta.camera].filter(Boolean).join(' · ')
    panel.innerHTML = `
      <div class="walk-photo-head"><span class="walk-eyebrow">${here ? 'AT THIS STOP' : 'COMING UP'}</span>${meta.bonus ? '<span class="walk-photo-badge">OPTIONAL BONUS</span>' : ''}</div>
      <h2>${safe(meta.name)}</h2>
      ${stop.why ? `<p class="walk-photo-task"><b>TASK</b>${safe(stop.why)}${meta.visitMinutes ? ` <span>${meta.visitMinutes} min</span>` : ''}</p>` : ''}
      ${meta.photo ? `<figure>
        <img alt="${safe(meta.caption || `Photo near ${meta.name}`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        <p class="walk-photo-missing" hidden>Photo could not load.</p>
        <figcaption>${meta.nearby ? `<strong class="walk-photo-nearby">Nearby view${away}</strong>` : ''}
          ${shot ? `${safe(shot)} · ` : ''}Image: ${safe(meta.credit || 'credit pending')}${meta.source ? ` · <a href="${safe(meta.source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ''}</figcaption>
      </figure>` : '<p class="walk-photo-missing">No photo for this stop yet.</p>'}
      <details><summary>More about this stop</summary><p>${safe(meta.description)}</p>${meta.caption ? `<p>${safe(meta.caption)}</p>` : ''}</details>`
    const image = panel.querySelector('img')
    if (!image) return
    image.addEventListener('error', () => { image.hidden = true; panel.querySelector('.walk-photo-missing').hidden = false }, { once: true })
    image.src = meta.photo // set after the listener, so a failed load is always shown
  }

  // Radiation counter: dose so far (×2 while a solar storm is on), next to the dose for the whole
  // walking budget at the normal rate (0.17 mSv for 6 h).
  function renderRadiation() {
    const dose = radiationDose(route, state.clockMs, state.solarStorms)
    const hours = Number.isInteger(dose.walkHours) ? `${dose.walkHours}h` : duration(dose.walkHours * 60)
    // 3 decimals so the faster climb during a short storm shows (0.006 → 0.009, not 0.00 → 0.01).
    $('w-rad').textContent = `${dose.soFarMSv.toFixed(3)} mSv`
    // Once a solar storm has been on, say how long and how much it added (dose rate ×2 meanwhile).
    // Kept short so it fits on one line on a phone.
    $('w-rad-note').textContent = dose.stormMinutes > 0
      ? `☀︎ ${duration(dose.stormMinutes)} storm, +${dose.stormExtraMSv.toFixed(3)} mSv`
      : `full ${hours} walk: ${dose.fullWalkMSv.toFixed(2)} mSv`
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
  .catch((error) => { root.innerHTML = `<div class="walk-loading is-error"><h1>Unable to load the route</h1><p>${safe(error.message)}</p><p><a href="${planningHref}">Back to Planning</a></p></div>` })
