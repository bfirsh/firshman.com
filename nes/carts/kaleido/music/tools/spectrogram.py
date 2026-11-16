#!/usr/bin/env python3
"""Spectrogram and level plot of a rendered WAV, with the song's sections marked.

usage: spectrogram.py in.wav out.png [--from SEC] [--to SEC] [--fpp FRAMES_PER_PATTERN] [--fmax HZ]
Needs numpy and matplotlib (analysis only; not needed to build the music).
"""
import sys
import wave

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt


def load(path):
    with wave.open(path) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, sr


def main():
    a = sys.argv[1:]
    opt = lambda k, d: float(a[a.index('--' + k) + 1]) if '--' + k in a else d
    x, sr = load(a[0])
    t0, t1 = opt('from', 0), opt('to', len(x) / sr)
    fpp, fmax, offset = opt('fpp', 448), opt('fmax', 5000), opt('offset', 3)
    seg = x[int(t0 * sr):int(t1 * sr)]
    n = 4096 if t1 - t0 > 20 else 2048
    hop = n // 4
    win = np.hanning(n)
    frames = np.lib.stride_tricks.sliding_window_view(seg, n)[::hop] * win
    S = 20 * np.log10(np.abs(np.fft.rfft(frames, axis=1)) + 1e-7)
    f = np.fft.rfftfreq(n, 1 / sr)
    keep = f <= fmax
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(18, 9), sharex=True, gridspec_kw={'height_ratios': [4, 1]})
    ax.imshow(S[:, keep].T, origin='lower', aspect='auto', cmap='magma', vmin=S.max() - 90, vmax=S.max(),
              extent=[t0, t0 + len(frames) * hop / sr, 0, fmax])
    ax.set_yscale('symlog', linthresh=200)
    ax.set_ylim(30, fmax)
    ax.set_ylabel('Hz')
    # levels: RMS and peak per 1/30 s
    blk = sr // 30
    m = len(seg) // blk
    rms = np.sqrt((seg[:m * blk].reshape(m, blk) ** 2).mean(1))
    pk = np.abs(seg[:m * blk].reshape(m, blk)).max(1)
    tt = t0 + np.arange(m) / 30
    ax2.plot(tt, 20 * np.log10(rms + 1e-6), lw=0.7, label='RMS dBFS')
    ax2.plot(tt, 20 * np.log10(pk + 1e-6), lw=0.5, alpha=0.6, label='peak dBFS')
    ax2.set_ylim(-60, 0)
    ax2.legend(loc='lower right')
    ax2.set_xlabel('s')
    # section lines (the harness starts the music a few frames in)
    p = 0
    while True:
        ts = (offset + p * fpp) / 60.0988
        if ts > t1:
            break
        if ts >= t0:
            for axx in (ax, ax2):
                axx.axvline(ts, color='cyan', lw=0.6, alpha=0.7)
            ax.text(ts + 0.1, fmax * 0.8, str(p), color='cyan', fontsize=8)
        p += 1
    fig.tight_layout()
    fig.savefig(a[1], dpi=80)


if __name__ == '__main__':
    main()
