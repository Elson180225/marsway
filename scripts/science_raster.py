"""Shared georeferencing and source caching for the orbital browse exporters."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np


def download(url, cache_dir, tries=3):
    """Cache exact source responses; transport failures are never coverage masks."""
    path = Path(cache_dir) / hashlib.sha256(url.encode()).hexdigest()
    if path.exists():
        return path.read_bytes()
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'marsway-science-review'})
            with urllib.request.urlopen(request, timeout=45) as response:
                body = response.read()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return body
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(1 + attempt)


def geometry(area_path, pixels=None):
    area = json.loads(Path(area_path).read_text(encoding='utf-8'))
    bounds = area['boundsProjected']
    width = bounds['east'] - bounds['west']
    height = bounds['north'] - bounds['south']
    if width <= 0 or width != height:
        raise ValueError('Orbital exporters require a positive square projected area.')
    n = pixels if pixels is not None else round(width / area['cellSize'])
    if n < 1:
        raise ValueError('Output pixel count must be positive.')
    meta = {
        'area_size_m': width,
        'bounds_projected': bounds,
        'output_px': n,
        'output_m_per_px': width / n,
        'row_order': 'north_to_south',
        'pixel_reference': 'pixel centres; first centre west + half a pixel, north - half a pixel',
        'leaflet_image_bounds': [[0, 0], [height, width]],
    }
    return area, bounds, n, meta


def nearest_browse(image, world_file, bounds, n):
    """North-up nearest-neighbour crop with transparent outside/black pixels."""
    px, rx, ry, py, x0, y0 = world_file
    if rx != 0 or ry != 0 or px <= 0 or py >= 0:
        raise ValueError('Expected an unrotated north-up world file.')
    h, w = image.shape[:2]
    frac = (np.arange(n) + 0.5) / n
    xs = bounds['west'] + frac * (bounds['east'] - bounds['west'])
    ys = bounds['north'] - frac * (bounds['north'] - bounds['south'])
    cols = np.floor((xs - x0) / px + 0.5).astype(int)
    rows = np.floor((ys - y0) / py + 0.5).astype(int)
    inside = ((rows >= 0) & (rows < h))[:, None] & ((cols >= 0) & (cols < w))[None, :]
    crop = np.zeros((n, n, 3), dtype=np.uint8)
    crop[inside] = image[np.ix_(np.clip(rows, 0, h-1), np.clip(cols, 0, w-1))][inside]
    alpha = np.where(crop.max(axis=2) > 0, 255, 0).astype(np.uint8)
    return np.dstack([crop, alpha]), inside, rows, cols
