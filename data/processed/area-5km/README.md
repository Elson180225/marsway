# Gediz Vallis stops (5 km map, draft)

Four science stops for a second EVA on the bigger 5 km map, in and beside the **Gediz Vallis channel** on Mount Sharp. Curiosity drove through this channel in 2024, before it reached the boxwork in 2025.

- Data: `gediz-stops.json` (this folder). Photos: `app/public/photos/gediz-*.jpg`.
- Status: **draft**. The app does not load these stops yet.
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

- [ ] **x / y.** Empty until `area-5km/area.json` exists. Then `x = easting − west edge`, `y = northing − south edge` (easting and northing are already in the JSON).
- [ ] **Habitat.** Pick the habitat for the 5 km map, then confirm the stop order and the bonus stop.
- [ ] **Route check.** Run Nigel's `planRoute` once the terrain is ready: every stop reachable, no stop on a no-go slope, whole walk fits the 6 h suit budget.
- [ ] **Safety.** Rebuild the time-home map and home file for the new habitat, so the safe zone, turn-back timer and bonus GO / NO-GO work on this map.
- [ ] **Science check** by Kelly.

## Test

```bash
node app/src/gediz-stops.test.js
```

Checks ids, order, one bonus stop, real waypoints (sols 4100–4400), photos and credits. The terrain checks (on the map, walkable, not no-go) run automatically once `area-5km/area.json` exists.

## What this does not claim

- These are proposals placed on rover waypoints so the coordinates are real. They are not a NASA traverse plan.
- No walk times, safe zone or route have been calculated yet for this map.
