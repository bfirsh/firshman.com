// Chladni: sand on a vibrating plate.
// Grains live in plate coordinates [-1, 1]². Each tick a grain is kicked by a random
// hop whose size is proportional to the local vibration amplitude |f|, and slides a
// little down the gradient of f² (grains bounce off the antinodes and come to rest
// where the plate is still). So they gather on the nodal lines. The "tone" glides
// through a seeded composition of modes and the sand visibly migrates between figures.

import { SQUARE_MODES, CIRCLE_MODES, buildField, pitch, type Mode, type Field } from './modes';

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- curated looks: [sand, plate material, room]. Every combination here was checked by eye.
type Sand = { name: string; col: string; var: number };
type Plate = { name: string; col: string; mat: number; spec: number };
type Room = { name: string; a: string; b: string; ink: string; dim: string; light: boolean };
export const SANDS: Record<string, Sand> = {
  quartz: { name: 'white quartz', col: '#f2ece0', var: 0.18 },
  volcanic: { name: 'black volcanic', col: '#1d1b1c', var: 0.35 },
  ochre: { name: 'ochre', col: '#d39448', var: 0.22 },
  coral: { name: 'coral', col: '#efc4b0', var: 0.15 },
};
export const PLATES: Record<string, Plate> = {
  lacquer: { name: 'black lacquer', col: '#121214', mat: 0, spec: 0.16 },
  steel: { name: 'brushed steel', col: '#8c9095', mat: 1, spec: 0.22 },
  brass: { name: 'brass', col: '#9c7a45', mat: 2, spec: 0.18 },
  verdigris: { name: 'verdigris', col: '#3d6b62', mat: 3, spec: 0.08 },
  slate: { name: 'slate', col: '#2b3139', mat: 2, spec: 0.07 },
  bone: { name: 'bone', col: '#d8d0c0', mat: 2, spec: 0.1 },
};
export const ROOMS: Record<string, Room> = {
  charcoal: { name: 'charcoal', a: '#1a1918', b: '#0c0c0c', ink: '#ece6da', dim: '#a39e94', light: false },
  midnight: { name: 'midnight', a: '#141a24', b: '#080b10', ink: '#e6eaf0', dim: '#98a1ae', light: false },
  umber: { name: 'umber', a: '#221a14', b: '#0f0b08', ink: '#efe4d4', dim: '#ab9c88', light: false },
  linen: { name: 'linen', a: '#ece7dd', b: '#d6cfc2', ink: '#1c1a17', dim: '#5f5a52', light: true },
  fog: { name: 'fog', a: '#e4e6e5', b: '#c9cdcd', ink: '#16191b', dim: '#565d62', light: true },
};
export const LOOKS: [string, string, string][] = [
  ['quartz', 'lacquer', 'charcoal'],
  ['quartz', 'slate', 'midnight'],
  ['quartz', 'verdigris', 'umber'],
  ['ochre', 'lacquer', 'umber'],
  ['ochre', 'slate', 'charcoal'],
  ['volcanic', 'steel', 'charcoal'],
  ['volcanic', 'brass', 'umber'],
  ['volcanic', 'bone', 'linen'],
  ['volcanic', 'steel', 'fog'],
  ['coral', 'slate', 'midnight'],
  ['quartz', 'brass', 'charcoal'],
];

export function pickLook(seed: number) {
  const r = mulberry32(seed);
  const [s, p, rm] = LOOKS[Math.floor(r() * LOOKS.length)];
  return { sand: SANDS[s], plate: PLATES[p], room: ROOMS[rm], rand: r };
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PLATE_VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0., 1.); }`;
const PLATE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes, uC; uniform float uR, uShape, uMat, uSpec, uTime, uDpr, uLightRoom;
uniform vec3 uBgA, uBgB, uPlate;
out vec4 o;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i=0;i<4;i++){ s += a*vn(p); p *= 2.03; a *= .5; } return s; }
float sdBox(vec2 p, float r, float k){ vec2 q = abs(p) - vec2(r-k); return length(max(q,0.)) + min(max(q.x,q.y),0.) - k; }
float plateSd(vec2 p){ return uShape < .5 ? sdBox(p, uR, uR*.018) : length(p) - uR; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = px - uC;
  vec2 L = normalize(vec2(-.55, -.85)); // light from upper left (screen space, y down)
  // room: soft vertical falloff, a pool of light around the plate, vignette
  vec2 sv = px/uRes;
  vec3 col = mix(uBgA, uBgB, smoothstep(0., 1.1, sv.y*.7 + length(sv-.5)*.6));
  float pool = exp(-dot(p + L*uR*.35, p + L*uR*.35)/(uR*uR*3.2));
  col *= mix(1., 1.12, pool*(1.-uLightRoom*.6));
  // contact shadow + soft cast shadow
  float d = plateSd(p);
  float dsh = plateSd(p - vec2(.035, .06)*uR);
  float sh = (1. - smoothstep(-uR*.06, uR*.16, dsh))*.55 + (1. - smoothstep(0., uR*.025, d))*.25;
  col *= 1. - sh*(uLightRoom > .5 ? .35 : .7);
  // plate edge (thickness) seen below the top face
  float dEdge = plateSd(p - vec2(0., uDpr*2.5));
  if (dEdge < 0. && d >= 0.) col = mix(uPlate*.42, col, smoothstep(-1., 0., dEdge));
  if (d < 0.) {
    vec2 q = p/uR;
    vec3 base = uPlate;
    float tex = 0.;
    if (uMat < .5) { // lacquer: deep, near flawless, faint orange peel
      tex = (fbm(q*14.) - .5)*.03;
    } else if (uMat < 1.5) { // brushed: anisotropic streaks
      tex = (vn(vec2(q.x*2.5, q.y*420.)) - .5)*.09 + (vn(vec2(q.x*9., q.y*60.)) - .5)*.05;
    } else if (uMat < 2.5) { // matte metal / stone: soft mottling
      tex = (fbm(q*5.) - .5)*.1 + (h21(px) - .5)*.035;
    } else { // patina: two-tone verdigris clouds
      float c = fbm(q*7. + 7.) + (fbm(q*23.) - .5)*.35;
      base = mix(base*.86, base*1.1 + vec3(.01,.025,.02), smoothstep(.3, .8, c));
      tex = (h21(px) - .5)*.04;
    }
    vec3 c = base*(1. + tex);
    // broad soft-box reflection, brighter toward the light
    float g = .86 + .2*dot(-q, L);
    float spec = exp(-dot(q + L*.45, q + L*.45)*1.6);
    c = c*g + vec3(1.,.97,.92)*spec*uSpec;
    // bevel: catch light on the lit rim, shade the far rim
    float rim = smoothstep(-2.2*uDpr, 0., d);
    vec2 nrm = uShape < .5 ? (abs(q.x) > abs(q.y) ? vec2(sign(q.x),0.) : vec2(0.,sign(q.y))) : normalize(q);
    c += rim*max(0., dot(nrm, -L))*.18;
    c *= 1. - rim*max(0., dot(nrm, L))*.35;
    col = mix(c, col, smoothstep(-1., .5, d));
  }
  // film grain + dither
  float n = h21(px + fract(uTime)*91.7) + h21(px*1.37 - fract(uTime*1.3)*53.1) - 1.;
  col += n*(uLightRoom > .5 ? .018 : .014);
  o = vec4(col, 1.);
}`;

const GRAIN_VS = `#version 300 es
in vec3 aG; in float aTone;
uniform vec2 uRes, uC; uniform float uR, uSize, uShadow;
out float vTone; out float vH;
void main(){
  vec2 p = uC + aG.xy*uR*.985;
  float h = aG.z;
  if (uShadow > .5) p += vec2(.6, 1.) * (uSize*.5 + h*uR*.05);
  else p -= vec2(0., h*uR*.02);
  vTone = aTone; vH = h;
  gl_Position = vec4(p.x/uRes.x*2.-1., 1.-p.y/uRes.y*2., 0., 1.);
  gl_PointSize = uSize*(1. + h*.6)*(uShadow > .5 ? 1.5 : 1.);
}`;
const GRAIN_FS = `#version 300 es
precision highp float;
uniform vec3 uSand; uniform float uShadow, uVar, uShadowA;
in float vTone; in float vH; out vec4 o;
void main(){
  vec2 c = gl_PointCoord*2. - 1.;
  float r = dot(c, c);
  if (r > 1.) discard;
  if (uShadow > .5) { o = vec4(0., 0., 0., uShadowA*(1. - r)/(1. + vH*3.)); return; }
  float lit = .82 + .38*clamp(dot(c, vec2(-.55, -.85)), -1., 1.);
  vec3 col = uSand*(1. + (vTone - .5)*uVar*2.)*lit;
  o = vec4(col, smoothstep(1., .55, r));
}`;

export function start(canvas: HTMLCanvasElement, slot: HTMLElement, seed: number, onMode?: (hz: number) => void) {
  const look = pickLook(seed);
  const rand = look.rand;
  const shape: 'square' | 'circle' = rand() < 0.6 ? 'square' : 'circle';
  const pool: Mode[] = shape === 'square' ? SQUARE_MODES : CIRCLE_MODES;
  // a composition: a handful of modes arranged as a rising-then-falling phrase
  const len = 6 + Math.floor(rand() * 4);
  const picks: Mode[] = [];
  const idx = pool.map((_, i) => i);
  for (let i = 0; i < len && idx.length; i++) picks.push(pool[idx.splice(Math.floor(rand() * idx.length), 1)[0]]);
  picks.sort((a, b) => pitch(a) - pitch(b));
  const phrase = [...picks.filter((_, i) => i % 2 === 0), ...picks.filter((_, i) => i % 2 === 1).reverse()];
  const hold = 9 + rand() * 7; // seconds resting on each figure
  const glide = 3.5 + rand() * 3; // seconds gliding between them
  const rot = shape === 'circle' ? Math.floor(rand() * 4) * (Math.PI / 4) * (rand() < 0.5 ? 1 : 0.5) : 0;
  const offset = Math.floor(rand() * phrase.length);

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) return null;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const N = small ? 36000 : 80000;
  const G = 320;

  const fields = new Map<number, Field>();
  const field = (i: number) => {
    const k = ((i % phrase.length) + phrase.length) % phrase.length;
    if (!fields.has(k)) fields.set(k, buildField(phrase[k], G, rot));
    return fields.get(k)!;
  };

  // ---- grains ----
  const P = new Float32Array(N * 3); // x, y, hop height
  const tone = new Float32Array(N);
  // static friction: a grain only moves when the plate shakes harder than it sticks
  const stick = new Float32Array(N);
  const sr = mulberry32(seed ^ 0x5bd1e995);
  for (let i = 0; i < N; i++) {
    let x, y;
    do { x = sr() * 2 - 1; y = sr() * 2 - 1; } while (shape === 'circle' && x * x + y * y > 1);
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = 0;
    tone[i] = sr();
    stick[i] = 0.01 + 0.13 * sr() ** 4;
  }
  let rs = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };

  function sample(F: Field, x: number, y: number, out: number[], w: number) {
    const g = F.G - 1;
    const fx = (x + 1) * 0.5 * g, fy = (y + 1) * 0.5 * g;
    const i0 = Math.min(g - 1, Math.max(0, fx | 0)), j0 = Math.min(g - 1, Math.max(0, fy | 0));
    const tx = Math.min(1, Math.max(0, fx - i0)), ty = Math.min(1, Math.max(0, fy - j0));
    const a = j0 * F.G + i0, b = a + 1, c = a + F.G, d = c + 1;
    const w00 = (1 - tx) * (1 - ty) * w, w10 = tx * (1 - ty) * w, w01 = (1 - tx) * ty * w, w11 = tx * ty * w;
    out[0] += F.f[a] * w00 + F.f[b] * w10 + F.f[c] * w01 + F.f[d] * w11;
    out[1] += F.gx[a] * w00 + F.gx[b] * w10 + F.gx[c] * w01 + F.gx[d] * w11;
    out[2] += F.gy[a] * w00 + F.gy[b] * w10 + F.gy[c] * w01 + F.gy[d] * w11;
  }

  const acc = [0, 0, 0];
  let NA = N; // active grains (shed on slow machines)
  function tick(A: Field, B: Field | null, mixT: number, energy: number) {
    const kick = 0.011 * energy, floor = 0.0022 * energy, pull = 0.07 * energy;
    for (let i = 0; i < NA; i++) {
      let x = P[i * 3], y = P[i * 3 + 1];
      acc[0] = acc[1] = acc[2] = 0;
      sample(A, x, y, acc, B ? 1 - mixT : 1);
      if (B) sample(B, x, y, acc, mixT);
      const a = acc[0], amp = Math.abs(a);
      const drive = amp * energy - stick[i] * (0.3 + rnd() * 1.4); // friction is noisy, so grains don't stack on one contour
      if (drive > 0) {
        const g2 = acc[1] * acc[1] + acc[2] * acc[2];
        // slide toward the nodal line (a Newton step on f, damped where the gradient vanishes)
        let sx = (-a * acc[1]) / (g2 + 4), sy = (-a * acc[2]) / (g2 + 4);
        const sl = Math.sqrt(sx * sx + sy * sy), mx = 0.02;
        if (sl > mx) { sx *= mx / sl; sy *= mx / sl; }
        const s = kick * amp + floor;
        const w = Math.min(1, drive * 12);
        x += (sx * pull + (rnd() + rnd() - 1) * s * 1.7) * w;
        y += (sy * pull + (rnd() + rnd() - 1) * s * 1.7) * w;
      }
      if (shape === 'square') {
        if (x > 1) x = 2 - x; else if (x < -1) x = -2 - x;
        if (y > 1) y = 2 - y; else if (y < -1) y = -2 - y;
      } else {
        const r2 = x * x + y * y;
        if (r2 > 1) { const r = Math.sqrt(r2), k = (2 - r) / r; x *= k; y *= k; }
      }
      P[i * 3] = x; P[i * 3 + 1] = y;
      // grains on the antinodes are in the air most of the time
      P[i * 3 + 2] = P[i * 3 + 2] * 0.5 + amp * energy * rnd() * 0.5;
    }
  }

  // ---- GL ----
  function compile(type: number, src: string) {
    const sh = gl!.createShader(type)!;
    gl!.shaderSource(sh, src); gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(sh) || 'shader');
    return sh;
  }
  function program(vs: string, fs: string, attrs: string[]) {
    const p = gl!.createProgram()!;
    gl!.attachShader(p, compile(gl!.VERTEX_SHADER, vs)); gl!.attachShader(p, compile(gl!.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl!.bindAttribLocation(p, i, a));
    gl!.linkProgram(p);
    if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) || 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    const n = gl!.getProgramParameter(p, gl!.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl!.getActiveUniform(p, i)!.name; u[name] = gl!.getUniformLocation(p, name); }
    return { p, u };
  }
  const pPlate = program(PLATE_VS, PLATE_FS, ['aPos']);
  const pGrain = program(GRAIN_VS, GRAIN_FS, ['aG', 'aTone']);

  const vQuad = gl.createVertexArray()!;
  gl.bindVertexArray(vQuad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const vGrain = gl.createVertexArray()!;
  gl.bindVertexArray(vGrain);
  const gBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gBuf);
  gl.bufferData(gl.ARRAY_BUFFER, P, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, tone, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

  const bgA = hex(look.room.a), bgB = hex(look.room.b), plateCol = hex(look.plate.col), sandCol = hex(look.sand.col);
  let dpr = 1, W = 0, H = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(window.innerWidth * dpr); H = Math.round(window.innerHeight * dpr);
    canvas.width = W; canvas.height = H;
  }
  resize();
  window.addEventListener('resize', resize);

  let time = 0;
  function draw() {
    const r = slot.getBoundingClientRect();
    const cx = (r.left + r.width / 2) * dpr, cy = (r.top + r.height / 2) * dpr, R = (Math.min(r.width, r.height) / 2) * dpr;
    gl!.viewport(0, 0, W, H);
    gl!.bindVertexArray(vQuad);
    gl!.useProgram(pPlate.p);
    const u = pPlate.u;
    gl!.uniform2f(u.uRes, W, H); gl!.uniform2f(u.uC, cx, cy); gl!.uniform1f(u.uR, R);
    gl!.uniform1f(u.uShape, shape === 'square' ? 0 : 1);
    gl!.uniform1f(u.uMat, look.plate.mat); gl!.uniform1f(u.uSpec, look.plate.spec);
    gl!.uniform1f(u.uTime, time); gl!.uniform1f(u.uDpr, dpr);
    gl!.uniform1f(u.uLightRoom, look.room.light ? 1 : 0);
    gl!.uniform3fv(u.uBgA, bgA); gl!.uniform3fv(u.uBgB, bgB); gl!.uniform3fv(u.uPlate, plateCol);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);

    gl!.bindVertexArray(vGrain);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gBuf);
    gl!.bufferSubData(gl!.ARRAY_BUFFER, 0, P, 0, NA * 3);
    gl!.useProgram(pGrain.p);
    const g = pGrain.u;
    gl!.uniform2f(g.uRes, W, H); gl!.uniform2f(g.uC, cx, cy); gl!.uniform1f(g.uR, R);
    const size = Math.max(1.6, (R / dpr) * 0.0058) * dpr;
    gl!.uniform1f(g.uSize, size);
    gl!.uniform3fv(g.uSand, sandCol); gl!.uniform1f(g.uVar, look.sand.var);
    gl!.uniform1f(g.uShadowA, look.room.light || look.plate.mat === 1 ? 0.35 : 0.5);
    gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.uniform1f(g.uShadow, 1); gl!.drawArrays(gl!.POINTS, 0, NA);
    gl!.uniform1f(g.uShadow, 0); gl!.drawArrays(gl!.POINTS, 0, NA);
    gl!.disable(gl!.BLEND);
  }

  // ---- the score ----
  const period = hold + glide;
  let clock = -1.6; // a moment of stillness: freshly poured sand, then the bow touches the plate
  let lastMode = -1;
  function advance(dt: number) {
    clock += dt;
    if (clock < 0) return;
    const k = Math.floor(clock / period), t = clock - k * period;
    const i = k + offset;
    const A = field(i);
    let B: Field | null = null, m = 0, energy = Math.min(1, clock / 1.5);
    if (t > hold) {
      B = field(i + 1);
      const u = (t - hold) / glide;
      m = u * u * (3 - 2 * u);
      // between resonances the plate quietens, then the new mode builds
      energy *= 0.55 + 0.45 * Math.abs(Math.cos(u * Math.PI));
    }
    const cur = m > 0.5 ? i + 1 : i;
    if (cur !== lastMode) { lastMode = cur; onMode?.(Math.sqrt(pitch(phrase[((cur % phrase.length) + phrase.length) % phrase.length]))); }
    if (t > hold * 0.5) field(i + 1); // build the next figure ahead of time
    tick(A, B, m, energy);
  }

  const still = reduced;
  if (still) { clock = Math.min(2.5, hold * 0.5); for (let s = 0; s < 480; s++) advance(0); }
  draw();

  let raf = 0, running = false, last = 0, acc2 = 0, cost = 0, frames = 0;
  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    time += dt;
    acc2 += dt;
    let n = 0;
    const t0 = performance.now();
    while (acc2 >= 1 / 60 && n < 2) { advance(1 / 60); acc2 -= 1 / 60; n++; }
    if (n === 2) acc2 = 0;
    // keep the physics inside the frame budget: shed grains if ticks run long
    if (n && clock > 0) {
      cost = cost * 0.95 + ((performance.now() - t0) / n) * 0.05;
      if (++frames > 90 && cost > 9 && NA > N * 0.4) { NA = Math.floor(NA * 0.85); frames = 60; }
    }
    draw();
  }
  function play() { if (running || still) return; running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
  function pause() { running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  if (still) window.addEventListener('resize', () => requestAnimationFrame(draw));
  window.addEventListener('scroll', () => { if (!running) requestAnimationFrame(draw); }, { passive: true });
  play();
  return { look, shape, phrase, hold, glide };
}
