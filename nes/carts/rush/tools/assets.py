#!/usr/bin/env python3
"""RUSH asset generator: every graphic is computed here (no source images).

Writes into out/gen/:
  chr.bin     CHR-ROM in 1 KB banks (see the bank map below)
  nta.bin     nametable A (CIRAM A): bar gradient rows, the title, twister rows, the sun
  ntb.bin     nametable B (CIRAM B): the perspective floor's row types
  exr.bin     ExRAM as a nametable: the tunnel's identity layout and fog attributes
  assets.inc  bank numbers, tile numbers and per-line tables for the kernels
  preview/    PNG previews (decoded with the real palettes) for checking by eye

1 KB CHR bank map
  0          blank (slot 0 for effects that do not bank it per line)
  1-3        common background tiles 64-255 (bars, title, sun, solids)
  4-7        sprites
  TW_BASE    32 twister slices (0-90 degrees), tiles 0-11, every pattern row the same slice
  GR_BASE    floor scales, two per bank (tiles 0-31 and 32-63), rows extruded
  TU_BASE    tunnel frames: 12 banks each (3 bands x 4 slots)
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
CART = HERE.parent
OUT = CART / 'out' / 'gen'
PREV = CART / 'out' / 'preview'
sys.path.insert(0, str(HERE))
import nespal  # noqa: E402

KS, KE = 32, 208          # kernel (picture) lines: 176 lines, letterboxed
HORIZON = 104             # floor: last sky line
TW_COLS = (9, 23)         # twister tile columns [a, b)
TW_ANGLES = 32
TU_FRAMES = 8

# --------------------------------------------------------------------------- CHR helpers
def enc_tile(px):
    """8x8 array of 0..3 -> 16 bytes."""
    b = bytearray(16)
    for y in range(8):
        lo = hi = 0
        for x in range(8):
            v = int(px[y][x])
            lo |= (v & 1) << (7 - x)
            hi |= ((v >> 1) & 1) << (7 - x)
        b[y] = lo
        b[8 + y] = hi
    return bytes(b)


class Bank:
    def __init__(self):
        self.tiles = [bytes(16)] * 64

    def data(self):
        return b''.join(self.tiles)


banks = {}


def bank(n):
    if n not in banks:
        banks[n] = Bank()
    return banks[n]


# common tiles 64..255 live in banks 1..3
common = {}
common_list = []


def ctile(px):
    """Intern a common tile, returns its pattern index (64..255)."""
    e = enc_tile(px)
    if e in common:
        return common[e]
    idx = 64 + len(common_list)
    if idx > 255:
        raise SystemExit('out of common tiles')
    common[e] = idx
    common_list.append(e)
    bank(1 + (idx - 64) // 64).tiles[(idx - 64) % 64] = e
    return idx


def solid(v):
    return [[v] * 8 for _ in range(8)]


T_BLANK = ctile(solid(0))
assert T_BLANK == 64

# --------------------------------------------------------------------------- bars source rows
# 16 source rows per palette band: level 0..6 with checker dithers in two phases
BAR_ROWS = []
def bar_row(r, x):
    if r == 0:
        return 0
    if r in (1, 2):
        return 1 if (x + r) & 1 else 0
    if r == 3:
        return 1
    if r in (4, 5):
        return 2 if (x + r) & 1 else 1
    if r == 6:
        return 2
    if r in (7, 8):
        return 3 if (x + r) & 1 else 2
    if r == 9:
        return 3
    return 0
LEVEL_ROW = [(0, 0), (1, 2), (3, 3), (4, 5), (6, 6), (7, 8), (9, 9)]   # level -> (row phase 0, row phase 1)
def lev_px(L, x, parity):
    """Level 0..6 (float) -> colour index, dithered with a 2x2 checker."""
    lo = int(math.floor(L))
    frac = L - lo
    if frac > 0.5:
        lo += 1
    lo = max(0, min(6, lo))
    r = LEVEL_ROW[lo][parity]
    return bar_row(r, x)


T_BAR0 = ctile([[bar_row(r, x) for x in range(8)] for r in range(8)])
T_BAR1 = ctile([[bar_row(r + 8, x) for x in range(8)] for r in range(8)])
T_S1, T_S2, T_S3 = ctile(solid(1)), ctile(solid(2)), ctile(solid(3))

nta = np.full((30, 32), T_BLANK, dtype=np.int32)
nta_pal = np.zeros((15, 16), dtype=np.int32)   # per 16x16 attribute cell
for band in range(4):
    nta[band * 2, :] = T_BAR0
    nta[band * 2 + 1, :] = T_BAR1
    nta_pal[band, :] = band

# --------------------------------------------------------------------------- title "RUSH"
def title_mask():
    """Bold, italic, original letterforms with racing-stripe cuts. 4x supersampled."""
    S = 4
    W, H = 128, 32
    m = np.zeros((H * S, W * S), dtype=bool)
    yy, xx = np.mgrid[0:H * S, 0:W * S] / S
    def rect(x0, y0, x1, y1, ox):
        return (xx >= ox + x0) & (xx < ox + x1) & (yy >= y0) & (yy < y1)
    def poly(pts, ox):
        # convex polygon test
        pos = np.ones_like(m)
        neg = np.ones_like(m)
        n = len(pts)
        for i in range(n):
            (ax, ay), (bx, by) = pts[i], pts[(i + 1) % n]
            cr = (bx - ax) * (yy - ay) - (by - ay) * (xx - ox - ax)
            pos &= cr >= 0
            neg &= cr <= 0
        return pos | neg
    st = 8
    w = 24
    letters = []
    # R
    def R(ox):
        r = rect(0, 0, st, 32, ox) | rect(0, 0, w - 3, st, ox) | rect(w - st, 3, w, 14, ox) | rect(0, 12, w - 3, 12 + st - 1, ox)
        r |= poly([(w - st - 4, 14), (w - st + 4, 14), (w + 1, 32), (w - st - 7, 32)], ox)
        # rounded corner of the bowl
        r |= ((xx - ox - (w - 3)) ** 2 + (yy - 3) ** 2 < 9) | ((xx - ox - (w - 3)) ** 2 + (yy - 16) ** 2 < 9)
        r &= ~(rect(st, st, w - st, 12, ox))
        return r
    def U(ox):
        r = rect(0, 0, st, 28, ox) | rect(w - st, 0, w, 28, ox) | rect(3, 32 - st, w - 3, 32, ox)
        r |= ((xx - ox - 4) ** 2 + (yy - 28) ** 2 < 16) & (xx - ox < 6)
        r |= ((xx - ox - (w - 4)) ** 2 + (yy - 28) ** 2 < 16) & (xx - ox > w - 6)
        return r
    def Sg(ox):
        r = rect(3, 0, w, st, ox) | rect(0, 3, st, 16, ox) | rect(3, 12, w - 3, 12 + st, ox) | rect(w - st, 16, w, 29, ox) | rect(0, 32 - st, w - 3, 32, ox)
        r |= ((xx - ox - 4) ** 2 + (yy - 4) ** 2 < 16) | ((xx - ox - (w - 4)) ** 2 + (yy - 28) ** 2 < 16)
        r |= ((xx - ox - 4) ** 2 + (yy - 16) ** 2 < 16) & (xx - ox < 8) & (yy < 20)
        r |= ((xx - ox - (w - 4)) ** 2 + (yy - 16) ** 2 < 16) & (xx - ox > w - 8) & (yy > 12)
        return r
    def Hh(ox):
        return rect(0, 0, st, 32, ox) | rect(w - st, 0, w, 32, ox) | rect(0, 12, w, 12 + st, ox)
    gap = 6
    m = R(4) | U(4 + w + gap) | Sg(4 + 2 * (w + gap)) | Hh(4 + 3 * (w + gap))
    # racing stripes: two thin horizontal cuts
    m &= ~(((yy >= 9) & (yy < 10.5)) | ((yy >= 22) & (yy < 23.5)))
    # italic shear
    out = np.zeros_like(m)
    for y in range(H * S):
        sh = int(round((H * S - y) * 0.28))
        out[y, sh:] = m[y, :W * S - sh]
    cov = out.reshape(H, S, W, S).mean(axis=(1, 3))
    return cov


def title_tiles():
    cov = title_mask()                  # 32 x 128
    H, W = cov.shape
    px = np.zeros((H, W), dtype=np.int32)
    for y in range(H):
        for x in range(W):
            c = cov[y, x]
            if c < 0.3:
                continue
            # vertical light: bright core at the top, darker at the bottom, edges a step darker
            lev = 3 if y < 12 else 2
            if y >= 24:
                lev = 2 if (x + y) & 1 else 1
            if c < 0.75:
                lev = 1
            px[y, x] = lev
    return px


TITLE_ROW, TITLE_COL = 8, 8          # nametable A rows 8-11, columns 8-23
tp = title_tiles()
for ty in range(4):
    for tx in range(16):
        nta[TITLE_ROW + ty, TITLE_COL + tx] = ctile(tp[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8])
for ar in (4, 5):
    nta_pal[ar, :] = 3

# --------------------------------------------------------------------------- twister rows (nametable A rows 12-19)
TW_ROW = 12
for band in range(4):
    for r in (0, 1):
        for c in range(TW_COLS[0], TW_COLS[1]):
            nta[TW_ROW + band * 2 + r, c] = c - TW_COLS[0]        # slot 0 tiles 0..11 (banked per line)
    nta_pal[6 + band, :] = band

# --------------------------------------------------------------------------- the sun (nametable A rows 20-29)
SUN_ROW, SUN_COL, SUN_T = 20, 11, 10
def sun_tiles():
    n = SUN_T * 8
    px = np.zeros((n, n), dtype=np.int32)
    cx = cy = n / 2
    R = n / 2 - 1.5
    for y in range(n):
        for x in range(n):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d > R:
                continue
            # rows 0-31: palette 2 (yellow top), 32-79: palette 3 (orange-pink bottom)
            if y < 32:
                t = y / 32
                lev = 6 - t * 3            # 6 .. 3 (levels in a 0..6 ramp)
            else:
                t = (y - 32) / 48
                lev = 6 - t * 4.5
            if d > R - 1.2:
                lev -= 1.5                 # soft rim
            lev = max(1, min(6, lev))
            px[y, x] = lev_px(lev, x, y & 1)
    return px


sp = sun_tiles()
for ty in range(SUN_T):
    for tx in range(SUN_T):
        nta[SUN_ROW + ty, SUN_COL + tx] = ctile(sp[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8])
for ar in range(10, 15):
    nta_pal[ar, :] = 2 if ar < 12 else 3

# --------------------------------------------------------------------------- twister slices
TW_BASE = 32                      # banks 32-63: bank = (angle & 31) | 32
TW_W = (TW_COLS[1] - TW_COLS[0]) * 8
def twister_slice(theta):
    R = TW_W / 2 - 2.5
    cx = TW_W / 2
    lev = np.zeros(TW_W)
    corners = [theta + math.pi / 4 + k * math.pi / 2 for k in range(4)]
    for x in range(TW_W):
        px = x + 0.5 - cx
        best = None
        for k in range(4):
            a0, a1 = corners[k], corners[(k + 1) % 4]
            x0, x1 = R * math.cos(a0), R * math.cos(a1)
            beta = (a0 + a1) / 2 if k < 3 else (a0 + a1 + 2 * math.pi) / 2
            nz = math.sin(beta)
            if nz <= 0:
                continue
            lo, hi = min(x0, x1), max(x0, x1)
            if lo <= px < hi:
                # light from the upper front left: brightness from the face normal
                b = max(0.0, math.cos(beta - math.radians(115)))
                b = 0.18 + 0.82 * b
                edge = min(px - lo, hi - px)
                best = (b, edge)
        if best is None:
            continue
        b, edge = best
        L = 1 + b * 5.6
        if edge < 1.0:
            L = max(1, L - 2.5)       # dark seam between faces
        lev[x] = min(6, L)
    return lev


for a in range(TW_ANGLES):
    th = a * (math.pi / 2) / TW_ANGLES
    lev = twister_slice(th)
    b = bank(TW_BASE + a)
    for t in range(TW_COLS[1] - TW_COLS[0]):
        px = [[lev_px(lev[t * 8 + x], t * 8 + x, r & 1) for x in range(8)] for r in range(8)]
        b.tiles[t] = enc_tile(px)

# --------------------------------------------------------------------------- floor scales
GR_BASE = TW_BASE + TW_ANGLES
FLOOR_D = KE - 1 - HORIZON            # floor lines d = 1..FLOOR_D (screen lines HORIZON+1 .. KE-1)
GRID_K = 72.0 / FLOOR_D               # line spacing (px) per unit d
def floor_row(d):
    w = GRID_K * d
    t = 0.45 + d * 0.022              # line half-width core
    row = np.zeros(256, dtype=np.int32)
    for x in range(256):
        px = x + 0.5 - 128
        if w < 3.2:
            row[x] = 2 if (x + d) % 3 == 0 else 1        # haze near the horizon
            continue
        n = round(px / w)
        dist = abs(px - n * w)
        if dist < t:
            row[x] = 3
        elif dist < t + 1.1:
            row[x] = 2
        else:
            row[x] = 1
    return row


for d in range(1, FLOOR_D + 1):
    row = floor_row(d)
    bn = GR_BASE + (d - 1) // 2
    half = (d - 1) & 1
    b = bank(bn)
    for t in range(32):
        b.tiles[half * 32 + t] = enc_tile([row[t * 8:t * 8 + 8]] * 8)
GR_BANKS = (FLOOR_D + 1) // 2

ntb = np.full((30, 32), T_BLANK, dtype=np.int32)
ntb_pal = np.zeros((15, 16), dtype=np.int32)
for r, (kind, pal) in enumerate([('A', 0), ('B', 0), ('A', 1), ('B', 1), ('L', 0), ('L', 0), ('L', 1), ('L', 1),
                                 ('G', 0), ('G', 0), ('G', 1), ('G', 1)]):
    for c in range(32):
        ntb[r, c] = {'A': c, 'B': 32 + c, 'L': T_S3, 'G': T_S2}[kind]
for ar, pal in enumerate([0, 1, 0, 1, 0, 1]):
    ntb_pal[ar, :] = pal
FLOOR_FOG_D = 34                      # d below this: far (palette 0)
G_BLACK_Y = 12 * 8                    # a blank row in nametable B

# --------------------------------------------------------------------------- tunnel
TU_BASE = GR_BASE + GR_BANKS
TU_RINGS = 1.6
TU_SEG = 6
TU_RAD = 52.0
def tunnel_index(x, y, phase):
    dx = x - 128.0
    dy = (y - 88.0) * 1.08
    r = math.hypot(dx, dy)
    if r < 7:
        return 0
    u = TU_RAD / r * TU_RINGS * 3          # 3 colours per cycle
    a = math.atan2(dy, dx) / (2 * math.pi) * TU_SEG
    return 1 + int(math.floor(u + a + phase)) % 3


def tunnel_fog(x, y):
    """Probability that a pixel stays lit: the far end of the tunnel fades into black (dithered)."""
    r = math.hypot(x - 128.0, (y - 88.0) * 1.08)
    return min(1.0, max(0.0, (r - 10) / 34))


BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16 + 1 / 32


def tunnel_frame(phase, ss=3):
    img = np.zeros((176, 256), dtype=np.int32)
    offs = [(i + 0.5) / ss for i in range(ss)]
    for y in range(176):
        for x in range(256):
            votes = [0, 0, 0, 0]
            for oy in offs:
                for ox in offs:
                    votes[tunnel_index(x + ox, y + oy, phase)] += 1
            v = int(np.argmax(votes))
            if v and tunnel_fog(x + 0.5, y + 0.5) < BAYER[y & 3, x & 3]:
                v = 0
            img[y, x] = v
    return img


tu_imgs = []
for f in range(TU_FRAMES):
    img = tunnel_frame(f / TU_FRAMES)
    tu_imgs.append(img)
    for band in range(3):
        for slot in range(4):
            b = bank(TU_BASE + f * 12 + band * 4 + slot)
            for half in range(2):
                r = band * 8 + slot * 2 + half
                if r >= 22:
                    continue
                for c in range(32):
                    b.tiles[half * 32 + c] = enc_tile(img[r * 8:r * 8 + 8, c * 8:c * 8 + 8])
TU_BANKS = TU_FRAMES * 12

exr = np.full((30, 32), 0, dtype=np.int32)
for r in range(22):
    for c in range(32):
        exr[r, c] = ((r & 7) << 5) | c
exr_pal = np.zeros((15, 16), dtype=np.int32)
for ar in range(15):
    for ac in range(16):
        cx, cy = ac * 16 + 8 - 128, (ar * 16 + 8 - 88) * 1.08
        r = math.hypot(cx, cy)
        exr_pal[ar, ac] = 0

# --------------------------------------------------------------------------- sprites (banks 4-7: tiles $00-$FF at $1000)
spr = [bytes(16)] * 256
def streak(length, head=3):
    px = np.zeros((8, 8), dtype=np.int32)
    for i in range(length):
        x = 7 - i
        v = 3 if i < max(1, length // 4) else (2 if i < length // 2 + 1 else 1)
        px[3, x] = v
        if i < length // 3 and length >= 6:
            px[4, x] = 1 if i else 2
    return px
SPR_STREAK = 1
for i, ln in enumerate([2, 3, 4, 5, 6, 7, 8, 8]):
    spr[SPR_STREAK + i] = enc_tile(streak(ln))
# radial streaks: 0, 22.5, 45, 67.5, 90 degrees (pointing right / down-right ...), head at the far end
SPR_RAD = 16
for k in range(5):
    a = math.radians(k * 22.5)
    for ln_i, ln in enumerate([4, 7]):
        px = np.zeros((8, 8), dtype=np.int32)
        for s in np.linspace(0, ln, 24):
            x = 0.5 + s * math.cos(a)
            y = 0.5 + s * math.sin(a)
            xi, yi = int(x), int(y)
            if 0 <= xi < 8 and 0 <= yi < 8:
                v = 3 if s > ln * 0.7 else (2 if s > ln * 0.35 else 1)
                px[yi, xi] = max(px[yi, xi], v)
        spr[SPR_RAD + k * 2 + ln_i] = enc_tile(px)
SPR_DOT = 32
spr[SPR_DOT] = enc_tile([[0] * 8, [0] * 8, [0] * 8, [0, 0, 0, 3, 0, 0, 0, 0], [0] * 8, [0] * 8, [0] * 8, [0] * 8])
spr[SPR_DOT + 1] = enc_tile([[0] * 8, [0] * 8, [0, 0, 0, 1, 0, 0, 0, 0], [0, 0, 1, 3, 1, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0, 0], [0] * 8, [0] * 8, [0] * 8])
for i in range(256):
    bank(4 + i // 64).tiles[i % 64] = spr[i]

# --------------------------------------------------------------------------- write CHR / nametables
nbanks = max(banks) + 1
nbanks8 = (nbanks + 7) // 8 * 8
chr_data = b''.join((banks[i].data() if i in banks else bytes(1024)) for i in range(nbanks8))
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'chr.bin').write_bytes(chr_data)


def nt_bytes(nt, pal):
    b = bytearray(1024)
    for r in range(30):
        for c in range(32):
            b[r * 32 + c] = int(nt[r, c]) & 255
    for ar in range(8):
        for ac in range(8):
            v = 0
            for k, (dy, dx) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)]):
                y, x = ar * 2 + dy, ac * 2 + dx
                p = int(pal[y, x]) if y < 15 else 0
                v |= (p & 3) << (2 * k)
            b[960 + ar * 8 + ac] = v
    return bytes(b)


(OUT / 'nta.bin').write_bytes(nt_bytes(nta, nta_pal))
(OUT / 'ntb.bin').write_bytes(nt_bytes(ntb, ntb_pal))
(OUT / 'exr.bin').write_bytes(nt_bytes(exr, exr_pal))

# --------------------------------------------------------------------------- per-line tables
L = []
def table(name, vals):
    L.append(f'{name}:')
    for i in range(0, len(vals), 16):
        L.append('  .byte ' + ','.join(str(int(v) & 255) for v in vals[i:i + 16]))


def const(name, v):
    L.append(f'{name} = {v}')


for k, v in [('KS', KS), ('KE', KE), ('HORIZON', HORIZON), ('TW_BASE', TW_BASE), ('TW_ANGLES', TW_ANGLES),
             ('GR_BASE', GR_BASE), ('GR_BANKS', GR_BANKS), ('TU_BASE', TU_BASE), ('TU_FRAMES', TU_FRAMES),
             ('T_BLANK', T_BLANK), ('T_S1', T_S1), ('T_S2', T_S2), ('T_S3', T_S3),
             ('SPR_STREAK', SPR_STREAK), ('SPR_RAD', SPR_RAD), ('SPR_DOT', SPR_DOT),
             ('TITLE_Y', TITLE_ROW * 8), ('TW_Y', TW_ROW * 8), ('SUN_Y', SUN_ROW * 8), ('G_BLACK_Y', G_BLACK_Y),
             ('CHR_BANKS8', nbanks8 // 8)]:
    const(k, v)

# bars: level/parity -> source row within a band
table('bar_level_row', [LEVEL_ROW[l][p] for l in range(7) for p in range(2)])
# floor per screen line: source row (nametable B), slot-0 bank, z phase, mask (0 = no horizontal lines)
g_row, g_bank, g_z, g_mask, g_curve = [], [], [], [], []
for ln in range(256):
    d = ln - HORIZON
    if 1 <= d <= FLOOR_D:
        far = d < FLOOR_FOG_D
        g_row.append((0 if far else 16) + (8 if (d - 1) & 1 else 0))
        g_bank.append(GR_BASE + (d - 1) // 2)
        z = 90000.0 / d                                   # depth in phase units (256 = one grid cell)
        g_z.append(int(z) & 255)
        step = 90000.0 / d - 90000.0 / (d + 1)
        g_mask.append(0 if step > 90 else 255)
        g_curve.append(min(255, int(255 * ((FLOOR_D - d) / FLOOR_D) ** 2.2)))   # 255 = far
    else:
        g_row.append(G_BLACK_Y if ln >= KE else 0)
        g_bank.append(GR_BASE)
        g_z.append(0)
        g_mask.append(0)
        g_curve.append(255 if ln <= HORIZON else 0)
table('g_row_floor', g_row)
table('g_hi', [0 if ln <= HORIZON else 8 for ln in range(256)])
table('g_bank', g_bank)
table('g_z', g_z)
table('g_mask', g_mask)
table('g_curve', g_curve)
# line-phase lookups (doubled to 512 so (ptr),y can start anywhere in the first 256)
def linep(th, glow):
    v = []
    for p in range(256):
        if p < th:
            v.append(32)
        elif p < th + glow or p >= 256 - glow // 2:
            v.append(64)
        else:
            v.append(0)
    return v + v
L.append('.align 256')
table('g_linep', linep(40, 26))
CURVE_N = 16
const('CURVE_STRIDE', KE + 1 - KS)
const('CURVE_N', CURVE_N)
# twister bend: angle offset by phase (two sine periods over 256, +-10 of 32 units)
table('tw_bend', [round(10 * math.sin(2 * math.pi * 2 * i / 256)) & 255 for i in range(256)])
# brightness: lum_tab + (b + 4) * 64 = colour c shifted by b luma steps; black stays black for small
# steps (|b| < 3); $xD-$xF columns count as black
def lum(c, b):
    hue, l = c & 15, c >> 4
    if hue >= 13:
        if b < 3:
            return 0x0F
        hue, l = 0, -1
    l += b
    if l < 0:
        return 0x0F
    if l > 3:
        return 0x30
    return l << 4 | hue
L.append('.align 64')
table('lum_tab', [lum(c, b) for b in range(-4, 5) for c in range(64)])
# sines
table('sin_tab', [round(127 * math.sin(2 * math.pi * i / 256)) for i in range(256)])
# lo byte of the $2006 write for a source y: coarse y low bits
table('lo_of_y', [((i << 2) & 0xE0) for i in range(256)])
# bar profiles (levels, top to bottom) -> unrolled writers, one per parity of the top line
PROFILES = {
    'b': [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6, 6, 6, 6, 5, 4, 3, 2, 1],   # front: bright, trail above
    'd': [1, 2, 3, 3, 4, 4, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1],                          # back: dim, trail below
}
BL = ['; Generated by tools/assets.py: bar writers. In: t0 = band offset, y = top line, (ptr0) = y table.']
for name, lev in PROFILES.items():
    for par in (0, 1):
        BL.append(f'bp_{name}{par}:')
        for k, l in enumerate(lev):
            BL += [f'  lda #{LEVEL_ROW[l][(par + k) & 1]}', '  ora t0', '  sta (ptr0),y', '  iny']
        BL.append('  rts')
    const(f'BP_{name.upper()}_LEN', len(lev))
(OUT / 'bars.inc').write_text('\n'.join(BL) + '\n')
(OUT / 'assets.inc').write_text('; Generated by tools/assets.py. Do not edit.\n' + '\n'.join(L) + '\n')

# --------------------------------------------------------------------------- previews
PREV.mkdir(parents=True, exist_ok=True)
def show(img, pal, name, scale=2):
    rgb = nespal.RGB[np.array(pal)[img]].astype(np.uint8)
    Image.fromarray(rgb).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST).save(PREV / name)

tw = np.zeros((TW_ANGLES * 4, TW_W), dtype=np.int32)
for a in range(TW_ANGLES):
    lev = twister_slice(a * (math.pi / 2) / TW_ANGLES)
    for r in range(4):
        tw[a * 4 + r] = [lev_px(lev[x], x, r & 1) for x in range(TW_W)]
show(tw, [0x0F, 0x04, 0x24, 0x34], 'twister.png', 3)
show(tp, [0x0F, 0x06, 0x27, 0x38], 'title.png', 3)
show(sp, [0x0F, 0x16, 0x27, 0x38], 'sun.png', 3)
fl = np.array([floor_row(d) for d in range(1, FLOOR_D + 1)])
show(fl, [0x0F, 0x01, 0x14, 0x34], 'floor.png', 2)
show(tu_imgs[0], [0x0F, 0x24, 0x14, 0x04], 'tunnel0.png', 2)
print(f'CHR: {nbanks} KB used, {len(chr_data) // 1024} KB written; common tiles {len(common_list)}/192; '
      f'twister {TW_BASE}+{TW_ANGLES}, floor {GR_BASE}+{GR_BANKS}, tunnel {TU_BASE}+{TU_BANKS}')
