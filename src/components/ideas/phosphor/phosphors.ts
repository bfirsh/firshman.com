// Three real CRT phosphors. Each has a fast fluorescent flash and a slower
// afterglow, which on P7 is a different colour entirely.

export type Phosphor = {
  id: string;
  name: string;
  fast: [number, number, number]; // colour of the flash under the beam
  slow: [number, number, number]; // colour of the afterglow
  slowGain: number;
  tauFast: number; // seconds
  tauSlow: number;
  glass: [number, number, number]; // unlit screen
  ui: string; // accent for the HTML around the screen
};

export const PHOSPHORS: Phosphor[] = [
  {
    id: 'P1', name: 'P1 green',
    fast: [0.32, 1.0, 0.46], slow: [0.16, 0.9, 0.3], slowGain: 0.55,
    tauFast: 0.035, tauSlow: 0.32,
    glass: [0.028, 0.036, 0.032], ui: '#7dffa8',
  },
  {
    id: 'P3', name: 'P3 amber',
    fast: [1.0, 0.66, 0.26], slow: [1.0, 0.44, 0.1], slowGain: 0.6,
    tauFast: 0.04, tauSlow: 0.45,
    glass: [0.038, 0.032, 0.028], ui: '#ffb45c',
  },
  {
    id: 'P7', name: 'P7 blue-white',
    fast: [0.6, 0.78, 1.0], slow: [0.6, 0.95, 0.16], slowGain: 0.42,
    tauFast: 0.03, tauSlow: 1.1,
    glass: [0.03, 0.034, 0.038], ui: '#b5d4ff',
  },
];

/** Weighted pick: green is the classic, amber and P7 are treats. */
export function pickPhosphor(r: number) {
  return r < 0.44 ? 0 : r < 0.74 ? 1 : 2;
}
