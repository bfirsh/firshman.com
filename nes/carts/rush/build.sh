#!/bin/sh
# Builds RUSH: assets, music, then ca65/ld65; copies the ROM to the site.
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 tools/assets.py
CHR=$(stat -c %s out/gen/chr.bin)
sed "s/CHR:    start = \$0,    size = \$[0-9A-F]*/CHR:    start = \$0,    size = $CHR/" rush.cfg > out/rush.cfg
python3 music/tools/dpcm.py -o music/dpcm.inc > /dev/null
python3 music/tools/compile.py music/song.txt -o music/song.inc > /dev/null
ca65 -g -I src -I out/gen --bin-include-dir out/gen -o out/main.o src/main.s
ca65 -g -I music -o out/music.o music/music.s
ld65 -C out/rush.cfg -o out/rush.nes --dbgfile out/rush.dbg -m out/rush.map out/main.o out/music.o
cp out/rush.nes ../../../src/components/ideas/cartridge/roms/rush.nes
ls -l out/rush.nes
