#!/bin/sh
# Builds the Kaleido ROM: music data, procedural assets, then ca65/ld65; copies it to the site.
#   nes/carts/kaleido/build.sh [--no-assets]
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 music/tools/dpcm.py -o music/dpcm.inc > /dev/null
python3 music/tools/fugue.py > /dev/null
python3 music/tools/compile.py music/song.txt -o music/song.inc
if [ "$1" != "--no-assets" ] || [ ! -s out/gen/chr.bin ]; then python3 tools/assets.py; fi
ca65 -g -I src -I out/gen --bin-include-dir out/gen -o out/main.o src/main.s
ca65 -g -I music --bin-include-dir music -o out/music.o music/music.s
ld65 -C kaleido.cfg -o out/kaleido.nes --dbgfile out/kaleido.dbg -m out/kaleido.map out/main.o out/music.o
cp out/kaleido.nes ../../../src/components/ideas/cartridge/roms/kaleido.nes
ls -l out/kaleido.nes
