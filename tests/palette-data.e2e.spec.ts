import { expect, test, type Download } from "@playwright/test";

async function readDownload(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Downloaded JSON could not be read");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test("保存パレットをUndo・Redoでき、版付きレシピJSONを安全に往復できる", async ({
  page,
}) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  const red = page.getByTestId("material-red");
  await red.click();
  await expect(red).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("mix-canvas").press("Enter");
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
  await page.getByTestId("open-save-color").click();

  const dialog = page.getByRole("dialog", { name: "この色を登録" });
  await dialog.getByLabel("色の名前").fill("履歴テストの赤");
  await dialog.getByTestId("confirm-save-color").click();
  await expect(page.getByTestId("saved-color-0")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "レシピ保存" }).click();
  const recipeDownload = await downloadPromise;
  const recipeJson = await readDownload(recipeDownload);
  const exported = JSON.parse(recipeJson.toString("utf8")) as {
    version: number;
    colors: unknown[];
  };
  expect(exported.version).toBe(3);
  expect(exported.colors).toHaveLength(1);

  await page.getByTestId("palette-undo").click();
  await expect(page.getByTestId("saved-color-0")).toHaveCount(0);
  await page.getByTestId("palette-redo").click();
  await expect(page.getByTestId("saved-color-0")).toBeVisible();
  await page.getByTestId("palette-undo").click();
  await expect(page.getByTestId("saved-color-0")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("color-recipe:colors:all");
        return raw ? (JSON.parse(raw) as unknown[]).length : -1;
      }),
    )
    .toBe(0);
  await page.reload();
  await expect(page.locator(".color-recipe-app")).toHaveAttribute(
    "data-app-ready",
    "true",
  );
  await expect(page.getByTestId("saved-color-0")).toHaveCount(0);

  const recipeInput = page.getByLabel("カラーレシピJSONを読み込む");
  await recipeInput.setInputFiles({
    name: "recipe.json",
    mimeType: "application/json",
    buffer: recipeJson,
  });
  await expect(page.getByTestId("saved-color-0")).toHaveAccessibleName(
    /履歴テストの赤/,
  );

  // Importing the same file again must create a fresh ID rather than leaving
  // two records with a colliding key.
  await recipeInput.setInputFiles({
    name: "recipe.json",
    mimeType: "application/json",
    buffer: recipeJson,
  });
  await expect(page.locator("[data-testid^='saved-color-']")).toHaveCount(2);

  const backupPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "全データ保存" }).click();
  const backupJson = JSON.parse(
    (await readDownload(await backupPromise)).toString("utf8"),
  ) as {
    kind: string;
    version: number;
    stores: { colors: unknown[]; settings: unknown[] };
  };
  expect(backupJson.kind).toBe("color-recipe-app-backup");
  expect(backupJson.version).toBe(2);
  expect(backupJson.stores.colors).toHaveLength(2);
  expect(backupJson.stores.settings.length).toBeGreaterThan(0);
});
