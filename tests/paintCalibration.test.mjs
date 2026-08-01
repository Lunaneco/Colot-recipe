import assert from "node:assert/strict";
import test from "node:test";

import {
  CIE_1964_10_DEGREE_X,
  CIE_1964_10_DEGREE_Y,
  CIE_1964_10_DEGREE_Z,
  CIE_STANDARD_ILLUMINANT_D65,
} from "../lib/cieD65.ts";
import {
  PAINT_CALIBRATION,
  PAINT_CALIBRATION_METADATA,
  PAINT_CALIBRATION_WAVELENGTHS_NM,
  PAINT_KS,
  SPECTRAL_WAVELENGTHS,
} from "../lib/paintCalibration.ts";

const labFromReflectanceD65_10Degree = (reflectance) => {
  const denominator = CIE_STANDARD_ILLUMINANT_D65.reduce(
    (total, illuminant, index) =>
      total + illuminant * CIE_1964_10_DEGREE_Y[index],
    0,
  );
  const integrate = (spectrum, matchingFunction) =>
    spectrum.reduce(
      (total, sample, index) =>
        total +
        sample *
          CIE_STANDARD_ILLUMINANT_D65[index] *
          matchingFunction[index],
      0,
    ) / denominator;
  const white = PAINT_CALIBRATION_WAVELENGTHS_NM.map(() => 1);
  const whitePoint = {
    x: integrate(white, CIE_1964_10_DEGREE_X),
    y: integrate(white, CIE_1964_10_DEGREE_Y),
    z: integrate(white, CIE_1964_10_DEGREE_Z),
  };
  const xyz = {
    x: integrate(reflectance, CIE_1964_10_DEGREE_X),
    y: integrate(reflectance, CIE_1964_10_DEGREE_Y),
    z: integrate(reflectance, CIE_1964_10_DEGREE_Z),
  };
  const delta = 6 / 29;
  const f = (value) =>
    value > delta ** 3
      ? Math.cbrt(value)
      : value / (3 * delta ** 2) + 4 / 29;
  const fx = f(xyz.x / whitePoint.x);
  const fy = f(xyz.y / whitePoint.y);
  const fz = f(xyz.z / whitePoint.z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
};

test("CIE 1964 10° observer and D65 align with paint wavelengths", () => {
  for (const data of [
    CIE_1964_10_DEGREE_X,
    CIE_1964_10_DEGREE_Y,
    CIE_1964_10_DEGREE_Z,
    CIE_STANDARD_ILLUMINANT_D65,
  ]) {
    assert.equal(data.length, PAINT_CALIBRATION_WAVELENGTHS_NM.length);
    assert.ok(data.every((sample) => Number.isFinite(sample) && sample >= 0));
  }
  assert.equal(CIE_1964_10_DEGREE_Y[16], 0.99734);
  assert.equal(CIE_STANDARD_ILLUMINANT_D65[16], 100);
  assert.ok(CIE_1964_10_DEGREE_Z.slice(16).every((sample) => sample === 0));
});

test("paint calibration covers 400–700 nm at 10 nm", () => {
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM.length, 31);
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM[0], 400);
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM.at(-1), 700);
  assert.ok(
    PAINT_CALIBRATION_WAVELENGTHS_NM.every(
      (wavelength, index) => wavelength === 400 + index * 10,
    ),
  );
});

test("four source paints and the explicit ideal-white reference are complete", () => {
  assert.deepEqual(Object.keys(PAINT_CALIBRATION).sort(), [
    "black",
    "blue",
    "red",
    "white",
    "yellow",
  ]);

  for (const [key, paint] of Object.entries(PAINT_CALIBRATION)) {
    assert.equal(paint.appKey, key);
    assert.equal(
      paint.measuredReflectance.length,
      PAINT_CALIBRATION_WAVELENGTHS_NM.length,
    );
    assert.equal(paint.ks.length, PAINT_CALIBRATION_WAVELENGTHS_NM.length);
    assert.ok(
      paint.measuredReflectance.every(
        (sample) => Number.isFinite(sample) && sample > 0 && sample <= 1,
      ),
    );
    assert.ok(paint.ks.every((sample) => Number.isFinite(sample) && sample >= 0));
  }

  assert.ok(PAINT_CALIBRATION.white.ks.every((sample) => sample === 0));
  assert.ok(
    PAINT_CALIBRATION.white.measuredReflectance.every(
      (sample) => sample === 1,
    ),
  );
});

test("profile records source conditions and relative-parts semantics", () => {
  assert.equal(
    PAINT_CALIBRATION_METADATA.model,
    "Kubelka-Munk single-constant (K/S)",
  );
  assert.equal(
    PAINT_CALIBRATION_METADATA.ratioBasis,
    "relative-parts-of-complete-paint",
  );
  assert.deepEqual(PAINT_CALIBRATION_METADATA.sourceColorimetry, {
    illuminant: "D65",
    observer: "CIE 1964 10 degree",
  });
  assert.deepEqual(PAINT_CALIBRATION_METADATA.specimen, {
    wetFilmThicknessMil: 10,
    measuredDryFilmThicknessMil: 6,
    backing: "white Leneta drawdown card",
  });
  assert.strictEqual(SPECTRAL_WAVELENGTHS, PAINT_CALIBRATION_WAVELENGTHS_NM);
  assert.strictEqual(PAINT_KS.red, PAINT_CALIBRATION.red.ks);
});

test("fixed workbook rows retain their product and pigment identities", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(PAINT_CALIBRATION).map(([key, paint]) => [
        key,
        [paint.productNumber, paint.paintName, paint.colourIndex],
      ]),
    ),
    {
      red: [1277, "Pyrrole Red", "PR254"],
      blue: [1050, "Cerulean Blue Chromium", "PB36"],
      yellow: [1190, "Hansa Yellow Medium", "PY73"],
      black: [1010, "Bone Black", "PBk9"],
      white: [null, "Ideal scattering white reference", null],
    },
  );
  assert.equal(PAINT_CALIBRATION.red.measuredReflectance[0], 0.0414);
  assert.equal(PAINT_CALIBRATION.blue.ks[30], 0.1304);
  assert.equal(PAINT_CALIBRATION.yellow.ks[10], 5.5657);
  assert.equal(PAINT_CALIBRATION.black.measuredReflectance[18], 0.0408);
});

test("source K/S agrees with the workbook's independently rounded reflectance", () => {
  for (const paint of Object.values(PAINT_CALIBRATION)) {
    if (paint.sourceKind !== "measured-white-backed-drawdown") continue;
    for (let index = 0; index < paint.ks.length; index += 1) {
      const reflectance = paint.measuredReflectance[index];
      const inferred = (1 - reflectance) ** 2 / (2 * reflectance);
      assert.ok(
        Math.abs(inferred - paint.ks[index]) < 0.035,
        `${paint.paintName} ${400 + index * 10}nm: ${inferred} vs ${paint.ks[index]}`,
      );
    }
  }
});

test("source spectra reproduce the workbook's D65/10° Lab within rounding", () => {
  for (const paint of Object.values(PAINT_CALIBRATION)) {
    if (!paint.sourceLabD65_10Degree) continue;
    const calculated = labFromReflectanceD65_10Degree(
      paint.measuredReflectance,
    );
    for (const channel of ["l", "a", "b"]) {
      assert.ok(
        Math.abs(
          calculated[channel] - paint.sourceLabD65_10Degree[channel],
        ) < 0.35,
        `${paint.paintName} ${channel}: ${calculated[channel]} vs ${paint.sourceLabD65_10Degree[channel]}`,
      );
    }
  }
});
