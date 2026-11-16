// Constellation figures. Each one draws a single item from the homepage.
// Coordinates are loose sketches; they're normalised to fit a unit circle.
import { projects, now, alsoWorkedOn, email, socials } from '../../../data/bio';

type P = [number, number];
export type Figure = {
  id: string;
  lines: P[][];
  stars?: P[]; // extra lone stars (buttons, eyes, sound holes)
  rot?: number; // degrees
};

const ring = (cx: number, cy: number, r: number, n: number, a0 = 0, a1 = 360, ry = r): P[] => {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * ry]);
  }
  return out;
};
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

const cog = (): P[] => {
  const pts: P[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 60 + 30;
    for (const [r, da] of [[0.64, -22], [1, -12], [1, 12], [0.64, 22]] as const) {
      const t = ((a + da) * Math.PI) / 180;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
  }
  pts.push(pts[0]);
  return pts;
};

export const FIGURES: Record<string, Figure> = {
  replicate: { id: 'replicate', lines: [[[-1, -1], [-1, 1], [1, 1]], [[-0.45, -1], [-0.45, 0.45], [1, 0.45]], [[0.1, -1], [0.1, -0.1], [1, -0.1]]] },
  cog: { id: 'cog', lines: [cog()], stars: [[0, 0]] },
  clig: { id: 'clig', lines: [[[-0.9, 0.75], [0.05, 0], [-0.9, -0.75]], [[0.25, -0.75], [1, -0.75]]] },
  compose: { id: 'compose', lines: [rect(-1, -1, -0.06, -0.3), rect(0.06, -1, 1, -0.3), rect(-0.5, -0.18, 0.44, 0.52)] },
  machine: {
    id: 'machine',
    lines: [
      [[-0.88, 0.12], [-0.62, -0.22], [-0.12, -0.42], [0.42, -0.38], [0.8, -0.16], [0.96, 0.1], [0.55, 0.14], [0.05, 0.12], [-0.5, 0.06], [-0.88, 0.12]],
      [[-1, 0.42], [-0.88, 0.12], [-0.7, 0.38]],
      rect(0.04, 0.14, 0.5, 0.48),
    ],
    stars: [[0.7, -0.06]],
  },
  jsnes: {
    id: 'jsnes',
    lines: [
      [[-1, -0.42], [-1, 0.32], [-0.84, 0.48], [0.84, 0.48], [1, 0.32], [1, -0.42], [0.84, -0.58], [-0.84, -0.58], [-1, -0.42]],
      [[-0.78, -0.05], [-0.34, -0.05]],
      [[-0.56, 0.17], [-0.56, -0.27]],
      [[-0.12, -0.3], [0.12, -0.3]],
    ],
    stars: [[0.42, -0.14], [0.72, 0.06]],
  },
  whalebrew: {
    id: 'whalebrew',
    lines: [
      rect(-0.72, -1, 0.4, 0.38),
      [[0.4, 0.16], [0.84, 0.1], [0.8, -0.5], [0.4, -0.56]],
      [[-0.36, 0.56], [-0.2, 0.78], [-0.36, 1]],
      [[0.04, 0.56], [0.2, 0.78], [0.04, 1]],
    ],
  },
  'arxiv-vanity': {
    id: 'arxiv-vanity',
    lines: [
      [[-0.72, 1], [0.32, 1], [0.72, 0.6], [0.72, -1], [-0.72, -1], [-0.72, 1]],
      [[0.32, 1], [0.32, 0.6], [0.72, 0.6]],
      [[-0.42, 0.3], [0.44, 0.3]],
      [[-0.42, -0.1], [0.44, -0.1]],
      [[-0.42, -0.5], [0.16, -0.5]],
    ],
  },
  django: {
    id: 'django',
    rot: -28,
    lines: [
      [...ring(0, -0.48, 0.52, 10, 120, 420), ...ring(0, 0.22, 0.36, 8, -60, 240), [-0.26, -0.03]],
      [[0, 0.58], [0, 1.26]],
      [[-0.1, 1.26], [0.1, 1.26], [0.1, 1.5], [-0.1, 1.5], [-0.1, 1.26]],
    ],
    stars: [[0, -0.2]],
  },
  ukhas: {
    id: 'ukhas',
    lines: [
      [...ring(0, 0.42, 0.56, 12, -60, 240, 0.62), [0, -0.3], ring(0, 0.42, 0.56, 12, -60, 240, 0.62)[0]],
      [[0, -0.3], [0, -0.72]],
      rect(-0.17, -1, 0.17, -0.72),
    ],
  },
  greets: { id: 'greets', lines: [[[-1, 0.28], [-0.5, -0.32], [0, 0.22], [0.5, -0.36], [1, 0.32]]] },
  hello: { id: 'hello', lines: [rect(-1, -0.62, 1, 0.62), [[-1, 0.62], [0, -0.12], [1, 0.62]]] },
};

export type Link = { text: string; url: string };
export type Item = {
  id: string;
  kicker: string;
  title: string;
  url?: string;
  blurb: string;
  links?: Link[]; // greets & hello
};

const pj = (slug: string) => projects.find((p) => p.slug === slug)!;
const proj = (slug: string, kicker: string): Item => {
  const p = pj(slug);
  return { id: slug, kicker, title: p.name, url: p.url, blurb: p.blurb };
};

export const ITEMS: Item[] = [
  { id: 'replicate', kicker: 'now', title: now.name, url: now.url, blurb: `I'm working on it: ${now.blurb}` },
  proj('cog', 'the cog'),
  proj('clig', 'the prompt'),
  proj('compose', 'the stack'),
  proj('machine', 'the whale'),
  proj('jsnes', 'the gamepad'),
  proj('whalebrew', 'the cup'),
  { ...proj('arxiv-vanity', 'the page'), blurb: 'rendered papers from arXiv as responsive web pages' },
  { ...proj('django', 'the guitar'), blurb: 'I worked on class-based views, feeds, and search' },
  { ...proj('ukhas', 'the balloon'), blurb: 'I helped start a group for amateur near-space exploration' },
  {
    id: 'greets',
    kicker: 'greetings',
    title: 'Also worked on',
    blurb: '',
    links: alsoWorkedOn.map((a) => ({ text: a.name, url: a.url })),
  },
  {
    id: 'hello',
    kicker: 'the letter',
    title: 'Say hello',
    url: `mailto:${email}`,
    blurb: email,
    links: socials.map((s) => ({ text: s.name, url: s.url })),
  },
];

export type Slot = { x: number; y: number; star: boolean; vi: number };

// Turn a figure into ordered firefly slots (in unit-circle space) plus line segments.
export function buildSlots(f: Figure, spacing = 0.19) {
  // normalise
  let pts = f.lines.flat().concat(f.stars ?? []);
  const rot = ((f.rot ?? 0) * Math.PI) / 180;
  const R = (p: P): P => [p[0] * Math.cos(rot) - p[1] * Math.sin(rot), p[0] * Math.sin(rot) + p[1] * Math.cos(rot)];
  pts = pts.map(R);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rad = 0;
  for (const [x, y] of pts) rad = Math.max(rad, Math.hypot(x - cx, y - cy));
  const N = (p: P): P => { const q = R(p); return [(q[0] - cx) / rad, (q[1] - cy) / rad]; };

  const slots: Slot[] = [];
  const segs: number[] = []; // x0,y0,x1,y1
  const seen: P[] = [];
  const addStar = (p: P) => {
    for (const s of seen) if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 0.04) return;
    seen.push(p);
    slots.push({ x: p[0], y: p[1], star: true, vi: seen.length - 1 });
  };
  for (const line of f.lines) {
    const L = line.map(N);
    for (let i = 0; i < L.length; i++) {
      addStar(L[i]);
      if (i < L.length - 1) {
        const a = L[i], b = L[i + 1];
        segs.push(a[0], a[1], b[0], b[1]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.round(len / spacing));
        for (let k = 1; k < n; k++) slots.push({ x: a[0] + ((b[0] - a[0]) * k) / n, y: a[1] + ((b[1] - a[1]) * k) / n, star: false, vi: -1 });
      }
    }
  }
  for (const s of f.stars ?? []) addStar(N(s));
  return { slots, segs, stars: seen };
}
