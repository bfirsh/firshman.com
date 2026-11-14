import * as THREE from 'three';
import { mulberry32, makeNoise } from './noise';

// Each palette is a stone and the light it stands in. CSS for the page (sky, ink)
// lives in erode.astro under [data-pal="n"] and must agree with sky/hor here.
type Band = { c: string; w: number; hard: [number, number]; thick: [number, number]; flint?: boolean };
type Palette = {
  top: string; hor: string; ground: string;
  sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number;
  bands: Band[]; jitter: number; sandLift: number; sandMix: number; shadow: number; shadowCol: string; flo: string; exposure: number;
};

export const PALETTES: Palette[] = [
  // 0 Navajo sandstone: rust, salmon and cream cross-bedding, under a pale apricot sky.
  {
    top: '#f7f1e9', hor: '#efdfcd', ground: '#ead4bc',
    sun: '#ffdcc0', sunI: 3.1, hemiSky: '#f6e6d6', hemiGround: '#c98863', hemiI: 2.3,
    bands: [
      { c: '#b87a62', w: 3, hard: [0.15, 0.4], thick: [2, 5] },
      { c: '#cc9a80', w: 3, hard: [0.1, 0.35], thick: [2, 6] },
      { c: '#e2c2aa', w: 2, hard: [0.05, 0.3], thick: [1, 4] },
      { c: '#a0644f', w: 2, hard: [0.5, 0.8], thick: [1, 3] },
      { c: '#eddccb', w: 1.5, hard: [0.05, 0.25], thick: [1, 3] },
    ],
    jitter: 0.03, sandLift: 0.04, sandMix: 0.6, shadow: 0.42, shadowCol: '#6e3a2a', flo: '#ead6c0', exposure: 1.0,
  },
  // 1 Honey limestone and ochre, warm bone sky.
  {
    top: '#f6f2ea', hor: '#ede2cf', ground: '#e8d8bb',
    sun: '#ffe2b8', sunI: 3.0, hemiSky: '#f4ead9', hemiGround: '#c49a5e', hemiI: 2.3,
    bands: [
      { c: '#d6aa6c', w: 3, hard: [0.1, 0.4], thick: [2, 6] },
      { c: '#c49155', w: 2, hard: [0.3, 0.6], thick: [1, 4] },
      { c: '#e6c58c', w: 3, hard: [0.05, 0.3], thick: [2, 5] },
      { c: '#ab7a4a', w: 1.2, hard: [0.6, 0.85], thick: [1, 2] },
      { c: '#efdcb0', w: 1.5, hard: [0.05, 0.25], thick: [1, 3] },
    ],
    jitter: 0.03, sandLift: 0.04, sandMix: 0.6, shadow: 0.42, shadowCol: '#5e4424', flo: '#e7d9c1', exposure: 1.0,
  },
  // 2 Rose sandstone, like Petra: rose, plum and ivory under a dusty blush sky.
  {
    top: '#f5f0f0', hor: '#eddfdc', ground: '#e9d5cf',
    sun: '#ffdcc4', sunI: 3.0, hemiSky: '#f2e4e6', hemiGround: '#b97b78', hemiI: 2.3,
    bands: [
      { c: '#c98078', w: 3, hard: [0.1, 0.4], thick: [2, 5] },
      { c: '#dca394', w: 3, hard: [0.05, 0.35], thick: [2, 5] },
      { c: '#b26667', w: 2, hard: [0.35, 0.7], thick: [1, 3] },
      { c: '#efd9c9', w: 2, hard: [0.05, 0.25], thick: [1, 4] },
      { c: '#93566a', w: 1, hard: [0.6, 0.85], thick: [1, 2] },
    ],
    jitter: 0.03, sandLift: 0.04, sandMix: 0.6, shadow: 0.42, shadowCol: '#5d2f3a', flo: '#e8d6d2', exposure: 1.0,
  },
  // 3 Chalk with flint seams, against charcoal. Like a sea cliff at dusk.
  {
    top: '#34353a', hor: '#202124', ground: '#2a2b2f',
    sun: '#fff0dc', sunI: 3.6, hemiSky: '#aeb4c4', hemiGround: '#3a3a3f', hemiI: 2.6,
    bands: [
      { c: '#f1efe8', w: 4, hard: [0.05, 0.3], thick: [3, 7] },
      { c: '#e6e2d8', w: 3, hard: [0.05, 0.3], thick: [2, 6] },
      { c: '#d9d4c7', w: 1.5, hard: [0.2, 0.4], thick: [1, 3] },
      { c: '#4c4e54', w: 0, hard: [0.9, 0.97], thick: [1, 1], flint: true },
    ],
    jitter: 0.02, sandLift: 0.02, sandMix: 0.45, shadow: 0.6, shadowCol: '#0b0b0d', flo: '#1a1b1d', exposure: 1.05,
  },
];

const GX = 150, GZ = 150, GY = 92;
const K = 1.4; // grains per unit of the original design
const LAYER = GX * GZ;
const CX = 75, CZ = 75;

const S_ROCK = 0, S_FALL = 1, S_SAND = 2, S_RISE = 3;
const O_EMPTY = 0, O_ROCK = 1, O_SAND = 2, O_RES = 3;

export type ErodeOpts = { seed: number; pal: number; flip: boolean; reduced: boolean };

export function startErode(canvas: HTMLCanvasElement, opts: ErodeOpts) {
  const rand = mulberry32(opts.seed * 7919 + 17);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const RI = (a: number, b: number) => Math.floor(R(a, b + 1));
  const noise = makeNoise(rand);
  const pal = PALETTES[opts.pal] ?? PALETTES[0];
  const flip = opts.flip ? -1 : 1;

  // ---------- the form ----------
  type Box = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
  const boxes: Box[] = [];
  const box = (w: number, d: number, y0: number, h: number, ox = 0, oz = 0) => {
    w = Math.round(w * K); d = Math.round(d * K); y0 = Math.round(y0 * K); h = Math.round(h * K); ox = Math.round(ox * K); oz = Math.round(oz * K);
    const x0 = CX - Math.floor(w / 2) + ox, z0 = CZ - Math.floor(d / 2) + oz;
    boxes.push({ x0, x1: x0 + w, z0, z1: z0 + d, y0, y1: y0 + h });
  };
  const formRoll = rand();
  let capFrom = 999; // y above which rock is a harder caprock
  if (formRoll < 0.4) {
    // a slab, sometimes on a low plinth
    const W = RI(12, 16), D = RI(5, 7), H = RI(42, 52);
    let y = 0;
    if (rand() < 0.55) { const ph = RI(2, 3); box(W + RI(3, 5), D + RI(3, 4), 0, ph); y = ph; }
    box(W, D, y, H);
    if (rand() < 0.4) capFrom = Math.round((y + H - RI(3, 5)) * K);
  } else if (formRoll < 0.75) {
    // a stepped form, offset a little so it is not a wedding cake
    const W0 = RI(16, 20), D0 = RI(9, 12), h0 = RI(6, 10);
    const W1 = W0 - RI(4, 6), D1 = D0 - RI(2, 4), h1 = RI(16, 22);
    const W2 = W1 - RI(3, 5), D2 = Math.max(3, D1 - RI(1, 3)), h2 = RI(11, 17);
    const sx = RI(-1, 1), sz = RI(-1, 1);
    box(W0, D0, 0, h0);
    box(W1, D1, h0, h1, sx, sz);
    box(W2, D2, h0 + h1, h2, sx * 2, sz * 2);
  } else {
    // a pillar with a broader cap, a hoodoo in waiting
    const S = RI(7, 9), H = RI(44, 52), C = RI(3, 5);
    box(S + RI(0, 2), S, 0, H - C);
    box(S + 2 + RI(0, 1), S + 2, H - C, C);
    capFrom = Math.round((H - C) * K);
  }
  let HT = 0;
  for (const b of boxes) HT = Math.max(HT, b.y1);

  // ---------- strata ----------
  type Layer = { y: number; c: THREE.Color; hard: number; flint: boolean };
  const layers: Layer[] = [];
  const pickBand = () => {
    const tot = pal.bands.reduce((s, b) => s + b.w, 0);
    let r = rand() * tot;
    for (const b of pal.bands) { if ((r -= b.w) <= 0) return b; }
    return pal.bands[0];
  };
  {
    let y = -6, prev: Band | null = null;
    const flintBand = pal.bands.find((x) => x.flint);
    while (y < HT + 10) {
      let b = pickBand();
      if (b === prev) b = pickBand();
      prev = b;
      const t = b.flint ? 1 : Math.round(RI(b.thick[0], b.thick[1]) * K);
      layers.push({ y, c: new THREE.Color(b.c), hard: R(b.hard[0], b.hard[1]), flint: !!b.flint });
      y += t;
      if (flintBand && !b.flint && rand() < 0.5) {
        layers.push({ y, c: new THREE.Color(flintBand.c), hard: R(flintBand.hard[0], flintBand.hard[1]), flint: true });
        y += 1;
      }
    }
  }
  const chalkBase = pal.bands.find((b) => !b.flint)!;
  const crossAmp = R(0.8, 2.4), crossF = R(0.09, 0.19), crossPh = R(0, 6.28);
  const layerAt = (yy: number) => {
    let lo = 0;
    for (let i = 0; i < layers.length; i++) if (layers[i].y <= yy) lo = i;
    return layers[lo];
  };

  // ---------- grains ----------
  const cells: number[] = [];
  for (const b of boxes)
    for (let j = b.y0; j < b.y1; j++)
      for (let k = b.z0; k < b.z1; k++)
        for (let i = b.x0; i < b.x1; i++) cells.push(i, j, k);
  const N = cells.length / 3;

  const home = new Int32Array(N);
  const hard = new Float32Array(N);
  const taf = new Float32Array(N);
  const baseCol = new Float32Array(N * 3);
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const state = new Uint8Array(N);
  const cellOf = new Int32Array(N);
  const rollX = new Float32Array(N), rollZ = new Float32Array(N);
  const rolling = new Uint8Array(N);
  const riseT0 = new Float32Array(N), riseDur = new Float32Array(N);
  const riseFrom = new Float32Array(N * 3), riseCtl = new Float32Array(N * 3);
  const ao = new Float32Array(N).fill(1);

  const occ = new Uint8Array(GX * GY * GZ);
  const owner = new Int32Array(GX * GY * GZ).fill(-1);
  const idx = (i: number, j: number, k: number) => i + k * GX + j * LAYER;
  const inB = (i: number, j: number, k: number) => i >= 0 && i < GX && k >= 0 && k < GZ && j >= 0 && j < GY;
  const solid = (i: number, j: number, k: number) => (inB(i, j, k) ? occ[idx(i, j, k)] !== O_EMPTY : j < 0);

  const tmpC = new THREE.Color();
  const flintNoise = makeNoise(rand);
  for (let g = 0; g < N; g++) {
    const i = cells[g * 3], j = cells[g * 3 + 1], k = cells[g * 3 + 2];
    const c = idx(i, j, k);
    home[g] = c; cellOf[g] = c; occ[c] = O_ROCK; owner[c] = g; state[g] = S_ROCK;
    px[g] = i; py[g] = j; pz[g] = k;
    const warp = crossAmp * Math.sin(i * crossF + k * crossF * 0.6 + crossPh) + 1.6 * noise(i * 0.05, j * 0.036 + 3.1, k * 0.05);
    const L = layerAt(j + warp);
    let col = L.c, h = L.hard;
    if (L.flint) {
      // flint comes as nodules strung along a seam, not a continuous band
      if (flintNoise(i * 0.32, j * 0.2, k * 0.32) < 0.05) { col = new THREE.Color(chalkBase.c); h = 0.15; }
    }
    if (j >= capFrom) h = Math.max(h, 0.78);
    hard[g] = h;
    const jit = 1 + (rand() - 0.5) * 2 * pal.jitter + 0.05 * noise(i * 0.08, j * 0.08, k * 0.08);
    tmpC.copy(col).multiplyScalar(jit);
    baseCol[g * 3] = tmpC.r; baseCol[g * 3 + 1] = tmpC.g; baseCol[g * 3 + 2] = tmpC.b;
  }

  // Weathering: every exposed grain accumulates wear (faster on edges and windward faces)
  // and lets go once it passes its resistance. Resistance is a smooth field (hard beds,
  // honeycomb tafoni), so hollows grow into pockets rather than scattering pits.
  let tafOff = 0;
  const tafScale = R(0.07, 0.13);
  const resist = new Float32Array(N);
  const wear = new Float32Array(N);
  const computeTaf = () => {
    for (let g = 0; g < N; g++) {
      const c = home[g];
      const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / LAYER);
      const n = noise(i * tafScale + tafOff, j * tafScale * 1.4, k * tafScale - tafOff) + 0.35 * noise(i * tafScale * 2.7, j * tafScale * 2.7 + tafOff, k * tafScale * 2.7);
      taf[g] = Math.max(0, Math.min(1, (n + 0.25) / 0.85));
      resist[g] = (0.3 + 1.7 * hard[g]) * (0.3 + 1.4 * (1 - taf[g]) ** 2) * (1.1 - 0.3 * (j / HT)) * (0.92 + 0.16 * rand());
      wear[g] = 0;
    }
  };
  computeTaf();

  // attached list
  const attached = new Int32Array(N);
  const attPos = new Int32Array(N).fill(-1);
  let nAtt = 0;
  const attAdd = (g: number) => { attPos[g] = nAtt; attached[nAtt++] = g; };
  const attDel = (g: number) => {
    const p = attPos[g]; if (p < 0) return;
    const last = attached[--nAtt]; attached[p] = last; attPos[last] = p; attPos[g] = -1;
  };
  for (let g = 0; g < N; g++) attAdd(g);

  // ---------- camera & light geometry ----------
  const camAz = (rand() < 0.5 ? -1 : 1) * R(0.32, 0.85);
  const camEl = R(0.11, 0.2);
  const Rv = new THREE.Vector3(Math.cos(camAz), 0, -Math.sin(camAz)); // screen right
  const Fv = new THREE.Vector3(-Math.sin(camAz), 0, -Math.cos(camAz)); // into the screen
  const sunEl = R(0.15, 0.3);
  const sunH = Rv.clone().multiplyScalar(-flip * R(0.75, 1)).addScaledVector(Fv, R(-0.6, 0.25)).normalize();
  const sunDir = new THREE.Vector3(sunH.x * Math.cos(sunEl), Math.sin(sunEl), sunH.z * Math.cos(sunEl));
  const windBase = Rv.clone().multiplyScalar(flip).addScaledVector(Fv, R(-0.5, 0.5)).normalize();
  const wind = windBase.clone();
  const windSpeed = R(3.5, 6);
  const G = 30;
  const rate0 = R(45, 75);

  // ---------- sim ----------
  let phase: 'erode' | 'pause' | 'rise' | 'still' = 'erode';
  let phaseT = 0, simT = 0;
  const order: number[] = [];
  const pendingRelease: { g: number; t: number }[] = [];
  const goneFrac = R(0.06, 0.11);
  let riseCarry = 0, connT = 0, aoT = 0, stallT = 0;
  let matDirty = true, colDirty = true;
  let nFall = 0, nRise = 0;

  const releaseSand = (h: number, kx = 0, kz = 0) => {
    state[h] = S_FALL; rolling[h] = 0;
    vx[h] = kx; vz[h] = kz; vy[h] = kx || kz ? 3 : 0;
    nFall++;
    vacate(cellOf[h]);
    cellOf[h] = -1;
  };
  function vacate(c: number) {
    occ[c] = O_EMPTY; owner[c] = -1;
    const a = c + LAYER;
    if (a < occ.length && occ[a] === O_SAND) releaseSand(owner[a]);
  }

  const exposure = (c: number) => {
    const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / LAYER);
    let s = 0;
    if (!solid(i, j + 1, k)) s += 1.1;
    if (j > 0 && !solid(i, j - 1, k)) s += 0.4;
    if (!solid(i + 1, j, k)) s += 0.7 + 0.7 * Math.max(0, -wind.x);
    if (!solid(i - 1, j, k)) s += 0.7 + 0.7 * Math.max(0, wind.x);
    if (!solid(i, j, k + 1)) s += 0.7 + 0.7 * Math.max(0, -wind.z);
    if (!solid(i, j, k - 1)) s += 0.7 + 0.7 * Math.max(0, wind.z);
    return s;
  };

  const detach = (g: number) => {
    const c = cellOf[g];
    const i = c % GX, k = Math.floor(c / GX) % GZ;
    attDel(g);
    state[g] = S_FALL; rolling[g] = 0; nFall++;
    vacate(c); cellOf[g] = -1;
    // nudge it out of whichever face is open
    let ox = 0, oz = 0;
    const j = Math.floor(c / LAYER);
    if (!solid(i + 1, j, k)) ox += 1; if (!solid(i - 1, j, k)) ox -= 1;
    if (!solid(i, j, k + 1)) oz += 1; if (!solid(i, j, k - 1)) oz -= 1;
    const gust = R(0.3, 1);
    vx[g] = ox * R(0.4, 1.2) + wind.x * windSpeed * gust;
    vz[g] = oz * R(0.4, 1.2) + wind.z * windSpeed * gust;
    vy[g] = R(0, 1.5);
    order.push(g);
  };

  // surface list: rock grains that may be exposed
  const surf = new Int32Array(N);
  const surfPos = new Int32Array(N).fill(-1);
  let nSurf = 0;
  const surfAdd = (g: number) => { if (surfPos[g] < 0) { surfPos[g] = nSurf; surf[nSurf++] = g; } };
  const surfDel = (g: number) => {
    const p = surfPos[g]; if (p < 0) return;
    const last = surf[--nSurf]; surf[p] = last; surfPos[last] = p; surfPos[g] = -1;
  };
  const touchNeighbours = (c: number) => {
    for (const d of [c + 1, c - 1, c + GX, c - GX, c + LAYER, c - LAYER]) {
      if (d >= 0 && d < occ.length && occ[d] === O_ROCK) surfAdd(owner[d]);
    }
  };
  const rebuildSurf = () => {
    while (nSurf) surfDel(surf[nSurf - 1]);
    for (let n = 0; n < nAtt; n++) { const g = attached[n]; if (exposure(cellOf[g]) > 0) surfAdd(g); }
  };
  rebuildSurf();

  let wearK = 0.05, wearCount = 0, wearT = 0;
  const weather = (dt: number, target: number) => {
    const cap = Math.max(2, Math.ceil(target * dt * 3));
    let done = 0;
    const len = nSurf;
    const off = Math.floor(rand() * Math.max(1, len));
    for (let n = 0; n < len && n < nSurf; n++) {
      const g = surf[(n + off) % nSurf];
      const e = exposure(cellOf[g]);
      if (e <= 0) continue;
      wear[g] += wearK * e * e * dt;
      if (wear[g] > resist[g] && done < cap) { const c = cellOf[g]; surfDel(g); detach(g); touchNeighbours(c); done++; }
    }
    // steer the overall pace towards the target rate
    wearCount += done; wearT += dt;
    if (wearT > 0.5) {
      const want = target * wearT;
      wearK *= Math.max(0.75, Math.min(1.35, (want + 1) / (wearCount + 1)));
      wearK = Math.min(5, Math.max(0.002, wearK));
      wearCount = 0; wearT = 0;
    }
  };

  // Rock not connected to the ground through rock falls.
  const stamp = new Uint32Array(GX * GY * GZ);
  let stampId = 1;
  const queue = new Int32Array(N);
  const checkConnected = () => {
    stampId++;
    let qh = 0, qt = 0;
    for (let n = 0; n < nAtt; n++) {
      const c = cellOf[attached[n]];
      if (c < LAYER) { stamp[c] = stampId; queue[qt++] = c; }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const nb = [c + 1, c - 1, c + GX, c - GX, c + LAYER, c - LAYER];
      for (const d of nb) {
        if (d < 0 || d >= occ.length || stamp[d] === stampId || occ[d] !== O_ROCK) continue;
        stamp[d] = stampId; queue[qt++] = d;
      }
    }
    const loose: number[] = [];
    for (let n = 0; n < nAtt; n++) { const g = attached[n]; if (stamp[cellOf[g]] !== stampId) loose.push(g); }
    for (const g of loose) { attDel(g); surfDel(g); pendingRelease.push({ g, t: simT + rand() * 0.35 }); }
  };

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const cand: number[] = [];
  const land = (g: number, i: number, j: number, k: number) => {
    while (j < GY - 1 && solid(i, j, k)) j++;
    cand.length = 0;
    let wsum = 0;
    if (j > 0) {
      for (const [dx, dz] of DIRS) {
        const a = i + dx, b = k + dz;
        if (!inB(a, j, b) || solid(a, j, b) || solid(a, j - 1, b)) continue;
        const w = 1 + 2 * Math.max(0, (dx * wind.x + dz * wind.z) / Math.hypot(dx, dz));
        cand.push(a, b, w); wsum += w;
      }
      // sand creeps further than one cell: a gentler, less regular slope, longer downwind
      if (rand() < (cand.length ? 0.3 : 0.75)) {
        for (const [dx, dz] of DIRS) {
          const a = i + dx, b = k + dz, a2 = i + 2 * dx, b2 = k + 2 * dz;
          if (!inB(a2, j, b2) || solid(a, j, b) || solid(a2, j, b2) || solid(a2, j - 1, b2)) continue;
          const dw = Math.max(0, (dx * wind.x + dz * wind.z) / Math.hypot(dx, dz));
          const w = (0.25 + 2.2 * dw * dw) * (dx && dz ? 0.6 : 1);
          cand.push(a2, b2, w); wsum += w;
        }
      }
    }
    if (cand.length) {
      let r = rand() * wsum, n = 0;
      for (; n < cand.length - 3; n += 3) if ((r -= cand[n + 2]) <= 0) break;
      rolling[g] = 1; rollX[g] = cand[n]; rollZ[g] = cand[n + 1];
      py[g] = j; vy[g] = 0; vx[g] = 0; vz[g] = 0;
      return;
    }
    const c = idx(i, j, k);
    occ[c] = O_SAND; owner[c] = g; cellOf[g] = c;
    px[g] = i; py[g] = j; pz[g] = k; state[g] = S_SAND; nFall--;
    matDirty = true;
  };

  const floorBelow = (i: number, k: number, j: number) => {
    while (j > 0 && !solid(i, j - 1, k)) j--;
    return j;
  };

  const stepFalling = (g: number, dt: number) => {
    if (rolling[g]) {
      const ci0 = Math.round(px[g]), ck0 = Math.round(pz[g]);
      const sp = 7 * dt;
      const dx = rollX[g] - px[g], dz = rollZ[g] - pz[g];
      const d = Math.hypot(dx, dz);
      if (d <= sp) { px[g] = rollX[g]; pz[g] = rollZ[g]; rolling[g] = 0; }
      else { px[g] += (dx / d) * sp; pz[g] += (dz / d) * sp; }
      const ci = Math.round(px[g]), ck = Math.round(pz[g]);
      if ((ci !== ci0 || ck !== ck0) && solid(ci, Math.floor(py[g]), ck)) {
        // something filled the gap; settle where we are
        rolling[g] = 0; px[g] = ci0; pz[g] = ck0;
        land(g, ci0, Math.floor(py[g]), ck0);
      }
      return;
    }
    const drag = py[g] > 1.5 ? 1.2 : 3;
    vx[g] += (wind.x * windSpeed * 0.6 - vx[g]) * Math.min(1, drag * dt);
    vz[g] += (wind.z * windSpeed * 0.6 - vz[g]) * Math.min(1, drag * dt);
    vy[g] = Math.max(vy[g] - G * dt, -28);
    let nx = px[g] + vx[g] * dt, nz = pz[g] + vz[g] * dt;
    nx = Math.max(2, Math.min(GX - 3, nx)); nz = Math.max(2, Math.min(GZ - 3, nz));
    const jb = Math.floor(py[g]), jt = Math.floor(py[g] + 0.98);
    let ci = Math.round(nx), ck = Math.round(nz);
    if (solid(ci, jb, ck) || solid(ci, jt, ck)) {
      vx[g] *= -0.15; vz[g] *= -0.15;
      nx = px[g]; nz = pz[g]; ci = Math.round(nx); ck = Math.round(nz);
    }
    px[g] = nx; pz[g] = nz;
    const ny = py[g] + vy[g] * dt;
    let start = Math.min(GY - 1, jt);
    if (solid(ci, start, ck)) start = jb;
    const fl = floorBelow(ci, ck, start);
    if (ny <= fl) land(g, ci, fl, ck);
    else py[g] = ny;
  };

  const startRise = (g: number) => {
    const hc = home[g];
    if (occ[hc] === O_SAND) {
      const h = owner[hc];
      const i = hc % GX, k = Math.floor(hc / GX) % GZ;
      const ox = i - CX, oz = k - CZ, d = Math.hypot(ox, oz) || 1;
      releaseSand(h, (ox / d) * 4, (oz / d) * 4);
      cellOf[h] = -1;
    }
    occ[hc] = O_RES;
    const src = cellOf[g];
    vacate(src); cellOf[g] = -1;
    state[g] = S_RISE; nRise++;
    riseT0[g] = simT; riseDur[g] = R(2.8, 4.6);
    riseFrom[g * 3] = px[g]; riseFrom[g * 3 + 1] = py[g]; riseFrom[g * 3 + 2] = pz[g];
    const hi = hc % GX, hk = Math.floor(hc / GX) % GZ, hj = Math.floor(hc / LAYER);
    riseCtl[g * 3] = (px[g] + hi) / 2 + R(-4, 4) - wind.x * 6;
    riseCtl[g * 3 + 1] = Math.max(py[g], hj) + R(5, 14);
    riseCtl[g * 3 + 2] = (pz[g] + hk) / 2 + R(-4, 4) - wind.z * 6;
  };

  const stepRise = (g: number) => {
    const t = Math.min(1, (simT - riseT0[g]) / riseDur[g]);
    const e = t * t * (3 - 2 * t);
    const hc = home[g];
    const hi = hc % GX, hk = Math.floor(hc / GX) % GZ, hj = Math.floor(hc / LAYER);
    const u = 1 - e;
    px[g] = u * u * riseFrom[g * 3] + 2 * u * e * riseCtl[g * 3] + e * e * hi;
    py[g] = u * u * riseFrom[g * 3 + 1] + 2 * u * e * riseCtl[g * 3 + 1] + e * e * hj;
    pz[g] = u * u * riseFrom[g * 3 + 2] + 2 * u * e * riseCtl[g * 3 + 2] + e * e * hk;
    if (t >= 1) {
      state[g] = S_ROCK; occ[hc] = O_ROCK; owner[hc] = g; cellOf[g] = hc; nRise--;
      attAdd(g);
    }
  };

  const setPhase = (p: typeof phase) => { phase = p; phaseT = 0; };

  const step = (dt: number) => {
    simT += dt; phaseT += dt;
    // wind wanders a little
    const wa = Math.sin(simT * 0.05) * 0.25 + Math.sin(simT * 0.013 + 2) * 0.2;
    wind.set(windBase.x * Math.cos(wa) - windBase.z * Math.sin(wa), 0, windBase.x * Math.sin(wa) + windBase.z * Math.cos(wa));

    if (phase === 'erode') {
      const ramp = Math.min(1, 0.25 + phaseT / 15);
      const gust = 0.75 + 0.5 * (0.5 + 0.5 * Math.sin(simT * 0.21) * Math.sin(simT * 0.077 + 1));
      weather(dt, rate0 * ramp * gust);
      connT += dt;
      if (connT > 1) { connT = 0; checkConnected(); }
      // done when little is left, or when what is left is hard rock buried in its own sand
      stallT = wearK >= 4.9 && phaseT > 20 ? stallT + dt : 0;
      if (nAtt < N * goneFrac || stallT > 8) setPhase('pause');
    } else if (phase === 'pause') {
      if (phaseT > 4 && nFall === 0 && pendingRelease.length === 0) setPhase('rise');
    } else if (phase === 'rise') {
      riseCarry += Math.min(180, 70 + phaseT * 3) * dt;
      while (riseCarry >= 1 && order.length) {
        const g = order[order.length - 1];
        if (state[g] === S_ROCK || state[g] === S_RISE) { order.pop(); continue; }
        if (state[g] !== S_SAND) break;
        riseCarry--; order.pop(); startRise(g);
      }
      if (riseCarry > 3) riseCarry = 3;
      if (!order.length && nRise === 0 && nFall === 0) setPhase('still');
    } else if (phase === 'still') {
      if (phaseT > 9) {
        tafOff += 3.7; computeTaf(); rebuildSurf(); wearK = 0.05;
        setPhase('erode');
      }
    }

    for (let n = pendingRelease.length - 1; n >= 0; n--) {
      const p = pendingRelease[n];
      if (simT >= p.t) {
        const g = p.g;
        state[g] = S_FALL; rolling[g] = 0; nFall++;
        const c0 = cellOf[g]; vacate(c0); cellOf[g] = -1; touchNeighbours(c0);
        vx[g] = wind.x * R(0.3, 1.2); vz[g] = wind.z * R(0.3, 1.2); vy[g] = 0;
        order.push(g);
        pendingRelease.splice(n, 1);
      }
    }

    if (nFall > 0 || nRise > 0) {
      const sub = dt > 1 / 50 ? 2 : 1;
      const h = dt / sub;
      for (let s = 0; s < sub; s++)
        for (let g = 0; g < N; g++) {
          if (state[g] === S_FALL) stepFalling(g, h);
          else if (state[g] === S_RISE && s === 0) stepRise(g);
        }
      let f = 0, r = 0;
      for (let g = 0; g < N; g++) { if (state[g] === S_FALL) f++; else if (state[g] === S_RISE) r++; }
      nFall = f; nRise = r;
      matDirty = true;
    }
    aoT += dt;
    if (aoT > 0.3) { aoT = 0; colDirty = true; }
  };

  const computeAO = () => {
    for (let g = 0; g < N; g++) {
      const st = state[g];
      if (st !== S_ROCK && st !== S_SAND) { ao[g] = 1; continue; }
      const c = cellOf[g];
      const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / LAYER);
      let n = 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj && !dk) continue;
            if (solid(i + di, j + dj, k + dk)) n += dj === 1 ? 1.25 : 1;
          }
      // a flat face sits near 17; creases and hollows go darker, edges lighter
      let a = 1 - Math.max(0, n - 14) * 0.038;
      if (j === 0) a *= 0.94;
      ao[g] = Math.max(0.5, Math.min(1.04, a));
    }
  };

  // ---------- three ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = pal.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 1, 1200);

  // sky: a screen-space gradient written straight to the screen so it matches the CSS behind it
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uFlo: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uFlo; uniform vec2 uRes;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){ float v = gl_FragCoord.y / uRes.y; 
          vec3 c = v < 0.38 ? mix(uFlo, uHor, v / 0.38) : mix(uHor, uTop, clamp((v - 0.38) / 0.62, 0.0, 1.0)); c += (h(gl_FragCoord.xy) - 0.5) / 255.0; gl_FragColor = vec4(c, 1.0); }`,
      depthTest: false, depthWrite: false,
    }),
  );
  // the colours are given as sRGB hex and written raw
  (sky.material as THREE.ShaderMaterial).uniforms.uTop.value.setStyle(pal.top, THREE.LinearSRGBColorSpace);
  (sky.material as THREE.ShaderMaterial).uniforms.uHor.value.setStyle(pal.hor, THREE.LinearSRGBColorSpace);
  (sky.material as THREE.ShaderMaterial).uniforms.uFlo.value.setStyle(pal.flo, THREE.LinearSRGBColorSpace);
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, pal.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(pal.sun, pal.sunI);
  sun.position.copy(sunDir).multiplyScalar(300).add(new THREE.Vector3(0, HT * 0.4, 0));
  sun.target.position.set(0, HT * 0.3, 0);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  const sm = Math.min(4096, renderer.capabilities.maxTextureSize);
  const smz = Math.min(window.innerWidth < 760 ? 1024 : 2048, sm);
  sun.shadow.mapSize.set(smz, smz);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -72; sc.right = 72; sc.top = 72; sc.bottom = -72; sc.near = 100; sc.far = 800;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.25; sun.shadow.radius = 7; sun.shadow.blurSamples = 16;
  
  // ground: only the shadows show, tinted, fading out with distance; the floor is the sky gradient
  const groundMat = new THREE.ShadowMaterial({ color: pal.shadowCol, opacity: pal.shadow, transparent: true, depthWrite: false });
  groundMat.onBeforeCompile = (sh: { vertexShader: string; fragmentShader: string }) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <fog_fragment>', '#include <fog_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(70.0, 360.0, length(vW));');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  scene.add(ground);

  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, dithering: true });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, N);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const mArr = mesh.instanceMatrix.array as Float32Array;
  for (let g = 0; g < N; g++) { mArr[g * 16] = 1; mArr[g * 16 + 5] = 1; mArr[g * 16 + 10] = 1; mArr[g * 16 + 15] = 1; }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  const cArr = mesh.instanceColor.array as Float32Array;
  scene.add(mesh);

  const writeMatrices = () => {
    for (let g = 0; g < N; g++) {
      const o = g * 16;
      mArr[o + 12] = px[g] - CX; mArr[o + 13] = py[g] + 0.5; mArr[o + 14] = pz[g] - CZ;
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  // Loose sand is the rock ground together: settled grains drift towards one mixed sand
  // tone, and take their own colour back as they rise.
  const sandCol = [0, 0, 0];
  for (let g = 0; g < N; g++) for (let c = 0; c < 3; c++) sandCol[c] += baseCol[g * 3 + c] / N;
  for (let c = 0; c < 3; c++) sandCol[c] *= 1 + pal.sandLift;
  const sandAmt = new Float32Array(N);
  const writeColors = (instant = false) => {
    computeAO();
    for (let g = 0; g < N; g++) {
      const st = state[g];
      if (st === S_SAND) sandAmt[g] = instant ? pal.sandMix : Math.min(pal.sandMix, sandAmt[g] + 0.06);
      else if (st === S_ROCK || st === S_RISE) sandAmt[g] = instant ? 0 : Math.max(0, sandAmt[g] - 0.12);
      const m = sandAmt[g], a = ao[g];
      for (let c = 0; c < 3; c++) cArr[g * 3 + c] = (baseCol[g * 3 + c] * (1 - m) + sandCol[c] * m) * a;
    }
    mesh.instanceColor!.needsUpdate = true;
  };

  // ---------- framing ----------
  let W = 1, H = 1, stacked = false;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const target = new THREE.Vector3(0, HT * 0.42, 0);
  const fovR = THREE.MathUtils.degToRad(22);
  const artHeight = () => (stacked ? Math.min(H, Math.max(360, H * 0.62)) : H);
  const frame = () => {
    const ax = camAz + look.x * 0.05;
    const el = camEl + look.y * 0.025;
    // stacked (phone): the art sits in the top part of the page and scrolls with it
    const artH = artHeight();
    const fillH = stacked ? 0.7 : 0.56;
    let dist = (HT / fillH / (2 * Math.tan(fovR / 2))) * (H / artH);
    const needW = stacked ? 96 : 150; // room for the dune
    const visW = 2 * Math.tan(fovR / 2) * dist * (W / H);
    if (visW < needW) dist *= needW / visW;
    camera.position.set(Math.sin(ax) * Math.cos(el), Math.sin(el), Math.cos(ax) * Math.cos(el)).multiplyScalar(dist).add(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const fx = stacked ? 0.5 - flip * 0.1 : 0.5 + flip * 0.17;
    const scroll = stacked ? window.scrollY : 0;
    const fy = (artH * 0.55 - scroll) / H; // where the target lands, from the top
    const n = camera.near, top = n * Math.tan(fovR / 2), hgt = 2 * top, wid = hgt * (W / H);
    const l = -fx * wid, t = fy * hgt;
    camera.projectionMatrix.makePerspective(l, l + wid, t, t - hgt, n, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };
  const resize = () => {
    W = window.innerWidth; H = window.innerHeight;
    stacked = W < 760 && W / H < 1.05;
    renderer.setSize(W, H, false);
    (sky.material as THREE.ShaderMaterial).uniforms.uRes.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
    frame();
  };

  // ---------- presimulate to a composed moment ----------
  const target0 = R(0.12, 0.42);
  {
    let guard = 0;
    while (phase === 'erode' && nAtt > N * (1 - target0) && guard++ < 30 * 400) step(1 / 30);
    // let the air clear
    for (let n = 0; n < 90 && nFall > 0; n++) step(1 / 30);
  }
  writeMatrices(); writeColors(true);

  // ---------- loop ----------
  let raf = 0, last = performance.now(), running = false, shown = false, frameNo = 0;
  const render = () => {
    look.x += (look.tx - look.x) * 0.03; look.y += (look.ty - look.y) * 0.03;
    frame();
    renderer.render(scene, camera);
    if (!shown) { shown = true; requestAnimationFrame(() => canvas.classList.add('on')); }
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!opts.reduced) {
      const sub = Math.max(1, Math.ceil(dt / 0.034));
      for (let s = 0; s < sub; s++) step(dt / sub);
      frameNo++;
      if (matDirty && (frameNo & 1)) { writeMatrices(); matDirty = false; renderer.shadowMap.needsUpdate = true; }
      if (colDirty) { writeColors(); colDirty = false; }
    }
    render();
  };
  const play = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  resize();
  window.addEventListener('resize', () => { resize(); if (!running) render(); });
  window.addEventListener('scroll', () => { if (!running) render(); }, { passive: true });
  if (!opts.reduced) {
    window.addEventListener('pointermove', (e) => { look.tx = e.clientX / W - 0.5; look.ty = e.clientY / H - 0.5; }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
    if (!document.hidden) play(); else render();
  } else {
    render();
    // a still frame, but keep it framed when scrolling on a phone
    window.addEventListener('scroll', () => requestAnimationFrame(render), { passive: true });
  }
  return { N };
}
