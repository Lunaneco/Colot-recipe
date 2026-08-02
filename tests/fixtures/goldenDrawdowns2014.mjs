/**
 * Independent Golden Heavy Body drawdown measurements shared by Golden via
 * realtimerendering.com. These measurements are validation-only: they are
 * finite dry films over a white Leneta card, measured at D65/10 degrees, and
 * must not be substituted for the opaque two-constant calibration profiles.
 *
 * Source workbook SHA-256:
 * 584a38368c4af637a1253b6465b9f71493e38c65340092a0cfe9f73b3ed227cf
 * See THIRD_PARTY_NOTICES.md for sharing and attribution details.
 */

export const GOLDEN_DRAWDOWN_WAVELENGTHS_NM = Object.freeze(
  Array.from({ length: 31 }, (_, index) => 400 + index * 10),
);

const drawdown = (
  appKey,
  productNumber,
  paintName,
  labD65_10Degree,
  reflectancePercent,
) =>
  Object.freeze({
    appKey,
    productNumber,
    paintName,
    labD65_10Degree: Object.freeze(labD65_10Degree),
    reflectancePercent: Object.freeze(reflectancePercent),
  });

export const GOLDEN_DRAWDOWNS_2014 = Object.freeze({
  red: drawdown(
    "red",
    1277,
    "Pyrrole Red",
    { l: 42.4217, a: 55.2668, b: 31.8041 },
    [
      4.14, 4.05, 4.01, 4.05, 4.09, 4.07, 4.15, 4.11, 4.1, 4.15, 4.12,
      4.19, 4.16, 4.08, 4.14, 4.27, 4.51, 4.55, 4.92, 12.24, 28.62, 45.2,
      58.61, 68.97, 75.72, 79.66, 82.01, 83.84, 85.41, 86.74, 87.86,
    ],
  ),
  blue: drawdown(
    "blue",
    1050,
    "Cerulean Blue Chromium",
    { l: 41.7025, a: -11.9904, b: -32.609 },
    [
      23.25, 23.02, 24, 24.86, 26.24, 29.04, 32.18, 33.38, 32.1, 32.63,
      31.41, 25.2, 17.4, 11.69, 8.24, 6.54, 5.98, 5.56, 5.18, 5.04, 5.16,
      5.32, 5.32, 5.27, 5.56, 6.95, 11.02, 19.43, 32.65, 47.43, 60.33,
    ],
  ),
  black: drawdown(
    "black",
    1010,
    "Bone Black",
    { l: 24.0311, a: 0.066, b: -0.3317 },
    [
      4.25, 4.2, 4.19, 4.18, 4.2, 4.15, 4.18, 4.14, 4.16, 4.14, 4.11,
      4.12, 4.13, 4.11, 4.1, 4.1, 4.1, 4.1, 4.08, 4.09, 4.12, 4.1,
      4.11, 4.1, 4.09, 4.1, 4.14, 4.09, 4.09, 4.09, 4.1,
    ],
  ),
});

export const GOLDEN_DRAWDOWN_REFERENCE_METADATA = Object.freeze({
  use: "independent-spectral-shape-validation-only",
  measuredState: "10 mil wet drawdown, approximately 6 mil after drying",
  substrate: "white Leneta drawdown card",
  illuminant: "D65",
  observer: "10 degree",
  wavelengthStartNm: 400,
  wavelengthEndNm: 700,
  wavelengthIntervalNm: 10,
  sourcePageUrl: "https://www.realtimerendering.com/golden.html",
  sourceWorkbookSha256:
    "584a38368c4af637a1253b6465b9f71493e38c65340092a0cfe9f73b3ed227cf",
});
