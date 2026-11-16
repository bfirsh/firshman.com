; =====================================================================================
;  TUNNEL scenes: the build (accelerating with the riser), the drop and the first climax
;  (with the 64-ball object). Sync: kicks shove the flight speed, claps flash, accents swap
;  the balls' colours, the snare roll strobes, the break freezes and fades to black.
; =====================================================================================
.segment "B01"

td_mode  = pv+0         ; 0 build, 1 drop, 2 climax
td_boost = pv+1         ; speed boost (8.8 hi part), decays
td_ev    = pv+2
td_sh    = pv+3         ; shape step
td_pulse = pv+4         ; ball scale pulse
td_t     = pv+5         ; 2 bytes: frames into the part

build_init:
  lda #0
  ldx #$30
  jmp td_common
drop_init:
  lda #1
  ldx #$30
  jmp td_common
climax_init:
  lda #2
  ldx #$30
td_common:
  sta td_mode
  txa
  jsr ppu_off_col
  jsr tun_install
  lda #0
  sta td_boost
  sta td_pulse
  sta dark
  sta tun_hue
  lda #4
  sta flash
  lda td_mode
  bne :+
  lda #$20                ; build: green, starting dim
  sta tun_hue
  lda #3
  sta dark
  lda #0
  sta flash
: lda td_mode
  beq :+
  lda #1
  sta dot_on
: lda #6
  sta dot_twist
  SET_REACT td_react
  jsr ppu_on
  rts

; 60 fps reactions
td_react:
  lda ev_tail
  and #EV_KICK
  beq :+
  lda #8
  sta td_boost
  lda #16
  sta td_pulse
: lda ev_tail
  and #EV_CLAP
  beq :+
  lda td_mode
  bne :+
  lda part_t+1            ; build: the clap roll strobes in the second half
  beq :+
  lda #2
  sta flash
: lda ev_tail
  and #EV_ACC
  beq :+
  lda #8
  sta tun_flipc
: lda td_mode
  cmp #2
  bne :+
  lda ev_tail             ; climax: every kick flashes
  and #EV_KICK
  beq :+
  lda #1
  sta flash
: ; speed = base + boost
  lda dark
  cmp #4
  bne :+
  lda td_mode
  bne :+
  rts                     ; (build break: frozen)
: lda td_boost            ; drop/climax: 0.8 sub-steps a frame, a kick shoves to 1.7
  beq :+
  asl a
  asl a
  asl a
  asl a
  asl a
  adc #$D0
  sta tun_speed
  lda #0
  adc #0
  sta tun_speed+1
  dec td_boost
  rts
: lda td_mode
  bne :+
  ; build: $30 + t/2 (8.8): 0.2 -> 1.9 sub-steps a frame
  lda part_t+1
  lsr a
  sta tun_speed+1
  lda part_t
  ror a
  clc
  adc #$30
  sta tun_speed
  bcc :+
  inc tun_speed+1
: rts
: lda #$D0
  sta tun_speed
  lda #0
  sta tun_speed+1
  rts

build_frame:
  jsr wait_frame
  ; fade in over the first 3 bars, black-out on the break (3472-3583)
  lda part_t+1
  bne @late
  lda part_t
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..3
  eor #3
  sta dark
  rts
@late:
  lda tl_frame+1
  cmp #>3472
  bcc @r
  lda tl_frame
  cmp #<3472
  bcc @r
  lda #4                  ; 3472..3583: speed freezes, black; the roll strobes
  sta dark
  lda #0
  sta tun_speed
  sta tun_speed+1
@r:
  rts

drop_frame:
  jsr wait_frame
  ; hue by pattern
  lda music_order
  and #1
  ldx td_mode
  cpx #2
  bne :+
  eor #1
: asl a
  asl a
  asl a
  asl a
  sta tun_hue
  ; ball object
  lda tl_frame
  sta dot_phi
  lda tl_frame
  lsr a
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  clc
  adc #44
  sta dot_alpha
  lda td_pulse
  beq :+
  sec
  sbc #2
  sta td_pulse
: lda td_pulse
  clc
  adc #96
  ldx td_mode
  cpx #2
  bne :+
  adc #12
: sta dot_scale
  ; shape: a new one every 2 bars (224 frames), morphing over the first 64 frames
  lda part_t
  sta t0
  lda part_t+1
  sta t1
  ldx #0
: lda t0
  sec
  sbc #224
  tay
  lda t1
  sbc #0
  bcc :+
  sta t1
  sty t0
  inx
  jmp :-
: txa
  clc
  adc td_mode             ; (the climax starts elsewhere in the sequence)
  and #7
  tax
  lda drop_seq,x
  sta t3
  lda drop_seq+1,x
  sta t4
  lda t0
  cmp #64
  bcc :+
  lda #63
: lsr a
  sta t5
  jsr dot_morph
  ; twist breathes
  lda tl_frame
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  clc
  adc #4
  sta dot_twist
  jsr dot_draw
  rts

drop_seq: .byte SH_SPHERE, SH_TORUS, SH_CYLINDER, SH_HOURGLASS, SH_DISC, SH_SPINDLE, SH_CONE, SH_WAVE, SH_SPHERE
