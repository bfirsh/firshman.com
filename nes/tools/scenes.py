"""Procedural scenes for Cartridge, rendered offline at high precision then converted to NES.

Scenes are painted in "ramp space": each pixel is a continuous position along a ramp of NES
colours (0 = black backdrop). Neighbouring ramp colours always share a palette, so every
gradient turns into a clean two-colour ordered dither, the way a pixel artist would do it."""
import numpy as np
import nespal
from noise import Noise, smoothstep, ramp, supersample, lerp

N1 = Noise(1)
N2 = Noise(2)
N3 = Noise(3)
N4 = Noise(4)


def ramp_rgb(rampcols, r):
    """Continuous ramp position r -> sRGB, mixing neighbours in linear light."""
    lin = nespal.srgb_to_lin(nespal.RGB[np.array(rampcols)])
    r = np.clip(r, 0, len(rampcols) - 1)
    i = np.minimum(np.floor(r).astype(int), len(rampcols) - 2)
    f = (r - i)[..., None]
    return nespal.lin_to_srgb(lin[i] * (1 - f) + lin[i + 1] * f)


# ------------------------------------------------------------------------------------------
# Ground: a dawn landscape two screens tall (256 x 480). The horizon sits at y = HZ.
HZ = 358
GROUND_RAMP = [0x0F, 0x02, 0x03, 0x13, 0x25, 0x26, 0x27, 0x37]
GROUND_PALS = [[0x02, 0x03, 0x13], [0x13, 0x25, 0x26], [0x26, 0x27, 0x37], [0x03, 0x13, 0x25]]
SUN_X, SUN_Y = 168.0, HZ + 2


def sky_level(x, y):
    h = HZ - y
    r = np.interp(h, [-40, 0, 10, 28, 56, 96, 150, 220, 290, 340, 400],
                  [7.0, 6.9, 6.3, 5.4, 4.5, 3.6, 2.9, 2.1, 1.3, 0.6, 0.3])
    # Glow around the sun: up to a full ramp step brighter.
    d = np.sqrt(((x - SUN_X) * 0.75) ** 2 + ((y - SUN_Y) * 1.5) ** 2)
    r = r + 1.3 * np.exp(-d / 40.0) * smoothstep(-10, 30, h + 20)
    # Cirrus streaks, lit from below by the dawn.
    n = N1.fbm(x / 70.0, y / 6.0, 5)
    band = smoothstep(0.50, 0.70, n) * smoothstep(36, 70, h) * (1 - smoothstep(220, 300, h))
    r = r + 0.9 * band
    return np.minimum(r, 7.0)


def ridge(x, base, amp, scale, nz, octaves=4, ph=3.7):
    return base - amp * nz.fbm(x / scale, np.full_like(x, ph), octaves)


def ground_levels(x, y):
    r = sky_level(x, y)
    # Far hills: warm haze, solid coral (ramp 5) so they share palettes with the sky above.
    yf = ridge(x, HZ + 4, 24, 64, N2) + 5 * np.sin(x / 37.0)
    r = np.where(y > yf, 5.0 - 0.6 * smoothstep(0, 18, y - yf), r)
    # Mid hills: dusky pink to lavender.
    ym = ridge(x, HZ + 20, 24, 46, N3, ph=1.3) + 7 * np.sin(x / 23.0 + 1)
    r = np.where(y > ym, 3.9 - 0.9 * smoothstep(0, 22, y - ym), r)
    # Near hills: violet into blue.
    yn = ridge(x, HZ + 34, 16, 30, N4, ph=5.1) + 4 * np.sin(x / 13.0)
    r = np.where(y > yn, 2.2 - 1.0 * smoothstep(0, 14, y - yn), r)
    # Lake reflecting the sky (one step darker), with ripples.
    shore_far = HZ + 40 + 1.5 * np.sin(x / 19.0)
    shore_near = HZ + 72 + 3 * np.sin(x / 31.0 + 2)
    lake = (y > shore_far) & (y < shore_near)
    depth = (y - shore_far)
    rip = 1.6 * np.sin(y * 1.7 + 5 * N2.fbm(x / 26.0, y / 2.0, 3)) * (0.3 + depth / 40.0)
    my = 2 * shore_far - y + rip
    refl = sky_level(x + rip, my - 40)  # reflection of the sky behind the hills
    refl = refl - 1.5 - 0.03 * depth
    streak = np.exp(-((x - SUN_X) / (5 + depth * 0.25)) ** 2) * smoothstep(0.35, 0.65, N3.fbm(x / 9.0, y / 1.2, 2))
    refl = refl + 2.2 * streak
    r = np.where(lake, np.clip(refl, 0.6, 7.0), r)
    # Shoreline and near ground: black, with a thin dark-blue rim at the water.
    r = np.where((y >= shore_near), np.where(y < shore_near + 2, 1.0, 0.0), r)
    r = np.where((y > shore_far - 1.5) & (y <= shore_far + 0.5), 0.0, r)
    # Pines on both near shores.
    trees = np.zeros_like(x, dtype=bool)
    rng = np.random.default_rng(7)
    for i in range(30):
        tx = rng.uniform(-10, 64) if i % 2 else rng.uniform(200, 266)
        th = rng.uniform(22, 64)
        tb = HZ + 76 + rng.uniform(-4, 10)
        tw = th * 0.27
        yy = (y - (tb - th)) / th
        jag = 0.72 + 0.28 * np.abs(np.sin(yy * 34 + i))
        trees |= (yy > 0) & (yy < 1.05) & (np.abs(x - tx) < tw * np.minimum(yy, 1) * jag + 0.6)
    r = np.where(trees, 0.0, r)
    return r


def render_ground():
    W, H, ss = 256, 480, 3
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    r = ground_levels((xs + 0.5) / ss, (ys + 0.5) / ss)
    img = ramp_rgb(GROUND_RAMP, r)
    return img.reshape(H, ss, W, ss, 3).mean((1, 3))


# ------------------------------------------------------------------------------------------
# Title: "CARTRIDGE" in chrome, drawn from stroke primitives (signed distance fields).

def _seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def _arc(px, py, cx, cy, rx, ry, a0, a1):
    """Distance to an elliptical arc (approximate: sample points)."""
    d = np.full(px.shape, 1e9)
    for a in np.linspace(a0, a1, 48):
        d = np.minimum(d, np.hypot(px - (cx + rx * np.cos(a)), py - (cy + ry * np.sin(a))))
    return d


def _poly(px, py, pts):
    d = np.full(px.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        d = np.minimum(d, _seg(px, py, ax, ay, bx, by))
    return d


PI = np.pi
GLYPHS = {
    'C': (4.0, lambda x, y: _arc(x, y, 2.1, 3, 2.1, 3, PI * 0.28, PI * 1.72)),
    'A': (4.4, lambda x, y: np.minimum(_poly(x, y, [(0, 6), (2.2, 0), (4.4, 6)]), _seg(x, y, 1.0, 4.1, 3.4, 4.1))),
    'R': (4.0, lambda x, y: np.minimum.reduce([_poly(x, y, [(0, 6), (0, 0), (2.3, 0)]), _arc(x, y, 2.3, 1.5, 1.5, 1.5, -PI / 2, PI / 2),
                                               _seg(x, y, 0, 3, 2.3, 3), _seg(x, y, 2.0, 3, 4.0, 6)])),
    'T': (4.2, lambda x, y: np.minimum(_seg(x, y, 0, 0, 4.2, 0), _seg(x, y, 2.1, 0, 2.1, 6))),
    'I': (0.0, lambda x, y: _seg(x, y, 0, 0, 0, 6)),
    'D': (4.0, lambda x, y: np.minimum.reduce([_poly(x, y, [(1.2, 0), (0, 0), (0, 6), (1.2, 6)]), _arc(x, y, 1.2, 3, 2.8, 3, -PI / 2, PI / 2)])),
    'G': (4.2, lambda x, y: np.minimum.reduce([_arc(x, y, 2.1, 3, 2.1, 3, PI * 0.3, PI * 1.85), _poly(x, y, [(2.4, 3.3), (4.2, 3.3), (4.2, 5.2)])])),
    'E': (3.8, lambda x, y: np.minimum.reduce([_poly(x, y, [(3.8, 0), (0, 0), (0, 6), (3.8, 6)]), _seg(x, y, 0, 3, 3.0, 3)])),
}


def word_sdf(x, y, word, unit, gap=1.45, italic=0.18, unit_y=None):
    """Distance (in units) to the strokes of word, laid out from x=0, cap height 6 units."""
    u = x / unit
    v = y / (unit_y or unit)
    u = u + italic * (v - 6)  # lean
    d = np.full(x.shape, 1e9)
    pen = 0.0
    for ch in word:
        w, f = GLYPHS[ch]
        d = np.minimum(d, f(u - pen, v))
        pen += w + gap
    return d, pen - gap


TITLE_PALS = [[0x02, 0x11, 0x21], [0x21, 0x31, 0x30], [0x17, 0x27, 0x37], [0x27, 0x37, 0x38]]
TITLE_TOP = 19       # logo cap top (image y); the chrome horizon lands on y=40, a tile edge
TITLE_CAP = 42       # cap height in pixels
TITLE_REFL = 72      # reflection starts here (image y), logo mirrored about TITLE_TOP+TITLE_CAP+4


def render_title():
    """256x240: the logo at TITLE_TOP, its darkened reflection below, everything else black."""
    W, H, ss = 256, 240, 4
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    x = (xs + 0.5) / ss
    y = (ys + 0.5) / ss
    unit = 4.45
    unit_y = TITLE_CAP / 6.0
    _, width = word_sdf(np.zeros(1), np.zeros(1), 'CARTRIDGE', unit)
    x0 = (256 - width * unit) / 2 + 4
    sw = 0.74

    def logo(lx, ly, refl=False):
        d, _ = word_sdf(lx - x0, ly - TITLE_TOP, 'CARTRIDGE', unit, unit_y=unit_y, italic=0.26)
        v = (ly - TITLE_TOP) / TITLE_CAP
        inside = d < sw
        top = ramp([(-0.2, (0, 30, 140)), (0.12, (20, 80, 240)), (0.38, (120, 200, 255)), (0.5, (255, 255, 255))], v)
        bot = ramp([(0.5, (150, 70, 0)), (0.54, (235, 150, 10)), (0.8, (255, 205, 120)), (1.05, (255, 238, 150))], v)
        col = np.where((v < 0.5)[..., None], top, bot)
        edge = smoothstep(sw * 0.35, sw, d)  # 1 at the stroke edge
        col = col * (1 - 0.22 * edge)[..., None]
        if refl:
            col = col * np.array([0.5, 0.55, 0.75])
        return np.where(inside[..., None], col, 0.0)

    img = logo(x, y)
    # a darker, cooler copy 56 rows lower for the reflection (the raster kernel flips it)
    dark = logo(x, y - 56, True)
    img = np.where((y >= 64)[..., None], dark, img)
    cov = (img.sum(-1) > 0).astype(float).reshape(H, ss, W, ss).mean((1, 3))
    img = img.reshape(H, ss, W, ss, 3).mean((1, 3)) / np.maximum(cov, 1e-6)[..., None]
    img[cov < 0.5] = 0  # hard edges: no half-covered pixels dithering into black
    return np.clip(img, 0, 255)


# ------------------------------------------------------------------------------------------
# Clouds: sky above a sea of cloud seen in perspective. Every row tiles horizontally with
# period 256, so per-line X scroll can drift each depth at its own speed.
CLOUD_HZ = 104          # horizon row in the picture
CLOUD_BG = 0x02


def _wrapnoise(nz, x, v, f, octaves=5):
    """fbm periodic in x over 256 px with (fractional) frequency f: blend two integer ones."""
    f0 = np.floor(f)
    a = f - f0
    n0 = nz.fbm(x / 256.0 * f0, v, octaves, wrapx=f0.astype(int) if np.ndim(f0) == 0 else None)
    return n0 if np.ndim(f) == 0 else n0


def cloud_density(x, s, nz=N1):
    """density 0..1 of the cloud sea at picture coords (x, row s > CLOUD_HZ)."""
    w = np.clip((s - CLOUD_HZ) / (240.0 - CLOUD_HZ), 1e-3, 1)
    v = 16.0 / (w + 0.12)
    out = np.zeros_like(x)
    # integer horizontal frequencies per band so every row wraps at 256
    F = np.clip(np.round(6.0 / (w ** 0.85)), 6, 40)
    for f in np.unique(F):
        m = F == f
        out[m] = nz.fbm(x[m] / 256.0 * f, v[m] * 1.0, 5, wrapx=int(f))
    return out


def render_clouds():
    W, H, ss = 256, 240, 2
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    x = (xs + 0.5) / ss
    y = (ys + 0.5) / ss
    img = np.zeros((H * ss, W * ss, 3))
    h = CLOUD_HZ - y
    sky = ramp([(-10, (230, 236, 255)), (0, (200, 220, 255)), (10, (130, 180, 255)), (40, (60, 110, 240)),
                (80, (24, 40, 200)), (110, (8, 10, 150))], h)
    img[:] = sky
    sea = y > CLOUD_HZ
    xs_, ss_ = x[sea], y[sea]
    dens = cloud_density(xs_, ss_)
    dens2 = cloud_density(xs_, ss_ + 1.5)  # a little nearer: for lighting
    w = np.clip((ss_ - CLOUD_HZ) / (240.0 - CLOUD_HZ), 0, 1)
    thr = 0.40
    cov = smoothstep(thr - 0.02, thr + 0.04, dens)
    # billows: brighter where the field rises away from the viewer (lit from beyond)
    lit = np.clip(0.35 + 9.0 * (dens - dens2) + 2.2 * (dens - thr), 0, 1)
    cloudcol = ramp([(0.0, (90, 90, 200)), (0.35, (170, 165, 245)), (0.7, (240, 240, 255)), (1.0, (255, 225, 205))], lit)
    gap = ramp([(0, (30, 50, 170)), (1, (10, 20, 120))], w)[..., :]
    col = cloudcol * cov[:, None] + gap * (1 - cov[:, None])
    haze = np.exp(-w * 6.0)[:, None]
    col = col * (1 - haze) + np.array([210, 225, 255]) * haze
    img[sea] = col
    img = img.reshape(H, ss, W, ss, 3).mean((1, 3))
    return np.clip(img, 0, 255)


# ------------------------------------------------------------------------------------------
# Stratosphere: black sky, stars, the curve of the Earth with its thin glowing atmosphere.
EARTH_CX, EARTH_CY, EARTH_R = 128.0, 240 + 330.0, 452.0
LIMB_SUN_X = 206.0


def render_earth():
    W, H, ss = 256, 240, 3
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    x = (xs + 0.5) / ss
    y = (ys + 0.5) / ss
    img = np.zeros((H * ss, W * ss, 3))
    dx, dy = x - EARTH_CX, y - EARTH_CY
    r = np.hypot(dx, dy)
    alt = r - EARTH_R          # >0 above the surface
    # Atmosphere: glow falling off with altitude, brighter toward the sun
    sunw = np.exp(-((x - LIMB_SUN_X) / 70.0) ** 2)
    a = np.exp(-np.clip(alt, 0, None) / (5.5 + 3 * sunw))
    atm = ramp([(0, (0, 0, 0)), (0.12, (10, 20, 120)), (0.4, (40, 110, 255)), (0.75, (130, 210, 255)), (1.0, (235, 250, 255))], a)
    atm = atm + (sunw * a * 60)[..., None] * np.array([1.0, 0.8, 0.5])
    img = np.where((alt > 0)[..., None], atm, img)
    # Surface: spherical coords -> lat/lon texture with foreshortening
    inside = alt <= 0
    depth = np.clip(-alt / 140.0, 0, 1)      # 0 at the limb .. 1 nearest
    lon = np.arctan2(dx, -dy) * 6.0
    lat = np.sqrt(depth) * 9.0
    n1 = N2.fbm(lon * 3.0 + 10, lat * 3.0, 5)
    n2 = N4.fbm(lon * 5.0, lat * 5.0 + 3, 5)
    land = smoothstep(0.61, 0.64, n1)
    cloud = smoothstep(0.48, 0.66, n2) * (0.7 + 0.3 * (1 - depth))
    ocean = ramp([(0, (20, 70, 235)), (0.4, (0, 25, 190)), (1, (0, 5, 178))], depth)
    landc = ramp([(0, (150, 140, 110)), (1, (90, 110, 50))], depth)
    col = ocean * (1 - land[..., None]) + landc * land[..., None]
    col = col * (1 - cloud[..., None]) + np.array([245, 250, 255]) * cloud[..., None]
    # limb haze and the sun's glint
    haze = np.exp(alt / 4.0)  # alt <= 0 -> up to 1 at the limb
    col = col * (1 - 0.6 * haze[..., None]) + np.array([170, 220, 255]) * 0.6 * haze[..., None]
    glint = np.exp(-((x - LIMB_SUN_X) / 18.0) ** 2) * np.exp(alt / 10.0)
    col = col + (glint * 70)[..., None]
    img = np.where(inside[..., None], col, img)
    img = img.reshape(H, ss, W, ss, 3).mean((1, 3))
    # faint stars in the sky
    rng = np.random.default_rng(11)
    for _ in range(140):
        sx, sy = rng.integers(0, 256), rng.integers(0, 150)
        if alt.reshape(H, ss, W, ss)[sy, 0, sx, 0] > 30:
            img[sy, sx] = (110, 110, 120) if rng.random() < 0.7 else (200, 200, 210)
    return np.clip(img, 0, 255)


# ------------------------------------------------------------------------------------------
# The whole Earth, turning: 128x128 frames of a lit, textured sphere.
GLOBE_FRAMES = 32
GLOBE_PALS = [[0x01, 0x11, 0x21], [0x11, 0x21, 0x30], [0x01, 0x18, 0x30], [0x02, 0x12, 0x21]]


def render_globe(k, n=GLOBE_FRAMES, size=128, ss=3):
    S = size * ss
    ys, xs = np.mgrid[0:S, 0:S].astype(np.float64)
    R = 0.92
    u = (xs + 0.5) / S * 2 - 1
    v = (ys + 0.5) / S * 2 - 1
    r2 = u * u + v * v
    inside = r2 < R * R
    z = np.sqrt(np.clip(R * R - r2, 0, None)) / R
    nx, ny, nz = u / R, v / R, z
    # tilt the axis a little
    tilt = 0.4
    ny2 = ny * np.cos(tilt) - nz * np.sin(tilt)
    nz2 = ny * np.sin(tilt) + nz * np.cos(tilt)
    lat = np.arcsin(np.clip(-ny2, -1, 1))
    lon = np.arctan2(nx, nz2) + 2 * np.pi * k / n
    # periodic texture in longitude: sample noise on a circle
    cx, cy = np.cos(lon), np.sin(lon)
    landn = N2.fbm(cx * 2.2 + 5, cy * 2.2 + lat * 1.6 + 5, 5)
    cloudn = N4.fbm(cx * 3.0 + 9, cy * 3.0 + lat * 3.4, 5)
    land = smoothstep(0.55, 0.58, landn) * (np.abs(lat) < 1.25)
    ice = smoothstep(1.15, 1.25, np.abs(lat))
    cloud = smoothstep(0.52, 0.68, cloudn)
    ocean = np.array([10, 40, 200.0])
    landc = np.array([110, 120, 40.0])
    col = ocean * (1 - land[..., None]) + landc * land[..., None]
    col = col * (1 - ice[..., None]) + np.array([240, 245, 255.0]) * ice[..., None]
    col = col * (1 - cloud[..., None]) + np.array([250, 250, 255.0]) * cloud[..., None]
    # light from the upper left
    L = np.array([-0.55, -0.45, 0.70])
    L = L / np.linalg.norm(L)
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
    shade = 0.22 + 0.9 * lam ** 0.8
    col = col * shade[..., None]
    # atmosphere at the rim
    rim = (1 - z) ** 3
    col = col * (1 - 0.5 * rim[..., None]) + np.array([90, 170, 255.0]) * (0.5 * rim * (0.3 + lam))[..., None]
    img = np.zeros((S, S, 3))
    img[inside] = col[inside]
    halo = (~inside) & (r2 < (R * 1.06) ** 2)
    hv = np.clip(1 - (np.sqrt(r2) - R) / (R * 0.06), 0, 1) ** 2
    hl = np.clip(-(u * 0.55 + v * 0.45) + 0.3, 0, 1)
    img[halo] = (np.array([60, 140, 255.0]) * (hv * hl)[..., None])[halo]
    img = img.reshape(size, ss, size, ss, 3).mean((1, 3))
    return np.clip(img, 0, 255)
