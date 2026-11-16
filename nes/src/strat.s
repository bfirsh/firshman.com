; =====================================================================================
;  BREAKDOWN + REBUILD  (song 5376..7167)  "stratosphere"
;  Black sky, the curve of the Earth (an extended-attribute bitmap), stars that twinkle on
;  the lead's notes. The balloon swells as the air thins (three sizes of big metasprite);
;  in the Rebuild the sun clears the limb with a lens flare tracking through the centre of
;  the screen; in the break before the climax the balloon strains and shivers.
; =====================================================================================

.segment "BANK06"
.include "strat.inc"
earth_nt: .incbin "earth_nt.bin"
earth_ex: .incbin "earth_ex.bin"

ST_T0 = 5376
st_t     = pv+0          ; 16-bit
st_sx    = pv+2
st_sy    = pv+3
st_tw    = pv+4          ; twinkling star index
st_twt   = pv+5          ; frames left
st_bx    = pv+6
st_by    = pv+7

strat_init:
  jsr ppu_off
  lda #<earth_nt
  sta ptr0
  lda #>earth_nt
  sta ptr0+1
  lda #<earth_ex
  sta ptr2
  lda #>earth_ex
  sta ptr2+1
  jsr load_bitmap
  lda #SPACE_SPR
  jsr set_sprite_chr
  lda #0
  sta scroll_x
  sta scroll_y
  sta st_twt
  lda #$FC
  sta fade
  lda #<strat_palette
  sta ptr0
  lda #>strat_palette
  sta ptr0+1
  jsr set_palette
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #0
  sta irq_first
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

strat_frame:
  sec
  lda tl_frame
  sbc #<ST_T0
  sta st_t
  lda tl_frame+1
  sbc #>ST_T0
  sta st_t+1
  ; ---- fade in over 64 frames
  lda st_t+1
  bne @nofade
  lda st_t
  cmp #80
  bcs @nofade
  lsr a
  lsr a
  lsr a
  lsr a
  sec
  sbc #4
  cmp fade
  beq @nofade
  sta fade
  jsr apply_fade
@nofade:
  jsr oam_clear
  lda st_t+1
  cmp #>1792
  bcc @before
  bne :+
  lda st_t
  cmp #<1792
  bcc @before
: jsr st_burst
  jmp @nosunchk
@before:
  ; ---- balloon: rises from y=140 to ~100, swelling
  lda st_t
  sta t0
  lda st_t+1
  sta t1
  ; y = 140 - t/48 (t/16/3 approx: t/64 + t/256)
  lsr t1
  ror t0
  lsr t1
  ror t0
  lsr t1
  ror t0
  lsr t1
  ror t0
  lsr t1
  ror t0
  lsr t1
  ror t0                  ; t/64
  lda #140
  sec
  sbc t0
  sta st_by
  lda #128
  sta st_bx
  ; strain: shiver in the last 112 frames (t >= 1680)
  lda st_t+1
  cmp #>1680
  bcc @noshake
  bne :+
  lda st_t
  cmp #<1680
  bcc @noshake
: jsr rand
  and #3
  sec
  sbc #1
  clc
  adc st_bx
  sta st_bx
  jsr rand
  and #1
  clc
  adc st_by
  sta st_by
@noshake:
  ; size: bal0 until 896, bal1 until 1300, then bal2
  ldx #0
  lda st_t+1
  cmp #>896
  bcc @sz
  bne :+
  lda st_t
  cmp #<896
  bcc @sz
: inx
  lda st_t+1
  cmp #>1300
  bcc @sz
  bne :+
  lda st_t
  cmp #<1300
  bcc @sz
: inx
@sz:
  lda st_bal_lo,x
  sta ptr0
  lda st_bal_hi,x
  sta ptr0+1
  lda st_bx
  sta t0
  lda st_by
  sta t1
  lda #0
  sta t3
  sta t4
  jsr draw_meta
@nosunchk:
  ; ---- the sun and its flare (Rebuild on: t >= 896)
  lda st_t+1
  cmp #>896
  bcc @nosun
  bne :+
  lda st_t
  cmp #<896
  bcc @nosun
: sec
  lda st_t
  sbc #<896
  sta t0
  lda st_t+1
  sbc #>896
  sta t1
  ; sy = 140 - (t-896)/16
  ldx #4
: lsr t1
  ror t0
  dex
  bne :-
  lda #140
  sec
  sbc t0
  sta st_sy
  lda #206
  sta st_sx
  jsr st_flares
@nosun:
  ; ---- stars, one twinkling on each lead note
  lda ev_acc
  and #$20
  beq :+
  jsr rand
  and #15
  sta st_tw
  lda #10
  sta st_twt
: lda #0
  sta ev_acc
  lda st_twt
  beq :+
  dec st_twt
: ldx #0
@st:
  stx t8
  lda st_star_x,x
  sta t0
  lda st_star_y,x
  sta t1
  lda #0
  sta t3
  sta t4
  lda #<meta_sstar1
  sta ptr0
  lda #>meta_sstar1
  sta ptr0+1
  cpx st_tw
  bne :+
  lda st_twt
  beq :+
  lda #<meta_sstar2
  sta ptr0
  lda #>meta_sstar2
  sta ptr0+1
:
  jsr draw_meta
  ldx t8
  inx
  cpx #14
  bne @st
  rts

; ---- the burst (song 7168..7615): flash, shreds of latex flying, the payload falling until
;      its parachute opens.
st_burst:
  sec
  lda st_t
  sbc #<1792
  sta t9                  ; u = frames since the burst (< 448)
  lda st_t+1
  sbc #>1792
  sta t10
  ; flash: fade +4 at the hit, back to 0 over 40 frames
  lda t10
  bne @nofl
  lda t9
  cmp #40
  bcs @nofl
  lsr a
  lsr a
  lsr a
  eor #$FF
  sec
  adc #4
  cmp fade
  beq @nofl
  sta fade
  jsr apply_fade
@nofl:
  ; fragments for the first 128 frames
  lda t10
  bne @nofrag
  lda t9
  bmi @nofrag
  ldx #0
@fr:
  stx t8
  ; x = 128 + vx*u/16
  lda st_fvx,x
  ldx t9
  jsr st_smul16
  clc
  adc #128
  sta t0
  ; y = 92 + vy*u/16 + u*u/512
  ldx t8
  lda st_fvy,x
  ldx t9
  jsr st_smul16
  clc
  adc #108
  sta t1
  lda t9
  tax
  jsr mul8                ; u*u -> A hi
  lsr a
  clc
  adc t1
  sta t1
  lda #0
  sta t3
  sta t4
  lda t8
  and #3
  tax
  lda st_frag_lo,x
  sta ptr0
  lda st_frag_hi,x
  sta ptr0+1
  ; skip if it has left the screen (wrapped)
  lda t1
  cmp #232
  bcs :+
  jsr draw_meta
: ldx t8
  inx
  cpx #10
  bne @fr
@nofrag:
  ; payload: falls (folded chute) for 100 frames, then the parachute opens and it drifts
  lda t10
  bne @open
  lda t9
  cmp #100
  bcs @open
  tax
  jsr mul8
  lsr a                   ; u*u/512
  clc
  adc #112
  sta t1
  lda #<meta_chute_s
  sta ptr0
  lda #>meta_chute_s
  sta ptr0+1
  lda #128
  sta t0
  jmp @dr
@open:
  ; y = 131 + (u-100)/8 (clamped), x drifts right
  lda t9
  sec
  sbc #100
  sta t2
  lda t10
  sbc #0
  lsr a
  ror t2
  lsr a
  ror t2
  lsr a
  ror t2
  lda t2
  clc
  adc #126
  cmp #170
  bcc :+
  lda #170
: sta t1
  lda t2
  lsr a
  clc
  adc #128
  sta t0
  lda #<meta_chute
  sta ptr0
  lda #>meta_chute
  sta ptr0+1
@dr:
  lda #0
  sta t3
  sta t4
  jmp draw_meta

; signed A * X / 16 -> A (|result| < 128)
st_smul16:
  cmp #$80
  php
  bcc :+
  eor #$FF
  adc #0
: jsr mul8                ; A hi, Y lo
  sty t2
  lsr a
  ror t2
  lsr a
  ror t2
  lsr a
  ror t2
  lsr a
  ror t2
  lda t2
  plp
  bcc :+
  eor #$FF
  clc
  adc #1
: rts

st_fvx: .byte 20, <-22, 34, <-30, 8, <-12, 40, <-38, 26, <-6
st_fvy: .byte <-30, <-26, <-10, <-14, <-40, <-36, 6, 2, 18, 22
st_frag_lo: .byte <meta_frag0, <meta_frag1, <meta_frag2, <meta_frag3
st_frag_hi: .byte >meta_frag0, >meta_frag1, >meta_frag2, >meta_frag3

st_bal_lo: .byte <meta_bal0, <meta_bal1, <meta_bal2
st_bal_hi: .byte >meta_bal0, >meta_bal1, >meta_bal2
st_star_x: .byte 24, 60, 98, 150, 186, 222, 40, 120, 170, 236, 14, 84, 204, 132
st_star_y: .byte 20, 44, 14, 30, 58, 24, 92, 70, 100, 84, 128, 118, 140, 40

; Sun at (st_sx, st_sy) and three ghosts along the line through the screen centre.
st_flares:
  lda #<meta_sunbig
  sta ptr0
  lda #>meta_sunbig
  sta ptr0+1
  lda st_sx
  sta t0
  lda st_sy
  sta t1
  lda #0
  sta t3
  sta t4
  ldx oam_i
  stx t7
  jsr draw_meta
  ; behind the background: only shows against black space, so it rises from behind the Earth
  ldx t7
: cpx oam_i
  beq :+
  lda oam+2,x
  ora #$20
  sta oam+2,x
  inx
  inx
  inx
  inx
  bne :-
:
  ; d = centre - sun (signed 8-bit; |d| < 128)
  lda #128
  sec
  sbc st_sx
  sta t9
  lda #112
  sec
  sbc st_sy
  sta t10
  ldx #0
@g:
  stx t8
  ; ghost k at sun + d*f_k, f = 3/4, 5/4, 7/4  (sum of halves and quarters)
  lda t9
  jsr st_scale
  clc
  adc st_sx
  sta t0
  lda t10
  jsr st_scale
  clc
  adc st_sy
  sta t1
  lda #0
  sta t3
  sta t4
  ldx t8
  lda st_fl_lo,x
  sta ptr0
  lda st_fl_hi,x
  sta ptr0+1
  jsr draw_meta
  ldx t8
  inx
  cpx #3
  bne @g
  rts

; A signed -> A * f[t8] where f = 0.75, 1.25, 1.75
st_scale:
  sta t2
  cmp #$80
  ror a
  sta t5                  ; d/2
  cmp #$80
  ror a
  sta t6                  ; d/4
  ldx t8
  beq @f0
  dex
  beq @f1
  ; 1.75 = 2d - d/4
  lda t2
  asl a
  sec
  sbc t6
  rts
@f0:
  lda t5
  clc
  adc t6
  rts
@f1:
  lda t2
  clc
  adc t6
  rts

st_fl_lo: .byte <meta_flare1, <meta_flare0, <meta_flare2
st_fl_hi: .byte >meta_flare1, >meta_flare0, >meta_flare2
