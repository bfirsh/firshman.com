// The scenes for /ideas/zoom. Each one is drawn in its own units: the viewport's short side
// is 1000 units at the moment a scene "arrives", centred on (0, 0), y pointing down.
// Each scene holds a portal; the next scene is drawn inside it at scale `s`.
import { projects, name, now, email } from '../../../data/bio';

export type Portal = { x: number; y: number; w: number; h: number; r: number; s: number; circle?: boolean };
export type Scene = {
  id: string;
  portal: Portal;
  draw(c: CanvasRenderingContext2D, t: number): void;
  // drawn on top of the portal's contents; `cover` is how big the portal is relative to the screen
  over?(c: CanvasRenderingContext2D, t: number, cover: number): void;
};

// ------------------------------------------------------------------ palette
export const INK = '#1f1b2e';
const CREAM = '#f6eedf';
const PAPER = '#fffaf0';
const RED = '#ef553b';
const ORANGE = '#f58a3a';
const YELLOW = '#f9c74f';
const BLUE = '#3a6fe2';
const SKY = '#a8d8f0';
const TEAL = '#3fb39f';
const PINK = '#f4a5b5';
const GREEN = '#0c4b33';
const WOOD = '#d99a5b';
const GREY = '#b9b2a6';
const DARK = '#2b2840';
const NIGHT = '#211d33';
const LW = 6;

const SANS = '"Bricolage Grotesque", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SERIF = 'Georgia, "Times New Roman", serif';

// ------------------------------------------------------------------ helpers
const TAU = Math.PI * 2;
function R(x: number, y: number, w: number, h: number, r = 0) {
  const p = new Path2D();
  if (r) p.roundRect(x, y, w, h, r);
  else p.rect(x, y, w, h);
  return p;
}
function C(x: number, y: number, r: number) {
  const p = new Path2D();
  p.arc(x, y, r, 0, TAU);
  return p;
}
function poly(pts: number[], close = true) {
  const p = new Path2D();
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  if (close) p.closePath();
  return p;
}
function fs(c: CanvasRenderingContext2D, p: Path2D, fill: string | null, lw = LW) {
  if (fill) { c.fillStyle = fill; c.fill(p); }
  if (lw) { c.lineWidth = lw; c.strokeStyle = INK; c.stroke(p); }
}
function line(c: CanvasRenderingContext2D, pts: number[], col = INK, lw = LW) {
  c.lineWidth = lw; c.strokeStyle = col; c.stroke(poly(pts, false));
}
/** fill everything visible (respects the current clip) */
function bg(c: CanvasRenderingContext2D, col: string) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = col;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.restore();
}
/** the visible area in local units */
function view(c: CanvasRenderingContext2D) {
  const m = c.getTransform().inverse();
  const W = c.canvas.width, H = c.canvas.height;
  const xs = [m.e, m.a * W + m.e, m.c * H + m.e, m.a * W + m.c * H + m.e];
  const ys = [m.f, m.b * W + m.f, m.d * H + m.f, m.b * W + m.d * H + m.f];
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const scaleOf = (c: CanvasRenderingContext2D) => Math.hypot(c.getTransform().a, c.getTransform().b);
/** an area is worth drawing if it's on screen and bigger than about a pixel */
function seen(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const k = scaleOf(c);
  if (Math.max(w, h) * k < 0.8) return false;
  const v = view(c);
  return x < v.x1 && x + w > v.x0 && y < v.y1 && y + h > v.y0;
}
function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, font = SANS, weight = 500, align: CanvasTextAlign = 'left') {
  const k = scaleOf(c);
  const px = size * k;
  if (px < 1.2) return; // too small to read; the bar under it is enough
  const w = s.length * size * 0.62;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (!seen(c, x0, y - size, w, size * 1.4)) return;
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillStyle = col;
  c.fillText(s, x, y);
}
// deterministic noise
function rnd(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
/** circles unioned into one outlined blob (clouds, smoke) */
function blob(c: CanvasRenderingContext2D, circles: number[], fill: string, lw = LW) {
  const p = new Path2D();
  for (let i = 0; i < circles.length; i += 3) { p.moveTo(circles[i] + circles[i + 2], circles[i + 1]); p.arc(circles[i], circles[i + 1], circles[i + 2], 0, TAU); }
  c.lineWidth = lw * 2; c.strokeStyle = INK; c.stroke(p);
  c.fillStyle = fill; c.fill(p);
}
function cloud(c: CanvasRenderingContext2D, x: number, y: number, k: number, fill = PAPER) {
  blob(c, [x, y, 40 * k, x + 45 * k, y - 18 * k, 50 * k, x + 100 * k, y, 38 * k, x + 50 * k, y + 12 * k, 40 * k], fill);
}
function gearPath(cx: number, cy: number, ro: number, ri: number, teeth: number, rot: number) {
  const p = new Path2D();
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = rot + i * step;
    const pts = [
      [a - step * 0.5, ri], [a - step * 0.28, ri], [a - step * 0.18, ro], [a + step * 0.18, ro], [a + step * 0.28, ri],
    ];
    for (const [ang, r] of pts) {
      const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
      if (i === 0 && ang === pts[0][0]) p.moveTo(x, y); else p.lineTo(x, y);
    }
  }
  p.closePath();
  return p;
}

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));

// ------------------------------------------------------------------ 0. the desk
const desk: Scene = {
  id: 'home',
  portal: { x: 236, y: -78, w: 176, h: 190, r: 2, s: 0.176 },
  draw(c, t) {
    bg(c, CREAM);
    const v = view(c);
    // wall clock, telling the actual time
    if (seen(c, 470, -420, 180, 180)) {
      fs(c, C(560, -330, 78), PAPER);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; line(c, [560 + Math.cos(a) * 60, -330 + Math.sin(a) * 60, 560 + Math.cos(a) * 68, -330 + Math.sin(a) * 68], INK, 4); }
      const d = new Date();
      const hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * TAU - Math.PI / 2;
      const mA = (d.getMinutes() + d.getSeconds() / 60) / 60 * TAU - Math.PI / 2;
      line(c, [560, -330, 560 + Math.cos(hA) * 36, -330 + Math.sin(hA) * 36], INK, 8);
      line(c, [560, -330, 560 + Math.cos(mA) * 54, -330 + Math.sin(mA) * 54], RED, 5);
      fs(c, C(560, -330, 7), INK, 0);
    }
    // framed picture
    if (seen(c, -680, -440, 230, 260)) {
      fs(c, R(-660, -420, 190, 230, 4), PAPER);
      fs(c, R(-640, -400, 150, 190), SKY, 4);
      fs(c, C(-565, -335, 34), YELLOW, 4);
      fs(c, poly([-640, -210, -590, -280, -555, -240, -520, -290, -490, -210]), TEAL, 4);
    }
    // desk
    fs(c, R(v.x0 - 10, 230, v.x1 - v.x0 + 20, Math.max(10, v.y1 - 220)), WOOD);
    c.fillStyle = '#c4874c'; c.fillRect(v.x0 - 10, 236, v.x1 - v.x0 + 20, 14);
    // plant
    if (seen(c, -700, 0, 260, 240)) {
      for (const [a, l] of [[-2.0, 120], [-1.6, 150], [-1.2, 125], [-2.4, 90], [-0.8, 90]] as const) {
        const x = -575 + Math.cos(a) * l, y = 140 + Math.sin(a) * l;
        const p = new Path2D(); p.moveTo(-575, 140); p.quadraticCurveTo(-575 + Math.cos(a - 0.5) * l * 0.7, 140 + Math.sin(a - 0.5) * l * 0.7, x, y); p.quadraticCurveTo(-575 + Math.cos(a + 0.5) * l * 0.7, 140 + Math.sin(a + 0.5) * l * 0.7, -575, 140);
        fs(c, p, '#3c9a6b', 4);
      }
      fs(c, poly([-630, 140, -520, 140, -535, 232, -615, 232]), RED);
    }
    // mug, steaming
    if (seen(c, 440, 60, 200, 180)) {
      const st = new Path2D();
      for (let i = 0; i < 2; i++) {
        const x = 510 + i * 28, ph = t * 1.4 + i * 2;
        st.moveTo(x, 130);
        for (let y = 130; y > 70; y -= 6) st.lineTo(x + Math.sin(ph + y * 0.08) * 7, y);
      }
      c.lineWidth = 4; c.strokeStyle = 'rgba(31,27,46,.35)'; c.stroke(st);
      const h = new Path2D(); h.arc(578, 186, 22, -Math.PI / 2, Math.PI / 2); fs(c, h, null, 8);
      fs(c, R(480, 140, 100, 92, 10), YELLOW);
    }
    // laptop
    fs(c, R(-380, -332, 760, 484, 24), DARK);
    fs(c, R(-352, -306, 704, 428, 6), PAPER);
    fs(c, poly([-440, 150, 440, 150, 472, 214, -472, 214]), '#cfc8bb');
    fs(c, R(-70, 150, 140, 14, 6), '#b3ab9e', 4);
    // browser chrome
    c.fillStyle = '#ece3d1'; c.fillRect(-352, -306, 704, 36);
    line(c, [-352, -270, 352, -270], INK, 3);
    [RED, YELLOW, TEAL].forEach((col, i) => fs(c, C(-330 + i * 20, -288, 6), col, 2.5));
    fs(c, R(-170, -298, 340, 20, 10), PAPER, 2.5);
    text(c, 'firshman.com', 0, -283.5, 12, INK, MONO, 500, 'center');
    // the homepage itself, in miniature
    text(c, name, -322, -224, 30, INK, SANS, 800);
    text(c, `I'm working on ${now.name}. Some other stuff I've done:`, -322, -192, 12.5, INK, SANS, 600);
    const items = projects.map((p) => `${p.name}, ${p.blurb}.`);
    items.forEach((s, i) => {
      const y = -166 + i * 21;
      fs(c, C(-316, y - 4, 2.2), INK, 0);
      const cut = s.length > 46 ? s.slice(0, 44) + '…' : s;
      if (scaleOf(c) * 11.5 < 1.2) { c.fillStyle = '#cfc7b8'; c.fillRect(-306, y - 9, cut.length * 6.4, 6); }
      else text(c, cut, -306, y, 11.5, INK, SANS, 600);
    });
    text(c, `Email me at ${email}.`, -322, 56, 12.5, INK, SANS, 600);
    // the terminal window that is about to swallow us
    fs(c, R(140, -196, 192, 220, 10), NIGHT);
    c.fillStyle = '#3b3757'; c.fillRect(143, -193, 186, 18);
    [RED, YELLOW, TEAL].forEach((col, i) => fs(c, C(156 + i * 13, -184, 4), col, 0));
    text(c, 'zsh', 236, -180, 10, '#9a93b8', MONO, 500, 'center');
  },
};

// ------------------------------------------------------------------ 1. the terminal
const CLIG_LINES: [string, string, number?][] = [
  ['$ clig --help', CREAM],
  ['', CREAM],
  ['Command Line Interface Guidelines', YELLOW, 700],
  ['a guide to help you write better', '#9a93b8'],
  ['command-line programs.', '#9a93b8'],
  ['', CREAM],
  ['PHILOSOPHY', PINK, 700],
  ['  Human-first design', CREAM],
  ['  Simple parts that work together', CREAM],
  ['  Consistency across programs', CREAM],
  ['  Saying (just) enough', CREAM],
  ['  Ease of discovery', CREAM],
  ['  Conversation as the norm', CREAM],
  ['', CREAM],
  ['$ ', CREAM],
];
const TERM = { x: -430, y: -330, lh: 50, size: 30, cw: 18 };
const cursorLine = CLIG_LINES.length - 1;
const terminal: Scene = {
  id: 'clig',
  portal: { x: TERM.x + 2 * TERM.cw + 9, y: TERM.y + cursorLine * TERM.lh - 10, w: 18, h: 34, r: 0, s: 0.018 },
  draw(c) {
    bg(c, NIGHT);
    CLIG_LINES.forEach(([s, col, w], i) => {
      const y = TERM.y + i * TERM.lh;
      if (s.startsWith('$')) {
        text(c, '$', TERM.x, y, TERM.size, TEAL, MONO, 700);
        text(c, s.slice(1), TERM.x + TERM.cw, y, TERM.size, col, MONO, 500);
      } else text(c, s, TERM.x, y, TERM.size, col, MONO, w ?? 500);
    });
  },
};

// ------------------------------------------------------------------ 2. the container ship
const shipPortholes = Array.from({ length: 10 }, (_, i) => -400 + i * 66);
const PH = 6; // which porthole is the way in
const ship: Scene = {
  id: 'compose',
  portal: { x: shipPortholes[PH], y: 108, w: 20, h: 20, r: 10, s: 0.02, circle: true },
  draw(c, t) {
    bg(c, SKY);
    const v = view(c);
    fs(c, C(330, -330, 72), YELLOW);
    cloud(c, -560 + ((t * 6) % 200), -360, 1.1);
    cloud(c, -120 + ((t * 4) % 150), -420, 0.8);
    cloud(c, 520, -170, 0.7);
    // gulls
    for (let i = 0; i < 2; i++) {
      const x = -260 + i * 90, y = -260 - i * 40 + Math.sin(t * 2 + i) * 6;
      const p = new Path2D(); p.moveTo(x - 22, y); p.quadraticCurveTo(x - 11, y - 14, x, y); p.quadraticCurveTo(x + 11, y - 14, x + 22, y);
      fs(c, p, null, 4);
    }
    // smoke
    blob(c, [372 + Math.sin(t) * 4, -250, 18, 390, -285 - ((t * 10) % 20), 24, 420, -320, 28], '#ffffff', 4);
    // superstructure
    fs(c, R(330, -210, 52, 76, 4), RED);
    c.fillStyle = DARK; c.fillRect(333, -207, 46, 14);
    fs(c, R(290, -138, 150, 182, 6), CREAM);
    fs(c, R(304, -118, 122, 26, 3), DARK, 4);
    fs(c, R(304, -70, 122, 26, 3), DARK, 4);
    // containers, three tiers
    const cols = [BLUE, YELLOW, RED, TEAL, ORANGE, CREAM, PINK];
    const tiers = [9, 8, 6];
    for (let tier = 0; tier < 3; tier++)
      for (let i = 0; i < tiers[tier]; i++) {
        const x = -440 + i * 82 + tier * 20, y = 0 - tier * 44, col = cols[(i * 3 + tier * 5) % cols.length];
        if (!seen(c, x, y, 82, 44)) continue;
        fs(c, R(x, y, 82, 44), col, 4);
        c.fillStyle = 'rgba(31,27,46,.12)';
        for (let k = 1; k < 6; k++) c.fillRect(x + k * 13.5, y + 6, 5, 32);
      }
    // hull
    const hull = poly([-480, 44, 470, 44, 510, 14, 440, 236, -440, 236]);
    fs(c, hull, DARK);
    c.save(); c.clip(hull); c.fillStyle = RED; c.fillRect(-500, 186, 1020, 60); c.restore();
    fs(c, hull, null);
    text(c, 'MV COMPOSE', 300, 168, 24, CREAM, SANS, 800);
    // portholes, one of which is not like the others
    shipPortholes.forEach((x) => {
      fs(c, C(x, 108, 17), YELLOW, 4);
      fs(c, C(x, 108, 10), '#15223f', 3);
    });
    // sea
    c.fillStyle = '#2f5fb3'; c.fillRect(v.x0 - 10, 200, v.x1 - v.x0 + 20, Math.max(0, v.y1 - 190));
    const wv = new Path2D();
    for (let row = 0; row < 4; row++) {
      const y = 214 + row * 60;
      wv.moveTo(-900, y);
      for (let x = -900; x <= 900; x += 30) wv.lineTo(x, y + Math.sin(x * 0.02 + t * 1.2 + row) * 6);
    }
    c.lineWidth = 5; c.strokeStyle = '#5d86d6'; c.stroke(wv);
    line(c, [v.x0 - 10, 200, v.x1 + 10, 200], INK, LW);
  },
  over(c) { fs(c, C(shipPortholes[PH], 108, 10), null, 3); },
};

// ------------------------------------------------------------------ 3. the whale
const EYE = { x: -282, y: -34 };
const whale: Scene = {
  id: 'whalebrew',
  portal: { x: EYE.x, y: EYE.y, w: 26, h: 26, r: 13, s: 0.026, circle: true },
  draw(c, t) {
    bg(c, '#1d3f86');
    const v = view(c);
    // light from above
    c.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 5; i++) { const x = -700 + i * 330; c.fill(poly([x, -900, x + 120, -900, x - 120, 600, x - 260, 600])); }
    // sand and weed
    c.fillStyle = '#e3c58f'; c.fillRect(v.x0 - 10, 430, v.x1 - v.x0 + 20, Math.max(0, v.y1 - 420));
    line(c, [v.x0 - 10, 430, v.x1 + 10, 430]);
    for (let i = 0; i < 7; i++) {
      const x = -640 + i * 210 + rnd(i) * 60, h = 90 + rnd(i + 9) * 90;
      const p = new Path2D(); p.moveTo(x, 432);
      for (let y = 432; y > 432 - h; y -= 10) p.lineTo(x + Math.sin(y * 0.06 + t * 1.5 + i) * 10, y);
      c.lineWidth = 10; c.strokeStyle = '#2f9b6e'; c.stroke(p);
    }
    // bubbles
    for (let i = 0; i < 14; i++) {
      const y = 420 - (((t * 30 + rnd(i) * 900) % 900));
      const x = -600 + rnd(i + 3) * 1200 + Math.sin(t + i) * 8;
      fs(c, C(x, y, 5 + rnd(i + 7) * 9), null, 3);
      c.strokeStyle = CREAM; c.lineWidth = 3; c.stroke(C(x, y, 5 + rnd(i + 7) * 9));
    }
    const flick = Math.sin(t * 1.3) * 18;
    // flukes
    const fl = new Path2D();
    fl.moveTo(400, -20);
    fl.quadraticCurveTo(470, -60 + flick, 560, -150 + flick);
    fl.quadraticCurveTo(520, -40 + flick * 0.5, 470, -10);
    fl.quadraticCurveTo(540, 40 + flick * 0.5, 590, 70 + flick);
    fl.quadraticCurveTo(480, 50 + flick, 400, 10);
    fl.closePath();
    fs(c, fl, '#3f74db');
    // body
    const body = new Path2D();
    body.moveTo(-450, 10);
    body.bezierCurveTo(-455, -150, -260, -190, -40, -172);
    body.bezierCurveTo(160, -158, 330, -80, 430, -18);
    body.lineTo(430, 12);
    body.bezierCurveTo(300, 90, 80, 150, -120, 146);
    body.bezierCurveTo(-330, 140, -448, 100, -450, 10);
    body.closePath();
    fs(c, body, '#5b8def');
    // belly with grooves
    c.save(); c.clip(body);
    const belly = new Path2D();
    belly.moveTo(-460, 40); belly.bezierCurveTo(-250, 60, 50, 70, 440, 0); belly.lineTo(440, 200); belly.lineTo(-460, 200); belly.closePath();
    fs(c, belly, CREAM, 4);
    for (let i = 1; i < 4; i++) line(c, [-400, 50 + i * 22, -150 + i * 30, 72 + i * 20, 120, 60 + i * 18], '#d6c9b2', 4);
    c.restore();
    fs(c, body, null);
    // mouth
    const m = new Path2D(); m.moveTo(-448, 24); m.quadraticCurveTo(-360, 52, -250, 30); fs(c, m, null, 5);
    // flipper
    const fin = new Path2D(); fin.moveTo(-150, 88); fin.quadraticCurveTo(-120, 190, -40, 210); fin.quadraticCurveTo(-70, 140, -60, 96); fin.closePath();
    fs(c, fin, '#3f74db');
    // a few containers riding on its back (it's a Docker whale)
    fs(c, R(-120, -214, 64, 40, 2), YELLOW, 4);
    fs(c, R(-50, -210, 64, 40, 2), RED, 4);
    fs(c, R(-88, -252, 64, 38, 2), TEAL, 4);
    // eye
    fs(c, C(EYE.x, EYE.y, 25), PAPER, 5);
  },
  over(c) {
    fs(c, C(EYE.x, EYE.y, 13), null, 3);
  },
};

// ------------------------------------------------------------------ 4. the cartridge
const cartridge: Scene = {
  id: 'jsnes',
  portal: { x: 0, y: 20, w: 440, h: 320, r: 4, s: 0.32 },
  draw(c) {
    bg(c, NIGHT);
    const v = view(c);
    // pixel dots
    c.fillStyle = '#2d2846';
    const step = 40;
    if ((v.x1 - v.x0) / step < 200) for (let x = Math.floor(v.x0 / step) * step; x < v.x1; x += step) for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) c.fillRect(x - 3, y - 3, 6, 6);
    const shell = poly([-310, -360, 310, -360, 310, 320, 270, 360, -270, 360, -310, 320]);
    fs(c, shell, '#a59e93');
    for (let y = -340; y <= -280; y += 15) line(c, [-280, y, 280, y], '#7e776d', 4);
    fs(c, R(-262, -256, 524, 500, 10), '#bcb5a9', 4);
    // label
    fs(c, R(-240, -236, 480, 450, 6), INK);
    text(c, 'JSNES', -216, -168, 58, YELLOW, SANS, 800);
    text(c, '1 PLAYER', 216, -168, 16, CREAM, MONO, 500, 'right');
    text(c, 'BLOW HERE ▼', 0, 300, 16, '#6d665c', MONO, 500, 'center');
    fs(c, R(-150, 320, 300, 40), '#8b8479', 4);
  },
  over(c) { fs(c, R(-220, -140, 440, 320, 4), null, 4); },
};

// ------------------------------------------------------------------ 5. the balloon
const balloon: Scene = {
  id: 'ukhas',
  portal: { x: 0, y: 192, w: 52, h: 62, r: 2, s: 0.052 },
  draw(c, t) {
    bg(c, '#142454');
    const v = view(c);
    // stars
    for (let i = 0; i < 70; i++) {
      const x = -900 + rnd(i) * 1800, y = -700 + rnd(i + 50) * 900;
      if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * 2 + i);
      c.fillStyle = `rgba(255,250,240,${0.4 + tw * 0.6})`;
      c.fillRect(x - 3, y - 3, 6, 6);
    }
    // the curve of the earth
    fs(c, C(0, 2420, 2120), '#8fd0f5', 0);
    fs(c, C(0, 2420, 2085), '#5aa9e6', 0);
    const earth = C(0, 2420, 2050);
    fs(c, earth, '#2f6fd0');
    c.save(); c.clip(earth);
    blob(c, [-420, 470, 140, -260, 430, 110, 330, 480, 160, 520, 440, 120], '#4caf6e', 4);
    blob(c, [-150, 400, 50, -80, 392, 44, 60, 410, 50, 200, 395, 38], PAPER, 4);
    c.restore();
    fs(c, earth, null);
    // rigging
    line(c, [0, -60, 0, 60], CREAM, 4);
    line(c, [-58, 66, -40, 150, 40, 150, 58, 66], CREAM, 4);
    // parachute
    const pc = new Path2D(); pc.arc(0, 70, 60, Math.PI, TAU); pc.closePath();
    c.save(); c.clip(pc); bg(c, RED); c.fillStyle = YELLOW; for (let i = -3; i < 3; i++) c.fill(poly([0, 70, i * 40, 0, i * 40 + 20, 0])); c.restore();
    fs(c, pc, null);
    // payload box and antenna
    line(c, [44, 250, 44, 310], INK, 4);
    fs(c, R(-58, 150, 116, 100, 6), ORANGE);
    text(c, 'UKHAS', 0, 244, 9, INK, MONO, 700, 'center');
    // the balloon itself, swaying a touch
    const bob = Math.sin(t * 0.8) * 4;
    const b = new Path2D();
    b.moveTo(0, -56 + bob * 0.2);
    b.bezierCurveTo(-120, -110, -210, -200, -205, -300 + bob);
    b.bezierCurveTo(-200, -440, -80, -510, 0, -510 + bob);
    b.bezierCurveTo(80, -510, 200, -440, 205, -300 + bob);
    b.bezierCurveTo(210, -200, 120, -110, 0, -56 + bob * 0.2);
    b.closePath();
    fs(c, b, PAPER);
    const hl = new Path2D(); hl.arc(-30, -330 + bob, 140, Math.PI * 1.08, Math.PI * 1.42); c.lineWidth = 14; c.strokeStyle = '#ffffff'; c.stroke(hl);
    fs(c, R(-12, -62, 24, 14, 3), GREY, 4);
  },
  over(c) { fs(c, R(-26, 161, 52, 62, 2), null, 3); },
};

// ------------------------------------------------------------------ 6. the paper
const paper: Scene = {
  id: 'arxiv-vanity',
  portal: { x: -138, y: 152, w: 300, h: 220, r: 0, s: 0.22 },
  draw(c) {
    bg(c, '#d6cfc2');
    c.fillStyle = 'rgba(31,27,46,.18)'; c.fillRect(-326, -446, 680, 920);
    fs(c, R(-340, -460, 680, 920), PAPER);
    c.save(); c.translate(-372, 200); c.rotate(-Math.PI / 2);
    text(c, 'arXiv:2611.00001v1  [cs.HC]  14 Nov 2026', 0, 0, 15, '#9a8f7e', SERIF, 400);
    c.restore();
    text(c, 'Turtles All the Way Down:', 0, -380, 30, INK, SERIF, 700, 'center');
    text(c, 'Notes on an Infinite Homepage', 0, -342, 30, INK, SERIF, 700, 'center');
    text(c, name, 0, -300, 17, INK, SERIF, 400, 'center');
    text(c, 'firshman.com', 0, -278, 13, '#6d665c', SERIF, 400, 'center');
    text(c, 'Abstract', 0, -240, 15, INK, SERIF, 700, 'center');
    const bar = (x: number, y: number, w: number) => { c.fillStyle = '#a49d91'; c.fillRect(x, y, w, 6); };
    for (let i = 0; i < 5; i++) bar(-250, -224 + i * 16, i === 4 ? 300 : 500);
    // body: two columns
    text(c, '1  Introduction', -290, -120, 15, INK, SERIF, 700);
    for (let i = 0; i < 10; i++) bar(-290, -104 + i * 16, i === 9 ? 160 : 270);
    for (let i = 0; i < 26; i++) bar(20, -124 + i * 16, i % 9 === 8 ? 140 : 270);
    // figure 1 (the way in)
    fs(c, R(-292, 38, 304, 228), null, 3);
    text(c, 'Figure 1. A cog. Not to scale.', -290, 290, 13, INK, SERIF, 400);
    for (let i = 0; i < 6; i++) bar(-290, 310 + i * 16, 270);
    for (let i = 0; i < 6; i++) bar(20, 310 + i * 16, i === 5 ? 120 : 270);
    text(c, '1', 0, 440, 13, INK, SERIF, 400, 'center');
  },
};

// ------------------------------------------------------------------ 7. the gear
const gear: Scene = {
  id: 'cog',
  portal: { x: 0, y: 0, w: 84, h: 84, r: 42, s: 0.084, circle: true },
  draw(c, t) {
    bg(c, YELLOW);
    const a = t * 0.12;
    const side = (cx: number, cy: number, ro: number, n: number, rot: number, col: string) => {
      if (!seen(c, cx - ro, cy - ro, ro * 2, ro * 2)) return;
      fs(c, gearPath(cx, cy, ro, ro - 36, n, rot), col);
      fs(c, C(cx, cy, ro * 0.3), CREAM);
      fs(c, C(cx, cy, ro * 0.12), INK, 0);
    };
    side(600, -330, 250, 10, -a * 1.5, TEAL);
    side(-580, 370, 270, 11, -a * 1.4 + 0.2, RED);
    fs(c, gearPath(0, 0, 380, 336, 16, a), ORANGE);
    for (let i = 0; i < 6; i++) {
      const ang = a + (i / 6) * TAU;
      fs(c, C(Math.cos(ang) * 215, Math.sin(ang) * 215, 62), YELLOW);
    }
    fs(c, C(0, 0, 100), CREAM);
    // a keyway, so you can see it turn
    fs(c, C(Math.cos(a) * 72, Math.sin(a) * 72, 9), INK, 0);
  },
  over(c) { fs(c, C(0, 0, 42), null, 5); },
};

// ------------------------------------------------------------------ 8. the guitar
const HOLE = { x: 0, y: -40, r: 70 };
const guitar: Scene = {
  id: 'django',
  portal: { x: HOLE.x, y: HOLE.y, w: 140, h: 140, r: 70, s: 0.14, circle: true },
  draw(c, t) {
    bg(c, GREEN);
    fs(c, C(0, 60, 680), '#105a3e', 0);
    // floating notes
    for (let i = 0; i < 6; i++) {
      const ph = (t * 0.25 + i / 6) % 1;
      const x = (i % 2 ? 1 : -1) * (380 + rnd(i) * 220) + Math.sin(t + i) * 20;
      const y = 300 - ph * 700;
      c.globalAlpha = Math.sin(ph * Math.PI);
      text(c, i % 3 ? '♪' : '♫', x, y, 70, CREAM, SERIF, 400, 'center');
      c.globalAlpha = 1;
    }
    // neck and headstock
    fs(c, R(-46, -900, 92, 640), '#5a341b');
    fs(c, R(-38, -900, 76, 640), '#2b1a10', 0);
    for (let y = -860; y < -270; y += 52) line(c, [-38, y, 38, y], '#cfc7b8', 4);
    // body
    const body = new Path2D();
    body.moveTo(270, 250); body.arc(0, 250, 270, 0, TAU);
    body.moveTo(205, -150); body.arc(0, -150, 205, 0, TAU);
    c.lineWidth = LW * 2; c.strokeStyle = INK; c.stroke(body);
    c.fillStyle = WOOD; c.fill(body); c.fillRect(-160, -150, 320, 400);
    // binding and rosette
    const inner = new Path2D();
    inner.moveTo(250, 250); inner.arc(0, 250, 250, 0, TAU);
    inner.moveTo(185, -150); inner.arc(0, -150, 185, 0, TAU);
    c.lineWidth = 4; c.strokeStyle = '#f2d6a2'; c.stroke(inner);
    c.fillStyle = WOOD; c.fill(inner); c.fillRect(-150, -150, 300, 400);
    // pickguard
    const pg = new Path2D(); pg.moveTo(60, 10); pg.quadraticCurveTo(190, 40, 150, 200); pg.quadraticCurveTo(90, 120, 30, 70); pg.closePath();
    fs(c, pg, '#7a3a14', 4);
    fs(c, C(HOLE.x, HOLE.y, HOLE.r + 18), '#0c4b33', 4);
    fs(c, C(HOLE.x, HOLE.y, HOLE.r + 9), CREAM, 0);
    // bridge
    fs(c, R(-95, 330, 190, 30, 8), '#2b1a10', 4);
  },
  over(c, _t, cover) {
    fs(c, C(HOLE.x, HOLE.y, HOLE.r), null, 4);
    // we fly between the strings, so let them slip out of focus as the hole fills the screen
    const a = Math.max(0, Math.min(1, (1.25 - cover) / 0.6));
    if (a <= 0) return;
    c.globalAlpha = a;
    for (let i = 0; i < 6; i++) {
      const x = -27 + i * 11;
      line(c, [x * 1.4, 345, x, -900], '#efe7d6', 2.4);
    }
    c.globalAlpha = 1;
  },
};

export const SCENES: Scene[] = [desk, terminal, ship, whale, cartridge, balloon, paper, gear, guitar];

export const portalPath = (p: Portal) => (p.circle ? C(p.x, p.y, p.w / 2) : R(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.r));
