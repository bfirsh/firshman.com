// A WebGL layer of caustics and light shafts, screen-blended over the 2D scene.
const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime, uSurf, uSand, uNight, uCam, uScale;
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
void main() {
  vec2 fc = gl_FragCoord.xy / uScale;
  vec2 res = uRes;
  float y = res.y - fc.y;
  if (y < uSurf) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float sand = smoothstep(uSand - 50.0, uSand + 30.0, y);
  vec2 uv = vec2(fc.x + uCam * 12.0, y) / 420.0;
  vec2 uvS = vec2(uv.x * 0.9, uv.y * 2.4);
  float t = uTime * 0.32 + 30.0;
  float cw = sand < 0.99 ? caustic(uv, t) : 0.0;
  float cs = sand > 0.01 ? caustic(uvS, t * 1.1) : 0.0;
  float big = 0.65 + 0.35 * sin(uv.x * 2.1 + uTime * 0.07) * sin(uv.y * 1.7 - uTime * 0.05);
  float c = mix(cw * 0.32 * (1.0 - smoothstep(uSurf, res.y, y) * 0.5), cs * 1.5, sand) * big;
  // light shafts from the tank lamp
  float depth = (y - uSurf) / res.y;
  float xs = (fc.x + uCam * 30.0) / res.y + depth * 0.32;
  float r = 0.0;
  r += smoothstep(0.55, 1.0, sin(xs * 7.0 + uTime * 0.21) * 0.5 + 0.5) * 0.55;
  r += smoothstep(0.7, 1.0, sin(xs * 15.0 - uTime * 0.33 + 1.3) * 0.5 + 0.5) * 0.35;
  r += smoothstep(0.65, 1.0, sin(xs * 3.3 + uTime * 0.13 + 4.0) * 0.5 + 0.5) * 0.45;
  r *= (1.0 - smoothstep(0.0, 0.9, depth)) * (1.0 - sand);
  vec3 dayC = vec3(0.62, 0.9, 0.85) * c * 0.75 + vec3(0.3, 0.45, 0.48) * r * 0.42;
  // after dark: one cold moonbeam and faint caustics
  float moon = smoothstep(0.82, 1.0, sin(xs * 2.2 + 0.9) * 0.5 + 0.5) * (1.0 - smoothstep(0.0, 1.1, depth));
  vec3 nightC = vec3(0.18, 0.3, 0.5) * c * 0.55 + vec3(0.1, 0.16, 0.28) * moon * 0.6;
  gl_FragColor = vec4(mix(dayC, nightC, uNight), 1.0);
}`;

export function startCaustics(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) { canvas.style.display = 'none'; return null; }
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) { canvas.style.display = 'none'; return null; }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.style.display = 'none'; return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uRes = u('uRes'), uTime = u('uTime'), uSurf = u('uSurf'), uSand = u('uSand'), uNight = u('uNight'), uCam = u('uCam'), uScale = u('uScale');
  let scale = 1, w = 1, h = 1;
  return {
    resize(cw: number, ch: number, dpr: number) {
      w = cw; h = ch;
      scale = Math.max(0.5, dpr * 0.5);
      canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    render(time: number, surf: number, sand: number, night: number, camx: number) {
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, time); gl.uniform1f(uSurf, surf); gl.uniform1f(uSand, sand);
      gl.uniform1f(uNight, night); gl.uniform1f(uCam, camx); gl.uniform1f(uScale, scale);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
