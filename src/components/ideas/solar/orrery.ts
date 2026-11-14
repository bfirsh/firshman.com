import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { projects, now, email, socials, alsoWorkedOn } from '../../../data/bio';

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

// ---------------------------------------------------------------- noise
function hash3(x: number, y: number, z: number, s: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x: number, y: number, z: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, s);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x: number, y: number, z: number, s: number, oct = 4) {
  let a = 0.5, f = 1, sum = 0, n = 0;
  for (let i = 0; i < oct; i++) { sum += a * noise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return sum / n;
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/** Equirectangular texture painted from a function of the 3D unit direction. */
function sphereTex(fn: (x: number, y: number, z: number, u: number, v: number) => number[], w = 384, h = 192) {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), y = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const lon = ((i + 0.5) / w) * Math.PI * 2;
      const rgb = fn(cl * Math.cos(lon), y, cl * Math.sin(lon), i / w, j / h);
      const k = (j * w + i) * 4;
      img.data[k] = rgb[0]; img.data[k + 1] = rgb[1]; img.data[k + 2] = rgb[2]; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- renderer
const cv = $<HTMLCanvasElement>('#sky');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.documentElement.classList.add('fallback');
  $('#list').classList.add('open');
  throw new Error('WebGL unavailable');
}
const DPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060504);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 1500);
const controls = new OrbitControls(camera, cv);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.rotateSpeed = 0.6;
controls.zoomSpeed = 0.8;
controls.maxPolarAngle = Math.PI * 0.62;
controls.enabled = false;

const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(DPR);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- lights & materials
scene.add(new THREE.PointLight(0xffe7c4, 3.2, 0, 0));
scene.add(new THREE.AmbientLight(0x30324a, 0.35));
const rim = new THREE.DirectionalLight(0x8fa6ff, 0.25);
rim.position.set(-10, 20, -30);
scene.add(rim);

const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 });
const brassDark = new THREE.MeshStandardMaterial({ color: 0x9a7536, metalness: 1, roughness: 0.42 });
const planetMat = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, envMapIntensity: 0.25, ...o });

// ---------------------------------------------------------------- stars
{
  const N = 2600;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.9, 0.3, 0.4));
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const band = i < N * 0.45;
    const th = Math.random() * Math.PI * 2;
    const y = band ? (Math.random() + Math.random() + Math.random() - 1.5) * 0.18 : Math.random() * 2 - 1;
    const r = Math.sqrt(1 - y * y);
    v.set(r * Math.cos(th), y, r * Math.sin(th)).applyMatrix4(tilt).multiplyScalar(500 + Math.random() * 300);
    pos.set([v.x, v.y, v.z], i * 3);
    const warm = Math.random();
    const c = warm < 0.3 ? [1, 0.85, 0.65] : warm < 0.8 ? [1, 0.97, 0.92] : [0.75, 0.85, 1];
    const b = 0.35 + Math.pow(Math.random(), 3) * 0.9;
    col.set(c.map((x) => x * b), i * 3);
    size[i] = (band ? 1.1 : 1.4) + Math.pow(Math.random(), 6) * 3.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { dpr: { value: DPR }, time: { value: 0 } },
    vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float dpr; uniform float time;
      void main(){ vC = color * (0.8 + 0.2 * sin(time * 1.7 + position.x * 0.13 + position.y * 0.07));
      vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = size * dpr; }`,
    fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .0, d); gl_FragColor = vec4(vC * a, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(g, m);
  stars.userData.mat = m;
  stars.name = 'stars';
  scene.add(stars);
}
const starMat = (scene.getObjectByName('stars') as THREE.Points).userData.mat as THREE.ShaderMaterial;

// ---------------------------------------------------------------- the sun (Replicate)
const SUN_R = 1.75;
const sunTex = tex(sphereTex((x, y, z) => {
  const n = fbm(x * 5, y * 5, z * 5, 3, 5);
  const m = fbm(x * 18 + n * 2, y * 18, z * 18, 9, 3);
  const t = n * 0.65 + m * 0.35;
  return mix(hex('#ff7a1a'), hex('#fff3c8'), sstep(0.3, 0.75, t));
}, 512, 256));
const sun = new THREE.Mesh(new THREE.SphereGeometry(SUN_R, 64, 32), new THREE.MeshBasicMaterial({ map: sunTex, color: new THREE.Color(1.45, 1.05, 0.72) }));
scene.add(sun);
function glowTex(stops: [number, string][]) {
  const [c, g] = canvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, s]) => gr.addColorStop(o, s));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return tex(c);
}
const corona = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex([[0, 'rgba(255,220,150,1)'], [0.18, 'rgba(255,170,80,0.55)'], [0.45, 'rgba(255,120,40,0.12)'], [1, 'rgba(255,90,20,0)']]),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
corona.scale.setScalar(13);
scene.add(corona);

// ---------------------------------------------------------------- the stand
{
  const prof: [number, number][] = [
    [0, -0.3], [0.16, -0.32], [0.16, -0.55], [0.13, -0.6], [0.13, -2.5], [0.3, -2.58], [0.3, -2.7], [0.17, -2.8],
    [0.17, -5.6], [0.42, -5.8], [0.24, -6.1], [0.24, -7.4], [0.9, -7.9], [1.9, -8.4], [2.0, -8.7], [0, -8.7],
  ];
  const col = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 48), new THREE.MeshStandardMaterial({ color: 0xa88241, metalness: 1, roughness: 0.48 }));
  scene.add(col);
}

// ---------------------------------------------------------------- engraved ecliptic ring
const RING_IN = 19.3, RING_OUT = 20.7;
{
  const S = 2048, [c, g] = canvas(S, S);
  const C = S / 2, k = C / RING_OUT;
  const circ = (r: number, w: number) => { g.lineWidth = w; g.beginPath(); g.arc(C, C, r * k, 0, Math.PI * 2); g.stroke(); };
  const engrave = () => {
  g.fillStyle = '#c9a44f'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#3b2a10'; g.fillStyle = '#3b2a10';
  circ(RING_IN + 0.08, 3); circ(RING_OUT - 0.08, 3); circ(RING_IN + 0.38, 1.5); circ(RING_OUT - 0.5, 1.5);
  for (let d = 0; d < 360; d += 2) {
    const a = (d / 180) * Math.PI, long = d % 10 === 0;
    const r0 = (RING_IN + 0.08) * k, r1 = (RING_IN + (long ? 0.36 : 0.22)) * k;
    g.lineWidth = long ? 2.5 : 1.2;
    g.beginPath(); g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); g.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1); g.stroke();
  }
  const words = 'BEN FIRSHMAN · HIS ORRERY · NOT TO SCALE · ALL PERIODS APPROXIMATE · WIND GENTLY · ';
  const text = words + words;
  const tr = (RING_OUT - 0.42) * k;
  g.font = `600 ${Math.round(0.36 * k)}px Cinzel, Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = (Math.PI * 2) / text.length;
  for (let i = 0; i < text.length; i++) {
    const a = i * step - Math.PI / 2;
    g.save(); g.translate(C + Math.cos(a) * tr, C + Math.sin(a) * tr); g.rotate(a + Math.PI / 2); g.fillText(text[i], 0, 0); g.restore();
  }
  };
  engrave();
  const t = tex(c);
  document.fonts?.load(`600 ${Math.round(0.36 * k)}px Cinzel`).then(() => { engrave(); t.needsUpdate = true; }).catch(() => {});
  const ringMat = new THREE.MeshStandardMaterial({ map: t, metalness: 1, roughness: 0.38, color: 0xffffff });
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 256, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.85;
  scene.add(ring);
  // three slender spokes carry the ring
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, RING_IN, 8), brassDark);
    spoke.rotation.z = Math.PI / 2;
    spoke.position.set(RING_IN / 2, 0, 0);
    const holder = new THREE.Group(); holder.rotation.y = a; holder.position.y = -5.7; holder.add(spoke);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.85, 8), brassDark);
    strut.position.set(RING_IN - 0.1, 2.43, 0);
    holder.add(strut);
    scene.add(holder);
  }
}

// ---------------------------------------------------------------- bodies
type Body = {
  key: string; label: string; kicker: string; name: string; blurb?: string; url?: string; period: string;
  anchor: THREE.Object3D; size: number; view: number; hit: THREE.Mesh; el?: HTMLButtonElement; below?: boolean;
  links?: { name: string; url: string }[]; extraClass?: string;
};
const bodies: Body[] = [];
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const hitGeo = new THREE.SphereGeometry(1, 12, 8);
function addHit(anchor: THREE.Object3D, b: Body) {
  const h = new THREE.Mesh(hitGeo, hitMat);
  h.userData.body = b;
  anchor.add(h);
  b.hit = h;
}
const BASE_PERIOD = 11; // seconds for the innermost planet at x1
const R0 = 3.9;
const omega = (r: number) => ((Math.PI * 2) / BASE_PERIOD) * Math.pow(R0 / r, 1.5);

type Orbit = { pivot: THREE.Group; w: number; phase: number; spin: (t: number, dt: number) => void };
const orbits: Orbit[] = [];
let armIndex = 0;

function makeOrbit(r: number, planetBottom: number, phase: number) {
  const pivot = new THREE.Group();
  const armY = -0.72 - armIndex * 0.19;
  armIndex++;
  const back = Math.min(1.4, r * 0.18);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(r + back, 0.05, 0.075), brass);
  arm.position.set((r - back) / 2, armY, 0);
  pivot.add(arm);
  const cw = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), brass);
  cw.position.set(-back, armY, 0);
  pivot.add(cw);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 24), brassDark);
  collar.position.y = armY;
  pivot.add(collar);
  const L = planetBottom - armY;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, L, 8), brass);
  rod.position.set(r, armY + L / 2, 0);
  pivot.add(rod);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.06, 16), brass);
  cup.position.set(r, planetBottom - 0.02, 0);
  pivot.add(cup);
  const track = new THREE.Mesh(new THREE.TorusGeometry(r, 0.011, 4, 256), brassDark);
  track.rotation.x = Math.PI / 2;
  scene.add(track);
  const carrier = new THREE.Group();
  carrier.position.set(r, 0, 0);
  pivot.add(carrier);
  scene.add(pivot);
  const o: Orbit = { pivot, w: omega(r), phase, spin: () => {} };
  orbits.push(o);
  return { carrier, orbit: o };
}

function sphere(r: number, mat: THREE.Material, seg = 48) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.round(seg / 2)), mat);
}
function addBody(b: Omit<Body, 'hit'>) {
  const full = b as Body;
  addHit(b.anchor, full);
  bodies.push(full);
  return full;
}

// Replicate: the sun
addBody({
  key: 'replicate', label: now.name, kicker: 'The sun', name: now.name, blurb: `Where I work now. It lets you ${now.blurb}.`, url: now.url,
  period: 'Stationary. Everything else goes round it.', anchor: sun, size: SUN_R, view: 9, extraClass: 'sun',
});

const GA = 2.39996;
let pIndex = 0;
const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const kick = () => `Planet ${numerals[pIndex++]}`;

// I. Cog: a gear-toothed planet
{
  const size = 0.58, r = R0;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4);
  const body = new THREE.Group();
  carrier.add(body);
  const t = tex(sphereTex((x, y, z) => {
    const n = fbm(x * 4, y * 9, z * 4, 21);
    const band = Math.sin(y * 18 + n * 4) * 0.5 + 0.5;
    return mix(hex('#5a2c1c'), hex('#d0643a'), band * 0.7 + n * 0.3);
  }));
  body.add(sphere(size, planetMat({ map: t, roughness: 0.6 })));
  const teeth = 16, ro = size * 1.48, ri = size * 1.28, hole = size * 0.8;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, s = (Math.PI * 2) / teeth;
    const pts: [number, number][] = [[ri, a0], [ro, a0 + s * 0.18], [ro, a0 + s * 0.48], [ri, a0 + s * 0.66]];
    pts.forEach(([rr, a], j) => { const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0 && j === 0) shape.moveTo(x, y); else shape.lineTo(x, y); });
  }
  shape.closePath();
  const hp = new THREE.Path(); hp.absarc(0, 0, hole, 0, Math.PI * 2, true); shape.holes.push(hp);
  for (let s = 0; s < 6; s++) { /* spokes are implied by the planet */ }
  const gear = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 4 }), brass);
  gear.rotation.x = Math.PI / 2; gear.position.y = 0.06;
  body.add(gear);
  orbit.spin = (_t, dt) => { body.rotation.y += dt * 0.9; };
  addBody({
    key: 'cog', label: 'Cog', kicker: kick(), name: P.cog.name, blurb: P.cog.blurb, url: P.cog.url,
    period: 'About one cog push.', anchor: carrier, size: 0.9, view: 5.2,
  });
}

// II. CLIG: a terminal planet with a blinking cursor
let blink: () => void = () => {};
{
  const size = 0.6, r = 5.45;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4 + GA);
  const [c, g] = canvas(1024, 512);
  const lines = [
    '', '', '', '$ mycli --help', 'Usage: mycli <command> [flags]', '', 'Commands:', '  init      Start a new project',
    '  deploy    Ship it', '  logs      Read the logs', '', 'Flags:', '  -h, --help     Show help', '  -q, --quiet    Less noise',
    '', '$ mycli deploy --dry-run', 'Would deploy 3 things.', '$ ', '', '',
  ];
  const LH = 24, top = 18;
  const draw = (cursor: boolean) => {
    g.fillStyle = '#07110c'; g.fillRect(0, 0, 1024, 512);
    g.font = '600 18px ui-monospace, Menlo, Consolas, monospace'; g.textBaseline = 'top';
    for (let rep = 0; rep < 2; rep++) {
      lines.forEach((l, i) => { g.fillStyle = l.startsWith('$') ? '#c8ffd8' : '#5fd88a'; g.fillText(l, 30 + rep * 512, top + i * LH); });
    }
    if (cursor) { g.fillStyle = '#d8ffe4'; for (let rep = 0; rep < 2; rep++) g.fillRect(30 + rep * 512 + 22, top + 17 * LH + 1, 11, 19); }
  };
  draw(true);
  const t = tex(c);
  let on = true;
  blink = () => { on = !on; draw(on); t.needsUpdate = true; };
  const body = sphere(size, planetMat({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.4 }), 64);
  body.rotation.y = -0.6;
  carrier.add(body);
  orbit.spin = (_t, dt) => { body.rotation.y += dt * 0.25; };
  addBody({
    key: 'clig', label: 'CLI Guidelines', kicker: kick(), name: P.clig.name, blurb: P.clig.blurb, url: P.clig.url,
    period: 'One orbit per --help.', anchor: carrier, size, view: 4.3,
  });
}

// III. Docker Compose: a blue planet with a ring of tiny containers
{
  const size = 0.62, r = 7.05;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4 + GA * 2);
  const t = tex(sphereTex((x, y, z) => {
    const n = fbm(x * 3 + 2, y * 7, z * 3, 33);
    return mix(hex('#0f3f7a'), hex('#4aa8f0'), sstep(0.25, 0.8, n + Math.sin(y * 12) * 0.08));
  }));
  carrier.add(sphere(size, planetMat({ map: t })));
  const ringG = new THREE.Group();
  ringG.rotation.set(0.38, 0, 0.18);
  carrier.add(ringG);
  const N = 54;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.075, 0.075), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, envMapIntensity: 0.5 }), N);
  const palette = ['#2496ed', '#e9eef4', '#f2b630', '#d9532f', '#5aa86a', '#2a66c9'].map((h) => new THREE.Color(h));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
    const rr = size * (1.55 + (i % 3) * 0.12 + Math.random() * 0.04);
    e.set(0, -a + Math.PI / 2, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(Math.cos(a) * rr, (Math.random() - 0.5) * 0.05, Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.85 + Math.random() * 0.3));
    boxes.setMatrixAt(i, m);
    boxes.setColorAt(i, palette[i % palette.length]);
  }
  ringG.add(boxes);
  orbit.spin = (_t, dt) => { ringG.rotation.y += dt * 0.35; };
  addBody({
    key: 'compose', label: 'Docker Compose', kicker: kick(), name: P.compose.name, blurb: P.compose.blurb, url: P.compose.url,
    period: 'up, then down. Repeat as needed.', anchor: carrier, size: 1.2, view: 5,
  });
}

// IV & V. Docker Machine + Whalebrew: a binary pair on one arm
{
  const r = 8.85, sep = 0.95, sm = 0.42, sw = 0.46;
  const { carrier, orbit } = makeOrbit(r, -0.62, 0.4 + GA * 3);
  const pair = new THREE.Group();
  carrier.add(pair);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(sep * 2, 0.04, 0.06), brass);
  bar.position.y = -0.62;
  pair.add(bar);
  const post = (x: number, s: number) => {
    const L = -0.62 - (-s - 0.02);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, Math.abs(L), 8), brass);
    p.position.set(x, (-0.62 + (-s - 0.02)) / 2, 0); pair.add(p);
  };
  post(sep, sm); post(-sep, sw);
  // Machine: a provisioned, gridded steel world
  const mt = tex(sphereTex((x, y, z, u, v) => {
    const n = fbm(x * 4, y * 4, z * 4, 41);
    let c = mix(hex('#4c5868'), hex('#9aa7b8'), n);
    const gu = Math.abs(((u * 24) % 1) - 0.5), gv = Math.abs(((v * 12) % 1) - 0.5);
    if (gu > 0.46 || gv > 0.46) c = mix(c, hex('#e6edf5'), 0.55);
    if (hash3(Math.floor(u * 24), Math.floor(v * 12), 0, 7) > 0.86) c = mix(c, hex('#ffb347'), 0.7);
    return c;
  }));
  const machine = new THREE.Group();
  machine.position.x = sep;
  machine.add(sphere(sm, planetMat({ map: mt, roughness: 0.45, metalness: 0.3, envMapIntensity: 0.6 })));
  pair.add(machine);
  // Whalebrew: an ocean world, with a whale
  const wt = tex(sphereTex((x, y, z) => {
    const n = fbm(x * 5, y * 5, z * 5, 52);
    return mix(hex('#0b3a6e'), hex('#3a8fd1'), sstep(0.3, 0.75, n));
  }));
  const whale = new THREE.Group();
  whale.position.x = -sep;
  const ocean = sphere(sw, planetMat({ map: wt, roughness: 0.35, envMapIntensity: 0.6 }));
  whale.add(ocean);
  const fs = new THREE.Shape();
  fs.moveTo(0, 0); fs.bezierCurveTo(0.03, 0.06, 0.08, 0.1, 0.17, 0.13); fs.bezierCurveTo(0.12, 0.08, 0.05, 0.08, 0, 0.09);
  fs.bezierCurveTo(-0.05, 0.08, -0.12, 0.08, -0.17, 0.13); fs.bezierCurveTo(-0.08, 0.1, -0.03, 0.06, 0, 0);
  const fluke = new THREE.Mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.025, bevelEnabled: false }), planetMat({ color: 0x1b2633, roughness: 0.5 }));
  const flukeHolder = new THREE.Group();
  flukeHolder.rotation.z = -0.5;
  fluke.position.set(0, sw - 0.02, -0.0125);
  flukeHolder.add(fluke);
  whale.add(flukeHolder);
  pair.add(whale);
  orbit.spin = (_t, dt) => { pair.rotation.y += dt * 0.7; ocean.rotation.y += dt * 0.2; machine.rotation.y += dt * 0.4; flukeHolder.rotation.y += dt * 0.2; };
  addBody({
    key: 'machine', label: 'Docker Machine', kicker: `${kick()} · binary pair`, name: P.machine.name, blurb: P.machine.blurb, url: P.machine.url,
    period: 'Tidally locked to the Docker daemon.', anchor: machine, size: sm, view: 4,
  });
  addBody({
    key: 'whalebrew', label: 'Whalebrew', kicker: `${kick()} · binary pair`, name: P.whalebrew.name, blurb: P.whalebrew.blurb, url: P.whalebrew.url,
    period: 'One brew install, in a container.', anchor: whale, size: sw, view: 4, below: true,
  });
}

// VI. arXiv Vanity: a paper-white planet
{
  const size = 0.6, r = 10.35;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4 + GA * 4);
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#f6f1e4'; g.fillRect(0, 0, 1024, 512);
  for (let page = 0; page < 4; page++) {
    const x0 = page * 256 + 22;
    g.fillStyle = '#2b2b2b'; g.fillRect(x0 + 30, 96, 150, 9);
    g.fillStyle = '#9a9a9a'; g.fillRect(x0 + 60, 114, 90, 5);
    for (let col = 0; col < 2; col++) {
      for (let i = 0; i < 26; i++) {
        const y = 132 + i * 10.5;
        if (y > 410) break;
        const w = i % 9 === 8 ? 40 + Math.random() * 30 : 92 + Math.random() * 8;
        g.fillStyle = i % 13 === 5 ? '#b31b1b' : '#8d8a83';
        if (i % 13 === 5) g.fillRect(x0 + col * 108 + 20, y + 1, 50, 3); else g.fillRect(x0 + col * 108, y, w, 3.5);
      }
    }
  }
  const t = tex(c);
  const body = sphere(size, planetMat({ map: t, roughness: 0.9, envMapIntensity: 0.4 }), 64);
  carrier.add(body);
  orbit.spin = (_t, dt) => { body.rotation.y += dt * 0.3; };
  addBody({
    key: 'arxiv-vanity', label: 'arXiv Vanity', kicker: kick(), name: P['arxiv-vanity'].name, blurb: P['arxiv-vanity'].blurb, url: P['arxiv-vanity'].url,
    period: 'Pending peer review.', anchor: carrier, size, view: 4.3,
  });
}

// The asteroid belt: also worked on
const BELT_IN = 11.4, BELT_OUT = 12.7;
const belt = new THREE.Group();
let beltAnchor: THREE.Object3D;
{
  const N = 420;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95, flatShading: true, envMapIntensity: 0.2 }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = BELT_IN + (Math.random() + Math.random()) * 0.5 * (BELT_OUT - BELT_IN);
    p.set(Math.cos(a) * rr, (Math.random() - 0.5) * 0.35, Math.sin(a) * rr);
    q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const sc = 0.025 + Math.pow(Math.random(), 3) * 0.11;
    s.set(sc * (0.8 + Math.random() * 0.5), sc * (0.7 + Math.random() * 0.4), sc);
    m.compose(p, q, s);
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, tint.setHSL(0.08 + Math.random() * 0.04, 0.15 + Math.random() * 0.15, 0.35 + Math.random() * 0.25));
  }
  belt.add(rocks);
  // five named rocks, slightly grander
  alsoWorkedOn.forEach((_, i) => {
    const a = (i / alsoWorkedOn.length) * Math.PI * 2 + 0.3;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), new THREE.MeshStandardMaterial({ color: 0xb59a73, roughness: 0.8, flatShading: true, envMapIntensity: 0.3 }));
    rock.position.set(Math.cos(a) * 12.05, 0, Math.sin(a) * 12.05);
    rock.rotation.set(i, i * 2, i * 3);
    belt.add(rock);
  });
  beltAnchor = new THREE.Object3D();
  beltAnchor.position.set(Math.cos(0.3) * 12.05, 0, Math.sin(0.3) * 12.05);
  belt.add(beltAnchor);
  scene.add(belt);
  const beltHit = new THREE.Mesh(new THREE.RingGeometry(BELT_IN - 0.3, BELT_OUT + 0.3, 96), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  beltHit.rotation.x = -Math.PI / 2;
  scene.add(beltHit);
  const b = {
    key: 'belt', label: 'Asteroid belt', kicker: 'The asteroid belt', name: 'Also worked on',
    blurb: 'Lots of small rocks, and lots of other people.', period: "It's complicated.",
    anchor: beltAnchor, size: 0.3, view: 4.5, links: alsoWorkedOn,
  } as Body;
  b.hit = beltHit; beltHit.userData.body = b;
  bodies.push(b);
}

// VII. Django: green, with a moon
{
  const size = 0.7, r = 13.95;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4 + GA * 6);
  const t = tex(sphereTex((x, y, z) => {
    const n = fbm(x * 2.6, y * 2.6, z * 2.6, 61, 5);
    const land = sstep(0.5, 0.56, n);
    return mix(mix(hex('#0c3c26'), hex('#11533a'), n), mix(hex('#44b78b'), hex('#9fe3c0'), (n - 0.5) * 3), land);
  }));
  const body = sphere(size, planetMat({ map: t }));
  carrier.add(body);
  const moonPivot = new THREE.Group();
  carrier.add(moonPivot);
  const marm = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.025, 0.035), brass);
  marm.position.set(0.67, -size - 0.05, 0);
  moonPivot.add(marm);
  const mpost = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, size - 0.16, 6), brass);
  mpost.position.set(1.35, -size / 2 - 0.13, 0);
  moonPivot.add(mpost);
  const moon = sphere(0.18, planetMat({ map: tex(sphereTex((x, y, z) => mix(hex('#77736a'), hex('#e3ddcf'), fbm(x * 6, y * 6, z * 6, 71)), 128, 64)) }), 24);
  moon.position.set(1.35, 0, 0);
  moonPivot.add(moon);
  orbit.spin = (_t, dt) => { body.rotation.y += dt * 0.25; moonPivot.rotation.y += dt * 0.8; };
  addBody({
    key: 'django', label: 'Django', kicker: kick(), name: P.django.name, blurb: P.django.blurb, url: P.django.url,
    period: 'Batteries included. Period not specified.', anchor: carrier, size: 1.3, view: 6,
  });
}

// VIII. JSNES: a pixelated planet, built from voxels
{
  const r = 15.65, cell = 0.15, R = 5.2;
  const { carrier, orbit } = makeOrbit(r, -R * cell - 0.05, 0.4 + GA * 7);
  const body = new THREE.Group();
  carrier.add(body);
  const cells: [number, number, number][] = [];
  const n = Math.ceil(R);
  for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) for (let z = -n; z <= n; z++) {
    const d = Math.hypot(x, y, z);
    if (d <= R && d > R - 1.25) cells.push([x, y, z]);
  }
  const vox = new THREE.InstancedMesh(new THREE.BoxGeometry(cell * 0.96, cell * 0.96, cell * 0.96), new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.3 }), cells.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  cells.forEach(([x, y, z], i) => {
    m.makeTranslation(x * cell, y * cell, z * cell);
    vox.setMatrixAt(i, m);
    const d = Math.hypot(x, y, z) || 1;
    const nn = fbm(x / d * 2.2 + 5, y / d * 2.2, z / d * 2.2, 81, 3);
    const lat = Math.abs(y / d);
    const c = lat > 0.82 ? '#fcfcfc' : nn > 0.58 ? '#00a800' : nn > 0.53 ? '#f8b800' : nn > 0.42 ? '#0078f8' : '#0058f8';
    vox.setColorAt(i, col.set(c).multiplyScalar(0.62));
  });
  body.add(vox);
  orbit.spin = (_t, dt) => { body.rotation.y += dt * 0.35; };
  addBody({
    key: 'jsnes', label: 'JSNES', kicker: kick(), name: P.jsnes.name, blurb: P.jsnes.blurb, url: P.jsnes.url,
    period: 'Sixty frames a second, give or take.', anchor: carrier, size: R * cell, view: 5.8,
  });
}

// IX. UKHAS: a blue world with a weather balloon for a moon
{
  const size = 0.66, r = 17.65;
  const { carrier, orbit } = makeOrbit(r, -size - 0.02, 0.4 + GA * 8);
  const t = tex(sphereTex((x, y, z) => {
    const n = fbm(x * 2.4, y * 2.4, z * 2.4, 91, 5);
    const cl = fbm(x * 5 + 9, y * 9, z * 5, 95, 4);
    let c = n > 0.54 ? mix(hex('#4f7d43'), hex('#a99b6b'), (n - 0.54) * 4) : mix(hex('#0d3c7a'), hex('#2f77c0'), n * 1.6);
    if (Math.abs(y) > 0.86) c = hex('#f0f4f8');
    c = mix(c, hex('#ffffff'), sstep(0.55, 0.72, cl) * 0.85);
    return c;
  }));
  const body = sphere(size, planetMat({ map: t, roughness: 0.7 }));
  carrier.add(body);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(size * 1.06, 48, 24), new THREE.MeshBasicMaterial({ color: 0x6fb2ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  carrier.add(atmo);
  const bPivot = new THREE.Group();
  carrier.add(bPivot);
  const balloon = new THREE.Group();
  balloon.position.set(1.35, 0.35, 0);
  bPivot.add(balloon);
  const env = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16), new THREE.MeshPhysicalMaterial({ color: 0xfff7ec, roughness: 0.25, clearcoat: 1, sheen: 0.5, envMapIntensity: 0.8 }));
  env.scale.set(1, 1.18, 1);
  balloon.add(env);
  const neck = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 12), env.material);
  neck.position.y = -0.24; neck.rotation.x = Math.PI;
  balloon.add(neck);
  const chute = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), planetMat({ color: 0xe8432e, side: THREE.DoubleSide }));
  chute.position.y = -0.38;
  balloon.add(chute);
  const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.27, 0), new THREE.Vector3(0, -0.62, 0)]);
  balloon.add(new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: 0xdedede })));
  const payload = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), planetMat({ color: 0xff8a1f, roughness: 0.5 }));
  payload.position.y = -0.64;
  balloon.add(payload);
  orbit.spin = (tt, dt) => { body.rotation.y += dt * 0.2; bPivot.rotation.y += dt * 0.5; balloon.position.y = 0.35 + Math.sin(tt * 1.3) * 0.08; balloon.rotation.z = Math.sin(tt * 0.9) * 0.08; };
  addBody({
    key: 'ukhas', label: 'UKHAS', kicker: kick(), name: P.ukhas.name, blurb: P.ukhas.blurb, url: P.ukhas.url,
    period: 'Up for a few hours. Then down, ideally on a parachute.', anchor: carrier, size: 1.3, view: 6,
  });
}

// ---------------------------------------------------------------- the comet (contact details)
const comet = new THREE.Group();
comet.visible = false;
scene.add(comet);
const cometHead = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.9, 3.2) }));
comet.add(cometHead);
const coma = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex([[0, 'rgba(220,240,255,1)'], [0.2, 'rgba(160,200,255,0.5)'], [1, 'rgba(120,160,255,0)']]),
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
}));
coma.scale.setScalar(1.0);
comet.add(coma);
const tailGeo = new THREE.ConeGeometry(0.55, 1, 24, 1, true);
tailGeo.translate(0, -0.5, 0);
const tailMat = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `varying vec2 vUv; uniform float time;
    void main(){ float a = pow(vUv.y, 2.2) * (0.75 + 0.25 * sin(vUv.x * 40. + time * 3.)); gl_FragColor = vec4(vec3(0.6, 0.8, 1.2) * a, a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const tail = new THREE.Mesh(tailGeo, tailMat);
comet.add(tail);
const cometBody = {
  key: 'comet', label: 'Comet', kicker: 'A comet, carrying post', name: 'Get in touch',
  blurb: 'You caught it. This one delivers messages.', period: 'Periodic. Answers email.',
  anchor: comet, size: 0.3, view: 5, extraClass: 'comet',
  links: [{ name: email, url: `mailto:${email}` }, ...socials.map((s) => ({ name: `${s.name} · ${s.handle}`, url: s.url }))],
} as Body;
addHit(comet, cometBody);
bodies.push(cometBody);
const cometState = { active: false, t: 0, dur: 13, p0: new THREE.Vector3(), p1: new THREE.Vector3(), c: new THREE.Vector3(), next: reduced ? 2.5 : 7 };
function launchComet() {
  const a = Math.random() * Math.PI * 2;
  const far = 42;
  cometState.p0.set(Math.cos(a) * far, 5 + Math.random() * 4, Math.sin(a) * far);
  const b = a + Math.PI + (Math.random() - 0.5) * 0.9;
  cometState.p1.set(Math.cos(b) * far, 2 + Math.random() * 4, Math.sin(b) * far);
  cometState.c.copy(cometState.p0).add(cometState.p1).multiplyScalar(0.5).multiplyScalar(0.25);
  cometState.c.y = 3.5;
  cometState.t = 0;
  cometState.dur = reduced ? 70 : 14;
  cometState.active = true;
  comet.visible = true;
}
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
function updateComet(dt: number) {
  if (!cometState.active) {
    cometState.next -= dt;
    if (cometState.next <= 0) launchComet();
    return;
  }
  if (focus !== cometBody) cometState.t += dt / cometState.dur;
  const t = cometState.t;
  if (t >= 1) { cometState.active = false; comet.visible = false; cometState.next = reduced ? 6 : 16 + Math.random() * 16; return; }
  const u = 1 - t;
  comet.position.set(0, 0, 0)
    .addScaledVector(cometState.p0, u * u).addScaledVector(cometState.c, 2 * u * t).addScaledVector(cometState.p1, t * t);
  const d = comet.position.length();
  tmpV.copy(comet.position).normalize();
  tail.quaternion.setFromUnitVectors(DOWN, tmpV);
  const len = 2 + 9 * Math.max(0, 1 - d / 34);
  tail.scale.set(0.5 + len * 0.08, len, 0.5 + len * 0.08);
}

// ---------------------------------------------------------------- labels
const labelsEl = $('#labels');
for (const b of bodies) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `lbl ${b.extraClass || ''}`;
  el.textContent = b.label;
  el.setAttribute('aria-label', b.key === 'comet' ? 'Comet: get in touch' : `Fly to ${b.label}`);
  el.addEventListener('click', () => flyTo(b));
  labelsEl.appendChild(el);
  b.el = el;
}

// ---------------------------------------------------------------- card
const card = $('#card');
function hostOf(url: string) {
  if (url.startsWith('mailto:')) return url.slice(7);
  try { const u = new URL(url); return (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, ''); } catch { return url; }
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function showCard(b: Body) {
  const blurb = b.blurb ? `<p class="b">${esc(cap(b.blurb))}${/[.!?]$/.test(b.blurb) ? '' : '.'}</p>` : '';
  const links = b.links ? `<ul>${b.links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`).join('')}</ul>` : '';
  const go = b.url ? `<a class="go" href="${esc(b.url)}">Visit ${esc(b.key === 'replicate' ? b.name : 'the project')} →</a><span class="host">${esc(hostOf(b.url))}</span>` : '';
  card.innerHTML = `<button type="button" class="ghost back" id="back">← System</button>
    <p class="k">${esc(b.kicker)}</p><h2>${esc(b.name)}</h2>${blurb}
    <dl><dt>Orbital period</dt><dd>${esc(b.period)}</dd></dl>${links}${go}`;
  card.hidden = false;
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  $('#back').addEventListener('click', goBack);
}

// ---------------------------------------------------------------- camera choreography
type Mode = 'intro' | 'system' | 'flying' | 'focus';
let mode: Mode = 'intro';
let focus: Body | null = null;
const flight = { t: 0, dur: 1.9, fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(), to: null as Body | null };
const sysPos = new THREE.Vector3(), sysTarget = new THREE.Vector3(0, -0.6, 0);
const phone = () => innerWidth < 720;
function systemPose() {
  const aspect = innerWidth / innerHeight;
  const fov = aspect < 0.8 ? 52 : 40;
  camera.fov = fov;
  const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const elev = THREE.MathUtils.degToRad(aspect < 0.8 ? 58 : 31);
  const fitX = aspect < 0.8 ? 12.6 : 20.5;
  const D = Math.max(fitX / (tanH * aspect), (fitX * Math.sin(elev) + 4) / tanH) * (aspect < 0.8 ? 1 : 0.98);
  const az = 0.55;
  sysPos.set(Math.cos(elev) * Math.sin(az) * D, Math.sin(elev) * D, Math.cos(elev) * Math.cos(az) * D).add(sysTarget);
  return D;
}
let sysD = systemPose();
controls.maxDistance = sysD * 2;
controls.minDistance = 6;

// lens shift lets the focused body sit beside (or above) the card
const shift = new THREE.Vector2(), shiftTo = new THREE.Vector2();
function applyProjection() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  camera.projectionMatrix.elements[8] = -shift.x;
  camera.projectionMatrix.elements[9] = -shift.y;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

const anchorPos = (b: Body, out: THREE.Vector3) => b.anchor.getWorldPosition(out);
function viewOffset(b: Body, out: THREE.Vector3) {
  const dist = b.view * (camera.aspect < 0.8 ? 1.55 : 1);
  if (b.key === 'replicate') return out.set(0.5, 0.55, 1).normalize().multiplyScalar(dist);
  const p = anchorPos(b, tmpV2);
  const radial = tmpV.set(p.x, 0, p.z).normalize();
  const tangent = new THREE.Vector3(radial.z, 0, -radial.x);
  return out.copy(tangent).multiplyScalar(0.85).addScaledVector(radial, 0.3).add(new THREE.Vector3(0, 0.3, 0)).normalize().multiplyScalar(dist);
}

function flyTo(b: Body) {
  if (b.key === 'comet' && !cometState.active) return;
  focus = b;
  mode = 'flying';
  flight.t = 0;
  flight.dur = reduced ? 0.01 : 1.9;
  flight.fromPos.copy(camera.position);
  flight.fromTarget.copy(controls.target);
  flight.to = b;
  controls.enabled = false;
  showCard(b);
  document.body.classList.add('focus');
  shiftTo.set(phone() ? 0 : -0.3, phone() ? 0.42 : 0);
  if (reduced) shift.copy(shiftTo);
}
function goBack() {
  if (mode === 'system' || mode === 'intro') return;
  const was = focus;
  focus = null;
  mode = 'flying';
  flight.t = 0;
  flight.dur = reduced ? 0.01 : 1.7;
  flight.fromPos.copy(camera.position);
  flight.fromTarget.copy(controls.target);
  flight.to = null;
  controls.enabled = false;
  card.hidden = true;
  document.body.classList.remove('focus');
  shiftTo.set(0, 0);
  if (reduced) shift.set(0, 0);
  if (was?.el) was.el.focus({ preventScroll: true });
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (listEl.classList.contains('open')) closeList();
    else goBack();
  }
});

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const desired = new THREE.Vector3(), aim = new THREE.Vector3(), off = new THREE.Vector3();
function updateCamera(dt: number, realT: number) {
  if (mode === 'intro') {
    const k = Math.min(1, realT / 3.6);
    const e = 1 - Math.pow(1 - k, 3);
    const r0 = 5.2, el0 = 0.12, az0 = -2.2;
    const elev = Math.asin((sysPos.y - sysTarget.y) / sysD);
    const az = Math.atan2(sysPos.x, sysPos.z);
    const R = r0 + (sysD - r0) * e, E = el0 + (elev - el0) * e, A = az0 + (az - az0) * e;
    camera.position.set(Math.cos(E) * Math.sin(A) * R, Math.sin(E) * R, Math.cos(E) * Math.cos(A) * R).add(sysTarget);
    controls.target.copy(sysTarget);
    camera.lookAt(sysTarget);
    if (k >= 1) endIntro();
    return;
  }
  if (mode === 'flying') {
    flight.t = Math.min(1, flight.t + dt / flight.dur);
    const e = ease(flight.t);
    if (flight.to) {
      anchorPos(flight.to, aim);
      viewOffset(flight.to, off);
      desired.copy(aim).add(off);
    } else {
      aim.copy(sysTarget);
      desired.copy(sysPos);
    }
    camera.position.lerpVectors(flight.fromPos, desired, e);
    camera.position.y += Math.sin(Math.PI * e) * flight.fromPos.distanceTo(desired) * 0.12;
    controls.target.lerpVectors(flight.fromTarget, aim, e);
    camera.lookAt(controls.target);
    if (flight.t >= 1) {
      mode = flight.to ? 'focus' : 'system';
      controls.enabled = true;
      if (flight.to) { controls.minDistance = flight.to.view * 0.45; controls.maxDistance = flight.to.view * 5; }
      else { controls.minDistance = 6; controls.maxDistance = sysD * 2; }
    }
    return;
  }
  if (mode === 'focus' && focus) {
    anchorPos(focus, aim);
    off.copy(aim).sub(controls.target);
    camera.position.add(off);
    controls.target.copy(aim);
  }
  controls.update();
}
function endIntro() {
  if (mode !== 'intro') return;
  mode = 'system';
  controls.enabled = true;
  controls.update();
}
cv.addEventListener('pointerdown', () => { if (mode === 'intro' && clockT > 0.6) { camera.position.copy(sysPos); endIntro(); } }, { capture: true });

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hits = () => bodies.filter((b) => b.key !== 'comet' || cometState.active).map((b) => b.hit);
function pick(x: number, y: number): Body | null {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const res = ray.intersectObjects(hits(), false);
  if (!res.length) return null;
  // prefer a real body over the belt's big disc
  const real = res.find((r) => (r.object.userData.body as Body).key !== 'belt');
  return ((real || res[0]).object.userData.body as Body);
}
let down: { x: number; y: number; t: number } | null = null;
cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
cv.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 7 && performance.now() - down.t < 700) {
    const b = pick(e.clientX, e.clientY);
    if (b && b !== focus) flyTo(b);
  }
  down = null;
});
let hot: Body | null = null;
cv.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons) return;
  const b = pick(e.clientX, e.clientY);
  if (b !== hot) {
    hot?.el?.classList.remove('hot');
    hot = b;
    hot?.el?.classList.add('hot');
    cv.classList.toggle('hot', !!b);
  }
});

// ---------------------------------------------------------------- UI: speed, pause, list
const speedIn = $<HTMLInputElement>('#speed');
const speedOut = $<HTMLOutputElement>('#speedOut');
const pauseBtn = $<HTMLButtonElement>('#pause');
let paused = false;
const speedFromSlider = () => { const v = +speedIn.value; return v === 0 ? 0 : Math.pow(2, (v - 40) / 14); };
if (reduced) speedIn.value = '12';
function showSpeed(s: number) {
  const txt = s === 0 ? 'stopped' : s < 10 ? `×${s.toFixed(1)}` : `×${Math.round(s)}`;
  speedOut.textContent = txt;
  speedIn.setAttribute('aria-valuetext', s === 0 ? 'stopped' : `${s.toFixed(1)} times speed`);
}
speedIn.addEventListener('input', () => { showSpeed(speedFromSlider()); if (paused) setPaused(false); });
showSpeed(speedFromSlider());
function setPaused(p: boolean) {
  paused = p;
  pauseBtn.setAttribute('aria-pressed', String(p));
  pauseBtn.setAttribute('aria-label', p ? 'Resume the orrery' : 'Pause the orrery');
}
pauseBtn.addEventListener('click', () => setPaused(!paused));

const listEl = $('#list');
const listBtn = $<HTMLButtonElement>('#listBtn');
function openList() { listEl.classList.add('open'); listBtn.setAttribute('aria-expanded', 'true'); ($('#listClose') as HTMLElement).focus(); }
function closeList() { listEl.classList.remove('open'); listBtn.setAttribute('aria-expanded', 'false'); listBtn.focus(); }
listBtn.addEventListener('click', () => (listEl.classList.contains('open') ? closeList() : openList()));
$('#listClose').addEventListener('click', closeList);

// ---------------------------------------------------------------- resize
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  const was = sysPos.clone();
  sysD = systemPose();
  if (mode === 'system' && was.distanceTo(sysPos) > 0.01) { camera.position.copy(sysPos); controls.target.copy(sysTarget); }
  if (mode === 'system') controls.maxDistance = sysD * 2;
  if (focus) shiftTo.set(phone() ? 0 : -0.3, phone() ? 0.42 : 0);
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- loop
let simT = 0, clockT = 0, blinkT = 0;
const labelPos = new THREE.Vector3();
const labelW = new Map<HTMLElement, number>();
document.fonts?.ready.then(() => labelW.clear());
addEventListener('resize', () => labelW.clear());
function updateLabels() {
  const showAll = mode === 'system';
  for (const b of bodies) {
    const el = b.el!;
    let on = showAll;
    if (b.key === 'comet') on = cometState.active && mode !== 'focus' && mode !== 'flying';
    if (b.key === 'belt' || b.key === 'replicate') on = on && true;
    if (!on) { el.classList.remove('on'); el.tabIndex = -1; continue; }
    anchorPos(b, labelPos);
    labelPos.y += b.key === 'belt' ? 0.3 : (b.below ? -b.size * 1.4 - 0.25 : b.size * 1.1 + 0.15);
    if (b.key === 'replicate') labelPos.y = SUN_R + 1.1;
    labelPos.project(camera);
    if (labelPos.z > 1 || Math.abs(labelPos.x) > 1.1 || Math.abs(labelPos.y) > 1.1) { el.classList.remove('on'); el.tabIndex = -1; continue; }
    if (!labelW.get(el)) labelW.set(el, el.offsetWidth);
    const w = labelW.get(el) || 0;
    const x = Math.min(Math.max((labelPos.x * 0.5 + 0.5) * innerWidth - 12, 2), innerWidth - w - 2);
    const y = (-labelPos.y * 0.5 + 0.5) * innerHeight;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(0, ${b.below ? '0' : '-100%'})`;
    el.classList.add('on');
    el.tabIndex = 0;
  }
}

function frame(raw: number) {
  const dt = Math.min(raw, 0.05), camDt = Math.min(raw, 0.25);
  clockT += camDt;
  let speed = paused ? 0 : speedFromSlider();
  if (mode === 'intro' && !reduced) {
    const k = Math.min(1, clockT / 3.6);
    const boost = 1 + 22 * Math.pow(1 - k, 2);
    speed = Math.max(speed, 0.15) * boost;
    showSpeed(speed);
  } else if (mode === 'intro') showSpeed(speed);
  const sdt = dt * speed;
  simT += sdt;
  for (const o of orbits) { o.pivot.rotation.y = o.phase + simT * o.w; o.spin(simT, sdt); }
  belt.rotation.y = simT * omega(12) + 0.2;
  sun.rotation.y += sdt * 0.05;
  starMat.uniforms.time.value = reduced ? 0 : clockT;
  tailMat.uniforms.time.value = clockT;
  updateComet(dt);
  blinkT += dt;
  if (blinkT > 0.53) { blinkT = 0; blink(); }
  // keep hit targets finger-sized at a distance
  for (const b of bodies) {
    if (b.key === 'belt') continue;
    const d = camera.position.distanceTo(anchorPos(b, tmpV));
    b.hit.scale.setScalar(Math.max(b.size * 1.25, d * 0.028));
  }
  shift.lerp(shiftTo, 1 - Math.pow(0.02, camDt));
  updateCamera(camDt, clockT);
  applyProjection();
  updateLabels();
  composer.render(dt);
}
if (mode === 'intro' && reduced) { camera.position.copy(sysPos); controls.target.copy(sysTarget); mode = 'system'; controls.enabled = true; controls.update(); }

let raf = 0, last = performance.now();
function loop(t: number) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  frame(dt);
}
function start() { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop); }
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
start();
// fonts change the ring engraving: repaint isn't needed (canvas text already set), but labels need fonts for width
(window as unknown as { __orrery: unknown }).__orrery = { bodies, flyTo, goBack, launchComet, cometState, get mode() { return mode; } };
