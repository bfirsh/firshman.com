; =====================================================================================
;  STRIPES  (pre-chorus: Am9 | D13 | F#m7b5 | B7#9)   and   BUILD (the drum build)
;  Op-art: vertical stripes whose widths swell across the screen, bent by a sine "current"
;  running down the screen (per-line X from the kernel's wave tables) whose amplitude grows
;  through the section; kicks push the current. Every horn stab knocks alternate 8-line bands
;  apart on a spring; each bar's chord repaints the stripes; the picture slowly zooms in.
;  BUILD: the same machine, revving: the current runs faster and faster, the palette strobes
;  dark on every snare, and the last beat (the break) goes black.
; =====================================================================================

.segment "BANK02"
stripes_nt: .incbin "stripes_nt.bin"

ST_JOLT = 0               ; spring: horn jolt
ST_BALL = 1               ; spring: disc bounce

st_pos   = $6800          ; 24 band positions (8.8): lo at +0, hi at +24
st_t     = sv+0
st_bar   = sv+1
st_zoom  = sv+2           ; 8.8 step decrement (lo)
st_zoomh = sv+3
st_speed = sv+4           ; speed multiplier
st_flash = sv+5
st_ph    = sv+6
st_strobe = sv+7
st_j1    = sv+8           ; jolt values of the last two fills
st_j2    = sv+9

stripes_init:
  jsr k_defaults
  lda #EX_RAM
  jsr set_exmode
  lda #<pal_stripes
  ldx #>pal_stripes
  jsr load_pal
  lda #8
  sta st_bg
  lda #9
  sta st_bg+1
  lda #10
  sta st_bg+2
  lda #11
  sta st_bg+3
  lda #0
  sta k_xtb+1               ; X offsets from the band buffer
  sta st_t
  sta st_zoom
  sta st_zoomh
  sta st_flash
  lda #$FF
  sta st_bar
  lda #2
  sta osk+ST_JOLT
  lda #3
  sta osd+ST_JOLT
  ldx #47
  lda #0
: sta st_pos,x
  dex
  bpl :-
  lda #2
  sta st_speed
  lda #0
  sta st_ph
  lda #$80
  sta st_j1
  sta st_j2
  rts


stripes_frame:
  inc st_t
  ; chord: repaint at each bar
  lda music_row
  lsr a
  lsr a
  lsr a
  lsr a
  cmp st_bar
  beq :+
  sta st_bar
  asl a
  sta t0
  asl a
  adc t0                    ; *6
  tax
  lda stripe_chord_pals,x
  sta pal_buf+1
  lda stripe_chord_pals+1,x
  sta pal_buf+2
  lda stripe_chord_pals+2,x
  sta pal_buf+3
  lda stripe_chord_pals+3,x
  sta pal_buf+5
  lda stripe_chord_pals+4,x
  sta pal_buf+6
  lda stripe_chord_pals+5,x
  sta pal_buf+7
  lda #1
  sta pal_dirty
: lda evn2
  and #$02                  ; horn stab: jolt the bands apart
  beq :+
  lda #40
  ldx #ST_JOLT
  jsr osc_kick
: lda evn
  and #$04                  ; kick: push the current
  beq :+
  lda #3
  sta st_flash
: ldx #ST_JOLT
  jsr osc_step
  ; the current: a sine running down the stripes, its amplitude growing through the section
  lda ord_t+1
  asl a
  asl a
  asl a
  sta t0
  lda ord_t
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  ora t0                    ; ord_t / 32: 0..17
  lsr a
  lsr a
  clc
  adc #2
  cmp #7
  bcc :+
  lda #7
: sta t5                    ; amplitude index 2..7
  lda st_flash
  beq :+
  dec st_flash
  inc st_ph
  inc st_ph
: lda st_ph
  clc
  adc st_speed
  sta st_ph
  tay
  lda t5
  jsr k_wobble
  ; horn jolts: alternate 8-line bands left and right (both buffers rewritten only while it moves)
  lda osp_hi+ST_JOLT
  cmp st_j1
  bne :+
  cmp st_j2
  beq @nofill
: ldx st_j1
  stx st_j2
  sta st_j1
  ldx #23
@band:
  txa
  lsr a
  lda osp_hi+ST_JOLT
  bcc :+
  eor #$FF
  adc #0
: sta xband,x
  dex
  bpl @band
  jsr fill_xtb8
  jsr bands_flip
@nofill:
  ; slow zoom toward the chorus: step from 1.0 down to ~0.72
  lda st_t
  and #7
  bne :+
  lda st_zoom
  cmp #72
  bcs :+
  inc st_zoom
: sec
  lda #0
  sbc st_zoom
  sta k_step
  lda #1
  sbc #0
  sta k_step+1
  lda #120
  ldx #120
  jsr k_pivot
  ; sprites: a black disc that drops on each horn stab
  lda #0
  sta oam_i
  ldx #ST_BALL
  jsr osc_step
  lda evn2
  and #$02
  beq :+
  lda #<-40
  ldx #ST_BALL
  jsr osc_kick
: lda #128
  sta t0
  lda #120
  clc
  adc osp_hi+ST_BALL
  sta t1
  lda #0
  sta t2
  lda #<ms_disc48
  sta ptr0
  lda #>ms_disc48
  sta ptr0+1
  jsr draw_meta
  jmp oam_finish

; ------------------------------------------------------------------ BUILD
build_nt = stripes_nt

build_init:
  jsr stripes_init
  lda #0
  sta st_strobe
  lda #64
  sta st_zoom               ; already zoomed in
  rts

build_frame:
  ; the stripes engine, revved: the current runs faster through the build
  lda ord_t+1
  asl a
  asl a
  asl a
  sta t0
  lda ord_t
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  ora t0
  lsr a
  lsr a
  clc
  adc #3
  sta st_speed              ; 3 .. ~7 px of phase a frame
  lda evn
  and #$08
  beq :+
  lda #4
  sta st_strobe
: lda st_strobe
  beq :+
  dec st_strobe
  lda #%11111110            ; emphasis on all three: a dark strobe
  bne :++
: lda #%00011110
: sta ppu_mask
  ; the break: the last beat is black
  lda ord_t+1
  cmp #>(ORDER_LEN - 34)
  bcc @go
  bne :+
  lda ord_t
  cmp #<(ORDER_LEN - 34)
  bcc @go
:
  lda #$0F                  ; black palette
  ldx #31
: sta pal_buf,x
  dex
  bpl :-
  lda #1
  sta pal_dirty
  lda #$FF
  sta st_bar                ; (no chord repaint over it)
  lda #0
  sta oam_i
  jmp oam_finish
@go:
  jmp stripes_frame
