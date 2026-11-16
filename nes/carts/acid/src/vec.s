; =====================================================================================
;  VEC: real-time 3D vectors rendered into CHR-RAM
;
;  A 128 x 96 pixel bitmap (16 x 12 tiles) sits in the middle of the screen. Its tiles are
;  numbered column-major, so the CPU draws into a linear, column-major buffer in PRG-RAM
;  ($6000, 96 bytes per 8-pixel column: plot = (col_base),y with y = the pixel row).
;  Double buffering costs no extra tiles: bitplane 0 and bitplane 1 of the same 192 tiles are
;  the two frame buffers, and the background palette picks which one is visible
;  (colours 1/3 = line, 2 = black shows plane 0; 2/3 = line, 1 = black shows plane 1).
;  Only one plane is written per frame, so a tile costs 8 bytes: the 1,536-byte image is
;  streamed over two video frames (30 fps) by generated straight-line code
;  (stx $2006 / lda #lo / sta $2006 / 8 x lda abs, sta $2007 = 74 cycles a tile) in forced
;  blank from line 184 through the vblank. The CPU draws the next image into the other
;  PRG-RAM bank meanwhile.
;  Transform: per frame, the rotation matrix (3 Euler angles, zoom) is multiplied by each of
;  the object's few distinct coordinate magnitudes (MMC5 multiplier), so a vertex is three
;  table lookups and adds per axis; then perspective (one multiply per axis), back-face
;  culling (2D cross products) and Bresenham lines unrolled per pixel bit.
; =====================================================================================

VEC_IRQ_LINE = 182

; ExRAM (mode 2, plain RAM) layout
vcx    = $5C00          ; vertex coordinate codes
vcy    = $5C40
vcz    = $5C80
psx_lo = $5CC0          ; projected, 16-bit
psx_hi = $5D00
psy_lo = $5D40
psy_hi = $5D80
psz    = $5DC0          ; rotated z (signed)
eflag  = $5E00          ; edge visible
tabT   = $5E40          ; 9 x 16 product tables: tabT + 16*j + code
tabN   = $5ED0          ; 3 x 16: the matrix's z row times each face-normal magnitude


.segment "BSS"
mags: .res 8
nmags: .res 8
cx0: .res 2             ; clipper: segment end points (16-bit)
cy0: .res 2
cx1: .res 2
cy1: .res 2
cmx: .res 2
cmy: .res 2
star_r: .res 40         ; ray (0..63)
star_z: .res 40         ; depth 0 (far) .. 255 (near)
star_plo: .res 40       ; ray table pointer base (lo: (r & 3) << 6, hi: page)
star_phi: .res 40

.segment "ZEROPAGE"
star_ymax: .res 1       ; stars at or below this line are dropped
star_cy: .res 1         ; vanishing point of the stars
vec_on: .res 1          ; the vector engine is running (its handlers are installed)
vec_done: .res 1
vc_t0: .res 1           ; (upload interrupt scratch)
vc_t1: .res 1
vec_ready: .res 1
vec_readybank: .res 1  ; the PRG-RAM bank holding the finished image (valid while vec_ready)
vec_active: .res 1
vec_upbank: .res 1
vec_drawbank: .res 1
vec_upplane: .res 1
vec_dispplane: .res 1
vec_col: .res 1         ; line colour (palette value)
vec_bg: .res 1          ; backdrop colour
vec_spal: .res 1        ; star colour
vec_ring: .res 1        ; backdrop band rotation 0..2
vec_rglow: .res 1       ; backdrop glow (frames)

lx0: .res 1
ly0: .res 1
lx1: .res 1
ly1: .res 1
lmaj: .res 1
lmin: .res 1
lerr: .res 1
lptr: .res 2
lvec: .res 2
optr: .res 2
o_nv: .res 1
o_ne: .res 1
o_nf: .res 1
o_nmag: .res 1
o_edges: .res 2         ; pointer to the edge list
o_faces: .res 2
mat: .res 9
zoom: .res 1
ang_x: .res 1
ang_y: .res 1
ang_z: .res 1
o_nnmag: .res 1
star_n: .res 1
star_speed: .res 1
bb_cmin: .res 2         ; per PRG-RAM bitmap: columns and top row drawn into it
bb_cmax: .res 2
bb_ymin: .res 2
cur_cmin: .res 1        ; extent of the image being drawn
cur_cmax: .res 1
cur_ymin: .res 1
vt: .res 4

; =====================================================================================
.segment "CODEC"

; Install the vector engine (rendering must be off). Uploads the sprite CHR, builds the
; nametable and resets the buffers. Rendering starts at the next vblank after ppu_on.
vec_install:
  lda #0
  sta MMC5_NTMAP          ; all nametables -> CIRAM A
  lda #2
  sta MMC5_EXMODE         ; ExRAM as RAM (vertex arrays)
  ; clear the whole CHR-RAM (both bitplanes of the bitmap)
  lda #$00
  ldx #32
  jsr fill_vram0
  ; the backdrop: tiles 192-255 and the nametable (the window holds the bitmap's tiles)
  SET_BANKA 24
  lda #<mouth_chr
  sta ptr0
  lda #>mouth_chr
  sta ptr0+1
  lda #$0C
  ldx #4
  jsr copy_vram
  lda #<mouth_nt
  sta ptr0
  lda #>mouth_nt
  sta ptr0+1
  lda #$20
  ldx #4
  jsr copy_vram
  ; sprite tiles at $1000
  jsr vec_sprite_chr
  ; both PRG-RAM bitmaps
  lda #0
  sta MMC5_PRG6
  jsr vec_clear_all
  lda #1
  sta MMC5_PRG6
  jsr vec_clear_all
  lda #0
  sta vec_done
  sta vec_ready
  sta vec_active
  sta vec_drawbank
  sta vec_dispplane
  sta ram_bank
  sta MMC5_PRG6
  lda #0
  sta bb_cmin
  sta bb_cmin+1
  sta bb_ymin
  sta bb_ymin+1
  lda #15
  sta bb_cmax
  sta bb_cmax+1
  jsr stars_init
  lda #232
  sta star_ymax
  lda #112
  sta star_cy
  lda #0
  sta vec_ring
  sta vec_rglow
  lda #1
  sta vec_upbank
  sta vec_on
  lda #$2A
  sta vec_col
  lda #$0F
  sta vec_bg
  lda #<vec_nmi
  sta nmi_vec
  lda #>vec_nmi
  sta nmi_vec+1
  lda #<vec_irq
  sta irq_vec
  lda #>vec_irq
  sta irq_vec+1
  lda #<vec_tail
  sta tail_vec
  lda #>vec_tail
  sta tail_vec+1
  lda #%10001000          ; NMI, BG $0000, sprites $1000
  sta ppu_ctrl
  lda #%00011110
  sta ppu_mask
  lda #0
  sta scroll_x
  sta scroll_y
  jsr oam_clear
  lda #>oam
  sta oam_page
  jsr vec_palette
  rts

vec_clear_all:
  lda #0
  tax
: sta $6000,x
  sta $6100,x
  sta $6200,x
  sta $6300,x
  sta $6400,x
  sta $6500,x
  inx
  bne :-
  rts

; Sprite tiles (rendering off): tile 0 blank, 1-4 stars of growing size, 5-8 balls.
vec_sprite_chr:
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

; pal_buf from the engine state: the bitmap plane on show, line, backdrop and star colours.
vec_palette:
  lda vec_bg
  sta pal_buf
  sta pal_buf+16
  ldx vec_col
  lda vec_dispplane
  bne :+
  stx pal_buf+1
  lda #$0F
  sta pal_buf+2
  stx pal_buf+3
  jmp @spr
: lda #$0F
  sta pal_buf+1
  stx pal_buf+2
  stx pal_buf+3
@spr:
  ldx #8
: lda #$0F
  sta pal_buf,x
  inx
  cpx #16
  bne :-
  lda #$0F
  sta pal_buf+4
  ldx vec_ring            ; backdrop rings: three colours rotated by vec_ring
  ldy #0
@rc:
  lda ring_cols,x
  cmp #$0F
  beq :+
  clc
  adc vec_rglow
: sta pal_buf+5,y
  inx
  iny
  cpy #3
  bne @rc
  lda vec_spal
  sta pal_buf+17
  lda #$15
  sta pal_buf+18
  lda #$30
  sta pal_buf+19
  lda #$1A
  sta pal_buf+21
  lda #$2A
  sta pal_buf+22
  lda #$3A
  sta pal_buf+23
  lda #$14
  sta pal_buf+25
  lda #$24
  sta pal_buf+26
  lda #$34
  sta pal_buf+27
  lda #$00
  sta pal_buf+29
  lda #$10
  sta pal_buf+30
  lda #$30
  sta pal_buf+31
  rts

; ------------------------------------------------------------------ uploads
; An image is uploaded in four chunks: the first and second half's IRQ part (75 tiles, in the
; forced blank from line 184) and NMI part (21 tiles, in the vblank). Any order works, so a
; finished image starts uploading at whichever comes first; the plane flips in the vblank
; that completes it. vec_done: bit0/1 = IRQ part of half 0/1 done, bit2/3 = NMI part.

; Take the finished image.
vec_start:
  lda vec_readybank
  sta vec_upbank
  lda vec_dispplane
  eor #1
  sta vec_upplane
  lda #0
  sta vec_ready
  sta vec_done
  lda #1
  sta vec_active
  rts

; Show the completed plane: colours 1 and 2 swap (already faded).
vec_flip:
  lda vec_upplane
  sta vec_dispplane
  ldx pal_buf+1
  lda pal_buf+2
  sta pal_buf+1
  stx pal_buf+2
  lda #0
  sta vec_active
  rts

; X = half, A = 0 (IRQ part) or 3 (NMI part): run that chunk.
vec_chunk:
  sta vc_t1
  lda vec_upbank
  sta MMC5_PRG6
  lda vec_upplane
  asl a
  stx vc_t0
  ora vc_t0
  ora #$80 | 16
  sta MMC5_PRGA
  lda vc_t1
  bne :+
  jsr $A000
  jmp :++
: jsr $A003
: lda ram_bank
  sta MMC5_PRG6
  lda a_bank
  sta MMC5_PRGA
  rts

vec_irq:
  pha
  txa
  pha
  tya
  pha
  lda #0
  sta PPUMASK             ; forced blank until the vblank
  lda MMC5_IRQSTAT
  lda #0
  sta OAMADDR
  lda oam_page
  sta OAMDMA
  lda vec_active
  bne @go
  lda vec_ready
  beq @exit
  jsr vec_start
@go:
  lda vec_done
  lsr a
  bcs :+
  ldx #0
  lda #1
  bne @do
: lsr a
  bcs @exit               ; both IRQ parts done
  ldx #1
  lda #2
@do:
  ora vec_done
  sta vec_done
  lda #0
  jsr vec_chunk
@exit:
  pla
  tay
  pla
  tax
  pla
  rti

; ------------------------------------------------------------------ vblank
vec_nmi:
  lda vec_active
  beq @try
  lda vec_done
  cmp #$0F
  bne @chunk
  jsr vec_flip            ; completed by the last IRQ
@try:
  lda vec_ready
  beq @noup
  jsr vec_start
@chunk:
  lda vec_done
  and #4
  bne :+
  ldx #0
  lda #4
  bne @do
: lda vec_done
  and #8
  bne @noup
  ldx #1
  lda #8
@do:
  ora vec_done
  sta vec_done
  lda #3
  jsr vec_chunk
  lda vec_done
  cmp #$0F
  bne @noup
  jsr vec_flip
@noup:
  jsr upload_palette
  lda ppu_ctrl
  sta PPUCTRL
  lda scroll_x
  sta PPUSCROLL
  lda scroll_y
  sta PPUSCROLL
  lda ppu_mask
  sta PPUMASK
  lda #VEC_IRQ_LINE
  sta MMC5_IRQLINE
  lda #$80
  sta MMC5_IRQSTAT
  jmp nmi_common

; ------------------------------------------------------------------ 60 fps tail
vec_tail:
  jsr vec_stars
  jsr vec_palette
  jmp pal_finish

;  3D starfield of sprites (interrupt side, lookups only): each star flies along one of 64
; precomputed rays (B21: signed screen offsets per depth step, $80 = off screen).
vec_stars:
  lda a_bank
  pha
  lda #$80 | 21
  sta a_bank
  sta MMC5_PRGA
  ldx #0
  stx i0                  ; OAM index
@l:
  cpx star_n
  bcc :+
  jmp @hide
: stx i5
  lda star_z,x
  clc
  adc star_speed
  bcc @ok
@respawn:
  jsr rand
  and #63
  sta star_r,x
  jsr star_ptr
  lda #0
@ok:
  sta star_z,x
  lsr a
  lsr a
  sta i3                  ; depth step 0..63
  ora star_plo,x
  sta i1
  lda star_phi,x
  sta i2
  ldy #0
  lda (i1),y
  cmp #$80
  beq @gone
  clc
  adc #128
  sta i4
  lda i2
  clc
  adc #$10                ; star_offy = star_offx + 4096
  sta i2
  lda (i1),y
  cmp #$80
  beq @gone
  clc
  adc star_cy
  cmp star_ymax
  bcs @gone
  ldy i0
  sta oam,y
  lda i4
  sta oam+3,y
  ldx i3
  lda star_tile,x
  ldx i5
  sta oam+1,y
  lda #0
  sta oam+2,y
  tya
  clc
  adc #4
  sta i0
  inx
  jmp @l
@gone:
  lda #$FF                ; respawn next frame
  sta star_z,x
  inx
  jmp @l
@hide:
  ldx i0
  beq @done
  lda #$F8
: sta oam,x
  inx
  inx
  inx
  inx
  bne :-
@done:
  pla
  sta a_bank
  sta MMC5_PRGA
  rts

stars_init:
  ldx #39
: jsr rand
  sta star_z,x
  and #63
  sta star_r,x
  jsr star_ptr
  dex
  bpl :-
  rts

; star_plo/phi for star X from its ray
star_ptr:
  lda star_r,x
  and #3
  lsr a
  ror a
  ror a
  sta star_plo,x
  lda star_r,x
  lsr a
  lsr a
  clc
  adc #>star_offx
  sta star_phi,x
  rts

.segment "RODATA"
ring_cols: .byte $0A, $04, $0F, $0A, $04, $0F
star_tile:
  .res 26, 1
  .res 16, 2
  .res 12, 3
  .res 10, 4

.segment "CODEC"

; =====================================================================================
;  Main-thread side (bank B00 at $8000)
; =====================================================================================
.segment "B00"

; One vector frame: wait until vec_drawbank is neither waiting for upload nor being
; uploaded, clear it, run the scene (ptr2), publish it and move to the other bank.
vec_frame:
@w:
  lda vec_ready
  beq :+
  lda vec_readybank
  cmp vec_drawbank
  beq @w
: lda vec_active
  beq @go
  lda vec_upbank
  cmp vec_drawbank
  beq @w
@go:
  lda vec_drawbank
  sta ram_bank
  sta MMC5_PRG6
  jsr vec_clear
  lda #15
  sta cur_cmin
  lda #0
  sta cur_cmax
  lda #95
  sta cur_ymin
  jsr @scene
  ldx vec_drawbank
  lda cur_cmin
  sta bb_cmin,x
  lda cur_cmax
  sta bb_cmax,x
  lda cur_ymin
  sta bb_ymin,x
  stx vec_readybank
  lda #1
  sta vec_ready
  txa
  eor #1
  sta vec_drawbank
  rts
@scene:
  jmp (ptr2)

; Clear what was drawn into this bitmap last time: columns bb_cmin..bb_cmax, rows bb_ymin..95,
; through the unrolled per-column stores in B20.
vec_clear:
  ldx vec_drawbank
  lda bb_cmin,x
  cmp bb_cmax,x
  beq :+
  bcs @none
: sta t0
  lda bb_cmax,x
  sta t1
  lda bb_ymin,x
  sta t2
  asl a
  adc t2
  sta t2                  ; row * 3 (sta abs = 3 bytes)
  SET_BANKA 20
@c:
  ldx t0
  lda clr_entry_lo,x
  clc
  adc t2
  sta lvec
  lda clr_entry_hi,x
  adc #0
  sta lvec+1
  lda #0
  jsr @go
  inc t0
  lda t1
  cmp t0
  bcs @c
@none:
  rts
@go:
  jmp (lvec)

; Grow the current extent by the point (A = x, Y = y), both on the bitmap.
vec_extent:
  lsr a
  lsr a
  lsr a
  cmp cur_cmin
  bcs :+
  sta cur_cmin
: cmp cur_cmax
  bcc :+
  sta cur_cmax
: cpy cur_ymin
  bcs :+
  sty cur_ymin
: rts

; ------------------------------------------------------------------ object loading
; Load the object at (optr): counts, magnitudes, vertex codes (to ExRAM), list pointers.
vec_load:
  ldy #0
  lda (optr),y
  sta o_nv
  iny
  lda (optr),y
  sta o_ne
  iny
  lda (optr),y
  sta o_nf
  iny
  lda (optr),y
  sta o_nmag
  ldx #0
: iny
  lda (optr),y
  sta mags,x
  inx
  cpx o_nmag
  bne :-
  iny
  lda (optr),y
  sta o_nnmag
  beq @nn
  ldx #0
: iny
  lda (optr),y
  sta nmags,x
  inx
  cpx o_nnmag
  bne :-
@nn:
  ldx #0
: iny
  lda (optr),y
  sta vcx,x
  iny
  lda (optr),y
  sta vcy,x
  iny
  lda (optr),y
  sta vcz,x
  inx
  cpx o_nv
  bne :-
  iny
  tya
  clc
  adc optr
  sta o_edges
  lda optr+1
  adc #0
  sta o_edges+1
  lda o_ne                ; faces follow 2 * ne bytes of edges
  asl a
  clc
  adc o_edges
  sta o_faces
  lda o_edges+1
  adc #0
  sta o_faces+1
  rts

; ------------------------------------------------------------------ matrix
; mat = zoom/128 * Rz(ang_z) Ry(ang_y) Rx(ang_x), s.7 entries (row-major).
vec_matrix:
  ldx ang_x
  lda sin8,x
  sta vt                  ; sa
  txa
  clc
  adc #64
  tax
  lda sin8,x
  sta vt+1                ; ca
  ldx ang_y
  lda sin8,x
  sta t0                  ; sb
  txa
  clc
  adc #64
  tax
  lda sin8,x
  sta t1                  ; cb
  ldx ang_z
  lda sin8,x
  sta t2                  ; sc
  txa
  clc
  adc #64
  tax
  lda sin8,x
  sta t3                  ; cc
  ; products
  lda t0
  ldy vt
  jsr smul7
  sta t4                  ; sb*sa
  lda t0
  ldy vt+1
  jsr smul7
  sta t5                  ; sb*ca
  lda t1
  ldy vt
  jsr smul7
  sta t6                  ; cb*sa
  lda t1
  ldy vt+1
  jsr smul7
  sta t7                  ; cb*ca
  ; row 0: cc*cb, cc*sb*sa - sc*ca, cc*sb*ca + sc*sa
  lda t3
  ldy t1
  jsr smul7
  sta mat+0
  lda t3
  ldy t4
  jsr smul7
  sta t8
  lda t2
  ldy vt+1
  jsr smul7
  eor #$FF
  sec
  adc t8
  sta mat+1
  lda t3
  ldy t5
  jsr smul7
  sta t8
  lda t2
  ldy vt
  jsr smul7
  clc
  adc t8
  sta mat+2
  ; row 1: sc*cb, sc*sb*sa + cc*ca, sc*sb*ca - cc*sa
  lda t2
  ldy t1
  jsr smul7
  sta mat+3
  lda t2
  ldy t4
  jsr smul7
  sta t8
  lda t3
  ldy vt+1
  jsr smul7
  clc
  adc t8
  sta mat+4
  lda t2
  ldy t5
  jsr smul7
  sta t8
  lda t3
  ldy vt
  jsr smul7
  eor #$FF
  sec
  adc t8
  sta mat+5
  ; row 2: -sb, cb*sa, cb*ca
  lda t0
  eor #$FF
  clc
  adc #1
  sta mat+6
  lda t6
  sta mat+7
  lda t7
  sta mat+8
  ; zoom
  ldx #8
: stx t9
  lda mat,x
  ldy zoom
  jsr smul7z
  ldx t9
  sta mat,x
  dex
  bpl :-
  rts

; Product tables: tabT[16*j + code] = mat[j] * value(code) >> 7.
vec_tables:
  ldx #0                  ; j
@j:
  stx t9
  txa
  asl a
  asl a
  asl a
  asl a
  sta t10                 ; 16*j
  tay
  lda #0
  sta tabT,y              ; code 0
  lda #1
  sta t11                 ; code
@m:
  lda t11
  cmp o_nmag
  beq :+
  bcs @next
: ldx t11
  lda mags-1,x
  ldx t9
  ldy mat,x
  jsr smul7
  sta t8
  lda t10
  clc
  adc t11
  tax
  lda t8
  sta tabT,x
  txa
  clc
  adc o_nmag
  tax
  lda t8
  eor #$FF
  clc
  adc #1
  sta tabT,x
  inc t11
  jmp @m
@next:
  ldx t9
  inx
  cpx #9
  beq :+
  jmp @j
: ; normals: tabN[16*j + code] = mat[6+j] * nmag(code) >> 7
  ldx #0
@nj:
  stx t9
  txa
  asl a
  asl a
  asl a
  asl a
  sta t10
  tay
  lda #0
  sta tabN,y
  lda #1
  sta t11
@nm:
  lda t11
  cmp o_nnmag
  beq :+
  bcs @nnext
: ldx t11
  lda nmags-1,x
  ldx t9
  ldy mat+6,x
  jsr smul7
  sta t8
  lda t10
  clc
  adc t11
  tax
  lda t8
  sta tabN,x
  txa
  clc
  adc o_nnmag
  tax
  lda t8
  eor #$FF
  clc
  adc #1
  sta tabN,x
  inc t11
  jmp @nm
@nnext:
  ldx t9
  inx
  cpx #3
  bne @nj
  rts

; ------------------------------------------------------------------ transform + project
; For each vertex: rotated x', y', z' by table sums, then sx = 64 + x'*k(z')/128 (16-bit).
vec_xform:
  ldx #0
@v:
  stx t9
  ; z'
  ldy vcx,x
  lda tabT+16*6,y
  ldy vcy,x
  clc
  adc tabT+16*7,y
  ldy vcz,x
  clc
  adc tabT+16*8,y
  sta psz,x
  tay
  lda persp,y
  sta MMC5_MULB           ; k (stays for x and y)
  ; x'
  ldy vcx,x
  lda tabT+16*0,y
  ldy vcy,x
  clc
  adc tabT+16*1,y
  ldy vcz,x
  clc
  adc tabT+16*2,y
  jsr @proj
  clc
  adc #64
  sta psx_lo,x
  lda t11
  adc #0
  sta psx_hi,x
  ; y'
  ldy vcx,x
  lda tabT+16*3,y
  ldy vcy,x
  clc
  adc tabT+16*4,y
  ldy vcz,x
  clc
  adc tabT+16*5,y
  jsr @proj
  clc
  adc #48
  sta psy_lo,x
  lda t11
  adc #0
  sta psy_hi,x
@off:
  inx
  cpx o_nv
  beq :+
  jmp @v
: rts
; signed A * k (MULB) >> 7 -> A (lo), t11 (hi, sign-extended)
@proj:
  sta t8
  bpl :+
  eor #$FF
  clc
  adc #1
: sta MMC5_MULA
  lda MMC5_MULA
  asl a
  lda MMC5_MULB
  rol a
  ldy #0
  bit t8
  bpl :+
  eor #$FF
  clc
  adc #1
  ldy #$FF
  cmp #0
  bne :+
  ldy #0
: sty t11
  rts

; ------------------------------------------------------------------ visibility
; eflag[e] = 1 for every edge of a front-facing face (all edges if the object has no faces).
; A face faces the camera (at z = -256) when 64 s n'z + 64 s^2 d / 256 < 0 (s = zoom / 128).
vec_cull:
  ldx o_ne
  lda o_nf
  bne @faces
  lda #1
: dex
  bmi @r
  sta eflag,x
  bpl :-
@r:
  rts
@faces:
  lda #0
: dex
  bmi :+
  sta eflag,x
  bpl :-
: lda o_faces
  sta ptr0
  lda o_faces+1
  sta ptr0+1
  lda o_nf
  sta t10
  lda zoom                ; threshold = 64 s^2 d / 256 = ((zoom^2 >> 8) * d) >> 8
  sta MMC5_MULA
  sta MMC5_MULB
  lda MMC5_MULB
  sta MMC5_MULA
@f:
  ldy #3
  lda (ptr0),y            ; d
  sta MMC5_MULB
  lda MMC5_MULB
  sta t8
  ldy #1
  lda (ptr0),y
  tax
  ldy #2
  lda (ptr0),y
  tay
  lda tabN+16,x
  clc
  adc tabN+32,y
  ldy #0
  sta t9
  lda (ptr0),y
  tax
  lda tabN,x
  clc
  adc t9
  clc
  adc t8
  bpl @skip
  ldy #4
  lda (ptr0),y
  tax
: iny
  lda (ptr0),y
  sty t7
  tay
  lda #1
  sta eflag,y
  ldy t7
  dex
  bne :-
  jmp @adv
@skip:
  ldy #4
  lda (ptr0),y
  clc
  adc #4
  tay
@adv:
  iny
  tya
  clc
  adc ptr0
  sta ptr0
  bcc :+
  inc ptr0+1
: dec t10
  beq :+
  jmp @f
: rts

; ------------------------------------------------------------------ edges
vec_edges:
  lda o_edges
  sta ptr0
  lda o_edges+1
  sta ptr0+1
  ldx #0
@e:
  stx t10
  lda eflag,x
  beq @n
  txa
  asl a
  tay
  lda (ptr0),y
  tax
  iny
  lda (ptr0),y
  tay
  jsr vec_seg
@n:
  ldx t10
  inx
  cpx o_ne
  bne @e
  rts

; Draw the segment between projected vertices X and Y, clipped to the 128 x 96 window by
; midpoint subdivision (rare: only when the object reaches past the window).
vec_seg:
  lda psx_lo,x
  sta cx0
  lda psx_hi,x
  sta cx0+1
  lda psy_lo,x
  sta cy0
  lda psy_hi,x
  sta cy0+1
  lda psx_lo,y
  sta cx1
  lda psx_hi,y
  sta cx1+1
  lda psy_lo,y
  sta cy1
  lda psy_hi,y
  sta cy1+1
  jsr @in0
  rol t11
  jsr @in1
  rol t11                 ; bit1 = p0 outside, bit0 = p1 outside
  lda t11
  and #3
  bne @clip
@draw:
  lda cx0
  sta lx0
  lda cy0
  sta ly0
  lda cx1
  sta lx1
  lda cy1
  sta ly1
  lda lx0
  ldy ly0
  jsr vec_extent
  lda lx1
  ldy ly1
  jsr vec_extent
  jmp vline
@clip:
  ; trivial reject: both on the outer side of the same edge
  lda cx0+1
  and cx1+1
  bmi @rej                ; both x < 0
  lda cy0+1
  and cy1+1
  bmi @rej
  jsr @xbig0
  bcc :+
  jsr @xbig1
  bcs @rej
: jsr @ybig0
  bcc :+
  jsr @ybig1
  bcs @rej
: lda t11
  and #3
  cmp #3
  bne @one
  ; both outside: look for an inside point at 1/2
  jsr @mid
  jsr @inm
  bcs @rej
  ; clip p0 towards m, then p1 towards m
  jsr @save_m
  jsr @bs0
  jsr @load_m
  jsr @bs1
  jmp @draw
@one:
  cmp #2
  bne :+
  lda cx1                 ; p0 outside: search from p1
  sta cmx
  lda cx1+1
  sta cmx+1
  lda cy1
  sta cmy
  lda cy1+1
  sta cmy+1
  jsr @bs0
  jmp @draw
: lda cx0
  sta cmx
  lda cx0+1
  sta cmx+1
  lda cy0
  sta cmy
  lda cy0+1
  sta cmy+1
  jsr @bs1
  jmp @draw
@rej:
  rts

; C=1 if p is outside
@in0:
  lda cx0+1
  bne @out
  lda cx0
  bmi @out
  lda cy0+1
  bne @out
  lda cy0
  cmp #96
  rts
@in1:
  lda cx1+1
  bne @out
  lda cx1
  bmi @out
  lda cy1+1
  bne @out
  lda cy1
  cmp #96
  rts
@inm:
  lda cmx+1
  bne @out
  lda cmx
  bmi @out
  lda cmy+1
  bne @out
  lda cmy
  cmp #96
  rts
@out:
  sec
  rts
; C=1 if x >= 128 (16-bit, positive)
@xbig0:
  lda cx0+1
  bmi :+
  bne @out
  lda cx0
  cmp #128
  rts
: clc
  rts
@xbig1:
  lda cx1+1
  bmi :+
  bne @out
  lda cx1
  cmp #128
  rts
: clc
  rts
@ybig0:
  lda cy0+1
  bmi :+
  bne @out
  lda cy0
  cmp #96
  rts
: clc
  rts
@ybig1:
  lda cy1+1
  bmi :+
  bne @out
  lda cy1
  cmp #96
  rts
: clc
  rts
; m = (p0 + p1) / 2
@mid:
  clc
  lda cx0
  adc cx1
  sta cmx
  lda cx0+1
  adc cx1+1
  cmp #$80
  ror a
  sta cmx+1
  ror cmx
  clc
  lda cy0
  adc cy1
  sta cmy
  lda cy0+1
  adc cy1+1
  cmp #$80
  ror a
  sta cmy+1
  ror cmy
  rts
@save_m:
  lda cmx
  sta vt
  lda cmx+1
  sta vt+1
  lda cmy
  sta vt+2
  lda cmy+1
  sta vt+3
  rts
@load_m:
  lda vt
  sta cmx
  lda vt+1
  sta cmx+1
  lda vt+2
  sta cmy
  lda vt+3
  sta cmy+1
  rts
; binary search: p0 (outside) towards m (inside) -> p0 = last inside point
@bs0:
  lda #9
  sta t9
@b0:
  ; q = (p0 + m) / 2
  clc
  lda cx0
  adc cmx
  sta t0
  lda cx0+1
  adc cmx+1
  cmp #$80
  ror a
  sta t1
  ror t0
  clc
  lda cy0
  adc cmy
  sta t2
  lda cy0+1
  adc cmy+1
  cmp #$80
  ror a
  sta t3
  ror t2
  ; inside?
  lda t1
  bne @o0
  lda t0
  bmi @o0
  lda t3
  bne @o0
  lda t2
  cmp #96
  bcs @o0
  lda t0                  ; inside: m = q
  sta cmx
  lda t1
  sta cmx+1
  lda t2
  sta cmy
  lda t3
  sta cmy+1
  jmp @n0
@o0:
  lda t0                  ; outside: p0 = q
  sta cx0
  lda t1
  sta cx0+1
  lda t2
  sta cy0
  lda t3
  sta cy0+1
@n0:
  dec t9
  bne @b0
  lda cmx
  sta cx0
  lda cmx+1
  sta cx0+1
  lda cmy
  sta cy0
  lda cmy+1
  sta cy0+1
  rts
@bs1:
  lda #9
  sta t9
@b1:
  clc
  lda cx1
  adc cmx
  sta t0
  lda cx1+1
  adc cmx+1
  cmp #$80
  ror a
  sta t1
  ror t0
  clc
  lda cy1
  adc cmy
  sta t2
  lda cy1+1
  adc cmy+1
  cmp #$80
  ror a
  sta t3
  ror t2
  lda t1
  bne @o1
  lda t0
  bmi @o1
  lda t3
  bne @o1
  lda t2
  cmp #96
  bcs @o1
  lda t0
  sta cmx
  lda t1
  sta cmx+1
  lda t2
  sta cmy
  lda t3
  sta cmy+1
  jmp @n1
@o1:
  lda t0
  sta cx1
  lda t1
  sta cx1+1
  lda t2
  sta cy1
  lda t3
  sta cy1+1
@n1:
  dec t9
  bne @b1
  lda cmx
  sta cx1
  lda cmx+1
  sta cx1+1
  lda cmy
  sta cy1
  lda cmy+1
  sta cy1+1
  rts

; ------------------------------------------------------------------ the line drawer
; (lx0,ly0)-(lx1,ly1), inclusive, x 0..127, y 0..95.
vline:
  lda lx1
  cmp lx0
  bcs :+
  ldx lx0
  sta lx0
  stx lx1
  lda ly0
  ldx ly1
  sta ly1
  stx ly0
: lda lx1
  sec
  sbc lx0
  sta lmaj                ; dx
  lda ly1
  sec
  sbc ly0
  bcs @down
  eor #$FF
  adc #1                  ; dy = -dy (C was 0)
  sta lmin
  cmp lmaj
  bcc @xup
  beq @xup
  ; y-major going up: start at (x1, y1), y increases, x decreases
  sta lmaj
  lda lx1
  sec
  sbc lx0
  sta lmin
  ldx lx1
  ldy ly1
  lda #<yl_tab
  sta t0
  lda #>yl_tab
  sta t1
  jmp @ymaj
@xup:
  lda #<xu_tab
  sta t0
  lda #>xu_tab
  sta t1
  jmp @xmaj
@down:
  sta lmin
  cmp lmaj
  bcc @xdown
  beq @xdown
  sta lmaj                ; y-major going down: start at (x0, y0), x increases
  lda lx1
  sec
  sbc lx0
  sta lmin
  ldx lx0
  ldy ly0
  lda #<yr_tab
  sta t0
  lda #>yr_tab
  sta t1
  jmp @ymaj
@xdown:
  lda #<xd_tab
  sta t0
  lda #>xd_tab
  sta t1
@xmaj:
  ldx lx0
  ldy ly0
@ymaj:
  ; X = start x, Y = start y, lmaj/lmin set, (t0) = block table
  txa
  lsr a
  lsr a
  lsr a
  sta t2
  txa
  and #7
  asl a
  sta t3
  ldx t2
  lda col_lo,x
  sta lptr
  lda col_hi,x
  sta lptr+1
  sty t2
  ldy t3
  lda (t0),y
  sta lvec
  iny
  lda (t0),y
  sta lvec+1
  lda lmaj
  lsr a
  sta lerr
  ldx lmaj
  inx                     ; pixel count
  ldy t2
  sec
  jmp (lvec)

.macro XBLOCK m, step
  .local skip
  lda (lptr),y
  ora #m
  sta (lptr),y
  dex
  bne :+
  rts
: lda lerr
  sbc lmin
  bcs skip
  adc lmaj
  step
skip:
  sta lerr
.endmacro

.macro YBLOCK m, self
  lda (lptr),y
  ora #m
  sta (lptr),y
  dex
  bne :+
  rts
: iny
  lda lerr
  sbc lmin
  sta lerr
  bcs self
  adc lmaj
  sta lerr
.endmacro

xd0: XBLOCK $80, iny
xd1: XBLOCK $40, iny
xd2: XBLOCK $20, iny
xd3: XBLOCK $10, iny
xd4: XBLOCK $08, iny
xd5: XBLOCK $04, iny
xd6: XBLOCK $02, iny
xd7: XBLOCK $01, iny
  lda lptr
  adc #95                 ; C=1: +96, the next column
  sta lptr
  bcc :+
  inc lptr+1
: sec
  jmp xd0

xu0: XBLOCK $80, dey
xu1: XBLOCK $40, dey
xu2: XBLOCK $20, dey
xu3: XBLOCK $10, dey
xu4: XBLOCK $08, dey
xu5: XBLOCK $04, dey
xu6: XBLOCK $02, dey
xu7: XBLOCK $01, dey
  lda lptr
  adc #95
  sta lptr
  bcc :+
  inc lptr+1
: sec
  jmp xu0

yr0: YBLOCK $80, yr0
yr1: YBLOCK $40, yr1
yr2: YBLOCK $20, yr2
yr3: YBLOCK $10, yr3
yr4: YBLOCK $08, yr4
yr5: YBLOCK $04, yr5
yr6: YBLOCK $02, yr6
yr7: YBLOCK $01, yr7
  lda lptr
  adc #95
  sta lptr
  bcc :+
  inc lptr+1
: sec
  jmp yr0

yl7: YBLOCK $01, yl7
yl6: YBLOCK $02, yl6
yl5: YBLOCK $04, yl5
yl4: YBLOCK $08, yl4
yl3: YBLOCK $10, yl3
yl2: YBLOCK $20, yl2
yl1: YBLOCK $40, yl1
yl0: YBLOCK $80, yl0
  lda lptr
  sbc #96                 ; C=1: the previous column
  sta lptr
  bcs :+
  dec lptr+1
: sec
  jmp yl7

xd_tab: .word xd0, xd1, xd2, xd3, xd4, xd5, xd6, xd7
xu_tab: .word xu0, xu1, xu2, xu3, xu4, xu5, xu6, xu7
yr_tab: .word yr0, yr1, yr2, yr3, yr4, yr5, yr6, yr7
yl_tab: .word yl0, yl1, yl2, yl3, yl4, yl5, yl6, yl7

; Draw the loaded object with the current angles and zoom.
vec_draw_object:
  jsr vec_matrix
  jsr vec_tables
  jsr vec_xform
  jsr vec_cull
  jsr vec_edges
  rts

.include "objects.inc"
