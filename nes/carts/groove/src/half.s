; =====================================================================================
;  HALF  (verse 1 and 2)
;  A field of halftone dots whose sizes are a phase map (distance from an off-centre point);
;  the dot patterns for every phase are pre-drawn in 32 CHR banks, so one bank write per frame
;  ($5128) moves every ring outward at once: one ring per beat, a surge on every kick.
;  Verse 2: the kernel rewrites $5128 every scanline from a band table, so 16-line bands
;  run half a cycle apart and the rings shear into an interlaced op-art pattern; the bands'
;  offsets swing with the bass. A big cream disc floats at the lead's pitch, with a dark
;  moon orbiting it; the field breathes vertically on bass notes.
; =====================================================================================

.segment "BANK01"
half_nt: .incbin "half_nt.bin"

HF_SQ  = 0                ; spring: vertical breathing
HF_Y   = 1                ; spring: disc height
LUTA   = 32               ; LUT family A (dots)

hf_ph   = sv+0            ; phase, 8.8
hf_phh  = sv+1
hf_boost = sv+2           ; extra speed after a kick (decays)
hf_dx   = sv+3            ; disc x
hf_t    = sv+4
hf_moon = sv+5            ; moon angle
hf_shear = sv+6           ; verse 2: the odd bands' phase offset
hf_depth = sv+7

half_init:
  jsr k_defaults
  lda #EX_RAM
  jsr set_exmode
  lda #<pal_half
  ldx #>pal_half
  jsr load_pal
  lda #LUTA
  sta st_bg
  sta st_bg+1
  sta st_bg+2
  sta st_bg+3
  lda #0
  sta hf_ph
  sta hf_phh
  sta hf_boost
  sta hf_shear
  sta hf_depth
  lda #176
  sta hf_dx
  lda #5
  sta osk+HF_Y
  lda #4
  sta osd+HF_Y
  rts

half_frame:
  inc hf_t
  lda evn
  and #$04                  ; kick: surge
  beq :+
  lda #160
  sta hf_boost
: lda evn
  and #$40                  ; bass: breathe
  beq :+
  lda #<-2
  ldx #HF_SQ
  jsr osc_kick
: lda evn
  and #$20                  ; lead note: the disc jumps toward its new height
  beq :+
  lda #<-20
  ldx #HF_Y
  jsr osc_kick
: ; phase: 241/256 per frame = one cycle per beat, plus the surge
  lda hf_boost
  beq :+
  sec
  sbc #8
  sta hf_boost
: lda hf_boost
  clc
  adc #241
  sta t0
  lda #0
  adc #0
  sta t1
  clc
  lda hf_ph
  adc t0
  sta hf_ph
  lda hf_phh
  adc t1
  sta hf_phh
  and #31
  ora #LUTA
  sta st_bg
  ; breathing: scale about the centre
  ldx #HF_SQ
  jsr osc_step
  ldx #HF_SQ
  lda #120
  ldy #120
  jsr k_squash
  ; verse 2: the odd 16-line bands (CHR slot 1) slide through the rings and back: their
  ; phase offset swings on a slow sine whose depth grows over the first bar
  lda ord
  cmp #3
  bne @nobands
  lda hf_t
  and #1
  bne :+
  lda hf_depth
  cmp #31
  bcs :+
  inc hf_depth
: lda hf_t
  asl a
  tax
  lda sin8,x                ; -127..127
  sta t0
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULA
  lda hf_depth
  sta MMC5_MULB
  lda MMC5_MULB             ; |sin| * depth / 256: 0..15
  bit t0
  bpl :+
  eor #$FF
  clc
  adc #1
: sta hf_shear
@nobands:
  lda hf_phh
  clc
  adc hf_shear
  and #31
  ora #LUTA
  sta st_bg+1
  ; ---- sprites: the disc at the lead's pitch, a moon orbiting it
  lda #0
  sta oam_i
  ldx #HF_Y
  jsr osc_step
  lda music_note
  sec
  sbc #24                   ; lead range ~ notes 24..55 (A3..E6)
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
  sbc t0                    ; higher note = higher on screen
  clc
  adc osp_hi+HF_Y
  sta t5                    ; disc centre y
  inc hf_moon
  inc hf_moon
  ldx hf_moon
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  clc
  adc hf_dx
  sta t0
  txa
  clc
  adc #64
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  clc
  adc t5
  sta t1
  lda #1
  sta t2
  lda #<ms_disc16
  sta ptr0
  lda #>ms_disc16
  sta ptr0+1
  jsr draw_meta
  lda hf_dx
  sta t0
  lda t5
  sta t1
  lda #0
  sta t2
  lda #<ms_disc48
  sta ptr0
  lda #>ms_disc48
  sta ptr0+1
  jsr draw_meta
  jmp oam_finish
