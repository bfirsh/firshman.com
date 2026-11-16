import * as THREE from 'three';
import { V, Y0, VY, hash3 } from './level';
import type { Level, Prop } from './level';

// Voxel mesher with per-vertex ambient occlusion, faces bucketed by material group.
// buckets: mat id -> bucket index. Returns one geometry per bucket.
export function meshVoxels(L: Level, colors: THREE.Color[], haze: THREE.Color, bucketOf: Uint8Array, nBuckets: number) {
  const { VX, VZ, vox, ox, oz } = L;
  const solid = (a: number, k: number, b: number) =>
    a >= 0 && b >= 0 && k >= 0 && a < VX && b < VZ && k < VY && vox[(k * VZ + b) * VX + a] !== 0;
  const out = Array.from({ length: nBuckets }, () => ({ p: [] as number[], n: [] as number[], c: [] as number[], i: [] as number[] }));
  const AO = [0.5, 0.68, 0.84, 1.0];
  const tmp = new THREE.Color();
  // 6 faces: axis d, sign s; u,v axes
  const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let k = 0; k < VY; k++) for (let b = 0; b < VZ; b++) for (let a = 0; a < VX; a++) {
    const m = vox[(k * VZ + b) * VX + a];
    if (!m) continue;
    const bk = bucketOf[m];
    const o = out[bk];
    const base = colors[m];
    const jitter = 0.955 + hash3(a, k, b) * 0.09;
    const y = Y0 + k * V;
    const hz = Math.min(0.88, Math.pow(Math.max(0, (-0.6 - y) / 4.2), 1.15));
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = dirs[f];
      if (solid(a + dx, k + dy, b + dz)) continue;
      const d = dx ? 0 : dy ? 1 : 2;
      const s = dx + dy + dz;
      const u = (d + 1) % 3, v = (d + 2) % 3;
      const P = [a, k, b];
      const N = [dx, dy, dz];
      const corners = s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
      const start = o.p.length / 3;
      const aos: number[] = [];
      for (const [cu, cv] of corners) {
        const q = [P[0] + N[0], P[1] + N[1], P[2] + N[2]];
        const su = [0, 0, 0], sv = [0, 0, 0];
        su[u] = cu ? 1 : -1; sv[v] = cv ? 1 : -1;
        const s1 = solid(q[0] + su[0], q[1] + su[1], q[2] + su[2]) ? 1 : 0;
        const s2 = solid(q[0] + sv[0], q[1] + sv[1], q[2] + sv[2]) ? 1 : 0;
        const cc = solid(q[0] + su[0] + sv[0], q[1] + su[1] + sv[1], q[2] + su[2] + sv[2]) ? 1 : 0;
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
        aos.push(ao);
        const pos = [P[0], P[1], P[2]];
        if (s > 0) pos[d] += 1;
        pos[u] += cu; pos[v] += cv;
        o.p.push(ox + pos[0] * V, Y0 + pos[1] * V, oz + pos[2] * V);
        o.n.push(dx, dy, dz);
        tmp.copy(base).multiplyScalar(jitter * AO[ao]);
        if (bk === 0) tmp.lerp(haze, hz);
        o.c.push(tmp.r, tmp.g, tmp.b);
      }
      if (aos[0] + aos[2] >= aos[1] + aos[3]) o.i.push(start, start + 1, start + 2, start, start + 2, start + 3);
      else o.i.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
    }
  }
  return out.map((o) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
    g.setIndex(o.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(o.i, 1) : new THREE.Uint16BufferAttribute(o.i, 1));
    g.computeBoundingSphere();
    return g;
  });
}

// Simple box emitter (axis-aligned or transformed), vertex colours with a soft bottom darkening.
export class BoxBuilder {
  p: number[] = []; n: number[] = []; c: number[] = []; i: number[] = [];
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private nm = new THREE.Matrix3();
  box(a: number[], b: number[], col: THREE.Color, ao = 0.8, mat?: THREE.Matrix4, skipBottom = true) {
    const [x0, y0, z0] = a, [x1, y1, z1] = b;
    const faces: [number[], number[][]][] = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
      [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
      [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    if (mat) this.nm.getNormalMatrix(mat);
    for (let f = 0; f < 6; f++) {
      if (f === 3 && skipBottom) continue;
      const [nrm, vs] = faces[f];
      const s = this.p.length / 3;
      for (const q of vs) {
        this.v.set(q[0], q[1], q[2]);
        if (mat) this.v.applyMatrix4(mat);
        this.p.push(this.v.x, this.v.y, this.v.z);
        this.v.set(nrm[0], nrm[1], nrm[2]);
        if (mat) this.v.applyMatrix3(this.nm).normalize();
        this.n.push(this.v.x, this.v.y, this.v.z);
        const t = q[1] === y0 ? ao : 1;
        this.c.push(col.r * t, col.g * t, col.b * t);
      }
      this.i.push(s, s + 1, s + 2, s, s + 2, s + 3);
    }
  }
  rail(p0: number[], p1: number[], w: number, h: number, col: THREE.Color) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    const along = Math.abs(dx) > Math.abs(dz) ? 0 : 2;
    const horiz = along === 0 ? dx : dz;
    const ang = Math.atan2(dy, Math.abs(horiz)) * Math.sign(horiz || 1);
    this.m4.identity();
    const mid = new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    const rot = new THREE.Matrix4();
    if (along === 0) rot.makeRotationZ(ang); else rot.makeRotationX(-ang);
    this.m4.makeTranslation(mid.x, mid.y, mid.z).multiply(rot);
    const hl = len / 2;
    if (along === 0) this.box([-hl, -h / 2, -w / 2], [hl, h / 2, w / 2], col, 0.85, this.m4, false);
    else this.box([-w / 2, -h / 2, -hl], [w / 2, h / 2, hl], col, 0.85, this.m4, false);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

export function buildProps(props: Prop[], colors: THREE.Color[], bucketOf: Uint8Array, nBuckets: number) {
  const bs = Array.from({ length: nBuckets }, () => new BoxBuilder());
  for (const pr of props) {
    const b = bs[bucketOf[pr.m]];
    if (pr.t === 'box') b.box(pr.a, pr.b, colors[pr.m], pr.ao ?? 0.8);
    else b.rail(pr.p0, pr.p1, pr.w, pr.hgt, colors[pr.m]);
  }
  return bs;
}
