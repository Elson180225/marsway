// Map Maker 2: checks for the Gediz Vallis stops (data/processed/area-5km/gediz-stops.json).
// Run from the repo root: node app/src/gediz-stops.test.js
// Same rules as Kelly's science-stops.test.js. The terrain checks run once area-5km/area.json exists.
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'

const repo = new URL('../../', import.meta.url)
const readJson = async (path) => JSON.parse(await readFile(new URL(path, repo), 'utf8'))
const exists = (path) => access(new URL(path, repo)).then(() => true, () => false)

const doc = await readJson('data/processed/area-5km/gediz-stops.json')
const expected = ['mineral-king', 'sulfur-crystals', 'kings-canyon', 'channel-panorama']

assert.deepEqual(doc.stops.map((stop) => stop.id), expected)
assert.equal(doc.status, 'ready')
assert.deepEqual(await readJson('app/public/routes/gediz-stops.json'), doc, 'Runtime Gediz stops must match the reviewed data')
assert.deepEqual(doc.stops.map((stop) => stop.order), [1, 2, 3, 4])
assert.deepEqual(doc.stops.filter((stop) => stop.is_bonus).map((stop) => stop.id), [doc.bonus_stop_id])

const ids = new Set()
for (const stop of doc.stops) {
  assert.ok(!ids.has(stop.id) && !['hab', 'home'].includes(stop.id), `${stop.id} id clash`)
  ids.add(stop.id)
  assert.equal(stop.type, 'science_stop')
  assert.equal(stop.location_status, 'curiosity_waypoint')
  assert.equal(stop.placement, 'proposed_astronaut_target_at_rover_waypoint')
  // Sols 4100-4400 as asked, and real NASA projected coordinates near Gediz Vallis.
  assert.ok(stop.waypoint_sol >= 4100 && stop.waypoint_sol <= 4400, `${stop.id} waypoint sol ${stop.waypoint_sol}`)
  assert.ok(Math.abs(stop.easting - 8144750) < 500 && Math.abs(stop.northing + 283550) < 500, `${stop.id} not near Gediz Vallis`)
  assert.ok(Number.isFinite(stop.stop_minutes) && stop.stop_minutes > 0)
  assert.ok(stop.why.length > 40 && stop.description.length > 80)
  assert.ok(stop.photo_url.startsWith('/photos/gediz-'))
  assert.ok(stop.photo_source_url.startsWith('https://science.nasa.gov/'))
  assert.equal(stop.photo_credit, 'NASA/JPL-Caltech/MSSS')
  assert.ok(stop.sol && stop.camera && stop.photo_product_id)
  // Nearby context is labelled honestly; temporal waypoint gaps are not photo offsets.
  if (stop.photo_view === 'nearby') {
    assert.notEqual(String(stop.sol), String(stop.waypoint_sol), `${stop.id} nearby photo must keep its own sol`)
    assert.equal(stop.photo_offset_m, null, `${stop.id}: no measured camera offset is available`)
    assert.equal(stop.photo_offset_status, 'unverified')
    assert.ok(stop.photo_waypoint_bracket.before_sol < Number(stop.sol) && Number(stop.sol) < stop.photo_waypoint_bracket.after_sol)
    assert.ok(stop.photo_caption.startsWith('Nearby view'), `${stop.id} caption must say nearby view`)
  } else {
    assert.equal(String(stop.sol), String(stop.waypoint_sol))
  }
  const photo = await readFile(new URL(`app/public${stop.photo_url}`, repo))
  assert.ok(photo.length > 20000 && photo.length < 1_500_000, `${stop.id} photo size ${photo.length}`)
  assert.deepEqual([photo[0], photo[1]], [0xff, 0xd8], `${stop.id} photo is not a JPEG`)
}
assert.equal(doc.stops.find((stop) => stop.id === 'sulfur-crystals').photo_product_id, 'PIA26309')
for (let i = 1; i < doc.stops.length; i++) {
  const [a, b] = [doc.stops[i - 1], doc.stops[i]]
  assert.ok(Math.hypot(a.easting - b.easting, a.northing - b.northing) > 50, `${a.id} and ${b.id} are too close`)
}

// Terrain: only once the 5 km map is in.
if (await exists('data/processed/area-5km/area.json')) {
  const area = await readJson('data/processed/area-5km/area.json')
  const track = await readJson('data/processed/area-5km/curiosity_track.json')
  const { west, south } = area.boundsProjected
  for (const stop of doc.stops) {
    const waypoint = track.points.find((point) => point.sol === stop.waypoint_sol)
    assert.ok(waypoint, `${stop.id}: missing real waypoint`)
    assert.deepEqual([stop.x, stop.y, stop.lon, stop.lat], [waypoint.x, waypoint.y, waypoint.lon, waypoint.lat])
    const x = stop.easting - west
    const y = stop.northing - south
    assert.ok(x >= 0 && x < area.sizeMetres && y > 0 && y <= area.sizeMetres, `${stop.id} is outside the 5 km map`)
    if (Number.isFinite(stop.x)) assert.ok(Math.abs(stop.x - x) < 0.2 && Math.abs(stop.y - y) < 0.2, `${stop.id} x/y do not match easting/northing`)
  }
  console.log('Gediz stops: all 4 are inside the 5 km map.')
} else {
  console.log('Gediz stops: 5 km map not here yet, terrain checks skipped.')
}
console.log('Gediz stop tests passed: 4 Curiosity waypoints (sols 4100-4400), photos and credits OK, one bonus stop.')
