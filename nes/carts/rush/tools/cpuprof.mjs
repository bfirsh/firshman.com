// CPU profile of the demo ROM: cycles per label (nearest preceding symbol) over a frame range.
// node tools/cpuprof.mjs <rom> --from F --to F [--top N]
import { NES } from 'jsnes';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const dbg = fs.readFileSync(args[0].replace(/\.nes$/, '.dbg'), 'utf8');
const syms = [];
for (const line of dbg.split('\n')) {
  if (!line.startsWith('sym')) continue;
  const name = /name="([^"]+)"/.exec(line)?.[1], val = /val=0x([0-9A-F]+)/i.exec(line)?.[1];
  if (name && val && /type=lab/.test(line)) syms.push([parseInt(val, 16), name]);
}
syms.sort((a, b) => a[0] - b[0]);
const lab = (pc) => { let lo = 0, hi = syms.length - 1, r = '?'; while (lo <= hi) { const m = (lo + hi) >> 1; if (syms[m][0] <= pc) { r = syms[m][1]; lo = m + 1; } else hi = m - 1; } return r; };
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
const from = +opt('from', 0), to = +opt('to', 100);
let f = 0;
const prof = {};
const cpu = nes.cpu, em = cpu.emulate.bind(cpu);
cpu.emulate = () => { const pc = cpu.REG_PC + 1, c = em(); if (f >= from) { const l = lab(pc & 0xffff); prof[l] = (prof[l] || 0) + c; } return c; };
for (f = 0; f < to; f++) nes.frame();
const n = to - from;
const ent = Object.entries(prof).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ent.slice(0, +opt('top', 30))) console.log(k.padEnd(24), (v / n).toFixed(0).padStart(7));
