"""Sprite art (procedural) and the sprite tile packer.

A sprite sheet is a 4 KB page (256 tiles) mapped at PPU $1000. Metasprites are emitted as
[count, (dy, tile, attr, dx)*] with signed offsets, the format the engine's draw_meta reads."""
import numpy as np
import nespal
from convert import tile_bytes, LAB


class SpritePage:
    def __init__(self, name):
        self.name = name
        self.tiles = [bytes(16)]  # tile 0 stays blank
        self.index = {bytes(16): 0}
        self.metas = {}

    def tile(self, t):
        """t: (8,8) colour numbers. Returns (tile index, attr flip bits)."""
        for flip, tt in ((0, t), (0x40, t[:, ::-1]), (0x80, t[::-1, :]), (0xC0, t[::-1, ::-1])):
            tb = tile_bytes(tt)
            if tb in self.index:
                return self.index[tb], flip
        tb = tile_bytes(t)
        self.index[tb] = len(self.tiles)
        self.tiles.append(tb)
        assert len(self.tiles) <= 256, 'sprite page full: ' + self.name
        return self.index[tb], 0

    def add_meta(self, name, idx, pal, ox, oy, behind=False):
        """idx: (H, W) colour numbers (0 = transparent), pal: sprite palette 0-3, (ox, oy) = origin
        within idx. Cuts into 8x8 cells on a grid aligned to the image."""
        H, W = idx.shape
        ents = []
        for cy in range(0, H, 8):
            for cx in range(0, W, 8):
                cell = np.zeros((8, 8), np.uint8)
                c = idx[cy:cy + 8, cx:cx + 8]
                cell[:c.shape[0], :c.shape[1]] = c
                if not cell.any():
                    continue
                t, flip = self.tile(cell)
                ents.append((cy - oy, t, pal | flip | (0x20 if behind else 0), cx - ox))
        self.metas[name] = ents
        return ents

    def add_layers(self, name, layers, ox, oy):
        """layers: list of (idx image, palette). All same size; cells emitted per layer."""
        ents = []
        for idx, pal in layers:
            sub = self.add_meta(name + '_tmp', idx, pal, ox, oy)
            ents += sub
        del self.metas[name + '_tmp']
        self.metas[name] = ents
        return ents

    def chr(self):
        data = b''.join(self.tiles)
        return data + bytes(4096 - len(data))

    def asm(self):
        out = []
        for name, ents in self.metas.items():
            out.append(f'meta_{name}:')
            out.append(f'  .byte {len(ents)}')
            for dy, t, a, dx in ents:
                out.append(f'  .byte {dy & 255}, {t}, ${a:02X}, {dx & 255}')
        return '\n'.join(out) + '\n'


def quant3(rgb, alpha, cols):
    """RGB(A) image -> colour numbers 1..3 by nearest Lab among cols, 0 where alpha < .5."""
    lab = nespal.lab(rgb)
    d = np.linalg.norm(lab[..., None, :] - LAB[np.array(cols)], axis=-1)
    idx = d.argmin(-1).astype(np.uint8) + 1
    idx[alpha < 0.5] = 0
    return idx


def ss_grid(W, H, ss=4):
    ys, xs = np.mgrid[0:H * ss, 0:W * ss].astype(np.float64)
    return (xs + 0.5) / ss, (ys + 0.5) / ss


def down(a, W, H, ss=4):
    return a.reshape(H, ss, W, ss).mean((1, 3))


def balloon_levels(W, H, cx, cy, rx, ry, light=(0.75, -0.55), ss=4):
    """Latex balloon envelope: returns (alpha, shade 0..1) at W x H."""
    x, y = ss_grid(W, H, ss)
    u = (x - cx) / rx
    v = (y - cy) / ry
    # Teardrop: narrow the bottom half toward the neck.
    taper = np.where(v > 0, 1 - 0.38 * v ** 2, 1.0)
    r2 = (u / np.maximum(taper, 0.05)) ** 2 + v ** 2
    inside = (r2 <= 1) & (v < 1.08)
    nz = np.sqrt(np.clip(1 - r2, 0, 1))
    lx, ly = light
    lz = np.sqrt(max(0.0, 1 - lx * lx - ly * ly))
    lam = np.clip(u * lx + v * ly + nz * lz, 0, 1)
    spec = np.clip(u * lx + v * ly + nz * lz, 0, 1) ** 18
    shade = np.clip(0.18 + 0.75 * lam + 0.5 * spec, 0, 1)
    a = inside.astype(float)
    return down(a, W, H, ss), down(shade * a, W, H, ss) / np.maximum(down(a, W, H, ss), 1e-6)


BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 + 1 / 32


def shade_to_idx(alpha, shade, levels=(0.33, 0.66), dither=True):
    """shade 0..1 -> colour 1..3 with ordered dither between bands."""
    H, W = shade.shape
    b = BAYER4[np.arange(H)[:, None] % 4, np.arange(W)[None, :] % 4] if dither else 0.5
    s = shade * 3.0 - 0.5 + (b - 0.5) * 0.9
    idx = np.clip(np.floor(s + 0.5), 0, 2).astype(np.uint8) + 1
    idx[alpha < 0.5] = 0
    return idx


def balloon_rig(scale=1.0, payload=True):
    """Balloon + cords + parachute + payload. Returns (env_idx, rig_idx, ox, oy) where the origin is
    the balloon centre. env uses the balloon palette, rig the payload palette (1=cord, 2=red, 3=white)."""
    rx, ry = 12 * scale, 14 * scale
    W = int(np.ceil(rx * 2 + 4)) + 4
    W = (W + 7) // 8 * 8
    neck = ry * 1.05
    rig_len = 30 if payload else 0
    H = int(np.ceil(ry + neck + 4 + rig_len))
    H = (H + 7) // 8 * 8
    cx, cy = W / 2, ry + 2
    a, s = balloon_levels(W, H, cx, cy, rx, ry)
    env = shade_to_idx(a, s)
    rig = np.zeros((H, W), np.uint8)
    if payload:
        nx = int(cx)
        y0 = int(cy + neck)
        # neck tie and cord to the parachute
        for y in range(y0 - 1, y0 + 7):
            rig[y, nx - 1] = 1
        # folded parachute: small red dome
        py = y0 + 7
        for dy in range(4):
            w = [2, 3, 3, 3][dy]
            rig[py + dy, nx - 1 - w:nx - 1 + w] = 2
        rig[py + 1, nx - 2] = 3
        # cord to the payload
        for y in range(py + 4, py + 13):
            rig[y, nx - 1] = 1
        # payload box (polystyrene) with antenna
        by = py + 13
        rig[by:by + 5, nx - 4:nx + 2] = 3
        rig[by + 1:by + 5, nx + 1] = 1
        rig[by + 4, nx - 4:nx + 2] = 1
        rig[by + 5:by + 8, nx - 3] = 1
    return env, rig, int(cx), int(cy)


def sun_frames(page, ridge_fn, x0, ys, r=10.5):
    """Sun discs at heights ys (screen-independent image y of the centre), cut by ridge_fn(x)."""
    names = []
    W = H = 24
    x, y = ss_grid(W, H, 4)
    for k, yc in enumerate(ys):
        gx = x - W / 2 + x0
        gy = y - H / 2 + yc
        d = np.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2)
        disc = (d <= r) & (gy < ridge_fn(gx))
        a = down(disc.astype(float), W, H)
        core = down((d < r * 0.55).astype(float), W, H)
        mid = down((d < r * 0.85).astype(float), W, H)
        idx = np.where(core > 0.5, 3, np.where(mid > 0.5, 2, 1)).astype(np.uint8)
        idx[a < 0.5] = 0
        page.add_meta(f'sun{k}', idx, 2, W // 2, H // 2)
        names.append(f'sun{k}')
    return names


def burst_fragments(page):
    """Shreds of latex for the burst: a few small curled pieces."""
    names = []
    shapes = [
        ["..##....", ".####...", "##.###..", "#...##..", "....##..", ".....#..", "........", "........"],
        ["........", "..##....", ".#..#...", ".#..##..", "....###.", ".....##.", "........", "........"],
        ["........", "........", ".##.....", "#####...", "..####..", "....##..", "........", "........"],
        ["...#....", "..###...", ".##.#...", ".#..##..", "....#...", "........", "........", "........"],
    ]
    for k, sh in enumerate(shapes):
        idx = np.array([[3 if c == "#" else 0 for c in row] for row in sh], np.uint8)
        # shade: lower-left pixels mid tone
        for y in range(8):
            for x in range(8):
                if idx[y, x] and (x + y) % 3 == 0:
                    idx[y, x] = 2
        page.add_meta(f"frag{k}", idx, 0, 4, 4)
        names.append(f"frag{k}")
    return names


def parachute_rig(open_frac=1.0):
    """Open parachute (red/white dome) with lines down to the payload. Origin: dome centre."""
    W, H = 32, 40
    x, y = ss_grid(W, H, 4)
    cx, cy = 16.0, 9.0
    rx, ry = 14.0 * open_frac + 2, 8.0 * open_frac + 1
    u, v = (x - cx) / rx, (y - cy) / ry
    dome = (u * u + v * v <= 1) & (v <= 0.35)
    # gores: alternate red / white panels
    ang = np.arctan2(y - (cy + ry * 0.4), x - cx)
    gore = (np.floor((ang + np.pi) / (np.pi / 6)) % 2).astype(int)
    a = down(dome.astype(float), W, H)
    g = down((dome & (gore == 0)).astype(float), W, H)
    idx = np.where(a > 0.5, np.where(g > 0.5 * a, 2, 3), 0).astype(np.uint8)
    # suspension lines
    by = int(cy + 26)
    for sx in (int(cx - rx * 0.9), int(cx - rx * 0.3), int(cx + rx * 0.3), int(cx + rx * 0.9)):
        for t in np.linspace(0, 1, 40):
            px = int(round(sx + (cx - 1 - sx) * t))
            py = int(round(cy + ry * 0.3 + (by - cy - ry * 0.3) * t))
            if 0 <= px < W and 0 <= py < H and idx[py, px] == 0:
                idx[py, px] = 1
    # payload box
    idx[by:by + 5, int(cx) - 3:int(cx) + 3] = 3
    idx[by + 4, int(cx) - 3:int(cx) + 3] = 1
    idx[by + 5:by + 8, int(cx) - 2] = 1
    return idx, int(cx), int(cy)


def flare_disc(r, ss=4):
    W = H = int(np.ceil(r * 2 + 2))
    W = H = (W + 7) // 8 * 8
    x, y = ss_grid(W, H, ss)
    d = np.hypot(x - W / 2, y - H / 2)
    ring = down(((d <= r) & (d >= r - 1.3)).astype(float), W, H)
    fill = down((d < r - 1.3).astype(float), W, H)
    idx = np.zeros((H, W), np.uint8)
    idx[fill > 0.5] = 1
    # sparse dither inside so it reads as translucent
    yy, xx = np.mgrid[0:H, 0:W]
    idx[(fill > 0.5) & ((xx + yy) % 2 == 1)] = 0
    idx[ring > 0.4] = 2
    return idx, W // 2, H // 2
