// Time between writes to two symbols (e.g. a routine's start and end markers), in scanlines.
// node tools/span.mjs rom --a sym --av value --b sym --bv value --frames N --from F
import { NES } from 'jsnes';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const nes = new NES({ onFrame() {}, emulateSound: false });
nes.loadROM(fs.readFileSync(args[0]).toString('binary'));
const dbg = fs.readFileSync(args[0].replace(/\.nes$/, '.dbg'), 'utf8');
const syms = {};
for (const m of dbg.matchAll(/name="([^"]+)",addrsize=\w+,(?:size=\d+,)?scope=\d+,def=[\d+]+(?:,ref=[\d+]+)?,val=(0x[0-9A-Fa-f]+)/g)) syms[m[1]] = parseInt(m[2]);
const A = syms[opt('a')], B = syms[opt('b')], av = +opt('av', 0), bv = +opt('bv', 1);
let frame = 0, t0 = null; const spans = [];
const from = +opt('from', 100);
const now = () => frame * 262 + nes.ppu.scanline + nes.ppu.dot / 341;   // in scanlines
const cw = nes.cpu.write.bind(nes.cpu);
nes.cpu.write = (a, v) => { if (frame >= from) { if (a === A && v === av) t0 = now(); if (a === B && v === bv && t0 !== null) { spans.push(now() - t0); t0 = null; } } cw(a, v); };
for (frame = 0; frame < +opt('frames', 300); frame++) nes.frame();
const s = spans.map((x) => x / 262);
console.log(`${s.length} spans, frames: min ${Math.min(...s).toFixed(2)} mean ${(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2)} max ${Math.max(...s).toFixed(2)}`);
