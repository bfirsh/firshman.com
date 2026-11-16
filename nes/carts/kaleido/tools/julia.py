"""The endless zoom: the Julia set of c at the centre of the Mandelbrot set's 1/4 bulb, seen at its
alpha fixed point, where four arms meet. Near that point the set is self-similar under
multiplication by lambda^4 (lambda = 2*alpha, the point's multiplier): lambda^4 is almost exactly
real (1.269), so zooming in by that factor gives back the same picture, every escape time
increased by 4. So F frames make a seamless loop of an infinite zoom; the escape-time bands
shift by 4*K per loop, which the palette rotation absorbs.

Colouring: bands of K per iteration (smooth escape time), 8 band colours. Each tile picks one of
four palettes = windows of three consecutive bands starting at 0, 2, 4, 6, so any tile whose
pixels cover two neighbouring bands is exact; the black interior is the backdrop colour."""
import cmath
import numpy as np

C = complex(0.2822713907669139, 0.5300606175785253)
Q = 4
K = 0.75             # bands per iteration: 4 * K = 3 bands per loop
F = 12               # frames per loop
R = 0.30             # half-width of the view (complex units) at frame 0
ALPHA = (1 - cmath.sqrt(1 - 4 * C)) / 2
LAM = (2 * ALPHA) ** Q


def escape(center, half, rot=0.0, W=256, H=240, maxit=900, ss=1):
    ys, xs = np.mgrid[0:H, 0:W]
    z = ((xs - W / 2 + 0.5) + 1j * (ys - H / 2 + 0.5)) * (half / (W / 2)) * cmath.exp(1j * rot) + center
    nu = np.full(z.shape, -1.0)
    alive = np.ones(z.shape, bool)
    zz = z.copy()
    for i in range(maxit):
        zz[alive] = zz[alive] ** 2 + C
        esc = alive & (np.abs(zz) > 1e3)
        nu[esc] = i + 1 - np.log2(np.log(np.abs(zz[esc])))
        alive &= ~esc
        if not alive.any():
            break
    return nu


def quant_bands(nu, k=K, phase=0.0):
    """-> (img 0..3, window index per tile 0..3). Window w covers bands 2w..2w+2 (mod 8)."""
    b = np.floor(nu * k + phase).astype(np.int64)
    inter = nu < 0
    H, W = nu.shape
    img = np.zeros((H, W), np.uint8)
    win = np.zeros((H // 8, W // 8), np.uint8)
    for ty in range(H // 8):
        for tx in range(W // 8):
            bb = b[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]
            ii = inter[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]
            vals = bb[~ii]
            s = 0
            if vals.size:
                best = None
                for s0 in range(0, 8, 2):
                    rel = (vals - s0) % 8
                    cov = (rel <= 2).sum() * 4 + (rel == 1).sum()   # prefer centring the window
                    if best is None or cov > best[0]:
                        best = (cov, s0)
                s = best[1]
            rel = (bb - s) % 8
            rel = np.where(rel <= 2, rel, np.where(rel >= 5, 0, 2))     # out-of-window: nearest edge
            img[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = np.where(ii, 0, rel + 1)
            win[ty, tx] = s // 2
    return img, win


def frames():
    out = []
    for f in range(F):
        sc = LAM ** (-f / F)
        nu = escape(ALPHA, R * abs(sc), rot=cmath.phase(sc))
        out.append(quant_bands(nu))
    return out


def pack(frames_, nidx=192, idx0=64, maxbanks=32):
    """Give every screen position a tile index (idx0..idx0+nidx-1) and every (position, frame) a
    bank, so that each index's tiles fit in the banks. Returns (nt, ex[f], slots{(bank,idx):tile})."""
    from nes import tiles_of
    P = 960
    per = [[t.tobytes() for t in tiles_of(img)] for img, win in frames_]
    S = [set(per[f][p] for f in range(len(per))) for p in range(P)]
    idx = [set() for _ in range(nidx)]
    nt = [0] * P
    for p in sorted(range(P), key=lambda p: -len(S[p])):
        best = min(range(nidx), key=lambda i: (len(idx[i] | S[p]), -len(idx[i] & S[p])))
        idx[best] |= S[p]
        nt[p] = best
    loads = [len(x) for x in idx]
    if max(loads) > maxbanks:
        raise SystemExit(f'julia: index load {max(loads)} > {maxbanks} banks')
    bank_of = [dict((t, b) for b, t in enumerate(sorted(x))) for x in idx]
    ex = []
    for f, (img, win) in enumerate(frames_):
        e = np.zeros(P, np.uint8)
        for p in range(P):
            e[p] = bank_of[nt[p]][per[f][p]] | (int(win.flat[p]) << 6)
        ex.append(e)
    slots = {}
    for i, x in enumerate(idx):
        for t, b in bank_of[i].items():
            slots[(b, idx0 + i)] = np.frombuffer(t, np.uint8).reshape(8, 8)
    return np.array(nt) + idx0, ex, slots, max(loads)
