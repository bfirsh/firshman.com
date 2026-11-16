; =====================================================================================
;  POSTER (chorus) and LIFT (the final chorus, a whole tone up)
;  Extended-attribute images (a palette per 8x8 tile: 13 colours on screen in flat fields).
;  The kernel cuts the poster into 24 slats of 8 lines in four interleaved groups, each on
;  its own spring: every chord stab knocks the next group sideways, so the picture shivers
;  apart in time with the comping and settles back; kicks squash it, snares shake it.
;  Three discs hop along the floor on the beat (one per beat, a slow walk on the snare).
;  LIFT: the sunburst's rays are three interleaved sets sharing one palette; cycling it one
;  step per sixteenth turns the whole sunburst in swing time.
; =====================================================================================

PO_SQ = 0                 ; springs: squash, then four slat groups
PO_G0 = 1

po_stab  = sv+0           ; stab counter (which group next)
po_wob   = sv+1
po_ph    = sv+2
po_hop   = sv+3           ; 3 discs: height (8.8 hi/lo) and speed
po_hy    = sv+4           ; [3]
po_hyl   = sv+7           ; [3]
po_vy    = sv+10          ; [3]
po_vyl   = sv+13          ; [3]
po_beat  = sv+16
po_lift  = sv+17          ; 1 in LIFT

.macro POSTER_CODE name, palette, lift, xs, pals, discy
.ident(.concat(name, "_init")):
  jsr k_defaults
  lda #EX_ATTR
  jsr set_exmode
  lda #<palette
  ldx #>palette
  jsr load_pal
  lda #0
  sta k_xtb+1
  sta po_stab
  sta po_wob
  sta po_beat
  ldx #11
: sta po_hy,x
  dex
  bpl :-
  lda #lift
  sta po_lift
  lda #4
  sta osk+PO_SQ
  lda #3
  sta osd+PO_SQ
  ldx #4
: lda #3
  sta osk,x
  lda #3
  sta osd,x
  dex
  bne :-
  rts

.ident(.concat(name, "_frame")):
  lda evn2
  and #$01                  ; chord stab: knock the next slat group
  beq @nostab
  inc po_stab
  lda po_stab
  and #3
  clc
  adc #PO_G0
  tax
  lda po_stab
  and #4
  beq :+
  lda #<-48
  jmp :++
: lda #48
: jsr osc_kick
@nostab:
  .if lift
  ; the sunburst turns one ray per sixteenth (in swing time): cycle background palette 0
  lda evn
  lsr a
  bcc @nocyc
  inc po_beat
  lda po_beat
  cmp #3
  bcc :+
  lda #0
  sta po_beat
: tax
  lda lift_cycle,x
  sta pal_buf+1
  lda lift_cycle+1,x
  sta pal_buf+2
  lda lift_cycle+2,x
  sta pal_buf+3
  lda #1
  sta pal_dirty
@nocyc:
  .endif
  lda evn2
  and #$02                  ; horn (lift): knock all four, alternating
  beq :+
  lda #32
  ldx #PO_G0
  jsr osc_kick
  lda #<-32
  ldx #PO_G0+1
  jsr osc_kick
  lda #32
  ldx #PO_G0+2
  jsr osc_kick
  lda #<-32
  ldx #PO_G0+3
  jsr osc_kick
: lda evn
  and #$04                  ; kick: squash
  beq :+
  lda #<-4
  ldx #PO_SQ
  jsr osc_kick
: lda evn
  and #$08                  ; snare: shake
  beq :+
  lda #6*16
  sta po_wob
: ldx #4
: jsr osc_step
  dex
  bpl :-
  ; slats: band b -> group b & 3
  ldx #23
: txa
  and #3
  tay
  lda osp_hi+PO_G0,y
  sta xband,x
  dex
  bpl :-
  jsr fill_xtb8
  jsr bands_flip
  ; squash about the floor (line 200)
  ldx #PO_SQ
  lda #200
  ldy #200
  jsr k_squash
  ; wobble
  lda po_wob
  beq :+
  sec
  sbc #3
  bcs :+
  lda #0
: sta po_wob
  inc po_ph
  inc po_ph
  inc po_ph
  lsr a
  lsr a
  lsr a
  lsr a
  ldy po_ph
  jsr k_wobble
  ; three discs hop in turn on each beat
  lda evn
  and #$01
  beq @nohop
  lda music_row
  and #3
  bne @nohop
  lda music_row
  lsr a
  lsr a
  and #3
  cmp #3
  bne :+
  lda #1
: tax
  lda #$03
  sta po_vy,x
  lda #$40
  sta po_vyl,x
@nohop:
  lda #0
  sta oam_i
  ldx #2
@disc:
  sec
  lda po_vyl,x
  sbc #$38
  sta po_vyl,x
  lda po_vy,x
  sbc #0
  sta po_vy,x
  clc
  lda po_hyl,x
  adc po_vyl,x
  sta po_hyl,x
  lda po_hy,x
  adc po_vy,x
  sta po_hy,x
  bpl :+
  lda #0
  sta po_hy,x
  sta po_hyl,x
  sta po_vy,x
  sta po_vyl,x
: stx t7
  lda xs,x
  sta t0
  lda #discy - 8
  sec
  sbc po_hy,x
  sta t1
  lda pals,x
  sta t2
  lda #<ms_disc16
  sta ptr0
  lda #>ms_disc16
  sta ptr0+1
  jsr draw_meta
  ldx t7
  dex
  bpl @disc
  jmp oam_finish
.endmacro

.segment "BANK03"
poster_nt: .incbin "poster_nt.bin"
poster_ex: .incbin "poster_ex.bin"
poster_xs: .byte 168, 196, 224
poster_pals: .byte 1, 2, 3
POSTER_CODE "poster", pal_poster, 0, poster_xs, poster_pals, 199

.segment "BANK08"
lift_nt: .incbin "lift_nt.bin"
lift_ex: .incbin "lift_ex.bin"
lift_xs: .byte 72, 128, 184
lift_pals: .byte 1, 2, 3
POSTER_CODE "lift", pal_lift, 1, lift_xs, lift_pals, 149
