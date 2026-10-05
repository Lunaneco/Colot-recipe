import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStamp,
  beginStrokeDynamics,
  completeTap,
  nextSpacing,
  planStamp,
  strokeSpacing,
} from "../lib/brushDynamics.ts";
import {
  applyPigmentPatch,
  capturePigmentPatch,
  createPigmentField,
  createStrokeShadow,
  compositePigmentLayers,
  depositStamp,
  pigmentVectorFromRatio,
  shadowPatch,
  samplePigmentLayers,
  totalPaintMassAt,
  totalPigmentMassAt,
  unionBounds,
  PIGMENT_COUNT,
} from "../lib/pigmentField.ts";

const settings = {
  size: 30,
  opacity: 0.85,
  pressureSensitivity: 0.7,
  water: 0.25,
  bleed: 0.15,
  hardness: 0.65,
  spacing: 0.16,
};

const red = {
  pigment: pigmentVectorFromRatio({ red: 1 }),
  waterRatio: 0,
  opacity: 0.98,
};
const blue = {
  pigment: pigmentVectorFromRatio({ blue: 1 }),
  waterRatio: 0,
  opacity: 0.98,
};

const point = (x, y, time, pressure = 0.5) => ({ x, y, time, pressure });

const paintedPixels = (field) => {
  let count = 0;
  for (const mass of field.mass) if (mass > 0.001) count += 1;
  return count;
};

test("筆圧が高いほど太く、多く置く", () => {
  const soft = beginStrokeDynamics("round", settings, red, 1);
  const hard = beginStrokeDynamics("round", settings, red, 1);
  // Move past the entry taper first.
  for (let step = 0; step < 12; step += 1) {
    planStamp(soft, point(step * 10, 0, step * 16, 0.2), settings);
    planStamp(hard, point(step * 10, 0, step * 16, 0.9), settings);
  }
  const a = planStamp(soft, point(130, 0, 200, 0.2), settings);
  const b = planStamp(hard, point(130, 0, 200, 0.9), settings);
  assert.ok(b.radius > a.radius * 1.3, `${a.radius} vs ${b.radius}`);
  assert.ok(b.mass > a.mass, `${a.mass} vs ${b.mass}`);
});

test("速い線は細く薄くなり、書き出しはテーパーする", () => {
  const slow = beginStrokeDynamics("round", settings, red, 1);
  const fast = beginStrokeDynamics("round", settings, red, 1);
  const first = planStamp(slow, point(0, 0, 0), settings);
  for (let step = 1; step <= 12; step += 1) {
    planStamp(slow, point(step * 8, 0, step * 40), settings);
    planStamp(fast, point(step * 8, 0, step * 1), settings);
  }
  const slowPlan = planStamp(slow, point(110, 0, 13 * 40), settings);
  const fastPlan = planStamp(fast, point(110, 0, 13), settings);
  assert.ok(fastPlan.mass < slowPlan.mass * 0.85, `${fastPlan.mass} vs ${slowPlan.mass}`);
  assert.ok(fastPlan.radius < slowPlan.radius, "fast strokes thin");
  assert.ok(first.radius < slowPlan.radius * 0.5, "entry taper");
});

test("実際に置いた量だけ筆から減り、長い線で丸筆が薄れる（マーカーの装填量も有限）", () => {
  const round = beginStrokeDynamics("round", settings, red, 1);
  const marker = beginStrokeDynamics("marker", settings, red, 1);
  const roundField = createPigmentField(2600, 80);
  const markerField = createPigmentField(2600, 80);
  const initialRound = round.reservoir.load;
  const initialMarker = marker.reservoir.load;
  let firstRound = 0;
  let firstMarker = 0;
  let lastRound = 0;
  let lastMarker = 0;
  for (let step = 0; step <= 500; step += 1) {
    const placement = point(30 + step * 5, 40, step * 8);
    applyStamp(roundField, round, placement, settings);
    applyStamp(markerField, marker, placement, settings);
    const index = 40 * roundField.width + placement.x;
    if (step === 40) {
      firstRound = roundField.mass[index];
      firstMarker = markerField.mass[index];
    }
    lastRound = roundField.mass[index];
    lastMarker = markerField.mass[index];
  }
  assert.ok(lastRound < firstRound * 0.4, `${firstRound} -> ${lastRound}`);
  assert.ok(Math.abs(lastMarker - firstMarker) < 1e-9, "a marker holds enough ink for this line");
  assert.ok(round.reservoir.load < initialRound * 0.2);
  assert.ok(Number.isFinite(initialMarker) && marker.reservoir.load < initialMarker);
  assert.ok(Math.abs(sumMass(roundField) + round.reservoir.load - initialRound) < initialRound * 2e-6);
  assert.ok(Math.abs(sumMass(markerField) + marker.reservoir.load - initialMarker) < initialMarker * 2e-6);
});

const sumMass = (field) => field.mass.reduce((sum, _, index) => sum + totalPaintMassAt(field, index), 0);
const pigmentInventory = (field, reservoir) => {
  const total = Array.from({ length: PIGMENT_COUNT }, (_, p) => reservoir.load * reservoir.pigment[p]);
  for (let index = 0; index < field.mass.length; index += 1) {
    for (let p = 0; p < PIGMENT_COUNT; p += 1) {
      total[p] += totalPigmentMassAt(field, index, p);
    }
  }
  return total;
};
const assertInventory = (before, after) => {
  for (let p = 0; p < PIGMENT_COUNT; p += 1) {
    assert.ok(Math.abs(after[p] - before[p]) < Math.max(1e-5, before[p] * 2e-6),
      `pigment ${p}: ${before[p]} -> ${after[p]}`);
  }
};

test("計画・ページ外の移動は筆の実質量を消費しない", () => {
  const state = beginStrokeDynamics("round", settings, red, 17);
  const initial = state.reservoir.load;
  for (let i = 0; i < 100; i += 1) planStamp(state, point(i * 25, -100, i * 10), settings);
  assert.equal(state.reservoir.load, initial);
  const field = createPigmentField(80, 80);
  applyStamp(field, state, point(3000, -100, 1000), settings);
  assert.equal(state.reservoir.load, initial);
  assert.equal(sumMass(field), 0);
});

test("混色ブラシは筆圧と半径を変えても各顔料の表面量＋保有量を保存する", () => {
  const field = createPigmentField(700, 160);
  depositStamp(field, 60, 80, 30, {
    pigment: pigmentVectorFromRatio({ blue: 3, yellow: 1 }), mass: 1, wetness: 0.8, hardness: 1,
  });
  const state = beginStrokeDynamics("mixer", settings, red, 2);
  const initial = pigmentInventory(field, state.reservoir);
  for (let i = 0; i < 150; i += 1) {
    const changedSize = i < 31 ? settings.size : i % 2 === 0 ? 42 : 18;
    applyStamp(field, state, point(50 + i * 3, 80, i * 12, i < 31 ? 0.1 + 0.9 * i / 30 : 1),
      { ...settings, size: changedSize });
    assert.ok(state.reservoir.load >= 0 && state.reservoir.load <= state.reservoirCapacity + 1e-8);
  }
  assertInventory(initial, pigmentInventory(field, state.reservoir));
});

test("普通の筆が拾う下色は表面から実際に移り、青のコピーを作らない", () => {
  const field = createPigmentField(260, 90);
  depositStamp(field, 50, 45, 22, { pigment: blue.pigment, mass: 1, wetness: 0.8, hardness: 1 });
  const state = beginStrokeDynamics("round", settings, red, 4);
  const initial = pigmentInventory(field, state.reservoir);
  for (let i = 0; i < 50; i += 1) {
    applyStamp(field, state, point(25 + i * 3, 45, i * 12), settings);
  }
  assert.ok(state.reservoir.pigment[1] > 0, "the brush picked up blue paint");
  assertInventory(initial, pigmentInventory(field, state.reservoir));
});

test("残量より大きい筆跡でも供給量を超えず、空になった筆は描かない", () => {
  for (const tool of ["round", "flat", "pencil", "watercolor", "airbrush", "marker"]) {
    const field = createPigmentField(260, 90);
    const state = beginStrokeDynamics(tool, settings, red, 5);
    assert.ok(Number.isFinite(state.reservoirCapacity) && state.reservoirCapacity > 0, tool);
    state.reservoirCapacity = 5;
    state.reservoir.load = 5;
    const initial = pigmentInventory(field, state.reservoir);
    for (let i = 0; i < 50; i += 1) applyStamp(field, state, point(30 + i * 4, 45, i * 12, 1), settings);
    assertInventory(initial, pigmentInventory(field, state.reservoir));
    assert.ok(sumMass(field) <= 5 + 1e-5, `${tool}: ${sumMass(field)}`);
    const empty = beginStrokeDynamics(tool, settings, red, 6);
    empty.reservoir.load = 0;
    const blank = createPigmentField(80, 80);
    applyStamp(blank, empty, point(40, 40, 0, 1), settings);
    assert.equal(sumMass(blank), 0, tool);
  }
});

test("スポイトの光学層は筆のプリセットで再希釈されず、重ね色をそのまま再描画する", () => {
  const paper = { r: 247, g: 241, b: 230 };
  const base = createPigmentField(1, 1);
  const glaze = createPigmentField(1, 1);
  base.pigment.set(blue.pigment);
  base.mass[0] = 0.08;
  base.wetness[0] = 0.8;
  glaze.pigment.set(pigmentVectorFromRatio({ yellow: 1 }));
  glaze.mass[0] = 0.03;
  glaze.wetness[0] = 0.7;
  const sampled = samplePigmentLayers(paper, [
    { kind: "paint", field: base }, { kind: "paint", field: glaze, opacity: 0.7 },
  ], 0, 0);
  const changed = { ...settings, opacity: 0.1, water: 0.9 };
  const field = createPigmentField(80, 80);
  const state = beginStrokeDynamics("round", changed, {
    pigment: pigmentVectorFromRatio(sampled.exactPaint.weights),
    waterRatio: 0.9,
    opacity: 0.08,
    opticalMass: sampled.exactPaint.opticalMass,
    opticalStack: sampled.exactPaint.opticalStack,
  }, 18);
  const placement = point(40.5, 40.5, 0, 0.2);
  applyStamp(field, state, placement, changed);
  completeTap(field, state, { ...placement, time: 100 }, changed);
  const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  compositePigmentLayers(paper, [{ kind: "paint", field }], image, { x: 40, y: 40, width: 1, height: 1 });
  assert.deepEqual([...image.data], [sampled.rgb.r, sampled.rgb.g, sampled.rgb.b, 255]);
  assert.equal(field.body[40 * 80 + 40], 0);
  assert.equal(field.wetness[40 * 80 + 40], 0);
});

test("不透明度を下げた多層レイヤーのスポイトも、レイヤー全体の見た目を再描画する", () => {
  const paper = { r: 247, g: 241, b: 230 };
  const source = createPigmentField(1, 1);
  depositStamp(source, 0.5, 0.5, 1, { pigment: blue.pigment, mass: 1, wetness: 0, hardness: 1 });
  depositStamp(source, 0.5, 0.5, 1, {
    pigment: pigmentVectorFromRatio({ yellow: 1 }), mass: 0.25, wetness: 0, hardness: 1,
  });
  for (const opacity of [0.2, 0.5, 0.7, 1]) {
    const sampled = samplePigmentLayers(paper, [{ kind: "paint", field: source, opacity }], 0, 0,
      { wetDarkening: 0, relief: 0 });
    const target = createPigmentField(80, 80);
    const state = beginStrokeDynamics("round", settings, {
      pigment: pigmentVectorFromRatio(sampled.exactPaint.weights),
      waterRatio: 0,
      opacity: 0.98,
      opticalMass: sampled.exactPaint.opticalMass,
      opticalStack: sampled.exactPaint.opticalStack,
    }, 19);
    applyStamp(target, state, point(40.5, 40.5, 0, 1), settings);
    const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    compositePigmentLayers(paper, [{ kind: "paint", field: target }], image, { x: 40, y: 40, width: 1, height: 1 },
      { wetDarkening: 0, relief: 0 });
    assert.deepEqual([...image.data], [sampled.rgb.r, sampled.rgb.g, sampled.rgb.b, 255], `opacity ${opacity}`);
  }
});

test("混色ブラシは空で始まり、下の絵の具を拾って別の場所へ引きずる", () => {
  const field = createPigmentField(160, 80);
  const brush = beginStrokeDynamics("round", settings, blue, 1);
  for (let step = 0; step < 10; step += 1) {
    applyStamp(field, brush, point(30 + step * 2, 40, step * 10), settings);
  }
  const blank = createPigmentField(160, 80);
  const mixer = beginStrokeDynamics("mixer", settings, red, 2);
  const nothing = applyStamp(blank, mixer, point(40, 40, 0), settings);
  assert.equal(paintedPixels(blank), 0, "an empty mixer deposits nothing");
  assert.equal(nothing, null);

  const totalMass = (target) => {
    let sum = 0;
    for (const mass of target.mass) sum += mass;
    return sum;
  };
  const sourceIndex = 40 * 160 + 40;
  const sourceBefore = field.mass[sourceIndex];
  const massBefore = totalMass(field);
  const drag = beginStrokeDynamics("mixer", settings, red, 3);
  for (let step = 0; step <= 30; step += 1) {
    applyStamp(field, drag, point(30 + step * 3, 40, step * 12), settings);
  }
  // About one brush width past the end of the blue patch.
  const farIndex = 40 * 160 + 98;
  assert.ok(field.mass[sourceIndex] < sourceBefore * 0.85, "paint was lifted from the patch");
  assert.ok(field.mass[farIndex] > 0.005, `paint was dragged to the right (${field.mass[farIndex]})`);
  assert.ok(
    field.pigment[farIndex * PIGMENT_COUNT + 1] > 0.9,
    "the dragged paint is the picked-up blue, not the loaded red",
  );
  // The smear fades out instead of running on forever.
  assert.ok(field.mass[40 * 160 + 150] < 1e-3, "the smear ends");
  // Paint is moved, not created: the surface holds less, the brush holds
  // the rest, and nothing appeared out of nowhere.
  const massAfter = totalMass(field);
  assert.ok(massAfter < massBefore, "the surface lost the lifted paint");
  assert.ok(massAfter > massBefore * 0.8, "most paint stays on the surface");
  assert.ok(drag.reservoir.load > 0, "the brush still carries some paint");
});

test("平筆はストローク方向に向き、進行方向と直交する幅を持つ", () => {
  const horizontal = createPigmentField(120, 120);
  const flat = beginStrokeDynamics("flat", { ...settings, size: 40 }, red, 5);
  for (let step = 0; step < 8; step += 1) {
    planStamp(flat, point(20 + step * 4, 60, step * 10), { ...settings, size: 40 });
  }
  flat.travelled = 1000; // past the taper
  applyStamp(horizontal, flat, point(60, 60, 200), { ...settings, size: 40 });
  let minX = 120;
  let maxX = 0;
  let minY = 120;
  let maxY = 0;
  for (let y = 0; y < 120; y += 1) {
    for (let x = 0; x < 120; x += 1) {
      if (horizontal.mass[y * 120 + x] > 0.05) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  assert.ok(height > width * 1.6, `footprint ${width}x${height} should be tall when moving right`);
});

test("鉛筆は紙目に乗り、弱い筆圧では粒状に、強い筆圧では埋まる", () => {
  const light = createPigmentField(80, 80);
  const heavy = createPigmentField(80, 80);
  const pencil = { ...settings, size: 90 };
  const soft = beginStrokeDynamics("pencil", pencil, red, 7);
  const hard = beginStrokeDynamics("pencil", pencil, red, 7);
  applyStamp(light, soft, point(40, 40, 0, 0.15), pencil);
  applyStamp(heavy, hard, point(40, 40, 0, 1), pencil);
  const lightPixels = paintedPixels(light);
  const heavyPixels = paintedPixels(heavy);
  assert.ok(lightPixels > 0);
  assert.ok(heavyPixels > lightPixels * 1.3, `${lightPixels} vs ${heavyPixels}`);
});

test("スタンプ間隔は物理距離で決まり、水分が多いほど密になる", () => {
  const dry = strokeSpacing("round", { ...settings, water: 0, bleed: 0 });
  const wet = strokeSpacing("round", { ...settings, water: 1, bleed: 0 });
  assert.ok(wet < dry);
  assert.ok(dry <= settings.size * settings.spacing + 1e-9);
});

test("間隔は実際のスタンプ半径に追従し、弱い筆圧でも点線にならない", () => {
  const state = beginStrokeDynamics("round", settings, red, 1);
  for (let step = 0; step < 6; step += 1) {
    planStamp(state, point(step * 4, 0, step * 16, 0.05), settings);
  }
  const light = nextSpacing(state, settings);
  assert.ok(light <= state.lastRadius * 2 * settings.spacing + 1e-9, `${light} vs radius ${state.lastRadius}`);
  assert.ok(light < strokeSpacing("round", settings), "lighter touch → tighter spacing");
  assert.ok(light >= 0.5);
});

const strokeAlong = (field, tool, stepSize, count, y, pressure = 0.6) => {
  const state = beginStrokeDynamics(tool, settings, red, 11);
  for (let step = 0; step <= count; step += 1) {
    applyStamp(field, state, point(20 + step * stepSize, y, step * 12, pressure), settings);
  }
  return state;
};

test("置く量は間隔に依存しない（流量の正規化）", () => {
  const coarse = createPigmentField(260, 60);
  const fine = createPigmentField(260, 60);
  strokeAlong(coarse, "round", 6, 30, 30);
  strokeAlong(fine, "round", 1, 180, 30);
  // Compare the centreline well past the entry taper.
  let coarseMass = 0;
  let fineMass = 0;
  for (let x = 120; x < 160; x += 1) {
    coarseMass += coarse.mass[30 * 260 + x];
    fineMass += fine.mass[30 * 260 + x];
  }
  const ratio = coarseMass / fineMass;
  assert.ok(ratio > 0.85 && ratio < 1.15, `spacing changed the deposit: ${ratio}`);
});

test("一筆は一枚の絵の具の膜: 断面は平らで、始まりも本体と同じ濃さ、タップは一筆分", () => {
  const field = createPigmentField(260, 60);
  const marker = strokeAlong(field, "marker", 2, 100, 30, 1);
  const body = field.mass[30 * 260 + 120];
  // The start of the stroke is as thick as its body: no lighter cap and no
  // separate darker dot.
  const cap = field.mass[30 * 260 + 20];
  assert.ok(Math.abs(cap - body) / body < 0.1, `cap ${cap} vs body ${body}`);
  // The cross-section is the brush profile: flat across the hard core.
  const core = Math.floor(marker.lastRadius * 0.8);
  for (let dy = -core; dy <= core; dy += 2) {
    const value = field.mass[(30 + dy) * 260 + 120];
    assert.ok(Math.abs(value - body) / body < 0.1, `cross-section at ${dy}: ${value} vs ${body}`);
  }

  const dab = createPigmentField(80, 80);
  const tap = beginStrokeDynamics("marker", settings, red, 1);
  applyStamp(dab, tap, point(40, 40, 0, 1), settings);
  const centre = dab.mass[40 * 80 + 40];
  const topped = completeTap(dab, tap, point(40, 40, 30, 1), settings);
  assert.ok(topped, "a dab is completed to the full footprint");
  // Completing the dab fills the outer ring without piling onto the centre.
  assert.ok(Math.abs(dab.mass[40 * 80 + 40] - centre) < 1e-4, "centre unchanged");
  assert.ok(Math.abs(centre - body) / body < 0.1, `dab ${centre} vs stroke body ${body}`);
  const ring = dab.mass[40 * 80 + 40 + Math.round(tap.lastRadius * 0.6)];
  assert.ok(Math.abs(ring - centre) / centre < 0.05, `ring ${ring} vs centre ${centre}`);
  // Only genuine taps are topped up.
  const moved = beginStrokeDynamics("marker", settings, red, 1);
  for (let step = 0; step < 10; step += 1) planStamp(moved, point(step * 6, 0, step * 8, 1), settings);
  assert.equal(completeTap(dab, moved, point(60, 0, 100, 1), settings), null);

  // A quick dab of a round brush is a full-size dot, not the tapered entry
  // of a stroke: the tap tops up at the brush's settled radius.
  const brushSettings = { ...settings, size: 30 };
  const dot = createPigmentField(80, 80);
  const roundTap = beginStrokeDynamics("round", brushSettings, red, 1);
  applyStamp(dot, roundTap, point(40, 40, 0, 0.7), brushSettings);
  const entryRadius = roundTap.lastRadius;
  completeTap(dot, roundTap, point(40, 40, 40, 0.7), brushSettings);
  const flow = beginStrokeDynamics("round", brushSettings, red, 1);
  for (let step = 0; step <= 30; step += 1) planStamp(flow, point(step * 3, 40, 200 + step * 10, 0.7), brushSettings);
  const bodyRadius = flow.lastRadius;
  assert.ok(entryRadius < bodyRadius * 0.7, `entry ${entryRadius} tapers below body ${bodyRadius}`);
  assert.ok(
    Math.abs(roundTap.lastRadius - bodyRadius) / bodyRadius < 0.05,
    `tap radius ${roundTap.lastRadius} matches the stroke body ${bodyRadius}`,
  );
  const painted = paintedPixels(dot);
  const expectedArea = Math.PI * bodyRadius * bodyRadius;
  assert.ok(painted > expectedArea * 0.8, `dot area ${painted} vs footprint ${expectedArea}`);

  // A brush that rests on the paper settles to full size even without moving.
  const rest = beginStrokeDynamics("round", brushSettings, red, 1);
  planStamp(rest, point(40, 40, 0, 0.7), brushSettings);
  planStamp(rest, point(40, 40, 200, 0.7), brushSettings);
  assert.ok(Math.abs(rest.lastRadius - bodyRadius) / bodyRadius < 0.05, `rested ${rest.lastRadius}`);
});

test("ストロークの影は触れたタイルだけを記録し、元に戻す差分が正確", () => {
  const field = createPigmentField(200, 120);
  // Pre-existing paint everywhere along the top rows.
  const base = beginStrokeDynamics("marker", settings, blue, 2);
  for (let step = 0; step <= 40; step += 1) applyStamp(field, base, point(10 + step * 4, 30, step * 8), settings);
  const reference = capturePigmentPatch(field, { x: 0, y: 0, width: 200, height: 120 });

  const shadow = createStrokeShadow(field);
  const stroke = beginStrokeDynamics("round", settings, red, 3);
  let bounds = null;
  for (let step = 0; step <= 20; step += 1) {
    bounds = unionBounds(
      bounds,
      applyStamp(field, stroke, point(40 + step * 5, 30, step * 8), settings, shadow),
    );
  }
  assert.ok(shadow.tiles.size > 0 && shadow.tiles.size < 28, `tiles ${shadow.tiles.size}`);
  const before = shadowPatch(shadow, bounds);
  applyPigmentPatch(field, before);
  const restored = capturePigmentPatch(field, { x: 0, y: 0, width: 200, height: 120 });
  assert.deepEqual(Array.from(restored.mass), Array.from(reference.mass));
  assert.deepEqual(Array.from(restored.pigment), Array.from(reference.pigment));
  assert.deepEqual(Array.from(restored.wetness), Array.from(reference.wetness));
});
