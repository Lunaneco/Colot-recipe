import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

const APP_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (process.env.PLAYWRIGHT_STATIC === "true"
    ? "http://127.0.0.1:4176/Colot-recipe/"
    : "http://127.0.0.1:3002/");

async function clearAppStorage(context: BrowserContext, page: Page) {
  const session = await context.newCDPSession(page);
  await session.send("Storage.clearDataForOrigin", {
    origin: new URL(APP_BASE_URL).origin,
    storageTypes: "all",
  });
  await session.detach();
}

async function touchElement(
  page: Page,
  locator: Locator,
  movement = { x: 0, y: 0 },
) {
  if (!movement.x && !movement.y) {
    // Locator.tap uses a real touch sequence and waits for drawer transitions
    // and other element motion to settle before choosing the coordinates.
    await locator.tap();
    return;
  }
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Touch target is unavailable");
  const start = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          ...start,
          id: 1,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        },
      ],
    });
    if (movement.x || movement.y) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + movement.x,
            y: start.y + movement.y,
            id: 1,
            radiusX: 1,
            radiusY: 1,
            force: 1,
          },
        ],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function touchCanvasAt(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  await page.touchscreen.tap(
    box.x + box.width * xRatio,
    box.y + box.height * yRatio,
  );
}

async function sourceCanvasHasPaint(canvas: Locator) {
  return canvas
    .locator("canvas.paint-layer--source")
    .evaluate((element) => {
      const source = element as HTMLCanvasElement;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("2D canvas context is unavailable");
      const pixels = context.getImageData(
        0,
        0,
        source.width,
        source.height,
      ).data;
      for (let offset = 3; offset < pixels.length; offset += 4) {
        if (pixels[offset] > 0) return true;
      }
      return false;
    });
}

async function pixelAt(
  canvas: Locator,
  x: number,
  y: number,
): Promise<number[]> {
  return canvas.evaluate(
    (element, point) => {
      const context = (element as HTMLCanvasElement).getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D canvas context is unavailable");
      return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
    },
    { x, y },
  );
}

async function saveSingleColor(
  page: Page,
  material: "red" | "blue",
  name: string,
) {
  await touchElement(page, page.getByTestId(`material-${material}`));
  await touchCanvasAt(page, page.getByTestId("mix-canvas"), 0.5, 0.58);
  await page.getByTestId("open-save-color").click();
  const dialog = page.getByRole("dialog", { name: "この色を登録" });
  await dialog.getByLabel("色の名前").fill(name);
  await dialog.getByTestId("confirm-save-color").click();
}

test.describe("スマホ実タッチの回帰", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test.beforeEach(async ({ context, page }) => {
    await page.goto("./");
    await clearAppStorage(context, page);
    await page.reload();
    await expect(page.locator(".color-recipe-app")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
  });

  test("おえかきとぬりえで保存色を実タッチ選択してすぐ使える", async ({
    page,
  }) => {
    await saveSingleColor(page, "red", "スマホ赤");
    await page.getByRole("button", { name: "まっさらに" }).click();
    await saveSingleColor(page, "blue", "スマホ青");

    await touchElement(page, page.getByTestId("mode-draw"));
    await touchElement(
      page,
      page.getByRole("button", {
        name: "現在の色はスマホ青。保存パレットから変更",
      }),
    );
    const palette = page.getByTestId("saved-palette");
    await expect(palette).toHaveClass(/\bis-open\b/);

    const red = page.getByTestId("saved-color-1");
    await touchElement(page, red);
    await expect(red).toHaveAttribute("aria-pressed", "true");
    await expect(palette).not.toHaveClass(/\bis-open\b/);
    await expect(
      page.getByRole("button", {
        name: "現在の色はスマホ赤。保存パレットから変更",
      }),
    ).toBeVisible();

    const drawingCanvas = page.getByTestId("drawing-canvas");
    const drawingLayer = drawingCanvas.locator("canvas");
    await expect(drawingLayer).toHaveCount(1);
    await touchCanvasAt(page, drawingCanvas, 0.5, 0.5);
    await expect
      .poll(async () => (await pixelAt(drawingLayer, 500, 350)).slice(0, 3))
      .toEqual([230, 95, 102]);
    await expect
      .poll(async () => (await pixelAt(drawingLayer, 500, 350))[3])
      .toBeGreaterThan(250);

    await touchElement(page, page.getByTestId("mode-color"));
    await touchElement(
      page,
      page.getByRole("button", {
        name: "現在の色はスマホ赤。保存パレットから変更",
      }),
    );
    const blue = page.getByTestId("saved-color-0");
    await touchElement(page, blue);
    await expect(blue).toHaveAttribute("aria-pressed", "true");
    await expect(palette).not.toHaveClass(/\bis-open\b/);
    await expect(
      page.getByRole("button", {
        name: "現在の色はスマホ青。保存パレットから変更",
      }),
    ).toBeVisible();

    const coloringCanvas = page.getByTestId("coloring-canvas");
    const fillCanvas = coloringCanvas.locator("canvas.coloring-layer--fill");
    await touchCanvasAt(page, coloringCanvas, 0.5, 0.29);
    await expect
      .poll(async () => (await pixelAt(fillCanvas, 460, 210)).slice(0, 3))
      .toEqual([70, 119, 203]);
    await expect
      .poll(async () => (await pixelAt(fillCanvas, 460, 210))[3])
      .toBeGreaterThan(240);

    await touchElement(
      page,
      page.getByRole("button", {
        name: "現在の色はスマホ青。保存パレットから変更",
      }),
    );
    await touchElement(page, blue);
    await expect(page.getByTestId("recipe-dialog")).toBeVisible();
  });

  test("指が少し動いても、まっさらにを繰り返し実行できる", async ({
    page,
  }) => {
    const canvas = page.getByTestId("mix-canvas");
    const clear = page.getByRole("button", { name: "まっさらに" });

    await touchElement(page, page.getByTestId("material-red"));
    await touchCanvasAt(page, canvas, 0.5, 0.58);
    await expect(clear).toBeEnabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(true);

    await touchElement(page, clear, { x: 5, y: 3 });
    await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
    await expect(clear).toBeDisabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);

    await touchElement(page, page.getByTestId("material-blue"));
    await touchCanvasAt(page, canvas, 0.5, 0.58);
    await expect(clear).toBeEnabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(true);

    await touchElement(page, clear, { x: -4, y: 3 });
    await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
    await expect(clear).toBeDisabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
  });
});
