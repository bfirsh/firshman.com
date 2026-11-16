; =====================================================================================
;  CAUSTIC  -  an NES demo about light under water (MMC5)
;
;  Engine core: reset, NMI, the cycle-timed raster kernel, the ExRAM streamer, palettes.
;
;  The picture is one static nametable in MMC5 extended-attribute mode. Every 8x8 tile gets
;  its 4 KB CHR bank (= a moment of a 128-frame precalculated light animation) and its palette
;  from ExRAM, which the streamer rewrites a quarter of the screen at a time, so each tile
;  flows through time on its own (see tools/assets.py). On top, a raster kernel re-aims the
;  PPU on every scanline from 24 to 207 (fine X, coarse X, Y), computing two horizontal and one
;  vertical sine displacement per line in real time, and sets the colour emphasis per line.
; =====================================================================================
.include "defs.inc"

.import music_init, music_play
.importzp music_frame, music_order, music_row, music_events

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte 4                 ; 4 x 16 KB PRG (64 KB)
  .byte 49                ; 49 x 8 KB CHR (392 KB)
  .byte $50               ; mapper 5
  .byte $00
  .byte 1
  .byte 0,0,0,0,0,0,0

; ------------------------------------------------------------------ zero page
.segment "ZEROPAGE"
t0: .res 1
t1: .res 1
t2: .res 1
t3: .res 1
t4: .res 1
t5: .res 1
t6: .res 1
t7: .res 1
ptr0: .res 2
ptr1: .res 2
ptr2: .res 2
nmi_count: .res 1
nmi_ready: .res 1
kdone: .res 1           ; set by the kernel when it has finished this frame's lines
ken: .res 1             ; 1 = run the raster kernel
pal_dirty: .res 1
ppu_ctrl: .res 1
chr_half: .res 1        ; $5130: which 256 KB half of CHR the ExRAM banks address
band_bank: .res 1       ; PRG bank of the streamer at $C000
lag: .res 1
buttons: .res 1
buttons_new: .res 1
rng: .res 2
irq_vec: .res 2
; kernel parameters (read by the kernel; the part writes them between kernels)
kp1: .res 1             ; phases of the three displacement sines
kp2: .res 1
kp3: .res 1
kxb: .res 1             ; base horizontal scroll
ktmp: .res 1
kzero: .res 1
kms: .res 1             ; emphasis pattern scroll (line offset)
kmt: .res 2             ; emphasis pattern page (low byte 0)
kmask: .res 1
; sine-page pointers: ks<component>_<taper level 0..4>; low bytes always 0
ks1_0: .res 2
ks1_1: .res 2
ks1_2: .res 2
ks1_3: .res 2
ks1_4: .res 2
ks2_0: .res 2
ks2_1: .res 2
ks2_2: .res 2
ks2_3: .res 2
ks2_4: .res 2
ks3_0: .res 2
ks3_1: .res 2
ks3_2: .res 2
ks3_3: .res 2
ks3_4: .res 2
; streamer
tfrac: .res 1           ; animation time T (8.8), integer part wraps at 256
tint: .res 1
tlast: .res 1
tspeed: .res 2          ; 8.8, at most 1.0
zstage: .res 1          ; dissolve stage 0..7 (world bit flips as tiles cross)
zrun: .res 1            ; 1 = dissolving: zstage steps at every time wrap
; timeline
tl_frame: .res 2
part: .res 1
part_t: .res 2
amp1: .res 1            ; displacement amplitudes in px (0..23), set by parts
amp2: .res 1
amp3: .res 1
pv: .res 48             ; part scratch

.exportzp t0, t1, t2, t3, ptr0, ptr1

; ------------------------------------------------------------------ RAM
.segment "OAM"
oam: .res 256

.segment "BSS"
pal_buf: .res 32

; ------------------------------------------------------------------ vectors
.segment "VECTORS"
  .word nmi, reset, irq

.segment "CHARS"
  .incbin "chr.bin"

; =====================================================================================
.segment "CODE"

reset:
  sei
  cld
  ldx #$FF
  txs
  inx
  stx PPUCTRL
  stx PPUMASK
  stx $4010
  lda #$40
  sta $4017
  lda #3
  sta MMC5_PRGMODE        ; 4 x 8 KB
  sta MMC5_CHRMODE        ; 8 x 1 KB (sprites)
  lda #2
  sta MMC5_RAMPROT1
  lda #1
  sta MMC5_RAMPROT2
  lda #0
  sta MMC5_PRG6
  sta MMC5_SPLIT
  sta MMC5_IRQSTAT
  sta MMC5_NTMAP          ; all four nametables -> CIRAM page A
  lda #$80 | 0
  sta MMC5_PRG8
  lda #$80 | 1
  sta MMC5_PRGA
  lda #$80 | BANK_BOOT
  sta MMC5_PRGC
  ; sprites: CHR 1 KB banks 384..387 (after the three worlds)
  lda #1
  sta MMC5_CHRHI
  lda #128
  sta MMC5_CHR0+4
  lda #129
  sta MMC5_CHR0+5
  lda #130
  sta MMC5_CHR0+6
  lda #131
  sta MMC5_CHR0+7
  lda #0
  sta MMC5_CHRHI
  sta chr_half
  lda #EX_RAM
  sta MMC5_EXMODE
: bit PPUSTATUS
  bpl :-
  ; clear RAM
  lda #0
  tax
: sta $00,x
  sta $0300,x
  sta $0400,x
  sta $0500,x
  sta $0600,x
  inx
  bne :-
  lda #$F8
: sta oam,x
  inx
  bne :-
  ; sine pages -> PRG-RAM
  lda #<boot_sine
  sta ptr0
  lda #>boot_sine
  sta ptr0+1
  lda #<SINE
  sta ptr1
  lda #>SINE
  sta ptr1+1
  ldx #AMP_MAX+1+8         ; sine pages, then the emphasis pages
  ldy #0
: lda (ptr0),y
  sta (ptr1),y
  iny
  bne :-
  inc ptr0+1
  inc ptr1+1
  dex
  bne :-
: bit PPUSTATUS
  bpl :-
  ; nametable (static for the whole demo) and palettes
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #4
  lda #<boot_nt
  sta ptr0
  lda #>boot_nt
  sta ptr0+1
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #32
  lda #$0F
: sta PPUDATA
  sta pal_buf-1,x
  dex
  bne :-
  ; first ExRAM picture (RAM mode accepts writes any time)
  lda #2
  sta band_bank
  ora #$80
  sta MMC5_PRGC
  lda #0
  sta tint
  sta tfrac
  sta zstage
  jsr stream_all
  lda #EX_ATTR
  sta MMC5_EXMODE
  lda #0
  sta kmt
  sta kms
  lda #>EMPH
  sta kmt+1
  ; kernel: flat
  jsr kernel_flat
  lda #$A5
  sta rng
  sta rng+1
  lda #$FF
  sta part
  sta tl_frame
  sta tl_frame+1
  lda #0
  jsr music_init
  lda #1
  sta ken
  lda #%10001000          ; NMI, sprites at $1000, 8x8
  sta ppu_ctrl
  sta PPUCTRL
  cli

main_loop:
  ; the kernel ends at line KBOT: from here to the end of the picture is the streamer's window
: lda kdone
  beq :-
  lda #0
  sta kdone
  jsr stream
  jsr read_pad
  jsr timeline
  jsr part_frame
  lda #1
  sta nmi_ready
  jmp main_loop

; ------------------------------------------------------------------ NMI
nmi:
  pha
  txa
  pha
  tya
  pha
  lda nmi_ready
  bne :+
  inc lag
  jmp @noup
: lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  lda pal_dirty
  bne :+
  jmp @nopal
: lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  .repeat 32, i
  lda pal_buf+i
  sta PPUDATA
  .endrepeat
  lda #0
  sta pal_dirty
@nopal:
  lda #0
  sta nmi_ready
@noup:
  lda chr_half
  sta MMC5_CHRHI
  bit PPUSTATUS
  lda #0
  sta PPUADDR
  sta PPUADDR
  lda kxb
  sta PPUSCROLL
  lda #0
  sta PPUSCROLL
  lda ppu_ctrl
  sta PPUCTRL
  lda kms
  clc
  adc #KTOP
  tay
  lda (kmt),y
  sta PPUMASK
  ; arm the raster kernel
  lda MMC5_IRQSTAT
  lda ken
  beq @nok
  lda #<kentry
  sta irq_vec
  lda #>kentry
  sta irq_vec+1
  lda #KTOP-3
  sta MMC5_IRQLINE
  lda #$80
  sta MMC5_IRQSTAT
  bne @k
@nok:
  lda #0
  sta MMC5_IRQSTAT
  lda #1
  sta kdone
@k:
  cli
  jsr music_play
  inc tl_frame
  bne :+
  inc tl_frame+1
:
  lda music_events
  and #$02
  beq @nopat
  ldx music_order
  lda order_frame_lo,x
  sta tl_frame
  lda order_frame_hi,x
  sta tl_frame+1
@nopat:
  inc nmi_count
  pla
  tay
  pla
  tax
  pla
  rti

; ------------------------------------------------------------------ IRQ / raster kernel

irq:
  jmp (irq_vec)

; First IRQ (end of line KTOP-4): park the CPU in a NOP sled so that the next IRQ lands with
; at most one cycle of jitter.
kentry:
  pha
  txa
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda #KTOP-2
  sta MMC5_IRQLINE
  lda #<ksync
  sta irq_vec
  lda #>ksync
  sta irq_vec+1
  cli
ksled:
  .repeat 100
  nop
  .endrepeat
  jmp ksled

.segment "KERNEL"
; nop chain for KDELAY: jsr nops_end - k costs 12 + 2k cycles
nops:
  .repeat 48
  nop
  .endrepeat
nops_end:
  rts

.macro KDELAY n
  .local r
  r .set n
  .assert r <> 1, error, "KDELAY 1"
  .if (r & 1) = 1
    bit kzero
    r .set r - 3
  .endif
  .if r >= 12
    jsr nops_end - ((r - 12) / 2)
  .else
    .repeat r / 2
      nop
    .endrepeat
  .endif
.endmacro

KPRO = 79               ; tuned with tools/probe.mjs: the critical $2005 lands at dot ~270

; Second IRQ (end of line KTOP-3), from the sled.
ksync:
  lda MMC5_IRQSTAT
  lda #0
  sta MMC5_IRQLINE
  KDELAY KPRO
  .include "kernel.inc"
  pla                     ; drop the sled's interrupt frame
  pla
  pla
  lda #1
  sta kdone
  pla
  tay
  pla
  tax
  pla
  rti

; Point every sine pointer at the zero page (no displacement).
kernel_flat:
  lda #0
  sta amp1
  sta amp2
  sta amp3
  ; fall through
; Set the 15 sine pointers from amp1..3 (0..AMP_MAX), with the taper levels 0, 1/4, 1/2, 3/4, 1.
kernel_amps:
  lda #0
  ldx #28
: sta ks1_0,x
  dex
  dex
  bpl :-
  ldx #0                  ; component offset in the pointer block (0, 10, 20)
  lda amp1
  jsr @one
  ldx #10
  lda amp2
  jsr @one
  ldx #20
  lda amp3
@one:
  sta t0
  lda #>SINE
  sta ks1_0+1,x
  lda t0
  lsr a
  lsr a
  clc
  adc #>SINE
  sta ks1_1+1,x           ; 1/4
  lda t0
  lsr a
  clc
  adc #>SINE
  sta ks1_2+1,x           ; 1/2
  lda t0
  lsr a
  sta t1
  lsr a
  clc
  adc t1
  adc #>SINE
  sta ks1_3+1,x           ; 3/4
  lda t0
  clc
  adc #>SINE
  sta ks1_4+1,x
  rts

.segment "CODE"

; ------------------------------------------------------------------ ExRAM streamer
; Advance animation time by tspeed; on every whole step, rewrite the band (a quarter of the
; screen) whose turn it is. Runs in the window after the kernel, while the PPU still renders.
stream:
  clc
  lda tfrac
  adc tspeed
  sta tfrac
  lda tint
  adc tspeed+1
  sta tint
  cmp tlast
  bne :+
  rts
: sta tlast
  and #$3F                ; (a whole time wrap is a multiple of 64)
  bne @nowrap
  lda zrun
  beq @nowrap
  lda zstage
  cmp #7
  bcs @nowrap
  inc zstage
@nowrap:
  lda tint
  and #3
  tax
  ; fall through
; X = band (0..3): rewrite it for the current time and dissolve stage
stream_band:
  lda tint
  lsr a
  lsr a
  and #31
  sta t0
  lda zstage
  asl a
  asl a
  asl a
  asl a
  asl a
  ora t0
  tay
  txa
  asl a
  tax
  lda $C800,x
  sta ptr2
  lda $C801,x
  sta ptr2+1
  jmp (ptr2)

; Rewrite all four bands (at init, or under a white-out).
stream_all:
  ldx #0
  jsr stream_band
  ldx #1
  jsr stream_band
  ldx #2
  jsr stream_band
  ldx #3
  jmp stream_band

; ------------------------------------------------------------------ helpers
read_pad:
  lda buttons
  sta t0
  lda #1
  sta JOY1
  lda #0
  sta JOY1
  ldx #8
: lda JOY1
  lsr a
  rol buttons
  dex
  bne :-
  lda t0
  eor #$FF
  and buttons
  sta buttons_new
  rts

rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

.segment "RODATA"
.align 256
LOX:
  .repeat 256, i
  .byte i >> 3
  .endrepeat
LOY:
  .repeat 256, i
  .byte (i << 2) & $E0
  .endrepeat

.segment "BOOT"
.include "boot.inc"

.include "parts.s"

.include "band0.inc"
.include "band1.inc"
.include "band2.inc"
.include "band3.inc"
