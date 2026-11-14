// WebAudio engine. Everything is synthesised at runtime: no samples.
import type { Voice } from './channels';
import { midiOf, rng, type Song } from './song';

export type Hit = { time: number; ch: number; midi?: number };
export type Tick = { time: number; step: number; bar: number };

const SENDS: Record<Voice, [number, number]> = {
  ai: [0.35, 0.5], square: [0.18, 0.3], pluck: [0.3, 0.22], pad: [0.6, 0.12], whale: [0.95, 0.35],
  bass: [0.04, 0], hat: [0.08, 0.06], type: [0.14, 0.12], paper: [0.3, 0], kick: [0.05, 0],
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Engine {
  ctx: AudioContext;
  analyser: AnalyserNode;
  private master: GainNode;
  private bus: GainNode;
  private chLevel: GainNode[] = [];
  private chGate: GainNode[] = [];
  private chR: GainNode[] = [];
  private chD: GainNode[] = [];
  private perform: GainNode;
  private delay: DelayNode;
  private noise: AudioBuffer;
  private pulse: PeriodicWave;
  private ks = new Map<number, AudioBuffer>();
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private aiRng = rng(1);
  private aiDeg = 9;
  private arp = 0;
  private pan = 1;
  playing = false;
  hits: Hit[] = [];
  ticks: Tick[] = [];
  space = 0.4;

  constructor(
    private voices: Voice[],
    public getSong: () => Song,
    public getBpm: () => number,
  ) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.bus = ctx.createGain();
    this.bus.connect(comp); comp.connect(this.master); this.master.connect(this.analyser); this.analyser.connect(ctx.destination);

    // reverb from a synthesised impulse
    const rev = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - i / len, 3.2);
      }
    }
    rev.buffer = ir;
    const revIn = ctx.createGain(); revIn.gain.value = 0.9;
    revIn.connect(rev); rev.connect(this.bus);
    // dotted-eighth delay
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2800;
    const delIn = ctx.createGain(); delIn.gain.value = 0.6;
    delIn.connect(this.delay); this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay); dlp.connect(this.bus);
    dlp.connect(revIn);

    voices.forEach((v, i) => {
      const lvl = ctx.createGain(); lvl.gain.value = 0.8;
      const gate = ctx.createGain();
      const r = ctx.createGain(); const d = ctx.createGain();
      lvl.connect(gate); gate.connect(this.bus); gate.connect(r); gate.connect(d);
      r.connect(revIn); d.connect(delIn);
      this.chLevel[i] = lvl; this.chGate[i] = gate; this.chR[i] = r; this.chD[i] = d;
    });
    this.perform = ctx.createGain(); this.perform.gain.value = 0.9;
    const pr = ctx.createGain(); pr.gain.value = 0.25;
    const pd = ctx.createGain(); pd.gain.value = 0.3;
    this.perform.connect(this.bus); this.perform.connect(pr); pr.connect(revIn); this.perform.connect(pd); pd.connect(delIn);
    this.setSpace(this.space);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const n = 32, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    this.pulse = ctx.createPeriodicWave(re, im);
    this.updateDelay();
  }

  // ------------------------------------------------ mixer
  setLevel(i: number, v: number) { this.chLevel[i].gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  setGates(open: boolean[]) { open.forEach((o, i) => this.chGate[i].gain.setTargetAtTime(o ? 1 : 0, this.ctx.currentTime, 0.015)); }
  setVolume(v: number) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setSpace(v: number) {
    this.space = v;
    this.voices.forEach((voice, i) => {
      const [r, d] = SENDS[voice];
      this.chR[i].gain.setTargetAtTime(r * v * 1.6, this.ctx.currentTime, 0.05);
      this.chD[i].gain.setTargetAtTime(d * v * 1.6, this.ctx.currentTime, 0.05);
    });
  }
  updateDelay() { this.delay.delayTime.setTargetAtTime((60 / this.getBpm()) * 0.75, this.ctx.currentTime, 0.1); }

  // ------------------------------------------------ transport
  start() {
    if (this.playing) return;
    this.playing = true;
    this.step = 0; this.bar = 0;
    this.aiRng = rng(this.getSong().seed ^ 0x9e3779b9);
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.hits.length = 0; this.ticks.length = 0;
  }
  reseedAi() { this.aiRng = rng(this.getSong().seed ^ 0x9e3779b9); this.aiDeg = 9; }

  private schedule() {
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextTime < ahead) {
      this.playStep(this.step, this.bar, this.nextTime);
      const sd = 60 / this.getBpm() / 4;
      const swing = this.step % 2 === 0 ? sd * 0.08 : -sd * 0.08;
      this.nextTime += sd + swing;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % 4;
    }
  }

  private playStep(s: number, bar: number, t: number) {
    const song = this.getSong();
    const sd = 60 / this.getBpm() / 4;
    const deg = song.prog[bar];
    this.ticks.push({ time: t, step: s, bar });
    const len = (ch: number, max: number) => {
      const p = song.patterns[ch];
      let n = 1;
      while (n < max && !p[(s + n) % 16]) n++;
      return n * sd;
    };
    this.voices.forEach((v, ch) => {
      if (!song.patterns[ch][s]) return;
      let midi: number | undefined;
      switch (v) {
        case 'kick': this.kick(t, ch, s === 0 ? 1 : 0.85); break;
        case 'hat': this.hat(t, ch, s); break;
        case 'type': this.type(t, ch, 0.7 + Math.random() * 0.3); break;
        case 'paper': this.paper(t, ch, s % 8 === 4 ? 1 : 0.6); break;
        case 'bass': {
          const r = (s * 7 + bar) % 5;
          const d = s === 0 ? deg : r === 0 ? deg + 4 : r === 1 ? deg + 7 : deg;
          midi = midiOf(song, d, 36);
          this.bass(t, ch, midi, len(ch, 4) * 0.92);
          break;
        }
        case 'pluck': {
          const shape = [0, 2, 4, 7, 9, 7, 4, 2];
          if (s === 0) this.arp = 0;
          midi = midiOf(song, deg + shape[this.arp++ % shape.length], 48);
          this.pluck(t, ch, midi, 0.8);
          break;
        }
        case 'square':
          midi = midiOf(song, deg + song.hook[s], 60);
          this.square(t, midi, len(ch, 3) * 0.85, 0.85, this.chLevel[ch]);
          break;
        case 'pad': {
          const tones = [deg, deg + 2, deg + 4, deg + 7].map((d) => midiOf(song, d, 48));
          midi = tones[0];
          this.pad(t, ch, tones, Math.max(len(ch, 16), sd * 4));
          break;
        }
        case 'whale':
          if (bar % 2 !== 0) return;
          midi = midiOf(song, deg + 4, 48);
          this.whale(t, ch, midi, sd * 16 * 1.4);
          break;
        case 'ai': {
          const r = this.aiRng();
          const moves = [-2, -1, -1, 0, 1, 1, 2, 3, -3, 4];
          this.aiDeg += moves[Math.floor(r * moves.length)];
          if (s % 4 === 0) {
            // land on a chord tone on the beat
            const rel = this.aiDeg - deg;
            const near = [0, 2, 4, 7, 9, 11, 14].reduce((a, b) => (Math.abs(b - rel) < Math.abs(a - rel) ? b : a));
            this.aiDeg = deg + near;
          }
          if (this.aiDeg < 3) this.aiDeg += 4;
          if (this.aiDeg > 15) this.aiDeg -= 5;
          midi = midiOf(song, this.aiDeg, 60);
          this.ai(t, ch, midi, len(ch, 4), 0.75 + this.aiRng() * 0.25);
          break;
        }
      }
      this.hits.push({ time: t, ch, midi });
    });
    // the carriage return
    const clig = this.voices.indexOf('type');
    if (clig >= 0 && s === 15 && bar === 3) { this.ding(t + sd * 0.5, clig); this.hits.push({ time: t + sd * 0.5, ch: clig, midi: -1 }); }
  }

  // ------------------------------------------------ helpers
  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private noiseSrc(t: number, dur: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }
  private out(ch: number) { return ch < 0 ? this.perform : this.chLevel[ch]; }

  // ------------------------------------------------ voices
  kick(t: number, ch: number, vel: number) {
    const c = this.ctx;
    const o = c.createOscillator(); const g = c.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    this.env(g, t, 1.0 * vel, 0.003, 0.42);
    o.connect(g); g.connect(this.out(ch));
    o.start(t); o.stop(t + 0.5);
    const n = this.noiseSrc(t, 0.02); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const ng = c.createGain(); this.env(ng, t, 0.25 * vel, 0.001, 0.012);
    n.connect(hp); hp.connect(ng); ng.connect(this.out(ch));
  }

  hat(t: number, ch: number, s: number) {
    // clockwork: a metallic tick, a slightly lower tock
    const c = this.ctx;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 9500; bp.Q.value = 0.8;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = c.createGain();
    const vel = s % 4 === 2 ? 0.5 : 0.32;
    this.env(g, t, vel, 0.001, s % 4 === 2 ? 0.07 : 0.035);
    bp.connect(hp); hp.connect(g); g.connect(this.out(ch));
    for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 40 * r * (s % 2 ? 0.94 : 1);
      o.connect(bp); o.start(t); o.stop(t + 0.1);
    }
    const tk = c.createOscillator(); tk.frequency.value = s % 2 ? 1900 : 2600;
    const tg = c.createGain(); this.env(tg, t, 0.12, 0.0005, 0.012);
    tk.connect(tg); tg.connect(this.out(ch)); tk.start(t); tk.stop(t + 0.03);
  }

  type(t: number, ch: number, vel: number) {
    const c = this.ctx;
    const n = this.noiseSrc(t, 0.04);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600 + Math.random() * 1400; bp.Q.value = 2.2;
    const g = c.createGain(); this.env(g, t, 0.75 * vel, 0.0008, 0.028);
    n.connect(bp); bp.connect(g); g.connect(this.out(ch));
    const o = c.createOscillator(); o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.03);
    const og = c.createGain(); this.env(og, t, 0.35 * vel, 0.001, 0.035);
    o.connect(og); og.connect(this.out(ch)); o.start(t); o.stop(t + 0.06);
  }
  ding(t: number, ch: number) {
    const c = this.ctx;
    for (const [f, a] of [[2637, 0.13], [5274, 0.04], [7910, 0.015]]) {
      const o = c.createOscillator(); o.frequency.value = f;
      const g = c.createGain(); this.env(g, t, a, 0.002, 1.3);
      o.connect(g); g.connect(this.out(ch)); o.start(t); o.stop(t + 1.4);
    }
  }

  paper(t: number, ch: number, vel: number) {
    const c = this.ctx;
    const dur = 0.16 + Math.random() * 0.08;
    const n = this.noiseSrc(t, dur);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200 + Math.random() * 1500; bp.Q.value = 0.7;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    // crinkle: a scatter of tiny bursts
    for (let k = 0; k < 14; k++) {
      const tt = t + (k / 14) * dur;
      g.gain.setValueAtTime(vel * 0.32 * Math.random() * (1 - k / 16), tt);
    }
    g.gain.setValueAtTime(0, t + dur);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.out(ch));
  }

  bass(t: number, ch: number, midi: number, dur: number) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f; o2.detune.value = -7;
    const sub = c.createOscillator(); sub.frequency.value = f / 2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7;
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.012);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.28);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.006);
    g.gain.setTargetAtTime(0.22, t + 0.02, 0.1);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
    const sg = c.createGain(); sg.gain.value = 0.6;
    o1.connect(lp); o2.connect(lp); sub.connect(sg); sg.connect(lp); lp.connect(g); g.connect(this.out(ch));
    for (const o of [o1, o2, sub]) { o.start(t); o.stop(t + dur + 0.3); }
  }

  private ksBuffer(midi: number) {
    let b = this.ks.get(midi);
    if (b) return b;
    const sr = this.ctx.sampleRate;
    const f = mtof(midi);
    const N = Math.max(2, Math.round(sr / f));
    const len = Math.floor(sr * 1.8);
    b = this.ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.5 + w * 0.5; d[i] = prev; }
    const decay = 0.4985 - Math.max(0, midi - 60) * 0.0002;
    for (let i = N; i < len; i++) d[i] = decay * (d[i - N] + d[i - N - 1 < 0 ? 0 : i - N - 1]);
    this.ks.set(midi, b);
    return b;
  }
  pluck(t: number, ch: number, midi: number, vel: number) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.ksBuffer(midi);
    const g = c.createGain(); g.gain.value = 0.55 * vel;
    const p = c.createStereoPanner(); this.pan = -this.pan; p.pan.value = this.pan * 0.35;
    s.connect(g); g.connect(p); p.connect(this.out(ch));
    s.start(t); s.stop(t + 1.8);
  }

  square(t: number, midi: number, dur: number, vel: number, dest: AudioNode) {
    const c = this.ctx;
    const o = c.createOscillator(); o.setPeriodicWave(this.pulse); o.frequency.value = mtof(midi);
    const lfo = c.createOscillator(); lfo.frequency.value = 6;
    const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(14, t + 0.35);
    lfo.connect(lg); lg.connect(o.detune);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.1 * vel, t + 0.01, 0.06);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.025);
    o.connect(g); g.connect(dest);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  }

  pad(t: number, ch: number, tones: number[], dur: number) {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + Math.min(0.9, dur * 0.4));
    g.gain.setValueAtTime(0.09, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
    lp.connect(g); g.connect(this.out(ch));
    for (const m of tones) for (const det of [-9, 9]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.setValueAtTime(det, t);
      // and the whole thing slowly climbs
      o.detune.linearRampToValueAtTime(det + 14, t + dur);
      o.connect(lp); o.start(t); o.stop(t + dur + 1.5);
    }
  }

  whale(t: number, ch: number, midi: number, dur: number) {
    const c = this.ctx;
    const f = mtof(midi);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.75, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur * 0.32);
    o.frequency.exponentialRampToValueAtTime(f * 0.9, t + dur * 0.7);
    o.frequency.exponentialRampToValueAtTime(f * 1.12, t + dur);
    const o2 = c.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(f * 1.5, t);
    o2.frequency.exponentialRampToValueAtTime(f * 2.25, t + dur * 0.32);
    o2.frequency.exponentialRampToValueAtTime(f * 1.35, t + dur * 0.7);
    o2.frequency.exponentialRampToValueAtTime(f * 1.68, t + dur);
    const lfo = c.createOscillator(); lfo.frequency.value = 4.5;
    const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(22, t + dur);
    lfo.connect(lg); lg.connect(o.detune); lg.connect(o2.detune);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.5);
    g.gain.setValueAtTime(0.28, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(g); g.connect(this.out(ch));
    for (const x of [o, o2, lfo]) { x.start(t); x.stop(t + dur + 0.1); }
  }

  ai(t: number, ch: number, midi: number, dur: number, vel: number) {
    // a little FM bell, thinking out loud
    const c = this.ctx;
    const f = mtof(midi);
    const car = c.createOscillator(); car.frequency.value = f;
    const mod = c.createOscillator(); mod.frequency.value = f * 2;
    const mg = c.createGain();
    mg.gain.setValueAtTime(f * 2.4, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.3, t + 0.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain();
    const d = Math.max(0.5, dur * 1.6);
    this.env(g, t, 0.2 * vel, 0.004, d);
    car.connect(g); g.connect(this.out(ch));
    car.start(t); mod.start(t); car.stop(t + d + 0.1); mod.stop(t + d + 0.1);
  }

  // ------------------------------------------------ the keyboard
  playKey(i: number) {
    const song = this.getSong();
    const midi = midiOf(song, i, 60);
    this.square(this.ctx.currentTime + 0.005, midi, 0.32, 1, this.perform);
    return midi;
  }
  preview(ch: number, s: number) {
    const song = this.getSong();
    const v = this.voices[ch];
    const t = this.ctx.currentTime + 0.01;
    const deg = song.prog[0];
    switch (v) {
      case 'kick': this.kick(t, ch, 1); break;
      case 'hat': this.hat(t, ch, s); break;
      case 'type': this.type(t, ch, 1); break;
      case 'paper': this.paper(t, ch, 1); break;
      case 'bass': this.bass(t, ch, midiOf(song, deg, 36), 0.3); break;
      case 'pluck': this.pluck(t, ch, midiOf(song, deg + 4, 48), 0.8); break;
      case 'square': this.square(t, midiOf(song, deg + song.hook[s], 60), 0.25, 1, this.chLevel[ch]); break;
      case 'pad': this.pad(t, ch, [deg, deg + 2, deg + 4].map((d) => midiOf(song, d, 48)), 0.8); break;
      case 'whale': this.whale(t, ch, midiOf(song, deg + 4, 48), 2.4); break;
      case 'ai': this.ai(t, ch, midiOf(song, 9, 60), 0.4, 0.9); break;
    }
  }
}
