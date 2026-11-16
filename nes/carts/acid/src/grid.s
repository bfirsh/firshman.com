; =====================================================================================
;  GRID: an infinite grid floor under a starfield
;
;  The fan of floor lines is a static picture (tools/gen_grid.py). The cross lines are made by
;  the raster kernel: on every scanline of the floor it rewrites the scroll registers
;  ($2006/$2005/$2005/$2006 in the horizontal blank), either showing that scanline's own row
;  of the picture or one of three solid "line rows" kept in ExRAM (nametable 2). Each frame the
;  main thread decides per scanline whether a cross line of the grid passes between the depths
;  of its near and far edge, so the lines are exact, one scanline thin in the distance and
;  thick near the camera, for any camera position. The kernel itself is the first cartridge's:
;  the first IRQ parks the CPU in a NOP sled so every per-line IRQ lands within a cycle.
; =====================================================================================

GK0 = $6000             ; kernel tables (PRG-RAM bank 2): hi, y, x, lo (256 each)
GK1 = $6500
GK_HI = 0
GK_Y = $100
GK_X = $200
GK_LO = $300
GK_DELAY = 22

.segment "ZEROPAGE"
gk_buf: .res 1          ; table buffer the kernel shows
gk_flip: .res 1
gk_start: .res 1
gk_count: .res 1
gk_end: .res 1
grid_camz: .res 2       ; camera depth, 8.8 world units
grid_speed: .res 2
grid_w: .res 2          ; cross line width (8.8)
grid_lc: .res 1         ; line colour boost (flash)
grid_alt: .res 1        ; palette set (0 intro/outro green lines, 1 breakdown magenta)

.segment "CODEC"

grid_install:
  lda #0
  sta vec_on
  lda #$E0                ; $2000 CIRAM A, $2400 CIRAM A, $2800 ExRAM, $2C00 fill
  sta MMC5_NTMAP
  SET_BANKA 23
  bit PPUSTATUS
  lda #$00
  sta PPUADDR
  sta PPUADDR
  lda #<grid_chr
  sta ptr0
  lda #>grid_chr
  sta ptr0+1
  ldx #<(GRID_NTILES * 16 / 256 + 1)
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  jsr load_sprite_chr
  lda #<grid_nt
  sta ptr0
  lda #>grid_nt
  sta ptr0+1
  lda #$20
  ldx #4
  jsr copy_vram
  ; ExRAM: three rows of solid tiles (colour 1, 2, 3), attributes palette 2
  lda #2
  sta MMC5_EXMODE
  ldx #0
: lda #GRID_SOLID1
  sta EXRAM,x
  lda #GRID_SOLID2
  sta EXRAM+32,x
  lda #GRID_SOLID3
  sta EXRAM+64,x
  inx
  cpx #32
  bne :-
  ldx #0
  lda #$AA
: sta EXRAM+960,x
  inx
  cpx #64
  bne :-
  lda #0
  sta MMC5_EXMODE
  lda #$E0
  sta MMC5_NTMAP
  SET_RAM 2
  lda #GRID_HZ + 1
  sta gk_start
  lda #239 - GRID_HZ
  sta gk_count
  lda #0
  sta gk_buf
  sta gk_flip
  sta grid_camz
  sta grid_camz+1
  sta grid_lc
  jsr oam_clear
  lda #>oam
  sta oam_page
  ; identity tables in both buffers
  lda #0
  sta gk_buf
  jsr grid_tables
  lda #1
  sta gk_buf
  jsr grid_tables
  lda #0
  sta gk_buf
  lda #<grid_nmi
  sta nmi_vec
  lda #>grid_nmi
  sta nmi_vec+1
  lda #<grid_irq
  sta irq_vec
  lda #>grid_irq
  sta irq_vec+1
  lda #<grid_tail
  sta tail_vec
  lda #>grid_tail
  sta tail_vec+1
  lda #%10001000
  sta ppu_ctrl
  lda #%00011110
  sta ppu_mask
  lda #0
  sta scroll_x
  sta scroll_y
  rts

grid_nmi:
  lda #0
  sta OAMADDR
  lda oam_page
  sta OAMDMA
  jsr upload_palette
  lda gk_flip
  beq :+
  lda gk_buf
  eor #1
  sta gk_buf
  lda #0
  sta gk_flip
: bit PPUSTATUS
  lda ppu_ctrl
  sta PPUCTRL
  lda #0
  sta PPUSCROLL
  sta PPUSCROLL
  lda ppu_mask
  sta PPUMASK
  lda MMC5_IRQSTAT
  lda gk_start
  sec
  sbc #2
  sta MMC5_IRQLINE
  lda #$80
  sta MMC5_IRQSTAT
  jmp nmi_common

grid_tail:
  jsr vec_stars
  jsr grid_palette
  jmp pal_finish

; ------------------------------------------------------------------ the kernel
.macro GK_ENTER handler
  lda #<handler
  sta irq_vec
  lda #>handler
  sta irq_vec+1
  cli
  jmp gk_sled
.endmacro

.macro GK_LINE base, D
  lda MMC5_IRQSTAT
  stx MMC5_IRQLINE
  lda base+GK_HI,x
  sta PPUADDR
  lda base+GK_Y,x
  sta PPUSCROLL
  ldy base+GK_LO,x
  lda base+GK_X,x
  .repeat D
  nop
  .endrepeat
  sta PPUSCROLL
  sty PPUADDR
  inx
  cpx gk_end
  beq :+
  rti
: jmp gk_finish
.endmacro

grid_irq:
  pha
  txa
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda gk_start
  clc
  adc gk_count
  sta gk_end
  ldx gk_start
  dex
  stx MMC5_IRQLINE
  inx
  bit PPUSTATUS
  lda gk_buf
  bne :+
  GK_ENTER gk_line0
: GK_ENTER gk_line1

gk_line0:
  GK_LINE GK0, GK_DELAY
gk_line1:
  GK_LINE GK1, GK_DELAY

gk_sled:
  .repeat 120
  nop
  .endrepeat
  jmp gk_sled

gk_finish:
  pla                     ; drop the sled's interrupt frame
  pla
  pla
  lda #0
  sta MMC5_IRQLINE
  lda #<grid_irq
  sta irq_vec
  lda #>grid_irq
  sta irq_vec+1
  lda MMC5_IRQSTAT
  pla
  tay
  pla
  tax
  pla
  rti

; ------------------------------------------------------------------ tables
; Build the buffer the kernel is NOT showing (gk_buf ^ 1) for the current camera, or the
; buffer gk_buf itself when called from the installer.
grid_tables:
  lda #<GK0
  sta ptr1
  lda gk_buf
  eor #1
  beq :+
  lda #>GK1
  bne :++
: lda #>GK0
: sta ptr1+1              ; ptr1 -> hi table of the back buffer
  SET_BANKA 23
  ldy gk_start
  ldx #0                  ; index into the depth tables
@l:
  ; line test: floor((zb + camz) / 32) != floor((za - w + camz) / 32)
  lda grid_zb_lo,x
  clc
  adc grid_camz
  lda grid_zb_hi,x
  adc grid_camz+1
  and #$E0
  sta t0
  lda grid_za_lo,x
  sec
  sbc grid_w
  sta t1
  lda grid_za_hi,x
  sbc grid_w+1
  sta t2
  lda t1
  clc
  adc grid_camz
  lda t2
  adc grid_camz+1
  and #$E0
  cmp t0
  beq @plain
  ; a cross line: one of the ExRAM rows by distance
  cpx #12
  bcc @plain              ; (too close to the horizon: the glow covers it)
  lda #2 << 3 | 3
  cpx #40
  bcs :+
  lda #1 << 3 | 3
  cpx #22
  bcs :+
  lda #0 << 3 | 3
: sta t3                  ; source y in nametable 2
  lda #8                  ; nametable 2, y >> 6 = 0
  sta (ptr1),y
  inc ptr1+1
  lda t3
  sta (ptr1),y
  inc ptr1+1
  lda #0
  sta (ptr1),y
  inc ptr1+1
  lda t3
  asl a
  asl a
  and #$E0
  sta (ptr1),y
  jmp @next
@plain:
  tya
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  lsr a
  sta (ptr1),y            ; hi = y >> 6
  inc ptr1+1
  tya
  sta (ptr1),y
  inc ptr1+1
  lda #0
  sta (ptr1),y
  inc ptr1+1
  tya
  asl a
  asl a
  and #$E0
  sta (ptr1),y
@next:
  dec ptr1+1
  dec ptr1+1
  dec ptr1+1
  inx
  iny
  cpy #240
  beq :+
  jmp @l
: rts

; Palette: magenta fan and glow, green cross lines (flash with grid_lc), black sky.
grid_palette:
  ldx #31
  lda grid_alt
  cmp #1
  beq @alt
: lda grid_pal,x
  sta pal_buf,x
  dex
  bpl :-
  jmp @lc
@alt:
: lda grid_pal2,x
  sta pal_buf,x
  dex
  bpl :-
@lc:
  lda grid_lc
  beq @r
  asl a
  asl a
  asl a
  asl a
  sta i0
  ldx #9
: lda pal_buf,x
  clc
  adc i0
  cmp #$40
  bcc :+
  lda #$30
: sta pal_buf,x
  inx
  cpx #12
  bne :--
  dec grid_lc
@r:
  rts

.segment "RODATA"
grid_pal:
  .byte $0F, $04, $14, $24,  $0F, $0F, $0F, $0F,  $0F, $0A, $1A, $2A,  $0F, $0F, $0F, $0F
  .byte $0F, $2A, $15, $30,  $0F, $1A, $0A, $2A,  $0F, $25, $15, $35,  $0F, $14, $04, $24
grid_pal2:
  .byte $0F, $0A, $1A, $2A,  $0F, $0F, $0F, $0F,  $0F, $04, $14, $25,  $0F, $0F, $0F, $0F
  .byte $0F, $25, $15, $35,  $0F, $1A, $0A, $2A,  $0F, $25, $15, $35,  $0F, $14, $04, $24
.segment "CODEC"
