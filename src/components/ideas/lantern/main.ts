import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { makeWorld, mulberry32 } from './world';
import { buildMeadow, makeLightUniforms, PushField } from './grass';
import { makeSky, makeTrees, makeGround } from './sky';
import { makeFlyMesh, LightMap, makeGuides } from './flies';
import { FIGURES, ITEMS, buildSlots, type Slot } from './shapes';
import { NightAudio } from './audio';

const DEG = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export function start() {
  const root = document.documentElement;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const low = q.get('q') === 'low' || (q.get('q') !== 'high' && (coarse || Math.min(innerWidth, innerHeight) < 560 || (navigator.hardwareConcurrency || 4) <= 2));

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
  } catch {
    root.classList.add('nogl');
    return;
  }
  root.classList.add('gl');
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 1);

  const world = makeWorld();
  const S = world.season;
  const rand = world.rand;

  // ---------- scene ----------
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 1200);
  cam.position.set(0, 1.6, 0);
  cam.rotation.order = 'YXZ';

  const L = makeLightUniforms();
  const sky = makeSky(world);
  scene.add(sky.mesh);
  scene.add(makeGround(world, L));
  scene.add(makeTrees(world, L));
  const base = low ? { tufts: 4300, seeds: 1300, flowers: 650 } : { tufts: 8500, seeds: 2300, flowers: 1200 };
  const meadow = buildMeadow(world, L, {
    tufts: base.tufts,
    seeds: Math.round((base.seeds * S.seedShare) / 0.3),
    flowers: Math.round((base.flowers * S.flowerShare) / 0.09),
    azRange: low ? 1.02 : 1.12,
    rMax: 38,
  });
  scene.add(meadow.group);

  const push = new PushField(-12, -13.5, 24, 14.5, low ? [160, 96] : [256, 156]);
  meadow.uniforms.uPushRect.value.copy(push.rect);

  const NF = low ? 1400 : 2600;
  const flies = makeFlyMesh(NF, world);
  scene.add(flies.mesh);
  const lmap = new LightMap(-28, -31, 56, 33, low ? [128, 76] : [224, 132], flies.lpoints, flies.lmat);
  L.uLightMap.value = lmap.rt.texture;
  L.uLMRect.value.copy(lmap.rect);
  L.uFog.value = S.fog;
  L.uMist.value = S.mist;

  // ---------- the lantern ----------
  const lantern = buildLantern();
  scene.add(lantern.pivot);

  // ---------- constellations ----------
  const D = 28;
  type Con = {
    i: number; id: string; slots: Slot[]; segs: number[]; nStars: number;
    az: number; el: number; cr: number;
    pos: THREE.Vector3[]; center: THREE.Vector3;
    assigned: number; filled: number; done: boolean; doneT: number;
    dwell: number; invite: number; lit: number; cool: number;
    label: HTMLElement; sx: number; sy: number; sr: number; vis: boolean; minY: number;
  };
  const cons: Con[] = ITEMS.map((it, i) => {
    const b = buildSlots(FIGURES[it.id]);
    const label = document.querySelector(`.lbl[data-id="${it.id}"]`) as HTMLElement;
    return {
      i, id: it.id, slots: b.slots, segs: b.segs, nStars: b.stars.length,
      az: 0, el: 0, cr: 0, pos: b.slots.map(() => new THREE.Vector3()), center: new THREE.Vector3(),
      assigned: 0, filled: 0, done: false, doneT: 0, dwell: 0, invite: 0, lit: 0, cool: 0,
      label, sx: 0, sy: 0, sr: 0, vis: false, minY: Math.min(...b.slots.map((s) => s.y)),
    };
  });
  const totalSlots = cons.reduce((a, c) => a + c.slots.length, 0);
  const totalSegs = cons.reduce((a, c) => a + c.segs.length / 4, 0);
  const guides = makeGuides(totalSlots, 0, totalSegs);
  scene.add(guides.stars, guides.lines);

  const dirFrom = (az: number, el: number, out = new THREE.Vector3()) => out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));

  let W = 1, H = 1, vfov = 50, pitch = 7, hfov = 60, panMax = 0;
  const conTan = new THREE.Vector3(), conUp = new THREE.Vector3(), tmp = new THREE.Vector3();
  function layout() {
    W = innerWidth; H = innerHeight;
    const aspect = W / H;
    const portrait = aspect < 0.85;
    vfov = portrait ? lerp(66, 56, clamp((aspect - 0.45) / 0.4, 0, 1)) : aspect < 1.25 ? 54 : 50;
    pitch = portrait ? 13 : 9;
    cam.fov = vfov; cam.aspect = aspect; cam.updateProjectionMatrix();
    hfov = (2 * Math.atan(Math.tan((vfov / 2) * DEG) * aspect)) / DEG;
    const rows = portrait ? 3 : 2, cols = portrait ? 5 : 7;
    const topVis = pitch + vfov / 2;
    const elB = portrait ? 11 : 12.4;
    const cr = portrait ? Math.min(4.6, (topVis - 4 - elB) * 0.135) : Math.min(5, (topVis - 3.4 - elB) * 0.24);
    const elT = topVis - cr - (portrait ? 5 : 3.4);
    const dE = (elT - elB) / (rows - 1);
    const dA = cr * 2 * 1.68;
    const cells: { az: number; el: number; row: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const az = (c - (cols - 1) / 2) * dA + (r % 2 ? 0.25 : -0.25) * dA * (r === rows - 1 ? 0 : 1);
      // rows of constant elevation bow upward toward the frame edges; pull the top row down there
      const bow = r === rows - 1 ? Math.min(0.0055 * az * az, cr * 1.4) : 0;
      cells.push({ az, el: elB + r * dE - bow, row: r });
    }
    const lr = mulberry32(world.seed + 7);
    // replicate: top row, middle
    const top = cells.filter((c) => c.row === rows - 1).sort((a, b) => Math.abs(a.az) - Math.abs(b.az))[0];
    const rest = cells.filter((c) => c !== top);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(lr() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const order = [top, ...rest];
    // keep the moon in the opening view
    const mi = order.findIndex((c, i) => i > 0 && Math.abs(c.az) < hfov / 2 - cr * 1.8 && Math.abs(c.az) > cr);
    if (mi > 0) { const [m] = order.splice(mi, 1); order.splice(cons.length, 0, m); }
    let maxAz = 0;
    cons.forEach((c, i) => {
      const cell = order[i];
      c.az = (cell.az + (lr() - 0.5) * dA * 0.16) * DEG;
      c.el = (cell.el + (lr() - 0.5) * dE * 0.14) * DEG;
      c.cr = cr * DEG * (c.id === 'replicate' ? 1.05 : c.id === 'greets' ? 1.1 : 1);
      maxAz = Math.max(maxAz, Math.abs(c.az / DEG));
    });
    const mc = order[cons.length];
    sky.uniforms.uMoonDir.value.copy(dirFrom(mc.az * DEG, (mc.el + 1.5) * DEG));
    panMax = Math.max(0, maxAz + cr + 3 - hfov / 2) * DEG;
    // slot world positions
    const sp = guides.stars.geometry.getAttribute('position') as THREE.BufferAttribute;
    const si = guides.stars.geometry.getAttribute('aInfo') as THREE.BufferAttribute;
    const lp = guides.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lc = guides.lines.geometry.getAttribute('aC') as THREE.BufferAttribute;
    let k = 0, ks = 0;
    for (const c of cons) {
      const dir = dirFrom(c.az, c.el);
      c.center.copy(dir).multiplyScalar(D).add(cam.position);
      conTan.set(Math.cos(c.az), 0, Math.sin(c.az));
      conUp.crossVectors(conTan, dir).negate();
      if (conUp.y < 0) conUp.negate();
      const tr = Math.tan(c.cr);
      const toW = (x: number, y: number, out: THREE.Vector3) => out.copy(dir).addScaledVector(conTan, x * tr).addScaledVector(conUp, y * tr).normalize().multiplyScalar(D).add(cam.position);
      c.slots.forEach((s, j) => {
        toW(s.x, s.y, c.pos[j]);
        sp.setXYZ(k, c.pos[j].x, c.pos[j].y, c.pos[j].z);
        si.setXYZ(k, c.i, s.star ? 1 : 0, ((j * 0.618) % 1));
        k++;
      });
      for (let j = 0; j < c.segs.length; j += 4) {
        toW(c.segs[j], c.segs[j + 1], tmp); lp.setXYZ(ks * 2, tmp.x, tmp.y, tmp.z);
        toW(c.segs[j + 2], c.segs[j + 3], tmp); lp.setXYZ(ks * 2 + 1, tmp.x, tmp.y, tmp.z);
        lc.setX(ks * 2, c.i); lc.setX(ks * 2 + 1, c.i);
        ks++;
      }
    }
    sp.needsUpdate = si.needsUpdate = lp.needsUpdate = lc.needsUpdate = true;
  }

  // ---------- post ----------
  const maxDpr = Math.min(window.devicePixelRatio || 1, low ? 1.5 : 1.75);
  let dpr = maxDpr;
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: low ? 0 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.35, 0.8);
  composer.addPass(bloom);
  const final = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uExposure: { value: 1.0 }, uFade: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uExposure, uFade; uniform vec2 uRes;
      varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0) * uExposure;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = max(mix(vec3(l), c, 1.2), 0.0);
        c *= mix(vec3(0.8, 0.95, 1.3), vec3(1.04, 1.0, 0.94), smoothstep(0.0, 0.12, l));
        c = aces(c);
        vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
        c *= 1.0 - smoothstep(0.42, 1.15, length(q)) * 0.6;
        c = pow(c, vec3(1.0/2.2));
        c += vec3(0.004, 0.007, 0.016) * (1.0 - c);
        float n = hash(gl_FragCoord.xy + fract(uTime * 7.13) * 517.0) + hash(gl_FragCoord.yx * 1.3 + fract(uTime * 3.7) * 211.0) - 1.0;
        c += n * 0.018;
        gl_FragColor = vec4(c * uFade, 1.0);
      }`,
  });
  composer.addPass(final);

  function resize() {
    layout();
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
    final.uniforms.uRes.value.set(W, H);
    const px = (vfov * DEG) / (H * dpr);
    sky.uniforms.uPx.value = px;
    flies.uniforms.uPx.value = (vfov * DEG) / H;
    guides.uniforms.uDpr.value = dpr;
  }

  // ---------- lighting from the world ----------
  const moonDir = sky.uniforms.uMoonDir.value;
  const moonStrength = 0.1 * (0.35 + 0.65 * world.moon.phase) * world.moon.bright;
  function applyLights() {
    L.uMoonDir.value.copy(moonDir);
    L.uMoonCol.value.setRGB(lerp(S.moonTint[0], 0.5, 0.6) * moonStrength, lerp(S.moonTint[1], 0.68, 0.6) * moonStrength, lerp(S.moonTint[2], 1.0, 0.6) * moonStrength * 1.1);
    L.uSkyAmb.value.setRGB(S.mid[0] * 2.4 + 0.006, S.mid[1] * 2.4 + 0.01, S.mid[2] * 2.0 + 0.018);
    L.uFogCol.value.setRGB(S.hills[0] * 0.5 + S.horizon[0] * 0.5 + S.glow[0] * 0.15, S.hills[1] * 0.5 + S.horizon[1] * 0.5 + S.glow[1] * 0.15, S.hills[2] * 0.5 + S.horizon[2] * 0.5 + S.glow[2] * 0.15);
  }

  // ---------- fireflies ----------
  const P = new Float32Array(NF * 3), V = new Float32Array(NF * 3), HM = new Float32Array(NF * 3), OF = new Float32Array(NF * 3);
  const ST = new Uint8Array(NF); // 0 wander, 1 follow, 2 to slot, 3 settled, 4 scattered
  const CON = new Int16Array(NF).fill(-1), SL = new Int16Array(NF).fill(-1);
  const DL = new Float32Array(NF), PH = new Float32Array(NF), FQ = new Float32Array(NF), TM = new Float32Array(NF), GL = new Float32Array(NF), SYNC = new Float32Array(NF);
  const azR = (low ? 1.02 : 1.12) * 0.95;
  const pickHome = (i: number, nearX?: number, nearZ?: number) => {
    let x: number, z: number;
    if (nearX !== undefined && nearZ !== undefined && Math.hypot(nearX, nearZ) < 22) {
      x = nearX + (rand() - 0.5) * 4; z = Math.min(-1.5, nearZ + (rand() - 0.5) * 4);
    } else {
      const r = 2.5 + 19 * Math.pow(rand(), 0.9), a = (rand() * 2 - 1) * azR;
      x = Math.sin(a) * r; z = -Math.cos(a) * r;
    }
    HM[i * 3] = x; HM[i * 3 + 1] = 0.3 + 2.0 * Math.pow(rand(), 1.7); HM[i * 3 + 2] = z;
  };
  for (let i = 0; i < NF; i++) {
    pickHome(i);
    P[i * 3] = HM[i * 3] + (rand() - 0.5); P[i * 3 + 1] = HM[i * 3 + 1]; P[i * 3 + 2] = HM[i * 3 + 2] + (rand() - 0.5);
    PH[i] = rand(); FQ[i] = 0.2 + rand() * 0.3; DL[i] = 0.04 + Math.pow(rand(), 1.5) * 1.3;
    const u = rand() * 2 - 1, th = rand() * 6.283, rr = Math.cbrt(rand());
    OF[i * 3] = Math.sqrt(1 - u * u) * Math.cos(th) * rr; OF[i * 3 + 1] = u * rr * 0.7; OF[i * 3 + 2] = Math.sqrt(1 - u * u) * Math.sin(th) * rr;
  }

  // lantern state
  const lan = {
    tx: 0, ty: 0, x: 0, y: 0, glide: 0,
    world: new THREE.Vector3(0, 0.85, -3.2), depth: 3.2, light: new THREE.Vector3(),
    spd: 0, raw: 0, lastMove: 0,
    vw: new THREE.Vector3(), prev: new THREE.Vector3(),
    th: [0, 0], om: [0, 0],
    flare: 0, active: false, inside: false,
  };
  const HIST = 80, HZ = 30;
  const SWARM_MAX = low ? 200 : 280;
  const hist = new Float32Array(HIST * 4);
  let histHead = 0, histAcc = 0;
  let followers = 0;
  let swarmPhase = 0;
  const swarmC = new THREE.Vector3();
  let yaw = 0, yawVel = 0, yawTarget: number | null = null;

  let started = false, firstT = 0;
  let progress = 0;
  let finale = 0, finaleT = -1;

  const audio = new NightAudio();

  // ---------- input ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function screenToWorld(x: number, y: number, out: THREE.Vector3) {
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const d = ray.ray.direction;
    const e = Math.asin(clamp(d.y, -1, 1));
    let tn = 12;
    if (d.y < -1e-4) tn = clamp((cam.position.y - 1.0) / -d.y, 1.3, 12);
    const w = smooth(-0.04, 0.2, e);
    const t = lerp(tn, D, w);
    out.copy(cam.position).addScaledVector(d, t);
    return t;
  }

  let lastEvT = 0, lastEvX = 0, lastEvY = 0;
  function interact() {
    if (!started) {
      started = true;
      firstT = performance.now();
      root.classList.add('played');
    }
  }
  function moveTo(x: number, y: number, kind: string, jump: boolean) {
    const now = performance.now();
    if (!jump && lastEvT) {
      const dt = Math.max(4, now - lastEvT) / 1000;
      const v = Math.hypot(x - lastEvX, y - lastEvY) / dt / H;
      lan.raw = Math.max(lan.raw * 0.5, v);
      lan.lastMove = now;
    }
    lastEvT = now; lastEvX = x; lastEvY = y;
    lan.tx = x; lan.ty = y;
    if (jump) lan.glide = kind === 'touch' ? 1 : 0.6;
    interact();
  }
  const isUI = (el: EventTarget | null) => el instanceof Element && !!el.closest('a, button, .panel, .lbl, .ui');
  canvas.addEventListener('pointermove', (e) => {
    const touch = e.pointerType !== 'mouse';
    if (touch && !lan.active) return;
    lan.inside = true;
    moveTo(e.clientX, e.clientY - (touch ? 46 : 0), e.pointerType, false);
  });
  canvas.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType !== 'mouse';
    lan.active = true; lan.inside = true;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const y = e.clientY - (touch ? 46 : 0);
    const far = Math.hypot(e.clientX - lan.x, y - lan.y) > H * 0.04;
    lastEvT = 0;
    moveTo(e.clientX, y, e.pointerType, touch && far);
    downAt = performance.now(); downX = e.clientX; downY = e.clientY;
  });
  let downAt = 0, downX = 0, downY = 0;
  const endTouch = (e: PointerEvent) => {
    const tap = performance.now() - downAt < 300 && Math.hypot(e.clientX - downX, e.clientY - downY) < 12;
    if (e.pointerType !== 'mouse') { lan.active = false; lan.inside = false; }
    if (tap) act();
    lastEvT = 0;
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', () => { lan.active = false; lan.inside = false; });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) lan.inside = false; });
  window.addEventListener('blur', () => { lan.inside = false; keys.clear(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); yaw = clamp(yaw + (e.deltaX + e.deltaY) * 0.0011, -panMax, panMax); interact(); }, { passive: false });

  const keys = new Set<string>();
  const kv = { x: 0, y: 0 };
  window.addEventListener('keydown', (e) => {
    if (panelOpen) { if (e.key === 'Escape') closePanel(); return; }
    if (isUI(e.target) && e.target !== document.body) return;
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
      keys.add(k); e.preventDefault(); interact();
    } else if (k === ' ' || k === 'enter') { e.preventDefault(); act(); interact(); }
    if (e.shiftKey) keys.add('shift');
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (!e.shiftKey) keys.delete('shift'); });

  // click / tap / space: release near a constellation, otherwise flare the lantern to call fireflies
  function act() {
    interact();
    const c = nearCon();
    if (c && followers > 0) { release(c); return; }
    lan.flare = 1;
  }

  // ---------- panel ----------
  const panel = document.getElementById('read')!;
  let panelOpen = false;
  let lastFocus: Element | null = null;
  function openPanel(e?: Event, focus = true) {
    e?.preventDefault();
    if (panelOpen) return;
    panelOpen = true; lastFocus = focus ? document.activeElement : document.getElementById('readBtn');
    panel.classList.add('open');
    if (focus) setTimeout(() => (panel.querySelector('.panel-in') as HTMLElement).focus(), 40);
  }
  function closePanel() {
    panelOpen = false;
    panel.classList.remove('open');
    if (panel.contains(document.activeElement)) (lastFocus as HTMLElement | null)?.focus?.();
  }
  // tabbing into the text opens it
  panel.addEventListener('focusin', () => openPanel(undefined, false));
  document.getElementById('readBtn')!.addEventListener('click', openPanel);
  panel.addEventListener('click', (e) => { if (e.target === panel || (e.target as Element).closest('.close')) closePanel(); });

  const soundBtn = document.getElementById('soundBtn')!;
  soundBtn.addEventListener('click', () => {
    if (audio.on) { audio.stop(); soundBtn.setAttribute('aria-pressed', 'false'); soundBtn.textContent = 'sound'; }
    else { audio.start(); soundBtn.setAttribute('aria-pressed', 'true'); soundBtn.textContent = 'sound on'; }
  });
  (document.getElementById('edition') as HTMLElement).textContent = `no. ${world.edition} · ${S.name}`;
  const countEl = document.getElementById('count')!;
  const nextSeed = Math.floor(Math.random() * 1e9);
  document.querySelectorAll<HTMLAnchorElement>('.another').forEach((a) => { a.href = `${location.pathname}?seed=${nextSeed}`; });

  // focusing a revealed link pans the sky to it
  for (const c of cons) c.label.addEventListener('focusin', () => { yawTarget = clamp(c.az, -panMax, panMax); });

  // ---------- constellation logic ----------
  function nearCon(): Con | null {
    if (lan.depth < D * 0.7) return null;
    let best: Con | null = null, bd = Infinity;
    for (const c of cons) {
      if (c.done || !c.vis) continue;
      const d = Math.hypot(lan.x - c.sx, lan.y - c.sy) / (c.sr * 1.35);
      if (d < 1 && d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function release(c: Con) {
    const need = c.slots.length - c.assigned;
    if (need <= 0) return;
    const idx: number[] = [];
    for (let i = 0; i < NF; i++) if (ST[i] === 1) idx.push(i);
    idx.sort((a, b) => DL[a] - DL[b]);
    const n = Math.min(need, idx.length);
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      ST[i] = 2; CON[i] = c.i; SL[i] = c.assigned++; TM[i] = k * 0.012 + rand() * 0.15;
    }
    c.dwell = 0; c.cool = 0.8;
    followers -= n;
  }
  function complete(c: Con) {
    c.done = true; c.doneT = clock;
    progress++;
    countEl.textContent = `${progress} / ${cons.length}`;
    c.label.hidden = false;
    void c.label.offsetWidth;
    c.label.classList.add('on', 'fresh');
    setTimeout(() => c.label.classList.remove('fresh'), 9000);
    audio.chord(c.i);
    if (progress === cons.length) { finaleT = clock; }
  }

  // ---------- the loop ----------
  let clock = 0, last = performance.now(), raf = 0, frames = 0, slowFrames = 0, thin = 1;
  const v3 = new THREE.Vector3();
  const tmpW = new THREE.Vector3();

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.1) dt = 0.1;
    const tscale = reduced ? 0.45 : 1;
    clock += dt;
    const t = clock;

    // adaptive resolution
    frames++;
    if (frames > 30) {
      if (dt > 1 / 40) slowFrames++; else slowFrames = Math.max(0, slowFrames - 0.5);
      if (slowFrames > 45) {
        slowFrames = 0;
        if (dpr > 0.85) { dpr = Math.max(0.85, dpr * 0.82); resize(); }
        else if (thin > 0.45) {
          // still slow: thin the meadow (instances are in random order, so this thins evenly)
          thin *= 0.8;
          for (const m of meadow.group.children as THREE.Mesh[]) { const g = m.geometry as THREE.InstancedBufferGeometry; g.instanceCount = Math.floor(((g.userData.full as number) ?? g.instanceCount) * thin); }
        } else if (dpr > 0.6) { dpr = Math.max(0.6, dpr * 0.85); resize(); }
      }
    }

    // keyboard lantern
    let kx = 0, ky = 0;
    if (keys.has('arrowleft') || keys.has('a')) kx -= 1;
    if (keys.has('arrowright') || keys.has('d')) kx += 1;
    if (keys.has('arrowup') || keys.has('w')) ky -= 1;
    if (keys.has('arrowdown') || keys.has('s')) ky += 1;
    const ks = (keys.has('shift') ? 3.2 : 0.42) * H;
    kv.x += (kx * ks - kv.x) * damp(6, dt); kv.y += (ky * ks - kv.y) * damp(6, dt);
    if (Math.abs(kv.x) + Math.abs(kv.y) > 1) {
      lan.tx = clamp(lan.tx + kv.x * dt, 4, W - 4); lan.ty = clamp(lan.ty + kv.y * dt, 4, H - 4);
      lan.raw = Math.max(lan.raw, Math.hypot(kv.x, kv.y) / H); lan.lastMove = now;
    }
    // idle drift before the first touch
    if (!started) {
      lan.tx = W * (0.5 + 0.12 * Math.sin(t * 0.21)); lan.ty = H * (0.8 + 0.03 * Math.sin(t * 0.33));
      lan.raw = 0.1;
    }
    lan.spd += (lan.raw - lan.spd) * damp(9, dt);
    if (now - lan.lastMove > 70) lan.raw *= Math.exp(-dt * 18);
    const kfollow = lan.glide > 0 ? 7 : 30;
    lan.glide = Math.max(0, lan.glide - dt * 2.5);
    lan.x += (lan.tx - lan.x) * damp(kfollow, dt); lan.y += (lan.ty - lan.y) * damp(kfollow, dt);

    // camera: edge pan + a slow breath
    let pan = 0;
    const edge = Math.min(W * 0.08, 90);
    const keyPan = keys.size > 0;
    if ((lan.inside || keyPan) && started) {
      if (lan.x < edge) pan = -(1 - lan.x / edge); else if (lan.x > W - edge) pan = (lan.x - (W - edge)) / edge;
    }
    if (pan !== 0) yawTarget = null;
    if (yawTarget !== null) { yaw += (yawTarget - yaw) * damp(3, dt); if (Math.abs(yawTarget - yaw) < 0.002) yawTarget = null; }
    yawVel += (pan * 26 * DEG - yawVel) * damp(5, dt);
    yaw = clamp(yaw + yawVel * dt, -panMax, panMax);
    const breath = reduced ? 0 : 1;
    cam.rotation.y = -yaw + Math.sin(t * 0.11) * 0.004 * breath;
    cam.rotation.x = pitch * DEG + Math.sin(t * 0.17) * 0.003 * breath;
    cam.updateMatrixWorld();

    // lantern world position, pendulum and light
    lan.prev.copy(lan.world);
    lan.depth = screenToWorld(lan.x, lan.y, lan.world);
    v3.subVectors(lan.world, lan.prev).divideScalar(Math.max(dt, 1e-3));
    tmpW.copy(lan.vw);
    lan.vw.lerp(v3, damp(14, dt));
    const acc = tmpW.subVectors(lan.vw, tmpW).divideScalar(Math.max(dt, 1e-3));
    const sc = lan.depth * 0.0072;
    // swing: acceleration in camera-right / camera-forward, normalised by scale
    const ax = clamp(acc.x * Math.cos(yaw) + acc.z * Math.sin(yaw), -400, 400) / Math.max(sc * 60, 0.05);
    const az2 = clamp(-acc.x * Math.sin(yaw) + acc.z * Math.cos(yaw), -400, 400) / Math.max(sc * 60, 0.05);
    for (let k = 0; k < 2; k++) {
      const a = k === 0 ? ax : az2;
      lan.om[k] += (-26 * Math.sin(lan.th[k]) - a * 0.16 - lan.om[k] * 2.6) * dt;
      lan.th[k] = clamp(lan.th[k] + lan.om[k] * dt, -1.1, 1.1);
    }
    lan.flare = Math.max(0, lan.flare - dt * 1.6);
    const flick = 0.88 + 0.08 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1) + 0.05 * Math.sin(t * 23.3);
    lantern.update(lan.world, sc, lan.th[0], lan.th[1], yaw, flick * (1 + lan.flare * 0.8), lan.light);
    const lowness = 1 - smooth(1.3, 3.0, lan.light.y);
    L.uLantern.value.set(lan.light.x, lan.light.y, lan.light.z, (2.4 + lan.flare * 3) * flick * lerp(0.4, 1, lowness));

    // history for the trailing swarm
    histAcc += dt;
    while (histAcc > 1 / HZ) {
      histAcc -= 1 / HZ;
      histHead = (histHead + 1) % HIST;
      hist.set([lan.light.x, lan.light.y, lan.light.z, lan.depth], histHead * 4);
    }
    const histAt = (delay: number, out: number[]) => {
      const f = delay * HZ;
      const i0 = Math.floor(f), fr = f - i0;
      const a = ((histHead - i0) % HIST + HIST) % HIST, b = ((histHead - i0 - 1) % HIST + HIST) % HIST;
      for (let k = 0; k < 4; k++) out[k] = lerp(hist[a * 4 + k], hist[b * 4 + k], fr);
    };

    // ---- fireflies ----
    const slow = lan.spd < 0.6, fast = lan.spd > 2.5 && started;
    const LX = lan.light.x, LY = lan.light.y, LZ = lan.light.z;
    const depthScale = clamp(lan.depth / 4, 0.6, 3.4);
    const recruitR = (1.7 + lan.depth * 0.1 + Math.sqrt(followers) * 0.04) * (1 + lan.flare * 0.9);
    const curiousR = recruitR * 2.1;
    swarmPhase += dt * 0.62 * tscale;
    if (fast && followers > 0) {
      for (let i = 0; i < NF; i++) if (ST[i] === 1) {
        const o = i * 3;
        let dx = P[o] - LX, dy = P[o + 1] - LY, dz = P[o + 2] - LZ;
        const d = Math.hypot(dx, dy, dz) + 1e-3;
        dx /= d; dy /= d; dz /= d;
        const s = (2.2 + rand() * 3.5) * depthScale;
        V[o] += dx * s + (rand() - 0.5) * 2 * depthScale; V[o + 1] += dy * s + (rand() - 0.2) * 1.5 * depthScale; V[o + 2] += dz * s + (rand() - 0.5) * 2 * depthScale;
        ST[i] = 4; TM[i] = 1.8 + rand() * 1.6; SYNC[i] = 0;
      }
      followers = 0;
      audio.whoosh();
    }
    const wdx = Math.cos(world.wind.angle) * world.wind.strength * 0.12, wdz = Math.sin(world.wind.angle) * world.wind.strength * 0.12;
    let fc = 0; swarmC.set(0, 0, 0);
    const hv = [0, 0, 0, 0];
    const tt = t * tscale;
    for (let i = 0; i < NF; i++) {
      const o = i * 3;
      let px = P[o], py = P[o + 1], pz = P[o + 2];
      let vx = V[o], vy = V[o + 1], vz = V[o + 2];
      const st = ST[i];
      const ph = PH[i];
      let ax = 0, ay = 0, az = 0;
      let glow = 0;
      PH[i] = (ph + dt * FQ[i] * tscale) % 1;
      if (st === 0 || st === 4) {
        // meander in a slow flow field, tethered to home
        const fx = Math.sin(py * 1.7 + tt * 0.31 + i) + Math.sin(pz * 0.53 + tt * 0.17 + i * 0.3) * 0.6;
        const fy = Math.sin(px * 0.9 + tt * 0.43 + i * 0.7) * 0.5 + Math.cos(pz * 1.1 + tt * 0.23) * 0.3;
        const fz = Math.cos(px * 0.71 + tt * 0.27 + i * 1.3) + Math.sin(py * 1.3 - tt * 0.19) * 0.6;
        const fs = 0.32 * tscale;
        ax = (fx * fs + wdx - vx) * 1.1 + (HM[o] - px) * 0.035;
        ay = (fy * fs * 0.6 - vy) * 1.1 + (HM[o + 1] - py) * 0.06;
        az = (fz * fs + wdz - vz) * 1.1 + (HM[o + 2] - pz) * 0.035;
        if (py < 0.15) ay += (0.15 - py) * 6;
        if (st === 4) {
          ax -= vx * 0.6; ay -= vy * 0.6; az -= vz * 0.6;
          TM[i] -= dt;
          if (TM[i] <= 0) { ST[i] = 0; pickHome(i, px, pz); }
        } else if (started) {
          const dx = LX - px, dy = LY - py, dz = LZ - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < curiousR * curiousR) {
            const d = Math.sqrt(d2) + 1e-3;
            const pull = (slow ? 0.9 : 0.25) * (1 - d / curiousR) * (1 + lan.flare * 2);
            ax += (dx / d) * pull; ay += (dy / d) * pull; az += (dz / d) * pull;
            if (slow && d < recruitR && followers < SWARM_MAX && rand() < dt * 3.2 * (1 + lan.flare * 3)) {
              ST[i] = 1; followers++; SYNC[i] = 0;
            }
          }
        }
        const pulse = Math.exp(-((ph - 0.5) ** 2) / 0.0045);
        glow = pulse;
        if (finaleT >= 0) { const wave = (swarmPhase * 0.5 - Math.hypot(px, pz) * 0.045 + 10) % 1; glow = lerp(glow, 0.05 + 0.85 * Math.exp(-((wave - 0.5) ** 2) / 0.004), finale); }
      } else if (st === 1 || (st === 2 && TM[i] > 0)) {
        if (st === 2) TM[i] -= dt;
        histAt(DL[i], hv);
        const ds = clamp(hv[3] / 4, 0.6, 2.3);
        const spread = (0.16 + DL[i] * 0.5) * ds;
        const rot = tt * (0.6 + (i % 7) * 0.08) + i;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        const ox = OF[o] * cr - OF[o + 2] * sr, oz = OF[o] * sr + OF[o + 2] * cr;
        const tx = hv[0] + ox * spread, ty = hv[1] + OF[o + 1] * spread + 0.05 * ds, tz = hv[2] + oz * spread;
        const k = 9, c = 3.9;
        ax = (tx - px) * k - vx * c + Math.sin(tt * 2.1 + i) * 0.4 * ds;
        ay = (ty - py) * k - vy * c + Math.cos(tt * 1.7 + i * 1.3) * 0.3 * ds;
        az = (tz - pz) * k - vz * c + Math.sin(tt * 1.9 + i * 0.7) * 0.4 * ds;
        // the swarm slowly falls into step
        SYNC[i] = Math.min(1, SYNC[i] + dt * 0.35);
        const target = swarmPhase % 1;
        let dphi = target - PH[i]; dphi -= Math.round(dphi);
        PH[i] = (PH[i] + dphi * SYNC[i] * dt * 2.2 + 1) % 1;
        const pulse = Math.exp(-((PH[i] - 0.5) ** 2) / 0.016);
        glow = 0.3 + pulse * 1.0;
        if (st === 1) { fc++; swarmC.x += px; swarmC.y += py; swarmC.z += pz; }
      } else if (st === 2) {
        const c = cons[CON[i]];
        const sp = c.pos[SL[i]];
        const dx = sp.x - px, dy = sp.y - py, dz = sp.z - pz;
        const d = Math.hypot(dx, dy, dz);
        const k = 5.5, cc = 3.6;
        ax = dx * k - vx * cc + Math.sin(tt * 3 + i) * Math.min(d, 3) * 0.8;
        ay = dy * k - vy * cc + Math.cos(tt * 2.6 + i) * Math.min(d, 3) * 0.5;
        az = dz * k - vz * cc;
        const sp2 = Math.hypot(vx, vy, vz);
        if (sp2 > 30) { vx *= 30 / sp2; vy *= 30 / sp2; vz *= 30 / sp2; }
        glow = 1.0;
        if (d < 0.12) {
          ST[i] = 3; c.filled++;
          audio.ting(SL[i] + c.i * 3);
          if (c.filled >= c.slots.length) complete(c);
        }
      } else {
        // settled into a star
        const c = cons[CON[i]];
        const sp = c.pos[SL[i]];
        const k = damp(6, dt);
        px += (sp.x + Math.sin(tt * 0.9 + i) * 0.02 - px) * k;
        py += (sp.y + Math.cos(tt * 0.7 + i) * 0.02 - py) * k;
        pz += (sp.z - pz) * k;
        vx = vy = vz = 0;
        const star = c.slots[SL[i]].star;
        const lit = c.done ? smooth(0, 1.5, t - c.doneT) : 0;
        glow = (star ? 0.8 : 0.42) * (0.85 + 0.15 * Math.sin(tt * (1.2 + (i % 5) * 0.3) + i)) * (1 + lit * 0.45 + finale * 0.3);
        if (c.done && t - c.doneT < 1.2) glow *= 1 + 1.5 * Math.exp(-(t - c.doneT) * 3) * (star ? 1 : 0.6);
        P[o] = px; P[o + 1] = py; P[o + 2] = pz;
      }
      if (st !== 3) {
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        P[o] = px; P[o + 1] = py; P[o + 2] = pz;
        V[o] = vx; V[o + 1] = vy; V[o + 2] = vz;
      }
      GL[i] += (glow - GL[i]) * damp(14, dt);
      const g4 = i * 4;
      flies.pg[g4] = P[o]; flies.pg[g4 + 1] = P[o + 1]; flies.pg[g4 + 2] = P[o + 2]; flies.pg[g4 + 3] = GL[i] * (started || clock > 0.5 ? 1 : clock * 2);
    }
    followers = fc;
    if (fc > 0) swarmC.divideScalar(fc);
    flies.aPG.needsUpdate = true;
    flies.lpos.needsUpdate = true;

    // ---- constellations ----
    let nearest: Con | null = null;
    const nc = started ? nearCon() : null;
    for (const c of cons) {
      v3.copy(c.center).project(cam);
      c.vis = v3.z < 1 && Math.abs(v3.x) < 1.3 && Math.abs(v3.y) < 1.3;
      c.sx = (v3.x * 0.5 + 0.5) * W; c.sy = (-v3.y * 0.5 + 0.5) * H;
      c.sr = (Math.tan(c.cr) / Math.tan((vfov / 2) * DEG)) * (H / 2);
      c.cool = Math.max(0, c.cool - dt);
      const near = c === nc && followers > 0;
      if (near) {
        nearest = c;
        if (c.cool <= 0) c.dwell += dt * (slow ? 1 : 0.35);
        if (c.dwell > 0.85) release(c);
      } else c.dwell = Math.max(0, c.dwell - dt * 2);
      const want = c.done ? 0 : (near ? 0.5 + c.dwell * 0.6 : 0) + (followers > 12 ? 0.22 + 0.18 * Math.sin(t * 2.2 + c.i) : 0);
      c.invite += (want - c.invite) * damp(4, dt);
      c.lit += ((c.done ? 1 : 0) - c.lit) * damp(1.5, dt);
      guides.uniforms.uInvite.value[c.i] = c.invite;
      guides.uniforms.uLit.value[c.i] = c.lit;
    }
    void nearest;
    if (finaleT >= 0) finale = Math.min(1, finale + dt / 6);
    if (finaleT >= 0 && t - finaleT > 2.2) root.classList.add('skyfull');

    // ---- uniforms ----
    const ut = t * tscale;
    L.uTime.value = ut;
    sky.uniforms.uTime.value = t;
    flies.uniforms.uTime.value = t;
    guides.uniforms.uTime.value = t;
    final.uniforms.uTime.value = t;
    sky.uniforms.uLit.value = finale;
    L.uGlow.value = finale * 0.06;
    meadow.uniforms.uSwarm.value.copy(swarmC);
    meadow.uniforms.uSwarmI.value = fc > 0 ? Math.min(1.2, fc / 120) * 0.12 * (1 - smooth(2, 4, swarmC.y)) : 0;
    const fadeIn = reduced ? 1 : smooth(0, 2.6, t);
    final.uniforms.uFade.value = fadeIn;

    // GPU passes: grass spring field, firefly light map, then the frame
    const pushAmp = lowness * (0.65 + lan.flare * 0.8);
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    void fx; void fz;
    meadow.uniforms.uPush.value = push.step(renderer, lan.light.x, lan.light.z, pushAmp, 0.62 + lan.flare * 0.5, clamp(lan.vw.x, -6, 6), clamp(lan.vw.z, -6, 6), Math.min(dt, 0.033));
    lmap.render(renderer);
    composer.render(dt);

    // ---- HTML: labels, hint ----
    for (const c of cons) {
      if (!c.done) continue;
      const below = c.el + c.minY * c.cr - 1.0 * DEG;
      dirFrom(c.az, below, v3).multiplyScalar(D).add(cam.position).project(cam);
      const x = (v3.x * 0.5 + 0.5) * W, y = (-v3.y * 0.5 + 0.5) * H;
      const on = v3.z < 1 && x > -200 && x < W + 200;
      c.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, 0)`;
      c.label.style.visibility = on ? 'visible' : 'hidden';
    }
    if (started && performance.now() - firstT > 4500) root.classList.add('hinted');
    audio.update(world.wind.gust * 0.6, fc);
  }

  applyLights();
  resize();
  applyLights();
  lan.x = lan.tx = W * 0.5; lan.y = lan.ty = H * 0.8;
  addEventListener('resize', () => { resize(); applyLights(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); audio.stop(); }
    else { last = performance.now(); raf = requestAnimationFrame(frame); if (soundBtn.getAttribute('aria-pressed') === 'true') audio.start(); }
  });
  raf = requestAnimationFrame(frame);
}

// A little voxel lantern that hangs from the cursor and swings.
function buildLantern() {
  const vox: { x: number; y: number; z: number; e: number }[] = [];
  const add = (x: number, y: number, z: number, e = 0) => vox.push({ x, y, z, e });
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) add(x, 0, z);
  for (let y = 1; y <= 4; y++) for (const x of [-2, 2]) for (const z of [-2, 2]) add(x, y, z);
  for (let y = 1; y <= 4; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) add(x, y, z, 1);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) < 4) add(x, 5, z);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) add(x, 6, z);
  for (const [x, y] of [[-1, 7], [-1, 8], [0, 9], [1, 8], [1, 7]]) add(x, y, 0);
  const box = new THREE.BoxGeometry(0.96, 0.96, 0.96).toNonIndexed();
  const bp = box.getAttribute('position'), bn = box.getAttribute('normal');
  const n = bp.count;
  const pos = new Float32Array(vox.length * n * 3), nor = new Float32Array(vox.length * n * 3), cen = new Float32Array(vox.length * n * 3), em = new Float32Array(vox.length * n);
  vox.forEach((v, k) => {
    for (let j = 0; j < n; j++) {
      const o = (k * n + j) * 3;
      pos[o] = bp.getX(j) + v.x; pos[o + 1] = bp.getY(j) + v.y - 9.5; pos[o + 2] = bp.getZ(j) + v.z;
      nor[o] = bn.getX(j); nor[o + 1] = bn.getY(j); nor[o + 2] = bn.getZ(j);
      cen[o] = v.x; cen[o + 1] = v.y; cen[o + 2] = v.z;
      em[k * n + j] = v.e;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aC', new THREE.BufferAttribute(cen, 3));
  g.setAttribute('aE', new THREE.BufferAttribute(em, 1));
  const uniforms = { uFlick: { value: 1 }, uWarm: { value: new THREE.Color(1.0, 0.56, 0.2) } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aC; attribute float aE; uniform float uFlick; uniform vec3 uWarm; varying vec3 vCol;
      void main(){
        vec3 core = vec3(0., 2.5, 0.);
        if (aE > 0.5) {
          float k = 1.0 - length(aC - core) * 0.22;
          vCol = mix(uWarm, vec3(1.0, 0.78, 0.45), k) * (0.7 + 1.1 * k) * uFlick;
        } else {
          vec3 to = normalize(core - aC);
          float inner = max(dot(normal, to), 0.0);
          vCol = vec3(0.012, 0.008, 0.006) + uWarm * (inner * 0.6 + 0.012) * uFlick + vec3(0.01,0.015,0.03) * max(normal.y, 0.);
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vCol; void main(){ gl_FragColor = vec4(vCol, 1.); }`,
  });
  mat.depthTest = false;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  const pivot = new THREE.Group();
  pivot.add(mesh);
  const local = new THREE.Vector3();
  return {
    pivot,
    update(at: THREE.Vector3, s: number, thx: number, thz: number, yaw: number, flick: number, lightOut: THREE.Vector3) {
      pivot.position.copy(at).addScaledVector(new THREE.Vector3(0, 1, 0), 7 * s);
      pivot.scale.setScalar(s);
      pivot.rotation.set(0, 0, 0);
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = -yaw;
      pivot.rotation.z = thx;
      pivot.rotation.x = -thz;
      pivot.updateMatrixWorld();
      lightOut.copy(local.set(0, -7, 0).applyMatrix4(pivot.matrixWorld));
      uniforms.uFlick.value = flick;
    },
  };
}
