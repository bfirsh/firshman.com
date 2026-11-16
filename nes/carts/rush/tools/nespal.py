"""The JSNES default NTSC palette (what the player renders) and colour helpers."""
import numpy as np

# Copied from the emulator's palette table so the pipeline quantises against the exact colours
# the ROM will be shown in. Stored there as 0xBBGGRR.
_JSNES = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000,
          0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000,
          0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000,
          0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]

RGB = np.array([[(c & 255), (c >> 8) & 255, (c >> 16) & 255] for c in _JSNES], dtype=np.float64)
BLACK = 0x0F
# Indices worth using (one black, no duplicates).
USABLE = [i for i in range(64) if (i & 15) < 13 or i in (0x2D, 0x3D)]
if 0x0F not in USABLE:
    USABLE.append(0x0F)


def emph(rgb, bits):
    """JSNES emphasis: each set bit (1=R,2=G,4=B) multiplies the other channels by 0.75."""
    f = np.ones(3)
    if bits & 1: f[1] *= .75; f[2] *= .75
    if bits & 2: f[0] *= .75; f[2] *= .75
    if bits & 4: f[0] *= .75; f[1] *= .75
    return np.floor(np.asarray(rgb) * f)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055) * 255.0


def lab(rgb):
    """sRGB 0-255 (..., 3) -> CIE Lab."""
    l = srgb_to_lin(rgb)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = l @ m.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], -1)
