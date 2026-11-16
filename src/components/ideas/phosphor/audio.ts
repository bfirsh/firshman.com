// Oscilloscope music: the left channel is X, the right channel is Y.
// An AudioWorklet runs the same oscillators as the screen at audio rate, so
// what you hear is the picture: consonant intervals when a figure closes,
// beating when it drifts, a buzzing timbre when the beam writes words.

const WORKLET = `
class Beam extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tabs = []; this.M = 1;
    this.t0 = 0; this.tx = 0; this.ty = 0; this.tm = 0;
    this.p = { a: 1, b: 1, ph: 0, m: 0, k: 0, st: -1, f: 110, g: 0 };
    this.s = Object.assign({}, this.p);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.tabs) { this.tabs = d.tabs; this.M = d.M; }
      else Object.assign(this.p, d);
    };
  }
  read(tab, t) {
    const M = this.M, f = (t - Math.floor(t)) * M;
    const i = Math.floor(f) % M, j = (i + 1) % M, u = f - Math.floor(f);
    return [tab[i*3] + (tab[j*3] - tab[i*3]) * u, tab[i*3+1] + (tab[j*3+1] - tab[i*3+1]) * u];
  }
  process(_in, outs) {
    const out = outs[0], L = out[0], R = out[1] || out[0];
    const n = L.length, s = this.s, p = this.p;
    const TAU = Math.PI * 2, dt = 1 / sampleRate;
    // glide every parameter towards its target over the block
    const k = 1 - Math.exp(-n / sampleRate / 0.03);
    const s0 = Object.assign({}, s);
    for (const key of ['a','b','ph','m','k','f','g']) s[key] += (p[key] - s[key]) * k;
    if (p.st !== s.st && s.k < 0.02) s.st = p.st;
    const tab = this.tabs[s.st];
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = s0.a + (s.a - s0.a) * u, b = s0.b + (s.b - s0.b) * u, m = s0.m + (s.m - s0.m) * u;
      const f = s0.f + (s.f - s0.f) * u, kk = s0.k + (s.k - s0.k) * u, ph = s0.ph + (s.ph - s0.ph) * u;
      const g = s0.g + (s.g - s0.g) * u;
      this.t0 += TAU * f * dt; this.tx += TAU * a * f * dt; this.ty += TAU * b * f * dt; this.tm += TAU * m * f * dt;
      if (this.t0 > 6283.185307) { this.t0 -= 6283.185307; }
      if (this.tx > 6283.185307) this.tx -= 6283.185307;
      if (this.ty > 6283.185307) this.ty -= 6283.185307;
      if (this.tm > 6283.185307) this.tm -= 6283.185307;
      const d = Math.min(1, m);
      const am = 1 - d + d * Math.cos(this.tm);
      let x = Math.sin(this.tx + ph) * am * 0.7, y = Math.sin(this.ty) * am * 0.7;
      if (tab && kk > 0.001) {
        const q = this.read(tab, this.t0 / TAU);
        x += (q[0] - x) * kk; y += (q[1] - y) * kk;
      }
      L[i] = x * g; R[i] = y * g;
    }
    return true;
  }
}
registerProcessor('phosphor-beam', Beam);
`;

export type AudioParams = { a: number; b: number; ph: number; m: number; k: number; st: number; f: number };

export class BeamAudio {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  master: GainNode | null = null;
  on = false;
  private ready: Promise<void> | null = null;
  private tabs: Float32Array[];
  private M: number;

  constructor(tabs: Float32Array[], M: number) {
    this.tabs = tabs;
    this.M = M;
  }

  static supported() {
    return typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
  }

  private async init() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'phosphor-beam', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.postMessage({ tabs: this.tabs, M: this.M });
    // keep it kind to ears and speakers: no DC, no fizz, gentle level
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 24;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
    const master = ctx.createGain(); master.gain.value = 0.0;
    node.connect(hp).connect(lp).connect(master).connect(ctx.destination);
    this.node = node;
    this.master = master;
  }

  async toggle(on: boolean) {
    this.on = on;
    if (on) {
      if (!this.ready) this.ready = this.init();
      await this.ready;
      await this.ctx!.resume();
      this.node!.port.postMessage({ g: 1 });
      this.master!.gain.setTargetAtTime(0.32, this.ctx!.currentTime, 0.15);
    } else if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const ctx = this.ctx;
      setTimeout(() => { if (!this.on) ctx.suspend(); }, 400);
    }
  }

  set(p: AudioParams) {
    if (this.on && this.node) this.node.port.postMessage(p);
  }

  /** A soft mechanical tick, for detents and the lock relay. */
  tick(strength = 1, pitch = 1) {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.08));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 * pitch; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.value = 0.5 * strength;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  }

  suspend(hidden: boolean) {
    if (!this.ctx || !this.on) return;
    if (hidden) this.ctx.suspend(); else this.ctx.resume();
  }
}
