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

const duration = (minutes) => {
  if (!Number.isFinite(minutes)) return 'Unavailable'
  const value = Math.max(0, Math.round(minutes))
  return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}m` : `${value}m`
}

export function mountPlanningSafety({ root, map, grid, route }) {
  const layer = L.layerGroup().addTo(map)
  const stormLine = L.polyline([], { color: '#ff7b6e', weight: 5, dashArray: '7 5' })
  const probeMarker = L.circleMarker([0, 0], { radius: 5, color: '#ffffff', fillColor: '#24343a', fillOpacity: 1 })
  let selected = route.stops[0]
  let latest = 0
  let result = null
  let stormShown = false
  let worker = null
  root.classList.add('planning-safety')
  root.innerHTML = `
    <span class="eyebrow">PLANNING SCENARIO / SIMULATED</span>
    <h2>Can we still get home?</h2>
    <p class="ps-note">Crew reference: <strong id="ps-reference"></strong>. Select a route stop to move this reference. These controls do not change the Walk screen's clock.</p>
    <form class="ps-form">
      <label>Elapsed suit time (hours)<input id="ps-elapsed" type="number" min="0" step="0.25" value="0" required></label>
      <label>Time at a candidate stop (min)<input id="ps-stop" type="number" min="0" max="120" step="1" value="20" required></label>
      <button type="submit">Update safe zone</button>
      <button id="ps-storm" type="button" aria-pressed="false" disabled>Simulate storm route</button>
    </form>
    <p id="ps-status" class="ps-status" role="status" aria-live="polite">Calculating safety estimates...</p>
    <div class="ps-summary">
      <div><small>HOME FROM REFERENCE</small><strong id="ps-home">Calculating</strong><small>Terrain-grid estimate</small></div>
      <div><small>TURN BACK IN</small><strong id="ps-turnback">Calculating</strong><small>Before protected reserve</small></div>
      <div><small>SUIT TIME LEFT AT HOME</small><strong id="ps-reserve">Calculating</strong><small>Includes protected reserve</small></div>
      <div><small>ELAPSED SURFACE DOSE</small><strong id="ps-dose">Calculating</strong><small>Baseline model estimate</small></div>
    </div>
    <div class="ps-legend"><span><i style="background:#46c878"></i>Green: 30+ min before reserve</span><span><i style="background:#f0af3c"></i>Amber: under 30 min, reserve protected</span><span><i style="background:#ff7068"></i>Red: return uses reserve</span><span>Transparent: outside suit budget or unreachable</span></div>
    <p id="ps-probe" class="ps-probe" role="status">Click the map to inspect spare time at a candidate point.</p>
    <p id="ps-storm-note" class="ps-storm-note" role="status"></p>
    <p id="ps-budget" class="ps-note"></p>
    <p class="ps-note">The zone includes the candidate-stop duration. The turn-back timer does not include an extra stop. Radiation uses Mia's 0.67 mSv/day baseline; storm effects and shielding are not modelled.</p>`
  const $ = (id) => root.querySelector(`#${id}`)
  const form = root.querySelector('form')
  $('ps-elapsed').max = String(route.mission.max_walk_minutes / 60)
  $('ps-budget').textContent = `Suit budget: ${duration(route.mission.max_walk_minutes)}; protected reserve: ${duration(route.mission.reserve_minutes)}. No live suit or position feed.`
  const metric = document.querySelector('#planning-turnback')
  const metricLabel = document.querySelector('#planning-turnback-note')

  function clearResult(label) {
    result = null
    layer.clearLayers()
    stormLine.remove()
    probeMarker.remove()
    for (const id of ['ps-home', 'ps-turnback', 'ps-reserve', 'ps-dose']) $(id).textContent = label
    $('ps-storm').disabled = true
    if (metric) metric.textContent = label
    $('ps-probe').textContent = 'Click the map to inspect spare time after calculation.'
    $('ps-storm-note').textContent = ''
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
      ? `SIMULATED storm route to H1: ${(result.storm.distance_m / 1000).toFixed(2)} km, ${duration(result.storm.seconds / 60)}. This is a modelled return route, not a live storm alert or shelter certification.`
      : 'SIMULATED storm: the reference is already in H1\'s grid cell.'
  }
  function calculate() {
    // Invalidate an in-flight worker response even if the edited scenario is invalid.
    const id = ++latest
    if (!form.reportValidity()) { error('Check the elapsed time and stop duration.'); return }
    const elapsedMinutes = Number($('ps-elapsed').value) * 60
    const stopMinutes = Number($('ps-stop').value)
    clearResult('Calculating')
    $('ps-status').dataset.level = 'info'
    $('ps-status').textContent = 'Calculating the safe-to-go zone from this reference...'
    if (!worker) { error('The background safety worker could not start.'); return }
    worker.postMessage({ type: 'calculate', id, scenario: { position: { x: selected.x, y: selected.y }, elapsedMinutes, stopMinutes } })
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); calculate() })
  form.addEventListener('input', () => {
    ++latest
    clearResult('Update needed')
    $('ps-status').dataset.level = 'info'
    $('ps-status').textContent = 'Scenario changed. Press Update safe zone to recalculate.'
  })
  $('ps-storm').addEventListener('click', () => {
    stormShown = !stormShown
    $('ps-storm').setAttribute('aria-pressed', String(stormShown))
    drawStorm()
  })
  const probe = ({ latlng }) => {
    if (!result) return
    const cell = xyToCell(grid, latlng.lng, latlng.lat)
    if (cell < 0) { $('ps-probe').textContent = 'Outside the terrain grid.'; probeMarker.remove(); return }
    probeMarker.setLatLng(latlng).addTo(map)
    const spare = result.spareMinutes[cell]
    const band = result.zone[cell] === ZONE.SAFE ? result.spareMinutes[cell] < 30 ? 'Amber: reserve protected, under 30 min spare' : 'Green: reserve protected' : result.zone[cell] === ZONE.RESERVE ? 'Red: uses reserve' : 'Outside suit budget'
    $('ps-probe').textContent = Number.isFinite(spare)
      ? `${band}: ${spare.toFixed(1)} min spare before protected reserve after reaching this point, stopping ${result.stopMinutes} min and returning to H1.`
      : 'This point cannot be reached from the reference or cannot return to H1.'
  }
  map.on('click', probe)
  try {
    worker = new Worker(new URL('./planningWorker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') return
      if (data.id !== 0 && data.id !== latest) return
      if (data.type === 'error') { ++latest; error(data.message); return }
      if (data.type !== 'result') return
      result = data.result
      layer.clearLayers()
      L.imageOverlay(spareOverlayUrl(result, grid), [[0, 0], [grid.sizeY, grid.sizeX]], { opacity: 0.85, interactive: false }).addTo(layer)
      $('ps-home').textContent = duration(result.timer.homeMinutes)
      $('ps-turnback').textContent = result.timer.turnbackIn > 0 ? duration(result.timer.turnbackIn) : 'NOW'
      $('ps-reserve').textContent = result.reserveAtHomeMinutes >= 0 ? duration(result.reserveAtHomeMinutes) : `${duration(-result.reserveAtHomeMinutes)} short`
      $('ps-dose').textContent = `${result.elapsedDoseMSv.toFixed(3)} mSv`
      $('ps-status').dataset.level = result.timer.level
      $('ps-status').textContent = `${result.timer.title}: ${result.timer.message}`
      $('ps-storm').disabled = false
      if (metric) metric.textContent = $('ps-turnback').textContent
      if (metricLabel) metricLabel.textContent = `From ${selected.name} at simulated elapsed time`
      $('ps-probe').textContent = 'Click the map to inspect spare time. Green has a wide margin, amber is tight, and red uses the reserve.'
      drawStorm()
    }
    worker.onerror = () => error('The background safety worker failed. Reload and check the browser console.')
    worker.postMessage({ type: 'init', id: 0, grid, habitat: route.stops[0], mission: route.mission })
  } catch (failure) { worker = null; error(failure.message) }
  window.addEventListener('pagehide', () => { worker?.terminate(); map.off('click', probe) }, { once: true })
  return {
    layer,
    selectStop(stop) {
      selected = stop
      $('ps-reference').textContent = stop.name
      calculate()
    },
  }
}
