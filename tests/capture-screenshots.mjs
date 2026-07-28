import { chromium } from "playwright";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3002";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "ja-JP",
  timezoneId: "Asia/Tokyo",
});
const page = await context.newPage();

async function addUnits(material, units) {
  await page.getByTestId(`material-${material}`).click();
  const canvas = page.getByTestId("mix-canvas");
  for (let index = 0; index < units; index += 1) {
    await canvas.press("Enter");
  }
}

try {
  await page.goto(baseUrl);
  await page.waitForLoadState("networkidle");

  const mixCanvas = page.getByTestId("mix-canvas");
  await page.getByTestId("material-red").click();
  await mixCanvas.click({ position: { x: 360, y: 300 } });
  await page.getByTestId("material-yellow").click();
  await mixCanvas.click({ position: { x: 440, y: 300 } });
  await page.getByTestId("material-picker").click();
  await mixCanvas.click({ position: { x: 400, y: 300 } });
  await page.waitForFunction(() => {
    const ratio = document.querySelector(".pigment-ratio strong")?.textContent;
    return ratio?.includes("赤 50.0%") && ratio.includes("黄 50.0%");
  });
  await page.getByRole("button", { name: "くわしい数値を見る" }).click();
  await page.waitForTimeout(320);
  await page.screenshot({
    path: "screenshots/desktop-spatial-picker.png",
    type: "png",
  });
  await page
    .getByRole("button", { name: "スポイト結果を閉じて全体レシピへ戻る" })
    .click();
  await page.getByRole("button", { name: "かんたん表示" }).click();
  await page.getByRole("button", { name: "まっさらに" }).click();

  await addUnits("red", 3);
  await addUnits("yellow", 2);
  await addUnits("white", 1);
  await addUnits("water", 2);
  await page.getByTestId("mix-all").click();
  await page.waitForTimeout(350);

  await page.getByTestId("open-save-color").click();
  const saveDialog = page.getByRole("dialog", { name: "この色を登録" });
  await saveDialog.getByLabel("色の名前").fill("夕焼けオレンジ");
  await saveDialog
    .getByLabel(/ひとことメモ/)
    .fill("夕方の光と花びらに使う、やわらかな橙");
  await saveDialog.getByTestId("confirm-save-color").click();
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: "screenshots/desktop-mix.png",
    type: "png",
  });

  await page.getByTestId("mode-draw").click();
  await page.getByTestId("drawing-studio").waitFor({ state: "visible" });
  const drawingCanvas = page.getByTestId("drawing-canvas");
  const drawingBox = await drawingCanvas.boundingBox();
  if (drawingBox) {
    await page.mouse.move(
      drawingBox.x + drawingBox.width * 0.25,
      drawingBox.y + drawingBox.height * 0.62,
    );
    await page.mouse.down();
    await page.mouse.move(
      drawingBox.x + drawingBox.width * 0.72,
      drawingBox.y + drawingBox.height * 0.35,
      { steps: 32 },
    );
    await page.mouse.up();
  }
  await page.screenshot({
    path: "screenshots/desktop-drawing.png",
    type: "png",
  });

  await page.getByTestId("mode-color").click();
  await page.getByTestId("coloring-studio").waitFor({ state: "visible" });
  const coloringCanvas = page.getByTestId("coloring-canvas");
  const coloringBox = await coloringCanvas.boundingBox();
  if (coloringBox) {
    await coloringCanvas.click({
      position: {
        x: (coloringBox.width * 460) / 920,
        y: (coloringBox.height * 210) / 720,
      },
    });
  }
  await page.screenshot({
    path: "screenshots/desktop-coloring.png",
    type: "png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("mode-mix").click();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "screenshots/mobile-mix.png",
    type: "png",
  });

  await page.getByRole("button", { name: "まっさらに" }).click();
  const mobileMixCanvas = page.getByTestId("mix-canvas");
  await page.getByTestId("material-red").click();
  await mobileMixCanvas.press("Enter");
  await page.getByTestId("material-yellow").click();
  await mobileMixCanvas.press("Enter");
  await page.getByTestId("material-picker").click();
  await mobileMixCanvas.press("Enter");
  await page.waitForFunction(() => {
    const ratio = document.querySelector(".pigment-ratio strong")?.textContent;
    return ratio?.includes("赤 50.0%") && ratio.includes("黄 50.0%");
  });
  await page.screenshot({
    path: "screenshots/mobile-spatial-picker.png",
    type: "png",
  });

  await page.getByTestId("palette-toggle").click();
  await page.getByTestId("saved-palette").waitFor({ state: "visible" });
  await page.waitForTimeout(320);
  await page.screenshot({
    path: "screenshots/mobile-palette.png",
    type: "png",
  });
  await page
    .getByTestId("saved-palette")
    .getByRole("button", { name: "保存パレットを閉じる" })
    .click();

  await page.getByTestId("mode-draw").click();
  await page.getByTestId("drawing-studio").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "調整", exact: true }).click();
  await page
    .getByRole("dialog", { name: "筆とレイヤーの調整" })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(320);
  await page.screenshot({
    path: "screenshots/mobile-drawing-adjustments.png",
    type: "png",
  });
} finally {
  await context.close();
  await browser.close();
}
