import assert from "node:assert/strict";
import test from "node:test";

import { mixPaint } from "../lib/colorScience.ts";
import {
  MAX_RECIPE_UNITS_PER_MATERIAL,
  SavedColorImportError,
  containsSavedColorId,
  hasSameSavedColorId,
  parseSavedColorsJson,
} from "../lib/savedColorSchema.ts";

const NOW = "2026-07-28T03:04:05.000Z";

const legacyColor = (overrides = {}) => ({
  id: "legacy-orange",
  name: "古い夕焼け",
  recipe: { red: 3, yellow: 2, white: 1, water: 2 },
  ...overrides,
});

test("旧形式の欠落項目を補い、mixedと顔料比率を配合から再計算する", () => {
  const forgedHex = "#000000";
  const result = parseSavedColorsJson(
    [
      legacyColor({
        mixed: {
          hex: forgedHex,
          pigmentRatio: { red: 0, blue: 1, yellow: 0, white: 0 },
        },
      }),
    ],
    { now: NOW },
  );
  const [color] = result.colors;
  const calculated = mixPaint(color.recipe);

  assert.equal(result.version, 0);
  assert.equal(result.rejected, 0);
  assert.equal(color.mixed.hex, calculated.hex);
  assert.notEqual(color.mixed.hex, forgedHex);
  assert.deepEqual(color.mixed.rgb, calculated.rgb);
  assert.deepEqual(color.mixed.pigmentRatio, {
    red: 0.5,
    blue: 0,
    yellow: 0.3333,
    black: 0,
    white: 0.1667,
  });
  assert.deepEqual(color.steps, []);
  assert.deepEqual(color.mixGestures, []);
  assert.equal(color.mixMethod, "保存済みの配合");
  assert.equal(color.note, "");
  assert.equal(color.createdAt, NOW);
  assert.equal(color.updatedAt, NOW);
});

test("スポイトで取得した見た目だけを安全に保持し、配合由来の物性は再計算する", () => {
  const result = parseSavedColorsJson(
    [
      legacyColor({
        capturedAppearance: {
          hex: "#A14F28",
          opacity: 0.73,
        },
      }),
    ],
    { now: NOW },
  );
  const [color] = result.colors;
  const calculated = mixPaint(color.recipe);

  assert.deepEqual(color.capturedAppearance, {
    hex: "#A14F28",
    opacity: 0.73,
  });
  assert.equal(color.mixed.hex, "#A14F28");
  assert.deepEqual(color.mixed.rgb, { r: 161, g: 79, b: 40 });
  assert.equal(color.mixed.opacity, 0.73);
  assert.deepEqual(color.mixed.pigmentRatio, calculated.pigmentRatio);
  assert.equal(color.mixed.waterRatio, calculated.waterRatio);
  assert.equal(color.mixed.viscosity, calculated.viscosity);
});

test("版付き形式を読み、壊れた項目だけを理由付きで除外する", () => {
  const result = parseSavedColorsJson(
    {
      version: 1,
      colors: [
        legacyColor({
          id: "bad-date",
          createdAt: "July someday",
        }),
        legacyColor({ id: "valid" }),
      ],
    },
    { now: NOW },
  );

  assert.equal(result.version, 1);
  assert.deepEqual(result.colors.map((color) => color.id), ["valid"]);
  assert.equal(result.rejected, 1);
  assert.match(result.issues[0].message, /日時/);
});

test("不正HEX、配列形状、過大単位、重複IDを受け入れない", () => {
  const cases = [
    legacyColor({ id: "bad-hex", mixed: { hex: "D9824A" } }),
    legacyColor({ id: "bad-array", steps: {} }),
    legacyColor({
      id: "bad-captured-opacity",
      capturedAppearance: { hex: "#D9824A", opacity: 2 },
    }),
    legacyColor({
      id: "huge",
      recipe: { red: MAX_RECIPE_UNITS_PER_MATERIAL + 1 },
    }),
    legacyColor({ id: "duplicate" }),
    legacyColor({ id: "duplicate", name: "二つ目" }),
    legacyColor({ id: "valid" }),
  ];
  const result = parseSavedColorsJson(cases, { now: NOW });

  assert.deepEqual(
    result.colors.map((color) => color.id),
    ["duplicate", "valid"],
  );
  assert.equal(result.rejected, 5);
  assert.ok(result.issues.some((issue) => /HEX/.test(issue.message)));
  assert.ok(result.issues.some((issue) => /配列/.test(issue.message)));
  assert.ok(result.issues.some((issue) => /透明度/.test(issue.message)));
  assert.ok(result.issues.some((issue) => /単位/.test(issue.message)));
  assert.ok(result.issues.some((issue) => /重複/.test(issue.message)));
});

test("未知の版、壊れたJSON、有効色ゼロを明確に失敗させる", () => {
  assert.throws(
    () => parseSavedColorsJson({ version: 99, colors: [] }),
    SavedColorImportError,
  );
  assert.throws(() => parseSavedColorsJson("{oops"), /JSON/);
  assert.throws(
    () =>
      parseSavedColorsJson(
        [legacyColor({ recipe: { red: Number.MAX_SAFE_INTEGER } })],
        { now: NOW },
      ),
    /読み込める色がありません/,
  );
  assert.deepEqual(
    parseSavedColorsJson({ version: 1, colors: [] }, { allowEmpty: true })
      .colors,
    [],
  );
});

test("同一ID判定APIは文字列とSavedColorの双方を扱う", () => {
  const color = parseSavedColorsJson([legacyColor()], { now: NOW }).colors[0];

  assert.equal(hasSameSavedColorId(color, "legacy-orange"), true);
  assert.equal(hasSameSavedColorId("other", color), false);
  assert.equal(containsSavedColorId([color], "legacy-orange"), true);
  assert.equal(containsSavedColorId([color], "missing"), false);
});

test("局所顔料量・水・光学厚みは32単位の概要と独立に保存・再展開される", async () => {
  const { sampleSpatialPaint, stepsFromExactPaint } = await import("../lib/spatialMix.ts");
  const { PaintFilmCache, MIXING_PAPER_LINEAR } = await import("../lib/paintFilm.ts");
  const weights = { red: .00681, blue: 0, yellow: 0, black: .000093, white: 0, water: .02345 };
  const mass = weights.red + weights.black;
  const opticalMass = mass * (mass / (mass + weights.water * 1.45)) ** .8;
  const exactPaint = { weights, opticalMass };
  const [saved] = parseSavedColorsJson([legacyColor({
    recipe: { red: 32, blue: 0, yellow: 0, black: 0, white: 0, water: 96 },
    exactPaint, capturedAppearance: { hex: "#EDD9D3", opacity: 1 },
  })], { now: NOW }).colors;
  assert.deepEqual(saved.exactPaint, exactPaint);
  assert.deepEqual(saved.mixed.exactPaint, exactPaint);
  assert.ok(saved.mixed.pigmentRatio.black > .013, "trace pigment remains physically present");
  const reexpanded = sampleSpatialPaint({ recipe: saved.recipe,
    steps: stepsFromExactPaint(saved.exactPaint, NOW), mixGestures: [] }, .5, .51);
  for (const material of Object.keys(weights)) assert.ok(Math.abs(reexpanded.weights[material] - weights[material]) < 1e-14);
  assert.ok(Math.abs(reexpanded.exactPaint.opticalMass - opticalMass) < 1e-14);
  const cache = new PaintFilmCache();
  const amounts = value => [value.red, value.blue, value.yellow, value.black, value.white];
  const originalAppearance = cache.over(amounts(weights), opticalMass, MIXING_PAPER_LINEAR);
  const reopenedAppearance = cache.over(amounts(reexpanded.weights), reexpanded.exactPaint.opticalMass, MIXING_PAPER_LINEAR);
  assert.deepEqual(reopenedAppearance, originalAppearance);
});

test("測定した多層の顔料膜と照明は順序どおり保存する", () => {
  const exactPaint = {
    weights: { red: .5, blue: .05, yellow: 0, black: 0, white: 0, water: .1 },
    opticalMass: .55,
    opticalStack: [
      { pigment: [1, 0, 0, 0, 0], mass: .5, opacity: 1, lighting: .97 },
      { pigment: [0, 1, 0, 0, 0], mass: .05, opacity: .5, lighting: 1.02 },
    ],
  };
  const [saved] = parseSavedColorsJson([legacyColor({ exactPaint })], { now: NOW }).colors;
  assert.deepEqual(saved.exactPaint.opticalStack, exactPaint.opticalStack);
  assert.deepEqual(saved.mixed.exactPaint.opticalStack, exactPaint.opticalStack);
  for (const opticalStack of [[{ pigment: [1, 0], mass: 1 }], [{ pigment: [1, 0, 0, 0, 0], mass: Infinity }]]) {
    assert.throws(() => parseSavedColorsJson([legacyColor({ exactPaint: { ...exactPaint, opticalStack } })]), SavedColorImportError);
  }
});

test("群の透明度は子顔料膜を含む階層として保存し、群質量は子の合計から計算する", () => {
  const children = [
    { pigment: [1, 0, 0, 0, 0], mass: .5, opacity: .8, lighting: .97 },
    { pigment: [0, 1, 0, 0, 0], mass: .05, opacity: 1, lighting: 1.02 },
  ];
  const group = { pigment: [1, 0, 0, 0, 0], mass: 99, opacity: .4, lighting: 1, children };
  const exactPaint = { weights: { red: .5, blue: .05, yellow: 0, black: 0, white: 0, water: .1 },
    opticalMass: .55, opticalStack: [group] };
  const [saved] = parseSavedColorsJson([legacyColor({ exactPaint })], { now: NOW }).colors;
  const normalized = saved.exactPaint.opticalStack[0];
  assert.deepEqual(normalized.children, children);
  assert.equal(normalized.opacity, .4);
  assert.equal(normalized.mass, .55);
  assert.ok(Math.abs(normalized.pigment[0] - .5 / .55) < 1e-14);
  assert.ok(Math.abs(normalized.pigment[1] - .05 / .55) < 1e-14);
  assert.deepEqual(saved.mixed.exactPaint.opticalStack, saved.exactPaint.opticalStack);
  let deep = children[0];
  for (let depth = 0; depth < 34; depth += 1) deep = { ...children[0], children: [deep] };
  assert.throws(() => parseSavedColorsJson([legacyColor({ exactPaint: { ...exactPaint, opticalStack: [deep] } })]), SavedColorImportError);
});

test("乾いた重ね塗りの群はパレット再展開でも均質顔料へ潰れない", async () => {
  const { sampleSpatialPaint, stepsFromExactPaint, scaleOpticalStack } = await import("../lib/spatialMix.ts");
  const { renderOpticalStackRgb } = await import("../lib/opticalStack.ts");
  const { MIXING_PAPER_LINEAR, PaintFilmCache } = await import("../lib/paintFilm.ts");
  const weights = { red: .35, blue: .05, yellow: 0, black: 0, white: 0, water: 0 };
  const children = [{ pigment: [1, 0, 0, 0, 0], mass: .35, lighting: 1 },
    { pigment: [0, 1, 0, 0, 0], mass: .05, opacity: .9, lighting: .98 }];
  const exactPaint = { weights, opticalMass: .4, opticalStack: [
    { pigment: [.875, .125, 0, 0, 0], mass: .4, opacity: .6, children },
  ] };
  const state = { recipe: { ...weights }, steps: stepsFromExactPaint(exactPaint, NOW),
    mixGestures: [], reopenedPaint: exactPaint };
  const sample = sampleSpatialPaint(state, .5, .51);
  assert.equal(sample.opticalStack, exactPaint.opticalStack, "retain identity for bounded optical cache");
  assert.equal(sample.opticalStackScale, 1);
  const before = renderOpticalStackRgb(exactPaint.opticalStack, 1, MIXING_PAPER_LINEAR);
  const after = renderOpticalStackRgb(sample.opticalStack, sample.opticalStackScale, MIXING_PAPER_LINEAR);
  assert.deepEqual(after, before);
  const homogeneous = new PaintFilmCache().over([.35, .05, 0, 0, 0], .4, MIXING_PAPER_LINEAR);
  assert.ok(Math.hypot(before.r - homogeneous.r, before.g - homogeneous.g, before.b - homogeneous.b) > .05,
    "a layered area-opacity appearance materially differs from mixing its pigments");
  const thinner = sampleSpatialPaint(state, .53, .51);
  const capturedStack = scaleOpticalStack(thinner.opticalStack, thinner.opticalStackScale);
  const capturedAppearance = renderOpticalStackRgb(capturedStack, 1, MIXING_PAPER_LINEAR);
  const displayedAppearance = renderOpticalStackRgb(thinner.opticalStack, thinner.opticalStackScale, MIXING_PAPER_LINEAR);
  for (const key of ['r', 'g', 'b']) assert.ok(Math.abs(capturedAppearance[key] - displayedAppearance[key]) < 1e-10);
});
