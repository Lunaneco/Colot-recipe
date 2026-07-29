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

async function saveBaseRecipe(page: Page, name: string) {
  const canvas = page.getByTestId("mix-canvas");
  const point = { x: 0.5, y: 0.58 };

  await page.getByTestId("material-red").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-blue").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-water").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await clickCanvasAtRatio(canvas, point.x, point.y);

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤2・青1・水2",
  );
  await saveDialog.getByLabel("色の名前").fill(name);
  await saveDialog.getByTestId("confirm-save-color").click();
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

async function expectEmptyMixer(page: Page, canvas: Locator) {
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "まっさらに" })).toBeDisabled();
  await expect(page.getByTestId("mix-all")).toBeDisabled();
  await expect(canvas.locator(".canvas-onboarding")).toBeVisible();
  await expect(canvas.locator(".canvas-gesture-hint")).toHaveCount(0);
  await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(false);
}

async function expectPaintedMixer(page: Page, canvas: Locator) {
  // The detailed bars are intentionally visually collapsed at mobile width,
  // but their presence still reflects the current recipe state.
  await expect(page.getByTestId("recipe-summary")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "まっさらに" })).toBeEnabled();
  await expect(page.getByTestId("mix-all")).toBeEnabled();
  await expect(canvas.locator(".canvas-onboarding")).toHaveCount(0);
  await expect(canvas.locator(".canvas-gesture-hint")).toHaveCount(0);
  await expect.poll(() => sourceCanvasHasPaint(canvas)).toBe(true);
}

async function touchDragCanvas(
  page: Page,
  canvas: Locator,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  const start = {
    x: Math.round(box.x + box.width * x),
    y: Math.round(box.y + box.height * y),
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
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + deltaX,
          y: start.y + deltaY,
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
}

async function touchTapElement(page: Page, element: Locator) {
  const box = await element.boundingBox();
  if (!box) throw new Error("Touch target is unavailable");
  await page.touchscreen.tap(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
}

test("保存色を混色パレットへ置くたびに元レシピの配合をそのまま加算する", async ({
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
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-blue").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-water").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await clickCanvasAtRatio(canvas, point.x, point.y);

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤2・青1・水2",
  );
  await saveDialog.getByLabel("色の名前").fill("赤二青一の水入り紫");
  await saveDialog.getByTestId("confirm-save-color").click();

  await page.getByRole("button", { name: "まっさらに" }).click();
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);

  const recipeMaterial = page.getByTestId("recipe-material-0");
  await expect(recipeMaterial).toBeVisible();
  await expect(recipeMaterial).toHaveAccessibleName(
    /保存色「赤二青一の水入り紫」を混色材料にする。配合は赤2・青1・水2/,
  );
  await recipeMaterial.click();
  await expect(recipeMaterial).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("material-red").click();
  await expect(recipeMaterial).toHaveAttribute("aria-pressed", "false");

  // Selecting a saved swatch should make that recipe the active paint in
  // 「いろをつくる」 without requiring the detail dialog or a reset.
  await page.getByTestId("saved-color-0").click();
  await expect(page.getByTestId("saved-color-0")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(recipeMaterial).toHaveAttribute("aria-pressed", "true");

  // Switching back to a base paint must clear both selection surfaces. The
  // next saved-swatch click selects it again instead of opening details.
  await page.getByTestId("material-red").click();
  await expect(page.getByTestId("saved-color-0")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(recipeMaterial).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("saved-color-0").click();
  await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);
  await expect(recipeMaterial).toHaveAttribute("aria-pressed", "true");

  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  // A second placement is one more full batch, so every material is scaled by
  // the same factor instead of treating the saved colour as one opaque unit.
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("4");
  await expect(page.getByTestId("recipe-blue")).toHaveText("2");
  await expect(page.getByTestId("recipe-water")).toHaveText("4");

  // The saved recipe must also participate in local spatial mixing. Adding one
  // yellow unit at the same point gives the exact 4:2:1 pigment ratio.
  await page.getByTestId("material-yellow").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.locator(".pigment-ratio strong")).toHaveText(
    "赤 57.1%：青 28.6%：黄 14.3%",
  );
  await expect(page.locator(".recipe-row--water .ratio-value")).toHaveText(
    "36.4%",
  );
});

test("保存上限へ達した後は通常絵の具でも安全に超過させない", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const maximumRecipe = {
    red: 1_000,
    blue: 1_000,
    yellow: 500,
    white: 0,
    water: 0,
  };
  await page
    .getByLabel("カラーレシピJSONを読み込む")
    .setInputFiles({
      name: "maximum-recipe.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 2,
          colors: [
            {
              id: "maximum-recipe",
              name: "保存上限のレシピ",
              recipe: maximumRecipe,
            },
          ],
        }),
      ),
    });

  const canvas = page.getByTestId("mix-canvas");
  await page.getByTestId("saved-color-0").click();
  await clickCanvasAtRatio(canvas, 0.5, 0.58);
  await expect(page.getByTestId("recipe-red")).toHaveText("1000");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1000");
  await expect(page.getByTestId("recipe-yellow")).toHaveText("500");

  await page.getByTestId("material-white").click();
  await clickCanvasAtRatio(canvas, 0.5, 0.58);
  await expect(page.getByTestId("recipe-white")).toHaveCount(0);
  await expect(page.getByText(/配合の保存上限に達したため/)).toBeVisible();

  await page.getByTestId("material-water").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mixing canvas is unavailable");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.58);
  await page.mouse.down();
  await page.waitForTimeout(430);
  await page.mouse.move(
    box.x + box.width * 0.7,
    box.y + box.height * 0.58,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByTestId("recipe-water")).toHaveCount(0);
  await expect(page.getByText(/この長さでは配合の保存上限を超える/))
    .toBeVisible();
});

test("保存レシピ1バッチをUndo・Redo・消しゴムで一括操作する", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const canvas = page.getByTestId("mix-canvas");
  const point = { x: 0.5, y: 0.58 };

  await saveBaseRecipe(page, "一括操作する水入り紫");
  await page.getByRole("button", { name: "まっさらに" }).click();
  await page.getByTestId("recipe-material-0").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);

  await page.getByTestId("redo").click();
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  await page.getByTestId("material-eraser").click();
  await clickCanvasAtRatio(canvas, point.x, point.y);
  await expect(page.getByTestId("recipe-summary")).toHaveCount(0);

  // Erasing a compound dab is itself one history entry and restores the whole
  // batch, not only its primary display pigment.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");
});

test("保存レシピを使った色を再保存・再読込しても局所配合を保つ", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const point = { x: 0.5, y: 0.58 };

  await saveBaseRecipe(page, "もとの水入り紫");
  await page.getByRole("button", { name: "まっさらに" }).click();
  await page.getByTestId("recipe-material-0").click();
  await clickCanvasAtRatio(page.getByTestId("mix-canvas"), point.x, point.y);
  await page.getByTestId("material-yellow").click();
  await clickCanvasAtRatio(page.getByTestId("mix-canvas"), point.x, point.y);

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog.locator(".save-dialog__summary")).toContainText(
    "赤2・青1・黄1・水2",
  );
  await saveDialog
    .getByLabel("色の名前")
    .fill("保存レシピを重ねた水入り色");
  await saveDialog.getByTestId("confirm-save-color").click();
  await page.waitForTimeout(250);

  await page.reload();
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const saved = page.getByTestId("saved-color-0");
  await saved.click();
  await saved.click();
  const detail = page.getByTestId("recipe-dialog");
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "赤" }),
  ).toContainText("2単位");
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "青" }),
  ).toContainText("1単位");
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "黄" }),
  ).toContainText("1単位");
  await expect(
    detail.locator(".color-detail__recipe > div").filter({ hasText: "水" }),
  ).toContainText("2単位");

  await detail.getByRole("button", { name: "もう一度つくる" }).click();
  await expect(page.getByTestId("recipe-red")).toHaveText("2");
  await expect(page.getByTestId("recipe-blue")).toHaveText("1");
  await expect(page.getByTestId("recipe-yellow")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  await page.getByTestId("material-picker").click();
  await clickCanvasAtRatio(page.getByTestId("mix-canvas"), point.x, point.y);
  await expect(page.locator(".pigment-ratio strong")).toHaveText(
    "赤 50.0%：青 25.0%：黄 25.0%",
  );
  await expect(page.locator(".recipe-row--water .ratio-value")).toHaveText(
    "33.3%",
  );
});

test.describe("スマホの混色パレット", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("通常色と保存レシピ色を置いて何度クリアしても表示と操作状態が同期する", async ({
    page,
  }) => {
    await page.goto("./");
    await expect(page.locator(".color-recipe-app")).toHaveAttribute(
      "data-app-ready",
      "true",
    );
    const canvas = page.getByTestId("mix-canvas");
    const clear = page.getByRole("button", { name: "まっさらに" });
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Mixing canvas is unavailable");

    await expectEmptyMixer(page, canvas);

    await page.getByTestId("material-red").click();
    await page.touchscreen.tap(
      box.x + box.width * 0.5,
      box.y + box.height * 0.58,
    );
    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    await expectPaintedMixer(page, canvas);

    await page.getByTestId("open-save-color").click();
    const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
    await saveDialog.getByLabel("色の名前").fill("スマホで使う保存赤");
    await saveDialog.getByTestId("confirm-save-color").click();

    await touchTapElement(page, clear);
    await expectEmptyMixer(page, canvas);

    await page.getByTestId("material-blue").click();
    // A finger naturally shifts a few pixels before release. On a blank
    // palette this must still place paint instead of becoming a no-op.
    await touchDragCanvas(page, canvas, 0.48, 0.58, 8, 3);
    await expect
      .poll(async () =>
        Number(await page.getByTestId("recipe-blue").textContent()),
      )
      .toBeGreaterThan(0);
    await expectPaintedMixer(page, canvas);

    await touchTapElement(page, clear);
    await expectEmptyMixer(page, canvas);

    const savedRecipe = page.getByTestId("recipe-material-0");
    await savedRecipe.click();
    await expect(savedRecipe).toHaveAttribute("aria-pressed", "true");
    const refreshedBox = await canvas.boundingBox();
    if (!refreshedBox) throw new Error("Mixing canvas is unavailable");
    await page.touchscreen.tap(
      refreshedBox.x + refreshedBox.width * 0.5,
      refreshedBox.y + refreshedBox.height * 0.58,
    );
    await expect(page.getByTestId("recipe-red")).toHaveText("1");
    await expectPaintedMixer(page, canvas);

    await touchTapElement(page, clear);
    await expectEmptyMixer(page, canvas);
  });
});
