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
//   level: 'ok' (GO) | 'caution' (GO, under 15 min spare) | 'danger' (NO-GO)
```

On the Planning screen, leave out `walkThereMinutes` and pass the full `grid`: Nigel's planner
works out the walk there on the terrain.

## Radiation

```js
import { walkDoseMSv } from './safezone/radiation.js'
walkDoseMSv(6) // → 0.168 mSv (0.67 mSv/day, Curiosity RAD)
```

## Files

| File | What it does |
| --- | --- |
| `timeHome.js` | Time home, next-step-home arrows and distance home for every cell; walk-out times from any cell |
| `safeZone.js` | Spare minutes and green / amber / out zone; the map image; suit numbers |
| `turnBack.js` | Turn-back timer |
| `storm.js` | Storm route home (follows the arrows) |
| `bonusStop.js` | Bonus-stop GO / NO-GO |
| `radiation.js` | Radiation dose for a walk |
| `homeFile.js` | Save / load the pre-calculated home file for the phone |
| `buildHomeFile.js` | Makes `public/safezone/home-h1.*`. **Re-run if the terrain or `SUIT` changes.** |
| `test.js` | All checks, on a toy grid and on the real terrain against Nigel's planner |
| `preview.js` | Draws the safe zone over the terrain as a PNG, for checking |

```bash
# from app/
node src/safezone/test.js             # run all checks
node src/safezone/buildHomeFile.js    # rebuild the phone file
node src/safezone/preview.js zone.png # picture of the safe zone (crew at the boxwork after 4.5 h)
```
