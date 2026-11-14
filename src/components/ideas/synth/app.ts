import { channels } from './channels';
import { makeSong, noteName, type Song } from './song';
import { Engine } from './engine';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll(s)) as T[];
const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-4);

// ------------------------------------------------------------- knobs
class Knob {
  min: number; max: number; step: number; value: number; def: number;
  body: HTMLElement;
  constructor(public el: HTMLElement, public onChange: (v: number) => void, public fmt: (v: number) => string = (v) => String(Math.round(v))) {
    this.min = +el.dataset.min!; this.max = +el.dataset.max!; this.step = +(el.dataset.step || 1);
    this.value = this.def = +el.dataset.value!;
    this.body = el.querySelector('.knob-body') as HTMLElement;
    this.render();
    let start = 0, sx = 0, sy = 0, id = -1;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId); id = e.pointerId;
      start = this.value; sx = e.clientX; sy = e.clientY;
      el.focus({ preventScroll: true });
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const range = this.max - this.min;
      const px = el.classList.contains('sm') ? 140 : 220;
      const d = ((e.clientX - sx) - (e.clientY - sy)) / (e.shiftKey ? px * 4 : px);
      this.set(start + d * range);
    });
    const end = (e: PointerEvent) => { if (e.pointerId === id) id = -1; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => this.set(this.def));
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.set(this.value - Math.sign(e.deltaY) * this.step * (this.max - this.min > 50 ? 2 : 1)); }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const big = (this.max - this.min) / 10;
      const k: Record<string, number> = { ArrowUp: this.step, ArrowRight: this.step, ArrowDown: -this.step, ArrowLeft: -this.step, PageUp: big, PageDown: -big };
      if (e.key in k) { e.preventDefault(); this.set(this.value + k[e.key]); }
      else if (e.key === 'Home') { e.preventDefault(); this.set(this.min); }
      else if (e.key === 'End') { e.preventDefault(); this.set(this.max); }
    });
  }
  set(v: number) {
    v = Math.round(Math.min(this.max, Math.max(this.min, v)) / this.step) * this.step;
    if (v === this.value) return;
    this.value = v;
    this.render();
    this.onChange(v);
  }
  render() {
    const a = -135 + (270 * (this.value - this.min)) / (this.max - this.min);
    this.body.style.setProperty('--rot', `${a}deg`);
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value)));
    this.el.setAttribute('aria-valuetext', this.fmt(this.value));
  }
}

export function startSynth() {
  const reduceQ = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = reduceQ.matches;
  reduceQ.addEventListener('change', () => { reduce = reduceQ.matches; drawScope(true); });

  const voices = channels.map((c) => c.voice);
  const q = new URLSearchParams(location.search).get('seed');
  let seed = q ? parseInt(q, 16) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  let song: Song = makeSong(seed, voices);
  let bpm = 96;
  let engine: Engine | null = null;
  const mute = channels.map(() => false);
  const solo = channels.map(() => false);
  const levels = channels.map(() => 0.8);
  let volume = 0.75, space = 0.4;

  const rows = $$('.row');
  const stepBtns = rows.map((r) => $$<HTMLButtonElement>('.step', r));
  const heads = $$('.sh-steps .n');
  const playBtn = $<HTMLButtonElement>('#play');
  const playLabel = $('#play-label');
  const lcd = [$('#lcd1'), $('#lcd2'), $('#lcd3')];
  const seedEl = $('#seed');
  const serial = $('#serial');
  const bpmOut = $('#bpm');
  const needle = $('#needle');
  const scope = $<HTMLCanvasElement>('#scope');
  const sctx = scope.getContext('2d')!;

  // ----------------------------------------------------------- audio, created inside the first gesture
  function audioNow(): Engine {
    if (engine) { if (engine.ctx.state === 'suspended') engine.ctx.resume(); return engine; }
    engine = new Engine(voices, () => song, () => bpm);
    engine.setVolume(volume); engine.setSpace(space);
    levels.forEach((l, i) => engine!.setLevel(i, l));
    applyGates();
    return engine;
  }

  // ----------------------------------------------------------- LCD
  let cols = 30;
  const measure = () => {
    const glass = $('.lcd-glass');
    const probe = document.createElement('span');
    probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    glass.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const cs = getComputedStyle(glass);
    cols = Math.max(16, Math.floor((glass.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / (w || 10)));
  };
  const wrap = (s: string, n: number) => {
    const out: string[] = [];
    let line = '';
    for (const w of s.split(' ')) {
      if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    }
    out.push(line);
    return out;
  };
  let lcdMsg: { lines: string[]; until: number } | null = null;
  let focusCh = -1;
  function setLcd(lines: string[], blinkLast = false) {
    lines.forEach((l, i) => {
      const text = l.length > cols ? l.slice(0, cols - 1) + '…' : l;
      if (lcd[i].textContent !== text) lcd[i].textContent = text;
      lcd[i].classList.toggle('blink', blinkLast && i === lines.length - 1 && !reduce);
    });
  }
  let lastAi = '··';
  function updateLcd(step = -1, bar = 0) {
    const now = performance.now();
    if (lcdMsg && now < lcdMsg.until) return setLcd(lcdMsg.lines);
    lcdMsg = null;
    const soloed = solo.findIndex(Boolean);
    const ch = focusCh >= 0 ? focusCh : soloed;
    if (ch >= 0) {
      const c = channels[ch];
      const b = wrap(c.blurb.charAt(0).toUpperCase() + c.blurb.slice(1) + '.', cols);
      const head = `${c.lcd}${c.now ? ' ▸ NOW' : ''}`;
      return setLcd([head.length > cols ? c.lcd : head, b[0] || '', b[1] || (b.length > 2 ? '' : `▸ ${c.role.toUpperCase()}`)]);
    }
    if (playing) {
      const s = String((step < 0 ? 0 : step) + 1).padStart(2, '0');
      return setLcd([
        `♪ ${song.keyName} ${song.mode.toUpperCase()} · ${bpm} BPM`,
        `BAR ${bar + 1}/4  STEP ${s}  #${hex(seed)}`,
        `REPLICATE PREDICTS ▸ ${lastAi}`,
      ]);
    }
    setLcd(['BEN FIRSHMAN · BF-09', `${channels.length} voices, all synthesised`, 'press ▶ to play'], true);
  }
  function flash(lines: string[], ms = 1400) { lcdMsg = { lines, until: performance.now() + ms }; setLcd(lines); }

  // ----------------------------------------------------------- patterns
  function renderPatterns() {
    song.patterns.forEach((p, ch) => p.forEach((on, s) => stepBtns[ch][s].setAttribute('aria-pressed', String(on))));
    seedEl.textContent = `seed ${hex(seed)}`;
    serial.textContent = `BF09-${hex(seed)}-${hex(seed * 2654435761)}`;
  }
  stepBtns.forEach((btns, ch) => btns.forEach((b, s) => {
    b.addEventListener('click', () => {
      const on = !song.patterns[ch][s];
      song.patterns[ch][s] = on;
      b.setAttribute('aria-pressed', String(on));
      if (on && engine && !playing) engine.preview(ch, s);
    });
  }));

  // ----------------------------------------------------------- mute / solo / level
  function audible(i: number) { return solo.some(Boolean) ? solo[i] : !mute[i]; }
  function applyGates() {
    rows.forEach((r, i) => r.classList.toggle('muted', !audible(i)));
    engine?.setGates(channels.map((_, i) => audible(i)));
  }
  rows.forEach((row, i) => {
    const m = $<HTMLButtonElement>('.mute', row), s = $<HTMLButtonElement>('.solo', row);
    m.addEventListener('click', () => { mute[i] = !mute[i]; m.setAttribute('aria-pressed', String(mute[i])); applyGates(); });
    s.addEventListener('click', () => { solo[i] = !solo[i]; s.setAttribute('aria-pressed', String(solo[i])); applyGates(); updateLcd(); });
    new Knob($('.lvl', row), (v) => { levels[i] = v / 100; engine?.setLevel(i, v / 100); }, (v) => `${Math.round(v)}%`);
    const enter = () => { focusCh = i; updateLcd(); };
    const leave = () => { if (focusCh === i) { focusCh = -1; updateLcd(cur.step, cur.bar); } };
    row.addEventListener('pointerenter', enter);
    row.addEventListener('pointerleave', leave);
    row.addEventListener('focusin', enter);
    row.addEventListener('focusout', leave);
  });

  // ----------------------------------------------------------- global knobs
  new Knob($('#k-tempo'), (v) => {
    bpm = v; bpmOut.textContent = String(v);
    engine?.updateDelay();
    flash([`TEMPO ${v} BPM`, v < 80 ? 'very relaxed' : v > 130 ? 'deploy on friday' : 'steady', ''], 900);
  }, (v) => `${Math.round(v)} BPM`);
  new Knob($('#k-space'), (v) => { space = v / 100; engine?.setSpace(space); flash([`SPACE ${Math.round(v)}%`, 'reverb + delay', ''], 900); }, (v) => `${Math.round(v)}%`);
  new Knob($('#k-vol'), (v) => { volume = v / 100; engine?.setVolume(volume); flash([`VOLUME ${Math.round(v)}%`, '', ''], 900); }, (v) => `${Math.round(v)}%`);

  // ----------------------------------------------------------- transport
  let playing = false;
  const cur = { step: -1, bar: 0 };
  function setPlaying(on: boolean) {
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.setAttribute('aria-label', on ? 'Stop' : 'Play');
    playLabel.textContent = on ? 'stop' : 'press to play';
    if (!on) { cur.step = -1; clearPlayhead(); }
    updateLcd();
  }
  function togglePlay() {
    if (playing) { engine?.stop(); setPlaying(false); return; }
    audioNow().start();
    setPlaying(true);
  }
  playBtn.addEventListener('click', togglePlay);

  function reroll() {
    seed = (Math.random() * 2 ** 32) >>> 0;
    const old = song.patterns;
    song = makeSong(seed, voices);
    engine?.reseedAi();
    renderPatterns();
    if (!reduce) {
      // a little cascade across the pads
      stepBtns.forEach((btns, ch) => btns.forEach((b, s) => {
        if (old[ch][s] === song.patterns[ch][s]) return;
        b.animate([{ transform: 'scale(.82)', filter: 'brightness(1.8)' }, { transform: 'none', filter: 'none' }], { duration: 260, delay: (s + ch) * 14, easing: 'ease-out' });
      }));
    }
    flash([`RE-ROLLED ▸ #${hex(seed)}`, `${song.keyName} ${song.mode.toUpperCase()}`, 'new song, same band'], 1600);
  }
  $('#reroll').addEventListener('click', reroll);

  // ----------------------------------------------------------- keyboard
  const keyEls = $$<HTMLButtonElement>('.key');
  function playKey(i: number) {
    const m = audioNow().playKey(i);
    flash([`KEY ${'ASDFGHJKL'[i]} ▸ ${noteName(m)}`, `${song.keyName} ${song.mode.toUpperCase()}, always in key`, ''], 700);
    const k = keyEls[i];
    k.classList.add('down');
    setTimeout(() => k.classList.remove('down'), 140);
  }
  keyEls.forEach((k, i) => k.addEventListener('pointerdown', () => playKey(i)));
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, [contenteditable]')) return;
    if (notes.classList.contains('open')) return;
    const k = e.key.toLowerCase();
    const i = 'asdfghjkl'.indexOf(k);
    if (i >= 0 && k.length === 1) { e.preventDefault(); playKey(i); return; }
    if (k === 'r' && !tgt.closest('[role=slider]')) { reroll(); return; }
    if (e.key === ' ' && !tgt.closest('button, a, [role=slider]')) { e.preventDefault(); togglePlay(); }
  });

  // ----------------------------------------------------------- flip and liner notes
  const device = $('#device');
  const front = $('.face.front'), back = $('.face.back');
  back.setAttribute('inert', '');
  function flip(toBack: boolean) {
    device.classList.toggle('flipped', toBack);
    if (device.getBoundingClientRect().top < 0) device.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    $('#flip').setAttribute('aria-pressed', String(toBack));
    $('#flip .toggle').classList.toggle('on', toBack);
    if (toBack) { front.setAttribute('inert', ''); back.removeAttribute('inert'); setTimeout(() => $<HTMLElement>('#flip-back').focus({ preventScroll: true }), 50); }
    else { back.setAttribute('inert', ''); front.removeAttribute('inert'); setTimeout(() => $<HTMLElement>('#flip').focus({ preventScroll: true }), 50); }
  }
  $('#flip').addEventListener('click', () => flip(true));
  $('#flip-back').addEventListener('click', () => flip(false));

  const notes = $('#notes');
  const notesBtn = $<HTMLButtonElement>('#notes-btn');
  const openNotes = (focus: boolean) => { notes.classList.add('open'); notesBtn.setAttribute('aria-expanded', 'true'); if (focus) $<HTMLElement>('#notes-close').focus(); };
  const closeNotes = () => { notes.classList.remove('open'); notesBtn.setAttribute('aria-expanded', 'false'); notesBtn.focus(); };
  notesBtn.addEventListener('click', () => (notes.classList.contains('open') ? closeNotes() : openNotes(true)));
  $('#notes-close').addEventListener('click', closeNotes);
  notes.addEventListener('click', (e) => { if (e.target === notes) closeNotes(); });
  notes.addEventListener('focusin', () => { if (!notes.classList.contains('open')) openNotes(false); });
  notes.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNotes(); });

  // ----------------------------------------------------------- visuals
  const viz = rows.map((r) => $('.viz', r));
  const bassBoxes = $$('.v-bass rect');
  let bassN = 0, gearA = 0, sqX = 0;
  const typedEl = $('.v-type .typed');
  const typeText = 'clig.dev --help';
  let typed = 0;
  const aiNote = $('.v-ai .v-note');
  const sq = $<SVGPathElement>('.v-square .sq');
  const gearEl = $<SVGPathElement>('.v-hat .gear');
  const balloon = $<SVGGElement>('.v-pad .balloon');
  const timers = new Map<Element, number>();
  const pulse = (el: Element, cls: string, ms: number) => {
    el.classList.remove(cls);
    void (el as HTMLElement).getBoundingClientRect();
    el.classList.add(cls);
    clearTimeout(timers.get(el));
    timers.set(el, window.setTimeout(() => el.classList.remove(cls), ms));
  };
  function onHit(ch: number, midi?: number) {
    pulse(rows[ch], 'hit', 90);
    const v = channels[ch].voice;
    const el = viz[ch];
    switch (v) {
      case 'ai': lastAi = midi ? noteName(midi) : '··'; aiNote.textContent = lastAi; pulse(el, 'on', 160); break;
      case 'square': sqX = (sqX + 12) % 24; sq.style.transform = `translateX(${-sqX}px)`; break;
      case 'pluck': pulse(el, 'on', 360); break;
      case 'pad': balloon.style.transform = 'translateY(-5px)'; setTimeout(() => (balloon.style.transform = 'translateY(1px)'), 1300); break;
      case 'whale': pulse(el, 'on', 900); break;
      case 'bass': bassBoxes.forEach((b, k) => b.classList.toggle('lit', k === bassN % 8 || (b.classList.contains('lit') && k < bassN % 8))); bassN++; break;
      case 'hat': gearA += 22.5; gearEl.style.transform = `rotate(${gearA}deg)`; break;
      case 'type':
        if (midi === -1) { typed = 0; typedEl.textContent = ''; }
        else { typed = typed >= typeText.length ? 1 : typed + 1; typedEl.textContent = typeText.slice(Math.max(0, typed - 9), typed); }
        break;
      case 'paper': pulse(el, 'on', 140); break;
      case 'kick': pulse(el, 'on', 120); break;
    }
  }
  function clearPlayhead() {
    heads.forEach((h) => h.classList.remove('now'));
    stepBtns.forEach((b) => b.forEach((x) => x.classList.remove('ph')));
  }
  function onTick(step: number, bar: number) {
    if (cur.step >= 0) { heads[cur.step].classList.remove('now'); stepBtns.forEach((b) => b[cur.step].classList.remove('ph')); }
    cur.step = step; cur.bar = bar;
    heads[step].classList.add('now');
    stepBtns.forEach((b) => b[step].classList.add('ph'));
    if (step === 0) { bassN = 0; bassBoxes.forEach((b) => b.classList.remove('lit')); }
    updateLcd(step, bar);
  }

  // scope + VU
  let sw = 0, sh = 0;
  const td = new Float32Array(2048);
  let vu = -50;
  function sizeScope() {
    const r = scope.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    sw = r.width; sh = r.height;
    scope.width = Math.round(r.width * dpr); scope.height = Math.round(r.height * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScope(true);
  }
  function drawScope(force = false) {
    const c = sctx;
    const pad = 6;
    c.clearRect(0, 0, sw, sh);
    c.fillStyle = '#08100c';
    c.fillRect(pad, pad, sw - pad * 2, sh - pad * 2);
    c.strokeStyle = 'rgba(90,255,160,.08)';
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < 8; i++) { const x = pad + ((sw - pad * 2) * i) / 8; c.moveTo(x, pad); c.lineTo(x, sh - pad); }
    for (let i = 1; i < 4; i++) { const y = pad + ((sh - pad * 2) * i) / 4; c.moveTo(pad, y); c.lineTo(sw - pad, y); }
    c.stroke();
    c.strokeStyle = 'rgba(90,255,160,.18)';
    c.beginPath(); c.moveTo(pad, sh / 2); c.lineTo(sw - pad, sh / 2); c.stroke();
    let data: Float32Array | null = null;
    if (engine && playing && !reduce && !force) { engine.analyser.getFloatTimeDomainData(td); data = td; }
    const trace = (w: number, col: string) => {
      c.strokeStyle = col; c.lineWidth = w;
      c.beginPath();
      if (!data) { c.moveTo(pad, sh / 2); c.lineTo(sw - pad, sh / 2); }
      else {
        let s0 = 0;
        for (let i = 1; i < 1024; i++) if (data[i - 1] < 0 && data[i] >= 0) { s0 = i; break; }
        const n = 700;
        for (let i = 0; i < n; i++) {
          const x = pad + ((sw - pad * 2) * i) / (n - 1);
          const y = sh / 2 - data[s0 + i] * (sh * 0.42);
          i ? c.lineTo(x, y) : c.moveTo(x, y);
        }
      }
      c.stroke();
    };
    trace(4, 'rgba(90,255,160,.18)');
    trace(1.6, '#8dffbf');
    // glass glare
    const g = c.createLinearGradient(0, pad, 0, sh * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(pad, pad, sw - pad * 2, sh * 0.45);
    if (data) {
      let sum = 0;
      for (let i = 0; i < 1024; i++) sum += data[i] * data[i];
      const db = 20 * Math.log10(Math.sqrt(sum / 1024) + 1e-6);
      const target = Math.max(-50, Math.min(50, ((db + 26) / 23) * 100 - 50));
      vu += (target - vu) * (target > vu ? 0.35 : 0.12);
    } else vu += (-50 - vu) * 0.12;
    if (!reduce) needle.style.transform = `rotate(${vu.toFixed(1)}deg)`;
  }

  // ----------------------------------------------------------- loop
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (engine) {
      const now = engine.ctx.currentTime;
      const ticks = engine.ticks, hits = engine.hits;
      let lastTick: { step: number; bar: number } | null = null;
      while (ticks.length && ticks[0].time <= now) lastTick = ticks.shift()!;
      if (lastTick && playing) onTick(lastTick.step, lastTick.bar);
      while (hits.length && hits[0].time <= now) { const h = hits.shift()!; if (playing) onHit(h.ch, h.midi); }
      hits.sort((a, b) => a.time - b.time);
    }
    if (!reduce && (playing || vu > -49.5)) drawScope();
    if (lcdMsg && performance.now() > lcdMsg.until) updateLcd(cur.step, cur.bar);
  }
  function start() { if (!raf) raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  let wasPlaying = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { wasPlaying = playing; if (playing) { engine?.stop(); setPlaying(false); } stop(); }
    else { start(); if (wasPlaying) { engine?.start(); setPlaying(true); } }
  });

  measure();
  renderPatterns();
  updateLcd();
  sizeScope();
  const ro = new ResizeObserver(() => { measure(); sizeScope(); updateLcd(cur.step, cur.bar); });
  ro.observe(scope); ro.observe($('.lcd-glass'));
  document.fonts?.ready.then(() => { measure(); updateLcd(cur.step, cur.bar); });
  start();
  (window as any).__synth = { get engine() { return engine; }, get song() { return song; }, togglePlay, reroll };
}
