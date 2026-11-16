// Render a music ROM in JSNES and log everything the verification scripts need.
// node nes/music/tools/render.mjs <rom> --frames N [--wav out.wav] [--log out.json] [--song K]
//   --wav   48 kHz mono WAV (same mixing as nes/tools/run.mjs: (L+R)/2)
//   --log   per frame: music_play CPU cycles, sync variables, APU channel state after the frame
//   --song  patch the harness's song-select byte (file offset $6010) before loading
//   --solo  comma list of sq1,sq2,tri,noise,dmc: mute every other channel in the mix (for analysis)
// The cycle count is measured between the harness's writes to $4018 and $4019, which bracket
// "jsr music_play" (so it includes the jsr/rts and one sta: subtract 16 for the routine alone).
import { NES } from 'jsnes';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const romBuf = fs.readFileSync(args[0]);
const song = opt('song', null);
if (song !== null) romBuf[0x6010] = +song;
const frames = +opt('frames', 600);
const wav = opt('wav', '');
const logf = opt('log', '');

const audio = [];
const nes = new NES({
  onFrame: () => {},
  onAudioSample: wav ? (l, r) => { audio.push((l + r) / 2); } : null,
  emulateSound: true,
  sampleRate: 48000,
});
nes.loadROM(romBuf.toString('binary'));

const solo = opt('solo', '');
if (solo) {
  const keep = new Set(solo.split(','));
  const names = { sq1: 'Square1', sq2: 'Square2', tri: 'Triangle', noise: 'Noise', dmc: 'DMC' };
  const up = nes.papu.updateStereoPos.bind(nes.papu);
  nes.papu.updateStereoPos = () => {
    up();
    for (const [k, n] of Object.entries(names)) if (!keep.has(k)) { nes.papu['stereoPosL' + n] = 0; nes.papu['stereoPosR' + n] = 0; }
  };
  nes.papu.updateStereoPos();
}
let t0 = 0, cyc = [], cur = null;
const w = nes.mmap.write.bind(nes.mmap);
nes.mmap.write = (addr, val) => {
  if (addr === 0x4018) t0 = nes.cpu.cycles;
  else if (addr === 0x4019) cur = nes.cpu.cycles - t0;
  w(addr, val);
};

const log = [];
const mem = nes.cpu.mem;
const p = nes.papu;
for (let f = 0; f < frames; f++) {
  cur = null;
  nes.frame();
  if (logf) {
    const sq = (s) => [s.progTimerMax, s.isEnabled && s.lengthCounter > 0 ? s.masterVolume : 0, s.dutyMode];
    const t = p.triangle;
    log.push([
      cur,
      mem[0xE0] | (mem[0xE1] << 8), mem[0xE2], mem[0xE3], mem[0xE4],
      ...sq(p.square1), ...sq(p.square2),
      t.progTimerMax, t.linearCounter > 0 && t.lengthCounter > 0 ? 1 : 0,
      p.noise.progTimerMax, p.noise.isEnabled && p.noise.lengthCounter > 0 ? p.noise.masterVolume : 0, p.noise.randomMode,
      p.dmc.bytesRemaining > 0 ? 1 : 0, p.dmc.outputLevel,
    ]);
  } else if (cur !== null) cyc.push(cur);
}
if (wav) {
  const n = audio.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(wav, b);
}
if (logf) {
  fs.writeFileSync(logf, JSON.stringify({
    fields: ['cycles', 'frame', 'order', 'row', 'events', 'sq1_period', 'sq1_vol', 'sq1_duty', 'sq2_period', 'sq2_vol', 'sq2_duty',
      'tri_period', 'tri_on', 'noise_period', 'noise_vol', 'noise_short', 'dmc_on', 'dmc_level'],
    frames: log,
  }));
  cyc = log.map((r) => r[0]).filter((c) => c !== null);
}
const max = Math.max(...cyc), mean = cyc.reduce((a, b) => a + b, 0) / cyc.length;
console.log(`${frames} frames; music_play cycles (incl. jsr/rts/sta, ~16): max ${max}, mean ${mean.toFixed(0)}, at frame ${cyc.indexOf(max)}`);
