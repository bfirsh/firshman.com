// A small single-stroke vector font, in the spirit of old vector displays:
// chamfered corners, no curves, every glyph a handful of beam strokes.
// Glyphs live on a grid with the baseline at y=0 and cap height at y=6.

export type Pt = [number, number];
export type Stroke = Pt[];

type Glyph = { w: number; s: Stroke[] };

const O = '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0';
const P = '0,0 0,6 3,6 4,5 4,4 3,3 0,3';

const RAW: Record<string, [number, string]> = {
  A: [4, '0,0 2,6 4,0;0.67,2 3.33,2'],
  B: [4, '0,3 3,3 4,2 4,1 3,0 0,0 0,6 3,6 4,5 4,4 3,3'],
  C: [4, '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5'],
  D: [4, '0,0 0,6 2.5,6 4,4.5 4,1.5 2.5,0 0,0'],
  E: [3.6, '3.6,6 0,6 0,0 3.6,0;0,3 2.8,3'],
  F: [3.6, '3.6,6 0,6 0,0;0,3 2.8,3'],
  G: [4, '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2.8 2.2,2.8'],
  H: [4, '0,6 0,0;0,3 4,3;4,6 4,0'],
  I: [2, '0,6 2,6;1,6 1,0;0,0 2,0'],
  J: [3.6, '0,1 1,0 2.6,0 3.6,1 3.6,6'],
  K: [4, '0,6 0,0;4,6 0,2;1.45,3.45 4,0'],
  L: [3.4, '0,6 0,0 3.4,0'],
  M: [5, '0,0 0,6 2.5,2.6 5,6 5,0'],
  N: [4, '0,0 0,6 4,0 4,6'],
  O: [4, O],
  P: [4, P],
  Q: [4, O + ';2.4,1.6 4.3,-0.4'],
  R: [4, P + ';2.2,3 4,0'],
  S: [4, '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1'],
  T: [4, '0,6 4,6;2,6 2,0'],
  U: [4, '0,6 0,1 1,0 3,0 4,1 4,6'],
  V: [4, '0,6 2,0 4,6'],
  W: [5.4, '0,6 1.35,0 2.7,4.2 4.05,0 5.4,6'],
  X: [4, '0,0 4,6;0,6 4,0'],
  Y: [4, '0,6 2,3 4,6;2,3 2,0'],
  Z: [4, '0,6 4,6 0,0 4,0'],
  '0': [4, O + ';4,5 0,1'],
  '1': [3, '0,4.6 1.6,6 1.6,0;0,0 3,0'],
  '2': [4, '0,5 1,6 3,6 4,5 4,4 0,0 4,0'],
  '3': [4, '0,5 1,6 3,6 4,5 4,4 3,3 1.6,3;3,3 4,2 4,1 3,0 1,0 0,1'],
  '4': [4, '3,0 3,6 0,2 4,2'],
  '5': [4, '4,6 0,6 0,3.6 3,3.6 4,2.6 4,1 3,0 1,0 0,1'],
  '6': [4, '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3'],
  '7': [4, '0,6 4,6 1.4,0'],
  '8': [4, '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3'],
  '9': [4, '4,3 1,3 0,4 0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1'],
  '.': [0.8, '0.4,0 0.4,0.45'],
  ',': [1, '0.6,0.5 0.6,0 0,-1'],
  "'": [0.8, '0.4,6 0.4,4.4'],
  '-': [3, '0.3,3 2.7,3'],
  ':': [0.8, '0.4,0.6 0.4,1.1;0.4,3.8 0.4,4.3'],
  '/': [3, '0,-0.4 3,6.4'],
  '+': [4, '2,1 2,5;0,3 4,3'],
  '>': [3.4, '0,0.8 3.4,3 0,5.2'],
  '_': [3.6, '0,-0.3 3.6,-0.3'],
  '!': [0.8, '0.4,6 0.4,1.8;0.4,0.5 0.4,0'],
  '&': [4.4, '4.4,0 0.8,4.2 0.8,5.2 1.6,6 2.6,6 3.4,5.2 3.4,4.4 0,2 0,1 1,0 2.6,0 4.2,2.2'],
  '@': [5.6, '3.6,1.8 3.6,4 2.2,4 1.6,3.4 1.6,2.4 2.2,1.8 3.6,1.8 4.6,1.8 5.6,2.8 5.6,4.6 4.4,6 1.4,6 0,4.6 0,1.4 1.4,0 4.4,0'],
  '#': [4.4, '1.4,0 1.4,6;3,0 3,6;0,2 4.4,2;0,4 4.4,4'],
  ' ': [2.4, ''],
};

const GLYPHS: Record<string, Glyph> = {};
for (const k in RAW) {
  const [w, src] = RAW[k];
  const s: Stroke[] = src
    ? src.split(';').map((st) => st.trim().split(/\s+/).map((p) => p.split(',').map(Number) as Pt))
    : [];
  GLYPHS[k] = { w, s };
}

const GAP = 1.3; // space between glyphs, in grid units

/** Width of a string in grid units. */
function measure(str: string) {
  let w = 0;
  for (const ch of str) w += (GLYPHS[ch] ?? GLYPHS[' ']).w + GAP;
  return Math.max(0, w - GAP);
}

/**
 * Lay out a line of text as beam strokes. (x, y) is the baseline anchor,
 * h is the cap height in screen units.
 */
export function text(str: string, x: number, y: number, h: number, align: 'left' | 'center' | 'right' = 'center'): Stroke[] {
  str = str.toUpperCase();
  const s = h / 6;
  const w = measure(str) * s;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  const out: Stroke[] = [];
  for (const ch of str) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (const st of g.s) out.push(st.map(([px, py]) => [cx + px * s, y + py * s] as Pt));
    cx += (g.w + GAP) * s;
  }
  return out;
}

export function textWidth(str: string, h: number) {
  return (measure(str.toUpperCase()) * h) / 6;
}
