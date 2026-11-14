import { species, keeper, prettyUrl, type Info, type Kind } from './species';
import * as D from './draw';
import { startCaustics } from './caustics';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Spec = { L: number; spd: number; band: [number, number]; z: [number, number]; sep: number; hit: [number, number] };
const SPEC: Record<Exclude<Kind, 'chest'>, Spec> = {
  whale: { L: 300, spd: 30, band: [0.1, 0.5], z: [0.5, 0.5], sep: 0, hit: [0.46, 0.3] },
  baby: { L: 84, spd: 40, band: [0.15, 0.6], z: [0.56, 0.66], sep: 90, hit: [0.48, 0.3] },
  cog: { L: 64, spd: 42, band: [0.25, 0.72], z: [0.2, 0.9], sep: 70, hit: [0.42, 0.38] },
  nes: { L: 58, spd: 48, band: [0.18, 0.68], z: [0.35, 0.95], sep: 70, hit: [0.5, 0.36] },
  clig: { L: 28, spd: 92, band: [0.08, 0.8], z: [0.72, 0.72], sep: 18, hit: [0.6, 0.6] },
  django: { L: 200, spd: 26, band: [0.9, 0.97], z: [0.8, 0.8], sep: 0, hit: [0.5, 0.18] },
  origami: { L: 66, spd: 36, band: [0.2, 0.62], z: [0.25, 0.85], sep: 70, hit: [0.5, 0.32] },
  puffer: { L: 60, spd: 24, band: [0.45, 0.75], z: [0.75, 0.75], sep: 0, hit: [0.42, 0.42] },
  angler: { L: 150, spd: 20, band: [0.62, 0.84], z: [0.62, 0.62], sep: 0, hit: [0.44, 0.34] },
  crab: { L: 96, spd: 14, band: [1, 1], z: [0.6, 0.6], sep: 0, hit: [0.42, 0.42] },
  small: { L: 30, spd: 66, band: [0.12, 0.78], z: [0.15, 0.95], sep: 26, hit: [0.55, 0.4] },
};

interface Group { kind: Kind; info: Info; fish: Fish[]; gx: number; gy: number; gt: number; z: number }
interface Fish extends D.Drawable {
  kind: Exclude<Kind, 'chest'>; info: Info; g: Group; i: number;
  x: number; y: number; z: number; vx: number; vy: number;
  dir: number; pitch: number; face: number; panic: number;
  ox: number; oy: number; sc: number; sx: number; sy: number;
  mode: string; timer: number; walk: number;
}
type Bubble = { x: number; y: number; r: number; vy: number; ph: number };
type Pellet = { x: number; y: number; vy: number; ph: number; rest: number; dead: boolean };
type Kelp = { x: number; h: number; n: number; ph: number; w: number; d: number; col: string; blade: string; spd: number };

export function startAquarium() {
  const html = document.documentElement;
  const water = document.getElementById('water') as HTMLDivElement;
  const cv = document.getElementById('scene') as HTMLCanvasElement;
  const ctx = cv.getContext('2d')!;
  const cardEl = document.getElementById('card') as HTMLDivElement;
  const sticker = document.getElementById('sticker') as HTMLDivElement;
  const reduceQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = reduceQ.matches;
  const caustics = startCaustics(document.getElementById('caustics') as HTMLCanvasElement);

  let W = 0, H = 0, dpr = 1, base = 1, surfY = 24, sandH = 100, P = 24, M = 30;
  let t = 0;
  let night = html.dataset.lights === 'off' ? 1 : 0;
  const cam = { x: 0, y: 0, tx: 0, ty: 0 };
  const pointer = { x: -1e4, y: -1e4, inside: false };

  // -------------------------------------------------- geometry
  const sandAt = (x: number) =>
    H - sandH + Math.sin((x / Math.max(W, 1)) * TAU * 0.9 + 0.6) * sandH * 0.14 + Math.sin(x * 0.013 + 2) * sandH * 0.05;
  const swimTop = () => surfY + 26 * base;
  const swimBottom = () => H - sandH * 1.22 - 10 * base;
  const off = (d: number) => (reduce ? 0 : -cam.x * (d - 0.6) * P);
  const offY = (d: number) => (reduce ? 0 : -cam.y * (d - 0.6) * P * 0.45);
  const fishD = (z: number) => 0.35 + z * 0.6;

  // -------------------------------------------------- offscreen layers
  const mk = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, x, w, h };
  };
  let bgL: ReturnType<typeof mk>, shipL: ReturnType<typeof mk>, sandL: ReturnType<typeof mk>;
  let ship = { x: 0, y: 0, w: 0, h: 0 };
  const chest = { x: 0, y: 0, s: 80, open: 0, target: 0, timer: 6, hover: false };
  const face = new Image();
  face.src = '/profile.png';

  function buildBg() {
    bgL = mk(W + M * 2, H + M * 2);
    const c = bgL.x;
    c.translate(M, M);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3f97b4'); g.addColorStop(0.08, '#2b7f9f'); g.addColorStop(0.4, '#17607f');
    g.addColorStop(0.75, '#104866'); g.addColorStop(1, '#0d3a52');
    c.fillStyle = g;
    c.fillRect(-M, -M, W + M * 2, H + M * 2);
    // distant rocks and dunes
    const far = (y0: number, amp: number, col: string, seed: number) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-M, H + M);
      for (let x = -M; x <= W + M; x += 8) {
        const y = y0 + Math.sin(x * 0.006 + seed) * amp + Math.sin(x * 0.017 + seed * 2) * amp * 0.4 + Math.max(0, Math.sin(x * 0.0035 + seed * 3)) * -amp * 1.8;
        c.lineTo(x, y);
      }
      c.lineTo(W + M, H + M);
      c.fill();
    };
    far(H - sandH * 2.1, sandH * 0.28, 'rgba(18,80,108,.55)', 1.3);
    far(H - sandH * 1.55, sandH * 0.2, 'rgba(20,74,98,.8)', 4.1);
    // distant kelp silhouettes
    c.strokeStyle = 'rgba(30,90,95,.45)';
    c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const x = ((i * 0.137 + 0.05) % 1) * W;
      const h = H * rand(0.18, 0.4);
      c.lineWidth = 3 + Math.random() * 3;
      c.beginPath();
      c.moveTo(x, H - sandH * 1.3);
      c.bezierCurveTo(x + 20, H - sandH * 1.3 - h * 0.4, x - 20, H - sandH * 1.3 - h * 0.7, x + 8, H - sandH * 1.3 - h);
      c.stroke();
    }
  }

  function buildShip() {
    const SW = clamp(W * (W < 700 ? 0.78 : 0.42), 250, 620);
    const SH = SW * 0.42;
    const pad = 20;
    shipL = mk(SW + pad * 2 + M * 2, SH * 2.2 + pad * 2);
    const c = shipL.x;
    const ox = pad + M, oy = SH * 1.1 + pad;
    ship = { w: SW + pad * 2 + M * 2, h: SH * 2.2 + pad * 2, x: 0, y: 0 };
    const cx = W < 700 ? W * 0.58 : W * 0.64;
    ship.x = cx - ship.w / 2;
    ship.y = H - sandH * 0.82 - (oy + SH);
    c.translate(ox + SW / 2, oy + SH / 2);
    c.rotate(-0.07);
    c.translate(-SW / 2, -SH / 2);
    const deckY = (x: number) => { const s = x / SW; return SH * (0.2 - 0.22 * s + 0.2 * s * s) - SH * 0.04; };

    // mast
    c.save();
    c.translate(SW * 0.5, deckY(SW * 0.5));
    c.rotate(-0.18);
    c.fillStyle = '#2b2a22';
    c.fillRect(-SW * 0.012, -SH * 1.05, SW * 0.024, SH * 1.05);
    c.beginPath(); c.moveTo(-SW * 0.012, -SH * 1.05); c.lineTo(SW * 0.004, -SH * 1.14); c.lineTo(SW * 0.012, -SH * 1.02); c.fill();
    c.fillRect(-SW * 0.16, -SH * 0.78, SW * 0.32, SW * 0.012);
    c.strokeStyle = 'rgba(60,58,45,.8)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-SW * 0.16, -SH * 0.77); c.quadraticCurveTo(-SW * 0.3, -SH * 0.3, -SW * 0.44, SH * 0.02); c.stroke();
    c.beginPath(); c.moveTo(SW * 0.16, -SH * 0.77); c.quadraticCurveTo(SW * 0.3, -SH * 0.5, SW * 0.42, -SH * 0.12); c.stroke();
    // tattered flag
    c.fillStyle = 'rgba(120,40,35,.75)';
    c.beginPath(); c.moveTo(SW * 0.012, -SH * 1.0); c.lineTo(SW * 0.12, -SH * 0.96); c.lineTo(SW * 0.08, -SH * 0.92); c.lineTo(SW * 0.11, -SH * 0.87); c.lineTo(SW * 0.012, -SH * 0.88); c.fill();
    c.restore();

    // deckhouse
    c.fillStyle = '#34322a';
    c.beginPath();
    c.moveTo(SW * 0.08, deckY(SW * 0.08) + 2); c.lineTo(SW * 0.08, deckY(SW * 0.08) - SH * 0.3);
    c.lineTo(SW * 0.3, deckY(SW * 0.3) - SH * 0.28); c.lineTo(SW * 0.3, deckY(SW * 0.3) + 2); c.fill();
    c.fillStyle = '#121a1c';
    for (const x of [0.12, 0.2]) c.fillRect(SW * x, deckY(SW * x) - SH * 0.22, SW * 0.05, SH * 0.1);

    // hull
    const hull = new Path2D();
    hull.moveTo(SW * 0.02, deckY(SW * 0.02));
    for (let x = 0.02; x <= 0.985; x += 0.02) hull.lineTo(SW * x, deckY(SW * x));
    hull.bezierCurveTo(SW * 0.99, SH * 0.45, SW * 0.92, SH * 0.82, SW * 0.76, SH * 0.94);
    hull.lineTo(SW * 0.14, SH * 0.96);
    hull.quadraticCurveTo(SW * 0.0, SH * 0.6, SW * 0.02, deckY(SW * 0.02));
    hull.closePath();
    const hg = c.createLinearGradient(0, 0, 0, SH);
    hg.addColorStop(0, '#4a4636'); hg.addColorStop(0.5, '#38362b'); hg.addColorStop(1, '#22231d');
    c.fillStyle = hg;
    c.fill(hull);
    c.save();
    c.clip(hull);
    // planks
    c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      c.beginPath();
      for (let x = 0; x <= SW; x += 10) { const y = deckY(x) + i * SH * 0.1 + (x / SW) * i * SH * 0.012; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,240,200,.05)';
    for (let i = 1; i < 9; i++) {
      c.beginPath();
      for (let x = 0; x <= SW; x += 10) { const y = deckY(x) + i * SH * 0.1 + 1.2 + (x / SW) * i * SH * 0.012; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    // weed and grime
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * SW, y = SH * (0.55 + Math.random() * 0.45);
      c.fillStyle = `rgba(${Math.random() < 0.5 ? '70,110,60' : '40,70,50'},${rand(0.15, 0.4)})`;
      c.beginPath(); c.ellipse(x, y, rand(4, 18), rand(2, 7), rand(-0.3, 0.3), 0, TAU); c.fill();
    }
    for (let i = 0; i < 60; i++) {
      c.fillStyle = 'rgba(210,205,180,.35)';
      c.beginPath(); c.arc(Math.random() * SW, SH * (0.3 + Math.random() * 0.7), rand(0.8, 2.2), 0, TAU); c.fill();
    }
    // hole
    c.fillStyle = '#0b1214';
    c.beginPath();
    const hx = SW * 0.3, hy = SH * 0.68;
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; const r = SH * (0.09 + Math.random() * 0.06); c.lineTo(hx + Math.cos(a) * r * 1.5, hy + Math.sin(a) * r); }
    c.fill();
    c.restore();
    // portholes
    for (const x of [0.12, 0.22, 0.32, 0.42]) {
      const px = SW * x, py = deckY(px) + SH * 0.24, r = SH * 0.055;
      c.fillStyle = '#9c7a3a';
      c.beginPath(); c.arc(px, py, r * 1.35, 0, TAU); c.fill();
      c.fillStyle = '#0d1618';
      c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill();
      c.fillStyle = 'rgba(160,220,230,.12)';
      c.beginPath(); c.arc(px - r * 0.3, py - r * 0.3, r * 0.4, 0, TAU); c.fill();
    }
    // railing
    c.strokeStyle = '#3d3a2e'; c.lineWidth = 2;
    c.beginPath();
    for (let x = SW * 0.32; x < SW * 0.96; x += SW * 0.045) {
      if (x > SW * 0.62 && x < SW * 0.7) continue; // broken
      c.moveTo(x, deckY(x)); c.lineTo(x, deckY(x) - SH * 0.11);
    }
    c.stroke();
    c.beginPath(); c.moveTo(SW * 0.32, deckY(SW * 0.32) - SH * 0.11);
    for (let x = SW * 0.32; x <= SW * 0.62; x += 8) c.lineTo(x, deckY(x) - SH * 0.11);
    c.stroke();
    c.beginPath(); c.moveTo(SW * 0.7, deckY(SW * 0.7) - SH * 0.11);
    for (let x = SW * 0.7; x <= SW * 0.96; x += 8) c.lineTo(x, deckY(x) - SH * 0.11 + (x > SW * 0.93 ? 6 : 0));
    c.stroke();

    // the nameboard
    const bx0 = SW * 0.52, bx1 = SW * 0.93;
    const by = (deckY(bx0) + deckY(bx1)) / 2 + SH * 0.15;
    const ang = Math.atan2(deckY(bx1) - deckY(bx0), bx1 - bx0) + 0.025;
    const bw = bx1 - bx0, bh = SH * 0.2;
    c.save();
    c.translate((bx0 + bx1) / 2, by);
    c.rotate(ang);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(-bw / 2 + 2, -bh / 2 + 3, bw, bh);
    const bg = c.createLinearGradient(0, -bh / 2, 0, bh / 2);
    bg.addColorStop(0, '#26302f'); bg.addColorStop(1, '#151b1b');
    c.fillStyle = bg;
    c.fillRect(-bw / 2, -bh / 2, bw, bh);
    c.strokeStyle = 'rgba(214,176,92,.75)'; c.lineWidth = 1.2;
    c.strokeRect(-bw / 2 + 4, -bh / 2 + 4, bw - 8, bh - 8);
    let fs = bh * 0.56;
    c.font = `600 ${fs}px Fraunces, Georgia, serif`;
    const label = 'BEN FIRSHMAN';
    const spacing = fs * 0.16;
    const measure = () => c.measureText(label).width + spacing * (label.length - 1);
    while (measure() > bw - 26 && fs > 8) { fs -= 0.5; c.font = `600 ${fs}px Fraunces, Georgia, serif`; }
    const tw = measure();
    const tg = c.createLinearGradient(0, -fs / 2, 0, fs / 2);
    tg.addColorStop(0, '#f8e2a0'); tg.addColorStop(0.55, '#d9ad52'); tg.addColorStop(1, '#a87a2c');
    c.fillStyle = tg;
    c.textBaseline = 'middle';
    let x = -tw / 2;
    for (const ch of label) { c.fillText(ch, x, fs * 0.04); x += c.measureText(ch).width + spacing; }
    // weathering
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(0,0,0,${rand(0.2, 0.7)})`; c.beginPath(); c.arc(rand(-bw / 2, bw / 2), rand(-bh / 2, bh / 2), rand(0.4, 1.4), 0, TAU); c.fill(); }
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#8c8a7f';
    for (const s of [-1, 1]) { c.beginPath(); c.arc(s * (bw / 2 - 2), 0, 2, 0, TAU); c.fill(); }
    c.restore();
    // haze to push it back
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = 'rgba(20,80,105,.22)';
    c.fillRect(0, 0, ship.w, ship.h);
    c.globalCompositeOperation = 'source-over';
  }

  function buildSand() {
    const top = H - sandH * 1.35;
    sandL = mk(W, H - top);
    const c = sandL.x;
    c.translate(0, -top);
    const path = new Path2D();
    path.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) path.lineTo(x, sandAt(x));
    path.lineTo(W, H); path.closePath();
    const g = c.createLinearGradient(0, H - sandH * 1.2, 0, H);
    g.addColorStop(0, '#c9b083'); g.addColorStop(0.35, '#b99c6c'); g.addColorStop(1, '#8a7049');
    c.fillStyle = g;
    c.fill(path);
    c.save();
    c.clip(path);
    // ripples
    c.strokeStyle = 'rgba(255,240,210,.12)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      const y0 = H - sandH + i * sandH * 0.08 + 6;
      c.beginPath();
      for (let x = 0; x <= W; x += 6) { const y = y0 + Math.sin(x * 0.03 + i * 1.7) * 2.4 + (sandAt(x) - (H - sandH)) * (1 - i / 14); x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    // speckle
    const n = Math.round((W * sandH) / 90);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * W, y = H - sandH * 1.2 + Math.random() * sandH * 1.3;
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,245,220,.25)' : 'rgba(70,50,25,.22)';
      c.fillRect(x, y, 1.2, 1.2);
    }
    // pebbles and shells
    for (let i = 0; i < Math.round(W / 40); i++) {
      const x = Math.random() * W, y = sandAt(x) + rand(6, sandH * 0.9);
      const r = rand(2, 7) * base;
      c.fillStyle = ['#7d776d', '#9b9183', '#5d5a55', '#b5a58c'][i % 4];
      c.beginPath(); c.ellipse(x, y, r * 1.3, r, rand(-0.4, 0.4), 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,.15)';
      c.beginPath(); c.ellipse(x - r * 0.3, y - r * 0.35, r * 0.5, r * 0.3, 0, 0, TAU); c.fill();
    }
    for (let i = 0; i < 5; i++) {
      const x = rand(0.05, 0.95) * W, y = sandAt(x) + rand(10, sandH * 0.7), r = rand(5, 9) * base;
      c.save(); c.translate(x, y); c.rotate(rand(-0.6, 0.6));
      c.fillStyle = '#efd9c4';
      c.beginPath(); c.moveTo(0, r * 0.4); c.arc(0, r * 0.4, r, Math.PI * 1.1, Math.PI * 1.9); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(150,100,80,.5)'; c.lineWidth = 0.8;
      for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(0, r * 0.4); c.lineTo(Math.sin(k * 0.3) * r, r * 0.4 - Math.cos(k * 0.3) * r); c.stroke(); }
      c.restore();
    }
    c.restore();
    // a soft dark lip where sand meets water
    c.strokeStyle = 'rgba(80,60,30,.25)'; c.lineWidth = 2;
    c.beginPath(); for (let x = 0; x <= W; x += 4) x ? c.lineTo(x, sandAt(x) + 1) : c.moveTo(x, sandAt(x) + 1); c.stroke();
  }

  // -------------------------------------------------- kelp
  let kelp: Kelp[] = [];
  function buildKelp() {
    kelp = [];
    const narrow = W < 700;
    const back = narrow ? [0.06, 0.13, 0.86, 0.94] : [0.035, 0.08, 0.135, 0.38, 0.425, 0.8, 0.865, 0.905, 0.95];
    back.filter((fx) => fx * W < ship.x + ship.w * 0.12 || fx * W > ship.x + ship.w * 0.98).forEach((fx, i) => kelp.push({ x: fx * W, h: H * rand(0.34, 0.62), n: 15, ph: i * 1.3, w: rand(3, 4.5) * base, d: 0.5, col: '#4c7a37', blade: '#5f8f3f', spd: rand(0.6, 0.9) }));
    const front = narrow ? [-0.02, 1.02] : [-0.01, 0.025, 0.975, 1.01];
    front.forEach((fx, i) => kelp.push({ x: fx * W, h: H * rand(0.5, 0.78), n: 17, ph: i * 2.1 + 0.5, w: rand(6, 8) * base, d: 1.4, col: '#20391b', blade: '#2c4c22', spd: rand(0.5, 0.7) }));
  }
  let kelpWob = 0;
  function drawKelp(k: Kelp) {
    const c = ctx;
    let x = k.x + off(k.d), y = (k.d > 1 ? H + 10 : sandAt(k.x) + 8) + offY(k.d);
    const seg = k.h / k.n;
    const amp = reduce ? 0.08 : 0.24;
    const spd = reduce ? 0.3 : 1;
    const pts: [number, number, number][] = [[x, y, -Math.PI / 2]];
    for (let i = 1; i <= k.n; i++) {
      const s = i / k.n;
      const a = -Math.PI / 2 + Math.sin(t * k.spd * spd + k.ph + s * 2.4) * amp * s + Math.sin(t * 0.21 + k.ph) * 0.08 * s + kelpWob * Math.sin(t * 9 + s * 4 + k.ph) * 0.22 * s;
      x += Math.cos(a) * seg; y += Math.sin(a) * seg;
      pts.push([x, y, a]);
    }
    // stipe
    c.fillStyle = k.col;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) { const [px, py, a] = pts[i]; const w = k.w * (1 - (i / pts.length) * 0.7); c.lineTo(px + Math.cos(a + Math.PI / 2) * w * 0.5, py + Math.sin(a + Math.PI / 2) * w * 0.5); }
    for (let i = pts.length - 1; i >= 0; i--) { const [px, py, a] = pts[i]; const w = k.w * (1 - (i / pts.length) * 0.7); c.lineTo(px - Math.cos(a + Math.PI / 2) * w * 0.5, py - Math.sin(a + Math.PI / 2) * w * 0.5); }
    c.fill();
    // blades
    c.fillStyle = k.blade;
    for (let i = 2; i < pts.length; i += 1) {
      const [px, py, a] = pts[i];
      const side = i % 2 ? 1 : -1;
      const len = seg * (2.3 - (i / pts.length) * 0.9);
      const w = seg * 0.42 + k.w * 0.4;
      const ba = a + side * (0.75 + Math.sin(t * 1.3 * spd + i + k.ph) * 0.12) + (i / pts.length) * 0.2;
      c.save(); c.translate(px, py); c.rotate(ba);
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.45, -w, len, 0); c.quadraticCurveTo(len * 0.45, w * 0.8, 0, 0); c.fill();
      c.restore();
    }
    // pneumatocyst float at the top
    const [tx, ty] = pts[pts.length - 1];
    c.beginPath(); c.arc(tx, ty, k.w * 0.9, 0, TAU); c.fill();
  }

  // -------------------------------------------------- creatures
  let groups: Group[] = [];
  let fish: Fish[] = [];
  let order: Fish[] = [];
  let bubbles: Bubble[] = [];
  let pellets: Pellet[] = [];
  let ripples: { x: number; y: number; t: number }[] = [];
  let prints: { x: number; y: number; t: number; r: number }[] = [];
  let plankton: { x: number; y: number; p: number; s: number }[] = [];
  let whaleRef: Fish | null = null;

  function makeFish(kind: Fish['kind'], info: Info, g: Group, i: number, z: number): Fish {
    const s = SPEC[kind];
    const [b0, b1] = s.band;
    const y = lerp(swimTop(), swimBottom(), rand(b0, b1));
    return {
      kind, info, g, i, L: s.L, x: rand(0.1, 0.9) * W, y, z,
      vx: rand(-1, 1) * s.spd * base, vy: rand(-0.2, 0.2) * s.spd * base,
      dir: Math.random() < 0.5 ? -1 : 1, pitch: 0, face: 0, panic: 0,
      phase: Math.random() * TAU, seed: (Math.random() * 1000) | 0,
      infl: 0, balloon: 0, pal: 0, glow: 0, held: false, mouth: 0,
      ox: 0, oy: 0, sc: 1, sx: 0, sy: 0, mode: 'swim', timer: rand(10, 18), walk: 0,
    };
  }

  function populate() {
    groups = []; fish = [];
    const narrow = W < 700;
    const add = (kind: Fish['kind'], info: Info, n: number, schoolR: number) => {
      const s = SPEC[kind];
      const g: Group = { kind, info, fish: [], gx: rand(0.2, 0.8) * W, gy: lerp(swimTop(), swimBottom(), lerp(s.band[0], s.band[1], Math.random())), gt: 0, z: rand(s.z[0], s.z[1]) };
      for (let i = 0; i < n; i++) {
        const z = clamp(g.z + (n > 1 ? rand(-0.07, 0.07) : 0), 0, 1);
        const f = makeFish(kind, info, g, i, z);
        f.x = g.gx + rand(-schoolR, schoolR); f.y = clamp(g.gy + rand(-schoolR, schoolR) * 0.6, swimTop(), swimBottom());
        f.ox = rand(-schoolR, schoolR); f.oy = rand(-schoolR, schoolR) * 0.5;
        g.fish.push(f); fish.push(f);
      }
      groups.push(g);
      return g;
    };
    const by = (id: string) => species.find((s) => s.id === id)!;
    add('angler', by('replicate'), 1, 0);
    const wg = add('whale', by('compose'), 1, 0);
    whaleRef = wg.fish[0];
    // the whale makes an entrance
    whaleRef.x = -whaleRef.L * base * 0.42; whaleRef.y = lerp(swimTop(), swimBottom(), 0.3); whaleRef.vx = 60 * base; whaleRef.vy = 0; whaleRef.dir = 1;
    wg.gx = W * 0.55; wg.gy = whaleRef.y; wg.gt = 12;
    if (reduce) { whaleRef.x = W * 0.35; whaleRef.vx = 10 * base; }
    const bg = add('baby', by('whalebrew'), 3, 30 * base);
    bg.fish.forEach((f, i) => { f.x = whaleRef!.x - whaleRef!.L * base * (0.55 + i * 0.22); f.y = whaleRef!.y + (i - 1) * 40 * base + 30 * base; f.vx = 64 * base; f.dir = 1; });
    add('crab', by('machine'), 1, 0);
    add('cog', by('cog'), 3, 50 * base);
    const cl = add('clig', by('clig'), narrow ? 11 : 16, 30 * base);
    cl.fish.forEach((f, i) => { f.x = W + 10 + i * 22 * base; f.y = lerp(swimTop(), swimBottom(), 0.18); f.vx = -90 * base; f.dir = -1; });
    cl.gx = W * 0.3; cl.gy = lerp(swimTop(), swimBottom(), 0.2); cl.gt = 5;
    const ng = add('nes', by('jsnes'), 3, 50 * base);
    ng.fish.forEach((f, i) => (f.pal = i));
    add('django', by('django'), 1, 0);
    add('origami', by('arxiv-vanity'), 3, 50 * base);
    const pg = add('puffer', by('ukhas'), 1, 0);
    pg.fish[0].timer = 9;
    species.filter((s) => s.kind === 'small').forEach((s, i) => {
      const g = add('small', s, narrow ? 4 : 5, 26 * base);
      g.fish.forEach((f) => (f.pal = i));
    });
    // crab sits on the sand
    const crab = fish.find((f) => f.kind === 'crab')!;
    crab.x = W * (narrow ? 0.72 : 0.42); crab.z = 0.62;
    const dj = fish.find((f) => f.kind === 'django')!;
    dj.x = W * 0.7;
    order = [...fish].sort((a, b) => a.z - b.z);
    plankton = Array.from({ length: narrow ? 30 : 60 }, () => ({ x: Math.random() * W, y: rand(surfY, H - sandH), p: Math.random() * TAU, s: rand(0.6, 1.8) }));
  }

  // -------------------------------------------------- sizing
  let built = false;
  function resize() {
    const r = water.getBoundingClientRect();
    const nw = Math.round(r.width), nh = Math.round(r.height);
    if (nw === W && nh === H && built) return;
    const oldW = W, oldH = H;
    W = nw; H = nh;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    base = clamp(Math.sqrt(W * H) / 1050, 0.5, 1.15);
    surfY = Math.max(20, H * 0.045);
    sandH = clamp(H * 0.15, 64, 150);
    P = 26 * base; M = Math.ceil(P) + 6;
    buildBg(); buildShip(); buildSand(); buildKelp();
    chest.s = 92 * base;
    chest.x = W * (W < 700 ? 0.2 : 0.25);
    chest.y = sandAt(chest.x) + chest.s * 0.12;
    if (!built) { populate(); built = true; }
    else if (oldW && oldH) {
      for (const f of fish) { f.x *= W / oldW; f.y *= H / oldH; }
      for (const g of groups) { g.gx *= W / oldW; g.gy *= H / oldH; }
    }
    caustics?.resize(W, H, dpr);
  }

  // -------------------------------------------------- simulation
  function newGoal(g: Group) {
    const s = SPEC[g.kind as Fish['kind']];
    const margin = Math.min(W * 0.12, 120);
    g.gx = rand(margin, W - margin);
    g.gy = lerp(swimTop(), swimBottom(), rand(s.band[0], s.band[1]));
    g.gt = g.kind === 'clig' ? rand(3, 5) : g.kind === 'whale' ? rand(10, 16) : rand(5, 10);
  }

  function steer(f: Fish, tx: number, ty: number, maxS: number, w: number, arrive = 80) {
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const slow = Math.min(1, d / (arrive * base));
    return [((dx / d) * maxS * slow - f.vx) * w, ((dy / d) * maxS * slow - f.vy) * w];
  }

  function update(dt: number) {
    const motion = reduce ? 0.45 : 1;
    for (const g of groups) { g.gt -= dt; if (g.gt <= 0) newGoal(g); }
    const top = swimTop(), bot = swimBottom();
    for (const f of fish) {
      const s = SPEC[f.kind];
      f.sc = base * (0.7 + 0.45 * f.z);
      const len = f.L * f.sc;
      f.mouth = Math.max(0, f.mouth - dt * 2);
      f.panic = Math.max(0, f.panic - dt * 0.8);
      f.face = clamp(f.face + (f.held ? dt * 3.5 : -dt * 3), 0, 1);

      if (f.kind === 'crab') { updateCrab(f, dt, motion); continue; }

      let maxS = s.spd * base * motion * (1 + f.panic * 2.4) * (t < 6 && (f.kind === 'whale' || f.kind === 'baby') ? 2 : 1);
      let ax = 0, ay = 0;
      // goal
      let gx = f.g.gx + f.ox, gy = f.g.gy + f.oy;
      if (f.kind === 'baby' && whaleRef) {
        gx = whaleRef.x - Math.sign(whaleRef.dir || 1) * whaleRef.L * whaleRef.sc * (0.55 + f.i * 0.22);
        gy = whaleRef.y + whaleRef.L * whaleRef.sc * (0.12 + (f.i - 1) * 0.1);
        maxS *= 1.3;
      }
      if (f.kind === 'clig' && f.i > 0) {
        const p = f.g.fish[f.i - 1];
        const ps = Math.hypot(p.vx, p.vy) || 1;
        gx = p.x - (p.vx / ps) * 22 * base; gy = p.y - (p.vy / ps) * 22 * base;
        maxS *= 1.5;
        const [sx, sy] = steer(f, gx, gy, maxS, 6, 12);
        ax += sx; ay += sy;
      } else {
        const [sx, sy] = steer(f, gx, gy, maxS, 0.8);
        ax += sx; ay += sy;
      }
      // schooling
      if (s.sep > 0) {
        const sep = s.sep * base;
        let cx = 0, cy = 0, avx = 0, avy = 0, n = 0;
        for (const o of f.g.fish) {
          if (o === f) continue;
          const dx = f.x - o.x, dy = f.y - o.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < sep) { ax += (dx / d) * (1 - d / sep) * maxS * 3; ay += (dy / d) * (1 - d / sep) * maxS * 3; }
          if (d < sep * 3) { cx += o.x; cy += o.y; avx += o.vx; avy += o.vy; n++; }
        }
        if (n && f.kind !== 'clig') {
          ax += (avx / n - f.vx) * 0.6; ay += (avy / n - f.vy) * 0.6;
          ax += (cx / n - f.x) * 0.15; ay += (cy / n - f.y) * 0.15;
        }
      }
      // give the big ones room
      if (f.L < 120) {
        for (const b of fish) {
          if (b.L < 120 || b === f) continue;
          const bl = b.L * b.sc;
          const dx = f.x - b.x, dy = f.y - b.y;
          const rr = bl * 0.5 + len * 0.4;
          const d = Math.hypot(dx, dy * 1.6) || 1;
          if (d < rr) { ax += (dx / d) * (1 - d / rr) * maxS * 4; ay += (dy / d) * (1 - d / rr) * maxS * 4; }
        }
      }
      // food
      if (f.kind !== 'puffer' || f.mode === 'swim') {
        let best: Pellet | null = null, bd = 340 * base;
        for (const p of pellets) {
          if (p.dead) continue;
          const d = Math.hypot(p.x - f.x, p.y - f.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best && !f.held) {
          const [sx, sy] = steer(f, best.x, best.y, maxS * 1.6, 3);
          ax += sx; ay += sy;
          if (bd < len * 0.35 + 6) { best.dead = true; f.mouth = 1; puff(best.x, best.y, 2); }
        }
      }
      // puffer: inflate and float to the surface, like a balloon
      if (f.kind === 'puffer') {
        f.timer -= dt * motion;
        const r = len * 0.3 * (1 + f.infl * 1.25);
        if (f.mode === 'swim') {
          f.infl = Math.max(f.held ? 0.55 : 0, f.infl + (f.held ? dt * 2 : -dt * 1.5));
          if (f.held) f.infl = Math.min(f.infl, 0.55);
          if (f.timer < 0 && !f.held) { f.mode = 'inflate'; f.timer = 1.6; }
        } else if (f.mode === 'inflate') {
          f.infl = Math.min(1, f.infl + dt * 0.9);
          f.balloon = Math.min(1, f.balloon + dt * 0.6);
          ax = -f.vx * 3; ay = -f.vy * 3;
          if (f.timer < 0) f.mode = 'rise';
        } else if (f.mode === 'rise') {
          f.balloon = Math.min(1, f.balloon + dt);
          ax = -f.vx * 2 + Math.sin(t * 0.7) * 6 * base; ay = (-26 * base * motion - f.vy) * 2;
          maxS = 40 * base;
          if (f.y < surfY + r + 8) { f.mode = 'top'; f.timer = 5; }
        } else if (f.mode === 'top') {
          ax = -f.vx * 2 + Math.sin(t * 0.5) * 8 * base; ay = (surfY + r + 6 + Math.sin(t * 2) * 3 - f.y) * 4 - f.vy * 2;
          if (f.timer < 0) { f.mode = 'deflate'; f.timer = 1.4; }
        } else if (f.mode === 'deflate') {
          f.infl = Math.max(0, f.infl - dt * 0.8);
          f.balloon = Math.max(0, f.balloon - dt * 0.9);
          if (Math.random() < dt * 14) bubbles.push({ x: f.x + len * 0.3 * f.dir, y: f.y, r: rand(1.5, 3.5) * base, vy: -rand(40, 70) * base, ph: Math.random() * TAU });
          ay = (30 * base - f.vy) * 1.5;
          if (f.timer < 0 && f.infl <= 0.01) { f.mode = 'swim'; f.timer = rand(16, 26); f.balloon = 0; }
        }
      }
      // keep inside the glass
      const mx = Math.max(20, len * 0.35);
      const edge = 70 * base;
      const myTop = f.kind === 'puffer' && f.mode !== 'swim' ? surfY : top;
      const myBot = f.kind === 'django' || f.kind === 'angler' ? Math.min(bot + sandH * 0.25, sandAt(f.x) - len * 0.2) : bot;
      const entering = !reduce && t < 8 && (f.kind === 'whale' || f.kind === 'baby' || f.kind === 'clig');
      if (!entering) {
        if (f.x < mx + edge) ax += (mx + edge - f.x) * 2.2;
        if (f.x > W - mx - edge) ax -= (f.x - (W - mx - edge)) * 2.2;
      }
      if (f.y < myTop + edge * 0.5) ay += (myTop + edge * 0.5 - f.y) * 2.5;
      if (f.y > myBot - edge * 0.3) ay -= (f.y - (myBot - edge * 0.3)) * 2.5;

      if (f.held) {
        const k = Math.exp(-dt * 6);
        f.vx *= k; f.vy *= k;
      } else {
        f.vx += ax * dt; f.vy += ay * dt;
        const sp = Math.hypot(f.vx, f.vy);
        const lim = maxS * (f.kind === 'clig' ? 1.3 : 1);
        if (sp > lim) { f.vx *= lim / sp; f.vy *= lim / sp; }
        const min = s.spd * base * motion * 0.18;
        if (sp < min && f.kind !== 'puffer') { f.vx *= min / (sp || 1); f.vy *= min / (sp || 1); }
      }
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (!entering) f.x = clamp(f.x, mx * 0.6, W - mx * 0.6);
      f.y = clamp(f.y, (f.kind === 'puffer' ? surfY + 4 : top - 10), Math.max(top, myBot));
      // heading
      if (!f.held && Math.abs(f.vx) > 3 * base) f.dir += (Math.sign(f.vx) - f.dir) * Math.min(1, dt * (f.kind === 'clig' ? 10 : 3.2));
      const pt = clamp(Math.atan2(f.vy, Math.abs(f.vx) + 1e-3), -0.45, 0.45) * (f.kind === 'django' || f.kind === 'puffer' ? 0.15 : 1);
      f.pitch += (pt - f.pitch) * Math.min(1, dt * 3);
      const spd = Math.hypot(f.vx, f.vy);
      f.phase += dt * (f.held ? 2 : 2.4 + (spd / Math.max(len, 10)) * 7) * (reduce ? 0.6 : 1);
      f.glow = night;
    }
    // chest
    chest.timer -= dt;
    if (chest.timer < 0) { chest.target = chest.target ? 0 : 1; chest.timer = chest.target ? 2.2 : rand(9, 14); if (chest.target) burst(); }
    const want = chest.hover ? 1 : chest.target;
    chest.open += (want - chest.open) * Math.min(1, dt * 3.2);

    // bubbles
    if (Math.random() < dt * (reduce ? 5 : 14)) bubbles.push({ x: W * 0.9 + rand(-3, 3) + off(0.6), y: sandAt(W * 0.9) + 2, r: rand(1.2, 3.4) * base, vy: -rand(55, 90) * base, ph: Math.random() * TAU });
    if (whaleRef && Math.random() < dt * 0.12) for (let i = 0; i < 6; i++) bubbles.push({ x: whaleRef.sx + whaleRef.dir * whaleRef.L * whaleRef.sc * 0.25, y: whaleRef.sy - whaleRef.L * whaleRef.sc * 0.16, r: rand(2, 5) * base, vy: -rand(40, 70) * base, ph: Math.random() * TAU });
    for (const b of bubbles) {
      b.y += b.vy * dt * motion;
      b.ph += dt * 3;
      b.x += Math.sin(b.ph) * 0.4 * motion;
    }
    bubbles = bubbles.filter((b) => b.y > surfY + 2);
    if (bubbles.length > 220) bubbles.splice(0, bubbles.length - 220);
    // pellets
    for (const p of pellets) {
      if (p.dead) continue;
      const ground = sandAt(p.x) + 4;
      if (p.y < ground) {
        p.ph += dt * 2;
        p.vy = Math.min(p.vy + dt * 30, 26 * base);
        p.y += p.vy * dt * motion;
        p.x += Math.sin(p.ph) * 0.25;
      } else {
        p.rest += dt;
        if (p.rest > 14) p.dead = true;
      }
    }
    pellets = pellets.filter((p) => !p.dead);
    for (const r of ripples) r.t += dt;
    ripples = ripples.filter((r) => r.t < 1.2);
    for (const p of prints) p.t += dt;
    prints = prints.filter((p) => p.t < 7);
    kelpWob = Math.max(0, kelpWob - dt * 0.7);
  }

  function updateCrab(f: Fish, dt: number, motion: number) {
    f.timer -= dt;
    if (f.timer < 0) {
      if (f.mode === 'walk') { f.mode = 'rest'; f.timer = rand(2, 5); }
      else { f.mode = 'walk'; f.timer = rand(3, 7); f.ox = clamp(f.x + rand(-1, 1) * W * 0.25, W * 0.08, W * 0.92); }
    }
    // pellets on the sand
    let target = f.ox;
    for (const p of pellets) if (p.rest > 0 && Math.abs(p.x - f.x) < 220 * base) { target = p.x; f.mode = 'walk'; if (Math.abs(p.x - f.x) < 12 * base) { p.dead = true; f.mouth = 1; } break; }
    const want = f.held || f.mode !== 'walk' ? 0 : clamp((target - f.x) * 0.8, -1, 1) * SPEC.crab.spd * base * motion * (1 + f.panic * 4);
    f.vx += (want - f.vx) * Math.min(1, dt * 3);
    if (f.panic > 0.3 && !f.held) f.vx += Math.sign(f.vx || 1) * f.panic * 20 * base * dt;
    f.x = clamp(f.x + f.vx * dt, W * 0.04, W * 0.96);
    f.y = sandAt(f.x) + 6 * base;
    f.walk = Math.min(1, Math.abs(f.vx) / (8 * base));
    f.phase += dt * f.walk * 9;
    if (Math.abs(f.vx) > 1) f.dir += (Math.sign(f.vx) - f.dir) * Math.min(1, dt * 6);
    f.sc = base * (0.7 + 0.45 * f.z);
  }

  function puff(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) bubbles.push({ x: x + rand(-4, 4), y, r: rand(1, 2.2) * base, vy: -rand(30, 60) * base, ph: Math.random() * TAU });
  }
  function burst() {
    for (let i = 0; i < 10; i++) bubbles.push({ x: chest.x + rand(-0.3, 0.3) * chest.s, y: chest.y - chest.s * 0.5, r: rand(2, 6) * base, vy: -rand(40, 90) * base, ph: Math.random() * TAU });
  }

  // -------------------------------------------------- rendering
  function render() {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.drawImage(bgL.c, -M + off(0.1), -M + offY(0.1), bgL.w, bgL.h);
    // tank light falling through the surface
    c.drawImage(shipL.c, ship.x + off(0.3), ship.y + offY(0.3), ship.w, ship.h);
    for (const f of order) if (f.z < 0.3) { f.sx = f.x + off(fishD(f.z)); f.sy = f.y + offY(fishD(f.z)); drawFish(f); }
    c.fillStyle = 'rgba(22,86,112,.16)';
    c.fillRect(0, 0, W, H);
    for (const k of kelp) if (k.d < 1) drawKelp(k);
    const sandTop = H - sandH * 1.35;
    c.drawImage(sandL.c, 0, sandTop, W, H - sandTop);
    drawChest();
    for (const p of pellets) {
      c.fillStyle = '#c4772c';
      c.beginPath(); c.arc(p.x, p.y, 2.6 * base, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,220,160,.6)';
      c.beginPath(); c.arc(p.x - 0.8, p.y - 0.8, 1 * base, 0, TAU); c.fill();
    }
    for (const f of order) if (f.z >= 0.3) { f.sx = f.x + off(fishD(f.z)); f.sy = f.y + offY(fishD(f.z)); drawFish(f); }
    // bubbles
    c.lineWidth = 1;
    for (const b of bubbles) {
      c.strokeStyle = 'rgba(225,248,255,.6)';
      c.fillStyle = 'rgba(200,240,255,.12)';
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.beginPath(); c.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, TAU); c.fill();
    }
    for (const k of kelp) if (k.d >= 1) drawKelp(k);
    drawSurface();

    // night
    if (night > 0.01) {
      c.globalCompositeOperation = 'multiply';
      const r = Math.round(lerp(255, 46, night)), g = Math.round(lerp(255, 62, night)), b = Math.round(lerp(255, 112, night));
      c.fillStyle = `rgb(${r},${g},${b})`;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      for (const p of plankton) {
        p.p += 0.02;
        const a = (0.5 + 0.5 * Math.sin(p.p * p.s * 2)) * night * 0.7;
        c.fillStyle = `rgba(120,255,220,${a})`;
        c.fillRect(p.x + Math.sin(p.p) * 6, p.y + Math.cos(p.p * 0.7) * 4, p.s * 1.4, p.s * 1.4);
      }
      c.globalCompositeOperation = 'source-over';
      c.shadowColor = `rgba(110,255,170,${night})`;
      c.shadowBlur = 10;
      for (const f of fish) if (f.kind === 'clig') { c.save(); c.translate(f.sx, f.sy); c.rotate(f.face > 0.5 ? 0 : f.pitch * Math.sign(f.dir || 1)); c.scale(xScale(f) * f.sc, f.sc); D.clig(c, f, t, night, f.face > 0.5); c.restore(); }
      c.shadowBlur = 0;
    }
    // the lure, which matters more after dark
    for (const f of fish) if (f.kind === 'angler') drawLureGlow(f);
    c.globalCompositeOperation = 'source-over';
    drawGlassMarks();
  }

  function drawLureGlow(f: Fish) {
    const c = ctx;
    const [lx, ly] = lurePos(f);
    const R = f.L * f.sc * (0.9 + night * 2.4);
    c.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.15 * Math.sin(t * 3 + f.seed);
    const g = c.createRadialGradient(lx, ly, 0, lx, ly, R);
    g.addColorStop(0, `rgba(170,255,235,${(0.35 + night * 0.4) * pulse})`);
    g.addColorStop(0.15, `rgba(90,240,210,${(0.12 + night * 0.18) * pulse})`);
    g.addColorStop(1, 'rgba(60,200,190,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(lx, ly, R, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  function lurePos(f: Fish): [number, number] {
    const front = f.face > 0.5;
    const [lx, ly] = front ? [0, -f.L * 0.5] : D.anglerLure(f, t);
    const sxs = xScale(f);
    const rot = front ? 0 : f.pitch * Math.sign(f.dir || 1);
    const x = lx * sxs * f.sc, y = ly * f.sc;
    return [f.sx + x * Math.cos(rot) - y * Math.sin(rot), f.sy + x * Math.sin(rot) + y * Math.cos(rot)];
  }
  function xScale(f: Fish) {
    if (f.face > 0.5) return Math.max(0.04, (f.face - 0.5) * 2);
    const d = f.dir === 0 ? 1 : f.dir;
    const s = (1 - f.face * 2) * d;
    return Math.abs(s) < 0.04 ? 0.04 * Math.sign(d) : s;
  }

  const look = { x: 1, y: 0 };
  function drawFish(f: Fish) {
    const c = ctx;
    const front = f.face > 0.5;
    const sx = xScale(f);
    c.save();
    c.translate(f.sx, f.sy);
    if (!front && f.kind !== 'crab') c.rotate(f.pitch * Math.sign(f.dir || 1));
    c.scale(sx * f.sc, f.sc);
    if (f.held || front) {
      let lx = (pointer.x - f.sx), ly = (pointer.y - f.sy);
      const d = Math.hypot(lx, ly) || 1;
      look.x = clamp(lx / d, -1, 1) * (front ? 1 : Math.sign(sx)); look.y = clamp(ly / d, -1, 1);
      if (!pointer.inside) { look.x = 0; look.y = 0.2; }
    } else { look.x = 0.8; look.y = 0.1; }
    switch (f.kind) {
      case 'whale': front ? D.whaleFront(c, f, t, look, false) : D.whale(c, f, t, look, false); break;
      case 'baby': front ? D.whaleFront(c, f, t, look, true) : D.whale(c, f, t, look, true); break;
      case 'cog': front ? frontCog(f) : D.cog(c, f, t, look); break;
      case 'nes': D.nes(c, f, t, front); break;
      case 'clig': D.clig(c, f, t, 0, front); break;
      case 'django': front ? D.genericFront(c, f, t, look, '#0c4b33', '#44b78b', 0.5, 0.14) : D.guitar(c, f, t, look); break;
      case 'origami': front ? D.genericFront(c, f, t, look, '#efe8d8', '#d6ccb6', 0.42, 0.52) : D.origami(c, f, t, look); break;
      case 'puffer': D.puffer(c, f, t, look, front); break;
      case 'angler': D.angler(c, f, t, look, front); break;
      case 'crab': D.crab(c, f, t, look, front, f.walk); break;
      case 'small': D.small(c, f, t, look, front); break;
    }
    c.restore();
  }
  function frontCog(f: Fish) {
    D.cog(ctx, f, t, look);
    // a second eye, so it can look at you properly
    const R = f.L * 0.27;
    ctx.fillStyle = '#7d5414';
    ctx.beginPath(); ctx.arc(-R * 0.1, -R * 0.3, R * 0.36, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fbfdff';
    ctx.beginPath(); ctx.arc(-R * 0.1, -R * 0.3, R * 0.28, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0b1116';
    ctx.beginPath(); ctx.arc(-R * 0.1 + look.x * R * 0.1, -R * 0.3 + look.y * R * 0.1, R * 0.16, 0, TAU); ctx.fill();
  }

  function drawChest() {
    const c = ctx;
    const s = chest.s, x = chest.x, y = chest.y;
    const w = s, h = s * 0.5;
    c.save();
    c.translate(x, y);
    c.rotate(-0.06);
    // glow inside
    if (chest.open > 0.05) {
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(0, -h, 0, 0, -h, s * 1.1);
      g.addColorStop(0, `rgba(255,214,120,${0.45 * chest.open})`); g.addColorStop(1, 'rgba(255,200,90,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, -h, s * 1.1, 0, TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
      // the treasure: a gold coin with a familiar face
      const cr = s * 0.24;
      const cy = -h - cr * 0.4 - chest.open * s * 0.32;
      c.save();
      c.translate(0, cy);
      c.scale(0.4 + chest.open * 0.6, 0.4 + chest.open * 0.6);
      c.fillStyle = '#d9a73a';
      c.beginPath(); c.arc(0, 0, cr * 1.16, 0, TAU); c.fill();
      if (face.complete && face.naturalWidth) {
        c.save();
        c.beginPath(); c.arc(0, 0, cr, 0, TAU); c.clip();
        c.drawImage(face, -cr, -cr, cr * 2, cr * 2);
        c.globalCompositeOperation = 'color';
        c.fillStyle = '#c8952e'; c.fillRect(-cr, -cr, cr * 2, cr * 2);
        c.globalCompositeOperation = 'source-over';
        c.restore();
      }
      c.strokeStyle = '#f7df92'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, cr * 1.08, 0, TAU); c.stroke();
      c.restore();
      // coins
      c.fillStyle = '#e8b947';
      for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(-w * 0.3 + i * w * 0.1, -h + 2 - (i % 2) * 3, s * 0.06, s * 0.03, 0, 0, TAU); c.fill(); }
    }
    // box
    const wood = c.createLinearGradient(0, -h, 0, 0);
    wood.addColorStop(0, '#7a4a22'); wood.addColorStop(1, '#4b2c13');
    c.fillStyle = wood;
    c.fillRect(-w / 2, -h, w, h);
    c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1;
    for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(-w / 2, -h + (h * i) / 3); c.lineTo(w / 2, -h + (h * i) / 3); c.stroke(); }
    c.fillStyle = '#8b7a4a';
    for (const bx of [-0.36, 0.36]) c.fillRect(bx * w - s * 0.04, -h, s * 0.08, h);
    c.fillStyle = '#c9a340';
    c.fillRect(-s * 0.06, -h + 2, s * 0.12, s * 0.15);
    c.fillStyle = '#2a1a08';
    c.beginPath(); c.arc(0, -h + s * 0.1, s * 0.02, 0, TAU); c.fill();
    // lid, hinged at the back
    c.save();
    c.translate(-w / 2, -h);
    c.scale(1, 1);
    const ang = -chest.open * 0.9;
    c.translate(w / 2, 0);
    c.scale(1, Math.cos(chest.open * 1.25));
    c.translate(0, 0);
    c.fillStyle = '#6b3f1c';
    c.beginPath();
    c.moveTo(-w / 2, 0);
    c.bezierCurveTo(-w / 2, -h * 0.75, w / 2, -h * 0.75, w / 2, 0);
    c.closePath(); c.fill();
    c.fillStyle = '#8b7a4a';
    for (const bx of [-0.36, 0.36]) { c.beginPath(); c.moveTo(bx * w - s * 0.04, 0); c.lineTo(bx * w - s * 0.04, -h * 0.5); c.lineTo(bx * w + s * 0.04, -h * 0.5); c.lineTo(bx * w + s * 0.04, 0); c.fill(); }
    c.restore();
    void ang;
    c.restore();
    // half-buried: a little sand mound in front
    c.fillStyle = '#c1a678';
    c.beginPath(); c.ellipse(x - w * 0.15, y + 2, w * 0.55, s * 0.09, 0, 0, TAU); c.fill();
  }

  function drawSurface() {
    const c = ctx;
    // air gap above the water line
    const g = c.createLinearGradient(0, 0, 0, surfY);
    g.addColorStop(0, '#1d3a46'); g.addColorStop(1, '#4b8ea4');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(W, 0);
    const amp = 1.6 + kelpWob * 3;
    const wave = (x: number) => surfY + Math.sin(x * 0.018 + t * 1.6) * amp + Math.sin(x * 0.047 - t * 2.3) * amp * 0.5;
    for (let x = W; x >= 0; x -= 8) c.lineTo(x, wave(x));
    c.closePath(); c.fill();
    // underside of the surface, a silvery mirror
    const u = c.createLinearGradient(0, surfY, 0, surfY + 46 * base);
    u.addColorStop(0, 'rgba(200,240,250,.42)'); u.addColorStop(1, 'rgba(200,240,250,0)');
    c.fillStyle = u;
    c.beginPath();
    for (let x = 0; x <= W; x += 8) c.lineTo(x, wave(x));
    c.lineTo(W, surfY + 46 * base); c.lineTo(0, surfY + 46 * base); c.fill();
    c.strokeStyle = 'rgba(235,252,255,.85)'; c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 0; x <= W; x += 8) x ? c.lineTo(x, wave(x)) : c.moveTo(x, wave(x));
    c.stroke();
    c.strokeStyle = 'rgba(235,252,255,.18)'; c.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      c.beginPath();
      for (let x = 0; x <= W; x += 10) { const y = wave(x) + k * 7 * base + Math.sin(x * 0.03 + t * 1.2 + k) * 2; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
  }

  function drawGlassMarks() {
    const c = ctx;
    for (const r of ripples) {
      const k = r.t / 1.2;
      c.strokeStyle = `rgba(230,250,255,${0.55 * (1 - k)})`;
      c.lineWidth = 2;
      for (const m of [1, 0.6]) { c.beginPath(); c.arc(r.x, r.y, (10 + k * 120 * m) * base, 0, TAU); c.stroke(); }
    }
    for (const p of prints) {
      const a = 0.16 * Math.min(1, (7 - p.t) / 3);
      c.save(); c.translate(p.x, p.y); c.rotate(p.r);
      c.strokeStyle = `rgba(235,245,250,${a})`; c.lineWidth = 0.9;
      for (let i = 1; i < 9; i++) {
        c.beginPath(); c.ellipse(0, 0, i * 1.5, i * 2, 0, (i % 3) * 0.4, TAU - 0.6 - (i % 2) * 0.5); c.stroke();
      }
      c.restore();
    }
  }

  // -------------------------------------------------- interaction
  let hovered: Fish | 'chest' | null = null;
  let pinned: Fish | 'chest' | null = null;
  let hideTimer = 0;
  let overCard = false;
  const tapLog: number[] = [];

  function hit(x: number, y: number, touch: boolean): Fish | 'chest' | null {
    let best: Fish | null = null, bd = Infinity;
    for (let i = order.length - 1; i >= 0; i--) {
      const f = order[i];
      const s = SPEC[f.kind];
      const len = f.L * f.sc;
      let hx = len * s.hit[0], hy = len * s.hit[1];
      if (f.kind === 'puffer') { hx *= 1 + f.infl * 1.25; hy *= 1 + f.infl * 1.25; }
      const minR = touch ? 22 : 13;
      hx = Math.max(hx, minR); hy = Math.max(hy, minR);
      const cy = f.kind === 'crab' ? f.sy - len * 0.25 : f.sy;
      const dx = (x - f.sx) / hx, dy = (y - cy) / hy;
      const d = dx * dx + dy * dy;
      if (d < 1) {
        if (!touch) return f;
        if (d < bd) { bd = d; best = f; }
      }
    }
    if (best) return best;
    const cs = chest.s;
    if (Math.abs(x - chest.x) < cs * 0.6 && y > chest.y - cs * 0.85 && y < chest.y + cs * 0.1) return 'chest';
    return null;
  }

  function setActive(target: Fish | 'chest' | null) {
    for (const f of fish) f.held = false;
    chest.hover = false;
    if (target === 'chest') chest.hover = true;
    else if (target) target.held = true;
    if (!target) { hideCard(); return; }
    showCard(target === 'chest' ? keeper : target.info, target);
  }

  let cardFor: unknown = null;
  function showCard(info: Info, target: unknown) {
    if (cardFor !== target) {
      const idx = species.indexOf(info);
      (document.getElementById('card-kick') as HTMLElement).innerHTML =
        info.now ? 'No. 01 · <b>Currently working on</b>' : info.kind === 'small' ? 'Also worked on' : info.kind === 'chest' ? 'The keeper' : `Specimen No. ${String(idx + 1).padStart(2, '0')}`;
      (document.getElementById('card-name') as HTMLElement).textContent = info.name;
      (document.getElementById('card-latin') as HTMLElement).textContent = info.latin;
      (document.getElementById('card-blurb') as HTMLElement).textContent = info.kind === 'small' ? 'One of the things I also worked on.' : info.blurb.charAt(0).toUpperCase() + info.blurb.slice(1) + '.';
      (document.getElementById('card-habit') as HTMLElement).textContent = info.habit;
      const a = document.getElementById('card-link') as HTMLAnchorElement;
      a.href = info.url;
      a.textContent = prettyUrl(info.url) + (info.url.startsWith('mailto:') ? ' ✉' : ' ↗');
      cardEl.style.setProperty('--c', info.color);
      cardEl.hidden = false;
      cardEl.classList.remove('in'); void cardEl.offsetWidth; cardEl.classList.add('in');
      cardFor = target;
    }
    clearTimeout(hideTimer);
  }
  function hideCard() {
    cardEl.hidden = true; cardFor = null;
  }
  function placeCard() {
    const target = pinned || hovered;
    if (!target || cardEl.hidden) return;
    let ax: number, top: number, bottom: number;
    if (target === 'chest') { ax = chest.x; top = chest.y - chest.s * (0.6 + chest.open * 0.75); bottom = chest.y; }
    else {
      const len = target.L * target.sc;
      const hh = target.kind === 'puffer' ? len * 0.3 * (1 + target.infl * 1.25) + len * 0.08 : target.kind === 'crab' ? len * 0.6 : len * SPEC[target.kind].hit[1] * 1.15;
      ax = target.sx; top = target.sy - hh - (target.kind === 'whale' ? len * 0.2 : target.kind === 'angler' ? len * 0.3 : 0); bottom = target.sy + hh;
    }
    const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    let x = clamp(ax - cw / 2, 8, W - cw - 8);
    let y = top - ch - 12;
    if (y < 8) y = Math.min(bottom + 12, H - ch - 8);
    cardEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  const local = (e: PointerEvent | MouseEvent) => {
    const r = water.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  water.addEventListener('pointermove', (e) => {
    if ((e.target as HTMLElement).closest('.card')) return;
    const [x, y] = local(e);
    pointer.x = x; pointer.y = y; pointer.inside = true;
    if (e.pointerType === 'mouse') {
      cam.tx = (x / W - 0.5) * 2; cam.ty = (y / H - 0.5) * 2;
      const h = hit(x, y, false);
      water.classList.toggle('over', !!h);
      water.classList.toggle('feed', !h && y < surfY + 44 * base);
      if (!pinned) {
        if (h) { hovered = h; setActive(h); }
        else if (hovered) {
          clearTimeout(hideTimer);
          hideTimer = window.setTimeout(() => { if (!overCard && !pinned) { hovered = null; setActive(null); } }, 450);
        }
      }
    }
  });
  water.addEventListener('pointerleave', () => { pointer.inside = false; cam.tx = 0; cam.ty = 0; });
  cardEl.addEventListener('pointerenter', () => { overCard = true; clearTimeout(hideTimer); });
  cardEl.addEventListener('pointerleave', () => { overCard = false; if (!pinned) hideTimer = window.setTimeout(() => { hovered = null; setActive(null); }, 350); });

  let down: { x: number; y: number; t: number } | null = null;
  water.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.card')) return;
    const [x, y] = local(e);
    down = { x, y, t: performance.now() };
  });
  water.addEventListener('pointerup', (e) => {
    if (!down || (e.target as HTMLElement).closest('.card')) { down = null; return; }
    const [x, y] = local(e);
    if (Math.hypot(x - down.x, y - down.y) > 14) { down = null; return; }
    down = null;
    pointer.x = x; pointer.y = y;
    tap(x, y, e.pointerType !== 'mouse');
  });

  function tap(x: number, y: number, touch: boolean) {
    const h = hit(x, y, touch);
    if (h) {
      pinned = h === pinned ? null : h;
      hovered = h;
      setActive(h);
      if (!pinned && touch) { hovered = null; setActive(null); }
      return;
    }
    if (pinned || hovered) { pinned = null; hovered = null; setActive(null); }
    if (y < surfY + 44 * base) feed(x);
    else knock(x, y);
  }

  function feed(x: number) {
    const n = 6;
    for (let i = 0; i < n; i++) pellets.push({ x: clamp(x + rand(-22, 22) * base, 6, W - 6), y: surfY + rand(1, 6), vy: rand(2, 8), ph: Math.random() * TAU, rest: 0, dead: false });
    if (pellets.length > 60) pellets.splice(0, pellets.length - 60);
    ripples.push({ x, y: surfY + 2, t: 0.3 });
  }

  function knock(x: number, y: number) {
    ripples.push({ x, y, t: 0 });
    prints.push({ x, y, t: 0, r: rand(-0.6, 0.6) });
    if (prints.length > 6) prints.shift();
    kelpWob = 1;
    const R = 300 * base;
    const strength = (reduce ? 180 : 520) * base;
    for (const f of fish) {
      const dx = f.sx - x, dy = f.sy - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const k = 1 - d / R;
      f.vx += (dx / d) * strength * k;
      f.vy += (dy / d) * strength * k * 0.7;
      f.panic = Math.max(f.panic, reduce ? k * 0.3 : k);
      if (f.kind === 'puffer' && f.mode === 'swim' && k > 0.3) { f.mode = 'inflate'; f.timer = 1.2; }
    }
    const now = performance.now();
    tapLog.push(now);
    while (tapLog.length && now - tapLog[0] > 2500) tapLog.shift();
    if (tapLog.length >= 3) {
      sticker.classList.remove('shake'); void sticker.offsetWidth; sticker.classList.add('shake');
      tapLog.length = 0;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { pinned = null; hovered = null; setActive(null); }
  });

  // -------------------------------------------------- lights and field guide
  const lightsBtn = document.getElementById('lights') as HTMLButtonElement;
  const syncLights = () => lightsBtn.setAttribute('aria-checked', String(html.dataset.lights !== 'off'));
  syncLights();
  lightsBtn.addEventListener('click', () => {
    html.dataset.lights = html.dataset.lights === 'off' ? 'on' : 'off';
    syncLights();
  });
  const guide = document.getElementById('guide') as HTMLElement;
  const guideBtn = document.getElementById('guide-btn') as HTMLButtonElement;
  const guideClose = document.getElementById('guide-close') as HTMLButtonElement;
  const openGuide = (focus: boolean) => {
    guide.classList.add('open'); guideBtn.setAttribute('aria-expanded', 'true');
    if (focus) guideClose.focus();
  };
  const closeGuide = () => {
    guide.classList.remove('open'); guideBtn.setAttribute('aria-expanded', 'false');
    guideBtn.focus();
  };
  guideBtn.addEventListener('click', () => (guide.classList.contains('open') ? closeGuide() : openGuide(true)));
  guideClose.addEventListener('click', closeGuide);
  guide.addEventListener('click', (e) => { if (e.target === guide) closeGuide(); });
  guide.addEventListener('focusin', () => { if (!guide.classList.contains('open')) openGuide(false); });
  guide.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGuide(); });

  // -------------------------------------------------- loop
  let raf = 0, last = 0;
  const perf = { js: 0 };
  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    t += dt;
    const targetNight = html.dataset.lights === 'off' ? 1 : 0;
    night += (targetNight - night) * Math.min(1, dt * 2.2);
    cam.x += (cam.tx - cam.x) * Math.min(1, dt * 2.5);
    cam.y += (cam.ty - cam.y) * Math.min(1, dt * 2.5);
    const t0 = performance.now();
    update(dt);
    render();
    placeCard();
    perf.js = perf.js * 0.95 + (performance.now() - t0) * 0.05;
    caustics?.render(reduce ? 4 : t, surfY, H - sandH * 1.05, night, cam.x * (reduce ? 0 : 1));
  }
  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reduceQ.addEventListener('change', () => { reduce = reduceQ.matches; });

  resize();
  new ResizeObserver(() => resize()).observe(water);
  document.fonts?.ready.then(() => { buildShip(); });
  document.fonts?.load('600 40px Fraunces').then(() => buildShip()).catch(() => {});
  start();

  // test hooks
  (window as any).__tank = { perf, fish, groups, chest, tap: (x: number, y: number, touch = false) => tap(x, y, touch), get pellets() { return pellets; } };
}
