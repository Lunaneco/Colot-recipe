import assert from "node:assert/strict";
import test from "node:test";

import { PIGMENT_REFLECTANCE } from "../lib/colorScience.ts";
import {
  PAINT_CALIBRATION,
  PAINT_CALIBRATION_WAVELENGTHS_NM,
} from "../lib/paintCalibration.ts";
import {
  GOLDEN_DRAWDOWNS_2014,
  GOLDEN_DRAWDOWN_REFERENCE_METADATA,
  GOLDEN_DRAWDOWN_WAVELENGTHS_NM,
} from "./fixtures/goldenDrawdowns2014.mjs";

const pearsonCorrelation = (left, right) => {
  assert.equal(left.length, right.length);
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean =
    right.reduce((sum, value) => sum + value, 0) / right.length;
  const covariance = left.reduce(
    (sum, value, index) =>
      sum + (value - leftMean) * (right[index] - rightMean),
    0,
  );
  const leftVariance = left.reduce(
    (sum, value) => sum + (value - leftMean) ** 2,
    0,
  );
  const rightVariance = right.reduce(
    (sum, value) => sum + (value - rightMean) ** 2,
    0,
  );
  return covariance / Math.sqrt(leftVariance * rightVariance);
};

const calibrationWindow = (appKey) => {
  const startIndex = PAINT_CALIBRATION_WAVELENGTHS_NM.indexOf(400);
  const endIndex = PAINT_CALIBRATION_WAVELENGTHS_NM.indexOf(700);
  return PIGMENT_REFLECTANCE[appKey].slice(startIndex, endIndex + 1);
};

test("Golden independent reference is explicitly isolated from production calibration", () => {
  assert.equal(
    GOLDEN_DRAWDOWN_REFERENCE_METADATA.use,
    "independent-spectral-shape-validation-only",
  );
  assert.equal(
    GOLDEN_DRAWDOWN_REFERENCE_METADATA.substrate,
    "white Leneta drawdown card",
  );
  assert.equal(GOLDEN_DRAWDOWN_REFERENCE_METADATA.observer, "10 degree");
  assert.deepEqual(
    GOLDEN_DRAWDOWN_WAVELENGTHS_NM,
    PAINT_CALIBRATION_WAVELENGTHS_NM.filter(
      (wavelength) => wavelength >= 400 && wavelength <= 700,
    ),
  );
});

test("independent drawdowns retain the same exact product identities", () => {
  for (const [appKey, reference] of Object.entries(GOLDEN_DRAWDOWNS_2014)) {
    const calibration = PAINT_CALIBRATION[appKey];
    assert.equal(reference.appKey, appKey);
    assert.equal(reference.productNumber, calibration.productNumber);
    assert.equal(reference.paintName, calibration.paintName);
    assert.equal(
      reference.reflectancePercent.length,
      GOLDEN_DRAWDOWN_WAVELENGTHS_NM.length,
    );
    assert.ok(
      reference.reflectancePercent.every(
        (sample) => Number.isFinite(sample) && sample > 0 && sample <= 100,
      ),
    );
  }
});

test("RIT two-constant profiles preserve independent measured spectral shapes", () => {
  // Absolute reflectance is intentionally not fitted here: the independent
  // samples are finite films over white and use D65/10°, while the renderer is
  // an opaque infinite-thickness SPEX display assumption. Correlation checks
  // wavelength shape without hiding those real measurement differences.
  const minimumCorrelation = { red: 0.99, blue: 0.94, black: 0.85 };

  for (const [appKey, reference] of Object.entries(GOLDEN_DRAWDOWNS_2014)) {
    const measured = reference.reflectancePercent.map(
      (percent) => percent / 100,
    );
    const correlation = pearsonCorrelation(calibrationWindow(appKey), measured);
    assert.ok(
      correlation >= minimumCorrelation[appKey],
      `${appKey} independent spectral correlation ${correlation}`,
    );
  }
});

test("independent spectra preserve red, blue, and neutral-black signatures", () => {
  const red = GOLDEN_DRAWDOWNS_2014.red.reflectancePercent;
  const blue = GOLDEN_DRAWDOWNS_2014.blue.reflectancePercent;
  const black = GOLDEN_DRAWDOWNS_2014.black.reflectancePercent;
  const at = (samples, wavelength) =>
    samples[GOLDEN_DRAWDOWN_WAVELENGTHS_NM.indexOf(wavelength)];

  assert.ok(at(red, 650) / at(red, 550) > 15);
  assert.ok(at(blue, 470) / at(blue, 570) > 5);
  assert.ok(at(blue, 700) / at(blue, 570) > 10);
  assert.ok(Math.max(...black) - Math.min(...black) < 0.2);
});
