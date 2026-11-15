import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { stopMetadata } from './stopDetails.js'

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
const catalog = await json('../public/routes/scenarios.json')
const sources = await json('../../data/processed/scenario-science/photo-sources.json')
const scenarios = catalog.scenarios.filter((scenario) => scenario.stops)
assert.equal(catalog.status, 'ready')
assert.deepEqual(scenarios.map((scenario) => scenario.eva), ['09', '10', '11', '12'])
assert.equal(sources.photos.length, 15)
const bySol = new Map(sources.photos.map((photo) => [photo.waypoint_sol, photo]))

for (const scenario of scenarios) {
  assert.equal(scenario.science_status, 'ready')
  assert.deepEqual(scenario.stops.filter((stop) => stop.is_bonus).map((stop) => stop.id), [scenario.bonus_stop_id])
  for (const stop of scenario.stops) {
    assert.doesNotMatch(stop.name, /^Sol \d+ Waypoint$/)
    assert.doesNotMatch(stop.description + stop.why, /draft|worked here for a while|spent about \d+ sols/i)
    assert.ok(stop.description.length > 80 && stop.why.length > 30)
    assert.ok(stop.science_source_url.startsWith('https://science.nasa.gov/'))
    const photo = bySol.get(stop.waypoint_sol)
    assert.ok(photo, `${stop.id} has a source record`)
    for (const field of ['photo_url', 'photo_credit', 'photo_source_url', 'photo_caption', 'photo_product_id', 'sol', 'camera']) {
      assert.ok(stop[field], `${stop.id} ${field}`)
      assert.equal(stop[field], photo[field])
    }
    assert.ok(stop.photo_url.startsWith('/photos/scenarios/'))
    const bytes = await readFile(new URL(`../public${stop.photo_url}`, import.meta.url))
    assert.equal(bytes.length, photo.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), photo.sha256, `${stop.id} unaltered NASA display image`)
    if (photo.mime === 'image/png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    else assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff')
    assert.ok(new URL(photo.download_url).hostname === 'assets.science.nasa.gov')
    const metadata = stopMetadata({ ...stop, x: 0, y: 0 }, 'https://marsway.example/')
    assert.ok(metadata.photo && metadata.source && metadata.credit && metadata.camera && metadata.sol)
    if (String(stop.sol) !== String(stop.waypoint_sol)) {
      assert.equal(stop.photo_view, 'nearby', `${stop.id} must disclose contextual photo`)
      assert.equal(stop.photo_offset_m, null, 'no invented photo distance')
      assert.equal(stop.photo_offset_status, 'unverified')
      assert.match(stop.photo_caption, /^Nearby view/)
      assert.equal(metadata.nearby, true, 'both screens receive the nearby-view flag')
    } else {
      assert.match(stop.photo_caption, /not been registered/)
    }
  }
}
console.log('Scenario science passed: 15 sourced NASA images, contextual labels, visit metadata and bonus stops.')
