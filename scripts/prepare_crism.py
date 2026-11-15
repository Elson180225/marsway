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

from science_raster import download, geometry, nearest_browse

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
BASE = "http://crism.jhuapl.edu/msl_landing_sites/2012July_Mosaics/{p}/MSL_gale_crater_targeted_mosaic_{p}_120723.{ext}"
PAGE = "http://crism.jhuapl.edu/msl_landing_sites/index_news.php"
PRODUCTS = {
    "HYD": "Hydrated sulfates. R SINDEX2, G BD2100_2, B BD1900_2. Monohydrated sulfates green or yellow; polyhydrated sulfates magenta; other hydrated minerals blue.",
    "ALT": "Alteration minerals at Gale. R D2300, G SINDEX2, B BD1900_2. Hydrated sulfates green or blue-green; Fe/Mg clays red.",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="app/public/terrain/area.json")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--copy-to", default="app/public/terrain")
    ap.add_argument("--px", type=int, default=None)
    ap.add_argument("--cache-dir", default="data/raw/science-cache")
    args = ap.parse_args()
    area, b, n, spatial = geometry(args.area, args.px)
    os.makedirs(args.out, exist_ok=True)

    meta = {
        **spatial,
        "name": "CRISM mineral browse layers for the MarsWay EVA area",
        "dataset": "CRISM Specialized Browse Product Mosaics, MSL Gale Crater, 23 July 2012 (MTRDR prototypes)",
        "instrument": "Compact Reconnaissance Imaging Spectrometer for Mars (CRISM), Mars Reconnaissance Orbiter",
        "credit": "NASA/JPL/JHUAPL; mosaics by F. Seelos, K. Seelos, C. Viviano (CRISM team)",
        "source_page": PAGE,
        "source_crs": "Simple cylindrical, Mars 2000 sphere, centre (0, 0), 3072 px/deg = 19.295 m/px",
        "project_crs": area["boundsProjected"]["crs"],
        "registration": "CRISM team warped each observation onto a CTX basemap (ENVI RST); registration to this terrain DEM is unverified; offsets may remain.",
        "leaflet_image_bounds": area["leaflet"]["imageBounds"],
        "products": {},
        "limitations": [
            "Qualitative browse colours with a Gale-specific stretch. Brighter colour is a stronger spectral signal than elsewhere at Gale, not a percentage of mineral.",
            f"About 19.3 m source pixels, roughly {area['sizeMetres'] / 19.295149:.0f} across the area. A 5 m output grid adds no detail; individual boxwork ridges are not resolved.",
            "Dust hides minerals: a black or bland pixel does not mean the mineral is absent.",
            "2012 prototype products, before the final PDS MTRDR release. Ice haze can add false blue.",
        ],
    }
    for product, legend in PRODUCTS.items():
        tfw = [float(v) for v in download(BASE.format(p=product, ext="tfw"), args.cache_dir).decode().split()]
        px = tfw[0]  # World-file translation is the centre of the upper-left pixel.
        img = Image.open(io.BytesIO(download(BASE.format(p=product, ext="png"), args.cache_dir))).convert("RGB")
        arr = np.asarray(img)
        h, w = arr.shape[:2]
        rgba, inside, rows, cols = nearest_browse(arr, tfw, b, n)
        covered = float((rgba[:, :, 3] > 0).mean())
        name = f"crism_{product.lower()}.png"
        Image.fromarray(rgba).save(os.path.join(args.out, name), optimize=True)
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
            "source_m_per_px": abs(px),
            "fraction_inside_source_extent": round(float(inside.mean()), 6),
            "fraction_with_visible_browse_colour": round(covered, 6),
            "fraction_transparent": round(1 - covered, 6),
            "coverage_note": "Outside-mosaic and black browse pixels are transparent. Black pixels may reflect no coverage, dust, weak signal or the browse stretch floor, not mineral absence.",
        }
        print(f"{product}: mosaic {w}x{h}, window cols {cols.min()}-{cols.max()} rows {rows.min()}-{rows.max()}, signal over {covered:.1%} of area")

    json.dump(meta, open(os.path.join(args.out, "crism.json"), "w"), indent=2)
    if args.copy_to:
        for name in ["crism.json"] + [p["file"] for p in meta["products"].values()]:
            shutil.copy(os.path.join(args.out, name), os.path.join(args.copy_to, name))


if __name__ == "__main__":
    main()
