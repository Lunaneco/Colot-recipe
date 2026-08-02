import { expect, test, type Locator, type Page } from "@playwright/test";

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

async function sourcePixelAt(
  canvas: Locator,
  x: number,
  y: number,
) {
  return canvas.evaluate(
    (element, point) => {
      const source = element as HTMLCanvasElement;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("2D canvas context is unavailable");
      const px = Math.max(
        0,
        Math.min(source.width - 1, Math.round(point.x * source.width)),
      );
      const py = Math.max(
        0,
        Math.min(source.height - 1, Math.round(point.y * source.height)),
      );
      return Array.from(context.getImageData(px, py, 1, 1).data);
    },
    { x, y },
  );
}

async function renderedScreenshotPixelAt(
  page: Page,
  target: Locator,
  x: number,
  y: number,
) {
  const screenshot = await target.screenshot();
  return page.evaluate(
    async ({ base64, point }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Screenshot canvas is unavailable");
      const px = Math.max(
        0,
        Math.min(image.naturalWidth - 1, Math.floor(image.naturalWidth * point.x)),
      );
      const py = Math.max(
        0,
        Math.min(image.naturalHeight - 1, Math.floor(image.naturalHeight * point.y)),
      );
      context.drawImage(image, px, py, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    },
    { base64: screenshot.toString("base64"), point: { x, y } },
  );
}

test("同じ場所の顔料量が2対1なら表示色も正確な2対1混色になる", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const point = { x: 0.5, y: 0.58 };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await page.getByTestId("material-blue").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");

  // The two-constant calibrated 2:1 PR254/PB36 profile is #B0423C. This checks that
  // the renderer receives the exact 2:1 ratio rather than a rounded proxy.
  await expect
    .poll(async () =>
      (await sourcePixelAt(source, point.x, point.y)).slice(0, 3),
    )
    .toEqual([176, 66, 60]);

  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.locator(".pigment-ratio strong")).toHaveText(
    "赤 66.7%：青 33.3%",
  );

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤2・青1",
  );
  await saveDialog.getByLabel("色の名前").fill("赤二対青一");
  await saveDialog.getByTestId("confirm-save-color").click();
  await page.getByTestId("saved-color-0").click();
  await page.getByTestId("saved-color-0").click();
  const detail = page.getByTestId("recipe-dialog");
  await detail.getByRole("button", { name: "もう一度つくる" }).click();
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await page.getByRole("button", { name: "くわしい数値を見る" }).click();
  await expect(page.getByTestId("recipe-hex")).toHaveText("#B0423C");
});

test("水の多いスポイト配合も実際の比率で保存して再現する", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const point = { x: 0.5, y: 0.58 };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-water").click();
  for (let index = 0; index < 10; index += 1) {
    await clickCanvasAtRatio(canvas, point.x, point.y);
  }
  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.locator(".recipe-row--water .ratio-value")).toHaveText(
    "90.9%",
  );

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤1・水10",
  );
  await saveDialog.getByLabel("色の名前").fill("水十対赤一");
  await saveDialog.getByTestId("confirm-save-color").click();
  await page.getByTestId("saved-color-0").click();
  await page.getByTestId("saved-color-0").click();
  await page
    .getByTestId("recipe-dialog")
    .getByRole("button", { name: "もう一度つくる" })
    .click();
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("10");
});

test("重なった場所をスポイトで調べると局所顔料比率が変わる", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");

  const red = page.getByTestId("material-red");
  const yellow = page.getByTestId("material-yellow");
  const picker = page.getByTestId("material-picker");

  await red.click();
  await expect(red).toHaveAttribute("aria-pressed", "true");
  await canvas.click({ position: { x: 360, y: 300 } });
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await yellow.click();
  await expect(yellow).toHaveAttribute("aria-pressed", "true");
  await canvas.click({ position: { x: 440, y: 300 } });
  await expect(page.getByTestId("recipe-yellow")).toHaveText("1");
  await picker.click();
  await expect(picker).toHaveAttribute("aria-pressed", "true");
  await canvas.click({ position: { x: 400, y: 300 } });

  const localRatio = page.locator(".pigment-ratio strong");
  await expect(localRatio).toContainText("赤 50.0%");
  await expect(localRatio).toContainText("黄 50.0%");
  await expect(page.getByRole("heading", { name: "夕焼けオレンジ" })).toBeVisible();

  const balancedRatio = await localRatio.textContent();
  await canvas.click({ position: { x: 385, y: 300 } });
  await expect(localRatio).not.toHaveText(balancedRatio ?? "");
  await expect(localRatio).toContainText("赤 100.0%");
  await expect(localRatio).not.toContainText("黄");

  await page.getByTestId("open-save-color").click();
  const latestPointDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(latestPointDialog.locator(".save-dialog__summary"))
    .toContainText("赤1");
  await expect(latestPointDialog.locator(".save-dialog__summary"))
    .not.toContainText("黄");
});

test("スマホでもスポイトをタップした地点と局所比率がずれない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");

  await page.getByTestId("material-red").click();
  await canvas.click({ position: { x: 170, y: 250 } });
  await page.getByTestId("material-yellow").click();
  await canvas.click({ position: { x: 204, y: 250 } });
  await page.getByTestId("material-picker").click();
  await canvas.click({ position: { x: 187, y: 250 } });

  const localRatio = page.locator(".pigment-ratio strong");
  await expect(localRatio).toContainText("赤 50.0%");
  await expect(localRatio).toContainText("黄 50.0%");
  await expect(page.getByRole("heading", { name: "夕焼けオレンジ" })).toBeVisible();
});

test("スポイトは表示中の描画色を取得し、登録・再読込後も同じ色を保つ", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  await page.addStyleTag({
    content:
      ".sample-point-marker,.canvas-onboarding,.canvas-gesture-hint{display:none!important}",
  });
  const canvas = page.getByTestId("mix-canvas");
  const point = { x: 0.54, y: 0.58 };
  const paperPixel = await renderedScreenshotPixelAt(
    page,
    canvas,
    point.x,
    point.y,
  );

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-yellow").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);

  const inspector = page.locator(".recipe-card");
  await expect(inspector).toHaveAttribute(
    "data-rendered-hex",
    /^#[0-9A-F]{6}$/,
  );
  const rendered = await inspector.evaluate((element) => ({
    hex: element.getAttribute("data-rendered-hex") ?? "",
    opacity: Number(element.getAttribute("data-rendered-opacity")),
  }));
  const visiblePixel = await renderedScreenshotPixelAt(
    page,
    canvas,
    point.x,
    point.y,
  );
  const raw = {
    r: Number.parseInt(rendered.hex.slice(1, 3), 16),
    g: Number.parseInt(rendered.hex.slice(3, 5), 16),
    b: Number.parseInt(rendered.hex.slice(5, 7), 16),
  };
  const expectedVisible = [raw.r, raw.g, raw.b].map((channel, index) =>
    Math.round(
      channel * rendered.opacity +
        paperPixel[index] * (1 - rendered.opacity),
    ),
  );
  for (let index = 0; index < 3; index += 1) {
    expect(Math.abs(visiblePixel[index] - expectedVisible[index])).toBeLessThanOrEqual(
      14,
    );
  }

  await page.getByRole("button", { name: "くわしい数値を見る" }).click();
  await expect(page.getByTestId("recipe-hex")).toHaveText(rendered.hex);
  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    rendered.hex,
  );
  await saveDialog.getByLabel("色の名前").fill("画面どおりの重なり色");
  await saveDialog.getByTestId("confirm-save-color").click();
  await expect(page.getByTestId("saved-color-0")).toBeVisible();
  await page.waitForTimeout(250);

  await page.reload();
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const saved = page.getByTestId("saved-color-0");
  await saved.click();
  await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);
  await saved.click();
  const detail = page.getByTestId("recipe-dialog");
  await expect(detail.locator(".color-detail__values")).toContainText(
    rendered.hex,
  );
});

test("WebGLを使えない環境でも表示中のCanvas 2D画素を取得する", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...attributes: unknown[]
      ) {
        if (["webgl", "webgl2", "experimental-webgl"].includes(type)) {
          return null;
        }
        return Reflect.apply(original, this, [type, ...attributes]);
      },
    });
  });
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const point = { x: 0.5, y: 0.55 };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-yellow").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);

  await expect(page.locator(".canvas-status")).toContainText("軽量表示");
  const pixel = await sourcePixelAt(source, point.x, point.y);
  const expectedHex = `#${pixel
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
  const inspector = page.locator(".recipe-card");
  await expect(inspector).toHaveAttribute("data-rendered-hex", expectedHex);
  await expect
    .poll(async () =>
      Number(await inspector.getAttribute("data-rendered-opacity")),
    )
    .toBeCloseTo(pixel[3] / 255, 2);
});

test("スポイト地点の局所レシピを登録して、もう一度つくれる", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, 0.594, 0.65);
  await clickCanvasAtRatio(canvas, 0.9, 0.65);
  await page.getByTestId("material-yellow").click();
  await clickCanvasAtRatio(canvas, 0.726, 0.65);
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-yellow")).toHaveText("1");

  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, 0.66, 0.65);
  await expect(page.locator(".pigment-ratio strong")).toHaveText(
    "赤 50.0%：黄 50.0%",
  );

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.getByText("スポイト地点の色を残す")).toBeVisible();
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤1・黄1",
  );
  await saveDialog.getByLabel("色の名前").fill("重なりで見つけた橙");
  await saveDialog.getByTestId("confirm-save-color").click();

  await page.getByTestId("saved-color-0").click();
  await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);
  await page.getByTestId("saved-color-0").click();
  const detail = page.getByTestId("recipe-dialog");
  await expect(detail.getByTestId("mix-method")).toContainText(
    "スポイト地点の局所配合",
  );
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "赤" }),
  ).toContainText("1単位");
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "黄" }),
  ).toContainText("1単位");

  await detail.getByRole("button", { name: "もう一度つくる" }).click();
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await expect(page.getByTestId("recipe-yellow")).toHaveText("1");
});

test("スポイトが空白を示す間は登録できず、全体へ戻ると登録できる", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  await page.getByTestId("material-red").click();
  await canvas.click({ position: { x: 400, y: 300 } });

  const saveButton = page.getByTestId("open-save-color");
  await expect(saveButton).toHaveCount(1);
  await expect(page.locator(".recipe-card").getByTestId("open-save-color"))
    .toHaveCount(1);
  await expect(page.locator(".app-header").getByTestId("open-save-color"))
    .toHaveCount(0);
  await expect(saveButton).toBeEnabled();
  await page.getByTestId("material-picker").click();
  await canvas.click({ position: { x: 80, y: 80 } });
  await expect(
    page.getByRole("heading", { name: "ここには絵の具がありません" }),
  ).toBeVisible();
  await expect(saveButton).toHaveAccessibleName("スポイト地点の色を登録");
  await expect(saveButton).toBeDisabled();

  await page
    .getByRole("button", {
      name: "スポイト結果を閉じて全体レシピへ戻る",
    })
    .click();
  await expect(saveButton).toBeEnabled();
  await expect(saveButton).toHaveAccessibleName("この色を登録");
  await expect(saveButton).toHaveCount(1);
});

test("水は選んだ部分だけを濡らし、離れた絵の具の水分量を変えない", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const left = { x: 0.42, y: 0.65 };
  const right = { x: 0.86, y: 0.65 };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, left.x, left.y);
  await clickCanvasAtRatio(canvas, right.x, right.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  const leftBefore = await sourcePixelAt(source, left.x, left.y);
  const rightBefore = await sourcePixelAt(source, right.x, right.y);

  await page.getByTestId("material-water").click();
  await clickCanvasAtRatio(canvas, left.x, left.y);
  await expect(page.getByTestId("recipe-water")).toHaveText("1");
  await page.waitForTimeout(180);
  const leftAfter = await sourcePixelAt(source, left.x, left.y);
  const rightAfter = await sourcePixelAt(source, right.x, right.y);
  const leftDifference = leftAfter.reduce(
    (sum, value, index) => sum + Math.abs(value - leftBefore[index]),
    0,
  );
  const rightDifference = rightAfter.reduce(
    (sum, value, index) => sum + Math.abs(value - rightBefore[index]),
    0,
  );
  expect(leftDifference).toBeGreaterThan(8);
  expect(rightDifference).toBeLessThanOrEqual(4);

  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, left.x, left.y);
  await expect(page.getByTestId("recipe-water")).toHaveText("1.00");
  await expect(page.locator(".recipe-row--water .ratio-value")).toHaveText(
    "50.0%",
  );

  await clickCanvasAtRatio(canvas, right.x, right.y);
  await expect(page.getByTestId("recipe-water")).toHaveCount(0);
  await expect(page.locator(".mobile-water-ratio")).toHaveCount(0);
});

test("水なしは外周まで不透明な絵の具になり、水を加えた場所だけ透明になる", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const source = canvas.locator("canvas.paint-layer--source");
  const point = { x: 0.5, y: 0.58 };
  // Medium paint has a 76 px radius on the 1100 px source canvas.
  const bodyPoint = { x: point.x + (76 * 0.78) / 1100, y: point.y };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  const dryCentre = await sourcePixelAt(source, point.x, point.y);
  const dryBody = await sourcePixelAt(source, bodyPoint.x, bodyPoint.y);

  expect(dryCentre[3]).toBeGreaterThanOrEqual(245);
  expect(dryBody[3]).toBeGreaterThanOrEqual(220);

  await page.getByTestId("material-water").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect
    .poll(async () => (await sourcePixelAt(source, point.x, point.y))[3])
    .toBeLessThan(dryCentre[3] * 0.75);
});
