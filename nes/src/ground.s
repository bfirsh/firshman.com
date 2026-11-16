; =====================================================================================
;  GROUND + LIFT-OFF  (song 0..1791)
;  A two-screen-tall dawn landscape held as an MMC5 extended-attribute bitmap: every 8x8 tile
;  has its own 4 KB CHR bank and palette, so the whole picture is unique tiles. The camera
;  tilts up after the release by streaming nametable rows (NMI) and ExRAM rows (during
;  rendering, the only time ExRAM accepts writes) into the 30-row ring, one row ahead.
;  A scanline IRQ blanks the bottom 8 lines, where the ring's seam would show.
; =====================================================================================

.segment "BANK00"

.include "ground.inc"
ground_rows: .incbin "ground_rows.bin"

g_cam      = pv+0      ; 16-bit camera: image y of the top screen line (0..240)
g_loaded   = pv+2      ; lowest image row present in the ring
g_by       = pv+3      ; 16-bit balloon centre, image y
g_key_cur  = pv+5

GROUND_BASE_Y = 240 + 196 - 43        ; balloon centre while on the ground (image y)
RELEASE_T = 896

ground_init:
  jsr ppu_off
  lda #EX_RAM
  sta MMC5_EXMODE
  ; sprites from the ground page
  ldx #0
: txa
  clc
  adc #GROUND_SPR
  sta MMC5_CHR0+4,x
  inx
  cpx #4
  bne :-
  ; rows 30..59 of the picture -> ring rows 0..29
  lda #<(ground_rows + 30*64)
  sta ptr0
  lda #>(ground_rows + 30*64)
  sta ptr0+1
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #<(EXRAM-32)        ; indexed with y = 32..63 below
  sta ptr1
  lda #>(EXRAM-32)
  sta ptr1+1
  ldx #30
@row:
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  cpy #32
  bne :-
: lda (ptr0),y
  sta (ptr1),y
  iny
  cpy #64
  bne :-
  lda ptr0
  clc
  adc #64
  sta ptr0
  bcc :+
  inc ptr0+1
: lda ptr1
  clc
  adc #32
  sta ptr1
  bcc :+
  inc ptr1+1
: dex
  bne @row
  lda #EX_ATTR
  sta MMC5_EXMODE
  lda #240
  sta g_cam
  lda #0
  sta g_cam+1
  lda #30
  sta g_loaded
  lda #0
  sta scroll_x
  sta scroll_y
  lda #$FC
  sta fade
  lda #$FF
  sta g_key_cur
  lda #<ground_key0
  sta ptr0
  lda #>ground_key0
  sta ptr0+1
  jsr set_palette
  ; raster kernel over the lake band (lines 160-189), then the seam mask at 232
  lda #160
  sta rk_start
  lda #30
  sta rk_count
  lda #232
  sta rk_after
  lda #<ground_irq
  sta rk_after_vec
  lda #>ground_irq
  sta rk_after_vec+1
  lda #<rk_irq
  ldy #>rk_irq
  jsr set_kernel
  lda #240
  sta g_cam
  jsr g_ripple
  lda rk_buf
  eor #1
  sta rk_buf
  jsr g_ripple
  lda #158
  sta irq_first
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

; ------------------------------------------------------------------ per frame
ground_frame:
  ; ---- palette: black -> night -> dawn, keyed to the song
  ldx #0
@kf:
  lda tl_frame+1
  cmp g_key_t_hi+1,x
  bcc @ksel
  bne @knext
  lda tl_frame
  cmp g_key_t_lo+1,x
  bcc @ksel
@knext:
  inx
  cpx #G_NKEYS-1
  bne @kf
@ksel:
  cpx g_key_cur
  beq @kdone
  stx g_key_cur
  lda g_key_fade,x
  sta fade
  ldy g_key_pal,x
  lda ground_key_lo,y
  sta ptr0
  lda ground_key_hi,y
  sta ptr0+1
  jsr set_palette
@kdone:
  ; ---- balloon height (image y), released at RELEASE_T
  jsr g_balloon_y
  ; ---- camera follows: cam = clamp(by - 104, 0, 240)
  sec
  lda g_by
  sbc #104
  sta t0
  lda g_by+1
  sbc #0
  bmi @cam0
  bne @cam240
  lda t0
  cmp #240
  bcc @camok
@cam240:
  lda #240
  bne @camok
@cam0:
  lda #0
@camok:
  sta g_cam
  ; ---- stream the row entering at the top
  lsr a
  lsr a
  lsr a
  cmp g_loaded
  bcs @nostream
  dec g_loaded
  jsr g_load_row
@nostream:
  ; scroll register = cam mod 240 (cam is 0..240)
  lda g_cam
  cmp #240
  bcc :+
  lda #0
: sta scroll_y
  jsr g_ripple
  lda #1
  sta rk_flip
  ; ---- sprites
  jsr oam_clear
  jsr g_draw_balloon
  jsr g_draw_sun
  jsr g_draw_stars
  rts

; Raster table for lines 160..189: each shows picture row (line + cam) mod 240; rows that
; fall in the lake (picture rows 398..429) get a horizontal ripple growing with nearness.
g_ripple:
  jsr rk_begin
  ldy #160
@l:
  sty t8
  tya
  clc
  adc g_cam
  sta t0
  lda #0
  adc #0
  sta t1                  ; r = line + cam (16-bit)
  ; lake?
  lda t0
  sec
  sbc #<398
  sta t2
  lda t1
  sbc #>398
  bne @flat
  lda t2
  cmp #32
  bcs @flat
  ; x = sin(r*7 + frame*3) * (depth + 6) / 512
  adc #6
  sta MMC5_MULB
  lda t0
  asl a
  asl a
  asl a
  sec
  sbc t0
  sta t3
  lda nmi_count
  asl a
  adc nmi_count
  adc t3
  tax
  lda sin_tab,x
  bpl @pos
  eor #$FF
  clc
  adc #1
  sta MMC5_MULA
  lda MMC5_MULB
  lsr a
  eor #$FF
  clc
  adc #1
  jmp @setx
@pos:
  sta MMC5_MULA
  lda MMC5_MULB
  lsr a
  jmp @setx
@flat:
  lda #0
@setx:
  sta t9
  ; nametable y = r mod 240
  lda t1
  beq :+
  lda t0
  clc
  adc #16                 ; (256 + r_lo) - 240
  jmp @puty
: lda t0
  cmp #240
  bcc @puty
  sbc #240
@puty:
  ldy t8
  jsr rk_put
  ldy t8
  iny
  cpy #190
  bne @l
  rts

.define G_KEY_T 448, 470, 490, 510, 640, 770, 900
G_NKEYS = 7
g_key_t_lo: .lobytes G_KEY_T
g_key_t_hi: .hibytes G_KEY_T
g_key_pal:  .byte 0, 0, 0, 0, 1, 2, 3
g_key_fade: .byte $FD, $FE, $FF, 0, 0, 0, 0

; balloon centre image y -> g_by (16-bit)
g_balloon_y:
  lda tl_frame
  sec
  sbc #<RELEASE_T
  sta t0
  lda tl_frame+1
  sbc #>RELEASE_T
  sta t1
  bcs @flying
  lda #<GROUND_BASE_Y
  sta g_by
  lda #>GROUND_BASE_Y
  sta g_by+1
  rts
@flying:
  ; u = t1:t0 frames since release. rise = u^2/1024 for u < 200, else 39 + (u-200)*92/256
  lda t1
  bne @cruise
  lda t0
  cmp #200
  bcs @cruise
  tax
  jsr mul8                ; A*X -> A hi, Y lo
  lsr a
  lsr a                   ; /1024 (hi byte /4)
  sta t2
  lda #0
  sta t3
  jmp @apply
@cruise:
  lda t0
  sec
  sbc #200
  sta t0
  lda t1
  sbc #0
  sta t1                  ; u-200 (16 bit, < 1024)
  ; (u-200)*92/256: multiply lo and hi parts
  lda t0
  ldx #92
  jsr mul8                ; hi in A
  sta t2
  lda t1
  ldx #92
  jsr mul8                ; (t1*92) -> Y lo, A hi ; contributes t1*92 (whole units)
  sta t3
  tya
  clc
  adc t2
  sta t2
  lda t3
  adc #0
  sta t3
  lda t2
  clc
  adc #39
  sta t2
  bcc @apply
  inc t3
@apply:
  sec
  lda #<GROUND_BASE_Y
  sbc t2
  sta g_by
  lda #>GROUND_BASE_Y
  sbc t3
  sta g_by+1
  rts

; Queue nametable row g_loaded and write its ExRAM row now (we are mid-frame; the ring row
; being replaced is the masked bottom row).
g_load_row:
  lda g_loaded
  ; source = ground_rows + row*64
  sta t0
  lda #0
  sta t1
  ldx #6
: asl t0
  rol t1
  dex
  bne :-
  clc
  lda t0
  adc #<ground_rows
  sta ptr0
  lda t1
  adc #>ground_rows
  sta ptr0+1
  clc
  lda ptr0
  adc #32
  sta ptr2
  lda ptr0+1
  adc #0
  sta ptr2+1
  ; ring row = row mod 30
  lda g_loaded
  cmp #30
  bcc :+
  sbc #30
: sta t2
  ; dest offset = ring*32
  lda #0
  sta t4
  lda t2
  asl a
  asl a
  asl a
  asl a
  rol t4
  asl a
  rol t4
  sta t3                  ; t4:t3 = ring*32
  ; VRAM queue entry
  ldx vq_len
  lda #$20
  clc
  adc t4
  sta vq,x
  lda t3
  sta vq+1,x
  lda #32
  sta vq+2,x
  ldy #0
: lda (ptr0),y
  sta vq+3,x
  inx
  iny
  cpy #32
  bne :-
  inx
  inx
  inx
  lda #0
  sta vq,x
  stx vq_len
  ; ExRAM row (only accepted while the PPU renders)
  lda t3
  sta ptr1
  lda t4
  clc
  adc #>EXRAM
  sta ptr1+1
  jsr wait_inframe
  ldy #31
: lda (ptr2),y
  sta (ptr1),y
  dey
  bpl :-
  rts

; Balloon at (128, by - cam)
g_draw_balloon:
  lda #<meta_balloon
  sta ptr0
  lda #>meta_balloon
  sta ptr0+1
  lda #128
  sta t0
  lda #0
  sta t4
  sec
  lda g_by
  sbc g_cam
  sta t1
  lda g_by+1
  sbc g_cam+1
  sta t3
  lda t1
  bne :+
  dec t3
: dec t1                  ; OAM y = screen y - 1
  jmp draw_meta

; Sun: frame k = (tl_frame - SUN_T) / 26, clamped to 0..SUN_FRAMES-1, at image y SUN_Y0 - k
g_draw_sun:
  lda tl_frame
  sec
  sbc #<SUN_T
  sta t0
  lda tl_frame+1
  sbc #>SUN_T
  bcs :+
  rts
: sta t1
  ; divide by 26 (repeated subtraction, at most ~50 steps)
  ldx #0
@div:
  lda t0
  sec
  sbc #26
  tay
  lda t1
  sbc #0
  bcc @dd
  sta t1
  sty t0
  inx
  cpx #SUN_FRAMES-1
  bne @div
@dd:
  stx t7
  lda sun_meta_lo,x
  sta ptr0
  lda sun_meta_hi,x
  sta ptr0+1
  lda #<SUN_X_I
  sta t0
  lda #0
  sta t4
  ; image y = SUN_Y0 - k - 12 (meta origin is the centre) -> screen = that - cam
  lda #<SUN_Y0
  sec
  sbc t7
  sta t1
  lda #>SUN_Y0
  sbc #0
  sta t3
  sec
  lda t1
  sbc g_cam
  sta t1
  lda t3
  sbc g_cam+1
  sta t3
  lda t1
  bne :+
  dec t3
: dec t1
  jmp draw_meta

SUN_X_I = 168
SUN_T = 600

; Stars: fixed image positions, twinkling, gone by dawn (their palette fades with the rest).
g_draw_stars_any:
  jmp g_stars_go
g_draw_stars:
  lda tl_frame+1
  cmp #>900
  bcc :+
  bne g_stars_r
  lda tl_frame
  cmp #<900
  bcs g_stars_r
:
g_stars_go:
  ldx #0
@l:
  stx t8
  lda g_star_x,x
  sta t0
  lda #0
  sta t4
  sec
  lda g_star_y,x
  sbc g_cam
  sta t1
  lda g_star_yh,x
  sbc g_cam+1
  sta t3
  ; twinkle: star2 when (nmi_count + x*37) & 31 < 4
  txa
  asl a
  asl a
  asl a
  asl a
  adc t8
  adc nmi_count
  and #31
  cmp #3
  lda #<meta_star1
  ldy #>meta_star1
  bcs :+
  lda #<meta_star2
  ldy #>meta_star2
: sta ptr0
  sty ptr0+1
  jsr draw_meta
  ldx t8
  inx
  cpx #G_STARS
  bne @l
g_stars_r:
  rts

.define G_STAR_LIST 30, 70, 18, 52, 26, 88, 140, 120, 160, 110, 150, 200, 190, 230, 252, 262, 276, 300
G_STARS = 18
g_star_x:  .byte  22, 61, 97,140,188,231, 14, 80,121,170,212, 44,155,201,108, 33,247,176
g_star_y:  .lobytes G_STAR_LIST
g_star_yh: .hibytes G_STAR_LIST

; ------------------------------------------------------------------ IRQ (fixed)
.segment "CODE"
ground_irq:
  pha
  lda MMC5_IRQSTAT
  lda ppu_mask
  and #%11110111          ; background off for the last 8 lines (ring seam)
  sta PPUMASK
  lda #0
  sta MMC5_IRQLINE
  lda rk_entry_vec        ; next frame starts with the lake kernel again
  sta irq_vec
  lda rk_entry_vec+1
  sta irq_vec+1
  pla
  rti

; =====================================================================================
;  DESCENT  (song 8960..9855)
;  The same landscape at dusk: the payload comes home under its parachute while the
;  camera tilts back down the sky; night falls and the stars return, and the last frame
;  is the black the title starts from, so the loop is seamless. Streaming now runs the
;  other way (rows enter at the bottom), so the top 8 lines are masked too.
; =====================================================================================
.segment "BANK00"
DS_T0 = 8960
g_hi = pv+8              ; highest image row present in the ring

descent_init:
  jsr ppu_off
  lda #EX_RAM
  sta MMC5_EXMODE
  lda #0
  sta MMC5_NTMAP
  lda #GROUND_SPR
  jsr set_sprite_chr
  ; image rows 0..29 -> ring rows 0..29
  lda #<ground_rows
  sta ptr0
  lda #>ground_rows
  sta ptr0+1
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  lda #<(EXRAM-32)
  sta ptr1
  lda #>(EXRAM-32)
  sta ptr1+1
  ldx #30
@row:
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  cpy #32
  bne :-
: lda (ptr0),y
  sta (ptr1),y
  iny
  cpy #64
  bne :-
  lda ptr0
  clc
  adc #64
  sta ptr0
  bcc :+
  inc ptr0+1
: lda ptr1
  clc
  adc #32
  sta ptr1
  bcc :+
  inc ptr1+1
: dex
  bne @row
  lda #EX_ATTR
  sta MMC5_EXMODE
  lda #0
  sta g_cam
  sta g_cam+1
  sta scroll_x
  sta scroll_y
  lda #29
  sta g_hi
  lda #$FF
  sta g_key_cur
  lda #$FC
  sta fade
  lda #<ground_key3
  sta ptr0
  lda #>ground_key3
  sta ptr0+1
  jsr set_palette
  lda #<ds_irq_top
  sta irq_vec
  lda #>ds_irq_top
  sta irq_vec+1
  lda #8
  sta irq_first
  lda #%00010110          ; sprites only for lines 0-7; the IRQ turns the background on
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

descent_frame:
  sec
  lda tl_frame
  sbc #<DS_T0
  sta t8
  lda tl_frame+1
  sbc #>DS_T0
  sta t9                  ; t9:t8 = frames into the descent (0..895)
  ; ---- palette: dawn -> dusk -> night, black at the very end
  ldx #0
@kf:
  lda t9
  cmp ds_key_t_hi+1,x
  bcc @ksel
  bne @knext
  lda t8
  cmp ds_key_t_lo+1,x
  bcc @ksel
@knext:
  inx
  cpx #DS_NKEYS-1
  bne @kf
@ksel:
  cpx g_key_cur
  beq @kdone
  stx g_key_cur
  lda ds_key_fade,x
  sta fade
  ldy ds_key_pal,x
  lda ground_key_lo,y
  sta ptr0
  lda ground_key_hi,y
  sta ptr0+1
  jsr set_palette
@kdone:
  ; ---- camera: tilt down from 0 to 240 between t=96 and t=608 (ease)
  lda t9
  bne @c1
  lda t8
  cmp #96
  bcs @c1
  lda #0
  beq @cset
@c1:
  sec
  lda t8
  sbc #96
  sta t0
  lda t9
  sbc #0
  sta t1
  ; idx = (t-96)/2 clamped to 255
  lsr t1
  ror t0
  lda t1
  beq :+
  lda #255
  sta t0
: ldx t0
  lda ease_tab,x
  ; cam = ease * 240 / 256
  ldx #240
  jsr mul8
@cset:
  sta g_cam
  ; ---- stream rows entering at the bottom
  clc
  adc #232
  lda #0
  rol a
  sta t2                  ; carry of cam+232 into bit 8
  lda g_cam
  clc
  adc #232
  ror t2
  ror a
  lsr a
  lsr a                   ; (cam+232)>>3
  clc
  adc #1                  ; the row that will appear next
  cmp #60
  bcs @nos
  cmp g_hi
  beq @nos
  bcc @nos
  inc g_hi
  lda g_hi
  sta g_loaded
  jsr g_load_row
@nos:
  lda g_cam
  cmp #240
  bcc :+
  lda #0
: sta scroll_y
  ; ---- the payload: screen y = 46 + t/7, landing near the shore at the end
  jsr oam_clear
  lda t8
  sta MMC5_MULA
  lda #37                 ; t*37/256 ~ t/7
  sta MMC5_MULB
  lda MMC5_MULB
  sta t0
  lda t9
  sta MMC5_MULA
  lda MMC5_MULA
  clc
  adc t0
  adc #46
  sta t1
  lda #0
  sta t3
  ; sway
  lda t8
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
  ror a
  clc
  adc #120
  sta t0
  lda #0
  sta t4
  lda #<meta_gchute
  sta ptr0
  lda #>meta_gchute
  sta ptr0+1
  jsr draw_meta
  ; ---- stars come back with the night
  lda t9
  cmp #>500
  bcc @nostars
  bne :+
  lda t8
  cmp #<500
  bcc @nostars
: jsr g_draw_stars_any
@nostars:
  rts

.define DS_KEY_T 0, 20, 40, 60, 300, 520, 700, 820, 836, 852, 868
DS_NKEYS = 11
ds_key_t_lo: .lobytes DS_KEY_T
ds_key_t_hi: .hibytes DS_KEY_T
ds_key_pal:  .byte 3, 3, 3, 3, 2, 1, 0, 0, 0, 0, 0
ds_key_fade: .byte $FD, $FE, $FF, 0, 0, 0, 0, $FF, $FE, $FD, $FC

; ------------------------------------------------------------------ IRQs (fixed)
.segment "CODE"
ds_irq_top:
  pha
  lda MMC5_IRQSTAT
  lda ppu_mask
  ora #%00001000          ; background on from line 8
  sta PPUMASK
  lda #232
  sta MMC5_IRQLINE
  lda #<ds_irq_bot
  sta irq_vec
  lda #>ds_irq_bot
  sta irq_vec+1
  pla
  rti
ds_irq_bot:
  pha
  lda MMC5_IRQSTAT
  lda ppu_mask
  and #%11110111
  sta PPUMASK
  lda #0
  sta MMC5_IRQLINE
  lda #<ds_irq_top
  sta irq_vec
  lda #>ds_irq_top
  sta irq_vec+1
  pla
  rti
