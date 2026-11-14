import * as THREE from 'three';
import { mulberry32, type Palette, type Mode } from './palettes';

// ---------------------------------------------------------------- GLSL

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const SKY = /* glsl */ `
uniform vec3 uSky, uHaze, uSun, uSunDir;
uniform float uSkySpan, uSunGlow;
vec3 skyColor(vec3 dir){
  float e = dir.y;
  float t = smoothstep(-0.004, uSkySpan, e);
  vec3 c = mix(uHaze, uSky, pow(t, 0.7));
  vec2 a = normalize(dir.xz), b = normalize(uSunDir.xz);
  float az = max(dot(a, b), 0.0);
  float near = max(dot(dir, uSunDir), 0.0);
  // a broad forward-scatter glow in the haze, strongest low down
  float glow = pow(az, 6.0) * exp(-max(e, 0.0) / (uSkySpan * 0.9)) * 0.55 + pow(near, 180.0) * 0.35;
  return c + uSun * glow * uSunGlow;
}
float dither(vec2 p){
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
}
`;

const HEIGHT = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[6];
uniform vec4 uWavePh[6];
uniform vec2 uDir;
uniform float uAmp, uLambda, uSpeed;
uniform vec4 uCursor;
float peaky(float c){ float u = 0.5 + 0.5 * c; return pow(u, 1.7) * 2.0 - 0.75; }
float heightAt(vec2 p){
  float t = uTime;
  float h = 0.0;
#if MODE == 0
  // swell: a narrow spread of long-crested waves, deep-water dispersion (w ~ sqrt(k)),
  // so they slip through each other and gather into sets
  for (int i = 0; i < 6; i++){
    vec4 w = uWaves[i];
    float th = w.z * dot(w.xy, p) - uWavePh[i].x * t + uWavePh[i].y;
    h += w.w * peaky(cos(th));
  }
  h *= 0.8 + 0.35 * snoise(vec3(p * 0.006, t * 0.006));
  h += 0.16 * uAmp * snoise(vec3(p * vec2(0.09, 0.14), t * 0.05));
#elif MODE == 1
  // dunes: long windward slope, short steep slip face, sinuous crests, slow migration downwind
  vec2 q = vec2(dot(p, uDir), dot(p, vec2(-uDir.y, uDir.x)));
  float s = q.x / uLambda + 0.55 * snoise(vec3(q.y * 0.011, q.x * 0.004, 1.7)) + 0.18 * snoise(vec3(q * 0.03, 4.1));
  float u = fract(s - t * uSpeed);
  float c = 0.74;
  float f = u < c ? smoothstep(0.0, c, u) : 1.0 - smoothstep(c, 1.0, u);
  f = pow(f, 1.25);
  float a = 0.62 + 0.38 * snoise(vec3(p * 0.0075, 2.3));
  float breath = 0.92 + 0.08 * sin(t * 0.05);
  h = uAmp * (f - 0.45) * a * breath;
  // a second, weaker dune set crossing at an angle
  vec2 d2 = vec2(cos(1.05), sin(1.05));
  d2 = vec2(uDir.x * d2.x - uDir.y * d2.y, uDir.x * d2.y + uDir.y * d2.x);
  float u2 = fract(dot(p, d2) / (uLambda * 0.55) + 0.4 * snoise(vec3(p * 0.012, 7.0)) - t * uSpeed * 0.7);
  h += uAmp * 0.16 * (u2 < 0.7 ? smoothstep(0.0, 0.7, u2) : 1.0 - smoothstep(0.7, 1.0, u2));
#else
  // haze: slow layered noise, stretched across the view, drifting
  vec2 q = vec2(dot(p, uDir), dot(p, vec2(-uDir.y, uDir.x))) * vec2(1.0, 0.55);
  q += vec2(t * uSpeed, t * uSpeed * 0.3);
  h  = 1.00 * snoise(vec3(q * 0.022, t * 0.012));
  h += 0.48 * snoise(vec3(q * 0.051 + 3.1, t * 0.021));
  h += 0.20 * snoise(vec3(q * 0.115 + 7.3, t * 0.034));
  h *= uAmp;
#endif
  vec2 dc = p - uCursor.xy;
  h += uCursor.z * exp(-dot(dc, dc) / uCursor.w);
  return h;
}
`;

// heights are computed once per column per frame, into a small float texture
const passVert = /* glsl */ `
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const passFrag = /* glsl */ `
${NOISE}
${HEIGHT}
uniform vec2 uMin;
void main(){
  vec2 c = uMin + floor(gl_FragCoord.xy) + 0.5;
  gl_FragColor = vec4(heightAt(c), heightAt(c + vec2(1.0, 0.0)), heightAt(c + vec2(0.0, 1.0)), 1.0);
}
`;

const vert = /* glsl */ `
${SKY}
uniform sampler2D uHeights;
uniform vec2 uMin;
uniform float uGap, uFloor, uAmpTotal, uFogNear, uFogFar;
varying vec3 vFog;
varying float vFogF;
varying vec3 vAmbSky;
varying vec3 vWorld;
varying vec3 vN;
varying float vHn;
varying float vTop;
varying float vDown;
varying vec3 vJit;
varying vec2 vLocal;
void main(){
  vLocal = position.xz;
  vec2 c = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
  vec3 hh = texelFetch(uHeights, ivec2(floor(c - uMin)), 0).xyz;
  float h = hh.x, hx = hh.y, hz = hh.z;
  vec3 sn = normalize(vec3(h - hx, 1.0, h - hz));
  float y01 = position.y + 0.5;
  float wy = mix(uFloor, h, y01);
  vec3 world = vec3(c.x + position.x * uGap, wy, c.y + position.z * uGap);
  vTop = step(0.5, normal.y);
  // sides lean a little toward the smooth surface normal, so light wraps the swell
  vN = vTop > 0.5 ? sn : normalize(normal * 0.35 + sn);
  vHn = clamp(h / uAmpTotal * 0.5 + 0.5, 0.0, 1.0);
  vDown = h - wy;
  vWorld = world;
  // depth: the field dissolves into the haze in its own direction (per vertex: columns are small)
  vec3 toP = world - cameraPosition;
  float d = length(toP);
  float f = smoothstep(uFogNear, uFogFar, d);
  f = 1.0 - pow(1.0 - f, 1.3);
  // mist pools in the troughs further off
  float mist = (1.0 - vHn) * 0.4 * smoothstep(uFogNear * 0.3, uFogFar, d);
  vFogF = clamp(f + mist * (1.0 - f), 0.0, 1.0);
  vFog = skyColor(normalize(vec3(toP.x, 0.0, toP.z)));
  vAmbSky = skyColor(vec3(0.0, 1.0, 0.0));
#ifdef USE_INSTANCING_COLOR
  vJit = instanceColor;
#else
  vJit = vec3(1.0);
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const frag = /* glsl */ `
${SKY}
uniform vec3 uDeep, uLow, uHigh, uKey, uKeyDir;
uniform float uSheen, uAmbK;
varying vec3 vFog;
varying float vFogF;
varying vec3 vAmbSky;
varying vec3 vWorld;
varying vec3 vN;
varying float vHn;
varying float vTop;
varying float vDown;
varying vec3 vJit;
varying vec2 vLocal;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float hn = vHn;
  vec3 base = mix(uDeep, uLow, smoothstep(0.0, 0.45, hn));
  base = mix(base, uHigh, smoothstep(0.4, 1.0, hn));
  base *= vJit;

  float ndl = dot(N, uKeyDir);
  float diff = clamp(ndl * 0.9 + 0.1, 0.0, 1.0) * mix(0.7, 1.0, vTop);
  vec3 amb = mix(uDeep * 1.4, vAmbSky, 0.5 + 0.5 * N.y) * uAmbK;
  // sides look out at the horizon and catch light bounced off the lit ground nearby
  amb += (1.0 - vTop) * (uHaze * 0.35 + uKey * 0.08);

  float ao = vTop > 0.5
    ? mix(0.72, 1.0, smoothstep(0.0, 0.85, hn))
    : mix(0.38, 0.9, exp(-vDown * 0.45)) * mix(0.78, 1.0, hn);
  // a soft bevel at each column's rim, so the voxels read without any gaps
  float rim = max(abs(vLocal.x), abs(vLocal.y));
  float fw = fwidth(rim) + 1e-4;
  ao *= 1.0 - vTop * 0.14 * smoothstep(0.5 - max(0.06, fw * 1.5), 0.5, rim);

  vec3 col = base * (amb + uKey * diff * 1.15) * ao;

  // crests catch the light: a soft sheen on lit tops, grazing toward the viewer
  vec3 H = normalize(uKeyDir + V);
  float sp = pow(max(dot(N, H), 0.0), 48.0) * vTop * smoothstep(0.35, 1.0, hn);
  col += uKey * sp * uSheen;

  col = mix(col, vFog, vFogF);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy) / 255.0 * 1.5;
}
`;

const skyVert = /* glsl */ `
varying vec2 vNdc;
void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;
const skyFrag = /* glsl */ `
${SKY}
uniform mat4 uInvVP;
varying vec2 vNdc;
void main(){
  vec4 w = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - cameraPosition);
  gl_FragColor = vec4(skyColor(dir), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy) / 255.0 * 1.5;
}
`;

// ---------------------------------------------------------------- scene

type Opts = {
  canvas: HTMLCanvasElement;
  seed: number;
  palette: Palette;
  text: HTMLElement;
  reduce: boolean;
};

export function startDrift({ canvas, seed, palette, text, reduce }: Opts) {
  const rng = mulberry32(seed * 7919 + 17);
  const R = (a: number, b: number) => a + (b - a) * rng();
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    canvas.classList.add('off');
    return;
  }

  // --- the edition
  const mode: Mode = pick(palette.modes);
  const modeId = mode === 'swell' ? 0 : mode === 'dunes' ? 1 : 2;
  const fov = R(8, 11);
  const camH = mode === 'dunes' ? R(9, 12) : R(7, 10);
  const yaw = R(-0.12, 0.12);
  // columns touch: a gap would let the brighter haze behind show through as seams
  const gap = 1;
  const t0 = R(0, 4000);
  const fogFar = R(260, 330);
  const fogNear = fogFar * R(0.3, 0.42);
  // light: either low and ahead of us (backlit crests, a glow in the haze) or raking from a side
  const backlit = rng() < 0.5;
  const sunAz = backlit ? R(-0.5, 0.5) : (rng() < 0.5 ? -1 : 1) * R(0.9, 1.7);
  const sunEl = backlit ? R(0.06, 0.2) : R(0.14, 0.42);
  const sunDir = new THREE.Vector3(Math.sin(sunAz + yaw) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz + yaw) * Math.cos(sunEl));
  const sunGlow = (backlit ? R(0.55, 0.95) : R(0.12, 0.3)) * (palette.dark ? 1 : 0.5);
  // field direction (waves travel toward us-ish, dunes are crossed at an angle)
  const dirA = mode === 'dunes' ? R(0.5, 1.2) * (rng() < 0.5 ? -1 : 1) + Math.PI / 2 : R(-0.5, 0.5) + Math.PI / 2;
  const dir = new THREE.Vector2(Math.cos(dirA), Math.sin(dirA));

  let amp = 1;
  let lambda = 40;
  let mspeed = 0.01;
  const waves: THREE.Vector4[] = [];
  const wavePh: THREE.Vector4[] = [];
  if (mode === 'swell') {
    amp = R(1.9, 2.8);
    const L0 = R(26, 44);
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const a = dirA + R(-0.38, 0.38) * (i === 0 ? 0.3 : 1);
      const L = L0 * R(0.55, 1.15) * (i === 0 ? 1 : 0.9 - i * 0.06);
      const k = (Math.PI * 2) / L;
      const w = amp * (i === 0 ? 1 : R(0.25, 0.6)) * Math.pow(L / L0, 1.2);
      total += w;
      waves.push(new THREE.Vector4(Math.cos(a), Math.sin(a), k, w));
      wavePh.push(new THREE.Vector4(0.22 * Math.sqrt(k), R(0, Math.PI * 2), 0, 0));
    }
    for (const w of waves) w.w *= (amp * 1.6) / total;
  } else if (mode === 'dunes') {
    amp = R(4.5, 6.5);
    lambda = R(34, 56);
    mspeed = R(0.0012, 0.002);
  } else {
    amp = R(3.6, 5);
    mspeed = R(0.08, 0.16) * (rng() < 0.5 ? -1 : 1);
  }
  for (let i = waves.length; i < 6; i++) { waves.push(new THREE.Vector4()); wavePh.push(new THREE.Vector4()); }
  const ampTotal = mode === 'swell' ? amp * 1.5 : mode === 'dunes' ? amp * 0.62 : amp * 1.25;
  const sheen = backlit ? R(0.35, 0.6) : R(0.12, 0.25);

  const C = (h: string) => new THREE.Color(h);
  const skyUniforms = {
    uSky: { value: C(palette.sky) },
    uHaze: { value: C(palette.haze) },
    uSun: { value: C(palette.sun) },
    uSunDir: { value: sunDir },
    uSkySpan: { value: 0.1 },
    uSunGlow: { value: sunGlow },
  };

  const cursor = new THREE.Vector4(0, -60, 0, 60);
  const uniforms = {
    ...skyUniforms,
    uTime: { value: t0 },
    uWaves: { value: waves },
    uWavePh: { value: wavePh },
    uDir: { value: dir },
    uAmp: { value: amp },
    uLambda: { value: lambda },
    uSpeed: { value: mspeed },
    uCursor: { value: cursor },
    uGap: { value: gap },
    uFloor: { value: -ampTotal * 2.2 - 4 },
    uAmpTotal: { value: ampTotal },
    uDeep: { value: C(palette.deep) },
    uLow: { value: C(palette.low) },
    uHigh: { value: C(palette.high) },
    uKey: { value: C(palette.key) },
    uKeyDir: { value: sunDir },
    uFogNear: { value: fogNear },
    uFogFar: { value: fogFar },
    uSheen: { value: sheen },
    uAmbK: { value: palette.dark ? 0.8 : 0.42 },
  };

  const heightRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const uMin = new THREE.Vector2();
  const passMat = new THREE.ShaderMaterial({
    vertexShader: passVert,
    fragmentShader: passFrag,
    uniforms: {
      uTime: uniforms.uTime, uWaves: uniforms.uWaves, uWavePh: uniforms.uWavePh, uDir: uniforms.uDir,
      uAmp: uniforms.uAmp, uLambda: uniforms.uLambda, uSpeed: uniforms.uSpeed, uCursor: uniforms.uCursor,
      uMin: { value: uMin },
    },
    defines: { MODE: modeId },
    depthTest: false,
    depthWrite: false,
  });
  const passScene = new THREE.Scene();
  const passQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), passMat);
  passQuad.frustumCulled = false;
  passScene.add(passQuad);
  const passCam = new THREE.Camera();

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { ...uniforms, uHeights: { value: heightRT.texture }, uMin: { value: uMin } },
  });
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: { ...skyUniforms, uInvVP: { value: new THREE.Matrix4() } },
    depthTest: false,
    depthWrite: false,
  });

  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(fov, 1, 1, fogFar * 1.3);
  // sit over a column, not a gap, or we'd see straight down a seam to the horizon
  camera.position.set(0.5, camH, 0);
  camera.rotation.set(0, yaw, 0, 'YXZ');

  const geo = new THREE.BoxGeometry(1, 1, 1);
  let mesh: THREE.InstancedMesh | null = null;
  let builtKey = '';

  // only the columns inside the view get an instance, nearest first
  function build(w: number, h: number, horizonY: number) {
    const aspect = w / h;
    const key = `${aspect.toFixed(2)}:${Math.round(horizonY / h * 50)}`;
    if (key === builtKey) return;
    builtKey = key;
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const fpx = h / 2 / tanV;
    const tanH = aspect * tanV;
    const below = (h - horizonY) / fpx; // tan of the angle to the bottom edge
    const top = ampTotal * 1.1;
    const dMin = Math.max(2, (camH - top) / below);
    const cells: [number, number, number][] = [];
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const reach = fogFar * 1.02;
    const half = reach * tanH + 4;
    for (let gz = -Math.ceil(reach) - 2; gz <= 2; gz++) {
      for (let gx = -Math.ceil(half + Math.abs(sy) * reach) - 2; gx <= Math.ceil(half + Math.abs(sy) * reach) + 2; gx++) {
        const x = gx + 0.5, z = gz + 0.5;
        // into camera space (camera looks down -z, yawed)
        const fx = (x - 0.5) * cy - z * sy;
        const fz = -((x - 0.5) * sy + z * cy);
        if (fz < dMin || fz > reach) continue;
        if (Math.abs(fx) > fz * tanH + 1.5) continue;
        cells.push([x, z, fz]);
      }
    }
    cells.sort((a, b) => a[2] - b[2]);
    const n = Math.min(cells.length, 20000);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const [x, z] = cells[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    uMin.set(x0 - 0.5, z0 - 0.5);
    heightRT.setSize(Math.round(x1 - x0) + 1, Math.round(z1 - z0) + 1);
    if (mesh) { scene.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const jr = mulberry32(seed + 3);
    for (let i = 0; i < n; i++) {
      m.makeTranslation(cells[i][0], 0, cells[i][1]);
      mesh.setMatrixAt(i, m);
      const j = 0.955 + jr() * 0.07;
      col.setRGB(j, j * (0.995 + jr() * 0.01), j);
      mesh.setColorAt(i, col);
    }
    scene.add(mesh);
  }

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, Hh = 0;
  function layout() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    Hh = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(dpr());
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh;
    const stacked = getComputedStyle(canvas).position !== 'fixed';
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const fpx = Hh / 2 / tanV;
    let horizon: number;
    if (stacked) {
      horizon = Hh * 0.2;
    } else {
      // the field's far edge (where it leaves the haze) sits just under the text
      // where the far crests (still clear of the haze) land on screen
      const tb = text.getBoundingClientRect().bottom - r.top;
      const crest = ampTotal * (mode === 'dunes' ? 0.55 : 0.75);
      const fade = (fpx * (camH - crest)) / (fogFar * 0.7);
      horizon = THREE.MathUtils.clamp(tb + 16 - fade, Hh * 0.34, Hh * 0.52);
    }
    camera.setViewOffset(W, Hh, 0, Hh / 2 - horizon, W, Hh);
    camera.updateProjectionMatrix();
    skyUniforms.uSkySpan.value = (horizon / fpx) * 1.05;
    build(W, Hh, horizon);
  }

  // --- cursor: a faint swell where it rests
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const target = new THREE.Vector2(0, -60);
  let lastMove = -1e9, inside = false, strength = 0;
  if (!reduce && matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
      inside = !!ray.ray.intersectPlane(plane, hit) && hit.distanceTo(camera.position) < fogFar * 0.7;
      if (inside) {
        if (strength < 0.02) { cursor.x = hit.x; cursor.y = hit.z; }
        target.set(hit.x, hit.z);
      }
      lastMove = performance.now();
    }, { passive: true });
    document.addEventListener('pointerleave', () => (inside = false));
  }

  const invVP = skyMat.uniforms.uInvVP.value as THREE.Matrix4;
  function draw() {
    camera.updateMatrixWorld();
    invVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    renderer.setRenderTarget(heightRT);
    renderer.render(passScene, passCam);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  layout();
  let shown = false;
  const show = () => { if (!shown) { shown = true; canvas.classList.add('on'); } };

  let running = !reduce;
  let ro: ResizeObserver | null = null;
  const onResize = () => { layout(); if (reduce || !running) draw(); };
  ro = new ResizeObserver(onResize);
  ro.observe(canvas);
  ro.observe(text);

  if (reduce) {
    draw();
    show();
    return;
  }

  let last = performance.now();
  let t = t0;
  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    uniforms.uTime.value = t;
    // cursor swell rises slowly while the pointer rests, and fades when it moves on
    const resting = inside && now - lastMove > 350;
    strength += ((resting ? 1 : inside ? 0.35 : 0) - strength) * Math.min(1, dt * (resting ? 0.6 : 1.2));
    cursor.x += (target.x - cursor.x) * Math.min(1, dt * 1.2);
    cursor.y += (target.y - cursor.y) * Math.min(1, dt * 1.2);
    cursor.z = strength * ampTotal * 0.45;
    cursor.w = 70 + strength * 40;
    draw();
    show();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame((n) => { last = n; frame(n); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  });
}
