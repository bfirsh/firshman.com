// The meadow: instanced voxel plants whose sway, push and light all run on the GPU.
import * as THREE from 'three';
import type { World, RGB } from './world';

// One voxel = 3 faces (top, front, one side); the side is mirrored per plant so it faces the camera.
type Vox = { x: number; y: number; z: number; s: number; level: number; part: number };

const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
];

export function voxGeometry(vox: Vox[]) {
  const nv = vox.length * 12;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cen = new Float32Array(nv * 3);
  const lev = new Float32Array(nv * 2);
  const idx: number[] = [];
  let k = 0;
  for (const v of vox) {
    for (const f of FACES) {
      const b = k;
      for (const c of f.v) {
        pos.set([c[0] * v.s, c[1] * v.s, c[2] * v.s], k * 3);
        nor.set(f.n, k * 3);
        cen.set([v.x, v.y, v.z], k * 3);
        lev.set([v.level, v.part], k * 2);
        k++;
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aVox', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aLP', new THREE.BufferAttribute(lev, 2));
  g.setIndex(idx);
  return g;
}

function tuft(): Vox[] {
  const out: Vox[] = [];
  const blades = [
    { n: 9, lx: 0.0, lz: 0.0 },
    { n: 7, lx: 1.6, lz: 0.5 },
    { n: 6, lx: -1.3, lz: -0.6 },
  ];
  for (const b of blades) {
    for (let i = 0; i < b.n; i++) {
      const t = i / (b.n - 1);
      out.push({ x: b.lx * t * t, y: i + 0.5, z: b.lz * t * t, s: i >= b.n - 2 ? 0.62 : 0.85, level: (i + 1) / 9, part: 0 });
    }
  }
  return out;
}

function seedStalk(): Vox[] {
  const out: Vox[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) out.push({ x: 0, y: i + 0.5, z: 0, s: 0.55, level: (i + 1) / 16, part: 0 });
  // an elongated spike with spikelets
  for (let i = 0; i < 4; i++) out.push({ x: 0, y: n + i + 0.5, z: 0, s: 0.95, level: (n + i + 1) / 16, part: 1 });
  out.push({ x: 0.75, y: n + 1, z: 0.3, s: 0.6, level: (n + 1.5) / 16, part: 1 });
  out.push({ x: -0.75, y: n + 2.4, z: -0.2, s: 0.6, level: (n + 2.9) / 16, part: 1 });
  out.push({ x: 0, y: n + 4.4, z: 0, s: 0.55, level: 1, part: 1 });
  // a leaf
  out.push({ x: 1, y: 3, z: 0, s: 0.8, level: 0.2, part: 0 }, { x: 1.8, y: 3.8, z: 0, s: 0.7, level: 0.25, part: 0 });
  return out;
}

function flower(cup: boolean): Vox[] {
  const out: Vox[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) out.push({ x: 0, y: i + 0.5, z: 0, s: 0.6, level: (i + 1) / 11, part: 0 });
  out.push({ x: -1, y: 2.5, z: 0.2, s: 0.8, level: 0.25, part: 0 }, { x: 1, y: 4, z: -0.2, s: 0.75, level: 0.38, part: 0 });
  const top = n + 0.5;
  out.push({ x: 0, y: top + (cup ? 0.1 : 0.2), z: 0, s: 1.05, level: 1, part: 3 });
  const lift = cup ? 0.9 : 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ x: dx * 1.05, y: top + lift, z: dz * 1.05, s: 1, level: 1, part: 2 });
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) out.push({ x: dx * 0.8, y: top + lift * 0.7 - 0.12, z: dz * 0.8, s: 0.78, level: 1, part: 2 });
  if (cup) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ x: dx * 1.1, y: top + 1.75, z: dz * 1.1, s: 0.78, level: 1, part: 2 });
  return out;
}

export const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
`;

// Shared lighting uniforms (lantern, swarm, moon, firefly light map, fog) used by meadow, ground and trees.
export const LIGHT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec4 uLantern;   // xyz, intensity
uniform vec3 uLanternCol;
uniform vec3 uMoonDir, uMoonCol, uSkyAmb, uFogCol;
uniform float uFog, uMist;
uniform sampler2D uLightMap; uniform vec4 uLMRect; // x0, z0, 1/w, 1/d
uniform float uGlow;  // meadow glow (finale)
vec3 lanternLight(vec3 p, vec3 n, float wrap){
  vec3 L = uLantern.xyz - p; float d = length(L); L /= max(d, 1e-4);
  float a = uLantern.w / (1.0 + d*d*9.0) * (1.0 - smoothstep(0.9, 2.8, d));
  float diff = mix(max(dot(n, L), 0.0), dot(n, L)*0.5+0.5, wrap);
  return uLanternCol * a * diff;
}
vec3 lightMap(vec3 p){
  vec2 uv = (p.xz - uLMRect.xy) * uLMRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0);
  return texture2D(uLightMap, uv).rgb;
}
vec3 applyFog(vec3 c, vec3 p){
  float d = length(p - cameraPosition);
  float f = 1.0 - exp(-d * uFog);
  float m = uMist * exp(-max(p.y, 0.0) * 1.6) * (1.0 - exp(-d * 0.05));
  return mix(c, uFogCol, clamp(f + m, 0.0, 1.0));
}
`;

const VERT = /* glsl */ `
attribute vec3 aVox; attribute vec2 aLP;
attribute vec4 iA; // x, z, voxel size, phase
attribute vec4 iB; // stem rgb, spacing
attribute vec4 iC; // head rgb, bend amount
attribute vec4 iD; // centre rgb, openness
uniform vec4 uWind; // dir.xy, strength, gustiness
uniform float uWindSpeed;
uniform sampler2D uPush; uniform vec4 uPushRect;
uniform vec3 uTip; uniform vec3 uSwarm; uniform float uSwarmI;
varying vec3 vCol;
${NOISE}
${LIGHT_HEAD}
void main(){
  float s = iA.z, ph = iA.w;
  vec2 base = iA.xy;
  float level = aLP.x, part = aLP.y;
  // rotate the plant's static shape around y
  float ca = cos(ph*6.283), sa = sin(ph*6.283);
  vec3 v = aVox;
  float lantD = length(uLantern.xyz - vec3(base.x, 0.5, base.y));
  float near = uLantern.w * (1.0 - smoothstep(0.3, 2.2, lantD));
  if (part > 1.5 && part < 2.5) v.xz *= iD.w * (0.72 + 0.4 * min(near, 1.0));
  v.xz = vec2(ca*v.x - sa*v.z, sa*v.x + ca*v.z);
  vec3 local = vec3(v.x*s, v.y*s*iB.w, v.z*s);

  // wind: travelling gusts + per-plant flutter
  vec2 wd = uWind.xy; vec2 wp = vec2(-wd.y, wd.x);
  float t = uTime;
  float g = vnoise(base*0.11 - wd*t*uWindSpeed*0.11) * 0.7 + vnoise(base*0.31 - wd*t*uWindSpeed*0.27) * 0.3;
  g = smoothstep(0.28, 0.85, g) * uWind.w;
  float flutter = sin(t*(2.2+ph) + ph*40.0 + dot(base, wd)*0.8);
  vec2 bend = wd * uWind.z * (0.25 + g*1.15) + wp * flutter * uWind.z * 0.18 + wd * flutter * 0.08 * uWind.z;
  // lantern push (spring field simulated on the GPU)
  vec2 puv = (base - uPushRect.xy) * uPushRect.zw;
  if (puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) { vec2 pb = texture2D(uPush, puv).xy; if (!(abs(pb.x) < 10.0 && abs(pb.y) < 10.0)) pb = vec2(0.0); bend += pb; }
  // excited shiver near the light
  bend += vec2(sin(t*17.0 + ph*90.0), cos(t*15.0 + ph*70.0)) * 0.05 * near;
  float bl = length(bend); if (bl > 1.4) bend *= 1.4 / bl;
  float H = iC.w;
  vec2 off = bend * level * level * H;
  float drop = dot(off, off) / max(H, 0.05) * 0.45 * level;
  vec3 c = vec3(base.x, 0.0, base.y) + local + vec3(off.x, -drop, off.y);
  vec3 corner = position * s;
  vec3 n = normal;
  if (base.x < 0.0) { corner.x = -corner.x; n.x = -n.x; }
  vec3 p = c + corner;

  // albedo
  vec3 alb;
  if (part < 0.5) alb = mix(iB.rgb * 0.45, mix(iB.rgb, uTip, 0.35) * 1.15, smoothstep(0.0, 1.0, level));
  else if (part < 1.5) alb = iC.rgb;
  else if (part < 2.5) alb = iC.rgb;
  else alb = iD.rgb;
  alb *= 0.82 + 0.36 * h21(aVox.xy * 7.13 + vec2(ph * 91.0, aVox.z));
  alb = max(mix(vec3(dot(alb, vec3(0.3, 0.55, 0.15))), alb, 1.3), 0.0);
  float ao = part < 0.5 ? mix(0.12, 1.0, smoothstep(0.0, 0.95, level)) : 1.0;
  ao *= n.y > 0.5 ? 1.0 : (n.z > 0.5 ? 0.82 : 0.62);
  // light
  vec3 amb = mix(vec3(dot(uSkyAmb, vec3(0.333))), uSkyAmb, 0.45);
  vec3 mc = mix(vec3(dot(uMoonCol, vec3(0.333))), uMoonCol, 0.5);
  vec3 lit = amb * (0.6 + 0.4*n.y);
  lit += mc * max(dot(n, uMoonDir), 0.0) * (1.0 + g * 0.6);
  // moonlight through the blades: backlit grass glows toward the moon, and gusts make it shimmer
  vec3 vdir = normalize(p - cameraPosition);
  float back = pow(max(dot(vdir, uMoonDir), 0.0), 12.0);
  lit += mc * back * (1.6 + g * 2.2) * level * level * (part > 0.5 ? 1.4 : 1.0);
  lit *= ao;
  float wrap = part < 0.5 ? 0.75 : 0.45;
  lit += lanternLight(p, n, wrap) * mix(0.5, 1.0, ao);
  vec3 sw = uSwarm - p; float sd = length(sw);
  lit += vec3(0.85, 0.8, 0.55) * uSwarmI / (1.0 + sd*sd*1.5) * (dot(n, sw/max(sd,1e-3))*0.4+0.6) * (1.0 - smoothstep(2.0, 4.5, sd));
  lit += lightMap(p) * (0.4 + 0.6*level);
  vec3 col = alb * lit;
  // finale: the meadow glows from the tips
  col += uGlow * mix(vec3(0.15, 0.55, 0.35), alb*1.6, part > 0.5 ? 0.7 : 0.2) * pow(level, 3.0) * (0.35 + 0.65*pow(0.5 + 0.5*sin(t*1.95 - length(base)*0.28), 4.0));
  vCol = applyFog(col, p);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol;
void main(){ gl_FragColor = vec4(vCol, 1.0); }`;

export function makeLightUniforms() {
  return {
    uTime: { value: 0 },
    uLantern: { value: new THREE.Vector4(0, 0.8, -3, 1) },
    uLanternCol: { value: new THREE.Color(1.0, 0.6, 0.26) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonCol: { value: new THREE.Color() },
    uSkyAmb: { value: new THREE.Color() },
    uFogCol: { value: new THREE.Color() },
    uFog: { value: 0.02 },
    uMist: { value: 0.2 },
    uLightMap: { value: null as THREE.Texture | null },
    uLMRect: { value: new THREE.Vector4() },
    uGlow: { value: 0 },
  };
}
export type LightUniforms = ReturnType<typeof makeLightUniforms>;

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];
const jit = (c: RGB, r: () => number, k: number): RGB => {
  const m = 1 + (r() - 0.5) * k;
  return [c[0] * m * (1 + (r() - 0.5) * k * 0.5), c[1] * m, c[2] * m * (1 + (r() - 0.5) * k * 0.5)];
};

export function buildMeadow(world: World, L: LightUniforms, opts: { tufts: number; seeds: number; flowers: number; azRange: number; rMax: number }) {
  const r = world.rand;
  const S = world.season;
  const uniforms = {
    ...L,
    uWind: { value: new THREE.Vector4(Math.cos(world.wind.angle), Math.sin(world.wind.angle), world.wind.strength, world.wind.gust) },
    uWindSpeed: { value: world.wind.speed },
    uPush: { value: null as THREE.Texture | null },
    uPushRect: { value: new THREE.Vector4() },
    uTip: { value: new THREE.Color(...S.tip) },
    uSwarm: { value: new THREE.Vector3() },
    uSwarmI: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
  const group = new THREE.Group();

  const place = (count: number, rMin: number, pw: number) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const u = r();
      const rr = rMin + (opts.rMax - rMin) * Math.pow(u, pw);
      const a = (r() * 2 - 1) * opts.azRange;
      const lod = 1 + Math.max(0, rr - 9) * 0.075;
      out.push([Math.sin(a) * rr, -Math.cos(a) * rr, lod]);
    }
    return out;
  };

  const mk = (vox: Vox[], pts: [number, number, number][], stackH: number, fill: (i: number, A: Float32Array, B: Float32Array, C: Float32Array, D: Float32Array, lod: number) => void) => {
    const g = voxGeometry(vox);
    const n = pts.length;
    const A = new Float32Array(n * 4), B = new Float32Array(n * 4), C = new Float32Array(n * 4), D = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const [x, z, lod] = pts[i];
      const s = (0.052 + r() * 0.014) * lod;
      A.set([x, z, s, r()], i * 4);
      fill(i, A, B, C, D, lod);
      B[i * 4 + 3] /= Math.pow(lod, 0.85);
      C[i * 4 + 3] = stackH * s * B[i * 4 + 3] * C[i * 4 + 3];
    }
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 4));
    g.setAttribute('iD', new THREE.InstancedBufferAttribute(D, 4));
    g.instanceCount = n;
    g.userData.full = n;
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };

  mk(tuft(), place(opts.tufts, 2.8, 1.3), 9, (i, A, B, C, D) => {
    B.set([...jit(pick(r, S.grass), r, 0.6), 0.8 + r() * 0.5], i * 4);
    C.set([0, 0, 0, 0.75 + r() * 0.5], i * 4);
  });
  mk(seedStalk(), place(opts.seeds, 3.3, 1.25), 16, (i, A, B, C, D) => {
    B.set([...jit(pick(r, S.grass), r, 0.35), 0.85 + r() * 0.45], i * 4);
    C.set([...jit(pick(r, S.seed), r, 0.3), 0.9 + r() * 0.4], i * 4);
  });
  const fl = S.flowers;
  const wsum = fl.reduce((a, f) => a + f.w, 0);
  const pickF = () => { let x = r() * wsum; for (const f of fl) { x -= f.w; if (x <= 0) return f; } return fl[0]; };
  for (const cup of [false, true]) {
    const kinds = fl.filter((f) => f.cup === cup);
    if (!kinds.length) continue;
    const share = kinds.reduce((a, f) => a + f.w, 0) / wsum;
    const pts = place(Math.round(opts.flowers * share), 3.0, 1.3);
    mk(flower(cup), pts, 11, (i, A, B, C, D) => {
      let f = pickF(); let guard = 0;
      while (f.cup !== cup && guard++ < 20) f = pickF();
      B.set([...jit(pick(r, S.grass), r, 0.3), 0.75 + r() * 0.5], i * 4);
      C.set([...jit(f.petal, r, 0.18), 0.6 + r() * 0.3], i * 4);
      D.set([...f.center, f.open * (0.85 + r() * 0.25)], i * 4);
    });
  }
  return { group, uniforms, mat };
}

// Spring field for the lantern's push: xy = displacement, zw = velocity. Ping-pong render targets.
export class PushField {
  a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget;
  mat: THREE.ShaderMaterial; scene: THREE.Scene; cam: THREE.OrthographicCamera;
  rect: THREE.Vector4;
  constructor(x0: number, z0: number, w: number, d: number, res: [number, number]) {
    const o = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(res[0], res[1], o);
    this.b = new THREE.WebGLRenderTarget(res[0], res[1], o);
    this.rect = new THREE.Vector4(x0, z0, 1 / w, 1 / d);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPrev: { value: null }, uL: { value: new THREE.Vector4() }, uV: { value: new THREE.Vector2() }, uDt: { value: 0.016 }, uRect: { value: new THREE.Vector4(x0, z0, w, d) }, uTexel: { value: new THREE.Vector2(1 / res[0], 1 / res[1]) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPrev; uniform vec4 uL; uniform vec2 uV; uniform float uDt; uniform vec4 uRect; uniform vec2 uTexel;
        varying vec2 vUv;
        void main(){
          vec4 s = texture2D(uPrev, vUv);
          // a touch of neighbour coupling so the wake ripples outward
          vec4 nb = (texture2D(uPrev, vUv + vec2(uTexel.x,0.)) + texture2D(uPrev, vUv - vec2(uTexel.x,0.)) + texture2D(uPrev, vUv + vec2(0.,uTexel.y)) + texture2D(uPrev, vUv - vec2(0.,uTexel.y))) * 0.25;
          vec2 p = uRect.xy + vUv * uRect.zw;
          vec2 d = p - uL.xy; float r = length(d);
          float f = exp(-r*r / (uL.w*uL.w)) * uL.z;
          vec2 target = d / max(r, 0.05) * f * 1.25 + uV * f * 0.12;
          vec2 acc = (target - s.xy) * 46.0 - s.zw * 5.2 + (nb.xy - s.xy) * 30.0;
          vec2 v = s.zw + acc * uDt;
          vec2 x = s.xy + v * uDt;
          gl_FragColor = vec4(x, v);
        }`,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  step(renderer: THREE.WebGLRenderer, lx: number, lz: number, amp: number, radius: number, vx: number, vz: number, dt: number) {
    const u = this.mat.uniforms;
    u.uL.value.set(lx, lz, amp, radius);
    u.uV.value.set(vx, vz);
    // sub-step for stability
    const n = dt > 0.02 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      u.uDt.value = dt / n;
      u.uPrev.value = this.a.texture;
      renderer.setRenderTarget(this.b);
      renderer.render(this.scene, this.cam);
      [this.a, this.b] = [this.b, this.a];
    }
    renderer.setRenderTarget(null);
    return this.a.texture;
  }
}
