"""
MarsWay: cut the CTX photo layer to our EVA area (Kelly, Map Maker 2).

Source: Murray Lab global CTX mosaic (beta01, uncontrolled), streamed by Esri at
~5 m/px (zoom 12). Tiles are plate carree on the Mars 2000 sphere, the same
projection as area.json -> boundsProjected, so lon/lat crop = local grid crop.

Outputs (next to area.json):
  ctx.png          greyscale CTX image filling leaflet imageBounds exactly
  ctx.json         source, credit, resolution, alignment check against the DEM

Run from the repo root:
  python scripts/prepare_ctx.py
  python scripts/prepare_ctx.py --out data/processed --copy-to app/public/terrain
"""
import argparse
import io
import json
import math
import os
import shutil

from science_raster import download, geometry

import numpy as np
from PIL import Image

TILE_URL = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{row}/{col}"
SERVICE = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer"
TREK_CAPS = "https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml"
TILE_PX = 512
MARS_R = 3396190.0


def fetch_tile(z, row, col, cache_dir):
    url = TILE_URL.format(z=z, row=row, col=col)
    image = np.asarray(Image.open(io.BytesIO(download(url, cache_dir))).convert("RGBA"))
    # The service's empty JPEG pixels are black; retain any explicit source alpha.
    alpha = image[:, :, 3].astype(np.float32) / 255
    alpha *= image[:, :, :3].max(axis=2) > 0
    grey = np.asarray(Image.fromarray(image).convert("L"), dtype=np.float32)
    return grey, alpha


def bilinear(img, rows, cols):
    r0 = np.clip(np.floor(rows).astype(int), 0, img.shape[0] - 2)
    c0 = np.clip(np.floor(cols).astype(int), 0, img.shape[1] - 2)
    fr = np.clip(rows - r0, 0, 1)
    fc = np.clip(cols - c0, 0, 1)
    top = img[r0, c0] * (1 - fc) + img[r0, c0 + 1] * fc
    bottom = img[r0 + 1, c0] * (1 - fc) + img[r0 + 1, c0 + 1] * fc
    return top * (1 - fr) + bottom * fr


def bandpass(a):
    """Keep 10-200 m features (ridges, scarps); drop pixel noise and regional brightness."""
    from scipy import ndimage
    a = ndimage.gaussian_filter(a, 1) - ndimage.gaussian_filter(a, 20)
    return (a - a.mean()) / (a.std() + 1e-6)


def alignment_check(ctx, area_dir):
    """Shift (metres) that best lines CTX up with DEM shading, tried for several Sun azimuths."""
    elev = json.load(open(os.path.join(area_dir, "elevation.json")))
    z = np.array(elev["data"], dtype=np.float32).reshape(elev["height"], elev["width"])
    cell = elev["cellSize"]
    ctx_small = np.asarray(Image.fromarray(ctx.astype(np.uint8)).resize(z.shape[::-1], Image.BILINEAR), dtype=np.float32)
    b = bandpass(ctx_small)
    dzdy, dzdx = np.gradient(z, cell)
    dzdy = -dzdy  # row 0 is north
    win = 20  # search +-100 m
    best = None
    for az in range(0, 360, 30):
        sx, sy = math.sin(math.radians(az)), math.cos(math.radians(az))
        shade = -(dzdx * sx + dzdy * sy)  # brighter where the ground faces the Sun
        a = bandpass(shade)
        xc = np.fft.fftshift(np.real(np.fft.ifft2(np.fft.fft2(b) * np.conj(np.fft.fft2(a))))) / a.size
        cy, cx = np.array(xc.shape) // 2
        sub = xc[cy - win:cy + win + 1, cx - win:cx + win + 1]
        dy, dx = np.unravel_index(np.argmax(sub), sub.shape)
        result = (float(sub.max()), az, dx - win, dy - win, float(xc[cy, cx]))
        if best is None or result[0] > best[0]:
            best = result
    peak, az, dx, dy, zero = best
    on_edge = abs(dx) == win or abs(dy) == win
    status = "inconclusive" if on_edge or peak < 0.1 else "measured"
    return {
        "status": status,
        "reason": "No reliable correlation peak was found in the searched window. Albedo differences may contribute. The reported best-search offsets are not a validated registration or an error bound; no shift was applied." if status == "inconclusive" else "Clear correlation peak inside the search window.",
        "method": "FFT cross-correlation of band-passed CTX brightness vs DEM shading (Sun azimuth searched in 30 degree steps), 5 m grid, search +-100 m",
        "sun_azimuth_deg": az,
        "ctx_offset_east_m": float(dx * cell),
        "ctx_offset_north_m": float(-dy * cell),
        "correlation_at_best": round(peak, 3),
        "correlation_at_zero_shift": round(zero, 3),
        "note": "Positive east/north describes the best-search shift direction only. When status is inconclusive, these values must not be used as measured offsets. No correction was applied to ctx.png.",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", default="app/public/terrain/area.json")
    ap.add_argument("--out", default="data/processed")
    ap.add_argument("--copy-to", default="app/public/terrain")
    ap.add_argument("--zoom", type=int, default=12)
    ap.add_argument("--px", type=int, default=None, help="square output size; default matches the terrain cell size")
    ap.add_argument("--cache-dir", default="data/raw/science-cache")
    args = ap.parse_args()

    area, b, n, spatial = geometry(args.area, args.px)
    size_m = area["sizeMetres"]
    west, east = math.degrees(b["west"] / MARS_R), math.degrees(b["east"] / MARS_R)
    south, north = math.degrees(b["south"] / MARS_R), math.degrees(b["north"] / MARS_R)

    deg_tile = 180.0 / 2 ** args.zoom
    deg_px = deg_tile / TILE_PX
    c0, c1 = int((west + 180) // deg_tile), int((east + 180) // deg_tile)
    r0, r1 = int((90 - north) // deg_tile), int((90 - south) // deg_tile)
    print(f"zoom {args.zoom}: {deg_px * math.pi / 180 * MARS_R:.2f} m/px, tiles rows {r0}-{r1}, cols {c0}-{c1}")

    mosaic = np.zeros(((r1 - r0 + 1) * TILE_PX, (c1 - c0 + 1) * TILE_PX), dtype=np.float32)
    coverage = np.zeros_like(mosaic)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            tile, alpha = fetch_tile(args.zoom, r, c, args.cache_dir)
            section = np.s_[(r-r0)*TILE_PX:(r-r0+1)*TILE_PX, (c-c0)*TILE_PX:(c-c0+1)*TILE_PX]
            mosaic[section] = tile * alpha
            coverage[section] = alpha
    lon0 = c0 * deg_tile - 180  # west edge of mosaic
    lat0 = 90 - r0 * deg_tile   # north edge of mosaic

    # Sample at output pixel centres: row 0 = north, like every MarsWay grid.
    frac = (np.arange(n) + 0.5) / n
    lons = west + frac * (east - west)
    lats = north - frac * (north - south)
    cols = (lons - lon0) / deg_px - 0.5
    rows = (lat0 - lats) / deg_px - 0.5
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    alpha = bilinear(coverage, rr, cc)
    ctx = np.divide(bilinear(mosaic, rr, cc), alpha, out=np.zeros_like(alpha), where=alpha > 0)
    alpha8 = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)

    os.makedirs(args.out, exist_ok=True)
    png = os.path.join(args.out, "ctx.png")
    grey = np.clip(ctx, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([grey, grey, grey, alpha8])).save(png, optimize=True)

    meta = {
        **spatial,
        "name": "CTX photo layer for the MarsWay EVA area",
        "dataset": "Murray Lab Global CTX Mosaic of Mars, beta01 (uncontrolled), ~5 m/px",
        "instrument": "Context Camera (CTX), Mars Reconnaissance Orbiter",
        "credit": "NASA/JPL/MSSS/The Murray Lab (Caltech); tiles hosted by Esri",
        "license": "Murray Lab grants free use of beta01 for all purposes (Esri service description)",
        "tile_service": SERVICE,
        "trek_capabilities": TREK_CAPS,
        "reference": "Dickson et al. (2023), Global CTX Mosaic of Mars, https://murray-lab.caltech.edu/CTX/",
        "source_crs": "Mars 2000 sphere (R 3396190 m), geographic / plate carree",
        "project_crs": area["boundsProjected"]["crs"],
        "zoom": args.zoom,
        "source_m_per_px": round(deg_px * math.pi / 180 * MARS_R, 2),
        "output_px": n,
        "output_m_per_px": size_m / n,
        "bounds_lonlat": {"west": west, "east": east, "south": south, "north": north},
        "leaflet_image_bounds": area["leaflet"]["imageBounds"],
        "tiles": {"rows": [r0, r1], "cols": [c0, c1]},
        "coverage": {
            "fraction_visible": round(float((alpha8 > 0).mean()), 6),
            "fraction_transparent": round(float((alpha8 == 0).mean()), 6),
            "mask": "Source alpha and black empty-service pixels; bilinear sampling uses premultiplied alpha to avoid dark gap borders.",
            "note": "Transparent pixels expose the terrain basemap; coverage is not a registration accuracy claim.",
        },
        "limitations": [
            "beta01 is an uncontrolled mosaic. Registration to the USGS DEM has not been established; offsets of tens of metres or more are possible. Matching crop bounds do not establish pixel-level alignment.",
            "Esri serves lossy 8-bit JPEG tiles; brightness is not calibrated reflectance.",
            "CTX is 5 m/px: it shows ridges, hollows and dunes, not individual rocks. HiRISE is needed for boulders.",
        ],
    }
    try:
        if not np.all(alpha8 == 255):
            raise ValueError("Correlation check skipped because gaps require masked registration; no shift applied.")
        check = alignment_check(ctx, os.path.dirname(args.area))
        check['status'] = 'unverified'
        check['reason'] = 'Exploratory brightness/shading correlation is not independent image registration. No shift applied; best-search offsets are diagnostic only.'
        check["note"] = "Exploratory best-search offsets are not measured image offsets or an accuracy bound. No correction was applied to ctx.png."
        meta["alignment_check"] = check
    except Exception as error:
        meta["alignment_check"] = {"status": "not run", "reason": str(error)}
    json.dump(meta, open(os.path.join(args.out, "ctx.json"), "w"), indent=2)
    print(json.dumps(meta["alignment_check"], indent=2))

    if args.copy_to:
        for name in ("ctx.png", "ctx.json"):
            shutil.copy(os.path.join(args.out, name), os.path.join(args.copy_to, name))
    print("wrote", png, os.path.getsize(png), "bytes")


if __name__ == "__main__":
    main()
