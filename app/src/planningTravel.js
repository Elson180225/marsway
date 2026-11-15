import { planRoute } from './pathfinding/astar.js'
import { driveMinutes, roverRulesFrom } from './pathfinding/rover.js'
import { calculateMissionSchedule } from './missionSchedule.js'
import { localFromProjected } from './terrainRoute.js'

export const defaultTravelMode = (eva) => String(eva).replace(/^EVA-/, '') === '08' ? 'rover' : 'foot'

/** Build both versions from the same science stops and terrain. No home files are fetched. */
export function planningTravelVersions({ route, grid }, area, catalog, parking) {
  const eva = route.mission.id.slice(-2)
  const scenario = catalog.scenarios.find((item) => item.eva === eva)
  const habitatId = scenario?.habitat
  const habitat = catalog.habitats?.[habitatId]
  const entry = parking.evas.find((item) => item.eva === eva)
  const spot = entry?.spot
  if (!habitat || !spot || !Number.isFinite(spot.drive_distance_m)) throw new Error(`EVA-${eva} needs habitat and rover parking data.`)
  const home = localFromProjected(area, habitat)
  const parked = localFromProjected(area, spot)
  const science = route.stops.slice(1, -1)
  const drive = Math.round(driveMinutes(spot.drive_distance_m, roverRulesFrom(parking)))
  const baseMission = { ...route.mission }
  delete baseMission.drive_out_minutes
  delete baseMission.drive_home_minutes
  delete baseMission.drive_distance_m

  const version = (mode, origin, name) => {
    const points = [
      { id: mode === 'foot' ? 'hab' : spot.id.toLowerCase(), name, type: 'habitat', ...origin,
        description: mode === 'foot' ? `Crew base at ${habitatId}.` : `Open-rover parking at ${spot.id}; not storm shelter.` },
      ...science,
      { id: 'home', name: mode === 'foot' ? `Return to Habitat (${habitatId})` : `Return to rover (${spot.id})`, type: 'home', ...origin },
    ]
    // The normal loader already planned the default version; only search the other route.
    const result = mode === defaultTravelMode(eva) ? route : planRoute(grid, points)
    return { ...route, ...result, provenance: { ...route.provenance, routing: mode === 'foot' ? `Nigel pathfinding from ${habitatId}` : `Nigel pathfinding from rover parking ${spot.id}` },
      mission: { ...baseMission, home_label: mode === 'foot' ? habitatId : spot.id,
      habitat_label: habitatId, habitat_position: home,
      ...(mode === 'rover' ? { drive_out_minutes: drive, drive_home_minutes: drive, drive_distance_m: spot.drive_distance_m } : {}) },
      drivePath: mode === 'rover' ? spot.drive_path?.map(([easting, northing]) => localFromProjected(area, { easting, northing })) : null }
  }
  const foot = version('foot', home, `Habitat (${habitatId})`)
  const rover = version('rover', parked, `Rover parking (${spot.id})`)
  return { foot, rover, defaultMode: defaultTravelMode(eva) }
}

export function travelComparison(versions) {
  const difference = Math.round(calculateMissionSchedule(versions.foot).total - calculateMissionSchedule(versions.rover).total)
  return difference > 0 ? `With rover: saves ${difference} min`
    : difference < 0 ? `With rover: ${-difference} min slower` : 'Both versions take the same time'
}
