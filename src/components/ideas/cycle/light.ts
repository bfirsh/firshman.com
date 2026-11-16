// Time-of-day lighting: hand-tuned keyframes blended in OKLab so dawn never goes grey.

import { clamp, smoothstep } from './noise';

export type RGB = [number, number, number]; // sRGB 0..1

export const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const lin = (c: RGB): RGB => [toLin(c[0]), toLin(c[1]), toLin(c[2])];

function toOk(c: RGB): RGB {
  const r = toLin(c[0]), g = toLin(c[1]), b = toLin(c[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOk(o: RGB): RGB {
  const l = (o[0] + 0.3963377774 * o[1] + 0.2158037573 * o[2]) ** 3;
  const m = (o[0] - 0.1055613458 * o[1] - 0.0638541728 * o[2]) ** 3;
  const s = (o[0] - 0.0894841775 * o[1] - 1.291485548 * o[2]) ** 3;
  return [
    clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}
export function mixOk(a: RGB, b: RGB, t: number): RGB {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const A = toOk(a), B = toOk(b);
  return fromOk([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface Key {
  h: number;
  zen: string; mid: string; hor: string;
  key: string; keyI: number;
  amb: string; ambI: number;
  haze: string; hazeK: number;
  water: string;
  cHi: string; cMid: string; cLo: string;
  stars: number; lights: number;
}

// prettier-ignore
const KEYS: Key[] = [
  { h: 0,    zen: '#060a20', mid: '#0e1736', hor: '#1c2a56', key: '#8ea6e6', keyI: 0.42, amb: '#20306a', ambI: 0.55, haze: '#18234e', hazeK: 0.55, water: '#081030', cHi: '#3c4a78', cMid: '#262f58', cLo: '#151c3c', stars: 1,    lights: 1 },
  { h: 4.9,  zen: '#080d28', mid: '#141e48', hor: '#2c3264', key: '#8ea6e6', keyI: 0.34, amb: '#26346e', ambI: 0.55, haze: '#232c5c', hazeK: 0.55, water: '#0a1234', cHi: '#444c7e', cMid: '#2a3260', cLo: '#181e42', stars: 0.95, lights: 1 },
  { h: 5.6,  zen: '#101a48', mid: '#2e3676', hor: '#80608e', key: '#7a7ab8', keyI: 0.25, amb: '#3a4682', ambI: 0.62, haze: '#56508a', hazeK: 0.6,  water: '#141c46', cHi: '#9a80aa', cMid: '#544e84', cLo: '#2c2c5c', stars: 0.55, lights: 0.95 },
  { h: 6.15, zen: '#253a80', mid: '#7068a8', hor: '#f4a284', key: '#ff9a6c', keyI: 0.7,  amb: '#5e60a0', ambI: 0.7,  haze: '#b88c9e', hazeK: 0.62, water: '#2a3266', cHi: '#ffb48e', cMid: '#c4809a', cLo: '#5c4c80', stars: 0.15, lights: 0.6 },
  { h: 6.9,  zen: '#3a64b4', mid: '#94a6d6', hor: '#ffcf96', key: '#ffc47e', keyI: 1.15, amb: '#7282bc', ambI: 0.8,  haze: '#e8bea6', hazeK: 0.6,  water: '#36507e', cHi: '#fff2d4', cMid: '#f2b6a2', cLo: '#8c82aa', stars: 0,    lights: 0.1 },
  { h: 8.6,  zen: '#2f6ec8', mid: '#76aae8', hor: '#d6e8f4', key: '#fff0da', keyI: 1.4,  amb: '#88a8da', ambI: 0.85, haze: '#bcd4ea', hazeK: 0.62, water: '#26588a', cHi: '#ffffff', cMid: '#e6eef8', cLo: '#a6b8d4', stars: 0,    lights: 0 },
  { h: 12,   zen: '#2864c4', mid: '#62a0e8', hor: '#cfe6f8', key: '#fffaf0', keyI: 1.5,  amb: '#8eb0e2', ambI: 0.9,  haze: '#bad6f0', hazeK: 0.6,  water: '#225c92', cHi: '#ffffff', cMid: '#eaf2fc', cLo: '#a8bcda', stars: 0,    lights: 0 },
  { h: 15.6, zen: '#2c62bc', mid: '#6a9cdc', hor: '#e2dfcc', key: '#ffe8bc', keyI: 1.4,  amb: '#88a2d2', ambI: 0.85, haze: '#cfd2d6', hazeK: 0.6,  water: '#285484', cHi: '#fff6e2', cMid: '#e8dedc', cLo: '#a0a6c4', stars: 0,    lights: 0 },
  { h: 17.6, zen: '#2e4a9c', mid: '#8a8cc4', hor: '#ffc382', key: '#ffb262', keyI: 1.3,  amb: '#7a76b2', ambI: 0.75, haze: '#e2aa8a', hazeK: 0.6,  water: '#34426e', cHi: '#ffd696', cMid: '#e6a08c', cLo: '#7c6c9c', stars: 0,    lights: 0.15 },
  { h: 18.55,zen: '#202e78', mid: '#a0609c', hor: '#ff7846', key: '#ff6c3a', keyI: 0.9,  amb: '#684c92', ambI: 0.7,  haze: '#c66a7a', hazeK: 0.62, water: '#2c2a5c', cHi: '#ffa25e', cMid: '#d4607a', cLo: '#4c3a72', stars: 0.05, lights: 0.55 },
  { h: 19.25,zen: '#111a4c', mid: '#3a2c6e', hor: '#c45a68', key: '#9a62a4', keyI: 0.32, amb: '#3a3674', ambI: 0.62, haze: '#6a4072', hazeK: 0.6,  water: '#181a44', cHi: '#e27c6e', cMid: '#6c4274', cLo: '#2a2452', stars: 0.4,  lights: 0.9 },
  { h: 20.2, zen: '#090f36', mid: '#17215a', hor: '#383a7a', key: '#8094d2', keyI: 0.32, amb: '#2a3670', ambI: 0.55, haze: '#283266', hazeK: 0.55, water: '#0c1438', cHi: '#4a4c84', cMid: '#2c3062', cLo: '#191d46', stars: 0.85, lights: 1 },
  { h: 24,   zen: '#060a20', mid: '#0e1736', hor: '#1c2a56', key: '#8ea6e6', keyI: 0.42, amb: '#20306a', ambI: 0.55, haze: '#18234e', hazeK: 0.55, water: '#081030', cHi: '#3c4a78', cMid: '#262f58', cLo: '#151c3c', stars: 1,    lights: 1 },
];
const KEYC = KEYS.map((k) => ({
  ...k,
  c: {
    zen: hex(k.zen), mid: hex(k.mid), hor: hex(k.hor), key: hex(k.key), amb: hex(k.amb),
    haze: hex(k.haze), water: hex(k.water), cHi: hex(k.cHi), cMid: hex(k.cMid), cLo: hex(k.cLo),
  },
}));

export interface Light {
  hour: number;
  zen: RGB; mid: RGB; hor: RGB;
  key: RGB; keyI: number; amb: RGB; ambI: number;
  haze: RGB; hazeK: number; water: RGB;
  cHi: RGB; cMid: RGB; cLo: RGB;
  stars: number; lights: number;
  sunA: number; moonA: number; // arc angle 0..PI when above the horizon
  sunUp: number; moonUp: number; // 0..1 visibility
  L: [number, number, number]; // direction to the key light
  glow: RGB; glowI: number;
  rain: number; snow: number; fog: number;
}

const COLS = ['zen', 'mid', 'hor', 'key', 'amb', 'haze', 'water', 'cHi', 'cMid', 'cLo'] as const;

export const SUNRISE = 6.35, SUNSET = 18.75, MOONRISE = 18.4, MOONSET = 6.6;

export function lightAt(hourIn: number, rain: number, snow: number, fog: number): Light {
  const hour = ((hourIn % 24) + 24) % 24;
  let i = 0;
  while (i < KEYC.length - 2 && KEYC[i + 1].h <= hour) i++;
  const a = KEYC[i], b = KEYC[i + 1];
  const t = smoothstep(0, 1, (hour - a.h) / (b.h - a.h));
  const o: any = { hour };
  for (const k of COLS) o[k] = mixOk(a.c[k], b.c[k], t);
  for (const k of ['keyI', 'ambI', 'hazeK', 'stars', 'lights'] as const) o[k] = a[k] + (b[k] - a[k]) * t;

  const sunA = Math.PI * (hour - SUNRISE) / (SUNSET - SUNRISE);
  let mh = hour < 12 ? hour + 24 : hour;
  const moonA = Math.PI * (mh - MOONRISE) / (MOONSET + 24 - MOONRISE);
  o.sunA = sunA; o.moonA = moonA;
  o.sunUp = smoothstep(-0.12, 0.06, Math.sin(sunA)) * (sunA > -1 && sunA < Math.PI + 1 ? 1 : 0);
  o.moonUp = smoothstep(-0.1, 0.08, Math.sin(moonA)) * (moonA > -1 && moonA < Math.PI + 1 ? 1 : 0);

  // Key light direction: sun by day, moon by night.
  const useSun = o.sunUp > 0.02 || o.moonUp < 0.02;
  const A = useSun ? clamp(sunA, -0.2, Math.PI + 0.2) : clamp(moonA, 0, Math.PI);
  const lx = -Math.cos(A), ly = Math.max(0.08, Math.sin(A));
  const n = Math.hypot(lx, ly, 0.35);
  o.L = [lx / n, ly / n, 0.35 / n];
  if (!useSun) o.keyI *= 0.35 + 0.65 * o.moonUp;

  // Sun / moon glow.
  const low = 1 - Math.min(1, Math.sin(clamp(sunA, 0, Math.PI)) * 2.2);
  o.glow = useSun ? mixOk(hex('#fff2d0'), o.key, 0.4 + 0.6 * low) : hex('#9fb4f0');
  o.glowI = useSun ? o.sunUp * (0.35 + 0.65 * low) : o.moonUp * 0.35;

  // Weather: greys the light, flattens the sky.
  o.rain = rain; o.snow = snow; o.fog = fog;
  const over = Math.max(rain, snow * 0.8);
  if (over > 0) {
    const grey = (c: RGB, k: number): RGB => {
      const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      return mix(c, [l * 0.96, l * 1.0, l * 1.08], k);
    };
    for (const k of ['zen', 'mid', 'hor', 'haze', 'water', 'cHi', 'cMid', 'cLo'] as const) o[k] = grey(o[k], over * 0.7);
    o.zen = mix(o.zen, o.mid, over * 0.5);
    o.cHi = mix(o.cHi, o.cMid, over * 0.6);
    o.keyI *= 1 - over * 0.62;
    o.ambI *= 1 + over * 0.12;
    o.hazeK *= 1 + over * 0.9;
    o.glowI *= 1 - over * 0.8;
    o.stars *= 1 - over * 0.85;
  }
  if (fog > 0) {
    o.hazeK *= 1 + fog * 2.4;
    o.haze = mix(o.haze, mix(o.hor, [0.62, 0.64, 0.68].map((v, j) => v * (0.25 + 0.75 * (o.ambI * o.amb[j] + 0.2))) as RGB, 0.5), fog * 0.6);
    o.keyI *= 1 - fog * 0.4;
    o.stars *= 1 - fog * 0.6;
    o.glowI *= 1 - fog * 0.4;
  }
  return o as Light;
}
