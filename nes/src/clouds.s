; =====================================================================================
;  CLIMB + BUILD  (song 1792..3583)
;  Above the cloud sea. The sea is one extended-attribute picture whose every row tiles at
;  256 px; the raster kernel gives each of its 134 scanlines its own horizontal scroll,
;  proportional to that line's nearness, so the whole floor of cloud slides past in true
;  perspective. Per-line offsets come from the MMC5 hardware multiplier (two passes, the
;  multiplicand stays latched). The wind picks up through the Build, then everything
;  whites out into the cloud for the break before the drop.
; =====================================================================================

.segment "BANK02"
.include "clouds.inc"          ; cl_spd first: page-aligned at $8000
clouds_nt: .incbin "clouds_nt.bin"
clouds_ex: .incbin "clouds_ex.bin"

CL_T0 = 1792
CL_S = CLOUD_HZ_I + 2
CL_N = 240 - CL_S
CLOUD_HZ_I = 104

cl_p     = pv+0          ; 24-bit drift phase: frac, lo, hi
cl_vel   = pv+3          ; 16-bit 8.8 velocity
cl_t     = pv+5          ; 16-bit part time
cl_pal   = pv+7
cl_d     = pv+8          ; per-line X step (8.8), for the kernel's next-frame computation
cl_acc   = pv+10         ; kernel accumulator
cl_acc0  = pv+12         ; its starting value
cl_pulse = pv+14

clouds_init:
  jsr ppu_off
  lda #<clouds_nt
  sta ptr0
  lda #>clouds_nt
  sta ptr0+1
  lda #<clouds_ex
  sta ptr2
  lda #>clouds_ex
  sta ptr2+1
  jsr load_bitmap
  lda #GROUND_SPR
  jsr set_sprite_chr
  lda #0
  sta scroll_x
  sta scroll_y
  sta cl_p
  sta cl_p+1
  sta cl_p+2
  sta cl_pal
  sta cl_pulse
  lda #3
  sta fade
  lda #<clouds_palette
  sta ptr0
  lda #>clouds_palette
  sta ptr0+1
  jsr set_palette
  lda #CL_S
  sta rk_start
  lda #CL_N
  sta rk_count
  lda #0
  sta rk_after
  jsr rk_identity
  lda #<cl_irq
  ldy #>cl_irq
  jsr set_kernel
  lda #CL_S-2
  sta irq_first
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  jmp ppu_on

clouds_frame:
  sec
  lda tl_frame
  sbc #<CL_T0
  sta cl_t
  lda tl_frame+1
  sbc #>CL_T0
  sta cl_t+1
  ; ---- fades: flash in on the kick, white-out for the break (t >= 1680)
  lda cl_t+1
  bne @late
  lda cl_t
  cmp #16
  bcs @nofade
  lsr a
  lsr a
  eor #$FF
  sec
  adc #3                  ; 3 - t/4
  jmp @setfade
@late:
  ; t >= 256
  lda cl_t+1
  cmp #>1680
  bcc @nofade
  bne :+
  lda cl_t
  cmp #<1680
  bcc @nofade
: lda cl_t
  sec
  sbc #<1680
  lsr a
  lsr a
  lsr a
  lsr a
  cmp #4
  bcc @setfade
  lda #4
@setfade:
  cmp fade
  beq @nofade
  sta fade
  jsr apply_fade
@nofade:
  ; ---- deeper sky from the Build on
  lda cl_pal
  bne @palok
  lda cl_t+1
  cmp #>896
  bcc @palok
  lda cl_t
  cmp #<896
  bcc @palok
  inc cl_pal
  lda #<clouds_palette2
  sta ptr0
  lda #>clouds_palette2
  sta ptr0+1
  jsr set_palette
@palok:
  ; ---- the horizon haze pulses on the kick (and snare in the Build)
  lda ev_acc
  ldx #0
  stx ev_acc
  and #$0C
  beq @nopulse
  lda fade
  bne @nopulse            ; not during fades
  lda #$31
  sta pal_buf+5
  lda #$30
  sta pal_buf+6
  lda #4
  sta cl_pulse
  inc pal_dirty
@nopulse:
  lda cl_pulse
  beq @wind
  dec cl_pulse
  bne @wind
  lda pal_src+5
  sta pal_buf+5
  lda pal_src+6
  sta pal_buf+6
  inc pal_dirty
@wind:
  ; ---- wind: vel = 1.0 px/frame (nearest line), ramping up through the Build
  lda #1
  sta cl_vel+1
  lda #0
  sta cl_vel
  sec
  lda cl_t
  sbc #<896
  tax
  lda cl_t+1
  sbc #>896
  bcc @velok
  ; extra = (t-896) (up to 784) -> vel += extra
  sta t0
  txa
  clc
  adc cl_vel
  sta cl_vel
  lda t0
  adc cl_vel+1
  sta cl_vel+1
@velok:
  clc
  lda cl_p
  adc cl_vel
  sta cl_p
  lda cl_p+1
  adc cl_vel+1
  sta cl_p+1
  bcc :+
  inc cl_p+2
:
  ; ---- per-line step D = P / 128 (8.8): line s scrolls by D * (s - horizon). The kernel
  ;      accumulates it line by line for the next frame (see cl_irq).
  lda cl_p+1
  sta cl_d
  lda cl_p+2
  sta cl_d+1
  ; D * 2 for the first kernel line (CL_S - horizon = 2)
  lda cl_d
  asl a
  sta cl_acc0
  lda cl_d+1
  rol a
  sta cl_acc0+1
  ; ---- sprites: sun, balloon (bobbing)
  jsr oam_clear
  lda #<meta_sun43
  sta ptr0
  lda #>meta_sun43
  sta ptr0+1
  lda #200
  sta t0
  lda #34
  sta t1
  lda #0
  sta t3
  sta t4
  jsr draw_meta
  lda #<meta_balloon
  sta ptr0
  lda #>meta_balloon
  sta ptr0+1
  lda #128
  sta t0
  lda cl_t
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
  cmp #$80
  ror a                   ; +-4
  sta t1
  ; the balloon climbs away from the camera: y = 100 - t/32, down to 60
  lda cl_t+1
  sta t2
  lda cl_t
  ldx #5
: lsr t2
  ror a
  dex
  bne :-
  cmp #40
  bcc :+
  lda #40
: sta t2
  lda #100
  sec
  sbc t2
  clc
  adc t1
  sta t1
  lda #0
  sta t3
  sta t4
  jmp draw_meta

; ------------------------------------------------------------------ IRQ (fixed)
; The raster kernel, with the idle part of every line spent computing that line's X scroll
; for the next frame into the other buffer: a running sum of D, one 16-bit add per line,
; because a flat plane's screen-space speed grows linearly below the horizon.
.segment "CODE"
.macro CL_LINE front, back
  lda MMC5_IRQSTAT
  stx MMC5_IRQLINE
  lda front+RK_HI,x
  sta PPUADDR
  lda front+RK_Y,x
  sta PPUSCROLL
  clc
  lda cl_acc
  adc cl_d
  sta cl_acc
  lda cl_acc+1
  adc cl_d+1
  sta cl_acc+1
  sta back+RK_X,x
  lsr a
  lsr a
  lsr a
  ora rk_lo_of_y,x
  sta back+RK_LO,x
  ldy front+RK_LO,x
  lda front+RK_X,x
  .repeat CL_DELAY
  nop
  .endrepeat
  sta PPUSCROLL
  sty PPUADDR
  inx
  cpx rk_end
  beq :+
  rti
: jmp cl_finish
.endmacro
CL_DELAY = 2

cl_irq:
  pha
  txa
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  lda rk_start
  clc
  adc rk_count
  sta rk_end
  lda cl_acc0
  sta cl_acc
  lda cl_acc0+1
  sta cl_acc+1
  ldx rk_start
  dex
  stx MMC5_IRQLINE
  inx
  bit PPUSTATUS
  lda rk_buf
  bne :+
  RK_ENTER cl_line0
: RK_ENTER cl_line1

cl_line0:
  CL_LINE RK0, RK1
cl_line1:
  CL_LINE RK1, RK0

cl_finish:
  lda #1
  sta rk_flip              ; the other buffer is complete
  jmp rk_finish
