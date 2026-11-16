import { W, H, Screen, rng, clamp, smooth, BAY } from './core';
import { Music, envAt, BAR } from './music';
import { textMask } from './font';
import {
  Scroller, titlePart, plasmaPart, bobsPart, rotoPart, glenzPart, voxelPart, greetsPart, creditsPart,
  fontPal, medium, blit, type Ctx, type Part, type Item, type ScrollEntry, type Credit, type Link,
} from './parts';
import { email, now, projects, alsoWorkedOn, socials } from '../../../data/bio';

export type Els = {
  wrap: HTMLElement;
  scr: HTMLCanvasElement;
  bloom: HTMLCanvasElement;
  amb: HTMLCanvasElement;
  scan: HTMLCanvasElement;
  now: HTMLElement;
  nav: HTMLButtonElement[];
  sound: HTMLButtonElement;
  crt: HTMLButtonElement;
  isModal: () => boolean;
};

export function startCopper(els: Els, seed: number, reduced: boolean) {
  const R = rng(seed);

  /* ---------- content */
  const entries: ScrollEntry[] = [
    {
      text: "HELLO! BEN FIRSHMAN HERE, WELCOME TO COPPER. GRAB THIS SCROLLER, WIGGLE THE MOUSE...",
      item: { key: 'hello', pre: 'Ben Firshman', blurb: 'Copper, a demo in eight parts. Grab the scroller to scrub it.' },
    },
    {
      text: `RIGHT NOW I'M WORKING ON ${now.name.toUpperCase()}: ${now.blurb.toUpperCase()}.`,
      item: { key: 'now', pre: "I'm working on", label: now.name, url: now.url, blurb: now.blurb },
    },
    ...projects.map((p, i) => ({
      text: `${i === 0 ? "SOME OTHER STUFF I'VE DONE...     " : ''}${p.name.toUpperCase()}: ${p.blurb.toUpperCase()}.`,
      item: { key: p.slug, label: p.name, url: p.url, blurb: p.blurb } as Item,
    })),
    {
      text: "GREETINGS ARE IN PART 7 AND CONTACT DETAILS IN PART 8. LET'S WRAP!",
      item: { key: 'outro', pre: 'up next', blurb: 'greetings in part 7, contact details in part 8' },
    },
  ];
  const contact: Link[] = [{ label: email, url: `mailto:${email}` }, ...socials.map((s) => ({ label: s.name, url: s.url }))];
  const credits: Credit[] = [
    { text: "THAT'S ALL, FOLKS!", size: 'm', gap: 16 },
    { text: 'COPPER', size: 'm', gap: 4 },
    { text: 'A DEMO FOR BEN FIRSHMAN', gap: 30 },
    { text: '- SAY HELLO -', size: 'm', gap: 12 },
    { text: 'EMAIL', gap: 4 },
    { text: email.toUpperCase(), link: contact[0], gap: 14 },
    ...socials.flatMap((s, i): Credit[] => [
      { text: s.name.toUpperCase(), gap: 4 },
      { text: s.handle.toUpperCase(), link: contact[i + 1], gap: 14 },
    ]),
    { text: '', gap: 18 },
    { text: '- THE SMALL PRINT -', size: 'm', gap: 12 },
    { text: '320 X 256 PIXELS' },
    { text: '64 COLOURS, REWRITTEN EVERY SCANLINE' },
    { text: 'FOUR CHANNELS: SQUARE, SAW,' },
    { text: 'TRIANGLE AND NOISE' },
    { text: 'NO SAMPLES, NO IMAGES, NO FILES', gap: 14 },
    { text: 'EVERY VISIT GROWS A NEW LANDSCAPE', gap: 34 },
    { text: 'PRESS 1 TO WATCH AGAIN' },
    { text: 'OR JUST WAIT...' },
  ];

  const parts: Part[] = [
    titlePart(R),
    plasmaPart(R),
    bobsPart(R),
    rotoPart(R),
    glenzPart(R),
    voxelPart(R),
    greetsPart(R, alsoWorkedOn.map((a) => ({ label: a.name, url: a.url }))),
    creditsPart(R, credits, contact),
  ];
  const scroller = new Scroller(entries);
  const scrollBars = parts.filter((p) => p.scroller).reduce((a, p) => a + p.bars, 0);
  scroller.speed = clamp(scroller.length / (scrollBars * BAR), 70, 130) * (reduced ? 0.5 : 1);

  /* ---------- screen */
  const S = new Screen();
  const g = els.scr.getContext('2d', { alpha: false })!;
  const img = g.createImageData(W, H);
  const out = new Uint32Array(img.data.buffer);
  const bg = els.bloom.getContext('2d')!;
  const ag = els.amb.getContext('2d')!;
  let crt = true;

  function fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const aw = Math.max(200, window.innerWidth - 24);
    const ah = Math.max(160, window.innerHeight - (window.innerWidth < 560 ? 150 : 132));
    let k = Math.floor(Math.min((aw * dpr) / W, (ah * dpr) / H));
    let cw: number, ch: number;
    if (k >= 1) {
      cw = (k * W) / dpr;
      ch = (k * H) / dpr;
    } else {
      k = 1;
      const s = Math.min(aw / W, ah / H);
      cw = W * s;
      ch = H * s;
    }
    els.wrap.style.width = `${cw}px`;
    els.wrap.style.height = `${ch}px`;
    document.documentElement.style.setProperty('--sw', `${Math.max(cw, 300)}px`);
    // scanlines on whole device pixels, plus a faint vignette
    const sw = Math.round(cw * dpr), sh = Math.round(ch * dpr);
    els.scan.width = sw;
    els.scan.height = sh;
    const s = els.scan.getContext('2d')!;
    s.clearRect(0, 0, sw, sh);
    const lineH = Math.round(sh / H);
    if (lineH >= 2) {
      const dark = Math.max(1, Math.round(lineH * 0.34));
      s.fillStyle = lineH >= 3 ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.16)';
      for (let y = 0; y < H; y++) s.fillRect(0, y * lineH + lineH - dark, sw, dark);
    }
    const v = s.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.42, sw / 2, sh / 2, Math.hypot(sw, sh) * 0.56);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.38)');
    s.fillStyle = v;
    s.fillRect(0, 0, sw, sh);
  }
  fit();
  window.addEventListener('resize', fit);

  /* ---------- state */
  const music = new Music();
  let cur = 0, pt = 0, T = 0, trans = 0, first = true, paused = false;
  let mx = 0, my = 0, tx = 0, ty = 0, vx = 0, vy = 0, touched = false, touchedAt = 0, hintT = 0;
  const timeScale = reduced ? 0.45 : 1;
  const c: Ctx = { S, t: 0, T: 0, dt: 0, mx: 0, my: 0, vx: 0, vy: 0, kick: 0, snare: 0, hat: 0, lead: 0, bass: 0, arp: 0, reduced };

  function go(i: number, auto = false) {
    const n = parts.length;
    const prev = cur;
    cur = ((i % n) + n) % n;
    pt = 0;
    trans = 0;
    first = false;
    if (auto && cur === 0 && prev !== 0) scroller.reset();
    c.t = 0;
    parts[cur].enter?.(c);
    els.nav.forEach((b, k) => {
      b.classList.toggle('on', k === cur);
      if (k === cur) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
  }
  go(0);
  first = true;

  const interact = () => {
    if (!touched) {
      touched = true;
      touchedAt = hintT;
    }
  };

  /* ---------- input */
  const rect = () => els.wrap.getBoundingClientRect();
  window.addEventListener('pointermove', (e) => {
    const r = rect();
    tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
    ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.2, 1.2);
  }, { passive: true });

  let drag: { id: number; x: number; t: number; moved: number; v: number; last: number } | null = null;
  els.wrap.addEventListener('pointerdown', (e) => {
    interact();
    const r = rect();
    tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.2, 1.2);
    ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.2, 1.2);
    drag = { id: e.pointerId, x: e.clientX, t: performance.now(), moved: 0, v: 0, last: performance.now() };
    els.wrap.setPointerCapture(e.pointerId);
    if (parts[cur].scroller) scroller.held = true;
    els.wrap.classList.add('grab');
  });
  els.wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = rect();
    const dx = ((e.clientX - drag.x) * W) / r.width;
    drag.x = e.clientX;
    drag.moved += Math.abs(dx);
    const t = performance.now(), dt = Math.max(1, t - drag.last) / 1000;
    drag.last = t;
    drag.v += (dx / dt - drag.v) * 0.5;
    if (drag.moved < 3) return;
    const p = parts[cur];
    if (p.scroller) scroller.scrub(dx);
    else p.scrub?.(dx);
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tap = drag.moved < 6 && performance.now() - drag.t < 450;
    if (parts[cur].scroller) {
      scroller.held = false;
      if (!tap && performance.now() - drag.last < 90) scroller.vel = clamp(-drag.v, -1400, 1400);
    }
    drag = null;
    els.wrap.classList.remove('grab');
    if (tap && e.type === 'pointerup') go(cur + 1);
  };
  els.wrap.addEventListener('pointerup', end);
  els.wrap.addEventListener('pointercancel', end);

  function setPaused(p: boolean) {
    paused = p;
    music.pause(p);
    els.wrap.classList.toggle('paused', p);
  }
  async function setSound(on: boolean) {
    interact();
    els.sound.setAttribute('aria-pressed', String(on));
    if (on) await music.start(T);
    else music.stop();
    if (paused) music.pause(true);
  }
  els.sound.addEventListener('click', () => setSound(!music.on));
  els.crt.addEventListener('click', () => {
    crt = !crt;
    els.crt.setAttribute('aria-pressed', String(crt));
    els.wrap.parentElement!.classList.toggle('nocrt', !crt);
  });
  els.nav.forEach((b, i) => b.addEventListener('click', () => { interact(); go(i); }));

  window.addEventListener('keydown', (e) => {
    if (els.isModal() || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key >= '1' && e.key <= '8') { interact(); go(+e.key - 1); }
    else if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      interact();
      setPaused(!paused);
    } else if (e.key === 'ArrowRight') { interact(); go(cur + 1); }
    else if (e.key === 'ArrowLeft') { interact(); go(cur - 1); }
    else if (e.key === 'm' || e.key === 'M') setSound(!music.on);
  });

  /* ---------- the HTML mirror under the screen */
  let lastKey = '';
  function renderItem(it: Item | null) {
    const key = it ? it.key : '';
    if (key === lastKey) return;
    lastKey = key;
    const el = els.now;
    el.replaceChildren();
    if (!it) return;
    const add = (tag: string, cls: string, text: string, href?: string) => {
      const n = document.createElement(tag) as HTMLElement;
      if (cls) n.className = cls;
      n.textContent = text;
      if (href) (n as HTMLAnchorElement).href = href;
      el.append(n);
      return n;
    };
    if (it.pre) add('span', 'pre', it.pre);
    if (it.label) add(it.url ? 'a' : 'span', 'lbl', it.label, it.url);
    if (it.blurb) add('span', 'blurb', it.blurb);
    if (it.links)
      it.links.forEach((l) => {
        const a = add('a', 'lnk' + (l.on ? ' on' : ''), l.label, l.url);
        if (l.on) a.setAttribute('aria-current', 'true');
      });
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  /* ---------- overlays drawn into the framebuffer */
  const hintMask = textMask('MOVE   DRAG   TAP   1-8   SPACE').m;
  const pausedBm = medium('PAUSED');
  function drawHint(alpha: number) {
    if (alpha <= 0) return;
    const x0 = (W - hintMask.w) >> 1, y0 = 7, fb = S.fb;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < hintMask.w; x++)
        if (hintMask.d[y * hintMask.w + x] && BAY[(((y0 + y) & 3) << 2) | ((x0 + x) & 3)] < alpha) fb[(y0 + y) * W + x0 + x] = 47;
  }

  /* ---------- loop */
  let raf = 0, last = performance.now();
  function frame(nowMs: number) {
    raf = requestAnimationFrame(frame);
    const rdt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
    last = nowMs;
    const dt = paused ? 0 : rdt * timeScale;
    const prevT = T;
    T += dt;
    pt += dt;
    trans += rdt;
    hintT += rdt;

    const pmx = mx, pmy = my;
    const kk = 1 - Math.exp(-rdt * 6);
    mx += (tx - mx) * kk;
    my += (ty - my) * kk;
    const ivx = rdt > 0 ? (mx - pmx) / rdt : 0, ivy = rdt > 0 ? (my - pmy) / rdt : 0;
    vx += (ivx - vx) * (1 - Math.exp(-rdt * 10));
    vy += (ivy - vy) * (1 - Math.exp(-rdt * 10));

    music.update(T);
    const e = envAt(music.on ? T - music.delay : T);
    const pulse = music.on && !paused ? 1 : 0;
    Object.assign(c, {
      t: pt, T, dt, mx, my, vx, vy,
      kick: e.kick * pulse, snare: e.snare * pulse, hat: e.hat * pulse, lead: e.lead * pulse, bass: e.bass * pulse, arp: e.arp * pulse,
    });

    const p = parts[cur];
    const due = p.done ? p.done() : pt >= p.bars * BAR - 0.02;
    if (!paused && due && Math.floor(T / BAR) !== Math.floor(prevT / BAR)) {
      go(cur + 1, true);
    }
    const q = parts[cur];

    if (first) {
      S.bright = smooth(trans / 0.9);
      S.flash = 0;
    } else if (reduced) {
      S.bright = smooth(trans / 0.6);
      S.flash = 0;
    } else {
      S.bright = clamp(0.3 + trans * 3.5);
      S.flash = Math.max(0, 0.5 - trans * 2.2);
    }
    S.flash = Math.min(1, S.flash + c.kick * 0.05);

    S.committed = false;
    fontPal(S);
    S.pal(47, [136, 120, 128]);
    q.draw(c);
    if (!S.committed) S.commit();
    if (q.scroller) {
      scroller.update(dt, !paused);
      scroller.draw(c, q.scrollY ?? 206);
    }
    const ha = touched ? 1 - (hintT - touchedAt) / 0.8 : Math.min(1, (hintT - 1.6) / 0.8, (26 - hintT) / 2);
    drawHint(ha);
    if (paused && Math.floor(nowMs / 530) % 2 === 0) blit(S, pausedBm, (W - pausedBm.w) >> 1, 6);

    S.blit(out);
    g.putImageData(img, 0, 0);
    if (crt) {
      bg.drawImage(els.scr, 0, 0, els.bloom.width, els.bloom.height);
      ag.drawImage(els.scr, 0, 0, els.amb.width, els.amb.height);
    }
    renderItem(q.item ? q.item() : q.scroller ? scroller.current() : null);
  }
  raf = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      music.pause(true);
    } else {
      last = performance.now();
      music.pause(paused);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  });

}
