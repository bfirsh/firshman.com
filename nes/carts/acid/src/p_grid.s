; =====================================================================================
;  HORIZON scenes (grid floor): the intro fades in from black, the breakdown drifts in
;  magenta, the outro slows to a stop and fades back to black for the loop.
;  Sync: kicks light the cross lines, open hats push the stars.
; =====================================================================================
.segment "B02"

gs_mode = pv+0          ; 0 intro, 1 breakdown, 2 outro

grid_intro_init:
  lda #0
  ldx #$0F
  jmp gs_common
grid_bd_init:
  lda #1
  ldx #$0F
  jmp gs_common
grid_outro_init:
  lda #2
  ldx #$30
gs_common:
  sta gs_mode
  txa
  jsr ppu_off_col
  jsr grid_install
  jsr stars_init
  lda #GRID_HZ - 6
  sta star_ymax
  lda #56
  sta star_cy
  lda #24
  sta star_n
  lda #2
  sta star_speed
  lda #154
  sta grid_w
  lda #0
  sta grid_w+1
  sta flash
  lda gs_mode
  sta grid_alt
  bne :+
  lda #4                  ; intro: from black
  sta dark
  jmp :++
: lda #0
  sta dark
  lda gs_mode
  cmp #2
  bne :+
  lda #3
  sta flash
: SET_REACT gs_react
  jsr ppu_on
  rts

gs_react:
  lda ev_tail
  and #EV_KICK
  beq :+
  lda #2
  sta grid_lc
: lda ev_tail
  and #EV_HAT
  beq :+
  lda #5
  sta star_speed
: lda star_speed
  cmp #2
  beq :+
  dec star_speed
: rts

grid_frame:
  jsr wait_frame
  lda gs_mode
  bne @nint
  ; intro: fade in over 2 bars, speed $40 -> $140 over the part
  lda part_t+1
  bne :+
  lda part_t
  cmp #224
  bcs :+
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..3
  eor #3
  clc
  adc #1
  cmp #4
  bcc :++
  lda #4
  bne :++
: lda #0
: sta dark
  lda part_t+1
  lsr a
  lda part_t
  ror a
  lsr a
  clc
  adc #$40
  sta grid_speed
  lda #0
  adc #0
  sta grid_speed+1
  ; the last beat before the vectors: white
  lda part_t+1
  cmp #>868
  bcc @move
  lda part_t
  cmp #<868
  bcc @move
  lda #4
  sta flash
  jmp @move
@nint:
  cmp #1
  bne @outro
  lda #$60                ; breakdown: slow drift
  sta grid_speed
  lda #0
  sta grid_speed+1
  jmp @move
@outro:
  ; speed $180 -> 0 over the part, fade to black over the last 2 bars (9632..9855)
  lda #<896
  sec
  sbc part_t
  sta t0
  lda #>896
  sbc part_t+1
  lsr a
  lda t0
  ror a
  lsr a
  sta grid_speed
  lda #0
  sta grid_speed+1
  lda tl_frame+1
  cmp #>9632
  bcc @move
  lda tl_frame
  cmp #<9632
  bcc @move
  lda tl_frame
  sec
  sbc #<9632
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..3
  clc
  adc #1
  sta dark
@move:
  clc
  lda grid_camz
  adc grid_speed
  sta grid_camz
  lda grid_camz+1
  adc grid_speed+1
  sta grid_camz+1
  jsr grid_tables
  lda #1
  sta gk_flip
  rts
