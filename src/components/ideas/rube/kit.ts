// Drawing helpers and a deterministic, keyframed marble path for the contraption.

export type Pt = [number, number];
export const NS = 'http://www.w3.org/2000/svg';
export const G = 1200; // px/s², for free falls
export const R = 9; // marble radius

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const easeIn = (t: number) => t * t;
export const easeIn3 = (t: number) => t * t * t;
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smooth = (t: number) => t * t * (3 - 2 * t);
// a settle: ends at 1 after a small, damped overshoot
export const settle = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(9 * t) * (1 - t));
export const deg = Math.PI / 180;

export const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
export const path = (pts: Pt[], close = false) => 'M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join(' L') + (close ? ' Z' : '');

export function rot(p: Pt, a: number, c: Pt = [0, 0]): Pt {
  const s = Math.sin(a), co = Math.cos(a);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
}

export function place(e: Element, x: number, y: number, a = 0) {
  e.setAttribute('transform', `translate(${f1(x)} ${f1(y)})` + (a ? ` rotate(${(a / deg).toFixed(2)})` : ''));
}

// ----- drawing primitives in the house style -----
export const line = (g: Element, a: Pt, b: Pt, cls = 'ink') => svg('line', { x1: f1(a[0]), y1: f1(a[1]), x2: f1(b[0]), y2: f1(b[1]), class: cls }, g);
export const poly = (g: Element, pts: Pt[], cls = 'ink', close = false) => svg('path', { d: path(pts, close), class: cls }, g);
export function text(g: Element, x: number, y: number, s: string, cls = 'lbl', anchor: 'start' | 'middle' | 'end' = 'start') {
  const t = svg('text', { x: f1(x), y: f1(y), class: cls, 'text-anchor': anchor }, g);
  t.textContent = s;
  return t;
}

// A fixed ground: a line with the draughtsman's hatch underneath.
export function ground(g: Element, x1: number, x2: number, y: number) {
  line(g, [x1, y], [x2, y], 'ink heavy');
  let d = '';
  for (let x = x1 + 4; x < x2; x += 8) d += `M${f1(x)} ${f1(y + 1)} l-6 7 `;
  svg('path', { d, class: 'ink hair' }, g);
}

// A fulcrum: a triangle standing on the ground with a pin at its apex.
export function fulcrum(g: Element, x: number, y: number, groundY: number) {
  const h = groundY - y;
  poly(g, [[x, y], [x - h * 0.55, groundY], [x + h * 0.55, groundY]], 'ink paperfill', true);
  svg('circle', { cx: x, cy: y, r: 3.2, class: 'ink paperfill' }, g);
}

// A rail under a marble path: the path offset by the marble radius, on the side away from the marble.
export function rail(g: Element, pts: Pt[], cls = 'ink heavy', side = 1, r = R) {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    // normal pointing "down" relative to travel (screen y down)
    let nx = -dy, ny = dx;
    if (ny < 0 || (ny === 0 && nx < 0)) { nx = -nx; ny = -ny; }
    out.push([pts[i][0] + nx * (r + 1.5) * side, pts[i][1] + ny * (r + 1.5) * side]);
  }
  return poly(g, out, cls);
}

// ----- the marble's path -----
type Piece = { t0: number; t1: number; f: (u: number) => Pt };

export class MarblePath {
  pieces: Piece[] = [];
  t = 0;
  pos: Pt;
  vy = 0; // vertical speed carried into a fall
  v = 0; // speed carried into a roll
  impacts: number[] = [];
  events: { t: number; kind: string }[] = [];
  marks: Record<string, number> = {};

  constructor(start: Pt) { this.pos = start; }

  get duration() { return this.t; }

  move(d: number, f: (u: number) => Pt) {
    const t0 = this.t;
    this.pieces.push({ t0, t1: t0 + d, f });
    this.t += d;
    this.pos = f(1);
    return this;
  }

  wait(d: number) { const p = this.pos; this.v = 0; this.vy = 0; return this.move(d, () => p); }

  // free fall straight down (x drifts linearly) from rest or with this.vy
  fall(to: Pt, g = G) {
    const from = this.pos, dy = to[1] - from[1], v0 = this.vy;
    const d = Math.max(0.05, (-v0 + Math.sqrt(Math.max(0, v0 * v0 + 2 * g * dy))) / g);
    this.move(d, (u) => {
      const tt = u * d;
      return [lerp(from[0], to[0], u), from[1] + v0 * tt + 0.5 * g * tt * tt];
    });
    this.vy = v0 + g * d;
    this.v = this.vy * 0.5;
    return this;
  }

  // ballistic flight to a target in a fixed time
  arc(to: Pt, d: number, g = G) {
    const from = this.pos;
    const vy0 = (to[1] - from[1] - 0.5 * g * d * d) / d;
    this.move(d, (u) => {
      const tt = u * d;
      return [lerp(from[0], to[0], u), from[1] + vy0 * tt + 0.5 * g * tt * tt];
    });
    this.vy = vy0 + g * d;
    this.v = Math.hypot((to[0] - from[0]) / d, this.vy) * 0.5;
    return this;
  }

  // ballistic flight with a launch velocity, for a fixed time
  fly(vx: number, vy: number, d: number, g = G) {
    const from = this.pos;
    this.move(d, (u) => {
      const tt = u * d;
      return [from[0] + vx * tt, from[1] + vy * tt + 0.5 * g * tt * tt];
    });
    this.vy = vy + g * d;
    this.v = Math.hypot(vx, this.vy) * 0.5;
    return this;
  }

  // roll (or slide, or drop) along a polyline under gravity, losing speed at sharp corners
  roll(pts: Pt[], o: { v0?: number; g?: number; vmax?: number; vmin?: number } = {}) {
    const g = o.g ?? 900, vmax = o.vmax ?? 620, vmin = o.vmin ?? 50;
    const all: Pt[] = [this.pos, ...pts];
    const samples: number[] = [0, all[0][0], all[0][1]];
    let v = o.v0 ?? this.v, t = 0;
    const dt = 1 / 480;
    let pdx = 0, pdy = 0;
    const t0 = this.t;
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i], b = all[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      if (pdx || pdy) {
        const c = pdx * ux + pdy * uy;
        if (c < 0.97) v *= 0.6 + 0.4 * Math.max(0, c);
        if (c < 0.7) { this.impacts.push(t0 + t); this.events.push({ t: t0 + t, kind: 'click' }); }
      }
      pdx = ux; pdy = uy;
      let s = 0;
      while (s < L) {
        v = clamp(v + g * uy * dt, vmin, vmax);
        s = Math.min(L, s + v * dt);
        t += dt;
        samples.push(t, a[0] + ux * s, a[1] + uy * s);
      }
    }
    const d = Math.max(t, 1e-3);
    const n = samples.length / 3;
    this.move(d, (u) => {
      const tt = u * d;
      // samples are evenly spaced in time
      const k = Math.min(n - 1, Math.max(0, tt / dt));
      const i = Math.floor(k), fr = k - i;
      const j = Math.min(n - 1, i + 1);
      return [lerp(samples[i * 3 + 1], samples[j * 3 + 1], fr), lerp(samples[i * 3 + 2], samples[j * 3 + 2], fr)];
    });
    this.v = v;
    this.vy = v * pdy;
    return this;
  }

  impact(kind = 'click') {
    this.impacts.push(this.t);
    this.events.push({ t: this.t, kind });
    return this;
  }

  event(kind: string, dt = 0) {
    this.events.push({ t: this.t + dt, kind });
    return this;
  }

  mark(name: string) {
    this.marks[name] = this.t;
    return this;
  }

  at(t: number): Pt {
    const ps = this.pieces;
    if (!ps.length) return this.pos;
    if (t <= 0) return ps[0].f(0);
    // pieces are few; a linear scan is fine
    for (const p of ps) {
      if (t <= p.t1) return p.f(p.t1 > p.t0 ? (t - p.t0) / (p.t1 - p.t0) : 1);
    }
    return ps[ps.length - 1].f(1);
  }
}

// squash factor (0..1) from the nearest impact
export function squashAt(impacts: number[], t: number) {
  let k = 0;
  for (const ti of impacts) {
    const d = t - ti;
    if (d > -0.015 && d < 0.14) k = Math.max(k, Math.exp(-Math.pow(d / 0.045, 2)));
  }
  return k;
}
