import { W, H, BAY, grad, hex, mix, mul, clamp, smooth, cyc, shuffle, type RGB, Screen } from './core';
import { textMask, scale2x, scale3x, shade, type Bmp } from './font';
import { BAR, BEAT } from './music';

export interface Ctx {
  S: Screen;
  t: number; // part time
  T: number; // song time
  dt: number;
  mx: number; // smoothed pointer, -1..1 over the screen
  my: number;
  vx: number; // pointer velocity, screens per second
  vy: number;
  kick: number;
  snare: number;
  hat: number;
  lead: number;
  bass: number;
  arp: number;
  reduced: boolean;
}

export type Link = { label: string; url: string };
export type Item = { key: string; label?: string; url?: string; blurb?: string; pre?: string; links?: (Link & { on?: boolean })[] };

export interface Part {
  name: string;
  bars: number;
  scroller: boolean;
  scrollY?: number;
  enter?(c: Ctx): void;
  draw(c: Ctx): void;
  scrub?(dx: number): void;
  item?(): Item | null;
  done?(): boolean;
}

/* ---------------------------------------------------------------- palettes & text */

const FONT_GRAD = grad(['#fff6e0', '#ffdcaa', '#ffbf7a', '#f39a55', '#d87637', '#3a1720', '#6a2a1f', '#a2472a', '#cf6a34', '#ef8f47', '#fcb262', '#ffd08c', '#ffe9bf'], 13);
const LOGO_GRAD = ['#1d2a7a', '#3456c4', '#6f97f2', '#b7d2ff', '#f4f8ff', '#2a1430', '#5e2620', '#9c4426', '#d2702f', '#f29a4a', '#ffc27a', '#ffe7b8'].map(hex);

export function fontPal(S: Screen) {
  S.pal(48, hex('#13070c'));
  S.pal(49, hex('#020104'));
  S.pal(50, hex('#fffaf0'));
  for (let i = 0; i < 13; i++) S.pal(51 + i, FONT_GRAD[i]);
}
export function logoPal(S: Screen, glint = -1) {
  S.pal(33, hex('#08040c'));
  S.pal(34, [255, 255, 255]);
  for (let i = 0; i < 12; i++) {
    const d = Math.abs(i - glint);
    S.pal(35 + i, d < 2 ? mix(LOGO_GRAD[i], [255, 255, 255], d < 1 ? 0.75 : 0.35) : LOGO_GRAD[i]);
  }
}

const fontRow = (rows: number) => (r: number) => 51 + Math.min(12, ((r * 13) / rows) | 0);
const logoRow = (rows: number) => (r: number) => 35 + Math.min(11, ((r * 12) / rows) | 0);

export const small = (s: string) => shade(textMask(s).m, fontRow(7), 48, 50);
export const medium = (s: string) => shade(scale2x(textMask(s).m), fontRow(14), 48, 50);
export const big = (s: string) => shade(scale3x(textMask(s).m), logoRow(21), 33, 34);
export const bigFont = (s: string) => shade(scale3x(textMask(s).m), fontRow(21), 48, 50);

export function blit(S: Screen, b: Bmp, x0: number, y0: number, wob?: (y: number) => number, clipW = 1e9) {
  const fb = S.fb;
  for (let y = 0; y < b.h; y++) {
    const sy = (y0 + y) | 0;
    if (sy < 0 || sy >= H) continue;
    const ox = (x0 + (wob ? wob(sy) : 0)) | 0;
    const row = y * b.w, o = sy * W;
    const xe = Math.min(b.w, clipW);
    for (let x = 0; x < xe; x++) {
      const v = b.d[row + x];
      if (v) {
        const sx = ox + x;
        if (sx >= 0 && sx < W) fb[o + sx] = v;
      }
    }
  }
}
export function blitShadow(S: Screen, b: Bmp, x0: number, y0: number, idx: number) {
  const fb = S.fb;
  for (let y = 0; y < b.h; y++) {
    const sy = (y0 + y) | 0;
    if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < b.w; x++)
      if (b.d[y * b.w + x]) {
        const sx = (x0 + x) | 0;
        if (sx >= 0 && sx < W) fb[sy * W + sx] = idx;
      }
  }
}
/** nearest-neighbour scaled blit, centred */
export function blitZoom(S: Screen, b: Bmp, cx: number, cy: number, s: number, wob?: (y: number) => number) {
  if (s <= 0.02) return;
  const fb = S.fb, w = b.w * s, h = b.h * s;
  const x0 = cx - w / 2, y0 = cy - h / 2;
  const ys = Math.max(0, Math.floor(y0)), ye = Math.min(H, Math.ceil(y0 + h));
  for (let sy = ys; sy < ye; sy++) {
    const v = Math.floor((sy - y0) / s);
    if (v < 0 || v >= b.h) continue;
    const ox = x0 + (wob ? wob(sy) : 0);
    const xs = Math.max(0, Math.floor(ox)), xe = Math.min(W, Math.ceil(ox + w));
    const row = v * b.w, o = sy * W;
    for (let sx = xs; sx < xe; sx++) {
      const u = Math.floor((sx - ox) / s);
      if (u < 0 || u >= b.w) continue;
      const p = b.d[row + u];
      if (p) fb[o + sx] = p;
    }
  }
}

const bounce = (t: number) => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/* ---------------------------------------------------------------- the scroller */

export type ScrollEntry = { text: string; item: Item };

export class Scroller {
  strip: Bmp;
  starts: number[];
  items: Item[];
  pos = -W;
  vel = 0;
  speed = 90;
  held = false;
  private ys = new Int16Array(W);

  constructor(entries: ScrollEntry[]) {
    const SEP = '     ~     ';
    let full = '';
    const ci: number[] = [];
    for (const e of entries) {
      ci.push(full.length);
      full += e.text + SEP;
    }
    const { m, xs } = textMask(full);
    this.strip = shade(scale2x(m), fontRow(14), 48, 50);
    this.starts = ci.map((i) => xs[i] * 2);
    this.items = entries.map((e) => e.item);
  }
  get length() {
    return this.strip.w;
  }
  reset() {
    this.pos = -W;
    this.vel = 0;
  }
  update(dt: number, running: boolean) {
    if (!this.held) {
      this.pos += (running ? this.speed * dt : 0) + this.vel * dt;
      this.vel *= Math.exp(-dt * 2.2);
    }
  }
  scrub(dx: number) {
    this.pos -= dx;
  }
  current(): Item {
    const L = this.strip.w;
    const u = ((((this.pos + W / 2) % L) + L) % L);
    let k = 0;
    for (let i = 0; i < this.starts.length; i++) if (this.starts[i] <= u + 8) k = i;
    return this.items[k];
  }
  draw(c: Ctx, yb: number) {
    const S = c.S, fb = S.fb, b = this.strip, SW = b.w, SH = b.h, d = b.d;
    const p = Math.floor(this.pos);
    const amp = c.reduced ? 5 : 13 + c.kick * 7;
    const ph = c.T * 2.3;
    const ys = this.ys;
    for (let x = 0; x < W; x++) ys[x] = (yb + Math.sin(x * 0.026 + ph) * amp + Math.sin(x * 0.011 - ph * 0.6) * amp * 0.35) | 0;
    // drop shadow then letters
    for (let pass = 0; pass < 2; pass++) {
      const off = pass ? 0 : 2;
      for (let x = 0; x < W; x++) {
        const sx = x + off;
        if (sx >= W) continue;
        const u = (((p + x) % SW) + SW) % SW;
        const y0 = ys[x] + off;
        for (let r = 0; r < SH; r++) {
          const v = d[r * SW + u];
          if (!v) continue;
          const sy = y0 + r;
          if (sy < 0 || sy >= H) continue;
          fb[sy * W + sx] = pass ? v : 49;
        }
      }
    }
  }
}

/* ---------------------------------------------------------------- 1. title: copper bars + logo */

export function titlePart(R: () => number): Part {
  const logo = big('BEN FIRSHMAN');
  const sub = small('COPPER  -  A DEMO IN EIGHT PARTS');
  // the logo's reflection, remapped onto registers 17..30
  const refl: Bmp = { w: logo.w, h: logo.h, d: new Uint8Array(logo.w * logo.h) };
  for (let y = 0; y < logo.h; y++)
    for (let x = 0; x < logo.w; x++) {
      const v = logo.d[(logo.h - 1 - y) * logo.w + x];
      refl.d[y * logo.w + x] = v ? v - 16 : 0;
    }
  const WATER = hex('#0c1640');
  const stars = Array.from({ length: 70 }, () => ({ x: R() * W, y: 30 + Math.floor(R() * 148), l: Math.floor(R() * 3) }));
  const cols = shuffle(['#ff6a3d', '#ffc94d', '#35d6c9', '#ff4f8b', '#8f7cff', '#59f08f', '#4fa8ff'], R).map(hex);
  const RAIN = grad(['#ff4f6d', '#ffb84d', '#f8f272', '#5af0a0', '#40c8ff', '#8f7cff', '#ff4fd8'], 16, true);
  const BG = Array.from({ length: H }, (_, y) => mix(hex('#090818'), hex('#1b0a18'), y / H));
  let ph = R() * 6, vel = 1, cy = 128;
  return {
    name: 'title',
    bars: 8,
    scroller: true,
    scrollY: 204,
    draw(c) {
      const S = c.S, fb = S.fb;
      fb.fill(0);
      const shift = Math.floor(c.T * 14);
      for (let i = 0; i < 16; i++) S.pal(1 + i, RAIN[(i + shift) & 15]);
      const g = (c.T / 0.07) % 60;
      logoPal(S, g < 14 ? g - 1 : -9);
      for (let i = 33; i < 47; i++) S.pal(i - 16, mix(mul(S.get(i), 0.8), WATER, 0.32));
      S.pal(31, hex('#f4eaff'));
      S.pal(32, hex('#7a74a8'));
      for (const st of stars) {
        const sx = Math.floor((((st.x - c.T * (8 + st.l * 14) * (c.reduced ? 0.3 : 1)) % W) + W) % W);
        fb[st.y * W + sx] = st.l === 2 ? 31 : 32;
      }
      for (const ly of [26, 27, 180, 181]) {
        const o = ly * W;
        for (let x = 0; x < W; x++) fb[o + x] = 1 + ((x >> 2) & 15);
      }
      const drop = clamp(c.t / 1.4);
      const y0 = 46 - (1 - bounce(drop)) * 150;
      const amp = c.reduced ? 0.6 : 1.6 + c.snare * 5 + Math.min(6, Math.abs(c.vx) * 5);
      blit(S, logo, (W - logo.w) >> 1, y0, (sy) => Math.sin(sy * 0.21 + c.T * 4.2) * amp);
      // water: squashed, rippling, every other line dropped out like a raster split
      const wl = 75, rh = 18;
      if (drop > 0.55)
        for (let r = 0; r < rh; r++) {
          const sy = wl + r;
          if (r > 3 && (r & 1) && r > rh * 0.6) continue;
          const srcRow = Math.floor((r / rh) * refl.h);
          const ox = ((W - refl.w) >> 1) + Math.round(Math.sin(r * 0.9 - c.T * 5) * (1 + r * 0.18) + Math.sin(c.T * 1.3) * 1.5);
          const o = sy * W, ro = srcRow * refl.w;
          for (let x = 0; x < refl.w; x++) {
            const v = refl.d[ro + x];
            const sx = ox + x;
            if (v && sx >= 0 && sx < W) fb[o + sx] = v;
          }
        }
      const reveal = (c.t - 1.3) * 160;
      if (reveal > 0) blit(S, sub, (W - sub.w) >> 1, 108, undefined, reveal);
      S.commit();
      for (let y = 0; y < H; y++) S.line(y, 0, BG[y]);

      vel += (1 - vel) * Math.min(1, c.dt * 1.1) + c.vx * 0.5;
      vel = clamp(vel, -6, 8);
      ph += vel * c.dt * (c.reduced ? 0.5 : 1.5);
      cy += (128 + c.my * 70 - cy) * Math.min(1, c.dt * 4);
      const spread = 0.42 + c.mx * 0.22;
      const A = 86 + c.kick * 12;
      const bars = cols.map((col, i) => {
        const a = ph + i * spread;
        return { col, y: cy + Math.sin(a) * A, z: Math.cos(a) };
      });
      bars.sort((a, b) => a.z - b.z);
      const hw = 9;
      for (const b of bars) {
        const dim = 0.42 + 0.58 * ((b.z + 1) / 2);
        for (let dy = -hw; dy <= hw; dy++) {
          const u = Math.abs(dy) / (hw + 0.5);
          const I = Math.pow(Math.cos((u * Math.PI) / 2), 1.3);
          let col = mul(b.col, I * dim * 1.15);
          if (I > 0.86) col = mix(col, [255, 255, 255], (I - 0.86) * 4 * dim);
          const ly = Math.round(b.y + dy), lc = mix(BG[clamp(ly, 0, H - 1)], col, Math.min(1, I * 1.6));
          S.line(ly, 0, lc);
          if (I > 0.08) {
            // stars live behind the bars: rewrite their registers on covered lines
            S.line(ly, 31, lc);
            S.line(ly, 32, lc);
          }
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- 2. plasma */

const SIN = Float32Array.from({ length: 1024 }, (_, i) => Math.sin((i / 1024) * Math.PI * 2));
let DIST: Float32Array | null = null;
function distTable() {
  if (DIST) return DIST;
  DIST = new Float32Array(640 * 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 640; x++) DIST[y * 640 + x] = Math.hypot(x - 320, (y - 256) * 1.05);
  return DIST;
}

export function plasmaPart(R: () => number): Part {
  const PALS = [
    ['#0b0630', '#1c2f6e', '#2f7d9a', '#7fd6c2', '#f4f1bb', '#ffb07c', '#e0466b', '#6a1b5a'],
    ['#100820', '#3b1260', '#a4256b', '#ff7a4d', '#ffd36e', '#f6f2d8', '#5fd3c6', '#1d4f7a'],
    ['#07131f', '#0f4c5c', '#5fa88f', '#e9e3a6', '#f2a65a', '#c2452d', '#5c1d3b', '#24133f'],
  ];
  const P = grad(PALS[Math.floor(R() * PALS.length)], 64, true);
  const k1 = 6.5 + R() * 3, k2 = 7 + R() * 3, k3 = 4 + R() * 2, k4 = 11 + R() * 5;
  let cx = 160, cy = 128, off = 0, warp = 10;
  return {
    name: 'plasma',
    bars: 8,
    scroller: true,
    scrollY: 206,
    draw(c) {
      const S = c.S, fb = S.fb, D = distTable();
      off += c.dt * 0.06 + c.kick * c.dt * 0.9;
      for (let i = 0; i < 32; i++) S.pal(1 + i, cyc(P, i / 32 + off));
      cx += (160 + c.mx * 150 - cx) * Math.min(1, c.dt * 2.6);
      cy += (128 + c.my * 118 - cy) * Math.min(1, c.dt * 2.6);
      warp += (10 + Math.min(40, Math.hypot(c.vx, c.vy) * 22) - warp) * Math.min(1, c.dt * 3);
      const t = c.T * (c.reduced ? 0.3 : 1);
      const a1 = t * 95, a2 = -t * 70, a3 = t * 52, a4 = t * 150;
      const ix = clamp(Math.round(cx), 0, W - 1), iy = clamp(Math.round(cy), 0, H - 1);
      for (let y = 0; y < H; y++) {
        const ry = SIN[(y * k2 + a2) & 1023];
        const w = SIN[(y * 2.2 + a1 * 0.6) & 1023] * warp;
        const dro = (y - iy + 256) * 640 + 320 - ix;
        const o = y * W, by = (y & 3) << 2;
        for (let x = 0; x < W; x++) {
          const xx = x + w;
          const v =
            SIN[(xx * k1 + a1) & 1023] + ry + SIN[((xx + y) * k3 + a3) & 1023] + SIN[(D[dro + x] * k4 - a4) & 1023] * 0.9;
          fb[o + x] = 1 + ((((v + 4) * 6 + BAY[by | (x & 3)]) | 0) & 31);
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- 3. starfield + vector bobs */

type V3 = [number, number, number];

export function bobsPart(R: () => number): Part {
  const NS = 360;
  const sx = new Float32Array(NS), sy = new Float32Array(NS), sz = new Float32Array(NS);
  const reset = (i: number, z = 1) => {
    sx[i] = (R() * 2 - 1) * 1.6;
    sy[i] = (R() * 2 - 1) * 1.3;
    sz[i] = z;
  };
  for (let i = 0; i < NS; i++) reset(i, 0.05 + R() * 0.95);

  // shaded sphere sprites, 6 light levels (+1: 0 is transparent)
  const SPR: Bmp[] = [];
  const L = [-0.5, -0.62, 0.6];
  const ll = Math.hypot(...L);
  for (let s = 3; s <= 18; s++) {
    const d = new Uint8Array(s * s), r = s / 2;
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const nx = (x + 0.5 - r) / r, ny = (y + 0.5 - r) / r, q = nx * nx + ny * ny;
        if (q > 1) continue;
        const nz = Math.sqrt(1 - q);
        const lam = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
        const spec = Math.pow(lam, 22);
        d[y * s + x] = 1 + Math.min(5, Math.floor(0.4 + lam * 4.1 + spec * 2.5));
      }
    SPR.push({ w: s, h: s, d });
  }
  const BG = hex('#0a0818');
  const fam = shuffle([
    ['#2a0e0a', '#7a2e17', '#c8602a', '#f39a4f', '#ffd08a', '#fff4dc'],
    ['#06161f', '#0f4a5c', '#1b8e9a', '#43d1c4', '#a9f5e4', '#f4fffb'],
    ['#1a0820', '#57164f', '#a8306e', '#ec6a8c', '#ffb3b8', '#fff0ee'],
  ], R).slice(0, 2).map((f) => grad(f, 6));
  const STAR = grad(['#141a3a', '#2a3a6e', '#5a6fa8', '#9fb2da', '#d6e2ff', '#ffffff', '#ffffff', '#ffffff'], 8);

  const N = 64;
  const sphere = (i: number): V3 => {
    const y = 1 - ((i + 0.5) / N) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  const torus = (i: number): V3 => {
    const u = ((i % 16) / 16) * Math.PI * 2, v = (Math.floor(i / 16) / 4) * Math.PI * 2 + u * 0.25;
    return [(0.72 + 0.34 * Math.cos(v)) * Math.cos(u), 0.34 * Math.sin(v), (0.72 + 0.34 * Math.cos(v)) * Math.sin(u)];
  };
  const knot = (i: number): V3 => {
    const t = (i / N) * Math.PI * 2;
    return [(Math.sin(t) + 2 * Math.sin(2 * t)) / 3, (Math.cos(t) - 2 * Math.cos(2 * t)) / 3, -Math.sin(3 * t) / 2.4];
  };
  const cube = (i: number): V3 => [((i & 3) - 1.5) / 2, (((i >> 2) & 3) - 1.5) / 2, ((i >> 4) - 1.5) / 2];
  const helix = (i: number): V3 => {
    const k = i >> 1, a = (k / 32) * Math.PI * 4 + (i & 1) * Math.PI;
    return [Math.cos(a) * 0.55, (k / 31) * 2 - 1, Math.sin(a) * 0.55];
  };
  const shapes = [sphere, ...shuffle([torus, knot, cube, helix], R)];
  const pts = shapes.map((f) => Array.from({ length: N }, (_, i) => f(i)));
  const P = new Float32Array(N * 4);
  const order = Array.from({ length: N }, (_, i) => i);
  let warp = 0;

  return {
    name: 'bobs',
    bars: 8,
    scroller: true,
    scrollY: 210,
    draw(c) {
      const S = c.S, fb = S.fb;
      fb.fill(0);
      for (let i = 0; i < 8; i++) S.pal(1 + i, STAR[i]);
      for (let f = 0; f < 2; f++)
        for (let d = 0; d < 2; d++) for (let l = 0; l < 6; l++) S.pal(9 + f * 12 + d * 6 + l, d ? fam[f][l] : mix(fam[f][l], BG, 0.45));
      S.commit();
      for (let y = 0; y < H; y++) {
        const u = y / H;
        S.line(y, 0, mix(hex('#04030b'), hex('#160a2a'), Math.pow(u, 1.6)));
      }

      // stars
      warp += (Math.min(3, Math.abs(c.vx) * 2.5 + Math.abs(c.vy) * 1.5) - warp) * Math.min(1, c.dt * 3);
      const speed = (c.reduced ? 0.08 : 0.28) + warp * 0.6 + c.kick * 0.5;
      const vx = 160 + c.mx * 80, vy = 128 + c.my * 60;
      for (let i = 0; i < NS; i++) {
        sz[i] -= speed * c.dt;
        if (sz[i] < 0.03) reset(i);
        const z = sz[i];
        const px = vx + (sx[i] / z) * 100, py = vy + (sy[i] / z) * 100;
        if (px < -40 || px >= W + 40 || py < -40 || py >= H + 40) {
          reset(i);
          continue;
        }
        const lv = Math.min(7, Math.floor((1 - z) * 8.5));
        const tail = 1 + Math.floor(speed * 6);
        const z2 = z + speed * 0.05;
        const qx = vx + (sx[i] / z2) * 100, qy = vy + (sy[i] / z2) * 100;
        for (let k = tail; k >= 0; k--) {
          const f = k / Math.max(1, tail);
          const x = (px + (qx - px) * f) | 0, y = (py + (qy - py) * f) | 0;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const v = 1 + Math.max(0, Math.floor(lv * (1 - f * 0.8)));
          fb[y * W + x] = v;
          if (k === 0 && z < 0.3 && x + 1 < W && y + 1 < H) {
            fb[y * W + x + 1] = v;
            fb[(y + 1) * W + x] = v;
            fb[(y + 1) * W + x + 1] = v;
          }
        }
      }

      // bobs
      const per = BAR * 2;
      const k = Math.floor(c.t / per), f = smooth(((c.t % per) - (per - 0.9)) / 0.9);
      const A = pts[k % pts.length], B = pts[(k + 1) % pts.length];
      const ay = c.T * 0.7 + c.mx * 1.4, ax = c.T * 0.43 + c.my * 1.1, az = c.T * 0.19;
      const ca = Math.cos(ay), sa = Math.sin(ay), cb = Math.cos(ax), sb = Math.sin(ax), cc = Math.cos(az), sc = Math.sin(az);
      const sc0 = 1 + c.kick * 0.14;
      for (let i = 0; i < N; i++) {
        let x = A[i][0] + (B[i][0] - A[i][0]) * f, y = A[i][1] + (B[i][1] - A[i][1]) * f, z = A[i][2] + (B[i][2] - A[i][2]) * f;
        x *= sc0; y *= sc0; z *= sc0;
        let t = x * cc - y * sc; y = x * sc + y * cc; x = t;
        t = x * ca + z * sa; z = -x * sa + z * ca; x = t;
        t = y * cb - z * sb; z = y * sb + z * cb; y = t;
        const zz = z + 2.9;
        P[i * 4] = 160 + (x * 230) / zz;
        P[i * 4 + 1] = 112 + (y * 230) / zz;
        P[i * 4 + 2] = zz;
        P[i * 4 + 3] = i;
      }
      order.sort((a, b) => P[b * 4 + 2] - P[a * 4 + 2]);
      for (const i of order) {
        const zz = P[i * 4 + 2];
        const size = clamp(Math.round(13 * (2.9 / zz)), 3, 18);
        const spr = SPR[size - 3];
        const base = 9 + (i % 2) * 12 + (zz < 2.9 ? 6 : 0) - 1;
        const x0 = Math.round(P[i * 4] - size / 2), y0 = Math.round(P[i * 4 + 1] - size / 2);
        for (let y = 0; y < size; y++) {
          const yy = y0 + y;
          if (yy < 0 || yy >= H) continue;
          for (let x = 0; x < size; x++) {
            const v = spr.d[y * size + x];
            if (!v) continue;
            const xx = x0 + x;
            if (xx >= 0 && xx < W) fb[yy * W + xx] = base + v;
          }
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- 4. rotozoomer */

export function rotoPart(R: () => number): Part {
  const tex = new Uint8Array(256 * 256);
  const k = [5, 6, 8][Math.floor(R() * 3)];
  for (let v = 0; v < 256; v++)
    for (let u = 0; u < 256; u++) {
      const lx = (u & 63) - 31.5, ly = (v & 63) - 31.5;
      const par = ((u >> 6) + (v >> 6)) & 1;
      const r = Math.hypot(lx, ly), a = Math.atan2(ly, lx);
      const Rr = 23 + 4.5 * Math.cos(k * a + (par * Math.PI) / k);
      let t: number;
      if (r < Rr) {
        const inner = 9 + 2.5 * Math.cos(k * a * 2);
        const q = r < inner ? r / inner : (r - inner) / (Rr - inner);
        t = r < inner ? Math.floor(q * 4) : 4 + Math.floor(q * 11.99);
        t = Math.min(15, t);
      } else {
        const chk = ((u >> 4) ^ (v >> 4)) & 1;
        const sh = clamp((r - Rr) / 9);
        const edge = r - Rr < 1.3 ? 0 : 1 + Math.floor(sh * 6.99);
        t = 16 + chk * 8 + Math.min(7, edge);
      }
      tex[(v << 8) | u] = 1 + t;
    }
  const ROSE = grad(['#fff4d6', '#ffd38a', '#f59a4a', '#c85a2e', '#7a2a36', '#2c1e4a', '#1f4f78', '#3f9aa6', '#a8e3d0'], 16, true);
  const CA = grad(['#05040c', '#121233', '#232a5c'], 8);
  const CB = grad(['#07040a', '#24122e', '#40204f'], 8);
  let ang = R() * 6, zoom = 1.5, bend = 0;
  return {
    name: 'rotozoom',
    bars: 8,
    scroller: true,
    scrollY: 206,
    draw(c) {
      const S = c.S, fb = S.fb;
      const cyc0 = c.T * 7;
      for (let i = 0; i < 16; i++) S.pal(1 + i, cyc(ROSE, (i - cyc0) / 16));
      for (let i = 0; i < 8; i++) {
        S.pal(17 + i, CA[i]);
        S.pal(25 + i, CB[i]);
      }
      ang += (0.3 + c.mx * 1.5) * c.dt * (c.reduced ? 0.4 : 1);
      zoom += (0.62 + Math.sin(c.T * 0.45) * 0.34 + c.my * 0.5 - zoom) * Math.min(1, c.dt * 2);
      bend += (Math.min(30, Math.abs(c.vx) * 26 + Math.abs(c.vy) * 18) - bend) * Math.min(1, c.dt * 3);
      const z = Math.max(0.16, zoom * (1 - c.kick * 0.16));
      const du = Math.cos(ang) * z, dv = Math.sin(ang) * z;
      const cu = 128 + c.T * 18, cv = 128 + Math.sin(c.T * 0.31) * 70;
      for (let y = 0; y < H; y++) {
        const yy = y - 128, sh = Math.sin(y * 0.045 + c.T * 3.1) * bend;
        let u = cu + (-160 + sh) * du - yy * dv, v = cv + (-160 + sh) * dv + yy * du;
        const o = y * W;
        for (let x = 0; x < W; x++) {
          fb[o + x] = tex[(((v | 0) & 255) << 8) | ((u | 0) & 255)];
          u += du;
          v += dv;
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- 5. glenz vectors */

function tri(buf: Uint8Array, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, val: number) {
  if (y1 < y0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
  if (y2 < y0) { [x0, x2] = [x2, x0]; [y0, y2] = [y2, y0]; }
  if (y2 < y1) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
  const ys = Math.max(0, Math.ceil(y0)), ye = Math.min(H, Math.ceil(y2));
  for (let y = ys; y < ye; y++) {
    const xa = x0 + ((x2 - x0) * (y - y0)) / (y2 - y0 || 1);
    const xb = y < y1 ? x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1) : x1 + ((x2 - x1) * (y - y1)) / (y2 - y1 || 1);
    let l = Math.ceil(Math.min(xa, xb)), r = Math.ceil(Math.max(xa, xb));
    if (l < 0) l = 0;
    if (r > W) r = W;
    const o = y * W;
    for (let x = l; x < r; x++) buf[o + x] = val;
  }
}

export function glenzPart(R: () => number): Part {
  const back = new Uint8Array(W * H), front = new Uint8Array(W * H);
  const HOR = 166;
  const schemes = [
    { f: ['#bff6ff', '#2c64ff'], b: ['#7fd8ff', '#1a2a8a'] },
    { f: ['#ffe0f0', '#ff3d7f'], b: ['#ff9ac0', '#5a0f3a'] },
    { f: ['#e9ffd6', '#14b38a'], b: ['#a6f0c6', '#0b4a40'] },
  ];
  const sc = schemes[Math.floor(R() * schemes.length)];
  const FA = hex(sc.f[0]), FB = hex(sc.f[1]), BA = hex(sc.b[0]), BB = hex(sc.b[1]);
  const SKY = grad(['#0b0726', '#24104a', '#5a1f66', '#b04a6e', '#ffb38a'], H);
  const CHA = hex('#f0a46a'), CHB = hex('#3a1430'), HAZE = hex('#ffc9a0');

  // stellated cube: each face becomes a 4-sided pyramid
  const corners: V3[] = [];
  for (let i = 0; i < 8; i++) corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  const faces: { axis: number; s: number; ring: number[] }[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const s of [-1, 1]) {
      const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
      const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => {
        const v: V3 = [0, 0, 0];
        v[axis] = s; v[a1] = p; v[a2] = q;
        return corners.findIndex((c) => c[0] === v[0] && c[1] === v[1] && c[2] === v[2]);
      });
      faces.push({ axis, s, ring });
    }
  // inner octahedron
  const oct: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const octT = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];

  let yaw = 0, pitch = 0.4, ox = 0;
  let tab: Float32Array | null = null;
  const L: V3 = [-0.45, 0.7, -0.55];
  const ll = Math.hypot(...L);

  const xf = (p: V3, m: number[], t: V3): V3 => [
    p[0] * m[0] + p[1] * m[1] + p[2] * m[2] + t[0],
    p[0] * m[3] + p[1] * m[4] + p[2] * m[5] + t[1],
    p[0] * m[6] + p[1] * m[7] + p[2] * m[8] + t[2],
  ];
  const rot = (a: number, b: number, g: number, sx: number, sy: number) => {
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    // R = Rx(b) * Ry(a) * Rz(g), then scale
    const m = [
      ca * cg, -ca * sg, sa,
      sb * sa * cg + cb * sg, -sb * sa * sg + cb * cg, -sb * ca,
      -cb * sa * cg + sb * sg, cb * sa * sg + sb * cg, cb * ca,
    ];
    return [m[0] * sx, m[1] * sx, m[2] * sx, m[3] * sy, m[4] * sy, m[5] * sy, m[6] * sx, m[7] * sx, m[8] * sx];
  };
  const K = 200;
  const proj = (p: V3) => [160 + (p[0] * K) / p[2], 118 - (p[1] * K) / p[2]];

  function drawTris(tris: { p: V3[]; par: number }[], center: V3, frontMode: 'glass' | 'inner') {
    for (const t of tris) {
      const [a, b, c] = t.p;
      const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const cen: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      if (n[0] * (cen[0] - center[0]) + n[1] * (cen[1] - center[1]) + n[2] * (cen[2] - center[2]) < 0) n = [-n[0], -n[1], -n[2]];
      const facing = n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0;
      const A = proj(a), B = proj(b), C = proj(c);
      if (frontMode === 'inner') {
        if (!facing) continue;
        tri(back, A[0], A[1], B[0], B[1], C[0], C[1], 1 + t.par);
      } else if (facing) {
        const nl = Math.hypot(...n) || 1;
        const lam = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll));
        const lv = Math.min(2, Math.floor(lam * 2.6 + 0.35));
        tri(front, A[0], A[1], B[0], B[1], C[0], C[1], 1 + t.par * 3 + lv);
      } else tri(back, A[0], A[1], B[0], B[1], C[0], C[1], 1 + t.par);
    }
  }

  return {
    name: 'glenz',
    bars: 8,
    scroller: true,
    scrollY: 212,
    draw(c) {
      const S = c.S, fb = S.fb;
      back.fill(0);
      front.fill(0);
      // floor (checker in perspective) writes 0 / 21 into fb
      const camZ = c.T * 5;
      for (let y = 0; y < H; y++) {
        const o = y * W;
        if (y < HOR + 2) {
          fb.fill(0, o, o + W);
          continue;
        }
        const depth = 700 / (y - HOR);
        const du = depth * 0.0075, u0 = 1000 - 160 * du + Math.sin(c.T * 0.4) * 2 + c.mx * 1.5;
        const vq = ((depth * 0.2 + camZ) | 0) & 1;
        for (let x = 0; x < W; x++) fb[o + x] = (((u0 + x * du) | 0) & 1) ^ vq ? 21 : 0;
      }

      yaw += (0.9 + c.mx * 2.4) * c.dt * (c.reduced ? 0.35 : 1);
      pitch += (0.4 + c.my * 1.0 - pitch) * Math.min(1, c.dt * 3);
      ox += (c.mx * 1.1 - ox) * Math.min(1, c.dt * 2);
      const hb = Math.abs(Math.sin((Math.PI * c.T) / (2 * BEAT)));
      const squash = c.reduced ? 1 : 1 - Math.max(0, 0.16 - hb) * 1.2;
      const spike = Math.max(0.15, 2.1 + c.kick * 0.9 + c.my * 1.1 + Math.sin(c.T * 0.8) * 0.3);
      const pos: V3 = [ox, -0.45 + hb * (c.reduced ? 0.3 : 0.8), 10];
      const m = rot(yaw, pitch, c.T * 0.3, 1 / Math.sqrt(squash), squash);
      const wc = corners.map((p) => xf(p, m, pos));
      const tris: { p: V3[]; par: number }[] = [];
      faces.forEach((f, fi) => {
        const apex: V3 = [0, 0, 0];
        apex[f.axis] = f.s * (1 + spike);
        const wa = xf(apex, m, pos);
        for (let i = 0; i < 4; i++) tris.push({ p: [wa, wc[f.ring[i]], wc[f.ring[(i + 1) % 4]]], par: (fi + i) & 1 });
      });
      // back faces first, then the inner octahedron, then glass fronts
      drawTris(tris.map((t) => t), pos, 'glass');
      const mi = rot(-yaw * 1.7, c.T * 0.9, 0.3, 0.62, 0.62);
      const wo = oct.map((p) => xf(p, mi, pos));
      const inner = octT.map((t, i) => ({ p: [wo[t[0]], wo[t[1]], wo[t[2]]], par: i & 1 }));
      // inner faces overwrite the glass's back layer
      drawTris(inner, pos, 'inner');
      for (let i = 0; i < W * H; i++) fb[i] += back[i] * 7 + front[i];

      // palette: every combination of floor/sky, back glass and front glass, per scanline
      S.commit();
      if (!tab) tab = buildTab();
      for (let y = 0; y < H; y++) {
        const n = y < HOR + 2 ? 21 : 42, o = y * 42 * 3;
        for (let i = 0; i < n; i++) S.cop[(y << 6) | i] = S.pk(tab[o + i * 3], tab[o + i * 3 + 1], tab[o + i * 3 + 2]);
      }
    },
  };

  function buildTab() {
    const tab = new Float32Array(H * 42 * 3);
    const FRONT: RGB[] = [mul(FA, 0.7), mul(FA, 0.88), FA, mul(FB, 0.65), mul(FB, 0.85), FB];
    const BACK: RGB[] = [BA, BB];
    for (let y = 0; y < H; y++) {
        const floor = y >= HOR + 2;
        let bgs: RGB[];
        if (!floor) bgs = [y >= HOR - 1 ? HAZE : SKY[Math.min(H - 1, Math.floor((y / HOR) * H * 0.98))]];
        else {
          const fog = 1 - smooth((y - HOR - 3) / 46);
          bgs = [mix(CHA, HAZE, fog), mix(CHB, HAZE, fog * 0.92)];
        }
        for (let ci = 0; ci < bgs.length; ci++)
          for (let b = 0; b < 3; b++)
            for (let f = 0; f < 7; f++) {
              let col = bgs[ci];
              if (b) col = mix(col, BACK[b - 1], 0.42);
              if (f) col = mix(col, FRONT[f - 1], 0.55);
              const k = (y * 42 + ci * 21 + b * 7 + f) * 3;
              tab[k] = col[0];
              tab[k + 1] = col[1];
              tab[k + 2] = col[2];
            }
    }
    return tab;
  }
}

/* ---------------------------------------------------------------- 6. voxel landscape */

export function voxelPart(R: () => number): Part {
  const N = 256, M = N - 1;
  const hm = new Float32Array(N * N);
  const lat = (f: number) => Float32Array.from({ length: f * f }, () => R());
  const noise = (f: number) => {
    const g = lat(f), out = new Float32Array(N * N);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const gx = (x / N) * f, gy = (y / N) * f;
        const ix = Math.floor(gx), iy = Math.floor(gy);
        const fx = smooth(gx - ix), fy = smooth(gy - iy);
        const a = g[(iy % f) * f + (ix % f)], b = g[(iy % f) * f + ((ix + 1) % f)];
        const c = g[((iy + 1) % f) * f + (ix % f)], d = g[((iy + 1) % f) * f + ((ix + 1) % f)];
        out[y * N + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      }
    return out;
  };
  const oct = [4, 8, 16, 32, 64].map(noise);
  const jit = noise(128);
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < N * N; i++) {
    const base = oct[0][i] * 0.5 + oct[1][i] * 0.27 + oct[2][i] * 0.13 + oct[3][i] * 0.07 + oct[4][i] * 0.035;
    const ridge = 1 - Math.abs(oct[1][i] * 2 - 1);
    const h = base * 0.75 + ridge * ridge * 0.38 * oct[0][i];
    hm[i] = h;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  for (let i = 0; i < N * N; i++) hm[i] = Math.pow(clamp((hm[i] - lo) / (hi - lo)), 1.35);
  const WL = 0.24;
  const HS = 70; // world height scale
  const sunAz = R() * Math.PI * 2, sunEl = 0.2;
  const sun: V3 = [Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl)];
  // blurred height for ambient occlusion
  const blur = new Float32Array(N * N), tmp = new Float32Array(N * N);
  const rad = 5;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += hm[y * N + ((x + k) & M)];
      tmp[y * N + x] = s / (rad * 2 + 1);
    }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let k = -rad; k <= rad; k++) s += tmp[((y + k) & M) * N + x];
      blur[y * N + x] = s / (rad * 2 + 1);
    }
  const tone = new Uint8Array(N * N), light = new Float32Array(N * N), rh = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const h = hm[i];
      const dx = (hm[y * N + ((x + 1) & M)] - hm[y * N + ((x - 1) & M)]) * HS * 0.5;
      const dy = (hm[((y + 1) & M) * N + x] - hm[((y - 1) & M) * N + x]) * HS * 0.5;
      const nl = Math.hypot(dx, dy, 1);
      const water = h < WL;
      let lam = water ? 0.55 : Math.max(0, (-dx * sun[0] - dy * sun[1] + sun[2]) / nl);
      // cast shadow: march toward the sun
      if (!water) {
        let px = x, py = y, ph = h * HS;
        for (let s = 0; s < 48; s++) {
          px += sun[0] * 1.5; py += sun[1] * 1.5; ph += sun[2] * 1.5 * 1.02;
          if (hm[((py | 0) & M) * N + ((px | 0) & M)] * HS > ph) { lam *= 0.25; break; }
        }
      }
      const ao = clamp(1 + (h - blur[i]) * 6, 0.45, 1.15);
      light[i] = clamp((0.26 + 0.78 * lam) * ao) * 5.2;
      const slope = Math.hypot(dx, dy);
      const hh = h + (jit[i] - 0.5) * 0.05;
      let t: number;
      if (h < WL - 0.05) t = 0;
      else if (h < WL) t = 1;
      else if (hh < WL + 0.035) t = 2;
      else if (slope > 1.25 && hh > 0.36) t = 5;
      else if (hh < 0.46) t = 3;
      else if (hh < 0.62) t = 4;
      else if (hh < 0.8) t = 5;
      else t = 6;
      tone[i] = t;
      rh[i] = Math.max(h, WL) * HS;
    }

  const TONES = [
    ['#08122e', '#0f2650', '#1a4378', '#3d6a98', '#c98a86', '#ffd0a6'],
    ['#0c2a40', '#145067', '#22788a', '#4fa8aa', '#9fd4c4', '#ffe2be'],
    ['#2a1c22', '#5e4436', '#957252', '#c7a16f', '#ebca94', '#fff0cc'],
    ['#0e1a16', '#1f3a1e', '#3c6127', '#6b8a2f', '#a7b04a', '#e5d27a'],
    ['#091410', '#132a1c', '#1f4426', '#36602f', '#5e7f3a', '#9da25a'],
    ['#1a1420', '#3a2c34', '#5f4a4a', '#8c7060', '#c09c82', '#f2d2b0'],
    ['#2c3054', '#5a6290', '#8f98c0', '#c4c8e0', '#ece6ee', '#ffffff'],
  ].map((t) => t.map(hex));
  const SUN = hex('#fff4d0'), HALO = hex('#ffbe86');
  const cloud = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) cloud[i] = clamp((oct[2][i] * 0.55 + oct[3][i] * 0.3 + oct[4][i] * 0.25 + oct[1][i] * 0.2 - 0.68) * 3);
  const CL = hex('#ffb4a2'), CH = hex('#fff1dc'), CD = hex('#3a2a5e');
  let drift = 0;

  let px = R() * N, py = R() * N, phi = -sunAz - Math.PI / 2 + (R() < 0.5 ? 0.62 : -0.62), camH = 60, roll = 0;
  const ybuf = new Int16Array(W);
  const FAR = 420;
  return {
    name: 'voxel',
    bars: 12,
    scroller: true,
    scrollY: 214,
    enter() {
      camH = rh[((py | 0) & M) * N + ((px | 0) & M)] + 24;
    },
    draw(c) {
      const S = c.S, fb = S.fb;
      for (let t = 0; t < 7; t++) for (let l = 0; l < 6; l++) S.pal(1 + t * 6 + l, TONES[t][l]);
      S.pal(43, SUN);
      S.pal(44, HALO);
      fb.fill(0);

      const spd = (c.reduced ? 8 : 26) * (1 + c.kick * 0.25);
      phi -= c.mx * 1.25 * c.dt;
      roll += (c.mx * 0.2 - roll) * Math.min(1, c.dt * 3);
      const sp = Math.sin(phi), cp = Math.cos(phi);
      px -= sp * spd * c.dt;
      py -= cp * spd * c.dt;
      let g = 0;
      for (let d = 0; d <= 60; d += 6)
        for (const s of [-8, 0, 8]) g = Math.max(g, rh[((py - cp * d + sp * s) & M) * N + ((px - sp * d - cp * s) & M)]);
      const want = g + 26 - c.my * 20;
      camH += (want - camH) * Math.min(1, c.dt * (want > camH ? 3 : 1.2));
      const hor = 92 + c.my * 22;

      // sky via copper (per-line colour 0), sun disc
      const rel = Math.atan2(Math.cos(sunAz) * cp - Math.sin(sunAz) * sp, -Math.cos(sunAz) * sp - Math.sin(sunAz) * cp);
      const sunX = 160 + Math.tan(rel) * 160, sunY = hor - Math.tan(sunEl) * 160 - 6;
      if (Math.abs(rel) < 1.1) {
        for (let y = Math.max(0, (sunY - 26) | 0); y < Math.min(H, sunY + 26); y++)
          for (let x = Math.max(0, (sunX - 26) | 0); x < Math.min(W, sunX + 26); x++) {
            const d = Math.hypot(x - sunX, (y - sunY) * 1.05);
            if (d < 11) fb[y * W + x] = 43;
            else if (d < 24 && (24 - d) / 13 > BAY[((y & 3) << 2) | (x & 3)] * 1.6) fb[y * W + x] = 44;
          }
      }

      // a cloud deck, projected like a ceiling
      drift += c.dt * 3;
      for (let y = 0; y < hor - 5; y++) {
        const dy = hor - y, dist = (58 * 150) / dy;
        const fade = clamp((dy - 5) / 38);
        const fx = -sp * dist, fy = -cp * dist, k = dist / 160;
        let wx = px + fx - cp * 160 * k, wy = py + fy + sp * 160 * k;
        const sx = cp * k, sy = -sp * k;
        const o = y * W, by = (y & 3) << 2;
        for (let i = 0; i < W; i++) {
          const d = cloud[(((wy * 0.4) | 0) & M) * N + (((wx * 0.4 + drift) | 0) & M)] * fade;
          if (d > 0) {
            const b = BAY[by | (i & 3)];
            if (d > b) fb[o + i] = d > 0.55 + b * 0.45 ? 46 : 45;
          }
          wx += sx;
          wy += sy;
        }
      }

      ybuf.fill(H);
      let z = 5, dz = 0.4;
      const bx = (x: number, y: number) => BAY[((y & 3) << 2) | (x & 3)];
      while (z < FAR) {
        const plx = -cp * z - sp * z + px, ply = sp * z - cp * z + py;
        const prx = cp * z - sp * z + px, pry = -sp * z - cp * z + py;
        const ddx = (prx - plx) / W, ddy = (pry - ply) / W;
        let lx = plx, ly = ply;
        const inv = 150 / z;
        const fog = clamp((z - 250) / (FAR - 250));
        const fogq = Math.pow(fog, 1.4);
        const near = z < 90;
        for (let i = 0; i < W; i++) {
          const fx0 = Math.floor(lx), fy0 = Math.floor(ly);
          const x0 = fx0 & M, y0 = fy0 & M;
          const mi = y0 * N + x0;
          let hg = rh[mi];
          if (near) {
            const fx = lx - fx0, fy = ly - fy0, x1 = (x0 + 1) & M, y1 = ((y0 + 1) & M) * N;
            const b0 = rh[y0 * N + x1], c0 = rh[y1 + x0], d0 = rh[y1 + x1];
            hg += (b0 - hg) * fx + (c0 - hg) * fy + (hg - b0 - c0 + d0) * fx * fy;
          }
          let lv = light[mi];
          if (near) {
            const fx = lx - fx0, fy = ly - fy0, x1 = (x0 + 1) & M, y1 = ((y0 + 1) & M) * N;
            const b0 = light[y0 * N + x1], c0 = light[y1 + x0], d0 = light[y1 + x1];
            lv += (b0 - lv) * fx + (c0 - lv) * fy + (lv - b0 - c0 + d0) * fx * fy;
          }
          const hs = ((camH - hg) * inv + hor + (i - 160) * roll) | 0;
          const yb = ybuf[i];
          if (hs < yb) {
            const top = hs < 0 ? 0 : hs;
            const t = tone[mi];
            if (t <= 1) lv += Math.sin(lx * 0.9 + c.T * 2.2 + ly * 0.4) * 0.5;
            const base = 1 + t * 6;
            for (let y = top; y < yb; y++) {
              const b = bx(i, y);
              if (fogq > b) fb[y * W + i] = 0;
              else {
                let l = (lv + b - 0.5) | 0;
                l = l < 0 ? 0 : l > 5 ? 5 : l;
                fb[y * W + i] = base + l;
              }
            }
            ybuf[i] = top;
          }
          lx += ddx;
          ly += ddy;
        }
        z += dz;
        dz *= 1.016;
      }

      S.commit();
      const ZEN = hex('#10163f'), MID = hex('#4a2f72'), LOW = hex('#e0707a'), HZ = hex('#ffc49a'), BEL = hex('#f2b08e');
      for (let y = 0; y < H; y++) {
        const d = (hor - y) / hor;
        let col: RGB;
        if (d > 0) col = d > 0.55 ? mix(MID, ZEN, (d - 0.55) / 0.45) : d > 0.12 ? mix(LOW, MID, (d - 0.12) / 0.43) : mix(HZ, LOW, d / 0.12);
        else col = mix(HZ, BEL, clamp(-d * 2));
        S.line(y, 0, col);
        if (y < hor) {
          const up = clamp(d * 1.6);
          S.line(y, 45, mix(col, mix(CL, CD, up), 0.5));
          S.line(y, 46, mix(col, mix(CH, CL, up * 0.6), 0.7));
        }
        // aerial haze on the terrain near the horizon, rewritten per scanline
        const hz = Math.pow(1 - clamp(Math.abs(y - hor - 4) / 46), 1.6) * 0.55;
        if (hz > 0.01)
          for (let t = 0; t < 7; t++) for (let l = 0; l < 6; l++) S.line(y, 1 + t * 6 + l, mix(TONES[t][l], col, hz));
      }
    },
  };
}

/* ---------------------------------------------------------------- 7. greetings in a tunnel */

export function greetsPart(R: () => number, greets: Link[]): Part {
  const TW = 640, TH = 512;
  let tA: Uint8Array | null = null, tD: Uint16Array | null = null, tB: Uint8Array | null = null;
  const tables = () => {
    if (tA) return;
    tA = new Uint8Array(TW * TH);
    tD = new Uint16Array(TW * TH);
    tB = new Uint8Array(TW * TH);
    for (let y = 0; y < TH; y++)
      for (let x = 0; x < TW; x++) {
        const dx = x - 320, dy = (y - 256) * 1.08, d = Math.max(1, Math.hypot(dx, dy));
        const i = y * TW + x;
        tA[i] = ((Math.atan2(dy, dx) / (Math.PI * 2)) * 256 + 256) & 255;
        tD[i] = Math.min(65535, (5200 / d) | 0);
        tB[i] = Math.min(255, Math.pow(d / 170, 0.8) * 255) | 0;
      }
  };
  const tex = new Uint8Array(256 * 256);
  for (let v = 0; v < 256; v++)
    for (let u = 0; u < 256; u++) {
      const pu = u & 7, pv = v & 15, par = ((u >> 3) + (v >> 4)) & 1;
      let t = 2 + par;
      if ((v >> 4) % 3 === 0 && pv >= 6 && pv <= 9 && ((u >> 3) & 1)) t = 7;
      else if (pu < 1 || pv < 1) t = 0;
      else if (pv < 3) t = 6;
      else if (pu < 2) t = 5;
      else if (pv > 13 || pu > 6) t = 1;
      else if (pu === 4 && pv === 8) t = 6;
      tex[(v << 8) | u] = t;
    }
  const TONE = ['#0a0612', '#22122c', '#3b2152', '#53284a', '#8a4a52', '#e0905a', '#ffd9a4', '#8ff4ff'].map(hex);
  const DEEP = hex('#05030a');

  const head = medium('GREETINGS TO');
  const headSmall = small('- GREETINGS TO -');
  const fit = (name: string): Bmp[] => {
    const up = name.toUpperCase();
    const one = big(up);
    if (one.w <= 304) return [one];
    const words = up.split(' ');
    let best = [up, ''], score = 1e9;
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(' '), b = words.slice(k).join(' ');
      const s = Math.abs(a.length - b.length);
      if (s < score) { score = s; best = [a, b]; }
    }
    return best.map((s) => (big(s).w <= 304 ? big(s) : medium(s)));
  };
  const all = [...greets.map((g) => ({ g, bm: fit(g.label) })), { g: null as Link | null, bm: fit('AND YOU') }];
  const SLOT = BAR * 2, INTRO = BAR * 2;
  const total = INTRO + SLOT * all.length;
  let gt = 0, rot = 0, adv = 0, ox = 0, oy = 0;
  const cur = () => clamp(Math.floor((gt - INTRO) / SLOT), -1, all.length - 1);
  return {
    name: 'greets',
    bars: 14,
    scroller: false,
    enter() {
      gt = 0;
      tables();
    },
    scrub(dx) {
      gt = clamp(gt - dx * 0.03, 0, total - 0.01);
    },
    done: () => gt >= total - 0.05,
    item() {
      const k = cur();
      if (k < 0) return { key: 'g-intro', pre: 'greetings to', label: '' };
      const e = all[k];
      if (!e.g) return { key: 'g-you', pre: 'and you, for watching' };
      return { key: 'g' + k, pre: 'greetings to', label: e.g.label, url: e.g.url };
    },
    draw(c) {
      tables();
      const S = c.S, fb = S.fb, A = tA!, D = tD!, B = tB!;
      gt += c.dt;
      const glow = 0.55 + c.snare * 0.45 + c.hat * 0.2;
      for (let t = 0; t < 8; t++)
        for (let b = 0; b < 4; b++) {
          const k = (0.12 + b * 0.29) ** 1.25;
          let col = mix(DEEP, TONE[t], k);
          if (t === 7) col = mix(DEEP, mul(TONE[7], glow + 0.2), k);
          S.pal(1 + t * 4 + b, col);
        }
      logoPal(S, ((c.T / 0.06) % 50) - 1);
      ox += (c.mx * 95 + Math.sin(c.T * 0.7) * 28 - ox) * Math.min(1, c.dt * 2.5);
      oy += (c.my * 70 + Math.cos(c.T * 0.53) * 22 - oy) * Math.min(1, c.dt * 2.5);
      rot += (8 + c.mx * 40) * c.dt;
      adv += (c.reduced ? 30 : 110 + c.kick * 160) * c.dt;
      const ri = rot | 0, ai = adv | 0;
      const ix = Math.round(ox), iy = Math.round(oy);
      for (let y = 0; y < H; y++) {
        const o = y * W, k0 = (y + 128 - iy) * TW + 160 - ix, by = (y & 3) << 2;
        for (let x = 0; x < W; x++) {
          const k = k0 + x;
          const t = tex[(((D[k] + ai) & 255) << 8) | ((A[k] + ri) & 255)];
          let b = (B[k] * 4) / 256 + BAY[by | (x & 3)] - 0.5;
          b = b < 0 ? 0 : b > 3 ? 3 : b | 0;
          fb[o + x] = 1 + t * 4 + b;
        }
      }
      // text
      const k = cur();
      if (k < 0) {
        const s = smooth(gt / 0.6);
        blitZoom(S, head, 160, 120, 0.2 + s * 0.8 + Math.sin(c.T * 3) * 0.03 * s, (y) => Math.sin(y * 0.2 + c.T * 4) * 2);
      } else {
        blit(S, headSmall, (W - headSmall.w) >> 1, 34);
        const lt = gt - INTRO - k * SLOT;
        const inn = smooth(lt / 0.45), out = smooth((SLOT - lt) / 0.3);
        const s = Math.min(1, out) * (inn < 1 ? 2.4 - inn * 1.4 : 1);
        const lines = all[k].bm;
        const tot = lines.reduce((a, b) => a + b.h + 4, -4);
        let y = 124 - tot / 2;
        for (const bm of lines) {
          const amp = c.reduced ? 0 : 2 + c.snare * 3;
          blitZoom(S, bm, 160, 124 + (y + bm.h / 2 - 124) * s, s * (inn < 1 ? 1 : 1 + c.kick * 0.04), (yy) => Math.sin(yy * 0.18 + c.T * 4.5) * amp);
          y += bm.h + 4;
        }
      }
    },
  };
}

/* ---------------------------------------------------------------- 8. credits over kefrens bars */

export type Credit = { text: string; size?: 's' | 'm'; link?: Link; gap?: number };

export function creditsPart(R: () => number, credits: Credit[], contact: Link[]): Part {
  const lines = credits.map((c) => ({ ...c, bm: c.text ? (c.size === 'm' ? medium(c.text) : small(c.text)) : null }));
  let y = 0;
  const ys = lines.map((l) => {
    const yy = y;
    y += (l.bm ? l.bm.h : 6) + (l.gap ?? 3);
    return yy;
  });
  const total = y;
  const BARW = 18;
  const prof = Array.from({ length: BARW }, (_, i) => {
    const u = Math.abs(i + 0.5 - BARW / 2) / (BARW / 2);
    return u > 0.92 ? 1 : 2 + Math.min(8, Math.floor((1 - u * u) * 9));
  });
  const lb = new Uint8Array(W);
  const RB = grad(['#ff5e5e', '#ffb35e', '#fff08a', '#6ef0a8', '#5ec8ff', '#9a7cff', '#ff6ee0'], 64, true);
  let sp = -H + 30, vel = 0;
  const seedPh = R() * 10;
  return {
    name: 'credits',
    bars: 24,
    scroller: false,
    enter() {
      sp = -H + 40;
      vel = 0;
    },
    scrub(dx) {
      sp = clamp(sp - dx * 1.2, -H, total);
    },
    done: () => sp >= total + 10,
    item() {
      const centre = sp + 128;
      let on = -1, best = 1e9;
      lines.forEach((l, i) => {
        if (!l.link) return;
        const d = Math.abs(ys[i] + 5 - centre);
        if (d < best) { best = d; on = i; }
      });
      const onUrl = on >= 0 && best < 100 ? lines[on].link!.url : '';
      return { key: 'credits:' + onUrl, pre: 'say hello', links: contact.map((l) => ({ ...l, on: l.url === onUrl })) };
    },
    draw(c) {
      const S = c.S, fb = S.fb;
      sp += c.dt * (c.reduced ? 10 : 17);
      S.pal(1, hex('#0a0510'));
      for (let i = 0; i < 9; i++) S.pal(2 + i, [0, 0, 0]);
      const T = c.T + seedPh;
      lb.fill(0);
      for (let yy = 0; yy < H; yy++) {
        for (let j = 0; j < 2; j++) {
          const ph = j * 2.6;
          const x =
            160 - BARW / 2 +
            Math.sin(yy * 0.043 + T * 1.25 + ph) * Math.sin(T * 0.41 + yy * 0.011 + ph * 0.7) * 128 +
            Math.sin(yy * 0.09 - T * 2.1 + ph) * (14 + c.kick * 16) +
            c.mx * 60 * Math.sin(yy * 0.021 + T * 0.3 + ph);
          const xi = x | 0;
          for (let k = 0; k < BARW; k++) {
            const xx = xi + k;
            if (xx >= 0 && xx < W) lb[xx] = prof[k];
          }
        }
        fb.set(lb, yy * W);
      }
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l.bm) continue;
        const yy = ys[i] - sp;
        if (yy < -20 || yy > H) continue;
        const x0 = (W - l.bm.w) >> 1;
        blitShadow(S, l.bm, x0 + 1, yy + 1, 49);
        blit(S, l.bm, x0, yy);
      }
      S.commit();
      const fontBase: RGB[] = [];
      for (let i = 48; i < 64; i++) fontBase.push(S.get(i));
      for (let yy = 0; yy < H; yy++) {
        const bg = mix(hex('#07040e'), hex('#170a1c'), yy / H);
        S.line(yy, 0, bg);
        const tint = cyc(RB, yy / 300 + c.T * 0.08);
        for (let k = 0; k < 9; k++) {
          const I = (k + 1) / 9;
          let col = mul(tint, 0.18 + 0.82 * Math.pow(I, 1.2));
          if (k === 8) col = mix(col, [255, 255, 255], 0.55);
          S.line(yy, 2 + k, col);
        }
        S.line(yy, 1, mul(tint, 0.1));
        const e = Math.min(1, yy / 36, (H - 1 - yy) / 36);
        if (e < 1)
          for (let i = 48; i < 64; i++) S.line(yy, i, mix(bg, fontBase[i - 48], Math.max(0, e)));
      }
    },
  };
}
