; =====================================================================================
;  GROOVE  -  an NES demo cartridge (MMC5)
;  Engine: reset, NMI, the parametric raster kernel, the scene director (seamless cuts with
;  nametables and ExRAM preloaded while the previous scene plays), sprites and helpers.
; =====================================================================================
.include "defs.inc"

.import music_init, music_play
.importzp music_frame, music_order, music_row, music_events, music_events2, music_note

; ------------------------------------------------------------------ iNES header
.segment "HEADER"
  .byte "NES", $1A
  .byte PRG_16K           ; PRG ROM in 16 KB units
  .byte CHR_8K            ; CHR ROM in 8 KB units
  .byte $50               ; mapper 5
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
dm_rows: .res 1
dm_y: .res 1
dm_x: .res 1
dm_n: .res 1
ptr0: .res 2
ptr1: .res 2
nmi_count: .res 1
nmi_ready: .res 1
nmi_mode: .res 1          ; 1: NMI leaves the PPU alone (bulk loading)
main_seen: .res 1
ppu_ctrl: .res 1
ppu_mask: .res 1
ctrl_vis: .res 1          ; PPUCTRL / PPUMASK as committed at the last complete frame
mask_vis: .res 1
scroll_x: .res 1          ; top-of-frame scroll (lines above the kernel)
scroll_y: .res 1
irq_vec: .res 2
lag_count: .res 1
; song position
ord: .res 1               ; current order (pattern) as last seen by the NMI
ord_t: .res 2             ; frames since the order started (0 on its first frame)
row_t: .res 1             ; frames since the current row started
ev: .res 1                ; music_events OR-ed since main last looked
ev2: .res 1
evn: .res 1               ; events seen by the current main frame
evn2: .res 1
; kernel: per-line Y = DDA (k_y0 + n * k_step), X = XTAB[line] + XTB[line], NT/bank tables
k_on: .res 1              ; main: 1 to run the kernel next frame
k_start: .res 1           ; first screen line driven (>= 3)
k_end: .res 1             ; one past the last line
k_y0: .res 2              ; 8.8 source line BEFORE the first line (the first step is added first)
k_step: .res 2            ; 8.8 source lines per screen line
k_xtab: .res 2            ; table pointers (indexed by screen line)
k_xtb: .res 2
ky0f_nmi: .res 1          ; k_y0 as latched by the NMI for this frame's kernel
ky0i_nmi: .res 1
exmode_cur: .res 1        ; ExRAM mode currently set
kyf: .res 1               ; running DDA (kernel only)
kyi: .res 1
klo: .res 1
k_ntab_last: .res 1       ; nametable bits for the blank tail
; staged registers for the next vblank
st_bg: .res 4             ; $5120-$5123 (BG pattern table $0000)
st_spr: .res 4            ; $5124-$5127 (sprites, pattern table $1000)
st_spr_dirty: .res 1
st_exmode: .res 1
st_exmode_dirty: .res 1
pal_dirty: .res 1
; director
scene: .res 1             ; current scene ($FF none)
page: .res 1              ; CIRAM page of the current scene (0 A, 1 B)
pre_scene: .res 1         ; scene whose data is being / has been preloaded
pre_pos: .res 1           ; preload progress: nametable chunks done (32 = all done)
pre_ex: .res 1            ; ExRAM chunks done
vq_bank: .res 1           ; NMI upload: PRG bank holding the data ($A000 window), 0 = none
vq_src: .res 2
vq_dst: .res 2
a_bank: .res 1            ; main's $A000 bank
cur_bank: .res 1          ; scene bank at $8000
rng: .res 2
buttons: .res 1
buttons_new: .res 1
oam_i: .res 1
xb_buf: .res 1            ; which band buffer (XTB/BTB) the kernel shows
xb_flip: .res 1
sv: .res 48               ; scene variables

; ------------------------------------------------------------------ RAM
.segment "OAM"
oam: .res 256

.segment "BSS"
pal_buf: .res 32
pal_src: .res 32
kdummy: .res 1
bss_free: .res 255

; PRG-RAM ($6000-$7FFF)
KRAM  = $6000             ; the kernel line handler (also the IRQ vector target)
XTB0  = $6100             ; band X offsets per screen line, two buffers
XTB1  = $6200
BTB0  = $6300             ; (unused: per-line bank writes were dropped, see k_patch)
BTB1  = $6400
NTA   = $6500             ; 256 x $00: nametable bits for CIRAM A (also an all-zero table)
NTB   = $6600             ; 256 x $04: CIRAM B
SCRATCH = $6700           ; scenes: $6700-$6FFF
WAVES = $7000             ; 8 sine tables x 512 (amplitude index * 512 + phase)

; ------------------------------------------------------------------ vectors
.segment "VECTORS"
  .word nmi, reset, KRAM

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
  stx $4010
  lda #$40
  sta $4017
  lda #3
  sta MMC5_PRGMODE        ; 4 x 8 KB
  sta MMC5_CHRMODE        ; 1 KB CHR banks
  lda #2
  sta MMC5_RAMPROT1
  lda #1
  sta MMC5_RAMPROT2
  lda #0
  sta MMC5_PRG6
  sta MMC5_CHRHI
  sta MMC5_SPLIT
  sta MMC5_IRQSTAT
  lda #$80 | BANK_FIXC
  sta MMC5_PRGC
  lda #$80 | BANK_COMMON
  sta MMC5_PRGA
  lda #$80 | 0
  sta MMC5_PRG8
  lda #$50                ; NT0/NT1 = CIRAM A, NT2/NT3 = CIRAM B (X wraps within a page)
  sta MMC5_NTMAP
  lda #EX_RAM
  sta MMC5_EXMODE
  sta exmode_cur
  bit PPUSTATUS
: bit PPUSTATUS
  bpl :-
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
: sta oam,x
  inx
  bne :-
  lda #$80 | BANK_COMMON
  sta a_bank
  ; kernel handler and its dispatcher into PRG-RAM
  ldx #0
: lda kt_start,x
  sta KRAM,x
  inx
  cpx #kt_stop - kt_start
  bne :-
  jsr k_idle_dispatch
  lda #<k_entry
  sta irq_vec
  lda #>k_entry
  sta irq_vec+1
  ; sine tables into PRG-RAM (the kernel reads them while any bank may be mapped)
  lda #<WAVES_ROM
  sta ptr0
  lda #>WAVES_ROM
  sta ptr0+1
  lda #<WAVES
  sta ptr1
  lda #>WAVES
  sta ptr1+1
  ldx #16
  ldy #0
: lda (ptr0),y
  sta (ptr1),y
  iny
  bne :-
  inc ptr0+1
  inc ptr1+1
  dex
  bne :-
  ; constant per-line tables: NTA all $00 (CIRAM A), NTB all $04 (CIRAM B)
  ldx #0
: lda #0
  sta NTA,x
  lda #4
  sta NTB,x
  inx
  bne :-
  ; band tables: zero X, bank 0
  lda #0
  tax
: sta XTB0,x
  sta XTB1,x
  sta BTB0,x
  sta BTB1,x
  inx
  bne :-
: bit PPUSTATUS
  bpl :-
  jsr clear_vram
  lda #$A5
  sta rng
  sta rng+1
  lda #$FF
  sta scene
  sta pre_scene
  sta ord
  lda #$0F
  ldx #31
: sta pal_buf,x
  dex
  bpl :-
  lda #1
  sta pal_dirty
  ; first scene, loaded with rendering off
  lda #1
  sta nmi_mode
  lda #0
  jsr music_init
  lda #0
  sta page
  ldx scene_of_order
  jsr scene_load_direct
  lda #%10001000          ; NMI on, 8x8 sprites from $1000, BG from $0000
  sta ppu_ctrl
  sta ctrl_vis
  sta PPUCTRL
  lda #0
  sta nmi_mode
  cli
main_loop:
: lda nmi_count
  cmp main_seen
  beq :-
  sta main_seen
  sei                     ; take the events the NMI collected
  lda ev
  sta evn
  lda ev2
  sta evn2
  lda #0
  sta ev
  sta ev2
  cli
  jsr read_pad
  lda buttons_new         ; A (or a tap): play along, it hits the scene like a kick and a bass note
  and #BTN_A
  beq :+
  lda evn
  ora #$44
  sta evn
: jsr director
  jsr scene_frame_call
  lda #1
  sta nmi_ready
  jmp main_loop

scene_frame_call:
  ldx scene
  lda scene_frame_hi,x
  pha
  lda scene_frame_lo,x
  pha
rts_only:
  rts

; ------------------------------------------------------------------ director
; Picks the scene for the current order; at a change, the new scene takes over at once (its
; nametable and ExRAM were preloaded). Near the end of an order, preloads the next scene.
director:
  ldx ord
  cpx #NUM_ORDERS
  bcc :+
  rts
: lda scene_of_order,x
  cmp scene
  beq @same
  tax
  cpx pre_scene           ; preloaded? (else: load now, with a blank frame)
  bne @direct
  lda pre_pos
  cmp #32
  bcc @direct
  lda page
  eor #1
  sta page
  jsr scene_enter
  jmp @same
@direct:
  jsr scene_load_live
@same:
  ; preload the next order's scene during the last 64 frames of this one
  lda ord_t+1
  cmp #>(ORDER_LEN - 64)
  bcc @nopre
  bne :+
  lda ord_t
  cmp #<(ORDER_LEN - 64)
  bcc @nopre
: ldx ord
  inx
  cpx #NUM_ORDERS
  bcc :+
  ldx #0
: lda scene_of_order,x
  cmp scene
  beq @nopre
  cmp pre_scene
  beq @step
  sta pre_scene
  lda #0
  sta pre_pos
  sta pre_ex
@step:
  jsr preload_step
@nopre:
  rts

; One step of the preload: a 64-byte nametable chunk queued for the NMI (into the other
; CIRAM page; pre_pos 0-15) and a 64-byte ExRAM chunk written now by the CPU (ExRAM is in
; RAM mode while a normal-mode scene plays; pre_ex 0-15). Done when both reach 16
; (pre_pos is then set to 32).
preload_step:
  lda pre_pos
  cmp #32
  bcc :+
  rts
: ldx pre_scene
  cmp #16
  bcs @ex                 ; nametable done
  lda vq_bank
  bne @ex                 ; previous chunk not uploaded yet
  lda pre_pos
  lsr a
  lsr a
  sta t0                  ; offset high
  lda pre_pos
  and #3
  tay
  lda chunk_lo,y
  sta vq_dst
  clc
  adc scene_nt_lo,x
  sta vq_src
  lda t0
  adc scene_nt_hi,x       ; (carry from the low byte)
  sta vq_src+1
  lda page
  eor #1
  asl a
  asl a
  asl a
  ora #$20
  ora t0
  sta vq_dst+1
  lda scene_bank,x
  ora #$80
  sta vq_bank
  inc pre_pos
@ex:
  lda pre_ex
  cmp #16
  bcs @fin
  lda scene_ex_hi,x
  cmp #>(NOEX + $2000)
  bne :+
  lda #16                 ; no ExRAM image
  sta pre_ex
  bne @fin
: lda exmode_cur
  cmp #EX_ATTR
  beq @fin                ; the current scene shows ExRAM: cannot write it (never planned)
  lda pre_ex
  lsr a
  lsr a
  sta t1                  ; offset high
  lda pre_ex
  and #3
  tay
  lda chunk_lo,y
  sta ptr1
  clc
  adc scene_ex_lo,x
  sta ptr0
  lda t1
  adc scene_ex_hi,x       ; (carry from the low byte)
  sta ptr0+1
  lda t1
  clc
  adc #>EXRAM
  sta ptr1+1
  lda scene_bank,x
  ora #$80
  sta MMC5_PRGA
  ldy #63
: lda (ptr0),y
  sta (ptr1),y
  dey
  bpl :-
  lda a_bank
  sta MMC5_PRGA
  inc pre_ex
@fin:
  lda pre_pos
  cmp #16
  bcc :+
  lda pre_ex
  cmp #16
  bcc :+
  lda #32
  sta pre_pos
: rts

chunk_lo: .byte $00, $40, $80, $C0

; Enter scene X now (data preloaded into the new page). Sets scene, maps its bank, calls init.
scene_enter:
  stx scene
  lda scene_bank,x
  ora #$80
  sta cur_bank
  sta MMC5_PRG8
  lda scene_init_hi,x
  pha
  lda scene_init_lo,x
  pha
  rts

; Load scene X with rendering off (power-on, or a cut that was not preloaded).
scene_load_live:
  stx t7
  jsr ppu_off
  ldx t7
  jsr scene_load_direct
  jmp ppu_on

scene_load_direct:
  stx t7
  lda scene_bank,x
  ora #$80
  sta MMC5_PRGA
  lda scene_nt_lo,x
  sta ptr0
  lda scene_nt_hi,x
  sta ptr0+1
  lda page
  asl a
  asl a
  asl a
  ora #$20
  sta PPUADDR
  lda #0
  sta PPUADDR
  ldx #4
  ldy #0
: lda (ptr0),y
  sta PPUDATA
  iny
  bne :-
  inc ptr0+1
  dex
  bne :-
  ldx t7
  lda scene_ex_hi,x
  beq :++
  sta ptr0+1
  lda scene_ex_lo,x
  sta ptr0
  lda #EX_RAM
  sta MMC5_EXMODE
  sta exmode_cur
  ldx #4
  ldy #0
  lda #<EXRAM
  sta ptr1
  lda #>EXRAM
  sta ptr1+1
: lda (ptr0),y
  sta (ptr1),y
  iny
  bne :-
  inc ptr0+1
  inc ptr1+1
  dex
  bne :-
: lda a_bank
  sta MMC5_PRGA
  ldx t7
  lda #32
  sta pre_pos
  stx pre_scene
  jsr scene_enter
  ; apply the staged registers now (rendering is off)
  jmp apply_staged

; ------------------------------------------------------------------ NMI
nmi:
  pha
  txa
  pha
  tya
  pha
  lda nmi_mode
  beq :+
  jmp @noppu
: lda nmi_ready
  bne :+
  inc lag_count
  jmp @scroll
: lda #0
  sta OAMADDR
  lda #>oam
  sta OAMDMA
  lda pal_dirty
  beq :+
  jsr upload_palette
: lda vq_bank
  beq :+
  jsr vq_upload
: jsr apply_staged
  jsr k_patch
  lda page                ; commit what the top of the frame shows, with everything else
  asl a
  ora ppu_ctrl
  sta ctrl_vis
  lda ppu_mask
  sta mask_vis
  lda #0
  sta nmi_ready
@scroll:
  bit PPUSTATUS
  lda scroll_x
  sta PPUSCROLL
  lda scroll_y
  sta PPUSCROLL
  lda ctrl_vis
  sta PPUCTRL
  lda mask_vis
  sta PPUMASK
  ; the kernel's entry IRQ
  lda MMC5_IRQSTAT
  lda #0
  ldx k_on
  beq :+
  lda k_start
  sec
  sbc #2
: sta MMC5_IRQLINE
  beq :+
  lda #$80
: sta MMC5_IRQSTAT
@noppu:
  cli                     ; raster IRQs may interrupt the music driver
  jsr music_play
  ; song position
  lda music_events
  ora ev
  sta ev
  lda music_events2
  ora ev2
  sta ev2
  lda music_events
  lsr a
  bcc @norow
  ldx #0
  stx row_t
  lsr a
  bcc @frame
  stx ord_t
  stx ord_t+1
  lda music_order
  sta ord
  jmp @done
@norow:
  inc row_t
@frame:
  inc ord_t
  bne @done
  inc ord_t+1
@done:
  inc nmi_count
  pla
  tay
  pla
  tax
  pla
  rti

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

; 64 bytes from bank vq_bank:(vq_src) to VRAM vq_dst.
vq_upload:
  sta MMC5_PRGA
  lda vq_dst+1
  sta PPUADDR
  lda vq_dst
  sta PPUADDR
  ldy #0
  .repeat 64
  lda (vq_src),y
  sta PPUDATA
  iny
  .endrepeat
  lda a_bank
  sta MMC5_PRGA
  lda #0
  sta vq_bank
  rts

apply_staged:
  lda st_bg
  sta MMC5_CHR0
  lda st_bg+1
  sta MMC5_CHR0+1
  lda st_bg+2
  sta MMC5_CHR0+2
  lda st_bg+3
  sta MMC5_CHR0+3
  lda st_spr_dirty
  beq :+
  .repeat 4, i
  lda st_spr+i
  sta MMC5_CHR0+4+i
  .endrepeat
  lda #0
  sta st_spr_dirty
: lda st_exmode_dirty
  beq :+
  lda st_exmode
  sta MMC5_EXMODE
  sta exmode_cur
  lda #0
  sta st_exmode_dirty
: rts

; ------------------------------------------------------------------ the raster kernel
; One MMC5 scanline IRQ per line, entered from a NOP sled (so it lands within a cycle). The
; IRQ vector points at PRG-RAM: between frames it holds "jmp (irq_vec)", during the kernel the
; line handler itself (patched with this frame's table pointers and DDA step), so a line costs
; no dispatch. Per line: Y source = DDA, X = XTAB[line] + XTB[line], $2006/$2005/$2005/$2006 in
; the horizontal blank, then the BG bank for slot 0 ($5128) from BTAB[line].
; Carry is clear on entry to every line handler (the sled's flags come from k_entry's clc).
KDELAY = 6                   ; NOPs
KTAIL = 13                  ; k_finish delay loop (5 cycles per pass)
KTAIL_NOP = 0

; Cycles from the IRQ: 7 entry + 68 + KDELAY to the first critical write (needs >= ~87: dot 257),
; 107 + KDELAY - 12 in all (the line is 113.67).
kt_start:
  lda MMC5_IRQSTAT          ; 4  ack
  stx MMC5_IRQLINE          ; 4  next line
  lda kyf                   ; 3
kt_stepl = * + 1 - kt_start
  adc #$00                  ; 2
  sta kyf                   ; 3
  lda kyi                   ; 3
kt_steph = * + 1 - kt_start
  adc #$00                  ; 2
  sta kyi                   ; 3
  tay                       ; 2
  lda yclamp,y              ; 4
  tay                       ; 2
kt_nt = * + 1 - kt_start
  lda #$00                  ; 2  nametable bits
  sta PPUADDR               ; 4
  sty PPUSCROLL             ; 4
kt_xtab = * + 1 - kt_start
  lda $FFFF,x               ; 4
  clc                       ; 2
kt_xtb = * + 1 - kt_start
  adc $FFFF,x               ; 4
  sta klo                   ; 3
  lsr a                     ; 6
  lsr a
  lsr a
  ora lo_of_y,y             ; 4
  ldy klo                   ; 3
  .repeat KDELAY
  nop
  .endrepeat
  sty PPUSCROLL             ; 4  * fine X now, coarse X into t
  sta PPUADDR               ; 4  * t -> v
  inx                       ; 2
kt_end = * + 1 - kt_start
  cpx #$00                  ; 2  (leaves carry clear while x < end: the next line's adc needs it)
  beq :+                    ; 2
  rti                       ; 6
: jmp k_finish
kt_stop:

; Between frames the vector's target dispatches through irq_vec.
k_idle_dispatch:
  lda #$6C                  ; jmp (irq_vec)
  sta KRAM
  lda #<irq_vec
  sta KRAM+1
  lda #>irq_vec
  sta KRAM+2
  rts

; NMI: copy this frame's pointers into the handler (it is idle during vblank).
k_patch:
  lda k_on
  beq @r
  lda k_step
  sta KRAM+kt_stepl
  lda k_step+1
  sta KRAM+kt_steph
  lda page
  asl a
  asl a
  asl a
  sta KRAM+kt_nt            ; CIRAM B = nametable 2 ($2800)
  sta k_ntab_last
  lda k_xtab
  sta KRAM+kt_xtab
  lda k_xtab+1
  sta KRAM+kt_xtab+1
  lda k_end
  sta KRAM+kt_end
  lda xb_flip
  beq :+
  lda xb_buf
  eor #1
  sta xb_buf
  lda #0
  sta xb_flip
: ldx xb_buf
  lda k_xtb
  sta KRAM+kt_xtb
  lda k_xtb+1
  bne :+
  lda xtb_hi,x              ; k_xtb hi = 0: use the band buffer
: sta KRAM+kt_xtb+1
  lda k_y0
  sta ky0f_nmi
  lda k_y0+1
  sta ky0i_nmi
@r:
  rts

xtb_hi: .byte >XTB0, >XTB1
btb_hi: .byte >BTB0, >BTB1

; Entry IRQ (line k_start - 2): set up, then park in the sled with interrupts on.
k_entry:
  pha
  txa
  pha
  tya
  pha
  lda MMC5_IRQSTAT
  ldx k_start
  dex
  stx MMC5_IRQLINE
  inx
  lda ky0f_nmi
  sta kyf
  lda ky0i_nmi
  sta kyi
  bit PPUSTATUS             ; reset the write toggle
  lda #$AD                  ; the handler's first instruction (lda abs) replaces the dispatcher
  sta KRAM
  lda #<MMC5_IRQSTAT
  sta KRAM+1
  lda #>MMC5_IRQSTAT
  sta KRAM+2
  clc
  cli
k_sled:
  .repeat 100
  nop
  .endrepeat
  jmp k_sled

; After the last line: drop the sled's interrupt frame, restore the dispatcher, return to
; whatever the entry IRQ interrupted.
k_finish:
  pla
  pla
  pla
  ; one more line, timed from the last handler: point the rest of the screen at the blank rows
  ldy #BLANK_ROW
  ldx #KTAIL
: dex
  bne :-
  lda k_ntab_last
  sta PPUADDR
  sty PPUSCROLL
  lda #0
  ldx #<(BLANK_ROW << 2)
  .repeat KTAIL_NOP
  nop
  .endrepeat
  sta PPUSCROLL
  stx PPUADDR
  jsr k_idle_dispatch
  lda #0
  sta MMC5_IRQLINE
  lda MMC5_IRQSTAT
  pla
  tay
  pla
  tax
  pla
  rti

irq_ack:
  pha
  lda MMC5_IRQSTAT
  pla
  rti

; ------------------------------------------------------------------ helpers
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

rand:
  lda rng
  asl a
  rol rng+1
  bcc :+
  eor #$2D
: sta rng
  eor rng+1
  rts

ppu_off:
  lda #0
  sta ppu_mask
  sta mask_vis
  sta k_on
  lda #1
  sta nmi_ready
  WAIT_NMI
  lda #1
  sta nmi_mode
  lda #0
  sta PPUMASK
  rts

ppu_on:
  lda #0
  sta nmi_mode
  lda #1
  sta pal_dirty
  rts

clear_vram:
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

; Copy 32 palette bytes from (ptr0) to pal_buf and mark it for upload.
set_palette:
  ldy #31
: lda (ptr0),y
  sta pal_buf,y
  sta pal_src,y
  dey
  bpl :-
  lda #1
  sta pal_dirty
  rts

oam_clear:
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

; Hide OAM entries from oam_i on.
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
  lda #0
  sta oam_i
  rts

; Draw metasprite (ptr0) -> rows, (dy, dx0, count, tiles...)* at x = t0, y = t1 (OAM y);
; signed offsets; rows at y >= $EF are skipped. t2 = attributes (palette / flips).
; Keeps t0-t7 except nothing (uses its own dm_* temporaries).
draw_meta:
  ldy #0
  lda (ptr0),y
  beq @r
  sta dm_rows                  ; rows left
  iny
  ldx oam_i
@row:
  lda (ptr0),y            ; dy
  clc
  adc t1
  sta dm_y                  ; row y
  iny
  lda (ptr0),y            ; dx0
  clc
  adc t0
  sta dm_x                  ; x
  iny
  lda (ptr0),y            ; count
  sta dm_n
  iny
  lda dm_y
  cmp #$EF
  bcs @skiprow
@spr:
  lda (ptr0),y
  sta oam+1,x
  iny
  lda dm_y
  sta oam,x
  lda t2
  sta oam+2,x
  lda dm_x
  sta oam+3,x
  clc
  adc #8
  sta dm_x
  inx
  inx
  inx
  inx
  beq @full
  dec dm_n
  bne @spr
  dec dm_rows
  bne @row
@full:
  stx oam_i
@r:
  rts
@skiprow:
  tya
  clc
  adc dm_n
  tay
  dec dm_rows
  bne @row
  stx oam_i
  rts

; 8x8 multiply with the MMC5: A * X -> A (hi), Y (lo)
mul8:
  sta MMC5_MULA
  stx MMC5_MULB
  ldy MMC5_MULA
  lda MMC5_MULB
  rts

.segment "RODATA"
.align 256
lo_of_y:
  .repeat 256, i
  .byte (i << 2) & $E0
  .endrepeat
yclamp:                       ; source lines 216-255 (or a wrapped negative) -> the blank row
  .repeat 256, i
  .if i < BLANK_ROW
  .byte i
  .else
  .byte BLANK_ROW
  .endif
  .endrepeat
.segment "CODE"


.include "scenes.inc"
