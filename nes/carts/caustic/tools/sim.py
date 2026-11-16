#!/usr/bin/env python3
"""Offline preview of the streamed picture (no raster kernel): sim.py world palmap 'pal hex...' out.png [T]
Palette: 13 hex colours: backdrop then 4 x 3."""
import sys
import numpy as np
from PIL import Image
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent.parent.parent / 'tools'))
import nespal  # noqa: E402

GEN = HERE.parent / 'out' / 'gen'


def render(world, palmap, pal, T=0, emph=None):
    lv = np.load(GEN / 'levels.npy')[world]
    m = np.load(GEN / 'maps.npz')
    phi, pm = m['phi'], m[f'pal_{palmap}']
    img = np.zeros((240, 256, 3))
    cols = [nespal.RGB[c] for c in pal]
    for ty in range(30):
        for tx in range(32):
            g = min(ty // 8, 3)
            # the frame this tile shows at time T (held since its band's last update)
            last = T - ((T - g) % 4)
            F = (last + phi[ty, tx]) % 128
            tile = lv[F][(ty % 8) * 8:(ty % 8) * 8 + 8, (tx % 8) * 8:(tx % 8) * 8 + 8]
            p = pm[ty, tx]
            for v in range(4):
                c = cols[0] if v == 0 else cols[1 + p * 3 + v - 1]
                img[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8][tile == v] = c
    if emph is not None:
        for y in range(240):
            img[y] = nespal.emph(img[y], emph[y])
    return img.astype(np.uint8)


if __name__ == '__main__':
    w = int(sys.argv[1])
    pal = [int(h, 16) for h in sys.argv[3].split()]
    T = int(sys.argv[5]) if len(sys.argv) > 5 else 0
    Image.fromarray(render(w, sys.argv[2], pal, T)).resize((512, 480), Image.NEAREST).save(sys.argv[4])
