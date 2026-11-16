#!/usr/bin/env python3
"""Kaleido: "Toccata and Fugue in D minor" for the 2A03 (original; no quotations).

Writes ../song.txt (the compile.py format) from the score below, and prints a counterpoint
report (parallel fifths/octaves, dissonances on beats, voice crossings) so the part-writing can be
checked without ears.

usage: fugue.py [--check]

Three real voices: pulse 1 = soprano, pulse 2 = alto, triangle = bass. Noise (and two DPCM
timpani) only from the middle of the fugue, for drive. A row is a 16th note; 16 rows = one 4/4 bar;
a pattern = 4 bars. Speed 9 frames per row (100 bpm).
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROWS = 64
BAR = 16

NN = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}
NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']


def midi_of(tok):
    m = re.fullmatch(r'([a-g])(#|b|)(\d)', tok)
    if not m:
        raise ValueError(tok)
    return 12 * (int(m[3]) + 1) + NN[m[1]] + {'#': 1, 'b': -1, '': 0}[m[2]]


# --------------------------------------------------------------------------- keys
class Key:
    def __init__(self, tonic, mode):
        self.t = midi_of(tonic)          # degree 0
        self.mode = mode
        self.steps = [0, 2, 3, 5, 7, 8, 10] if mode == 'min' else [0, 2, 4, 5, 7, 9, 11]

    def deg(self, d, alt=0):
        o, s = divmod(d, 7)
        return self.t + 12 * o + self.steps[s] + alt

    def pc_in(self, midi):
        return (midi - self.t) % 12 in self.steps or (self.mode == 'min' and (midi - self.t) % 12 in (9, 11))


Dm, Am, F, Gm, C, Bb = Key('d4', 'min'), Key('a4', 'min'), Key('f4', 'maj'), Key('g4', 'min'), Key('c4', 'maj'), Key('bb3', 'maj')


def neighbour(midi, key, up=True):
    """The diatonic note above/below midi in key (harmonic minor around the leading tone)."""
    cands = sorted(set(key.deg(d) for d in range(-14, 21)) | ({key.deg(d, 1) for d in range(-14, 21) if d % 7 == 6} if key.mode == 'min' else set()))
    if key.mode == 'min':
        # the raised 7th replaces the natural one next to the tonic
        cands = [c for c in cands if not ((c - key.t) % 12 == 10 and midi % 12 == (key.t - 1) % 12)]
    if up:
        return min([c for c in cands if c > midi] or [midi + 2])
    return max([c for c in cands if c < midi] or [midi - 2])


# --------------------------------------------------------------------------- notation
# A voice is a list of events (midi or None for rest, length in rows, ornament or '').
# Text: "d5:2 a4:2 bb4 c#5 r:4 e5:2~" (length in 16ths, default 1); ornaments: ~ trill,
# m lower mordent, M upper mordent; '=' ties onto the previous note.
def P(text):
    out = []
    for tok in text.split():
        ln, orn = 1, ''
        while tok and tok[-1] in '~mM':
            orn = tok[-1] + orn
            tok = tok[:-1]
        if ':' in tok:
            tok, l = tok.split(':')
            ln = int(l)
        if tok == 'r':
            out.append((None, ln, ''))
        elif tok == '=':
            m, l, o = out[-1]
            out[-1] = (m, l + ln, o)
        else:
            out.append((midi_of(tok), ln, orn))
    return out


def D(key, spec, shift=0):
    """Degrees: "7:2 4:2 5 6+ ..." in key (degree 0 = tonic in the key's octave); shift in octaves."""
    out = []
    for tok in spec.split():
        ln, orn = 1, ''
        while tok and tok[-1] in '~mM':
            orn = tok[-1] + orn
            tok = tok[:-1]
        if ':' in tok:
            tok, l = tok.split(':')
            ln = int(l)
        if tok == 'r':
            out.append((None, ln, ''))
            continue
        alt = tok.count('+') - tok.count('_')
        d = int(tok.rstrip('+_'))
        out.append((key.deg(d, alt) + 12 * shift, ln, (orn, key) if orn else ''))
    return out


def T(ev, semis):
    return [(None if m is None else m + semis, l, o) for m, l, o in ev]


def length(ev):
    return sum(l for _, l, _ in ev)


def rest(n):
    return [(None, n, '')] if n else []


# --------------------------------------------------------------------------- the themes
# Subject (D minor, 2 bars): an octave call, a rising run through the augmented second, a climbing
# sequence of falling thirds, the run back down and a trilled cadence.
S_SPEC = '7:2 4:2 5:1 6+ 7 8 9:2 8:1 7 10:2 9:1 8 11:2 10:1 9 8 7 6+ 7 8:2~ 4:2 7:4'
# Tonal answer: the second note answers the dominant with the tonic.
A_SPEC = '7:2 3:2 5:1 6+ 7 8 9:2 8:1 7 10:2 9:1 8 11:2 10:1 9 8 7 6+ 7 8:2~ 4:2 7:4'
# Countersubject: slow, syncopation-free, rising then falling, with ornaments (invertible at the octave).
CS_SPEC = 'r:2 2:2 3:4m 4:2 3:2 5:4 4:4M 3:4 1:2 -1+:2 0:4'
CS_ANS = 'r:2 1:2 3:4m 4:2 3:2 5:4 4:4M 3:4 1:2 -1+:2 2+:4'   # against the answer; ends on C# (V of D minor)
# Inversion (mirror about the first note), used in the second stretto.
I_SPEC = '7:2 10:2 9:1 8 7 6+ 5:2 6:1 7 4:2 5:1 6 3:2 4:1 5 6 7 8 7 6+:2~ 10:2 7:4'


def S(key, shift=0):
    return D(key, S_SPEC, shift)


def A(key, shift=0):
    return D(key, A_SPEC, shift)


def CS(key, shift=0, spec=CS_SPEC):
    return D(key, spec, shift)


def I(key, shift=0):
    return D(key, I_SPEC, shift)


# --------------------------------------------------------------------------- harmony
QUAL = {'M': [0, 4, 7], 'm': [0, 3, 7], 'o': [0, 3, 6], '7': [0, 4, 7, 10], 'o7': [0, 3, 6, 9], 'm7': [0, 3, 7, 10]}
DIATONIC = {'min': ['m', 'o', 'M', 'm', 'M', 'M', 'M'], 'maj': ['M', 'm', 'm', 'M', 'M', 'm', 'o']}


def chords(key, text):
    """Per-beat chords from scale-degree tokens: "0 6+:o7 0 3 | 0 4:7 4 0" ('|' is decoration).
    A token is DEG[+|_][:QUAL]; QUAL defaults to the key's diatonic triad (V major in minor)."""
    out = []
    for tok in text.split():
        if tok == '|':
            continue
        q = None
        if ':' in tok:
            tok, q = tok.split(':')
        alt = tok.count('+') - tok.count('_')
        d = int(tok.rstrip('+_'))
        root = key.deg(d, alt) % 12
        if q is None:
            q = DIATONIC[key.mode][d % 7]
        out.append(frozenset((root + i) % 12 for i in QUAL[q]))
    return out


S_HARM = '0 6+:o7 0 3 0 4:7 4 0'          # what the subject implies, beat by beat
I_SPEC = '7:2 10:2 9 8 7 6 5:2 6 7 4:2 5 6 3:2 4 5 6 7 8 7 6+:2~ 4:2 7:4'
I_HARM = '3 2 5 2 3 6 4:7 0'


# --------------------------------------------------------------------------- the solver
def grid_of(ev, n):
    g = [None] * n
    on = [False] * n
    r = 0
    for m, l, o in ev:
        for i in range(l):
            if r + i < n:
                g[r + i] = m
        if r < n:
            on[r] = m is not None
        r += l
    return g, on


def solve(n, rhythm, chs, lo, hi, above=(), below=(), others=(), start=None, end=None, width=300, beat_rows=4,
          avoid_rep=True, steps_only_weak=True, prefix=(), strong_set=None, leap_ok=False):
    """Find a voice for n rows with the given rhythm (lengths, None = rest) against fixed voices.
    above: voices it must stay below; below: voices it must stay above; others: also checked for
    parallels. chs: chord (pitch-class set) per beat. Returns events."""
    A = [grid_of(v, n) for v in above]
    B = [grid_of(v, n) for v in below]
    O = [grid_of(v, n) for v in list(above) + list(below) + list(others)]
    onsets = []
    r = length(prefix)
    for l in rhythm:
        onsets.append((r, abs(l), l > 0))
        r += abs(l)
    assert r == n, (r, n)
    prev0 = None
    rr = 0
    for m, l, o in prefix:
        if m is not None:
            prev0 = (rr, m)
        rr += l
    beams = [(0.0, [], prev0)]         # cost, notes, prev (row, midi)
    for idx, (r, l, sound) in enumerate(onsets):
        if not sound:
            beams = [(c, notes + [None], prev) for c, notes, prev in beams]
            continue
        nb = []
        span = range(r, r + l)
        ceil = min([g[i] for g, _ in A for i in span if g[i] is not None] or [hi + 1])
        floor = max([g[i] for g, _ in B for i in span if g[i] is not None] or [lo - 1])
        beats = sorted(set(i // beat_rows for i in span))
        strong = r % beat_rows == 0
        for c, notes, prev in beams:
            for m in range(max(lo, floor + 1), min(hi, ceil - 1) + 1):
                pc = m % 12
                cost = c
                chord_ok = pc in chs[r // beat_rows]
                if strong_set is not None and r % beat_rows == 0 and pc not in strong_set[r // beat_rows]:
                    continue
                # a held note must belong to every chord it sounds through (no unprepared clashes)
                held_ok = all(pc in chs[b] for b in beats[1:])
                if not held_ok:
                    continue
                pm = prev[1] if prev else None
                if not chord_ok:
                    if strong or pm is None or abs(m - pm) > 2 or l > 2:
                        continue
                    cost += 3            # passing / neighbour note on a weak 16th or 8th
                if pm is not None:
                    d = abs(m - pm)
                    if leap_ok:
                        cost += [1.5, 0.5, 0.5, 0.5, 0.5, 0.6, 6, 0.6, 2, 2, 3, 4, 0.3][min(d, 12)] + (8 if d > 12 else 0)
                    else:
                        cost += [2.5, 0, 0, 0.6, 0.6, 1.5, 6, 2, 3, 4, 4, 6, 3][min(d, 12)] + (8 if d > 12 else 0)
                    if d == 0 and avoid_rep:
                        cost += 1.5
                    if d == 6:
                        cost += 4
                # vertical: no unisons; mild penalty for octaves with others; parallels forbidden
                bad = False
                for g, on in O:
                    x = g[r]
                    if x is None:
                        continue
                    if x == m:
                        bad = True
                        break
                    iv = (m - x) % 12
                    if iv == 0:
                        cost += 1.0
                    if prev is not None and r > 0:
                        px = g[r - 1]          # the simultaneity just before this onset
                        if px is not None and px != x and pm != m:
                            piv = (pm - px) % 12
                            if piv == iv and iv in (0, 7):
                                bad = True
                                break
                            # hidden fifths/octaves into a perfect interval by similar motion with a leap
                            if iv in (0, 7) and (m - pm) * (x - px) > 0 and abs(m - pm) > 2:
                                cost += 2
                    # dissonance with a voice's note on a strong beat
                    if strong and iv in (1, 2, 10, 11, 6) and not chord_ok:
                        cost += 4
                if bad:
                    continue
                if start is not None and pm is None:
                    cost += abs(m - start) * 0.5
                if end is not None and idx == len(onsets) - 1:
                    cost += abs(m - end) * 0.7
                # stay mid-range
                mid = (lo + hi) / 2
                cost += abs(m - mid) * 0.05
                nb.append((cost, notes + [m], (r, m)))
        nb.sort(key=lambda t: t[0])
        # keep diversity: the best few per last note
        seen, kept = {}, []
        for t in nb:
            k = t[2][1]
            if seen.get(k, 0) < 6:
                kept.append(t)
                seen[k] = seen.get(k, 0) + 1
            if len(kept) >= width:
                break
        if not kept:
            raise SystemExit(f'solver: no candidate at row {r} (range {lo}-{hi}, floor {floor}, ceil {ceil})')
        beams = kept
    best = beams[0][1]
    return list(prefix) + [(m, l, '') for m, (r, l, s) in zip(best, onsets)]


def roots(chs):
    out = []
    for ch in chs:
        r = None
        for pc in ch:
            if (pc + 7) % 12 in ch and ((pc + 3) % 12 in ch or (pc + 4) % 12 in ch):
                r = pc
        if r is None:
            for pc in ch:
                if (pc + 6) % 12 in ch and (pc + 3) % 12 in ch:
                    r = pc
        out.append(frozenset([r if r is not None else min(ch)]))
    return out


def walk(chs, lo, hi, above, start=None, rhythm=None):
    """A harpsichord bass in 8ths: the root on each beat, any chord tone off it, no parallels."""
    n = 4 * len(chs)
    rhythm = rhythm or [2] * (n // 2)
    return solve(n, rhythm, chs, lo, hi, above=above, start=start, strong_set=roots(chs), leap_ok=True)


def bass_line(key, chs, lo, hi, pattern=(2, 2), start=None, oct_leap=True, beat_rows=4):
    """A walking harpsichord bass from chord roots: each beat root then root an octave up (or the
    fifth), staying near the previous note."""
    out = []
    prev = start
    for b, ch in enumerate(chs):
        # the root is the chord tone that makes the chord's intervals a triad above it
        root = None
        for pc in ch:
            if all(((p - pc) % 12) in (0, 3, 4, 6, 7, 9, 10) for p in ch) and ((pc + 7) % 12 in ch or (pc + 6) % 12 in ch):
                root = pc
                break
        if root is None:
            root = min(ch)
        cands = [m for m in range(lo, hi + 1) if m % 12 == root]
        m1 = min(cands, key=lambda m: abs(m - (prev if prev else (lo + hi) // 2)))
        if len(pattern) == 1:
            out.append((m1, pattern[0], ''))
            prev = m1
            continue
        m2 = m1 + 12 if m1 + 12 <= hi else m1 - 12
        if not oct_leap:
            m2 = m1 + 7 if m1 + 7 <= hi else m1 - 5
        out += [(m1, pattern[0], ''), (m2, pattern[1], '')]
        prev = m2
    return out


def arp16(key, chs, lo, hi, shape='updown', start=None):
    """Soprano broken chords in 16ths: each beat four chord tones climbing or falling."""
    out = []
    prev = start
    up = True
    for b, ch in enumerate(chs):
        tones = [m for m in range(lo, hi + 1) if m % 12 in ch]
        p = prev if prev is not None else tones[len(tones) // 2]
        i = min(range(len(tones)), key=lambda i: abs(tones[i] - p))
        seq = []
        for k in range(4):
            j = i + k if up else i - k
            j = max(0, min(len(tones) - 1, j))
            seq.append(tones[j])
        if shape == 'updown':
            up = not up
        out += [(m, 1, '') for m in seq]
        prev = seq[-1]
    return out


# --------------------------------------------------------------------------- the score
sections = []


def section(name, bars, key, p1, p2, tri, noise='', dmc='', harm=None, pedal=False):
    sections.append(dict(name=name, bars=bars, key=key, p1=p1, p2=p2, tri=tri, noise=noise, dmc=dmc, harm=harm, pedal=pedal))


def broken(chord, fig):
    ms = [midi_of(c) for c in chord]
    return [(ms[i], 1, '') for i in fig]


FIG_A = [0, 2, 1, 3, 2, 4, 3, 2, 1, 3, 2, 4, 3, 5, 4, 3]
FIG_B = [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 4, 3, 2, 1]

# --- TOCCATA (12 bars): broken chords over a pedal, a diminished cascade, a scale, the dominant
toc = [  # soprano chord tones, alto (two half notes), bass
    (['d4', 'f4', 'a4', 'd5', 'f5', 'a5'], ['f4', 'a4'], 'd2'),
    (['d4', 'g4', 'bb4', 'd5', 'g5', 'bb5'], ['g4', 'bb4'], 'd2'),
    (['c#4', 'e4', 'g4', 'bb4', 'c#5', 'e5'], ['e4', 'g4'], 'd2'),
    (['d4', 'f4', 'a4', 'd5', 'f5', 'a5'], ['f4', 'd4'], 'd2'),
    (['d4', 'f4', 'bb4', 'd5', 'f5', 'bb5'], ['f4', 'd4'], 'bb1'),
    (['e4', 'g4', 'bb4', 'e5', 'g5', 'bb5'], ['g4', 'e4'], 'g1'),
    (['e4', 'g4', 'c#5', 'e5', 'g5', 'a5'], ['c#4', 'e4'], 'a1'),
    (['d4', 'f4', 'a4', 'd5', 'f5', 'a5'], ['a3', 'd4'], 'd2'),
]
tp1, tp2, ttri = [], [], []
for i, (ch, al, bass) in enumerate(toc):
    tp1 += broken(ch, FIG_A if i < 4 else FIG_B)
    tp2 += rest(16) if i == 0 else [(midi_of(al[0]) - 12 if False else midi_of(al[0]), 8, ''), (midi_of(al[1]), 8, '')]
    ttri += [(midi_of(bass), 16, '')]
dim = [midi_of(x) for x in ['c#6', 'bb5', 'g5', 'e5', 'c#5', 'bb4', 'g4', 'e4', 'c#4', 'e4', 'g4', 'bb4', 'c#5', 'e5', 'g5', 'bb5']]
rise = [midi_of(x) for x in ['d6', 'a5', 'f5', 'd5', 'a4', 'f4', 'd4', 'a3', 'd4', 'f4', 'a4', 'd5', 'f5', 'a5', 'd6', 'e6']]
for i, m in enumerate(dim + rise):        # hocket: the hands alternate 16ths
    if i % 2 == 0:
        tp1.append((m, 1, ''))
        tp2.append((None, 1, ''))
    else:
        tp1.append((None, 1, ''))
        tp2.append((m - 12, 1, ''))
ttri += P('a1:16 a1:8 c#2:4 e2:4')
tp1 += P('a4 bb4 c#5 d5 e5 f5 g5 a5 bb5 a5 g5 f5 e5 d5 c#5 e5')
tp2 += P('c#4 d4 e4 f4 g4 a4 bb4 c#5 d5 c#5 bb4 a4 g4 f4 e4 g4')
ttri += P('a2:4 g2:4 f2:4 e2:4')
tp1 += P('e5:12~ r:4')
tp2 += P('c#5:6 a4:6 r:4')
ttri += P('a1:12 r:4')
section('toccata', 12, Dm, tp1, tp2, ttri)

R8 = [2] * 16          # a bar of 8ths
R4 = [4] * 4
# --- EXPOSITION ----------------------------------------------------------------------------
section('expo1', 4, Dm, p1=rest(32) + A(Am, 0), p2=S(Dm, 0) + CS(Am, 0, CS_ANS), tri=rest(64))

# bars 5-6: subject in the bass, countersubject above it, a free alto; bars 7-8: episode to F
ex_p1 = CS(Dm, 1)
ex_tri = S(Dm, -2)
ep1_harm = chords(Dm, '0 3 6 2 | 5 1:o 2 6:7')        # i iv VII III | VI ii° III V7/III
ep1_p1 = P('f5:2 e5 d5 g5:2 f5 e5 e5:2 d5 c5 f5:2 e5 d5 d5:2 c5 bb4 e5:2 d5 c5 c5:2 bb4 a4 bb4:2 a4 g4')
ep1_tri = walk(ep1_harm, 38, 53, above=[ep1_p1], start=50)
ex_harm = chords(Dm, S_HARM) + ep1_harm
p1 = ex_p1 + ep1_p1
tri = ex_tri + ep1_tri
p2 = solve(64, [2, 2] * 4 + [4, 2, 2, 4, 4] + [2] * 16, ex_harm, 57, 74, above=[p1], below=[tri], start=69)
section('expo2', 4, Dm, p1=p1, p2=p2, tri=tri, harm=ex_harm)

# --- MIDDLE ENTRIES ------------------------------------------------------------------------
# bars 9-10: subject in F major up top, countersubject in the bass; bars 11-12: arpeggio episode to G minor
m1_harm = chords(F, S_HARM) + chords(F, '0 5 1 6+:o7 | 3 1 2+:7 2+:7') + []
m1_harm = chords(F, S_HARM) + chords(F, '0 2 3 1') + chords(Gm, '2 0 4 4:7')
p1 = S(F, 0) + arp16(F, m1_harm[8:], 67, 86, start=77)
tri = CS(F, -1) + walk(m1_harm[8:], 38, 55, above=[p1[-32:]], start=48)
p2 = solve(64, [4, 2, 2, 4, 4, 4, 2, 2, 4, 4] + [4] * 8, m1_harm, 57, 74, above=[p1], below=[tri], start=69)
section('middle1', 4, F, p1=p1, p2=p2, tri=tri, harm=m1_harm)

# bars 13-14: subject in G minor in the bass, countersubject in the soprano; bars 15-16: episode to A minor
m2_harm = chords(Gm, S_HARM) + chords(Gm, '0 3:7 6 5') + chords(Am, '3 4:7 0 4:7')
ep3_p1 = P('d5:2 c5 bb4 e5:2 d5 c5 f5:2 e5 d5 g5:2 f5 eb5 a5:2 g5 f5 g#5:2 f5 e5 a5:2 e5 c5 b4 d5 e5 g#5')
p1 = CS(Gm, 1) + ep3_p1
tri = S(Gm, -2) + walk(m2_harm[8:], 38, 55, above=[ep3_p1], start=45)
p2 = solve(64, [2] * 32, m2_harm, 55, 76, above=[p1], below=[tri], start=67)
section('middle2', 4, Gm, p1=p1, p2=p2, tri=tri, harm=m2_harm)

# bars 17-18: subject in A minor in the alto, countersubject in the bass; bars 19-20: toccata
# episode back to D minor; tambourine and timpani begin
m3_harm = chords(Am, S_HARM) + chords(Am, '0 4 0 3') + chords(Dm, '5 3 4:7 4:7')
p2a = S(Am, -1)
tria = CS(Am, -2)
p1a = solve(32, [4, 2, 2, 4, 4, 2, 2, 4, 4, 4], m3_harm[:8], 69, 86, below=[p2a, tria], start=76)
p1b = arp16(Dm, m3_harm[8:], 69, 88, start=76)
trib = walk(m3_harm[8:], 40, 57, above=[p1b], start=45)
p2b = solve(32, [2] * 16, m3_harm[8:], 57, 74, above=[p1b], below=[trib], start=64)
section('middle3', 4, Am, p1=p1a + p1b, p2=p2a + p2b, tri=tria + trib, harm=m3_harm,
        noise='r:32 ' + 'hat:2 ' * 16,
        dmc='r:32 timpa:8 timpa:8 timpd:8 timpa:8')

# --- STRETTO -------------------------------------------------------------------------------
# bars 21-24: entries a bar apart: soprano (D minor), alto (the answer), bass (D minor); each
# leading voice breaks off into free counterpoint when the next one enters
st_harm = chords(Dm, '0 6+:o7 0 3') + chords(Am, '0 6+:o7 0 3') + chords(Dm, S_HARM)
tri = rest(32) + S(Dm, -2)
p2 = solve(64, [4, 2, 2, 4, 4, 2, 2, 4, 4, 4], st_harm, 57, 72, below=[tri], prefix=rest(16) + A(Am, -1)[:12])
p1 = solve(64, [2] * 8 + [4, 2, 2, 4, 4, 4, 2, 2, 4, 4], st_harm, 67, 84, below=[p2, tri],
           prefix=S(Dm, 0)[:12])
section('stretto1', 4, Dm, p1=p1, p2=p2, tri=tri, harm=st_harm, noise='hat:2 ' * 32,
        dmc='timpd:16 timpa:16 timpd:8 timpa:8 timpd:8 timpa:8')

# bars 25-28: the subject turned upside down (a mirror), in stretto the same way, then in the bass
st2_harm = chords(Dm, I_HARM)[:4] + chords(Am, I_HARM)[:4] + chords(Dm, I_HARM)
p1h = I(Dm, 0)[:12]
p2h = rest(16) + I(Am, -1)[:12]
tri = walk(st2_harm[:8], 38, 52, above=[p1h + rest(16), p2h], start=50) + I(Dm, -2)
p2 = solve(64, [4, 2, 2, 4, 4, 2, 2, 4, 4, 4], st2_harm, 57, 72, below=[tri], prefix=p2h)
p1 = solve(64, [2] * 8 + [4, 2, 2, 4, 4, 4, 2, 2, 4, 4], st2_harm, 67, 84, below=[p2, tri], prefix=p1h)
section('stretto2', 4, Dm, p1=p1, p2=p2, tri=tri, harm=st2_harm, noise='hat:2 ' * 32,
        dmc='timpd:16 timpa:16 timpd:16 timpa:8 timpa:8')


# --- DOMINANT PEDAL (8 bars) ----------------------------------------------------------------
def diat(key, ev, steps):
    """Move events diatonically by steps (harmonic minor around the leading tone)."""
    out = []
    for m, l, o in ev:
        if m is None:
            out.append((m, l, o))
            continue
        # find the degree of m
        best = None
        for d in range(-21, 28):
            for alt in (0, 1):
                if key.deg(d, alt) == m:
                    best = (d, alt)
                    break
            if best:
                break
        d, alt = best if best else (0, 0)
        nd = d + steps
        out.append((key.deg(nd, 1 if (key.mode == 'min' and nd % 7 == 6 and alt) else 0), l, o))
    return out


ped_harm = chords(Dm, '0 4:7 0 4:7 | 0 4:7 0 4:7 | 3 2+:o7 3 2+:o7 | 5 6+:o7 5 6+:o7 | 4:7 4:7 4:7 4:7 | 4:7 4:7 4:7 4:7 '
                      '| 0 3 6+:o7 4:7 | 4:7 4:7 4:7 4:7')
tri = P('a2:2 a3:2 ' * 32)
HEAD = '7:2 4:2 5 6+ 7 8'
Gm_h = Key('g4', 'min')
s_heads = (D(Dm, HEAD) + rest(8) + D(Dm, HEAD, 0) + rest(8) +          # bar 29: head, (alto answers)
           T(D(Dm, HEAD), 12)[:0] + D(Dm, HEAD) + rest(8) + D(Dm, HEAD) + rest(8))
run_up = P('a4 bb4 c#5 d5 e5 f5 g5 a5 bb5 a5 g5 f5 e5 f5 g5 a5')
run_dn = P('bb5 a5 g5 f5 e5 d5 c#5 d5 e5 f5 g5 a5 bb5 c#6 d6 e6')
ped_p1_parts = [
    (0, D(Dm, HEAD, 0)), (16, D(Dm, HEAD, 0)), (32, D(Gm_h, HEAD, 0)), (48, T(D(Gm_h, HEAD, 0), 3)),
]
# soprano: the head every bar, rising, with free answers; then 16th runs and the trilled dominant
p2 = []
p1 = []
for bar in range(4):
    keyh = Dm if bar < 2 else Gm_h
    head = D(keyh, HEAD, 0)
    if bar == 1:
        head = T(head, 12)
        head = D(Dm, HEAD, 0)
        head = T(D(Dm, HEAD, 0), 0)
    if bar == 3:
        head = D(Key('bb4', 'maj'), '7:2 4:2 5 6 7 8', -1)   # on B flat, over the pedal
    p1 += head
    p1 += rest(8)
    p2 += rest(8)
    p2 += D(keyh, HEAD, -1) if bar != 3 else D(Key('bb3', 'maj'), '7:2 4:2 5 6 7 8')
# fill the soprano's rests with held answers
fill_p1 = solve(64, [], ped_harm[:16], 67, 84) if False else None
p1_full = []
r = 0
src = p1
p1 = solve(64, [], ped_harm, 67, 86, prefix=p1[:6]) if False else p1
# replace each rest(8) in the soprano by two solved quarter notes
out1 = []
pos = 0
for ev in p1:
    out1.append(ev)
p1 = out1
p1_sol = []
pos = 0
for m, l, o in p1:
    if m is None and l == 8:
        seg = solve(pos + 8, [4, 4], ped_harm, 69, 86, below=[p2 + rest(64), tri], prefix=p1_sol)[len(p1_sol):]
        p1_sol += seg
    else:
        p1_sol.append((m, l, o))
    pos += l
p1 = p1_sol
p2_sol = []
pos = 0
for m, l, o in p2:
    if m is None and l == 8:
        seg = solve(pos + 8, [4, 4], ped_harm, 55, 72, above=[p1], below=[tri], prefix=p2_sol)[len(p2_sol):]
        p2_sol += seg
    else:
        p2_sol.append((m, l, o))
    pos += l
p2 = p2_sol
# bars 33-36: contrary-motion runs, then the dominant seventh with trills and a breath
p1 += run_up + run_dn + P('f6:4 e6:4 d6:4 c#6:4') + P('e6:12~ r:4')
p2 += diat(Dm, run_up, -9) + diat(Dm, run_dn, -9) + P('a4:4 g4:4 f4:4 e4:4') + P('c#5:12~ r:4')
tri = P('a2:2 a3:2 ' * 31) + P('a2:2 r:2')
section('pedal', 8, Dm, p1=p1, p2=p2, tri=tri, harm=ped_harm, pedal=True,
        noise='hat:2 ' * 56 + 'hat:1 ' * 12 + 'r:4',
        dmc=('timpa:8 ' * 4) + ('timpa:4 ' * 8) + ('timpa:2 ' * 24) + 'timpa:1 ' * 12 + 'r:4')

# --- FINAL ENTRY AND GRAND CADENCE ----------------------------------------------------------
fin_harm = chords(Dm, S_HARM) + chords(Dm, '5 3 6+:o7 4:7 | 0 0 4:7 4:7')
tri = S(Dm, -2) + P('bb2:4 g2:4 c#3:4 a2:4 d2:4 f2:4 a2:8')
p1 = solve(64, [], fin_harm, 69, 86, prefix=CS(Dm, 1)) if False else CS(Dm, 1)
p1 = solve(64, [4, 4, 4, 4, 4, 4, 4, 4], fin_harm, 69, 86, below=[tri], prefix=CS(Dm, 1), start=74)
p1 = p1[:-2] + P('g5:4 e5:4~')
p2 = solve(64, [2] * 16 + [4] * 4 + [4, 4, 8], fin_harm, 55, 74, above=[p1], below=[tri], start=65)
cad_p1 = (broken(['g4', 'bb4', 'd5', 'g5', 'bb5', 'd6'], FIG_B) + broken(['e4', 'g4', 'c#5', 'e5', 'g5', 'bb5'], FIG_B) +
          P('a4 d5 f#5 a5 d6:12~') + P('d6:12 r:4'))
cad_p2 = P('bb3:8 d4:8 c#4:8 e4:8 f#4:16 a4:12 r:4')
cad_tri = P('g2:16 a2:16 d2:16 d2:12 r:4')
section('final', 8, Dm, harm=fin_harm + chords(Dm, '3 3 3 3 4:7 4:7 4:7 4:7 0:M 0:M 0:M 0:M 0:M 0:M 0:M 0:M'), p1=p1 + cad_p1, p2=p2 + cad_p2, tri=tri + cad_tri,
        noise='hat:2 ' * 32 + 'hat:2 ' * 16 + 'hat:4 ' * 4 + 'r:16',
        dmc='timpd:16 timpa:16 timpd:16 timpa:16 timpd:16 timpa:16 timpd:8 timpd:8 r:16')
# --------------------------------------------------------------------------- checks
def grid(ev, total):
    """Per-row (midi or None, onset flag)."""
    g = []
    for m, l, o in ev:
        for i in range(l):
            g.append((m, i == 0))
    return g[:total] + [(None, False)] * max(0, total - len(g))


def check(report=True):
    probs = []
    row0 = 0
    for sec in sections:
        n = sec['bars'] * BAR
        V = {}
        for v in ('p1', 'p2', 'tri'):
            L = length(sec[v])
            if L != n:
                probs.append(f"{sec['name']}: {v} is {L} rows, expected {n}")
            V[v] = grid(sec[v], n)
        pairs = [('p1', 'p2'), ('p1', 'tri'), ('p2', 'tri')]
        prev = {}
        for r in range(n):
            bar, beat = divmod(r, BAR)
            where = f"{sec['name']} bar {bar + 1} 16th {beat}"
            for a, b in pairs:
                ma, oa = V[a][r]
                mb, ob = V[b][r]
                if ma is None or mb is None:
                    continue
                iv = (ma - mb) % 12
                if ma < mb and not (a == 'p1' and b == 'p2' and False):
                    probs.append(f'{where}: {a} below {b} (crossing)')
                strong = beat % 4 == 0
                H = sec.get('harm')
                inchord = H is not None and ma % 12 in H[r // 4] and mb % 12 in H[r // 4]
                if sec.get('pedal') and b == 'tri':
                    inchord = True
                if (oa or ob) and strong and iv in (1, 2, 10, 11, 6) and ma != mb and not inchord:
                    probs.append(f'{where}: {a}/{b} dissonance {iv} on the beat')
                if (oa or ob) and strong and iv == 5 and b == 'tri' and not inchord and not any(V[x][r][0] is not None and (V[x][r][0] - mb) % 12 in (3, 4, 8, 9) for x in ('p1', 'p2') if x != a):
                    probs.append(f'{where}: {a}/{b} bare fourth over the bass on the beat')
                # parallels: both voices move to a new note and form the same perfect interval
                key = (a, b)
                if oa and ob and key in prev:
                    pa, pb, piv = prev[key]
                    if iv in (0, 7) and piv == iv and pa != ma and pb != mb:
                        probs.append(f'{where}: parallel {"octave" if iv == 0 else "fifth"} {a}/{b}')
                if oa or ob:
                    prev[key] = (ma, mb, iv)
        row0 += n
    if report:
        for p in probs:
            print(p)
        print(f'{len(probs)} notes', file=sys.stderr)
    return probs


# --------------------------------------------------------------------------- output
HEADER = '''# Kaleido: "Toccata and Fugue in D minor", an original fugue for the 2A03.
# GENERATED by tools/fugue.py (edit the score there). Format: see tools/compile.py.
# Three real voices: pulse 1 soprano, pulse 2 alto, triangle bass; noise and DPCM timpani for drive
# in the second half. 9 frames per row (a 16th), 64 rows (4 bars) per pattern.

sample timpd rate 12 events kick
sample timpa rate 12 events kick

song kaleido
  speed 9 9
  rows 64
  bar 16
  loop 0

# harpsichord: a bright pluck, a fast fall, then a long quiet ring (25% duty soprano, 50% alto)
inst h1
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  events lead
inst h1t                     # trill: starts on the upper note, ~13 notes a second
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp | 2 2 2 2 0 0 0 0
  events lead
inst h1s                     # trill (semitone)
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp | 1 1 1 1 0 0 0 0
  events lead
inst h1m                     # lower mordent (whole tone)
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp 0 0 0 -2 -2 -2 0
  events lead
inst h1n                     # lower mordent (semitone)
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp 0 0 0 -1 -1 -1 0
  events lead
inst h1u                     # upper mordent (whole tone)
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp 0 0 0 2 2 2 0
  events lead
inst h1v                     # upper mordent (semitone)
  env d2 13 d1 11 10 9 9 8 8 7 7 7 6 6 6 6 6 5 5 5 5 5 5 5 4 4 4 4 4 4 4 4 4 | 4 / 3 2 1 0
  arp 0 0 0 1 1 1 0
  events lead
inst h2
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
inst h2t
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp | 2 2 2 2 0 0 0 0
inst h2s
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp | 1 1 1 1 0 0 0 0
inst h2m
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp 0 0 0 -2 -2 -2 0
inst h2n
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp 0 0 0 -1 -1 -1 0
inst h2u
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp 0 0 0 2 2 2 0
inst h2v
  env d1 11 d2 9 8 8 7 7 7 6 6 6 5 5 5 5 5 4 4 4 4 4 4 4 3 3 3 3 3 3 3 3 | 3 / 2 1 0
  arp 0 0 0 1 1 1 0
# triangle: the envelope only gates it, so articulation is the note's sounding length in frames
inst t1                      # 16th: detached
  env 15*7 0
  events bass
inst t2                      # 8th: detached
  env 15*15 0
  events bass
inst tl                      # longer: held until the next note
  env 15 / 0
  events bass
inst tt                      # trilled bass note
  env 15 / 0
  arp | 2 2 2 2 0 0 0 0
  events bass
inst ts                      # trilled bass note (semitone)
  env 15 / 0
  arp | 1 1 1 1 0 0 0 0
  events bass
# noise: a soft, short "tambourine" tick
inst hat
  env 3 2 1 1 0
  events hat

drum hat hat 1
'''


_cur = {}


def emit_voice(ch, ev, key):
    toks = []
    cur_inst = _cur.get(ch)
    base = {'p1': 'h1', 'p2': 'h2', 'tri': None}[ch]
    for m, l, orn in ev:
        if l == 0:
            continue
        if m is None:
            toks.append(f'r{l}')
            continue
        okey = key
        if isinstance(orn, tuple):
            orn, okey = orn
        if ch == 'tri':
            if orn == '~':
                up = neighbour(m, okey, True) - m
                inst = 'tt' if up >= 2 else 'ts'
            else:
                inst = 't1' if l == 1 else 't2' if l == 2 else 'tl'
        else:
            inst = base
            if orn:
                up = neighbour(m, okey, True) - m
                dn = m - neighbour(m, okey, False)
                if orn == '~':
                    inst += 't' if up >= 2 else 's'
                elif orn == 'm':
                    inst += 'm' if dn >= 2 else 'n'
                elif orn == 'M':
                    inst += 'u' if up >= 2 else 'v'
        if inst != cur_inst:
            toks.append('@' + inst)
            cur_inst = inst
        o, pc = divmod(m, 12)
        toks.append(f'o{o - 1} {NAMES[pc].replace("#", "+")}{l}')
    _cur[ch] = cur_inst
    return ' '.join(toks)


def split(ev, n):
    """Split an event list into chunks of n rows (notes crossing a boundary become note + wait)."""
    out, cur, filled = [], [], 0
    for m, l, o in ev:
        while l > 0:
            k = min(l, n - filled)
            cur.append((m, k, o) if not (cur and cur[-1] == 'cont') else (m, k, o))
            l -= k
            filled += k
            if filled == n:
                out.append(cur)
                cur, filled = [], 0
                if l > 0:
                    # continuation of a held note into the next pattern: a wait
                    out_next = ('W', l)
                    cur.append((('W',), min(l, n), o))
                    filled = min(l, n)
                    l -= filled
                    if filled == n:
                        out.append(cur)
                        cur, filled = [], 0
    if cur:
        out.append(cur)
    return out


def drum_line(text, n):
    toks, total = [], 0
    for t in text.split():
        name, l = t.split(':')
        toks.append((name, int(l)))
        total += int(l)
    if total != n:
        raise SystemExit(f'drum line is {total} rows, expected {n}: {text[:40]}')
    return toks


def write_song(path):
    lines = [HEADER]
    order = []
    pat_i = 0
    for sec in sections:
        n = sec['bars'] * BAR
        chunks = {v: split(sec[v], ROWS) for v in ('p1', 'p2', 'tri')}
        nz = drum_line(sec['noise'], n) if sec['noise'] else [('r', n)]
        dm = drum_line(sec['dmc'], n) if sec['dmc'] else [('r', n)]
        npat = n // ROWS
        for k in range(npat):
            names = []
            for v in ('p1', 'p2', 'tri'):
                body = []
                _cur[v] = None
                for m, l, orn in chunks[v][k]:
                    if m == ('W',):
                        body.append(f'w{l}')
                    else:
                        body.append(emit_voice(v, [(m, l, orn)], sec['key']))
                txt = ' '.join(body)
                pname = f'{v}_{pat_i}'
                lines.append(f'pat {pname} {v}\n  {{vol 15}} {txt}')
                names.append(pname)
            for chn, seq in (('noise', nz), ('dmc', dm)):
                lo, hi = k * ROWS, (k + 1) * ROWS
                pos, toks = 0, []
                for name, l in seq:
                    a, b = max(pos, lo), min(pos + l, hi)
                    if a < b:
                        if a == pos:
                            toks.append(('r' if name == 'r' else name) + str(b - a))
                        else:
                            toks.append(f'w{b - a}')
                    pos += l
                if all(t.startswith('r') or t.startswith('w') for t in toks):
                    names.append('-')
                else:
                    pname = f'{chn}_{pat_i}'
                    pre = '{vol 15} ' if chn == 'noise' else ''
                    lines.append(f'pat {pname} {chn}\n  {pre}' + ' '.join(toks))
                    names.append(pname)
            order.append(f'  {sec["name"]}{k}: ' + ' '.join(names))
            pat_i += 1
    lines.append('order\n' + '\n'.join(order))
    Path(path).write_text('\n'.join(lines) + '\n')
    return pat_i


if __name__ == '__main__':
    probs = check(report=True)
    if '--check' not in sys.argv:
        n = write_song(HERE.parent / 'song.txt')
        print(f'wrote song.txt: {n} patterns', file=sys.stderr)


def piano_roll(path):
    """A picture of the score (soprano red, alto green, bass blue), one pixel per 16th."""
    import numpy as np
    from PIL import Image
    total = sum(sec['bars'] * BAR for sec in sections)
    img = np.zeros((90 * 3, total, 3), np.uint8)
    r0 = 0
    for sec in sections:
        n = sec['bars'] * BAR
        for v, col in (('p1', (255, 80, 80)), ('p2', (80, 255, 80)), ('tri', (90, 140, 255))):
            g, on = grid_of(sec[v], n)
            for i in range(n):
                if g[i] is not None:
                    y = (100 - g[i]) * 3
                    if 0 <= y < img.shape[0] - 2:
                        img[y:y + 2, r0 + i] = col if not on[i] else (255, 255, 255)
        img[:, r0] = (60, 60, 60)
        r0 += n
    Image.fromarray(img).save(path)
