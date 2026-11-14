// Aurora: a raymarched auroral display over a dark, snowy landscape.
//
// Pass 1 (low resolution, temporally accumulated): the sky. For every view
// direction we march through the emitting layer of the upper atmosphere
// (90-420 km, with Earth's curvature) and integrate the emission of a few
// field-aligned curtains. Each curtain is a thin, noise-displaced sheet whose
// footprint follows the magnetic field lines (slightly tilted from vertical),
// with ray striations along its length. Emission follows the real lines:
// oxygen 557.7 nm green just above the sharp lower border (~100-120 km),
// oxygen 630 nm red diffuse and high (200 km+), an N2 pink/violet fringe at
// the lower edge in active displays, and violet N2+ on sunlit ray tops.
// Directions below the horizon store the mirrored sky for the lake.
//
// Pass 2 (full resolution): stars, landscape silhouettes, the frozen lake's
// reflection, snow lit by the average sky radiance, tone mapping and grain.

import { mulberry32 } from './edition';

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
uint hu(uint x){ x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(float i){ return float(hu(uint(int(i) + 1048576))) * (1.0/4294967296.0); }
float n1(float x){ float i = floor(x); float f = x - i; f = f*f*(3.0-2.0*f); return mix(hf(i), hf(i+1.0), f); }
float h3(vec3 i){ uvec3 q = uvec3(ivec3(i) + 65536); return float(hu(q.x ^ hu(q.y ^ hu(q.z)))) * (1.0/4294967296.0); }
float n3(vec3 p){
  vec3 i = floor(p); vec3 f = p - i; f = f*f*(3.0-2.0*f);
  float a = mix(h3(i), h3(i+vec3(1,0,0)), f.x);
  float b = mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x);
  float c = mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x);
  float d = mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x);
  return mix(mix(a,b,f.y), mix(c,d,f.y), f.z);
}
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*n3(p); p = p*2.03 + 1.7; a *= 0.5; } return s/0.9375; }
float fbm1(float x){ float s = 0.0, a = 0.5; for(int i=0;i<5;i++){ s += a*n1(x); x = x*2.07 + 3.1; a *= 0.5; } return s/0.96875; }
`;

const SKY_FRAG = COMMON + `
uniform vec2 uRes;
uniform float uTime;
uniform float uFrame;
uniform sampler2D uPrev;
uniform float uBlend;
uniform vec3 uFwd, uRight, uUp;
uniform vec2 uTan;
uniform int uN;
uniform vec4 uCA[4]; // Z, A1, k1, phase
uniform vec4 uCB[4]; // A2, k2, A3, k3
uniform vec4 uCC[4]; // width, brightness, rayStrength, rayFreq
uniform vec4 uCD[4]; // lowerEdge, greenScale, envFreq, envMin
uniform vec4 uCE[4]; // surgeVel, surgePhase, surgeAmp, rayDrift
uniform float uTilt;
uniform vec3 uGreen, uRed, uFringe, uTop;
uniform vec3 uAmt;   // red, fringe, sunlit top
uniform vec3 uSkyZen, uSkyHor, uAirglow;
uniform mat3 uStarRot;
uniform vec3 uGalN, uGalC;
uniform float uMilky;
uniform vec3 uExt;
uniform float uEnc;
out vec4 o;

float curveZ(int i, float s, float t){
  vec4 a = uCA[i]; vec4 b = uCB[i];
  float fi = float(i);
  return a.x + a.y*sin(s*a.z + a.w + t*0.017)
       + b.x*(n1(s*b.y + t*0.030 + fi*17.0)*2.0 - 1.0)
       + b.z*(n1(s*b.w - t*0.055 + fi*31.0)*2.0 - 1.0);
}
float rays(float x){
  float r = n1(x)*0.5 + n1(x*2.7 + 3.1)*0.32 + n1(x*7.9 + 9.0)*0.18;
  return pow(r, 2.4) * 2.6;
}

vec3 emit(vec3 p, float t, out float dm){
  float h = p.y + dot(p.xz, p.xz) * (1.0/127.4);   // altitude above a curved Earth (R = 6370 km)
  vec2 q = vec2(p.x, p.z - uTilt*h);               // follow the inclined field line down to its footprint
  vec3 c = vec3(0.0);
  dm = 1e3;
  for (int i = 0; i < 4; i++) {
    if (i >= uN) break;
    float fi = float(i);
    float s = q.x;
    float f = curveZ(i, s, t);
    float fp = (curveZ(i, s + 0.03, t) - f) / 0.03;
    float d = (q.y - f) * inversesqrt(1.0 + fp*fp);
    vec4 cc = uCC[i]; vec4 cd = uCD[i]; vec4 ce = uCE[i];
    float w = cc.x * (0.65 + 0.7*n1(s*1.9 + t*0.04 + fi*7.0));
    float ad = abs(d);
    dm = min(dm, ad - 2.6*w);
    float sheet = exp(-d*d/(w*w)) + 0.05*exp(-ad/(w*9.0));
    float wide = exp(-d*d/(9.0*w*w)) + 0.015*exp(-ad/(w*16.0));
    if (wide < 0.003) continue;
    float rr = rays(s*cc.w + t*ce.w);
    float lum = mix(1.0, rr, cc.z);
    float env = mix(cd.w, 1.0, smoothstep(0.2, 0.75, n1(s*cd.z + fi*5.3 + t*0.008)));
    float sp = mod(t*ce.x + ce.y, 56.0) - 28.0;
    float surge = 1.0 + ce.z*exp(-(s - sp)*(s - sp)*0.35);
    float hb = cd.x + 0.09*(n1(s*1.1 + t*0.025 + fi*3.0) - 0.5) - 0.11*cc.z*(rr - 0.6);
    float x = h - hb;
    float hg = cd.y * (0.5 + 0.8*lum);
    float green = smoothstep(-0.03, 0.07, x) * exp(-max(x - 0.03, 0.0)/hg);
    float red = smoothstep(0.5, 1.4, x) * exp(-max(x - 1.4, 0.0)/1.3);
    float top = smoothstep(0.45, 1.25, x) * exp(-max(x - 1.25, 0.0)/0.8) * rr;
    float fr = exp(-pow((x + 0.012)/0.02, 2.0));
    float k = env * surge * cc.y;
    c += (uGreen*green + uFringe*(fr*uAmt.y) + uTop*(top*uAmt.z)) * (sheet*lum*k);
    c += uRed * (red*uAmt.x*wide*mix(1.0, lum, 0.5)*k);
  }
  return c;
}

float solveT(float H, float b, float a){
  if (a < 1e-6) return H/b;
  return (-b + sqrt(b*b + 2.0*a*H)) / a;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uFwd + uRight*uv.x*uTan.x + uUp*uv.y*uTan.y);
  rd.y = abs(rd.y);              // below the horizon: the mirrored sky, for the lake
  rd.y = max(rd.y, 0.0015);
  rd = normalize(rd);
  float T = uTime;

  // night sky: dark blue zenith, faint airglow band and horizon brightening
  float el = asin(rd.y);
  vec3 col = mix(uSkyHor, uSkyZen, pow(rd.y, 0.35));
  col += uAirglow * exp(-pow((el - 0.16)/0.075, 2.0)) * (0.55 + 0.9*n3(rd*vec3(5.0, 2.0, 5.0) + T*0.003));

  // Milky Way, in the slowly turning celestial frame
  vec3 dc = uStarRot * rd;
  if (uMilky > 0.0) {
    float b = dot(dc, uGalN);
    float cl = dot(dc, uGalC);
    float band = exp(-b*b/0.011) + 0.35*exp(-b*b/0.06);
    float bulge = exp(-(1.0 - cl)*2.5);
    float cloud = fbm3(dc*6.0);
    float dust = smoothstep(0.42, 0.72, fbm3(dc*11.0 + 7.0)) * exp(-b*b/0.0045);
    vec3 mw = mix(vec3(0.5, 0.58, 0.78), vec3(1.0, 0.84, 0.62), bulge);
    mw *= band * (0.25 + 1.4*cloud*cloud) * (1.0 + 2.0*bulge) * (1.0 - 0.85*dust);
    col += mw * uMilky;
  }

  // the aurora
  float lxz = length(rd.xz);
  float a = lxz*lxz/63.7;
  float t0 = solveT(0.82, rd.y, a);
  float t1 = min(solveT(4.3, rd.y, a), 27.0);
  vec3 acc = vec3(0.0);
  if (t1 > t0) {
    float span = t1 - t0;
    float lsafe = lxz + abs(uTilt)*rd.y + 0.03;
    float stMin = max(min(0.011/max(lxz, 1e-3), 0.016/rd.y), span/170.0);
    float stMax = max(span/16.0, stMin);
    uvec2 pq = uvec2(gl_FragCoord.xy) + uvec2(uint(uFrame)*1973u, uint(uFrame)*9277u);
    uint seedPx = hu(pq.x ^ hu(pq.y));
    float tt = t0;
    float st = stMin;
    for (int i = 0; i < 170; i++) {
      if (tt >= t1) break;
      // a fresh jitter for every step keeps the adaptive march unbiased (no banding)
      float jit = float(hu(seedPx + uint(i)*0x9e3779b9u)) * (1.0/4294967296.0);
      float ts = min(tt + jit*st, t1);
      float dm;
      vec3 e = emit(rd*ts, T, dm);
      acc += e * min(st, t1 - tt);
      tt += st;
      st = clamp(dm/lsafe, stMin, stMax);
    }
  }
  float X = 1.0/(rd.y + 0.035*exp(-rd.y*9.0));
  vec3 tr = exp(-X*uExt);
  col += acc * tr;
  if (uMilky > 0.0) col *= mix(vec3(1.0), tr, 0.5);

  vec4 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0);
  // without float targets, store a square-root encoding so 8 bits do not band
  if (uEnc > 0.5) { o = vec4(sqrt(clamp(col*12.0, 0.0, 1.0)), 1.0); return; }
  o = vec4(mix(prev.rgb, col, uBlend), 1.0);
}`;

const COMP_FRAG = COMMON + `
uniform sampler2D uSky;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uFwd, uRight, uUp;
uniform vec2 uTan;
uniform float uPix;
uniform float uMaxLod;
uniform float uExposure;
uniform mat3 uStarRot;
uniform vec3 uGalN;
uniform float uMilky;
uniform float uStars;
uniform vec3 uExt;
uniform int uLand;      // 0 lake + spruce, 1 hills + lake, 2 snowfield, 3 mountains + lake
uniform vec4 uHill;     // base, amp, freq, seed
uniform vec4 uTree;     // height, density, cell, seed
uniform float uShore;   // elevation of the far shore (radians, < 0)
uniform vec3 uSkyHor;
uniform vec3 uGrade;    // colour grade multiplier
uniform float uEnc;
out vec4 o;
vec3 dec(vec3 c){ return uEnc > 0.5 ? c*c*(1.0/12.0) : c; }

vec3 stars(vec3 d, float pix, float T, float elev, int nl){
  vec3 c = vec3(0.0);
  float mwb = uMilky > 0.0 ? exp(-pow(dot(d, uGalN), 2.0)/0.018) : 0.0;
  for (int l = 0; l < 3; l++) {
    if (l >= nl) break;
    float fl = float(l);
    float sc = l == 0 ? 22.0 : (l == 1 ? 48.0 : 95.0);
    vec3 ci = floor(d*sc);
    uvec3 q = uvec3(ivec3(ci) + 8192) + uint(l)*7919u;
    uint h = hu(q.x ^ hu(q.y ^ hu(q.z)));
    float r0 = float(h) * (1.0/4294967296.0);
    float prob = (l == 0 ? 0.55 : (l == 1 ? 0.3 : 0.12)) * uStars * (1.0 + mwb*2.5*fl);
    if (r0 > prob) continue;
    vec3 rnd = vec3(float(hu(h+1u)), float(hu(h+2u)), float(hu(h+3u))) * (1.0/4294967296.0);
    vec3 sp = normalize(ci + 0.06 + 0.88*rnd);
    float cosA = dot(d, sp);
    if (cosA < 0.99) continue;
    float ang = length(cross(d, sp));
    float rm = float(hu(h+4u)) * (1.0/4294967296.0);
    float mag = (l == 0 ? 1.3*pow(rm, 10.0) + 0.014 : (l == 1 ? 0.12*pow(rm, 4.0) + 0.008 : 0.025*pow(rm, 2.0) + 0.004));
    float tw = 1.0 + 0.5*(n1(T*(2.5 + 3.0*rnd.x) + rnd.y*100.0) - 0.5) * (1.0 - smoothstep(0.0, 0.8, elev));
    float sig = pix * 0.62;
    float psf = exp(-ang*ang/(2.0*sig*sig)) + 0.012*mag*exp(-ang/(pix*2.8));
    float tk = rnd.z;
    vec3 tint = tk < 0.18 ? vec3(1.0, 0.72, 0.5) : (tk < 0.55 ? vec3(1.0, 0.92, 0.82) : (tk < 0.85 ? vec3(0.9, 0.94, 1.0) : vec3(0.72, 0.82, 1.0)));
    c += tint * (mag * tw * psf);
  }
  return c;
}

float hillH(float az){
  float n = fbm1(az*uHill.z + uHill.w);
  if (uLand == 3) {
    float r = 1.0 - abs(2.0*fbm1(az*uHill.z*1.3 + uHill.w + 9.0) - 1.0);
    n = 0.35*n + 0.65*r*r;
  }
  n += 0.06*(fbm1(az*uHill.z*7.0 + uHill.w + 2.0) - 0.5);
  return uHill.x + uHill.y*n;
}

// coverage of a spruce treeline; y = elevation above the treeline base
float hc(float c, uint k){ return float(hu(uint(int(c) + 1048576) * 3u + k + uint(uTree.w*1000.0))) * (1.0/4294967296.0); }
float trees(float az, float y, float pix){
  if (uTree.y <= 0.0 || y < -pix || y > uTree.x*1.3) return 0.0;
  float cell = uTree.z;
  float ci = floor(az/cell);
  float clump = smoothstep(0.3, 0.75, n1(az/cell*0.03 + uTree.w));
  // the dense forest the taller trees rise out of
  float fh = uTree.x * (0.12 + 0.16*clump) * min(uTree.y*1.4, 1.0) * (0.75 + 0.5*n1(az/cell*0.5 + uTree.w));
  float cov = 1.0 - smoothstep(-pix*0.6, pix*0.6, y - fh);
  for (int k = -3; k <= 3; k++) {
    float c = ci + float(k);
    float dens = (0.3 + 0.7*smoothstep(0.2, 0.65, n1(c*0.03 + uTree.w))) * uTree.y;
    if (hc(c, 0u) > dens) continue;
    float h2 = hc(c, 1u);
    float th = uTree.x * (0.35 + 0.65*h2) * (0.6 + 0.5*n1(c*0.05 + 3.0 + uTree.w));
    float cx = (c + 0.5 + (hc(c, 2u) - 0.5)*0.8) * cell;
    float yy = y/th;
    if (yy > 1.0) continue;
    float tiers = 9.0 + 6.0*hc(c, 3u);
    float ti = floor(yy*tiers);
    float jag = 0.7 + 0.3*hc(c + ti*131.0, 4u);
    float hw = th * 0.12 * pow(max(1.0 - yy, 0.0), 1.05) * (0.45 + 0.55*(1.0 - fract(yy*tiers))) * jag + th*0.006;
    float sd = abs(az - cx) - hw;
    cov = max(cov, 1.0 - smoothstep(-pix*0.6, pix*0.6, sd));
  }
  return cov;
}

vec3 tonemap(vec3 c){
  c = 1.0 - exp(-c);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2));
}

void main(){
  vec2 uv01 = gl_FragCoord.xy / uRes;
  vec2 uv = uv01*2.0 - 1.0;
  vec3 rd = normalize(uFwd + uRight*uv.x*uTan.x + uUp*uv.y*uTan.y);
  float T = uTime;
  float el = asin(clamp(rd.y, -1.0, 1.0));
  float az = atan(rd.x, -rd.z);
  float pix = uPix;
  vec3 amb = dec(textureLod(uSky, vec2(0.5, 0.75), uMaxLod).rgb);   // mean sky radiance

  // ---- landscape geometry ----
  float shore = uShore;
  float ground = shore;                       // top of the near ground or lake
  if (uLand == 2) ground = shore + 0.012*(fbm1(az*2.3 + uHill.w + 4.0) - 0.4) ;
  float hH = hillH(az);
  float tc = trees(az, el - ground, pix);
  float hillC = 1.0 - smoothstep(-pix*0.7, pix*0.7, el - hH);

  vec3 skyRad = dec(texture(uSky, uv01).rgb);
  vec3 col;

  // snow-covered hills: lit by the sky, softened by a little haze
  float slope = (hillH(az + 0.01) - hH) / 0.01;
  float hd = fbm1(az*uHill.z*9.0 + uHill.w*3.0);
  vec3 hillCol = (amb * 0.3 * (0.75 + 0.5*clamp(-slope*2.0 + 0.2, -0.6, 0.6)) + uSkyHor*0.35) * (0.55 + 0.6*hd);
  hillCol *= 0.85 + 0.3*smoothstep(0.0, uHill.y + 0.02, hH - el);
  vec3 treeCol = amb*0.025 + uSkyHor*0.08;

  if (el >= ground) {
    vec3 dcel = uStarRot * rd;
    vec3 X = vec3(1.0/(max(rd.y, 0.0) + 0.035*exp(-max(rd.y, 0.0)*9.0)));
    vec3 sky = skyRad + stars(dcel, pix, T, el, 3) * exp(-X*uExt*1.4);
    col = mix(sky, hillCol, hillC);
    col = mix(col, treeCol, tc);
  } else {
    float depth = -rd.y;                      // sine of the angle below the horizon
    vec2 P = rd.xz * (1.6/depth);             // position on the ground plane (eye 1.6 m up)
    float dist = length(P);
    float foot = dist * pix / max(depth, 1e-3);
    if (uLand == 2) {
      // a snowfield: soft wind ripples, faint glints, lit by the aurora
      float fade = 1.0 - smoothstep(0.4, 3.0, foot);
      float rip = fbm3(vec3(P*vec2(0.35, 0.9), 0.0)) - 0.5;
      float sast = (n3(vec3(P*vec2(1.6, 5.0), 3.0)) - 0.5);
      float lit = 0.62 + (rip*0.35 + sast*0.12)*fade;
      col = amb * lit * (0.9 + 0.35*smoothstep(0.25, 0.0, depth));
      float gl = h3(floor(vec3(gl_FragCoord.xy, floor(T*0.7))));
      col += amb * 6.0 * step(0.9985, gl) * fade * smoothstep(0.02, 0.2, depth);
      col = mix(col, treeCol, tc);
    } else {
      // the frozen lake: clear black ice reflects the sky; wind-packed snow lies in drifts
      float fade = 1.0 - smoothstep(0.3, 2.5, foot);
      vec2 g = vec2(n3(vec3(P*0.55, 1.0)) - 0.5, n3(vec3(P*0.55, 5.0)) - 0.5);
      float rough = 0.006 + 0.01*fade;
      vec2 off = vec2(g.x*0.6, g.y) * rough * fade / (0.25 + depth*4.0) ;
      vec2 ruv = uv01 + off;
      float lod = 1.2 + 2.0*n3(vec3(P*0.08, 2.0));
      vec3 refl = dec(textureLod(uSky, ruv, lod).rgb);
      vec3 rdm = normalize(vec3(rd.x, -rd.y, rd.z));
      refl += stars(uStarRot*rdm, pix, T, -el, 1) * 0.35;
      // the shoreline and hills, reflected
      float rel = -el;
      float rHill = 1.0 - smoothstep(-pix, pix, rel - hH);
      float rTree = trees(az, (shore - el) + 0.0, pix*1.5);
      refl = mix(refl, hillCol*0.8, rHill);
      refl = mix(refl, treeCol, rTree);
      float F = 0.06 + 0.94*pow(1.0 - depth, 3.5);
      float drift = smoothstep(0.55, 0.7, fbm3(vec3(P*vec2(0.05, 0.16), 3.0)) + 0.1*(n3(vec3(P*0.7, 9.0)) - 0.5)*fade);
      drift *= smoothstep(0.0, 0.03, depth);
      vec3 ice = refl * F + amb*0.025;
      vec3 snow = amb * (0.5 + 0.15*(n3(vec3(P*2.0, 4.0)) - 0.5)*fade);
      col = mix(ice, snow, drift*0.85);
    }
  }

  // exposure, vignette, grade
  float vig = 1.0 - 0.38*pow(length(uv*vec2(0.85, 1.0))*0.72, 2.4);
  col *= uExposure * vig * uGrade;
  vec3 c = tonemap(col);
  // film grain and dither, strongest in the mid-tones
  uvec2 pq = uvec2(gl_FragCoord.xy) + uvec2(uint(T*24.0)*7919u, uint(T*24.0)*104729u);
  float g1 = float(hu(pq.x ^ hu(pq.y))) * (1.0/4294967296.0);
  float g2 = float(hu(pq.y*3u ^ hu(pq.x + 17u))) * (1.0/4294967296.0);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c += (g1 + g2 - 1.0) * (0.012 + 0.03*l*(1.0 - l));
  o = vec4(c, 1.0);
}`;

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// sRGB-ish linear colours of the emission lines (as a camera would see them)
const LINES = {
  green: [
    [0.1, 1.0, 0.36], // 557.7 nm with a touch of N2+ blue: the classic mint
    [0.2, 1.0, 0.22], // a yellower green
    [0.06, 1.0, 0.48], // a cool teal green
  ] as V3[],
  red: [
    [1.0, 0.07, 0.2],
    [1.0, 0.1, 0.32],
    [1.0, 0.09, 0.14],
  ] as V3[],
  fringe: [
    [1.0, 0.2, 0.62], // N2 first positive: pink
    [0.62, 0.22, 1.0], // N2+ violet
    [0.95, 0.28, 0.8],
  ] as V3[],
  top: [
    [0.42, 0.3, 1.0], // sunlit N2+ violet tops
    [0.55, 0.32, 1.0],
  ] as V3[],
};

export type Activity = 'quiet' | 'bands' | 'active' | 'corona';

export function makeParams(seed: number, aspect: number) {
  const R = mulberry32(seed * 7919 + 17);
  const rg = (a: number, b: number) => a + (b - a) * R();
  const pick = <T,>(a: T[]): T => a[Math.floor(R() * a.length)];
  const roll = R();
  const activity: Activity = roll < 0.22 ? 'quiet' : roll < 0.55 ? 'bands' : roll < 0.86 ? 'active' : 'corona';

  const curtains: { A: number[]; B: number[]; C: number[]; D: number[]; E: number[] }[] = [];
  const n = activity === 'quiet' ? (R() < 0.7 ? 1 : 2) : activity === 'bands' ? 1 + Math.floor(R() * 2) : activity === 'active' ? 2 + Math.floor(R() * 2) : 2 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) {
    let Z: number, A1: number, k1: number, A2: number, k2: number, A3: number, k3: number, w: number, br: number, rs: number, rf: number, le: number, hg: number, envMin: number, surge: number;
    if (activity === 'quiet') {
      Z = -rg(4.5, 8.0) - i * 1.6;
      A1 = rg(0.1, 0.4); k1 = rg(0.06, 0.12); A2 = rg(0.1, 0.3); k2 = rg(0.2, 0.4); A3 = rg(0.0, 0.05); k3 = rg(1.5, 3.0);
      w = rg(0.07, 0.12); br = rg(0.9, 1.2) * (i === 0 ? 1 : 0.55); rs = rg(0.04, 0.2); rf = rg(18, 30);
      le = rg(1.02, 1.12); hg = rg(0.28, 0.4); envMin = rg(0.45, 0.8); surge = rg(0.3, 0.7);
    } else if (activity === 'bands') {
      Z = -rg(2.4, 4.5) - i * rg(0.9, 1.8);
      A1 = rg(0.35, 0.8); k1 = rg(0.12, 0.25); A2 = rg(0.2, 0.45); k2 = rg(0.4, 0.8); A3 = rg(0.03, 0.07); k3 = rg(2.0, 4.0);
      w = rg(0.04, 0.065); br = rg(1.0, 1.4) * (1 - i * 0.35); rs = rg(0.4, 0.7); rf = rg(22, 40);
      le = rg(1.0, 1.1); hg = rg(0.3, 0.45); envMin = rg(0.15, 0.5); surge = rg(0.6, 1.2);
    } else if (activity === 'active') {
      Z = -rg(1.0, 3.0) - i * rg(0.8, 1.6);
      A1 = rg(0.6, 1.3); k1 = rg(0.15, 0.3); A2 = rg(0.35, 0.7); k2 = rg(0.5, 0.9); A3 = rg(0.05, 0.11); k3 = rg(2.5, 5.0);
      w = rg(0.03, 0.05); br = rg(1.3, 1.8) * (1 - i * 0.28); rs = rg(0.7, 0.95); rf = rg(28, 50);
      le = rg(0.95, 1.05); hg = rg(0.35, 0.55); envMin = rg(0.1, 0.4); surge = rg(0.8, 1.6);
    } else {
      Z = rg(-1.6, 0.6) - i * rg(0.6, 1.2);
      A1 = rg(0.5, 1.0); k1 = rg(0.2, 0.4); A2 = rg(0.4, 0.8); k2 = rg(0.5, 1.0); A3 = rg(0.08, 0.14); k3 = rg(3.0, 5.0);
      w = rg(0.03, 0.045); br = rg(1.3, 1.7) * (1 - i * 0.25); rs = rg(0.85, 0.98); rf = rg(30, 55);
      le = rg(0.95, 1.05); hg = rg(0.4, 0.6); envMin = rg(0.2, 0.5); surge = rg(0.8, 1.5);
    }
    curtains.push({
      A: [Z, A1, k1, rg(0, 6.283)],
      B: [A2, k2, A3, k3],
      C: [w, br, rs, rf],
      D: [le, hg, rg(0.08, 0.25), envMin],
      E: [rg(0.35, 0.8) * (R() < 0.5 ? -1 : 1), rg(0, 56), surge, rg(0.2, 0.9) * (R() < 0.5 ? -1 : 1)],
    });
  }

  const green = pick(LINES.green);
  const red = pick(LINES.red);
  const fringe = pick(LINES.fringe);
  const top = pick(LINES.top);
  let redAmt = activity === 'quiet' ? rg(0.01, 0.045) : activity === 'bands' ? rg(0.03, 0.12) : rg(0.08, 0.22);
  let fringeAmt = activity === 'quiet' ? 0 : activity === 'bands' ? (R() < 0.4 ? rg(0.2, 0.5) : 0) : rg(0.5, 1.1);
  let topAmt = activity === 'quiet' ? 0 : R() < 0.35 ? rg(0.3, 0.8) : 0;
  // occasionally a deep red storm: a great red glow above weak green
  const redStorm = activity !== 'quiet' && R() < 0.12;
  if (redStorm) redAmt = rg(0.28, 0.42);

  // sky tones
  const skyChoice = pick([
    { zen: [0.0009, 0.0013, 0.0034], hor: [0.0035, 0.0045, 0.0075] },
    { zen: [0.0007, 0.0011, 0.0026], hor: [0.003, 0.0042, 0.0062] },
    { zen: [0.0011, 0.0013, 0.003], hor: [0.0042, 0.0046, 0.0068] },
  ]);
  const airglow: V3 = scale([0.25, 1.0, 0.45], rg(0.0008, 0.0024));

  // camera
  const portrait = aspect < 0.85;
  let fovY = activity === 'corona' ? rg(78, 88) : rg(54, 64);
  if (portrait) fovY = Math.min(fovY + 14, 96);
  let horizonNDC = activity === 'corona' ? rg(-0.84, -0.76) : rg(-0.62, -0.44);
  if (portrait && activity !== 'corona') horizonNDC = rg(-0.58, -0.42);
  const tanY = Math.tan((fovY * Math.PI) / 360);
  const pitch = Math.atan(-horizonNDC * tanY);
  const yaw = rg(-0.25, 0.25);
  const tilt = activity === 'corona' ? -0.22 : 0.22;

  // landscape
  const lr = R();
  const land = activity === 'corona' ? (lr < 0.5 ? 0 : 2) : lr < 0.38 ? 0 : lr < 0.62 ? 1 : lr < 0.82 ? 2 : 3;
  const shore = -rg(0.0035, 0.0075);
  const hill =
    land === 3
      ? [rg(-0.004, 0.0), rg(0.05, 0.09), rg(1.3, 2.4), rg(0, 100)]
      : land === 1
        ? [rg(-0.002, 0.004), rg(0.025, 0.05), rg(1.2, 2.5), rg(0, 100)]
        : [rg(-0.004, 0.0), rg(0.01, 0.025), rg(1.5, 3.0), rg(0, 100)];
  const treeH = land === 0 ? rg(0.05, 0.085) : land === 2 ? rg(0.045, 0.075) : rg(0.025, 0.04);
  const tree = [treeH, land === 0 ? rg(0.8, 1.0) : land === 2 ? rg(0.5, 0.85) : land === 1 ? (R() < 0.6 ? rg(0.55, 0.9) : 0) : 0, treeH * rg(0.12, 0.17), rg(0, 100)];

  // stars and the Milky Way
  const milky = R() < (activity === 'quiet' ? 0.8 : activity === 'bands' ? 0.55 : 0.3) ? rg(0.006, 0.012) : 0;
  const lat = rg(62, 70) * (Math.PI / 180);
  const cAz = yaw + rg(-0.7, 0.7);
  const cEl = rg(0.25, 0.9);
  const gc: V3 = norm([Math.sin(cAz) * Math.cos(cEl), Math.sin(cEl), -Math.cos(cAz) * Math.cos(cEl)]);
  const t1 = norm(cross(gc, [0, 1, 0]));
  const t2 = cross(t1, gc);
  const psi = rg(0.25, 1.15) * (R() < 0.5 ? -1 : 1);
  const galN = norm(add(scale(t1, Math.cos(psi)), scale(t2, Math.sin(psi))));
  const starDensity = rg(0.75, 1.25);

  const exposure = (activity === 'quiet' ? rg(6.5, 8.5) : activity === 'bands' ? rg(5, 6.5) : rg(3.8, 5.2)) * (redStorm ? 0.85 : 1);
  const grade = pick<V3>([
    [1.0, 1.0, 1.0],
    [0.96, 1.0, 1.05],
    [1.03, 1.0, 0.97],
  ]);

  return {
    activity, curtains, green, red, fringe, top, amt: [redAmt, fringeAmt, topAmt] as V3,
    skyZen: skyChoice.zen as V3, skyHor: skyChoice.hor as V3, airglow,
    fovY, tanY, pitch, yaw, tilt, land, shore, hill, tree, milky, lat, galN, galC: gc, starDensity,
    exposure, grade, ext: [0.06, 0.085, 0.14] as V3, redStorm,
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
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export function startAurora(canvas: HTMLCanvasElement, seed: number, opts: { still: boolean; onReady: () => void }) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const floatOK = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');

  const sky = program(gl, SKY_FRAG);
  const comp = program(gl, COMP_FRAG);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let P = makeParams(seed, innerWidth / innerHeight);
  let W = 0, H = 0, sw = 0, sh = 0;
  let tex: WebGLTexture[] = [];
  let fbo: WebGLFramebuffer[] = [];
  let cur = 0;
  let frame = 0;
  let maxLod = 0;

  function makeTargets() {
    tex.forEach((t) => gl!.deleteTexture(t));
    fbo.forEach((f) => gl!.deleteFramebuffer(f));
    tex = []; fbo = [];
    for (let i = 0; i < 2; i++) {
      const t = gl!.createTexture()!;
      gl!.bindTexture(gl!.TEXTURE_2D, t);
      maxLod = Math.floor(Math.log2(Math.max(sw, sh)));
      gl!.texStorage2D(gl!.TEXTURE_2D, maxLod + 1, floatOK ? gl!.RGBA16F : gl!.RGBA8, sw, sh);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      const f = gl!.createFramebuffer()!;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, f);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, t, 0);
      gl!.clearColor(0, 0, 0, 1);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      tex.push(t); fbo.push(f);
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    frame = 0;
  }

  let quality = 1;
  function resize() {
    const cssW = Math.max(1, canvas.clientWidth), cssH = Math.max(1, canvas.clientHeight);
    const small = Math.min(cssW, cssH) < 600;
    const dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 1.35);
    W = Math.round(cssW * dpr); H = Math.round(cssH * dpr);
    canvas.width = W; canvas.height = H;
    let s = (small ? 0.42 : 0.5) * quality;
    const maxPx = (small ? 200000 : 460000) * quality * quality;
    if (cssW * cssH * s * s > maxPx) s = Math.sqrt(maxPx / (cssW * cssH));
    const nsw = Math.max(64, Math.round(cssW * s)), nsh = Math.max(48, Math.round(cssH * s));
    const aspectChanged = Math.abs(P ? (sw / sh) - (nsw / nsh) : 1) > 0.02;
    if (aspectChanged) P = makeParams(seed, cssW / cssH);
    if (nsw !== sw || nsh !== sh) { sw = nsw; sh = nsh; makeTargets(); }
  }

  function camera() {
    const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
    const fwd: V3 = [Math.sin(P.yaw) * cp, sp, -Math.cos(P.yaw) * cp];
    const right: V3 = [Math.cos(P.yaw), 0, Math.sin(P.yaw)];
    const up = cross(right, fwd);
    return { fwd, right, up };
  }

  function starRot(t: number) {
    // rotation about the celestial pole (due north, elevated by the latitude)
    const ax = norm([0, Math.sin(P.lat), -Math.cos(P.lat)]);
    const a = t * 7.292e-5 * 6; // a little faster than the sky, still barely perceptible
    const c = Math.cos(a), s = Math.sin(a), C = 1 - c;
    const [x, y, z] = ax;
    // column-major for WebGL
    return new Float32Array([
      c + x * x * C, y * x * C + z * s, z * x * C - y * s,
      x * y * C - z * s, c + y * y * C, z * y * C + x * s,
      x * z * C + y * s, y * z * C - x * s, c + z * z * C,
    ]);
  }

  const t0 = performance.now();
  const timeOffset = (seed % 997) * 1.7;
  let running = true;
  let raf = 0;
  let ready = false;

  function draw(now: number) {
    const time = timeOffset + (opts.still ? 0 : (now - t0) / 1000);
    const cam = camera();
    const rot = starRot(time - timeOffset);
    const aspect = W / H;
    const tan: [number, number] = [P.tanY * aspect, P.tanY];

    // pass 1: sky into the ping-pong target
    const src = cur, dst = 1 - cur;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo[dst]);
    gl!.viewport(0, 0, sw, sh);
    gl!.useProgram(sky.p);
    const u = sky.u;
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, tex[src]);
    gl!.uniform1i(u.uPrev, 0);
    gl!.uniform2f(u.uRes, sw, sh);
    gl!.uniform1f(u.uTime, time);
    gl!.uniform1f(u.uFrame, frame);
    gl!.uniform1f(u.uBlend, !floatOK ? 1 : opts.still ? 1 / (frame + 1) : frame === 0 ? 1 : 0.22);
    gl!.uniform3fv(u.uFwd, cam.fwd); gl!.uniform3fv(u.uRight, cam.right); gl!.uniform3fv(u.uUp, cam.up);
    gl!.uniform2fv(u.uTan, tan);
    gl!.uniform1i(u.uN, P.curtains.length);
    const pack = (k: 'A' | 'B' | 'C' | 'D' | 'E') => {
      const a = new Float32Array(16);
      P.curtains.forEach((c, i) => a.set(c[k], i * 4));
      return a;
    };
    gl!.uniform4fv(u.uCA, pack('A')); gl!.uniform4fv(u.uCB, pack('B')); gl!.uniform4fv(u.uCC, pack('C'));
    gl!.uniform4fv(u.uCD, pack('D')); gl!.uniform4fv(u.uCE, pack('E'));
    gl!.uniform1f(u.uTilt, P.tilt);
    gl!.uniform3fv(u.uGreen, P.green); gl!.uniform3fv(u.uRed, P.red); gl!.uniform3fv(u.uFringe, P.fringe); gl!.uniform3fv(u.uTop, P.top);
    gl!.uniform3fv(u.uAmt, P.amt);
    gl!.uniform3fv(u.uSkyZen, P.skyZen); gl!.uniform3fv(u.uSkyHor, P.skyHor); gl!.uniform3fv(u.uAirglow, P.airglow);
    gl!.uniformMatrix3fv(u.uStarRot, false, rot);
    gl!.uniform3fv(u.uGalN, P.galN); gl!.uniform3fv(u.uGalC, P.galC);
    gl!.uniform1f(u.uMilky, P.milky);
    gl!.uniform3fv(u.uExt, P.ext);
    gl!.uniform1f(u.uEnc, floatOK ? 0 : 1);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.bindTexture(gl!.TEXTURE_2D, tex[dst]);
    gl!.generateMipmap(gl!.TEXTURE_2D);
    cur = dst;

    // pass 2: composite to the screen
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, W, H);
    gl!.useProgram(comp.p);
    const v = comp.u;
    gl!.uniform1i(v.uSky, 0);
    gl!.uniform2f(v.uRes, W, H);
    gl!.uniform1f(v.uTime, time);
    gl!.uniform3fv(v.uFwd, cam.fwd); gl!.uniform3fv(v.uRight, cam.right); gl!.uniform3fv(v.uUp, cam.up);
    gl!.uniform2fv(v.uTan, tan);
    gl!.uniform1f(v.uPix, (2 * P.tanY) / H);
    gl!.uniform1f(v.uMaxLod, maxLod);
    gl!.uniform1f(v.uExposure, P.exposure);
    gl!.uniformMatrix3fv(v.uStarRot, false, rot);
    gl!.uniform3fv(v.uGalN, P.galN);
    gl!.uniform1f(v.uMilky, P.milky);
    gl!.uniform1f(v.uStars, P.starDensity);
    gl!.uniform3fv(v.uExt, P.ext);
    gl!.uniform1i(v.uLand, P.land);
    gl!.uniform4fv(v.uHill, P.hill);
    gl!.uniform4fv(v.uTree, P.tree);
    gl!.uniform1f(v.uShore, P.shore);
    gl!.uniform3fv(v.uSkyHor, P.skyHor);
    gl!.uniform3fv(v.uGrade, P.grade);
    gl!.uniform1f(v.uEnc, floatOK ? 0 : 1);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    frame++;
    (window as any).__frames = frame;
    (window as any).__floatOK = floatOK;
  }

  // adaptive quality: if frames are slow, render the sky at a lower resolution
  let acc = 0, accN = 0, last = 0;
  function loop(now: number) {
    if (!running) return;
    if (last && !opts.still) {
      acc += now - last; accN++;
      if (accN >= 90) {
        const avg = acc / accN;
        if (avg > 24 && quality > 0.5) { quality *= 0.82; resize(); }
        acc = 0; accN = 0;
      }
    }
    last = now;
    draw(now);
    if (!ready && frame >= 4) { ready = true; opts.onReady(); }
    if (opts.still && frame >= 10) return; // converged still frame
    raf = requestAnimationFrame(loop);
  }

  resize();
  addEventListener('resize', () => {
    resize();
    if (opts.still) { frame = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
  });
  raf = requestAnimationFrame(loop);
  return { params: P };
}
