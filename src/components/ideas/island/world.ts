// The island: a low-poly diorama you can walk around. Every landmark is a project.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PLACES, type Place } from './copy';

type V2 = THREE.Vector2;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const angDiff = (a: number, b: number) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

// Palette ------------------------------------------------------------------
const C = {
  skyTop: 0x6fb8e6, horizon: 0xffdcbc,
  sand: 0xf2d39c, sandWet: 0xdcb07a, grass: 0x9fce62, grass2: 0x88bf55, grass3: 0x76ad4c, rock: 0xb7a693, rock2: 0x9c8c7c,
  shallow: 0x5fd6cf, deep: 0x2a8cc0,
  red: 0xe0503b, white: 0xfff6e8, ink: 0x2b2118, dark: 0x3a3442, wood: 0xa8703f, wood2: 0x7d4f2b,
  yellow: 0xf4b73a, orange: 0xef8f2f, blue: 0x3b78c4, teal: 0x2f9c9a, purple: 0x5b3fa8,
  skin: 0xf2c3a0, jumper: 0xe0503b, trousers: 0x2e3b5e, hair: 0x4a3122,
  leaf: 0x5aae4c, leaf2: 0x489a40, trunk: 0xa47449, trunk2: 0x8a5f39,
};

// Small noise ----------------------------------------------------------------
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// Island shape -----------------------------------------------------------------
const SHORE_GLSL = 'float shoreR(float a){ return 24.5 + 2.0*sin(3.0*a+0.7) + 1.2*sin(5.0*a+2.1) + 0.6*sin(8.0*a+4.0); }';
function shoreR(a: number) { return 24.5 + 2.0 * Math.sin(3 * a + 0.7) + 1.2 * Math.sin(5 * a + 2.1) + 0.6 * Math.sin(8 * a + 4.0); }
function polar(deg: number, t: number) { const a = deg * DEG; const r = shoreR(a) * t; return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r); }
function tOf(x: number, z: number) { return Math.hypot(x, z) / shoreR(Math.atan2(z, x)); }

const SPOT = {
  start: polar(90, 0.8),
  bottle: polar(113, 0.93),
  telescope: polar(146, 0.89),
  whale: polar(150, 1.62),
  balloon: polar(194, 0.6),
  lighthouse: polar(246, 0.5),
  windmill: polar(302, 0.55),
  dock: polar(352, 0.86),
  pond: polar(24, 0.5),
  arcade: polar(64, 0.5),
  library: polar(150, 0.45),
  sign: new THREE.Vector2(1.5, 1.5),
};
const HILL = SPOT.lighthouse;

type Zone = { x: number; z: number; r: number; h: number };
const zones: Zone[] = [];
function rawH(x: number, z: number) {
  const t = tOf(x, z);
  const inland = 1 - smooth(0.6, 0.92, t);
  let h = (1 - t) * 2.4 + inland * 0.9 - 1.6 * smooth(1.05, 1.5, t);
  h += inland * (vnoise(x * 0.16 + 3, z * 0.16 + 7) - 0.5) * 1.2;
  const dx = x - HILL.x, dz = z - HILL.y;
  h += 6.2 * Math.exp(-(dx * dx + dz * dz) / (2 * 4.4 * 4.4)) * (1 - smooth(0.78, 0.96, t));
  return h;
}
function H(x: number, z: number) {
  let h = rawH(x, z);
  for (const zn of zones) {
    const d = Math.hypot(x - zn.x, z - zn.z);
    if (d < zn.r) h = lerp(h, zn.h, 1 - smooth(zn.r * 0.55, zn.r, d));
  }
  return h;
}
function addZone(p: V2, r: number, dh = 0) { zones.push({ x: p.x, z: p.y, r, h: rawH(p.x, p.y) + dh }); }
addZone(SPOT.lighthouse, 3.4, -0.2);
addZone(SPOT.windmill, 3.4);
addZone(SPOT.arcade, 2.8);
addZone(SPOT.library, 4.0);
addZone(SPOT.sign, 2.4);
addZone(SPOT.balloon, 3.6);
addZone(SPOT.pond, 6.2);

// DOM --------------------------------------------------------------------------
const canvas = document.getElementById('c') as HTMLCanvasElement;
const cardEl = document.getElementById('card') as HTMLElement;
const bubbleEl = document.getElementById('bubble') as HTMLElement;
const hintEl = document.getElementById('hint') as HTMLElement;
const mapEl = document.getElementById('map') as HTMLCanvasElement;
const joyEl = document.getElementById('joy') as HTMLElement;
const knobEl = joyEl.querySelector('.knob') as HTMLElement;
const guideEl = document.getElementById('guide') as HTMLElement;
const guideBtn = document.getElementById('guideBtn') as HTMLButtonElement;

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('no-webgl');
  throw e;
}
const DPR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const FOG_NEAR = 70, FOG_FAR = 190;
scene.fog = new THREE.Fog(C.horizon, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);

// Lights ---------------------------------------------------------------------
const SUN_DIR = new THREE.Vector3(0.62, 0.82, -0.3).normalize();
scene.add(new THREE.HemisphereLight(0xfff2de, 0x7fae9a, 1.55));
const sun = new THREE.DirectionalLight(0xffeed6, 2.5);
sun.position.copy(SUN_DIR).multiplyScalar(70);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 10, far: 160 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// Materials --------------------------------------------------------------------
const matCache = new Map<string, THREE.Material>();
function lam(color: number, extra: THREE.MeshLambertMaterialParameters = {}) {
  const key = color + JSON.stringify(extra);
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }); matCache.set(key, m); }
  return m;
}
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);

// canvas textures, redrawn once the web fonts arrive
const redraws: (() => void)[] = [];
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, nearest = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; }
  else tex.anisotropy = 4;
  const run = () => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h); tex.needsUpdate = true; };
  run(); (run as any).tex = tex; redraws.push(run);
  return tex;
}
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const DISPLAY = '"Fraunces", Georgia, serif';
const SANS = '"DM Sans", system-ui, sans-serif';
const MONO = '"DM Mono", ui-monospace, monospace';

// Sky ------------------------------------------------------------------------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(C.skyTop) }, uHorizon: { value: new THREE.Color(C.horizon) }, uSun: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float y = d.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.5, y));
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0,0.85,0.6) * pow(s, 12.0) * 0.25;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

// Terrain ---------------------------------------------------------------------------
const terrain = (() => {
  const S = 72, N = 90;
  const g = new THREE.PlaneGeometry(S, S, N, N);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const cell = S / N;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    if (Math.abs(x) < S / 2 - 0.01 && Math.abs(z) < S / 2 - 0.01) {
      x += (hash(x * 3.1, z * 1.7) - 0.5) * cell * 0.7;
      z += (hash(x * 1.3, z * 2.9) - 0.5) * cell * 0.7;
    }
    pos.setXYZ(i, x, H(x, z), z);
  }
  const ng = g.toNonIndexed();
  const p = ng.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const slope = Math.abs(n.y);
    const cy = (a.y + b.y + c.y) / 3, cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    const r = hash(cx * 7.7, cz * 3.3);
    if (cy < 0.08) col.setHex(C.sandWet);
    else if (cy < 0.5 + r * 0.12) col.setHex(C.sand);
    else if (cy > 5.0 && slope < 0.86) col.setHex(r > 0.5 ? C.rock : C.rock2);
    else { const v = vnoise(cx * 0.3, cz * 0.3); col.setHex(v < 0.38 ? C.grass3 : v < 0.62 ? C.grass2 : C.grass); }
    col.offsetHSL(0, 0, (r - 0.5) * 0.035);
    for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ng.computeVertexNormals();
  const m = new THREE.Mesh(ng, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.receiveShadow = true;
  return m;
})();
scene.add(terrain);

// Water ------------------------------------------------------------------------------
const waterUniforms = {
  uTime: { value: 0 }, uAmp: { value: reduced ? 0.06 : 0.16 },
  uShallow: { value: new THREE.Color(C.shallow) }, uDeep: { value: new THREE.Color(C.deep) },
  uFog: { value: new THREE.Color(C.horizon) }, uFogNear: { value: FOG_NEAR }, uFogFar: { value: FOG_FAR },
  uSun: { value: SUN_DIR }, uSpeed: { value: reduced ? 0.3 : 1 },
};
const water = (() => {
  const g = new THREE.PlaneGeometry(460, 460, 200, 200);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `uniform float uTime; uniform float uAmp; uniform float uSpeed; varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); float t = uTime*uSpeed;
        float y = sin(w.x*0.33 + t*1.1)*0.5 + sin(w.z*0.41 - t*0.9)*0.5 + sin((w.x+w.z)*0.21 + t*0.7)*0.6;
        w.y += y*uAmp - 0.05; vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform float uTime; uniform float uSpeed; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform vec3 uSun; varying vec3 vW;
      ${SHORE_GLSL}
      void main(){
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;
        float a = atan(vW.z, vW.x); float R = shoreR(a); float d = length(vW.xz); float t = d / R;
        float off = d - R; // metres from the shoreline
        vec3 col = mix(uShallow, uDeep, smoothstep(0.5, 9.0, off));
        vec3 L = normalize(uSun); vec3 V = normalize(cameraPosition - vW);
        col *= 0.78 + 0.32*max(dot(n, L), 0.0);
        float spec = pow(max(dot(reflect(-L, n), V), 0.0), 60.0);
        col += vec3(1.0, 0.95, 0.85) * spec * 0.55;
        float tt = uTime*uSpeed;
        float wob = 0.18*sin(a*9.0 + tt*1.7) + 0.12*sin(a*23.0 - tt*1.1);
        float aa = 0.06;
        float ring = 1.0 - smoothstep(0.55 - aa, 0.55 + aa, off + wob);
        float ph = fract(tt*0.22);
        float rp = 0.9 + ph*2.6;
        float ring2 = (1.0 - smoothstep(0.16 - aa, 0.16 + aa, abs(off + wob*0.6 - rp))) * (1.0 - ph) * 0.9;
        float ph2 = fract(tt*0.22 + 0.5); float rp2 = 0.9 + ph2*2.6;
        ring2 = max(ring2, (1.0 - smoothstep(0.12 - aa, 0.12 + aa, abs(off - wob*0.5 - rp2))) * (1.0 - ph2) * 0.7);
        col = mix(col, vec3(1.0), clamp(max(ring, ring2), 0.0, 1.0) * 0.92);
        float f = smoothstep(uFogNear, uFogFar, distance(cameraPosition, vW));
        col = mix(col, uFog, f);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(g, m);
})();
scene.add(water);

// Helpers for building -----------------------------------------------------------------------
const colliders: { x: number; z: number; r: number }[] = [];
const collide = (x: number, z: number, r: number) => colliders.push({ x, z, r });
const anims: ((dt: number, t: number) => void)[] = [];
function place(obj: THREE.Object3D, p: V2, yOff = 0, faceCenter = true) {
  obj.position.set(p.x, H(p.x, p.y) + yOff, p.y);
  if (faceCenter) obj.rotation.y = Math.atan2(-p.x, -p.y);
  scene.add(obj);
  return obj;
}
function faceColors(g: THREE.BufferGeometry, fn: (cx: number, cy: number, cz: number) => number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3); const col = new THREE.Color();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    col.setHex(fn(cx, cy, cz));
    for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return ng;
}

type Landmark = { place: Place; pos: THREE.Vector3; anchor: THREE.Vector3; radius: number; root: THREE.Object3D; clear: number };
const landmarks: Landmark[] = [];
const placeById = Object.fromEntries(PLACES.map((p) => [p.id, p]));
function landmark(id: string, root: THREE.Object3D, p: V2, opts: { anchor?: number; radius?: number; clear?: number } = {}) {
  root.traverse((o) => { o.userData.lm = id; });
  const y = H(p.x, p.y);
  const lm: Landmark = {
    place: placeById[id], root,
    pos: new THREE.Vector3(p.x, y, p.y),
    anchor: new THREE.Vector3(p.x, y + (opts.anchor ?? 3), p.y),
    radius: opts.radius ?? 5, clear: opts.clear ?? 2.2,
  };
  landmarks.push(lm);
  return lm;
}

// Lighthouse (Replicate) ---------------------------------------------------------------
{
  const g = new THREE.Group();
  g.add(mesh(cyl(1.9, 2.4, 0.8, 9), lam(C.rock), 0, 0.15, 0));
  let y = 0.55; const segs = 5, segH = 1.5;
  for (let i = 0; i < segs; i++) {
    const ra = lerp(1.35, 0.92, i / segs), rb = lerp(1.35, 0.92, (i + 1) / segs);
    g.add(mesh(cyl(rb, ra, segH, 14), lam(i % 2 ? C.red : C.white), 0, y + segH / 2, 0));
    y += segH;
  }
  g.add(mesh(box(0.55, 0.95, 0.3), lam(C.wood2), 0, 1.05, 1.24));
  for (const wy of [3.4, 5.9]) g.add(mesh(box(0.3, 0.42, 0.2), lam(C.dark), 0, wy, lerp(1.32, 0.92, (wy - 0.55) / 7.5) - 0.02));
  g.add(mesh(cyl(1.4, 1.15, 0.22, 14), lam(C.dark), 0, y + 0.11, 0)); y += 0.22;
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; g.add(mesh(box(0.06, 0.5, 0.06), lam(C.dark), Math.cos(a) * 1.3, y + 0.25, Math.sin(a) * 1.3)); }
  const rail = mesh(new THREE.TorusGeometry(1.3, 0.05, 4, 28), lam(C.dark), 0, y + 0.5, 0); rail.rotation.x = Math.PI / 2; g.add(rail);
  const lantern = mesh(cyl(0.72, 0.72, 1.05, 8), glow(0xfff1b8), 0, y + 0.53, 0); g.add(lantern);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + TAU / 16; g.add(mesh(box(0.07, 1.05, 0.07), lam(C.dark), Math.cos(a) * 0.74, y + 0.53, Math.sin(a) * 0.74)); }
  g.add(mesh(new THREE.ConeGeometry(1.0, 0.95, 8), lam(C.red), 0, y + 1.05 + 0.47, 0));
  g.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), lam(C.dark), 0, y + 2.05, 0));
  // the sweeping beam
  const beam = new THREE.Group(); beam.position.y = y + 0.55; g.add(beam);
  const bg = new THREE.ConeGeometry(2.4, 22, 24, 1, true); bg.translate(0, -11, 0); bg.rotateZ(Math.PI / 2);
  const bp = bg.attributes.position as THREE.BufferAttribute; const bc = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) { const k = Math.pow(1 - clamp(bp.getX(i) / 22, 0, 1), 1.6); bc[i * 3] = k; bc[i * 3 + 1] = k * 0.92; bc[i * 3 + 2] = k * 0.7; }
  bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const bm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const s of [0, Math.PI]) { const cone = new THREE.Mesh(bg, bm); cone.rotation.y = s; cone.rotation.z = -0.06; cone.userData.noShadow = true; beam.add(cone); }
  anims.push((dt) => { beam.rotation.y += dt * (reduced ? 0.25 : 0.7); });
  place(g, SPOT.lighthouse, -0.15);
  collide(SPOT.lighthouse.x, SPOT.lighthouse.y, 2.2);
  landmark('lighthouse', g, SPOT.lighthouse, { anchor: 4.2, radius: 6.2, clear: 3 });
}

// Windmill (Cog) -----------------------------------------------------------------------
function gearShape(n: number, ro: number, ri: number, hole: number) {
  const s = new THREE.Shape(); const w = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = i * w;
    const pts: [number, number][] = [[ri, a], [ro, a + 0.12 * w], [ro, a + 0.42 * w], [ri, a + 0.54 * w], [ri, a + 0.78 * w]];
    pts.forEach(([r, an], k) => { const x = Math.cos(an) * r, y = Math.sin(an) * r; if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, TAU, true); s.holes.push(h);
  return s;
}
{
  const g = new THREE.Group();
  g.add(mesh(cyl(1.05, 1.6, 5.2, 8), lam(0xf5e6c8), 0, 2.6, 0));
  g.add(mesh(cyl(1.62, 1.68, 0.4, 8), lam(C.wood2), 0, 0.2, 0));
  g.add(mesh(new THREE.ConeGeometry(1.38, 1.5, 8), lam(0x6b4a36), 0, 5.95, 0));
  g.add(mesh(box(0.6, 1.1, 0.2), lam(C.wood2), 0, 0.75, 1.5));
  g.add(mesh(box(0.38, 0.5, 0.2), lam(C.dark), 0, 3.3, 1.22));
  const hub = new THREE.Group(); hub.position.set(0, 4.75, 1.3); g.add(hub);
  const gg = new THREE.ExtrudeGeometry(gearShape(12, 1.12, 0.88, 0.22), { depth: 0.32, bevelEnabled: false, curveSegments: 6 }); gg.translate(0, 0, -0.16);
  const gear = mesh(gg, lam(C.orange)); hub.add(gear);
  hub.add(mesh(cyl(0.3, 0.3, 0.6, 8).rotateX(Math.PI / 2), lam(C.dark), 0, 0, 0.1));
  const sails = new THREE.Group(); sails.position.z = 0.32; hub.add(sails);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group(); arm.rotation.z = (i / 4) * TAU + 0.4; sails.add(arm);
    arm.add(mesh(box(0.14, 3.8, 0.1), lam(C.wood2), 0, 2.4, 0));
    arm.add(mesh(box(0.78, 2.7, 0.05), lam(0xfff8ec), 0.46, 2.85, 0));
    for (let k = 0; k < 4; k++) arm.add(mesh(box(0.86, 0.05, 0.08), lam(C.wood2), 0.46, 1.65 + k * 0.8, 0.02));
  }
  anims.push((dt) => { hub.rotation.z -= dt * (reduced ? 0.25 : 0.6); });
  place(g, SPOT.windmill);
  collide(SPOT.windmill.x, SPOT.windmill.y, 1.9);
  landmark('windmill', g, SPOT.windmill, { anchor: 4.4, radius: 5.5, clear: 2.6 });
}

// Container dock (Compose, Machine) -------------------------------------------------------------
function containerTex(color: number, label: string) {
  return canvasTex(512, 192, (ctx, w, h) => {
    ctx.fillStyle = hex(color); ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(x, 0, 6, h); ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x + 8, 0, 3, h); }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10);
    if (label) {
      ctx.fillStyle = '#fff8ec'; ctx.font = `700 76px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      (ctx as any).letterSpacing = '6px';
      ctx.fillText(label, w / 2, h / 2 + 4);
    }
  });
}
function container(color: number, label = '', L = 2.6, S = 1.1) {
  const side = new THREE.MeshLambertMaterial({ map: containerTex(color, label) });
  const plain = lam(color);
  return mesh(box(L, S, S), [plain, plain, plain, plain, side, side]);
}
let craneLoad: THREE.Object3D;
{
  const g = new THREE.Group();
  const deckY = 0.75;
  // deck straddling the shore, and a pier out to sea (local +z points out to sea after rotation)
  g.add(mesh(box(6.4, 0.3, 5), lam(C.wood)));
  g.children[0].position.set(0, deckY, -0.6);
  for (let i = 0; i < 9; i++) g.add(mesh(box(0.08, 0.31, 5.02), lam(C.wood2), -2.9 + i * 0.72, deckY + 0.01, -0.6));
  const pier = mesh(box(2, 0.25, 9), lam(C.wood), 1.6, deckY - 0.02, 6.2); g.add(pier);
  for (let k = 0; k < 4; k++) for (const sx of [0.7, 2.5]) g.add(mesh(cyl(0.14, 0.14, 3, 6), lam(C.wood2), sx, deckY - 1.4, 2.8 + k * 2.6));
  for (const [x, z] of [[-3, -2.9], [3, -2.9], [-3, 1.7], [3, 1.7]]) g.add(mesh(cyl(0.16, 0.16, 2.2, 6), lam(C.wood2), x, deckY - 1.0, z));
  // stacks
  const base = deckY + 0.15 + 0.55;
  const c1 = container(C.blue, 'COMPOSE'); c1.position.set(-1.2, base, -1.6); g.add(c1);
  const c2 = container(C.orange, 'MACHINE'); c2.position.set(-1.2, base, -0.4); g.add(c2);
  const c3 = container(C.teal, ''); c3.position.set(-1.2, base + 1.1, -1.0); c3.rotation.y = 0.05; g.add(c3);
  const c4 = container(C.red, ''); c4.position.set(1.4, base, -1.9); c4.rotation.y = Math.PI / 2 + 0.03; g.add(c4);
  const c5 = container(0x6d5bd0, ''); c5.position.set(-1.2, base + 2.2, -1.1); c5.rotation.y = -0.06; g.add(c5);
  // a little tower crane at the end of the pier
  const crane = new THREE.Group(); crane.position.set(1.6, deckY, 9.6); g.add(crane);
  crane.add(mesh(box(0.9, 0.4, 0.9), lam(C.dark), 0, 0.2, 0));
  for (let k = 0; k < 7; k++) {
    crane.add(mesh(box(0.42, 0.95, 0.42), lam(C.yellow, { wireframe: false }), 0, 0.9 + k * 1.0, 0));
    crane.add(mesh(box(0.5, 0.08, 0.5), lam(C.ink), 0, 0.42 + k * 1.0, 0));
  }
  const jib = new THREE.Group(); jib.position.y = 7.6; crane.add(jib);
  jib.add(mesh(box(0.7, 0.6, 0.7), lam(C.yellow), 0, 0.2, 0));
  jib.add(mesh(box(8.6, 0.3, 0.32), lam(C.yellow), 2.2, 0.55, 0));
  jib.add(mesh(box(1.1, 0.6, 0.7), lam(C.dark), -1.6, 0.4, 0));
  jib.add(mesh(box(0.5, 0.5, 0.5), glow(0xfff1b8), 0.5, 0.75, 0));
  const trolley = new THREE.Group(); trolley.position.set(4.4, 0.35, 0); jib.add(trolley);
  const cableGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -3, 0)]);
  const cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: C.ink })); trolley.add(cable);
  craneLoad = new THREE.Group(); trolley.add(craneLoad);
  const hang = container(0x2f9c9a, '', 2.2, 0.95); hang.position.y = -0.5; craneLoad.add(hang);
  const t0 = rnd() * 10;
  anims.push((dt, t) => {
    const tt = t + t0;
    jib.rotation.y = Math.sin(tt * (reduced ? 0.06 : 0.16)) * 1.1 - 0.4;
    const drop = 3.2 + Math.sin(tt * (reduced ? 0.15 : 0.4)) * 1.6;
    craneLoad.position.y = -drop;
    (cable.geometry.attributes.position as THREE.BufferAttribute).setY(1, -drop);
    cable.geometry.attributes.position.needsUpdate = true;
  });
  const out = Math.atan2(SPOT.dock.y, SPOT.dock.x);
  g.position.set(SPOT.dock.x, 0, SPOT.dock.y);
  g.rotation.y = Math.atan2(Math.cos(out), Math.sin(out)); // local +z points out to sea
  scene.add(g);
  const toW = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyMatrix4(g.matrixWorld.compose(g.position, g.quaternion, g.scale));
  for (const [x, z] of [[-1.2, -1.0], [1.4, -1.9]]) { const p = toW(x, z); collide(p.x, p.z, 1.45); }
  const lm = landmark('dock', g, SPOT.dock, { anchor: 3.8, radius: 6.5, clear: 2.8 });
  lm.pos.y = deckY; lm.anchor.y = 4.2;
}

// Whale + telescope (Whalebrew) ----------------------------------------------------------------
{
  const scope = new THREE.Group();
  scope.add(mesh(cyl(0.07, 0.1, 1.15, 6), lam(C.dark), 0, 0.57, 0));
  const head = new THREE.Group(); head.position.y = 1.2; scope.add(head);
  head.add(mesh(cyl(0.12, 0.17, 0.85, 8).rotateX(Math.PI / 2), lam(C.teal), 0, 0, 0.1));
  head.add(mesh(cyl(0.08, 0.08, 0.2, 6).rotateX(Math.PI / 2), lam(C.dark), 0, 0, -0.42));
  head.add(mesh(box(0.34, 0.3, 0.22), lam(C.teal), 0, -0.12, -0.05));
  place(scope, SPOT.telescope, 0, false);
  scope.rotation.y = Math.atan2(SPOT.whale.x - SPOT.telescope.x, SPOT.whale.y - SPOT.telescope.y);
  head.rotation.x = -0.12;
  collide(SPOT.telescope.x, SPOT.telescope.y, 0.35);
  const whale = new THREE.Group();
  const body = new THREE.SphereGeometry(1, 12, 9); body.scale(1.15, 0.9, 3.1);
  whale.add(mesh(faceColors(body, (x, y, z) => (y < -0.25 ? 0xd5dee6 : z > 2.55 && y < 0.2 ? 0xd5dee6 : 0x3f6185)), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  for (const s of [-1, 1]) {
    const fin = mesh(box(1.4, 0.1, 0.55), lam(0x3f6185), s * 1.2, -0.4, 1.2); fin.rotation.z = s * -0.5; fin.rotation.y = s * 0.4; whale.add(fin);
    whale.add(mesh(new THREE.SphereGeometry(0.09, 6, 4), lam(C.ink), s * 0.82, 0.05, 2.2));
  }
  const tail = new THREE.Group(); tail.position.z = -2.8; whale.add(tail);
  tail.add(mesh(new THREE.ConeGeometry(0.45, 1.5, 7).rotateX(-Math.PI / 2), lam(0x3f6185), 0, 0, -0.6));
  const fluke = new THREE.Shape(); fluke.moveTo(0, 0); fluke.quadraticCurveTo(0.9, -0.2, 1.7, -0.8); fluke.quadraticCurveTo(1.0, -0.95, 0, -0.55); fluke.quadraticCurveTo(-1.0, -0.95, -1.7, -0.8); fluke.quadraticCurveTo(-0.9, -0.2, 0, 0);
  const fg = new THREE.ExtrudeGeometry(fluke, { depth: 0.1, bevelEnabled: false, curveSegments: 4 }); fg.rotateX(Math.PI / 2); fg.translate(0, 0, -1.2);
  tail.add(mesh(fg, lam(0x3f6185)));
  scene.add(whale);
  // spout
  const spout = new THREE.Group(); scene.add(spout);
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) { const p = mesh(new THREE.IcosahedronGeometry(0.28, 0), lam(0xffffff, { emissive: 0x9fb8c8 })); p.userData.noShadow = true; spout.add(p); puffs.push(p); }
  const W = SPOT.whale; const dir = new THREE.Vector2(-W.y, W.x).normalize(); // swims parallel to the shore
  const look = new THREE.Vector3();
  const pathAt = (u: number, out: THREE.Vector3) => out.set(W.x + dir.x * (u - 0.5) * 18, -2.7 + 3.4 * Math.sin(u * Math.PI), W.y + dir.y * (u - 0.5) * 18);
  const CYCLE = 15;
  anims.push((dt, t) => {
    let u: number;
    if (reduced) { u = 0.5; whale.position.set(W.x, 0.1 + Math.sin(t * 0.6) * 0.08, W.y); look.set(W.x + dir.x, 0.1, W.y + dir.y); whale.lookAt(look); }
    else {
      const s = (t % CYCLE) / CYCLE;
      u = s / 0.6;
      if (u > 1) { whale.visible = false; spout.visible = false; return; }
      whale.visible = true;
      pathAt(u, whale.position); pathAt(Math.min(u + 0.02, 1.02), look);
      whale.lookAt(look);
    }
    tail.rotation.x = Math.sin(t * 2.2) * 0.18 + (u > 0.75 ? (u - 0.75) * 1.6 : 0);
    const sp = reduced ? (t % 6) / 6 : clamp((u - 0.34) / 0.3, 0, 1);
    spout.visible = sp > 0 && sp < 1;
    spout.position.set(whale.position.x, whale.position.y + 0.8, whale.position.z).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(whale.quaternion), 1.5);
    puffs.forEach((p, i) => {
      const k = (sp * 1.6 + i / puffs.length) % 1;
      const a = i * 2.4;
      p.position.set(Math.cos(a) * k * 0.7, k * 3.2 - k * k * 0.8, Math.sin(a) * k * 0.7);
      p.scale.setScalar((1 - k) * 1.3 * Math.sin(sp * Math.PI) + 0.01);
    });
  });
  landmark('telescope', scope, SPOT.telescope, { anchor: 2.4, radius: 4.8, clear: 1.1 });
}

// Weather balloon (UKHAS) ----------------------------------------------------------------
{
  const pad = new THREE.Group();
  pad.add(mesh(cyl(1.9, 2.0, 0.16, 18), lam(0xd9d2c4), 0, 0.08, 0));
  pad.add(mesh(new THREE.RingGeometry(1.35, 1.6, 24).rotateX(-Math.PI / 2), lam(C.yellow), 0, 0.17, 0));
  pad.add(mesh(box(0.14, 0.5, 0.14), lam(C.dark), 0, 0.4, 0));
  for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + 0.4; pad.add(mesh(box(0.5, 0.06, 0.12), lam(C.ink), Math.cos(a) * 1.75, 0.17, Math.sin(a) * 1.75)).rotation.y = -a; }
  place(pad, SPOT.balloon, 0);
  const padTop = new THREE.Vector3(SPOT.balloon.x, H(SPOT.balloon.x, SPOT.balloon.y) + 0.6, SPOT.balloon.y);
  collide(SPOT.balloon.x, SPOT.balloon.y, 0.35);
  const balloon = new THREE.Group(); scene.add(balloon);
  const env = mesh(new THREE.IcosahedronGeometry(1.15, 2).scale(1, 1.12, 1), lam(0xfff7ef, { emissive: 0x2a2018 }));
  env.position.y = 1.3; balloon.add(env);
  balloon.add(mesh(new THREE.ConeGeometry(0.22, 0.4, 6).rotateX(Math.PI), lam(0xf0e6d8), 0, 0.02, 0));
  const chute = mesh(new THREE.ConeGeometry(0.42, 0.28, 8), lam(0xd4497e), 0, -0.75, 0); balloon.add(chute);
  const payload = mesh(box(0.38, 0.34, 0.38), lam(C.orange), 0, -1.45, 0); balloon.add(payload);
  balloon.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, -1.28, 0)]), new THREE.LineBasicMaterial({ color: C.ink })));
  const tetherGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const tether = new THREE.Line(tetherGeo, new THREE.LineBasicMaterial({ color: C.ink })); scene.add(tether);
  let state: 'held' | 'rise' | 'gone' | 'inflate' = 'inflate', st = 1.2, vy = 0;
  const pos = new THREE.Vector3(), drift = new THREE.Vector3();
  const HOLD = 4.4;
  anims.push((dt, t) => {
    st += dt;
    if (state === 'held') {
      pos.set(padTop.x + Math.sin(t * 0.8) * 0.3, padTop.y + HOLD + Math.sin(t * 1.3) * 0.12, padTop.z + Math.cos(t * 0.7) * 0.25);
      balloon.scale.setScalar(1);
      if (!reduced && st > 16) { state = 'rise'; st = 0; vy = 0.4; drift.set(0, 0, 0); }
    } else if (state === 'rise') {
      vy = Math.min(vy + dt * 1.4, 5); pos.y += vy * dt; drift.x += dt * 0.5; pos.x += drift.x * dt; pos.z += Math.sin(st) * dt * 0.4;
      balloon.scale.setScalar(1 + clamp((pos.y - padTop.y - HOLD) / 45, 0, 1) * 0.8);
      if (pos.y > padTop.y + 70) { state = 'gone'; st = 0; balloon.visible = false; }
    } else if (state === 'gone') {
      if (st > 3) { state = 'inflate'; st = 0; balloon.visible = true; }
    } else {
      const k = ease(clamp(st / 2.4, 0, 1));
      pos.set(padTop.x, padTop.y + lerp(1.4, HOLD, k), padTop.z);
      balloon.scale.setScalar(lerp(0.15, 1, k));
      if (st > 2.6) { state = 'held'; st = 0; }
    }
    balloon.position.copy(pos);
    const tp = tetherGeo.attributes.position as THREE.BufferAttribute;
    tether.visible = state === 'held' || state === 'inflate';
    tp.setXYZ(0, padTop.x, padTop.y, padTop.z); tp.setXYZ(1, pos.x, pos.y - 1.62 * balloon.scale.y, pos.z); tp.needsUpdate = true;
  });
  landmark('balloon', pad, SPOT.balloon, { anchor: 3.2, radius: 5, clear: 1.2 });
}

// Arcade cabinet (JSNES) -----------------------------------------------------------------------
{
  const g = new THREE.Group();
  const s = new THREE.Shape();
  [[-0.38, 0], [0.38, 0], [0.38, 0.86], [0.58, 0.96], [0.54, 1.06], [0.32, 1.1], [0.2, 1.78], [0.32, 1.86], [0.32, 2.14], [-0.38, 2.14]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const cg = new THREE.ExtrudeGeometry(s, { depth: 0.84, bevelEnabled: false }); cg.translate(0, 0, -0.42); cg.rotateY(-Math.PI / 2);
  g.add(mesh(cg, lam(0x4a3596)));
  for (const sx of [-0.43, 0.43]) g.add(mesh(box(0.02, 2.14, 0.76), lam(C.yellow), sx, 1.07, -0.03));
  let frame = 0;
  const scrTex = canvasTex(64, 48, (ctx) => {
    const f = frame;
    ctx.fillStyle = '#15123a'; ctx.fillRect(0, 0, 64, 48);
    ctx.fillStyle = '#fff6d8';
    for (let i = 0; i < 12; i++) ctx.fillRect(((i * 23 - f * 0.5) % 64 + 64) % 64, (i * 13) % 26 + 2, 1, 1);
    ctx.fillStyle = '#ffd36b'; ctx.fillRect(48, 5, 7, 7);
    const hillX = ((-f * 0.8) % 80 + 80) % 80 - 16;
    ctx.fillStyle = '#2f8a63'; ctx.beginPath(); ctx.moveTo(hillX, 38); ctx.lineTo(hillX + 14, 26); ctx.lineTo(hillX + 28, 38); ctx.fill();
    ctx.fillStyle = '#e0503b'; ctx.fillRect(0, 38, 64, 10);
    ctx.fillStyle = '#8f2a1d'; for (let x = -(f * 2 % 8); x < 64; x += 8) { ctx.fillRect(x, 38, 1, 10); ctx.fillRect(x + 4, 43, 1, 5); } ctx.fillRect(0, 43, 64, 1);
    const ox = 64 - ((f * 2) % 96);
    ctx.fillStyle = '#5fd36b'; ctx.fillRect(ox, 30, 8, 8); ctx.fillStyle = '#2f8a3b'; ctx.fillRect(ox - 1, 28, 10, 3);
    const dx = ox - 18; const jump = dx > -6 && dx < 14 ? Math.sin(((dx + 6) / 20) * Math.PI) * 13 : 0;
    const hy = 30 - jump;
    ctx.fillStyle = '#e0503b'; ctx.fillRect(16, hy - 2, 6, 3);
    ctx.fillStyle = '#f2c3a0'; ctx.fillRect(16, hy + 1, 6, 3);
    ctx.fillStyle = '#3b78c4'; ctx.fillRect(16, hy + 4, 6, 4);
    ctx.fillStyle = '#15123a'; ctx.fillRect(20, hy + 2, 1, 1);
  }, true);
  const screen = mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map: scrTex }), 0, 1.44, 0.27);
  screen.rotation.x = -0.18; g.add(screen);
  const marq = canvasTex(256, 80, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ffcf5a'); gr.addColorStop(1, '#ff8a4a');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b1a5c'; ctx.font = `900 56px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('JSNES', w / 2, h / 2 + 3);
  });
  g.add(mesh(new THREE.PlaneGeometry(0.72, 0.24), new THREE.MeshBasicMaterial({ map: marq }), 0, 2.0, 0.325));
  g.add(mesh(cyl(0.025, 0.025, 0.16, 5), lam(C.ink), -0.16, 1.12, 0.46));
  g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), lam(C.red), -0.16, 1.21, 0.46));
  for (const [x, c] of [[0.08, C.yellow], [0.22, 0x5fd36b]] as const) g.add(mesh(cyl(0.045, 0.045, 0.04, 8), lam(c, { emissive: c, emissiveIntensity: 0.3 }), x, 1.07, 0.47));
  const glowTex = canvasTex(64, 64, (ctx) => { const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(140,120,255,0.8)'); gr.addColorStop(1, 'rgba(140,120,255,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64); });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
  halo.scale.set(1.8, 1.8, 1); halo.position.set(0, 1.45, 0.5); g.add(halo);
  let acc = 0;
  anims.push((dt) => { acc += dt; if (acc > 1 / 15) { acc = 0; frame += reduced ? 0.5 : 1; redrawOne(scrTex); } });
  place(g, SPOT.arcade, 0, false);
  g.rotation.y = Math.atan2(SPOT.start.x - SPOT.arcade.x, SPOT.start.y - SPOT.arcade.y) - 0.5;
  collide(SPOT.arcade.x, SPOT.arcade.y, 0.7);
  landmark('arcade', g, SPOT.arcade, { anchor: 2.9, radius: 4.6, clear: 1.6 });
}
function redrawOne(tex: THREE.CanvasTexture) {
  const i = redraws.findIndex((r) => (r as any).tex === tex);
  if (i >= 0) redraws[i]();
}

// Reading room (arXiv Vanity) -----------------------------------------------------------
{
  const g = new THREE.Group();
  g.add(mesh(box(3.2, 2.0, 2.6), lam(0xf7e8cc), 0, 1.0, 0));
  g.add(mesh(box(3.3, 0.25, 2.7), lam(C.wood2), 0, 0.12, 0));
  const tri = new THREE.Shape(); tri.moveTo(-2.0, 0); tri.lineTo(2.0, 0); tri.lineTo(0, 1.5); tri.closePath();
  const rg = new THREE.ExtrudeGeometry(tri, { depth: 3.1, bevelEnabled: false }); rg.translate(0, 0, -1.55); rg.rotateY(Math.PI / 2);
  g.add(mesh(rg, lam(0x2f7a5a), 0, 2.0, 0));
  g.add(mesh(box(0.4, 1.0, 0.4), lam(C.rock2), 0.9, 3.0, -0.4));
  g.add(mesh(box(0.72, 1.3, 0.1), lam(C.wood2), 0, 0.75, 1.31));
  for (const x of [-1.05, 1.05]) { g.add(mesh(box(0.62, 0.55, 0.08), glow(0xffd98a), x, 1.15, 1.31)); g.add(mesh(box(0.7, 0.07, 0.12), lam(C.wood2), x, 0.86, 1.34)); }
  const sign = canvasTex(512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#fff6e4'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#2b2118'; ctx.font = `800 52px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Reading Room', w / 2, h / 2 + 3);
  });
  g.add(mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshLambertMaterial({ map: sign }), 0, 1.72, 1.33));
  const bookCols = [C.red, C.blue, C.yellow, 0x2f7a5a, C.purple, C.orange];
  for (let s = 0; s < 3; s++) {
    let y = 0.05; const n = 3 + (s % 2) * 2;
    for (let i = 0; i < n; i++) { const b = mesh(box(0.7 - rnd() * 0.15, 0.14, 0.5), lam(bookCols[(i + s * 2) % bookCols.length]), 2.15 + s * 0.05, y + 0.07, 0.6 - s * 0.62); b.rotation.y = (rnd() - 0.5) * 0.5; g.add(b); y += 0.14; }
  }
  place(g, SPOT.library);
  // paper planes
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.45, -0.32, 0.03, -0.3, 0, -0.07, -0.3, 0, 0, 0.45, 0, -0.07, -0.3, 0.32, 0.03, -0.3], 3));
  pg.computeVertexNormals();
  const planes: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) { const p = mesh(pg, lam(0xffffff, { side: THREE.DoubleSide })); scene.add(p); planes.push(p); }
  const c = new THREE.Vector3(SPOT.library.x, H(SPOT.library.x, SPOT.library.y), SPOT.library.y);
  const nx = new THREE.Vector3();
  anims.push((dt, t) => {
    planes.forEach((p, i) => {
      const sp = reduced ? 0.15 : 0.45;
      const a = t * sp * (i ? -1 : 1) + i * 2;
      const r = 3.6 + i * 0.9;
      p.position.set(c.x + Math.cos(a) * r, c.y + 3.6 + i * 0.8 + Math.sin(t * 1.3 + i) * 0.35, c.z + Math.sin(a) * r);
      const a2 = a + 0.1 * (i ? -1 : 1);
      nx.set(c.x + Math.cos(a2) * r, p.position.y, c.z + Math.sin(a2) * r);
      p.lookAt(nx); p.rotateZ((i ? 1 : -1) * 0.35);
    });
  });
  const fwd = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
  collide(SPOT.library.x - fwd.x * 0.3, SPOT.library.y - fwd.z * 0.3, 1.85);
  landmark('library', g, SPOT.library, { anchor: 3.9, radius: 5.4, clear: 2.4 });
}

// Signpost (CLIG) --------------------------------------------------------------------------
{
  const g = new THREE.Group();
  g.add(mesh(box(0.2, 3.9, 0.2), lam(C.wood2), 0, 1.95, 0));
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.3, 4).rotateY(Math.PI / 4), lam(C.wood2), 0, 4.05, 0));
  const targets = PLACES.filter((p) => p.id !== 'sign').map((p) => ({ p, spot: (SPOT as any)[p.id] as V2 }));
  const boardCols = ['#f6e3bd', '#fff1d6', '#f1d9a8'];
  targets.forEach(({ p, spot }, i) => {
    const dx = spot.x - SPOT.sign.x, dz = spot.y - SPOT.sign.y;
    const arm = new THREE.Group(); arm.position.y = 1.35 + i * 0.3; arm.rotation.y = Math.atan2(-dz, dx); g.add(arm);
    const drawArrow = (flip: boolean) => canvasTex(512, 96, (ctx, w, h) => {
      ctx.save(); if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1); }
      ctx.fillStyle = boardCols[i % 3]; ctx.strokeStyle = '#2b2118'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(w - 60, 8); ctx.lineTo(w - 6, h / 2); ctx.lineTo(w - 60, h - 8); ctx.lineTo(4, h - 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#2b2118'; ctx.font = `500 56px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(p.flag, flip ? w / 2 + 24 : w / 2 - 24, h / 2 + 2);
    });
    const front = mesh(new THREE.PlaneGeometry(2.1, 0.36), new THREE.MeshLambertMaterial({ map: drawArrow(false), transparent: true, alphaTest: 0.5 }), 1.12, 0, 0.11);
    const back = mesh(new THREE.PlaneGeometry(2.1, 0.36), new THREE.MeshLambertMaterial({ map: drawArrow(true), transparent: true, alphaTest: 0.5 }), 1.12, 0, -0.11);
    back.rotation.y = Math.PI;
    arm.add(front, back);
  });
  place(g, SPOT.sign, 0, false);
  collide(SPOT.sign.x, SPOT.sign.y, 0.3);
  landmark('sign', g, SPOT.sign, { anchor: 4.6, radius: 3.6, clear: 1.4 });
}

// Guitar pond (Django) ---------------------------------------------------------------------
{
  const g = new THREE.Group();
  const lower = { x: -2.4, r: 2.05 }, upper = { x: -0.15, r: 1.6 };
  const sdf = (x: number, y: number) => {
    const a = Math.hypot(x - lower.x, y) - lower.r, b = Math.hypot(x - upper.x, y) - upper.r, k = 0.9;
    const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25;
  };
  const outline = (grow: number) => {
    const s = new THREE.Shape(); const cx = -1.3, N = 64;
    for (let i = 0; i < N; i++) {
      const an = (i / N) * TAU; const dx = Math.cos(an), dy = Math.sin(an);
      let lo = 0, hi = 5; for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (sdf(cx + dx * m, dy * m) < grow) lo = m; else hi = m; }
      const x = cx + dx * lo, y = dy * lo; if (i) s.lineTo(x, y); else s.moveTo(x, y);
    }
    s.closePath(); return s;
  };
  const rim = mesh(new THREE.ShapeGeometry(outline(0.35)).rotateX(-Math.PI / 2), lam(0xe7cfa0), 0, 0.04, 0); g.add(rim);
  const wat = mesh(new THREE.ShapeGeometry(outline(0)).rotateX(-Math.PI / 2), lam(0x4cc7d0, { emissive: 0x0d4a5a, emissiveIntensity: 0.25 }), 0, 0.07, 0); g.add(wat);
  // sound hole is a lily pad
  g.add(mesh(cyl(0.62, 0.62, 0.05, 12), lam(0x5aae4c), upper.x + 0.15, 0.1, 0));
  g.add(mesh(new THREE.ConeGeometry(0.16, 0.22, 6), lam(0xf38bb0), upper.x + 0.35, 0.22, 0.12));
  // bridge, neck, frets, headstock
  g.add(mesh(box(0.25, 0.12, 0.95), lam(C.wood2), lower.x - 0.3, 0.14, 0));
  const nut = 1.3, neckEnd = 5.2;
  g.add(mesh(box(neckEnd - nut + 0.1, 0.16, 0.7), lam(0x6b4426), (nut + neckEnd) / 2, 0.08, 0));
  let fx = nut + 0.15, gap = 0.62; while (fx < neckEnd - 0.1) { g.add(mesh(box(0.05, 0.04, 0.72), lam(0xd9d4cc), fx, 0.18, 0)); fx += gap; gap *= 0.92; }
  for (const fz of [-0.18, 0.18]) for (const fxx of [2.7, 3.6]) g.add(mesh(cyl(0.05, 0.05, 0.02, 8), lam(0xfff6e8), fxx, 0.17, fz));
  g.add(mesh(box(1.0, 0.18, 0.95), lam(0x5a381f), neckEnd + 0.5, 0.09, 0));
  for (let i = 0; i < 3; i++) for (const sz of [-1, 1]) g.add(mesh(cyl(0.07, 0.07, 0.3, 6).rotateX(Math.PI / 2), lam(0xd9d4cc), neckEnd + 0.2 + i * 0.32, 0.18, sz * 0.58));
  for (let i = 0; i < 6; i++) {
    const z = -0.25 + i * 0.1;
    g.add(mesh(box(neckEnd + 0.1 - (lower.x - 0.3), 0.022, 0.022), lam(0xeeeeee), (neckEnd + 0.1 + lower.x - 0.3) / 2, 0.22, z));
  }
  const ang = 0.9;
  g.position.set(SPOT.pond.x, H(SPOT.pond.x, SPOT.pond.y), SPOT.pond.y); g.rotation.y = ang; scene.add(g);
  g.updateMatrixWorld();
  for (const c of [lower, upper]) { const p = new THREE.Vector3(c.x, 0, 0).applyMatrix4(g.matrixWorld); collide(p.x, p.z, c.r * 0.95); }
  const mid = new THREE.Vector3(-1.2, 0, 0).applyMatrix4(g.matrixWorld);
  const lm = landmark('pond', g, new THREE.Vector2(mid.x, mid.z), { anchor: 2.6, radius: 6, clear: 3 });
  void lm;
}

// Message in a bottle (contact) -------------------------------------------------------------
{
  const g = new THREE.Group();
  const glass = new THREE.MeshLambertMaterial({ color: 0x4fb06a, transparent: true, opacity: 0.72, flatShading: true });
  const b = new THREE.Group(); g.add(b);
  b.add(mesh(cyl(0.2, 0.2, 0.62, 8), glass, 0, 0, 0));
  b.add(mesh(cyl(0.08, 0.2, 0.2, 8), glass, 0, 0.41, 0));
  b.add(mesh(cyl(0.075, 0.075, 0.22, 8), glass, 0, 0.6, 0));
  b.add(mesh(cyl(0.07, 0.065, 0.14, 6), lam(0xc49a64), 0, 0.76, 0));
  b.add(mesh(cyl(0.1, 0.1, 0.42, 6), lam(0xfff1d6), 0, -0.02, 0));
  b.rotation.z = Math.PI / 2 - 0.25; b.rotation.y = 0.6; b.position.y = 0.12; b.scale.setScalar(1.35);
  b.children.forEach((c) => (c.userData.noShadowCast = c.children.length === 0 && (c as THREE.Mesh).material === glass));
  const star = canvasTex(64, 64, (ctx) => {
    ctx.fillStyle = '#fff'; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU, r = i % 2 ? 6 : 30; ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    ctx.fill();
  });
  const tw = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  tw.position.set(0.2, 0.7, 0); g.add(tw);
  anims.push((dt, t) => { const k = Math.max(0, Math.sin(t * 2.4)) ** 6; tw.scale.setScalar(0.05 + k * 0.5); tw.material.rotation = t * 0.6; });
  place(g, SPOT.bottle, -0.05, false);
  landmark('bottle', g, SPOT.bottle, { anchor: 1.9, radius: 4, clear: 1.1 });
}

// Scenery: palms, rocks, bushes ---------------------------------------------------------------
function leafGeo(L: number) {
  const pts: number[] = []; const seg = 5;
  const P = (i: number, side: number) => { const x = (i / seg) * L; const y = -0.55 * Math.pow(x / L, 2) * L * 0.55; const w = Math.sin((Math.PI * i) / seg) * 0.42; return [x, y + (side === 0 ? 0.07 : 0), side * w]; };
  for (let i = 0; i < seg; i++) for (const s of [-1, 1]) { const a = P(i, 0), b = P(i + 1, 0), c = P(i, s), d = P(i + 1, s); pts.push(...a, ...c, ...b, ...b, ...c, ...d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeVertexNormals(); return g;
}
const leafG = leafGeo(2.3);
function palm(p: V2, height: number, lean: number) {
  const g = new THREE.Group(); let x = 0, y = 0; const segs = 6;
  for (let i = 0; i < segs; i++) {
    const r = lerp(0.24, 0.15, i / segs); const h = height / segs;
    const s = mesh(cyl(r * 0.9, r, h, 6), lam(i % 2 ? C.trunk : C.trunk2), x, y + h / 2, 0); s.rotation.z = -lean * 0.5; g.add(s);
    x += lean * h * (0.3 + i * 0.12); y += h * 0.98;
  }
  const crown = new THREE.Group(); crown.position.set(x, y, 0); g.add(crown);
  for (let i = 0; i < 7; i++) { const l = mesh(leafG, lam(i % 2 ? C.leaf : C.leaf2, { side: THREE.DoubleSide })); l.rotation.y = (i / 7) * TAU + rnd() * 0.3; l.rotation.z = 0.25 + rnd() * 0.2; crown.add(l); }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; crown.add(mesh(new THREE.IcosahedronGeometry(0.15, 0), lam(0x6a4a2a), Math.cos(a) * 0.2, -0.15, Math.sin(a) * 0.2)); }
  g.position.set(p.x, H(p.x, p.y) - 0.05, p.y); g.rotation.y = rnd() * TAU; scene.add(g);
  collide(p.x, p.y, 0.35);
  const ph = rnd() * 10;
  if (!reduced) anims.push((dt, t) => { crown.rotation.z = Math.sin(t * 0.9 + ph) * 0.05; crown.rotation.x = Math.cos(t * 0.7 + ph) * 0.04; });
}
for (const [a, t, h] of [[14, 0.84, 3.4], [44, 0.86, 3.9], [79, 0.88, 3.2], [100, 0.86, 3.7], [128, 0.85, 3.5], [172, 0.83, 3.8], [214, 0.84, 3.3], [276, 0.82, 3.6], [326, 0.84, 3.4], [162, 0.9, 2.8], [6, 0.78, 3.0]] as const) palm(polar(a, t), h, 0.25 + rnd() * 0.25);
function clearOf(p: V2, m = 1.0) {
  for (const c of colliders) if (Math.hypot(p.x - c.x, p.y - c.z) < c.r + m) return false;
  for (const z of zones) if (Math.hypot(p.x - z.x, p.y - z.z) < z.r * 0.8) return false;
  return true;
}
for (let i = 0; i < 26; i++) {
  const inWater = i < 12;
  const p = polar(rnd() * 360, inWater ? 1.0 + rnd() * 0.12 : 0.3 + rnd() * 0.55);
  if (!inWater && !clearOf(p)) continue;
  const r = inWater ? 0.4 + rnd() * 0.7 : 0.3 + rnd() * 0.4;
  const m = mesh(new THREE.DodecahedronGeometry(r, 0), lam(rnd() > 0.5 ? C.rock : C.rock2));
  m.scale.set(1, 0.6 + rnd() * 0.4, 1); m.rotation.set(rnd(), rnd() * 3, rnd());
  m.position.set(p.x, Math.max(H(p.x, p.y), -0.6) + r * 0.2, p.y); scene.add(m);
  if (!inWater) collide(p.x, p.y, r);
}
for (let i = 0; i < 40; i++) {
  const p = polar(rnd() * 360, 0.15 + rnd() * 0.62);
  if (!clearOf(p, 0.8) || H(p.x, p.y) < 0.6) continue;
  const r = 0.35 + rnd() * 0.35;
  const m = mesh(new THREE.IcosahedronGeometry(r, 0), lam([C.leaf, C.leaf2, 0x6fb84f][i % 3]));
  m.position.set(p.x, H(p.x, p.y) + r * 0.55, p.y); m.rotation.set(rnd(), rnd(), rnd()); scene.add(m);
  if (i % 3 === 0) scene.add(mesh(new THREE.IcosahedronGeometry(0.1, 0), lam([0xf38bb0, 0xfff1b8, 0xffffff][i % 3]), p.x + r * 0.5, H(p.x, p.y) + r * 1.0, p.y + 0.2));
}

// Clouds and gulls ----------------------------------------------------------------------------------
const clouds: THREE.Group[] = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group();
  const n = 3 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) { const r = 1.2 + rnd() * 1.4; const m = mesh(new THREE.IcosahedronGeometry(r, 1), lam(0xffffff, { emissive: 0xfff1e4, emissiveIntensity: 0.62 })); m.position.set(k * 1.7 - n * 0.8, rnd() * 0.6, rnd() * 1.2); m.scale.y = 0.72; m.userData.cloud = true; m.userData.noShadowCast = false; g.add(m); }
  g.position.set(-90 + i * 21 + rnd() * 8, 27 + rnd() * 12, -70 + rnd() * 120);
  scene.add(g); clouds.push(g);
}
anims.push((dt) => { for (const c of clouds) { c.position.x += dt * (reduced ? 0.15 : 0.6); if (c.position.x > 100) c.position.x = -100; } });
const gulls: { g: THREE.Group; l: THREE.Object3D; r: THREE.Object3D; ph: number; rad: number; h: number; sp: number }[] = [];
{
  const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0.7, 0.05, -0.05, 0, 0, -0.14], 3)); wing.computeVertexNormals();
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(); const m = lam(0xffffff, { side: THREE.DoubleSide });
    g.add(mesh(box(0.12, 0.1, 0.45), lam(0xffffff)));
    const l = mesh(wing, m); const r = mesh(wing, m); r.scale.x = -1; g.add(l, r);
    scene.add(g); gulls.push({ g, l, r, ph: i * 2.1, rad: 14 + i * 5, h: 12 + i * 2.5, sp: 0.22 - i * 0.03 });
  }
}
anims.push((dt, t) => {
  for (const s of gulls) {
    const a = t * s.sp * (reduced ? 0.4 : 1) + s.ph;
    s.g.position.set(Math.cos(a) * s.rad, s.h + Math.sin(t * 0.5 + s.ph) * 1.2, Math.sin(a) * s.rad);
    s.g.rotation.y = -a; s.g.rotation.z = -0.25;
    const f = reduced ? 0.1 : Math.sin(t * 7 + s.ph) * 0.5;
    s.l.rotation.z = f; s.r.rotation.z = -f;
  }
});

// Title in the sky -----------------------------------------------------------------------------
const TITLE_POS = new THREE.Vector3(0, 31, -26);
const titleTex = canvasTex(2048, 560, (ctx, w, h) => {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 300px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(255, 250, 241, 0.55)'; ctx.fillText('Ben Firshman', w / 2 + 8, h / 2 - 20 + 10);
  ctx.fillStyle = '#2b2118'; ctx.fillText('Ben Firshman', w / 2, h / 2 - 20);
  ctx.font = `700 60px ${SANS}`; ctx.fillStyle = '#c4462f';
  (ctx as any).letterSpacing = '10px';
  ctx.fillText('AN ISLAND OF THINGS I MADE', w / 2, h / 2 + 190);
});
const title = mesh(new THREE.PlaneGeometry(36, 36 * 560 / 2048), new THREE.MeshBasicMaterial({ map: titleTex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
title.position.copy(TITLE_POS); title.userData.noShadow = true; title.renderOrder = 10; title.visible = !reduced; scene.add(title);

// Ben -----------------------------------------------------------------------------------------
const ben = new THREE.Group();
const benParts = (() => {
  const hipL = new THREE.Group(), hipR = new THREE.Group(), shL = new THREE.Group(), shR = new THREE.Group(), torso = new THREE.Group(), head = new THREE.Group();
  hipL.position.set(-0.12, 0.52, 0); hipR.position.set(0.12, 0.52, 0);
  for (const hip of [hipL, hipR]) { hip.add(mesh(box(0.17, 0.46, 0.2), lam(C.trousers), 0, -0.23, 0)); hip.add(mesh(box(0.19, 0.1, 0.28), lam(C.ink), 0, -0.47, 0.04)); }
  torso.position.y = 0.52; ben.add(torso);
  torso.add(mesh(cyl(0.24, 0.28, 0.58, 8), lam(C.jumper), 0, 0.3, 0));
  torso.add(mesh(cyl(0.12, 0.13, 0.08, 8), lam(0xc23f2e), 0, 0.61, 0));
  shL.position.set(-0.31, 0.54, 0); shR.position.set(0.31, 0.54, 0);
  for (const sh of [shL, shR]) { sh.add(mesh(box(0.13, 0.42, 0.15), lam(C.jumper), 0, -0.19, 0)); sh.add(mesh(new THREE.IcosahedronGeometry(0.075, 0), lam(C.skin), 0, -0.43, 0)); torso.add(sh); }
  head.position.y = 0.84; torso.add(head);
  head.add(mesh(new THREE.IcosahedronGeometry(0.25, 1), lam(C.skin), 0, 0.12, 0));
  const hair = mesh(new THREE.SphereGeometry(0.265, 9, 6, 0, TAU, 0, Math.PI * 0.52), lam(C.hair), 0, 0.15, -0.03); hair.rotation.x = -0.3; head.add(hair);
  for (const s of [-1, 1]) head.add(mesh(box(0.045, 0.07, 0.03), lam(C.ink), s * 0.085, 0.14, 0.235));
  head.add(mesh(box(0.06, 0.06, 0.05), lam(0xe9a987), 0, 0.08, 0.25));
  ben.add(hipL, hipR);
  return { hipL, hipR, shL, shR, torso, head };
})();
ben.scale.setScalar(1.15);
scene.add(ben);
const benPos = SPOT.start.clone();
let benYaw = Math.PI; // facing north, into the island
ben.position.set(benPos.x, H(benPos.x, benPos.y), benPos.y);

// Target marker
const marker = mesh(new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfffaf1, transparent: true, opacity: 0, depthWrite: false }));
marker.userData.noShadow = true; scene.add(marker);

// Shadows on everything solid
scene.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh || o === terrain || o === water || o === sky || o.userData.noShadow) return;
  if (!o.userData.noShadowCast) m.castShadow = true;
  m.receiveShadow = !o.userData.cloud;
});

// Post-processing: a soft tilt-shift ----------------------------------------------------------------
const TiltShader = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uFocus: { value: 0.46 }, uBand: { value: 0.12 }, uAmount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uFocus; uniform float uBand; uniform float uAmount; varying vec2 vUv;
    void main(){ float k = smoothstep(uBand, uBand + 0.42, abs(vUv.y - uFocus)) * uAmount; vec2 o = uDir * k;
      vec4 s = texture2D(tDiffuse, vUv) * 0.227;
      s += (texture2D(tDiffuse, vUv + o*1.38) + texture2D(tDiffuse, vUv - o*1.38)) * 0.316;
      s += (texture2D(tDiffuse, vUv + o*3.23) + texture2D(tDiffuse, vUv - o*3.23)) * 0.0703;
      gl_FragColor = s; }`,
};
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const tiltH = new ShaderPass(TiltShader), tiltV = new ShaderPass(TiltShader);
composer.addPass(tiltH); composer.addPass(tiltV); composer.addPass(new OutputPass());

let W = 1, Hh = 1;
function resize() {
  W = innerWidth; Hh = innerHeight;
  renderer.setSize(W, Hh, false);
  composer.setPixelRatio(DPR); composer.setSize(W, Hh);
  camera.aspect = W / Hh; camera.updateProjectionMatrix();
  title.scale.setScalar(clamp(camera.aspect * 1.05, 0.52, 1));
  const px = W < 600 ? 1.7 : 2.4;
  tiltH.uniforms.uDir.value.set(px / W, 0); tiltV.uniforms.uDir.value.set(0, px / Hh);
  const s = W < 600 ? 104 : 148;
  mapEl.width = s * DPR; mapEl.height = s * DPR; mapEl.style.width = mapEl.style.height = s + 'px';
}
addEventListener('resize', resize);
resize();

// Camera rig ------------------------------------------------------------------------------------------
let yaw = 0, pitch = 0.66, dist = 34;
let yawT = yaw, pitchT = pitch, distT = dist;
const focus = new THREE.Vector3(ben.position.x, ben.position.y + 0.9, ben.position.z);
const camOffset = (y: number, p: number, d: number, out = new THREE.Vector3()) => out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(d);
const distScale = () => (camera.aspect < 0.8 ? 1.45 : camera.aspect < 1.2 ? 1.2 : 1);

// Intro fly-in
let intro = reduced ? 1 : 0, introSpeed = 1;
const INTRO_DUR = 5.2;
const P0 = new THREE.Vector3(0, 24, 86);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
function introPose(k: number) {
  const end = tmpB.copy(focus).add(camOffset(yaw, pitch, dist * distScale()));
  const mid = tmpC.set(end.x * 0.5, 30, (P0.z + end.z) * 0.5 + 6);
  const e = ease(k);
  // quadratic bezier
  const a = tmpA.copy(P0).lerp(mid, e), b = mid.clone().lerp(end, e);
  camera.position.copy(a.lerp(b, e));
  const lk = smooth(0.12, 0.85, k);
  const target = TITLE_POS.clone().lerp(focus, lk);
  camera.lookAt(target);
}

// Input ---------------------------------------------------------------------------------------------
const keys = new Set<string>();
const joy = new THREE.Vector2();
let walkTo: V2 | null = null;
let walkLm: Landmark | null = null;
let interacted = false;
function firstInteract() {
  if (interacted) return; interacted = true;
  if (intro < 1) introSpeed = 3.5;
  setTimeout(() => hintEl.classList.add('gone'), 2500);
}
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && guideOpen()) { setGuide(false); guideBtn.focus(); return; }
  if (guideOpen() && (e.target as HTMLElement)?.closest?.('#guide')) return;
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) {
    keys.add(k); firstInteract();
    if (k.startsWith('arrow')) e.preventDefault();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
let dragging = false, pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); dragging = true; }
  firstInteract();
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) { if (!coarse) hoverCheck(e); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchD > 0) distT = clamp(distT * (pinchD / d), 16, 60); pinchD = d; return;
  }
  if (!dragging && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 7) { dragging = true; canvas.classList.add('grabbing'); }
  if (dragging) { yawT -= dx * 0.006; pitchT = clamp(pitchT + dy * 0.004, 0.28, 1.25); }
});
const endPointer = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  pointers.delete(e.pointerId);
  if (!dragging && e.type === 'pointerup') clickAt(e.clientX, e.clientY);
  if (pointers.size === 0) { dragging = false; pinchD = 0; canvas.classList.remove('grabbing'); }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); distT = clamp(distT * (1 + e.deltaY * 0.0012), 16, 60); firstInteract(); }, { passive: false });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pickables = [terrain, ...landmarks.map((l) => l.root)];
function pick(x: number, y: number) {
  ndc.set((x / W) * 2 - 1, -(y / Hh) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(pickables, true);
}
function landmarkOf(o: THREE.Object3D) { const id = o.userData.lm; return id ? landmarks.find((l) => l.place.id === id) ?? null : null; }
function clickAt(x: number, y: number) {
  if (intro < 1) return;
  const hits = pick(x, y);
  for (const h of hits) {
    const lm = landmarkOf(h.object);
    if (lm) { goTo(lm); return; }
    if (h.object === terrain) { setTarget(new THREE.Vector2(h.point.x, h.point.z)); return; }
  }
  const pt = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) setTarget(new THREE.Vector2(pt.x, pt.z));
}
let lastHover = 0;
function hoverCheck(e: PointerEvent) {
  const now = performance.now(); if (now - lastHover < 90) return; lastHover = now;
  const hits = pick(e.clientX, e.clientY);
  canvas.classList.toggle('pointing', !!(hits[0] && landmarkOf(hits[0].object)));
}
function walkable(p: V2) {
  const d = Math.hypot(p.x, p.y), R = shoreR(Math.atan2(p.y, p.x)) * 0.965;
  if (d > R) p.multiplyScalar(R / d);
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.y - c.z, dd = Math.hypot(dx, dz), m = c.r + 0.32;
    if (dd < m) { if (dd < 1e-4) p.x += m; else { p.x = c.x + (dx / dd) * m; p.y = c.z + (dz / dd) * m; } }
  }
  return p;
}
function setTarget(p: V2, lm: Landmark | null = null) {
  walkTo = walkable(p); walkLm = lm;
  marker.position.set(walkTo.x, H(walkTo.x, walkTo.y) + 0.06, walkTo.y);
  (marker.material as THREE.MeshBasicMaterial).opacity = 0.9; marker.scale.setScalar(1.4);
}
function goTo(lm: Landmark) {
  const dir = new THREE.Vector2(benPos.x - lm.pos.x, benPos.y - lm.pos.z);
  if (dir.lengthSq() < 0.01) dir.set(0, 1);
  dir.normalize().multiplyScalar(lm.clear);
  setTarget(new THREE.Vector2(lm.pos.x + dir.x, lm.pos.z + dir.y), lm);
}

// Joystick
let joyId = -1;
const joyMove = (e: PointerEvent) => {
  const r = joyEl.getBoundingClientRect(); const R = r.width / 2;
  const v = new THREE.Vector2(e.clientX - (r.left + R), e.clientY - (r.top + R));
  if (v.length() > R * 0.8) v.setLength(R * 0.8);
  knobEl.style.transform = `translate(${v.x}px, ${v.y}px)`;
  joy.set(v.x / (R * 0.8), -v.y / (R * 0.8));
};
joyEl.addEventListener('pointerdown', (e) => { joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyEl.classList.add('on'); joyMove(e); firstInteract(); e.preventDefault(); });
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = (e: PointerEvent) => { if (e.pointerId !== joyId) return; joyId = -1; joy.set(0, 0); knobEl.style.transform = ''; joyEl.classList.remove('on'); };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);

// Minimap: click a dot to walk there
const mapScale = (s: number) => s / 2 / 31;
mapEl.addEventListener('click', (e) => {
  const r = mapEl.getBoundingClientRect(); const k = mapScale(r.width);
  const x = (e.clientX - r.left - r.width / 2) / k, z = (e.clientY - r.top - r.height / 2) / k;
  let best: Landmark | null = null, bd = 4.5;
  for (const l of landmarks) { const d = Math.hypot(l.pos.x - x, l.pos.z - z); if (d < bd) { bd = d; best = l; } }
  firstInteract();
  if (best) goTo(best); else setTarget(new THREE.Vector2(x, z));
});
const mctx = mapEl.getContext('2d')!;
function drawMap() {
  const s = mapEl.width; const k = mapScale(s); const c = s / 2;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, s, s);
  mctx.save(); mctx.beginPath(); mctx.arc(c, c, c - 1, 0, TAU); mctx.clip();
  mctx.fillStyle = '#7fd3d6'; mctx.fillRect(0, 0, s, s);
  const shape = (t: number) => { mctx.beginPath(); for (let i = 0; i <= 72; i++) { const a = (i / 72) * TAU, r = shoreR(a) * t * k; mctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); } mctx.closePath(); };
  shape(1.04); mctx.fillStyle = '#ffffff'; mctx.fill();
  shape(1.0); mctx.fillStyle = '#f2d39c'; mctx.fill();
  shape(0.86); mctx.fillStyle = '#9fce62'; mctx.fill();
  mctx.beginPath(); mctx.arc(c + HILL.x * k, c + HILL.y * k, 5.2 * k, 0, TAU); mctx.fillStyle = '#82b956'; mctx.fill();
  for (const l of landmarks) {
    const active = l === activeLm;
    mctx.beginPath(); mctx.arc(c + l.pos.x * k, c + l.pos.z * k, (active ? 4.2 : 3.2) * DPR, 0, TAU);
    mctx.fillStyle = l.place.color; mctx.fill(); mctx.lineWidth = 1.5 * DPR; mctx.strokeStyle = '#fffaf1'; mctx.stroke();
  }
  // view cone + Ben
  const bx = c + benPos.x * k, bz = c + benPos.y * k;
  const va = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  mctx.beginPath(); mctx.moveTo(bx, bz);
  mctx.arc(bx, bz, 26 * DPR, va - 0.5, va + 0.5);
  mctx.closePath(); mctx.fillStyle = 'rgba(255,250,241,0.4)'; mctx.fill();
  mctx.save(); mctx.translate(bx, bz); mctx.rotate(-benYaw + Math.PI);
  mctx.beginPath(); mctx.moveTo(0, -5.5 * DPR); mctx.lineTo(4 * DPR, 4 * DPR); mctx.lineTo(-4 * DPR, 4 * DPR); mctx.closePath();
  mctx.fillStyle = '#2b2118'; mctx.fill(); mctx.restore();
  mctx.restore();
  mctx.font = `700 ${10 * DPR}px ${SANS}`; mctx.fillStyle = '#2b2118'; mctx.textAlign = 'center'; mctx.textBaseline = 'top';
  mctx.fillText('N', c, 5 * DPR);
}

// Guidebook -------------------------------------------------------------------------------------------
const guideOpen = () => guideEl.classList.contains('open');
function setGuide(open: boolean) {
  guideEl.classList.toggle('open', open);
  guideBtn.setAttribute('aria-expanded', String(open));
  if (open) (guideEl.querySelector('h2') as HTMLElement)?.focus();
}
guideBtn.addEventListener('click', () => setGuide(!guideOpen()));
guideEl.querySelector('.close')?.addEventListener('click', () => { setGuide(false); guideBtn.focus(); });
guideEl.addEventListener('focusin', () => { if (!guideOpen()) setGuide(true); });
guideEl.querySelectorAll<HTMLButtonElement>('[data-walk]').forEach((b) => b.addEventListener('click', () => {
  const lm = landmarks.find((l) => l.place.id === b.dataset.walk); if (!lm) return;
  setGuide(false); firstInteract(); intro = 1; goTo(lm);
}));

// Signboard -------------------------------------------------------------------------------------------
let activeLm: Landmark | null = null;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pretty = (url: string) => url.replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
function fillCard(lm: Landmark) {
  const p = lm.place;
  cardEl.style.setProperty('--accent', p.color);
  let body = '';
  if (p.id === 'bottle') {
    const [mail, ...soc] = p.items;
    body = `<h2>Say hello</h2><p class="blurb">${esc(p.plaque)}</p>
      <a class="go big" href="${esc(mail.url)}">${esc(mail.name)}</a>
      <p class="socials">${soc.map((s) => `<a href="${esc(s.url)}">${esc(s.name)} <span>${esc(s.blurb)}</span></a>`).join('')}</p>`;
  } else {
    body = p.items.map((it) => `<div class="item"><h2>${esc(it.name)}</h2><p class="blurb">${esc(it.blurb.charAt(0).toUpperCase() + it.blurb.slice(1))}.</p><a class="go" href="${esc(it.url)}">${esc(pretty(it.url))} <span aria-hidden="true">↗</span></a></div>`).join('')
      + `<p class="plaque">${esc(p.plaque)}</p>`;
  }
  cardEl.innerHTML = `<p class="kicker">${esc(p.place)}${p.id === 'lighthouse' ? ' · <b>Now</b>' : ''}</p>${body}`;
}
let cardShown = false;
function updateCard() {
  let best: Landmark | null = null, bd = Infinity;
  for (const l of landmarks) {
    const d = Math.hypot(benPos.x - l.pos.x, benPos.y - l.pos.z);
    const r = l === activeLm ? l.radius + 1.2 : l.radius;
    if (d < r && d < bd) { bd = d; best = l; }
  }
  if (intro < 1) best = null;
  if (best !== activeLm) {
    activeLm = best;
    if (best) { fillCard(best); cardEl.classList.add('show'); cardShown = true; }
    else { cardEl.classList.remove('show'); cardShown = false; }
  }
  if (cardShown && activeLm) {
    const v = activeLm.anchor.clone().project(camera);
    if (v.z > 1) { cardEl.style.opacity = '0'; return; }
    cardEl.style.opacity = '';
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * Hh;
    const cw = cardEl.offsetWidth, ch = cardEl.offsetHeight;
    const left = clamp(x - cw / 2, 12, W - cw - 12), top = clamp(y - ch - 18, 64, Hh - ch - (W < 600 ? 150 : 16));
    cardEl.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    cardEl.style.setProperty('--stem', `${clamp(x - left, 24, cw - 24).toFixed(1)}px`);
    cardEl.classList.toggle('nostem', y - ch - 18 < 64 || y - 18 > Hh - (W < 600 ? 150 : 16));
  }
}

// Speech bubble
let bubbleT = -1;
function updateBubble(dt: number) {
  if (bubbleT < 0) return;
  bubbleT += dt;
  if (bubbleT > 4.2) { bubbleEl.classList.remove('show'); bubbleT = -1; return; }
  const v = new THREE.Vector3(ben.position.x, ben.position.y + 2.2, ben.position.z).project(camera);
  bubbleEl.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * Hh).toFixed(1)}px, 0) translate(-50%, -100%)`;
}

// Ben update ----------------------------------------------------------------------------------------
const SPEED = 5.6;
let walkPhase = 0, speedNow = 0, wave = -1, stuckT = 0;
function updateBen(dt: number, t: number) {
  const fwd = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw));
  const right = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
  let ix = joy.x, iz = joy.y;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('w') || keys.has('arrowup')) iz += 1;
  if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
  if (keys.has('q')) yawT += dt * 1.6;
  if (keys.has('e')) yawT -= dt * 1.6;
  const move = new THREE.Vector2();
  let sp = 0;
  if (intro >= 1 && (ix * ix + iz * iz) > 0.02) {
    walkTo = null; walkLm = null;
    move.addScaledVector(right, ix).addScaledVector(fwd, iz);
    sp = Math.min(1, move.length()) * SPEED; move.normalize();
  } else if (walkTo) {
    move.subVectors(walkTo, benPos); const d = move.length();
    if (d < 0.2) { walkTo = null; if (walkLm) { const l = walkLm; walkLm = null; benYawT = Math.atan2(l.pos.x - benPos.x, l.pos.z - benPos.y); } }
    else { sp = SPEED * Math.min(1, d / 1.2 + 0.35); move.divideScalar(d); }
  }
  speedNow = damp(speedNow, sp, 12, dt);
  if (speedNow > 0.05 && move.lengthSq() > 0) {
    const before = benPos.clone();
    benPos.addScaledVector(move, speedNow * dt);
    walkable(benPos);
    const moved = benPos.distanceTo(before);
    if (walkTo && moved < speedNow * dt * 0.25) { stuckT += dt; if (stuckT > 0.6) { walkTo = null; walkLm = null; stuckT = 0; } } else stuckT = 0;
    benYawT = Math.atan2(move.x, move.y);
    hintEl.classList.add('gone');
  }
  benYaw += angDiff(benYaw, benYawT) * (1 - Math.exp(-12 * dt));
  ben.rotation.y = benYaw;
  const gy = H(benPos.x, benPos.y);
  walkPhase += dt * speedNow * 2.3;
  const sw = Math.sin(walkPhase) * clamp(speedNow / SPEED, 0, 1);
  benParts.hipL.rotation.x = sw * 0.8; benParts.hipR.rotation.x = -sw * 0.8;
  benParts.shL.rotation.x = -sw * 0.7; benParts.shR.rotation.x = sw * 0.7;
  benParts.shL.rotation.z = 0; benParts.shR.rotation.z = 0;
  const bob = Math.abs(Math.cos(walkPhase)) * 0.08 * clamp(speedNow / SPEED, 0, 1) + Math.sin(t * 2) * 0.012;
  ben.position.set(benPos.x, Math.max(gy, -0.05) + bob, benPos.y);
  benParts.torso.rotation.x = clamp(speedNow / SPEED, 0, 1) * 0.12;
  benParts.head.rotation.y = speedNow < 0.3 ? Math.sin(t * 0.6) * 0.25 : 0;
  if (wave >= 0) {
    wave += dt;
    const k = Math.sin(clamp(wave / 2.4, 0, 1) * Math.PI);
    benParts.shR.rotation.z = k * 2.6; benParts.shR.rotation.x = 0;
    benParts.shR.rotation.y = 0; benParts.shR.children[0].rotation.z = 0;
    benParts.shR.rotation.z += Math.sin(wave * 14) * 0.25 * k;
    if (wave > 2.4) wave = -1;
  }
  // marker fade
  const mm = marker.material as THREE.MeshBasicMaterial;
  if (!walkTo) mm.opacity = damp(mm.opacity, 0, 6, dt);
  marker.scale.setScalar(damp(marker.scale.x, 1, 6, dt));
}
let benYawT = benYaw;

// Loop ------------------------------------------------------------------------------------------------
let last = performance.now();
let time = 0, raf = 0, introDone = false, lhBoost = 0;
function frame() {
  raf = requestAnimationFrame(frame);
  const nowT = performance.now(); const dt = Math.min((nowT - last) / 1000, 0.05); last = nowT;
  time += dt;
  updateBen(dt, time);
  // camera
  yaw = damp(yaw, yawT, 8, dt); pitch = damp(pitch, pitchT, 8, dt); dist = damp(dist, distT, 6, dt);
  focus.x = damp(focus.x, ben.position.x, 5, dt); focus.z = damp(focus.z, ben.position.z, 5, dt); const tall = activeLm?.place.id === 'lighthouse' ? 1 : 0;
  lhBoost = damp(lhBoost, tall, 2, dt);
  focus.y = damp(focus.y, ben.position.y + 0.9 + lhBoost * 3.5, 3, dt);
  if (intro < 1) {
    intro = Math.min(1, intro + (dt * introSpeed) / INTRO_DUR);
    if (intro < 1) introPose(intro);
    tiltH.uniforms.uAmount.value = tiltV.uniforms.uAmount.value = smooth(0.55, 1, intro);
    (title.material as THREE.MeshBasicMaterial).opacity = 1 - smooth(0.45, 0.8, intro);
  }
  if (intro >= 1) {
    if (!introDone) {
      introDone = true; title.visible = false;
      wave = 0;
      bubbleEl.classList.add('show'); bubbleT = 0;
      hintEl.classList.add('show');
    }
    const off = camOffset(yaw, pitch - lhBoost * 0.08, dist * distScale() * (1 + lhBoost * 0.22));
    camera.position.copy(focus).add(off);
    const ground = H(camera.position.x, camera.position.z);
    if (camera.position.y < ground + 1.5) camera.position.y = ground + 1.5;
    camera.lookAt(focus);
    tiltH.uniforms.uAmount.value = tiltV.uniforms.uAmount.value = 1;
  }
  sky.position.copy(camera.position);
  for (const a of anims) a(dt, time);
  waterUniforms.uTime.value = time;
  updateCard();
  updateBubble(dt);
  composer.render();
  drawMap();
}
function startLoop() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }
document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));
if (reduced) { tiltH.uniforms.uAmount.value = tiltV.uniforms.uAmount.value = 1; }
startLoop();
document.documentElement.classList.add('ready');
hintEl.innerHTML = coarse
  ? 'Use the stick to walk · tap the ground to go there · drag to look around'
  : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk · click to go there · drag to look around';

// Fonts arrive -> redraw the canvas textures
Promise.race([
  Promise.all([document.fonts.load(`900 100px ${DISPLAY}`), document.fonts.load(`800 50px ${DISPLAY}`), document.fonts.load(`700 50px ${SANS}`), document.fonts.load(`500 50px ${SANS}`), document.fonts.load(`500 50px ${MONO}`)]),
  new Promise((r) => setTimeout(r, 2500)),
]).then(() => redraws.forEach((r) => r()));

// expose for tests
(window as any).__island = { landmarks, benPos, goTo, setTarget: (x: number, z: number) => setTarget(new THREE.Vector2(x, z)), skip: () => { intro = 1; } };
