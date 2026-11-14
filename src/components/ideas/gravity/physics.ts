// A small 2D rigid-body engine for oriented boxes.
// Sequential impulses with accumulated, warm-started contact impulses, in the style of
// Box2D-lite: SAT box-box collision with edge clipping (up to two contact points), Coulomb
// friction, restitution, a soft mouse joint for dragging, and per-body sleeping.
// Units are CSS pixels and seconds, with y pointing down.

export class Body {
  id: number;
  x = 0; y = 0; a = 0;
  vx = 0; vy = 0; w = 0;
  c = 1; s = 0;
  hw: number; hh: number;
  m: number; invM: number; invI: number;
  friction = 0.6;
  restitution = 0.12;
  isStatic: boolean;
  awake = true;
  sleepT = 0;
  // false until the body has fully entered the viewport, so words raining in from
  // above pass through the ceiling instead of snagging on it
  inside = true;
  minX = 0; maxX = 0; minY = 0; maxY = 0;
  // kinds: 'word' | 'beam' | 'heavy' | 'dot' | 'wall' | 'ceiling'
  kind = 'word';
  el: HTMLElement | null = null;
  // last rendered transform, so untouched bodies cost nothing
  rx = NaN; ry = NaN; ra = NaN;

  constructor(id: number, hw: number, hh: number, density: number) {
    this.id = id;
    this.hw = hw;
    this.hh = hh;
    this.isStatic = density === 0;
    if (this.isStatic) {
      this.m = Infinity;
      this.invM = 0;
      this.invI = 0;
      this.awake = false;
    } else {
      const w = hw * 2, h = hh * 2;
      this.m = density * w * h;
      this.invM = 1 / this.m;
      this.invI = 1 / ((this.m * (w * w + h * h)) / 12);
    }
  }

  setAngle(a: number) {
    this.a = a;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
  }

  wake() {
    if (this.isStatic) return;
    this.awake = true;
    this.sleepT = 0;
  }
}

type CV = { x: number; y: number; in1: number; out1: number; in2: number; out2: number };

export type Contact = {
  x: number; y: number;
  nx: number; ny: number;
  sep: number;
  Pn: number; Pt: number;
  massN: number; massT: number;
  bias: number;
  key: number;
  r1x: number; r1y: number; r2x: number; r2y: number;
};

const E1 = 1, E2 = 2, E3 = 3, E4 = 4, NONE = 0;

function cv(x: number, y: number, in2: number, out2: number): CV {
  return { x, y, in1: NONE, out1: NONE, in2, out2 };
}

function incidentEdge(hx: number, hy: number, b: Body, nx: number, ny: number): CV[] {
  const c = b.c, s = b.s;
  // the reference normal in the incident box's frame, flipped
  const lx = -(c * nx + s * ny);
  const ly = -(-s * nx + c * ny);
  let v0: CV, v1: CV;
  if (Math.abs(lx) > Math.abs(ly)) {
    if (lx > 0) { v0 = cv(hx, -hy, E3, E4); v1 = cv(hx, hy, E4, E1); }
    else { v0 = cv(-hx, hy, E1, E2); v1 = cv(-hx, -hy, E2, E3); }
  } else {
    if (ly > 0) { v0 = cv(hx, hy, E4, E1); v1 = cv(-hx, hy, E1, E2); }
    else { v0 = cv(-hx, -hy, E2, E3); v1 = cv(hx, -hy, E3, E4); }
  }
  for (const v of [v0, v1]) {
    const x = v.x, y = v.y;
    v.x = b.x + c * x - s * y;
    v.y = b.y + s * x + c * y;
  }
  return [v0, v1];
}

function clip(vin: CV[], nx: number, ny: number, offset: number, edge: number): CV[] {
  const out: CV[] = [];
  const a = vin[0], b = vin[1];
  const d0 = nx * a.x + ny * a.y - offset;
  const d1 = nx * b.x + ny * b.y - offset;
  if (d0 <= 0) out.push({ ...a });
  if (d1 <= 0) out.push({ ...b });
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const p: CV = d0 > 0 ? { ...a } : { ...b };
    p.x = a.x + t * (b.x - a.x);
    p.y = a.y + t * (b.y - a.y);
    if (d0 > 0) { p.in1 = edge; p.in2 = NONE; }
    else { p.out1 = edge; p.out2 = NONE; }
    out.push(p);
  }
  return out;
}

// Returns contacts with normals pointing from A to B.
export function collide(A: Body, B: Body): Contact[] {
  const hAx = A.hw, hAy = A.hh, hBx = B.hw, hBy = B.hh;
  const cA = A.c, sA = A.s, cB = B.c, sB = B.s;
  const dpx = B.x - A.x, dpy = B.y - A.y;
  const dAx = cA * dpx + sA * dpy, dAy = -sA * dpx + cA * dpy;
  const dBx = cB * dpx + sB * dpy, dBy = -sB * dpx + cB * dpy;
  // C = RotA^T * RotB
  const a11 = Math.abs(cA * cB + sA * sB), a12 = Math.abs(-cA * sB + sA * cB);
  const a21 = Math.abs(-sA * cB + cA * sB), a22 = Math.abs(sA * sB + cA * cB);

  const fAx = Math.abs(dAx) - hAx - (a11 * hBx + a12 * hBy);
  const fAy = Math.abs(dAy) - hAy - (a21 * hBx + a22 * hBy);
  if (fAx > 0 || fAy > 0) return [];
  const fBx = Math.abs(dBx) - (a11 * hAx + a21 * hAy) - hBx;
  const fBy = Math.abs(dBy) - (a12 * hAx + a22 * hAy) - hBy;
  if (fBx > 0 || fBy > 0) return [];

  const rel = 0.95, abs = 0.01;
  let axis = 0, sep = fAx;
  let nx = dAx > 0 ? cA : -cA, ny = dAx > 0 ? sA : -sA;
  if (fAy > rel * sep + abs * hAy) { axis = 1; sep = fAy; nx = dAy > 0 ? -sA : sA; ny = dAy > 0 ? cA : -cA; }
  if (fBx > rel * sep + abs * hBx) { axis = 2; sep = fBx; nx = dBx > 0 ? cB : -cB; ny = dBx > 0 ? sB : -sB; }
  if (fBy > rel * sep + abs * hBy) { axis = 3; sep = fBy; nx = dBy > 0 ? -sB : sB; ny = dBy > 0 ? cB : -cB; }

  let fnx: number, fny: number, front: number, snx: number, sny: number;
  let negSide: number, posSide: number, negEdge: number, posEdge: number, inc: CV[];
  if (axis === 0) {
    fnx = nx; fny = ny; front = A.x * fnx + A.y * fny + hAx;
    snx = -sA; sny = cA; const side = A.x * snx + A.y * sny;
    negSide = -side + hAy; posSide = side + hAy; negEdge = E3; posEdge = E1;
    inc = incidentEdge(hBx, hBy, B, fnx, fny);
  } else if (axis === 1) {
    fnx = nx; fny = ny; front = A.x * fnx + A.y * fny + hAy;
    snx = cA; sny = sA; const side = A.x * snx + A.y * sny;
    negSide = -side + hAx; posSide = side + hAx; negEdge = E2; posEdge = E4;
    inc = incidentEdge(hBx, hBy, B, fnx, fny);
  } else if (axis === 2) {
    fnx = -nx; fny = -ny; front = B.x * fnx + B.y * fny + hBx;
    snx = -sB; sny = cB; const side = B.x * snx + B.y * sny;
    negSide = -side + hBy; posSide = side + hBy; negEdge = E3; posEdge = E1;
    inc = incidentEdge(hAx, hAy, A, fnx, fny);
  } else {
    fnx = -nx; fny = -ny; front = B.x * fnx + B.y * fny + hBy;
    snx = cB; sny = sB; const side = B.x * snx + B.y * sny;
    negSide = -side + hBx; posSide = side + hBx; negEdge = E2; posEdge = E4;
    inc = incidentEdge(hAx, hAy, A, fnx, fny);
  }

  const c1 = clip(inc, -snx, -sny, negSide, negEdge);
  if (c1.length < 2) return [];
  const c2 = clip(c1, snx, sny, posSide, posEdge);
  if (c2.length < 2) return [];
  const flip = axis >= 2;

  const out: Contact[] = [];
  for (const p of c2) {
    const s = fnx * p.x + fny * p.y - front;
    if (s <= 0) {
      let i1 = p.in1, o1 = p.out1, i2 = p.in2, o2 = p.out2;
      if (flip) { [i1, i2] = [i2, i1]; [o1, o2] = [o2, o1]; }
      out.push({
        x: p.x - s * fnx, y: p.y - s * fny, nx, ny, sep: s,
        Pn: 0, Pt: 0, massN: 0, massT: 0, bias: 0,
        key: i1 | (o1 << 4) | (i2 << 8) | (o2 << 12),
        r1x: 0, r1y: 0, r2x: 0, r2y: 0,
      });
    }
  }
  return out;
}

const ALLOWED_PEN = 0.8; // px
const BIAS = 0.2;
const REST_THRESHOLD = 140; // px/s: below this, contacts don't bounce

export class Arbiter {
  a: Body; b: Body;
  contacts: Contact[] = [];
  friction: number;
  restitution: number;
  stamp = 0;
  fresh = true;
  // effective inverse masses for this step (sleepers act as static)
  ima = 0; iia = 0; imb = 0; iib = 0;
  // two-point block solver: K and its inverse
  block = false;
  k11 = 0; k12 = 0; k22 = 0; m11 = 0; m12 = 0; m22 = 0;

  constructor(a: Body, b: Body, contacts: Contact[]) {
    this.a = a; this.b = b;
    this.contacts = contacts;
    this.friction = Math.sqrt(a.friction * b.friction);
    this.restitution = Math.max(a.restitution, b.restitution);
  }

  update(next: Contact[]) {
    for (const c of next) {
      const old = this.contacts.find((o) => o.key === c.key);
      if (old) { c.Pn = old.Pn; c.Pt = old.Pt; }
    }
    this.contacts = next;
    this.fresh = false;
  }

  preStep(invDt: number, onImpact?: (b: Body, other: Body, speed: number) => void) {
    const A = this.a, B = this.b;
    const ima = (this.ima = A.awake ? A.invM : 0), iia = (this.iia = A.awake ? A.invI : 0);
    const imb = (this.imb = B.awake ? B.invM : 0), iib = (this.iib = B.awake ? B.invI : 0);
    let maxImpact = 0;
    for (const c of this.contacts) {
      const r1x = (c.r1x = c.x - A.x), r1y = (c.r1y = c.y - A.y);
      const r2x = (c.r2x = c.x - B.x), r2y = (c.r2y = c.y - B.y);
      const nx = c.nx, ny = c.ny, tx = ny, ty = -nx;
      const rn1 = r1x * nx + r1y * ny, rn2 = r2x * nx + r2y * ny;
      const kN = ima + imb + iia * (r1x * r1x + r1y * r1y - rn1 * rn1) + iib * (r2x * r2x + r2y * r2y - rn2 * rn2);
      c.massN = kN > 0 ? 1 / kN : 0;
      const rt1 = r1x * tx + r1y * ty, rt2 = r2x * tx + r2y * ty;
      const kT = ima + imb + iia * (r1x * r1x + r1y * r1y - rt1 * rt1) + iib * (r2x * r2x + r2y * r2y - rt2 * rt2);
      c.massT = kT > 0 ? 1 / kT : 0;
      c.bias = -BIAS * invDt * Math.min(0, c.sep + ALLOWED_PEN);
      // relative normal velocity, for restitution
      const dvx = B.vx - B.w * r2y - A.vx + A.w * r1y;
      const dvy = B.vy + B.w * r2x - A.vy - A.w * r1x;
      const vn = dvx * nx + dvy * ny;
      if (vn < -REST_THRESHOLD) c.bias = Math.max(c.bias, -this.restitution * vn);
      if (-vn > maxImpact) maxImpact = -vn;
    }
    // Long thin boxes (words!) resting on two points rock under plain sequential impulses.
    // Solving both normal impulses together, as Box2D does, keeps stacks of them still.
    this.block = false;
    if (this.contacts.length === 2) {
      const c1 = this.contacts[0], c2 = this.contacts[1];
      const nx = c1.nx, ny = c1.ny;
      const rn1A = c1.r1x * ny - c1.r1y * nx, rn1B = c1.r2x * ny - c1.r2y * nx;
      const rn2A = c2.r1x * ny - c2.r1y * nx, rn2B = c2.r2x * ny - c2.r2y * nx;
      const k11 = ima + imb + iia * rn1A * rn1A + iib * rn1B * rn1B;
      const k22 = ima + imb + iia * rn2A * rn2A + iib * rn2B * rn2B;
      const k12 = ima + imb + iia * rn1A * rn2A + iib * rn1B * rn2B;
      const det = k11 * k22 - k12 * k12;
      if (k11 > 0 && k11 * k11 < 1000 * det) {
        this.block = true;
        this.k11 = k11; this.k12 = k12; this.k22 = k22;
        const inv = 1 / det;
        this.m11 = k22 * inv; this.m12 = -k12 * inv; this.m22 = k11 * inv;
      }
    }
    if (this.fresh && onImpact && maxImpact > 0) {
      onImpact(A, B, maxImpact);
      onImpact(B, A, maxImpact);
    }
  }

  apply() {
    if (this.block) { this.applyBlock(); return; }
    const A = this.a, B = this.b;
    const ima = this.ima, iia = this.iia, imb = this.imb, iib = this.iib;
    for (const c of this.contacts) {
      const r1x = c.r1x, r1y = c.r1y, r2x = c.r2x, r2y = c.r2y;
      const nx = c.nx, ny = c.ny;
      let dvx = B.vx - B.w * r2y - A.vx + A.w * r1y;
      let dvy = B.vy + B.w * r2x - A.vy - A.w * r1x;
      const vn = dvx * nx + dvy * ny;
      let dPn = c.massN * (-vn + c.bias);
      const Pn0 = c.Pn;
      c.Pn = Math.max(Pn0 + dPn, 0);
      dPn = c.Pn - Pn0;
      let Px = dPn * nx, Py = dPn * ny;
      A.vx -= ima * Px; A.vy -= ima * Py; A.w -= iia * (r1x * Py - r1y * Px);
      B.vx += imb * Px; B.vy += imb * Py; B.w += iib * (r2x * Py - r2y * Px);

      dvx = B.vx - B.w * r2y - A.vx + A.w * r1y;
      dvy = B.vy + B.w * r2x - A.vy - A.w * r1x;
      const tx = ny, ty = -nx;
      const vt = dvx * tx + dvy * ty;
      let dPt = c.massT * -vt;
      const maxPt = this.friction * c.Pn;
      const Pt0 = c.Pt;
      c.Pt = Math.max(-maxPt, Math.min(Pt0 + dPt, maxPt));
      dPt = c.Pt - Pt0;
      Px = dPt * tx; Py = dPt * ty;
      A.vx -= ima * Px; A.vy -= ima * Py; A.w -= iia * (r1x * Py - r1y * Px);
      B.vx += imb * Px; B.vy += imb * Py; B.w += iib * (r2x * Py - r2y * Px);
    }
  }

  // Runs after every arbiter's preStep, so restitution sees the true approach speed.
  warmStart() {
    for (const c of this.contacts) {
      const tx = c.ny, ty = -c.nx;
      this.impulse(c, c.Pn * c.nx + c.Pt * tx, c.Pn * c.ny + c.Pt * ty);
    }
  }

  private impulse(c: Contact, Px: number, Py: number) {
    const A = this.a, B = this.b;
    A.vx -= this.ima * Px; A.vy -= this.ima * Py; A.w -= this.iia * (c.r1x * Py - c.r1y * Px);
    B.vx += this.imb * Px; B.vy += this.imb * Py; B.w += this.iib * (c.r2x * Py - c.r2y * Px);
  }

  private relVel(c: Contact, nx: number, ny: number) {
    const A = this.a, B = this.b;
    const dvx = B.vx - B.w * c.r2y - A.vx + A.w * c.r1y;
    const dvy = B.vy + B.w * c.r2x - A.vy - A.w * c.r1x;
    return dvx * nx + dvy * ny;
  }

  // Friction per point, then both normal impulses at once (Box2D's 2x2 LCP block solver).
  applyBlock() {
    const c1 = this.contacts[0], c2 = this.contacts[1];
    const nx = c1.nx, ny = c1.ny, tx = ny, ty = -nx;
    for (const c of this.contacts) {
      const vt = this.relVel(c, tx, ty);
      const maxPt = this.friction * c.Pn;
      const Pt0 = c.Pt;
      c.Pt = Math.max(-maxPt, Math.min(Pt0 - c.massT * vt, maxPt));
      const d = c.Pt - Pt0;
      this.impulse(c, d * tx, d * ty);
    }
    const a1 = c1.Pn, a2 = c2.Pn;
    const vn1 = this.relVel(c1, nx, ny), vn2 = this.relVel(c2, nx, ny);
    const b1 = vn1 - c1.bias - (this.k11 * a1 + this.k12 * a2);
    const b2 = vn2 - c2.bias - (this.k12 * a1 + this.k22 * a2);
    let x1: number, x2: number;
    // both points pushing
    x1 = -(this.m11 * b1 + this.m12 * b2);
    x2 = -(this.m12 * b1 + this.m22 * b2);
    if (!(x1 >= 0 && x2 >= 0)) {
      // only the first
      x1 = -b1 / this.k11; x2 = 0;
      if (!(x1 >= 0 && this.k12 * x1 + b2 >= 0)) {
        // only the second
        x1 = 0; x2 = -b2 / this.k22;
        if (!(x2 >= 0 && this.k12 * x2 + b1 >= 0)) {
          // neither
          x1 = 0; x2 = 0;
        }
      }
    }
    const d1 = x1 - a1, d2 = x2 - a2;
    c1.Pn = x1; c2.Pn = x2;
    this.impulse(c1, d1 * nx, d1 * ny);
    this.impulse(c2, d2 * nx, d2 * ny);
  }
}

export type Drag = {
  body: Body;
  lx: number; ly: number; // anchor in body space
  tx: number; ty: number; // target in world space
  ix: number; iy: number; // accumulated impulse this step
  // solver scratch
  rx: number; ry: number; k11: number; k12: number; k22: number;
  cbx: number; cby: number; gamma: number; maxImpulse: number;
};

const SLEEP_LIN = 9, SLEEP_ANG = 0.12, SLEEP_TIME = 0.45, WAKE_SPEED = 45;
const MAX_SPEED = 3600;

export class World {
  bodies: Body[] = [];
  walls: Body[] = [];
  arbiters = new Map<number, Arbiter>();
  gx = 0;
  gy = 2000;
  iterations = 9;
  drag: Drag | null = null;
  stamp = 0;
  nextId = 0;
  linearDamping = 0.02;
  angularDamping = 0.25;
  onImpact?: (b: Body, other: Body, speed: number) => void;
  private order: Body[] = [];

  add(b: Body) {
    if (b.isStatic) this.walls.push(b);
    else { this.bodies.push(b); this.order.push(b); }
    return b;
  }

  newBody(hw: number, hh: number, density: number) {
    const b = new Body(this.nextId++, hw, hh, density);
    return this.add(b);
  }

  // walls are static and don't move on their own, so their bounds are set here
  setWall(b: Body, x: number, y: number, hw: number, hh: number) {
    b.x = x; b.y = y; b.hw = hw; b.hh = hh;
    b.minX = x - hw; b.maxX = x + hw; b.minY = y - hh; b.maxY = y + hh;
    this.arbiters.clear();
  }

  wakeAll() {
    for (const b of this.bodies) b.wake();
  }

  private narrow(A: Body, B: Body) {
    // keep a stable order so feature keys and normals line up step to step
    if (A.id > B.id) { const t = A; A = B; B = t; }
    const key = A.id * 4096 + B.id;
    const cs = collide(A, B);
    if (cs.length) {
      const arb = this.arbiters.get(key);
      if (arb) arb.update(cs);
      else this.arbiters.set(key, new Arbiter(A, B, cs));
      (arb || this.arbiters.get(key)!).stamp = this.stamp;
    }
  }

  step(dt: number) {
    const invDt = 1 / dt;
    this.stamp++;
    const bodies = this.bodies;

    for (const b of bodies) {
      const ex = Math.abs(b.c) * b.hw + Math.abs(b.s) * b.hh;
      const ey = Math.abs(b.s) * b.hw + Math.abs(b.c) * b.hh;
      b.minX = b.x - ex; b.maxX = b.x + ex; b.minY = b.y - ey; b.maxY = b.y + ey;
      if (!b.inside && b.minY > 0) b.inside = true;
    }

    // sweep and prune on x (insertion sort: the order barely changes between steps)
    const o = this.order;
    for (let i = 1; i < o.length; i++) {
      const v = o[i];
      let j = i - 1;
      while (j >= 0 && o[j].minX > v.minX) { o[j + 1] = o[j]; j--; }
      o[j + 1] = v;
    }
    for (let i = 0; i < o.length; i++) {
      const A = o[i];
      for (let j = i + 1; j < o.length; j++) {
        const B = o[j];
        if (B.minX > A.maxX) break;
        if (B.minY > A.maxY || B.maxY < A.minY) continue;
        if (!A.awake && !B.awake) continue;
        this.narrow(A, B);
      }
    }
    for (const b of bodies) {
      if (!b.awake) continue;
      for (const w of this.walls) {
        if (w.kind === 'ceiling' && !b.inside) continue;
        if (b.maxX < w.minX || b.minX > w.maxX || b.maxY < w.minY || b.minY > w.maxY) continue;
        this.narrow(w, b);
      }
    }
    for (const [k, arb] of this.arbiters) if (arb.stamp !== this.stamp) this.arbiters.delete(k);

    // wake sleepers that something fast is running into
    const dragged = this.drag?.body;
    for (const arb of this.arbiters.values()) {
      const A = arb.a, B = arb.b;
      if (A.awake === B.awake || A.isStatic || B.isStatic) continue;
      const mover = A.awake ? A : B, sleeper = A.awake ? B : A;
      if (mover === dragged || mover.vx * mover.vx + mover.vy * mover.vy > WAKE_SPEED * WAKE_SPEED || Math.abs(mover.w) > 1.5) sleeper.wake();
    }

    const ld = 1 / (1 + dt * this.linearDamping), ad = 1 / (1 + dt * this.angularDamping);
    for (const b of bodies) {
      if (!b.awake) continue;
      b.vx = (b.vx + this.gx * dt) * ld;
      b.vy = (b.vy + this.gy * dt) * ld;
      b.w *= ad;
    }

    for (const arb of this.arbiters.values()) arb.preStep(invDt, this.onImpact);
    for (const arb of this.arbiters.values()) arb.warmStart();

    const d = this.drag;
    if (d) {
      const b = d.body;
      b.wake();
      const rx = (d.rx = b.c * d.lx - b.s * d.ly), ry = (d.ry = b.s * d.lx + b.c * d.ly);
      const freq = 5.5, zeta = 0.75, omega = 2 * Math.PI * freq;
      const m = b.m;
      const damp = 2 * m * zeta * omega, k = m * omega * omega;
      const gamma = (d.gamma = 1 / (dt * (damp + dt * k)));
      const beta = dt * k * gamma;
      d.k11 = b.invM + b.invI * ry * ry + gamma;
      d.k12 = -b.invI * rx * ry;
      d.k22 = b.invM + b.invI * rx * rx + gamma;
      d.cbx = (b.x + rx - d.tx) * beta;
      d.cby = (b.y + ry - d.ty) * beta;
      d.ix = 0; d.iy = 0;
      // heavy things are hard to lift: the grip saturates
      const g = 2000;
      d.maxImpulse = 45 * g * Math.min(m, 9000) * dt;
      b.w *= 0.96;
    }

    for (let it = 0; it < this.iterations; it++) {
      for (const arb of this.arbiters.values()) arb.apply();
      if (d) {
        const b = d.body;
        const cx = b.vx - b.w * d.ry + d.cbx + d.gamma * d.ix;
        const cy = b.vy + b.w * d.rx + d.cby + d.gamma * d.iy;
        const det = d.k11 * d.k22 - d.k12 * d.k12;
        const inv = det ? 1 / det : 0;
        let jx = -inv * (d.k22 * cx - d.k12 * cy);
        let jy = -inv * (-d.k12 * cx + d.k11 * cy);
        const ox = d.ix, oy = d.iy;
        d.ix += jx; d.iy += jy;
        const mag = Math.hypot(d.ix, d.iy);
        if (mag > d.maxImpulse) { d.ix *= d.maxImpulse / mag; d.iy *= d.maxImpulse / mag; }
        jx = d.ix - ox; jy = d.iy - oy;
        b.vx += b.invM * jx; b.vy += b.invM * jy;
        b.w += b.invI * (d.rx * jy - d.ry * jx);
      }
    }

    for (const b of bodies) {
      if (!b.awake) continue;
      const sp = b.vx * b.vx + b.vy * b.vy;
      if (sp > MAX_SPEED * MAX_SPEED) { const f = MAX_SPEED / Math.sqrt(sp); b.vx *= f; b.vy *= f; }
      if (b.w > 40) b.w = 40; else if (b.w < -40) b.w = -40;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.setAngle(b.a + b.w * dt);
      if (b !== dragged && sp < SLEEP_LIN * SLEEP_LIN && Math.abs(b.w) < SLEEP_ANG) {
        b.sleepT += dt;
        if (b.sleepT > SLEEP_TIME) { b.awake = false; b.vx = b.vy = b.w = 0; }
      } else b.sleepT = 0;
    }
  }

  // bodies that a body is touching, from the last step
  touching(b: Body) {
    const out: Body[] = [];
    for (const arb of this.arbiters.values()) {
      if (arb.a === b) out.push(arb.b);
      else if (arb.b === b) out.push(arb.a);
    }
    return out;
  }
}
