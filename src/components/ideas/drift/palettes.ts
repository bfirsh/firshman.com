// Hand-picked palettes for Drift. Each edition draws one of these, so the
// colour is always one of a known-good set; everything else is seeded.

export type Mode = 'swell' | 'dunes' | 'haze';

export type Palette = {
  name: string;
  dark: boolean;
  sky: string; // top of the sky
  haze: string; // horizon, and the fog the field dissolves into
  sun: string; // glow around the light, in the haze
  deep: string; // column sides, deepest troughs
  low: string; // trough tops
  high: string; // crest tops
  key: string; // key light colour
  ink: string; // text
  muted: string; // secondary text
  modes: Mode[];
};

export const PALETTES: Palette[] = [
  { name: 'stone', dark: false, sky: '#e8e7e3', haze: '#d6d3cc', sun: '#fff1d8', deep: '#22272e', low: '#454e59', high: '#d4cfc4', key: '#fff2de', ink: '#1c2025', muted: '#5a6069', modes: ['swell', 'haze', 'dunes'] },
  { name: 'lavender', dark: false, sky: '#cbc5d4', haze: '#dccfd2', sun: '#ffd8c2', deep: '#1c1a29', low: '#3a3550', high: '#cbbccd', key: '#ffdcc8', ink: '#1b1925', muted: '#4c475b', modes: ['swell', 'haze'] },
  { name: 'sand', dark: false, sky: '#eee8de', haze: '#e6d8c6', sun: '#ffe4c0', deep: '#4f372a', low: '#8a644b', high: '#eed6b6', key: '#fff0d4', ink: '#291f18', muted: '#6b5a4c', modes: ['dunes', 'haze'] },
  { name: 'seafog', dark: false, sky: '#e1e5e3', haze: '#cdd6d3', sun: '#f7f5ea', deep: '#1a2727', low: '#324648', high: '#b9c9c5', key: '#f8f5ea', ink: '#162020', muted: '#4e5e5c', modes: ['swell', 'haze'] },
  { name: 'moon', dark: true, sky: '#0c1115', haze: '#1d272d', sun: '#7f97a2', deep: '#0b1216', low: '#2b3c45', high: '#a9bfc8', key: '#c4d7df', ink: '#d9e1e4', muted: '#87949a', modes: ['swell', 'haze'] },
  { name: 'ember', dark: true, sky: '#201a22', haze: '#523c3c', sun: '#ff9a6a', deep: '#1d1315', low: '#5c3f39', high: '#dba283', key: '#ffb088', ink: '#ecdfd5', muted: '#a39188', modes: ['dunes', 'swell'] },
  { name: 'paper', dark: false, sky: '#edeff1', haze: '#dce1e7', sun: '#ffffff', deep: '#172131', low: '#2c3d56', high: '#c6d0dd', key: '#fbfaf6', ink: '#17202b', muted: '#55606f', modes: ['haze', 'swell'] },
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
