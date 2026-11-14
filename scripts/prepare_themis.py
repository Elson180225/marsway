"""
MarsWay: cut the THEMIS night-time infrared layer to our EVA area (Kelly, Map Maker 2).

Source: THEMIS IR night mosaic v14 (60N-60S, 100 m/px source), streamed by NASA
Mars Trek. Finest tile level is ~163 m/px, so the 3 km area is only ~18 pixels wide.

This is RELATIVE night-time brightness, not a temperature in kelvin and not a
thermal-inertia map. Bright at night usually means ground that holds heat (rock);
dark usually means loose sand or dust. Use it for the big picture only.

Outputs (next to area.json):
  themis_night.png   greyscale, fills leaflet imageBounds; pixels are kept blocky on purpose
  themis_night.json  source, credit, resolution and limitations

Run from the repo root:
  python scripts/prepare_themis.py
"""
import argparse
import io
import json
import math
import os
import shutil
import time
import urllib.request

import numpy as np
from PIL import Image

LAYER = "Mars_MO_THEMIS-IR-Night_mosaic_60N60S_100m_v14_clon0_ly"
TILE_URL = "https://trek.nasa.gov/tiles/Mars/EQ/" + LAYER + "/1.0.0/default/default028mm/{z}/{row}/{col}.png"
CAPS = "https://trek.nasa.gov/tiles/Mars/EQ/" + LAYER + "/1.0.0/WMTSCapabilities.xml"
TILE_PX = 256
MARS_R = 3396190.0


def fetch_tile(z, row, col, tries=5):
    url = TILE_URL.format(z=z, row=row, col=col)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "marsway-hackathon"})
            data = urllib.request.urlopen(req, timeout=60).read()
            return np.asarray(Image.open(io.BytesIO(data)).convert("L"), dtype=np.float32)
        except Exception as error:
            if attempt == tries - 1:
                raise RuntimeError(f"THEMIS tile {z}/{row}/{col} failed: {error}") from error
            time.sleep(2 * (attempt + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="data/processed/area.json")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--copy-to", default="app/public/terrain")
    ap.add_argument("--zoom", type=int, default=8)
    ap.add_argument("--px", type=int, default=600)
    args = ap.parse_args()

    area = json.load(open(args.area))
    b = area["boundsProjected"]
    west, east = math.degrees(b["west"] / MARS_R), math.degrees(b["east"] / MARS_R)
    south, north = math.degrees(b["south"] / MARS_R), math.degrees(b["north"] / MARS_R)

    deg_tile = 180.0 / 2 ** args.zoom
    deg_px = deg_tile / TILE_PX
    m_px = deg_px * math.pi / 180 * MARS_R
    c0, c1 = int((west + 180) // deg_tile), int((east + 180) // deg_tile)
    r0, r1 = int((90 - north) // deg_tile), int((90 - south) // deg_tile)
    mosaic = np.zeros(((r1 - r0 + 1) * TILE_PX, (c1 - c0 + 1) * TILE_PX), dtype=np.float32)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            mosaic[(r - r0) * TILE_PX:(r - r0 + 1) * TILE_PX, (c - c0) * TILE_PX:(c - c0 + 1) * TILE_PX] = fetch_tile(args.zoom, r, c)
    lon0, lat0 = c0 * deg_tile - 180, 90 - r0 * deg_tile

    # Nearest-neighbour on purpose: smoothing would suggest detail THEMIS does not have.
    n = args.px
    frac = (np.arange(n) + 0.5) / n
    cols = np.clip(((west + frac * (east - west)) - lon0) / deg_px, 0, mosaic.shape[1] - 1).astype(int)
    rows = np.clip((lat0 - (north - frac * (north - south))) / deg_px, 0, mosaic.shape[0] - 1).astype(int)
    out = mosaic[np.ix_(rows, cols)]
    if (out < 1).mean() > 0.02:
        raise RuntimeError("THEMIS night mosaic has gaps over this area; do not use it.")

    os.makedirs(args.out, exist_ok=True)
    Image.fromarray(out.astype(np.uint8)).save(os.path.join(args.out, "themis_night.png"), optimize=True)
    source_px = int(round((east - west) / deg_px))
    meta = {
        "name": "THEMIS night-time infrared (relative brightness) for the MarsWay EVA area",
        "dataset": "THEMIS IR night mosaic v14, 60N-60S, 100 m/px source (Mars Odyssey)",
        "instrument": "Thermal Emission Imaging System (THEMIS), 2001 Mars Odyssey",
        "credit": "NASA/JPL-Caltech/Arizona State University; tiles from NASA Mars Trek",
        "trek_capabilities": CAPS,
        "source_crs": "Mars 2000 sphere (R 3396190 m), geographic / plate carree",
        "project_crs": area["boundsProjected"]["crs"],
        "zoom": args.zoom,
        "tile_m_per_px": round(m_px, 1),
        "source_pixels_across_area": source_px,
        "output_px": n,
        "bounds_lonlat": {"west": west, "east": east, "south": south, "north": north},
        "leaflet_image_bounds": area["leaflet"]["imageBounds"],
        "how_to_read": "Brighter and darker pixels show relative night infrared brightness only. In comparable observations, brighter night surfaces may retain more heat (for example rockier material), while darker surfaces may be finer sand or dust. This multi-observation 8-bit mosaic does not provide calibrated temperature, thermal inertia, or a reliable material classification.",
        "limitations": [
            f"Only about {source_px} x {source_px} real pixels cover the 3 km area (~{m_px:.0f} m each). Do not read single ridges or stops from it.",
            "Relative 8-bit brightness from a mosaic of many orbits and seasons. It is not a temperature map and not thermal inertia.",
            "Do not label it as ground temperature in the app.",
        ],
    }
    json.dump(meta, open(os.path.join(args.out, "themis_night.json"), "w"), indent=2)
    if args.copy_to:
        for name in ("themis_night.png", "themis_night.json"):
            shutil.copy(os.path.join(args.out, name), os.path.join(args.copy_to, name))
    print(f"THEMIS night: {m_px:.0f} m/px tiles, {source_px} px across the area, value range {out.min():.0f}-{out.max():.0f}")


if __name__ == "__main__":
    main()
