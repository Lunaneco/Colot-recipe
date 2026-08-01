import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import { mixPaint } from "../lib/colorScience";

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

async function holdCanvasAt(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
  durationMs: number,
) {
  await withCanvasTouch(page, canvas, xRatio, yRatio, async () => {
    await page.waitForTimeout(durationMs);
  });
}

async function withCanvasTouch(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
  whilePressed: () => Promise<void>,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          x: box.x + box.width * xRatio,
          y: box.y + box.height * yRatio,
          id: 1,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        },
      ],
    });
    await whilePressed();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function withCanvasTouchAfterMove(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
  delayBeforeMoveMs: number,
  movement: { x: number; y: number },
  whilePressed: () => Promise<void>,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  const start = {
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio,
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
    if (delayBeforeMoveMs > 0) {
      await page.waitForTimeout(delayBeforeMoveMs);
    }
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
    await whilePressed();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function dragCanvas(
  page: Page,
  canvas: Locator,
  xRatio: number,
  yRatio: number,
  movements: Array<{ x: number; y: number }>,
  delayBeforeMoveMs = 0,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is unavailable");
  const start = {
    x: box.x + box.width * xRatio,
    y: box.y + box.height * yRatio,
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
    if (delayBeforeMoveMs > 0) {
      await page.waitForTimeout(delayBeforeMoveMs);
    }
    for (const movement of movements) {
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
      // Keep successive samples in separate animation frames, as a real
      // finger would, instead of allowing Chromium to coalesce the path.
      await page.waitForTimeout(24);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
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

async function visibleDarkPaintCentroid(page: Page, canvas: Locator) {
  const visibleLayer = canvas.locator("canvas.paint-layer--gloss");
  await expect(visibleLayer).toHaveClass(/is-ready/);
  const rect = await visibleLayer.boundingBox();
  if (!rect) throw new Error("Visible paint layer is unavailable");
  const png = await visibleLayer.screenshot({
    animations: "disabled",
    omitBackground: true,
  });
  const component = await page.evaluate(
    async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Screenshot decode failed"));
      });
      const decoded = document.createElement("canvas");
      decoded.width = image.width;
      decoded.height = image.height;
      const context = decoded.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("Screenshot canvas is unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        decoded.width,
        decoded.height,
      ).data;
      const totalPixels = decoded.width * decoded.height;
      const visited = new Uint8Array(totalPixels);
      const queue = new Int32Array(totalPixels);
      let largest = { area: 0, x: 0, y: 0 };
      const isDark = (index: number) => {
        const offset = index * 4;
        return (
          pixels[offset + 3] > 20 &&
          pixels[offset] < 70 &&
          pixels[offset + 1] < 70 &&
          pixels[offset + 2] < 70
        );
      };

      for (let start = 0; start < totalPixels; start += 1) {
        if (visited[start]) continue;
        visited[start] = 1;
        if (!isDark(start)) continue;
        let head = 0;
        let tail = 0;
        let area = 0;
        let weightedX = 0;
        let weightedY = 0;
        queue[tail] = start;
        tail += 1;
        while (head < tail) {
          const index = queue[head];
          head += 1;
          const x = index % decoded.width;
          const y = Math.floor(index / decoded.width);
          area += 1;
          weightedX += x + 0.5;
          weightedY += y + 0.5;
          for (const next of [
            index - 1,
            index + 1,
            index - decoded.width,
            index + decoded.width,
          ]) {
            if (
              next < 0 ||
              next >= totalPixels ||
              visited[next] ||
              Math.abs((next % decoded.width) - x) > 1
            ) {
              continue;
            }
            visited[next] = 1;
            if (isDark(next)) {
              queue[tail] = next;
              tail += 1;
            }
          }
        }
        if (area > largest.area) {
          largest = {
            area,
            x: weightedX / area,
            y: weightedY / area,
          };
        }
      }
      if (largest.area === 0) {
        throw new Error("Visible dark paint was not found");
      }
      return {
        ...largest,
        width: decoded.width,
        height: decoded.height,
      };
    },
    png.toString("base64"),
  );
  return {
    x: rect.x + (component.x / component.width) * rect.width,
    y: rect.y + (component.y / component.height) * rect.height,
    area: component.area,
  };
}

async function sourcePaintBounds(canvas: Locator) {
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
      let left = source.width;
      let top = source.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          if (pixels[(y * source.width + x) * 4 + 3] <= 3) continue;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      if (right < left || bottom < top) return undefined;
      return {
        width: right - left + 1,
        height: bottom - top + 1,
      };
    });
}

async function sourceAlphaAtRatio(
  canvas: Locator,
  xRatio: number,
  yRatio: number,
) {
  return canvas
    .locator("canvas.paint-layer--source")
    .evaluate(
      (element, point) => {
        const source = element as HTMLCanvasElement;
        const context = source.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) throw new Error("2D canvas context is unavailable");
        return context.getImageData(
          Math.min(source.width - 1, Math.floor(source.width * point.x)),
          Math.min(source.height - 1, Math.floor(source.height * point.y)),
          1,
          1,
        ).data[3];
      },
      { x: xRatio, y: yRatio },
    );
}

async function sourcePixelAtRatio(
  canvas: Locator,
  xRatio: number,
  yRatio: number,
) {
  return canvas
    .locator("canvas.paint-layer--source")
    .evaluate(
      (element, point) => {
        const source = element as HTMLCanvasElement;
        const context = source.getContext("2d", {
          willReadFrequently: true,
        });
        if (!context) throw new Error("2D canvas context is unavailable");
        return Array.from(
          context.getImageData(
            Math.min(source.width - 1, Math.floor(source.width * point.x)),
            Math.min(source.height - 1, Math.floor(source.height * point.y)),
            1,
            1,
          ).data,
        );
      },
      { x: xRatio, y: yRatio },
    );
}

async function layerPixelAtRatio(
  layer: Locator,
  xRatio: number,
  yRatio: number,
) {
  return layer.evaluate(
    (element, point) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D canvas context is unavailable");
      return Array.from(
        context.getImageData(
          Math.min(canvas.width - 1, Math.floor(canvas.width * point.x)),
          Math.min(canvas.height - 1, Math.floor(canvas.height * point.y)),
          1,
          1,
        ).data,
      );
    },
    { x: xRatio, y: yRatio },
  );
}

async function renderedScreenshotPixelAtRatio(
  page: Page,
  target: Locator,
  xRatio: number,
  yRatio: number,
) {
  const screenshot = await target.screenshot({ animations: "disabled" });
  return page.evaluate(
    async ({ base64, point }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const decoded = document.createElement("canvas");
      decoded.width = 1;
      decoded.height = 1;
      const context = decoded.getContext("2d");
      if (!context) throw new Error("Screenshot canvas is unavailable");
      const x = Math.min(
        image.naturalWidth - 1,
        Math.floor(image.naturalWidth * point.x),
      );
      const y = Math.min(
        image.naturalHeight - 1,
        Math.floor(image.naturalHeight * point.y),
      );
      context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    },
    {
      base64: screenshot.toString("base64"),
      point: { x: xRatio, y: yRatio },
    },
  );
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
    // Keep the probe clear of the in-canvas size controls. On the shortest
    // iPhone viewport those controls cover much of the upper-left quadrant.
    const target = { x: 0.72, y: 0.47 };

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
    const bounds = await sourcePaintBounds(canvas);
    expect(bounds).toBeDefined();
    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    expect(
      Math.abs((bounds?.width ?? 0) - (bounds?.height ?? 0)),
      JSON.stringify(bounds),
    ).toBeLessThanOrEqual(4);
  });

  test("上部をタップしてもUIに隠れず、表示された絵の具の中心と一致する", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas is unavailable");
    const target = {
      x: box.x + box.width * 0.5,
      y: box.y + box.height * 0.3,
    };

    await touchElement(page, page.getByTestId("material-black"));
    await page.touchscreen.tap(target.x, target.y);
    await expect(canvas.locator(".canvas-gesture-hint")).toHaveCount(0);

    const sourceCentroid = await sourcePaintCentroid(canvas);
    const visibleCentroid = await visibleDarkPaintCentroid(page, canvas);
    expect(sourceCentroid).toBeDefined();
    expect(
      Math.hypot(
        (sourceCentroid?.x ?? 0) - target.x,
        (sourceCentroid?.y ?? 0) - target.y,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.hypot(
        visibleCentroid.x - target.x,
        visibleCentroid.y - target.y,
      ),
    ).toBeLessThanOrEqual(1.5);
  });

  test("Android実タッチは指を離す前から重なりの混色をキャンバスへ表示する", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");
    const preview = page.getByTestId("paint-stroke-preview");
    const point = { x: 0.72, y: 0.52 };

    await touchElement(page, page.getByTestId("material-red"));
    await touchCanvasAt(page, canvas, point.x, point.y);
    await expect
      .poll(async () =>
        (await sourcePixelAtRatio(canvas, point.x, point.y)).slice(0, 3),
      )
      .toEqual([230, 0, 18]);
    const committedRedPixel = await sourcePixelAtRatio(
      canvas,
      point.x,
      point.y,
    );
    expect(committedRedPixel[3]).toBeGreaterThanOrEqual(240);

    await touchElement(page, page.getByTestId("material-blue"));
    let observedLiveBlueUnits = 0;
    await withCanvasTouch(
      page,
      canvas,
      point.x,
      point.y,
      async () => {
        // A real touchStart must paint immediately. At the overlap this is the
        // calibrated live mixture, not the raw selected blue (#00A1E9). A
        // loaded CI runner may cross a hold threshold before this assertion,
        // so compare against the actual live unit count instead of wall time.
        await expect
          .poll(async () => {
            const units = Number(
              await page.getByTestId("recipe-blue").textContent(),
            );
            const pixel = await layerPixelAtRatio(
              preview,
              point.x,
              point.y,
            );
            if (units < 1 || pixel[3] < 240) return false;
            const expected = mixPaint({ red: 1, blue: units }).rgb;
            const matches = pixel.slice(0, 3).every(
              (channel, index) =>
                channel === [expected.r, expected.g, expected.b][index],
            );
            if (matches) observedLiveBlueUnits = units;
            return matches;
          })
          .toBe(true);
        expect(observedLiveBlueUnits).toBeGreaterThanOrEqual(1);
        expect(observedLiveBlueUnits).toBeLessThanOrEqual(8);
        expect(
          await sourcePixelAtRatio(canvas, point.x, point.y),
        ).toEqual(committedRedPixel);

        const unitsBeforeScreenshot = Number(
          await page.getByTestId("recipe-blue").textContent(),
        );
        const visiblePixel = await renderedScreenshotPixelAtRatio(
          page,
          canvas,
          point.x,
          point.y,
        );
        const unitsAfterScreenshot = Number(
          await page.getByTestId("recipe-blue").textContent(),
        );
        const candidateDiffs = Array.from(
          {
            length:
              Math.abs(unitsAfterScreenshot - unitsBeforeScreenshot) + 1,
          },
          (_, index) =>
            Math.min(unitsBeforeScreenshot, unitsAfterScreenshot) + index,
        ).map((units) => {
          const expected = mixPaint({ red: 1, blue: units }).rgb;
          return Math.max(
            ...visiblePixel
              .slice(0, 3)
              .map((channel, index) =>
                Math.abs(
                  channel - [expected.r, expected.g, expected.b][index],
                ),
              ),
          );
        });
        expect(Math.min(...candidateDiffs)).toBeLessThanOrEqual(8);
      },
    );

    const committedBlueUnits = Number(
      await page.getByTestId("recipe-blue").textContent(),
    );
    expect(committedBlueUnits).toBeGreaterThanOrEqual(
      observedLiveBlueUnits,
    );
    expect(committedBlueUnits).toBeLessThanOrEqual(8);
    const expectedCommitted = mixPaint({
      red: 1,
      blue: committedBlueUnits,
    }).rgb;
    await expect
      .poll(async () => {
        const pixel = await sourcePixelAtRatio(canvas, point.x, point.y);
        return pixel.slice(0, 3);
      })
      .toEqual([
        expectedCommitted.r,
        expectedCommitted.g,
        expectedCommitted.b,
      ]);
    expect(
      (await sourcePixelAtRatio(canvas, point.x, point.y))[3],
    ).toBeGreaterThanOrEqual(240);
    await expect
      .poll(async () =>
        (await layerPixelAtRatio(
          preview,
          point.x,
          point.y,
        ))[3]
      )
      .toBe(0);
    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    await expect(page.getByTestId("recipe-blue")).toHaveText(
      String(committedBlueUnits),
    );
  });

  test("Android実タッチの長押しは一操作で中心へ量を重ねて厚く広がる", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-black"));
    await touchCanvasAt(page, canvas, 0.31, 0.55);
    await holdCanvasAt(page, canvas, 0.69, 0.55, 900);

    const heldBlackUnits = Number(
      await page.getByTestId("recipe-black").textContent(),
    );
    expect(heldBlackUnits).toBeGreaterThanOrEqual(5);
    expect(heldBlackUnits).toBeLessThanOrEqual(9);
    await expect
      .poll(async () => {
        const tapAlpha = await sourceAlphaAtRatio(canvas, 0.31, 0.55);
        const holdAlpha = await sourceAlphaAtRatio(canvas, 0.69, 0.55);
        return tapAlpha >= 245 && holdAlpha >= tapAlpha;
      })
      .toBe(true);
    await expect
      .poll(() =>
        sourceAlphaAtRatio(
          canvas,
          0.69 + (76 * 1.05) / 1100,
          0.55,
        )
      )
      .toBeGreaterThan(80);

    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByTestId("recipe-black")).toHaveText("1");
  });

  test("長押しして伸ばした軌跡は、現在のレシピ色ではなく選択色になる", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-red"));
    await touchCanvasAt(page, canvas, 0.28, 0.55);
    await expect(page.getByTestId("recipe-red")).toHaveText("1");

    await touchElement(page, page.getByTestId("material-blue"));
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("Canvas is unavailable");
    const endXRatio = 0.72 + 12 / canvasBox.width;
    let liveBlueUnits = 0;
    await withCanvasTouchAfterMove(
      page,
      canvas,
      0.72,
      0.55,
      430,
      { x: 12, y: 0 },
      async () => {
        const preview = page.getByTestId("paint-stroke-preview");
        await expect
          .poll(async () => {
            const pixel = await preview.evaluate(
              (element, point) => {
                const layer = element as HTMLCanvasElement;
                const context = layer.getContext("2d", {
                  willReadFrequently: true,
                });
                if (!context) return [0, 0, 0, 0];
                return Array.from(
                  context.getImageData(
                    Math.min(
                      layer.width - 1,
                      Math.floor(layer.width * point.x),
                    ),
                    Math.min(
                      layer.height - 1,
                      Math.floor(layer.height * point.y),
                    ),
                    1,
                    1,
                  ).data,
                );
              },
              { x: endXRatio, y: 0.55 },
            );
            return pixel[3];
          })
          .toBeGreaterThan(8);

        // The recipe readout follows the live stroke, while authoritative
        // paint pixels and history remain uncommitted until pointerup.
        liveBlueUnits = Number(
          await page.getByTestId("recipe-blue").textContent(),
        );
        expect(liveBlueUnits).toBeGreaterThanOrEqual(3);
        expect(liveBlueUnits).toBeLessThanOrEqual(9);
        await expect
          .poll(async () => {
            const pixel = await sourcePixelAtRatio(
              canvas,
              endXRatio,
              0.55,
            );
            return pixel[3];
          })
          .toBe(0);
      },
    );

    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    await expect(page.getByTestId("recipe-blue")).toHaveText(
      String(liveBlueUnits),
    );
    const endPixel = await sourcePixelAtRatio(canvas, endXRatio, 0.55);
    expect(endPixel.slice(0, 3)).toEqual([0, 161, 233]);

    // The selected blue stretch is a single action even though it has an
    // origin load and an extended path.
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  });

  test("待たずにドラッグすると初点から連続して塗れ、標本地点数どおりの1単位を一操作で加える", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");
    const source = canvas.locator("canvas.paint-layer--source");
    const preview = page.getByTestId("paint-stroke-preview");

    await touchElement(page, page.getByTestId("material-blue"));
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error("Canvas is unavailable");
    const sourceWidth = await source.evaluate((element) =>
      (element as HTMLCanvasElement).width
    );
    const mediumSpacing = 76 * 0.62;
    // Travel 4.4 fixed sample intervals. This deterministically emits the
    // origin, four full-distance samples, and the visible endpoint tail.
    const movement = {
      x: (mediumSpacing * 4.4 * canvasBox.width) / sourceWidth,
      y: 0,
    };
    const expectedUnits = 6;
    const endRatio = 0.28 + movement.x / canvasBox.width;

    await withCanvasTouchAfterMove(
      page,
      canvas,
      0.28,
      0.55,
      0,
      movement,
      async () => {
        // No 320 ms hold is inserted: the first move must already be visible.
        await expect
          .poll(async () => {
            const pixel = await preview.evaluate(
              (element, point) => {
                const layer = element as HTMLCanvasElement;
                const context = layer.getContext("2d", {
                  willReadFrequently: true,
                });
                if (!context) return 0;
                return context.getImageData(
                  Math.min(
                    layer.width - 1,
                    Math.floor(layer.width * point.x),
                  ),
                  Math.min(
                    layer.height - 1,
                    Math.floor(layer.height * point.y),
                  ),
                  1,
                  1,
                ).data[3];
              },
              { x: endRatio, y: 0.55 },
            );
            return pixel;
          })
          .toBeGreaterThan(8);
        await expect(page.getByTestId("recipe-blue")).toHaveText(
          String(expectedUnits),
        );
      },
    );

    // The initial contact contributes exactly one unit. Every emitted
    // fixed-distance placement, including the visible endpoint, adds one more.
    await expect(page.getByTestId("recipe-blue")).toHaveText(
      String(expectedUnits),
    );
    await expect
      .poll(() => sourceAlphaAtRatio(canvas, 0.28, 0.55))
      .toBeGreaterThan(8);
    await expect
      .poll(() => sourceAlphaAtRatio(canvas, endRatio, 0.55))
      .toBeGreaterThan(8);

    // The whole path is one history operation.
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
  });

  test("保存レシピ色は待たずに伸ばせ、経路全体で配合比とUndoを保つ", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-red"));
    await touchCanvasAt(page, canvas, 0.4, 0.55);
    await touchElement(page, page.getByTestId("material-blue"));
    await touchCanvasAt(page, canvas, 0.54, 0.55);
    await touchCanvasAt(page, canvas, 0.66, 0.55);
    await page.getByTestId("open-save-color").click();
    const dialog = page.getByRole("dialog", { name: "この色を登録" });
    await dialog.getByLabel("色の名前").fill("赤1青2の伸ばす色");
    await dialog.getByTestId("confirm-save-color").click();

    await page.getByRole("button", { name: "まっさらに" }).click();
    await touchElement(page, page.getByTestId("recipe-material-0"));
    await expect(page.getByTestId("recipe-material-0")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await dragCanvas(page, canvas, 0.24, 0.55, [
      { x: 38, y: 0 },
      { x: 76, y: 0 },
      { x: 114, y: 0 },
      { x: 152, y: 0 },
      { x: 188, y: 0 },
    ]);

    await expect
      .poll(async () => {
        const alphas = await Promise.all([
          sourceAlphaAtRatio(canvas, 0.24, 0.55),
          sourceAlphaAtRatio(canvas, 0.5, 0.55),
          sourceAlphaAtRatio(canvas, 0.72, 0.55),
        ]);
        return Math.min(...alphas);
      })
      .toBeGreaterThan(8);

    const redUnits = Number(
      await page.getByTestId("recipe-red").textContent(),
    );
    const blueUnits = Number(
      await page.getByTestId("recipe-blue").textContent(),
    );
    expect(redUnits).toBeGreaterThan(0);
    expect(blueUnits).toBe(redUnits * 2);

    // The entire stretched path is one gesture from pointer-down to pointer-up.
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
  });

  test("水も待たずに初点から伸び、経路全体を一度のUndoで戻せる", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-water"));
    await dragCanvas(page, canvas, 0.28, 0.55, [
      { x: 34, y: 0 },
      { x: 68, y: 0 },
      { x: 102, y: 0 },
    ]);

    await expect
      .poll(async () =>
        Number(await page.getByTestId("recipe-water").textContent())
      )
      .toBeGreaterThan(1);
    await expect
      .poll(async () => {
        const values = await Promise.all([
          sourceAlphaAtRatio(canvas, 0.28, 0.55),
          sourceAlphaAtRatio(canvas, 0.43, 0.55),
          sourceAlphaAtRatio(canvas, 0.56, 0.55),
        ]);
        return Math.min(...values);
      })
      .toBeGreaterThan(2);

    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect(page.getByTestId("recipe-water")).toHaveCount(0);
    await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
  });

  test("長押し中に色を切り替えても別の色として確定しない", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-black"));
    await withCanvasTouch(page, canvas, 0.5, 0.55, async () => {
      await page.waitForTimeout(430);
      await expect
        .poll(async () => Number(
          await page.getByTestId("recipe-black").textContent(),
        ))
        .toBeGreaterThan(1);
      await page.getByTestId("material-blue").click();
      await expect(page.getByTestId("recipe-black")).toHaveCount(0);
    });

    await expect(
      page.getByRole("heading", { name: "まだ色がありません" }),
    ).toBeVisible();
    await expect(page.getByTestId("recipe-black")).toHaveCount(0);
    await expect(page.getByTestId("recipe-blue")).toHaveCount(0);
  });

  test("水の長押し予告と確定形は波打たず同じ真円になる", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "android-chromium");
    const canvas = page.getByTestId("mix-canvas");

    await touchElement(page, page.getByTestId("material-water"));
    await withCanvasTouch(page, canvas, 0.5, 0.55, async () => {
      await page.waitForTimeout(430);
      const preview = page.getByTestId("paint-hold-preview");
      await expect(preview).toBeVisible();
      const geometry = await preview.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          clipPath: getComputedStyle(element).clipPath,
        };
      });
      expect(Math.abs(geometry.width - geometry.height)).toBeLessThanOrEqual(1);
      expect(geometry.clipPath).toContain("circle");
    });

    await expect(page.getByTestId("recipe-water")).toHaveText("2");
    const bounds = await sourcePaintBounds(canvas);
    expect(bounds).toBeDefined();
    expect(
      Math.abs((bounds?.width ?? 0) - (bounds?.height ?? 0)),
      JSON.stringify(bounds),
    ).toBeLessThanOrEqual(4);
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
      .toBeGreaterThan(220);

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
