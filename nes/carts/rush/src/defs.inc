; RUSH: hardware registers, constants and macros.

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
MMC5_CHR0     = $5120          ; $5120-$5127: 1 KB banks, set A only (8x8 sprites: set A is used for all fetches)
MMC5_CHRHI    = $5130
MMC5_SPLIT    = $5200
MMC5_IRQLINE  = $5203
MMC5_IRQSTAT  = $5204
MMC5_MULA     = $5205
MMC5_MULB     = $5206
EXRAM         = $5C00

EX_NT   = 0
EX_RAM  = 2

SONG_LEN = 9408                ; 28 patterns x 336 frames
PATTERN  = 336
BAR      = 84
BEAT     = 21

; Nametable maps ($5105). Kernel effects: A A B B (horizontal scrolling wraps within each
; picture). Tunnel: A B ExRAM fill.
NTMAP_K = %01010000
NTMAP_T = %11100100
; $2006 high bytes (NT << 2) for the kernel map: A = $2000, B = $2800; tunnel map: ExRAM = $2800,
; fill = $2C00
NT_A   = $00
NT_B   = $08
NT_EX  = $08
NT_FILL = $0C

; effects
FX_BARS   = 0
FX_TWIST  = 1
FX_GRID   = 2
FX_TUNNEL = 3

.macro WAIT_NMI
  .local w
  lda nmi_count
w: cmp nmi_count
  beq w
.endmacro
