// Strata: a Gray-Scott reaction-diffusion simulation whose history becomes a sculpture.
//
// The 2D simulation runs on the GPU (ping-pong float textures) inside a soft,
// slowly twisting footprint. Every S steps the state of the inhibitor V is
// captured into one horizontal layer of a 3D texture (a ring buffer), so the
// pattern's past stacks upward like sediment, agate banding or coral growth.
// A fragment shader raymarches the stacked volume as a solid with soft,
// subsurface-looking light, and a slow clipping plane slices it open like a
// cut geode to show the banding inside.

import { mulberry32 } from './edition';

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SIM = `#version 300 es
precision highp float;
uniform sampler2D uS;
uniform float uN;
uniform float uF, uK;
uniform float uR;
uniform vec4 uShape;   // lobes, lobe amplitude, lobe angle, wobble
uniform vec2 uCenter;
out vec4 o;
vec2 at(ivec2 p){ return texelFetch(uS, clamp(p, ivec2(0), ivec2(int(uN) - 1)), 0).xy; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = at(p);
  vec2 lap = -c
    + 0.2*(at(p + ivec2(1,0)) + at(p - ivec2(1,0)) + at(p + ivec2(0,1)) + at(p - ivec2(0,1)))
    + 0.05*(at(p + ivec2(1,1)) + at(p + ivec2(-1,1)) + at(p + ivec2(1,-1)) + at(p + ivec2(-1,-1)));
  vec2 q = (vec2(p) + 0.5)/uN - 0.5 - uCenter;
  float r = length(q);
  float a = atan(q.y, q.x);
  float rm = uR * (1.0 + uShape.y*sin(uShape.x*a + uShape.z) + uShape.w*sin(2.0*a - uShape.z*0.7 + 1.0));
  float mask = clamp((rm - r)/0.035, 0.0, 1.0);
  float k = uK + 0.05*(1.0 - mask);
  float uvv = c.x*c.y*c.y;
  vec2 d = vec2(1.0*lap.x - uvv + uF*(1.0 - c.x), 0.5*lap.y + uvv - (uF + k)*c.y);
  o = vec4(clamp(c + d, 0.0, 1.0), mask, 1.0);
}`;

// stamps new seeds into the state (and can clear a region), for new layers
const STAMP = `#version 300 es
precision highp float;
uniform sampler2D uS;
uniform float uN;
uniform vec4 uDots[12];  // x, y, radius, on
uniform float uKeep;     // keep the pattern inside this radius (from the centre); 1.0 keeps all
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 c = texelFetch(uS, p, 0).xy;
  vec2 q = (vec2(p) + 0.5)/uN;
  float r = length(q - 0.5);
  if (r > uKeep) c = mix(c, vec2(1.0, 0.0), smoothstep(uKeep, uKeep + 0.04, r));
  for (int i = 0; i < 12; i++) {
    vec4 d = uDots[i];
    if (d.w > 0.0 && length(q - d.xy) < d.z) c = vec2(0.25, 0.5);
  }
  o = vec4(c, texelFetch(uS, p, 0).z, 1.0);
}`;

// writes one layer of the 3D history
const SLICE = `#version 300 es
precision highp float;
uniform sampler2D uS;
uniform float uTint;
out vec4 o;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uS, p, 0);
  o = vec4(s.y*2.0, uTint, s.z, s.x);
}`;

const RENDER = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVol;
uniform vec2 uRes;
uniform vec3 uCam, uFwd, uRight, uUp;
uniform vec2 uTan;
uniform vec2 uShift;
uniform float uHy, uTop, uBase, uD, uN;
uniform float uIso;
uniform float uInvert;
uniform vec4 uClip;      // plane normal (xyz) and offset (w); the side beyond is cut away
uniform vec3 uL;         // key light direction (towards the light)
uniform vec3 uBg;        // page background (sRGB)
uniform vec3 uBgHi;      // the lit wall behind the sculpture (sRGB)
uniform vec3 uCrust, uSss, uB0, uB1, uB2, uB3;
uniform vec4 uMat;       // gloss, translucency, band frequency, band contrast
uniform vec3 uEmit;
uniform float uExposure;
uniform float uAmb;
uniform float uTime;
uniform float uFade;
out vec4 o;

uint hu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hash(vec3 p){ uvec3 q = uvec3(ivec3(floor(p)) + 65536); return float(hu(q.x ^ hu(q.y ^ hu(q.z)))) * (1.0/4294967296.0); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = p - i; f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}

vec3 tc(vec3 p){
  float a = max(uBase + p.y/uHy*uD, floor(uBase) + 0.5);
  return vec3(p.x*0.5 + 0.5, p.z*0.5 + 0.5, (a + 0.5)/uD);
}
vec4 vol(vec3 p){ return texture(uVol, tc(p)); }
float sdv(vec4 s){
  // solid where the pattern is, or (inverted) where the substrate is
  float d = uInvert > 0.5 ? min(uIso - s.r, (s.b - 0.5)*1.2) : s.r - uIso;
  return d;
}
float dens(vec3 p){
  return min(sdv(texture(uVol, tc(p))), (uTop - p.y)*6.0);
}
float densL(vec3 p, float l){
  return min(sdv(textureLod(uVol, tc(p), l)), (uTop - p.y)*6.0);
}
vec3 normalAt(vec3 p){
  float e = 1.6/uN;
  vec2 k = vec2(e, 0.0);
  vec3 g = vec3(dens(p + k.xyy) - dens(p - k.xyy), dens(p + k.yxy) - dens(p - k.yxy), dens(p + k.yyx) - dens(p - k.yyx));
  return -normalize(g + 1e-6);
}
vec2 boxHit(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax){
  vec3 inv = 1.0/rd;
  vec3 t0 = (bmin - ro)*inv, t1 = (bmax - ro)*inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03))/(x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c){ return pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2)); }

vec3 bandCol(vec4 s, vec3 p){
  float tint = s.g;
  float x = uInvert > 0.5 ? clamp((uIso - s.r)/uIso*0.35 + (s.a - 0.35)/0.65*0.65, 0.0, 1.0) : clamp((s.r - uIso)/(0.95 - uIso), 0.0, 1.0);
  float w = vnoise(p*vec3(9.0, 3.0, 9.0))*0.5 + vnoise(p*26.0)*0.25;
  float xb = x + (w - 0.37)*0.12;
  vec3 g = xb < 0.33 ? mix(uB0, uB1, smoothstep(0.0, 0.33, xb)) : (xb < 0.66 ? mix(uB1, uB2, smoothstep(0.33, 0.66, xb)) : mix(uB2, uB3, smoothstep(0.66, 1.0, xb)));
  float sb = 0.5 + 0.5*sin(xb*uMat.z*6.2831 + tint*3.0);
  sb = smoothstep(0.2, 0.8, sb);
  g *= 1.0 - uMat.w*sb;
  // a thin rind at the boundary, like the crust of a geode
  g = mix(uCrust*0.8, g, smoothstep(0.0, 0.07, x));
  // faint strata from the history itself
  g *= 0.94 + 0.06*sin((uBase + p.y/uHy*uD)*0.9 + tint*6.0);
  return g;
}

void main(){
  vec2 uv = gl_FragCoord.xy/uRes*2.0 - 1.0;
  vec3 rd = normalize(uFwd + uRight*(uv.x - uShift.x)*uTan.x + uUp*(uv.y - uShift.y)*uTan.y);
  vec3 ro = uCam;

  // background: a seamless sweep, slightly lit behind the sculpture
  vec2 sp = vec2((uv.x - uShift.x)*uRes.x/uRes.y, uv.y - uShift.y - 0.1);
  float glow = exp(-dot(sp, sp)*0.55);
  vec3 bg = mix(uBg, uBgHi, glow);
  vec3 col = toLin(bg);
  bool hitAny = false;
  vec3 shade = vec3(0.0);

  // the floor: invisible except for the soft shadow and contact darkening
  if (rd.y < 0.0) {
    float tf = -ro.y/rd.y;
    vec3 fp = ro + rd*tf;
    if (length(fp.xz) < 3.0) {
      float sh = 0.0;
      for (int i = 1; i <= 14; i++) {
        vec3 q = fp + uL*(float(i)*0.085);
        if (q.y > uTop || abs(q.x) > 1.0 || abs(q.z) > 1.0) continue;
        sh += max(densL(q, 1.5) + uIso*0.6, 0.0);
      }
      float occ = 0.0;
      if (abs(fp.x) < 1.0 && abs(fp.z) < 1.0) occ = max(textureLod(uVol, tc(vec3(fp.x, 0.03, fp.z)), 2.5).r - 0.05, 0.0);
      float shadow = exp(-sh*0.9) * (1.0 - 0.55*smoothstep(0.0, 0.5, occ));
      col *= mix(1.0, shadow, 0.55*uFade);
    }
  }

  vec2 bt = boxHit(ro, rd, vec3(-1.0, 0.0, -1.0), vec3(1.0, uTop, 1.0));
  if (bt.y > max(bt.x, 0.0) && uTop > 0.002) {
    float ta = max(bt.x, 0.0), tb = bt.y;
    // the clipping plane
    vec3 cn = uClip.xyz;
    float dn = dot(rd, cn);
    float s0 = dot(ro, cn) - uClip.w;
    float tp = -s0/dn;
    bool cutEntry = false;
    if (abs(dn) > 1e-5) {
      if (dn < 0.0) { if (tp > ta) { ta = tp; cutEntry = true; } }
      else { tb = min(tb, tp); }
    } else if (s0 > 0.0) { tb = -1.0; }
    if (tb > ta) {
      vec3 p = ro + rd*ta;
      float vox = 2.0/uN;
      bool hit = false; bool cut = false;
      float t = ta;
      if (cutEntry && dens(p) > 0.0) { hit = true; cut = true; }
      else {
        float prevT = t;
        for (int i = 0; i < 320; i++) {
          if (t > tb) break;
          p = ro + rd*t;
          vec4 lv = textureLod(uVol, tc(p), 2.0);
          float lo = uInvert > 0.5 ? lv.b : lv.r;
          if (lo < 0.012 && p.y < uTop - 2.0*vox) { prevT = t; t += vox*2.0; continue; }
          float d = dens(p);
          if (d > 0.0) {
            float a = prevT, b = t;
            for (int j = 0; j < 6; j++) { float m = 0.5*(a + b); if (dens(ro + rd*m) > 0.0) b = m; else a = m; }
            t = b; p = ro + rd*t; hit = true;
            break;
          }
          prevT = t;
          t += vox*0.85;
        }
      }
      if (hit) {
        hitAny = true;
        vec4 vv = vol(p);
        vec3 n = cut ? cn : normalAt(p);
        vec3 L = uL;
        float ndl = dot(n, L);
        // soft volumetric shadow towards the key light
        float sh = 0.0;
        for (int i = 1; i <= 7; i++) sh += max(densL(p + n*vox*1.5 + L*(float(i)*0.05), 1.0), 0.0);
        float T = exp(-sh*1.6);
        // ambient occlusion from the density around the normal
        float ao = 0.0;
        for (int i = 1; i <= 4; i++) { float h = float(i)*0.035; ao += max(densL(p + n*h, 1.0), 0.0) * (1.0/float(i)); }
        ao = clamp(1.0 - ao*0.9, 0.0, 1.0);
        // thickness behind the surface, for light bleeding through thin forms
        float th = 0.0;
        for (int i = 1; i <= 5; i++) th += max(densL(p - n*(float(i)*0.03), 0.5), 0.0);
        vec3 alb;
        if (cut) {
          alb = bandCol(vv, p);
          // a little depth beneath the polished face
          vec3 deep = vec3(0.0);
          for (int i = 1; i <= 3; i++) { vec3 q = p + rd*(float(i)*0.025); deep += bandCol(texture(uVol, tc(q)), q); }
          alb = mix(alb, deep/3.0, 0.35*uMat.y);
        } else {
          alb = mix(uCrust, bandCol(vv, p), 0.18);
          alb *= 0.9 + 0.2*vnoise(p*40.0);
        }
        float lam = max(ndl, 0.0);
        float wrap = max((ndl + 0.6)/1.6, 0.0);
        vec3 key = vec3(1.0, 0.96, 0.9) * 2.8;
        vec3 sky = vec3(0.8, 0.86, 0.95) * uAmb;
        vec3 bounce = toLin(uBg) * 0.35 * max(-n.y, 0.0);
        vec3 c = alb * (key*lam*T + sky*ao*(0.5 + 0.5*n.y) + bounce*ao + 0.06*ao);
        c += uSss * key * max(wrap - lam*0.7, 0.0) * mix(1.0, T, 0.6) * uMat.y * 0.8 * sqrt(alb);
        c += uSss * key * exp(-th*2.2) * pow(max(dot(rd, L), 0.0), 2.0) * uMat.y * 0.6;
        vec3 h = normalize(L - rd);
        float spec = pow(max(dot(n, h), 0.0), cut ? 90.0 : 28.0) * (cut ? 1.0 : 0.5);
        c += key * spec * uMat.x * T * 0.35;
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
        c += sky * fres * uMat.x * 0.35 * ao;
        if (cut) c += uEmit * (uInvert > 0.5 ? smoothstep(0.08, uIso, vv.r)*0.6 : smoothstep(0.35, 0.9, (vv.r - uIso)/(0.95 - uIso))*1.4);
        else c += uEmit * 0.15 * fres;
        shade = c;
      }
    }
  }
  if (hitAny) col = mix(col, aces(shade*uExposure), uFade);
  vec3 outc = hitAny ? toSrgb(col) : toSrgb(col);
  uvec2 pq = uvec2(gl_FragCoord.xy) + uvec2(uint(uTime*30.0)*7919u, uint(uTime*30.0)*104729u);
  float g1 = float(hu(pq.x ^ hu(pq.y))) * (1.0/4294967296.0);
  float g2 = float(hu(pq.y*3u ^ hu(pq.x + 17u))) * (1.0/4294967296.0);
  outc += (g1 + g2 - 1.0) * (hitAny ? 0.022 : 0.006);
  o = vec4(outc, 1.0);
}`;

type V3 = [number, number, number];
const hex = (h: string): V3 => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const lin = (h: string): V3 => hex(h).map((c) => Math.pow(c, 2.2)) as V3;

export const PALETTES = [
  {
    name: 'malachite', dark: true, bg: '#0e1412', bgHi: '#17201c', ink: '#e1e8e2',
    crust: '#1d3d31', sss: '#3d9a6e', b: ['#0b2d22', '#1f6d50', '#3ea377', '#a9dcbf'], mat: [0.7, 0.35, 5.0, 0.55], emit: '#000000', exposure: 1.0, amb: 0.42,
  },
  {
    name: 'agate', dark: false, bg: '#ebe6de', bgHi: '#f6f2ec', ink: '#1f1c19',
    crust: '#8c7a69', sss: '#e3a272', b: ['#f2e9dc', '#c86a3e', '#8a3a24', '#e8dccb'], mat: [0.85, 0.8, 4.0, 0.35], emit: '#000000', exposure: 1.0, amb: 0.26,
  },
  {
    name: 'bone and rust', dark: false, bg: '#dcd6cc', bgHi: '#e9e4dc', ink: '#24201c',
    crust: '#ece4d4', sss: '#e9b78f', b: ['#e6dccb', '#b65d31', '#6c2c18', '#d9a46c'], mat: [0.15, 0.5, 2.5, 0.3], emit: '#000000', exposure: 1.0, amb: 0.24,
  },
  {
    name: 'deep sea', dark: true, bg: '#060b12', bgHi: '#0c1622', ink: '#d6e2e8',
    crust: '#1b3550', sss: '#2a7c99', b: ['#0b2238', '#134a66', '#21808a', '#7fc9c0'], mat: [0.6, 0.7, 3.5, 0.4], emit: '#0f5f5c', exposure: 1.1, amb: 0.4,
  },
  {
    name: 'lapis', dark: true, bg: '#11141d', bgHi: '#1b2030', ink: '#e2e4ec',
    crust: '#3b4466', sss: '#5d6ea8', b: ['#1e2a52', '#33457f', '#b8975a', '#6f7fae'], mat: [0.8, 0.35, 3.0, 0.35], emit: '#000000', exposure: 1.05, amb: 0.4,
  },
  {
    name: 'rhodochrosite', dark: false, bg: '#efe9e6', bgHi: '#f8f4f2', ink: '#251d1d',
    crust: '#c88a8e', sss: '#f0a0a8', b: ['#f7dcd8', '#e0909a', '#a84a5e', '#fbeee9'], mat: [0.75, 0.75, 6.0, 0.4], emit: '#000000', exposure: 0.95, amb: 0.26,
  },
];

export const SPECIES = [
  { name: 'mitosis', F: 0.0367, k: 0.0649, S: 64, drift: 0.03, iso: 0.42, invert: 0, seeds: ['cluster', 'offset'] },
  { name: 'coral', F: 0.0545, k: 0.062, S: 38, drift: 0.08, iso: 0.4, invert: 0.2, seeds: ['cluster', 'offset', 'line'] },
  { name: 'labyrinth', F: 0.037, k: 0.06, S: 30, drift: 0.06, iso: 0.4, invert: 0.25, seeds: ['cluster', 'ring', 'offset'] },
  { name: 'rings', F: 0.022, k: 0.051, S: 20, drift: 0.02, iso: 0.42, invert: 0.3, seeds: ['cluster', 'offset'] },
  { name: 'sediment', F: 0.026, k: 0.051, S: 20, drift: 0.02, iso: 0.5, invert: 0.5, seeds: ['cluster', 'offset'] },
  { name: 'waves', F: 0.014, k: 0.045, S: 12, drift: 0.0, iso: 0.3, invert: 1, seeds: ['cluster', 'scatter'] },
  { name: 'pulsing spots', F: 0.025, k: 0.06, S: 40, drift: 0.04, iso: 0.42, invert: 0, seeds: ['scatter', 'ring'] },
];

export function makeParams(seed: number) {
  const R = mulberry32(seed * 104729 + 7);
  const rg = (a: number, b: number) => a + (b - a) * R();
  const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
  const species = pick(SPECIES);
  const palette = pick(PALETTES);
  const seedShape = pick(species.seeds);
  const invert = R() < species.invert;
  const lobes = pick([0, 0, 2, 3, 3, 5]);
  return {
    species, palette, seedShape, invert,
    F: species.F * rg(0.985, 1.015),
    k: species.k * rg(0.995, 1.005),
    radius: rg(0.36, 0.43),
    lobes, lobeAmp: lobes ? rg(0.06, 0.16) : 0, twist: rg(-1, 1) * rg(0.5, 2.0), wobble: rg(0.0, 0.06),
    breath: rg(0.0, 0.12), breathFreq: pick([0.5, 1, 1.5]),
    camEl: rg(0.18, 0.42), camAz: rg(0, Math.PI * 2), camDist: rg(6.3, 6.9), orbitDir: R() < 0.5 ? -1 : 1,
    cutTilt: rg(-0.25, 0.35), cutAngle: rg(0.35, 0.9) * (R() < 0.5 ? -1 : 1), cutPhase: rg(0, 1),
    rnd: R,
  };
}
export type Params = ReturnType<typeof makeParams>;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}
function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export function startStrata(
  canvas: HTMLCanvasElement,
  seed: number,
  opts: { still: boolean; layout: () => { shiftX: number; shiftY: number; mobile: boolean }; onReady: () => void },
) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  gl.getExtension('OES_texture_float_linear');

  const P = makeParams(seed);
  const N = 160;
  const D = 120;
  const HY = 1.9;
  const S = P.species.S;
  const FIRST = D;                 // slices in the first growth
  const LAYER = Math.round(D / 3);  // slices in each later layer
  const GROW_SECONDS = 85;          // the first growth, start to finish
  const REST_SECONDS = 16;
  const stepsPerSecond = (S * FIRST) / GROW_SECONDS;

  const sim = program(gl, SIM);
  const stamp = program(gl, STAMP);
  const slice = program(gl, SLICE);
  const render = program(gl, RENDER);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // simulation state
  const st: WebGLTexture[] = [];
  const sf: WebGLFramebuffer[] = [];
  const init = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { init[i * 4] = 1; init[i * 4 + 3] = 1; }
  const R = P.rnd;
  const put = (x: number, y: number, r: number) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      if (i * i + j * j > r * r + 1) continue;
      const px = Math.round(x + i), py = Math.round(y + j);
      if (px < 0 || py < 0 || px >= N || py >= N) continue;
      const o = (py * N + px) * 4;
      init[o] = 0.25 + (R() - 0.5) * 0.05; init[o + 1] = 0.5;
    }
  };
  const c = N / 2;
  if (P.seedShape === 'cluster' || P.seedShape === 'offset') {
    const ox = P.seedShape === 'offset' ? (R() - 0.5) * N * 0.3 : 0, oy = P.seedShape === 'offset' ? (R() - 0.5) * N * 0.3 : 0;
    const n = 4 + Math.floor(R() * 5);
    for (let i = 0; i < n; i++) { const a = R() * 6.283, r = R() * N * 0.05; put(c + ox + Math.cos(a) * r, c + oy + Math.sin(a) * r, 2); }
  } else if (P.seedShape === 'ring') {
    const rr = N * (0.12 + R() * 0.1);
    for (let a = 0; a < 6.283; a += 0.05) put(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1);
  } else if (P.seedShape === 'line') {
    const a = R() * 3.14, L = N * 0.22;
    for (let s = -L; s <= L; s += 1) put(c + Math.cos(a) * s, c + Math.sin(a) * s, 1);
  } else {
    for (let i = 0; i < 40; i++) {
      const a = R() * 6.283, r = Math.sqrt(R()) * N * P.radius * 0.9;
      put(c + Math.cos(a) * r, c + Math.sin(a) * r, 1);
    }
  }
  for (let i = 0; i < 2; i++) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, N, N);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, init);
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    st.push(t); sf.push(f);
  }
  let cur = 0;

  // the 3D history
  const vol = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, vol);
  const levels = 4;
  gl.texStorage3D(gl.TEXTURE_3D, levels, gl.RGBA16F, N, N, D);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAX_LEVEL, levels - 1);
  const sliceFbo = gl.createFramebuffer()!;
  {
    // clear every layer
    gl.bindFramebuffer(gl.FRAMEBUFFER, sliceFbo);
    gl.clearColor(0, 0, 0, 1);
    for (let z = 0; z < D; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, vol, 0, z);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.generateMipmap(gl.TEXTURE_3D);
  }

  let steps = 0;       // total simulation steps
  let total = 0;       // slices captured
  let since = 0;       // steps since the last capture
  let cycleStart = 0;
  let cycleTarget = FIRST;
  let phase: 'grow' | 'rest' = 'grow';
  let restT = 0;
  let cycle = 0;
  let tint = R();
  let mipDirty = false;

  function shapeAt(sl: number) {
    const h = sl / D;
    const r = P.radius * (1 + P.breath * Math.sin(h * Math.PI * 2 * P.breathFreq + 1.3));
    return { r, angle: P.twist * h * Math.PI };
  }

  function step(n: number) {
    gl!.useProgram(sim.p);
    gl!.viewport(0, 0, N, N);
    gl!.uniform1f(sim.u.uN, N);
    gl!.uniform1i(sim.u.uS, 0);
    gl!.activeTexture(gl!.TEXTURE0);
    const sh = shapeAt(total + since / S);
    gl!.uniform1f(sim.u.uR, sh.r);
    gl!.uniform4f(sim.u.uShape, P.lobes, P.lobeAmp, sh.angle, P.wobble);
    gl!.uniform2f(sim.u.uCenter, 0, 0);
    gl!.uniform1f(sim.u.uK, P.k);
    for (let i = 0; i < n; i++) {
      const F = P.F * (1 + P.species.drift * Math.sin((steps / (S * D)) * Math.PI * 4));
      gl!.uniform1f(sim.u.uF, F);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, sf[1 - cur]);
      gl!.bindTexture(gl!.TEXTURE_2D, st[cur]);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      cur = 1 - cur;
      steps++;
    }
  }

  function capture() {
    gl!.useProgram(slice.p);
    gl!.viewport(0, 0, N, N);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, sliceFbo);
    gl!.framebufferTextureLayer(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, vol, 0, total % D);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, st[cur]);
    gl!.uniform1i(slice.u.uS, 0);
    gl!.uniform1f(slice.u.uTint, tint);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    total++;
    mipDirty = true;
  }

  function newLayer() {
    cycle++;
    tint = R();
    const dots = new Float32Array(48);
    const nd = 3 + Math.floor(R() * 6);
    for (let i = 0; i < nd; i++) {
      const a = R() * 6.283, r = Math.sqrt(R()) * P.radius * 0.8;
      dots.set([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.012 + R() * 0.012, 1], i * 4);
    }
    const keep = P.species.name === 'waves' || P.species.name === 'pulsing spots' ? 1.0 : R() < 0.6 ? P.radius * (0.2 + R() * 0.4) : 1.0;
    gl!.useProgram(stamp.p);
    gl!.viewport(0, 0, N, N);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, sf[1 - cur]);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, st[cur]);
    gl!.uniform1i(stamp.u.uS, 0);
    gl!.uniform1f(stamp.u.uN, N);
    gl!.uniform4fv(stamp.u.uDots, dots);
    gl!.uniform1f(stamp.u.uKeep, keep);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    cur = 1 - cur;
    cycleStart = total;
    cycleTarget = LAYER;
  }

  function advance(nSteps: number) {
    while (nSteps > 0 && phase === 'grow') {
      const k = Math.min(nSteps, S - since);
      step(k);
      since += k; nSteps -= k;
      if (since >= S) {
        since = 0;
        capture();
        if (total - cycleStart >= cycleTarget) { phase = 'rest'; restT = 0; }
      }
    }
  }

  // ---- rendering ----
  let W = 0, H = 0;
  let lay = opts.layout();
  function resize() {
    lay = opts.layout();
    const cssW = Math.max(1, canvas.clientWidth), cssH = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    let s = lay.mobile ? 0.85 : 0.85;
    const maxPx = lay.mobile ? 480000 : 1250000;
    if (cssW * cssH * dpr * dpr * s * s > maxPx) s = Math.sqrt(maxPx / (cssW * cssH * dpr * dpr));
    W = Math.max(2, Math.round(cssW * dpr * s)); H = Math.max(2, Math.round(cssH * dpr * s));
    canvas.width = W; canvas.height = H;
  }
  resize();
  addEventListener('resize', () => { resize(); if (opts.still) requestAnimationFrame(() => draw(lastNow)); });

  const pal = P.palette;
  let mouseX = 0, mouseY = 0, mx = 0, my = 0;
  addEventListener('pointermove', (e) => {
    mouseX = (e.clientX / innerWidth) * 2 - 1;
    mouseY = (e.clientY / innerHeight) * 2 - 1;
  });

  let fade = 0;
  let cutNow = opts.still ? 0.8 : 0.3;
  let dtLast = 0;
  let lastNow = performance.now();
  let clock = 0;

  function draw(now: number) {
    if (mipDirty) {
      gl!.bindTexture(gl!.TEXTURE_3D, vol);
      gl!.generateMipmap(gl!.TEXTURE_3D);
      mipDirty = false;
    }
    mx += (mouseX - mx) * 0.03; my += (mouseY - my) * 0.03;
    const t = clock;
    const az = P.camAz + (opts.still ? 0 : P.orbitDir * t * ((Math.PI * 2) / 240)) + mx * 0.35;
    const el = P.camEl + my * 0.08;
    const target: V3 = [0, HY * 0.43, 0];
    const cam: V3 = [target[0] + Math.sin(az) * Math.cos(el) * P.camDist, target[1] + Math.sin(el) * P.camDist, target[2] + Math.cos(az) * Math.cos(el) * P.camDist];
    let fwd: V3 = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]];
    const fl = Math.hypot(...fwd); fwd = [fwd[0] / fl, fwd[1] / fl, fwd[2] / fl];
    let right: V3 = [-fwd[2], 0, fwd[0]];
    const rl = Math.hypot(...right); right = [right[0] / rl, right[1] / rl, right[2] / rl];
    const up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const tanY = Math.tan(((lay.mobile ? 30 : 27) * Math.PI) / 360);

    // key light: high, from the upper left of the view
    let L: V3 = [-right[0] * 0.55 + up[0] * 0.75 - fwd[0] * 0.35, -right[1] * 0.55 + up[1] * 0.75 - fwd[1] * 0.35 + 0.2, -right[2] * 0.55 + up[2] * 0.75 - fwd[2] * 0.35];
    const ll = Math.hypot(...L); L = [L[0] / ll, L[1] / ll, L[2] / ll];

    // the clipping plane turns with the view so the cut face is visible, and breathes in and out
    const ca = az + P.cutAngle;
    let cn: V3 = [Math.sin(ca), P.cutTilt, Math.cos(ca)];
    const cl = Math.hypot(...cn); cn = [cn[0] / cl, cn[1] / cl, cn[2] / cl];
    // a slow breathing cut while it grows; when a layer is complete it opens fully, like a sliced geode
    const breathe = 0.36 - 0.36 * Math.cos((t / 48 + P.cutPhase) * Math.PI * 2);
    const want = opts.still ? 0.8 : phase === 'rest' ? 0.85 : breathe;
    cutNow += (want - cutNow) * Math.min(1, dtLast * 0.35);
    const cyc = Math.min(1, Math.max(0, cutNow));
    const ease = cyc * cyc * (3 - 2 * cyc);
    const offset = 1.9 - ease * 1.9 + cn[1] * HY * 0.46;

    const baseF = Math.max(0, total + since / S - D);
    const top = Math.max(0, (total - 1 - baseF) / D) * HY;

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, W, H);
    gl!.useProgram(render.p);
    const u = render.u;
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_3D, vol);
    gl!.uniform1i(u.uVol, 0);
    gl!.uniform2f(u.uRes, W, H);
    gl!.uniform3fv(u.uCam, cam); gl!.uniform3fv(u.uFwd, fwd); gl!.uniform3fv(u.uRight, right); gl!.uniform3fv(u.uUp, up);
    gl!.uniform2f(u.uTan, tanY * (W / H), tanY);
    gl!.uniform2f(u.uShift, lay.shiftX, lay.shiftY);
    gl!.uniform1f(u.uHy, HY);
    gl!.uniform1f(u.uTop, top);
    gl!.uniform1f(u.uBase, baseF);
    gl!.uniform1f(u.uD, D);
    gl!.uniform1f(u.uN, N);
    gl!.uniform1f(u.uIso, P.species.iso);
    gl!.uniform1f(u.uInvert, P.invert ? 1 : 0);
    gl!.uniform1f(u.uAmb, pal.amb);
    gl!.uniform4f(u.uClip, cn[0], cn[1], cn[2], offset);
    gl!.uniform3fv(u.uL, L);
    gl!.uniform3fv(u.uBg, hex(pal.bg));
    gl!.uniform3fv(u.uBgHi, hex(pal.bgHi));
    gl!.uniform3fv(u.uCrust, lin(pal.crust));
    gl!.uniform3fv(u.uSss, lin(pal.sss));
    gl!.uniform3fv(u.uB0, lin(pal.b[0])); gl!.uniform3fv(u.uB1, lin(pal.b[1])); gl!.uniform3fv(u.uB2, lin(pal.b[2])); gl!.uniform3fv(u.uB3, lin(pal.b[3]));
    gl!.uniform4fv(u.uMat, pal.mat);
    gl!.uniform3fv(u.uEmit, lin(pal.emit));
    gl!.uniform1f(u.uExposure, pal.exposure);
    gl!.uniform1f(u.uTime, t);
    gl!.uniform1f(u.uFade, fade);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  let running = true;
  let raf = 0;
  let ready = false;
  let budget = 0;
  // start part-grown, so there is something to look at straight away
  let headStart = opts.still ? S * FIRST : Math.round(S * FIRST * 0.3);

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    clock += dt;
    dtLast = dt;
    if (headStart > 0) {
      const n = Math.min(headStart, 600);
      advance(n);
      headStart -= n;
    } else if (phase === 'grow') {
      budget += dt * stepsPerSecond;
      const n = Math.floor(budget);
      budget -= n;
      advance(Math.min(n, 40));
    } else {
      restT += dt;
      if (restT > REST_SECONDS) { phase = 'grow'; newLayer(); }
    }
    fade = Math.min(1, fade + dt / 2.5);
    draw(now);
    if (!ready) { ready = true; opts.onReady(); }
    raf = requestAnimationFrame(loop);
  }

  if (opts.still) {
    advance(S * FIRST);
    headStart = 0;
    fade = 1;
    draw(performance.now());
    opts.onReady();
    (window as any).__done = true;
  } else {
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => {
    if (opts.still) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; lastNow = performance.now(); raf = requestAnimationFrame(loop); }
  });

  return { params: { species: P.species.name, palette: pal.name, seedShape: P.seedShape, lobes: P.lobes, invert: P.invert }, palette: pal };
}
