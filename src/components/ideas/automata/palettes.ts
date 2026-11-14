// Hand-picked palettes for /ideas/automata. `cells` runs from a newborn cell
// to one that has almost faded; the renderer blends along it by age.
export type Palette = {
  name: string;
  dark: boolean;
  bg: string; // page and fog
  bg2: string; // the far side of the background gradient
  ink: string;
  dim: string;
  cells: string[];
  sky: string; // hemisphere light, from above
  ground: string; // hemisphere light, from below
  key: string; // key light colour
};

export const palettes: Palette[] = [
  {
    name: 'bismuth',
    dark: true,
    bg: '#121116',
    bg2: '#1b1920',
    ink: '#ece8e1',
    dim: '#9b968f',
    cells: ['#fff4cf', '#f1c45f', '#e0839f', '#8f86e6', '#4fb0c0', '#2b5765'],
    sky: '#d8d4ff',
    ground: '#2a1f1c',
    key: '#fff1dc',
  },
  {
    name: 'glacier',
    dark: true,
    bg: '#0c1218',
    bg2: '#121b24',
    ink: '#e3eaee',
    dim: '#8d9aa3',
    cells: ['#ffffff', '#d6eef6', '#9ccbe0', '#5a95b9', '#2e5f86', '#1c3a55'],
    sky: '#cfe6ff',
    ground: '#1a1712',
    key: '#fff6ea',
  },
  {
    name: 'ember',
    dark: true,
    bg: '#100e0f',
    bg2: '#1a1515',
    ink: '#efe7dd',
    dim: '#9e948a',
    cells: ['#fff1d8', '#f6c27a', '#e7834f', '#b9483f', '#6e2a3c', '#38202c'],
    sky: '#ffe9d2',
    ground: '#1a1020',
    key: '#fff0dd',
  },
  {
    name: 'delft',
    dark: false,
    bg: '#f1eee8',
    bg2: '#e6e2da',
    ink: '#1d1d1f',
    dim: '#6f6b66',
    cells: ['#f6f4ef', '#cfdbef', '#86a5dc', '#3b5cbc', '#1f3283', '#16245e'],
    sky: '#ffffff',
    ground: '#b9b2a6',
    key: '#fff7ec',
  },
  {
    name: 'terracotta',
    dark: false,
    bg: '#f0e9df',
    bg2: '#e5dccf',
    ink: '#241d19',
    dim: '#7a6e64',
    cells: ['#f8f1e6', '#f0d4b8', '#e6a679', '#c76a41', '#913c23', '#5e2116'],
    sky: '#fffaf2',
    ground: '#b8a48e',
    key: '#fff3e2',
  },
  {
    name: 'lichen',
    dark: false,
    bg: '#eceee7',
    bg2: '#e0e3da',
    ink: '#1c201c',
    dim: '#6a7068',
    cells: ['#f3f5ea', '#d9e3bd', '#a9c08a', '#6e9466', '#3f6a4d', '#22392d'],
    sky: '#fbfff6',
    ground: '#a9ad9c',
    key: '#fffbea',
  },
];
