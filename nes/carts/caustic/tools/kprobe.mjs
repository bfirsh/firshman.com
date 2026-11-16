// Kernel timing check: dot of every $2005 first write (fine X), $2006 second write and $2001 write
// on scanlines 23..206, across many frames. node kprobe.mjs <rom> [--frames N] [--from F]
import { NES } from '../../../../node_modules/jsnes/src/index.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('frames', 600), from = +opt('from', 100);
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
const ppu = nes.ppu;
let frame = 0, w2005 = 0, w2006 = 0;
const st = { x: [1e9, -1], lo: [1e9, -1], m: [1e9, -1] };
const lines = new Set();
const upd = (k, d) => { st[k][0] = Math.min(st[k][0], d); st[k][1] = Math.max(st[k][1], d); };
const w = nes.mmap.write.bind(nes.mmap);
nes.mmap.write = (a, v) => {
  const l = ppu.line, d = ppu.dot;
  if (frame >= from && l >= 23 && l <= 206) {
    if (a === 0x2005) { if (w2005 % 2 === 1) upd('x', d); w2005++; }
    if (a === 0x2006) { if (w2006 % 2 === 1) upd('lo', d); w2006++; }
    if (a === 0x2001) { upd('m', d); lines.add(l); }
  }
  if (a === 0x2002 || (l === 0 && d < 5)) {}
  w(a, v);
};
const r = nes.cpu.load.bind(nes.cpu);
for (frame = 0; frame < frames; frame++) { w2005 = 0; w2006 = 0; nes.frame(); }
console.log('fine-X $2005 dots', st.x, ' $2006 lo dots', st.lo, ' $2001 dots', st.m, ' lines with $2001:', lines.size);
