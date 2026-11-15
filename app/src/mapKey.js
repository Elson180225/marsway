// Map key for the Planning map: what every line, marker and colour means.
// It follows the LAYERS buttons (their aria-pressed), so it always explains what is on screen,
// in 2D and in 3D. Colours are the ones the layers really use:
//   slope.png       scripts/prepare_terrain.py (green < 10°, yellow 10–15°, orange 15–25°, red > 25°)
//   roughness       roughnessImage() in terrainRoute.js (orange, stronger = rougher, full at 20°)
//   safe zone       safezone/planningPanel.js (green, amber under 30 min spare, red uses the reserve)
//   lines/markers   main.js and planningPanel.js
// The orbital science layers keep their own note (scienceLayerInfo.js), so they are only pointed to here.

const SCIENCE = { ctx: 'CTX photo', crismHyd: 'CRISM hydrated', crismAlt: 'CRISM alteration', themis: 'THEMIS night' }

/**
 * The key's sections for the layers that are on. Pure data, so Node can test it.
 *   active     Set of layer keys switched on ('terrain', 'slope', 'roughness', 'safety', 'ctx', …)
 *   roverMode  true in "With rover" (the start marker is the rover, and there is a drive line)
 *   elevation  { min, max } in metres, for the basemap colours (optional)
 * Returns [{ title, rows: [{ swatch, label }] }]. swatch: { kind: 'line' | 'dash' | 'box' | 'marker' | 'ramp', colour, … }
 */
export function mapKeySections({ active, roverMode = false, elevation = null }) {
  const sections = [{
    title: 'Route',
    rows: [
      { swatch: { kind: 'marker', colour: '#91d5c7', text: '⌂' }, label: roverMode ? 'Rover parking: the walk starts and ends here' : 'Habitat: start, end and shelter' },
      { swatch: { kind: 'marker', colour: '#f3bd83', text: '1' }, label: 'Science stops, in visiting order (click one for details)' },
      { swatch: { kind: 'line', colour: '#f6b77c' }, label: 'Planned walking route' },
      { swatch: { kind: 'dash', colour: '#8ce0d6' }, label: 'Way home from the selected stop' },
      ...(roverMode ? [{ swatch: { kind: 'dash', colour: '#e0b485' }, label: 'Rover drive between the habitat and the parking spot' }] : []),
      { swatch: { kind: 'dash', colour: '#ff7b6e' }, label: 'Storm route home (when "Storm route" is on)' },
    ],
  }]

  if (active.has('terrain')) {
    sections.push({
      title: 'Basemap',
      rows: [{ swatch: { kind: 'ramp', colours: ['#2a1410', '#8f4424', '#d99a62', '#efd1a3'] },
        label: elevation ? `Height: dark = low (${Math.round(elevation.min)} m), light = high (${Math.round(elevation.max)} m). Shading shows the shape of the ground.` : 'Height: dark = low ground, light = high ground. Shading shows the shape of the ground.' }],
    })
  }
  if (active.has('slope')) {
    sections.push({
      title: 'Slope (steepness)',
      rows: [
        { swatch: { kind: 'box', colour: '#33bf59' }, label: 'Under 10°: easy walking' },
        { swatch: { kind: 'box', colour: '#f2d933' }, label: '10–15°: harder; still OK for the rover' },
        { swatch: { kind: 'box', colour: '#fa8c26' }, label: '15–25°: steep, caution on foot; too steep for the rover' },
        { swatch: { kind: 'box', colour: '#e62626' }, label: 'Over 25°: no-go, routes never cross it' },
      ],
    })
  }
  if (active.has('roughness')) {
    sections.push({
      title: 'Roughness',
      rows: [{ swatch: { kind: 'ramp', colours: ['rgba(242,172,80,0.05)', 'rgba(242,172,80,0.4)', 'rgba(242,172,80,0.75)'] },
        label: 'Clear = smooth ground; stronger orange = rockier and slower to walk. Over 8° shows as a rough-ground note on the route.' }],
    })
  }
  if (active.has('safety')) {
    sections.push({
      title: 'Safe zone (from the safety-check point and time)',
      rows: [
        { swatch: { kind: 'box', colour: '#46c878' }, label: 'Green: you can go here, do the stop and get home with 30+ min spare before the reserve' },
        { swatch: { kind: 'box', colour: '#f0af3c' }, label: 'Amber: still safe, but under 30 min spare' },
        { swatch: { kind: 'box', colour: '#ff7068' }, label: 'Red: getting home would use the protected reserve' },
        { swatch: { kind: 'box', colour: 'transparent' }, label: 'No colour: can’t be reached, or outside the suit time' },
        { swatch: { kind: 'marker', colour: '#24343a', text: '', ring: '#ffffff', small: true }, label: 'White dot: the map point you clicked to check' },
      ],
    })
  }
  const science = Object.keys(SCIENCE).filter((key) => active.has(key))
  if (science.length) {
    sections.push({ title: 'Orbital layer', rows: [{ swatch: { kind: 'box', colour: 'transparent' }, label: `${science.map((key) => SCIENCE[key]).join(', ')}: colours, credit and source in the note below` }] })
  }
  return sections
}

function swatchElement(swatch) {
  const el = document.createElement('span')
  el.className = `map-key-swatch is-${swatch.kind}`
  el.setAttribute('aria-hidden', 'true')
  if (swatch.kind === 'ramp') el.style.background = `linear-gradient(90deg, ${swatch.colours.join(', ')})`
  else if (swatch.kind === 'line' || swatch.kind === 'dash') el.style.setProperty('--key-colour', swatch.colour)
  else el.style.background = swatch.colour
  if (swatch.kind === 'marker') {
    el.textContent = swatch.text
    if (swatch.ring) el.style.borderColor = swatch.ring
    if (swatch.small) el.classList.add('is-small')
  }
  return el
}

/**
 * Put the key under the Planning map and keep it in step with the LAYERS buttons.
 * panel: the .map-panel element. Replaces the old two-item legend in .map-footer.
 */
export function mountMapKey(panel, { route, grid }) {
  let elevation = null
  if (grid?.elevation?.length) {
    let min = Infinity
    let max = -Infinity
    for (const h of grid.elevation) { if (h < min) min = h; if (h > max) max = h }
    elevation = { min, max }
  }
  const roverMode = Boolean(route.mission.drive_out_minutes)
  const details = document.createElement('details')
  details.className = 'map-key'
  // Open on desktop; on phones start folded so the map stays on screen (tap "Map key" to open).
  details.open = !window.matchMedia?.('(max-width: 850px)').matches
  const summary = document.createElement('summary')
  summary.textContent = 'Map key'
  const body = document.createElement('div')
  body.className = 'map-key-body'
  details.append(summary, body)

  const oldLegend = panel.querySelector('.map-footer > div')
  if (oldLegend) oldLegend.replaceChildren() // its two lines are now in the key
  const footer = panel.querySelector('.map-footer')
  if (footer) footer.after(details)
  else panel.append(details)

  const buttons = [...panel.querySelectorAll('[data-layer]')]
  const render = () => {
    const active = new Set(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.layer))
    body.replaceChildren(...mapKeySections({ active, roverMode, elevation }).map(({ title, rows }) => {
      const section = document.createElement('section')
      const heading = document.createElement('h3')
      heading.textContent = title
      const list = document.createElement('ul')
      for (const { swatch, label } of rows) {
        const item = document.createElement('li')
        const text = document.createElement('span')
        text.textContent = label
        item.append(swatchElement(swatch), text)
        list.append(item)
      }
      section.append(heading, list)
      return section
    }))
  }
  const watcher = new MutationObserver(render)
  for (const button of buttons) watcher.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] })
  render()
  return { render }
}
