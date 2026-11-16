// The CRT: a beam drawn as gaussian-profile segments integrated along their
// length (so brightness follows dwell time), deposited additively into a
// float "phosphor" buffer that decays every frame in two channels (fast
// flash, slow afterglow), then bloomed and composited onto dark glass with
// an etched graticule.

import type { Phosphor } from './phosphors';

const VS_FULL = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const VS_SEG = `#version 300 es
in vec2 corner;
in vec3 a;
in vec3 b;
uniform vec2 res;
uniform float sigma;
out vec2 q; out float len; out float E;
void main(){
  vec2 d = b.xy - a.xy;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = sigma * 3.6;
  float u = mix(-r, L + r, corner.x);
  float v = corner.y * r;
  vec2 pos = a.xy + dir * u + nrm * v;
  q = vec2(u, v); len = L; E = a.z;
  gl_Position = vec4(pos / res * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_SEG = `#version 300 es
precision highp float;
in vec2 q; in float len; in float E;
uniform float sigma;
out vec4 o;
float erf_(float x){
  float s = sign(x), a = abs(x);
  x = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  x *= x;
  return s - s / (x * x);
}
void main(){
  float s2 = sigma * 1.41421356;
  float g = exp(-q.y * q.y / (2.0 * sigma * sigma)) / (2.5066283 * sigma);
  float f;
  if (len < 0.02) f = exp(-q.x * q.x / (2.0 * sigma * sigma)) / (2.5066283 * sigma);
  else f = (erf_((len - q.x) / s2) - erf_(-q.x / s2)) * 0.5 / len;
  float I = E * g * f;
  o = vec4(I, I, 0.0, 1.0);
}`;

const FS_DECAY = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(0.0); }`;

const FS_DOWN = `#version 300 es
precision highp float;
in vec2 uv; uniform sampler2D src; uniform vec2 texel; out vec4 o;
void main(){
  vec4 c = texture(src, uv) * 4.0;
  c += texture(src, uv + texel * vec2(-1.0, -1.0));
  c += texture(src, uv + texel * vec2( 1.0, -1.0));
  c += texture(src, uv + texel * vec2(-1.0,  1.0));
  c += texture(src, uv + texel * vec2( 1.0,  1.0));
  o = c / 8.0;
}`;

const FS_COMP = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D acc, b1, b2, b3, b4;
uniform vec2 res;
uniform float dpr, exposure, slowGain, time, illum;
uniform vec3 cFast, cSlow, glass;
out vec4 o;

float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

float line(float d, float w){ return 1.0 - smoothstep(w * 0.5, w * 0.5 + dpr, d); }

float graticule(vec2 px){
  vec2 div = res / vec2(10.0, 8.0);
  vec2 g = px / div;                       // position in divisions, 0..10 x 0..8
  vec2 f = abs(fract(g + 0.5) - 0.5) * div; // px to nearest major line
  float w = 0.75 * dpr;
  float maj = max(line(f.x, w), line(f.y, w));
  // centre axes carry fine ticks every fifth of a division
  vec2 c = abs(g - vec2(5.0, 4.0)) * div;
  vec2 m = abs(fract(g * 5.0 + 0.5) - 0.5) * div / 5.0;
  float tick = 0.0;
  tick = max(tick, line(m.x, w) * step(c.y, div.y * 0.07));
  tick = max(tick, line(m.y, w) * step(c.x, div.x * 0.07));
  // dotted rise-time rows near top and bottom
  float dots = 0.0;
  for (int i = 0; i < 4; i++) {
    float yy = i == 0 ? 1.5 : i == 1 ? 1.9 : i == 2 ? 6.1 : 6.5;
    float dy = abs(g.y - yy) * div.y;
    float dx = abs(fract(g.x * 5.0) - 0.5) * div.x / 5.0;
    dots = max(dots, (1.0 - smoothstep(0.6 * dpr, 1.4 * dpr, length(vec2(dx, dy)))) * 0.7);
  }
  return max(max(maj * 0.75, tick), dots);
}

void main(){
  vec2 px = uv * res;
  vec2 A = texture(acc, uv).rg;
  vec2 B = texture(b1, uv).rg * 0.55 + texture(b2, uv).rg * 0.42 + texture(b3, uv).rg * 0.36 + texture(b4, uv).rg * 0.36;

  float grain = hash(floor(px / max(1.0, dpr * 0.75)));
  vec3 light = cFast * A.r + cSlow * A.g * slowGain;
  light *= 0.9 + 0.2 * grain;
  vec3 halo = cFast * B.r + cSlow * B.g * slowGain;
  vec3 hdr = light * exposure + halo * exposure * 0.32;
  vec3 lit = 1.0 - exp(-hdr);

  // glass: a slightly lifted centre, darker towards the bezel
  vec2 cuv = uv - 0.5;
  float vig = 1.0 - dot(cuv * vec2(1.1, 1.25), cuv * vec2(1.1, 1.25)) * 0.9;
  vec3 base = glass * (0.7 + 0.45 * vig);
  // unlit phosphor catches a whisper of its own halo
  base += halo * exposure * 0.02;
  float gr = graticule(px);
  vec3 gcol = vec3(0.17, 0.165, 0.15) * illum + lit * 0.12;
  vec3 col = base * (1.0 - gr * 0.4) + lit * (1.0 - gr * 0.25) + gcol * gr;

  // a soft window reflection across the top of the glass
  float refl = smoothstep(0.55, 1.0, uv.y + uv.x * 0.18) * 0.02;
  refl *= smoothstep(1.02, 0.8, uv.y);
  col += refl;

  // inner shadow from the bezel
  vec2 e = min(uv, 1.0 - uv) * res / dpr;
  float edge = smoothstep(0.0, 26.0, min(e.x, e.y));
  col *= 0.55 + 0.45 * edge;

  // fine moving dither kills banding in the dark gradients
  col += (hash(px + fract(time * 7.13) * 91.0) - 0.5) / 255.0 * 1.5;
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'p');
  gl.bindAttribLocation(p, 0, 'corner');
  gl.bindAttribLocation(p, 1, 'a');
  gl.bindAttribLocation(p, 2, 'b');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i)!;
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

type Target = { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number };

export class Scope {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  W = 1; H = 1; dpr = 1;
  private seg; private decay; private down; private comp;
  private quad: WebGLBuffer; private cornerBuf: WebGLBuffer; private segBuf: WebGLBuffer;
  private vaoFull: WebGLVertexArrayObject; private vaoSeg: WebGLVertexArrayObject;
  private acc: Target | null = null;
  private blooms: Target[] = [];
  private fmt: { internal: number; type: number };
  private cap = 0;
  ph: Phosphor;

  constructor(canvas: HTMLCanvasElement, ph: Phosphor) {
    this.canvas = canvas;
    this.ph = ph;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    const cbf = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.fmt = cbf ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };

    this.seg = compile(gl, VS_SEG, FS_SEG);
    this.decay = compile(gl, VS_FULL, FS_DECAY);
    this.down = compile(gl, VS_FULL, FS_DOWN);
    this.comp = compile(gl, VS_FULL, FS_COMP);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vaoFull = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoFull);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.segBuf = gl.createBuffer()!;
    this.vaoSeg = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoSeg);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bindSegAttribs();
    gl.bindVertexArray(null);
  }

  private bindSegAttribs() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 12);
    gl.vertexAttribDivisor(2, 1);
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.fmt.internal, w, h, 0, gl.RGBA, this.fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h };
  }

  private free(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  /** Match the drawing buffer to the canvas's CSS size. Returns true if it changed. */
  resize(maxDpr: number) {
    const r = this.canvas.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    // keep the fill rate sane on very large screens
    const area = r.width * r.height * dpr * dpr;
    if (area > 1.9e6) dpr *= Math.sqrt(1.9e6 / area);
    const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
    if (W === this.W && H === this.H && this.acc) return false;
    this.W = W; this.H = H; this.dpr = dpr;
    this.canvas.width = W; this.canvas.height = H;
    this.free(this.acc);
    this.blooms.forEach((b) => this.free(b));
    this.acc = this.target(W, H);
    this.blooms = [];
    let w = W, h = H;
    for (let i = 0; i < 4; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.blooms.push(this.target(w, h));
    }
    return true;
  }

  /**
   * pts: n+1 beam points (x px, y px, energy of the segment that starts there).
   * extra: optional second polyline (on-screen readout) in the same format.
   */
  frame(pts: Float32Array, n: number, extra: Float32Array | null, en: number, dt: number, o: { sigma: number; tauFast: number; tauSlow: number; exposure: number; time: number; illum: number }) {
    const gl = this.gl;
    const acc = this.acc!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fb);
    gl.viewport(0, 0, acc.w, acc.h);

    // 1. phosphor decay: dst *= constant colour, per channel
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
    gl.blendColor(Math.exp(-dt / o.tauFast), Math.exp(-dt / o.tauSlow), 0, 0);
    gl.useProgram(this.decay.p);
    gl.bindVertexArray(this.vaoFull);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. the beam, additively
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.seg.p);
    gl.uniform2f(this.seg.u.res, acc.w, acc.h);
    gl.uniform1f(this.seg.u.sigma, o.sigma);
    gl.bindVertexArray(this.vaoSeg);
    const draw = (arr: Float32Array, count: number) => {
      if (count < 1) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.segBuf);
      const bytes = (count + 1) * 12;
      if (bytes > this.cap) {
        this.cap = Math.max(bytes, this.cap * 2);
        gl.bufferData(gl.ARRAY_BUFFER, this.cap, gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr, 0, (count + 1) * 3);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    };
    draw(pts, n);
    if (extra) { gl.uniform1f(this.seg.u.sigma, o.sigma * 0.6); draw(extra, en); }
    gl.disable(gl.BLEND);

    // 3. bloom chain
    gl.useProgram(this.down.p);
    gl.bindVertexArray(this.vaoFull);
    let src: Target = acc;
    for (const t of this.blooms) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
      gl.viewport(0, 0, t.w, t.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.down.u.src, 0);
      gl.uniform2f(this.down.u.texel, 1 / src.w, 1 / src.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = t;
    }

    // 4. composite onto the glass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    const c = this.comp;
    gl.useProgram(c.p);
    const texs = [acc, ...this.blooms];
    ['acc', 'b1', 'b2', 'b3', 'b4'].forEach((nm, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texs[i].tex);
      gl.uniform1i(c.u[nm], i);
    });
    gl.uniform2f(c.u.res, this.W, this.H);
    gl.uniform1f(c.u.dpr, this.dpr);
    gl.uniform1f(c.u.exposure, o.exposure);
    gl.uniform1f(c.u.slowGain, this.ph.slowGain);
    gl.uniform1f(c.u.time, o.time);
    gl.uniform1f(c.u.illum, o.illum);
    gl.uniform3fv(c.u.cFast, this.ph.fast);
    gl.uniform3fv(c.u.cSlow, this.ph.slow);
    gl.uniform3fv(c.u.glass, this.ph.glass);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
