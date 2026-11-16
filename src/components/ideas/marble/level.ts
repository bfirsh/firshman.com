// Seeded labyrinth generator: rooms on a slot grid joined by stair-bridges.
// Produces a physics heightfield (0.5u cells) and a render voxel grid (0.25u).

export const C = 0.5; // physics / layout cell
export const V = 0.25; // render voxel
export const R = 0.34; // marble radius
export const WALL_H = 0.75;
export const Y0 = -7;
export const VY = 64;

export const K = { VOID: 0, FLOOR: 1, WALL: 2, RAMP: 3, GATE: 4 } as const;

export const M = {
  floorA: 1, floorB: 2, wall: 3, cap: 4, stone: 5, stoneDark: 6, rock1: 7, rock2: 8,
  window: 9, leaf1: 10, leaf2: 11, leaf3: 12, trunk: 13, fl1: 14, fl2: 15, fl3: 16,
  soil: 17, accent: 18, accent2: 19, hedge: 20, rim: 21, inlay: 22, vine: 23, tower: 24,
  trim: 25, water: 26, glow: 27,
} as const;

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type Side = 'x0' | 'x1' | 'z0' | 'z1';
export interface Door { side: Side; d: number }
export interface Room {
  k: number; sc: number; sr: number;
  x0: number; z0: number; x1: number; z1: number; h: number;
  plate: [number, number]; // cell of the plate's 2x2 top-left
  start: [number, number]; // corner node
  entrance?: Door; exit?: Door;
  towers: [number, number][]; // corner cells
  trees: [number, number, number][]; // voxel-space canopy centres (for fireflies)
  fountains: [number, number, number][]; // world x, y, z
  flags: [number, number, number][];
}
export interface Gate { k: number; cells: number[]; h: number; open: number; side: Side; d: number; room: number }
export interface Conn { axis: 0 | 1; d: number; c0: number; c1: number; uA: number; uB: number; hA: number; hB: number; a: number; s: number }
export type Prop =
  | { t: 'box'; a: [number, number, number]; b: [number, number, number]; m: number; ao?: number }
  | { t: 'rail'; p0: [number, number, number]; p1: [number, number, number]; w: number; hgt: number; m: number };

export interface Level {
  seed: number; cols: number; rows: number;
  nx: number; nz: number; ox: number; oz: number;
  kind: Uint8Array; H: Float32Array; rA: Float32Array; rS: Float32Array; rAx: Uint8Array;
  gateOf: Int16Array; roomOf: Int8Array;
  rooms: Room[]; gates: Gate[]; conns: Conn[];
  VX: number; VZ: number; vox: Uint8Array;
  props: Prop[];
  minY: number; maxY: number;
}

const SLOT = 12, GAP = 4, BORDER = 2;

function hamiltonianPaths(cols: number, rows: number) {
  const n = cols * rows;
  const out: number[][] = [];
  const nb = (i: number) => {
    const c = i % cols, r = (i / cols) | 0, res: number[] = [];
    if (c > 0) res.push(i - 1);
    if (c < cols - 1) res.push(i + 1);
    if (r > 0) res.push(i - cols);
    if (r < rows - 1) res.push(i + cols);
    return res;
  };
  const path: number[] = [], used = new Array(n).fill(false);
  const dfs = (i: number) => {
    path.push(i); used[i] = true;
    if (path.length === n) out.push(path.slice());
    else for (const j of nb(i)) if (!used[j]) dfs(j);
    path.pop(); used[i] = false;
  };
  for (let i = 0; i < n; i++) dfs(i);
  return out;
}

export function generate(seed: number, portrait: boolean): Level {
  const rnd = mulberry32(seed * 7919 + 13);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const cols = portrait ? 2 : 3, rows = portrait ? 3 : 2;
  const nx = BORDER * 2 + cols * SLOT + (cols - 1) * GAP;
  const nz = BORDER * 2 + rows * SLOT + (rows - 1) * GAP;
  const ox = -nx * C / 2, oz = -nz * C / 2;
  const N = nx * nz;
  const kind = new Uint8Array(N), H = new Float32Array(N).fill(-50);
  const rA = new Float32Array(N), rS = new Float32Array(N), rAx = new Uint8Array(N);
  const gateOf = new Int16Array(N).fill(-1), roomOf = new Int8Array(N).fill(-1);
  const ci = (i: number, j: number) => j * nx + i;

  // ---- path through the slots. Prefer starting on the camera-near side so the
  // climb heads away from the viewer (up and back into the scene).
  const paths = hamiltonianPaths(cols, rows);
  const scored = paths.map((p) => {
    const s = p[0], e = p[p.length - 1];
    const sr = (s / cols) | 0, er = (e / cols) | 0, sc = s % cols, ec = e % cols;
    return { p, w: (sr - er) * 1.2 + (sc - ec) * 0.4 + rnd() * 1.5 };
  });
  scored.sort((a, b) => b.w - a.w);
  const path = scored[Math.floor(rnd() * Math.min(4, scored.length))].p;

  // ---- rooms
  const rooms: Room[] = path.map((slot, k) => {
    const sc = slot % cols, sr = (slot / cols) | 0;
    const w = ri(9, 11), d = ri(9, 11);
    const sx = BORDER + sc * (SLOT + GAP), sz = BORDER + sr * (SLOT + GAP);
    const x0 = sx + ri(0, SLOT - w), z0 = sz + ri(0, SLOT - d);
    return { k, sc, sr, x0, z0, x1: x0 + w, z1: z0 + d, h: 0, plate: [0, 0], start: [0, 0], towers: [], trees: [], fountains: [], flags: [] };
  });

  // ---- doors and connectors
  const conns: Conn[] = [];
  for (let k = 0; k < rooms.length - 1; k++) {
    const A = rooms[k], B = rooms[k + 1];
    const horiz = A.sr === B.sr;
    const lo = horiz ? Math.max(A.z0, B.z0) : Math.max(A.x0, B.x0);
    const hi = horiz ? Math.min(A.z1, B.z1) : Math.min(A.x1, B.x1);
    const d = ri(lo + 2, Math.max(lo + 2, hi - 4));
    let c0: number, c1: number, uA: number, uB: number;
    if (horiz) {
      if (B.sc > A.sc) { A.exit = { side: 'x1', d }; B.entrance = { side: 'x0', d }; c0 = A.x1; c1 = B.x0; uA = ox + A.x1 * C; uB = ox + B.x0 * C; }
      else { A.exit = { side: 'x0', d }; B.entrance = { side: 'x1', d }; c0 = B.x1; c1 = A.x0; uA = ox + A.x0 * C; uB = ox + B.x1 * C; }
    } else {
      if (B.sr > A.sr) { A.exit = { side: 'z1', d }; B.entrance = { side: 'z0', d }; c0 = A.z1; c1 = B.z0; uA = oz + A.z1 * C; uB = oz + B.z0 * C; }
      else { A.exit = { side: 'z0', d }; B.entrance = { side: 'z1', d }; c0 = B.z1; c1 = A.z0; uA = oz + A.z0 * C; uB = oz + B.z1 * C; }
    }
    conns.push({ axis: horiz ? 0 : 1, d, c0, c1, uA, uB, hA: 0, hB: 0, a: 0, s: 0 });
  }
  // heights: a gentle spiral climb; slope never steeper than 0.125 per cell (14 deg)
  let h = 0;
  rooms[0].h = 0;
  for (let k = 0; k < conns.length; k++) {
    const cn = conns[k];
    const L = cn.c1 - cn.c0;
    const maxD = Math.min(1.0, Math.floor((0.125 * L) / 0.25 + 1e-6) * 0.25);
    const opts: number[] = [];
    for (let x = 0.25; x <= maxD + 1e-6; x += 0.25) opts.push(x);
    const dh = opts.length ? opts[Math.min(opts.length - 1, Math.floor(rnd() * opts.length + 0.6))] : 0.25;
    cn.hA = h; h += dh; cn.hB = h; rooms[k + 1].h = h;
    cn.s = (cn.hB - cn.hA) / (cn.uB - cn.uA);
    cn.a = cn.hA - cn.s * cn.uA;
  }

  // ---- room cells
  for (const r of rooms) {
    for (let j = r.z0; j < r.z1; j++) for (let i = r.x0; i < r.x1; i++) {
      const c = ci(i, j);
      roomOf[c] = r.k;
      const edge = i === r.x0 || i === r.x1 - 1 || j === r.z0 || j === r.z1 - 1;
      kind[c] = edge ? K.WALL : K.FLOOR;
      H[c] = edge ? r.h + WALL_H : r.h;
    }
  }
  const doorCells = (r: Room, dr: Door): [number, number][] => {
    const { side, d } = dr;
    if (side === 'x0') return [[r.x0, d], [r.x0, d + 1]];
    if (side === 'x1') return [[r.x1 - 1, d], [r.x1 - 1, d + 1]];
    if (side === 'z0') return [[d, r.z0], [d + 1, r.z0]];
    return [[d, r.z1 - 1], [d + 1, r.z1 - 1]];
  };
  const gates: Gate[] = [];
  for (const r of rooms) {
    if (r.entrance) for (const [i, j] of doorCells(r, r.entrance)) { kind[ci(i, j)] = K.FLOOR; H[ci(i, j)] = r.h; }
    if (r.exit) {
      const cells = doorCells(r, r.exit).map(([i, j]) => ci(i, j));
      const g: Gate = { k: gates.length, cells, h: r.h, open: 0, side: r.exit.side, d: r.exit.d, room: r.k };
      for (const c of cells) { kind[c] = K.GATE; H[c] = r.h + WALL_H; gateOf[c] = g.k; }
      gates.push(g);
    }
  }

  // ---- interiors: plate nook, obstacles, connectivity check
  for (const r of rooms) furnish(r);

  function walkable(i: number, j: number, r: Room) {
    if (i < r.x0 || j < r.z0 || i >= r.x1 || j >= r.z1) return false;
    const k = kind[ci(i, j)];
    return k === K.FLOOR || k === K.GATE; // gate cells count as the way out
  }
  function reach(r: Room, from: [number, number]) {
    const seen = new Set<number>();
    const q = [from];
    const ok = (i: number, j: number) => walkable(i - 1, j - 1, r) && walkable(i, j - 1, r) && walkable(i - 1, j, r) && walkable(i, j, r);
    if (!ok(from[0], from[1])) return seen;
    seen.add(ci(from[0], from[1]));
    while (q.length) {
      const [i, j] = q.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj, c = ci(a, b);
        if (!seen.has(c) && ok(a, b)) { seen.add(c); q.push([a, b]); }
      }
    }
    return seen;
  }
  function doorNode(r: Room, dr: Door): [number, number] {
    const { side, d } = dr;
    if (side === 'x0') return [r.x0 + 1, d + 1];
    if (side === 'x1') return [r.x1 - 1, d + 1];
    if (side === 'z0') return [d + 1, r.z0 + 1];
    return [d + 1, r.z1 - 1];
  }
  function doorApproach(r: Room, dr: Door) {
    // interior cells in front of a door that must stay clear
    const out: number[] = [];
    const { side, d } = dr;
    for (let t = -1; t <= 2; t++) for (let depth = 1; depth <= 3; depth++) {
      let i: number, j: number;
      if (side === 'x0') { i = r.x0 + depth; j = d + t; }
      else if (side === 'x1') { i = r.x1 - 1 - depth; j = d + t; }
      else if (side === 'z0') { i = d + t; j = r.z0 + depth; }
      else { i = d + t; j = r.z1 - 1 - depth; }
      out.push(ci(i, j));
    }
    return out;
  }

  function furnish(r: Room) {
    const ix0 = r.x0 + 1, ix1 = r.x1 - 2, iz0 = r.z0 + 1, iz1 = r.z1 - 2; // inclusive interior
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const keep = new Set<number>();
    if (r.entrance) doorApproach(r, r.entrance).forEach((c) => keep.add(c));
    if (r.exit) doorApproach(r, r.exit).forEach((c) => keep.add(c));
    const entryPt: [number, number] = r.entrance ? doorNode(r, r.entrance) : [Math.round(cx), Math.round(cz)];

    // plate: interior corner furthest from the way in, preferring the far (low z) side
    const corners: [number, number, number, number][] = [
      [ix0, iz0, 1, 1], [ix1 - 1, iz0, -1, 1], [ix0, iz1 - 1, 1, -1], [ix1 - 1, iz1 - 1, -1, -1],
    ];
    let best = corners[0], bestS = -1e9;
    for (const cn of corners) {
      const [px, pz] = cn;
      let clash = false;
      for (let a = -1; a <= 2; a++) for (let b = -1; b <= 2; b++) if (keep.has(ci(px + a, pz + b))) clash = true;
      const dist = Math.hypot(px + 1 - entryPt[0], pz + 1 - entryPt[1]);
      const far = (cz - (pz + 1)) * 0.35 + (cx - (px + 1)) * 0.12;
      const s = (r.k === 0 ? -Math.abs(dist - 6) : dist) + far + rnd() * 1.2 - (clash ? 100 : 0);
      if (s > bestS) { bestS = s; best = cn; }
    }
    const [px, pz, sx, sz] = best;
    r.plate = [px, pz];
    for (let a = -1; a <= 2; a++) for (let b = -1; b <= 2; b++) keep.add(ci(px + a, pz + b));
    // start (room 0): a spot a few cells from the plate
    if (r.k === 0) {
      const opts: [number, number][] = [];
      for (let j = iz0 + 1; j <= iz1; j++) for (let i = ix0 + 1; i <= ix1; i++) {
        const dd = Math.hypot(i - (px + 1), j - (pz + 1));
        if (dd > 4.5 && dd < 7.5) opts.push([i, j]);
      }
      r.start = opts.length ? opts[Math.floor(rnd() * opts.length)] : [Math.round(cx), Math.round(cz)];
      for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) keep.add(ci(r.start[0] + a, r.start[1] + b));
    } else r.start = entryPt;

    // nook stub: a short wall beside the plate so it sits in an alcove, opening toward the camera
    const stubAlongX = rnd() < 0.5; // which side to close
    const stub: number[] = [];
    if (stubAlongX) {
      const i = sx > 0 ? px + 2 : px - 1; // close the x side
      for (let b = 0; b < 2; b++) stub.push(ci(i, sz > 0 ? pz + b : pz + 1 - b));
    } else {
      const j = sz > 0 ? pz + 2 : pz - 1;
      for (let a = 0; a < 2; a++) stub.push(ci(sx > 0 ? px + a : px + 1 - a, j));
    }

    type Ob = { cells: number[]; type: string; i: number; j: number; w: number; d: number };
    const need: [number, number][] = [[px + 1, pz + 1]];
    if (r.exit) need.push(doorNode(r, r.exit));
    if (r.entrance) need.push(doorNode(r, r.entrance));
    let interiorNodes = 0;
    for (let j = iz0 + 1; j <= iz1; j++) for (let i = ix0 + 1; i <= ix1; i++) interiorNodes++;
    const flows = () => {
      const seen = reach(r, r.start);
      return need.every(([a, b]) => seen.has(ci(a, b))) && seen.size > interiorNodes * 0.45;
    };
    const obs: Ob[] = [];
    // the nook stub goes in first (kept only if the room still flows)
    for (const c of stub) kind[c] = K.WALL;
    if (flows()) obs.push({ cells: stub, type: 'stub', i: 0, j: 0, w: 0, d: 0 });
    else for (const c of stub) kind[c] = K.FLOOR;
    const occupied = new Set<number>(obs.length ? stub : []);
    const nObs = ri(2, 4) + obs.length;
    const types = ['bed', 'bed', 'fountain', 'pillar', 'topiary', 'stub'];
    for (let tries = 0; obs.length < nObs && tries < 60; tries++) {
      const type = types[Math.floor(rnd() * types.length)];
      let w = 1, d = 1;
      if (type === 'bed') { w = ri(2, 3); d = ri(2, 3); if (w * d > 6) d = 2; }
      if (type === 'fountain') { w = 2; d = 2; }
      if (type === 'stub') { if (rnd() < 0.5) { w = ri(2, 3); d = 1; } else { w = 1; d = ri(2, 3); } }
      const i0 = ri(ix0, ix1 - w + 1), j0 = ri(iz0, iz1 - d + 1);
      const cells: number[] = [];
      let bad = false;
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) {
        const c = ci(i0 + a, j0 + b);
        if (keep.has(c) || occupied.has(c)) bad = true;
        cells.push(c);
      }
      // keep a one-cell breathing gap around non-stub features
      if (!bad && type !== 'stub') {
        for (let b = -1; b <= d; b++) for (let a = -1; a <= w; a++) if (occupied.has(ci(i0 + a, j0 + b))) bad = true;
      }
      if (bad) continue;
      for (const c of cells) kind[c] = K.WALL;
      if (!flows()) { for (const c of cells) kind[c] = K.FLOOR; continue; }
      obs.push({ cells, type, i: i0, j: j0, w, d });
      cells.forEach((c) => occupied.add(c));
    }
    for (const o of obs) {
      const top = o.type === 'pillar' ? r.h + 1.1 : o.type === 'topiary' ? r.h + 1 : o.type === 'stub' ? r.h + WALL_H : r.h + 0.5;
      for (const c of o.cells) { kind[c] = K.WALL; H[c] = top; }
    }
    (r as any)._obs = obs;
    // towers on the far corners
    const far: [number, number][] = [[r.x0, r.z0], [r.x1 - 1, r.z0]];
    if (r.k === rooms.length - 1) r.towers = [far[Math.floor(rnd() * 2)]];
    else r.towers = rnd() < 0.6 ? [far[Math.floor(rnd() * 2)]] : [];
  }

  // ---- connector cells (ramps + rails)
  for (const cn of conns) {
    for (let c = cn.c0; c < cn.c1; c++) for (let t = -1; t <= 2; t++) {
      const lat = cn.d + t;
      const i = cn.axis === 0 ? c : lat, j = cn.axis === 0 ? lat : c;
      const cc = ci(i, j);
      const uc = (cn.axis === 0 ? ox : oz) + (c + 0.5) * C;
      if (t === -1 || t === 2) { kind[cc] = K.WALL; H[cc] = cn.a + cn.s * uc + 0.6; }
      else { kind[cc] = K.RAMP; rA[cc] = cn.a; rS[cc] = cn.s; rAx[cc] = cn.axis; H[cc] = Math.max(cn.a + cn.s * (uc - C / 2), cn.a + cn.s * (uc + C / 2)); }
    }
  }

  const level: Level = {
    seed, cols, rows, nx, nz, ox, oz, kind, H, rA, rS, rAx, gateOf, roomOf, rooms, gates, conns,
    VX: nx * 2, VZ: nz * 2, vox: new Uint8Array(nx * 2 * nz * 2 * VY), props: [], minY: 0, maxY: 0,
  };
  buildVoxels(level, rnd);
  return level;
}

// -------------------------------------------------------------------------------------------
function buildVoxels(L: Level, rnd: () => number) {
  const { VX, VZ, vox, ox, oz } = L;
  const vi = (a: number, k: number, b: number) => (k * VZ + b) * VX + a;
  const inb = (a: number, k: number, b: number) => a >= 0 && b >= 0 && k >= 0 && a < VX && b < VZ && k < VY;
  const set = (a: number, k: number, b: number, m: number) => { if (inb(a, k, b)) vox[vi(a, k, b)] = m; };
  const get = (a: number, k: number, b: number) => (inb(a, k, b) ? vox[vi(a, k, b)] : 0);
  const fill = (a0: number, a1: number, k0: number, k1: number, b0: number, b1: number, m: number) => {
    for (let k = k0; k < k1; k++) for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) set(a, k, b, m);
  };
  const lay = (y: number) => Math.round((y - Y0) / V);
  const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const props = L.props;
  const wx = (a: number) => ox + a * V, wz = (b: number) => oz + b * V, wy = (k: number) => Y0 + k * V;
  let minK = VY, maxK = 0;

  const blob = (cx: number, cy: number, cz: number, rad: number, mats: number[], squash = 1) => {
    const r2 = Math.ceil(rad + 1);
    for (let k = Math.floor(cy - r2); k <= cy + r2; k++) for (let b = Math.floor(cz - r2); b <= cz + r2; b++) for (let a = Math.floor(cx - r2); a <= cx + r2; a++) {
      const dx = a + 0.5 - cx, dy = (k + 0.5 - cy) / squash, dz = b + 0.5 - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + (hash3(a, k, b) - 0.5) * 0.9;
      if (d < rad && get(a, k, b) === 0) {
        const n = hash3(a * 3, k * 5, b * 7);
        const m = dy > rad * 0.25 ? mats[2] : n < 0.5 ? mats[0] : mats[1];
        set(a, k, b, m);
      }
    }
  };
  const tree = (r: Room, a: number, kBase: number, b: number, big = false) => {
    const cypress = !big && rnd() < 0.35;
    const tall = cypress ? 1 : big ? ri(3, 4) : ri(2, 3);
    fill(a, a + 1, kBase, kBase + tall, b, b + 1, M.trunk);
    if (cypress) {
      blob(a + 0.5, kBase + tall + 2.6, b + 0.5, 1.6, [M.leaf2, M.leaf1, M.leaf3], 2.1);
      r.trees.push([wx(a + 0.5), wy(kBase + tall + 3), wz(b + 0.5)]);
      return;
    }
    const rad = big ? 2.9 : 2.3 + rnd() * 0.5;
    const cy = kBase + tall + rad * 0.7;
    blob(a + 0.5, cy, b + 0.5, rad, [M.leaf1, M.leaf2, M.leaf3], 0.82);
    // a couple of smaller lobes so the crown isn't a perfect ball
    for (let l = 0, nl = big ? 3 : 2; l < nl; l++) {
      const ang = rnd() * Math.PI * 2;
      blob(a + 0.5 + Math.cos(ang) * rad * 0.7, cy + rad * (0.1 + rnd() * 0.35), b + 0.5 + Math.sin(ang) * rad * 0.7, rad * 0.62, [M.leaf1, M.leaf2, M.leaf3], 0.85);
    }
    r.trees.push([wx(a + 0.5), wy(cy + 1), wz(b + 0.5)]);
  };

  for (const r of L.rooms) {
    const kF = lay(r.h); // first layer above floor
    const T = 6; // platform thickness in voxels
    const kB = kF - T;
    const a0 = r.x0 * 2, a1 = r.x1 * 2, b0 = r.z0 * 2, b1 = r.z1 * 2;
    minK = Math.min(minK, kB - 12); maxK = Math.max(maxK, kF + 14);
    // platform body
    fill(a0, a1, kB, kF - 1, b0, b1, M.stone);
    for (let j = r.z0; j < r.z1; j++) for (let i = r.x0; i < r.x1; i++) {
      const m = (i + j) & 1 ? M.floorA : M.floorB;
      fill(i * 2, i * 2 + 2, kF - 1, kF, j * 2, j * 2 + 2, m);
    }
    // inlay ring around the plate
    {
      const [px, pz] = r.plate;
      for (let j = pz - 1; j <= pz + 2; j++) for (let i = px - 1; i <= px + 2; i++) {
        const c = j * L.nx + i;
        if (L.kind[c] !== K.FLOOR) continue;
        const ring = i === px - 1 || i === px + 2 || j === pz - 1 || j === pz + 2;
        fill(i * 2, i * 2 + 2, kF - 1, kF, j * 2, j * 2 + 2, ring ? M.inlay : M.rim);
      }
    }
    // cornice + plinth bands (protruding one voxel)
    for (let b = b0 - 1; b <= b1; b++) for (let a = a0 - 1; a <= a1; a++) {
      if (a >= a0 && a < a1 && b >= b0 && b < b1) continue;
      set(a, kF - 2, b, M.trim);
      set(a, kB, b, M.stoneDark);
      const n = hash3(a, 11, b);
      if (n < 0.16) set(a, kF - 1, b, n < 0.025 ? M.fl3 : n < 0.04 ? M.fl1 : n < 0.1 ? M.leaf1 : M.leaf2);
    }
    // facade windows: small arched recesses on every outer face
    const facade = (len: number, at: (t: number) => [number, number, number, number]) => {
      for (let t = 3; t < len - 3; t++) {
        if (t % 4 !== 1) continue;
        const [a, b, ia, ib] = at(t);
        if (get(a, kF - 3, b) !== M.stone) continue;
        for (let k = kB + 2; k <= kB + 3; k++) { set(a, k, b, 0); set(ia, k, ib, M.window); }
      }
    };
    facade(a1 - a0, (t) => [a0 + t, b1 - 1, a0 + t, b1 - 2]);
    facade(a1 - a0, (t) => [a0 + t, b0, a0 + t, b0 + 1]);
    facade(b1 - b0, (t) => [a1 - 1, b0 + t, a1 - 2, b0 + t]);
    facade(b1 - b0, (t) => [a0, b0 + t, a0 + 1, b0 + t]);
    // walls
    for (let j = r.z0; j < r.z1; j++) for (let i = r.x0; i < r.x1; i++) {
      const c = j * L.nx + i;
      const edge = i === r.x0 || i === r.x1 - 1 || j === r.z0 || j === r.z1 - 1;
      if (!edge || L.kind[c] !== K.WALL) continue;
      fill(i * 2, i * 2 + 2, kF, kF + 2, j * 2, j * 2 + 2, M.wall);
      fill(i * 2, i * 2 + 2, kF + 2, kF + 3, j * 2, j * 2 + 2, M.cap);
    }
    // gateposts either side of each doorway, with a little accent finial
    for (const dr of [r.entrance, r.exit]) {
      if (!dr) continue;
      const isExit = dr === r.exit;
      const { side, d } = dr;
      const alongZ = side === 'x0' || side === 'x1';
      const wallI = side === 'x0' ? r.x0 : side === 'x1' ? r.x1 - 1 : side === 'z0' ? r.z0 : r.z1 - 1;
      for (const t of [-1, 2]) {
        const lat = d + t;
        const i2 = alongZ ? wallI * 2 : lat * 2, j2 = alongZ ? lat * 2 : wallI * 2;
        fill(i2, i2 + 2, kF + 2, kF + 4, j2, j2 + 2, M.wall);
        for (let bb = j2 - 1; bb <= j2 + 2; bb++) for (let aa = i2 - 1; aa <= i2 + 2; aa++) if (!get(aa, kF + 4, bb)) set(aa, kF + 4, bb, M.cap);
        if (isExit) props.push({ t: 'box', a: [wx(i2 + 0.6), wy(kF + 5), wz(j2 + 0.6)], b: [wx(i2 + 1.4), wy(kF + 5) + 0.18, wz(j2 + 1.4)], m: M.accent, ao: 0.9 });
      }
    }
    // towers
    const last = r.k === L.rooms.length - 1;
    for (const [ti, tj] of r.towers) {
      const ta0 = ti === r.x0 ? ti * 2 - 2 : ti * 2, tb0 = tj === r.z0 ? tj * 2 - 2 : tj * 2;
      const tall = last ? ri(11, 13) : r.sr === 0 ? ri(7, 10) : ri(5, 6);
      const top = kF + tall;
      fill(ta0, ta0 + 4, kB - 2, top, tb0, tb0 + 4, M.tower);
      // bands and slit windows
      for (let k = kB - 2; k < top; k++) {
        if ((k - kF) % 4 === 3) for (let b = tb0 - 1; b <= tb0 + 4; b++) for (let a = ta0 - 1; a <= ta0 + 4; a++) {
          if (a >= ta0 && a < ta0 + 4 && b >= tb0 && b < tb0 + 4) continue;
          if ((a === ta0 - 1 || a === ta0 + 4) && (b === tb0 - 1 || b === tb0 + 4)) continue;
          set(a, k, b, M.trim);
        }
      }
      for (let k = kF + 1; k < top - 2; k += 4) {
        // window on the two camera-facing faces (+x, +z) and the others
        set(ta0 + 1, k, tb0 + 3, M.window); set(ta0 + 1, k + 1, tb0 + 3, M.window);
        set(ta0 + 3, k, tb0 + 2, M.window); set(ta0 + 3, k + 1, tb0 + 2, M.window);
        set(ta0 + 2, k, tb0, M.window); set(ta0, k, tb0 + 1, M.window);
      }
      // roof: eave, stepped pyramid, finial
      for (let b = tb0 - 1; b <= tb0 + 4; b++) for (let a = ta0 - 1; a <= ta0 + 4; a++) set(a, top, b, M.accent);
      fill(ta0, ta0 + 4, top + 1, top + 2, tb0, tb0 + 4, M.accent);
      fill(ta0 + 1, ta0 + 3, top + 2, top + 4, tb0 + 1, tb0 + 3, M.accent);
      props.push({ t: 'box', a: [wx(ta0 + 1.75), wy(top + 4), wz(tb0 + 1.75)], b: [wx(ta0 + 2.25), wy(top + 4) + 0.35, wz(tb0 + 2.25)], m: M.accent2, ao: 1 });
      props.push({ t: 'box', a: [wx(ta0 + 1.94), wy(top + 4) + 0.35, wz(tb0 + 1.94)], b: [wx(ta0 + 2.06), wy(top + 4) + 0.95, wz(tb0 + 2.06)], m: M.trunk, ao: 1 });
      r.flags.push([wx(ta0 + 2), wy(top + 4) + 0.92, wz(tb0 + 2)]);
      maxK = Math.max(maxK, top + 6);
    }
    // obstacles
    const obs = (r as any)._obs as { cells: number[]; type: string; i: number; j: number; w: number; d: number }[];
    for (const o of obs) {
      if (o.type === 'stub') {
        for (const c of o.cells) {
          const i = c % L.nx, j = (c / L.nx) | 0;
          fill(i * 2, i * 2 + 2, kF, kF + 2, j * 2, j * 2 + 2, M.wall);
          fill(i * 2, i * 2 + 2, kF + 2, kF + 3, j * 2, j * 2 + 2, M.cap);
        }
      } else if (o.type === 'pillar') {
        const a = o.i * 2, b = o.j * 2;
        fill(a, a + 2, kF, kF + 4, b, b + 2, M.tower);
        for (let bb = b - 1; bb <= b + 2; bb++) for (let aa = a - 1; aa <= a + 2; aa++) set(aa, kF + 4, bb, M.cap);
        fill(a, a + 2, kF, kF + 1, b, b + 2, M.trim);
        props.push({ t: 'box', a: [wx(a + 0.75), wy(kF + 5), wz(b + 0.75)], b: [wx(a + 1.25), wy(kF + 5) + 0.16, wz(b + 1.25)], m: M.glow, ao: 0 });
      } else if (o.type === 'topiary') {
        const a = o.i * 2, b = o.j * 2;
        fill(a, a + 2, kF, kF + 1, b, b + 2, M.rim);
        blob(a + 1, kF + 2.4, b + 1, 1.7, [M.hedge, M.leaf2, M.leaf3], 1.15);
      } else if (o.type === 'fountain') {
        const a = o.i * 2, b = o.j * 2;
        for (let bb = b; bb < b + 4; bb++) for (let aa = a; aa < a + 4; aa++) {
          const rim = aa === a || aa === a + 3 || bb === b || bb === b + 3;
          if (rim) fill(aa, aa + 1, kF, kF + 2, bb, bb + 1, M.rim);
          else set(aa, kF, bb, M.water);
        }
        // a little tiered spout
        props.push({ t: 'box', a: [wx(a + 1.75), wy(kF + 1), wz(b + 1.75)], b: [wx(a + 2.25), wy(kF + 2) + 0.12, wz(b + 2.25)], m: M.rim, ao: 0.85 });
        props.push({ t: 'box', a: [wx(a + 1.35), wy(kF + 2) + 0.12, wz(b + 1.35)], b: [wx(a + 2.65), wy(kF + 2) + 0.2, wz(b + 2.65)], m: M.rim, ao: 0.9 });
        props.push({ t: 'box', a: [wx(a + 1.5), wy(kF + 2) + 0.2, wz(b + 1.5)], b: [wx(a + 2.5), wy(kF + 2) + 0.22, wz(b + 2.5)], m: M.water, ao: 1 });
        props.push({ t: 'box', a: [wx(a + 1.88), wy(kF + 2) + 0.2, wz(b + 1.88)], b: [wx(a + 2.12), wy(kF + 2) + 0.36, wz(b + 2.12)], m: M.rim, ao: 1 });
        r.fountains.push([wx(a + 2), wy(kF + 2) + 0.38, wz(b + 2)]);
      } else if (o.type === 'bed') {
        const a = o.i * 2, b = o.j * 2, w = o.w * 2, d = o.d * 2;
        for (let bb = b; bb < b + d; bb++) for (let aa = a; aa < a + w; aa++) {
          const rim = aa === a || aa === a + w - 1 || bb === b || bb === b + d - 1;
          if (rim) fill(aa, aa + 1, kF, kF + 2, bb, bb + 1, M.hedge);
          else {
            set(aa, kF, bb, M.soil);
            const n = hash3(aa, kF, bb);
            if (n < 0.55) set(aa, kF + 1, bb, n < 0.18 ? M.fl1 : n < 0.36 ? M.fl2 : M.fl3);
          }
        }
        if (w * d >= 16 || rnd() < 0.6) tree(r, a + Math.floor(w / 2) - (w % 2 ? 0 : rnd() < 0.5 ? 1 : 0), kF + 1, b + Math.floor(d / 2), o.w * o.d >= 6);
      }
    }
    // roots: a tapered, striated underside
    const D = ri(7, 12);
    const cxv = (a0 + a1) / 2, czv = (b0 + b1) / 2, hw = (a1 - a0) / 2 + 1, hd = (b1 - b0) / 2 + 1;
    for (let b = b0 - 1; b <= b1; b++) for (let a = a0 - 1; a <= a1; a++) {
      const nx = Math.abs(a + 0.5 - cxv) / hw, nz = Math.abs(b + 0.5 - czv) / hd;
      const n = Math.pow(Math.pow(nx, 3) + Math.pow(nz, 3), 1 / 3);
      if (n >= 1) continue;
      const lump = 0.65 + 0.7 * hash3(a >> 1, 7, b >> 1) * 0.6 + 0.4 * hash3(a, 3, b);
      const depth = Math.round(D * Math.pow(1 - n, 0.75) * lump);
      for (let t = 1; t <= depth; t++) {
        const k = kB - t;
        const band = ((k + Math.floor(hash3(a >> 2, 1, b >> 2) * 2)) % 3 + 3) % 3;
        set(a, k, b, band === 0 ? M.rock2 : t < 2 ? M.stoneDark : M.rock1);
      }
    }
    // vines hanging off the cornice
    for (let t = 0, n = ri(6, 11); t < n; t++) {
      const side = ri(0, 3);
      let a: number, b: number;
      if (side === 0) { a = ri(a0, a1 - 1); b = b1; }
      else if (side === 1) { a = a1; b = ri(b0, b1 - 1); }
      else if (side === 2) { a = ri(a0, a1 - 1); b = b0 - 1; }
      else { a = a0 - 1; b = ri(b0, b1 - 1); }
      const len = ri(2, 7);
      for (let k = kF - 2; k > kF - 2 - len; k--) if (get(a, k, b) === 0 || k === kF - 2) set(a, k, b, M.vine);
      if (rnd() < 0.5) set(a, kF - 2 - len, b, rnd() < 0.5 ? M.fl1 : M.fl3);
    }
  }

  // ---- bridges (stair decks with arched undersides)
  for (const cn of L.conns) {
    const len = cn.c1 - cn.c0;
    for (let c = cn.c0; c < cn.c1; c++) for (let t = -1; t <= 2; t++) {
      const lat = cn.d + t;
      const i = cn.axis === 0 ? c : lat, j = cn.axis === 0 ? lat : c;
      const u0 = (cn.axis === 0 ? ox : oz) + c * C;
      const hMin = Math.min(cn.a + cn.s * u0, cn.a + cn.s * (u0 + C));
      const kTop = Math.floor((hMin - Y0) / V + 1e-6);
      const tt = (c + 0.5 - cn.c0) / len;
      const thick = 2 + Math.round(5 * Math.pow(Math.abs(2 * tt - 1), 2.2));
      const side = t === -1 || t === 2;
      fill(i * 2, i * 2 + 2, kTop - thick, kTop, j * 2, j * 2 + 2, side ? M.trim : M.stone);
      if (!side) {
        // tiny stairs: four steps per cell, two lanes of tread colour
        for (let s = 0; s < 4; s++) {
          const ua = u0 + s * (C / 4), ub = ua + C / 4;
          const hs = cn.a + cn.s * (ua + ub) / 2 + 0.012;
          const m = s % 2 ? M.floorA : M.floorB;
          if (cn.axis === 0) props.push({ t: 'box', a: [ua, wy(kTop), oz + j * C], b: [ub, hs, oz + (j + 1) * C], m, ao: 0.82 });
          else props.push({ t: 'box', a: [ox + i * C, wy(kTop), ua], b: [ox + (i + 1) * C, hs, ub], m, ao: 0.82 });
        }
      } else {
        // curb under the balustrade
        const hc = cn.a + cn.s * (u0 + C / 2) + 0.06;
        const inset = 0.06;
        if (cn.axis === 0) props.push({ t: 'box', a: [u0, wy(kTop), oz + j * C + inset], b: [u0 + C, hc, oz + (j + 1) * C - inset], m: M.cap, ao: 0.8 });
        else props.push({ t: 'box', a: [ox + i * C + inset, wy(kTop), u0], b: [ox + (i + 1) * C - inset, hc, u0 + C], m: M.cap, ao: 0.8 });
        // posts
        for (let q = 0; q < 2; q++) {
          const up = u0 + C * (0.25 + q * 0.5);
          const hp = cn.a + cn.s * up;
          const lc = (cn.axis === 0 ? oz + (j + 0.5) * C : ox + (i + 0.5) * C);
          const pw = 0.045;
          if (cn.axis === 0) props.push({ t: 'box', a: [up - pw, hp, lc - pw], b: [up + pw, hp + 0.46, lc + pw], m: M.wall, ao: 0.85 });
          else props.push({ t: 'box', a: [lc - pw, hp, up - pw], b: [lc + pw, hp + 0.46, up + pw], m: M.wall, ao: 0.85 });
        }
      }
    }
    // handrails
    for (const t of [-1, 2]) {
      const lat = cn.d + t;
      const lc = (cn.axis === 0 ? oz : ox) + (lat + 0.5) * C;
      const u0 = (cn.axis === 0 ? ox : oz) + cn.c0 * C, u1 = (cn.axis === 0 ? ox : oz) + cn.c1 * C;
      const h0 = cn.a + cn.s * u0 + 0.5, h1 = cn.a + cn.s * u1 + 0.5;
      const p0: [number, number, number] = cn.axis === 0 ? [u0, h0, lc] : [lc, h0, u0];
      const p1: [number, number, number] = cn.axis === 0 ? [u1, h1, lc] : [lc, h1, u1];
      props.push({ t: 'rail', p0, p1, w: 0.12, hgt: 0.07, m: M.cap });
    }
  }
  L.minY = wy(Math.max(0, minK));
  L.maxY = wy(Math.min(VY, maxK));
}
