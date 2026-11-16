; =====================================================================================
;  Timeline. Everything is keyed to the song position (tl_frame, 0..9855), which the NMI
;  re-syncs to music_order at every pattern, so retiming is a matter of editing this table.
;  See nes/music/SYNC.md: 7 frames/row, 448 frames/pattern, drops at 3584 and 7168.
; =====================================================================================

.segment "RODATA"

; Frame at which each order (pattern) starts.
order_frame_lo:
  .repeat 32, i
  .byte <(i * PATTERN)
  .endrepeat
order_frame_hi:
  .repeat 32, i
  .byte >(i * PATTERN)
  .endrepeat

.macro PARTS_TABLE
  ;    start frame, bank, init, frame
  PART     0, 1, title_init, title_frame          ; Ground (intro): the title
  PART   448, 0, ground_init, ground_frame       ; Ground + Lift-off: night to dawn, title, release, tilt up
  PART  1792, 2, clouds_init, clouds_frame       ; Climb + Build: above the cloud sea

  PART  3584, 4, fx_init, fx_frame               ; DROP 1: signal (real-time chunky effects)
  PART  5376, 6, strat_init, strat_frame         ; Breakdown, Rebuild, break, burst: the curve of the Earth
  PART  7616, 8, climax_init, climax_frame       ; CLIMAX: the whole Earth turning (burst at 7168 is in strat.s)
  PART  8960, 0, descent_init, descent_frame    ; Descent: parachute home, credits
.endmacro
