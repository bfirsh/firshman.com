; =====================================================================================
;  TITLE  (song 0..447, "Ground" intro)
;  The chrome logo is an extended-attribute bitmap. Every scanline from 62 to 175 is
;  re-pointed by the raster kernel: the logo unfolds from a single line (per-line vertical
;  zoom), sways with a decaying per-line sine, then a mirrored, rippling, blue-emphasised
;  reflection grows beneath it. All of it is one picture and per-line scroll registers.
; =====================================================================================

.segment "BANK01"
.include "title.inc"
title_nt: .incbin "title_nt.bin"
title_ex: .incbin "title_ex.bin"

TI_S = TI_YC - TI_HALF   ; first kernel line
TI_N = 2*TI_HALF + 1 + TI_RMAX
TI_YC = 92              ; logo centre on screen
TI_SRC_C = 40           ; logo centre in the picture
TI_HALF = 21
TI_BLANK = 150         ; a black picture row
TI_REFL_Y = TI_YC + TI_HALF + 1
TI_RMAX = 40            ; reflection lines
TI_DARK = 56            ; the darkened copy of the logo sits 56 rows below it

ti_invz = pv+0          ; 64/zoom (64 = full size)
ti_amp  = pv+1          ; sway amplitude
ti_line = pv+2
ti_ph   = pv+3
ti_rl   = pv+4          ; reflection length (lines)

title_init:
  jsr ppu_off
  lda #EX_RAM
  sta MMC5_EXMODE
  lda #<title_nt
  sta ptr0
  lda #>title_nt
  sta ptr0+1
  jsr load_nt
  lda #<title_ex
  sta ptr0
  lda #>title_ex
  sta ptr0+1
  jsr load_ex
  lda #EX_ATTR
  sta MMC5_EXMODE
  ldx #0
: txa
  clc
  adc #GROUND_SPR
  sta MMC5_CHR0+4,x
  inx
  cpx #4
  bne :-
  lda #0
  sta fade
  sta scroll_x
  lda #122                ; lines above the kernel show black rows 122..192
  sta scroll_y
  lda #<title_palette
  sta ptr0
  lda #>title_palette
  sta ptr0+1
  jsr set_palette
  ; raster kernel on both buffers: start all blank
  lda #TI_S
  sta rk_start
  lda #TI_N
  sta rk_count
  lda #0
  sta rk_after
  lda #<rk_irq
  ldy #>rk_irq
  jsr set_kernel
  jsr ti_blank_all
  lda #1
  sta rk_flip
  WAIT_NMI
  jsr ti_blank_all
  lda #TI_S-2
  sta irq_first
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

ti_blank_all:
  jsr rk_begin
  lda #0
  sta t9
  lda #%00011110
  sta t10
  ldy #TI_S
: lda #TI_BLANK
  jsr rk_put
  iny
  cpy #TI_S+TI_N
  bne :-
  rts

title_frame:
  jsr rk_begin
  ; zoom: invz = 64/zoom from the unfold table; 0 lines before t=60
  lda part_t+1
  bne @full
  lda part_t
  cmp #60
  bcs :+
  jmp @allblank
: sec
  sbc #60
  cmp #128
  bcs @full
  tax
  lda ti_zoom,x
  bne @setz
@full:
  lda #64
@setz:
  sta ti_invz
  ; sway: sin >> shift, the shift growing as the logo settles (+-32 .. +-2)
  ldx #6
  lda part_t+1
  bne :+
  lda part_t
  sec
  sbc #60
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..6 over (t-60)/32
  clc
  adc #2
  cmp #6
  bcs :+
  tax
: stx ti_amp
  ; reflection grows after t=180
  lda part_t+1
  bne @rfull
  lda part_t
  sec
  sbc #180
  bcs :+
  lda #0
: lsr a
  cmp #TI_RMAX
  bcc :+
@rfull:
  lda #TI_RMAX
: sta ti_rl
  lda nmi_count
  asl a
  asl a
  sta ti_ph

  ; ---- logo lines: centre +- 21
  ldy #TI_YC - TI_HALF
@logo:
  sty ti_line
  tya
  sec
  sbc #TI_YC              ; d (signed)
  ldx ti_invz
  cpx #64
  beq @ident
  ; scaled: |d| * invz / 64
  cmp #$80                ; carry = negative
  php
  bcc :+
  eor #$FF
  adc #0
: sta MMC5_MULA
  stx MMC5_MULB
  lda MMC5_MULB
  cmp #$40
  bcs @blank1
  sta t2
  lda MMC5_MULA
  asl a
  rol t2
  asl a
  rol t2
  lda t2
  cmp #TI_HALF+1
  bcs @blank1
  plp
  bcc :+
  eor #$FF
  adc #0
: ; fallthrough with A = scaled d (signed)
@ident:
  clc
  adc #TI_SRC_C
  pha
  ; x = sin(line*5 + ph) >> shift
  tya
  asl a
  asl a
  adc ti_line
  adc ti_ph
  tax
  lda sin_tab,x
  ldx ti_amp
: cmp #$80
  ror a
  dex
  bne :-
  sta t9
  pla
  jsr rk_put
  jmp @lnext
@blank1:
  plp
  lda #0
  sta t9
  lda #TI_BLANK
  jsr rk_put
@lnext:
  ldy ti_line
  iny
  cpy #TI_YC + TI_HALF + 1
  bne @logo

  ; ---- reflection lines below
@refl:
  sty ti_line
  tya
  sec
  sbc #TI_REFL_Y
  sta t1                  ; dd
  cmp ti_rl
  bcs @rblank
  ; ripple: sin(dd*20 - 2ph) * dd / 512
  asl a
  asl a
  adc t1
  asl a
  asl a
  sec
  sbc ti_ph
  sbc ti_ph
  tax
  lda sin_tab,x
  jsr ti_dmul
  clc
  adc #TI_SRC_C+TI_HALF+TI_DARK
  sec
  sbc t1
  pha
  lda t1
  asl a
  asl a
  asl a
  adc ti_ph
  tax
  lda sin_tab,x
  jsr ti_dmul
  sta t9
  pla
  jsr rk_put
  jmp @rnext
@rblank:
  lda #0
  sta t9
  lda #TI_BLANK
  jsr rk_put
@rnext:
  ldy ti_line
  iny
  cpy #TI_S+TI_N-1
  bne @refl
  ; last line: a black row, so everything below stays black
  lda #0
  sta t9
  lda #TI_BLANK
  jsr rk_put
  lda #1
  sta rk_flip
  jmp @fx

@allblank:
  jsr ti_blank_all
  lda #1
  sta rk_flip

@fx:
  ; ---- fade out at the end
  lda part_t
  ldx part_t+1
  beq @nofade
  cmp #<(400-256)
  bcc @nofade
  sec
  sbc #<(400-256)
  lsr a
  lsr a
  lsr a
  cmp #5
  bcc :+
  lda #4
: eor #$FF
  clc
  adc #1
  cmp fade
  beq @nofade
  sta fade
  jsr apply_fade
@nofade:
  ; ---- stars behind the logo (straight into OAM: cheaper than metasprites)
  jsr oam_clear
  ldx #0
  ldy #0
@st:
  lda ti_star_y,x
  sta oam,y
  txa
  asl a
  asl a
  asl a
  adc nmi_count
  and #63
  cmp #5
  lda #GSTAR1_TILE
  bcs :+
  lda #GSTAR2_TILE
: sta oam+1,y
  lda #$23
  sta oam+2,y
  lda ti_star_x,x
  sta oam+3,y
  iny
  iny
  iny
  iny
  inx
  cpx #20
  bne @st
  rts

ti_star_x: .byte 20, 50, 77, 103, 140, 170, 200, 230, 37, 62, 120, 155, 190, 222, 15, 90, 130, 180, 210, 245
ti_star_y: .byte 30, 52, 22, 40, 18, 46, 28, 60, 180, 200, 214, 186, 205, 172, 130, 150, 160, 140, 125, 196

; signed A * t1 (dd) / 512 -> signed A, via the MMC5 multiplier
ti_dmul:
  cmp #$80
  bcc @p
  eor #$FF
  adc #0
  sta MMC5_MULA
  lda t1
  sta MMC5_MULB
  lda MMC5_MULB
  lsr a
  eor #$FF
  clc
  adc #1
  rts
@p:
  sta MMC5_MULA
  lda t1
  sta MMC5_MULB
  lda MMC5_MULB
  lsr a
  rts

; A = |d| -> A = |d| * invz / 64, saturating to $FF
ti_scale:
  ldx ti_invz
  jsr mul8                ; A = hi, Y = lo
  cmp #$40
  bcs @sat
  sta t2
  tya
  asl a
  rol t2
  asl a
  rol t2
  lda t2
  rts
@sat:
  lda #$FF
  rts

; A = phase -> A = sin(phase) * amp / 128 (signed)
ti_sway:
  tax
  lda sin_tab,x
  ldx ti_amp
  ; fall through
; signed A * unsigned X / 128 -> signed A
ti_smul:
  cmp #$80
  bcc @pos
  eor #$FF
  adc #0                  ; carry set: +1 -> negate
  jsr mul8
  sty t2
  asl t2
  rol a
  eor #$FF
  clc
  adc #1
  rts
@pos:
  jsr mul8
  sty t2
  asl t2
  rol a
  rts

