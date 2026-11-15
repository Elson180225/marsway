/**
 * Where each EVA starts, its stops, and its rover parking spot, in local metres on the 6 km map.
 * Used by buildRoverHomeFiles.js and checkEvaVersions.js (Pathfinder 2). No file reading here:
 * pass in the JSON files already loaded.
 *
 *   files = {
 *     area      public/terrain/area.json
 *     catalog   public/routes/scenarios.json     (habitats H1-H4, EVA-09 to 12 stops)
 *     boxwork   public/routes/science-stops.json (EVA-07 stops)
 *     gediz     public/routes/gediz-stops.json   (EVA-08 stops)
 *     parking   public/routes/rover-parking.json (Nigel's parking spots)
 *   }
 */
import { localFromProjected } from '../terrainRoute.js'

export const EVAS = ['07', '08', '09', '10', '11', '12']

/** { eva, id, habitat: { id, x, y }, stops: [...] } for one EVA, stops in visit order. */
export function evaSetup(eva, { area, catalog, boxwork, gediz }) {
  const scenario = catalog.scenarios.find((s) => s.eva === eva)
  if (!scenario) throw new Error(`EVA-${eva} is not in scenarios.json.`)
  const habitatId = scenario.habitat
  const projected = catalog.habitats?.[habitatId]
  if (!projected) throw new Error(`EVA-${eva} uses unknown habitat ${habitatId}.`)
  const habitat = { id: habitatId, ...localFromProjected(area, projected) }
  // EVA-07 and EVA-08 keep their own stop files in local metres; the rest are projected.
  const stops = eva === '07' ? boxwork.stops
    : eva === '08' ? gediz.stops
      : scenario.stops.map((stop) => ({ ...stop, ...localFromProjected(area, stop) }))
  if (!stops?.length) throw new Error(`EVA-${eva} has no stops.`)
  return { eva, id: scenario.id, habitat, stops: stops.map((s) => ({ ...s })) }
}

/** Nigel's parking spot for one EVA in local metres, or null if not chosen yet. */
export function parkingSpot(eva, { area, parking }) {
  const entry = parking.evas.find((e) => e.eva === eva)
  if (!entry?.spot) return null
  const { id, name, easting, northing, drive_distance_m: driveDistanceM, home_file: homeFile } = entry.spot
  if (!id || !Number.isFinite(easting) || !Number.isFinite(northing)) throw new Error(`EVA-${eva} parking spot needs id, easting and northing.`)
  if (!Number.isFinite(driveDistanceM) || driveDistanceM <= 0) throw new Error(`EVA-${eva} parking spot ${id} needs drive_distance_m (Nigel's drive route).`)
  return { id, name: name ?? id, ...localFromProjected(area, { easting, northing }), driveDistanceM, homeFile: homeFile ?? `home-${id.toLowerCase()}-6km` }
}
