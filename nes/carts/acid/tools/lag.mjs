import { NES } from 'jsnes';
import fs from 'node:fs';
const rom = process.argv[2];
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(rom).toString('binary'));
const dbg = fs.readFileSync(rom.replace(/\.nes$/, '.dbg'), 'utf8');
const syms = {};
for (const m of dbg.matchAll(/name="([^"]+)",addrsize=\w+,(?:size=\d+,)?scope=\d+,def=[\d+]+(?:,ref=[\d+]+)?,val=(0x[0-9A-Fa-f]+)/g)) syms[m[1]] = parseInt(m[2]);
const mf = syms['music_frame'];
let last = null;
for (let f = 0; f < +process.argv[3]; f++) {
  nes.frame();
  const v = nes.cpu.mem[mf] | (nes.cpu.mem[mf + 1] << 8);
  const lag = f - v;
  if (lag !== last) { console.log('frame', f, 'music_frame', v, 'lag', lag); last = lag; }
}
