// Hand-curated palettes for Mycelium. Each is a tone ramp from the plate (0)
// up through the filament colours to the hottest vein (1), plus the text colours.
// `light` palettes are ink-on-paper: the ramp darkens instead of glowing.

export type Palette = {
  name: string;
  light: boolean;
  ramp: [string, string, string, string, string];
  glow: string;
  text: string;
  dim: string;
};

export const palettes: Palette[] = [
  { name: 'gold on ink', light: false, ramp: ['#06070b', '#2a1d0c', '#8a5a1c', '#e6b45c', '#fff4d6'], glow: '#7a4b12', text: '#f1e6cf', dim: '#b9a988' },
  { name: 'bioluminescence', light: false, ramp: ['#010407', '#032430', '#0b7a86', '#4fe0d6', '#e6fffb'], glow: '#06505c', text: '#dff4f2', dim: '#8fb4b3' },
  { name: 'lichen on bone', light: true, ramp: ['#ebe6d9', '#cfcfb4', '#8f9a72', '#4c5a3c', '#1e2619'], glow: '#b9bc98', text: '#1d2119', dim: '#555a4a' },
  { name: 'ember', light: false, ramp: ['#08050a', '#2a0c1c', '#8c2a3c', '#ee7a5a', '#ffe6cf'], glow: '#5e1426', text: '#f6e4dc', dim: '#c19c95' },
  { name: 'moss', light: false, ramp: ['#040605', '#132416', '#4c7e42', '#b8d898', '#f4fbe6'], glow: '#1f4222', text: '#e8f0dc', dim: '#a3b293' },
  { name: 'sumi', light: true, ramp: ['#efebe3', '#cdc8c0', '#857f7a', '#3a3638', '#0f0e12'], glow: '#c9c3ba', text: '#121116', dim: '#55525a' },
  { name: 'nacre', light: false, ramp: ['#05050d', '#1c1a3c', '#5a4f9a', '#b8a6ea', '#fbf4ff'], glow: '#2e2766', text: '#ece8fb', dim: '#a8a2c4' },
];

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
