; =====================================================================================
;  SOLIDS: real-time polyhedra (vector engine) - groove, rebuild and the second climax
;  Sync: the line colour follows the 303 line's own envelope (music_p1v/p1d: an open,
;  loud note is bright acid green, a closed one dim), accents flash magenta, claps white;
;  kicks punch the zoom and kick the spin.
; =====================================================================================
.segment "B00"

ps_mode  = pv+0         ; 0 groove, 1 rebuild, 2 climax
ps_obj   = pv+1         ; object loaded (index into poly_objs)
ps_punch = pv+2         ; zoom punch, decays
ps_spin  = pv+3         ; spin boost, decays
ps_acc   = pv+4         ; accent colour timer (react)
ps_clap  = pv+5         ; clap colour timer (react)
ps_all   = pv+6         ; draw all edges (strobe)
ps_base  = pv+7         ; base zoom
ps_ev    = pv+8         ; events seen by the main thread
ps_t     = pv+9         ; 2 bytes: frames into the current pattern
ps_glowt = pv+11

poly_objs_lo: .byte <obj_cube, <obj_octa, <obj_ico, <obj_dode, <obj_star, <obj_cubo, <obj_gem, <obj_logo
poly_objs_hi: .byte >obj_cube, >obj_octa, >obj_ico, >obj_dode, >obj_star, >obj_cubo, >obj_gem, >obj_logo
; object per song pattern (0..21; $FF = not a vector pattern)
poly_sched:
  .byte $FF, $FF, 7, 0, 2, 3, $FF, $FF, $FF, $FF, $FF, $FF, $FF, $FF, 4, 5, $FF, $FF, 6, 2, $FF, $FF

poly_init:
  lda #0
  ldx #$30
  jmp poly_common
rebuild_init:
  lda #1
  ldx #$30
  jmp poly_common
poly2_init:
  lda #2
  ldx #$30
poly_common:
  sta ps_mode
  txa
  jsr ppu_off_col
  jsr vec_install
  lda #$FF
  sta ps_obj
  lda #0
  sta ps_punch
  sta ps_spin
  sta ps_acc
  sta ps_clap
  sta ps_all
  sta dark
  lda #3
  sta flash
  lda #10
  sta star_n
  lda #3
  sta star_speed
  lda #$15
  sta vec_spal
  lda #92
  sta ps_base
  SET_REACT poly_react
  jsr ppu_on
  rts

; 60 fps: line colour from the acid line, accents and claps.
poly_react:
  lda ev_tail             ; kick: the backdrop rings jump outward and glow
  and #EV_KICK
  beq @nok
  ldx vec_ring
  inx
  cpx #3
  bcc :+
  ldx #0
: stx vec_ring
  lda #$10
  sta vec_rglow
  lda #6
  sta ps_glowt
@nok:
  lda ps_glowt
  beq :+
  dec ps_glowt
  bne :+
  lda #0
  sta vec_rglow
: lda ev_tail
  and #EV_ACC
  beq :+
  lda #8
  sta ps_acc
: lda ev_tail
  and #EV_CLAP
  beq :+
  lda #4
  sta ps_clap
: lda ev_tail
  and #EV_HAT
  beq :+
  lda #6
  sta star_speed
: lda star_speed
  cmp #3
  beq :+
  dec star_speed
: ; colour
  lda ps_clap
  beq :+
  dec ps_clap
  lda #$30
  bne @set
: lda ps_acc
  beq :+
  dec ps_acc
  lda #$25
  bne @set
: lda music_p1v           ; the 303's envelope: volume and duty (filter)
  lsr a
  lsr a
  tax                     ; 0..3
  lda music_p1d
  bne :+
  inx                     ; 12.5% duty = filter open: one step brighter
: lda poly_cols,x
@set:
  sta vec_col
  lda ps_mode
  cmp #2
  bne :+
  lda ev_tail             ; climax: a kick strobes the whole screen
  and #EV_KICK
  beq :+
  lda #1
  sta flash
: rts

poly_cols: .byte $0A, $1A, $2A, $2A, $3A, $3A

poly_frame:
  lda #<poly_scene
  sta ptr2
  lda #>poly_scene
  sta ptr2+1
  jmp vec_frame

poly_scene:
  ; events since the last image
  ldx #0
  lda ev_acc
  stx ev_acc
  sta ps_ev
  ; which object for this pattern
  ldx music_order
  lda poly_sched,x
  bmi :+
  cmp ps_obj
  beq :+
  sta ps_obj
  tax
  lda poly_objs_lo,x
  sta optr
  lda poly_objs_hi,x
  sta optr+1
  jsr vec_load
: ; frames into this pattern
  lda tl_frame
  sec
  ldx music_order
  sbc order_frame_lo,x
  sta ps_t
  lda tl_frame+1
  sbc order_frame_hi,x
  sta ps_t+1
  ; kick: punch and spin
  lda ps_ev
  and #EV_KICK
  beq :+
  lda #22
  sta ps_punch
  lda #8
  sta ps_spin
: ; rotation
  lda ps_spin
  lsr a
  clc
  adc #2
  adc ang_y
  sta ang_y
  lda ang_x
  clc
  adc #1
  sta ang_x
  lda tl_frame
  lsr a
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  sta ang_z
  ; the title swings rather than tumbles, and is drawn larger
  lda ps_obj
  cmp #7
  bne @nlogo
  lda tl_frame
  asl a
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  sta ang_y               ; +-32
  txa
  clc
  adc #40
  tax
  lda sin8,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  sta ang_x               ; +-16
  lda #0
  sta ang_z
  lda #112
  sta ps_base
  jmp @zoom
@nlogo:
  lda ps_mode
  bne @zoom
  lda #92
  sta ps_base
@zoom:
  ; zoom: grows in over the first 24 frames of a pattern, shrinks over the last 16
  lda ps_base
  sta t0
  lda ps_t+1
  bne @late
  lda ps_t
  cmp #24
  bcs @zdone
  tax
  lda grow_tab,x
  ldx ps_base
  jsr mul_ax_hi
  sta t0
  jmp @zdone
@late:
  lda ps_t                ; (pattern frame 256..447)
  cmp #<432
  bcc @zdone
  lda #<447
  sec
  sbc ps_t                ; 15..0
  asl a
  asl a
  asl a
  asl a
  ldx ps_base
  jsr mul_ax_hi
  sta t0
@zdone:
  lda t0
  clc
  adc ps_punch
  cmp #128                ; (the scaled matrix entries are signed bytes: zoom <= 128)
  bcc :+
  lda #128
: sta zoom
  lda ps_punch
  beq :+
  sec
  sbc #3
  bcs :++
  lda #0
: 
: sta ps_punch
  lda ps_spin
  beq :+
  dec ps_spin
: ; rebuild: the zoom follows the riser
  lda ps_mode
  cmp #1
  bne @nr
  lda tl_frame            ; 6272..7167: base 34 -> 80
  sec
  sbc #<6272
  sta t1
  lda tl_frame+1
  sbc #>6272
  asl a
  asl a
  asl a
  asl a
  sta t2
  lda t1
  lsr a
  lsr a
  lsr a
  lsr a
  ora t2                  ; (t - 6272) / 16: 0..55
  clc
  adc #40
  sta ps_base
  ; the break (7056-7167): collapse
  lda tl_frame+1
  cmp #>7056
  bcc @nr
  lda tl_frame
  cmp #<7056
  bcc @nr
  lda #0
  sta zoom
@nr:
  ; strobe: all edges on the off-beat 8ths in the climax and the rebuild's last bars
  lda #0
  sta ps_all
  lda ps_mode
  beq @draw
  lda music_row             ; (every 4th 16th: the strobe)
  and #3
  cmp #2
  bne :+
  sta ps_all
:
@draw:
  lda zoom
  beq @r
  lda ps_all
  beq :+
  lda o_nf
  pha
  lda #0
  sta o_nf
  jsr vec_draw_object
  pla
  sta o_nf
  rts
: jsr vec_draw_object
@r:
  rts

grow_tab:
  .repeat 24, i
  .byte (i * 256) / 24
  .endrepeat
; A * X >> 8 (unsigned)
mul_ax_hi:
  sta MMC5_MULA
  stx MMC5_MULB
  lda MMC5_MULB
  rts
