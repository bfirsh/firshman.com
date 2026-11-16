// Cycle profiler for the music driver: attributes CPU cycles spent inside music_play to the
// nearest preceding label from the ld65 debug file.
// node nes/music/tools/profile.mjs <rom> <harness.dbg> [--frames N] [--from F] [--to F] [--rowonly]
import { NES } from 'jsnes';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const syms = [];
for (const line of fs.readFileSync(args[1], 'utf8').split('\n')) {
  if (!line.startsWith('sym')) continue;
  const name = /name="([^"]+)"/.exec(line)?.[1], val = /val=0x([0-9A-F]+)/i.exec(line)?.[1];
  const scope = /scope=(\d+)/.exec(line)?.[1];
  if (name && val && /type=lab/.test(line)) syms.push([parseInt(val, 16), name]);
}
const scopes = {};
for (const line of fs.readFileSync(args[1], 'utf8').split('\n')) if (line.startsWith('scope')) { const id = /id=(\d+)/.exec(line)[1]; scopes[id] = /name="([^"]*)"/.exec(line)[1]; }
syms.sort((a, b) => a[0] - b[0]);
const lab = (pc) => { let lo = 0, hi = syms.length - 1, r = '?'; while (lo <= hi) { const m = (lo + hi) >> 1; if (syms[m][0] <= pc) { r = syms[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
const nes = new NES({ onFrame() {}, emulateSound: true, sampleRate: 48000 });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
const frames = +opt('frames', 3000), from = +opt('from', 0), to = +opt('to', 1e9);
let inside = false, f = 0;
const w = nes.mmap.write.bind(nes.mmap);
nes.mmap.write = (a, v) => { if (a === 0x4018) inside = true; else if (a === 0x4019) inside = false; w(a, v); };
const prof = {};
const cpu = nes.cpu, em = cpu.emulate.bind(cpu);
let rowonly = args.includes('--rowonly'), isrow = false;
cpu.emulate = () => { const pc = cpu.REG_PC, c = em(); if (inside && f >= from && f < to) { const l = lab(pc); prof[l] = (prof[l] || 0) + c; } return c; };
let total = 0;
for (f = 0; f < frames; f++) nes.frame();
const ent = Object.entries(prof).sort((a, b) => b[1] - a[1]);
const sum = ent.reduce((a, b) => a + b[1], 0);
const n = Math.min(frames, to) - from;
for (const [k, v] of ent.slice(0, 40)) console.log(k.padEnd(20), (v / n).toFixed(1).padStart(8), 'cyc/frame');
console.log('total', (sum / n).toFixed(1));
