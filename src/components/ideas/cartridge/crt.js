// The CRT: a WebGL2 picture tube for a 256x240 NES frame.
//
// Passes (light is linear throughout; per NES field, then per display frame):
//  1. signal    NES frame -> 512x240. Composite-style YIQ filtering in signal (gamma) space: a soft,
//               slightly peaked luma, and wider chroma that bleeds and lags a fraction of a pixel.
//               Decoded with a CRT gamma.
//  2. phosphor  horizontal misconvergence of the three guns (growing towards the sides), and the
//               previous field's afterglow, decaying per colour.
//  3. glow      a padded, half-resolution copy of the picture (so light can spill past the tube),
//               then a dual-filter pyramid: tight bloom from level 0, a long halation tail from the rest.
//  4. tube      per device pixel: barrel-curved glass, a Gaussian beam per scanline whose width grows
//               with brightness (box-filtered over the pixel so it never moires), an aperture grille
//               locked to device pixels, bloom and halation in the glass, vignette, rounded tube corners,
//               light spilling onto the dark surround and the bezel lip, a faint reflection on the
//               glass, grain and dither. Also the power-on: line, raster opening, degauss.

export const NES_W = 256, NES_H = 240;
export const ASPECT = (NES_W * 8) / 7 / NES_H; // 8:7 pixels -> 1.219

// Look. Units: q (tube space) has the tube's half-height = 1.
export const LOOK = {
  curve: 0.055,        // barrel distortion
  corner: 0.11,        // tube corner radius (q units)
  overscan: 0.965,     // fraction of the image inside the tube edge
  pad: 2.0,            // glow domain, in image half-sizes
  gammaIn: 2.45,       // CRT decode
  gammaOut: 2.2,       // display encode
  lumaSigma: 0.6,      // NES pixels
  lumaPeak: 0.08,      // sharpness ringing
  chromaI: 1.05,
  chromaQ: 1.6,
  chromaLag: 0.28,
  persist: [0.20, 0.13, 0.11], // per-field phosphor decay (P22: red lingers)
  beamMin: 0.21,       // scanline sigma at black (in lines)
  beamMax: 0.31,       // ... at full white
  beamNorm: 0.55,      // how much of the width's extra energy is normalised away
  convergence: [0.06, 0.32], // NES px: everywhere, and extra towards the sides
  mask: 0.55,          // aperture grille depth
  maskComp: 0.8,       // brightness put back after the mask
  bloom: 0.07,
  halo: 0.055,
  gain: 1.18,
  vignette: 0.24,
  glass: [0.0007, 0.00085, 0.0009], // the dark glass of a lit tube in a dark room
  spill: 0.3,
  lip: 0.3,
  reflection: 0.011,
  grain: 0.006,
};

const VS = `#version 300 es
out vec2 v;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared helpers: tube shape, power-on raster
const COMMON = `
precision highp float;
uniform vec2 uTube;      // ASPECT, corner radius
uniform float uOverscan;
uniform vec4 uRaster;    // horizontal extent, vertical extent, brightness, unused
float sdTube(vec2 q) {
  vec2 b = vec2(uTube.x, 1.0) - uTube.y;
  vec2 d = abs(q) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - uTube.y;
}
// image coords (-1..1, y up) -> image coords inside the scanned raster, or a miss
vec2 raster(vec2 img, out float inside) {
  vec2 w = img / max(uRaster.xy, vec2(1e-4));
  vec2 e = smoothstep(vec2(1.004), vec2(0.996), abs(w));
  inside = e.x * e.y;
  return w;
}
`;

const FS_SIGNAL = `#version 300 es
precision highp float;
uniform sampler2D uNes;
uniform vec4 uFilt;   // lumaSigma, lumaPeak, chromaI, chromaQ
uniform float uLag;
uniform float uGammaIn;
in vec2 v;
out vec4 o;
const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 YIQ2RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
float g(float x, float s) { return exp(-0.5 * x * x / (s * s)); }
void main() {
  float xc = gl_FragCoord.x * 0.5;            // NES pixel position of this sample
  int row = int(gl_FragCoord.y);
  int x0 = int(floor(xc));
  vec3 acc = vec3(0.0); vec3 wsum = vec3(0.0);
  for (int k = -5; k <= 5; k++) {
    int px = x0 + k;
    vec3 c = (px < 0 || px > 255) ? vec3(0.0) : texelFetch(uNes, ivec2(px, row), 0).rgb;
    vec3 yiq = RGB2YIQ * c;
    float d = float(px) + 0.5 - xc;
    float wy = g(d, uFilt.x) - uFilt.y * g(d, uFilt.x * 2.4);
    float dc = d - uLag;
    vec3 w = vec3(wy, g(dc, uFilt.z), g(dc, uFilt.w));
    acc += yiq * w; wsum += w;
  }
  vec3 rgb = clamp(YIQ2RGB * (acc / wsum), 0.0, 1.0);
  o = vec4(ENC(pow(rgb, vec3(uGammaIn))), 1.0);
}`;

// The phosphors: the three guns land a little apart towards the sides (horizontal misconvergence),
// and each colour's glow lingers into the next field (P22: red longest).
const FS_PHOSPHOR = `#version 300 es
precision highp float;
uniform sampler2D uRaw;
uniform sampler2D uPrev;
uniform vec3 uDecay;
uniform vec2 uConv;
uniform float uHasPrev;
in vec2 v;
out vec4 o;
void main() {
  float x = v.x * 2.0 - 1.0;
  float off = (uConv.x + uConv.y * x * abs(x)) / 256.0;
  vec3 c = vec3(DEC(texture(uRaw, vec2(v.x + off, v.y)).r), DEC(texture(uRaw, v).g), DEC(texture(uRaw, vec2(v.x - off, v.y)).b));
  vec3 prev = uHasPrev > 0.5 ? DEC(texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0).rgb) : vec3(0.0);
  o = vec4(ENC(max(c, prev * uDecay)), 1.0);
}`;

// Level 0 of the glow: the picture (with the power-on raster and tube shape) in a padded domain.
const FS_GLOW0 = `#version 300 es
${COMMON}
uniform sampler2D uSig;
uniform float uPad;
uniform vec2 uTexel;  // one glow texel in image units
in vec2 v;
out vec4 o;
vec3 pic(vec2 img) {
  float inR;
  vec2 w = raster(img, inR);
  vec2 q = img * vec2(uTube.x, 1.0) / uOverscan;
  float inT = smoothstep(0.01, -0.01, sdTube(q));
  vec2 uv = vec2(w.x * 0.5 + 0.5, 0.5 - w.y * 0.5);
  vec3 c = DEC(texture(uSig, uv).rgb) * inR * inT * uRaster.z;
  // light scatters in proportion to how hard the phosphor is driven: highlights glow, shadows don't
  return c * (0.15 + 0.85 * smoothstep(0.04, 0.75, dot(c, vec3(0.3, 0.55, 0.15))));
}
void main() {
  vec2 img = vec2(v.x * 2.0 - 1.0, 1.0 - v.y * 2.0) * uPad;
  vec2 h = uTexel * 0.5;
  vec3 c = pic(img + vec2(-h.x, -h.y)) + pic(img + vec2(h.x, -h.y)) + pic(img + vec2(-h.x, h.y)) + pic(img + vec2(h.x, h.y));
  o = vec4(ENC(c * 0.25), 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;  // source texel
in vec2 v;
out vec4 o;
void main() {
  vec2 h = uTexel;
  vec3 c = DEC(texture(uSrc, v).rgb) * 4.0;
  c += DEC(texture(uSrc, v + vec2(-h.x, -h.y)).rgb);
  c += DEC(texture(uSrc, v + vec2(h.x, -h.y)).rgb);
  c += DEC(texture(uSrc, v + vec2(-h.x, h.y)).rgb);
  c += DEC(texture(uSrc, v + vec2(h.x, h.y)).rgb);
  o = vec4(ENC(c / 8.0), 1.0);
}`;

const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc;   // coarser level (accumulated)
uniform sampler2D uBase;  // this level
uniform vec2 uTexel;      // coarser texel
uniform float uMix;
in vec2 v;
out vec4 o;
void main() {
  vec2 h = uTexel;
  vec3 c = vec3(0.0);
  c += DEC(texture(uSrc, v + vec2(-h.x * 2.0, 0.0)).rgb);
  c += DEC(texture(uSrc, v + vec2(h.x * 2.0, 0.0)).rgb);
  c += DEC(texture(uSrc, v + vec2(0.0, -h.y * 2.0)).rgb);
  c += DEC(texture(uSrc, v + vec2(0.0, h.y * 2.0)).rgb);
  c += DEC(texture(uSrc, v + vec2(-h.x, -h.y)).rgb) * 2.0;
  c += DEC(texture(uSrc, v + vec2(h.x, -h.y)).rgb) * 2.0;
  c += DEC(texture(uSrc, v + vec2(-h.x, h.y)).rgb) * 2.0;
  c += DEC(texture(uSrc, v + vec2(h.x, h.y)).rgb) * 2.0;
  o = vec4(ENC(mix(DEC(texture(uBase, v).rgb), c / 12.0, uMix)), 1.0);
}`;

const FS_TUBE = `#version 300 es
${COMMON}
uniform sampler2D uSig;
uniform sampler2D uBloom;
uniform sampler2D uHalo;
uniform sampler2D uAmb;
uniform vec2 uCenter;     // px
uniform float uScale;     // px per q unit
uniform float uCurve;
uniform float uPad;
uniform vec4 uBeam;       // min, max, norm, gain
uniform vec3 uMask;       // depth, compensation, triad width (px)
uniform vec4 uGlow;       // bloom, halo, spill, lip
uniform vec4 uSurface;    // vignette, reflection, grain, gammaOut
uniform vec3 uGlass;
uniform vec4 uPower;      // on (0..1 glass charge), line, degauss, time
uniform float uSeed;
in vec2 v;
out vec4 o;

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec2 barrel(vec2 p) {
  float r2 = dot(p, p) / (uTube.x * uTube.x + 1.0);
  return p * (1.0 + uCurve * r2 + uCurve * 0.5 * r2 * r2);
}

vec3 beam(vec2 img, float fy) {
  vec2 nes = vec2((img.x * 0.5 + 0.5) * 256.0, (0.5 - img.y * 0.5) * 240.0);
  float sy = nes.y - 0.5;
  float l0 = floor(sy);
  float f = sy - l0;
  float u = nes.x / 256.0;
  float fy2 = fy * fy / 12.0;
  vec3 acc = vec3(0.0);
  for (int i = -1; i <= 2; i++) {
    float line = l0 + float(i);
    if (line < 0.0 || line > 239.0) continue;
    vec3 c = DEC(texture(uSig, vec2(u, (line + 0.5) / 240.0)).rgb);
    vec3 s = mix(vec3(uBeam.x), vec3(uBeam.y), pow(min(c, vec3(1.0)), vec3(0.55)));
    vec3 s2 = s * s + fy2;
    float d = f - float(i);
    vec3 w = exp(-0.5 * d * d / s2) * s * inversesqrt(s2);
    // energy: a wide beam carries more light; normalise part of that away
    w /= mix(vec3(1.0), s * 2.5066, uBeam.z);
    acc += c * w;
  }
  return acc;
}

vec3 grille(vec2 frag) {
  float w = uMask.z;
  float k = mod(floor(frag.x), w);
  vec3 m;
  if (w > 2.5) m = k < 0.5 ? vec3(1.0, 0.0, 0.0) : k < 1.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  else m = k < 0.5 ? vec3(1.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 dark = vec3(1.0 - uMask.x);
  m = mix(dark, vec3(1.0), m);
  float mean = w > 2.5 ? (1.0 + 2.0 * dark.x) / 3.0 : (1.0 + dark.x) / 2.0;
  return m / mix(1.0, mean, uMask.y);
}

vec3 shoulder(vec3 x) {
  // gentle highlight roll-off; linear below 0.6
  vec3 t = max(x - 0.6, 0.0);
  return min(x, 0.6) + 0.4 * (1.0 - exp(-t / 0.4));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - uCenter) / uScale;
  float t = uPower.w;
  float dg = uPower.z;
  // degauss: the picture swims for a moment
  p += dg * 0.010 * vec2(sin(p.y * 5.0 + t * 41.0), sin(p.x * 4.0 + t * 33.0));
  vec2 q = barrel(p);
  float aa = 1.4 / uScale;
  float sd = sdTube(q);
  float inside = smoothstep(aa, -aa, sd);
  vec2 img = q / vec2(uTube.x, 1.0) * uOverscan;
  vec2 puv = vec2(img.x / uPad * 0.5 + 0.5, 0.5 - img.y / uPad * 0.5);

  vec3 col = vec3(0.0);
  vec3 bloom = DEC(texture(uBloom, puv).rgb);
  vec3 halo = DEC(texture(uHalo, puv).rgb);

  // where the beam lands, and how many scanlines one output pixel spans (derivatives are taken
  // here, in uniform control flow, for an analytic box filter over the pixel: no scanline moire)
  float inR;
  vec2 w = raster(img, inR);
  float fy = length(vec2(dFdx(w.y), dFdy(w.y))) * 120.0;

  if (inside > 0.0) {
    vec3 b = beam(w, fy) * inR * uRaster.z;
    col = b * grille(frag) * uBeam.w;
    col += bloom * uGlow.x + halo * uGlow.y;

    // the bright line of a raster that hasn't opened yet
    float lineW = 1.5 / uScale + uRaster.y * 0.02;
    float lx = smoothstep(uRaster.x * uTube.x + 0.03, uRaster.x * uTube.x - 0.08, abs(q.x));
    col += uPower.y * lx * (exp(-0.5 * q.y * q.y / (lineW * lineW)) * vec3(2.2, 2.6, 3.4)
      + exp(-0.5 * q.y * q.y / (lineW * lineW * 64.0)) * vec3(0.18, 0.22, 0.32));

    // degauss: colour purity blotches drifting across the face
    if (dg > 0.001) {
      float n = sin(q.x * 2.3 + t * 1.7) * sin(q.y * 2.9 - t * 1.3) + 0.6 * sin((q.x - q.y) * 3.7 + t * 2.6);
      float a = dg * 1.6 * n;
      float y = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 c = col - y;
      vec3 k = normalize(vec3(1.0));
      c = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
      col = max(y + c, 0.0) * (1.0 + 0.25 * dg * n);
    }

    // vignette: beam landing falls off towards the edges, and hard into the corners
    vec2 qn = q / vec2(uTube.x, 1.0);
    float vig = 1.0 - uSurface.x * (0.55 * dot(qn, qn) + 0.45 * pow(dot(qn * qn, qn * qn), 1.5));
    vig *= smoothstep(0.0, 0.07, -sd) * 0.35 + 0.65;
    col *= max(vig, 0.0);

    // the glass: near-black grey-green, with the room softly reflected in its convex face
    vec3 nrm = normalize(vec3(q / 2.4, 1.0));
    vec2 r = nrm.xy * 2.0 * nrm.z;
    // a broad sheen from somewhere up and to the left, and the top of the glass catching it
    vec2 sd2 = (r - vec2(-0.48, 0.46)) / vec2(0.6, 0.28);
    float sheen = exp(-pow(dot(sd2, sd2), 1.6) * 1.2) * smoothstep(-0.5, 0.4, sd2.y + 0.25 * sd2.x);
    float env = smoothstep(-1.0, 1.0, r.y - 0.3 * r.x);
    float edge = smoothstep(-0.14, -0.02, sd) * smoothstep(0.1, 0.9, qn.y) * (1.0 - 0.6 * abs(qn.x));
    float charge = uPower.x;
    vec3 glass = uGlass * mix(1.4, 1.0, charge) * (0.6 + 0.8 * env);
    float refl = (sheen * 1.5 + edge * 0.8) * (1.0 - 0.75 * charge) + 0.10 * env * env * (1.0 - 0.5 * charge);
    // the reflection lies over the phosphor screen: it shows the grille behind the glass
    vec3 behind = mix(vec3(1.0), grille(frag), 0.35 * (1.0 - charge));
    col += (glass + uSurface.y * vec3(0.82, 0.92, 1.0) * refl) * behind;
    // a thin dark gap where the phosphor ends and the glass curves into the bezel
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.035, -sd));
    col *= inside;
  }

  // outside the tube: light falling onto the bezel and the dark around it
  float out_ = 1.0 - inside;
  if (out_ > 0.0) {
    float d = max(sd, 0.0);
    // bezel lip: the inner edge mirrors the picture's edge
    vec2 e = vec2(aa, 0.0);
    vec2 n = normalize(vec2(sdTube(q + e.xy) - sdTube(q - e.xy), sdTube(q + e.yx) - sdTube(q - e.yx)) + 1e-6);
    vec2 qm = q - n * (2.0 * d + 0.02);
    vec2 im = qm / vec2(uTube.x, 1.0) * uOverscan;
    vec3 mir = DEC(texture(uBloom, vec2(im.x / uPad * 0.5 + 0.5, 0.5 - im.y / uPad * 0.5)).rgb);
    float lip = exp(-d / 0.022) * smoothstep(0.0, aa * 2.0, d);
    // the glow textures only cover the padded domain: fade out before their clamped edges
    vec2 pe = abs(puv - 0.5);
    vec3 spill = halo * uGlow.z * smoothstep(0.5, 0.26, max(pe.x, pe.y));
    // the wide ambient wash, from the coarsest glow level at the nearest edge
    vec2 qe = q - n * d;
    vec2 ie = qe / vec2(uTube.x, 1.0) * uOverscan * 0.9;
    vec3 amb = DEC(texture(uAmb, vec2(ie.x / uPad * 0.5 + 0.5, 0.5 - ie.y / uPad * 0.5)).rgb);
    spill += amb * 0.35 * uGlow.z * exp(-d / 0.16);
    col += out_ * (mir * uGlow.w * lip + spill + uGlass * 0.12);
  }

  // grain and dither, then out
  vec3 c = shoulder(col);
  c = pow(max(c, 0.0), vec3(1.0 / uSurface.w));
  float n1 = hash(frag + uSeed * 17.0), n2 = hash(frag.yx * 1.37 + uSeed * 29.0 + 7.0);
  c += (n1 - 0.5) * uSurface.z * (0.4 + 0.6 * inside);
  c += (n1 + n2 - 1.0) / 255.0;
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  return s;
}

// Without float render targets, intermediate light is stored square-root encoded in 8 bits.
const codec = (ldr) => ldr
  ? '#define DEC(c) ((c) * (c))\n#define ENC(c) sqrt(max(c, 0.0))\n'
  : '#define DEC(c) (c)\n#define ENC(c) (c)\n';

function program(gl, fs, ldr) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs.replace('#version 300 es', '#version 300 es\n' + codec(ldr))));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}

// Solve barrel(p) = edge along one axis: where the tube edge lands on screen, in q units.
function screenEdge(curve, axis) {
  const A2 = ASPECT * ASPECT + 1;
  const target = axis === 0 ? ASPECT : 1;
  let x = target;
  for (let i = 0; i < 20; i++) {
    const r2 = (x * x) / A2;
    const f = x * (1 + curve * r2 + curve * 0.5 * r2 * r2) - target;
    const df = 1 + 3 * curve * r2 + 2.5 * curve * r2 * r2;
    x -= f / df;
  }
  return x;
}

// Where the tube sits in a window of w x h (any units): centre and scale (units per q).
export function fitTube(w, h, look = LOOK) {
  const ex = screenEdge(look.curve, 0), ey = screenEdge(look.curve, 1);
  const a = w / h;
  const cover = Math.max(w / 2 / ex, h / 2 / ey) * 1.012;
  // never crop more of the picture than this (fractions of its height and width that stay visible);
  // the demo keeps its essentials in x 32-224, y 40-200. Narrow windows get a zoomed contain that
  // crops the sides a little and lets the glow spill into the dark above and below.
  const minV = 0.67, minH = 0.86;
  const maxV = (h / 2) * look.overscan / minV;
  const maxH = (w / 2) * look.overscan / (ASPECT * minH);
  const s = Math.min(cover, maxV, maxH);
  // portrait: sit a touch above centre, like a set on a low table
  const lift = (1 - smooth(0.55, 1.0, a)) * 0.035 * h;
  return { s, cx: w / 2, cy: h / 2 + lift };
}
function smooth(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

export class CRT {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    this.look = { ...LOOK };
    this.forceLdr = new URLSearchParams(location.search).has('ldr');
    this.init();
  }

  init() {
    const gl = this.gl;
    // (again after a lost context: extensions don't survive it)
    this.hdr = !!gl.getExtension('EXT_color_buffer_float') && !this.forceLdr;
    this.progs = {
      signal: program(gl, FS_SIGNAL, !this.hdr),
      phosphor: program(gl, FS_PHOSPHOR, !this.hdr),
      glow0: program(gl, FS_GLOW0, !this.hdr),
      down: program(gl, FS_DOWN, !this.hdr),
      up: program(gl, FS_UP, !this.hdr),
      tube: program(gl, FS_TUBE, !this.hdr),
    };
    this.vao = gl.createVertexArray();
    this.nesTex = this.tex(NES_W, NES_H, false, gl.NEAREST);
    this.raw = this.target(NES_W * 2, NES_H);
    this.sig = [this.target(NES_W * 2, NES_H), this.target(NES_W * 2, NES_H)];
    this.cur = 0;
    this.hasPrev = 0;
    // glow pyramid: level 0 covers the padded domain at half the NES resolution
    const pad = this.look.pad;
    let w = Math.round(NES_W * 0.5 * pad), h = Math.round(NES_H * 0.5 * pad);
    this.levels = [];
    for (let i = 0; i < 6; i++) { this.levels.push(this.target(w, h)); w = Math.max(2, w >> 1); h = Math.max(2, h >> 1); }
    this.ups = this.levels.slice(0, -1).map((l) => this.target(l.w, l.h));
    this.frames = 0;
    this.lost = false;
  }

  tex(w, h, hdr, filter) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w, h) {
    const gl = this.gl, t = this.tex(w, h, this.hdr, gl.LINEAR), f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, f, w, h };
  }

  bind(unit, tex) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  draw(target, prog) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
    gl.viewport(0, 0, target ? target.w : this.canvas.width, target ? target.h : this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // A new field from the NES (Uint32Array 256x240, bytes R,G,B,x).
  frame(buf) {
    if (this.lost) return;
    const gl = this.gl, L = this.look;
    this.bind(0, this.nesTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NES_W, NES_H, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buf.buffer, buf.byteOffset, NES_W * NES_H * 4));
    let { p, u } = this.progs.signal;
    gl.useProgram(p);
    gl.bindVertexArray(this.vao);
    gl.uniform1i(u.uNes, 0);
    gl.uniform4f(u.uFilt, L.lumaSigma, L.lumaPeak, L.chromaI, L.chromaQ);
    gl.uniform1f(u.uLag, L.chromaLag);
    gl.uniform1f(u.uGammaIn, L.gammaIn);
    this.draw(this.raw);
    const prev = this.sig[this.cur];
    this.cur ^= 1;
    ({ p, u } = this.progs.phosphor);
    gl.useProgram(p);
    this.bind(0, this.raw.t); gl.uniform1i(u.uRaw, 0);
    this.bind(1, prev.t); gl.uniform1i(u.uPrev, 1);
    gl.uniform3fv(u.uDecay, L.persist);
    gl.uniform2f(u.uConv, L.convergence[0], L.convergence[1]);
    gl.uniform1f(u.uHasPrev, this.hasPrev);
    this.draw(this.sig[this.cur]);
    this.hasPrev = 1;
    this.frames++;
  }

  // Draw the tube. state: { on (glass charge 0..1), raster [hx, vy, gain], line, degauss, time, seed }
  render(state) {
    if (this.lost) return;
    const gl = this.gl, L = this.look, cw = this.canvas.width, ch = this.canvas.height;
    gl.bindVertexArray(this.vao);
    const sig = this.sig[this.cur].t;
    const common = (u) => {
      gl.uniform2f(u.uTube, ASPECT, L.corner);
      gl.uniform1f(u.uOverscan, L.overscan);
      gl.uniform4f(u.uRaster, state.raster[0], state.raster[1], state.raster[2], 0);
    };

    // glow level 0
    let { p, u } = this.progs.glow0;
    gl.useProgram(p);
    common(u);
    this.bind(0, sig); gl.uniform1i(u.uSig, 0);
    gl.uniform1f(u.uPad, L.pad);
    const l0 = this.levels[0];
    gl.uniform2f(u.uTexel, (2 * L.pad) / l0.w, (2 * L.pad) / l0.h);
    this.draw(l0);
    // down
    ({ p, u } = this.progs.down);
    gl.useProgram(p);
    gl.uniform1i(u.uSrc, 0);
    for (let i = 1; i < this.levels.length; i++) {
      const s = this.levels[i - 1];
      this.bind(0, s.t);
      gl.uniform2f(u.uTexel, 1 / s.w, 1 / s.h);
      this.draw(this.levels[i]);
    }
    // up: accumulate coarse to fine, stopping at level 1 (the halo); level 0 is the bloom
    ({ p, u } = this.progs.up);
    gl.useProgram(p);
    gl.uniform1i(u.uSrc, 0); gl.uniform1i(u.uBase, 1);
    gl.uniform1f(u.uMix, 0.62);
    let src = this.levels[this.levels.length - 1];
    for (let i = this.levels.length - 2; i >= 1; i--) {
      this.bind(0, src.t); this.bind(1, this.levels[i].t);
      gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h);
      this.draw(this.ups[i]);
      src = this.ups[i];
    }
    const halo = this.ups[1];

    // tube
    ({ p, u } = this.progs.tube);
    gl.useProgram(p);
    common(u);
    this.bind(0, sig); gl.uniform1i(u.uSig, 0);
    this.bind(1, l0.t); gl.uniform1i(u.uBloom, 1);
    this.bind(2, halo.t); gl.uniform1i(u.uHalo, 2);
    this.bind(3, this.levels[3].t); gl.uniform1i(u.uAmb, 3);
    const fit = fitTube(cw, ch, L);
    const breathe = state.breathe || 1;
    gl.uniform2f(u.uCenter, fit.cx, ch - fit.cy);
    gl.uniform1f(u.uScale, fit.s * breathe);
    gl.uniform1f(u.uCurve, L.curve);
    gl.uniform1f(u.uPad, L.pad);
    gl.uniform4f(u.uBeam, L.beamMin, L.beamMax, L.beamNorm, L.gain);
    gl.uniform3f(u.uMask, L.mask * this.maskScale, L.maskComp, this.triad);
    gl.uniform4f(u.uGlow, L.bloom, L.halo, L.spill, L.lip);
    gl.uniform4f(u.uSurface, L.vignette, L.reflection, L.grain, L.gammaOut);
    gl.uniform3fv(u.uGlass, L.glass);
    gl.uniform4f(u.uPower, state.on, state.line, state.degauss, state.time);
    gl.uniform1f(u.uSeed, state.seed % 1000);
    this.draw(null);
  }

  resize(w, h, dpr) {
    this.canvas.width = w;
    this.canvas.height = h;
    // aperture grille: an RGB triad of 3 device pixels when they're small enough to vanish
    // into texture, magenta/green pairs when a triad would be coarse next to the scanlines
    const fit = fitTube(w, h, this.look);
    const pxPerLine = (fit.s * 2) / (240 * this.look.overscan);
    this.triad = pxPerLine >= 4.2 || dpr >= 1.75 ? 3 : 2;
    // big device pixels make a coarse grille: keep it shallower there
    // and fade it as the picture gets small, the way it vanishes from across the room
    this.maskScale = (dpr >= 1.75 ? 1 : 0.6) * Math.min(1, Math.max(0.35, (pxPerLine - 1.5) / 3.5));
  }
}
