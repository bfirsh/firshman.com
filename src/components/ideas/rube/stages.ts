// The nine contraptions. Each is drawn in its own local coordinates and animated as a pure
// function of its local time, so scrolling backwards simply un-happens everything.

import {
  type Pt, MarblePath, svg, line, poly, text, ground, fulcrum, rail, place, rot, path, f1,
  clamp, lerp, span, easeIn, easeIn3, easeOut, easeInOut, smooth, settle, deg, R, G,
} from './kit';

export interface Stage {
  id: string;
  w: number;
  h: number;
  path: MarblePath;
  tail: number; // seconds of animation that carry on after the marble leaves
  exitDir: 1 | -1;
  anchor: Pt; // where a callout's leader line points
  events: { t: number; kind: string }[];
  build(g: SVGGElement): void;
  update(u: number): void;
  focus?(u: number): number | null;
  // where and when the envelope's letter comes out (the bell stage only)
  letter?: { t: number; at: Pt };
}

const rad = (d: number) => d * deg;

// ---------------------------------------------------------------- 1. the operator
export function operator(): Stage {
  const start: Pt = [190, 72], end: Pt = [432, 152];
  const p = new MarblePath(start);
  p.wait(0.55).mark('go').event('click', -0.3).roll([end], { v0: 0, g: 700 });
  let gate: SVGGElement, wheel: SVGPathElement, cable: SVGPathElement;
  const slope = (end[1] - start[1]) / (end[0] - start[0]);
  return {
    id: 'operator', w: 440, h: 236, path: p, tail: 0, exitDir: 1, anchor: [84, 150], events: [],
    build(g) {
      ground(g, 16, 424, 210);
      const r0: Pt = [150, start[1] - 40 * slope];
      rail(g, [r0, end]);
      for (const x of [214, 396]) {
        const y = start[1] + (x - start[0]) * slope + R + 3;
        line(g, [x, y], [x, 210]);
        line(g, [x - 7, y], [x + 7, y], 'ink');
      }
      // the gate, on a little gallows
      line(g, [214, 72 + R + 3], [214, 34]);
      line(g, [214, 34], [196, 34]);
      gate = svg('g', {}, g);
      svg('rect', { x: -2.5, y: 0, width: 5, height: 30, class: 'ink paperfill' }, gate);
      svg('circle', { cx: 0, cy: 0, r: 3, class: 'ink paperfill' }, gate);
      text(g, 222, 30, 'GATE', 'lbl small');
      // the mouse, its wheel, and the string from the wheel to the gate
      svg('rect', { x: 50, y: 108, width: 68, height: 92, rx: 32, class: 'ink paperfill' }, g);
      line(g, [50, 146], [118, 146], 'ink thin');
      line(g, [84, 108], [84, 146], 'ink thin');
      svg('rect', { x: 78, y: 116, width: 12, height: 22, rx: 6, class: 'ink paperfill' }, g);
      wheel = svg('path', { d: '', class: 'ink thin' }, g);
      svg('circle', { cx: 140, cy: 38, r: 6, class: 'ink paperfill' }, g);
      cable = svg('path', { d: '', class: 'string' }, g);
      text(g, 84, 230, 'OPERATOR’S WHEEL', 'lbl small', 'middle');
      text(g, 300, 60, 'MARBLE, 18 MM', 'lbl small');
      line(g, [298, 56], [204, 70], 'ink hair');
    },
    update(u) {
      const open = easeInOut(span(u, 0.08, 0.45));
      place(gate, 196, 36, rad(-78) * open);
      // the wheel's ridges roll by as you scroll
      let d = '';
      const off = (u * 40) % 5;
      for (let y = 118 + off; y < 137; y += 5) d += `M80 ${f1(y)} h8 `;
      wheel.setAttribute('d', d);
      const gx = 196 + Math.sin(rad(-78) * open) * -3;
      cable.setAttribute('d', `M84 116 C 84 60 110 38 134 36 M146 36 C 170 34 ${f1(gx)} 30 196 36`);
    },
  };
}

// ---------------------------------------------------------------- 2. django dominoes
export function dominoes(): Stage {
  const N = 6, W = 20, H = 70, gap = 42, L0 = 160, SY = 150, END = 462;
  const letters = 'DJANGO';
  const pivot = (i: number): Pt => [L0 + gap * i + W, SY];
  const poly0 = (i: number): Pt[] => {
    const l = L0 + gap * i;
    return [[l, SY - H], [l + W, SY - H], [l + W, SY], [l, SY]];
  };
  const polyAt = (i: number, a: number) => poly0(i).map((q) => rot(q, a, pivot(i)));
  const sat = (A: Pt[], B: Pt[]) => {
    for (const P of [A, B]) {
      for (let k = 0; k < 4; k++) {
        const a = P[k], b = P[(k + 1) % 4];
        const nx = -(b[1] - a[1]), ny = b[0] - a[0];
        let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
        for (const q of A) { const d = q[0] * nx + q[1] * ny; amin = Math.min(amin, d); amax = Math.max(amax, d); }
        for (const q of B) { const d = q[0] * nx + q[1] * ny; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
        if (amax < bmin || bmax < amin) return false;
      }
    }
    return true;
  };
  // each domino comes to rest leaning on the next one; the last lies flat
  const fin: number[] = new Array(N).fill(0);
  fin[N - 1] = Math.PI / 2;
  for (let i = N - 2; i >= 0; i--) {
    let lo = 0, hi = Math.PI / 2;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (sat(polyAt(i, m), polyAt(i + 1, fin[i + 1]))) hi = m; else lo = m;
    }
    fin[i] = lo - 0.004;
  }
  // the surface the marble rolls over afterwards, from the fallen dominoes
  const tops: number[] = [];
  const X0 = 130, X1 = 480;
  const finals = fin.map((a, i) => polyAt(i, a));
  for (let x = X0; x <= X1; x++) {
    let y = x <= END ? SY : Infinity;
    for (const P of finals) {
      for (let k = 0; k < 4; k++) {
        const a = P[k], b = P[(k + 1) % 4];
        if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
          const t = (x - a[0]) / (b[0] - a[0]);
          y = Math.min(y, a[1] + t * (b[1] - a[1]));
        }
      }
    }
    tops.push(y);
  }
  const centre = (x: number) => {
    let best = Infinity;
    for (let dx = -R; dx <= R; dx++) {
      const xi = Math.round(x + dx) - X0;
      if (xi < 0 || xi >= tops.length) continue;
      best = Math.min(best, tops[xi] - Math.sqrt(R * R - dx * dx));
    }
    return best;
  };
  const lastY = centre(END);

  const p = new MarblePath([40, 52]);
  p.roll([[140, SY - R], [L0 - R, SY - R]], { v0: 60, g: 900 }).impact('click').mark('hit');
  const hit = p.t;
  const xA = L0 - R, xB = L0 + 4, xC = END + 10;
  p.move(0.42, (u) => { const x = lerp(xA, xB, easeOut(u)); return [x, Math.min(SY - R, centre(x))]; });
  p.move(1.9, (u) => {
    const x = lerp(xB, xC, easeInOut(u) * 0.6 + u * 0.4);
    return [x, x > END ? lastY : Math.min(SY - R, centre(x))];
  });
  const starts = fin.map((_, i) => hit + 0.03 + 0.13 * i);
  const FALL = 0.4;
  const events = starts.map((s) => ({ t: s + FALL, kind: 'click' }));
  const dg: SVGGElement[] = [];
  return {
    id: 'django', w: 480, h: 200, path: p, tail: 0.2, exitDir: 1, anchor: [300, 100], events,
    build(g) {
      rail(g, [[34, 48], [140, SY - R]]);
      svg('rect', { x: 118, y: SY, width: END - 118, height: 9, class: 'ink hatchfill' }, g);
      line(g, [118, SY], [END, SY], 'ink heavy');
      for (const x of [150, 430]) {
        line(g, [x, SY + 9], [x, 186]);
        line(g, [x - 10, 186], [x + 10, 186], 'ink heavy');
      }
      for (let i = 0; i < N; i++) {
        const gg = svg('g', {}, g);
        const l = L0 + gap * i;
        svg('rect', { x: l, y: SY - H, width: W, height: H, rx: 2, class: 'ink paperfill' }, gg);
        line(gg, [l + 3, SY - H / 2], [l + W - 3, SY - H / 2], 'ink hair');
        text(gg, l + W / 2, SY - H / 2 - 9, letters[i], 'glyph', 'middle');
        svg('circle', { cx: l + W / 2, cy: SY - 20, r: 2, class: 'inkfill' }, gg);
        svg('circle', { cx: l + W / 2, cy: SY - 12, r: 2, class: 'inkfill' }, gg);
        dg.push(gg);
      }
      text(g, 290, SY + 26, '6 × DOMINO, SPELLING NOTED', 'lbl small', 'middle');
    },
    update(u) {
      for (let i = 0; i < N; i++) {
        const k = span(u, starts[i], starts[i] + FALL);
        const a = fin[i] * easeIn(k);
        const pv = pivot(i);
        dg[i].setAttribute('transform', a ? `rotate(${(a / deg).toFixed(2)} ${pv[0]} ${pv[1]})` : '');
      }
    },
  };
}

// ---------------------------------------------------------------- 3. the JSNES cartridge
export function jsnes(): Stage {
  const B: Pt = [140, 190];
  const ux = Math.sin(rad(30)), uy = -Math.cos(rad(30));
  const nx = -uy, ny = ux;
  const A = (s: number, o = 0): Pt => [B[0] + ux * s + nx * o, B[1] + uy * s + ny * o];
  const top = A(168);
  const p = new MarblePath([top[0], 0]);
  p.fall(top).roll([A(80)], { g: 900 }).impact('thud').mark('land');
  const land = p.t;
  p.move(0.13, (u) => A(lerp(80, 50, easeOut(u)))).wait(0.16).mark('fire').event('boing');
  const fire = p.t;
  const V = 560;
  p.move(0.1, (u) => A(lerp(50, 172, easeOut(u))));
  const exitT = (440 - p.pos[0]) / (V * ux);
  p.fly(V * ux, V * uy, exitT);
  // spring length over time
  const springLen = (u: number) => {
    if (u < land) return 62;
    if (u < fire) return lerp(62, 32, easeOut(span(u, land, land + 0.13)));
    const k = u - fire;
    if (k < 0.06) return lerp(32, 78, easeOut(k / 0.06));
    return 62 + 16 * Math.exp(-5 * (k - 0.06)) * Math.cos(20 * (k - 0.06));
  };
  let spring: SVGPathElement, plate: SVGRectElement, sg: SVGGElement, led: SVGCircleElement, puff: SVGGElement;
  return {
    id: 'jsnes', w: 440, h: 290, path: p, tail: 0.6, exitDir: 1, anchor: [262, 132],
    events: [],
    build(g) {
      ground(g, 30, 410, 276);
      // console
      svg('rect', { x: 52, y: 196, width: 340, height: 78, rx: 5, class: 'ink paperfill' }, g);
      line(g, [52, 216], [392, 216], 'ink thin');
      svg('rect', { x: 52, y: 196, width: 340, height: 20, class: 'tone' }, g);
      for (const [x, l] of [[78, 'POWER'], [126, 'RESET']] as [number, string][]) {
        svg('rect', { x, y: 236, width: 30, height: 12, rx: 2, class: 'ink paperfill' }, g);
        text(g, x + 15, 262, l, 'lbl tiny', 'middle');
      }
      led = svg('circle', { cx: 176, cy: 242, r: 4, class: 'ink paperfill' }, g);
      for (const x of [300, 340]) svg('rect', { x, y: 234, width: 26, height: 16, rx: 3, class: 'ink paperfill' }, g);
      text(g, 222, 232, 'ENTERTAINMENT SYSTEM (EMULATED)', 'lbl tiny', 'middle');
      // cartridge, with a cut-away
      svg('rect', { x: 104, y: 58, width: 196, height: 140, rx: 4, class: 'ink paperfill' }, g);
      for (let x = 112; x < 296; x += 8) line(g, [x, 62], [x, 70], 'ink hair');
      const win: Pt[] = [A(-4, -26), A(150, -26), A(150, 26), A(-4, 26)];
      poly(g, win, 'cutaway', true);
      poly(g, win, 'ink break', true);
      line(g, A(0, -14), A(150, -14), 'ink heavy');
      line(g, A(0, 14), A(150, 14), 'ink heavy');
      poly(g, [A(150, -14), A(176, -34)], 'ink heavy');
      poly(g, [A(150, 14), A(176, 34)], 'ink heavy');
      line(g, A(0, -14), A(0, 14), 'ink heavy');
      text(g, A(30, -40)[0], A(30, -40)[1], 'SECTION A–A', 'lbl tiny', 'middle');
      // label
      svg('rect', { x: 232, y: 86, width: 56, height: 100, rx: 2, class: 'ink paperfill' }, g);
      text(g, 260, 108, 'JSNES', 'glyph', 'middle');
      const px = [
        '..XXX..', '.XXXXX.', 'XX.X.XX', 'XXXXXXX', '.X...X.', 'X.....X',
      ];
      px.forEach((row, r) => [...row].forEach((c, k) => {
        if (c === 'X') svg('rect', { x: 246 + k * 4, y: 122 + r * 4, width: 4, height: 4, class: 'accfill' }, g);
      }));
      text(g, 260, 162, '8-BIT', 'lbl tiny', 'middle');
      text(g, 260, 176, 'NTSC', 'lbl tiny', 'middle');
      // the spring
      sg = svg('g', {}, g);
      sg.setAttribute('transform', `translate(${f1(B[0])} ${f1(B[1])}) rotate(30)`);
      spring = svg('path', { d: '', class: 'pixel' }, sg);
      plate = svg('rect', { x: -12, y: 0, width: 24, height: 4, class: 'accfill' }, sg);
      svg('rect', { x: -12, y: -6, width: 24, height: 4, class: 'accfill' }, sg);
      puff = svg('g', { class: 'puff' }, g);
      for (let k = 0; k < 5; k++) svg('rect', { x: 0, y: 0, width: 4, height: 4, class: 'accfill' }, puff);
    },
    update(u) {
      const L = springLen(u);
      // stepped zig-zag: it is a pixel spring, after all
      const coils = 5, step = 3;
      let d = 'M0 -4';
      let y = -4;
      const dy = (L - 6) / (coils * 2);
      for (let c = 0; c < coils * 2; c++) {
        const dir = c % 2 ? -1 : 1;
        const n = 4;
        for (let k = 0; k < n; k++) {
          d += ` h${dir * step} v${f1(-dy / n)}`;
        }
        y -= dy;
      }
      spring.setAttribute('d', d.replace('M0 -4', 'M-6 -4'));
      plate.setAttribute('y', f1(-L - 2));
      const lit = u > fire && u < fire + 0.7;
      led.setAttribute('class', lit ? 'ink accfill' : 'ink paperfill');
      const k = u - fire;
      const show = k > 0 && k < 0.5;
      puff.style.opacity = show ? String(1 - k / 0.5) : '0';
      if (show) {
        [...puff.children].forEach((r, i) => {
          const a = rad(-150 + i * 30);
          const q = A(170 + 30 * k * 4, 0);
          r.setAttribute('x', f1(q[0] + Math.cos(a) * 60 * k));
          r.setAttribute('y', f1(q[1] + Math.sin(a) * 60 * k));
        });
      }
    },
  };
}

// ---------------------------------------------------------------- 4. the UKHAS balloon
export function ukhas(): Stage {
  const PV: Pt = [220, 300], HALF = 125, T0 = rad(-13), T1 = rad(13), GY = 330;
  const onPlank = (s: number, a: number): Pt => { const q = rot([s, -4 - R], a); return [PV[0] + q[0], PV[1] + q[1]]; };
  const land = onPlank(108, T0);
  const p = new MarblePath([land[0], 0]);
  p.fall(land).impact('thud').mark('hit');
  const hit = p.t;
  const FLIP = 0.34;
  const ang = (u: number) => {
    const k = span(u, hit, hit + FLIP);
    if (k < 1) return lerp(T0, T1, easeIn(k));
    const j = u - hit - FLIP;
    return T1 - rad(2.2) * Math.exp(-7 * j) * Math.abs(Math.sin(14 * j));
  };
  p.move(FLIP, (u) => onPlank(108, lerp(T0, T1, easeIn(u)))).impact('click');
  p.roll([onPlank(116, T1)], { v0: 30, g: 900 });
  // the balloon: let go when the plank's far end flicks the peg
  const rel = hit + FLIP * 0.75;
  const SLACK = 40, PULL = 18, MAXRISE = 150;
  const rise = (u: number) => {
    const k = u - rel;
    if (k <= 0) return 0;
    const r = k < 0.6 ? 130 * k * k : 46.8 + 156 * (k - 0.6);
    return MAXRISE * (1 - Math.exp(-r / MAXRISE));
  };
  let tPin = rel;
  while (rise(tPin) < SLACK + PULL && tPin < rel + 10) tPin += 1 / 240;
  const gateAt = (u: number) => rad(-72) * easeOut(span(u, tPin, tPin + 0.32));
  p.wait(Math.max(0, tPin + 0.12 - p.t)).event('pop', -0.12);
  p.roll([onPlank(127, T1), [366, GY + 4], [366, GY + 24]], { v0: 40, g: 900 });
  let plank: SVGGElement, balloon: SVGGElement, str: SVGPathElement, pin: SVGGElement, gate: SVGGElement, lever: SVGGElement;
  return {
    id: 'ukhas', w: 440, h: 350, path: p, tail: 2.6, exitDir: 1, anchor: [40, 262],
    events: [{ t: rel, kind: 'click' }],
    build(g) {
      ground(g, 14, 352, GY);
      ground(g, 382, 430, GY);
      fulcrum(g, PV[0], PV[1], GY);
      // peg post and pulley
      line(g, [56, GY], [56, 252]);
      svg('circle', { cx: 68, cy: GY - 7, r: 5, class: 'ink paperfill' }, g);
      // gate gantry
      line(g, [404, GY], [404, 272], 'ink heavy');
      line(g, [404, 272], [322, 272], 'ink heavy');
      line(g, [335, 272], [335, 284]);
      svg('rect', { x: 330, y: 284, width: 11, height: 12, class: 'ink hatchfill' }, g);
      str = svg('path', { d: '', class: 'string' }, g);
      gate = svg('g', {}, g);
      svg('rect', { x: -2, y: 0, width: 4, height: 50, class: 'ink inkfill' }, gate);
      svg('circle', { cx: 0, cy: 0, r: 3, class: 'ink paperfill' }, gate);
      pin = svg('g', {}, g);
      line(pin, [0, 0], [26, 0], 'ink heavy');
      svg('circle', { cx: -4, cy: 0, r: 4, class: 'ink paperfill' }, pin);
      text(g, 300, 262, 'PIN', 'lbl small');
      line(g, [312, 264], [326, 286], 'ink hair');
      lever = svg('g', {}, g);
      svg('rect', { x: -4, y: -9, width: 8, height: 18, rx: 2, class: 'ink paperfill' }, lever);
      line(lever, [4, 2], [38, 12], 'ink heavy');
      text(g, 30, 248, 'PEG', 'lbl small', 'end');
      plank = svg('g', {}, g);
      svg('rect', { x: -HALF, y: -4, width: HALF * 2, height: 8, rx: 1, class: 'ink paperfill' }, plank);
      for (let x = -HALF + 20; x < HALF; x += 25) line(plank, [x, -4], [x, 4], 'ink hair');
      balloon = svg('g', {}, g);
      svg('path', { d: 'M68 58 C 106 58 106 112 72 126 L 64 126 C 30 112 30 58 68 58 Z', class: 'ink paperfill' }, balloon);
      svg('path', { d: 'M54 70 C 50 84 52 98 58 106', class: 'ink hair' }, balloon);
      text(balloon, 68, 96, 'UKHAS', 'glyph small', 'middle');
      line(balloon, [68, 126], [68, 140], 'string');
      svg('path', { d: 'M58 146 Q 68 136 78 146 Z', class: 'ink paperfill' }, balloon);
      line(balloon, [68, 146], [68, 152], 'string');
      svg('rect', { x: 59, y: 152, width: 18, height: 14, rx: 1, class: 'ink accfill' }, balloon);
      line(balloon, [74, 152], [80, 142], 'ink thin');
      text(balloon, 84, 164, 'PAYLOAD', 'lbl tiny');
    },
    update(u) {
      const a = ang(u);
      plank.setAttribute('transform', `translate(${PV[0]} ${PV[1]}) rotate(${(a / deg).toFixed(2)})`);
      const r = rise(u);
      const sway = r > 0 ? Math.sin(u * 2.3) * Math.min(1, r / 60) * 5 : 0;
      balloon.setAttribute('transform', `translate(${f1(sway)} ${f1(-r)})`);
      const struck = span(u, rel - 0.05, rel + 0.08);
      lever.setAttribute('transform', `translate(68 256) rotate(${f1(-18 * struck)})`);
      const pull = Math.max(0, r - SLACK);
      const ringX = 326 - Math.min(pull, 44);
      place(pin, ringX, 290);
      gate.setAttribute('transform', `translate(347 274) rotate(${(gateAt(u) / deg).toFixed(2)})`);
      // the string: payload, past the peg, round the pulley, along the ground to the pin
      const py = 166 - r, px = 68 + sway;
      const slackLeft = Math.max(0, 1 - r / SLACK);
      let d = `M${f1(px)} ${f1(py)} L68 ${GY - 7} L73 ${GY - 2}`;
      const x0 = 73, x1 = Math.max(90, ringX - 26);
      const n = 12;
      for (let i = 1; i <= n; i++) {
        const x = lerp(x0, x1, i / n);
        d += ` L${f1(x)} ${f1(GY - 2 - (i < n ? Math.abs(Math.sin(i * 1.7)) * 4 * slackLeft : 0))}`;
      }
      d += ` L${f1(ringX - 4)} 290`;
      str.setAttribute('d', d);
    },
  };
}

// ---------------------------------------------------------------- 5. the Cog gear train
function gearPath(N: number, r: number, m: number) {
  const pts: Pt[] = [];
  const p = (Math.PI * 2) / N;
  const ra = r + m * 0.9, rd = r - m;
  for (let k = 0; k < N; k++) {
    const c = k * p;
    for (const [rr, f] of [[rd, -0.5], [rd, -0.27], [ra, -0.14], [ra, 0.14], [rd, 0.27]] as [number, number][]) {
      pts.push([rr * Math.cos(c + f * p), rr * Math.sin(c + f * p)]);
    }
  }
  return path(pts, true);
}
// the phase that makes gear B's teeth sit in gear A's gaps along the line of centres
function meshPhase(alpha: number, psiA: number, NA: number, NB: number) {
  const pa = (Math.PI * 2) / NA, pb = (Math.PI * 2) / NB;
  const fa = ((((alpha - psiA) / pa) % 1) + 1) % 1;
  return alpha + Math.PI - (0.5 - fa) * pb;
}

export function cog(): Stage {
  const C: Pt = [130, 168], N1 = 20, N2 = 12, N3 = 8, M = 8;
  const r1 = (N1 * M) / 2, r2 = (N2 * M) / 2, r3 = (N3 * M) / 2;
  const a2 = rad(25), a3 = rad(-50);
  const C2: Pt = [C[0] + (r1 + r2) * Math.cos(a2), C[1] + (r1 + r2) * Math.sin(a2)];
  const C3: Pt = [C2[0] + (r2 + r3) * Math.cos(a3), C2[1] + (r2 + r3) * Math.sin(a3)];
  const psi2 = meshPhase(a2, 0, N1, N2);
  const psi3 = meshPhase(a3, psi2, N2, N3);
  const RB = 60, B0 = rad(-70), CARRY = rad(125), DUR = 1.25;
  const bucket = (phi: number): Pt => [C[0] + RB * Math.cos(B0 + phi), C[1] + RB * Math.sin(B0 + phi)];
  const p = new MarblePath([bucket(0)[0], 0]);
  p.fall(bucket(0)).impact('thud').mark('in');
  const t0 = p.t;
  p.move(DUR, (u) => bucket(CARRY * u * u));
  const w = (2 * CARRY) / DUR; // rad/s at release
  const ar = B0 + CARRY;
  const vx = -Math.sin(ar) * w * RB, vy = Math.cos(ar) * w * RB;
  const railY = (x: number) => 292 + ((x - 104) / (440 - 104)) * 20;
  // fly until it meets the rail
  let d = 0, q = p.pos;
  while (d < 1) { d += 1 / 240; q = [p.pos[0] + vx * d, p.pos[1] + vy * d + 0.5 * G * d * d]; if (q[1] >= railY(q[0])) break; }
  p.fly(vx, vy, d).impact('click').roll([[440, railY(440)]], { v0: 120, g: 900 });
  const SPIN = 2.0, DEC = w / SPIN;
  const phi = (u: number) => {
    const k = u - t0;
    if (k <= 0) return 0;
    if (k < DUR) return CARRY * (k / DUR) * (k / DUR);
    const j = Math.min(SPIN, k - DUR);
    return CARRY + w * j - 0.5 * DEC * j * j;
  };
  const events: { t: number; kind: string }[] = [];
  // a tick per tooth, so they come faster as the wheel speeds up
  let last = 0;
  for (let k = 0.01; k < DUR + SPIN; k += 0.01) {
    const f = phi(t0 + k);
    if (f - last >= (Math.PI * 2) / N1) { events.push({ t: t0 + k, kind: 'tick' }); last = f; }
  }
  let g1: SVGGElement, g2: SVGGElement, g3: SVGGElement;
  return {
    id: 'cog', w: 440, h: 340, path: p, tail: SPIN, exitDir: 1, anchor: [130, 168], events,
    build(g) {
      ground(g, 20, 430, 330);
      // stands
      poly(g, [[C[0] - 46, 330], C, [C[0] + 46, 330]], 'ink');
      poly(g, [[C2[0] - 30, 330], C2, [C2[0] + 30, 330]], 'ink thin');
      line(g, C3, [C3[0] + 40, C3[1] - 40], 'ink thin');
      line(g, [C3[0] + 40, C3[1] - 40], [C3[0] + 40, 330], 'ink thin');
      rail(g, [[96, railY(96)], [440, railY(440)]]);
      for (const x of [110, 400]) line(g, [x, railY(x) + R + 3], [x, 330], 'ink thin');
      g1 = svg('g', {}, g);
      svg('path', { d: gearPath(N1, r1, M), class: 'ink paperfill' }, g1);
      svg('circle', { cx: 0, cy: 0, r: r1 - 14, class: 'ink thin' }, g1);
      for (let k = 0; k < 5; k++) {
        const a = B0 + (k * Math.PI * 2) / 5;
        const cup = svg('g', { transform: `rotate(${(a / deg).toFixed(2)})` }, g1);
        svg('path', { d: `M${RB + 13} -12 L${RB - 8} -12 Q${RB - 15} 0 ${RB - 8} 12 L${RB + 13} 12`, class: 'ink cup' }, cup);
        const sp = a + Math.PI / 5;
        line(g1, [20 * Math.cos(sp), 20 * Math.sin(sp)], [(RB - 2) * Math.cos(sp), (RB - 2) * Math.sin(sp)], 'ink thin');
      }
      g2 = svg('g', {}, g);
      svg('path', { d: gearPath(N2, r2, M), class: 'ink paperfill' }, g2);
      svg('circle', { cx: 0, cy: 0, r: r2 - 16, class: 'ink thin' }, g2);
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; line(g2, [10 * Math.cos(a), 10 * Math.sin(a)], [(r2 - 16) * Math.cos(a), (r2 - 16) * Math.sin(a)], 'ink thin'); }
      g3 = svg('g', {}, g);
      svg('path', { d: gearPath(N3, r3, M), class: 'ink paperfill' }, g3);
      line(g3, [0, 0], [r3 - 12, 0], 'ink heavy');
      for (const [c, r] of [[C, r1], [C2, r2], [C3, r3]] as [Pt, number][]) {
        line(g, [c[0] - r - 14, c[1]], [c[0] + r + 14, c[1]], 'centre');
        line(g, [c[0], c[1] - r - 14], [c[0], c[1] + r + 14], 'centre');
      }
      svg('circle', { cx: C[0], cy: C[1], r: 18, class: 'ink paperfill' }, g);
      text(g, C[0], C[1] + 4, 'COG', 'glyph small', 'middle');
      svg('circle', { cx: C2[0], cy: C2[1], r: 5, class: 'ink paperfill' }, g);
      svg('circle', { cx: C3[0], cy: C3[1], r: 4, class: 'ink paperfill' }, g);
      text(g, C[0] - 70, C[1] - 92, 'Z = 20', 'lbl small');
      text(g, C2[0] + 34, C2[1] + 56, 'Z = 12', 'lbl small');
      text(g, C3[0] + 22, C3[1] - 30, 'Z = 8', 'lbl small');
    },
    update(u) {
      const f = phi(u);
      g1.setAttribute('transform', `translate(${f1(C[0])} ${f1(C[1])}) rotate(${(f / deg).toFixed(2)})`);
      g2.setAttribute('transform', `translate(${f1(C2[0])} ${f1(C2[1])}) rotate(${((psi2 - (N1 / N2) * f) / deg).toFixed(2)})`);
      g3.setAttribute('transform', `translate(${f1(C3[0])} ${f1(C3[1])}) rotate(${((psi3 + (N1 / N3) * f) / deg).toFixed(2)})`);
    },
  };
}

// ---------------------------------------------------------------- 6. Compose stack + Whalebrew lever
export function whale(): Stage {
  const GY = 340, W: Pt = [244, 289], TH0 = rad(-6), TH1 = rad(6);
  const BH: Pt = [-70, -44]; // the marble's seat in the blowhole, in whale coordinates
  const onWhale = (q: Pt, a: number): Pt => { const r = rot(q, a); return [W[0] + r[0], W[1] + r[1]]; };
  const SHELF = 150, SX0 = 196, SX1 = 262, CW = 64, CH = 24;
  const PIV: Pt = [SX0 + CW, SHELF];
  const COM0: Pt = [SX0 + CW / 2, SHELF - CH * 1.5];
  const p = new MarblePath([30, 0]);
  p.fall([30, 36]).roll([[150, 86]], { v0: 40, g: 900 });
  p.arc([SX0 - R, 90], 0.07).impact('click').mark('hit');
  const hit = p.t;
  const seat0 = onWhale(BH, TH0);
  p.arc(seat0, 0.5).impact('thud');
  // the stack teeters, goes over, and lands on the tail
  const T_TIP = 0.72, T_OVER = 0.24, T_FALL = 0.36;
  const tLand = hit + T_TIP + T_OVER + T_FALL;
  const TIP = 0.5;
  const tailSeat: Pt = [92, -60]; // stack COM on the tail, whale coords (stack lying on its side)
  const comAt90 = ((): Pt => { const r = rot([COM0[0] - PIV[0], COM0[1] - PIV[1]], Math.PI / 2); return [PIV[0] + r[0], PIV[1] + r[1]]; })();
  const whaleAng = (u: number) => {
    const k = span(u, tLand, tLand + TIP);
    if (k <= 0) return TH0;
    return lerp(TH0, TH1, settle(k));
  };
  const stackPose = (u: number): [Pt, number] => {
    const k = u - hit;
    if (k <= 0) return [COM0, 0];
    let a: number;
    if (k < T_TIP) a = rad(43) * easeOut(k / T_TIP);
    else if (k < T_TIP + T_OVER) a = lerp(rad(43), rad(90), easeIn((k - T_TIP) / T_OVER));
    else a = Math.PI / 2;
    if (k < T_TIP + T_OVER) {
      const r = rot([COM0[0] - PIV[0], COM0[1] - PIV[1]], a);
      return [[PIV[0] + r[0], PIV[1] + r[1]], a];
    }
    const land = onWhale(tailSeat, TH0);
    if (k < T_TIP + T_OVER + T_FALL) {
      const j = (k - T_TIP - T_OVER) / T_FALL;
      return [[lerp(comAt90[0], land[0], j), lerp(comAt90[1], land[1], easeIn(j))], Math.PI / 2 + rad(4) * j];
    }
    const wa = whaleAng(u);
    return [onWhale(tailSeat, wa), Math.PI / 2 + rad(4) + (wa - TH0)];
  };
  p.wait(Math.max(0, tLand - p.t));
  p.move(TIP * 0.6, (u) => onWhale(BH, whaleAng(tLand + u * TIP * 0.6)));
  const launch = p.t;
  const seat1 = p.pos;
  // the spout lifts it straight up into the J-pipe
  const PIPE_Y = 40;
  const V0 = 720;
  const rise = seat1[1] - PIPE_Y;
  const tr = (V0 - Math.sqrt(V0 * V0 - 2 * G * rise)) / G;
  p.event('splash').move(tr, (u) => { const k = u * tr; return [seat1[0], seat1[1] - V0 * k + 0.5 * G * k * k]; });
  const PC: Pt = [seat1[0] + 30, PIPE_Y];
  p.move(0.13, (u) => { const a = Math.PI + (Math.PI / 2) * u; return [PC[0] + 30 * Math.cos(a), PC[1] + 30 * Math.sin(a)]; });
  p.roll([[460, 58]], { v0: 260, g: 900 });
  const spoutH = (u: number) => {
    const k = u - launch + 0.05;
    if (k <= 0) return 0;
    if (k < tr) return seat1[1] - (seat1[1] - V0 * k + 0.5 * G * k * k) + 6;
    return Math.max(0, (seat1[1] - PIPE_Y) * (1 - easeIn(clamp((k - tr) / 0.9))));
  };
  let wg: SVGGElement, sg: SVGGElement, jet: SVGPathElement, drops: SVGGElement;
  return {
    id: 'whale', w: 460, h: 350, path: p, tail: 1.2, exitDir: 1, anchor: [228, 120],
    events: [{ t: tLand, kind: 'thud' }],
    build(g) {
      ground(g, 20, 440, GY);
      fulcrum(g, W[0], W[1], GY);
      rail(g, [[24, 32], [150, 86]]);
      // shelf, hung from the pipe
      svg('rect', { x: SX0 - 4, y: SHELF, width: SX1 - SX0 + 8, height: 8, class: 'ink hatchfill' }, g);
      for (const x of [216, 254]) line(g, [x, SHELF], [x, PIPE_Y - 30 + ((x - PC[0]) / (460 - PC[0])) * (58 - PIPE_Y + 30) + R + 4], 'ink thin');
      // the J-pipe and chute
      const o = R + 4;
      svg('path', { d: `M${f1(seat1[0] - o)} ${PIPE_Y + 30} L${f1(seat1[0] - o)} ${PIPE_Y} A ${30 + o} ${30 + o} 0 0 1 ${f1(PC[0])} ${f1(PIPE_Y - 30 - o)} L460 ${f1(58 - o)}`, class: 'ink heavy' }, g);
      svg('path', { d: `M${f1(seat1[0] + o)} ${PIPE_Y + 30} L${f1(seat1[0] + o)} ${PIPE_Y} A ${30 - o} ${30 - o} 0 0 1 ${f1(PC[0])} ${f1(PIPE_Y - 30 + o)} L460 ${f1(58 + o)}`, class: 'ink heavy' }, g);
      line(g, [seat1[0] - o - 5, PIPE_Y + 30], [seat1[0] - o + 2, PIPE_Y + 30], 'ink heavy');
      line(g, [seat1[0] + o + 5, PIPE_Y + 30], [seat1[0] + o - 2, PIPE_Y + 30], 'ink heavy');
      text(g, 300, 96, 'HYDRAULIC LIFT', 'lbl tiny');
      jet = svg('path', { d: '', class: 'water' }, g);
      drops = svg('g', {}, g);
      for (let k = 0; k < 8; k++) svg('circle', { r: 2.2, cx: 0, cy: 0, class: 'waterdrop' }, drops);
      // the whale
      wg = svg('g', {}, g);
      svg('path', {
        d: 'M-128 -12 C -128 -40 -96 -50 -60 -48 C -6 -46 50 -36 96 -26 L 112 -24 C 118 -38 126 -46 136 -48 C 132 -38 130 -30 124 -22 C 132 -16 138 -8 140 2 C 128 -2 120 -8 110 -12 C 70 -2 20 8 -40 10 C -90 12 -128 6 -128 -12 Z',
        class: 'ink paperfill',
      }, wg);
      svg('path', { d: 'M-128 -6 C -110 -2 -96 -2 -84 -6', class: 'ink thin' }, wg);
      svg('circle', { cx: -98, cy: -22, r: 2.6, class: 'inkfill' }, wg);
      svg('path', { d: 'M-80 -47 Q -70 -36 -60 -47', class: 'ink thin' }, wg);
      for (let k = 0; k < 5; k++) line(wg, [-60 + k * 9, 4 - k * 0.6], [-56 + k * 9, 10 - k * 0.6], 'ink hair');
      text(wg, 10, -14, 'WHALEBREW', 'glyph small', 'middle');
      // the stack of containers
      sg = svg('g', {}, g);
      const names = ['web', 'db', 'cache'];
      for (let k = 0; k < 3; k++) {
        const y = CH * 1.5 - CH * (k + 1);
        svg('rect', { x: -CW / 2, y, width: CW, height: CH, class: 'ink paperfill' }, sg);
        for (let x = -CW / 2 + 6; x < CW / 2; x += 6) line(sg, [x, y + 3], [x, y + CH - 3], 'ink hair');
        svg('rect', { x: -15, y: y + 6, width: 30, height: 12, class: 'ink paperfill' }, sg);
        text(sg, 0, y + 15.5, names[k], 'lbl tiny', 'middle');
      }
      text(g, SX0 + CW / 2, SHELF + 22, 'compose.yml', 'lbl tiny', 'middle');
    },
    update(u) {
      const a = whaleAng(u);
      wg.setAttribute('transform', `translate(${W[0]} ${W[1]}) rotate(${(a / deg).toFixed(2)})`);
      const [c, sa] = stackPose(u);
      place(sg, c[0], c[1], sa);
      const h = spoutH(u);
      const base = onWhale([-70, -48], a);
      if (h > 1) {
        let d = '';
        for (const off of [-4, 0, 4]) {
          d += `M${f1(base[0] + off)} ${f1(base[1])}`;
          for (let y = 0; y <= h; y += 8) d += ` L${f1(base[0] + off * (1 + y / 120) + Math.sin(y * 0.15 + u * 30 + off) * 1.6)} ${f1(base[1] - y)}`;
        }
        jet.setAttribute('d', d);
      } else jet.setAttribute('d', '');
      const k = u - launch;
      [...drops.children].forEach((dr, i) => {
        const on = k > 0.05 && k < 1.3;
        (dr as SVGElement).style.opacity = on ? String(1 - (k - 0.05) / 1.25) : '0';
        if (!on) return;
        const top = base[1] - Math.max(h, 40);
        const ang = (i / 7) * Math.PI - Math.PI;
        const tt = k * 0.8;
        dr.setAttribute('cx', f1(base[0] + Math.cos(ang) * 60 * tt));
        dr.setAttribute('cy', f1(top + Math.sin(ang) * 50 * tt + 300 * tt * tt));
      });
    },
  };
}

// ---------------------------------------------------------------- 7. the arXiv page-turner
export function arxiv(): Stage {
  // The paper lies open on a desk, drawn in oblique projection: u runs across a page from the
  // spine, v runs away from you. A page turning is a rotation about the spine.
  const SP: Pt = [232, 244], WP = 150, DP = 96, K = 0.36;
  const at = (u: number, v: number, phi: number): Pt => [SP[0] + u * Math.cos(phi) + K * v, SP[1] - u * Math.sin(phi) - K * v];
  const matrix = (phi: number) => `matrix(${Math.cos(phi).toFixed(4)} ${(-Math.sin(phi)).toFixed(4)} ${K} ${-K} ${SP[0]} ${SP[1]})`;
  const PHI0 = rad(80), V_EDGE = 48, RU = WP + R + 1;
  const seat = at(RU, V_EDGE, PHI0);
  const p = new MarblePath([seat[0], 0]);
  p.fall(seat).impact('thud').mark('hit');
  const hit = p.t;
  const TURN = 0.62, REL = rad(138);
  const phiAt = (u: number) => {
    const k = u - hit;
    if (k <= 0) return PHI0;
    if (k < TURN) return lerp(PHI0, Math.PI, easeIn(k / TURN));
    const j = k - TURN;
    return Math.PI - rad(5) * Math.exp(-6 * j) * Math.abs(Math.sin(12 * j));
  };
  const kRel = TURN * Math.sqrt((REL - PHI0) / (Math.PI - PHI0));
  p.move(kRel, (u) => at(RU, V_EDGE, phiAt(hit + u * kRel)));
  const dphi = (2 * (Math.PI - PHI0) * kRel) / (TURN * TURN);
  const vx = -RU * Math.sin(REL) * dphi, vy = -RU * Math.cos(REL) * dphi;
  p.fly(vx, vy, (p.pos[0] - 4) / -vx);

  // page content, in reading coordinates (x right, y down from the page's top edge)
  const content = (g: SVGGElement, head: boolean, seed: number) => {
    svg('rect', { x: 0, y: 0, width: WP, height: DP, class: 'ink paperfill' }, g);
    if (head) {
      text(g, 10, 15, 'arXiv', 'pagehead');
      svg('rect', { x: 16, y: 22, width: 118, height: 3.6, class: 'inkfill' }, g);
      svg('rect', { x: 32, y: 29, width: 86, height: 3.6, class: 'inkfill' }, g);
      for (let k = 0; k < 4; k++) svg('rect', { x: 24, y: 40 + k * 4.5, width: 102 - (k === 3 ? 34 : 0), height: 1.5, class: 'toneline' }, g);
    } else {
      svg('rect', { x: 80, y: 8, width: 60, height: 32, class: 'ink thin paperfill' }, g);
      poly(g, [[84, 36], [96, 26], [106, 30], [120, 16], [136, 20]], 'ink thin');
    }
    const y0 = head ? 64 : 10;
    for (let c = 0; c < 2; c++) {
      for (let k = 0; y0 + k * 5 < DP - 6; k++) {
        if (!head && c === 1 && k < 7) continue;
        const short = (k * 7 + seed + c * 3) % 6 === 0;
        svg('rect', { x: 10 + c * 70, y: y0 + k * 5, width: short ? 34 : 60, height: 1.5, class: 'toneline' }, g);
      }
    }
  };
  // a sheet on the right reads from the spine outwards; on the left, towards it
  const sheet = (parent: SVGGElement, side: 'right' | 'left', head: boolean, seed: number) => {
    const outer = svg('g', {}, parent);
    const flip = side === 'right' ? `translate(0 ${DP}) scale(1 -1)` : `translate(${WP} ${DP}) scale(-1 -1)`;
    const inner = svg('g', { transform: flip }, outer);
    content(inner, head, seed);
    return outer;
  };
  let front: SVGGElement, back: SVGGElement;
  return {
    id: 'arxiv', w: 440, h: 310, path: p, tail: 0.6, exitDir: -1, anchor: [310, 196],
    events: [{ t: hit + TURN, kind: 'flap' }],
    build(g) {
      ground(g, 20, 430, 262);
      // the page block's thickness
      for (let k = 4; k >= 1; k--) {
        poly(g, [at(-WP, 0, 0), at(-WP, DP, 0), at(WP, DP, 0), at(WP, 0, 0)].map((q) => [q[0], q[1] + k * 2] as Pt), 'ink thin paperfill', true);
      }
      const left = sheet(svg('g', {}, g), 'left', true, 1);
      left.setAttribute('transform', matrix(Math.PI));
      const right = sheet(svg('g', {}, g), 'right', false, 4);
      right.setAttribute('transform', matrix(0));
      line(g, SP, at(0, DP, 0), 'ink');
      front = sheet(svg('g', {}, g), 'right', false, 2);
      back = sheet(svg('g', {}, g), 'left', false, 7);
      text(g, 20, 292, 'PAPER, ONE (1), TO BE RENDERED RESPONSIVELY', 'lbl tiny');
    },
    update(u) {
      const phi = phiAt(u);
      const m = matrix(phi);
      // past vertical we're looking at the other side of the page
      const showFront = phi < Math.PI / 2;
      front.setAttribute('transform', m);
      back.setAttribute('transform', m);
      front.style.display = showFront ? '' : 'none';
      back.style.display = showFront ? 'none' : '';
    },
  };
}

// ---------------------------------------------------------------- 8. the CLIG terminal
export function terminal(lines: string[]): Stage {
  const keys = ['-', '-', 'h', 'e', 'l', 'p', '⏎'];
  const KY = 268, KX = (k: number) => 76 + k * 46 + (k === 6 ? 8 : 0);
  const p = new MarblePath([KX(0), 0]);
  p.fall([KX(0), KY - R - 1]).impact('key');
  const presses: number[] = [p.t];
  for (let k = 1; k < keys.length; k++) {
    const h = 46 - k * 4;
    const d = 0.18 + h / 300;
    const from = p.pos;
    const to: Pt = [KX(k), KY - R - 1];
    p.move(d, (u) => [lerp(from[0], to[0], u), lerp(from[1], to[1], u) - Math.sin(Math.PI * u) * h]).impact('key');
    presses.push(p.t);
  }
  p.roll([[410, KY - R - 1], [440, KY + 6]], { v0: 150, g: 900 });
  const enter = presses[6];
  const OUT = 0.14;
  const CH = 5.52; // advance of the 9.2px mono face
  let typed: SVGTextElement, cursor: SVGRectElement, prompt: SVGTextElement, outs: SVGTextElement[] = [], keyG: SVGGElement[] = [];
  return {
    id: 'clig', w: 440, h: 324, path: p, tail: OUT * lines.length + 0.3, exitDir: 1, anchor: [372, 22],
    events: [],
    build(g) {
      ground(g, 20, 420, 296);
      // monitor
      svg('rect', { x: 66, y: 14, width: 308, height: 190, rx: 10, class: 'ink paperfill' }, g);
      svg('rect', { x: 82, y: 28, width: 276, height: 160, rx: 4, class: 'screen' }, g);
      svg('rect', { x: 200, y: 204, width: 40, height: 22, class: 'ink paperfill' }, g);
      svg('rect', { x: 160, y: 226, width: 120, height: 6, rx: 2, class: 'ink paperfill' }, g);
      typed = text(g, 92, 46, '$ ben ', 'term');
      cursor = svg('rect', { x: 0, y: 37, width: 6, height: 11, class: 'termcur' }, g);
      for (let i = 0; i < lines.length; i++) outs.push(text(g, 92, 60 + i * 14, lines[i], 'term'));
      prompt = text(g, 92, 46 + (lines.length + 1) * 14, '$', 'term');
      // keyboard
      poly(g, [[34, 280], [44, 256], [416, 256], [426, 280]], 'ink paperfill', true);
      svg('rect', { x: 34, y: 280, width: 392, height: 10, class: 'ink paperfill' }, g);
      for (let k = 0; k < keys.length; k++) {
        const kg = svg('g', {}, g);
        const w = k === 6 ? 46 : 34;
        svg('rect', { x: KX(k) - w / 2, y: KY - 1, width: w, height: 11, rx: 2, class: 'ink paperfill' }, kg);
        text(kg, KX(k), KY + 8, keys[k], 'key', 'middle');
        keyG.push(kg);
      }
      text(g, 220, 316, 'KEYS FITTED: SEVEN (7). ALL OTHERS DECORATIVE.', 'lbl tiny', 'middle');
    },
    update(u) {
      let n = 0;
      for (let k = 0; k < 6; k++) if (u >= presses[k]) n = k + 1;
      typed.textContent = '$ ben ' + '--help'.slice(0, n);
      const done = u >= enter;
      const shown = done ? Math.floor((u - enter) / OUT) + 1 : 0;
      outs.forEach((o, i) => (o.style.opacity = i < shown ? '1' : '0'));
      // the cursor sits after the command, then on a fresh prompt once the help is printed
      const atEnd = done && shown >= lines.length;
      cursor.setAttribute('x', f1(atEnd ? 104 : 92 + typed.textContent.length * CH));
      cursor.setAttribute('y', f1(atEnd ? 37 + (lines.length + 1) * 14 : 37));
      prompt.style.opacity = atEnd ? '1' : '0';
      cursor.style.opacity = done && !atEnd ? '0' : String(Math.floor(u * 2.2) % 2 ? 0.25 : 1);
      keyG.forEach((kg, k) => {
        const d = u - presses[k];
        const down = d >= 0 && d < 0.16 ? 3 * (1 - d / 0.16) : 0;
        kg.setAttribute('transform', down ? `translate(0 ${f1(down)})` : '');
      });
    },
  };
}

// ---------------------------------------------------------------- 9. the bell, the flag and the envelope
export function bell(flagText: string): Stage {
  const BP: Pt = [168, 60]; // the bell hangs from here
  const GY = 506;
  const p = new MarblePath([40, 0]);
  p.fall([40, 46]).roll([[118, 96]], { v0: 30, g: 900 });
  p.arc([140, 110], 0.08).impact('ding').mark('ding');
  const ding = p.t;
  p.arc([92, 212], 0.42).impact('click');
  p.move(0.3, (u) => [lerp(92, 98, easeOut(u)), 212 + Math.sin(u * Math.PI) * -6]).wait(0.2);
  // the envelope drops on the halyard, which hauls the flag up the pole
  const REL = ding + 0.24, DROP = 1.9, TRAVEL = 340;
  // it accelerates, then the flag's drag catches up and it lands softly
  const drop = (u: number) => TRAVEL * easeInOut(span(u, REL, REL + DROP));
  const swing = (u: number) => {
    const k = u - ding;
    if (k <= 0) return 0;
    return rad(16) * Math.exp(-2.2 * k) * Math.sin(11 * k);
  };
  const OPEN = REL + DROP + 0.1;
  const ENV: Pt = [292, 72]; // envelope top centre, before the drop
  let bg: SVGGElement, env: SVGGElement, flap: SVGPathElement, flag: SVGGElement, halyard: SVGPathElement, rings: SVGGElement, catchArm: SVGLineElement, cord: SVGPathElement;
  return {
    id: 'bell', w: 440, h: 520, path: p, tail: (OPEN - p.t) + 0.9, exitDir: 1, anchor: [120, 110],
    letter: { t: OPEN, at: [ENV[0], ENV[1] + TRAVEL] },
    events: [{ t: REL + DROP, kind: 'thud' }, { t: OPEN, kind: 'flap' }],
    focus(u) {
      if (u < ding + 0.2) return null;
      return lerp(212, ENV[1] + drop(u) + 40, smooth(span(u, ding + 0.2, ding + 1.0)));
    },
    build(g) {
      ground(g, 20, 430, GY);
      // the frame: a post and arm for the bell, a pole with a yard-arm for the rest
      line(g, [212, GY], [212, 40], 'ink heavy');
      line(g, [212, 40], [BP[0] - 10, 40], 'ink heavy');
      line(g, [BP[0], 40], BP, 'ink');
      line(g, [370, GY], [370, 24], 'ink heavy');
      svg('circle', { cx: 370, cy: 18, r: 5, class: 'ink paperfill' }, g);
      line(g, [370, 30], [ENV[0], 30], 'ink heavy');
      svg('circle', { cx: 370, cy: 34, r: 6, class: 'ink paperfill' }, g);
      svg('circle', { cx: ENV[0], cy: 34, r: 6, class: 'ink paperfill' }, g);
      rail(g, [[34, 42], [118, 96]]);
      // the end of the line
      svg('path', { d: 'M78 206 L78 226 Q98 236 118 226 L118 206', class: 'ink paperfill heavy' }, g);
      line(g, [98, 231], [98, GY], 'ink thin');
      text(g, 98, 250, 'FIN.', 'glyph small', 'middle');
      halyard = svg('path', { d: '', class: 'string' }, g);
      cord = svg('path', { d: '', class: 'string' }, g);
      catchArm = line(g, [ENV[0] - 18, 44], [ENV[0] - 40, 44], 'ink heavy') as SVGLineElement;
      // bell
      bg = svg('g', {}, g);
      svg('path', { d: 'M-8 4 L8 4 L8 12 L-8 12 Z', class: 'ink paperfill' }, bg);
      svg('path', { d: 'M-24 64 C -24 40 -22 14 0 12 C 22 14 24 40 24 64 L 34 76 L -34 76 Z', class: 'ink paperfill' }, bg);
      line(bg, [-30, 70], [30, 70], 'ink thin');
      svg('circle', { cx: 0, cy: 80, r: 5, class: 'ink paperfill' }, bg);
      line(bg, [8, 8], [30, 2], 'ink heavy');
      rings = svg('g', { class: 'rings' }, g);
      for (let k = 0; k < 3; k++) svg('path', { d: '', class: 'acc' }, rings);
      // flag and envelope
      flag = svg('g', {}, g);
      svg('path', { d: 'M0 0 L64 0 L56 18 L64 36 L0 36 Z', class: 'ink accfill' }, flag);
      text(flag, 28, 23, flagText, 'flagtext', 'middle');
      env = svg('g', {}, g);
      svg('rect', { x: -70, y: 0, width: 140, height: 92, class: 'ink paperfill' }, env);
      svg('path', { d: 'M-70 92 L-14 46 M70 92 L14 46', class: 'ink thin' }, env);
      flap = svg('path', { d: 'M-70 0 L0 50 L70 0', class: 'ink paperfill' }, env);
      svg('rect', { x: 40, y: 10, width: 22, height: 26, class: 'ink thin' }, env);
      svg('circle', { cx: 51, cy: 23, r: 7, class: 'acc' }, env);
      text(g, 258, GY + 20, 'ENVELOPE, CONTENTS OVERLEAF', 'lbl tiny', 'middle');
    },
    update(u) {
      const s = swing(u);
      bg.setAttribute('transform', `translate(${BP[0]} ${BP[1]}) rotate(${(s / deg).toFixed(2)})`);
      const k = u - ding;
      [...rings.children].forEach((r, i) => {
        const on = k > 0 && k < 0.9;
        (r as SVGElement).style.opacity = on ? String(1 - k / 0.9) : '0';
        if (!on) return;
        const rr = 46 + i * 12 + k * 30;
        r.setAttribute('d', `M${f1(BP[0] + rr * Math.cos(rad(-30)))} ${f1(BP[1] + 44 + rr * Math.sin(rad(-30)))} A ${f1(rr)} ${f1(rr)} 0 0 1 ${f1(BP[0] + rr * Math.cos(rad(30)))} ${f1(BP[1] + 44 + rr * Math.sin(rad(30)))}`);
      });
      // the bell's arm pulls the cord, which trips the catch
      const tip = rot([30, 2], s);
      const tx = BP[0] + tip[0], ty = BP[1] + tip[1];
      const tripped = span(u, ding + 0.08, REL);
      cord.setAttribute('d', `M${f1(tx)} ${f1(ty)} L${f1(ENV[0] - 40 - 6 * tripped)} 44`);
      catchArm.setAttribute('x2', f1(ENV[0] - 40 - 6 * tripped));
      catchArm.setAttribute('y2', f1(44 + 14 * tripped));
      const d = drop(u);
      const ey = ENV[1] + d;
      place(env, ENV[0], ey);
      const op = span(u, OPEN, OPEN + 0.35);
      flap.setAttribute('transform', `scale(1 ${f1(1 - 2 * easeInOut(op))})`);
      const fy = GY - 70 - d;
      place(flag, 372, fy);
      halyard.setAttribute('d', `M${ENV[0]} ${f1(ey)} L${ENV[0]} 40 M${ENV[0]} 28 L370 28 M376 34 L376 ${f1(fy)} M376 ${f1(fy + 36)} L376 ${GY - 10}`);
    },
  };
}
