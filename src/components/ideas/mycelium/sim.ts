// Mycelium: a Physarum polycephalum transport-network simulation after Jeff Jones
// (2010) and Sage Jenson. Agent state lives in an RGBA32F texture (x, y, heading),
// each step every agent samples the trail map ahead-left / ahead / ahead-right,
// turns towards the strongest scent, moves, and deposits. The trail map diffuses
// and decays. The page's text is rasterised into a mask: the lines are obstacles,
// and a faint nutrient halo around them draws the network in to cradle the words.

import { palettes, mulberry32, type Palette } from './palettes';

type Regime = {
  name: string;
  sa: number; // sensor angle (deg)
  ra: number; // rotation angle (deg)
  so: number; // sensor offset (css px)
  ss: number; // step size (css px)
  dep: number; // deposit per agent
  decay: number; // per step
  diffuse: number; // 0..1 blend toward 3x3 mean
  density: number; // agents per sim pixel
  exposure: number;
  food: number; // minimum nutrient spots
};

// Known-beautiful regions of Jones's parameter space, nudged by the seed.
const REGIMES: Regime[] = [
  // reticulate transport networks (SA > RA): polygonal cells that slowly breathe and re-route
  { name: 'reticulum', sa: 60, ra: 25, so: 12, ss: 1.1, dep: 1, decay: 0.9, diffuse: 1, density: 1.3, exposure: 0.16, food: 0 },
  { name: 'lace', sa: 60, ra: 25, so: 12, ss: 1.1, dep: 1, decay: 0.97, diffuse: 0.15, density: 1.3, exposure: 0.22, food: 0 },
  { name: 'fibres', sa: 60, ra: 25, so: 13, ss: 1.1, dep: 1, decay: 0.95, diffuse: 0.3, density: 1.3, exposure: 0.21, food: 0 },
  { name: 'cells', sa: 70, ra: 30, so: 18, ss: 1.2, dep: 1, decay: 0.9, diffuse: 1, density: 1.2, exposure: 0.16, food: 0 },
  // meandering labyrinth (wide sensors, gentle turns)
  { name: 'labyrinth', sa: 80, ra: 20, so: 10, ss: 1.1, dep: 1, decay: 0.9, diffuse: 1, density: 1.3, exposure: 0.16, food: 0 },
];

// Agents are always dusted evenly: dense inocula persist as hot clots, and radial
// starts meet at the wrap-around seam. The spawn pattern sets the opening headings:
// random, or combed along one axis (which grows a woven, directional first minute).
const SPAWNS = ['scatter', 'grain'] as const;
type Spawn = (typeof SPAWNS)[number];

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*.5+.5; gl_Position = vec4(aPos,0.,1.); }`;

const HASH = `
uint pcg(uint v){ uint s = v*747796405u+2891336453u; uint w = ((s >> ((s >> 28u)+4u)) ^ s)*277803737u; return (w >> 22u) ^ w; }
float rnd(inout uint s){ s = pcg(s); return float(s)/4294967295.; }`;

const UPDATE_FS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uAgents, uTrail, uMask;
uniform vec2 uRes; uniform float uSA, uRA, uSO, uSS; uniform uint uFrame;
out vec4 o;
${HASH}
float sense(vec2 p, float a){
  vec2 uv = (p + uSO*vec2(cos(a), sin(a)))/uRes;
  return texture(uTrail, uv).r - texture(uMask, uv).r*50.;
}
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uAgents, c, 0);
  uint s = uint(c.x)*1973u + uint(c.y)*9277u + uFrame*26699u;
  vec2 p = a.xy; float h = a.z;
  float F = sense(p, h), L = sense(p, h+uSA), R = sense(p, h-uSA);
  float r = rnd(s);
  if (F > L && F > R) {}
  else if (F < L && F < R) h += (r < .5 ? 1. : -1.)*uRA;
  else if (L > R) h += uRA*(.75+.5*r);
  else if (R > L) h -= uRA*(.75+.5*r);
  h += (rnd(s)-.5)*.08;
  vec2 np = p + uSS*vec2(cos(h), sin(h));
  np = mod(np, uRes);
  if (texture(uMask, np/uRes).r > .5) { np = p; h = rnd(s)*6.2831853; }
  o = vec4(np, mod(h, 6.2831853), a.w);
}`;

const DIFFUSE_FS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uTrail, uMask; uniform vec2 uRes; uniform float uDecay, uDiffuse, uFood;
uniform vec3 uCursor; // xy sim px, z strength
in vec2 vUv; out vec4 o;
void main(){
  vec2 px = 1./uRes; float sum = 0.;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) sum += texture(uTrail, vUv+vec2(i,j)*px).r;
  float c = texture(uTrail, vUv).r;
  float v = mix(c, sum/9., uDiffuse)*uDecay;
  vec4 m = texture(uMask, vUv);
  v += m.g*uFood;
  vec2 d = gl_FragCoord.xy - uCursor.xy; d = d - uRes*round(d/uRes);
  v += uCursor.z*exp(-dot(d,d)/18.);
  v *= 1. - m.r;
  o = vec4(v, 0., 0., 1.);
}`;

const DEPOSIT_VS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uAgents; uniform vec2 uRes; uniform int uW;
void main(){
  ivec2 c = ivec2(gl_VertexID % uW, gl_VertexID / uW);
  vec4 a = texelFetch(uAgents, c, 0);
  gl_Position = vec4(a.xy/uRes*2.-1., 0., 1.); gl_PointSize = 1.;
}`;
const DEPOSIT_FS = `#version 300 es
precision highp float; uniform float uDep; out vec4 o; void main(){ o = vec4(uDep,0.,0.,1.); }`;

const DISPLAY_FS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uTrail, uMask; uniform vec2 uRes, uCanvas; uniform float uExposure, uTime, uLight, uFade, uView0, uViewH;
uniform vec3 uC0, uC1, uC2, uC3, uC4, uGlow;
in vec2 vUv; out vec4 o;
${HASH}
vec3 ramp(float t){
  t = clamp(t, 0., 1.);
  if (t < .2) return mix(uC0, uC1, smoothstep(0., .2, t));
  if (t < .5) return mix(uC1, uC2, smoothstep(.2, .5, t));
  if (t < .8) return mix(uC2, uC3, smoothstep(.5, .8, t));
  return mix(uC3, uC4, smoothstep(.8, 1., t));
}
void main(){
  vec2 uv = vUv;
  float t = texture(uTrail, uv).r;
  vec2 px = 1./uRes; float g = 0.;
  for (int i=0;i<12;i++){
    float a = float(i)*2.3999632; float r = 2.5 + float(i)*0.9;
    g += texture(uTrail, uv + r*px*vec2(cos(a), sin(a))).r;
  }
  g /= 12.;
  vec4 m = texture(uMask, uv);
  float clear = m.b;
  float v = 1. - exp(-t*uExposure);
  float gv = 1. - exp(-g*uExposure*.8);
  v = pow(v, 1.15) * clear;
  gv *= mix(.25, 1., clear);
  vec3 col = ramp(v);
  if (uLight > .5) col = mix(col, uGlow, gv*.3*(1.-v));
  else col += uGlow*gv*.45;
  // vignette over the visible viewport, not the whole document
  vec2 sc = vec2(uv.x, ((1.-uv.y)*uCanvas.y - uView0)/uViewH);
  vec2 q = sc - .5; float vig = 1. - dot(q*vec2(1.1,.9), q*vec2(1.1,.9))*.9;
  col = mix(uC0, col, clamp(vig, 0., 1.));
  col = mix(uC0, col, uFade);
  uint s = uint(gl_FragCoord.x)*7919u + uint(gl_FragCoord.y)*104729u + uint(uTime*60.)*15485863u;
  col += (rnd(s) + rnd(s) - 1.)*(uLight > .5 ? .022 : .016);
  o = vec4(col, 1.);
}`;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function start(canvas: HTMLCanvasElement, textRoot: HTMLElement, seed: number) {
  const rand = mulberry32(seed);
  const palette: Palette = palettes[Math.floor(rand() * palettes.length)];
  const base = REGIMES[Math.floor(rand() * REGIMES.length)];
  const j = (v: number, f: number) => v * (1 + (rand() * 2 - 1) * f);
  const R: Regime = {
    ...base,
    sa: j(base.sa, 0.1), ra: j(base.ra, 0.1), so: j(base.so, 0.15), ss: j(base.ss, 0.1),
    decay: Math.min(0.975, j(base.decay, 0.01)),
  };
  const spawn: Spawn = SPAWNS[Math.floor(rand() * SPAWNS.length)];
  const foodSpots = R.food + Math.floor(rand() * 4);
  const foodSeed = Math.floor(rand() * 1e9);
  const spawnSeed = Math.floor(rand() * 1e9);
  const drift = rand() * Math.PI * 2;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 700px), (pointer: coarse)').matches;

  function compile(type: number, src: string) {
    const sh = gl!.createShader(type)!;
    gl!.shaderSource(sh, src); gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(sh) || 'shader');
    return sh;
  }
  function program(vs: string, fs: string) {
    const p = gl!.createProgram()!;
    gl!.attachShader(p, compile(gl!.VERTEX_SHADER, vs)); gl!.attachShader(p, compile(gl!.FRAGMENT_SHADER, fs));
    gl!.bindAttribLocation(p, 0, 'aPos'); gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) || 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl!.getProgramParameter(p, gl!.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl!.getActiveUniform(p, i)!.name; u[name] = gl!.getUniformLocation(p, name); }
    return { p, u };
  }
  const pUpdate = program(VS, UPDATE_FS);
  const pDiffuse = program(VS, DIFFUSE_FS);
  const pDeposit = program(DEPOSIT_VS, DEPOSIT_FS);
  const pDisplay = program(VS, DISPLAY_FS);

  const quad = gl.createVertexArray()!;
  gl.bindVertexArray(quad);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const empty = gl.createVertexArray()!;

  function tex(w: number, h: number, internal: number, format: number, type: number, filter: number, data: ArrayBufferView | null = null) {
    const t = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.REPEAT);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.REPEAT);
    return t;
  }
  function fbo(t: WebGLTexture) {
    const f = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, f);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, t, 0);
    return f;
  }

  // ---- state (rebuilt on resize) ----
  let SW = 0, SH = 0, scale = 1, AW = 1024, AH = 1, rows = 1, cssW = 0, cssH = 0;
  let agents: { t: WebGLTexture; f: WebGLFramebuffer }[] = [];
  let trail: { t: WebGLTexture; f: WebGLFramebuffer }[] = [];
  let mask: WebGLTexture | null = null;
  let frame = 0;

  function buildMask(): { data: Uint8Array; ob: Uint8Array } {
    const n = SW * SH;
    const raw = new Uint8Array(n);
    const sx = window.scrollX, sy = window.scrollY;
    const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent || !node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) {
        // trim the inline box to the glyph body a little
        const y0 = r.top + r.height * 0.12, y1 = r.bottom - r.height * 0.1;
        const x0i = Math.max(0, Math.floor((r.left + sx) * scale)), x1i = Math.min(SW - 1, Math.ceil((r.right + sx) * scale));
        const y0i = Math.max(0, Math.floor((y0 + sy) * scale)), y1i = Math.min(SH - 1, Math.ceil((y1 + sy) * scale));
        for (let y = y0i; y <= y1i; y++) { const row = (SH - 1 - y) * SW; for (let x = x0i; x <= x1i; x++) raw[row + x] = 1; }
      }
    }
    // chamfer distance transform (in sim px)
    const INF = 1e9;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = raw[i] ? 0 : INF;
    const A = 1, B = 1.4142;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) { v = Math.min(v, d[i - SW] + A); if (x > 0) v = Math.min(v, d[i - SW - 1] + B); if (x < SW - 1) v = Math.min(v, d[i - SW + 1] + B); }
      d[i] = v;
    }
    for (let y = SH - 1; y >= 0; y--) for (let x = SW - 1; x >= 0; x--) {
      const i = y * SW + x; let v = d[i];
      if (x < SW - 1) v = Math.min(v, d[i + 1] + A);
      if (y < SH - 1) { v = Math.min(v, d[i + SW] + A); if (x < SW - 1) v = Math.min(v, d[i + SW + 1] + B); if (x > 0) v = Math.min(v, d[i + SW - 1] + B); }
      d[i] = v;
    }
    const pad = 7 * scale, fade = 16 * scale, ringD = pad + 12 * scale, ringW = 6 * scale;
    // nutrient spots, kept away from the text
    const fr = mulberry32(foodSeed);
    const spots: [number, number, number][] = [];
    for (let k = 0, tries = 0; k < foodSpots && tries < 200; tries++) {
      const x = fr() * SW, y = fr() * SH;
      const di = d[Math.floor(y) * SW + Math.floor(x)];
      if (di < 60 * scale) continue;
      spots.push([x, y, (3 + fr() * 5) * scale]); k++;
    }
    // the nutrient halo is patchy, so the network touches the words at a few points
    const lat = new Float32Array(64 * 64).map(() => fr());
    const vn = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const g = (a: number, b: number) => lat[(((b & 63) * 64) + (a & 63))];
      const sx2 = xf * xf * (3 - 2 * xf), sy2 = yf * yf * (3 - 2 * yf);
      return (g(xi, yi) * (1 - sx2) + g(xi + 1, yi) * sx2) * (1 - sy2) + (g(xi, yi + 1) * (1 - sx2) + g(xi + 1, yi + 1) * sx2) * sy2;
    };
    const patch = (x: number, y: number) => Math.max(0, vn(x / 46, y / 46) - 0.55) * 2.2;
    const data = new Uint8Array(n * 4);
    const ob = new Uint8Array(n);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x; const di = d[i];
      const o = di < pad ? 1 : 0; ob[i] = o;
      let food = di < pad || di > ringD + 3 * ringW ? 0 : Math.exp(-(((di - ringD) / ringW) ** 2)) * patch(x / scale, y / scale);
      for (const [fx, fy, fs] of spots) { const dx = x - fx, dy = y - fy; food += Math.exp(-(dx * dx + dy * dy) / (fs * fs)) * 1.5; }
      const t = Math.min(1, Math.max(0, (di - pad) / fade));
      data[i * 4] = o * 255;
      data[i * 4 + 1] = Math.min(255, food * 255);
      data[i * 4 + 2] = Math.round(t * t * (3 - 2 * t) * 255);
      data[i * 4 + 3] = 255;
    }
    return { data, ob };
  }

  function build() {
    cssW = document.documentElement.clientWidth;
    cssH = Math.max(window.innerHeight, document.documentElement.scrollHeight);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const target = small ? 300000 : 760000;
    scale = Math.min(1, Math.sqrt(target / (cssW * cssH)));
    SW = Math.round(cssW * scale); SH = Math.round(cssH * scale);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    // the canvas can be tall on phones; keep its backing store sane
    if (canvas.width * canvas.height > 6e6) { const k = Math.sqrt(6e6 / (canvas.width * canvas.height)); canvas.width = Math.round(canvas.width * k); canvas.height = Math.round(canvas.height * k); }

    const cap = small ? 262144 : 1048576;
    const N = Math.min(cap, Math.round(SW * SH * R.density));
    AW = 1024; AH = Math.max(1, Math.ceil(N / AW)); rows = AH;

    for (const a of [...agents, ...trail]) { gl!.deleteTexture(a.t); gl!.deleteFramebuffer(a.f); }
    if (mask) gl!.deleteTexture(mask);

    const { data, ob } = buildMask();
    gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1);
    mask = tex(SW, SH, gl!.RGBA8, gl!.RGBA, gl!.UNSIGNED_BYTE, gl!.LINEAR, data);

    // spawn
    const sr = mulberry32(spawnSeed);
    const A = new Float32Array(AW * AH * 4);
    const grainA = sr() * Math.PI;
    for (let i = 0; i < AW * AH; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = sr() * SW; y = sr() * SH;
        if (!ob[Math.floor(y) * SW + Math.floor(x)]) break;
      }
      let h = sr() * 6.2831853;
      if (spawn === 'grain') h = grainA + (sr() < 0.5 ? 0 : Math.PI) + (sr() - 0.5) * 0.5;
      A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = h; A[i * 4 + 3] = sr();
    }
    agents = [0, 1].map((k) => { const t = tex(AW, AH, gl!.RGBA32F, gl!.RGBA, gl!.FLOAT, gl!.NEAREST, k === 0 ? A : null); return { t, f: fbo(t) }; });
    trail = [0, 1].map(() => { const t = tex(SW, SH, gl!.R16F, gl!.RED, gl!.HALF_FLOAT, gl!.LINEAR); return { t, f: fbo(t) }; });
    for (const tr of trail) { gl!.bindFramebuffer(gl!.FRAMEBUFFER, tr.f); gl!.clearColor(0, 0, 0, 1); gl!.clear(gl!.COLOR_BUFFER_BIT); }
    frame = 0;
  }

  const C = palette.ramp.map(hex);
  const G = hex(palette.glow);
  let cursor = [0, 0, 0];
  let lastPointer: [number, number] | null = null;
  window.addEventListener('pointermove', (e) => {
    const x = (e.clientX + window.scrollX) * scale, y = SH - (e.clientY + window.scrollY) * scale;
    const moved = lastPointer ? Math.hypot(e.clientX - lastPointer[0], e.clientY - lastPointer[1]) : 0;
    lastPointer = [e.clientX, e.clientY];
    cursor = [x, y, Math.min(4, cursor[2] + moved * 0.06)];
  }, { passive: true });

  function bindTex(unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null) {
    gl!.activeTexture(gl!.TEXTURE0 + unit); gl!.bindTexture(gl!.TEXTURE_2D, t); gl!.uniform1i(loc, unit);
  }

  let time = 0;
  function step() {
    const t = time;
    // the network slowly re-routes as the sensor geometry breathes
    const breathe = 1 + 0.12 * Math.sin(t * 0.021 + drift);
    gl!.bindVertexArray(quad);
    // 1. agents sense, turn, move
    gl!.useProgram(pUpdate.p);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, agents[1].f);
    gl!.viewport(0, 0, AW, rows);
    bindTex(0, agents[0].t, pUpdate.u.uAgents); bindTex(1, trail[0].t, pUpdate.u.uTrail); bindTex(2, mask!, pUpdate.u.uMask);
    gl!.uniform2f(pUpdate.u.uRes, SW, SH);
    gl!.uniform1f(pUpdate.u.uSA, (R.sa * breathe * Math.PI) / 180);
    gl!.uniform1f(pUpdate.u.uRA, (R.ra * Math.PI) / 180);
    gl!.uniform1f(pUpdate.u.uSO, R.so * scale);
    gl!.uniform1f(pUpdate.u.uSS, R.ss * scale);
    gl!.uniform1ui(pUpdate.u.uFrame, frame);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    agents.reverse();
    // 2. diffuse + decay + nutrients
    gl!.useProgram(pDiffuse.p);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, trail[1].f);
    gl!.viewport(0, 0, SW, SH);
    bindTex(0, trail[0].t, pDiffuse.u.uTrail); bindTex(1, mask!, pDiffuse.u.uMask);
    gl!.uniform2f(pDiffuse.u.uRes, SW, SH);
    gl!.uniform1f(pDiffuse.u.uDecay, R.decay);
    gl!.uniform1f(pDiffuse.u.uDiffuse, R.diffuse);
    gl!.uniform1f(pDiffuse.u.uFood, 0.6 * R.dep * R.density);
    gl!.uniform3f(pDiffuse.u.uCursor, cursor[0], cursor[1], cursor[2] * R.dep * 8);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    cursor[2] *= 0.9;
    // 3. deposit
    gl!.bindVertexArray(empty);
    gl!.useProgram(pDeposit.p);
    gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.ONE, gl!.ONE);
    bindTex(0, agents[0].t, pDeposit.u.uAgents);
    gl!.uniform2f(pDeposit.u.uRes, SW, SH);
    gl!.uniform1i(pDeposit.u.uW, AW);
    gl!.uniform1f(pDeposit.u.uDep, R.dep);
    gl!.drawArrays(gl!.POINTS, 0, AW * rows);
    gl!.disable(gl!.BLEND);
    trail.reverse();
    frame++;
  }

  let fade = 0;
  function draw() {
    gl!.bindVertexArray(quad);
    gl!.useProgram(pDisplay.p);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    // the canvas spans the whole document; only shade the part on screen
    const k = canvas.height / cssH;
    const y0 = Math.max(0, Math.floor((cssH - window.scrollY - window.innerHeight) * k) - 2);
    const y1 = Math.min(canvas.height, Math.ceil((cssH - window.scrollY) * k) + 2);
    gl!.enable(gl!.SCISSOR_TEST); gl!.scissor(0, y0, canvas.width, y1 - y0);
    bindTex(0, trail[0].t, pDisplay.u.uTrail); bindTex(1, mask!, pDisplay.u.uMask);
    gl!.uniform2f(pDisplay.u.uRes, SW, SH);
    gl!.uniform2f(pDisplay.u.uCanvas, cssW, cssH);
    gl!.uniform1f(pDisplay.u.uExposure, R.exposure * (1 - R.decay) / (R.density * R.dep));
    gl!.uniform1f(pDisplay.u.uTime, time);
    gl!.uniform1f(pDisplay.u.uLight, palette.light ? 1 : 0);
    gl!.uniform1f(pDisplay.u.uFade, fade);
    gl!.uniform1f(pDisplay.u.uView0, window.scrollY);
    gl!.uniform1f(pDisplay.u.uViewH, window.innerHeight);
    ['uC0', 'uC1', 'uC2', 'uC3', 'uC4'].forEach((k, i) => gl!.uniform3fv(pDisplay.u[k], C[i]));
    gl!.uniform3fv(pDisplay.u.uGlow, G);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.disable(gl!.SCISSOR_TEST);
  }

  build();
  const warm = reduced ? 700 : 0;
  for (let i = 0; i < warm; i++) { step(); time += 1 / 60; }
  if (warm) fade = 1;

  let raf = 0, last = performance.now(), slow = 0, running = false;
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    // adaptive: shed agents if the machine is struggling
    if (frame > 90) { if (dt > 0.026) slow++; else slow = Math.max(0, slow - 1); if (slow > 45 && rows > AH / 4) { rows = Math.floor(rows * 0.75); slow = 0; } }
    time += 1 / 60;
    step();
    fade = Math.min(1, fade + dt / 2.5);
    draw();
  }
  function play() { if (running || reduced) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function pause() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  window.addEventListener('scroll', () => { if (!running) requestAnimationFrame(draw); }, { passive: true });
  if (reduced) { draw(); } else play();

  let lastW = cssW, lastH = cssH, rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = window.setTimeout(() => {
      const w = document.documentElement.clientWidth, h = Math.max(window.innerHeight, document.documentElement.scrollHeight);
      if (w === lastW && Math.abs(h - lastH) < 120) return;
      lastW = w; lastH = h; build();
      if (reduced) { for (let i = 0; i < 700; i++) step(); fade = 1; draw(); }
    }, 250);
  });
  return { palette, regime: R, spawn };
}
