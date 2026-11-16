; =====================================================================================
;  Scenes: the order -> scene map, the scene table, and helpers every scene uses.
;  A scene = init (called on the cut, data already preloaded) + frame (every frame).
;  Scene code and data live in their own 8 KB bank at $8000; nametable/ExRAM images are
;  streamed from the same bank through the $A000 window (addresses + $2000).
; =====================================================================================

.segment "CODEC"
.include "assets.inc"

SC_DISC    = 0
SC_HALF    = 1
SC_STRIPES = 2
SC_POSTER  = 3
SC_SHOUT   = 4
SC_MOIRE   = 5
SC_BUILD   = 6
SC_SPIRAL  = 7
SC_LIFT    = 8

.segment "RODATA"
scene_of_order:
  ;     intro     groove    verse1   verse2   pre         chorusA    chorusB    horns
  .byte SC_DISC,  SC_DISC,  SC_HALF, SC_HALF, SC_STRIPES, SC_POSTER, SC_POSTER, SC_SHOUT
  ;     walk1     walk2     build     verse3     liftA    liftB    shout     outro
  .byte SC_MOIRE, SC_MOIRE, SC_BUILD, SC_SPIRAL, SC_LIFT, SC_LIFT, SC_SHOUT, SC_DISC

NOEX = $E000                ; (no ExRAM image)
.macro SCENES
  ;     bank nt          ex          init          frame
  SCENE 0,   disc_nt,    disc_ex,    disc_init,    disc_frame
  SCENE 1,   half_nt,    NOEX,          half_init,    half_frame
  SCENE 2,   stripes_nt, NOEX,         stripes_init, stripes_frame
  SCENE 3,   poster_nt,  poster_ex,  poster_init,  poster_frame
  SCENE 4,   shout_nt,   NOEX,         shout_init,   shout_frame
  SCENE 5,   moire_nt,   NOEX,         moire_init,   moire_frame
  SCENE 2,   build_nt,   NOEX,         build_init,   build_frame
  SCENE 7,   spiral_nt,  NOEX,         spiral_init,  spiral_frame
  SCENE 8,   lift_nt,    lift_ex,    lift_init,    lift_frame
.endmacro

.macro SCENE b, nt, ex, init, frame
  .byte b
.endmacro
scene_bank: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte <(nt + $2000)
.endmacro
scene_nt_lo: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte >(nt + $2000)
.endmacro
scene_nt_hi: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte <(ex + $2000)
.endmacro
scene_ex_lo: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte >(ex + $2000) * (ex <> NOEX)
.endmacro
scene_ex_hi: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte <(init - 1)
.endmacro
scene_init_lo: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte >(init - 1)
.endmacro
scene_init_hi: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte <(frame - 1)
.endmacro
scene_frame_lo: SCENES
.delmacro SCENE
.macro SCENE b, nt, ex, init, frame
  .byte >(frame - 1)
.endmacro
scene_frame_hi: SCENES
.delmacro SCENE

.segment "BSS"
osp_lo: .res 8          ; damped springs: position and velocity, 8.8 signed
osp_hi: .res 8
osv_lo: .res 8
osv_hi: .res 8
osk:    .res 8          ; stiffness: v -= p >> osk
osd:    .res 8          ; damping:   v -= v >> osd

.segment "CODEC"

; Kernel defaults: lines 28..211 (+ the blank tail from 212), identity mapping, no wobble, no bands.
k_defaults:
  lda #1
  sta k_on
  lda #28
  sta k_start
  lda #212
  sta k_end
  lda #0
  sta k_step
  sta k_y0
  sta scroll_x
  sta scroll_y
  lda #1
  sta k_step+1
  lda #27
  sta k_y0+1
  lda #<WAVES
  sta k_xtab
  lda #>WAVES
  sta k_xtab+1
  lda #<NTA
  sta k_xtb
  lda #>NTA
  sta k_xtb+1
  ldx #3
: txa
  ora #4
  sta st_spr,x              ; sprites: CHR banks 4-7
  dex
  bpl :-
  ldx #7
: lda #0
  sta osp_lo,x
  sta osp_hi,x
  sta osv_lo,x
  sta osv_hi,x
  lda #3
  sta osk,x
  sta osd,x
  dex
  bpl :-
  lda #1
  sta st_spr_dirty
  lda #%00011110
  sta ppu_mask
  jsr oam_clear
  rts

; Set the ExRAM mode for the next vblank.
set_exmode:
  sta st_exmode
  lda #1
  sta st_exmode_dirty
  rts

; Load a palette: A/X = lo/hi of 32 bytes.
load_pal:
  sta ptr0
  stx ptr0+1
  jmp set_palette

; Damped spring X: p += v; v -= p >> osk; v -= v >> osd (all 8.8 signed).
osc_step:
  clc
  lda osp_lo,x
  adc osv_lo,x
  sta osp_lo,x
  sta t0
  lda osp_hi,x
  adc osv_hi,x
  sta osp_hi,x
  ldy osk,x
: cmp #$80
  ror a
  ror t0
  dey
  bne :-
  sta t1
  sec
  lda osv_lo,x
  sbc t0
  sta osv_lo,x
  sta t0
  lda osv_hi,x
  sbc t1
  sta osv_hi,x
  ldy osd,x
: cmp #$80
  ror a
  ror t0
  dey
  bne :-
  sta t1
  sec
  lda osv_lo,x
  sbc t0
  sta osv_lo,x
  lda osv_hi,x
  sbc t1
  sta osv_hi,x
  rts

; Kick spring X: velocity += A (signed, in 1/16 px per frame units -> 8.8 via << 4).
osc_kick:
  sta t0
  lda #0
  ldy t0
  bpl :+
  lda #$FF
: sta t1
  asl t0
  rol t1
  asl t0
  rol t1
  asl t0
  rol t1
  asl t0
  rol t1
  clc
  lda osv_lo,x
  adc t0
  sta osv_lo,x
  lda osv_hi,x
  adc t1
  sta osv_hi,x
  rts

; k_y0 for a vertical scale about a pivot: the source line PIV_SRC appears at screen line
; PIV_LINE. In: A = pivot screen line, X = pivot source line, k_step set.
; y0 = src*256 - (line - k_start + 1) * step
k_pivot:
  sec
  sbc k_start
  clc
  adc #1
  sta t2                    ; n = line - k_start + 1
  stx t3
  lda t2
  ldx k_step
  jsr mul8                  ; n * step_lo -> A:Y
  sty t4
  sta t5
  lda t2
  ldx k_step+1
  jsr mul8                  ; n * step_hi -> (A:Y) << 8, only Y matters (A = 0 for n*step_hi < 256)
  tya
  clc
  adc t5
  sta t5                    ; t5:t4 = n * step (8.8)
  sec
  lda #0
  sbc t4
  sta k_y0
  lda t3
  sbc t5
  sta k_y0+1
  rts

; Vertical squash from spring X about a pivot: A = pivot screen line, Y = pivot source line.
; step = 1 - p/8 (p in 8.8 px: 1 px of spring = 3% squash).
k_squash:
  sta t6
  sty t7
  lda osp_hi,x
  sta t0
  lda osp_lo,x
  .repeat 3
  pha
  lda t0
  cmp #$80
  ror t0
  pla
  ror a
  .endrepeat
  sta t1
  sec
  lda #0
  sbc t1
  sta k_step
  lda #1
  sbc t0
  sta k_step+1
  lda t6
  ldx t7
  jmp k_pivot

; X wobble: A = amplitude index (0-7), Y = phase -> k_xtab
k_wobble:
  asl a
  clc
  adc #>WAVES
  sta k_xtab+1
  sty k_xtab
  rts

.include "common.s"
.include "disc.s"
.include "half.s"
.include "stripes.s"
.include "poster.s"
.include "others.s"
