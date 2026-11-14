"""
MarsWay terrain preparation (Map Maker 1).

Cuts a square area out of the USGS "MSL Gale Merged DEM 1m" and writes the
small files the app and the Pathfinders use (see data/processed/README.md):

  area.json            where the area is, grid size, how to place things on the map
  elevation.json       height of every grid cell (metres)
  slope.json           steepness of every grid cell (degrees)
  roughness.json       how bumpy the ground is inside each cell (degrees)
  basemap.png          coloured, shaded terrain picture of the area
  slope.png            see-through steepness overlay (green / yellow / orange / red)
  curiosity_track.json Curiosity's real stops inside the area (optional)

Run (from the repo root, inside the conda env):
  conda activate marsway
  python scripts/prepare_terrain.py --dem "<path to MSL_Gale_DEM_Mosaic_1m_v3.tif>" \
      --waypoints "<path or URL to MSL_waypoints.json>"
"""
import argparse
import json
import math
import os
import urllib.request

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy import ndimage
import matplotlib

matplotlib.use("Agg")
from matplotlib import colors as mcolors
import matplotlib.pyplot as plt

MARS_R = 3396190.0  # Mars 2000 sphere radius used by the DEM's projection
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"


def block_reduce(a, k, fn):
    h, w = a.shape[0] // k, a.shape[1] // k
    return fn(a[: h * k, : w * k].reshape(h, k, w, k), axis=(1, 3))


def slope_deg(z, cell):
    dzdy, dzdx = np.gradient(z, cell)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def hillshade(z, cell, azimuth=315.0, altitude=45.0):
    dzdy, dzdx = np.gradient(z, cell)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, dzdy)
    az, alt = math.radians(azimuth), math.radians(altitude)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0, 1)


def write_grid(path, arr, cell, units, decimals, note):
    data = {
        "width": int(arr.shape[1]),
        "height": int(arr.shape[0]),
        "cellSize": cell,
        "units": units,
        "rowOrder": "row 0 is the NORTH edge; values are row by row, west to east",
        "note": note,
        "data": [round(float(v), decimals) for v in arr.ravel()],
    }
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dem", required=True)
    ap.add_argument("--center-x", type=float, default=8143100.0, help="metres east (DEM projection)")
    ap.add_argument("--center-y", type=float, default=-285100.0, help="metres north (DEM projection)")
    ap.add_argument("--size", type=int, default=3000, help="area width/height in metres")
    ap.add_argument("--cell", type=int, default=5, help="grid cell size in metres")
    ap.add_argument("--basemap-res", type=int, default=2, help="basemap metres per pixel")
    ap.add_argument("--waypoints", default=None, help="path or URL of NASA MSL_waypoints.json (optional)")
    ap.add_argument("--out", default=os.path.join("data", "processed"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    half = args.size / 2
    west, east = args.center_x - half, args.center_x + half
    south, north = args.center_y - half, args.center_y + half

    with rasterio.open(args.dem) as src:
        win = from_bounds(west, south, east, north, src.transform).round_offsets().round_lengths()
        dem = src.read(1, window=win).astype("float64")
        nodata = src.nodata
    dem = dem[: args.size, : args.size]
    bad = (dem < -30000) | (dem == nodata)
    if bad.any():
        print(f"warning: {bad.mean() * 100:.2f}% of the area has no data; filling from neighbours")
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        dem = dem[tuple(idx)]

    c = args.cell
    elev = block_reduce(dem, c, np.mean)                      # height per cell
    slope = slope_deg(elev, c)                                 # steepness at cell scale
    slope1m = slope_deg(dem, 1.0)                              # steepness at 1 m (rocks, ledges)
    rough = block_reduce(slope1m, c, np.std)                   # bumpiness inside each cell
    h, w = elev.shape

    # ---------- grids ----------
    write_grid(os.path.join(args.out, "elevation.json"), elev, c, "metres (relative to the Mars datum)", 2,
               "Average height of each cell.")
    write_grid(os.path.join(args.out, "slope.json"), slope, c, "degrees", 1,
               "Steepness of each cell. 0 = flat. Suggested: warn above 15, no-go above 25.")
    write_grid(os.path.join(args.out, "roughness.json"), rough, c, "degrees", 1,
               "How bumpy the ground is inside each cell (spread of 1 m slopes). Higher = rockier / harder to walk.")

    # ---------- basemap: colour relief x hillshade ----------
    r = args.basemap_res
    z = block_reduce(dem, r, np.mean)
    lo, hi = np.percentile(z, [1, 99])
    mars = mcolors.LinearSegmentedColormap.from_list(
        "mars", ["#2a1410", "#5c2a18", "#8f4424", "#b8683a", "#d99a62", "#efd1a3"])
    rgb = mars(np.clip((z - lo) / (hi - lo), 0, 1))[..., :3]
    hs = hillshade(z, r)
    shaded = rgb * (0.35 + 0.75 * hs[..., None])
    plt.imsave(os.path.join(args.out, "basemap.png"), np.clip(shaded, 0, 1))

    # ---------- slope overlay (RGBA, see-through), one pixel per grid cell so it matches slope.json ----------
    s2 = slope
    over = np.zeros(s2.shape + (4,))
    for lim_lo, lim_hi, col, alpha in [(0, 10, (0.20, 0.75, 0.35), 0.25), (10, 15, (0.95, 0.85, 0.20), 0.45),
                                       (15, 25, (0.98, 0.55, 0.15), 0.60), (25, 90, (0.90, 0.15, 0.15), 0.75)]:
        m = (s2 >= lim_lo) & (s2 < lim_hi)
        over[m] = (*col, alpha)
    plt.imsave(os.path.join(args.out, "slope.png"), over)

    # ---------- habitat candidates: flat, smooth, 0.8-1.6 km from the boxwork centre ----------
    flat = ndimage.uniform_filter(slope, size=21)              # ~100 m neighbourhood
    smooth = ndimage.uniform_filter(rough, size=21)
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot((xx + 0.5) * c - half, (h - yy - 0.5) * c - half)
    score = flat + 0.5 * smooth
    score[(dist < 800) | (dist > 1600)] = np.inf
    score[:15, :] = score[-15:, :] = np.inf
    score[:, :15] = score[:, -15:] = np.inf
    cands = []
    s = score.copy()
    for _ in range(3):
        i = np.unravel_index(np.argmin(s), s.shape)
        if not np.isfinite(s[i]):
            break
        row, col = int(i[0]), int(i[1])
        cands.append({"col": col, "row": row, "x": round((col + 0.5) * c, 1), "y": round(args.size - (row + 0.5) * c, 1),
                      "meanSlopeDeg": round(float(flat[i]), 1), "distanceToBoxworkM": round(float(dist[i]))})
        s[max(0, row - 60):row + 60, max(0, col - 60):col + 60] = np.inf   # keep candidates ~300 m apart

    # ---------- Curiosity track ----------
    track = []
    if args.waypoints:
        src_wp = args.waypoints
        if src_wp.startswith("http"):
            req = urllib.request.Request(src_wp, headers={"User-Agent": "marsway-hackathon"})
            wp = json.load(urllib.request.urlopen(req, timeout=120))
        else:
            wp = json.load(open(src_wp))
        for feat in wp["features"]:
            p = feat["properties"]
            if west <= p["easting"] <= east and south <= p["northing"] <= north:
                track.append({"sol": p["sol"], "x": round(p["easting"] - west, 1), "y": round(p["northing"] - south, 1),
                              "lon": p["lon"], "lat": p["lat"], "elevation": p["elev_geoid"]})
        track.sort(key=lambda t: t["sol"])
        with open(os.path.join(args.out, "curiosity_track.json"), "w") as f:
            json.dump({"source": "NASA/JPL MSL waypoints (" + WAYPOINTS_URL + ")",
                       "coords": "x, y in local metres (same as area.json)", "points": track}, f, indent=1)

    deg = lambda m: round(math.degrees(m / MARS_R), 5)
    area = {
        "name": "MarsWay EVA area: Mount Sharp boxwork, Gale Crater",
        "source": "USGS Astrogeology, Mars MSL Gale Merged DEM 1m v3 (Parker & Calef)",
        "sizeMetres": args.size,
        "cellSize": c,
        "width": w,
        "height": h,
        "localCoords": ("x = metres east of the WEST edge (0..size), y = metres north of the SOUTH edge (0..size). "
                        "Grid cell (col,row) centre: x = (col+0.5)*cellSize, y = size - (row+0.5)*cellSize. Row 0 = north edge."),
        "leaflet": {"crs": "L.CRS.Simple", "imageBounds": [[0, 0], [args.size, args.size]],
                    "note": "Leaflet uses [y, x] order. basemap.png and slope.png both fill imageBounds exactly."},
        "boundsProjected": {"west": west, "east": east, "south": south, "north": north,
                            "crs": "Mars 2000 sphere, Equidistant Cylindrical, centre lon 0 (metres)"},
        "boundsLonLat": {"west": deg(west), "east": deg(east), "south": deg(south), "north": deg(north)},
        "elevation": {"min": round(float(elev.min()), 1), "max": round(float(elev.max()), 1)},
        "suggestedLimits": {"slopeWarnDeg": 15, "slopeNoGoDeg": 25},
        "habitatCandidates": cands,
        "curiosityPointsInArea": len(track),
        "files": {"elevation": "elevation.json", "slope": "slope.json", "roughness": "roughness.json",
                  "basemap": "basemap.png", "slopeOverlay": "slope.png", "curiosityTrack": "curiosity_track.json"},
    }
    with open(os.path.join(args.out, "area.json"), "w") as f:
        json.dump(area, f, indent=2)

    print(f"area {args.size} m square, grid {w}x{h} at {c} m, elevation {area['elevation']}")
    print(f"slope: median {np.median(slope):.1f} deg, >15: {(slope > 15).mean() * 100:.1f}%, >25: {(slope > 25).mean() * 100:.1f}%")
    print("habitat candidates:", cands)
    print("curiosity points in area:", len(track))


if __name__ == "__main__":
    main()
