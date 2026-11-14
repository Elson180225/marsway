// Run from app/: node src/safezone/planningIntegration.test.js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { makeGrid, gridFileFromRows, cellToXY, xyToCell } from '../pathfinding/walkingTime.js'
import { findPathCells } from '../pathfinding/astar.js'
import { createPlanningSafety } from './planningModel.js'
import { ZONE, zoneToPixels } from './safeZone.js'

const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => c + r * 0.25))
const slope = rows.map((row, r) => row.map((_, c) => c === 4 && r !== 6 ? 40 : 0))
const grid = makeGrid({ elevation: gridFileFromRows(rows, 10), slope: gridFileFromRows(slope, 10) })
const habitat = cellToXY(grid, 1 * grid.width + 1)
const goal = cellToXY(grid, 3 * grid.width + 6)
const mission = { max_walk_minutes: 100, reserve_minutes: 20 }
const model = createPlanningSafety(grid, habitat, mission)
const outbound = findPathCells(grid, xyToCell(grid, habitat.x, habitat.y), xyToCell(grid, goal.x, goal.y))
const home = findPathCells(grid, xyToCell(grid, goal.x, goal.y), xyToCell(grid, habitat.x, habitat.y))
const initial = model.evaluate({ position: goal, elapsedMinutes: 0, stopMinutes: 0 })
assert.ok(Math.abs(initial.timer.homeMinutes * 60 - home.seconds) < 0.01, 'time-home must follow the actual return direction')
assert.ok(initial.storm && Math.abs(initial.storm.seconds - home.seconds) < 0.01)
assert.equal(initial.storm.path.at(-1).x, habitat.x)
assert.ok(Math.abs(outbound.seconds - home.seconds) > 0.1, 'test terrain must distinguish outbound and home directions')
const budget = mission.max_walk_minutes - mission.reserve_minutes
const elapsed = Math.max(0, budget - initial.timer.homeMinutes - 10)
const nearTurnback = model.evaluate({ position: goal, elapsedMinutes: elapsed, stopMinutes: 0 })
assert.ok(Math.abs(nearTurnback.timer.turnbackIn - 10) < 0.01)
assert.equal(nearTurnback.timer.level, 'caution')
assert.ok(Math.abs(nearTurnback.reserveAtHomeMinutes - 30) < 0.01)
assert.equal(nearTurnback.zone[xyToCell(grid, goal.x, goal.y)], ZONE.SAFE)
const withStop = model.evaluate({ position: goal, elapsedMinutes: elapsed, stopMinutes: 15 })
assert.equal(withStop.zone[xyToCell(grid, goal.x, goal.y)], ZONE.RESERVE, 'candidate stop must consume protected reserve')
assert.equal(withStop.timer.turnbackIn, nearTurnback.timer.turnbackIn, 'timer does not assume an extra stop')
const late = model.evaluate({ position: goal, elapsedMinutes: budget, stopMinutes: 0 })
assert.equal(late.timer.level, 'danger')
assert.equal(late.zone[xyToCell(grid, goal.x, goal.y)], ZONE.RESERVE)
assert.ok(late.safeCells < initial.safeCells, 'zone shrinks as suit time elapses')
const pixels = zoneToPixels(withStop.zone, grid)
assert.equal(pixels.data.length, grid.width * grid.height * 4)
assert.deepEqual(Array.from(pixels.data.slice(xyToCell(grid, goal.x, goal.y) * 4, xyToCell(grid, goal.x, goal.y) * 4 + 3)), [240, 175, 60])
assert.throws(() => model.evaluate({ position: { x: -10, y: 10 }, elapsedMinutes: 0, stopMinutes: 0 }), /no walkable route/)
assert.throws(() => model.evaluate({ position: goal, elapsedMinutes: 101, stopMinutes: 0 }), /Elapsed time/)
assert.throws(() => createPlanningSafety(grid, habitat, { max_walk_minutes: 20, reserve_minutes: 20 }), /Invalid suit/)
console.log('Planning adapter passed: directional home route, reserve bands, timer, scenario input and invalid points.')

const replies = []
globalThis.self = { postMessage: (message, transferred = []) => replies.push({ message, transferred }) }
await import('./planningWorker.js')
self.onmessage({ data: { type: 'init', id: 0, grid, habitat, mission } })
self.onmessage({ data: { type: 'calculate', id: 1, scenario: { position: goal, elapsedMinutes: 0, stopMinutes: 0 } } })
self.onmessage({ data: { type: 'calculate', id: 2, scenario: { position: goal, elapsedMinutes: 76, stopMinutes: 10 } } })
assert.deepEqual(replies.map(({ message }) => message.type), ['ready', 'result', 'result'])
assert.deepEqual(replies[1].transferred, [replies[1].message.result.zone.buffer, replies[1].message.result.spareMinutes.buffer])
assert.ok(replies[2].message.result.safeCells < replies[1].message.result.safeCells)
delete globalThis.self
console.log('Planning worker passed: repeated scenarios return transferable bands from one initialized model.')

// This public terrain check must run on Aaron's checkout to exercise the actual Mars grid.
const base = new URL('../../public/terrain/', import.meta.url)
const files = ['area.json', 'elevation.json', 'slope.json', 'roughness.json']
if (files.every((name) => existsSync(new URL(name, base)))) {
  const read = (name) => JSON.parse(readFileSync(new URL(name, base), 'utf8'))
  const area = read('area.json')
  if (typeof area.source === 'string' && area.source.includes('SYNTHETIC FIXTURE')) {
    console.log('Public terrain check skipped: scratch fixture is synthetic.')
  } else {
    const real = makeGrid({ elevation: read('elevation.json'), slope: read('slope.json'), roughness: read('roughness.json') })
    const realHabitat = { x: 447.5, y: 517.5 }
    assert.ok(area.habitatCandidates.some((h) => Math.abs(h.x - realHabitat.x) < 2.6 && Math.abs(h.y - realHabitat.y) < 2.6), 'H1 must be present in the terrain area')
    const realModel = createPlanningSafety(real, realHabitat, { max_walk_minutes: 480, reserve_minutes: 120 })
    const chosen = realModel.evaluate({ position: realHabitat, elapsedMinutes: 0, stopMinutes: 20 })
    assert.ok(chosen.safeCells > 0 && chosen.storm)
    assert.equal(chosen.timer.homeMinutes, 0)
    console.log(`Public Mars terrain passed: ${chosen.safeCells} green, ${chosen.reserveCells} amber cells at H1.`)
  }
} else console.log('Public terrain check skipped: terrain files are not available.')
