/**
 * Display colour → pigment proportions.
 *
 * Used only where paint arrives without a recipe (legacy RGBA layers, colours
 * typed as HEX). The search runs through the real display pipeline
 * (`mixPaintProportionsRgb`) so the returned proportions reproduce the colour
 * as closely as the five paints allow — a metameric match when it exists.
 */

import {
  mixPaintProportionsRgb,
  rgbToOklab,
  type RGBColor,
} from "./colorScience";
import { PIGMENT_IDS } from "./types";

const PIGMENT_COUNT = PIGMENT_IDS.length;
const cache = new Map<number, Float32Array>();

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const normalise = (vector: Float32Array) => {
  let total = 0;
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = Math.max(0, vector[index]);
    total += vector[index];
  }
  if (total <= 0) {
    vector.fill(0);
    vector[PIGMENT_COUNT - 1] = 1;
    return vector;
  }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= total;
  return vector;
};

const proportionsRecipe = (vector: Float32Array) =>
  Object.fromEntries(
    PIGMENT_IDS.map((pigment, index) => [pigment, vector[index]]),
  );

const distanceSquared = (
  target: { l: number; a: number; b: number },
  vector: Float32Array,
) => {
  const rgb = mixPaintProportionsRgb(proportionsRecipe(vector));
  const lab = rgbToOklab(rgb);
  const dl = lab.l - target.l;
  const da = lab.a - target.a;
  const db = lab.b - target.b;
  return dl * dl + da * da + db * db;
};

/**
 * Returns normalised proportions in `PIGMENT_IDS` order. Results are cached
 * on a 6-bit-per-channel key, which is finer than the colour differences the
 * five-paint gamut can express.
 */
export function pigmentsFromRgb(rgb: RGBColor): Float32Array {
  const r = Math.round(clampUnit(rgb.r / 255) * 63);
  const g = Math.round(clampUnit(rgb.g / 255) * 63);
  const b = Math.round(clampUnit(rgb.b / 255) * 63);
  const key = (r << 12) | (g << 6) | b;
  const cached = cache.get(key);
  if (cached) return Float32Array.from(cached);

  const target = rgbToOklab({
    r: Math.round((r / 63) * 255),
    g: Math.round((g / 63) * 255),
    b: Math.round((b / 63) * 255),
  });

  // Seeds: every pure paint, a grey of matching lightness, and each chromatic
  // paint tinted/shaded to the target lightness.
  const seeds: Float32Array[] = [];
  for (let index = 0; index < PIGMENT_COUNT; index += 1) {
    const seed = new Float32Array(PIGMENT_COUNT);
    seed[index] = 1;
    seeds.push(seed);
  }
  const lightness = clampUnit(target.l);
  const grey = new Float32Array(PIGMENT_COUNT);
  grey[3] = 1 - lightness;
  grey[4] = lightness;
  seeds.push(normalise(grey));
  for (let index = 0; index < 3; index += 1) {
    const tint = new Float32Array(PIGMENT_COUNT);
    tint[index] = 0.5;
    tint[4] = lightness * 0.5;
    tint[3] = (1 - lightness) * 0.25;
    seeds.push(normalise(tint));
  }

  let best = seeds[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const seed of seeds) {
    const score = distanceSquared(target, seed);
    if (score < bestScore) {
      bestScore = score;
      best = seed;
    }
  }

  // Coordinate descent on the simplex with step halving.
  let step = 0.3;
  const trial = new Float32Array(PIGMENT_COUNT);
  while (step > 0.004) {
    let improved = false;
    for (let index = 0; index < PIGMENT_COUNT; index += 1) {
      for (const direction of [1, -1]) {
        trial.set(best);
        trial[index] += direction * step;
        if (trial[index] < 0) continue;
        normalise(trial);
        const score = distanceSquared(target, trial);
        if (score < bestScore - 1e-12) {
          bestScore = score;
          best = Float32Array.from(trial);
          improved = true;
        }
      }
    }
    if (!improved) step /= 2;
  }

  cache.set(key, best);
  return Float32Array.from(best);
}

/** Squared OKLab error of the best five-paint match; useful for tests. */
export function pigmentMatchError(rgb: RGBColor): number {
  const vector = pigmentsFromRgb(rgb);
  return Math.sqrt(distanceSquared(rgbToOklab(rgb), vector));
}
