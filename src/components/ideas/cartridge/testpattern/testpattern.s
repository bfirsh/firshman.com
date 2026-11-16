; CRT calibration card for the Cartridge player (NROM-128). Not part of the demo.
; Shows the card from make.mjs, a ball moving across the top (persistence), the eight
; controller buttons lit when held (input), a blip per button press and a steady
; triangle tone while B is held (audio pacing and crackle).
.include "tiles.inc"

PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016

.segment "HEADER"
  .byte "NES", $1a, 1, 1, $00, $00, 0, 0, 0, 0, 0, 0, 0, 0

.segment "ZEROPAGE"
buttons: .res 1
prev:    .res 1
frame:   .res 1
ballx:   .res 1
ptr:     .res 2

.segment "OAM"
oam: .res 256

.segment "CODE"
reset:
  sei
  cld
  ldx #$40
  stx $4017
  ldx #$ff
  txs
  inx
  stx PPUCTRL
  stx PPUMASK
  stx $4010
  bit PPUSTATUS
@v1: bit PPUSTATUS
  bpl @v1
  lda #0
@clr:
  sta $0000, x
  sta $0100, x
  sta $0300, x
  sta $0400, x
  sta $0500, x
  sta $0600, x
  sta $0700, x
  inx
  bne @clr
  lda #$ff
@hide:
  sta oam, x
  inx
  bne @hide
@v2: bit PPUSTATUS
  bpl @v2

  ; palette
  lda #$3f
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #0
@pal:
  lda palette, x
  sta PPUDATA
  inx
  cpx #32
  bne @pal

  ; nametable + attributes
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #<nametable
  sta ptr
  lda #>nametable
  sta ptr+1
  ldx #4
  ldy #0
@nt:
  lda (ptr), y
  sta PPUDATA
  iny
  bne @nt
  inc ptr+1
  dex
  bne @nt

  ; button indicator sprites: 8 blocks at y=24, x=168.. (A B Sel Start U D L R)
  ldx #0
  ldy #0
@spr:
  lda #23
  sta oam, y
  lda #TILE_SOLID
  sta oam+1, y
  lda #0
  sta oam+2, y
  txa
  asl
  asl
  asl
  clc
  adc #172
  sta oam+3, y
  iny
  iny
  iny
  iny
  inx
  cpx #8
  bne @spr
  ; ball sprite (slot 8)
  lda #11
  sta oam+32
  lda #TILE_BALL
  sta oam+33
  lda #2
  sta oam+34

  lda #$0f
  sta $4015
  lda #$08
  sta $4001

  lda #%10000000
  sta PPUCTRL
  lda #%00011110
  sta PPUMASK
forever:
  jmp forever

nmi:
  pha
  txa
  pha
  tya
  pha
  lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  lda #0
  sta PPUSCROLL
  sta PPUSCROLL
  lda #%10000000
  sta PPUCTRL

  ; read pad
  lda buttons
  sta prev
  lda #1
  sta JOY1
  lda #0
  sta JOY1
  ldx #8
@rd:
  lda JOY1
  lsr
  rol buttons
  dex
  bne @rd

  ; indicators: buttons bit7 = A ... bit0 = Right
  lda buttons
  ldy #0
@ind:
  asl
  pha
  lda #0
  adc #0          ; carry -> 1 when held
  sta oam+2, y
  pla
  iny
  iny
  iny
  iny
  cpy #32
  bne @ind

  ; new presses -> blip, pitch per button
  lda prev
  eor #$ff
  and buttons
  beq @noblip
  ldx #0
@find:
  asl
  bcs @got
  inx
  bne @find
@got:
  lda #$84
  sta $4000
  lda pitch, x
  sta $4002
  lda #$08
  sta $4003
@noblip:

  ; triangle tone while B held
  lda buttons
  and #$40
  beq @tri_off
  lda #$ff
  sta $4008
  lda #$fd        ; ~ 220 Hz
  sta $400a
  lda prev
  and #$40
  bne @tri_done
  lda #$f9
  sta $400b
  jmp @tri_done
@tri_off:
  lda #$80
  sta $4008
  sta $400b
@tri_done:

  ; ball
  inc frame
  inc ballx
  inc ballx
  lda ballx
  sta oam+35

  pla
  tay
  pla
  tax
  pla
irq:
  rti

pitch: .byte $6a, $7e, $8e, $a9, $bd, $d5, $fd, $1c

palette:   .incbin "card.pal"
nametable: .incbin "card.nam"

.segment "VECTORS"
  .addr nmi, reset, irq

.segment "CHARS"
  .incbin "card.chr"
