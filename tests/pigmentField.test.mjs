import assert from "node:assert/strict";
import test from "node:test";

import {
  compositeSpectralFilm,
  mixPigmentFilm,
  encodeSrgbByte,
  mixPaint,
  mixPaintProportionsRgb,
  mixPaintProportions,
  mixPigmentVectorRgb,
  rgbToOklab,
} from "../lib/colorScience.ts";
import {
  PigmentColourCache,
  applyPigmentPatch,
  capturePigmentPatch,
  compositePigmentLayers,
  coverageAt,
  createPigmentField,
  decodePigmentField,
  depositStamp,
  encodePigmentField,
  encodePigmentWetness,
  encodePigmentGlazes,
  decodePigmentGlazes,
  eraseStamp,
  liftStamp,
  linearToSrgbByte,
  massForCoverage,
  pigmentVectorFromRatio,
  quantisePigmentVector,
  ratioFromPigmentVector,
  renderPigmentField,
  settleWetPaint,
  smoothStamp,
  sharedPigmentColourCache,
  srgbByteToLinear,
  PIGMENT_COUNT,
} from "../lib/pigmentField.ts";
import { pigmentsFromRgb, pigmentMatchError } from "../lib/pigmentInverse.ts";

const SIZE = 64;
const CENTER = (SIZE / 2) * SIZE + SIZE / 2;

const render = (field) => {
  const image = {
    width: field.width,
    height: field.height,
    data: new Uint8ClampedArray(field.width * field.height * 4),
  };
  renderPigmentField(field, image, {
    x: 0,
    y: 0,
    width: field.width,
    height: field.height,
  }, { wetDarkening: 0 });
  return image;
};

const pixel = (image, index) => ({
  r: image.data[index * 4],
  g: image.data[index * 4 + 1],
  b: image.data[index * 4 + 2],
  a: image.data[index * 4 + 3],
});

const concentrations = (field, index) =>
  Array.from(field.pigment.slice(index * PIGMENT_COUNT, (index + 1) * PIGMENT_COUNT));

const totalMass = (field) => field.mass.reduce((sum, value) => sum + value, 0);

test("キャンバス画素の色はパレットの二定数KM混色と一致する", () => {
  const field = createPigmentField(SIZE, SIZE);
  depositStamp(field, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ red: 2, yellow: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  const image = render(field);
  const rgb = pixel(image, CENTER);
  const palette = mixPaintProportionsRgb({ red: 2, yellow: 1 });
  assert.deepEqual({ r: rgb.r, g: rgb.g, b: rgb.b }, palette);
  assert.equal(
    mixPaintProportions({ red: 2, yellow: 1 }).hex,
    mixPaint({ red: 2, yellow: 1 }).hex,
  );
});

test("乾いた青への薄い黄は下色の顔料を保持し別層の分光グレーズと一致する", () => {
  const field = createPigmentField(1, 1);
  const blue = createPigmentField(1, 1), yellow = createPigmentField(1, 1);
  for (const f of [field, blue]) depositStamp(f, .5, .5, 1, { pigment: pigmentVectorFromRatio({ blue: 1 }), mass: 1, wetness: 0, hardness: 1 });
  for (const f of [field, yellow]) depositStamp(f, .5, .5, 1, { pigment: pigmentVectorFromRatio({ yellow: 1 }), mass: .25, wetness: 0, hardness: 1 });
  assert.equal(field.glazes.get(0)[0].pigment[1], 1);
  assert.equal(field.glazes.get(0)[0].mass, 1);
  assert.equal(field.pigment[2], 1);
  assert.equal(field.mass[0], .25);
  const image = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
  const a = image(), b = image();
  const options = { relief: 0, wetDarkening: 0 };
  const area = { x: 0, y: 0, width: 1, height: 1 };
  compositePigmentLayers({ r: 243, g: 243, b: 243 }, [{ kind: "paint", field }], a, area, options);
  compositePigmentLayers({ r: 243, g: 243, b: 243 }, [{ kind: "paint", field: blue }, { kind: "paint", field: yellow }], b, area, options);
  assert.deepEqual(a.data, b.data);
});

test("厚い不透明な絵の具は乾いた下の色を覆い、水分の多い下地には混ざる", () => {
  const dry = createPigmentField(SIZE, SIZE);
  depositStamp(dry, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  depositStamp(dry, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ red: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  assert.ok(concentrations(dry, CENTER)[0] > 0.96, "dry underpaint should be hidden");

  const wet = createPigmentField(SIZE, SIZE);
  depositStamp(wet, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 1,
    wetness: 1,
    hardness: 1,
  });
  depositStamp(wet, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ red: 1 }),
    mass: 1,
    wetness: 0.5,
    hardness: 1,
  });
  const c = concentrations(wet, CENTER);
  assert.equal(c[1], .5, "equal wet pigment masses must remain 1:1");
  assert.equal(c[0], .5);
  assert.equal(wet.mass[CENTER], 2);
  assert.equal(wet.glazes.size, 0);
});

test("同じ絵の具を何度重ねても色がドリフトしない", () => {
  const field = createPigmentField(SIZE, SIZE);
  const paint = pigmentVectorFromRatio({ red: 3, white: 1, black: 0.2 });
  for (let index = 0; index < 120; index += 1) {
    depositStamp(field, SIZE / 2, SIZE / 2, 18, {
      pigment: paint,
      mass: 0.3,
      wetness: 0.25,
      hardness: 0.6,
    });
  }
  const c = concentrations(field, CENTER);
  for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
    assert.ok(Math.abs(c[channel] - paint[channel]) < 1e-5, `channel ${channel}`);
  }
  const rgb = pixel(render(field), CENTER);
  // Rendering quantises concentrations to 1/255 before the KM engine; the
  // result must equal the cache's colour exactly and the exact engine result
  // to within one display level.
  const cached = sharedPigmentColourCache.rgb(paint);
  assert.deepEqual({ r: rgb.r, g: rgb.g, b: rgb.b }, cached);
  const exact = mixPaintProportionsRgb(ratioFromPigmentVector(paint));
  for (const channel of ["r", "g", "b"]) {
    assert.ok(Math.abs(rgb[channel] - exact[channel]) <= 1, `${channel}: ${rgb[channel]} vs ${exact[channel]}`);
  }
});

test("水は顔料比率を変えず、塗膜の量と被覆率を下げる", () => {
  const paint = pigmentVectorFromRatio({ blue: 1, yellow: 1 });
  const thick = createPigmentField(SIZE, SIZE);
  const wash = createPigmentField(SIZE, SIZE);
  depositStamp(thick, SIZE / 2, SIZE / 2, 20, { pigment: paint, mass: 1, wetness: 0, hardness: 1 });
  depositStamp(wash, SIZE / 2, SIZE / 2, 20, { pigment: paint, mass: 0.12, wetness: 0.9, hardness: 1 });
  const a = pixel(render(thick), CENTER);
  const b = pixel(render(wash), CENTER);
  assert.deepEqual([a.r, a.g, a.b], [b.r, b.g, b.b]);
  assert.ok(a.a > 240, `thick alpha ${a.a}`);
  assert.ok(b.a > 60 && b.a < 160, `wash alpha ${b.a}`);
  assert.ok(Math.abs(coverageAt(thick, CENTER) - a.a / 255) < 0.01);
});

test("massForCoverage は被覆率→質量の逆関数になっている", () => {
  const paint = pigmentVectorFromRatio({ red: 1 });
  const field = createPigmentField(8, 8);
  depositStamp(field, 4, 4, 3, {
    pigment: paint,
    mass: massForCoverage(0.5, paint),
    wetness: 0,
    hardness: 1,
  });
  assert.ok(Math.abs(coverageAt(field, 4 * 8 + 4) - 0.5) < 1e-6);
});

test("消しゴムは質量を減らし、混色ブラシの持ち上げは絵の具を移動させる", () => {
  const field = createPigmentField(SIZE, SIZE);
  depositStamp(field, SIZE / 2, SIZE / 2, 20, {
    pigment: pigmentVectorFromRatio({ red: 1 }),
    mass: 1,
    wetness: 0.4,
    hardness: 1,
  });
  const before = totalMass(field);
  eraseStamp(field, SIZE / 2, SIZE / 2, 10, 1, 0.5);
  const afterErase = totalMass(field);
  assert.ok(afterErase < before && afterErase > before * 0.7);
  assert.ok(Math.abs(field.mass[CENTER] - 0.5) < 1e-6);

  const lifted = liftStamp(field, SIZE / 2, SIZE / 2, 10, 1, 0.3);
  assert.ok(lifted.mass > 0);
  assert.ok(lifted.pigment[0] > 0.99, "lifted paint keeps its pigment");
  assert.ok(totalMass(field) < afterErase, "lifted paint leaves the surface");
});

test("ぼかしは近傍平均へ寄せ、コストは半径に対して面積比例に留まる", () => {
  // Correctness: a hard blue/yellow seam softens into the neighbourhood mean.
  const field = createPigmentField(96, 96);
  depositStamp(field, 28, 48, 20, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  depositStamp(field, 68, 48, 20, {
    pigment: pigmentVectorFromRatio({ yellow: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  const seam = 48 * 96 + 45; // blue side, three pixels from the seam at 48
  const before = ratioFromPigmentVector(
    field.pigment.subarray(seam * PIGMENT_COUNT, (seam + 1) * PIGMENT_COUNT),
  );
  const massBefore = totalMass(field);
  smoothStamp(field, 48, 48, 20, 1);
  const after = ratioFromPigmentVector(
    field.pigment.subarray(seam * PIGMENT_COUNT, (seam + 1) * PIGMENT_COUNT),
  );
  assert.ok(after.yellow > before.yellow + 0.05, `${after.yellow}`);
  assert.ok(after.blue > after.yellow, "blur blends, it does not replace");
  assert.ok(Math.abs(totalMass(field) - massBefore) / massBefore < 0.02);

  // Cost: doubling the radius must not cost more than ~area growth (4×) with
  // headroom; an O(r⁴) kernel would grow ~16×.
  const time = (radius) => {
    const large = createPigmentField(512, 512);
    depositStamp(large, 256, 256, radius + 8, {
      pigment: pigmentVectorFromRatio({ red: 1 }),
      mass: 1,
      wetness: 0,
      hardness: 0.5,
    });
    smoothStamp(large, 256, 256, radius, 0.8); // warm up
    const started = performance.now();
    for (let repeat = 0; repeat < 3; repeat += 1) {
      smoothStamp(large, 256, 256, radius, 0.8);
    }
    return (performance.now() - started) / 3;
  };
  const small = time(35);
  const big = time(140);
  assert.ok(big < 40, `size 140 blur took ${big.toFixed(1)} ms per stamp`);
  assert.ok(big / Math.max(small, 0.05) < 40, `${small} → ${big}`);
});

test("水彩の定着で縁に顔料が集まり、総量はほぼ保たれる", () => {
  const field = createPigmentField(SIZE, SIZE);
  depositStamp(field, SIZE / 2, SIZE / 2, 16, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 0.25,
    wetness: 0.9,
    hardness: 0.9,
  });
  const before = totalMass(field);
  const interiorBefore = field.mass[CENTER];
  const edgeIndex = (SIZE / 2) * SIZE + SIZE / 2 + 15;
  settleWetPaint(field, { x: 12, y: 12, width: 40, height: 40 }, {
    diffusion: 1,
    edgeStrength: 0.8,
    granulation: 0,
  });
  const after = totalMass(field);
  assert.ok(Math.abs(after - before) / before < 1e-3, `mass ${before} -> ${after}`);
  assert.ok(
    field.mass[edgeIndex] > field.mass[CENTER] * 1.15,
    `edge ${field.mass[edgeIndex]} should be darker than interior ${field.mass[CENTER]}`,
  );
  assert.ok(field.mass[CENTER] < interiorBefore, "interior lightens");

  // Diffusion and granulation move pigment around; they never create it.
  const wash = createPigmentField(SIZE, SIZE);
  depositStamp(wash, SIZE / 2, SIZE / 2, 14, {
    pigment: pigmentVectorFromRatio({ blue: 2, red: 1 }),
    mass: 0.3,
    wetness: 0.95,
    hardness: 0.4,
  });
  const washBefore = totalMass(wash);
  const pigmentBefore = [0, 1].map((channel) => {
    let sum = 0;
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      sum += wash.pigment[index * PIGMENT_COUNT + channel] * wash.mass[index];
    }
    return sum;
  });
  settleWetPaint(wash, { x: 10, y: 10, width: 44, height: 44 }, {
    diffusion: 4,
    edgeStrength: 0.6,
    granulation: 0.8,
  });
  const washAfter = totalMass(wash);
  assert.ok(
    Math.abs(washAfter - washBefore) / washBefore < 1e-3,
    `wash mass ${washBefore} -> ${washAfter}`,
  );
  // Each pigment's total is conserved too (concentrations stay normalised).
  [0, 1].forEach((channel, position) => {
    let sum = 0;
    for (let index = 0; index < SIZE * SIZE; index += 1) {
      sum += wash.pigment[index * PIGMENT_COUNT + channel] * wash.mass[index];
    }
    assert.ok(
      Math.abs(sum - pigmentBefore[position]) / pigmentBefore[position] < 0.02,
      `pigment ${channel}: ${pigmentBefore[position]} -> ${sum}`,
    );
  });
});

test("パッチの取得と適用は元の状態を完全に復元する（Undo）", () => {
  const field = createPigmentField(SIZE, SIZE);
  depositStamp(field, 20, 20, 10, {
    pigment: pigmentVectorFromRatio({ red: 1 }),
    mass: 0.7,
    wetness: 0.3,
    hardness: 0.8,
  });
  const bounds = { x: 5, y: 5, width: 40, height: 40 };
  const before = capturePigmentPatch(field, bounds);
  const snapshot = {
    pigment: field.pigment.slice(),
    mass: field.mass.slice(),
    wetness: field.wetness.slice(),
  };
  depositStamp(field, 24, 22, 12, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 1,
    wetness: 0,
    hardness: 1,
  });
  applyPigmentPatch(field, before);
  assert.deepEqual(field.pigment, snapshot.pigment);
  assert.deepEqual(field.mass, snapshot.mass);
  assert.deepEqual(field.wetness, snapshot.wetness);
});

/** A painting with body strokes, washes, tints and traces of strong pigments. */
function paintedSample(size) {
  const field = createPigmentField(size, size);
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ratios = [
    { red: 1 },
    { blue: 1 },
    { yellow: 1 },
    { red: 1, white: 3 },
    { blue: 1, yellow: 2 },
    { black: 1, white: 8 },
    { red: 2, yellow: 1, blue: 0.3 },
    { white: 1 },
    { white: 400, blue: 1 },
    { white: 500, black: 1 },
  ];
  for (let index = 0; index < 60; index += 1) {
    depositStamp(field, 8 + random() * (size - 16), 8 + random() * (size - 16), 4 + random() * 14, {
      pigment: pigmentVectorFromRatio(ratios[index % ratios.length]),
      mass: 0.03 + random() * 1.2,
      wetness: 0,
      hardness: 0.3 + random() * 0.7,
    });
  }
  return field;
}

/** Largest per-channel colour and alpha differences between two renders. */
function renderDifference(original, restored) {
  let colour = 0;
  let alpha = 0;
  let painted = 0;
  for (let index = 0; index < original.data.length; index += 4) {
    if (original.data[index + 3] === 0 && restored.data[index + 3] === 0) continue;
    painted += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      colour = Math.max(colour, Math.abs(original.data[index + channel] - restored.data[index + channel]));
    }
    alpha = Math.max(alpha, Math.abs(original.data[index + 3] - restored.data[index + 3]));
  }
  return { colour, alpha, painted };
}

test("保存形式の往復は淡色の微量顔料も含めて色 2 階調・被覆 1 階調以内で復元し、2 回目以降は不変", () => {
  const field = paintedSample(128);
  const planes = encodePigmentField(field);
  assert.equal(planes.length, 3);
  const decoded = decodePigmentField(...planes);
  const glazePlane = encodePigmentGlazes(field);
  if (glazePlane) decodePigmentGlazes(decoded, glazePlane);
  const relief = (source) => {
    const image = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.width * source.height * 4) };
    renderPigmentField(source, image, { x: 0, y: 0, width: source.width, height: source.height }, { wetDarkening: 0 });
    return image;
  };
  const difference = renderDifference(relief(field), relief(decoded));
  assert.ok(difference.painted > 5_000, `painted ${difference.painted}`);
  // The rendering LUT itself steps by ≈1 (ΔE_OK < 0.01), so 2 is the floor a
  // stored field can reach; linear 8-bit shares reached 11 on tints.
  assert.ok(difference.colour <= 2, `colour delta ${difference.colour}`);
  assert.ok(difference.alpha <= 1, `alpha delta ${difference.alpha}`);

  // Pigment shares: large shares are within half a square-root step and a
  // trace of blue in white (1 : 400) keeps its size to a few percent instead
  // of rounding to zero as a linear byte would.
  let worstShare = 0;
  let worstTraceRatio = 0;
  let traces = 0;
  for (let index = 0; index < field.width * field.height; index += 1) {
    // Below half a mass step (6 / 65535) a pixel stores as unpainted.
    if (field.mass[index] < 6 / 65535) continue;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      const before = field.pigment[index * PIGMENT_COUNT + channel];
      const after = decoded.pigment[index * PIGMENT_COUNT + channel];
      worstShare = Math.max(worstShare, Math.abs(before - after));
      if (before > 0.001 && before < 0.01) {
        traces += 1;
        worstTraceRatio = Math.max(worstTraceRatio, Math.abs(after / before - 1));
      }
    }
    assert.ok(Math.abs(field.mass[index] - decoded.mass[index]) <= 6 / 65535 + 1e-6);
  }
  assert.ok(worstShare < 0.004, `share delta ${worstShare}`);
  assert.ok(traces > 100, `trace samples ${traces}`);
  // √0.001 × 255 ≈ 8 steps, so rounding is at worst 1/8 of a trace's size
  // (a linear byte would be 0.0039 ± 100 %, i.e. lost altogether).
  assert.ok(worstTraceRatio < 0.13, `trace relative error ${worstTraceRatio}`);

  // Storing the restored field again changes nothing: no drift over saves.
  const again = decodePigmentField(...encodePigmentField(decoded));
  const againGlaze = encodePigmentGlazes(decoded);
  if (againGlaze) decodePigmentGlazes(again, againGlaze);
  assert.deepEqual(Array.from(again.pigment), Array.from(decoded.pigment));
  assert.deepEqual(Array.from(again.mass), Array.from(decoded.mass));
  assert.deepEqual(Array.from(again.body), Array.from(decoded.body));
  const bounds = { x: 0, y: 0, width: field.width, height: field.height };
  const paper = { r: 247, g: 241, b: 230 };
  const displayed = (value) => compositeImage(paper, [{ kind: "paint", field: value }], bounds, { wetDarkening: 0 });
  assert.deepEqual(displayed(again).data, displayed(decoded).data,
    "finite-film canvas appearance must also be invariant across repeated saves");
});

/** The layout written by earlier builds (linear shares, 8-bit γ2.2 mass). */
function encodeLegacyPlanes(field, withBody) {
  const area = field.width * field.height;
  const a = new Uint8ClampedArray(area * 4);
  const b = new Uint8ClampedArray(area * 4);
  const c = new Uint8ClampedArray(area * 4);
  for (let index = 0; index < area; index += 1) {
    const offset = index * PIGMENT_COUNT;
    const target = index * 4;
    a[target + 3] = 255;
    b[target + 3] = 255;
    c[target + 3] = 255;
    const mass = field.mass[index];
    if (mass <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      a[target + channel] = Math.round(field.pigment[offset + channel] * 255);
    }
    b[target] = Math.round(field.pigment[offset + 3] * 255);
    b[target + 1] = Math.round(field.pigment[offset + 4] * 255);
    b[target + 2] = Math.round((mass / 6) ** (1 / 2.2) * 255);
    c[target] = Math.round(field.body[index] * 255);
  }
  const plane = (data) => ({ width: field.width, height: field.height, data });
  return withBody ? [plane(a), plane(b), plane(c)] : [plane(a), plane(b)];
}

test("水分の追加平面は濡れた色と混ざり方を再読込後も維持する", () => {
  const field = createPigmentField(16, 16);
  const red = pigmentVectorFromRatio({ red: 1 });
  depositStamp(field, 8, 8, 6, { pigment: red, mass: 0.8, wetness: 0.62, body: 0.9, hardness: 1 });
  const decoded = decodePigmentField(...encodePigmentField(field), encodePigmentWetness(field));
  const bounds = { x: 0, y: 0, width: 16, height: 16 };
  const paper = { r: 247, g: 241, b: 230 };
  const shown = (value) => compositeImage(paper, [{ kind: "paint", field: value }], bounds);
  const difference = renderDifference(shown(field), shown(decoded));
  assert.ok(difference.colour <= 1, `wet appearance delta ${difference.colour}`);
  for (let index = 0; index < field.wetness.length; index += 1) {
    assert.ok(Math.abs(field.wetness[index] - decoded.wetness[index]) <= 1 / 65535);
  }
  const blue = pigmentVectorFromRatio({ blue: 1 });
  for (const value of [field, decoded]) {
    depositStamp(value, 8, 8, 4, { pigment: blue, mass: 0.5, wetness: 0.6, hardness: 1 });
  }
  for (let p = 0; p < PIGMENT_COUNT; p += 1) {
    assert.ok(Math.abs(field.pigment[(8 * 16 + 8) * PIGMENT_COUNT + p] -
      decoded.pigment[(8 * 16 + 8) * PIGMENT_COUNT + p]) < 0.0001);
  }
});

test("旧形式(線形8bit・3枚)と旧々形式(2枚)の保存データも同じ復号で読め、2枚形式は厚み1になる", () => {
  const field = createPigmentField(SIZE, SIZE);
  depositStamp(field, 20, 32, 10, {
    pigment: pigmentVectorFromRatio({ red: 1 }),
    mass: 1,
    wetness: 0,
    body: 1,
    hardness: 0.6,
  });
  depositStamp(field, 44, 32, 10, {
    pigment: pigmentVectorFromRatio({ blue: 1 }),
    mass: 1,
    wetness: 0,
    body: 0,
    hardness: 0.6,
  });
  const thick = 32 * SIZE + 20;
  const flat = 32 * SIZE + 44;
  assert.ok(field.body[thick] > 0.95, `thick body ${field.body[thick]}`);
  assert.ok(field.body[flat] < 0.05, `flat body ${field.body[flat]}`);

  const current = decodePigmentField(...encodePigmentField(field));
  assert.ok(Math.abs(current.body[thick] - field.body[thick]) < 0.01);
  assert.ok(Math.abs(current.body[flat] - field.body[flat]) < 0.01);

  const legacy = decodePigmentField(...encodeLegacyPlanes(field, true));
  assert.ok(Math.abs(legacy.body[thick] - field.body[thick]) < 0.01);
  assert.ok(Math.abs(legacy.body[flat] - field.body[flat]) < 0.01);
  assert.ok(Math.abs(legacy.mass[flat] - field.mass[flat]) < 0.01);
  assert.ok(legacy.pigment[thick * PIGMENT_COUNT] > 0.99, "legacy red stays red");
  assert.ok(legacy.pigment[flat * PIGMENT_COUNT + 1] > 0.99, "legacy blue stays blue");

  const oldest = decodePigmentField(...encodeLegacyPlanes(field, false));
  assert.ok(oldest.body[thick] > 0.99, "two-plane files default to full body");
  assert.ok(oldest.body[flat] > 0.99);
  assert.ok(Math.abs(oldest.mass[flat] - field.mass[flat]) < 0.01);
  assert.ok(renderDifference(render(field), render(legacy)).colour <= 3);
});

test("インパストの陰影は厚い絵の具の縁だけに出て、平坦な面や薄い絵の具では出ない", () => {
  const paint = pigmentVectorFromRatio({ red: 3, white: 1 });
  const bounds = { x: 0, y: 0, width: SIZE, height: SIZE };
  const image = () => ({
    width: SIZE,
    height: SIZE,
    data: new Uint8ClampedArray(SIZE * SIZE * 4),
  });
  const luminance = (img, index) =>
    0.2126 * img.data[index * 4] + 0.7152 * img.data[index * 4 + 1] + 0.0722 * img.data[index * 4 + 2];

  const thick = createPigmentField(SIZE, SIZE);
  depositStamp(thick, 32, 32, 16, { pigment: paint, mass: 1, wetness: 0, body: 1, hardness: 0.6 });
  const flatRender = image();
  renderPigmentField(thick, flatRender, bounds, { wetDarkening: 0, relief: 0 });
  const reliefRender = image();
  renderPigmentField(thick, reliefRender, bounds, { wetDarkening: 0, relief: 1 });

  // The centre of an even film is flat: relief must not tint it.
  assert.ok(Math.abs(luminance(reliefRender, CENTER) - luminance(flatRender, CENTER)) <= 1);
  // Walk the diagonal through the soft edge: the side facing the light
  // (upper-left) brightens, the far side (lower-right) falls into shadow.
  let lit = 0;
  let shaded = 0;
  for (let k = 16; k < 48; k += 1) {
    const index = k * SIZE + k;
    const delta = luminance(reliefRender, index) - luminance(flatRender, index);
    if (k < 32) lit = Math.max(lit, delta);
    else shaded = Math.min(shaded, delta);
  }
  assert.ok(lit > 4, `lit edge brightens by ${lit}`);
  assert.ok(shaded < -4, `far edge darkens by ${shaded}`);

  // A pencil or ink film has no body, so the same shape renders identically.
  const thin = createPigmentField(SIZE, SIZE);
  depositStamp(thin, 32, 32, 16, { pigment: paint, mass: 1, wetness: 0, body: 0, hardness: 0.6 });
  const thinFlat = image();
  const thinRelief = image();
  renderPigmentField(thin, thinFlat, bounds, { wetDarkening: 0, relief: 0 });
  renderPigmentField(thin, thinRelief, bounds, { wetDarkening: 0, relief: 1 });
  assert.deepEqual(Array.from(thinRelief.data), Array.from(thinFlat.data));
});

test("表示色→顔料比率の逆変換は純色を復元し、色域内の色を再現する", () => {
  const yellow = pigmentsFromRgb(mixPaintProportionsRgb({yellow: 1}));
  assert.ok(yellow[2] > 0.98, `yellow share ${yellow[2]}`);
  const blue = pigmentsFromRgb(mixPaintProportionsRgb({blue: 1}));
  assert.ok(blue[1] > 0.98);
  const target = mixPaintProportionsRgb({ red: 1, yellow: 2, white: 1 });
  assert.ok(pigmentMatchError(target) < 0.02, `error ${pigmentMatchError(target)}`);
});

/* ------------------------------------------------------------------------ */
/* A5: linear-light compositing and display quantisation                    */
/* ------------------------------------------------------------------------ */

const deltaEOk = (a, b) => {
  const la = rgbToOklab(a);
  const lb = rgbToOklab(b);
  return Math.hypot(la.l - lb.l, la.a - lb.a, la.b - lb.b);
};

const compositeImage = (base, sources, bounds, options) => {
  const image = {
    width: bounds.width,
    height: bounds.height,
    data: new Uint8ClampedArray(bounds.width * bounds.height * 4),
  };
  compositePigmentLayers(base, sources, image, bounds, options);
  return image;
};

test("sRGB伝達関数の表引きは往復で同一、厳密式との差は1階調以内", () => {
  for (let byte = 0; byte < 256; byte += 1) {
    assert.equal(linearToSrgbByte(srgbByteToLinear(byte)), byte);
  }
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let sample = 0; sample < 20000; sample += 1) {
    const linear = random() ** 2;
    assert.ok(Math.abs(linearToSrgbByte(linear) - encodeSrgbByte(linear)) <= 1);
  }
  assert.equal(linearToSrgbByte(-0.1), 0);
  assert.equal(linearToSrgbByte(1.4), 255);
});

test("薄い絵の具の画面表示は有限厚分光モデルと一致し、RGBの半透明合成とは異なる", () => {
  const paper = { r: 255, g: 253, b: 248 };
  const blue = pigmentVectorFromRatio({ blue: 1 });
  const field = createPigmentField(16, 16);
  depositStamp(field, 8, 8, 6, {
    pigment: blue,
    mass: massForCoverage(0.5, blue),
    wetness: 0,
    body: 0,
    hardness: 1,
  });
  const centre = 8 * 16 + 8;
  const coverage = coverageAt(field, centre);
  assert.ok(Math.abs(coverage - 0.5) < 1e-4);

  const bounds = { x: 0, y: 0, width: 16, height: 16 };
  const image = compositeImage(paper, [{ kind: "paint", field }], bounds, {
    wetDarkening: 0,
    relief: 0,
  });
  const shown = pixel(image, centre);
  assert.equal(shown.a, 255, "the composite is opaque paper");

  // Independently call the uncached optical kernel to verify the canvas uses
  // the deposited mass and actual paper, rather than the old alpha surrogate.
  const paint = sharedPigmentColourCache.rgb(blue);
  const physical = compositeSpectralFilm(
    mixPigmentFilm(blue, field.mass[centre] * 24),
    Object.fromEntries(Object.entries(paper).map(([key, value]) => [key, srgbByteToLinear(value)])),
  );
  const expected = Object.fromEntries(Object.entries(physical).map(([key, value]) => [key, encodeSrgbByte(value)]));
  const gamma = {};
  for (const channel of ["r", "g", "b"]) {
    gamma[channel] = Math.round(paper[channel] * (1 - coverage) + paint[channel] * coverage);
  }
  for (const channel of ["r", "g", "b"]) {
    assert.ok(
      Math.abs(shown[channel] - expected[channel]) <= 1,
      `${channel}: ${shown[channel]} vs spectral ${expected[channel]}`,
    );
  }
  // Gamma-space blending (CSS opacity / drawImage) lands somewhere else.
  assert.ok(
    deltaEOk(shown, gamma) > 0.03,
    `spectral and gamma composites should differ: ${deltaEOk(shown, gamma)}`,
  );
  // Bare paper stays exactly the paper colour.
  assert.deepEqual(pixel(image, 0), { ...paper, a: 255 });
});

test("レイヤーの不透明度・非表示・線画はすべて同じリニア光合成で重なる", () => {
  const paper = { r: 250, g: 250, b: 250 };
  const bounds = { x: 0, y: 0, width: 8, height: 8 };
  const red = pigmentVectorFromRatio({ red: 1 });
  const layer = createPigmentField(8, 8);
  for (let index = 0; index < 64; index += 1) {
    layer.pigment.set(red, index * PIGMENT_COUNT);
    layer.mass[index] = 5; // fully covering
  }
  const paint = sharedPigmentColourCache.rgb(red);

  // 40 % layer opacity blends light, not bytes.
  const faded = pixel(
    compositeImage(paper, [{ kind: "paint", field: layer, opacity: 0.4 }], bounds, {
      wetDarkening: 0,
      relief: 0,
    }),
    0,
  );
  for (const channel of ["r", "g", "b"]) {
    const linear =
      srgbByteToLinear(paper[channel]) * 0.6 + srgbByteToLinear(paint[channel]) * 0.4;
    assert.ok(Math.abs(faded[channel] - encodeSrgbByte(linear)) <= 1, channel);
  }

  // A hidden layer contributes nothing.
  const hidden = pixel(
    compositeImage(paper, [{ kind: "paint", field: layer, visible: false }], bounds),
    0,
  );
  assert.deepEqual(hidden, { ...paper, a: 255 });

  // Ink (straight-alpha sRGB image) on top, half transparent black.
  const ink = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
  for (let index = 0; index < 64; index += 1) ink.data[index * 4 + 3] = 128;
  const inked = pixel(
    compositeImage(
      paper,
      [
        { kind: "paint", field: layer },
        { kind: "image", image: ink },
      ],
      bounds,
      { wetDarkening: 0, relief: 0 },
    ),
    0,
  );
  for (const channel of ["r", "g", "b"]) {
    const linear = srgbByteToLinear(paint[channel]) * (1 - 128 / 255);
    assert.ok(Math.abs(inked[channel] - encodeSrgbByte(linear)) <= 1, channel);
  }

  // An image base (a flattened legacy picture) is read where it lies.
  const base = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
  for (let index = 0; index < 64; index += 1) {
    base.data.set([20, 120, 220, 255], index * 4);
  }
  const onImage = pixel(compositeImage(base, [], bounds), 5);
  assert.deepEqual(onImage, { r: 20, g: 120, b: 220, a: 255 });
});

test("部分描き直しは全体描画と同じバイトを出し、表示・書き出し・塗りつぶしが一致する", () => {
  const paper = { r: 255, g: 253, b: 248 };
  const field = createPigmentField(48, 48);
  depositStamp(field, 20, 24, 12, {
    pigment: pigmentVectorFromRatio({ blue: 1, white: 1 }),
    mass: 0.8,
    wetness: 0.3,
    body: 1,
    hardness: 0.5,
  });
  depositStamp(field, 30, 22, 9, {
    pigment: pigmentVectorFromRatio({ yellow: 2, red: 1 }),
    mass: 0.4,
    wetness: 0,
    body: 1,
    hardness: 0.8,
  });
  const full = compositeImage(
    paper,
    [{ kind: "paint", field }],
    { x: 0, y: 0, width: 48, height: 48 },
  );
  const part = { x: 13, y: 9, width: 21, height: 27 };
  const partial = compositeImage(paper, [{ kind: "paint", field }], part);
  for (let row = 0; row < part.height; row += 1) {
    for (let column = 0; column < part.width; column += 1) {
      const a = ((part.y + row) * 48 + part.x + column) * 4;
      const b = (row * part.width + column) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        assert.equal(partial.data[b + channel], full.data[a + channel]);
      }
    }
  }
});

test("色LUTは近白域でも隣り合う段の差がΔE_OK 0.01未満で、量子化誤差も同程度に収まる", () => {
  const cache = new PigmentColourCache();
  for (const tinter of [0, 1, 2, 3]) {
    let worst = 0;
    let previous = null;
    for (let level = 0; level <= 1023; level += 1) {
      const c = (level / 1023) ** 2;
      const vector = new Float32Array(PIGMENT_COUNT);
      vector[tinter] = c;
      vector[4] = 1 - c;
      const rgb = cache.rgb(vector);
      if (previous) worst = Math.max(worst, deltaEOk(rgb, previous));
      previous = rgb;
    }
    assert.ok(worst < 0.01, `tinter ${tinter} in white: adjacent step ${worst}`);
  }
  let seed = 3;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let worstError = 0;
  for (let sample = 0; sample < 300; sample += 1) {
    const vector = new Float32Array(PIGMENT_COUNT);
    let sum = 0;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      vector[channel] = random() ** 3;
      sum += vector[channel];
    }
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) vector[channel] /= sum;
    const exact = mixPigmentVectorRgb(vector);
    worstError = Math.max(worstError, deltaEOk(exact, cache.rgb(vector)));
    // The snapped vector predicts the cached bytes exactly.
    assert.deepEqual(cache.rgb(vector), mixPigmentVectorRgb(quantisePigmentVector(vector)));
  }
  assert.ok(worstError < 0.01, `quantisation error ${worstError}`);
});

test("色キャッシュは世代交代しても正しい色を返し、直近の作業集合を保持する", () => {
  const cache = new PigmentColourCache(1024);
  const vectors = [];
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let index = 0; index < 3000; index += 1) {
    const vector = new Float32Array(PIGMENT_COUNT);
    let sum = 0;
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) {
      vector[channel] = random();
      sum += vector[channel];
    }
    for (let channel = 0; channel < PIGMENT_COUNT; channel += 1) vector[channel] /= sum;
    vectors.push(vector);
    cache.lookup(vector);
  }
  assert.ok(cache.size <= 2048, `retained ${cache.size}`);
  assert.ok(cache.size >= 1024, `retained ${cache.size}`);
  for (const vector of vectors) {
    assert.deepEqual(cache.rgb(vector), mixPigmentVectorRgb(quantisePigmentVector(vector)));
  }
});
