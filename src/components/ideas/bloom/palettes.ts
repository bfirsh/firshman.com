// Hand-picked palettes for Bloom. `core` is the colour a voxel settles into
// as it ages; `tip` is how it arrives. Everything else is seeded.

export type Form = 'fan' | 'frost';

export type Palette = {
  name: string;
  dark: boolean;
  bg: string; // page and ground
  bg2: string; // a slightly lighter wash behind the growth
  shadow: string; // shadow tint on the ground
  core: string;
  mid: string;
  tip: string;
  key: string; // key light
  sky: string; // hemisphere: from above
  ground: string; // hemisphere: bounce
  ink: string;
  muted: string;
  forms: Form[];
};

export const PALETTES: Palette[] = [
  { name: 'frost', dark: false, bg: '#bdb7ae', bg2: '#cac5bd', shadow: '#3b322b', core: '#f6f3ee', mid: '#dde7ee', tip: '#8fb5d2', key: '#fff6ea', sky: '#f4f1ec', ground: '#b9b1a6', ink: '#23211e', muted: '#5f5a53', forms: ['frost', 'fan'] },
  { name: 'rust', dark: false, bg: '#e5dfd5', bg2: '#ede8e0', shadow: '#4b3428', core: '#8e3f22', mid: '#c98a62', tip: '#f1e9dc', key: '#fff3e2', sky: '#f6f0e6', ground: '#c7b6a2', ink: '#2a211b', muted: '#6c5d50', forms: ['fan'] },
  { name: 'coral', dark: true, bg: '#1c1a1d', bg2: '#242126', shadow: '#000000', core: '#e7dccb', mid: '#efc3ad', tip: '#f08f74', key: '#ffeedd', sky: '#5d5660', ground: '#2a2427', ink: '#ebe5df', muted: '#9a928c', forms: ['fan', 'frost'] },
  { name: 'lichen', dark: false, bg: '#dcdbd1', bg2: '#e6e5dc', shadow: '#3c3f2e', core: '#5d6a4a', mid: '#a8b38b', tip: '#eef0dc', key: '#fff8e8', sky: '#f2f1e8', ground: '#b6b49f', ink: '#22241c', muted: '#5d6052', forms: ['fan'] },
  { name: 'slate', dark: true, bg: '#121416', bg2: '#191c1f', shadow: '#000000', core: '#68757f', mid: '#a9b4ba', tip: '#f3efe4', key: '#fff4e4', sky: '#4b5359', ground: '#1d2023', ink: '#e4e6e6', muted: '#8d9497', forms: ['frost', 'fan'] },
  { name: 'celadon', dark: false, bg: '#b8beb6', bg2: '#c6cbc3', shadow: '#26302c', core: '#fbfaf6', mid: '#d3e4dc', tip: '#6fa18e', key: '#fffaf0', sky: '#f5f6f2', ground: '#b8bdb3', ink: '#1d2421', muted: '#59625d', forms: ['frost', 'fan'] },
];

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
