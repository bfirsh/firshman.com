// Unfold: a voxel puzzle box. Spin it, twist its slices, tap a face and it
// peels open into a little diorama.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SECTIONS, FACE_SECTION } from './sections';
import { figure, word, LAYOUT, EMBLEM, textWidth, F as FC, PL, IN, CR, INK, GD, GL, type Anim } from './models';
import { Sound } from './audio';

// ---------------------------------------------------------------- setup

const qs = new URLSearchParams(location.search);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
let seed = parseInt(qs.get('seed') || '', 10);
if (!Number.isFinite(seed) || seed <= 0) seed = 1 + Math.floor(Math.random() * 9999);
const rand = (() => {
  let a = seed * 2654435761 >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const jr = Math.random; // non-seeded jitter for motion only

type Pal = { name: string; faces: string[]; plastic: string; inner: string; cream: string; ink: string; gold: string; glow: string; bgTop: string; bgBot: string; spot: string; shadow: string; dark: boolean };
const PALETTES: Pal[] = [
  { name: 'jewel', faces: ['#118a68', '#2251b5', '#c0263f', '#e5a82a', '#7444ad', '#e9e1d3'], plastic: '#1a1720', inner: '#5a1a36', cream: '#f2e9d8', ink: '#141118', gold: '#e8b860', glow: '#ffd59a', bgTop: '#3a3640', bgBot: '#121015', spot: '#4d4552', shadow: '#000000', dark: true },
  { name: 'sorbet', faces: ['#f4987a', '#86d0bb', '#ae9be6', '#f2cf63', '#ec8299', '#7db8ea'], plastic: '#f6f0e8', inner: '#c86f80', cream: '#fffaf2', ink: '#43354a', gold: '#e6a944', glow: '#fff0c4', bgTop: '#f7e8dd', bgBot: '#e2c4b5', spot: '#fff6ee', shadow: '#5a3a3a', dark: false },
  { name: 'kyoto', faces: ['#d2462a', '#253a78', '#87a043', '#f0b0bb', '#d9a038', '#2f8c86'], plastic: '#f2ece1', inner: '#8c2a1e', cream: '#fcf7ee', ink: '#1e1b22', gold: '#c99634', glow: '#ffe1a4', bgTop: '#ebe3d4', bgBot: '#c9bba4', spot: '#fbf6ec', shadow: '#3c2e22', dark: false },
  { name: 'nocturne', faces: ['#16b5a7', '#d6398c', '#3a7ae4', '#f2b53a', '#8058e6', '#e7e3f0'], plastic: '#1b1f2e', inner: '#3b2a78', cream: '#eeeaf7', ink: '#0c0e17', gold: '#f2c35b', glow: '#a6f4ff', bgTop: '#232a4c', bgBot: '#07080f', spot: '#36407a', shadow: '#000000', dark: true },
  { name: 'riso', faces: ['#ff5a88', '#2d68ff', '#ffd23c', '#00a88e', '#ff7a2c', '#8c5aff'], plastic: '#f8f5ef', inner: '#ff8fa8', cream: '#ffffff', ink: '#1c1b21', gold: '#ffb000', glow: '#fff3ad', bgTop: '#e3e9f3', bgBot: '#b6c0d4', spot: '#f8faff', shadow: '#1d2440', dark: false },
  { name: 'earth', faces: ['#c4613b', '#d8a240', '#8db69f', '#4c6c91', '#e6d5b8', '#7c4763'], plastic: '#2c2622', inner: '#6a2e26', cream: '#f2e7d4', ink: '#1a1613', gold: '#dcab57', glow: '#ffd7a0', bgTop: '#433a33', bgBot: '#16120f', spot: '#5a4d42', shadow: '#000000', dark: true },
];
const MATERIALS = ['lacquer', 'ceramic', 'frosted', 'anodised'] as const;
type Lit = { name: string; dir: [number, number, number]; color: string; key: number; env: number; hemiSky: string; hemiGround: string; hemi: number };
const LIGHTS: Lit[] = [
  { name: 'studio', dir: [-0.55, 1, 0.65], color: '#fff4e6', key: 2.4, env: 0.85, hemiSky: '#ffffff', hemiGround: '#8c8078', hemi: 0.35 },
  { name: 'golden', dir: [0.9, 0.55, 0.45], color: '#ffcf98', key: 2.9, env: 0.6, hemiSky: '#ffe0bc', hemiGround: '#4a5a8a', hemi: 0.45 },
  { name: 'north', dir: [-0.25, 1, 0.25], color: '#e8f0ff', key: 1.9, env: 1.1, hemiSky: '#dfe9ff', hemiGround: '#8a7f70', hemi: 0.3 },
  { name: 'dusk', dir: [0.75, 0.45, -0.55], color: '#ff9f72', key: 3.2, env: 0.7, hemiSky: '#9fb4ff', hemiGround: '#40263a', hemi: 0.6 },
];

const palIdx = qs.get('pal') ? PALETTES.findIndex((p) => p.name === qs.get('pal')) : -1;
const PAL = palIdx >= 0 ? PALETTES[palIdx] : pick(PALETTES);
const MAT = (MATERIALS as readonly string[]).includes(qs.get('mat') || '') ? (qs.get('mat') as string) : pick([...MATERIALS]);
const LIT = LIGHTS.find((l) => l.name === qs.get('light')) || pick(LIGHTS);

const SLOT: THREE.Color[] = [...PAL.faces, PAL.plastic, PAL.inner, PAL.cream, PAL.ink, PAL.gold, PAL.glow].map((h) => new THREE.Color(h));

// ---------------------------------------------------------------- dom

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const root = document.documentElement;
const hint = document.getElementById('hint')!;
const panelWrap = document.getElementById('panel')!;
const pips = [...document.querySelectorAll<HTMLButtonElement>('.pips button')];
const soundBtn = document.getElementById('sound') as HTMLButtonElement;
const doneMsg = document.getElementById('done')!;
const ed = document.getElementById('edition');
if (ed) ed.textContent = '№ ' + String(seed).padStart(4, '0');
root.style.setProperty('--accent', PAL.gold);
root.style.setProperty('--bg', PAL.bgBot);
root.classList.toggle('lightbg', !PAL.dark);
pips.forEach((b) => {
  const s = b.dataset.sec!;
  const d = FACE_SECTION.indexOf(s);
  b.style.setProperty('--c', PAL.faces[d]);
});

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  if (!renderer.getContext()) throw new Error('no gl');
} catch (e) {
  root.classList.add('nogl');
  throw e;
}
const isPhone = Math.min(innerWidth, innerHeight) < 600;
let dprCap = isPhone ? 1.5 : 1.75;
let dpr = Math.min(devicePixelRatio || 1, dprCap);
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = PAL.dark ? 1.05 : 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 1, 600);
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), PAL.dark ? 0.26 : 0.22, 0.5, PAL.dark ? 0.98 : 1.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = LIT.env * 0.32;

// backdrop: a full-screen studio sweep, drawn first
const bgMat = new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: {
    top: { value: new THREE.Color(PAL.bgTop) },
    bot: { value: new THREE.Color(PAL.bgBot) },
    spot: { value: new THREE.Color(PAL.spot) },
    res: { value: new THREE.Vector2(1, 1) },
    center: { value: new THREE.Vector2(0.5, 0.55) },
    time: { value: 0 },
  },
  vertexShader: `void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: `
    uniform vec3 top, bot, spot; uniform vec2 res, center; uniform float time;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = gl_FragCoord.xy / res;
      float asp = res.x / res.y;
      // the sweep: wall above, floor below, a soft curve between
      float y = uv.y;
      float sweep = smoothstep(0.05, 0.85, y);
      vec3 c = mix(bot, top, sweep);
      vec2 d = (uv - center) * vec2(asp, 1.0);
      float r = length(d * vec2(0.8, 1.15));
      c = mix(c, spot, 0.85 * exp(-r * r * 3.2));
      // floor pool of light
      vec2 f = (uv - vec2(center.x, center.y - 0.42)) * vec2(asp * 0.55, 2.2);
      c = mix(c, spot, 0.35 * exp(-dot(f, f) * 2.0));
      float v = length((uv - 0.5) * vec2(asp, 1.0) * vec2(0.75, 1.0));
      c *= 1.0 - 0.28 * smoothstep(0.35, 1.05, v);
      c += (h(gl_FragCoord.xy + fract(time) * 97.0) - 0.5) * (1.5 / 255.0) * (0.3 + c);
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const bgQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
bgQuad.frustumCulled = false;
bgQuad.renderOrder = -10;
scene.add(bgQuad);

// a soft contact shadow pooled on the sweep under the floating box
const blobMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { col: { value: new THREE.Color(PAL.shadow) }, k: { value: PAL.dark ? 0.75 : 0.4 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 col; uniform float k; varying vec2 vUv;
    void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 4.5) * k; gl_FragColor = vec4(col, a); }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), blobMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -27;
scene.add(floor);

const key = new THREE.DirectionalLight(LIT.color, LIT.key * 1.5);
const keyDir = new THREE.Vector3(...LIT.dir).normalize();
key.castShadow = true;
key.shadow.mapSize.set(isPhone ? 1024 : 2048, isPhone ? 1024 : 2048);
const sc = key.shadow.camera as THREE.OrthographicCamera;
sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 10; sc.far = 220;
key.shadow.radius = 5;
key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.04;
scene.add(key, key.target);
const hemi = new THREE.HemisphereLight(LIT.hemiSky, LIT.hemiGround, LIT.hemi * 0.6);
scene.add(hemi);
const rim = new THREE.DirectionalLight(PAL.dark ? '#9fb8ff' : '#ffffff', PAL.dark ? 0.9 : 0.5);
rim.position.set(-0.4, 0.3, -1).multiplyScalar(80);
scene.add(rim);

// ---------------------------------------------------------------- voxel geometry: a chamfered cube

function chamferBox(h: number, c: number) {
  const pos: number[] = [];
  const poly = (pts: THREE.Vector3[]) => {
    const cen = new THREE.Vector3();
    pts.forEach((p) => cen.add(p));
    cen.multiplyScalar(1 / pts.length);
    const n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
    if (n.dot(cen) < 0) pts.reverse();
    for (let i = 1; i < pts.length - 1; i++) for (const p of [pts[0], pts[i], pts[i + 1]]) pos.push(p.x, p.y, p.z);
  };
  const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
  const k = h - c;
  for (let ax = 0; ax < 3; ax++)
    for (const s of [-1, 1]) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3;
      const q: THREE.Vector3[] = [];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = [0, 0, 0];
        a[ax] = s * h; a[u] = su * k; a[v] = sv * k;
        q.push(V(a));
      }
      poly(q);
    }
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      const w = 3 - a - b;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const q: THREE.Vector3[] = [];
          for (const [ea, eb, sw] of [[h, k, -1], [h, k, 1], [k, h, 1], [k, h, -1]]) {
            const p = [0, 0, 0];
            p[a] = sa * ea; p[b] = sb * eb; p[w] = sw * k;
            q.push(V(p));
          }
          poly(q);
        }
    }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        poly([V([sx * h, sy * k, sz * k]), V([sx * k, sy * h, sz * k]), V([sx * k, sy * k, sz * h])]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the box

const NV = 8; // voxels per cubie edge
const CUB = NV + 0.22; // cubie spacing
const HALF = CUB + NV / 2; // outer surface
const CELL = 0.5; // diorama voxel size
const FIG_SCALE: Record<string, number> = { now: 0.8, play: 0.64, hello: 0.56 };

const DIRS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const dirIndex = (v: THREE.Vector3) => {
  let best = 0, bd = -2;
  DIRS.forEach((d, i) => { const k = d.dot(v); if (k > bd) { bd = k; best = i; } });
  return best;
};

type Cubie = { pos: number[]; m: number[]; q: THREE.Quaternion };
const cubies: Cubie[] = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (!x && !y && !z) continue;
  cubies.push({ pos: [x, y, z], m: [1, 0, 0, 0, 1, 0, 0, 0, 1], q: new THREE.Quaternion() });
}

// face up/right vectors for emblem orientation
const faceUp = (d: number) => (d === 2 ? new THREE.Vector3(0, 0, -1) : d === 3 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));

const vCub: number[] = [];
const vOff: number[] = [];
const vCol: number[] = [];
const vInner: number[] = []; // 1 if not on any outside face (a compartment wall)
const vLining: number[] = []; // 1 for the lining layer under an outside face
const tmpC = new THREE.Color();
cubies.forEach((cb, ci) => {
  const centerDir = Math.abs(cb.pos[0]) + Math.abs(cb.pos[1]) + Math.abs(cb.pos[2]) === 1 ? dirIndex(new THREE.Vector3(...cb.pos)) : -1;
  for (let vx = 0; vx < NV; vx++) for (let vy = 0; vy < NV; vy++) for (let vz = 0; vz < NV; vz++) {
    const v = [vx, vy, vz];
    const shell = v.some((k) => k === 0 || k === NV - 1);
    // a second, lining layer just under each outside face
    let lining = false;
    for (let a = 0; a < 3; a++) if ((cb.pos[a] === 1 && v[a] === NV - 2) || (cb.pos[a] === -1 && v[a] === 1)) lining = true;
    if (!shell && !lining) continue;
    const ext: number[] = [];
    for (let a = 0; a < 3; a++) {
      if (cb.pos[a] === 1 && v[a] === NV - 1) ext.push(a * 2);
      if (cb.pos[a] === -1 && v[a] === 0) ext.push(a * 2 + 1);
    }
    const off = [vx - 3.5, vy - 3.5, vz - 3.5];
    let slot = IN, emboss = 0, jitter = 0.03;
    if (ext.length >= 2) slot = PL;
    else if (ext.length === 1) {
      const d = ext[0];
      const ax = d >> 1;
      const inPlane = [0, 1, 2].filter((k) => k !== ax);
      const isSticker = inPlane.every((k) => v[k] >= 1 && v[k] <= NV - 2);
      if (!isSticker) slot = PL;
      else {
        slot = FC[d];
        emboss = 0.07;
        if (centerDir === d) {
          const n = DIRS[d], up = faceUp(d), right = new THREE.Vector3().crossVectors(up, n);
          const o = new THREE.Vector3(...off);
          const col = Math.round(o.dot(right) + 2.5), row = Math.round(2.5 - o.dot(up));
          const sec = FACE_SECTION[d];
          if (EMBLEM[sec][row]?.[col] === '#') {
            slot = CR;
            emboss = 0.26;
            const fc = SLOT[FC[d]];
            const lum = fc.r * 0.3 + fc.g * 0.6 + fc.b * 0.1;
            if (lum > 0.55) slot = INK;
          }
        }
        const sign = d % 2 === 0 ? 1 : -1;
        off[ax] += sign * emboss;
      }
    }
    if (slot === PL || slot === IN) jitter = 0.015;
    vCub.push(ci);
    vOff.push(off[0], off[1], off[2]);
    tmpC.copy(SLOT[slot]);
    const j = 1 + (jr() - 0.5) * 2 * jitter;
    vCol.push(tmpC.r * j, tmpC.g * j, tmpC.b * j);
    vInner.push(ext.length === 0 ? 1 : 0);
    vLining.push(shell ? 0 : 1);
  }
});
const NC = vCub.length;

// diorama pool: big enough for any section
type PoolSpec = { pts: number[]; cols: number[]; glow: number[]; fig: number[]; cy: number[]; anim: number[] };
const figCache = new Map<string, ReturnType<typeof figure>>();
const getFig = (n: string) => { if (!figCache.has(n)) figCache.set(n, figure(n)); return figCache.get(n)!; };
let POOL = 0;
for (const s of SECTIONS) {
  let n = word(s.word, GD).cells.length;
  for (const it of s.items) n += getFig(it.fig).cells.length;
  POOL = Math.max(POOL, n);
}
const titleLines = () => (innerWidth / innerHeight < 1.1 ? ['BEN', 'FIRSHMAN'] : ['BEN FIRSHMAN']);
POOL = Math.max(POOL, word('BEN FIRSHMAN', GD).cells.length + 10);
const NT = NC + POOL;

const geo = chamferBox(0.47, 0.11);
const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(NT), 1);
glowAttr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('aGlow', glowAttr);

function makeMaterial() {
  const common = { color: 0xffffff, dithering: true } as THREE.MeshPhysicalMaterialParameters;
  let m: THREE.MeshPhysicalMaterial;
  if (MAT === 'lacquer') m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 0.6 });
  else if (MAT === 'ceramic') m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.62, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.18, sheen: 0.25, sheenRoughness: 0.4, sheenColor: new THREE.Color('#fff6ea') });
  else if (MAT === 'frosted') m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.62, metalness: 0, transmission: 0.9, thickness: 0.7, ior: 1.35, clearcoat: 0.5, clearcoatRoughness: 0.08, attenuationDistance: 3, attenuationColor: new THREE.Color('#ffffff') });
  else m = new THREE.MeshPhysicalMaterial({ ...common, roughness: 0.3, metalness: 0.92, clearcoat: 0.5, clearcoatRoughness: 0.12, iridescence: 0.35, iridescenceIOR: 1.7, iridescenceThicknessMinimum: 180, iridescenceThicknessMaximum: 520 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vGlow * 1.8 + ' + (MAT === 'frosted' ? '0.22' : '0.0') + ');');
  };
  return m;
}
const mat = makeMaterial();
const mesh = new THREE.InstancedMesh(geo, mat, NT);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false;
const colArr = new Float32Array(NT * 3);
colArr.set(vCol);
mesh.instanceColor = new THREE.InstancedBufferAttribute(colArr, 3);
mesh.count = NC;

const outer = new THREE.Group();
const inner = new THREE.Group();
outer.add(inner);
inner.add(mesh);
scene.add(outer);

const qCube = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, -0.62 + (rand() - 0.5) * 0.3, 0, 'YXZ'));
qCube.setFromEuler(new THREE.Euler(0.46, -0.64, 0, 'XYZ'));
{
  // tip it toward a classic three-quarter view: front, right and top visible
  const a = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.68 + (rand() - 0.5) * 0.2);
  const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
  qCube.copy(b).multiply(a);
}
outer.quaternion.copy(qCube);

// ---------------------------------------------------------------- instance writing

const M = mesh.instanceMatrix.array as Float32Array;
const G = glowAttr.array as Float32Array;
const curPos = new Float32Array(NC * 3);

function writeQ(i: number, px: number, py: number, pz: number, x: number, y: number, z: number, w: number, s: number) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const o = i * 16;
  M[o] = (1 - (yy + zz)) * s; M[o + 1] = (xy + wz) * s; M[o + 2] = (xz - wy) * s; M[o + 3] = 0;
  M[o + 4] = (xy - wz) * s; M[o + 5] = (1 - (xx + zz)) * s; M[o + 6] = (yz + wx) * s; M[o + 7] = 0;
  M[o + 8] = (xz + wy) * s; M[o + 9] = (yz - wx) * s; M[o + 10] = (1 - (xx + yy)) * s; M[o + 11] = 0;
  M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz; M[o + 15] = 1;
}

// ---------------------------------------------------------------- springs

function spr(t: number, z = 0.55, w = 10) {
  if (t <= 0) return 0;
  if (RM) { z = 1; w *= 0.8; }
  if (z >= 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------- twisting

const twist = { axis: 0, layer: 0, angle: 0, vel: 0, active: false, dragging: false, lastTickIdx: 0, crossed: true };
const sound = new Sound();

function rotInt(axis: number, k: number) {
  const c = Math.round(Math.cos((k * Math.PI) / 2)), s = Math.round(Math.sin((k * Math.PI) / 2));
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
const mul3 = (a: number[], b: number[]) => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const mv3 = (m: number[], v: number[]) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const m4 = new THREE.Matrix4();
function syncQ(cb: Cubie) {
  const m = cb.m;
  m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
  cb.q.setFromRotationMatrix(m4);
}

function solvedFaces() {
  const out: boolean[] = [];
  for (let d = 0; d < 6; d++) {
    const n = DIRS[d].toArray();
    let col = -1, ok = true;
    for (const cb of cubies) {
      if (cb.pos[0] * n[0] + cb.pos[1] * n[1] + cb.pos[2] * n[2] !== 1) continue;
      // original direction now pointing along n: m^T n
      const m = cb.m;
      const o = [m[0] * n[0] + m[3] * n[1] + m[6] * n[2], m[1] * n[0] + m[4] * n[1] + m[7] * n[2], m[2] * n[0] + m[5] * n[1] + m[8] * n[2]];
      const di = dirIndex(new THREE.Vector3(...o));
      if (col < 0) col = di; else if (col !== di) { ok = false; break; }
    }
    out.push(ok);
  }
  return out;
}
let solved = solvedFaces();

let movesSinceSolved = 0;
function commitTwist(axis: number, layer: number, k: number, user = true) {
  k = ((k % 4) + 4) % 4;
  if (!k) return;
  if (user) movesSinceSolved++;
  const R = rotInt(axis, k);
  for (const cb of cubies) {
    if (cb.pos[axis] !== layer) continue;
    cb.pos = mv3(R, cb.pos);
    cb.m = mul3(R, cb.m);
    syncQ(cb);
  }
  const now = solvedFaces();
  const newly = now.map((s, i) => s && !solved[i]);
  solved = now;
  // a face twisted into place unfolds by itself (only after some real scrambling)
  const m = movesSinceSolved;
  if (now.every(Boolean)) movesSinceSolved = 0;
  if (!user || m < 3) return;
  let d = -1, best = -2;
  newly.forEach((v, i) => {
    if (!v) return;
    const w = DIRS[i].clone().applyQuaternion(qCube);
    const sc = w.z + w.y * 0.3;
    if (sc > best) { best = sc; d = i; }
  });
  if (d >= 0 && state.mode === 'idle') {
    setTimeout(() => { if (state.mode === 'idle' && !twist.dragging) { celebrate(); openFace(d); } }, 560);
  }
}

function scriptedTwist(axis: number, layer: number, k: number, user = true) {
  if (twist.active && (twist.axis !== axis || twist.layer !== layer)) twist.angle = 0;
  twist.axis = axis; twist.layer = layer; twist.active = true;
  commitTwist(axis, layer, k, user);
  twist.angle += (-k * Math.PI) / 2;
  twist.vel = 0;
  twist.crossed = false;
  dirty = true;
}

// ---------------------------------------------------------------- state

type OpenInfo = {
  d: number; n: THREE.Vector3; u: THREE.Vector3; r: THREE.Vector3; sec: number;
  qFrom: THREE.Quaternion; qTo: THREE.Quaternion; t0: number; tClose: number;
  peel: { idx: number[]; cols: { items: { i: number; b: number; depth: number; dl: number; dc: number }[]; a: number }[] };
  innerIdx: number[];
  pool: { sc: Float32Array; S: Float32Array; E: Float32Array; dl: Float32Array; dc: Float32Array; lift: Float32Array; axis: Float32Array; spin: Float32Array; g: Float32Array; fig: Int16Array; anim: Int16Array; n: number };
  anims: { a: Anim; c: THREE.Vector3 }[];
  figs: { min: THREE.Vector3; max: THREE.Vector3; hop: number; noted: boolean; dl: number }[];
  pivotTo: THREE.Vector3;
};
const state = {
  mode: (RM ? 'idle' : 'intro') as 'intro' | 'idle' | 'opening' | 'open' | 'closing',
  open: null as OpenInfo | null,
  queued: -1,
  visited: new Set<string>(),
  interacted: false,
  introT0: 0,
  completeShown: false,
};
let dirty = true;
let T = 0; // seconds
let introClock = 0;
let introSpeed = 1;

const pivot = new THREE.Vector3();
const pivotFrom = new THREE.Vector3();
let openProg = 0; // 0..1 how "open" the camera framing is
let openProgFrom = 0, openProgTo = 0, openProgT0 = 0;
function setOpenProg(to: number) { openProgFrom = openProg; openProgTo = to; openProgT0 = T; }

// ---------------------------------------------------------------- open / close

const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion();

function sectionAt(d: number) {
  const n = DIRS[d].toArray();
  const cb = cubies.find((c) => c.pos[0] === n[0] && c.pos[1] === n[1] && c.pos[2] === n[2])!;
  const m = cb.m;
  const o = [m[0] * n[0] + m[3] * n[1] + m[6] * n[2], m[1] * n[0] + m[4] * n[1] + m[7] * n[2], m[2] * n[0] + m[5] * n[1] + m[8] * n[2]];
  const id = FACE_SECTION[dirIndex(new THREE.Vector3(...o))];
  return SECTIONS.findIndex((s) => s.id === id);
}

function computeCubePositions() {
  // positions with no twist (used when opening)
  for (let i = 0; i < NC; i++) {
    const cb = cubies[vCub[i]];
    const o = [vOff[i * 3], vOff[i * 3 + 1], vOff[i * 3 + 2]];
    const p = mv3(cb.m, o);
    curPos[i * 3] = cb.pos[0] * CUB + p[0];
    curPos[i * 3 + 1] = cb.pos[1] * CUB + p[1];
    curPos[i * 3 + 2] = cb.pos[2] * CUB + p[2];
  }
}

function openFace(d: number) {
  if (state.mode === 'intro') return;
  if (state.mode === 'open' || state.mode === 'opening') {
    if (state.open && state.open.d === d) { closeFace(); return; }
    state.queued = d;
    closeFace();
    return;
  }
  if (state.mode === 'closing') { state.queued = d; return; }
  // settle any twist
  if (twist.active) { twist.angle = 0; twist.active = false; }
  twist.dragging = false;
  computeCubePositions();
  const n = DIRS[d].clone();
  // up: the perpendicular cube axis that currently points most upward in the world
  let u = DIRS[0], best = -9;
  for (const c of DIRS) {
    if (Math.abs(c.dot(n)) > 0.5) continue;
    const wy = tv.copy(c).applyQuaternion(qCube).y + tv.copy(c).applyQuaternion(qCube).z * 0.01;
    if (wy > best) { best = wy; u = c; }
  }
  u = u.clone();
  const r = new THREE.Vector3().crossVectors(u, n);
  const basis = new THREE.Matrix4().makeBasis(r, u, n); // local->? columns r,u,n
  const qBasis = new THREE.Quaternion().setFromRotationMatrix(basis).invert(); // maps r->x, u->y, n->z
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), innerWidth > innerHeight ? -0.66 : -0.55);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.0);
  const qTo = yaw.multiply(tilt).multiply(qBasis);
  // shortest path
  if (qTo.dot(qCube) < 0) { qTo.x *= -1; qTo.y *= -1; qTo.z *= -1; qTo.w *= -1; }

  const sec = sectionAt(d);
  const S = SECTIONS[sec];

  // the peeling sheet: every voxel on the outside layer of this face
  const colMap = new Map<number, { items: { i: number; b: number; depth: number; dl: number; dc: number }[]; a: number }>();
  const peelIdx: number[] = [];
  const innerIdx: number[] = [];
  for (let i = 0; i < NC; i++) {
    tv.set(curPos[i * 3], curPos[i * 3 + 1], curPos[i * 3 + 2]);
    const dn = tv.dot(n);
    if (dn > HALF - 1.0 || (dn > HALF - 2.0 && vLining[i])) {
      const a = tv.dot(r), b = tv.dot(u) + HALF;
      const key = Math.round(a * 4);
      if (!colMap.has(key)) colMap.set(key, { items: [], a });
      const nb = HALF * 2;
      colMap.get(key)!.items.push({
        i, b, depth: HALF - dn,
        dl: (nb - b) * 0.021 + Math.abs(a) * 0.006 + jr() * 0.025,
        dc: b * 0.017 + Math.abs(a) * 0.004 + jr() * 0.02,
      });
      peelIdx.push(i);
    } else if (dn > CUB - NV / 2 - 0.5 && vInner[i]) innerIdx.push(i);
  }
  const cols = [...colMap.values()];
  cols.forEach((c) => c.items.sort((x, y) => x.b - y.b));

  // the diorama: pool voxels
  const fl = { sc: new Float32Array(POOL), S: new Float32Array(POOL * 3), E: new Float32Array(POOL * 3), dl: new Float32Array(POOL), dc: new Float32Array(POOL), lift: new Float32Array(POOL), axis: new Float32Array(POOL * 3), spin: new Float32Array(POOL), g: new Float32Array(POOL), fig: new Int16Array(POOL), anim: new Int16Array(POOL), n: 0 };
  const anims: { a: Anim; c: THREE.Vector3 }[] = [];
  const figs: OpenInfo['figs'] = [];
  const floorTop = -HALF + 1.0;
  type Part = { f: ReturnType<typeof figure>; X: number; Z: number; dl: number; fi: number; cs: number };
  const toLocal = (out: THREE.Vector3, pt: Part, x: number, y: number, z: number) =>
    out.set(0, 0, 0).addScaledVector(r, pt.X * CELL + x * pt.cs).addScaledVector(u, floorTop + pt.cs / 2 + y * pt.cs).addScaledVector(n, HALF + pt.Z * CELL + pt.cs / 2 + z * pt.cs);
  const parts: Part[] = [];
  parts.push({ f: word(S.word, GD), X: 0, Z: 44, dl: 0, fi: -1, cs: CELL });
  const lay = LAYOUT[S.id];
  const cs = FIG_SCALE[S.id] ?? CELL;
  S.items.forEach((it, k) => parts.push({ f: getFig(it.fig), X: lay[k][0], Z: lay[k][1], dl: 0.25 + k * 0.2, fi: k, cs }));
  for (const part of parts) {
    const base = anims.length;
    for (const a of part.f.anims) {
      const c = new THREE.Vector3();
      if (a.kind === 'spin') toLocal(c, part, a.cx, a.cy, a.cz);
      anims.push({ a, c });
    }
    if (part.fi >= 0) {
      const mn = toLocal(new THREE.Vector3(), part, part.f.min[0] - 0.5, part.f.min[1] - 0.5, part.f.min[2] - 0.5);
      const mx = toLocal(new THREE.Vector3(), part, part.f.max[0] + 0.5, part.f.max[1] + 0.5, part.f.max[2] + 0.5);
      figs.push({ min: mn.clone().min(mx), max: mn.max(mx).clone(), hop: -10, noted: false, dl: part.dl });
    }
    const w = part.f.max[0] - part.f.min[0] + 1;
    const ymax = part.f.max[1];
    for (const c of part.f.cells) {
      const j = fl.n++;
      if (j >= POOL) break;
      toLocal(tv, part, c.x, c.y, c.z);
      fl.E.set([tv.x, tv.y, tv.z], j * 3);
      toLocal(tv2, part, c.x + (jr() - 0.5) * 3, -1.2, c.z + (jr() - 0.5) * 3);
      fl.sc[j] = part.cs;
      fl.S.set([tv2.x, tv2.y, tv2.z], j * 3);
      const colx = part.fi < 0 ? (c.x - part.f.min[0]) / w : 0;
      fl.dl[j] = part.fi < 0 ? colx * 0.55 + c.y * 0.02 + jr() * 0.08 : part.dl + c.y * 0.022 + jr() * 0.12;
      fl.dc[j] = (ymax - c.y) * 0.01 + jr() * 0.12 + (part.fi < 0 ? 0.25 : 0);
      fl.lift[j] = 1.5 + jr() * 3.5;
      tv.set(jr() - 0.5, jr() - 0.5, jr() - 0.5).normalize();
      fl.axis.set([tv.x, tv.y, tv.z], j * 3);
      fl.spin[j] = (jr() - 0.5) * 8;
      fl.g[j] = c.g;
      fl.fig[j] = part.fi;
      fl.anim[j] = c.a >= 0 ? base + c.a : -1;
      const col = SLOT[c.c];
      const jj = 1 + (jr() - 0.5) * 0.06;
      colArr[(NC + j) * 3] = col.r * jj; colArr[(NC + j) * 3 + 1] = col.g * jj; colArr[(NC + j) * 3 + 2] = col.b * jj;
    }
  }
  mesh.instanceColor!.needsUpdate = true;
  mesh.count = NC + fl.n;

  state.open = {
    d, n, u, r, sec, qFrom: qCube.clone(), qTo, t0: T, tClose: -1,
    peel: { idx: peelIdx, cols }, innerIdx, pool: fl, anims, figs,
    pivotTo: new THREE.Vector3().addScaledVector(n, HALF + 2).addScaledVector(u, -5),
  };
  pivotFrom.copy(pivot);
  state.mode = 'opening';
  setOpenProg(1);
  sound.whoosh(true);
  showPanel(sec, true);
  hint.classList.add('gone');
  dirty = true;
  markVisited(S.id);
}

function closeFace() {
  const o = state.open;
  if (!o || state.mode === 'closing') return;
  state.mode = 'closing';
  o.tClose = T;
  // if still opening, start from where we are: simplest is to let the close springs run from 1
  pivotFrom.copy(pivot);
  setOpenProg(0);
  showPanel(o.sec, false);
  sound.whoosh(false);
  dirty = true;
}

function finishClose() {
  state.open = null;
  state.mode = 'idle';
  mesh.count = NC;
  for (let i = NC; i < NT; i++) G[i] = 0;
  for (let i = 0; i < NC; i++) G[i] = 0;
  glowAttr.needsUpdate = true;
  dirty = true;
  if (state.queued >= 0) { const q = state.queued; state.queued = -1; openFace(q); }
}

// ---------------------------------------------------------------- panels

const panels = SECTIONS.map((s) => document.getElementById('sec-' + s.id)!);
let panelShown = -1;
function showPanel(sec: number, on: boolean) {
  if (on) {
    panels.forEach((p, i) => { p.hidden = i !== sec; });
    panelWrap.classList.add('on');
    panelShown = sec;
  } else {
    panelWrap.classList.remove('on');
    panelShown = -1;
  }
}
panels.forEach((p) => {
  p.querySelectorAll<HTMLAnchorElement>('a[data-fig]').forEach((a) => {
    const k = +a.dataset.fig!;
    const hop = () => { const o = state.open; if (o && o.figs[k]) { o.figs[k].hop = T; dirty = true; sound.note(k * 2 + 3, 0.06); } };
    a.addEventListener('mouseenter', hop);
    a.addEventListener('focus', hop);
  });
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeFace()));

function markVisited(id: string) {
  state.visited.add(id);
  pips.forEach((b) => b.classList.toggle('seen', state.visited.has(b.dataset.sec!)));
  if (state.visited.size === 6 && !state.completeShown) {
    state.completeShown = true;
    setTimeout(() => { doneMsg.classList.add('on'); sound.chime(); }, 2600);
    setTimeout(() => doneMsg.classList.remove('on'), 9000);
  }
}
pips.forEach((b) => b.addEventListener('click', () => {
  firstTouch();
  const id = b.dataset.sec!;
  for (let d = 0; d < 6; d++) if (SECTIONS[sectionAt(d)].id === id) { openFace(d); return; }
}));

// ---------------------------------------------------------------- intro

const intro = {
  S: new Float32Array(NC * 3), q: new Float32Array(NC * 4), dl: new Float32Array(NC),
  tn: 0, tE: new Float32Array(POOL * 3), tS: new Float32Array(POOL * 3), tA: new Float32Array(POOL * 3), tdl: new Float32Array(POOL), tdx: new Float32Array(POOL), ts: 1,
};
function setupIntro() {
  computeCubePositions();
  for (let i = 0; i < NC; i++) {
    const x = curPos[i * 3], y = curPos[i * 3 + 1], z = curPos[i * 3 + 2];
    tv.set(jr() - 0.5, (jr() - 0.5) * 0.6, jr() - 0.5).normalize().multiplyScalar(45 + jr() * 50);
    intro.S.set([tv.x, tv.y, tv.z], i * 3);
    tq.set(jr() - 0.5, jr() - 0.5, jr() - 0.5, jr() - 0.5).normalize();
    intro.q.set([tq.x, tq.y, tq.z, tq.w], i * 4);
    const h = (y + HALF) / (2 * HALF);
    const ang = (Math.atan2(z, x) / (Math.PI * 2) + 0.5);
    intro.dl[i] = 1.25 + h * 1.0 + ang * 0.35 + jr() * 0.3;
  }
  // title lettering, in world space in front of the box
  const lines = titleLines();
  const asp = innerWidth / innerHeight;
  const camD = camera.position.length();
  const zt = 27;
  const visW = 2 * (camD - zt) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * asp;
  const maxW = Math.max(...lines.map(textWidth));
  const s = Math.min(1.05, (visW * 0.78) / maxW);
  intro.ts = s;
  const qi = qCube.clone().invert();
  let n = 0;
  lines.forEach((line, li) => {
    const f = word(line, GD);
    const w = textWidth(line);
    const yoff = (lines.length - 1) * 5 - li * 10;
    for (const c of f.cells) {
      if (n >= POOL) break;
      tv.set(c.x * s, (c.y - 3 + yoff) * s, zt + c.z * s);
      tv.applyQuaternion(qi);
      intro.tE.set([tv.x, tv.y, tv.z], n * 3);
      tv.set(jr() - 0.5, jr() - 0.5, jr() - 0.5).normalize().multiplyScalar(60 + jr() * 40).applyQuaternion(qi);
      intro.tS.set([tv.x, tv.y, tv.z], n * 3);
      // absorbed into the front of the box
      tv.set((jr() - 0.5) * 20, (jr() - 0.5) * 20, HALF);
      intro.tA.set([tv.x, tv.y, tv.z], n * 3);
      const cx = (c.x + w / 2) / w;
      intro.tdx[n] = cx;
      intro.tdl[n] = 0.15 + cx * 0.7 + li * 0.2 + jr() * 0.12;
      const col = SLOT[jr() < 0.12 ? GL : GD];
      colArr[(NC + n) * 3] = col.r; colArr[(NC + n) * 3 + 1] = col.g; colArr[(NC + n) * 3 + 2] = col.b;
      n++;
    }
  });
  intro.tn = n;
  mesh.instanceColor!.needsUpdate = true;
  mesh.count = NC + n;
}
const qIdent = new THREE.Quaternion();

function updateIntro(t: number) {
  // cube voxels
  for (let i = 0; i < NC; i++) {
    const cb = cubies[vCub[i]];
    const e = spr(t - intro.dl[i], 0.62, 7.5);
    const sw = (1 - clamp(e)) * 1.0;
    const sx = intro.S[i * 3], sy = intro.S[i * 3 + 1], sz = intro.S[i * 3 + 2];
    const a = t * 0.35 * sw;
    const ca = Math.cos(a), sa = Math.sin(a);
    const rx = sx * ca - sz * sa, rz = sx * sa + sz * ca;
    const hx = curPos[i * 3], hy = curPos[i * 3 + 1], hz = curPos[i * 3 + 2];
    const px = rx + (hx - rx) * e, py = sy + (hy - sy) * e, pz = rz + (hz - rz) * e;
    tq.set(intro.q[i * 4], intro.q[i * 4 + 1], intro.q[i * 4 + 2], intro.q[i * 4 + 3]);
    tq.slerp(cb.q, clamp(e));
    const sc = 0.45 + 0.55 * clamp(e);
    writeQ(i, px, py, pz, tq.x, tq.y, tq.z, tq.w, sc);
    const land = t - intro.dl[i] - 0.28;
    G[i] = land > 0 ? 0.7 * Math.exp(-land * 4.5) : 0.05 * (1 - clamp(e));
    // a wave of light across the front as the title is absorbed
    if (t > 3.6 && hz > HALF - 1.2) {
      const rr = Math.hypot(hx, hy);
      const k = rr - (t - 3.75) * 26;
      G[i] += 0.55 * Math.exp(-k * k * 0.05);
    }
  }
  // title voxels
  for (let j = 0; j < intro.tn; j++) {
    const i = NC + j;
    const e = spr(t - intro.tdl[j], 0.5, 8);
    const ex = clamp((t - (3.25 + intro.tdx[j] * 0.55)) / 0.55);
    const e2 = ex * ex * ex;
    let px = intro.tS[j * 3] + (intro.tE[j * 3] - intro.tS[j * 3]) * e;
    let py = intro.tS[j * 3 + 1] + (intro.tE[j * 3 + 1] - intro.tS[j * 3 + 1]) * e;
    let pz = intro.tS[j * 3 + 2] + (intro.tE[j * 3 + 2] - intro.tS[j * 3 + 2]) * e;
    px += (intro.tA[j * 3] - px) * e2; py += (intro.tA[j * 3 + 1] - py) * e2; pz += (intro.tA[j * 3 + 2] - pz) * e2;
    tq.copy(qCube).invert();
    const spinA = (1 - clamp(e)) * 6;
    tq2.setFromAxisAngle(tv.set(0.3, 1, 0.2).normalize(), spinA);
    tq.multiply(tq2);
    const s = intro.ts * clamp(e * 1.3) * (1 - e2);
    writeQ(i, px, py, pz, tq.x, tq.y, tq.z, tq.w, s);
    const shimmer = 0.5 + 0.5 * Math.sin(t * 5 - intro.tdx[j] * 12);
    G[i] = 0.08 + 0.35 * Math.max(0, shimmer - 0.6) * 2.5 + (t - intro.tdl[j] - 0.3 > 0 ? 0.8 * Math.exp(-(t - intro.tdl[j] - 0.3) * 4) : 0) + e2 * 1.2;
  }
  mesh.instanceMatrix.needsUpdate = true;
  glowAttr.needsUpdate = true;
  if (t > 1.5 && hint.dataset.armed !== '1') { /* noop */ }
  if (t >= 4.7) endIntro();
}
function endIntro() {
  if (state.mode !== 'intro') return;
  state.mode = 'idle';
  mesh.count = NC;
  for (let i = 0; i < NT; i++) G[i] = 0;
  glowAttr.needsUpdate = true;
  dirty = true;
  root.classList.add('ready');
  if (!state.interacted && !RM) {
    // a little flourish so the twist is discoverable
    setTimeout(() => { if (state.mode === 'idle' && !twist.dragging) scriptedTwist(1, 1, 1, false); }, 350);
    setTimeout(() => { if (state.mode === 'idle' && !twist.dragging) scriptedTwist(1, 1, -1, false); }, 1250);
  }
}

// ---------------------------------------------------------------- per-frame voxel update

const twQ = new THREE.Quaternion();
const twAxis = new THREE.Vector3();
const cubM = new Float32Array(26 * 9);
const cubT = new Float32Array(26 * 3);
const cubQ = new Float32Array(26 * 4);
const peeled = new Uint8Array(NC);

let cubeWrittenFor: OpenInfo | null = null;
function updateVoxels() {
  const o = state.open;
  // while a face is open nothing on the box itself moves except the sheet
  const skipCube = !!o && !twist.active && cubeWrittenFor === o && o.tClose < 0;
  if (skipCube) {
    const busy = updateOpen(o!);
    mesh.instanceMatrix.needsUpdate = true;
    return busy;
  }
  cubeWrittenFor = o && !twist.active ? o : null;
  // per-cubie transforms
  twAxis.set(0, 0, 0).setComponent(twist.axis, 1);
  twQ.setFromAxisAngle(twAxis, twist.active ? twist.angle : 0);
  const tm = new THREE.Matrix4().makeRotationFromQuaternion(twQ).elements;
  cubies.forEach((cb, ci) => {
    const inSlice = twist.active && cb.pos[twist.axis] === twist.layer;
    let m = cb.m;
    let t = [cb.pos[0] * CUB, cb.pos[1] * CUB, cb.pos[2] * CUB];
    tq.copy(cb.q);
    if (inSlice) {
      const R = [tm[0], tm[4], tm[8], tm[1], tm[5], tm[9], tm[2], tm[6], tm[10]];
      m = mul3(R, m);
      t = mv3(R, t);
      tq.premultiply(twQ);
    }
    cubM.set(m, ci * 9);
    cubT.set(t, ci * 3);
    cubQ.set([tq.x, tq.y, tq.z, tq.w], ci * 4);
  });
  for (let i = 0; i < NC; i++) {
    const ci = vCub[i];
    const m = ci * 9;
    const ox = vOff[i * 3], oy = vOff[i * 3 + 1], oz = vOff[i * 3 + 2];
    const px = cubT[ci * 3] + cubM[m] * ox + cubM[m + 1] * oy + cubM[m + 2] * oz;
    const py = cubT[ci * 3 + 1] + cubM[m + 3] * ox + cubM[m + 4] * oy + cubM[m + 5] * oz;
    const pz = cubT[ci * 3 + 2] + cubM[m + 6] * ox + cubM[m + 7] * oy + cubM[m + 8] * oz;
    curPos[i * 3] = px; curPos[i * 3 + 1] = py; curPos[i * 3 + 2] = pz;
    if (o && peeled[i]) continue;
    writeQ(i, px, py, pz, cubQ[ci * 4], cubQ[ci * 4 + 1], cubQ[ci * 4 + 2], cubQ[ci * 4 + 3], 1);
  }
  let busy = twist.active;
  if (o) busy = updateOpen(o) || busy;
  mesh.instanceMatrix.needsUpdate = true;
  return busy;
}

const rq = new THREE.Quaternion();
const dirV = new THREE.Vector3(), prevDir = new THREE.Vector3(), posV = new THREE.Vector3(), nrm = new THREE.Vector3();
function updateOpen(o: OpenInfo): boolean {
  const t = T;
  const closing = o.tClose >= 0;
  const tc = closing ? t - o.tClose : 0;
  const to = t - o.t0;
  let busy = false;
  // sheet
  const tPeel = 0.38;
  for (const col of o.peel.cols) {
    let started = false;
    let prevB = 0;
    for (let k = 0; k < col.items.length; k++) {
      const it = col.items[k];
      peeled[it.i] = 1;
      let p = spr(to - tPeel - it.dl, 0.42, 8.5);
      if (closing) p = Math.min(p, 1) * (1 - spr(tc - 0.45 - it.dc, 0.62, 9.5));
      if (Math.abs(p - 1) > 0.001 && p > 0.0005) busy = true;
      if (closing && p > 0.0005) busy = true;
      const th = p * Math.PI * 0.5;
      const c = Math.cos(th), s = Math.sin(th);
      dirV.set(0, 0, 0).addScaledVector(o.u, c).addScaledVector(o.n, s);
      if (!started) {
        posV.set(0, 0, 0).addScaledVector(o.n, HALF).addScaledVector(o.u, -HALF).addScaledVector(o.r, col.a).addScaledVector(dirV, it.b);
        started = true;
      } else {
        posV.addScaledVector(prevDir, (it.b - prevB) * 0.5).addScaledVector(dirV, (it.b - prevB) * 0.5);
      }
      prevDir.copy(dirV);
      prevB = it.b;
      nrm.set(0, 0, 0).addScaledVector(o.n, -c).addScaledVector(o.u, s);
      const ci = vCub[it.i];
      rq.setFromAxisAngle(o.r, th);
      tq.set(cubQ[ci * 4], cubQ[ci * 4 + 1], cubQ[ci * 4 + 2], cubQ[ci * 4 + 3]).premultiply(rq);
      const px = posV.x + nrm.x * it.depth, py = posV.y + nrm.y * it.depth, pz = posV.z + nrm.z * it.depth;
      // the lining tucks itself away so the sheet lands sticker-side up
      const sc = vLining[it.i] ? 1 - smooth(p * 4) : 1;
      writeQ(it.i, px, py, pz, tq.x, tq.y, tq.z, tq.w, sc);
    }
  }
  // compartments glow from within
  const glowIn = (closing ? 1 - smooth(tc / 1.2) : smooth((to - 0.5) / 1.2)) * (PAL.dark ? 0.55 : 0.3);
  for (const i of o.innerIdx) G[i] = glowIn;

  // diorama
  const P = o.pool;
  const fT = 1.05;
  for (let j = 0; j < P.n; j++) {
    const i = NC + j;
    let e = spr(to - fT - P.dl[j], 0.5, 10);
    if (closing) e = Math.min(e, 1) * (1 - spr(tc - P.dc[j], 0.85, 13));
    if (closing ? e > 0.001 : Math.abs(e - 1) > 0.002) busy = true;
    const ec = clamp(e);
    const sx = P.S[j * 3], sy = P.S[j * 3 + 1], sz = P.S[j * 3 + 2];
    let px = sx + (P.E[j * 3] - sx) * e;
    let py = sy + (P.E[j * 3 + 1] - sy) * e;
    let pz = sz + (P.E[j * 3 + 2] - sz) * e;
    const lift = Math.sin(Math.PI * ec) * P.lift[j] * (RM ? 0.2 : 1);
    px += o.u.x * lift; py += o.u.y * lift; pz += o.u.z * lift;
    // spin while flying
    tq.setFromAxisAngle(dirV.set(P.axis[j * 3], P.axis[j * 3 + 1], P.axis[j * 3 + 2]), (1 - ec) * P.spin[j]);
    let g = P.g[j];
    const ai = P.anim[j];
    if (ai >= 0) {
      const A = o.anims[ai];
      const a = A.a;
      if (a.kind === 'bob') {
        const b = Math.sin(t * a.speed * 2 + a.phase) * a.amp * ec;
        px += o.u.x * b; py += o.u.y * b; pz += o.u.z * b;
      } else if (a.kind === 'spin') {
        const ax = a.axis === 'z' ? o.n : o.u;
        rq.setFromAxisAngle(ax, t * a.speed * (RM ? 0.3 : 1));
        posV.set(px, py, pz).sub(A.c).applyQuaternion(rq).add(A.c);
        px = posV.x; py = posV.y; pz = posV.z;
        tq.premultiply(rq);
      } else if (a.kind === 'blink') {
        g *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * a.speed * 2));
      }
      if (!closing) busy = true;
    }
    const fi = P.fig[j];
    if (fi >= 0) {
      const F = o.figs[fi];
      const ht = t - F.hop;
      if (ht >= 0 && ht < 1.2) {
        const hp = Math.sin(Math.min(ht * 7, Math.PI)) * 1.6 * Math.exp(-ht * 2) + Math.sin(ht * 18) * 0.15 * Math.exp(-ht * 5);
        px += o.u.x * hp; py += o.u.y * hp; pz += o.u.z * hp;
        g += 0.25 * Math.exp(-ht * 3);
        busy = true;
      }
      if (!F.noted && !closing && to > fT + F.dl + 0.25) { F.noted = true; sound.note(fi * 3 + 2, 0.08); }
    } else if (!closing && P.dl[j] < 0.02 && to > fT + 0.25 && !(o as any).titleNoted) { (o as any).titleNoted = true; sound.note(0, 0.08); }
    const land = to - fT - P.dl[j] - 0.22;
    if (!closing && land > 0) g += 0.55 * Math.exp(-land * 5);
    const s = P.sc[j] * clamp(e * 1.6, 0, 1.08);
    writeQ(i, px, py, pz, tq.x, tq.y, tq.z, tq.w, s);
    G[i] = g;
  }
  glowAttr.needsUpdate = true;

  if (!closing && state.mode === 'opening' && to > 1.5) state.mode = 'open';
  if (closing && !busy && tc > 0.6) {
    for (const i of o.peel.idx) peeled[i] = 0;
    finishClose();
  }
  return busy || !closing;
}

// ---------------------------------------------------------------- camera framing

const camTarget = new THREE.Vector3();

let viewW = 1, viewH = 1;
const parallax = new THREE.Vector2();
const parallaxT = new THREE.Vector2();
function panelSize() {
  const wide = viewW > 760 && viewW / viewH > 1.05;
  return wide ? { x: Math.min(360, viewW * 0.34), y: 0 } : { x: 0, y: Math.min(viewH * 0.44, 380) };
}
function frameCamera() {
  const k = smooth(openProg);
  const ps = panelSize();
  const effW = viewW - ps.x * k, effH = viewH - ps.y * k;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const needH = THREE.MathUtils.lerp(52, 60, k), needW = THREE.MathUtils.lerp(48, viewW < viewH ? 52 : 66, k);
  const dist = Math.max((needH * viewH) / (2 * tanH * effH), (needW * viewH) / (2 * tanH * effW));
  const elev = THREE.MathUtils.lerp(0.1, 0.6, k) + parallax.y * 0.05;
  const az = parallax.x * 0.06;
  camTarget.set(0, THREE.MathUtils.lerp(0, viewW < viewH ? 4 : 1, k), 0);
  camera.position.set(Math.sin(az) * Math.cos(elev) * dist, Math.sin(elev) * dist, Math.cos(az) * Math.cos(elev) * dist).add(camTarget);
  camera.lookAt(camTarget);
  // shift the projection so the scene centres in the space left by the panel
  const ox = (ps.x * k) / 2, oy = (ps.y * k) / 2;
  if (ox || oy) camera.setViewOffset(viewW, viewH, ox, oy, viewW, viewH);
  else camera.clearViewOffset();
  bgMat.uniforms.center.value.set(0.5 - ox / viewW, 0.56 + oy / viewH);
}

function resize() {
  viewW = innerWidth; viewH = innerHeight;
  renderer.setSize(viewW, viewH, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(viewW, viewH);
  camera.aspect = viewW / viewH;
  camera.updateProjectionMatrix();
  bgMat.uniforms.res.value.set(viewW * renderer.getPixelRatio(), viewH * renderer.getPixelRatio());
  frameCamera();
  dirty = true;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- picking

const ray = new THREE.Ray();
const ndc = new THREE.Vector2();
const invM = new THREE.Matrix4();
function localRay(cx: number, cy: number) {
  ndc.set((cx / viewW) * 2 - 1, -(cy / viewH) * 2 + 1);
  camera.updateMatrixWorld();
  const r = new THREE.Raycaster();
  r.setFromCamera(ndc, camera);
  mesh.updateMatrixWorld();
  invM.copy(mesh.matrixWorld).invert();
  ray.copy(r.ray).applyMatrix4(invM);
  return ray;
}
function hitBox(r: THREE.Ray, min: THREE.Vector3, max: THREE.Vector3) {
  let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
  for (let a = 0; a < 3; a++) {
    const o = r.origin.getComponent(a), d = r.direction.getComponent(a);
    const lo = min.getComponent(a), hi = max.getComponent(a);
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let ta = (lo - o) / d, tb = (hi - o) / d;
    let s = -1;
    if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
    if (ta > t0) { t0 = ta; ax = a; sg = s; }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return { t: t0, ax, sg, p: r.at(t0, new THREE.Vector3()) };
}
const BOXMIN = new THREE.Vector3(-HALF, -HALF, -HALF), BOXMAX = new THREE.Vector3(HALF, HALF, HALF);
function pickFigure(r: THREE.Ray) {
  const o = state.open;
  if (!o || state.mode !== 'open') return -1;
  let best = -1, bt = Infinity;
  o.figs.forEach((f, k) => {
    const h = hitBox(r, f.min, f.max);
    if (h && h.t < bt) { bt = h.t; best = k; }
  });
  return best;
}
function toScreen(p: THREE.Vector3) {
  const v = p.clone().applyMatrix4(mesh.matrixWorld).project(camera);
  return new THREE.Vector2((v.x + 1) * 0.5 * viewW, (1 - v.y) * 0.5 * viewH);
}

// ---------------------------------------------------------------- input

const spin = new THREE.Vector2(); // angular velocity: x about world Y, y about camera right
type Drag = { id: number; x0: number; y0: number; x: number; y: number; t: number; kind: 'none' | 'spin' | 'twist' | 'turn'; hit: ReturnType<typeof hitBox>; fig: number; cand: { axis: number; layer: number; scr: THREE.Vector2 }[]; chosen: number; moved: boolean };
let drag: Drag | null = null;

function firstTouch() {
  if (!state.interacted) {
    state.interacted = true;
    hint.classList.add('gone');
  }
  if (state.mode === 'intro') introSpeed = 4;
}

function rotateCube(dx: number, dy: number, yawOnly: boolean) {
  tq.setFromAxisAngle(tv.set(0, 1, 0), dx);
  qCube.premultiply(tq);
  if (!yawOnly) {
    camera.updateMatrixWorld();
    tv.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tq.setFromAxisAngle(tv, dy);
    qCube.premultiply(tq);
  }
  qCube.normalize();
}

canvas.addEventListener('pointerdown', (e) => {
  firstTouch();
  if (drag || state.mode === 'intro') return;
  canvas.setPointerCapture(e.pointerId);
  const r = localRay(e.clientX, e.clientY);
  const fig = pickFigure(r);
  const hit = fig >= 0 ? null : hitBox(r, BOXMIN, BOXMAX);
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), kind: 'none', hit, fig, cand: [], chosen: -1, moved: false };
  spin.set(0, 0);
  if (hit && state.mode === 'idle' && e.button === 0 && !e.shiftKey) {
    // the two ways this point could twist
    const P = hit.p;
    for (let a = 0; a < 3; a++) {
      if (a === hit.ax) continue;
      const A = new THREE.Vector3().setComponent(a, 1);
      const T = new THREE.Vector3().crossVectors(A, P);
      const s0 = toScreen(P), s1 = toScreen(P.clone().addScaledVector(T, 0.01));
      const scr = s1.sub(s0).multiplyScalar(100); // pixels per radian
      const pa = P.getComponent(a);
      const layer = pa > CUB / 2 ? 1 : pa < -CUB / 2 ? -1 : 0;
      drag.cand.push({ axis: a, layer, scr });
    }
  }
  canvas.classList.add('grabbing');
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    hoverCursor(e.clientX, e.clientY);
    parallaxT.set((e.clientX / viewW) * 2 - 1, (e.clientY / viewH) * 2 - 1);
    return;
  }
  if (e.pointerId !== drag.id) return;
  const now = performance.now();
  const dt = Math.max(1, now - drag.t) / 1000;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
  const tx = e.clientX - drag.x0, ty = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(tx, ty) > 7) {
    drag.moved = true;
    if (drag.cand.length) {
      let best = -1, bs = 0;
      drag.cand.forEach((c, k) => {
        const l = c.scr.length();
        if (l < 1e-3) return;
        const sc = Math.abs((tx * c.scr.x + ty * c.scr.y) / l);
        if (sc > bs) { bs = sc; best = k; }
      });
      if (best >= 0) {
        drag.kind = 'twist';
        drag.chosen = best;
        const c = drag.cand[best];
        if (twist.active && (twist.axis !== c.axis || twist.layer !== c.layer)) twist.angle = 0;
        if (!twist.active) twist.angle = 0;
        twist.axis = c.axis; twist.layer = c.layer; twist.active = true; twist.dragging = true;
        (drag as any).base = twist.angle;
        twist.lastTickIdx = Math.round(twist.angle / (Math.PI / 8));
      }
    } else drag.kind = state.mode === 'idle' ? 'spin' : 'turn';
    if (drag.kind === 'none') drag.kind = 'spin';
  }
  if (drag.kind === 'twist') {
    const c = drag.cand[drag.chosen];
    const l2 = c.scr.lengthSq();
    const ang = (drag as any).base + (tx * c.scr.x + ty * c.scr.y) / l2;
    twist.vel = (ang - twist.angle) / dt;
    twist.angle = ang;
    const ti = Math.round(ang / (Math.PI / 8));
    if (ti !== twist.lastTickIdx) { twist.lastTickIdx = ti; sound.tick(ti % 4 === 0 ? 1.4 : 0.7); }
    dirty = true;
  } else if (drag.kind === 'spin' || drag.kind === 'turn') {
    const k = 0.0075;
    const yawOnly = drag.kind === 'turn';
    rotateCube(dx * k, dy * k, yawOnly);
    spin.lerp(new THREE.Vector2((dx * k) / dt, yawOnly ? 0 : (dy * k) / dt), 0.5);
  }
});

function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('grabbing');
  if (performance.now() - d.t > 80) spin.set(0, 0);
  if (d.kind === 'twist') {
    twist.dragging = false;
    const q = Math.PI / 2;
    let k = Math.round(twist.angle / q);
    const proj = twist.angle + twist.vel * 0.12;
    if (Math.abs(twist.vel) > 4) k = Math.round(proj / q);
    commitTwist(twist.axis, twist.layer, k);
    twist.angle -= k * q;
    twist.crossed = false;
    twist.vel = twist.vel * 0.3;
    dirty = true;
    return;
  }
  if (!d.moved) {
    // a tap
    if (d.fig >= 0) { tapFigure(d.fig); return; }
    if (d.hit) {
      const dirI = d.hit.ax * 2 + (d.hit.sg > 0 ? 0 : 1);
      if (state.mode === 'idle') openFace(dirI);
      else if (state.mode === 'open' || state.mode === 'opening') closeFace();
      return;
    }
    if (state.mode === 'open' || state.mode === 'opening') closeFace();
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

function tapFigure(k: number) {
  const o = state.open;
  if (!o) return;
  o.figs[k].hop = T;
  sound.note(k * 2 + 5, 0.1);
  dirty = true;
  const a = panels[o.sec].querySelector<HTMLAnchorElement>(`a[data-fig="${k}"]`);
  if (a) {
    a.classList.remove('flash');
    void a.offsetWidth;
    a.classList.add('flash');
    a.focus({ preventScroll: true });
  }
}

let lastHover = 0;
function hoverCursor(x: number, y: number) {
  const now = performance.now();
  if (now - lastHover < 50) return;
  lastHover = now;
  if (state.mode === 'intro') return;
  const r = localRay(x, y);
  const fig = pickFigure(r);
  const hit = fig < 0 && hitBox(r, BOXMIN, BOXMAX);
  canvas.classList.toggle('hot', fig >= 0 || (!!hit && state.mode === 'idle'));
}

// keyboard
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
  if (root.classList.contains('reading')) return;
  const k = e.key;
  if (k === 'Escape') { if (state.open) closeFace(); return; }
  firstTouch();
  if (state.mode === 'intro') return;
  if (k.startsWith('Arrow')) {
    const s = 1.6;
    if (k === 'ArrowLeft') spin.x -= s; if (k === 'ArrowRight') spin.x += s;
    if (state.mode === 'idle') { if (k === 'ArrowUp') spin.y -= s; if (k === 'ArrowDown') spin.y += s; }
    e.preventDefault();
    return;
  }
  if (/^[1-6]$/.test(k)) { pips[+k - 1]?.click(); return; }
  if ((k === 'Enter' || k === ' ') && (e.target === document.body || e.target === canvas)) {
    e.preventDefault();
    if (state.open) { closeFace(); return; }
    openFace(faceToward(new THREE.Vector3(0, 0.3, 1)));
    return;
  }
  const map: Record<string, THREE.Vector3> = { f: new THREE.Vector3(0, 0, 1), b: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(0, -1, 0), r: new THREE.Vector3(1, 0, 0), l: new THREE.Vector3(-1, 0, 0) };
  const w = map[k.toLowerCase()];
  if (w && state.mode === 'idle' && !e.metaKey && !e.ctrlKey) {
    const d = faceToward(w);
    const axis = d >> 1, layer = d % 2 === 0 ? 1 : -1;
    // clockwise as seen from outside that face
    const dir = (e.shiftKey ? 1 : -1) * layer;
    scriptedTwist(axis, layer, dir);
  }
});
function faceToward(worldDir: THREE.Vector3) {
  const inv = qCube.clone().invert();
  const v = worldDir.clone().normalize().applyQuaternion(inv);
  return dirIndex(v);
}

// sound toggle
soundBtn.addEventListener('click', () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'sound on' : 'sound';
  sound.enable(on);
  if (on) sound.snap(0.6);
});

// ---------------------------------------------------------------- loop

let last = performance.now();
let running = true;
let frameAvg = 16, frameN = 0;
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
  if (running) { last = performance.now(); requestAnimationFrame(loop); }
});

function stepTwist(dt: number) {
  if (!twist.active || twist.dragging) return;
  // spring toward 0 residual
  const w = RM ? 14 : 22, z = RM ? 1 : 0.42;
  const sub = 4;
  for (let i = 0; i < sub; i++) {
    const h = dt / sub;
    const acc = -w * w * twist.angle - 2 * z * w * twist.vel;
    twist.vel += acc * h;
    const prev = twist.angle;
    twist.angle += twist.vel * h;
    if (!twist.crossed && (Math.sign(prev) !== Math.sign(twist.angle) || Math.abs(twist.angle) < 0.01)) {
      twist.crossed = true;
      sound.snap(0.8 + Math.min(0.6, Math.abs(twist.vel) * 0.05));
      flashSlice();
    }
  }
  if (Math.abs(twist.angle) < 0.0008 && Math.abs(twist.vel) < 0.01) {
    twist.angle = 0; twist.vel = 0; twist.active = false;
    if (!twist.crossed) { twist.crossed = true; }
  }
  dirty = true;
}
let sliceFlashT = -10;
let sliceFlash = { axis: 0, layer: 0 };
function celebrate() { sound.chime(); }
function flashSlice() { sliceFlashT = T; sliceFlash = { axis: twist.axis, layer: twist.layer }; }
function updateSliceFlash() {
  const k = T - sliceFlashT;
  if (k < 0 || k > 0.6 || state.open || state.mode === 'intro') return false;
  const a = sliceFlash.axis;
  const g = 0.5 * Math.exp(-k * 6);
  for (let i = 0; i < NC; i++) {
    const cb = cubies[vCub[i]];
    if (cb.pos[a] !== sliceFlash.layer) { G[i] = 0; continue; }
    // light the cut edges: voxels near the slice boundary
    const p = curPos[i * 3 + a];
    const edge = Math.abs(Math.abs(p - sliceFlash.layer * CUB) - 3.5) < 0.6 ? 1 : 0;
    G[i] = g * edge;
  }
  glowAttr.needsUpdate = true;
  if (k > 0.55) { for (let i = 0; i < NC; i++) G[i] = 0; }
  return true;
}

function loop(now: number) {
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt, true);
}
function tick(dt: number, draw: boolean) {
  T += dt;
  frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
  if (++frameN % 120 === 0 && frameAvg > 26 && dpr > 0.8) {
    dpr = Math.max(0.75, dpr - 0.25);
    renderer.setPixelRatio(dpr);
    resize();
  }

  // camera framing toward open/closed
  const op = spr(T - openProgT0, 0.85, 4.2);
  openProg = openProgFrom + (openProgTo - openProgFrom) * op;
  parallax.lerp(parallaxT, 1 - Math.exp(-dt * 2));

  if (state.mode === 'intro') {
    introClock += dt * introSpeed;
    updateIntro(introClock);
  } else {
    // spin & inertia
    if (!drag || drag.kind !== 'spin' && drag.kind !== 'turn') {
      const yawOnly = !!state.open;
      if (spin.lengthSq() > 1e-6) rotateCube(spin.x * dt, yawOnly ? 0 : spin.y * dt, yawOnly);
      spin.multiplyScalar(Math.exp(-dt * 2.6));
    }
    const o = state.open;
    if (o && !o.tClose && o.tClose !== 0) { /* noop */ }
    if (o && o.tClose < 0) {
      // ease the box around so the face looks at us; the drag can still turn it afterward
      const k = spr(T - o.t0, 0.72, 5.5);
      if (T - o.t0 < 2.2 && (!drag || drag.kind === 'none')) {
        tq.copy(o.qFrom).slerp(o.qTo, clamp(k, 0, 1.04));
        // keep any yaw the user has added while opening
        qCube.copy(tq);
        if (k > 0.999) o.qFrom.copy(o.qTo);
      } else if (drag && T - o.t0 < 2.2) { o.qFrom.copy(qCube); o.qTo.copy(qCube); }
      pivot.lerpVectors(pivotFrom, o.pivotTo, clamp(k, 0, 1.1));
    } else if (o) {
      const k = spr(T - o.tClose - 0.5, 0.8, 5);
      pivot.lerpVectors(pivotFrom, tv.set(0, 0, 0), clamp(k));
    } else pivot.multiplyScalar(Math.exp(-dt * 6));
    stepTwist(dt);
    const flashing = updateSliceFlash();
    if (dirty || twist.active || state.open || flashing) {
      dirty = false;
      if (updateVoxels()) dirty = true;
    }
  }
  outer.quaternion.copy(qCube);
  outer.position.set(0, RM ? 0 : Math.sin(T * 0.7) * 0.5, 0);
  inner.position.copy(pivot).multiplyScalar(-1);
  frameCamera();

  // key light drifts a touch so highlights breathe
  const la = RM ? 0 : Math.sin(T * 0.13) * 0.12;
  tv.copy(keyDir).applyAxisAngle(tv2.set(0, 1, 0), la);
  key.position.copy(tv).multiplyScalar(110);
  key.target.position.set(0, 0, 0);
  bgMat.uniforms.time.value = T;
  if (draw) composer.render(dt);
}

// ---------------------------------------------------------------- go

resize();
if (state.mode === 'intro') {
  setupIntro();
  updateIntro(0);
} else {
  root.classList.add('ready');
  dirty = true;
}
requestAnimationFrame(loop);
setTimeout(() => { if (!state.interacted) hint.classList.add('show'); }, RM ? 300 : 5200);
