#!/usr/bin/env python3
"""Compile nes/music/song.txt (the readable song format) into song.inc for music.s.

usage: compile.py [song.txt] [-o song.inc] [--json expected.json]
(nes/music/build.sh runs this, the DPCM generator and the test-ROM build.)

The JSON output lists, for every song, order and row, what each channel is meant to play
(MIDI note, instrument, drum, effects), which tools/verify.py compares against the rendered audio.

Song format (line based; '#' after whitespace starts a comment; indented lines belong to the block above)
  sample NAME rate R [events kick|snare|...]   DPCM sample dpcm_NAME (from dpcm.inc), DMC rate 0-15
  song NAME                                    starts a song; settings indented below:
    speed EVEN [ODD]   frames per even / odd row (odd differs = swing), at least 2
    rows N             rows per pattern;  bar N: rows per bar for the "|" check;  loop N: order to loop to
    ghost N            volume for ghost notes ("c4?")
  inst NAME            instrument (up to 31 per song), settings indented below:
    env  ...           volume per frame, 0-15; d0-d3 sets the pulse duty for the values after it;
                       "|" loop start, "/" key-off (release) part; v*n repeats; a>b:n ramps
    arp  ...           pitch offset per frame in semitones (-64..63), "|" loop; ends holding the last
    vib  DEPTH SPEED DELAY   vibrato (depth in period units, halved above ~880 Hz), after DELAY frames
    rate N             advance the envelopes every N frames
    events kick snare hat lead bass   music_events bits set on its note-ons
    noise short        metallic (93-step) noise mode
  drum NAME INST PERIOD                        a noise-channel drum: instrument + noise period (0-15)
  def NAME tokens...                           a phrase, inserted with $NAME
  pat NAME CHANNEL                             a pattern for p1, p2, tri, noise or dmc; tokens:
    c d e f g a b [#|+|-][LEN]   note (LEN in rows, default from lN); "'" staccato, "?" ghost
    r[LEN] key off   w[LEN] / _[LEN] wait (tie)   oN  >  <  octave   lN default length   tN transpose
    @INST   [ ... ]N repeat   $DEF   | bar check
    {arp XY} {slide N} {bend N} {vol N} {detune N} {echo DELAY LEVEL [oct]} {echo off}
    noise patterns use drum names, dmc patterns sample names (with optional LEN)
    triangle notes are written at the pitch they sound
  order                                        one line per pattern slot:
    LABEL: P1 P2 TRI NOISE DMC [TRANSPOSE]     pattern names, "-" for silence
"""
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

CHANNELS = ['p1', 'p2', 'tri', 'noise', 'dmc']
EVENT_BITS = {'kick': 4, 'snare': 8, 'hat': 16, 'lead': 32, 'bass': 64}
NOTE_BASE = {'p1': 33, 'p2': 33, 'tri': 21}   # MIDI note of note index 0 (A1 on pulse, A0 on triangle)
NOTE_NAMES = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}
FX = {'arp': 0xE0, 'slide': 0xE1, 'bend': 0xE2, 'vol': 0xE3, 'detune': 0xE4, 'echo': 0xE5, 'retrig': 0xE6, 'cue': 0xE7}
CPU = 1789773


class SongError(Exception):
    pass


def die(where, msg):
    raise SongError(f'{where}: {msg}')


# --------------------------------------------------------------------------- blocks
def read_blocks(text):
    """Split into top-level blocks: (keyword, args, [body lines], line number)."""
    blocks = []
    for n, raw in enumerate(text.splitlines(), 1):
        line = re.sub(r'(^|\s)#.*', '', raw).rstrip()   # '#' starts a comment only after whitespace (f# is a note)
        if not line.strip():
            continue
        if line[0] not in ' \t':
            parts = line.split()
            blocks.append([parts[0], parts[1:], [], n])
        else:
            if not blocks:
                die(f'line {n}', 'indented line outside a block')
            blocks[-1][2].append((n, line.strip()))
    return blocks


# --------------------------------------------------------------------------- envelopes
def parse_values(tokens, where, allow_duty):
    """Returns (values, loop index or None, release index or None). Values are (duty, v)."""
    vals, loop, rel, duty = [], None, None, 0
    for t in tokens:
        if t == '|':
            loop = len(vals)
        elif t == '/':
            rel = len(vals)
        elif allow_duty and re.fullmatch(r'd[0-3]', t):
            duty = int(t[1])
        elif m := re.fullmatch(r'(-?\d+)\*(\d+)', t):
            vals += [(duty, int(m[1]))] * int(m[2])
        elif m := re.fullmatch(r'(-?\d+)>(-?\d+):(\d+)', t):
            a, b, n = int(m[1]), int(m[2]), int(m[3])
            for i in range(n):
                vals.append((duty, round(a + (b - a) * i / max(1, n - 1))))
        elif re.fullmatch(r'-?\d+', t):
            vals.append((duty, int(t)))
        else:
            die(where, f'bad envelope token {t!r}')
    return vals, loop, rel


def encode_volenv(tokens, where):
    vals, loop, rel = parse_values(tokens, where, True)
    for d, v in vals:
        if not 0 <= v <= 15:
            die(where, f'volume {v} out of range')
    sus = vals if rel is None else vals[:rel]
    relv = [] if rel is None else vals[rel:]
    if not sus:
        die(where, 'envelope needs at least one value before "/"')
    if loop is not None and loop >= len(sus):
        die(where, 'loop point must be inside the sustain part')
    out = [d << 6 | v for d, v in sus]
    out += [0x10, loop if loop is not None else len(sus) - 1]
    if not relv:
        relv = [(sus[-1][0], 0)]
    relpos = len(out)
    out += [d << 6 | v for d, v in relv]
    out += [0x10, len(out) - 1]
    if len(out) > 255:
        die(where, 'envelope too long')
    return out, relpos


def encode_arpenv(tokens, where):
    vals, loop, rel = parse_values(tokens, where, False)
    if rel is not None:
        die(where, 'pitch envelopes have no release')
    if not vals:
        vals = [(0, 0)]
    for _, v in vals:
        if not -64 <= v <= 63:
            die(where, f'pitch offset {v} out of range')
    out = [v & 0xFF for _, v in vals]
    if loop is None and vals[-1][1] == 0:
        out[-1] = 0x81          # ends on 0: the driver stops reading it
    else:
        out += [0x80, loop if loop is not None else len(vals) - 1]
    return out


# --------------------------------------------------------------------------- patterns
TOKEN = re.compile(r'''
    \{[^}]*\} | \[ | \]\d* | \$\w+ | @\w+ | \|
  | [<>] | t[+-]\d+ | [a-g][#+-]\d*['?]* | \w+['?]*
''', re.X)


def tokenize(text, where):
    pos, toks = 0, []
    text = text.strip()
    while pos < len(text):
        if text[pos].isspace():
            pos += 1
            continue
        m = TOKEN.match(text, pos)
        if not m:
            die(where, f'cannot parse at {text[pos:pos+20]!r}')
        toks.append(m.group(0))
        pos = m.end()
    return toks


def expand(toks, defs, where, depth=0):
    """Expand $defs and [ ... ]n repeats."""
    if depth > 20:
        die(where, 'definitions nest too deeply')
    out, stack = [], [[]]
    for t in toks:
        if t == '[':
            stack.append([])
        elif t.startswith(']'):
            if len(stack) < 2:
                die(where, 'unbalanced ]')
            body = stack.pop()
            stack[-1] += body * int(t[1:] or 2)
        elif t.startswith('$'):
            name = t[1:]
            if name not in defs:
                die(where, f'unknown definition ${name}')
            stack[-1] += expand(defs[name], defs, where, depth + 1)
        else:
            stack[-1].append(t)
    if len(stack) != 1:
        die(where, 'unbalanced [')
    return stack[0]


class Song:
    def __init__(self, name):
        self.name = name
        self.speed = (6, 6)
        self.rows = 64
        self.bar = 16
        self.loop = 0
        self.ghost = 5
        # instrument 0 of every song is silent: channels use it until their first note
        self.insts = {'_silent': 0}
        self.inst_data = [{'name': '_silent', 'env': ['0'], 'arp': [], 'vib': (0, 0, 0), 'rate': 1,
                           'events': 0, 'flags': 0, 'where': 'builtin'}]
        self.drums = {}      # name -> (inst name, period)
        self.defs = {}
        self.pats = {}       # name -> (channel, tokens, where)
        self.orders = []     # (label, [pattern names], transpose)
        self.used_insts = {}  # channel -> set of instrument names used there
        self.used_fx = {}     # channel -> set of effects used there with a non-zero value


def compile_pattern(song, samples, name, ch, toks, where):
    """Returns (bytes, timeline). timeline: list of per-row events for the expected-notes JSON."""
    out = []
    timeline = []
    row, octave, length, transpose, dur_set = 0, 4, 4, 0, None
    inst_name, vol, ghost_on = None, 15, False
    fxstate = {'bend': 0, 'slide': 0, 'arp': 0}

    def emit_len(n):
        nonlocal dur_set
        if dur_set != n:
            out.append(0x80 | (n - 1))
            dur_set = n

    def emit_event(code, n, info):
        nonlocal row
        # notes longer than 64 rows become note + ties
        first = True
        while n > 0:
            k = min(n, 64)
            emit_len(k)
            out.append(code if first else 0x61)
            if first:
                timeline.append((row, info))
            first = False
            row += k
            n -= k

    for t in toks:
        if t.startswith('{'):
            parts = t[1:-1].split()
            if not parts:
                die(where, 'empty {}')
            fx, args = parts[0], parts[1:]
            if ch == 'dmc' and fx not in ('retrig', 'cue'):
                die(where, 'the dmc channel takes only {retrig N} and {cue N}')
            if fx == 'cue':
                out += [FX['cue'], int(args[0]) & 0xFF]
                timeline.append((row, ('cue', int(args[0]))))
            elif fx == 'retrig':
                if ch != 'dmc':
                    die(where, 'retrig is a dmc command')
                out += [FX['retrig'], int(args[0])]
                timeline.append((row, ('retrig', int(args[0]))))
            elif fx == 'arp':
                v = args[0] if args else '0'
                if v == '0':
                    val = 0
                elif re.fullmatch(r'[0-9a-fA-F]{2}', v):
                    val = int(v, 16)
                else:
                    die(where, 'arp takes two hex digits, e.g. {arp 47}')
                if val:
                    song.used_fx.setdefault(ch, set()).add('arp')
                fxstate['arp'] = val
                out += [FX['arp'], val]
            elif fx in ('slide', 'bend', 'detune'):
                v = int(args[0])
                if fx in fxstate:
                    fxstate[fx] = v
                if not -128 <= v <= 255:
                    die(where, f'{fx} {v} out of range')
                out += [FX[fx], v & 0xFF]
                if v:
                    song.used_fx.setdefault(ch, set()).add(fx)
            elif fx == 'vol':
                vol = int(args[0])
                if not 0 <= vol <= 15:
                    die(where, 'vol 0..15')
                out += [FX['vol'], vol << 4]
            elif fx == 'echo':
                if args and args[0] == 'off':
                    out += [FX['echo'], 0, 0, 0]
                else:
                    if ch != 'p2':
                        die(where, 'echo is a pulse 2 command')
                    delay, level = int(args[0]), int(args[1])
                    if not 0 <= delay <= 63 or not 1 <= level <= 15:
                        die(where, 'echo DELAY(0..63 frames) LEVEL(1..15) [oct]')
                    flags = 1 if 'oct' in args[2:] else 0
                    out += [FX['echo'], delay, flags, level << 4]
            else:
                die(where, f'unknown effect {fx}')
            continue
        if t == '|':
            if row % song.bar:
                die(where, f'bar check failed at row {row} (bar = {song.bar} rows)')
            continue
        if t.startswith('@'):
            if ch == 'dmc':
                die(where, 'no instruments on the dmc channel')
            inst_name = t[1:]
            if inst_name not in song.insts:
                die(where, f'unknown instrument {inst_name}')
            out.append(0xC0 | song.insts[inst_name])
            song.used_insts.setdefault(ch, set()).add(inst_name)
            continue
        if t in '<>':
            octave += 1 if t == '>' else -1
            continue
        if m := re.fullmatch(r'o(\d)', t):
            octave = int(m[1])
            continue
        if m := re.fullmatch(r'l(\d+)', t):
            length = int(m[1])
            continue
        if m := re.fullmatch(r't([+-]?\d+)', t):
            transpose = int(m[1])
            continue
        if m := re.fullmatch(r'([rw_])(\d*)', t):
            n = int(m[2]) if m[2] else length
            emit_event(0x60 if m[1] == 'r' else 0x61, n, None if m[1] != 'r' else ('off',))
            continue
        # a note (pitched channels) or a drum / sample name
        staccato = t.count("'")
        ghost = '?' in t
        t = t.rstrip("'?")
        if ch in ('p1', 'p2', 'tri'):
            m = re.fullmatch(r'([a-g])([#+-]?)(\d*)', t)
            if not m:
                die(where, f'bad note {t!r}')
            midi = 12 * (octave + 1) + NOTE_NAMES[m[1]] + {'#': 1, '+': 1, '-': -1, '': 0}[m[2]] + transpose
            n = int(m[3]) if m[3] else length
            idx = midi - NOTE_BASE[ch]
            if not 0 <= idx <= 95:
                die(where, f'note {t} (MIDI {midi}) out of range for {ch}')
            if inst_name is None:
                die(where, 'note before any instrument')
            code, info = idx, ('note', midi, inst_name, dict(fxstate))
        elif ch == 'noise':
            m = re.fullmatch(r'([A-Za-z_]\w*?)(\d*)', t)
            if not m or m[1] not in song.drums:
                die(where, f'unknown drum {t!r}')
            dname = m[1]
            n = int(m[2]) if m[2] else length
            di, period = song.drums[dname]
            if di != inst_name:
                out.append(0xC0 | song.insts[di])
                song.used_insts.setdefault(ch, set()).add(di)
                inst_name = di
            code, info = period, ('drum', dname)
        else:  # dmc
            m = re.fullmatch(r'([A-Za-z_]\w*?)(\d*)', t)
            if not m or m[1] not in samples:
                die(where, f'unknown sample {t!r}')
            n = int(m[2]) if m[2] else length
            code, info = samples[m[1]]['index'], ('sample', m[1])
        restore = None
        if ghost:
            out += [FX['vol'], song.ghost << 4]
            restore = vol
        if staccato:
            on = max(1, n // (2 * staccato))
            emit_event(code, on, info)
            if n - on:
                emit_event(0x60, n - on, ('off',))
        else:
            emit_event(code, n, info)
        if restore is not None:
            out += [FX['vol'], restore << 4]
    if row != song.rows:
        die(where, f'pattern {name} is {row} rows long, expected {song.rows}')
    return out, timeline


# --------------------------------------------------------------------------- optimiser
INIT_STATE = (('dur', 0), ('inst', 0), (0xE0, 0), (0xE1, 0), (0xE2, 0), (0xE3, 0xF0), (0xE4, 0), (0xE6, 0),
              (0xE5, (0, 0, 0)))


def walk(b):
    """Yield (offset, length, key, value) for each byte-code item; key None for notes/rests."""
    i = 0
    while i < len(b):
        c = b[i]
        if c < 0x80:
            yield i, 1, None, None
            i += 1
        elif c < 0xC0:
            yield i, 1, 'dur', c & 0x3F
            i += 1
        elif c < 0xE0:
            yield i, 1, 'inst', c & 0x1F
            i += 1
        elif c == 0xE5:
            yield i, 4, c, tuple(b[i + 1:i + 4])
            i += 4
        else:
            yield i, 2, c, b[i + 1]
            i += 2


def run_state(b, state):
    """Channel state after the pattern. Commands after its last event never run (the next pattern
    starts from its own pointer), so they do not count."""
    st, pend = dict(state), {}
    for _, _, k, v in walk(b):
        if k is None:
            st.update(pend)
            pend = {}
        elif k != 0xE7:
            pend[k] = v
    return tuple(sorted(st.items(), key=lambda kv: str(kv[0])))


def strip_redundant(pat_bytes, ord_rows, song_rows):
    """Drop commands that cannot change the channel's state, given every state the channel can be in
    when the pattern starts (the order list is simulated, including the loop). This keeps pattern-start
    frames cheap: the source can restate {vol}, {slide}, @inst etc. at the top of every pattern."""
    entry = {}  # (pattern index, channel) -> set of states
    for start, end, loop, *_ in song_rows:
        states = [tuple(sorted(dict(INIT_STATE).items(), key=lambda kv: str(kv[0])))] * 5
        seen = set()
        o = start
        while (o, states_key := tuple(states)) not in seen:
            seen.add((o, states_key))
            row, _ = ord_rows[o]
            for ch in range(5):
                entry.setdefault((row[ch], ch), set()).add(states[ch])
                states[ch] = run_state(pat_bytes[row[ch]], states[ch])
            o = o + 1 if o + 1 < end else loop
    new_index = {}
    out_bytes = []
    remap = {}
    for (pi, ch), sts in sorted(entry.items()):
        b = pat_bytes[pi]
        cur = [dict(s) for s in sts]
        keep = []
        for off, ln, k, v in walk(b):
            if k is not None and k != 0xE7:
                if all(c[k] == v for c in cur):
                    continue
                for c in cur:
                    c[k] = v
            keep += b[off:off + ln]
        key = bytes(keep)
        if key not in new_index:
            new_index[key] = len(out_bytes)
            out_bytes.append(keep)
        remap[(pi, ch)] = new_index[key]
    rows = [([remap[(r[c], c)] for c in range(5)], tr) for r, tr in ord_rows]
    return out_bytes, rows


# --------------------------------------------------------------------------- main
def compile_file(src):
    blocks = read_blocks(Path(src).read_text())
    songs, samples = [], {}
    song = None
    for kw, args, body, n in blocks:
        where = f'{src}:{n}'
        if kw == 'sample':
            # sample NAME rate R [events ...]
            name = args[0]
            opts = dict(zip(args[1::2], args[2::2]))
            ev = 0
            for e in args[args.index('events') + 1:] if 'events' in args else []:
                ev |= EVENT_BITS[e]
            samples[name] = {'index': len(samples), 'rate': int(opts.get('rate', 15)), 'events': ev,
                             'data': opts.get('data', name)}
            continue
        if kw == 'song':
            song = Song(args[0])
            songs.append(song)
            for ln, line in body:
                p = line.split()
                if p[0] == 'speed':
                    g = [int(x) for x in p[1:5]]
                    song.speed = tuple((g * 4)[:4]) if len(g) in (1, 2, 4) else die(f'{src}:{ln}', 'speed takes 1, 2 or 4 values')
                    if min(song.speed) < 2:
                        die(f'{src}:{ln}', 'rows must last at least 2 frames')
                elif p[0] in ('rows', 'bar', 'loop', 'ghost'):
                    setattr(song, p[0], int(p[1]))
                else:
                    die(f'{src}:{ln}', f'unknown song setting {p[0]}')
            continue
        if song is None:
            die(where, f'{kw} before any song')
        if kw == 'inst':
            name = args[0]
            if name in song.insts:
                die(where, f'duplicate instrument {name}')
            d = {'name': name, 'env': ['15'], 'arp': [], 'vib': (0, 0, 0), 'rate': 1, 'events': 0, 'flags': 0}
            for ln, line in body:
                p = line.split()
                if p[0] == 'env':
                    d['env'] = p[1:]
                elif p[0] == 'arp':
                    d['arp'] = p[1:]
                elif p[0] == 'vib':
                    d['vib'] = tuple(int(x) for x in p[1:4])
                elif p[0] == 'rate':
                    d['rate'] = int(p[1])
                elif p[0] == 'events':
                    for e in p[1:]:
                        d['events'] |= EVENT_BITS[e]
                elif p[0] == 'noise' and p[1] == 'short':
                    d['flags'] |= 0x80
                else:
                    die(f'{src}:{ln}', f'unknown instrument setting {p[0]}')
            d['where'] = where
            song.insts[name] = len(song.inst_data)
            song.inst_data.append(d)
            if len(song.inst_data) > 32:
                die(where, 'at most 32 instruments per song')
        elif kw == 'drum':
            # drum NAME INST PERIOD
            song.drums[args[0]] = (args[1], int(args[2]))
        elif kw == 'def':
            song.defs[args[0]] = tokenize(' '.join(args[1:] + [l for _, l in body]), where)
        elif kw == 'pat':
            name, ch = args[0], args[1]
            if ch not in CHANNELS:
                die(where, f'unknown channel {ch}')
            song.pats[name] = (ch, tokenize(' '.join(l for _, l in body), where), where)
        elif kw == 'order':
            for ln, line in body:
                m = re.fullmatch(r'(\S+):\s+(.*)', line)
                if not m:
                    die(f'{src}:{ln}', 'order line is "label: p1 p2 tri noise dmc [+transpose]"')
                p = m[2].split()
                tr = 0
                if len(p) == 6:
                    tr = int(p.pop())
                if len(p) != 5:
                    die(f'{src}:{ln}', 'order line needs 5 patterns')
                song.orders.append((m[1], p, tr, f'{src}:{ln}'))
        else:
            die(where, f'unknown block {kw}')

    # ---- compile
    pat_bytes, pat_index = [], {}
    def intern(b):
        key = bytes(b)
        if key not in pat_index:
            pat_index[key] = len(pat_bytes)
            pat_bytes.append(b)
        return pat_index[key]

    insts_all, ord_rows, song_rows, expected = [], [], [], {}
    for s in songs:
        base = len(insts_all)
        for d in s.inst_data:
            env, rel = encode_volenv(d['env'], d['where'])
            arp = encode_arpenv(d['arp'], d['where'])
            depth, speed, delay = d['vib']
            if not 0 <= depth <= 7:
                die(d['where'], 'vibrato depth 0..7')
            insts_all.append(dict(d, envb=env, rel=rel, arpb=arp, depth=depth, speed=speed, delay=delay))
        compiled = {}
        for pname, (ch, toks, where) in s.pats.items():
            b, tl = compile_pattern(s, samples, pname, ch, expand(toks, s.defs, where), where)
            compiled[pname] = (ch, intern(b), tl)
        # "-" in the order list: key off and stay silent for the whole pattern
        empty = intern([0x80 | (s.rows - 1), 0x60] if s.rows <= 64 else
                       [0xBF, 0x60] + [0x61] * (s.rows // 64 - 1) + ([0x80 | (s.rows % 64 - 1), 0x61] if s.rows % 64 else []))
        start = len(ord_rows)
        exp_orders = []
        for label, pats, tr, where in s.orders:
            row = []
            exp = {'label': label, 'transpose': tr, 'channels': {}}
            for ch, pn in zip(CHANNELS, pats):
                if pn == '-':
                    row.append(empty)
                    exp['channels'][ch] = []
                    continue
                if pn not in compiled:
                    die(where, f'unknown pattern {pn}')
                pch, idx, tl = compiled[pn]
                if pch != ch:
                    die(where, f'pattern {pn} is for {pch}, used on {ch}')
                row.append(idx)
                exp['channels'][ch] = [[r] + list(info) if info else [r] for r, info in tl]
            ord_rows.append((row, tr))
            exp_orders.append(exp)
        if s.rows > 255:
            die(src, 'at most 255 rows per pattern')
        if not s.orders:
            die(src, f'song {s.name} has no orders')
        if not 0 <= s.loop < len(s.orders):
            die(src, f'song {s.name}: loop order out of range')
        song_rows.append((start, len(ord_rows), start + s.loop, s.rows, s.speed, base))
        expected[s.name] = {'speed': s.speed, 'rows': s.rows, 'loop': s.loop, 'orders': exp_orders,
                            'inst_events': {d['name']: d['events'] for d in s.inst_data},
                            'inst_env': {d['name']: d['env'] for d in s.inst_data},
                            'inst_has_arp': {d['name']: bool(d['arp']) for d in s.inst_data},
                            'drums': {k: list(v) for k, v in s.drums.items()},
                            'sample_events': {k: v['events'] for k, v in samples.items()},
                            'groove': list(s.speed),
                            'frames_per_pattern': sum(s.speed) * s.rows // 4}
    pat_bytes, ord_rows = strip_redundant(pat_bytes, ord_rows, song_rows)
    if len(insts_all) > 256 or len(pat_bytes) > 256 or len(ord_rows) > 255:
        die(src, 'too many instruments, patterns or orders')

    # ---- emit
    L = ['; Generated by nes/music/tools/compile.py from song.txt. Do not edit.', '']
    def table(name, vals):
        L.append(f'{name}:')
        for i in range(0, len(vals), 16):
            L.append('  .byte ' + ', '.join(str(v) for v in vals[i:i + 16]))
        if not vals:
            L.append('  ; (empty)')

    L.append(f'SONG_COUNT = {len(songs)}')
    # Which effects each channel can need, over all songs: music.s leaves out the code for the rest,
    # which keeps the worst-case frame cheap.
    L.append('; per-channel feature flags (0 p1, 1 p2, 2 tri, 3 noise)')
    for c, ch in enumerate(CHANNELS[:4]):
        fx = set().union(*[s.used_fx.get(ch, set()) for s in songs])
        ins = [d for s in songs for d in s.inst_data if d['name'] in s.used_insts.get(ch, set())]
        feats = {'SLIDE': 'slide' in fx, 'BEND': 'bend' in fx, 'DETUNE': 'detune' in fx, 'ARP': 'arp' in fx,
                 'VIB': any(d['vib'][0] for d in ins), 'ARPENV': any(d['arp'] for d in ins),
                 'RATE': any(d['rate'] > 1 for d in ins)}
        for k, v in feats.items():
            L.append(f'F_{k}{c} = {int(v)}')
    for name, i in (('song_ord_start', 0), ('song_ord_end', 1), ('song_loop', 2), ('song_rows', 3)):
        table(name, [r[i] for r in song_rows])
    for k in range(4):
        table(f'song_speed{k}', [r[4][k] for r in song_rows])
    table('song_inst_base', [r[5] for r in song_rows])
    for c in range(5):
        table(f'ord_ch{c}', [r[0][c] for r in ord_rows])
    table('ord_tr', [r[1] & 0xFF for r in ord_rows])
    L.append('pat_lo:')
    L += [f'  .byte <pat{i}' for i in range(len(pat_bytes))]
    L.append('pat_hi:')
    L += [f'  .byte >pat{i}' for i in range(len(pat_bytes))]
    for i, b in enumerate(pat_bytes):
        table(f'pat{i}', b)
    # instruments (shared zero pitch envelope)
    for i, d in enumerate(insts_all):
        table(f'ienv{i}', d['envb'])
        if d['arp']:
            table(f'iarp{i}', d['arpb'])
    L.append('inst_env_lo:'); L += [f'  .byte <ienv{i}' for i in range(len(insts_all))]
    L.append('inst_env_hi:'); L += [f'  .byte >ienv{i}' for i in range(len(insts_all))]
    L.append('inst_arp_lo:'); L += [f'  .byte {"<iarp%d" % i if d["arp"] else 0}' for i, d in enumerate(insts_all)]
    L.append('inst_arp_hi:'); L += [f'  .byte {">iarp%d" % i if d["arp"] else 0}' for i, d in enumerate(insts_all)]
    table('inst_rel', [d['rel'] for d in insts_all])
    table('inst_rate', [max(0, d['rate'] - 1) for d in insts_all])
    table('inst_events', [d['events'] for d in insts_all])
    table('inst_flags', [d['flags'] for d in insts_all])
    table('inst_vibdepth', [d['depth'] << 4 for d in insts_all])
    table('inst_vibspeed', [d['speed'] for d in insts_all])
    table('inst_vibdelay', [d['delay'] for d in insts_all])
    # vibrato: depth d (period units), 16 phases of a sine
    vib = []
    for dep in range(8):
        vib += [round(dep * math.sin(2 * math.pi * (p + 0.5) / 16)) & 0xFF for p in range(16)]
    table('vibtab', vib)
    # period table: index i = MIDI 33 + i on the pulses (the triangle sounds an octave lower)
    per = []
    for i in range(96):
        f = 440 * 2 ** ((33 + i - 69) / 12)
        per.append(max(8, min(0x7FF, round(CPU / (16 * f)) - 1)))
    table('ptab_lo', [p & 0xFF for p in per])
    table('ptab_hi', [p >> 8 for p in per])
    # samples
    names = sorted(samples, key=lambda k: samples[k]['index'])
    table('smp_rate', [samples[k]['rate'] for k in names])
    d_ = lambda k: samples[k]['data']
    L.append('smp_addr:'); L += [f'  .byte <((dpcm_{d_(k)} - $C000) >> 6)' for k in names]
    L.append('smp_len:'); L += [f'  .byte <((dpcm_{d_(k)}_end - dpcm_{d_(k)} - 1) >> 4)' for k in names]
    table('smp_events', [samples[k]['events'] for k in names])
    if not names:
        L.append('dpcm_dummy = 0')
    size = sum(len(b) for b in pat_bytes) + sum(len(d['envb']) + len(d['arpb']) for d in insts_all)
    return '\n'.join(L) + '\n', expected, size, len(pat_bytes)


def main():
    args = sys.argv[1:]
    src = ROOT / 'song.txt'
    out = ROOT / 'song.inc'
    js = None
    i = 0
    while i < len(args):
        if args[i] == '-o':
            out = Path(args[i + 1]); i += 2
        elif args[i] == '--json':
            js = Path(args[i + 1]); i += 2
        else:
            src = Path(args[i]); i += 1
    try:
        inc, expected, size, npat = compile_file(src)
    except SongError as e:
        print('error:', e, file=sys.stderr)
        sys.exit(1)
    Path(out).write_text(inc)
    if js:
        Path(js).write_text(json.dumps(expected))
    print(f'{out}: {len(expected)} song(s), {npat} unique patterns, ~{size} bytes of pattern/instrument data')


if __name__ == '__main__':
    main()
