"""Precalc light fields for Caustic: seamless (periodic in x, y and time) 64x64 animations.

Every world is a function I(x, y, t) on a 64x64 torus, sampled at F frames whose last frame
wraps back to the first. Three worlds:
  caustic(...)   sunlight refracted by a moving water surface onto a pool floor: rays are bent by
                 the gradient of a sum of travelling waves (integer wave vectors, integer temporal
                 harmonics, so it tiles in space and loops in time) and splatted onto the floor.
  interfere(...) plane waves from several directions summed and squared: a slowly breathing
                 interference lattice / moire.
  rings(...)     ring waves from a few sources on the torus (summed over images): concentric
                 ripples crossing each other.
"""
import numpy as np

N = 64


def _waves(seed, n, kmin, kmax, tmax, amp_pow=1.0):
    rng = np.random.default_rng(seed)
    out = []
    while len(out) < n:
        kx, ky = rng.integers(-kmax, kmax + 1, 2)
        k = np.hypot(kx, ky)
        if not (kmin <= k <= kmax):
            continue
        nt = int(rng.integers(1, tmax + 1)) * (1 if rng.random() < 0.5 else -1)
        out.append((kx, ky, nt, rng.random() * 2 * np.pi, k ** -amp_pow))
    return out


def caustic(frames=128, seed=3, waves=7, strength=5.0, sup=6, blur=0.55, kmin=1.6, kmax=3.6, tmax=2):
    """Returns (frames, 64, 64) float intensity, mean ~1."""
    W = _waves(seed, waves, kmin, kmax, tmax)
    R = N * sup
    g = (np.arange(R) + 0.5) / sup
    X, Y = np.meshgrid(g, g)
    out = np.zeros((frames, N, N))
    S = 4                                   # accumulate at 4x, then blur and box down
    fx = np.fft.fftfreq(N * S)
    FX, FY = np.meshgrid(fx, fx)
    gk = np.exp(-2 * (np.pi * blur * S) ** 2 * (FX ** 2 + FY ** 2))
    for f in range(frames):
        t = 2 * np.pi * f / frames
        gx = np.zeros_like(X)
        gy = np.zeros_like(X)
        for kx, ky, nt, ph, a in W:
            arg = 2 * np.pi * (kx * X + ky * Y) / N + nt * t + ph
            s = -np.sin(arg) * a * 2 * np.pi / N
            gx += s * kx
            gy += s * ky
        px = (X + strength * N / (2 * np.pi) * gx) % N
        py = (Y + strength * N / (2 * np.pi) * gy) % N
        ix = (px * S).astype(np.int64) % (N * S)
        iy = (py * S).astype(np.int64) % (N * S)
        acc = np.bincount((iy * N * S + ix).ravel(), minlength=(N * S) ** 2).reshape(N * S, N * S).astype(np.float64)
        acc = np.real(np.fft.ifft2(np.fft.fft2(acc) * gk))
        img = acc.reshape(N, S, N, S).mean(axis=(1, 3))
        out[f] = img / img.mean()
    return out


def interfere(frames=128, dirs=((5, 1), (-1, 5), (-4, -3), (3, -4), (1, 3)), tharm=(1, -1, 2, -1, 1), seed=7):
    rng = np.random.default_rng(seed)
    g = np.arange(N) + 0.5
    X, Y = np.meshgrid(g, g)
    ph = rng.random(len(dirs)) * 2 * np.pi
    out = np.zeros((frames, N, N))
    for f in range(frames):
        t = 2 * np.pi * f / frames
        s = np.zeros_like(X)
        for (kx, ky), nt, p in zip(dirs, tharm, ph):
            s += np.cos(2 * np.pi * (kx * X + ky * Y) / N + nt * t + p)
        s /= len(dirs)
        v = (0.5 + 0.5 * np.cos(np.pi * 2.2 * s)) ** 2.2
        out[f] = v / v.mean()
    return out


def rings(frames=128, sources=((16, 20, 0.0), (46, 40, 0.37), (30, 54, 0.71)), wl=9.0, cycles=4, sup=2):
    """Concentric ripples from sources on the torus. Each source rings with its own phase; the
    wave number is chosen so that `cycles` wavelengths pass per loop."""
    g = (np.arange(N * sup) + 0.5) / sup
    X, Y = np.meshgrid(g, g)
    out = np.zeros((frames, N, N))
    for f in range(frames):
        t = f / frames
        s = np.zeros_like(X)
        for sx, sy, p in sources:
            for ox in (-N, 0, N):
                for oy in (-N, 0, N):
                    r = np.hypot(X - sx - ox, Y - sy - oy)
                    env = np.exp(-(r / 30.0) ** 2) * np.clip(r / 3.0, 0, 1)
                    s += env * np.cos(2 * np.pi * (r / wl - cycles * t - p))
        v = np.clip(0.5 + 0.42 * s, 0, 1) ** 2.0
        v = v.reshape(N, sup, N, sup).mean(axis=(1, 3))
        out[f] = v / v.mean()
    return out


def rain(frames=128, sources=((18, 20, 0.0), (50, 52, 0.5), (46, 14, 0.27), (12, 46, 0.77)), wl=7.0, reach=46.0, sup=2):
    """Raindrops: each source launches one ring packet per loop (at its own moment), which
    expands, fades and wraps around the torus, crossing its neighbours' rings."""
    g = (np.arange(N * sup) + 0.5) / sup
    X, Y = np.meshgrid(g, g)
    out = np.zeros((frames, N, N))
    for f in range(frames):
        s = np.zeros_like(X)
        for sx, sy, p in sources:
            age = (f / frames - p) % 1.0
            R = reach * age
            amp = (1 - age) ** 0.8 * min(1.0, age * 10)
            for ox in (-N, 0, N):
                for oy in (-N, 0, N):
                    r = np.hypot(X - sx - ox, Y - sy - oy)
                    d = r - R
                    pk = np.exp(-(d / (wl * 0.9)) ** 2) * np.cos(2 * np.pi * d / wl)
                    s += amp * pk / np.sqrt(1 + r / 8)
        v = 0.04 + np.clip(s, 0, 2) ** 1.3
        v = v.reshape(N, sup, N, sup).mean(axis=(1, 3))
        out[f] = v / v.mean()
    return out
