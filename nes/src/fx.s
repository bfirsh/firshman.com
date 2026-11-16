; =====================================================================================
;  DROP 1: SIGNAL  (song 3584..5375)
;  A real-time chunky engine at 60 frames per second. ExRAM is mapped as the nametable
;  (mode 0), which, unlike the PPU's own nametables, the CPU can rewrite while the picture
;  is being drawn. Each frame the CPU recomputes 768 tiles (24 rows) and writes them
;  "behind the beam": every row is rewritten just after it has been displayed, so the next
;  frame shows a complete new image without double buffering.
;    rotozoom: 64x48 chunks of 4x4 px, 4 colours; one tile = 2x2 chunks (256-tile CHR set)
;    plasma:   64x24 chunks of 4x8 px, 16 dithered levels; one tile = 2 chunks
;  The inner loop is generated into PRG-RAM and its operands patched every frame:
;    lda T0+off,y / ora T1+off,y / ora T2+off+d,y / ora T3+off+d,y / sta EXRAM+c,x
;  where T0..T3 are the texture pre-shifted into each chunk's bit position (512-byte
;  doubled tables so the index wraps for free), Y the row's texture base, off a column's
;  offset along the rotated axis, d one chunk down the other axis.
; =====================================================================================

.segment "BANK04"
.include "fx.inc"

FX_ROWA = $6A00          ; generated row routine, rotozoom (32 x 15 bytes + rts)
FX_ROWB = $6C00          ; generated row routine, plasma (32 x 9 bytes + rts)
FX_T0 = $7000
FX_T1 = $7200
FX_T2 = $7400
FX_T3 = $7600
FX_R0 = 4                ; first tile row written
FX_RN = 22               ; rows
FX_GO_LINE = 64          ; rotozoom rows are rewritten behind the beam from this line on
FX_GO_B = 126            ; plasma rows are faster: start later so they never overtake the beam

fx_mode   = pv+0         ; 0 rotozoom, 1 plasma
fx_go     = pv+1         ; set by the IRQ when the beam is far enough down
fx_ang    = pv+2
fx_zoom   = pv+3
fx_dux    = pv+4         ; 16-bit 8.8 signed each
fx_dvx    = pv+6
fx_u      = pv+8
fx_v      = pv+10
fx_cu     = pv+12        ; texture centre (8.8)
fx_cv     = pv+14
fx_d      = pv+16
fx_row    = pv+17
fx_flash  = pv+18
fx_tex    = pv+19        ; which texture is loaded
fx_t      = pv+20        ; 16-bit part time
fx_ru     = pv+22        ; row-start accumulators (8.8)
fx_rv     = pv+24
fx_pal    = pv+26
fx_off    = bss_part     ; 64 column offsets
fx_base   = bss_part+64  ; 24 row bases

; ------------------------------------------------------------------ init
fx_init:
  jsr ppu_off
  lda #EX_RAM
  sta MMC5_EXMODE
  lda #0
  jsr fill_ex             ; all tiles 0 (black), attributes palette 0
  lda #EX_NT
  sta MMC5_EXMODE
  lda #$AA
  sta MMC5_NTMAP          ; all four nametables -> ExRAM
  jsr fx_gen_rows
  lda #$FF
  sta fx_tex
  lda #0
  sta fx_mode
  sta scroll_x
  sta scroll_y
  sta fx_flash
  sta fx_go
  lda #$FF
  sta fx_pal
  lda #<fx_irq
  sta irq_vec
  lda #>fx_irq
  sta irq_vec+1
  jsr fx_select           ; textures, CHR, IRQ line and first set-up for the current time
  lda #%00001010          ; background only, no sprites
  sta ppu_mask
  lda #0
  sta fade
  jsr oam_clear
  jmp ppu_on

; Copy the row-routine templates into PRG-RAM.
fx_gen_rows:
  ldx #0
: lda fx_tpl_a,x
  sta FX_ROWA,x
  lda fx_tpl_a+256,x
  sta FX_ROWA+256,x
  lda fx_tpl_b,x
  sta FX_ROWB,x
  lda fx_tpl_b+256,x
  sta FX_ROWB+256,x
  inx
  bne :-
  rts

fx_tpl_a:
  .repeat 32, c
  lda FX_T0,y
  ora FX_T1,y
  ora FX_T2,y
  ora FX_T3,y
  sta EXRAM+c,x
  .endrepeat
  rts
  .res 512 - (* - fx_tpl_a)
fx_tpl_b:
  .repeat 32, c
  lda FX_T0,y
  ora FX_T1,y
  sta EXRAM+c,x
  .endrepeat
  rts
  .res 512 - (* - fx_tpl_b)

; Load texture tables and CHR for the part of the drop we're in.
; t < 896: rotozoom (texture 1 then 2 at 448); after: plasma.
fx_select:
  sec
  lda tl_frame
  sbc #<3584
  sta fx_t
  lda tl_frame+1
  sbc #>3584
  sta fx_t+1
  ldx #0                  ; texture id
  lda fx_t+1
  cmp #>448
  bcc @tex
  bne :+
  lda fx_t
  cmp #<448
  bcc @tex
: inx
  lda fx_t+1
  cmp #>896
  bcc @tex
  bne :+
  lda fx_t
  cmp #<896
  bcc @tex
: inx
@tex:
  cpx fx_tex
  bne :+
  rts
: stx fx_tex
  txa
  pha
  ; the palette for this effect
  asl a
  asl a
  asl a
  asl a
  asl a
  clc
  adc #<fx_palettes
  sta ptr0
  lda #>fx_palettes
  adc #0
  sta ptr0+1
  jsr set_palette
  pla
  cmp #2
  beq @plasma
  ; rotozoom texture -> T0..T3 = c, c<<2, c<<4, c<<6
  tax
  lda fx_tex_lo,x
  sta ptr0
  lda fx_tex_hi,x
  sta ptr0+1
  ldy #0
: lda (ptr0),y
  sta FX_T0,y
  sta FX_T0+256,y
  asl a
  asl a
  sta FX_T1,y
  sta FX_T1+256,y
  asl a
  asl a
  sta FX_T2,y
  sta FX_T2+256,y
  asl a
  asl a
  sta FX_T3,y
  sta FX_T3+256,y
  iny
  bne :-
  lda #0
  sta fx_mode
  lda #FX_GO_LINE
  sta irq_first
  jsr fx_roto_setup
  lda #FX_CHR_A
  jmp @chr
@plasma:
  ldy #0
: lda fx_ramp,y
  sta FX_T0,y
  sta FX_T0+256,y
  asl a
  asl a
  asl a
  asl a
  sta FX_T1,y
  sta FX_T1+256,y
  iny
  bne :-
  lda #1
  sta fx_mode
  lda #FX_GO_B
  sta irq_first
  jsr fx_plasma_setup
  lda #FX_CHR_B
@chr:
  sta MMC5_CHR0
  clc
  adc #1
  sta MMC5_CHR0+1
  adc #1
  sta MMC5_CHR0+2
  adc #1
  sta MMC5_CHR0+3
  rts

fx_shl4:
  .repeat 256, i
  .byte (i << 4) & $F0
  .endrepeat
fx_tex_lo: .byte <fx_tex1, <fx_tex2
fx_tex_hi: .byte >fx_tex1, >fx_tex2

fx_palettes:
  ; rotozoom 1: dusk blue, sky, white, warm (balloons)
  .byte $0F,$02,$27,$30, $0F,$02,$27,$30, $0F,$02,$27,$30, $0F,$02,$27,$30
  .byte $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F
  ; rotozoom 2: rings
  .byte $0F,$13,$24,$35, $0F,$13,$24,$35, $0F,$13,$24,$35, $0F,$13,$24,$35
  .byte $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F
  ; plasma
  .byte $0F,$12,$26,$37, $0F,$12,$26,$37, $0F,$12,$26,$37, $0F,$12,$26,$37
  .byte $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F, $0F,$0F,$0F,$0F

; ------------------------------------------------------------------ per frame
fx_frame:
  jsr fx_select
  ; kick flash: one step brighter for a few frames
  lda ev_acc
  and #$04
  beq :+
  lda #5
  sta fx_flash
: lda #0
  sta ev_acc
  ldx #0
  lda fx_flash
  beq :+
  dec fx_flash
  ldx #1
: ; fade out over the last frames (t >= 1728): -1 per 16 frames
  lda fx_t+1
  cmp #>1728
  bcc @nf
  bne :+
  lda fx_t
  cmp #<1728
  bcc @nf
: lda fx_t
  sec
  sbc #<1728
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
@nf:
  cpx fade
  beq :+
  stx fade
  jsr apply_fade
  lda #$0F
  sta pal_buf             ; the letterbox stays black through the flashes
  sta pal_buf+16          ; ($3F10 mirrors the backdrop and is uploaded last)
:
  ; rows for this frame (set up last frame), behind the beam: wait for this frame's IRQ
: lda fx_go
  cmp nmi_count
  bne :-
  lda fx_mode
  bne @plasma
  jsr fx_roto_rows
  lda #1
  sta nmi_ready           ; the frame's uploads are ready; the rest may run past the NMI
  jmp fx_roto_setup       ; operands for the next frame
@plasma:
  jsr fx_plasma_rows
  lda #1
  sta nmi_ready
  jmp fx_plasma_setup

; Wait for the beam to pass FX_GO_LINE (the IRQ sets fx_go).
fx_wait:
  lda #0
  sta fx_go
: lda fx_go
  beq :-
  rts

; ---- rotozoom: angle, zoom and centre from the time
fx_roto_setup:
  ; angle = t*3/4 ; zoom (4.4 texels per chunk) = 22 + sin(t*2)*14/128
  lda fx_t
  lsr a
  adc fx_t
  lsr a
  sta fx_ang
  lda fx_t
  asl a
  tax
  lda sin_tab,x
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a
  cmp #$80
  ror a                   ; +-8
  clc
  adc #21
  sta fx_zoom
  ; centre drifts: cu = t*96 (8.8), cv = t*40
  lda fx_t
  sta MMC5_MULA
  lda #96
  sta MMC5_MULB
  lda MMC5_MULA
  sta fx_cu
  lda MMC5_MULB
  sta fx_cu+1
  lda #40
  sta MMC5_MULB
  lda MMC5_MULA
  sta fx_cv
  lda MMC5_MULB
  sta fx_cv+1
  ; dux = cos*zoom/8, dvx = sin*zoom/8
  lda fx_ang
  clc
  adc #64
  tax
  lda sin_tab,x
  jsr fx_smulz
  sta fx_dux+1
  stx fx_dux
  ldx fx_ang
  lda sin_tab,x
  jsr fx_smulz
  sta fx_dvx+1
  stx fx_dvx
  ; column offsets: off[k] = idx(k*dux, k*dvx)
  lda #0
  sta fx_u
  sta fx_u+1
  sta fx_v
  sta fx_v+1
  ldy #0
@col:
  lda fx_u+1
  and #15
  ldx fx_v+1
  ora fx_shl4,x
  sta fx_off,y
  clc
  lda fx_u
  adc fx_dux
  sta fx_u
  lda fx_u+1
  adc fx_dux+1
  sta fx_u+1
  clc
  lda fx_v
  adc fx_dvx
  sta fx_v
  lda fx_v+1
  adc fx_dvx+1
  sta fx_v+1
  iny
  cpy #64
  bne @col
  ; one chunk down: (duy, dvy) = (-dvx, dux)
  sec
  lda #0
  sbc fx_dvx
  sta t2
  lda #0
  sbc fx_dvx+1
  sta t3                  ; duy (8.8)
  lda fx_dux+1
  asl a
  asl a
  asl a
  asl a
  sta t0
  lda t3
  and #15
  ora t0
  sta fx_d
  ; row start at chunk row 6 (screen row 3), centre at chunk (32, 30):
  ;   ru = cu - 32*dux + 24*dvx ; rv = cv - 32*dvx - 24*dux  (chunk row 6; rows start at 8)
  lda fx_dux
  sta t0
  lda fx_dux+1
  sta t1
  ldx #3
: asl t0
  rol t1
  dex
  bne :-                  ; t1:t0 = 8*dux
  lda t0
  sta t4
  lda t1
  sta t5                  ; 8*dux
  asl t0
  rol t1                  ; 16*dux
  clc
  lda t0
  adc t4
  sta t6
  lda t1
  adc t5
  sta t7                  ; 24*dux
  asl t0
  rol t1                  ; 32*dux
  sec
  lda fx_cu
  sbc t0
  sta fx_ru
  lda fx_cu+1
  sbc t1
  sta fx_ru+1
  sec
  lda fx_cv
  sbc t6
  sta fx_rv
  lda fx_cv+1
  sbc t7
  sta fx_rv+1
  lda fx_dvx
  sta t0
  lda fx_dvx+1
  sta t1
  ldx #3
: asl t0
  rol t1
  dex
  bne :-                  ; 8*dvx
  lda t0
  sta t4
  lda t1
  sta t5
  asl t0
  rol t1                  ; 16*dvx
  clc
  lda t0
  adc t4
  sta t6
  lda t1
  adc t5
  sta t7                  ; 24*dvx
  asl t0
  rol t1                  ; 32*dvx
  clc
  lda fx_ru
  adc t6
  sta fx_ru
  lda fx_ru+1
  adc t7
  sta fx_ru+1
  sec
  lda fx_rv
  sbc t0
  sta fx_rv
  lda fx_rv+1
  sbc t1
  sta fx_rv+1
  ; row bases, stepping 2 chunks down per tile row: (ru, rv) += (-2*dvx, 2*dux)
  lda fx_dvx
  asl a
  sta t4
  lda fx_dvx+1
  rol a
  sta t5
  lda fx_dux
  asl a
  sta t6
  lda fx_dux+1
  rol a
  sta t7
  ldy #0
@rb:
  lda fx_rv+1
  asl a
  asl a
  asl a
  asl a
  sta t0
  lda fx_ru+1
  and #15
  ora t0
  sta fx_base,y
  sec
  lda fx_ru
  sbc t4
  sta fx_ru
  lda fx_ru+1
  sbc t5
  sta fx_ru+1
  clc
  lda fx_rv
  adc t6
  sta fx_rv
  lda fx_rv+1
  adc t7
  sta fx_rv+1
  iny
  cpy #FX_RN
  bne @rb
  ; patch the row routine: per tile c, operands off[2c], off[2c+1], +d
  ldx #0                  ; tile
  ldy #0                  ; code offset
@pt:
  txa
  asl a
  sta t0
  stx t1
  ldx t0
  lda fx_off,x
  sta FX_ROWA+1,y
  clc
  adc fx_d
  sta FX_ROWA+7,y
  lda fx_off+1,x
  sta FX_ROWA+4,y
  clc
  adc fx_d
  sta FX_ROWA+10,y
  ldx t1
  tya
  clc
  adc #15
  tay
  bcc :+
  ; past 256 bytes of code: continue in the second page
  jmp @pt2
: inx
  cpx #32
  bne @pt
  rts
@pt2:
  inx
  ; remaining tiles live at FX_ROWA+256+y
@pt2l:
  txa
  asl a
  sta t0
  stx t1
  ldx t0
  lda fx_off,x
  sta FX_ROWA+256+1,y
  clc
  adc fx_d
  sta FX_ROWA+256+7,y
  lda fx_off+1,x
  sta FX_ROWA+256+4,y
  clc
  adc fx_d
  sta FX_ROWA+256+10,y
  ldx t1
  tya
  clc
  adc #15
  tay
  inx
  cpx #32
  bne @pt2l
  rts

; A = signed sin value -> X:A = (A * fx_zoom) / 8 as signed 16-bit (X lo, A hi)
fx_smulz:
  cmp #$80
  php
  bcc :+
  eor #$FF
  adc #0
: sta MMC5_MULA
  lda fx_zoom
  sta MMC5_MULB
  lda MMC5_MULA
  sta t0
  lda MMC5_MULB
  lsr a
  ror t0
  lsr a
  ror t0
  lsr a
  ror t0
  plp
  bcc :+
  eor #$FF
  tax
  lda t0
  eor #$FF
  clc
  adc #1
  sta t0
  txa
  adc #0
: ldx t0
  rts

; Write the 24 rows (behind the beam).
fx_roto_rows:
  lda #0
  sta fx_row
  sta t2
@r:
  ldx fx_row
  lda fx_base,x
  tay
  ; destination: ExRAM row FX_R0+row -> page and x
  txa
  clc
  adc #FX_R0
  sta t0
  lsr a
  lsr a
  lsr a
  clc
  adc #>EXRAM
  cmp t2
  beq :+
  sta t2
  jsr fx_patch_dest_a
: lda t0
  asl a
  asl a
  asl a
  asl a
  asl a
  tax
  jsr FX_ROWA
  inc fx_row
  lda fx_row
  cmp #FX_RN
  bne @r
  lda #0
  sta t2
  rts

; Patch the 32 destination high bytes of the rotozoom row routine to A.
fx_patch_dest_a:
  .repeat 32, c
  sta FX_ROWA + c*15 + 14
  .endrepeat
  rts
fx_patch_dest_b:
  .repeat 32, c
  sta FX_ROWB + c*9 + 8
  .endrepeat
  rts

; ---- plasma: columns A[k] = sin(k*5 + t*2) + sin(k*3 - t), rows B[r] = sin(r*11 + t*3)
fx_plasma_setup:
  ldy #0
@c:
  tya
  asl a
  asl a
  sta t0
  tya
  adc t0                  ; k*5
  sta t0
  lda fx_t
  asl a
  adc t0
  tax
  lda sin_tab,x
  sta t1
  tya
  asl a
  sta t0
  tya
  adc t0                  ; k*3
  sec
  sbc fx_t
  tax
  lda sin_tab,x
  cmp #$80
  ror a
  clc
  adc t1
  sta fx_off,y
  iny
  cpy #64
  bne @c
  ; patch operands: left chunk = off[2c], right = off[2c+1]
  ldx #0
  ldy #0
@p:
  txa
  asl a
  sta t0
  stx t1
  ldx t0
  lda fx_off,x
  sta FX_ROWB+1,y
  lda fx_off+1,x
  sta FX_ROWB+4,y
  ldx t1
  tya
  clc
  adc #9
  tay
  bcs @p2
  inx
  cpx #32
  bne @p
  jmp @rows
@p2:
  inx
@p2l:
  txa
  asl a
  sta t0
  stx t1
  ldx t0
  lda fx_off,x
  sta FX_ROWB+256+1,y
  lda fx_off+1,x
  sta FX_ROWB+256+4,y
  ldx t1
  tya
  clc
  adc #9
  tay
  inx
  cpx #32
  bne @p2l
@rows:
  ldy #0
@rb:
  tya
  asl a
  asl a
  asl a
  sta t0
  tya
  asl a
  adc t0                  ; r*10
  sta t0
  lda fx_t
  asl a
  adc fx_t
  adc t0
  tax
  lda sin_tab,x
  sta fx_base,y
  iny
  cpy #FX_RN
  bne @rb
  rts

fx_plasma_rows:
  lda #0
  sta fx_row
  sta t2
@r:
  ldx fx_row
  lda fx_base,x
  tay
  txa
  clc
  adc #FX_R0
  sta t0
  lsr a
  lsr a
  lsr a
  clc
  adc #>EXRAM
  cmp t2
  beq :+
  sta t2
  jsr fx_patch_dest_b
: lda t0
  asl a
  asl a
  asl a
  asl a
  asl a
  tax
  jsr FX_ROWB
  inc fx_row
  lda fx_row
  cmp #FX_RN
  bne @r
  lda #0
  sta t2
  rts

; ------------------------------------------------------------------ IRQ (fixed)
.segment "CODE"
fx_irq:
  pha
  lda MMC5_IRQSTAT
  lda nmi_count            ; "the beam has passed the start line in frame nmi_count"
  sta fx_go
  pla
  rti
