// Procedural species drawings. Every function draws a fish facing +x,
// centred on the origin, `L` pixels long (the caller scales and flips).
import { SMALL_COLORS } from './species';

type C = CanvasRenderingContext2D;
export type Look = { x: number; y: number }; // unit-ish vector toward the viewer's pointer

export interface Drawable {
  L: number;
  phase: number;
  seed: number;
  infl: number; // puffer inflation 0..1
  balloon: number; // puffer payload visibility 0..1
  pal: number; // palette index
  glow: number; // extra glow (night)
  held: boolean;
  mouth: number;
}

const TAU = Math.PI * 2;

function eye(c: C, x: number, y: number, r: number, look: Look, white = '#fbfdff', pupil = '#0b1116') {
  c.fillStyle = white;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.fillStyle = pupil;
  c.beginPath(); c.arc(x + look.x * r * 0.35, y + look.y * r * 0.35, r * 0.58, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,.9)';
  c.beginPath(); c.arc(x + look.x * r * 0.35 - r * 0.22, y + look.y * r * 0.35 - r * 0.24, r * 0.2, 0, TAU); c.fill();
}

// ---------------------------------------------------------------- whale
const CONTAINER = ['#f08a3c', '#2a9d8f', '#e9c46a', '#e76f51', '#f4f1de', '#7fb3d5', '#8ab17d', '#d1495b'];

export function whale(c: C, f: Drawable, t: number, look: Look, baby: boolean) {
  const L = f.L;
  const h = L * (baby ? 0.46 : 0.34);
  const sw = Math.sin(f.phase);
  const top = baby ? '#4f9fe6' : '#2b73c2';
  const mid = baby ? '#6db6f0' : '#3c8fdc';

  // tail flukes
  c.save();
  c.translate(-L * 0.4, -h * 0.05);
  c.rotate(sw * 0.22);
  c.fillStyle = top;
  c.beginPath();
  c.moveTo(L * 0.04, -h * 0.16);
  c.quadraticCurveTo(-L * 0.04, -h * 0.25, -L * 0.13, -h * 0.62);
  c.quadraticCurveTo(-L * 0.09, -h * 0.2, -L * 0.025, -h * 0.02);
  c.quadraticCurveTo(-L * 0.1, h * 0.12, -L * 0.15, h * 0.42);
  c.quadraticCurveTo(-L * 0.05, h * 0.18, L * 0.04, h * 0.14);
  c.closePath(); c.fill();
  c.restore();

  // body
  const g = c.createLinearGradient(0, -h * 0.6, 0, h * 0.55);
  g.addColorStop(0, top); g.addColorStop(0.5, mid); g.addColorStop(0.62, '#a8d8f4'); g.addColorStop(1, '#d7eefa');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(L * 0.49, -h * 0.02);
  c.bezierCurveTo(L * 0.5, -h * 0.62, L * 0.22, -h * 0.66, -L * 0.02, -h * 0.56);
  c.bezierCurveTo(-L * 0.2, -h * 0.48, -L * 0.33, -h * 0.24, -L * 0.42, -h * 0.12);
  c.lineTo(-L * 0.42, h * 0.08);
  c.bezierCurveTo(-L * 0.3, h * 0.3, -L * 0.1, h * 0.56, L * 0.14, h * 0.5);
  c.bezierCurveTo(L * 0.36, h * 0.46, L * 0.49, h * 0.3, L * 0.49, -h * 0.02);
  c.fill();

  // belly grooves
  if (!baby) {
    c.strokeStyle = 'rgba(60,110,150,.35)';
    c.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const yy = h * (0.22 + i * 0.07);
      c.beginPath();
      c.moveTo(L * (0.42 - i * 0.015), yy);
      c.quadraticCurveTo(L * 0.15, yy + h * 0.08, -L * (0.02 + i * 0.03), yy + h * 0.02);
      c.stroke();
    }
  }

  // flipper
  c.save();
  c.translate(L * 0.12, h * 0.3);
  c.rotate(0.5 + Math.sin(f.phase + 1.3) * 0.25);
  c.fillStyle = top;
  c.beginPath(); c.ellipse(-L * 0.06, 0, L * 0.09, h * 0.1, 0, 0, TAU); c.fill();
  c.restore();

  // eye + smile
  eye(c, L * (baby ? 0.3 : 0.32), h * 0.02, baby ? L * 0.045 : L * 0.022, look);
  c.strokeStyle = 'rgba(20,50,90,.55)';
  c.lineWidth = baby ? 1.6 : 2;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(L * 0.47, h * 0.12);
  c.quadraticCurveTo(L * 0.42, h * 0.24, L * 0.3, h * 0.2);
  c.stroke();
  if (baby) {
    c.fillStyle = 'rgba(255,140,170,.35)';
    c.beginPath(); c.ellipse(L * 0.33, h * 0.2, L * 0.04, h * 0.06, 0, 0, TAU); c.fill();
  }

  if (baby) {
    // a single tiny package
    const bw = L * 0.14;
    c.save();
    c.translate(-L * 0.02, -h * 0.58);
    c.rotate(Math.sin(t * 1.7 + f.seed) * 0.08);
    c.fillStyle = '#c99a5b';
    c.fillRect(-bw / 2, -bw * 0.8, bw, bw * 0.8);
    c.fillStyle = '#e8c48a';
    c.fillRect(-bw * 0.08, -bw * 0.8, bw * 0.16, bw * 0.8);
    c.restore();
    return;
  }

  // containers on the back, Docker style
  const bw = L * 0.085, bh = bw * 0.82;
  const rows = [
    { n: 4, y: 0, off: 0 },
    { n: 3, y: 1, off: 0.5 },
    { n: 1, y: 2, off: 1.5 },
  ];
  let k = 0;
  for (const r of rows) {
    for (let i = 0; i < r.n; i++) {
      const bx = -L * 0.2 + (i + r.off) * bw * 1.06;
      const curve = Math.pow((bx + bw / 2 - L * 0.0) / (L * 0.32), 2) * h * 0.22;
      const by = -h * 0.5 + curve - (r.y + 1) * bh * 1.04 + bh * 0.25;
      const col = CONTAINER[(k + f.seed) % CONTAINER.length];
      k++;
      c.save();
      c.translate(bx + bw / 2, by + bh / 2);
      c.rotate(Math.sin(t * 1.2 + k * 1.7) * 0.03 + Math.sin(f.phase) * 0.01);
      c.fillStyle = col;
      c.fillRect(-bw / 2, -bh / 2, bw, bh);
      c.fillStyle = 'rgba(0,0,0,.16)';
      for (let j = 1; j < 5; j++) c.fillRect(-bw / 2 + (bw * j) / 5 - 0.6, -bh / 2 + 2, 1.2, bh - 4);
      c.strokeStyle = 'rgba(0,0,0,.35)';
      c.lineWidth = 1;
      c.strokeRect(-bw / 2 + 0.5, -bh / 2 + 0.5, bw - 1, bh - 1);
      c.fillStyle = 'rgba(255,255,255,.25)';
      c.fillRect(-bw / 2, -bh / 2, bw, 2);
      c.restore();
    }
  }
}

export function whaleFront(c: C, f: Drawable, t: number, look: Look, baby: boolean) {
  const L = f.L;
  const w = L * (baby ? 0.42 : 0.36), h = L * (baby ? 0.44 : 0.33);
  const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, baby ? '#4f9fe6' : '#2b73c2'); g.addColorStop(0.6, '#5aa5e8'); g.addColorStop(1, '#d7eefa');
  // flippers
  c.fillStyle = baby ? '#4f9fe6' : '#2b73c2';
  for (const s of [-1, 1]) {
    c.save(); c.translate(s * w * 0.45, h * 0.2); c.rotate(s * (0.6 + Math.sin(f.phase) * 0.2));
    c.beginPath(); c.ellipse(s * w * 0.15, 0, w * 0.22, h * 0.08, 0, 0, TAU); c.fill(); c.restore();
  }
  c.fillStyle = g;
  c.beginPath(); c.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); c.fill();
  eye(c, -w * 0.3, -h * 0.02, L * (baby ? 0.05 : 0.026), look);
  eye(c, w * 0.3, -h * 0.02, L * (baby ? 0.05 : 0.026), look);
  c.strokeStyle = 'rgba(20,50,90,.6)'; c.lineWidth = 2; c.lineCap = 'round';
  c.beginPath(); c.arc(0, h * 0.12, w * 0.22, 0.2, Math.PI - 0.2); c.stroke();
  if (!baby) {
    const bw = L * 0.085, bh = bw * 0.82;
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3 - r; i++) {
      c.fillStyle = CONTAINER[(i + r * 3 + f.seed) % CONTAINER.length];
      const x = (i - (2 - r) / 2) * bw * 1.06 - bw / 2;
      const y = -h * 0.46 - (r + 1) * bh;
      c.fillRect(x, y, bw, bh);
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
    }
  }
}

// ---------------------------------------------------------------- cog
function gearPath(c: C, r: number, teeth: number, depth: number, rot: number) {
  c.beginPath();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * TAU;
    const phase = i % 4;
    const rr = phase === 1 || phase === 2 ? r + depth : r;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}

let brass: CanvasGradient | null = null;
export function cog(c: C, f: Drawable, t: number, look: Look) {
  const L = f.L;
  const R = L * 0.27;
  const sw = Math.sin(f.phase);
  // fan tail of riveted brass plate
  c.save();
  c.translate(-R * 0.75, 0);
  c.rotate(sw * 0.3);
  c.fillStyle = '#b98a3a';
  c.beginPath();
  c.moveTo(0, 0);
  c.arc(0, 0, L * 0.3, Math.PI - 0.55, Math.PI + 0.55);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(80,50,10,.55)'; c.lineWidth = 1;
  c.beginPath();
  for (let i = -2; i <= 2; i++) { const a = Math.PI + i * 0.2; c.moveTo(0, 0); c.lineTo(Math.cos(a) * L * 0.3, Math.sin(a) * L * 0.3); }
  c.stroke();
  c.restore();
  // wind-up key
  c.save();
  c.translate(-R * 0.05, -R - L * 0.05);
  const k = Math.cos(t * 4 + f.seed);
  c.fillStyle = '#9aa0a6';
  c.fillRect(-1.5, 0, 3, L * 0.07);
  c.scale(k, 1);
  c.beginPath(); c.ellipse(-L * 0.055, -2, L * 0.05, L * 0.036, 0, 0, TAU); c.ellipse(L * 0.055, -2, L * 0.05, L * 0.036, 0, 0, TAU); c.fill();
  c.restore();
  if (!brass) {
    brass = c.createLinearGradient(0, -R, 0, R);
    brass.addColorStop(0, '#ffe39a'); brass.addColorStop(0.45, '#e2ae4a'); brass.addColorStop(1, '#a8721f');
  }
  const rot = t * 0.9 + f.seed;
  c.fillStyle = brass;
  gearPath(c, R, 8, L * 0.075, rot);
  c.fill();
  c.strokeStyle = 'rgba(90,55,5,.6)'; c.lineWidth = 1; c.stroke();
  // inner ring and spokes
  c.strokeStyle = '#a0701f'; c.lineWidth = R * 0.12;
  c.beginPath(); c.arc(0, 0, R * 0.68, 0, TAU); c.stroke();
  c.lineWidth = R * 0.1;
  c.beginPath();
  for (let i = 0; i < 4; i++) { const a = rot + (i / 4) * TAU; c.moveTo(0, 0); c.lineTo(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66); }
  c.stroke();
  c.fillStyle = '#ffe7a6';
  c.beginPath(); c.arc(0, 0, R * 0.16, 0, TAU); c.fill();
  // big round eye in a brass bezel
  c.fillStyle = '#7d5414';
  c.beginPath(); c.arc(R * 0.62, -R * 0.3, R * 0.36, 0, TAU); c.fill();
  eye(c, R * 0.62, -R * 0.3, R * 0.28, look);
  c.strokeStyle = '#5a3a08'; c.lineWidth = 1.6; c.lineCap = 'round';
  c.beginPath(); c.moveTo(R * 1.12, R * 0.22); c.lineTo(R * 0.86, R * 0.3); c.stroke();
}

// ---------------------------------------------------------------- 8-bit
const NES_A = [
  '........oooo....',
  'oo....oollllo...',
  'oto..olllllllo..',
  'otto.obbbbbbbeeo',
  '.ottobbbbbbbbepo',
  '.ottobbbbbbbbbbo',
  'otto.obbbbbbbbo.',
  'oto..oolbbbbloo.',
  'oo.....oottoo...',
  '................',
];
const NES_TAIL_B = ['.....', '.....', 'oo...', 'otto.', '.otto', '.otto', 'otto.', 'oo...', '.....', '.....'];
const NES_B = NES_A.map((r, i) => NES_TAIL_B[i] + r.slice(5));
const NES_FRONT = [
  '................',
  '......oooo......',
  '.....ollllo.....',
  '....ollllllo....',
  '...obbbbbbbbo...',
  '...oeebbbbeeo...',
  '...oepbbbbpeo...',
  '...obbbooobbo...',
  '....obbbbbbo....',
  '.....oottoo.....',
];
const NES_PALS = [
  { o: '#000000', b: '#e45c10', l: '#fca044', t: '#a81000', e: '#fcfcfc', p: '#000000' },
  { o: '#000000', b: '#00a800', l: '#b8f818', t: '#005800', e: '#fcfcfc', p: '#000000' },
  { o: '#000000', b: '#6844fc', l: '#b8b8f8', t: '#2038ec', e: '#fcfcfc', p: '#000000' },
];
export function nes(c: C, f: Drawable, t: number, front: boolean) {
  const L = f.L;
  const grid = front ? NES_FRONT : Math.sin(f.phase) > 0 ? NES_A : NES_B;
  const px = L / 16;
  const pal = NES_PALS[f.pal % NES_PALS.length] as Record<string, string>;
  const ox = -L / 2, oy = -(grid.length * px) / 2;
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      c.fillStyle = pal[ch] || pal.b;
      c.fillRect(ox + x * px, oy + y * px, px + 0.4, px + 0.4);
    }
  }
}

// ---------------------------------------------------------------- CLIG
export function clig(c: C, f: Drawable, t: number, night: number, front: boolean) {
  const L = f.L;
  c.font = `500 ${L}px "DM Mono", ui-monospace, monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = night > 0.5 ? '#a8ffc4' : '#e4fff0';
  if (front) {
    c.fillText('>', -L * 0.25, 0);
    if (Math.floor(t * 2.2) % 2 === 0) c.fillRect(L * 0.08, L * 0.26, L * 0.5, L * 0.1);
  } else {
    c.fillText('>', 0, 0);
  }
}

// ---------------------------------------------------------------- Django guitarfish (seen from above)
export function guitar(c: C, f: Drawable, t: number, look: Look) {
  const L = f.L;
  const sw = Math.sin(f.phase);
  c.save();
  c.scale(1, 0.62);
  // neck / tail, bending
  const bend = sw * L * 0.06;
  c.strokeStyle = '#0c4b33';
  c.lineCap = 'round';
  c.lineWidth = L * 0.075;
  c.beginPath(); c.moveTo(L * 0.05, 0); c.quadraticCurveTo(-L * 0.18, bend * 0.4, -L * 0.38, bend); c.stroke();
  // frets
  c.strokeStyle = 'rgba(210,235,220,.55)';
  c.lineWidth = 1.3;
  for (let i = 1; i <= 6; i++) {
    const s = i / 7;
    const x = L * 0.05 + (-L * 0.43) * s;
    const y = bend * s * s;
    c.beginPath(); c.moveTo(x, y - L * 0.035); c.lineTo(x, y + L * 0.035); c.stroke();
  }
  // strings
  c.strokeStyle = 'rgba(240,250,240,.5)';
  c.lineWidth = 0.7;
  for (const o of [-0.016, 0, 0.016]) {
    c.beginPath(); c.moveTo(L * 0.34, o * L); c.lineTo(L * 0.05, o * L); c.quadraticCurveTo(-L * 0.18, bend * 0.4 + o * L, -L * 0.38, bend + o * L); c.stroke();
  }
  // dorsal fins
  c.fillStyle = '#0a3d29';
  for (const s of [0.35, 0.62]) {
    const x = L * 0.05 - L * 0.43 * s, y = bend * s * s;
    c.beginPath(); c.ellipse(x, y, L * 0.04, L * 0.022, 0, 0, TAU); c.fill();
  }
  // headstock = tail fin
  c.save();
  c.translate(-L * 0.38, bend);
  c.rotate(sw * 0.3);
  c.fillStyle = '#0c4b33';
  c.beginPath(); c.moveTo(0, -L * 0.04); c.lineTo(-L * 0.12, -L * 0.07); c.lineTo(-L * 0.12, L * 0.07); c.lineTo(0, L * 0.04); c.closePath(); c.fill();
  c.fillStyle = '#d9e8dc';
  for (const y of [-0.045, 0, 0.045]) for (const x of [-0.04, -0.085]) { c.beginPath(); c.arc(x * L, y * L, L * 0.009, 0, TAU); c.fill(); }
  c.restore();
  // body: two bouts
  const wv = Math.sin(f.phase * 1.3) * 0.012;
  const g = c.createRadialGradient(L * 0.22, -L * 0.05, 0, L * 0.22, 0, L * 0.26);
  g.addColorStop(0, '#1f7a54'); g.addColorStop(1, '#0c4b33');
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(L * 0.3, 0, L * 0.2, L * (0.2 + wv), 0, 0, TAU);
  c.ellipse(L * 0.1, 0, L * 0.13, L * (0.155 - wv), 0, 0, TAU);
  c.fill();
  c.beginPath();
  c.moveTo(L * 0.1, -L * 0.15); c.quadraticCurveTo(L * 0.2, -L * 0.11, L * 0.3, -L * 0.19);
  c.lineTo(L * 0.3, L * 0.19); c.quadraticCurveTo(L * 0.2, L * 0.11, L * 0.1, L * 0.15); c.fill();
  // nose
  c.beginPath(); c.moveTo(L * 0.45, -L * 0.09); c.quadraticCurveTo(L * 0.56, 0, L * 0.45, L * 0.09); c.fill();
  // spots
  c.fillStyle = 'rgba(120,220,170,.45)';
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996 + f.seed, r = Math.sqrt((i + 0.5) / 9) * 0.15;
    c.beginPath(); c.arc(L * (0.27 + Math.cos(a) * r * 1.1), L * Math.sin(a) * r, L * 0.012, 0, TAU); c.fill();
  }
  // soundhole + rosette + bridge
  c.fillStyle = '#04241a';
  c.beginPath(); c.arc(L * 0.17, 0, L * 0.045, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(180,230,200,.5)'; c.lineWidth = 1.2;
  c.beginPath(); c.arc(L * 0.17, 0, L * 0.058, 0, TAU); c.stroke();
  c.fillStyle = '#062b1e';
  c.fillRect(L * 0.33, -L * 0.035, L * 0.025, L * 0.07);
  c.restore();
  // eyes on top
  eye(c, L * 0.44, -L * 0.045, L * 0.018, look, '#e9f5ec');
  eye(c, L * 0.44, L * 0.045, L * 0.018, look, '#e9f5ec');
}

// ---------------------------------------------------------------- origami
export function origami(c: C, f: Drawable, t: number, look: Look) {
  const L = f.L;
  const sw = Math.sin(f.phase);
  const flex = Math.sin(f.phase * 0.5 + 1) * L * 0.03;
  const N = [L * 0.5, L * 0.02], T = [L * 0.06, -L * 0.3 + flex], B = [L * 0.04, L * 0.27 - flex * 0.5];
  const M = [L * 0.12, L * 0.03], J = [-L * 0.2, 0];
  const TT = [-L * 0.5, -L * 0.26 + sw * L * 0.08], TB = [-L * 0.48, L * 0.22 + sw * L * 0.08], TM = [-L * 0.36, sw * L * 0.05];
  const tri = (a: number[], b: number[], d: number[], col: string) => {
    c.fillStyle = col;
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.closePath(); c.fill();
  };
  tri(J, TT, TM, '#d8cfbb');
  tri(J, TM, TB, '#c4b9a1');
  tri(N, T, M, '#fbf7ee');
  tri(N, M, B, '#e6dfcf');
  tri(T, J, M, '#ece5d4');
  tri(M, J, B, '#d3c9b2');
  // a few lines of preprint
  c.save();
  c.beginPath(); c.moveTo(T[0], T[1]); c.lineTo(J[0], J[1]); c.lineTo(M[0], M[1]); c.closePath(); c.clip();
  c.fillStyle = 'rgba(60,60,70,.28)';
  for (let i = 0; i < 6; i++) c.fillRect(-L * 0.2, -L * 0.2 + i * L * 0.04, L * 0.3 - (i % 3) * L * 0.05, L * 0.012);
  c.restore();
  // arXiv red fin
  tri(T, [-L * 0.08, -L * 0.44 + flex], [L * 0.14, -L * 0.28 + flex], '#b31b1b');
  tri(B, [-L * 0.02, L * 0.38], [L * 0.12, L * 0.24], '#8f1515');
  // creases
  c.strokeStyle = 'rgba(90,80,60,.35)';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(N[0], N[1]); c.lineTo(M[0], M[1]); c.lineTo(J[0], J[1]);
  c.moveTo(T[0], T[1]); c.lineTo(M[0], M[1]); c.lineTo(B[0], B[1]);
  c.moveTo(J[0], J[1]); c.lineTo(TM[0], TM[1]);
  c.stroke();
  // ink-dot eye
  c.fillStyle = '#1b1b1f';
  c.beginPath(); c.arc(L * 0.32 + look.x * 1.2, -L * 0.04 + look.y * 1.2, L * 0.03, 0, TAU); c.fill();
}

// ---------------------------------------------------------------- pufferfish / weather balloon
export function puffer(c: C, f: Drawable, t: number, look: Look, front: boolean) {
  const L = f.L;
  const k = f.infl;
  const r = L * 0.3 * (1 + k * 1.25);
  const sw = Math.sin(f.phase);
  // payload on a string
  if (f.balloon > 0.01) {
    const len = L * 1.1 * f.balloon;
    const sway = Math.sin(t * 1.3) * L * 0.08;
    c.strokeStyle = 'rgba(235,240,245,.75)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, r * 0.95); c.quadraticCurveTo(sway, r + len * 0.5, sway * 0.6, r + len); c.stroke();
    c.save();
    c.translate(sway * 0.6, r + len);
    c.rotate(Math.sin(t * 1.3 + 0.6) * 0.12);
    const s = L * 0.2 * f.balloon;
    c.fillStyle = '#f5f2ea';
    c.fillRect(-s / 2, 0, s, s * 0.8);
    c.fillStyle = '#e05a2a';
    c.fillRect(-s / 2, s * 0.28, s, s * 0.12);
    c.strokeStyle = '#d0d6dc'; c.beginPath(); c.moveTo(s * 0.3, s * 0.8); c.lineTo(s * 0.3, s * 1.3); c.stroke();
    c.restore();
  }
  if (!front) {
    // tail
    c.fillStyle = '#d9a73c';
    c.beginPath();
    c.moveTo(-r * 0.85, 0); c.lineTo(-r * 0.85 - L * 0.18, -L * 0.12 + sw * 2); c.lineTo(-r * 0.85 - L * 0.16, L * 0.12 + sw * 2); c.closePath(); c.fill();
  }
  // spikes
  const n = 22;
  c.strokeStyle = 'rgba(140,100,30,.85)';
  c.lineWidth = 1.4;
  c.beginPath();
  const sp = L * (0.03 + k * 0.08);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.1;
    c.moveTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    c.lineTo(Math.cos(a) * (r + sp), Math.sin(a) * (r + sp));
  }
  c.stroke();
  // body
  const g = c.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r);
  const light = Math.round(250 - k * 4), base = k;
  g.addColorStop(0, `rgb(${light},${Math.round(236 + base * 10)},${Math.round(170 + base * 60)})`);
  g.addColorStop(0.7, `rgb(${Math.round(236 + base * 10)},${Math.round(196 + base * 30)},${Math.round(92 + base * 90)})`);
  g.addColorStop(1, `rgb(${Math.round(200 + base * 20)},${Math.round(150 + base * 40)},${Math.round(60 + base * 80)})`);
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
  // belly
  c.fillStyle = 'rgba(255,250,230,.55)';
  c.beginPath(); c.ellipse(r * 0.05, r * 0.45, r * 0.75, r * 0.42, 0, 0, Math.PI); c.fill();
  // spots
  c.fillStyle = `rgba(120,80,20,${0.5 - k * 0.25})`;
  for (let i = 0; i < 10; i++) {
    const a = i * 2.4 + 0.7, rr = Math.sqrt((i + 0.5) / 10) * 0.7;
    const x = Math.cos(a) * rr * r, y = Math.sin(a) * rr * r - r * 0.15;
    if (y > r * 0.2) continue;
    c.beginPath(); c.arc(x, y, L * 0.018 * (1 + k * 0.6), 0, TAU); c.fill();
  }
  // tiny flapping fin
  c.fillStyle = 'rgba(230,180,70,.9)';
  c.save(); c.translate(front ? r * 0.95 : -r * 0.05, r * 0.15); c.rotate(Math.sin(t * (10 + k * 14)) * 0.6);
  c.beginPath(); c.ellipse(0, L * 0.05, L * 0.045, L * 0.08, 0, 0, TAU); c.fill(); c.restore();
  if (front) {
    c.save(); c.translate(-r * 0.95, r * 0.15); c.rotate(-Math.sin(t * (10 + k * 14)) * 0.6);
    c.beginPath(); c.ellipse(0, L * 0.05, L * 0.045, L * 0.08, 0, 0, TAU); c.fill(); c.restore();
    eye(c, -r * 0.35, -r * 0.2, L * 0.075, look);
    eye(c, r * 0.35, -r * 0.2, L * 0.075, look);
    c.fillStyle = '#7a4a1a';
    c.beginPath(); c.ellipse(0, r * 0.25, L * 0.04, L * 0.03 + k * L * 0.02, 0, 0, TAU); c.fill();
  } else {
    eye(c, r * 0.5, -r * 0.22, L * 0.08, look);
    c.fillStyle = '#7a4a1a';
    c.beginPath(); c.ellipse(r * 0.97, r * 0.12, L * 0.03, L * 0.025 + k * L * 0.015, 0, 0, TAU); c.fill();
  }
}

// ---------------------------------------------------------------- anglerfish
export function anglerLure(f: Drawable, t: number): [number, number] {
  const L = f.L;
  return [L * 0.64 + Math.sin(t * 1.1 + f.seed) * L * 0.03, -L * 0.36 + Math.sin(t * 1.7 + f.seed) * L * 0.03];
}
export function angler(c: C, f: Drawable, t: number, look: Look, front: boolean) {
  const L = f.L;
  const h = L * 0.62;
  const sw = Math.sin(f.phase);
  const jaw = 0.5 + 0.5 * Math.sin(t * 0.8 + f.seed) * 0.5 + f.mouth * 0.4;
  const [lx, ly] = front ? [0, -L * 0.5 + Math.sin(t * 1.7) * L * 0.02] : anglerLure(f, t);
  if (front) {
    const w = L * 0.5;
    c.fillStyle = '#2a2a3d';
    c.beginPath(); c.ellipse(0, 0, w / 2, h / 2, 0, 0, TAU); c.fill();
    c.fillStyle = '#16070d';
    c.beginPath(); c.ellipse(0, h * 0.12, w * 0.38, h * (0.12 + jaw * 0.12), 0, 0, TAU); c.fill();
    c.fillStyle = '#f3efe6';
    for (let i = -4; i <= 4; i++) {
      const x = i * w * 0.08;
      c.beginPath(); c.moveTo(x - 3, h * 0.02); c.lineTo(x, h * 0.1); c.lineTo(x + 3, h * 0.02); c.fill();
      c.beginPath(); c.moveTo(x - 3, h * (0.22 + jaw * 0.12)); c.lineTo(x, h * (0.14 + jaw * 0.1)); c.lineTo(x + 3, h * (0.22 + jaw * 0.12)); c.fill();
    }
    eye(c, -w * 0.22, -h * 0.2, L * 0.03, look, '#d8e0d0');
    eye(c, w * 0.22, -h * 0.2, L * 0.03, look, '#d8e0d0');
    c.strokeStyle = '#3d3a52'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -h * 0.46); c.quadraticCurveTo(L * 0.05, -h * 0.75, lx, ly); c.stroke();
  } else {
    // tail
    c.save(); c.translate(-L * 0.36, 0); c.rotate(sw * 0.25);
    c.fillStyle = '#26263a';
    c.beginPath(); c.moveTo(L * 0.02, -h * 0.12); c.lineTo(-L * 0.16, -h * 0.32); c.lineTo(-L * 0.12, 0); c.lineTo(-L * 0.16, h * 0.3); c.lineTo(L * 0.02, h * 0.12); c.closePath(); c.fill();
    c.restore();
    // body
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#34344c'); g.addColorStop(1, '#1b1b2a');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(L * 0.36, -h * 0.06);
    c.bezierCurveTo(L * 0.36, -h * 0.5, L * 0.05, -h * 0.58, -L * 0.12, -h * 0.4);
    c.bezierCurveTo(-L * 0.28, -h * 0.25, -L * 0.36, -h * 0.12, -L * 0.37, 0);
    c.bezierCurveTo(-L * 0.34, h * 0.2, -L * 0.1, h * 0.42, L * 0.16, h * 0.38);
    c.lineTo(L * 0.44, h * (0.22 + jaw * 0.16));
    c.lineTo(L * 0.12, h * 0.04);
    c.closePath();
    c.fill();
    // mouth interior
    c.fillStyle = '#16070d';
    c.beginPath(); c.moveTo(L * 0.36, -h * 0.06); c.lineTo(L * 0.12, h * 0.04); c.lineTo(L * 0.44, h * (0.22 + jaw * 0.16)); c.closePath(); c.fill();
    // teeth
    c.fillStyle = '#f3efe6';
    for (let i = 0; i < 6; i++) {
      const s = (i + 0.5) / 6;
      const ux = L * 0.36 + (L * 0.12 - L * 0.36) * s, uy = -h * 0.06 + (h * 0.04 + h * 0.06) * s;
      c.beginPath(); c.moveTo(ux - 2.5, uy); c.lineTo(ux + 1, uy + h * 0.09); c.lineTo(ux + 3, uy - 1); c.fill();
      const bx = L * 0.12 + (L * 0.44 - L * 0.12) * s, by = h * 0.04 + (h * (0.22 + jaw * 0.16) - h * 0.04) * s;
      c.beginPath(); c.moveTo(bx - 2.5, by + 1); c.lineTo(bx, by - h * 0.09); c.lineTo(bx + 3, by + 1); c.fill();
    }
    // fins + spines
    c.fillStyle = '#2b2b40';
    c.save(); c.translate(-L * 0.02, h * 0.12); c.rotate(0.4 + Math.sin(f.phase + 1) * 0.25);
    c.beginPath(); c.ellipse(-L * 0.06, 0, L * 0.08, h * 0.08, 0, 0, TAU); c.fill(); c.restore();
    c.strokeStyle = 'rgba(90,90,120,.8)'; c.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) { const x = -L * (0.05 + i * 0.07); c.beginPath(); c.moveTo(x, -h * (0.42 - i * 0.06)); c.lineTo(x - L * 0.03, -h * (0.54 - i * 0.06)); c.stroke(); }
    // eye
    eye(c, L * 0.17, -h * 0.22, L * 0.028, look, '#d8e0d0');
    // illicium
    c.strokeStyle = '#4a4766'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(L * 0.2, -h * 0.4); c.quadraticCurveTo(L * 0.4, -L * 0.62, lx, ly); c.stroke();
    // rim light from the lure
    c.save();
    c.globalCompositeOperation = 'lighter';
    const rl = c.createRadialGradient(lx, ly, 0, lx, ly, L * 0.6);
    rl.addColorStop(0, `rgba(120,255,225,${0.22 + f.glow * 0.2})`); rl.addColorStop(1, 'rgba(120,255,225,0)');
    c.fillStyle = rl;
    c.beginPath(); c.arc(lx, ly, L * 0.6, 0, TAU); c.fill();
    c.restore();
  }
  // lure bulb
  const pulse = 0.75 + 0.25 * Math.sin(t * 3 + f.seed);
  c.fillStyle = `rgba(230,255,248,${0.9})`;
  c.beginPath(); c.arc(lx, ly, L * 0.032 * (0.9 + pulse * 0.2), 0, TAU); c.fill();
}

// ---------------------------------------------------------------- hermit crab with a container for a shell
export function crab(c: C, f: Drawable, t: number, look: Look, front: boolean, walking: number) {
  const L = f.L;
  const step = Math.sin(f.phase * 2) * walking;
  const wave = f.held ? Math.sin(t * 7) * 0.4 + 0.6 : 0;
  // container shell
  const bw = L * 0.72, bh = L * 0.42;
  c.save();
  c.translate(front ? 0 : -L * 0.12, -L * 0.32 + Math.abs(step) * 1.5);
  c.rotate(front ? 0 : -0.06);
  c.fillStyle = '#2496ed';
  c.fillRect(-bw / 2, -bh / 2, bw, bh);
  c.fillStyle = 'rgba(0,0,0,.15)';
  for (let j = 1; j < 8; j++) c.fillRect(-bw / 2 + (bw * j) / 8 - 0.8, -bh / 2 + 3, 1.6, bh - 6);
  c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(-bw / 2, -bh / 2, bw, 2.5);
  c.strokeStyle = '#11507f'; c.lineWidth = 1.5; c.strokeRect(-bw / 2 + 0.75, -bh / 2 + 0.75, bw - 1.5, bh - 1.5);
  c.restore();
  const shell = '#e2603f', dark = '#a63d24';
  // legs
  c.strokeStyle = dark; c.lineWidth = L * 0.035; c.lineCap = 'round'; c.lineJoin = 'round';
  const legs = front ? [-0.3, -0.18, 0.18, 0.3] : [0.04, 0.14, 0.24];
  legs.forEach((lx, i) => {
    const ph = (i % 2 ? 1 : -1) * step;
    const x0 = L * lx, side = front ? Math.sign(lx) : 1;
    c.beginPath();
    c.moveTo(x0, -L * 0.1);
    c.lineTo(x0 + side * L * 0.1 + ph * L * 0.04, -L * 0.16 - Math.max(0, ph) * L * 0.04);
    c.lineTo(x0 + side * L * 0.16 + ph * L * 0.05, 0);
    c.stroke();
  });
  // body
  c.fillStyle = shell;
  c.beginPath(); c.ellipse(front ? 0 : L * 0.2, -L * 0.14, L * (front ? 0.24 : 0.14), L * 0.1, 0, 0, TAU); c.fill();
  // claws
  const claws = front ? [-1, 1] : [1];
  for (const s of claws) {
    c.save();
    c.translate(front ? s * L * 0.2 : L * 0.3, -L * 0.18);
    c.rotate(front ? s * (-0.4 - wave * 0.9) : -0.3 - wave * 0.8);
    c.strokeStyle = shell; c.lineWidth = L * 0.05;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(front ? s * L * 0.1 : L * 0.1, -L * 0.08); c.stroke();
    c.translate(front ? s * L * 0.12 : L * 0.12, -L * 0.1);
    c.fillStyle = shell;
    c.beginPath(); c.ellipse(0, 0, L * 0.07, L * 0.05, front ? s * -0.5 : -0.5, 0, TAU); c.fill();
    c.fillStyle = dark;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.09 * (front ? s : 1), -L * 0.02); c.lineTo(L * 0.05 * (front ? s : 1), L * 0.02); c.fill();
    c.restore();
  }
  // eyestalks
  const ex = front ? [-L * 0.06, L * 0.06] : [L * 0.23, L * 0.29];
  c.strokeStyle = shell; c.lineWidth = L * 0.022;
  for (const x of ex) {
    c.beginPath(); c.moveTo(x, -L * 0.2); c.lineTo(x + look.x * 2, -L * 0.33); c.stroke();
    eye(c, x + look.x * 2, -L * 0.35, L * 0.035, look);
  }
}

// ---------------------------------------------------------------- small schooling fish
export function small(c: C, f: Drawable, t: number, look: Look, front: boolean) {
  const L = f.L;
  const p = SMALL_COLORS[f.pal % SMALL_COLORS.length];
  const sw = Math.sin(f.phase);
  if (front) {
    c.fillStyle = p.fin;
    c.beginPath(); c.moveTo(0, -L * 0.3); c.lineTo(-L * 0.06, -L * 0.18); c.lineTo(L * 0.06, -L * 0.18); c.fill();
    c.fillStyle = p.body;
    c.beginPath(); c.ellipse(0, 0, L * 0.17, L * 0.2, 0, 0, TAU); c.fill();
    c.fillStyle = p.belly;
    c.beginPath(); c.ellipse(0, L * 0.07, L * 0.12, L * 0.1, 0, 0, TAU); c.fill();
    eye(c, -L * 0.09, -L * 0.04, L * 0.065, look);
    eye(c, L * 0.09, -L * 0.04, L * 0.065, look);
    return;
  }
  c.fillStyle = p.fin;
  c.beginPath();
  c.moveTo(-L * 0.28, 0); c.lineTo(-L * 0.5, -L * 0.2 + sw * L * 0.06); c.lineTo(-L * 0.46, 0); c.lineTo(-L * 0.5, L * 0.2 + sw * L * 0.06); c.closePath(); c.fill();
  c.fillStyle = p.body;
  c.beginPath(); c.ellipse(0, 0, L * 0.36, L * 0.17, 0, 0, TAU); c.fill();
  c.fillStyle = p.belly;
  c.beginPath(); c.ellipse(L * 0.04, L * 0.07, L * 0.26, L * 0.07, 0, 0, TAU); c.fill();
  c.fillStyle = p.fin;
  c.fillRect(-L * 0.12, -L * 0.15, L * 0.05, L * 0.3);
  eye(c, L * 0.2, -L * 0.03, L * 0.055, look);
}

// generic front-on fallback for the odd ones (cog, origami, guitarfish)
export function genericFront(c: C, f: Drawable, t: number, look: Look, body: string, belly: string, w: number, h: number) {
  const L = f.L;
  c.fillStyle = body;
  for (const s of [-1, 1]) {
    c.save(); c.translate(s * L * w * 0.5, L * h * 0.1); c.rotate(s * (0.5 + Math.sin(f.phase * 1.4) * 0.3));
    c.beginPath(); c.ellipse(s * L * 0.05, 0, L * 0.08, L * 0.035, 0, 0, TAU); c.fill(); c.restore();
  }
  c.beginPath(); c.ellipse(0, 0, L * w * 0.5, L * h * 0.5, 0, 0, TAU); c.fill();
  c.fillStyle = belly;
  c.beginPath(); c.ellipse(0, L * h * 0.18, L * w * 0.34, L * h * 0.22, 0, 0, TAU); c.fill();
  const er = Math.max(2.5, L * 0.045);
  eye(c, -L * w * 0.22, -L * h * 0.1, er, look);
  eye(c, L * w * 0.22, -L * h * 0.1, er, look);
  c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1.4;
  c.beginPath(); c.arc(0, L * h * 0.16, L * 0.03, 0, TAU); c.stroke();
}
