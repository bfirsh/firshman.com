// Terraform: a voxel sea on a diorama plinth. Raise land, and the world lives on it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sim, SEA, FLOOR, MAXH } from './sim';
import { PALETTES, mulberry } from './palette';
import * as SH from './shaders';
import { Sound } from './audio';
import { CAPITAL, TOWNS, GREETS, KEEPER, type Place } from './content';

type UI = {
  sites: HTMLElement;
  hint: HTMLElement;
  prog: HTMLElement;
  sound: HTMLButtonElement;
  time: HTMLInputElement;
  cycle: HTMLButtonElement;
  credits: HTMLElement;
  isOpen: () => boolean;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const easeBack = (t: number) => { const c = 1.9; t = Math.min(1, Math.max(0, t)); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export function startTerraform(canvas: HTMLCanvasElement, ui: UI, opts: { seed: number; reduced: boolean }) {
  const { seed, reduced } = opts;
  const rnd = mulberry(seed);
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length) % PALETTES.length];
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 640;
  const N = small ? 48 : 64;
  const NN = N * N;
  const H = N / 2;

  // ------------------------------------------------------------------ world
  const weather = { rain: 0.6 + rnd() * 0.8, clouds: 3 + Math.floor(rnd() * 3), windA: rnd() * Math.PI * 2, wind: 1.3 + rnd() * 0.8 };
  const sim = new Sim(N, rnd, { snowLine: 6.6 + rnd() * 1.6, treeiness: 0.7 + rnd() * 0.6, palms: pal.palms, seed });
  sim.generate();
  const land0 = sim.land;

  // ------------------------------------------------------------------ renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  const maxDpr = coarse ? 1.6 : 1.5;
  let dprScale = 1;
  let W = 1, Hh = 1, dpr = 1;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: coarse ? 2 : 4 });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 900);

  const col = (hex: string) => new THREE.Color(hex);
  const C = {
    deep: col(pal.deep), shallow: col(pal.shallow), fresh: col(pal.fresh), foam: col(pal.foam),
    sand: col(pal.sand), seabed: col(pal.seabed), weed: col(pal.weed), dirt: col(pal.dirt),
    grassLo: col(pal.grassLo), grassHi: col(pal.grassHi), rock1: col(pal.rock1), rock2: col(pal.rock2), snow: col(pal.snow),
    leaf: col(pal.leaf), leaf2: col(pal.leaf2), pine: col(pal.pine), trunk: col(pal.trunk), wall: col(pal.wall),
    plinth: col(pal.plinth), rim: col(pal.rim), sky: col(pal.sky), ground: col(pal.ground),
  };
  const roofs = pal.roofs.map(col);

  // height texture = the displayed column tops
  const dh = new Float32Array(NN), dv = new Float32Array(NN), qh = new Float32Array(NN);
  const quant = (h: number) => (Math.floor(h / 0.5) + 0.5) * 0.5;
  for (let k = 0; k < NN; k++) { qh[k] = quant(sim.h[k]); dh[k] = qh[k]; }
  const heightTex = new THREE.DataTexture(dh, N, N, THREE.RedFormat, THREE.FloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.NearestFilter;
  heightTex.needsUpdate = true;

  const U = SH.makeUniforms(N, heightTex);
  U.uDeep.value.copy(C.deep); U.uShallow.value.copy(C.shallow); U.uFresh.value.copy(C.fresh); U.uFoam.value.copy(C.foam);
  U.uDirt.value.copy(C.dirt); U.uRock1.value.copy(C.rock1); U.uRock2.value.copy(C.rock2); U.uSeabed.value.copy(C.seabed);
  U.uSwell.value = reduced ? 0.35 : 1;
  {
    const d = C.deep, m = Math.max(d.r, d.g, d.b);
    const f = (v: number) => 0.1 + 0.2 * -Math.log(Math.max(0.02, v / m));
    U.uAbsorb.value.set(f(d.r), f(d.g), f(d.b));
  }

  // ------------------------------------------------------------------ lights
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  const smap = coarse ? 1024 : 2048;
  sun.shadow.mapSize.set(smap, smap);
  const scam = sun.shadow.camera;
  scam.left = -H - 8; scam.right = H + 8; scam.top = H + 8; scam.bottom = -H - 8; scam.near = 1; scam.far = 200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.intensity = 0.82;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  scene.add(hemi);

  // ------------------------------------------------------------------ plinth
  const PW = N + 1.4, PH = 2.3;
  const plaqueTex = (lines: [string, string]) => {
    const cv = document.createElement('canvas');
    cv.width = 4096; cv.height = Math.round((4096 * PH) / PW);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const draw = () => {
      const g = cv.getContext('2d')!;
      g.fillStyle = pal.plinth; g.fillRect(0, 0, cv.width, cv.height);
      const r = mulberry(seed + 3);
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.035})`; g.fillRect(r() * cv.width, r() * cv.height, 2 + r() * 6, 1); }
      g.strokeStyle = pal.rim; g.globalAlpha = 0.5; g.lineWidth = 2;
      g.strokeRect(28, 22, cv.width - 56, cv.height - 44);
      g.globalAlpha = 1;
      g.fillStyle = pal.rim; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `500 ${Math.round(cv.height * 0.3)}px Fraunces, Georgia, serif`;
      (g as any).letterSpacing = `${Math.round(cv.height * 0.12)}px`;
      g.fillText(lines[0], cv.width / 2, cv.height * 0.44);
      g.font = `italic 400 ${Math.round(cv.height * 0.15)}px Fraunces, Georgia, serif`;
      (g as any).letterSpacing = `${Math.round(cv.height * 0.03)}px`;
      g.globalAlpha = 0.75;
      g.fillText(lines[1], cv.width / 2, cv.height * 0.73);
      g.globalAlpha = 1;
      tex.needsUpdate = true;
    };
    draw();
    document.fonts?.load(`500 40px Fraunces`).then(draw).catch(() => {});
    return tex;
  };
  const plain = new THREE.MeshLambertMaterial({ color: C.plinth });
  const ft = plaqueTex(['BEN FIRSHMAN', 'an archipelago, raised by hand']), st = plaqueTex(['TERRAFORM', `edition no. ${seed}`]);
  const front = new THREE.MeshLambertMaterial({ map: ft, emissiveMap: ft, emissive: new THREE.Color(0.32, 0.3, 0.27) });
  const side = new THREE.MeshLambertMaterial({ map: st, emissiveMap: st, emissive: new THREE.Color(0.32, 0.3, 0.27) });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PW), [side, plain, plain, plain, front, plain]);
  plinth.position.y = FLOOR - PH / 2 - 0.002;
  plinth.receiveShadow = true;
  scene.add(plinth);
  const rimMat = new THREE.MeshLambertMaterial({ color: C.rim });
  const rim = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.12, 0.12, PW + 0.12), rimMat);
  rim.position.y = FLOOR - 0.06;
  rim.receiveShadow = true;
  scene.add(rim);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.7, 0.35, PW + 0.7), new THREE.MeshLambertMaterial({ color: C.plinth.clone().multiplyScalar(0.7) }));
  foot.position.y = FLOOR - PH - 0.175;
  scene.add(foot);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(PW * 1.9, PW * 1.9), SH.shadowBlobMaterial(PW + 1));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = FLOOR - PH - 0.36;
  blob.renderOrder = -1;
  scene.add(blob);

  // ------------------------------------------------------------------ terrain columns
  const colGeo = new THREE.BoxGeometry(1, 1, 1);
  colGeo.translate(0, 0.5, 0);
  const iTop = new THREE.InstancedBufferAttribute(new Float32Array(NN * 3), 3);
  const iCap = new THREE.InstancedBufferAttribute(new Float32Array(NN), 1);
  iTop.setUsage(THREE.DynamicDrawUsage); iCap.setUsage(THREE.DynamicDrawUsage);
  colGeo.setAttribute('iTop', iTop);
  colGeo.setAttribute('iCap', iCap);
  const terrain = new THREE.InstancedMesh(colGeo, SH.terrainMaterial(U), NN);
  terrain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  terrain.castShadow = terrain.receiveShadow = true;
  terrain.frustumCulled = false;
  const TM = terrain.instanceMatrix.array as Float32Array;
  for (let k = 0; k < NN; k++) {
    const o = k * 16;
    TM[o] = 1; TM[o + 5] = dh[k] - FLOOR; TM[o + 10] = 1; TM[o + 15] = 1;
    TM[o + 12] = sim.cx(k % N); TM[o + 13] = FLOOR; TM[o + 14] = sim.cx((k / N) | 0);
  }
  scene.add(terrain);

  // ------------------------------------------------------------------ water
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(N, N, N * 2, N * 2).rotateX(-Math.PI / 2), SH.seaMaterial(U));
  sea.position.y = SEA;
  sea.renderOrder = 2;
  scene.add(sea);
  const wallMat = SH.wallWaterMaterial(U);
  for (let s = 0; s < 4; s++) {
    const g = new THREE.PlaneGeometry(N + 0.04, SEA - FLOOR);
    const m = new THREE.Mesh(g, wallMat);
    const a = (s * Math.PI) / 2;
    m.rotation.y = a;
    m.position.set(Math.sin(a) * (H + 0.025), (SEA + FLOOR) / 2, Math.cos(a) * (H + 0.025));
    m.renderOrder = 3;
    scene.add(m);
  }
  const freshGeo = new THREE.PlaneGeometry(1.02, 1.02).rotateX(-Math.PI / 2);
  const aFlow = new THREE.InstancedBufferAttribute(new Float32Array(NN * 4), 4);
  aFlow.setUsage(THREE.DynamicDrawUsage);
  freshGeo.setAttribute('aFlow', aFlow);
  const fresh = new THREE.InstancedMesh(freshGeo, SH.freshMaterial(U), NN);
  fresh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fresh.frustumCulled = false;
  fresh.count = 0;
  fresh.renderOrder = 1;
  scene.add(fresh);

  // ------------------------------------------------------------------ geometry kits
  const vbox = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const broadGeo = mergeGeometries([
    vbox(0.1, 0.3, 0.1, 0, 0.15, 0, C.trunk),
    vbox(0.44, 0.36, 0.44, 0, 0.46, 0, C.leaf),
    vbox(0.28, 0.2, 0.28, 0.03, 0.72, -0.02, C.leaf2),
  ]);
  const pineGeo = mergeGeometries([
    vbox(0.08, 0.2, 0.08, 0, 0.1, 0, C.trunk),
    vbox(0.4, 0.2, 0.4, 0, 0.28, 0, C.pine),
    vbox(0.3, 0.2, 0.3, 0, 0.47, 0, C.pine.clone().offsetHSL(0, 0, 0.03)),
    vbox(0.18, 0.22, 0.18, 0, 0.66, 0, C.pine.clone().offsetHSL(0, 0, 0.06)),
  ]);
  const palmGeo = mergeGeometries([
    vbox(0.07, 0.24, 0.07, 0, 0.12, 0, C.trunk),
    vbox(0.065, 0.24, 0.065, 0.04, 0.35, 0, C.trunk.clone().offsetHSL(0, 0, 0.05)),
    vbox(0.4, 0.05, 0.11, 0.08, 0.5, 0, C.leaf2),
    vbox(0.11, 0.05, 0.4, 0.04, 0.5, 0, C.leaf2),
    vbox(0.16, 0.06, 0.16, 0.04, 0.53, 0, C.leaf),
  ]);
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mkInst = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow; m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    return m;
  };
  const TREECAP = Math.floor(NN * 0.45);
  const trees = [mkInst(broadGeo, treeMat, TREECAP), mkInst(pineGeo, treeMat, TREECAP), mkInst(palmGeo, treeMat, Math.floor(TREECAP / 3))];

  // houses: walls (with windows) + gable roofs
  const wallGeo = new THREE.BoxGeometry(0.34, 0.24, 0.28);
  wallGeo.scale(1.3, 1.3, 1.3);
  wallGeo.translate(0, 0.12, 0);
  const HCAP = 140;
  const iLight = new THREE.InstancedBufferAttribute(new Float32Array(HCAP), 1);
  wallGeo.setAttribute('iLight', iLight);
  const roofGeo = (() => {
    const a = 0.21, b = 0.18, h = 0.17;
    const P = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b], [-a, h, 0], [a, h, 0]];
    const T = [3, 2, 5, 3, 5, 4, 1, 0, 4, 1, 4, 5, 0, 3, 4, 2, 1, 5, 0, 1, 2, 0, 2, 3];
    const pos = new Float32Array(T.length * 3);
    T.forEach((v, i) => pos.set(P[v], i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.translate(0, 0.24, 0);
    g.scale(1.3, 1.3, 1.3);
    return g;
  })();
  const walls = mkInst(wallGeo, SH.wallMaterial(U), HCAP);
  const roofsMesh = mkInst(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), HCAP);

  // generic boxes for piers, boats, the lighthouse and splashes
  class Boxes {
    mesh: THREE.InstancedMesh;
    n = 0;
    A: Float32Array;
    Cc: Float32Array;
    constructor(mat: THREE.Material, cap: number, shadow: boolean) {
      this.mesh = mkInst(new THREE.BoxGeometry(1, 1, 1), mat, cap, shadow);
      this.A = this.mesh.instanceMatrix.array as Float32Array;
      this.Cc = this.mesh.instanceColor!.array as Float32Array;
    }
    add(x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number, c: THREE.Color, b = 1) {
      if (this.n >= this.mesh.instanceMatrix.count) return;
      const o = this.n * 16, cs = Math.cos(rot), sn = Math.sin(rot), A = this.A;
      A[o] = cs * sx; A[o + 1] = 0; A[o + 2] = -sn * sx; A[o + 3] = 0;
      A[o + 4] = 0; A[o + 5] = sy; A[o + 6] = 0; A[o + 7] = 0;
      A[o + 8] = sn * sz; A[o + 9] = 0; A[o + 10] = cs * sz; A[o + 11] = 0;
      A[o + 12] = x; A[o + 13] = y; A[o + 14] = z; A[o + 15] = 1;
      this.Cc[this.n * 3] = c.r * b; this.Cc[this.n * 3 + 1] = c.g * b; this.Cc[this.n * 3 + 2] = c.b * b;
      this.n++;
    }
    commit() {
      this.mesh.count = this.n;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
      this.n = 0;
    }
  }
  const props = new Boxes(new THREE.MeshLambertMaterial({ color: 0xffffff }), 900, true);
  const cloudMat = SH.cloudMaterial(U);
  const cloudEm = cloudMat.emissive;
  const cloudBoxes = new Boxes(cloudMat, 900, false);
  cloudBoxes.mesh.renderOrder = 5;
  const rainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.8, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.7, 0.86), transparent: true, opacity: 0.22, depthWrite: false }), 900);
  rainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rainMesh.frustumCulled = false;
  rainMesh.count = 0;
  rainMesh.renderOrder = 4;
  scene.add(rainMesh);

  // glows
  const GCAP = 260;
  const gGeo = new THREE.BufferGeometry();
  const gPos = new Float32Array(GCAP * 3), gTh = new Float32Array(GCAP), gSize = new Float32Array(GCAP), gCol = new Float32Array(GCAP * 3);
  gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage));
  gGeo.setAttribute('aTh', new THREE.BufferAttribute(gTh, 1).setUsage(THREE.DynamicDrawUsage));
  gGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1).setUsage(THREE.DynamicDrawUsage));
  gGeo.setAttribute('aCol', new THREE.BufferAttribute(gCol, 3).setUsage(THREE.DynamicDrawUsage));
  const glowMat = SH.glowMaterial(U);
  const glows = new THREE.Points(gGeo, glowMat);
  glows.frustumCulled = false;
  glows.renderOrder = 6;
  scene.add(glows);
  let gN = 0;
  const glow = (x: number, y: number, z: number, size: number, th: number, r: number, g: number, b: number) => {
    if (gN >= GCAP) return;
    gPos[gN * 3] = x; gPos[gN * 3 + 1] = y; gPos[gN * 3 + 2] = z;
    gTh[gN] = th; gSize[gN] = size; gCol[gN * 3] = r; gCol[gN * 3 + 1] = g; gCol[gN * 3 + 2] = b;
    gN++;
  };
  // lighthouse beams
  const beamGeo = new THREE.ConeGeometry(1.1, 10, 20, 1, true);
  beamGeo.translate(0, -5, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uLights: U.uLights },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying float vA; void main(){ vA = clamp(length(position) / 10.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uLights; varying float vA; void main(){ float a = pow(1.0 - vA, 2.2) * uLights * 0.1; gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, 0.0); }`,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const beam = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  beam.visible = false;
  beam.renderOrder = 7;
  scene.add(beam);

  // post
  const post = SH.postMaterial(rt.texture);
  const postScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  quad.frustumCulled = false;
  postScene.add(quad);
  const postCam = new THREE.Camera();

  // ------------------------------------------------------------------ camera
  let az = Math.PI / 4 + (rnd() - 0.5) * 0.5, el = 0.56, zoom = 1, azV = 0;
  let intro = reduced ? 1 : 0;
  const target = new THREE.Vector3(0, 0.6, 0);
  // distance at which the whole plinth fits the frame (corners may crop on portrait phones),
  // plus a vertical shift that centres it
  const fitV = new THREE.Vector3(), fitQ = new THREE.Vector3(), fitM = new THREE.Matrix4();
  let fitCache = { key: '', d: 100, cy: 0 };
  const fitDist = () => {
    const e = elEff();
    const key = `${az.toFixed(3)}|${e.toFixed(3)}|${camera.aspect.toFixed(3)}`;
    if (fitCache.key === key) return fitCache;
    const portrait = camera.aspect < 0.85;
    const mx = portrait ? 1.3 : 0.88, span = portrait ? 1.3 : 1.62;
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let cy = 0;
    const fits = (d: number) => {
      const pos = fitV.set(Math.sin(az) * Math.cos(e) * d, Math.sin(e) * d, Math.cos(az) * Math.cos(e) * d).add(target);
      fitM.lookAt(pos, target, camera.up).setPosition(pos).invert();
      let lo = 9, hi = -9;
      for (let c = 0; c < 8; c++) {
        const x = (c & 1 ? 1 : -1) * (PW / 2 + 0.4), z = (c & 2 ? 1 : -1) * (PW / 2 + 0.4), y = c & 4 ? 2 : FLOOR - PH - 0.4;
        const q = fitQ.set(x, y, z).applyMatrix4(fitM);
        if (q.z > -1) return false;
        const sx = q.x / -q.z / (tv * camera.aspect), sy = q.y / -q.z / tv;
        if (Math.abs(sx) > mx) return false;
        lo = Math.min(lo, sy); hi = Math.max(hi, sy);
      }
      cy = (lo + hi) / 2;
      return hi - lo <= span;
    };
    let lo = 20, hi = 900;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    fits(hi);
    fitCache = { key, d: hi, cy };
    return fitCache;
  };
  const elEff = () => Math.min(1.12, el + (camera.aspect < 0.85 ? 0.24 : 0));
  const placeCamera = () => {
    const ease = reduced ? 1 : 1 - Math.pow(1 - intro, 3);
    const fit = fitDist();
    const d = fit.d * zoom * lerp(1.22, 1, ease);
    const e = elEff() + (1 - ease) * 0.12;
    const a = az + (1 - ease) * -0.35;
    camera.position.set(Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d, Math.cos(a) * Math.cos(e) * d).add(target);
    camera.lookAt(target);
    camera.near = d * 0.3; camera.far = d * 3;
    camera.updateProjectionMatrix();
    // centre the plinth vertically (a touch below the middle, under the title)
    const shift = (camera.aspect < 0.85 ? -0.02 : -0.05) - fit.cy / zoom;
    camera.projectionMatrix.elements[9] -= shift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  };

  const resize = () => {
    W = innerWidth; Hh = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, maxDpr) * dprScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, Hh, false);
    rt.setSize(Math.floor(W * dpr), Math.floor(Hh * dpr));
    camera.aspect = W / Hh;
    post.uniforms.uRes.value.set(Math.floor(W * dpr), Math.floor(Hh * dpr));
    placeCamera();
  };
  resize();
  addEventListener('resize', resize);

  // ------------------------------------------------------------------ time of day
  let tday = rnd() < 0.72 ? 0.655 + rnd() * 0.04 : 0.29 + rnd() * 0.03;
  let cycling = !reduced;
  let dayNum = 1;
  const sunAz = (() => {
    const camAng = Math.atan2(Math.cos(az), Math.sin(az));
    const target = camAng + Math.PI + (rnd() < 0.5 ? -1 : 1) * (0.85 + rnd() * 0.4);
    return target - Math.atan2(0.42, -0.74);
  })();
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  const bgDay = [col(pal.bgTop), col(pal.bgBot)], bgDusk = [col(pal.duskTop), col(pal.duskBot)], bgNight = [col(pal.nightTop), col(pal.nightBot)];
  let lightsOn = 0, sunUp = 1, nightF = 0, isNight = false;
  const srgb = (c: THREE.Color, out: THREE.Color) => out.copy(c).convertLinearToSRGB();
  const glowV = new THREE.Vector3();
  const applyTime = () => {
    const a = (tday - 0.25) * Math.PI * 2;
    let dx = Math.cos(a) * 0.8, dy = Math.sin(a) * 0.78 + 0.05, dz = 0.42;
    const cs = Math.cos(sunAz), sn = Math.sin(sunAz);
    sunDir.set(dx * cs - dz * sn, dy, dx * sn + dz * cs).normalize();
    moonDir.set(-sunDir.x, Math.abs(sunDir.y) * 0.8 + 0.35, -sunDir.z).normalize();
    const s = sunDir.y;
    const day = smooth(0.12, 0.45, s);
    const night = 1 - smooth(-0.24, -0.02, s);
    const dusk = Math.max(0, 1 - day - night);
    nightF = night;
    sunUp = smooth(-0.04, 0.12, s);
    const golden = 1 - smooth(0.05, 0.42, s);
    const moon = 1 - smooth(-0.2, 0.0, s);
    const sunCol = tmpC.setRGB(1.0, lerp(0.93, 0.55, golden), lerp(0.8, 0.28, golden)).multiplyScalar(4.3 * sunUp);
    const moonCol = tmpC2.setRGB(0.42, 0.52, 0.86).multiplyScalar(0.85 * moon);
    sun.color.copy(sunCol).add(moonCol);
    sun.intensity = 1;
    const ld = s > -0.03 ? sunDir : moonDir;
    cloudEm.setRGB(0.2, 0.2, 0.22).multiplyScalar(0.2 + 0.8 * (day + dusk * 0.6));
    sun.position.copy(ld).multiplyScalar(90);
    U.uSunDir.value.copy(ld);
    U.uSunCol.value.copy(sun.color).multiplyScalar(1 / Math.PI);
    const sky = hemi.color.setRGB(0, 0, 0);
    sky.r = (C.sky.r * 0.5 + 0.25) * 1.12 * day + 1.25 * dusk + 0.1 * night;
    sky.g = (C.sky.g * 0.5 + 0.33) * 1.12 * day + 0.86 * dusk + 0.14 * night;
    sky.b = (C.sky.b * 0.5 + 0.5) * 1.12 * day + 0.98 * dusk + 0.34 * night;
    hemi.groundColor.copy(C.ground).multiplyScalar(0.8 * day + 0.5 * dusk + 0.16 * night);
    U.uAmb.value.copy(hemi.color).lerp(hemi.groundColor, 0.25).multiplyScalar(1 / Math.PI);
    // background (sRGB) and reflections (linear)
    const top = post.uniforms.uBgTop.value as THREE.Color, bot = post.uniforms.uBgBot.value as THREE.Color;
    top.setRGB(0, 0, 0); bot.setRGB(0, 0, 0);
    for (const [w, pair] of [[day, bgDay], [dusk, bgDusk], [night, bgNight]] as const) {
      top.r += pair[0].r * w; top.g += pair[0].g * w; top.b += pair[0].b * w;
      bot.r += pair[1].r * w; bot.g += pair[1].g * w; bot.b += pair[1].b * w;
    }
    U.uZenith.value.copy(top).multiplyScalar(0.9);
    U.uHorizon.value.copy(bot).multiplyScalar(1.05);
    srgb(top, top); srgb(bot, bot);
    (post.uniforms.uGlow.value as THREE.Color).setRGB(1.0, 0.72, 0.5).multiplyScalar(0.28 * dusk + 0.06 * day);
    post.uniforms.uStars.value = night;
    post.uniforms.uExposure.value = 1.0 + night * 0.45;
    (post.uniforms.uGrade.value as THREE.Color).setRGB(1 - night * 0.04, 1 - night * 0.02, 1 + night * 0.04);
    lightsOn = 1 - smooth(-0.07, 0.15, s);
    const nn = night + dusk * 0.5 > 0.55;
    if (nn !== isNight) { isNight = nn; document.documentElement.classList.toggle('night', nn); }
    U.uLights.value = lightsOn;
    // sun glow position on screen
    const p = glowV.copy(sunDir).multiplyScalar(500).add(camera.position).project(camera);
    post.uniforms.uGlowPos.value.set(Math.min(1.3, Math.max(-0.3, p.x * 0.5 + 0.5)), Math.min(1.1, Math.max(0.3, p.y * 0.5 + 0.5)));
  };

  // ------------------------------------------------------------------ colours per cell
  type RGB = [number, number, number];
  const rgb = (c: THREE.Color): RGB => [c.r, c.g, c.b];
  const P = {
    dirt: rgb(C.dirt), gLo: rgb(C.grassLo), gHi: rgb(C.grassHi), rock: rgb(C.rock1.clone().lerp(C.rock2, 0.5)),
    sand: rgb(C.sand), snow: rgb(C.snow), seabed: rgb(C.seabed), weed: rgb(C.weed),
  };
  const mix3 = (o: number[], b: RGB, t: number) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; };
  const cc = [0, 0, 0];
  const TC = iTop.array as Float32Array, CAP = iCap.array as Float32Array;
  const paintCells = () => {
    for (let k = 0; k < NN; k++) {
      const h = sim.h[k], q = qh[k];
      const n = sim.noise[k], hs = sim.hash[k];
      let cap = 0;
      if (q < SEA) {
        cc[0] = P.seabed[0]; cc[1] = P.seabed[1]; cc[2] = P.seabed[2];
        if (n > 0.55 && h < SEA - 0.8) mix3(cc, P.weed, smooth(0.55, 0.75, n) * 0.85);
        mix3(cc, P.sand, sim.sand[k] * 0.85);
        mix3(cc, P.rock, sim.rock[k] * 0.5);
        cap = 0.5;
      } else {
        cc[0] = P.dirt[0]; cc[1] = P.dirt[1]; cc[2] = P.dirt[2];
        const gt = smooth(0.5, 6, h) * 0.8 + (n - 0.5) * 0.5;
        const g0 = lerp(P.gLo[0], P.gHi[0], Math.max(0, Math.min(1, gt)));
        const g1 = lerp(P.gLo[1], P.gHi[1], Math.max(0, Math.min(1, gt)));
        const g2 = lerp(P.gLo[2], P.gHi[2], Math.max(0, Math.min(1, gt)));
        const g = sim.grass[k];
        cc[0] += (g0 - cc[0]) * g; cc[1] += (g1 - cc[1]) * g; cc[2] += (g2 - cc[2]) * g;
        mix3(cc, P.rock, sim.rock[k]);
        mix3(cc, P.sand, sim.sand[k]);
        if (sim.w[k] > 0.02 || sim.flow[k] > 0.03) { cc[0] *= 0.8; cc[1] *= 0.84; cc[2] *= 0.86; }
        mix3(cc, P.snow, Math.min(1, sim.snow[k]));
        cap = sim.snow[k] > 0.5 ? 0.32 : sim.sand[k] > 0.5 ? 0.5 : g > 0.5 ? 0.3 : 0;
      }
      const j = 0.93 + hs * 0.12;
      TC[k * 3] = cc[0] * j; TC[k * 3 + 1] = cc[1] * j; TC[k * 3 + 2] = cc[2] * (0.96 + hs * 0.08);
      CAP[k] = cap;
    }
    iTop.needsUpdate = true; iCap.needsUpdate = true;
  };

  // ------------------------------------------------------------------ fresh-water tiles list
  let wetCells: number[] = [];
  const listWet = () => {
    wetCells = [];
    for (let k = 0; k < NN; k++) if (qh[k] >= SEA && (sim.w[k] > 0.06 || sim.flow[k] > 0.035)) wetCells.push(k);
  };

  // ------------------------------------------------------------------ overlay sites
  type Site = { el: HTMLElement; pin: HTMLButtonElement; card: HTMLElement; pinned: boolean; open: boolean; timer: number; x: number; y: number; z: number; vis: boolean };
  const sites: Site[] = [];
  const closeAll = (except?: Site) => { for (const s of sites) if (s !== except) setOpen(s, false); };
  const setOpen = (s: Site, v: boolean) => {
    if (!v) s.pinned = false;
    s.open = v;
    s.el.classList.toggle('open', v);
    s.pin.setAttribute('aria-expanded', String(v));
  };
  const makeSite = (cls: string, label: string, html: string): Site => {
    const el = document.createElement('div');
    el.className = `site ${cls} hidden`;
    el.innerHTML = `<button class="pin" type="button" aria-expanded="false" aria-label="${esc(label)}"><span class="dot"></span><span class="tag">${esc(label.split(',')[0])}</span></button><div class="card">${html}</div>`;
    const s: Site = { el, pin: el.querySelector('.pin')!, card: el.querySelector('.card')!, pinned: false, open: false, timer: 0, x: 0, y: 0, z: 0, vis: false };
    el.style.transform = 'translate3d(-999px, -999px, 0)';
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { clearTimeout(s.timer); closeAll(s); setOpen(s, true); } });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !s.pinned) s.timer = window.setTimeout(() => setOpen(s, false), 260); });
    s.pin.addEventListener('click', () => {
      if (s.pinned) { setOpen(s, false); return; }
      closeAll(s); setOpen(s, true); s.pinned = true;
    });
    el.addEventListener('focusin', () => { clearTimeout(s.timer); closeAll(s); setOpen(s, true); });
    el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget as Node) && !s.pinned) setOpen(s, false); });
    ui.sites.appendChild(el);
    sites.push(s);
    return s;
  };
  const fresh_ = (s: Site) => { s.el.classList.add('fresh'); setTimeout(() => s.el.classList.remove('fresh'), 4200); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // ------------------------------------------------------------------ towns
  type House = { k: number; x: number; z: number; rot: number; s: number; roof: THREE.Color; wb: number; th: number; delay: number; grow: number; tower: number; dying: boolean };
  type Town = { place: Place; i: number; k: number; x: number; z: number; houses: House[]; pier: { x: number; z: number; a: number; len: number } | null; kind: string; t0: number; sinking: number; site: Site; flat: number; ht: number; day: number };
  const towns: Town[] = [];
  const ORDER: Place[] = [CAPITAL, ...TOWNS];
  const TOTAL = ORDER.length;
  const threshold = (i: number) => (i === 0 ? 0 : land0 + Math.round(NN * (0.017 * i + 0.0011 * i * i)));
  let clock = 0, lastFound = -10;
  const sound = new Sound();

  const avoidList = (skip?: Town) => {
    const a: { x: number; z: number; r: number }[] = [];
    for (const t of towns) if (t !== skip && t.k >= 0) a.push({ x: t.x, z: t.z, r: N < 60 ? 6.5 : 8 });
    if (keeper.k >= 0) a.push({ x: keeper.x, z: keeper.z, r: 4 });
    return a;
  };
  const kickText = (t: Town) => `${t.kind} · founded on day ${t.day}`;
  const settle = (t: Town, k: number) => {
    const N_ = N;
    t.k = k; t.x = sim.cx(k % N_); t.z = sim.cx((k / N_) | 0);
    t.t0 = clock; t.sinking = 0; t.flat = 1.4; t.ht = Math.max(SEA + 0.45, sim.h[k]);
    t.day = dayNum;
    const ci = k % N_, cj = (k / N_) | 0;
    const cand: { c: number; d: number }[] = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 1 || j < 1 || i >= N_ - 1 || j >= N_ - 1) continue;
      const d = Math.hypot(di, dj);
      if (d > 2.3) continue;
      cand.push({ c: j * N_ + i, d: d + rnd() * 0.7 });
    }
    cand.sort((a, b) => a.d - b.d);
    const want = t.i === 0 ? 7 : 3 + Math.floor(rnd() * 3);
    t.houses = [];
    for (const { c } of cand) {
      if (t.houses.length >= want) break;
      const hh = sim.h[c];
      if (hh < SEA + 0.25 || Math.abs(hh - sim.h[k]) > 0.95 || sim.reserved[c]) continue;
      sim.reserved[c] = 1;
      sim.tree[c] = 0;
      const first = t.houses.length === 0;
      t.houses.push({
        k: c, x: sim.cx(c % N_) + (first ? 0 : (rnd() - 0.5) * 0.24), z: sim.cx((c / N_) | 0) + (first ? 0 : (rnd() - 0.5) * 0.24),
        rot: (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.18, s: first ? 1.2 : 0.85 + rnd() * 0.3,
        roof: first && t.i === 0 ? roofs[0] : roofs[Math.floor(rnd() * roofs.length)], wb: 0.94 + rnd() * 0.08,
        th: 0.05 + rnd() * 0.55, delay: t.houses.length * 0.12, grow: 0, tower: first ? (t.i === 0 ? 2 : 1) : 0, dying: false,
      });
    }
    // a little pier if the sea is close
    t.pier = null;
    let best = 99, bdx = 0, bdz = 0;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N_ || j >= N_) continue;
      if (sim.h[j * N_ + i] < SEA - 0.4) { const d = Math.hypot(di, dj); if (d < best) { best = d; bdx = di; bdz = dj; } }
    }
    let river = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const c = k + dj * N_ + di; if (c >= 0 && c < NN) river = Math.max(river, sim.flow[c]); }
    if (best < 4.5) {
      const a = Math.atan2(bdz, bdx), ux = Math.cos(a), uz = Math.sin(a);
      let px = t.x, pz = t.z;
      for (let s = 0; s < 12; s++) {
        const c = sim.idxAt(px + ux * 0.5, pz + uz * 0.5);
        if (c < 0 || sim.h[c] < SEA) break;
        px += ux * 0.5; pz += uz * 0.5;
      }
      t.pier = { x: px + ux * 0.2, z: pz + uz * 0.2, a, len: 1.7 };
    }
    t.kind = t.i === 0 ? 'the capital' : t.pier ? 'harbour town' : river > 0.05 ? 'river town' : sim.h[k] > 3 ? 'hill village' : 'village';
    const kick = t.site.card.querySelector('.kick');
    if (kick) kick.textContent = kickText(t);
  };
  const foundTown = (i: number, k: number) => {
    const place = ORDER[i];
    const host = place.host;
    const site = makeSite('town', `${place.name}, settlement`, `<p class="kick"></p><h3>${esc(place.name)}</h3><p class="blurb">${esc(place.blurb)}</p><a href="${esc(place.url)}" target="_blank" rel="noopener">${esc(host)} <span aria-hidden="true">↗</span></a>`);
    const t: Town = { place, i, k: -1, x: 0, z: 0, houses: [], pier: null, kind: '', t0: clock, sinking: 0, site, flat: 0, ht: 0, day: dayNum };
    towns.push(t);
    settle(t, k);
    fresh_(site);
    lastFound = clock;
    sound.bell(i);
    updateProg();
  };
  const fallbackSite = () => {
    let best = 1e9, bk = -1;
    for (let k = 0; k < NN; k++) {
      const h = sim.h[k];
      if (h < SEA + 0.4 || h > 5 || sim.reserved[k]) continue;
      const s = sim.slope[k] + sim.dist[k] * 0.2;
      if (s < best) { best = s; bk = k; }
    }
    return bk;
  };

  // ------------------------------------------------------------------ boats (greetings)
  type Boat = { g: (typeof GREETS)[number]; x: number; z: number; head: number; spd: number; tx: number; tz: number; stuck: number; t0: number; site: Site; hull: THREE.Color; sail: THREE.Color };
  const boats: Boat[] = [];
  const BOAT_AT = [2, 4, 6, 8, 10];
  const depthAt = (x: number, z: number) => { const k = sim.idxAt(x, z); return k < 0 ? -1 : SEA - sim.h[k]; };
  const launchBoat = (from: Town) => {
    const g = GREETS[boats.length];
    let sx = from.x, sz = from.z, ok = false;
    for (let r = 1; r < 14 && !ok; r++) for (let a = 0; a < 16 && !ok; a++) {
      const x = from.x + Math.cos((a / 16) * 6.283) * r, z = from.z + Math.sin((a / 16) * 6.283) * r;
      if (Math.abs(x) < H - 1.5 && Math.abs(z) < H - 1.5 && depthAt(x, z) > 0.8) { sx = x; sz = z; ok = true; }
    }
    if (!ok) return false;
    const site = makeSite('boat', `${g.name}, a passing ship`, `<p class="kick">greetings to</p><h3>${esc(g.name)}</h3><a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.host)} <span aria-hidden="true">↗</span></a>`);
    boats.push({ g, x: sx, z: sz, head: rnd() * 6.28, spd: 0, tx: sx, tz: sz, stuck: 0, t0: clock, site, hull: rnd() < 0.5 ? C.wall : roofs[boats.length % roofs.length], sail: C.foam });
    fresh_(site);
    sound.bell(7 + boats.length, true);
    updateProg();
    return true;
  };
  const boatTarget = (b: Boat) => {
    for (let t = 0; t < 30; t++) {
      const a = rnd() * 6.283, r = 5 + rnd() * 16;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      if (Math.abs(x) > H - 1.5 || Math.abs(z) > H - 1.5) continue;
      if (depthAt(x, z) > 1.0) { b.tx = x; b.tz = z; return; }
    }
  };

  // ------------------------------------------------------------------ the lighthouse (contact)
  const keeper = { k: -1, x: 0, z: 0, t0: 0, site: null as Site | null, sinking: 0 };
  const buildKeeper = () => {
    const k = sim.findHeadland(avoidList());
    if (k < 0) return false;
    keeper.k = k; keeper.x = sim.cx(k % N); keeper.z = sim.cx((k / N) | 0); keeper.t0 = clock; keeper.sinking = 0;
    sim.reserved[k] = 2; sim.tree[k] = 0;
    if (!keeper.site) {
      const links = KEEPER.socials.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join('');
      keeper.site = makeSite('keeper', 'The lighthouse: contact Ben', `<p class="kick">the lighthouse keeper</p><h3>${esc(KEEPER.name)}</h3><p class="blurb">Signal any time.</p><a class="mail" href="mailto:${esc(KEEPER.email)}">${esc(KEEPER.email)}</a><p class="soc">${links}</p>`);
      fresh_(keeper.site);
      sound.horn();
    }
    updateProg();
    return true;
  };

  let complete = false;
  const updateProg = () => {
    const n = towns.length;
    if (complete) ui.prog.innerHTML = 'the archipelago is complete';
    else ui.prog.textContent = `${n} of ${TOTAL} settlements${keeper.k >= 0 ? ' · a lighthouse' : ''}${boats.length ? ` · ${boats.length} ship${boats.length > 1 ? 's' : ''}` : ''}`;
  };

  // ------------------------------------------------------------------ clouds & rain
  type Cloud = { x: number; z: number; y: number; r: number; puffs: number[]; moist: number; rain: boolean; fade: number; dark: number };
  const wdx = Math.cos(weather.windA), wdz = Math.sin(weather.windA);
  const snap = (v: number) => Math.round(v * 2) / 2;
  const clouds: Cloud[] = [];
  const spawnCloud = (c: Cloud | null, initial: boolean): Cloud => {
    const r = 1.7 + rnd() * 1.5;
    const puffs: number[] = [];
    // a little voxel dome: columns on a 0.7 grid, flat bottomed, lumpy on top
    const g = 0.6, ex = 1 + rnd() * 0.45, hm = 1.0 + rnd() * 1.0;
    const ox = rnd() * 9, oz = rnd() * 9;
    for (let zi = -r; zi <= r; zi += g) for (let xi = -r * ex; xi <= r * ex; xi += g) {
      const d = Math.hypot(xi / ex, zi) / r;
      const lump = sim.vnoise(xi * 0.6 + ox, zi * 0.6 + oz);
      if (d + (lump - 0.5) * 0.5 > 1) continue;
      const hh = Math.max(0.3, Math.round((Math.sqrt(Math.max(0, 1 - d * d)) * hm * (0.6 + lump * 0.8)) / 0.3) * 0.3);
      puffs.push(xi, hh / 2, zi, g, hh, g);
    }
    let x: number, z: number;
    const px = -wdz, pz = wdx;
    if (initial) {
      x = 0; z = 0;
      for (let t = 0; t < 40; t++) {
        x = (rnd() - 0.5) * N * 0.95; z = (rnd() - 0.5) * N * 0.95;
        let clear = true;
        for (let a = 0; a < 8 && clear; a++) { const k = sim.idxAt(x + Math.cos(a) * (r + 3), z + Math.sin(a) * (r + 3)); if (k >= 0 && sim.h[k] > -0.5) clear = false; }
        const k0 = sim.idxAt(x, z);
        if (clear && (k0 < 0 || sim.h[k0] < -0.5)) break;
      }
    }
    else {
      let lat = (rnd() - 0.5) * N * 0.8, bh = -1;
      for (let t = 0; t < 10; t++) { const k = (rnd() * NN) | 0; if (sim.h[k] > bh) { bh = sim.h[k]; lat = sim.cx(k % N) * px + sim.cx((k / N) | 0) * pz; } }
      if (bh > 1) lat += (rnd() - 0.5) * 6;
      const back = H + r + 4;
      x = -wdx * back + px * lat; z = -wdz * back + pz * lat;
    }
    const o = c ?? ({} as Cloud);
    Object.assign(o, { x, z, y: 11.5 + rnd() * 1.6, r, puffs, moist: initial ? 0.05 : 0.5 + rnd() * 0.5, rain: false, fade: initial ? 1 : 0, dark: 0 });
    return o;
  };
  for (let i = 0; i < weather.clouds; i++) clouds.push(spawnCloud(null, true));
  const drops = { x: new Float32Array(900), y: new Float32Array(900), z: new Float32Array(900), v: new Float32Array(900), n: 0 };
  const spl = { x: new Float32Array(500), y: new Float32Array(500), z: new Float32Array(500), vx: new Float32Array(500), vy: new Float32Array(500), vz: new Float32Array(500), n: 0 };
  let ripI = 0;
  const ripple = (x: number, z: number, amp: number) => { U.uRip.value[ripI].set(x, z, U.uTime.value, amp); ripI = (ripI + 1) % 8; };
  const splash = (x: number, z: number, R: number, n: number, up = 1) => {
    for (let i = 0; i < n && spl.n < 500; i++) {
      const a = rnd() * 6.283, r = R * (0.25 + rnd() * 0.8);
      const j = spl.n++;
      spl.x[j] = x + Math.cos(a) * r; spl.z[j] = z + Math.sin(a) * r; spl.y[j] = SEA + 0.05;
      spl.vx[j] = Math.cos(a) * (0.8 + rnd() * 1.8); spl.vz[j] = Math.sin(a) * (0.8 + rnd() * 1.8); spl.vy[j] = (3 + rnd() * 4.5) * up;
    }
  };

  // ------------------------------------------------------------------ input
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const rayAt = (cx: number, cy: number) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  };
  const hitTerrain = (ray: THREE.Ray) => {
    const o = ray.origin, d = ray.direction;
    let t0 = 0, t1 = 1e4;
    const lo = [-H, FLOOR, -H], hi = [H, MAXH + 1, H], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) return null; continue; }
      let ta = (lo[a] - oo[a]) / dd[a], tb = (hi[a] - oo[a]) / dd[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return null;
    const below = (t: number) => {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      const k = sim.idxAt(x, z);
      if (k < 0) return false;
      return y <= Math.max(dh[k], SEA);
    };
    const st = 0.15;
    for (let t = t0; t <= t1; t += st) {
      if (below(t)) {
        let a = t - st, b = t;
        for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
    }
    return null;
  };
  const planeHit = (ray: THREE.Ray, y: number) => {
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return new THREE.Vector3(ray.origin.x + ray.direction.x * t, y, ray.origin.z + ray.direction.z * t);
  };

  const BR = coarse ? 3.9 : 3.3;
  const brush = { x: 0, z: 0, y0: 0, on: false, mode: 0, s: 0, vis: 0, hover: false, startT: 0 };
  const ptrs = new Map<number, { x: number; y: number; type: string }>();
  let gesture: 'none' | 'sculpt' | 'orbit' | 'wait' = 'none';
  let lastX = 0, lastY = 0;
  let interacted = false;
  const firstTouch = () => { if (!interacted) { interacted = true; ui.hint.classList.add('gone'); } };
  const mid = () => { let x = 0, y = 0; for (const p of ptrs.values()) { x += p.x; y += p.y; } return [x / ptrs.size, y / ptrs.size]; };
  const moveBrush = (cx: number, cy: number) => {
    const p = planeHit(rayAt(cx, cy), brush.y0);
    if (p) { brush.x = Math.max(-H, Math.min(H, p.x)); brush.z = Math.max(-H, Math.min(H, p.z)); }
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (ui.isOpen()) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    closeAll();
    kb.active = false;
    if (ptrs.size === 2 && gesture !== 'orbit') {
      const [mx, my] = mid();
      const hit = hitTerrain(rayAt(mx, my));
      if (hit) { brush.y0 = hit.y; brush.x = hit.x; brush.z = hit.z; brush.mode = -1; brush.on = true; brush.startT = clock - 1; gesture = 'sculpt'; firstTouch(); }
      return;
    }
    if (ptrs.size > 2) return;
    lastX = e.clientX; lastY = e.clientY;
    const hit = hitTerrain(rayAt(e.clientX, e.clientY));
    if (hit) {
      gesture = 'sculpt';
      brush.y0 = Math.max(SEA, hit.y); brush.x = hit.x; brush.z = hit.z;
      brush.mode = e.button === 2 || e.shiftKey || e.altKey || e.ctrlKey ? -1 : 1;
      brush.on = true; brush.s = 0;
      brush.startT = e.pointerType === 'touch' ? clock + 0.09 : clock;
      if (sim.h[sim.idxAt(hit.x, hit.z)] < SEA + 0.3) ripple(hit.x, hit.z, 0.6);
      firstTouch();
      sound.update(0, 0, 0);
    } else gesture = 'orbit';
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (gesture === 'sculpt') {
      if (ptrs.size >= 2) { const [mx, my] = mid(); moveBrush(mx, my); } else moveBrush(e.clientX, e.clientY);
    } else if (gesture === 'orbit' && p) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      az -= dx * 0.0055; el = Math.max(0.34, Math.min(1.08, el + dy * 0.0035));
      azV = -dx * 0.0055 * 60;
      firstTouch();
    } else if (gesture === 'none' && e.pointerType === 'mouse' && !ui.isOpen()) {
      const hit = hitTerrain(rayAt(e.clientX, e.clientY));
      brush.hover = !!hit;
      if (hit) { brush.x = hit.x; brush.z = hit.z; brush.mode = e.shiftKey ? -1 : 1; }
    }
  });
  const end = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0) { gesture = 'none'; brush.on = false; }
    else if (gesture === 'sculpt') { gesture = 'wait'; brush.on = false; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && gesture === 'none') brush.hover = false; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.42, Math.min(1.3, zoom * Math.exp(e.deltaY * 0.0011))); }, { passive: false });

  // keyboard: arrows move a cursor, space raises, shift+space / x lowers, q/e turn, [ ] scrub time
  const kb = { active: false, x: 0, z: 0, keys: new Set<string>() };
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A');
  };
  addEventListener('keydown', (e) => {
    if (ui.isOpen() || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === '[' || k === ']') { tday = (tday + (k === ']' ? 0.02 : -0.98)) % 1; return; }
    if (typing(e)) return;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ', 'x', 'q', 'e'].includes(k)) {
      e.preventDefault();
      if (!kb.active) { kb.active = true; if (towns[0]) { kb.x = towns[0].x + 3; kb.z = towns[0].z + 3; } }
      kb.keys.add(k === ' ' && e.shiftKey ? 'x' : k);
      firstTouch();
    }
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); kb.keys.delete(k); if (k === ' ') kb.keys.delete('x'); if (k === 'shift') kb.keys.delete('x'); });
  addEventListener('blur', () => { kb.keys.clear(); ptrs.clear(); gesture = 'none'; brush.on = false; });

  // ------------------------------------------------------------------ UI controls
  ui.sound.addEventListener('click', () => {
    if (sound.on) sound.stop(); else sound.start();
    ui.sound.textContent = sound.on ? 'sound on' : 'sound';
    ui.sound.setAttribute('aria-pressed', String(sound.on));
  });
  let scrubbing = false;
  ui.time.addEventListener('input', () => { tday = parseInt(ui.time.value, 10) / 1000; scrubbing = true; });
  ui.time.addEventListener('change', () => { scrubbing = false; });
  const setCycleLabel = () => { ui.cycle.textContent = cycling ? 'day' : 'still'; ui.cycle.setAttribute('aria-pressed', String(cycling)); ui.cycle.title = cycling ? 'Pause the day' : 'Let the day run'; };
  ui.cycle.addEventListener('click', () => { cycling = !cycling; setCycleLabel(); });
  setCycleLabel();
  setTimeout(() => { if (!interacted) ui.hint.classList.add('show'); }, 1400);

  // ------------------------------------------------------------------ the first town
  sim.computeDist(); sim.computeSlope();
  {
    let k = sim.findSite([]);
    if (k < 0) k = fallbackSite();
    if (k >= 0) foundTown(0, k);
  }
  paintCells();
  listWet();
  applyTime();

  // ------------------------------------------------------------------ main update
  let tickAcc = 0, unlockAcc = 0, fps = 60, slowFor = 0;
  let rainLoad = 0;
  const sout = { up: 0, down: 0, wet: 0 };
  const V3 = new THREE.Vector3();
  const tcol = new THREE.Color();

  const update = (dt: number) => {
    clock += dt;
    U.uTime.value += dt * (reduced ? 0.35 : 1);
    if (!reduced && intro < 1) intro = Math.min(1, intro + dt / 2.6);

    // day
    if (cycling && !scrubbing) {
      const s = sunDir.y;
      const prev = tday;
      tday = (tday + (dt / 210) * (s < -0.1 ? 2.4 : 1)) % 1;
      if (tday < prev) dayNum++;
    }

    // camera inertia
    if (gesture !== 'orbit') { az += (azV * dt); azV *= Math.exp(-dt * 4); }
    if (kb.keys.has('q')) az += dt * 1.2;
    if (kb.keys.has('e')) az -= dt * 1.2;
    placeCamera();

    // keyboard cursor
    if (kb.active) {
      const fx = -Math.sin(az), fz = -Math.cos(az), rx = Math.cos(az), rz = -Math.sin(az);
      let mx = 0, mz = 0;
      if (kb.keys.has('arrowup') || kb.keys.has('w')) { mx += fx; mz += fz; }
      if (kb.keys.has('arrowdown') || kb.keys.has('s')) { mx -= fx; mz -= fz; }
      if (kb.keys.has('arrowright') || kb.keys.has('d')) { mx += rx; mz += rz; }
      if (kb.keys.has('arrowleft') || kb.keys.has('a')) { mx -= rx; mz -= rz; }
      kb.x = Math.max(-H + 1, Math.min(H - 1, kb.x + mx * dt * 11));
      kb.z = Math.max(-H + 1, Math.min(H - 1, kb.z + mz * dt * 11));
    }

    // sculpt
    let digging = 0;
    const kbDig = kb.active && (kb.keys.has(' ') || kb.keys.has('x'));
    if ((brush.on && clock >= brush.startT) || kbDig) {
      if (kbDig) { brush.x = kb.x; brush.z = kb.z; brush.mode = kb.keys.has('x') ? -1 : 1; }
      brush.s += (1 - brush.s) * Math.min(1, dt * 10);
      const rate = brush.mode > 0 ? 6.6 : 7.4;
      sout.up = 0; sout.down = 0; sout.wet = 0;
      sim.sculpt(brush.x, brush.z, BR, brush.mode * rate * dt * brush.s, sout);
      digging = brush.mode * brush.s;
      // splashes where land meets water
      const wet = sout.wet;
      if (wet > 0.5) {
        const n = Math.min(14, Math.round(wet * dt * (reduced ? 6 : 26) + rnd()));
        splash(brush.x, brush.z, BR * 0.9, n);
        if (rnd() < dt * 6) ripple(brush.x + (rnd() - 0.5) * 2, brush.z + (rnd() - 0.5) * 2, 0.45 + rnd() * 0.4);
      }
      if (sout.up > 0 || sout.down > 0) {
        splash(brush.x, brush.z, BR, (sout.up + sout.down) * (reduced ? 1 : 4));
        ripple(brush.x, brush.z, Math.min(1.3, 0.5 + (sout.up + sout.down) * 0.15));
        sound.splash(sout.up + sout.down);
      }
    }
    brush.vis += ((brush.on || brush.hover || kb.active ? 1 : 0) - brush.vis) * Math.min(1, dt * 10);
    U.uBrush.value.set(brush.x, brush.z, BR, brush.vis * (brush.mode < 0 ? -1 : 1) * (brush.on || kbDig ? 1 : 0.55));

    // the sea breathes: now and then a fish rises somewhere calm
    if (!reduced && rnd() < dt * 0.35) {
      const x = (rnd() - 0.5) * (N - 6), z = (rnd() - 0.5) * (N - 6);
      if (depthAt(x, z) > 1.2) ripple(x, z, 0.25 + rnd() * 0.2);
    }

    // physics
    sim.thermal(dt);
    sim.water(dt * 0.5);
    sim.water(dt * 0.5);

    // clouds and rain
    rainLoad = 0;
    for (let ci = 0; ci < clouds.length; ci++) {
      const c = clouds[ci];
      const spd = weather.wind * (reduced ? 0.4 : 1);
      c.x += wdx * spd * dt; c.z += wdz * spd * dt;
      const ext = Math.max(Math.abs(c.x), Math.abs(c.z));
      c.fade = Math.min(c.fade + dt * 0.5, smooth(H + c.r + 4, H - 1, ext));
      if (ext > H + c.r + 5 && c.x * wdx + c.z * wdz > 0) { spawnCloud(c, false); continue; }
      let sum = 0, mx = -9, cnt = 0;
      for (let s = 0; s < 5; s++) {
        const ox = s === 0 ? 0 : Math.cos(s * 1.57) * c.r * 0.6, oz = s === 0 ? 0 : Math.sin(s * 1.57) * c.r * 0.6;
        const k = sim.idxAt(c.x + ox, c.z + oz);
        if (k < 0) continue;
        sum += sim.h[k]; mx = Math.max(mx, sim.h[k]); cnt++;
      }
      const mean = cnt ? sum / cnt : -3;
      c.y += (Math.max(11.5, mx + 2.6) - c.y) * Math.min(1, dt * 0.6);
      if (!c.rain && mean > 1.4 && c.moist > 0.22 && c.fade > 0.6) c.rain = true;
      if (c.rain && (mean < 0.5 || c.moist < 0.04)) c.rain = false;
      if (c.rain) {
        c.moist -= dt * 0.028;
        sim.rain(c.x, c.z, c.r * 0.9, 0.12 * weather.rain * dt);
        rainLoad += 1;
        const nd = Math.round(dt * (reduced ? 18 : 48) + rnd());
        for (let i = 0; i < nd && drops.n < 900; i++) {
          const a = rnd() * 6.283, r = Math.sqrt(rnd()) * c.r * 0.85, j = drops.n++;
          drops.x[j] = c.x + Math.cos(a) * r; drops.z[j] = c.z + Math.sin(a) * r; drops.y[j] = c.y - 0.3 - rnd() * 1.5; drops.v[j] = 14 + rnd() * 5;
        }
      } else if (mean < 0) c.moist = Math.min(1, c.moist + dt * 0.02);
      c.dark += ((c.rain ? 1 : 0) - c.dark) * Math.min(1, dt * 0.8);
    }

    // biomes / slow world
    tickAcc += dt;
    if (tickAcc >= 0.1) {
      sim.biomes(tickAcc);
      tickAcc = 0;
      paintCells();
      listWet();
    }

    // display heights: springy columns
    const K = 320, D = reduced ? 2 * Math.sqrt(K) : 23;
    let moved = false;
    for (let k = 0; k < NN; k++) {
      const h = sim.h[k];
      let q = qh[k];
      if (h < q - 0.31 || h > q + 0.31) { q = qh[k] = Math.max(FLOOR + 0.75, quant(h)); }
      let x = dh[k], v = dv[k];
      if (x === q && v === 0) continue;
      v += ((q - x) * K - v * D) * dt;
      x += v * dt;
      if (Math.abs(q - x) < 0.003 && Math.abs(v) < 0.02) { x = q; v = 0; }
      dh[k] = x; dv[k] = v;
      TM[k * 16 + 5] = x - FLOOR;
      moved = true;
    }
    if (moved) { terrain.instanceMatrix.needsUpdate = true; heightTex.needsUpdate = true; }

    // unlocks: towns, ships, the lighthouse
    unlockAcc += dt;
    if (unlockAcc > 0.4) {
      unlockAcc = 0;
      // towns that lost their ground move on
      for (const t of towns) {
        if (t.k < 0) {
          const k = sim.findSite(avoidList(t));
          if (k >= 0) { settle(t, k); fresh_(t.site); sound.bell(t.i, true); }
          continue;
        }
        let alive = 0;
        for (const hs of t.houses) {
          if (!hs.dying && sim.h[hs.k] < SEA + 0.05) { hs.dying = true; sim.reserved[hs.k] = 0; }
          if (!hs.dying) alive++;
        }
        if (sim.h[t.k] < SEA + 0.12 || alive === 0) t.sinking += 0.4; else t.sinking = 0;
        if (t.sinking > 0.8) {
          for (const hs of t.houses) { hs.dying = true; sim.reserved[hs.k] = 0; }
          t.k = -1;
        }
      }
      if (keeper.k >= 0 && sim.h[keeper.k] < SEA + 0.1) { keeper.sinking += 0.4; if (keeper.sinking > 0.8) { sim.reserved[keeper.k] = 0; keeper.k = -1; } }
      else keeper.sinking = 0;
      if (keeper.site && keeper.k < 0) buildKeeper();
      const nt = towns.length;
      if (nt < TOTAL && sim.land >= threshold(nt) && clock - lastFound > 1.3) {
        const k = sim.findSite(avoidList());
        if (k >= 0) foundTown(nt, k);
      }
      if (boats.length < BOAT_AT.length && towns.length >= BOAT_AT[boats.length] && clock - lastFound > 0.6) {
        const from = towns[towns.length - 1];
        if (from.k >= 0) launchBoat(from);
      }
      if (!keeper.site && towns.length >= 5 && clock - lastFound > 0.6) buildKeeper();
      if (!complete && towns.length === TOTAL && boats.length === GREETS.length && keeper.k >= 0) {
        complete = true;
        lanterns = clock;
        sound.fanfare();
        updateProg();
        ui.credits.classList.add('show');
        setTimeout(() => ui.credits.classList.remove('show'), 9000);
      }
    }

    // towns: flatten plots for a moment after founding
    for (const t of towns) {
      if (t.k >= 0 && t.flat > 0) { sim.flatten(t.x, t.z, 2.2, t.ht, Math.min(1, dt * 2.5)); t.flat -= dt; }
      for (const hs of t.houses) hs.grow = hs.dying ? Math.max(0, hs.grow - dt * 2.5) : Math.min(1, hs.grow + dt * 1.6 * (clock - t.t0 > hs.delay ? 1 : 0));
      t.houses = t.houses.filter((hs) => !hs.dying || hs.grow > 0);
    }

    // boats
    for (const b of boats) {
      const dx = b.tx - b.x, dz = b.tz - b.z;
      if (Math.hypot(dx, dz) < 1.5 || b.stuck > 2.5) { boatTarget(b); b.stuck = 0; }
      const want = Math.atan2(b.tz - b.z, b.tx - b.x);
      let da = want - b.head;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      b.head += Math.max(-1, Math.min(1, da)) * dt * 0.9;
      const ax = b.x + Math.cos(b.head) * 1.4, az2 = b.z + Math.sin(b.head) * 1.4;
      const ahead = depthAt(ax, az2);
      if (ahead < 0.6) { b.head += dt * 1.8; b.spd *= 1 - dt * 2; b.stuck += dt; }
      else b.spd += (1.05 - b.spd) * dt * 0.6;
      if (depthAt(b.x, b.z) < 0.25) {
        // land rose under the boat: glide to the nearest deep water
        let found = false;
        for (let r = 1; r < 9 && !found; r++) for (let a = 0; a < 16; a++) {
          const x = b.x + Math.cos(a * 0.393) * r, z = b.z + Math.sin(a * 0.393) * r;
          if (Math.abs(x) < H - 1 && Math.abs(z) < H - 1 && depthAt(x, z) > 0.6) { b.x += (x - b.x) * Math.min(1, dt * 3); b.z += (z - b.z) * Math.min(1, dt * 3); found = true; break; }
        }
        b.stuck += dt;
      } else {
        b.x += Math.cos(b.head) * b.spd * dt * (reduced ? 0.5 : 1);
        b.z += Math.sin(b.head) * b.spd * dt * (reduced ? 0.5 : 1);
      }
      b.x = Math.max(-H + 1, Math.min(H - 1, b.x)); b.z = Math.max(-H + 1, Math.min(H - 1, b.z));
    }

    // adaptive resolution
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    if (fps < 34 && dprScale > 0.6 && clock > 4) { slowFor += dt; if (slowFor > 2) { dprScale *= 0.85; resize(); slowFor = 0; } } else slowFor = 0;

    sound.update(digging, brush.y0, rainLoad);
    applyTime();
  };

  let lanterns = -1;

  // ------------------------------------------------------------------ build per-frame instances
  const cloudGrey = new THREE.Color(0.6, 0.64, 0.72);
  const draw = (dt: number) => {
    const t = U.uTime.value;
    // trees
    const tn = [0, 0, 0];
    const TA = trees.map((m) => m.instanceMatrix.array as Float32Array);
    const TCo = trees.map((m) => m.instanceColor!.array as Float32Array);
    for (let k = 0; k < NN; k++) {
      const v = sim.tree[k];
      if (v <= 0) continue;
      const kind = sim.treeKind[k];
      const m = trees[kind];
      const i = tn[kind];
      if (i >= m.instanceMatrix.count) continue;
      tn[kind]++;
      const J = sim.treeJ;
      const s = easeBack(v) * J[k * 4 + 2] * (kind === 2 ? 1.25 : 1) * (N < 60 ? 1.1 : 1);
      const rot = Math.round(J[k * 4 + 3] / 1.5708) * 1.5708 + (J[k * 4 + 3] - 3.14) * 0.05;
      const sway = reduced ? 0 : Math.sin(t * 1.3 + k) * 0.015 * v;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const A = TA[kind], o = i * 16;
      A[o] = cs * s; A[o + 1] = 0; A[o + 2] = -sn * s; A[o + 3] = 0;
      A[o + 4] = sway * s; A[o + 5] = s; A[o + 6] = 0; A[o + 7] = 0;
      A[o + 8] = sn * s; A[o + 9] = 0; A[o + 10] = cs * s; A[o + 11] = 0;
      A[o + 12] = sim.cx(k % N) + J[k * 4]; A[o + 13] = dh[k]; A[o + 14] = sim.cx((k / N) | 0) + J[k * 4 + 1]; A[o + 15] = 1;
      const hs = sim.hash[k];
      const sn2 = Math.min(1, sim.snow[k] * 0.8);
      const b = 0.88 + hs * 0.22;
      const Cc = TCo[kind];
      Cc[i * 3] = lerp(b * (0.96 + hs * 0.1), 1.6, sn2); Cc[i * 3 + 1] = lerp(b, 1.6, sn2); Cc[i * 3 + 2] = lerp(b * 0.94, 1.7, sn2);
    }
    trees.forEach((m, i) => { m.count = tn[i]; m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true; });

    // houses + glows
    gN = 0;
    let hn = 0;
    const WA = walls.instanceMatrix.array as Float32Array, RA = roofsMesh.instanceMatrix.array as Float32Array;
    const WC = walls.instanceColor!.array as Float32Array, RC = roofsMesh.instanceColor!.array as Float32Array;
    const IL = iLight.array as Float32Array;
    const TLs = U.uTL.value;
    for (let i = 0; i < 12; i++) TLs[i].w = 0;
    towns.forEach((tw, ti) => {
      let lx = 0, ly = 0, lz = 0, ln = 0;
      for (const hs of tw.houses) {
        if (hn >= HCAP || hs.grow <= 0) continue;
        const g = easeBack(hs.grow);
        const y = dh[hs.k];
        const sx = hs.s * g * (hs.tower === 2 ? 0.62 : hs.tower ? 1.05 : 1);
        const sy = hs.s * g * (hs.tower === 2 ? 3.0 : hs.tower ? 1.25 : 1);
        const sz = hs.s * g * (hs.tower === 2 ? 0.75 : hs.tower ? 1.05 : 1);
        const cs = Math.cos(hs.rot), sn = Math.sin(hs.rot);
        const sr = hs.tower === 2 ? sx * 1.7 : sx;
        const put = (A: Float32Array, yy: number, ys: number) => {
          const o = hn * 16;
          A[o] = cs * sx; A[o + 1] = 0; A[o + 2] = -sn * sx; A[o + 3] = 0;
          A[o + 4] = 0; A[o + 5] = ys; A[o + 6] = 0; A[o + 7] = 0;
          A[o + 8] = sn * sz; A[o + 9] = 0; A[o + 10] = cs * sz; A[o + 11] = 0;
          A[o + 12] = hs.x; A[o + 13] = yy; A[o + 14] = hs.z; A[o + 15] = 1;
        };
        put(WA, y, sy);
        put(RA, y + 0.312 * (sy - sr), sr);
        WC[hn * 3] = C.wall.r * hs.wb; WC[hn * 3 + 1] = C.wall.g * hs.wb; WC[hn * 3 + 2] = C.wall.b * hs.wb;
        RC[hn * 3] = hs.roof.r; RC[hn * 3 + 1] = hs.roof.g; RC[hn * 3 + 2] = hs.roof.b;
        IL[hn] = hs.th;
        glow(hs.x, y + 0.18 * sy, hs.z, 1.1, hs.th, 1.0, 0.62, 0.3);
        lx += hs.x; ly += y; lz += hs.z; ln++;
        hn++;
      }
      if (ln && ti < 11) TLs[ti].set(lx / ln, ly / ln + 0.3, lz / ln, Math.min(1, ln / 3));
      if (tw.pier && tw.k >= 0) {
        const p = tw.pier, ux = Math.cos(p.a), uz = Math.sin(p.a);
        const g = smooth(0, 1, (clock - tw.t0) * 1.2);
        const L = p.len * g;
        props.add(p.x + ux * L * 0.5, SEA + 0.17, p.z + uz * L * 0.5, L, 0.06, 0.22, -p.a, C.trunk, 1.15);
        for (let s = 0.4; s < L; s += 0.6) props.add(p.x + ux * s, SEA - 0.15, p.z + uz * s, 0.05, 0.6, 0.05, 0, C.trunk, 0.8);
        glow(p.x + ux * L, SEA + 0.4, p.z + uz * L, 0.7, 0.3, 1.0, 0.7, 0.4);
      }
    });
    walls.count = roofsMesh.count = hn;
    walls.instanceMatrix.needsUpdate = roofsMesh.instanceMatrix.needsUpdate = true;
    walls.instanceColor!.needsUpdate = roofsMesh.instanceColor!.needsUpdate = true;
    iLight.needsUpdate = true;

    // lighthouse
    beam.visible = false;
    if (keeper.k >= 0) {
      const g = easeBack(Math.min(1, (clock - keeper.t0) * 0.8));
      const y = dh[keeper.k];
      const x = keeper.x, z = keeper.z;
      const red = roofs[0];
      props.add(x, y + 0.12 * g, z, 0.62 * g, 0.24 * g, 0.62 * g, 0, C.rock2, 1.05);
      for (let s = 0; s < 4; s++) props.add(x, y + (0.24 + 0.22 * s + 0.11) * g, z, (0.4 - s * 0.03) * g, 0.22 * g, (0.4 - s * 0.03) * g, 0, s % 2 ? red : C.wall);
      props.add(x, y + 1.24 * g, z, 0.26 * g, 0.18 * g, 0.26 * g, 0, C.foam, 1.4);
      props.add(x, y + 1.38 * g, z, 0.34 * g, 0.08 * g, 0.34 * g, 0, C.plinth);
      glow(x, y + 1.24 * g, z, 2.4, 0.0, 1.0, 0.85, 0.55);
      if (lightsOn > 0.02 && g > 0.9) {
        beam.visible = true;
        beam.position.set(x, y + 1.24, z);
        beam.rotation.y = reduced ? 0.6 : t * 0.7;
      }
      TLs[11].set(x, y + 1.2, z, 0.7);
    }

    // boats
    const BA = U.uBoats.value;
    for (let i = 0; i < 6; i++) BA[i].w = 0;
    boats.forEach((b, i) => {
      const g = easeBack(Math.min(1, (clock - b.t0) * 0.9));
      const y = SEA + SH.swellJS(b.x, b.z, t) * U.uSwell.value + 0.02;
      const r = -b.head;
      const ux = Math.cos(b.head), uz = Math.sin(b.head);
      props.add(b.x, y + 0.06 * g, b.z, 0.62 * g, 0.14 * g, 0.24 * g, r, b.hull);
      props.add(b.x - ux * 0.25, y + 0.16 * g, b.z - uz * 0.25, 0.12 * g, 0.1 * g, 0.18 * g, r, C.trunk, 1.1);
      props.add(b.x + ux * 0.04, y + 0.42 * g, b.z + uz * 0.04, 0.03 * g, 0.62 * g, 0.03 * g, r, C.trunk, 0.8);
      props.add(b.x + ux * 0.04 - ux * 0.14, y + 0.46 * g, b.z + uz * 0.04 - uz * 0.14, 0.26 * g, 0.4 * g, 0.02 * g, r, b.sail, 1.05);
      props.add(b.x + ux * 0.04, y + 0.76 * g, b.z + uz * 0.04, 0.1 * g, 0.05 * g, 0.012 * g, r, roofs[(i + 1) % roofs.length]);
      glow(b.x - ux * 0.3, y + 0.25, b.z - uz * 0.3, 0.55, 0.2, 1.0, 0.75, 0.45);
      BA[i].set(b.x, b.z, b.head, b.spd);
    });

    // splash droplets
    for (let j = 0; j < spl.n; j++) {
      spl.vy[j] -= 22 * dt;
      spl.x[j] += spl.vx[j] * dt; spl.y[j] += spl.vy[j] * dt; spl.z[j] += spl.vz[j] * dt;
      if (spl.y[j] < SEA - 0.1 && spl.vy[j] < 0) {
        const last = --spl.n;
        spl.x[j] = spl.x[last]; spl.y[j] = spl.y[last]; spl.z[j] = spl.z[last];
        spl.vx[j] = spl.vx[last]; spl.vy[j] = spl.vy[last]; spl.vz[j] = spl.vz[last];
        j--;
        continue;
      }
      const s = 0.1 + Math.min(0.05, spl.vy[j] * 0.01);
      props.add(spl.x[j], spl.y[j], spl.z[j], s, s, s, 0, C.foam, 1.3);
    }
    props.commit();

    // rain
    const RAM = rainMesh.instanceMatrix.array as Float32Array;
    let rn = 0;
    for (let j = 0; j < drops.n; j++) {
      drops.y[j] -= drops.v[j] * dt;
      const k = sim.idxAt(drops.x[j], drops.z[j]);
      const ground = k < 0 ? FLOOR : Math.max(SEA, dh[k]);
      if (drops.y[j] < ground) {
        const last = --drops.n;
        drops.x[j] = drops.x[last]; drops.y[j] = drops.y[last]; drops.z[j] = drops.z[last]; drops.v[j] = drops.v[last];
        j--;
        continue;
      }
      const o = rn * 16;
      RAM[o] = 1; RAM[o + 5] = 1; RAM[o + 10] = 1; RAM[o + 15] = 1;
      RAM[o + 12] = drops.x[j]; RAM[o + 13] = drops.y[j]; RAM[o + 14] = drops.z[j];
      rn++;
    }
    rainMesh.count = rn;
    rainMesh.instanceMatrix.needsUpdate = true;

    // clouds
    const CL = U.uClouds.value;
    clouds.forEach((c, i) => {
      const f = c.fade;
      const shade = tcol.setRGB(1, 1, 1).lerp(cloudGrey, c.dark);
      for (let p = 0; p < c.puffs.length; p += 6) {
        const P6 = c.puffs;
        const bob = reduced ? 0 : Math.sin(t * 0.6 + i * 2 + P6[p] * 0.7 + P6[p + 2]) * 0.05;
        cloudBoxes.add(c.x + P6[p] * f, c.y + P6[p + 1] * f + bob, c.z + P6[p + 2] * f, P6[p + 3] * f, P6[p + 4] * f, P6[p + 5] * f, 0, shade, 1);
      }
      if (i < 8) CL[i].set(c.x, c.z, c.r * 1.1 * f, (0.32 + 0.2 * c.dark) * f * sunUp);
    });
    for (let i = clouds.length; i < 8; i++) CL[i].z = 0;
    cloudBoxes.commit();

    // completion lanterns
    if (lanterns > 0) {
      const age = clock - lanterns;
      if (age < 14) {
        towns.forEach((tw, i) => {
          for (let l = 0; l < 3; l++) {
            const a = age - l * 0.7 - i * 0.15;
            if (a < 0) continue;
            glow(tw.x + Math.sin(a * 0.8 + l * 2 + i) * 0.6, dh[Math.max(0, tw.k)] + 0.5 + a * 0.9, tw.z + Math.cos(a * 0.7 + l) * 0.6, 0.9, -1, 1.0 * Math.max(0, 1 - a / 13), 0.6 * Math.max(0, 1 - a / 13), 0.25 * Math.max(0, 1 - a / 13));
          }
        });
      }
    }

    // fresh water tiles
    const FA = fresh.instanceMatrix.array as Float32Array, FF = aFlow.array as Float32Array;
    let fn = 0;
    for (const k of wetCells) {
      const w = sim.w[k], fl = sim.flow[k];
      const i = k % N, j = (k / N) | 0;
      const y = dh[k] + 0.03 + Math.min(0.3, w * 1.4);
      const o = fn * 16;
      FA[o] = 1; FA[o + 5] = 1; FA[o + 10] = 1; FA[o + 15] = 1;
      FA[o + 12] = sim.cx(i); FA[o + 13] = y; FA[o + 14] = sim.cx(j);
      const fx = sim.fdx[k], fz = sim.fdz[k];
      let drop = 0;
      const ni = i + Math.sign(fx), nj = j + Math.sign(fz);
      if (Math.abs(fx) > Math.abs(fz)) { if (ni >= 0 && ni < N) drop = dh[k] - dh[j * N + ni]; }
      else if (nj >= 0 && nj < N) drop = dh[k] - dh[nj * N + i];
      FF[fn * 4] = fx; FF[fn * 4 + 1] = fz; FF[fn * 4 + 2] = smooth(0.3, 0.6, drop) * Math.min(0.75, fl * 6) + Math.min(0.25, fl * 0.5); FF[fn * 4 + 3] = Math.min(0.6, w * 2 + fl * 0.25);
      fn++;
    }
    fresh.count = fn;
    fresh.instanceMatrix.needsUpdate = true;
    aFlow.needsUpdate = true;

    gGeo.setDrawRange(0, gN);
    (gGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (gGeo.attributes.aTh as THREE.BufferAttribute).needsUpdate = true;
    (gGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (gGeo.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
    glowMat.uniforms.uScale.value = Hh * dpr * 0.5 * camera.projectionMatrix.elements[5];

    // tilt-shift focus at the diorama's heart
    V3.set(0, 0, 0).project(camera);
    post.uniforms.uFocus.value = V3.y * 0.5 + 0.5;
    post.uniforms.uBlur.value = (small ? 3.5 : 5.5) * dpr;
    post.uniforms.uTime.value = t;

    // overlay pins
    const place = (s: Site, x: number, y: number, z: number, show: boolean) => {
      V3.set(x, y, z).project(camera);
      const sx = (V3.x * 0.5 + 0.5) * W, sy = (-V3.y * 0.5 + 0.5) * Hh;
      const vis = show && V3.z < 1 && sx > -40 && sx < W + 40 && sy > -40 && sy < Hh + 40;
      if (vis !== s.vis) { s.vis = vis; s.el.classList.toggle('hidden', !vis); }
      s.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      if (s.open) {
        s.el.classList.toggle('below', sy < 190);
        const w = s.card.offsetWidth || 240;
        const shift = Math.max(8 - (sx - w / 2), Math.min(0, W - 8 - (sx + w / 2)));
        s.card.style.setProperty('--shift', `${shift.toFixed(0)}px`);
      }
    };
    for (const tw of towns) {
      const h0 = tw.houses[0];
      if (tw.k >= 0 && h0) place(tw.site, h0.x, dh[h0.k] + (h0.tower === 2 ? 1.25 : 0.72), h0.z, true);
      else place(tw.site, tw.x, 0, tw.z, false);
    }
    for (const b of boats) place(b.site, b.x, SEA + 1.0, b.z, true);
    if (keeper.site) place(keeper.site, keeper.x, keeper.k >= 0 ? dh[keeper.k] + 1.75 : 0, keeper.z, keeper.k >= 0);

    // keep the time slider honest
    if (!scrubbing && ((clock * 4) | 0) !== (((clock - 1 / 60) * 4) | 0)) ui.time.value = String(Math.round(tday * 1000));
  };

  // ------------------------------------------------------------------ loop
  let last = performance.now(), raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
    last = now;
    update(dt);
    draw(dt);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  };
  raf = requestAnimationFrame(frame);
  canvas.classList.add('on');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
}
