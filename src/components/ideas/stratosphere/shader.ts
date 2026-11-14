// Stratosphere: single-scattering atmosphere (Rayleigh + Mie + ozone absorption),
// a spherical Earth, procedural cloud decks, ocean glint, airglow and stars.
// Units are kilometres. The Earth's centre is the origin, the camera sits at (0, R + alt, 0).

export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamR, uCamU, uCamF;
uniform float uHalfFov;
uniform float uFish;
uniform vec3 uSun;
uniform float uRc;
uniform float uExposure;
uniform float uMie;
uniform float uMieG;
uniform int uType;        // 0 cumulus, 1 stratocumulus sheet, 2 storm
uniform int uHigh;        // 0 none, 2 anvils
uniform float uThr;
uniform float uLowAlt;
uniform float uHighAlt;
uniform float uScale;     // low cloud base frequency (1/km)
uniform vec2 uWind;
uniform float uStretch;
uniform vec2 uOff;
uniform vec4 uStormA;     // xy centre (km, world xz), z radius, w strength
uniform vec4 uStormB;
uniform int uSurf;        // 0 ocean, 1 land
uniform vec3 uLandA, uLandB, uLandC;
uniform float uRough;
uniform float uCity;
uniform float uAirglow;
uniform float uStars;
uniform float uMilky;
uniform vec3 uMilkyN;
uniform vec4 uFlash;      // xy km (world xz), z intensity, w radius km
uniform float uGlare;
uniform float uSeed;
uniform float uMoon;

const float R = 6371.0;
const float RA = 6471.0;
const vec3 BR = vec3(5.802, 13.558, 33.1) * 1e-3;
const vec3 BO = vec3(0.650, 1.881, 0.085) * 1e-3;
const float BMS = 3.996e-3;
const float BMA = 4.40e-3;
const float HR = 8.0;
const float HM = 1.2;
const float PI = 3.14159265;
const float LN2 = 0.69314718;

float gPhR, gPhM;

// ---------------------------------------------------------------- noise
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
// fbm with footprint-aware octave fading (fp = pixel footprint in noise units)
float fbm(vec2 p, float fp, int oct) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int i = 0; i < 7; i++) {
    if (i >= oct) break;
    float k = 1.0 - smoothstep(0.18, 0.55, fp);
    s += a * mix(0.5, vnoise(p), k);
    w += a;
    p = ROT * p + 3.7;
    fp *= 2.0;
    a *= 0.5;
  }
  return s / w;
}
// "billowy" fbm used for cauliflower cloud tops
float bfbm(vec2 p, float fp, int oct) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    float k = 1.0 - smoothstep(0.18, 0.55, fp);
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    s += a * mix(0.6, n, k);
    w += a;
    p = ROT * p - 1.3;
    fp *= 2.0;
    a *= 0.5;
  }
  return s / w;
}
// cellular (worley F1, F2) for stratocumulus cells
vec2 worley(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash12(i + g), hash12(i + g + 17.1)) * 0.85 + 0.075;
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}

// ---------------------------------------------------------------- atmosphere
// Schuler's approximation to the Chapman grazing-incidence function, in half-height units.
float chap(float X, float h, float mu) {
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp2(-h);
  float x0 = sqrt(max(1.0 - mu * mu, 0.0)) * (X + h);
  float c0 = sqrt(x0);
  return max(2.0 * c0 * exp2(min(X - x0, 0.0)) - c / (1.0 - c * mu) * exp2(-h), 0.0);
}
float lenInBall(float r, float mu, float rb) {
  float b = r * mu;
  float c = (r - rb) * (r + rb);
  float d = b * b - c;
  if (d <= 0.0) return 0.0;
  d = sqrt(d);
  return max(-b + d - max(-b - d, 0.0), 0.0);
}
vec3 sunOD(float r, float mu) {
  float h = max(r - R, 0.0);
  float odR = HR * chap(R / (HR * LN2), h / (HR * LN2), mu);
  float odM = HM * chap(R / (HM * LN2), h / (HM * LN2), mu);
  float odO = 0.5 * (lenInBall(r, mu, R + 40.0) - lenInBall(r, mu, R + 10.0));
  return vec3(odR, odM, odO);
}
float sunVis(float r, float mu) {
  if (mu >= 0.0) return 1.0;
  float rt = r * sqrt(max(1.0 - mu * mu, 0.0));
  return smoothstep(-2.0, 2.5, rt - R);
}
vec3 trans(vec3 od) {
  return exp(-(BR * od.x + (BMS + BMA) * uMie * od.y + BO * od.z));
}
vec3 dens(float h) {
  return vec3(exp(-h / HR), exp(-h / HM), max(0.0, 1.0 - abs(h - 25.0) / 15.0));
}
// sun irradiance (unit at top of atmosphere) reaching point p
vec3 sunAt(vec3 p) {
  float r = length(p);
  float mu = dot(p, uSun) / r;
  float v = sunVis(r, mu);
  if (v <= 0.0) return vec3(0.0);
  return v * trans(sunOD(r, mu));
}
// cheap stand-in for multiple scattering: skylight on a horizontal surface at p
vec3 skyAt(vec3 p) {
  float mu = dot(normalize(p), uSun);
  vec3 day = vec3(0.30, 0.48, 0.95) * 0.11 * smoothstep(-0.02, 0.45, mu);
  vec3 dusk = vec3(0.4, 0.38, 0.66) * 0.035 * smoothstep(-0.32, 0.0, mu) * (1.0 - smoothstep(0.0, 0.25, mu));
  vec3 night = vec3(0.22, 0.3, 0.5) * 0.0004 * uAirglow;
  return day + dusk + night;
}

void marchSeg(vec3 ro, vec3 rd, float t0, float t1, bool denseEnd, int n, inout vec3 od, inout vec3 L) {
  float len = t1 - t0;
  if (len <= 0.0 || n <= 0) return;
  float fn = float(n);
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float u = (float(i) + 0.5) / fn;
    float s, ds;
    if (denseEnd) { s = 1.0 - (1.0 - u) * (1.0 - u); ds = 2.0 * (1.0 - u); }
    else { s = u * u; ds = 2.0 * u; }
    float t = t0 + len * s;
    float dt = len * ds / fn;
    vec3 p = ro + rd * t;
    float r = length(p);
    vec3 d = dens(r - R);
    vec3 odS = od + d * dt * 0.5;
    float mu = dot(p, uSun) / r;
    float v = sunVis(r, mu);
    if (v > 0.0) {
      vec3 T = trans(odS + sunOD(r, mu));
      L += v * T * (BR * d.x * gPhR + BMS * uMie * d.y * gPhM) * dt;
    }
    od += d * dt;
  }
}
// march [t0,t1], concentrating samples around tc (the closest approach to the Earth)
void march(vec3 ro, vec3 rd, float t0, float t1, float tc, int n, inout vec3 od, inout vec3 L) {
  if (t1 <= t0) return;
  if (tc <= t0 + 1e-3) marchSeg(ro, rd, t0, t1, false, n, od, L);
  else if (tc >= t1 - 1e-3) marchSeg(ro, rd, t0, t1, true, n, od, L);
  else {
    int na = max(2, n / 2);
    marchSeg(ro, rd, t0, tc, true, na, od, L);
    marchSeg(ro, rd, tc, t1, false, n - na, od, L);
  }
}

// ---------------------------------------------------------------- clouds
vec2 windFrame(vec2 uv) {
  vec2 w = uWind;
  vec2 q = vec2(dot(uv, w), dot(uv, vec2(-w.y, w.x)));
  return q;
}
float stormMask(vec2 x) {
  vec2 a = (x - uStormA.xy) / uStormA.z;
  vec2 b = (x - uStormB.xy) / uStormB.z;
  return uStormA.w * exp(-dot(a, a)) + uStormB.w * exp(-dot(b, b));
}
// low cloud deck. returns (coverage, relief 0..1)
vec2 lowCloud(vec2 x, float fpKm, int oct) {
  vec2 uv = x + uOff;
  vec2 q = windFrame(uv) * uScale;
  q.x /= uStretch;
  float fp = fpKm * uScale;
  float tt = uTime * 0.004;
  if (uType == 1) {
    // stratocumulus: broad closed cells (mesoscale convection) with soft seams and fluffy texture
    vec2 w = vec2(fbm(q * 0.06 + tt, fp * 0.06, 3), fbm(q * 0.06 + 7.3 - tt, fp * 0.06, 3));
    vec2 c = worley(q * 0.22 + w * 1.4);
    float k = 1.0 - smoothstep(0.2, 0.7, fp * 0.22);
    float brk = fbm(q * 0.9 + 4.0, fp * 0.9, 3);
    float gap = mix(smoothstep(0.0, 0.55, c.y - c.x), 1.0, smoothstep(0.45, 0.75, brk) * 0.8);
    float dome = 1.0 - smoothstep(0.0, 0.9, c.x * c.x * 1.4);
    float detail = bfbm(q * 1.4 + w * 2.0, fp * 1.4, oct);
    float fine = fbm(q * 4.0 + w, fp * 4.0, 3);
    float big = fbm(q * 0.035 + 11.0, fp * 0.035, 4);
    float body = mix(0.78, 0.58 + 0.42 * gap, k) * (0.7 + 0.45 * detail) + (fine - 0.5) * 0.12;
    float holes = smoothstep(uThr - 0.08, uThr + 0.08, big);
    float cov = smoothstep(0.32, 0.6, body) * holes;
    return vec2(cov, cov * (mix(0.5, 0.3 + 0.5 * dome * gap, k) + 0.35 * detail));
  }
  vec2 w = vec2(fbm(q * 0.33 + vec2(tt, 0.0), fp * 0.33, 3), fbm(q * 0.33 + vec2(5.2, 1.3 - tt), fp * 0.33, 3));
  float cl = fbm(q * 0.3 + w * 0.8 + 2.0, fp * 0.3, 4);
  vec2 c = worley(q * 1.9 + w * 1.6);
  float k = 1.0 - smoothstep(0.2, 0.7, fp * 1.9);
  float dome = 1.0 - smoothstep(0.0, 1.0, c.x * c.x * 1.6);
  float puff = mix(0.5, dome, k);
  float det = bfbm(q * 2.7 + w, fp * 2.7, max(oct - 1, 1));
  float d = cl * 0.6 + puff * 0.4 + (det - 0.6) * 0.26;
  float big = fbm(q * 0.06 + 3.1, fp * 0.06, 3);
  float thr = uThr + (0.5 - big) * 0.2;
  if (uType == 2) thr += 0.06 - 0.25 * stormMask(x);
  float edge = 0.1 + clamp(fp * 0.25, 0.0, 0.3);
  float cov = smoothstep(thr - edge * 0.3, thr + edge, d);
  float relief = clamp((d - thr) / 0.2, 0.0, 1.0) * (0.55 + 0.45 * puff) + (det - 0.6) * 0.35;
  return vec2(cov, relief);
}
// high layer: anvils over the storm cells. returns (alpha, relief)
vec2 highCloud(vec2 x, float fpKm) {
  vec2 uv = x + uOff * 1.3;
  vec2 q = windFrame(uv);
  // anvils: broad, flat, sharp-edged, smeared downwind
  float m = stormMask(x);
  vec2 p = q * vec2(0.035, 0.06);
  float fp = fpKm * 0.06;
  float n = fbm(p + 1.7, fp, 6);
  float shape = m + (n - 0.5) * 0.9;
  float fib = fbm(q * vec2(0.05, 0.6) + n * 3.0, fpKm * 0.6, 5);
  float edge = 0.04 + clamp(fpKm * 0.01, 0.0, 0.2);
  float a = smoothstep(0.43, 0.5 + edge, shape + (fib - 0.5) * 0.3);
  // overshooting tops: billows near the cores
  float core = smoothstep(0.7, 1.1, m);
  float tur = bfbm(q * 0.12 + n, fpKm * 0.12, 5);
  float tex = bfbm(q * vec2(0.25, 0.5) + n * 2.0, fpKm * 0.5, 4);
  float relief = clamp(shape - 0.45, 0.0, 1.0) * 0.7 + tur * (0.25 + core * 1.1) + (tex - 0.6) * 0.4;
  return vec2(a, relief);
}

// ---------------------------------------------------------------- surfaces
vec3 shadeLow(vec3 p, vec3 rd, float t, float fpKm, out float alpha) {
  vec3 n = p / length(p);
  vec2 x = p.xz;
  vec2 c0 = lowCloud(x, fpKm, 5);
  alpha = c0.x;
  if (alpha < 0.002) return vec3(0.0);
  vec3 sunL = sunAt(p + n * 0.6);
  vec3 sky = skyAt(p);
  float mu = dot(n, uSun);
  vec3 sh = uSun - n * mu;
  float shl = length(sh);
  vec2 sH = shl > 1e-4 ? normalize(vec2(sh.x, sh.z)) : vec2(1.0, 0.0);
  float lit = 0.0;
  if (dot(sunL, vec3(1.0)) > 1e-4) {
    float stepKm = 0.35 / uScale * 0.35;
    float c1 = lowCloud(x + sH * stepKm, fpKm, 5).y;
    float elev = max(mu, 0.02);
    float L2 = clamp(0.9 * (1.0 / uScale) * 0.25 / elev, 0.4, 9.0);
    float c2 = lowCloud(x + sH * L2, fpKm, 3).y;
    float slope = (c0.y - c1);
    float k = 1.6 / (elev + 0.12);
    float relief = clamp(1.0 + slope * k, 0.12, 1.9) * (0.8 + 0.25 * c0.y);
    float shadow = 1.0 - smoothstep(0.05, 0.5, c2 - c0.y - elev * 0.6) * 0.8;
    if (uHigh == 2) {
      float off = min((uHighAlt - uLowAlt) / elev, 80.0);
      shadow *= 1.0 - 0.85 * highCloud(x + sH * off, fpKm).x;
    }
    lit = pow(max(mu, 0.0) + 0.02, 0.55) * relief * shadow;
  }
  vec3 alb = vec3(0.92);
  vec3 L = alb / PI * (sunL * lit + sky * (0.55 + 0.45 * c0.y));
  // city light diffusing up through the deck at night
  if (uCity > 0.0 && uSurf == 1) {
    vec2 uv = x + uOff;
    float m = smoothstep(0.52, 0.78, fbm(uv * 0.012, fpKm * 0.012, 3));
    L += vec3(1.0, 0.55, 0.25) * m * uCity * 0.012 / uExposure * (1.2 - c0.y);
  }
  if (uFlash.z > 0.0) {
    vec2 dd = x - uFlash.xy;
    float g = exp(-dot(dd, dd) / (uFlash.w * uFlash.w));
    L += vec3(0.7, 0.78, 1.0) * uFlash.z * g * (0.4 + 0.6 * c0.y);
  }
  return L;
}
vec3 shadeHigh(vec3 p, vec3 rd, float fpKm, out float alpha) {
  vec3 n = p / length(p);
  vec2 x = p.xz;
  vec2 c0 = highCloud(x, fpKm);
  alpha = c0.x;
  if (alpha < 0.002) return vec3(0.0);
  vec3 sunL = sunAt(p);
  vec3 sky = skyAt(p) * 0.8;
  float mu = dot(n, uSun);
  float elev = max(mu, 0.02);
  vec3 L;
  {
    vec3 sh = uSun - n * mu;
    vec2 sH = length(sh) > 1e-4 ? normalize(vec2(sh.x, sh.z)) : vec2(1.0, 0.0);
    float c1 = highCloud(x + sH * 1.2, fpKm).y;
    float cb = highCloud(x + sH * 7.0, fpKm).y;
    float L2 = clamp(2.0 / elev, 1.0, 40.0);
    float c2 = highCloud(x + sH * L2, fpKm).y;
    float relief = clamp(1.0 + (c0.y - c1) * 2.2 / (elev + 0.1) + (c0.y - cb) * 1.2 / (elev + 0.1), 0.12, 2.0);
    float shadow = 1.0 - smoothstep(0.02, 0.35, c2 - c0.y - elev * 1.5) * 0.85;
    L = vec3(0.95) / PI * (sunL * pow(elev, 0.5) * relief * shadow + sky);
    if (uFlash.z > 0.0) {
      vec2 dd = x - uFlash.xy;
      L += vec3(0.7, 0.78, 1.0) * uFlash.z * 0.35 * exp(-dot(dd, dd) / (uFlash.w * uFlash.w * 2.0));
    }
  }
  return L;
}
vec3 shadeGround(vec3 p, vec3 rd, float t, float fpKm) {
  vec3 n = p / length(p);
  vec2 x = p.xz;
  vec2 uv = x + uOff;
  vec3 sunL = sunAt(p + n * 0.05);
  vec3 sky = skyAt(p);
  float mu = dot(n, uSun);
  // cloud shadow on the ground
  float cs = 1.0;
  if (mu > 0.0 && dot(sunL, vec3(1.0)) > 1e-3) {
    vec3 sh = uSun - n * mu;
    vec2 sH = length(sh) > 1e-4 ? normalize(vec2(sh.x, sh.z)) : vec2(1.0, 0.0);
    float off = min(uLowAlt / max(mu, 0.05) * sqrt(max(1.0 - mu * mu, 0.0)), 40.0);
    cs = 1.0 - 0.8 * lowCloud(x + sH * off, fpKm, 3).x;
  }
  vec3 L;
  if (uSurf == 0) {
    float nv = max(-dot(rd, n), 0.02);
    vec3 h = normalize(uSun - rd);
    float nh = max(dot(n, h), 0.0);
    float slick = fbm(uv * 0.03, fpKm * 0.03, 4);
    float a = uRough * (0.55 + 0.9 * slick);
    float a2 = a * a;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(h, -rd), 0.0), 5.0);
    float spec = D * F / (4.0 * nv) * smoothstep(0.0, 0.02, mu);
    vec3 water = vec3(0.004, 0.018, 0.034);
    float Fs = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
    L = water * (sunL * max(mu, 0.0) + sky) * 2.0 + sunL * spec * cs + sky * Fs * 0.6;
    L += water * sunL * max(mu, 0.0) * cs;
  } else {
    float f1 = fbm(uv * 0.018, fpKm * 0.018, 6);
    float f2 = fbm(uv * 0.11 + 4.0, fpKm * 0.11, 5);
    vec3 alb = mix(uLandA, uLandB, smoothstep(0.35, 0.7, f1));
    alb = mix(alb, uLandC, smoothstep(0.55, 0.85, f2) * 0.6);
    float lake = smoothstep(0.66, 0.7, fbm(uv * 0.05 + 9.0, fpKm * 0.05, 5));
    alb = mix(alb, vec3(0.01, 0.02, 0.03), lake);
    L = alb / PI * (sunL * max(mu, 0.0) * cs + sky);
    float a = 0.08; float a2 = a * a;
    vec3 h = normalize(uSun - rd);
    float nh = max(dot(n, h), 0.0);
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    L += lake * sunL * a2 / (PI * dd * dd) * 0.02 / max(-dot(rd, n), 0.05) * smoothstep(0.0, 0.02, mu) * cs;
    if (uCity > 0.0) {
      float metro = smoothstep(0.54, 0.8, fbm(uv * 0.011, fpKm * 0.011, 4));
      float towns = smoothstep(0.66, 0.8, fbm(uv * 0.06 + 5.0, fpKm * 0.06, 4)) * 0.55;
      float grain = fbm(uv * 0.35 + 2.0, fpKm * 0.35, 4);
      float dens = max(metro, towns) * smoothstep(0.3, 0.66, grain) * 0.95 + 0.012;
      // individual lights: one candidate per 0.5 km cell
      vec2 cu = uv / 0.5;
      vec2 ci = floor(cu);
      vec2 cf = fract(cu);
      float hh = hash12(ci);
      vec2 o = vec2(hash12(ci + 3.1), hash12(ci + 7.7)) * 0.6 + 0.2;
      vec2 dd = cf - o;
      float on = step(1.0 - clamp(dens * 1.4, 0.0, 0.95), hh);
      float pt = exp(-dot(dd, dd) * 40.0) * (0.5 + hash12(ci + 1.3));
      float k = 1.0 - smoothstep(0.08, 0.35, fpKm);
      float lights = mix(dens * 0.09, on * pt, k) * 2.4 + metro * metro * smoothstep(0.5, 0.85, grain) * 0.08;
      vec3 lc = mix(vec3(1.0, 0.5, 0.16), vec3(1.0, 0.85, 0.65), hash12(ci + 9.0) * 0.7);
      L += lc * lights * uCity * 0.8 / uExposure * (1.0 - lake);
    }
  }
  return L;
}

// ---------------------------------------------------------------- sky extras
vec3 stars(vec3 rd, float pixAng) {
  float cell = 0.0055;
  vec3 g = rd / cell;
  vec3 id = floor(g);
  vec3 h3 = hash33(id);
  if (h3.x > 0.16) return vec3(0.0);
  vec3 c = (id + 0.5 + (hash33(id + 11.0) - 0.5) * 0.4) * cell;
  vec3 dir = normalize(c);
  float d = length(rd - dir * dot(rd, dir));
  float sig = max(pixAng * 0.65, cell * 0.06);
  float mag = pow(h3.y, 16.0);
  float psf = exp(-d * d / (2.0 * sig * sig));
  vec3 tint = mix(vec3(1.0, 0.78, 0.6), vec3(0.72, 0.82, 1.0), h3.z);
  tint = mix(vec3(1.0), tint, 0.6);
  return tint * psf * mag * (pixAng * pixAng) / (sig * sig) * 1.0;
}
vec3 milky(vec3 rd) {
  float b = dot(rd, uMilkyN);
  float band = exp(-b * b / 0.02);
  float n = vnoise3(rd * 9.0 + 3.0) * 0.45 + vnoise3(rd * 23.0) * 0.3 + vnoise3(rd * 61.0) * 0.25;
  float rift = smoothstep(0.45, 0.8, vnoise3(rd * 14.0 + 7.0) * 0.55 + vnoise3(rd * 37.0) * 0.45);
  float core = exp(-b * b / 0.005);
  vec3 col = mix(vec3(0.6, 0.66, 0.85), vec3(0.95, 0.86, 0.74), core);
  return col * band * pow(n, 1.6) * (1.0 - 0.8 * rift * (0.3 + 0.7 * core));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float md = max(uRes.x, uRes.y);
  vec2 q = (fc - 0.5 * uRes) / (0.5 * md);
  float rq = length(q);
  float th = mix(atan(rq * tan(uHalfFov)), rq * uHalfFov, uFish);
  vec2 dq = rq > 1e-6 ? q / rq : vec2(0.0);
  vec3 rdc = vec3(sin(th) * dq, cos(th));
  vec3 rd = normalize(uCamR * rdc.x + uCamU * rdc.y + uCamF * rdc.z);
  float pixAng = uHalfFov / (0.5 * md);

  vec3 ro = vec3(0.0, uRc, 0.0);
  float b = uRc * rd.y;
  float cosT = dot(rd, uSun);
  gPhR = 3.0 / (16.0 * PI) * (1.0 + cosT * cosT);
  float g = uMieG;
  gPhM = 3.0 / (8.0 * PI) * (1.0 - g * g) * (1.0 + cosT * cosT) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));

  float cG = (uRc - R) * (uRc + R);
  float dG = b * b - cG;
  bool hitG = dG > 0.0 && b < 0.0;
  float tG = hitG ? (-b - sqrt(dG)) : 1e9;
  float cA = (uRc - RA) * (uRc + RA);
  float tA = -b + sqrt(max(b * b - cA, 0.0));
  float tEnd = hitG ? tG : tA;
  float tc = clamp(-b, 0.0, tEnd);

  vec3 od = vec3(0.0);
  vec3 col = vec3(0.0);
  float vis = 1.0;
  float tPrev = 0.0;
  int nFirst = 18;

  // high layer
  if (uHigh > 0) {
    float rh = R + uHighAlt;
    float cH = (uRc - rh) * (uRc + rh);
    float dH = b * b - cH;
    if (dH > 0.0 && b < 0.0) {
      float tH = -b - sqrt(dH);
      vec3 Ls = vec3(0.0);
      march(ro, rd, 0.0, tH, tc, nFirst, od, Ls);
      col += Ls;
      nFirst = 6;
      tPrev = tH;
      vec3 p = ro + rd * tH;
      float cosI = max(-dot(rd, p / length(p)), 0.03);
      float fp = pixAng * tH / cosI;
      float a;
      vec3 Lc = shadeHigh(p, rd, fp, a);
      col += vis * a * trans(od) * Lc;
      vis *= 1.0 - a;
    }
  }
  // low layer
  float rl = R + uLowAlt;
  float cL = (uRc - rl) * (uRc + rl);
  float dL = b * b - cL;
  if (vis > 0.004 && dL > 0.0 && b < 0.0) {
    float tL = -b - sqrt(dL);
    vec3 Ls = vec3(0.0);
    march(ro, rd, tPrev, tL, tc, nFirst, od, Ls);
    col += vis * Ls;
    nFirst = 6;
    tPrev = tL;
    vec3 p = ro + rd * tL;
    float cosI = max(-dot(rd, p / length(p)), 0.03);
    float fp = pixAng * tL / cosI;
    float a;
    vec3 Lc = shadeLow(p, rd, tL, fp, a);
    col += vis * a * trans(od) * Lc;
    vis *= 1.0 - a;
  }
  if (vis > 0.004) {
    vec3 Ls = vec3(0.0);
    march(ro, rd, tPrev, tEnd, tc, nFirst, od, Ls);
    col += vis * Ls;
    vec3 T = trans(od);
    if (hitG) {
      vec3 p = ro + rd * tG;
      float cosI = max(-dot(rd, p / length(p)), 0.03);
      float fp = pixAng * tG / cosI;
      col += vis * T * shadeGround(p, rd, tG, fp);
    } else {
      // sun disk
      float sd = acos(clamp(cosT, -1.0, 1.0));
      float rs = 0.00465;
      float disk = 1.0 - smoothstep(rs - pixAng * 0.7, rs + pixAng * 0.7, sd);
      float limbD = sqrt(max(1.0 - (sd * sd) / (rs * rs), 0.0));
      col += vis * T * disk * (0.45 + 0.55 * limbD) * 18000.0;
      // stars and the galaxy, through whatever air is left
      vec3 sky = (stars(rd, pixAng) * uStars + milky(rd) * uMilky) / uExposure;
      col += vis * T * sky;
      // airglow: emission column through the 85-105 km shell (the far side, past all the air)
      // airglow: a thin emission line hugging the limb, plus its faint diffuse skirt
      float elevL = asin(clamp(rd.y, -1.0, 1.0)) + acos(R / uRc);
      float x = (elevL - 0.022) / 0.0075;
      vec3 ag = vec3(0.3, 1.0, 0.42) * (exp(-x * x) * 0.002 + exp(-max(elevL, 0.0) / 0.06) * 0.00018)
              + vec3(1.0, 0.3, 0.25) * exp(-pow((elevL - 0.05) / 0.025, 2.0)) * 0.00012;
      col += vis * T * ag * uAirglow;
    }
  }

  // veiling glare from a sun just in or just out of frame
  vec3 sunCam = sunVis(uRc, uSun.y) * trans(sunOD(uRc, uSun.y));
  float ang = acos(clamp(cosT, -1.0, 1.0));
  float gl = 0.00012 / (ang * ang + 0.00006) + 0.0045 / (ang + 0.012) * 0.25 + 0.06 * exp(-ang * 5.0);
  col += sunCam * gl * uGlare;

  // moonlit editions: scotopic shift toward a desaturated blue
  float ly = dot(col, vec3(0.2, 0.7, 0.1));
  col = mix(col, ly * vec3(0.72, 0.86, 1.2), uMoon * 0.7);
  col *= uExposure;
  // gentle lens falloff
  col *= 1.0 - 0.22 * rq * rq;
  vec3 m = aces(col);
  m = pow(m, vec3(1.0 / 2.2));
  // grain + dither
  float n1 = hash12(fc + fract(uTime * 13.17) * 517.0);
  float n2 = hash12(fc * 1.37 + fract(uTime * 7.31) * 311.0);
  float lum = dot(m, vec3(0.299, 0.587, 0.114));
  m += (n1 + n2 - 1.0) * (1.5 / 255.0 + 0.018 * lum * (1.0 - lum));
  fragColor = vec4(m, 1.0);
}
`;
