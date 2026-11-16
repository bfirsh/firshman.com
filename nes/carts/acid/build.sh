#!/bin/sh
# Builds the Acid cartridge: generated tables/code, the music, then ca65/ld65.
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 tools/gen_tables.py
python3 tools/gen_upload.py
python3 tools/gen_objects.py > /dev/null
python3 tools/gen_tunnel.py > /dev/null
python3 tools/gen_sprites.py
python3 tools/gen_shapes.py
python3 tools/gen_grid.py > /dev/null
python3 tools/gen_mouth.py > /dev/null
sh music/build.sh > /dev/null
ca65 -g -I src -I out/gen -o out/main.o src/main.s
ca65 -g -I music -o out/music.o music/music.s
ld65 -C acid.cfg -o out/acid.nes --dbgfile out/acid.dbg -m out/acid.map out/main.o out/music.o
mkdir -p ../../../src/components/ideas/cartridge/roms
cp out/acid.nes ../../../src/components/ideas/cartridge/roms/acid.nes
ls -l out/acid.nes
