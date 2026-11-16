; Music test harness: plays one song forever. Rendering stays off; NMI calls music_play.
; Writes to $4018 / $4019 bracket each music_play call so tools/measure.mjs can count its cycles.
; The song number is the first byte of CODE ($E000, file offset $6010) so scripts can patch it.
.import music_init, music_play
.importzp music_frame, music_events

.segment "HEADER"
  .byte "NES", $1A, 2, 1, $50, $00, 0,0,0,0,0,0,0,0   ; mapper 5, 32 KB PRG, 8 KB CHR

.segment "CODE"
song_sel: .byte 0
reset:
  sei
  cld
  ldx #$FF
  txs
  lda #0
  sta $5100            ; 32 KB PRG mode
  lda #$FF
  sta $5117
  lda #0
  sta $2000
  sta $2001
: bit $2002
  bpl :-
: bit $2002
  bpl :-
  lda song_sel
  jsr music_init
  lda #$80
  sta $2000
idle:
  jmp idle

nmi:
  pha
  txa
  pha
  tya
  pha
  sta $4018
  jsr music_play
  sta $4019
  pla
  tay
  pla
  tax
  pla
irq:
  rti

.segment "VECTORS"
  .word nmi, reset, irq
