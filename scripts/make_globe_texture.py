"""Download NASA Mars Trek global Mars tiles and stitch them into one globe picture.

Usage:  python scripts/make_globe_texture.py [layer] [name]
Default layer: Viking colour mosaic. Output goes to app/public/globe/<name>.jpg and .webp
"""
import io, os, sys, time, urllib.request
from PIL import Image

LAYER = sys.argv[1] if len(sys.argv) > 1 else "Mars_Viking_MDIM21_ClrMosaic_global_232m"
NAME = sys.argv[2] if len(sys.argv) > 2 else "mars_4k"
ZOOM = 3  # 16 x 8 tiles of 256 px = 4096 x 2048
URL = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.jpg"
OUT = "app/public/globe"

cols, rows = 2 ** (ZOOM + 1), 2 ** ZOOM
img = Image.new("RGB", (cols * 256, rows * 256))
for r in range(rows):
    for c in range(cols):
        req = urllib.request.Request(URL.format(layer=LAYER, z=ZOOM, row=r, col=c),
                                     headers={"User-Agent": "marsway-hackathon"})
        for attempt in range(3):
            try:
                tile = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB")
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2)
        img.paste(tile, (c * 256, r * 256))
    print(f"row {r + 1} of {rows} done")

os.makedirs(OUT, exist_ok=True)
img.save(f"{OUT}/{NAME}.jpg", "JPEG", quality=85, optimize=True, progressive=True)
img.save(f"{OUT}/{NAME}.webp", "WEBP", quality=82, method=6)
print("saved", img.size, "to", OUT)