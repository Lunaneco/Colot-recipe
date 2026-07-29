import assert from "node:assert/strict";
import test from "node:test";

import { mixPaint } from "../lib/colorScience.ts";
import { sampleSpatialPaint } from "../lib/spatialMix.ts";

const createdAt = "2026-07-28T00:00:00.000Z";

function step(id, material, x, y, size = "medium") {
  return { id, material, x, y, size, createdAt };
}

test("重なりの中心では各絵の具の局所比率が更新される", () => {
  const state = {
    recipe: { red: 1, blue: 0, yellow: 1, white: 0, water: 0 },
    steps: [
      step("red", "red", 0.45, 0.5),
      step("yellow", "yellow", 0.55, 0.5),
    ],
    mixGestures: [],
  };

  const redCentre = sampleSpatialPaint(state, 0.45, 0.5);
  const overlap = sampleSpatialPaint(state, 0.5, 0.5);

  assert.ok(redCentre.pigmentRatio.red > 0.99);
  assert.ok(overlap.pigmentRatio.red > 0.49);
  assert.ok(overlap.pigmentRatio.red < 0.51);
  assert.ok(overlap.pigmentRatio.yellow > 0.49);
  assert.ok(overlap.pigmentRatio.yellow < 0.51);
  assert.equal(overlap.mixed.name, "夕焼けオレンジ");
});

test("水は重なった地点だけの水分比率と透明度へ反映される", () => {
  const state = {
    recipe: { red: 2, blue: 0, yellow: 0, white: 0, water: 1 },
    steps: [
      step("red-wet", "red", 0.28, 0.5),
      step("red-dry", "red", 0.72, 0.5),
      step("water", "water", 0.28, 0.5),
    ],
    mixGestures: [],
  };

  const wet = sampleSpatialPaint(state, 0.28, 0.5);
  const dry = sampleSpatialPaint(state, 0.72, 0.5);

  assert.ok(wet.waterRatio > 0.49 && wet.waterRatio < 0.51);
  assert.ok(wet.mixed.opacity < 0.7);
  assert.equal(dry.waterRatio, 0);
  assert.ok(dry.mixed.opacity > wet.mixed.opacity);
});

test("乾いた絵の具は濃く、水を置いた場所だけ薄く広がる", () => {
  const dryState = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
    steps: [step("red", "red", 0.5, 0.5)],
    mixGestures: [],
  };
  const wetState = {
    recipe: { ...dryState.recipe, water: 1 },
    steps: [
      ...dryState.steps,
      step("water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };

  const dryCentre = sampleSpatialPaint(dryState, 0.5, 0.5);
  const wetCentre = sampleSpatialPaint(wetState, 0.5, 0.5);
  const dryEdge = sampleSpatialPaint(dryState, 0.575, 0.5);
  const wetEdge = sampleSpatialPaint(wetState, 0.575, 0.5);
  const dryDeposit = dryCentre.coverage * dryCentre.mixed.opacity;
  const wetDeposit = wetCentre.coverage * wetCentre.mixed.opacity;

  assert.ok(dryCentre.coverage >= 0.95, dryCentre.coverage);
  assert.ok(wetDeposit <= dryDeposit * 0.55, `${dryDeposit} -> ${wetDeposit}`);
  assert.equal(dryEdge.coverage, 0);
  assert.ok(wetEdge.coverage > 0);
  assert.ok(wetEdge.mixed.opacity < wetCentre.mixed.opacity);
});

test("局所の表示色は丸めた保存単位でなく実際の顔料比率から求める", () => {
  const redHeavy = sampleSpatialPaint(
    {
      recipe: { red: 2, blue: 1, yellow: 0, white: 0, water: 0 },
      steps: [
        step("red-1", "red", 0.5, 0.5),
        step("red-2", "red", 0.5, 0.5),
        step("blue-1", "blue", 0.5, 0.5),
      ],
      mixGestures: [],
    },
    0.5,
    0.5,
  );
  const blueHeavy = sampleSpatialPaint(
    {
      recipe: { red: 1, blue: 2, yellow: 0, white: 0, water: 0 },
      steps: [
        step("red-1", "red", 0.5, 0.5),
        step("blue-1", "blue", 0.5, 0.5),
        step("blue-2", "blue", 0.5, 0.5),
      ],
      mixGestures: [],
    },
    0.5,
    0.5,
  );

  assert.ok(Math.abs(redHeavy.pigmentRatio.red - 2 / 3) < 0.0001);
  assert.ok(Math.abs(blueHeavy.pigmentRatio.blue - 2 / 3) < 0.0001);
  assert.deepEqual(redHeavy.recipe, {
    red: 2,
    blue: 1,
    yellow: 0,
    white: 0,
    water: 0,
  });
  assert.deepEqual(blueHeavy.recipe, {
    red: 1,
    blue: 2,
    yellow: 0,
    white: 0,
    water: 0,
  });
  assert.equal(redHeavy.mixed.hex, mixPaint({ red: 2, blue: 1 }).hex);
  assert.equal(blueHeavy.mixed.hex, mixPaint({ red: 1, blue: 2 }).hex);
  assert.ok(redHeavy.mixed.rgb.r > blueHeavy.mixed.rgb.r);
  assert.ok(blueHeavy.mixed.rgb.b > redHeavy.mixed.rgb.b);
});

test("スポイト用レシピは水を含む実比率を小さな整数で再現する", () => {
  const sample = sampleSpatialPaint(
    {
      recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 10 },
      steps: [
        step("red", "red", 0.5, 0.5),
        ...Array.from({ length: 10 }, (_, index) =>
          step(`water-${index}`, "water", 0.5, 0.5),
        ),
      ],
      mixGestures: [],
    },
    0.5,
    0.5,
  );

  assert.deepEqual(sample.recipe, {
    red: 1,
    blue: 0,
    yellow: 0,
    white: 0,
    water: 10,
  });
  assert.ok(Math.abs(sample.waterRatio - 10 / 11) < 0.0001);
  assert.ok(Math.abs(sample.mixed.waterRatio - 10 / 11) < 0.001);
});

test("水の端にごく薄い顔料がある地点でも保存用レシピを空にしない", () => {
  const sample = sampleSpatialPaint(
    {
      recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 1 },
      steps: [
        step("trace-red", "red", 0.5687, 0.5),
        step("water", "water", 0.5, 0.5),
      ],
      mixGestures: [],
    },
    0.5,
    0.5,
  );

  assert.ok(sample.weights.red > 0);
  assert.ok(sample.coverage > 0.002);
  assert.ok(sample.recipe.red >= 1);
  assert.ok(sample.recipe.water >= 1);
  assert.ok(
    Object.values(sample.recipe).reduce((sum, value) => sum + value, 0) <=
      128,
  );
});

test("遠くの水は手混ぜ軌跡へ持ち込まれない", () => {
  const state = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 1 },
    steps: [
      step("red", "red", 0.25, 0.5),
      step("water", "water", 0.8, 0.5),
    ],
    mixGestures: [
      {
        id: "gesture",
        kind: "gesture",
        recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 1 },
        distance: 120,
        speed: 0.5,
        points: 2,
        path: [
          { x: 0.2, y: 0.5 },
          { x: 0.3, y: 0.5 },
        ],
        createdAt: "2026-07-28T00:00:01.000Z",
      },
    ],
  };

  const mixedStroke = sampleSpatialPaint(state, 0.25, 0.5);
  assert.equal(mixedStroke.waterRatio, 0);
  assert.equal(mixedStroke.weights.water, 0);
});

test("すべて混ぜる操作には操作時点の水だけが反映される", () => {
  const state = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 1 },
    steps: [
      step("red", "red", 0.5, 0.5),
      step("later-water", "water", 0.9, 0.9),
    ],
    mixGestures: [
      {
        id: "all",
        kind: "all",
        recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
        distance: 1200,
        speed: 0.7,
        points: 16,
        createdAt: "2026-07-28T00:00:01.000Z",
      },
    ],
  };

  const centre = sampleSpatialPaint(state, 0.5, 0.51);
  assert.equal(centre.waterRatio, 0);
});

test("絵の具がない地点のスポイト結果は空になる", () => {
  const sample = sampleSpatialPaint(
    {
      recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
      steps: [step("red", "red", 0.2, 0.2, "small")],
      mixGestures: [],
    },
    0.9,
    0.9,
  );

  assert.equal(sample.coverage, 0);
  assert.deepEqual(sample.pigmentRatio, {
    red: 0,
    blue: 0,
    yellow: 0,
    white: 0,
  });
  assert.equal(sample.mixed.opacity, 0);
});
