// Murmuration: GPU flocking on ping-pong float textures, a particle-in-cell grid for the
// neighbourhood, and a painted dusk over a marsh.

const ATLAS = /* glsl */ `
vec4 atlas(sampler2D tex, vec3 g, float N, float tiles, vec2 asz) {
  g = clamp(g, vec3(0.5), vec3(N - 0.5));
  float z = g.z - 0.5;
  float z0 = floor(z);
  float fz = z - z0;
  float z1 = min(z0 + 1.0, N - 1.0);
  vec2 t0 = vec2(mod(z0, tiles), floor(z0 / tiles)) * N;
  vec2 t1 = vec2(mod(z1, tiles), floor(z1 / tiles)) * N;
  return mix(texture(tex, (t0 + g.xy) / asz), texture(tex, (t1 + g.xy) / asz), fz);
}
`;

const HASH = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash31(float p) { vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
`;

export const QUAD_VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// ------------------------------------------------------------------ splat birds into the grid
export const SPLAT_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos, uVel, uCen;
uniform int uTexW;
uniform float uGCell, uGN, uGTiles;
uniform vec2 uGAtlas;
out vec4 vV;
out float vA;
void main() {
  int id = gl_VertexID;
  ivec2 tc = ivec2(id % uTexW, id / uTexW);
  vec3 p = texelFetch(uPos, tc, 0).xyz;
  vec4 v = texelFetch(uVel, tc, 0);
  vec3 gMin = texelFetch(uCen, ivec2(0), 0).xyz - 0.5 * uGN * uGCell;
  vec3 g = (p - gMin) / uGCell;
  vV = vec4(v.xyz, 1.0);
  vA = v.w;
  gl_PointSize = 1.0;
  if (any(lessThan(g, vec3(0.0))) || any(greaterThanEqual(g, vec3(uGN)))) {
    gl_Position = vec4(4.0, 4.0, 0.0, 1.0);
    return;
  }
  vec3 c = floor(g);
  vec2 tile = vec2(mod(c.z, uGTiles), floor(c.z / uGTiles));
  vec2 pix = tile * uGN + c.xy + 0.5;
  gl_Position = vec4(pix / uGAtlas * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const SPLAT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec4 vV;
in float vA;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
// half floats top out at 65504, so velocities are stored /16 and counts /2 (decoded in the update)
void main() { o0 = vec4(vV.xyz * 0.0625, 0.5); o1 = vec4(vA * 0.5, 0.0, 0.0, 1.0); }
`;

// ------------------------------------------------------------------ flock centroid (a sparse sample)
export const CENTROID_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform int uTexW;
out vec4 o;
void main() {
  vec3 s = vec3(0.0);
  vec3 q = vec3(0.0);
  for (int j = 0; j < 16; j++) for (int i = 0; i < 16; i++) {
    ivec2 tc = ivec2((i * uTexW) / 16 + j % 3, (j * uTexW) / 16 + i % 3);
    vec3 p = texelFetch(uPos, tc, 0).xyz;
    s += p;
    q += p * p;
  }
  s /= 256.0;
  q = q / 256.0 - s * s;
  o = vec4(s, sqrt(max(q.x + q.y + q.z, 0.0)));
}
`;

// ------------------------------------------------------------------ the falcon's flight (2x1 texture: position, velocity)
export const PRED_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uPredT, uCen;
uniform vec3 uTgtM, uTgtS;
uniform vec3 uMove; // speed, turn rate, lift
uniform float uDt;
out vec4 o;
void main() {
  vec3 p = texelFetch(uPredT, ivec2(0, 0), 0).xyz;
  vec3 v = texelFetch(uPredT, ivec2(1, 0), 0).xyz;
  vec4 c = texelFetch(uCen, ivec2(0), 0);
  if (any(isnan(p)) || any(isnan(v))) { p = vec3(0.0, 80.0, 400.0); v = vec3(0.0); }
  if (any(isnan(c)) || any(isinf(c))) c = vec4(p, 60.0);
  vec3 t = c.xyz + uTgtM + uTgtS * clamp(c.w, 25.0, 200.0);
  vec3 d = t - p;
  float l = max(length(d), 1e-3);
  float sp = uMove.x * (1.0 + clamp((l - 150.0) / 150.0, 0.0, 1.0));
  v += (d / l * sp - v) * min(1.0, uDt * uMove.y);
  v.y += uMove.z * uDt;
  p += v * uDt;
  p.y = max(p.y, 12.0);
  o = gl_FragCoord.x < 1.0 ? vec4(p, 1.0) : vec4(v, 0.0);
}
`;

// ------------------------------------------------------------------ flocking update
export const UPDATE_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos, uVel, uF0, uF1, uC0, uCen, uPredT;
uniform float uPredR;
uniform float uFCell, uFN, uFTiles;
uniform vec2 uFAtlas;
uniform float uCCell, uCN, uCTiles;
uniform vec2 uCAtlas;
uniform float uDt, uTime;
uniform vec3 uHome, uHomeExt;
uniform float uSpeed, uAlign, uCoh, uSep, uRho0, uNoise, uFlee, uEsc, uYMin;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
${HASH}
${ATLAS}
vec4 F0(vec3 g) { vec4 a = atlas(uF0, g, uFN, uFTiles, uFAtlas); return vec4(a.xyz * 16.0, a.w * 2.0); }
vec4 C0(vec3 g) { vec4 a = atlas(uC0, g, uCN, uCTiles, uCAtlas); return vec4(a.xyz * 16.0, a.w * 2.0); }

void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(uPos, tc, 0);
  vec4 V = texelFetch(uVel, tc, 0);
  vec3 p = P.xyz, v = V.xyz;
  float alarm = V.w, refr = P.w;
  float id = float(tc.y * 1024 + tc.x);

  vec3 cen = texelFetch(uCen, ivec2(0), 0).xyz;
  if (any(isnan(cen)) || any(isinf(cen))) cen = uHome;
  vec3 uFMin = cen - 0.5 * uFN * uFCell;
  vec3 uCMin = cen - 0.5 * uCN * uCCell;
  vec3 acc = vec3(0.0);
  float sp = max(length(v), 1e-3);
  vec3 dir = v / sp;

  // coarse grid: cohesion toward the body of the flock, and a fallback heading
  vec3 gc = (p - uCMin) / uCCell;
  vec4 c0 = C0(gc);
  vec3 gradC = vec3(
    C0(gc + vec3(1, 0, 0)).w - C0(gc - vec3(1, 0, 0)).w,
    C0(gc + vec3(0, 1, 0)).w - C0(gc - vec3(0, 1, 0)).w,
    C0(gc + vec3(0, 0, 1)).w - C0(gc - vec3(0, 0, 1)).w) / (2.0 * uCCell);
  vec3 vAvg = c0.w > 0.5 ? c0.xyz / c0.w : v;

  // fine grid: alignment with the nearest few (topological: widen to the coarse grid when the
  // fine neighbourhood holds fewer than ~7 birds), short-range pressure, and the alarm signal
  vec3 gf = (p - uFMin) / uFCell;
  float rho = 0.0, nA = 0.0;
  vec3 gradF = vec3(0.0);
  if (all(greaterThan(gf, vec3(1.0))) && all(lessThan(gf, vec3(uFN - 1.0)))) {
    vec4 f0 = F0(gf);
    rho = f0.w;
    gradF = vec3(
      F0(gf + vec3(1, 0, 0)).w - F0(gf - vec3(1, 0, 0)).w,
      F0(gf + vec3(0, 1, 0)).w - F0(gf - vec3(0, 1, 0)).w,
      F0(gf + vec3(0, 0, 1)).w - F0(gf - vec3(0, 0, 1)).w) / (2.0 * uFCell);
    float w = smoothstep(1.0, 4.0, rho);
    vec3 vf = rho > 0.05 ? f0.xyz / rho : v;
    vAvg = mix(vAvg, vf, w);
    nA = rho > 0.3 ? atlas(uF1, gf, uFN, uFTiles, uFAtlas).x * 2.0 / rho : 0.0;
  }

  acc += uAlign * (vAvg - v);
  // pressure only where the flock is compressed; attraction only at the margin, where a bird's
  // neighbours all lie to one side. Vertical attraction is stronger, so the flock flattens into a sheet.
  float press = smoothstep(0.7 * uRho0, 1.4 * uRho0, rho);
  // starlings keep more room fore and aft than to the side (Ballerini et al. 2008), which spreads
  // the flock across its heading: it turns from a ribbon to a disc as it wheels
  vec3 pg = gradF * vec3(1.0, 0.35, 1.0);
  pg += dir * dot(pg, dir) * 1.6;
  acc -= uSep * pg / max(rho, 0.6 * uRho0) * press;
  float edge = 1.0 - smoothstep(0.35 * uRho0, 0.95 * uRho0, rho);
  vec3 toward = gradC / (length(gradC) + 0.15 * uRho0 / uCCell);
  float gfl = length(gradF);
  if (gfl > 1e-4) toward = mix(toward, gradF / gfl, smoothstep(0.0, 0.08 * uRho0, gfl));
  acc += uCoh * toward * vec3(1.0, 1.8, 1.0) * (0.12 + 0.88 * edge);
  acc += (uSpeed - sp) * dir * 1.4;

  // the roost: a soft, wandering home region
  vec3 dh = (uHome - p) / uHomeExt;
  float dl = length(dh);
  acc += normalize(uHome - p + 1e-4) * uSpeed * 0.32 * smoothstep(0.65, 1.35, dl) * (1.0 + 2.5 * max(dl - 1.2, 0.0));
  // keep off the reeds and roughly level
  acc.y += max(uYMin - p.y, 0.0) * 0.6;
  acc.y += max(14.0 - p.y, 0.0) * 1.5;
  acc.y -= v.y * 0.1;

  // the falcon
  vec3 predP = texelFetch(uPredT, ivec2(0, 0), 0).xyz;
  vec3 predV = texelFetch(uPredT, ivec2(1, 0), 0).xyz;
  vec3 dp = p - predP;
  float dd = length(dp);
  float R = uPredR;
  float threat = 1.0 - smoothstep(R * 0.15, R, dd);
  if (threat > 0.0) {
    vec3 away = dp / max(dd, 1e-3);
    vec3 pv = normalize(predV + vec3(1e-4));
    vec3 side = away - pv * dot(away, pv);
    acc += normalize(side * 1.4 + away * 0.6 + vec3(0.0, 1e-4, 0.0)) * uFlee * threat * threat;
  }

  // excitable alarm: a rising wave that propagates through neighbours, then a refractory period
  bool trig = threat > 0.02 || nA > 0.13;
  if (refr <= 0.0) {
    if (trig) alarm = min(1.0, alarm + uDt * 5.0);
    else alarm = max(0.0, alarm - uDt * 3.0);
    if (alarm >= 1.0) refr = 1.0;
  } else {
    alarm = max(0.0, alarm - uDt * 1.4);
    refr = max(0.0, refr - uDt * 0.4);
  }
  // alarmed birds bank and swerve away from the threat, dipping slightly
  vec3 lat = normalize(cross(vec3(0.0, 1.0, 0.0), dir) + vec3(1e-4, 0.0, 0.0));
  float s = dot(lat, dp) >= 0.0 ? 1.0 : -1.0;
  acc += (lat * s * uEsc - vec3(0.0, 2.5, 0.0)) * alarm;

  // individual jitter, smoothly varying
  float tt = uTime * 0.7 + hash11(id) * 10.0;
  float k = floor(tt);
  vec3 n = mix(hash31(id * 1.31 + k), hash31(id * 1.31 + k + 1.0), smoothstep(0.0, 1.0, fract(tt))) - 0.5;
  acc += n * uNoise;

  v += acc * uDt;
  float s2 = length(v);
  v *= clamp(s2, uSpeed * 0.55, uSpeed * 1.7) / max(s2, 1e-3);
  p += v * uDt;
  // never let one bad bird poison the grid
  if (any(isnan(p)) || any(isinf(p)) || any(isnan(v)) || any(isinf(v))) {
    p = cen + (hash31(id + uTime) - 0.5) * 40.0;
    v = vec3(uSpeed, 0.0, 0.0);
    alarm = 0.0; refr = 0.0;
  }
  oPos = vec4(p, refr);
  oVel = vec4(v, alarm);
}
`;

// ------------------------------------------------------------------ birds
export const BIRD_VERT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos, uVel, uPredT;
uniform int uTexW;
uniform float uIsPred;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform vec2 uFocal;
uniform vec2 uView;
uniform float uMirror;
uniform float uTime;
uniform float uSpan;
uniform vec3 uBird, uHaze;
uniform float uHazeD;
uniform float uAlpha;
out vec2 vWing;
out vec2 vBody;
out float vHalf;
out float vThick;
out vec4 vCol;
${HASH}
vec2 toPx(vec3 w, float z) {
  return vec2(dot(w, uCamR) * uFocal.x * 0.5 * uView.x, dot(w, uCamU) * uFocal.y * 0.5 * uView.y) / z;
}
void main() {
  int id = gl_VertexID;
  vec3 p, v;
  float alarm = 0.0, span = uSpan;
  float fid = float(id);
  if (uIsPred > 0.5) {
    p = texelFetch(uPredT, ivec2(0, 0), 0).xyz; v = texelFetch(uPredT, ivec2(1, 0), 0).xyz; span = uSpan * 2.6; fid = 7.0;
  } else {
    ivec2 tc = ivec2(id % uTexW, id / uTexW);
    p = texelFetch(uPos, tc, 0).xyz;
    vec4 vv = texelFetch(uVel, tc, 0);
    v = vv.xyz; alarm = vv.w;
  }
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (uMirror < 0.0) { p.y = -p.y; v.y = -v.y; up.y = -1.0; }
  vec3 rel = p - uCamPos;
  vec3 c = vec3(dot(rel, uCamR), dot(rel, uCamU), dot(rel, uCamF));
  if (c.z < 2.0) { gl_Position = vec4(4.0, 4.0, 0.0, 1.0); gl_PointSize = 1.0; return; }
  gl_Position = vec4(c.x * uFocal.x, c.y * uFocal.y, 0.0, c.z);

  vec3 dir = normalize(v + vec3(1e-4, 0.0, 0.0));
  vec3 lat = normalize(cross(up, dir) + vec3(0.0, 0.0, 1e-4));
  // bank: alarmed birds roll hard, everybody rolls a little with their own rhythm
  float h = hash11(fid * 0.713);
  float bank = alarm * 1.15 * (h > 0.5 ? 1.0 : -1.0) + 0.25 * sin(uTime * (0.6 + h) + h * 40.0);
  vec3 nrm = cross(dir, lat);
  vec3 latB = lat * cos(bank) + nrm * sin(bank);
  vec3 nrmB = cross(dir, latB);
  // wingbeats come in bursts between glides
  float phase = uTime * (11.0 + 3.0 * h) + h * 60.0;
  float glide = smoothstep(0.2, 0.6, sin(uTime * (0.8 + 0.5 * h) + h * 17.0));
  float flap = mix(sin(phase), 0.15, glide);
  float spanF = mix(0.55 + 0.45 * abs(cos(phase)), 1.0, glide);
  vec3 wingW = latB * span * 0.5 * spanF + nrmB * span * 0.18 * flap;
  vec3 bodyW = dir * span * 0.32;
  vWing = toPx(wingW, c.z);
  vBody = toPx(bodyW, c.z);
  float ppm = uFocal.y * 0.5 * uView.y / c.z;
  vec3 view = normalize(rel);
  float face = abs(dot(nrmB, view));
  float chord = span * 0.13 * ppm * (0.35 + 1.1 * face);
  vThick = max(chord, 0.75);
  float ext = max(length(vWing), length(vBody));
  vHalf = ext + vThick + 1.5;
  gl_PointSize = clamp(vHalf * 2.0, 2.0, 48.0);
  vHalf = gl_PointSize * 0.5;
  // energy for sub-pixel birds
  float area = (2.0 * length(vWing) + 0.5) * vThick;
  float a = clamp(area / 1.2, 0.25, 1.0) * uAlpha;
  float fog = 1.0 - exp(-c.z / uHazeD);
  vec3 col = mix(uBird, uHaze, fog * 0.85);
  if (uMirror < 0.0) a *= 0.8;
  if (uIsPred > 0.5) a = 1.0;
  vCol = vec4(col * a, a);
}
`;
export const BIRD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vWing;
in vec2 vBody;
in float vHalf;
in float vThick;
in vec4 vCol;
out vec4 o;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 q = (gl_PointCoord - 0.5) * vHalf * 2.0;
  q.y = -q.y;
  float dw = seg(q, -vWing, vWing) - vThick * 0.5;
  float db = seg(q, -vBody, vBody * 0.6) - vThick * 0.6;
  float d = min(dw, db);
  float a = clamp(0.6 - d, 0.0, 1.0);
  if (a <= 0.0) discard;
  o = vCol * a;
}
`;

// ------------------------------------------------------------------ sky, land, water
const NOISE1 = /* glsl */ `
float n1(float x) { float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), u); }
float f1(float x, int o) { float s = 0.0, a = 0.5, w = 0.0; for (int i = 0; i < 6; i++) { if (i >= o) break; s += a * n1(x); w += a; x = x * 2.03 + 17.1; a *= 0.5; } return s / w; }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float f2(vec2 p, int o) { float s = 0.0, a = 0.5, w = 0.0; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { if (i >= o) break; s += a * n2(p); w += a; p = m * p + 3.1; a *= 0.5; } return s / w; }
`;

export const SKY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform vec2 uView;
uniform vec3 uCamR, uCamU, uCamF;
uniform vec2 uFocal;
uniform float uCamH;
uniform float uTime;
uniform vec3 uHor, uLow, uMid, uHigh, uZen, uGlow, uAnti;
uniform vec3 uSun;
uniform float uGlowW, uGlowH, uGlowK;
uniform float uSunDisk;
uniform vec3 uSunCol;
uniform float uCloud;
uniform vec3 uCloudDark, uCloudLit;
uniform float uCloudH;
uniform vec2 uCloudDir;
uniform int uLand;
uniform vec3 uLandFar, uLandNear;
uniform vec3 uWater;
uniform float uMist;
uniform float uCalm;
uniform float uSeed;
uniform sampler2D uRefl;
${HASH}
${NOISE1}
const float D = 57.29578;

vec3 sky(vec3 rd, bool refl) {
  float deg = asin(clamp(rd.y, -1.0, 1.0)) * D;
  float e = max(deg, 0.0);
  vec3 c = uHor;
  c = mix(c, uLow, smoothstep(0.0, 3.5, e));
  c = mix(c, uMid, smoothstep(2.0, 10.0, e));
  c = mix(c, uHigh, smoothstep(7.0, 21.0, e));
  c = mix(c, uZen, smoothstep(17.0, 42.0, e));
  // afterglow over the set sun
  vec2 h = normalize(rd.xz + 1e-5);
  float az = dot(h, normalize(uSun.xz));
  float glow = exp(-(1.0 - az) * uGlowW) * exp(-e / uGlowH);
  c += uGlow * glow * uGlowK;
  // the anti-twilight arch opposite the sun
  float anti = exp(-(1.0 + az) * 2.5) * exp(-pow((e - 4.0) / 5.0, 2.0));
  c += uAnti * anti;
  // sun disk (smoke editions)
  if (uSunDisk > 0.0) {
    float a = acos(clamp(dot(rd, uSun), -1.0, 1.0)) * D;
    float px = 0.035 / uFocal.y * 1.0;
    c = mix(c, uSunCol, (1.0 - smoothstep(0.42, 0.46, a)) * uSunDisk);
    c += uSunCol * exp(-a * 1.2) * 0.25 * uSunDisk;
  }
  // thin cloud banks lit from beneath by the afterglow
  if (uCloud > 0.0 && deg > 0.15) {
    vec2 uv = rd.xz / max(rd.y, 0.012) * uCloudH;
    vec2 cd = uCloudDir;
    vec2 q = vec2(dot(uv, cd), dot(uv, vec2(-cd.y, cd.x)));
    float dist = length(uv);
    float k = 1.0 - smoothstep(4.0, 30.0, dist / uCloudH);
    float n = f2(q * vec2(0.09, 0.55) + vec2(uTime * 0.004, 0.0) + uSeed, 5);
    float n2v = f2(q * vec2(0.25, 1.4) + 9.0, 4);
    float dens = smoothstep(0.52, 0.72, n * 0.75 + n2v * 0.35) * uCloud;
    dens *= smoothstep(0.15, 3.0, deg);
    float lit = glow * 1.4 + 0.25 * smoothstep(20.0, 2.0, e);
    vec3 cc = mix(uCloudDark, uCloudLit, clamp(lit, 0.0, 1.0));
    cc = mix(cc, c, 1.0 - k);
    c = mix(c, cc, dens * 0.92);
  }
  // marsh mist sitting on the horizon
  c = mix(c, mix(uHor, uLow, 0.4) * 1.03, uMist * exp(-abs(deg) / 0.9) * 0.6);
  return c;
}

// silhouette heights (degrees) along azimuth
float land(float u, out float layer) {
  layer = 0.0;
  float h = 0.0;
  if (uLand == 0) {
    // flat reedbed with the odd clump of willow
    h = 0.12 + 0.09 * f1(u * 900.0 + uSeed, 3) + 0.05 * n1(u * 3000.0);
    float clump = smoothstep(0.62, 0.78, f1(u * 14.0 + uSeed * 0.7, 3));
    h += clump * (0.35 + 0.35 * f1(u * 160.0, 4));
  } else if (uLand == 1) {
    // a distant tree line
    float m = smoothstep(0.3, 0.6, f1(u * 6.0 + uSeed, 3));
    h = 0.14 + m * (0.42 + 0.3 * f1(u * 120.0 + 3.0, 4) + 0.12 * f1(u * 600.0, 2)) + 0.04 * n1(u * 2000.0);
  } else if (uLand == 2) {
    // low hills behind the levels
    float far = 0.5 + 2.8 * pow(f1(u * 3.2 + uSeed, 5), 1.5);
    float near = 0.18 + 0.1 * f1(u * 700.0, 2) + 0.35 * smoothstep(0.55, 0.8, f1(u * 10.0 + 5.0, 3)) * f1(u * 140.0, 3);
    layer = near;
    h = far;
  } else {
    // a windbreak of poplars along the levels
    h = 0.12 + 0.06 * f1(u * 900.0 + uSeed, 3);
    float cell = floor(u * 140.0);
    float fu = fract(u * 140.0);
    float on = step(0.42, hash11(cell + uSeed)) * smoothstep(0.5, 0.62, f1(cell * 0.04 + uSeed, 3));
    float ph = 0.9 + 1.1 * hash11(cell * 3.1 + 1.0);
    float w = 0.32 + 0.14 * hash11(cell + 7.0);
    float x = abs(fu - 0.5) / w;
    float shape = ph * sqrt(max(1.0 - pow(x, 1.6), 0.0)) * (0.9 + 0.1 * n1(u * 4000.0));
    h = max(h, on * shape);
    h = max(h, 0.25 * smoothstep(0.6, 0.8, f1(u * 20.0, 3)) * f1(u * 200.0, 3) + 0.12);
  }
  return h;
}

vec3 scene(vec3 rd, bool refl) {
  float deg = asin(clamp(rd.y, -1.0, 1.0)) * D;
  float u = atan(rd.x, rd.z);
  vec3 c = sky(rd, refl);
  float layer;
  float h = land(u, layer);
  if (deg < h && deg >= -0.02) {
    vec3 lc = uLandFar;
    if (uLand == 2) lc = mix(uLandFar, uHor, 0.16);
    lc = mix(lc, uHor, 0.18 * smoothstep(0.0, h, deg));
    c = lc;
  }
  if (uLand == 2 && deg < layer && deg >= -0.02) c = uLandFar;
  return c;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rc = vec3(ndc.x / uFocal.x, ndc.y / uFocal.y, 1.0);
  vec3 rd = normalize(uCamR * rc.x + uCamU * rc.y + uCamF * rc.z);
  vec3 col;
  if (rd.y >= 0.0) {
    col = scene(rd, false);
  } else {
    // water: a mirror roughened by wind ripples, calm in glassy streaks
    float t = uCamH / -rd.y;
    vec2 wp = rd.xz * t;
    float calm = smoothstep(0.35, 0.75, f2(vec2(wp.x * 0.004, wp.y * 0.03) + uSeed, 3));
    float amp = mix(1.0, 0.15, calm * uCalm);
    float pixA = 2.0 / (uFocal.y * uView.y);
    float fpm = t * pixA / max(-rd.y, 0.004);
    float tt = uTime * 0.35;
    // small ripples (fade once a pixel covers several of them) and longer swells
    vec2 rp = wp * vec2(0.35, 1.4);
    float e0 = f2(rp + vec2(0.0, tt), 3);
    vec2 sl = vec2(f2(rp + vec2(0.07, tt), 3) - e0, f2(rp + vec2(0.0, tt + 0.07), 3) - e0) / 0.07;
    sl *= 0.035 * exp(-fpm / 0.35);
    vec2 bp = wp * vec2(0.05, 0.2);
    float b0 = f2(bp + vec2(tt * 0.3, 0.0), 3);
    vec2 bl = vec2(f2(bp + vec2(0.05 + tt * 0.3, 0.0), 3) - b0, f2(bp + vec2(tt * 0.3, 0.05), 3) - b0) / 0.05;
    bl *= 0.012 * exp(-fpm / 4.0);
    vec2 slope = (sl + bl) * amp;
    float fd = exp(-t / 260.0);
    vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
    vec3 rr = reflect(rd, n);
    rr.y = max(rr.y, 0.0005);
    vec3 refl = scene(rr, true);
    float cosT = clamp(-rd.y, 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    F = mix(F, 1.0, 0.25);
    col = mix(uWater, refl, F);
    // reflected birds, smeared by the same ripples
    vec2 off = vec2(slope.x, -slope.y) * 0.35 * (0.3 + 0.7 * fd);
    vec4 rb = texture(uRefl, vUv + off);
    col = col * (1.0 - rb.a * F) + rb.rgb * F;
    // a whisper of mist over the water near the horizon
    col = mix(col, mix(uHor, uLow, 0.4), uMist * 0.5 * exp(-abs(asin(rd.y) * D) / 0.7));
  }
  o = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ composite: foreground reeds, grain
export const POST_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uView;
uniform float uTime;
uniform vec3 uReed, uReedRim;
uniform float uReeds;
uniform float uSeed;
uniform float uHorizonY;
${HASH}
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec3 col = texture(uScene, vUv).rgb;
  vec2 px = vUv * uView;
  float H = uView.y;
  float aspect = uView.x / uView.y;
  // reeds (Phragmites) rising from the bottom edge, thickest at the sides
  float cov = 0.0, rim = 0.0;
  vec2 P = vec2(vUv.x * aspect, vUv.y);
  float pxS = 1.0 / H;
  if (uReeds > 0.0 && vUv.y < 0.42) {
    for (int i = 0; i < 34; i++) {
      float fi = float(i);
      vec3 r = hash31(fi * 7.13 + uSeed);
      float side = r.x < 0.5 ? -1.0 : 1.0;
      float e = fract(r.x * 2.0);
      float x0 = side < 0.0 ? pow(e, 1.7) * 0.36 * aspect : aspect - pow(e, 1.7) * 0.36 * aspect;
      float edgeF = smoothstep(0.05 * aspect, 0.42 * aspect, abs(x0 - 0.5 * aspect));
      float hgt = (0.06 + 0.24 * r.y * r.y) * uReeds * mix(0.3, 1.0, edgeF);
      if (P.y > hgt + 0.08 || abs(P.x - x0) > 0.16) continue;
      float lean = (r.z - 0.5) * 0.22;
      float sw = sin(uTime * (0.45 + 0.3 * r.z) + fi * 1.7) * 0.025 + sin(uTime * 1.3 + fi) * 0.006;
      float bend = lean + sw;
      // stalk
      float yy = clamp(P.y, 0.0, hgt);
      float xs = x0 + bend * yy * yy / hgt;
      float w = (0.55 + 0.35 * r.z) * pxS * (1.0 - 0.45 * yy / hgt) + 0.25 * pxS;
      if (P.y <= hgt) cov = max(cov, clamp((w - abs(P.x - xs)) * H + 0.5, 0.0, 1.0));
      // plume: a soft, drooping panicle continuing the stalk
      vec2 tip = vec2(x0 + bend * hgt, hgt);
      vec2 d = normalize(vec2(2.0 * bend, 1.0));
      vec2 nperp = vec2(d.y, -d.x);
      vec2 rel = P - tip;
      float L = 0.03 + 0.035 * r.y;
      float a = dot(rel, d);
      float bq = dot(rel, nperp);
      float droop = (r.z > 0.5 ? 1.0 : -1.0) * (0.3 + sw * 4.0);
      float s = clamp((a + 0.2 * L) / (1.2 * L), 0.0, 1.0);
      float bc = droop * pow(max(a, 0.0) / L, 2.0) * L * 0.4;
      float hw = L * 0.13 * sin(3.14159 * pow(s, 0.75)) + 0.5 * pxS;
      if (a > -0.2 * L && a < L) {
        float fe = 0.55 + 0.45 * hash12(floor(P * H * 0.6) + fi);
        float pc = clamp((hw - abs(bq - bc)) * H * 0.5, 0.0, 1.0) * fe * 0.85;
        cov = max(cov, pc);
        rim = max(rim, pc * (1.0 - pc));
      }
      // a long leaf blade, arching out and drooping
      if (r.y > 0.3) {
        float yl = hgt * (0.25 + 0.3 * r.x);
        vec2 B = vec2(x0 + bend * yl * yl / hgt, yl);
        float ls = (fract(r.y * 7.0) > 0.5 ? 1.0 : -1.0);
        float Ll = 0.05 + 0.06 * fract(r.z * 5.0);
        vec2 C = B + Ll * vec2(ls * 0.3 + sw * 0.5, 0.75);
        vec2 E = B + Ll * vec2(ls * 0.95 + sw, 0.35);
        float dl = 1e3, tl = 0.0;
        vec2 prev = B;
        for (int k = 1; k <= 4; k++) {
          float tk = float(k) / 4.0;
          vec2 q = mix(mix(B, C, tk), mix(C, E, tk), tk);
          float dk = seg(P, prev, q);
          if (dk < dl) { dl = dk; tl = tk; }
          prev = q;
        }
        float wl = (1.5 * (1.0 - tl) + 0.3) * pxS;
        cov = max(cov, clamp((wl - dl) * H + 0.5, 0.0, 1.0));
      }
    }
  }
  col = mix(col, uReed, cov);
  col += uReedRim * rim * 0.25;
  // vignette and grain
  vec2 d = vUv - 0.5;
  col *= 1.0 - 0.28 * dot(d * vec2(1.0, 0.8), d * vec2(1.0, 0.8)) * 1.8;
  float g1 = hash12(px + fract(uTime * 17.3) * 431.0);
  float g2 = hash12(px * 1.13 + fract(uTime * 9.1) * 211.0);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += (g1 + g2 - 1.0) * (1.6 / 255.0 + 0.03 * lum * (1.0 - lum));
  o = vec4(col, 1.0);
}
`;
