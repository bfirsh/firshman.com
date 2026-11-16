// A small night, synthesised: wind through grass, crickets, and soft bells as fireflies settle.
export class NightAudio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  windGain!: GainNode;
  windFilter!: BiquadFilterNode;
  padGain!: GainNode;
  on = false;
  private cricketTimer = 0;
  private lastTing = 0;
  private verb!: ConvolverNode;

  start() {
    if (!this.ctx) this.build();
    const c = this.ctx!;
    c.resume();
    this.on = true;
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setTargetAtTime(0.8, c.currentTime, 0.4);
    clearInterval(this.cricketTimer);
    this.cricketTimer = window.setInterval(() => this.crickets(), 420);
  }
  stop() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    clearInterval(this.cricketTimer);
  }

  private build() {
    const c = (this.ctx = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    // a cheap reverb from decaying noise
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.8;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.verb.connect(wet).connect(this.master);

    // wind: pink-ish noise through a wandering band-pass
    const nb = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
    const nd = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nd.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
      nd[i] = (b0 + b1 + b2) * 0.6;
    }
    const src = c.createBufferSource();
    src.buffer = nb; src.loop = true;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.12;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // swarm shimmer pad
    this.padGain = c.createGain(); this.padGain.gain.value = 0;
    const pf = c.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 1800;
    for (const f of [659.25, 987.77, 1318.5]) {
      for (const det of [-4, 4]) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = det;
        const g = c.createGain(); g.gain.value = 0.05;
        o.connect(g).connect(pf); o.start();
      }
    }
    pf.connect(this.padGain);
    this.padGain.connect(this.verb);
    this.padGain.connect(this.master);
  }

  update(gust: number, swarm: number) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.06 + gust * 0.22, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(350 + gust * 600, t, 0.5);
    this.padGain.gain.setTargetAtTime(Math.min(1, swarm / 160) * 0.12, t, 0.6);
  }

  private crickets() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    if (Math.random() < 0.45) return;
    const t = c.currentTime + Math.random() * 0.3;
    const f = 4200 + Math.random() * 900;
    const pan = c.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    const g = c.createGain(); g.gain.value = 0;
    const o = c.createOscillator(); o.frequency.value = f; o.type = 'sine';
    o.connect(g).connect(pan).connect(this.master);
    const n = 2 + Math.floor(Math.random() * 3);
    const v = 0.006 + Math.random() * 0.01;
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.055;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(v, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.035);
    }
    o.start(t); o.stop(t + n * 0.055 + 0.05);
  }

  ting(i: number) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const now = c.currentTime;
    if (now - this.lastTing < 0.07) return;
    this.lastTing = now;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = 523.25 * Math.pow(2, scale[i % scale.length] / 12);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.76;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(this.verb); g.connect(this.master);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.035, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    o.start(now); o2.start(now); o.stop(now + 1.3); o2.stop(now + 1.3);
  }

  chord(k: number) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const now = c.currentTime;
    const roots = [0, 5, 7, 3, 8, 10];
    const r = 261.63 * Math.pow(2, roots[k % roots.length] / 12);
    for (const [m, d] of [[1, 0], [1.5, 0.12], [2, 0.24], [2.5198, 0.36], [3, 0.5]]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = r * m;
      const g = c.createGain(); g.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      o.connect(lp).connect(g); g.connect(this.verb); g.connect(this.master);
      g.gain.setValueAtTime(0, now + d);
      g.gain.linearRampToValueAtTime(0.03, now + d + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d + 4.5);
      o.start(now + d); o.stop(now + d + 4.6);
    }
  }

  whoosh() {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const now = c.currentTime;
    const b = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = c.createBufferSource(); s.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, now); f.frequency.exponentialRampToValueAtTime(2600, now + 0.5);
    const g = c.createGain(); g.gain.value = 0.12;
    s.connect(f).connect(g).connect(this.master);
    s.start(now);
  }
}
