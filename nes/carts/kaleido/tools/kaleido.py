"""The kaleidoscope: glass shards tumbling in an object cell, seen through four mirrors (wallpaper
group p4m: mirrors every 64 px and on the diagonals), as a 128x128 px cell = 16x16 tiles = one full
4 KB CHR bank per frame. Every shard moves on a closed path, so the 16 frames loop seamlessly."""
import math
import numpy as np

N = 16          # frames per loop
CELL = 128
H = 64          # mirror spacing


def fold(x, y):
    u = np.mod(x, 2.0 * H)
    u = np.where(u > H, 2 * H - u, u)
    v = np.mod(y, 2.0 * H)
    v = np.where(v > H, 2 * H - v, v)
    return np.maximum(u, v), np.minimum(u, v)


def tri_point(rng):
    while True:
        u, v = rng.uniform(-2, 68), rng.uniform(-2, 68)
        if v <= u + 2:
            return (u, v)


def shards(seed=11, n=24):
    """Regular glass gems (triangles, squares, hexagons, a few long slivers), each circling a small
    loop and turning by its own symmetry angle once per loop."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        k = int(rng.choice([3, 3, 4, 4, 6, 2]))
        size = rng.uniform(7.0, 17.0)
        if k == 2:          # a sliver: a thin diamond
            verts = np.array([[size * 1.6, 0], [0, size * 0.35], [-size * 1.6, 0], [0, -size * 0.35]])
            sym = 2
        else:
            ang = np.linspace(0, 2 * np.pi, k, endpoint=False)
            verts = np.stack([size * np.cos(ang), size * np.sin(ang)], -1)
            sym = k
        out.append(dict(
            cls=int(rng.choice([1, 2, 3, 1, 2, 2])),
            c0=tri_point(rng),
            amp=rng.uniform(3, 9),
            ph=rng.uniform(0, 2 * np.pi),
            dir=int(rng.choice([-1, 1])),
            rot0=rng.uniform(0, 2 * np.pi),
            turn=int(rng.choice([-1, 1])) * 2 * np.pi / sym,
            verts=verts,
            z=rng.uniform(),
        ))
    out.sort(key=lambda s: s['z'])
    return out


def inside_poly(px, py, verts):
    """Signed-distance-ish test for a convex-ish polygon (vertices in angular order)."""
    n = len(verts)
    ins = np.ones(px.shape, bool)
    dmin = np.full(px.shape, 1e9)
    for i in range(n):
        ax, ay = verts[i]
        bx, by = verts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        L = math.hypot(ex, ey) + 1e-9
        cross = (ex * (py - ay) - ey * (px - ax)) / L
        ins &= cross >= 0
        dmin = np.minimum(dmin, cross)
    return ins, dmin


def frame(t, sh, ss=4):
    o = (np.arange(ss) + 0.5) / ss
    ys, xs = np.mgrid[0:CELL, 0:CELL]
    acc = np.zeros((CELL, CELL, 4))
    ph = 2 * np.pi * t / N
    for oy in o:
        for ox in o:
            u, v = fold(xs + ox, ys + oy)
            cls = np.zeros(u.shape, np.uint8)
            for s in sh:
                cx = s['c0'][0] + s['amp'] * math.cos(s['dir'] * ph + s['ph'])
                cy = s['c0'][1] + s['amp'] * math.sin(s['dir'] * ph + s['ph'])
                rot = s['rot0'] + s['turn'] * t / N       # turns by its symmetry angle per loop
                ca, sa = math.cos(rot), math.sin(rot)
                V = s['verts'] @ np.array([[ca, sa], [-sa, ca]])
                # fold the shard too: test the point and its mirror images near the domain
                hit = np.zeros(u.shape, bool)
                edge = np.zeros(u.shape, bool)
                for qx, qy in ((u, v), (v, u), (-u, v), (u, -v), (2 * H - u, v), (u, 2 * H - v), (v, -u), (-v, u)):
                    ins, d = inside_poly(qx - cx, qy - cy, V)
                    hit |= ins
                    edge |= ins & (d < 0.9)
                cls = np.where(hit, np.where(edge, 0, s['cls']), cls)
            for c in range(4):
                acc[..., c] += (cls == c)
    acc[..., 0] *= 1.15
    return acc.argmax(-1).astype(np.uint8)


def render():
    sh = shards()
    return [frame(t, sh) for t in range(N)]


def phi_maps():
    """Per-tile phases: ring distance from the screen centre (64 steps), and a spiral."""
    ys, xs = np.mgrid[0:30, 0:32]
    dx, dy = xs * 8 + 4 - 128, ys * 8 + 4 - 120
    r = np.hypot(dx, dy)
    th = np.arctan2(dy, dx) % (2 * np.pi)
    ring = np.clip(r / 3.0, 0, 63).astype(int)
    # a mandala map with the mirrors' symmetry: rings that bulge out along the 8 mirror axes
    a8 = np.abs(((th / (2 * np.pi) * 8) % 2) - 1)        # 0 on the axes, 1 halfway between
    petal = np.clip(r / 4.0 + 7 * a8, 0, 63).astype(int)
    # the exposition's mask: ring (r/8, 0..15) + 16 * group: the wedges either side of the
    # horizontal mirror (group 0), then those either side of the vertical one (group 1)
    sector = (th / (2 * np.pi) * 8).astype(int) % 8
    group = np.where(np.isin(sector, [0, 7, 3, 4]), 0, 1)
    mask = np.clip(r / 8.0, 0, 15).astype(int) + 16 * group
    return {'ring': ring, 'spiral': petal, 'mask': mask}


def nametable():
    """Tile index for each screen position: the cell's local tile, shifted so a 4-fold mirror centre
    (a cell corner) sits at the screen centre (128, 120)."""
    ys, xs = np.mgrid[0:30, 0:32]
    return (xs % 16) + 16 * ((ys + 1) % 16)
