import assert from "node:assert/strict";
import { access, readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const distUrl = new URL("../dist/", import.meta.url);

test("GitHub Pages用の静的index.htmlを生成する", async () => {
  const html = await readFile(new URL("index.html", distUrl), "utf8");

  assert.match(html, /<html[^>]+lang="ja"/i);
  assert.match(html, /<title>カラーレシピ｜絵の具を混ぜて、描いて、彩る<\/title>/);
  assert.match(html, /http-equiv="Content-Security-Policy"/i);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /https:\/\/lunaneco\.github\.io\/Colot-recipe\/og\.png/);
  assert.match(html, /\/Colot-recipe\/assets\/[^"]+\.js/);
  assert.match(html, /\/Colot-recipe\/assets\/[^"]+\.css/);
  assert.match(html, /\/Colot-recipe\/favicon\.svg/);
  assert.doesNotMatch(html, /localhost|attacker\.example|NEXT_PUBLIC/i);
});

test("静的配信物にアプリ素材とチュートリアルを含める", async () => {
  const requiredFiles = [
    "favicon.svg",
    "og.png",
    ".nojekyll",
    "tutorial/color-recipe-tutorial.mp4",
    "tutorial/color-recipe-tutorial-poster.webp",
    "tutorial/color-recipe-tutorial.ja.vtt",
  ];

  await Promise.all(
    requiredFiles.map((path) => access(new URL(path, distUrl))),
  );

  const video = await stat(
    new URL("tutorial/color-recipe-tutorial.mp4", distUrl),
  );
  assert.ok(video.size > 20 * 1024 * 1024, "tutorial video is unexpectedly small");

  const assets = await readdir(new URL("assets/", distUrl));
  assert.ok(assets.some((file) => file.startsWith("DrawingStudio-") && file.endsWith(".js")));
  assert.ok(assets.some((file) => file.startsWith("ColoringStudio-") && file.endsWith(".js")));
  assert.ok(assets.some((file) => file.startsWith("three.module-") && file.endsWith(".js")));

  await assert.rejects(access(new URL("server/index.js", distUrl)));
});
