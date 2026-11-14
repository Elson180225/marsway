import { createPlanningSafety } from './planningModel.js'
let model = null
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      model = createPlanningSafety(data.grid, data.habitat, data.mission)
      self.postMessage({ type: 'ready', id: 0 })
      return
    }
    if (!model) throw new Error('Safety worker is not initialized.')
    if (data.type === 'bonus') {
      self.postMessage({ type: 'bonus', id: data.id, check: model.checkBonus(data.scenario) })
      return
    }
    if (data.type !== 'calculate') throw new Error('Unknown safety worker request.')
    const result = model.evaluate(data.scenario)
    self.postMessage({ type: 'result', id: data.id, result }, [result.zone.buffer, result.spareMinutes.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id ?? 0, request: data.type, message: error.message })
  }
}
