import assert from "node:assert/strict";
import test from "node:test";

import {
  PIGMENT_REFLECTANCE,
  calculatePaintColor,
  mixPaint,
} from "../lib/colorScience.ts";

test("顔料は31波長のスペクトル反射率として定義される", () => {
  for (const spectrum of Object.values(PIGMENT_REFLECTANCE)) {
    assert.equal(spectrum.length, 31);
    assert.ok(spectrum.every((sample) => sample > 0 && sample < 1));
  }
});

test("赤＋黄はRGB平均ではない自然なオレンジになる", () => {
  const orange = mixPaint({ red: 1, yellow: 1 });

  assert.ok(orange.hsl.h >= 12 && orange.hsl.h <= 52, orange.hex);
  assert.ok(orange.rgb.r > orange.rgb.g);
  assert.ok(orange.rgb.g > orange.rgb.b);
  assert.equal(orange.name, "夕焼けオレンジ");
  assert.notDeepEqual(orange.rgb, { r: 128, g: 128, b: 0 });
});

test("赤黄の顔料相互作用は白を含む代表配合を落ち着いた橙に補正する", () => {
  const orange = mixPaint({ red: 3, yellow: 2, white: 1, water: 2 });
  const diluted = mixPaint({ red: 3, yellow: 2, white: 1, water: 20 });

  assert.equal(orange.hex, "#D9824A");
  assert.deepEqual(orange.rgb, { r: 217, g: 130, b: 74 });
  assert.deepEqual(orange.hsl, { h: 23, s: 65, l: 57 });
  assert.equal(diluted.hex, orange.hex);
  assert.ok(diluted.opacity < orange.opacity);
});

test("黄＋青は減法混色の緑になる", () => {
  const green = mixPaint({ yellow: 1, blue: 1 });

  assert.ok(green.hsl.h >= 70 && green.hsl.h <= 175, green.hex);
  assert.ok(green.rgb.g > green.rgb.r);
  assert.ok(green.rgb.g > green.rgb.b);
  assert.equal(green.name, "深い森の緑");
});

test("赤＋青は明るいRGB紫ではなく、深くくすんだ紫になる", () => {
  const violet = mixPaint({ red: 1, blue: 1 });
  const digitalAverage = { r: 128, g: 0, b: 128 };

  assert.ok(
    violet.hsl.h >= 255 && violet.hsl.h <= 345,
    `${violet.hex} / ${violet.hsl.h}°`,
  );
  assert.ok(violet.rgb.r > violet.rgb.g);
  assert.ok(violet.rgb.b > violet.rgb.g);
  assert.ok(violet.hsl.s < 75, `${violet.hsl.s}%`);
  assert.notDeepEqual(violet.rgb, digitalAverage);
  assert.equal(violet.name, "薄明の紫");
});

test("三原色を混ぜると二色混合より彩度が下がる", () => {
  const neutral = mixPaint({ red: 1, yellow: 1, blue: 1 });
  const pairSaturations = [
    mixPaint({ red: 1, yellow: 1 }).hsl.s,
    mixPaint({ yellow: 1, blue: 1 }).hsl.s,
    mixPaint({ red: 1, blue: 1 }).hsl.s,
  ];

  assert.ok(neutral.hsl.s < Math.min(...pairSaturations), neutral.hex);
  assert.match(neutral.name, /土|アース|灰|霞/);
});

test("白は明度と不透明度を上げ、顔料の濃さを下げる", () => {
  const red = mixPaint({ red: 1, water: 1 });
  const pink = mixPaint({ red: 1, white: 1, water: 1 });

  assert.ok(pink.hsl.l > red.hsl.l);
  assert.ok(pink.opacity > red.opacity);
  assert.ok(pink.intensity < red.intensity);
  assert.equal(pink.name, "ミルクいちご");
});

test("水は白として混ざらず、色相を保ちながら透明度を上げる", () => {
  const thick = mixPaint({ red: 2, yellow: 1 });
  const wash = mixPaint({ red: 2, yellow: 1, water: 6 });

  assert.equal(wash.hex, thick.hex);
  assert.deepEqual(wash.rgb, thick.rgb);
  assert.ok(wash.opacity < thick.opacity);
  assert.ok(wash.intensity < thick.intensity);
  assert.ok(wash.viscosity < thick.viscosity);
  assert.ok(wash.spread > thick.spread);
  assert.ok(wash.dryingSpeed < thick.dryingSpeed);
  assert.equal(wash.waterRatio, 0.667);
});

test("全体比率と水を除いた顔料比率を別々に返す", () => {
  const colour = calculatePaintColor({
    red: 3,
    yellow: 2,
    white: 1,
    water: 2,
  });

  assert.equal(colour.totalUnits, 8);
  assert.equal(colour.pigmentUnits, 6);
  assert.equal(colour.waterRatio, 0.25);
  assert.deepEqual(colour.pigmentRatio, {
    red: 0.5,
    blue: 0,
    yellow: 0.3333,
    white: 0.1667,
  });
  assert.match(colour.hex, /^#[0-9A-F]{6}$/);
  assert.ok(Number.isInteger(colour.rgb.r));
  assert.ok(Number.isInteger(colour.hsl.h));
  assert.ok(colour.opacity >= 0 && colour.opacity <= 1);
  assert.ok(colour.intensity >= 0 && colour.intensity <= 1);
});

test("水だけのレシピは白色顔料ではなく透明として扱う", () => {
  const water = mixPaint({ water: 4 });

  assert.equal(water.hex, "#FFFFFF");
  assert.equal(water.opacity, 0);
  assert.equal(water.intensity, 0);
  assert.equal(water.waterRatio, 1);
  assert.equal(water.name, "透明な水");
});

test("材料単位は非負整数に限定する", () => {
  assert.throws(() => mixPaint({ red: -1 }), RangeError);
  assert.throws(() => mixPaint({ blue: 0.5 }), RangeError);
  assert.throws(() => mixPaint({ yellow: Number.NaN }), RangeError);
});
