import { QUAD_VERT, SPLAT_VERT, SPLAT_FRAG, UPDATE_FRAG, CENTROID_FRAG, PRED_FRAG, BIRD_VERT, BIRD_FRAG, SKY_FRAG, POST_FRAG } from './shaders';

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
      const old = btn.innerHTML;
      btn.textContent = 'Link copied';
      setTimeout(() => { btn.innerHTML = old; }, 1400);
    } catch { /* the URL bar still has it */ }
  });
}

type V3 = [number, number, number];
const hex = (h: string): V3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const D2R = Math.PI / 180;

type Palette = {
  name: string;
  hor: string; low: string; mid: string; high: string; zen: string;
  glow: string; glowK: number; anti: string;
  cloudDark: string; cloudLit: string;
  land: string; water: string; bird: string; haze: string; reed: string; rim: string;
  sun?: string;
};

// Hand-tuned dusk skies. The upper sky (where the text sits) stays dark enough for pale type.
const PALETTES: Palette[] = [
  {
    name: 'afterglow',
    hor: '#ffd6ad', low: '#f2a78b', mid: '#a9809f', high: '#55507a', zen: '#24264a',
    glow: '#ff9f72', glowK: 0.38, anti: '#2a1f35',
    cloudDark: '#4d4062', cloudLit: '#ffb48c',
    land: '#2c2234', water: '#251f33', bird: '#140f1a', haze: '#c897a3', reed: '#110c15', rim: '#ffb48c',
  },
  {
    name: 'winter',
    hor: '#f0dfc2', low: '#c3c5c6', mid: '#7a8fac', high: '#32486a', zen: '#121d36',
    glow: '#ffdca6', glowK: 0.22, anti: '#1a2236',
    cloudDark: '#2f3a4e', cloudLit: '#e3c3a2',
    land: '#151b28', water: '#151c2b', bird: '#0a0d14', haze: '#9db0c6', reed: '#090c12', rim: '#d8c0a6',
  },
  {
    name: 'smoke',
    hor: '#ffbf6e', low: '#ec8c48', mid: '#a6573c', high: '#553134', zen: '#241a24',
    glow: '#ff8a38', glowK: 0.42, anti: '#2a1820',
    cloudDark: '#432829', cloudLit: '#ff9c52',
    land: '#25130f', water: '#291818', bird: '#150a08', haze: '#d2804e', reed: '#120806', rim: '#ff9c52',
    sun: '#ff5c30',
  },
  {
    name: 'rose',
    hor: '#ffe2c6', low: '#f2bcad', mid: '#c193aa', high: '#5c5182', zen: '#2a2b55',
    glow: '#ffc8a0', glowK: 0.3, anti: '#3a2a48',
    cloudDark: '#55466c', cloudLit: '#ffc6a6',
    land: '#342a40', water: '#2b2540', bird: '#15111d', haze: '#d2a6b6', reed: '#120e18', rim: '#ffc6a6',
  },
  {
    name: 'teal',
    hor: '#ffdf9c', low: '#e6c088', mid: '#8a9e98', high: '#30556a', zen: '#11243a',
    glow: '#ffc062', glowK: 0.3, anti: '#16232f',
    cloudDark: '#2b3a44', cloudLit: '#f2c27c',
    land: '#15212a', water: '#14202b', bird: '#0a1114', haze: '#a6b4a6', reed: '#081014', rim: '#f2c27c',
  },
];

export function makeParams(seed: number) {
  const r = mulberry32(seed * 7907 + 3);
  const range = (a: number, b: number) => a + (b - a) * r();
  const pi = Math.floor(r() * PALETTES.length);
  const pal = PALETTES[pi];
  const land = Math.floor(r() * 4);
  const tier = [128, 160, 192, 224, 256][Math.floor(r() * 5)];
  const predMode = (['stoop', 'harry', 'pass'] as const)[Math.floor(r() * 3)];
  return {
    pal, palName: pal.name, land,
    tier,
    cells: range(9000, 16000),
    speed: range(10, 12.5),
    align: range(2.6, 5.0),
    coh: range(4.0, 8.0),
    sep: range(26, 42),
    noise: range(1.5, 3.0),
    predMode,
    predR: range(30, 46),
    homeZ: range(340, 460),
    homeEl: range(6.5, 10.5),
    homeX: range(0.26, 0.42),
    sunAz: range(-12, 30),
    glowW: range(4.5, 9),
    glowH: range(5, 9),
    cloud: r() < 0.6 ? range(0.4, 1.0) : 0,
    cloudH: range(2.5, 5),
    cloudDir: range(-0.6, 0.6),
    mist: range(0.2, 0.75),
    calm: range(0.3, 1.0),
    reeds: r() < 0.8 ? range(0.7, 1.15) : 0,
    seedF: r() * 100,
    heading: r() * Math.PI * 2,
    wander: [r() * 100, r() * 100, r() * 100],
  };
}

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3]);

export function start() {
  const seed = getSeed();
  setupEdition(seed);
  const P = makeParams(seed);
  const pal = P.pal;
  (window as any).__edition = { seed, palette: P.palName, land: P.land, tier: P.tier, pred: P.predMode };

  // without WebGL the page still gets the edition's sky as a quiet gradient
  {
    const hz = innerWidth < innerHeight && innerWidth <= 820 ? 47 : 76;
    const k = hz / 76;
    document.body.style.background = `linear-gradient(to bottom, ${pal.zen} 0%, ${pal.high} ${34 * k}%, ${pal.mid} ${58 * k}%, ${pal.low} ${70 * k}%, ${pal.hor} ${hz}%, ${pal.water} ${hz + 0.2}%, ${pal.water} 100%)`;
    document.body.style.backgroundAttachment = 'fixed';
  }
  document.documentElement.style.setProperty('--ground', pal.water);
  document.documentElement.style.setProperty('--zen', pal.zen);
  document.documentElement.style.setProperty('--high', pal.high);

  const canvas = document.getElementById('sky') as HTMLCanvasElement | null;
  if (!canvas) return;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return;
  const floatRT = !!gl.getExtension('EXT_color_buffer_float');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|software/i.test(renderer);

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error((gl.getShaderInfoLog(s) || '') + src.slice(0, 80));
    return s;
  };
  const program = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const locs = new Map<string, WebGLUniformLocation | null>();
    const u = (name: string) => {
      if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name));
      return locs.get(name)!;
    };
    return { p, u };
  };

  let progs: Record<string, ReturnType<typeof program>>;
  try {
    progs = {
      sky: program(QUAD_VERT, SKY_FRAG),
      post: program(QUAD_VERT, POST_FRAG),
      bird: program(BIRD_VERT, BIRD_FRAG),
      ...(floatRT ? { splat: program(SPLAT_VERT, SPLAT_FRAG), update: program(QUAD_VERT, UPDATE_FRAG), centroid: program(QUAD_VERT, CENTROID_FRAG), predp: program(QUAD_VERT, PRED_FRAG) } : {}),
    };
  } catch (e) {
    console.warn('murmuration: shader failed', e);
    return;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const emptyVao = gl.createVertexArray();

  // ---------------------------------------------------------------- flock size for this device
  const small = Math.min(innerWidth, innerHeight) < 600 || matchMedia('(pointer: coarse)').matches;
  let S = P.tier;
  if (small) S = Math.min(S, 112);
  if (software) S = Math.min(S, 192);
  if (!floatRT) S = 40; // CPU fallback
  const N = S * S;
  const rho0 = N / P.cells; // birds per fine cell at rest density

  const tex = (w: number, h: number, ifmt: number, fmt: number, type: number, filter: number, data: ArrayBufferView | null = null) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const fbo = (...atts: WebGLTexture[]) => {
    const f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    atts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    return f;
  };

  // ---------------------------------------------------------------- camera
  // matches the CSS: portrait screens up to 820px wide put the text on the water
  const portraitLayout = (cw: number, ch: number) => cw < ch && cw <= 820;
  const camH = 1.6;
  let W = 0, H = 0, fx = 1, fy = 1, pitch = 0, horizonFrac = 0.72;
  let camR: V3 = [1, 0, 0], camU: V3 = [0, 1, 0], camF: V3 = [0, 0, 1];
  const setCamera = (cw: number, ch: number) => {
    const aspect = cw / ch;
    let tanH = Math.tan(31 * D2R);
    let tanV = tanH / aspect;
    const maxV = Math.tan(36 * D2R);
    if (tanV > maxV) { tanV = maxV; tanH = tanV * aspect; }
    fx = 1 / tanH; fy = 1 / tanV;
    horizonFrac = portraitLayout(cw, ch) ? 0.47 : 0.76;
    pitch = Math.atan((2 * horizonFrac - 1) / fy);
    const s = Math.sin(pitch), c = Math.cos(pitch);
    camF = [0, s, c]; camR = [1, 0, 0]; camU = [0, c, -s];
  };

  // home region for the flock, placed in the bright band to the right of the text
  const homeFromScreen = (nx: number, elDeg: number, z: number): V3 => {
    const az = Math.atan(nx / fx);
    return [Math.tan(az) * z, camH + Math.tan(elDeg * D2R) * z, z];
  };

  setCamera(innerWidth, innerHeight);
  const cen0 = homeFromScreen(portraitLayout(innerWidth, innerHeight) ? 0 : P.homeX, P.homeEl, P.homeZ);

  // ---------------------------------------------------------------- simulation state
  const posData = new Float32Array(N * 4);
  const velData = new Float32Array(N * 4);
  {
    const r = mulberry32(seed + 99);
    setCamera(innerWidth, innerHeight);
    const nx = portraitLayout(innerWidth, innerHeight) ? 0 : P.homeX;
    const home = homeFromScreen(nx, P.homeEl, P.homeZ);
    const rad = Math.cbrt(P.cells * 125 / (4 / 3 * Math.PI * 0.5)) * 0.6;
    const hx = Math.cos(P.heading), hz = Math.sin(P.heading);
    for (let i = 0; i < N; i++) {
      let x, y, z;
      do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1);
      posData[i * 4] = home[0] + x * rad;
      posData[i * 4 + 1] = home[1] + y * rad * 0.45;
      posData[i * 4 + 2] = home[2] + z * rad;
      posData[i * 4 + 3] = 0;
      velData[i * 4] = hx * P.speed + (r() - 0.5) * 4;
      velData[i * 4 + 1] = (r() - 0.5) * 1.5;
      velData[i * 4 + 2] = hz * P.speed + (r() - 0.5) * 4;
      velData[i * 4 + 3] = 0;
    }
  }
  const posT = [tex(S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, posData), tex(S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, posData)];
  const velT = [tex(S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, velData), tex(S, S, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, velData)];
  let cur = 0;

  // grids (particle-in-cell neighbourhoods)
  const FN = 64, FT = 8, FA = FN * FT, FCELL = 5;
  const CN = 16, CT = 4, CA = CN * CT, CCELL = 40;
  let simFbo: WebGLFramebuffer[] = [], fineFbo: WebGLFramebuffer | null = null, coarseFbo: WebGLFramebuffer | null = null;
  let cenT: WebGLTexture | null = null, cenF: WebGLFramebuffer | null = null;
  const predInit = new Float32Array([cen0[0] + 380, cen0[1] + 90, cen0[2] + 120, 1, -8, 0, 0, 0]);
  const predT = [tex(2, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, predInit), tex(2, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, predInit)];
  let predF: WebGLFramebuffer[] = [];
  let pcur = 0;
  let fine0: WebGLTexture | null = null, fine1: WebGLTexture | null = null, coarse0: WebGLTexture | null = null;
  if (floatRT) {
    simFbo = [fbo(posT[0], velT[0]), fbo(posT[1], velT[1])];
    fine0 = tex(FA, FA, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    fine1 = tex(FA, FA, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    coarse0 = tex(CA, CA, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    cenT = tex(1, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST);
    cenF = fbo(cenT);
    predF = [fbo(predT[0]), fbo(predT[1])];
    fineFbo = fbo(fine0, fine1);
    coarseFbo = fbo(coarse0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) console.warn('murmuration: grid fbo incomplete');
  }

  // render targets
  let sceneT: WebGLTexture | null = null, sceneF: WebGLFramebuffer | null = null;
  let reflT: WebGLTexture | null = null, reflF: WebGLFramebuffer | null = null;
  const sceneFmt = floatRT ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
  const dprCap = Math.min(window.devicePixelRatio || 1, 2);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scale = reduce ? 1 : small ? 0.85 : 1;
  const resize = () => {
    const cw = canvas.clientWidth || innerWidth;
    const ch = canvas.clientHeight || innerHeight;
    const w = Math.max(2, Math.round(cw * dprCap * scale));
    const h = Math.max(2, Math.round(ch * dprCap * scale));
    setCamera(cw, ch);
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    if (sceneT) gl.deleteTexture(sceneT);
    if (reflT) gl.deleteTexture(reflT);
    if (sceneF) gl.deleteFramebuffer(sceneF);
    if (reflF) gl.deleteFramebuffer(reflF);
    sceneT = tex(W, H, sceneFmt[0], gl.RGBA, sceneFmt[1], gl.LINEAR);
    sceneF = fbo(sceneT);
    reflT = tex(Math.max(1, W >> 1), Math.max(1, H >> 1), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    reflF = fbo(reflT);
  };
  resize();

  // ---------------------------------------------------------------- the falcon
  // Its intentions are a timeline on the CPU; its flight is integrated on the GPU, relative to the
  // flock's centroid, so nothing ever has to be read back.
  const pr = mulberry32(seed * 31 + 5);
  const pred = {
    state: 'away',
    timer: 3 + pr() * 5,
    side: pr() < 0.5 ? -1 : 1,
    ang: pr() * 6.28,
    tgtM: [380, 90, 120] as V3, // metres from the centroid
    tgtS: [0, 0, 0] as V3,      // in units of the flock's spread
    speed: 16,
    turn: 1.0,
    lift: 0,
  };
  let cen: V3 = [...cen0];
  let spread = 60;
  const away = () => {
    pred.state = 'away';
    pred.side = pr() < 0.5 ? -1 : 1;
    pred.timer = 7 + pr() * 12;
    pred.tgtM = [pred.side * (330 + pr() * 120), 70 + pr() * 60, (pr() - 0.3) * 200];
    pred.tgtS = [0, 0, 0];
    pred.speed = 15; pred.turn = 0.8; pred.lift = 0;
  };
  away();
  pred.timer = 2 + pr() * 4;
  const climb = () => {
    pred.state = 'climb'; pred.timer = 6 + pr() * 4;
    pred.ang = pr() * 6.28;
    pred.tgtM = [Math.cos(pred.ang) * 150, 125, Math.sin(pred.ang) * 120]; pred.tgtS = [0, 0, 0];
    pred.speed = 20; pred.turn = 1.0; pred.lift = 0;
  };
  const updatePred = (dt: number) => {
    pred.timer -= dt;
    const m = P.predMode;
    const st = pred.state;
    if (st === 'harry') {
      pred.ang += dt * 0.32;
      const dart = (pred.timer % 9) < 2.0;
      pred.tgtM = [0, 0, 0];
      pred.tgtS = dart ? [0, 0, 0] : [Math.cos(pred.ang) * 0.8, 0.25 * Math.sin(pred.ang * 1.7), Math.sin(pred.ang) * 0.8];
      pred.speed = dart ? 24 : 17; pred.turn = 1.5;
    }
    if (pred.timer > 0) return;
    if (st === 'away') {
      if (m === 'stoop') climb();
      else if (m === 'harry') { pred.state = 'harry'; pred.timer = 16 + pr() * 14; }
      else {
        pred.state = 'run'; pred.timer = 7;
        pred.tgtM = [0, -4, 0]; pred.tgtS = [(pr() - 0.5) * 0.8, 0, (pr() - 0.5) * 0.8];
        pred.speed = 20; pred.turn = 1.0;
      }
    } else if (st === 'climb') {
      pred.state = 'dive'; pred.timer = 3.2 + pr();
      pred.tgtM = [0, -12, 0]; pred.tgtS = [(pr() - 0.5) * 0.6, 0, (pr() - 0.5) * 0.6];
      pred.speed = 36; pred.turn = 2.6;
    } else if (st === 'dive') {
      pred.state = 'pull'; pred.timer = 3.5;
      const a = pred.ang + Math.PI + (pr() - 0.5);
      pred.tgtM = [Math.cos(a) * 220, 150, Math.sin(a) * 200]; pred.tgtS = [0, 0, 0];
      pred.speed = 26; pred.turn = 0.7; pred.lift = 5;
    } else if (st === 'pull') {
      if (pr() < 0.4) away(); else climb();
    } else if (st === 'run') {
      pred.state = 'leave'; pred.timer = 9;
      pred.tgtM = [-pred.side * 450, 80, (pr() - 0.5) * 200]; pred.tgtS = [0, 0, 0];
      pred.speed = 21; pred.turn = 0.35;
    } else {
      away();
    }
  };
  // CPU twin of the GPU integrator, used only by the fallback
  const cpuPred = { p: [cen[0] + 380, cen[1] + 90, cen[2] + 120] as V3, v: [-8, 0, 0] as V3 };
  const integratePredCPU = (dt: number) => {
    const t: V3 = [cen[0] + pred.tgtM[0] + pred.tgtS[0] * spread, cen[1] + pred.tgtM[1] + pred.tgtS[1] * spread, cen[2] + pred.tgtM[2] + pred.tgtS[2] * spread];
    const d: V3 = [t[0] - cpuPred.p[0], t[1] - cpuPred.p[1], t[2] - cpuPred.p[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const sp = pred.speed * (1 + Math.min(1, Math.max(0, (l - 150) / 150)));
    const k = Math.min(1, dt * pred.turn);
    for (let i = 0; i < 3; i++) cpuPred.v[i] += (d[i] / l * sp - cpuPred.v[i]) * k;
    cpuPred.v[1] += pred.lift * dt;
    for (let i = 0; i < 3; i++) cpuPred.p[i] += cpuPred.v[i] * dt;
    cpuPred.p[1] = Math.max(cpuPred.p[1], 12);
  };

  // ---------------------------------------------------------------- the roost wanders slowly
  const homeAt = (t: number): V3 => {
    const portrait = portraitLayout(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
    const w = P.wander;
    const nx = (portrait ? 0 : P.homeX) + (portrait ? 0.1 : 0.12) * Math.sin(t * 0.021 + w[0]) + 0.05 * Math.sin(t * 0.047 + w[1]);
    const el = P.homeEl + 2.2 * Math.sin(t * 0.13 + w[2]) + 1.1 * Math.sin(t * 0.31 + w[0]);
    const z = P.homeZ + 60 * Math.sin(t * 0.017 + w[1]);
    return homeFromScreen(nx, el, z);
  };

  // ---------------------------------------------------------------- CPU fallback flock
  let cpuStep: ((dt: number, t: number) => void) | null = null;
  if (!floatRT) {
    const cell = 12;
    const grid = new Map<number, number[]>();
    const key = (x: number, y: number, z: number) => ((x & 1023) << 20) | ((y & 1023) << 10) | (z & 1023);
    cpuStep = (dt, t) => {
      grid.clear();
      for (let i = 0; i < N; i++) {
        const k = key(Math.floor(posData[i * 4] / cell), Math.floor(posData[i * 4 + 1] / cell), Math.floor(posData[i * 4 + 2] / cell));
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(i);
      }
      const home = homeAt(t);
      let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < N; i++) { sx += posData[i * 4]; sy += posData[i * 4 + 1]; sz += posData[i * 4 + 2]; }
      cen = [sx / N, sy / N, sz / N];
      let ss = 0;
      for (let i = 0; i < N; i++) { const dx = posData[i * 4] - cen[0], dy = posData[i * 4 + 1] - cen[1], dz = posData[i * 4 + 2] - cen[2]; ss += dx * dx + dy * dy + dz * dz; }
      spread = Math.sqrt(ss / N);
      integratePredCPU(dt);
      gl.bindTexture(gl.TEXTURE_2D, predT[pcur]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2, 1, gl.RGBA, gl.FLOAT, new Float32Array([...cpuPred.p, 1, ...cpuPred.v, 0]));
      for (let i = 0; i < N; i++) {
        const px = posData[i * 4], py = posData[i * 4 + 1], pz = posData[i * 4 + 2];
        let vx = velData[i * 4], vy = velData[i * 4 + 1], vz = velData[i * 4 + 2];
        const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
        // the seven nearest within the surrounding cells
        const near: [number, number][] = [];
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          const arr = grid.get(key(cx + a, cy + b, cz + c));
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const dx = posData[j * 4] - px, dy = posData[j * 4 + 1] - py, dz = posData[j * 4 + 2] - pz;
            near.push([dx * dx + dy * dy + dz * dz, j]);
          }
        }
        near.sort((a, b) => a[0] - b[0]);
        let ax = 0, ay = 0, az = 0;
        const k = Math.min(7, near.length);
        if (k) {
          let mx = 0, my = 0, mz = 0, qx = 0, qy = 0, qz = 0;
          for (let n = 0; n < k; n++) {
            const j = near[n][1];
            mx += velData[j * 4]; my += velData[j * 4 + 1]; mz += velData[j * 4 + 2];
            qx += posData[j * 4]; qy += posData[j * 4 + 1]; qz += posData[j * 4 + 2];
            const d = Math.sqrt(near[n][0]) || 1;
            if (d < 4) { const f = (4 - d) / d * 3; ax -= (posData[j * 4] - px) * f; ay -= (posData[j * 4 + 1] - py) * f; az -= (posData[j * 4 + 2] - pz) * f; }
          }
          ax += (mx / k - vx) * P.align; ay += (my / k - vy) * P.align; az += (mz / k - vz) * P.align;
          ax += (qx / k - px) * 0.15; ay += (qy / k - py) * 0.15; az += (qz / k - pz) * 0.15;
        }
        const dcx = cen[0] - px, dcy = cen[1] - py, dcz = cen[2] - pz;
        const dc = Math.hypot(dcx, dcy, dcz) || 1;
        ax += dcx / dc * P.coh * 0.5; ay += dcy / dc * P.coh * 0.5; az += dcz / dc * P.coh * 0.5;
        const hx = home[0] - px, hy = home[1] - py, hz = home[2] - pz;
        const hd = Math.hypot(hx / 110, hy / 40, hz / 110);
        if (hd > 0.8) { const l = Math.hypot(hx, hy, hz) || 1; ax += hx / l * 4; ay += hy / l * 4; az += hz / l * 4; }
        const ex = px - cpuPred.p[0], ey = py - cpuPred.p[1], ez = pz - cpuPred.p[2];
        const ed = Math.hypot(ex, ey, ez);
        let alarm = velData[i * 4 + 3] * Math.exp(-dt * 1.5);
        if (ed < P.predR) { const f = (1 - ed / P.predR) ** 2 * 30 / (ed || 1); ax += ex * f; ay += ey * f; az += ez * f; alarm = 1; }
        if (py < 18) ay += (18 - py) * 0.6;
        ay -= vy * 0.35;
        const sp = Math.hypot(vx, vy, vz) || 1;
        ax += (P.speed - sp) * vx / sp * 1.4; ay += (P.speed - sp) * vy / sp * 1.4; az += (P.speed - sp) * vz / sp * 1.4;
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        velData[i * 4] = vx; velData[i * 4 + 1] = vy; velData[i * 4 + 2] = vz; velData[i * 4 + 3] = alarm;
      }
      for (let i = 0; i < N; i++) {
        posData[i * 4] += velData[i * 4] * dt;
        posData[i * 4 + 1] += velData[i * 4 + 1] * dt;
        posData[i * 4 + 2] += velData[i * 4 + 2] * dt;
      }
      gl.bindTexture(gl.TEXTURE_2D, posT[cur]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.FLOAT, posData);
      gl.bindTexture(gl.TEXTURE_2D, velT[cur]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RGBA, gl.FLOAT, velData);
    };
  }

  // ---------------------------------------------------------------- GPU step
  const bindTex = (unit: number, t: WebGLTexture | null, loc: WebGLUniformLocation | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, unit);
  };
  let simTime = 0;
  const gpuStep = (dt: number) => {
    const home = homeAt(simTime);
    gl.disable(gl.BLEND);

    // where is the flock? the grids are centred on it
    const cp = progs.centroid;
    gl.useProgram(cp.p);
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cenF);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, 1, 1);
    bindTex(0, posT[cur], cp.u('uPos'));
    gl.uniform1i(cp.u('uTexW'), S);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // the falcon flies relative to it
    const pp = progs.predp;
    gl.useProgram(pp.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, predF[1 - pcur]);
    gl.viewport(0, 0, 2, 1);
    bindTex(0, predT[pcur], pp.u('uPredT'));
    bindTex(1, cenT, pp.u('uCen'));
    gl.uniform3f(pp.u('uTgtM'), ...pred.tgtM);
    gl.uniform3f(pp.u('uTgtS'), ...pred.tgtS);
    gl.uniform3f(pp.u('uMove'), pred.speed, pred.turn, pred.lift);
    gl.uniform1f(pp.u('uDt'), dt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    pcur = 1 - pcur;

    // splat into the fine and coarse grids
    const sp = progs.splat;
    gl.useProgram(sp.p);
    gl.bindVertexArray(emptyVao);
    bindTex(0, posT[cur], sp.u('uPos'));
    bindTex(1, velT[cur], sp.u('uVel'));
    bindTex(2, cenT, sp.u('uCen'));
    gl.uniform1i(sp.u('uTexW'), S);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fineFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, FA, FA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(sp.u('uGCell'), FCELL);
    gl.uniform1f(sp.u('uGN'), FN);
    gl.uniform1f(sp.u('uGTiles'), FT);
    gl.uniform2f(sp.u('uGAtlas'), FA, FA);
    gl.drawArrays(gl.POINTS, 0, N);

    gl.bindFramebuffer(gl.FRAMEBUFFER, coarseFbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, CA, CA);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(sp.u('uGCell'), CCELL);
    gl.uniform1f(sp.u('uGN'), CN);
    gl.uniform1f(sp.u('uGTiles'), CT);
    gl.uniform2f(sp.u('uGAtlas'), CA, CA);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.disable(gl.BLEND);

    // integrate
    const up = progs.update;
    gl.useProgram(up.p);
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, simFbo[1 - cur]);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, S, S);
    bindTex(0, posT[cur], up.u('uPos'));
    bindTex(1, velT[cur], up.u('uVel'));
    bindTex(2, fine0, up.u('uF0'));
    bindTex(3, fine1, up.u('uF1'));
    bindTex(4, coarse0, up.u('uC0'));
    bindTex(5, cenT, up.u('uCen'));
    gl.uniform1f(up.u('uFCell'), FCELL);
    gl.uniform1f(up.u('uFN'), FN);
    gl.uniform1f(up.u('uFTiles'), FT);
    gl.uniform2f(up.u('uFAtlas'), FA, FA);
    gl.uniform1f(up.u('uCCell'), CCELL);
    gl.uniform1f(up.u('uCN'), CN);
    gl.uniform1f(up.u('uCTiles'), CT);
    gl.uniform2f(up.u('uCAtlas'), CA, CA);
    gl.uniform1f(up.u('uDt'), dt);
    gl.uniform1f(up.u('uTime'), simTime);
    gl.uniform3f(up.u('uHome'), ...home);
    gl.uniform3f(up.u('uHomeExt'), 75, 26, 120);
    bindTex(6, predT[pcur], up.u('uPredT'));
    gl.uniform1f(up.u('uPredR'), P.predR);
    gl.uniform1f(up.u('uSpeed'), P.speed);
    gl.uniform1f(up.u('uAlign'), P.align);
    gl.uniform1f(up.u('uCoh'), P.coh);
    gl.uniform1f(up.u('uSep'), P.sep);
    gl.uniform1f(up.u('uRho0'), rho0);
    gl.uniform1f(up.u('uNoise'), P.noise);
    gl.uniform1f(up.u('uFlee'), 38);
    gl.uniform1f(up.u('uEsc'), 9);
    gl.uniform1f(up.u('uYMin'), 22);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
  };

  let frameNo = 0;
  const step = (dt: number) => {
    updatePred(dt);
    if (cpuStep) cpuStep(dt, simTime);
    else gpuStep(dt);
    simTime += dt;
  };

  // ---------------------------------------------------------------- render
  const sunDir = (): V3 => {
    const el = (pal.sun ? 1.1 : -3.5) * D2R;
    const az = P.sunAz * D2R;
    return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  };
  const drawBirds = (mirror: number, vw: number, vh: number, t: number) => {
    const bp = progs.bird;
    gl.useProgram(bp.p);
    gl.bindVertexArray(emptyVao);
    bindTex(0, posT[cur], bp.u('uPos'));
    bindTex(1, velT[cur], bp.u('uVel'));
    gl.uniform1i(bp.u('uTexW'), S);
    gl.uniform3f(bp.u('uCamPos'), 0, camH, 0);
    gl.uniform3f(bp.u('uCamR'), ...camR);
    gl.uniform3f(bp.u('uCamU'), ...camU);
    gl.uniform3f(bp.u('uCamF'), ...camF);
    gl.uniform2f(bp.u('uFocal'), fx, fy);
    gl.uniform2f(bp.u('uView'), vw, vh);
    gl.uniform1f(bp.u('uMirror'), mirror);
    gl.uniform1f(bp.u('uTime'), t);
    gl.uniform1f(bp.u('uSpan'), 0.55 * Math.max(1, 1.25 * (1 - S / 256)));
    gl.uniform3f(bp.u('uBird'), ...hex(pal.bird));
    gl.uniform3f(bp.u('uHaze'), ...hex(pal.haze));
    gl.uniform1f(bp.u('uHazeD'), 2600);
    gl.uniform1f(bp.u('uAlpha'), 0.92);
    bindTex(2, predT[pcur], bp.u('uPredT'));
    gl.uniform1f(bp.u('uIsPred'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.uniform1f(bp.u('uIsPred'), 1);
    gl.drawArrays(gl.POINTS, 0, 1);
    gl.disable(gl.BLEND);
  };

  const sky = progs.sky;
  gl.useProgram(sky.p);
  const set3 = (k: string, h: string) => gl.uniform3f(sky.u(k), ...hex(h));
  set3('uHor', pal.hor); set3('uLow', pal.low); set3('uMid', pal.mid); set3('uHigh', pal.high); set3('uZen', pal.zen);
  set3('uGlow', pal.glow); set3('uAnti', pal.anti);
  set3('uCloudDark', pal.cloudDark); set3('uCloudLit', pal.cloudLit);
  set3('uLandFar', pal.land); set3('uLandNear', pal.reed); set3('uWater', pal.water);
  set3('uSunCol', pal.sun || '#ffffff');
  gl.uniform1f(sky.u('uSunDisk'), pal.sun ? 1 : 0);
  gl.uniform1f(sky.u('uGlowW'), P.glowW);
  gl.uniform1f(sky.u('uGlowH'), P.glowH);
  gl.uniform1f(sky.u('uGlowK'), pal.glowK);
  gl.uniform1f(sky.u('uCloud'), P.cloud);
  gl.uniform1f(sky.u('uCloudH'), P.cloudH);
  gl.uniform2f(sky.u('uCloudDir'), Math.cos(P.cloudDir), Math.sin(P.cloudDir));
  gl.uniform1i(sky.u('uLand'), P.land);
  gl.uniform1f(sky.u('uMist'), P.mist);
  gl.uniform1f(sky.u('uCalm'), P.calm);
  gl.uniform1f(sky.u('uSeed'), P.seedF);
  gl.uniform1f(sky.u('uCamH'), camH);
  gl.uniform3f(sky.u('uSun'), ...sunDir());
  const post = progs.post;
  gl.useProgram(post.p);
  gl.uniform3f(post.u('uReed'), ...hex(pal.reed));
  gl.uniform3f(post.u('uReedRim'), ...hex(pal.rim));
  gl.uniform1f(post.u('uReeds'), P.reeds);
  gl.uniform1f(post.u('uSeed'), P.seedF);

  const render = (t: number) => {
    // bird reflections at half resolution
    const rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflF);
    gl.viewport(0, 0, rw, rh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawBirds(-1, rw, rh, t);

    // sky, land and water
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneF);
    gl.viewport(0, 0, W, H);
    gl.useProgram(sky.p);
    gl.bindVertexArray(vao);
    bindTex(0, reflT, sky.u('uRefl'));
    gl.uniform2f(sky.u('uView'), W, H);
    gl.uniform3f(sky.u('uCamR'), ...camR);
    gl.uniform3f(sky.u('uCamU'), ...camU);
    gl.uniform3f(sky.u('uCamF'), ...camF);
    gl.uniform2f(sky.u('uFocal'), fx, fy);
    gl.uniform1f(sky.u('uTime'), t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawBirds(1, W, H, t);

    // composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(post.p);
    gl.bindVertexArray(vao);
    bindTex(0, sceneT, post.u('uScene'));
    gl.uniform2f(post.u('uView'), W, H);
    gl.uniform1f(post.u('uTime'), t);
    gl.uniform1f(post.u('uHorizonY'), 1 - horizonFrac);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---------------------------------------------------------------- warm up, then run
  const DT = 1 / 60;
  const warm = floatRT ? (reduce ? 1200 : 360) : (reduce ? 600 : 180);
  let warmLeft = warm;


  let running = false, raf = 0, last = 0, acc = 0, frames = 0, ftAcc = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    // the flock forms off-stage over the first few frames, then the curtain lifts
    if (warmLeft > 0) {
      const n = Math.min(warmLeft, !floatRT ? 10 : software ? 30 : 90);
      for (let i = 0; i < n; i++) {
        step(DT);
        frameNo++;
      }
      warmLeft -= n;
      last = 0;
      if (warmLeft > 0) return;
    }
    const dtMs = last ? Math.min(100, now - last) : 16.7;
    last = now;
    if (!reduce) {
      acc += dtMs / 1000;
      let n = 0;
      while (acc >= DT && n < 3) { step(DT); acc -= DT; n++; frameNo++; }
      if (n === 3) acc = 0;
    }
    render(simTime);
    if (!canvas.classList.contains('on')) canvas.classList.add('on');
    if (reduce) { stop(); return; }
    // adaptive resolution
    frames++; ftAcc += dtMs;
    if (frames >= 45) {
      const avg = ftAcc / frames;
      if (avg > 24 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); resize(); }
      else if (avg < 15 && scale < 1) { scale = Math.min(1, scale * 1.1); resize(); }
      frames = 0; ftAcc = 0;
    }
  };
  const play = () => { if (running) return; running = true; last = 0; raf = requestAnimationFrame(tick); };
  const stop = () => { if (!running) return; running = false; cancelAnimationFrame(raf); };

  addEventListener('resize', () => { resize(); if (reduce && warmLeft <= 0) render(simTime); });
  play();
  if (!reduce) document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
}
