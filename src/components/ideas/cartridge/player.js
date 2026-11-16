// Cartridge: JSNES driven by the sound card's clock, drawn through a CRT.
import { NES, Controller } from 'jsnes';
import romUrl from './demo.nes?url';
import { KEYS, PAD_BUTTONS, PAD_DEADZONE, TOUCH, PLAYER_KEYS } from './keymap.js';
import { CRT, fitTube, ASPECT, NES_W, NES_H, LOOK } from './crt.js';
import { NesAudio } from './audio.js';

// NTSC: 341 x 262 PPU dots per frame, minus the skipped dot on odd frames, at 5.369318 MHz.
export const NTSC_FPS = (21477272.7 / 4) / (341 * 262 - 0.5); // 60.0988
const FRAME_MS = 1000 / NTSC_FPS;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeOutBack = (x, k = 0.9) => { x = clamp(x) - 1; return 1 + (k + 1) * x * x * x + k * x * x; };

// The power-on, as a function of seconds since the switch.
function powerState(t) {
  if (t < 0) return { on: 0, raster: [0, 0, 0], line: 0, degauss: 0, animating: false };
  const hx = easeOut((t - 0.07) / 0.15);
  const open = t < 0.26 ? 0 : easeOutBack((t - 0.26) / 0.55, 0.7);
  const vy = t < 0.26 ? 0 : 0.004 + 0.996 * open;
  const breathe = 1 + 0.03 * Math.exp(-Math.max(0, t - 0.4) / 0.4);
  const warm = Math.pow(smooth(0.25, 1.8, t), 0.85) * (1 + 0.12 * Math.exp(-Math.pow((t - 1.0) / 0.35, 2)));
  // as the raster opens the beam is hot: the squeezed picture flares, then the cathode settles
  const flash = t < 0.26 ? 0 : 0.85 * Math.exp(-(t - 0.26) / 0.3);
  const squeeze = Math.min(1.8, 1 / Math.sqrt(Math.max(vy, 0.02)));
  const line = t < 0.07 ? 0 : clamp((t - 0.07) / 0.03) * (1 - smooth(0.25, 0.4, t));
  const degauss = t < 0.14 ? 0 : 0.75 * Math.exp(-(t - 0.14) / 0.32);
  return {
    on: smooth(0.04, 0.7, t),
    raster: [hx * breathe, vy * breathe, Math.max(warm, flash) * squeeze],
    line,
    degauss: degauss < 0.003 ? 0 : degauss,
    animating: t < 4,
  };
}

const BUTTONS = ['A', 'B', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

// A plain canvas when there's no WebGL2: nearest-neighbour pixels, cover-fitted, 8:7.
class Flat {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = NES_W; canvas.height = NES_H;
    canvas.classList.add('flat');
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(NES_W, NES_H);
    this.px = new Uint32Array(this.img.data.buffer);
  }
  frame(buf) {
    const px = this.px;
    for (let i = 0; i < px.length; i++) px[i] = buf[i] | 0xff000000;
    this.dirty = true;
  }
  render(state) {
    if (this.dirty) { this.ctx.putImageData(this.img, 0, 0); this.dirty = false; }
    const w = innerWidth, h = innerHeight;
    const fit = fitTube(w, h, { ...LOOK, curve: 0 });
    const ih = (2 * fit.s) / LOOK.overscan, iw = ih * ASPECT;
    const s = this.canvas.style;
    s.width = `${iw}px`; s.height = `${ih}px`;
    s.left = `${fit.cx - iw / 2}px`; s.top = `${fit.cy - ih / 2}px`;
    s.transform = `scale(${Math.max(0.002, state.raster[0])}, ${Math.max(0.002, state.raster[1] || (state.line ? 0.004 : 0))})`;
    s.opacity = String(Math.min(1, state.raster[2] + state.line));
  }
  resize() {}
}

export function start(root) {
  const canvas = root.querySelector('canvas');
  const prompt = root.querySelector('.prompt');
  const muteBtn = document.querySelector('.chrome .mute');
  const fsBtn = document.querySelector('.chrome .fs');
  const params = new URLSearchParams(location.search);
  const debug = import.meta.env.DEV || params.has('debug');

  // --- screen
  let screen;
  try { if (params.has('flat')) throw new Error('asked for flat'); screen = new CRT(canvas); } catch (e) { console.info('No WebGL2 CRT (' + e.message + '): plain pixels instead'); screen = new Flat(canvas); }
  const isCRT = screen instanceof CRT;
  document.documentElement.classList.toggle('flat', !isCRT);

  let dirty = true;
  // if the GPU can't keep up, render fewer pixels (twice at most; never back up, to avoid see-sawing)
  let quality = 1;
  const adapt = { n: 0, slow: 0 };
  let cssW = 0, cssH = 0, devW = 0, devH = 0;
  const sizeCanvas = () => {
    if (!isCRT) { dirty = true; return; }
    const raw = window.devicePixelRatio || 1;
    let dpr = Math.min(raw, 2);
    // phones at 3x: render at native resolution while it stays cheap, so the grille stays crisp
    if (raw > 2 && cssW * cssH * raw * raw <= 3.8e6) dpr = raw;
    dpr *= quality;
    let w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    // exact device pixels when the browser reports them (fractional DPRs), if they agree with the estimate
    if (dpr === raw && devW && Math.abs(devW - w) <= 2 && Math.abs(devH - h) <= 2) { w = devW; h = devH; }
    if (w !== canvas.width || h !== canvas.height) screen.resize(w, h, dpr);
    dirty = true;
  };
  const ro = new ResizeObserver((entries) => {
    const e = entries[0];
    cssW = e.contentRect.width; cssH = e.contentRect.height;
    const dp = e.devicePixelContentBoxSize?.[0];
    devW = dp ? dp.inlineSize : 0; devH = dp ? dp.blockSize : 0;
    sizeCanvas();
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', sizeCanvas);
  addEventListener('resize', () => { dirty = true; });

  if (isCRT) {
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); screen.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { screen.init(); screen.resize(canvas.width, canvas.height, window.devicePixelRatio || 1); dirty = true; });
  }

  // --- cartridge
  let romBytes = null;
  const romReady = (async () => {
    let url = romUrl;
    if (import.meta.env.DEV && params.get('rom') === 'test') url = (await import('./testpattern/testpattern.nes?url')).default;
    if (url.startsWith('data:')) {
      // an inlined ROM (standalone copies of the page): decode it here, since fetch() of
      // data: URLs can be blocked by a content security policy
      const bin = atob(url.slice(url.indexOf(',') + 1));
      romBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) romBytes[i] = bin.charCodeAt(i);
      return;
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error(`ROM ${r.status}`);
    romBytes = new Uint8Array(await r.arrayBuffer());
  })();
  romReady.then(() => root.classList.add('ready')).catch((e) => {
    console.warn(e);
    prompt.textContent = 'the cartridge would not load';
    root.classList.add('ready', 'broken');
  });

  // --- state
  const audio = new NesAudio();
  let muted = false;
  try { muted = localStorage.getItem('cartridge-muted') === '1'; } catch {}
  audio.muted = muted;
  muteBtn.setAttribute('aria-pressed', String(muted));

  let nes = null;
  let powered = false, powerAt = 0, running = false, crashed = 0;
  let frameCount = 0, newFrame = false, acc = 0, last = performance.now(), emuMs = 0;
  const pressed = new Uint8Array(8);            // what the NES currently sees
  const sources = { key: new Set(), pad: new Set(), touch: new Set() };
  const timed = [];                             // [button, until frame] for swipes

  const sync = () => {
    if (!nes) return;
    for (let i = 0; i < 8; i++) {
      const b = BUTTONS[i];
      const down = sources.key.has(b) || sources.pad.has(b) || sources.touch.has(b) || timed.some((t) => t[0] === b);
      if (down !== !!pressed[i]) {
        pressed[i] = down ? 1 : 0;
        if (down) nes.buttonDown(1, Controller['BUTTON_' + b]); else nes.buttonUp(1, Controller['BUTTON_' + b]);
      }
    }
  };

  const step = () => {
    if (!nes) return;
    for (let i = timed.length - 1; i >= 0; i--) if (frameCount >= timed[i][1]) { timed.splice(i, 1); sync(); }
    const t0 = performance.now();
    try {
      nes.frame();
      emuMs += (performance.now() - t0 - emuMs) * 0.02;
    } catch (e) {
      // a work-in-progress ROM can crash: say so quietly and reboot it
      if (!crashed) console.warn('NES crashed, resetting', e);
      crashed++;
      try { nes.loadROM(romBytes); } catch {}
    }
    frameCount++;
  };

  // The sound card asks for more: run frames until the queue is back at its target.
  const pump = () => {
    if (!running) return;
    let n = 0;
    while (audio.buffered() < audio.target && n < 5) { step(); n++; }
    audio.flush();
    acc = 0;
  };
  audio.onTick = pump;

  const powerOn = async () => {
    if (powered || root.classList.contains('broken')) return;
    powered = true;
    powerAt = performance.now();   // the picture follows the relay, even if the cartridge is still loading
    root.classList.add('on');
    // audio must be created inside the gesture
    const haveAudio = audio.create();
    if (haveAudio) audio.powerOn();
    try { await romReady; } catch { return; }
    if (haveAudio) await audio.start().catch(() => {});
    nes = new NES({
      sampleRate: audio.sampleRate,
      emulateSound: true,
      onFrame: (buf) => { screen.frame(buf); newFrame = true; },
      onAudioSample: (l, r) => audio.push(l, r),
    });
    nes.loadROM(romBytes);
    if (haveAudio && audio.ctx) audio.fadeInNes(audio.ctx.currentTime + 0.32, 0.5);
    running = !document.hidden;
    last = performance.now();
    sync();
  };

  // --- loop
  let debugAt = null;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(100, now - last);
    last = now;
    pollPads();
    if (running && !audio.clockAlive()) {
      // no audio clock (yet): keep time ourselves
      acc += dt;
      let n = 0;
      while (acc >= FRAME_MS && n < 4) { step(); acc -= FRAME_MS; n++; }
      if (n === 4) acc = 0;
      audio.flush();
    }
    let t = powered ? (now - powerAt) / 1000 : -1;
    if (debugAt !== null && t >= 0) t = debugAt;
    const st = powerState(t);
    if (dirty || newFrame || st.animating) {
      st.time = Math.max(0, t);
      st.seed = frameCount;
      screen.render(st);
      dirty = false; newFrame = false;
      if (isCRT && running && !params.has('hq') && quality > 0.55) {
        adapt.n++; if (dt > 25) adapt.slow++;
        if (adapt.n >= 120) {
          if (adapt.slow > 60) { quality *= 0.75; sizeCanvas(); }
          adapt.n = adapt.slow = 0;
        }
      }
    }
  };
  requestAnimationFrame(loop);

  // --- visibility: the set pauses with the tab
  document.addEventListener('visibilitychange', () => {
    if (!nes) return;
    if (document.hidden) { running = false; audio.suspend(); }
    else { audio.drop(); audio.resume(); running = true; acc = 0; last = performance.now(); }
  });

  // --- input
  const ignoreUp = new Set();
  const isChrome = (el) => el && el.closest && el.closest('.chrome');
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    audio.resume();
    if (!powered) {
      if (e.code === 'Tab' || e.code === 'Escape' || isChrome(document.activeElement) && (e.code === 'Enter' || e.code === 'Space')) return;
      e.preventDefault();
      ignoreUp.add(e.code);
      powerOn();
      return;
    }
    const act = PLAYER_KEYS[e.code];
    if (act && !e.repeat) { e.preventDefault(); if (act === 'mute') toggleMute(); else toggleFullscreen(); return; }
    const b = KEYS[e.code];
    if (!b) return;
    e.preventDefault();
    if (ignoreUp.has(e.code)) return;
    sources.key.add(b); sync();
  });
  addEventListener('keyup', (e) => {
    if (ignoreUp.delete(e.code)) return;
    const b = KEYS[e.code];
    if (b) { sources.key.delete(b); sync(); }
  });
  addEventListener('blur', () => { sources.key.clear(); sources.touch.clear(); ignoreUp.clear(); sync(); });

  // A tap presses A; a swipe presses a direction. A waits a moment to see which it is.
  let touchStart = null;
  canvas.addEventListener('pointerdown', (e) => {
    audio.resume();
    if (!powered) { e.preventDefault(); powerOn(); return; }
    if (e.pointerType === 'mouse') return;
    const t = { id: e.pointerId, x: e.clientX, y: e.clientY, swiped: false, held: false };
    t.timer = setTimeout(() => { if (touchStart === t && !t.swiped) { t.held = true; sources.touch.add(TOUCH.tap); sync(); } }, 70);
    touchStart = t;
  });
  canvas.addEventListener('pointermove', (e) => {
    const t = touchStart;
    if (!t || e.pointerId !== t.id || t.swiped || t.held || !TOUCH.swipe) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    if (Math.hypot(dx, dy) < TOUCH.swipeMinPx) return;
    t.swiped = true;
    clearTimeout(t.timer);
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : dy > 0 ? 'DOWN' : 'UP';
    timed.push([dir, frameCount + TOUCH.swipeFrames]);
    sync();
  });
  const touchEnd = (e) => {
    const t = touchStart;
    if (!t || e.pointerId !== t.id) return;
    touchStart = null;
    clearTimeout(t.timer);
    // a quick tap that ended before A went down still presses it, briefly
    if (!t.held && !t.swiped && e.type === 'pointerup') timed.push([TOUCH.tap, frameCount + 4]);
    sources.touch.clear(); sync();
  };
  canvas.addEventListener('pointerup', touchEnd);
  canvas.addEventListener('pointercancel', touchEnd);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const now = new Set();
    for (const p of pads) {
      if (!p || !p.connected) continue;
      for (const [i, b] of Object.entries(PAD_BUTTONS)) if (p.buttons[i]?.pressed) now.add(b);
      const [x = 0, y = 0] = p.axes;
      if (x < -PAD_DEADZONE) now.add('LEFT'); if (x > PAD_DEADZONE) now.add('RIGHT');
      if (y < -PAD_DEADZONE) now.add('UP'); if (y > PAD_DEADZONE) now.add('DOWN');
    }
    if (!powered && now.size) { powerOn(); return; }
    let changed = now.size !== sources.pad.size;
    if (!changed) for (const b of now) if (!sources.pad.has(b)) { changed = true; break; }
    if (changed) { sources.pad = now; sync(); }
  }

  // --- chrome
  function toggleMute() {
    muted = !muted;
    audio.setMuted(muted);
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    try { localStorage.setItem('cartridge-muted', muted ? '1' : '0'); } catch {}
  }
  const fsEl = document.documentElement;
  const canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  if (!canFs) fsBtn.hidden = true;
  function toggleFullscreen() {
    if (!canFs) return;
    const cur = document.fullscreenElement || document.webkitFullscreenElement;
    if (cur) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl)?.catch?.(() => {});
  }
  muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); muteBtn.blur(); });
  fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); fsBtn.blur(); });
  if (muted) muteBtn.setAttribute('aria-label', 'Unmute');

  // the cursor and the chrome get out of the way when nothing moves
  let idleTimer = 0;
  const wake = () => {
    document.documentElement.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.documentElement.classList.add('idle'), 2200);
  };
  addEventListener('pointermove', wake, { passive: true });
  addEventListener('pointerdown', wake, { passive: true });
  wake();

  if (debug) {
    window.__cart = {
      get frames() { return frameCount; },
      get crashed() { return crashed; },
      get emuMs() { return emuMs; },
      get audio() { return { mode: audio.mode, state: audio.ctx?.state, rate: audio.sampleRate, target: audio.target, buffered: audio.buffered(), underruns: audio.underruns, underrunEvents: audio.underrunEvents, time: audio.ctx?.currentTime, consumed: audio.consumed, alive: audio.clockAlive(), written: audio.written }; },
      get pressed() { return BUTTONS.filter((_, i) => pressed[i]); },
      get crt() { return isCRT ? { w: canvas.width, h: canvas.height, triad: screen.triad, hdr: screen.hdr, fields: screen.frames, quality } : null; },
      look: isCRT ? screen.look : null,
      redraw: () => { dirty = true; },
      at: (t) => { debugAt = t; dirty = true; },
      freeze: (on = true) => { running = !on; dirty = true; },
      skip: (n) => { for (let i = 0; i < n; i++) step(); audio.drop(); dirty = true; },
      nes: () => nes,
      screen,
    };
  }
}
