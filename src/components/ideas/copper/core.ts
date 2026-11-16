// The "chipset": a 320x256 chunky framebuffer of palette indices, a 64-colour palette,
// and a copper list that can rewrite any palette register on any scanline.

export const W = 320;
export const H = 256;

export type RGB = [number, number, number];

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const smooth = (t: number) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};

/** Evenly spaced gradient through the stops. */
export function grad(stops: (string | RGB)[], n: number, cyclic = false): RGB[] {
  const cs = stops.map((s) => (typeof s === 'string' ? hex(s) : s));
  const segs = cyclic ? cs.length : cs.length - 1;
  const out: RGB[] = [];
  for (let i = 0; i < n; i++) {
    const p = cyclic ? (i / n) * segs : n === 1 ? 0 : (i / (n - 1)) * segs;
    const k = Math.min(segs - 1, Math.floor(p));
    out.push(mix(cs[k], cs[(k + 1) % cs.length], p - k));
  }
  return out;
}

/** Sample a cyclic gradient at any phase. */
export function cyc(cs: RGB[], p: number): RGB {
  const n = cs.length;
  p = (((p % 1) + 1) % 1) * n;
  const k = Math.floor(p);
  return mix(cs[k % n], cs[(k + 1) % n], p - k);
}

// 4x4 ordered dither thresholds in (0,1)
export const BAY = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);

export function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(a: T[], r: () => number): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export class Screen {
  fb = new Uint8Array(W * H);
  base = new Float32Array(64 * 3);
  cop = new Uint32Array(H * 64);
  bright = 1;
  flash = 0;
  committed = false;

  pal(i: number, c: RGB) {
    this.base[i * 3] = c[0];
    this.base[i * 3 + 1] = c[1];
    this.base[i * 3 + 2] = c[2];
  }
  get(i: number): RGB {
    return [this.base[i * 3], this.base[i * 3 + 1], this.base[i * 3 + 2]];
  }
  pk(r: number, g: number, b: number) {
    const k = this.bright, f = this.flash;
    r *= k; g *= k; b *= k;
    r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f;
    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    b = b < 0 ? 0 : b > 255 ? 255 : b;
    return (0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0)) >>> 0;
  }
  /** Copy the base palette onto every scanline. After this, line() rewrites registers per line. */
  commit() {
    const c = this.cop, p = this.base;
    for (let i = 0; i < 64; i++) c[i] = this.pk(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    for (let y = 1; y < H; y++) c.copyWithin(y * 64, 0, 64);
    this.committed = true;
  }
  line(y: number, i: number, c: RGB) {
    if (y >= 0 && y < H) this.cop[(y << 6) | i] = this.pk(c[0], c[1], c[2]);
  }
  blit(out: Uint32Array) {
    const fb = this.fb, cop = this.cop;
    for (let y = 0; y < H; y++) {
      const o = y * W, po = y << 6;
      for (let x = 0; x < W; x++) out[o + x] = cop[po | fb[o + x]];
    }
  }
}
