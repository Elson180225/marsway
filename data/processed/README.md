# MarsWay terrain data

Our EVA area: a **3 km × 3 km square on Mount Sharp, Gale Crater**, centred on the boxwork that Curiosity explored in 2025
(about 137.35°E to 137.40°E, 4.78°S to 4.84°S).
Made by `scripts/prepare_terrain.py` from the USGS *MSL Gale Merged DEM 1m v3*.

## Coordinates (everyone use these)

- Local metres: **x = metres east** of the west edge (0 to 3000), **y = metres north** of the south edge (0 to 3000).
- The grids are **600 × 600 cells, 5 m each**. **Row 0 is the north edge.** Values go row by row, west to east.
- Cell `(col, row)` centre: `x = (col + 0.5) * 5`, `y = 3000 - (row + 0.5) * 5`.
- Value of cell `(col, row)`: `data[row * width + col]`.

## Files

| File | What it is | Who uses it |
|---|---|---|
| `area.json` | Size, bounds, how to place images in Leaflet, suggested slope limits, 3 habitat site candidates | Everyone |
| `elevation.json` | Height of each cell (metres) | Nigel, Mia |
| `slope.json` | Steepness of each cell (degrees). Warn above 15, no-go above 25 | Nigel, Mia |
| `roughness.json` | How bumpy each cell is (degrees). Higher = rockier, slower walking | Nigel, Mia |
| `basemap.png` | Coloured, shaded terrain picture (1500 × 1500 px, 2 m per pixel) | Aaron, Russell |
| `slope.png` | See-through steepness overlay, one pixel per cell (green < 10°, yellow 10–15°, orange 15–25°, red > 25°) | Aaron, Russell |
| `curiosity_track.json` | Curiosity's real stops in our area (sol, x, y), from NASA's waypoint list | Kelly, Aaron, Russell |
| `SCIENCE-STOPS.md` | Provenance for the four EVA science stops. The file the app loads is `app/public/routes/science-stops.json` | Kelly, Nigel, Aaron, Russell |
| `area-5km/gediz-stops.json` | **Draft:** four Gediz Vallis stops for the 5 km map, with Curiosity photos. Not loaded by the app yet. See `area-5km/README.md` | Kelly, Nigel, Mia |

## Leaflet (Aaron, Russell)

```js
const map = L.map('map', { crs: L.CRS.Simple, minZoom: -3 });
const bounds = [[0, 0], [3000, 3000]];          // [y, x] in metres
L.imageOverlay('data/processed/basemap.png', bounds).addTo(map);
L.imageOverlay('data/processed/slope.png', bounds, { opacity: 0.8 });   // add as a toggle layer
map.fitBounds(bounds);
// a point at x metres east, y metres north is L.latLng(y, x)
```

## Grid (Nigel, Mia)

```js
const slope = await (await fetch('data/processed/slope.json')).json();
const s = (col, row) => slope.data[row * slope.width + col];   // degrees
```

## Habitat candidates

`area.json → habitatCandidates`: flat (about 3–4° on average over ~100 m), smooth spots 1.4–1.5 km from the boxwork.
H1 (x 448, y 518) is the flattest. Pick one together as the habitat for the mission.

## Rebuild

```bash
conda activate marsway
python scripts/prepare_terrain.py --dem "<path>/MSL_Gale_DEM_Mosaic_1m_v3.tif" --waypoints https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
```

Change the area with `--center-x`, `--center-y` (DEM metres) and `--size`; change grid detail with `--cell`.

## Kelly science layers and stops

CTX photo (`ctx.png`), CRISM mineral browse overlays (`crism_hyd.png`, `crism_alt.png`) and THEMIS night infrared (`themis_night.png`) are cropped to this same area. Each has a JSON source/limitations sidecar. THEMIS is relative brightness, not temperature in degrees. See `data/processed/KELLY-HANDOFF.md` for legends, stop exports, rebuild commands and integration details. Four photo stops with one-line `why` fields are in `app/public/routes/science-stops.json`; matching `stops.json` exports are in `data/processed/` and `app/public/routes/`.
