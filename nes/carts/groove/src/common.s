; =====================================================================================
;  COMMON bank ($A000): the sine tables (copied to PRG-RAM at reset) and the band filler.
;  fill_xtb8 writes the kernel's back X buffer (lines 24-215, 24 bands of 8 lines, from
;  xband[0..23]) with fully unrolled code; bands_flip shows it from the next frame.
; =====================================================================================

.segment "BSS"
xband: .res 24

.segment "COMMON"
WAVES_ROM: .incbin "waves.bin"

.macro FILLX buf
  .repeat 24, b
  lda xband+b
  .repeat 8, i
  sta buf + 24 + b * 8 + i
  .endrepeat
  .endrepeat
.endmacro

fill_xtb8:
  lda xb_buf
  beq :+
  jmp @to0
: FILLX XTB1
  rts
@to0:
  FILLX XTB0
  rts

bands_flip:
  lda #1
  sta xb_flip
  rts

.segment "CODEC"
