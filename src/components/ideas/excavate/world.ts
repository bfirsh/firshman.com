// The voxel block: strata, inclusions, fossils, and the buried finds.
import { mulberry32, hash3, makeNoise, hexToLinear } from './rng';
import { textWidth, rasterize } from './font';
import type { FindItem } from './content';

export const K_SED = 0;
export const K_LOOSE = 1;
export const K_FIND = 2; // kind >= K_FIND means find id = kind - K_FIND

type Rock = { c: string; hp: number; glint?: number; xb?: boolean; peb?: boolean };
type Site = {
  name: string;
  sed: Rock[];
  chalk: string; coal: string; ash: string; iron: string; soil: string;
  grass: string[];
  flint: string;
  tablets: string[];
  bg: string; // background tone
  lamp: string; // key light colour
};

// Curated sites: each a palette of rocks that sit well together under warm light.
const SITES: Site[] = [
  {
    name: 'coast',
    sed: [
      { c: '#c9a774', hp: 10, glint: 0.03, xb: true },
      { c: '#d8b067', hp: 10, glint: 0.03, xb: true },
      { c: '#bf8440', hp: 12 },
      { c: '#8a8e8c', hp: 15 },
      { c: '#a7826d', hp: 13 },
      { c: '#77685e', hp: 16 },
      { c: '#c7a98a', hp: 14, peb: true },
      { c: '#8f8f5c', hp: 12, glint: 0.02 },
    ],
    chalk: '#e3d9c4', coal: '#1d1a19', ash: '#ddd2bf', iron: '#93472a', soil: '#4a3426',
    grass: ['#7d7a3e', '#9a8c48', '#5f6a35'], flint: '#3e3f45',
    tablets: ['#38414f', '#2e3d68', '#4b7560', '#9b4f35', '#2b2828'],
    bg: '#120d0a', lamp: '#ffd7a8',
  },
  {
    name: 'rose',
    sed: [
      { c: '#c08070', hp: 10, glint: 0.03, xb: true },
      { c: '#d39f84', hp: 10, glint: 0.03, xb: true },
      { c: '#dbc7a6', hp: 11, xb: true },
      { c: '#77505a', hp: 15 },
      { c: '#c99a5e', hp: 12 },
      { c: '#8a4637', hp: 14 },
      { c: '#9c8a94', hp: 15 },
      { c: '#c08a78', hp: 15, peb: true },
    ],
    chalk: '#e4d9c8', coal: '#221a1c', ash: '#e8dccb', iron: '#7a2c22', soil: '#43302a',
    grass: ['#85803f', '#a28f4a', '#6a6d38'], flint: '#3f3a40',
    tablets: ['#2f3a4a', '#294a5e', '#3f6b5c', '#262325', '#5a4a6e'],
    bg: '#130c0b', lamp: '#ffd2a4',
  },
  {
    name: 'ochre',
    sed: [
      { c: '#d6ad55', hp: 10, glint: 0.02, xb: true },
      { c: '#c98144', hp: 11, xb: true },
      { c: '#984634', hp: 13 },
      { c: '#dcc59c', hp: 10, xb: true },
      { c: '#5f4039', hp: 15 },
      { c: '#b5643f', hp: 12 },
      { c: '#ad9066', hp: 14, peb: true },
    ],
    chalk: '#e2d6bf', coal: '#1c1614', ash: '#e9dcc1', iron: '#7c2a1e', soil: '#3f2c22',
    grass: ['#7f7d3b', '#9e9046', '#62683a'], flint: '#3b3a3f',
    tablets: ['#2d3747', '#26416a', '#3d6857', '#2a2626', '#4c3a5c'],
    bg: '#120c09', lamp: '#ffd6a0',
  },
  {
    name: 'painted',
    sed: [
      { c: '#7a4239', hp: 13 },
      { c: '#c89b4c', hp: 10, glint: 0.03, xb: true },
      { c: '#bb9a77', hp: 11, xb: true },
      { c: '#7c7751', hp: 14 },
      { c: '#c78c82', hp: 12 },
      { c: '#9a5a3c', hp: 12 },
      { c: '#a69a86', hp: 15, peb: true },
    ],
    chalk: '#ddd4c4', coal: '#211c1d', ash: '#ddd4c4', iron: '#6f2a22', soil: '#3c2b24',
    grass: ['#7a7b40', '#988c4d', '#5d653a'], flint: '#3a393e',
    tablets: ['#323c4b', '#2b4469', '#46705f', '#2a2727', '#a0583a'],
    bg: '#110c0a', lamp: '#ffd9ad',
  },
];

export type Find = {
  id: number;
  item: FindItem;
  type: 'tablet' | 'geode';
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
  cx: number; cy: number; cz: number; r: number;
  zr: number; // relief plane for tablets
  probe: Int32Array;
  need: number;
  found: boolean;
  glow: number; // animated 0..1
  t: number; // seconds since found
  anchor: [number, number, number];
  colour: [number, number, number];
  exposure: number;
};

export type WorldOpts = { seed: number; portrait: boolean; items: FindItem[] };

export class World {
  X: number; Y: number; Z: number; N: number;
  mat: Uint8Array; kind: Uint8Array; hp: Float32Array;
  pal = new Float32Array(256 * 3);
  glint = new Float32Array(256);
  metal = new Float32Array(256);
  hard = new Float32Array(256);
  bx0: number; bx1: number; bz0: number; bz1: number; BH: number;
  finds: Find[] = [];
  site: Site;
  sand: number[] = [];
  paleIdx = 0;
  nameIdx = 159;
  seed: number;
  rand: () => number;

  constructor(o: WorldOpts) {
    this.seed = o.seed;
    const rand = (this.rand = mulberry32(o.seed));
    const BW = o.portrait ? 64 : 104;
    const BH = o.portrait ? 84 : 60;
    const BD = o.portrait ? 36 : 38;
    const mx = o.portrait ? 12 : 14;
    this.X = BW + mx * 2;
    this.Y = BH + 6;
    this.bz0 = 6;
    this.bz1 = this.bz0 + BD;
    this.Z = this.bz1 + (o.portrait ? 26 : 17);
    this.bx0 = mx; this.bx1 = mx + BW; this.BH = BH;
    this.N = this.X * this.Y * this.Z;
    this.mat = new Uint8Array(this.N);
    this.kind = new Uint8Array(this.N);
    this.hp = new Float32Array(this.N);
    this.site = SITES[Math.floor(rand() * SITES.length) % SITES.length];
    this.generate(o.items);
  }

  idx(x: number, y: number, z: number) { return x + this.X * (z + this.Z * y); }
  inGrid(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < this.X && y < this.Y && z < this.Z; }
  solid(x: number, y: number, z: number) {
    if (x < 0 || z < 0 || x >= this.X || z >= this.Z || y >= this.Y) return false;
    if (y < 0) return true; // plinth
    return this.mat[x + this.X * (z + this.Z * y)] !== 0;
  }

  private setPal(i: number, hex: string, mul = 1, warm = 0, glint = 0, hp = 10, metal = 0) {
    const [r, g, b] = hexToLinear(hex);
    this.pal[i * 3] = Math.min(1, r * mul * (1 + warm));
    this.pal[i * 3 + 1] = Math.min(1, g * mul);
    this.pal[i * 3 + 2] = Math.min(1, b * mul * (1 - warm));
    this.glint[i] = glint; this.hard[i] = hp; this.metal[i] = metal;
  }

  private generate(items: FindItem[]) {
    const { X, Y, Z, bx0, bx1, bz0, bz1, BH } = this;
    const rand = this.rand;
    const site = this.site;
    const noise = makeNoise(rand);
    const n2 = (x: number, z: number) => noise(x, 0.37, z);

    // ---- palette ---------------------------------------------------------
    const rocks: Rock[] = [
      ...site.sed,
      { c: site.chalk, hp: 9 },
      { c: site.coal, hp: 13, glint: 0.12 },
      { c: site.ash, hp: 9 },
      { c: site.iron, hp: 24, glint: 0.05 },
      { c: site.soil, hp: 7 },
    ];
    const T_CHALK = site.sed.length, T_COAL = T_CHALK + 1, T_ASH = T_CHALK + 2, T_IRON = T_CHALK + 3, T_SOIL = T_CHALK + 4;
    rocks.forEach((r, t) => {
      for (let s = 0; s < 7; s++) this.setPal(1 + t * 8 + s, r.c, 0.86 + s * 0.046, (3 - s) * 0.014, 0, r.hp);
      this.setPal(1 + t * 8 + 7, r.c, 1.22, -0.02, 1, r.hp);
    });
    const P_FLINT = 121, P_RIND = 122, P_SHELL = 123, P_SHELL2 = 124, P_GRASS = 125;
    this.setPal(P_FLINT, site.flint, 1, 0, 0.5, 38);
    this.setPal(P_RIND, '#e9e2d4', 1, 0, 0, 20);
    this.setPal(P_SHELL, '#e2d2ae', 1, 0, 0.15, 18);
    this.setPal(P_SHELL2, '#a88f6a', 1, 0, 0, 16);
    site.grass.forEach((g, i) => this.setPal(P_GRASS + i, g, 0.62, 0.04, 0, 3));
    this.sand = [];
    for (let t = 0; t < site.sed.length; t++) if (site.sed[t].xb) for (let s = 1; s < 6; s++) this.sand.push(1 + t * 8 + s);
    if (!this.sand.length) for (let s = 1; s < 6; s++) this.sand.push(1 + s);
    this.paleIdx = 1 + T_CHALK * 8 + 6;
    this.setPal(this.nameIdx, site.chalk, 1.05, 0.02, 0.6, 1);

    // ---- strata sequence (in warped height) ------------------------------
    const seq: { t: number; y0: number; y1: number }[] = [];
    const chalkY = BH * (0.5 + rand() * 0.22);
    const coalY = BH * (0.16 + rand() * 0.2);
    let doneChalk = false, doneCoal = false;
    let y = -40, prev = -1;
    const push = (t: number, th: number) => { seq.push({ t, y0: y, y1: y + th }); y += th; prev = t; };
    while (y < BH + 40) {
      if (!doneChalk && y >= chalkY) { push(T_CHALK, 5 + Math.floor(rand() * 4)); doneChalk = true; continue; }
      if (!doneCoal && y >= coalY) { push(T_COAL, 2 + Math.floor(rand() * 2)); doneCoal = true; continue; }
      if (rand() < 0.16) { push(rand() < 0.5 ? T_ASH : T_IRON, 1 + (rand() < 0.3 ? 1 : 0)); continue; }
      let t = Math.floor(rand() * site.sed.length);
      if (t === prev) t = (t + 1) % site.sed.length;
      push(t, 3 + Math.floor(rand() * rand() * 10));
    }
    const layerAt = (yw: number) => {
      let lo = 0, hi = seq.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (seq[m].y1 <= yw) lo = m + 1; else hi = m; }
      return seq[lo];
    };

    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const dipX = (rand() - 0.5) * 0.22, dipZ = (rand() - 0.5) * 0.12;
    const foldA = 1 + rand() * 3.2, foldK = (0.04 + rand() * 0.05), foldP = rand() * 6.28;
    const fault = rand() < 0.55 ? bx0 + 18 + Math.floor(rand() * (bx1 - bx0 - 36)) : -1;
    const throwY = (rand() < 0.5 ? -1 : 1) * (2 + Math.floor(rand() * 4));
    const faultLean = (rand() - 0.5) * 0.6;

    const topH = (x: number, z: number) => BH - 1 - Math.round(1.2 + 1.3 * n2(x * 0.06, z * 0.06) + 0.6 * n2(x * 0.21, z * 0.21));

    // ---- fill --------------------------------------------------------------
    for (let z = bz0; z < bz1; z++) for (let x = bx0; x < bx1; x++) {
      const th = topH(x, z);
      const ex = Math.min(x - bx0, bx1 - 1 - x), ez = Math.min(z - bz0, bz1 - 1 - z), em = Math.min(ex, ez);
      const round = em < 4 ? (4 - em) * 1.1 + (n2(x * 0.3, z * 0.3) + 0.5) * 1.6 : 0;
      const corner = ex < 2 && ez < 2;
      const nb = n2(x * 0.05, z * 0.05);
      for (let yy = 0; yy <= th; yy++) {
        if (yy > th - round) continue;
        if (corner && hash3(x, yy, z, 7) < 0.35) continue;
        let yw = yy + dipX * (x - cx) + dipZ * (z - cz) + foldA * Math.sin((x - cx) * foldK + foldP) + nb * 2.6;
        if (fault >= 0 && x + (yy - BH / 2) * faultLean > fault) yw += throwY;
        let L = layerAt(yw);
        const rk = rocks[L.t];
        const i = this.idx(x, yy, z);
        let lam = yw - L.y0;
        if (rk.xb) {
          // cross-bedding: oblique laminae inside sandstone sets
          const per = 7;
          lam += ((((x + 1000) * 0.5 + noise(x * 0.07, yy * 0.07, z * 0.07) * 4) % per) / per) * 1.4;
        }
        const n3 = noise(x * 0.18, yy * 0.18, z * 0.18);
        let s = Math.floor((0.5 + 0.32 * Math.sin(lam * 2.3 + n3 * 1.7) + (hash3(x, yy, z) - 0.5) * 0.26) * 7);
        s = Math.max(0, Math.min(6, s));
        let m = 1 + L.t * 8 + s;
        if (rk.glint && hash3(x, yy, z, 3) < rk.glint) m = 1 + L.t * 8 + 7;
        if (rk.peb) {
          const q = noise(x * 0.42 + 9, yy * 0.42, z * 0.42);
          if (q > 0.36) {
            const pt = Math.floor(hash3(Math.floor(x / 3), Math.floor(yy / 3), Math.floor(z / 3), 5) * rocks.length);
            m = 1 + (pt === T_SOIL ? T_CHALK : pt) * 8 + (q > 0.48 ? 5 : 3);
          }
        }
        if (L.t === T_CHALK) {
          const f = noise(x * 0.22 + 31, yy * 0.3, z * 0.22);
          if (f > 0.45) m = P_FLINT; else if (f > 0.39) m = P_RIND;
        }
        if (yy > th - 2.2 - (n3 + 0.4) * 1.2) m = 1 + T_SOIL * 8 + Math.floor(hash3(x, yy, z, 9) * 5);
        // differential weathering on the cut faces: soft beds recede, hard ones stand proud
        if (em < 3 && yy < th - 2) {
          const soft = Math.max(0, Math.min(1, (17 - this.hard[m]) / 8));
          const rec = soft * 1.5 + (hash3(L.t, Math.floor(L.y0), 0, 41) - 0.3) * 1.1 + (noise(x * 0.07 + 5, yy * 0.21, z * 0.07) + 0.3) * 1.3;
          if (em < Math.min(2.4, rec)) continue;
        }
        this.mat[i] = m;
        this.hp[i] = this.hard[m];
      }
      // tufts of dry grass on the soil
      if (round < 0.5 && hash3(x, 0, z, 11) < 0.045 + 0.05 * n2(x * 0.09 + 3, z * 0.09)) {
        const h = 1 + Math.floor(hash3(x, 1, z, 12) * 1.7);
        for (let k = 1; k <= h; k++) if (th + k < Y) {
          const i = this.idx(x, th + k, z);
          this.mat[i] = P_GRASS + Math.floor(hash3(x, k, z, 13) * 3);
          this.hp[i] = 3;
        }
      }
    }

    // ---- fossils: little ammonites in the finer beds ---------------------
    const nAmm = 7 + Math.floor(rand() * 6);
    for (let a = 0; a < nAmm; a++) {
      const ax = bx0 + 6 + rand() * (bx1 - bx0 - 12), ay = 4 + rand() * (BH - 12), az = bz0 + 3 + Math.floor(rand() * (bz1 - bz0 - 4));
      const rot = rand() * 6.28, sz = 0.8 + rand() * 0.5, flip = rand() < 0.5 ? 1 : -1;
      for (let t = 0; t < 3.4 * Math.PI; t += 0.08) {
        const rr = (0.5 + t * 0.32) * sz;
        const px = Math.round(ax + rr * Math.cos(t * flip + rot)), py = Math.round(ay + rr * Math.sin(t * flip + rot));
        for (let dz = 0; dz < 2; dz++) {
          const zz = az + dz;
          if (!this.inGrid(px, py, zz)) continue;
          const i = this.idx(px, py, zz);
          if (this.mat[i]) { this.mat[i] = (Math.floor(t * 3) % 2) ? P_SHELL : P_SHELL2; this.hp[i] = this.hard[this.mat[i]]; }
        }
      }
    }

    // ---- finds -------------------------------------------------------------
    this.placeFinds(items, topH);
  }

  private placeFinds(items: FindItem[], topH: (x: number, z: number) => number) {
    const { bx0, bx1, bz1, bz0, BH } = this;
    const rand = this.rand;
    const BD = bz1 - bz0;
    type Box = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; d: number };
    const placed: Box[] = [];
    const hit = (b: Box, pad: number) => placed.some((p) => b.x0 - pad < p.x1 && b.x1 + pad > p.x0 && b.y0 - pad < p.y1 && b.y1 + pad > p.y0 && b.z0 - pad < p.z1 && b.z1 + pad > p.z0);
    const cover = (b: Box) => {
      // worst fraction of a rect hidden behind / hiding another find, seen from the front
      let worst = 0;
      for (const p of placed) {
        const ox = Math.max(0, Math.min(b.x1, p.x1) - Math.max(b.x0, p.x0));
        const oy = Math.max(0, Math.min(b.y1, p.y1) - Math.max(b.y0, p.y0));
        const o = ox * oy;
        if (!o) continue;
        const ab = (b.x1 - b.x0) * (b.y1 - b.y0), ap = (p.x1 - p.x0) * (p.y1 - p.y0);
        worst = Math.max(worst, b.d > p.d ? o / ab : o / ap);
      }
      return worst;
    };
    const minTop = BH - 5;

    const tabs = items.map((it, id) => ({ it, id })).filter((e) => e.it.type === 'tablet');
    const geos = items.map((it, id) => ({ it, id })).filter((e) => e.it.type === 'geode');
    // big ones first; Replicate always first and shallow
    tabs.sort((a, b) => (a.it.kind === 'now' ? -1 : b.it.kind === 'now' ? 1 : 0) || textWidth(b.it.lines![0]) - textWidth(a.it.lines![0]));
    const depths: number[] = [];
    for (let i = 0; i < tabs.length - 1; i++) depths.push(5 + Math.round((i / (tabs.length - 2)) * (BD * 0.4)));
    for (let i = depths.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [depths[i], depths[j]] = [depths[j], depths[i]]; }

    const finds: Find[] = new Array(items.length);
    tabs.forEach((e, k) => {
      const lines = e.it.lines!;
      const tw = Math.max(...lines.map(textWidth));
      const w = tw + 4, h = 5 * lines.length + 2 * (lines.length - 1) + 4;
      let best: Box | null = null;
      for (let tries = 0; tries < 900 && !best; tries++) {
        const relax = tries / 900;
        const d = e.it.kind === 'now' ? 4 + Math.floor(rand() * 2) : Math.max(5, depths[k - 1] + Math.floor((rand() - 0.5) * 3));
        const zr = bz1 - 1 - d;
        let x0: number, y0: number;
        if (e.it.kind === 'now') {
          x0 = Math.round((bx0 + bx1 - w) / 2 + (rand() - 0.5) * 16);
          y0 = Math.round(BH * 0.42 + rand() * (minTop - h - 3 - BH * 0.42));
        } else {
          x0 = bx0 + 3 + Math.floor(rand() * (bx1 - bx0 - 6 - w));
          y0 = 3 + Math.floor(rand() * (minTop - 3 - h - 3));
        }
        const b: Box = { x0, y0, z0: zr - 2, x1: x0 + w, y1: y0 + h, z1: zr + 1, d };
        if (hit(b, 2)) continue;
        if (cover(b) > 0.1 + relax * 0.5) continue;
        best = b;
      }
      if (!best) {
        // last resort: anywhere that doesn't intersect
        for (let tries = 0; tries < 4000 && !best; tries++) {
          const zr = bz1 - 6 - Math.floor(rand() * (BD - 11));
          const x0 = bx0 + 2 + Math.floor(rand() * (bx1 - bx0 - 4 - w));
          const y0 = 2 + Math.floor(rand() * (minTop - 2 - h - 2));
          const b: Box = { x0, y0, z0: zr - 2, x1: x0 + w, y1: y0 + h, z1: zr + 1, d: bz1 - 1 - zr };
          if (!hit(b, 1)) best = b;
        }
      }
      const b = best!;
      placed.push(b);
      finds[e.id] = this.stampTablet(e.id, e.it, b.x0, b.y0, b.z1 - 1, w, h, lines);
    });

    geos.forEach((e) => {
      const contact = e.it.kind === 'contact';
      const r = contact ? 5.2 : 3.6 + rand() * 0.9;
      let best: Box | null = null;
      let c = [0, 0, 0];
      for (let tries = 0; tries < 3000 && !best; tries++) {
        const relax = tries / 3000;
        const dc = contact ? BD * 0.5 + rand() * (BD * 0.5 - r - 3) : r + 6 + rand() * (BD - 2 * r - 9);
        const gx = bx0 + r + 3 + rand() * (bx1 - bx0 - 2 * r - 6);
        const gy = contact ? r + 2 + rand() * (BH * 0.38 - r) : r + 2 + rand() * (minTop - 2 * r - 4);
        const gz = bz1 - 1 - dc;
        const b: Box = { x0: Math.floor(gx - r), y0: Math.floor(gy - r), z0: Math.floor(gz - r), x1: Math.ceil(gx + r + 1), y1: Math.ceil(gy + r + 1), z1: Math.ceil(gz + r + 1), d: dc - r };
        if (hit(b, 2)) continue;
        if (cover(b) > 0.25 + relax * 0.6) continue;
        best = b; c = [gx, gy, gz];
      }
      if (!best) { const gx = (bx0 + bx1) / 2, gy = r + 2, gz = bz0 + r + 2; best = { x0: gx - r, y0: gy - r, z0: gz - r, x1: gx + r, y1: gy + r, z1: gz + r, d: 99 }; c = [gx, gy, gz]; }
      placed.push(best);
      finds[e.id] = this.stampGeode(e.id, e.it, c[0], c[1], c[2], r);
    });
    this.finds = finds;
    void topH;
  }

  private findPal(id: number, k: number) { return 160 + id * 6 + k; }

  private stampTablet(id: number, it: FindItem, x0: number, y0: number, zr: number, w: number, h: number, lines: string[]): Find {
    const rand = this.rand;
    const stone = this.site.tablets[Math.floor(rand() * this.site.tablets.length)];
    const P = (k: number) => this.findPal(id, k);
    this.setPal(P(0), stone, 1, 0, 0, 999);
    this.setPal(P(1), stone, 0.86, 0.03, 0, 999);
    this.setPal(P(2), '#e7b450', 1, 0, 0.7, 999, 0.85);
    this.setPal(P(3), stone, 1.18, 0, 0.05, 999);
    const fk = K_FIND + id;
    const put = (x: number, y: number, z: number, m: number) => {
      if (!this.inGrid(x, y, z)) return;
      const i = this.idx(x, y, z);
      this.mat[i] = m; this.kind[i] = fk; this.hp[i] = 999;
    };
    const x1 = x0 + w, y1 = y0 + h;
    const chipped = (x: number, y: number) => {
      const cx = x === x0 || x === x1 - 1, cy = y === y0 || y === y1 - 1;
      if (cx && cy) return true;
      if ((cx || cy) && hash3(x, y, id, 21) < 0.08) return true;
      return false;
    };
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (chipped(x, y)) continue;
      put(x, y, zr - 2, P(0));
      put(x, y, zr - 1, hash3(x, y, zr, 22) < 0.25 ? P(1) : P(0));
      const rim = x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1;
      if (rim && hash3(x, y, id, 23) > 0.06) put(x, y, zr, P(3));
    }
    lines.forEach((ln, li) => {
      const lw = textWidth(ln);
      const ox = x0 + Math.floor((w - lw) / 2);
      const top = y1 - 3 - li * 7;
      rasterize(ln, (gx, row) => put(ox + gx, top - row, zr, P(2)));
    });
    // probe: the cells in front of the relief, plus the recess between letters
    const probe: number[] = [];
    for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
      probe.push(this.idx(x, y, zr + 1));
      const i = this.idx(x, y, zr);
      if (this.kind[i] !== fk) probe.push(i);
    }
    const glow = hexToLinear('#ffb35c');
    return {
      id, item: it, type: 'tablet', x0, y0, z0: zr - 2, x1, y1, z1: zr + 1,
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: zr, r: 0, zr,
      probe: Int32Array.from(probe), need: 0.6, found: false, glow: 0, t: 0,
      anchor: [(x0 + x1) / 2, y1 + 0.4, zr + 1], colour: glow, exposure: 0,
    };
  }

  private stampGeode(id: number, it: FindItem, cx: number, cy: number, cz: number, r: number): Find {
    const P = (k: number) => this.findPal(id, k);
    const cr = it.crystal || '#eeeeee';
    this.setPal(P(0), '#7b6f63', 1, 0, 0, 999);
    this.setPal(P(1), '#8f9aa6', 1, 0, 0.05, 999);
    this.setPal(P(2), '#d9dde0', 1, 0, 0.05, 999);
    this.setPal(P(3), cr, 0.55, 0, 0.6, 999);
    this.setPal(P(4), cr, 0.95, 0, 1, 999);
    this.setPal(P(5), cr, 1.35, 0, 1, 999);
    const fk = K_FIND + id;
    const probe: number[] = [];
    const R = Math.ceil(r + 2);
    const n = makeNoise(mulberry32(this.seed + id * 77));
    for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
      if (!this.inGrid(x, y, z)) continue;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * (1 + 0.09 * n(x * 0.4, y * 0.4, z * 0.4));
      const i = this.idx(x, y, z);
      if (d <= r) {
        let m = 0;
        if (d > r - 0.9) m = P(0);
        else if (d > r - 1.5) m = (Math.floor(d * 3.1) % 2) ? P(1) : P(2);
        else if (d > r - 2.5) {
          const hh = hash3(x, y, z, 31);
          if (d < r - 2.0 && hh < 0.45) m = 0;
          else m = hh < 0.3 ? P(5) : hh < 0.7 ? P(4) : P(3);
        }
        if (m) { this.mat[i] = m; this.kind[i] = fk; this.hp[i] = 999; }
        else { this.mat[i] = 0; this.kind[i] = 0; }
      } else if (d <= r + 1.6 && dz > -0.6) {
        probe.push(i);
      }
    }
    return {
      id, item: it, type: 'geode', x0: cx - r, y0: cy - r, z0: cz - r, x1: cx + r, y1: cy + r, z1: cz + r,
      cx, cy, cz, r, zr: cz,
      probe: Int32Array.from(probe), need: 0.42, found: false, glow: 0, t: 0,
      anchor: [cx, cy + r + 0.6, cz + r * 0.4], colour: hexToLinear(cr), exposure: 0,
    };
  }

  // Fraction of a find's probe cells that are open air.
  exposure(f: Find) {
    let e = 0;
    const p = f.probe;
    for (let k = 0; k < p.length; k++) if (this.mat[p[k]] === 0) e++;
    return p.length ? e / p.length : 1;
  }
}
