; Parts: the timeline table (song frame -> part) and the modules.

.include "vec.s"
.include "p_poly.s"
.include "tunnel.s"
.include "p_drop.s"
.include "tunnel.inc"
.include "grid.s"
.include "p_grid.s"
.include "grid.inc"
.include "mouth.inc"
.segment "CODEC"
.include "upload.s"

.macro PARTS_TABLE
  ;    start frame, bank, init, frame          song (see music/SYNC.md)
  PART     0, 2, grid_intro_init, grid_frame   ; 0-1 intro: the grid fades in
  PART   896, 0, poly_init, poly_frame         ; 2-5 groove: polyhedra
  PART  2688, 1, build_init, build_frame       ; 6-7 build: the tunnel accelerates, break
  PART  3584, 1, drop_init, drop_frame         ; 8-11 DROP: tunnel + ball object
  PART  5376, 2, grid_bd_init, grid_frame      ; 12-13 breakdown: magenta grid
  PART  6272, 0, rebuild_init, poly_frame      ; 14-15 rebuild: the star, growing; break
  PART  7168, 1, climax_init, drop_frame       ; 16-17 CLIMAX: tunnel + balls
  PART  8064, 0, poly2_init, poly_frame        ; 18-19 climax: strobing solids
  PART  8960, 2, grid_outro_init, grid_frame   ; 20-21 outro: the grid stops, fade out
.endmacro

.segment "RODATA"
.macro PART start, bank, init, frame
  .byte <(start)
.endmacro
part_start_lo: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte >(start)
.endmacro
part_start_hi: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte $80 | (bank)
.endmacro
part_bank: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte <(init - 1)
.endmacro
part_init_lo: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte >(init - 1)
.endmacro
part_init_hi: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte <(frame - 1)
.endmacro
part_frame_lo: PARTS_TABLE
.delmacro PART
.macro PART start, bank, init, frame
  .byte >(frame - 1)
.endmacro
part_frame_hi: PARTS_TABLE
.delmacro PART
NUM_PARTS = part_start_hi - part_start_lo
.segment "CODE"
