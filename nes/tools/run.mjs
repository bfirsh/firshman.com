// Headless JSNES runner for the demo ROM.
// node nes/tools/run.mjs <rom.nes> [--frames N] [--shots 60,120,...] [--every K] [--out dir] [--wav file.wav]
//   [--press "frame:button[:frames]",...]   buttons: A B SELECT START UP DOWN LEFT RIGHT
// Writes PNGs (256x240, true pixels) named f<frame>.png, an optional 48kHz mono WAV, and prints timing.
import { NES, Controller } from 'jsnes';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const args = process.argv.slice(2);
const rom = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('frames', 600);
const every = +opt('every', 0);
const shots = new Set((opt('shots', '') || '').split(',').filter(Boolean).map(Number));
const out = opt('out', 'nes/out');
const wav = opt('wav', '');
const presses = (opt('press', '') || '').split(',').filter(Boolean).map((s) => {
  const [f, b, n] = s.split(':'); return { f: +f, b: Controller['BUTTON_' + b], n: +(n || 6) };
});
fs.mkdirSync(out, { recursive: true });

let last = null;
const audio = [];
const nes = new NES({
  onFrame: (buf) => { last = buf; },
  onAudioSample: wav ? (l, r) => { audio.push((l + r) / 2); } : null,
  emulateSound: !!wav,
  sampleRate: 48000,
});
nes.loadROM(fs.readFileSync(rom).toString('binary'));

function png(buf, file) {
  const w = 256, h = 240, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const c = buf[y * w + x], o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = c & 255; raw[o + 1] = (c >> 8) & 255; raw[o + 2] = (c >> 16) & 255;
    }
  }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const t0 = performance.now();
for (let f = 1; f <= frames; f++) {
  for (const p of presses) { if (f === p.f) nes.buttonDown(1, p.b); if (f === p.f + p.n) nes.buttonUp(1, p.b); }
  nes.frame();
  if (last && (shots.has(f) || (every && f % every === 0))) png(last, path.join(out, `f${String(f).padStart(5, '0')}.png`));
}
const ms = performance.now() - t0;
if (wav) {
  const n = audio.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(audio[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(wav, b);
}
console.log(`${frames} frames in ${ms.toFixed(0)}ms (${(frames / (ms / 1000)).toFixed(0)} fps emulated)`);
