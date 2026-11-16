; Groove: hardware registers, constants and macros shared by every module.

PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016

MMC5_PRGMODE = $5100
MMC5_CHRMODE = $5101
MMC5_RAMPROT1 = $5102
MMC5_RAMPROT2 = $5103
MMC5_EXMODE  = $5104
MMC5_NTMAP   = $5105
MMC5_FILLTILE = $5106
MMC5_FILLATTR = $5107
MMC5_PRG6    = $5113
MMC5_PRG8    = $5114
MMC5_PRGA    = $5115
MMC5_PRGC    = $5116
MMC5_PRGE    = $5117
MMC5_CHR0    = $5120          ; $5120-$5127: 1 KB banks (set A; set B is never written)
MMC5_CHRHI   = $5130
MMC5_SPLIT   = $5200
MMC5_IRQLINE = $5203
MMC5_IRQSTAT = $5204
MMC5_MULA    = $5205
MMC5_MULB    = $5206
EXRAM        = $5C00

EX_NT   = 0
EX_ATTR = 1
EX_RAM  = 2

OAMBUF   = $0200

BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10
BTN_UP = $08
BTN_DOWN = $04
BTN_LEFT = $02
BTN_RIGHT = $01

; Wait until the NMI handler has run once.
.macro WAIT_NMI
  .local w
  lda nmi_count
w: cmp nmi_count
  beq w
.endmacro

; Map an 8 KB PRG bank at $8000 (remembered so far_copy can restore it).
.macro SET_PRG8 bank
  lda #($80 | (bank))
  sta cur_bank
  sta MMC5_PRG8
.endmacro

; 16-bit compare helpers
.macro LDXY16 addr
  ldx addr
  ldy addr+1
.endmacro

MMC5_CHRB    = $5128          ; $5128-$512B: BG bank set B (8x16 sprite mode)

ORDER_LEN = 544               ; frames per pattern (64 rows, swing 10/7)
NUM_ORDERS = 16

PRG_16K   = 8                 ; 128 KB PRG
CHR_8K    = 32                ; 256 KB CHR
BANK_COMMON = 13              ; at $A000
BANK_FIXC = 14                ; at $C000 (music)
BLANK_ROW = 216               ; every scene keeps nametable rows 0-2 and 27-29 blank (Y clamp target)
