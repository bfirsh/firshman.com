import { VERT, FRAG } from './shader';

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSeed(): number {
  const s = new URLSearchParams(location.search).get('seed');
  const n = s ? parseInt(s, 10) : NaN;
  if (Number.isFinite(n) && n > 0) return n % 100000;
  return 1 + Math.floor(Math.random() * 99999);
}

function setupEdition(seed: number) {
  const el = document.getElementById('seed');
  const btn = document.getElementById('edition');
  if (el) el.textContent = String(seed);
  btn?.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url.toString());
      btn.setAttribute('data-copied', '');
      const old = btn.innerHTML;
      btn.textContent = 'Link copied';
      setTimeout(() => { btn.innerHTML = old; }, 1400);
    } catch { /* the URL bar still has it */ }
  });
}

const D2R = Math.PI / 180;
type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dirFrom = (az: number, el: number): V3 => [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];

export function makeParams(seed: number) {
  const r = mulberry32(seed * 7919 + 17);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
  const range = (a: number, b: number) => a + (b - a) * r();
  const wpick = <T,>(items: [T, number][]): T => {
    let s = 0; for (const [, w] of items) s += w;
    let x = r() * s;
    for (const [v, w] of items) { if ((x -= w) <= 0) return v; }
    return items[0][0];
  };

  const alt = range(27, 36);
  const mode = wpick<'day' | 'limb' | 'twilight' | 'night' | 'moon'>([['day', 3], ['limb', 3], ['twilight', 2], ['night', 1.4], ['moon', 1.4]]);
  const type = wpick<number>([[0, 4], [1, 3], [2, 3]]);
  const surf = mode === 'night' || mode === 'moon' ? (r() < 0.75 ? 1 : 0) : (r() < 0.58 ? 0 : 1);

  const landPalettes: [V3, V3, V3][] = [
    [[0.05, 0.075, 0.035], [0.11, 0.1, 0.06], [0.16, 0.14, 0.09]],   // temperate
    [[0.22, 0.15, 0.09], [0.32, 0.22, 0.13], [0.42, 0.33, 0.22]],   // arid
    [[0.035, 0.05, 0.035], [0.07, 0.075, 0.06], [0.12, 0.12, 0.11]], // boreal
    [[0.09, 0.08, 0.05], [0.16, 0.13, 0.08], [0.06, 0.08, 0.04]],   // steppe
  ];
  const land = pick(landPalettes);

  let thr: number, lowAlt: number, high = 0, highAlt = 11;
  let scale = range(0.14, 0.3);
  if (type === 0) { thr = range(0.5, 0.6); lowAlt = range(1.6, 3.2); r(); }
  else if (type === 1) { thr = range(0.3, 0.48); lowAlt = range(1.0, 2.0); scale = range(0.18, 0.32); r(); }
  else { thr = range(0.56, 0.64); lowAlt = range(2.0, 3.5); high = 2; highAlt = range(10.5, 13); }
  const stretch = r() < 0.45 ? range(1.4, 2.6) : range(1.0, 1.2);

  const fish = range(0.35, 0.85);
  const halfFov = range(44, 52) * D2R;
  const horizonFrac = range(0.64, 0.72);
  const roll = (r() - 0.5) * 2 * range(1, 7) * D2R;
  const yaw = r() * Math.PI * 2;
  const dip = Math.acos(6371 / (6371 + alt));
  const side = r() < 0.8 ? 1 : -1;

  let sunEl = 0, sunRel = 0, exposure = 4, mie = range(0.6, 1.8), glare = 1, city = 0, airglow = 0, starsAmt = 0.5, milkyAmt = 0, moon = 0;
  switch (mode) {
    case 'day':
      sunEl = (type === 2 ? range(6, 15) : range(9, 34)) * D2R;
      sunRel = side * range(1.08, 1.3); // as a fraction of the half-width
      exposure = range(3.2, 4.4);
      starsAmt = 0.14;
      glare = 0.7;
      break;
    case 'limb':
      sunEl = -dip + range(0.25, 2.2) * D2R;
      sunRel = side * range(0.3, 0.8);
      exposure = range(5.5, 8.0);
      mie = range(1.0, 2.6);
      starsAmt = 0.2;
      glare = 0.7;
      break;
    case 'twilight':
      sunEl = -dip - range(0.6, 3.8) * D2R;
      sunRel = side * range(0.15, 0.9);
      exposure = range(14, 26);
      mie = range(1.0, 2.6);
      starsAmt = 0.6;
      break;
    case 'night':
      sunEl = -dip - range(14, 26) * D2R;
      sunRel = (r() - 0.5) * 4;
      exposure = range(160, 230);
      city = surf === 1 ? range(0.7, 1.4) : 0;
      airglow = range(0.8, 1.3);
      starsAmt = range(0.8, 1.1);
      milkyAmt = r() < 0.6 ? range(0.05, 0.08) : 0;
      glare = 0;
      break;
    case 'moon':
      sunEl = range(10, 30) * D2R;
      sunRel = side * (r() < 0.5 ? range(0.35, 0.8) : range(1.1, 1.3));
      exposure = range(2.6, 3.4);
      city = surf === 1 ? range(0.7, 1.3) : 0;
      starsAmt = range(0.55, 0.75);
      milkyAmt = 0;
      glare = 0.08;
      moon = 1;
      break;
  }
  if (mode === 'night') thr += type === 1 ? 0.14 : 0.09;
  const windAz = r() * Math.PI * 2;
  const off: [number, number] = [range(-600, 600), range(-600, 600)];
  const rough = range(0.05, 0.22);
  // storm cells: place them in front of the camera, in the middle distance
  const fwd: [number, number] = [Math.sin(yaw), Math.cos(yaw)];
  const rt: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
  const placeStorm = (dist: number, lat: number, rad: number, str: number): [number, number, number, number] =>
    [fwd[0] * dist + rt[0] * lat, fwd[1] * dist + rt[1] * lat, rad, str];
  const stormA = type === 2 ? placeStorm(range(60, 130), range(-50, 70), range(30, 55), range(0.85, 1.15)) : [0, 0, 1, 0];
  const stormB = type === 2 && r() < 0.7 ? placeStorm(range(200, 420), range(-260, 260), range(30, 70), range(0.7, 1.05)) : [0, 0, 1, 0];
  const milkyN = norm([r() - 0.5, r() * 0.6 + 0.2, r() - 0.5] as V3);
  const lightning = type === 2 && (mode === 'night' || mode === 'twilight' || mode === 'moon');

  return {
    alt, mode, type, surf, land, thr, lowAlt, high, highAlt, scale, stretch, fish, halfFov, horizonFrac, roll, yaw, dip,
    sunEl, sunRel, exposure, mie, mieG: range(0.74, 0.82), glare, city, airglow, starsAmt, milkyAmt, windAz, off, rough,
    stormA, stormB, milkyN, lightning, moon, swayPhase: r() * 100, swayAmp: range(0.6, 1.4),
  };
}

export function start() {
  const seed = getSeed();
  setupEdition(seed);
  const P = makeParams(seed);
  (window as any).__edition = { seed, ...P };

  const canvas = document.getElementById('sky') as HTMLCanvasElement | null;
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) return;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
  } catch (e) {
    console.warn('stratosphere: shader failed', e);
    return;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const U: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i)!;
    U[info.name] = gl.getUniformLocation(prog, info.name);
  }
  const f1 = (k: string, v: number) => U[k] !== undefined && gl.uniform1f(U[k], v);
  const i1 = (k: string, v: number) => U[k] !== undefined && gl.uniform1i(U[k], v);
  const f2 = (k: string, a: number, b: number) => U[k] !== undefined && gl.uniform2f(U[k], a, b);
  const f3 = (k: string, v: number[]) => U[k] !== undefined && gl.uniform3f(U[k], v[0], v[1], v[2]);
  const f4 = (k: string, v: number[]) => U[k] !== undefined && gl.uniform4f(U[k], v[0], v[1], v[2], v[3]);

  // static uniforms
  f1('uRc', 6371 + P.alt);
  f1('uMie', P.mie);
  f1('uMieG', P.mieG);
  i1('uType', P.type);
  i1('uHigh', P.high);
  f1('uThr', P.thr);
  f1('uLowAlt', P.lowAlt);
  f1('uHighAlt', P.highAlt);
  f1('uScale', P.scale);
  f2('uWind', Math.cos(P.windAz), Math.sin(P.windAz));
  f1('uStretch', P.stretch);
  f4('uStormA', P.stormA);
  f4('uStormB', P.stormB);
  i1('uSurf', P.surf);
  f3('uLandA', P.land[0]);
  f3('uLandB', P.land[1]);
  f3('uLandC', P.land[2]);
  f1('uRough', P.rough);
  f1('uCity', P.city);
  f1('uAirglow', P.airglow);
  f1('uStars', P.starsAmt);
  f1('uMilky', P.milkyAmt);
  f3('uMilkyN', P.milkyN);
  f1('uGlare', P.glare);
  f1('uSeed', seed);
  f1('uHalfFov', P.halfFov);
  f1('uFish', P.fish);
  f1('uExposure', P.exposure);
  f1('uMoon', P.moon);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // resolution management
  const dprCap = Math.min(window.devicePixelRatio || 1, 1.5);
  const small = Math.min(innerWidth, innerHeight) < 600;
  // start near a million shaded pixels and let the frame time steer from there
  const px0 = innerWidth * innerHeight * dprCap * dprCap;
  let scale = reduce ? 1 : Math.min(small ? 0.7 : 0.8, Math.sqrt(0.9e6 / px0));
  const maxScale = 1.0;
  const minScale = 0.35;
  let W = 0, H = 0;
  const resize = () => {
    const cw = canvas.clientWidth || innerWidth;
    const ch = canvas.clientHeight || innerHeight;
    const w = Math.max(2, Math.round(cw * dprCap * scale));
    const h = Math.max(2, Math.round(ch * dprCap * scale));
    if (w !== W || h !== H) { W = w; H = h; canvas.width = w; canvas.height = h; }
  };
  resize();
  addEventListener('resize', () => { resize(); if (reduce) draw(lastT); });

  // the angle from the frame centre for a normalised screen radius
  const angOf = (rq: number) => (1 - P.fish) * Math.atan(rq * Math.tan(P.halfFov)) + P.fish * rq * P.halfFov;

  // lightning
  let flash = 0, flashPos: [number, number] = [0, 0], nextFlash = 3 + Math.random() * 5, flashQueue: number[] = [];
  const stormCells = [P.stormA, P.stormB].filter((s) => s[3] > 0);

  let lastT = 0;
  const draw = (t: number) => {
    lastT = t;
    const md = Math.max(W, H);
    const aspectW = W / md, aspectH = H / md;
    // place the horizon: pitch so the limb sits at horizonFrac from the top
    const portrait = H > W;
    const hf = portrait ? Math.min(0.8, P.horizonFrac + 0.08) : P.horizonFrac;
    const qy = aspectH * (0.5 - hf) / 0.5;
    const basePitch = angOf(Math.abs(qy)) * Math.sign(-qy) - P.dip;
    const halfW = angOf(aspectW);

    // balloon sway: a slow pendulum plus torsional twist of the payload line
    const s = P.swayAmp;
    const tt = t + P.swayPhase;
    const pitch = basePitch + s * (0.35 * Math.sin(tt * 0.21) + 0.2 * Math.sin(tt * 0.077 + 1.3)) * D2R;
    const roll = P.roll + s * (0.9 * Math.sin(tt * 0.16 + 0.4) + 0.35 * Math.sin(tt * 0.053 + 2.0)) * D2R;
    const yaw = P.yaw + s * (2.4 * Math.sin(tt * 0.031) + 0.6 * Math.sin(tt * 0.11 + 0.7)) * D2R;

    const F = dirFrom(yaw, pitch);
    let Rv = norm(cross([0, 1, 0], F));
    let Uv = cross(F, Rv);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const R2: V3 = [Rv[0] * cr + Uv[0] * sr, Rv[1] * cr + Uv[1] * sr, Rv[2] * cr + Uv[2] * sr];
    const U2: V3 = [Uv[0] * cr - Rv[0] * sr, Uv[1] * cr - Rv[1] * sr, Uv[2] * cr - Rv[2] * sr];
    const sun = dirFrom(P.yaw + P.sunRel * halfW, P.sunEl);

    gl.viewport(0, 0, W, H);
    f2('uRes', W, H);
    f1('uTime', t);
    f3('uCamR', R2);
    f3('uCamU', U2);
    f3('uCamF', F);
    f3('uSun', sun);
    // drift of the ground beneath the balloon
    f2('uOff', P.off[0] + t * 0.012 * Math.cos(P.windAz), P.off[1] + t * 0.012 * Math.sin(P.windAz));
    f4('uFlash', [flashPos[0], flashPos[1], flash, 9]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let running = false, raf = 0, t0 = performance.now(), paused = 0, pauseAt = 0;
  let frames = 0, acc = 0, lastNow = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const t = (now - t0 - paused) / 1000;
    const dt = lastNow ? now - lastNow : 16;
    lastNow = now;
    // adaptive resolution
    frames++; acc += dt;
    if (frames >= 40) {
      const avg = acc / frames;
      if (avg > 24 && scale > minScale) { scale = Math.max(minScale, scale * 0.85); resize(); }
      else if (avg < 15 && scale < maxScale) { scale = Math.min(maxScale, scale * 1.08); resize(); }
      frames = 0; acc = 0;
    }
    // lightning flicker
    if (P.lightning) {
      if (t > nextFlash && stormCells.length) {
        const c = stormCells[Math.floor(Math.random() * stormCells.length)];
        const a = Math.random() * Math.PI * 2, d = Math.random() * c[2] * 0.6;
        flashPos = [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d];
        const k = 1 + Math.floor(Math.random() * 3);
        flashQueue = [];
        let tt = t;
        for (let i = 0; i < k; i++) { flashQueue.push(tt, tt + 0.05 + Math.random() * 0.05); tt += 0.12 + Math.random() * 0.2; }
        nextFlash = t + 2 + Math.random() * 9;
      }
      let on = false;
      for (let i = 0; i < flashQueue.length; i += 2) if (t >= flashQueue[i] && t <= flashQueue[i + 1]) on = true;
      const target = on ? (P.mode === 'night' ? 0.02 : P.mode === 'moon' ? 0.3 : 0.004) * (0.6 + Math.random() * 0.4) : 0;
      flash = on ? target : flash * 0.6;
    }
    draw(t);
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
  };
  const play = () => {
    if (running) return;
    running = true;
    if (pauseAt) { paused += performance.now() - pauseAt; pauseAt = 0; }
    lastNow = 0;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    pauseAt = performance.now();
  };

  if (reduce) {
    draw(0);
    requestAnimationFrame(() => canvas.classList.add('on'));
  } else {
    play();
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
}
