// Synthesised sound for the dig: scraping, grain ticks, bells for finds. Off until asked.

export class DigAudio {
  ctx: AudioContext | null = null;
  on = false;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private verbIn!: GainNode;
  private scrapeG!: GainNode;
  private scrapeF!: BiquadFilterNode;
  private rumbleG!: GainNode;
  private noise!: AudioBuffer;
  private lastTick = 0;
  private ticks = 0;
  private scrapeTarget = 0;

  enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return false;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);
      // generated room
      const len = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      this.verb = ctx.createConvolver(); this.verb.buffer = ir;
      this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.45;
      this.verbIn.connect(this.verb).connect(this.master);
      // noise source
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < nd.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; nd[i] = w * 0.6 + b * 2.2; }
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      this.scrapeF = ctx.createBiquadFilter(); this.scrapeF.type = 'bandpass'; this.scrapeF.frequency.value = 1600; this.scrapeF.Q.value = 0.7;
      this.scrapeG = ctx.createGain(); this.scrapeG.gain.value = 0;
      src.connect(this.scrapeF).connect(this.scrapeG).connect(this.master);
      // a low room tone, barely there
      const src2 = ctx.createBufferSource(); src2.buffer = this.noise; src2.loop = true; src2.playbackRate.value = 0.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0.035;
      src2.connect(lp).connect(this.rumbleG).connect(this.master);
      src.start(); src2.start();
    }
    this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.2);
    return true;
  }

  disable() {
    this.on = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  // amount: voxels removed this frame; speed: brush speed 0..1
  scrape(amount: number, speed: number) {
    this.scrapeTarget = Math.min(0.5, amount * 0.02 + (amount ? 0.05 : 0)) * (0.6 + speed * 0.6);
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrapeG.gain.setTargetAtTime(this.scrapeTarget, t, amount ? 0.03 : 0.09);
    this.scrapeF.frequency.setTargetAtTime(1100 + speed * 2200 + Math.random() * 300, t, 0.05);
    if (amount > 0 && Math.random() < Math.min(0.8, amount * 0.08)) this.tick(0.3 + Math.random() * 0.4, 0.4);
  }

  // a grain hitting stone
  tick(v: number, pitch = Math.random()) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastTick > 0.05) { this.lastTick = t; this.ticks = 0; }
    if (++this.ticks > 3) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + pitch * 5000; f.Q.value = 6;
    const g = ctx.createGain();
    const a = Math.min(0.35, 0.06 + v * 0.25);
    g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.035 + Math.random() * 0.03);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.08);
  }

  private bell(freq: number, t: number, gain: number, dur = 3.2) {
    const ctx = this.ctx!;
    const partials = [[1, 1], [2.01, 0.42], [2.76, 0.3], [4.07, 0.16], [5.43, 0.09]];
    for (const [r, a] of partials) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * r;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * a, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (0.6 + r * 0.4));
      o.connect(g); g.connect(this.master); g.connect(this.verbIn);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  // a find: a soft bell, rising with each one found
  found(order: number, geode: boolean) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
    const base = 220 * Math.pow(2, scale[order % scale.length] / 12);
    this.bell(base, t, 0.16);
    this.bell(base * 1.5, t + 0.12, 0.08);
    if (geode) for (let i = 0; i < 7; i++) this.bell(base * 4 * Math.pow(2, [0, 4, 7, 12, 16, 19, 24][i] / 12), t + 0.2 + i * 0.07, 0.025, 1.4);
  }

  // close to something buried: a faint glassy shimmer
  near(strength: number) {
    if (!this.on || !this.ctx || Math.random() > strength * 0.12) return;
    const t = this.ctx.currentTime;
    this.bell(1760 * Math.pow(2, Math.floor(Math.random() * 5) * 2 / 12), t, 0.012 * strength, 0.9);
  }

  finale() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.rumbleG.gain.setTargetAtTime(0.4, t, 1.2);
    this.rumbleG.gain.setTargetAtTime(0.035, t + 6, 1.5);
    [110, 164.8, 220, 277.2, 329.6, 440].forEach((f, i) => this.bell(f, t + 6.2 + i * 0.18, 0.09, 6));
  }
}
