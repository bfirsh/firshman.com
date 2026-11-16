// GLSL for terrain (injected into Lambert), sea, rivers, glass walls, glows and the final grade.
import * as THREE from 'three';

export const COMMON = /* glsl */ `
float h1(float n){ return fract(sin(n) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y);
}
`;

// Shared uniforms live on one object so every material sees the same values.
export function makeUniforms(N: number, heightTex: THREE.DataTexture) {
  const v4 = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
  return {
    uTime: { value: 0 },
    uN: { value: N },
    uHeight: { value: heightTex },
    uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.5, 0.6, 0.7) },
    uZenith: { value: new THREE.Color(0.5, 0.7, 0.9) },
    uHorizon: { value: new THREE.Color(0.9, 0.9, 0.9) },
    uLights: { value: 0 },
    uBrush: { value: new THREE.Vector4(0, 0, 3, 0) },
    uClouds: { value: v4(8) },
    uTL: { value: v4(12) },
    uRip: { value: v4(8) },
    uBoats: { value: v4(6) },
    uSwell: { value: 1 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uFresh: { value: new THREE.Color() },
    uFoam: { value: new THREE.Color() },
    uDirt: { value: new THREE.Color() },
    uRock1: { value: new THREE.Color() },
    uRock2: { value: new THREE.Color() },
    uSeabed: { value: new THREE.Color() },
    uAbsorb: { value: new THREE.Vector3(0.5, 0.15, 0.08) },
  };
}
export type Uniforms = ReturnType<typeof makeUniforms>;

const SWELL = /* glsl */ `
float swellH(vec2 p, float t){
  return 0.055*sin(dot(p, vec2(0.23, 0.11)) + t*0.9)
       + 0.035*sin(dot(p, vec2(-0.12, 0.29)) + t*1.27)
       + 0.018*sin(dot(p, vec2(0.41, -0.33)) + t*2.1);
}
float rippleH(vec2 p, float t, out float foam){
  float s = 0.0; foam = 0.0;
  for (int i = 0; i < 8; i++){
    vec4 r = uRip[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 3.5) continue;
    float d = length(p - r.xy);
    float front = 0.4 + age * 3.2;
    float env = exp(-age * 1.3) * r.w;
    float x = d - front;
    s += env * 0.16 * exp(-x*x*0.9) * sin(x * 3.4);
    foam += env * exp(-x*x*3.0) * 0.8;
  }
  return s;
}
`;

export function swellJS(x: number, z: number, t: number) {
  return 0.055 * Math.sin(x * 0.23 + z * 0.11 + t * 0.9) + 0.035 * Math.sin(-x * 0.12 + z * 0.29 + t * 1.27) + 0.018 * Math.sin(x * 0.41 - z * 0.33 + t * 2.1);
}

const CLOUDSHADE = /* glsl */ `
float cloudShade(vec3 p){
  float s = 1.0;
  vec3 L = uSunDir; float ly = max(L.y, 0.22);
  for (int i = 0; i < 8; i++){
    vec4 c = uClouds[i];
    if (c.z <= 0.0) continue;
    vec2 q = p.xz + L.xz / ly * (12.5 - p.y);
    float d = length(q - c.xy);
    s *= 1.0 - c.w * (1.0 - smoothstep(c.z * 0.35, c.z * 1.05, d));
  }
  return s;
}
`;

const HEIGHT = /* glsl */ `
float tx(ivec2 i){ i = clamp(i, ivec2(0), ivec2(int(uN) - 1)); return texelFetch(uHeight, i, 0).r; }
float thc(vec2 c){
  ivec2 ij = ivec2(floor(c + uN * 0.5));
  if (ij.x < 0 || ij.y < 0 || ij.x >= int(uN) || ij.y >= int(uN)) return -99.0;
  return texelFetch(uHeight, ij, 0).r;
}
float hAt(vec2 p){
  vec2 g = p + uN * 0.5 - 0.5; vec2 f = fract(g); ivec2 i = ivec2(floor(g));
  return mix(mix(tx(i), tx(i + ivec2(1, 0)), f.x), mix(tx(i + ivec2(0, 1)), tx(i + ivec2(1, 1)), f.x), f.y);
}
`;

// ---------------------------------------------------------------- terrain
export function terrainMaterial(U: Uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 iTop; attribute float iCap;
varying vec3 vTopC; varying float vCapD; varying vec3 vWP; varying vec3 vON; varying float vTopY; varying vec2 vCell;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTopC = iTop; vCapD = iCap; vON = normal;
vTopY = instanceMatrix[3].y + instanceMatrix[1].y;
vCell = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uHeight; uniform float uN; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol;
uniform vec3 uDirt; uniform vec3 uRock1; uniform vec3 uRock2; uniform vec3 uSeabed;
uniform vec4 uBrush; uniform vec4 uClouds[8]; uniform vec4 uTL[12]; uniform float uLights; uniform vec3 uAbsorb;
varying vec3 vTopC; varying float vCapD; varying vec3 vWP; varying vec3 vON; varying float vTopY; varying vec2 vCell;
${COMMON}
${HEIGHT}
${CLOUDSHADE}
float caustic(vec2 p, float t){
  vec2 q = p * 1.25;
  float c = sin(q.x * 1.7 + t * 1.1 + sin(q.y * 1.3 + t * 0.7) * 1.6) + sin(q.y * 1.9 - t * 0.9 + sin(q.x * 1.1 - t * 0.6) * 1.6);
  c = abs(c) * 0.5;
  return pow(1.0 - clamp(c, 0.0, 1.0), 7.0);
}`)
      .replace('#include <color_fragment>', `
vec3 col;
float dd = vTopY - vWP.y;
bool isTop = vON.y > 0.5;
vec2 lc = vWP.xz - vCell;
vec2 cid = floor(vCell + uN * 0.5);
float layer = floor(vWP.y * 2.0 + 0.001);
if (isTop) {
  col = vTopC;
  float e = 0.5 - max(abs(lc.x), abs(lc.y));
  col *= 1.0 + 0.08 * (1.0 - smoothstep(0.0, 0.055, e));
} else {
  float hs = h1(layer * 13.17 + 3.1);
  vec3 st = mix(uRock1, uRock2, step(0.55, hs));
  st = mix(uDirt, st, smoothstep(0.8, 2.0, dd));
  st = mix(st, uSeabed, (1.0 - smoothstep(-1.4, -0.2, vWP.y)) * 0.55);
  st *= 0.9 + 0.16 * h2(cid + layer * 0.731);
  col = dd < vCapD ? vTopC * 0.93 : st;
  float fy = fract(vWP.y * 2.0 + 0.001);
  col *= 1.0 - 0.09 * (1.0 - smoothstep(0.0, 0.07, fy)) * step(0.05, dd);
  col *= 1.0 + 0.1 * (1.0 - smoothstep(0.0, 0.05, dd));
}
diffuseColor.rgb = col;
// voxel ambient occlusion from neighbouring columns
float ao = 1.0;
if (isTop) {
  vec2 e = lc + 0.5;
  float t0 = vTopY;
  float o = 0.0;
  o += clamp(thc(vCell + vec2(-1, 0)) - t0, 0.0, 1.0) * pow(1.0 - e.x, 3.0);
  o += clamp(thc(vCell + vec2(1, 0)) - t0, 0.0, 1.0) * pow(e.x, 3.0);
  o += clamp(thc(vCell + vec2(0, -1)) - t0, 0.0, 1.0) * pow(1.0 - e.y, 3.0);
  o += clamp(thc(vCell + vec2(0, 1)) - t0, 0.0, 1.0) * pow(e.y, 3.0);
  o += clamp(thc(vCell + vec2(-1, -1)) - t0, 0.0, 1.0) * pow((1.0 - e.x) * (1.0 - e.y), 2.5);
  o += clamp(thc(vCell + vec2(1, -1)) - t0, 0.0, 1.0) * pow(e.x * (1.0 - e.y), 2.5);
  o += clamp(thc(vCell + vec2(-1, 1)) - t0, 0.0, 1.0) * pow((1.0 - e.x) * e.y, 2.5);
  o += clamp(thc(vCell + vec2(1, 1)) - t0, 0.0, 1.0) * pow(e.x * e.y, 2.5);
  ao = 1.0 - clamp(o * 0.55, 0.0, 0.55);
} else {
  vec2 n = vec2(vON.x, vON.z);
  float hn = thc(vCell + n);
  float gap = vWP.y - max(hn, -4.0);
  ao = mix(0.55, 1.0, smoothstep(0.0, 1.4, gap));
  ao *= mix(0.72, 1.0, smoothstep(-5.0, -0.5, -dd));
}
`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
float cs = cloudShade(vWP);
reflectedLight.directDiffuse *= cs * mix(1.0, ao, 0.35);
reflectedLight.indirectDiffuse *= ao;
if (vWP.y < 0.0) {
  float dep = -vWP.y;
  float c = caustic(vWP.xz, uTime) * (isTop ? 1.0 : 0.45);
  totalEmissiveRadiance += uSunCol * c * 0.32 * exp(-dep * 0.45) * diffuseColor.rgb * cs;
  vec3 T = exp(-dep * uAbsorb);
  reflectedLight.directDiffuse *= T;
  reflectedLight.indirectDiffuse *= T;
  totalEmissiveRadiance *= T;
}
if (uLights > 0.01) {
  for (int i = 0; i < 12; i++) {
    vec4 L = uTL[i];
    if (L.w <= 0.0) continue;
    vec3 d = vWP - L.xyz;
    totalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * exp(-dot(d, d) * 0.3) * L.w * uLights * 0.8 * diffuseColor.rgb;
  }
}
if (uBrush.w != 0.0) {
  float d = length(vWP.xz - uBrush.xy);
  float ring = 1.0 - smoothstep(0.0, 0.1, abs(d - uBrush.z));
  float fill = (1.0 - smoothstep(0.0, uBrush.z, d)) * 0.06;
  vec3 bc = uBrush.w > 0.0 ? vec3(1.0, 0.95, 0.82) : vec3(0.7, 0.85, 1.0);
  totalEmissiveRadiance += bc * (ring * 0.45 + fill) * abs(uBrush.w) * (isTop ? 1.0 : 0.35);
}`);
  };
  return m;
}

// ---------------------------------------------------------------- windows (houses)
export function wallMaterial(U: Uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLights = U.uLights;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float iLight; varying float vLt; varying vec3 vLoc; varying vec3 vON2;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLt = iLight; vLoc = position; vON2 = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uLights; varying float vLt; varying vec3 vLoc; varying vec3 vON2;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float win = 0.0;
if (abs(vON2.y) < 0.5) {
  bool zf = abs(vON2.z) > 0.5;
  float u = zf ? vLoc.x : vLoc.z;
  float cu = zf ? abs(abs(u) - 0.104) : abs(u);
  win = step(cu, 0.036) * step(abs(vLoc.y - 0.17), 0.04);
}
float on = smoothstep(vLt, vLt + 0.08, uLights);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.18, 0.24), win * (1.0 - on) * 0.85);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.3) * win * on * 3.2;`);
  };
  return m;
}

// ---------------------------------------------------------------- sea
export function seaMaterial(U: Uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as any,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
uniform float uTime; uniform float uN; uniform float uSwell; uniform vec4 uRip[8];
varying vec3 vW; varying float vRF;
${SWELL}
void main(){
  vec3 p = position;
  float edge = smoothstep(uN * 0.5, uN * 0.5 - 2.5, max(abs(p.x), abs(p.z)));
  float rf;
  p.y += (swellH(p.xz, uTime) * uSwell + rippleH(p.xz, uTime, rf)) * edge;
  vRF = rf;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform float uN; uniform sampler2D uHeight; uniform float uSwell;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec4 uRip[8]; uniform vec4 uBoats[6];
uniform vec4 uClouds[8]; uniform vec4 uTL[12]; uniform float uLights; uniform vec4 uBrush;
varying vec3 vW; varying float vRF;
${COMMON}
${HEIGHT}
${SWELL}
${CLOUDSHADE}
float detailH(vec2 p, float t){
  return (0.016 * sin(dot(p, vec2(1.05, 0.62)) + t * 1.9)
       + 0.011 * sin(dot(p, vec2(-0.55, 1.6)) + t * 2.3)
       + 0.007 * sin(dot(p, vec2(2.4, -1.3)) + t * 3.1)
       + 0.004 * sin(dot(p, vec2(-2.9, -3.1)) + t * 3.9)) * uSwell;
}
void main(){
  vec2 p = vW.xz;
  float t = uTime;
  float tH = hAt(p);
  float depth = max(0.0, vW.y - tH);
  // normal from swell + ripples + travelling detail waves
  float e = 0.06, rf;
  float h0 = swellH(p, t) * uSwell + rippleH(p, t, rf) + detailH(p, t);
  float hx = swellH(p + vec2(e, 0.0), t) * uSwell + rippleH(p + vec2(e, 0.0), t, rf) + detailH(p + vec2(e, 0.0), t);
  float hz = swellH(p + vec2(0.0, e), t) * uSwell + rippleH(p + vec2(0.0, e), t, rf) + detailH(p + vec2(0.0, e), t);
  vec2 g = vec2(hx - h0, hz - h0) / e;
  float c1 = vn(p * 2.3 + vec2(t * 0.35, t * 0.21)), c2 = vn(p * 4.1 - vec2(t * 0.27, -t * 0.4));
  g += (vec2(c1, c2) - 0.5) * 0.05 * uSwell;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uSunDir);
  vec3 R = reflect(-V, N);
  float cs = cloudShade(vW);
  // body colour by depth
  float k = 1.0 - exp(-depth * 0.5);
  vec3 body = mix(uShallow, uDeep, k);
  body *= 0.8 + 0.25 * vn(p * 0.18 + 7.0);
  body *= 1.0 + clamp(h0, -0.12, 0.12) * 2.4 * smoothstep(0.3, 1.5, depth);
  body *= uAmb * 0.8 + uSunCol * cs * (0.22 + 0.24 * max(dot(N, L), 0.0));
  body += uShallow * uSunCol * cs * 0.05 * smoothstep(0.02, 0.09, h0); // light through crests
  float fres = 0.07 + 0.93 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.8, R.y));
  vec3 col = mix(body, sky, fres * 0.85);
  float alpha = mix(0.2, 0.93, 1.0 - exp(-depth * 0.62));
  alpha = mix(alpha, 1.0, fres * 0.6);
  // sun glint + sparkles
  float sp = max(dot(R, L), 0.0);
  col += uSunCol * cs * (pow(sp, 700.0) * 4.0 + pow(sp, 160.0) * 0.5 + pow(sp, 24.0) * 0.12 + pow(sp, 6.0) * 0.04);

  // foam: crisp line hugging the voxel coast + soft bands on the shelf
  ivec2 ci = ivec2(floor(p + uN * 0.5));
  float dl = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ci + ivec2(i, j);
    if (c.x < 0 || c.y < 0 || c.x >= int(uN) || c.y >= int(uN)) continue;
    if (texelFetch(uHeight, c, 0).r < vW.y - 0.02) continue;
    vec2 cc = vec2(c) - uN * 0.5 + 0.5;
    vec2 q = max(abs(p - cc) - 0.5, 0.0);
    dl = min(dl, length(q));
  }
  float n1 = vn(p * 3.0 + t * 0.4), n2 = vn(p * 1.2 - t * 0.15);
  float line = 1.0 - smoothstep(0.04, 0.2 + 0.16 * n1, dl);
  float ph = fract(t * 0.21 + n2 * 0.6);
  float lap = (1.0 - smoothstep(0.0, 0.07 + 0.05 * n1, abs(dl - (0.12 + ph * 0.95)))) * (1.0 - ph) * smoothstep(0.25, 0.55, n1 + 0.2);
  line = max(line, lap * 0.85);
  float shore = 1.0 - smoothstep(0.0, 1.3, depth);
  float bands = smoothstep(0.62, 0.9, 0.5 + 0.5 * sin(depth * 8.0 - t * 1.7 + n2 * 4.0)) * shore * smoothstep(0.3, 0.7, n1 + shore * 0.3);
  float foam = max(line, bands * 0.75);
  foam = max(foam, clamp(vRF, 0.0, 1.0) * smoothstep(0.35, 0.6, n1));
  // boat wakes
  for (int i = 0; i < 6; i++) {
    vec4 b = uBoats[i];
    if (b.w <= 0.0) continue;
    vec2 dir = vec2(cos(b.z), sin(b.z));
    vec2 d = p - b.xy;
    float along = -dot(d, dir);
    float side = abs(dot(d, vec2(-dir.y, dir.x)));
    float wk = smoothstep(-0.2, 0.2, along) * (1.0 - smoothstep(0.0, 3.0, along)) * (1.0 - smoothstep(0.03 + along * 0.18, 0.12 + along * 0.22, abs(side - along * 0.14)));
    foam = max(foam, wk * 0.7 * smoothstep(0.3, 0.6, n1));
  }
  vec3 fc = uFoam * (uAmb * 0.8 + uSunCol * cs * 0.55);
  col = mix(col, fc, foam);
  alpha = max(alpha, foam * 0.95);
  // town lights reflected
  if (uLights > 0.01) {
    for (int i = 0; i < 12; i++) {
      vec4 Lt = uTL[i];
      if (Lt.w <= 0.0) continue;
      vec2 d = p - Lt.xz;
      float a = exp(-dot(d, d) * 0.25) * (0.6 + 0.4 * c1);
      col += vec3(1.0, 0.58, 0.26) * a * Lt.w * uLights * 0.55;
    }
  }
  if (uBrush.w != 0.0) {
    float d = length(p - uBrush.xy);
    float ring = 1.0 - smoothstep(0.0, 0.1, abs(d - uBrush.z));
    col += vec3(1.0, 0.97, 0.9) * ring * 0.35 * abs(uBrush.w);
    alpha = max(alpha, ring * 0.5 * abs(uBrush.w));
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- rivers / lakes (per-cell tiles)
export function freshMaterial(U: Uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as any,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
attribute vec4 aFlow;
varying vec4 vF; varying vec3 vW;
void main(){
  vF = aFlow;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uZenith; uniform vec3 uHorizon;
uniform vec3 uFresh; uniform vec3 uDeep; uniform vec3 uFoam; uniform vec4 uClouds[8];
varying vec4 vF; varying vec3 vW;
${COMMON}
${CLOUDSHADE}
void main(){
  vec2 p = vW.xz;
  vec2 dir = vF.xy;
  float spd = length(dir);
  vec2 fl = spd > 1e-4 ? dir / spd : vec2(0.0);
  float t = uTime;
  vec2 q = p - fl * t * (0.6 + spd * 4.0);
  float n = vn(q * 3.0), m = vn(q * 6.5 + 3.0);
  vec3 N = normalize(vec3((n - 0.5) * 0.5, 1.0, (m - 0.5) * 0.5));
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = normalize(uSunDir);
  float cs = cloudShade(vW);
  vec3 body = mix(uFresh, uDeep, clamp(vF.w * 1.4, 0.0, 0.7));
  body *= uAmb + uSunCol * cs * 0.35;
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = mix(body, mix(uHorizon, uZenith, 0.5), fres * 0.6);
  vec3 R = reflect(-V, N);
  col += uSunCol * cs * pow(max(dot(R, L), 0.0), 120.0) * 2.5;
  float foam = clamp(vF.z, 0.0, 1.0) * smoothstep(0.45, 0.75, n + m * 0.4);
  foam = max(foam, smoothstep(0.82, 0.95, m) * clamp(spd * 6.0, 0.0, 0.5));
  col = mix(col, uFoam * (uAmb + uSunCol * cs * 0.5), foam);
  float a = clamp(0.62 + vF.w * 0.8, 0.0, 0.9) * smoothstep(0.0, 0.1, vF.w + spd);
  a = max(a, foam * 0.9);
  gl_FragColor = vec4(col * a, a);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- glass water walls
export function wallWaterMaterial(U: Uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as any,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
varying vec3 vW; varying vec2 vUv;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uAmb; uniform vec3 uSunCol; uniform vec3 uFoam; uniform float uTime;
varying vec3 vW; varying vec2 vUv;
void main(){
  float d = -vW.y;
  float k = smoothstep(-0.2, 4.0, d);
  vec3 c = mix(uShallow, uDeep, 0.35 + 0.65 * k) * (uAmb * 0.9 + uSunCol * 0.25);
  float a = mix(0.42, 0.8, k);
  float top = 1.0 - smoothstep(0.0, 0.07, abs(d - 0.0));
  float edge = 1.0 - smoothstep(0.0, 0.012, min(vUv.x, 1.0 - vUv.x));
  c += (uFoam * (uAmb + uSunCol * 0.4)) * (top * 0.7 + edge * 0.25);
  a = max(a, top * 0.8);
  gl_FragColor = vec4(c * a, a);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- clouds (fade near the brush)
export function cloudMaterial(U: Uniforms) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, emissive: new THREE.Color(0.1, 0.11, 0.13) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBrush = U.uBrush;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vCW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vCW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec4 uBrush; varying vec3 vCW;`)
      .replace('#include <opaque_fragment>', `
float bf = uBrush.w != 0.0 ? mix(0.18, 1.0, smoothstep(uBrush.z + 1.0, uBrush.z + 6.0, length(vCW.xz - uBrush.xy))) : 1.0;
diffuseColor.a *= bf;
#include <opaque_fragment>`);
  };
  return m;
}

// ---------------------------------------------------------------- additive glow points (lights, lanterns)
export function glowMaterial(U: Uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uLights: U.uLights, uScale: { value: 400 }, uTime: U.uTime },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
attribute float aTh; attribute float aSize; attribute vec3 aCol;
uniform float uLights; uniform float uScale; uniform float uTime;
varying float vOn; varying vec3 vC;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float on = aTh < 0.0 ? 1.0 : smoothstep(aTh, aTh + 0.08, uLights);
  vOn = on * (0.85 + 0.15 * sin(uTime * 3.0 + position.x * 7.0 + position.z * 3.0));
  vC = aCol;
  gl_PointSize = aSize * uScale / -mv.z * (0.4 + 0.6 * on);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying float vOn; varying vec3 vC;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float a = exp(-r * 5.0) * 0.85 + exp(-r * 40.0) * 1.4;
  gl_FragColor = vec4(vC * a * vOn, 0.0);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

export function beamMaterial(U: Uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uLights: U.uLights },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uLights; varying vec2 vUv;
void main(){
  float along = vUv.y;
  float a = pow(along, 2.2) * (1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5))) * uLights * 0.22;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, 0.0);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

export function shadowBlobMaterial(size: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uS: { value: size }, uK: { value: 0.3 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uS; uniform float uK; varying vec2 vP;
void main(){
  vec2 q = abs(vP) - uS * 0.5;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float a = (1.0 - smoothstep(-3.0, uS * 0.22, d)) * uK;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------------------------------------------------------------- final pass: tilt-shift, background, grade, grain
export function postMaterial(tex: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: tex },
      uRes: { value: new THREE.Vector2(1, 1) },
      uFocus: { value: 0.5 },
      uBlur: { value: 6 },
      uBgTop: { value: new THREE.Color() },
      uBgBot: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uGlowPos: { value: new THREE.Vector2(0.7, 0.8) },
      uStars: { value: 0 },
      uExposure: { value: 1 },
      uTime: { value: 0 },
      uGrade: { value: new THREE.Color(1, 1, 1) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform sampler2D tScene; uniform vec2 uRes; uniform float uFocus; uniform float uBlur;
uniform vec3 uBgTop; uniform vec3 uBgBot; uniform vec3 uGlow; uniform vec2 uGlowPos; uniform float uStars;
uniform float uExposure; uniform float uTime; uniform vec3 uGrade;
varying vec2 vUv;
${COMMON}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  float dy = abs(vUv.y - uFocus);
  float r = uBlur * smoothstep(0.14, 0.55, dy);
  vec4 acc = texture2D(tScene, vUv);
  if (r > 0.35) {
    acc.rgb = min(acc.rgb, vec3(2.0));
    float w = 1.0;
    float rot = h2(vUv * uRes) * 6.2831;
    for (int i = 0; i < 14; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / 14.0) * r;
      float a = fi * 2.39996 + rot;
      vec4 sm = texture2D(tScene, vUv + vec2(cos(a), sin(a)) * rr / uRes);
      acc += vec4(min(sm.rgb, vec3(2.0)), sm.a);
      w += 1.0;
    }
    acc /= w;
  }
  vec3 sc = aces(acc.rgb * uExposure);
  sc = toSRGB(sc) * uGrade;
  float aspect = uRes.x / uRes.y;
  vec3 bg = mix(uBgBot, uBgTop, smoothstep(0.0, 1.0, vUv.y));
  vec2 gp = (vUv - uGlowPos) * vec2(aspect, 1.0);
  bg += uGlow * exp(-dot(gp, gp) * 2.2);
  if (uStars > 0.01) {
    vec2 sp = vUv * uRes / 3.0;
    vec2 cell = floor(sp);
    float s = h2(cell);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
    float st = step(0.996, s) * (1.0 - smoothstep(0.0, 0.5, length(fract(sp) - 0.5))) * tw;
    bg += vec3(0.85, 0.9, 1.0) * st * uStars * smoothstep(0.25, 0.9, vUv.y);
  }
  vec3 col = sc + bg * (1.0 - acc.a);
  vec2 vq = vUv - 0.5;
  col *= 1.0 - dot(vq, vq) * 0.22;
  col += (h2(vUv * uRes + fract(uTime) * 91.7) - 0.5) / 255.0 * 2.2;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}
