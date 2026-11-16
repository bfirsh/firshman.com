// Phosphor: an XY oscilloscope you tune like a radio.
// Two oscillators drive X and Y. Integer frequency pairs close into stable
// Lissajous figures; a dozen of them are "stations", where the beam locks
// and writes part of the site instead.

import { Scope } from './scope';
import { PHOSPHORS } from './phosphors';
import { STATIONS, buildTable, sampleTable } from './stations';
import { text } from './font';
import { BeamAudio } from './audio';

const TAU = Math.PI * 2;
const AMP = 0.7;
const MT = 8192; // samples per station loop

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- knobs
type KnobOpts = { min: number; max: number; wrap?: boolean; detent?: boolean; sens: number; wheel: number; step: number; big: number; fmt: (v: number) => string };

class Knob {
  el: HTMLElement;
  out: HTMLElement | null;
  o: KnobOpts;
  raw: number; val: number;
  vel = 0;
  drag = false;
  target: number | null = null;
  touched = false;
  lastDet: number;
  onDetent: (() => void) | null = null;
  onTouch: (() => void) | null = null;
  reduce: boolean;

  constructor(el: HTMLElement, v: number, o: KnobOpts, reduce: boolean) {
    this.el = el;
    this.o = o;
    this.raw = this.val = v;
    this.lastDet = Math.round(v);
    this.reduce = reduce;
    this.out = document.getElementById(el.id + '-v');
    this.bind();
    this.render();
  }

  private clampRaw() {
    if (!this.o.wrap) {
      if (this.raw < this.o.min) { this.raw = this.o.min; this.vel = 0; }
      if (this.raw > this.o.max) { this.raw = this.o.max; this.vel = 0; }
    }
  }

  nudge(d: number) {
    this.touch();
    this.target = null;
    this.raw += d;
    this.clampRaw();
  }

  step(dir: number, big = false) {
    this.touch();
    const s = big ? this.o.big : this.o.step;
    const base = this.target ?? this.raw;
    let t = Math.round(base / s) * s + dir * s;
    if (Math.abs(Math.round(base / s) * s - base) > s * 0.4) t = dir > 0 ? Math.ceil(base / s) * s : Math.floor(base / s) * s;
    if (!this.o.wrap) t = clamp(t, this.o.min, this.o.max);
    this.vel = 0;
    this.target = t;
  }

  tuneTo(v: number) { this.vel = 0; this.target = v; }

  touch() {
    if (!this.touched) { this.touched = true; this.onTouch?.(); }
  }

  private bind() {
    const el = this.el;
    let lx = 0, ly = 0, lt = 0;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.focus({ preventScroll: true });
      this.drag = true; this.vel = 0; this.target = null;
      lx = e.clientX; ly = e.clientY; lt = performance.now();
      this.touch();
      el.classList.add('grab');
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const now = performance.now();
      const d = ((e.clientX - lx) - (e.clientY - ly)) * this.o.sens;
      lx = e.clientX; ly = e.clientY;
      this.raw += d;
      this.clampRaw();
      const dtm = Math.max(1, now - lt) / 1000;
      lt = now;
      this.vel = this.vel * 0.6 + (d / dtm) * 0.4;
    });
    const end = () => {
      if (!this.drag) return;
      this.drag = false;
      el.classList.remove('grab');
      if (performance.now() - lt > 80 || this.reduce) this.vel = 0;
      this.vel = clamp(this.vel, -this.o.sens * 2400, this.o.sens * 2400);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.nudge(-clamp(dy, -120, 120) * this.o.wheel);
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') this.step(1, e.shiftKey);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') this.step(-1, e.shiftKey);
      else if (k === 'PageUp') this.step(1, true);
      else if (k === 'PageDown') this.step(-1, true);
      else if (k === 'Home' && !this.o.wrap) { this.touch(); this.target = this.o.min; }
      else if (k === 'End' && !this.o.wrap) { this.touch(); this.target = this.o.max; }
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  update(dt: number) {
    if (!this.drag) {
      if (this.target !== null) {
        const k = this.reduce ? 1 : 1 - Math.exp(-dt * 9);
        this.raw += (this.target - this.raw) * k;
        if (Math.abs(this.target - this.raw) < 1e-4) { this.raw = this.target; this.target = null; }
      } else if (Math.abs(this.vel) > 0.15 * this.o.sens * 46) {
        this.raw += this.vel * dt;
        this.vel *= Math.exp(-dt * 4.5);
        this.clampRaw();
      } else if (this.o.detent) {
        this.vel = 0;
        const n = Math.round(this.raw);
        if (Math.abs(this.raw - n) < 0.22) this.raw += (n - this.raw) * (1 - Math.exp(-dt * 10));
      }
    }
    // detent warp: a flat notch around every integer
    let v = this.raw;
    if (this.o.detent) {
      const n = Math.round(v), d = v - n, w = 0.06;
      v = n + Math.sign(d) * Math.max(0, Math.abs(d) - w) * (0.5 / (0.5 - w));
      const det = Math.round(v);
      if (det !== this.lastDet && Math.abs(v - det) < 0.02) { this.lastDet = det; this.onDetent?.(); }
    }
    this.val = v;
    this.render();
  }

  render() {
    const o = this.o;
    const ang = o.wrap ? (this.val * 180) / Math.PI : -135 + ((this.val - o.min) / (o.max - o.min)) * 270;
    this.el.style.setProperty('--rot', ang.toFixed(2) + 'deg');
    const txt = o.fmt(this.val);
    if (this.out && this.out.textContent !== txt) this.out.textContent = txt;
    this.el.setAttribute('aria-valuenow', (o.wrap ? ((((this.val * 180) / Math.PI) % 360) + 360) % 360 : this.val).toFixed(2));
    this.el.setAttribute('aria-valuetext', txt);
  }
}

// ---------------------------------------------------------------- layout of stations
type Placed = { i: number; a: number; b: number };

function layout(rnd: () => number) {
  const presets = [
    { a: 3, b: 2, m: 0, ph: 0.6 }, { a: 3, b: 4, m: 0, ph: 0.3 }, { a: 1, b: 1, m: 5, ph: Math.PI / 2 },
    { a: 5, b: 4, m: 0, ph: 0.2 }, { a: 2, b: 3, m: 0, ph: 1.1 }, { a: 4, b: 4, m: 1, ph: Math.PI / 2 },
    { a: 1, b: 1, m: 3, ph: Math.PI / 2 }, { a: 5, b: 6, m: 0, ph: 0.4 }, { a: 2, b: 5, m: 0, ph: 0.9 },
    { a: 6, b: 6, m: 1, ph: Math.PI / 2 }, { a: 3, b: 5, m: 0, ph: 0.5 }, { a: 4, b: 3, m: 2, ph: 0.2 },
  ];
  const start = presets[Math.floor(rnd() * presets.length)];
  for (let tries = 0; tries < 400; tries++) {
    const placed: Placed[] = [];
    // the name sits one notch away from where the scope starts
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [start.a + dx, start.b + dy])
      .filter(([a, b]) => a >= 1 && a <= 8 && b >= 1 && b <= 8);
    const [na, nbb] = nb[Math.floor(rnd() * nb.length)];
    placed.push({ i: 0, a: na, b: nbb });
    let ok = true;
    for (let i = 1; i < STATIONS.length && ok; i++) {
      let found = false;
      for (let k = 0; k < 200; k++) {
        const a = 1 + Math.floor(rnd() * 8), b = 1 + Math.floor(rnd() * 8);
        if (a === start.a && b === start.b) continue;
        if (placed.some((p) => Math.max(Math.abs(p.a - a), Math.abs(p.b - b)) < 2)) continue;
        placed.push({ i, a, b });
        found = true;
        break;
      }
      ok = found;
    }
    if (ok) return { start, placed };
  }
  // deterministic fallback (never expected)
  return { start, placed: STATIONS.map((_, i) => ({ i, a: 1 + (i % 4) * 2, b: 1 + Math.floor(i / 4) * 2 + (i % 2) })) };
}

// ---------------------------------------------------------------- start
export function start(): boolean {
  const root = document.documentElement;
  const seed = +(root.dataset.seed || 1);
  const ph = PHOSPHORS[+(root.dataset.ph || 0)] ?? PHOSPHORS[0];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = mulberry32(seed * 7919 + 17);
  const canvas = document.getElementById('crt') as HTMLCanvasElement;

  let scope: Scope;
  try { scope = new Scope(canvas, ph); } catch (e) { console.warn('phosphor: no WebGL2', e); return false; }

  const { start: st0, placed } = layout(rnd);
  const byStation = new Map(placed.map((p) => [p.i, p]));
  const tables = STATIONS.map((s) => buildTable(s.draw(), MT));

  // knobs
  const fmtF = (v: number) => v.toFixed(2);
  const kx = new Knob(document.getElementById('k-x')!, st0.a, { min: 1, max: 8, detent: true, sens: 1 / 46, wheel: 0.0025, step: 0.25, big: 1, fmt: fmtF }, reduce);
  const ky = new Knob(document.getElementById('k-y')!, st0.b, { min: 1, max: 8, detent: true, sens: 1 / 46, wheel: 0.0025, step: 0.25, big: 1, fmt: fmtF }, reduce);
  const kp = new Knob(document.getElementById('k-p')!, st0.ph + rnd() * 0.5, { min: 0, max: TAU, wrap: true, sens: 0.028, wheel: 0.0035, step: Math.PI / 24, big: Math.PI / 4, fmt: (v) => String(Math.round(((((v * 180) / Math.PI) % 360) + 360) % 360)).padStart(3, '0') + '°' }, reduce);
  const km = new Knob(document.getElementById('k-m')!, st0.m, { min: 0, max: 8, detent: true, sens: 1 / 46, wheel: 0.0025, step: 0.25, big: 1, fmt: (v) => v.toFixed(2) }, reduce);
  const kf = new Knob(document.getElementById('k-f')!, 0.3, { min: 0, max: 1, sens: 1 / 180, wheel: 0.0008, step: 0.05, big: 0.25, fmt: (v) => Math.round(v * 100) + '' }, reduce);
  const kq = new Knob(document.getElementById('k-q')!, 0.5, { min: 0, max: 1, sens: 1 / 180, wheel: 0.0008, step: 0.05, big: 0.25, fmt: (v) => Math.round(v * 100) + '' }, reduce);
  const knobs = [kx, ky, kp, km, kf, kq];

  // UI bits
  const hint = document.getElementById('hint');
  const eye = document.getElementById('eye')!;
  const count = document.getElementById('count')!;
  const caps = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('.cap[data-s]').forEach((el) => caps.set(el.dataset.s!, el));
  const marks = new Map<string, HTMLButtonElement>();
  document.querySelectorAll<HTMLButtonElement>('.dial [data-s]').forEach((el) => marks.set(el.dataset.s!, el));
  const soundBtn = document.getElementById('sound') as HTMLButtonElement;
  const audio = BeamAudio.supported() ? new BeamAudio(tables.map((t) => t.table), MT) : null;
  if (!audio) soundBtn.hidden = true;

  let interacted = false;
  const firstTouch = () => {
    if (interacted) return;
    interacted = true;
    hint?.classList.add('gone');
  };
  knobs.forEach((k) => (k.onTouch = firstTouch));
  [kx, ky, km].forEach((k) => (k.onDetent = () => {
    audio?.tick(0.35, k === km ? 0.8 : 1);
    k.el.classList.remove('bump'); void k.el.offsetWidth; k.el.classList.add('bump');
  }));
  // touching the phase knob stops the free-running drift
  let drift = 0, drifting = !reduce;
  kp.onTouch = () => { firstTouch(); drifting = false; };

  // the screen is an XY pad: drag to tune both oscillators at once
  const pad = document.getElementById('screen')!;
  {
    let lx = 0, ly = 0, lt = 0, on = false, vx = 0, vy = 0;
    pad.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('a,button')) return;
      on = true; pad.setPointerCapture(e.pointerId);
      lx = e.clientX; ly = e.clientY; lt = performance.now(); vx = vy = 0;
      kx.drag = ky.drag = true; kx.vel = ky.vel = 0; kx.target = ky.target = null;
      kx.touch(); ky.touch();
      pad.classList.add('grab');
    });
    pad.addEventListener('pointermove', (e) => {
      if (!on) return;
      const r = pad.getBoundingClientRect();
      const s = 3.2 / r.width;
      const dx = (e.clientX - lx) * s, dy = -(e.clientY - ly) * s;
      lx = e.clientX; ly = e.clientY;
      const now = performance.now(), dtm = Math.max(1, now - lt) / 1000; lt = now;
      kx.raw = clamp(kx.raw + dx, 1, 8); ky.raw = clamp(ky.raw + dy, 1, 8);
      vx = vx * 0.6 + (dx / dtm) * 0.4; vy = vy * 0.6 + (dy / dtm) * 0.4;
    });
    const end = () => {
      if (!on) return;
      on = false; kx.drag = ky.drag = false;
      pad.classList.remove('grab');
      const still = performance.now() - lt > 80 || reduce;
      kx.vel = still ? 0 : clamp(vx, -5, 5); ky.vel = still ? 0 : clamp(vy, -5, 5);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      kp.nudge(-clamp(dy, -120, 120) * 0.0035);
      if (e.deltaX) km.nudge(clamp(e.deltaX, -120, 120) * 0.002);
    }, { passive: false });
  }

  // keyboard anywhere: arrows tune X and Y, , . phase, [ ] modulation
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (t && (t.closest('.knob') || t.closest('#read-panel.open') || t.tagName === 'INPUT')) return;
    if (document.getElementById('read-panel')?.classList.contains('open')) return;
    const map: Record<string, [Knob, number]> = {
      ArrowRight: [kx, 1], ArrowLeft: [kx, -1], ArrowUp: [ky, 1], ArrowDown: [ky, -1],
      '.': [kp, 1], ',': [kp, -1], ']': [km, 1], '[': [km, -1],
    };
    const m = map[e.key];
    if (!m) return;
    e.preventDefault();
    m[0].step(m[1], e.shiftKey);
  });

  // dial: found stations can be re-tuned with a click
  marks.forEach((el, id) => {
    el.addEventListener('click', () => {
      const i = STATIONS.findIndex((s) => s.id === id);
      const p = byStation.get(i);
      if (!p || !found.has(id)) return;
      firstTouch();
      kx.tuneTo(p.a); ky.tuneTo(p.b);
    });
  });

  soundBtn.addEventListener('click', async () => {
    const on = soundBtn.getAttribute('aria-pressed') !== 'true';
    soundBtn.setAttribute('aria-pressed', String(on));
    firstTouch();
    try { await audio?.toggle(on); } catch (e) { console.warn('phosphor: audio', e); soundBtn.setAttribute('aria-pressed', 'false'); }
  });

  // ------------------------------------------------------------ tuning state
  const found = new Set<string>();
  let locked = -1, near = -1, dwell = 0;
  let k = 0, kv = 0; // morph amount and its velocity (a little spring)
  let flash = 0, power = reduce ? 1 : 0;
  let capTimer = 0;

  function showCap(id: string | null) {
    caps.forEach((el, key) => {
      const on = key === id;
      el.classList.toggle('on', on);
      el.toggleAttribute('inert', !on);
      el.setAttribute('aria-hidden', String(!on));
    });
  }

  function onLock(i: number) {
    const s = STATIONS[i];
    const p = byStation.get(i)!;
    flash = 1;
    audio?.tick(1, 0.55);
    const first = !found.has(s.id);
    found.add(s.id);
    const mk = marks.get(s.id);
    if (mk) {
      mk.classList.add('found');
      mk.disabled = false;
      mk.setAttribute('aria-label', `${s.label}, at ${p.a}:${p.b}`);
      mk.title = `${s.label} · ${p.a}:${p.b}`;
    }
    marks.forEach((el, id) => el.classList.toggle('here', id === s.id));
    count.textContent = `${found.size}/${STATIONS.length}`;
    const cap = caps.get(s.id);
    const kEl = cap?.querySelector('.cap-k');
    if (kEl) kEl.textContent = `${String(i + 1).padStart(2, '0')} · ${p.a}:${p.b}`;
    showCap(s.id);
    clearTimeout(capTimer);
    if (first && found.size === STATIONS.length) document.body.classList.add('complete');
  }

  // ------------------------------------------------------------ beam buffers
  const small = () => canvas.clientWidth < 520;
  const baseN = () => (small() ? 1800 : 2800);
  let N = baseN();
  let pts = new Float32Array((N + 1) * 3);
  const zs = new Float32Array(N + 1);
  const ro = new Float32Array(4000 * 3);
  const theta = { t0: 0, tx: 0, ty: 0, tm: 0 };
  let prev = { a: kx.val, b: ky.val, ph: kp.val, m: km.val, k: 0, f: 5, amp: 0 };
  let lastPx: [number, number] | null = null;
  const tmp = [0, 0, 0];
  let jitterSeed = 1;
  const gauss = () => { jitterSeed = (jitterSeed * 16807) % 2147483647; return jitterSeed / 2147483647 - 0.5; };

  function readout(W: number, H: number, cssW: number, dt: number) {
    const scale = W / 2;
    const h = 8 / (cssW / 2); // ~8 css px cap height
    const x0 = -0.95, y0 = -0.8 + h * 1.1;
    const deg = String(Math.round(((((kp.val * 180) / Math.PI) % 360) + 360) % 360)).padStart(3, '0');
    const left = `X ${kx.val.toFixed(2)}  Y ${ky.val.toFixed(2)}`;
    const right = locked >= 0 ? `LOCK ${byStation.get(locked)!.a}:${byStation.get(locked)!.b}` : `PH ${deg}  MOD ${km.val.toFixed(1)}`;
    const strokes = [...text(left, x0, y0, h, 'left'), ...text(right, -x0, y0, h, 'right')];
    const rho = 0.055 * (dt * 60);
    let n = 0;
    for (const s of strokes) {
      for (let j = 0; j < s.length && n < 3990; j++) {
        const x = (s[j][0] + 1) * 0.5 * W, y = ((s[j][1] + 0.8) / 1.6) * H;
        ro[n * 3] = x; ro[n * 3 + 1] = y;
        if (j < s.length - 1) {
          const nx = (s[j + 1][0] + 1) * 0.5 * W, ny = ((s[j + 1][1] + 0.8) / 1.6) * H;
          ro[n * 3 + 2] = rho * Math.hypot(nx - x, ny - y) * scope.dpr;
        } else ro[n * 3 + 2] = 0;
        n++;
      }
    }
    return Math.max(0, n - 1);
  }

  // ------------------------------------------------------------ frame
  let last = performance.now();
  let running = true;
  let raf = 0;
  const t00 = performance.now();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = clamp((now - last) / 1000, 0.001, 0.05);
    last = now;
    if (scope.resize(2)) { N = baseN(); pts = new Float32Array((N + 1) * 3); lastPx = null; }
    knobs.forEach((kn) => kn.update(dt));
    if (drifting) drift += dt * 0.11;
    power = Math.min(1, power + dt / 1.1);

    // nearest station
    let best = -1, bd = Infinity;
    placed.forEach((p) => {
      const d = Math.hypot(kx.val - p.a, ky.val - p.b);
      if (d < bd) { bd = d; best = p.i; }
    });
    if (locked >= 0) {
      const p = byStation.get(locked)!;
      if (Math.hypot(kx.val - p.a, ky.val - p.b) > 0.05) {
        locked = -1;
        marks.forEach((el) => el.classList.remove('here'));
        clearTimeout(capTimer);
        capTimer = window.setTimeout(() => { if (locked < 0) showCap(null); }, 2600);
      }
    }
    // a station has to hold for a moment: sweeping straight past one doesn't count
    dwell = bd < 0.012 ? dwell + dt : 0;
    if (locked < 0 && dwell > 0.16) { locked = best; onLock(best); }
    near = best;
    const sig = locked >= 0 ? 1 : Math.pow(clamp(1 - bd / 1.7, 0, 1), 1.6);
    eye.style.setProperty('--sig', sig.toFixed(3));

    // morph towards the station's drawing: a ghost as you approach, full on lock
    const kt = locked >= 0 ? 1 : 0.5 * Math.pow(smooth(0.5, 0.04, bd), 2);
    if (reduce) { k += (kt - k) * (1 - Math.exp(-dt * 8)); kv = 0; }
    else {
      const w = 11, z = 0.55, n = Math.ceil(dt * 240), h = dt / n;
      for (let j = 0; j < n; j++) { kv += (-(k - kt) * w * w - 2 * z * w * kv) * h; k += kv * h; }
    }
    k = clamp(k, 0, 1.15);
    flash *= Math.exp(-dt * 3);

    const fLiss = reduce ? 36 : 5.5;
    const cur = {
      a: kx.val, b: ky.val, ph: kp.val + drift, m: km.val, k,
      // never fewer than ~1400 samples per loop, so slow frames don't shred the lettering
      f: Math.min(fLiss + (72 - fLiss) * smooth(0, 1, Math.min(1, k)), N / dt / 1400),
      amp: reduce ? 1 : 1 - Math.pow(1 - power, 3) * (1 + 0.0 * power),
    };
    const tab = near >= 0 ? tables[near].table : null;

    // ---- generate the beam over this frame's time slice
    const W = scope.W, H = scope.H;
    const ds = dt / N;
    if (!lastPx) lastPx = [W / 2, H / 2];
    pts[0] = lastPx[0]; pts[1] = lastPx[1];
    let lit = 0, cyc = 0;
    let px0 = pts[0], py0 = pts[1], z0 = zs[0] = 1;
    const jit = 0.0007;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const a = prev.a + (cur.a - prev.a) * u, b = prev.b + (cur.b - prev.b) * u;
      const m = prev.m + (cur.m - prev.m) * u, f = prev.f + (cur.f - prev.f) * u;
      const kk = prev.k + (cur.k - prev.k) * u, phi = prev.ph + (cur.ph - prev.ph) * u;
      const amp = prev.amp + (cur.amp - prev.amp) * u;
      theta.t0 += TAU * f * ds; theta.tx += TAU * a * f * ds; theta.ty += TAU * b * f * ds; theta.tm += TAU * m * f * ds;
      cyc += f * ds;
      const d = Math.min(1, m);
      const am = 1 - d + d * Math.cos(theta.tm);
      let x = Math.sin(theta.tx + phi) * am * AMP, y = Math.sin(theta.ty) * am * AMP, z = 1;
      if (tab && kk > 0.0005) {
        sampleTable(tab, MT, theta.t0 / TAU, tmp);
        x += (tmp[0] - x) * kk; y += (tmp[1] - y) * kk;
        z = clamp(1 + (tmp[2] - 1) * Math.min(1, kk), 0, 1);
      }
      x = x * amp + gauss() * jit; y = y * amp + gauss() * jit;
      const px = (x + 1) * 0.5 * W, py = ((y + 0.8) / 1.6) * H;
      pts[i * 3] = px; pts[i * 3 + 1] = py;
      zs[i] = z;
      const zz = Math.min(z0, z);
      lit += Math.hypot(px - px0, py - py0) * zz;
      zs[i - 1] = zz;
      px0 = px; py0 = py; z0 = z;
    }
    for (const kk of ['t0', 'tx', 'ty', 'tm'] as const) if (theta[kk] > 1e4 * TAU) theta[kk] -= 1e4 * TAU;
    lastPx = [pts[N * 3], pts[N * 3 + 1]];
    prev = cur;

    // energy: time-uniform (so slow parts glow), normalised by how much line a cycle draws
    const scale = W / 2;
    const Lcyc = lit / scale / Math.max(1e-4, cyc);
    const c = 16 * Math.pow(Math.max(0.05, Lcyc), 0.95) * (1 + flash * 0.6) * scale * 1.5 * scope.dpr;
    for (let i = 0; i < N; i++) pts[i * 3 + 2] = c * ds * zs[i] * cur.amp;

    const en = readout(W, H, canvas.clientWidth, dt);
    const persist = Math.pow(2, (kq.val - 0.5) * 4);
    const sigma = (0.7 + kf.val * 2.8) * scope.dpr;
    scope.frame(pts, N, ro, en, dt, {
      sigma,
      tauFast: ph.tauFast * Math.pow(2, (kq.val - 0.5) * 1.5),
      tauSlow: ph.tauSlow * persist,
      exposure: 1.0,
      time: (now - t00) / 1000,
      illum: 0.9,
    });

    audio?.set({ a: cur.a, b: cur.b, ph: cur.ph, m: cur.m, k: clamp(k, 0, 1), st: near, f: 110 - 40 * clamp(k, 0, 1) });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); audio?.suspend(true); }
    else if (!running) { running = true; last = performance.now(); audio?.suspend(false); raf = requestAnimationFrame(frame); }
  });
  raf = requestAnimationFrame(frame);

  return true;
}
