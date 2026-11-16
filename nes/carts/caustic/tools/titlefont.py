"""The title, CAUSTIC, as sprites: thin original letterforms, 8 px wide and 16 px tall (two 8x8
tiles each), drawn with a bright core (colour 3) and a soft halo (colours 1-2)."""
import numpy as np

# 7 x 14 strokes ('#'), drawn inside an 8 x 16 cell with a one-pixel margin for the halo.
LETTERS = {
    'C': [
        "..####.",
        ".#....#",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        "#......",
        ".#....#",
        "..####.",
    ],
    'A': [
        "...#...",
        "...#...",
        "..#.#..",
        "..#.#..",
        "..#.#..",
        ".#...#.",
        ".#...#.",
        ".#...#.",
        ".#####.",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
    ],
    'U': [
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        "#.....#",
        ".#...#.",
        "..###..",
    ],
    'S': [
        ".#####.",
        "#.....#",
        "#......",
        "#......",
        "#......",
        ".#.....",
        "..###..",
        ".....#.",
        "......#",
        "......#",
        "......#",
        "......#",
        "#.....#",
        ".#####.",
    ],
    'T': [
        "#######",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
    ],
    'I': [
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
        "...#...",
    ],
}
ORDER = 'CAUSTI'


def cell(ch):
    g = np.array([[1 if c == '#' else 0 for c in row] for row in LETTERS[ch]], np.uint8)
    img = np.zeros((16, 8), np.uint8)
    img[1:15, 0:7] = g * 3
    # halo: orthogonal neighbours of the stroke get colour 1
    core = img == 3
    halo = np.zeros_like(core)
    halo[1:, :] |= core[:-1, :]
    halo[:-1, :] |= core[1:, :]
    halo[:, 1:] |= core[:, :-1]
    halo[:, :-1] |= core[:, 1:]
    img[(img == 0) & halo] = 1
    return img


def tile_bytes(t):
    p0 = [int(sum(((t[r, c] & 1) << (7 - c)) for c in range(8))) for r in range(8)]
    p1 = [int(sum((((t[r, c] >> 1) & 1) << (7 - c)) for c in range(8))) for r in range(8)]
    return bytes(p0) + bytes(p1)


def sprite_chr():
    """Tile 0 blank; letter i (ORDER) = tiles 2+2i (top) and 3+2i (bottom); then glints."""
    out = bytearray(32)
    for ch in ORDER:
        c = cell(ch)
        out += tile_bytes(c[:8]) + tile_bytes(c[8:])
    # glint sprites (sun sparkles): small soft stars of increasing size, tiles 14..17
    for r in range(4):
        t = np.zeros((8, 8), np.uint8)
        cx = cy = 3.5
        for y in range(8):
            for x in range(8):
                d = abs(x - cx) + abs(y - cy)
                dd = max(abs(x - cx), abs(y - cy))
                cross = (abs(x - cx) < 0.6 or abs(y - cy) < 0.6) and d < 1.5 + r
                if d < 0.9 + 0.4 * r:
                    t[y, x] = 3
                elif cross:
                    t[y, x] = 2
                elif dd < 1.2 + 0.3 * r:
                    t[y, x] = 1
        out += tile_bytes(t)
    return bytes(out)
