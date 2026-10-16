"""Regression check for extract.py against the original bulanci.exe: npm run test:extract (in game/)"""
import collections
import json
import os
import struct
import zlib
import tempfile
import unittest

import extract


class ExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open('bulanci.exe', 'rb') as f:
            cls.exe = f.read()
        cls.res = {rid: (kind, d) for rid, kind, d in extract.resources(extract.unpack_overlay(cls.exe))}

    def test_archive(self):
        kinds = collections.Counter(kind for kind, _ in self.res.values())
        self.assertEqual(len(self.res), 347)
        self.assertEqual(kinds[extract.KIND_IMAGE], 159)
        self.assertEqual(kinds[extract.KIND_ANIM], 130)

    def test_image(self):
        png = extract.decode_image(self.res[53][1])
        self.assertEqual(struct.unpack_from('>II', png, 16), (800, 600))

    def test_team_image(self):
        # image 29 (HUD CBulPicture) is 8 bpp without its own palette: indices 112..151 are the team ramp
        pal = extract.team_palette(self.exe, 1)
        png = extract.decode_image(self.res[29][1], pal)
        idat = png[png.index(b'IDAT') + 4:]
        raw = zlib.decompress(idat[:struct.unpack_from('>I', png, png.index(b'IDAT') - 4)[0]])
        self.assertIn(bytes(pal[126][:3][::-1]), raw)  # BGRx -> RGB

    def test_colorkey_with_alpha_plane(self):
        # image 95 (level 323 glass) has an alpha plane; its colorkey index 0 (the frame around it) stays transparent
        png = extract.decode_image(self.res[95][1])
        idat = png[png.index(b'IDAT') + 4:]
        raw = zlib.decompress(idat[:struct.unpack_from('>I', png, png.index(b'IDAT') - 4)[0]])
        self.assertEqual(raw[1:5], bytes([1, 1, 1, 0]))  # filter byte, then pixel (0, 0) = index 0

    def test_anim(self):
        (sheet, *_), info = extract.anim(self.res[180][1], [extract.team_palette(self.exe)])
        self.assertEqual((info['width'], info['height'], info['frames']), (55, 43, 15))
        self.assertEqual(struct.unpack_from('>II', sheet, 16), (55 * 15, 43))

    def test_scripts_fully_decoded(self):
        for rid, (kind, d) in self.res.items():
            if kind == extract.KIND_LEVEL:
                self.assertNotIn('.data', extract.disassemble(d, extract.LEVEL_OPS), rid)

    def test_video(self):
        avi = extract.video_to_avi(self.res[12289][1])
        self.assertEqual(avi[:4] + avi[8:12], b'RIFFAVI ')


class ManifestTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        extract.main(['extract.py', 'bulanci.exe', cls.tmp.name])
        with open(os.path.join(cls.tmp.name, 'manifest.json'), encoding='utf-8') as f:
            cls.m = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_entries(self):
        self.assertEqual(len(self.m), 347)
        self.assertEqual((self.m['53']['kind'], self.m['53']['width'], self.m['53']['height']), ('image', 800, 600))
        a = self.m['180']
        self.assertEqual((a['kind'], a['width'], a['height'], a['frames']), ('anim', 55, 43, 15))
        self.assertEqual(a['file'], 'anims/00180.png')
        self.assertEqual(a['cols'], 15)
        self.assertEqual(self.m['311']['kind'], 'image')
        self.assertGreater(self.m['311']['width'], 0)
        self.assertEqual(self.m['333'], {'kind': 'music', 'file': 'music/00333.mp3', 'files': ['music/00333.mp3']})
        self.assertEqual(self.m['4']['bank'], 338)
        self.assertEqual(len(self.m['338']['samples']), 41)
        self.assertEqual(len(self.m['338']['durations_ms']), 41)  # sound-end events (death -> groan -> taunt)
        self.assertTrue(all(ms > 0 for ms in self.m['338']['durations_ms']))

    def test_anim_sheets_fit_mobile_textures(self):
        # sprite sheets are grids: wide single-row sheets (25-29k px) exceed the 16384 px texture limit of phone GPUs
        for rid, a in self.m.items():
            if a['kind'] != 'anim':
                continue
            with open(os.path.join(self.tmp.name, a['file']), 'rb') as f:
                w, h = struct.unpack_from('>II', f.read(24), 16)
            self.assertLessEqual(w, 4096, rid)
            rows = -(-a['frames'] // a['cols'])
            self.assertEqual((w, h), (a['width'] * a['cols'], a['height'] * rows), rid)
        self.assertGreater(-(-self.m['245']['frames'] // self.m['245']['cols']), 1)

    def test_levels(self):
        levels = {k: v for k, v in self.m.items() if v['kind'] == 'level'}
        self.assertEqual(sorted(map(int, levels)), [319, 320, 321, 322, 323, 324])
        for v in levels.values():
            self.assertTrue(os.path.exists(os.path.join(self.tmp.name, v['file'])))
            for r in v['refs']:
                self.assertIn(str(r), self.m)
        self.assertTrue({104, 333, 246} <= set(levels['322']['refs']))


if __name__ == '__main__':
    unittest.main()
