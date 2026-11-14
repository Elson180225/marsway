# EVA-07 science stops

Four ordered stops for the Boxwork Walk, from habitat H1 toward and through the boxwork Curiosity explored in 2025. The app loads `app/public/routes/science-stops.json`. Photographs are in `app/public/photos/`. Each stop has a one-line `why`. Run `python scripts/export_science_stops.py` to refresh the optional offline `data/processed/stops.json` handoff. Edit only `app/public/routes/science-stops.json`; the offline handoff is generated from it.

Stop names are mission roles for a proposed astronaut EVA. They are not official geologic names of these exact coordinates. Every coordinate is a real Curiosity waypoint from `curiosity_track.json` (NASA/JPL MSL waypoints). None of these stops was snapped by the route planner.

## Coordinates

Local metres match `area.json`: x is metres east of the west edge, y is metres north of the south edge. The grid is 600 by 600 cells of 5 m. Row 0 is the north edge. Leaflet uses `[y, x]`.

Checked against `area.json` on 14 November 2026:

- Area: 3 km by 3 km. Longitude 137.35372°E to 137.40433°E. Latitude 4.83512°S to 4.78450°S.
- H1: x 447.5, y 517.5. Cell column 89, row 496. Slope about 2.9°. Not blocked.

| Order | ID | Role | Waypoint sol | x | y | Column, row | Slope | Photo sol | Photo |
|---|---|---|---|---:|---:|---|---:|---|---|
| 1 | `boxwork-lookout` | Boxwork Lookout | 4660 | 1561.5 | 1639.7 | 312, 272 | 1.9° | 4657 | Nearby view, 19.5 m |
| 2 | `ridge-sample` | Ridge Sample | 4671 | 1633.2 | 1591.2 | 326, 281 | 3.7° | 4671 | Taken at this waypoint |
| 3 | `hollow-comparison` | Hollow Comparison | 4609 | 1517.7 | 1800.5 | 303, 239 | 8.7° | 4662 | Nearby view, 179 m south |
| 4 | `mineral-investigation` | Mineral Investigation | 4560 | 1767.9 | 2090.5 | 353, 181 | 4.4° | 4564 | Nearby view, Altadena hole |

All four stop cells are below the 15° warning and below the 25° no-go limit. Roughness is about 4.9° to 5.5°.

Straight-line gaps: lookout to ridge 87 m, ridge to hollow 239 m, hollow to mineral 383 m. H1 to the lookout is 1,581 m. The lookout and ridge will sit close together on the full-map view. Zoom in, or select a stop, to separate them.

## What the route planner found

Using Nigel's `planRoute` on the project slope and roughness grids (suit assumptions: warn above 15°, no-go above 25°, snap search 50 m):

| Leg | Path length | Walk time | Planner notices |
|---|---:|---:|---|
| H1 to Boxwork Lookout | 1,865 m | 50 min | steep slope, rough ground |
| Lookout to Ridge Sample | 89 m | 2 min | rough ground |
| Ridge Sample to Hollow Comparison | 262 m | 7 min | steep slope |
| Hollow Comparison to Mineral Investigation | 413 m | 11 min | steep slope, rough ground |
| Mineral Investigation back to H1 | 2,411 m | 71 min | steep slope, rough ground |

Outbound science walking is about 70 minutes and 2.6 km. The walk back from the last stop is about 71 minutes. No stop was moved. A straight line from H1 to the lookout does cross a no-go slope band, so the planned path goes around it. These times are model estimates, not a safety certification. Nigel still needs to review the path and the return.

## Photographs

Each image is the web rendition NASA already published with the blog post. Credits are copied from that page.

1. **Boxwork Lookout.** Right Navcam, sol 4657, 12 September 2025, 00:50:58 UTC. Product `NRB_810906228EDR_S1182538NCAM00594M_`. Credit: NASA/JPL-Caltech. Source: [Curiosity Blog, Sols 4655–4660: Boxworks With a View](https://science.nasa.gov/blog/curiosity-blog-sols-4655-4660-boxworks-with-a-view/). Marked nearby because the frame belongs to the sol 4655 workspace, 19.5 m from the sol 4660 stop.

2. **Ridge Sample.** Left Navcam, sol 4671, 26 September 2025, 12:54:44 UTC. Product `NLB_812159242EDR_F1190486NCAM00293M_`. Credit: NASA/JPL-Caltech. Source: [Curiosity Blog, Sols 4668–4674: Winding Our Way Along](https://science.nasa.gov/blog/curiosity-blog-sols-4668-4674-winding-our-way-along/). Taken from the same waypoint as the stop. The ridge in the picture is ahead of the camera. Not marked nearby.

3. **Hollow Comparison.** Left Navcam, sol 4662, 17 September 2025, 05:25:51 UTC. Product `NLB_811354716EDR_F1182832NCAM00282M_`. Credit: NASA/JPL-Caltech. Source: [Curiosity Blog, Sols 4661–4667: Peaking Into the Hollows](https://science.nasa.gov/blog/curiosity-blog-sols-4661-4667-peaking-into-the-hollows/). Marked nearby. The camera location is the sol 4662 waypoint, 179 m south of the sol 4609 stop. The stop is on the boxwork traverse; it is not named here as Laguna Escondida, Laguna Socompa, or Monte Grande.

4. **Mineral Investigation.** Mastcam, sol 4564, 8 June 2025, 13:57:45 UTC. Product `4564MR1077420012302300E01_DXXX`. Credit: NASA/JPL-Caltech/MSSS. Source: [Curiosity Blog, Sols 4568–4569: A Close Look at the Altadena Drill Hole and Tailings](https://science.nasa.gov/blog/curiosity-blog-sols-4568-4569-a-close-look-at-the-altadena-drill-hole-and-tailings/). The hole is Altadena, in boxwork bedrock. Powder from this hole was delivered to CheMin and SAM. Marked nearby because sol 4564 is not its own waypoint; the stop is the sol 4560 waypoint, and the team bumped less than 4 m to the block. Drill planning: [Sols 4561–4562: Prepping to Drill at Altadena](https://science.nasa.gov/blog/sols-4561-4562-prepping-to-drill-at-altadena/).

The `sol` field in the JSON is the photograph sol. `waypoint_sol` is the coordinate sol. They match for the ridge, because that frame was taken on sol 4671 at the sol 4671 waypoint. They differ for the other three stops, which is why those photographs are marked as nearby views.

## What this does not claim

- Curiosity did not visit habitat H1. H1 is the team's flat-ground candidate.
- The astronaut stops are proposals placed on rover waypoints so the coordinates are real.
- Cropped CRISM HYD/ALT browse layers and THEMIS night infrared are included; see `KELLY-HANDOFF.md`. CRISM colours are qualitative spectral signals. THEMIS is relative brightness, not calibrated temperature or thermal inertia. Neither resolves individual boxwork ridges.
- The shaded basemap is a colour relief made from the USGS MSL Gale Merged DEM 1 m v3. It is not a HiRISE photograph.
- Walk times use the team's spacesuit assumptions. They are not a NASA traverse plan.

## Short demonstration

1. Open Planning. H1 is at the southwest. The four stops run northeast into the boxwork.
2. Select Boxwork Lookout. The card says Nearby view, shows the Navcam credit, and links to the NASA blog.
3. Select Ridge Sample. This photograph is from that waypoint. The caption names the two hollows beside the ridge.
4. Select Hollow Comparison. The nearby label stays, because the picture is from 179 m south.
5. Select Mineral Investigation. The Mastcam frame is the Altadena drill hole. The return estimate is the optional go / no-go check.
6. Open the Walk screen. It uses the same route loader, so the stop ids and order match Planning. Russell's screen does not draw the photographs; those stay on the Planning card. The clock and position are still a simulation.
