#!/bin/sh
# Builds the Groove cartridge: assets, music, ca65/ld65, then copies the ROM to the site.
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 tools/gen.py > out/gen.log
python3 music/tools/dpcm.py -o music/dpcm.inc > /dev/null
python3 music/tools/compile.py music/song.txt -o music/song.inc > /dev/null
ca65 -g -I src -I out/gen --bin-include-dir out/gen -o out/main.o src/main.s
ca65 -g -I music --bin-include-dir music -o out/music.o music/music.s
ld65 -C demo.cfg -o out/groove.nes --dbgfile out/groove.dbg -m out/groove.map out/main.o out/music.o 2>&1 | grep -v 'does not exist' || true
test -s out/groove.nes
cp out/groove.nes ../../../src/components/ideas/cartridge/roms/groove.nes
ls -l out/groove.nes
