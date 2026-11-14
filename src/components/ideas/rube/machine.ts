// Lays the contraptions out down the page, joins them with rails, and turns a scroll
// position into a moment in one deterministic run of the machine.

import { svg, line, rail, text, MarblePath, squashAt, f1, clamp, R, type Pt } from './kit';
import type { Stage } from './stages';

type Placed = { st: Stage; x: number; y: number; s: number; t0: number; t1: number; g: SVGGElement; last: number };
type Conn = { path: MarblePath; t0: number; t1: number };

export class Machine {
  placed: Placed[] = [];
  conns: Conn[] = [];
  T = 0;
  height = 0;
  scale = 1;
  events: { t: number; kind: string }[] = [];
  impacts: number[] = [];
  private focusF: Float64Array = new Float64Array(0);
  private readonly dtF = 1 / 120;
  private marble!: SVGGElement;
  private marbleSquash!: SVGGElement;
  private marbleSpin!: SVGGElement;

  constructor(
    private root: SVGSVGElement,
    private stages: Stage[],
    private callouts: HTMLElement[],
    private width: number,
    private mobile: boolean,
  ) {
    this.layout();
  }

  private layout() {
    const { root, stages, callouts, width, mobile } = this;
    root.replaceChildren();
    const defs = svg('defs', {}, root);
    const pat = svg('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatchline' }, pat);
    const back = svg('g', {}, root);
    const conLayer = svg('g', {}, root);
    const stageLayer = svg('g', {}, root);
    const top = svg('g', {}, root);

    const maxW = Math.max(...stages.map((s) => s.w));
    let s: number, X0: number, CW: number, calloutW: number;
    if (mobile) {
      s = Math.min(1, (width - 58) / maxW);
      X0 = 14; CW = width - 28; calloutW = width - 16 - 52;
    } else {
      CW = Math.min(width - 96, 1120);
      X0 = (width - CW) / 2;
      s = Math.min(1, (CW * 0.6) / maxW);
      calloutW = Math.min(340, CW - maxW * s - 70);
    }
    this.scale = s;
    const r = R * s;
    const tubeX = width - 24;

    // first pass: positions
    let y = mobile ? 30 : 40;
    const routes: Pt[][] = [];
    const calloutBoxes: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      const sw = st.w * s, sh = st.h * s;
      const col = i % 2;
      const x = mobile ? Math.max(14, (width - 46 - sw) / 2) : col === 0 ? X0 : X0 + CW - sw;
      const g = svg('g', { transform: `translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(4)})` }, stageLayer);
      this.placed.push({ st, x, y, s, t0: 0, t1: 0, g, last: NaN });
      const exit = st.path.pos;
      const E: Pt = [x + exit[0] * s, y + exit[1] * s];
      const co = callouts[i];
      co.style.width = calloutW + 'px';
      const ch = co.offsetHeight;
      let cx: number, cy: number;
      const next = stages[i + 1];
      if (!next) {
        // the last callout sits beside (or below) the final contraption
        if (mobile) { cx = 16; cy = y + sh + 16; } else { cx = col === 0 ? Math.min(X0 + CW - calloutW, x + sw + 70) : Math.max(X0, x - 70 - calloutW); cy = y + sh * 0.25; }
        calloutBoxes.push({ x: cx, y: cy, w: calloutW, h: ch });
        y = Math.max(y + sh, cy + ch) + 30;
        break;
      }
      const nsw = next.w * s;
      const nx = mobile ? Math.max(14, (width - 46 - nsw) / 2) : (i + 1) % 2 === 0 ? X0 : X0 + CW - nsw;
      const Nx = nx + next.path.at(0)[0] * s;
      const entryY = next.path.at(0)[1] * s;
      const A: Pt = [E[0] + st.exitDir * 14 * s, E[1] + 30 * s];
      let ny: number, route: Pt[];
      if (mobile) {
        const G1: Pt = [tubeX, Math.max(A[1], E[1]) + 0.1 * Math.abs(tubeX - A[0]) + 8];
        cx = 16;
        cy = Math.max(y + sh + 14, G1[1] + 16);
        const G2: Pt = [tubeX, cy + ch + 18];
        const B: Pt = [Nx, G2[1] + 0.1 * Math.abs(tubeX - Nx) + 8];
        const N: Pt = [Nx, B[1] + 28 * s];
        ny = N[1] - entryY;
        route = [A, G1, G2, B, N];
      } else {
        cx = col === 0 ? Math.min(X0 + CW - calloutW, x + sw + 70) : Math.max(X0, x - 70 - calloutW);
        cy = y + sh / 2 - ch / 2;
        ny = Math.max(y + sh + 50, cy + ch + 50);
        const need = (yy: number) => {
          const B: Pt = [Nx, yy + entryY - 32 * s];
          return B[1] - A[1] - (0.16 * Math.abs(B[0] - A[0]) + 16);
        };
        const D: Pt = [A[0], Math.max(A[1], y + sh + 14)];
        const need2 = (yy: number) => {
          const B: Pt = [Nx, yy + entryY - 32 * s];
          return B[1] - D[1] - (0.12 * Math.abs(B[0] - D[0]) + 16);
        };
        while (need(ny) < 0 || need2(ny) < 0) ny += 4;
        const B: Pt = [Nx, ny + entryY - 32 * s];
        route = [A, D, B, [Nx, ny + entryY]];
      }
      calloutBoxes.push({ x: cx, y: cy, w: calloutW, h: ch });
      routes.push(route);
      y = ny;
    }
    this.height = y + 20;
    root.setAttribute('width', String(width));
    root.setAttribute('height', String(Math.ceil(this.height)));
    root.setAttribute('viewBox', `0 0 ${width} ${Math.ceil(this.height)}`);

    // draw the contraptions and their connecting rails
    let t = 0;
    const evs: { t: number; kind: string }[] = [];
    const imps: number[] = [];
    for (let i = 0; i < this.placed.length; i++) {
      const P = this.placed[i];
      P.st.build(P.g);
      P.t0 = t;
      P.t1 = t + P.st.path.duration;
      for (const e of P.st.path.events) evs.push({ t: e.t + t, kind: e.kind });
      for (const e of P.st.events) evs.push({ t: e.t + t, kind: e.kind });
      for (const k of P.st.path.impacts) imps.push(k + t);
      t = P.t1;
      const route = routes[i];
      if (!route) continue;
      const exit = P.st.path.pos;
      const E: Pt = [P.x + exit[0] * s, P.y + exit[1] * s];
      const path = new MarblePath(E);
      path.roll(route, { v0: 220 * s, g: 1100 * s, vmax: 700 * s, vmin: 230 * s });
      this.conns.push({ path, t0: t, t1: t + path.duration });
      for (const e of path.events) evs.push({ t: e.t + t, kind: e.kind });
      for (const k of path.impacts) imps.push(k + t);
      t += path.duration;
      this.drawRoute(conLayer, route, r, mobile);
    }
    const lastP = this.placed[this.placed.length - 1];
    this.T = lastP.t1 + lastP.st.tail;
    this.events = evs.sort((a, b) => a.t - b.t);
    this.impacts = imps;

    // callouts and their leaders
    calloutBoxes.forEach((b, i) => {
      const co = callouts[i];
      co.style.left = f1(b.x) + 'px';
      co.style.top = f1(b.y) + 'px';
      const P = this.placed[i];
      const an: Pt = [P.x + P.st.anchor[0] * s, P.y + P.st.anchor[1] * s];
      if (mobile) {
        svg('circle', { cx: f1(an[0]), cy: f1(an[1]), r: 10, class: 'badge' }, top);
        text(top, an[0], an[1] + 3.6, String(i + 1), 'badgetext', 'middle');
      } else {
        // a short leader from the callout's number to the edge of its figure
        const right = b.x > P.x;
        const bx = right ? b.x - 8 : b.x + b.w + 8;
        const by = b.y + 13;
        const ex = right ? P.x + P.st.w * s + 6 : P.x - 6;
        svg('path', { d: `M${f1(bx)} ${f1(by)} L${f1(ex)} ${f1(by)}`, class: 'leader' }, top);
        const dir = right ? -1 : 1;
        svg('path', { d: `M${f1(ex)} ${f1(by)} l${8 * -dir} -3 l0 6 Z`, class: 'inkfill' }, top);
      }
    });

    // the sheet's border, with zone marks, like a proper drawing
    if (!mobile) {
      const L = X0 - 34, Rr = X0 + CW + 34;
      for (const x of [L, Rr]) {
        line(back, [x, 0], [x, this.height], 'ink thin');
        line(back, [x + (x === L ? -5 : 5), 0], [x + (x === L ? -5 : 5), this.height], 'ink hair');
      }
      const Z = 300;
      for (let k = 0, yy = 0; yy < this.height; k++, yy += Z) {
        for (const x of [L, Rr]) {
          line(back, [x - 5, yy], [x + 5, yy], 'ink thin');
          text(back, x + (x === L ? -14 : 14), yy + Z / 2 + 4, String.fromCharCode(65 + (k % 26)), 'zone', 'middle');
        }
      }
    }

    // the marble, on top of everything
    this.marble = svg('g', {}, top);
    this.marbleSquash = svg('g', {}, this.marble);
    this.marbleSpin = svg('g', {}, this.marbleSquash);
    svg('circle', { r: f1(r), class: 'marble' }, this.marbleSpin);
    svg('path', { d: `M${f1(-r * 0.55)} 0 A ${f1(r * 0.55)} ${f1(r * 0.55)} 0 0 1 ${f1(r * 0.55)} 0`, class: 'marbleline' }, this.marbleSpin);
    svg('circle', { cx: f1(-r * 0.35), cy: f1(-r * 0.38), r: f1(r * 0.24), class: 'marbleshine' }, this.marbleSquash);

    // where the camera looks at each moment: the marble (or what a stage points at),
    // and always creeping on, so every bit of scroll moves time
    const n = Math.ceil(this.T / this.dtF) + 2;
    const F = new Float64Array(n);
    const vmin = 46;
    for (let k = 0; k < n; k++) {
      const tk = k * this.dtF;
      const yk = this.focusTarget(tk);
      F[k] = k === 0 ? yk : Math.max(F[k - 1] + vmin * this.dtF, yk);
    }
    this.focusF = F;
  }

  private drawRoute(g: SVGGElement, route: Pt[], r: number, mobile: boolean) {
    const hanger = (p: Pt) => {
      line(g, [p[0], p[1] + r + 2], [p[0], p[1] - 22], 'ink thin');
      line(g, [p[0] - 6, p[1] - 22], [p[0] + 6, p[1] - 22], 'ink');
      let d = '';
      for (let x = -6; x < 6; x += 4) d += `M${f1(p[0] + x)} ${f1(p[1] - 22)} l4 -4 `;
      svg('path', { d, class: 'ink hair' }, g);
    };
    // a little Warren truss under the marble's line
    const girder = (a: Pt, b: Pt) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      let nx = -uy, ny = ux;
      if (ny < 0) { nx = -nx; ny = -ny; }
      const o1 = r + 1.5, o2 = r + 8;
      const P = (t: number, o: number): Pt => [a[0] + ux * t + nx * o, a[1] + uy * t + ny * o];
      line(g, P(0, o1), P(L, o1), 'ink');
      line(g, P(0, o2), P(L, o2), 'ink thin');
      let d = '';
      const n = Math.max(2, Math.round(L / 14));
      for (let k = 0; k < n; k++) {
        const t0 = (L * k) / n, t1 = (L * (k + 0.5)) / n, t2 = (L * (k + 1)) / n;
        const p0 = P(t0, o1), p1 = P(t1, o2), p2 = P(t2, o1);
        d += `M${f1(p0[0])} ${f1(p0[1])} L${f1(p1[0])} ${f1(p1[1])} L${f1(p2[0])} ${f1(p2[1])} `;
      }
      svg('path', { d, class: 'ink hair' }, g);
      line(g, P(0, o1 - 5), P(0, o2), 'ink');
      line(g, P(L, o1 - 5), P(L, o2), 'ink');
    };
    if (!mobile) {
      const [, D, B] = route;
      girder(D, B);
      const L = Math.hypot(B[0] - D[0], B[1] - D[1]);
      const k = Math.max(1, Math.round(L / 300));
      for (let j = 0; j <= k; j++) {
        const u = 0.12 + (0.76 * j) / k;
        hanger([D[0] + (B[0] - D[0]) * u, D[1] + (B[1] - D[1]) * u]);
      }
      return;
    }
    const [A, G1, G2, B] = route;
    girder(A, G1);
    const o = r + 4;
    line(g, [G1[0] - o, G1[1] + o + 2], [G1[0] - o, G2[1] - o], 'ink');
    line(g, [G1[0] + o, G1[1] - 18], [G1[0] + o, G2[1] + 2], 'ink');
    girder(G2, B);
    hanger([(G2[0] + B[0]) / 2, (G2[1] + B[1]) / 2]);
    hanger([(A[0] + G1[0]) / 2, (A[1] + G1[1]) / 2]);
  }

  private focusTarget(t: number) {
    for (const P of this.placed) {
      if (P.st.focus && t >= P.t0) {
        const fy = P.st.focus(t - P.t0);
        if (fy !== null && (t <= P.t1 + P.st.tail)) return P.y + fy * P.s;
      }
    }
    return this.marbleAt(t)[1];
  }

  marbleAt(t: number): Pt {
    if (t <= 0) {
      const P = this.placed[0];
      const q = P.st.path.at(0);
      return [P.x + q[0] * P.s, P.y + q[1] * P.s];
    }
    for (let i = 0; i < this.placed.length; i++) {
      const P = this.placed[i];
      if (t <= P.t1 || i === this.placed.length - 1) {
        const q = P.st.path.at(t - P.t0);
        return [P.x + q[0] * P.s, P.y + q[1] * P.s];
      }
      const C = this.conns[i];
      if (C && t <= C.t1) return C.path.at(t - C.t0);
    }
    return [0, 0];
  }

  // camera focus (in machine coordinates) for a time, and its inverse
  focusAt(t: number) {
    const F = this.focusF;
    const k = clamp(t / this.dtF, 0, F.length - 1);
    const i = Math.floor(k), j = Math.min(F.length - 1, i + 1);
    return F[i] + (F[j] - F[i]) * (k - i);
  }

  timeAt(focus: number) {
    const F = this.focusF;
    if (focus <= F[0]) return 0;
    if (focus >= F[F.length - 1]) return this.T;
    let lo = 0, hi = F.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (F[m] <= focus) lo = m; else hi = m;
    }
    return (lo + (focus - F[lo]) / (F[hi] - F[lo])) * this.dtF;
  }

  // the end of the stage (or rail) that contains t: for the calmer, reduced-motion mode
  snap(t: number) {
    if (t <= 0) return 0;
    const bounds: [number, number][] = [];
    this.placed.forEach((P, i) => {
      bounds.push([P.t0, i === this.placed.length - 1 ? this.T : P.t1 + Math.min(P.st.tail, this.conns[i] ? this.conns[i].t1 - P.t1 : P.st.tail)]);
      const C = this.conns[i];
      if (C) bounds.push([C.t0, C.t1]);
    });
    let out = 0;
    for (const [a, b] of bounds) if (t > a + 0.02) out = Math.max(out, b);
    return Math.min(this.T, out);
  }

  update(t: number) {
    for (const P of this.placed) {
      const u = clamp(t - P.t0, 0, P.t1 - P.t0 + P.st.tail);
      if (u !== P.last) {
        P.st.update(u);
        P.last = u;
      }
    }
    const [x, y] = this.marbleAt(t);
    const k = squashAt(this.impacts, t);
    const r = R * this.scale;
    this.marble.setAttribute('transform', `translate(${f1(x)} ${f1(y + k * r * 0.18)})`);
    this.marbleSquash.setAttribute('transform', k > 0.01 ? `scale(${(1 + 0.2 * k).toFixed(3)} ${(1 - 0.22 * k).toFixed(3)})` : '');
    this.marbleSpin.setAttribute('transform', `rotate(${((x / r) * 57.3).toFixed(1)})`);
  }

  stageAt(t: number) {
    let n = 0;
    this.placed.forEach((P, i) => { if (t >= P.t0 - 0.001) n = i; });
    return n;
  }
}

// ---------------------------------------------------------------- sound
// Small synthesised noises. Silent until switched on, which needs a click anyway.
export class Sound {
  ctx: AudioContext | null = null;
  on = false;
  private noise: AudioBuffer | null = null;
  private recent: number[] = [];

  enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 0.6;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    this.ctx.resume();
    this.on = true;
  }

  disable() { this.on = false; }

  private env(g: GainNode, t: number, peak: number, decay: number, attack = 0.002) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private burst(freq: number, q: number, peak: number, decay: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx!, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, peak, decay);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  private tone(freq: number, peak: number, decay: number, type: OscillatorType = 'sine', to?: number) {
    const c = this.ctx!, t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.8);
    const g = c.createGain();
    this.env(g, t, peak, decay);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  play(kind: string) {
    if (!this.on || !this.ctx) return;
    const now = performance.now();
    this.recent = this.recent.filter((x) => now - x < 120);
    if (this.recent.length > 6) return;
    this.recent.push(now);
    switch (kind) {
      case 'click': this.burst(2600, 1.4, 0.35, 0.04); break;
      case 'key': this.burst(3800, 2, 0.3, 0.03); this.tone(1900, 0.04, 0.03, 'square'); break;
      case 'tick': this.burst(5200, 3, 0.12, 0.018); break;
      case 'thud': this.tone(150, 0.5, 0.16, 'sine', 55); this.burst(500, 0.8, 0.2, 0.08, 'lowpass'); break;
      case 'boing': this.tone(170, 0.22, 0.45, 'triangle', 640); break;
      case 'pop': this.burst(1800, 0.7, 0.3, 0.06, 'highpass'); this.tone(900, 0.1, 0.05); break;
      case 'flap': this.burst(1100, 0.6, 0.18, 0.14); break;
      case 'splash': this.burst(1600, 0.5, 0.22, 0.5, 'lowpass'); break;
      case 'ding':
        this.tone(1318, 0.3, 1.8);
        this.tone(1318 * 2.76, 0.1, 0.9);
        this.tone(1318 * 5.4, 0.05, 0.4);
        break;
    }
  }
}
