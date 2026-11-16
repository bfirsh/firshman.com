// Timing probe for the demo ROM: logs the PPU position of selected register writes and the
// CPU time spent in NMI/IRQ handlers.
//   node nes/tools/probe.mjs <rom> --frames N --from F [--regs 2005,2006,2001,5203] [--max 40]
import { NES } from '../../node_modules/jsnes/src/index.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('frames', 600), from = +opt('from', 0), max = +opt('max', 60);
const regs = new Set(opt('regs', '2005,2006,2001').split(',').map((s) => parseInt(s, 16)));
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
let frame = 0, logged = 0;
const ppu = nes.ppu;
const w = nes.mmap.write.bind(nes.mmap);
const hist = {};
nes.mmap.write = (a, v) => {
  if (frame >= from && regs.has(a)) {
    const key = `${a.toString(16)}`;
    const d = ppu.dot, l = ppu.line;
    (hist[key] ||= []).push(d);
    if (logged < max) { console.log(`f${frame} ${key}=${v.toString(16).padStart(2, '0')} line ${l} dot ${d}`); logged++; }
  }
  w(a, v);
};
// --watch sym1,sym2 --every N: print RAM values of symbols from out/demo.dbg
const watch = (opt('watch', '') || '').split(',').filter(Boolean);
const every = +opt('every', 100);
const syms = {};
if (watch.length) {
  const dbg = fs.readFileSync(args[0].replace(/\.nes$/, '.dbg'), 'utf8');
  for (const m of dbg.matchAll(/name="([^"]+)",addrsize=\w+,(?:size=\d+,)?scope=\d+,def=[\d+]+(?:,ref=[\d+]+)?,val=(0x[0-9A-Fa-f]+)/g)) syms[m[1]] = parseInt(m[2]);
}
// --trace sym: log the PPU line each time the CPU writes the symbol's address
const trace = opt('trace', '');
if (trace) {
  const dbg = fs.readFileSync(args[0].replace(/\.nes$/, '.dbg'), 'utf8');
  for (const m of dbg.matchAll(/name="([^"]+)",addrsize=\w+,(?:size=\d+,)?scope=\d+,def=[\d+]+(?:,ref=[\d+]+)?,val=(0x[0-9A-Fa-f]+)/g)) syms[m[1]] = parseInt(m[2]);
  const ta = syms[trace];
  const cw = nes.cpu.write.bind(nes.cpu);
  const lines = {};
  const pcs = {};
  nes.cpu.write = (a, v) => { if (a === ta && frame >= from) { const l = ppu.line; lines[l] = (lines[l] || 0) + 1;
    // return address of the interrupted code is on the stack
    const sp = nes.cpu.REG_SP & 0xff; const pc = nes.cpu.mem[0x100 + ((sp + 5) & 0xff)] | (nes.cpu.mem[0x100 + ((sp + 6) & 0xff)] << 8);
    pcs[pc.toString(16)] = (pcs[pc.toString(16)] || 0) + 1; } cw(a, v); };
  process.on('exit', () => console.log('stack ret addrs', JSON.stringify(pcs)));
  process.on('exit', () => console.log(trace, 'written at lines', JSON.stringify(lines)));
}
for (frame = 0; frame < frames; frame++) {
  nes.frame();
  if (watch.length && frame % every === 0) console.log(frame, watch.map((w) => `${w}=${nes.cpu.mem[syms[w]]}`).join(' '));
}
for (const [k, ds] of Object.entries(hist)) {
  const by = {}; for (const d of ds) { const b = Math.floor(d / 16) * 16; by[b] = (by[b] || 0) + 1; }
  console.log(k, 'dot histogram', JSON.stringify(by));
}
