# Cartridge music: sync sheet

Song 0, **"Ascent"**. Everything below is exact: the driver is frame-locked and never changes tempo.
Home key E minor; the climax modulates up a whole tone (F# minor); the outro falls back home and the
song loops seamlessly to the top.

## Tempo

| | |
| --- | --- |
| Frames per row | **7** (constant, the whole song) |
| Rows per pattern | **64** (4 bars of 16 rows; a row is a 16th note) |
| Frames per beat / bar / pattern | 28 / 112 / **448** |
| BPM | 128.8 (NTSC: 60.0988 frames/s) |
| Song length | 22 patterns = **9,856 frames** = 2:44.0 |
| Loop point | order 0 (frame 0): the song restarts from the top, seamlessly |

## How the sync variables count

- Before the first `music_play`, `music_frame` is `$FFFF`. The first call plays song tick 0, so
  **after each call `music_frame` is the tick that call just played** (first call: 0).
- In the first pass, `music_frame == music_order * 448 + music_row * 7 + (frames into the row)`.
- `music_frame` keeps counting across the loop (9856, 9857, ...) and wraps at 65536. For the position
  inside the song use `music_order`/`music_row`, or the extra export `music_songframe` (16-bit, in the
  music RAM page, resets to 0 on the tick the song loops).
- `music_order`/`music_row` are 0 straight after `music_init` and always describe the row being played.
- `music_events` holds flags for the tick just played only:
  - bit0 new row (every 7 frames), bit1 new pattern (every 448), bit7 song looped (frame 9856, 19712, ...;
    set together with bit0 and bit1; the very first frame has bit0+bit1 only).
  - bit2 **kick**: DPCM kick or boom, and the triangle kick (a pitch dive on every bass beat from order 4).
  - bit3 **snare**: DPCM snare or noise snare. bit4 **hat**: noise hi-hats.
  - bit5 **lead note-on**: pulse 1 melody notes (not the intro's broken-chord pad).
  - bit6 **bass note-on**: triangle notes (including the kick-into-bass notes).
  - Verified frame-exact against the score by `tools/verify.py` (210 kick, 192 snare, 420 hat, 380 lead,
    599 bass events per pass).

## Sections

Start frame = order × 448. One bar = 112 frames. Times assume 60.0988 fps.

| Order | Start frame | Time | Section | What happens |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0:00.0 | **Ground** (intro) | Warm broken-chord pad (Em, C) with a dotted-8th echo on pulse 2. Fades in over 4 bars. No drums. |
| 1 | 448 | 0:07.5 | Ground | Pad (Em, D). A thin radio "beacon" on pulse 2 beeps morse "UP" twice. |
| 2 | 896 | 0:14.9 | **Lift-off** | Soft echoing melody enters; triangle bass pulses; soft off-beat hats. |
| 3 | 1344 | 0:22.4 | Lift-off | Melody continues, hats double. |
| 4 | 1792 | 0:29.8 | **Climb** | Drums start: DPCM kick on 1 & 3, DPCM + noise snare on 2 & 4, triangle kick on every beat, octave bass, arpeggiated chord stabs, melody A. |
| 5 | 2240 | 0:37.3 | Climb | |
| 6 | 2688 | 0:44.7 | **Build** | Kick on every beat, teaser phrases of the main theme; from frame 2912 a snare roll that crescendos. |
| 7 | 3136 | 0:52.2 | Build | Roll in 8ths, then 16ths (frame 3360); 16th arpeggio run. **Break at frame 3472**: drums and bass stop, the lead holds a note that bends up an octave like a siren over a noise riser, then a 4-note pickup. |
| 8 | 3584 | 0:59.6 | **DROP 1** | Big hit on frame 3584 (DPCM boom + noise crash). Main theme, galloping triangle bass, syncopated chord stabs. |
| 9 | 4032 | 1:07.1 | Drop 1 | |
| 10 | 4480 | 1:14.5 | Drop 1 | Crash on frame 4480; pulse 2 switches from chords to a dub echo of the lead. |
| 11 | 4928 | 1:22.0 | Drop 1 | Last bar (frame 5264): snare fill. |
| 12 | 5376 | 1:29.5 | **Breakdown** ("stratosphere") | Drums out. The theme at half speed with a long echo, slow breathing bass pulses, soft noise "wind". |
| 13 | 5824 | 1:36.9 | Breakdown | Pulse 2 turns into high sparkling arpeggios. |
| 14 | 6272 | 1:44.4 | **Rebuild** | Kick returns; the theme on a thin 12.5% pulse that opens up bar by bar; snare roll from frame 6496. |
| 15 | 6720 | 1:51.8 | Rebuild | Same as order 7: roll, 16th run. **Break at frame 7056** (siren bend + riser). |
| 16 | 7168 | 1:59.3 | **CLIMAX** ("edge of space") | Big hit on frame 7168. Main theme a whole tone higher, doubled by a detuned unison on pulse 2 (a fat, chorused lead). |
| 17 | 7616 | 2:06.7 | Climax | |
| 18 | 8064 | 2:14.2 | Climax | Crash on frame 8064; pulse 2 now shadows the lead an octave up, a 16th behind (shimmer). |
| 19 | 8512 | 2:21.6 | Climax | Final bar (frame 8848): big ending hit (boom + crash), the lead slides up onto a long held note. |
| 20 | 8960 | 2:29.1 | **Descent** (outro) | Back in E minor: the intro pad and echo, bass thinning out, a few hats. |
| 21 | 9408 | 2:36.5 | Descent | Pad fading down, beacon morse again; loops to order 0 at frame 9856. |

Highlights for choreography: drops at **3584** and **7168** (pattern starts with the boom); breaks of
near silence (riser only, lead bending up) at **3472–3583** and **7056–7167**; crashes at 4480 and 8064;
final hit at 8848; breakdown 5376–6271; loop at 9856 (the intro texture continues straight through).

## Notes for the demo

- DPCM drums play in orders 4–11 and 14–19. Each DMC sample byte costs a 4-cycle DMA steal (about one
  every 320–420 CPU cycles while a sample plays), so cycle-counted raster code can jitter by a few cycles
  in those sections. MMC5 scanline-IRQ splits are unaffected. The samples are in segment `DPCM`, which
  must stay mapped whenever music plays (DMA can fetch at any time).
- `music_init` writes `$4017 = $40` (frame IRQ off), `$4011` (DMC rest level) and never enables the
  DMC IRQ. The driver never touches PPU, banking, IRQ or MMC5 registers. The MMC5 expansion audio is not
  used: JSNES 3.0.0 stores its registers but does not mix it into the output (checked with a probe ROM).
- `music_play` costs at most **1,746 CPU cycles** (measured over two full passes of the song in JSNES,
  DMA steals included; mean 737). It uses zero page `$E0–$F4` and RAM `$0700–$07E5`.
