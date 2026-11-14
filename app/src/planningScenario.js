import { weatherScenario } from './planningWeather.js'
import { calculateMissionSchedule, renderMissionSchedule } from './missionSchedule.js'
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
    <button type="submit">Update plan</button>
  </form>
  <p class="psc-note">Demo assumption: walking speed becomes 0.6× after the selected time. Storm radiation is excluded from the dose estimate. The Walk screen is unaffected.</p>
  <div class="psc-export"><button type="button" data-export="summary">Download planned summary CSV</button><button type="button" data-export="timeline">Download planned timeline CSV</button></div>
  <small class="psc-note">RAD baseline estimate (0.67 mSv/day), not a measured personal dose. These are planned events; visited stops, bonus completion and prior career dose are unknown.</small>`
  const output = document.createElement('div')
  container.replaceChildren(controls, output)
  const form = controls.querySelector('form')
  let scenario = null
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
    renderMissionSchedule(output, route, scenario)
    const walking = Math.round(calculateMissionSchedule(route, scenario).walking)
    if (walkingMetric) walkingMetric.textContent = walking >= 60 ? `${Math.floor(walking / 60)}h ${walking % 60}m` : `${walking}m`
    onChange(scenario)
  })
  controls.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    const files = plannedCsv(route, scenario)
    downloadCsv(button.dataset.export === 'summary' ? 'eva-summary.csv' : 'eva-timeline.csv', files[button.dataset.export])
  }))
}
