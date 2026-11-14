// Hand-picked palettes for /ideas/ripple: a near-monochrome field of tiles and
// a single accent that only shows in the deepest troughs or the highest crests.
export type Palette = {
  name: string;
  dark: boolean;
  bg: string; // page background, close to how a flat tile renders
  ink: string;
  dim: string;
  tile: string; // tile albedo
  gap: string; // what shows between the tiles, far below
  accent: string;
  at: 'trough' | 'crest';
  sky: string;
  ground: string;
  key: string;
  hemiI: number;
  keyI: number;
};

export const palettes: Palette[] = [
  {
    name: 'porcelain',
    dark: false,
    bg: '#eeece8',
    ink: '#18181a',
    dim: '#6d6a66',
    tile: '#f4f2ee',
    gap: '#8d8984',
    accent: '#2f4cc4',
    at: 'trough',
    sky: '#ffffff',
    ground: '#b9b4ab',
    key: '#fff6ea',
    hemiI: 1.45,
    keyI: 2.7,
  },
  {
    name: 'bone',
    dark: false,
    bg: '#efe9e0',
    ink: '#221c18',
    dim: '#766b61',
    tile: '#f5eee4',
    gap: '#93877a',
    accent: '#c4552f',
    at: 'crest',
    sky: '#fffaf2',
    ground: '#bcae9c',
    key: '#ffeedb',
    hemiI: 1.45,
    keyI: 2.7,
  },
  {
    name: 'celadon',
    dark: false,
    bg: '#e8ece8',
    ink: '#16201d',
    dim: '#66706b',
    tile: '#eef2ee',
    gap: '#83908a',
    accent: '#17766c',
    at: 'trough',
    sky: '#fbfffd',
    ground: '#aab5ae',
    key: '#fff8ee',
    hemiI: 1.45,
    keyI: 2.7,
  },
  {
    name: 'rose',
    dark: false,
    bg: '#f0e9e6',
    ink: '#241a1c',
    dim: '#7a6a6c',
    tile: '#f6eeeb',
    gap: '#968485',
    accent: '#a83a63',
    at: 'trough',
    sky: '#fffafa',
    ground: '#bfaeab',
    key: '#fff1e8',
    hemiI: 1.45,
    keyI: 2.7,
  },
  {
    name: 'graphite',
    dark: true,
    bg: '#232427',
    ink: '#eeebe5',
    dim: '#9a968f',
    tile: '#505359',
    gap: '#0b0b0c',
    accent: '#f0a94e',
    at: 'crest',
    sky: '#e8ebf2',
    ground: '#2a2b2e',
    key: '#fff5e8',
    hemiI: 1.3,
    keyI: 3.0,
  },
  {
    name: 'night',
    dark: true,
    bg: '#1a212b',
    ink: '#e6ecf0',
    dim: '#8e9aa5',
    tile: '#3a4757',
    gap: '#080b10',
    accent: '#8fe0cf',
    at: 'crest',
    sky: '#cfe0ff',
    ground: '#14110f',
    key: '#fff2e0',
    hemiI: 1.3,
    keyI: 3.0,
  },
];
