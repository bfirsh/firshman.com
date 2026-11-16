// Synthesised sound: sea wash, rain hiss, sculpting rumble, splashes and bells. Off until asked.

const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  seaG!: GainNode;
  rainG!: GainNode;
  digG!: GainNode;
  digF!: BiquadFilterNode;
  rumble!: OscillatorNode;
  rumbleG!: GainNode;
  noise!: AudioBuffer;
  on = false;
  lastSplash = 0;

  start() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
      const loop = (f: BiquadFilterNode) => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.connect(f); s.start(); };
      // sea: lowpassed noise breathing slowly
      const seaF = ctx.createBiquadFilter(); seaF.type = 'lowpass'; seaF.frequency.value = 420; seaF.Q.value = 0.4;
      this.seaG = ctx.createGain(); this.seaG.gain.value = 0.16;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
      const lfoG = ctx.createGain(); lfoG.gain.value = 0.08;
      lfo.connect(lfoG).connect(this.seaG.gain); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
      const lfo2G = ctx.createGain(); lfo2G.gain.value = 160;
      lfo2.connect(lfo2G).connect(seaF.frequency); lfo2.start();
      loop(seaF); seaF.connect(this.seaG).connect(this.master);
      // rain
      const rainF = ctx.createBiquadFilter(); rainF.type = 'bandpass'; rainF.frequency.value = 3200; rainF.Q.value = 0.5;
      this.rainG = ctx.createGain(); this.rainG.gain.value = 0;
      loop(rainF); rainF.connect(this.rainG).connect(this.master);
      // sculpt: earthy filtered noise + low sine
      this.digF = ctx.createBiquadFilter(); this.digF.type = 'lowpass'; this.digF.frequency.value = 300; this.digF.Q.value = 2.5;
      this.digG = ctx.createGain(); this.digG.gain.value = 0;
      loop(this.digF); this.digF.connect(this.digG).connect(this.master);
      this.rumble = ctx.createOscillator(); this.rumble.type = 'triangle'; this.rumble.frequency.value = 55;
      this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0;
      this.rumble.connect(this.rumbleG).connect(this.master); this.rumble.start();
    }
    this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
  }
  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  // per frame
  update(dig: number, height: number, rain: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const a = Math.min(1, Math.abs(dig));
    this.digG.gain.setTargetAtTime(a * 0.32, t, 0.06);
    this.digF.frequency.setTargetAtTime(dig >= 0 ? 180 + height * 60 : 520 - height * 25, t, 0.08);
    this.rumbleG.gain.setTargetAtTime(a * 0.1, t, 0.08);
    this.rumble.frequency.setTargetAtTime(dig >= 0 ? 48 + height * 5 : 70 - height * 2, t, 0.1);
    this.rainG.gain.setTargetAtTime(Math.min(0.12, rain * 0.05), t, 0.4);
  }

  splash(strength: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    if (t - this.lastSplash < 0.09) return;
    this.lastSplash = t;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 900; f.Q.value = 1.2;
    f.frequency.setTargetAtTime(300, t, 0.15);
    const g = this.ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(Math.min(0.5, 0.15 + strength * 0.1), t, 0.005);
    g.gain.setTargetAtTime(0, t + 0.04, 0.12);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.8);
  }

  bell(i: number, soft = false) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const base = 392 * Math.pow(2, PENT[i % PENT.length] / 12);
    for (const [mul, amp, dec] of [[1, 0.2, 1.6], [2.76, 0.07, 0.7], [5.4, 0.035, 0.35], [0.5, 0.05, 1.2]] as const) {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = base * mul;
      const g = this.ctx.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(amp * (soft ? 0.5 : 1), t, 0.004);
      g.gain.setTargetAtTime(0, t + 0.02, dec * 0.45);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dec * 3);
    }
  }

  horn() {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    for (const f of [98, 147]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      const g = this.ctx.createGain(); g.gain.value = 0;
      g.gain.setTargetAtTime(0.06, t, 0.15); g.gain.setTargetAtTime(0, t + 1.1, 0.35);
      o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + 3);
    }
  }

  fanfare() {
    if (!this.ctx || !this.on) return;
    [0, 2, 4, 5, 7].forEach((n, k) => setTimeout(() => this.bell(n), k * 180));
  }
}
