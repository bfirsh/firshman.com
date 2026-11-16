// Audio for the Cartridge player: an AudioWorklet ring buffer that clocks the emulator,
// a ScriptProcessor fallback, and the synthesized CRT power-on (relay, degauss, crackle, whine).
//
// The worklet reports how many samples it has consumed every few render quanta. Each report
// is a tick: the player runs NES frames until the queue is back at its target, so emulation is
// paced by the sound card's clock and audio can neither drift nor crackle. When the worklet
// stops reporting (no output device, a suspended context, no AudioWorklet) the player falls back
// to a timer clock and samples are dropped.

const WORKLET = `
class CartridgeOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 1 << 15;
    this.L = new Float32Array(this.cap);
    this.R = new Float32Array(this.cap);
    this.r = 0; this.w = 0; this.n = 0;
    this.consumed = 0; this.under = 0; this.q = 0;
    this.g = 0; this.hl = 0; this.hr = 0;
    this.ret = [];
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.reset) { this.r = this.w; this.n = 0; return; }
      const l = d.l, rr = d.r, len = d.len, cap = this.cap - 1;
      for (let i = 0; i < len; i++) {
        this.L[this.w] = l[i]; this.R[this.w] = rr[i];
        this.w = (this.w + 1) & cap;
      }
      this.n += len;
      if (this.n > this.cap) { const drop = this.n - this.cap; this.r = (this.r + drop) & cap; this.n -= drop; this.consumed += drop; }
      this.ret.push(l.buffer, rr.buffer);
    };
  }
  process(inputs, outputs) {
    const o = outputs[0];
    const oL = o[0], oR = o[1] || o[0], size = oL.length, cap = this.cap - 1;
    let g = this.g, hl = this.hl, hr = this.hr, starved = false;
    for (let i = 0; i < size; i++) {
      if (this.n > 0) {
        const l = this.L[this.r], r = this.R[this.r];
        this.r = (this.r + 1) & cap; this.n--; this.consumed++;
        // crossfade out of any underrun tail so a refill never clicks
        g = g < 1 ? g + 1 / 96 : 1;
        hl *= 0.99; hr *= 0.99;
        oL[i] = l * g + hl * (1 - g); oR[i] = r * g + hr * (1 - g);
        if (g >= 1) { hl = l; hr = r; }
      } else {
        // starved: let the last sample decay to silence instead of stepping to zero
        if (g > 0) { hl = hl * g; hr = hr * g; g = 0; }
        hl *= 0.995; hr *= 0.995;
        oL[i] = hl; oR[i] = hr;
        starved = true;
      }
    }
    if (starved) this.under++;
    this.g = g; this.hl = hl; this.hr = hr;
    if (++this.q >= 3) {
      this.q = 0;
      const ret = this.ret; this.ret = [];
      this.port.postMessage({ c: this.consumed, n: this.n, u: this.under, t: currentFrame + size, b: ret }, ret);
    }
    return true;
  }
}
registerProcessor('cartridge-out', CartridgeOut);
`;

const CHUNK = 1024;

export class NesAudio {
  constructor() {
    this.ctx = null;
    this.mode = 'none'; // 'worklet' | 'script' | 'none'
    this.onTick = null;
    this.muted = false;
    this.written = 0;
    this.consumed = 0;
    this.reportFrame = 0;
    this.reportN = 0;
    this.underruns = 0;
    this.underrunEvents = 0;
    this.lastReport = 0;
    this.pool = [];
    this.curL = null; this.curR = null; this.pos = 0;
    this.sampleRate = 48000;
    this.target = 0;
    // fallback ring (ScriptProcessor)
    this.sp = null;
  }

  // Must be called synchronously inside a user gesture.
  create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try { this.ctx = new AC(); } catch { return false; }
    }
    const ctx = this.ctx;
    this.sampleRate = ctx.sampleRate;
    this.target = Math.round(this.sampleRate * 0.05);
    ctx.resume?.().catch(() => {});

    // master: mute gain -> gentle peak limiter -> out
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
    this.master.connect(lim).connect(ctx.destination);
    // NES bus: a faint warmth, like the set's own speaker but far kinder
    this.nesGain = ctx.createGain();
    this.nesGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 15000; lp.Q.value = 0.5;
    this.nesGain.connect(lp).connect(this.master);
    this.fx = ctx.createGain();
    this.fx.gain.value = 0.9;
    this.fx.connect(this.master);
    return true;
  }

  async start() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const node = new AudioWorkletNode(ctx, 'cartridge-out', { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.onmessage = (e) => this.report(e.data);
        node.connect(this.nesGain);
        this.node = node;
        this.mode = 'worklet';
        return;
      } catch (e) {
        console.warn('AudioWorklet unavailable, using ScriptProcessor', e);
      }
    }
    if (ctx.createScriptProcessor) this.startScript();
  }

  startScript() {
    const ctx = this.ctx, cap = 1 << 15;
    this.ring = { L: new Float32Array(cap), R: new Float32Array(cap), r: 0, w: 0, n: 0, cap };
    const sp = ctx.createScriptProcessor(1024, 0, 2);
    sp.onaudioprocess = (e) => {
      const ring = this.ring, oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
      this.lastReport = performance.now();
      this.reportFrame = Math.round(ctx.currentTime * this.sampleRate);
      if (this.onTick) this.onTick(oL.length);
      let starved = false;
      for (let i = 0; i < oL.length; i++) {
        if (ring.n > 0) { oL[i] = ring.L[ring.r]; oR[i] = ring.R[ring.r]; ring.r = (ring.r + 1) & (cap - 1); ring.n--; }
        else { oL[i] = oR[i] = 0; starved = true; }
      }
      if (starved) this.underruns++;
    };
    sp.connect(this.nesGain);
    this.sp = sp;
    this.mode = 'script';
  }

  report(d) {
    this.consumed = d.c;
    this.reportN = d.n;
    this.reportFrame = d.t;
    if (d.u > this.underruns) {
      // the queue ran dry while we were feeding it: keep a little more in hand from now on
      const steady = this.written > this.sampleRate * 0.5 && this.lastReport && performance.now() - this.lastReport < 200;
      if (steady) this.target = Math.min(this.target + Math.round(this.sampleRate * 0.008), Math.round(this.sampleRate * 0.15));
      this.underrunEvents += steady ? 1 : 0;
      this.underruns = d.u;
    }
    if (d.b && d.b.length) this.recycle(d.b);
    this.lastReport = performance.now();
    if (this.onTick) this.onTick();
  }

  // Samples queued but not yet played, estimated now.
  buffered() {
    if (this.mode === 'script') return this.ring.n + this.pos;
    if (this.mode !== 'worklet') return 0;
    const now = this.ctx.currentTime * this.sampleRate;
    const played = Math.min(Math.max(0, now - this.reportFrame), this.reportN);
    return Math.max(0, this.written - this.consumed - played) + this.pos;
  }

  clockAlive() {
    return this.mode !== 'none' && this.ctx && this.ctx.state === 'running' && performance.now() - this.lastReport < 150;
  }

  // Called per NES sample.
  push(l, r) {
    if (this.mode === 'script') {
      const ring = this.ring;
      if (ring.n >= ring.cap) return;
      ring.L[ring.w] = l; ring.R[ring.w] = r; ring.w = (ring.w + 1) & (ring.cap - 1); ring.n++;
      return;
    }
    if (this.mode !== 'worklet') return;
    if (!this.curL) {
      const b = this.pool.pop();
      this.curL = b ? b[0] : new Float32Array(CHUNK);
      this.curR = b ? b[1] : new Float32Array(CHUNK);
      this.pos = 0;
    }
    this.curL[this.pos] = l; this.curR[this.pos] = r;
    if (++this.pos === CHUNK) this.flush();
  }

  flush() {
    if (!this.curL || this.pos === 0 || this.mode !== 'worklet') return;
    const l = this.curL, r = this.curR, len = this.pos;
    this.node.port.postMessage({ l, r, len }, [l.buffer, r.buffer]);
    this.written += len;
    this.curL = this.curR = null; this.pos = 0;
  }

  // the worklet hands buffers back with its reports; recycle them
  recycle(bufs) {
    for (let i = 0; i + 1 < bufs.length; i += 2) this.pool.push([new Float32Array(bufs[i]), new Float32Array(bufs[i + 1])]);
  }

  drop() {
    this.curL = this.curR = null; this.pos = 0;
    if (this.mode === 'worklet') { this.node.port.postMessage({ reset: true }); this.consumed = this.written; this.reportN = 0; }
    if (this.mode === 'script') { this.ring.n = 0; this.ring.r = this.ring.w; }
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.03);
  }

  suspend() { this.ctx?.suspend?.().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); }

  // Bring the NES in once the raster is up.
  fadeInNes(at, dur) {
    const g = this.nesGain.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(0.85, at + dur);
  }

  // The CRT power-on: relay clack, the degauss coil's dying hum, static crackle on the glass,
  // and the flyback's whine coming up and fading away.
  powerOn() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02, out = this.fx, sr = ctx.sampleRate;
    const noise = ctx.createBuffer(1, sr, sr);
    {
      const d = noise.getChannelData(0);
      let s = 0x2545f491;
      for (let i = 0; i < d.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
    }
    const burst = (at, dur, gain, freq, q, type = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(at, Math.random() * 0.8, dur + 0.05);
    };

    // relay: two clicks close together, then the body of the set knocks
    burst(t0, 0.03, 0.5, 2600, 1.2);
    burst(t0 + 0.012, 0.05, 0.25, 900, 0.9);
    {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(82, t0);
      o.frequency.exponentialRampToValueAtTime(34, t0 + 0.22);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.55, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      o.connect(g).connect(out);
      o.start(t0); o.stop(t0 + 0.5);
    }
    // degauss: a fat 60 Hz buzz that swells for a moment and dies away
    {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(220, t0 + 2.0); lp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.setTargetAtTime(0.0, t0 + 0.12, 0.42);
      const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 60;
      const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 120.4;
      const bg = ctx.createGain(); bg.gain.value = 0.35;
      a.connect(lp); b.connect(bg).connect(lp);
      lp.connect(g).connect(out);
      a.start(t0); b.start(t0); a.stop(t0 + 3); b.stop(t0 + 3);
    }
    // static on the glass: sparse ticks, denser as the high voltage comes up
    for (let i = 0; i < 14; i++) {
      const at = t0 + 0.18 + Math.pow(Math.random(), 1.6) * 2.4;
      burst(at, 0.004 + Math.random() * 0.01, 0.05 + Math.random() * 0.12, 3500 + Math.random() * 4000, 0.7, 'highpass');
    }
    // flyback whine, 15.734 kHz, barely there and gone after a few seconds
    {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 15734;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.004, t0 + 0.6);
      g.gain.setTargetAtTime(0, t0 + 1.2, 1.4);
      o.connect(g).connect(out);
      o.start(t0); o.stop(t0 + 9);
    }
  }
}
