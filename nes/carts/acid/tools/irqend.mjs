// Worst-case end line of the vector engine's forced-blank upload (last $2007 write before line 241),
// and the latest rendering-enable ($2001 != 0) write in the vblank. node tools/irqend.mjs rom frames
import { NES } from 'jsnes';
import fs from 'node:fs';
const nes = new NES({ onFrame() {}, emulateSound: true, sampleRate: 48000, onAudioSample() {} });
nes.loadROM(fs.readFileSync(process.argv[2]).toString('binary'));
const ppu = nes.ppu;
let maxIrq = 0, maxIrqF = 0, maxOn = 0, maxOnF = 0, f = 0;
// frame ranges to check (vector sections, skipping each part's loading frames)
const ranges = (process.argv[4] || '').split(',').filter(Boolean).map((r) => r.split('-').map(Number));
const inRange = () => !ranges.length || ranges.some(([a, b]) => f >= a && f < b);
const w = nes.mmap.write.bind(nes.mmap);
nes.mmap.write = (a, v) => {
  const l = ppu.scanline - 21;   // JSNES: 20 = pre-render, 21 = line 0
  if (!inRange()) { w(a, v); return; }
  if (a === 0x2007 && l >= 150 && l < 241) { const x = l + ppu.dot / 341; if (x > maxIrq) { maxIrq = x; maxIrqF = f; } }
  if (a === 0x2001 && v !== 0 && (l >= 241 || l < 0)) { const x = (l < 0 ? l + 262 : l) + ppu.dot / 341; if (x > maxOn) { maxOn = x; maxOnF = f; } }
  w(a, v);
};
for (f = 0; f < +process.argv[3]; f++) nes.frame();
console.log(`IRQ upload ends by line ${maxIrq.toFixed(2)} (frame ${maxIrqF}); NMI enables rendering by line ${maxOn.toFixed(2)} (frame ${maxOnF}) [vblank 241-260, pre-render 261]`);
