import { weatherScenario } from './planningWeather.js'
import { calculateMissionSchedule, renderMissionSchedule } from './missionSchedule.js'
import { randomEvents, randomSeed } from './safezone/randomEvents.js'
import { plannedCsv, downloadCsv } from './planningCsv.js'
import './planningScenario.css'

export function mountPlanningScenario(container, route, onChange) {
  const controls = document.createElement('div')
  controls.className = 'planning-scenario-controls'
  controls.innerHTML = `<form class="psc-form">
    <label>Weather scenario
      <select name="weather"><option value="none">Clear-weather estimate</option><option value="storm">Simulated dust storm</option></select>
    </label>
    <label>Storm starts (UTC)<input name="start" type="time" value="10:30" disabled required></label>
    <label>Previous career dose (mSv, optional)<input name="career" type="number" min="0" max="10000" step="0.001" inputmode="decimal" placeholder="Not entered"></label>
    <button type="submit">Update plan</button>
    <button type="button" id="random-events-btn">🎲 Random Events</button>
  </form>
  <div id="random-events-panel" class="random-events-panel" hidden>
    <h3 id="random-scenario-title">🎲 Random Events</h3>
    <p id="random-scenario-status"></p>
    <div id="random-events-list"></div>
  </div>

  <details class="psc-info"><summary>ⓘ How these estimates work</summary><p class="psc-note">Demo assumption: walking speed becomes 0.6× after the selected time. Dust-storm simulation changes walking time only; radiation effects and shielding are not modelled. The Walk screen is unaffected.</p><small class="psc-note">RAD baseline estimate (0.67 mSv/day), not a measured personal dose. These are planned events; visited stops and bonus completion are unknown. The running total uses the previous career dose only if you enter one.</small></details><div class="psc-export"><button type="button" data-export="summary">Download planned summary CSV</button><button type="button" data-export="timeline">Download planned timeline CSV</button></div>
  `
  const output = document.createElement('div')
  container.replaceChildren(controls, output)
  const form = controls.querySelector('form')

  const randomButton = controls.querySelector('#random-events-btn')
  const randomPanel = controls.querySelector('#random-events-panel')
  const randomTitle = controls.querySelector('#random-scenario-title')
  const randomStatus = controls.querySelector('#random-scenario-status')
  const randomList = controls.querySelector('#random-events-list')

  function showRandomScenario(seed) {
    const params = new URLSearchParams(window.location.search)
    const version = params.get('travel') === 'rover' ? 'rover' : 'foot'

    // Temporary duration for UI testing.
    // Replace with the shared planned walk duration before final integration.
    const durationMinutes = Math.max(60, route.mission.max_walk_minutes)

    const generated = randomEvents({
      seed,
      eva: route.mission.id.replace('EVA-', ''),
      version,
      durationMinutes
    })

    params.set('scenario', String(seed))
    window.history.replaceState({}, '', window.location.pathname + '?' + params)

    randomPanel.hidden = false
    randomTitle.textContent = '🎲 ' + generated.label

    randomStatus.textContent = generated.cancelled
      ? '⛔ NO-GO — Mission cancelled'
      : generated.calm
        ? '✅ Calm day — No random events'
        : generated.events.length + ' event(s) generated'

    randomList.replaceChildren()

    for (const event of generated.events) {
      const item = document.createElement('div')
      item.className = 'random-event-item'

      const title = document.createElement('strong')
      title.textContent = event.title + ' — +' + event.startMin + ' min'

      const message = document.createElement('p')
      message.textContent = event.message

      item.append(title, message)
      randomList.append(item)
    }
  }

  randomButton.addEventListener('click', () => {
    showRandomScenario(randomSeed())
  })

  const urlSeed = Number(new URLSearchParams(window.location.search).get('scenario'))

  if (Number.isInteger(urlSeed) && urlSeed >= 1 && urlSeed <= 9999) {
    showRandomScenario(urlSeed)
  }

  let scenario = null
  let previousCareerMSv = null
  renderMissionSchedule(output, route)
  const walkingMetric = document.querySelector('#planning-walking')
  form.elements.weather.addEventListener('change', () => {
    form.elements.start.disabled = form.elements.weather.value !== 'storm'
    form.requestSubmit()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return
    scenario = form.elements.weather.value === 'storm'
      ? weatherScenario(`${route.mission.start_time.slice(0, 10)}T${form.elements.start.value}:00Z`)
      : null
    previousCareerMSv = form.elements.career.value === '' ? null : Number(form.elements.career.value)
    renderMissionSchedule(output, route, scenario, { previousCareerMSv })
    const walking = Math.round(calculateMissionSchedule(route, scenario).walking)
    if (walkingMetric) walkingMetric.textContent = walking >= 60 ? `${Math.floor(walking / 60)}h ${walking % 60}m` : `${walking}m`
    onChange(scenario)
  })
  controls.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    const files = plannedCsv(route, scenario, { previousCareerMSv })
    downloadCsv(button.dataset.export === 'summary' ? 'eva-summary.csv' : 'eva-timeline.csv', files[button.dataset.export])
  }))
}
