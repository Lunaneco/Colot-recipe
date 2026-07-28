import assert from "node:assert/strict";
import test from "node:test";

import {
  compositeRgba,
  computeBrushStampMetrics,
  createPointerPoint,
  fillEnclosedRegion,
  floodFillImageData,
  prepareUploadedLineArt,
  resizeCanvasToDisplaySize,
} from "../lib/paintEngine.ts";

function solidImage(width, height, colour = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set(colour, index * 4);
  }
  return { width, height, data };
}

function setPixel(image, x, y, colour) {
  image.data.set(colour, (y * image.width + x) * 4);
}

function pixel(image, x, y) {
  return Array.from(
    image.data.slice(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    ),
  );
}

test("pointer points normalise unsafe device values", () => {
  const point = createPointerPoint({
    x: 12.5,
    y: -3,
    pressure: 1.8,
    time: -10,
    pointerType: "pen",
    tiltX: 120,
    twist: 500,
  });

  assert.deepEqual(point, {
    x: 12.5,
    y: -3,
    pressure: 1,
    time: 0,
    pointerId: undefined,
    pointerType: "pen",
    tiltX: 90,
    tiltY: 0,
    twist: 359,
  });
});

test("brush stamps respond monotonically to pressure, water, bleed and hardness", () => {
  const dryLowPressure = computeBrushStampMetrics(0.2, {
    size: 40,
    opacity: 1,
    pressureSensitivity: 1,
    moisture: 0,
    bleed: 0,
    hardness: 1,
    spacing: 0.2,
  });
  const dryHighPressure = computeBrushStampMetrics(1, {
    size: 40,
    opacity: 1,
    pressureSensitivity: 1,
    moisture: 0,
    bleed: 0,
    hardness: 1,
    spacing: 0.2,
  });
  const wetSoft = computeBrushStampMetrics(1, {
    size: 40,
    opacity: 1,
    pressureSensitivity: 1,
    moisture: 1,
    bleed: 1,
    hardness: 0,
    spacing: 0.2,
  });

  assert.ok(dryHighPressure.radius > dryLowPressure.radius);
  assert.ok(dryHighPressure.alpha > dryLowPressure.alpha);
  assert.ok(wetSoft.radius > dryHighPressure.radius);
  assert.ok(wetSoft.alpha < dryHighPressure.alpha);
  assert.ok(wetSoft.spacing < dryHighPressure.spacing);
  assert.ok(wetSoft.edgeSoftness > dryHighPressure.edgeSoftness);
  assert.ok(wetSoft.diffusionRadius > dryHighPressure.diffusionRadius);
});

test("source-over alpha composition matches ImageData byte semantics", () => {
  assert.deepEqual(
    compositeRgba([255, 0, 0, 128], [0, 0, 255, 255]),
    { r: 128, g: 0, b: 127, a: 255 },
  );
  assert.deepEqual(
    compositeRgba([1, 2, 3, 0], [9, 8, 7, 120]),
    { r: 9, g: 8, b: 7, a: 120 },
  );
  assert.deepEqual(
    compositeRgba([1, 2, 3, 255], [9, 8, 7, 120]),
    { r: 1, g: 2, b: 3, a: 255 },
  );
});

test("line-art fill repaints the whole enclosure even over existing brush colours", () => {
  const line = solidImage(9, 9, [0, 0, 0, 0]);
  const target = solidImage(9, 9);
  for (let x = 2; x <= 6; x += 1) {
    setPixel(line, x, 2, [30, 30, 30, 255]);
    setPixel(line, x, 6, [30, 30, 30, 255]);
  }
  for (let y = 2; y <= 6; y += 1) {
    setPixel(line, 2, y, [30, 30, 30, 255]);
    setPixel(line, 6, y, [30, 30, 30, 255]);
  }
  setPixel(target, 4, 4, [20, 80, 220, 255]);

  const result = fillEnclosedRegion(
    line,
    target,
    3,
    3,
    [220, 40, 30, 255],
    { gapGuardRadius: 0 },
  );

  assert.equal(result.reason, "filled");
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 5; x += 1) {
      assert.deepEqual(pixel(target, x, y), [220, 40, 30, 255]);
    }
  }
  assert.deepEqual(pixel(target, 1, 1), [255, 255, 255, 255]);
});

test("line-art fill keeps ink boundaries and rejects a tap on the line", () => {
  const line = solidImage(7, 7, [0, 0, 0, 0]);
  const target = solidImage(7, 7);
  for (let y = 0; y < 7; y += 1) {
    setPixel(line, 3, y, [30, 30, 30, 255]);
    setPixel(target, 3, y, [30, 30, 30, 255]);
  }

  const boundary = fillEnclosedRegion(
    line,
    target,
    3,
    3,
    [220, 40, 30, 255],
  );
  assert.equal(boundary.reason, "boundary");

  fillEnclosedRegion(line, target, 1, 3, [220, 40, 30, 255], {
    gapGuardRadius: 0,
    requireEnclosed: false,
  });
  assert.deepEqual(pixel(target, 1, 3), [220, 40, 30, 255]);
  assert.deepEqual(pixel(target, 5, 3), [255, 255, 255, 255]);
  assert.deepEqual(pixel(target, 3, 3), [30, 30, 30, 255]);
});

test("line-art fill rejects an outline that is still open to the page edge", () => {
  const line = solidImage(13, 13, [0, 0, 0, 0]);
  const target = solidImage(13, 13);
  for (let x = 2; x <= 10; x += 1) {
    if (x < 5 || x > 7) setPixel(line, x, 2, [30, 30, 30, 255]);
    setPixel(line, x, 10, [30, 30, 30, 255]);
  }
  for (let y = 2; y <= 10; y += 1) {
    setPixel(line, 2, y, [30, 30, 30, 255]);
    setPixel(line, 10, y, [30, 30, 30, 255]);
  }

  const result = fillEnclosedRegion(
    line,
    target,
    6,
    6,
    [220, 40, 30, 255],
    { gapGuardRadius: 1 },
  );

  assert.equal(result.reason, "open-region");
  assert.deepEqual(pixel(target, 6, 6), [255, 255, 255, 255]);
  assert.deepEqual(pixel(target, 0, 0), [255, 255, 255, 255]);
});

test("line-art fill closes a small gap but never jumps from a narrow frame to outside", () => {
  const line = solidImage(30, 30, [0, 0, 0, 0]);
  const target = solidImage(30, 30);
  for (let x = 10; x <= 15; x += 1) {
    setPixel(line, x, 10, [30, 30, 30, 255]);
    setPixel(line, x, 15, [30, 30, 30, 255]);
  }
  for (let y = 10; y <= 15; y += 1) {
    setPixel(line, 10, y, [30, 30, 30, 255]);
    setPixel(line, 15, y, [30, 30, 30, 255]);
  }

  const narrow = fillEnclosedRegion(
    line,
    target,
    11,
    12,
    [220, 40, 30, 255],
    { gapGuardRadius: 2 },
  );
  assert.equal(narrow.reason, "filled");
  assert.deepEqual(pixel(target, 12, 12), [220, 40, 30, 255]);
  assert.deepEqual(pixel(target, 2, 2), [255, 255, 255, 255]);

  const gappedLine = solidImage(13, 13, [0, 0, 0, 0]);
  const gappedTarget = solidImage(13, 13);
  for (let x = 2; x <= 10; x += 1) {
    if (x !== 6) setPixel(gappedLine, x, 2, [30, 30, 30, 255]);
    setPixel(gappedLine, x, 10, [30, 30, 30, 255]);
  }
  for (let y = 2; y <= 10; y += 1) {
    setPixel(gappedLine, 2, y, [30, 30, 30, 255]);
    setPixel(gappedLine, 10, y, [30, 30, 30, 255]);
  }
  const closedGap = fillEnclosedRegion(
    gappedLine,
    gappedTarget,
    6,
    6,
    [30, 120, 220, 255],
    { gapGuardRadius: 1 },
  );
  assert.equal(closedGap.reason, "filled");
  assert.deepEqual(pixel(gappedTarget, 6, 6), [30, 120, 220, 255]);
  assert.deepEqual(pixel(gappedTarget, 0, 0), [255, 255, 255, 255]);
});

test("uploaded transparent padding stays transparent in the line-art layer", () => {
  const image = solidImage(3, 1, [0, 0, 0, 0]);
  setPixel(image, 1, 0, [0, 0, 0, 255]);
  setPixel(image, 2, 0, [0, 0, 0, 128]);

  prepareUploadedLineArt(image);

  assert.equal(pixel(image, 0, 0)[3], 0);
  assert.equal(pixel(image, 1, 0)[3], 255);
  assert.ok(pixel(image, 2, 0)[3] > 0);
  assert.ok(pixel(image, 2, 0)[3] < 255);
});

test("flood fill closes a one-pixel boundary gap instead of leaking outside", () => {
  const guarded = solidImage(11, 11);
  // A vertical ink boundary, deliberately left open at y=5.
  for (let y = 0; y < guarded.height; y += 1) {
    if (y !== 5) {
      setPixel(guarded, 5, y, [20, 20, 20, 255]);
    }
  }

  const result = floodFillImageData(
    guarded,
    2,
    5,
    [220, 40, 30, 255],
    {
      tolerance: 12,
      gapGuardRadius: 1,
      blendMode: "replace",
    },
  );

  assert.equal(result.reason, "filled");
  assert.ok(result.changedPixels > 0);
  assert.deepEqual(pixel(guarded, 2, 5), [220, 40, 30, 255]);
  assert.deepEqual(pixel(guarded, 8, 5), [255, 255, 255, 255]);
  assert.deepEqual(pixel(guarded, 5, 4), [20, 20, 20, 255]);
});

test("gap guard can be disabled for an ordinary tolerant flood fill", () => {
  const unguarded = solidImage(11, 11);
  for (let y = 0; y < unguarded.height; y += 1) {
    if (y !== 5) {
      setPixel(unguarded, 5, y, [20, 20, 20, 255]);
    }
  }

  floodFillImageData(unguarded, 2, 5, [0, 120, 220, 255], {
    tolerance: 12,
    gapGuardRadius: 0,
    blendMode: "replace",
  });

  assert.deepEqual(pixel(unguarded, 8, 5), [0, 120, 220, 255]);
});

test("flood fill tolerance includes near-colour pixels but preserves ink", () => {
  const image = solidImage(7, 3, [250, 250, 250, 255]);
  setPixel(image, 3, 0, [120, 120, 120, 255]);
  setPixel(image, 3, 1, [120, 120, 120, 255]);
  setPixel(image, 3, 2, [120, 120, 120, 255]);
  setPixel(image, 1, 1, [242, 246, 249, 255]);

  const result = floodFillImageData(image, 0, 1, [40, 170, 90, 128], {
    tolerance: 10,
    gapGuardRadius: 0,
  });

  assert.equal(result.reason, "filled");
  assert.deepEqual(pixel(image, 1, 1), [141, 208, 169, 255]);
  assert.deepEqual(pixel(image, 5, 1), [250, 250, 250, 255]);
  assert.deepEqual(pixel(image, 3, 1), [120, 120, 120, 255]);
});

test("flood fill safety cap aborts without mutating the image", () => {
  const image = solidImage(20, 20);
  const before = image.data.slice();
  const result = floodFillImageData(image, 10, 10, [0, 0, 0, 255], {
    gapGuardRadius: 0,
    maxPixels: 30,
  });

  assert.equal(result.reason, "limit-exceeded");
  assert.equal(result.aborted, true);
  assert.deepEqual(image.data, before);
});

test("high-DPI helper resizes once and keeps drawing coordinates in CSS pixels", () => {
  const transforms = [];
  const context = {
    setTransform(...args) {
      transforms.push(args);
    },
  };
  const canvas = {
    width: 10,
    height: 10,
    clientWidth: 320,
    clientHeight: 180,
    style: {},
    getBoundingClientRect() {
      return { width: 320, height: 180 };
    },
    getContext() {
      return context;
    },
  };

  const first = resizeCanvasToDisplaySize(canvas, {
    dpr: 2,
    maxDpr: 3,
  });
  const second = resizeCanvasToDisplaySize(canvas, {
    dpr: 2,
    maxDpr: 3,
  });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.deepEqual(transforms.at(-1), [2, 0, 0, 2, 0, 0]);
});
