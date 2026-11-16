// Per-visit world: seeded PRNG, season palette, moon and wind.

export function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RGB = [number, number, number];
export type Season = {
  key: string;
  name: string;
  zenith: RGB;
  mid: RGB;
  horizon: RGB;
  glow: RGB; // twilight glow low on one side of the sky
  hills: RGB;
  grass: RGB[];
  tip: RGB;
  ground: RGB;
  seed: RGB[]; // seed head colours
  seedShare: number;
  flowers: { petal: RGB; center: RGB; w: number; open: number; cup: boolean }[];
  flowerShare: number;
  firefly: [RGB, RGB];
  fog: number;
  mist: number;
  moonTint: RGB;
  trees: RGB;
  stars: number;
};

const SEASONS: Season[] = [
  {
    key: 'midsummer', name: 'midsummer',
    zenith: [0.0025, 0.006, 0.026], mid: [0.007, 0.02, 0.065], horizon: [0.03, 0.07, 0.12], glow: [0.05, 0.12, 0.13],
    hills: [0.012, 0.025, 0.045],
    grass: [[0.1, 0.24, 0.08], [0.14, 0.3, 0.1], [0.07, 0.2, 0.11], [0.17, 0.3, 0.09]], tip: [0.32, 0.42, 0.14], ground: [0.02, 0.04, 0.025],
    seed: [[0.48, 0.46, 0.3], [0.38, 0.4, 0.22]], seedShare: 0.2,
    flowers: [
      { petal: [0.9, 0.9, 0.84], center: [0.95, 0.66, 0.1], w: 4, open: 1, cup: false },
      { petal: [0.48, 0.14, 0.55], center: [0.3, 0.06, 0.32], w: 2, open: 0.7, cup: false },
      { petal: [0.16, 0.3, 0.95], center: [0.1, 0.12, 0.4], w: 2, open: 0.9, cup: false },
      { petal: [0.98, 0.78, 0.08], center: [0.9, 0.5, 0.05], w: 1.5, open: 0.8, cup: true },
    ],
    flowerShare: 0.09,
    firefly: [[0.85, 1.0, 0.32], [1.0, 0.85, 0.3]], fog: 0.017, mist: 0.15, moonTint: [0.82, 0.9, 1.0], trees: [0.012, 0.03, 0.03], stars: 0.85,
  },
  {
    key: 'late-summer', name: 'late summer, poppies',
    zenith: [0.0025, 0.004, 0.024], mid: [0.008, 0.014, 0.06], horizon: [0.04, 0.05, 0.1], glow: [0.13, 0.07, 0.05],
    hills: [0.02, 0.018, 0.035],
    grass: [[0.3, 0.27, 0.1], [0.22, 0.25, 0.09], [0.36, 0.3, 0.12], [0.15, 0.22, 0.08]], tip: [0.55, 0.45, 0.2], ground: [0.035, 0.03, 0.02],
    seed: [[0.72, 0.56, 0.3], [0.6, 0.5, 0.28], [0.8, 0.66, 0.38]], seedShare: 0.42,
    flowers: [
      { petal: [0.92, 0.05, 0.03], center: [0.02, 0.015, 0.02], w: 6, open: 1, cup: true },
      { petal: [0.16, 0.28, 0.95], center: [0.1, 0.1, 0.4], w: 1.2, open: 0.9, cup: false },
      { petal: [0.9, 0.88, 0.82], center: [0.9, 0.62, 0.1], w: 0.8, open: 1, cup: false },
    ],
    flowerShare: 0.11,
    firefly: [[1.0, 0.86, 0.3], [0.9, 1.0, 0.38]], fog: 0.02, mist: 0.2, moonTint: [1.0, 0.9, 0.78], trees: [0.02, 0.022, 0.02], stars: 0.75,
  },
  {
    key: 'early-autumn', name: 'early autumn',
    zenith: [0.002, 0.005, 0.02], mid: [0.006, 0.016, 0.05], horizon: [0.045, 0.06, 0.09], glow: [0.06, 0.07, 0.1],
    hills: [0.014, 0.02, 0.036],
    grass: [[0.32, 0.18, 0.08], [0.24, 0.2, 0.09], [0.16, 0.2, 0.1], [0.4, 0.24, 0.1]], tip: [0.55, 0.36, 0.16], ground: [0.03, 0.025, 0.02],
    seed: [[0.82, 0.78, 0.7], [0.66, 0.56, 0.42]], seedShare: 0.32,
    flowers: [
      { petal: [0.6, 0.48, 0.9], center: [0.95, 0.7, 0.15], w: 4, open: 1, cup: false },
      { petal: [0.95, 0.72, 0.08], center: [0.8, 0.45, 0.05], w: 1.5, open: 0.85, cup: false },
      { petal: [0.75, 0.1, 0.25], center: [0.3, 0.04, 0.1], w: 1, open: 0.6, cup: true },
    ],
    flowerShare: 0.06,
    firefly: [[0.95, 1.0, 0.5], [1.0, 0.78, 0.35]], fog: 0.026, mist: 0.6, moonTint: [1.0, 0.82, 0.62], trees: [0.03, 0.022, 0.02], stars: 1.0,
  },
];

export type World = {
  seed: number;
  edition: string;
  rand: () => number;
  season: Season;
  moon: { phase: number; tilt: number; size: number; bright: number };
  wind: { angle: number; strength: number; gust: number; speed: number };
  glowAz: number;
  mwTilt: number;
};

export function makeWorld(): World {
  const q = new URLSearchParams(location.search);
  let seed = parseInt(q.get('seed') || '', 10);
  if (!Number.isFinite(seed)) seed = Math.floor(Math.random() * 1e9);
  const rand = mulberry32(seed);
  const sq = q.get('season');
  let season = SEASONS[Math.floor(rand() * SEASONS.length)];
  if (sq) season = SEASONS.find((s) => s.key === sq) ?? season;
  const moon = {
    phase: 0.38 + rand() * 0.62, // 0 new .. 1 full
    tilt: (rand() - 0.5) * 1.6,
    size: 0.032 + rand() * 0.012,
    bright: 0.8 + rand() * 0.4,
  };
  const wind = {
    angle: (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 1.6,
    strength: 0.35 + rand() * 0.6,
    gust: 0.5 + rand() * 0.5,
    speed: 1.2 + rand() * 1.6,
  };
  return {
    seed, rand, season, moon, wind,
    edition: String(seed % 10000).padStart(4, '0'),
    glowAz: (rand() - 0.5) * 2.2,
    mwTilt: (rand() - 0.5) * 1.2,
  };
}
