import * as THREE from 'three';
import { mulberry32, makeNoise } from './noise';

// Sky and light for the visitor's local time, worked out by the inline script in
// cloud.astro before first paint (so the CSS sky and this canvas agree).
export type Sky = {
  stops: string[]; // five sRGB colours, bottom to top, at 0, .22, .48, .74, 1
  lightEl: number; // degrees
  lightCol: string; lightI: number;
  amb: string; ambI: number; ground: string;
  stars: number; glowCol: string; glowI: number; exposure: number;
};
export type CloudOpts = { seed: number; comp: 'right' | 'left' | 'above'; sky: Sky; reduced: boolean };

const GX = 112, GY = 58, GZ = 60;
const NC = GX * GY * GZ;
const MAXI = 20000;
const THR = 0.06;

const lin = (hex: string) => new THREE.Color(hex); // three converts sRGB hex to linear

export function startCloud(canvas: HTMLCanvasElement, opts: CloudOpts) {
  const rand = mulberry32(opts.seed * 7919 + 101);
  const R = (a: number, b: number) => a + (b - a) * rand();
  const noise = makeNoise(rand);
  const noise2 = makeNoise(rand);
  const sky = opts.sky;

  // ---------- the cloud's form ----------
  type Puff = { x: number; y: number; z: number; rx: number; ry: number; rz: number; ph: number };
  const puffs: Puff[] = [];
  const base = R(9, 12);
  // forms are laid out on a 104-wide plan and scaled to sit well inside the grid
  const FS = 0.84;
  const P = (x: number, y: number, z: number, r: number, sq = 1) =>
    puffs.push({ x: GX / 2 + (x - 52) * FS, y: base + (y - base) * FS, z, rx: r * FS * R(1.0, 1.2), ry: r * sq * FS, rz: r * FS * R(0.8, 0.95), ph: R(0, 6.28) });
  const formRoll = rand();
  const cz = GZ / 2;
  const GXp = 104; // plan width the forms below are written for
  let form = 'cumulus';
  // one fair-weather cumulus: a broad flat-based body with cauliflower billows on top
  const heap = (cx: number, k: number, zc = cz) => {
    P(cx, base + 7 * k, zc, R(17, 21) * k, 0.62);
    const n = 5 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n - 0.5) * 2;
      P(cx + (a * R(18, 26) + R(-3, 3)) * k, base + (R(9, 15) - Math.abs(a) * 5) * k, zc + R(-6, 6) * k, R(7, 11.5) * (1 - Math.abs(a) * 0.3) * k);
    }
    for (let i = 0; i < 3; i++) P(cx + R(-10, 10) * k, base + R(17, 22) * k, zc + R(-4, 4) * k, R(6, 8.5) * k);
  };
  if (formRoll < 0.5) {
    form = 'cumulus';
    heap(GXp / 2 + R(-4, 4), 1);
  } else if (formRoll < 0.64) {
    // a taller heap, building: cumulus mediocris
    form = 'tower';
    const cx = GXp / 2 + R(-3, 3);
    let x = cx;
    P(cx, base + 6, cz, R(17, 20), 0.55);
    P(cx + R(-14, -8), base + 7, cz + R(-4, 4), R(9, 11), 0.8);
    P(cx + R(8, 14), base + 7, cz + R(-4, 4), R(9, 11), 0.8);
    for (let h = 0; h < 4; h++) {
      x += R(-2.5, 2.5);
      P(x + R(-3, 3), base + 11 + h * R(4.5, 5.5), cz + R(-3, 3), R(11, 12.5) - h * 1.1);
      if (rand() < 0.7) P(x + (rand() < 0.5 ? -1 : 1) * R(6, 9), base + 10 + h * 5, cz + R(-4, 4), R(6, 8) - h * 0.5);
    }
  } else if (formRoll < 0.84) {
    // a drifting line of small heaps
    form = 'row';
    const n = 3;
    for (let i = 0; i < n; i++) heap(20 + (i + 0.5) * ((GXp - 40) / n) + R(-4, 4), R(0.42, 0.55), cz + R(-8, 8));
  } else {
    // two clouds keeping each other company
    form = 'pair';
    const big = rand() < 0.5;
    heap(GXp * (big ? R(0.33, 0.38) : R(0.66, 0.7)), R(0.62, 0.7), cz + R(-5, 5));
    heap(GXp * (big ? R(0.74, 0.8) : R(0.2, 0.26)), R(0.38, 0.46), cz + R(-5, 5));
  }
  // extent of the form, for framing
  let minX = 1e9, maxX = -1e9, maxY = 0;
  for (const p of puffs) { minX = Math.min(minX, p.x - p.rx); maxX = Math.max(maxX, p.x + p.rx); maxY = Math.max(maxY, p.y + p.ry); }
  const EW = Math.min(GX, (maxX - minX) * 1.08), EH = Math.min(GY, maxY - base + 2);
  const ctr = new THREE.Vector3((minX + maxX) / 2 - GX / 2, base + EH * 0.45 - GY / 2, 0);

  const windX = R(0.35, 0.7) * (rand() < 0.5 ? -1 : 1);
  const nScale = R(0.065, 0.085);
  
  const density = (out: Float32Array, t: number, j: number) => {
    const ox = t * windX * nScale, oy = -t * 0.05 * nScale, oz = t * 0.011;
    // condensation level: a flat base that softens over a few cells
    const bc = Math.min(1, Math.max(0, (j - base + 1) / 2.2));
    const baseCut = bc * bc * (3 - 2 * bc);
    const pf = puffs.map((p) => {
      const b = 1 + 0.07 * Math.sin(t * 0.06 + p.ph);
      return { x: p.x + Math.sin(t * 0.027 + p.ph) * 1.5, y: p.y + Math.sin(t * 0.043 + p.ph * 2) * 0.9, z: p.z, rx: p.rx * b, ry: p.ry * b, rz: p.rz * b };
    });
    const hFade = 1 - 0.3 * Math.min(1, Math.max(0, (j - base) / 30));
    for (let k = 0; k < GZ; k++)
      for (let i = 0; i < GX; i++) {
        const c = i + k * GX + j * GX * GZ;
        let s = 0;
        if (baseCut > 0) {
          // puffs merge like metaballs, so heaps read as one body
          for (const p of pf) {
            const dx = (i - p.x) / p.rx, dy = (j - p.y) / p.ry, dz = (k - p.z) / p.rz;
            const v = 1 - (dx * dx + dy * dy + dz * dz) * 0.8;
            if (v > 0) s += v * v;
          }
        }
        if (s <= 0.01) { out[c] = 0; continue; }
        const x = i * nScale + ox, y = j * nScale * 1.1 + oy, z = k * nScale + oz;
        // billows: |noise| gives rounded lobes with creases between, like cauliflower
        const lobe = Math.abs(noise(x, y, z)) * 2;
        const lobe2 = Math.abs(noise(x * 2.2 + 5.3, y * 2.2, z * 2.2)) * 2;
        const fine = noise2(x * 5, y * 5, z * 5 + oz);
        let f = (Math.min(1.3, s) - 0.32) * hFade + 0.5 * (lobe - 0.42) + 0.16 * (lobe2 - 0.42) + 0.05 * fine;
        f = f * baseCut - (1 - baseCut) * 0.2;
        out[c] = f > 0 ? Math.min(1, f * 6) : 0;
      }
  };

  // ---------- light ----------
  const camAz = R(-0.35, 0.35);
  const camEl = -R(0.06, 0.16); // looking up at it
  const toCam = new THREE.Vector3(Math.sin(camAz) * Math.cos(camEl), Math.sin(camEl), Math.cos(camAz) * Math.cos(camEl));
  // sun comes from the side, often a little behind the cloud, so the rims catch the light
  const side = rand() < 0.5 ? -1 : 1;
  const behind = THREE.MathUtils.degToRad(R(65, 150));
  const hAz = camAz + side * behind;
  const lEl = THREE.MathUtils.degToRad(sky.lightEl);
  const L = new THREE.Vector3(Math.sin(hAz) * Math.cos(lEl), Math.sin(lEl), Math.cos(hAz) * Math.cos(lEl)).normalize();
  const cosT = -L.dot(toCam); // light travelling along -L, scattered towards the camera
  const hg = (g: number) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * cosT, 1.5);
  const phase = [0.75 * hg(0.55) + 0.25 * hg(-0.2), 0.75 * hg(0.3) + 0.25 * hg(-0.1), hg(0.12)];

  const lightC = lin(sky.lightCol).multiplyScalar(sky.lightI);
  const ambC = lin(sky.amb).multiplyScalar(sky.ambI);
  const groundC = lin(sky.ground);
  const skyMid = lin(sky.stops[2]).lerp(lin(sky.stops[3]), 0.5);
  const exposure = sky.exposure;
  const aces = (x: number) => {
    x *= exposure;
    const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    return Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
  };

  // trilinear, so the light-march does not checker the surface
  const L2 = GX * GZ;
  const sampleD = (d: Float32Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= GX - 1 || y >= GY - 1 || z >= GZ - 1) return 0;
    const i = x | 0, j = y | 0, k = z | 0, fx = x - i, fy = y - j, fz = z - k;
    const c = i + k * GX + j * L2;
    const a0 = d[c] + (d[c + 1] - d[c]) * fx, a1 = d[c + GX] + (d[c + GX + 1] - d[c + GX]) * fx;
    const b0 = d[c + L2] + (d[c + L2 + 1] - d[c + L2]) * fx, b1 = d[c + L2 + GX] + (d[c + L2 + GX + 1] - d[c + L2 + GX]) * fx;
    const a = a0 + (a1 - a0) * fz, b = b0 + (b1 - b0) * fz;
    return a + (b - a) * fy;
  };

  const light = (d: Float32Array, col: Float32Array, c: number) => {
    const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / (GX * GZ));
    let tau = 0;
    for (let s = 1; s <= 12; s++) tau += sampleD(d, i + L.x * s * 1.6, j + L.y * s * 1.6, k + L.z * s * 1.6);
    tau *= 1.6 * 0.75;
    let up = 0;
    for (let s = 1; s <= 6; s++) up += sampleD(d, i, j + s * 1.8, k);
    let dn = 0;
    for (let s = 1; s <= 4; s++) dn += sampleD(d, i, j - s * 1.8, k);
    const tUp = Math.exp(-up * 0.7), tDn = Math.exp(-dn * 0.5);
    // multiple scattering as a sum of ever softer, ever more forgiving octaves
    const sun = Math.exp(-tau) * phase[0] + 0.4 * Math.exp(-tau * 0.3) * phase[1] + 0.18 * Math.exp(-tau * 0.1) * phase[2];
    const amb = 0.36 + 0.64 * tUp;
    const own = d[c];
    const thin = Math.min(1, own * 2.2);
    for (let ch = 0; ch < 3; ch++) {
      const lc = ch === 0 ? lightC.r : ch === 1 ? lightC.g : lightC.b;
      const ac = ch === 0 ? ambC.r : ch === 1 ? ambC.g : ambC.b;
      const gc = ch === 0 ? groundC.r : ch === 1 ? groundC.g : groundC.b;
      const sc = ch === 0 ? skyMid.r : ch === 1 ? skyMid.g : skyMid.b;
      let v = lc * sun * 0.75 + ac * amb * 0.85 + gc * 0.1 * tDn * (1 - tUp * 0.5);
      // wisps take on the sky behind them
      v = v * (0.55 + 0.45 * thin) + sc * (1 - thin) * 0.45;
      col[c * 3 + ch] = aces(v);
    }
  };

  // ---------- keyframes, built a slice at a time ----------
  type Key = { d: Float32Array; col: Float32Array; t: number; done: boolean };
  const mkKey = (): Key => ({ d: new Float32Array(NC), col: new Float32Array(NC * 3), t: 0, done: false });
  let kA = mkKey(), kB = mkKey(), kN = mkKey();
  const blur = new Float32Array(NC * 3);
  function* build(key: Key, t: number) {
    key.t = t; key.done = false;
    for (let j = 0; j < GY; j++) { density(key.d, t, j); yield; }
    let n = 0;
    for (let c = 0; c < NC; c++) {
      if (key.d[c] > THR * 0.5) { light(key.d, key.col, c); if (++n % 1500 === 0) yield; }
    }
    // light scatters: soften the baked colour across neighbouring cells
    const d = key.d, col = key.col, L2c = GX * GZ;
    n = 0;
    for (let c = L2c; c < NC - L2c; c++) {
      if (d[c] <= THR * 0.5) continue;
      let r = col[c * 3] * 2, g = col[c * 3 + 1] * 2, b = col[c * 3 + 2] * 2, w = 2;
      for (const o of [1, -1, GX, -GX, L2c, -L2c]) {
        const q = c + o;
        if (d[q] > THR * 0.5) { r += col[q * 3]; g += col[q * 3 + 1]; b += col[q * 3 + 2]; w++; }
      }
      blur[c * 3] = r / w; blur[c * 3 + 1] = g / w; blur[c * 3 + 2] = b / w;
      if (++n % 6000 === 0) yield;
    }
    for (let c = L2c; c < NC - L2c; c++) if (d[c] > THR * 0.5) { col[c * 3] = blur[c * 3]; col[c * 3 + 1] = blur[c * 3 + 1]; col[c * 3 + 2] = blur[c * 3 + 2]; }
    key.done = true;
  }
  const runAll = (g: Generator) => { while (!g.next().done); };

  // cells worth drawing: dense enough in either key, and not hidden inside
  const cand = new Int32Array(NC);
  let nCand = 0;
  const FULL = 0.42;
  const solidBoth = (c: number) => kA.d[c] > FULL && kB.d[c] > FULL;
  const collect = () => {
    nCand = 0;
    const L1 = GX, L2 = GX * GZ;
    for (let c = 0; c < NC; c++) {
      if (Math.max(kA.d[c], kB.d[c]) <= THR) continue;
      const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / L2);
      if (i > 0 && i < GX - 1 && k > 0 && k < GZ - 1 && j > 0 && j < GY - 1 && solidBoth(c) &&
        solidBoth(c + 1) && solidBoth(c - 1) && solidBoth(c + L1) && solidBoth(c - L1) && solidBoth(c + L2) && solidBoth(c - L2)) continue;
      cand[nCand++] = c;
    }
  };

  // ---------- three ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 2000);

  const stops = sky.stops.map((h) => new THREE.Color().setStyle(h, THREE.LinearSRGBColorSpace));
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uS: { value: stops }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uStars: { value: sky.stars },
      uSun: { value: new THREE.Vector3(0.5, -1, 0) }, uGlow: { value: new THREE.Color().setStyle(sky.glowCol, THREE.LinearSRGBColorSpace).multiplyScalar(sky.glowI) },
    },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: `uniform vec3 uS[5]; uniform vec2 uRes; uniform float uTime; uniform float uStars; uniform vec3 uSun; uniform vec3 uGlow;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        vec2 f = gl_FragCoord.xy / uRes; float v = f.y;
        vec3 c = v < .22 ? mix(uS[0], uS[1], v / .22) : v < .48 ? mix(uS[1], uS[2], (v - .22) / .26) : v < .74 ? mix(uS[2], uS[3], (v - .48) / .26) : mix(uS[3], uS[4], (v - .74) / .26);
        // a low sun warms its side of the sky
        if (uSun.z > 0.0) { vec2 d = (f - uSun.xy) * vec2(uRes.x / uRes.y, 1.0); c += uGlow * (exp(-dot(d, d) * 3.0) * .55 + exp(-dot(d, d) * .6) * .25) * uSun.z; }
        // stars: one dim square voxel in a few cells of a coarse grid
        if (uStars > 0.0) {
          float px = max(1.0, floor(uRes.y / 420.0));
          vec2 cell = floor(gl_FragCoord.xy / (34.0 * px));
          float r = h21(cell);
          if (r < .085) {
            vec2 pos = (cell + .2 + .6 * vec2(h21(cell + 7.1), h21(cell + 3.3))) * 34.0 * px;
            vec2 q = abs(gl_FragCoord.xy - pos);
            float sz = (r < .012 ? 1.5 : 1.0) * px;
            if (max(q.x, q.y) < sz) {
              float tw = .65 + .35 * sin(uTime * (.4 + h21(cell + 1.7)) + r * 80.0);
              c += vec3(.75, .8, 1.0) * uStars * tw * (.18 + 2.2 * h21(cell + 9.9) * .12) * smoothstep(.15, .5, v);
            }
          }
        }
        c += (h21(gl_FragCoord.xy + fract(uTime) * 61.0) - .5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const skyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  skyQuad.frustumCulled = false; skyQuad.renderOrder = -10;
  scene.add(skyQuad);

  const Ls = L.clone();
  const cubeMat = new THREE.ShaderMaterial({
    uniforms: { uL: { value: Ls } },
    vertexShader: `varying vec3 vC; varying vec3 vN;
      void main(){ vC = instanceColor; vN = normalize(mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uL; varying vec3 vC; varying vec3 vN;
      float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        vec3 n = normalize(vN);
        float s = 1.0 + .045 * n.y - .035 * (1.0 - abs(n.y)) + .05 * dot(n, uL);
        vec3 c = vC * s + (h21(gl_FragCoord.xy) - .5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cubeMat, MAXI);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const group = new THREE.Group();
  group.add(mesh);
  mesh.position.set(-GX / 2 + 0.5 - ctr.x, -GY / 2 + 0.5 - ctr.y, -GZ / 2 + 0.5);
  scene.add(group);
  const mArr = mesh.instanceMatrix.array as Float32Array;
  const cArr = mesh.instanceColor.array as Float32Array;
  for (let n = 0; n < MAXI; n++) mArr[n * 16 + 15] = 1;

  const writeInstances = (a: number) => {
    const b = 1 - a, L2 = GX * GZ;
    let n = 0;
    const dA = kA.d, dB = kB.d, cA = kA.col, cB = kB.col;
    for (let q = 0; q < nCand && n < MAXI; q++) {
      const c = cand[q];
      const d = dA[c] * b + dB[c] * a;
      let s = (d - THR) / 0.13;
      if (s <= 0.04) continue;
      if (s > 1) s = 1;
      s = s * s * (3 - 2 * s);
      const sz = 0.2 + 0.8 * s;
      const i = c % GX, k = Math.floor(c / GX) % GZ, j = Math.floor(c / L2);
      const o = n * 16;
      mArr[o] = sz; mArr[o + 5] = sz; mArr[o + 10] = sz;
      mArr[o + 12] = i; mArr[o + 13] = j; mArr[o + 14] = k;
      // a cell only lit in one key borrows the other's colour
      const wa = dA[c] > THR * 0.5 ? b : 0, wb = dB[c] > THR * 0.5 ? a : 0, ws = 1 / Math.max(1e-4, wa + wb);
      const o3 = n * 3, c3 = c * 3;
      cArr[o3] = (cA[c3] * wa + cB[c3] * wb) * ws;
      cArr[o3 + 1] = (cA[c3 + 1] * wa + cB[c3 + 1] * wb) * ws;
      cArr[o3 + 2] = (cA[c3 + 2] * wa + cB[c3 + 2] * wb) * ws;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.clearUpdateRanges(); mesh.instanceColor!.addUpdateRange(0, n * 3); mesh.instanceColor!.needsUpdate = true;
  };

  // ---------- framing ----------
  let W = 1, H = 1, stacked = false;
  const fovR = THREE.MathUtils.degToRad(30);
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let anchorY = 0; // page y (px) the cloud's centre sits at
  const fxOf = () => (stacked ? 0.5 : opts.comp === 'right' ? 0.68 : opts.comp === 'left' ? 0.32 : 0.5);
  const sunScreen = new THREE.Vector3();
  const frame = () => {
    const fracW = stacked ? 0.88 : opts.comp === 'above' ? 0.56 : 0.42;
    const fracH = stacked ? 0.3 : 0.44;
    const visH = Math.max(EW / fracW / (W / H), EH / fracH);
    const dist = visH / (2 * Math.tan(fovR / 2));
    const az = camAz + look.x * 0.06, el = camEl + look.y * 0.03;
    camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const fx = fxOf(), fy = (anchorY - window.scrollY) / H;
    const n = camera.near, top = n * Math.tan(fovR / 2), hgt = 2 * top, wid = hgt * (W / H);
    const l = -fx * wid, t = fy * hgt;
    camera.projectionMatrix.makePerspective(l, l + wid, t, t - hgt, n, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // where the sun sits on screen, for the glow
    sunScreen.copy(L).multiplyScalar(1000).add(camera.position).project(camera);
    const inFront = L.dot(camera.getWorldDirection(new THREE.Vector3())) > -0.2;
    skyMat.uniforms.uSun.value.set(sunScreen.x * 0.5 + 0.5, Math.max(-0.2, sunScreen.y * 0.5 + 0.5), inFront && sky.glowI > 0 ? 1 : 0);
  };
  const resize = () => {
    W = window.innerWidth; H = window.innerHeight;
    stacked = W < 760 && W / H < 1.05;
    anchorY = H * (stacked ? 0.24 : opts.comp === 'above' ? 0.3 : 0.4);
    renderer.setSize(W, H, false);
    skyMat.uniforms.uRes.value.set(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
  };

  // ---------- go ----------
  let T = R(0, 500);
  const PERIOD = 2.4;
  runAll(build(kA, T));
  runAll(build(kB, T + PERIOD));
  collect();
  let builder: Generator | null = opts.reduced ? null : build(kN, T + 2 * PERIOD);
  let keyT0 = T;
  writeInstances(0);

  let raf = 0, last = performance.now(), running = false, shown = false, frameNo = 0;
  const render = () => {
    look.x += (look.tx - look.x) * 0.02; look.y += (look.ty - look.y) * 0.02;
    frame();
    renderer.render(scene, camera);
    if (!shown) { shown = true; requestAnimationFrame(() => canvas.classList.add('on')); }
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    T += dt;
    skyMat.uniforms.uTime.value = T;
    // build the next key within a small budget per frame
    if (builder) {
      const t0 = performance.now();
      while (performance.now() - t0 < 4) { if (builder.next().done) { builder = null; break; } }
    }
    let a = (T - keyT0) / PERIOD;
    if (a >= 1 && kN.done) {
      const old = kA; kA = kB; kB = kN; kN = old; kN.done = false;
      keyT0 += PERIOD; a = (T - keyT0) / PERIOD;
      collect();
      builder = build(kN, keyT0 + 2 * PERIOD);
    }
    a = Math.min(1, Math.max(0, a));
    if (++frameNo % 2 === 0) writeInstances(a);
    // the whole cloud drifts a little and turns, very slowly
    group.position.x = Math.sin(T * 0.012) * 3;
    group.position.y = Math.sin(T * 0.017 + 1) * 0.8;
    group.rotation.y = Math.sin(T * 0.009) * 0.08;
    render();
  };
  const play = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  resize();
  window.addEventListener('resize', () => { resize(); if (!running) render(); });
  window.addEventListener('scroll', () => { if (!running) requestAnimationFrame(render); }, { passive: true });
  if (!opts.reduced) {
    window.addEventListener('pointermove', (e) => { look.tx = e.clientX / W - 0.5; look.ty = e.clientY / H - 0.5; }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
    if (!document.hidden) play(); else render();
  } else {
    render();
  }
}
