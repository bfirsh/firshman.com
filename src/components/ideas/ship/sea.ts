// Cargo: the MV Firshman ploughing through a dusk swell. Every container is a project.
import * as THREE from 'three';
import { CARGO, ENGINE, LOG, type Cargo } from './copy';

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const STENCIL = '"Big Shoulders Stencil", "Big Shoulders", Impact, sans-serif';
const DISPLAY = '"Big Shoulders", Impact, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

// DOM ------------------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const cardEl = $('card');
const tipEl = $('tip');
const capEl = $('caption');
const manifestEl = $('manifest');
const manifestBtn = $<HTMLButtonElement>('manifestBtn');
const weatherBtn = $<HTMLButtonElement>('weatherBtn');
const hornBtn = $<HTMLButtonElement>('hornBtn');
const soundBtn = $<HTMLButtonElement>('soundBtn');

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('no-webgl');
  throw e;
}
const DPR = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.3, 2000);

// Weather -------------------------------------------------------------------------------
const CALM = {
  zenith: new THREE.Color('#29323e'), horizon: new THREE.Color('#d8936a'), cool: new THREE.Color('#4f5a68'), sun: new THREE.Color('#ffb27a'),
  fog: 0.0072, hemi: 1.05, sunI: 1.7, fill: 0.55, amp: 1.0, speed: 6, deep: new THREE.Color('#0a161d'), shallow: new THREE.Color('#1c424c'),
};
const STORM = {
  zenith: new THREE.Color('#171d24'), horizon: new THREE.Color('#5e5d5c'), cool: new THREE.Color('#414a53'), sun: new THREE.Color('#7d6a5e'),
  fog: 0.0125, hemi: 0.7, sunI: 0.5, fill: 0.45, amp: 1.75, speed: 8.5, deep: new THREE.Color('#081217'), shallow: new THREE.Color('#2a4a50'),
};
let storm = 0, stormT = 0;
const SUN_DIR = new THREE.Vector3(-0.97, 0.08, -0.32).normalize();

const skyU = {
  uZenith: { value: CALM.zenith.clone() }, uHorizon: { value: CALM.horizon.clone() }, uCool: { value: CALM.cool.clone() }, uSunCol: { value: CALM.sun.clone() },
  uSunDir: { value: SUN_DIR }, uStorm: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 },
};
const NOISE_GLSL = `
  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }`;
const SKY_GLSL = `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uCool; uniform vec3 uSunCol; uniform vec3 uSunDir; uniform float uStorm; uniform float uTime; uniform float uFlash;
  vec3 skyBase(vec3 d){
    float y = clamp(d.y, -0.2, 1.0);
    float s = max(dot(normalize(d), uSunDir), 0.0);
    vec3 hz = mix(uCool, uHorizon, pow(s, 7.0) + 0.12*s);
    vec3 c = mix(hz, uZenith, pow(max(y, 0.0), 0.55));
    c += uSunCol * (pow(s, 5.0)*0.5 + pow(s, 48.0)*0.9) * (1.0 - uStorm*0.75);
    return c + vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6*max(y, 0.0));
  }
  vec3 skyCol(vec3 d){
    float y = clamp(d.y, -0.2, 1.0);
    float s = max(dot(normalize(d), uSunDir), 0.0);
    vec3 hz = mix(uCool, uHorizon, pow(s, 7.0) + 0.12*s);
    vec3 c = skyBase(d);
    if (y > 0.0){
      vec2 uv = d.xz / (y + 0.12) * 0.55 + vec2(uTime*0.012, uTime*0.004);
      float n = fbm(uv);
      float cover = mix(0.42, 0.22, uStorm);
      float cl = smoothstep(cover, cover + 0.38, n) * smoothstep(0.0, 0.18, y);
      vec3 cc = mix(uZenith*0.8, hz*0.85, 0.35) + uSunCol*pow(s, 3.0)*0.5*(1.0 - uStorm*0.7) * (1.0 - smoothstep(0.4, 0.8, n));
      c = mix(c, cc + vec3(0.75, 0.8, 1.0) * uFlash * 0.5, cl*0.85);
    }
    return c;
  }`;
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `${NOISE_GLSL}${SKY_GLSL} varying vec3 vD; void main(){ gl_FragColor = vec4(skyCol(normalize(vD)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);
scene.fog = new THREE.FogExp2(0x6a6a72, CALM.fog);

// soft environment for the metal and glass
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const m = (sky.material as THREE.ShaderMaterial).clone();
  m.uniforms = THREE.UniformsUtils.clone(skyU);
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), m));
  scene.environment = pm.fromScene(envScene, 0.05).texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
}

// Lights --------------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0x8d98ab, 0x1c2328, CALM.hemi);
const sunL = new THREE.DirectionalLight(0xffb27a, CALM.sunI); sunL.position.copy(SUN_DIR).multiplyScalar(100);
const fill = new THREE.DirectionalLight(0x9fb6d6, CALM.fill); fill.position.set(30, 60, 90);
scene.add(hemi, sunL, fill);

// Waves (shared by the shader and the ship's motion) --------------------------------------
const WAVES = [
  { ang: 192, L: 66, S: 0.105, st: 1.9 },
  { ang: 158, L: 39, S: 0.09, st: 1.9 },
  { ang: 228, L: 23, S: 0.075, st: 1.6 },
  { ang: 122, L: 13, S: 0.06, st: 1.5 },
  { ang: 176, L: 7.5, S: 0.05, st: 1.5 },
].map((w) => {
  const a = (w.ang * Math.PI) / 180, k = TAU / w.L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, S: w.S, st: w.st, c: Math.sqrt(9.8 / k) * 0.75, ph: rnd() * TAU, a: 0 };
});
let travel = 0;
const uW = WAVES.map(() => new THREE.Vector4());
const uPh = WAVES.map(() => 0);
let ampTot = 1;
function updateWaves(dt: number) {
  const speed = lerp(CALM.speed, STORM.speed, storm) * (reduced ? 0.5 : 1);
  travel += speed * dt;
  ampTot = 0;
  WAVES.forEach((w, i) => {
    const calmMul = reduced ? 0.55 : 1;
    w.a = (w.S * lerp(1, w.st, storm) * calmMul) / w.k;
    ampTot += w.a;
    w.ph = (w.ph + (w.k * w.c * (reduced ? 0.6 : 1) + w.k * w.dx * speed) * dt) % TAU;
    uW[i].set(w.dx, w.dz, w.k, w.a); uPh[i] = w.ph;
  });
}
function waveH(x: number, z: number) {
  let y = 0;
  for (const w of WAVES) y += w.a * Math.sin(w.k * (w.dx * x + w.dz * z) - w.ph);
  return y;
}

// Sea ------------------------------------------------------------------------------------
const seaU = {
  ...skyU,
  uW: { value: uW }, uPh: { value: uPh }, uTravel: { value: 0 }, uAmpTot: { value: 1 },
  uDeep: { value: CALM.deep.clone() }, uShallow: { value: CALM.shallow.clone() }, uFogDen: { value: CALM.fog },
};
const sea = (() => {
  const N = coarse ? 170 : 240, R = 700;
  const pos: number[] = [], idx: number[] = [];
  const f = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), 1.75) * R;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.push(f((i / N) * 2 - 1), 0, f((j / N) * 2 - 1));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: seaU,
    vertexShader: `uniform vec4 uW[5]; uniform float uPh[5]; varying vec3 vP; varying vec3 vN; varying float vH;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vec2 p = wp.xz; vec3 disp = vec3(0.0); vec3 n = vec3(0.0,1.0,0.0);
        float dc = length(cameraPosition.xz - p);
        for (int i = 0; i < 5; i++){ vec2 d = uW[i].xy; float k = uW[i].z; float a = uW[i].w;
          if (k > 0.3) a *= 1.0 - smoothstep(80.0, 260.0, dc);
          float f = k*dot(d, p) - uPh[i]; float c = cos(f), s = sin(f);
          disp.x += d.x*a*c; disp.z += d.y*a*c; disp.y += a*s;
          float wa = k*a; n.x -= d.x*wa*c; n.z -= d.y*wa*c; n.y -= wa*s; }
        wp.xyz += disp; vP = wp.xyz; vN = n; vH = disp.y;
        gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `${NOISE_GLSL}${SKY_GLSL}
      uniform vec3 uDeep; uniform vec3 uShallow; uniform float uFogDen; uniform float uTravel; uniform float uAmpTot;
      varying vec3 vP; varying vec3 vN; varying float vH;
      float hullB(float x){ if (x > 12.0){ float t = (x-12.0)/10.0; return 3.6*sqrt(max(0.0, 1.0-t*t)); } if (x < -18.0){ float t = (-18.0-x)/5.0; return 3.6*(1.0-0.18*t*t); } return 3.6; }
      float wake(vec2 p, float n){
        float x = p.x, z = abs(p.y); float m = 0.0;
        if (x > -23.5 && x < 22.5){ float d = z - hullB(clamp(x, -23.0, 22.0)); m = max(m, (1.0 - smoothstep(0.0, 1.0 + n*1.4, d)) * (0.45 + 0.55*smoothstep(-20.0, 20.0, x))); }
        float bx = 21.5 - x; if (bx > 0.0){ float arm = bx*0.4 + 0.8; float d = abs(z - arm); m = max(m, (1.0 - smoothstep(0.2, 1.2 + bx*0.05, d + (n-0.5)*1.4)) * exp(-bx/24.0)); }
        float sx = -23.0 - x; if (sx > -1.5){ float w = 2.4 + max(sx, 0.0)*0.18; m = max(m, (1.0 - smoothstep(-w*0.5, 0.8, z - w + (n-0.5)*2.6)) * exp(-max(sx, 0.0)/60.0)); }
        return m * smoothstep(0.28, 0.62, n*0.85 + m*0.45);
      }
      void main(){
        vec2 q = vP.xz + vec2(uTravel, 0.0);
        vec3 N = normalize(vN);
        float rip = 0.05 + 0.06*uStorm;
        N = normalize(N + vec3(sin(q.x*1.6 + uTime*2.2 + q.y*0.4)*rip + sin(q.y*2.6 - uTime*1.6 + q.x*0.7)*rip*0.6, 0.0, cos(q.y*1.9 + uTime*1.9 - q.x*0.3)*rip));
        vec3 V = normalize(cameraPosition - vP); float dist = length(cameraPosition - vP);
        float fres = 0.02 + 0.98*pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02;
        vec3 refl = skyBase(normalize(R));
        float crest = clamp(vH/max(uAmpTot, 0.01)*0.5 + 0.5, 0.0, 1.0);
        vec3 body = mix(uDeep, uShallow, crest*crest*0.9);
        float sss = pow(max(dot(-V, uSunDir), 0.0), 3.0) * crest*crest;
        body += uSunCol * sss * 0.18;
        vec3 col = mix(body, refl, clamp(fres, 0.0, 1.0)*0.9);
        float spec = pow(max(dot(normalize(R), uSunDir), 0.0), 140.0);
        col += uSunCol * spec * 2.2 * (1.0 - uStorm*0.85);
        float fn = fbm(q*0.32 + vec2(0.0, uTime*0.06));
        float crestFoam = smoothstep(0.66, 0.96, crest + (fn - 0.5)*0.4) * (0.25 + 0.75*uStorm);
        float foam = clamp(max(crestFoam, wake(vP.xz, fn)), 0.0, 1.0);
        vec3 foamCol = vec3(0.78, 0.82, 0.84) * (0.55 + 0.25*N.y) + uSunCol*0.08 + vec3(0.6)*uFlash;
        col = mix(col, foamCol, foam*0.9);
        col += vec3(0.5, 0.55, 0.7) * uFlash * 0.25;
        float fog = 1.0 - exp(-pow(uFogDen*dist, 1.5));
        vec3 fc = skyBase(normalize(vec3(-V.x, 0.015, -V.z)));
        col = mix(col, fc, fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; return mesh;
})();
scene.add(sea);

// Materials / helpers ---------------------------------------------------------------------
const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15, ...o });
const basic = (color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, s = 16) => new THREE.CylinderGeometry(rt, rb, h, s);
const redraws: (() => void)[] = [];
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: { nearest?: boolean; redraw?: boolean } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.nearest) { tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; } else tex.anisotropy = 8;
  const run = () => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h); tex.needsUpdate = true; };
  run(); if (opts.redraw !== false) redraws.push(run);
  (tex as any).redraw = run;
  return tex;
}
const glowTex = canvasTex(64, 64, (ctx) => { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64); }, { redraw: false });
function halo(color: THREE.ColorRepresentation, size: number, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  s.scale.setScalar(size); return s;
}

// The ship ------------------------------------------------------------------------------
const ship = new THREE.Group();
scene.add(ship);
const STERN = -23, BOW = 22;
function Bx(x: number) {
  if (x > 12) { const t = (x - 12) / 10; return 3.6 * Math.sqrt(Math.max(0, 1 - t * t)); }
  if (x < -18) { const t = (-18 - x) / 5; return 3.6 * (1 - 0.18 * t * t); }
  return 3.6;
}
const deckY = (x: number) => 2.2 + Math.max(0, x - 14) * 0.24;
const keelY = (x: number) => (x > 15 ? -3 + Math.pow((x - 15) / 7, 1.5) * 2.6 : x < -19 ? -3 + ((-19 - x) / 4) * 1.6 : -3);
function halfB(x: number, y: number) {
  const ky = keelY(x);
  const xe = x > 10 ? x + Math.max(0, 1.4 - y) * 0.9 : x;
  let b = Bx(Math.min(xe, BOW));
  const r = 1.4; if (y < ky + r) { const u = (ky + r - y) / r; b *= Math.sqrt(Math.max(0, 1 - u * u)); }
  return b;
}
const hullTex = canvasTex(2048, 512, (ctx, w, h) => {
  const yToV = (y: number) => h - ((y + 3.2) / 7.6) * h;
  ctx.fillStyle = '#1a2430'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6e2420'; ctx.fillRect(0, yToV(-0.15), w, h);
  ctx.fillStyle = '#0d1014'; ctx.fillRect(0, yToV(0.35), w, yToV(-0.15) - yToV(0.35));
  ctx.fillStyle = '#c9c4b8'; ctx.fillRect(0, yToV(2.0), w, 3);
  for (let i = 0; i < 46; i++) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect((i / 46) * w, 0, 2, yToV(-0.2)); }
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w, y0 = yToV(1.9 - rnd() * 0.4), len = 20 + rnd() * 110;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, 'rgba(120,60,35,0.5)'); g.addColorStop(1, 'rgba(120,60,35,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y0, 2 + rnd() * 4, len);
  }
}, { redraw: false });
{
  const xs: number[] = []; const NS = 52;
  for (let i = 0; i <= NS; i++) { const u = i / NS; xs.push(STERN + (BOW - STERN) * (u < 0.7 ? u : 0.7 + (u - 0.7) * 1) ); }
  const K = 16;
  for (const side of [1, -1]) {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    xs.forEach((x) => {
      const top = deckY(x) + 0.5, ky = keelY(x);
      for (let k = 0; k <= K; k++) {
        const y = top + (ky - top) * Math.sin((Math.PI / 2) * (k / K));
        pos.push(x, y, side * halfB(x, y));
        uv.push((x - STERN) / (BOW - STERN), (y + 3.2) / 7.6);
      }
    });
    for (let i = 0; i < xs.length - 1; i++) for (let k = 0; k < K; k++) {
      const a = i * (K + 1) + k, b = a + K + 1, c = a + 1, d = b + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    ship.add(mesh(g, std(0xffffff, { map: hullTex, roughness: 0.62, metalness: 0.25, side: THREE.DoubleSide })));
  }
  // deck
  const dp: number[] = [], di: number[] = [];
  xs.forEach((x, i) => { const y = deckY(x), b = Math.max(halfB(x, y) - 0.05, 0); dp.push(x, y, b, x, y, -b); if (i) { const a = (i - 1) * 2; di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); dg.setIndex(di); dg.computeVertexNormals();
  ship.add(mesh(dg, std(0x34403d, { roughness: 0.9, side: THREE.DoubleSide })));
  // transom with the ship's name
  const sx = STERN, top = deckY(sx) + 0.5, ky = keelY(sx);
  const outline: THREE.Vector2[] = [];
  for (let k = 0; k <= K; k++) { const y = top + (ky - top) * Math.sin((Math.PI / 2) * (k / K)); outline.push(new THREE.Vector2(halfB(sx, y), y)); }
  for (let k = K; k >= 0; k--) { const y = top + (ky - top) * Math.sin((Math.PI / 2) * (k / K)); outline.push(new THREE.Vector2(-halfB(sx, y), y)); }
  const tg = new THREE.ShapeGeometry(new THREE.Shape(outline));
  const tp = tg.attributes.position as THREE.BufferAttribute; const tuv = tg.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tuv.setXY(i, (tp.getX(i) + 3.2) / 6.4, (tp.getY(i) - ky) / (top - ky));
  const transTex = canvasTex(1024, 1024, (ctx, w, h) => {
    const yOf = (y: number) => h - ((y - ky) / (top - ky)) * h;
    ctx.fillStyle = '#1a2430'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6e2420'; ctx.fillRect(0, yOf(-0.15), w, h);
    ctx.fillStyle = '#0d1014'; ctx.fillRect(0, yOf(0.35), w, yOf(-0.15) - yOf(0.35));
    ctx.fillStyle = '#ece6da'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 150px ${DISPLAY}`; (ctx as any).letterSpacing = '10px'; ctx.fillText('MV FIRSHMAN', w / 2, yOf(1.95));
    ctx.font = `700 74px ${DISPLAY}`; (ctx as any).letterSpacing = '18px'; ctx.fillText('LOCALHOST', w / 2, yOf(0.95));
  });
  // shape is drawn in (z, y): rotate so it faces -x
  tg.rotateY(-Math.PI / 2);
  ship.add(mesh(tg, std(0xffffff, { map: transTex, roughness: 0.6, side: THREE.DoubleSide }), sx - 0.01, 0, 0));
  // BEN FIRSHMAN on both sides of the hull
  const nameTex = canvasTex(2048, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f1ece2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 210px ${DISPLAY}`; (ctx as any).letterSpacing = '34px';
    ctx.fillText('BEN FIRSHMAN', w / 2, h / 2 + 10);
  });
  for (const s of [1, -1]) {
    const p = mesh(new THREE.PlaneGeometry(19, 2.375), std(0xffffff, { map: nameTex, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), 2.5, 1.0, s * 3.615);
    if (s < 0) p.rotation.y = Math.PI;
    ship.add(p);
  }
}

// hatch covers, rails, forecastle bits
const HATCH_Y = 2.2;
const CW = 2.0, CH = 2.1, CL = 6.4;
const BAY_X = (i: number) => -9.4 + i * 2.2;
const BAY_H = [3, 4, 4, 3, 4, 4, 3, 3, 2, 2, 1];
const tierY = (t: number) => HATCH_Y + 0.28 + CH / 2 + t * (CH + 0.02);
{
  for (let i = 0; i < BAY_H.length; i += 2) ship.add(mesh(box(i === 10 ? 2.2 : 4.4, 0.28, 6.6), std(0x3c4744, { roughness: 0.85 }), BAY_X(i) + (i === 10 ? 0 : 1.1), HATCH_Y + 0.14, 0));
  // lashing bridges between bays
  const lash = std(0xd0a434, { roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < BAY_H.length - 1; i += 2) ship.add(mesh(box(0.16, 2.6, 7.0), lash, BAY_X(i) + 2.2 + 1.1 - 0.0, HATCH_Y + 1.5, 0));
  // forecastle: mast, windlass
  const fx = 18.5;
  ship.add(mesh(cyl(0.12, 0.16, 6, 8), std(0xd8d2c4), fx, deckY(fx) + 3, 0));
  ship.add(mesh(box(0.1, 0.1, 2.0), std(0xd8d2c4), fx, deckY(fx) + 4.8, 0));
  for (const s of [-1, 1]) ship.add(mesh(cyl(0.35, 0.35, 0.8, 12).rotateX(Math.PI / 2), std(0x7a2a24), 19.8, deckY(19.8) + 0.4, s * 1.0));
  const mastLight = mesh(new THREE.SphereGeometry(0.1, 8, 6), basic(0xfff6e0), fx, deckY(fx) + 6.05, 0);
  ship.add(mastLight); const mh = halo(0xfff1d0, 2.4, 0.8); mh.position.copy(mastLight.position); ship.add(mh);
  // railing along both sides
  const rail = std(0xcfc8ba, { roughness: 0.5 });
  for (const s of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let x = -12; x <= 21; x += 0.5) pts.push(new THREE.Vector3(x, deckY(x) + 1.05, s * (halfB(x, deckY(x)) - 0.08)));
    ship.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.03, 4), rail));
    for (let x = -12; x <= 21; x += 1.5) ship.add(mesh(box(0.05, 1.0, 0.05), rail, x, deckY(x) + 0.55, s * (halfB(x, deckY(x)) - 0.08)));
  }
}

// Bridge and funnel ------------------------------------------------------------------------
const clickables: THREE.Object3D[] = [];
const BR = { x0: -18.6, x1: -12.4 };
let radar: THREE.Object3D;
{
  const acc = new THREE.Group(); ship.add(acc);
  const wTex = (cols: number, rows: number, lit: number) => canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d9d4c9'; ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < rows; r++) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, ((r + 1) / rows) * h - 3, w, 3); }
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = rnd() < lit;
      ctx.fillStyle = on ? '#ffc874' : '#2a3038';
      ctx.fillRect(((c + 0.25) / cols) * w, ((r + 0.3) / rows) * h, (0.5 / cols) * w, (0.38 / rows) * h);
    }
  }, { redraw: false });
  const emiss = (t: THREE.Texture) => std(0xffffff, { map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.7 });
  const sideM = emiss(wTex(6, 4, 0.35)), frontM = emiss(wTex(7, 4, 0.45));
  // windows: use a second, emissive-only texture so only the lit ones glow
  const litTex = (base: THREE.CanvasTexture) => base;
  void litTex;
  const block = mesh(box(BR.x1 - BR.x0, 6.2, 6.4), [frontM, frontM, std(0xd9d4c9), std(0xd9d4c9), sideM, sideM], (BR.x0 + BR.x1) / 2, 2.2 + 3.1, 0);
  acc.add(block);
  // bridge deck with a band of warm windows
  const bridgeTex = canvasTex(1024, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d9d4c9'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffd28a'); g.addColorStop(1, '#ff9f4a');
    for (let i = 0; i < 12; i++) { ctx.fillStyle = g; ctx.fillRect(i * (w / 12) + 6, 28, w / 12 - 12, 62); }
  }, { redraw: false });
  const bw = std(0xffffff, { map: bridgeTex, emissiveMap: bridgeTex, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.5 });
  const bridge = mesh(box(BR.x1 - BR.x0 + 0.3, 1.9, 9.0), [bw, std(0xd9d4c9), std(0xcfcac0), std(0xd9d4c9), bw, bw], (BR.x0 + BR.x1) / 2 + 0.15, 8.4 + 0.95, 0);
  acc.add(bridge);
  acc.add(mesh(box(BR.x1 - BR.x0 + 0.8, 0.18, 9.4), std(0x2a3036), (BR.x0 + BR.x1) / 2 + 0.15, 10.42, 0));
  for (const s of [-1, 1]) {
    const nav = mesh(new THREE.SphereGeometry(0.12, 8, 6), basic(s > 0 ? 0x4dff8a : 0xff4040), BR.x1 + 0.2, 9.0, s * 4.55);
    acc.add(nav); const h = halo(s > 0 ? 0x4dff8a : 0xff4040, 2.2, 0.85); h.position.copy(nav.position); acc.add(h);
  }
  const bhalo = halo(0xffb060, 9, 0.18); bhalo.position.set(BR.x1 + 0.6, 9.4, 0); acc.add(bhalo);
  // mast + radar
  acc.add(mesh(cyl(0.12, 0.16, 3.6, 8), std(0xd8d2c4), -15.2, 12.2, 0));
  radar = new THREE.Group(); radar.position.set(-15.2, 13.9, 0); acc.add(radar);
  radar.add(mesh(box(0.25, 0.16, 2.6), std(0xe8e4dc)));
  const top = mesh(new THREE.SphereGeometry(0.11, 8, 6), basic(0xfff6e0), -15.2, 14.25, 0); acc.add(top);
  const th = halo(0xfff1d0, 2.2, 0.8); th.position.copy(top.position); acc.add(th);
  // deck floodlight, pointing forward along the stack
  const spot = new THREE.SpotLight(0xffd7a0, 260, 60, 0.55, 0.7, 1.4);
  spot.position.set(-12.2, 11.2, 4.2); spot.target.position.set(4, 4, 3.4);
  ship.add(spot, spot.target);
  const sh = halo(0xffe3b0, 3.4, 0.9); sh.position.set(-12.1, 11.2, 4.2); ship.add(sh);
  bridge.userData.hit = 'bridge'; block.userData.hit = 'bridge';
  clickables.push(bridge, block);
  // funnel
  const fun = new THREE.Group(); fun.position.set(-20.6, 0, 0); ship.add(fun);
  const funTex = canvasTex(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e4ded2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c4462f'; ctx.fillRect(0, 0, w, 26); ctx.fillRect(0, h - 26, w, 26);
    ctx.fillStyle = '#1c1f24'; ctx.font = `800 120px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; (ctx as any).letterSpacing = '12px';
    for (const x of [w * 0.25, w * 0.75]) ctx.fillText('REPLICATE', x, h / 2 + 6);
  });
  const fg = cyl(1.15, 1.35, 11.4, 28); fg.scale(1, 1, 0.82);
  const funnelBody = mesh(fg, std(0x23272d, { roughness: 0.55 }), 0, 2.2 + 5.7, 0); fun.add(funnelBody);
  const bg = new THREE.CylinderGeometry(1.205, 1.235, 1.6, 28, 1, true); bg.scale(1, 1, 0.82);
  const band = mesh(bg, std(0xffffff, { map: funTex, emissiveMap: funTex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.55 }), 0, 2.2 + 8.9, 0); fun.add(band);
  fun.add(mesh(cyl(1.17, 1.17, 0.35, 28).scale(1, 1, 0.82), std(0x111317), 0, 2.2 + 11.5, 0));
  for (const z of [-0.35, 0.35]) fun.add(mesh(cyl(0.2, 0.2, 0.9, 10), std(0x15171a), 0.2, 2.2 + 11.9, z));
  // the horn
  fun.add(mesh(cyl(0.16, 0.06, 0.7, 10).rotateZ(-Math.PI / 2), std(0xc9b26a, { metalness: 0.7, roughness: 0.35 }), 1.35, 2.2 + 10.2, 0.6));
  funnelBody.userData.hit = 'funnel'; band.userData.hit = 'funnel';
  clickables.push(funnelBody, band);
}

// Containers ----------------------------------------------------------------------------
function corrugated(color: string, ridges = 24, w = 512, h = 128, extra?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < ridges; i++) {
      const x = (i / ridges) * w, rw = w / ridges;
      const g = ctx.createLinearGradient(x, 0, x + rw, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.35, 'rgba(255,255,255,0.0)'); g.addColorStop(0.55, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, rw, h);
    }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(${90 + rnd() * 40},${40 + rnd() * 20},20,${0.05 + rnd() * 0.12})`; ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 12, 1 + rnd() * 5, 0, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, w, 4); ctx.fillRect(0, h - 4, w, 4);
    extra?.(ctx, w, h);
  });
}
// fillers: closed, anonymous, muted
{
  const slots: { x: number; y: number }[] = [];
  const taken = new Set(CARGO.map((c) => `${c.bay}:${c.tier}`));
  BAY_H.forEach((n, b) => { for (let t = 0; t < n; t++) if (!taken.has(`${b}:${t}`)) slots.push({ x: BAY_X(b), y: tierY(t) }); });
  const tex = corrugated('#ffffff', 40, 512, 128);
  const g = box(CW - 0.04, CH - 0.03, CL);
  const im = new THREE.InstancedMesh(g, std(0xffffff, { map: tex, roughness: 0.8, metalness: 0.2 }), slots.length);
  const cols = ['#6b4136', '#4a565e', '#7a6852', '#384654', '#80513e', '#5a5f4c', '#3d3f46', '#8a7a62'];
  const m = new THREE.Matrix4(), c = new THREE.Color();
  slots.forEach((s, i) => { m.makeTranslation(s.x, s.y, 0); im.setMatrixAt(i, m); im.setColorAt(i, c.set(cols[Math.floor(rnd() * cols.length)])); });
  ship.add(im);
}
type Box = {
  cargo: Cargo; group: THREE.Group; doors: [THREE.Object3D, THREE.Object3D]; interior: THREE.Group;
  open: number; vel: number; want: number; tick?: (dt: number, t: number, open: number) => void; reset?: () => void; faceMat: THREE.MeshStandardMaterial;
};
const boxes: Box[] = [];
function doorTex(c: Cargo) {
  return canvasTex(512, 540, (ctx, w, h) => {
    ctx.fillStyle = c.color; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) { const x = (i / 10) * w; const g = ctx.createLinearGradient(x, 0, x + w / 10, 0); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x, 0, w / 10, h); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(w / 2 - 2, 0, 4, h);
    const light = c.color.toLowerCase() === '#e9e5dc' || c.color.toLowerCase() === '#d9a63a';
    ctx.fillStyle = light ? '#1d1f22' : '#f4efe4';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = c.label.split('\n');
    const size = lines.length > 1 ? 118 : c.label.length > 5 ? 112 : 170;
    ctx.font = `800 ${size}px ${STENCIL}`; (ctx as any).letterSpacing = '4px';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h * 0.5 + (i - (lines.length - 1) / 2) * size * 0.92));
    ctx.font = `600 26px ${MONO}`; ctx.textAlign = 'right'; (ctx as any).letterSpacing = '0px';
    ctx.fillText(c.code, w - 26, 44); ctx.fillText('22G1', w - 26, 76);
    ctx.textAlign = 'left'; ctx.font = `500 18px ${MONO}`;
    ['MAX GROSS 30,480 KG', 'TARE       2,200 KG', 'PAYLOAD  ONE IDEA'].forEach((s, i) => ctx.fillText(s, 24, h - 86 + i * 24));
    for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(80,40,20,${0.04 + rnd() * 0.1})`; ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, 2 + rnd() * 14, 1 + rnd() * 6, 0, 0, TAU); ctx.fill(); }
  });
}
function sideTex(c: Cargo) {
  return corrugated(c.color, 48, 1024, 340, (ctx, w, h) => {
    const light = c.color.toLowerCase() === '#e9e5dc' || c.color.toLowerCase() === '#d9a63a';
    ctx.fillStyle = light ? 'rgba(25,27,30,0.9)' : 'rgba(244,239,228,0.92)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 170px ${STENCIL}`; (ctx as any).letterSpacing = '10px'; ctx.fillText(c.label.replace('\n', ' '), w / 2, h / 2 + 8);
  });
}
const interiorMat = std(0x8d8a82, { roughness: 0.85 });
const floorMat = std(0x6a4d36, { roughness: 0.9 });
const steel = std(0xb8bcc0, { metalness: 0.7, roughness: 0.35 });
// The interiors -----------------------------------------------------------------------------
function gearShape(n: number, ro: number, ri: number, hole: number) {
  const s = new THREE.Shape(); const w = TAU / n;
  for (let i = 0; i < n; i++) {
    const a = i * w;
    ([[ri, a], [ro, a + 0.12 * w], [ro, a + 0.42 * w], [ri, a + 0.54 * w], [ri, a + 0.8 * w]] as [number, number][]).forEach(([r, an], k) => { const x = Math.cos(an) * r, y = Math.sin(an) * r; if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath(); const h = new THREE.Path(); h.absarc(0, 0, hole, 0, TAU, true); s.holes.push(h); return s;
}
let pixelFrame = 0;
const pixelTex = canvasTex(64, 48, (ctx) => {
  const f = pixelFrame;
  ctx.fillStyle = '#15123a'; ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = '#fff6d8'; for (let i = 0; i < 12; i++) ctx.fillRect(((i * 23 - f * 0.5) % 64 + 64) % 64, (i * 13) % 26 + 2, 1, 1);
  ctx.fillStyle = '#ffd36b'; ctx.fillRect(48, 5, 7, 7);
  ctx.fillStyle = '#e0503b'; ctx.fillRect(0, 38, 64, 10);
  ctx.fillStyle = '#8f2a1d'; for (let x = -(f * 2 % 8); x < 64; x += 8) { ctx.fillRect(x, 38, 1, 10); ctx.fillRect(x + 4, 43, 1, 5); } ctx.fillRect(0, 43, 64, 1);
  const ox = 64 - ((f * 2) % 96);
  ctx.fillStyle = '#5fd36b'; ctx.fillRect(ox, 30, 8, 8); ctx.fillStyle = '#2f8a3b'; ctx.fillRect(ox - 1, 28, 10, 3);
  const dx = ox - 18; const jump = dx > -6 && dx < 14 ? Math.sin(((dx + 6) / 20) * Math.PI) * 13 : 0; const hy = 30 - jump;
  ctx.fillStyle = '#e0503b'; ctx.fillRect(16, hy - 2, 6, 3); ctx.fillStyle = '#f2c3a0'; ctx.fillRect(16, hy + 1, 6, 3); ctx.fillStyle = '#3b78c4'; ctx.fillRect(16, hy + 4, 6, 4);
}, { nearest: true, redraw: false });
let cursorOn = true;
const termTex = canvasTex(512, 384, (ctx, w, h) => {
  ctx.fillStyle = '#061a10'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#7dffaa'; ctx.font = `500 26px ${MONO}`; ctx.textBaseline = 'top';
  ctx.shadowColor = '#3dff88'; ctx.shadowBlur = 8;
  const lines = ['$ ship --help', '', 'Usage: ship [options] <cargo>', '', 'Options:', '  -h, --help     show this', '  --json         for robots', '  --no-color     for printers', '', 'Exit 0. Be kind to humans.', '$ '];
  lines.forEach((l, i) => ctx.fillText(l, 22, 16 + i * 32));
  if (cursorOn) ctx.fillRect(22 + 2 * 15.6, 16 + 10 * 32, 14, 26);
  for (let y = 0; y < h; y += 4) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, y, w, 2); }
});
function wood(c = 0x8a5a34) { return std(c, { roughness: 0.8 }); }
function crate(w: number, h: number, d: number) { return mesh(box(w, h, d), wood(0x7a5634)); }
const FLOOR = -CH / 2 + 0.05;
function buildInterior(b: Box) {
  const I = b.interior;
  switch (b.cargo.slug) {
    case 'cog': {
      const g1 = mesh(new THREE.ExtrudeGeometry(gearShape(14, 0.66, 0.54, 0.12), { depth: 0.16, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }), std(0xe07a34, { metalness: 0.65, roughness: 0.35 }), -0.28, 0.1, 0.4);
      const g2 = mesh(new THREE.ExtrudeGeometry(gearShape(8, 0.4, 0.29, 0.08), { depth: 0.16, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }), std(0xc9ccd0, { metalness: 0.8, roughness: 0.3 }), 0.55, -0.55, 0.42);
      I.add(g1, g2);
      I.add(mesh(box(0.1, 1.2, 0.1), steel, -0.28, -0.45, 0.32), mesh(box(0.08, 0.5, 0.08), steel, 0.55, -0.8, 0.34));
      b.tick = (dt) => { g1.rotation.z += dt * 0.6; g2.rotation.z = -g1.rotation.z * (14 / 8) + 0.2; };
      break;
    }
    case 'clig': {
      I.add(mesh(box(1.2, 0.6, 1.0), wood(0x6e5134), 0, FLOOR + 0.3, 0.3));
      I.add(mesh(box(0.95, 0.78, 0.8), std(0xd6cdb4, { roughness: 0.6 }), 0, FLOOR + 0.6 + 0.39, 0.25));
      I.add(mesh(box(0.7, 0.5, 0.3), std(0xc9bfa5), 0, FLOOR + 0.6 + 0.39, -0.2));
      const scr = mesh(new THREE.PlaneGeometry(0.76, 0.57), new THREE.MeshBasicMaterial({ map: termTex, toneMapped: false }), 0, FLOOR + 0.6 + 0.41, 0.655); I.add(scr);
      const h = halo(0x3dff88, 1.6, 0.25); h.position.set(0, FLOOR + 1.0, 0.75); I.add(h);
      I.add(mesh(box(0.8, 0.05, 0.28), std(0xcfc6ad), 0, FLOOR + 0.62, 0.95));
      let acc = 0; b.tick = (dt) => { acc += dt; if (acc > 0.5) { acc = 0; cursorOn = !cursorOn; (termTex as any).redraw(); } };
      break;
    }
    case 'compose': {
      const cols = ['#2f68ad', '#e0873a', '#2b8a78'];
      const mini = (col: string, x: number, y: number, z: number, r = 0) => {
        const t = corrugated(col, 16, 256, 96);
        const m = mesh(box(0.95, 0.42, 0.42), std(0xffffff, { map: t, roughness: 0.7, metalness: 0.2 }), x, y, z); m.rotation.y = r; I.add(m);
      };
      mini(cols[0], -0.3, FLOOR + 0.21, 0.6, 0.02); mini(cols[1], 0.38, FLOOR + 0.21, 0.35, -0.08); mini(cols[2], 0.0, FLOOR + 0.64, 0.5, 0.12);
      const tiny = mesh(box(0.32, 0.14, 0.14), std(0xd4602c), 0.05, FLOOR + 0.93, 0.55); tiny.rotation.y = -0.3; I.add(tiny);
      break;
    }
    case 'machine': {
      I.add(mesh(box(0.9, 1.7, 0.75), std(0x1c2127, { roughness: 0.5, metalness: 0.5 }), 0, FLOOR + 0.85, 0.2));
      const leds: THREE.Mesh[] = [];
      for (let u = 0; u < 6; u++) {
        const y = FLOOR + 0.25 + u * 0.26;
        I.add(mesh(box(0.8, 0.2, 0.04), std(0x2c333b, { metalness: 0.6, roughness: 0.4 }), 0, y, 0.6));
        for (let k = 0; k < 4; k++) { const l = mesh(box(0.035, 0.035, 0.02), basic(0x3dff88), -0.3 + k * 0.06, y, 0.63); I.add(l); leds.push(l); }
        I.add(mesh(box(0.3, 0.08, 0.02), std(0x111418), 0.18, y, 0.63));
      }
      const c1 = new THREE.Color(0x3dff88), c2 = new THREE.Color(0x0e3a1f), c3 = new THREE.Color(0xffb13d);
      const h = halo(0x3dff88, 1.4, 0.18); h.position.set(0, 0, 0.8); I.add(h);
      let acc = 0; b.tick = (dt) => { acc += dt; if (acc > 0.12) { acc = 0; for (const l of leds) if (rnd() < 0.3) (l.material as THREE.MeshBasicMaterial).color.copy(rnd() < 0.08 ? c3 : rnd() < 0.5 ? c1 : c2); } };
      break;
    }
    case 'jsnes': {
      I.add(mesh(box(1.1, 0.5, 0.9), wood(0x6e5134), 0, FLOOR + 0.25, 0.3));
      I.add(mesh(box(1.0, 0.78, 0.75), std(0x5a3b24, { roughness: 0.55 }), 0, FLOOR + 0.5 + 0.39, 0.25));
      I.add(mesh(new THREE.PlaneGeometry(0.66, 0.5), new THREE.MeshBasicMaterial({ map: pixelTex, toneMapped: false }), -0.08, FLOOR + 0.9, 0.63));
      for (const k of [0, 1]) I.add(mesh(cyl(0.03, 0.03, 0.06, 8).rotateX(Math.PI / 2), std(0xc9b26a, { metalness: 0.6 }), 0.36, FLOOR + 1.02 - k * 0.14, 0.63));
      for (const s of [-1, 1]) { const a = mesh(cyl(0.008, 0.008, 0.7, 4), steel, s * 0.18, FLOOR + 1.6, 0.2); a.rotation.z = s * -0.5; I.add(a); }
      const pad = new THREE.Group(); pad.position.set(0.2, FLOOR + 0.04, 1.3); pad.rotation.y = -0.4; I.add(pad);
      pad.add(mesh(box(0.42, 0.06, 0.18), std(0xb9b6ae)));
      pad.add(mesh(box(0.1, 0.03, 0.03), std(0x222222), -0.12, 0.04, 0), mesh(box(0.03, 0.03, 0.1), std(0x222222), -0.12, 0.04, 0));
      for (const x of [0.09, 0.15]) pad.add(mesh(cyl(0.022, 0.022, 0.03, 10), std(0xc0393a), x, 0.04, 0.01));
      const h = halo(0x7a8cff, 1.6, 0.22); h.position.set(-0.08, FLOOR + 0.9, 0.7); I.add(h);
      let acc = 0; b.tick = (dt) => { acc += dt; if (acc > 1 / 12) { acc = 0; pixelFrame++; (pixelTex as any).redraw(); } };
      break;
    }
    case 'whalebrew': {
      for (const z of [-0.2, 0.9]) I.add(mesh(box(0.9, 0.28, 0.14), wood(0x7a5634), 0, FLOOR + 0.14, z));
      const bottle = new THREE.Group(); bottle.position.set(0, FLOOR + 0.62, 0.35); bottle.rotation.y = 0.25; I.add(bottle);
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfe8d6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
      bottle.add(mesh(cyl(0.4, 0.4, 1.5, 24).rotateX(Math.PI / 2), glass));
      bottle.add(mesh(cyl(0.12, 0.4, 0.35, 24).rotateX(Math.PI / 2), glass, 0, 0, 0.92));
      bottle.add(mesh(cyl(0.11, 0.11, 0.3, 16).rotateX(Math.PI / 2), glass, 0, 0, 1.24));
      bottle.add(mesh(cyl(0.1, 0.09, 0.16, 12).rotateX(Math.PI / 2), wood(0xb58a58), 0, 0, 1.44));
      const whale = new THREE.Group(); bottle.add(whale);
      const body = new THREE.SphereGeometry(1, 16, 12); body.scale(0.2, 0.17, 0.52);
      whale.add(mesh(body, std(0x3f6185, { roughness: 0.5 })));
      const belly = new THREE.SphereGeometry(1, 16, 12, 0, TAU, Math.PI * 0.55, Math.PI * 0.45); belly.scale(0.195, 0.17, 0.51);
      whale.add(mesh(belly, std(0xdfe6ea, { roughness: 0.5 })));
      const tail = new THREE.Shape(); tail.moveTo(0, 0); tail.quadraticCurveTo(0.12, -0.03, 0.22, -0.11); tail.quadraticCurveTo(0.12, -0.12, 0, -0.07); tail.quadraticCurveTo(-0.12, -0.12, -0.22, -0.11); tail.quadraticCurveTo(-0.12, -0.03, 0, 0);
      const tg = new THREE.ShapeGeometry(tail); tg.rotateX(Math.PI / 2);
      const tm = mesh(tg, std(0x3f6185, { side: THREE.DoubleSide }), 0, 0.02, -0.5); whale.add(tm);
      for (const s of [-1, 1]) whale.add(mesh(new THREE.SphereGeometry(0.018, 6, 4), std(0x111111), s * 0.15, 0.02, 0.33));
      b.tick = (dt, t) => { whale.position.y = Math.sin(t * 1.3) * 0.05 - 0.08; whale.rotation.z = Math.sin(t * 0.9) * 0.1; tm.rotation.x = Math.sin(t * 2.4) * 0.3; };
      break;
    }
    case 'arxiv-vanity': {
      I.add(mesh(box(1.5, 0.06, 0.6), wood(0x5a3a24), 0, FLOOR + 0.78, -0.3));
      for (const x of [-0.65, 0.65]) I.add(mesh(box(0.06, 0.78, 0.5), wood(0x5a3a24), x, FLOOR + 0.39, -0.3));
      I.add(mesh(box(1.3, 0.98, 0.06), wood(0x3a2416), 0, FLOOR + 1.42, -0.55));
      I.add(mesh(new THREE.PlaneGeometry(1.1, 0.78), std(0xdfe6ee, { metalness: 1, roughness: 0.06, envMapIntensity: 1.4 }), 0, FLOOR + 1.42, -0.515));
      for (let i = 0; i < 12; i++) {
        const t = i / 12; let x: number, y: number;
        if (t < 0.25) { x = -0.6 + (t / 0.25) * 1.2; y = 0.44; } else if (t < 0.5) { x = 0.6; y = 0.44 - ((t - 0.25) / 0.25) * 0.88; } else if (t < 0.75) { x = 0.6 - ((t - 0.5) / 0.25) * 1.2; y = -0.44; } else { x = -0.6; y = -0.44 + ((t - 0.75) / 0.25) * 0.88; }
        I.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), basic(0xfff0cf), x, FLOOR + 1.42 + y, -0.5));
        const h = halo(0xffd9a0, 0.5, 0.7); h.position.set(x, FLOOR + 1.42 + y, -0.48); I.add(h);
      }
      for (let i = 0; i < 6; i++) { const p = mesh(box(0.42, 0.012, 0.56), std(0xf6f2ea, { roughness: 0.9 }), -0.35, FLOOR + 0.82 + i * 0.014, -0.25); p.rotation.y = (rnd() - 0.5) * 0.2; I.add(p); }
      const pt = canvasTex(256, 340, (ctx, w, h) => { ctx.fillStyle = '#fbf8f1'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#222'; ctx.font = `700 22px ${MONO}`; ctx.fillText('Attention Is', 20, 40); ctx.fillText('All You Read', 20, 66); ctx.fillStyle = '#999'; for (let i = 0; i < 12; i++) ctx.fillRect(20, 96 + i * 18, w - 40 - (i % 4) * 22, 6); });
      const paper = mesh(new THREE.PlaneGeometry(0.36, 0.48), std(0xffffff, { map: pt, roughness: 0.9, side: THREE.DoubleSide }), 0.3, FLOOR + 0.83, -0.2); paper.rotation.x = -Math.PI / 2 + 0.05; paper.rotation.z = -0.2; I.add(paper);
      break;
    }
    case 'django': {
      const lower = { x: -0.28, r: 0.27 }, upper = { x: 0.03, r: 0.22 };
      const sdf = (x: number, y: number) => { const a = Math.hypot(x - lower.x, y) - lower.r, bb = Math.hypot(x - upper.x, y) - upper.r, k = 0.12; const hh = Math.max(k - Math.abs(a - bb), 0) / k; return Math.min(a, bb) - hh * hh * k * 0.25; };
      const s = new THREE.Shape(); const N = 48; const cx = -0.14;
      for (let i = 0; i < N; i++) { const an = (i / N) * TAU, dx = Math.cos(an), dy = Math.sin(an); let lo = 0, hi = 1; for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (sdf(cx + dx * m, dy * m) < 0) lo = m; else hi = m; } if (i) s.lineTo(cx + dx * lo, dy * lo); else s.moveTo(cx + dx * lo, dy * lo); }
      const hole = new THREE.Path(); hole.moveTo(0.02, -0.07); hole.lineTo(0.02, 0.07); hole.absarc(0.02, 0, 0.07, Math.PI / 2, -Math.PI / 2, true); s.holes.push(hole);
      const gt = new THREE.Group(); gt.position.set(0.05, FLOOR + 0.62, 0.2); gt.rotation.set(-0.22, 0.25, Math.PI / 2 + 0.12); gt.scale.setScalar(1.7); I.add(gt);
      const eg = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 12 });
      gt.add(mesh(eg, [std(0xd99a52, { roughness: 0.4 }), std(0x7a3f1c, { roughness: 0.45 })]));
      gt.add(mesh(box(0.42, 0.055, 0.03), std(0x2a1a10, { roughness: 0.5 }), 0.44, 0, 0.085));
      gt.add(mesh(box(0.13, 0.08, 0.03), std(0x2a1a10), 0.71, 0, 0.08));
      gt.add(mesh(box(0.07, 0.07, 0.012), std(0x2a1a10), -0.36, 0, 0.082));
      for (let i = 0; i < 6; i++) gt.add(mesh(box(1.06, 0.003, 0.003), steel, 0.25, -0.022 + i * 0.009, 0.104));
      break;
    }
    case 'ukhas': {
      const balloon = new THREE.Group(); I.add(balloon);
      const env = mesh(new THREE.SphereGeometry(0.88, 28, 20), std(0xfaf7f0, { roughness: 0.35, emissive: 0x302820 }));
      env.scale.set(1.04, 1.08, 1.5); balloon.add(env);
      balloon.add(mesh(cyl(0.004, 0.004, 0.7, 4), std(0x222222), 0, -1.2, 0));
      const chute = mesh(new THREE.ConeGeometry(0.16, 0.12, 10), std(0xd4497e), 0, -1.0, 0); balloon.add(chute);
      const pay = mesh(box(0.2, 0.18, 0.2), std(0xe8873a), 0, -1.5, 0); balloon.add(pay);
      const home = new THREE.Vector3(0, 0.05, 0.1);
      balloon.position.copy(home);
      let free = false, ft = 0; const wpos = new THREE.Vector3(), wq = new THREE.Quaternion();
      b.tick = (dt, t, open) => {
        if (!free) {
          balloon.position.set(home.x, home.y + Math.sin(t * 2) * 0.03, home.z);
          env.scale.set(1.04 + Math.sin(t * 3) * 0.015, 1.08, 1.5);
          if (open > 0.92 && !reduced) { ft += dt; balloon.position.z = home.z + Math.min(ft, 2.4) * ft * 1.3; env.scale.z = lerp(1.5, 1.08, clamp(ft / 1.2, 0, 1)); env.scale.x = lerp(1.04, 1.08, clamp(ft / 1.2, 0, 1)); if (balloon.position.z > CL / 2 + 1.6) { free = true; ft = 0; balloon.getWorldPosition(wpos); balloon.getWorldQuaternion(wq); scene.attach(balloon); } }
        } else {
          ft += dt; balloon.position.y += dt * (1.5 + ft * 1.6); balloon.position.x -= dt * (2.5 + ft * 0.8); balloon.position.z += dt * 0.6;
          balloon.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-2 * dt));
          balloon.scale.setScalar(1 + ft * 0.08);
          if (ft > 14) balloon.visible = false;
        }
      };
      b.reset = () => { if (free) { I.add(balloon); free = false; } ft = 0; balloon.visible = true; balloon.scale.setScalar(1); balloon.quaternion.identity(); balloon.position.copy(home); env.scale.set(1.04, 1.08, 1.5); };
      break;
    }
  }
}

CARGO.forEach((c) => {
  const g = new THREE.Group();
  g.position.set(BAY_X(c.bay), tierY(c.tier), 0);
  ship.add(g);
  const st = sideTex(c);
  const outer = std(0xffffff, { map: st, roughness: 0.7, metalness: 0.2 });
  const plain = std(c.color, { roughness: 0.75, metalness: 0.2 });
  const T = 0.05;
  const walls: THREE.Mesh[] = [
    mesh(box(CW, T, CL), [plain, plain, plain, interiorMat, plain, plain], 0, CH / 2 - T / 2, 0),
    mesh(box(CW, T, CL), [plain, plain, floorMat, plain, plain, plain], 0, -CH / 2 + T / 2, 0),
    mesh(box(CW, CH, T), [plain, plain, plain, plain, interiorMat, plain], 0, 0, -CL / 2 + T / 2),
    mesh(box(T, CH, CL), [outer, interiorMat, plain, plain, plain, plain], CW / 2 - T / 2, 0, 0),
    mesh(box(T, CH, CL), [interiorMat, outer, plain, plain, plain, plain], -CW / 2 + T / 2, 0, 0),
  ];
  walls.forEach((w) => g.add(w));
  // corner posts at the door end
  const post = std(c.color, { roughness: 0.6 });
  for (const sx of [-1, 1]) g.add(mesh(box(0.12, CH, 0.14), post, sx * (CW / 2 - 0.06), 0, CL / 2 - 0.02));
  g.add(mesh(box(CW, 0.14, 0.14), post, 0, CH / 2 - 0.07, CL / 2 - 0.02));
  g.add(mesh(box(CW, 0.14, 0.14), post, 0, -CH / 2 + 0.07, CL / 2 - 0.02));
  // doors
  const dt = doorTex(c);
  const faceMat = std(0xffffff, { map: dt, emissiveMap: dt, emissive: 0xffffff, emissiveIntensity: 0.07, roughness: 0.65, metalness: 0.2 });
  const leafW = CW / 2 - 0.06, leafH = CH - 0.26;
  const mkLeaf = (left: boolean) => {
    const pivot = new THREE.Group(); pivot.position.set(left ? -CW / 2 + 0.06 : CW / 2 - 0.06, 0, CL / 2 + 0.06); g.add(pivot);
    const lg = box(leafW, leafH, 0.06);
    const uv = lg.attributes.uv as THREE.BufferAttribute;
    for (let i = 16; i < 20; i++) uv.setX(i, uv.getX(i) * 0.5 + (left ? 0 : 0.5));
    const leaf = mesh(lg, [plain, plain, plain, plain, faceMat, interiorMat], (left ? 1 : -1) * leafW / 2, 0, 0);
    pivot.add(leaf);
    for (const f of [0.25, 0.72]) {
      const bx = (left ? 1 : -1) * leafW * f;
      pivot.add(mesh(cyl(0.022, 0.022, leafH + 0.1, 6), steel, bx, 0, 0.07));
      pivot.add(mesh(box(0.05, 0.22, 0.05), steel, bx + (left ? 0.07 : -0.07), -0.25, 0.09));
    }
    leaf.userData.box = c.slug;
    return pivot;
  };
  const doors: [THREE.Object3D, THREE.Object3D] = [mkLeaf(true), mkLeaf(false)];
  const interior = new THREE.Group(); interior.visible = false; g.add(interior);
  // a bare bulb on a cord
  const bulbG = new THREE.Group(); bulbG.position.set(0, CH / 2 - 0.05, 1.0); interior.add(bulbG);
  bulbG.add(mesh(cyl(0.006, 0.006, 0.4, 4), std(0x111111), 0, -0.2, 0));
  bulbG.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), basic(0xffe2a8), 0, -0.44, 0));
  const bh = halo(0xffc070, 1.2, 0.9); bh.position.set(0, -0.44, 0); bulbG.add(bh);
  interior.userData.bulb = bulbG;
  walls.forEach((w) => (w.userData.box = c.slug));
  g.children.forEach((ch) => { if (!ch.userData.box) ch.userData.box = c.slug; });
  const b: Box = { cargo: c, group: g, doors, interior, open: 0, vel: 0, want: 0, faceMat };
  buildInterior(b);
  boxes.push(b);
  clickables.push(g);
});

// Particles ---------------------------------------------------------------------------------
class Particles {
  pts: THREE.Points; pos: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array; alpha: Float32Array; grow: Float32Array; n: number; next = 0;
  drag: number; gravity: number; baseAlpha: number;
  constructor(n: number, color: number, opts: { blending?: THREE.Blending; drag?: number; gravity?: number; alpha?: number }) {
    this.n = n; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.grow = new Float32Array(n);
    this.drag = opts.drag ?? 0.6; this.gravity = opts.gravity ?? -9.8; this.baseAlpha = opts.alpha ?? 1;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1000;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: opts.blending ?? THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 300 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSize*uScale/max(-mv.z, 0.1); vA = aAlpha; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a*a*vA); }',
    });
    this.pts = new THREE.Points(g, m); this.pts.frustumCulled = false; scene.add(this.pts);
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow = 0) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = 0; this.max[i] = life; this.size[i] = size; this.grow[i] = grow;
  }
  update(dt: number, wind: THREE.Vector3) {
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] >= this.max[i]) { this.alpha[i] = 0; continue; }
      this.life[i] += dt; const j = i * 3;
      this.vel[j] = (this.vel[j] - wind.x) * k + wind.x; this.vel[j + 1] = this.vel[j + 1] * k + this.gravity * dt; this.vel[j + 2] = (this.vel[j + 2] - wind.z) * k + wind.z;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const u = this.life[i] / this.max[i];
      this.alpha[i] = this.baseAlpha * Math.min(1, u * 6) * (1 - u) * (1 - u);
    }
    const g = this.pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
  }
}
const spray = new Particles(coarse ? 260 : 420, 0xe6eef2, { drag: 0.5, gravity: -9.8, alpha: 0.55 });
const smoke = new Particles(110, 0x2a2b2e, { drag: 0.25, gravity: 0.6, alpha: 0.5 });
const steam = new Particles(60, 0xf2f2f0, { drag: 1.2, gravity: 1.2, alpha: 0.8 });
const rain = (() => {
  const N = coarse ? 700 : 1400;
  const pos = new Float32Array(N * 6);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.LineBasicMaterial({ color: 0xaab8c4, transparent: true, opacity: 0, depthWrite: false });
  const l = new THREE.LineSegments(g, m); l.frustumCulled = false; scene.add(l);
  const drops = Array.from({ length: N }, () => new THREE.Vector3((rnd() - 0.5) * 60, rnd() * 40, (rnd() - 0.5) * 60));
  return { l, m, pos, drops, N };
})();

// Camera + interaction --------------------------------------------------------------------
type Focus = { kind: 'box'; box: Box } | { kind: 'bridge' } | { kind: 'funnel' } | null;
let focus: Focus = null;
let az = 0.62, el = 0.16, dist = 54;
let azT = az, elT = el, distT = dist;
const ORBIT_T = new THREE.Vector3(-0.5, 6.2, 0);
const portrait = () => camera.aspect < 0.8;
const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
const fromPos = new THREE.Vector3(), fromTgt = new THREE.Vector3();
let blend = 1, introT = reduced ? 1 : 0;
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function orbitPose(outP: THREE.Vector3, outT: THREE.Vector3, a = az, e = el, d = dist) {
  const dd = d * (portrait() ? 1.55 : 1);
  outT.copy(ORBIT_T);
  if (portrait()) outT.y += 1.5;
  const aa = portrait() ? a + 0.45 : a;
  outP.set(Math.sin(aa) * Math.cos(e), Math.sin(e), Math.cos(aa) * Math.cos(e)).multiplyScalar(dd).add(outT);
}
function focusPose(f: NonNullable<Focus>, outP: THREE.Vector3, outT: THREE.Vector3) {
  ship.updateMatrixWorld();
  if (f.kind === 'box') {
    const g = f.box.group.position;
    const back = portrait() ? 8.6 : 6.6;
    outP.set(g.x + 0.0, g.y + 0.45, CL / 2 + back);
    outT.set(g.x, g.y - (portrait() ? 0.85 : 0.12), CL / 2 - 1.5);
  } else if (f.kind === 'bridge') {
    outP.set(-4.5, 11.5, portrait() ? 13 : 9.5); outT.set(-14.5, 9.3, 0);
    if (!portrait()) outT.z = 1.6;
  } else {
    outP.set(-8.5, 13.2, portrait() ? 22 : 17); outT.set(-20.6, 10.4, 0);
    if (!portrait()) outT.z = 1.8;
  }
  ship.localToWorld(outP); ship.localToWorld(outT);
}
function setFocus(f: Focus) {
  if (f && focus && f.kind === focus.kind && (f.kind !== 'box' || (focus.kind === 'box' && f.box === focus.box))) return;
  fromPos.copy(camera.position); fromTgt.copy(camTgt);
  blend = 0;
  if (focus?.kind === 'box') focus.box.want = 0;
  focus = f;
  if (f?.kind === 'box') { f.box.interior.visible = true; setTimeout(() => { if (focus?.kind === 'box' && focus.box === f.box) f.box.want = 1; }, reduced ? 100 : 650); }
  renderCard();
  document.documentElement.classList.toggle('focused', !!f);
}
const DRAG = { id: -1, x: 0, y: 0, sx: 0, sy: 0, moved: false };
const pinch = new Map<number, { x: number; y: number }>(); let pinchD = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch.size === 2) { const [a, b] = [...pinch.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); DRAG.moved = true; return; }
  Object.assign(DRAG, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
  skipIntro();
});
canvas.addEventListener('pointermove', (e) => {
  const pp = pinch.get(e.pointerId); if (pp) { pp.x = e.clientX; pp.y = e.clientY; }
  if (pinch.size === 2) { const [a, b] = [...pinch.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchD > 0 && !focus) distT = clamp(distT * (pinchD / d), 26, 80); pinchD = d; return; }
  if (DRAG.id !== e.pointerId) { if (!coarse) hover(e.clientX, e.clientY); return; }
  const dx = e.clientX - DRAG.x, dy = e.clientY - DRAG.y; DRAG.x = e.clientX; DRAG.y = e.clientY;
  if (!DRAG.moved && Math.hypot(e.clientX - DRAG.sx, e.clientY - DRAG.sy) > 7) { DRAG.moved = true; canvas.classList.add('grabbing'); tipEl.classList.remove('show'); }
  if (DRAG.moved && !focus) { azT = clamp(azT - dx * 0.005, -1.95, 1.95); elT = clamp(elT + dy * 0.003, 0.04, 0.85); }
});
const up = (e: PointerEvent) => {
  pinch.delete(e.pointerId); if (pinch.size < 2) pinchD = 0;
  if (DRAG.id !== e.pointerId) return;
  DRAG.id = -1; canvas.classList.remove('grabbing');
  if (!DRAG.moved && e.type === 'pointerup') click(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!focus) distT = clamp(distT * (1 + e.deltaY * 0.001), 26, 80); }, { passive: false });
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
function pick(x: number, y: number): Focus {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(clickables, true);
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    while (o) {
      if (o.userData.box) { const b = boxes.find((bb) => bb.cargo.slug === o!.userData.box)!; return { kind: 'box', box: b }; }
      if (o.userData.hit === 'bridge') return { kind: 'bridge' };
      if (o.userData.hit === 'funnel') return { kind: 'funnel' };
      o = o.parent;
    }
  }
  return null;
}
function click(x: number, y: number) {
  if (introT < 1) return;
  const f = pick(x, y);
  if (!f) { if (focus) setFocus(null); return; }
  if (focus && f.kind === focus.kind && (f.kind !== 'box' || (focus.kind === 'box' && f.box === focus.box))) { setFocus(null); return; }
  setFocus(f);
}
let lastHover = 0;
function hover(x: number, y: number) {
  const now = performance.now(); if (now - lastHover < 70) return; lastHover = now;
  if (introT < 1) return;
  const f = pick(x, y);
  canvas.classList.toggle('pointing', !!f);
  boxes.forEach((b) => (b.faceMat.emissiveIntensity = f?.kind === 'box' && f.box === b ? 0.35 : 0.07));
  if (f && !(focus && f.kind === focus.kind && (f.kind !== 'box' || (focus.kind === 'box' && f.box === focus.box)))) {
    tipEl.textContent = f.kind === 'box' ? `${f.box.cargo.label.replace('\n', ' ')} · open` : f.kind === 'bridge' ? "Captain's log · read" : 'Funnel · Replicate';
    tipEl.style.transform = `translate(${x + 16}px, ${y + 14}px)`;
    tipEl.classList.add('show');
  } else tipEl.classList.remove('show');
}
canvas.addEventListener('pointerleave', () => tipEl.classList.remove('show'));

// Cards ----------------------------------------------------------------------------------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pretty = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function renderCard() {
  if (!focus) { cardEl.classList.remove('show'); return; }
  let html = '';
  if (focus.kind === 'box') {
    const c = focus.box.cargo; const i = CARGO.indexOf(c);
    cardEl.style.setProperty('--accent', c.color);
    html = `<p class="code"><span>${esc(c.code)}</span><span>Bay ${String(c.bay + 1).padStart(2, '0')} · Tier ${String(c.tier + 1).padStart(2, '0')}</span></p>
      <h2>${esc(c.name)}</h2><p class="blurb">${esc(cap(c.blurb))}.</p>
      <a class="go" href="${esc(c.url)}">${esc(pretty(c.url))} <span aria-hidden="true">↗</span></a>
      <dl><dt>Contents</dt><dd>${esc(c.contents)}</dd></dl>
      <div class="nav"><button data-nav="-1" aria-label="Previous container">←</button><span>${i + 1} / ${CARGO.length}</span><button data-nav="1" aria-label="Next container">→</button><button class="close" data-close>Close doors <kbd>Esc</kbd></button></div>`;
  } else if (focus.kind === 'bridge') {
    cardEl.style.setProperty('--accent', '#ffb35c');
    html = `<p class="code"><span>Captain's log</span><span>MV Firshman</span></p>
      <h2>Ben Firshman</h2><p class="blurb log">Weather: variable. Cargo: nine containers, see manifest. Main engine: <a href="${esc(ENGINE.url)}">${esc(ENGINE.name)}</a>. Correspondence always welcome.</p>
      <a class="go" href="mailto:${esc(LOG.email)}">${esc(LOG.email)}</a>
      <p class="socials">${LOG.socials.map((s) => `<a href="${esc(s.url)}">${esc(s.name)} <span>${esc(s.handle)}</span></a>`).join('')}</p>
      <div class="nav"><button class="close" data-close>Back on deck <kbd>Esc</kbd></button></div>`;
  } else {
    cardEl.style.setProperty('--accent', '#c4462f');
    html = `<p class="code"><span>Main engine</span><span>Now</span></p>
      <h2>${esc(ENGINE.name)}</h2><p class="blurb">${esc(cap(ENGINE.blurb))}. It's what this ship runs on these days.</p>
      <a class="go" href="${esc(ENGINE.url)}">${esc(pretty(ENGINE.url))} <span aria-hidden="true">↗</span></a>
      <div class="nav"><button class="close" data-close>Back on deck <kbd>Esc</kbd></button></div>`;
  }
  cardEl.innerHTML = html;
  cardEl.classList.add('show');
}
cardEl.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button'); if (!t) return;
  if (t.dataset.close !== undefined) { setFocus(null); return; }
  if (t.dataset.nav && focus?.kind === 'box') { const i = CARGO.indexOf(focus.box.cargo); const n = (i + Number(t.dataset.nav) + CARGO.length) % CARGO.length; setFocus({ kind: 'box', box: boxes[n] }); }
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (manifestEl.classList.contains('open')) { setManifest(false); manifestBtn.focus(); } else if (focus) setFocus(null); }
  if (focus?.kind === 'box' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target as HTMLElement).closest?.('#manifest')) {
    const i = CARGO.indexOf(focus.box.cargo); const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + CARGO.length) % CARGO.length; setFocus({ kind: 'box', box: boxes[n] });
  }
});

// Manifest (list view) -------------------------------------------------------------------
function setManifest(open: boolean) {
  manifestEl.classList.toggle('open', open); manifestBtn.setAttribute('aria-expanded', String(open));
  if (open) (manifestEl.querySelector('h2') as HTMLElement)?.focus();
}
manifestBtn.addEventListener('click', () => setManifest(!manifestEl.classList.contains('open')));
manifestEl.querySelector('.close')?.addEventListener('click', () => { setManifest(false); manifestBtn.focus(); });
manifestEl.addEventListener('focusin', () => { if (!manifestEl.classList.contains('open')) setManifest(true); });
manifestEl.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.open!; setManifest(false); skipIntro(true);
  if (k === 'bridge' || k === 'funnel') setFocus({ kind: k }); else setFocus({ kind: 'box', box: boxes.find((x) => x.cargo.slug === k)! });
}));

// Weather + sound --------------------------------------------------------------------------
weatherBtn.addEventListener('click', () => {
  stormT = stormT ? 0 : 1;
  weatherBtn.setAttribute('aria-pressed', String(!!stormT));
  weatherBtn.querySelector('.lbl')!.textContent = stormT ? 'Storm' : 'Calm';
  audio.weather();
});
let actx: AudioContext | null = null, master: GainNode, amb: { wind: GainNode; surf: GainNode; rain: GainNode } | null = null;
let soundOn = false;
const audio = {
  ctx() {
    if (!actx) { actx = new (window.AudioContext || (window as any).webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination); }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  },
  noise(ctx: AudioContext, color: 'brown' | 'white') {
    const len = ctx.sampleRate * 4; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s;
  },
  ambient(on: boolean) {
    const ctx = this.ctx();
    if (on && !amb) {
      const mk = (color: 'brown' | 'white', type: BiquadFilterType, f: number, q = 0.7) => { const n = this.noise(ctx, color); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; n.connect(fl).connect(g).connect(master); n.start(); return g; };
      amb = { surf: mk('brown', 'lowpass', 520), wind: mk('white', 'bandpass', 650, 0.6), rain: mk('white', 'highpass', 3000) };
    }
    soundOn = on;
  },
  weather() { /* levels follow `storm` in the loop */ },
  horn() {
    const ctx = this.ctx(); const t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.25); g.gain.setValueAtTime(0.32, t + 2.3); g.gain.exponentialRampToValueAtTime(0.001, t + 3.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(1100, t + 0.4); lp.frequency.linearRampToValueAtTime(700, t + 3);
    lp.connect(g).connect(master);
    for (const [f, a] of [[92, 1], [138.5, 0.7], [185, 0.25]] as const) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.97, t); o.frequency.linearRampToValueAtTime(f, t + 0.3); o.frequency.setValueAtTime(f, t + 2.4); o.frequency.linearRampToValueAtTime(f * 0.94, t + 3.3);
      const og = ctx.createGain(); og.gain.value = a * 0.33; o.connect(og).connect(lp); o.start(t); o.stop(t + 3.5);
    }
    // a little echo off the fog
    const dl = ctx.createDelay(1.5); dl.delayTime.value = 0.42; const fb = ctx.createGain(); fb.gain.value = 0.28; const wet = ctx.createGain(); wet.gain.value = 0.35;
    g.connect(dl); dl.connect(fb).connect(dl); dl.connect(wet).connect(master);
  },
};
let hornT = -1;
hornBtn.addEventListener('click', () => { skipIntro(); audio.horn(); hornT = 0; hornBtn.classList.add('blowing'); setTimeout(() => hornBtn.classList.remove('blowing'), 3000); });
soundBtn.addEventListener('click', () => {
  audio.ambient(!soundOn);
  soundBtn.setAttribute('aria-pressed', String(soundOn));
  soundBtn.querySelector('.lbl')!.textContent = soundOn ? 'Sound on' : 'Sound off';
});

// Intro ----------------------------------------------------------------------------------
function skipIntro(now = false) {
  if (introT >= 1) return;
  if (now) introT = 1; else introSpeed = 4;
}
let introSpeed = 1;
const INTRO = 6.5;

// Resize ---------------------------------------------------------------------------------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = portrait() ? 50 : 35; camera.updateProjectionMatrix();
  for (const p of [spray, smoke, steam]) (p.pts.material as THREE.ShaderMaterial).uniforms.uScale.value = (h * DPR) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}
addEventListener('resize', resize); resize();

// Loop -----------------------------------------------------------------------------------
let last = performance.now(), time = 0, raf = 0;
let heave = 0, pitch = 0, roll = 0, heaveV = 0, pitchV = 0, rollV = 0;
const bowW = new THREE.Vector3(), bowPrev = new THREE.Vector3();
let flash = 0, nextFlash = 6;
const wind = new THREE.Vector3();
const lampPos = new THREE.Vector3();
const lamp = new THREE.PointLight(0xffcf8a, 0, 7, 1.6); scene.add(lamp);
function frame() {
  raf = requestAnimationFrame(frame);
  const nowT = performance.now(); const dt = Math.min((nowT - last) / 1000, 0.05); last = nowT; time += dt;
  // weather
  storm = damp(storm, stormT, 0.9, dt);
  const W = (a: number, b: number) => lerp(a, b, storm);
  skyU.uZenith.value.copy(CALM.zenith).lerp(STORM.zenith, storm);
  skyU.uHorizon.value.copy(CALM.horizon).lerp(STORM.horizon, storm);
  skyU.uCool.value.copy(CALM.cool).lerp(STORM.cool, storm);
  skyU.uSunCol.value.copy(CALM.sun).lerp(STORM.sun, storm);
  skyU.uStorm.value = storm; skyU.uTime.value = time;
  seaU.uDeep.value.copy(CALM.deep).lerp(STORM.deep, storm); seaU.uShallow.value.copy(CALM.shallow).lerp(STORM.shallow, storm);
  const fogDen = W(CALM.fog, STORM.fog); seaU.uFogDen.value = fogDen;
  (scene.fog as THREE.FogExp2).density = fogDen * 0.9;
  (scene.fog as THREE.FogExp2).color.copy(skyU.uCool.value).lerp(skyU.uHorizon.value, 0.2);
  // lightning
  if (storm > 0.6 && !reduced) { nextFlash -= dt; if (nextFlash < 0) { flash = 1; nextFlash = 5 + rnd() * 9; } }
  flash = Math.max(0, flash - dt * 4.5);
  const fl = flash > 0.55 ? 1 : flash > 0.4 ? 0.1 : flash > 0.15 ? 0.7 : flash * 3;
  skyU.uFlash.value = fl * 0.9;
  hemi.intensity = W(CALM.hemi, STORM.hemi) + fl * 2.5; sunL.intensity = W(CALM.sunI, STORM.sunI); fill.intensity = W(CALM.fill, STORM.fill);
  sunL.color.copy(skyU.uSunCol.value);
  scene.environmentIntensity = W(0.55, 0.3);
  // waves and the ship riding them
  updateWaves(dt);
  seaU.uTravel.value = travel % 1000; seaU.uAmpTot.value = ampTot;
  const hB = waveH(17, 0), hS = waveH(-18, 0), hP = waveH(-1, -3.4), hSt = waveH(-1, 3.4), hM = waveH(-1, 0);
  const tH = (hB + hS + hM * 2) / 4 * 0.85 - 0.15;
  const tP = Math.atan2(hB - hS, 35) * 0.95;
  const tR = Math.atan2(hSt - hP, 6.8) * 0.55 + Math.sin(time * 0.45) * 0.012 * (1 + storm * 2);
  const spring = (x: number, v: number, t: number, k: number, c: number): [number, number] => { const a = (t - x) * k - v * c; v += a * dt; return [x + v * dt, v]; };
  [heave, heaveV] = spring(heave, heaveV, tH, 9, 4.5); [pitch, pitchV] = spring(pitch, pitchV, tP, 7, 4); [roll, rollV] = spring(roll, rollV, tR, 5, 2.4);
  ship.position.y = heave; ship.rotation.set(roll, 0, pitch, 'ZXY');
  ship.updateMatrixWorld();
  radar.rotation.y += dt * 1.8;
  // spray at the bow
  bowW.set(21.3, 0.6, 0).applyMatrix4(ship.matrixWorld);
  const vy = (bowW.y - bowPrev.y) / Math.max(dt, 1e-3); bowPrev.copy(bowW);
  const sink = bowW.y - waveH(bowW.x, 0);
  const speed = W(CALM.speed, STORM.speed);
  wind.set(-speed * 0.9 - W(1, 6), 0, W(0.5, 3));
  let rate = W(14, 60) * (reduced ? 0.3 : 1);
  if (vy < -0.6 && sink < 1.2) rate += (-vy) * W(50, 160) * (reduced ? 0.3 : 1);
  let ne = rate * dt; while (ne > 0) { if (rnd() < ne) { const s = rnd() < 0.5 ? -1 : 1; tmp.set(bowW.x - rnd() * 2.5, bowW.y - 0.4 + rnd() * 0.5, s * (0.6 + rnd() * 1.4)); tmp2.set(-speed * 0.4 - rnd() * 3, 2.5 + rnd() * W(4, 8) + (-vy) * 0.6, s * (2 + rnd() * 4)); spray.emit(tmp, tmp2, 0.7 + rnd() * 1.0, 0.25 + rnd() * 0.6, 1.4); } ne -= 1; }
  spray.update(dt, wind);
  // smoke and steam
  if (rnd() < dt * 9) { tmp.set(-20.4 + rnd() * 0.3, 14.4, (rnd() - 0.5) * 0.6).applyMatrix4(ship.matrixWorld); tmp2.set(-1 + rnd(), 2 + rnd(), (rnd() - 0.5)); smoke.emit(tmp, tmp2, 5 + rnd() * 3, 1.2 + rnd() * 0.6, 1.6); }
  smoke.update(dt, wind);
  if (hornT >= 0) { hornT += dt; if (hornT < 2.6 && rnd() < dt * 40) { tmp.set(-19.1, 12.45, 0.6).applyMatrix4(ship.matrixWorld); tmp2.set(1.5 + rnd(), 1.5 + rnd(), (rnd() - 0.5) * 0.8); steam.emit(tmp, tmp2, 1.6 + rnd(), 0.25, 1.8); } if (hornT > 6) hornT = -1; }
  steam.update(dt, wind);
  // rain
  const rainA = smooth(0.35, 1, storm) * 0.55; rain.m.opacity = rainA; rain.l.visible = rainA > 0.01;
  if (rain.l.visible) {
    const fallX = wind.x * 0.25, fallY = -26, fallZ = wind.z * 0.4;
    for (let i = 0; i < rain.N; i++) {
      const d = rain.drops[i]; d.x += fallX * dt; d.y += fallY * dt; d.z += fallZ * dt;
      if (d.y < -2) { d.set((rnd() - 0.5) * 70, 40, (rnd() - 0.5) * 70); }
      const bx = camTgt.x + d.x, by = d.y, bz = camTgt.z + d.z + 10;
      rain.pos.set([bx, by, bz, bx - fallX * 0.035, by - fallY * 0.035, bz - fallZ * 0.035], i * 6);
    }
    rain.l.geometry.attributes.position.needsUpdate = true;
  }
  // containers
  for (const b of boxes) {
    const a = (b.want - b.open) * 26 - b.vel * 7; b.vel += a * dt; b.open += b.vel * dt;
    if (reduced) { b.open = damp(b.open, b.want, 6, dt); b.vel = 0; }
    const ang = clamp(b.open, -0.05, 1.12) * 1.78;
    b.doors[0].rotation.y = -ang; b.doors[1].rotation.y = ang;
    if (b.interior.visible) {
      b.tick?.(dt, time, b.open);
      const bulb = b.interior.userData.bulb as THREE.Object3D;
      bulb.rotation.z = -roll * 1.2 + Math.sin(time * 1.3) * 0.06; bulb.rotation.x = pitch * 1.2;
      if (b.want === 0 && b.open < 0.02 && !(focus?.kind === 'box' && focus.box === b)) { b.interior.visible = false; b.reset?.(); }
    }
  }
  const fb = focus?.kind === 'box' ? focus.box : null;
  if (fb) { lampPos.set(0, CH / 2 - 0.45, 1.0); fb.group.localToWorld(lampPos); lamp.position.copy(lampPos); }
  lamp.intensity = damp(lamp.intensity, fb ? clamp(fb.open, 0, 1) * 6 : 0, 5, dt);
  // camera
  az = damp(az, azT, 6, dt); el = damp(el, elT, 6, dt); dist = damp(dist, distT, 5, dt);
  if (introT < 1) {
    introT = Math.min(1, introT + (dt * introSpeed) / INTRO);
    const k = ease(introT);
    orbitPose(tmp, tmp2, lerp(1.25, az, k), lerp(0.035, el, k), lerp(105, dist, k));
    camPos.copy(tmp); camTgt.copy(tmp2);
  } else {
    if (focus) focusPose(focus, tmp, tmp2); else orbitPose(tmp, tmp2);
    if (blend < 1) {
      blend = Math.min(1, blend + dt / (reduced ? 0.6 : 1.5));
      const k = ease(blend);
      camPos.copy(fromPos).lerp(tmp, k); camTgt.copy(fromTgt).lerp(tmp2, k);
    } else { camPos.copy(tmp); camTgt.copy(tmp2); }
  }
  if (time > 1.2) capEl.classList.add('show');
  const sway = reduced ? 0 : 1;
  camera.position.copy(camPos);
  camera.position.y += Math.sin(time * 0.7) * 0.15 * sway;
  const waterAt = waveH(camera.position.x, camera.position.z) + 1.2;
  if (camera.position.y < waterAt) camera.position.y = waterAt;
  camera.lookAt(camTgt);
  sky.position.copy(camera.position);
  // audio levels
  if (amb && actx) {
    const t = actx.currentTime, on = soundOn ? 1 : 0;
    amb.surf.gain.setTargetAtTime(on * (0.5 + 0.35 * Math.max(0, -vy) / 3 + storm * 0.3), t, 0.3);
    amb.wind.gain.setTargetAtTime(on * W(0.05, 0.22), t, 0.5);
    amb.rain.gain.setTargetAtTime(on * smooth(0.4, 1, storm) * 0.08, t, 0.5);
  }
  renderer.render(scene, camera);
}
function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
function stop() { cancelAnimationFrame(raf); raf = 0; }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
start();
document.documentElement.classList.add('ready');

Promise.race([
  Promise.all([document.fonts.load(`800 100px ${STENCIL}`), document.fonts.load(`900 100px ${DISPLAY}`), document.fonts.load(`800 100px ${DISPLAY}`), document.fonts.load(`500 20px ${MONO}`), document.fonts.load(`600 20px ${MONO}`)]),
  new Promise((r) => setTimeout(r, 2500)),
]).then(() => redraws.forEach((r) => r()));

(window as any).__ship = { open: (slug: string) => { introT = 1; const b = boxes.find((x) => x.cargo.slug === slug); setFocus(b ? { kind: 'box', box: b } : (slug as any) === 'bridge' ? { kind: 'bridge' } : { kind: 'funnel' }); }, close: () => setFocus(null), skip: () => { introT = 1; }, storm: (v: number) => { stormT = v; storm = v; }, orbit: (a: number, e: number, d: number) => { azT = az = a; elT = el = e; distT = dist = d; } };
