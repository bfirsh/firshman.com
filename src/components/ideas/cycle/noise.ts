// Small deterministic helpers: PRNG, value noise and hand-tuned ordered dithering.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const sm = (t: number) => t * t * (3 - 2 * t);

export function noise1(x: number, s: number): number {
  const i = Math.floor(x), f = x - i;
  return hash2(i, 7, s) + (hash2(i + 1, 7, s) - hash2(i, 7, s)) * sm(f);
}

export function noise2(x: number, y: number, s: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = sm(x - ix), fy = sm(y - iy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm1(x: number, s: number, oct = 4): number {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { v += noise1(x * f, s + o * 31) * a; n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}

export function fbm2(x: number, y: number, s: number, oct = 4): number {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { v += noise2(x * f, y * f, s + o * 57) * a; n += a; a *= 0.5; f *= 2.07; }
  return v / n;
}

// 4x4 Bayer matrix, 0..15/16 + 1/32.
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => B4[((y & 3) << 2) | (x & 3)];

/**
 * Quantise v in [0,1] to one of n levels, keeping flat clean bands and only
 * dithering a narrow seam between them (the way a pixel artist would).
 */
export function qband(v: number, n: number, x: number, y: number, lo = 0.3, hi = 0.7): number {
  const f = Math.max(0, Math.min(1, v)) * (n - 1);
  const b = Math.floor(f);
  if (b >= n - 1) return n - 1;
  const fr = f - b;
  if (fr <= lo) return b;
  if (fr >= hi) return b + 1;
  return (fr - lo) / (hi - lo) > bayer(x, y) ? b + 1 : b;
}

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
