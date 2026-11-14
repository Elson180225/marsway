# Gediz Vallis stops (5 km map, draft)

Four science stops for a second EVA on the bigger 5 km map, in and beside the **Gediz Vallis channel** on Mount Sharp. Curiosity drove through this channel in 2024, before it reached the boxwork in 2025.

- Data: `gediz-stops.json` (this folder). Photos: `app/public/photos/gediz-*.jpg`.
- Status: **draft**, placed on the 5 km map. The app does not load these stops yet (it still uses the 3 km map).
- Same format and photo rules as Kelly's EVA-07 stops (see `../SCIENCE-STOPS.md` and `../KELLY-HANDOFF.md`).

Stop names are mission roles for a proposed astronaut EVA. Every coordinate is a real Curiosity waypoint from NASA/JPL's MSL waypoint list.

## The stops

| Order | ID | Name | Waypoint sol | Visit | Why go |
|---|---|---|---|---:|---|
| 1 | `mineral-king` | Mineral King Drill Site | 4102 | 20 min | Drill hole in Mt. Sharp bedrock at the edge of the channel, to compare with the debris inside it |
| 2 | `sulfur-crystals` | Sulfur Crystal Field | 4200 | 30 min | The first pure sulfur crystals found on Mars, and the field of white sulfur stones around them |
| 3 | `kings-canyon` | Kings Canyon Drill Site | 4255 | 30 min | A block on the channel floor: what the Gediz Vallis flows carried down from higher up |
| 4 | `channel-panorama` | Gediz Vallis Panorama (**bonus**) | 4350 | 15 min | View of the whole channel and the buttes Texoli and Kukenán before heading back |

Visit times are team estimates for science work at the stop, not counting walking. Order and visit times are provisional until the habitat for this map is chosen.

## Photographs

All four are nearby views from Curiosity's Mastcam, taken while the rover was parked at or just beside the waypoint. Credit for all: NASA/JPL-Caltech/MSSS.

| Stop | Photo sol | Product | Distance from stop | Source |
|---|---|---|---:|---|
| Mineral King | 4107 | `4107MR1054040012003650E01_DXXX` | 5.8 m | [Sols 4112–4113: In the Presence of Royalty](https://science.nasa.gov/blog/sols-4112-4113-in-the-presence-of-royalty/) |
| Sulfur Crystal Field | 4208 | PIA26309 | 0.8 m | [Curiosity Views Sulfur Crystals Within a Crushed Rock](https://science.nasa.gov/photojournal/curiosity-views-sulfur-crystals-within-a-crushed-rock/) |
| Kings Canyon | 4263 | `4263MR1062120011704541E01_DXXX` | 1.6 m | [Sols 4268–4269: Admiring Kings Canyon](https://science.nasa.gov/blog/sols-4268-4269-admiring-kings-canyon/) |
| Gediz Vallis Panorama | 4352 | PIA26471 | 19.1 m | [Curiosity Makes Rover Tracks While Heading West](https://science.nasa.gov/photojournal/curiosity-makes-rover-tracks-while-heading-west/) |

The photo sol is not its own waypoint in each case, so every photo is labelled a nearby view. The distance is between the two waypoints either side of the photo sol.

## Still to do

- [x] **x / y.** Filled in from the 5 km map (`area-5km/area.json`, PR #20): `x = easting − 8141000`, `y = northing + 287000`. All four stops sit at x 3619–3885, y 3233–3660, well inside the map (0–5000), and each lands exactly on its Curiosity waypoint in `area-5km/curiosity_track.json`.
- [x] **Home base.** EVA-08 is rover-assisted: the crew drives from H1 (x 1047.5, y 917.5) to staging point **G2** (x 3192.5, y 3542.5, flat, about 4°, about 550 m from Gediz), parks the rover, walks the four stops and comes back to the rover. So for EVA-08, home = the rover at G2.
- [x] **Route check (first pass).** Nigel's `planRoute` from G2: every stop reachable, none on a no-go slope. About 55 min walking + 95 min science = 2 h 30 min, out of 6 h usable. Two legs have a steep-slope caution (G2 → Mineral King, Kings Canyon → Panorama). Nigel to confirm.

  | Leg | Distance | Walk |
  |---|---:|---:|
  | G2 → Mineral King | 633 m | 17 min |
  | Mineral King → Sulfur Crystal Field | 374 m | 13 min |
  | Sulfur Crystal Field → Kings Canyon | 102 m | 4 min |
  | Kings Canyon → Gediz Vallis Panorama (bonus) | 402 m | 11 min |
  | Gediz Vallis Panorama → back to the rover | 438 m | 10 min |
- [x] **Safety.** Home file for EVA-08 built: `app/public/safezone/home-g2.*` (home = rover at G2, 5 km grid). The phone loads it with `loadHomeFile('/safezone/home-g2')`. Back to the rover: Mineral King 15 min, Sulfur Crystal Field 18 min, Kings Canyon 19 min, Panorama 10 min. In a solar storm, the storm route leads back to the rover. See `app/src/safezone/README.md`.
- [x] **6 km map.** `area-6km/` (PR #22) has the same bottom-left corner (west 8141000, south −287000), so the stop x/y and G2 stay the same. Home file rebuilt on the 1200 × 1200 grid as `app/public/safezone/home-g2-6km.*` (7.2 MB); the times back to the rover and every leg are identical to the 5 km map. `home-g2` (5 km) stays until everyone has switched.
- [ ] **Suit time during the drive.** Team to decide: if the crew is suited for the H1 → G2 drive, that time counts toward the 8 h suit.
- [ ] **On screen.** Aaron (Planning) and Russell (Walk) add EVA-08 when they switch to the bigger map.
- [ ] **Science check** by Kelly.

## Test

```bash
node app/src/gediz-stops.test.js
```

Checks ids, order, one bonus stop, real waypoints (sols 4100–4400), photos and credits. The terrain checks (on the map, walkable, not no-go) run automatically once `area-5km/area.json` exists.

## What this does not claim

- These are proposals placed on rover waypoints so the coordinates are real. They are not a NASA traverse plan.
- Walk times are model estimates from the team's suit assumptions, not a NASA traverse plan.
