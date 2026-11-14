import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Automaton, mulberry32, type Habit, type Rule, type Sym } from './ca';
import type { Palette } from './palettes';

// Curated rules, all in the Ulam–Warburton family: an empty cell crystallises
// when exactly one face neighbour is alive, the way a dendrite only freezes
// at its tip. The living front then ages and fades behind itself, so each seed
// blooms outward as a lacy, perfectly symmetric crystal and leaves a trail of
// cooling colour. N (the number of ages) is chosen per edition.
type Curated = { name: string; S: number[]; B: number[]; M: boolean; N: [number, number]; rad: [number, number] };
export const RULES: Curated[] = [
  { name: 'frost', S: [], B: [1], M: false, N: [8, 11], rad: [0, 2] },
  { name: 'lattice', S: [], B: [1, 3], M: false, N: [7, 10], rad: [0, 2] },
];

type Opts = {
  canvas: HTMLCanvasElement;
  seed: number;
  palette: Palette;
  side: 'left' | 'right';
  reduce: boolean;
  onFirstFrame: () => void;
};

const CAP = 20000;

export function start(o: Opts) {
  const r = mulberry32((o.seed * 2654435761) ^ 0x1b873593);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const range = (a: number, b: number) => a + (b - a) * r();

  // ---------------------------------------------------------------- edition
  const cur = pick(RULES);
  const rule: Rule = { name: cur.name, S: cur.S, B: cur.B, M: cur.M, N: Math.round(range(cur.N[0], cur.N[1])), p: 1 };
  const rad = cur.rad;
  const n = pick([37, 41, 41, 45]);
  const sym: Sym = pick(['oct', 'oct', 'tet', 'mirror'] as Sym[]);
  const stepsPerSec = range(1.6, 2.2);
  const elev = THREE.MathUtils.degToRad(range(18, 34));
  const spin = range(0.035, 0.06) * (r() < 0.5 ? -1 : 1);
  const lightAz = range(-1.1, 1.1) + (r() < 0.5 ? 0.6 : -0.6);
  const lightEl = THREE.MathUtils.degToRad(range(42, 62));
  const tilt0 = range(-0.25, 0.25);
  const pal = o.palette;

  const habit = pick(['oct', 'oct', 'round'] as Habit[]);
  const A = new Automaton(n, rule, sym, o.seed, habit);
  A.speed = 99; // the habit bounds the bloom; growth itself runs free
  const seedNow = () => A.seed(r, Math.min(rad[1], Math.max(rad[0], pick([0, 0, 1, 1, 2]))), range(0.25, 0.45));
  seedNow();

  // ---------------------------------------------------------------- three
  const renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = pal.dark ? 1.0 : 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const bg = new THREE.Color(pal.bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = pal.dark ? 0.35 : 0.22;

  const camera = new THREE.PerspectiveCamera(22, 1, 1, 1000);
  const hemi = new THREE.HemisphereLight(pal.sky, pal.ground, pal.dark ? 0.9 : 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(pal.key, pal.dark ? 2.4 : 2.7);
  key.castShadow = true;
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -n * 0.95;
  sc.right = sc.top = n * 0.95;
  sc.near = 1;
  sc.far = n * 5;
  key.shadow.mapSize.setScalar(Math.min(innerWidth, innerHeight) < 700 ? 1024 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 3;
  scene.add(key, key.target);


  const group = new THREE.Group();
  scene.add(group);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: pal.dark ? 0.5 : 0.62, metalness: 0, dithering: true });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  group.add(mesh);

  // palette lookup table, in linear space
  const LUT = 64;
  const lut = new Float32Array(LUT * 3);
  {
    const stops = pal.cells.map((h) => new THREE.Color(h));
    const tmp = new THREE.Color();
    for (let i = 0; i < LUT; i++) {
      const u = (i / (LUT - 1)) * (stops.length - 1);
      const a = Math.min(stops.length - 2, Math.floor(u));
      tmp.copy(stops[a]).lerp(stops[a + 1], u - a);
      lut[i * 3] = tmp.r;
      lut[i * 3 + 1] = tmp.g;
      lut[i * 3 + 2] = tmp.b;
    }
  }

  // ---------------------------------------------------------------- layout
  let W = 1, H = 1, radiusPx = 1, cx = 0, cy = 0;
  const objR = A.c * 1.12;
  function layout() {
    const box = o.canvas.parentElement!.getBoundingClientRect();
    W = Math.max(1, box.width);
    H = Math.max(1, box.height);
    renderer.setSize(W, H, false);
    const wide = W >= 860;
    if (wide) {
      // centre the piece in the room the text leaves
      const t = document.querySelector('.text')!.getBoundingClientRect();
      const a = o.side === 'left' ? t.right : 0, b = o.side === 'left' ? W : t.left;
      cx = (a + b) / 2;
      cy = H * 0.5;
      radiusPx = Math.min((b - a) * 0.42, H * 0.4);
    } else {
      cx = W / 2;
      cy = H * 0.52;
      radiusPx = Math.min(W * 0.44, H * 0.4);
    }
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const D = (objR * H) / (2 * radiusPx * Math.tan(fov / 2));
    camera.aspect = W / H;
    camera.position.set(0, Math.sin(elev) * D, Math.cos(elev) * D);
    camera.lookAt(0, 0, 0);
    camera.near = D - n * 2;
    camera.far = D + n * 4;
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
    scene.fog = new THREE.Fog(bg, D - objR * (pal.dark ? 0.2 : 0), D + objR * (pal.dark ? 2.6 : 3.6));
    const L = n * 2.2;
    key.position.set(Math.sin(lightAz) * Math.cos(lightEl) * L, Math.sin(lightEl) * L, Math.cos(lightAz) * Math.cos(lightEl) * L);
  }
  layout();
  new ResizeObserver(() => {
    layout();
    if (!running) draw(1);
  }).observe(o.canvas.parentElement!);

  // ---------------------------------------------------------------- drawing
  const M = mesh.instanceMatrix.array as Float32Array;
  const C = mesh.instanceColor.array as Float32Array;
  const N = rule.N;
  const SIZE = 0.88;
  const visScale = (s: number) => (s === 0 ? 0 : s === 1 ? 1 : 1 - 0.62 * Math.pow((s - 1) / (N - 1), 1.1));
  const visCol = (s: number) => (s <= 1 ? 0 : (s - 1) / (N - 1));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  function draw(e: number) {
    const { g, prev, ao, aoPrev, active, activeN } = A;
    const nn = A.n, n2 = A.n2, c = A.c;
    let k = 0;
    const es = smooth(e);
    for (let j = 0; j < activeN && k < CAP; j++) {
      const i = active[j];
      const p = prev[i], q = g[i];
      let s: number, u: number;
      if (p === 0) {
        s = outCubic(e) * visScale(q);
        u = visCol(q);
      } else if (q === 0) {
        s = visScale(p) * (1 - es);
        u = visCol(p);
      } else {
        s = visScale(p) + (visScale(q) - visScale(p)) * es;
        u = visCol(p) + (visCol(q) - visCol(p)) * es;
      }
      if (s < 0.02) continue;
      s *= SIZE;
      const x = (i % nn) - c, y = (((i / nn) | 0) % nn) - c, z = ((i / n2) | 0) - c;
      const m = k * 16;
      M[m] = s; M[m + 1] = 0; M[m + 2] = 0; M[m + 3] = 0;
      M[m + 4] = 0; M[m + 5] = s; M[m + 6] = 0; M[m + 7] = 0;
      M[m + 8] = 0; M[m + 9] = 0; M[m + 10] = s; M[m + 11] = 0;
      M[m + 12] = x; M[m + 13] = y; M[m + 14] = z; M[m + 15] = 1;
      const occ = aoPrev[i] + (ao[i] - aoPrev[i]) * es;
      const shade = 1 - (pal.dark ? 0.5 : 0.58) * Math.pow(occ / 26, 0.8);
      const li = Math.min(LUT - 1, Math.round(u * (LUT - 1))) * 3;
      const cc = k * 3;
      C[cc] = lut[li] * shade;
      C[cc + 1] = lut[li + 1] * shade;
      C[cc + 2] = lut[li + 2] * shade;
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- life cycle
  // A bloom grows until its front meets the edge of its habit, then cools and
  // fades. After a breath of emptiness, a new seed.
  let emptyFor = 0, atEdge = 0;
  const edgeHold = Math.round(range(3, 8));
  function advance() {
    if (A.pop === 0) {
      if (++emptyFor >= 3) {
        emptyFor = 0;
        atEdge = 0;
        seedNow();
      } else A.step();
      return;
    }
    A.step();
    if (A.dissolving) return;
    // Once the bloom has reached the edge of its habit it has said what it has
    // to say: let it shimmer a moment longer, then cool and fade.
    if (A.ext >= A.rmax - 1.5) atEdge++;
    if (atEdge > edgeHold || A.pop > 11000 || A.t > 200 || A.stable()) A.dissolving = true;
  }

  // ---------------------------------------------------------------- loop
  let angle = range(0, Math.PI * 2);
  let tiltX = tilt0 * 0.3, px = 0, py = 0, tx = 0, ty = 0;
  addEventListener('pointermove', (ev) => {
    tx = (ev.clientX / innerWidth - 0.5) * 2;
    ty = (ev.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  let phase = 0, last = performance.now(), running = false, raf = 0, first = true;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    phase += dt * stepsPerSec;
    while (phase >= 1) {
      phase -= 1;
      advance();
    }
    angle += spin * dt;
    px += (tx - px) * Math.min(1, dt * 1.5);
    py += (ty - py) * Math.min(1, dt * 1.5);
    group.rotation.set(tiltX + py * 0.06, angle + px * 0.12, 0);
    draw(phase);
    if (first) { first = false; o.onFirstFrame(); }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (running || o.reduce) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

  if (o.reduce) {
    // A still: catch a bloom about three quarters grown, and hold it.
    for (let i = 0; i < 400; i++) {
      advance();
      if (A.pop && A.ext >= A.c * 0.72) break;
    }
    group.rotation.set(tiltX, angle, 0);
    draw(1);
    o.onFirstFrame();
  } else play();
}
