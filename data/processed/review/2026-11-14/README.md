# Kelly science review — 14 November 2026

**Update:** the initial PR #9 findings below were resolved and rechecked at `b064dda`. See [the exact-commit science sign-off and new screenshots](b064dda/README.md). The rest of this page preserves the earlier `3e4b836` review and main snapshot for traceability.

Reviewed merged `main` at `fbc2d4b`, locally at `http://127.0.0.1:5173` in Chrome. Planning viewport: 1440 × 1100; Walk viewport: 390 × 844 (desktop emulation, not a physical phone). This is science-content QA, not a live deployment, navigation or safety approval. No Planning or Walk implementation was changed.

## Results

| Check | Result |
|---|---|
| Four ordered stops | Pass: Boxwork Lookout, Ridge Sample, Hollow Comparison, Mineral Investigation. Shared route uses the real rover-waypoint coordinates; no grid-centre demo target. |
| Visit metadata | Pass: 15 / 30 / 30 / 20 minutes; only Mineral Investigation has `is_bonus: true`. These are proposed astronaut activity times. |
| Planning photos | Pass: all four JPEGs loaded; rendered names, photo URLs, NASA source URLs, image credits and nearby flags matched the stop records. |
| Photo provenance | NASA source pages confirm the cameras, photo sols, timestamps and credits in all four records. Nearby workspace offsets come from local waypoints, not the NASA captions. |
| Nearby labels | Pass in Planning: lookout, hollow and mineral cards visibly say “Nearby view”; ridge is from its coordinate waypoint and describes the ridge ahead of the camera. |
| Walk visit order | Pass: using the existing 300× simulation control, next-stop headings progressed through all four stops in order. |
| Walk photos and labels | Not implemented in reviewed main: Walk renders no science photo panel, credit, source link or nearby label. Therefore photo-label visibility in Walk cannot be signed off. Russell owns any desired phone photo presentation. |
| Walk science wording | Follow-up for Russell: the notice still says science stops may be demo targets, although the ready real-waypoint stop file is loaded. Keep the simulated position/clock and proposed astronaut-site caveats. The mineral stop heading also lacks an explicit optional/bonus label. |
| Planning visit / bonus labels | Data is present; the reviewed Planning stop cards do not yet display visit duration or an explicit bonus badge. Aaron owns that UI follow-up. |
| CTX/CRISM/THEMIS buttons | Reviewed Aaron's draft PR #9 at `3e4b836` in a separate temporary checkout. Four images load, toggle off and switch exclusively; route lines remain visible. The failed-image message works. Science presentation needs the follow-ups below before sign-off. |

## Science wording corrections in this branch

- CTX: removed the suggestion that registration error is bounded to tens of metres. The stored correlation result is inconclusive and its best-search shift is not a measured offset. Cropping all rasters to identical bounds does not verify alignment. No raster or stop coordinates were shifted.
- THEMIS: replaced the categorical brightness → temperature → material wording with a qualified interpretation. These files are relative 8-bit night infrared brightness from a multi-observation mosaic, not calibrated temperature, thermal inertia or a dependable material classification.
- Updated both processed/runtime sidecars and their generating scripts so a rebuild preserves these corrections. Existing CRISM qualitative browse limitations remain appropriate; no mineral abundance or ridge-scale identification is claimed.

## Aaron's PR #9 review

PR: [Orbital science layers](https://github.com/Elson180225/marsway/pull/9), head `3e4b836cc57120b9b20352efef35d67d72efafad`. Its Vercel preview requires login, so the visual review used that exact head in an isolated local checkout at port 5174. No edits were made to Aaron's branch or Planning files.

Functional browser checks passed: each image loads at 600 × 600; only one science button is active at a time; toggling off removes it; seven route/return SVG paths remain present and visually visible. Selecting Boxwork Lookout under each layer retains its nearby-photo label, NASA credit and source. Blocking the CTX image request produces the expected load-failure notice. The four per-layer screenshots and `pr9-browser-review.json` record these checks.

Science findings for Aaron, before final sign-off:

1. **Add visible orbital credits and source links.** The map attribution is only “Leaflet”; the per-layer notes have resolution/limitations but no NASA/MSSS/Murray Lab, JHUAPL or ASU credit or source link. Photo credits do not credit the orbital layers. The JSON sidecars already contain the required attribution.
2. **Add HYD and ALT colour legends.** A qualitative warning is present, but users cannot tell what each colour means. Use the product-specific sidecar legends and keep the no-abundance / no-ridge-scale-identification caveats visible.
3. **Clarify unverified alignment.** The CTX note says “by tens of metres”; use “registration unverified; offsets of tens of metres or more are possible.” Matching crop bounds and the inconclusive correlation do not establish a maximum error or justify a correction. CRISM also has not been independently registered to the DEM.
4. **Explain THEMIS context when blended.** The relative night brightness and ~163 m wording are correct. Include that only about 18 source pixels span the area. At 0.75 opacity, the fine terrain relief visible beneath the thermal layer belongs to the basemap, not THEMIS; a note or an opaque inspection option would prevent confusion about thermal detail.

The resolution and relative-brightness descriptions otherwise match the supplied products. Visit-time and optional-stop UI remain Aaron's assigned follow-up; this review does not implement them. Keep the draft PR pending these science presentation fixes and Aaron's own checks.

## Layer science checklist

| Layer | Acceptable label and required context |
|---|---|
| CTX | **CTX photo**; source tiles about 5.09 m/pixel, exported at 5 m/pixel. Uncontrolled beta01 mosaic, unverified registration to DEM; no claim of exact ridge/rover alignment. Credit NASA/JPL/MSSS/The Murray Lab (Caltech), tiles hosted by Esri. |
| CRISM HYD | **Hydrated mineral signals**; qualitative browse colours at about 19.3 m/pixel. Green/yellow monohydrated sulfates, magenta polyhydrated sulfates, blue other hydrated signals. Display the source legend with the layer. |
| CRISM ALT | **Alteration signals**; qualitative browse colours at about 19.3 m/pixel. Green/blue-green sulfate signals, red Fe/Mg clay signals. Do not infer mineral percentages or a verified anomaly at Mineral Investigation. |
| Both CRISM products | 2012 Gale prototype browse mosaics; dust/weak signal/no coverage can produce blank pixels. Credit NASA/JPL/JHUAPL and the CRISM mosaic team from `crism.json`. Output resampling to 600 × 600 adds no detail. Registration to the DEM has not been independently established. |
| THEMIS | **Night IR brightness (relative)**; nominal source mosaic 100 m/pixel, delivered tiles about 162.8 m/pixel (about 18 pixels across 3 km). No degrees C/K, current temperature, weather forecast or thermal-inertia units. Credit NASA/JPL-Caltech/ASU; NASA Mars Trek tiles. |

Check each button's displayed image and legend together, including combined-layer opacity, source links and visible limitations. Nearby-photo labels and image credits must remain visible when toggling orbital layers. Black/transparent CRISM pixels must not be presented as proof of mineral absence. Recheck these findings on Aaron's next exact PR commit before approving it.

## Evidence and validation

- [Planning lookout](planning-boxwork-lookout.png), [ridge](planning-ridge-sample.png), [hollow](planning-hollow-comparison.png), [mineral](planning-mineral-investigation.png): actual local browser captures, not mockups.
- [Phone-sized Walk at the bonus approach](walk-mineral-investigation.png); other `walk-*.png` files capture the visit sequence.
- `browser-review.json` records rendered metadata, next-stop sequence, current layer buttons and missing Walk photo labels.
- `pr9-layer-*.png` and `pr9-browser-review.json` record all four buttons, image loads, exclusivity, route visibility and the simulated load failure on Aaron's exact draft head.
- `node app/src/science-stops.test.js`: four real stops, metadata preserved through the shared route, photo files and matching exports.
- `node app/src/route-integration.test.js`: shared route integration.
- `npm.cmd run build` from `app/`: both Planning and Walk production entries.
- The science-stop test, shared-route test and both-page build also passed in the isolated checkout of Aaron's PR head `3e4b836`.
- Offline raster checks: four nonblank 600 × 600 images; processed/runtime image and sidecar bytes match; sidecar bounds match `area.json`; stop coordinates match the recorded Curiosity waypoints.

The browser review used the supplied local raster files. The original CRISM page and orbital tile-service endpoints could not be fetched by the web tool during this review; product-specific legends and resolutions were checked against repository sidecars and processing parameters. The CRISM workshop was available as a search excerpt but its full PDF exceeded the web tool's size limit; the THEMIS team PDF was read. These references support the general interpretation, not a new independent validation of these crops.

## References checked

- [NASA: Boxworks With a View](https://science.nasa.gov/blog/curiosity-blog-sols-4655-4660-boxworks-with-a-view/)
- [NASA: Winding Our Way Along](https://science.nasa.gov/blog/curiosity-blog-sols-4668-4674-winding-our-way-along/)
- [NASA: Peaking Into the Hollows](https://science.nasa.gov/blog/curiosity-blog-sols-4661-4667-peaking-into-the-hollows/)
- [NASA: Altadena Drill Hole and Tailings](https://science.nasa.gov/blog/curiosity-blog-sols-4568-4569-a-close-look-at-the-altadena-drill-hole-and-tailings/)
- [CRISM team: specialized browse product workshop](https://pds-geosciences.wustl.edu/workshops/CRISM_Workshop_Mar12_presentations/CRISM_workshop_2012_MTRDR_SUM_BRS_FPS_SLM.pdf)
- [THEMIS team: thermophysics](https://themis.asu.edu/files/thmprocdocs/fergason.pdf)

Kelly's stop/photo, data-description and PR #9 science review is complete. Final layer-button sign-off awaits Aaron's fixes above. Findings for Aaron and Russell are recorded here for the team; this branch does not implement their screens.
