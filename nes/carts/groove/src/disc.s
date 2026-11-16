; =====================================================================================
;  DISC  (intro, groove, outro)
;  The opening poster (an extended-attribute image: every 8x8 tile picks its own palette)
;  breathes with the bass: each bass note kicks a damped spring that squashes the whole
;  composition about its floor line (the kernel's per-line Y DDA), slap pops kick harder,
;  snares shake it horizontally (per-line sine wobble). An amber ball rides the bassline:
;  its x follows the bass pitch, it hops on every note and squashes when it lands. A row of
;  black dots under the floor counts the eighths, lit red and lifted by the hats.
; =====================================================================================

.segment "BANK00"
disc_nt: .incbin "disc_nt.bin"
disc_ex: .incbin "disc_ex.bin"

DS_FLOOR = 186            ; screen line of the floor bar (the squash pivot)
DS_SQ    = 0              ; spring: squash

ds_wob  = sv+0            ; wobble level (x16)
ds_ph   = sv+1            ; wobble phase
ds_bx   = sv+2            ; ball x
ds_by   = sv+3            ; ball height above the floor (8.8, hi = px, >= 0 up)
ds_byl  = sv+4
ds_vy   = sv+5            ; vertical speed (8.8, + = up)
ds_vyl  = sv+6
ds_land = sv+7            ; frames of landing squash left
ds_tx   = sv+8            ; ball target x
ds_hat  = sv+9            ; frames since the last hat
ds_t    = sv+10
ds_flash = sv+11

disc_init:
  jsr k_defaults
  lda #EX_ATTR
  jsr set_exmode
  lda #<pal_disc
  ldx #>pal_disc
  jsr load_pal
  lda #4
  sta osk+DS_SQ
  lda #3
  sta osd+DS_SQ
  lda #0
  sta ds_wob
  sta ds_by
  sta ds_byl
  sta ds_vy
  sta ds_vyl
  sta ds_land
  sta ds_flash
  lda #64
  sta ds_bx
  sta ds_tx
  rts

disc_frame:
  inc ds_t
  ; ---- events
  lda evn
  and #$40                  ; bass note
  beq @nobass
  lda #<-3
  ldx #DS_SQ
  jsr osc_kick
  ; hop: speed from the note's height
  lda music_note+2          ; bass E2 = 19
  sec
  sbc #19
  bcs :+
  lda #0
: cmp #24
  bcc :+
  lda #24
: sta t0
  asl a
  asl a
  adc t0                    ; *5
  adc #40
  sta ds_tx
  lda ds_by                 ; hop only from the floor (else fast notes would climb it away)
  cmp #6
  bcs @nobass
  lda #$02
  sta ds_vy
  lda #$40
  sta ds_vyl
@nobass:
  lda evn2
  and #$04                  ; slap pop: a bigger squash and a higher hop
  beq :+
  lda #<-5
  ldx #DS_SQ
  jsr osc_kick
  lda ds_by
  cmp #10
  bcs :+
  lda #$03
  sta ds_vy
  lda #$80
  sta ds_vyl
: lda evn
  and #$04                  ; kick: stretch up, and the paper flashes cream
  beq :+
  lda #3
  ldx #DS_SQ
  jsr osc_kick
  lda #3
  sta ds_flash
: lda ds_flash
  beq @noflash
  dec ds_flash
  lda #$37
  ldx ds_flash
  bne :+
  lda #$10
: sta pal_buf
  lda #1
  sta pal_dirty
@noflash:
  lda evn
  and #$08                  ; snare: shake
  beq :+
  lda #7*16
  sta ds_wob
: lda evn
  and #$10
  beq :+
  lda #0
  sta ds_hat
: inc ds_hat
  ; ---- squash spring -> kernel scale about the floor
  ldx #DS_SQ
  jsr osc_step
  ldx #DS_SQ               ; p > 0: stretch, p < 0: squash
  lda #DS_FLOOR
  ldy #DS_FLOOR
  jsr k_squash
  ; ---- wobble
  lda ds_wob
  beq :+
  sec
  sbc #3
  bcs :+
  lda #0
: sta ds_wob
  inc ds_ph
  inc ds_ph
  inc ds_ph
  lsr a
  lsr a
  lsr a
  lsr a
  ldy ds_ph
  jsr k_wobble
  ; ---- ball: chase the target x, fall under gravity
  lda ds_tx
  sec
  sbc ds_bx
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  clc
  adc ds_bx
  sta ds_bx
  sec
  lda ds_vyl
  sbc #$30                  ; gravity
  sta ds_vyl
  lda ds_vy
  sbc #0
  sta ds_vy
  clc
  lda ds_byl
  adc ds_vyl
  sta ds_byl
  lda ds_by
  adc ds_vy
  sta ds_by
  bpl @air
  lda ds_vy                 ; landed this frame (falling fast): squash for a few frames
  cmp #$FE
  bcs :+
  lda #5
  sta ds_land
: lda #0
  sta ds_by
  sta ds_byl
  sta ds_vy
  sta ds_vyl
@air:
  ; ---- sprites
  lda #0
  sta oam_i
  ; the sequencer: 8 dots under the floor, one per eighth; the current one lifts on the hats
  lda music_row
  lsr a
  and #7
  sta t6
  ldx #0
@dot:
  txa
  asl a
  asl a
  asl a
  asl a
  clc
  adc #72
  sta t0                    ; x
  lda #203
  sta t1                    ; y
  lda #1
  sta t2                    ; palette 1 (black)
  cpx t6
  bne :+
  lda #3                    ; lit: palette 3 (red)
  sta t2
  lda ds_hat
  cmp #5
  bcs :+
  lda #199                  ; lifted while the hat rings
  sta t1
: stx t7
  lda #<ms_dot8
  sta ptr0
  lda #>ms_dot8
  sta ptr0+1
  jsr draw_meta
  ldx t7
  inx
  cpx #8
  bne @dot
  ; the ball (palette 0)
  lda ds_bx
  sta t0
  lda #DS_FLOOR - 17
  sec
  sbc ds_by
  sta t1
  lda #0
  sta t2
  lda ds_land
  beq :+
  dec ds_land
  lda #<ms_ball_sq
  ldx #>ms_ball_sq
  jmp @draw
: lda ds_vy
  cmp #2
  bcc :+
  bmi :+
  lda #<ms_ball_st
  ldx #>ms_ball_st
  jmp @draw
: lda #<ms_ball32
  ldx #>ms_ball32
@draw:
  sta ptr0
  stx ptr0+1
  jsr draw_meta
  jmp oam_finish
