; =====================================================================================
;  Parts and timeline. Everything is keyed to the song position tl_frame (0..9215), which the
;  NMI re-syncs to music_order at every pattern. 768 frames per pattern (12.8 s).
;
;   0     DAWN     out of the dark: the pool floor's light network fades up; the title floats
;   1536  POOL     full sun on the pool floor, glints on the bell notes
;   3072  RAIN     drops: tile by tile, from the centre outwards, the light dissolves into rings
;   4608  LATTICE  a white flash; standing-wave interference, rainbow emphasis bands, tension
;   6144  SUN      release: golden caustics, deepest ripples, thumping light
;   8448  DUSK     the light fades to night and the demo loops
; =====================================================================================
.segment "CODE2"

PATTERN = 768
SONG_LEN = 9216

; part-common state (zero page)
.segment "ZEROPAGE"
tg1: .res 1             ; amplitude targets
tg2: .res 1
tg3: .res 1
ph1: .res 1             ; phase fractions (kp1..3 are the integer parts)
ph2: .res 1
ph3: .res 1
v1: .res 2              ; phase velocities (8.8, signed)
v2: .res 2
v3: .res 2
xv: .res 2              ; horizontal drift (8.8)
xf: .res 1
kick: .res 1            ; extra vertical ripple from impulses, decays
ramp: .res 2            ; current palette ramp
rstep: .res 1           ; its step (0..15), 8.8 with rfrac
rfrac: .res 1
rspeed: .res 1          ; ramp steps per frame (x/256)
title_a: .res 1         ; title brightness 0..15
title_v: .res 1         ; title fade direction (signed per 8 frames)
glint_on: .res 1        ; 1 = spawn glints on bell notes
glint_pal: .res 1       ; sprite palette for glints (0 = blue, 1 = gold)
evt: .res 1             ; music events this frame
flash: .res 1           ; frames since a white flash started ($FF = none)
flash_half: .res 1      ; CHR half to switch to under the flash
kms_v: .res 1           ; emphasis scroll speed (signed, per frame)
kms_f: .res 1
gx: .res 8
gy: .res 8
gl: .res 8              ; glint life
last_a1: .res 1
last_a2: .res 1
last_a3: .res 1
last_step: .res 1
oam_used: .res 1
.segment "CODE2"

.macro PARTS_TABLE
  PART    0, dawn_init,  dawn_frame
  PART 1536, pool_init,  pool_frame
  PART 3072, rain_init,  rain_frame
  PART 4608, latt_init,  latt_frame
  PART 6144, sun_init,   sun_frame
  PART 8448, dusk_init,  dusk_frame
.endmacro

.macro PART start, init, frame
  .byte <(start)
.endmacro
part_start_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, frame
  .byte >(start)
.endmacro
part_start_hi: PARTS_TABLE
.delmacro PART
.macro PART start, init, frame
  .byte <(init - 1)
.endmacro
part_init_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, frame
  .byte >(init - 1)
.endmacro
part_init_hi: PARTS_TABLE
.delmacro PART
.macro PART start, init, frame
  .byte <(frame - 1)
.endmacro
part_frame_lo: PARTS_TABLE
.delmacro PART
.macro PART start, init, frame
  .byte >(frame - 1)
.endmacro
part_frame_hi: PARTS_TABLE
.delmacro PART
NUM_PARTS = part_start_hi - part_start_lo

; Pick the part for tl_frame; call its init on a change. Computes part_t.
timeline:
  lda tl_frame+1
  cmp #>SONG_LEN
  bcc :+
  lda #0                  ; (before the first music_play tl_frame is $FFFF)
  sta tl_frame
  sta tl_frame+1
: ldx #NUM_PARTS-1
@find:
  lda tl_frame+1
  cmp part_start_hi,x
  bcc @next
  bne @found
  lda tl_frame
  cmp part_start_lo,x
  bcs @found
@next:
  dex
  bpl @find
  ldx #0
@found:
  sec
  lda tl_frame
  sbc part_start_lo,x
  sta part_t
  lda tl_frame+1
  sbc part_start_hi,x
  sta part_t+1
  cpx part
  beq @same
  stx part
  lda part_init_hi,x
  pha
  lda part_init_lo,x
  pha
@same:
  rts

part_frame:
  lda music_events
  sta evt
  ldx part
  lda part_frame_hi,x
  pha
  lda part_frame_lo,x
  pha
  rts

; ------------------------------------------------------------------ common machinery

; Per-frame: phases, drift, amplitude easing, ramp, emphasis scroll, flash, sprites.
common:
  ; phases
  clc
  lda ph1
  adc v1
  sta ph1
  lda kp1
  adc v1+1
  sta kp1
  clc
  lda ph2
  adc v2
  sta ph2
  lda kp2
  adc v2+1
  sta kp2
  clc
  lda ph3
  adc v3
  sta ph3
  lda kp3
  adc v3+1
  sta kp3
  clc
  lda xf
  adc xv
  sta xf
  lda kxb
  adc xv+1
  sta kxb
  ; emphasis scroll
  clc
  lda kms_f
  adc kms_v
  sta kms_f
  lda kms_v
  and #$80
  beq :+
  lda #$FF
: adc kms
  sta kms
  ; amplitudes ease towards their targets, one pixel every 8 frames
  lda nmi_count
  and #7
  bne @noease
  ldx #2
@e:
  lda amp1,x
  cmp tg1,x
  beq @n
  bcc :+
  dec amp1,x
  bcs @n
: inc amp1,x
@n:
  dex
  bpl @e
  lda kick
  beq @noease
  dec kick
@noease:
  ; vertical amplitude including the impulse
  lda amp3
  pha
  clc
  adc kick
  cmp #AMP_MAX+1
  bcc :+
  lda #AMP_MAX
: sta amp3
  cmp last_a3
  bne @set
  lda amp1
  cmp last_a1
  bne @set
  lda amp2
  cmp last_a2
  beq @noset
@set:
  lda amp1
  sta last_a1
  lda amp2
  sta last_a2
  lda amp3
  sta last_a3
  jsr kernel_amps
@noset:
  pla
  sta amp3
  ; palette ramp
  clc
  lda rfrac
  adc rspeed
  sta rfrac
  bcc :+
  lda rstep
  cmp #15
  bcs :+
  inc rstep
: lda rstep
  cmp last_step
  beq :+
  sta last_step
  jsr apply_ramp
: jsr flash_step
  jsr sprites
  rts

; Copy step rstep of the ramp at (ramp) into the BG palette.
apply_ramp:
  lda rstep
  asl a
  asl a
  asl a
  asl a
  tay
  ldx #0
: lda (ramp),y
  sta pal_buf,x
  iny
  inx
  cpx #16
  bne :-
  lda pal_buf             ; $3F10 mirrors the backdrop and is uploaded after it
  sta pal_buf+16
  lda #1
  sta pal_dirty
  rts

; Start ramp A=lo, X=hi at step 0 with Y = speed (steps per frame x 256).
start_ramp:
  sta ramp
  stx ramp+1
  sty rspeed
  lda #0
  sta rstep
  sta rfrac
  lda #$FF
  sta last_step           ; force an update
  rts

; A white flash that hides a world change: Y = CHR half afterwards, then ramp (A, X).
start_flash:
  sty flash_half
  ldy #36
  jsr start_ramp
  lda #0
  sta flash
  sta zrun
  sta zstage              ; every tile back to world bit 0 within four frames
  lda #1
  sta tspeed+1
  lda #0
  sta tspeed
  rts

flash_step:
  lda flash
  cmp #$FF
  beq @r
  inc flash
  lda flash
  cmp #6
  bne :+
  lda flash_half
  sta chr_half
: cmp #10
  bcc @hold
  lda #$FF
  sta flash
  rts
@hold:
  lda #0                  ; hold the ramp at its first (white) step while the tiles change
  sta rstep
  sta rfrac
  lda #$FF
  sta last_step
@r:
  rts

; Set the emphasis page (A = 0..7) and scroll speed (X, signed per frame x 256).
set_emph:
  clc
  adc #>EMPH
  sta kmt+1
  lda #0
  sta kmt
  stx kms_v
  rts

; ------------------------------------------------------------------ sprites: title and glints
TITLE_X = 86
TITLE_Y = 106

sprites:
  ldx #0
  ; title
  lda title_a
  beq @notitle
  lda #0
  sta t0                  ; letter index
@tl:
  ldy t0
  lda title_letters,y
  sta t1                  ; tile
  ; bob: y offset from the 2 px sine page
  lda nmi_count
  asl a
  clc
  adc title_phase,y
  tay
  lda SINE+2*256,y
  clc
  adc #TITLE_Y
  sta oam,x
  clc
  adc #8
  sta oam+4,x
  lda t1
  sta oam+1,x
  clc
  adc #1
  sta oam+5,x
  lda #0
  sta oam+2,x
  sta oam+6,x
  ldy t0
  lda title_xs,y
  sta oam+3,x
  sta oam+7,x
  txa
  clc
  adc #8
  tax
  inc t0
  lda t0
  cmp #7
  bne @tl
@notitle:
  ; glints
  ldy #7
@g:
  lda gl,y
  beq @gnext
  sec
  sbc #1
  sta gl,y
  beq @gnext
  lsr a
  lsr a
  lsr a                   ; 0..3: life 32 -> big, small at the ends
  sty t0
  tay
  lda glint_tiles,y
  ldy t0
  sta oam+1,x
  lda gy,y
  sta oam,x
  lda gx,y
  sta oam+3,x
  lda #1
  sta oam+2,x
  inx
  inx
  inx
  inx
@gnext:
  dey
  bpl @g
  ; hide what was used last frame and is not now
  stx t2
  lda #$F8
: cpx oam_used
  bcs :+
  sta oam,x
  inx
  inx
  inx
  inx
  bne :-
: lda t2
  sta oam_used
  ; title palette (sprite palette 0) and glint palette (1)
  lda title_a
  tay
  lda title_halo,y
  sta pal_buf+17
  sta pal_buf+18
  lda title_core,y
  sta pal_buf+19
  ldy glint_pal
  lda glint_c1,y
  sta pal_buf+21
  lda glint_c2,y
  sta pal_buf+22
  lda glint_c3,y
  sta pal_buf+23
  lda #1
  sta pal_dirty
  ; title fade
  lda nmi_count
  and #7
  bne @r
  lda title_a
  clc
  adc title_v
  bmi @zero
  cmp #16
  bcc :+
  lda #15
: sta title_a
@r:
  rts
@zero:
  lda #0
  sta title_a
  rts

; Spawn a glint at a random spot (in the framed area) if a slot is free.
spawn_glint:
  ldy #7
: lda gl,y
  beq @free
  dey
  bpl :-
  rts
@free:
  jsr rand
  and #127
  adc #64
  sta gx,y
  jsr rand
  and #127
  adc #44
  cmp #200
  bcc :+
  sbc #64
: sta gy,y
  lda #32
  sta gl,y
  rts

; Glints on the lead (bell) note-ons.
glints_on_bells:
  lda glint_on
  beq :+
  lda evt
  and #$20
  beq :+
  jsr spawn_glint
: rts

.segment "RODATA2"
title_letters: .byte 2, 4, 6, 8, 10, 12, 2         ; C A U S T I C
title_xs:
  .repeat 7, i
  .byte TITLE_X + i * 12
  .endrepeat
title_phase: .byte 0, 37, 74, 111, 148, 185, 222
title_halo: .byte $0C,$0C,$0C,$0C,$0C,$0C,$0C,$0C,$1C,$1C,$1C,$1C,$1C,$1C,$1C,$1C
title_core: .byte $0C,$0C,$1C,$1C,$1C,$2C,$2C,$2C,$21,$21,$31,$31,$3C,$3C,$30,$30
glint_tiles: .byte 14, 15, 16, 17
glint_c1: .byte $21, $27
glint_c2: .byte $31, $37
glint_c3: .byte $30, $30
.include "palettes.inc"
.segment "CODE2"

; Common part setup: A = band bank (streamer), X/Y unused.
use_band:
  sta band_bank
  ora #$80
  sta MMC5_PRGC
  rts

; ------------------------------------------------------------------ DAWN (0..1535)
dawn_init:
  lda #2
  jsr use_band
  lda #0
  sta chr_half
  sta zrun
  sta zstage
  sta kick
  sta title_a
  sta title_v
  sta glint_on
  sta glint_pal
  sta amp1
  sta amp2
  sta amp3
  lda #$FF
  sta flash
  lda #<ramp_black_deep
  ldx #>ramp_black_deep
  ldy #0
  jsr start_ramp
  lda #1
  ldx #0
  jsr set_emph
  lda #$70
  sta tspeed
  lda #0
  sta tspeed+1
  lda #2
  sta tg1
  lda #1
  sta tg2
  lda #2
  sta tg3
  lda #$60
  sta v1
  lda #0
  sta v1+1
  lda #$C0
  sta v2
  lda #$FF
  sta v2+1
  lda #$50
  sta v3
  lda #0
  sta v3+1
  lda #$18
  sta xv
  lda #0
  sta xv+1
  rts

dawn_frame:
  ; the light comes up: black -> deep over frames 60..760, deep -> day over 800..1500
  lda part_t+1
  bne @late
  lda part_t
  cmp #60
  bne :+
  lda #<ramp_black_deep
  ldx #>ramp_black_deep
  ldy #4
  jsr start_ramp
: jmp @t
@late:
  cmp #3
  bne @t
  lda part_t
  cmp #32                 ; frame 800
  bne @t
  lda #<ramp_deep_day
  ldx #>ramp_deep_day
  ldy #6
  jsr start_ramp
  lda #6
  sta tg1
  lda #3
  sta tg2
  lda #4
  sta tg3
@t:
  ; the title: in at 300, out from 1100
  lda part_t+1
  cmp #>300
  bne :+
  lda part_t
  cmp #<300
  bne :+
  lda #1
  sta title_v
: lda part_t+1
  cmp #>1100
  bne :+
  lda part_t
  cmp #<1100
  bne :+
  lda #$FF
  sta title_v
: jmp common

; ------------------------------------------------------------------ POOL (1536..3071)
pool_init:
  lda #1
  sta glint_on
  lda #0
  sta glint_pal
  sta title_a
  sta title_v
  lda #8
  sta tg1
  lda #4
  sta tg2
  lda #5
  sta tg3
  lda #$A0
  sta tspeed
  lda #$80
  sta v1
  lda #$A0
  sta v2
  lda #$FE
  sta v2+1
  lda #$70
  sta v3
  rts

pool_frame:
  jsr glints_on_bells
  ; a little more swell in the second half
  lda part_t+1
  cmp #3
  bne :+
  lda part_t
  bne :+
  lda #11
  sta tg1
  lda #6
  sta tg3
  lda #$C0
  sta tspeed
: jmp common

; ------------------------------------------------------------------ RAIN (3072..4607)
rain_init:
  lda #1
  sta zrun                ; dissolve, tile by tile from the centre out, into the rain world
  lda #<ramp_day_rain
  ldx #>ramp_day_rain
  ldy #4
  jsr start_ramp
  lda #6
  ldx #0
  jsr set_emph
  lda #0
  sta glint_on
  lda #7
  sta tg1
  lda #3
  sta tg2
  lda #4
  sta tg3
  lda #$D0
  sta tspeed
  rts

rain_frame:
  ; every raindrop (noise "drop" = hat bit) shakes the surface
  lda evt
  and #$10
  beq :+
  lda kick
  clc
  adc #3
  cmp #9
  bcc :+
  lda #9
: sta kick
  jmp common

; ------------------------------------------------------------------ LATTICE (4608..6143)
latt_init:
  lda #<ramp_white_latt
  ldx #>ramp_white_latt
  ldy #1                  ; CHR half 1: the lattice world
  jsr start_flash
  lda #3
  ldx #$60
  jsr set_emph
  lda #3
  jsr use_band
  lda #6
  sta tg1
  lda #3
  sta tg2
  lda #5
  sta tg3
  lda #0
  sta kick
  rts

latt_frame:
  lda flash
  cmp #$FF
  bne :+
  lda #$E0
  sta tspeed
  lda #0
  sta tspeed+1
:
  ; tension grows bar by bar: amplitude targets climb, the bands sweep faster
  lda part_t
  and #127
  bne @r
  lda part_t
  ora part_t+1
  beq @r
  lda tg1
  cmp #17
  bcs :+
  inc tg1
  inc tg1
: lda tg3
  cmp #12
  bcs :+
  inc tg3
: lda kms_v
  cmp #$F0
  bcs @r
  clc
  adc #$10
  sta kms_v
@r:
  jmp common

; ------------------------------------------------------------------ SUN (6144..8447)
sun_init:
  lda #<ramp_white_sun
  ldx #>ramp_white_sun
  ldy #0
  jsr start_flash
  lda #64
  sta rspeed
  lda #5
  ldx #$28
  jsr set_emph
  lda #3
  jsr use_band
  lda #1
  sta glint_on
  sta glint_pal
  lda #14
  sta tg1
  lda #7
  sta tg2
  lda #9
  sta tg3
  lda #$C0
  sta v1
  lda #0
  sta v1+1
  lda #$00
  sta v2
  lda #$FE
  sta v2+1
  lda #$A0
  sta v3
  lda #$30
  sta xv
  rts

sun_frame:
  lda flash
  cmp #$FF
  bne :+
  lda #0
  sta tspeed
  lda #1
  sta tspeed+1            ; full speed
:
  jsr glints_on_bells
  ; the soft triangle thump pushes a swell through the water
  lda evt
  and #$04
  beq :+
  lda #6
  sta kick
:
  ; from frame 1536 (sun10, the peak) on: shafts of light
  lda part_t+1
  cmp #6
  bne :+
  lda part_t
  bne :+
  lda #3
  ldx #$18
  jsr set_emph
: jmp common

; ------------------------------------------------------------------ DUSK (8448..9215)
dusk_init:
  lda #<ramp_sun_night
  ldx #>ramp_sun_night
  ldy #9
  jsr start_ramp
  lda #6
  ldx #0
  jsr set_emph
  lda #2
  jsr use_band
  lda #0
  sta glint_on
  lda #3
  sta tg1
  lda #2
  sta tg2
  lda #3
  sta tg3
  lda #$80
  sta tspeed
  lda #0
  sta tspeed+1
  lda #$10
  sta xv
  rts

dusk_frame:
  lda part_t+1
  cmp #>400
  bne :+
  lda part_t
  cmp #<400
  bne :+
  lda #<ramp_night_black
  ldx #>ramp_night_black
  ldy #17
  jsr start_ramp
  lda #0
  sta tg1
  sta tg2
  sta tg3
: jmp common

.segment "RODATA2"
order_frame_lo:
  .repeat 32, i
  .byte <(i * PATTERN)
  .endrepeat
order_frame_hi:
  .repeat 32, i
  .byte >(i * PATTERN)
  .endrepeat
