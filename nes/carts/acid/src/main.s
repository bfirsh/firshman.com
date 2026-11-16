; =====================================================================================
;  ACID  -  an NES demo cartridge (MMC5 + 8 KB CHR-RAM)
;  Core: reset, NMI/IRQ dispatch, song-locked timeline, loaders, math helpers.
;  Engines (each owns the NMI/IRQ handlers while its parts run):
;    vec.s     real-time 3D vectors rendered into CHR-RAM (30 fps, plane-flip double buffer)
;    tunnel.s  palette-cycled square tunnel with two CHR phase sets
;    grid.s    per-scanline raster grid floor
; =====================================================================================
.include "defs.inc"

.import music_init, music_play, music_stop
.importzp music_frame, music_order, music_row, music_events
.importzp music_p1v, music_p1d, music_p2v
.import ch_note

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte 16                ; 16 x 16 KB PRG = 256 KB
  .byte 0                 ; no CHR-ROM: 8 KB CHR-RAM
  .byte $50               ; mapper 5, horizontal arrangement
  .byte $00
  .byte 8                 ; 64 KB PRG-RAM
  .byte 0,0,0,0,0,0,0

; ------------------------------------------------------------------ zero page
.segment "ZEROPAGE"
t0: .res 1
t1: .res 1
t2: .res 1
t3: .res 1
t4: .res 1
t5: .res 1
t6: .res 1
t7: .res 1
t8: .res 1
t9: .res 1
t10: .res 1
t11: .res 1
ptr0: .res 2
ptr1: .res 2
ptr2: .res 2
nmi_count: .res 1
nmi_mode: .res 1        ; 0 = loading (NMI leaves the PPU alone), 1 = the engine's vblank handler runs
nmi_vec: .res 2         ; engine vblank handler (must end with jmp nmi_common)
irq_vec: .res 2
tail_vec: .res 2        ; engine work after the music, every frame (60 fps), interrupts enabled
react_vec: .res 2       ; the part's reaction to this frame's music (before the engine tail)
ppu_ctrl: .res 1
ppu_mask: .res 1
scroll_x: .res 1
scroll_y: .res 1
tl_frame: .res 2        ; song position 0..9855 of the tick just played
part: .res 1
part_t: .res 2          ; frames since the part started (song time)
cur_bank: .res 1        ; shadows of $5114, $5115, $5113
a_bank: .res 1
ram_bank: .res 1
ev_acc: .res 1          ; music events OR-ed since the main thread last cleared them
ev_tail: .res 1         ; music events of this frame (for the tail hook)
rng: .res 2
m_a: .res 1             ; math scratch (main thread only)
m_b: .res 1
m_sgn: .res 1
m_lo: .res 1
m_hi: .res 1
i0: .res 1              ; scratch for interrupt-side code (NMI tail): never touch t0-t11 there
i1: .res 1
i2: .res 1
i3: .res 1
i4: .res 1
i5: .res 1
q_a: .res 1             ; table-multiply scratch (interrupt side)
q_lo: .res 1
q_hi: .res 1
qptr0: .res 2
qptr1: .res 2
flash: .res 1           ; palette flash 0..4 (brighter, decays by itself)
dark: .res 1            ; palette fade 0..4 (darker; 4 = black), set by the parts
flash_t: .res 1
oam_page: .res 1        ; high byte of the OAM page the NMI/IRQ DMAs
pv: .res 40             ; scratch owned by the current part

; ------------------------------------------------------------------ RAM
.segment "OAM"
oam: .res 256           ; two OAM pages: engines that build sprites in the main thread flip
oam2: .res 256          ; oam_page between them

.segment "BSS"
pal_buf: .res 32        ; palette uploaded by the engines
bss: .res 256           ; part buffers

; ------------------------------------------------------------------ vectors
.segment "VECTORS"
  .word nmi, reset, irq

; =====================================================================================
.segment "CODE"

reset:
  sei
  cld
  ldx #$FF
  txs
  inx
  stx PPUCTRL
  stx PPUMASK
  stx $4010
  lda #$40
  sta $4017
  lda #3
  sta MMC5_PRGMODE        ; 4 x 8 KB
  sta MMC5_CHRMODE
  lda #2
  sta MMC5_RAMPROT1
  lda #1
  sta MMC5_RAMPROT2
  lda #0
  sta MMC5_PRG6
  sta ram_bank
  sta MMC5_SPLIT
  sta MMC5_IRQSTAT
  sta MMC5_NTMAP          ; all nametables -> CIRAM A
  lda #$80 | 30
  sta MMC5_PRGC
  lda #$80 | 0
  sta MMC5_PRG8
  sta cur_bank
  lda #$80 | 16
  sta MMC5_PRGA
  sta a_bank
  lda #2
  sta MMC5_EXMODE         ; ExRAM as plain RAM
  bit PPUSTATUS
: bit PPUSTATUS
  bpl :-
  ; clear CPU RAM (except the stack page)
  lda #0
  tax
: sta $00,x
  sta $0300,x
  sta $0400,x
  sta $0500,x
  sta $0600,x
  sta $0700,x
  sta $0200,x
  inx
  bne :-
  lda #$F8
: sta oam,x
  inx
  bne :-
  lda #0
  sta MMC5_PRG6
  sta ram_bank
: bit PPUSTATUS
  bpl :-
  jsr clear_vram
  lda #$FF
  sta part
  sta tl_frame
  sta tl_frame+1
  lda #$A5
  sta rng
  sta rng+1
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #<rts_hook
  sta tail_vec
  sta react_vec
  lda #>rts_hook
  sta tail_vec+1
  sta react_vec+1
  lda #<nmi_common
  sta nmi_vec
  lda #>nmi_common
  sta nmi_vec+1
  lda #$80 | 29
  sta MMC5_PRGA
  lda #0
  jsr music_init
  lda a_bank
  sta MMC5_PRGA
  lda #%10001000
  sta ppu_ctrl
  sta PPUCTRL
  cli

main_loop:
  jsr timeline
  jsr part_frame_call
  jmp main_loop

part_frame_call:
  ldx part
  lda part_frame_hi,x
  pha
  lda part_frame_lo,x
  pha
rts_hook:
  rts

; Wait for the next NMI.
wait_frame:
  lda nmi_count
: cmp nmi_count
  beq :-
  rts

; Pick the part for tl_frame; call its init on a change. Computes part_t.
timeline:
  ldx #NUM_PARTS-1
@find:
  lda tl_frame+1
  cmp part_start_hi,x
  bcc @next
  bne @found
  lda tl_frame
  cmp part_start_lo,x
  bcs @found
@next:
  dex
  bpl @find
  ldx #0
@found:
  sec
  lda tl_frame
  sbc part_start_lo,x
  sta part_t
  lda tl_frame+1
  sbc part_start_hi,x
  sta part_t+1
  cpx part
  beq @same
  stx part
  lda #<rts_hook          ; the old part's reaction lives in the bank about to go
  sta react_vec
  lda #>rts_hook
  sta react_vec+1
  lda part_bank,x
  sta cur_bank
  sta MMC5_PRG8
  lda part_init_hi,x
  pha
  lda part_init_lo,x
  pha
@same:
  rts

; ------------------------------------------------------------------ NMI
nmi:
  pha
  txa
  pha
  tya
  pha
  lda nmi_mode
  beq nmi_common
  jmp (nmi_vec)
nmi_common:
  cli                     ; raster IRQs may interrupt the music and the tail
  lda a_bank              ; the song data lives in bank 29: map it at $A000 meanwhile
  pha
  lda #$80 | 29
  sta a_bank
  sta MMC5_PRGA
  jsr music_play
  pla
  sta a_bank
  sta MMC5_PRGA
  inc tl_frame
  bne :+
  inc tl_frame+1
: lda music_events
  sta ev_tail
  ora ev_acc
  sta ev_acc
  lda music_events
  and #$02
  beq @nopat
  ldx music_order          ; re-sync to the pattern grid
  lda order_frame_lo,x
  sta tl_frame
  lda order_frame_hi,x
  sta tl_frame+1
@nopat:
  lda tl_frame+1
  cmp #>SONG_LEN
  bcc @inrange
  bne @wrap
  lda tl_frame
  cmp #<SONG_LEN
  bcc @inrange
@wrap:
  lda #0
  sta tl_frame
  sta tl_frame+1
@inrange:
  inc nmi_count
  lda nmi_mode
  beq :+
  jsr call_react
  jsr call_tail
: pla
  tay
  pla
  tax
  pla
  rti

call_tail:
  jmp (tail_vec)
call_react:
  jmp (react_vec)

; ------------------------------------------------------------------ IRQ
irq:
  jmp (irq_vec)
irq_ack:
  pha
  lda MMC5_IRQSTAT
  pla
  rti

; ------------------------------------------------------------------ loaders
; Rendering off at the next vblank; the NMI stops touching the PPU. Interrupt handlers are
; reset to the plain ones.
ppu_off:
  lda #$0F
; ... with the screen showing colour A while the next part loads
ppu_off_col:
  pha
  jsr wait_frame
  lda #0
  sta nmi_mode
  sta PPUMASK
  sta ppu_mask
  bit PPUSTATUS
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  pla
  sta PPUDATA
  lda #$00
  sta PPUADDR
  sta PPUADDR
  sta MMC5_IRQSTAT
  lda #<irq_ack
  sta irq_vec
  lda #>irq_ack
  sta irq_vec+1
  lda #<rts_hook
  sta tail_vec
  sta react_vec
  lda #>rts_hook
  sta tail_vec+1
  sta react_vec+1
  rts

; Hand the NMI to the engine (vectors must be set): rendering comes on at the next vblank.
ppu_on:
  lda #1
  sta nmi_mode
  rts

; Clear $2000-$2FFF (rendering off).
clear_vram:
  lda #$20
  ldx #16
  ; fall through
; Fill X pages of VRAM from address A<<8 with 0.
fill_vram0:
  sta PPUADDR
  lda #0
  sta PPUADDR
  ldy #0
: sta PPUDATA
  iny
  bne :-
  dex
  bne :-
  rts

; Copy X pages from (ptr0) to VRAM at A<<8 (rendering off).
copy_vram:
  sta PPUADDR
  lda #0
  sta PPUADDR
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  rts

; Copy the 32-byte palette at (ptr0) into pal_buf.
set_palette:
  ldy #31
: lda (ptr0),y
  sta pal_buf,y
  dey
  bpl :-
  rts

; Post-process pal_buf with flash (brighter by 16 per step, black -> grey -> white) and dark
; (darker by 16 per step). Interrupt side (tails).
pal_fx:
  lda flash
  sec
  sbc dark
  bne :+
  rts
: bmi @dark
  asl a
  asl a
  asl a
  asl a
  sta i0
  ldx #31
@b:
  lda pal_buf,x
  cmp #$0F
  bne @col
  lda i0                  ; black stays black for small flashes (level 1-2),
  cmp #$30                ; level 3 is dark grey, 4+ white ($10 is a beige grey: skipped)
  bcc @next
  bne :+
  lda #$00
  sta pal_buf,x
  jmp @next
: lda #$20
  sta pal_buf,x
  jmp @next
@col:
  clc
  adc i0
  cmp #$40
  bcc :+
  cmp #$F0
  bcs @blk
  lda #$30
  bne :+
@blk:
  lda #$0F
: and #$3F
  sta pal_buf,x
@next:
  dex
  bpl @b
  rts
@dark:
  eor #$FF
  clc
  adc #1
  asl a
  asl a
  asl a
  asl a
  sta i0
  ldx #31
@d:
  lda pal_buf,x
  sec
  sbc i0
  bcs :+
  lda #$0F
: sta pal_buf,x
  dex
  bpl @d
  rts

; The tails call this after building pal_buf: flash decay and pal_fx.
pal_finish:
  jsr pal_fx
  lda flash
  beq :+
  inc flash_t
  lda flash_t
  and #1
  bne :+
  dec flash
: rts

; Write all 32 palette entries from pal_buf (vblank or forced blank).
upload_palette:
  bit PPUSTATUS
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  .repeat 32, i
  lda pal_buf+i
  sta PPUDATA
  .endrepeat
  rts

; Hide all sprites.
oam_clear:
  lda #$F8
  ldx #0
: sta oam,x
  sta oam2,x
  inx
  bne :-
  rts

; Upload the sprite tiles to $1000 (rendering off).
load_sprite_chr:
  lda #$10
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #0
: lda spr_chr,x
  sta PPUDATA
  inx
  cpx #spr_chr_end - spr_chr
  bne :-
  rts

; ------------------------------------------------------------------ math
; 16-bit LFSR -> A
rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

; Signed A * signed Y -> m_hi:m_lo (16-bit signed). MMC5 multiplier; main thread only.
smul:
  sta m_a
  sty m_b
  eor m_b
  sta m_sgn
  tya
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULB
  lda m_a
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULA
  lda MMC5_MULA
  ldy MMC5_MULB
  bit m_sgn
  bmi :+
  sta m_lo
  sty m_hi
  rts
: eor #$FF
  clc
  adc #1
  sta m_lo
  tya
  eor #$FF
  adc #0
  sta m_hi
  rts

; Signed A * signed Y, result >> 7 as a signed byte in A (s.7 fixed point). Main thread only.
smul7:
  jsr smul
  lda m_lo
  asl a
  lda m_hi
  rol a
  rts

; signed A * unsigned zoom Y (0..128) >> 7
smul7z:
  sty MMC5_MULB
  tax
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULA
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a
  cpx #$80
  bcc :+
  eor #$FF
  adc #0                  ; C=1 here: two's complement
: rts

; Unsigned A * X by quarter squares (interrupt-safe: no MMC5 multiplier) -> q_hi:q_lo
qmul:
  sta q_a
  stx q_lo
  ; f(a+b) - f(|a-b|)
  clc
  adc q_lo
  tay
  lda #0
  rol a                   ; carry from a+b -> high page
  bne @hi
  lda q_a
  sec
  sbc q_lo
  bcs :+
  eor #$FF
  adc #1
: tax
  lda sq_lo,y
  sec
  sbc sq_lo,x
  sta q_lo
  lda sq_hi,y
  sbc sq_hi,x
  sta q_hi
  rts
@hi:
  lda q_a
  sec
  sbc q_lo
  bcs :+
  eor #$FF
  adc #1
: tax
  lda sq_lo+256,y
  sec
  sbc sq_lo,x
  sta q_lo
  lda sq_hi+256,y
  sbc sq_hi,x
  sta q_hi
  rts

.segment "RODATA"
.include "tables.inc"
.include "sprites.inc"
order_frame_lo:
  .repeat 24, i
  .byte <(i * PATTERN)
  .endrepeat
order_frame_hi:
  .repeat 24, i
  .byte >(i * PATTERN)
  .endrepeat

.segment "CODE"
.include "parts.inc"
