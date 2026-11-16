; =====================================================================================
;  SHOUT (the horn shout), MOIRE (the walking-bass breakdown), SPIRAL (verse 3)
;  All three are phase-map scenes animated by CHR bank switching (see half.s).
; =====================================================================================

LUTB = 64                 ; line screen
LUTC = 96                 ; diamonds

; ------------------------------------------------------------------ SHOUT
; Concentric diamonds in hot colours racing outward two rings per beat; every horn stab
; jumps the rings and flashes the screen hotter (red emphasis); slap pops shake it; the
; diamonds are cut into 16-line bands that alternate direction on the off-beats.
.segment "BANK04"
shout_nt: .incbin "shout_nt.bin"

sh_ph   = sv+0
sh_phh  = sv+1
sh_boost = sv+2
sh_flash = sv+3
sh_wob  = sv+4
sh_wph  = sv+5
sh_t    = sv+6
SH_SQ = 0

shout_init:
  jsr k_defaults
  lda #EX_RAM
  jsr set_exmode
  lda #<pal_shout
  ldx #>pal_shout
  jsr load_pal
  lda #LUTC
  sta st_bg
  sta st_bg+1
  sta st_bg+2
  sta st_bg+3
  lda #0
  sta sh_ph
  sta sh_phh
  sta sh_boost
  sta sh_flash
  sta sh_wob
  rts

shout_frame:
  inc sh_t
  lda evn2
  and #$02                  ; horn: jump + flash
  beq :+
  lda #255
  sta sh_boost
  lda #6
  sta sh_flash
: lda evn2
  and #$04                  ; pop: shake
  beq :+
  lda #5*16
  sta sh_wob
: lda evn
  and #$04                  ; kick: squash
  beq :+
  lda #<-4
  ldx #SH_SQ
  jsr osc_kick
: lda sh_boost
  beq :+
  sec
  sbc #15
  sta sh_boost
: ; two cycles per beat (482/256 per frame); three in the final shout, which also flashes on kicks
  ldx #0
  lda ord
  cmp #14
  bne :+
  ldx #2
  lda evn
  and #$04
  beq :+
  lda #3
  sta sh_flash
: clc
  lda sh_ph
  adc sh_spd,x
  sta sh_ph
  lda sh_phh
  adc sh_spd+1,x
  sta sh_phh
  clc
  lda sh_ph
  adc sh_boost
  sta sh_ph
  bcc :+
  inc sh_phh
: ; slot 0 runs outward, slot 1 (alternate 16-line bands) runs inward
  lda sh_phh
  and #31
  ora #LUTC
  sta st_bg
  lda #0
  sec
  sbc sh_phh
  and #31
  ora #LUTC
  sta st_bg+1
  ; flash: red emphasis
  lda #%00011110
  ldx sh_flash
  beq :+
  dec sh_flash
  lda #%00111110
: sta ppu_mask
  ; squash + wobble
  ldx #SH_SQ
  jsr osc_step
  ldx #SH_SQ
  lda #120
  ldy #120
  jsr k_squash
  lda sh_wob
  beq :+
  sec
  sbc #4
  bcs :+
  lda #0
: sta sh_wob
  lda sh_wph
  clc
  adc #5
  sta sh_wph
  lda sh_wob
  lsr a
  lsr a
  lsr a
  lsr a
  ldy sh_wph
  jsr k_wobble
  lda #0
  sta oam_i
  jmp oam_finish

sh_spd: .word 482, 723

; ------------------------------------------------------------------ MOIRE
; Two interfering ring systems drawn with a line screen; the interference drifts slowly
; (one cycle a bar). The walking bass walks: every note drops an amber dot one step further
; along, at the height of its pitch, and the trail fades through four palettes (8 dots of one
; sprite each, so the trail never breaks the 8-per-line limit with the disc). In walk 2 the
; muted lead floats a cream disc.
.segment "BANK05"
moire_nt: .incbin "moire_nt.bin"

mo_ph   = sv+0
mo_phh  = sv+1
mo_head = sv+2            ; trail ring buffer head
mo_x    = sv+3            ; next step x
mo_t    = sv+4
mo_tx   = sv+5            ; [8] trail x
mo_ty   = sv+13           ; [8] trail y
mo_age  = sv+21           ; [8] trail age
MO_Y = 0

moire_init:
  jsr k_defaults
  lda #EX_RAM
  jsr set_exmode
  lda #<pal_moire
  ldx #>pal_moire
  jsr load_pal
  lda #LUTB
  sta st_bg
  sta st_bg+1
  sta st_bg+2
  sta st_bg+3
  lda #0
  sta mo_ph
  sta mo_phh
  sta mo_head
  lda #40
  sta mo_x
  ldx #7
: lda #$F8
  sta mo_ty,x
  lda #255
  sta mo_age,x
  dex
  bpl :-
  lda #5
  sta osk+MO_Y
  lda #4
  sta osd+MO_Y
  rts

moire_frame:
  inc mo_t
  ; one cycle per bar (32*256/136 = 60 per frame), twice that in walk 2; rims ripple it
  lda evn2
  and #$08
  beq :+
  lda mo_phh
  clc
  adc #2
  sta mo_phh
: lda #60
  ldx ord
  cpx #9
  bne :+
  lda #120
: clc
  adc mo_ph
  sta mo_ph
  bcc :+
  inc mo_phh
: lda mo_phh
  and #31
  ora #LUTB
  sta st_bg
  ; a bass note: a new dot in the trail
  lda evn
  and #$40
  beq @nonote
  inc mo_head
  lda mo_head
  and #7
  tax
  lda mo_x
  sta mo_tx,x
  clc
  adc #24
  cmp #224
  bcc :+
  lda #40
: sta mo_x
  lda music_note+2          ; walking range ~ notes 21..34 (F#2..C#3 and up)
  sec
  sbc #17
  bcs :+
  lda #0
: cmp #24
  bcc :+
  lda #23
: asl a
  asl a
  asl a
  eor #$FF
  clc
  adc #200
  sta mo_ty,x
  lda #0
  sta mo_age,x
@nonote:
  lda evn
  and #$20
  beq :+
  lda #<-20
  ldx #MO_Y
  jsr osc_kick
: lda #0
  sta oam_i
  ; the lead's disc (walk 2)
  lda ord
  cmp #9
  bne @nodisc
  ldx #MO_Y
  jsr osc_step
  lda music_note
  sec
  sbc #24
  bcs :+
  lda #0
: cmp #32
  bcc :+
  lda #31
: asl a
  asl a
  sta t0
  lda #160
  sec
  sbc t0
  clc
  adc osp_hi+MO_Y
  sta t1
  lda #200
  sta t0
  lda #1
  sta t2
  lda #<ms_ball32
  sta ptr0
  lda #>ms_ball32
  sta ptr0+1
  jsr draw_meta
@nodisc:
  ldx #7
@trail:
  lda mo_age,x
  cmp #255
  beq :+
  inc mo_age,x
: stx t7
  lda mo_age,x
  cmp #160
  bcs @skip
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  sta t2                    ; palette by age: 0 bright .. 3 dim (sprite palettes 4-7)
  lda mo_tx,x
  sta t0
  lda mo_ty,x
  sta t1
  lda #<ms_dot8
  sta ptr0
  lda #>ms_dot8
  sta ptr0+1
  jsr draw_meta
@skip:
  ldx t7
  dex
  bpl @trail
  jmp oam_finish

; ------------------------------------------------------------------ SPIRAL
; A four-armed logarithmic spiral of halftone dots: advancing the phase turns it, half a turn
; a bar, kicked forward on the kicks. The lead's disc is followed by two echoes, 13 frames
; apart (the same delay as the echo on the lead's harmony channel).
.segment "BANK07"
spiral_nt: .incbin "spiral_nt.bin"

sp_ph   = sv+0
sp_phh  = sv+1
sp_boost = sv+2
sp_hist = $6800           ; 32 frames of disc y
sp_hx   = $6820           ; and x
sp_hp   = sv+3
sp_x    = sv+4
sp_t    = sv+5
SP_Y = 0
SP_SQ = 1

spiral_init:
  jsr k_defaults
  lda #EX_RAM
  jsr set_exmode
  lda #<pal_spiral
  ldx #>pal_spiral
  jsr load_pal
  lda #LUTA
  sta st_bg
  sta st_bg+1
  sta st_bg+2
  sta st_bg+3
  lda #0
  sta sp_ph
  sta sp_phh
  sta sp_boost
  sta sp_hp
  ldx #63
  lda #$F0
: sta sp_hist,x
  dex
  bpl :-
  lda #5
  sta osk+SP_Y
  lda #4
  sta osd+SP_Y
  rts

spiral_frame:
  inc sp_t
  lda evn
  and #$04
  beq :+
  lda #200
  sta sp_boost
  lda #<-3
  ldx #SP_SQ
  jsr osc_kick
: lda evn
  and #$20
  beq :+
  lda #<-20
  ldx #SP_Y
  jsr osc_kick
: lda sp_boost
  beq :+
  sec
  sbc #10
  sta sp_boost
: clc
  lda sp_ph
  adc #120
  sta sp_ph
  bcc :+
  inc sp_phh
: clc
  lda sp_ph
  adc sp_boost
  sta sp_ph
  bcc :+
  inc sp_phh
: lda sp_phh
  and #31
  ora #LUTA
  sta st_bg
  ldx #SP_SQ
  jsr osc_step
  ldx #SP_SQ
  lda #116
  ldy #116
  jsr k_squash
  ; the disc: x drifts on a slow sine, y follows the lead
  ldx #SP_Y
  jsr osc_step
  lda sp_t
  tax
  lda sin8,x
  cmp #$80
  ror a
  clc
  adc #128
  sta sp_x
  lda music_note
  sec
  sbc #24
  bcs :+
  lda #0
: cmp #32
  bcc :+
  lda #31
: asl a
  asl a
  sta t0
  lda #176
  sec
  sbc t0
  clc
  adc osp_hi+SP_Y
  ldx sp_hp
  sta sp_hist,x
  lda sp_x
  sta sp_hx,x
  inx
  txa
  and #31
  sta sp_hp
  lda #0
  sta oam_i
  ; newest first: disc, echo 1 (13 frames), echo 2 (26 frames)
  lda #0
  sta t6
@echo:
  ldx t6
  lda sp_dl,x
  sta t5
  lda sp_hp
  sec
  sbc #1
  sec
  sbc t5
  and #31
  tax
  lda sp_hx,x
  sta t0
  lda sp_hist,x
  sta t1
  ldx t6
  lda sp_pal,x
  sta t2
  lda sp_ms_lo,x
  sta ptr0
  lda sp_ms_hi,x
  sta ptr0+1
  jsr draw_meta
  inc t6
  lda t6
  cmp #3
  bne @echo
  jmp oam_finish
sp_dl: .byte 0, 13, 26
sp_pal: .byte 0, 1, 2
sp_ms_lo: .byte <ms_ball32, <ms_disc24, <ms_dot8
sp_ms_hi: .byte >ms_ball32, >ms_disc24, >ms_dot8
