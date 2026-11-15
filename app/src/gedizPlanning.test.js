import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildGedizRoute, buildTerrainRoute } from './terrainRoute.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { createPlanningSafety } from './safezone/planningModel.js'
import { plannedCsv } from './planningCsv.js'

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const [template, area, elevation, slope, roughness, gediz, boxwork, parking] = await Promise.all([
  json('../public/routes/sample-route.json'), json('../public/terrain/area.json'),
  json('../public/terrain/elevation.json'), json('../public/terrain/slope.json'), json('../public/terrain/roughness.json'),
  json('../public/routes/gediz-stops.json'), json('../public/routes/science-stops.json'), json('../public/routes/rover-parking.json'),
])
const terrain = { elevation, slope, roughness }
const eva07 = buildTerrainRoute(template, area, terrain, boxwork).route
assert.deepEqual([eva07.stops[0].x, eva07.stops[0].y], [1047.5, 917.5])
const { grid, route } = buildGedizRoute(template, area, terrain, gediz, parking)
assert.equal(gediz.status, 'ready')
assert.equal(route.provenance.target_status, 'ready', 'Science sign-off must reach the Planning photo panel')
assert.deepEqual([grid.sizeX, grid.sizeY], [6000, 6000])
assert.deepEqual([route.stops[0].x, route.stops[0].y], [3192.5, 3542.5])
assert.deepEqual(route.legs.map((leg) => Math.round(leg.seconds / 60)), [17, 13, 4, 11, 10])
const plan = calculateMissionSchedule(route)
assert.equal(plan.driveOut, 56)
assert.equal(plan.driveHome, 56)
assert.equal(Math.round(plan.walking), 55)
assert.equal(plan.science, 95)
assert.equal(Math.round(plan.total), 262)
assert.equal(Math.round(plan.margin), 98)
const model = createPlanningSafety(grid, route.stops[0], route.mission)
const result = model.evaluate({ position: route.stops[0], elapsedMinutes: 56, stopMinutes: 20 })
assert.equal(result.timer.homeMinutes, 56, 'G2 return includes suited drive')
assert.equal(result.timer.turnbackIn, 248, 'G2 turn-back protects the return drive and reserve')
const csv = plannedCsv(route)
assert.match(csv.timeline, /planned_drive_arrival/)
assert.match(csv.timeline, /planned_home,Habitat \(H1\)/)
console.log('EVA-08 Planning passed: 6 km map, 56 + 56 min drives, 55 min walk, 95 min science, 98 min spare.')
