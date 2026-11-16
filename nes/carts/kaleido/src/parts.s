; =====================================================================================
;  Kaleido parts. Each has an init (called on the first frame it prepares) and a logic routine
;  (called every frame for the frame being prepared, vt / pt): it sets the next frame's writer
;  (wn_*, wq, LUT), palette (pal_src -> pal_buf) and sprites.
;  Song map (frames): toccata 0-1727 | exposition 1728-2879 | middle entries 2880-4031 |
;  A minor entry + toccata episode 4032-4607 | stretti 4608-5759 | dominant pedal 5760-6911 |
;  final entry + grand cadence 6912-8063.
; =====================================================================================

.macro PARTS_TABLE
  PART    0, rose_init,  rose_logic       ; toccata: the rose window lights up
  PART 1728, kal_init,   kal_logic        ; exposition: the kaleidoscope opens voice by voice
  PART 2880, jul_init,   jul_logic        ; middle entries: the endless Julia zoom
  PART 4032, tun_init,   tun_logic        ; A minor entry, toccata episode: the rose tunnel
  PART 4608, kal2_init,  kal2_logic       ; stretti: the kaleidoscope in mirror motion
  PART 5760, jul2_init,  jul2_logic       ; dominant pedal: the zoom accelerates
  PART 6912, fin_init,   fin_logic        ; final entry, grand cadence: the window blazes
.endmacro

.segment "RODATA"
.macro PART start, init, logic
  .byte <(start)
.endmacro
part_start_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, logic
  .byte >(start)
.endmacro
part_start_hi: PARTS_TABLE
.delmacro PART
.macro PART start, init, logic
  .byte <(init - 1)
.endmacro
part_init_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, logic
  .byte >(init - 1)
.endmacro
part_init_hi: PARTS_TABLE
.delmacro PART
.macro PART start, init, logic
  .byte <(logic - 1)
.endmacro
part_logic_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, logic
  .byte >(logic - 1)
.endmacro
part_logic_hi: PARTS_TABLE
.delmacro PART
NUM_PARTS = part_start_hi - part_start_lo

pal_bits: .byte $00, $40, $80, $C0
; beam profile: distance from the beam centre (0..63, wrapping) -> light level 0..3, as palette bits
beam_prof:
  .repeat 64, j
    .if j < 3 || j > 61
  .byte 3 << 6
    .elseif j < 7 || j > 57
  .byte 2 << 6
    .else
  .byte 1 << 6
    .endif
  .endrepeat
; glint animation: tile per age (16 frames)
glint_tile:
  .byte 1, 2, 3, 4, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 0

; Rose window palettes by light level (backdrop, then blue, ruby, gold glass)
rose_pal:
  .byte $0F, $0F, $0F, $0F        ; 0 unlit
  .byte $0F, $01, $05, $17        ; 1 dim
  .byte $0F, $11, $16, $28        ; 2 lit
  .byte $0F, $21, $26, $38        ; 3 bright
fin_pal:                          ; the finale: violet, emerald and gold
  .byte $0F, $0F, $0F, $0F
  .byte $0F, $03, $0A, $07
  .byte $0F, $13, $1A, $27
  .byte $0F, $24, $2A, $38
; glint sprite palette
glint_pal:
  .byte $0F, $27, $38, $30

; kaleidoscope palettes (backdrop, then glass classes 1..3): four jewel triads
kal_pal:
  .byte $0F, $02, $14, $28
  .byte $0F, $13, $27, $1C
  .byte $0F, $06, $12, $38
  .byte $0F, $1A, $04, $31
kal2_pal:
  .byte $0F, $11, $06, $28
  .byte $0F, $12, $16, $38
  .byte $0F, $13, $26, $37
  .byte $0F, $02, $15, $27

; Julia / tunnel band ramps (8 colours each, cycled)
ramp_ice:   .byte $01, $11, $21, $31, $3C, $2C, $1C, $0C
ramp_amber: .byte $06, $16, $26, $36, $37, $27, $17, $07
ramp_rose:  .byte $04, $14, $24, $34, $35, $25, $15, $05
ramp_jade:  .byte $0A, $1A, $2A, $3A, $3B, $2B, $1B, $0B
ramp_fire:  .byte $06, $16, $26, $36, $38, $28, $27, $17
ramp_royal: .byte $02, $12, $22, $32, $34, $24, $14, $04
jul_ramps_lo: .byte <ramp_amber, <ramp_rose, <ramp_royal, <ramp_ice
jul_ramps_hi: .byte >ramp_amber, >ramp_rose, >ramp_royal, >ramp_ice

.segment "CODE"

; ------------------------------------------------------------------ shared part helpers

; pt -> bar index (A, also t6) and frame within the bar (t7)
bar_of_pt:
  lda pt
  sta t7
  lda pt+1
  sta t4
  ldx #0
@l:
  lda t7
  sec
  sbc #<BAR
  tay
  lda t4
  sbc #>BAR
  bcc @done
  sta t4
  sty t7
  inx
  bne @l
@done:
  stx t6
  txa
  rts

; Consume the music events gathered since the last frame -> A (events), Y (notes)
take_events:
  lda notes
  tay
  lda #0
  sta notes
  lda ev
  pha
  lda #0
  sta ev
  pla
  rts

; Copy 16 bytes of BG palette from (ptr0) into pal_src.
set_bgpal:
  ldy #15
: lda (ptr0),y
  sta pal_src,y
  dey
  bpl :-
  rts

; Julia/tunnel band palettes: ramp at (ptr0), band offset A. Window w shows bands 2w..2w+2.
band_pal:
  sta t0
  ldx #0
@w:
  txa
  asl a
  asl a
  tay                     ; palette w starts at 4w
  lda #$0F
  sta pal_src,y
  txa
  asl a
  clc
  adc t0
  sta t1                  ; its first band
  lda #3
  sta t2
@c:
  iny
  sty t3
  lda t1
  and #7
  tay
  lda (ptr0),y
  ldy t3
  sta pal_src,y
  inc t1
  dec t2
  bne @c
  inx
  cpx #4
  bne @w
  rts

; Glints: spawn one at a random gold feature (A != 0), then age and draw them all into OAM.
glints:
  cmp #0
  beq @age
  ldx #0
: lda gl_age,x
  beq @spawn
  inx
  cpx #NGL
  bne :-
  beq @age
@spawn:
  stx t0
  jsr rand
  and #63
  cmp #glint_n
  bcc :+
  sbc #glint_n
: tay
  ldx t0
  lda glint_px,y
  sta gl_x,x
  lda glint_py,y
  sta gl_y,x
  lda #1
  sta gl_age,x
@age:
  ldx #0
  ldy #0
@g:
  lda gl_age,x
  beq @hide
  inc gl_age,x
  cmp #16
  bcc :+
  lda #0
  sta gl_age,x
  beq @hide
: sty t1
  tay
  lda glint_tile-1,y
  ldy t1
  sta oam+1,y
  lda gl_y,x
  sta oam,y
  lda #0
  sta oam+2,y
  lda gl_x,x
  sta oam+3,y
  jmp @next
@hide:
  lda #$F8
  sta oam,y
@next:
  iny
  iny
  iny
  iny
  inx
  cpx #NGL
  bne @g
  rts

; A ring of 8 gems in 8-fold symmetry: t0 = radius (<= 110), t1 = angle, t2 = tile, t3 = attr;
; written at oam_i, which advances by 32.
gem_ring:
  lda #8
  sta t4
@g:
  ldy t1
  lda sin_tab,y
  jsr scale_r
  clc
  adc #120-4
  sta t5
  lda t1
  clc
  adc #64
  tay
  lda sin_tab,y
  jsr scale_r
  clc
  adc #128-4
  ldx oam_i
  sta oam+3,x
  lda t5
  sta oam,x
  lda t2
  sta oam+1,x
  lda t3
  sta oam+2,x
  txa
  clc
  adc #4
  sta oam_i
  lda t1
  clc
  adc #32
  sta t1
  dec t4
  bne @g
  rts

; A = signed sine (-127..127), t0 = radius -> A = signed radius * sine / 128
scale_r:
  php
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULA
  lda t0
  sta MMC5_MULB
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a
  plp
  bpl :+
  eor #$FF
  clc
  adc #1
: rts

; The Julia parts' jewels: three counter-rotating rings of 8 gems (t6 = number of rings 1..3),
; radii pulsing with the bass. pv+12..14 angles, pv+15 pulse.
gem_rings:
  jsr oam_clear
  lda #0
  sta oam_i
  lda notes
  and #4                  ; bass note-on: a pulse (notes are read before take_events clears them)
  beq :+
  lda #6
  sta pv+15
: lda pv+15
  beq :+
  dec pv+15
: inc pv+12
  dec pv+13
  dec pv+13
  inc pv+14
  ldx #0
@r:
  cpx t6
  bcs @done
  stx t7
  lda gem_rad,x
  clc
  adc pv+15
  sta t0
  lda pv+12,x
  sta t1
  lda gem_tile,x
  sta t2
  lda gem_attr,x
  sta t3
  jsr gem_ring
  ldx t7
  inx
  bne @r
@done:
  rts

.segment "RODATA"
gem_rad:  .byte 34, 66, 98
gem_tile: .byte 8, 7, 6
gem_attr: .byte 1, 2, 3
.segment "CODE"

; Sprite palettes for the gems from the band ramp at (ptr0): dark, bright, white.
gem_pal:
  ldx #4
@p:
  lda #$0F
  sta pal_src+16,x
  ldy gem_pal_idx-4,x
  lda (ptr0),y
  sta pal_src+17,x
  ldy gem_pal_idx-3,x
  lda (ptr0),y
  sta pal_src+18,x
  lda #$30
  sta pal_src+19,x
  txa
  clc
  adc #4
  tax
  cpx #16
  bne @p
  rts
.segment "RODATA"
gem_pal_idx: .byte 1, 3, 2, 3, 0, 2, 0, 0, 1, 3, 0, 0
.segment "CODE"

; LUT for the rose window: 64 entries from the beam profile, phase j = (i * n + rot) & 63.
; t2 = n, t3 = rot; entries ORed with t4 (minimum level bits).
rose_beams:
  jsr lut_begin
  lda t3
  sta t0
  ldy #0
@l:
  lda t0
  and #63
  tax
  lda beam_prof,x
  cmp t4
  bcs :+
  lda t4
: sta (ptr1),y
  lda t0
  clc
  adc t2
  sta t0
  iny
  cpy #64
  bne @l
  rts

; Fill the next LUT's 64 entries with A.
lut_const:
  pha
  jsr lut_begin
  pla
  ldy #63
: sta (ptr1),y
  dey
  bpl :-
  rts

; Rose window light levels into the palette: A = 0 normal, 1 finale colours.
rose_palettes:
  ldx #15
  cmp #0
  bne @fin
: lda rose_pal,x
  sta pal_src,x
  dex
  bpl :-
  bmi @spr
@fin:
: lda fin_pal,x
  sta pal_src,x
  dex
  bpl :-
@spr:
  ldx #3
: lda glint_pal,x
  sta pal_src+16,x
  dex
  bpl :-
  rts

rose_writer:
  lda #CHR_ROSE
  sta wq
  lda #CHR_ROSE+1
  sta wq+1
  lda #CHR_ROSE+2
  sta wq+2
  lda #CHR_ROSE+3
  sta wq+3
  rts

; ------------------------------------------------------------------ part 0: the rose window
rose_init:
  jsr oam_clear
  lda #0
  sta fade
  ldx #NGL-1
: sta gl_age,x
  dex
  bpl :-
  lda ppu_ctrl
  and #$FE
  sta ppu_ctrl            ; page A
  lda #$24
  sta t0
  lda #DB_NT
  ldx #<nt_kal
  ldy #>nt_kal
  jmp queue_nt            ; the kaleidoscope's layout into page B

rose_logic:
  jsr rose_writer
  lda #0
  jsr rose_palettes
  jsr take_events
  tya
  and #1                  ; soprano note-ons make glints
  sta t5
  jsr bar_of_pt           ; A = bar 0..11, t7 = frame in bar
  cmp #4
  bcs @beams
  ; bars 1-4: the window lights ring by ring, a bright front running outward on each chord
  tax
  lda rose_front0,x
  sta t1                  ; start
  lda rose_front,x
  sec
  sbc t1
  sta t0                  ; span
  lda t7
  cmp #48
  bcc :+
  lda #48
: lsr a
  lsr a
  tax                     ; 0..12 over the first beat and a third
  lda t0
  jsr mul8                ; Y = span * x
  tya
  ldx #0
@div12:
  cmp #12
  bcc @dd
  sbc #12
  inx
  bne @div12
@dd:
  txa
  clc
  adc t1
  sta t2                  ; the front
  jsr lut_begin
  ldy #0
@rl:
  tya
  clc
  adc #4
  cmp t2
  bcs :+
  lda #2 << 6             ; lit
  bne @st
: tya
  cmp t2
  bcs :+
  lda #3 << 6             ; the bright front
  bne @st
: lda #0
@st:
  sta (ptr1),y
  iny
  cpy #64
  bne @rl
  lda #DB_RRAD
  jsr use_lut
  lda t5
  ldx t6
  cpx #1
  bcs :+
  lda #0                  ; no glints in the first bar
: jsr glints
  jmp apply_fade
@beams:
  cmp #8
  bcs @spiral
  ; bars 5-8: beams of light turn around the window, more of them every bar
  sec
  sbc #4
  tax
  lda beam_count,x
  sta t2
  lda pt
  asl a
  sta t3
  lda #1 << 6
  sta t4
  jsr rose_beams
  lda #DB_RANG
  jsr use_lut
  lda t5
  jsr glints
  jmp apply_fade
@spiral:
  cmp #10
  bcs @pulse
  ; bars 9-10: the diminished cascade: a spiral of light pours inward
  lda #3
  sta t2
  lda pt
  asl a
  asl a
  eor #$FF
  sta t3
  lda #1 << 6
  sta t4
  jsr rose_beams
  lda #DB_RSPI
  jsr use_lut
  lda t5
  jsr glints
  jmp apply_fade
@pulse:
  cmp #11
  bcs @hold
  ; bar 11: the scale: a ring of light rises from the centre to the rim
  lda t7
  lsr a
  lsr a
  sta t0
  lsr a
  clc
  adc t0                  ; ~ 0.375 * frame: 0..53
  sta t2
  jsr lut_begin
  ldy #0
@pl:
  tya
  sec
  sbc t2
  bcs :+
  eor #$FF
  adc #1
: cmp #4
  lda #2 << 6
  bcs :+
  lda #3 << 6
: sta (ptr1),y
  iny
  cpy #64
  bne @pl
  lda #DB_RRAD
  jsr use_lut
  lda t5
  jsr glints
  jmp apply_fade
@hold:
  ; bar 12: the dominant chord held, everything bright, then darkness (the breath)
  lda #3 << 6
  jsr lut_const
  lda #DB_RRAD
  jsr use_lut
  lda t7
  cmp #80
  bcc @nofade
  sbc #80
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..3
  cmp #4
  bcc :+
  lda #4
: eor #$FF
  clc
  adc #1
  sta fade
@nofade:
  lda #0
  jsr glints
  jmp apply_fade

.segment "RODATA"
rose_front0: .byte 0, 21, 40, 52
rose_front:  .byte 21, 40, 52, 58
beam_count:  .byte 2, 3, 4, 6
.segment "CODE"

; ------------------------------------------------------------------ part 1: kaleidoscope
kal_init:
  jsr oam_clear
  lda #0
  sta fade
  sta pv+0                ; animation step
  sta pv+1                ; sub-frame
  lda ppu_ctrl
  ora #1
  sta ppu_ctrl            ; page B
  lda #$20
  sta t0
  lda #DB_NT
  ldx #<nt_julia
  ldy #>nt_julia
  jmp queue_nt            ; the Julia layout into page A

; Build the kaleidoscope LUT: t0 = visible rings (0..63), t1 = step, t2 = palette shift,
; t3 = 0 forward delays / $FF reversed. Entry i: bank KAL + ((step - i/2) & 15) | palette.
kal_lut:
  jsr lut_begin
  ldy #0
@l:
  cpy t0
  bcc :+
  beq :+
  lda #CHR_BLANK
  bne @st
: tya
  lsr a
  eor t3
  sta t4
  lda t1
  sec
  sbc t4
  and #15
  clc
  adc #CHR_KAL
  sta t4
  tya
  lsr a
  lsr a
  lsr a
  clc
  adc t2
  and #3
  tax
  lda pal_bits,x
  ora t4
@st:
  sta (ptr1),y
  iny
  cpy #64
  bne @l
  lda #0
  sta wq
  sta wq+1
  sta wq+2
  sta wq+3
  rts

; advance the animation: one step every t0 frames (pv+1 counts)
kal_step:
  inc pv+1
  lda pv+1
  cmp t0
  bcc :+
  lda #0
  sta pv+1
  inc pv+0
: rts

kal_logic:
  lda #3
  sta t0
  jsr kal_step
  ldx #15
: lda kal_pal,x
  sta pal_src,x
  dex
  bpl :-
  jsr take_events
  ; how far each mirror group is open (rings 0..15): the subject alone opens the two wedges
  ; on the horizontal mirror, the answer adds the vertical ones (now eight-fold), the bass entry
  ; opens the kaleidoscope to the whole screen
  jsr bar_of_pt           ; t6 = bar, t7 = frame in bar
  lda t7
  lsr a
  lsr a
  lsr a
  lsr a
  sta t0                  ; 0..8 over the bar
  ldx #0
@gr:
  txa                     ; table index = (group * 8 + bar) * 2
  asl a
  asl a
  asl a
  clc
  adc t6
  asl a
  tay
  lda kal_open,y          ; start ($80 = shut)
  bmi @shut
  clc
  adc t0
  cmp kal_open+1,y        ; end
  bcc @ok
  lda kal_open+1,y
  bcs @ok
@shut:
  lda #$FF
@ok:
  sta pv+8,x
  inx
  cpx #2
  bne @gr
  ; LUT: entry i = ring + 16 * group
  jsr lut_begin
  ldy #0
@l:
  tya
  lsr a
  lsr a
  lsr a
  lsr a
  tax                     ; group
  tya
  and #15
  sta t4                  ; ring
  lda pv+8,x
  bmi @blank
  cmp t4
  bcc @blank
  ; bank: KAL + ((step - ring) & 15); palette: (ring / 2 + shift) & 3
  lda pv+0
  sec
  sbc t4
  and #15
  clc
  adc #CHR_KAL
  sta t5
  lda t4
  lsr a
  sta t3
  lda pt
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  eor #$FF
  clc
  adc t3
  and #3
  tax
  lda pal_bits,x
  ora t5
  bne @st
@blank:
  lda #CHR_BLANK
@st:
  sta (ptr1),y
  iny
  cpy #32
  bne @l
  lda #0
  sta wq
  sta wq+1
  sta wq+2
  sta wq+3
  lda #DB_KMASK
  jsr use_lut
  jsr oam_clear
  jmp apply_fade

.segment "RODATA"
; per mirror group and bar of the exposition: (start, end) radius in rings, $80 = shut
kal_open:
  .byte 0,6,  6,9,  9,9,  9,9,  9,15,  15,15,  15,15,  15,15
  .byte $80,0, $80,0,  0,6,  6,9,  9,15,  15,15,  15,15,  15,15
.segment "CODE"

; ------------------------------------------------------------------ part 2: Julia zoom
jul_init:
  lda #12
  sta flash
  jsr oam_clear
  lda #0
  sta fade
  sta pv+0                ; frame 0..11
  sta pv+1                ; sub-frame
  sta pv+2                ; band offset
  sta pv+3                ; cycle counter
  lda ppu_ctrl
  and #$FE
  sta ppu_ctrl            ; page A
  lda #$24
  sta t0
  lda #DB_NT
  ldx #<nt_seq
  ldy #>nt_seq
  jmp queue_nt            ; the tunnel layout into page B

; Advance the zoom: a new frame every t0 frames; at the loop seam the bands shift by 3.
jul_step:
  inc pv+1
  lda pv+1
  cmp t0
  bcc @r
  lda #0
  sta pv+1
  inc pv+0
  lda pv+0
  cmp #JULIA_FRAMES
  bcc @r
  lda #0
  sta pv+0
  lda pv+2
  sec
  sbc #3                  ; zoomed in by lambda^4: escape times +4, bands +3
  and #7
  sta pv+2
@r:
  rts

; Set the COPY writer for Julia frame pv+0
jul_writer:
  lda pv+0
  lsr a
  lsr a
  lsr a
  clc
  adc #DB_JULIA
  pha
  lda pv+0
  and #7
  asl a
  asl a
  adc #$A0
  tax
  pla
  jmp use_copy

jul_logic:
  lda #3                  ; a frame every 3: one loop (x1.27) per beat
  sta t0
  jsr jul_step
  jsr jul_writer
  lda #2
  sta t6
  jsr gem_rings
  jsr take_events
  ; colours change every two bars: amber (F major entry), rose (episode), royal (G minor
  ; entry in the bass), ice (episode)
  jsr bar_of_pt
  lsr a
  and #3
  tax
  lda jul_ramps_lo,x
  sta ptr0
  lda jul_ramps_hi,x
  sta ptr0+1
  lda pt
  lsr a
  lsr a
  lsr a
  lsr a
  clc
  adc pv+2
  and #7
  jsr band_pal
  jsr gem_pal
  jmp apply_fade

; ------------------------------------------------------------------ part 3: rose tunnel
tun_init:
  lda #12
  sta flash
  jsr oam_clear
  lda #0
  sta fade
  sta pv+5
  lda ppu_ctrl
  ora #1
  sta ppu_ctrl            ; page B
  lda #$20
  sta t0
  lda #DB_NT
  ldx #<nt_kal
  ldy #>nt_kal
  jmp queue_nt            ; the kaleidoscope into page A

tun_logic:
  jsr take_events
  and #4                  ; timpani: a flash
  beq :+
  lda #2
  sta pv+5
: ; the first two bars: the eight-petal flower; then (timpani, tambourine) the twelve-petal one
  lda pt+1
  bne @two
  lda pt
  cmp #<288
  bcs @two
  lda #DB_TUN
  ldx #>ex_tun
  jsr use_copy
  lda #<ramp_rose
  ldx #>ramp_rose
  jmp @pal
@two:
  lda #DB_TUN
  ldx #>ex_tun2
  jsr use_copy
  lda #<ramp_fire
  ldx #>ramp_fire
@pal:
  sta ptr0
  stx ptr0+1
  ; bands flow inward: the flower zooms forever
  lda pt
  lsr a
  lsr a
  eor #$FF
  jsr band_pal
  lda pv+5
  sta fade
  beq :+
  dec pv+5
: jsr oam_clear
  jmp apply_fade

; ------------------------------------------------------------------ part 4: kaleidoscope, stretti
kal2_init:
  lda #12
  sta flash
  jsr oam_clear
  lda #0
  sta fade
  sta pv+0
  sta pv+1
  sta pv+5
  lda ppu_ctrl
  and #$FE
  sta ppu_ctrl            ; page A
  lda #$24
  sta t0
  lda #DB_NT
  ldx #<nt_julia
  ldy #>nt_julia
  jmp queue_nt            ; Julia into page B

kal2_logic:
  lda #2
  sta t0
  jsr kal_step
  ldx #15
: lda kal2_pal,x
  sta pal_src,x
  dex
  bpl :-
  jsr take_events
  and #4
  beq :+
  lda #2
  sta pv+5
: lda #63
  sta t0
  ; the second stretto (the inversion): the time runs backwards
  lda pt+1
  cmp #>PAT
  bcc @fwd
  bne @rev
  lda pt
  cmp #<PAT
  bcc @fwd
@rev:
  lda #0
  sec
  sbc pv+0
  sta t1
  lda #$FF
  sta t3
  bne @go
@fwd:
  lda pv+0
  sta t1
  lda #0
  sta t3
@go:
  lda pt
  lsr a
  lsr a
  lsr a
  eor #$FF
  sta t2
  jsr kal_lut
  lda #DB_KSPI
  jsr use_lut
  lda pv+5
  sta fade
  beq :+
  dec pv+5
: jsr oam_clear
  jmp apply_fade

; ------------------------------------------------------------------ part 5: the zoom accelerates
jul2_init:
  lda #12
  sta flash
  jsr oam_clear
  lda #0
  sta fade
  sta pv+0
  sta pv+1
  sta pv+2
  lda ppu_ctrl
  ora #1
  sta ppu_ctrl            ; page B
  lda #$20
  sta t0
  lda #DB_NT
  ldx #<nt_seq
  ldy #>nt_seq
  jmp queue_nt            ; the rose window into page A

jul2_logic:
  lda #3
  sta t6
  jsr gem_rings
  jsr bar_of_pt
  ; bars 1-4: a frame every 3; bars 5-6: every 2; bars 7-8: every frame
  ldx #3
  cmp #4
  bcc :+
  ldx #2
  cmp #6
  bcc :+
  ldx #1
: stx t0
  jsr jul_step
  jsr jul_writer
  jsr take_events
  lda #<ramp_jade
  ldx #>ramp_jade
  ldy t6
  cpy #4
  bcc :+
  lda #<ramp_fire
  ldx #>ramp_fire
: sta ptr0
  stx ptr0+1
  lda pt
  lsr a
  lsr a
  lsr a
  clc
  adc pv+2
  and #7
  jsr band_pal
  jsr gem_pal
  lda #0
  sta fade
  ; the last bar's breath: brighten to white
  lda t6
  cmp #7
  bne :+
  lda t7
  cmp #108
  bcc :+
  sbc #108
  lsr a
  lsr a
  lsr a
  sta fade
: jmp apply_fade

; ------------------------------------------------------------------ part 6: the window blazes
fin_init:
  jsr oam_clear
  lda #0
  sta fade
  ldx #NGL-1
: sta gl_age,x
  dex
  bpl :-
  lda ppu_ctrl
  and #$FE
  sta ppu_ctrl            ; page A
  rts

fin_logic:
  jsr rose_writer
  lda #1
  jsr rose_palettes
  jsr take_events
  tya
  and #3
  sta t5
  jsr bar_of_pt
  cmp #4
  bcs @cad
  ; final entry: the whole window lit, a spiral of white light turning through it
  lda #4
  sta t2
  lda pt
  sta t3
  lda #2 << 6
  sta t4
  jsr rose_beams
  lda #DB_RSPI
  jsr use_lut
  lda #0
  sta fade
  lda t5
  jsr glints
  jmp apply_fade
@cad:
  cmp #6
  bcs @chord
  ; the cadence chords: twelve beams
  lda #12
  sta t2
  lda pt
  asl a
  sta t3
  lda #2 << 6
  sta t4
  jsr rose_beams
  lda #DB_RANG
  jsr use_lut
  lda #0
  sta fade
  lda t5
  jsr glints
  jmp apply_fade
@chord:
  ; D major: everything blazing, a white flash, then the light goes out for the loop
  lda #3 << 6
  jsr lut_const
  lda #DB_RRAD
  jsr use_lut
  lda t6
  cmp #6
  bne @out
  lda t7
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..4 over the bar
  sta t0
  lda #4
  sec
  sbc t0
  bpl :+
  lda #0
: sta fade
  jmp @g
@out:
  lda t7
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a                   ; 0..4
  eor #$FF
  clc
  adc #1
  sta fade
@g:
  lda t5
  jsr glints
  jmp apply_fade
