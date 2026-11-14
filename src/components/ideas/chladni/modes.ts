// Chladni plate modes.
// Square plate: the classic approximation
//   f(x, y) = cos(nπx)cos(mπy) ± cos(mπx)cos(nπy),  x, y ∈ [0, 1]
// Circular plate (free edge): J_n(k r) cos(nθ) with k a zero of J_n', and pairs
// of near-degenerate modes superposed, as real plates do, which turns the bare
// spokes-and-rings into the ornate figures Chladni drew.

export type SquareMode = { kind: 'square'; n: number; m: number; s: 1 | -1 };
export type CircleMode = { kind: 'circle'; comps: [number, number, number][] }; // [n, root index, weight]
export type Mode = SquareMode | CircleMode;

const sq = (n: number, m: number, s: 1 | -1): SquareMode => ({ kind: 'square', n, m, s });
export const SQUARE_MODES: SquareMode[] = [
  sq(1, 3, -1), sq(1, 5, -1), sq(3, 5, -1), sq(1, 7, -1), sq(3, 7, -1), sq(5, 7, -1), sq(5, 9, -1), sq(7, 9, -1),
  sq(2, 4, -1), sq(2, 6, -1), sq(4, 6, -1), sq(2, 8, -1), sq(6, 8, -1),
  sq(1, 3, 1), sq(1, 5, 1), sq(3, 5, 1), sq(1, 7, 1), sq(3, 7, 1), sq(5, 7, 1), sq(5, 9, 1), sq(7, 9, 1),
  sq(2, 4, 1), sq(2, 6, 1), sq(4, 6, 1), sq(2, 8, 1), sq(6, 8, 1), sq(4, 8, 1),
];

const ci = (a: [number, number], b: [number, number]): CircleMode => ({ kind: 'circle', comps: [[a[0], a[1], 1], [b[0], b[1], 0.8]] });
export const CIRCLE_MODES: CircleMode[] = [
  ci([0, 2], [6, 1]), ci([3, 2], [1, 3]), ci([1, 3], [7, 1]), ci([4, 2], [2, 3]), ci([8, 1], [0, 3]),
  ci([0, 3], [5, 2]), ci([0, 3], [9, 1]), ci([9, 1], [3, 3]), ci([3, 3], [1, 4]), ci([3, 3], [6, 2]),
  ci([1, 4], [10, 1]), ci([7, 2], [0, 4]), ci([2, 4], [0, 4]), ci([2, 4], [8, 2]), ci([0, 4], [5, 3]),
  ci([0, 4], [8, 2]), ci([3, 4], [6, 3]), ci([3, 4], [9, 2]), ci([10, 2], [5, 4]),
];

// Bessel J_n by the trapezoid rule on Bessel's integral (spectrally accurate: the integrand is periodic).
function besselJ(n: number, x: number) {
  const K = 96;
  let s = 0;
  for (let i = 0; i < K; i++) { const t = (i / K) * Math.PI * 2; s += Math.cos(n * t - x * Math.sin(t)); }
  return s / K;
}

const rootCache = new Map<string, number>();
// s-th positive zero of J_n' (free edge), skipping the trivial one at 0
function dRoot(n: number, s: number) {
  const key = n + ':' + s;
  if (rootCache.has(key)) return rootCache.get(key)!;
  const h = 0.01;
  let prev = besselJ(n, h * 2) - besselJ(n, 0);
  let x = h, count = 0, out = 0;
  while (x < 40) {
    const d = besselJ(n, x + h) - besselJ(n, x - h);
    if (x > 0.3 && prev * d < 0) { count++; if (count === s) { out = x; break; } }
    prev = d; x += h;
  }
  rootCache.set(key, out);
  return out;
}

// Plate "pitch": bending waves go as k², so frequency ∝ n² + m² (square) or k² (circle).
export function pitch(m: Mode) {
  if (m.kind === 'square') return (m.n * m.n + m.m * m.m) * Math.PI * Math.PI * 0.25;
  const k = dRoot(m.comps[0][0], m.comps[0][1]);
  return k * k;
}

export type Field = { G: number; f: Float32Array; gx: Float32Array; gy: Float32Array };

// Sample a mode onto a G×G grid over plate coords [-1, 1]², normalised to max |f| = 1 on the plate.
export function buildField(mode: Mode, G: number, rot = 0): Field {
  const f = new Float32Array(G * G);
  if (mode.kind === 'square') {
    const { n, m, s } = mode;
    const cx = new Float32Array(G * 2), cy = new Float32Array(G * 2);
    for (let i = 0; i < G; i++) {
      const u = i / (G - 1);
      cx[i * 2] = Math.cos(n * Math.PI * u); cx[i * 2 + 1] = Math.cos(m * Math.PI * u);
    }
    cy.set(cx);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      f[j * G + i] = cx[i * 2] * cy[j * 2 + 1] + s * cx[i * 2 + 1] * cy[j * 2];
    }
  } else {
    const L = 1024;
    const luts = mode.comps.map(([n, s, w]) => {
      const k = dRoot(n, s);
      const lut = new Float32Array(L + 2);
      let mx = 0;
      for (let i = 0; i <= L + 1; i++) { const v = besselJ(n, (k * Math.min(i, L)) / L); lut[i] = v; if (i <= L) mx = Math.max(mx, Math.abs(v)); }
      for (let i = 0; i < lut.length; i++) lut[i] = (lut[i] / mx) * w;
      return { n, lut };
    });
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = (i / (G - 1)) * 2 - 1, y = (j / (G - 1)) * 2 - 1;
      const r = Math.min(1.02, Math.hypot(x, y)), th = Math.atan2(y, x) + rot;
      const ri = Math.min(L, r * L), r0 = Math.floor(ri), rf = ri - r0;
      let v = 0;
      for (const { n, lut } of luts) v += (lut[r0] * (1 - rf) + lut[Math.min(L + 1, r0 + 1)] * rf) * Math.cos(n * th);
      f[j * G + i] = v;
    }
  }
  let mx = 0;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = (i / (G - 1)) * 2 - 1, y = (j / (G - 1)) * 2 - 1;
    if (mode.kind === 'circle' && x * x + y * y > 1) continue;
    mx = Math.max(mx, Math.abs(f[j * G + i]));
  }
  for (let i = 0; i < f.length; i++) f[i] /= mx;
  // gradients in plate units (per unit of [-1,1])
  const gx = new Float32Array(G * G), gy = new Float32Array(G * G);
  const inv = (G - 1) / 2;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(G - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(G - 1, j + 1);
    gx[j * G + i] = ((f[j * G + i1] - f[j * G + i0]) / (i1 - i0)) * inv;
    gy[j * G + i] = ((f[j1 * G + i] - f[j0 * G + i]) / (j1 - j0)) * inv;
  }
  return { G, f, gx, gy };
}
