// Tiny voxel sculptures for the dioramas, a 5x7 voxel font, and the
// 6x6 emblems engraved on each face's centre sticker.
// Coordinates are in "cells" (half a cube voxel). y is up, z is out of the
// face toward the viewer, x is to the right.

// Colour slots, resolved against the per-visit palette.
export const F = [0, 1, 2, 3, 4, 5]; // face colours, in +x -x +y -y +z -z order
export const PL = 6; // plastic (cubie body)
export const IN = 7; // inner plastic
export const CR = 8; // cream
export const INK = 9;
export const GD = 10; // gold
export const GL = 11; // light (emissive)

export type Anim =
  | { kind: 'bob'; amp: number; speed: number; phase: number }
  | { kind: 'spin'; axis: 'y' | 'z'; cx: number; cy: number; cz: number; speed: number }
  | { kind: 'blink'; speed: number };

export type Cell = { x: number; y: number; z: number; c: number; g: number; a: number };
export type Figure = { cells: Cell[]; anims: Anim[]; min: [number, number, number]; max: [number, number, number] };

class Builder {
  map = new Map<string, Cell>();
  anims: Anim[] = [];
  cur = -1; // current anim index
  glow = 0;
  set(x: number, y: number, z: number, c: number, g = this.glow) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    this.map.set(x + ',' + y + ',' + z, { x, y, z, c, g: c === GL ? Math.max(g, 1) : g, a: this.cur });
  }
  del(x: number, y: number, z: number) { this.map.delete(Math.round(x) + ',' + Math.round(y) + ',' + Math.round(z)); }
  has(x: number, y: number, z: number) { return this.map.has(x + ',' + y + ',' + z); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.set(x, y, z, c);
  }
  ell(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number | ((x: number, y: number, z: number) => number)) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d <= 1) this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
        }
  }
  cylY(cx: number, cz: number, y0: number, y1: number, r: number | ((y: number) => number), c: number | ((x: number, y: number, z: number) => number)) {
    for (let y = y0; y <= y1; y++) {
      const rr = typeof r === 'function' ? r(y) : r;
      for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++)
        for (let z = Math.floor(cz - rr); z <= Math.ceil(cz + rr); z++)
          if ((x - cx) ** 2 + (z - cz) ** 2 <= rr * rr) this.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
    }
  }
  text(str: string, x: number, y: number, z0: number, z1: number, c: number) {
    let cx = x;
    for (const ch of str) {
      const g = FONT[ch];
      if (!g) { cx += 4; continue; }
      const w = g[0].length;
      for (let r = 0; r < 7; r++)
        for (let k = 0; k < w; k++)
          if (g[r][k] === '#') for (let z = z0; z <= z1; z++) this.set(cx + k, y + 6 - r, z, c);
      cx += w + 1;
    }
  }
  anim(a: Anim | null) {
    if (!a) { this.cur = -1; return; }
    this.anims.push(a);
    this.cur = this.anims.length - 1;
  }
  done(surfaceOnly = true): Figure {
    const cells: Cell[] = [];
    const min: [number, number, number] = [1e9, 1e9, 1e9];
    const max: [number, number, number] = [-1e9, -1e9, -1e9];
    for (const c of this.map.values()) {
      if (surfaceOnly &&
        this.has(c.x + 1, c.y, c.z) && this.has(c.x - 1, c.y, c.z) &&
        this.has(c.x, c.y + 1, c.z) && this.has(c.x, c.y - 1, c.z) &&
        this.has(c.x, c.y, c.z + 1) && this.has(c.x, c.y, c.z - 1)) continue;
      cells.push(c);
      min[0] = Math.min(min[0], c.x); min[1] = Math.min(min[1], c.y); min[2] = Math.min(min[2], c.z);
      max[0] = Math.max(max[0], c.x); max[1] = Math.max(max[1], c.y); max[2] = Math.max(max[2], c.z);
    }
    return { cells, anims: this.anims, min, max };
  }
}

export const textWidth = (s: string) => {
  let w = 0;
  for (const ch of s) w += (FONT[ch] ? FONT[ch][0].length : 3) + 1;
  return w - 1;
};

export const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
};

// ---------- figures ----------

function crate(b: Builder, x0: number, y0: number, z0: number, w: number, h: number, d: number, c: number, edge: number) {
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      for (let z = 0; z < d; z++) {
        const ex = x === 0 || x === w - 1, ey = y === 0 || y === h - 1, ez = z === 0 || z === d - 1;
        const edges = (ex ? 1 : 0) + (ey ? 1 : 0) + (ez ? 1 : 0);
        b.set(x0 + x, y0 + y, z0 + z, edges >= 2 ? edge : c);
      }
}

const FIGS: Record<string, () => Figure> = {
  cloud() {
    const b = new Builder();
    // a stepped tower with a glowing core, and a cloud above it
    b.box(-7, 0, -7, 7, 0, 7, PL);
    b.box(-6, 1, -6, 6, 4, 6, F[4]);
    for (let y = 1; y <= 4; y += 3) for (let i = -5; i <= 5; i += 2) { b.set(i, y + 0, 6, CR); b.set(6, y + 0, i, CR); b.set(-6, y, i, CR); b.set(i, y, -6, CR); }
    b.box(-5, 5, -5, 5, 5, 5, PL);
    b.box(-4, 6, -4, 4, 9, 4, F[0]);
    for (let i = -3; i <= 3; i += 2) { b.set(i, 7, 4, GL); b.set(4, 7, i, GL); b.set(-4, 7, i, GL); }
    b.box(-3, 10, -3, 3, 10, 3, PL);
    b.box(-1, 11, -1, 1, 12, 1, GL);
    // stairs up the front
    for (let i = 0; i < 4; i++) b.box(-1, i, 7 - Math.max(0, i - 0), 1, i, 7 + 1 - i, CR);
    b.anim({ kind: 'bob', amp: 0.7, speed: 0.9, phase: 0 });
    const cc = (x: number, y: number) => (y < 17 ? PL : CR);
    b.ell(0, 19, 0, 7, 3, 4.5, cc);
    b.ell(-5, 18, 1, 4.5, 2.6, 3.4, cc);
    b.ell(5, 18.5, -1, 4.8, 2.8, 3.4, cc);
    b.ell(1, 21, -1, 4, 2.4, 3, CR);
    b.anim({ kind: 'blink', speed: 2.2 });
    for (let y = 14; y <= 15; y++) b.set(0, y, 0, GL);
    return b.done();
  },
  crates() {
    const b = new Builder();
    crate(b, -9, 0, -4, 8, 7, 8, F[1], PL);
    crate(b, 1, 0, -3, 8, 7, 8, F[3], PL);
    crate(b, -5, 7, -4, 9, 7, 8, F[0], PL);
    crate(b, -2, 14, -2, 5, 4, 5, F[5], PL);
    return b.done();
  },
  server() {
    const b = new Builder();
    b.box(-5, 0, -4, 5, 0, 4, INK);
    b.box(-4, 1, -3, 4, 14, 3, PL);
    for (let y = 2; y <= 13; y += 3) {
      b.box(-3, y, 4, 3, y + 1, 4, F[2]);
      b.set(3, y + 1, 4, GL);
      b.set(1, y + 1, 4, CR);
    }
    b.box(2, 15, 0, 2, 19, 0, INK);
    b.anim({ kind: 'blink', speed: 3 });
    b.set(2, 20, 0, GL);
    return b.done();
  },
  whale() {
    const b = new Builder();
    b.ell(1, 5, 0, 8, 4.6, 4.6, (x, y) => (y < 3.4 ? CR : F[1]));
    for (let i = 0; i < 5; i++) b.box(-8 - i, 4 + Math.floor(i / 2), -1, -8 - i, 6 + Math.floor(i / 2), 1, F[1]);
    b.box(-13, 7, -4, -13, 9, 4, F[1]);
    b.box(-14, 8, -5, -14, 10, -2, F[1]);
    b.box(-14, 8, 2, -14, 10, 5, F[1]);
    b.set(6, 6, 4, INK); b.set(6, 6, -4, INK);
    b.box(2, 1, 4, 4, 2, 6, F[1]);
    b.box(2, 1, -6, 4, 2, -4, F[1]);
    crate(b, -4, 9, -2, 4, 3, 4, F[3], PL);
    crate(b, 0, 9, -2, 4, 4, 4, F[0], PL);
    b.anim({ kind: 'blink', speed: 1.6 });
    b.set(6, 10, 0, GL); b.set(6, 11, 0, GL); b.set(5, 12, 0, GL); b.set(7, 12, 0, GL);
    return b.done();
  },
  gear() {
    const b = new Builder();
    b.box(-3, 0, -3, 3, 0, 2, PL);
    b.box(-1, 1, -2, 1, 3, -2, PL);
    b.anim({ kind: 'spin', axis: 'z', cx: 0, cy: 9, cz: 0, speed: 0.55 });
    for (let x = -9; x <= 9; x++)
      for (let y = 0; y <= 18; y++) {
        const dx = x, dy = y - 9;
        const r = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const tooth = (((ang / (Math.PI * 2)) * 10 + 10.25) % 1) < 0.5;
        if (r < 2.2) continue;
        if (r <= 6.3 || (r <= 8.6 && tooth)) {
          const c = r < 3.6 ? INK : GD;
          b.set(x, y, -1, c); b.set(x, y, 0, c);
          if (r > 4.4 && r < 5.4) b.set(x, y, 1, GD);
        }
      }
    return b.done();
  },
  terminal() {
    const b = new Builder();
    b.box(-5, 0, -3, 5, 0, 2, PL);
    b.box(-1, 1, -2, 1, 2, -1, PL);
    b.box(-8, 3, -2, 8, 14, 0, PL);
    b.box(-7, 4, 1, 7, 13, 1, INK);
    const lit: [number, number][] = [[-6, 12], [-5, 11], [-6, 10], [-4, 10], [-3, 10], [-2, 10]];
    for (const [x, y] of lit) b.set(x, y, 1, GL);
    for (let x = -6; x <= 3; x++) if (x % 3 !== 0) b.set(x, 8, 1, F[3]);
    for (let x = -6; x <= 0; x++) if (x % 4 !== 1) b.set(x, 6, 1, F[3]);
    b.anim({ kind: 'blink', speed: 2.5 });
    b.set(-5, 5, 1, GL); b.set(-4, 5, 1, GL);
    return b.done();
  },
  book() {
    const b = new Builder();
    b.box(-11, 0, -7, 11, 0, 7, F[2]);
    for (let x = -10; x <= 10; x++) {
      if (x === 0) { b.box(0, 1, -6, 0, 1, 6, CR); continue; }
      const hh = 1 + Math.floor(2.6 * Math.sin((Math.PI * Math.abs(x)) / 11));
      b.box(x, 1, -6, x, hh, 6, CR);
      if (Math.abs(x) > 1 && Math.abs(x) < 10)
        for (let z = -5; z <= 5; z += 2) if ((x * 7 + z * 3) % 5 !== 0) b.set(x, hh, z, INK);
    }
    // a little figure on the page, rendered
    b.box(4, 4, -3, 7, 4, 0, F[4]);
    b.box(-8, 4, -4, -3, 4, -4, F[0]);
    return b.done();
  },
  guitar() {
    const b = new Builder();
    b.box(-3, 0, -2, 3, 0, 2, PL);
    const body = (x: number, y: number) => ((x / 5.4) ** 2 + ((y - 5.5) / 4.8) ** 2 <= 1) || ((x / 4.3) ** 2 + ((y - 11.5) / 3.8) ** 2 <= 1);
    for (let x = -6; x <= 6; x++)
      for (let y = 1; y <= 16; y++)
        if (body(x, y)) {
          const edge = !body(x + 1, y) || !body(x - 1, y) || !body(x, y + 1) || !body(x, y - 1);
          for (let z = -1; z <= 1; z++) b.set(x, y, z, edge ? CR : F[0]);
          if ((x * x + (y - 9) ** 2) <= 3.2) b.set(x, y, 1, INK);
        }
    b.box(-2, 4, 2, 2, 4, 2, INK);
    b.box(-1, 15, 0, 1, 25, 0, GD);
    for (let y = 17; y <= 25; y += 2) b.set(0, y, 1, CR);
    b.box(-2, 26, -1, 2, 29, 0, F[0]);
    for (let y = 26; y <= 28; y += 2) { b.set(-3, y, 0, CR); b.set(3, y, 0, CR); }
    return b.done();
  },
  pad() {
    const b = new Builder();
    const inside = (x: number, z: number) => Math.abs(x) <= 5 ? Math.abs(z) <= 4.5 : ((Math.abs(x) - 5) ** 2) / 20 + (z * z) / 22 <= 1;
    for (let x = -10; x <= 10; x++)
      for (let z = -5; z <= 5; z++)
        if (inside(x, z)) b.box(x, 0, z, x, 2, z, Math.abs(z) <= 3 && Math.abs(x) <= 3 ? INK : CR);
    for (let i = -2; i <= 2; i++) { b.set(-6 + i, 3, 0, INK); b.set(-6, 3, i, INK); }
    b.set(-6, 3, 0, IN);
    b.cylY(4, 1, 3, 3, 1.3, F[0]);
    b.cylY(7, -1, 3, 3, 1.3, F[0]);
    b.box(-2, 3, 2, -1, 3, 2, INK);
    b.box(1, 3, 2, 2, 3, 2, INK);
    // cable trailing off the back of the stage
    const cab: [number, number][] = [[0, -6], [0, -7], [1, -8], [2, -9], [2, -10], [1, -11], [0, -12], [-1, -13], [-2, -13], [-3, -14]];
    for (const [x, z] of cab) b.set(x, 0, z, INK);
    b.anim({ kind: 'blink', speed: 1.4 });
    b.set(0, 3, -3, GL);
    return b.done();
  },
  balloon() {
    const b = new Builder();
    b.box(-3, 0, -3, 3, 0, 3, IN);
    b.anim({ kind: 'bob', amp: 1.1, speed: 0.7, phase: 1 });
    b.ell(0, 24, 0, 5.6, 6.2, 5.6, (x, y) => ((Math.atan2(x, 1e-3 + 0) > 0 ? 1 : 0) + Math.floor((x + 12) / 3)) % 2 ? CR : F[2]);
    b.box(0, 17, 0, 0, 17, 0, F[2]);
    b.cylY(0, 0, 14, 14, 2.8, F[0]);
    b.cylY(0, 0, 15, 15, 2, F[0]);
    for (let y = 9; y <= 13; y++) b.set(0, y, 0, INK);
    b.set(-2, 13, 0, INK); b.set(2, 13, 0, INK);
    crate(b, -2, 5, -2, 5, 4, 5, F[3], CR);
    b.box(2, 3, 0, 2, 4, 0, INK);
    b.set(0, 7, 3, GL);
    return b.done();
  },
  portico() {
    const b = new Builder();
    b.box(-9, 0, -6, 9, 0, 6, CR);
    b.box(-8, 1, -5, 8, 1, 5, CR);
    for (const x of [-7, -3, 1, 5]) for (const z of [-3, 3]) b.box(x, 2, z, x + 1, 9, z, CR);
    b.box(-6, 2, -4, 5, 9, -4, F[1]);
    b.box(-1, 2, -3, 0, 6, -3, GL);
    b.box(-8, 10, -5, 8, 11, 4, CR);
    for (let i = 0; i < 4; i++) b.box(-8 + 2 * i, 12 + i, -5, 8 - 2 * i, 12 + i, 4, F[1]);
    return b.done();
  },
  tablet() {
    const b = new Builder();
    b.box(-4, 0, -4, 4, 1, 0, PL);
    b.box(-7, 2, -2, 7, 20, -1, INK);
    b.box(-6, 3, -1, 6, 19, -1, CR);
    b.box(-6, 17, -1, 6, 18, -1, F[3]);
    b.box(1, 11, -1, 6, 15, -1, F[0]);
    for (let y = 4; y <= 15; y += 2) {
      for (let x = -6; x <= -1; x++) if ((x + y) % 7 !== 0) b.set(x, y, -1, INK);
      if (y < 10) for (let x = 1; x <= 6; x++) if ((x * y) % 5 !== 1) b.set(x, y, -1, INK);
    }
    // nudge the screen forward one cell so it reads
    const scr: Cell[] = [];
    for (const c of b.map.values()) if (c.z === -1 && c.y >= 3 && c.y <= 19 && Math.abs(c.x) <= 6) scr.push(c);
    for (const c of scr) { b.del(c.x, c.y, c.z); b.set(c.x, c.y, 0, c.c); }
    b.set(0, 2, 0, GL);
    return b.done();
  },
  jar() {
    const b = new Builder();
    b.cylY(0, 0, 0, 10, 4.6, (x, y, z) => (y >= 3 && y <= 6 ? (z > 2 ? CR : CR) : F[4]));
    b.cylY(0, 0, 11, 12, 5.0, GD);
    b.cylY(0, 0, 13, 13, 3.5, GD);
    b.set(0, 5, 5, F[0]); b.set(-1, 5, 5, F[0]); b.set(1, 5, 5, F[0]); b.set(0, 4, 5, F[0]); b.set(-1, 6, 5, F[0]); b.set(1, 6, 5, F[0]);
    b.anim({ kind: 'bob', amp: 0.8, speed: 1.3, phase: 2 });
    b.box(-1, 17, 0, 0, 18, 0, GL); b.box(-2, 17, 0, -2, 17, 0, GL);
    b.box(0, 19, 0, 0, 23, 0, GL);
    b.box(1, 22, 0, 2, 23, 0, GL); b.set(3, 21, 0, GL);
    return b.done();
  },
  badge() {
    const b = new Builder();
    b.box(-3, 0, -3, 3, 0, 1, PL);
    b.box(-1, 1, -1, 1, 3, -1, PL);
    b.box(-6, 4, -1, 6, 13, 0, CR);
    b.box(-6, 11, 0, 6, 13, 0, F[5]);
    for (let x = -4; x <= 4; x++) if (x % 3) b.set(x, 8, 0, INK);
    for (let x = -4; x <= 1; x++) b.set(x, 6, 0, INK);
    b.box(-1, 14, -1, 1, 14, 0, GD);
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = -5 + 10 * t, y = 14 + 8 * Math.sin(Math.PI * t);
      b.set(x, y, -1, F[5]); b.set(x, y, 0, F[5]);
    }
    return b.done();
  },
  rocket() {
    const b = new Builder();
    b.box(-6, 0, -6, 6, 0, 6, PL);
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]] as [number, number][]) b.box(x, 1, z, x, 2, z, INK);
    b.box(-5, 1, 0, 5, 4, 0, F[0]);
    b.box(0, 1, -5, 0, 4, 5, F[0]);
    b.cylY(0, 0, 2, 16, 2.7, (x, y) => (y === 12 || y === 13 ? F[1] : CR));
    b.cylY(0, 0, 17, 22, (y) => 2.7 * (1 - (y - 16) / 7), F[0]);
    b.set(0, 10, 3, GL); b.set(0, 9, 3, GL);
    b.anim({ kind: 'blink', speed: 4 });
    b.box(-1, 1, -1, 1, 1, 1, GL);
    return b.done();
  },
  envelope() {
    const b = new Builder();
    b.box(-9, 0, -3, 9, 0, 2, PL);
    b.box(-9, 1, -1, 9, 12, 0, CR);
    for (let x = -9; x <= 9; x++) {
      const y = Math.round(6 + Math.abs(x) * (6 / 9));
      b.set(x, y, 1, F[0]);
    }
    b.anim({ kind: 'blink', speed: 1.2 });
    b.set(-1, 6, 2, GL); b.set(1, 6, 2, GL); b.set(0, 5, 2, GL); b.set(0, 6, 2, GL); b.set(-1, 7, 2, GL); b.set(1, 7, 2, GL);
    return b.done();
  },
};

function glyphFig(str: string) {
  return () => {
    const b = new Builder();
    const w = textWidth(str);
    const hw = Math.ceil(w / 2) + 1;
    b.box(-hw, 0, -3, hw, 3, 3, PL);
    b.box(-hw + 1, 4, -2, hw - 1, 4, 2, F[2]);
    b.text(str, -Math.floor(w / 2), 5, -1, 0, GD);
    return b.done();
  };
}
FIGS.glyphX = glyphFig('X');
FIGS.glyphGH = glyphFig('GH');
FIGS.glyphIN = glyphFig('IN');

export function figure(name: string): Figure {
  return FIGS[name]();
}

export function word(str: string, c: number): Figure {
  const b = new Builder();
  const w = textWidth(str);
  b.text(str, -Math.floor(w / 2), 0, 0, 1, c);
  return b.done(false);
}

// Diorama layouts: figure centres in cells, on a 49x49 stage.
// x across the stage, z out from the box face.
export const LAYOUT: Record<string, [number, number][]> = {
  now: [[0, 22]],
  boxes: [[-13, 13], [12, 12], [-9, 32], [14, 31]],
  tools: [[-14, 20], [1, 32], [15, 15]],
  play: [[-10, 29], [11, 17]],
  greets: [[-15, 13], [0, 12], [15, 13], [-8, 31], [9, 31]],
  hello: [[0, 11], [-16, 29], [0, 30], [16, 29]],
};

// 6x6 emblems for the centre sticker of each face.
export const EMBLEM: Record<string, string[]> = {
  now: ['.####.', '#....#', '#.##.#', '#.##.#', '#....#', '.####.'],
  boxes: ['##..##', '##..##', '......', '......', '##..##', '##..##'],
  tools: ['#.....', '.#....', '..#...', '.#....', '#..###', '......'],
  play: ['..##..', '..##..', '######', '######', '..##..', '..##..'],
  greets: ['.#..#.', '######', '######', '.####.', '..##..', '......'],
  hello: ['######', '##..##', '#.##.#', '#....#', '######', '......'],
};
