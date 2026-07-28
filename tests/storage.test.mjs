import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_BACKUP_KIND,
  APP_BACKUP_VERSION,
  AppBackupError,
  StorageWriteError,
  exportAppBackup,
  importAppBackup,
  loadColors,
  loadSetting,
  parseAppBackupJson,
  saveColors,
  saveSetting,
} from "../lib/storage.ts";
import { parseSavedColorsJson } from "../lib/savedColorSchema.ts";

const NOW = "2026-07-28T03:04:05.000Z";

class MemoryLocalStorage {
  #values = new Map();
  failWrites = false;

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.get(String(key)) ?? null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error("LocalStorage quota exceeded");
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    if (this.failWrites) throw new Error("LocalStorage is blocked");
    this.#values.delete(String(key));
  }

  clear() {
    this.#values.clear();
  }
}

const asyncRequest = (result, error) => {
  const request = {
    result,
    error: error ?? null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
  queueMicrotask(() => {
    if (error) request.onerror?.({ target: request });
    else request.onsuccess?.({ target: request });
  });
  return request;
};

const emptyIndexedDb = () => ({
  open() {
    const database = {
      objectStoreNames: { contains: () => true },
      close() {},
      transaction() {
        return {
          error: null,
          oncomplete: null,
          onabort: null,
          onerror: null,
          objectStore() {
            return {
              get: () => asyncRequest(undefined),
              getAll: () => asyncRequest([]),
              openCursor: () => asyncRequest(null),
            };
          },
        };
      },
    };
    return asyncRequest(database);
  },
});

const failingIndexedDb = () => ({
  open() {
    return asyncRequest(undefined, new Error("IndexedDB blocked"));
  },
});

const makeColor = (id = "orange", name = "夕焼け") =>
  parseSavedColorsJson(
    [
      {
        id,
        name,
        recipe: { red: 3, yellow: 2, white: 1, water: 2 },
      },
    ],
    { now: NOW },
  ).colors[0];

const pngHeaderDataUrl = (width, height) => {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(header, 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
};

const validArtwork = {
  layers: [
    {
      id: "layer-1",
      name: "レイヤー 1",
      visible: true,
      opacity: 100,
    },
  ],
  width: 1000,
  height: 700,
  background: "#fffdf8",
  activeLayerId: "layer-1",
};

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalIndexedDb = Object.getOwnPropertyDescriptor(
  globalThis,
  "indexedDB",
);

const installGlobals = (localStorage, indexedDB) => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: indexedDB,
  });
};

const restoreGlobals = () => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete globalThis.localStorage;
  }
  if (originalIndexedDb) {
    Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  } else {
    delete globalThis.indexedDB;
  }
};

test("保存層のIDB空読み・フォールバック・失敗通知", async (t) => {
  await t.test("IDBが空ならLocalStorageの保存色と設定を読む", async () => {
    const storage = new MemoryLocalStorage();
    const color = makeColor();
    storage.setItem("color-recipe:colors:all", JSON.stringify([color]));
    storage.setItem(
      "color-recipe:settings:last-mode",
      JSON.stringify("draw"),
    );
    installGlobals(storage, emptyIndexedDb());

    const colors = await loadColors();
    assert.equal(colors.length, 1);
    assert.equal(colors[0].id, "orange");
    assert.equal(colors[0].mixed.hex, "#D9824A");
    assert.equal(await loadSetting("last-mode"), "draw");
  });

  await t.test("IDB失敗時もLocalStorageが成功すれば保存できる", async () => {
    const storage = new MemoryLocalStorage();
    installGlobals(storage, failingIndexedDb());
    await saveColors([makeColor()]);
    await saveSetting("last-mode", "color");

    assert.ok(storage.getItem("color-recipe:colors:all"));
    assert.equal(
      JSON.parse(storage.getItem("color-recipe:settings:last-mode")),
      "color",
    );
  });

  await t.test("両方の保存先が失敗した場合だけ明示的にrejectする", async () => {
    const storage = new MemoryLocalStorage();
    storage.failWrites = true;
    installGlobals(storage, failingIndexedDb());

    await assert.rejects(saveColors([makeColor()]), StorageWriteError);
    await assert.rejects(
      saveSetting("last-mode", "mix"),
      StorageWriteError,
    );
  });

  restoreGlobals();
});

test("全4ストアの版付きバックアップを検証・復元できる", async (t) => {
  const storage = new MemoryLocalStorage();
  const color = makeColor();
  storage.setItem("color-recipe:colors:all", JSON.stringify([color]));
  storage.setItem("color-recipe:settings:last-mode", JSON.stringify("draw"));
  storage.setItem(
    "color-recipe:artworks:main",
    JSON.stringify(validArtwork),
  );
  storage.setItem(
    "color-recipe:coloring:progress-template-1",
    JSON.stringify({
      dataUrl: pngHeaderDataUrl(920, 720),
      sourceId: "flower",
      updatedAt: NOW,
    }),
  );
  installGlobals(storage, emptyIndexedDb());

  await t.test("空のIDBよりLocalStorageミラーを優先して全ストアを列挙する", async () => {
    const backup = await exportAppBackup();

    assert.equal(backup.kind, APP_BACKUP_KIND);
    assert.equal(backup.version, APP_BACKUP_VERSION);
    assert.equal(backup.stores.colors.length, 1);
    assert.deepEqual(
      backup.stores.settings.map((entry) => entry.key),
      ["last-mode"],
    );
    assert.deepEqual(
      backup.stores.artworks.map((entry) => entry.key),
      ["main"],
    );
    assert.deepEqual(
      backup.stores.coloring.map((entry) => entry.key),
      ["progress-template-1"],
    );
  });

  await t.test("未知の版と危険なオブジェクトキーを復元前に拒否する", () => {
    const base = {
      kind: APP_BACKUP_KIND,
      version: APP_BACKUP_VERSION,
      exportedAt: NOW,
      stores: {
        colors: [],
        settings: [],
        artworks: [],
        coloring: [],
      },
    };
    assert.throws(
      () => parseAppBackupJson({ ...base, version: 99 }),
      AppBackupError,
    );
    assert.throws(
      () =>
        parseAppBackupJson({
          ...base,
          stores: {
            ...base.stores,
            settings: [
              {
                key: "coloring-tools",
                value: {
                  template: "upload",
                  uploadedImage: "https://tracker.example/pixel.png",
                },
              },
            ],
          },
        }),
      AppBackupError,
    );
    assert.throws(
      () =>
        parseAppBackupJson({
          ...base,
          stores: {
            ...base.stores,
            coloring: [
              {
                key: "progress-malicious",
                value: {
                  dataUrl: pngHeaderDataUrl(9000, 1),
                  sourceId: "flower",
                  updatedAt: NOW,
                },
              },
            ],
          },
        }),
      AppBackupError,
    );
    assert.throws(
      () =>
        parseAppBackupJson(
          JSON.stringify({
            ...base,
            stores: {
              ...base.stores,
              settings: [
                {
                  key: "unsafe",
                  value: JSON.parse('{"__proto__":{"polluted":true}}'),
                },
              ],
            },
          }),
        ),
      AppBackupError,
    );
  });

  await t.test("replace復元で4ストアのミラーを入れ替える", async () => {
    installGlobals(storage, failingIndexedDb());
    const replacement = {
      kind: APP_BACKUP_KIND,
      version: APP_BACKUP_VERSION,
      exportedAt: NOW,
      stores: {
        colors: [makeColor("blue", "雨夜")],
        settings: [{ key: "last-mode", value: "color" }],
        artworks: [{ key: "main", value: validArtwork }],
        coloring: [
          {
            key: "progress-new",
            value: {
              dataUrl: pngHeaderDataUrl(920, 720),
              sourceId: "flower",
              updatedAt: NOW,
            },
          },
        ],
      },
    };
    const result = await importAppBackup(replacement, { mode: "replace" });

    assert.deepEqual(result, {
      mode: "replace",
      colors: 1,
      settings: 1,
      artworks: 1,
      coloring: 1,
    });
    assert.equal(await loadSetting("last-mode"), "color");
    assert.equal(
      storage.getItem("color-recipe:coloring:progress-template-1"),
      null,
    );
    assert.ok(storage.getItem("color-recipe:coloring:progress-new"));
    assert.deepEqual((await loadColors()).map((entry) => entry.id), ["blue"]);
  });

  restoreGlobals();
});
