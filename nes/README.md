# Cartridge: an NES demo for firshman.com

An original demoscene production that is a real NES ROM, running in [JSNES](https://github.com/bfirsh/jsnes)
(Ben's emulator) full screen through a CRT shader at `/ideas/cartridge`.

Three parts are built in parallel against this contract. Don't change the contract without
saying so loudly in your report.

| Part | Owner | Files |
| --- | --- | --- |
| Demo ROM (visuals, engine, build) | demo builder | `nes/src/`, `nes/tools/` (except `run.mjs`), `nes/build.sh`, `nes/demo.cfg`, `src/components/ideas/cartridge/demo.nes` (output) |
| Music (driver + original tune) | music builder | `nes/music/` |
| Web player (JSNES + CRT + audio) | player builder | `src/pages/ideas/cartridge.astro`, `src/components/ideas/cartridge/` (except `demo.nes`) |

## Toolchain
- `ca65`/`ld65` (cc65 2.19) are installed at `/usr/bin`. If the container restarts: `apt-get install -y cc65`.
- `jsnes@3.0.0` is installed in `node_modules`. It emulates CPU, PPU and APU cycle by cycle and passes all
  134 AccuracyCoin tests, so cycle-timed raster code behaves as on hardware.
- Headless runner: `node nes/tools/run.mjs <rom> --frames N --shots 60,120 --every K --out dir --wav file.wav --press "frame:BUTTON:len"`.
  It emulates at roughly 500–700 fps, writes true-pixel 256×240 PNGs and an optional 48 kHz mono WAV.
- `nes/build.sh` (demo builder) assembles everything and writes `src/components/ideas/cartridge/demo.nes`.
  The built ROM is committed, because the site's host has no cc65. Keep the ROM file ≤ 512 KB so the page loads fast.

## Hardware target
- **Mapper: MMC5 (iNES mapper 5).** JSNES implements PRG/CHR banking (1 KB CHR banks), 1 KB ExRAM
  (including extended attribute mode: a palette and 4 KB CHR bank per 8×8 tile), the scanline IRQ,
  the 8×8 hardware multiplier, vertical split mode, and the expansion audio (2 pulses + PCM).
- At power-on only $E000–$FFFF ($5117 = $FF) can be relied on: reset code and vectors live in the last 8 KB.
- NTSC, 60 Hz. Aim for everything to be real-hardware plausible; if an effect relies on JSNES-specific
  behaviour, note it.

## Music interface (`nes/music/music.s`, currently a stub)
- `music_init` (A = song number), `music_play` (once per frame, from NMI, after time-critical PPU work), `music_stop`.
- Sync, zero page, exported: `music_frame` (16-bit frames since init), `music_order` (section/pattern
  index), `music_row` (row in pattern), `music_events` (this frame only: bit0 new row, bit1 new pattern,
  bit2 kick, bit3 snare, bit4 hat, bit5 lead note-on, bit6 bass note-on, bit7 song looped).
- Reserved for music only: zero page `$E0–$FF` (segment `MUSIC_ZP`), RAM `$0700–$07FF` (segment `MUSIC_BSS`).
- Code and data: segment `MUSIC` (≤ 12 KB), which the demo's linker config maps to a window that is always
  visible when NMI runs. DPCM samples: segment `DPCM` (≤ 4 KB), placed by the demo in $C000–$FFFF on a 64-byte boundary.
- The music module never touches PPU registers, MMC5 banking or IRQ registers, and it may use the APU and
  the MMC5 expansion audio registers ($5000–$5015). Worst-case `music_play` ≤ 2,000 CPU cycles.
- `nes/music/SYNC.md` documents the song's tempo (frames per row, constant), section list with start
  frames, and highlights (drops, breaks), so the demo can choreograph parts to the music.
  The demo drives its timeline from `music_frame`/`music_order`, so sync is exact.

## Screen and framing
- The player fills the whole browser window ("cover"), so edges get cropped. On a 16:10 laptop roughly the
  central 180 scanlines show; keep anything essential within x 32–224, y 40–200. Still draw the full
  256×240 frame: the crop varies by window.
- The player adds the CRT look (scanlines, mask, bloom, curvature). Don't fake scanlines in the ROM.

## Spirit
Ben's words: "I just want to make something cool that's a bit personal... cool on its own." "Make it a NES ROM
and run it on JSNES... full screen... CRT effects. Make it INCREDIBLY beautiful and impressive, try and do
things that were not thought possible on the NES." It's not a website or a portfolio: no bio, no links in the
ROM. A demo can still be signed and personal (Ben helped start UKHAS, amateur balloons to near space; he made
Spacelog, the Apollo transcripts; he wrote JSNES itself). Everything must be original: no copied demos,
games, graphics or music.
