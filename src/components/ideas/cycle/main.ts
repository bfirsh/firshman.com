// Cycle: the app. Sizing, input, the hidden things, sound.

import { buildWorld, type World, type Hotspot, WATER } from './world';
import { Renderer, type Ripple, type Meteor } from './render';
import { lightAt, SUNRISE, SUNSET } from './light';
import { mulberry32, clamp } from './noise';
import { email, now, projects, alsoWorkedOn, socials } from '../../../data/bio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const POSTS = [
  { title: 'Lately', slugs: ['cog', 'clig', 'arxiv-vanity'] },
  { title: 'The Docker years', slugs: ['compose', 'machine', 'whalebrew'] },
  { title: 'Way back', slugs: ['jsnes', 'django', 'ukhas'] },
];
const STARS = [
  { title: 'The Envelope', html: `<a href="mailto:${email}">${email}</a>`, note: 'write any time' },
  { title: 'The Cross', html: `<a href="${socials[0].url}">${socials[0].name} ${socials[0].handle}</a>`, note: '' },
  { title: 'The Cat', html: `<a href="${socials[1].url}">${socials[1].name} / ${socials[1].handle}</a>`, note: '' },
  { title: 'The Chain', html: `<a href="${socials[2].url}">${socials[2].name}</a>`, note: '' },
];

function labelHTML(h: Hotspot): string {
  if (h.kind === 'name') {
    return `<h2>Ben Firshman</h2><p>I'm working on <a href="${now.url}">${now.name}</a>, to ${esc(now.blurb)}.</p><p class="sub"><a href="mailto:${email}">${email}</a></p>`;
  }
  if (h.kind === 'post') {
    const p = POSTS[h.ref];
    const items = p.slugs.map((s) => projects.find((x) => x.slug === s)!).map((x) => `<li><a href="${x.url}">${esc(x.name)}</a><span>${esc(x.blurb)}</span></li>`).join('');
    return `<h2>${p.title}</h2><ul>${items}</ul>`;
  }
  if (h.kind === 'star') {
    const s = STARS[h.ref];
    return `<h2>${s.title}</h2><p>${s.html}</p>${s.note ? `<p class="sub">${s.note}</p>` : ''}`;
  }
  return `<h2>Greets</h2><p class="sub">to everyone I made these with</p><ul class="greets">${alsoWorkedOn.map((g) => `<li><a href="${g.url}">${esc(g.name)}</a></li>`).join('')}</ul>`;
}
const spotName = (h: Hotspot) =>
  h.kind === 'name' ? 'Lights on the mountain' : h.kind === 'post' ? `Signpost: ${POSTS[h.ref].title}` : h.kind === 'star' ? `Constellation: ${STARS[h.ref].title}` : 'A balloon, high up';

export function start() {
  const d = document.documentElement;
  const seed = parseInt(d.dataset.seed || '1', 10);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rng = mulberry32(seed * 7 + 3);

  const canvas = $<HTMLCanvasElement>('cy');
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const spots = $('spots'), label = $('label'), hint = $('hint');
  const found = $('found');

  // ----- state -----
  const startHours = [18.1, 18.45, 18.8, 19.2, 20.6, 22.5, 1.5, 5.75, 6.3, 7.2, 10.5, 16.8];
  let hour = startHours[Math.floor(rng() * startHours.length)] + (rng() - 0.5) * 0.3;
  let hourVel = 0;
  let clock = 0;
  let weather: 'clear' | 'rain' | 'snow' | 'fog' = (rng() < 0.16 ? (['rain', 'snow', 'fog'] as const)[Math.floor(rng() * 3)] : 'clear');
  const wx = { rain: 0, snow: 0, fog: 0 };
  (['rain', 'snow', 'fog'] as const).forEach((k) => (wx[k] = weather === k ? 1 : 0));
  const ripples: Ripple[] = [];
  const meteors: Meteor[] = [];
  const meteor = () => {
    const k = H / 270;
    const dir = Math.random() < 0.5 ? -1 : 1;
    meteors.push({ x: panX + Math.random() * W, y: world.HZ * (0.05 + Math.random() * 0.35), vx: dir * (90 + Math.random() * 70) * k, vy: (35 + Math.random() * 40) * k, t0: clock, life: 0.5 + Math.random() * 0.5 });
    while (meteors.length > 12) meteors.shift();
  };
  let hover: Hotspot | null = null, pinned: Hotspot | null = null;
  let reveal = 0;
  const seen = new Set<string>();
  let interacted = false;

  let s = 3, W = 480, H = 270, WW = 480, panX = 0, panVel = 0;
  let world!: World, ren!: Renderer;
  let spotEls: HTMLButtonElement[] = [];

  function layout() {
    const vw = innerWidth, vh = innerHeight;
    s = Math.max(2, Math.round(Math.min(vh / 270, vw / 300)));
    if (vw >= 1100 && vh >= 600) s = Math.max(s, 3);
    W = Math.ceil(vw / s); H = Math.ceil(vh / s);
    WW = W < 300 ? Math.round(Math.max(W, Math.min(H * 0.95, 400))) : W;
    canvas.width = W; canvas.height = H;
    canvas.style.width = W * s + 'px'; canvas.style.height = H * s + 'px';
    canvas.style.left = Math.floor((vw - W * s) / 2) + 'px';
    canvas.style.top = Math.floor((vh - H * s) / 2) + 'px';
    world = buildWorld(seed, WW, H);
    if (ren) { ren.w = world; ren.cloudOn = new Uint8Array(ren.cloudOn.length); ren.resize(W); }
    else ren = new Renderer(world, ctx, W);
    panX = (WW - W) / 2;
    buildSpots();
  }

  // ----- hotspots: real buttons for keyboard + screen readers; the pointer is hit-tested on the canvas -----
  function buildSpots() {
    spots.innerHTML = '';
    if (!world.hot.find((h) => h.id === 'balloon')) world.hot.push({ id: 'balloon', kind: 'balloon', x: 0, y: 0, w: 14, h: 22, ref: 0 });
    spotEls = world.hot.map((h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'spot';
      b.setAttribute('aria-label', spotName(h));
      b.dataset.id = h.id;
      b.addEventListener('focus', () => { b.after(label); showLabel(h, true); });
      b.addEventListener('blur', (e) => {
        const to = e.relatedTarget as HTMLElement | null;
        if (to && label.contains(to)) return;
        if (pinned?.id === h.id && !(to && to.classList.contains('spot'))) return;
        pinned = null; showLabel(null);
      });
      b.addEventListener('click', () => { pinned = pinned?.id === h.id ? null : h; showLabel(h, true); });
      spots.appendChild(b);
      return b;
    });
    placeSpots();
  }
  function placeSpots() {
    const ox = parseFloat(canvas.style.left), oy = parseFloat(canvas.style.top);
    world.hot.forEach((h, i) => {
      const el = spotEls[i];
      if (!el) return;
      el.style.transform = `translate(${ox + (h.x - panX) * s}px, ${oy + h.y * s}px)`;
      el.style.width = h.w * s + 'px'; el.style.height = h.h * s + 'px';
    });
  }
  const balloonPos = () => {
    const k = H / 270;
    const span = WW + 80;
    const x = reduced ? WW * 0.68 : (((seed * 37) % span) + clock * 1.3 * k) % span - 40;
    const y = world.HZ * (0.1 + 0.08 * ((seed % 7) / 7)) + Math.sin(clock * 0.35) * 2.5 * k;
    return { x, y };
  };

  // ----- label card -----
  let labelFor: string | null = null;
  let hideT: any = 0;
  function showLabel(h: Hotspot | null, keep = false) {
    if (!h) {
      if (pinned) return;
      label.hidden = true; labelFor = null; return;
    }
    if (labelFor !== h.id) {
      label.innerHTML = labelHTML(h);
      label.dataset.kind = h.kind;
      labelFor = h.id;
      if (!seen.has(h.id)) { seen.add(h.id); chime(seen.size); updateFound(); }
    }
    label.hidden = false;
    positionLabel(h);
    void keep;
  }
  function positionLabel(h: Hotspot) {
    const ox = parseFloat(canvas.style.left), oy = parseFloat(canvas.style.top);
    const r = label.getBoundingClientRect();
    const cx = ox + (h.x - panX + h.w / 2) * s, top = oy + h.y * s, bot = oy + (h.y + h.h) * s;
    let x = cx - r.width / 2;
    x = clamp(x, 12, innerWidth - r.width - 12);
    let y = top - r.height - 10;
    if (y < 12) y = bot + 10;
    if (y + r.height > innerHeight - 12) y = Math.max(12, innerHeight - r.height - 12);
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const total = 9;
  function updateFound() {
    found.textContent = `${seen.size}/${total}`;
    found.hidden = false;
    if (seen.size === total) {
      found.textContent = `${total}/${total} ✦`;
      celebrate = 1;
      hint.textContent = 'you found everything ✦ thank you for looking';
      hint.classList.remove('gone');
      setTimeout(() => hint.classList.add('gone'), 6000);
    }
  }
  let celebrate = 0;

  // ----- input -----
  const toWorld = (cx: number, cy: number) => {
    const ox = parseFloat(canvas.style.left), oy = parseFloat(canvas.style.top);
    return { x: Math.floor((cx - ox) / s + panX), y: Math.floor((cy - oy) / s) };
  };
  const hit = (p: { x: number; y: number }) => {
    let best: Hotspot | null = null, bd = 1e9;
    for (const h of world.hot) {
      const pad = h.kind === 'star' ? 2 : 1;
      if (p.x >= h.x - pad && p.x < h.x + h.w + pad && p.y >= h.y - pad && p.y < h.y + h.h + pad) {
        const dd = Math.abs(p.x - (h.x + h.w / 2)) + Math.abs(p.y - (h.y + h.h / 2));
        if (dd < bd) { bd = dd; best = h; }
      }
    }
    return best;
  };
  const isWater = (p: { x: number; y: number }) => p.x >= 0 && p.x < WW && p.y >= 0 && p.y < H && world.scene[p.y * WW + p.x] === WATER;

  let drag: null | { mode: 'time' | 'pan' | 'water' | 'spot'; x0: number; y0: number; lx: number; ly: number; lt: number; spot: Hotspot | null; moved: boolean; lastRip: { x: number; y: number } } = null;
  const firstTouch = () => {
    if (interacted) return;
    interacted = true;
    hint.classList.add('gone');
  };
  const addRipple = (x: number, y: number, amp = 1) => {
    ripples.push({ x, y, t0: clock, amp });
    while (ripples.length > 7) ripples.shift();
    plip(y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    firstTouch();
    audioResume();
    const p = toWorld(e.clientX, e.clientY);
    const sp = hit(p);
    const mode = sp ? 'spot' : isWater(p) ? 'water' : p.y < world.HZ || WW === W ? 'time' : 'pan';
    drag = { mode, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), spot: sp, moved: false, lastRip: p };
    if (mode === 'water') addRipple(p.x, p.y);
    if (mode === 'time' || mode === 'pan') hourVel *= 0.2;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e.clientX, e.clientY);
    if (!drag) {
      if (e.pointerType === 'mouse') {
        const h = hit(p);
        canvas.style.cursor = h ? 'pointer' : isWater(p) ? 'crosshair' : p.y < world.HZ ? 'ew-resize' : WW > W ? 'grab' : 'default';
        if (h !== hover) {
          hover = h;
          clearTimeout(hideT);
          if (pinned) return;
          if (h) showLabel(h);
          else hideT = setTimeout(() => { if (!hover && !pinned && !label.matches(':hover')) showLabel(null); }, 420);
        }
      }
      return;
    }
    const dx = e.clientX - drag.lx;
    const now2 = performance.now(), dt = Math.max(1, now2 - drag.lt) / 1000;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) {
      drag.moved = true;
      if (drag.mode === 'spot') drag.mode = isWater(p) ? 'water' : p.y < world.HZ || WW === W ? 'time' : 'pan';
    }
    if (drag.mode === 'time') {
      const dh = (dx / innerWidth) * 11;
      hour += dh;
      hourVel = hourVel * 0.6 + (dh / dt) * 0.4;
    } else if (drag.mode === 'pan') {
      panX = clamp(panX - dx / s, 0, WW - W);
      panVel = panVel * 0.6 + (-dx / s / dt) * 0.4;
      placeSpots();
    } else if (drag.mode === 'water') {
      if (isWater(p) && Math.hypot(p.x - drag.lastRip.x, (p.y - drag.lastRip.y) * 2.5) > 7 * (H / 270)) {
        addRipple(p.x, p.y, 0.7);
        drag.lastRip = p;
      }
    }
    drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now2;
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    if (drag.mode === 'spot' && !drag.moved && drag.spot) {
      pinned = pinned?.id === drag.spot.id ? null : drag.spot;
      if (pinned) showLabel(pinned); else { label.hidden = true; labelFor = null; }
    } else if (!drag.moved && drag.mode !== 'water' && pinned) {
      pinned = null; label.hidden = true; labelFor = null;
    }
    if (performance.now() - drag.lt > 80) { hourVel = 0; panVel = 0; }
    if (drag.mode !== 'time') hourVel = 0;
    if (drag.mode !== 'pan') panVel = 0;
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag && !pinned) { hover = null; setTimeout(() => { if (!hover && !pinned && !label.matches(':hover')) showLabel(null); }, 250); } });
  label.addEventListener('pointerleave', () => { if (!pinned && !hover) showLabel(null); });
  label.addEventListener('focusout', (e) => {
    const to = e.relatedTarget as HTMLElement | null;
    if (to && (label.contains(to) || to.classList.contains('spot'))) return;
    pinned = null; showLabel(null);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!pinned) return;
    const t = e.target as HTMLElement;
    if (t === canvas || label.contains(t) || t.closest('.spot')) return;
    pinned = null; showLabel(null);
  });

  // ----- weather, dial, keys -----
  const wbtns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-weather]'));
  const setWeather = (w: typeof weather) => {
    weather = w;
    wbtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === w)));
    firstTouch();
  };
  wbtns.forEach((b) => b.addEventListener('click', () => { audioResume(); setWeather(b.dataset.weather as any); }));
  setWeather(weather);
  interacted = false; hint.classList.remove('gone');

  const dial = $('dial'), dialSun = $('dialSun');
  let dialDrag = false;
  const dialAngle = (e: PointerEvent) => {
    const r = dial.getBoundingClientRect();
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    // 12 noon at the top, midnight at the bottom, sunrise on the left
    return ((((a + Math.PI / 2) / (Math.PI * 2)) * 24 + 12) % 24 + 24) % 24;
  };
  dial.addEventListener('pointerdown', (e) => { dialDrag = true; firstTouch(); dial.setPointerCapture(e.pointerId); hourVel = 0; target = dialAngle(e); });
  dial.addEventListener('pointermove', (e) => { if (dialDrag) target = dialAngle(e); });
  dial.addEventListener('pointerup', () => (dialDrag = false));
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { hourVel += 2.2; e.preventDefault(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { hourVel -= 2.2; e.preventDefault(); }
  });
  let target: number | null = null;

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tgt = e.target as HTMLElement;
    if ($('read').classList.contains('open')) { if (e.key === 'Escape') closeRead(); return; }
    if (e.key === 'Escape') { pinned = null; showLabel(null); return; }
    if (tgt === dial) return;
    if (e.key === 'ArrowRight') { hourVel += 2.2; firstTouch(); }
    else if (e.key === 'ArrowLeft') { hourVel -= 2.2; firstTouch(); }
    else if (e.key === 'w' || e.key === 'W') { const o = ['clear', 'rain', 'snow', 'fog'] as const; setWeather(o[(o.indexOf(weather) + 1) % 4]); }
    else if (e.key === 'r' || e.key === 'R') {
      for (let i = 0; i < 40; i++) {
        const p = { x: Math.floor(panX + Math.random() * W), y: Math.floor(world.HZ + Math.random() * (H - world.HZ)) };
        if (isWater(p)) { addRipple(p.x, p.y); break; }
      }
      firstTouch();
    }
  });

  // ----- read panel -----
  const read = $('read'), readBtn = $('readBtn');
  const readTabs = (on: boolean) => read.querySelectorAll<HTMLElement>('a, button, .sheet').forEach((el) => (on ? el.removeAttribute('tabindex') : el.setAttribute('tabindex', '-1')));
  readTabs(false);
  const openRead = () => { read.classList.add('open'); readTabs(true); readBtn.setAttribute('aria-expanded', 'true'); pinned = null; showLabel(null); ($('readClose') as HTMLButtonElement).focus(); };
  const closeRead = () => { read.classList.remove('open'); readTabs(false); readBtn.setAttribute('aria-expanded', 'false'); readBtn.focus(); };
  readBtn.addEventListener('click', openRead);
  $('readClose').addEventListener('click', closeRead);
  read.addEventListener('click', (e) => { if (e.target === read) closeRead(); });

  // ----- edition -----
  const ed = $<HTMLButtonElement>('ed');
  ed.textContent = `no.${seed}`;
  ed.addEventListener('click', async () => {
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    try { await navigator.clipboard.writeText(url.toString()); ed.textContent = 'copied'; } catch {}
    setTimeout(() => (ed.textContent = `no.${seed}`), 1400);
  });

  // ----- sound (off until asked) -----
  let ac: AudioContext | null = null, master: GainNode | null = null, rainG: GainNode | null = null, fallG: GainNode | null = null, windG: GainNode | null = null;
  let soundOn = false;
  const sbtn = $<HTMLButtonElement>('sound');
  function audioInit() {
    if (ac) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const ch = buf.getChannelData(0);
    let br = 0;
    for (let i = 0; i < ch.length; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; ch[i] = w * 0.5 + br * 3; }
    const src = (f: BiquadFilterType, fr: number, Q: number, g: number) => {
      const n = ac!.createBufferSource(); n.buffer = buf; n.loop = true; n.playbackRate.value = 0.8 + Math.random() * 0.4;
      const bq = ac!.createBiquadFilter(); bq.type = f; bq.frequency.value = fr; bq.Q.value = Q;
      const gn = ac!.createGain(); gn.gain.value = g;
      n.connect(bq).connect(gn).connect(master!); n.start();
      return gn;
    };
    fallG = src('bandpass', 700, 0.6, 0.05);
    windG = src('lowpass', 320, 0.4, 0.06);
    rainG = src('highpass', 2600, 0.5, 0);
  }
  function audioResume() { if (ac && ac.state === 'suspended') ac.resume(); }
  sbtn.addEventListener('click', () => {
    audioInit();
    if (!ac || !master) return;
    audioResume();
    soundOn = !soundOn;
    master.gain.setTargetAtTime(soundOn ? 0.9 : 0, ac.currentTime, 0.4);
    sbtn.setAttribute('aria-pressed', String(soundOn));
    sbtn.textContent = soundOn ? 'sound on' : 'sound';
  });
  const PENT = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568];
  function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', drop = 1) {
    if (!soundOn || !ac || !master) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function chime(n: number) { const f = PENT[(n - 1) % PENT.length]; tone(f, 1.6, 0.08, 'sine'); tone(f * 2, 0.9, 0.025, 'triangle'); }
  function plip(y: number) { const u = clamp((y - world.HZ) / (H - world.HZ)); tone(1200 - u * 600, 0.16, 0.06, 'sine', 0.45); }

  // ----- loop -----
  layout();
  let rT: any = 0;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { layout(); }, 180); });

  let last = performance.now();
  let running = true;
  const dialTxt = (h: number) => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`; };

  function tick(nowT: number) {
    if (!running) return;
    const dt = Math.min(0.05, (nowT - last) / 1000);
    last = nowT;
    clock += dt * (reduced ? 0.25 : 1);
    if (target !== null) {
      let dd = ((target - hour) % 24 + 36) % 24 - 12;
      hour += dd * Math.min(1, dt * 8);
      if (Math.abs(dd) < 0.01 && !dialDrag) target = null;
    }
    if (!drag || drag.mode !== 'time') {
      hour += hourVel * dt;
      hourVel *= Math.exp(-dt * 2.6);
      if (Math.abs(hourVel) < 0.01) hourVel = 0;
      if (!reduced) hour += dt * 0.03;
    }
    if (!drag && panVel) { panX = clamp(panX + panVel * dt, 0, WW - W); panVel *= Math.exp(-dt * 4); if (Math.abs(panVel) < 1) panVel = 0; placeSpots(); }
    hour = ((hour % 24) + 24) % 24;
    for (const k of ['rain', 'snow', 'fog'] as const) wx[k] += ((weather === k ? 1 : 0) - wx[k]) * Math.min(1, dt * 1.2);
    const L = lightAt(hour, wx.rain, wx.snow, wx.fog);
    const nameHot = (hover?.id === 'name' || pinned?.id === 'name' || labelFor === 'name');
    reveal += ((nameHot ? 1 : 0) - reveal) * Math.min(1, dt * 4);
    const bp = balloonPos();
    const bh = world.hot.find((h) => h.id === 'balloon')!;
    const k = H / 270;
    bh.x = Math.round(bp.x - 6 * k); bh.y = Math.round(bp.y - 6 * k); bh.w = Math.round(13 * k); bh.h = Math.round(22 * k);
    const bi = world.hot.indexOf(bh);
    const ox = parseFloat(canvas.style.left), oy = parseFloat(canvas.style.top);
    if (spotEls[bi]) spotEls[bi].style.transform = `translate(${ox + (bh.x - panX) * s}px, ${oy + bh.y * s}px)`;
    if (labelFor === 'balloon' && !label.hidden) positionLabel(bh);
    ren.frame({ t: clock, L, panX, ripples, hover: hover?.id ?? pinned?.id ?? labelFor, reveal, balloon: bp, meteors });
    if (soundOn && ac && rainG && fallG && windG) {
      rainG.gain.setTargetAtTime(wx.rain * 0.09, ac.currentTime, 0.5);
      windG.gain.setTargetAtTime(0.04 + wx.snow * 0.05 + wx.fog * 0.02, ac.currentTime, 0.5);
      fallG.gain.setTargetAtTime(world.wf ? 0.05 : 0.0, ac.currentTime, 0.5);
    }
    // dial
    const a = ((hour - 12) / 24) * Math.PI * 2;
    dialSun.style.transform = `translate(${Math.sin(a) * 13}px, ${-Math.cos(a) * 13}px)`;
    dial.dataset.night = String(hour < SUNRISE - 0.3 || hour > SUNSET + 0.3);
    dial.setAttribute('aria-valuenow', hour.toFixed(1));
    dial.setAttribute('aria-valuetext', dialTxt(hour));
    if (celebrate > 0) {
      if (Math.random() < dt * 4) meteor();
      celebrate -= dt / 9;
    } else if (!reduced && L.stars > 0.5 && Math.random() < dt * 0.04) meteor();
    requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  });
  requestAnimationFrame(tick);
  requestAnimationFrame(() => canvas.classList.add('on'));
}
