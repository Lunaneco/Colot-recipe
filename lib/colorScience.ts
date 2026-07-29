import {
  MATERIAL_IDS,
  PIGMENT_IDS,
  type MaterialId,
  type PigmentId,
} from "./types";

/**
 * A small, deterministic subtractive-colour engine for the palette.
 *
 * Each pigment is represented by a 31-sample reflectance curve (400–700 nm).
 * Reflectance is mixed in Kubelka–Munk K/S space and converted through
 * CIE 1931 XYZ (D65) to sRGB. This is deliberately different from averaging
 * RGB triplets: pigments remove overlapping portions of the spectrum.
 */

/** Backward-compatible names retained for callers of the colour engine. */
export type PigmentKey = PigmentId;
export type MaterialKey = MaterialId;

export type PaintRecipe = Partial<Record<MaterialKey, number>>;

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface HSLColor {
  /** Hue in degrees, 0–359. */
  h: number;
  /** Saturation in percent, 0–100. */
  s: number;
  /** Lightness in percent, 0–100. */
  l: number;
}

export interface MixedPaintColor {
  recipe: Required<PaintRecipe>;
  totalUnits: number;
  pigmentUnits: number;
  hex: `#${string}`;
  rgb: RGBColor;
  hsl: HSLColor;
  /** Coverage alpha, from fully transparent (0) to fully opaque (1). */
  opacity: number;
  /** Water share of the complete recipe, in the range 0–1. */
  waterRatio: number;
  /** Each pigment's share after excluding water, in the range 0–1. */
  pigmentRatio: Record<PigmentKey, number>;
  /** Perceived colour strength after tinting and dilution, in the range 0–1. */
  intensity: number;
  /** Relative paint body: watery (0) to thick (1). */
  viscosity: number;
  /** Relative tendency to spread on the drawing surface, 0–1. */
  spread: number;
  /** Relative drying speed, slow (0) to fast (1). */
  dryingSpeed: number;
  /** A short, editable Japanese colour-name suggestion. */
  name: string;
}

const WAVELENGTHS = Array.from({ length: 31 }, (_, index) => 400 + index * 10);

// CIE 1931 2° colour-matching functions, sampled at the same 10 nm interval.
const CIE_X = [
  0.01431, 0.04351, 0.13438, 0.2839, 0.34828, 0.3362, 0.2908, 0.19536,
  0.09564, 0.03201, 0.0049, 0.0093, 0.06327, 0.1655, 0.2904, 0.43345,
  0.5945, 0.7621, 0.9163, 1.0263, 1.0622, 1.0026, 0.85445, 0.6424,
  0.4479, 0.2835, 0.1649, 0.0874, 0.04677, 0.0227, 0.011359,
] as const;

const CIE_Y = [
  0.000396, 0.00121, 0.004, 0.0116, 0.023, 0.038, 0.06, 0.09098, 0.13902,
  0.20802, 0.323, 0.503, 0.71, 0.862, 0.954, 0.99495, 0.995, 0.952, 0.87,
  0.757, 0.631, 0.503, 0.381, 0.265, 0.175, 0.107, 0.061, 0.032, 0.017,
  0.00821, 0.004102,
] as const;

const CIE_Z = [
  0.06785, 0.2074, 0.6456, 1.3856, 1.74706, 1.77211, 1.6692, 1.28764,
  0.81295, 0.46518, 0.272, 0.1582, 0.07825, 0.04216, 0.0203, 0.00875,
  0.0039, 0.0021, 0.00165, 0.0011, 0.0008, 0.00034, 0.00019, 0.00005, 0,
  0, 0, 0, 0, 0, 0,
] as const;

// Relative spectral power distribution of standard illuminant D65.
const D65 = [
  82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812, 114.861,
  115.923, 108.811, 109.354, 107.802, 104.79, 107.689, 104.405, 104.046,
  100, 96.3342, 95.788, 88.6856, 90.0062, 89.5991, 87.6987, 83.2886,
  83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091,
] as const;

const gaussian = (wavelength: number, centre: number, width: number) =>
  Math.exp(-0.5 * ((wavelength - centre) / width) ** 2);

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const makeSpectrum = (
  sample: (wavelength: number) => number,
): readonly number[] => WAVELENGTHS.map((wavelength) => clamp(sample(wavelength), 0.018, 0.94));

/**
 * Artist-paint inspired reflectance curves. They are smooth synthetic spectra,
 * not monitor colours. Their overlapping absorption bands are what produce the
 * orange, green, muted-violet and neutral three-pigment mixtures.
 */
export const PIGMENT_REFLECTANCE: Readonly<
  Record<PigmentKey, readonly number[]>
> = {
  red: makeSpectrum(
    (wavelength) =>
      0.028 +
      0.72 * sigmoid((wavelength - 580) / 16) +
      // A small violet reflectance lobe distinguishes an artist's cool red
      // from an ideal display primary and lets red + blue retain both ends.
      0.15 * gaussian(wavelength, 438, 34),
  ),
  blue: makeSpectrum(
    (wavelength) =>
      0.026 +
      0.53 * gaussian(wavelength, 452, 43) +
      0.075 * gaussian(wavelength, 505, 58) +
      // Ultramarine-like warm tail: weak enough to keep yellow + blue green,
      // but sufficient for a muted red + blue violet.
      0.11 * gaussian(wavelength, 652, 55),
  ),
  yellow: makeSpectrum(
    (wavelength) =>
      0.035 +
      0.79 * sigmoid((wavelength - 492) / 13) +
      0.035 * gaussian(wavelength, 575, 90),
  ),
  white: makeSpectrum(
    (wavelength) =>
      0.89 +
      0.018 * gaussian(wavelength, 455, 85) -
      0.01 * gaussian(wavelength, 610, 100),
  ),
};

// Relative scattering power. Titanium white scatters especially strongly.
const SCATTERING_POWER: Readonly<Record<PigmentKey, number>> = {
  red: 1,
  blue: 1.12,
  yellow: 1.2,
  white: 3.4,
};

const reflectanceToKS = (reflectance: number) => {
  const safeReflectance = clamp(reflectance, 0.0001, 0.9999);
  return ((1 - safeReflectance) ** 2) / (2 * safeReflectance);
};

const ksToReflectance = (ks: number) =>
  clamp(1 + ks - Math.sqrt(ks * ks + 2 * ks));

const normaliseUnits = (
  value: number | undefined,
  material: MaterialKey,
): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new RangeError(`${material} must be a non-negative integer`);
  }
  return value;
};

export function normalizePaintRecipe(
  recipe: PaintRecipe = {},
): Required<PaintRecipe> {
  return Object.fromEntries(
    MATERIAL_IDS.map((material) => [
      material,
      normaliseUnits(recipe[material], material),
    ]),
  ) as Required<PaintRecipe>;
}

function normalizePaintProportions(
  recipe: PaintRecipe = {},
): Required<PaintRecipe> {
  return Object.fromEntries(
    MATERIAL_IDS.map((material) => {
      const value = recipe[material] ?? 0;
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(
          `${material} proportion must be a finite non-negative number`,
        );
      }
      return [material, value];
    }),
  ) as Required<PaintRecipe>;
}

const mixReflectance = (
  recipe: Required<PaintRecipe>,
): readonly number[] => {
  const pigmentUnits = PIGMENT_IDS.reduce(
    (total, pigment) => total + recipe[pigment],
    0,
  );

  if (pigmentUnits === 0) return PIGMENT_REFLECTANCE.white;

  // Ideal K/S addition slightly overstates the chroma of red–yellow blends.
  // A geometric-mean interaction term models the extra optical path where the
  // two pigments meet: it is zero for either pure endpoint, peaks for balanced
  // mixtures, and is naturally masked by titanium white.
  const warmBase = clamp(
    (2 * Math.sqrt(recipe.red * recipe.yellow) * 1.02) / pigmentUnits,
  );
  const blueShare = recipe.blue / pigmentUnits;
  const blueTransition = clamp(blueShare / 0.08);
  const blueMask =
    1 -
    blueTransition *
      blueTransition *
      (3 - 2 * blueTransition);
  const warmInteraction = warmBase * blueMask;
  return WAVELENGTHS.map((wavelength, wavelengthIndex) => {
    let mixedAbsorption = 0;
    let mixedScattering = 0;

    for (const pigment of PIGMENT_IDS) {
      const units = recipe[pigment];
      if (units === 0) continue;

      const scattering = units * SCATTERING_POWER[pigment];
      const ks = reflectanceToKS(
        PIGMENT_REFLECTANCE[pigment][wavelengthIndex],
      );
      mixedAbsorption += scattering * ks;
      mixedScattering += scattering;
    }

    const reflectance = ksToReflectance(mixedAbsorption / mixedScattering);

    // The interaction suppresses the violet-blue tail and far-red shoulder
    // while retaining the yellow-green window, matching a physical orange
    // draw-down instead of a luminous display-primary blend.
    const filmAbsorption =
      0.085 +
      0.46 * gaussian(wavelength, 445, 45) +
      0.29 * gaussian(wavelength, 650, 80) -
      0.136 * gaussian(wavelength, 545, 42);

    return reflectance * (1 - warmInteraction * filmAbsorption);
  });
};

const spectrumToRgb = (reflectance: readonly number[]): RGBColor => {
  const normalizer =
    1 /
    D65.reduce(
      (total, illuminant, index) => total + illuminant * CIE_Y[index],
      0,
    );

  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < reflectance.length; index += 1) {
    const stimulus = reflectance[index] * D65[index] * normalizer;
    x += stimulus * CIE_X[index];
    y += stimulus * CIE_Y[index];
    z += stimulus * CIE_Z[index];
  }

  // CIE XYZ (D65) to linear sRGB.
  const linearRed = 3.2406 * x - 1.5372 * y - 0.4986 * z;
  const linearGreen = -0.9689 * x + 1.8758 * y + 0.0415 * z;
  const linearBlue = 0.0557 * x - 0.204 * y + 1.057 * z;

  const encodeSrgb = (channel: number) => {
    const clipped = clamp(channel);
    const encoded =
      clipped <= 0.0031308
        ? 12.92 * clipped
        : 1.055 * clipped ** (1 / 2.4) - 0.055;
    return Math.round(clamp(encoded) * 255);
  };

  return {
    r: encodeSrgb(linearRed),
    g: encodeSrgb(linearGreen),
    b: encodeSrgb(linearBlue),
  };
};

export const rgbToHex = ({ r, g, b }: RGBColor): `#${string}` =>
  `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;

export const hexToRgb = (hex: string): RGBColor => {
  const value = hex.replace("#", "");
  if (!/^[0-9A-F]{6}$/iu.test(value)) {
    throw new Error("HEX colour must contain exactly six hexadecimal digits");
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
};

export const rgbToHsl = ({ r, g, b }: RGBColor): HSLColor => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(lightness * 100) };
  }

  let hue: number;
  if (maximum === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (maximum === green) {
    hue = 60 * ((blue - red) / delta + 2);
  } else {
    hue = 60 * ((red - green) / delta + 4);
  }

  if (hue < 0) hue += 360;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  return {
    h: Math.round(hue) % 360,
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
};

const round = (value: number, places = 3) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const suggestJapaneseName = (
  recipe: Required<PaintRecipe>,
  hsl: HSLColor,
  waterRatio: number,
): string => {
  const { red, blue, yellow, white } = recipe;
  const coloured = red + blue + yellow;

  if (coloured + white === 0) return "透明な水";
  if (coloured === 0) return "雪の白";

  const hasRedYellow = red > 0 && yellow > 0 && blue === 0;
  const hasYellowBlue = yellow > 0 && blue > 0 && red === 0;
  const hasRedBlue = red > 0 && blue > 0 && yellow === 0;
  const hasAllPrimaries = red > 0 && blue > 0 && yellow > 0;
  const whiteShare = white / (coloured + white);

  if (hasAllPrimaries && hsl.s < 38) {
    return hsl.l < 30 ? "深い土の色" : "静かなアースカラー";
  }
  if (hasRedYellow) {
    if (whiteShare > 0.25) return "アプリコットミルク";
    if (waterRatio > 0.35) return "薄日のオレンジ";
    return "夕焼けオレンジ";
  }
  if (hasYellowBlue) {
    if (whiteShare > 0.25) return "若葉のミント";
    if (waterRatio > 0.35) return "雨上がりの緑";
    return "深い森の緑";
  }
  if (hasRedBlue) {
    if (whiteShare > 0.25) return "藤色ミルク";
    return "薄明の紫";
  }
  if (red > 0 && blue === 0 && yellow === 0) {
    if (whiteShare > 0.2) return "ミルクいちご";
    return waterRatio > 0.35 ? "花びらの赤" : "茜色";
  }
  if (blue > 0 && red === 0 && yellow === 0) {
    if (whiteShare > 0.2) return "朝もやの青";
    return waterRatio > 0.35 ? "雨上がりの青" : "深海の青";
  }
  if (yellow > 0 && red === 0 && blue === 0) {
    if (whiteShare > 0.2) return "バニライエロー";
    return waterRatio > 0.35 ? "木漏れ日の黄" : "ひまわり色";
  }

  if (hsl.s < 20) return hsl.l < 45 ? "墨を含んだ灰色" : "霞色";
  if (hsl.h < 15 || hsl.h >= 345) return "深い赤";
  if (hsl.h < 45) return "琥珀オレンジ";
  if (hsl.h < 72) return "ひだまりの黄";
  if (hsl.h < 165) return "苔むした緑";
  if (hsl.h < 195) return "静かな青緑";
  if (hsl.h < 255) return "雨夜の青";
  if (hsl.h < 315) return "夜明け前の紫";
  return "木苺色";
};

/**
 * Calculate the appearance and handling properties of an integer-unit recipe.
 *
 * Water never enters the pigment spectrum. It affects concentration, alpha,
 * viscosity, spread, drying, and intensity so transparent washes preserve the
 * same intrinsic hue and reveal the colour underneath when composited.
 */
function calculateMixedPaint(
  recipe: Required<PaintRecipe>,
): MixedPaintColor {
  const pigmentUnits = PIGMENT_IDS.reduce(
    (total, pigment) => total + recipe[pigment],
    0,
  );
  const totalUnits = pigmentUnits + recipe.water;
  const waterRatio = totalUnits === 0 ? 0 : recipe.water / totalUnits;
  const pigmentRatio = Object.fromEntries(
    PIGMENT_IDS.map((pigment) => [
      pigment,
      pigmentUnits === 0 ? 0 : recipe[pigment] / pigmentUnits,
    ]),
  ) as Record<PigmentKey, number>;

  const rgb = spectrumToRgb(mixReflectance(recipe));
  const hsl = rgbToHsl(rgb);
  const colouredUnits = recipe.red + recipe.blue + recipe.yellow;

  if (pigmentUnits === 0) {
    return {
      recipe,
      totalUnits,
      pigmentUnits,
      hex: "#FFFFFF",
      rgb: { r: 255, g: 255, b: 255 },
      hsl: { h: 0, s: 0, l: 100 },
      opacity: 0,
      waterRatio: round(waterRatio),
      pigmentRatio,
      intensity: 0,
      viscosity: 0,
      spread: recipe.water > 0 ? 1 : 0,
      dryingSpeed: recipe.water > 0 ? 0.2 : 0,
      name: suggestJapaneseName(recipe, hsl, waterRatio),
    };
  }

  const concentration =
    pigmentUnits / (pigmentUnits + recipe.water * 1.45);
  const opticalLoad = colouredUnits * 1.05 + recipe.white * 1.55;
  // One dry unit should already behave like body paint. Water then lowers the
  // pigment concentration into a translucent wash without changing its hue.
  const dryCoverage = 1 - Math.exp(-opticalLoad * 3);
  const opacity = dryCoverage * (0.03 + 0.97 * concentration ** 0.8);
  const colourShare = colouredUnits / pigmentUnits;
  const chroma = hsl.s / 100;
  const intensity =
    (0.2 + 0.8 * Math.sqrt(chroma)) *
    colourShare ** 0.62 *
    concentration ** 0.7;
  const viscosity = concentration ** 0.82;
  const spread = 1 - concentration ** 1.35;
  const dryingSpeed = clamp(0.88 - waterRatio * 0.68 - pigmentUnits * 0.012);

  return {
    recipe,
    totalUnits,
    pigmentUnits,
    hex: rgbToHex(rgb),
    rgb,
    hsl,
    opacity: round(opacity),
    waterRatio: round(waterRatio),
    pigmentRatio: Object.fromEntries(
      PIGMENT_IDS.map((pigment) => [
        pigment,
        round(pigmentRatio[pigment], 4),
      ]),
    ) as Record<PigmentKey, number>,
    intensity: round(intensity),
    viscosity: round(viscosity),
    spread: round(spread),
    dryingSpeed: round(dryingSpeed),
    name: suggestJapaneseName(recipe, hsl, waterRatio),
  };
}

export function mixPaint(recipeInput: PaintRecipe = {}): MixedPaintColor {
  return calculateMixedPaint(normalizePaintRecipe(recipeInput));
}

/**
 * Calculate paint from continuous local proportions.
 *
 * The regular recipe API intentionally accepts integer spoonfuls. Spatial
 * overlap produces fractional contributions at dab edges, so this variant
 * preserves those proportions instead of rounding a visible colour to a
 * nearby integer recipe.
 */
export function mixPaintProportions(
  recipeInput: PaintRecipe = {},
): MixedPaintColor {
  return calculateMixedPaint(normalizePaintProportions(recipeInput));
}

/** Descriptive alias for callers that prefer a calculator-style name. */
export const calculatePaintColor = mixPaint;
