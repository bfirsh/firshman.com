// Procedural landscape painted into indexed buffers. Nothing here moves:
// every later motion is a rotation or re-colouring of these indices.

import { mulberry32, hash2, noise1, noise2, fbm1, fbm2, qband, clamp, lerp, smoothstep, bayer } from './noise';
import { textPixels } from './font';

export const NB = 15; // normal buckets per material: 5 sideways x 3 upward
export const BUCKET_N: [number, number, number][] = [];
for (let ix = 0; ix < 5; ix++) for (let iy = 0; iy < 3; iy++) {
  const nx = (ix - 2) * 0.48, up = [0.08, 0.5, 0.92][iy], nz = 0.8;
  const l = Math.hypot(nx, up, nz);
  BUCKET_N.push([nx / l, up / l, nz / l]);
}

export interface Mat { name: string; albedo: string; depth: number; base: number; ramp: boolean }
// prettier-ignore
const MAT_DEFS: [string, string, number, boolean?][] = [
  ['farRock', '#a3a7bd', 2.5],
  ['farSnow', '#f4f6fc', 2.5],
  ['midRock', '#948478', 1.3],
  ['midSnow', '#f0f2f8', 1.3],
  ['midForest', '#3d6b4c', 1.2],
  ['hillGrass', '#8aa65c', 0.55],
  ['hillForest', '#2b5a3f', 0.5],
  ['cliff', '#857464', 0.5],
  ['fgGrass', '#6a9c50', 0.05, true],
  ['fgPine', '#204c38', 0.03],
  ['stone', '#cbbd96', 0.05],
  ['wood', '#9a6442', 0.03],
];

export const SKY0 = 1, NSKY = 32;
let next = SKY0 + NSKY;
export const MATS: Mat[] = MAT_DEFS.map(([name, albedo, depth, ramp]) => { const m = { name, albedo, depth, base: next, ramp: !!ramp }; next += NB; return m; });
export const M: Record<string, number> = Object.fromEntries(MATS.map((m, i) => [m.name, i]));
export const WF0 = next, NWF = 16; next += NWF;
export const FOAM0 = next, NFOAM = 8; next += NFOAM;
export const ST0 = next, NST = 12; next += NST;
export const FLOWER0 = next, NFLOWER = 3; next += NFLOWER;
export const WATER = next++;
if (next > 256) throw new Error('palette overflow ' + next);

// overlay index layouts
export const STAR_CLS = 32; // phases per class
export const CL_N = 256, CL_L = 8; // cloud phase period, threshold levels

export interface Hotspot {
  id: string; kind: 'name' | 'post' | 'star' | 'balloon';
  x: number; y: number; w: number; h: number; // world pixels
  ref: number; pts?: [number, number][]; lines?: [number, number][];
}

export interface CloudBand { speed: number }

export interface World {
  seed: number; WW: number; H: number; HZ: number;
  scene: Uint8Array; layer: Uint8Array;
  cloud: Uint16Array; bands: CloudBand[]; cloudF: Float32Array;
  star: Uint8Array; light: Uint8Array; rain: Uint8Array; snow: Uint8Array;
  glints: Float32Array; splashes: Float32Array; wob: Uint8Array;
  shoreY: Int16Array;
  hot: Hotspot[];
  moonPhase: number;
  sky: { top: number }; // sun arc scale
  wf: { x: number; top: number; w: number } | null;
}

const LAYER = { sky: 0, far: 1, mid: 2, hill: 3, fg: 4, water: 5 };

export function buildWorld(seed: number, WW: number, H: number): World {
  const rng = mulberry32(seed);
  const R = (a = 0, b = 1) => a + (b - a) * rng();
  const S = seed % 9973;
  const k = H / 270; // vertical scale
  const portrait = H > WW * 0.9;
  const HZ = Math.round(H * (portrait ? 0.6 : 0.635));
  const N = WW * H;
  const scene = new Uint8Array(N), layer = new Uint8Array(N);

  const bucket = (nx: number, up: number, x: number, y: number) =>
    qband((nx + 1) / 2, 5, x, y, 0.38, 0.62) * 3 + qband(up, 3, x + 1, y, 0.36, 0.64);
  const put = (x: number, y: number, m: number, nx: number, up: number, ly: number) => {
    if (x < 0 || y < 0 || x >= WW || y >= H) return;
    const i = y * WW + x;
    scene[i] = MATS[m].base + (MATS[m].ramp ? qband(up, NB, x, y, 0.34, 0.66) : bucket(nx, up, x, y));
    layer[i] = ly;
  };

  // ---------- sky ----------
  for (let y = 0; y < HZ; y++) {
    const t = Math.pow(y / HZ, 0.9);
    for (let x = 0; x < WW; x++) scene[y * WW + x] = SKY0 + qband(t, NSKY, x, y, 0.22, 0.78);
  }

  // ---------- mountain ranges ----------
  type Peak = { x: number; h: number; sl: number; sr: number };
  type Range = { r: Float32Array; own: Float32Array; peaks: Peak[] };
  const ownerAt = (peaks: Peak[], x: number) => {
    let best = 1e9, bp = peaks[0];
    for (const p of peaks) {
      const d = x - p.x, y = p.h + (d < 0 ? p.sl : p.sr) * Math.abs(d) * (1 - 0.0011 * Math.min(Math.abs(d), 160) / k);
      if (y < best) { best = y; bp = p; }
    }
    return bp;
  };
  const makeRange = (n: number, yHi: number, yLo: number, jag: number, s: number, avoidMid = 0): Range => {
    const peaks: Peak[] = [];
    for (let i = 0; i < n; i++) {
      let fx = (i + 0.5 + R(-0.32, 0.32)) / n;
      if (avoidMid && Math.abs(fx - 0.5) < avoidMid) fx = 0.5 + Math.sign(fx - 0.5 || 1) * (avoidMid + R(0, 0.05));
      peaks.push({ x: fx * WW, h: lerp(yHi, yLo, Math.pow(rng(), 1.4)), sl: R(0.5, 1.05), sr: R(0.5, 1.05) });
    }
    // a couple of extra shoulders beyond the edges so ranges never end abruptly
    peaks.push({ x: -WW * 0.12, h: lerp(yHi, yLo, 0.6), sl: 0.8, sr: 0.8 }, { x: WW * 1.12, h: lerp(yHi, yLo, 0.6), sl: 0.8, sr: 0.8 });
    const r = new Float32Array(WW), own = new Float32Array(WW);
    for (let x = 0; x < WW; x++) {
      let best = 1e9, bx = 0;
      peaks.forEach((p, pi) => {
        const d = x - p.x, s2 = d < 0 ? p.sl : p.sr;
        const y = p.h + s2 * Math.abs(d) * (1 - 0.0011 * Math.min(Math.abs(d), 160) / k);
        if (y < best) { best = y; bx = pi; }
      });
      best += (fbm1(x / (26 * k), s, 3) - 0.5) * jag * 1.8 + (noise1(x / (5.5 * k), s + 9) - 0.5) * jag * 0.55;
      r[x] = Math.min(best, HZ - 3);
      own[x] = bx;
    }
    return { r, own, peaks };
  };

  const snowy = R(0.35, 1); // season
  const paintRange = (rg: Range, rock: number, snow: number, ly: number, snowLine: number, s: number, forest?: { m: number; line: number }) => {
    for (let x = 0; x < WW; x++) {
      const top = Math.ceil(rg.r[x]);
      for (let y = Math.max(0, top); y < HZ; y++) {
        const dd = y - rg.r[x];
        const xw = x + (noise2(x / (16 * k), y / (20 * k), s) - 0.5) * 12 * k * clamp(dd / (26 * k)) + (noise2(x / (5 * k), y / (6 * k), s + 1) - 0.5) * 3 * k * clamp(dd / (10 * k));
        const pk = dd < 3 ? rg.peaks[rg.own[x]] : ownerAt(rg.peaks, xw);
        const dp = xw - pk.x;
        const side = dp / (Math.abs(dp) + 1.6);
        let nx = side * 0.78;
        // gullies run down and away from the arete, so faces read as chevrons
        const sl = (dp < 0 ? pk.sl : pk.sr) * 0.9;
        const sg = dp < 0 ? -1 : 1;
        const n2 = Math.hypot(1, sl);
        const across = (x - sg * sl * y) / n2, along = (y + sg * sl * x) / n2;
        const g = noise2(across / (4.2 * k) + noise1(along / (9 * k), s) * 0.7, along / (17 * k), s + 3);
        const g2 = noise2(across / (11 * k), along / (30 * k), s + 4);
        nx += ((g - 0.5) * 1.1 + (g2 - 0.5) * 0.9) * clamp(dd / (8 * k));
        let up = 0.2 + 0.62 * Math.exp(-dd / (7 * k));
        const led = noise2(x / (24 * k), y / (3.1 * k), s + 5);
        if (led > 0.64) up += 0.5 * ((led - 0.64) / 0.36) * clamp(dd / 5);
        up -= 0.15 * clamp((dd - 30 * k) / (40 * k));
        if (dd < 1.2) up = 1;
        let m = rock;
        const sv = (snowLine - y) / (9 * k) + (up - 0.42) * 1.7 + (noise2(x / (6 * k), y / (13 * k), s + 7) - 0.5) * 1.6 + (noise2(x / (2.5 * k), y / (5 * k), s + 8) - 0.5) * 0.5 - Math.abs(nx) * 0.25;
        if (sv > 0) m = snow;
        if (forest && m === rock) {
          const fl = forest.line + (fbm1(x / (18 * k), s + 11, 3) - 0.5) * 16 * k;
          if (y > fl) { m = forest.m; up = 0.18 + 0.2 * hash2(x, y, s); nx *= 0.6; }
        }
        put(x, y, m, nx, up, ly);
      }
    }
  };

  const pine = (cx: number, by: number, h: number, m: number, ly: number, s: number, clip?: (x: number, y: number) => boolean) => {
    const hw0 = Math.max(1, h * 0.27);
    const tl = Math.max(3, Math.round(h / 5.5));
    for (let r = 0; r < h; r++) {
      const y = by - h + r;
      const u = (r + 1) / h;
      const kk = r % tl;
      let hw = u * hw0 * (0.62 + 0.38 * (kk + 1) / tl) + (hash2(cx, y, s) - 0.5) * 0.9;
      if (r === 0) hw = 0;
      const a = Math.round(-hw), b = Math.round(hw);
      for (let dx = a; dx <= b; dx++) {
        const x = cx + dx;
        if (clip && !clip(x, y)) continue;
        const nx = dx === 0 ? 0.02 : (dx / (hw + 0.6)) * 1.1;
        let up = kk === 0 || r < 2 ? 0.9 : kk === tl - 1 ? 0.06 : 0.42;
        if (Math.abs(dx) >= b && b > 1) up = Math.min(up, 0.45);
        put(x, y, m, nx, up, ly);
      }
    }
    if (h > 9) for (let r = 0; r < Math.max(1, Math.round(h * 0.07)); r++) put(cx, by + r, M.wood, -0.3, 0.1, ly);
  };

  // far range
  const far = makeRange(5 + Math.floor(R(0, 3)), HZ * R(0.34, 0.44), HZ * R(0.56, 0.66), 7 * k, S + 100);
  let farMin = H; for (let x = 0; x < WW; x++) farMin = Math.min(farMin, far.r[x]);
  paintRange(far, M.farRock, M.farSnow, LAYER.far, lerp(farMin, HZ, 0.25 + 0.35 * snowy), S + 110);

  // mid range, with a gap toward the far valley
  const mid = makeRange(3 + Math.floor(R(0, 2)), HZ * R(0.5, 0.6), HZ * R(0.68, 0.76), 5 * k, S + 200, R(0.1, 0.18));
  let midMin = H; for (let x = 0; x < WW; x++) midMin = Math.min(midMin, mid.r[x]);
  paintRange(mid, M.midRock, M.midSnow, LAYER.mid, lerp(midMin, HZ, 0.12 + 0.22 * snowy), S + 210, { m: M.midForest, line: lerp(midMin, HZ, R(0.45, 0.6)) });
  // pines dotted along the mid slopes
  for (let i = 0; i < WW * 0.9; i++) {
    const x = Math.floor(R(0, WW)), y0 = mid.r[x];
    const y = Math.floor(lerp(y0 + 8 * k, HZ, Math.pow(rng(), 0.6)));
    const i0 = y * WW + x;
    if (y >= HZ || scene[i0] < MATS[M.midForest].base || scene[i0] >= MATS[M.midForest].base + NB) continue;
    pine(x, y, Math.round(R(4, 7) * k), M.midForest, LAYER.mid, S + 3, (px, py) => py < HZ && py > mid.r[Math.max(0, Math.min(WW - 1, px))] + 2);
  }

  // ---------- near hills either side ----------
  const wfLeft = rng() < 0.5;
  const spanL = WW * R(0.28, 0.36), spanR = WW * R(0.28, 0.36);
  const hL = HZ * R(0.34, 0.44) * (wfLeft ? 1.15 : 0.85), hR = HZ * R(0.34, 0.44) * (wfLeft ? 0.85 : 1.15);
  const hill = new Float32Array(WW);
  const hillShape = (u: number) => (u <= 0 ? 0 : Math.pow(smoothstep(0, 1, Math.min(1, u * 1.05)), 0.75));
  for (let x = 0; x < WW; x++) {
    const uL = 1 - x / spanL, uR = (x - (WW - spanR)) / spanR;
    let h = Math.max(hL * hillShape(uL), hR * hillShape(uR));
    if (h > 0) h += (fbm1(x / (16 * k), S + 300, 3) - 0.5) * 9 * k * clamp(h / (10 * k));
    hill[x] = HZ - Math.max(0, h);
  }
  // waterfall notch + cliff
  const wfSpan = wfLeft ? spanL : spanR;
  const wfx = Math.round(wfLeft ? wfSpan * R(0.5, 0.62) : WW - wfSpan * R(0.5, 0.62));
  const wfw = Math.max(3, Math.round(R(4, 6) * k));
  const cw = Math.round((wfw + 10 * k) * R(1, 1.3));
  for (let x = wfx - cw * 2; x <= wfx + cw * 2; x++) {
    if (x < 0 || x >= WW) continue;
    const d = Math.abs(x - wfx) / (wfw * 0.5 + 2);
    if (d < 1) hill[x] += 3 * k * (1 - d * d);
  }
  const wfTop = Math.round(hill[Math.max(0, Math.min(WW - 1, wfx))]) + 1;

  for (let x = 0; x < WW; x++) {
    const top = Math.ceil(hill[x]);
    if (top >= HZ) continue;
    const slope = (hill[Math.min(WW - 1, x + 2)] - hill[Math.max(0, x - 2)]) / 4;
    const cd = Math.abs(x - wfx) - cw * (0.75 + 0.5 * noise1(x * 0.3, S + 5));
    for (let y = top; y < HZ; y++) {
      const dd = y - hill[x];
      const cliffEdge = (wfw * 0.5 + 6 * k) * (0.75 + 0.6 * noise2(x / (4 * k), y / (7 * k), S + 6)) * (0.8 + 0.4 * clamp((y - wfTop) / (30 * k))) - Math.abs(x - wfx);
      const inCliff = cliffEdge > 0 && y > wfTop - 3;
      if (inCliff) {
        const side = -Math.sign(x - wfx) * 0.55;
        let nx = (noise2(x / (2 * k), y / (14 * k), S + 7) - 0.5) * 1.3 + side;
        const ledge = noise2(x / (9 * k), y / (2.4 * k), S + 8);
        let up = ledge > 0.64 ? 0.85 : ledge < 0.3 ? 0.05 : 0.3;
        if (dd < 1.5) up = 0.95;
        if (cliffEdge < 2.2 && hash2(x, y, S + 9) < 0.55) { put(x, y, M.hillForest, side, 0.3, LAYER.hill); continue; }
        if (cliffEdge < 1) { up = 0.05; nx = -side; }
        put(x, y, M.cliff, nx, up, LAYER.hill);
      } else {
        let nx = clamp(-slope * 1.7 + (noise2(x / (5 * k), y / (4 * k), S + 9) - 0.5) * 0.7, -1, 1);
        let up = 0.55 + 0.35 * Math.exp(-dd / (4 * k)) + (noise2(x / (3 * k), y / (2 * k), S + 10) - 0.5) * 0.5 - 0.2 * clamp(dd / (40 * k));
        put(x, y, M.hillGrass, nx, up, LAYER.hill);
      }
      void cd;
    }
  }
  // forests on the hills (and breaking their skyline)
  const trees: [number, number, number][] = [];
  for (let i = 0; i < WW * 2.2; i++) {
    const x = Math.floor(R(0, WW));
    if (hill[x] >= HZ - 2) continue;
    const y = Math.floor(lerp(hill[x] + 1, HZ + 2, Math.pow(rng(), 1.4)));
    const dens = fbm2(x / (34 * k), y / (14 * k), S + 12, 3) + (y - hill[x] < 6 * k ? 0.1 : 0);
    if (dens < 0.47) continue;
    if (Math.abs(x - wfx) < cw * 1.25 && y > wfTop - 6) continue;
    trees.push([x, y, Math.round(R(5, 10) * k * (0.7 + 0.5 * (y - HZ * 0.6) / (HZ * 0.4)))]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  for (const [x, y, h] of trees) pine(x, Math.min(y, HZ), Math.max(4, h), M.hillForest, LAYER.hill, S + 13, (px, py) => py < HZ && !(Math.abs(px - wfx) < wfw + 1 && py > wfTop - 2));

  // ---------- cascade above, waterfall, foam ----------
  let wf: World['wf'] = null;
  if (wfTop < HZ - 12 * k) {
    wf = { x: wfx, top: wfTop, w: wfw };
    // little upper stream winding down the mid range to the notch
    if (mid.r[wfx] < wfTop - 14 * k) {
      let x = wfx + (wfLeft ? 1 : -1) * Math.round(R(4, 10) * k), y = Math.round(mid.r[x] + R(6, 12) * k);
      const path: [number, number][] = [];
      let guard = 0;
      while (y < wfTop && guard++ < 400) {
        path.push([x, y]);
        y += 1;
        const want = wfx + Math.round((noise1(y / (5 * k), S + 14) - 0.5) * 8 * k * clamp((wfTop - y) / (20 * k)));
        if (x < want && rng() < 0.6) x++;
        else if (x > want && rng() < 0.6) x--;
      }
      let dist = 0;
      for (const [px, py] of path) {
        dist++;
        for (let w = 0; w < (py > wfTop - 8 * k ? 2 : 1); w++) {
          const i = py * WW + px + w;
          if (layer[i] === LAYER.mid || layer[i] === LAYER.hill) scene[i] = ST0 + ((NST * 4 - Math.floor(dist * 0.8) + w * 3) % NST + NST) % NST;
        }
      }
    }
    for (let y = wfTop - 1; y < HZ + 2; y++) {
      const fall = Math.max(0, y - wfTop);
      const spread = Math.round(Math.min(2 * k, fall / (18 * k)));
      const a = wfx - Math.floor(wfw / 2) - spread, b = wfx + Math.ceil(wfw / 2) - 1 + spread;
      for (let x = a; x <= b; x++) {
        if (x < 0 || x >= WW || y >= H) continue;
        const col = hash2(x, 3, S + 15);
        const ph = Math.floor(Math.sqrt(fall + 1) * 5.2 / Math.sqrt(k) + col * 16) % NWF;
        const edge = x === a || x === b;
        const i = y * WW + x;
        if (y >= HZ) { scene[i] = FOAM0 + Math.floor(hash2(x, y, S) * NFOAM); layer[i] = LAYER.fg; continue; }
        scene[i] = edge && hash2(x, y, 9) < 0.5 ? FOAM0 + ((ph >> 1) % NFOAM) : WF0 + ((NWF - ph) % NWF + NWF) % NWF;
        layer[i] = LAYER.hill;
      }
    }
    // foam and spray at the plunge pool
    const pr = Math.round(wfw * 1.4 + 6 * k);
    for (let y = HZ - Math.round(7 * k); y < HZ + Math.round(4 * k); y++) {
      for (let x = wfx - pr; x <= wfx + pr; x++) {
        if (x < 0 || x >= WW) continue;
        const dx = (x - wfx) / pr, dy = (y - HZ) / (y < HZ ? 7 * k : 4 * k);
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        if (hash2(x, y, S + 16) > 1.15 - d * 0.9 && d > 0.25) continue;
        const i = y * WW + x;
        scene[i] = FOAM0 + Math.floor(hash2(x, y, S + 17) * NFOAM);
        layer[i] = y >= HZ ? LAYER.fg : LAYER.hill;
      }
    }
  }

  // ---------- cabins on the far side of the lake ----------
  const light = new Uint8Array(N);
  const L_NAME = 0, L_WIN = 1, L_DOT = 2;
  const setLight = (x: number, y: number, kind: number) => {
    if (x < 0 || y < 0 || x >= WW || y >= H) return;
    light[y * WW + x] = 1 + kind * 32 + Math.floor(hash2(x, y, S + 18) * 32);
  };
  const cabinSide = wfLeft ? 1 : 0;
  for (let c = 0; c < 3 + Math.floor(R(0, 3)); c++) {
    const span = cabinSide ? spanR : spanL;
    const x = Math.round(cabinSide ? WW - span * R(0.12, 0.75) : span * R(0.12, 0.75));
    if (x < 3 || x > WW - 4) continue;
    const top = hill[x];
    if (top > HZ - 6 * k) continue;
    const y = Math.round(lerp(top + 4 * k, HZ - 1, R(0.25, 1)));
    const w = Math.max(3, Math.round(4 * k)), h = Math.max(2, Math.round(2.5 * k));
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) put(x + xx, y - yy, M.stone, xx === 0 ? -0.6 : 0.4, 0.4, LAYER.hill);
    for (let r = 0; r <= Math.ceil(w / 2); r++) for (let xx = -1 + r; xx <= w - r; xx++) put(x + xx, y - h - r, M.wood, xx < w / 2 ? -0.7 : 0.6, 0.9, LAYER.hill);
    setLight(x + 1, y - 1, L_WIN);
    if (w > 3) setLight(x + w - 2, y - 1, L_WIN);
  }
  for (let i = 0; i < WW * 0.08; i++) {
    const x = Math.floor(R(0, WW)), y = Math.round(HZ - 1 - Math.pow(rng(), 2.5) * 10 * k);
    if (layer[y * WW + x] >= LAYER.mid) setLight(x, y, L_DOT);
  }

  // ---------- the name, as lights on the mountainside ----------
  const hot: Hotspot[] = [];
  {
    const { pts, w } = textPixels('Ben Firshman');
    let best = -1, bestY = 0, bestScore = 1e9;
    for (let x0 = Math.round(WW * 0.12); x0 < WW * 0.88 - w; x0++) {
      let yTop = 0, ok = true;
      for (let x = x0 - 2; x < x0 + w + 2; x++) {
        yTop = Math.max(yTop, mid.r[x] + 7 * k);
        if (hill[x] < HZ - 1) { ok = false; break; }
      }
      if (!ok || yTop + 5 > HZ - 6 * k) continue;
      const score = Math.abs(x0 + w / 2 - WW * 0.5) * 0.6 + yTop * 0.2;
      if (score < bestScore) { bestScore = score; best = x0; bestY = yTop; }
    }
    if (best < 0) {
      // fall back: across the lake mouth, just above the water
      best = Math.round(WW / 2 - w / 2); bestY = HZ - 8 * k - 5;
    }
    const y0 = Math.round(Math.min(bestY + (HZ - 6 * k - 5 - bestY) * R(0, 0.22), HZ - 7));
    for (const [px, py] of pts) setLight(best + px, y0 + py, L_NAME);
    // a faint halo so the letters read as lamps, not type
    for (const [px, py] of pts) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const x = best + px + dx, y = y0 + py + dy;
      if (!light[y * WW + x]) setLight(x, y, 3);
    }
    hot.push({ id: 'name', kind: 'name', x: best - 3, y: y0 - 3, w: w + 6, h: 11, ref: 0 });
  }

  // ---------- lake ----------
  const fgH = (H - HZ) * (portrait ? 0.4 : 0.36);
  const shoreY = new Int16Array(WW);
  for (let x = 0; x < WW; x++) {
    const e = Math.max(smoothstep(0.16, 0, x / WW), smoothstep(0.84, 1, x / WW));
    let s = H - fgH + (fbm1(x / (70 * k), S + 400, 3) - 0.5) * fgH * 0.6 - e * (H - HZ - fgH) * 0.55;
    shoreY[x] = Math.round(clamp(s, HZ + 6 * k, H - 6 * k));
  }
  for (let x = 0; x < WW; x++) for (let y = HZ; y < shoreY[x]; y++) {
    const i = y * WW + x;
    if (layer[i] === LAYER.fg) continue; // plunge foam
    scene[i] = WATER; layer[i] = LAYER.water;
  }

  // ---------- foreground ----------
  const pathTop = Math.round(WW * R(0.38, 0.62)), pathBot = Math.round(WW * R(0.35, 0.65));
  const pathX = (y: number) => {
    const u = clamp((y - (H - fgH)) / fgH);
    return lerp(pathTop, pathBot, u * u * (3 - 2 * u)) + Math.sin(u * 4.2 + S) * 6 * k;
  };
  for (let x = 0; x < WW; x++) {
    const sy = shoreY[x];
    const slope = (shoreY[Math.min(WW - 1, x + 3)] - shoreY[Math.max(0, x - 3)]) / 6;
    for (let y = sy; y < H; y++) {
      const dy = y - sy, depth = (y - sy) / Math.max(1, H - sy);
      const px = pathX(y), pw = lerp(1.2, 7.5, clamp((y - (H - fgH)) / fgH)) * k;
      const pd = Math.abs(x - px) - pw;
      if (dy === 0 || (dy === 1 && hash2(x, y, S) < 0.55)) { put(x, y, M.stone, (hash2(x, y, 3) - 0.5) * 0.8, 0.95, LAYER.fg); continue; }
      if (dy < 3 * k && hash2(x, y, S + 1) < 0.35 - dy * 0.08) { put(x, y, M.stone, (hash2(x, y, 4) - 0.5) * 1.4, 0.6, LAYER.fg); continue; }
      if (pd < 0 || (pd < 1.2 && bayer(x, y) > 0.5)) {
        put(x, y, M.stone, (hash2(x, y, 5) - 0.5) * 0.6 + (pd > -1 ? Math.sign(x - px) * 0.6 : 0), 0.78 - (pd > -1 ? 0.3 : 0) - (hash2(x, y, 6) < 0.1 ? 0.4 : 0), LAYER.fg);
        continue;
      }
      // grass is a smooth tonal ramp: rolling light, then hand-placed tufts
      const mound = fbm2(x / (46 * k), y / (7 * k), S + 21, 3);
      let up = 0.8 - depth * 0.5 + (mound - 0.5) * 0.55 - slope * 0.15 - (dy < 4 ? 0 : 0);
      const tx = Math.floor(x / 4), ty = Math.floor(y / 3), lx = x - tx * 4, ly = y - ty * 3;
      const tuft = hash2(tx, ty, S + 22) < 0.2 + depth * 0.12;
      if (tuft) {
        const o = Math.floor(hash2(tx, ty, S + 25) * 3);
        if (lx === o && ly >= 1) up -= 0.2;
        else if (lx === o + 1 && ly === 2) up -= 0.13;
        else if (lx === o && ly === 0) up += 0.12;
      }
      put(x, y, M.fgGrass, 0, up, LAYER.fg);
      if (hash2(x, y, S + 23) < 0.006 + 0.01 * depth && pd > 2) {
        const i = y * WW + x; scene[i] = FLOWER0 + Math.floor(hash2(x, y, S + 24) * NFLOWER);
      }
    }
  }
  // boulders on the shore
  for (let b = 0; b < 4 + Math.floor(R(0, 4)); b++) {
    const bx = Math.floor(R(0, WW)), r = R(1.8, 4.5) * k;
    const by = shoreY[bx] + Math.round(R(0, 3) * k);
    if (Math.abs(bx - pathX(by)) < 10 * k) continue;
    for (let y = Math.floor(by - r); y <= by + 1; y++) for (let x = Math.floor(bx - r * 1.3); x <= bx + r * 1.3; x++) {
      const dx = (x - bx) / (r * 1.3), dy = (y - by) / r;
      if (dx * dx + dy * dy > 1) continue;
      put(x, y, M.stone, dx * 0.95, clamp(-dy * 0.9 + 0.1), LAYER.fg);
    }
    for (let x = Math.floor(bx - r * 1.2); x <= bx + r * 1.5; x++) put(x, by + 2, M.fgGrass, 0.4, 0.02, LAYER.fg);
  }

  // signposts: three posts, three arms each
  const postXs = [0.3, 0.5, 0.7].map((f) => f + R(-0.04, 0.04));
  const ph = Math.max(13, Math.round(17 * k));
  postXs.forEach((f, pi) => {
    let x = Math.round(WW * f);
    let gy = 0;
    const want = portrait ? shoreY[x] + (H - shoreY[x]) * R(0.3, 0.42) + ph * 0.5 : H - fgH * R(0.35, 0.6);
    gy = Math.round(Math.max(shoreY[x] + 5 * k, want));
    if (Math.abs(x - pathX(gy)) < 6 * k) x += Math.round((x < pathX(gy) ? -1 : 1) * 9 * k);
    const top = gy - ph;
    for (let y = top; y <= gy; y++) {
      put(x, y, M.wood, -0.7, y === top ? 0.95 : 0.35, LAYER.fg);
      put(x + 1, y, M.wood, 0.55, y === top ? 0.95 : 0.4, LAYER.fg);
    }
    for (let dx = -1; dx <= 3; dx++) put(x + dx, gy + 1, M.fgGrass, 0.5, 0.0, LAYER.fg);
    setLight(x, top - 1, L_WIN); // a lamp on each post
    const arms = 3, armGap = Math.max(4, Math.round(4.2 * k));
    let minX = x, maxX = x + 1;
    for (let a = 0; a < arms; a++) {
      const dir = (a + pi) % 2 === 0 ? 1 : -1;
      const len = Math.round(R(7, 10) * k);
      const ay = top + 2 + a * armGap;
      for (let j = 0; j < len; j++) {
        const xx = dir > 0 ? x + 2 + j : x - 1 - j;
        const tip = j === len - 1;
        for (let r = 0; r < 3; r++) {
          if (tip && r !== 1) continue;
          if (j === len - 2 && r !== 1 && hash2(a, pi, 3) < 0.0) continue;
          const text = r === 1 && j > 0 && j < len - 2 && hash2(xx, ay, S + a) < 0.55;
          if (text) put(xx, ay + r, M.fgPine, 0, 0.2, LAYER.fg);
          else put(xx, ay + r, M.wood, dir * 0.2, r === 0 ? 0.95 : r === 1 ? 0.55 : 0.12, LAYER.fg);
        }
        minX = Math.min(minX, xx); maxX = Math.max(maxX, xx);
      }
    }
    hot.push({ id: 'post' + pi, kind: 'post', x: minX - 3, y: top - 3, w: maxX - minX + 7, h: gy - top + 6, ref: pi });
  });

  // big framing pines
  const edgePines: [number, number, number][] = [];
  for (const side of [0, 1]) {
    const n = 2 + Math.floor(R(0, 3));
    for (let i = 0; i < n; i++) {
      const x = side ? WW - Math.round(R(2, WW * 0.1)) : Math.round(R(2, WW * 0.1));
      const by = H - Math.round(R(0, fgH * 0.5));
      edgePines.push([x, by, Math.round(R(0.3, 0.55) * H)]);
    }
  }
  edgePines.sort((a, b) => a[1] - b[1]);
  for (const [x, by, h] of edgePines) pine(x, by, h, M.fgPine, LAYER.fg, S + 30);

  // ---------- stars ----------
  const star = new Uint8Array(N);
  const setStar = (x: number, y: number, cls: number, ph2?: number) => {
    if (x < 0 || y < 0 || x >= WW || y >= HZ) return;
    star[y * WW + x] = 1 + cls * STAR_CLS + (ph2 ?? Math.floor(hash2(x, y, S + 40) * STAR_CLS));
  };
  const mwA = R(-0.3, 0.3) * WW, mwB = R(0.7, 1.3) * WW;
  for (let y = 0; y < HZ; y++) for (let x = 0; x < WW; x++) {
    const t = y / HZ;
    const lx = lerp(mwA, mwB, 1 - t);
    const d = Math.abs(x - lx) / (WW * 0.09);
    const band = Math.exp(-d * d) * (0.5 + 0.8 * noise2(x / 22, y / 22, S + 41));
    const rift = noise2(x / 9, y / 9, S + 42) > 0.6 && d < 0.5;
    const h = hash2(x, y, S + 43);
    const fade = 1 - smoothstep(0.65, 1, t);
    if (h < 0.0028 * fade) setStar(x, y, hash2(x, y, 44) < 0.12 ? 2 : 1);
    else if (h < (0.0028 + 0.03 * band) * fade && !rift) setStar(x, y, 0);
    else if (h < (0.0028 + 0.03 * band + 0.22 * band * band) * fade && !rift && ((x + y) & 1) === 0) setStar(x, y, 5);
  }
  // halos on bright stars
  for (let y = 1; y < HZ - 1; y++) for (let x = 1; x < WW - 1; x++) {
    const v = star[y * WW + x];
    if (v && Math.floor((v - 1) / STAR_CLS) === 2 && hash2(x, y, 45) < 0.5) {
      const p = (v - 1) % STAR_CLS;
      setStar(x - 1, y, 4, p); setStar(x + 1, y, 4, p); setStar(x, y - 1, 4, p); setStar(x, y + 1, 4, p);
    }
  }
  // constellations: email, X, GitHub, LinkedIn
  // prettier-ignore
  const SHAPES: { pts: [number, number][]; lines: [number, number][]; ar: number }[] = [
    { pts: [[0, 0], [1, 0.05], [0.96, 0.66], [0.04, 0.62], [0.5, 0.36]], lines: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 1]], ar: 1.3 },
    { pts: [[0, 0], [0.48, 0.5], [1, 1], [0.95, 0.02], [0.05, 0.95]], lines: [[0, 1], [1, 2], [3, 1], [1, 4]], ar: 1 },
    { pts: [[0, 0.32], [0.14, 0], [0.34, 0.22], [0.66, 0.22], [0.86, 0], [1, 0.32], [0.86, 0.78], [0.5, 0.95], [0.14, 0.78]], lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 0]], ar: 1.15 },
    { pts: [[0, 0.5], [0.26, 0.12], [0.52, 0.5], [0.26, 0.88], [0.44, 0.5], [0.7, 0.12], [1, 0.5], [0.7, 0.88]], lines: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4]], ar: 1.5 },
  ];
  const sz = clamp(H * 0.085, 15, 34);
  const order = [0, 1, 2, 3].sort(() => rng() - 0.5);
  const slots = 4;
  order.forEach((ci, si) => {
    const sh = SHAPES[ci];
    const w = sz * sh.ar, h = sz;
    let x0 = Math.round(lerp(WW * 0.05, WW * 0.95 - w, (si + R(0.15, 0.85)) / slots) - w * 0.0);
    x0 = Math.round(clamp(x0, 3, WW - w - 3));
    const yMax = Math.min(HZ * 0.52, far.r[Math.round(x0 + w / 2)] - h - 8);
    const y0 = Math.round(clamp(R(HZ * 0.05, Math.max(HZ * 0.06, yMax)), 3, HZ));
    const pts: [number, number][] = sh.pts.map(([px, py]) => [Math.round(x0 + px * w + (hash2(ci, px * 9, S) - 0.5) * 1.6), Math.round(y0 + py * h + (hash2(ci, py * 9, S + 1) - 0.5) * 1.6)]);
    for (const [px, py] of pts) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (px + dx >= 0 && py + dy >= 0 && px + dx < WW && py + dy < HZ) star[(py + dy) * WW + px + dx] = 0;
      const p = Math.floor(hash2(px, py, S + 46) * STAR_CLS);
      setStar(px, py, 3, p);
      setStar(px - 1, py, 4, p); setStar(px + 1, py, 4, p); setStar(px, py - 1, 4, p); setStar(px, py + 1, 4, p);
    }
    hot.push({ id: 'star' + ci, kind: 'star', x: x0 - 5, y: y0 - 5, w: Math.round(w) + 10, h: Math.round(h) + 10, ref: ci, pts, lines: sh.lines });
  });

  // ---------- clouds (travelling threshold waves) ----------
  const cloud = new Uint16Array(N);
  const nb = 4;
  const bands: CloudBand[] = [];
  const cloudF = new Float32Array(nb * CL_N);
  const defs = [
    { yc: R(0.08, 0.16), th: R(2, 3.5), cover: R(0.25, 0.55), slant: R(-1.4, 1.4), speed: R(1.2, 2) },
    { yc: R(0.24, 0.36), th: R(6, 9), cover: R(0.2, 0.6), slant: R(-0.6, 0.6), speed: R(2, 3.2) },
    { yc: R(0.44, 0.56), th: R(7, 11), cover: R(0.25, 0.62), slant: R(-0.5, 0.5), speed: R(2.6, 4) },
    { yc: R(0.66, 0.78), th: R(3, 6), cover: R(0.2, 0.55), slant: R(-0.4, 0.4), speed: R(3, 5) },
  ];
  const sky = rng(); // overall cloudiness
  defs.forEach((d, b) => {
    const cover = d.cover * (0.5 + sky);
    bands.push({ speed: d.speed * (rng() < 0.5 ? -1 : 1) });
    const ph = [0, 0, 0, 0, 0, 0].map(() => R(0, Math.PI * 2));
    let mn = 1e9, mx = -1e9;
    const raw = new Float32Array(CL_N);
    for (let p = 0; p < CL_N; p++) {
      let v = 0;
      for (let kk = 1; kk <= 6; kk++) v += Math.sin((Math.PI * 2 * kk * p) / CL_N + ph[kk - 1]) / Math.pow(kk, 0.75);
      raw[p] = v; mn = Math.min(mn, v); mx = Math.max(mx, v);
    }
    for (let p = 0; p < CL_N; p++) cloudF[b * CL_N + p] = clamp(((raw[p] - mn) / (mx - mn)) * 1.25 - (1 - cover) * 0.95);
    const yc = HZ * d.yc, th = d.th * k;
    for (let y = Math.max(0, Math.floor(yc - th * 1.7)); y < Math.min(HZ, yc + th * 1.1); y++) {
      const v = (y - yc) / th;
      const prof = v < 0 ? 1 - (v / 1.7) ** 2 : 1 - (v / 0.95) ** 2;
      if (prof <= 0) continue;
      const rowOff = Math.round(d.slant * (y - yc) + (noise1(y * 0.8, S + 50 + b) - 0.5) * 7);
      for (let x = 0; x < WW; x++) {
        const big = fbm2(x / (30 * k), y / (8 * k), S + 51 + b, 3);
        const small = noise2(x / (5 * k), y / (2.6 * k), S + 61 + b);
        const thr = 1 - prof * 0.9 + (big - 0.5) * 0.95 + (small - 0.5) * (v < 0 ? 0.32 : 0.12);
        const vs = v + (big - 0.5) * 0.9 + (small - 0.5) * 0.25;
        const shade = vs < -0.38 ? 0 : vs > 0.32 ? 2 : 1;
        const L = Math.max(0, Math.min(CL_L - 1, Math.floor(thr * CL_L + bayer(x, y) - 0.5)));
        const p = (((x + rowOff) % CL_N) + CL_N) % CL_N;
        cloud[y * WW + x] = 1 + ((b * 3 + shade) * CL_L + L) * CL_N + p;
      }
    }
  });

  // ---------- weather streak fields ----------
  const rain = new Uint8Array(N), snow = new Uint8Array(N);
  for (let lyr = 0; lyr < 2; lyr++) {
    const slant = lyr ? 0.26 : 0.18, dens = lyr ? 0.09 : 0.16;
    for (let x0 = -Math.ceil(H * slant); x0 < WW; x0++) {
      if (hash2(x0, lyr, S + 60) > dens) continue;
      const off = Math.floor(hash2(x0, lyr, S + 61) * 48);
      for (let y = 0; y < H; y++) {
        const x = x0 + Math.floor(y * slant);
        if (x < 0 || x >= WW) continue;
        const i = y * WW + x;
        if (!rain[i]) rain[i] = 1 + lyr * 64 + ((y + off) % 48);
      }
    }
    const sd = lyr ? 0.07 : 0.13;
    for (let x0 = 0; x0 < WW; x0++) {
      if (hash2(x0, lyr, S + 62) > sd) continue;
      const off = Math.floor(hash2(x0, lyr, S + 63) * 40), fq = 7 + lyr * 4 + hash2(x0, 1, S) * 4, ph2 = hash2(x0, 2, S) * 6.28;
      for (let y = 0; y < H; y++) {
        const x = x0 + Math.round(Math.sin(y / fq + ph2) * (1.2 + lyr));
        for (let w = 0; w <= lyr; w++) {
          const xx = x + w;
          if (xx < 0 || xx >= WW) continue;
          const i = y * WW + xx;
          if (!snow[i]) snow[i] = 1 + lyr * 64 + ((y + off) % 40);
        }
      }
    }
  }

  // ---------- water details ----------
  const lakeH = H - HZ;
  const gl: number[] = [];
  for (let i = 0; i < WW * lakeH * 0.07; i++) {
    const x = Math.floor(R(0, WW)), y = HZ + Math.floor(Math.pow(rng(), 1.3) * lakeH);
    if (y >= shoreY[x] - 1) continue;
    const u = (y - HZ) / lakeH;
    gl.push(x, y, 1 + Math.floor(rng() * (1 + 4 * u * k)), Math.floor(rng() * 32));
  }
  const sp: number[] = [];
  for (let i = 0; i < WW * lakeH * 0.012; i++) {
    const x = Math.floor(R(0, WW)), y = HZ + 1 + Math.floor(rng() * lakeH);
    if (y >= shoreY[x] - 1) continue;
    sp.push(x, y, Math.floor(rng() * 40));
  }
  const wob = new Uint8Array(H);
  for (let y = 0; y < H; y++) wob[y] = Math.floor(hash2(y, 5, S + 70) * 16);

  return {
    seed, WW, H, HZ, scene, layer, cloud, bands, cloudF, star, light, rain, snow,
    glints: new Float32Array(gl), splashes: new Float32Array(sp), wob, shoreY, hot,
    moonPhase: R(0.15, 0.85), sky: { top: HZ }, wf,
  };
}
