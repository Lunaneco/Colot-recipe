import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

const APP_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3002";
const TEST_COLOR_NAME = "夕焼けミルク";
const TEST_COLOR_NOTE = "赤3・黄2・白1・水2の確認用レシピ";

type Material = "red" | "yellow" | "white" | "water";

async function clearAppStorage(context: BrowserContext, page: Page) {
  // Each Playwright test already receives an isolated context. Clearing the
  // app origin as well makes that contract explicit for IndexedDB and the
  // localStorage fallback used by the application.
  const session = await context.newCDPSession(page);
  await session.send("Storage.clearDataForOrigin", {
    origin: new URL(APP_BASE_URL).origin,
    storageTypes: "all",
  });
  await session.detach();
}

async function addUnits(
  page: Page,
  material: Material,
  units: number,
) {
  await page.getByTestId(`material-${material}`).click();
  const canvas = page.getByTestId("mix-canvas");

  for (let index = 0; index < units; index += 1) {
    await canvas.press("Enter");
  }

  await expect(page.getByTestId(`recipe-${material}`)).toHaveText(
    String(units),
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

async function createLineArtPng(
  page: Page,
  variant: "square" | "circle",
): Promise<Buffer> {
  const dataUrl = await page.evaluate((shape) => {
    const canvas = document.createElement("canvas");
    canvas.width = 920;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111";
    context.lineWidth = 12;
    if (shape === "square") {
      context.strokeRect(300, 220, 320, 280);
    } else {
      context.beginPath();
      context.arc(460, 360, 175, 0, Math.PI * 2);
      context.stroke();
    }
    return canvas.toDataURL("image/png");
  }, variant);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function createTransparentLineArtPng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable");
    context.strokeStyle = "#111";
    context.lineWidth = 8;
    context.strokeRect(80, 60, 240, 180);
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function clickCanvasPoint(canvas: Locator, x: number, y: number) {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({
    position: {
      x: (box!.width * x) / 920,
      y: (box!.height * y) / 720,
    },
  });
}

test.beforeEach(async ({ context, page }) => {
  await clearAppStorage(context, page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("link", { name: "カラーレシピ ホーム" }),
  ).toBeVisible();
  await expect(page.getByTestId("mode-mix")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("ヘルプからナレーション・字幕付きチュートリアルを再生できる", async ({
  page,
  request,
}) => {
  const assets = [
    ["/tutorial/color-recipe-tutorial.mp4", "video/mp4"],
    ["/tutorial/color-recipe-tutorial-poster.webp", "image/webp"],
    ["/tutorial/color-recipe-tutorial.ja.vtt", "text/vtt"],
  ] as const;

  for (const [path, contentType] of assets) {
    const response = await request.head(path);
    expect(response.ok(), `${path} should be served`).toBe(true);
    expect(response.headers()["content-type"]).toContain(contentType);
  }

  await page
    .getByRole("button", { name: "使い方を見る", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "3つの手順で、自分だけの色",
  });
  await expect(dialog).toBeVisible();

  const video = dialog.locator("video");
  await expect(video).toHaveAttribute(
    "poster",
    "/tutorial/color-recipe-tutorial-poster.webp",
  );
  await expect(video.locator("source")).toHaveAttribute(
    "src",
    "/tutorial/color-recipe-tutorial.mp4",
  );
  await expect(video.locator("track")).toHaveAttribute(
    "src",
    "/tutorial/color-recipe-tutorial.ja.vtt",
  );
  await expect(video.locator("track")).toHaveAttribute("default", "");

  await video.evaluate(async (element) => {
    const media = element as HTMLVideoElement;
    if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return;
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Tutorial metadata could not be loaded"));
      };
      const cleanup = () => {
        media.removeEventListener("loadedmetadata", onLoaded);
        media.removeEventListener("error", onError);
      };
      media.addEventListener("loadedmetadata", onLoaded);
      media.addEventListener("error", onError);
      media.load();
    });
  });
  const duration = await video.evaluate(
    (element) => (element as HTMLVideoElement).duration,
  );
  expect(duration).toBeGreaterThan(64.9);
  expect(duration).toBeLessThan(65.1);
});

test("赤3・黄2・白1・水2を作り、履歴・保存・再読込・おえかき選択まで使える", async ({
  page,
}) => {
  await addUnits(page, "red", 3);
  await addUnits(page, "yellow", 2);
  await addUnits(page, "white", 1);
  await addUnits(page, "water", 2);

  await expect(page.getByTestId("recipe-red")).toHaveText("3");
  await expect(page.getByTestId("recipe-yellow")).toHaveText("2");
  await expect(page.getByTestId("recipe-white")).toHaveText("1");
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  await page.getByTestId("undo").click();
  await expect(page.getByTestId("recipe-water")).toHaveText("1");
  await expect(page.getByTestId("redo")).toBeEnabled();

  await page.getByTestId("redo").click();
  await expect(page.getByTestId("recipe-water")).toHaveText("2");

  await page
    .getByRole("button", { name: "くわしい数値を見る" })
    .click();
  await expect(page.getByLabel("詳しい色情報")).toBeVisible();
  await expect(page.getByTestId("recipe-hex")).toHaveText(
    /^#[0-9A-F]{6}$/,
  );

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await expect(saveDialog).toBeVisible();
  await saveDialog.getByLabel("色の名前").fill(TEST_COLOR_NAME);
  await saveDialog.getByLabel(/ひとことメモ/).fill(TEST_COLOR_NOTE);
  await saveDialog.getByTestId("confirm-save-color").click();

  await expect(
    page.getByRole("status").filter({
      hasText: `「${TEST_COLOR_NAME}」を保存パレットに登録しました`,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("palette-toggle")).toHaveAttribute(
    "aria-label",
    "保存パレットへ移動。1色",
  );

  const savedColor = page.getByTestId("saved-color-0");
  await expect(savedColor).toBeVisible();
  await expect(savedColor).toHaveAccessibleName(
    `1番 ${TEST_COLOR_NAME}。選択中。この色を選び直す`,
  );
  await savedColor.click();
  await expect(savedColor).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);
  await expect(savedColor).toHaveAccessibleName(
    `1番 ${TEST_COLOR_NAME}。選択中。もう一度押すとレシピを見る`,
  );
  await savedColor.click();

  const recipeDialog = page.getByTestId("recipe-dialog");
  await expect(recipeDialog).toHaveRole("dialog");
  await expect(
    recipeDialog.getByRole("heading", { name: TEST_COLOR_NAME }),
  ).toBeVisible();
  const savedRecipe = recipeDialog
    .getByRole("heading", { name: "配合" })
    .locator("..");
  await expect(savedRecipe).toContainText("赤");
  await expect(savedRecipe).toContainText("黄");
  await expect(savedRecipe).toContainText("白");
  await expect(savedRecipe).toContainText("水");
  await expect(savedRecipe.getByText("3単位", { exact: true })).toHaveCount(1);
  await expect(savedRecipe.getByText("2単位", { exact: true })).toHaveCount(2);
  await expect(savedRecipe.getByText("1単位", { exact: true })).toHaveCount(1);
  await expect(recipeDialog.getByText(TEST_COLOR_NOTE)).toBeVisible();
  await recipeDialog.getByRole("button", { name: "閉じる" }).click();

  await page.reload();
  await expect(page.getByTestId("saved-color-0")).toHaveAccessibleName(
    `1番 ${TEST_COLOR_NAME}。選択中。この色を選び直す`,
  );

  await page.getByTestId("saved-color-0").click();
  await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);
  await page.getByTestId("saved-color-0").click();
  const restoredRecipeDialog = page.getByTestId("recipe-dialog");
  await restoredRecipeDialog
    .getByRole("button", { name: "おえかきで使う" })
    .click();

  await expect(page.getByTestId("mode-draw")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("drawing-studio")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `現在の色は${TEST_COLOR_NAME}。保存パレットから変更`,
    }),
  ).toBeVisible();
});

test.describe("スマホ表示", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("390x844で保存パレットのドロワーを開閉できる", async ({ page }) => {
    await expect
      .poll(() =>
        page.evaluate(() => ({
          width: window.innerWidth,
          height: window.innerHeight,
        })),
      )
      .toEqual({ width: 390, height: 844 });

    const toggle = page.getByTestId("palette-toggle");
    const palette = page.getByTestId("saved-palette");

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(palette).not.toHaveClass(/\bis-open\b/);
    await expect(palette).not.toBeInViewport();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(palette).toHaveClass(/\bis-open\b/);
    await expect(palette).toBeInViewport();

    await palette
      .getByRole("button", { name: "保存パレットを閉じる" })
      .click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(palette).not.toHaveClass(/\bis-open\b/);
    await expect(palette).not.toBeInViewport();
  });

  test("保存色は1回目で選択し、同じ色の2回目で詳細を開く", async ({
    page,
  }) => {
    await page.getByTestId("material-red").click();
    await page.getByTestId("mix-canvas").press("Enter");
    await page.getByTestId("open-save-color").click();
    const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
    await saveDialog.getByLabel("色の名前").fill("スマホの赤");
    await saveDialog.getByTestId("confirm-save-color").click();

    const toggle = page.getByTestId("palette-toggle");
    const palette = page.getByTestId("saved-palette");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const saved = page.getByTestId("saved-color-0");

    await saved.click();
    await expect(saved).toHaveAttribute("aria-pressed", "true");
    await expect(palette).toHaveClass(/\bis-open\b/);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("recipe-dialog")).toHaveCount(0);

    await saved.click();
    const detail = page.getByTestId("recipe-dialog");
    await expect(detail).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await detail.getByRole("button", { name: "閉じる" }).click();
    await expect(toggle).toBeFocused();
  });
});

test("ぬりえの閉じた領域を塗り、PNGとしてダウンロードできる", async ({
  page,
}) => {
  await page.getByTestId("mode-color").click();
  await expect(page.getByTestId("coloring-studio")).toBeVisible();

  const coloringCanvas = page.getByTestId("coloring-canvas");
  const fillCanvas = coloringCanvas.locator(
    "canvas.coloring-layer--fill",
  );

  await expect
    .poll(() => pixelAt(fillCanvas, 0, 0))
    .toEqual([255, 253, 248, 255]);

  const centerBefore = await pixelAt(fillCanvas, 440, 130);
  const outsideBefore = await pixelAt(fillCanvas, 0, 0);
  expect(centerBefore).toEqual([255, 253, 248, 255]);

  const box = await coloringCanvas.boundingBox();
  expect(box).not.toBeNull();
  await coloringCanvas.click({
    position: {
      x: (box!.width * 440) / 920,
      y: (box!.height * 130) / 720,
    },
  });

  await expect
    .poll(() => pixelAt(fillCanvas, 440, 130))
    .not.toEqual(centerBefore);
  await expect
    .poll(() => pixelAt(fillCanvas, 0, 0))
    .toEqual(outsideBefore);
  await expect(
    page.getByRole("button", { name: "戻す", exact: true }),
  ).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "PNG保存", exact: true })
    .click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(
    "カラーレシピぬりえ-flower.png",
  );
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  if (!stream) throw new Error("Downloaded PNG could not be read");

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const png = Buffer.concat(chunks);
  expect(png.length).toBeGreaterThan(8);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
});

test("大きすぎる画像と偽装画像を線画として保存しない", async ({ page }) => {
  await page.getByTestId("mode-color").click();
  const upload = page.getByTestId("coloring-upload");

  await upload.setInputFiles({
    name: "oversized.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });
  await expect(
    page.getByText("画像は8MB以下のファイルを選んでください"),
  ).toBeVisible();

  await upload.setInputFiles({
    name: "spoofed.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(
    page.getByText("画像を読み込めませんでした。別の画像を選んでください"),
  ).toBeVisible();
  await expect(page.getByText("読み込んだ線画を選択中")).toHaveCount(0);
});

test("透明背景の線画でも、余白を線にせず枠内だけを一括で塗る", async ({
  page,
}) => {
  const transparentLineArt = await createTransparentLineArtPng(page);
  await page.getByTestId("mode-color").click();
  await page
    .getByTestId("coloring-upload")
    .setInputFiles({
      name: "transparent-frame.png",
      mimeType: "image/png",
      buffer: transparentLineArt,
    });

  const coloringCanvas = page.getByTestId("coloring-canvas");
  const fillCanvas = coloringCanvas.locator("canvas.coloring-layer--fill");
  const lineCanvas = coloringCanvas.locator("canvas.coloring-layer--line");
  await expect
    .poll(async () => (await pixelAt(lineCanvas, 0, 0))[3])
    .toBe(0);
  await expect
    .poll(async () => (await pixelAt(lineCanvas, 184, 360))[3])
    .toBeGreaterThan(0);

  const outsideBefore = await pixelAt(fillCanvas, 20, 20);
  await clickCanvasPoint(coloringCanvas, 20, 20);
  await expect(page.getByText(/線のすき間が大きいため塗れません/)).toBeVisible();
  await expect
    .poll(() => pixelAt(fillCanvas, 20, 20))
    .toEqual(outsideBefore);

  const insideBefore = await pixelAt(fillCanvas, 460, 360);
  await clickCanvasPoint(coloringCanvas, 460, 360);
  await expect
    .poll(() => pixelAt(fillCanvas, 460, 360))
    .not.toEqual(insideBefore);
  await expect
    .poll(() => pixelAt(fillCanvas, 20, 20))
    .toEqual(outsideBefore);
});

test("読み込んだ線画ごとに進捗を分け、ブラシ設定とUndo・Redo結果を再読込できる", async ({
  page,
}) => {
  const squareLineArt = await createLineArtPng(page, "square");
  const circleLineArt = await createLineArtPng(page, "circle");

  await page.getByTestId("mode-color").click();
  await page
    .getByTestId("coloring-upload")
    .setInputFiles({
      name: "square.png",
      mimeType: "image/png",
      buffer: squareLineArt,
    });
  await expect(page.getByText("読み込んだ線画を選択中")).toBeVisible();

  const fillControls = page.locator(
    '#coloring-inspector input[type="range"]',
  );
  await expect(fillControls).toHaveCount(2);
  await fillControls.nth(0).fill("41");
  await fillControls.nth(1).fill("4");
  await page
    .getByRole("button", { name: "ブラシで塗る", exact: true })
    .click();
  const brushSize = page.locator(
    '#coloring-inspector input[type="range"]',
  );
  await brushSize.fill("62");

  const coloringCanvas = page.getByTestId("coloring-canvas");
  const fillCanvas = coloringCanvas.locator(
    "canvas.coloring-layer--fill",
  );
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual([255, 253, 248, 255]);

  const squareBefore = await pixelAt(fillCanvas, 100, 100);
  await clickCanvasPoint(coloringCanvas, 100, 100);
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .not.toEqual(squareBefore);
  const squarePainted = await pixelAt(fillCanvas, 100, 100);

  await page.getByRole("button", { name: "戻す", exact: true }).click();
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual(squareBefore);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual(squarePainted);
  await expect(page.getByText("進み具合を保存しました")).toBeVisible();

  await page
    .getByTestId("coloring-upload")
    .setInputFiles({
      name: "circle.png",
      mimeType: "image/png",
      buffer: circleLineArt,
    });
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual(squareBefore);

  await clickCanvasPoint(coloringCanvas, 180, 100);
  const circlePainted = await pixelAt(fillCanvas, 180, 100);
  expect(circlePainted).not.toEqual(squareBefore);
  await expect(page.getByText("進み具合を保存しました")).toBeVisible();
  await page.waitForTimeout(300);

  await page.reload();
  await page.getByTestId("mode-color").click();
  await expect(
    page.getByRole("button", { name: "ブラシで塗る", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('#coloring-inspector input[type="range"]'),
  ).toHaveValue("62");
  await expect
    .poll(() => pixelAt(fillCanvas, 180, 100))
    .toEqual(circlePainted);
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual(squareBefore);

  await page
    .getByRole("button", { name: "タップで枠内を塗る", exact: true })
    .click();
  const restoredFillControls = page.locator(
    '#coloring-inspector input[type="range"]',
  );
  await expect(restoredFillControls.nth(0)).toHaveValue("41");
  await expect(restoredFillControls.nth(1)).toHaveValue("4");

  await page
    .getByTestId("coloring-upload")
    .setInputFiles({
      name: "square-again.png",
      mimeType: "image/png",
      buffer: squareLineArt,
    });
  await expect
    .poll(() => pixelAt(fillCanvas, 100, 100))
    .toEqual(squarePainted);
});
