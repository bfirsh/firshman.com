; =====================================================================================
;  Effects: per-frame preparation (runs in the main thread after the picture, while the
;  kernel is idle). Each writes the NEXT frame's tables into the buffer the kernel is not
;  reading and the nf_* frame parameters.
; =====================================================================================
.segment "ZEROPAGE"
spr_mode: .res 1         ; 0 = streak lanes, 1 = tunnel particles
pa_ready: .res 1
sdx: .res 8              ; streak speed per class
sdx_for: .res 1          ; d_speed the table was made for
.segment "FX"

; ------------------------------------------------------------------ shared helpers
; Point ptr0 (y table) and ptr1 (x table) at the buffer the kernel is not reading.
wbuf_ptrs:
  lda #0
  sta ptr0
  sta ptr1
  lda kbuf
  eor #1
  clc
  adc #>ybuf0
  sta ptr0+1
  adc #>(xbuf0 - ybuf0)
  sta ptr1+1
  rts

; Fill the y table of the write buffer, lines KS..KE, with A (unrolled, both buffers).
fill_y:
  ldx kbuf
  bne fill_y0
  jmp fill_y1
fill_y0:
  .repeat KE + 1 - KS, i
  sta ybuf0 + KS + i
  .endrepeat
  rts
fill_y1:
  .repeat KE + 1 - KS, i
  sta ybuf1 + KS + i
  .endrepeat
  rts

; Zero the x table of the write buffer over the title band.
TITLE_L0 = 96            ; screen line of the title's top row
clear_x_title:
  lda #0
  ldx kbuf
  beq :+
  .repeat 32, i
  sta xbuf0 + TITLE_L0 + i
  .endrepeat
  rts
: .repeat 32, i
  sta xbuf1 + TITLE_L0 + i
  .endrepeat
  rts

; Commit: the next frame uses the tables just written.
commit_tables:
  lda #1
  sta kflip
  rts

; 16-bit LFSR-ish random -> A
rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

; ------------------------------------------------------------------ palettes
; Copy 32 bytes at (ptr2) into pal_src.
set_pal:
  ldy #31
: lda (ptr2),y
  sta pal_src,y
  dey
  bpl :-
  lda #$80
  sta bright_cur          ; force recompute
  rts

; pal_buf = pal_src shifted by 'bright' luma steps (-4..+4), when either changed.
apply_bright:
  lda bright
  cmp bright_cur
  bne :+
  rts
: sta bright_cur
  clc
  adc #4
  bpl :+
  lda #0
: cmp #9
  bcc :+
  lda #8
: lsr a
  sta ptr2+1
  lda #0
  ror a
  lsr ptr2+1
  ror a                   ; (b + 4) * 64
  clc
  adc #<lum_tab
  sta ptr2
  lda ptr2+1
  adc #>lum_tab
  sta ptr2+1
  .repeat 32, i
  ldy pal_src + i
  lda (ptr2),y
  sta pal_buf + i
  .endrepeat
  ldy bright              ; the backdrop (letterbox) stays black, except in a full white flash
  lda #$0F
  cpy #4
  bne :+
  lda #$30
: sta pal_buf
  sta pal_buf+16
  lda #1
  sta pal_dirty
  rts


; ------------------------------------------------------------------ streak sprites
; 32 streaks in OAM slots 0-31: 16 lanes of 11 lines, 2 per lane (at most 4 on any line).
; Their y, tile and attributes never change (lanes_show restores them after the tunnel, whose
; particles live in slots 32-63).
NSTREAK = 32
lanes_show:
  .repeat NSTREAK, i
  lda #KS + 2 + (i / 2) * 11 + ((i * 7) .mod 3)
  sta oam + 4 * i
  .endrepeat
  rts
lanes_init:
  .repeat NSTREAK, i
  lda #SPR_STREAK + 3 + ((i & 7) >> 1)
  sta oam + 4 * i + 1
  lda #$20 | (i & 3)      ; behind the background
  sta oam + 4 * i + 2
  lda #<((i * 89 + 37) * 3)
  sta oam + 4 * i + 3
  .endrepeat
  jmp lanes_show
lanes_hide:
  lda #$F8
  .repeat NSTREAK, i
  sta oam + 4 * i
  .endrepeat
  rts
parts_hide:
  lda #$F8
  .repeat 32, i
  sta oam + 128 + 4 * i
  .endrepeat
  rts

; Switching to a lane effect: lanes back if the tunnel had hidden them.
lanes_on:
  lda spr_mode
  bne :+
  rts
: lda #0
  sta spr_mode
  jsr parts_hide
  jmp lanes_show

; Move the streaks: 8 speed classes (sprite i has class i & 7); dx[c] = (2 + c) * speed / 16.
streaks_move:
  lda d_init
  beq :+
  rts
: lda d_speed
  cmp sdx_for
  beq @move
  sta sdx_for
  ldx #7
: txa
  clc
  adc #2
  sta MMC5_MULA
  lda d_speed
  sta MMC5_MULB
  lda MMC5_MULA
  lsr a
  lsr a
  lsr a
  lsr a
  sta t0
  lda MMC5_MULB
  asl a
  asl a
  asl a
  asl a
  ora t0
  sta sdx,x
  dex
  bpl :-
@move:
  .repeat NSTREAK, i
  lda oam + 4 * i + 3
  clc
  adc sdx + (i & 7)
  sta oam + 4 * i + 3
  .endrepeat
  rts

; ------------------------------------------------------------------ BARS
; 6 sine bars at different depths, drawn back to front into the y table, plus the title.
NBARS = 7
.segment "BSS"
b_phase: .res NBARS
b_order: .res NBARS      ; draw order
b_z: .res NBARS
b_spd: .res 1            ; bar speed (phase per frame)
b_amp: .res 1            ; amplitude
b_title: .res 1          ; title on (0/1)
b_tt: .res 1             ; title skew
b_count: .res 1          ; bars shown
x_dirty: .res 1          ; bit n: x table of buffer n holds a title skew
.segment "FX"

bars_init:
  ldx #NBARS-1
: lda bar_phase0,x
  sta b_phase,x
  txa
  sta b_order,x
  dex
  bpl :-
  ldx d_var
  lda pal_bars_lo,x
  sta ptr2
  lda pal_bars_hi,x
  sta ptr2+1
  jsr set_pal
  lda #2
  sta b_spd
  lda #60
  sta b_amp
  lda #0
  sta b_title
  rts

bar_phase0: .byte 0, 37, 73, 110, 146, 183, 219
bar_band:   .byte 0, 16, 32, 48, 0, 16, 32     ; source band per bar (palettes 0-3)

bars_frame:
  jsr wbuf_ptrs
  lda #0
  jsr fill_y
  ; advance the bars; z = cos(phase) for depth
  ldx #NBARS-1
@adv:
  lda b_phase,x
  clc
  adc b_spd
  adc bar_dphase,x
  sta b_phase,x
  clc
  adc #64
  tay
  lda sin_tab,y
  eor #$80
  sta b_z,x
  dex
  bpl @adv
  ; sort the draw order by z (back first): insertion sort, 6 entries
  ldx #1
@s1:
  stx t2
@s2:
  ldy b_order,x
  lda b_z,y
  ldy b_order-1,x
  cmp b_z,y
  bcs @s3
  lda b_order,x
  pha
  tya
  sta b_order,x
  pla
  sta b_order-1,x
  dex
  bne @s2
@s3:
  ldx t2
  inx
  cpx #NBARS
  bne @s1
  ; draw
  ldx #0
@draw:
  cpx b_count
  bcs @drawn
  stx t3
  lda b_order,x
  tax
  ; top = 112 + sin(phase) * amp / 128
  ldy b_phase,x
  lda sin_tab,y
  bpl :+
  eor #$FF
  sta MMC5_MULA
  lda b_amp
  sta MMC5_MULB
  lda MMC5_MULB
  asl MMC5_MULA
  rol a
  eor #$FF
  clc
  adc #1
  jmp :++
: sta MMC5_MULA
  lda b_amp
  sta MMC5_MULB
  lda MMC5_MULB
  asl MMC5_MULA
  rol a
: clc
  adc #106
  sta t4                  ; top line
  lda bar_band,x
  sta t0
  ; profile: front half of the z range bright, back half dim
  ldy #0
  lda b_z,x
  bpl :+
  ldy #2
: lda t4
  and #1
  sta t5
  tya
  ora t5
  tay                     ; profile index: (front?2:0) | parity
  jsr bar_write
  ldx t3
  inx
  jmp @draw
@drawn:
  ; title
  jsr bars_title
  ; frame parameters
  lda #NT_A
  sta nf_hi
  lda #<k_bars
  sta nf_vec
  lda #>k_bars
  sta nf_vec+1
  jsr kernel_entry_params
  jmp commit_tables

bar_dphase: .byte 0, 1, 0, 1, 2, 1, 0

; y = profile index ((front ? 2 : 0) | parity of the top line), t4 = top line, t0 = band
bar_write:
  lda bp_hi,y
  pha
  lda bp_lo,y
  pha
  ldy t4
  rts
bp_lo: .byte <(bp_d0-1), <(bp_d1-1), <(bp_b0-1), <(bp_b1-1)
bp_hi: .byte >(bp_d0-1), >(bp_d1-1), >(bp_b0-1), >(bp_b1-1)
.include "bars.inc"

; Title: lines TITLE_L0.. show the title rows with a per-line skew (speed smear) b_title = 1.
bars_title:
  ldx kbuf                ; x = 1 - kbuf: the buffer being written
  lda b_title
  bne @on
  lda x_dirty_bit,x       ; title off: clear the skew once per buffer
  and x_dirty
  bne :+
  rts
: lda x_dirty_bit,x
  eor x_dirty
  sta x_dirty
  jmp clear_x_title
@on:
  lda x_dirty
  ora x_dirty_bit,x
  sta x_dirty
  ; skew: x(row) = (31 - row) * (b_tt / 8), built from the bottom row up
  lda b_tt
  lsr a
  lsr a
  lsr a
  sta t1
  lda #0
  sta t2
  ldx #31
  ldy #TITLE_L0 + 31
@l:
  txa
  clc
  adc #TITLE_Y
  sta (ptr0),y
  lda t2
  sta (ptr1),y
  clc
  adc t1
  sta t2
  dey
  dex
  bpl @l
  rts
x_dirty_bit: .byte 2, 1    ; indexed by kbuf: the write buffer is the other one

; Common kernel entry parameters (table-driven kernels).
kernel_entry_params:
  lda #NTMAP_K
  sta nf_ntmap
  lda #<k_entry
  sta nf_entry
  lda #>k_entry
  sta nf_entry+1
  lda #KS-2
  sta nf_first
  lda #%00011110
  sta nf_mask
  lda #0
  sta nf_bank0
  rts

; ------------------------------------------------------------------ palettes
; =====================================================================================
;  TWISTER
; =====================================================================================
.segment "BSS"
tw_a0: .res 2            ; angle offset (8.8)
tw_spin: .res 1          ; angle offset speed (signed, 1/16 units)
tw_rate: .res 1          ; twist per line (multiplier operand)
tw_tpo: .res 1           ; bend phase
tw_scroll: .res 1        ; copper band scroll
tw_sway: .res 1          ; sway phase
.segment "FX"

twist_init:
  ldx d_var
  lda pal_twist_lo,x
  sta ptr2
  lda pal_twist_hi,x
  sta ptr2+1
  jsr set_pal
  lda #0
  sta ybuf0+KE            ; the line after the picture is black
  sta ybuf1+KE
  rts

twist_frame:
  jsr wbuf_ptrs
  ; angle offset, bend phase, bands, sway
  lda tw_spin
  ldx #0
  cmp #$80
  bcc :+
  dex
: clc
  adc tw_a0
  sta tw_a0
  txa
  adc tw_a0+1
  sta tw_a0+1
  lda tw_tpo
  clc
  adc #3
  sta tw_tpo
  lda tw_scroll
  clc
  adc d_speed
  sta tw_scroll
  inc tw_sway
  ; copper bands: copy the band pattern at an even offset
  lda tw_scroll
  lsr a
  lsr a
  lsr a
  and #$7E
  tax
  lda kbuf
  bne :+
  jsr tw_copy1
  jmp :++
: jsr tw_copy0
:
  ; frame parameters
  lda tw_rate
  sta nf_mulb
  lda tw_a0+1
  sta nf_a0
  lda tw_tpo
  sta nf_tpo
  ; sway: x = sin(sway) / 8
  ldx tw_sway
  lda sin_tab,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  sta nf_x
  lsr a
  lsr a
  lsr a
  sta nf_xc
  ; slot-0 bank for line KS: hi(KS * rate) + bend[KS + tpo] + a0 (+ the carry the kernel sees)
  lda #KS
  sta MMC5_MULA
  lda tw_rate
  sta MMC5_MULB
  lda #KS
  clc
  adc tw_tpo
  tax
  lda MMC5_MULB
  clc
  adc tw_bend,x
  clc
  adc tw_a0+1
  and #31
  ora #TW_BASE
  sta nf_bank0
  lda #<k_twist
  sta nf_vec
  lda #>k_twist
  sta nf_vec+1
  jsr kernel_entry_params2
  jmp commit_tables

.segment "FX2"
; copy 176 band rows from tw_pat+x (x even keeps the dither parity) into ybuf0 / ybuf1
tw_copy0:
  .repeat KE - KS, i
  lda tw_pat + i,x
  sta ybuf0 + KS + i
  .endrepeat
  rts
tw_copy1:
  .repeat KE - KS, i
  lda tw_pat + i,x
  sta ybuf1 + KS + i
  .endrepeat
  rts

; band rows: 4 copper bands of 16 lines (palettes 0-3) in nametable A rows 12-19, the low bit
; follows the line parity (KS is even) for the slices' checker dither
tw_pat:
  .repeat 128 + KE - KS + 2, i
  .byte TW_Y + (((i >> 4) & 3) << 4) + (i & 1)
  .endrepeat


.segment "FX"
; =====================================================================================
;  FLOOR (perspective grid under a striped sun)
; =====================================================================================
.segment "BSS"
g_camz: .res 2           ; depth (8.8, 256 = one grid cell)
g_speed: .res 2
g_cv: .res 1             ; curve amount 0..15 (8 = straight)
g_ct: .res 1             ; curve phase
g_sun: .res 1            ; sun top line
g_stripe: .res 1
g_patch: .res 6          ; operands for the floor handler (applied at NMI)
.segment "FX"

grid_init:
  ldx d_var
  lda pal_grid_lo,x
  sta ptr2
  lda pal_grid_hi,x
  sta ptr2+1
  jsr set_pal
  rts

grid_frame:
  ; camera: forward, curving
  lda g_camz
  clc
  adc g_speed
  sta g_camz
  lda g_camz+1
  adc g_speed+1
  sta g_camz+1
  inc g_ct
  ldx g_ct
  lda sin_tab,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a                   ; -8..7
  clc
  adc #8
  sta g_cv
  ; patches: linep + camz, curve tables
  lda g_camz+1
  clc
  adc #<g_linep
  sta g_patch
  lda #>g_linep
  adc #0
  sta g_patch+1
  ldx g_cv
  lda curve_c_lo,x
  sta g_patch+2
  lda curve_c_hi,x
  sta g_patch+3
  lda curve_f_lo,x
  sta g_patch+4
  lda curve_f_hi,x
  sta g_patch+5
  ; sky: the sun with its stripes, then the horizon glow
  lda kbuf
  eor #1
  clc
  adc #>grow0
  sta ptr0+1
  lda #0
  sta ptr0
  inc g_stripe
  ; lines above the sun: black; the sun: consecutive image rows; then cut the stripes
  ldy #KS
  lda #0
: cpy g_sun
  beq :+
  sta (ptr0),y
  iny
  cpy #HORIZON - 5
  bne :-
  beq @glow
: lda #SUN_Y
@sun:
  sta (ptr0),y
  clc
  adc #1
  iny
  cpy #HORIZON - 5
  beq @cut
  cmp #SUN_Y + 80
  bne @sun
  lda #0
: sta (ptr0),y
  iny
  cpy #HORIZON - 5
  bne :-
@cut:
  ; stripes: in the sun's lower half, every 8 lines a black gap that widens downwards
  lda g_sun
  clc
  adc #36
  sta t0                  ; first striped line
  ldx #0
@s:
  txa
  asl a
  asl a
  asl a
  clc
  adc t0
  sta t1
  lda g_stripe
  and #7
  clc
  adc t1
  tay                     ; gap start line
  cpy #HORIZON - 5
  bcs @glow
  lda #0
  sta (ptr0),y            ; gap of 1 + k / 2 lines
  txa
  lsr a
  beq @sn
  sta t2
: iny
  cpy #HORIZON - 5
  bcs @glow
  lda #0
  sta (ptr0),y
  dec t2
  bne :-
@sn:
  inx
  cpx #6
  bne @s
@glow:
  ldy #HORIZON - 5
  ; glow: 6 lines of band-3 gradient rows above the horizon
  ldx #0
: lda glow_rows,x
  sta (ptr0),y
  iny
  inx
  cpx #6
  bne :-
  ; frame parameters
  lda #<k_grid
  sta nf_vec
  lda #>k_grid
  sta nf_vec+1
  lda #GR_BASE
  sta nf_bank0
  jsr kernel_entry_params2
  jmp commit_tables

glow_rows: .byte 48+1, 48+3, 48+4, 48+6, 48+8, 48+9

curve_c_lo:
  .repeat CURVE_N, i
  .byte <(curve_c + i * CURVE_STRIDE - KS)
  .endrepeat
curve_c_hi:
  .repeat CURVE_N, i
  .byte >(curve_c + i * CURVE_STRIDE - KS)
  .endrepeat
curve_f_lo:
  .repeat CURVE_N, i
  .byte <(curve_f + i * CURVE_STRIDE - KS)
  .endrepeat
curve_f_hi:
  .repeat CURVE_N, i
  .byte >(curve_f + i * CURVE_STRIDE - KS)
  .endrepeat

; =====================================================================================
;  TUNNEL
; =====================================================================================
.segment "BSS"
tu_phase: .res 2         ; 8.8; integer part 0..23 (8 CHR frames x 3 palette phases)
tu_speed: .res 2
tu_pal: .res 1           ; palette set
tu_cyc: .res 16          ; per palette: the three colours that rotate (a bright-to-dark ramp: the
                         ; rotation reads as rings rushing out with motion-blurred trails)
.segment "FX"

tunnel_init:
  lda #<pal_tunnel
  sta ptr2
  lda #>pal_tunnel
  sta ptr2+1
  jsr set_pal
  rts

tunnel_frame:
  lda tu_phase
  clc
  adc tu_speed
  sta tu_phase
  lda tu_phase+1
  adc tu_speed+1
: cmp #24
  bcc :+
  sbc #24
  bcs :-
: sta tu_phase+1
  ; CHR frame = phase & 7 -> first bank
  and #7
  sta MMC5_MULA
  lda #12
  sta MMC5_MULB
  lda MMC5_MULA
  clc
  adc #TU_BASE
  sta nf_aux
  ; palette rotation = phase >> 3 (0..2): entries 1-3 of each palette rotate
  lda tu_phase+1
  lsr a
  lsr a
  lsr a
  tax
  ldy #0
@p:
  lda tu_cyc,y
  sta t0
  lda tu_cyc+1,y
  sta t1
  lda tu_cyc+2,y
  sta t2
  cpx #1
  bne :+
  lda t0
  pha
  lda t1
  sta t0
  lda t2
  sta t1
  pla
  sta t2
: cpx #2
  bne :+
  lda t2
  pha
  lda t1
  sta t2
  lda t0
  sta t1
  pla
  sta t0
: tya
  tax
  lda t0
  sta pal_src+1,x
  lda t1
  sta pal_src+2,x
  lda t2
  sta pal_src+3,x
  lda tu_phase+1
  lsr a
  lsr a
  lsr a
  tax
  tya
  clc
  adc #4
  tay
  cpy #16
  bne @p
  lda #$80
  sta bright_cur
  ; frame parameters
  lda #NTMAP_T
  sta nf_ntmap
  lda #<tu_irq1
  sta nf_entry
  lda #>tu_irq1
  sta nf_entry+1
  lda #KS-2
  sta nf_first
  rts

; per fog palette (far .. near): the three colours that rotate (a bright-to-dark ramp: the
; rotation reads as rings rushing out with motion-blurred trails)
pal_tunnel:
  .byte $0F,$24,$14,$03, $0F,$24,$14,$03, $0F,$24,$14,$03, $0F,$24,$14,$03
  .byte $0F,$00,$10,$30, $0F,$01,$21,$31, $0F,$04,$14,$34, $0F,$07,$27,$37

; Common kernel entry parameters (per-line kernels).
kernel_entry_params2:
  lda #NTMAP_K
  sta nf_ntmap
  lda #<k_entry
  sta nf_entry
  lda #>k_entry
  sta nf_entry+1
  lda #KS-2
  sta nf_first
  rts

; =====================================================================================
;  Director: picks the effect for the song position, sets its parameters, flashes.
; =====================================================================================
.segment "BSS"
d_seg: .res 1
d_t: .res 2              ; frames since the segment started
d_speed: .res 1          ; streak speed (x16)
d_flash: .res 1          ; brightness from flashes (decays)
d_cue: .res 1
d_var: .res 1
d_tq: .res 1             ; d_t / 4, saturating
d_fk: .res 1             ; kick flash strength
d_fs: .res 1             ; snare flash strength
d_emph: .res 1
d_fade: .res 1           ; fade in / out (brightness steps, signed)
d_init: .res 1           ; 1 on the frame an effect starts (it shares a frame with the old kernel)
.segment "FX"

; segments: start frame, effect, variant
.macro SEG start, effect, variant
  .word start
  .byte effect, variant
.endmacro
segments:
  SEG    0, FX_BARS, 0      ; intro: stars, the bars one per chord, the title
  SEG  672, FX_BARS, 1      ; the break teaser
  SEG 1344, FX_TWIST, 0     ; build
  SEG 2016, FX_TWIST, 1     ; build: the Reese, the roll, the gap
  SEG 2688, FX_TUNNEL, 0    ; DROP
  SEG 3192, FX_TUNNEL, 1
  SEG 3696, FX_GRID, 0
  SEG 4200, FX_GRID, 2
  SEG 4704, FX_GRID, 1      ; halftime: sunset
  SEG 5376, FX_TWIST, 2     ; halftime: slow twister
  SEG 6048, FX_BARS, 2      ; build 2
  SEG 6720, FX_TUNNEL, 1    ; FINAL DROP: a cut every two bars, stutters cut every row
  SEG 6888, FX_GRID, 2
  SEG 7056, FX_TWIST, 3
  SEG 7224, FX_BARS, 3
  SEG 7392, FX_TUNNEL, 1
  SEG 7560, FX_GRID, 2
  SEG 7728, FX_TWIST, 3
  SEG 7896, FX_TUNNEL, 2
  SEG 8064, FX_GRID, 3
  SEG 8232, FX_TWIST, 3
  SEG 8400, FX_BARS, 3
  SEG 8568, FX_TUNNEL, 2
  SEG 8736, FX_BARS, 4      ; outro
  SEG $FFFF, 0, 0
NSEG = (* - segments) / 4 - 1

director:
  ; which segment? (usually the current one or the next: start there)
  ldx d_seg
  cpx #NSEG
  bcc :+
  ldx #0
: txa
  asl a
  asl a
  tay
  lda tl_frame+1          ; before the current segment's start (the song looped): from 0
  cmp segments+1,y
  bcc @from0
  bne @find
  lda tl_frame
  cmp segments,y
  bcs @find
@from0:
  ldx #0
@find:
  txa
  asl a
  asl a
  tay
  lda segments+4+1,y
  cmp tl_frame+1
  bcc @next
  bne @found
  lda segments+4,y
  cmp tl_frame
  beq @next
  bcs @found
@next:
  inx
  cpx #NSEG
  bne @find
  dex
@found:
  txa
  asl a
  asl a
  tay
  sec
  lda tl_frame
  sbc segments,y
  sta d_t
  lda tl_frame+1
  sbc segments+1,y
  sta d_t+1
  cpx d_seg
  beq @same
  stx d_seg
  lda segments+3,y
  sta d_var
  lda segments+2,y
  sta fx_next
  jsr fx_init_call
@same:
  ; after a run of stutter cuts, return to the segment's own effect
  lda d_seg
  asl a
  asl a
  tay
  lda music_cue
  cmp #1
  beq :+
  lda segments+2,y
  cmp fx_next
  beq :+
  sta fx_next
  lda segments+3,y
  sta d_var
  jsr fx_init_call
:
  ; d_tq = d_t / 4 (saturating)
  lda d_t+1
  cmp #4
  lda #255
  bcs :+
  lda d_t+1
  sta t0
  lda d_t
  lsr t0
  ror a
  lsr t0
  ror a
: sta d_tq
  ; flash strengths and fades by segment
  ldx d_seg
  lda seg_fk,x
  sta d_fk
  lda seg_fs,x
  sta d_fs
  lda #0
  sta d_fade
  cpx #0
  bne :+
  lda d_t+1               ; intro: fade in over the first 64 frames
  bne :+
  lda d_t
  cmp #64
  bcs :+
  lsr a
  lsr a
  lsr a
  lsr a
  sec
  sbc #4
  sta d_fade
: cpx #NSEG-1
  bne :+
  lda tl_frame+1          ; outro: fade out over the last 80 frames
  cmp #>(SONG_LEN - 80)
  bcc :+
  lda tl_frame
  sec
  sbc #<(SONG_LEN - 80)
  bcc :+
  lsr a
  lsr a
  lsr a
  lsr a
  eor #$FF
  sta d_fade              ; -1 .. -5
:
  jsr flashes
  ; stutter (cue 1): in the final drop, cut between effects on every row; elsewhere freeze
  lda music_cue
  cmp #1
  bne @run
  ldx d_seg
  lda seg_cut,x
  beq @freeze
  lda music_row
  lsr a
  and #3
  tax
  lda cut_fx,x
  cmp fx_next
  beq @run
  sta fx_next
  lda cut_var,x
  sta d_var
  jsr fx_init_call
  jmp @run
@freeze:
  lda #0
  sta ev_acc
  jmp apply_bright
@run:
  jsr fx_frame_call
  jsr apply_bright
  lda #0
  sta ev_acc
  sta d_init
  rts

cut_fx:  .byte FX_TUNNEL, FX_TWIST, FX_GRID, FX_BARS
cut_var: .byte 2, 3, 2, 3
; per segment: kick and snare flash strength (frames x4 of +1)
seg_fk:  .byte 0, 4, 2, 4, 5, 5, 5, 5, 3, 3, 4, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 2
seg_fs:  .byte 0, 6, 5, 7, 9, 9, 9, 9, 9, 9, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 4
seg_cut: .byte 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0

fx_init_call:
  lda #1
  sta d_init
  ldx fx_next
  lda fx_init_hi,x
  pha
  lda fx_init_lo,x
  pha
  rts
fx_frame_call:
  ldx fx_next
  lda fx_frame_hi,x
  pha
  lda fx_frame_lo,x
  pha
  rts
fx_init_lo: .byte <(bars_start-1), <(twist_start-1), <(grid_start-1), <(tunnel_start-1)
fx_init_hi: .byte >(bars_start-1), >(twist_start-1), >(grid_start-1), >(tunnel_start-1)
fx_frame_lo: .byte <(bars_run-1), <(twist_run-1), <(grid_run-1), <(tunnel_run-1)
fx_frame_hi: .byte >(bars_run-1), >(twist_run-1), >(grid_run-1), >(tunnel_run-1)

; ---- flashes and cues
;   cue 4: the gap before a drop, black.  cue 2: roll, strobe.  cue 3: drop impact, white fading.
;   kick / snare: brightness pulses scaled by d_fk / d_fs; snare also tints the picture (emphasis).
flashes:
  lda music_cue
  cmp #4
  bne :+
  lda #$FC
  sta bright
  rts
: cmp #2
  bne @nostrobe
  lda nmi_count
  and #2
  beq :+
  lda #3
: sta bright
  rts
@nostrobe:
  lda d_flash
  beq :+
  dec d_flash
: lda ev_acc
  and #$08                ; snare
  beq :+
  lda d_fs
  beq :+
  sta d_flash
  lda #6
  sta d_emph
: lda ev_acc
  and #$04                ; kick
  beq :+
  lda d_fk
  cmp d_flash
  bcc :+
  sta d_flash
: lda music_cue
  cmp #3
  bne :+
  cmp d_cue
  beq :+
  lda #18                 ; drop impact: white, fading
  sta d_flash
: lda music_cue
  sta d_cue
  lda d_flash
  lsr a
  lsr a
  cmp #5
  bcc :+
  lda #4
: clc
  adc d_fade
  bpl :+
  cmp #$FC
  bcs :+
  lda #$FC
: sta bright
  ; emphasis tint after a snare: red, then blue
  ldx #%00011110
  lda d_emph
  beq @e
  dec d_emph
  ldx #%00111110
  cmp #3
  bcs @e
  ldx #%10011110
@e:
  stx ppu_mask
  rts

; ---- per-effect wrappers: parameters by segment variant and time
; Speeds ramp with d_t; d_tq = d_t / 4 (saturating at 255).
bars_start:
  jsr bars_init
  jmp lanes_on
bars_run:
  ldx d_var
  lda bv_spd,x
  sta b_spd
  lda bv_amp,x
  sta b_amp
  lda bv_speed,x
  sta d_speed
  lda #NBARS
  sta b_count
  lda #0
  sta b_title
  cpx #0
  bne @n0
  ; intro: streaks accelerate, a bar per chord from frame 168, the title at 336
  lda d_tq
  lsr a
  lsr a
  lsr a
  adc #2
  sta d_speed
  lda d_t+1
  bne :+
  lda d_t
  cmp #168
  bcs :+
  lda #0
  beq @cnt
: lda d_t
  sec
  sbc #168
  sta t0
  lda d_t+1
  sbc #0
  lsr a
  lda t0
  ror a                   ; (t - 168) / 2
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; / 64 -> one bar every 64 frames
  clc
  adc #1
  cmp #NBARS+1
  bcc @cnt
  lda #NBARS
@cnt:
  sta b_count
  jsr title_window
  jmp @go
@n0:
  cpx #4
  bne @go
  ; outro: the title again in the last pattern, then everything fades to black
  jsr title_window_outro
@go:
  lda d_init              ; the switch frame shares the CPU with the previous effect's kernel
  beq :+
  lda #3
  cmp b_count
  bcs :+
  sta b_count
: jsr streaks_move
  jmp bars_frame

; Title for the intro: on from 336 to 672 (sliding in with a skew, out again); the outro shows it
; from 336 to the end.
title_window:
  lda #<672
  ldx #>672
  bne title_common
title_window_outro:
  lda #<700
  ldx #>700
title_common:
  sta t1
  stx t2
  lda #0
  sta b_title
  lda d_t
  sec
  sbc #<336
  sta t0
  lda d_t+1
  sbc #>336
  bcc @off                ; before 336
  bne @hi                 ; u >= 256
  lda t0
  cmp #48
  bcs @mid
  eor #$FF                ; sliding in: skew (48 - u) * 2
  sec
  adc #48
  asl a
  jmp @on
@hi:
  lda d_t                 ; past the end?
  cmp t1
  lda d_t+1
  sbc t2
  bcs @off
  lda t0
  cmp #<(288 - 256)
  bcc @mid
  sec
  sbc #<(288 - 256)       ; sliding out
  asl a
  jmp @on
@mid:
  lda #0
@on:
  sta b_tt
  lda #1
  sta b_title
@off:
  rts

; bar variants: intro, teaser, build 2, final, outro
bv_spd:   .byte 1, 3, 6, 5, 2
bv_amp:   .byte 50, 62, 66, 64, 56
bv_speed: .byte 8, 20, 40, 32, 12

twist_start:
  jsr twist_init
  jmp lanes_on
twist_run:
  ldx d_var
  lda tv_speed,x
  sta d_speed
  lda tv_spin,x
  sta tw_spin
  ; twist rate ramps up through the segment
  lda d_tq
  lsr a
  lsr a
  clc
  adc tv_rate,x
  bcc :+
  lda #255
: sta tw_rate
  jsr streaks_move
  jmp twist_frame
; variants: build, build (Reese), halftime, final
tv_speed: .byte 24, 32, 10, 40
tv_spin:  .byte 24, 48, 12, 80
tv_rate:  .byte 24, 40, 64, 72

grid_start:
  jsr grid_init
  jmp lanes_on
grid_run:
  ldx d_var
  lda gv_speed,x
  sta d_speed
  lda gv_zs,x
  sta g_speed+1
  lda gv_zf,x
  sta g_speed
  ; the sun rises in the halftime
  lda #KS + 4
  cpx #1
  bne :+
  lda d_tq
  lsr a
  lsr a
  eor #$FF
  clc
  adc #KS + 40
: sta g_sun
  jsr streaks_move
  jmp grid_frame
; variants: drop, halftime, final, final 2   (camera speed in cells per frame, 8.8)
gv_speed: .byte 16, 6, 24, 28
gv_zs:    .byte 12, 4, 16, 20
gv_zf:    .byte 0, 0, 0, 128

tunnel_start:
  jsr tunnel_init
  lda #1
  sta spr_mode
  lda #0
  sta pa_ready
  jsr lanes_hide
  ldx d_var
  lda tuv_pal_lo,x
  sta ptr2
  lda tuv_pal_hi,x
  sta ptr2+1
  jmp set_tunnel_cyc
tunnel_run:
  ldx d_var
  lda tuv_sf,x
  clc
  adc d_tq                ; accelerating through the segment
  sta tu_speed
  lda tuv_si,x
  adc #0
  sta tu_speed+1
  lda pa_ready             ; (not on the switch frame: it is shared with a kernel frame)
  bne :+
  inc pa_ready
  jmp tunnel_frame
: jsr parts_move
  jmp tunnel_frame
tuv_sf: .byte $80, $C0, $00
tuv_si: .byte 1, 1, 2
tuv_pal_lo: .byte <tu_cyc_a, <tu_cyc_b, <tu_cyc_c
tuv_pal_hi: .byte >tu_cyc_a, >tu_cyc_b, >tu_cyc_c
tu_cyc_a: .byte $24, $14, $03     ; magenta / violet / deep blue
tu_cyc_b: .byte $3C, $2C, $01     ; ice / cyan / navy
tu_cyc_c: .byte $28, $16, $06     ; yellow / red / ember

; copy a 3-colour ramp from (ptr2) into the 4 rotating palette slots
set_tunnel_cyc:
  ldx #0
: ldy #0
  lda (ptr2),y
  sta tu_cyc,x
  iny
  lda (ptr2),y
  sta tu_cyc+1,x
  iny
  lda (ptr2),y
  sta tu_cyc+2,x
  inx
  inx
  inx
  inx
  cpx #16
  bne :-
  rts

; ---- radial particles for the tunnel: 32 streaks flying out of the centre
NPART = 32
.segment "BSS"
pa_a: .res NPART         ; angle
pa_r: .res NPART         ; radius (integer)
pa_rf: .res NPART        ; radius fraction
pa_band: .res 32         ; sprites per 8-line band this frame
.segment "FX"

parts_init:
  ldx #NPART-1
: jsr rand
  sta pa_a,x
  jsr rand
  and #63
  clc
  adc #16
  sta pa_r,x
  dex
  bpl :-
  rts

parts_move:
  ldx #31
  lda #0
: sta pa_band,x
  dex
  bpl :-
  ldx #0                  ; particle
  ldy #128                ; OAM offset (slots 32-63)
@l:
  ; r += r / 16 + 0.75 (8.8: accelerating outwards)
  lda pa_r,x
  asl a
  asl a
  asl a
  asl a
  clc
  adc #192
  php
  clc
  adc pa_rf,x
  sta pa_rf,x
  lda pa_r,x
  lsr a
  lsr a
  lsr a
  lsr a
  adc pa_r,x
  plp
  adc #0
  sta pa_r,x
  cmp #150
  bcc :+
  jsr rand                ; respawn near the centre at a new angle
  sta pa_a,x
  lda #18
  sta pa_r,x
: stx t5
  ; y = 120 + sin(a) * r / 128
  lda pa_a,x
  tax
  lda sin_tab,x
  jsr pa_mul
  clc
  adc #120 - 4
  sta t3
  ; x = 128 + cos(a) * r / 128
  txa
  clc
  adc #64
  tax
  lda sin_tab,x
  ldx t5
  jsr pa_mul
  ldx t5
  ; x = 124 + dx, hidden if it left the screen (-124 <= dx < 124)
  cmp #$80
  bcs @neg
  cmp #124
  bcc @xok
@hidej:
  jmp @hide
@neg:
  cmp #<-124
  bcc @hidej
@xok:
  clc
  adc #128 - 4
  sta t4
  ; the far end of the tunnel is dark: nothing drawn inside r < 28
  lda pa_r,x
  cmp #28
  bcc @hidej
  ; on screen inside the picture?  (y in KS..KE-9)
  lda t3
  cmp #KS
  bcc @hide
  cmp #KE - 8
  bcs @hide
  ; at most 4 per 8-line band (a sprite covers 2 bands: <= 8 per line)
  lsr a
  lsr a
  lsr a
  sta t6
  stx t5
  tax
  lda pa_band,x
  cmp #4
  bcs @hide2
  inc pa_band,x
  inc pa_band+1,x
  ldx t5
  lda t3
  sta oam,y
  lda t4
  sta oam+3,y
  ; tile by direction: fold the angle into 0..64 and pick one of 5 slopes, flip by quadrant
  lda pa_a,x
  and #127
  cmp #64
  bcc :+
  eor #127
: clc
  adc #8
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..4
  asl a
  sta t6
  lda pa_r,x
  cmp #60
  lda #0
  rol a                   ; long streak when far out
  ora t6
  clc
  adc #SPR_RAD
  sta oam+1,y
  lda pa_a,x
  and #$C0                ; bit 7: up -> V flip; bit 6 x bit 7 -> H flip when x < 0
  sta t6
  lda pa_a,x
  clc
  adc #64
  and #$80                ; x < 0 for angles 64..191
  lsr a
  sta t7                  ; $40 = H flip
  lda t6
  and #$80                ; y < 0 for angles 128..255 -> V flip
  ora t7
  sta t7
  txa
  and #3
  ora t7
  sta oam+2,y
  jmp @next
@hide2:
  ldx t5
@hide:
  lda #$F8
  sta oam,y
@next:
  iny
  iny
  iny
  iny
  inx
  cpx #NPART
  beq :+
  jmp @l
: rts

; A = signed sin (-127..127), pa_r[t5] -> A = sin * r / 128 (signed). Keeps X.
pa_mul:
  stx t7
  ldx t5
  cmp #$80
  bcc @pos
  eor #$FF
  adc #0                  ; carry set: two's complement
  sta MMC5_MULA
  lda pa_r,x
  sta MMC5_MULB
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a
  eor #$FF
  clc
  adc #1
  ldx t7
  rts
@pos:
  sta MMC5_MULA
  lda pa_r,x
  sta MMC5_MULB
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a
  ldx t7
  rts

; =====================================================================================
; RAM routines: the floor handler, and the floor's row tables (both buffers)
ram_init:
  ldx #K_GRID_LEN-1
: lda k_grid_tpl,x
  sta k_grid,x
  dex
  bpl :-
  ldx #0
: lda g_row_floor,x
  sta grow0,x
  sta grow1,x
  inx
  bne :-
  ; floor curves: X scroll per line for 16 curve amounts (-8..7) x 6 px where the weight is 255
  ; curve_f[a][L - KS] = signed hi(|a - 8| * 6 * g_curve[L]), curve_c = that >> 3
  lda #<curve_f
  sta ptr0
  lda #>curve_f
  sta ptr0+1
  lda #<curve_c
  sta ptr1
  lda #>curve_c
  sta ptr1+1
  lda #0
  sta t2                  ; amount
@a:
  lda t2
  sec
  sbc #8
  sta t3                  ; signed
  bpl :+
  eor #$FF
  clc
  adc #1
: sta t0
  asl a
  adc t0
  asl a                   ; |s| * 6
  sta MMC5_MULA
  ldy #0
@l:
  lda g_curve+KS,y
  sta MMC5_MULB
  lda MMC5_MULB
  ldx t3
  bpl :+
  eor #$FF
  clc
  adc #1
: sta (ptr0),y
  lsr a
  lsr a
  lsr a
  sta (ptr1),y
  iny
  cpy #CURVE_STRIDE
  bne @l
  lda ptr0
  clc
  adc #CURVE_STRIDE
  sta ptr0
  bcc :+
  inc ptr0+1
: lda ptr1
  clc
  adc #CURVE_STRIDE
  sta ptr1
  bcc :+
  inc ptr1+1
: inc t2
  lda t2
  cmp #CURVE_N
  bne @a
  rts

; ------------------------------------------------------------------ palettes by variant
SPR_PALS = 0
.macro SPRPAL
  .byte $0F,$00,$10,$30, $0F,$01,$21,$31, $0F,$04,$14,$34, $0F,$07,$27,$37
.endmacro
pal_bars_lo: .byte <pb0, <pb1, <pb2, <pb3, <pb0
pal_bars_hi: .byte >pb0, >pb1, >pb2, >pb3, >pb0
pb0: .byte $0F,$01,$21,$31, $0F,$0C,$2C,$3C, $0F,$03,$23,$33, $0F,$17,$28,$38   ; intro: cool, gold title
  SPRPAL
pb1: .byte $0F,$04,$24,$34, $0F,$0C,$2C,$3C, $0F,$06,$27,$38, $0F,$17,$28,$30   ; teaser: hot neon
  SPRPAL
pb2: .byte $0F,$06,$16,$26, $0F,$07,$27,$37, $0F,$08,$28,$38, $0F,$05,$25,$35   ; build: fire
  SPRPAL
pb3: .byte $0F,$04,$24,$34, $0F,$0A,$2A,$3A, $0F,$02,$22,$32, $0F,$17,$28,$30   ; final
  SPRPAL
pal_twist_lo: .byte <pt0, <pt1, <pt2, <pt3
pal_twist_hi: .byte >pt0, >pt1, >pt2, >pt3
pt0: .byte $0F,$04,$15,$25, $0F,$0C,$1C,$2C, $0F,$07,$17,$27, $0F,$08,$18,$28
  SPRPAL
pt1: .byte $0F,$03,$13,$23, $0F,$01,$11,$21, $0F,$0C,$1C,$2C, $0F,$04,$14,$24
  SPRPAL
pt2: .byte $0F,$02,$12,$22, $0F,$03,$13,$23, $0F,$01,$11,$31, $0F,$0C,$1C,$3C
  SPRPAL
pt3: .byte $0F,$06,$16,$26, $0F,$07,$27,$37, $0F,$04,$15,$25, $0F,$08,$28,$38
  SPRPAL
pal_grid_lo: .byte <pg0, <pg1, <pg2, <pg3
pal_grid_hi: .byte >pg0, >pg1, >pg2, >pg3
pg0: .byte $0F,$01,$04,$14, $0F,$0F,$14,$24, $0F,$17,$27,$38, $0F,$04,$15,$25   ; neon magenta, gold sun
  SPRPAL
pg1: .byte $0F,$02,$03,$13, $0F,$0F,$13,$23, $0F,$06,$16,$27, $0F,$05,$06,$15   ; sunset
  SPRPAL
pg2: .byte $0F,$01,$0C,$1C, $0F,$0F,$1C,$2C, $0F,$14,$24,$34, $0F,$03,$14,$24   ; cyan grid, pink sun
  SPRPAL
pg3: .byte $0F,$01,$06,$16, $0F,$0F,$16,$26, $0F,$17,$28,$38, $0F,$06,$17,$27   ; red grid
  SPRPAL
