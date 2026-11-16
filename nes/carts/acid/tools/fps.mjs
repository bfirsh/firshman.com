// Vector images shown per second between two frames: node tools/fps.mjs rom from to
import { NES } from 'jsnes';
import fs from 'node:fs';
const [rom, from, to] = [process.argv[2], +process.argv[3], +process.argv[4]];
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(rom).toString('binary'));
const dbg = fs.readFileSync(rom.replace(/\.nes$/, '.dbg'), 'utf8');
const syms = {};
for (const m of dbg.matchAll(/name="([^"]+)",addrsize=\w+,(?:size=\d+,)?scope=\d+,def=[\d+]+(?:,ref=[\d+]+)?,val=(0x[0-9A-Fa-f]+)/g)) syms[m[1]] = parseInt(m[2]);
const A = syms['vec_dispplane'];
let f = 0, n = 0; const gaps = {}; let last = null;
const cw = nes.cpu.write.bind(nes.cpu);
nes.cpu.write = (a, v) => { if (a === A && f >= from && f < to) { n++; if (last !== null) gaps[f - last] = (gaps[f - last] || 0) + 1; last = f; } cw(a, v); };
for (f = 0; f < to; f++) nes.frame();
console.log(`${n} images in ${to - from} frames: ${(n * 60 / (to - from)).toFixed(1)} fps; frames between flips:`, JSON.stringify(gaps));
