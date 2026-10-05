import assert from "node:assert/strict";
import test from "node:test";
import {
  finiteKmLayer, filmReflectanceOverGround, mixPigmentFilm,
  compositeSpectralFilm, mixPigmentVectorRgb, encodeSrgbByte, rgbToOklab,
} from "../lib/colorScience.ts";
import {
  PaintFilmCache, paletteFilmRgba, displayedPaletteRgb, MIXING_PAPER_LINEAR,
} from "../lib/paintFilm.ts";

const bytes = (rgb) => Object.fromEntries(Object.entries(rgb).map(([key, value]) => [key, encodeSrgbByte(value)]));
const delta = (a, b) => {
  const x = rgbToOklab(a), y = rgbToOklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
};

test("有限厚KMは透明・純吸収・純散乱の解析解とエネルギー保存を満たす", () => {
  assert.deepEqual(finiteKmLayer(0, 0, 10), { reflectance: 0, transmittance: 1 });
  assert.deepEqual(finiteKmLayer(1, 2, 0), { reflectance: 0, transmittance: 1 });
  assert.equal(finiteKmLayer(2, 0, 3).transmittance, Math.exp(-6));
  assert.deepEqual(finiteKmLayer(0, 2, 0.5), { reflectance: 0.5, transmittance: 0.5 });
  for (const k of [0, 1e-9, 0.1, 10, 1000]) {
    for (const s of [0, 1e-8, 0.4, 1, 100]) {
      for (const thickness of [0, 1e-10, 0.01, 1, 1e6]) {
        const { reflectance: r, transmittance: t } = finiteKmLayer(k, s, thickness);
        assert.ok(Number.isFinite(r + t) && r >= 0 && t >= 0 && r + t <= 1 + 1e-12);
      }
    }
  }
  for (const bad of [-1, NaN, Infinity]) assert.throws(() => finiteKmLayer(1, 1, bad), RangeError);
});

test("同じ顔料を二層に分けても一層と反射・透過が一致する", () => {
  for (const [k, s] of [[0, 1], [0.2, 0.7], [8, 0.05]]) {
    const one = finiteKmLayer(k, s, 0.3);
    const two = finiteKmLayer(k, s, 0.7);
    const whole = finiteKmLayer(k, s, 1);
    const r = filmReflectanceOverGround(one.reflectance, one.transmittance, two.reflectance);
    const t = one.transmittance * two.transmittance / (1 - one.reflectance * two.reflectance);
    assert.ok(Math.abs(r - whole.reflectance) < 1e-12);
    assert.ok(Math.abs(t - whole.transmittance) < 1e-12);
  }
});

test("有限厚の計算は薄層で下地、厚層で既存の分光マスストーンへ収束する", () => {
  const ground = { r: 0.7, g: 0.7, b: 0.7 };
  for (let p = 0; p < 5; p += 1) {
    const amounts = Array.from({ length: 5 }, (_, i) => i === p ? 1 : 0);
    const clear = compositeSpectralFilm(mixPigmentFilm(amounts, 0), ground);
    for (const key of ["r", "g", "b"]) assert.ok(Math.abs(clear[key] - ground[key]) < 1e-6);
    const thick = bytes(compositeSpectralFilm(mixPigmentFilm(amounts, 10000), ground));
    assert.deepEqual(thick, mixPigmentVectorRgb(amounts));
    const a = mixPigmentFilm(amounts, 0.1);
    const b = mixPigmentFilm(amounts.map((v) => v * 9), 0.1);
    assert.deepEqual(a, b);
  }
});

test("水で薄めた青は下地を透かし、白を混ぜた青と異なる分光色になる", () => {
  const blue = [0, 1, 0, 0, 0];
  const paper = { r: 0.95, g: 0.95, b: 0.95 };
  const black = { r: 0.02, g: 0.02, b: 0.02 };
  const wash = mixPigmentFilm(blue, 0.25);
  const onPaper = bytes(compositeSpectralFilm(wash, paper));
  const onBlack = bytes(compositeSpectralFilm(wash, black));
  const tint = bytes(compositeSpectralFilm(mixPigmentFilm([0, 1, 0, 0, 4], 24), paper));
  assert.ok(rgbToOklab(onPaper).l > rgbToOklab(onBlack).l + 0.2);
  assert.ok(delta(onPaper, tint) > 0.03);
  let previous = 1;
  for (const depth of [0.02, 0.1, 0.5, 2, 24]) {
    const l = rgbToOklab(bytes(compositeSpectralFilm(mixPigmentFilm(blue, depth), paper))).l;
    assert.ok(l < previous);
    previous = l;
  }
});

test("画面用キャッシュと半透明パレットは希釈色・微量顔料を1階調以内で表示する", () => {
  const cache = new PaintFilmCache(8);
  for (const amount of [0, 0.0001, 0.001, 0.01, 0.1, 0.5, 1]) {
    for (const mass of [0.0001, 0.001, 0.01, 0.1, 0.5, 1]) {
      const pigments = [amount, 0, 0, 0, 1 - amount];
      const exact = bytes(compositeSpectralFilm(mixPigmentFilm(pigments, mass * 24), MIXING_PAPER_LINEAR));
      const shown = cache.over(pigments, mass, MIXING_PAPER_LINEAR);
      const rgba = paletteFilmRgba(shown, 1 - Math.exp(-mass));
      const screen = displayedPaletteRgb(rgba);
      for (const key of ["r", "g", "b"]) assert.ok(Math.abs(screen[key] - exact[key]) <= 1, `${key}: ${screen[key]} vs ${exact[key]}`);
    }
  }
});
