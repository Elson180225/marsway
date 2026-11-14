# Kelly: map layers and science stops

Built on the existing local data and photo work, for Elson's unchanged 3,000 m square in `area.json`. The game-plan PDF is background context; this handoff covers Kelly's requested data and stops. Deployment, safety models and the task board belong to the other team roles.

## Deliverables

All four PNGs below are 600 by 600 pixels, north up, cropped to the same area. In Leaflet `L.CRS.Simple`, use bounds `[[0, 0], [3000, 3000]]`. The 5 m output grid does not increase the native resolution of CRISM or THEMIS.

| File | Source / resolution | Interpretation |
|---|---|---|
| `ctx.png` + `ctx.json` | Murray Lab CTX beta01 via Esri; approximately 5 m | Real orbital context photo. Uncontrolled mosaic; alignment with the DEM is uncertain by tens of metres. Automated correlation was inconclusive; no shift has been applied. |
| `crism_hyd.png` + `crism.json` | CRISM Gale HYD prototype browse mosaic; approximately 19 m | Hydrated mineral signals: green/yellow monohydrated sulfates, magenta polyhydrated sulfates, blue other hydrated minerals. |
| `crism_alt.png` + `crism.json` | CRISM Gale ALT prototype browse mosaic; approximately 19 m | Alteration signals: green/blue-green hydrated sulfates, red Fe/Mg clays. |
| `themis_night.png` + `themis_night.json` | Mars Trek THEMIS night mosaic v14; delivered tiles approximately 163 m | Relative night infrared brightness, with only about 18 source pixels across the area. No calibrated temperature in degrees is available in these files. |

CRISM is qualitative, not mineral abundance. Transparent pixels indicate no signal or no coverage; they do not establish mineral absence. Native resolution is too coarse to identify minerals on a particular ridge. THEMIS is a mosaic from different observations, not current weather or a temperature forecast. The layers have matching geographic bounds; that does not guarantee precise registration between instruments.

Sources, product URLs, credits, crop windows and limitations are preserved in the JSON sidecars. The identical runtime copies are in `app/public/terrain/`.

## Four proposed stops

| Stop | Local x, y (metres) | Why visit? | Photograph |
|---|---|---|---|
| Boxwork Lookout | 1561.5, 1639.7 | Document ridge directions and evidence for ancient groundwater. | Navcam sol 4657; nearby view, about 19.5 m from the coordinate waypoint. |
| Ridge Sample | 1633.2, 1591.2 | Compare resistant ridge rock with hollow material to investigate mineral cement. | Navcam sol 4671; photographed from this waypoint. |
| Hollow Comparison | 1517.7, 1800.5 | Obtain a lower-ground comparison with the resistant ridges. | Navcam sol 4662; nearby view, about 179 m south. |
| Mineral Investigation | 1767.9, 2090.5 | Use the Altadena drilling investigation as context for ground mineral checks. | Mastcam sol 4564; nearby Altadena drill-hole view. |

These are proposed astronaut roles at real rover waypoints, not verified ridge-top or hollow-floor sampling locations. Mineral Investigation has not been selected from a quantified CRISM anomaly. Photographs, NASA source links, credits, camera names, photo sols and coordinate sols are retained in the stop records. Full provenance is in `SCIENCE-STOPS.md`.

`app/public/routes/science-stops.json` remains the source the existing Planning and Walk loaders use. The requested `stops.json` is exported with the same object shape (`status`, `source`, `stops`) to `data/processed/stops.json` and `app/public/routes/stops.json`. Each stop now includes `why` as well as the detailed `description` and photo fields. Local x/y use metres east/north from the southwest corner; Leaflet uses `[y, x]`. Longitude/latitude fields are Mars geographic coordinates, not Earth positions.

## Rebuild and check

### Visit times and bonus-stop contract

The array is the EVA visit order, also recorded by `order` (1 through 4). `stop_minutes` is time spent doing science at that stop, excluding walking: lookout 15 min, ridge 30 min, hollow 30 min, mineral investigation 20 min. These are adjustable team estimates for astronauts, not measured rover activity durations. Required-stop science time is 75 min; all four stops total 95 min. Walking-time estimates elsewhere in this document exclude these visits.

Exactly one stop has `is_bonus: true`: `mineral-investigation` (order 4). The top-level `bonus_stop_id` identifies it for data consumers; the shared route retains the stop-level fields. Russell can select it from the loaded route and pass its duration to Mia's existing API:

```js
const bonus = route.stops.find((stop) => stop.is_bonus === true)
// bonusStopCheck(grid, timeHome, {
//   here, bonus, elapsedMinutes, stopMinutes: bonus.stop_minutes
// })
```

Include completed science visits in `elapsedMinutes`; the GO/NO-GO check must allow time to walk to the bonus stop, spend its `stop_minutes` there, and walk home before the protected reserve. The current branch's Walk screen still needs Russell's integration to consume visit durations and the bonus marker; adding data does not change its timer automatically.

From the repository root, with Python, NumPy and Pillow installed:

```powershell
python scripts/prepare_ctx.py
python scripts/prepare_crism.py
python scripts/prepare_themis.py
python scripts/export_science_stops.py
node app/src/science-stops.test.js
```

The three raster scripts download public source data and regenerate both processed and app copies. The stop export is offline. Edit the existing `science-stops.json`, then rerun the export whenever stop metadata changes.

## Aaron's integration

The current app already loads the four stops and photos. Its layer buttons currently expose relief, slope and roughness; the new science raster files are ready for Aaron to connect. Example:

```js
const bounds = [[0, 0], [3000, 3000]]
const ctx = L.imageOverlay('/terrain/ctx.png', bounds)
const minerals = L.imageOverlay('/terrain/crism_hyd.png', bounds, { opacity: 0.65 })
const nightIR = L.imageOverlay('/terrain/themis_night.png', bounds)
```

Use layer labels such as **CTX photo**, **Hydrated mineral signals**, **Alteration signals**, and **Night IR brightness**. Display the corresponding legends and credits from the sidecars. CRISM is best viewed over CTX; THEMIS should be viewed separately because it is opaque and much coarser. Keep routing costs tied to the existing terrain model until the pathfinding team reviews any use of these science layers.
