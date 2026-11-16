"""Shared helpers for the Kaleido asset pipeline: the JSNES palette, CHR encoding, previews."""
import numpy as np

# JSNES default palette (0xBBGGRR), so previews match what the player shows.
_JSNES = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000,
          0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000,
          0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000,
          0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]
RGB = np.array([[(c & 255), (c >> 8) & 255, (c >> 16) & 255] for c in _JSNES], dtype=np.uint8)


def tile_bytes(t):
    """8x8 array of 0..3 -> 16 bytes of NES CHR (two bit planes)."""
    t = np.asarray(t, dtype=np.uint8)
    lo = np.packbits((t & 1).astype(np.uint8), axis=1)[:, 0]
    hi = np.packbits(((t >> 1) & 1).astype(np.uint8), axis=1)[:, 0]
    return bytes(lo) + bytes(hi)


def tiles_of(img):
    """(240, 256) image of 0..3 -> list of 960 8x8 tiles (row-major)."""
    H, W = img.shape
    return [img[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] for ty in range(H // 8) for tx in range(W // 8)]


class CHR:
    """CHR-ROM as 4 KB banks of 256 tiles; slots are (bank, index)."""

    def __init__(self, banks=64):
        self.data = bytearray(banks * 4096)
        self.used = {}

    def put(self, bank, index, tile, who=''):
        key = (bank, index)
        b = tile_bytes(tile)
        if key in self.used and self.used[key][1] != b:
            raise ValueError(f'CHR slot {key} already used by {self.used[key][0]}')
        self.used[key] = (who, b)
        o = bank * 4096 + index * 16
        self.data[o:o + 16] = b


def preview(img, pal_of_tile, palettes, scale=1):
    """img (240,256) 0..3, pal_of_tile (30,32) 0..3, palettes: 4 lists of 4 NES colours -> RGB."""
    P = np.kron(pal_of_tile, np.ones((8, 8), int))
    pal = np.array(palettes)
    idx = pal[P, img]
    out = RGB[idx]
    if scale > 1:
        out = out.repeat(scale, 0).repeat(scale, 1)
    return out


def supersample(fn, W=256, H=240, ss=4, x0=0, y0=0):
    """Evaluate fn(x, y) (arrays, pixel units) on an ss x ss grid per pixel; returns (H, W, ss*ss)."""
    o = (np.arange(ss) + 0.5) / ss
    ys, xs = np.mgrid[0:H, 0:W]
    out = []
    for oy in o:
        for ox in o:
            out.append(fn(xs + ox + x0, ys + oy + y0))
    return np.stack(out, -1)
