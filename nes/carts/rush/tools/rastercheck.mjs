// Raster timing check: every $2005/$2006/$5120 write on a visible line, by dot. A write to
// $2006 that sets v (the second of a pair), the fine-X $2005 write (first of a pair) and the
// per-line CHR bank write must land in the horizontal blank (dots 257-340) or before the
// picture's first fetches; anything else is counted by register and line. Expected (harmless)
// exceptions: $5120 on line 30 (the kernel entry, during the letterbox), $2006 on line 208 (the
// letterbox after the picture: black to black), $5120 on lines 88 / 152 (the tunnel switches the
// band halves that are not being drawn), and the two frames before the first NMI.
// node tools/rastercheck.mjs <rom> --frames N
import { NES } from 'jsnes';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
const frames = +opt('frames', 1000);
const ppu = nes.ppu;
let frame = 0, bad = 0, total = 0;
const byLine = {};
const hist = {};
const w = nes.mmap.write.bind(nes.mmap);
nes.mmap.write = (a, v) => {
  const l = ppu.line, d = ppu.dot;
  if (l >= 0 && l < 240 && (a === 0x2005 || a === 0x2006 || a === 0x5120 || a === 0x5121 || a === 0x2001)) {
    // which write of the pair? ppu.firstWrite: true = next write is the first
    const second = a === 0x2006 ? !ppu.firstWrite : a === 0x2005 ? ppu.firstWrite : true;
    if (second) {
      total++;
      const k = `${a.toString(16)}`;
      (hist[k] ||= {})[Math.floor(d / 16) * 16] = ((hist[k] ||= {})[Math.floor(d / 16) * 16] || 0) + 1;
      if (d < 256 && !(a === 0x5121 || a === 0x5120 && d < 8)) { bad++; byLine[`${k}@${l}`] = (byLine[`${k}@${l}`] || 0) + 1; }
    }
  }
  w(a, v);
};
for (frame = 0; frame < frames; frame++) nes.frame();
for (const [k, h] of Object.entries(hist)) console.log(k, JSON.stringify(h));
console.log("outside the blank, by register@line:", JSON.stringify(byLine));
console.log(`${total} critical writes, ${bad} outside the horizontal blank`);
