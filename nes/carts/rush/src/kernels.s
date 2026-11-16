; =====================================================================================
;  Per-line handlers for the twister and the floor, and the tunnel's band IRQs.
;  Cycle budget per line: 113.67 = 7 (IRQ entry) + 5 (jmp (irq_vec)) + body + ~1 (sled).
;  The handler's first cycle is at about dot 40 of its line; a write at body cycle c lands
;  at dot ~40 + 3c, and the critical $2005/$2006 pair must land in dots 257-320.
; =====================================================================================
.segment "CODE"

; ---- twister: the copper band from the y table, the slice angle from the multiplier
;   angle(L) = hi(L * rate) + bend[(L + tpo) & 255] + a0;  slot-0 bank = 32 + (angle & 31)
k_twist:
  lda MMC5_IRQSTAT        ; 4   4
  ldy kl                  ; 3   7
  lda ktarget,y           ; 4  11
  sta MMC5_IRQLINE        ; 4  15
  sty MMC5_MULA           ; 4  19   product L * rate (B was set by the entry IRQ)
  lda (kyp),y             ; 5  24   copper band row (nametable A)
  tax                     ; 2  26
  lda lo_of_y,x           ; 4  30
  ora kf_xc               ; 3  33
  sta klo                 ; 3  36
  lda #NT_A               ; 2  38
  sta PPUADDR             ; 4  42
  stx PPUSCROLL           ; 4  46
  tya                     ; 2  48
  adc kf_tpo              ; 3  51
  tax                     ; 2  53
  lda MMC5_MULB           ; 4  57
  adc tw_bend,x           ; 4  61
  adc kf_a0               ; 3  64
  and #31                 ; 2  66
  ora #TW_BASE            ; 2  68
  ldx kf_x                ; 3  71
  ldy klo                 ; 3  74
  stx PPUSCROLL           ; 4  78   fine x       (dot ~274)
  sty PPUADDR             ; 4  82   v = t        (dot ~286)
  sta MMC5_CHR0           ; 4  86   the next line's slice, after this line's twister fetches
  inc kl                  ; 5  91
  rti                     ; 6  97

; ---- floor (template, runs from PRG-RAM so its table operands can be patched per frame)
;   row = g_row[L] | (linep[z[L] + camz] & mask[L]);  X from the curve tables;  slot-0 bank per line
k_grid_tpl:
  lda MMC5_IRQSTAT        ; 4   4
  ldx kl                  ; 3   7
  lda ktarget,x           ; 4  11
  sta MMC5_IRQLINE        ; 4  15
  ldy g_z,x               ; 4  19
KG_LP = * - k_grid_tpl + 1
  lda g_linep,y           ; 4+ 24   operand = g_linep + camz
  and g_mask,x            ; 4  28
KG_ROW = * - k_grid_tpl + 1
  ora grow0,x             ; 4  32   operand = grow0 / grow1
  tay                     ; 2  34
  lda g_hi,x              ; 4  38
  sta PPUADDR             ; 4  42
  sty PPUSCROLL           ; 4  46
KG_CC = * - k_grid_tpl + 1
  lda curve_c - KS,x      ; 4+ 51   operand = this frame's curve (X >> 3)
  ora lo_of_y,y           ; 4  55
  tay                     ; 2  57
  lda g_bank,x            ; 4  61
  sta kt                  ; 3  64
KG_CF = * - k_grid_tpl + 1
  lda curve_f - KS,x      ; 4+ 69   (fine X)
  tax                     ; 2  71
  lda kt                  ; 3  74
  stx PPUSCROLL           ; 4  78
  sty PPUADDR             ; 4  82
  sta MMC5_CHR0           ; 4  86
  inc kl                  ; 5  91
  rti                     ; 6  97
K_GRID_LEN = * - k_grid_tpl

; NMI (grid frames): patch the floor handler for this frame from g_patch (camz, curve, buffer).
grid_patch:
  lda g_patch
  sta k_grid + KG_LP
  lda g_patch+1
  sta k_grid + KG_LP + 1
  lda g_patch+2
  sta k_grid + KG_CC
  lda g_patch+3
  sta k_grid + KG_CC + 1
  lda g_patch+4
  sta k_grid + KG_CF
  lda g_patch+5
  sta k_grid + KG_CF + 1
  lda kbuf
  clc
  adc #>grow0
  sta k_grid + KG_ROW + 1
  rts

; ---- tunnel: CHR bands. Nametable = ExRAM rows 0-21 (tile = (row & 7) * 32 + column), so
; each band of 8 rows is 4 KB of CHR; bands switch in two halves while the other half draws.
; kf_aux = first bank of this frame (TU_BASE + frame * 12).
tu_irq1:                  ; line KS-2: slots 0, 2, 3 for band 0 (the letterbox uses slot 1 only)
  pha
  lda MMC5_IRQSTAT
  lda kf_aux
  sta MMC5_CHR0
  clc
  adc #2
  sta MMC5_CHR0+2
  adc #1
  sta MMC5_CHR0+3
  lda #KS-1
  sta MMC5_IRQLINE
  lda #<tu_irq2
  sta irq_vec
  lda #>tu_irq2
  sta irq_vec+1
  pla
  rti

tu_irq2:                  ; line KS-1: in its horizontal blank, slot 1 and v -> ExRAM row 0
  pha
  txa
  pha
  lda MMC5_IRQSTAT
  ldx kf_aux
  inx
  lda #KS + 56
  sta MMC5_IRQLINE
  lda #<tu_irq3
  sta irq_vec
  lda #>tu_irq3
  sta irq_vec+1
  lda #NT_EX               ; $2006 = $08 $00: nametable 2 (ExRAM), row 0, fine y 0
  sta PPUADDR
  lda #0
  KDELAY 30
  stx MMC5_CHR0+1
  sta PPUADDR
  pla
  tax
  pla
  rti

tu_irq3:                  ; row 7 (slot 3) is drawing: slots 0-2 for band 1
  pha
  lda MMC5_IRQSTAT
  lda kf_aux
  clc
  adc #4
  sta MMC5_CHR0
  adc #1
  sta MMC5_CHR0+1
  adc #1
  sta MMC5_CHR0+2
  lda #KS + 64
  sta MMC5_IRQLINE
  lda #<tu_irq4
  sta irq_vec
  lda #>tu_irq4
  sta irq_vec+1
  pla
  rti

tu_irq4:                  ; row 8 (slot 0) is drawing: slot 3 for band 1
  pha
  lda MMC5_IRQSTAT
  lda kf_aux
  clc
  adc #7
  sta MMC5_CHR0+3
  lda #KS + 120
  sta MMC5_IRQLINE
  lda #<tu_irq5
  sta irq_vec
  lda #>tu_irq5
  sta irq_vec+1
  pla
  rti

tu_irq5:                  ; row 15 (slot 3) is drawing: slots 0-2 for band 2 (rows 16-21 use 0-2)
  pha
  lda MMC5_IRQSTAT
  lda kf_aux
  clc
  adc #8
  sta MMC5_CHR0
  adc #1
  sta MMC5_CHR0+1
  adc #1
  sta MMC5_CHR0+2
  lda #KE-1
  sta MMC5_IRQLINE
  lda #<tu_irq6
  sta irq_vec
  lda #>tu_irq6
  sta irq_vec+1
  pla
  rti

tu_irq6:                  ; last line (row 21, slot 2): slot 1 back to the common tiles, then
  pha                     ; in the horizontal blank, v -> the fill nametable
  lda MMC5_IRQSTAT
  lda #1
  sta MMC5_CHR0+1
  lda #0
  sta MMC5_IRQLINE
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #NT_FILL
  sta PPUADDR
  lda #0
  KDELAY 34
  sta PPUADDR
  pla
  rti
