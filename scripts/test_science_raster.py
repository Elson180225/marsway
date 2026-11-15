"""Offline checks for georeferencing, gap handling and delivered orbital rasters."""
import json
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

from science_raster import geometry, nearest_browse

ROOT = Path(__file__).resolve().parents[1]


class BrowseSamplingTests(unittest.TestCase):
    def test_north_up_pixel_centres_and_transparent_outside_source(self):
        image = np.array([[[200, 0, 0], [0, 200, 0]],
                          [[0, 0, 200], [0, 0, 0]]], dtype=np.uint8)
        rgba, inside, _, _ = nearest_browse(image, [2, 0, 0, -2, 1, 3],
            {'west': -2, 'east': 4, 'south': -2, 'north': 4}, 3)
        # Expected coordinates: x=-1,1,3; y=3,1,-1. No wrapping of outside indices.
        self.assertEqual(rgba[0, 1].tolist(), [200, 0, 0, 255])
        self.assertEqual(rgba[0, 2].tolist(), [0, 200, 0, 255])
        self.assertEqual(rgba[1, 1].tolist(), [0, 0, 200, 255])
        self.assertTrue(np.all(rgba[:, 0] == 0))
        self.assertTrue(np.all(rgba[2] == 0))
        self.assertEqual(rgba[1, 2, 3], 0, 'black browse pixel must be transparent')
        self.assertTrue(inside[1, 2], 'black is inside the mosaic, not necessarily missing coverage')

    def test_rotated_world_file_is_not_silently_treated_as_north_up(self):
        with self.assertRaises(ValueError):
            nearest_browse(np.zeros((2, 2, 3), dtype=np.uint8), [2, 1, 0, -2, 1, 3],
                           {'west': 0, 'east': 4, 'south': 0, 'north': 4}, 2)


class DeliveredRasterTests(unittest.TestCase):
    def test_images_metadata_and_coverage_share_the_active_terrain_extent(self):
        area, bounds, n, _ = geometry(ROOT / 'app/public/terrain/area.json')
        self.assertEqual(n, 1200)
        self.assertEqual([bounds[k] for k in ('west', 'east', 'south', 'north')],
                         [8141000, 8147000, -287000, -281000])
        products = [('ctx.png', 'ctx.json', None), ('crism_hyd.png', 'crism.json', 'HYD'),
                    ('crism_alt.png', 'crism.json', 'ALT'), ('themis_night.png', 'themis_night.json', None)]
        for image_name, metadata_name, product in products:
            with self.subTest(layer=image_name):
                image_path = ROOT / 'app/public/terrain' / image_name
                metadata_path = ROOT / 'app/public/terrain' / metadata_name
                self.assertEqual(image_path.read_bytes(), (ROOT / 'data/processed' / image_name).read_bytes())
                self.assertEqual(metadata_path.read_bytes(), (ROOT / 'data/processed' / metadata_name).read_bytes())
                image = Image.open(image_path)
                self.assertEqual(image.size, (n, n))
                self.assertEqual(image.mode, 'RGBA')
                alpha = np.asarray(image)[:, :, 3]
                meta = json.loads(metadata_path.read_text())
                self.assertEqual(meta['bounds_projected'], bounds)
                self.assertEqual(meta['leaflet_image_bounds'], [[0, 0], [6000, 6000]])
                self.assertEqual(meta['output_px'], n)
                self.assertEqual(meta['output_m_per_px'], area['cellSize'])
                self.assertEqual(meta['row_order'], 'north_to_south')
                record = meta['products'][product] if product else meta['coverage']
                self.assertAlmostEqual(record['fraction_transparent'], float((alpha == 0).mean()), places=6)
                if product:
                    self.assertTrue(np.any(alpha == 0), 'CRISM gaps must remain transparent')
                    self.assertEqual(record['fraction_inside_source_extent'], 1)
                    self.assertAlmostEqual(record['fraction_with_visible_browse_colour'], float((alpha > 0).mean()), places=6)


if __name__ == '__main__':
    unittest.main()
