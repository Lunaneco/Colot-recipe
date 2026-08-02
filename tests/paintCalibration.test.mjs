import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CIE_1931_2_DEGREE_X,
  CIE_1931_2_DEGREE_Y,
  CIE_1931_2_DEGREE_Z,
  CIE_STANDARD_ILLUMINANT_D65,
} from "../lib/cieD65.ts";
import {
  PAINT_CALIBRATION,
  PAINT_CALIBRATION_METADATA,
  PAINT_CALIBRATION_WAVELENGTHS_NM,
  PAINT_KS,
  SAUNDERSON_K1,
  SAUNDERSON_K2,
  SPECTRAL_WAVELENGTHS,
} from "../lib/paintCalibration.ts";

test("CIE 1931 2° observer and D65 align with the paint wavelengths", () => {
  for (const data of [
    CIE_1931_2_DEGREE_X,
    CIE_1931_2_DEGREE_Y,
    CIE_1931_2_DEGREE_Z,
    CIE_STANDARD_ILLUMINANT_D65,
  ]) {
    assert.equal(data.length, PAINT_CALIBRATION_WAVELENGTHS_NM.length);
    assert.ok(data.every((sample) => Number.isFinite(sample) && sample >= 0));
  }

  assert.equal(CIE_1931_2_DEGREE_X[0], 0.001368);
  assert.equal(CIE_1931_2_DEGREE_Y[18], 0.995);
  assert.equal(CIE_1931_2_DEGREE_Z[27], 0);
  assert.equal(CIE_STANDARD_ILLUMINANT_D65[18], 100);
});
test("paint calibration covers 380–750 nm at 10 nm", () => {
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM.length, 38);
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM[0], 380);
  assert.equal(PAINT_CALIBRATION_WAVELENGTHS_NM.at(-1), 750);
  assert.ok(
    PAINT_CALIBRATION_WAVELENGTHS_NM.every(
      (wavelength, index) => wavelength === 380 + index * 10,
    ),
  );
  assert.strictEqual(SPECTRAL_WAVELENGTHS, PAINT_CALIBRATION_WAVELENGTHS_NM);
});

test("all five paints contain independent non-negative K and positive S curves", () => {
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
      paint.absorptionK.length,
      PAINT_CALIBRATION_WAVELENGTHS_NM.length,
    );
    assert.equal(
      paint.scatteringS.length,
      PAINT_CALIBRATION_WAVELENGTHS_NM.length,
    );
    assert.equal(paint.ks.length, PAINT_CALIBRATION_WAVELENGTHS_NM.length);
    assert.ok(
      paint.absorptionK.every(
        (sample) => Number.isFinite(sample) && sample >= 0,
      ),
    );
    assert.ok(
      paint.scatteringS.every(
        (sample) => Number.isFinite(sample) && sample > 0,
      ),
    );
    assert.ok(
      paint.ks.every(
        (sample, index) =>
          Math.abs(
            sample -
              paint.absorptionK[index] / paint.scatteringS[index],
          ) < 1e-14,
      ),
    );
    assert.strictEqual(PAINT_KS[key], paint.ks);
  }
});

test("profile records two-constant semantics and Saunderson conditions", () => {
  assert.equal(
    PAINT_CALIBRATION_METADATA.model,
    "Kubelka-Munk two-constant (K and S)",
  );
  assert.equal(
    PAINT_CALIBRATION_METADATA.ratioBasis,
    "relative-parts-of-complete-paint",
  );
  assert.equal(
    PAINT_CALIBRATION_METADATA.opticalAssumption,
    "opaque, optically infinite paint layer",
  );
  assert.deepEqual(PAINT_CALIBRATION_METADATA.displayColorimetry, {
    illuminant: "CIE standard illuminant D65",
    observer: "CIE 1931 2 degree",
    outputSpace: "sRGB",
    chromaticAdaptation: "none (same D65 viewing illuminant)",
  });
  assert.deepEqual(PAINT_CALIBRATION_METADATA.saunderson, {
    k1: 0.03,
    k2: 0.65,
    renderGeometry:
      "specular excluded (SPEX), Wacton rendering assumption",
  });
  assert.equal(SAUNDERSON_K1, 0.03);
  assert.equal(SAUNDERSON_K2, 0.65);
});

test("Wacton transcription provenance is pinned to an immutable source", () => {
  assert.equal(
    PAINT_CALIBRATION_METADATA.dataSource.transcriptionCommit,
    "3c888f040d89117a7c452076097beabd7ed766c8",
  );
  assert.equal(
    PAINT_CALIBRATION_METADATA.dataSource.transcriptionFileSha256,
    "43c454d8e17f040ee82a1fde4aabd6c8bd0c30a7d2e99b5c0dfe0ca871870e2c",
  );
  assert.match(
    PAINT_CALIBRATION_METADATA.dataSource.transcriptionUrl,
    /3c888f040d89117a7c452076097beabd7ed766c8/,
  );

  const embeddedProfile = Object.fromEntries(
    Object.entries(PAINT_CALIBRATION).map(([key, paint]) => [
      key,
      {
        absorptionK: paint.absorptionK,
        scatteringS: paint.scatteringS,
      },
    ]),
  );
  const embeddedProfileSha256 = createHash("sha256")
    .update(JSON.stringify(embeddedProfile))
    .digest("hex");
  assert.equal(
    embeddedProfileSha256,
    PAINT_CALIBRATION_METADATA.dataSource.embeddedProfileSha256,
  );
});

test("fixed profiles retain their measured paint and pigment identities", () => {
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
      yellow: [1191, "Hansa Yellow Opaque", "PY74"],
      black: [1010, "Bone Black", "PBk9"],
      white: [1380, "Titanium White", "PW6"],
    },
  );
});

test("selected source coefficients guard against transcription drift", () => {
  assert.equal(PAINT_CALIBRATION.red.absorptionK[0], 0.483940380996401);
  assert.equal(PAINT_CALIBRATION.blue.scatteringS[20], 0.027205465821255);
  assert.equal(PAINT_CALIBRATION.yellow.absorptionK[12], 0.552126302713133);
  assert.equal(PAINT_CALIBRATION.black.scatteringS[37], 0.0256406548024857);
  assert.equal(PAINT_CALIBRATION.white.absorptionK[18], 0.0000175276099827109);
});

test("Titanium White is measured-derived and has finite absorption plus unit scattering", () => {
  const white = PAINT_CALIBRATION.white;

  assert.equal(white.sourceKind, "measured-derived-two-constant-profile");
  assert.ok(white.absorptionK.some((sample) => sample > 0));
  assert.ok(white.scatteringS.every((sample) => sample === 1));
  assert.ok(white.ks.some((sample) => sample > 0));
});
