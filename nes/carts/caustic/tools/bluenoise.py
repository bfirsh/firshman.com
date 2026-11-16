"""Void-and-cluster blue noise threshold map on a torus (tiles seamlessly)."""
import numpy as np


def blue_noise(n=64, sigma=1.5, seed=1):
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    FX, FY = np.meshgrid(f, f)
    G = np.exp(-2 * (np.pi * sigma) ** 2 * (FX ** 2 + FY ** 2))
    # gaussian kernel on the torus (spatial), for incremental energy updates
    d = np.minimum(np.arange(n), n - np.arange(n))
    DX, DY = np.meshgrid(d, d)
    K = np.exp(-(DX ** 2 + DY ** 2) / (2 * sigma ** 2))

    def energy(m):
        return np.real(np.fft.ifft2(np.fft.fft2(m) * np.fft.fft2(K)))

    # initial binary pattern: ~10% ones, relaxed
    m = (rng.random((n, n)) < 0.1).astype(float)
    while True:
        e = energy(m)
        tc = np.unravel_index(np.argmax(np.where(m > 0, e, -1e9)), m.shape)
        m[tc] = 0
        e = energy(m)
        lv = np.unravel_index(np.argmin(np.where(m == 0, e, 1e9)), m.shape)
        if lv == tc:
            m[tc] = 1
            break
        m[lv] = 1
    ones = int(m.sum())
    rank = np.zeros((n, n), int)
    # phase 1: remove ones (tightest cluster first) ranking down
    m1 = m.copy()
    e = energy(m1)
    for r in range(ones - 1, -1, -1):
        tc = np.unravel_index(np.argmax(np.where(m1 > 0, e, -1e9)), m1.shape)
        m1[tc] = 0
        e -= np.roll(np.roll(K, tc[0], 0), tc[1], 1)
        rank[tc] = r
    # phase 2: add zeros (largest void first) ranking up
    m2 = m.copy()
    e = energy(m2)
    for r in range(ones, n * n):
        lv = np.unravel_index(np.argmin(np.where(m2 == 0, e, 1e9)), m2.shape)
        m2[lv] = 1
        e += np.roll(np.roll(K, lv[0], 0), lv[1], 1)
        rank[lv] = r
    return (rank + 0.5) / (n * n)


if __name__ == '__main__':
    import time
    t = time.time()
    b = blue_noise()
    print(time.time() - t, b.min(), b.max())
