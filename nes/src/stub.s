; A black placeholder part, handy when retiming: point a PARTS_TABLE entry at it.
.segment "CODE"
stub_init:
  jsr ppu_off
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #0
  sta fade
  jsr oam_clear
  jmp ppu_on
stub_frame:
  rts
