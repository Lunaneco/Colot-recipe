import assert from "node:assert/strict";
import test from "node:test";
import {
  preparePigmentOptics, filmFromPigmentOptics, mixPigmentFilm,
  spectralSurfaceFromLinearRgb, cloneSpectralSurface, applySpectralFilm,
  spectralSurfaceToLinearRgb, encodeSrgbByte, blendSpectralSurface, displayLinearColor,
} from "../lib/colorScience.ts";
import { PaintFilmCache } from "../lib/paintFilm.ts";
import { createPigmentField, compositePigmentLayers } from "../lib/pigmentField.ts";

const bytes = (linear) => Object.fromEntries(Object.entries(linear)
  .map(([channel, value]) => [channel, encodeSrgbByte(value)]));
const random = () => {
  let seed = 437;
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};

test("厚みの高速式は全38帯域で一般KM式と同じ反射・透過になる", () => {
  const rnd = random();
  const mixtures = Array.from({ length: 5 }, (_, p) => Array.from({ length: 5 }, (_, i) => Number(i === p)));
  mixtures.push([0, 0, 0, 0, 0], [1e-8, 0, 0, 0, 1 - 1e-8]);
  for (let n = 0; n < 500; n += 1) mixtures.push(Array.from({ length: 5 }, () => rnd() ** 4));
  for (const amounts of mixtures) {
    const optics = preparePigmentOptics(amounts);
    for (const depth of [0, 1e-12, 1e-9, 1e-6, 1e-4, 0.01, 0.1, 1, 24, 100, 10000, 1e6]) {
      const fast = filmFromPigmentOptics(optics, depth);
      const reference = mixPigmentFilm(amounts, depth);
      for (let w = 0; w < 38; w += 1) {
        assert.ok(Math.abs(fast.reflectance[w] - reference.reflectance[w]) < 1e-12);
        assert.ok(Math.abs(fast.transmittance[w] - reference.transmittance[w]) < 1e-12);
      }
    }
  }
});

test("画素キャッシュの高速一層合成は一般分光経路から1階調以内で、世代交代も正しい", () => {
  const rnd = random();
  const cache = new PaintFilmCache(16);
  const grounds = [
    { r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 }, { r: 0, g: 0, b: 1 },
    { r: 0.93, g: 0.88, b: 0.79 }, { r: 0.02, g: 0.03, b: 0.04 },
  ].map(spectralSurfaceFromLinearRgb);
  for (let n = 0; n < 2000; n += 1) {
    const amounts = Float32Array.from([999, 888, ...Array.from({ length: 5 }, () => rnd() ** 4)]);
    const mass = 10 ** (-5 + 6 * rnd()), opacity = rnd(), lighting = 0.7 + 0.6 * rnd();
    const ground = grounds[n % grounds.length];
    const expected = cloneSpectralSurface(ground);
    applySpectralFilm(expected, mixPigmentFilm(amounts, mass * 24, 2), opacity, lighting);
    const target = bytes(spectralSurfaceToLinearRgb(expected));
    const shown = cache.rgb(amounts, mass, ground, opacity, lighting, 2);
    for (const channel of ["r", "g", "b"]) {
      assert.ok(Math.abs(shown[channel] - target[channel]) <= 1,
        `${n}/${channel}: ${shown[channel]} vs ${target[channel]}`);
    }
    assert.deepEqual(cache.rgb(amounts, mass, ground, opacity, lighting, 2), shown);
  }
});

test("高速表示の量子化は淡い微量顔料・極薄層・色域境界も1階調以内に保つ", () => {
  const cache = new PaintFilmCache(64);
  const grounds = [
    { r: 1, g: 0, b: 0 }, { r: 0, g: 0, b: 1 },
    { r: 0.93, g: 0.88, b: 0.79 }, { r: 0.02, g: 0.02, b: 0.02 },
  ].map(spectralSurfaceFromLinearRgb);
  for (let p = 0; p < 4; p += 1) {
    for (const trace of [0, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 0.001, 0.01, 0.1, 0.5, 1]) {
      const pigments = [0, 0, 0, 0, 1 - trace];
      pigments[p] = trace;
      for (const mass of [0, 1e-7, 1e-6, 1e-5, 0.0001, 0.001, 0.01, 0.1, 0.5, 1, 6]) {
        for (const lighting of [0.55, 0.8, 1, 1.2, 1.55]) {
          for (const ground of grounds) {
            const expected = cloneSpectralSurface(ground);
            applySpectralFilm(expected, mixPigmentFilm(pigments, mass * 24), 1, lighting);
            const target = bytes(spectralSurfaceToLinearRgb(expected));
            const shown = cache.rgb(pigments, mass, ground, 1, lighting);
            for (const channel of ["r", "g", "b"]) {
              assert.ok(Math.abs(shown[channel] - target[channel]) <= 1,
                `${p}/${trace}/${mass}/${lighting}/${channel}: ${shown[channel]} vs ${target[channel]}`);
            }
          }
        }
      }
    }
  }
});

test("高速線形光の後に線画を合成しても、途中の色域写像や8bit丸めが入らない", () => {
  const rnd = random(), cache = new PaintFilmCache(32);
  const paper = spectralSurfaceFromLinearRgb({ r: 0.95, g: 0.9, b: 0.8 });
  for (let n = 0; n < 2000; n += 1) {
    const amounts = Array.from({ length: 5 }, () => rnd() ** 4);
    const mass = 10 ** (-5 + 6 * rnd()), lighting = 0.55 + rnd(), opacity = rnd();
    const ink = { r: rnd(), g: rnd(), b: rnd() }, alpha = rnd();
    const expected = cloneSpectralSurface(paper);
    applySpectralFilm(expected, mixPigmentFilm(amounts, mass * 24), opacity, lighting);
    blendSpectralSurface(expected, spectralSurfaceFromLinearRgb(ink), alpha);
    const target = bytes(spectralSurfaceToLinearRgb(expected));
    const paint = cache.linear(amounts, mass, paper, opacity, lighting);
    const mixed = Object.fromEntries(["r", "g", "b"]
      .map((channel) => [channel, paint[channel] * (1 - alpha) + ink[channel] * alpha]));
    const shown = bytes(displayLinearColor(mixed));
    for (const channel of ["r", "g", "b"]) {
      assert.ok(Math.abs(shown[channel] - target[channel]) <= 1,
        `${n}/${channel}: ${shown[channel]} vs ${target[channel]}`);
    }
  }
});

test("RGB画像下地・上下の線画・空レイヤーの実合成は一般分光経路と1階調以内で一致する", () => {
  const rnd = random(), bounds = { x: 0, y: 0, width: 1, height: 1 };
  const rgba = (values) => ({ width: 1, height: 1, data: Uint8ClampedArray.from(values) });
  const emptyA = createPigmentField(1, 1), emptyB = createPigmentField(1, 1);
  for (let n = 0; n < 1000; n += 1) {
    const amounts = Array.from({ length: 5 }, () => rnd() ** 4);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const pigment = Float32Array.from(amounts.map((value) => value / total));
    const mass = Math.fround(10 ** (-5 + 6 * rnd())), opacity = rnd();
    const fast = createPigmentField(1, 1), reference = createPigmentField(1, 1);
    fast.pigment.set(pigment);
    fast.mass[0] = mass;
    reference.glazes.set(0, [{ pigment, mass, lighting: 1 }]);
    const paper = rgba([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255]);
    const below = rgba([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), [0, 128, 255][n % 3]]);
    const above = rgba([Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), [0, 128, 255][Math.floor(n / 3) % 3]]);
    const sources = (field) => [
      { kind: "paint", field: emptyA }, { kind: "image", image: below, opacity: 0.7 },
      { kind: "paint", field, opacity }, { kind: "paint", field: emptyB },
      { kind: "image", image: above, opacity: 0.8 },
    ];
    const shown = rgba([0, 0, 0, 0]), target = rgba([0, 0, 0, 0]);
    compositePigmentLayers(paper, sources(fast), shown, bounds, { wetDarkening: 0, relief: 0 });
    compositePigmentLayers(paper, sources(reference), target, bounds, { wetDarkening: 0, relief: 0 });
    for (let channel = 0; channel < 4; channel += 1) {
      assert.ok(Math.abs(shown.data[channel] - target.data[channel]) <= 1,
        `${n}/${channel}: ${shown.data[channel]} vs ${target.data[channel]}`);
    }
  }
});
