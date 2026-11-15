# Safe zone (Pathfinder 2)

**"Can the crew still get home?"** Nigel's route planner says how to get somewhere; this folder says
whether the crew can get back before the suit reserve, when they must turn back, and the quickest
way home in an emergency.

Everything uses Nigel's `stepSeconds()` and `SUIT`, so the times always match his routes.
Habitat is **H1**. Suit time is **8 h with 2 h reserve** (`SAFE_ZONE` in `safeZone.js`; pass
`settings` to use the route file's `mission.max_walk_minutes` / `reserve_minutes` instead).

Positions are local metres `{ x, y }` (x east, y north), the same as the route file and the Leaflet map.

## Aaron: Planning screen

Use the `grid` from `loadTerrainRoute()`.

```js
import { xyToCell } from '../pathfinding/walkingTime.js'
import { homeArrows } from './safezone/timeHome.js'
import { safeZone, zoneToDataURL } from './safezone/safeZone.js'

const hab = xyToCell(grid, h1.x, h1.y)
const arrows = homeArrows(grid, hab) // once, about 0.2 s
const settings = { suitHours: route.mission.max_walk_minutes / 60, reserveHours: route.mission.reserve_minutes / 60 }

// When a stop is selected: where can the crew still go from here?
const sz = safeZone(grid, hab, {
  here: xyToCell(grid, stop.x, stop.y),
  elapsedSeconds, // suit time used by then: sum of leg.seconds so far + time at stops
  stopSeconds: 20 * 60, // time to spend at a bonus stop
  timeHome: arrows.timeHome,
  settings,
})
const layer = L.imageOverlay(zoneToDataURL(sz.zone, grid), [[0, 0], [3000, 3000]], { opacity: 0.9 })
```

`safeZone()` returns:

| Field | What it is |
| --- | --- |
| `spareMinutes` | One number per cell: minutes left before the reserve if the crew goes there, stops, and walks home. **≥ 0 safe** (big = green, near 0 = red), **< 0 not safe**, `-Infinity` = can't get there or back. |
| `zone` | One number per cell: `2` safe (green), `1` only by using the reserve (amber), `0` out |
| `spareSeconds` | How long the crew can stay at `here` before they must head home (negative = late) |
| `secondsLeft` | Suit time left before the reserve |
| `safeCells`, `reserveCells` | How many cells are in each band |

Cells are in Elson's order: `index = row * 600 + col`, row 0 = north. The image lines up with
`basemap.png` and `slope.png` (same bounds).

From the habitat at the start, everything reachable is green (the furthest point is 2.4 h from H1),
so the zone is most useful at a selected stop, part-way through the walk.

## Russell: walk screen

The phone doesn't need the terrain. It loads one pre-calculated file (`public/safezone/home-h1.*`,
about 0.7 MB compressed) and does no searching.

```js
import { loadHomeFile } from './safezone/homeFile.js'
import { turnBackTimer } from './safezone/turnBack.js'
import { stormRoute } from './safezone/storm.js'
import { bonusStopCheck } from './safezone/bonusStop.js'

const home = await loadHomeFile() // { grid, arrows, habitatCell, habitat, stale }
```

**Turn-back timer**, instant, fine to call every second:

```js
turnBackTimer(home.grid, home.arrows.timeHome, { x, y }, minutesOut, settings)
// → { homeMinutes: 47.7, turnbackIn: 42.3, level: 'ok', title: 'On plan', message: '...' }
//   level: 'ok' | 'caution' (≤ 30 min) | 'danger' (turn back now). Same fields as safetyStatus().
```

**Storm button: quickest way back to H1**

```js
stormRoute(home.grid, home.arrows, { x, y })
// → { distance_m: 1706, walk_minutes: 48, seconds: 2862, path: [{ x, y }, ...] }  (same shape as a route leg)
//   null if there is no walkable way home from that spot
```

**Bonus-stop GO / NO-GO**

```js
bonusStopCheck(home.grid, home.arrows.timeHome, {
  here: { x, y },
  bonus: { x: 1620, y: 1480 },
  elapsedMinutes: 270,
  stopMinutes: 20,
  walkThereMinutes: leg.walk_minutes, // on the phone, from the route file
  settings,
})
// → { go: true, level: 'ok', title: 'GO', message: '45 min there + 20 min stop + 5 min home. 20 min to spare...',
//     walkThereMinutes, stopMinutes, homeFromBonusMinutes, spareMinutes }
//   level: 'ok' (GO) | 'caution' (GO, under 30 min spare, the amber band on the map) | 'danger' (NO-GO)
```

On the Planning screen, leave out `walkThereMinutes` and pass the full `grid`: Nigel's planner
works out the walk there on the terrain.

`reason` says why. Everything except `fits` and `tight` is a NO-GO:

| `reason` | Title | When |
| --- | --- | --- |
| `fits` / `tight` | GO / GO, but tight | 30+ min / under 30 min to spare |
| `reserve` | NO-GO: skip the bonus stop | The trip would eat into the reserve |
| `off-map` | NO-GO: off the map | The bonus stop is outside the terrain |
| `no-go-ground` | NO-GO: no-go ground | The bonus stop is on a too-steep or too-rough square |
| `no-way-home` | NO-GO: no safe way home | The bonus stop is walkable but cut off from H1 |
| `crew-lost` | NO-GO: no way home from here | The crew position has no way back to H1 |
| `cant-reach` | NO-GO: can't reach it | No walking route from the crew to the stop |

The bonus stop is checked at its exact square (a target on a cliff is a NO-GO, the same as the map
shows). Only the crew position is moved to the nearest safe square, for GPS that lands on a ridge edge.
The phone's home file has no no-go layer, so there a no-go square comes out as `no-way-home`.

## Radiation

All radiation numbers live in `radiation.js`. Change a number there and every screen follows.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| Normal surface dose | 0.67 mSv/day | Curiosity RAD (Hassler et al. 2014, Science 343) |
| Solar storm | ×2 | Sept 2017 event: RAD readings "more than doubled" for over 2 days ([NASA JPL](https://www.jpl.nasa.gov/news/large-solar-storm-sparks-global-aurora-and-doubles-radiation-levels-on-the-martian-surface/)); rates up 2-3x for hours ([Hassler et al. 2018](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018SW001959)). Cautious: dose equivalent peak was about 1.5x ([Zeitlin et al. 2018](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2018GL077760)) |
| Inside the habitat | ×0.5 | **Team assumption.** No Mars habitat has been measured; studies give about 41% less behind 1 m of regolith ([PSS 2022](https://ui.adsabs.harvard.edu/abs/2022P&SS..21805517L/abstract)) and over 90% less behind 2.5 m ([TU Delft](https://repository.tudelft.nl/record/uuid:96c7c4bb-aab2-4146-809b-a540f8187d11)) |
| Career limit | 600 mSv | NASA-STD-3001 Vol. 1 ([NASA radiation technical brief](https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf)) |

A solar storm is radiation, not dust: it does not change walking speed. The dust storm (Planning
screen, `planningWeather.js`) changes walking time only and does not change the dose.

```js
import { walkDoseMSv, doseRateMSvPerDay, doseSoFar, careerTotal } from './safezone/radiation.js'

walkDoseMSv(6) // → 0.168 mSv (6 h outside, normal rate)
doseRateMSvPerDay({ inside: true, solarStorm: true }) // → 0.67 mSv/day (0.67 × 0.5 × 2)

// For the Walk screen: dose so far from the walk timeline, plus solar storm minutes
doseSoFar({
  periods: [{ startMs, endMs, inside: false }, { startMs: back, endMs: null, inside: true }],
  storms: [{ startMs: stormStart, endMs: null }], // endMs null = storm still on
  nowMs: Date.now(),
})
// → { doseMSv, stormMinutes, stormExtraMSv, outsideMinutes, insideMinutes }

// Running total across walks vs NASA's 600 mSv career limit
careerTotal({ previousMSv: 12.5, evaDosesMSv: [0.15, 0.2] })
// → { totalMSv: 12.85, limitMSv: 600, percentOfLimit: 2.14, remainingMSv: 587.15 }
```

Where it shows:
- **Walk screen:** the "Radiation so far" tile counts double while the ☀︎ Storm button is on, and
  shows the storm minutes and the extra dose (`radiationDose()` in `screens/Walk/walk-model.js`).
- **Planning screen:** the planned dose (normal rate, whole EVA outside), plus the running total
  against 600 mSv. Type a previous career dose to include it; if left blank, the screen says so and
  `running_total_msv` in the summary CSV stays blank. "Elapsed dose estimate" in the safety panel is
  the dose for the time already out. Solar storm dose and shielding are not used on this screen yet.

Tests: `node src/safezone/radiation.test.js` (from `app/`).

## Files

| File | What it does |
| --- | --- |
| `timeHome.js` | Time home, next-step-home arrows and distance home for every cell; walk-out times from any cell |
| `safeZone.js` | Spare minutes and green / amber / out zone; the map image; suit numbers |
| `turnBack.js` | Turn-back timer |
| `storm.js` | Storm route home (follows the arrows) |
| `bonusStop.js` | Bonus-stop GO / NO-GO |
| `radiation.js` | Radiation dose: normal rate, solar storm ×2, habitat ×0.5, `doseSoFar()` for a walk timeline, career total vs 600 mSv |
| `homeFile.js` | Save / load the pre-calculated home file for the phone |
| `buildHomeFile.js` | Makes `public/safezone/home-h1.*` (EVA-07), `home-g2.*` (EVA-08, 5 km map) and `home-g2-6km.*` (EVA-08, 6 km map). **Re-run if the terrain or `SUIT` changes.** |
| `test.js` | All checks, on a toy grid and on the real terrain against Nigel's planner |
| `preview.js` | Draws the safe zone over the terrain as a PNG, for checking |

```bash
# from app/
node src/safezone/test.js             # run all checks
node src/safezone/buildHomeFile.js    # rebuild the phone file for EVA-07 (home = H1, 3 km map)
node src/safezone/buildHomeFile.js --terrain ../data/processed/area-5km/ --home 3192.5,3542.5 --id G2 --out home-g2
                                      # EVA-08 (home = rover at G2, 5 km map)
node src/safezone/buildHomeFile.js --terrain ../data/processed/area-6km/ --home 3192.5,3542.5 --id G2 --out home-g2-6km
                                      # EVA-08 on the 6 km map
node src/safezone/preview.js zone.png # picture of the safe zone (crew at the boxwork after 4.5 h)
```

### Walk screen on the 6 km map: one file per habitat

The Walk screen (`walk.html?eva=07`, `09` … `12`) loads `home-<habitat>-6km.*` for the habitat that
`public/routes/scenarios.json` gives that EVA. `home-h1.*` above stays on the 3 km map for `test.js`.
If a file is missing or doesn't match the terrain, the phone works the way home out itself (about 2 s).
`src/scenarios.test.js` checks every file still matches. Rebuild from `app/` with:

```bash
node src/safezone/buildHomeFile.js --home 1047.5,917.5  --id H1 --out home-h1-6km   # EVA-07, EVA-09
node src/safezone/buildHomeFile.js --home 1557.5,3372.5 --id H2 --out home-h2-6km   # EVA-10
node src/safezone/buildHomeFile.js --home 3672.5,2072.5 --id H3 --out home-h3-6km   # EVA-11
node src/safezone/buildHomeFile.js --home 4482.5,3492.5 --id H4 --out home-h4-6km   # EVA-12
```

## EVA-08: home is the rover at G2

EVA-08 is rover-assisted: the crew drives from H1 to staging point **G2** (x 3192.5, y 3542.5 on the
5 km map, flat, about 4°), parks, walks the four Gediz Vallis stops and comes back to the rover. So for
EVA-08, "home" is the rover at G2, not H1. Load it on the phone with `loadHomeFile('/safezone/home-g2')`;
everything else (turn-back timer, storm route, bonus GO / NO-GO) works the same.

Two files, one per map, because a home file only fits the grid it was built on:

| File | Map | Grid | Size | Load with |
| --- | --- | --- | --- | --- |
| `home-g2.*` | 5 km (`area-5km/`) | 1000 × 1000 | 5.0 MB | `loadHomeFile('/safezone/home-g2')` |
| `home-g2-6km.*` | 6 km (`area-6km/`) | 1200 × 1200 | 7.2 MB | `loadHomeFile('/safezone/home-g2-6km')` |

Both maps share the same bottom-left corner, so x/y are the same and the times below match on both.

| Back to the rover from | Walk |
| --- | --- |
| Mineral King Drill Site | 15 min |
| Sulfur Crystal Field | 18 min |
| Kings Canyon Drill Site | 19 min |
| Gediz Vallis Panorama (bonus) | 10 min |

Whole walk from G2 and back: about 55 min walking + 95 min science = 2 h 30 min, out of 6 h usable.
These assume suit time starts at G2. If the crew wears suits during the drive from H1, add the drive
time to `elapsedMinutes`.

