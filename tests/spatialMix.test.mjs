import assert from "node:assert/strict";
import test from "node:test";

import { mixPaint, mixPaintProportions } from "../lib/colorScience.ts";
import {
  createSpatialPaintSampler,
  paintDabContribution,
  sampleSpatialPaint,
} from "../lib/spatialMix.ts";

const createdAt = "2026-07-28T00:00:00.000Z";

function step(id, material, x, y, size = "medium") {
  return { id, material, x, y, size, createdAt };
}

function integrateMaterialMass(
  state,
  material,
  viewport = { width: 360, height: 360 },
  stride = 3,
) {
  const sampler = createSpatialPaintSampler(state, viewport);
  const colourCache = new Map();
  let mass = 0;

  // Midpoint integration avoids giving the canvas boundary disproportionate
  // weight and is stable across small changes to the sampling stride.
  for (let pixelY = stride / 2; pixelY < viewport.height; pixelY += stride) {
    for (
      let pixelX = stride / 2;
      pixelX < viewport.width;
      pixelX += stride
    ) {
      mass +=
        sampler(
          pixelX / viewport.width,
          pixelY / viewport.height,
          colourCache,
        ).weights[material] *
        stride ** 2;
    }
  }

  return mass;
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

test("保存レシピのcompound stepは全顔料成分の比率を保って加算する", () => {
  const recipe = {
    red: 2,
    blue: 1,
    yellow: 3,
    black: 0,
    white: 4,
    water: 5,
  };
  const state = {
    recipe,
    steps: [
      {
        ...step("saved-recipe-batch", "yellow", 0.5, 0.5),
        recipe: { ...recipe },
      },
    ],
    mixGestures: [],
  };

  const direct = sampleSpatialPaint(state, 0.5, 0.5);
  const indexed = createSpatialPaintSampler(state)(0.5, 0.5);
  const expected = mixPaintProportions(direct.weights);
  const pigmentScale = direct.weights.red / recipe.red;

  assert.deepEqual(indexed.weights, direct.weights);
  for (const pigment of ["red", "blue", "yellow", "white"]) {
    assert.ok(
      Math.abs(direct.weights[pigment] - recipe[pigment] * pigmentScale) <
        1e-12,
    );
  }
  assert.equal(direct.weights.water, recipe.water);
  assert.deepEqual(direct.pigmentRatio, {
    red: 0.2,
    blue: 0.1,
    yellow: 0.3,
    black: 0,
    white: 0.4,
  });
  assert.ok(
    Math.abs(
      direct.waterRatio -
        direct.weights.water /
          Object.values(direct.weights).reduce(
            (total, value) => total + value,
            0,
          ),
    ) < 1e-12,
  );
  assert.equal(direct.mixed.hex, expected.hex);
  assert.equal(direct.mixed.waterRatio, expected.waterRatio);
});

test("保存レシピ色も通常の絵の具と同じように外から置いた水で広がる", () => {
  const regularState = {
    recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 1 },
    steps: [
      step("regular-red", "red", 0.5, 0.5),
      step("water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };
  const compoundState = {
    ...regularState,
    steps: [
      {
        ...step("recipe-red", "red", 0.5, 0.5),
        recipe: { red: 1, blue: 0, yellow: 0, white: 0, water: 0 },
      },
      step("water", "water", 0.5, 0.5),
    ],
  };

  const regularEdge = sampleSpatialPaint(regularState, 0.575, 0.5);
  const compoundEdge = sampleSpatialPaint(compoundState, 0.575, 0.5);

  assert.ok(regularEdge.weights.red > 0);
  assert.ok(compoundEdge.weights.red > 0);
  assert.ok(
    Math.abs(regularEdge.weights.red - compoundEdge.weights.red) < 1e-10,
  );
  assert.ok(
    Math.abs(regularEdge.waterRatio - compoundEdge.waterRatio) < 1e-10,
  );
});

test("水入り保存レシピは同じ配合を別々に置いた時と中心・縁で一致する", () => {
  const recipe = { red: 1, blue: 0, yellow: 0, white: 0, water: 1 };
  const regularState = {
    recipe,
    steps: [
      step("regular-red", "red", 0.5, 0.5),
      step("regular-water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };
  const compoundState = {
    recipe,
    steps: [
      {
        ...step("wet-recipe", "red", 0.5, 0.5),
        recipe: { ...recipe },
      },
    ],
    mixGestures: [],
  };

  for (const point of [
    { x: 0.5, y: 0.5 },
    { x: 0.575, y: 0.5 },
  ]) {
    const regular = sampleSpatialPaint(regularState, point.x, point.y);
    const compound = sampleSpatialPaint(compoundState, point.x, point.y);
    assert.ok(Math.abs(regular.weights.red - compound.weights.red) < 1e-10);
    assert.ok(
      Math.abs(regular.weights.water - compound.weights.water) < 1e-10,
    );
    assert.ok(Math.abs(regular.waterRatio - compound.waterRatio) < 1e-10);
    assert.equal(regular.mixed.hex, compound.mixed.hex);
  }
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

  assert.ok(
    Math.abs(
      wet.waterRatio -
        wet.weights.water / (wet.weights.red + wet.weights.water),
    ) < 1e-12,
  );
  assert.equal(wet.waterRatio, 0.5);
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

  assert.ok(dryCentre.coverage >= 0.88, dryCentre.coverage);
  assert.ok(wetDeposit <= dryDeposit * 0.55, `${dryDeposit} -> ${wetDeposit}`);
  assert.equal(dryEdge.coverage, 0);
  assert.ok(wetEdge.coverage > 0);
  assert.ok(wetEdge.mixed.opacity < wetCentre.mixed.opacity);
});

test("水で広がった顔料は面積が増えても総量をほぼ保存する", () => {
  const dryState = {
    recipe: {
      red: 1,
      blue: 0,
      yellow: 0,
      black: 0,
      white: 0,
      water: 0,
    },
    steps: [step("mass-red", "red", 0.5, 0.5)],
    mixGestures: [],
  };
  const wetState = {
    recipe: { ...dryState.recipe, water: 1 },
    steps: [
      ...dryState.steps,
      step("mass-water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };

  const dryMass = integrateMaterialMass(dryState, "red");
  const wetMass = integrateMaterialMass(wetState, "red");
  // Integral of (1 - r²/R²)^1.55 over a circular medium dab (R=76px).
  const analyticDryMass = (Math.PI * 76 ** 2) / 2.55;
  const dryError = Math.abs(dryMass - analyticDryMass) / analyticDryMass;
  const spreadError = Math.abs(wetMass - dryMass) / dryMass;

  assert.ok(dryError < 0.001, `${analyticDryMass} -> ${dryMass}`);
  assert.ok(spreadError < 0.02, `${dryMass} -> ${wetMass}`);

  const drySampler = createSpatialPaintSampler(dryState);
  const wetSampler = createSpatialPaintSampler(wetState);
  assert.equal(
    wetSampler(0.5, 0.5).weights.red,
    drySampler(0.5, 0.5).weights.red,
  );
  assert.equal(drySampler(0.575, 0.5).weights.red, 0);
  assert.ok(wetSampler(0.575, 0.5).weights.red > 0);
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
    black: 0,
    white: 0,
    water: 0,
  });
  assert.deepEqual(blueHeavy.recipe, {
    red: 1,
    blue: 2,
    yellow: 0,
    black: 0,
    white: 0,
    water: 0,
  });
  assert.equal(redHeavy.mixed.hex, mixPaint({ red: 2, blue: 1 }).hex);
  assert.equal(blueHeavy.mixed.hex, mixPaint({ red: 1, blue: 2 }).hex);
  assert.ok(redHeavy.mixed.rgb.r > blueHeavy.mixed.rgb.r);
  assert.ok(blueHeavy.mixed.rgb.b > redHeavy.mixed.rgb.b);
});

test("キャッシュなしの局所色は連続する実重量を丸めずに計算する", () => {
  const state = {
    recipe: {
      red: 1,
      blue: 1,
      yellow: 1,
      black: 0,
      white: 0,
      water: 1,
    },
    steps: [
      step("exact-red", "red", 0.45, 0.5),
      step("exact-blue", "blue", 0.52, 0.5),
      step("exact-yellow", "yellow", 0.55, 0.5),
      step("exact-water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };

  const sample = sampleSpatialPaint(state, 0.534, 0.4);
  const expected = mixPaintProportions(sample.weights);

  assert.deepEqual(sample.mixed, expected);
  assert.deepEqual(sample.mixed.recipe, sample.weights);
  assert.ok(
    Object.values(sample.weights).some(
      (weight) => weight > 0 && !Number.isInteger(weight),
    ),
  );
});

test("描画キャッシュは色比率だけを再利用し、局所の透明度を過大にしない", () => {
  const state = {
    recipe: {
      red: 1,
      blue: 1,
      yellow: 1,
      black: 0,
      white: 0,
      water: 1,
    },
    steps: [
      step("cache-red", "red", 0.45, 0.5),
      step("cache-blue", "blue", 0.52, 0.5),
      step("cache-yellow", "yellow", 0.55, 0.5),
      step("cache-water", "water", 0.5, 0.5),
    ],
    mixGestures: [],
  };
  const exact = sampleSpatialPaint(state, 0.534, 0.4);
  const cached = createSpatialPaintSampler(state)(
    0.534,
    0.4,
    new Map(),
  );

  assert.deepEqual(cached.mixed.recipe, exact.weights);
  assert.equal(cached.mixed.opacity, exact.mixed.opacity);
  assert.equal(cached.mixed.waterRatio, exact.mixed.waterRatio);
  assert.deepEqual(cached.mixed.pigmentRatio, exact.mixed.pigmentRatio);
  assert.ok(cached.mixed.opacity < 0.05, cached.mixed.opacity);
});

test("スポイト用レシピは水を含む局所実比率を1000単位以内で再現する", () => {
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

  const savedTotal = Object.values(sample.recipe).reduce(
    (sum, value) => sum + value,
    0,
  );
  const savedWaterRatio = sample.recipe.water / savedTotal;

  assert.ok(sample.recipe.red >= 1);
  assert.ok(sample.recipe.water >= 1);
  assert.ok(savedTotal <= 1_000);
  assert.ok(Math.abs(savedWaterRatio - sample.waterRatio) < 1 / savedTotal);
  assert.ok(
    Math.abs(sample.mixed.waterRatio - sample.waterRatio) < 0.001,
  );
});

test("通常の局所比率は許容誤差を満たす最小の再利用しやすい単位数にする", () => {
  const sample = sampleSpatialPaint(
    {
      recipe: { red: 1, blue: 1, yellow: 0, black: 0, white: 0, water: 0 },
      steps: [
        step("compact-red", "red", 0.45, 0.5),
        step("compact-blue", "blue", 0.55, 0.5),
      ],
      mixGestures: [],
    },
    0.49,
    0.5,
  );
  const savedTotal = Object.values(sample.recipe).reduce(
    (sum, value) => sum + value,
    0,
  );
  const shareError =
    Math.abs(sample.recipe.red / savedTotal - sample.pigmentRatio.red) +
    Math.abs(sample.recipe.blue / savedTotal - sample.pigmentRatio.blue);

  assert.deepEqual(sample.recipe, {
    red: 14,
    blue: 3,
    yellow: 0,
    black: 0,
    white: 0,
    water: 0,
  });
  assert.equal(savedTotal, 17);
  assert.ok(shareError <= 0.002);
});

test("0.2%の顔料も998:2相当の保存レシピから失われない", () => {
  const sourceRecipe = {
    red: 998,
    blue: 2,
    yellow: 0,
    black: 0,
    white: 0,
    water: 0,
  };
  const sample = sampleSpatialPaint(
    {
      recipe: sourceRecipe,
      steps: [
        {
          ...step("trace-blue-batch", "red", 0.5, 0.5),
          recipe: sourceRecipe,
        },
      ],
      mixGestures: [],
    },
    0.5,
    0.5,
  );

  assert.equal(sample.pigmentRatio.blue, 0.002);
  assert.deepEqual(sample.recipe, {
    red: 499,
    blue: 1,
    yellow: 0,
    black: 0,
    white: 0,
    water: 0,
  });
  assert.ok(sample.recipe.blue > 0);
});

test("水が多い端でも0.2%の局所顔料を水と別に保存する", () => {
  const pigmentRecipe = {
    red: 998,
    blue: 2,
    yellow: 0,
    black: 0,
    white: 0,
    water: 0,
  };
  const sample = sampleSpatialPaint(
    {
      recipe: { ...pigmentRecipe, water: 10 },
      steps: [
        {
          ...step("wet-trace-batch", "red", 0.5, 0.5),
          recipe: pigmentRecipe,
        },
        ...Array.from({ length: 10 }, (_, index) =>
          step(`wet-trace-water-${index}`, "water", 0.5, 0.5),
        ),
      ],
      mixGestures: [],
    },
    0.585,
    0.5,
    undefined,
    { width: 1_100, height: 760 },
  );
  const savedTotal = Object.values(sample.recipe).reduce(
    (sum, value) => sum + value,
    0,
  );

  assert.equal(sample.pigmentRatio.blue, 0.002);
  assert.ok(sample.waterRatio > 0.85);
  assert.ok(sample.recipe.red > sample.recipe.blue);
  assert.ok(sample.recipe.blue >= 1);
  assert.ok(sample.recipe.water >= 1);
  assert.ok(savedTotal <= 1_000);
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
      1_000,
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
    black: 0,
    white: 0,
  });
  assert.equal(sample.mixed.opacity, 0);
});

test("短いタップは画面の縦横比に関係なく物理ピクセルで真円になる", () => {
  const viewport = { width: 1100, height: 760 };
  const tap = {
    ...step("circle-tap", "black", 0.5, 0.5),
    shape: "tap",
  };
  const distance = 42;
  const contributions = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return paintDabContribution(
      tap,
      0.5 + (Math.cos(angle) * distance) / viewport.width,
      0.5 + (Math.sin(angle) * distance) / viewport.height,
      viewport,
    );
  });

  assert.ok(contributions[0] > 0);
  for (const contribution of contributions.slice(1)) {
    assert.ok(
      Math.abs(contribution - contributions[0]) < 1e-12,
      `${contributions[0]} !== ${contribution}`,
    );
  }
  assert.equal(
    paintDabContribution(
      tap,
      0.5 + 76 / viewport.width,
      0.5,
      viewport,
    ),
    0,
  );
});

test("長押しは少し波打って広がり、中心ほど実単位に応じて濃くなる", () => {
  const viewport = { width: 1100, height: 760 };
  const held = {
    ...step("held-red", "red", 0.5, 0.5),
    deposit: 4,
    shape: "hold",
    waveSeed: 0.375,
  };
  const tapState = {
    recipe: { red: 1, blue: 0, yellow: 0, black: 0, white: 0, water: 0 },
    steps: [step("tap-red", "red", 0.5, 0.5)],
    mixGestures: [],
  };
  const holdState = {
    recipe: { red: 4, blue: 0, yellow: 0, black: 0, white: 0, water: 0 },
    steps: [held],
    mixGestures: [],
  };
  const centre = sampleSpatialPaint(
    holdState,
    0.5,
    0.5,
    undefined,
    viewport,
  );
  const middle = paintDabContribution(
    held,
    0.5 + 58 / viewport.width,
    0.5,
    viewport,
  );
  const edge = paintDabContribution(
    held,
    0.5 + 88 / viewport.width,
    0.5,
    viewport,
  );
  const angular = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return paintDabContribution(
      held,
      0.5 + (88 * Math.cos(angle)) / viewport.width,
      0.5 + (88 * Math.sin(angle)) / viewport.height,
      viewport,
    );
  });
  const tapCentre = sampleSpatialPaint(tapState, 0.5, 0.5);

  assert.equal(centre.weights.red, 4);
  assert.ok(centre.coverage > tapCentre.coverage);
  assert.ok(1 > middle && middle > edge);
  assert.ok(Math.max(...angular) - Math.min(...angular) > 0.01);
  assert.ok(Math.max(...angular) - Math.min(...angular) < 0.35);
});

test("長押しで伸ばした軌跡だけが微波形になり、タップの真円は変わらない", () => {
  const viewport = { width: 1100, height: 760 };
  const stroke = {
    ...step("stretched-blue", "blue", 0.5, 0.5),
    shape: "stroke",
    waveSeed: 0.41,
  };
  const tap = {
    ...step("circular-blue", "blue", 0.5, 0.5),
    shape: "tap",
    waveSeed: 0.41,
  };
  const sampleRing = (paintStep) =>
    Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2;
      return paintDabContribution(
        paintStep,
        0.5 + (70 * Math.cos(angle)) / viewport.width,
        0.5 + (70 * Math.sin(angle)) / viewport.height,
        viewport,
      );
    });
  const strokeRing = sampleRing(stroke);
  const tapRing = sampleRing(tap);

  assert.ok(Math.max(...strokeRing) - Math.min(...strokeRing) > 0.005);
  assert.ok(Math.max(...tapRing) - Math.min(...tapRing) < 1e-12);
});

test("長押しの濃さはスポイト比率へ反映され、空間indexとも一致する", () => {
  const state = {
    recipe: { red: 4, blue: 1, yellow: 0, black: 0, white: 0, water: 0 },
    steps: [
      {
        ...step("held-red-ratio", "red", 0.5, 0.5),
        deposit: 4,
        shape: "hold",
        waveSeed: 0.22,
      },
      { ...step("blue-tap-ratio", "blue", 0.5, 0.5), shape: "tap" },
    ],
    mixGestures: [],
  };
  const direct = sampleSpatialPaint(state, 0.5, 0.5);
  const indexed = createSpatialPaintSampler(state);

  assert.equal(direct.weights.red, 4);
  assert.equal(direct.weights.blue, 1);
  assert.ok(Math.abs(direct.pigmentRatio.red - 0.8) < 1e-12);
  assert.ok(Math.abs(direct.pigmentRatio.blue - 0.2) < 1e-12);
  assert.equal(direct.mixed.hex, mixPaint({ red: 4, blue: 1 }).hex);

  for (const point of [
    { x: 0.5, y: 0.5 },
    { x: 0.585, y: 0.5 },
    { x: 0.5, y: 0.62 },
  ]) {
    const expected = sampleSpatialPaint(state, point.x, point.y);
    const actual = indexed(point.x, point.y);
    assert.deepEqual(actual.weights, expected.weights);
    assert.equal(actual.coverage, expected.coverage);
    assert.equal(actual.mixed.hex, expected.mixed.hex);
  }
});
