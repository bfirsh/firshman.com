; =====================================================================================
;  RUSH  -  an NES demo (MMC5)
;  Engine core: reset, NMI, the per-scanline kernels, palettes, timeline.
;
;  Picture: lines KS..KE-1 (176 lines, letterboxed; the player's cover-crop hides the bars).
;  Kernel effects (bars, twister, floor) rewrite the PPU's scroll on EVERY line: the first IRQ
;  parks the CPU in a sled; each line's MMC5 scanline IRQ then computes that line's source
;  row (and, for the twister and the floor, a CHR bank) in constant time and lands the
;  $2005/$2006 writes in the horizontal blank. The tunnel streams precalculated CHR frames
;  with a few band-switch IRQs instead.
; =====================================================================================
.include "defs.inc"
.segment "RODATA"
.include "assets.inc"
; IRQ line to arm while setting up line y: y itself, 0 once the picture is complete
ktarget:
  .repeat 256, i
  .if i >= KS && i < KE
  .byte i
  .else
  .byte 0
  .endif
  .endrepeat
.segment "DATA"
nt_a_img: .incbin "nta.bin"
nt_b_img: .incbin "ntb.bin"
ex_img:   .incbin "exr.bin"
.segment "CODE"

; Busy-wait exactly n cycles (n >= 2).
.macro KDELAY n
  .if (n) .mod 2
  bit $00
  .repeat ((n) - 3) / 2
  nop
  .endrepeat
  .else
  .repeat (n) / 2
  nop
  .endrepeat
  .endif
.endmacro

.import music_init, music_play
.importzp music_frame, music_order, music_row, music_events, music_cue
.import music_songframe

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte 2                 ; 2 x 16 KB PRG
  .byte CHR_BANKS8        ; x 8 KB CHR
  .byte $50               ; mapper 5
  .byte $00
  .byte 1                 ; 8 KB PRG-RAM
  .byte 0,0,0,0,0,0,0

.segment "CHARS"
  .incbin "chr.bin"

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
nmi_ready: .res 1        ; main sets 1 when OAM / palette / tables for the next frame are complete
ppu_ctrl: .res 1
ppu_mask: .res 1
pal_dirty: .res 1
rng: .res 2
ev_acc: .res 1           ; music events OR-ed since main last looked
tl_frame: .res 2         ; song position (0..SONG_LEN-1), from the driver
fx: .res 1               ; current effect (FX_*)
fx_next: .res 1          ; effect the next frame is set up for
seg: .res 1              ; timeline segment
seg_t: .res 2            ; frames since the segment started
irq_vec: .res 2
kbuf: .res 1             ; which table buffer the kernel reads (0/1)
kflip: .res 1            ; main: 1 = the other buffer is complete, swap at NMI
lag_count: .res 1        ; frames where main was not ready at NMI (diagnostics)

; kernel state
kl: .res 1               ; screen line the current IRQ is setting up
kxp: .res 2              ; -> X scroll table for this frame
kyp: .res 2              ; -> source row table for this frame
kx: .res 1
kt: .res 1
klo: .res 1
; frame parameters: kf_* are used by this frame's IRQs, nf_* are written by main for the next
; frame and copied at NMI (when main finished it). Same layout.
KF_SIZE = 15
kf_hi: .res 1            ; $2006 high byte (nametable select) for table-driven lines
kf_x: .res 1             ; twister: fine X (constant per frame)
kf_xc: .res 1            ; twister: X >> 3
kf_a0: .res 1            ; twister: angle offset
kf_tpo: .res 1           ; twister: bend phase offset
kf_bank0: .res 1         ; slot-0 CHR bank for line KS
kf_mulb: .res 1          ; multiplier operand B for the frame (twister: twist rate)
kf_mask: .res 1          ; PPUMASK during the picture
kf_vec: .res 2           ; per-line handler
kf_entry: .res 2         ; the frame's first IRQ handler
kf_first: .res 1         ; and its line
kf_aux: .res 1           ; effect specific
kf_ntmap: .res 1         ; nametable map for the frame
nf_hi: .res KF_SIZE
nf_x = nf_hi + (kf_x - kf_hi)
nf_xc = nf_hi + (kf_xc - kf_hi)
nf_a0 = nf_hi + (kf_a0 - kf_hi)
nf_tpo = nf_hi + (kf_tpo - kf_hi)
nf_bank0 = nf_hi + (kf_bank0 - kf_hi)
nf_mulb = nf_hi + (kf_mulb - kf_hi)
nf_mask = nf_hi + (kf_mask - kf_hi)
nf_vec = nf_hi + (kf_vec - kf_hi)
nf_entry = nf_hi + (kf_entry - kf_hi)
nf_first = nf_hi + (kf_first - kf_hi)
nf_aux = nf_hi + (kf_aux - kf_hi)
nf_ntmap = nf_hi + (kf_ntmap - kf_hi)
; effect state
fx_vars: .res 48
fv = fx_vars

; ------------------------------------------------------------------ RAM
.segment "OAM"
oam: .res 256

.segment "BSS"
pal_src: .res 32         ; palette before brightness
pal_buf: .res 32         ; palette as uploaded
bright: .res 1           ; -4..+4 brightness steps applied to pal_src
bright_cur: .res 1
oam_i: .res 1

.segment "WRAM"
ybuf0: .res 256          ; per-line source row, buffer 0
ybuf1: .res 256
xbuf0: .res 256          ; per-line X scroll, buffer 0
xbuf1: .res 256
grow0: .res 256          ; floor: per-line source rows (sky part rewritten per frame), buffer 0
grow1: .res 256
k_grid: .res 128         ; the floor's per-line handler, copied from ROM; operands patched per frame
curve_f: .res CURVE_N * CURVE_STRIDE   ; floor curves (computed at reset)
curve_c: .res CURVE_N * CURVE_STRIDE

; ------------------------------------------------------------------ vectors
.segment "VECTORS"
  .word nmi, reset, irq

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
  ; MMC5: 8 KB PRG banks, 1 KB CHR banks, PRG-RAM writable
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
  lda #$80 | 0
  sta MMC5_PRG8
  lda #$80 | 1
  sta MMC5_PRGA
  lda #$80 | 2
  sta MMC5_PRGC
  ; nametables: $2000 CIRAM A, $2400 CIRAM B, $2800 ExRAM, $2C00 fill (blank tile)
  lda #NTMAP_T
  sta MMC5_NTMAP
  lda #T_BLANK
  sta MMC5_FILLTILE
  lda #0
  sta MMC5_FILLATTR
  lda #EX_RAM
  sta MMC5_EXMODE
  jsr set_common_chr
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
: bit PPUSTATUS
  bpl :-
  ; load the three nametables (rendering is off)
  lda #$20
  ldx #<nt_a_img
  ldy #>nt_a_img
  jsr load_nt
  lda #$24
  ldx #<nt_b_img
  ldy #>nt_b_img
  jsr load_nt
  ldx #0
: lda ex_img,x
  sta EXRAM,x
  lda ex_img+$100,x
  sta EXRAM+$100,x
  lda ex_img+$200,x
  sta EXRAM+$200,x
  lda ex_img+$300,x
  sta EXRAM+$300,x
  inx
  bne :-
  lda #EX_NT              ; ExRAM is now the third nametable
  sta MMC5_EXMODE
  ; black palette
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
: sta pal_src,x
  sta pal_buf,x
  dex
  bpl :-
  lda #$A5
  sta rng
  sta rng+1
  jsr ram_init
  jsr lanes_init
  jsr parts_init
  jsr parts_hide
  lda #$A5
  sta rng
  sta rng+1
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #$FF
  sta seg
  sta fx
  sta fx_next
  sta d_seg
  lda #0
  jsr music_init
  lda #%10001000 | NT_FILL >> 2  ; NMI on, sprites at $1000, BG at $0000, top of frame on the fill nametable
  sta ppu_ctrl
  sta PPUCTRL
  lda #%00011110
  sta ppu_mask
  sta nf_mask
  lda #<irq_ack
  sta nf_entry
  sta kf_entry
  lda #>irq_ack
  sta nf_entry+1
  sta kf_entry+1
  cli

; ------------------------------------------------------------------ main loop
main_loop:
  lda nmi_count
: cmp nmi_count
  beq :-
  jsr director
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
  inc lag_count
  jmp @late
:
  lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  lda pal_dirty
  beq :+
  jsr upload_palette
: lda #0
  sta nmi_ready
  ; swap the table buffers and take the next frame's kernel values
  lda kflip
  beq :+
  lda kbuf
  eor #1
  sta kbuf
  lda #0
  sta kflip
: lda fx_next
  sta fx
  ldx #KF_SIZE-1
: lda nf_hi,x
  sta kf_hi,x
  dex
  bpl :-
  lda fx
  cmp #FX_GRID
  bne @late
  jsr grid_patch
@late:
  ; frame top: letterbox (kernel effects: blank rows of nametable B; tunnel: the fill nametable)
  lda kf_ntmap
  sta MMC5_NTMAP
  bit PPUSTATUS
  lda #0
  sta PPUSCROLL
  ldx #96
  ldy #%10001010          ; NT 2 (B): rows 12+
  lda kf_ntmap
  cmp #NTMAP_K
  beq :+
  ldx #0
  ldy #%10001011          ; NT 3 (fill)
: stx PPUSCROLL
  sty PPUCTRL
  lda ppu_mask
  sta PPUMASK
  jsr set_common_chr
  ; the first IRQ of the frame
  lda kf_entry
  sta irq_vec
  lda kf_entry+1
  sta irq_vec+1
  lda MMC5_IRQSTAT
  lda kf_first
  sta MMC5_IRQLINE
  lda #$80
  sta MMC5_IRQSTAT
  cli                     ; raster IRQs may interrupt the music driver
  jsr music_play
  lda music_events
  ora ev_acc
  sta ev_acc
  lda music_songframe
  sta tl_frame
  lda music_songframe+1
  sta tl_frame+1
  inc nmi_count
  pla
  tay
  pla
  tax
  pla
  rti

upload_palette:
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  .repeat 32, i
  lda pal_buf+i
  sta PPUDATA
  .endrepeat
  lda #0
  sta pal_dirty
  rts

; Background slots 0-3 = blank + common tiles; sprites slots 4-7.
set_common_chr:
  lda #0
  sta MMC5_CHR0
  lda #1
  sta MMC5_CHR0+1
  lda #2
  sta MMC5_CHR0+2
  lda #3
  sta MMC5_CHR0+3
  lda #4
  sta MMC5_CHR0+4
  lda #5
  sta MMC5_CHR0+5
  lda #6
  sta MMC5_CHR0+6
  lda #7
  sta MMC5_CHR0+7
  rts

; A = PPU address high byte, X/Y = source: copy 1024 bytes.
load_nt:
  stx ptr0
  sty ptr0+1
  sta PPUADDR
  lda #0
  sta PPUADDR
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

; ------------------------------------------------------------------ IRQ dispatch
irq:
  jmp (irq_vec)
irq_ack:
  pha
  lda MMC5_IRQSTAT
  pla
  rti

; =====================================================================================
;  The per-line kernel
; =====================================================================================
; Entry: IRQ at line KS-2. Saves the main thread's registers, arms line KS-1 and parks the CPU
; in the sled with interrupts on. Every line's handler sets up line kl, arms the next line from
; ktarget (0 after the last line) and increments kl; the sled leaves when kl passes KE.
k_entry:
  pha
  txa
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda #KS-1
  sta MMC5_IRQLINE
  lda #KS
  sta kl
  lda kf_mulb
  sta MMC5_MULB
  lda kf_bank0
  sta MMC5_CHR0
  lda kbuf                ; table pointers for this frame's buffer
  clc
  adc #>ybuf0
  sta kyp+1
  adc #>(xbuf0 - ybuf0)
  sta kxp+1
  lda #0
  sta kyp
  sta kxp
  lda kf_vec
  sta irq_vec
  lda kf_vec+1
  sta irq_vec+1
  bit PPUSTATUS
  cli
k_sled:
  lda kl
  cmp #KE+1
  bne k_sled
  ; line KE is set up (black): keep the rest of the frame on blank rows (nametable B row 13)
  lda #NT_B | 1
  sta PPUADDR
  lda #$A0
  sta PPUADDR
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  pla
  tay
  pla
  tax
  pla
  rti

; ---- bars / title: source row and X scroll from the tables (nametable khi)
; Cycle counts from the handler's first cycle; the critical pair lands in the horizontal blank.
k_bars:
  lda MMC5_IRQSTAT        ; 4   4   acknowledge
  ldy kl                  ; 3   7
  lda ktarget,y           ; 4  11
  sta MMC5_IRQLINE        ; 4  15   next IRQ (0 after the last line)
  lda (kxp),y             ; 5  20
  sta kx                  ; 3  23
  lsr a                   ; 2  25
  lsr a                   ; 2  27
  lsr a                   ; 2  29
  sta kt                  ; 3  32
  lda (kyp),y             ; 5  37
  tax                     ; 2  39
  lda lo_of_y,x           ; 4  43
  ora kt                  ; 3  46
  tay                     ; 2  48
  lda kf_hi               ; 3  51
  sta PPUADDR             ; 4  55
  stx PPUSCROLL           ; 4  59   source y
  ldx kx                  ; 3  62
  inc kl                  ; 5  67
  KDELAY 8                ;    75
  stx PPUSCROLL           ; 4  79   fine x   (dot ~ 40 + 3 * cycle: 277)
  sty PPUADDR             ; 4  83   v = t    (289)
  rti                     ; 6  89   (+ 7 entry, 5 dispatch, ~1 sled = 102 of the line's 113.7)



.include "kernels.s"
.include "fx.s"
