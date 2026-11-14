/**
 * Node-only helper for the command-line tools (checkStops.js, pitchCompare.js, pitchLoop.js).
 * Loads the same terrain files the app loads from public/terrain/. Not used by the browser.
 */
import { readFileSync } from 'node:fs'
import { makeGrid, xyToCell } from './walkingTime.js'

const appDir = new URL('../../', import.meta.url)

// H1 never moves on Mars: this is its position in projected metres (same as terrainRoute.js).
// Its local x/y depends on the map crop (447.5, 517.5 on the 3 km map; 1047.5, 917.5 on the 6 km map).
export const H1_PROJECTED = { easting: 8142047.5, northing: -286082.5 }

export function readAppJson(path) {
  return JSON.parse(readFileSync(new URL(path, appDir), 'utf8'))
}

/** H1 in this map's local metres, from area.json's boundsProjected (or a candidate named H1 on old maps). */
export function habitatH1(area) {
  const b = area.boundsProjected
  if (b) return { x: H1_PROJECTED.easting - b.west, y: H1_PROJECTED.northing - b.south }
  const named = area.habitatCandidates?.find((h) => h.id === 'H1' || h.name === 'H1')
  if (named) return { x: named.x, y: named.y }
  throw new Error('area.json has no boundsProjected and no candidate called H1, so H1 cannot be placed.')
}

/** { grid, area, habitat: {id, name, x, y}, habitatCell } with habitat H1. */
export function loadTerrain() {
  const t = (f) => readAppJson('public/terrain/' + f)
  const area = t('area.json')
  const grid = makeGrid({ elevation: t('elevation.json'), slope: t('slope.json'), roughness: t('roughness.json') })
  const h1 = habitatH1(area)
  const habitatCell = xyToCell(grid, h1.x, h1.y)
  if (habitatCell < 0) throw new Error(`H1 (${h1.x}, ${h1.y}) is outside this map.`)
  const habitat = { id: 'hab', name: 'Habitat (H1)', x: h1.x, y: h1.y }
  return { grid, area, habitat, habitatCell }
}
