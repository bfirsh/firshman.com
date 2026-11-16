import * as THREE from 'three';
import { C, R, K, WALL_H } from './level';
import type { Level } from './level';

// The board is a heightfield of columns (floor / wall / gate) and ramps. The marble collides
// with its signed distance field, sampled from the 3x3 cells around it. Small fixed substeps
// (240 Hz, speed-capped) keep it from tunnelling; a few push-out iterations per step resolve
// corners, and a fall-catcher returns it to the last safe spot if anything goes wrong.

const B = -30;
const BIG = 1e6;

export function cellTop(L: Level, c: number) {
  const k = L.kind[c];
  if (k === K.GATE) {
    const g = L.gates[L.gateOf[c]];
    return g.h + WALL_H * (1 - g.open);
  }
  return L.H[c];
}

function sdCell(L: Level, i: number, j: number, x: number, y: number, z: number) {
  if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) return BIG;
  const c = j * L.nx + i;
  const k = L.kind[c];
  if (k === K.VOID) return BIG;
  const top = cellTop(L, c);
  const cx = L.ox + (i + 0.5) * C, cz = L.oz + (j + 0.5) * C;
  const cy = (top + B) / 2, hy = (top - B) / 2;
  const qx = Math.abs(x - cx) - C / 2, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - C / 2;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  let d = Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0);
  if (k === K.RAMP) {
    const s = L.rS[c], u = L.rAx[c] === 0 ? x : z;
    const dp = (y - (L.rA[c] + s * u)) / Math.sqrt(1 + s * s);
    d = Math.max(d, dp);
  }
  return d;
}

// distance + outward normal for one cell (analytic, so creases between cells stay crisp)
const _q = [0, 0, 0];
function contactCell(L: Level, i: number, j: number, x: number, y: number, z: number, n: THREE.Vector3) {
  if (i < 0 || j < 0 || i >= L.nx || j >= L.nz) return BIG;
  const c = j * L.nx + i;
  const k = L.kind[c];
  if (k === K.VOID) return BIG;
  const top = cellTop(L, c);
  const cx = L.ox + (i + 0.5) * C, cz = L.oz + (j + 0.5) * C;
  const cy = (top + B) / 2, hy = (top - B) / 2;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  _q[0] = Math.abs(dx) - C / 2; _q[1] = Math.abs(dy) - hy; _q[2] = Math.abs(dz) - C / 2;
  const mx = Math.max(_q[0], 0), my = Math.max(_q[1], 0), mz = Math.max(_q[2], 0);
  const out = Math.sqrt(mx * mx + my * my + mz * mz);
  let d: number;
  if (out > 0) { d = out; n.set(Math.sign(dx) * mx / out, Math.sign(dy) * my / out, Math.sign(dz) * mz / out); }
  else {
    const m = Math.max(_q[0], _q[1], _q[2]);
    d = m;
    if (m === _q[1]) n.set(0, Math.sign(dy), 0); else if (m === _q[0]) n.set(Math.sign(dx), 0, 0); else n.set(0, 0, Math.sign(dz));
  }
  if (k === K.RAMP) {
    const s = L.rS[c], ax = L.rAx[c], u = ax === 0 ? x : z;
    const inv = 1 / Math.sqrt(1 + s * s);
    const dp = (y - (L.rA[c] + s * u)) * inv;
    if (dp > d) { d = dp; if (ax === 0) n.set(-s * inv, inv, 0); else n.set(0, inv, -s * inv); }
  }
  return d;
}

export function sdf(L: Level, x: number, y: number, z: number) {
  const i0 = Math.floor((x - L.ox) / C), j0 = Math.floor((z - L.oz) / C);
  let d = BIG;
  for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
    const e = sdCell(L, i, j, x, y, z);
    if (e < d) d = e;
  }
  return d;
}

const E = 0.0015;
export function normalAt(L: Level, x: number, y: number, z: number, out: THREE.Vector3) {
  const a = sdf(L, x + E, y - E, z - E), b = sdf(L, x - E, y - E, z + E), c = sdf(L, x - E, y + E, z - E), d = sdf(L, x + E, y + E, z + E);
  out.set(a - b - c + d, -a - b + c + d, -a + b - c + d);
  const l = out.length();
  if (l < 1e-9) out.set(0, 1, 0); else out.multiplyScalar(1 / l);
  return out;
}

export interface Impact { speed: number; wall: boolean }

export class Marble {
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  q = new THREE.Quaternion();
  grounded = false;
  groundTime = 0;
  gn = new THREE.Vector3(0, 1, 0);
  safe = new THREE.Vector3();
  spin = new THREE.Vector3(); // angular velocity (world, rad/s)
  private n = new THREE.Vector3();
  private t = new THREE.Vector3();
  private dq = new THREE.Quaternion();

  step(L: Level, g: THREE.Vector3, dt: number, impacts: Impact[]) {
    const v = this.v, p = this.p, n = this.n;
    v.addScaledVector(g, dt);
    if (this.grounded) {
      // rolling resistance, a touch stronger at very low speeds so it settles
      const sp = v.length();
      const k = 0.42 + (sp < 0.4 ? 1.2 : 0);
      v.multiplyScalar(Math.max(0, 1 - k * dt));
    }
    const sp = v.length();
    if (sp > 7.5) v.multiplyScalar(7.5 / sp);
    p.addScaledVector(v, dt);
    let grounded = false;
    for (let it = 0; it < 3; it++) {
      let any = false;
      const i0 = Math.floor((p.x - L.ox) / C), j0 = Math.floor((p.z - L.oz) / C);
      for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
      const d = contactCell(L, i, j, p.x, p.y, p.z, n);
      if (d >= R) continue;
      any = true;
      p.addScaledVector(n, R - d + 1e-5);
      const vn = v.dot(n);
      if (vn < 0) {
        const wall = n.y < 0.6;
        if (-vn > 0.9) {
          const e = wall ? 0.42 : 0.22;
          v.addScaledVector(n, -(1 + e) * vn);
          impacts.push({ speed: -vn, wall });
          if (wall) {
            // a little scrub of tangential speed on hard knocks
            this.t.copy(v).addScaledVector(n, -v.dot(n));
            v.addScaledVector(this.t, -0.06);
          }
        } else v.addScaledVector(n, -vn);
      }
      if (n.y > 0.55) { grounded = true; this.gn.copy(n); }
      }
      if (!any) break;
    }
    this.grounded = grounded;
    if (grounded) { this.groundTime += dt; } else this.groundTime = 0;
    // rolling without slipping when grounded; keep spinning in the air
    if (grounded) {
      this.spin.crossVectors(this.gn, v).multiplyScalar(1 / R);
    }
    const w = this.spin.length();
    if (w > 1e-6) {
      this.t.copy(this.spin).multiplyScalar(1 / w);
      this.dq.setFromAxisAngle(this.t, w * dt);
      this.q.premultiply(this.dq);
    }
  }
}
