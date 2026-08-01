import type { PigmentId } from "./types";

/**
 * Measured reference profile for the app's paint-mixing model.
 *
 * Golden Artist Colors supplied the source spreadsheet to Andrew Glassner and
 * Eric Haines and explicitly allowed them to share it. The four measured rows
 * below are from Golden Heavy Body acrylic, dry 6 mil drawdowns over a white
 * Leneta card (laid down wet at 10 mil). The spreadsheet contains reflectance
 * and the corresponding single-constant Kubelka–Munk K/S values at 400–700 nm.
 *
 * The data is not relicensed as MIT. See THIRD_PARTY_NOTICES.md.
 */

export const PAINT_CALIBRATION_WAVELENGTHS_NM = Object.freeze(
  Array.from({ length: 31 }, (_, index) => 400 + index * 10),
);

/** Stable short name retained for callers of the spectral engine. */
export const SPECTRAL_WAVELENGTHS = PAINT_CALIBRATION_WAVELENGTHS_NM;

export type PaintCalibrationProfileVersion =
  | "golden-heavy-body-white-drawdown-2014-v1";

export interface PaintCalibrationMetadata {
  readonly profileVersion: PaintCalibrationProfileVersion;
  readonly model: "Kubelka-Munk single-constant (K/S)";
  readonly ratioBasis: "relative-parts-of-complete-paint";
  readonly ratioDescription: string;
  readonly paintLine: "Golden Artist Colors Heavy Body acrylic";
  readonly sourceColorimetry: {
    readonly illuminant: "D65";
    readonly observer: "CIE 1964 10 degree";
  };
  readonly displayColorimetry: {
    readonly illuminant: "D65";
    readonly observer: "CIE 1964 10 degree";
    readonly outputSpace: "sRGB (D65, 2 degree white point)";
    readonly chromaticAdaptation: "Bradford";
  };
  readonly specimen: {
    readonly wetFilmThicknessMil: 10;
    readonly measuredDryFilmThicknessMil: 6;
    readonly backing: "white Leneta drawdown card";
  };
  readonly wavelengthStartNm: 400;
  readonly wavelengthEndNm: 700;
  readonly wavelengthIntervalNm: 10;
  readonly dataSource: {
    readonly title: "Reflectance Data for Golden HB 10 mil Drawdowns over White";
    readonly provider: "Golden Artist Colors, Inc.";
    readonly publishers: "Andrew Glassner and Eric Haines";
    readonly pageUrl: string;
    readonly downloadUrl: string;
    readonly sharingStatement: string;
  };
}

export const PAINT_CALIBRATION_METADATA: PaintCalibrationMetadata =
  Object.freeze({
    profileVersion: "golden-heavy-body-white-drawdown-2014-v1",
    model: "Kubelka-Munk single-constant (K/S)",
    ratioBasis: "relative-parts-of-complete-paint",
    ratioDescription:
      "A 2:1 recipe gives the first complete paint twice the modeled K/S contribution of the second; app parts are relative and are not claimed to be grams or dry-pigment mass.",
    paintLine: "Golden Artist Colors Heavy Body acrylic",
    sourceColorimetry: Object.freeze({
      illuminant: "D65",
      observer: "CIE 1964 10 degree",
    }),
    displayColorimetry: Object.freeze({
      illuminant: "D65",
      observer: "CIE 1964 10 degree",
      outputSpace: "sRGB (D65, 2 degree white point)",
      chromaticAdaptation: "Bradford",
    }),
    specimen: Object.freeze({
      wetFilmThicknessMil: 10,
      measuredDryFilmThicknessMil: 6,
      backing: "white Leneta drawdown card",
    }),
    wavelengthStartNm: 400,
    wavelengthEndNm: 700,
    wavelengthIntervalNm: 10,
    dataSource: Object.freeze({
      title:
        "Reflectance Data for Golden HB 10 mil Drawdowns over White",
      provider: "Golden Artist Colors, Inc.",
      publishers: "Andrew Glassner and Eric Haines",
      pageUrl: "https://www.realtimerendering.com/golden.html",
      downloadUrl:
        "https://www.realtimerendering.com/downloads/GoldenSpectra.zip",
      sharingStatement:
        "Golden supplied the spectral data and allowed Glassner and Haines to share it with others.",
    }),
  });

export interface SingleConstantPaintCalibration {
  readonly appKey: PigmentId;
  readonly paintName: string;
  readonly productNumber: number | null;
  readonly colourIndex: string | null;
  readonly sourceKind:
    | "measured-white-backed-drawdown"
    | "ideal-scattering-white-reference";
  readonly sourceLabD65_10Degree: Readonly<{
    l: number;
    a: number;
    b: number;
  }> | null;
  /** Source percent-reflectance values converted to the 0–1 range. */
  readonly measuredReflectance: readonly number[];
  /** Source spreadsheet's single-constant Kubelka–Munk K/S values. */
  readonly ks: readonly number[];
}

const measuredPaint = (
  appKey: PigmentId,
  paintName: string,
  productNumber: number,
  colourIndex: string,
  sourceLabD65_10Degree: { l: number; a: number; b: number },
  reflectancePercent: readonly number[],
  ks: readonly number[],
): SingleConstantPaintCalibration =>
  Object.freeze({
    appKey,
    paintName,
    productNumber,
    colourIndex,
    sourceKind: "measured-white-backed-drawdown" as const,
    sourceLabD65_10Degree: Object.freeze(sourceLabD65_10Degree),
    measuredReflectance: Object.freeze(
      reflectancePercent.map((sample) => sample / 100),
    ),
    ks: Object.freeze([...ks]),
  });

const IDEAL_WHITE_REFLECTANCE = Object.freeze(
  PAINT_CALIBRATION_WAVELENGTHS_NM.map(() => 1),
);
const IDEAL_WHITE_KS = Object.freeze(
  PAINT_CALIBRATION_WAVELENGTHS_NM.map(() => 0),
);

/**
 * App keys mapped to fixed source rows. Hansa Yellow Medium is PY73, not the
 * distinct Hansa Yellow Opaque PY74 product. The shared workbook has no
 * Titanium White row, so white is explicitly modeled as the K/S=0 scattering
 * reference rather than pretending that an unmeasured PW6 spectrum exists.
 */
export const PAINT_CALIBRATION: Readonly<
  Record<PigmentId, SingleConstantPaintCalibration>
> = Object.freeze({
  red: measuredPaint(
    "red",
    "Pyrrole Red",
    1277,
    "PR254",
    { l: 42.4217, a: 55.2668, b: 31.8041 },
    [
      4.14, 4.05, 4.01, 4.05, 4.09, 4.07, 4.15, 4.11, 4.1, 4.15,
      4.12, 4.19, 4.16, 4.08, 4.14, 4.27, 4.51, 4.55, 4.92, 12.24,
      28.62, 45.2, 58.61, 68.97, 75.72, 79.66, 82.01, 83.84, 85.41,
      86.74, 87.86,
    ],
    [
      11.098, 11.3659, 11.4889, 11.3659, 11.2454, 11.3054, 11.0689,
      11.186, 11.2156, 11.0689, 11.1565, 10.9541, 11.04, 11.2753,
      11.098, 10.731, 10.109, 10.0118, 9.1872, 3.1462, 0.8901,
      0.3322, 0.1461, 0.0698, 0.0389, 0.026, 0.0197, 0.0156, 0.0125,
      0.0101, 0.0084,
    ],
  ),
  blue: measuredPaint(
    "blue",
    "Cerulean Blue Chromium",
    1050,
    "PB36",
    { l: 41.7025, a: -11.9904, b: -32.609 },
    [
      23.25, 23.02, 24, 24.86, 26.24, 29.04, 32.18, 33.38, 32.1,
      32.63, 31.41, 25.2, 17.4, 11.69, 8.24, 6.54, 5.98, 5.56, 5.18,
      5.04, 5.16, 5.32, 5.32, 5.27, 5.56, 6.95, 11.02, 19.43, 32.65,
      47.43, 60.33,
    ],
    [
      1.2668, 1.2871, 1.2033, 1.1356, 1.0367, 0.867, 0.7147,
      0.6648, 0.7181, 0.6955, 0.7489, 1.1101, 1.9606, 3.3356,
      5.1092, 6.678, 7.3911, 8.0206, 8.6784, 8.9458, 8.7157, 8.4251,
      8.4251, 8.514, 8.0206, 6.229, 3.5923, 1.6705, 0.6946, 0.2913,
      0.1304,
    ],
  ),
  yellow: measuredPaint(
    "yellow",
    "Hansa Yellow Medium",
    1190,
    "PY73",
    { l: 78.6762, a: 19.4212, b: 90.4851 },
    [
      4.24, 4.24, 4.26, 4.23, 4.3, 4.25, 4.36, 4.4, 4.58, 5.12,
      7.66, 14.57, 27.55, 42.91, 56.63, 66.06, 71.52, 75.06, 77.77,
      79.83, 81.32, 82.4, 83.35, 84.34, 85.21, 86.18, 86.82, 87.13,
      87.21, 87.29, 87.5,
    ],
    [
      10.8137, 10.8137, 10.7584, 10.8415, 10.6494, 10.786, 10.4897,
      10.3856, 9.9399, 8.7912, 5.5657, 2.5046, 0.9526, 0.3798,
      0.1661, 0.0872, 0.0567, 0.0414, 0.0318, 0.0255, 0.0215,
      0.0188, 0.0166, 0.0145, 0.0128, 0.0111, 0.01, 0.0095, 0.0094,
      0.0093, 0.0089,
    ],
  ),
  black: measuredPaint(
    "black",
    "Bone Black",
    1010,
    "PBk9",
    { l: 24.0311, a: 0.066, b: -0.3317 },
    [
      4.25, 4.2, 4.19, 4.18, 4.2, 4.15, 4.18, 4.14, 4.16, 4.14,
      4.11, 4.12, 4.13, 4.11, 4.1, 4.1, 4.1, 4.1, 4.08, 4.09,
      4.12, 4.1, 4.11, 4.1, 4.09, 4.1, 4.14, 4.09, 4.09, 4.09, 4.1,
    ],
    [
      10.786, 10.9258, 10.9541, 10.9826, 10.9258, 11.0689, 10.9826,
      11.098, 11.04, 11.098, 11.186, 11.1565, 11.1272, 11.186,
      11.2156, 11.2156, 11.2156, 11.2156, 11.2753, 11.2454, 11.1565,
      11.2156, 11.186, 11.2156, 11.2454, 11.2156, 11.098, 11.2454,
      11.2454, 11.2454, 11.2156,
    ],
  ),
  white: Object.freeze({
    appKey: "white",
    paintName: "Ideal scattering white reference",
    productNumber: null,
    colourIndex: null,
    sourceKind: "ideal-scattering-white-reference" as const,
    sourceLabD65_10Degree: null,
    measuredReflectance: IDEAL_WHITE_REFLECTANCE,
    ks: IDEAL_WHITE_KS,
  }),
});

/** Convenience view used by the mixer and calibration tests. */
export const PAINT_KS: Readonly<Record<PigmentId, readonly number[]>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(PAINT_CALIBRATION).map(([key, paint]) => [
        key,
        paint.ks,
      ]),
    ) as Record<PigmentId, readonly number[]>,
  );
