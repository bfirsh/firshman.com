#!/bin/sh
# Compile the song and build the music test harness ROM (test/music_test.nes).
set -e
cd "$(dirname "$0")"
python3 tools/compile.py song.txt -o song.inc --json test/build/expected.json
mkdir -p test/build
ca65 -g music.s -o test/build/music.o
ca65 -g test/harness.s -o test/build/harness.o
ld65 -C test/harness.cfg -m test/build/harness.map --dbgfile test/build/harness.dbg \
  test/build/harness.o test/build/music.o -o test/music_test.nes
echo "built test/music_test.nes"
