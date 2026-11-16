; Fallback copy of the original music stub, used by build.sh only if nes/music/music.s fails to assemble.
; STUB music module. The music builder replaces the implementation; the API below is the contract
; (see nes/README.md). Everything here must stay link-compatible with the demo.
.export music_init, music_play, music_stop
.exportzp music_frame, music_order, music_row, music_events

.segment "MUSIC_ZP": zeropage
music_frame:  .res 2   ; frames since music_init (16-bit, wraps)
music_order:  .res 1   ; index into the song's order list (which pattern/section)
music_row:    .res 1   ; row within the current pattern
music_events: .res 1   ; flags for THIS frame only (rewritten by every music_play):
                       ; bit0 new row, bit1 new pattern, bit2 kick, bit3 snare, bit4 hat, bit5 lead note-on, bit6 bass note-on, bit7 song looped

.segment "MUSIC"
music_init:            ; A = song number. Call with NMI disabled or before enabling music_play.
  lda #0
  sta music_frame
  sta music_frame+1
  sta music_order
  sta music_row
  sta music_events
  rts
music_play:            ; call exactly once per frame, from NMI, after time-critical PPU work
  inc music_frame
  bne :+
  inc music_frame+1
: lda #0
  sta music_events
  rts
music_stop:
  rts
