import { expect, test, type Locator, type Page } from "@playwright/test";

type AlphaSummary = {
  alphaPixels: number;
  maxAlpha: number;
};

type CanvasEncodingCall = {
  type: string;
  width: number;
  height: number;
};

declare global {
  interface Window {
    __drawingCanvasEncodingCalls: CanvasEncodingCall[];
    __drawingLastPointerId?: number;
  }
}

async function alphaSummary(canvas: Locator): Promise<AlphaSummary> {
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
    let maxAlpha = 0;
    for (let offset = 3; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset];
      if (alpha > 0) alphaPixels += 1;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
    return { alphaPixels, maxAlpha };
  });
}

async function maxAlphaNear(
  canvas: Locator,
  point: { x: number; y: number },
  radius = 3,
) {
  return canvas.evaluate(
    (element, sample) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D canvas context is unavailable");
      const x = Math.max(0, Math.round(sample.x) - sample.radius);
      const y = Math.max(0, Math.round(sample.y) - sample.radius);
      const width = Math.min(target.width - x, sample.radius * 2 + 1);
      const height = Math.min(target.height - y, sample.radius * 2 + 1);
      const pixels = context.getImageData(x, y, width, height).data;
      let maxAlpha = 0;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        maxAlpha = Math.max(maxAlpha, pixels[offset]);
      }
      return maxAlpha;
    },
    { ...point, radius },
  );
}

async function canvasPointAtRatio(
  canvas: Locator,
  xRatio: number,
  yRatio: number,
) {
  const [box, size] = await Promise.all([
    canvas.boundingBox(),
    canvas.evaluate((element) => {
      const layer = element.querySelector("canvas") as HTMLCanvasElement | null;
      if (!layer) throw new Error("Drawing layer is unavailable");
      return { width: layer.width, height: layer.height };
    }),
  ]);
  if (!box) throw new Error("Drawing canvas is unavailable");
  return {
    client: {
      x: box.x + box.width * xRatio,
      y: box.y + box.height * yRatio,
    },
    intrinsic: {
      x: size.width * xRatio,
      y: size.height * yRatio,
    },
  };
}

async function encodingCalls(page: Page) {
  return page.evaluate(
    () => window.__drawingCanvasEncodingCalls,
  );
}

test("描き始めを待たせず、実際の終点まで描いて一度で元に戻せる", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: CanvasEncodingCall[] = [];
    const original = HTMLCanvasElement.prototype.toDataURL;
    window.__drawingCanvasEncodingCalls = calls;
    HTMLCanvasElement.prototype.toDataURL = function (
      type?: string,
      quality?: number,
    ) {
      calls.push({
        type: type ?? "",
        width: this.width,
        height: this.height,
      });
      return quality === undefined
        ? original.call(this, type)
        : original.call(this, type, quality);
    };
  });

  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  await page.getByTestId("mode-draw").click();

  const studio = page.getByTestId("drawing-studio");
  const surface = page.getByTestId("drawing-canvas");
  const layer = surface.locator("canvas").first();
  await expect(studio).toBeVisible();
  await expect(layer).toBeVisible();
  await expect.poll(async () => (await alphaSummary(layer)).alphaPixels).toBe(0);

  const start = await canvasPointAtRatio(surface, 0.24, 0.42);
  const end = await canvasPointAtRatio(surface, 0.72, 0.58);
  await page.evaluate(() => {
    window.__drawingCanvasEncodingCalls.length = 0;
  });

  await page.mouse.move(start.client.x, start.client.y);
  await page.mouse.down();

  // The first dab is visible while the pointer is still held. History has
  // copied raw ImageData, so no synchronous PNG encoding blocks this ink.
  // The default dry round brush is body paint, not a translucent wash.
  await expect
    .poll(() => maxAlphaNear(layer, start.intrinsic))
    .toBeGreaterThan(200);
  expect(await encodingCalls(page)).toEqual([]);

  await page.mouse.move(end.client.x, end.client.y);
  await page.mouse.up();

  // Pointer-up flushes the true final coordinate even when stabilization is
  // enabled, then performs both history PNG encodes after the gesture.
  await expect
    .poll(() => maxAlphaNear(layer, end.intrinsic))
    .toBeGreaterThan(200);
  expect((await encodingCalls(page)).length).toBeGreaterThanOrEqual(2);

  const painted = await alphaSummary(layer);
  expect(painted.alphaPixels).toBeGreaterThan(1_000);
  await expect(
    studio.getByRole("button", { name: "戻す", exact: true }),
  ).toBeEnabled();
  await studio.getByRole("button", { name: "戻す", exact: true }).click();
  await expect.poll(async () => (await alphaSummary(layer)).alphaPixels).toBe(0);

  // Losing capture must finalise/reset the old stroke instead of leaving the
  // canvas permanently locked against the next pen or finger.
  await surface.evaluate((element) => {
    (element as HTMLElement).addEventListener(
      "pointerdown",
      (event) => {
        window.__drawingLastPointerId = event.pointerId;
      },
      { once: true },
    );
  });
  const interrupted = await canvasPointAtRatio(surface, 0.18, 0.22);
  await page.mouse.move(interrupted.client.x, interrupted.client.y);
  await page.mouse.down();
  await surface.evaluate((element) => {
    const pointerId = window.__drawingLastPointerId;
    if (pointerId === undefined) {
      throw new Error("Pointer id was not captured");
    }
    element.releasePointerCapture(pointerId);
  });
  await page.mouse.up();

  const recovered = await canvasPointAtRatio(surface, 0.82, 0.78);
  await page.mouse.click(recovered.client.x, recovered.client.y);
  await expect
    .poll(() => maxAlphaNear(layer, recovered.intrinsic))
    .toBeGreaterThan(200);
});
