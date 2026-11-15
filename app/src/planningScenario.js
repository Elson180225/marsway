import { calculateMissionSchedule, renderMissionSchedule } from './missionSchedule.js'
import { plannedCsv, downloadCsv } from './planningCsv.js'
import { planningEventEffects, conditionLines } from './planningEvents.js'
import { scenarioFromSearch } from './scenarioEvents.js'
import './planningScenario.css'

// Conditions come from Mia's random events (?scenario=4821), the same as the Walk screen.
// There is no hand-set weather any more: one source of weather. grid is needed for the events'
// shelter and walk-back routes (planningEventEffects).
export function mountPlanningScenario(container, route, onChange, { grid = null } = {}) {
  const seed = scenarioFromSearch(location.search)
  const fx = seed && grid ? planningEventEffects({ route, grid, seed }) : null
  const weather = fx?.weather ?? null
  const plan = fx?.plan ?? null
  const controls = document.createElement('div')
  controls.className = 'planning-scenario-controls'
  controls.innerHTML = `<form class="psc-form">
    <div class="psc-conditions" role="status">
      <strong>Conditions: ${seed ? `Scenario #${seed}` : 'clear weather'}</strong>
      <ul></ul>
      ${seed ? '<small class="psc-replay">Events happen by themselves. Replay this day with <code>?scenario=' + seed + '</code></small>' : ''}
    </div>
    <label>Previous career dose (mSv, optional)<input name="career" type="number" min="0" max="10000" step="0.001" inputmode="decimal" placeholder="Not entered"></label>
  </form>

  <details class="psc-info">
    <summary>ⓘ How these estimates work</summary>
    <p class="psc-note">Conditions are random events from the scenario number (our simulation assumptions, same on the Walk screen). A dust storm slows walking to 0.6× while it lasts; a dust devil adds a wait; a solar storm doubles the radiation outside and sends the crew to shelter; a rover breakdown means walking home.</p>
    <small class="psc-note">RAD baseline estimate (0.67 mSv/day), not a measured personal dose. These are planned events; visited stops and bonus completion are unknown. The running total uses the previous career dose only if you enter one.</small>
  </details>
  <div class="psc-export"><button type="button" data-export="summary">Download planned summary CSV</button><button type="button" data-export="timeline">Download planned timeline CSV</button></div>
`
  controls.querySelector('.psc-conditions ul').replaceChildren(...conditionLines(fx).map((line) => {
    const item = document.createElement('li')
    item.textContent = line
    return item
  }))
  const output = document.createElement('div')
  container.replaceChildren(controls, output)
  const form = controls.querySelector('form')
  let previousCareerMSv = null
  const walkingMetric = document.querySelector('#planning-walking')
  const render = () => {
    if (fx?.cancelled) {
      // A global dust storm cancels the walk: show NO-GO, not a normal schedule (fx.plan is null).
      const panel = document.createElement('div')
      panel.className = 'mission-schedule psc-cancelled'
      const eyebrow = document.createElement('span')
      eyebrow.className = 'eyebrow'
      eyebrow.textContent = `SCENARIO #${fx.seed} · NO-GO`
      const title = document.createElement('h2')
      title.textContent = 'Walk cancelled'
      const why = document.createElement('p')
      why.textContent = fx.verdict.reasons.join(' ')
      panel.append(eyebrow, title, why)
      output.replaceChildren(panel)
      if (walkingMetric) walkingMetric.textContent = '–'
      controls.querySelectorAll('[data-export]').forEach((button) => { button.disabled = true; button.title = 'No schedule: the walk is cancelled' })
      return
    }
    renderMissionSchedule(output, route, weather, { previousCareerMSv, plan })
    const walking = Math.round((plan ?? calculateMissionSchedule(route, weather)).walking)
    if (walkingMetric) walkingMetric.textContent = walking >= 60 ? `${Math.floor(walking / 60)}h ${walking % 60}m` : `${walking}m`
  }
  render()
  onChange(weather) // the safe zone and turn-back use the dust storm window too

  form.addEventListener('submit', (event) => event.preventDefault())
  form.elements.career.addEventListener('change', () => {
    if (!form.reportValidity()) return
    previousCareerMSv = form.elements.career.value === '' ? null : Number(form.elements.career.value)
    render()
  })
  controls.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => {
    const files = plannedCsv(route, weather, { previousCareerMSv, plan })
    downloadCsv(button.dataset.export === 'summary' ? 'eva-summary.csv' : 'eva-timeline.csv', files[button.dataset.export])
  }))
  return { effects: fx }
}
