// Timing check: where (scanline) the main thread's markers ($4018 writes: 1 bottom half done,
// 2 part logic done, 3 top half done) land, per part, plus lag (frames without a marker 3).
//   node tools/timing.mjs <rom> [frames]
import { NES } from 'jsnes';
import fs from 'node:fs';
const nes = new NES({ onFrame() {}, emulateSound: true, sampleRate: 48000, onAudioSample() {} });
nes.loadROM(fs.readFileSync(process.argv[2]).toString('binary'));
const N = +(process.argv[3] || 8064);
const ppu = nes.ppu;
const w = nes.mmap.write.bind(nes.mmap);
let frame = 0;
const worst = {};          // per 576-frame block: max line for each marker
const seen = {};
nes.mmap.write = (a, v) => {
  if (a === 0x4018) {
    const line = ppu.scanline - 21;   // visible line (0..239), negative/large = vblank
    const blk = Math.floor(frame / 576);
    const k = `${blk}:${v}`;
    worst[k] = Math.max(worst[k] ?? -99, line);
    seen[frame] = (seen[frame] || 0) | (1 << v);
  }
  w(a, v);
};
for (frame = 0; frame < N; frame++) nes.frame();
let lag = 0;
for (let f = 10; f < N; f++) if (!((seen[f] || 0) & 8)) lag++;
for (let b = 0; b * 576 < N; b++) console.log(`block ${b} (frames ${b * 576}+): bottom done <= line ${worst[b + ':1']}, logic <= ${worst[b + ':2']}, top done <= ${worst[b + ':3']}`);
console.log('frames without a completed top half:', lag);
