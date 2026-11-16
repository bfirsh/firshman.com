#!/usr/bin/env python3
"""Contact sheet of run.mjs frame dumps: contact.py <dir> <out.png> [cols] [scale]"""
import os, sys
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 5
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
files = sorted(f for f in os.listdir(d) if f.endswith('.png'))
w, h = int(256 * scale), int(240 * scale)
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 4), rows * (h + 16)), (40, 40, 40))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(d, f)).resize((w, h), Image.NEAREST)
    x, y = (i % cols) * (w + 4), (i // cols) * (h + 16)
    sheet.paste(im, (x, y + 14))
    dr.text((x + 2, y + 1), f[1:-4], fill=(255, 255, 0))
sheet.save(out)
