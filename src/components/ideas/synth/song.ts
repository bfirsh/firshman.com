// Seeded song generation: key, chords and a 16-step pattern per voice.
import type { Voice } from './channels';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MODES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
const ROOTS = [
  { pc: 9, name: 'A' }, { pc: 0, name: 'C' }, { pc: 2, name: 'D' },
  { pc: 4, name: 'E' }, { pc: 5, name: 'F' }, { pc: 7, name: 'G' }, { pc: 11, name: 'B' },
];
const PROGS = [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 4, 5, 3], [0, 5, 3, 4], [0, 2, 5, 6], [0, 3, 6, 5]];
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m: number) => NOTE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export type Song = {
  seed: number;
  pc: number;
  keyName: string;
  mode: string;
  scale: number[];
  prog: number[];
  patterns: boolean[][];
  hook: number[]; // degree offsets per step for the square lead
};

export function makeSong(seed: number, voices: Voice[]): Song {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const root = pick(ROOTS);
  const mode = r() < 0.6 ? 'minor' : 'dorian';
  const prog = pick(PROGS);
  const steps = (fn: (s: number) => boolean) => Array.from({ length: 16 }, (_, s) => fn(s));
  const atLeast = (p: boolean[], n: number, prefer: number[]) => {
    let i = 0;
    while (p.filter(Boolean).length < n && i < prefer.length) p[prefer[i++]] = true;
    return p;
  };
  const gen: Record<Voice, () => boolean[]> = {
    kick: () => steps((s) => s === 0 || s === 8 || ((s === 4 || s === 12) && r() < 0.8) || ([3, 6, 10, 14, 15].includes(s) && r() < 0.16)),
    bass: () => atLeast(steps((s) => s === 0 || ([2, 3, 5, 6, 7, 10, 11, 13, 14].includes(s) && r() < 0.3)), 4, [6, 10, 3, 14]),
    hat: () => steps((s) => s % 4 === 2 || (s % 2 === 0 && r() < 0.45) || (s % 2 === 1 && r() < 0.18)),
    type: () => { let prev = false; return steps(() => (prev = r() < (prev ? 0.38 : 0.2))); },
    paper: () => steps((s) => s === 4 || s === 12 || r() < 0.06),
    pluck: () => steps((s) => (s % 2 === 0 ? r() < 0.72 : r() < 0.08)),
    square: () => atLeast(steps((s) => (s % 2 === 0 ? r() < 0.3 : r() < 0.1)), 4, [0, 6, 10, 12]),
    pad: () => steps((s) => s === 0 || (s === 8 && r() < 0.3)),
    whale: () => steps((s) => s === 0),
    ai: () => atLeast(steps((s) => (s % 2 === 0 ? r() < 0.5 : r() < 0.16)), 5, [0, 4, 7, 10, 14]),
  };
  const patterns = voices.map((v) => gen[v]());
  const offs = [0, 2, 4, 4, 7, 5, 2, 9, 0, 4];
  const hook = Array.from({ length: 16 }, () => pick(offs));
  return { seed, pc: root.pc, keyName: root.name, mode, scale: MODES[mode], prog, patterns, hook };
}

export function midiOf(song: Song, degree: number, base: number) {
  const o = Math.floor(degree / 7);
  const d = ((degree % 7) + 7) % 7;
  return base + song.pc + o * 12 + song.scale[d];
}
