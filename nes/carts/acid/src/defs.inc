; Acid: hardware registers, constants and macros shared by every module.

PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016

MMC5_PRGMODE  = $5100
MMC5_CHRMODE  = $5101
MMC5_RAMPROT1 = $5102
MMC5_RAMPROT2 = $5103
MMC5_EXMODE   = $5104
MMC5_NTMAP    = $5105
MMC5_FILLTILE = $5106
MMC5_FILLATTR = $5107
MMC5_PRG6     = $5113
MMC5_PRG8     = $5114
MMC5_PRGA     = $5115
MMC5_PRGC     = $5116
MMC5_PRGE     = $5117
MMC5_SPLIT    = $5200
MMC5_IRQLINE  = $5203
MMC5_IRQSTAT  = $5204
MMC5_MULA     = $5205
MMC5_MULB     = $5206
EXRAM         = $5C00

SONG_LEN = 9856           ; 22 patterns x 448 frames
PATTERN  = 448
BAR      = 112
BEAT     = 28

; Map an 8 KB PRG-ROM bank at $8000 (shadowed so interrupts can restore it).
.macro SET_BANK8 bank
  lda #($80 | (bank))
  sta cur_bank
  sta MMC5_PRG8
.endmacro

; Map an 8 KB PRG-ROM bank at $A000 (shadowed).
.macro SET_BANKA bank
  lda #($80 | (bank))
  sta a_bank
  sta MMC5_PRGA
.endmacro

; Map PRG-RAM bank n at $6000 (shadowed).
.macro SET_RAM bank
  lda #(bank)
  sta ram_bank
  sta MMC5_PRG6
.endmacro

; Unsigned 8x8 multiply with the MMC5: A * X -> A = high byte, Y = low byte.
.macro MUL_AX
  sta MMC5_MULA
  stx MMC5_MULB
  ldy MMC5_MULA
  lda MMC5_MULB
.endmacro

; 16-bit add of an immediate
.macro ADD16I addr, val
  clc
  lda addr
  adc #<(val)
  sta addr
  lda addr+1
  adc #>(val)
  sta addr+1
.endmacro

.macro SET_REACT addr
  lda #<(addr)
  sta react_vec
  lda #>(addr)
  sta react_vec+1
.endmacro

EV_ROW   = $01
EV_PAT   = $02
EV_KICK  = $04
EV_CLAP  = $08
EV_HAT   = $10
EV_ACC   = $20
EV_BASS  = $40
