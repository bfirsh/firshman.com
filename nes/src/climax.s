; =====================================================================================
;  CLIMAX  (song 7616..8959)  "edge of space"
;  The whole Earth turning: 32 pre-rendered frames of a 128x128 globe streamed from
;  CHR-ROM. Each frame is a 4 KB bank of 256 tiles; with MMC5 extended attributes every
;  tile picks its own bank, so changing frame is just rewriting the bank bits of 256 ExRAM
;  bytes, behind the beam, in the bottom of the picture. Around it: a real-time 3D starfield
;  (perspective divide by reciprocal table and the MMC5 multiplier) and a greetings
;  scroller on its own raster split.
; =====================================================================================

.segment "BANK08"
.include "climax.inc"
globe_nt: .incbin "globe_nt.bin"
globe_ex: .incbin "globe_ex.bin"

CX_T0 = 7616
CX_GO_LINE = 170
CX_NSTARS = 24
CX_DELAY = 14
CX_TXT = 176             ; text band: lines 176-191 (nametable rows 22-23)

cx_t     = pv+0          ; 16-bit
cx_go    = pv+2          ; nmi_count of the frame whose IRQ passed CX_GO_LINE
cx_frame = pv+3          ; globe frame shown
cx_sx    = pv+4          ; scroll x (16-bit)
cx_tp    = pv+6          ; text pointer (16-bit)
cx_split = pv+8          ; X scroll for the split (latched for the IRQ)
cx_bank  = pv+9
cx_x     = bss_part      ; star world x (signed)
cx_y     = bss_part+32
cx_z     = bss_part+64

climax_init:
  jsr ppu_off
  lda #<globe_nt
  sta ptr0
  lda #>globe_nt
  sta ptr0+1
  lda #<globe_ex
  sta ptr2
  lda #>globe_ex
  sta ptr2+1
  jsr load_bitmap
  lda #SPACE_SPR
  jsr set_sprite_chr
  lda #0
  sta scroll_x
  sta scroll_y
  sta cx_frame
  sta cx_sx
  sta cx_sx+1
  sta cx_split
  lda #<cx_text
  sta cx_tp
  lda #>cx_text
  sta cx_tp+1
  lda #3
  sta fade
  lda #<climax_palette
  sta ptr0
  lda #>climax_palette
  sta ptr0+1
  jsr set_palette
  ; stars: random positions and depths
  ldx #0
: jsr rand
  sta cx_x,x
  jsr rand
  sta cx_y,x
  jsr rand
  ora #$20
  sta cx_z,x
  inx
  cpx #CX_NSTARS
  bne :-
  lda #<cx_irq1
  sta irq_vec
  lda #>cx_irq1
  sta irq_vec+1
  lda #CX_GO_LINE
  sta irq_first
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

climax_frame:
  sec
  lda tl_frame
  sbc #<CX_T0
  sta cx_t
  lda tl_frame+1
  sbc #>CX_T0
  sta cx_t+1
  ; ---- fade in from the flash; fade out to black at the end (t >= 1280)
  ldx #0
  lda cx_t+1
  bne @late
  lda cx_t
  cmp #24
  bcs @fdone
  lsr a
  lsr a
  lsr a
  eor #$FF
  sec
  adc #3
  tax
  jmp @fdone
@late:
  lda cx_t+1
  cmp #>1280
  bcc @fdone
  bne :+
  lda cx_t
  cmp #<1280
  bcc @fdone
: lda cx_t
  sec
  sbc #<1280
  lsr a
  lsr a
  lsr a
  lsr a
  cmp #4
  bcc :+
  lda #4
: eor #$FF
  clc
  adc #1
  tax
@fdone:
  cpx fade
  beq :+
  stx fade
  jsr apply_fade
:
  ; ---- scroller: 3 px per frame; a new glyph enters each time a tile column is crossed
  lda cx_sx
  sta t5
  clc
  adc #3
  sta cx_sx
  sta cx_split
  eor t5
  and #$F8
  beq @noglyph
  jsr cx_glyph
@noglyph:
  ; ---- sprites: the starfield
  jsr oam_clear
  jsr cx_stars
  lda #1
  sta nmi_ready           ; uploads ready; the globe write below waits for the beam
  ; ---- globe frame = t/3 mod 32
  ; (t * 85) >> 8 ~ t/3
  lda cx_t
  sta MMC5_MULA
  lda #85
  sta MMC5_MULB
  lda MMC5_MULB
  sta t0
  lda cx_t+1
  sta MMC5_MULA
  lda MMC5_MULA            ; (t_hi*85) low byte
  clc
  adc t0
  and #31
  cmp cx_frame
  bne :+
  rts
: sta cx_frame
  clc
  adc #GLOBE_BANK0
  sta cx_bank
  ; wait until the beam is below the globe, then rewrite its 256 bank bytes
: lda cx_go
  cmp nmi_count
  bne :-
  jmp cx_write_globe

; Write ExRAM rows 5..20, columns 8..23: palette bits of the position | frame bank.
cx_write_globe:
  ldx #0
  .repeat 16, r
  .repeat 16, c
  lda globe_pal + r*16 + c
  ora cx_bank
  sta EXRAM + (5+r)*32 + 8 + c
  .endrepeat
  .endrepeat
  rts

; Next glyph of the text into the column that just scrolled off the left edge.
cx_glyph:
  ldy #0
  lda (cx_tp),y
  cmp #255
  bne :+
  lda #<cx_text
  sta cx_tp
  lda #>cx_text
  sta cx_tp+1
  lda #0
: tax
  inc cx_tp
  bne :+
  inc cx_tp+1
: ; column = (sx >> 3) - 1 mod 32
  lda cx_sx
  lsr a
  lsr a
  lsr a
  sec
  sbc #1
  and #31
  sta t0
  ; two queue entries: row 24 (top half) and row 25 (bottom half)
  ldy vq_len
  lda #$22
  sta vq,y
  lda t0
  ora #$C0                ; row 22 = $22C0
  sta vq+1,y
  lda #1
  sta vq+2,y
  txa
  clc
  adc #16
  sta vq+3,y
  lda #$22
  sta vq+4,y
  lda t0
  ora #$E0                ; row 23 = $22E0
  sta vq+5,y
  lda #1
  sta vq+6,y
  txa
  clc
  adc #80
  sta vq+7,y
  lda #0
  sta vq+8,y
  tya
  clc
  adc #8
  sta vq_len
  rts

; 3D starfield: z decreases; screen = centre + x*K/z via recip[z] and the multiplier.
cx_stars:
  ldx #0
@s:
  ; speed: 3
  lda cx_z,x
  sec
  sbc #3
  cmp #10
  bcs :+
  jsr rand
  sta cx_x,x
  jsr rand
  sta cx_y,x
  lda #255
: sta cx_z,x
  tay
  lda cx_recip,y
  sta MMC5_MULB
  ; x
  lda cx_x,x
  jsr cx_proj
  bcs @next
  clc
  adc #128
  sta t0
  lda cx_y,x
  jsr cx_proj
  bcs @next
  clc
  adc #104
  cmp #224
  bcs @next
  sta t1
  ldy oam_i
  sta oam,y
  lda #SSTAR_TILE
  sta oam+1,y
  lda #3
  sta oam+2,y
  lda t0
  sta oam+3,y
  tya
  clc
  adc #4
  sta oam_i
@next:
  inx
  cpx #CX_NSTARS
  bne @s
  rts

; signed A (world) * recip (latched in MULB) >> 6 -> A, carry set if off-screen (|v| >= 128)
cx_proj:
  cmp #$80
  php
  bcc :+
  eor #$FF
  adc #0
: sta MMC5_MULA
  lda MMC5_MULB            ; hi
  sta t2
  lda MMC5_MULA            ; lo
  asl a
  rol t2
  asl a
  rol t2                   ; (v >> 6) in t2, overflow if t2 >= 128 or carry
  bcs @off
  lda t2
  bmi @off
  plp
  bcc :+
  eor #$FF
  clc
  adc #1
: clc
  rts
@off:
  plp
  sec
  rts

cx_recip:
  .byte 255
  .repeat 255, i
  .byte <(.min(255, 4096 / (i + 1)))
  .endrepeat

; ------------------------------------------------------------------ IRQs (fixed)
.segment "CODE"
; CX_GO_LINE: the globe is fully drawn: let the main thread rewrite it
cx_irq1:
  pha
  lda MMC5_IRQSTAT
  lda nmi_count
  sta cx_go
  lda #CX_TXT-1
  sta MMC5_IRQLINE
  lda #<cx_irq2
  sta irq_vec
  lda #>cx_irq2
  sta irq_vec+1
  pla
  rti

; line CX_TXT-1: scroll the text band in this line's horizontal blank
cx_irq2:
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda #CX_TXT+15
  sta MMC5_IRQLINE
  lda #(CX_TXT >> 6)
  sta PPUADDR
  lda #CX_TXT
  sta PPUSCROLL
  lda cx_split
  lsr a
  lsr a
  lsr a
  ora #((CX_TXT << 2) & $E0)
  tay
  lda cx_split
  .repeat CX_DELAY
  nop
  .endrepeat
  sta PPUSCROLL
  sty PPUADDR
  lda #<cx_irq3
  sta irq_vec
  lda #>cx_irq3
  sta irq_vec+1
  pla
  tay
  pla
  rti

; end of the text band: back to X = 0
cx_irq3:
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda #0
  sta MMC5_IRQLINE
  lda #((CX_TXT+16) >> 6)
  sta PPUADDR
  lda #CX_TXT+16
  sta PPUSCROLL
  ldy #(((CX_TXT+16) << 2) & $E0)
  lda #0
  .repeat CX_DELAY+6
  nop
  .endrepeat
  sta PPUSCROLL
  sty PPUADDR
  lda #<cx_irq1
  sta irq_vec
  lda #>cx_irq1
  sta irq_vec+1
  pla
  tay
  pla
  rti
