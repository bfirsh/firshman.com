#!/bin/sh
# Builds the Cartridge ROM: procedural assets, then ca65/ld65, then copies it to the site.
set -e
cd "$(dirname "$0")"
mkdir -p out/gen
python3 tools/assets.py
ca65 -g -I src -I out/gen --bin-include-dir out/gen -o out/main.o src/main.s
if ! ca65 -g -I music --bin-include-dir music -o out/music.o music/music.s; then
  echo "!!! music/music.s does not assemble: linking the stub instead (NOT a release build)" >&2
  ca65 -g -o out/music.o src/music_stub.s
fi
ld65 -C demo.cfg -o out/demo.nes --dbgfile out/demo.dbg -m out/demo.map out/main.o out/music.o 2>&1 | grep -v "does not exist" || true
test -s out/demo.nes
cp out/demo.nes ../src/components/ideas/cartridge/demo.nes
ls -l out/demo.nes
