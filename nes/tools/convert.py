"""Image -> NES conversion: ordered "pattern" dithering inside each 8x8 tile's 4 colours,
per-tile palette choice (MMC5 extended attributes), palette search, tile dedup and CHR packing."""
import itertools
import numpy as np
import nespal

BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 + 1 / 32
BAYER8 = np.zeros((8, 8))
for _y in range(8):
    for _x in range(8):
        v, xc, yc = 0, _x ^ _y, _y
        for bit in range(3):
            v |= ((xc >> bit) & 1) << (5 - 2 * bit)
            v |= ((yc >> bit) & 1) << (4 - 2 * bit)
        BAYER8[_y, _x] = v
BAYER8 = BAYER8 / 64.0 + 1 / 128

LIN = nespal.srgb_to_lin(nespal.RGB)
LAB = nespal.lab(nespal.RGB)


def lab_of_lin(lin):
    return nespal.lab(nespal.lin_to_srgb(lin))


class Ditherer:
    """Chooses, per pixel, the best solid colour or two-colour ordered-dither mix from a 4-colour set.
    Mixing happens in linear light (what a blurry CRT does); errors are measured in Lab, with a
    penalty for dithering between very different colours (so flat areas stay calm)."""

    def __init__(self, penalty=0.12, bayer=BAYER4, levels=None):
        self.penalty = penalty
        self.bayer = bayer
        self.levels = levels or bayer.size

    def options(self, cols):
        """cols: 4 NES indices -> list of (i, j, t) options: solid colours and quantised mixes."""
        opts = []
        for i in range(4):
            opts.append((i, i, 0.0))
        for i, j in itertools.combinations(range(4), 2):
            if cols[i] == cols[j]:
                continue
            for k in range(1, self.levels):
                opts.append((i, j, k / self.levels))
        return opts

    def table(self, cols):
        opts = self.options(cols)
        lin = LIN[cols]
        mixes = np.array([(1 - t) * lin[i] + t * lin[j] for i, j, t in opts])
        mlab = lab_of_lin(mixes)
        pen = np.array([self.penalty * np.linalg.norm(LAB[cols[i]] - LAB[cols[j]]) * (min(t, 1 - t) ** 0.5) for i, j, t in opts])
        return opts, mlab, pen

    def tile_error_and_pixels(self, tlab, cols, ys, xs, cache={}):
        """tlab: (N, 3) target Lab for N pixels at positions ys, xs. Returns (error, idx(N,))."""
        key = (tuple(cols), self.penalty, self.levels, self.bayer.shape)
        if key not in cache:
            cache[key] = self.table(cols)
        opts, mlab, pen = cache[key]
        d = np.linalg.norm(tlab[:, None, :] - mlab[None, :, :], axis=2) + pen[None, :]
        best = d.argmin(1)
        err = d[np.arange(len(best)), best].sum()
        b = self.bayer[ys % self.bayer.shape[0], xs % self.bayer.shape[1]]
        oi = np.array([o[0] for o in opts])[best]
        oj = np.array([o[1] for o in opts])[best]
        ot = np.array([o[2] for o in opts])[best]
        idx = np.where(b < ot, oj, oi)
        return err, idx


def tiles_of(img):
    """img (H, W, 3) -> list of (ty, tx, (64,3) Lab)."""
    H, W = img.shape[:2]
    L = nespal.lab(img)
    out = []
    for ty in range(H // 8):
        for tx in range(W // 8):
            out.append((ty, tx, L[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8].reshape(64, 3)))
    return out


def quantize(img, palettes, backdrop, dith=None, mask_pal=None, force=None):
    """img: float sRGB (H, W, 3), H and W multiples of 8. palettes: 4 lists of 3 NES indices.
    Returns (pix (H, W) colour numbers 0-3, pal (H/8, W/8)). force: optional (H/8, W/8) array of
    palette numbers (-1 = free)."""
    dith = dith or Ditherer()
    H, W = img.shape[:2]
    pix = np.zeros((H, W), np.uint8)
    pal = np.zeros((H // 8, W // 8), np.uint8)
    yy, xx = np.mgrid[0:8, 0:8]
    for ty, tx, tl in tiles_of(img):
        ys = (yy + ty * 8).ravel()
        xs = (xx + tx * 8).ravel()
        cands = range(len(palettes))
        if force is not None and force[ty, tx] >= 0:
            cands = [force[ty, tx]]
        best = None
        for p in cands:
            cols = [backdrop] + list(palettes[p])
            e, idx = dith.tile_error_and_pixels(tl, cols, ys, xs)
            if best is None or e < best[0]:
                best = (e, p, idx)
        pal[ty, tx] = best[1]
        pix[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = best[2].reshape(8, 8)
    return pix, pal


def render(pix, pal, palettes, backdrop):
    """Back to RGB for previews."""
    H, W = pix.shape
    out = np.zeros((H, W, 3), np.uint8)
    for ty in range(H // 8):
        for tx in range(W // 8):
            cols = [backdrop] + list(palettes[pal[ty, tx]])
            t = pix[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]
            out[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = nespal.RGB[np.array(cols)[t]]
    return out


def nearest_nes(img_lab, usable=None):
    usable = np.array(usable or nespal.USABLE)
    d = np.linalg.norm(img_lab[..., None, :] - LAB[usable], axis=-1)
    return usable[d.argmin(-1)]


def search_palettes(img, backdrop, n=4, fixed=None, iters=4, candidates=None, sample=6, seed=1):
    """Pick n palettes of 3 colours for img with a k-means-like search over tiles.
    fixed: optional dict {palette number: [c1,c2,c3]} kept as is."""
    rng = np.random.default_rng(seed)
    tiles = tiles_of(img)
    fixed = fixed or {}
    dith = Ditherer(levels=4, bayer=BAYER4[::2, ::2] if False else BAYER4)
    # Candidate colours: the most common nearest-NES colours of the image.
    near = nearest_nes(nespal.lab(img), candidates)
    vals, cnt = np.unique(near, return_counts=True)
    order = vals[np.argsort(-cnt)]
    cand = [int(c) for c in order if c != backdrop][:18]
    # Sub-sample pixels per tile to keep this fast.
    sub = [(ty, tx, tl[::sample]) for ty, tx, tl in tiles]
    ys = (np.arange(64) // 8)[::sample]
    xs = (np.arange(64) % 8)[::sample]
    # Initial palettes: cluster tiles by mean colour.
    means = np.array([tl.mean(0) for _, _, tl in tiles])
    cent = means[rng.choice(len(means), n, replace=False)]
    for _ in range(10):
        a = np.linalg.norm(means[:, None] - cent[None], axis=2).argmin(1)
        for k in range(n):
            if (a == k).any():
                cent[k] = means[a == k].mean(0)
    pals = []
    for k in range(n):
        if k in fixed:
            pals.append(list(fixed[k]))
            continue
        grp = [i for i in range(len(tiles)) if a[i] == k] or list(range(len(tiles)))
        pals.append(_best_triple([sub[i][2] for i in grp], cand, backdrop, ys, xs, dith, rng))
    for it in range(iters):
        errs = np.zeros((len(sub), n))
        for p in range(n):
            cols = [backdrop] + pals[p]
            for i, (_, _, tl) in enumerate(sub):
                errs[i, p] = dith.tile_error_and_pixels(tl, cols, ys, xs)[0]
        a = errs.argmin(1)
        total = errs.min(1).sum()
        new = []
        for k in range(n):
            if k in fixed:
                new.append(pals[k])
                continue
            grp = [i for i in range(len(sub)) if a[i] == k]
            if not grp:
                # Re-seed an empty palette from the worst tiles.
                worst = np.argsort(-errs.min(1))[:max(8, len(sub) // 20)]
                grp = list(worst)
            new.append(_best_triple([sub[i][2] for i in grp], cand, backdrop, ys, xs, dith, rng, start=pals[k]))
        pals = new
    return pals


def _best_triple(tls, cand, backdrop, ys, xs, dith, rng, start=None):
    if len(tls) > 120:
        tls = [tls[i] for i in rng.choice(len(tls), 120, replace=False)]
    allt = np.concatenate(tls)
    yy = np.tile(ys, len(tls))
    xx = np.tile(xs, len(tls))

    def err(tri):
        return dith.tile_error_and_pixels(allt, [backdrop] + list(tri), yy, xx)[0]
    # Greedy coordinate descent over the three slots.
    cur = list(start) if start else list(cand[:3])
    best = err(cur)
    improved = True
    while improved:
        improved = False
        for slot in range(3):
            for c in cand:
                if c in cur:
                    continue
                tri = cur.copy()
                tri[slot] = c
                e = err(tri)
                if e < best - 1e-6:
                    best, cur, improved = e, tri, True
    return sorted(cur, key=lambda c: LAB[c][0])


# ---------------------------------------------------------------- CHR packing

def tile_bytes(t):
    """t: (8, 8) colour numbers 0-3 -> 16 bytes of NES planar CHR."""
    lo = [int(sum(((t[y, x] & 1) << (7 - x)) for x in range(8))) for y in range(8)]
    hi = [int(sum(((t[y, x] >> 1) << (7 - x)) for x in range(8))) for y in range(8)]
    return bytes(lo + hi)


class ChrPool:
    """4 KB banks of 256 tiles. Images claim banks; tiles dedup within a group of banks."""

    def __init__(self, nbanks=64):
        self.banks = [[] for _ in range(nbanks)]  # each: list of 16-byte tiles
        self.index = [dict() for _ in range(nbanks)]
        self.next = 0

    def alloc(self, n=1):
        b = self.next
        self.next += n
        assert self.next <= len(self.banks), 'CHR full'
        return list(range(b, b + n))

    def add(self, banks, tb):
        """Add 16-byte tile to one of 'banks' (dedup across them). Returns (bank, idx)."""
        for b in banks:
            if tb in self.index[b]:
                return b, self.index[b][tb]
        for b in banks:
            if len(self.banks[b]) < 256:
                self.index[b][tb] = len(self.banks[b])
                self.banks[b].append(tb)
                return b, len(self.banks[b]) - 1
        raise RuntimeError('banks full')

    def put(self, bank, idx, tb):
        """Place a tile at a fixed slot (for tables like the chunky set)."""
        while len(self.banks[bank]) <= idx:
            self.banks[bank].append(bytes(16))
        self.banks[bank][idx] = tb
        self.index[bank].setdefault(tb, idx)

    def used(self):
        return self.next

    def blob(self, nbanks=None):
        nb = nbanks or len(self.banks)
        out = bytearray()
        for b in range(nb):
            data = b''.join(self.banks[b])
            out += data + bytes(4096 - len(data))
        return bytes(out)


def bitmap_to_chr(pix, pal, pool, banks=None, nbanks=None):
    """ExRAM bitmap: returns (nt bytes (rows*32), ex bytes (rows*32)) and claims banks as needed."""
    H, W = pix.shape
    rows = H // 8
    tbs = []
    for ty in range(rows):
        for tx in range(W // 8):
            tbs.append(tile_bytes(pix[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8]))
    uniq = len(set(tbs))
    if banks is None:
        banks = pool.alloc(nbanks or (uniq + 255) // 256)
    nt = bytearray()
    ex = bytearray()
    for i, tb in enumerate(tbs):
        b, idx = pool.add(banks, tb)
        ty, tx = divmod(i, W // 8)
        nt.append(idx)
        ex.append((b & 63) | (int(pal[ty, tx]) << 6))
    return bytes(nt), bytes(ex), banks
