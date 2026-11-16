; =====================================================================================
;  CARTRIDGE  -  an NES demo (MMC5)
;  Engine core: reset, NMI, IRQ dispatch, timeline, palette fades, VRAM queue, loaders.
; =====================================================================================
.include "defs.inc"

.import music_init, music_play, music_stop
.importzp music_frame, music_order, music_row, music_events

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte 8                 ; 8 x 16 KB PRG
  .byte 32                ; 32 x 8 KB CHR (256 KB)
  .byte $50               ; mapper 5 (low nibble), no battery, horizontal arrangement
  .byte $00
  .byte 1                 ; 8 KB PRG-RAM
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
ptr3: .res 2
nmi_count: .res 1
nmi_ready: .res 1       ; main sets 1 when OAM/palette/queue are ready for upload
nmi_mode: .res 1        ; 1 = NMI must not touch the PPU (bulk loading with rendering off)
ppu_ctrl: .res 1
ppu_mask: .res 1
scroll_x: .res 1
scroll_y: .res 1
tl_frame: .res 2        ; position in the song, 0..9855 (tick just played)
part: .res 1            ; current part number ($FF = none yet)
part_t: .res 2          ; frames since the part's start (song time)
irq_vec: .res 2
nmi_hook: .res 2        ; called from NMI after PPU uploads (fixed code only)
irq_first: .res 1       ; first MMC5 IRQ line for the next frame (0 = no IRQ)
pal_dirty: .res 1
cur_bank: .res 1
irq_t0: .res 1
irq_t1: .res 1
irq_t2: .res 1
irq_t3: .res 1
irq_p: .res 2
rng: .res 2
buttons: .res 1
buttons_new: .res 1
fade: .res 1            ; signed palette fade: -4 (black) .. 0 .. +4 (white)
ev_acc: .res 1          ; music events OR-ed since main last looked
oam_i: .res 1           ; next free OAM byte
oam_full: .res 1        ; non-zero once all 64 entries are used
lag_count: .res 1
main_seen: .res 1
rk_buf: .res 1          ; raster table buffer the kernel shows this frame (0/1)
rk_start: .res 1        ; first screen line the tables drive (>= 3)
rk_count: .res 1        ; number of lines
rk_line: .res 1
rk_end: .res 1
rk_entry_vec: .res 2    ; irq_vec to restore after the kernel (the kernel entry)
rk_after: .res 1
rk_flip: .res 1         ; main sets 1 when the other buffer is complete
rkp_hi: .res 2
rkp_y: .res 2
rkp_x: .res 2
rkp_lo: .res 2
rkp_m: .res 2        ; IRQ line to arm after the kernel (0 = none)
rk_after_vec: .res 2
part_vars: .res 64      ; scratch owned by the current part
pv = part_vars

; ------------------------------------------------------------------ RAM
.segment "OAM"
oam: .res 256

.segment "BSS"
vq: .res 160            ; VRAM queue: [hi, lo, len, data...]*, 0
vq_len: .res 1
pal_src: .res 32        ; palette before fading
pal_buf: .res 32        ; palette as uploaded
bss_part: .res 512      ; part buffers ($0400-ish)

; PRG-RAM layout ($6000-$7FFF), fixed addresses:
;   $6000-$64FF  raster tables, buffer 0 (hi, y, x, lo, mask; 256 each)
;   $6500-$69FF  raster tables, buffer 1
;   $6A00-$7FFF  free for parts
RK0 = $6000
RK1 = $6500
RK_HI = 0
RK_Y = $100
RK_X = $200
RK_LO = $300
RK_M = $400

; ------------------------------------------------------------------ vectors
.segment "VECTORS"
  .word nmi, reset, irq

.segment "CHARS"
  .incbin "chr.bin"


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
  stx $4010               ; no DMC IRQ
  lda #$40
  sta $4017
  ; MMC5 setup
  lda #3
  sta MMC5_PRGMODE        ; 4 x 8 KB
  sta MMC5_CHRMODE        ; 8 x 1 KB
  lda #2
  sta MMC5_RAMPROT1
  lda #1
  sta MMC5_RAMPROT2
  lda #0
  sta MMC5_PRG6
  sta MMC5_CHRHI
  sta MMC5_SPLIT
  sta MMC5_IRQSTAT
  lda #$80 | 13
  sta MMC5_PRGA
  lda #$80 | 14
  sta MMC5_PRGC
  lda #$80 | 0
  sta MMC5_PRG8
  sta cur_bank
  lda #$00
  sta MMC5_NTMAP          ; all four nametables -> CIRAM page A
  lda #EX_RAM
  sta MMC5_EXMODE
  ; wait for the PPU
  bit PPUSTATUS
: bit PPUSTATUS
  bpl :-
  ; clear RAM
  lda #0
  tax
: sta $00,x
  sta $0300,x
  sta $0400,x
  sta $0500,x
  sta $0600,x
  inx
  bne :-
  lda #$F8
: sta $0200,x
  inx
  bne :-
  ; clear ExRAM (RAM mode)
  lda #0
: sta EXRAM,x
  sta EXRAM+$100,x
  sta EXRAM+$200,x
  sta EXRAM+$300,x
  inx
  bne :-
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
  sta nmi_hook
  lda #>rts_hook
  sta nmi_hook+1
  lda #$0F
  ldx #31
: sta pal_src,x
  sta pal_buf,x
  dex
  bpl :-
  lda #1
  sta pal_dirty
  lda #0
  jsr music_init
  lda #%10001000          ; NMI on, sprites at $1000, BG at $0000, 8x8 sprites
  sta ppu_ctrl
  sta PPUCTRL
  cli
  ; fall into the main loop

; ------------------------------------------------------------------ main loop
main_loop:
  ; wait for a new frame; a part that ran past the NMI goes straight on
: lda nmi_count
  cmp main_seen
  beq :-
  sta main_seen
  jsr read_pad
  jsr timeline
  ; run the current part's frame routine
  jsr part_frame_call
  lda #1
  sta nmi_ready
  jmp main_loop

part_frame_call:
  ldx part
  lda part_frame_hi,x
  pha
  lda part_frame_lo,x
  pha
rts_hook:
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
  bne @noppu
  lda nmi_ready
  bne :+
  inc lag_count           ; main thread missed this frame (diagnostics)
  jmp @nouploads
:
  lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  lda pal_dirty
  beq @nopal
  jsr upload_palette
@nopal:
  jsr vq_flush
  lda #0
  sta nmi_ready
  lda rk_flip
  beq :+
  lda rk_buf
  eor #1
  sta rk_buf
  lda #0
  sta rk_flip
:
@nouploads:
  jsr call_nmi_hook
  bit PPUSTATUS
  lda scroll_x
  sta PPUSCROLL
  lda scroll_y
  sta PPUSCROLL
  lda ppu_ctrl
  sta PPUCTRL
  lda ppu_mask
  sta PPUMASK
@noppu:
  ; scanline IRQ for the coming frame
  lda MMC5_IRQSTAT        ; acknowledge anything stale
  lda irq_first
  sta MMC5_IRQLINE
  beq @noirq
  lda #$80
@noirq:
  sta MMC5_IRQSTAT
  cli                     ; raster IRQs may interrupt the music driver
  jsr music_play
  ; song position: free-running, re-synced to the driver at every new pattern
  inc tl_frame
  bne :+
  inc tl_frame+1
: lda music_events
  ora ev_acc
  sta ev_acc
  lda music_events
  and #$02
  beq @nopat
  ldx music_order
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
  pla
  tay
  pla
  tax
  pla
  rti

call_nmi_hook:
  jmp (nmi_hook)

upload_palette:
  lda #$3F
  sta PPUADDR
  lda #$00
  sta PPUADDR
  .repeat 32, i
  lda pal_buf+i
  sta PPUDATA
  .endrepeat
  lda #0
  sta pal_dirty
  rts

; VRAM queue: entries of [addr hi, addr lo, length, bytes...], ended by a 0 hi byte.
; Bit 7 of the hi byte = write with +32 increment (columns).
vq_flush:
  ldx #0
@entry:
  lda vq,x
  beq @done
  ldy ppu_ctrl
  cmp #$80
  bcc @h
  pha
  tya
  ora #$04
  tay
  pla
  and #$7F
@h:
  sty PPUCTRL
  sta PPUADDR
  lda vq+1,x
  sta PPUADDR
  ldy vq+2,x
  inx
  inx
  inx
@b:
  lda vq,x
  sta PPUDATA
  inx
  dey
  bne @b
  beq @entry
@done:
  lda #0
  sta vq
  sta vq_len
  lda ppu_ctrl
  sta PPUCTRL
  rts

; ------------------------------------------------------------------ IRQ
irq:
  jmp (irq_vec)
irq_ack:
  pha
  lda MMC5_IRQSTAT
  pla
  rti

; ------------------------------------------------------------------ raster kernel
; Drives screen lines rk_start .. rk_start+rk_count-1 from per-line tables indexed by screen
; line. The first IRQ (line rk_start-2) parks the CPU in a NOP sled with interrupts on; then
; every line's MMC5 scanline IRQ lands with at most one cycle of jitter, and its handler does
; the $2006/$2005/$2005/$2006 dance (full X and Y scroll and nametable) in that line's
; horizontal blank. No polling of $5204: a DMC DMA halt re-reads the register, and that
; double read would swallow the flag.
; Arm with irq_first = rk_start - 2 and irq_vec = rk_irq.

; Entry: X = next screen line, kernel handler in irq_vec. Spins until the handler ends it.
.macro RK_ENTER handler
  lda #<handler
  sta irq_vec
  lda #>handler
  sta irq_vec+1
  cli
  jmp rk_sled
.endmacro

; Per-line handler body for buffer base, with D cycles of delay before the critical writes.
.macro RK_LINE base, D
  lda MMC5_IRQSTAT
  stx MMC5_IRQLINE
  lda base+RK_HI,x
  sta PPUADDR
  lda base+RK_Y,x
  sta PPUSCROLL
  ldy base+RK_LO,x
  lda base+RK_X,x
  .repeat D
  nop
  .endrepeat
  sta PPUSCROLL
  sty PPUADDR
  inx
  cpx rk_end
  beq :+
  rti
: jmp rk_finish
.endmacro

RK_DELAY = 22

rk_irq:
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
  ldx rk_start
  dex
  stx MMC5_IRQLINE
  inx
  bit PPUSTATUS            ; reset the write toggle
  lda rk_buf
  bne :+
  RK_ENTER rk_line0
: RK_ENTER rk_line1

rk_line0:
  RK_LINE RK0, RK_DELAY
rk_line1:
  RK_LINE RK1, RK_DELAY

; The sled: 2-cycle instructions only, so the IRQ lands within a cycle.
rk_sled:
  .repeat 120
  nop
  .endrepeat
  jmp rk_sled

; Last line done: drop the sled's interrupt frame, then return from the first IRQ.
rk_finish:
  pla
  pla
  pla
  lda rk_after
  sta MMC5_IRQLINE
  beq :+
  lda rk_after_vec
  sta irq_vec
  lda rk_after_vec+1
  sta irq_vec+1
  jmp :++
: lda rk_entry_vec
  sta irq_vec
  lda rk_entry_vec+1
  sta irq_vec+1
: lda MMC5_IRQSTAT
  pla
  tay
  pla
  tax
  pla
  rti

; Install a raster kernel entry (A = lo, Y = hi) as the IRQ handler.
set_kernel:
  sta irq_vec
  sta rk_entry_vec
  sty irq_vec+1
  sty rk_entry_vec+1
  rts

; Store the table entry for screen line Y in the buffer being built (see rk_begin):
; A = source y (0..239), t9 = x scroll. Clobbers A, X. Keeps Y.
rk_put:
  sta (rkp_y),y
  tax
  lda rk_hi_of_y,x
  sta (rkp_hi),y
  lda t9
  sta (rkp_x),y
  lsr a
  lsr a
  lsr a
  ora rk_lo_of_y,x
  sta (rkp_lo),y
  rts

; Point rkp_* at the buffer the kernel is NOT showing.
rk_begin:
  lda #0
  sta rkp_hi
  sta rkp_y
  sta rkp_x
  sta rkp_lo
  sta rkp_m
  lda rk_buf
  bne :+
  lda #>RK1
  bne :++
: lda #>RK0
: sta rkp_hi+1
  clc
  adc #1
  sta rkp_y+1
  adc #1
  sta rkp_x+1
  adc #1
  sta rkp_lo+1
  adc #1
  sta rkp_m+1
  rts

.segment "RODATA"
.align 256
rk_lo_of_y:
  .repeat 256, i
  .byte (i << 2) & $E0
  .endrepeat
rk_hi_of_y:
  .repeat 256, i
  .byte (i >> 6) & 3
  .endrepeat
.segment "CODE"

; ------------------------------------------------------------------ helpers

; Read controller 1 into buttons; buttons_new = newly pressed.
read_pad:
  lda buttons
  sta t0
  lda #1
  sta JOY1
  lda #0
  sta JOY1
  ldx #8
: lda JOY1
  lsr a
  rol buttons
  dex
  bne :-
  lda t0
  eor #$FF
  and buttons
  sta buttons_new
  rts

; 16-bit LFSR-ish random -> A
rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

; Turn rendering off at the next vblank and keep the NMI away from the PPU.
ppu_off:
  lda #0
  sta ppu_mask
  sta irq_first
  lda #1
  sta nmi_ready
  WAIT_NMI
  lda #1
  sta nmi_mode
  lda #0
  sta PPUMASK
  rts

; Re-enable NMI PPU work; rendering comes on with ppu_mask at the next NMI.
ppu_on:
  lda #0
  sta nmi_mode
  lda #1
  sta pal_dirty
  rts

clear_vram:
  ; Clears $2000-$2FFF and all palettes (rendering must be off).
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldy #16
  ldx #0
: sta PPUDATA
  inx
  bne :-
  dey
  bne :-
  rts

; Copy the 32-byte palette at (ptr0) into pal_src and mark for upload with the current fade.
set_palette:
  ldy #31
: lda (ptr0),y
  sta pal_src,y
  dey
  bpl :-
  ; fall through
; Recompute pal_buf from pal_src with the current fade (-4..4).
apply_fade:
  ldx #31
@l:
  lda pal_src,x
  ldy fade
  beq @store
  ; luma = c>>4 (black $0F counts as -1)
  cmp #$0F
  bne :+
  lda #$F0                ; hue 0, luma -1
: sta t0
  and #$0F
  sta t1                  ; hue
  lda t0
  and #$F0
  clc
  adc fade_add,y          ; signed luma steps (index by fade & $FF via table below)
  bmi @black
  cmp #$40
  bcc :+
  lda #$30
  bne @store
: ora t1
  jmp @store
@black:
  lda #$0F
@store:
  ; $xD/$xE/$xF other than grey columns are black too
  sta pal_buf,x
  dex
  bpl @l
  lda #1
  sta pal_dirty
  rts

; fade_add[y] for y = fade as unsigned byte: 0..4 -> +$00..+$40, $FC..$FF -> -$40..-$10
fade_add = fade_tab
.segment "RODATA"
fade_tab:
  .byte $00, $10, $20, $30, $40
  .res $FC - 5, 0
  .byte $C0, $D0, $E0, $F0
.segment "CODE"

; OAM helpers --------------------------------------------------------
oam_clear:
  lda #0
  sta oam_full
  lda #$F8
  ldx #0
: sta oam,x
  inx
  inx
  inx
  inx
  bne :-
  stx oam_i
  rts

; Draw a metasprite with clipping. ptr0 -> [count, (dy, tile, attr, dx)*] (signed offsets);
; x = t0 (lo) / t4 (hi), y = t1 (lo) / t3 (hi), as OAM y (screen y - 1). Uses t2, t5, t6.
draw_meta:
  lda oam_full
  beq :+
  rts                     ; all 64 sprites used: later (lower priority) objects are dropped
: ldy #0
  lda (ptr0),y
  bne :+
  rts
: sta t2
  iny
  ldx oam_i
@l:
  lda (ptr0),y           ; dy
  sta t5
  clc
  adc t1
  sta t6
  lda t5
  and #$80
  beq :+
  lda #$FF
: adc t3
  bne @skipy
  lda t6
  cmp #239
  bcs @skipy
  sta oam,x
  iny
  lda (ptr0),y           ; tile
  sta oam+1,x
  iny
  lda (ptr0),y           ; attr
  sta oam+2,x
  iny
  lda (ptr0),y           ; dx
  sta t5
  clc
  adc t0
  sta oam+3,x
  lda t5
  and #$80
  beq :+
  lda #$FF
: adc t4
  bne @skipx
  iny
  inx
  inx
  inx
  inx
  beq @full
  dec t2
  bne @l
  beq @done
@full:
  inc oam_full
  beq @full
  ldx #0
  beq @done
@skipy:
  iny
  iny
  iny
  iny
  dec t2
  bne @l
  beq @done
@skipx:
  iny
  lda #$F8
  sta oam,x
  dec t2
  bne @l
@done:
  stx oam_i
  rts

; Hide the rest of OAM from oam_i on.
oam_finish:
  ldx oam_i
  beq @r
  lda #$F8
: sta oam,x
  inx
  inx
  inx
  inx
  bne :-
@r:
  rts

; Bulk loaders (rendering off) ---------------------------------------

; Write 960 nametable bytes from (ptr0) to $2000 and zero the attribute table.
load_nt:
  lda #$20
  sta PPUADDR
  lda #$00
  sta PPUADDR
  ldx #4
  ldy #0
@l:
  lda (ptr0),y
  sta PPUDATA
  iny
  bne @l
  inc ptr0+1
  dex
  bne @l
  rts                     ; (writes 1024 bytes: 960 tiles + 64 attribute)

; Copy 1024 bytes from (ptr0) to ExRAM (ExRAM must be in RAM mode).
load_ex:
  ldy #0
@l:
  lda (ptr0),y
  sta EXRAM,y
  iny
  bne @l
  inc ptr0+1
@l2:
  lda (ptr0),y
  sta EXRAM+$100,y
  iny
  bne @l2
  inc ptr0+1
@l3:
  lda (ptr0),y
  sta EXRAM+$200,y
  iny
  bne @l3
  inc ptr0+1
@l4:
  lda (ptr0),y
  sta EXRAM+$300,y
  iny
  bne @l4
  inc ptr0+1
  rts

; Fill 1024 bytes of ExRAM with A (RAM mode).
fill_ex:
  ldx #0
: sta EXRAM,x
  sta EXRAM+$100,x
  sta EXRAM+$200,x
  sta EXRAM+$300,x
  inx
  bne :-
  rts

; Fill nametable $2000 (1024 bytes) with A.
fill_nt:
  ldx #$20
  stx PPUADDR
  ldx #$00
  stx PPUADDR
  ldy #4
: sta PPUDATA
  inx
  bne :-
  dey
  bne :-
  rts

; Load a full extended-attribute screen (rendering off): ptr0 -> 1024 nametable bytes,
; ptr2 -> 1024 ExRAM bytes. Leaves ExRAM in extended-attribute mode.
load_bitmap:
  lda #0
  sta MMC5_NTMAP          ; all nametables -> CIRAM A
  lda #EX_RAM
  sta MMC5_EXMODE
  jsr load_nt
  lda ptr2
  sta ptr0
  lda ptr2+1
  sta ptr0+1
  jsr load_ex
  lda #EX_ATTR
  sta MMC5_EXMODE
  rts

; Map sprite CHR: four 1 KB banks starting at A.
set_sprite_chr:
  sta MMC5_CHR0+4
  clc
  adc #1
  sta MMC5_CHR0+5
  adc #1
  sta MMC5_CHR0+6
  adc #1
  sta MMC5_CHR0+7
  rts

; Fill both raster buffers with identity Y (line -> same picture row), X = 0, for lines
; rk_start .. rk_start+rk_count-1.
rk_identity:
  lda #0
  sta t9
  jsr @one
  lda rk_buf
  eor #1
  sta rk_buf
  jsr @one
  lda rk_buf
  eor #1
  sta rk_buf
  rts
@one:
  jsr rk_begin
  lda rk_start
  clc
  adc rk_count
  sta t8
  ldy rk_start
: tya
  jsr rk_put
  iny
  cpy t8
  bne :-
  rts

; Wait until the MMC5 says the PPU is rendering (ExRAM writes in modes 0/1 only stick then).
wait_inframe:
  bit MMC5_IRQSTAT
  bvc wait_inframe
  rts

; Copy t2 bytes from bank A:(ptr0) to (ptr1), restoring the part's bank.
far_copy:
  ora #$80
  sta MMC5_PRG8
  ldy #0
: lda (ptr0),y
  sta (ptr1),y
  iny
  cpy t2
  bne :-
  lda cur_bank
  sta MMC5_PRG8
  rts

; 8x8 -> 16 unsigned multiply with the MMC5: A * X -> A (hi), Y (lo)
mul8:
  sta MMC5_MULA
  stx MMC5_MULB
  ldy MMC5_MULA
  lda MMC5_MULB
  rts

.include "timeline.inc"
.segment "RODATA"
.include "tables.inc"
.segment "CODE"
.include "parts.inc"
