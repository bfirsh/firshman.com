; Parts: each lives in its own switchable bank (code + data) with its interrupt handlers in
; fixed code. The timeline table in timeline.inc says when each one runs.

.include "assets.inc"
.segment "CODEA"
.include "sprites.inc"
.include "title.s"
.include "ground.s"
.include "clouds.s"
.include "fx.s"
.include "strat.s"
.include "climax.s"
.include "stub.s"

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
