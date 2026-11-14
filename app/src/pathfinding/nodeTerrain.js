/**
 * Node-only helper for the command-line tools (checkStops.js, pitchCompare.js).
 * Loads the same terrain files the app loads from public/terrain/. Not used by the browser.
 */
import { readFileSync } from 'node:fs'
import { makeGrid, xyToCell } from './walkingTime.js'

const appDir = new URL('../../', import.meta.url)

export function readAppJson(path) {
  return JSON.parse(readFileSync(new URL(path, appDir), 'utf8'))
}

/** { grid, area, habitat: {id, name, x, y}, habitatCell } with habitat H1. */
export function loadTerrain() {
  const t = (f) => readAppJson('public/terrain/' + f)
  const area = t('area.json')
  const grid = makeGrid({ elevation: t('elevation.json'), slope: t('slope.json'), roughness: t('roughness.json') })
  const h1 = area.habitatCandidates.find((h) => h.id === 'H1' || h.name === 'H1') ?? area.habitatCandidates[0]
  const habitat = { id: 'hab', name: 'Habitat (H1)', x: h1.x, y: h1.y }
  return { grid, area, habitat, habitatCell: xyToCell(grid, h1.x, h1.y) }
}
