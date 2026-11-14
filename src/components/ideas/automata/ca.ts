// A 3D "Generations" cellular automaton on an odd n³ lattice.
//
// State 0 is empty, 1 is alive, 2..N-1 are ageing: a cell that stops being
// supported starts to age and cannot be reborn until it has fully faded.
// Only alive cells count as neighbours.
//
// Births are optionally stochastic, but the coin is tossed on a cell's
// *symmetry class* (its offset from the centre, folded by the chosen symmetry
// group) rather than on the cell itself. Every cell in a class gets the same
// coin, so a symmetric seed stays exactly symmetric, the way every arm of a
// snowflake sees the same weather, while growth slows and roughens like real
// crystal growth instead of racing outward at one cell per step.

export type Sym = 'oct' | 'tet' | 'mirror';

export type Rule = {
  name: string;
  S: number[]; // alive neighbour counts that keep an alive cell alive
  B: number[]; // alive neighbour counts that bring an empty cell to life
  N: number; // number of states
  M: boolean; // Moore (26) neighbourhood, else von Neumann (6)
  p: number; // birth probability per symmetry class per step
};

// The growth medium: births only happen inside an envelope that widens slowly,
// so forms grow at a contemplative pace and take on a crystal habit
// (octahedral, cubic or round) instead of hitting the walls of the lattice.
export type Habit = 'oct' | 'cube' | 'round';

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(a: number, b: number, c: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(c ^ 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export class Automaton {
  n: number;
  n2: number;
  n3: number;
  c: number;
  rule: Rule;
  sym: Sym;
  salt: number;
  g: Uint8Array; // current state
  prev: Uint8Array; // state before the last step
  cnt: Uint8Array;
  ao: Uint8Array; // occupied neighbours (of 26), for baked occlusion
  aoPrev: Uint8Array;
  cls: Int32Array; // symmetry class of each cell
  S = new Uint8Array(27);
  B = new Uint8Array(27);
  offs: Int32Array;
  offs26: Int32Array;
  active: Int32Array; // cells non-empty before or after the last step
  activeN = 0;
  pop = 0;
  alive = 0;
  ext = 0; // furthest occupied Chebyshev distance from the centre
  t = 0; // steps since seeding
  dissolving = false;
  sigs: number[] = [];
  dist: Float32Array;
  speed = 0.5; // envelope growth, cells per step
  r0 = 3;
  rmax: number;

  constructor(n: number, rule: Rule, sym: Sym, salt: number, habit: Habit = 'round') {
    this.n = n;
    this.n2 = n * n;
    this.n3 = n * n * n;
    this.c = (n - 1) >> 1;
    this.rule = rule;
    this.sym = sym;
    this.salt = salt;
    this.g = new Uint8Array(this.n3);
    this.prev = new Uint8Array(this.n3);
    this.cnt = new Uint8Array(this.n3);
    this.ao = new Uint8Array(this.n3);
    this.aoPrev = new Uint8Array(this.n3);
    this.active = new Int32Array(this.n3);
    for (const v of rule.S) this.S[v] = 1;
    for (const v of rule.B) this.B[v] = 1;
    const o: number[] = [];
    const o26: number[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy && !dz) continue;
          const off = dx + dy * n + dz * this.n2;
          o26.push(off);
          if (rule.M || Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1) o.push(off);
        }
    this.offs = Int32Array.from(o);
    this.offs26 = Int32Array.from(o26);
    this.cls = new Int32Array(this.n3);
    this.dist = new Float32Array(this.n3);
    this.rmax = this.c - 1.5;
    const K = this.c + 1;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          let a = Math.abs(x - this.c), b = Math.abs(y - this.c), d = Math.abs(z - this.c);
          if (sym === 'oct') {
            if (a < b) [a, b] = [b, a];
            if (b < d) [b, d] = [d, b];
            if (a < b) [a, b] = [b, a];
          } else if (sym === 'tet') {
            if (a < d) [a, d] = [d, a];
          }
          this.cls[x + y * n + z * this.n2] = (a * K + b) * K + d;
          this.dist[x + y * n + z * this.n2] =
            habit === 'oct' ? (a + b + d) * 0.62 : habit === 'cube' ? Math.max(a, b, d) : Math.hypot(a, b, d) * 0.9;
        }
  }

  idx(x: number, y: number, z: number) {
    return x + this.c + (y + this.c) * this.n + (z + this.c) * this.n2;
  }

  // Every image of (a, b, d) under the symmetry group.
  images(a: number, b: number, d: number): [number, number, number][] {
    const perms: [number, number, number][] =
      this.sym === 'oct'
        ? [[a, b, d], [b, d, a], [d, a, b], [b, a, d], [a, d, b], [d, b, a]]
        : this.sym === 'tet'
          ? [[a, b, d], [d, b, a]]
          : [[a, b, d]];
    const out: [number, number, number][] = [];
    for (const [x, y, z] of perms) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * x, sy * y, sz * z]);
    return out;
  }

  seed(r: () => number, rad: number, fill: number) {
    this.prev.set(this.g);
    this.aoPrev.set(this.ao);
    this.g.fill(0);
    let any = false;
    while (!any) {
      for (let a = 0; a <= rad; a++)
        for (let b = 0; b <= rad; b++)
          for (let d = 0; d <= rad; d++) {
            if (r() > fill) continue;
            any = true;
            for (const [x, y, z] of this.images(a, b, d)) this.g[this.idx(x, y, z)] = 1;
          }
    }
    this.t = 0;
    this.dissolving = false;
    this.sigs = [];
    this.salt = (this.salt + 0x51ed27) | 0;
    this.finish();
  }

  step() {
    const { n, n2, n3, g, prev, cnt, S, B, offs, cls } = this;
    const N = this.rule.N;
    const p = this.dissolving ? 0 : this.rule.p;
    prev.set(g);
    this.aoPrev.set(this.ao);
    cnt.fill(0);
    const lo = n2 + n + 1, hi = n3 - n2 - n - 1;
    for (let i = lo; i < hi; i++) if (prev[i] === 1) for (let k = 0; k < offs.length; k++) cnt[i + offs[k]]++;
    const t = this.t, salt = this.salt, dist = this.dist;
    const R = Math.min(this.rmax, this.r0 + this.speed * t);
    for (let i = 0; i < n3; i++) {
      const v = prev[i];
      let nv: number;
      if (v === 0) {
        nv = B[cnt[i]] && dist[i] <= R && (p >= 1 || hash3(cls[i], t, salt) < p) ? 1 : 0;
      } else if (v === 1) {
        nv = S[cnt[i]] && !(this.dissolving && hash3(cls[i], t, salt ^ 0x5bd1e995) < 0.3) ? 1 : N > 2 ? 2 : 0;
      } else nv = v + 1 >= N ? 0 : v + 1;
      g[i] = nv;
    }
    // the outer shell stays empty
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        g[a + b * n] = g[a + b * n + (n - 1) * n2] = 0;
        g[a + b * n2] = g[a + (n - 1) * n + b * n2] = 0;
        g[a * n + b * n2] = g[n - 1 + a * n + b * n2] = 0;
      }
    this.t++;
    this.finish();
  }

  private finish() {
    const { n, n2, n3, g, prev, ao, offs26 } = this;
    let pop = 0, alive = 0, ext = 0, sig = 0, k = 0;
    const c = this.c;
    for (let i = 0; i < n3; i++) {
      const v = g[i];
      if (v) {
        pop++;
        if (v === 1) alive++;
        sig = (Math.imul(sig, 31) + i * (v + 7)) | 0;
        const x = i % n, y = ((i / n) | 0) % n, z = (i / n2) | 0;
        const d = Math.max(Math.abs(x - c), Math.abs(y - c), Math.abs(z - c));
        if (d > ext) ext = d;
        let o = 0;
        for (let j = 0; j < 26; j++) if (g[i + offs26[j]]) o++;
        ao[i] = o;
      } else ao[i] = 0;
      if (v || prev[i]) this.active[k++] = i;
    }
    this.activeN = k;
    this.pop = pop;
    this.alive = alive;
    this.ext = ext;
    this.sigs.push(sig);
    if (this.sigs.length > 16) this.sigs.shift();
  }

  // True when the last few states repeat with a short period.
  stable() {
    const s = this.sigs, L = s.length;
    if (L < 12) return false;
    for (let per = 1; per <= 4; per++) {
      let ok = true;
      for (let i = L - 1; i >= L - 8; i--) if (s[i] !== s[i - per]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
}
