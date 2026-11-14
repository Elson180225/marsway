import assert from 'node:assert/strict'
import { weatherScenario, adjustedTravelMinutes, latestTurnbackMinutes } from './planningWeather.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { plannedCsv, SUMMARY_COLUMNS, TIMELINE_COLUMNS } from './planningCsv.js'
import { makeGrid, gridFileFromRows, cellToXY, xyToCell } from './pathfinding/walkingTime.js'
import { createPlanningSafety } from './safezone/planningModel.js'
import { ZONE } from './safezone/safeZone.js'

const start = '2026-11-14T08:00:00Z'
const scenario = weatherScenario('2026-11-14T10:30:00Z')
assert.equal(adjustedTravelMinutes(60, 120, Date.parse(start), scenario), 80, 'only the final 30 calm minutes slow after the storm begins')
assert.equal(adjustedTravelMinutes(60, 0, Date.parse(start), scenario), 60)
const latest = latestTurnbackMinutes(120, 0, 360, Date.parse(start), scenario)
assert.ok(latest < 240, 'future storm moves turn-back earlier even when leaving now would avoid it')
assert.ok(Math.abs(latest + adjustedTravelMinutes(120, latest, Date.parse(start), scenario) - 360) < 0.001)
assert.throws(() => weatherScenario('bad'), /valid UTC/)

const stops = [
  { id: 'hab', name: 'H1', type: 'habitat', x: 5, y: 5 },
  { id: 'bonus', name: 'Mineral Investigation', type: 'science_stop', x: 10, y: 10, stop_minutes: 20, is_bonus: true },
  { id: 'home', name: 'H1 home', type: 'home', x: 5, y: 5 },
]
const route = { mission: { id: 'EVA-07', start_time: start, max_walk_minutes: 480, reserve_minutes: 120 }, stops,
  legs: [{ seconds: 120 * 60, walk_minutes: 120, distance_m: 1700 }, { seconds: 120 * 60, walk_minutes: 120, distance_m: 1700 }] }
const clear = calculateMissionSchedule(route)
const storm = calculateMissionSchedule(route, scenario)
assert.equal(clear.total, 260)
assert.ok(Math.abs(storm.total - 333.3333333) < 0.001, 'only the part of the second leg after 10:30 slows')
assert.ok(Math.abs(storm.stormExposure - 183.3333333) < 0.001)
assert.ok(storm.margin < clear.margin)
const files = plannedCsv(route, scenario)
assert.equal(files.summary.split('\r\n')[0], SUMMARY_COLUMNS)
assert.equal(files.timeline.split('\r\n')[0], TIMELINE_COLUMNS)
assert.ok(files.timeline.includes('planned_arrival'))
assert.ok(files.timeline.includes('planned_home'))
assert.ok(files.summary.includes('SIMULATED CREW'))
assert.ok(files.summary.split('\r\n')[1].endsWith(','), 'unknown career total is blank')

const flat = Array.from({ length: 10 }, () => Array(10).fill(0))
const grid = makeGrid({ elevation: gridFileFromRows(flat, 10), slope: gridFileFromRows(flat, 10) })
const habitat = cellToXY(grid, 0)
const goal = cellToXY(grid, 9 * grid.width + 9)
const model = createPlanningSafety(grid, habitat, route.mission)
const calm = model.evaluate({ position: goal, elapsedMinutes: 300, stopMinutes: 20, bonusStop: { ...goal, name: 'Bonus', stopMinutes: 20 } })
const windy = model.evaluate({ position: goal, elapsedMinutes: 300, stopMinutes: 20, bonusStop: { ...goal, name: 'Bonus', stopMinutes: 20 }, weather: weatherScenario(start) })
assert.ok(windy.timer.homeMinutes > calm.timer.homeMinutes)
assert.ok(windy.timer.turnbackIn < calm.timer.turnbackIn)
assert.ok(windy.safeCells <= calm.safeCells)
const cell = xyToCell(grid, goal.x, goal.y)
assert.equal(windy.bonusCheck.go, windy.zone[cell] === ZONE.SAFE, 'weather bonus verdict matches the overlay')
const homeMinutes = model.checkBonus({ position: goal, bonus: goal, elapsedMinutes: 0, stopMinutes: 20 }).homeFromBonusMinutes
const nearLimit = 360 - 20 - homeMinutes - 0.25
const calmBonus = model.checkBonus({ position: goal, bonus: goal, elapsedMinutes: nearLimit, stopMinutes: 20 })
const stormBonus = model.checkBonus({ position: goal, bonus: goal, elapsedMinutes: nearLimit, stopMinutes: 20, weather: weatherScenario(start) })
assert.equal(calmBonus.go, true)
assert.equal(stormBonus.go, false)
assert.equal(stormBonus.reason, 'reserve', 'storm-flipped NO-GO explains reserve use')
assert.equal(windy.storm.walk_minutes, Math.round(windy.storm.seconds / 60), 'storm return minutes match adjusted seconds')
console.log('Planning scenario passed: timed storm, directional home, safe zone, bonus and planned CSV exports.')
