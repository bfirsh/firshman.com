// Generates the CRT calibration card for testpattern.s: CHR (8 KB), nametable + attributes (1 KB) and palette.
// node src/components/ideas/cartridge/testpattern/make.mjs   (then ./build.sh assembles it)
// The card is drawn as a 256x240 image of 2-bit colour indices plus a palette per 16x16 cell,
// then cut into unique 8x8 tiles. Player-side dev tool only: it is never loaded by the page in production.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 256, H = 240;
const px = new Uint8Array(W * H);          // colour index 0..3
const attr = new Uint8Array(16 * 15);       // palette per 16x16 cell

// palettes: universal black, then three colours each
const PAL = [
  [0x0f, 0x00, 0x10, 0x30], // greys
  [0x0f, 0x16, 0x2a, 0x12], // red green blue
  [0x0f, 0x28, 0x2c, 0x24], // yellow cyan magenta
  [0x0f, 0x17, 0x27, 0x37], // warm ramp
  // sprites
  [0x0f, 0x00, 0x10, 0x30],
  [0x0f, 0x2a, 0x21, 0x30],
  [0x0f, 0x30, 0x30, 0x30],
  [0x0f, 0x16, 0x27, 0x30],
];

const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = c; };
const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c); };
const pal = (x0, y0, w, h, p) => { for (let cy = y0 >> 4; cy < (y0 + h) >> 4; cy++) for (let cx = x0 >> 4; cx < (x0 + w) >> 4; cx++) attr[cy * 16 + cx] = p; };

// 5x7 font
const F = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110', D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 10001 01010 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
  4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000', '.': '00000 00000 00000 00000 00000 01100 01100',
  ':': '00000 01100 01100 00000 01100 01100 00000', '/': '00000 00001 00010 00100 01000 10000 00000',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};
const text = (s, x0, y0, c, bg = 0) => {
  for (let i = 0; i < s.length; i++) {
    const g = F[s[i]].split(' ');
    rect(x0 + i * 8, y0, 8, 8, bg);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (g[y][x] === '1') set(x0 + i * 8 + 1 + x, y0 + y, c);
  }
};

// 1. background grid: dark grey 16px grid with a lighter 64px grid, centred on the screen
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const gx = (x - 128) & 15, gy = (y - 120) & 15;
  if (gx === 0 || gy === 0) px[y * W + x] = ((x - 128) & 63) === 0 || ((y - 120) & 63) === 0 ? 2 : 1;
}
// big circle through the grid, radius 112 (it is round only with 8:7 pixels: x is scaled by 7/8)
for (let a = 0; a < 4096; a++) {
  const t = (a / 4096) * Math.PI * 2;
  set(Math.round(128 + Math.cos(t) * 112 * (7 / 8) * 1.0), Math.round(120 + Math.sin(t) * 112 * 0.875), 3);
}
// frame and corner ticks at the true edges
rect(0, 0, W, 1, 3); rect(0, H - 1, W, 1, 3); rect(0, 0, 1, H, 3); rect(W - 1, 0, 1, H, 3);
for (const [x, y] of [[8, 8], [W - 16, 8], [8, H - 16], [W - 16, H - 16]]) { rect(x, y + 3, 8, 2, 3); rect(x + 3, y, 2, 8, 3); }

// 2. title row
text('CARTRIDGE  CRT TEST', 16, 24, 3);

// 3. colour bars (y 40..103), 32px wide from x 16
const bars = [[0, 3], [2, 1], [2, 2], [1, 2], [2, 3], [1, 1], [1, 3]];
bars.forEach(([p, c], i) => { rect(16 + i * 32, 40, 32, 56, c); pal(16 + i * 32, 32, 32, 64, p); });
// keep the title cells grey
pal(0, 16, 256, 16, 0);
// the bars sit in cells 32..95, so the row 32..39 above them shares their palette: clear it to black
rect(16, 32, 224, 8, 0);
// row 96..111 is grey palette: a pluge strip under the bars
pal(16, 96, 224, 16, 0);
for (let i = 0; i < 7; i++) rect(16 + i * 32, 96, 32, 8, [3, 0, 2, 0, 1, 0, 3][i]);
rect(16, 104, 224, 8, 0);

// 4. grey ramp with checker dithers (y 112..135)
const ramp = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 3], [3, 3]];
ramp.forEach(([a, b], i) => { for (let y = 112; y < 136; y++) for (let x = 16 + i * 32; x < 48 + i * 32; x++) set(x, y, (x + y) & 1 ? b : a); });
pal(16, 112, 224, 32, 0);
rect(16, 136, 224, 8, 0);

// 5. warm ramp (y 144..159) in palette 3
ramp.forEach(([a, b], i) => { for (let y = 144; y < 160; y++) for (let x = 16 + i * 32; x < 48 + i * 32; x++) set(x, y, (x + y) & 1 ? b : a); });
pal(16, 144, 224, 16, 3);

// 6. fine lines (y 160..191) grey palette
pal(16, 160, 224, 32, 0);
const zones = [
  (x, y) => (x & 1 ? 0 : 3),           // 1px verticals
  (x, y) => (x & 2 ? 0 : 3),           // 2px verticals
  (x, y) => (y & 1 ? 0 : 3),           // 1px horizontals
  (x, y) => (y & 2 ? 0 : 3),           // 2px horizontals
  (x, y) => ((x + y) & 1 ? 0 : 3),     // checker
  (x, y) => (((x + y) & 7) === 0 ? 3 : 0), // diagonals
  (x, y) => ((x & 3) === 0 && (y & 3) === 0 ? 3 : 0), // dots
];
zones.forEach((f, i) => { for (let y = 160; y < 192; y++) for (let x = 0; x < 32; x++) set(16 + i * 32 + x, y, f(x, y)); });

// 7. text (y 192..223): white on black, then red on blue, then green on black
pal(16, 192, 224, 16, 0);
text('THE QUICK BROWN FOX JUMPS', 28, 192, 3);
text('OVER THE LAZY DOG 0123456789', 16, 200, 3);
pal(16, 208, 112, 16, 1); pal(128, 208, 112, 16, 2);
rect(16, 208, 112, 16, 3);           // blue panel
text('RED/BLUE', 24, 212, 1, 3);
rect(128, 208, 112, 16, 0);
text('YEL CYN MAG', 132, 212, 1);
text('CYN', 132 + 32, 212, 2); text('MAG', 132 + 64, 212, 3);

// sprite tiles: solid block and ball, appended after background tiles
const SOLID = Array(64).fill(1);
const BALL = Array.from({ length: 64 }, (_, i) => { const x = (i & 7) - 3.5, y = (i >> 3) - 3.5; return x * x + y * y < 13 ? (x * x + y * y < 4 ? 3 : 1) : 0; });

// cut into tiles
const tiles = [], index = new Map(), nt = new Uint8Array(1024);
const addTile = (t) => { const k = t.join(''); if (!index.has(k)) { index.set(k, tiles.length); tiles.push(t); } return index.get(k); };
addTile(Array(64).fill(0));
for (let ty = 0; ty < 30; ty++) for (let tx = 0; tx < 32; tx++) {
  const t = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t.push(px[(ty * 8 + y) * W + tx * 8 + x]);
  nt[ty * 32 + tx] = addTile(t);
}
const solid = addTile(SOLID), ball = addTile(BALL);
if (tiles.length > 256) throw new Error(`too many tiles: ${tiles.length}`);
for (let ay = 0; ay < 8; ay++) for (let ax = 0; ax < 8; ax++) {
  const a = (cx, cy) => (cy < 15 ? attr[cy * 16 + cx] : 0);
  nt[960 + ay * 8 + ax] = a(ax * 2, ay * 2) | (a(ax * 2 + 1, ay * 2) << 2) | (a(ax * 2, ay * 2 + 1) << 4) | (a(ax * 2 + 1, ay * 2 + 1) << 6);
}
const chr = new Uint8Array(8192);
tiles.forEach((t, i) => { for (let y = 0; y < 8; y++) { let lo = 0, hi = 0; for (let x = 0; x < 8; x++) { const c = t[y * 8 + x]; lo |= (c & 1) << (7 - x); hi |= ((c >> 1) & 1) << (7 - x); } chr[i * 16 + y] = lo; chr[i * 16 + 8 + y] = hi; } });

fs.writeFileSync(path.join(here, 'card.chr'), chr);
fs.writeFileSync(path.join(here, 'card.nam'), nt);
fs.writeFileSync(path.join(here, 'card.pal'), Uint8Array.from(PAL.flat()));
fs.writeFileSync(path.join(here, 'tiles.inc'), `TILE_SOLID = ${solid}\nTILE_BALL = ${ball}\n`);
console.log(`${tiles.length} tiles`);
