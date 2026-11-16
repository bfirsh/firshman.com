// Heightfield world: terrain, cellular water (virtual pipes), hydraulic + thermal erosion,
// beaches, grass, snow and trees. Pure CPU, typed arrays, no allocation per frame.

export const SEA = 0;
export const FLOOR = -4;
export const MAXH = 15;
export const STEP = 0.5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Sim {
  N: number;
  NN: number;
  h: Float32Array;
  w: Float32Array;
  wPrev: Float32Array;
  sed: Float32Array;
  sed2: Float32Array;
  flux: Float32Array;
  flow: Float32Array; // smoothed outflow: how river-like a cell is
  fdx: Float32Array; // smoothed flow direction
  fdz: Float32Array;
  moist: Float32Array;
  grass: Float32Array;
  snow: Float32Array;
  sand: Float32Array;
  rock: Float32Array;
  slope: Float32Array;
  dist: Uint8Array;
  disturbed: Float32Array;
  reserved: Uint8Array;
  precip: Float32Array;
  tree: Float32Array;
  treeKind: Uint8Array;
  treeJ: Float32Array; // jx, jz, scale, rot
  noise: Float32Array;
  hash: Float32Array;
  queue: Int32Array;
  rnd: () => number;
  snowLine: number;
  treeiness: number;
  palms: boolean;
  land = 0;
  seed: number;

  constructor(N: number, rnd: () => number, opts: { snowLine: number; treeiness: number; palms: boolean; seed: number }) {
    this.N = N;
    const NN = (this.NN = N * N);
    this.h = new Float32Array(NN);
    this.w = new Float32Array(NN);
    this.wPrev = new Float32Array(NN);
    this.sed = new Float32Array(NN);
    this.sed2 = new Float32Array(NN);
    this.flux = new Float32Array(NN * 4);
    this.flow = new Float32Array(NN);
    this.fdx = new Float32Array(NN);
    this.fdz = new Float32Array(NN);
    this.moist = new Float32Array(NN);
    this.grass = new Float32Array(NN);
    this.snow = new Float32Array(NN);
    this.sand = new Float32Array(NN);
    this.rock = new Float32Array(NN);
    this.slope = new Float32Array(NN);
    this.dist = new Uint8Array(NN);
    this.disturbed = new Float32Array(NN);
    this.reserved = new Uint8Array(NN);
    this.precip = new Float32Array(NN);
    this.tree = new Float32Array(NN);
    this.treeKind = new Uint8Array(NN);
    this.treeJ = new Float32Array(NN * 4);
    this.noise = new Float32Array(NN);
    this.hash = new Float32Array(NN);
    this.queue = new Int32Array(NN);
    this.rnd = rnd;
    this.snowLine = opts.snowLine;
    this.treeiness = opts.treeiness;
    this.palms = opts.palms;
    this.seed = opts.seed;
    for (let k = 0; k < NN; k++) {
      this.hash[k] = rnd();
      this.treeJ[k * 4] = (rnd() - 0.5) * 0.36;
      this.treeJ[k * 4 + 1] = (rnd() - 0.5) * 0.36;
      this.treeJ[k * 4 + 2] = 0.75 + rnd() * 0.5;
      this.treeJ[k * 4 + 3] = rnd() * Math.PI * 2;
    }
  }

  // --- value noise ---------------------------------------------------------
  private hn(i: number, j: number) {
    let x = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(this.seed, 982451653);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  vnoise(x: number, z: number) {
    const i = Math.floor(x), j = Math.floor(z);
    const fx = x - i, fz = z - j;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = this.hn(i, j), b = this.hn(i + 1, j), c = this.hn(i, j + 1), d = this.hn(i + 1, j + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  fbm(x: number, z: number) {
    let s = 0, a = 0.5, f = 1;
    for (let o = 0; o < 4; o++) { s += a * this.vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
    return s / 0.9375;
  }

  cx(i: number) { return i - this.N / 2 + 0.5; }
  idxAt(x: number, z: number) {
    const i = Math.floor(x + this.N / 2), j = Math.floor(z + this.N / 2);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -1;
    return j * this.N + i;
  }

  // --- the starting islet ---------------------------------------------------
  generate() {
    const { N, h, rnd } = this;
    const ang = rnd() * Math.PI * 2, off = rnd() * 7;
    const c1x = Math.cos(ang) * off, c1z = Math.sin(ang) * off;
    const peak = 4.2 + rnd() * 2.6;
    const R = 11.5 + rnd() * 3;
    const a2 = ang + Math.PI * (0.6 + rnd() * 0.8);
    const c2x = c1x + Math.cos(a2) * (10 + rnd() * 3), c2z = c1z + Math.sin(a2) * (10 + rnd() * 3);
    const p2 = 1.2 + rnd() * 1.5, R2 = 5 + rnd() * 2;
    const s = this.seed % 97;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = this.cx(i), z = this.cx(j), k = j * N + i;
      const nz = this.fbm(x * 0.06 + s, z * 0.06 - s);
      this.noise[k] = this.fbm(x * 0.21 + 40, z * 0.21 + 11);
      let base = -3.45 + 1.7 * nz;
      const wx = x + (this.fbm(x * 0.08 + 7, z * 0.08) - 0.5) * 7;
      const wz = z + (this.fbm(x * 0.08, z * 0.08 + 9) - 0.5) * 7;
      const d1 = Math.hypot(wx - c1x, wz - c1z);
      const d2 = Math.hypot(wx - c2x, wz - c2z);
      base += 1.1 * Math.exp(-(d1 * d1) / (2 * (R * 1.1) ** 2));
      const s1 = Math.max(0, 1 - d1 / R), s2 = Math.max(0, 1 - d2 / R2);
      const detail = 0.72 + 0.56 * this.fbm(x * 0.17 + 3, z * 0.17 + 5);
      const isl = Math.max((peak + 2.6) * Math.pow(s1, 1.45) * detail, (p2 + 2.6) * Math.pow(s2, 1.3) * detail);
      h[k] = Math.min(MAXH, Math.max(FLOOR + 0.5, base + isl));
    }
    for (let it = 0; it < 40; it++) this.thermal(0.06);
    this.computeDist();
    this.computeSlope();
    // grow it in: grass, sand, snow, a few groves
    for (let k = 0; k < this.NN; k++) this.moist[k] = 0.55;
    this.biomes(30, true);
    for (let k = 0; k < this.NN; k++) {
      if (this.treeOk(k) && this.grass[k] > 0.6 && this.noise[k] > 0.46 && rnd() < 0.55 * this.treeiness) {
        this.plant(k);
        this.tree[k] = 0.7 + rnd() * 0.3;
      }
    }
  }

  // --- sculpting -------------------------------------------------------------
  // Returns how many cells crossed sea level (for splashes / sound).
  sculpt(x: number, z: number, R: number, amt: number, out: { up: number; down: number; wet: number }) {
    const { N, h } = this;
    const i0 = Math.max(0, Math.floor(x + N / 2 - R)), i1 = Math.min(N - 1, Math.ceil(x + N / 2 + R));
    const j0 = Math.max(0, Math.floor(z + N / 2 - R)), j1 = Math.min(N - 1, Math.ceil(z + N / 2 + R));
    const R2 = R * R;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = this.cx(i) - x, dz = this.cx(j) - z;
      const r2 = dx * dx + dz * dz;
      if (r2 >= R2) continue;
      const t = 1 - r2 / R2;
      const f = t * t;
      const k = j * N + i;
      const old = h[k];
      const nh = Math.min(MAXH, Math.max(FLOOR + 0.5, old + amt * f));
      if (old < SEA && nh >= SEA) out.up++;
      if (old >= SEA && nh < SEA) out.down++;
      if (nh < SEA + 0.6 && nh > SEA - 1.2) out.wet += f;
      this.disturbed[k] += Math.abs(nh - old) * 2;
      h[k] = nh;
    }
  }

  // Gently level a plot (used when a town is founded).
  flatten(x: number, z: number, R: number, target: number, k: number) {
    const { N, h } = this;
    for (let j = Math.max(0, Math.floor(z + N / 2 - R)); j <= Math.min(N - 1, Math.ceil(z + N / 2 + R)); j++)
      for (let i = Math.max(0, Math.floor(x + N / 2 - R)); i <= Math.min(N - 1, Math.ceil(x + N / 2 + R)); i++) {
        const d = Math.hypot(this.cx(i) - x, this.cx(j) - z);
        if (d > R) continue;
        const c = j * N + i;
        const f = k * (1 - d / R);
        h[c] += (Math.max(target, h[c] - 0.3) - h[c]) * f;
        if (h[c] > target) h[c] += (target - h[c]) * f;
      }
  }

  // --- thermal settling ------------------------------------------------------
  private talus(hh: number) {
    return hh < SEA ? 0.75 : 1.0 + 0.9 * smooth(3.5, 10, hh);
  }
  thermal(dt: number) {
    const { N, h } = this;
    const kk = Math.min(0.5, dt * 9);
    const D = 1.4142;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * N + i;
      // right, up, up-right, up-left
      for (let n = 0; n < 4; n++) {
        let ii = i, jj = j, dist = 1;
        if (n === 0) ii = i + 1;
        else if (n === 1) jj = j + 1;
        else if (n === 2) { ii = i + 1; jj = j + 1; dist = D; }
        else { ii = i - 1; jj = j + 1; dist = D; }
        if (ii < 0 || ii >= N || jj >= N) continue;
        const b = jj * N + ii;
        const d = h[a] - h[b];
        const ad = d < 0 ? -d : d;
        const T = this.talus(d > 0 ? h[a] : h[b]) * dist;
        if (ad <= T) continue;
        const m = (ad - T) * 0.5 * kk * (dist > 1 ? 0.7 : 1);
        if (d > 0) { h[a] -= m; h[b] += m; } else { h[a] += m; h[b] -= m; }
      }
    }
  }

  // --- water -----------------------------------------------------------------
  private surf(n: number) {
    return this.h[n] < SEA ? SEA : this.h[n] + this.w[n];
  }

  rain(x: number, z: number, R: number, amt: number) {
    const { N, h } = this;
    let total = 0;
    for (let j = Math.max(0, Math.floor(z + N / 2 - R)); j <= Math.min(N - 1, Math.ceil(z + N / 2 + R)); j++)
      for (let i = Math.max(0, Math.floor(x + N / 2 - R)); i <= Math.min(N - 1, Math.ceil(x + N / 2 + R)); i++) {
        const dx = this.cx(i) - x, dz = this.cx(j) - z;
        const r2 = (dx * dx + dz * dz) / (R * R);
        if (r2 >= 1) continue;
        const k = j * N + i;
        if (h[k] < SEA) continue;
        const f = (1 - r2) * amt * (0.45 + 0.55 * smooth(0, 7, h[k]));
        this.w[k] += f;
        this.precip[k] += f;
        total += f;
      }
    return total;
  }

  water(dt: number) {
    const { N, h, w, flux: f, wPrev } = this;
    const KP = 14;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, q = k * 4;
      if (h[k] < SEA || w[k] <= 1e-6) { f[q] = f[q + 1] = f[q + 2] = f[q + 3] = 0; continue; }
      const H = h[k] + w[k];
      const sL = i > 0 ? this.surf(k - 1) : SEA - 1;
      const sR = i < N - 1 ? this.surf(k + 1) : SEA - 1;
      const sD = j > 0 ? this.surf(k - N) : SEA - 1;
      const sU = j < N - 1 ? this.surf(k + N) : SEA - 1;
      let fL = Math.max(0, f[q] * 0.92 + dt * KP * (H - sL));
      let fR = Math.max(0, f[q + 1] * 0.92 + dt * KP * (H - sR));
      let fD = Math.max(0, f[q + 2] * 0.92 + dt * KP * (H - sD));
      let fU = Math.max(0, f[q + 3] * 0.92 + dt * KP * (H - sU));
      const s = fL + fR + fD + fU;
      if (s > 0) {
        const sc = Math.min(1, w[k] / (s * dt));
        fL *= sc; fR *= sc; fD *= sc; fU *= sc;
      }
      f[q] = fL; f[q + 1] = fR; f[q + 2] = fD; f[q + 3] = fU;
    }
    wPrev.set(w);
    const sed = this.sed, sed2 = this.sed2;
    sed2.set(sed);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, q = k * 4;
      if (h[k] < SEA) { w[k] = 0; sed2[k] = 0; continue; }
      const inflow =
        (i > 0 ? f[(k - 1) * 4 + 1] : 0) + (i < N - 1 ? f[(k + 1) * 4] : 0) +
        (j > 0 ? f[(k - N) * 4 + 3] : 0) + (j < N - 1 ? f[(k + N) * 4 + 2] : 0);
      const out = f[q] + f[q + 1] + f[q + 2] + f[q + 3];
      w[k] = Math.max(0, w[k] + dt * (inflow - out));
      // carry sediment along with the water that leaves
      const w0 = wPrev[k];
      if (w0 > 1e-6 && out > 0 && sed[k] > 0) {
        for (let d = 0; d < 4; d++) {
          const fd = f[q + d];
          if (fd <= 0) continue;
          const m = sed[k] * Math.min(1, (fd * dt) / w0);
          sed2[k] -= m;
          let n = -1;
          if (d === 0 && i > 0) n = k - 1;
          else if (d === 1 && i < N - 1) n = k + 1;
          else if (d === 2 && j > 0) n = k - N;
          else if (d === 3 && j < N - 1) n = k + N;
          if (n < 0) continue;
          if (h[n] < SEA) { if (h[n] < SEA - 0.08) h[n] = Math.min(SEA - 0.08, h[n] + m); }
          else sed2[n] += m;
        }
      }
      // flow memory for rendering rivers
      const e = Math.min(1, dt * 1.5);
      this.flow[k] += (out - this.flow[k]) * e;
      this.fdx[k] += (f[q + 1] - f[q] - this.fdx[k]) * e;
      this.fdz[k] += (f[q + 3] - f[q + 2] - this.fdz[k]) * e;
    }
    this.sed = sed2; this.sed2 = sed;
    // erosion / deposition
    const S = this.sed;
    const KC = 1.3, KE = 0.5, KD = 0.5;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, q = k * 4;
      if (h[k] < SEA) continue;
      if (w[k] < 0.003) {
        if (S[k] > 0) { h[k] += S[k]; S[k] = 0; }
      } else {
        const hk = h[k];
        let sl = 0.04;
        if (i > 0) sl = Math.max(sl, hk - h[k - 1]);
        if (i < N - 1) sl = Math.max(sl, hk - h[k + 1]);
        if (j > 0) sl = Math.max(sl, hk - h[k - N]);
        if (j < N - 1) sl = Math.max(sl, hk - h[k + N]);
        sl = Math.min(sl, 1.2);
        const out = f[q] + f[q + 1] + f[q + 2] + f[q + 3];
        const cap = KC * out * sl;
        if (S[k] < cap) {
          const e = Math.min(KE * (cap - S[k]) * dt, 0.08 * dt, Math.max(0, hk - (FLOOR + 0.6)));
          h[k] -= e; S[k] += e;
        } else {
          const d = KD * (S[k] - cap) * dt;
          h[k] += d; S[k] -= d;
        }
      }
      w[k] = Math.max(0, w[k] - (0.004 + 0.035 * w[k]) * dt);
    }
  }

  // --- derived fields --------------------------------------------------------
  computeDist() {
    const { N, NN, h, dist, queue } = this;
    let head = 0, tail = 0;
    for (let k = 0; k < NN; k++) {
      if (h[k] < SEA) { dist[k] = 0; queue[tail++] = k; } else dist[k] = 255;
    }
    let land = 0;
    for (let k = 0; k < NN; k++) if (h[k] >= SEA + 0.25) land++;
    this.land = land;
    while (head < tail) {
      const k = queue[head++];
      const d = dist[k] + 1;
      if (d > 12) continue;
      const i = k % N, j = (k / N) | 0;
      if (i > 0 && dist[k - 1] > d) { dist[k - 1] = d; queue[tail++] = k - 1; }
      if (i < N - 1 && dist[k + 1] > d) { dist[k + 1] = d; queue[tail++] = k + 1; }
      if (j > 0 && dist[k - N] > d) { dist[k - N] = d; queue[tail++] = k - N; }
      if (j < N - 1 && dist[k + N] > d) { dist[k + N] = d; queue[tail++] = k + N; }
    }
  }
  computeSlope() {
    const { N, h, slope } = this;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, hk = h[k];
      let s = 0;
      if (i > 0) s = Math.max(s, Math.abs(hk - h[k - 1]));
      if (i < N - 1) s = Math.max(s, Math.abs(hk - h[k + 1]));
      if (j > 0) s = Math.max(s, Math.abs(hk - h[k - N]));
      if (j < N - 1) s = Math.max(s, Math.abs(hk - h[k + N]));
      slope[k] = s;
    }
  }

  treeOk(k: number) {
    const hk = this.h[k];
    if (this.reserved[k]) return false;
    if (hk < SEA + 0.5 || this.slope[k] > 1.05) return false;
    if (hk > this.snowLine - 0.8 || this.w[k] > 0.05 || this.disturbed[k] > 0.03) return false;
    if (this.flow[k] > 0.02) return false;
    if (this.sand[k] > 0.5) return this.palms && this.dist[k] <= 3 && this.noise[k] > 0.45;
    if (this.noise[k] < 0.5 - 0.12 * this.treeiness) return false; // meadows
    return this.grass[k] > 0.62;
  }
  plant(k: number) {
    const hk = this.h[k];
    let kind = 0;
    if (this.sand[k] > 0.5) kind = 2;
    else if (hk > this.snowLine - 3.2 || (hk > 3 && this.hash[k] < 0.45)) kind = 1;
    else if (this.hash[k] < 0.12) kind = 1;
    this.treeKind[k] = kind;
    this.tree[k] = 0.02;
  }

  // Biomes tick: grass, sand, snow, rock, moisture, trees.
  biomes(dt: number, init = false) {
    const { NN, N, h, rnd } = this;
    this.computeDist();
    this.computeSlope();
    const SL = this.snowLine;
    for (let k = 0; k < NN; k++) {
      const hk = h[k];
      const land = hk >= SEA;
      const sd = this.dist[k];
      // moisture: rain, rivers, sea air
      let m = this.moist[k];
      m += this.precip[k] * 1.6 + ((this.w[k] > 0.02 ? 0.1 : 0) + (sd <= 2 ? 0.02 : 0)) * dt;
      m += (0.42 - m) * 0.012 * dt;
      m = Math.min(1, m);
      this.moist[k] = m;
      // snow: by altitude plus fresh fall from high rain
      if (hk > SL - 1.8) this.snow[k] = Math.min(1.4, this.snow[k] + this.precip[k] * 8);
      const snowT = smooth(SL - 0.7, SL + 0.7, hk + (this.noise[k] - 0.5) * 1.2);
      let sn = this.snow[k];
      if (sn < snowT) sn += (snowT - sn) * Math.min(1, dt * (init ? 1 : 0.4));
      else sn -= Math.min(sn - snowT, dt * 0.012 * (1 + Math.max(0, SL - hk)));
      this.snow[k] = land ? sn : 0;
      if (land && sn > 0.4 && hk > SL - 0.5) this.w[k] += 0.008 * dt * sn; // meltwater feeds rivers
      if (hk > 3.4 && this.hash[k] < 0.02 && this.snow[k] < 0.5) this.w[k] += 0.06 * dt; // springs
      // beach
      const sandT = sd <= 2 && hk > SEA - 1.8 && hk < SEA + 0.95 - this.noise[k] * 0.3 ? 1 : 0;
      this.sand[k] += (sandT - this.sand[k]) * Math.min(1, dt * (init ? 1 : 0.8));
      // rock on steep faces
      const rockT = land ? smooth(1.25, 1.8, this.slope[k]) : smooth(0.6, 1.2, this.slope[k]) * 0.5;
      this.rock[k] += (rockT - this.rock[k]) * Math.min(1, dt * 2);
      // grass
      let gT = 0;
      if (land && hk > SEA + 0.35) {
        gT = smooth(0.1, 0.42, m) * (1 - smooth(SL - 2.2, SL - 0.4, hk)) * (1 - smooth(1.2, 1.8, this.slope[k]));
      }
      const dist = this.disturbed[k];
      let g = this.grass[k];
      if (init) g = gT;
      else if (dist > 0.04) g = Math.max(0, g - dt * 2.5);
      else if (g < gT) g += Math.min(gT - g, dt * (0.05 + 0.14 * m));
      else g -= Math.min(g - gT, dt * 0.3);
      this.grass[k] = g;
      this.disturbed[k] = dist * Math.exp(-dt * 2.2);
      this.precip[k] = 0;
    }
    // trees: spread from neighbours, occasionally seed; die when the ground goes bad
    const tries = init ? 0 : Math.ceil(NN * 0.018);
    for (let t = 0; t < tries; t++) {
      const k = (rnd() * NN) | 0;
      if (this.tree[k] > 0 || !this.treeOk(k)) continue;
      const i = k % N, j = (k / N) | 0;
      let near = 0, crowd = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const v = this.tree[jj * N + ii];
        if (v > 0.5) { near++; if (Math.abs(di) <= 1 && Math.abs(dj) <= 1) crowd++; }
      }
      const p = crowd >= 4 ? 0.01 : near > 0 ? 0.14 : 0.004;
      if (rnd() < p * this.treeiness) this.plant(k);
    }
    for (let k = 0; k < NN; k++) {
      const v = this.tree[k];
      if (v <= 0) continue;
      const hk = h[k];
      const ok = hk >= SEA + 0.25 && this.slope[k] < 1.5 && this.snow[k] < 0.7 && this.disturbed[k] < 0.06 && !this.reserved[k] && this.w[k] < 0.05 && this.flow[k] < 0.03;
      if (ok) this.tree[k] = Math.min(1, v + dt * 0.09);
      else this.tree[k] = Math.max(0, v - dt * 1.6);
    }
  }

  // Score a spot for a new town: flat, near water, away from others.
  findSite(avoid: { x: number; z: number; r: number }[]) {
    const { N, h, rnd } = this;
    let best = -1e9, bk = -1;
    for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
      const k = j * N + i, hk = h[k];
      if (hk < SEA + 0.4 || hk > SEA + 5.5 || this.reserved[k]) continue;
      if (this.snow[k] > 0.2 || this.w[k] > 0.04) continue;
      const sd = this.dist[k];
      let river = 0, maxd = 0, landN = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const c = k + dj * N + di;
        maxd = Math.max(maxd, Math.abs(h[c] - hk));
        if (h[c] >= SEA + 0.2) landN++;
      }
      if (maxd > 0.85 || landN < 7) continue;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) river = Math.max(river, this.flow[k + dj * N + di]);
      const byWater = sd <= 3 || river > 0.05;
      if (!byWater) continue;
      const x = this.cx(i), z = this.cx(j);
      let ok = true;
      for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) { ok = false; break; }
      if (!ok) continue;
      const edge = Math.min(i, j, N - 1 - i, N - 1 - j);
      const score = (1 - maxd) * 2 + (sd <= 2 ? 1 : 0.4) + (river > 0.05 ? 0.7 : 0) - Math.abs(hk - 1.4) * 0.18 + (edge < 5 ? -0.8 : 0) + rnd() * 0.35;
      if (score > best) { best = score; bk = k; }
    }
    return bk;
  }

  // Coastal high point for the lighthouse.
  findHeadland(avoid: { x: number; z: number; r: number }[]) {
    const { N, h } = this;
    let best = -1e9, bk = -1;
    for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
      const k = j * N + i, hk = h[k];
      if (hk < SEA + 0.8 || hk > SEA + 7 || this.reserved[k] || this.dist[k] > 2) continue;
      if (this.slope[k] > 1.1) continue;
      const x = this.cx(i), z = this.cx(j);
      let ok = true;
      for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) { ok = false; break; }
      if (!ok) continue;
      const score = hk * 0.5 - this.dist[k] * 0.6 - this.slope[k] + this.hash[k] * 0.4;
      if (score > best) { best = score; bk = k; }
    }
    return bk;
  }
}
