# EVA-08 Gediz science review

**Decision: ready for science content**, reviewed by Kelly on 14 November 2026. This covers the four proposed stop descriptions, photo subjects and attribution, waypoint provenance and honest location labels. It does not certify the visit order, drive assumptions, storm shelter or route safety. The stop coordinates, visit times and bonus choice were retained.

## Checks and corrections

| Stop | Source / photo check | Science correction |
|---|---|---|
| Mineral King | [NASA campaign update](https://science.nasa.gov/blog/sols-4112-4113-in-the-presence-of-royalty/): Mastcam, sol 4107, NASA/JPL-Caltech/MSSS; drill hole and tailings. | Removed the unsupported multi-sol drilling interval and exact-workspace implication. The proposed target is a rover waypoint associated with the campaign, not a surveyed hole position. |
| Sulfur Crystal Field | [NASA PIA26309](https://science.nasa.gov/photojournal/curiosity-views-sulfur-crystals-within-a-crushed-rock/): Mastcam, sol 4208, 7 June 2024, NASA/JPL-Caltech/MSSS; Convict Lake fragments, approximately 13 cm across, colour adjusted. | Kept elemental-sulfur identification and uncertain formation history. Removed the implication that all similar white rocks are independently confirmed sulfur. |
| Kings Canyon | [NASA campaign update](https://science.nasa.gov/blog/sols-4268-4269-admiring-kings-canyon/): Mastcam, sol 4263, 3 August 2024 at 07:56:55 UTC, NASA/JPL-Caltech/MSSS. [SAM follow-up](https://science.nasa.gov/blog/sols-4273-4274-prep-rally/) documents sample delivery. | Qualified the waypoint-to-drill-site association. Reframed transport of a particular block as an investigation rather than an established origin. |
| Gediz Vallis Panorama | [NASA PIA26471](https://science.nasa.gov/photojournal/curiosity-makes-rover-tracks-while-heading-west/): Mastcam, sol 4352, 2 November 2024, NASA/JPL-Caltech/MSSS; two mosaics, 171 and 169 frames, Texoli at left and Kukenán at right, colour adjusted. | Removed the unverified climb and whole-channel viewpoint claim. Kept an optional channel-exit context-photography task; identified black mosaic gaps so they are not mistaken for mapped terrain. |

All four local JPEGs were opened and visually inspected. Photo sols, camera/instrument names and credits match the source pages. Existing raw-product identifiers and the Mineral King UTC field are retained from Mia's metadata; the Mineral King blog itself states the sol rather than the precise UTC. Unknown UTC fields for the two Photojournal mosaics remain null.

## Important location-label correction

The draft `photo_offset_m` values were **distances between waypoints before and after a photo sol**, not distances from the target waypoint to the camera. An endpoint separation neither measures the intermediate camera position nor bounds the rover path. No source track point exists for these exact photo sols.

The corrected records therefore retain `photo_view: "nearby"`, use `photo_offset_m: null` and `photo_offset_status: "unverified"`, and state that the exact camera-to-stop distance is unknown. The temporal endpoints and their rounded-coordinate separation are retained in `photo_waypoint_bracket` for provenance only. A different sol alone does not prove that the rover moved.

This also prevents the existing Walk card from presenting those bracket gaps as measured photo offsets, since it displays a numeric distance only when `photo_offset_m` is finite. No Walk component was changed.

## Coordinates, status and integration

- The four x/y and lon/lat records match the supplied Curiosity track for sols 4102, 4200, 4255 and 4350. Projected positions agree with local positions within the input rounding.
- The archived 5 km crop and current 6 km app map share west 8141000 / south −287000, so these local positions do not need shifting.
- Set both `data/processed/area-5km/gediz-stops.json` and its runtime copy `app/public/routes/gediz-stops.json` to `ready`; the test checks exact equality to prevent drift.
- Replaced the EVA-08 route's hardcoded draft provenance with the supplied science status. The approved data no longer appears as an unreviewed demo target in Planning. This changes metadata propagation only.
- Kept `channel-panorama` as the sole optional bonus, with visits 20 / 30 / 30 / 15 minutes. These are team activity estimates, not rover measurements.

## Validation

Passed:

- `node app/src/gediz-stops.test.js`: ready status, identical runtime data, all four waypoint matches, map bounds, photos, credits, honest nearby labels and unknown offsets.
- `node app/src/gedizPlanning.test.js`: science status reaches the route; current 6 km route/schedule integration remains intact.
- `node app/src/route-integration.test.js`: shared-route checks.
- `npm.cmd run build` from `app/`: Planning and Walk entries build.
- Local JPEG integrity checks with Pillow; `git diff --check`.
- Local Chrome check at `/?eva=08`: all four photos load, descriptions and source links match the reviewed data, all four nearby labels are present, no draft/demo badge remains, and only the panorama has the optional-bonus badge. [Rendered values](review/planning-review.json) and screenshots: [Mineral King](review/mineral-king.png), [sulfur](review/sulfur-crystals.png), [Kings Canyon](review/kings-canyon.png), [panorama](review/channel-panorama.png).

The unrelated EVA-07 `science-stops.test.js` still fails on the base `main` data because the old `routes/stops.json` copy contains pre-crop coordinates. Kelly's separate `kelly/tidy-science-stop-export` branch removes that unused duplicate and updates its test. This review does not incorporate or hide that separate cleanup.

No live deployment or physical-phone review is claimed here. Aaron owns final EVA-08 Planning presentation; Russell owns EVA-08 Walk integration. Mia/Nigel retain the route and safety review. The pre-existing safety documentation in this folder should not be treated as Kelly approval that an open rover provides storm shelter.
