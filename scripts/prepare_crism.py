"""
MarsWay: cut CRISM mineral browse mosaics to our EVA area (Kelly, Map Maker 2).

Source: CRISM team "Specialized Browse Product Mosaics" for the MSL Gale Crater
site (July 2012, MTRDR prototypes, registered to a CTX basemap). Simple
cylindrical on the Mars 2000 sphere at 3072 px/deg (19.295 m/px), the same
projected metres as area.json -> boundsProjected, so the crop is a pixel window.

Products cut here:
  HYD  hydrated sulfates: monohydrated green/yellow, polyhydrated magenta, other hydrated blue
  ALT  alteration at Gale: hydrated sulfates green / blue-green, Fe/Mg clays red

These are QUALITATIVE browse colours, not mineral abundances. Black = no CRISM
coverage or no signal above the stretch floor.

Outputs (next to area.json): crism_hyd.png, crism_alt.png, crism.json

Run from the repo root:
  python scripts/prepare_crism.py
"""
import argparse
import io
import json
import os
import shutil
import time
import urllib.request

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
BASE = "http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/{p}/MSL_gale_crater_targeted_mosaic_{p}_120723.{ext}"
PAGE = "http://crism.jhuapl.edu/msl_landing_sites/index_news.php"
PRODUCTS = {
    "HYD": "Hydrated sulfates. R SINDEX2, G BD2100_2, B BD1900_2. Monohydrated sulfates green or yellow; polyhydrated sulfates magenta; other hydrated minerals blue.",
    "ALT": "Alteration minerals at Gale. R D2300, G SINDEX2, B BD1900_2. Hydrated sulfates green or blue-green; Fe/Mg clays red.",
}


def get(url, tries=5):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "marsway-hackathon"})
            return urllib.request.urlopen(req, timeout=180).read()
        except Exception as error:
            if attempt == tries - 1:
                raise RuntimeError(f"{url} failed: {error}") from error
            time.sleep(3 * (attempt + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="data/processed/area.json")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--copy-to", default="app/public/terrain")
    ap.add_argument("--px", type=int, default=600)
    args = ap.parse_args()
    area = json.load(open(args.area))
    b = area["boundsProjected"]

    meta = {
        "name": "CRISM mineral browse layers for the MarsWay EVA area",
        "dataset": "CRISM Specialized Browse Product Mosaics, MSL Gale Crater, 23 July 2012 (MTRDR prototypes)",
        "instrument": "Compact Reconnaissance Imaging Spectrometer for Mars (CRISM), Mars Reconnaissance Orbiter",
        "credit": "NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos, C. Viviano (CRISM team)",
        "source_page": PAGE,
        "source_crs": "Simple cylindrical, Mars 2000 sphere, centre (0, 0), 3072 px/deg = 19.295 m/px",
        "project_crs": area["boundsProjected"]["crs"],
        "registration": "CRISM team warped each observation onto a CTX basemap (ENVI RST); small offsets may remain.",
        "leaflet_image_bounds": area["leaflet"]["imageBounds"],
        "products": {},
        "limitations": [
            "Qualitative browse colours with a Gale-specific stretch. Brighter colour is a stronger spectral signal than elsewhere at Gale, not a percentage of mineral.",
            "About 19 m per pixel, so roughly 155 pixels across the 3 km area. Individual boxwork ridges (metres wide) are not resolved.",
            "Dust hides minerals: a black or bland pixel does not mean the mineral is absent.",
            "2012 prototype products, before the final PDS MTRDR release. Ice haze can add false blue.",
        ],
    }
    for product, legend in PRODUCTS.items():
        tfw = [float(v) for v in get(BASE.format(p=product, ext="tfw")).decode().split()]
        px, _, _, py, x0, y0 = tfw  # x0, y0 = centre of the upper-left pixel
        img = Image.open(io.BytesIO(get(BASE.format(p=product, ext="png")))).convert("RGB")
        arr = np.asarray(img)
        h, w = arr.shape[:2]
        # Sample at output pixel centres (row 0 = north), nearest neighbour: no invented detail.
        n = args.px
        frac = (np.arange(n) + 0.5) / n
        xs = b["west"] + frac * (b["east"] - b["west"])
        ys = b["north"] - frac * (b["north"] - b["south"])
        cols = np.round((xs - x0) / px).astype(int)
        rows = np.round((ys - y0) / py).astype(int)
        inside = (cols.min() >= 0) and (rows.min() >= 0) and (cols.max() < w) and (rows.max() < h)
        if not inside:
            raise RuntimeError(f"{product} mosaic ({w}x{h}) does not contain the EVA area: cols {cols.min()}-{cols.max()}, rows {rows.min()}-{rows.max()}")
        crop = arr[np.ix_(rows, cols)]
        covered = float((crop.max(axis=2) > 0).mean())
        name = f"crism_{product.lower()}.png"
        # Black pixels become transparent so the terrain shows through where CRISM has no signal.
        alpha = np.where(crop.max(axis=2) > 0, 255, 0).astype(np.uint8)
        Image.fromarray(np.dstack([crop, alpha]), "RGBA").save(os.path.join(args.out, name), optimize=True)
        meta["products"][product] = {
            "file": name,
            "legend": legend,
            "source_png": BASE.format(p=product, ext="png"),
            "source_geotiff": BASE.format(p=product, ext="tif"),
            "world_file": tfw,
            "mosaic_px": [w, h],
            "window_cols": [int(cols.min()), int(cols.max())],
            "window_rows": [int(rows.min()), int(rows.max())],
            "source_pixels_across_area": int(cols.max() - cols.min() + 1),
            "fraction_of_area_with_signal": round(covered, 3),
        }
        print(f"{product}: mosaic {w}x{h}, window cols {cols.min()}-{cols.max()} rows {rows.min()}-{rows.max()}, signal over {covered:.1%} of area")

    json.dump(meta, open(os.path.join(args.out, "crism.json"), "w"), indent=2)
    if args.copy_to:
        for name in ["crism.json"] + [p["file"] for p in meta["products"].values()]:
            shutil.copy(os.path.join(args.out, name), os.path.join(args.copy_to, name))


if __name__ == "__main__":
    main()
