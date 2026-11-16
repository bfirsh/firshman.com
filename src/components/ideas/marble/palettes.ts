import { M } from './level';

export interface Palette {
  name: string;
  sky: [string, string, string]; // top, horizon, below
  sun: string; sunI: number;
  hemiSky: string; hemiGround: string; hemiI: number;
  haze: string;
  glow: string; plate: string; ink: string; paper: string;
  vane: [string, string];
  night?: boolean;
  m: Record<number, string>;
}

const mk = (p: Omit<Palette, 'm'>, m: Partial<Record<keyof typeof M, string>>): Palette => {
  const out: Record<number, string> = {};
  for (const k in m) out[(M as any)[k]] = (m as any)[k];
  return { ...p, m: out };
};

export const PALETTES: Palette[] = [
  mk(
    { name: 'rose dusk', sky: ['#e9a5a5', '#fde3cf', '#f7cdbd'], sun: '#fff0dc', sunI: 2.3, hemiSky: '#ffe6da', hemiGround: '#b8707f', hemiI: 1.25, haze: '#f8d3c4', glow: '#ffc56e', plate: '#3fb0ad', ink: '#5a2f45', paper: '#fff7ef', vane: ['#2f9aa6', '#f0566a'] },
    { floorA: '#f8e7d5', floorB: '#f0dac6', wall: '#e9a092', cap: '#f6c6b4', stone: '#da8c86', stoneDark: '#bb6f7a', rock1: '#9f6079', rock2: '#83526f', window: '#6a3a5a', leaf1: '#8cc8a6', leaf2: '#69b294', leaf3: '#b2dcb4', trunk: '#8a5753', fl1: '#fff6e4', fl2: '#ffcf63', fl3: '#f2869f', soil: '#b9786a', accent: '#3f9ea6', accent2: '#f3b85c', hedge: '#78b896', rim: '#f6dfcd', inlay: '#e7b39d', vine: '#7dbd97', tower: '#f2b9a7', trim: '#fde6d6', water: '#79bcc4', glow: '#ffd27a' },
  ),
  mk(
    { name: 'sea glass', sky: ['#8fcfca', '#f3efdb', '#d8ead9'], sun: '#fff6e4', sunI: 2.2, hemiSky: '#e8fbf6', hemiGround: '#3f8187', hemiI: 1.25, haze: '#dcebdf', glow: '#ffd98a', plate: '#ee7a6a', ink: '#1f4a55', paper: '#f8fbf5', vane: ['#ee6f5f', '#f7c65e'] },
    { floorA: '#f5eedb', floorB: '#ebe2c9', wall: '#72c1b4', cap: '#ade0d2', stone: '#52a59c', stoneDark: '#3d8489', rock1: '#306b77', rock2: '#265569', window: '#1d4457', leaf1: '#f39a89', leaf2: '#e47a75', leaf3: '#f8c0a5', trunk: '#6d5a53', fl1: '#ffffff', fl2: '#ffd06e', fl3: '#f37c7c', soil: '#c49b78', accent: '#ee7c6c', accent2: '#ffd06e', hedge: '#8ecfa5', rim: '#e5f3ea', inlay: '#c3e3d8', vine: '#78c39b', tower: '#92d2c6', trim: '#e8f5ef', water: '#6ab4d0', glow: '#ffe09a' },
  ),
  mk(
    { name: 'lavender night', sky: ['#24254f', '#b07fae', '#5f4b8a'], sun: '#ffe2c4', sunI: 1.5, hemiSky: '#bfb2ff', hemiGround: '#4a3c7a', hemiI: 1.35, haze: '#8f73ad', glow: '#ffbf5e', plate: '#ffd27a', ink: '#2a2350', paper: '#f6f1ff', vane: ['#ffcf6e', '#f58fbf'], night: true },
    { floorA: '#e6daf0', floorB: '#dacde9', wall: '#9c8cc9', cap: '#c4b7e7', stone: '#7b6cb3', stoneDark: '#5d4f97', rock1: '#463b7d', rock2: '#352c63', window: '#ffc768', leaf1: '#7fc4c0', leaf2: '#5ea9b5', leaf3: '#a6decf', trunk: '#5a4a6e', fl1: '#fff3c4', fl2: '#ffd27a', fl3: '#f59ac0', soil: '#8a6f99', accent: '#f2c46b', accent2: '#ffe3a0', hedge: '#6db5af', rim: '#d9cfee', inlay: '#c6b5e7', vine: '#68b3a8', tower: '#b2a3dc', trim: '#eae2f7', water: '#6cc4d8', glow: '#ffcf6e' },
  ),
  mk(
    { name: 'saffron noon', sky: ['#ffc98a', '#fff3e0', '#ffe2c2'], sun: '#fff4dc', sunI: 2.4, hemiSky: '#fff6e8', hemiGround: '#c48a5f', hemiI: 1.2, haze: '#ffe6c8', glow: '#ffd27a', plate: '#3a7bd0', ink: '#3a2a1e', paper: '#fffaf1', vane: ['#3a7bd0', '#f2696b'] },
    { floorA: '#fff6e6', floorB: '#f2dfc2', wall: '#f6efe2', cap: '#ffffff', stone: '#e8c398', stoneDark: '#d6996b', rock1: '#c27752', rock2: '#9e5d47', window: '#3a5f9c', leaf1: '#9cc56b', leaf2: '#7dad59', leaf3: '#c3de8c', trunk: '#8a6345', fl1: '#ffffff', fl2: '#3d7fd1', fl3: '#f2696b', soil: '#c79367', accent: '#3a7bd0', accent2: '#f2696b', hedge: '#8fbf63', rim: '#fff1dd', inlay: '#f4d3a2', vine: '#8cba5d', tower: '#fbf5ec', trim: '#f6dbb2', water: '#5aa6d4', glow: '#ffd47e' },
  ),
  mk(
    { name: 'peach mist', sky: ['#aebfe3', '#fde4d2', '#e9d3d6'], sun: '#fff0e2', sunI: 2.2, hemiSky: '#eef2ff', hemiGround: '#6b82ad', hemiI: 1.3, haze: '#ecd9dc', glow: '#ffd38a', plate: '#e3685a', ink: '#2d3a5a', paper: '#fffaf5', vane: ['#e3685a', '#7cc0e6'] },
    { floorA: '#f7efe6', floorB: '#ece1d5', wall: '#f3a689', cap: '#ffd1ba', stone: '#8aa0c8', stoneDark: '#6f86b2', rock1: '#586c99', rock2: '#44557d', window: '#2e3a5b', leaf1: '#f6c26a', leaf2: '#efa459', leaf3: '#fbd98c', trunk: '#6b5a5a', fl1: '#ffffff', fl2: '#f47f7f', fl3: '#8ac6e8', soil: '#b98c76', accent: '#e3685a', accent2: '#8ac6e8', hedge: '#9cc48a', rim: '#f8e6d8', inlay: '#ffcdb5', vine: '#92b77d', tower: '#ffbfa4', trim: '#fde7db', water: '#7cc4e4', glow: '#ffd88f' },
  ),
];
