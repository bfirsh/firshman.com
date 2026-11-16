"""The rose tunnel: nested rose curves around the centre, banded like the Julia set. The band value
grows with log(radius) (so shifting the band colours zooms in forever) and with a twist of the
angle (so the petals also turn). A still picture that palette cycling sets flowing."""
import numpy as np
from julia import quant_bands

CX, CY = 128.0, 120.0


def field(k=8, twist=1.6, petal=1.1, per_octave=7.0, spin=0.0):
    ys, xs = np.mgrid[0:240, 0:256]
    dx, dy = xs + 0.5 - CX, ys + 0.5 - CY
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    lr = np.log2(np.maximum(r, 0.5))
    # rose: the band surfaces bulge outward along k petals, the petals twist with depth
    g = per_octave * lr + petal * np.cos(k * th + twist * lr * 2 * np.pi / 4) + spin * th * k / (2 * np.pi)
    nu = g - g.min() + 1
    nu[r < 13] = -1           # the eye: black (hides where the bands crowd together)
    return nu


def image(**kw):
    return quant_bands(field(**kw), k=1.0)
