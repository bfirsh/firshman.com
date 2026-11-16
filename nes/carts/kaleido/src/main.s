; =====================================================================================
;  KALEIDO  -  an NES demo (MMC5): symmetry and infinity, to an original toccata and fugue
;  Engine core: reset, NMI, IRQ, the ExRAM writers that race the beam, timeline, helpers.
;
;  Every part draws in MMC5 extended-attribute mode: each of the 960 background tiles picks its
;  own 4 KB CHR bank and palette from ExRAM. The CPU rewrites all 960 ExRAM bytes every frame:
;  rows 15-29 for this frame before the beam reaches line 120, rows 0-14 for the next frame
;  after it has passed line 120 (an MMC5 scanline IRQ tells the main thread). Two writers:
;    LUT   ex = lut[phase[tile]] | q[page]   (phase maps in ROM, a 256-byte table built per frame)
;    COPY  ex = frame[tile]                  (precalculated ExRAM frames streamed from ROM)
; =====================================================================================
.include "defs.inc"
.include "assets.inc"

.import music_init, music_play
.importzp music_frame, music_order, music_row, music_events, music_notes
.import music_songframe, ch_note

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte 8                 ; 8 x 16 KB PRG
  .byte 32                ; 32 x 8 KB CHR (256 KB)
  .byte $50               ; mapper 5
  .byte $00
  .byte 1                 ; 8 KB PRG-RAM
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
nmi_count: .res 1
seen: .res 1
mid_flag: .res 1
top_flag: .res 1
irq_state: .res 1
nmi_mode: .res 1          ; 1 = loading: NMI leaves the PPU alone
cur_a000: .res 1          ; shadow of $5115 (the data window)
ppu_ctrl: .res 1          ; for the frame being prepared (NMI applies it)
ppu_mask: .res 1
vt: .res 2                ; song frame of the frame being prepared (0..SONG_LEN-1)
part: .res 1              ; part of vt ($FF = none)
pt: .res 2                ; vt - part start
ev: .res 1                ; music_events of the last tick
notes: .res 1             ; music_notes of the last tick
rng: .res 2
fade: .res 1              ; signed palette brightness -4..+4
flash: .res 1             ; extra brightness, in quarter steps, decaying (cuts between parts)
; writer parameters: wb_* drive this frame's bottom half, wn_* the next frame's top half
wb_type: .res 1           ; 0 LUT, 1 COPY
wb_bank: .res 1           ; data bank (phase map or frame)
wb_lut: .res 1            ; LUT page ($03 / $04)
wb_src: .res 1            ; COPY: high byte of the frame
wn_type: .res 1
wn_bank: .res 1
wn_lut: .res 1
wn_src: .res 1
wbq: .res 4               ; LUT writer: bank bits ORed in per 256-tile page (bottom half)
wq: .res 4                ; ... for the next frame (parts set these)
wsrc: .res 2
lutsel: .res 1            ; LUT page being built ($03 / $04)
; nametable upload (64 bytes per NMI)
nt_left: .res 1
nt_bank: .res 1
nt_src: .res 2
nt_dst: .res 2
pv: .res 24               ; part variables
oam_i: .res 1
; glints
NGL = 8
gl_x: .res NGL
gl_y: .res NGL
gl_age: .res NGL

.segment "OAM"
oam: .res 256

.segment "BSS"
pal_buf: .res 32
pal_src: .res 32

LUT3 = $0300
LUT4 = $0400

; ------------------------------------------------------------------ vectors, CHR
.segment "VECTORS"
  .word nmi, reset, irq

.segment "CHARS"
  .incbin "chr.bin"

; ------------------------------------------------------------------ data banks
; Each phase map sits at $A000 of its own bank (the LUT writer reads it at a fixed address).
.segment "DATA00"
phi_rrad: .incbin "phi_rrad.bin"
nt_seq:   .incbin "nt_seq.bin"
nt_kal:   .incbin "nt_kal.bin"
nt_julia: .incbin "nt_julia.bin"
.segment "DATA01"
phi_rang: .incbin "phi_rang.bin"
ex_tun:   .incbin "ex_tun.bin"
ex_tun2:  .incbin "ex_tun2.bin"
.segment "DATA02"
phi_rspi: .incbin "phi_rspi.bin"
.segment "DATA03"
phi_kring: .incbin "phi_kring.bin"
.segment "DATA04"
phi_kspi: .incbin "phi_kspi.bin"
.segment "DATA07"
phi_kmask: .incbin "phi_kmask.bin"
.segment "DATA05"
ex_julia0: .incbin "ex_julia.bin", 0, 8192
.segment "DATA06"
ex_julia8: .incbin "ex_julia.bin", 8192
DB_RRAD = 0
DB_NT = 0
DB_RANG = 1
DB_TUN = 1
DB_RSPI = 2
DB_KRING = 3
DB_KSPI = 4
DB_JULIA = 5
DB_KMASK = 7

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
  sta MMC5_PRGMODE
  sta MMC5_CHRMODE
  lda #2
  sta MMC5_RAMPROT1
  lda #1
  sta MMC5_RAMPROT2
  lda #0
  sta MMC5_PRG6
  sta MMC5_CHRHI
  sta MMC5_SPLIT
  sta MMC5_IRQSTAT
  lda #$80 | 13
  sta MMC5_PRG8
  lda #$80 | 0
  sta MMC5_PRGA
  sta cur_a000
  lda #$80 | 14
  sta MMC5_PRGC
  lda #%01000100          ; NT0 = CIRAM A, NT1 = CIRAM B (and mirrors)
  sta MMC5_NTMAP
  ; sprites: 8x8 from $1000; tiles 0..63 = the first 1 KB of CHR bank SPR
  lda #CHR_SPR * 4
  sta MMC5_CHR0+4
  sta MMC5_CHR0+5
  sta MMC5_CHR0+6
  sta MMC5_CHR0+7
  bit PPUSTATUS
: bit PPUSTATUS
  bpl :-
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
  ; ExRAM: every tile -> the blank bank
  lda #EX_RAM
  sta MMC5_EXMODE
  lda #CHR_BLANK
  ldx #0
: sta EXRAM,x
  sta EXRAM+$100,x
  sta EXRAM+$200,x
  sta EXRAM+$300,x
  inx
  bne :-
: bit PPUSTATUS
  bpl :-
  ; palettes black, nametable A = the rose window layout
  lda #$3F
  sta PPUADDR
  lda #0
  sta PPUADDR
  ldx #32
  lda #$0F
: sta PPUDATA
  dex
  bne :-
  ldx #31
: sta pal_buf,x
  sta pal_src,x
  dex
  bpl :-
  lda #DB_NT
  jsr set_a000
  lda #$20
  ldx #<nt_seq
  ldy #>nt_seq
  jsr load_nt_now
  lda #$24
  ldx #<nt_seq
  ldy #>nt_seq
  jsr load_nt_now
  lda #EX_ATTR
  sta MMC5_EXMODE
  lda #$A5
  sta rng
  sta rng+1
  lda #$FF
  sta part
  lda #<(SONG_LEN - 1)
  sta vt
  lda #>(SONG_LEN - 1)
  sta vt+1
  lda #0
  jsr music_init
  lda #%10001000          ; NMI, sprites at $1000, NT0
  sta ppu_ctrl
  sta PPUCTRL
  lda #%00011110
  sta ppu_mask
  cli

; ------------------------------------------------------------------ main loop
main_loop:
: lda nmi_count
  cmp seen
  beq :-
  sta seen
  ; ExRAM only takes writes while the PPU renders: wait for line 1
: lda top_flag
  beq :-
  lda #0
  sta top_flag
  jsr write_bottom        ; ExRAM rows 15-29 for the frame on screen now
  lda #1
  sta $4018               ; (timing marker for tools/timing.mjs; ignored by the APU)
  ; the next frame: advance the song clock, pick its part, run its logic
  inc vt
  bne :+
  inc vt+1
: lda vt
  cmp #<SONG_LEN
  lda vt+1
  sbc #>SONG_LEN
  bcc :+
  lda #0
  sta vt
  sta vt+1
:
  jsr timeline
  jsr part_logic          ; fills wn_*, the LUT, pal_buf, OAM for the next frame
  lda #2
  sta $4018
  ; wait for the beam to pass line 120, then write the next frame's top half
: lda mid_flag
  beq :-
  lda #0
  sta mid_flag
  jsr write_top
  lda #3
  sta $4018
  ; the next frame's bottom half uses the same parameters
  lda wn_type
  sta wb_type
  lda wn_bank
  sta wb_bank
  lda wn_lut
  sta wb_lut
  lda wn_src
  sta wb_src
  ldx #3
: lda wq,x
  sta wbq,x
  dex
  bpl :-
  jmp main_loop

; Pick the part for vt; call its init on a change; compute pt.
timeline:
  ldx #NUM_PARTS-1
@find:
  lda vt+1
  cmp part_start_hi,x
  bcc @next
  bne @found
  lda vt
  cmp part_start_lo,x
  bcs @found
@next:
  dex
  bpl @find
  ldx #0
@found:
  sec
  lda vt
  sbc part_start_lo,x
  sta pt
  lda vt+1
  sbc part_start_hi,x
  sta pt+1
  cpx part
  beq @same
  stx part
  lda part_init_hi,x
  pha
  lda part_init_lo,x
  pha
@same:
  rts

part_logic:
  ldx part
  lda part_logic_hi,x
  pha
  lda part_logic_lo,x
  pha
  rts

; ------------------------------------------------------------------ NMI
nmi:
  pha
  txa
  pha
  tya
  pha
  lda nmi_mode
  beq :+
  jmp @noppu
: lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  ; palette
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  .repeat 32, i
  lda pal_buf+i
  sta PPUDATA
  .endrepeat
  ; progressive nametable upload
  lda nt_left
  beq @nont
  lda nt_bank
  ora #$80
  sta MMC5_PRGA
  lda nt_dst+1
  sta PPUADDR
  lda nt_dst
  sta PPUADDR
  ldy #0
: lda (nt_src),y
  sta PPUDATA
  iny
  lda (nt_src),y
  sta PPUDATA
  iny
  cpy #64
  bne :-
  lda cur_a000
  sta MMC5_PRGA
  clc
  lda nt_src
  adc #64
  sta nt_src
  bcc :+
  inc nt_src+1
: clc
  lda nt_dst
  adc #64
  sta nt_dst
  bcc :+
  inc nt_dst+1
: dec nt_left
@nont:
  bit PPUSTATUS
  lda #0
  sta PPUSCROLL
  sta PPUSCROLL
  lda ppu_ctrl
  sta PPUCTRL
  lda ppu_mask
  sta PPUMASK
@noppu:
  lda MMC5_IRQSTAT        ; acknowledge anything stale
  lda #0
  sta irq_state
  sta top_flag
  lda #2                  ; line 1: the frame has started
  sta MMC5_IRQLINE
  lda #$80
  sta MMC5_IRQSTAT
  cli
  jsr music_play
  lda music_events
  ora ev
  sta ev
  lda music_notes
  ora notes
  sta notes
  inc nmi_count
  pla
  tay
  pla
  tax
  pla
  rti

irq:
  pha
  lda MMC5_IRQSTAT
  lda irq_state
  bne :+
  inc irq_state
  inc top_flag
  lda #121                ; next: line 120, the beam is past the top half
  sta MMC5_IRQLINE
  pla
  rti
: lda #1
  sta mid_flag
  pla
  rti

; ------------------------------------------------------------------ ExRAM writers
PHI = $A000

.macro LUTSEG P, XS, XE, LUT, Q
  .local loop
  ldx #XS
loop:
  .repeat 8, i
  ldy PHI + P*256 + i, x
  lda LUT, y
  ora Q + P
  sta EXRAM + P*256 + i, x
  .endrepeat
  txa
  clc
  adc #8
  tax
  .if XE <> 0
  cpx #XE
  .endif
  bne loop
.endmacro

.macro COPYSEG P, YS, YE
  .local loop
  ldy #YS
loop:
  .repeat 8
  lda (wsrc), y
  sta EXRAM + P*256, y
  iny
  .endrepeat
  .if YE <> 0
  cpy #YE
  .endif
  bne loop
.endmacro

; rows 15-29 = tiles 480..959: page 1 from 224, page 2, page 3 to 191
write_bottom:
  lda wb_bank
  jsr set_a000
  lda wb_type
  beq :+
  jmp wb_copy
: lda wb_lut
  cmp #>LUT3
  beq :+
  jmp wb_l4
:
  LUTSEG 1, 224, 0, LUT3, wbq
  LUTSEG 2, 0, 0, LUT3, wbq
  LUTSEG 3, 0, 192, LUT3, wbq
  rts
wb_l4:
  LUTSEG 1, 224, 0, LUT4, wbq
  LUTSEG 2, 0, 0, LUT4, wbq
  LUTSEG 3, 0, 192, LUT4, wbq
  rts
wb_copy:
  lda #0
  sta wsrc
  ldx wb_src
  inx
  stx wsrc+1
  COPYSEG 1, 224, 0
  inc wsrc+1
  COPYSEG 2, 0, 0
  inc wsrc+1
  COPYSEG 3, 0, 192
  rts

; rows 0-14 = tiles 0..479: page 0, page 1 to 223
write_top:
  lda wn_bank
  jsr set_a000
  lda wn_type
  beq :+
  jmp wt_copy
: lda wn_lut
  cmp #>LUT3
  beq :+
  jmp wt_l4
:
  LUTSEG 0, 0, 0, LUT3, wq
  LUTSEG 1, 0, 224, LUT3, wq
  rts
wt_l4:
  LUTSEG 0, 0, 0, LUT4, wq
  LUTSEG 1, 0, 224, LUT4, wq
  rts
wt_copy:
  lda #0
  sta wsrc
  lda wn_src
  sta wsrc+1
  COPYSEG 0, 0, 0
  inc wsrc+1
  COPYSEG 1, 0, 224
  rts

; ------------------------------------------------------------------ helpers
set_a000:
  ora #$80
  sta cur_a000
  sta MMC5_PRGA
  rts

; Load 1 KB nametable now (rendering off): A = PPU address high, Y:X = source (data window).
load_nt_now:
  sta PPUADDR
  lda #0
  sta PPUADDR
  stx ptr0
  sty ptr0+1
  ldx #4
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  rts

; Queue a 1 KB nametable upload over the next 16 NMIs: A = data bank, Y:X = source, t0 = PPU hi.
queue_nt:
  sta nt_bank
  stx nt_src
  sty nt_src+1
  lda #0
  sta nt_dst
  lda t0
  sta nt_dst+1
  lda #16
  sta nt_left
  rts

; 16-bit LFSR -> A
rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

; Writer setup helpers (next frame): LUT with phase bank A; COPY from bank A, high byte X.
use_lut:
  sta wn_bank
  lda #0
  sta wn_type
  lda lutsel
  sta wn_lut
  rts
use_copy:
  sta wn_bank
  stx wn_src
  lda #1
  sta wn_type
  rts

; Point ptr1 at the LUT page to build (the one the bottom writer is not using this frame).
lut_begin:
  lda wb_lut
  cmp #>LUT3
  beq :+
  lda #>LUT3
  bne :++
: lda #>LUT4
: sta lutsel
  sta ptr1+1
  lda #0
  sta ptr1
  rts

; Recompute pal_buf from pal_src with fade (-4..+4 luma steps) plus the decaying flash.
apply_fade:
  lda flash
  beq :+
  dec flash
: lsr a
  lsr a
  clc
  adc fade
  bmi :+
  cmp #5
  bcc :+
  lda #4
: sta t2
  ldx #31
@l:
  lda pal_src,x
  ldy t2
  beq @store
  sta t0
  and #$0F
  sta t1                  ; hue
  cmp #$0D
  lda #$FF                ; black hues count as luma -1
  bcs :+
  lda t0
  lsr a
  lsr a
  lsr a
  lsr a                   ; luma 0..3
: clc
  adc t2
  bmi @black
  cmp #4
  bcs @white
  asl a
  asl a
  asl a
  asl a
  ora t1
  cmp #$0D                ; $0D is "blacker than black": avoid
  bne @store
@black:
  lda #$0F
  bne @store
@white:
  lda #$30
@store:
  sta pal_buf,x
  dex
  bpl @l
  rts

; Hide all sprites.
oam_clear:
  lda #$F8
  ldx #0
: sta oam,x
  inx
  inx
  inx
  inx
  bne :-
  rts

; 8x8 multiply with the MMC5: A * X -> A (hi), Y (lo)
mul8:
  sta MMC5_MULA
  stx MMC5_MULB
  ldy MMC5_MULA
  lda MMC5_MULB
  rts

.segment "CODE"
.include "parts.s"
