import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

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
  if (page.context().browser()?.browserType().name() !== "chromium") {
    // Playwright exposes a true tap for WebKit, but low-level moved touch
    // sequences are a Chromium-only protocol feature.
    await locator.tap();
    return;
  }
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

async function touchCanvasWithJitter(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
  movement: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  const start = {
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio,
  };

  if (page.context().browser()?.browserType().name() !== "chromium") {
    await canvas.tap({
      position: {
        x: box.width * xRatio,
        y: box.height * yRatio,
      },
    });
    return start;
  }

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
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
  return start;
}

async function touchElementAt(
  locator: Locator,
  xRatio: number,
  yRatio: number,
) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Touch target is unavailable");
  await locator.tap({
    position: {
      x: box.width * xRatio,
      y: box.height * yRatio,
    },
  });
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

async function sourcePaintCentroid(canvas: Locator) {
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
      let alphaTotal = 0;
      let weightedX = 0;
      let weightedY = 0;
      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          const alpha = pixels[(y * source.width + x) * 4 + 3];
          if (alpha === 0) continue;
          alphaTotal += alpha;
          weightedX += (x + 0.5) * alpha;
          weightedY += (y + 0.5) * alpha;
        }
      }
      if (alphaTotal === 0) return undefined;
      const rect = source.getBoundingClientRect();
      return {
        x: rect.left + (weightedX / alphaTotal / source.width) * rect.width,
        y: rect.top + (weightedY / alphaTotal / source.height) * rect.height,
      };
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

async function expectPixelRgbNear(
  canvas: Locator,
  x: number,
  y: number,
  expected: [number, number, number],
) {
  await expect
    .poll(async () => {
      const actual = (await pixelAt(canvas, x, y)).slice(0, 3);
      return Math.max(
        ...actual.map((channel, index) =>
          Math.abs(channel - expected[index]),
        ),
      );
    })
    .toBeLessThanOrEqual(2);
}

async function expectUnobscuredTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect(locator).toBeEnabled();
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      centerInsideViewport:
        x >= 0 && x < window.innerWidth && y >= 0 && y < window.innerHeight,
      hitOwnTarget: hit === element || element.contains(hit),
      rect: {
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      hitTag: hit?.tagName ?? null,
      hitClass: hit instanceof HTMLElement ? hit.className : null,
    };
  });
  expect(
    geometry.centerInsideViewport,
    `Touch target center is outside the viewport: ${JSON.stringify(geometry)}`,
  ).toBe(true);
  expect(
    geometry.hitOwnTarget,
    `Touch target center is obscured: ${JSON.stringify(geometry)}`,
  ).toBe(true);
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
  test.beforeEach(async ({ page }, testInfo) => {
    await page.goto("./");
    await expect(page.locator(".color-recipe-app")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    const expectedViewports: Record<string, { width: number; height: number }> = {
      "android-chromium": { width: 393, height: 727 },
      "iphone-webkit": { width: 390, height: 664 },
      "iphone-se-webkit": { width: 320, height: 568 },
    };
    expect(page.viewportSize()).toEqual(expectedViewports[testInfo.project.name]);
    const deviceProfile = await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      touchCapable:
        navigator.maxTouchPoints > 0 || "ontouchstart" in window,
      mobileUserAgent: /Mobile|Android|iPhone/.test(navigator.userAgent),
    }));
    expect(deviceProfile.devicePixelRatio).toBeGreaterThan(1);
    expect(deviceProfile.touchCapable).toBe(true);
    expect(deviceProfile.mobileUserAgent).toBe(true);
  });

  test("微小な指ずれがあっても、タップ地点が絵の具の中心になる", async ({
    page,
  }) => {
    const canvas = page.getByTestId("mix-canvas");
    const target = { x: 0.34, y: 0.47 };

    await touchElement(page, page.getByTestId("material-red"));
    const touchStart = await touchCanvasWithJitter(
      page,
      canvas,
      target.x,
      target.y,
      {
        x: 4,
        y: 0,
      },
    );

    await expect
      .poll(async () => {
        const centroid = await sourcePaintCentroid(canvas);
        return centroid
          ? Math.hypot(
              centroid.x - touchStart.x,
              centroid.y - touchStart.y,
            )
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(2);
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
    const redMobileSafety = await red.evaluate((element) => {
      const wrapper = element.closest<HTMLElement>("[data-color-id]");
      return {
        nativeDraggable: wrapper?.draggable ?? true,
        hasOverlappingGrip: Boolean(wrapper?.querySelector(".swatch-grip")),
        touchAction: getComputedStyle(element).touchAction,
      };
    });
    expect(redMobileSafety).toEqual({
      nativeDraggable: false,
      hasOverlappingGrip: false,
      touchAction: "manipulation",
    });
    await touchElementAt(red.locator(".saved-swatch__paint"), 0.8, 0.25);
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
    await expectPixelRgbNear(drawingLayer, 500, 350, [230, 0, 18]);
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
    await touchElementAt(blue.locator(".saved-swatch__paint"), 0.8, 0.25);
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
    await expectPixelRgbNear(fillCanvas, 460, 210, [0, 161, 233]);
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

  test("描いた後に、まっさらにを繰り返し実行できる", async ({
    page,
  }) => {
    const canvas = page.getByTestId("mix-canvas");
    const clear = page.getByRole("button", { name: "まっさらに" });

    await touchElement(page, page.getByTestId("material-red"));
    await touchCanvasAt(page, canvas, 0.38, 0.5);
    await touchCanvasAt(page, canvas, 0.5, 0.58);
    await touchCanvasAt(page, canvas, 0.62, 0.5);
    await expect(clear).toBeEnabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(true);

    await expectUnobscuredTouchTarget(clear);
    await touchElement(page, clear, { x: 5, y: 3 });
    await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
    await expect(clear).toBeDisabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);

    await touchElement(page, page.getByTestId("material-blue"));
    await touchCanvasAt(page, canvas, 0.38, 0.5);
    await touchCanvasAt(page, canvas, 0.5, 0.58);
    await touchCanvasAt(page, canvas, 0.62, 0.5);
    await expect(clear).toBeEnabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(true);

    await expectUnobscuredTouchTarget(clear);
    await touchElement(page, clear, { x: -4, y: 3 });
    await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
    await expect(clear).toBeDisabled();
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
  });
});
