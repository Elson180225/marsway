// Move the live forms, not copies: submit, change, and worker handlers stay attached.
// On narrow screens return each form to its original position above the results.
let stopWatching = null

export function mountPlanningSidebarControls(sidebar) {
  stopWatching?.()
  const weather = document.querySelector('#mission-schedule .psc-form')
  const safety = document.querySelector('#planning-safety .ps-form')
  const weatherSlot = sidebar.querySelector('#sidebar-weather-form')
  const safetySlot = sidebar.querySelector('#sidebar-safety-form')
  if (!weather || !safety || !weatherSlot || !safetySlot) throw new Error('Planning control forms are missing.')
  const forms = [
    { form: weather, slot: weatherSlot, anchor: document.createComment('weather form') },
    { form: safety, slot: safetySlot, anchor: document.createComment('safety form') },
  ]
  for (const item of forms) {
    item.form.before(item.anchor)
    item.form.setAttribute('aria-label', item === forms[0] ? 'Weather scenario' : 'Safety check')
  }
  const desktop = window.matchMedia('(min-width: 851px)')
  const placeForms = () => {
    for (const { form, slot, anchor } of forms) {
      if (desktop.matches) slot.append(form)
      else anchor.after(form)
    }
  }
  desktop.addEventListener('change', placeForms)
  stopWatching = () => desktop.removeEventListener('change', placeForms)
  placeForms()
}
