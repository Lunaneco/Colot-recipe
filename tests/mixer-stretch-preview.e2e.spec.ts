import { expect, test, type Locator } from "@playwright/test";

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

test("ドラッグ開始から選択色だけをプレビューし、指を離した時に一度だけ確定する", async ({
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

  // Establish a red current recipe, then select blue for the drag stroke.
  // The preview must use the frozen selected pigment, not the red recipe.
  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, 0.18, 0.22);
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
  const recipeBefore =
    (await page.getByTestId("recipe-summary").innerText()).trim();
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  await expect.poll(async () => (await canvasDigest(preview)).alphaPixels).toBe(0);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  const start = {
    x: box.x + box.width * 0.34,
    y: box.y + box.height * 0.62,
  };
  const end = {
    x: box.x + box.width * 0.72,
    y: box.y + box.height * 0.62,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });

  // The in-progress stroke belongs only to the dedicated preview layer.
  // Authoritative pixels and recipe/history state must not change yet.
  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBeGreaterThan(500);
  const visiblePreview = await canvasDigest(preview);
  expect(visiblePreview.alphaPixels).toBeGreaterThan(500);
  expect(visiblePreview.alphaSum).toBeGreaterThan(0);
  expect(visiblePreview.blueSum).toBeGreaterThan(
    visiblePreview.greenSum * 1.2,
  );
  expect(visiblePreview.blueSum).toBeGreaterThan(
    Math.max(1, visiblePreview.redSum) * 5,
  );
  expect(await canvasDigest(source)).toEqual(sourceBefore);
  expect(
    (await page.getByTestId("recipe-summary").innerText()).trim(),
  ).toBe(recipeBefore);
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);

  await page.mouse.up();

  await expect
    .poll(async () => (await canvasDigest(preview)).alphaPixels)
    .toBe(0);
  await expect(page.getByTestId("recipe-blue")).toBeVisible();
  const committedBlueUnits = Number(
    await page.getByTestId("recipe-blue").textContent(),
  );
  expect(committedBlueUnits).toBeGreaterThan(1);
  expect(await canvasDigest(source)).not.toEqual(sourceBefore);

  // The whole stretch is one history operation: one undo restores the exact
  // pre-gesture recipe and authoritative canvas.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  await expect
    .poll(async () => canvasDigest(source))
    .toEqual(sourceBefore);
});
