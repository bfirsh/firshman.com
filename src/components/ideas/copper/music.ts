// A four-channel tracker tune, synthesised with WebAudio.
// ch0 square lead · ch1 saw chord arps · ch2 triangle bass · ch3 noise drums.
// 125 BPM, speed 6: one row = 0.12s, one tick = 20ms (a PAL vblank).

export const BPM = 125;
export const ROW = 60 / BPM / 4;
export const TICK = ROW / 6;
export const BEAT = ROW * 4;
export const BAR = ROW * 16;

type Note = { n: number; len: number; v: number; arp?: number[] };
type Drum = { k: 'kick' | 'snare' | 'hat' | 'open'; v: number };
type Pat = { lead: (Note | null)[]; arp: (Note | null)[]; bass: (Note | null)[]; drum: (Drum | null)[] };

const CH: Record<string, { a: number; q: number[]; b: number }> = {
  F: { a: 65, q: [0, 4, 7], b: 41 },
  Dm: { a: 62, q: [0, 3, 7], b: 38 },
  Bb: { a: 70, q: [0, 4, 7], b: 46 },
  C: { a: 60, q: [0, 4, 7], b: 48 },
  Gm: { a: 67, q: [0, 3, 7], b: 43 },
  Am: { a: 69, q: [0, 3, 7], b: 45 },
};

// [row, midi, rows]
const LA = [[0,72,3],[3,69,3],[6,72,2],[8,77,6],[14,76,2],[16,74,3],[19,69,3],[22,74,2],[24,77,4],[28,76,2],[30,74,2],[32,74,3],[35,70,3],[38,74,2],[40,77,3],[43,79,3],[46,77,2],[48,76,6],[54,72,2],[56,74,2],[58,76,2],[60,79,4]];
const LA2 = [[0,81,6],[6,79,2],[8,77,3],[11,72,3],[14,77,2],[16,81,3],[19,79,3],[22,77,2],[24,76,3],[27,74,3],[30,76,2],[32,77,6],[38,74,2],[40,70,3],[43,74,3],[46,79,2],[48,76,4],[52,77,2],[54,79,10]];
const LB = [[0,74,4],[4,77,4],[8,82,6],[14,81,2],[16,79,6],[22,76,2],[24,72,4],[28,76,2],[30,79,2],[32,81,6],[38,76,2],[40,72,4],[44,76,4],[48,77,4],[52,76,4],[56,74,8]];
const LB2 = [[0,79,4],[4,77,2],[6,74,2],[8,70,6],[14,74,2],[16,72,4],[20,76,2],[22,81,2],[24,79,6],[30,76,2],[32,77,4],[36,74,4],[40,77,4],[44,79,4],[48,76,2],[50,77,2],[52,79,12]];

const BASS = [[0, 0, 2], [2, 0, 1], [3, 12, 1], [6, 12, 1], [8, 0, 2], [10, 0, 1], [11, 12, 1], [12, 7, 1], [14, 12, 1]];
const ARPR = [0, 3, 6, 8, 11, 14];

function pat(chords: string[], lead: number[][] | null, drums: 'intro' | 'full', fill: boolean, busy = false): Pat {
  const p: Pat = { lead: Array(64).fill(null), arp: Array(64).fill(null), bass: Array(64).fill(null), drum: Array(64).fill(null) };
  chords.forEach((name, b) => {
    const c = CH[name], o = b * 16;
    for (const [r, off, len] of BASS) p.bass[o + r] = { n: c.b + off, len, v: r % 8 === 0 ? 1 : 0.8 };
    const rows = busy ? [0, 2, 3, 6, 8, 10, 11, 14] : ARPR;
    for (const r of rows) p.arp[o + r] = { n: c.a, len: 2, v: r === 0 || r === 8 ? 1 : 0.75, arp: c.q };
    for (let r = 0; r < 16; r++) {
      let d: Drum | null = null;
      const intro = drums === 'intro';
      if (r % 4 === 2) d = { k: r === 14 && b % 2 ? 'open' : 'hat', v: 0.55 };
      else if (!intro && r % 2 === 0) d = { k: 'hat', v: 0.28 };
      if ((!intro || b >= 2) && (r === 0 || r === 8 || (r === 10 && b % 2 === 1))) d = { k: 'kick', v: 1 };
      if (!intro && (r === 4 || r === 12)) d = { k: 'snare', v: 0.9 };
      if (fill && b === 3 && r >= 12) d = { k: 'snare', v: 0.45 + (r - 12) * 0.17 };
      if (intro && b === 3 && r >= 13) d = { k: 'snare', v: 0.4 + (r - 13) * 0.2 };
      p.drum[o + r] = d;
    }
  });
  if (lead) for (const [r, n, len] of lead) p.lead[r] = { n, len, v: 1 };
  return p;
}

const P = {
  I: pat(['F', 'Dm', 'Bb', 'C'], null, 'intro', false),
  A: pat(['F', 'Dm', 'Bb', 'C'], LA, 'full', false),
  A2: pat(['F', 'Dm', 'Bb', 'C'], LA2, 'full', false),
  B: pat(['Bb', 'C', 'Am', 'Dm'], LB, 'full', false),
  B2: pat(['Gm', 'Am', 'Bb', 'C'], LB2, 'full', true),
  O: pat(['F', 'Dm', 'Bb', 'C'], null, 'full', true, true),
};
const ORDER: Pat[] = [P.I, P.A, P.A2, P.B, P.B2, P.A, P.A2, P.O];
export const SONG_ROWS = ORDER.length * 64;

const cell = (row: number) => {
  const r = ((row % SONG_ROWS) + SONG_ROWS) % SONG_ROWS;
  return { p: ORDER[r >> 6], r: r & 63 };
};

const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export type Env = { kick: number; snare: number; hat: number; lead: number; bass: number; arp: number; leadNote: number };

/** Envelope followers computed straight from the pattern data, so visuals sync with or without audio. */
export function envAt(T: number): Env {
  const row = Math.floor(T / ROW);
  const e: Env = { kick: 0, snare: 0, hat: 0, lead: 0, bass: 0, arp: 0, leadNote: 0 };
  let gotK = false, gotS = false, gotH = false, gotL = false, gotB = false, gotA = false;
  for (let k = 0; k < 24; k++) {
    const r = row - k;
    if (r < 0) break;
    const { p, r: i } = cell(r);
    const age = T - r * ROW;
    const d = p.drum[i];
    if (d) {
      if (!gotK && d.k === 'kick') { e.kick = Math.exp(-age * 7) * d.v; gotK = true; }
      if (!gotS && d.k === 'snare') { e.snare = Math.exp(-age * 6) * d.v; gotS = true; }
      if (!gotH && (d.k === 'hat' || d.k === 'open')) { e.hat = Math.exp(-age * 14) * d.v; gotH = true; }
    }
    const l = p.lead[i];
    if (!gotL && l) { e.lead = age < l.len * ROW ? Math.exp(-age * 1.5) : 0; e.leadNote = l.n; gotL = true; }
    if (!gotB && p.bass[i]) { e.bass = Math.exp(-age * 9); gotB = true; }
    if (!gotA && p.arp[i]) { e.arp = Math.exp(-age * 8); gotA = true; }
  }
  return e;
}

function pulseWave(ctx: AudioContext, duty: number) {
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = (2 * Math.sin(Math.PI * k * duty)) / (Math.PI * k);
  return ctx.createPeriodicWave(re, im);
}
// a 16-step triangle, like the one in an old console's sound chip
function steppedTri(ctx: AudioContext) {
  const N = 256, s = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / N, v = t < 0.5 ? t * 4 - 1 : 3 - t * 4;
    s[i] = Math.round(v * 7.5) / 7.5;
  }
  const n = 40, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < N; i++) {
      const ph = (2 * Math.PI * k * i) / N;
      a += s[i] * Math.cos(ph);
      b += s[i] * Math.sin(ph);
    }
    re[k] = (2 * a) / N;
    im[k] = (2 * b) / N;
  }
  return ctx.createPeriodicWave(re, im);
}

type Voice = { osc: OscillatorNode; g: GainNode };

export class Music {
  ctx: AudioContext | null = null;
  on = false;
  private next = 0;
  private off = 0;
  private bus!: GainNode;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private v: Voice[] = [];
  private drumOut!: GainNode;

  get delay() {
    if (!this.ctx) return 0;
    const c = this.ctx as AudioContext & { outputLatency?: number };
    return 0.04 + (c.outputLatency || c.baseLatency || 0);
  }

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.15;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000; // the "LED filter", mostly open
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(lp).connect(comp).connect(master).connect(ctx.destination);
    this.bus = bus;
    this.master = master;

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      nd[i] = (seed / 4294967296) * 2 - 1;
    }

    const pan = (p: number) => {
      const s = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (s) {
        s.pan.value = p;
        s.connect(bus);
        return s as AudioNode;
      }
      return bus as AudioNode;
    };
    const voice = (wave: PeriodicWave | OscillatorType, out: AudioNode): Voice => {
      const osc = ctx.createOscillator();
      if (typeof wave === 'string') osc.type = wave as OscillatorType;
      else osc.setPeriodicWave(wave);
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(out);
      osc.start();
      return { osc, g };
    };

    // lead: 25% pulse with a warm echo
    const leadOut = pan(-0.32);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = ROW * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const elp = ctx.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 2600;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    echo.connect(elp).connect(fb).connect(echo);
    elp.connect(wet).connect(pan(0.45));
    const lead = voice(pulseWave(ctx, 0.25), leadOut);
    lead.g.connect(echo);

    // arps: saw through a soft lowpass
    const alp = ctx.createBiquadFilter();
    alp.type = 'lowpass';
    alp.frequency.value = 2400;
    alp.Q.value = 2;
    alp.connect(pan(0.42));
    const arp = voice('sawtooth', alp);

    // bass: stepped triangle
    const bass = voice(steppedTri(ctx), pan(0.1));

    this.drumOut = ctx.createGain();
    this.drumOut.gain.value = 1;
    this.drumOut.connect(pan(-0.12));
    this.v = [lead, arp, bass];
  }

  async start(T: number) {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    this.on = true;
    this.off = ctx.currentTime - T;
    this.next = Math.ceil((T + 0.05) / ROW);
    const g = this.master.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0.68, ctx.currentTime, 0.05);
  }

  stop() {
    this.on = false;
    if (!this.ctx) return;
    const ctx = this.ctx, g = this.master.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => { if (!this.on) ctx.suspend().catch(() => {}); }, 300);
  }

  pause(p: boolean) {
    if (!this.ctx || !this.on) return;
    if (p) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  /** Schedule rows a little ahead of the demo clock T. */
  update(T: number) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const meas = now - T;
    if (Math.abs(meas - this.off) > 0.06) {
      this.off = meas;
      this.next = Math.max(this.next, Math.ceil((T + 0.02) / ROW));
    } else this.off += (meas - this.off) * 0.02;
    if (this.next * ROW < T - 0.2) this.next = Math.ceil(T / ROW);
    while (this.next * ROW < T + 0.16) {
      const at = this.next * ROW + this.off + 0.04;
      if (at > now) this.row(this.next, at);
      this.next++;
    }
  }

  private note(vi: number, n: Note, at: number, o: { peak: number; sus: number; tau: number; rel: number; vib?: boolean; blip?: boolean }) {
    const v = this.v[vi];
    const g = v.g.gain, f = v.osc.frequency;
    g.cancelScheduledValues(at);
    f.cancelScheduledValues(at);
    g.setTargetAtTime(o.peak * n.v, at, 0.002);
    g.setTargetAtTime(o.sus * n.v, at + 0.02, o.tau);
    const ticks = n.len * 6;
    for (let k = 0; k < ticks; k++) {
      let s = n.n + (n.arp ? n.arp[k % 3] : 0);
      if (o.blip && k === 0) s += 12;
      if (o.vib && k > 12) s += Math.sin((k - 12) * 0.7) * 0.16 * Math.min(1, (k - 12) / 12);
      f.setValueAtTime(mtof(s), at + k * TICK);
    }
    g.setTargetAtTime(0, at + n.len * ROW - 0.012, o.rel);
  }

  private drum(d: Drum, at: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    const flt = ctx.createBiquadFilter();
    src.connect(flt).connect(g).connect(this.drumOut);
    const off = Math.random() * 0.8;
    if (d.k === 'kick') {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(160, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.11);
      og.gain.setValueAtTime(0.0001, at);
      og.gain.linearRampToValueAtTime(0.95 * d.v, at + 0.003);
      og.gain.setTargetAtTime(0, at + 0.02, 0.07);
      o.connect(og).connect(this.drumOut);
      o.start(at);
      o.stop(at + 0.5);
      flt.type = 'lowpass';
      flt.frequency.value = 3000;
      g.gain.setValueAtTime(0.25 * d.v, at);
      g.gain.setTargetAtTime(0, at, 0.006);
      src.start(at, off, 0.05);
    } else if (d.k === 'snare') {
      flt.type = 'bandpass';
      flt.frequency.value = 2000;
      flt.Q.value = 0.7;
      g.gain.setValueAtTime(0.55 * d.v, at);
      g.gain.setTargetAtTime(0, at + 0.005, 0.055);
      src.start(at, off, 0.3);
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(230, at);
      o.frequency.exponentialRampToValueAtTime(150, at + 0.06);
      og.gain.setValueAtTime(0.3 * d.v, at);
      og.gain.setTargetAtTime(0, at, 0.035);
      o.connect(og).connect(this.drumOut);
      o.start(at);
      o.stop(at + 0.25);
    } else {
      flt.type = 'highpass';
      flt.frequency.value = 7200;
      g.gain.setValueAtTime(0.2 * d.v, at);
      g.gain.setTargetAtTime(0, at, d.k === 'open' ? 0.05 : 0.014);
      src.start(at, off, 0.25);
    }
  }

  private row(row: number, at: number) {
    const { p, r } = cell(row);
    const l = p.lead[r], a = p.arp[r], b = p.bass[r], d = p.drum[r];
    if (l) this.note(0, l, at, { peak: 0.2, sus: 0.13, tau: 0.3, rel: 0.05, vib: true, blip: false });
    if (a) this.note(1, a, at, { peak: 0.13, sus: 0.0, tau: 0.07, rel: 0.02 });
    if (b) this.note(2, b, at, { peak: 0.5, sus: 0.3, tau: 0.09, rel: 0.025 });
    if (d) this.drum(d, at);
  }
}
