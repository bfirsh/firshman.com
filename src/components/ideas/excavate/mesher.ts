// Chunked greedy mesher with per-vertex ambient occlusion.
// Faces merge only when colour, find id and (uniform) AO all match, so the
// occlusion stays exact while flat, evenly lit faces collapse into big quads.
import type { World } from './world';
import { K_FIND } from './world';

export const CS = 16;

export type MeshData = {
  pos: Float32Array; nrm: Int8Array; col: Float32Array; ao: Float32Array; fx: Float32Array; idx: Uint32Array; count: number;
};

const MAXV = 65536 * 2;
const sPos = new Float32Array(MAXV * 3);
const sNrm = new Int8Array(MAXV * 3);
const sCol = new Float32Array(MAXV * 3);
const sAO = new Float32Array(MAXV);
const sFx = new Float32Array(MAXV * 3);
const sIdx = new Uint32Array(MAXV * 1.5);
const keys = new Float64Array(CS * CS);
const aoq = new Uint8Array(CS * CS * 4);

// axis permutations: for normal axis a, (u, v) such that u x v = +a
const UA = [1, 2, 0];
const VA = [2, 0, 1];

export function meshChunk(w: World, cx: number, cy: number, cz: number): MeshData | null {
  const { X, Z, mat, kind, pal, glint, metal } = w;
  const Y = w.Y;
  const o = [cx * CS, cy * CS, cz * CS];
  const dims = [X, Y, Z];
  let nv = 0, ni = 0;
  const c = [0, 0, 0];
  const vtx = [0, 0, 0];
  const solid = (x: number, y: number, z: number) => w.solid(x, y, z);

  for (let a = 0; a < 3; a++) {
    const ua = UA[a], va = VA[a];
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      for (let k = 0; k < CS; k++) {
        const ka = o[a] + k;
        if (ka >= dims[a]) break;
        // build the mask for this slice
        let any = false;
        for (let iv = 0; iv < CS; iv++) for (let iu = 0; iu < CS; iu++) {
          const m = iu + iv * CS;
          keys[m] = 0;
          c[a] = ka; c[ua] = o[ua] + iu; c[va] = o[va] + iv;
          if (c[ua] >= dims[ua] || c[va] >= dims[va]) continue;
          const i = c[0] + X * (c[2] + Z * c[1]);
          const mm = mat[i];
          if (!mm) continue;
          // neighbour in the face direction
          c[a] += sgn;
          if (solid(c[0], c[1], c[2])) continue;
          // AO corners, sampled in the empty neighbour plane
          let q = 0;
          let uni = true, first = -1;
          for (let cc = 0; cc < 4; cc++) {
            const du = cc === 1 || cc === 2 ? 1 : -1;
            const dv = cc >= 2 ? 1 : -1;
            c[ua] += du; const s1 = solid(c[0], c[1], c[2]) ? 1 : 0; c[ua] -= du;
            c[va] += dv; const s2 = solid(c[0], c[1], c[2]) ? 1 : 0;
            c[ua] += du; const s3 = solid(c[0], c[1], c[2]) ? 1 : 0; c[ua] -= du; c[va] -= dv;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            aoq[m * 4 + cc] = ao;
            q |= ao << (cc * 2);
            if (first < 0) first = ao; else if (ao !== first) uni = false;
          }
          const kd = kind[i];
          const fid = kd >= K_FIND ? kd - K_FIND : 31;
          // unique key for non-uniform AO faces so they never merge
          keys[m] = uni ? 1 + mm + 256 * (q + 256 * fid) : -(1 + m + 256 * (mm + 256 * (q + 256 * fid)));
          any = true;
        }
        if (!any) continue;
        // greedy merge
        for (let iv = 0; iv < CS; iv++) for (let iu = 0; iu < CS; ) {
          const m = iu + iv * CS;
          const key = keys[m];
          if (key === 0) { iu++; continue; }
          let wdt = 1;
          if (key > 0) while (iu + wdt < CS && keys[m + wdt] === key) wdt++;
          let hgt = 1;
          if (key > 0) {
            outer: while (iv + hgt < CS) {
              for (let t = 0; t < wdt; t++) if (keys[m + t + hgt * CS] !== key) break outer;
              hgt++;
            }
          }
          // emit quad
          c[a] = ka; c[ua] = o[ua] + iu; c[va] = o[va] + iv;
          const i = c[0] + X * (c[2] + Z * c[1]);
          const mm = mat[i];
          const kd = kind[i];
          const fid = kd >= K_FIND ? kd - K_FIND : 31;
          const plane = ka + (sgn > 0 ? 1 : 0);
          const u0 = o[ua] + iu, v0 = o[va] + iv, u1 = u0 + wdt, v1 = v0 + hgt;
          if (nv + 4 > MAXV) break;
          for (let cc = 0; cc < 4; cc++) {
            const p = nv + cc;
            vtx[a] = plane; vtx[ua] = cc === 1 || cc === 2 ? u1 : u0; vtx[va] = cc >= 2 ? v1 : v0;
            sPos[p * 3] = vtx[0]; sPos[p * 3 + 1] = vtx[1]; sPos[p * 3 + 2] = vtx[2];
            sNrm[p * 3] = a === 0 ? sgn * 127 : 0; sNrm[p * 3 + 1] = a === 1 ? sgn * 127 : 0; sNrm[p * 3 + 2] = a === 2 ? sgn * 127 : 0;
            sCol[p * 3] = pal[mm * 3]; sCol[p * 3 + 1] = pal[mm * 3 + 1]; sCol[p * 3 + 2] = pal[mm * 3 + 2];
            sAO[p] = aoq[m * 4 + cc] / 3;
            sFx[p * 3] = glint[mm]; sFx[p * 3 + 1] = fid; sFx[p * 3 + 2] = metal[mm];
          }
          // flip the diagonal to keep AO interpolation isotropic
          const a0 = sAO[nv], a1 = sAO[nv + 1], a2 = sAO[nv + 2], a3 = sAO[nv + 3];
          const flip = a0 + a2 < a1 + a3;
          if (sgn > 0) {
            if (!flip) { sIdx[ni++] = nv; sIdx[ni++] = nv + 1; sIdx[ni++] = nv + 2; sIdx[ni++] = nv; sIdx[ni++] = nv + 2; sIdx[ni++] = nv + 3; }
            else { sIdx[ni++] = nv + 1; sIdx[ni++] = nv + 2; sIdx[ni++] = nv + 3; sIdx[ni++] = nv + 1; sIdx[ni++] = nv + 3; sIdx[ni++] = nv; }
          } else {
            if (!flip) { sIdx[ni++] = nv; sIdx[ni++] = nv + 2; sIdx[ni++] = nv + 1; sIdx[ni++] = nv; sIdx[ni++] = nv + 3; sIdx[ni++] = nv + 2; }
            else { sIdx[ni++] = nv + 1; sIdx[ni++] = nv + 3; sIdx[ni++] = nv + 2; sIdx[ni++] = nv + 1; sIdx[ni++] = nv; sIdx[ni++] = nv + 3; }
          }
          nv += 4;
          for (let tv = 0; tv < hgt; tv++) for (let tu = 0; tu < wdt; tu++) keys[m + tu + tv * CS] = 0;
          iu += wdt;
        }
      }
    }
  }
  if (!nv) return null;
  return {
    pos: sPos.slice(0, nv * 3), nrm: sNrm.slice(0, nv * 3), col: sCol.slice(0, nv * 3), ao: sAO.slice(0, nv),
    fx: sFx.slice(0, nv * 3), idx: sIdx.slice(0, ni), count: nv,
  };
}
