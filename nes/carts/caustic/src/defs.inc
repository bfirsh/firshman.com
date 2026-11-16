; Caustic: hardware registers, constants and macros.

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
MMC5_PRG6     = $5113
MMC5_PRG8     = $5114
MMC5_PRGA     = $5115
MMC5_PRGC     = $5116
MMC5_PRGE     = $5117
MMC5_CHR0     = $5120
MMC5_CHRHI    = $5130
MMC5_SPLIT    = $5200
MMC5_IRQLINE  = $5203
MMC5_IRQSTAT  = $5204
MMC5_MULA     = $5205
MMC5_MULB     = $5206
EXRAM         = $5C00

EX_ATTR = 1
EX_RAM  = 2

; PRG banks (8 KB): 0-1 kernel + engine at $8000-$BFFF, 2-5 band streamers, 6 boot data, 7 core.
BANK_BOOT = 6
SINE = $6000            ; PRG-RAM: sine pages, amplitude 0..19 px, one 256-byte page each
AMP_MAX = 19
EMPH = $7400            ; PRG-RAM: 8 pages of PPUMASK-per-scanline patterns (see tools/assets.py)

KTOP = 24               ; first scanline the raster kernel shapes (keep in step with tools/assets.py)
KBOT = 207              ; last one


BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10
BTN_UP = $08
BTN_DOWN = $04
BTN_LEFT = $02
BTN_RIGHT = $01

MASK_ON = %00011110     ; BG + sprites, no left clipping
EMPH_DIM = %11100000    ; all three emphasis bits: a uniform dimmer in JSNES (x 0.56)
