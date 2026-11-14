// Procedural voxel models for /ideas/voxel. Every shape is a function on an
// integer grid (x right, y up, z towards the camera) that returns a colour or 0.
// voxelize() keeps only the outer shell, so a solid gear costs what its skin costs.

export type ShapeFn = (x: number, y: number, z: number) => number;
export type Bounds = [number, number, number, number, number, number];
export type ShapeDef = { id: string; b: Bounds; f: ShapeFn };
// ao: a cheap ambient-occlusion term from how many of the 26 neighbours are empty
export type Voxels = { x: Int16Array; y: Int16Array; z: Int16Array; c: Uint32Array; ao: Float32Array; n: number };

export const CURSOR = 0x43f58c; // the CLIG cursor: the renderer blinks voxels of exactly this colour

export function shade(hex: number, k: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return ((r << 16) | (g << 8) | b) || 1;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hyp = Math.hypot;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
  return hyp(px - ax - dx * t, py - ay - dy * t);
}

export function voxelize(def: ShapeDef): Voxels {
  const [x0, x1, y0, y1, z0, z1] = def.b;
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
  const g = new Uint32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) g[at(i, j, k)] = def.f(x0 + i, y0 + j, z0 + k) >>> 0;
  const occ = (i: number, j: number, k: number) =>
    i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && g[at(i, j, k)] !== 0;
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], cs: number[] = [], aos: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = g[at(i, j, k)];
        if (!c) continue;
        if (occ(i - 1, j, k) && occ(i + 1, j, k) && occ(i, j - 1, k) && occ(i, j + 1, k) && occ(i, j, k - 1) && occ(i, j, k + 1)) continue;
        let empty = 0;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) if ((di || dj || dk) && !occ(i + di, j + dj, k + dk)) empty++;
        xs.push(x0 + i); ys.push(y0 + j); zs.push(z0 + k); cs.push(c);
        aos.push(clamp(0.6 + 0.045 * empty, 0.6, 1.06));
      }
  return { x: Int16Array.from(xs), y: Int16Array.from(ys), z: Int16Array.from(zs), c: Uint32Array.from(cs), ao: Float32Array.from(aos), n: xs.length };
}

// ---------------------------------------------------------------- containers
function container(lx: number, ly: number, lz: number, L: number, H: number, D: number, base: number): number {
  const ax = Math.abs(lx), ay = Math.abs(ly), az = Math.abs(lz);
  if (ax > L || ay > H || az > D) return 0;
  const ex = L - ax < 1, ey = H - ay < 1, ez = D - az < 1;
  if (+ex + +ey + +ez >= 2) return shade(base, 0.62); // corner posts and rails
  if (ex) { // doors
    if (az < 1) return shade(base, 0.5);
    if (ay < H - 1 && (Math.abs(lz) === Math.round(D / 2))) return shade(base, 0.72); // locking bars
    return shade(base, 0.92);
  }
  return ((lx % 2) + 2) % 2 === 0 ? base : shade(base, 0.8); // corrugation
}

// four containers: two on the ground, one on top, and one turned to face you
const compose: ShapeDef = {
  id: 'compose',
  b: [-30, 30, -20, 22, -15, 15],
  f: (x, y, z) =>
    container(x + 15, y + 14, z, 13, 5, 5, 0x2f6cf6) ||
    container(x - 15, y + 14, z, 13, 5, 5, 0xff4a2e) ||
    container(x - 3, y + 3, z, 13, 5, 5, 0xffc61a) ||
    container(z, y - 8, x + 4, 13, 5, 5, 0xf1f1ee),
};

// ---------------------------------------------------------------- whale
const whale: ShapeDef = {
  id: 'whale',
  b: [-38, 30, -16, 26, -12, 12],
  f(x, y, z) {
    const BLUE = 0x2f6cf6, BELLY = 0xe6eefb, INK = 0x0e1a33;
    // body
    const ry = y < 0 ? 10 : 12;
    const body = ((x - 5) / 22) ** 2 + (y / ry) ** 2 + (z / 10) ** 2 <= 1;
    // tail: tapers and curls upward
    let tail = false;
    if (x < -10 && x >= -30) {
      const t = (-10 - x) / 20;
      const yc = 14 * t * t;
      const r = 7.5 * (1 - t) + 2 * t;
      tail = ((y - yc) / r) ** 2 + (z / (r * 0.9)) ** 2 <= 1;
    }
    // flukes, a V in the xy plane
    const fl = Math.abs(z) <= 1 && (
      ((x + 33 - (y - 19) * 0.55) / 2.6) ** 2 + ((y - 19) / 7) ** 2 <= 1 && y >= 14 ||
      segDist(x, y, -30, 14, -37, 9) < 2.2
    );
    // flipper
    const fin = Math.abs(Math.abs(z) - 9) <= 1.2 && segDist(x, y, 8, -5, 2, -12) < 2;
    // containers on its back (it is a Docker whale, after all)
    const box = (cx: number, cy: number, col: number) =>
      Math.abs(x - cx) <= 3 && y >= cy && y <= cy + 3 && Math.abs(z) <= 3
        ? (Math.abs(x - cx) === 3 || y === cy + 3 || Math.abs(z) === 3) && (x - cx + 7) % 2 === 0 ? shade(col, 0.82) : col
        : 0;
    const cargo = box(-3, 11, 0xffc61a) || box(5, 11, 0xff4a2e) || box(1, 15, 0xf1f1ee);
    if (cargo) return cargo;
    // spout
    const spout =
      (hyp(x - 18, z) <= 1.2 && y >= 10 && y <= 18) ||
      hyp(x - 18, y - 20, z) <= 2.4 || hyp(x - 14.5, y - 18.5, z) <= 1.7 || hyp(x - 21.5, y - 18.5, z) <= 1.7;
    if (spout && !body) return y > 18 ? 0xd8f1ff : 0x9fd8ff;
    if (!(body || tail || fl || fin)) return 0;
    if (fin) return shade(BLUE, 0.8);
    if (body) {
      if (x > 12 && Math.abs(y - (-2.5 - (x - 12) * 0.12)) < 0.7) return INK; // grin
      if (hyp(x - 17, y - 3) < 1.6 && Math.abs(z) > 4) return INK; // eye
      if (y < -3 - Math.max(0, 6 - x) * 0.15) return BELLY;
      return y > 7 ? shade(BLUE, 1.08) : BLUE;
    }
    return BLUE;
  },
};

// ---------------------------------------------------------------- gear
const gear: ShapeDef = {
  id: 'cog',
  b: [-30, 30, -30, 30, -7, 7],
  f(x, y, z) {
    const r = hyp(x, y), th = Math.atan2(y, x);
    const az = Math.abs(z);
    const ORANGE = 0xff9a1f;
    if (r <= 12.5 && r >= 6.5 && az <= 6) { // hub
      if (r < 7.6) return 0x7a4300;
      return az > 5 ? 0xffbf3f : 0xd9790a;
    }
    if (az > 4 || r < 6.5) return 0;
    const u = Math.cos(10 * th);
    const outer = 21 + 7 * clamp((u + 0.2) / 0.55, 0, 1);
    if (r > outer) return 0;
    for (let h = 0; h < 5; h++) {
      const a = (h / 5) * Math.PI * 2 + Math.PI / 10;
      if (hyp(x - 16 * Math.cos(a), y - 16 * Math.sin(a)) < 4.4) return 0;
    }
    if (r > 21.5) return az > 3 ? 0xffb43d : shade(ORANGE, 0.85);
    return az > 3 ? ORANGE : shade(ORANGE, 0.78);
  },
};

// ---------------------------------------------------------------- NES pad
const pad: ShapeDef = {
  id: 'jsnes',
  b: [-30, 30, -15, 28, -4, 6],
  f(x, y, z) {
    const GREY = 0xcfcfcf, BLACK = 0x1a1a1a, RED = 0xe4002b;
    // cable
    if (y > 12 && Math.abs(z) <= 0 + 0.5) {
      const cx = Math.sin((y - 12) * 0.35) * 4 * Math.min(1, (y - 12) / 6);
      if (Math.abs(x - cx) <= 0.8) return 0x2a2a2a;
    }
    const front = z >= 3;
    // raised things on the front
    if (z >= 4 && z <= 5) {
      const dp = (Math.abs(x + 17) <= 1.5 && Math.abs(y + 1) <= 5.5) || (Math.abs(y + 1) <= 1.5 && Math.abs(x + 17) <= 5.5);
      if (dp) return z === 5 && Math.abs(x + 17) <= 1 && Math.abs(y + 1) <= 1 ? 0x2c2c2c : BLACK;
      if (z === 4 && (hyp(x - 13, y + 3) <= 3 || hyp(x - 21, y + 3) <= 3)) return RED;
      if (z === 4 && Math.abs(y + 4) <= 0.6 && (Math.abs(x + 3.5) <= 1.6 || Math.abs(x - 3.5) <= 1.6)) return BLACK;
      return 0;
    }
    if (Math.abs(x) > 28 || Math.abs(y) > 12 || z < -3 || z > 3) return 0;
    if (!front) return z <= -3 ? shade(GREY, 0.85) : GREY;
    // front plate
    if (Math.abs(x) <= 26 && y >= -10 && y <= 8) {
      if (Math.abs(x - 17) <= 8 && Math.abs(y + 3) <= 4) return 0xd5d5d5; // button bed
      if (Math.abs(x) <= 7 && y >= -7 && y <= -1) return 0xbcbcbc; // select/start bed
      if (Math.abs(x) <= 7 && y >= 1 && y <= 7 && y % 2 === 1) return 0x9a9a9a; // stripes
      if (y >= 4 && y <= 6 && x >= 11 && x <= 24) return y === 5 ? RED : BLACK; // red wordmark-ish bar
      return BLACK;
    }
    return GREY;
  },
};

// ---------------------------------------------------------------- balloon
const balloon: ShapeDef = {
  id: 'ukhas',
  b: [-18, 18, -36, 32, -18, 18],
  f(x, y, z) {
    const rr = hyp(x, z);
    // envelope: sphere stretched up, pinched into a neck below
    const ey = y - 14;
    if ((rr / 15) ** 2 + (ey / (ey > 0 ? 17 : 15)) ** 2 <= 1) return ey > 9 ? 0xffffff : 0xf3efe6;
    if (y <= 0 && y >= -2 && rr <= 1.6) return 0xd9d2c4;
    // line
    if (rr < 0.6 && y < -2 && y > -24) return 0xbdbdbd;
    // parachute
    const py = y + 12;
    if (py >= 0 && hyp(rr, py) <= 6 && hyp(rr, py) >= 4.8) {
      const seg = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8);
      return seg % 2 ? 0xff4a2e : 0xffc61a;
    }
    // payload
    if (Math.abs(x) <= 4 && Math.abs(z) <= 4 && y <= -24 && y >= -31) {
      if (z === 4 && hyp(x - 1.5, y + 27) <= 1.2) return 0x111111; // camera
      return y === -24 ? 0xff7a1a : 0xff8f2e;
    }
    if (x === 3 && z === 0 && y < -31 && y >= -36) return 0xbdbdbd; // antenna
    return 0;
  },
};

// ---------------------------------------------------------------- prompt
const prompt: ShapeDef = {
  id: 'clig',
  b: [-30, 30, -22, 22, -2, 3],
  f(x, y, z) {
    const GREEN = 0x43f58b;
    if (Math.abs(x) > 29 || Math.abs(y) > 20) return 0;
    // glyphs, extruded out of the screen
    if (z >= -1 && z <= 2) {
      const chev = segDist(x, y, -21, 6, -11, -2) < 1.9 || segDist(x, y, -11, -2, -21, -10) < 1.9;
      if (chev) return GREEN;
      if (x >= -6 && x <= 7 && y >= -11 && y <= -8) return CURSOR;
    }
    if (z === 1) { // traffic lights
      if (hyp(x + 25, y - 17) <= 1.3) return 0xff5f57;
      if (hyp(x + 20.5, y - 17) <= 1.3) return 0xfebc2e;
      if (hyp(x + 16, y - 17) <= 1.3) return 0x28c840;
      return 0;
    }
    if (z < -1 || z > 0) return 0;
    const screen = Math.abs(x) <= 27 && y >= -18 && y <= 14;
    if (screen) return z === -1 ? 0x17181c : 0;
    return y >= 15 ? 0xe4e4e8 : 0xcfcfd5;
  },
};

// ---------------------------------------------------------------- papers
function sheet(x: number, y: number, ox: number, oy: number, deg: number) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - ox, dy = y - oy;
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= 14.5 && Math.abs(ly) <= 19 ? [lx, ly] : null;
}
const papers: ShapeDef = {
  id: 'arxiv-vanity',
  b: [-24, 28, -26, 30, -6, 1],
  f(x, y, z) {
    const INK = 0x2a2a2a, GREY = 0x9a968c, RED = 0xb31b1b, PAPER = 0xfbf9f2;
    if (z === -6) return sheet(x, y, 9, 6, 11) ? 0xd9d3c3 : 0;
    if (z === -3) return sheet(x, y, 4.5, 3, 5) ? 0xebe6d8 : 0;
    if (z !== 0) return 0;
    const p = sheet(x, y, 0, 0, -2);
    if (!p) return 0;
    const lx = Math.round(p[0]), ly = Math.round(p[1]);
    if (ly === 16 && lx >= -11 && lx <= 11) return INK; // title
    if (ly === 14 && lx >= -8 && lx <= 8) return INK;
    if (ly === 11 && lx >= -5 && lx <= 5) return GREY; // authors
    if ((ly === 7 || ly === 5 || ly === 3) && Math.abs(lx) <= 11 && !(ly === 3 && lx > 6)) return GREY;
    // figure: a bar chart, in arXiv red
    if (lx >= -11 && lx <= 0 && ly >= -13 && ly <= -1) {
      if (lx === -11 || ly === -13) return INK;
      const bars = [-9, -6, -3];
      const h = [4, 9, 6];
      for (let i = 0; i < 3; i++) if (lx >= bars[i] && lx <= bars[i] + 1 && ly <= -13 + h[i] + 1) return RED;
      return PAPER;
    }
    if (lx >= 3 && lx <= 11 && ly <= -1 && ly >= -13 && (ly + 1) % 2 === 0 && !(ly === -13 && lx > 7)) return GREY;
    if (ly === -16 && Math.abs(lx) <= 0) return GREY; // page number
    return PAPER;
  },
};

// ---------------------------------------------------------------- guitar
const guitar: ShapeDef = {
  id: 'django',
  b: [-30, 30, -30, 32, -4, 5],
  f(x, y, z) {
    const a = (-38 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const v = x * c + y * s; // across the neck
    const u = -x * s + y * c + 4; // along the neck
    const TOP = 0xe6a34e, SIDE = 0x7a3a14, NECK = 0x3b2414;
    const az = Math.abs(z);
    // strings
    if (z === 4 && (Math.abs(v - 0.9) < 0.45 || Math.abs(v + 0.9) < 0.45) && u > -17 && u < 37) return 0xf2f2f2;
    if (z === 4 && Math.abs(u + 17) < 1 && Math.abs(v) <= 4) return 0x2a160a; // bridge
    // headstock
    if (u >= 36 && u <= 44 && Math.abs(v) <= 3.5 && z >= -1 && z <= 2) return 0x1c120b;
    if ((u === 38 || u === 42) && Math.abs(v) >= 4 && Math.abs(v) <= 5.5 && z >= 0 && z <= 1) return 0xd9b45a;
    // neck
    if (u > 10 && u < 36 && Math.abs(v) <= 2.2 && z >= -1 && z <= 3) {
      if (z === 3) return (Math.round(u) - 12) % 4 === 0 ? 0xcfcfcf : 0x2b1a0f;
      return NECK;
    }
    // body: two bouts and a waist
    const inBody = hyp(v, u + 11) <= 12.5 || hyp(v, u - 3) <= 9.5 || (Math.abs(v) <= 8 && u > -11 && u < 3);
    if (!inBody || az > 3) return 0;
    if (z < 3) return z === -3 ? shade(SIDE, 0.9) : SIDE;
    // the D-shaped sound hole of a Selmer, as played by the other Django
    const du = u - 2;
    const dHole = (du >= -2.5 && du <= 0 && Math.abs(v) <= 4) || (du > 0 && (du / 3.5) ** 2 + (v / 4) ** 2 <= 1);
    if (dHole) return 0x140a04;
    const ring = (du >= -3.5 && du <= 0 && Math.abs(v) <= 5) || (du > 0 && (du / 4.6) ** 2 + (v / 5.2) ** 2 <= 1);
    if (ring) return 0x0c4b33; // a Django-green rosette
    if (hyp(v, u + 11) > 11.5 && hyp(v, u - 3) > 8.5 && !(Math.abs(v) <= 7 && u > -11 && u < 3)) return 0xf2d6a2; // binding
    return TOP;
  },
};

// ---------------------------------------------------------------- hi
const hi: ShapeDef = {
  id: 'contact',
  b: [-30, 30, -30, 22, -3, 4],
  f(x, y, z) {
    const YEL = 0xffd400, INK = 0x111111;
    // letters stand out of the bubble
    if (z >= 2 && z <= 4 && y >= -10 && y <= 10) {
      const H = (x >= -19 && x <= -14) || (x >= -6 && x <= -1) || (x >= -14 && x <= -6 && Math.abs(y) <= 2);
      const I = x >= 4 && x <= 9;
      const bang = x >= 15 && x <= 19 && (y >= -3 || y <= -7);
      if (H || I || bang) return z === 4 ? INK : 0x222222;
    }
    if (z < -2 || z > 1) return 0;
    const rx = Math.max(Math.abs(x) - 19, 0), ry = Math.max(Math.abs(y) - 10, 0);
    const bubble = hyp(rx, ry) <= 8;
    // tail
    const tail = y < -16 && y >= -28 && x <= -8 && x >= -20 + (-16 - y) * 0.15 && x <= -8 - (-16 - y) * 0.85;
    if (!(bubble || tail)) return 0;
    return z === 1 ? YEL : shade(YEL, 0.85);
  },
};

export const SHAPES: Record<string, ShapeDef> = {
  compose, whalebrew: { ...whale, id: 'whalebrew' }, cog: gear, jsnes: pad, ukhas: balloon,
  clig: prompt, 'arxiv-vanity': papers, django: guitar, contact: hi,
};
