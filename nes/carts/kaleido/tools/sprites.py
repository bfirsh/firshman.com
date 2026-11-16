"""Sprite tiles: glints (four-pointed stars in five sizes) and round gems."""
import numpy as np


def star(size, diag=0.0):
    t = np.zeros((8, 8), np.uint8)
    c = 3.5
    for y in range(8):
        for x in range(8):
            dx, dy = abs(x - c), abs(y - c)
            ray = min(dx, dy)                       # distance to the cross arms
            along = max(dx, dy)
            v = 0
            if ray < 0.6 and along < size:
                v = 3 if along < size * 0.45 else 2 if along < size * 0.75 else 1
            if diag and abs(dx - dy) < 0.6 and along < diag:
                v = max(v, 1 if along > diag * 0.5 else 2)
            if dx < 1 and dy < 1:
                v = 3
            t[y, x] = v
    return t


def gem(r):
    t = np.zeros((8, 8), np.uint8)
    for y in range(8):
        for x in range(8):
            d = np.hypot(x - 3.5, y - 3.5)
            if d < r:
                hl = np.hypot(x - 2.6, y - 2.6)
                t[y, x] = 3 if hl < r * 0.35 else 2 if d < r * 0.7 else 1
    return t


def tiles():
    out = [np.zeros((8, 8), np.uint8)]                    # 0: blank
    out += [star(1.2), star(2.2), star(3.2, 1.5), star(4.2, 2.6), star(4.6, 3.6)]   # 1..5
    out += [gem(1.6), gem(2.6), gem(3.6)]                  # 6..8
    return out
