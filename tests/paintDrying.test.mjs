import assert from "node:assert/strict";
import test from "node:test";
import { advancePaintDrying, resumeStoredPaint, PAINT_DRYING_INTERVAL_MS } from "../lib/paintDrying.ts";
import { createPigmentField, depositStamp, pigmentVectorFromRatio, capturePigmentPatch, applyPigmentPatch } from "../lib/pigmentField.ts";

const startTime = 1_000_000;
function painting() {
  const field = createPigmentField(16, 16);
  depositStamp(field, 8, 8, 6, {
    pigment: pigmentVectorFromRatio({ blue: 3, white: 1 }),
    mass: 0.4,
    wetness: 0.55,
    hardness: 1,
  });
  return field;
}

test("throttled tabs and offline reloads dry by the same elapsed time", () => {
  const live = painting();
  const reopened = painting();
  for (let tick = 1; tick <= 20; tick += 1) {
    advancePaintDrying(live, startTime + (tick - 1) * PAINT_DRYING_INTERVAL_MS,
      startTime + tick * PAINT_DRYING_INTERVAL_MS);
  }
  resumeStoredPaint(reopened, startTime, startTime + 20 * PAINT_DRYING_INTERVAL_MS);
  for (let index = 0; index < live.mass.length; index += 1) {
    assert.ok(Math.abs(live.wetness[index] - reopened.wetness[index]) < 1e-6);
  }
  assert.deepEqual(live.mass, reopened.mass);
  assert.deepEqual(live.pigment, reopened.pigment);
});

test("saved paint becomes dry after sufficient offline time without losing paint", () => {
  const field = painting();
  const before = capturePigmentPatch(field, { x: 0, y: 0, width: 16, height: 16 });
  assert.equal(resumeStoredPaint(field, startTime, startTime + 60_000), null);
  assert.ok(field.wetness.every(value => value === 0));
  assert.deepEqual(field.mass, before.mass);
  assert.deepEqual(field.pigment, before.pigment);
  assert.deepEqual(field.body, before.body);
});

test("old saves and reversed clocks preserve water and resume instead of silently drying", () => {
  for (const timestamp of [undefined, NaN, Infinity, startTime + 1000]) {
    const field = painting();
    const before = Float32Array.from(field.wetness);
    const pending = resumeStoredPaint(field, timestamp, startTime);
    assert.ok(pending && pending.width > 0 && pending.height > 0);
    assert.deepEqual(field.wetness, before);
  }
});

test("restored Undo/Redo patches can rejoin the same drying clock", () => {
  const field = painting();
  const wet = capturePigmentPatch(field, { x: 0, y: 0, width: 16, height: 16 });
  resumeStoredPaint(field, startTime, startTime + 60_000);
  applyPigmentPatch(field, wet);
  const pending = advancePaintDrying(field, startTime, startTime + PAINT_DRYING_INTERVAL_MS, wet.bounds);
  assert.ok(pending);
  assert.ok(field.wetness[8 * 16 + 8] < wet.wetness[8 * 16 + 8]);
  assert.deepEqual(field.mass, wet.mass);
  assert.deepEqual(field.pigment, wet.pigment);
});
