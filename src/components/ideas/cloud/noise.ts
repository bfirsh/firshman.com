// Small seeded PRNG and 3D gradient noise. No dependencies.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];

// Improved Perlin noise, roughly in [-1, 1].
export function makeNoise(rand: () => number) {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h: number, x: number, y: number, z: number) => {
    const g = (h % 12) * 3;
    return G3[g] * x + G3[g + 1] * y + G3[g + 2] * z;
  };
  return (x: number, y: number, z: number) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
    const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(dot(p[AA], x, y, z), dot(p[BA], x - 1, y, z), u), l(dot(p[AB], x, y - 1, z), dot(p[BB], x - 1, y - 1, z), u), v),
      l(l(dot(p[AA + 1], x, y, z - 1), dot(p[BA + 1], x - 1, y, z - 1), u), l(dot(p[AB + 1], x, y - 1, z - 1), dot(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}
