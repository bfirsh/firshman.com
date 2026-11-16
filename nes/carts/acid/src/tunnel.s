; =====================================================================================
;  TUNNEL: a palette-cycled square tunnel with a 64-ball sprite object flying in it
;
;  The tunnel costs no CPU: three precomputed depth-band images (tools/gen_tunnel.py) live in
;  CIRAM A, CIRAM B and ExRAM (as a third nametable); each step shows the next one and every
;  third step rotates the three band colours of the four fog palettes: nine sub-steps per band.
;  All 202 tiles sit in pattern table $0000, so $1000 is free for sprites.
;
;  The ball object: 8 rings x 8 points of a surface of revolution whose ring radii and heights
;  morph between shapes (sphere, torus, cylinder, cone, hourglass, disc), spun about Y, tilted
;  about X, in perspective, at 60 fps. The MMC5 multiplier keeps one operand per ring (2R),
;  so most products are one register write and one read.
; =====================================================================================

TUN_PHASES = 9

.segment "ZEROPAGE"
tun_ph: .res 2          ; phase: lo = fraction, hi = 0..8
tun_speed: .res 2       ; 8.8 sub-steps per frame
tun_flash: .res 1       ; 0..3 brightness boost
tun_hue: .res 1         ; colour scheme
tun_dark: .res 1        ; 0..4 fade to black
dot_on: .res 1          ; the ball object is drawn
dot_phi: .res 1
dot_alpha: .res 1
dot_spin: .res 1
dot_rot: .res 1         ; OAM rotation (flicker management)
dot_cx: .res 1          ; screen centre
dot_cy: .res 1
dot_scale: .res 1       ; 0..128 size multiplier
dot_twist: .res 1
tun_flipc: .res 1       ; > 0: the balls swap colours (counts down)

.segment "BSS"
dot_r: .res 8           ; ring radius (0..127)
dot_h: .res 8           ; ring height (signed)
dot_x: .res 8           ; per point of the current ring (signed)
dot_z0: .res 8
dot_ac: .res 8          ; |cos|, |sin| of each point's angle, and sign bits
dot_as: .res 8
dot_sg: .res 8

.segment "CODEC"

; Install the tunnel (rendering off).
tun_install:
  lda #0
  sta vec_on
  SET_BANKA 22
  ; CHR $0000: the tunnel tiles
  lda #<tun_chr
  sta ptr0
  lda #>tun_chr
  sta ptr0+1
  bit PPUSTATUS
  lda #$00
  sta PPUADDR
  sta PPUADDR
  ldx #<(TUN_NTILES * 16 / 256 + 1)
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  jsr load_sprite_chr
  ; nametables: CIRAM A (phase 0), CIRAM B (phase 1), ExRAM (phase 2)
  lda #$E4                ; $2000 A, $2400 B, $2800 ExRAM, $2C00 fill
  sta MMC5_NTMAP
  lda #<tun_nt0
  ldx #>tun_nt0
  ldy #$20
  jsr tun_load_nt
  lda #<tun_nt1
  ldx #>tun_nt1
  ldy #$24
  jsr tun_load_nt
  lda #2
  sta MMC5_EXMODE
  ldx #0
: lda tun_nt2,x
  sta EXRAM,x
  lda tun_nt2+256,x
  sta EXRAM+256,x
  lda tun_nt2+512,x
  sta EXRAM+512,x
  inx
  bne :-
: lda tun_nt2+768,x
  sta EXRAM+768,x
  inx
  cpx #192
  bne :-
  ldx #0
: lda tun_attr,x
  sta EXRAM+960,x
  inx
  cpx #64
  bne :-
  lda #0
  sta MMC5_EXMODE         ; ExRAM as a nametable
  lda #$E4
  sta MMC5_NTMAP          ; (re-map so the emulator refreshes its copy)
  jsr oam_clear
  lda #>oam
  sta oam_page
  lda #0
  sta tun_ph
  sta tun_ph+1
  sta dot_on
  sta dot_rot
  lda #<tun_nmi
  sta nmi_vec
  lda #>tun_nmi
  sta nmi_vec+1
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #<tun_tail
  sta tail_vec
  lda #>tun_tail
  sta tail_vec+1
  lda #%10001000
  sta ppu_ctrl
  lda #%00011110
  sta ppu_mask
  lda #128
  sta dot_cx
  lda #120
  sta dot_cy
  jsr tun_palette
  rts

; 960 tiles from A/X (lo/hi) and the attributes to VRAM page Y.
tun_load_nt:
  sta ptr0
  stx ptr0+1
  sty PPUADDR
  lda #0
  sta PPUADDR
  ldx #3
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
: lda (ptr0),y
  sta PPUDATA
  iny
  cpy #192
  bne :-
  ldx #0
: lda tun_attr,x
  sta PPUDATA
  inx
  cpx #64
  bne :-
  rts

tun_nmi:
  lda #0
  sta OAMADDR
  lda oam_page
  sta OAMDMA
  jsr upload_palette
  lda tun_ph+1            ; nametable = phase mod 3
  tax
  lda ppu_ctrl
  and #$FC
  ora tun_set,x
  sta PPUCTRL
  lda scroll_x
  sta PPUSCROLL
  lda scroll_y
  sta PPUSCROLL
  lda ppu_mask
  sta PPUMASK
  jmp nmi_common

tun_tail:
  clc
  lda tun_ph
  adc tun_speed
  sta tun_ph
  lda tun_ph+1
  adc tun_speed+1
: cmp #TUN_PHASES
  bcc :+
  sbc #TUN_PHASES
  jmp :-
: sta tun_ph+1
  jsr tun_palette
  lda tun_flipc
  beq :+
  dec tun_flipc
: jmp pal_finish

; Palette from the phase: fog palette f, band colour i -> scheme[f][(i + rot) mod 3].
tun_palette:
  ldx tun_ph+1
  lda tun_rot,x
  sta i4
  lda #$0F
  sta pal_buf
  ldx #0                  ; fog level
@f:
  stx i5
  txa
  asl a
  asl a
  sta i3                  ; pal index base
  txa
  asl a
  asl a
  clc
  adc tun_hue             ; scheme row = hue*16 + f*4 (hue pre-multiplied by 16)
  sta i2
  ldy #0                  ; band i
@b:
  tya
  clc
  adc i4
  cmp #3
  bcc :+
  sbc #3
: clc
  adc i2
  tax
  lda tun_scheme,x
  ldx i3
  sta pal_buf+1,x
  inc i3
  iny
  cpy #3
  bne @b
  ldx i5
  inx
  cpx #4
  bne @f
  ; sprite palettes
  ldx #15
: lda dot_pals,x
  sta pal_buf+16,x
  dex
  bpl :-
  lda #$0F
  sta pal_buf+16
  rts

.segment "RODATA"
tun_set: .byte 0, 1, 2, 0, 1, 2, 0, 1, 2
tun_rot: .byte 0, 0, 0, 1, 1, 1, 2, 2, 2
; band colour schemes: [scheme][fog 0..3][3 colours] (16 bytes per scheme)
tun_scheme:
  ; 0: acid green, magenta, black
  .byte $0A, $04, $0F, 0,  $1A, $04, $0F, 0,  $2A, $14, $0F, 0,  $2A, $15, $0F, 0
  ; 1: magenta dominant
  .byte $04, $0A, $0F, 0,  $14, $0A, $0F, 0,  $15, $1A, $0F, 0,  $25, $2A, $0F, 0
  ; 2: green only (build)
  .byte $0A, $0F, $0F, 0,  $0A, $1A, $0F, 0,  $1A, $2A, $0F, 0,  $2A, $1A, $0F, 0
  ; 3: white strobe
  .byte $00, $0F, $0F, 0,  $10, $0F, $0F, 0,  $20, $0F, $0F, 0,  $30, $0F, $0F, 0
dot_pals:
  .byte $0F, $2A, $1A, $30,  $0F, $1A, $0A, $2A,  $0F, $25, $15, $35,  $0F, $14, $04, $24
.segment "CODEC"

; =====================================================================================
;  The ball object (main thread, bank B01)
; =====================================================================================
.segment "B01"

; Build the 64 sprites into the back OAM page and flip. Call once per frame.
dot_draw:
  lda dot_alpha
  tax
  lda sin8,x
  sta t4                  ; sin a
  txa
  clc
  adc #64
  tax
  lda sin8,x
  sta t5                  ; cos a
  ; target page
  lda oam_page
  eor #1
  sta ptr1+1
  lda #0
  sta ptr1
  lda dot_rot
  clc
  adc #4 * 17
  sta dot_rot
  sta t11                 ; OAM write index (rotates: overflow flickers instead of vanishing)
  lda #64
  sta t10                 ; sprites left
  ldx #0                  ; ring
@ring:
  stx t9
  ; the ring's 8 angles: theta = i*32 + phi + k*twist
  lda dot_twist
  ldy t9
  jsr mul_ay_lo           ; A = k * twist (low byte)
  clc
  adc dot_phi
  sta t0
  ldy #0
@ang:
  ldx t0
  lda sin8,x              ; sin
  sta t1
  txa
  clc
  adc #64
  tax
  lda sin8,x              ; cos
  ldx #0
  cmp #$80
  bcc :+
  eor #$FF
  adc #0                  ; (C=1) -> |cos|
  ldx #1
: sta dot_ac,y
  stx t2
  lda t1
  bpl :+
  eor #$FF
  clc
  adc #1
  inc t2
  inc t2
: sta dot_as,y
  lda t2
  sta dot_sg,y            ; bit0: cos < 0, bit1: sin < 0
  lda t0
  clc
  adc #32
  sta t0
  iny
  cpy #8
  bne @ang
  ; radius and height of this ring, scaled
  ldx t9
  lda dot_r,x
  ldx dot_scale
  stx MMC5_MULB
  sta MMC5_MULA
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a                   ; R * scale / 128
  asl a
  bcc :+
  lda #$FE
: sta MMC5_MULA           ; 2R
  ldy #7
@xz:
  lda dot_ac,y
  sta MMC5_MULB
  lda MMC5_MULB           ; R |cos| / 128
  ldx dot_sg,y
  sta dot_x,y
  txa
  lsr a
  bcc :+
  lda dot_x,y
  eor #$FF
  clc
  adc #1
  sta dot_x,y
: lda dot_as,y
  sta MMC5_MULB
  lda MMC5_MULB
  sta dot_z0,y
  lda dot_sg,y
  and #2
  beq :+
  lda dot_z0,y
  eor #$FF
  clc
  adc #1
  sta dot_z0,y
: dey
  bpl @xz
  ; H cos a, H sin a
  ldx t9
  lda dot_h,x
  ldy dot_scale
  jsr smul7z
  sta t6                  ; H (scaled)
  ldy t5
  jsr smul7
  sta t7                  ; H cos a
  lda t6
  ldy t4
  jsr smul7
  sta t8                  ; H sin a
  ; points
  ldy #0
@pt:
  sty t3
  ; y = H cos a - z0 sin a ; z = H sin a + z0 cos a
  lda dot_z0,y
  ldy t4
  jsr smul7
  eor #$FF
  sec
  adc t7
  sta t1                  ; y
  ldy t3
  lda dot_z0,y
  ldy t5
  jsr smul7
  clc
  adc t8
  sta t2                  ; z (+ = away)
  tax
  lda persp,x
  sta MMC5_MULA
  ; sx
  ldy t3
  lda dot_x,y
  jsr @proj
  bne @skip
  clc
  adc dot_cx
  sta t0
  ; sy
  lda t1
  jsr @proj
  bne @skip
  clc
  adc dot_cy
  cmp #224
  bcs @skip
  sbc #3                  ; (C=0: -4) centre the 8x8 sprite, OAM y is one line early
  ldy t11
  sta (ptr1),y
  ; tile and palette by depth
  lda t2
  clc
  adc #128
  lsr a
  lsr a
  lsr a
  lsr a
  tax
  iny
  lda dot_tile,x
  sta (ptr1),y
  iny
  lda t9
  ldy tun_flipc
  beq :+
  eor #1
: ldy t11
  iny
  iny
  and #1
  asl a
  ora dot_far,x
  sta (ptr1),y
  iny
  lda t0
  sec
  sbc #4
  sta (ptr1),y
  iny
  sty t11
  dec t10
@skip:
  ldy t3
  iny
  cpy #8
  beq :+
  jmp @pt
: ldx t9
  inx
  cpx #8
  beq :+
  jmp @ring
: ; hide the unused sprites
  ldx t10
  beq @flip
  ldy t11
  lda #$F8
: sta (ptr1),y
  iny
  iny
  iny
  iny
  dex
  bne :-
@flip:
  lda ptr1+1
  sta oam_page
  rts
; signed A * k(MULA) / 128 -> A = low byte, Z clear if out of range (|v| > 127)
@proj:
  sta t6
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULB
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a                   ; P >> 7
  bmi @oor                ; > 127
  bit t6
  bpl :+
  eor #$FF
  clc
  adc #1
: ldx #0
  rts
@oor:
  ldx #1
  rts

; A * Y -> A (low byte), unsigned
mul_ay_lo:
  sta MMC5_MULA
  sty MMC5_MULB
  lda MMC5_MULA
  rts

; ring shapes: radius and height per ring (8 rings), for morphing
dot_tile:  .byte 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5
dot_far:   .byte 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1

; Set dot_r/dot_h by morphing shape A (t3) to shape B (t4) by t5 (0..32)
dot_morph:
  lda t3
  asl a
  asl a
  asl a
  asl a
  sta t6                  ; shape A offset (16 bytes each: r[8], h[8])
  lda t4
  asl a
  asl a
  asl a
  asl a
  sta t7
  ldx #0
@l:
  stx t8
  ; r
  ldy t6
  lda dot_shapes,y
  sta t0
  ldy t7
  lda dot_shapes,y
  jsr @lerp
  ldx t8
  sta dot_r,x
  ldy t6
  lda dot_shapes+8,y
  sta t0
  ldy t7
  lda dot_shapes+8,y
  jsr @lerp
  ldx t8
  sta dot_h,x
  inc t6
  inc t7
  inx
  cpx #8
  bne @l
  rts
; A = b, t0 = a: a + (b - a) * t5 / 32 (signed)
@lerp:
  sec
  sbc t0
  ldy t5
  sty t1
  jsr smul
  lda m_lo                ; >> 5
  ldx #5
: lda m_hi
  cmp #$80
  ror m_hi
  ror m_lo
  dex
  bne :-
  lda m_lo
  clc
  adc t0
  rts

.include "shapes.inc"
