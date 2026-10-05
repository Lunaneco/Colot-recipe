import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route(/\/lib\/[^/]+$/, async route => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (!/^[a-zA-Z][a-zA-Z0-9]*(?:\.ts)?$/.test(name)) return route.abort();
    const source = await readFile(resolve("lib", name.endsWith(".ts") ? name : `${name}.ts`), "utf8");
    const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
    await route.fulfill({ contentType: "text/javascript", body: compiled.code });
  });
});

async function selectRedPaint(page: Page) {
  await page.getByTestId("material-red").click();
  await page.getByTestId("mix-canvas").press("Enter");
  await expect(page.getByTestId("recipe-red")).toHaveText("1");
}

async function stampAndInterrupt(
  page: Page,
  mode: "drawing" | "coloring",
  interruption: "pagehide" | "mode-switch" | "none" = "pagehide",
) {
  return page.evaluate(({ mode, interruption }) => {
    const host = document.querySelector<HTMLDivElement>(
      `[data-testid="${mode === "drawing" ? "drawing" : "coloring"}-canvas"]`,
    )!;
    const canvas = host.querySelector("canvas")!;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const x = 100, y = 100;
    const before = [...context.getImageData(x, y, 1, 1).data];
    const rect = host.getBoundingClientRect();
    // Hold the asynchronous backend indefinitely. Reload must recover the
    // snapshot journal even though the normal save promise never settles.
    if (interruption !== "none") Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: () => ({}),
    });
    const point = {
      pointerId: 77, pointerType: "mouse", isPrimary: true, pressure: .5,
      button: 0, bubbles: true,
      clientX: rect.x + rect.width * x / canvas.width,
      clientY: rect.y + rect.height * y / canvas.height,
    };
    host.dispatchEvent(new PointerEvent("pointerdown", { ...point, buttons: 1 }));
    host.dispatchEvent(new PointerEvent("pointerup", { ...point, buttons: 0 }));
    const after = [...context.getImageData(x, y, 1, 1).data];
    if (interruption === "pagehide") window.dispatchEvent(new PageTransitionEvent("pagehide"));
    else if (interruption === "mode-switch") document.querySelector<HTMLButtonElement>('[data-testid="mode-mix"]')!.click();
    const key = mode === "drawing"
      ? "color-recipe:pending:artworks:main"
      : "color-recipe:pending:coloring:progress-v2-flower";
    return { before, after, key, journal: localStorage.getItem(key) };
  }, { mode, interruption });
}

async function pixelAt(page: Page, mode: "drawing" | "coloring", x = 100, y = 100) {
  return page.getByTestId(`${mode === "drawing" ? "drawing" : "coloring"}-canvas`)
    .locator("canvas").first()
    .evaluate((canvas, point) => [...(canvas as HTMLCanvasElement)
      .getContext("2d", { willReadFrequently: true })!
      .getImageData(point.x, point.y, 1, 1).data], { x, y });
}

test("おえかきのpagehideは未完了IDBでも直前の顔料を即復旧する", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await selectRedPaint(page);
  await page.getByTestId("mode-draw").click();
  await expect(page.getByTestId("drawing-studio")).toBeVisible();
  await page.waitForTimeout(350);
  const stamped = await stampAndInterrupt(page, "drawing");
  expect(stamped.after).not.toEqual(stamped.before);
  expect(stamped.journal).not.toBeNull();
  await page.reload();
  await page.getByTestId("mode-draw").click();
  await expect.poll(() => pixelAt(page, "drawing")).not.toEqual(stamped.before);
  const restored = await pixelAt(page, "drawing");
  expect(Math.max(...restored.map((value, i) => Math.abs(value - stamped.after[i])))).toBeLessThanOrEqual(2);
});

test("モード切替のunmountは描画debounceより先に顔料を保存する", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await selectRedPaint(page);
  await page.getByTestId("mode-draw").click();
  await page.waitForTimeout(350);
  const stamped = await stampAndInterrupt(page, "drawing", "mode-switch");
  expect(stamped.after).not.toEqual(stamped.before);
  await expect(page.getByTestId("mode-mix")).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate((key) => localStorage.getItem(key), stamped.key)).not.toBeNull();
  await page.reload();
  await page.getByTestId("mode-draw").click();
  await expect.poll(() => pixelAt(page, "drawing")).not.toEqual(stamped.before);
});

test("ぬりえのpagehideは未完了IDBでもブラシの顔料を即復旧する", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await selectRedPaint(page);
  await page.getByTestId("mode-color").click();
  await page.getByRole("button", { name: /おはな/ }).click();
  await page.getByRole("button", { name: "ブラシで塗る", exact: true }).click();
  await page.waitForTimeout(350);
  const stamped = await stampAndInterrupt(page, "coloring");
  expect(stamped.after).not.toEqual(stamped.before);
  expect(stamped.journal).not.toBeNull();
  await page.reload();
  await page.getByTestId("mode-color").click();
  await expect.poll(() => pixelAt(page, "coloring")).not.toEqual(stamped.before);
  const restored = await pixelAt(page, "coloring");
  expect(Math.max(...restored.map((value, i) => Math.abs(value - stamped.after[i])))).toBeLessThanOrEqual(2);
});

test("保存PNGは乾層のbodyを保ち、経過時間後の復元を乾いた見た目にする", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  const reference = await page.evaluate(async () => {
    const fieldPath = "/lib/pigmentField.ts";
    const layerPath = "/lib/pigmentLayer.ts";
    const storagePath = "/lib/storage.ts";
    const p = await import(fieldPath);
    const layers = await import(layerPath);
    const storage = await import(storagePath);
    const field = p.createPigmentField(1000, 700);
    p.depositStamp(field, 100, 100, 20, {
      pigment: p.pigmentVectorFromRatio({ blue: 1 }), mass: 2, wetness: 0,
      body: 1, hardness: 1,
    });
    p.depositStamp(field, 100, 100, 20, {
      pigment: p.pigmentVectorFromRatio({ yellow: 1 }), mass: .1, wetness: .8,
      body: .12, hardness: 1,
    });
    const snapshot = layers.snapshotPigmentLayer(field);
    const saved = { ...snapshot, pigmentSavedAt: Date.now() - 60000 };
    const restored = await layers.decodeStoredPigmentField(saved, 1000, 700);
    const index = 100 * field.width + 100;
    const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    p.compositePigmentLayers({ r: 255, g: 253, b: 248 },
      [{ kind: "paint", field: restored }], image, { x: 100, y: 100, width: 1, height: 1 });
    await storage.saveArtwork("main", {
      layers: [{ id: "dry-audit", name: "乾燥監査", visible: true, opacity: 100, ...saved }],
      width: 1000, height: 700, background: "#fffdf8", activeLayerId: "dry-audit",
    });
    return {
      beforeBody: p.totalBodyMassAt(field, index), afterBody: p.totalBodyMassAt(restored, index),
      beforeMass: p.totalPaintMassAt(field, index), afterMass: p.totalPaintMassAt(restored, index),
      wetness: restored.wetness[index], planes: snapshot.pigmentDataUrls.length,
      pixel: [...image.data],
    };
  });
  expect(reference.planes).toBe(5);
  expect(reference.beforeBody).toBeCloseTo(2.012, 6);
  expect(reference.afterBody).toBeCloseTo(reference.beforeBody, 6);
  expect(reference.afterMass).toBeCloseTo(reference.beforeMass, 6);
  expect(reference.wetness).toBe(0);
  await page.getByTestId("mode-draw").click();
  await expect.poll(() => pixelAt(page, "drawing")).toEqual(reference.pixel);
  await page.reload();
  await page.getByTestId("mode-draw").click();
  await expect.poll(() => pixelAt(page, "drawing")).toEqual(reference.pixel);
});

test("乾燥後のUndoとRedoは復元した湿った顔料の乾燥を再開する", async ({ page }) => {
  await page.goto("./");
  await page.waitForLoadState("networkidle");
  await selectRedPaint(page);
  const dryPixel = await page.evaluate(async () => {
    const fieldPath = "/lib/pigmentField.ts", layerPath = "/lib/pigmentLayer.ts", storagePath = "/lib/storage.ts";
    const p = await import(fieldPath), layers = await import(layerPath), storage = await import(storagePath);
    const field = p.createPigmentField(1000, 700);
    p.depositStamp(field, 100, 100, 25, {
      pigment: p.pigmentVectorFromRatio({ blue: 1 }), mass: 2, wetness: .8,
      body: 1, hardness: 1,
    });
    const snapshot = layers.snapshotPigmentLayer(field);
    await storage.saveArtwork("main", {
      layers: [{ id: "undo-drying", name: "Undo乾燥監査", visible: true, opacity: 100, ...snapshot }],
      width: 1000, height: 700, background: "#fffdf8", activeLayerId: "undo-drying",
    });
    p.dryPigmentField(field, 1);
    const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    p.compositePigmentLayers({ r: 255, g: 253, b: 248 }, [{ kind: "paint", field }], image,
      { x: 100, y: 100, width: 1, height: 1 });
    return [...image.data];
  });
  await page.clock.install({ time: new Date() });
  await page.getByTestId("mode-draw").click();
  await expect.poll(() => pixelAt(page, "drawing")).not.toEqual([255, 253, 248, 255]);
  await stampAndInterrupt(page, "drawing", "none");
  await page.clock.runFor(25000);
  const paintedDry = await pixelAt(page, "drawing");
  await page.getByRole("button", { name: "戻す", exact: true }).click();
  const restoredWet = await pixelAt(page, "drawing");
  expect(restoredWet).not.toEqual(dryPixel);
  await page.clock.runFor(25000);
  expect(await pixelAt(page, "drawing")).toEqual(dryPixel);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  expect(await pixelAt(page, "drawing")).not.toEqual(paintedDry);
  await page.clock.runFor(25000);
  expect(await pixelAt(page, "drawing")).toEqual(paintedDry);
});
