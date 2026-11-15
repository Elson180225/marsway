import L from 'leaflet'
import './planningPanel.css'
import { xyToCell } from '../pathfinding/walkingTime.js'
import { zoneToPixels, ZONE } from './safeZone.js'

// Colour Mia's bands by the remaining margin: green is comfortable, amber is
// under 30 min before reserve, and red means returning would use the reserve.
function spareOverlayUrl(result, grid) {
  const { width, height, data } = zoneToPixels(result.zone, grid)
  for (let i = 0; i < result.zone.length; i++) {
    const offset = i * 4
    if (result.zone[i] === ZONE.RESERVE) data.set([255, 112, 104], offset)
    else if (result.zone[i] === ZONE.SAFE && result.spareMinutes[i] < 30) data.set([240, 175, 60], offset)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0)
  return canvas.toDataURL('image/png')
}

// Short label for Mia's bonus-stop verdict: 'ok' GO, 'caution' GO but tight, 'danger' NO-GO.
const verdictLabel = (check) => check.level === 'danger' ? 'NO-GO' : check.level === 'caution' ? 'GO (tight)' : 'GO'

const duration = (minutes) => {
  if (!Number.isFinite(minutes)) return 'Unavailable'
  const value = Math.max(0, Math.round(minutes))
  return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`
}

export function mountPlanningSafety({ root, map, grid, route, onOverlayChange = () => {} }) {
  const layer = L.layerGroup().addTo(map)
  const stormLine = L.polyline([], { color: '#ff7b6e', weight: 5, dashArray: '7 5' })
  const probeMarker = L.circleMarker([0, 0], { radius: 5, color: '#ffffff', fillColor: '#24343a', fillOpacity: 1 })
  let selected = route.stops[0]
  const homeLabel = route.mission.home_label ?? 'H1'
  let latest = 0
  let result = null
  let stormShown = false
  let weather = null
  let worker = null
  let probeId = 0
  const bonus = route.stops.find((stop) => stop.is_bonus)
  const bonusStop = bonus ? { x: bonus.x, y: bonus.y, name: bonus.name, stopMinutes: Number.isFinite(bonus.stop_minutes) ? bonus.stop_minutes : undefined } : null
  root.classList.add('planning-safety')
  root.innerHTML = `
    <span class="eyebrow">PLANNING SCENARIO / SIMULATED</span>
    <h2>Can we still get home?</h2>
    <p class="ps-note">Reference: <strong id="ps-reference"></strong>. Select a route stop to change it.</p>
    <form class="ps-form">
      <label>Elapsed suit time (hours)<input id="ps-elapsed" type="number" min="0" step="any" value="${(route.mission.drive_out_minutes ?? 0) / 60}" required></label>
      <label>Time at a candidate stop (min)<input id="ps-stop" type="number" min="0" max="120" step="1" value="20" required></label>
      <button type="submit">Update safe zone</button>
    </form>
    <p id="ps-status" class="ps-status" role="status" aria-live="polite">Calculating safety estimates...</p>
    <div id="ps-bonus" class="ps-bonus" role="status" aria-live="polite" hidden></div>
    <div class="ps-summary">
      <div title="Time home from the selected route stop, calculated on the terrain grid."><small>TIME HOME</small><strong id="ps-home">Calculating</strong></div>
      <div><small>TURN BACK IN</small><strong id="ps-turnback">Calculating</strong><small>Before protected reserve</small></div>
      <div title="Suit time remaining on arrival home, including the protected reserve."><small>SUIT LEFT AT HOME</small><strong id="ps-reserve">Calculating</strong></div>
      <div title="Estimate from Curiosity RAD baseline (0.67 mSv/day) for the time already out, not a measured personal dose. Dust-storm simulation changes walking time only; radiation effects and shielding are not modelled."><small>DOSE SO FAR</small><strong id="ps-dose">Calculating</strong></div>
    </div>
    <div class="ps-legend" aria-label="Safe zone legend"><span title="30 or more minutes before reserve"><i style="background:#46c878"></i>30m+ spare</span><span title="Less than 30 min before reserve"><i style="background:#f0af3c"></i>&lt;30m</span><span title="Return uses protected reserve"><i style="background:#ff7068"></i>Reserve</span></div>
    <p id="ps-probe" class="ps-probe" role="status">Tap map for GO / NO-GO.</p>
    <p id="ps-storm-note" class="ps-storm-note" role="status"></p>
    <p id="ps-budget" class="ps-note"></p>
    <p class="ps-note">Map colours include the candidate-stop time; turn-back excludes it. Transparent areas are unreachable or outside the suit budget. Walk uses its own simulated clock.</p>`
  // The form moves to the desktop sidebar after mounting; its controls remain
  // part of this planner even when they are no longer descendants of root.
  const $ = (id) => document.getElementById(id)
  const form = root.querySelector('form')
  $('ps-elapsed').max = String(route.mission.max_walk_minutes / 60)
  $('ps-budget').textContent = `Suit budget: ${duration(route.mission.max_walk_minutes)}; protected reserve: ${duration(route.mission.reserve_minutes)}.${route.mission.drive_home_minutes ? ` ${route.mission.id} includes an assumed ${duration(route.mission.drive_home_minutes)} suited drive each way; ${homeLabel} is not storm shelter. Elapsed time starts after the outbound drive.` : ''} No live suit or position feed.`
  const metric = document.querySelector('#planning-turnback')

  function clearResult(label) {
    result = null
    layer.clearLayers()
    onOverlayChange(null)
    stormLine.remove()
    probeMarker.remove()
    for (const id of ['ps-home', 'ps-turnback', 'ps-reserve', 'ps-dose']) $(id).textContent = label
    if (metric) metric.textContent = label
    ++probeId
    $('ps-bonus').hidden = true
    paintBonusChips(null)
    $('ps-probe').textContent = 'Tap map for spare time.'
    $('ps-storm-note').textContent = ''
  }
  function paintBonusChips(check) {
    document.querySelectorAll('[data-bonus-verdict]').forEach((chip) => {
      chip.textContent = check ? `BONUS · ${verdictLabel(check)}` : 'BONUS'
      if (check) chip.dataset.level = check.level
      else delete chip.dataset.level
    })
  }
  function showBonus(check) {
    const box = $('ps-bonus')
    if (!check) { box.hidden = true; return }
    box.hidden = false
    box.dataset.level = check.level
    box.innerHTML = '<small>PLANNED BONUS STOP / GO-NO-GO</small><strong></strong><span></span>'
    box.querySelector('strong').textContent = `${check.name}: ${verdictLabel(check)}`
    box.querySelector('span').textContent = check.spareMinutes == null
      ? check.message
      : `${Math.round(check.walkThereMinutes)} + ${check.stopMinutes} + ${Math.round(check.homeFromBonusMinutes)} min · ${check.spareMinutes < 0 ? `${Math.round(-check.spareMinutes)} min into reserve` : `${Math.round(check.spareMinutes)} min spare`}`
    box.title = `From ${selected.name}: ${check.message}`
    paintBonusChips(check)
  }
  function error(message) {
    clearResult('Unavailable')
    $('ps-status').dataset.level = 'danger'
    $('ps-status').textContent = `Safety estimate unavailable: ${message}`
  }
  function drawStorm() {
    stormLine.remove()
    $('ps-storm-note').textContent = ''
    if (!stormShown || !result) return
    if (!result.storm) { $('ps-storm-note').textContent = 'SIMULATED storm: no return path available.'; return }
    const path = result.storm.path
    if (path.length > 1) stormLine.setLatLngs(path.map((p) => [p.y, p.x])).addTo(map)
    $('ps-storm-note').textContent = path.length > 1
      ? `SIMULATED storm route to ${route.mission.drive_home_minutes ? `${homeLabel} rover, then assumed ${duration(route.mission.drive_home_minutes)} drive to ${route.mission.habitat_label ?? 'H1'}` : homeLabel}: ${(result.storm.distance_m / 1000).toFixed(2)} km, ${duration(result.storm.seconds / 60)} on foot. This is a modelled return route, not a live storm alert or shelter certification.`
      : `SIMULATED storm: the reference is already in ${homeLabel}'s grid cell.`
  }
  // A scenario that cancels the walk (global dust storm): no safe zone, just the NO-GO.
  let cancelled = null
  function showCancelled() {
    ++latest // drop any calculation already running
    result = null
    clearResult('NO-GO')
    probeMarker.remove()
    $('ps-status').dataset.level = 'danger'
    $('ps-status').textContent = `NO-GO: walk cancelled. ${cancelled}`
    $('ps-status').title = $('ps-status').textContent
    $('ps-probe').textContent = 'No safe zone: the walk does not go ahead.'
  }
  function calculate() {
    if (cancelled) { showCancelled(); return }
    // Invalidate an in-flight worker response even if the edited scenario is invalid.
    const id = ++latest
    if (!form.reportValidity()) { error('Check the elapsed time and stop duration.'); return }
    const elapsedMinutes = Number($('ps-elapsed').value) * 60
    const stopMinutes = Number($('ps-stop').value)
    clearResult('Calculating')
    $('ps-status').dataset.level = 'info'
    $('ps-status').textContent = 'Calculating the safe-to-go zone from this reference...'
    if (!worker) { error('The background safety worker could not start.'); return }
    worker.postMessage({ type: 'calculate', id, scenario: { position: { x: selected.x, y: selected.y }, elapsedMinutes, stopMinutes, bonusStop, weather } })
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); calculate() })
  form.addEventListener('input', () => {
    ++latest
    clearResult('Update needed')
    $('ps-status').dataset.level = 'info'
    $('ps-status').textContent = 'Scenario changed. Press Update safe zone to recalculate.'
  })
  // Solar storms and their shelter route now come from the random events (planningEvents.js),
  // so there is no hand-made storm route button any more. stormShown stays false.
  const probe = ({ latlng }) => {
    if (!result) return
    // Inspect one GO / NO-GO at a time: a clicked point replaces the bonus card.
    $('ps-bonus').hidden = true
    const cell = xyToCell(grid, latlng.lng, latlng.lat)
    if (cell < 0) { $('ps-probe').textContent = 'Outside the terrain grid.'; probeMarker.remove(); return }
    probeMarker.setLatLng(latlng).addTo(map)
    const spare = result.spareMinutes[cell]
    const band = result.zone[cell] === ZONE.SAFE ? result.spareMinutes[cell] < 30 ? 'Amber: reserve protected, under 30 min spare' : 'Green: reserve protected' : result.zone[cell] === ZONE.RESERVE ? 'Red: uses reserve' : 'Outside suit budget'
    const zoneText = Number.isFinite(spare)
      ? `${band}: ${spare.toFixed(1)} min spare before protected reserve after reaching this point, stopping ${result.stopMinutes} min and returning to ${homeLabel}.`
      : `This point cannot be reached from the reference or cannot return to ${homeLabel}.`
    $('ps-probe').dataset.level = ''
    $('ps-probe').textContent = 'Selected map point: checking GO / NO-GO...'
    const id = ++probeId
    // Same stop time and suit time as the zone on screen, so the verdict matches the colour.
    worker.postMessage({ type: 'bonus', id, scenario: { position: result.position, bonus: { x: latlng.lng, y: latlng.lat }, elapsedMinutes: result.elapsedMinutes, stopMinutes: result.stopMinutes, weather } })
    probeText = zoneText
  }
  let probeText = ''
  function showProbe(data) {
    if (data.id !== probeId || !result) return
    const probe = $('ps-probe')
    if (data.type === 'error') { probe.textContent = `Selected map point: unavailable (${data.message})`; return }
    probe.dataset.level = data.check.level
    probe.textContent = `Selected map point: ${verdictLabel(data.check)}${data.check.spareMinutes == null ? '' : data.check.spareMinutes < 0 ? ` · ${Math.round(-data.check.spareMinutes)} min into reserve` : ` · ${Math.round(data.check.spareMinutes)} min spare`}`
    probe.title = `${data.check.message} ${probeText}`
  }
  map.on('click', probe)
  try {
    worker = new Worker(new URL('./planningWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready' || cancelled) return
      if (data.type === 'bonus' || data.request === 'bonus') { showProbe(data); return }
      if (data.id !== 0 && data.id !== latest) return
      if (data.type === 'error') { ++latest; error(data.message); return }
      if (data.type !== 'result') return
      result = data.result
      layer.clearLayers()
      const overlayUrl = spareOverlayUrl(result, grid)
      L.imageOverlay(overlayUrl, [[0, 0], [grid.sizeY, grid.sizeX]], { opacity: 0.85, interactive: false }).addTo(layer)
      onOverlayChange(overlayUrl)
      $('ps-home').textContent = duration(result.timer.homeMinutes)
      $('ps-turnback').textContent = result.timer.turnbackIn > 0 ? duration(result.timer.turnbackIn) : 'NOW'
      $('ps-reserve').textContent = result.reserveAtHomeMinutes >= 0 ? duration(result.reserveAtHomeMinutes) : `${duration(-result.reserveAtHomeMinutes)} short`
      $('ps-dose').textContent = `${result.elapsedDoseMSv.toFixed(2)} mSv`
      $('ps-status').dataset.level = result.timer.level
      $('ps-status').textContent = result.timer.level === 'ok' ? '✓ On plan: home with reserve intact' : `${result.timer.title}: ${result.timer.message}`
      $('ps-status').title = `${result.timer.title}: ${result.timer.message}`
      if (metric) metric.textContent = $('ps-turnback').textContent
      $('ps-probe').dataset.level = ''
      $('ps-probe').textContent = 'Tap map for GO / NO-GO.'
      showBonus(result.bonusCheck)
      drawStorm()
    }
    worker.onerror = () => error('The background safety worker failed. Reload and check the browser console.')
    worker.postMessage({ type: 'init', id: 0, grid, habitat: route.stops[0], mission: route.mission })
  } catch (failure) { worker = null; error(failure.message) }
  window.addEventListener('pagehide', () => { worker?.terminate(); map.off('click', probe) }, { once: true })
  return {
    layer,
    setWeather(scenario) {
      weather = scenario
      calculate()
    },
    selectStop(stop) {
      selected = stop
      $('ps-reference').textContent = stop.name
      calculate()
    },
    // Planning calls this when the random events cancel the walk (reason: one line for the status).
    setCancelled(reason) {
      cancelled = reason || 'The walk does not go ahead.'
      showCancelled()
    },
  }
}
