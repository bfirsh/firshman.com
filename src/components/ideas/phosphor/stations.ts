// The stations: each part of the site as a vector drawing the beam can trace.
// Screen space is x ∈ [-1, 1], y ∈ [-0.8, 0.8] (a 10 × 8 division graticule).

import { text, type Pt, type Stroke } from './font';
import { name, email, alsoWorkedOn, socials, projects, now } from '../../../data/bio';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- shapes
export function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 32): Stroke {
  const s: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return s;
}
const circle = (cx: number, cy: number, r: number, n = 40) => arc(cx, cy, r, r, 0, TAU, n);
const rect = (x0: number, y0: number, x1: number, y1: number): Stroke => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

function xf(strokes: Stroke[], cx: number, cy: number, s: number, rot = 0): Stroke[] {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return strokes.map((st) => st.map(([x, y]) => [cx + (x * c - y * sn) * s, cy + (x * sn + y * c) * s] as Pt));
}

function gear(teeth: number): Stroke[] {
  const st: Stroke = [];
  const p = TAU / teeth;
  for (let i = 0; i <= teeth; i++) {
    const t = i * p + p / 2;
    if (i === teeth) { st.push(st[0]); break; }
    st.push([Math.cos(t - 0.31 * p) * 0.78, Math.sin(t - 0.31 * p) * 0.78]);
    st.push([Math.cos(t - 0.17 * p), Math.sin(t - 0.17 * p)]);
    st.push([Math.cos(t + 0.17 * p), Math.sin(t + 0.17 * p)]);
    st.push([Math.cos(t + 0.31 * p) * 0.78, Math.sin(t + 0.31 * p) * 0.78]);
  }
  // close the rim through the gap before the first tooth
  return [st, circle(0, 0, 0.3, 28), circle(0, 0, 0.56, 40)];
}

function star(r = 1, inner = 0.42): Stroke {
  const s: Stroke = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 + (i * TAU) / 10;
    const rr = i % 2 ? inner : 1;
    s.push([Math.cos(a) * rr * r, Math.sin(a) * rr * r]);
  }
  return s;
}

function cloud(): Stroke[] {
  // three bumps over a flat base, traced clockwise in one pass
  const a1 = arc(-0.58, 0.28, 0.28, 0.28, Math.PI * 1.5, Math.PI * 0.62, 14);
  const a2 = arc(-0.04, 0.44, 0.44, 0.44, Math.PI * 0.88, Math.PI * 0.14, 22);
  const a3 = arc(0.56, 0.3, 0.3, 0.3, Math.PI * 0.62, -Math.PI * 0.5, 16);
  return [[...a1, ...a2, ...a3, [-0.58, 0]]];
}

function gamepad(): Stroke[] {
  const body: Stroke = [
    [-0.7, 0.32], [0.7, 0.32], [0.86, 0.2], [0.98, -0.25], [0.86, -0.42], [0.55, -0.42], [0.36, -0.2],
    [-0.36, -0.2], [-0.55, -0.42], [-0.86, -0.42], [-0.98, -0.25], [-0.86, 0.2], [-0.7, 0.32],
  ];
  const c = -0.55, w = 0.07, l = 0.2, cy = 0.02;
  const dpad: Stroke = [
    [c - w, cy + l], [c + w, cy + l], [c + w, cy + w], [c + l, cy + w], [c + l, cy - w], [c + w, cy - w],
    [c + w, cy - l], [c - w, cy - l], [c - w, cy - w], [c - l, cy - w], [c - l, cy + w], [c - w, cy + w], [c - w, cy + l],
  ];
  return [body, dpad, circle(0.44, -0.05, 0.085, 18), circle(0.66, 0.1, 0.085, 18), [[-0.17, 0.04], [-0.04, 0.04]], [[0.04, 0.04], [0.17, 0.04]]];
}

function whale(): Stroke[] {
  const body: Stroke = [
    [0.92, -0.04], [0.86, 0.2], [0.62, 0.38], [0.22, 0.42], [-0.18, 0.32], [-0.52, 0.14], [-0.78, 0.1],
    [-0.96, 0.32], [-1.06, 0.3], [-0.94, 0.04], [-1.06, -0.18], [-0.97, -0.22], [-0.78, -0.03],
    [-0.52, -0.14], [-0.18, -0.32], [0.22, -0.36], [0.6, -0.3], [0.85, -0.17], [0.92, -0.04],
  ];
  return [
    body,
    [[0.9, -0.08], [0.58, -0.12]],
    circle(0.56, 0.1, 0.035, 10),
    [[0.42, 0.42], [0.42, 0.66]],
    [[0.24, 0.74], [0.42, 0.6], [0.6, 0.74]],
    [[-0.3, -0.56], [-0.18, -0.5], [-0.06, -0.56], [0.06, -0.5], [0.18, -0.56], [0.3, -0.5], [0.42, -0.56]],
  ];
}

function documentIcon(): Stroke[] {
  return [
    [[-0.4, -0.55], [0.4, -0.55], [0.4, 0.33], [0.18, 0.55], [-0.4, 0.55], [-0.4, -0.55]],
    [[0.18, 0.55], [0.18, 0.33], [0.4, 0.33]],
    [[-0.27, 0.32], [0.06, 0.32]],
    [[-0.27, 0.17], [0.27, 0.17]],
    [[-0.27, 0.04], [0.27, 0.04]],
    [[-0.27, -0.09], [0.27, -0.09]],
    // a little formula, for the maths
    [[0.2, -0.22], [-0.2, -0.22], [0.0, -0.32], [-0.2, -0.42], [0.2, -0.42]],
  ];
}

function guitar(): Stroke[] {
  const c1y = -0.25, r1 = 0.32, c2y = 0.18, r2 = 0.24;
  const a1 = Math.atan2(0.267, 0.176), a2 = Math.atan2(-0.163, 0.176);
  const outline: Stroke = [
    ...arc(0, c2y, r2, r2, a2, Math.PI - a2, 26),
    ...arc(0, c1y, r1, r1, Math.PI - a1, TAU + a1, 34),
  ];
  return [
    outline,
    circle(0, -0.1, 0.085, 16),
    [[-0.1, -0.38], [0.1, -0.38]],
    [[-0.045, 0.4], [-0.045, 1.0], [-0.08, 1.02], [-0.07, 1.2], [0.07, 1.2], [0.08, 1.02], [0.045, 1.0], [0.045, 0.4]],
  ];
}

function balloon(): Stroke[] {
  // a latex sounding balloon pinched to a neck, a parachute, and the payload box
  const env: Stroke = [];
  for (let i = 0; i <= 48; i++) {
    const a = -Math.PI / 2 + (i / 48) * TAU;
    const lo = Math.max(0, -Math.sin(a));
    env.push([Math.cos(a) * (1 - 0.82 * lo ** 2.2), Math.sin(a) * (1 + 0.3 * lo)]);
  }
  return [
    env,
    [[0, -1.3], [0, -1.75]],
    arc(0, -2.0, 0.34, 0.26, 0, Math.PI, 16),
    [[-0.34, -2.0], [0, -2.4], [0.34, -2.0]],
    [[0, -2.4], [0, -2.55]],
    rect(-0.24, -2.95, 0.24, -2.55),
  ];
}

function envelope(): Stroke[] {
  return [rect(-1, -0.62, 1, 0.62), [[-1, 0.62], [0, -0.1], [1, 0.62]], [[-1, -0.62], [-0.32, 0.12]], [[1, -0.62], [0.32, 0.12]]];
}

function container(x: number, y: number, w: number, h: number): Stroke[] {
  const out: Stroke[] = [rect(x, y, x + w, y + h)];
  for (let i = 1; i < 5; i++) out.push([[x + (w * i) / 5, y + h * 0.18], [x + (w * i) / 5, y + h * 0.82]]);
  return out;
}

function wave(x0: number, x1: number, y: number, amp: number, cycles: number): Stroke {
  const s: Stroke = [];
  const n = Math.round(cycles * 16);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * t);
    s.push([x0 + (x1 - x0) * t, y + Math.sin(t * cycles * TAU) * amp * env]);
  }
  return s;
}

// ---------------------------------------------------------------- stations
export type Station = {
  id: string;
  label: string; // short name for the dial
  draw: () => Stroke[];
};

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));
const up = (s: string) => s.toUpperCase();

export const STATIONS: Station[] = [
  {
    id: 'name',
    label: name,
    draw: () => [
      ...text("HELLO, I'M", 0, 0.3, 0.06),
      ...text(name, 0, 0.0, 0.16),
      wave(-0.7, 0.7, -0.24, 0.045, 7),
    ],
  },
  {
    id: 'replicate',
    label: now.name,
    draw: () => [
      ...text("I'M WORKING ON", 0, 0.36, 0.055),
      ...text(now.name, 0, 0.06, 0.16),
      ...text(now.blurb, 0, -0.2, 0.05),
      ...xf(cloud(), 0, -0.52, 0.16),
    ],
  },
  {
    id: 'cog',
    label: P.cog.name,
    draw: () => [
      ...xf(gear(10), -0.46, 0.0, 0.3),
      ...text('COG', -0.02, 0.06, 0.2, 'left'),
      ...text('CONTAINERS FOR', -0.02, -0.12, 0.052, 'left'),
      ...text('MACHINE LEARNING', -0.02, -0.22, 0.052, 'left'),
    ],
  },
  {
    id: 'clig',
    label: 'CLI Guidelines',
    draw: () => [
      ...text('>_', 0, 0.3, 0.15),
      ...text('COMMAND LINE INTERFACE', 0, 0.06, 0.072),
      ...text('GUIDELINES', 0, -0.08, 0.072),
      ...text('A GUIDE TO HELP YOU WRITE BETTER', 0, -0.32, 0.042),
      ...text('COMMAND-LINE PROGRAMS', 0, -0.42, 0.042),
    ],
  },
  {
    id: 'docker',
    label: 'Docker',
    draw: () => [
      ...container(-0.86, -0.25, 0.3, 0.17),
      ...container(-0.52, -0.25, 0.3, 0.17),
      ...container(-0.69, -0.04, 0.3, 0.17),
      ...text('DOCKER', -0.08, 0.2, 0.06, 'left'),
      ...text('COMPOSE', -0.08, -0.0, 0.12, 'left'),
      ...text('+ MACHINE', -0.08, -0.24, 0.12, 'left'),
    ],
  },
  {
    id: 'jsnes',
    label: P.jsnes.name,
    draw: () => [
      ...xf(gamepad(), 0, 0.3, 0.3),
      ...text('JSNES', 0, -0.12, 0.15),
      ...text('ONE OF THE FIRST JAVASCRIPT EMULATORS', 0, -0.36, 0.042),
    ],
  },
  {
    id: 'whalebrew',
    label: P.whalebrew.name,
    draw: () => [
      ...xf(whale(), 0, 0.3, 0.34),
      ...text('WHALEBREW', 0, -0.12, 0.13),
      ...text(P.whalebrew.blurb, 0, -0.36, 0.05),
    ],
  },
  {
    id: 'arxiv',
    label: P['arxiv-vanity'].name,
    draw: () => [
      ...xf(documentIcon(), -0.52, 0.0, 0.5),
      ...text('ARXIV', -0.18, 0.12, 0.13, 'left'),
      ...text('VANITY', -0.18, -0.08, 0.13, 'left'),
      ...text('PAPERS AS RESPONSIVE', -0.18, -0.26, 0.042, 'left'),
      ...text('WEB PAGES', -0.18, -0.35, 0.042, 'left'),
    ],
  },
  {
    id: 'django',
    label: P.django.name,
    draw: () => [
      ...xf(guitar(), -0.56, 0.02, 0.42, -0.5),
      ...text('DJANGO', -0.2, 0.06, 0.15, 'left'),
      ...text('CLASS-BASED VIEWS,', -0.2, -0.14, 0.048, 'left'),
      ...text('FEEDS AND SEARCH', -0.2, -0.24, 0.048, 'left'),
    ],
  },
  {
    id: 'ukhas',
    label: 'UKHAS',
    draw: () => [
      ...xf(balloon(), -0.56, 0.4, 0.16),
      arc(0, -2.9, 2.6, 2.6, Math.PI * 0.66, Math.PI * 0.34, 40),
      ...text('UKHAS', -0.22, 0.2, 0.15, 'left'),
      ...text('UK HIGH ALTITUDE SOCIETY', -0.22, 0.02, 0.046, 'left'),
      ...text('AMATEUR NEAR-SPACE', -0.22, -0.08, 0.046, 'left'),
      ...text('EXPLORATION', -0.22, -0.18, 0.046, 'left'),
    ],
  },
  {
    id: 'greets',
    label: 'Greets',
    draw: () => [
      ...xf([star()], -0.5, 0.49, 0.05),
      ...text('GREETS TO', 0, 0.45, 0.08),
      ...xf([star()], 0.5, 0.49, 0.05),
      ...alsoWorkedOn.flatMap((g, i) => text(up(g.name), 0, 0.2 - i * 0.14, 0.058)),
    ],
  },
  {
    id: 'contact',
    label: 'Contact',
    draw: () => [
      ...xf(envelope(), 0, 0.3, 0.2),
      ...text(email, 0, -0.1, 0.085),
      ...text(socials.map((s) => s.name).join('   '), 0, -0.32, 0.055),
    ],
  },
];

// ---------------------------------------------------------------- tables
/**
 * Order strokes to keep the blanked jumps short (greedy nearest neighbour,
 * strokes may be reversed), then resample the whole loop uniformly in time:
 * strokes at writing speed, jumps very fast and dim, a little dwell at every
 * stroke end so corners and dots glow the way they do on vector displays.
 */
export function buildTable(strokes: Stroke[], M: number) {
  const pool = strokes.filter((s) => s.length > 1).map((s) => s.slice());
  const ordered: Stroke[] = [];
  let cur: Pt = [-1, 0.5];
  while (pool.length) {
    let bi = 0, br = false, bd = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      const d0 = (s[0][0] - cur[0]) ** 2 + (s[0][1] - cur[1]) ** 2;
      const d1 = (s[s.length - 1][0] - cur[0]) ** 2 + (s[s.length - 1][1] - cur[1]) ** 2;
      if (d0 < bd) { bd = d0; bi = i; br = false; }
      if (d1 < bd) { bd = d1; bi = i; br = true; }
    }
    const s = pool.splice(bi, 1)[0];
    if (br) s.reverse();
    ordered.push(s);
    cur = s[s.length - 1];
  }

  type Seg = { a: Pt; b: Pt; t: number; z: number };
  const segs: Seg[] = [];
  const DWELL = 0.012, JUMP = 10;
  let lit = 0;
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    segs.push({ a: s[0], b: s[0], t: DWELL, z: 1 });
    for (let j = 1; j < s.length; j++) {
      const L = Math.hypot(s[j][0] - s[j - 1][0], s[j][1] - s[j - 1][1]);
      segs.push({ a: s[j - 1], b: s[j], t: L, z: 1 });
      lit += L;
    }
    const end = s[s.length - 1];
    segs.push({ a: end, b: end, t: DWELL, z: 1 });
    const nx = ordered[(i + 1) % ordered.length][0];
    const J = Math.hypot(nx[0] - end[0], nx[1] - end[1]);
    segs.push({ a: end, b: nx, t: J / JUMP + 0.002, z: 0.035 });
  }
  const total = segs.reduce((s, g) => s + g.t, 0);
  const out = new Float32Array(M * 3);
  let si = 0, acc = 0;
  for (let i = 0; i < M; i++) {
    const t = ((i + 0.5) / M) * total;
    while (si < segs.length - 1 && acc + segs[si].t < t) { acc += segs[si].t; si++; }
    const g = segs[si];
    const u = g.t > 0 ? Math.min(1, Math.max(0, (t - acc) / g.t)) : 0;
    out[i * 3] = g.a[0] + (g.b[0] - g.a[0]) * u;
    out[i * 3 + 1] = g.a[1] + (g.b[1] - g.a[1]) * u;
    out[i * 3 + 2] = g.z;
  }
  return { table: out, lit, total };
}

/** Read a resampled table at loop position t ∈ [0, 1), with linear interpolation. */
export function sampleTable(tab: Float32Array, M: number, t: number, out: number[]) {
  const f = (t - Math.floor(t)) * M;
  const i = Math.floor(f) % M, j = (i + 1) % M, u = f - Math.floor(f);
  const a = i * 3, b = j * 3;
  out[0] = tab[a] + (tab[b] - tab[a]) * u;
  out[1] = tab[a + 1] + (tab[b + 1] - tab[a + 1]) * u;
  out[2] = Math.min(tab[a + 2], tab[b + 2]); // never let a blanked jump bleed light
}
