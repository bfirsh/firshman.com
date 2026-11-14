import * as THREE from 'three';
import { projects, now, email, socials, alsoWorkedOn, name } from '../../../data/bio';

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

// ---------------------------------------------------------------- renderer
const cv = $<HTMLCanvasElement>('#scene');
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
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.transmissionResolutionScale = DPR > 1 ? 0.6 : 0.85;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0a0d);
const pmrem = new THREE.PMREMGenerator(renderer);
// a dark studio with one warm softbox and a cool strip: clean, deliberate reflections on the glass
{
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x0a0809);
  const panel = (w: number, h: number, c: THREE.Color, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); studio.add(m);
  };
  panel(9, 1.1, new THREE.Color(1.0, 0.86, 0.68).multiplyScalar(5), -3, 12, 2.5);
  panel(6, 2.5, new THREE.Color(1.0, 0.85, 0.65).multiplyScalar(0.5), 0, 3, 12);
  panel(1.2, 9, new THREE.Color(0.75, 0.85, 1.0).multiplyScalar(2.2), 9, 1, -3);
  panel(14, 3, new THREE.Color(0.35, 0.25, 0.2).multiplyScalar(0.6), 0, -6, 4);
  panel(4, 1.4, new THREE.Color(1, 0.95, 0.9).multiplyScalar(1.5), 3, 6, -8);
  scene.environment = pmrem.fromScene(studio, 0.02).texture;
}
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 100);
const LOOK = new THREE.Vector3(0, -0.25, 0);

// ---------------------------------------------------------------- light
const spot = new THREE.SpotLight(0xffe2bd, 260, 0, 0.36, 0.85, 2);
spot.position.set(3.2, 11, 6);
spot.target.position.set(0, -1, 0);
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
spot.shadow.bias = -0.0015;
spot.shadow.normalBias = 0.035;
spot.shadow.radius = 3;
spot.shadow.camera.near = 4;
spot.shadow.camera.far = 22;
scene.add(spot, spot.target);
scene.add(new THREE.HemisphereLight(0x7f93c4, 0x2a1a12, 0.55));
const rim = new THREE.DirectionalLight(0x9db8ff, 1.3);
rim.position.set(-5, 4, -7);
scene.add(rim);

// ---------------------------------------------------------------- helpers
function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function tex(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.85, metal = 0) {
  const k = `${color}|${rough}|${metal}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(k)!;
}
const snowMat = new THREE.MeshStandardMaterial({ color: 0xf6f8fc, roughness: 0.92 });
const lit = new THREE.MeshStandardMaterial({ color: 0x3a2508, emissive: 0xffb54d, emissiveIntensity: 2.2, roughness: 0.6 });
function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = cast; o.receiveShadow = true;
  return o;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------- terrain
const GR = 3; // glass radius
const BASE_Y = -1.5;
const H = (x: number, z: number) => BASE_Y + 0.8 * Math.exp(-(x * x + z * z) / 2.2) + 0.035 * Math.sin(3 * x + 1) * Math.cos(2.6 * z) + 0.02;

const globe = new THREE.Group(); // everything that turns when you drag
scene.add(globe);
const town = new THREE.Group();
globe.add(town);

{
  const g = new THREE.RingGeometry(0.0001, 2.63, 128, 28);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const ground = mesh(g, snowMat, 0, 0, 0, false);
  town.add(ground);
  // a skirt of snow down to the base, hidden behind the glass edge
  const skirt = mesh(new THREE.CylinderGeometry(2.63, 2.63, 0.1, 96, 1, true), snowMat, 0, BASE_Y - 0.03, 0, false);
  town.add(skirt);
}

// ---------------------------------------------------------------- buildings
type Cap = { mesh: THREE.Mesh; count: number; minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
type Spot = {
  key: string; kicker: string; name: string; blurb?: string; url?: string; links?: { name: string; url: string }[];
  group: THREE.Object3D; caps: THREE.Mesh[]; capData: Cap[]; hit?: THREE.Mesh; top: THREE.Vector3; note: number;
};
const spots: Spot[] = [];
const winMarkers: THREE.Object3D[] = [];
const animators: ((t: number, dt: number) => void)[] = [];

function win(parent: THREE.Object3D, x: number, y: number, z: number, ry = 0, w = 0.05, h = 0.07) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z); o.rotation.y = ry; o.scale.set(w, h, 1);
  parent.add(o); winMarkers.push(o);
}
/** windows on the front (+z) and back faces of a box */
function windows(parent: THREE.Object3D, w: number, d: number, rows: number[], cols: number, both = true, ww = 0.05, wh = 0.07) {
  for (const y of rows) for (let i = 0; i < cols; i++) {
    const x = cols === 1 ? 0 : -w / 2 + (w / (cols + 1)) * (i + 1);
    win(parent, x, y, d / 2 + 0.002, 0, ww, wh);
    if (both) win(parent, -x, y, -d / 2 - 0.002, Math.PI, ww, wh);
  }
}
function capSlab(parent: THREE.Object3D, list: THREE.Mesh[], w: number, d: number, x: number, y: number, z: number, rz = 0) {
  const c = mesh(new THREE.BoxGeometry(w, 0.05, d), snowMat, x, y, z);
  c.rotation.z = rz;
  c.geometry.translate(0, 0.025, 0);
  parent.add(c);
  list.push(c);
  return c;
}
/** a gable roof sitting at y on a w × d footprint; ridge along z */
function gable(parent: THREE.Object3D, caps: THREE.Mesh[], w: number, d: number, h: number, y: number, color: string) {
  const s = new THREE.Shape();
  const o = 0.035;
  s.moveTo(-w / 2 - o, 0); s.lineTo(w / 2 + o, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d + o * 2, bevelEnabled: false });
  g.translate(0, 0, -(d + o * 2) / 2);
  const roof = mesh(g, mat(color, 0.8), 0, y, 0);
  parent.add(roof);
  const ang = Math.atan2(h, w / 2 + o);
  const len = Math.hypot(h, w / 2 + o);
  for (const side of [-1, 1]) {
    capSlab(parent, caps, len * 0.98, d + o * 2, side * (w / 4 + o / 2) - side * 0.006, y + h / 2 - 0.01, 0, -side * ang);
  }
  return roof;
}
function pyramid(parent: THREE.Object3D, caps: THREE.Mesh[], w: number, h: number, y: number, color: string) {
  const r = (w / 2) * Math.SQRT2 + 0.03;
  const roof = mesh(new THREE.ConeGeometry(r, h, 4, 1), mat(color, 0.8), 0, y + h / 2, 0);
  roof.rotation.y = Math.PI / 4;
  parent.add(roof);
  const cap = mesh(new THREE.ConeGeometry(r * 0.62, h * 0.55, 4, 1), snowMat, 0, y + h * 0.74, 0);
  cap.rotation.y = Math.PI / 4;
  cap.geometry.translate(0, -h * 0.275, 0);
  parent.add(cap);
  caps.push(cap);
  return roof;
}
function signTex(text: string, w: number, h: number, bg: string, fg: string, font: string, glow = '') {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (glow) { g.shadowColor = glow; g.shadowBlur = h * 0.25; }
  g.fillStyle = fg; g.fillText(text, w / 2, h / 2 + h * 0.04);
  return { c, t: tex(c) };
}
function place(o: THREE.Object3D, angleDeg: number, r: number, face = true, sink = 0.04, scale = 1.18) {
  o.scale.multiplyScalar(scale);
  const a = THREE.MathUtils.degToRad(angleDeg);
  const x = Math.sin(a) * r, z = Math.cos(a) * r;
  o.position.set(x, H(x, z) - sink, z);
  if (face) o.rotation.y = a;
  town.add(o);
  return o;
}
function addSpot(s: Omit<Spot, 'capData' | 'top'>) {
  const full = { ...s, capData: [], top: new THREE.Vector3() } as Spot;
  spots.push(full);
  return full;
}
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093];

// Replicate: the town hall
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.78, h = 0.42, d = 0.48;
  g.add(mesh(box(w + 0.06, 0.12, d + 0.06), mat('#bfb2a0'), 0, 0.02, 0));
  g.add(mesh(box(w, h, d), mat('#efe3cc'), 0, 0.08 + h / 2, 0));
  windows(g, w, d, [0.2, 0.37], 5, true, 0.055, 0.085);
  for (const s of [-1, 1]) for (const y of [0.2, 0.37]) win(g, s * (w / 2 + 0.002), y, 0, s * Math.PI / 2, 0.055, 0.085);
  const door = mesh(box(0.11, 0.16, 0.02), lit, 0, 0.16, d / 2 + 0.01); g.add(door);
  gable(g, caps, w, d, 0.22, 0.08 + h, '#7d2c22');
  // sign
  const sign = signTex(now.name.toUpperCase(), 512, 96, '#1b1310', '#ffd79a', '600 62px Fraunces, Georgia, serif', '#ffae42');
  const sm = new THREE.MeshStandardMaterial({ map: sign.t, emissive: 0xffffff, emissiveMap: sign.t, emissiveIntensity: 1.3, roughness: 0.5 });
  const signM = mesh(new THREE.PlaneGeometry(0.46, 0.086), sm, 0, 0.08 + h - 0.065, d / 2 + 0.004, false);
  g.add(signM);
  document.fonts?.load('600 62px Fraunces').then(() => {
    const s2 = signTex(now.name.toUpperCase(), 512, 96, '#1b1310', '#ffd79a', '600 62px Fraunces, Georgia, serif', '#ffae42');
    sm.map = s2.t; sm.emissiveMap = s2.t; sm.needsUpdate = true;
  }).catch(() => {});
  // tower with a lantern
  const tw = 0.2, th = 0.3, ty = 0.08 + h + 0.1;
  g.add(mesh(box(tw, th, tw), mat('#efe3cc'), 0, ty + th / 2, 0));
  win(g, 0, ty + th * 0.62, tw / 2 + 0.002, 0, 0.07, 0.1);
  win(g, 0, ty + th * 0.62, -tw / 2 - 0.002, Math.PI, 0.07, 0.1);
  pyramid(g, caps, tw, 0.2, ty + th, '#7d2c22');
  const glow = new THREE.PointLight(0xffa64a, 2.4, 2.6, 1.6);
  glow.position.set(0, 0.35, 0.5);
  g.add(glow);
  place(g, 0, 0, true, 0.05, 1.12);
  addSpot({ key: 'replicate', kicker: 'Town hall · now', name: now.name, blurb: `Where I work now. It lets you ${now.blurb}.`, url: now.url, group: g, caps, note: 0 });
}

// Docker Compose: a house made of stacked containers
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const [cc, cg] = canvas(128, 64);
  cg.fillStyle = '#fff'; cg.fillRect(0, 0, 128, 64);
  for (let x = 0; x < 128; x += 8) { cg.fillStyle = 'rgba(0,0,0,0.22)'; cg.fillRect(x, 0, 3, 64); }
  const ribs = tex(cc);
  const cm = (c: string) => new THREE.MeshStandardMaterial({ color: c, map: ribs, roughness: 0.6, metalness: 0.2 });
  const L = 0.4, CH = 0.13, CD = 0.16;
  const stack: [number, number, number, string, number][] = [
    [-0.02, 0, 0.09, '#2a7fd4', 0], [0.03, 0, -0.09, '#c9472d', 0], [0.0, 1, 0.0, '#e7b13a', Math.PI / 2], [0.06, 2, 0.02, '#3f8f5e', 0.15],
  ];
  stack.forEach(([x, lvl, z, c, ry], i) => {
    const m = mesh(box(L, CH, CD), cm(c), x, 0.03 + CH / 2 + lvl * CH, z);
    m.rotation.y = ry;
    g.add(m);
    if (i !== 2) win(m, 0.08, 0, CD / 2 + 0.002, 0, 0.05, 0.05);
    if (i === 2) win(m, -0.06, 0, CD / 2 + 0.002, 0, 0.05, 0.05);
  });
  const top = g.children[3] as THREE.Mesh;
  const c = capSlab(top, caps, L * 0.96, CD * 0.92, 0, CH / 2, 0);
  c.userData.local = true;
  g.add(mesh(box(0.04, 0.12, 0.04), mat('#5b4a44'), -0.12, 0.03 + CH * 3 + 0.03, 0.02));
  place(g, 42, 1.5);
  addSpot({ key: 'compose', kicker: 'The container house', name: P.compose.name, blurb: P.compose.blurb, url: P.compose.url, group: g, caps, note: 2 });
}

// Cog: a clock tower with a cog for a face
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.22, h = 0.82;
  g.add(mesh(box(w + 0.05, 0.1, w + 0.05), mat('#6d6870'), 0, 0.03, 0));
  g.add(mesh(box(w, h, w), mat('#a29a92'), 0, h / 2, 0));
  win(g, 0, 0.18, w / 2 + 0.002, 0, 0.05, 0.09);
  win(g, 0, 0.36, w / 2 + 0.002, 0, 0.05, 0.09);
  pyramid(g, caps, w, 0.26, h, '#3e3a44');
  const teeth = 12, ro = 0.1, ri = 0.082;
  const s = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, st = (Math.PI * 2) / teeth;
    const pts: [number, number][] = [[ri, a0], [ro, a0 + st * 0.15], [ro, a0 + st * 0.45], [ri, a0 + st * 0.6]];
    pts.forEach(([rr, a], j) => { const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.022, 0, Math.PI * 2, true); s.holes.push(hole);
  const gearGeo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false, curveSegments: 3 });
  const brass = mat('#d7a94f', 0.32, 1);
  const gears: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    const face = mesh(new THREE.CircleGeometry(0.075, 32), lit, 0, h - 0.17, side * (w / 2 + 0.003), false);
    if (side < 0) face.rotation.y = Math.PI;
    g.add(face);
    const gear = mesh(gearGeo, brass, 0, h - 0.17, side * (w / 2 + 0.006), false);
    if (side < 0) gear.rotation.y = Math.PI;
    g.add(gear); gears.push(gear);
  }
  animators.push((_t, dt) => { gears.forEach((x, i) => (x.rotation.z += dt * (i ? -0.5 : 0.5))); });
  place(g, -52, 1.3);
  addSpot({ key: 'cog', kicker: 'The clock tower', name: P.cog.name, blurb: P.cog.blurb, url: P.cog.url, group: g, caps, note: 4 });
}

// JSNES: the arcade
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.46, h = 0.3, d = 0.32;
  g.add(mesh(box(w, h, d), mat('#3a2b5a'), 0, h / 2, 0));
  const screen = new THREE.MeshStandardMaterial({ color: 0x0a1630, emissive: 0x58c7ff, emissiveIntensity: 1.6 });
  for (let i = 0; i < 3; i++) g.add(mesh(box(0.08, 0.1, 0.01), screen, -0.14 + i * 0.14, 0.13, d / 2 + 0.006, false));
  g.add(mesh(box(0.1, 0.2, 0.01), lit, 0.16, 0.1, -d / 2 - 0.006, false));
  capSlab(g, caps, w, d, 0, h, 0);
  const sign = signTex('JSNES', 256, 80, '#120a1c', '#ff4f7b', '800 58px ui-monospace, Menlo, Consolas, monospace', '#ff2d6b');
  const neon = new THREE.MeshStandardMaterial({ map: sign.t, emissive: 0xffffff, emissiveMap: sign.t, emissiveIntensity: 1.8, roughness: 0.5 });
  const board = mesh(new THREE.PlaneGeometry(0.36, 0.11), neon, 0, h + 0.1, 0.02, false);
  g.add(board);
  const back = mesh(box(0.37, 0.12, 0.015), mat('#1b1424'), 0, h + 0.1, 0.01);
  g.add(back);
  g.add(mesh(box(0.012, 0.06, 0.012), mat('#1b1424'), -0.12, h + 0.03, 0.01), mesh(box(0.012, 0.06, 0.012), mat('#1b1424'), 0.12, h + 0.03, 0.01));
  animators.push((t) => { neon.emissiveIntensity = 1.6 + (Math.sin(t * 13) > 0.97 ? -1.2 : 0) + Math.sin(t * 2) * 0.15; });
  place(g, 92, 1.62);
  addSpot({ key: 'jsnes', kicker: 'The arcade', name: P.jsnes.name, blurb: P.jsnes.blurb, url: P.jsnes.url, group: g, caps, note: 7 });
}

// arXiv Vanity: the library
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.52, h = 0.28, d = 0.34;
  const stone = mat('#e9e1d2', 0.75);
  g.add(mesh(box(w + 0.1, 0.05, d + 0.12), mat('#cfc6b6'), 0, 0.0, 0.02));
  g.add(mesh(box(w + 0.06, 0.04, d + 0.08), mat('#ddd5c6'), 0, 0.045, 0.02));
  g.add(mesh(box(w - 0.04, h, d - 0.08), stone, 0, 0.065 + h / 2, -0.03));
  windows(g, w - 0.04, d - 0.08 - 0.06, [0.2], 3, false, 0.05, 0.11);
  const colGeo = new THREE.CylinderGeometry(0.018, 0.022, h, 12);
  for (let i = 0; i < 4; i++) g.add(mesh(colGeo, stone, -0.2 + i * 0.133, 0.065 + h / 2, d / 2 - 0.01));
  g.add(mesh(box(w + 0.02, 0.04, d + 0.02), stone, 0, 0.065 + h + 0.02, 0));
  // the pediment faces front, so the ridge runs left to right
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI / 2;
  g.add(holder);
  gable(holder, caps, d + 0.02, w + 0.02, 0.13, 0.065 + h + 0.04, '#d8cfbf');
  place(g, -98, 1.62);
  addSpot({ key: 'arxiv-vanity', kicker: 'The library', name: P['arxiv-vanity'].name, blurb: P['arxiv-vanity'].blurb, url: P['arxiv-vanity'].url, group: g, caps, note: 5 });
}

// UKHAS: a launch pad with a balloon
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const [pc, pg] = canvas(256, 256);
  pg.fillStyle = '#3a3a40'; pg.fillRect(0, 0, 256, 256);
  pg.strokeStyle = '#f2c230'; pg.lineWidth = 14; pg.beginPath(); pg.arc(128, 128, 100, 0, Math.PI * 2); pg.stroke();
  pg.fillStyle = '#f2f2f2'; pg.font = '800 110px Figtree, sans-serif'; pg.textAlign = 'center'; pg.textBaseline = 'middle'; pg.fillText('H', 128, 134);
  const pad = mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.05, 40), [mat('#4a4a52'), new THREE.MeshStandardMaterial({ map: tex(pc), roughness: 0.8 }), mat('#4a4a52')] as unknown as THREE.Material, 0, 0.03, 0);
  g.add(pad);
  capSlab(g, caps, 0.2, 0.2, 0, 0.055, 0).visible = false;
  const shed = mesh(box(0.12, 0.1, 0.1), mat('#d9d2c4'), 0.2, 0.06, -0.16);
  g.add(shed);
  win(shed, 0, 0.005, 0.052, 0, 0.04, 0.04);
  const balloon = new THREE.Group();
  const envMat = new THREE.MeshPhysicalMaterial({ color: 0xfffaf2, roughness: 0.3, clearcoat: 1, sheen: 0.6, sheenColor: new THREE.Color(0xffe7c8) });
  const env = mesh(new THREE.SphereGeometry(0.11, 32, 20), envMat, 0, 0, 0);
  env.scale.set(1, 1.15, 1);
  balloon.add(env);
  balloon.add(mesh(new THREE.ConeGeometry(0.02, 0.04, 10), envMat, 0, -0.135, 0));
  const chute = mesh(new THREE.SphereGeometry(0.035, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e2412e', 0.6), 0, -0.2, 0);
  balloon.add(chute);
  const payload = mesh(box(0.035, 0.03, 0.035), mat('#ff8a1f', 0.5), 0, -0.3, 0);
  balloon.add(payload);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.15, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, -0.6, 0)]);
  const tether = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xd9d4ca }));
  balloon.add(tether);
  g.add(balloon);
  animators.push((t) => {
    const y = 0.68 + Math.sin(t * 1.1) * 0.03;
    balloon.position.set(Math.sin(t * 0.7) * 0.025, y, Math.cos(t * 0.9) * 0.02);
    balloon.rotation.z = Math.sin(t * 0.8) * 0.06;
    const pos = lineGeo.attributes.position as THREE.BufferAttribute;
    pos.setY(3, -(y - 0.06)); pos.needsUpdate = true;
  });
  place(g, 150, 1.5);
  addSpot({ key: 'ukhas', kicker: 'The launch pad', name: P.ukhas.name, blurb: P.ukhas.blurb, url: P.ukhas.url, group: g, caps, note: 9 });
}

// Django: a green cottage
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.36, h = 0.26, d = 0.3;
  g.add(mesh(box(w, h, d), mat('#2f6e50'), 0, h / 2, 0));
  g.add(mesh(box(0.08, 0.14, 0.012), mat('#f0e6cf'), 0.08, 0.07, d / 2 + 0.006));
  win(g, 0.08, 0.06, d / 2 + 0.014, 0, 0.05, 0.1);
  windows(g, w, d, [0.15], 1, true);
  win(g, -0.09, 0.15, d / 2 + 0.002);
  gable(g, caps, w, d, 0.17, h, '#0c4b33');
  g.add(mesh(box(0.05, 0.12, 0.05), mat('#7b5a48'), 0.1, h + 0.1, -0.06));
  place(g, -150, 1.55);
  addSpot({ key: 'django', kicker: 'The green cottage', name: P.django.name, blurb: P.django.blurb, url: P.django.url, group: g, caps, note: 3 });
}

// CLIG: a signpost, obviously
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const wood = mat('#8b6038', 0.8);
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.42, 8), wood, 0, 0.21, 0));
  const boards: [string, number, number][] = [['--help', 0.36, 0.5], ['man', 0.28, -0.7], ['-v', 0.2, 0.15]];
  boards.forEach(([label, y, ry]) => {
    const t = signTex(label, 256, 64, '#efe2c4', '#2b221d', '700 40px ui-monospace, Menlo, Consolas, monospace');
    const m = new THREE.MeshStandardMaterial({ map: t.t, roughness: 0.8 });
    const arm = new THREE.Group(); arm.rotation.y = ry; arm.position.y = y;
    const s = new THREE.Shape();
    s.moveTo(0, -0.025); s.lineTo(0.16, -0.025); s.lineTo(0.19, 0); s.lineTo(0.16, 0.025); s.lineTo(0, 0.025); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    geo.translate(0, 0, -0.006);
    // planar UVs for the label
    const uv = geo.attributes.uv as THREE.BufferAttribute, pp = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 0.19, (pp.getY(i) + 0.025) / 0.05);
    const b = mesh(geo, m, 0.01, 0, 0);
    arm.add(b);
    capSlab(arm, caps, 0.17, 0.016, 0.095, 0.025, 0);
    g.add(arm);
  });
  // a lamp beside it
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.34, 6), mat('#24232a', 0.5, 0.6), -0.1, 0.17, 0.05));
  g.add(mesh(new THREE.SphereGeometry(0.022, 12, 8), lit, -0.1, 0.35, 0.05, false));
  place(g, 4, 2.05, true, 0.02);
  addSpot({ key: 'clig', kicker: 'The signpost', name: P.clig.name, blurb: P.clig.blurb, url: P.clig.url, group: g, caps, note: 6 });
}

// Docker Machine: the machine shop
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const w = 0.42, h = 0.22, d = 0.3;
  g.add(mesh(box(w, h, d), mat('#8e3b2e'), 0, h / 2, 0));
  windows(g, w, d, [0.12], 3, true, 0.06, 0.08);
  // sawtooth roof
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(w / 2, 0); s.lineTo(0, 0.1); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: d + 0.02, bevelEnabled: false }); geo.translate(0, 0, -(d + 0.02) / 2);
    const r = mesh(geo, mat('#3d3434', 0.7), -w / 2 + i * (w / 2), h, 0); g.add(r);
    win(g, -w / 2 + i * (w / 2) + 0.005, h + 0.05, 0, -Math.PI / 2, 0.14, 0.05);
    capSlab(g, caps, Math.hypot(w / 2, 0.1) * 0.95, d + 0.02, -w / 2 + i * (w / 2) + w / 4, h + 0.045, 0, -Math.atan2(0.1, w / 2));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.28, 10), mat('#5a4a44'), 0.14, h + 0.12, -0.08));
  // smoke puffs
  const [sc, sg] = canvas(64, 64);
  const gr = sg.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(235,235,240,0.9)'); gr.addColorStop(1, 'rgba(235,235,240,0)');
  sg.fillStyle = gr; sg.fillRect(0, 0, 64, 64);
  const smokeT = tex(sc);
  const puffs = Array.from({ length: 5 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeT, transparent: true, depthWrite: false, opacity: 0.5 }));
    s.userData.o = i / 5; g.add(s); return s;
  });
  animators.push((t) => puffs.forEach((p) => {
    const k = (t * 0.18 + p.userData.o) % 1;
    p.position.set(0.14 + Math.sin(k * 5 + p.userData.o * 9) * 0.03 + k * 0.08, h + 0.27 + k * 0.4, -0.08);
    p.scale.setScalar(0.06 + k * 0.14);
    (p.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k) * Math.min(1, k * 6);
  }));
  place(g, 178, 1.42);
  addSpot({ key: 'machine', kicker: 'The machine shop', name: P.machine.name, blurb: P.machine.blurb, url: P.machine.url, group: g, caps, note: 1 });
}

// Whalebrew: a barrel brewery with a whale-tail weathervane
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const r = 0.17, h = 0.32;
  const barrel = mesh(new THREE.CylinderGeometry(r, r * 1.08, h, 28), mat('#93603a', 0.75), 0, h / 2, 0);
  g.add(barrel);
  for (const y of [0.05, h - 0.05]) g.add(mesh(new THREE.TorusGeometry(r * 1.06 - (y > 0.1 ? 0.01 : 0), 0.008, 6, 40), mat('#3a3436', 0.4, 0.8), 0, y, 0).rotateX(Math.PI / 2));
  win(g, 0, 0.17, r + 0.012, 0, 0.06, 0.08);
  win(g, r * 0.72, 0.17, r * 0.72 + 0.012, Math.PI / 4, 0.045, 0.07);
  win(g, -r * 0.72, 0.17, r * 0.72 + 0.012, -Math.PI / 4, 0.045, 0.07);
  const roof = mesh(new THREE.ConeGeometry(r * 1.15, 0.16, 28), mat('#3c4a5c', 0.7), 0, h + 0.08, 0);
  g.add(roof);
  const cap = mesh(new THREE.ConeGeometry(r * 0.8, 0.11, 28), snowMat, 0, h + 0.16, 0);
  cap.geometry.translate(0, -0.055, 0);
  g.add(cap); caps.push(cap);
  g.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6), mat('#2a2a2a', 0.4, 0.8), 0, h + 0.22, 0));
  const fs = new THREE.Shape();
  fs.moveTo(0, 0); fs.bezierCurveTo(0.012, 0.025, 0.035, 0.045, 0.075, 0.055); fs.bezierCurveTo(0.05, 0.035, 0.022, 0.035, 0, 0.04);
  fs.bezierCurveTo(-0.022, 0.035, -0.05, 0.035, -0.075, 0.055); fs.bezierCurveTo(-0.035, 0.045, -0.012, 0.025, 0, 0);
  const vane = new THREE.Group();
  const fluke = mesh(new THREE.ExtrudeGeometry(fs, { depth: 0.008, bevelEnabled: false }), mat('#c9a14a', 0.3, 1), 0, 0, -0.004);
  vane.add(fluke);
  vane.position.y = h + 0.28;
  g.add(vane);
  animators.push((t) => { vane.rotation.y = Math.sin(t * 0.4) * 0.9; });
  place(g, -128, 2.05);
  addSpot({ key: 'whalebrew', kicker: 'The brewery', name: P.whalebrew.name, blurb: P.whalebrew.blurb, url: P.whalebrew.url, group: g, caps, note: 8 });
}

// Also worked on: a terrace on the old street
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const cols = ['#c4785a', '#e1c79a', '#7c8fa8', '#b65b52', '#d6d0c2'];
  let x = -0.3;
  cols.forEach((c, i) => {
    const w = 0.12, h = 0.24 + ((i * 7) % 3) * 0.04, d = 0.2;
    const hs = new THREE.Group(); hs.position.x = x + w / 2; g.add(hs);
    hs.add(mesh(box(w, h, d), mat(c), 0, h / 2, 0));
    win(hs, 0, h - 0.07, d / 2 + 0.002, 0, 0.04, 0.05);
    if (i % 2 === 0) win(hs, 0, 0.07, d / 2 + 0.002, 0, 0.04, 0.05);
    gable(hs, caps, w, d, 0.07, h, '#4a3b38');
    x += w + 0.005;
  });
  place(g, 62, 2.12);
  addSpot({
    key: 'also', kicker: 'The old street', name: 'Also worked on', blurb: 'Five houses, lots of other people.',
    links: alsoWorkedOn, group: g, caps, note: 10,
  });
}

// Ben, building a snowman
{
  const g = new THREE.Group(); const caps: THREE.Mesh[] = [];
  const sm = new THREE.Group(); sm.position.set(0.09, 0, 0); g.add(sm);
  sm.add(mesh(new THREE.SphereGeometry(0.06, 20, 14), snowMat, 0, 0.05, 0));
  sm.add(mesh(new THREE.SphereGeometry(0.045, 20, 14), snowMat, 0, 0.135, 0));
  const head = new THREE.Group(); sm.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.032, 20, 14), snowMat, 0, 0, 0));
  head.add(mesh(new THREE.ConeGeometry(0.007, 0.035, 8), mat('#f07a1a', 0.6), 0, 0, 0.042).rotateX(Math.PI / 2));
  for (const s of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.004, 6, 4), mat('#111'), s * 0.012, 0.01, 0.029, false));
  const ben = new THREE.Group(); ben.position.set(-0.05, 0, 0.02); ben.rotation.y = 1.0; g.add(ben);
  const coat = mat('#28344d', 0.8);
  ben.add(mesh(new THREE.CapsuleGeometry(0.026, 0.06, 4, 10), coat, 0, 0.075, 0));
  ben.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6), mat('#2b2522'), -0.012, 0.02, 0), mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6), mat('#2b2522'), 0.012, 0.02, 0));
  ben.add(mesh(new THREE.SphereGeometry(0.022, 16, 12), mat('#e8b896', 0.7), 0, 0.152, 0));
  ben.add(mesh(new THREE.SphereGeometry(0.023, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#b8362c', 0.9), 0, 0.157, 0));
  ben.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), mat('#f4ecdf'), 0, 0.182, 0));
  ben.add(mesh(new THREE.TorusGeometry(0.02, 0.007, 6, 16), mat('#b8362c', 0.9), 0, 0.125, 0).rotateX(Math.PI / 2));
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 0.03, 0.115, 0); ben.add(a);
    a.add(mesh(new THREE.CapsuleGeometry(0.008, 0.04, 3, 6), coat, 0, -0.025, 0));
    arms.push(a);
  }
  animators.push((t) => {
    const k = (t * 0.35) % 1; // lift the head on, pat it, step back
    const lift = k < 0.4 ? Math.sin((k / 0.4) * Math.PI) : 0;
    head.position.set(0, 0.19 + lift * 0.05, 0);
    arms.forEach((a, i) => { a.rotation.x = -0.4 - lift * 1.5 - (k > 0.5 && k < 0.8 ? Math.abs(Math.sin(t * 14)) * 0.5 * (i ? 1 : 0.4) : 0); });
    ben.position.y = Math.abs(Math.sin(t * 2.2)) * 0.004;
  });
  place(g, -22, 1.95, true, 0.01);
  g.rotation.y += 0.4;
  addSpot({
    key: 'ben', kicker: 'A tiny resident', name: `${name}, building a snowman`, blurb: 'Say hello. He is easier to reach than he looks.',
    links: [{ name: email, url: `mailto:${email}` }, ...socials.map((s) => ({ name: `${s.name} · ${s.handle}`, url: s.url }))], group: g, caps, note: 4,
  });
}

// trees and lamps
{
  const trunk = mat('#4a3426');
  const needles = mat('#1f4a3a', 0.9);
  const treeSpots: [number, number, number][] = [[18, 2.2, 1], [-40, 2.25, 0.8], [118, 2.18, 1.1], [-75, 2.25, 0.9], [205, 2.1, 1], [-170, 2.25, 0.85], [72, 1.25, 0.7], [-118, 1.2, 0.75], [135, 2.35, 0.8], [30, 0.95, 0.65], [-30, 0.95, 0.6], [230, 1.0, 0.7]];
  for (const [a, r, s] of treeSpots) {
    const t = new THREE.Group();
    t.add(mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.08, 6), trunk, 0, 0.04, 0));
    for (let i = 0; i < 3; i++) {
      t.add(mesh(new THREE.ConeGeometry(0.11 - i * 0.025, 0.14, 8), needles, 0, 0.11 + i * 0.075, 0));
      t.add(mesh(new THREE.ConeGeometry(0.075 - i * 0.018, 0.05, 8), snowMat, 0, 0.16 + i * 0.075, 0));
    }
    t.scale.setScalar(s);
    place(t, a, r, false, 0.02, 1.1);
  }
  for (const [a, r] of [[25, 1.65], [-82, 1.95], [130, 1.9], [-14, 1.0]] as [number, number][]) {
    const l = new THREE.Group();
    l.add(mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.26, 6), mat('#24232a', 0.5, 0.6), 0, 0.13, 0));
    l.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), lit, 0, 0.27, 0, false));
    place(l, a, r, false, 0.01, 1.1);
  }
}

// window instances
{
  town.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(town.matrixWorld).invert();
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), lit, winMarkers.length);
  const m = new THREE.Matrix4();
  winMarkers.forEach((o, i) => { m.multiplyMatrices(inv, o.matrixWorld); im.setMatrixAt(i, m); o.parent?.remove(o); });
  im.instanceMatrix.needsUpdate = true;
  town.add(im);
}

// hit boxes, label anchors and roof footprints (town space; the town is at the origin while we build)
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
town.updateMatrixWorld(true);
for (const s of spots) {
  const b = new THREE.Box3().setFromObject(s.group);
  if (s.key === 'replicate') b.max.y -= 0.0;
  const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.2) * 1.08, Math.max(size.y, 0.2) * 1.05, Math.max(size.z, 0.2) * 1.08), hitMat);
  hit.position.copy(c);
  hit.userData.spot = s;
  town.add(hit);
  s.hit = hit;
  s.top.set(c.x, b.max.y + 0.04, c.z);
  for (const cap of s.caps) {
    const cb = new THREE.Box3().setFromObject(cap);
    s.capData.push({ mesh: cap, count: 0, minX: cb.min.x, maxX: cb.max.x, minZ: cb.min.z, maxZ: cb.max.z, minY: cb.min.y - 0.06, maxY: cb.max.y + 0.01 });
    cap.scale.y = 0.35;
  }
}
const allCaps = spots.flatMap((s) => s.capData);

// ---------------------------------------------------------------- glass, base, plaque
const glass = new THREE.Mesh(
  new THREE.SphereGeometry(GR, 96, 64, 0, Math.PI * 2, 0, Math.acos(BASE_Y / GR)),
  new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.12, ior: 1.45,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0, specularIntensity: 1, depthWrite: false,
  }),
);
glass.renderOrder = 2;
globe.add(glass);

function woodTex() {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#6a3c22'; g.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 256;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '20,10,5' : '120,70,40'},${0.1 + Math.random() * 0.25})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 3 + Math.sin(x * 0.043 + i * 3) * 1.5);
    g.stroke();
  }
  const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}
{
  const prof: [number, number][] = [
    [0, BASE_Y + 0.02], [2.62, BASE_Y + 0.02], [2.72, BASE_Y - 0.02], [2.82, BASE_Y - 0.12], [2.82, BASE_Y - 0.2], [2.76, BASE_Y - 0.26],
    [2.84, BASE_Y - 0.34], [2.96, BASE_Y - 0.42], [3.06, BASE_Y - 1.12], [3.14, BASE_Y - 1.2], [3.28, BASE_Y - 1.36], [3.3, BASE_Y - 1.5], [0, BASE_Y - 1.5],
  ];
  const base = mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)).reverse(), 128), new THREE.MeshPhysicalMaterial({
    map: woodTex(), roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.18, color: 0xffffff,
  }));
  base.receiveShadow = false;
  globe.add(base);
  const brassRing = mesh(new THREE.TorusGeometry(2.64, 0.045, 10, 160), mat('#c9a04c', 0.28, 1), 0, BASE_Y + 0.01, 0);
  brassRing.rotation.x = Math.PI / 2;
  globe.add(brassRing);
}
let plaqueMesh: THREE.Mesh;
{
  const W = 1536, Hh = 280;
  const [c, g] = canvas(W, Hh);
  const draw = () => {
    const gr = g.createLinearGradient(0, 0, 0, Hh);
    gr.addColorStop(0, '#f3d892'); gr.addColorStop(0.45, '#c99a45'); gr.addColorStop(1, '#8a6427');
    g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,240,200,${Math.random() * 0.06})`; g.fillRect(0, Math.random() * Hh, W, 1); }
    g.strokeStyle = 'rgba(60,38,10,0.8)'; g.lineWidth = 5; g.strokeRect(18, 18, W - 36, Hh - 36);
    g.lineWidth = 2; g.strokeRect(32, 32, W - 64, Hh - 64);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const engrave = (txt: string, y: number, font: string, spacing: string) => {
      g.font = font;
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = spacing;
      g.fillStyle = 'rgba(255,245,215,0.65)'; g.fillText(txt, W / 2 + 2, y + 2);
      g.fillStyle = '#3d2a0e'; g.fillText(txt, W / 2, y);
    };
    engrave(name.toUpperCase(), Hh * 0.4, '600 100px Fraunces, Georgia, serif', '18px');
    engrave(email, Hh * 0.74, 'italic 600 62px Fraunces, Georgia, serif', '3px');
    for (const x of [64, W - 64]) { g.fillStyle = '#6b4c1c'; g.beginPath(); g.arc(x, Hh / 2, 10, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#f1d38a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 7, Hh / 2 - 3); g.lineTo(x + 7, Hh / 2 + 3); g.stroke(); }
  };
  draw();
  const t = tex(c);
  document.fonts?.load('600 104px Fraunces').then(() => document.fonts.load('italic 600 62px Fraunces')).then(() => { draw(); t.needsUpdate = true; }).catch(() => {});
  const y0 = BASE_Y - 0.42, y1 = BASE_Y - 1.12, yc = (y0 + y1) / 2, ph = 0.5;
  const rAt = (y: number) => 2.96 + ((y0 - y) / (y0 - y1)) * 0.1 + 0.012;
  plaqueMesh = mesh(new THREE.CylinderGeometry(rAt(yc + ph / 2), rAt(yc - ph / 2), ph, 48, 1, true, -0.52, 1.04), new THREE.MeshStandardMaterial({ map: t, metalness: 0.55, roughness: 0.34, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 }), 0, yc, 0, false);
  globe.add(plaqueMesh);
  const s = addSpot({
    key: 'plaque', kicker: 'Engraved on the base', name, blurb: 'Write any time.',
    links: [{ name: email, url: `mailto:${email}` }, ...socials.map((x) => ({ name: `${x.name} · ${x.handle}`, url: x.url }))], group: plaqueMesh, caps: [], note: 0,
  });
  s.hit = plaqueMesh; plaqueMesh.userData.spot = s;
  s.top.set(0, yc + ph / 2 + 0.05, rAt(yc) + 0.02);
}

// the table
{
  const [c, g] = canvas(512, 512);
  const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  gr.addColorStop(0, '#3a2c28'); gr.addColorStop(0.5, '#1e1618'); gr.addColorStop(1, '#0c0a0d');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  const floor = mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.75, metalness: 0 }), 0, BASE_Y - 1.5, 0, false);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
}

// ---------------------------------------------------------------- snow
const N = 720;
const RS = GR - 0.14;
const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), state = new Uint8Array(N), phase = new Float32Array(N), sizes = new Float32Array(N);
const capOf = new Int16Array(N).fill(-1);
function randomInGlobe(i: number, yMin = BASE_Y + 0.4, yMax = 2.6) {
  for (;;) {
    const x = (Math.random() * 2 - 1) * RS, z = (Math.random() * 2 - 1) * RS, y = yMin + Math.random() * (yMax - yMin);
    if (x * x + y * y + z * z < RS * RS && y > H(x, z) + 0.05) { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; return; }
  }
}
for (let i = 0; i < N; i++) {
  randomInGlobe(i);
  phase[i] = Math.random() * 100;
  sizes[i] = 0.55 + Math.pow(Math.random(), 2) * 1.1;
  if (reduced && Math.random() < 0.6) {
    // start mostly settled when motion is reduced
    const x = pos[i * 3], z = pos[i * 3 + 2];
    pos[i * 3 + 1] = H(x, z) + 0.012; state[i] = 1;
  }
}
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
snowGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
const snowPts = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
  uniforms: { scale: { value: 1 } },
  vertexShader: `attribute float size; uniform float scale; varying float vA;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv;
      gl_PointSize = size * scale / -mv.z; vA = clamp(gl_PointSize / 2.0, 0.35, 1.0); }`,
  fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .15, d) * vA; if (a < .01) discard; gl_FragColor = vec4(vec3(1.0, 0.99, 0.97), a); }`,
  transparent: true, depthWrite: false,
}));
snowPts.frustumCulled = false;
snowPts.renderOrder = 3;
town.add(snowPts);

let energy = reduced ? 0 : 1.35;
let omega = 0; // globe spin, rad/s
let simT = 0;
function shake(amount: number) {
  energy = Math.min(reduced ? 0.4 : 1.5, Math.max(energy, amount));
}
function stepSnow(dt: number) {
  simT += dt;
  energy *= Math.exp(-dt * 0.42);
  const E = energy, t = simT;
  const lag = -omega * 0.55;
  const g = 0.34, drag = 2.6;
  for (let i = 0; i < N; i++) {
    const k = i * 3;
    let x = pos[k], y = pos[k + 1], z = pos[k + 2];
    if (state[i] === 1) {
      if (E > 0.5 || Math.abs(omega) > 3) {
        state[i] = 0;
        if (capOf[i] >= 0) { allCaps[capOf[i]].count = Math.max(0, allCaps[capOf[i]].count - 1); capOf[i] = -1; }
        vel[k] = (Math.random() - 0.5) * E; vel[k + 1] = (0.6 + Math.random()) * E * 1.4; vel[k + 2] = (Math.random() - 0.5) * E;
      } else if (E < 0.12 && Math.random() < dt * 0.0035) {
        // a little ambient snowfall forever
        randomInGlobe(i, 1.6, 2.7); state[i] = 0; vel[k] = vel[k + 1] = vel[k + 2] = 0;
        if (capOf[i] >= 0) { capOf[i] = -1; }
        continue;
      } else continue;
    }
    const ph = phase[i];
    const sw = E * 1.5;
    const ux = -z * sw * 0.75 + E * 0.9 * Math.sin(1.7 * y + t * 1.3 + z * 1.1 + ph * 0.1) + lag * z + Math.sin(t * 1.3 + ph) * 0.05;
    const uy = E * (1.1 * Math.cos(1.3 * x - t * 0.9) * Math.sin(1.1 * z + t * 0.7) + 0.6 * (1 - (x * x + z * z) / 4));
    const uz = x * sw * 0.75 + E * 0.9 * Math.cos(1.5 * y - t * 1.1 + x * 0.9 + ph * 0.1) - lag * x + Math.cos(t * 1.1 + ph * 1.3) * 0.05;
    vel[k] += (ux - vel[k]) * drag * dt;
    vel[k + 1] += ((uy - vel[k + 1]) * drag - g) * dt;
    vel[k + 2] += (uz - vel[k + 2]) * drag * dt;
    x += vel[k] * dt; y += vel[k + 1] * dt; z += vel[k + 2] * dt;
    const l2 = x * x + y * y + z * z;
    if (l2 > RS * RS) {
      const l = Math.sqrt(l2), nx = x / l, ny = y / l, nz = z / l;
      const vn = vel[k] * nx + vel[k + 1] * ny + vel[k + 2] * nz;
      if (vn > 0) { vel[k] -= nx * vn * 1.6; vel[k + 1] -= ny * vn * 1.6; vel[k + 2] -= nz * vn * 1.6; }
      x = nx * RS; y = ny * RS; z = nz * RS;
    }
    // roofs
    if (vel[k + 1] < 0) {
      for (let c = 0; c < allCaps.length; c++) {
        const cp = allCaps[c];
        if (x > cp.minX && x < cp.maxX && z > cp.minZ && z < cp.maxZ && y < cp.maxY && y > cp.minY) {
          state[i] = 1; capOf[i] = c; cp.count++;
          y = Math.min(y, cp.maxY);
          break;
        }
      }
    }
    const gh = H(x, z) + 0.012;
    if (y < gh) { y = gh; if (E < 0.6) state[i] = 1; else vel[k + 1] = Math.abs(vel[k + 1]) * 0.3; }
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
  }
  snowGeo.attributes.position.needsUpdate = true;
  for (const cp of allCaps) {
    const target = 0.35 + 0.65 * Math.min(1, cp.count / 10);
    cp.mesh.scale.y += (target - cp.mesh.scale.y) * Math.min(1, dt * (target < cp.mesh.scale.y ? 6 : 1.5));
  }
}

// ---------------------------------------------------------------- music box
let audio: AudioContext | null = null, master: GainNode | null = null, soundOn = false;
function note(f: number, when = 0, vel = 1) {
  if (!soundOn || !audio || !master) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator(), o2 = audio.createOscillator(), g = audio.createGain(), g2 = audio.createGain();
  o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 4.07;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.26 * vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.07 * vel, t + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(master); o2.connect(g2).connect(master);
  o.start(t); o2.start(t); o.stop(t + 1.9); o2.stop(t + 0.3);
}
function tinkle() { for (let i = 0; i < 7; i++) note(NOTES[Math.floor(Math.random() * NOTES.length)], i * 0.11 + Math.random() * 0.05, 0.55); }
const soundBtn = $<HTMLButtonElement>('#sound');
soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  if (soundOn && !audio) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio = new AC(); master = audio.createGain(); master.gain.value = 0.5; master.connect(audio.destination);
  }
  audio?.resume();
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.textContent = soundOn ? 'Sound on' : 'Sound off';
  if (soundOn) [0, 2, 4, 7].forEach((n, i) => note(NOTES[n], i * 0.16, 0.7));
});

// ---------------------------------------------------------------- camera framing
let camD = 12, introT = reduced ? 1 : 0;
function frame() {
  const aspect = innerWidth / innerHeight;
  camera.aspect = aspect;
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fitH = 4.5, fitW = aspect < 0.8 ? 3.5 : 3.8;
  camD = Math.max(fitH / tanH, fitW / (tanH * aspect));
  LOOK.y = aspect < 0.8 ? -0.2 : -0.62;
  camera.updateProjectionMatrix();
  scene.fog = new THREE.Fog(0x0c0a0d, camD + 4, camD + 22);
  (snowPts.material as THREE.ShaderMaterial).uniforms.scale.value = (0.03 * innerHeight * DPR) / (2 * tanH) * (aspect < 0.8 ? 1.5 : 1);
}
function placeCamera(k: number) {
  const e = 1 - Math.pow(1 - k, 3);
  const d = camD * (1.32 - 0.32 * e);
  const el = 0.2 + 0.1 * (1 - e);
  const az = -0.35 * (1 - e);
  camera.position.set(Math.sin(az) * Math.cos(el) * d, LOOK.y + Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
  camera.lookAt(LOOK);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  frame();
  placeCamera(Math.min(1, introT));
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- interaction: drag, fling, shake
let dragging = false, lastX = 0, lastY = 0, lastT = 0, downX = 0, downY = 0, downT = 0, tilt = 0, tiltV = 0;
const wobble = { t: 1 };
cv.addEventListener('pointerdown', (e) => {
  dragging = true; cv.setPointerCapture(e.pointerId); cv.classList.add('dragging');
  lastX = downX = e.clientX; lastY = downY = e.clientY; lastT = downT = performance.now();
});
cv.addEventListener('pointermove', (e) => {
  if (!dragging) { if (e.pointerType === 'mouse') hover(e.clientX, e.clientY); return; }
  const now = performance.now(), dt = Math.max(1, now - lastT) / 1000;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  const k = 6 / Math.min(innerWidth, 900);
  globe.rotation.y += dx * k;
  const w = (dx * k) / dt;
  omega = omega * 0.5 + w * 0.5;
  tiltV = (dy * k * 0.6) / dt;
  tilt = THREE.MathUtils.clamp(tilt + dy * k * 0.35, -0.3, 0.3);
  const speed = Math.hypot(dx, dy) / dt; // px/s
  if (speed > 1600) shake(Math.min(1.4, (speed - 1600) / 2200 + 0.5));
  lastX = e.clientX; lastY = e.clientY; lastT = now;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) { hideTip(); hint.classList.add('gone'); }
});
const endDrag = (e: PointerEvent) => {
  if (!dragging) return;
  dragging = false; cv.classList.remove('dragging');
  if (performance.now() - lastT > 80) omega *= 0.2;
  const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
  if (moved < 8 && performance.now() - downT < 600) tap(e.clientX, e.clientY);
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('pointerleave', () => { if (!pinned) scheduleHide(); });

const hint = $('#hint');
$('#shake').addEventListener('click', () => {
  shake(1.35);
  wobble.t = 0;
  omega += reduced ? 0 : 5 * (Math.random() < 0.5 ? -1 : 1);
  hideTip();
  tinkle();
  hint.classList.add('gone');
});
// device shake, only where it needs no permission prompt
type DMEStatic = { requestPermission?: () => Promise<string> };
if (typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as unknown as DMEStatic).requestPermission !== 'function') {
  let lastMag = 0, lastShake = 0;
  addEventListener('devicemotion', (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    const mag = Math.hypot(a.x, a.y, a.z);
    const jolt = Math.abs(mag - lastMag);
    lastMag = mag;
    const t = performance.now();
    if (jolt > 14 && t - lastShake > 600) { lastShake = t; shake(1.2); wobble.t = 0; tinkle(); }
  });
}

// ---------------------------------------------------------------- tips
const tip = $('#tip');
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let current: Spot | null = null, pinned = false, hideTimer = 0;
function pick(x: number, y: number): Spot | null {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const res = ray.intersectObjects(spots.map((s) => s.hit!), false);
  return res.length ? (res[0].object.userData.spot as Spot) : null;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function hostOf(url: string) { try { const u = new URL(url); return (u.host + u.pathname).replace(/^www\./, '').replace(/\/$/, ''); } catch { return url; } }
function showTip(s: Spot, pin: boolean) {
  clearTimeout(hideTimer);
  pinned = pin || pinned;
  if (current === s && !tip.hidden) return;
  current = s;
  const blurb = s.blurb ? `<p>${esc(cap(s.blurb))}${/[.!?]$/.test(s.blurb) ? '' : '.'}</p>` : '';
  const links = s.links ? `<ul>${s.links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.name)}</a></li>`).join('')}</ul>` : '';
  const go = s.url ? `<a class="go" href="${esc(s.url)}">${esc(hostOf(s.url))} →</a>` : '';
  tip.innerHTML = `<p class="k">${esc(s.kicker)}</p><h2>${esc(s.name)}</h2>${blurb}${links}${go}`;
  tip.setAttribute('aria-label', s.name);
  tip.hidden = false;
  tip.classList.remove('in'); void tip.offsetWidth; tip.classList.add('in');
  positionTip();
}
function hideTip() { clearTimeout(hideTimer); tip.hidden = true; current = null; pinned = false; }
function scheduleHide() { clearTimeout(hideTimer); hideTimer = window.setTimeout(() => { if (!tip.matches(':hover')) hideTip(); }, 450); }
tip.addEventListener('pointerleave', () => { if (!pinned) scheduleHide(); });
tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
function hover(x: number, y: number) {
  const s = pick(x, y);
  cv.classList.toggle('hot', !!s);
  if (s) showTip(s, false);
  else if (current && !pinned) scheduleHide();
}
function tap(x: number, y: number) {
  const s = pick(x, y);
  if (s) { pinned = false; showTip(s, true); note(NOTES[s.note], 0, 0.9); note(NOTES[Math.min(NOTES.length - 1, s.note + 2)], 0.18, 0.5); }
  else hideTip();
}
const tv = new THREE.Vector3();
function positionTip() {
  if (!current || tip.hidden) return;
  current.hit!.parent!.localToWorld(tv.copy(current.top));
  tv.project(camera);
  const x = (tv.x * 0.5 + 0.5) * innerWidth, y = (-tv.y * 0.5 + 0.5) * innerHeight;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x - w / 2, top = y - h - 14;
  left = Math.max(12, Math.min(innerWidth - w - 12, left));
  if (top < 12) top = Math.min(innerHeight - h - 12, y + 24);
  tip.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (listEl.classList.contains('open')) closeList(); else hideTip(); }
});

// list view
const listEl = $('#list');
const listBtn = $<HTMLButtonElement>('#listBtn');
function openList() { listEl.classList.add('open'); listBtn.setAttribute('aria-expanded', 'true'); $('#listClose').focus(); }
function closeList() { listEl.classList.remove('open'); listBtn.setAttribute('aria-expanded', 'false'); listBtn.focus(); }
listBtn.addEventListener('click', () => (listEl.classList.contains('open') ? closeList() : openList()));
$('#listClose').addEventListener('click', closeList);

// ---------------------------------------------------------------- loop
let clock = 0;
function tick(raw: number) {
  const dt = Math.min(raw, 0.05);
  clock += dt;
  if (introT < 1) { introT = Math.min(1, introT + Math.min(raw, 0.25) / 3.4); placeCamera(introT); }
  if (!dragging) {
    omega *= Math.exp(-dt * 1.8);
    globe.rotation.y += omega * dt;
    if (reduced) omega = 0;
    tilt += (0 - tilt) * Math.min(1, dt * 3);
  }
  // shake wobble: a quick, damped jiggle of the whole globe
  let wx = 0, wz = 0;
  if (wobble.t < 1 && !reduced) {
    wobble.t = Math.min(1, wobble.t + dt / 0.9);
    const d = Math.pow(1 - wobble.t, 2);
    wx = Math.sin(wobble.t * 46) * 0.09 * d;
    wz = Math.sin(wobble.t * 38 + 1) * 0.06 * d;
  }
  globe.position.x = wx;
  globe.rotation.x = tilt;
  globe.rotation.z = wz;
  stepSnow(dt);
  for (const a of animators) a(clock, dt);
  positionTip();
  renderer.render(scene, camera);
}
let raf = 0, last = performance.now();
function loop(t: number) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.25, (t - last) / 1000);
  last = t;
  tick(dt);
}
function start() { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop); }
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
start();
setTimeout(() => hint.classList.add('gone'), 9000);
(window as unknown as { __globe: unknown }).__globe = { spots, shake, showTip, hideTip, pick, get energy() { return energy; }, get intro() { return introT; }, camera, globe };
