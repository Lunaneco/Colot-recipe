/**
 * Deterministic, tileable paper grain used by the pencil, watercolour and
 * dry-brush effects. The texture is generated once (no image assets) so it
 * behaves identically in the browser and in Node tests.
 */

export const PAPER_TEXTURE_SIZE = 256;

let cachedTexture: Float32Array | undefined;

const hash2 = (x: number, y: number, seed: number) => {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Periodic value noise: lattice of `cells` × `cells` over the tile. */
function valueNoise(cells: number, seed: number, target: Float32Array) {
  const size = PAPER_TEXTURE_SIZE;
  const cellSize = size / cells;
  for (let y = 0; y < size; y += 1) {
    const gy = y / cellSize;
    const y0 = Math.floor(gy);
    const ty = smooth(gy - y0);
    const y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x += 1) {
      const gx = x / cellSize;
      const x0 = Math.floor(gx);
      const tx = smooth(gx - x0);
      const x1 = (x0 + 1) % cells;
      const a = hash2(x0 % cells, y0 % cells, seed);
      const b = hash2(x1, y0 % cells, seed);
      const c = hash2(x0 % cells, y1, seed);
      const d = hash2(x1, y1, seed);
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      target[y * size + x] = top + (bottom - top) * ty;
    }
  }
}

/**
 * Returns the shared tile (values 0..1, mean ≈ 0.5). Three noise octaves give
 * the cold-pressed paper "tooth"; a fine hashed speckle adds fibre sparkle.
 */
export function paperTexture(): Float32Array {
  if (cachedTexture) return cachedTexture;
  const size = PAPER_TEXTURE_SIZE;
  const texture = new Float32Array(size * size);
  const scratch = new Float32Array(size * size);
  const octaves: Array<[cells: number, weight: number, seed: number]> = [
    [16, 0.42, 11],
    [32, 0.3, 29],
    [64, 0.18, 47],
  ];
  for (const [cells, weight, seed] of octaves) {
    valueNoise(cells, seed, scratch);
    for (let index = 0; index < texture.length; index += 1) {
      texture[index] += scratch[index] * weight;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      texture[index] += (hash2(x, y, 97) - 0.5) * 0.2;
    }
  }
  // Normalise to a stable 0..1 range so thresholds are predictable.
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of texture) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  const range = Math.max(1e-6, maximum - minimum);
  for (let index = 0; index < texture.length; index += 1) {
    texture[index] = (texture[index] - minimum) / range;
  }
  cachedTexture = texture;
  return texture;
}
