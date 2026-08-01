import { expect, test, type Locator } from "@playwright/test";
import { mixPaint } from "../lib/colorScience";

type CanvasDigest = {
  alphaPixels: number;
  alphaSum: number;
  redSum: number;
  greenSum: number;
  blueSum: number;
  hash: number;
};

async function canvasDigest(canvas: Locator): Promise<CanvasDigest> {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("2D canvas context is unavailable");
    const pixels = context.getImageData(
      0,
      0,
      target.width,
      target.height,
    ).data;
    let alphaPixels = 0;
    let alphaSum = 0;
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let hash = 2_166_136_261;

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3];
      if (alpha > 0) {
        alphaPixels += 1;
        redSum += pixels[offset];
        greenSum += pixels[offset + 1];
        blueSum += pixels[offset + 2];
        alphaSum += alpha;
      }
      hash = Math.imul(hash ^ pixels[offset], 16_777_619);
      hash = Math.imul(hash ^ pixels[offset + 1], 16_777_619);
      hash = Math.imul(hash ^ pixels[offset + 2], 16_777_619);
      hash = Math.imul(hash ^ alpha, 16_777_619);
    }

    return {
      alphaPixels,
      alphaSum,
      redSum,
      greenSum,
      blueSum,
      hash: hash >>> 0,
    };
  });
}

async function canvasPixelAtRatio(
  canvas: Locator,
  x: number,
  y: number,
) {
  return canvas.evaluate(
    (element, point) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D canvas context is unavailable");
      return Array.from(
        context.getImageData(
          Math.min(target.width - 1, Math.floor(target.width * point.x)),
          Math.min(target.height - 1, Math.floor(target.height * point.y)),
          1,
          1,
        ).data,
      );
    },
    { x, y },
  );
}

async function liveCanvasObservation(
  target: Locator,
  recipeTestId: string,
  x: number,
  y: number,
) {
  return target.evaluate(
    (element, observation) => {
      const preview = element.querySelector<HTMLCanvasElement>(
        '[data-testid="paint-stroke-preview"]',
      );
      const source = element.querySelector<HTMLCanvasElement>(
        "canvas.paint-layer--source",
      );
      const gloss = element.querySelector<HTMLCanvasElement>(
        "canvas.paint-layer--gloss",
      );
      const hold = element.querySelector<HTMLElement>(".paint-hold-preview");
      const recipe = document.querySelector<HTMLElement>(
        `[data-testid="${observation.recipeTestId}"]`,
      );
      const context = preview?.getContext("2d", {
        willReadFrequently: true,
      });
      if (!preview || !source || !gloss || !context || !recipe) {
        throw new Error("Live canvas layers are unavailable");
      }
      const pixel = Array.from(
        context.getImageData(
          Math.min(
            preview.width - 1,
            Math.floor(preview.width * observation.x),
          ),
          Math.min(
            preview.height - 1,
            Math.floor(preview.height * observation.y),
          ),
          1,
          1,
        ).data,
      );
      return {
        active: (element as HTMLElement).dataset.livePreview,
        units: Number(recipe.textContent),
        pixel,
        sourceOpacity: getComputedStyle(source).opacity,
        glossOpacity: getComputedStyle(gloss).opacity,
        previewZIndex: getComputedStyle(preview).zIndex,
        holdOpacity: hold ? getComputedStyle(hold).opacity : undefined,
      };
    },
    { recipeTestId, x, y },
  );
}

async function clickCanvasAtRatio(
  canvas: Locator,
  x: number,
  y: number,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  await canvas.click({
    position: {
      x: Math.round(box.width * x),
      y: Math.round(box.height * y),
    },
  });
}

test("押した瞬間から正しい混色を描画し、ドラッグ後も空白なしで確定する", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );

  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const preview = page.getByTestId("paint-stroke-preview");
  const startRatio = { x: 0.34, y: 0.62 };
  const endRatio = { x: 0.72, y: 0.62 };

  // Establish red at the exact next contact point, then press blue over it.
  // The live raster must show the calibrated 1:1 mixture—not a raw blue dab
  // or a recipe readout that updates while the canvas waits for pointerup.
  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, startRatio.x, startRatio.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await expect
    .poll(async () => (await canvasDigest(source)).alphaPixels)
    .toBeGreaterThan(0);
  await page.getByTestId("material-blue").click();
  await expect(page.getByTestId("material-blue")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const sourceBefore = await canvasDigest(source);
  const colorNameBefore = await page.getByTestId("color-name").innerText();
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  await expect.poll(async () => (await canvasDigest(preview)).alphaPixels).toBe(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  const start = {
    x: box.x + box.width * startRatio.x,
    y: box.y + box.height * startRatio.y,
  };
  const end = {
    x: box.x + box.width * endRatio.x,
    y: box.y + box.height * endRatio.y,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();

  // The recipe and resulting colour react from the first contact, while the
  // authoritative paint/history still wait for pointerup.
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("color-name")).not.toHaveText(colorNameBefore);
  await expect(page.getByTestId("open-save-color")).toBeDisabled();
  const pressed = await liveCanvasObservation(
    canvas,
    "recipe-blue",
    startRatio.x,
    startRatio.y,
  );
  const expectedPressedRgb = mixPaint({
    red: 1,
    blue: pressed.units,
  }).rgb;
  expect(pressed.pixel.slice(0, 3)).toEqual([
    expectedPressedRgb.r,
    expectedPressedRgb.g,
    expectedPressedRgb.b,
  ]);
  expect(pressed.pixel[3]).toBeGreaterThanOrEqual(250);
  expect(pressed.active).toBe("true");
  expect(pressed.sourceOpacity).toBe("0");
  expect(["0", "1"]).toContain(pressed.glossOpacity);
  expect(pressed.previewZIndex).toBe("1");
  expect(pressed.holdOpacity).toBe("0");
  expect(await canvasDigest(source)).toEqual(sourceBefore);

  await page.mouse.move(end.x, end.y, { steps: 4 });

  // The complete transient composite and recipe both grow while pressed.
  // Authoritative history remains untouched until pointerup.
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBeGreaterThan(500);
  const livePreview = await canvasDigest(preview);
  expect(livePreview.alphaPixels).toBeGreaterThan(500);
  expect(livePreview.alphaSum).toBeGreaterThan(0);
  await expect
    .poll(async () =>
      (await canvasPixelAtRatio(
        preview,
        endRatio.x,
        endRatio.y,
      )).slice(0, 3),
    )
    .toEqual([0, 161, 233]);
  expect(
    (await canvasPixelAtRatio(preview, endRatio.x, endRatio.y))[3],
  ).toBeGreaterThanOrEqual(250);
  expect(await canvasDigest(source)).toEqual(sourceBefore);
  const liveBlueUnits = Number(
    await page.getByTestId("recipe-blue").textContent(),
  );
  expect(liveBlueUnits).toBeGreaterThan(1);

  await page.mouse.up();

  // The first observation after release must still contain paint at the new
  // tail: either the retained transient raster or the committed source. This
  // guards the single blank-frame flash that is especially visible on touch.
  const immediateHandoffPixels = await Promise.all([
    canvasPixelAtRatio(preview, endRatio.x, endRatio.y),
    canvasPixelAtRatio(source, endRatio.x, endRatio.y),
  ]);
  expect(
    Math.max(...immediateHandoffPixels.map((pixel) => pixel[3])),
  ).toBeGreaterThan(8);
  await expect(page.getByTestId("recipe-blue")).toBeVisible();
  const committedBlueUnits = Number(
    await page.getByTestId("recipe-blue").textContent(),
  );
  expect(committedBlueUnits).toBe(liveBlueUnits);
  await expect(page.getByTestId("open-save-color")).toBeEnabled();
  await expect.poll(async () => canvasDigest(source)).toEqual(livePreview);
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBe(0);

  // The whole stretch is one history operation: one undo restores the exact
  // pre-gesture recipe and authoritative canvas.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  await expect
    .poll(async () => canvasDigest(source))
    .toEqual(sourceBefore);
});

test("長押し中はキャンバスも量に合わせて育ち、同じ画素で確定する", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );

  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const preview = page.getByTestId("paint-stroke-preview");
  const point = { x: 0.46, y: 0.48 };
  const sourceBefore = await canvasDigest(source);
  await page.getByTestId("material-yellow").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");

  await page.mouse.move(
    box.x + box.width * point.x,
    box.y + box.height * point.y,
  );
  await page.mouse.down();
  await expect(page.getByTestId("recipe-yellow")).toHaveText("1");
  await expect(page.getByTestId("open-save-color")).toBeDisabled();
  const firstContact = await canvasDigest(preview);
  expect(firstContact.alphaPixels).toBeGreaterThan(500);
  expect(firstContact.alphaSum).toBeGreaterThan(0);
  expect(await canvasDigest(source)).toEqual(sourceBefore);

  // Wait for the clamped maximum so pointerup cannot cross another timing
  // boundary between the last live frame and the release event.
  await expect(page.getByTestId("recipe-yellow")).toHaveText("8");
  const liveYellowUnits = Number(
    await page.getByTestId("recipe-yellow").textContent(),
  );
  const heldPreview = await canvasDigest(preview);
  expect(heldPreview).not.toEqual(firstContact);
  expect(heldPreview.alphaPixels).toBeGreaterThan(firstContact.alphaPixels);
  expect(await canvasDigest(source)).toEqual(sourceBefore);

  await page.mouse.up();
  const immediateHandoffPixels = await Promise.all([
    canvasPixelAtRatio(preview, point.x, point.y),
    canvasPixelAtRatio(source, point.x, point.y),
  ]);
  expect(
    Math.max(...immediateHandoffPixels.map((pixel) => pixel[3])),
  ).toBeGreaterThan(8);
  await expect(page.getByTestId("recipe-yellow")).toHaveText(
    String(liveYellowUnits),
  );
  await expect(page.getByTestId("open-save-color")).toBeEnabled();
  await expect.poll(async () => canvasDigest(source)).toEqual(heldPreview);
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBe(0);

  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-yellow")).toHaveCount(0);
  await expect.poll(async () => canvasDigest(source)).toEqual(sourceBefore);
});

test("押下中にviewportと内部キャンバスの寸法が変わってもライブ描画を保つ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );

  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const preview = page.getByTestId("paint-stroke-preview");
  const point = { x: 0.58, y: 0.55 };
  await page.getByTestId("material-blue").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");

  await page.mouse.move(
    box.x + box.width * point.x,
    box.y + box.height * point.y,
  );
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-live-preview", "true");
  await expect
    .poll(async () =>
      (await canvasPixelAtRatio(preview, point.x, point.y)).slice(0, 3),
    )
    .toEqual([0, 161, 233]);
  const heightBefore = Number(await preview.getAttribute("height"));
  expect(heightBefore).toBeGreaterThan(0);

  // This mirrors a mobile browser gaining vertical viewport space. Updating
  // a canvas height resets its bitmap, so the active request must be replayed.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(async () => Number(await preview.getAttribute("height")))
    .not.toBe(heightBefore);
  await expect(canvas).toHaveAttribute("data-live-preview", "true");
  await expect
    .poll(async () =>
      (await canvasPixelAtRatio(preview, point.x, point.y)).slice(0, 3),
    )
    .toEqual([0, 161, 233]);
  expect(
    (await canvasPixelAtRatio(preview, point.x, point.y))[3],
  ).toBeGreaterThanOrEqual(240);
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBeGreaterThan(500);
  expect((await canvasDigest(source)).alphaPixels).toBe(0);

  await page.mouse.up();
  await expect
    .poll(async () =>
      (await canvasPixelAtRatio(source, point.x, point.y)).slice(0, 3),
    )
    .toEqual([0, 161, 233]);
  expect(
    (await canvasPixelAtRatio(source, point.x, point.y))[3],
  ).toBeGreaterThanOrEqual(240);
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBe(0);
  expect(
    Number(await page.getByTestId("recipe-blue").textContent()),
  ).toBeGreaterThanOrEqual(1);
});

test("押下中のUndoは古いライブジェスチャーを破棄し、pointerupでも再確定しない", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );

  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const preview = page.getByTestId("paint-stroke-preview");
  const blank = await canvasDigest(source);

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, 0.28, 0.32);
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  expect(await canvasDigest(source)).not.toEqual(blank);

  await page.getByTestId("material-blue").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  await page.mouse.move(
    box.x + box.width * 0.7,
    box.y + box.height * 0.64,
  );
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-live-preview", "true");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBeGreaterThan(500);

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-live-preview", "false");
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBe(0);
  await expect.poll(async () => canvasDigest(source)).toEqual(blank);

  // Releasing the still-captured pointer must only finish cancellation. It
  // must not resurrect either the undone red state or the uncommitted blue.
  await page.mouse.up();
  await page.waitForTimeout(80);
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
  await expect.poll(async () => canvasDigest(source)).toEqual(blank);
  await expect(page.getByTestId("recipe-red")).toHaveCount(0);
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  await expect(page.getByTestId("redo")).toBeEnabled();
});
