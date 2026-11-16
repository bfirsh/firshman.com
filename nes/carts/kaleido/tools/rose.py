"""The rose window: a 12-fold stained-glass window, drawn as glass classes (0 lead, 1 blue,
2 ruby, 3 gold) at 4x4 supersampling and reduced per pixel by majority vote."""
import numpy as np
from nes import supersample

CX, CY = 128.0, 120.0


def glass(x, y):
    dx, dy = x - CX, y - CY
    r = np.hypot(dx, dy)
    th = np.degrees(np.arctan2(dy, dx)) % 360
    out = np.zeros(r.shape, np.uint8)

    def lead_ring(r0, r1):
        return (r >= r0) & (r < r1)

    # centre: a ruby eye in a gold disc
    out[r < 12] = 3
    out[r < 5.5] = 2
    out[(r >= 5.5) & (r < 6.6)] = 0
    # ring A: 12 ruby petals on blue
    a = (th + 15) % 30 - 15
    ar = np.radians(a)
    px, py = r * np.cos(ar), r * np.sin(ar)
    m = (r >= 13.2) & (r < 40)
    out[m] = 1
    t = np.clip((px - 15) / 23.0, 0, 1)
    w = 7.2 * np.sin(np.pi * t) ** 0.75
    petal = m & (px > 15) & (px < 38) & (np.abs(py) < w)
    out[petal] = 2
    out[petal & (np.abs(py) > w - 1.1)] = 0
    # a gold seed and a vein in each petal, gold drops between the petals
    out[petal & (np.hypot(px - 29, py) < 2.6)] = 3
    out[petal & (np.abs(py) < 0.55) & (px > 18) & (px < 26)] = 0
    gap = m & (np.hypot(r * np.cos(np.radians((th % 30) - 15)) - 33.5, r * np.sin(np.radians((th % 30) - 15))) < 2.4)
    out[gap] = 3
    # ring B: 12 blue lancets with gold roundels, ruby spandrels
    b = th % 30 - 15
    br = np.radians(b)
    qx, qy = r * np.cos(br), r * np.sin(br)
    m = (r >= 42.4) & (r < 78)
    out[m] = 2
    wl = np.where(qx < 62, 8.0, 8.0 * np.clip(1 - (qx - 62) / 14.5, 0, 1) ** 0.6)
    lan = m & (qx > 45) & (qx < 76.5) & (np.abs(qy) < wl)
    out[lan] = 1
    out[lan & ((np.abs(qy) > wl - 1.1) | (qx < 46.1))] = 0
    d = np.hypot(qx - 57, qy)
    out[lan & (d < 5.6)] = 3
    out[lan & (d >= 4.6) & (d < 5.6)] = 0
    d2 = np.hypot(qx - 69, qy)
    out[lan & (d2 < 2.6)] = 3
    # gold daggers in the ruby spandrels, outlined
    dg_t = np.clip((px - 52) / 22.0, 0, 1)
    dgw = 3.0 * np.sin(np.pi * dg_t) ** 0.8
    dag = m & (px > 52) & (px < 74) & (np.abs(py) < dgw)
    out[dag] = 3
    out[dag & (np.abs(py) > dgw - 0.9)] = 0
    out[m & (np.hypot(px - 47.5, py) < 2.2)] = 1
    # ring C: ruby roundels with gold hearts, small gold roundels between, on blue
    m = (r >= 80.6) & (r < 103)
    out[m] = 1
    d = np.hypot(px - 92, py)
    ang4 = np.arctan2(py, px - 92)
    foil = 6.2 + 2.6 * np.abs(np.cos(2 * ang4))          # a quatrefoil inside the roundel
    out[m & (d < 10.2)] = 2
    out[m & (d >= 9.0) & (d < 10.2)] = 0
    out[m & (d < foil) & (d >= foil - 1.0)] = 0
    out[m & (d < 3.4)] = 3
    out[m & (d >= 2.5) & (d < 3.4)] = 0
    d = np.hypot(qx - 94, qy)
    out[m & (d < 5.6)] = 3
    out[m & (d >= 4.6) & (d < 5.6)] = 0
    # ring D: 48 small panes, gold and blue alternating
    m = (r >= 105.4) & (r < 114)
    k = np.floor(th / 7.5).astype(int)
    out[m] = np.where(k[m] % 2 == 0, 3, 1)
    edge = ((th % 7.5) * np.pi / 180 * r < 1.0)
    out[m & edge] = 0
    cen = np.hypot(r - 109.7, ((th % 7.5) - 3.75) * np.pi / 180 * r) < 1.6
    out[m & cen & (k % 2 == 0)] = 2
    # lead rings
    for r0, r1 in ((12, 13.2), (40, 42.4), (78, 80.6), (103, 105.4)):
        out[lead_ring(r0, r1)] = 0
    out[r >= 114] = 0
    return out


def render():
    s = supersample(glass, ss=4)
    counts = np.stack([(s == k).sum(-1) for k in range(4)], -1)
    # lead wins ties a little (keeps the tracery crisp)
    counts[..., 0] = counts[..., 0] * 1.25
    return counts.argmax(-1).astype(np.uint8)


def phi_maps():
    """Per-tile phases for the light fields (64 steps each): radius, angle, spiral, petal."""
    ys, xs = np.mgrid[0:30, 0:32]
    dx, dy = xs * 8 + 4 - CX, ys * 8 + 4 - CY
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx) % (2 * np.pi)
    rad = np.clip(r / 2.0, 0, 63).astype(int)                      # 2 px per step
    ang = (th / (2 * np.pi) * 64).astype(int) % 64                 # 5.6 degrees per step
    spi = (ang + (r / 4).astype(int)) % 64
    return {'rad': rad, 'ang': ang, 'spi': spi}
