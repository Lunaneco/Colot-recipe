import assert from "node:assert/strict";
import test from "node:test";

import { mixPaint, mixPaintProportions } from "../lib/colorScience.ts";
import {
  createSpatialPaintSampler,
  sampleSpatialPaint,
} from "../lib/spatialMix.ts";

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
  assert.equal(overlap.mixed.name, "紅赤");
  assert.deepEqual(
    overlap.mixed.rgb,
    mixPaintProportions(overlap.weights).rgb,
  );
  assert.notDeepEqual(
    overlap.mixed.rgb,
    mixPaint({ red: 1 }).rgb,
  );
  assert.notDeepEqual(
    overlap.mixed.rgb,
    mixPaint({ yellow: 1 }).rgb,
  );
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

  assert.ok(Math.abs(wet.waterRatio - 1 / 3.0164) < 1e-12);
  assert.ok(wet.mixed.opacity < 0.7);
  assert.equal(dry.waterRatio, 0);
  assert.ok(dry.mixed.opacity > wet.mixed.opacity);
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

function gesture(path, speed = 0.4) {
  return {
    id: `gesture-${path[0].x}-${path[path.length - 1].x}`,
    kind: "gesture",
    recipe: { red: 1, blue: 1, yellow: 0, white: 0, water: 0 },
    distance: 220,
    speed,
    points: path.length,
    path,
    createdAt: "2026-07-28T00:00:01.000Z",
  };
}

function line(fromX, toX, y = 0.5, count = 21) {
  return Array.from({ length: count }, (_, index) => ({
    x: fromX + ((toX - fromX) * index) / (count - 1),
    y,
  }));
}

/** Integrates the material weights over the palette on a coarse grid. */
function totalPaint(state, columns = 110, rows = 76) {
  const viewport = { width: 1100, height: 760 };
  const sample = createSpatialPaintSampler(state, viewport);
  const total = { red: 0, blue: 0 };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const { weights } = sample(
        (column + 0.5) / columns,
        (row + 0.5) / rows,
      );
      total.red += weights.red;
      total.blue += weights.blue;
    }
  }
  return total;
}

test("手混ぜは筆が通った場所の絵の具だけを運び、何もない紙に色は生まれない", () => {
  const state = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
    steps: [step("red", "red", 0.25, 0.5)],
    mixGestures: [gesture(line(0.6, 0.85))],
  };
  const paper = sampleSpatialPaint(state, 0.72, 0.5);
  assert.equal(paper.coverage, 0);
  assert.equal(paper.weights.red, 0);

  // Stroking inside a single colour keeps it pure and only moves paint: the
  // clean brush lifts some from the path and piles it up where it stops.
  const inside = {
    ...state,
    mixGestures: [gesture(line(0.22, 0.28))],
  };
  const centre = sampleSpatialPaint(inside, 0.25, 0.5);
  assert.ok(centre.pigmentRatio.red > 0.999);
  assert.ok(centre.weights.red < 1);
  assert.ok(
    sampleSpatialPaint(inside, 0.29, 0.5).weights.red >
      sampleSpatialPaint(state, 0.29, 0.5).weights.red,
  );
  const before = totalPaint(state);
  const after = totalPaint(inside);
  assert.ok(Math.abs(after.red - before.red) / before.red < 0.01, `${after.red}`);
  assert.equal(after.blue, 0);
});

test("手混ぜは絵の具を増やしも減らしもせず、運ぶだけ", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, white: 0, water: 0 },
    steps: [step("red", "red", 0.3, 0.5), step("blue", "blue", 0.5, 0.5)],
    mixGestures: [],
  };
  const before = totalPaint(base);
  for (const path of [line(0.3, 0.5), line(0.2, 0.6), line(0.5, 0.3, 0.5, 9)]) {
    const after = totalPaint({ ...base, mixGestures: [gesture(path)] });
    assert.ok(Math.abs(after.red - before.red) / before.red < 0.01, `${after.red}`);
    assert.ok(Math.abs(after.blue - before.blue) / before.blue < 0.01, `${after.blue}`);
  }
});

test("手混ぜは進行方向へ色を引きずり、逆方向へは運ばない", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, white: 0, water: 0 },
    steps: [step("red", "red", 0.3, 0.5), step("blue", "blue", 0.5, 0.5)],
    mixGestures: [],
  };
  const untouchedRed = sampleSpatialPaint(base, 0.3, 0.5);
  const untouchedBlue = sampleSpatialPaint(base, 0.5, 0.5);
  assert.equal(untouchedRed.weights.blue, 0);
  assert.equal(untouchedBlue.weights.red, 0);

  // Red → blue: the brush loads red first and smears it into the blue dab.
  const redIntoBlue = { ...base, mixGestures: [gesture(line(0.3, 0.5))] };
  const blueAfter = sampleSpatialPaint(redIntoBlue, 0.5, 0.5);
  const redAfter = sampleSpatialPaint(redIntoBlue, 0.3, 0.5);
  assert.ok(blueAfter.pigmentRatio.red > 0.05, `${blueAfter.pigmentRatio.red}`);
  assert.ok(blueAfter.pigmentRatio.blue > blueAfter.pigmentRatio.red);
  assert.equal(redAfter.weights.blue, 0);
  // The purple grows toward the far end: colour is carried, not averaged.
  const nearBlueEdge = sampleSpatialPaint(redIntoBlue, 0.44, 0.5);
  assert.ok(nearBlueEdge.pigmentRatio.red > blueAfter.pigmentRatio.red);

  // Blue → red: the same path in reverse carries blue into the red dab.
  const blueIntoRed = { ...base, mixGestures: [gesture(line(0.5, 0.3))] };
  assert.ok(sampleSpatialPaint(blueIntoRed, 0.3, 0.5).pigmentRatio.blue > 0.05);
  assert.equal(sampleSpatialPaint(blueIntoRed, 0.5, 0.5).weights.red, 0);

  // Nothing appears away from the path.
  assert.equal(sampleSpatialPaint(redIntoBlue, 0.4, 0.75).coverage, 0);
});

test("手混ぜは順番どおりに積み重なり、ゆっくりなぞるほどよく混ざる", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, white: 0, water: 0 },
    steps: [step("red", "red", 0.3, 0.5), step("blue", "blue", 0.5, 0.5)],
    mixGestures: [],
  };
  const once = { ...base, mixGestures: [gesture(line(0.3, 0.5))] };
  const twice = {
    ...base,
    mixGestures: [gesture(line(0.3, 0.5)), gesture(line(0.5, 0.3))],
  };
  const onceBlue = sampleSpatialPaint(once, 0.5, 0.5).pigmentRatio.red;
  const twiceRed = sampleSpatialPaint(twice, 0.3, 0.5).pigmentRatio.blue;
  assert.ok(onceBlue > 0.05);
  assert.ok(twiceRed > 0.05, `${twiceRed}`);

  const slow = { ...base, mixGestures: [gesture(line(0.3, 0.5), 0.15)] };
  const fast = { ...base, mixGestures: [gesture(line(0.3, 0.5), 1.6)] };
  assert.ok(
    sampleSpatialPaint(slow, 0.5, 0.5).pigmentRatio.red >
      sampleSpatialPaint(fast, 0.5, 0.5).pigmentRatio.red,
  );
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

test("短いタップは画面の縦横比に関係なく物理ピクセルで真円になる", () => {
  const viewport = { width: 1100, height: 760 };
  const state = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
    steps: [step("circle-tap", "red", 0.5, 0.5)],
    mixGestures: [],
  };
  const distance = 42;
  const contributions = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return sampleSpatialPaint(
      state,
      0.5 + (Math.cos(angle) * distance) / viewport.width,
      0.5 + (Math.sin(angle) * distance) / viewport.height,
      undefined,
      viewport,
    ).weights.red;
  });

  assert.ok(contributions[0] > 0);
  for (const contribution of contributions.slice(1)) {
    assert.ok(
      Math.abs(contribution - contributions[0]) < 1e-12,
      `${contributions[0]} !== ${contribution}`,
    );
  }
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
    black: 0,
    white: 0,
  });
  assert.equal(sample.mixed.opacity, 0);
});

function conservedPaint(state) {
  const sample = createSpatialPaintSampler(state, { width: 1100, height: 760 });
  const cache = new Map();
  const total = { red: 0, blue: 0, yellow: 0, black: 0, white: 0, water: 0 };
  for (let row = 0; row < 190; row += 1) for (let column = 0; column < 275; column += 1) {
    const { weights } = sample((column + 0.5) / 275, (row + 0.5) / 190, cache);
    for (const key of Object.keys(total)) total[key] += weights[key];
  }
  return total;
}

test("折り返し・円周・交差・端部の手混ぜは全材料の質量を保存する", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, black: 0, white: 0, water: 1 },
    steps: [step("red", "red", 0.3, 0.5), step("blue", "blue", 0.5, 0.5),
      step("water", "water", 0.5, 0.5)], mixGestures: [],
  };
  const before = conservedPaint(base);
  const paths = [
    [{ x: .3, y: .5 }, { x: .5, y: .5 }, { x: .3, y: .5 }],
    Array.from({ length: 33 }, (_, i) => ({ x: .4 + .1 * Math.cos(i / 32 * Math.PI * 2),
      y: .5 + .1 * 1100 / 760 * Math.sin(i / 32 * Math.PI * 2) })),
    [{ x: .3, y: .45 }, { x: .55, y: .55 }, { x: .5, y: .4 }, { x: .3, y: .6 }],
    [{ x: .3, y: .5 }, { x: 0, y: .5 }, { x: .05, y: .9 }],
  ];
  for (const path of paths) {
    const after = conservedPaint({ ...base, mixGestures: [{ ...gesture(path), recipe: base.recipe }] });
    for (const key of Object.keys(before)) {
      assert.ok(Math.abs(after[key] - before[key]) < 1e-8,
        `${key} conserved: before=${before[key]}, after=${after[key]}`);
    }
  }
});

test("混ぜた後に同じミリ秒で追加した顔料は古い操作で運ばれない", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, black: 0, white: 0, water: 0 },
    steps: [step("red", "red", .3, .5), step("later-blue", "blue", .3, .5)],
    mixGestures: [{ ...gesture(line(.3, .5)), createdAt, stepIds: ["red"] }],
  };
  const downstream = sampleSpatialPaint(base, .48, .5);
  assert.ok(downstream.weights.red > .05);
  assert.equal(downstream.weights.blue, 0);
  assert.equal(sampleSpatialPaint(base, .3, .5).weights.blue, 1);
});

test("すべて混ぜるを繰り返しても絵の具は増えず中心の色と厚みを保持する", () => {
  const base = {
    recipe: { red: 1, blue: 1, yellow: 0, black: 0, white: 0, water: 1 },
    steps: [step("red", "red", .3, .5), step("blue", "blue", .6, .5),
      step("water", "water", .6, .5)], mixGestures: [],
  };
  const all = { ...gesture([{ x: .5, y: .5 }]), kind: "all", recipe: base.recipe, stepIds: base.steps.map(s => s.id) };
  const once = { ...base, mixGestures: [all] };
  const twice = { ...base, mixGestures: [all, { ...all, id: "again" }] };
  const before = conservedPaint(base), after = conservedPaint(twice);
  for (const key of Object.keys(before)) assert.ok(Math.abs(before[key] - after[key]) < 1e-8);
  const a = sampleSpatialPaint(once, .5, .51), b = sampleSpatialPaint(twice, .5, .51);
  for (const key of Object.keys(a.weights)) assert.ok(Math.abs(a.weights[key] - b.weights[key]) < 1e-12);
});
