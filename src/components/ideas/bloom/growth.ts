// Diffusion-limited aggregation on a cubic lattice.
//
// Walkers wander until they touch the structure and stick. Growth is confined
// to a thin plane, because that is how the most striking natural accretions
// look: a gorgonian sea fan is a flat lace held across the current, fern frost
// spreads across a pane, and a snow crystal is a plate. In 3D a plain DLA
// cluster reads as a fuzzy ball; in a plane it reads as a drawing.
//
//  - fan:   rooted on the ground. Walkers settle slowly downward and the
//           ground absorbs those that miss, so it branches up and out.
//  - frost: a floating plate.
//
// With "noise reduction" (a site fills only after several contacts) the
// lace turns crystalline: straight dendrites with side-branches along the
// lattice axes, as cubic crystals grow.

import type { Form } from './palettes';

export type GrowthParams = {
  form: Form;
  stick: number; // chance of sticking on contact
  hits: number; // contacts a site needs before it fills
  drift: number; // downward bias per step (rooted forms)
  slab: number; // plane half-thickness
  maxR: number;
};

const G = 128;
const G2 = G * G;

export class Growth {
  occ = new Uint8Array(G * G2);
  adj = new Uint8Array(G * G2);
  cnt = new Uint8Array(G * G2);
  xs: Int16Array;
  ys: Int16Array;
  zs: Int16Array;
  n = 0;
  rMax = 0;
  full = false;
  cx = G >> 1;
  cy = 0;
  cz = G >> 1;
  rooted: boolean;
  cap: number;
  p: GrowthParams;
  private rng: () => number;
  private wx = 0;
  private wy = 0;
  private wz = 0;
  private alive = false;

  constructor(cap: number, p: GrowthParams, rng: () => number) {
    this.cap = cap;
    this.p = p;
    this.rng = rng;
    this.xs = new Int16Array(cap);
    this.ys = new Int16Array(cap);
    this.zs = new Int16Array(cap);
    this.rooted = p.form === 'fan';
    this.reset();
  }

  reset() {
    this.occ.fill(0);
    this.adj.fill(0);
    this.cnt.fill(0);
    this.n = 0;
    this.rMax = 0;
    this.full = false;
    this.alive = false;
    this.cy = this.rooted ? 0 : G >> 1;
    const { cx, cy, cz } = this;
    if (this.rooted) {
      // a small holdfast
      this.add(cx, 0, cz);
      this.add(cx, 1, cz);
      this.add(cx - 1, 0, cz);
      this.add(cx + 1, 0, cz);
    } else {
      this.add(cx, cy, cz);
    }
  }

  private add(x: number, y: number, z: number) {
    const i = (y * G + z) * G + x;
    if (this.occ[i] || this.n >= this.cap) return;
    this.occ[i] = 1;
    if (x > 0) this.adj[i - 1]++;
    if (x < G - 1) this.adj[i + 1]++;
    if (z > 0) this.adj[i - G]++;
    if (z < G - 1) this.adj[i + G]++;
    if (y > 0) this.adj[i - G2]++;
    if (y < G - 1) this.adj[i + G2]++;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.zs[this.n] = z;
    this.n++;
    const dx = x - this.cx, dy = y - this.cy, dz = z - this.cz;
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (r > this.rMax) this.rMax = r;
    if (this.rMax >= this.p.maxR || this.n >= this.cap) this.full = true;
  }

  private launch() {
    const rng = this.rng;
    const rl = this.rMax + 5;
    const a = this.rooted ? rng() * Math.PI : rng() * Math.PI * 2;
    this.wx = Math.round(this.cx + Math.cos(a) * rl);
    this.wy = Math.round(this.cy + Math.sin(a) * rl);
    this.wz = this.cz + Math.round((rng() * 2 - 1) * this.p.slab);
    this.alive = true;
  }

  // Walks until one voxel sticks (returns true) or the step budget runs out.
  run(budget: number): boolean {
    if (this.full) return false;
    const { occ, adj, cnt, rng } = this;
    const { stick, hits, drift } = this.p;
    const rooted = this.rooted;
    const slab = this.p.slab;
    const cx = this.cx, cy = this.cy, cz = this.cz;
    if (!this.alive) this.launch();
    let x = this.wx, y = this.wy, z = this.wz;
    const kill = this.rMax * 1.5 + 18;
    const kill2 = kill * kill;
    const near = this.rMax + 6;
    for (let s = 0; s < budget; s++) {
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > kill2) { this.launch(); x = this.wx; y = this.wy; z = this.wz; continue; }
      // far away: take a long stride, since nothing can happen until we get close
      let L = 1;
      if (d2 > near * near) L = Math.max(1, (Math.sqrt(d2) - this.rMax - 4) | 0);
      let nx = x, ny = y, nz = z;
      if (drift > 0 && rng() < drift) {
        ny -= L;
      } else {
        const r = (rng() * 6) | 0;
        if (r === 0) nx += L; else if (r === 1) nx -= L;
        else if (r === 2) ny += L; else if (r === 3) ny -= L;
        else if (r === 4) nz += L; else nz -= L;
      }
      if (rooted && ny < 0) { this.launch(); x = this.wx; y = this.wy; z = this.wz; continue; }
      if (nx < 1 || ny < 0 || nz < 1 || nx > G - 2 || ny > G - 2 || nz > G - 2) { this.launch(); x = this.wx; y = this.wy; z = this.wz; continue; }
      if (Math.abs(nz - cz) > slab) continue;
      const i = (ny * G + nz) * G + nx;
      if (occ[i]) continue;
      x = nx; y = ny; z = nz;
      if (adj[i]) {
        if (cnt[i] < 255) cnt[i]++;
        if (cnt[i] >= hits && rng() < stick) {
          this.alive = false;
          this.add(x, y, z);
          return true;
        }
      }
    }
    this.wx = x; this.wy = y; this.wz = z;
    return false;
  }

  // Baked ambient occlusion: how buried each voxel is in its neighbourhood.
  ao(out: Float32Array) {
    const { occ, xs, ys, zs } = this;
    for (let k = 0; k < this.n; k++) {
      const x = xs[k], y = ys[k], z = zs[k];
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0) { if (this.rooted) s += 2.5; continue; }
        if (yy >= G) continue;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= G) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= G || (dx === 0 && dy === 0 && dz === 0)) continue;
            if (occ[(yy * G + zz) * G + xx]) {
              const m = (dx ? 1 : 0) + (dy ? 1 : 0) + (dz ? 1 : 0);
              s += m === 1 ? 1 : m === 2 ? 0.6 : 0.4;
            }
          }
        }
      }
      let far = 0;
      for (const [ax, ay, az] of FAR) {
        const xx = x + ax, yy = y + ay, zz = z + az;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= G || yy >= G || zz >= G) continue;
        if (occ[(yy * G + zz) * G + xx]) far++;
      }
      const v = 1 - Math.min(1, s / 6) * 0.3 - Math.min(1, far / 8) * 0.25;
      out[k * 3] = out[k * 3 + 1] = out[k * 3 + 2] = Math.max(0.3, v);
    }
  }
}

const FAR: [number, number, number][] = [];
for (let z = -2; z <= 2; z += 2) for (let y = -2; y <= 2; y += 2) for (let x = -2; x <= 2; x += 2) if (x || y || z) FAR.push([x, y, z]);
