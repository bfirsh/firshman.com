#!/usr/bin/env python3
"""Verify the rendered music against the score.

usage: verify.py [--out DIR] [--loops N]
Builds the expected timeline from song.txt (compile.py --json), renders the test ROM in JSNES
(render.mjs: APU log, full mix and one WAV per channel, N passes of the song) and checks:
  timing      row / pattern / loop flags fall exactly on the tempo grid
  events      music_events kick/snare/hat/lead/bass bits match the score, frame for frame
  registers   every pitched note's APU period is the intended note (equal temperament, A=440)
  audio pitch f0 of each lead / bass / harmony note measured from that channel's solo audio
  envelopes   the lead's per-frame volume follows its instrument envelope
  stuck notes every key-off reaches silence; nothing sounds where the score is silent
  loop        the second pass repeats the first (APU state and audio) and the seam is click-free
  levels      peak, RMS and clipping of the mix
  cycles      worst-case music_play cost
Needs numpy. Exit status is non-zero if a check fails.
"""
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MUSIC = HERE.parent
ROOT = MUSIC.parent.parent
CPU = 1789772.5
FPS = CPU / 29780.5
SR = 48000
SPF = SR / FPS
EV = {'kick': 4, 'snare': 8, 'hat': 16, 'lead': 32, 'bass': 64}
EV2 = {'chop': 1, 'horn': 2, 'pop': 4, 'rim': 8, 'clap': 16, 'ghost': 32, 'crash': 64, 'open': 128}
FIELDS = ['cycles', 'frame', 'order', 'row', 'events', 'events2', 'sq1_period', 'sq1_vol', 'sq1_duty', 'sq2_period', 'sq2_vol',
          'sq2_duty', 'tri_period', 'tri_on', 'noise_period', 'noise_vol', 'noise_short', 'dmc_on', 'dmc_level']
F = {k: i for i, k in enumerate(FIELDS)}

failures = []


def check(ok, msg):
    print(('  ok    ' if ok else '  FAIL  ') + msg)
    if not ok:
        failures.append(msg)


def load_wav(p):
    with wave.open(str(p)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768


def midi_of(freq):
    return 69 + 12 * math.log2(freq / 440)


def f0_estimate(x, lo, hi):
    """Harmonic-sum f0 estimate within [lo, hi] Hz."""
    n = 1 << int(math.ceil(math.log2(len(x) * 8)))
    X = np.abs(np.fft.rfft((x - x.mean()) * np.hanning(len(x)), n))
    df = SR / n
    best, bf = -1, None
    for f in np.exp(np.linspace(math.log(lo), math.log(hi), 600)):
        s = 0
        for h in range(1, 6):
            k = int(round(f * h / df))
            if k + 1 < len(X):
                s += X[k - 1:k + 2].max() / h
        if s > best:
            best, bf = s, f
    k = int(round(bf / df))
    a, b, c = X[k - 1], X[k], X[k + 1]
    p = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
    return (k + p) * df


def main():
    args = sys.argv[1:]
    out = Path(args[args.index('--out') + 1]) if '--out' in args else Path('/tmp/nes-music-verify')
    loops = int(args[args.index('--loops') + 1]) if '--loops' in args else 2
    out.mkdir(parents=True, exist_ok=True)
    rom = MUSIC / 'test' / 'music_test.nes'
    subprocess.run([sys.executable, str(HERE / 'compile.py'), str(MUSIC / 'song.txt'), '-o', str(out / 'song.inc'),
                    '--json', str(out / 'expected.json')], check=True, stdout=subprocess.DEVNULL)
    exp = json.loads((out / 'expected.json').read_text())
    song = next(iter(exp.values()))
    fpp = song['frames_per_pattern']
    se, so = song['speed']
    rows = song['rows']
    row_start = [(r // 2) * (se + so) + (r % 2) * se for r in range(rows + 1)]   # swing: even/odd row lengths
    frame_row = []
    for r in range(rows):
        frame_row += [r] * (row_start[r + 1] - row_start[r])
    norders = len(song['orders'])
    songlen = fpp * norders
    frames = songlen * loops + 200
    jobs = [['--log', str(out / 'log.json'), '--wav', str(out / 'full.wav')]]
    for c in ['sq1', 'sq2', 'tri', 'noise', 'dmc']:
        jobs.append(['--wav', str(out / f'solo_{c}.wav'), '--solo', c])
    if '--reuse' in args:   # analyse the previous render again
        jobs = []
    procs = [subprocess.Popen(['node', str(HERE / 'render.mjs'), str(rom), '--frames', str(frames)] + j,
                              cwd=ROOT, stdout=subprocess.PIPE, text=True) for j in jobs]
    cyc_line = ([p.communicate()[0].strip() for p in procs] or ['(reused render)'])[0]
    log = json.loads((out / 'log.json').read_text())['frames']
    start = next(i for i, r in enumerate(log) if r[F['cycles']] is not None)   # emulation frame of tick 0
    L = log[start:]
    tick = lambda t: L[t]
    print(f'song: {norders} patterns x {fpp} frames = {songlen} frames ({songlen / FPS:.1f} s); music starts at emulation frame {start}')

    # ------------------------------------------------------------------ timing
    print('timing')
    bad = []
    for t in range(songlen * loops):
        r = L[t]
        st = t % songlen
        want = (1 if (st % fpp) in row_start else 0) | (2 if st % fpp == 0 else 0) | (0x80 if st == 0 and t > 0 else 0)
        if (r[F['events']] & 0x83) != want or r[F['frame']] != t or r[F['order']] != st // fpp or r[F['row']] != frame_row[st % fpp]:
            bad.append(t)
    check(not bad, f'row/pattern/loop flags and music_frame/order/row exact on every tick ({len(bad)} bad, first {bad[:3]})')

    # ------------------------------------------------------------------ expected events
    sched = {c: [] for c in ['p1', 'p2', 'tri', 'noise', 'dmc']}   # (tick, kind, payload) per channel
    fxinfo = {}
    for o, od in enumerate(song['orders']):
        for ch, evs in od['channels'].items():
            for e in evs:
                t = o * fpp + row_start[e[0]]
                if len(e) == 1:
                    continue
                if e[1] == 'note':
                    sched[ch].append((t, 'note', e[2] + od['transpose'], e[3]))
                    fxinfo[(ch, t)] = e[4]
                elif e[1] == 'off':
                    sched[ch].append((t, 'off', None, None))
                else:
                    sched[ch].append((t, e[1], e[2], None))
        for ch in sched:
            if not od['channels'][ch] and ch in ('tri', 'noise', 'dmc', 'p1'):
                sched[ch].append((o * fpp, 'off', None, None))
    for ch in sched:
        sched[ch].sort(key=lambda e: e[0])

    print('events')
    want = np.zeros(songlen, dtype=int)
    for t, k, a, inst in sched['p1']:
        if k == 'note':
            want[t] |= song['inst_events'][inst] & EV['lead']
    for t, k, a, inst in sched['tri']:
        if k == 'note':
            want[t] |= song['inst_events'][inst] & (EV['bass'] | EV['kick'])
    for t, k, a, _ in sched['noise']:
        if k == 'drum':
            want[t] |= song['inst_events'][song['drums'][a][0]]
    for t, k, a, _ in sched['dmc']:
        if k == 'sample':
            want[t] |= song['sample_events'][a]
    for t, k, a, inst in sched['p2']:
        if k == 'note':
            want[t] |= song['inst_events'][inst] & 0x7C
    for name, bit in EV.items():
        got = np.array([L[t][F['events']] & bit for t in range(songlen)])
        w = want & bit
        mism = np.nonzero(got != w)[0]
        check(len(mism) == 0, f'{name:5s} bit: {int((w > 0).sum())} expected, {int((got > 0).sum())} set, {len(mism)} mismatched frames')

    want2 = np.zeros(songlen, dtype=int)
    for ch in ('p1', 'p2', 'tri'):
        for t, k, a, inst in sched[ch]:
            if k == 'note':
                want2[t] |= song['inst_events2'][inst]
    for t, k, a, _ in sched['noise']:
        if k == 'drum':
            want2[t] |= song['inst_events2'][song['drums'][a][0]]
    for t, k, a, _ in sched['dmc']:
        if k == 'sample':
            want2[t] |= song['sample_events2'][a]
    for name, bit in EV2.items():
        got = np.array([L[t][F['events2']] & bit for t in range(songlen)])
        w = want2 & bit
        mism = np.nonzero(got != w)[0]
        check(len(mism) == 0, f'{name:5s} bit (events2): {int((w > 0).sum())} expected, {int((got > 0).sum())} set, {len(mism)} mismatched')

    # slap overlay: pulse 2 sounds the triangle's period for the first frames of every slap note
    slaps, slap_ok = 0, 0
    for t, k, a, inst in sched['tri']:
        if k == 'note' and song['inst_slap'][inst]:
            slaps += 1
            slap_ok += all(L[f][F['sq2_period']] == L[f][F['tri_period']] and L[f][F['sq2_vol']] > 0 for f in range(t, t + 3))
    check(slaps > 0 and slap_ok == slaps, f'slap overlay: pulse 2 doubles the triangle on {slap_ok}/{slaps} slap notes')

    # ------------------------------------------------------------------ register pitch
    print('registers (APU period vs intended note)')
    def note_spans(ch):
        ev = sched[ch]
        for i, (t, k, midi, inst) in enumerate(ev):
            if k != 'note':
                continue
            end = ev[i + 1][0] if i + 1 < len(ev) else songlen
            yield t, end, midi, inst
    for ch, pk, vk in (('p1', 'sq1_period', 'sq1_vol'), ('p2', 'sq2_period', 'sq2_vol'), ('tri', 'tri_period', 'tri_on')):
        worst, nnotes, missing, offgrid, bent = 0, 0, 0, 0, 0
        for t, end, midi, inst in note_spans(ch):
            skip = 7 if song['inst_has_arp'][inst] else 1
            fx = fxinfo[(ch, t)]
            if fx['bend']:
                bent += 1     # deliberately bent: checked below by the bend test
                continue
            if fx['slide']:
                skip = max(skip, 20)   # portamento: check once it has arrived
            errs = []
            for f in range(t + skip, min(end, t + 60)):
                r = L[f]
                if not r[F[vk]]:
                    continue
                p = r[F[pk]]
                freq = CPU / ((32 if ch == 'tri' else 16) * (p + 1))
                errs.append(midi_of(freq) - midi)
            if not errs:
                continue
            nnotes += 1
            e = np.array(errs)
            # tracker arpeggios add whole semitones: the root must be there and every frame in tune
            near = np.round(e)
            dev = np.abs(e - near) * 100
            if not (near == 0).any() and not song['inst_has_arp'][inst]:
                missing += 1     # (chord instruments play rootless voicings: only the grid is checked)
            offgrid += int((dev > 50).sum())
            worst = max(worst, float(np.median(dev)))
        check(missing == 0 and offgrid == 0,
              f'{ch:4s}: {nnotes} notes, root missing in {missing}, frames >50 cents off-grid {offgrid}, '
              f'worst median tuning error {worst:.1f} cents ({bent} bent notes skipped)')
    # bends rise monotonically
    for t, end, midi, inst in note_spans('p1'):
        if fxinfo[('p1', t)]['bend']:
            per = [L[f][F['sq1_period']] for f in range(t + 2, end)]   # after the attack chirp
            d = np.sign(np.diff(per)) * np.sign(fxinfo[('p1', t)]['bend'])
            semis = midi_of(CPU / 16 / (per[-1] + 1)) - midi_of(CPU / 16 / (per[0] + 1))
            check((d >= 0).mean() > 0.85 and abs(semis) > 1,
                  f'p1 bend at tick {t}: period {per[0]} -> {per[-1]} ({semis:+.1f} semitones), '
                  f'{(d >= 0).mean() * 100:.0f}% of frames move the right way (vibrato rides on top)')

    # ------------------------------------------------------------------ audio pitch
    print('audio pitch (solo channel f0 vs intended note)')
    off = start * SPF
    for ch, wavn in (('p1', 'sq1'), ('tri', 'tri')):
        x = load_wav(out / f'solo_{wavn}.wav')
        errs = []
        for t, end, midi, inst in note_spans(ch):
            if end - t < 14 or song['inst_has_arp'][inst] and ch != 'p1' or fxinfo[(ch, t)]['bend']:
                continue
            first = t + 3 if ch == 'p1' else t + 1
            # measure while the note sounds (the triangle is gated off by its envelope)
            env_end = min(end - 2, t + 40)
            if ch == 'tri':
                on = [f for f in range(t + 1, env_end) if L[f][F['tri_on']]]
                env_end = on[-1] if on else t
            # the harmony channel is tracker-arpeggiated chords: covered by the register check
            a, b = int(off + first * SPF), int(off + env_end * SPF)
            if b - a < 3000:   # at least ~4 frames, enough to resolve a bass note
                continue
            seg = x[a:b]
            if np.sqrt(np.mean((seg - seg.mean()) ** 2)) < 1e-3:
                continue
            f_exp = 440 * 2 ** ((midi - 69) / 12)
            f = f0_estimate(seg, f_exp / 1.4, f_exp * 1.4)
            errs.append((midi_of(f) - midi) * 100)
            if abs(errs[-1]) > 35 and '--debug' in sys.argv:
                print('       ', ch, 'tick', t, 'midi', midi, inst, 'measured', round(midi_of(f), 2), 'window', b - a)
        e = np.abs(np.array(errs))
        check(len(e) > 0 and (e < 35).mean() > 0.97,
              f'{ch:4s}: {len(e)} notes measured, median |error| {np.median(e):.1f} cents, '
              f'{(e < 35).mean() * 100:.1f}% within 35 cents, max {e.max():.0f}')

    # ------------------------------------------------------------------ audio timing
    print('audio timing')
    for ch, wavn, vk in (('p1', 'sq1', 'sq1_vol'), ('noise', 'noise', 'noise_vol')):
        x = load_wav(out / f'solo_{wavn}.wav')
        n = songlen
        a0 = off
        rms = np.array([np.sqrt(np.mean((x[int(a0 + k * SPF):int(a0 + (k + 1) * SPF)] -
                        x[int(a0 + k * SPF):int(a0 + (k + 1) * SPF)].mean()) ** 2)) for k in range(n)])
        vol = np.array([L[k][F[vk]] for k in range(n)], dtype=float)
        best = max(range(-3, 4), key=lambda lag: np.corrcoef(rms[3:n - 3], vol[3 + lag:n - 3 + lag])[0, 1])
        c = np.corrcoef(rms[3:n - 3], vol[3 + best:n - 3 + best])[0, 1]
        check(abs(best) <= 1 and c > 0.9, f'{ch:5s}: per-frame audio level follows the APU volume log, '
              f'best lag {best} frames, correlation {c:.3f} (notes sound on their rows)')

    # ------------------------------------------------------------------ envelopes
    print('envelopes')
    sys.path.insert(0, str(HERE))
    import compile as C
    lead_ok, lead_n = 0, 0
    for t, end, midi, inst in note_spans('p1'):
        o = t // fpp
        if not 2 <= o <= 6 or inst not in ('lead', 'lead2'):
            continue
        vals, loop, rel = C.parse_values(song['inst_env'][inst], '', True)
        sus = [v for _, v in (vals if rel is None else vals[:rel])]
        want_v = [sus[min(i, len(sus) - 1)] if loop is None else (sus[i] if i < len(sus) else sus[loop + (i - loop) % (len(sus) - loop)])
                  for i in range(end - t)]
        want_v = [round(v * 15 / 15) for v in want_v]
        got_v = [L[f][F['sq1_vol']] for f in range(t, end)]
        lead_n += 1
        lead_ok += got_v == want_v
    check(lead_n > 0 and lead_ok == lead_n, f'lead volume envelope frame-exact in the drop: {lead_ok}/{lead_n} notes')

    # ------------------------------------------------------------------ stuck notes
    print('stuck notes')
    for ch, vk, lim in (('p1', 'sq1_vol', 14), ('noise', 'noise_vol', 30), ('tri', 'tri_on', 2)):
        stuck = []
        ev = sched[ch]
        for i, (t, k, a, inst) in enumerate(ev):
            if k != 'off':
                continue
            nxt = ev[i + 1][0] if i + 1 < len(ev) else songlen
            if nxt - t <= lim:
                continue
            if any(L[f][F[vk]] for f in range(t + lim, nxt)):
                stuck.append(t)
        check(not stuck, f'{ch:5s}: every key-off is silent within {lim} frames ({len(stuck)} stuck, first at ticks {stuck[:3]})')

    # ------------------------------------------------------------------ loop
    print('loop')
    if loops >= 2:
        def state(t):   # what is audible: a silent channel's period does not matter
            r = L[t]
            return ((r[F['sq1_period']], r[F['sq1_vol']], r[F['sq1_duty']]) if r[F['sq1_vol']] else 0,
                    (r[F['sq2_period']], r[F['sq2_vol']], r[F['sq2_duty']]) if r[F['sq2_vol']] else 0,
                    r[F['tri_period']] if r[F['tri_on']] else 0,
                    (r[F['noise_period']], r[F['noise_vol']], r[F['noise_short']]) if r[F['noise_vol']] else 0)
        diff = [k for k in range(songlen) if state(k) != state(songlen + k)]
        sq2only = [k for k in diff if state(k)[0::2] == state(songlen + k)[0::2] and state(k)[3] == state(songlen + k)[3]]
        check(len(diff) == len(sq2only) and max(sq2only, default=0) < 64,
              f'pass 2 audible APU state equals pass 1, except the echo history in the first frames '
              f'({len(diff)} differing frames, {len(sq2only)} only in pulse 2, last at tick {max(sq2only, default=-1)})')
        x = load_wav(out / 'full.wav')
        s1, s2 = int(off), int(off + songlen * SPF)
        def bands(y):   # 1/3-octave band levels every 1/30 s
            fr = np.lib.stride_tricks.sliding_window_view(y, 4096)[::1600] * np.hanning(4096)
            P = np.abs(np.fft.rfft(fr, axis=1)) ** 2
            f = np.fft.rfftfreq(4096, 1 / SR)
            edges = 40 * 2 ** (np.arange(0, 22) / 3)
            return np.log10(np.stack([P[:, (f >= lo) & (f < hi)].sum(1) for lo, hi in zip(edges, edges[1:])], 1) + 1e-9)
        for name in ['full', 'solo_sq1', 'solo_sq2', 'solo_tri', 'solo_noise', 'solo_dmc']:
            y = load_wav(out / f'{name}.wav')
            a1, a2 = bands(y[s1 + 2 * SR: s1 + 40 * SR]), bands(y[s2 + 2 * SR: s2 + 40 * SR])
            corr = np.corrcoef(a1.ravel(), a2.ravel())[0, 1] if a1.std() > 0 else 1.0
            # the triangle's waveform phase is free-running (a note-on does not reset it), so its very
            # short ghost notes and pops differ a little in energy between passes: a looser bound
            lim = 0.96 if name in ('solo_tri', 'full') else 0.97   # (the triangle dominates the mix)
            check(corr > lim, f'{name:10s}: band levels of pass 2 (2-40 s) match pass 1, correlation {corr:.4f}')
        seam = x[s2 - SR // 2: s2 + SR // 2]
        d = np.abs(np.diff(seam))
        ref = np.abs(np.diff(x[s1 + SR: s2 - SR]))
        check(d.max() <= np.percentile(ref, 99.99) * 1.2,
              f'no click at the loop seam: max step {d.max():.4f} vs 99.99th percentile in the song {np.percentile(ref, 99.99):.4f}')
        lv = lambda y: 20 * np.log10(np.sqrt(np.mean((y - y.mean()) ** 2)))
        print(f'        level 2 s before the seam {lv(x[s2 - 2 * SR:s2]):.1f} dB, 2 s after {lv(x[s2:s2 + 2 * SR]):.1f} dB')

    # ------------------------------------------------------------------ levels
    print('levels')
    x = load_wav(out / 'full.wav')
    seg = x[int(off): int(off + songlen * SPF)]
    pk = np.abs(seg - np.median(seg)).max()
    clip = int((np.abs(x) >= 32767 / 32768).sum())
    check(clip == 0 and pk < 0.7, f'peak {20 * np.log10(pk):.1f} dBFS (DC removed), {clip} clipped samples')
    print(f'        RMS {20 * np.log10(np.sqrt(np.mean((seg - seg.mean()) ** 2))):.1f} dBFS over the song')

    # ------------------------------------------------------------------ cycles
    print('cycles')
    cyc = [r[0] for r in L if r[0] is not None]
    worst = max(cyc) - 16
    check(worst <= 2000, f'music_play worst case {worst} cycles (mean {np.mean(cyc) - 16:.0f}), measured over {len(cyc)} calls')
    print(f'        [{cyc_line}]')
    print()
    print('ALL CHECKS PASSED' if not failures else f'{len(failures)} CHECK(S) FAILED')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
