import {
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
 * Measured-data subtractive mixing for the palette and overlapping strokes.
 *
 * The five app paints retain measured Golden Heavy Body K/S profiles
 * (see paintCalibration.ts) and contribute independent absorption K(λ) and
 * scattering S(λ). Relative parts combine K and S separately (Duncan), the
 * opaque Kubelka–Munk reflectance is Saunderson-corrected, then integrated
 * under D65 with the CIE 1931 2° observer and converted to sRGB. Colours that
 * fall outside sRGB are brought back along constant OKLab hue and lightness.
 * Nothing else touches the colour: the swatch of a pure paint *is* its
 * spectral masstone. This is deliberately different from averaging RGB:
 * overlapping pigments remove shared wavelength bands.
 */

export type PigmentKey = PigmentId;
export type MaterialKey = MaterialId;
export type PaintRecipe = Partial<Record<MaterialKey, number>>;

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface HSLColor {
  h: number;
  s: number;
  l: number;
}

export interface MixedPaintColor {
  recipe: Required<PaintRecipe>;
  totalUnits: number;
  pigmentUnits: number;
  hex: `#${string}`;
  rgb: RGBColor;
  hsl: HSLColor;
  opacity: number;
  waterRatio: number;
  pigmentRatio: Record<PigmentKey, number>;
  intensity: number;
  viscosity: number;
  spread: number;
  dryingSpeed: number;
  name: string;
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Relative hiding power of one unit of each complete paint. Bone black and
 * titanium white cover more strongly than the chromatic pigments. Shared by
 * the palette opacity model and the canvas paint field so one body-paint
 * stroke on paper hides the same amount as one unit on the palette.
 */
export const PIGMENT_HIDING_POWER: Readonly<Record<PigmentKey, number>> =
  Object.freeze({
    red: 1.05,
    blue: 1.05,
    yellow: 1.05,
    black: 1.65,
    white: 1.55,
  });

/** Coverage = 1 - exp(-COVERAGE_RATE × optical load). */
export const COVERAGE_RATE = 3.7;

export const coverageFromOpticalLoad = (opticalLoad: number) =>
  opticalLoad <= 0 ? 0 : 1 - Math.exp(-Math.max(0, opticalLoad) * COVERAGE_RATE);

const kmRatioToInternalReflectance = (ratio: number) =>
  clamp(1 / (1 + ratio + Math.sqrt(ratio * ratio + 2 * ratio)));

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

/* ------------------------------------------------------------------------ */
/* Spectral mixing kernel                                                   */
/* ------------------------------------------------------------------------ */

const WAVELENGTH_COUNT = PAINT_CALIBRATION_WAVELENGTHS_NM.length;

/** Calibration tables flattened to `[pigment × wavelength]` for the kernel. */
const KERNEL_ABSORPTION = new Float64Array(PIGMENT_IDS.length * WAVELENGTH_COUNT);
const KERNEL_SCATTERING = new Float64Array(PIGMENT_IDS.length * WAVELENGTH_COUNT);
PIGMENT_IDS.forEach((pigment, pigmentIndex) => {
  for (let wavelength = 0; wavelength < WAVELENGTH_COUNT; wavelength += 1) {
    const slot = pigmentIndex * WAVELENGTH_COUNT + wavelength;
    KERNEL_ABSORPTION[slot] = PAINT_CALIBRATION[pigment].absorptionK[wavelength];
    KERNEL_SCATTERING[slot] = PAINT_CALIBRATION[pigment].scatteringS[wavelength];
  }
});

/**
 * Two-constant Kubelka–Munk mixture of pigment amounts given as a vector in
 * `PIGMENT_IDS` order (starting at `offset`), written as reflectance per
 * calibration wavelength into `out`. Returns false (and writes a white
 * spectrum) when the vector holds no pigment. Allocation-free so the canvas
 * can evaluate it per pixel.
 */
function mixReflectanceInto(
  amounts: ArrayLike<number>,
  offset: number,
  out: Float64Array,
): boolean {
  let pigmentUnits = 0;
  for (let pigment = 0; pigment < PIGMENT_IDS.length; pigment += 1) {
    pigmentUnits += amounts[offset + pigment];
  }
  if (pigmentUnits === 0) {
    out.fill(1);
    return false;
  }
  for (let wavelength = 0; wavelength < WAVELENGTH_COUNT; wavelength += 1) {
    let mixedK = 0;
    let mixedS = 0;
    for (let pigment = 0; pigment < PIGMENT_IDS.length; pigment += 1) {
      const units = amounts[offset + pigment];
      if (units === 0) continue;
      const slot = pigment * WAVELENGTH_COUNT + wavelength;
      mixedK += units * KERNEL_ABSORPTION[slot];
      mixedS += units * KERNEL_SCATTERING[slot];
    }
    out[wavelength] = kmCoefficientsToReflectance(
      mixedK / pigmentUnits,
      mixedS / pigmentUnits,
    );
  }
  return true;
}

const recipeAmounts = (recipe: Required<PaintRecipe>): Float64Array =>
  Float64Array.from(PIGMENT_IDS, (pigment) => recipe[pigment]);

const mixReflectance = (
  recipe: Required<PaintRecipe>,
): readonly number[] => {
  const out = new Float64Array(WAVELENGTH_COUNT);
  if (!mixReflectanceInto(recipeAmounts(recipe), 0, out)) {
    return NO_PIGMENT_REFLECTANCE;
  }
  return Array.from(out);
};

export function mixPaintReflectanceProportions(
  recipeInput: PaintRecipe = {},
): readonly number[] {
  return mixReflectance(normalizePaintProportions(recipeInput));
}

export type LinearRGBColor = { r: number; g: number; b: number };
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
  reflectance: ArrayLike<number>,
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
  reflectance: ArrayLike<number>,
): LinearRGBColor => {
  const { x, y, z } = spectrumToXyz2Degree(reflectance);
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

const encodeSrgb = (channel: number) => Math.round(encodeSrgbFloat(channel));

/** Linear-light channel (0..1) → sRGB byte, exact transfer function. */
export const encodeSrgbByte = encodeSrgb;

const linearRgbToRgb = ({ r, g, b }: LinearRGBColor): RGBColor => ({
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

/** sRGB byte (0..255) → linear-light channel (0..1), exact transfer function. */
export const decodeSrgbByte = decodeSrgb;

const rgbToLinearRgb = ({ r, g, b }: RGBColor): LinearRGBColor => ({
  r: decodeSrgb(r),
  g: decodeSrgb(g),
  b: decodeSrgb(b),
});

const linearSrgbToOklab = ({ r, g, b }: LinearRGBColor): OKLabColor => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
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
    r: 4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    g: -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    b: -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  };
};

const isLinearSrgbInGamut = ({ r, g, b }: LinearRGBColor) =>
  r >= -1e-7 && r <= 1 + 1e-7 &&
  g >= -1e-7 && g <= 1 + 1e-7 &&
  b >= -1e-7 && b <= 1 + 1e-7;

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

/**
 * Display colour of a physical (spectral) linear-sRGB result. The only
 * transformation is gamut mapping for colours the display cannot show.
 */
const displayLinearRgb = (physicalLinear: LinearRGBColor): LinearRGBColor =>
  isLinearSrgbInGamut(physicalLinear) ? physicalLinear : gamutMapOklabToLinearSrgb(linearSrgbToOklab(physicalLinear));

/** Final gamut mapping, after every optical film and image layer. */
export const displayLinearColor = displayLinearRgb;

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
  if (hasAllPrimaries && (hsl.s < 38 || (hsl.h >= 10 && hsl.h < 50 && hsl.l < 45))) {
    return hsl.l < 30 ? "深い土の色" : "静かなアースカラー";
  }
  // Two-pigment names follow the rendered hue so a red-dominated red+yellow is
  // still called a red and a yellow-dominated one an orange.
  if (hasRedYellow) {
    if (whiteShare > 0.25) return "アプリコットミルク";
    if (waterRatio > 0.35) return "薄日のオレンジ";
    if (hsl.h >= 345 || hsl.h < 6) return "紅赤";
    if (hsl.h < 16) return "朱色";
    if (hsl.h < 30) return "夕焼けオレンジ";
    if (hsl.h < 40) return "蜜柑色";
    return "たまごの黄";
  }
  if (hasYellowBlue) {
    if (whiteShare > 0.25) return "若葉のミント";
    if (waterRatio > 0.35) return "雨上がりの緑";
    if (hsl.h < 85) return "萌黄色";
    if (hsl.h < 150) return "深い森の緑";
    return "深い青緑";
  }
  if (hasRedBlue) {
    if (whiteShare > 0.25) return "藤色ミルク";
    if (hsl.h >= 240 && hsl.h < 300) return "菫色";
    return hsl.h >= 300 && hsl.h <= 345 ? "薄明の紫" : "深いえんじ";
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

  const rgb =
    displayRgb ??
    linearRgbToRgb(displayLinearRgb(spectrumToLinearRgb(mixReflectance(recipe))));
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
  const opticalLoad = PIGMENT_IDS.reduce(
    (total, pigment) => total + recipe[pigment] * PIGMENT_HIDING_POWER[pigment],
    0,
  );
  const dryCoverage = coverageFromOpticalLoad(opticalLoad);
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

export function mixPaintProportions(
  recipeInput: PaintRecipe = {},
): MixedPaintColor {
  return calculateMixedPaint(normalizePaintProportions(recipeInput));
}

/**
 * Display colour only, for per-pixel canvas rendering. This is exactly the
 * `rgb` that `mixPaintProportions` would report for the same proportions,
 * without the name/HSL/physical-property bookkeeping.
 */
export function mixPaintProportionsRgb(recipeInput: PaintRecipe = {}): RGBColor {
  return mixPigmentVectorRgb(recipeAmounts(normalizePaintProportions(recipeInput)));
}

const KERNEL_REFLECTANCE = new Float64Array(WAVELENGTH_COUNT);

/**
 * Display colour of pigment amounts given as a vector in `PIGMENT_IDS`
 * order starting at `offset` — the per-pixel form of
 * `mixPaintProportionsRgb`, sharing its kernel so a canvas pixel and the
 * palette report the same bytes for the same proportions.
 */
export function mixPigmentVectorRgb(
  amounts: ArrayLike<number>,
  offset = 0,
): RGBColor {
  if (!mixReflectanceInto(amounts, offset, KERNEL_REFLECTANCE)) {
    return { r: 255, g: 255, b: 255 };
  }
  return linearRgbToRgb(
    displayLinearRgb(spectrumToLinearRgb(KERNEL_REFLECTANCE)),
  );
}

/** Finite paint film, before the air/paint surface correction. */
export interface SpectralPaintFilm {
  reflectance: Float64Array;
  transmittance: Float64Array;
}

/**
 * Stable finite-depth two-flux solution. Unlike sinh/cosh, this form cannot
 * overflow in a thick, strongly absorbing film. The limiting cases also cover
 * clear water, a purely scattering material and Beer–Lambert absorption.
 * See Curtis et al. (1997), section 5, equations 2–5.
 */
export function finiteKmLayer(k: number, s: number, thickness: number) {
  if (![k, s, thickness].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new RangeError("K, S and thickness must be finite and non-negative");
  }
  if (thickness === 0) return { reflectance: 0, transmittance: 1 };
  if (s === 0) return { reflectance: 0, transmittance: Math.exp(-k * thickness) };
  if (k === 0) {
    const transmittance = 1 / (1 + s * thickness);
    return { reflectance: 1 - transmittance, transmittance };
  }
  const scale = Math.max(k, s);
  const kn = k / scale;
  const sn = s / scale;
  if (kn === 0) { const transmittance = 1 / (1 + s * thickness); return { reflectance: 1 - transmittance, transmittance }; }
  const b = Math.sqrt(kn * (kn + 2 * sn));
  const depth = b * (scale * thickness);
  const attenuation = Math.exp(-depth);
  const loss = -Math.expm1(-2 * depth);
  const denominator = b * (1 + attenuation * attenuation) + (kn + sn) * loss;
  return {
    reflectance: sn * loss / denominator,
    transmittance: 2 * b * attenuation / denominator,
  };
}

export interface PigmentOptics { rInfinity: Float64Array; extinction: Float64Array; scattering: Float64Array }
/** Prepare coefficients once per mixture; thickness remains continuous. */
export function preparePigmentOptics(amounts: ArrayLike<number>, offset = 0): PigmentOptics {
  let total = 0;
  for (let p = 0; p < PIGMENT_IDS.length; p++) total += amounts[offset + p];
  const rInfinity = new Float64Array(WAVELENGTH_COUNT), extinction = new Float64Array(WAVELENGTH_COUNT), scattering = new Float64Array(WAVELENGTH_COUNT);
  for (let w = 0; w < WAVELENGTH_COUNT; w++) {
    let k = 0, s = 0;
    for (let p = 0; p < PIGMENT_IDS.length; p++) { const share = total > 0 ? amounts[offset + p] / total : 0; k += share * KERNEL_ABSORPTION[p * WAVELENGTH_COUNT + w]; s += share * KERNEL_SCATTERING[p * WAVELENGTH_COUNT + w]; }
    const b = Math.sqrt(k * (k + 2 * s));
    extinction[w] = b; scattering[w] = s;
    rInfinity[w] = s > 0 ? s / (k + s + b) : 0;
  }
  return { rInfinity, extinction, scattering };
}
export function filmFromPigmentOptics(optics: PigmentOptics, thickness: number): SpectralPaintFilm {
  const reflectance = new Float64Array(WAVELENGTH_COUNT), transmittance = new Float64Array(WAVELENGTH_COUNT);
  for (let w = 0; w < WAVELENGTH_COUNT; w++) {
    const r = optics.rInfinity[w], b = optics.extinction[w];
    if (b === 0) { const t = 1 / (1 + optics.scattering[w] * thickness); reflectance[w] = 1 - t; transmittance[w] = t; continue; }
    const e = Math.exp(-b * thickness), loss = -Math.expm1(-2 * b * thickness);
    const denominator = (1 - r * r) + r * r * loss;
    reflectance[w] = r * loss / denominator;
    transmittance[w] = (1 - r * r) * e / denominator;
  }
  return { reflectance, transmittance };
}

/** Thickness is relative optical depth, not a measured length in micrometres. */
export function mixPigmentFilm(
  amounts: ArrayLike<number>,
  thickness: number,
  offset = 0,
): SpectralPaintFilm {
  if (!Number.isFinite(thickness) || thickness < 0) {
    throw new RangeError("thickness must be finite and non-negative");
  }
  let total = 0;
  for (let p = 0; p < PIGMENT_IDS.length; p += 1) {
    const value = amounts[offset + p];
    if (!Number.isFinite(value) || value < 0) throw new RangeError("invalid pigment amount");
    total += value;
  }
  const reflectance = new Float64Array(WAVELENGTH_COUNT);
  const transmittance = new Float64Array(WAVELENGTH_COUNT).fill(1);
  if (total === 0 || thickness === 0) return { reflectance, transmittance };
  for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
    let k = 0;
    let s = 0;
    for (let p = 0; p < PIGMENT_IDS.length; p += 1) {
      const share = amounts[offset + p] / total;
      k += share * KERNEL_ABSORPTION[p * WAVELENGTH_COUNT + w];
      s += share * KERNEL_SCATTERING[p * WAVELENGTH_COUNT + w];
    }
    const layer = finiteKmLayer(k, s, thickness);
    reflectance[w] = layer.reflectance;
    transmittance[w] = layer.transmittance;
  }
  return { reflectance, transmittance };
}

/** Multiple internal reflections between a film and an opaque substrate. */
export function filmReflectanceOverGround(r: number, t: number, ground: number) {
  return clamp(r + t * t * ground / Math.max(1e-15, 1 - r * ground));
}

const RGB_SPECTRAL_WEIGHTS = Array.from({ length: WAVELENGTH_COUNT }, (_, w) => {
  const e = CIE_STANDARD_ILLUMINANT_D65[w] * spectralNormalizer;
  const x = CIE_1931_2_DEGREE_X[w] * e;
  const y = CIE_1931_2_DEGREE_Y[w] * e;
  const z = CIE_1931_2_DEGREE_Z[w] * e;
  return [
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
  ];
});

// Right inverse of the 3×38 integration matrix for digital-only boundary
// residuals. A display-primary RGB is not always a real reflecting material.
const gram = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => RGB_SPECTRAL_WEIGHTS.reduce((sum, weights) => sum + weights[r] * weights[c], 0)));
const augmented = gram.map((row, i) => [...row, ...[0, 1, 2].map(j => i === j ? 1 : 0)]);
for (let p = 0; p < 3; p++) {
  const pivot = augmented[p][p];
  for (let c = 0; c < 6; c++) augmented[p][c] /= pivot;
  for (let r = 0; r < 3; r++) if (r !== p) { const gain = augmented[r][p]; for (let c = 0; c < 6; c++) augmented[r][c] -= gain * augmented[p][c]; }
}
const rgbRightInverse = augmented.map(row => row.slice(3));

/** Internal reflectance and any digital-white excess above the measured interface. */
export interface SpectralSurface {
  reflectance: Float64Array;
  residual: Float64Array;
}

const inverseSaunderson = (value: number) => Math.min(1, Math.max(0, value) /
  ((1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) + SAUNDERSON_K2 * Math.max(0, value)));

/**
 * RGB images do not specify a unique reflectance spectrum. Reconstruct a
 * bounded, smooth metamer only at that external-input boundary. Paint films
 * always retain the original measured 38 bands throughout the layer stack.
 */
const externalSpectra = new Map<string, SpectralSurface>();
export function spectralSurfaceFromLinearRgb(rgb: LinearRGBColor): SpectralSurface {
  const cacheKey = `${rgb.r}:${rgb.g}:${rgb.b}`;
  const cached = externalSpectra.get(cacheKey);
  if (cached) return cloneSpectralSurface(cached);
  const target = [rgb.r, rgb.g, rgb.b];
  const level = (target[0] + target[1] + target[2]) / 3;
  const spectrum = new Float64Array(WAVELENGTH_COUNT).fill(level);
  // Projected gradient with a weak neighbouring-band smoothness penalty.
  // The spectral integration matrix has fixed small norm; this step is safe.
  for (let iteration = 0; iteration < 180; iteration += 1) {
    const actual = [0, 0, 0];
    for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
      for (let c = 0; c < 3; c += 1) actual[c] += spectrum[w] * RGB_SPECTRAL_WEIGHTS[w][c];
    }
    const next = new Float64Array(WAVELENGTH_COUNT);
    for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
      let gradient = 0;
      for (let c = 0; c < 3; c += 1) gradient += (actual[c] - target[c]) * RGB_SPECTRAL_WEIGHTS[w][c];
      const smooth = 2 * spectrum[w] - spectrum[Math.max(0, w - 1)] - spectrum[Math.min(WAVELENGTH_COUNT - 1, w + 1)];
      next[w] = clamp(spectrum[w] - 1.4 * (gradient + 0.00002 * smooth));
    }
    spectrum.set(next);
  }
  const reflectance = new Float64Array(WAVELENGTH_COUNT);
  const residual = new Float64Array(WAVELENGTH_COUNT);
  for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
    reflectance[w] = inverseSaunderson(spectrum[w]);
    residual[w] = spectrum[w] - applySaundersonCorrection(reflectance[w]);
  }
  const actual = [0, 0, 0];
  for (let w = 0; w < WAVELENGTH_COUNT; w++) for (let c = 0; c < 3; c++) actual[c] += spectrum[w] * RGB_SPECTRAL_WEIGHTS[w][c];
  const error = actual.map((v, c) => target[c] - v);
  const coefficients = rgbRightInverse.map(row => row.reduce((sum, value, c) => sum + value * error[c], 0));
  for (let w = 0; w < WAVELENGTH_COUNT; w++) residual[w] += coefficients.reduce((sum, value, c) => sum + value * RGB_SPECTRAL_WEIGHTS[w][c], 0);
  const surface = { reflectance, residual };
  if (externalSpectra.size >= 4096) externalSpectra.clear();
  externalSpectra.set(cacheKey, cloneSpectralSurface(surface));
  return surface;
}

export function cloneSpectralSurface(surface: SpectralSurface): SpectralSurface {
  return { reflectance: surface.reflectance.slice(), residual: surface.residual.slice() };
}

/** Ordered optical glaze; no intermediate RGB integration or gamut mapping. */
export function applySpectralFilm(
  surface: SpectralSurface, film: SpectralPaintFilm, opacity = 1, lighting = 1,
) {
  for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
    const ground = surface.reflectance[w];
    const r = film.reflectance[w];
    const t = film.transmittance[w];
    const through = t / Math.max(1e-15, 1 - r * ground);
    const returned = filmReflectanceOverGround(r, t, ground);
    const residual = surface.residual[w] * through * through;
    if (opacity === 1 && lighting === 1) {
      surface.reflectance[w] = returned;
      surface.residual[w] = residual;
    } else {
      const before = applySaundersonCorrection(ground) + surface.residual[w];
      const after = (applySaundersonCorrection(returned) + residual) * lighting;
      const value = before + (after - before) * opacity;
      const internal = inverseSaunderson(value);
      surface.reflectance[w] = internal;
      surface.residual[w] = value - applySaundersonCorrection(internal);
    }
  }
}

export function blendSpectralSurface(target: SpectralSurface, source: SpectralSurface, alpha: number) {
  for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
    const a = applySaundersonCorrection(target.reflectance[w]) + target.residual[w];
    const b = applySaundersonCorrection(source.reflectance[w]) + source.residual[w];
    const value = a + (b - a) * alpha;
    target.reflectance[w] = inverseSaunderson(value);
    target.residual[w] = value - applySaundersonCorrection(target.reflectance[w]);
  }
}

export function spectralSurfaceToLinearRgb(surface: SpectralSurface): LinearRGBColor {
  let r = 0, g = 0, b = 0;
  for (let w = 0; w < WAVELENGTH_COUNT; w += 1) {
    const value = applySaundersonCorrection(surface.reflectance[w]) + surface.residual[w];
    r += value * RGB_SPECTRAL_WEIGHTS[w][0]; g += value * RGB_SPECTRAL_WEIGHTS[w][1]; b += value * RGB_SPECTRAL_WEIGHTS[w][2];
  }
  return displayLinearRgb({ r, g, b });
}

/** Algebraically identical one-film path without per-pixel spectrum allocations. */
export function compositePigmentOpticsRgb(optics: PigmentOptics, thickness: number, ground: SpectralSurface, opacity = 1, lighting = 1, mapToDisplay = true): LinearRGBColor {
  let red = 0, green = 0, blue = 0;
  for (let w = 0; w < WAVELENGTH_COUNT; w++) {
    const infinite = optics.rInfinity[w], extinction = optics.extinction[w];
    let r: number, t: number;
    if (extinction === 0) { t = 1 / (1 + optics.scattering[w] * thickness); r = 1 - t; }
    else {
      const depth = extinction * thickness, e = Math.exp(-depth);
      const loss = depth < 1e-5 ? -Math.expm1(-2 * depth) : 1 - e * e;
      const denominator = 1 - infinite * infinite + infinite * infinite * loss;
      r = infinite * loss / denominator; t = (1 - infinite * infinite) * e / denominator;
    }
    const substrate = ground.reflectance[w];
    const through = t / Math.max(1e-15, 1 - r * substrate);
    const returned = filmReflectanceOverGround(r, t, substrate);
    const before = applySaundersonCorrection(substrate) + ground.residual[w];
    const after = (applySaundersonCorrection(returned) + ground.residual[w] * through * through) * lighting;
    const value = before + (after - before) * opacity;
    red += value * RGB_SPECTRAL_WEIGHTS[w][0]; green += value * RGB_SPECTRAL_WEIGHTS[w][1]; blue += value * RGB_SPECTRAL_WEIGHTS[w][2];
  }
  const result = { r: red, g: green, b: blue };
  return mapToDisplay ? displayLinearRgb(result) : result;
}

export function compositeSpectralFilm(film: SpectralPaintFilm, background: LinearRGBColor): LinearRGBColor {
  const surface = spectralSurfaceFromLinearRgb(background);
  applySpectralFilm(surface, film);
  return spectralSurfaceToLinearRgb(surface);
}

export const rgbToOklab = (rgb: RGBColor) =>
  linearSrgbToOklab(rgbToLinearRgb(rgb));

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

/** Backward-compatible calculator alias. */
export const calculatePaintColor = mixPaint;

/** Pure measured paint reflectances, retained for independent research checks. */
export const PIGMENT_REFLECTANCE: Readonly<Record<PigmentId, readonly number[]>> = Object.freeze(
  Object.fromEntries(PIGMENT_IDS.map(p => [p, Object.freeze([...mixPaintReflectanceProportions({[p]: 1})])])) as Record<PigmentId, readonly number[]>,
);
