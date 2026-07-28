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
