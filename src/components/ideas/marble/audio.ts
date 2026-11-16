// Tiny WebAudio kit: glassy clicks, a soft roll, bell chimes, stone rumbles. Off until enabled.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private wet!: GainNode;
  on = false;
  private lastClick = 0;

  enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return false;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      // simple feedback-delay "room" for chimes
      const d1 = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
      d1.delayTime.value = 0.23; fb.gain.value = 0.38; lp.type = 'lowpass'; lp.frequency.value = 2600;
      this.wet = ctx.createGain(); this.wet.gain.value = 0.5;
      this.wet.connect(d1); d1.connect(lp).connect(fb).connect(d1); lp.connect(this.master);
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      this.rollFilter = ctx.createBiquadFilter();
      this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 300; this.rollFilter.Q.value = 0.7;
      this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
      src.connect(this.rollFilter).connect(this.rollGain).connect(this.master);
      src.start();
    }
    this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.05);
    return true;
  }
  disable() {
    this.on = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
  roll(speed: number, grounded: boolean) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const s = grounded ? Math.min(1, speed / 6) : 0;
    this.rollGain.gain.setTargetAtTime(s * s * 0.11 + s * 0.02, t, 0.06);
    this.rollFilter.frequency.setTargetAtTime(180 + s * 900, t, 0.08);
  }
  click(intensity: number) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastClick < 0.035) return;
    this.lastClick = t;
    const amp = Math.min(1, intensity) * 0.32;
    // glassy tick: two short partials + a breath of noise
    for (const [f, a, dec] of [[2900 + Math.random() * 600, 1, 0.05], [5200 + Math.random() * 900, 0.45, 0.025], [1400, 0.35, 0.03]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(amp * a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dec + 0.02);
    }
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noiseBuf; bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 1.5;
    g.gain.setValueAtTime(amp * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.connect(bp).connect(g).connect(this.master); n.start(t, Math.random()); n.stop(t + 0.03);
  }
  chime(step: number, vol = 1, when = 0) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const semis = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length] + 12 * Math.floor(step / PENTA.length);
    const f0 = 523.25 * Math.pow(2, semis / 12);
    for (const [r, a, dec] of [[1, 0.22, 2.6], [2.76, 0.07, 1.2], [5.4, 0.035, 0.6], [0.5, 0.05, 2.0]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f0 * r;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a * vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(this.master); g.connect(this.wet);
      o.start(t); o.stop(t + dec + 0.05);
    }
  }
  rumble(dur = 1.2) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noiseBuf; lp.type = 'lowpass'; lp.frequency.value = 220;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.15); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(lp).connect(g).connect(this.master); n.start(t); n.stop(t + dur + 0.1);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(48, t + dur);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.12, t + 0.2); og.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + dur + 0.1);
  }
  fanfare() {
    if (!this.ctx || !this.on) return;
    const seq = [0, 2, 4, 5, 7, 9, 7, 10];
    seq.forEach((s, i) => this.chime(s, 0.8, i * 0.21 + (i > 5 ? 0.25 : 0)));
    this.chime(-5, 0.6, 1.9); this.chime(0, 0.5, 1.9);
  }
}
