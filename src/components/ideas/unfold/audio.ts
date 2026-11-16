// Small synthesized sounds: ratchet ticks, a snap, paper whooshes and
// a pentatonic sprinkle as voxels land. Nothing loads from the network.

export class Sound {
  ctx: AudioContext | null = null;
  out: GainNode | null = null;
  on = false;
  noise: AudioBuffer | null = null;
  lastNote = 0;
  root = 220;

  enable(v: boolean) {
    this.on = v;
    if (v && !this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx && v && this.ctx.state === 'suspended') this.ctx.resume();
  }

  private ready() {
    return this.on && this.ctx && this.out && this.ctx.state === 'running';
  }

  private burst(t: number, dur: number, freq: number, q: number, gain: number) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 1.0, dur + 0.05);
  }

  private tone(t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', bend = 1) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  tick(strength = 1) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.025, 3800, 6, 0.12 * strength);
  }

  snap(strength = 1) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.burst(t, 0.05, 2400, 3, 0.4 * strength);
    this.burst(t + 0.012, 0.03, 5200, 5, 0.15 * strength);
    this.tone(t, 170, 0.12, 0.35 * strength, 'sine', 0.6);
  }

  whoosh(up: boolean) {
    if (!this.ready()) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(up ? 400 : 1800, t);
    f.frequency.exponentialRampToValueAtTime(up ? 2200 : 300, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, 0, 1.2);
  }

  // a note from a pentatonic scale; i picks the degree
  note(i: number, gain = 0.1) {
    if (!this.ready()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastNote < 0.045) return;
    this.lastNote = now;
    const scale = [0, 2, 4, 7, 9];
    const deg = ((i % 15) + 15) % 15;
    const semi = scale[deg % 5] + 12 * Math.floor(deg / 5);
    const f = this.root * Math.pow(2, semi / 12) * 2;
    this.tone(now, f, 0.5, gain, 'triangle');
    this.tone(now, f * 2.01, 0.25, gain * 0.25, 'sine');
  }

  chime() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    [0, 4, 7, 11, 14].forEach((s, k) => this.tone(t + k * 0.09, this.root * 2 * Math.pow(2, s / 12), 2.2, 0.07, 'sine'));
  }
}
