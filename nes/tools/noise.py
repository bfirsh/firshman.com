"""Small procedural toolkit: value noise, fBm, smoothstep, colour ramps. Deterministic."""
import numpy as np


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


class Noise:
    def __init__(self, seed=0, size=256):
        rng = np.random.default_rng(seed)
        self.size = size
        self.g = rng.random((size, size))

    def value(self, x, y, wrapx=None):
        """Bilinear-smooth value noise at float coords (arrays). wrapx: period in lattice units."""
        s = self.size
        xi = np.floor(x).astype(int)
        yi = np.floor(y).astype(int)
        fx = x - xi
        fy = y - yi
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        x0 = xi % (wrapx or s)
        x1 = (xi + 1) % (wrapx or s)
        y0 = yi % s
        y1 = (yi + 1) % s
        g = self.g
        a = g[y0, x0 % s]
        b = g[y0, x1 % s]
        c = g[y1, x0 % s]
        d = g[y1, x1 % s]
        return lerp(lerp(a, b, fx), lerp(c, d, fx), fy)

    def fbm(self, x, y, octaves=5, lac=2.0, gain=0.5, wrapx=None):
        amp, f, tot, norm = 1.0, 1.0, 0.0, 0.0
        for o in range(octaves):
            w = int(wrapx * f) if wrapx else None
            tot = tot + amp * self.value(x * f + o * 17.3, y * f + o * 9.1, w)
            norm += amp
            amp *= gain
            f *= lac
        return tot / norm


def ramp(stops, t):
    """stops: [(pos, (r,g,b)), ...] sorted; t array -> (..., 3) linear interpolation in sRGB."""
    t = np.asarray(t, dtype=np.float64)
    out = np.zeros(t.shape + (3,))
    ps = np.array([p for p, _ in stops])
    cs = np.array([c for _, c in stops], dtype=np.float64)
    for ch in range(3):
        out[..., ch] = np.interp(t, ps, cs[:, ch])
    return out


def supersample(fn, W, H, ss=2):
    """Render fn(x, y) -> (H*ss, W*ss, 3) at ss x resolution and box-filter down."""
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    img = fn((xs + 0.5) / ss, (ys + 0.5) / ss)
    return img.reshape(H, ss, W, ss, 3).mean((1, 3))
