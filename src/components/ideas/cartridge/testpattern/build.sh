#!/bin/sh
# Builds the player's CRT calibration ROM (dev only): ./build.sh -> testpattern.nes
set -e
cd "$(dirname "$0")"
node make.mjs
ca65 testpattern.s -o /tmp/testpattern.o
ld65 -C nrom.cfg /tmp/testpattern.o -o testpattern.nes
rm -f /tmp/testpattern.o
echo "testpattern.nes: $(wc -c < testpattern.nes) bytes"
