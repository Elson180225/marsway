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
  the dose for the time already out. Solar storm dose and shielding are not used on this screen yet;
  `plannedDose(durationMinutes, events)` gives the planned dose with random-event solar storms
  (see Random events below).

Tests: `node src/safezone/radiation.test.js` (from `app/`).

## Random events

**Events just happen, like real Mars weather.** There is no button: every walk gets a set of events
by itself, and the safe zone, turn-back timer, GO / NO-GO and radiation react to it. Every set has a
number, **"Scenario #4821"**: the same number always gives the same events, so a good scenario can be
replayed in the demo or the video. The Walk screen's Data page shows it as "Conditions: Scenario #4821".

```js
import { randomEvents, activeEvents, randomSeed } from './safezone/randomEvents.js'

const seed = randomSeed() // 1 to 9999, when the link has no ?scenario=; it is then put in the link
randomEvents({ seed: 4821, eva: '08', version: 'rover', durationMinutes: 261 })
// → { seed: 4821, label: 'Scenario #4821', eva: '08', version: 'rover', calm: false, cancelled: false,
//     events: [
//       { type: 'dust_devil', startMin: 54,  durationMin: 7,  pauseMinutes: 7,   title: 'Dust devil', message: '...', endMessage: '...' },
//       { type: 'dust_storm', startMin: 184, durationMin: 43, speedFactor: 0.6, title: 'Dust storm', message: '...', endMessage: '...' },
//     ] }

activeEvents(result.events, minutesOut) // → the events happening now (for pop-ups)
```

- `version` is `'foot'` or `'rover'`. `startMin` is minutes from the start of the walk.
  `durationMin: null` means "until the end of the walk".
- Events are sorted by `startMin`. Each has a `title` and `message` ready for a pop-up, and an
  `endMessage` to show when it is over (e.g. "Dust storm over. Walking is back to normal pace.").
  `endMessage` is `null` for events that last until the end of the walk (global dust storm, rover breakdown).
- **Planning and Walk must pass the same `seed`, `version` and `durationMinutes`** (the planned walk
  length), or they get different events. Pass the seed between screens as `?scenario=4821`.
  The simple way: both screens call `scenarioEvents(route, seed)` from `src/scenarioEvents.js`. It takes
  the walk length from the Planning schedule (`calculateMissionSchedule(route).total`) and uses `'rover'`
  when the route has a rover drive. `scenarioFromSearch(location.search)` reads the number from the link;
  `withScenario(href, seed)` adds it to a link.
- Foot and rover versions of one seed get the same weather; only the rover breakdown differs.

### The events

These odds and lengths are **our own simulation assumptions**, based on the team's research summary
(Russell, 15 Nov 2026). They are not statistics worked out from the Mars Climate Database. All the
numbers are in `EVENT_RULES` at the top of `randomEvents.js`: change them there and every screen follows.

| `type` | How often | How long | Effect | Why it's in |
| --- | --- | --- | --- | --- |
| `dust_storm` | 35% of walks | 20–90 min, starts between 30 min in and 30 min before the end | Walking 0.6× (`speedFactor`) | Strong local storms can come out of season with little warning (MY37 "rocket" storm) |
| `dust_devil` | 30% | 5–10 min | The crew stops and waits; the wait (`pauseMinutes`) counts against suit time | Very common (1,039 tracked in a 2025 study); grit inside hits hard |
| `solar_storm` | 15% | 30 min – 3 h | Radiation ×2 (`radiationFactor`, taken from `SOLAR_STORM_FACTOR`). Warning 10–45 min before it starts (`warningMin`, our assumption; the warning can come before the walk starts if the storm starts early) | Curiosity RAD: Sept 2017 event doubled the dose (see Radiation above) |
| `global_dust_storm` | 2% | Whole day | NO-GO: the walk is cancelled (`cancelled: true`, comes alone) | Lasts weeks to months, so the crew would know before going out. None since 2018 |
| `rover_breakdown` | 10%, rover versions only | Until the end | The crew uses the walk-back plan; home becomes the habitat | Not weather, but a real risk we already check (`roverSafety.js`) |

Over all 9,999 scenarios (261 min walk): about **38% calm** (no events), 34% dust storm, 30% dust
devil, 15% solar storm, 2% cancelled, 9% rover breakdown (rover versions). Dust storms are more
than twice as common as solar storms, and most walks have nothing serious.

Good scenarios for the demo: **#4** (dust storm, then a dust devil), **#7** (global storm, walk
cancelled), **#8** (calm day), **#4821** (dust devil, then a dust storm), **#172** (every kind of
walk event: solar storm, dust devil, dust storm).

### Testing a scenario

The Walk screen picks a random scenario when the link has no number, so to test a particular one, put
its number in the link with `?scenario=` (and `&eva=` for another EVA; no `eva` means EVA-07).
From `app/`, run `npm run dev`, then open for example:

```
http://localhost:5173/walk.html?scenario=172          # EVA-07
http://localhost:5173/walk.html?eva=09&scenario=4821   # EVA-09
```

| Number | What happens (about how far into a 4 h 20 min walk) |
| --- | --- |
| `172` | Solar storm warning ~34 min, storm ~66 min, then a dust devil, then a dust storm: **tests everything** |
| `4821` | Dust devil ~54 min, then a dust storm ~184 min |
| `13` | Dust devil ~16 min (quick test) |
| `2` | Dust storm ~87 min |
| `27` | Dust storm ~34 min, then a solar storm (warning ~83, storm ~109) |
| `73` | Solar storm near the end (~221 min) |
| `8` | Calm day: nothing should happen |
| `7` | Global dust storm: walk cancelled |

The times move a little with each EVA's walk length. Play at **60×** so the events come in about a minute
(300× is very fast: 5 walk minutes a second). To test again, press "↺ Restart simulation" at the end:
with a number in the link it replays the same scenario; without one it picks a new one. To try another
scenario, change the number in the link. Coming from Planning, the
Walk screen link carries Planning's number, so both show the same events. Planning links to the Walk
screen for the on-foot versions only, and not for EVA-08 yet, so the rover breakdown never happens there.

### How each screen uses them

| Event | Planning (Aaron) | Walk (Russell) |
| --- | --- | --- |
| `dust_storm` | `weatherScenario(start + startMin, 0.6, start + startMin + durationMin)`: the storm now has an end time, so walking is back to normal after it | Walking 0.6× while it lasts |
| `dust_devil` | Add `pauseMinutes` to the elapsed time | The crew stands still while the clock runs |
| `solar_storm` | `plannedDose(durationMinutes, events)` (in `radiation.js`) | Radiation tile counts double; Nigel's shelter route home; "Head to shelter" choice (below) |
| `rover_breakdown` | Show the walk-back result | Pop-up; switch home to the habitat's home file (e.g. `home-h1-6km`) |
| `global_dust_storm` | NO-GO, walk cancelled | "Walk cancelled" at the start |

**On the Walk screen, every event is hard to miss:**

- **When it starts** (or a solar storm warning comes in), the walk pauses once, the crew's pop-up shows
  that event and flashes, and the status says "Paused · dust storm". ▶ Resume carries on.
- **A solar storm** makes the safe choice the easy one: the big button becomes **"⌂ Head to shelter"**
  (one tap, walks home) and the small one **"Continue anyway"**. The crew still decides; carrying on
  keeps the radiation ×2 and the shelter route on screen.
- **When it ends,** its `endMessage` shows on the crew in green for 6 seconds ("✓ Dust storm over ·
  Walking is back to normal pace.").

`weatherScenario(startUtc, speedFactor, endUtc)` in `src/planningWeather.js`: `endUtc` is optional.
Leave it out and the storm lasts to the end of the walk, as before.

```js
import { plannedDose } from './safezone/radiation.js'
plannedDose(360, [{ type: 'solar_storm', startMin: 60, durationMin: 60 }])
// → same fields as doseSoFar(); here the dose of 7 h normal (one storm hour counts double)
```

### Not included (yet)

- **Cold snaps and pressure swings:** in the research, but we have no suit-battery or heater rule to
  connect them to.
- **Toxic dust:** a constant hazard, not a random event. Good for the presentation.
- **Odds from the MCD files:** the files are 0.5–4.6 GB and were not downloaded. MCD real-year data
  covers MY24–MY37; say so if MCD numbers are used later.
- **Units:** the research gives normal radiation as 180–225 µGy/day (absorbed dose); our code uses
  0.67 mSv/day (dose equivalent, adjusted for harm to the body). Both are right, but don't show them
  side by side without saying which is which.

Tests: `node src/safezone/randomEvents.test.js` (from `app/`).

## Files

| File | What it does |
| --- | --- |
| `timeHome.js` | Time home, next-step-home arrows and distance home for every cell; walk-out times from any cell |
| `safeZone.js` | Spare minutes and green / amber / out zone; the map image; suit numbers |
| `turnBack.js` | Turn-back timer |
| `storm.js` | Storm route home (follows the arrows) |
| `bonusStop.js` | Bonus-stop GO / NO-GO |
| `radiation.js` | Radiation dose: normal rate, solar storm ×2, habitat ×0.5, `doseSoFar()` for a walk timeline, `plannedDose()` with random-event solar storms, career total vs 600 mSv |
| `randomEvents.js` | Random events for a walk from a seed: dust storm, dust devil, solar storm, global storm, rover breakdown; `activeEvents()` for what is happening now |
| `homeFile.js` | Save / load the pre-calculated home file for the phone |
| `buildHomeFile.js` | Makes `public/safezone/home-h1.*` (EVA-07), `home-g2.*` (EVA-08, 5 km map) and `home-g2-6km.*` (EVA-08, 6 km map). **Re-run if the terrain or `SUIT` changes.** |
| `buildRoverHomeFiles.js` | Makes the home file for every rover parking spot in `public/routes/rover-parking.json` (home = the rover) |
| `roverSafety.js` | Safety checks for the on-foot and with-rover versions: plan fits, storm plan, walk-back, parking slope |
| `checkEvaVersions.js` | Runs those checks for EVA-07 to 12 and prints a report |
| `evaSetup.js` | Habitat, stops and parking spot for each EVA, in local metres |
| `test.js` | All checks, on a toy grid and on the real terrain against Nigel's planner |
| `preview.js` | Draws the safe zone over the terrain as a PNG, for checking |

```bash
# from app/
node src/safezone/test.js             # run all checks
node src/safezone/randomEvents.test.js  # random events
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

## On foot and with rover: every EVA (EVA-07 to 12)

Every EVA now has two versions:
- **On foot:** walk from the habitat to the stops and back.
- **With rover:** drive (open rover, suits on) to a parking spot, walk the stops from the rover, then
  drive home. Home on the walk is the parked rover, like EVA-08 at G2.

Team rules, same as EVA-08:
- The drive counts against the 8 h suit, and the 2 h reserve stays protected.
- Rover: 5 km/h average plus 10 min on/off per drive, only on slopes up to about 15°.
- Walk-back check: if the rover breaks down, the crew can still walk home.
- Storm plan: back to the rover, then drive home. The rover is not a shelter.

### Who does what

| Step | Who | File |
| --- | --- | --- |
| Pick a parking spot per EVA (flat, near the stops, reachable by rover), plus drive route and distance | Nigel | `public/routes/rover-parking.json` (fill `spot`) |
| Build the home file for each spot (home = the rover) | Mia | `node src/safezone/buildRoverHomeFiles.js` |
| Safety checks for both versions | Mia | `node src/safezone/checkEvaVersions.js` |

`rover-parking.json` already has EVA-08 (G2). The other five are `null` until Nigel adds them:

```json
{ "eva": "09", "habitat": "H1", "spot": { "id": "P09", "name": "Rover parking (P09)",
  "easting": 8143000.5, "northing": -285000.5, "drive_distance_m": 2400 } }
```

Positions are projected metres, like `scenarios.json`. The home file is saved as `home-<id>-6km.*`
(7.2 MB each) unless `home_file` says otherwise.

### What the safety checks look at

| Check | On foot | With rover | Pass when |
| --- | --- | --- | --- |
| Plan fits | walking + science | drive out + walking + science + drive home | within 6 h (reserve untouched) |
| Storm plan | from each stop, walk home | from each stop, walk to the rover + drive home | within 8 h (⚠️ if it needs the reserve) |
| Walk-back | – | rover found broken when the crew gets back to it: walk from the parking spot to the habitat | within 8 h (⚠️ if it needs the reserve) |
| Parking spot | – | walkable and no steeper than 15° | |

The drive route itself (slopes up to 15° along the way) is Nigel's check.

### Results now (15 Nov 2026)

| EVA | On foot | With rover |
| --- | --- | --- |
| EVA-07 (H1) | ✅ 3 h 57 m, 2 h 03 m spare | waiting for a parking spot |
| EVA-08 (H1) | ✅ but **tight**: 5 h 57 m, 3 min spare (21 min without the bonus) | ✅ via G2: 4 h 21 m, 1 h 39 m spare; walk-back 1 h 54 m, home at 5 h 20 m |
| EVA-09 (H1) | ✅ 3 h 57 m, 2 h 03 m spare | waiting for a parking spot |
| EVA-10 (H2) | ✅ 3 h 32 m, 2 h 28 m spare | waiting for a parking spot |
| EVA-11 (H3) | ✅ 4 h 07 m, 1 h 53 m spare | waiting for a parking spot |
| EVA-12 (H4) | ✅ 4 h 18 m, 1 h 42 m spare | waiting for a parking spot |

EVA-08 drive: by the rule, 3.8 km is 55.6 min (shown as 56 min here); the Planning screen still uses
55 min.

Tests: `node src/safezone/roverSafety.test.js` (from `app/`).

