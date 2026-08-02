import {
  MATERIAL_COLORS,
  MATERIAL_IDS,
  PIGMENT_IDS,
  type MaterialId,
  type PigmentId,
} from "./types";
import {
  CIE_1931_2_DEGREE_X,
  CIE_1931_2_DEGREE_Y,
  CIE_1931_2_DEGREE_Z,
  CIE_STANDARD_ILLUMINANT_D65,
} from "./cieD65";
import {
  PAINT_CALIBRATION,
  PAINT_CALIBRATION_WAVELENGTHS_NM,
  SAUNDERSON_K1,
  SAUNDERSON_K2,
} from "./paintCalibration";

/**
 * A deterministic, measured-data subtractive-colour engine for the palette.
 *
 * Five Golden Heavy Body artist paints use RIT-derived absorption K and
 * scattering S curves at 38 samples (380–750 nm). Relative paint parts combine
 * K and S separately under Duncan's ideal-mixture approximation, then the
 * opaque two-constant Kubelka–Munk result receives the profile's Saunderson
 * surface correction and is integrated under D65 with the CIE 1931 2° observer.
 * This is deliberately different from averaging RGB triplets: pigments absorb
 * and scatter overlapping wavelength bands at different strengths.
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

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const kmRatioToInternalReflectance = (ratio: number) =>
  clamp(1 / (1 + ratio + Math.sqrt(ratio * ratio + 2 * ratio)));

/**
 * Convert internal diffuse reflectance using Wacton.Unicolour's specular-
 * excluded rendering assumption. The RIT source data were measured in SPIN;
 * the direct k1 term is absent here because SPEX is the selected display
 * geometry, not because it was the original measurement mode.
 */
const applySaundersonCorrection = (internalReflectance: number) =>
  clamp(
    ((1 - SAUNDERSON_K1) *
      (1 - SAUNDERSON_K2) *
      internalReflectance) /
      (1 - SAUNDERSON_K2 * internalReflectance),
  );

const kmCoefficientsToReflectance = (
  absorptionK: number,
  scatteringS: number,
) => {
  if (scatteringS <= 0) return 0;
  return applySaundersonCorrection(
    kmRatioToInternalReflectance(absorptionK / scatteringS),
  );
};

/**
 * Pure-paint reflectances reconstructed from each measured-derived K and S
 * profile, including the same Saunderson surface correction used for mixtures.
 */
export const PIGMENT_REFLECTANCE: Readonly<
  Record<PigmentKey, readonly number[]>
> = Object.freeze(
  Object.fromEntries(
    PIGMENT_IDS.map((pigment) => {
      const calibration = PAINT_CALIBRATION[pigment];
      return [
        pigment,
        Object.freeze(
          calibration.absorptionK.map((absorptionK, wavelengthIndex) =>
            kmCoefficientsToReflectance(
              absorptionK,
              calibration.scatteringS[wavelengthIndex],
            )
          ),
        ),
      ];
    }),
  ) as Record<PigmentKey, readonly number[]>,
);

/** A neutral unit reflector for the pigment-free reflectance API. */
const NO_PIGMENT_REFLECTANCE = Object.freeze(
  PAINT_CALIBRATION_WAVELENGTHS_NM.map(() => 1),
);

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

  if (pigmentUnits === 0) return NO_PIGMENT_REFLECTANCE;

  // Duncan's ideal-mixture approximation is applied to complete-paint shares:
  // Kmix = ΣciKi and Smix = ΣciSi. Averaging K/S directly would incorrectly
  // assume every pigment has the same scattering power, especially damaging
  // white tints and mixtures involving strongly scattering inorganic colours.
  return PAINT_CALIBRATION_WAVELENGTHS_NM.map((_, wavelengthIndex) => {
    let mixedK = 0;
    let mixedS = 0;

    for (const pigment of PIGMENT_IDS) {
      const units = recipe[pigment];
      if (units === 0) continue;
      mixedK +=
        units * PAINT_CALIBRATION[pigment].absorptionK[wavelengthIndex];
      mixedS +=
        units * PAINT_CALIBRATION[pigment].scatteringS[wavelengthIndex];
    }

    return kmCoefficientsToReflectance(
      mixedK / pigmentUnits,
      mixedS / pigmentUnits,
    );
  });
};

/**
 * Expose the calibrated physical reflectance for verification and future
 * colour-management outputs. Water is intentionally excluded from the
 * intrinsic pigment spectrum, exactly as it is in the visible colour result.
 */
export function mixPaintReflectanceProportions(
  recipeInput: PaintRecipe = {},
): readonly number[] {
  return mixReflectance(normalizePaintProportions(recipeInput));
}

type LinearRGBColor = { r: number; g: number; b: number };
type XYZColor = { x: number; y: number; z: number };
type OKLabColor = { l: number; a: number; b: number };

const spectralNormalizer =
  1 /
  CIE_STANDARD_ILLUMINANT_D65.reduce(
    (total, illuminant, index) =>
      total + illuminant * CIE_1931_2_DEGREE_Y[index],
    0,
  );

const spectrumToXyz2Degree = (
  reflectance: readonly number[],
): XYZColor => {
  if (reflectance.length !== PAINT_CALIBRATION_WAVELENGTHS_NM.length) {
    throw new RangeError(
      `reflectance must contain ${PAINT_CALIBRATION_WAVELENGTHS_NM.length} samples`,
    );
  }

  let x = 0;
  let y = 0;
  let z = 0;

  for (let index = 0; index < reflectance.length; index += 1) {
    const stimulus =
      reflectance[index] *
      CIE_STANDARD_ILLUMINANT_D65[index] *
      spectralNormalizer;
    x += stimulus * CIE_1931_2_DEGREE_X[index];
    y += stimulus * CIE_1931_2_DEGREE_Y[index];
    z += stimulus * CIE_1931_2_DEGREE_Z[index];
  }

  return { x, y, z };
};

const spectrumToLinearRgb = (
  reflectance: readonly number[],
): LinearRGBColor => {
  const { x, y, z } = spectrumToXyz2Degree(reflectance);

  // CIE XYZ D65 -> linear sRGB, using the high-precision CSS Color 4 matrix.
  return {
    r:
      3.2409699419045226 * x -
      1.537383177570094 * y -
      0.4986107602930034 * z,
    g:
      -0.9692436362808796 * x +
      1.8759675015077202 * y +
      0.04155505740717559 * z,
    b:
      0.05563007969699366 * x -
      0.20397695888897652 * y +
      1.0569715142428786 * z,
  };
};

const encodeSrgbFloat = (channel: number) => {
  const clipped = clamp(channel);
  const encoded =
    clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  return clamp(encoded) * 255;
};

const encodeSrgb = (channel: number) =>
  Math.round(encodeSrgbFloat(channel));

const linearRgbToRgb = ({ r, g, b }: LinearRGBColor): RGBColor =>
  ({
    r: encodeSrgb(r),
    g: encodeSrgb(g),
    b: encodeSrgb(b),
  });

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

const decodeSrgb = (channel: number) => {
  const encoded = clamp(channel / 255);
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
};

const rgbToLinearRgb = ({ r, g, b }: RGBColor): LinearRGBColor => ({
  r: decodeSrgb(r),
  g: decodeSrgb(g),
  b: decodeSrgb(b),
});

const linearSrgbToOklab = ({ r, g, b }: LinearRGBColor): OKLabColor => {
  const l = Math.cbrt(
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
  );
  const m = Math.cbrt(
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
  );
  const s = Math.cbrt(
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  );
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

const oklabToLinearSrgb = ({ l, a, b }: OKLabColor): LinearRGBColor => {
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const lCone = lRoot ** 3;
  const mCone = mRoot ** 3;
  const sCone = sRoot ** 3;
  return {
    r:
      4.0767416621 * lCone -
      3.3077115913 * mCone +
      0.2309699292 * sCone,
    g:
      -1.2684380046 * lCone +
      2.6097574011 * mCone -
      0.3413193965 * sCone,
    b:
      -0.0041960863 * lCone -
      0.7034186147 * mCone +
      1.707614701 * sCone,
  };
};

const isLinearSrgbInGamut = ({ r, g, b }: LinearRGBColor) =>
  r >= -1e-7 && r <= 1 + 1e-7 &&
  g >= -1e-7 && g <= 1 + 1e-7 &&
  b >= -1e-7 && b <= 1 + 1e-7;

/**
 * Preserve OKLab lightness and hue, reducing only chroma when a spectral
 * colour falls outside sRGB. Independent channel clipping can rotate hue and
 * even reverse a tint ramp, so it is used only as final floating-point safety.
 */
const gamutMapOklabToLinearSrgb = (colour: OKLabColor): LinearRGBColor => {
  const lightness = clamp(colour.l);
  if (lightness === 0) return { r: 0, g: 0, b: 0 };
  if (lightness === 1) return { r: 1, g: 1, b: 1 };

  const candidate = oklabToLinearSrgb({ ...colour, l: lightness });
  if (isLinearSrgbInGamut(candidate)) return candidate;

  const chroma = Math.hypot(colour.a, colour.b);
  if (chroma <= Number.EPSILON) {
    return oklabToLinearSrgb({ l: lightness, a: 0, b: 0 });
  }
  const hueA = colour.a / chroma;
  const hueB = colour.b / chroma;
  let lower = 0;
  let upper = chroma;
  let mapped = oklabToLinearSrgb({ l: lightness, a: 0, b: 0 });
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (lower + upper) / 2;
    const trial = oklabToLinearSrgb({
      l: lightness,
      a: hueA * middle,
      b: hueB * middle,
    });
    if (isLinearSrgbInGamut(trial)) {
      lower = middle;
      mapped = trial;
    } else {
      upper = middle;
    }
  }
  return mapped;
};

const PHYSICAL_ENDPOINTS_OKLAB = Object.freeze(
  Object.fromEntries(
    PIGMENT_IDS.map((pigment) => [
      pigment,
      linearSrgbToOklab(
        spectrumToLinearRgb(PIGMENT_REFLECTANCE[pigment]),
      ),
    ]),
  ) as Record<PigmentKey, OKLabColor>,
);

const DISPLAY_ENDPOINTS_OKLAB = Object.freeze(
  Object.fromEntries(
    PIGMENT_IDS.map((pigment) => [
      pigment,
      linearSrgbToOklab(
        rgbToLinearRgb(hexToRgb(MATERIAL_COLORS[pigment])),
      ),
    ]),
  ) as Record<PigmentKey, OKLabColor>,
);

const DISPLAY_WHITE_LINEAR = rgbToLinearRgb(
  hexToRgb(MATERIAL_COLORS.white),
);

const linearRelativeLuminance = ({ r, g, b }: LinearRGBColor) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * A display HEX does not identify a physical pigment, but the app's pure red,
 * blue, yellow, black, and white endpoints are an established UI contract.
 * We therefore add only the recipe-share-weighted endpoint offsets in OKLab.
 * In this raw calibration the full spectral interaction residual remains
 * intact. The white-tint wrapper below additionally constrains the final
 * quantised display path; neither display operation changes the exported
 * physical reflectance.
 */
const calibrateDisplayEndpointsRaw = (
  recipe: Required<PaintRecipe>,
  physicalLinear: LinearRGBColor,
): LinearRGBColor => {
  const pigmentUnits = PIGMENT_IDS.reduce(
    (total, pigment) => total + recipe[pigment],
    0,
  );
  if (pigmentUnits === 0) return gamutMapOklabToLinearSrgb(
    linearSrgbToOklab(physicalLinear),
  );

  const physical = linearSrgbToOklab(physicalLinear);
  const physicalBarycentre: OKLabColor = { l: 0, a: 0, b: 0 };
  const displayBarycentre: OKLabColor = { l: 0, a: 0, b: 0 };
  for (const pigment of PIGMENT_IDS) {
    const share = recipe[pigment] / pigmentUnits;
    if (share === 0) continue;
    const physicalEndpoint = PHYSICAL_ENDPOINTS_OKLAB[pigment];
    const displayEndpoint = DISPLAY_ENDPOINTS_OKLAB[pigment];
    physicalBarycentre.l += share * physicalEndpoint.l;
    physicalBarycentre.a += share * physicalEndpoint.a;
    physicalBarycentre.b += share * physicalEndpoint.b;
    displayBarycentre.l += share * displayEndpoint.l;
    displayBarycentre.a += share * displayEndpoint.a;
    displayBarycentre.b += share * displayEndpoint.b;
  }

  const calibrated = {
    l: physical.l + displayBarycentre.l - physicalBarycentre.l,
    a: physical.a + displayBarycentre.a - physicalBarycentre.a,
    b: physical.b + displayBarycentre.b - physicalBarycentre.b,
  };
  return gamutMapOklabToLinearSrgb(calibrated);
};

/**
 * Match a target display luminance while retaining the calibrated spectral
 * chromaticity. Darkening scales linear RGB; lightening mixes only as far
 * toward the established display white as the physical luminance requires.
 */
const setLinearLuminance = (
  colour: LinearRGBColor,
  targetLuminance: number,
): LinearRGBColor => {
  const currentLuminance = linearRelativeLuminance(colour);
  const target = clamp(targetLuminance, 0, 1);

  if (Math.abs(currentLuminance - target) <= 1e-12) return colour;
  if (currentLuminance > target && currentLuminance > Number.EPSILON) {
    const scale = target / currentLuminance;
    return {
      r: clamp(colour.r * scale),
      g: clamp(colour.g * scale),
      b: clamp(colour.b * scale),
    };
  }

  const whiteLuminance = linearRelativeLuminance(DISPLAY_WHITE_LINEAR);
  if (whiteLuminance <= currentLuminance + Number.EPSILON) return colour;
  const amount = clamp(
    (target - currentLuminance) / (whiteLuminance - currentLuminance),
  );
  return {
    r: clamp(colour.r + (DISPLAY_WHITE_LINEAR.r - colour.r) * amount),
    g: clamp(colour.g + (DISPLAY_WHITE_LINEAR.g - colour.g) * amount),
    b: clamp(colour.b + (DISPLAY_WHITE_LINEAR.b - colour.b) * amount),
  };
};

/**
 * Quantise a luminance-corrected colour inside a fixed ±4-code neighbourhood.
 * Selecting the brightest neighbour that does not exceed the physical target
 * removes visible one-channel rounding reversals while tightly bounding hue
 * displacement. Blue is solved directly for each nearby red/green pair, so
 * this remains an O(1) local search rather than a per-recipe tint lookup table.
 */
const quantizeAtOrBelowLuminance = (
  colour: LinearRGBColor,
  targetLuminance: number,
): RGBColor => {
  const encoded = {
    r: encodeSrgbFloat(colour.r),
    g: encodeSrgbFloat(colour.g),
    b: encodeSrgbFloat(colour.b),
  };
  const target = clamp(targetLuminance, 0, 1);
  let best:
    | { rgb: RGBColor; luminance: number; distance: number }
    | undefined;
  const channelRange = (channel: number) => ({
    minimum: Math.max(0, Math.floor(channel) - 4),
    maximum: Math.min(255, Math.ceil(channel) + 4),
  });
  const redRange = channelRange(encoded.r);
  const greenRange = channelRange(encoded.g);
  const blueRange = channelRange(encoded.b);

  for (let red = redRange.minimum; red <= redRange.maximum; red += 1) {
    const redLinear = decodeSrgb(red);
    for (
      let green = greenRange.minimum;
      green <= greenRange.maximum;
      green += 1
    ) {
      const greenLinear = decodeSrgb(green);
      const desiredBlueLinear =
        (target - 0.2126 * redLinear - 0.7152 * greenLinear) / 0.0722;
      const desiredBlue = Math.floor(encodeSrgbFloat(desiredBlueLinear));
      const blue = Math.min(
        blueRange.maximum,
        Math.max(blueRange.minimum, desiredBlue),
      );
      const rgb = { r: red, g: green, b: blue };
      const luminance = linearRelativeLuminance(rgbToLinearRgb(rgb));
      if (luminance > target + 1e-12) continue;
      const distance =
        (red - encoded.r) ** 2 +
        (green - encoded.g) ** 2 +
        (blue - encoded.b) ** 2;
      if (
        !best ||
        luminance > best.luminance + 1e-12 ||
        (Math.abs(luminance - best.luminance) <= 1e-12 &&
          distance < best.distance)
      ) {
        best = { rgb, luminance, distance };
      }
    }
  }

  return best?.rgb ?? linearRgbToRgb(colour);
};

/**
 * Preserve the measured lightening caused by Titanium White after endpoint
 * calibration. The target luminance follows the physical two-constant
 * spectrum from the same pigment mixture to measured PW6. Final 8-bit
 * quantisation is selected locally to suppress visible rounding reversals
 * without replacing the wavelength-dependent hue/chroma result.
 */
const calibrateDisplayEndpoints = (
  recipe: Required<PaintRecipe>,
  physicalLinear: LinearRGBColor,
): LinearRGBColor => {
  const calibrated = calibrateDisplayEndpointsRaw(recipe, physicalLinear);
  const nonWhiteUnits = PIGMENT_IDS.reduce(
    (total, pigment) =>
      pigment === "white" ? total : total + recipe[pigment],
    0,
  );
  if (recipe.white === 0 || nonWhiteUnits === 0) {
    return calibrated;
  }

  const baseRecipe: Required<PaintRecipe> = { ...recipe, white: 0 };
  const basePhysicalLinear = spectrumToLinearRgb(mixReflectance(baseRecipe));
  const whitePhysicalLinear = spectrumToLinearRgb(
    PIGMENT_REFLECTANCE.white,
  );
  const basePhysicalLuminance = linearRelativeLuminance(basePhysicalLinear);
  const whitePhysicalLuminance = linearRelativeLuminance(whitePhysicalLinear);
  const physicalRange = whitePhysicalLuminance - basePhysicalLuminance;
  const progress = physicalRange > Number.EPSILON
    ? clamp(
        (linearRelativeLuminance(physicalLinear) - basePhysicalLuminance) /
          physicalRange,
      )
    : recipe.white / (recipe.white + nonWhiteUnits);

  const baseDisplay = calibrateDisplayEndpointsRaw(
    baseRecipe,
    basePhysicalLinear,
  );
  const continuousBaseLuminance = linearRelativeLuminance(baseDisplay);
  const continuousTargetLuminance =
    continuousBaseLuminance +
    progress * (linearRelativeLuminance(DISPLAY_WHITE_LINEAR) -
      continuousBaseLuminance);
  const luminanceCorrected = setLinearLuminance(
    calibrated,
    continuousTargetLuminance,
  );

  // Quantisation is anchored separately to the exact 8-bit colour shown at
  // white = 0. Keeping this out of the continuous correction guarantees that
  // an infinitesimal white share converges to the unmodified spectral base.
  const quantizedBaseLuminance = linearRelativeLuminance(
    rgbToLinearRgb(linearRgbToRgb(baseDisplay)),
  );
  const whiteDisplayLuminance = linearRelativeLuminance(DISPLAY_WHITE_LINEAR);
  const quantizedTargetLuminance =
    quantizedBaseLuminance +
    progress * (whiteDisplayLuminance - quantizedBaseLuminance);

  return rgbToLinearRgb(
    quantizeAtOrBelowLuminance(
      luminanceCorrected,
      quantizedTargetLuminance,
    ),
  );
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
  const { red, blue, yellow, black, white } = recipe;
  const chromatic = red + blue + yellow;
  const coloured = chromatic + black;

  if (coloured + white === 0) return "透明な水";
  if (coloured === 0) return "雪の白";

  if (black > 0 && chromatic === 0 && white === 0) {
    return waterRatio > 0.35 ? "水墨の黒" : "黒";
  }
  if (black > 0 && chromatic === 0 && white > 0) {
    const blackShare = black / (black + white);
    return blackShare > 0.65
      ? "炭の灰"
      : blackShare > 0.3
        ? "やわらかな灰色"
        : "銀鼠";
  }

  const hasRedYellow =
    red > 0 && yellow > 0 && blue === 0 && black === 0;
  const hasYellowBlue =
    yellow > 0 && blue > 0 && red === 0 && black === 0;
  const hasRedBlue =
    red > 0 && blue > 0 && yellow === 0 && black === 0;
  const hasAllPrimaries = red > 0 && blue > 0 && yellow > 0;
  const whiteShare = white / (coloured + white);

  if (black / (coloured + white) > 0.42) {
    return hsl.l < 20 ? "墨を重ねた色" : "深い煤色";
  }
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
    const readsAsPurple = hsl.h >= 250 && hsl.h <= 345;
    if (whiteShare > 0.25) {
      return readsAsPurple ? "藤色ミルク" : "くすみローズ";
    }
    return readsAsPurple ? "薄明の紫" : "深いえんじ";
  }
  if (red > 0 && blue === 0 && yellow === 0 && black === 0) {
    if (whiteShare > 0.2) return "ミルクいちご";
    return waterRatio > 0.35 ? "花びらの赤" : "茜色";
  }
  if (blue > 0 && red === 0 && yellow === 0 && black === 0) {
    if (whiteShare > 0.2) return "朝もやの青";
    return waterRatio > 0.35 ? "雨上がりの青" : "深海の青";
  }
  if (yellow > 0 && red === 0 && blue === 0 && black === 0) {
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
  displayRgb?: RGBColor,
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

  const rgb = displayRgb ??
    linearRgbToRgb(
      calibrateDisplayEndpoints(
        recipe,
        spectrumToLinearRgb(mixReflectance(recipe)),
      ),
    );
  const hsl = rgbToHsl(rgb);
  const chromaticUnits = recipe.red + recipe.blue + recipe.yellow;
  const colouredUnits = chromaticUnits + recipe.black;

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
  const opticalLoad =
    chromaticUnits * 1.05 + recipe.black * 1.65 + recipe.white * 1.55;
  // One dry unit should already behave like body paint. Water then lowers the
  // pigment concentration into a translucent wash without changing its hue.
  // A single undiluted chromatic part must survive the palette field's
  // sub-pixel resampling as opaque body paint (alpha >= 245/255 at its
  // centre). Water still controls the much larger concentration term below.
  const dryCoverage = 1 - Math.exp(-opticalLoad * 3.7);
  const opacity = dryCoverage * (0.03 + 0.97 * concentration ** 0.8);
  const colourShare = colouredUnits / pigmentUnits;
  const chroma = hsl.s / 100;
  const darkness = 1 - hsl.l / 100;
  const perceivedStrength = Math.max(Math.sqrt(chroma), darkness ** 0.78);
  const intensity =
    (0.2 + 0.8 * perceivedStrength) *
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

/**
 * Reapply exact local paint/water quantities to an already computed display
 * RGB. Dense palette rendering caches the expensive spectral ratio colour,
 * but opacity and handling still have to use the unscaled local quantities.
 */
export function mixPaintProportionsFromRgb(
  recipeInput: PaintRecipe,
  rgb: RGBColor,
): MixedPaintColor {
  for (const [channel, value] of Object.entries(rgb)) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError(`${channel} must be an integer from 0 to 255`);
    }
  }
  return calculateMixedPaint(normalizePaintProportions(recipeInput), {
    ...rgb,
  });
}

/** Descriptive alias for callers that prefer a calculator-style name. */
export const calculatePaintColor = mixPaint;
