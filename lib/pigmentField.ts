/**
 * Pigment-space paint surface for the drawing and colouring canvases.
 *
 * Every pixel stores pigment *concentrations* (red, blue, yellow, black,
 * white — the same five paints as the mixing palette), the deposited paint
 * mass and its water content. The RGBA canvas the browser shows is derived
 * from this field with the same two-constant Kubelka–Munk colour engine that
 * the palette uses, so a colour painted over another colour ends up exactly
 * where a homogeneous wet mixture would put the same mass ratio. Dry undercoats
 * remain ordered optical films. No RGB averaging happens
 * anywhere in the paint path.
 *
 * The module is DOM-free so it can run in a worker or in Node tests.
 */

import {
  COVERAGE_RATE,
  PIGMENT_HIDING_POWER,
  coverageFromOpticalLoad,
  decodeSrgbByte,
  displayLinearColor,
  applySpectralFilm,
  blendSpectralSurface,
  cloneSpectralSurface,
  spectralSurfaceFromLinearRgb,
  spectralSurfaceToLinearRgb,
  mixPigmentVectorRgb,
  type RGBColor,
} from "./colorScience";
import type { ImageDataLike, PixelBounds } from "./paintEngine";
import { PAPER_TEXTURE_SIZE, paperTexture } from "./paperTexture";
import { sharedPaintFilmCache } from "./paintFilm";
import { PIGMENT_IDS, type PigmentId, type ExactPaint } from "./types";

export const PIGMENT_COUNT = PIGMENT_IDS.length;

/** Range of the legacy 16-bit mass storage. Larger masses use the lossless payload. */
export const MAX_PAINT_MASS = 6;

/** Default wet mixing enabled. Dry layers remain separate optical films. */
export const DEFAULT_WET_MIXING = 0.38;


const HIDING = Float32Array.from(
  PIGMENT_IDS.map((pigment) => PIGMENT_HIDING_POWER[pigment]),
);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const clampUnit = (value: number) => clamp(value, 0, 1);

export interface PigmentStratum {
  pigment: Float32Array;
  mass: number;
  opacity?: number;
  lighting?: number;
  children?: PigmentStratum[];
  body?: number;
}
const cloneStrata = (strata: readonly PigmentStratum[]): PigmentStratum[] => strata.map(layer => ({ ...layer, pigment: layer.pigment.slice(), children: layer.children ? cloneStrata(layer.children) : undefined }));
function scaleStratum(layer: PigmentStratum, scale: number) { layer.mass *= scale; for (const child of layer.children ?? []) scaleStratum(child, scale); }
function applyStratum(surface: ReturnType<typeof spectralSurfaceFromLinearRgb>, coat: PigmentStratum) {
  if (!coat.children?.length) { applySpectralFilm(surface, sharedPaintFilmCache.film(coat.pigment, coat.mass), coat.opacity ?? 1, coat.lighting ?? 1); return; }
  const below = (coat.opacity ?? 1) < 1 ? cloneSpectralSurface(surface) : undefined;
  for (const child of coat.children) applyStratum(surface, child);
  if (below) { blendSpectralSurface(below, surface, coat.opacity ?? 1); surface.reflectance.set(below.reflectance); surface.residual.set(below.residual); }
}

export interface PigmentField {
  readonly width: number;
  readonly height: number;
  /** `width × height × PIGMENT_COUNT` concentrations; sum to 1 where mass > 0. */
  readonly pigment: Float32Array;
  /** Paint mass per pixel. 1 = one full body-paint stroke. */
  readonly mass: Float32Array;
  /** Water content 0..1. Wet paint mixes, spreads and picks up; it dries. */
  readonly wetness: Float32Array;
  /**
   * Body 0..1: how much of the mass is paint film with physical thickness.
   * Body paint (1) stands up from the surface and casts relief; graphite,
   * marker ink and airbrush mist (≈0) sit flat in the paper.
   */
  readonly body: Float32Array;
  /** Ordered dry undercoats. Wet transport only moves the active surface film. */
  readonly glazes: Map<number, PigmentStratum[]>;
}

export function createPigmentField(width: number, height: number): PigmentField {
  const safeWidth = Math.max(1, Math.trunc(width));
  const safeHeight = Math.max(1, Math.trunc(height));
  return {
    width: safeWidth,
    height: safeHeight,
    pigment: new Float32Array(safeWidth * safeHeight * PIGMENT_COUNT),
    mass: new Float32Array(safeWidth * safeHeight),
    wetness: new Float32Array(safeWidth * safeHeight),
    body: new Float32Array(safeWidth * safeHeight),
    glazes: new Map(),
  };
}

/** Removes every trace of paint from one pixel. */
const clearPixel = (field: PigmentField, index: number) => {
  field.glazes.delete(index);
  field.mass[index] = 0;
  field.wetness[index] = 0;
  field.body[index] = 0;
  field.pigment.fill(0, index * PIGMENT_COUNT, (index + 1) * PIGMENT_COUNT);
};

export function clearPigmentField(field: PigmentField, bounds?: PixelBounds) {
  const area = bounds ? clipBounds(bounds, field) : fullBounds(field);
  if (!area) return;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      clearPixel(field, y * field.width + x);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Pigment vectors                                                          */
/* ------------------------------------------------------------------------ */

export type PigmentRatio = Partial<Record<PigmentId, number>>;

/** Normalised concentration vector in `PIGMENT_IDS` order. */
export function pigmentVectorFromRatio(ratio: PigmentRatio): Float32Array {
  const vector = new Float32Array(PIGMENT_COUNT);
  let total = 0;
  PIGMENT_IDS.forEach((pigment, index) => {
    const value = ratio[pigment];
    const safe = value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
    vector[index] = safe;
    total += safe;
  });
  if (total <= 0) return vector;
  for (let index = 0; index < PIGMENT_COUNT; index += 1) vector[index] /= total;
  return vector;
}

export function ratioFromPigmentVector(
  vector: ArrayLike<number>,
  offset = 0,
): Record<PigmentId, number> {
  return Object.fromEntries(
    PIGMENT_IDS.map((pigment, index) => [
      pigment,
      Math.max(0, vector[offset + index] ?? 0),
    ]),
  ) as Record<PigmentId, number>;
}

const hidingOfVector = (vector: ArrayLike<number>, offset = 0) => {
  let hiding = 0;
  for (let index = 0; index < PIGMENT_COUNT; index += 1) {
    hiding += vector[offset + index] * HIDING[index];
  }
  return hiding;
};

/** Optical load = mass × Σ concentration × hiding power. */
export function opticalLoadAt(field: PigmentField, index: number) {
  const mass = field.mass[index];
  if (mass <= 0) return 0;
  return mass * hidingOfVector(field.pigment, index * PIGMENT_COUNT);
}

export function coverageAt(field: PigmentField, index: number) {
  return coverageFromOpticalLoad(opticalLoadAt(field, index));
}

/** Mass a body-paint stroke needs to reach a given coverage. */
export function massForCoverage(coverage: number, pigment: ArrayLike<number>) {
  const hiding = Math.max(1e-6, hidingOfVector(pigment));
  const safe = clamp(coverage, 0, 0.9999);
  return safe <= 0 ? 0 : -Math.log(1 - safe) / COVERAGE_RATE / hiding;
}

/* ------------------------------------------------------------------------ */
/* Bounds helpers                                                           */
/* ------------------------------------------------------------------------ */

export function fullBounds(field: { width: number; height: number }): PixelBounds {
  return { x: 0, y: 0, width: field.width, height: field.height };
}

export function clipBounds(
  bounds: PixelBounds,
  field: { width: number; height: number },
): PixelBounds | null {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(field.width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(field.height, Math.ceil(bounds.y + bounds.height));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function unionBounds(
  a: PixelBounds | null | undefined,
  b: PixelBounds | null | undefined,
): PixelBounds | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function expandBounds(bounds: PixelBounds, amount: number): PixelBounds {
  const pad = Math.max(0, Math.ceil(amount));
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
}

/* ------------------------------------------------------------------------ */
/* Display colour cache                                                     */
/* ------------------------------------------------------------------------ */

/**
 * Concentrations are keyed on a square-root scale with 1024 levels per
 * channel (a 50-bit key, exact in a double). Colour is most sensitive to a
 * pigment when there is very little of it — a trace of red in white shifts
 * the mix far more than the same amount added to a saturated red — and the
 * square root spends its resolution exactly there: adjacent levels differ by
 * ΔE_OK < 0.01 across the whole range, so gradients never band.
 */
const QUANT_LEVELS = 1023;
const QUANT_BASE = QUANT_LEVELS + 1;
const quantiseLevel = (concentration: number) =>
  Math.round(Math.sqrt(clampUnit(concentration)) * QUANT_LEVELS);
const levelToConcentration = (level: number) => (level / QUANT_LEVELS) ** 2;
const packRgb = ({ r, g, b }: RGBColor) => (r << 16) | (g << 8) | b;

/**
 * Snaps a pigment vector onto the display grid used by the colour cache, so
 * callers can predict exactly which bytes a mixture renders with.
 */
export function quantisePigmentVector(
  pigment: ArrayLike<number>,
  offset = 0,
): Float32Array {
  const snapped = new Float32Array(PIGMENT_COUNT);
  for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
    snapped[channel] = levelToConcentration(
      quantiseLevel(pigment[offset + channel]),
    );
  }
  return snapped;
}

const EMPTY_KEY = -1;

/** Mixes the 50-bit key's halves so linear probing stays short. */
const hashKey = (key: number) => {
  const low = key >>> 0;
  const high = (key / 4294967296) >>> 0;
  let hash = Math.imul(low, 0x9e3779b1) ^ Math.imul(high ^ 0x7f4a7c15, 0x85ebca77);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  return hash >>> 0;
};

/** Open-addressed key → packed-colour table on flat typed arrays. */
class ColourTable {
  readonly keys: Float64Array;
  readonly values: Int32Array;
  readonly mask: number;
  count = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity).fill(EMPTY_KEY);
    this.values = new Int32Array(capacity);
    this.mask = capacity - 1;
  }

  /** Slot holding `key`, or -1. */
  find(key: number, hash: number): number {
    const { keys, mask } = this;
    let slot = hash & mask;
    for (;;) {
      const stored = keys[slot];
      if (stored === key) return slot;
      if (stored === EMPTY_KEY) return -1;
      slot = (slot + 1) & mask;
    }
  }

  insert(key: number, hash: number, value: number) {
    const { keys, mask } = this;
    let slot = hash & mask;
    while (keys[slot] !== EMPTY_KEY) slot = (slot + 1) & mask;
    keys[slot] = key;
    this.values[slot] = value;
    this.count += 1;
  }

  clear() {
    this.keys.fill(EMPTY_KEY);
    this.count = 0;
  }
}

/**
 * Concentration → display colour lookup. Identical paint always renders the
 * same bytes, so compositing never drifts. Two generations of a flat hash
 * table hold the working set (12 bytes per colour, no per-entry objects):
 * when the current generation fills up it becomes the previous one, whose
 * colours are still found and promoted, so a picture with more distinct
 * mixtures than one generation never re-evaluates every pixel on a redraw.
 */
export class PigmentColourCache {
  private current: ColourTable;
  private previous: ColourTable;
  /** Slots per generation once fully grown (tables stay at most half full). */
  private readonly maxCapacity: number;
  private readonly amounts = new Float64Array(PIGMENT_COUNT);

  /** `limit` is the number of colours one generation retains. */
  constructor(limit = 524_288) {
    let capacity = 1024;
    while (capacity < limit * 2) capacity *= 2;
    this.maxCapacity = capacity;
    // Tables start small and double as colours arrive, so a page that only
    // shows a few mixtures never pays for the full working set.
    this.current = new ColourTable(Math.min(capacity, 4096));
    this.previous = new ColourTable(Math.min(capacity, 4096));
  }

  /** Makes room in the current generation for one more colour. */
  private makeRoom() {
    const { current } = this;
    const capacity = current.mask + 1;
    if (current.count < capacity >> 1) return;
    if (capacity < this.maxCapacity) {
      const grown = new ColourTable(capacity * 2);
      const { keys, values } = current;
      for (let slot = 0; slot < keys.length; slot += 1) {
        const key = keys[slot];
        if (key !== EMPTY_KEY) grown.insert(key, hashKey(key), values[slot]);
      }
      this.current = grown;
      return;
    }
    const retired = this.previous;
    this.previous = current;
    if (retired.mask + 1 === capacity) {
      retired.clear();
      this.current = retired;
    } else {
      this.current = new ColourTable(capacity);
    }
  }

  /** Colours currently retained across both generations. */
  get size() {
    return this.current.count + this.previous.count;
  }

  lookup(pigment: ArrayLike<number>, offset = 0): number {
    const q0 = quantiseLevel(pigment[offset]);
    const q1 = quantiseLevel(pigment[offset + 1]);
    const q2 = quantiseLevel(pigment[offset + 2]);
    const q3 = quantiseLevel(pigment[offset + 3]);
    const q4 = quantiseLevel(pigment[offset + 4]);
    const key =
      (((q0 * QUANT_BASE + q1) * QUANT_BASE + q2) * QUANT_BASE + q3) * QUANT_BASE +
      q4;
    const hash = hashKey(key);
    const { current } = this;
    let slot = current.find(key, hash);
    if (slot >= 0) return current.values[slot];
    let packed: number;
    slot = this.previous.find(key, hash);
    if (slot >= 0) {
      packed = this.previous.values[slot];
    } else {
      const amounts = this.amounts;
      amounts[0] = levelToConcentration(q0);
      amounts[1] = levelToConcentration(q1);
      amounts[2] = levelToConcentration(q2);
      amounts[3] = levelToConcentration(q3);
      amounts[4] = levelToConcentration(q4);
      packed = packRgb(mixPigmentVectorRgb(amounts));
    }
    this.makeRoom();
    this.current.insert(key, hash, packed);
    return packed;
  }

  rgb(pigment: ArrayLike<number>, offset = 0): RGBColor {
    const packed = this.lookup(pigment, offset);
    return { r: packed >> 16, g: (packed >> 8) & 255, b: packed & 255 };
  }
}

export const sharedPigmentColourCache = new PigmentColourCache();

/* ------------------------------------------------------------------------ */
/* sRGB transfer                                                            */
/* ------------------------------------------------------------------------ */

/** sRGB byte → linear light, exact transfer function tabulated. */
const LINEAR_OF_BYTE = Float32Array.from({ length: 256 }, (_, byte) =>
  decodeSrgbByte(byte),
);

/**
 * Linear light → sRGB byte. Tabulated at 4096 levels on the square root of
 * the value (fine where the transfer curve is steep, near black) and
 * interpolated, so it is exact to well under half a display level.
 */
const ENCODE_STEPS = 4096;
const BYTE_OF_ROOT = Float32Array.from({ length: ENCODE_STEPS + 1 }, (_, i) => {
  const linear = (i / ENCODE_STEPS) ** 2;
  return linear <= 0.0031308
    ? 12.92 * linear * 255
    : (1.055 * linear ** (1 / 2.4) - 0.055) * 255;
});

/** Linear-light channel (0..1) → sRGB byte 0..255. */
export function linearToSrgbByte(linear: number): number {
  if (linear <= 0) return 0;
  if (linear >= 1) return 255;
  const position = Math.sqrt(linear) * ENCODE_STEPS;
  const index = Math.floor(position);
  const fraction = position - index;
  const low = BYTE_OF_ROOT[index];
  const high = BYTE_OF_ROOT[index + 1];
  return Math.round(low + (high - low) * fraction);
}

/** sRGB byte (0..255) → linear light 0..1. */
export const srgbByteToLinear = (byte: number) => LINEAR_OF_BYTE[byte & 255];

/* ------------------------------------------------------------------------ */
/* Rendering                                                                */
/* ------------------------------------------------------------------------ */

export interface RenderOptions {
  /**
   * Wet paint looks a little darker and richer until it dries: fraction of
   * linear-light reflectance removed at full wetness.
   */
  wetDarkening?: number;
  /**
   * Impasto relief: thick paint is lit from the top-left so ridges catch
   * light and the far edge of a stroke falls into shadow (0 = flat).
   */
  relief?: number;
  cache?: PigmentColourCache;
}

/** Default relief strength used by the canvases. */
export const DEFAULT_RELIEF = 0.6;
/** Default wet darkening (linear light) used by the canvases. */
export const DEFAULT_WET_DARKENING = 0.18;
/** Rendering reads one neighbour in every direction for the relief normal. */
export const RENDER_MARGIN = 1;

/**
 * Perceived paint thickness 0..1 from the body-paint mass: thin washes are
 * flat, a full body stroke stands up, thicker paint saturates.
 */
const reliefHeight = (mass: number, body: number) => {
  const t = clamp((mass * body - 0.18) / 0.7, 0, 1);
  return t * t * (3 - 2 * t);
};

// Light direction for the relief (unit vector, from the top-left).
const LIGHT_X = -0.55;
const LIGHT_Y = -0.835;
/**
 * Slope → linear-light shading gain; edges of a full stroke reach the cap.
 * Shading is a change of reflected light, so it multiplies linear values.
 */
const RELIEF_GAIN = 8;
const RELIEF_CAP = 0.55;

/**
 * Linear-light appearance of `bounds`: writes `r, g, b` (linear light,
 * 0..1) and coverage into `out`, four floats per pixel, row-major over the
 * bounds. Colour is the opaque Kubelka–Munk mix of the pixel's pigments
 * shaded by the relief of the paint surface and its wetness; coverage is the
 * thickness-dependent hiding of the paint. Pixels outside the field or
 * without paint get coverage 0.
 */
export function renderPigmentFieldLinear(
  field: PigmentField,
  out: Float32Array,
  bounds: PixelBounds,
  options: RenderOptions = {},
) {
  const cache = options.cache ?? sharedPigmentColourCache;
  const wetDarkening = clamp(options.wetDarkening ?? DEFAULT_WET_DARKENING, 0, 0.6);
  const relief = clamp(options.relief ?? DEFAULT_RELIEF, 0, 2);
  const { width, height, mass: masses, wetness, pigment, body } = field;
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row;
    for (let column = 0; column < bounds.width; column += 1) {
      const x = bounds.x + column;
      const target = (row * bounds.width + column) * 4;
      if (y < 0 || y >= height || x < 0 || x >= width) {
        out[target] = 0;
        out[target + 1] = 0;
        out[target + 2] = 0;
        out[target + 3] = 0;
        continue;
      }
      const index = y * width + x;
      const mass = masses[index];
      if (mass <= 1e-6) {
        out[target] = 0;
        out[target + 1] = 0;
        out[target + 2] = 0;
        out[target + 3] = 0;
        continue;
      }
      const alpha = coverageFromOpticalLoad(
        mass * hidingOfVector(pigment, index * PIGMENT_COUNT),
      );
      const packed = cache.lookup(pigment, index * PIGMENT_COUNT);
      let shade = 1 - wetDarkening * clampUnit(wetness[index]);
      if (relief > 0 && body[index] > 0.02) {
        // Central-difference slope of the paint thickness; the surface tilts
        // toward the light where paint thins out in the light's direction.
        const left = x > 0 ? reliefHeight(masses[index - 1], body[index - 1]) : 0;
        const right =
          x + 1 < width ? reliefHeight(masses[index + 1], body[index + 1]) : 0;
        const up = y > 0 ? reliefHeight(masses[index - width], body[index - width]) : 0;
        const down =
          y + 1 < height ? reliefHeight(masses[index + width], body[index + width]) : 0;
        const gx = (right - left) * 0.5;
        const gy = (down - up) * 0.5;
        // Wet paint is glossier and shows its relief a little more.
        const gloss = 1 + 0.25 * clampUnit(wetness[index]);
        const slope = clamp(
          (-gx * LIGHT_X - gy * LIGHT_Y) * RELIEF_GAIN,
          -RELIEF_CAP,
          RELIEF_CAP,
        );
        shade *= 1 + relief * gloss * slope;
      }
      out[target] = LINEAR_OF_BYTE[packed >> 16] * shade;
      out[target + 1] = LINEAR_OF_BYTE[(packed >> 8) & 255] * shade;
      out[target + 2] = LINEAR_OF_BYTE[packed & 255] * shade;
      out[target + 3] = alpha;
    }
  }
}

let linearScratch = new Float32Array(0);
const scratchFor = (pixels: number) => {
  if (linearScratch.length < pixels * 4) {
    linearScratch = new Float32Array(pixels * 4);
  }
  return linearScratch;
};

/**
 * Writes the RGBA appearance of `bounds` into `image` (which must have the
 * same width/height as `bounds`) as a stand-alone layer: sRGB colour with
 * straight alpha equal to the paint's coverage. Used for layer thumbnails
 * and stored previews; on-screen compositing goes through
 * `compositePigmentLayers` so the paper and the layers below are blended in
 * linear light rather than by the browser in gamma space.
 */
export function renderPigmentField(
  field: PigmentField,
  image: ImageDataLike,
  bounds: PixelBounds,
  options: RenderOptions = {},
) {
  const pixels = bounds.width * bounds.height;
  const linear = scratchFor(pixels);
  renderPigmentFieldLinear(field, linear, bounds, options);
  const { data } = image;
  for (let row = 0; row < bounds.height; row += 1) {
    for (let column = 0; column < bounds.width; column += 1) {
      const source = (row * bounds.width + column) * 4;
      const target = (row * image.width + column) * 4;
      const fi = (bounds.y + row) * field.width + bounds.x + column;
      if (field.glazes.has(fi)) {
        const preview = { width: 1, height: 1, data: data.subarray(target, target + 4) };
        compositePigmentLayers({ r: 247, g: 241, b: 230 }, [{ kind: "paint", field }], preview, { x: bounds.x + column, y: bounds.y + row, width: 1, height: 1 }, options);
        continue;
      }
      const alpha = linear[source + 3];
      if (alpha <= 0) {
        data[target] = 0;
        data[target + 1] = 0;
        data[target + 2] = 0;
        data[target + 3] = 0;
        continue;
      }
      data[target] = linearToSrgbByte(linear[source]);
      data[target + 1] = linearToSrgbByte(linear[source + 1]);
      data[target + 2] = linearToSrgbByte(linear[source + 2]);
      data[target + 3] = Math.round(alpha * 255);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Linear-light compositing                                                 */
/* ------------------------------------------------------------------------ */

/** A stacked layer: a pigment field, or a straight-alpha sRGB image. */
export type CompositeSource =
  | { kind: "paint"; field: PigmentField; opacity?: number; visible?: boolean }
  | { kind: "image"; image: ImageDataLike; opacity?: number; visible?: boolean };

/** What the layers sit on: a flat paper colour or an opaque sRGB image. */
export type CompositeBase = RGBColor | ImageDataLike;

const groundCache = new Map<string, ReturnType<typeof spectralSurfaceFromLinearRgb>>();
function spectralGround(rgb: RGBColor) {
  const key = `${rgb.r}:${rgb.g}:${rgb.b}`;
  let ground = groundCache.get(key);
  if (!ground) {
    ground = spectralSurfaceFromLinearRgb({ r: decodeSrgbByte(rgb.r), g: decodeSrgbByte(rgb.g), b: decodeSrgbByte(rgb.b) });
    if (groundCache.size > 4096) groundCache.clear();
    groundCache.set(key, ground);
  }
  return ground;
}
export function totalPaintMassAt(field: PigmentField, index: number) {
  return field.mass[index] + (field.glazes.get(index)?.reduce((sum, layer) => sum + layer.mass, 0) ?? 0);
}
function coatBodyMass(coat: PigmentStratum): number {
  if (!coat.children?.length) return coat.mass * (coat.body ?? 0);
  let total = 0;
  for (const child of coat.children) total += coatBodyMass(child);
  return total;
}
export function totalBodyMassAt(field: PigmentField, index: number) {
  let total = field.mass[index] * field.body[index];
  const coats = field.glazes.get(index);
  if (coats) for (const coat of coats) total += coatBodyMass(coat);
  return total;
}
export function totalPigmentMassAt(field: PigmentField, index: number, channel: number) {
  return field.mass[index] * field.pigment[index * PIGMENT_COUNT + channel] +
    (field.glazes.get(index)?.reduce((sum, layer) => sum + layer.mass * layer.pigment[channel], 0) ?? 0);
}
function surfaceLighting(field: PigmentField, index: number, options: RenderOptions) {
  const wet = clampUnit(field.wetness[index]);
  let shade = 1 - clamp(options.wetDarkening ?? DEFAULT_WET_DARKENING, 0, 0.6) * wet;
  const relief = clamp(options.relief ?? DEFAULT_RELIEF, 0, 2);
  const x = index % field.width, y = Math.floor(index / field.width);
  if (relief > 0 && totalBodyMassAt(field, index) > .02) {
    const heightAt = (i: number) => reliefHeight(totalBodyMassAt(field, i), 1);
    const left = x > 0 ? heightAt(index - 1) : 0;
    const right = x + 1 < field.width ? heightAt(index + 1) : 0;
    const up = y > 0 ? heightAt(index - field.width) : 0;
    const down = y + 1 < field.height ? heightAt(index + field.width) : 0;
    const slope = clamp((-(right - left) * .5 * LIGHT_X - (down - up) * .5 * LIGHT_Y) * RELIEF_GAIN, -RELIEF_CAP, RELIEF_CAP);
    shade *= 1 + relief * (1 + .25 * wet) * slope;
  }
  return 1 + (shade - 1) * coverageAt(field, index);
}

/** Capture the actual optical films, rather than replacing a thin tint with its masstone. */
export function samplePigmentLayers(base: CompositeBase, sources: readonly CompositeSource[], x: number, y: number, options: RenderOptions = {}) {
  const opticalStack: NonNullable<ExactPaint["opticalStack"]> = [];
  const toOptical = (coat: PigmentStratum): NonNullable<ExactPaint["opticalStack"]>[number] => ({ ...coat, pigment: Array.from(coat.pigment), children: coat.children?.map(toOptical) });
  for (const source of sources) {
    if (source.kind !== "paint" || source.visible === false || (source.opacity ?? 1) <= 0) continue;
    const field = source.field;
    if (x < 0 || y < 0 || x >= field.width || y >= field.height) continue;
    const index = y * field.width + x;
    const children = (field.glazes.get(index) ?? []).map(toOptical);
    if (field.mass[index] > 0) children.push({ pigment: Array.from(field.pigment.subarray(index * PIGMENT_COUNT, (index + 1) * PIGMENT_COUNT)), mass: field.mass[index], lighting: surfaceLighting(field, index, options) });
    if (!children.length) continue;
    if ((source.opacity ?? 1) === 1) { opticalStack.push(...children); continue; }
    const mass = children.reduce((sum, coat) => sum + coat.mass, 0);
    const pigment = Array.from({ length: PIGMENT_COUNT }, (_, p) => children.reduce((sum, coat) => sum + coat.mass * coat.pigment[p], 0) / mass);
    opticalStack.push({ pigment, mass, opacity: source.opacity, children });
  }
  const weights = { red: 0, blue: 0, yellow: 0, black: 0, white: 0, water: 0 };
  let opticalMass = 0;
  for (const coat of opticalStack) {
    opticalMass += coat.mass;
    PIGMENT_IDS.forEach((id, p) => { weights[id] += coat.mass * coat.pigment[p]; });
  }
  const pixel = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  compositePigmentLayers(base, sources, pixel, { x, y, width: 1, height: 1 }, options);
  return { rgb: { r: pixel.data[0], g: pixel.data[1], b: pixel.data[2] }, exactPaint: { weights, opticalMass, opticalStack } as ExactPaint };
}

/** Retain every measured wavelength through all ordered paint films; integrate once at output. */
export function compositePigmentLayers(base: CompositeBase, sources: readonly CompositeSource[], image: ImageDataLike, bounds: PixelBounds, options: RenderOptions = {}) {
  const visible = sources.filter(source => source.visible !== false && (source.opacity ?? 1) > 0);
  const flatGround = !("data" in base) ? spectralGround(base) : undefined;
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row;
    for (let column = 0; column < bounds.width; column += 1) {
      const x = bounds.x + column;
      const at = (row * image.width + column) * 4;
      const bi = "data" in base ? (y * base.width + x) * 4 : 0;
      const rgb = "data" in base ? { r: base.data[bi] ?? 0, g: base.data[bi + 1] ?? 0, b: base.data[bi + 2] ?? 0 } : base;
      let imageLinear: { r: number; g: number; b: number } | undefined;
      let surface: ReturnType<typeof spectralSurfaceFromLinearRgb> | undefined;
      let single: Extract<CompositeSource, {kind: "paint"}> | undefined;
      let singlePosition = -1;
      for (let position = 0; position < visible.length; position++) {
        const candidate = visible[position];
        if (candidate.kind !== "paint" || x < 0 || y < 0 || x >= candidate.field.width || y >= candidate.field.height) continue;
        const index = y * candidate.field.width + x;
        if (candidate.field.mass[index] <= 0 && !candidate.field.glazes.has(index)) continue;
        if (single) { single = undefined; break; }
        single = candidate; singlePosition = position;
      }
      if (single) {
        const field = single.field, index = y * field.width + x;
        if (!field.glazes.has(index)) {
          let red = LINEAR_OF_BYTE[rgb.r], green = LINEAR_OF_BYTE[rgb.g], blue = LINEAR_OF_BYTE[rgb.b];
          let changedGround = false;
          for (let position = 0; position < singlePosition; position++) {
            const below = visible[position];
            if (below.kind !== "image" || x < 0 || y < 0 || x >= below.image.width || y >= below.image.height) continue;
            const from = (y * below.image.width + x) * 4, pixels = below.image.data;
            const alpha = pixels[from + 3] / 255 * (below.opacity ?? 1);
            if (alpha <= 0) continue;
            changedGround = true;
            red += (LINEAR_OF_BYTE[pixels[from]] - red) * alpha; green += (LINEAR_OF_BYTE[pixels[from + 1]] - green) * alpha; blue += (LINEAR_OF_BYTE[pixels[from + 2]] - blue) * alpha;
          }
          const ground = changedGround ? spectralSurfaceFromLinearRgb({r:red,g:green,b:blue}) : flatGround ?? spectralGround(rgb);
          let imageAboveActive = false;
          for (let position = singlePosition + 1; position < visible.length; position++) {
            const above = visible[position];
            if (above.kind === "image" && x >= 0 && y >= 0 && x < above.image.width && y < above.image.height && above.image.data[(y * above.image.width + x) * 4 + 3] > 0) { imageAboveActive = true; break; }
          }
          const lighting = surfaceLighting(field, index, options);
          if (!imageAboveActive) {
            const shown = sharedPaintFilmCache.rgb(field.pigment, field.mass[index], ground, single.opacity ?? 1, lighting, index * PIGMENT_COUNT);
            image.data[at] = shown.r; image.data[at + 1] = shown.g; image.data[at + 2] = shown.b; image.data[at + 3] = 255;
            continue;
          }
          const linear = sharedPaintFilmCache.linear(field.pigment, field.mass[index], ground, single.opacity ?? 1, lighting, index * PIGMENT_COUNT);
          red = linear.r; green = linear.g; blue = linear.b;
          for (let position = singlePosition + 1; position < visible.length; position++) {
            const above = visible[position];
            if (above.kind !== "image" || x < 0 || y < 0 || x >= above.image.width || y >= above.image.height) continue;
            const from = (y * above.image.width + x) * 4, pixels = above.image.data;
            const alpha = pixels[from + 3] / 255 * (above.opacity ?? 1);
            if (alpha <= 0) continue;
            red += (LINEAR_OF_BYTE[pixels[from]] - red) * alpha; green += (LINEAR_OF_BYTE[pixels[from + 1]] - green) * alpha; blue += (LINEAR_OF_BYTE[pixels[from + 2]] - blue) * alpha;
          }
          const shown = displayLinearColor({r:red,g:green,b:blue});
          image.data[at] = linearToSrgbByte(shown.r); image.data[at + 1] = linearToSrgbByte(shown.g); image.data[at + 2] = linearToSrgbByte(shown.b); image.data[at + 3] = 255;
          continue;
        }
      }
      for (const source of sources) {
        const opacity = clampUnit(source.opacity ?? 1);
        if (source.visible === false || opacity <= 0) continue;
        if (source.kind === "paint") {
          const field = source.field;
          if (x < 0 || y < 0 || x >= field.width || y >= field.height) continue;
          const index = y * field.width + x;
          const coats = field.glazes.get(index);
          if (field.mass[index] <= 0 && !coats?.length) continue;
          surface ??= imageLinear ? spectralSurfaceFromLinearRgb(imageLinear) : cloneSpectralSurface(spectralGround(rgb));
          // Layer opacity is an area average of the whole layered field.
          const below = opacity < 1 ? cloneSpectralSurface(surface) : undefined;
          for (const coat of coats ?? []) applyStratum(surface, coat);
          if (field.mass[index] > 0) applySpectralFilm(surface, sharedPaintFilmCache.film(field.pigment, field.mass[index], index * PIGMENT_COUNT), 1, surfaceLighting(field, index, options));
          if (below) { blendSpectralSurface(below, surface, opacity); surface = below; }
        } else {
          const layer = source.image;
          if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) continue;
          const li = (y * layer.width + x) * 4;
          const alpha = layer.data[li + 3] / 255 * opacity;
          if (alpha <= 0) continue;
          const nextRgb = { r: layer.data[li], g: layer.data[li + 1], b: layer.data[li + 2] };
          if (surface) blendSpectralSurface(surface, spectralGround(nextRgb), alpha);
          else {
            imageLinear ??= { r: decodeSrgbByte(rgb.r), g: decodeSrgbByte(rgb.g), b: decodeSrgbByte(rgb.b) };
            imageLinear.r += (decodeSrgbByte(nextRgb.r) - imageLinear.r) * alpha;
            imageLinear.g += (decodeSrgbByte(nextRgb.g) - imageLinear.g) * alpha;
            imageLinear.b += (decodeSrgbByte(nextRgb.b) - imageLinear.b) * alpha;
          }
        }
      }
      const shown = surface ? spectralSurfaceToLinearRgb(surface) : imageLinear;
      image.data[at] = shown ? linearToSrgbByte(shown.r) : rgb.r;
      image.data[at + 1] = shown ? linearToSrgbByte(shown.g) : rgb.g;
      image.data[at + 2] = shown ? linearToSrgbByte(shown.b) : rgb.b;
      image.data[at + 3] = 255;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Brush reservoir (dirty brush / pick-up)                                  */
/* ------------------------------------------------------------------------ */

export interface BrushReservoir {
  /** Normalised pigment the bristles currently carry. */
  pigment: Float32Array;
  /** Amount of paint left on the brush, 0..1. */
  load: number;
  /** Water share carried by the brush. */
  wetness: number;
  /** Body (relief-bearing share) of the carried paint, 0..1. */
  body: number;
}

export function createBrushReservoir(
  pigment: Float32Array,
  load: number,
  wetness: number,
  body = 1,
): BrushReservoir {
  return {
    pigment: Float32Array.from(pigment),
    load: Math.max(0, load),
    wetness: clampUnit(wetness),
    body: clampUnit(body),
  };
}

export interface PickedPaint {
  pigment: Float32Array;
  /** Mass per unit area. */
  mass: number;
  totalMass?: number;
  wetness: number;
  body: number;
}

/**
 * Blend picked-up paint into the reservoir. `limit` caps the load (1 for a
 * normal brush; a mixer brush carries paint mass and may hold more).
 */
export function pickUpIntoReservoir(
  reservoir: BrushReservoir,
  picked: PickedPaint,
  amount: number,
  limit = 1,
) {
  const gained = clamp(amount, 0, Math.max(0, limit - reservoir.load));
  if (gained <= 0 || picked.mass <= 0) return;
  const current = reservoir.load;
  const total = current + gained;
  for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
    reservoir.pigment[channel] =
      (reservoir.pigment[channel] * current + picked.pigment[channel] * gained) /
      total;
  }
  reservoir.wetness =
    (reservoir.wetness * current + picked.wetness * gained) / total;
  reservoir.body = (reservoir.body * current + picked.body * gained) / total;
  reservoir.load = Math.min(limit, total);
}

/* ------------------------------------------------------------------------ */
/* Stamps                                                                   */
/* ------------------------------------------------------------------------ */

export interface StampShape {
  kind: "disc" | "rect";
  /**
   * Direction of travel in radians: orients a rect stamp and the bristle
   * streaks of any stamp.
   */
  angle?: number;
  /** Rect thickness along the travel direction relative to its width. */
  aspect?: number;
}

export interface GrainOptions {
  /** 0 = ignore paper, 1 = only the paper peaks receive paint. */
  strength: number;
  /** Pressure-like threshold: higher pressure fills more of the valleys. */
  fill?: number;
}

/**
 * Per-stroke record of the footprint share each pixel has already received.
 * A brush dragged over the paper leaves one film of paint, however densely
 * its stamps overlap: each stamp only adds what its coverage exceeds the
 * film by, so the cross-section of a stroke is the brush profile (flat with
 * soft edges) instead of a pile-up where stamps overlap.
 */
export interface StrokeFilm {
  width: number;
  height: number;
  /** 0..1 coverage reached so far at each pixel. */
  coverage: Float32Array;
}

export function createStrokeFilm(field: PigmentField): StrokeFilm {
  return {
    width: field.width,
    height: field.height,
    coverage: new Float32Array(field.width * field.height),
  };
}

export interface DepositOptions {
  pigment: ArrayLike<number>;
  /** Mass deposited at full coverage. */
  mass: number;
  wetness: number;
  /** Body (relief-bearing share) of the deposited paint, 0..1. Default 1. */
  body?: number;
  /** 0 = very soft edge, 1 = crisp. */
  hardness: number;
  shape?: StampShape;
  /** Per-stroke bristle density across the stamp (0..1 each). */
  bristles?: ArrayLike<number>;
  /** How strongly bristle streaks modulate the deposit (0..1). */
  bristleStrength?: number;
  grain?: GrainOptions;
  wetMixing?: number;
  massBudget?: number;
  onDeposit?: (actualMass: number) => void;
  opticalStack?: ExactPaint["opticalStack"];
  /**
   * Stroke film: when given, the stamp only deposits the coverage it adds
   * on top of what this stroke already laid down at each pixel.
   */
  film?: StrokeFilm;
}

function edgeCoverage(distance: number, hardness: number) {
  if (distance >= 1) return 0;
  const edge = clamp(1 - hardness, 0.02, 0.98);
  const inner = 1 - edge;
  if (distance <= inner) return 1;
  const t = (1 - distance) / edge;
  return t * t * (3 - 2 * t);
}

/** Pixel footprint a stamp of `radius` at (`cx`, `cy`) can touch. */
export function stampBounds(
  field: PigmentField,
  cx: number,
  cy: number,
  radius: number,
): PixelBounds | null {
  return clipBounds(
    {
      x: cx - radius - 1,
      y: cy - radius - 1,
      width: radius * 2 + 2,
      height: radius * 2 + 2,
    },
    field,
  );
}

/**
 * Deposits paint. Coverage falls off with the stamp shape, bristle streaks
 * and paper grain; the new paint hides the old in proportion to its optical
 * load and intermixes with whatever is still wet. Returns the dirty bounds.
 */
export function depositStamp(
  field: PigmentField,
  cx: number,
  cy: number,
  radius: number,
  options: DepositOptions,
): PixelBounds | null {
  if (radius <= 0 || options.mass <= 0) return null;
  const bounds = stampBounds(field, cx, cy, radius);
  if (!bounds) return null;

  const deposits: [number, number][] = [];
  const source = options.pigment;
  const sourceHiding = hidingOfVector(source);
  if (sourceHiding <= 0) return null;
  const sourceWetness = clampUnit(options.wetness);
  const sourceBody = clampUnit(options.body ?? 1);
  const wetMixing = clamp(options.wetMixing ?? DEFAULT_WET_MIXING, 0, 1);
  const shape = options.shape ?? { kind: "disc" };
  const angle = shape.angle ?? 0;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const aspect = clamp(shape.aspect ?? 0.5, 0.05, 1);
  const bristles = options.bristles;
  const bristleStrength = clamp(options.bristleStrength ?? 0, 0, 1);
  const grain = options.grain;
  const texture = grain && grain.strength > 0 ? paperTexture() : undefined;
  const grainFill = clampUnit(grain?.fill ?? 0.5);
  const film =
    options.film &&
    options.film.width === field.width &&
    options.film.height === field.height
      ? options.film.coverage
      : undefined;

  const { pigment, mass, wetness, body, width } = field;

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    const dy = y + 0.5 - cy;
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const dx = x + 0.5 - cx;
      let coverage: number;
      let across: number;
      if (shape.kind === "rect") {
        const along = dx * cosA + dy * sinA;
        across = -dx * sinA + dy * cosA;
        const u = Math.abs(across) / radius;
        const v = Math.abs(along) / (radius * aspect);
        if (u >= 1 || v >= 1) continue;
        coverage = edgeCoverage(Math.max(u, v ** 0.9), options.hardness);
      } else {
        const distance = Math.hypot(dx, dy) / radius;
        coverage = edgeCoverage(distance, options.hardness);
        // Bristle streaks run along the direction of travel.
        across = -dx * sinA + dy * cosA;
      }
      if (coverage <= 0) continue;

      if (bristles && bristleStrength > 0 && bristles.length > 0) {
        const position = clampUnit((across / radius + 1) / 2);
        const slot = position * (bristles.length - 1);
        const low = Math.floor(slot);
        const high = Math.min(bristles.length - 1, low + 1);
        const density =
          bristles[low] + (bristles[high] - bristles[low]) * (slot - low);
        coverage *= 1 - bristleStrength * (1 - density);
      }

      if (texture && grain) {
        const tx = ((x % PAPER_TEXTURE_SIZE) + PAPER_TEXTURE_SIZE) % PAPER_TEXTURE_SIZE;
        const ty = ((y % PAPER_TEXTURE_SIZE) + PAPER_TEXTURE_SIZE) % PAPER_TEXTURE_SIZE;
        const height = texture[ty * PAPER_TEXTURE_SIZE + tx];
        // Paint reaches the paper peaks first; pressure pushes it into the
        // valleys. `fill` = 1 covers everything, 0 only the highest tooth.
        const tooth = clampUnit((height - (1 - grainFill) * 1.15 + 0.15) / 0.3);
        coverage *= 1 - grain.strength * (1 - tooth);
      }
      if (coverage <= 1e-4) continue;

      const index = y * width + x;
      if (film) {
        // Only the coverage this stroke has not yet reached here is new paint.
        const reached = film[index];
        if (coverage <= reached + 1e-4) continue;
        film[index] = coverage;
        coverage -= reached;
      }
      deposits.push([index, options.mass * coverage]);
    }
  }
  const desired = deposits.reduce((sum, entry) => sum + entry[1], 0);
  const scale = desired > 0 ? Math.min(1, Math.max(0, options.massBudget ?? desired) / desired) : 0;
  let deposited = 0;
  for (const [index, requested] of deposits) {
    const sourceMass = requested * scale;
    if (sourceMass <= 0) continue;
    deposited += sourceMass;
    const offset = index * PIGMENT_COUNT;
    let destinationMass = mass[index];
    const dry = destinationMass > 0 && (wetness[index] <= .02 || wetMixing === 0 || options.opticalStack?.length);
    if (dry) {
      const coats = field.glazes.get(index) ?? [];
      coats.push({ pigment: pigment.slice(offset, offset + PIGMENT_COUNT), mass: destinationMass, body: body[index] });
      field.glazes.set(index, coats);
      destinationMass = 0;
      mass[index] = 0;
    }
    if (options.opticalStack?.length) {
      const coats = field.glazes.get(index) ?? [];
      const total = options.opticalStack.reduce((sum, coat) => sum + coat.mass, 0);
      const fromOptical = (coat: NonNullable<ExactPaint["opticalStack"]>[number]): PigmentStratum => ({ ...coat, pigment: Float32Array.from(coat.pigment), children: coat.children?.map(fromOptical) });
      for (const coat of options.opticalStack) { const copy = fromOptical(coat); scaleStratum(copy, sourceMass / total); coats.push(copy); }
      field.glazes.set(index, coats);
      pigment.fill(0, offset, offset + PIGMENT_COUNT);
      wetness[index] = 0;
      body[index] = 0;
      continue;
    }
    const combined = sourceMass + destinationMass;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      pigment[offset + channel] = (source[channel] * sourceMass + pigment[offset + channel] * destinationMass) / combined;
    }
    wetness[index] = (sourceWetness * sourceMass + wetness[index] * destinationMass) / combined;
    body[index] = (sourceBody * sourceMass + body[index] * destinationMass) / combined;
    mass[index] = combined;
  }
  options.onDeposit?.(deposited);
  return bounds;
}

/**
 * Lifts paint off the surface (eraser). With a stroke `film`, one pass of
 * the eraser removes `strength` of the paint once, however densely its
 * stamps overlap.
 */
export function eraseStamp(
  field: PigmentField,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  strength: number,
  film?: StrokeFilm,
): PixelBounds | null {
  const bounds = stampBounds(field, cx, cy, radius);
  if (!bounds || strength <= 0) return null;
  const amount = clampUnit(strength);
  const reached =
    film && film.width === field.width && film.height === field.height
      ? film.coverage
      : undefined;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      let coverage = edgeCoverage(
        Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius,
        hardness,
      );
      if (coverage <= 0) continue;
      const index = y * field.width + x;
      if (reached) {
        const previous = reached[index];
        if (coverage <= previous + 1e-4) continue;
        reached[index] = coverage;
        // Removing `amount` of the paint at coverage c, then the remaining
        // share up to c', leaves (1 - amount·c') of the original in total.
        coverage = (coverage - previous) / Math.max(1e-6, 1 - amount * previous);
      }
      const fraction = 1 - amount * coverage;
      for (const coat of field.glazes.get(index) ?? []) scaleStratum(coat, fraction);
      const remaining = field.mass[index] * fraction;
      if (remaining <= 0 && totalPaintMassAt(field, index) <= 0) {
        clearPixel(field, index);
      } else {
        field.mass[index] = remaining;
      }
    }
  }
  return bounds;
}

/**
 * Removes a share of the paint under a stamp and reports what was lifted.
 * A mixer brush calls this before depositing so paint is *moved*, not copied.
 */
export function liftStamp(
  field: PigmentField,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  share: number,
  maxMass = Infinity,
): PickedPaint & { bounds: PixelBounds | null } {
  const lifted = new Float32Array(PIGMENT_COUNT);
  const bounds = stampBounds(field, cx, cy, radius);
  const amount = clampUnit(share);
  if (!bounds || amount <= 0) {
    return { pigment: lifted, mass: 0, totalMass: 0, wetness: 0, body: 0, bounds: null };
  }
  let liftedMass = 0;
  let liftedWetness = 0;
  let liftedBody = 0;
  let area = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const coverage = edgeCoverage(
        Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius,
        hardness,
      );
      if (coverage <= 0) continue;
      area += coverage;
      const index = y * field.width + x;
      const mass = field.mass[index];
      if (mass <= 0) continue;
      // Wet paint moves easily; dry paint only smears a little.
      const mobility = 0.35 + 0.65 * clampUnit(field.wetness[index]);
      const removed = Math.min(mass * amount * coverage * mobility, Math.max(0, maxMass - liftedMass));
      liftedMass += removed;
      liftedWetness += field.wetness[index] * removed;
      liftedBody += field.body[index] * removed;
      const offset = index * PIGMENT_COUNT;
      for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
        lifted[channel] += field.pigment[offset + channel] * removed;
      }
      const remaining = mass - removed;
      field.mass[index] = Math.max(0, remaining);
    }
  }
  if (liftedMass > 0) {
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      lifted[channel] /= liftedMass;
    }
  }
  return {
    pigment: lifted,
    mass: area > 0 ? liftedMass / area : 0,
    totalMass: liftedMass,
    wetness: liftedMass > 0 ? liftedWetness / liftedMass : 0,
    body: liftedMass > 0 ? liftedBody / liftedMass : 0,
    bounds: liftedMass > 0 ? bounds : null,
  };
}

/**
 * Softens paint under a stamp by pulling each pixel toward its
 * neighbourhood average (blur / soft blending, no pick-up).
 *
 * The neighbourhood sums come from summed-area tables built once per stamp
 * over the snapshot, so the cost is O(stamp area) regardless of the blur
 * radius instead of O(area × radius²).
 */
export function smoothStamp(
  field: PigmentField,
  cx: number,
  cy: number,
  radius: number,
  strength: number,
): PixelBounds | null {
  const bounds = stampBounds(field, cx, cy, radius);
  if (!bounds || strength <= 0) return null;
  const mask = new Float64Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    mask[y * bounds.width + x] = edgeCoverage(Math.hypot(bounds.x + x + .5 - cx, bounds.y + y + .5 - cy) / radius, .2);
  }
  transportActivePaint(field, bounds, mask, clampUnit(strength), Math.max(1, Math.round(radius * .35)));

  return bounds;
}

/**
 * Fills a set of pixels (a flood-fill region) with paint. `mask` holds one
 * byte per pixel of `bounds`; non-zero entries are filled.
 */
export function fillPigmentRegion(
  field: PigmentField,
  bounds: PixelBounds,
  mask: Uint8Array,
  pigment: ArrayLike<number>,
  mass: number,
  wetness = 0,
  body = 1,
) {
  const area = clipBounds(bounds, field);
  if (!area) return;
  for (let row = 0; row < area.height; row += 1) {
    for (let column = 0; column < area.width; column += 1) {
      const maskIndex =
        (area.y - bounds.y + row) * bounds.width + (area.x - bounds.x + column);
      if (!mask[maskIndex]) continue;
      const index = (area.y + row) * field.width + area.x + column;
      const offset = index * PIGMENT_COUNT;
      for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
        field.pigment[offset + channel] = pigment[channel];
      }
      field.glazes.delete(index);
      field.mass[index] = Math.max(0, mass);
      field.wetness[index] = clampUnit(wetness);
      field.body[index] = clampUnit(body);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Watercolour settling and drying                                          */
/* ------------------------------------------------------------------------ */

export interface SettleOptions {
  /** Blur radius in pixels for pigment spreading inside the wet area. */
  diffusion: number;
  /** How much pigment migrates to the edge of the wet area (0..1). */
  edgeStrength: number;
  /**
   * Width in pixels of the rim that darkens as the wash dries; real blooms
   * scale with the size of the wash. Default 3.
   */
  edgeWidth?: number;
  /** Granulation: pigment settles into the paper tooth (0..1). */
  granulation?: number;
  /**
   * Film of the stroke that just ended: only paint this stroke wetted takes
   * part, so earlier washes nearby are not settled a second time.
   */
  film?: StrokeFilm;
}

/** In-place separable box sum over a `w × h` buffer (edges are clipped). */
const boxSumInPlace = (data: Float32Array | Float64Array, w: number, h: number, r: number) => {
  const scratch = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let running = 0;
    for (let x = 0; x < Math.min(w, r); x += 1) running += data[row + x];
    for (let x = 0; x < w; x += 1) {
      const enter = x + r;
      const leave = x - r - 1;
      if (enter < w) running += data[row + enter];
      if (leave >= 0) running -= data[row + leave];
      scratch[row + x] = running;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let running = 0;
    for (let y = 0; y < Math.min(h, r); y += 1) running += scratch[y * w + x];
    for (let y = 0; y < h; y += 1) {
      const enter = y + r;
      const leave = y - r - 1;
      if (enter < h) running += scratch[enter * w + x];
      if (leave >= 0) running -= scratch[leave * w + x];
      data[y * w + x] = running;
    }
  }
};

/** Finite-volume transport: every outgoing parcel has exactly one set of receivers. */
function transportActivePaint(field: PigmentField, bounds: PixelBounds, mask: Float32Array | Float64Array, amount: number, radius: number, receiverWeight?: Float64Array) {
  const w = bounds.width, h = bounds.height, count = new Float64Array(w * h);
  for (let i = 0; i < count.length; i++) count[i] = mask[i] > 0 ? receiverWeight?.[i] ?? 1 : 0;
  boxSumInPlace(count, w, h, radius);
  const before = capturePigmentPatch(field, bounds)!;
  const outgoing = new Float64Array(w * h);
  for (let i = 0; i < outgoing.length; i++) if (count[i] > 0 && mask[i] > 0) outgoing[i] = clampUnit(mask[i]) * amount / count[i];
  const values = Array.from({ length: PIGMENT_COUNT + 2 }, () => new Float64Array(w * h));
  for (let p = 0; p < values.length; p++) {
    for (let i = 0; i < outgoing.length; i++) values[p][i] = before.mass[i] * (p < PIGMENT_COUNT ? before.pigment[i * PIGMENT_COUNT + p] : p === PIGMENT_COUNT ? before.wetness[i] : before.body[i]) * outgoing[i];
    boxSumInPlace(values[p], w, h, radius);
  }
  for (let i = 0; i < outgoing.length; i++) {
    if (mask[i] <= 0) continue;
    const index = (bounds.y + Math.floor(i / w)) * field.width + bounds.x + i % w;
    const kept = 1 - outgoing[i] * count[i];
    let mass = 0;
    for (let p = 0; p < values.length; p++) {
      values[p][i] *= receiverWeight?.[i] ?? 1;
      values[p][i] += before.mass[i] * (p < PIGMENT_COUNT ? before.pigment[i * PIGMENT_COUNT + p] : p === PIGMENT_COUNT ? before.wetness[i] : before.body[i]) * kept;
      if (p < PIGMENT_COUNT) mass += values[p][i];
    }
    field.mass[index] = mass;
    if (mass > 0) {
      for (let p = 0; p < PIGMENT_COUNT; p++) field.pigment[index * PIGMENT_COUNT + p] = values[p][i] / mass;
      field.wetness[index] = values[PIGMENT_COUNT][i] / mass;
      field.body[index] = values[PIGMENT_COUNT + 1][i] / mass;
    }
  }
}

/**
 * Weighted box blur of a region-local buffer. Runs in O(pixels) regardless
 * of the radius, so large watercolour diffusions stay cheap.
 */
const boxBlurLocal = (
  source: Float32Array,
  w: number,
  h: number,
  radius: number,
  weights?: Float32Array,
) => {
  const r = Math.max(1, Math.round(radius));
  const numerator = new Float32Array(w * h);
  const denominator = new Float32Array(w * h);
  for (let index = 0; index < w * h; index += 1) {
    const weight = weights ? weights[index] : 1;
    numerator[index] = source[index] * weight;
    denominator[index] = weight;
  }
  boxSumInPlace(numerator, w, h, r);
  boxSumInPlace(denominator, w, h, r);
  for (let index = 0; index < w * h; index += 1) {
    numerator[index] = denominator[index] > 0 ? numerator[index] / denominator[index] : 0;
  }
  return numerator;
};

/**
 * Wet paint spreads and its pigment drifts to the boundary of the wet area
 * where it dries as a darker rim; granulating pigment sinks into the paper
 * tooth. Call once when a watercolour stroke ends (and again for any later
 * stroke that re-wets the area). Returns the bounds that changed.
 */
/** Pixels beyond the stroke bounds that `settleWetPaint` may touch. */
export function settleMargin(options: SettleOptions) {
  return Math.ceil(Math.max(options.diffusion, options.edgeWidth ?? 3) + 3);
}

export function settleWetPaint(
  field: PigmentField,
  rawBounds: PixelBounds,
  options: SettleOptions,
): PixelBounds | null {
  const bounds = clipBounds(expandBounds(rawBounds, settleMargin(options)), field);
  if (!bounds) return null;
  const { width } = field;
  const w = bounds.width;
  const h = bounds.height;
  const wetMask = new Float32Array(w * h);
  const film =
    options.film &&
    options.film.width === field.width &&
    options.film.height === field.height
      ? options.film.coverage
      : undefined;
  let anyWet = false;
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const index = (bounds.y + row) * width + bounds.x + column;
      let wet = field.wetness[index];
      // Only paint the stroke itself wetted is settling now.
      if (film) wet *= clampUnit(film[index] * 1.5);
      if (wet > 0.12 && field.mass[index] > 0) {
        wetMask[row * w + column] = wet;
        anyWet = true;
      }
    }
  }
  if (!anyWet) return null;

  const diffusion = Math.max(0, options.diffusion);
  const edgeWidth = Math.max(1, options.edgeWidth ?? 3);
  const blurredWet = boxBlurLocal(wetMask, w, h, edgeWidth);
  if (diffusion >= .5) transportActivePaint(field, bounds, wetMask, .75, Math.max(1, Math.round(diffusion)));

  // 2. Edge darkening: pigment migrates outward as the film dries, piling up
  //    where the wet area meets dry paper. Granulation keeps extra pigment in
  //    the paper valleys.
  const edgeStrength = clampUnit(options.edgeStrength);
  const granulation = clampUnit(options.granulation ?? 0);
  // Share of the interior's paint that a fully drying wash carries to its rim.
  const EDGE_MIGRATION = 0.3;
  const texture = granulation > 0 ? paperTexture() : undefined;
  let interiorMass = 0;
  let edgeArea = 0;
  const edgeWeight = new Float32Array(w * h);
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const local = row * w + column;
      const wet = wetMask[local];
      if (wet <= 0) continue;
      const index = (bounds.y + row) * width + bounds.x + column;
      const edge = clampUnit((wet - blurredWet[local]) / Math.max(0.05, wet) * 2.2) ** 1.5;
      edgeWeight[local] = edge;
      if (edge > 0.05) edgeArea += edge;
      else interiorMass += field.mass[index];
    }
  }
  if (edgeStrength > 0 && edgeArea > 0 && interiorMass > 0) {
    const moved = new Float64Array(PIGMENT_COUNT + 2);
    for (let local = 0; local < w * h; local++) {
      if (wetMask[local] <= 0 || edgeWeight[local] > .05) continue;
      const index = (bounds.y + Math.floor(local / w)) * width + bounds.x + local % w;
      const removed = field.mass[index] * edgeStrength * EDGE_MIGRATION;
      for (let p = 0; p < PIGMENT_COUNT; p++) moved[p] += field.pigment[index * PIGMENT_COUNT + p] * removed;
      moved[PIGMENT_COUNT] += field.wetness[index] * removed;
      moved[PIGMENT_COUNT + 1] += field.body[index] * removed;
      field.mass[index] -= removed;
    }
    const movedMass = moved.slice(0, PIGMENT_COUNT).reduce((a, b) => a + b, 0);
    for (let local = 0; local < w * h; local++) {
      if (wetMask[local] <= 0 || edgeWeight[local] <= .05) continue;
      const index = (bounds.y + Math.floor(local / w)) * width + bounds.x + local % w;
      const share = edgeWeight[local] / edgeArea;
      const previous = field.mass[index], next = previous + movedMass * share;
      for (let p = 0; p < PIGMENT_COUNT; p++) field.pigment[index * PIGMENT_COUNT + p] = (field.pigment[index * PIGMENT_COUNT + p] * previous + moved[p] * share) / next;
      field.wetness[index] = (field.wetness[index] * previous + moved[PIGMENT_COUNT] * share) / next;
      field.body[index] = (field.body[index] * previous + moved[PIGMENT_COUNT + 1] * share) / next;
      field.mass[index] = next;
    }
  }
  if (texture) {
    // A parcel carries its pigment, water and body together. Weighted
    // receivers collect it preferentially in the paper valleys; no local
    // fraction can exceed one and every material integral is conserved.
    const receivers = new Float64Array(w * h);
    for (let local = 0; local < w * h; local++) {
      const x = bounds.x + local % w, y = bounds.y + Math.floor(local / w);
      const tooth = texture[(y % PAPER_TEXTURE_SIZE) * PAPER_TEXTURE_SIZE + x % PAPER_TEXTURE_SIZE];
      receivers[local] = 1 + (0.5 - tooth) * 1.6;
    }
    transportActivePaint(field, bounds, wetMask, granulation * .65, 2, receivers);
  }

  return bounds;
}

/**
 * Evaporates water. Returns the bounds still wet (or null once dry) so the
 * caller can keep re-rendering only while needed.
 */
export function dryPigmentField(
  field: PigmentField,
  amount: number,
  bounds?: PixelBounds,
): PixelBounds | null {
  const area = bounds ? clipBounds(bounds, field) : fullBounds(field);
  if (!area) return null;
  let stillWet: PixelBounds | null = null;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      const index = y * field.width + x;
      const wet = field.wetness[index];
      if (wet <= 0) continue;
      const next = wet - amount;
      if (next <= 0.02) {
        field.wetness[index] = 0;
        continue;
      }
      field.wetness[index] = next;
      stillWet = unionBounds(stillWet, { x, y, width: 1, height: 1 });
    }
  }
  return stillWet;
}

export function wetBounds(field: PigmentField, bounds?: PixelBounds): PixelBounds | null {
  const area = bounds ? clipBounds(bounds, field) : fullBounds(field);
  if (!area) return null;
  let result: PixelBounds | null = null;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      if (field.wetness[y * field.width + x] > 0) {
        result = unionBounds(result, { x, y, width: 1, height: 1 });
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* Undo patches                                                             */
/* ------------------------------------------------------------------------ */

export interface PigmentPatch {
  bounds: PixelBounds;
  pigment: Float32Array;
  mass: Float32Array;
  wetness: Float32Array;
  body: Float32Array;
  glazes: Map<number, PigmentStratum[]>;
}

export function capturePigmentPatch(
  field: PigmentField,
  rawBounds: PixelBounds,
): PigmentPatch | null {
  const bounds = clipBounds(rawBounds, field);
  if (!bounds) return null;
  const area = bounds.width * bounds.height;
  const patch: PigmentPatch = {
    bounds,
    pigment: new Float32Array(area * PIGMENT_COUNT),
    mass: new Float32Array(area),
    wetness: new Float32Array(area),
    body: new Float32Array(area),
    glazes: new Map(),
  };
  for (let row = 0; row < bounds.height; row += 1) {
    const sourceStart = (bounds.y + row) * field.width + bounds.x;
    const targetStart = row * bounds.width;
    patch.mass.set(
      field.mass.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    patch.wetness.set(
      field.wetness.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    patch.body.set(
      field.body.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    patch.pigment.set(
      field.pigment.subarray(
        sourceStart * PIGMENT_COUNT,
        (sourceStart + bounds.width) * PIGMENT_COUNT,
      ),
      targetStart * PIGMENT_COUNT,
    );
  }
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const coats = field.glazes.get((bounds.y + y) * field.width + bounds.x + x);
    if (coats) patch.glazes.set(y * bounds.width + x, cloneStrata(coats));
  }
  return patch;
}

export function applyPigmentPatch(field: PigmentField, patch: PigmentPatch) {
  const { bounds } = patch;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const i = (bounds.y + y) * field.width + bounds.x + x;
    const coats = patch.glazes.get(y * bounds.width + x);
    if (coats) field.glazes.set(i, cloneStrata(coats)); else field.glazes.delete(i);
  }
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row;
    if (y < 0 || y >= field.height) continue;
    const targetStart = y * field.width + bounds.x;
    const sourceStart = row * bounds.width;
    field.mass.set(
      patch.mass.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    field.wetness.set(
      patch.wetness.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    field.body.set(
      patch.body.subarray(sourceStart, sourceStart + bounds.width),
      targetStart,
    );
    field.pigment.set(
      patch.pigment.subarray(
        sourceStart * PIGMENT_COUNT,
        (sourceStart + bounds.width) * PIGMENT_COUNT,
      ),
      targetStart * PIGMENT_COUNT,
    );
  }
}

export function pigmentPatchBytes(patch: PigmentPatch) {
  return (
    patch.pigment.byteLength +
    patch.mass.byteLength +
    patch.wetness.byteLength +
    patch.body.byteLength + Array.from(patch.glazes.values()).reduce((n, coats) => n + coats.length * 48, 0)
  );
}

/* ------------------------------------------------------------------------ */
/* Stroke shadow (lazy "before" copy)                                       */
/* ------------------------------------------------------------------------ */

const SHADOW_TILE = 32;

/**
 * Records what the surface looked like before a stroke, one tile at a time
 * and only where the stroke actually paints. Replaces cloning the whole
 * field on pointer-down, which cost tens of megabytes per stroke.
 */
export interface StrokeShadow {
  readonly field: PigmentField;
  readonly tilesAcross: number;
  readonly tiles: Map<number, PigmentPatch>;
}

export function createStrokeShadow(field: PigmentField): StrokeShadow {
  return {
    field,
    tilesAcross: Math.ceil(field.width / SHADOW_TILE),
    tiles: new Map(),
  };
}

/** Call *before* modifying pixels inside `rawBounds`. */
export function shadowBeforeWrite(shadow: StrokeShadow, rawBounds: PixelBounds) {
  const bounds = clipBounds(rawBounds, shadow.field);
  if (!bounds) return;
  const firstColumn = Math.floor(bounds.x / SHADOW_TILE);
  const firstRow = Math.floor(bounds.y / SHADOW_TILE);
  const lastColumn = Math.floor((bounds.x + bounds.width - 1) / SHADOW_TILE);
  const lastRow = Math.floor((bounds.y + bounds.height - 1) / SHADOW_TILE);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const key = row * shadow.tilesAcross + column;
      if (shadow.tiles.has(key)) continue;
      const tile = capturePigmentPatch(shadow.field, {
        x: column * SHADOW_TILE,
        y: row * SHADOW_TILE,
        width: SHADOW_TILE,
        height: SHADOW_TILE,
      });
      if (tile) shadow.tiles.set(key, tile);
    }
  }
}

/** The surface inside `rawBounds` as it was before the stroke began. */
export function shadowPatch(
  shadow: StrokeShadow,
  rawBounds: PixelBounds,
): PigmentPatch | null {
  const patch = capturePigmentPatch(shadow.field, rawBounds);
  if (!patch) return null;
  const { bounds } = patch;
  for (const tile of shadow.tiles.values()) {
    const x0 = Math.max(bounds.x, tile.bounds.x);
    const y0 = Math.max(bounds.y, tile.bounds.y);
    const x1 = Math.min(bounds.x + bounds.width, tile.bounds.x + tile.bounds.width);
    const y1 = Math.min(bounds.y + bounds.height, tile.bounds.y + tile.bounds.height);
    if (x1 <= x0 || y1 <= y0) continue;
    const span = x1 - x0;
    for (let y = y0; y < y1; y += 1) {
      const source = (y - tile.bounds.y) * tile.bounds.width + (x0 - tile.bounds.x);
      const target = (y - bounds.y) * bounds.width + (x0 - bounds.x);
      for (let dx = 0; dx < span; dx++) {
        const coats = tile.glazes.get(source + dx);
        if (coats) patch.glazes.set(target + dx, cloneStrata(coats)); else patch.glazes.delete(target + dx);
      }
      patch.mass.set(tile.mass.subarray(source, source + span), target);
      patch.wetness.set(tile.wetness.subarray(source, source + span), target);
      patch.body.set(tile.body.subarray(source, source + span), target);
      patch.pigment.set(
        tile.pigment.subarray(source * PIGMENT_COUNT, (source + span) * PIGMENT_COUNT),
        target * PIGMENT_COUNT,
      );
    }
  }
  return patch;
}

/* ------------------------------------------------------------------------ */
/* Persistence                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Storage format tag, written into the blue channel of plane C so a stored
 * field describes its own layout:
 *
 * - format 2 (current): plane A = √red, √blue, √yellow; plane B = √black,
 *   √white, mass high byte; plane C = body, mass low byte, tag 2. Pigment
 *   shares are stored on a square-root scale because a trace of a strong
 *   pigment in white (1 part in 500) moves the colour by several sRGB steps
 *   yet rounds to zero on a linear byte; the square root keeps such traces
 *   to ±0.4 % of their value. Mass has 16 bits so the relief shading, which
 *   reads mass differences between neighbours, does not pick up
 *   quantisation noise. Browser storage adds an optional fourth plane of
 *   16-bit wetness; older two/three-plane files restore as dry paint.
 * - format 1 (files from earlier builds): plane A/B hold linear shares and
 *   an 8-bit mass with a 2.2 gamma, plane C = body, 0, 0.
 * - two planes (older still): format 1 without plane C; body paint.
 *
 * Alpha stays 255 in every plane so browsers never premultiply the data.
 */
export const PIGMENT_FORMAT = 2;
const LEGACY_MASS_GAMMA = 2.2;
const decodeLegacyMass = (byte: number) =>
  (byte / 255) ** LEGACY_MASS_GAMMA * MAX_PAINT_MASS;
const MASS_STEPS = 65535;

const encodeShare = (share: number) => Math.round(Math.sqrt(clampUnit(share)) * 255);
const decodeShare = (byte: number) => (byte / 255) ** 2;

/** Choose a code vector that is unchanged by decoding and renormalising. */
function stableShareBytes(pigment: Float32Array, offset: number) {
  let bytes = Array.from({ length: PIGMENT_COUNT }, (_, p) => encodeShare(pigment[offset + p]));
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const sum = bytes.reduce((total, value) => total + value * value, 0);
    if (sum === 0) return bytes;
    const next = bytes.map((value) => Math.round(value * 255 / Math.sqrt(sum)));
    if (next.every((value, p) => value === bytes[p])) return bytes;
    bytes = next;
  }
  return bytes;
}

/** Layout of a stored field, read from the planes themselves. */
export function storedPigmentFormat(c?: ImageDataLike): 1 | 2 {
  return c && c.data.length >= 4 && c.data[2] === PIGMENT_FORMAT ? 2 : 1;
}

/**
 * Encodes the field into three opaque RGB images (format 2 above). Mass ≤ 0
 * pixels are left at zero; unpainted pixels still carry the format tag.
 */
export function encodePigmentField(
  field: PigmentField,
): [ImageDataLike, ImageDataLike, ImageDataLike] {
  const area = field.width * field.height;
  const a = new Uint8ClampedArray(area * 4);
  const b = new Uint8ClampedArray(area * 4);
  const c = new Uint8ClampedArray(area * 4);
  for (let index = 0; index < area; index += 1) {
    const offset = index * PIGMENT_COUNT;
    const target = index * 4;
    const mass = field.mass[index];
    a[target + 3] = 255;
    b[target + 3] = 255;
    c[target + 2] = PIGMENT_FORMAT;
    c[target + 3] = 255;
    if (mass <= 0) continue;
    const shares = stableShareBytes(field.pigment, offset);
    a[target] = shares[0];
    a[target + 1] = shares[1];
    a[target + 2] = shares[2];
    b[target] = shares[3];
    b[target + 1] = shares[4];
    const massSteps = Math.round(clamp(mass / MAX_PAINT_MASS, 0, 1) * MASS_STEPS);
    b[target + 2] = massSteps >> 8;
    c[target] = Math.round(clampUnit(field.body[index]) * 255);
    c[target + 1] = massSteps & 255;
  }
  return [
    { width: field.width, height: field.height, data: a },
    { width: field.width, height: field.height, data: b },
    { width: field.width, height: field.height, data: c },
  ];
}

/** Optional fourth plane: 16-bit wetness, version 1, opaque data pixels. */
export function encodePigmentWetness(field: PigmentField): ImageDataLike {
  const data = new Uint8ClampedArray(field.width * field.height * 4);
  for (let index = 0; index < field.wetness.length; index += 1) {
    const wetness = Math.round(clampUnit(field.wetness[index]) * 65535);
    data[index * 4] = wetness >> 8;
    data[index * 4 + 1] = wetness & 255;
    data[index * 4 + 2] = 1;
    data[index * 4 + 3] = 255;
  }
  return { width: field.width, height: field.height, data };
}

/**
 * Restores a field from two/three pigment planes and optional wetness. The planes
 * must be the stored pixels themselves (not resampled), because format 2
 * splits mass across two bytes.
 */
export function decodePigmentField(
  a: ImageDataLike,
  b: ImageDataLike,
  c?: ImageDataLike,
  wetness?: ImageDataLike,
): PigmentField {
  const field = createPigmentField(a.width, a.height);
  const area = field.width * field.height;
  const format = storedPigmentFormat(c);
  for (let index = 0; index < area; index += 1) {
    const target = index * 4;
    const mass =
      format === 2
        ? (((b.data[target + 2] << 8) | c!.data[target + 1]) / MASS_STEPS) *
          MAX_PAINT_MASS
        : decodeLegacyMass(b.data[target + 2]);
    if (mass <= 0) continue;
    const bytes = [
      a.data[target],
      a.data[target + 1],
      a.data[target + 2],
      b.data[target],
      b.data[target + 1],
    ];
    const values =
      format === 2 ? bytes.map(decodeShare) : bytes.map((byte) => byte / 255);
    const sum = values.reduce((total, value) => total + value, 0);
    if (sum <= 0) continue;
    const offset = index * PIGMENT_COUNT;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      field.pigment[offset + channel] = values[channel] / sum;
    }
    field.mass[index] = mass;
    field.body[index] = c ? c.data[target] / 255 : 1;
    if (wetness && wetness.width === a.width && wetness.height === a.height &&
      wetness.data[target + 2] === 1) {
      field.wetness[index] = ((wetness.data[target] << 8) | wetness.data[target + 1]) / 65535;
    }
  }
  return field;
}

/** Nearest-neighbour resample used when the paper size changes. */
export function resamplePigmentField(
  field: PigmentField,
  width: number,
  height: number,
): PigmentField {
  const output = createPigmentField(width, height);
  for (let y = 0; y < output.height; y += 1) {
    const sy = Math.min(field.height - 1, Math.floor((y / output.height) * field.height));
    for (let x = 0; x < output.width; x += 1) {
      const sx = Math.min(field.width - 1, Math.floor((x / output.width) * field.width));
      const source = sy * field.width + sx;
      const target = y * output.width + x;
      const coats = field.glazes.get(source);
      if (coats) output.glazes.set(target, cloneStrata(coats));
      output.mass[target] = field.mass[source];
      output.wetness[target] = field.wetness[source];
      output.body[target] = field.body[source];
      output.pigment.set(
        field.pigment.subarray(source * PIGMENT_COUNT, (source + 1) * PIGMENT_COUNT),
        target * PIGMENT_COUNT,
      );
    }
  }
  return output;
}

/**
 * Rebuilds a field from a legacy RGBA layer. `inverse` maps a display colour
 * to the pigment proportions that reproduce it; callers cache it.
 */
export function pigmentFieldFromRgba(
  image: ImageDataLike,
  inverse: (rgb: RGBColor) => Float32Array,
): PigmentField {
  const field = createPigmentField(image.width, image.height);
  const area = image.width * image.height;
  for (let index = 0; index < area; index += 1) {
    const source = index * 4;
    const alpha = image.data[source + 3] / 255;
    if (alpha <= 0.002) continue;
    const pigment = inverse({
      r: image.data[source],
      g: image.data[source + 1],
      b: image.data[source + 2],
    });
    const offset = index * PIGMENT_COUNT;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      field.pigment[offset + channel] = pigment[channel];
    }
    field.mass[index] = Math.min(MAX_PAINT_MASS, massForCoverage(alpha, pigment));
    // Legacy artwork was flat RGBA: treat it as a thin, flat film.
    field.body[index] = 0.25;
  }
  return field;
}

/** Lossless opaque PNG payload for ordered glazes and mass outside legacy range. */
export function encodePigmentGlazes(field: PigmentField): ImageDataLike | null {
  const indices = new Set(field.glazes.keys());
  for (let i = 0; i < field.mass.length; i++) if (field.mass[i] > MAX_PAINT_MASS) indices.add(i);
  if (!indices.size) return null;
  let floats = 2;
  const sizeOf = (coat: PigmentStratum): number => 10 + (coat.children?.reduce((sum, child) => sum + sizeOf(child), 0) ?? 0);
  for (const i of indices) floats += 10 + (field.glazes.get(i)?.reduce((sum, coat) => sum + sizeOf(coat), 0) ?? 0);
  const buffer = new ArrayBuffer(floats * 4);
  const view = new DataView(buffer);
  let at = 0;
  const write = (v: number) => { view.setFloat32(at, v, true); at += 4; };
  write(20261005); write(indices.size);
  for (const i of indices) {
    const coats = field.glazes.get(i) ?? [];
    write(i); write(coats.length); write(field.mass[i]); write(field.wetness[i]); write(field.body[i]);
    for (let p = 0; p < PIGMENT_COUNT; p++) write(field.pigment[i * PIGMENT_COUNT + p]);
    const writeCoat = (coat: PigmentStratum) => { write(coat.mass); write(coat.opacity ?? 1); write(coat.lighting ?? 1); for (const v of coat.pigment) write(v); write(coat.body ?? 0); write(coat.children?.length ?? 0); for (const child of coat.children ?? []) writeCoat(child); };
    for (const coat of coats) writeCoat(coat);
  }
  const bytes = new Uint8Array(buffer);
  const width = Math.min(4096, Math.ceil(bytes.length / 3));
  const height = Math.ceil(bytes.length / (width * 3));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data.set(bytes.subarray(i * 3, i * 3 + 3), i * 4); data[i * 4 + 3] = 255; }
  return { width, height, data };
}
export function decodePigmentGlazes(field: PigmentField, image: ImageDataLike) {
  const bytes = new Uint8Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) bytes.set(image.data.subarray(i * 4, i * 4 + 3), i * 3);
  const view = new DataView(bytes.buffer);
  let at = 0;
  const read = () => { if (at + 4 > view.byteLength) throw new RangeError("Invalid glaze payload"); const v = view.getFloat32(at, true); at += 4; if (!Number.isFinite(v)) throw new RangeError("Invalid glaze value"); return v; };
  // float32 exactly represents this identifier rounded to the nearest even integer.
  if (read() !== Math.fround(20261005)) throw new RangeError("Unknown glaze format");
  const count = read();
  if (!Number.isInteger(count) || count < 0 || count > field.mass.length) throw new RangeError("Invalid glaze count");
  for (let n = 0; n < count; n++) {
    const index = read(), length = read();
    if (!Number.isInteger(index) || index < 0 || index >= field.mass.length || !Number.isInteger(length) || length < 0 || length > 100000) throw new RangeError("Invalid glaze index");
    field.mass[index] = Math.max(0, read()); field.wetness[index] = clampUnit(read()); field.body[index] = clampUnit(read());
    for (let p = 0; p < PIGMENT_COUNT; p++) field.pigment[index * PIGMENT_COUNT + p] = Math.max(0, read());
    const coats: PigmentStratum[] = [];
    const readCoat = (depth = 0): PigmentStratum => {
      if (depth > 32) throw new RangeError("Too many nested glaze groups");
      const mass = read(), opacity = read(), lighting = read();
      const pigment = new Float32Array(PIGMENT_COUNT); for (let p = 0; p < PIGMENT_COUNT; p++) pigment[p] = Math.max(0, read());
      const body = clampUnit(read());
      const count = read(); if (!Number.isInteger(count) || count < 0 || count > 100000) throw new RangeError("Invalid glaze group");
      const children = Array.from({ length: count }, () => readCoat(depth + 1));
      return { mass: Math.max(0, mass), opacity: clampUnit(opacity), lighting, pigment, body, children: children.length ? children : undefined };
    };
    for (let l = 0; l < length; l++) coats.push(readCoat());
    if (coats.length) field.glazes.set(index, coats);
  }
}
