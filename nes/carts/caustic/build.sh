#!/bin/sh
# Builds the Caustic ROM: precalc assets and generated code, music, then ca65/ld65.
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 tools/assets.py
python3 music/tools/compile.py music/song.txt -o music/song.inc --json out/expected.json
ca65 -g -I src -I out/gen --bin-include-dir out/gen -o out/main.o src/main.s
ca65 -g -I music --bin-include-dir music -o out/music.o music/music.s
ld65 -C demo.cfg -o out/caustic.nes --dbgfile out/caustic.dbg -m out/caustic.map out/main.o out/music.o
cp out/caustic.nes ../../../src/components/ideas/cartridge/roms/caustic.nes
ls -l out/caustic.nes
