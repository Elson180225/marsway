import { createPlanningSafety } from './planningModel.js'
let model = null
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      model = createPlanningSafety(data.grid, data.habitat, data.mission)
      self.postMessage({ type: 'ready', id: 0 })
      return
    }
    if (data.type !== 'calculate' || !model) throw new Error('Safety worker is not initialized.')
    const result = model.evaluate(data.scenario)
    self.postMessage({ type: 'result', id: data.id, result }, [result.zone.buffer, result.spareMinutes.buffer])
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id ?? 0, message: error.message })
  }
}
