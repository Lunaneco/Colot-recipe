import {
  SAVED_COLOR_SCHEMA_VERSION,
  SavedColorImportError,
  parseSavedColorsJson,
} from "./savedColorSchema";
import type { SavedColor } from "./types";

export {
  SAVED_COLOR_SCHEMA_VERSION,
  SavedColorImportError,
  parseSavedColorsJson,
} from "./savedColorSchema";
export {
  containsSavedColorId,
  hasSameSavedColorId,
} from "./savedColorSchema";

const DB_NAME = "color-recipe-studio";
const DB_VERSION = 1;
const FALLBACK_PREFIX = "color-recipe:";

type StoreName = "colors" | "settings" | "artworks" | "coloring";
type KeyValueStoreName = Exclude<StoreName, "colors">;

export const APP_BACKUP_KIND = "color-recipe-app-backup";
export const APP_BACKUP_VERSION = 1;
export const MAX_APP_BACKUP_JSON_CHARS = 64_000_000;

const MAX_BACKUP_ENTRIES_PER_STORE = 2_000;
const MAX_BACKUP_KEY_LENGTH = 240;
const MAX_BACKUP_STRING_CHARS = 32_000_000;
const MAX_BACKUP_ARRAY_LENGTH = 100_000;
const MAX_BACKUP_OBJECT_KEYS = 20_000;
const MAX_BACKUP_DEPTH = 48;
const MAX_BACKUP_NODES = 500_000;
const MAX_EMBEDDED_PNG_CHARS = 16_000_000;
const MAX_EMBEDDED_IMAGE_DIMENSION = 8192;
const MAX_EMBEDDED_IMAGE_PIXELS = 32_000_000;
const MAX_ARTWORK_LAYERS = 32;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AppBackupEntry = {
  key: string;
  value: JsonValue;
};

export type AppBackup = {
  kind: typeof APP_BACKUP_KIND;
  version: typeof APP_BACKUP_VERSION;
  exportedAt: string;
  stores: {
    colors: SavedColor[];
    settings: AppBackupEntry[];
    artworks: AppBackupEntry[];
    coloring: AppBackupEntry[];
  };
};

export type AppBackupImportOptions = {
  /**
   * `merge` preserves local keys not present in the backup and replaces
   * same-ID/key records with their backup copy. `replace` clears first.
   */
  mode?: "merge" | "replace";
};

export type AppBackupImportResult = {
  mode: "merge" | "replace";
  colors: number;
  settings: number;
  artworks: number;
  coloring: number;
};

export class StorageWriteError extends Error {
  readonly causes: unknown[];

  constructor(label: string, causes: unknown[]) {
    super(`${label}を端末に保存できませんでした`);
    this.name = "StorageWriteError";
    this.causes = causes;
  }
}

export class AppBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppBackupError";
  }
}

function fallbackKey(store: StoreName, key: string) {
  return `${FALLBACK_PREFIX}${store}:${key}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("colors")) {
        const colors = db.createObjectStore("colors", { keyPath: "id" });
        colors.createIndex("order", "order");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings");
      }
      if (!db.objectStoreNames.contains("artworks")) {
        db.createObjectStore("artworks");
      }
      if (!db.objectStoreNames.contains("coloring")) {
        db.createObjectStore("coloring");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });
}

async function idbGet<T>(
  storeName: StoreName,
  key: IDBValidKey,
): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error(`IndexedDB ${storeName} read failed`));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function idbGetAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as T[]);
    request.onerror = () =>
      reject(request.error ?? new Error(`IndexedDB ${storeName} read failed`));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function idbGetEntries(storeName: KeyValueStoreName) {
  const db = await openDatabase();
  return new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).openCursor();
    const entries: Array<{ key: string; value: unknown }> = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      if (typeof cursor.key === "string") {
        entries.push({ key: cursor.key, value: cursor.value as unknown });
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error(`IndexedDB ${storeName} scan failed`));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => db.close();
    transaction.onerror = () => db.close();
  });
}

async function idbPut<T>(
  storeName: StoreName,
  value: T,
  key?: IDBValidKey,
): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    if (key === undefined) store.put(value);
    else store.put(value, key);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? new Error(`IndexedDB ${storeName} write failed`));
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
  });
}

async function idbDelete(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? new Error(`IndexedDB ${storeName} delete failed`));
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
  });
}

async function idbClear(storeName: StoreName): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? new Error(`IndexedDB ${storeName} clear failed`));
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
  });
}

async function idbReplaceColors(colors: SavedColor[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("colors", "readwrite");
    const store = transaction.objectStore("colors");
    store.clear();
    colors.forEach((color, order) => store.put({ ...color, order }));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    const fail = () => {
      db.close();
      reject(transaction.error ?? new Error("IndexedDB colors write failed"));
    };
    transaction.onabort = fail;
    transaction.onerror = fail;
  });
}

function browserLocalStorage(): Storage {
  if (typeof localStorage === "undefined") {
    throw new Error("LocalStorage is unavailable");
  }
  return localStorage;
}

function readFallback<T>(store: StoreName, key: string): T | undefined {
  try {
    const raw = browserLocalStorage().getItem(fallbackKey(store, key));
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeFallback<T>(store: StoreName, key: string, value: T) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Value is not JSON serializable");
  }
  browserLocalStorage().setItem(fallbackKey(store, key), serialized);
}

function readFallbackEntries(store: KeyValueStoreName) {
  const entries: Array<{ key: string; value: unknown }> = [];
  try {
    const storage = browserLocalStorage();
    const prefix = `${FALLBACK_PREFIX}${store}:`;
    for (let index = 0; index < storage.length; index += 1) {
      const fullKey = storage.key(index);
      if (!fullKey?.startsWith(prefix)) continue;
      const raw = storage.getItem(fullKey);
      if (raw === null) continue;
      try {
        entries.push({
          key: fullKey.slice(prefix.length),
          value: JSON.parse(raw) as unknown,
        });
      } catch {
        // One damaged mirror entry should not hide the other recoverable keys.
      }
    }
  } catch {
    // LocalStorage is an optional recovery mirror.
  }
  return entries;
}

function clearFallbackStore(store: StoreName) {
  const storage = browserLocalStorage();
  const prefix = `${FALLBACK_PREFIX}${store}:`;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

const writeQueues = new Map<StoreName, Promise<void>>();

function enqueueStoreWrite(
  store: StoreName,
  operation: () => Promise<void>,
) {
  const previous = writeQueues.get(store) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(operation);
  const settled = queued.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(store, settled);
  void settled.then(() => {
    if (writeQueues.get(store) === settled) writeQueues.delete(store);
  });
  return queued;
}

function writeToAtLeastOneBackend(
  store: StoreName,
  label: string,
  idbOperation: () => Promise<void>,
  fallbackOperation: () => void,
) {
  return enqueueStoreWrite(store, async () => {
    const causes: unknown[] = [];
    let written = false;
    try {
      await idbOperation();
      written = true;
    } catch (error) {
      causes.push(error);
    }
    try {
      fallbackOperation();
      written = true;
    } catch (error) {
      causes.push(error);
    }
    if (!written) throw new StorageWriteError(label, causes);
  });
}

async function clearFromAtLeastOneBackend(
  store: StoreName,
  label: string,
) {
  await writeToAtLeastOneBackend(
    store,
    label,
    () => idbClear(store),
    () => clearFallbackStore(store),
  );
}

async function loadMirroredValue<T>(
  store: KeyValueStoreName,
  key: string,
): Promise<T | undefined> {
  try {
    const value = await idbGet<T>(store, key);
    if (value !== undefined) return value;
  } catch {
    // Try the recovery mirror below.
  }
  return readFallback<T>(store, key);
}

function normalizeColorsStrict(colors: SavedColor[]) {
  const parsed = parseSavedColorsJson(
    { version: SAVED_COLOR_SCHEMA_VERSION, colors },
    { allowEmpty: true },
  );
  if (parsed.rejected) {
    throw new SavedColorImportError(parsed.issues[0]?.message ?? "色データが不正です");
  }
  return parsed.colors.map((color, order) => ({ ...color, order }));
}

function recoverColors(value: unknown) {
  try {
    return parseSavedColorsJson(
      Array.isArray(value)
        ? value
        : { version: SAVED_COLOR_SCHEMA_VERSION, colors: value },
      { allowEmpty: true },
    ).colors
      .sort((left, right) => left.order - right.order)
      .map((color, order) => ({ ...color, order }));
  } catch {
    return [];
  }
}

export async function loadColors(): Promise<SavedColor[]> {
  try {
    const primary = await idbGetAll<unknown>("colors");
    if (primary.length) {
      const recovered = recoverColors(primary);
      if (recovered.length) return recovered;
    }
  } catch {
    // An empty, unavailable, or damaged primary store falls through.
  }
  return recoverColors(readFallback<unknown>("colors", "all") ?? []);
}

export async function saveColors(colors: SavedColor[]): Promise<void> {
  const normalized = normalizeColorsStrict(colors);
  await writeToAtLeastOneBackend(
    "colors",
    "保存色",
    () => idbReplaceColors(normalized),
    () => writeFallback("colors", "all", normalized),
  );
}

export async function deleteColor(id: string): Promise<void> {
  await writeToAtLeastOneBackend(
    "colors",
    "保存色",
    () => idbDelete("colors", id),
    () => {
      const colors = recoverColors(
        readFallback<unknown>("colors", "all") ?? [],
      ).filter((color) => color.id !== id);
      writeFallback("colors", "all", colors);
    },
  );
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  await writeToAtLeastOneBackend(
    "settings",
    "設定",
    () => idbPut("settings", value, key),
    () => writeFallback("settings", key, value),
  );
}

export async function loadSetting<T>(key: string): Promise<T | undefined> {
  return loadMirroredValue<T>("settings", key);
}

export async function saveArtwork(key: string, value: unknown): Promise<void> {
  await writeToAtLeastOneBackend(
    "artworks",
    "作品",
    () => idbPut("artworks", value, key),
    () => writeFallback("artworks", key, value),
  );
}

export async function loadArtwork<T>(key: string): Promise<T | undefined> {
  return loadMirroredValue<T>("artworks", key);
}

export async function saveColoringProgress(
  key: string,
  value: unknown,
): Promise<void> {
  await writeToAtLeastOneBackend(
    "coloring",
    "塗り絵の進み具合",
    () => idbPut("coloring", value, key),
    () => writeFallback("coloring", key, value),
  );
}

export async function loadColoringProgress<T>(
  key: string,
): Promise<T | undefined> {
  return loadMirroredValue<T>("coloring", key);
}

const backupRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function backupDate(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value) ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw new AppBackupError(`${label}が正しくありません`);
  }
  return new Date(value).toISOString();
}

function backupKey(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_BACKUP_KEY_LENGTH ||
    /[\u0000-\u001F]/u.test(value)
  ) {
    throw new AppBackupError(`${label}が正しくありません`);
  }
  return value;
}

function sanitizeJsonValue(
  value: unknown,
  state: { nodes: number },
  path: string,
  depth = 0,
): JsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_BACKUP_NODES) {
    throw new AppBackupError("バックアップ内のデータ項目が多すぎます");
  }
  if (depth > MAX_BACKUP_DEPTH) {
    throw new AppBackupError(`${path}の階層が深すぎます`);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (
      typeof value === "string" &&
      value.length > MAX_BACKUP_STRING_CHARS
    ) {
      throw new AppBackupError(`${path}の文字列が大きすぎます`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AppBackupError(`${path}に有限でない数値があります`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_BACKUP_ARRAY_LENGTH) {
      throw new AppBackupError(`${path}の配列が大きすぎます`);
    }
    return value.map((entry, index) =>
      sanitizeJsonValue(entry, state, `${path}[${index}]`, depth + 1),
    );
  }
  if (!backupRecord(value)) {
    throw new AppBackupError(`${path}がJSONとして保存できません`);
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_BACKUP_OBJECT_KEYS) {
    throw new AppBackupError(`${path}の項目が多すぎます`);
  }
  const safe: { [key: string]: JsonValue } = Object.create(null) as {
    [key: string]: JsonValue;
  };
  keys.forEach((key) => {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new AppBackupError(`${path}に安全でない項目名があります`);
    }
    safe[key] = sanitizeJsonValue(
      value[key],
      state,
      `${path}.${key}`,
      depth + 1,
    );
  });
  return safe;
}

function embeddedPngDimensions(value: string, path: string) {
  const prefix = "data:image/png;base64,";
  if (
    value.length === 0 ||
    value.length > MAX_EMBEDDED_PNG_CHARS ||
    !value.startsWith(prefix) ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value.slice(prefix.length))
  ) {
    throw new AppBackupError(`${path}の画像形式が安全ではありません`);
  }
  let header: string;
  try {
    header = atob(value.slice(prefix.length, prefix.length + 44));
  } catch {
    throw new AppBackupError(`${path}の画像データが壊れています`);
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    header.length < 24 ||
    !signature.every((byte, index) => header.charCodeAt(index) === byte)
  ) {
    throw new AppBackupError(`${path}のPNGヘッダーが正しくありません`);
  }
  const dimension = (offset: number) =>
    ((header.charCodeAt(offset) << 24) |
      (header.charCodeAt(offset + 1) << 16) |
      (header.charCodeAt(offset + 2) << 8) |
      header.charCodeAt(offset + 3)) >>>
    0;
  const width = dimension(16);
  const height = dimension(20);
  if (
    width === 0 ||
    height === 0 ||
    width > MAX_EMBEDDED_IMAGE_DIMENSION ||
    height > MAX_EMBEDDED_IMAGE_DIMENSION ||
    width * height > MAX_EMBEDDED_IMAGE_PIXELS
  ) {
    throw new AppBackupError(`${path}の画像寸法が大きすぎます`);
  }
  return { width, height };
}

function validateResourceStrings(value: JsonValue, path: string): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(?:https?|file|blob|javascript):/iu.test(trimmed)) {
      throw new AppBackupError(`${path}に外部参照を保存できません`);
    }
    if (/^data:image\//iu.test(trimmed)) {
      embeddedPngDimensions(trimmed, path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateResourceStrings(entry, `${path}[${index}]`),
    );
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) =>
      validateResourceStrings(entry, `${path}.${key}`),
    );
  }
}

function validateArtwork(value: JsonValue, path: string) {
  if (!backupRecord(value) || !Array.isArray(value.layers)) {
    throw new AppBackupError(`${path}の作品データが正しくありません`);
  }
  const width = value.width;
  const height = value.height;
  const supportedCanvas =
    (width === 1000 && height === 700) ||
    (width === 820 && height === 820) ||
    (width === 700 && height === 1000);
  if (!supportedCanvas) {
    throw new AppBackupError(`${path}のキャンバス寸法に対応していません`);
  }
  if (value.layers.length === 0 || value.layers.length > MAX_ARTWORK_LAYERS) {
    throw new AppBackupError(
      `${path}のレイヤーは1〜${MAX_ARTWORK_LAYERS}枚にしてください`,
    );
  }
  if (
    typeof value.background !== "string" ||
    !/^#[0-9a-f]{6}$/iu.test(value.background)
  ) {
    throw new AppBackupError(`${path}の背景色が正しくありません`);
  }
  const ids = new Set<string>();
  value.layers.forEach((layer, index) => {
    const layerPath = `${path}.layers[${index}]`;
    if (
      !backupRecord(layer) ||
      typeof layer.id !== "string" ||
      layer.id.length === 0 ||
      layer.id.length > 160 ||
      typeof layer.name !== "string" ||
      layer.name.length === 0 ||
      layer.name.length > 120 ||
      typeof layer.visible !== "boolean" ||
      typeof layer.opacity !== "number" ||
      !Number.isFinite(layer.opacity) ||
      layer.opacity < 0 ||
      layer.opacity > 100
    ) {
      throw new AppBackupError(`${layerPath}が正しくありません`);
    }
    if (ids.has(layer.id)) {
      throw new AppBackupError(`${path}に重複したレイヤーIDがあります`);
    }
    ids.add(layer.id);
    if (layer.dataUrl !== undefined) {
      if (typeof layer.dataUrl !== "string") {
        throw new AppBackupError(`${layerPath}.dataUrlが正しくありません`);
      }
      const dimensions = embeddedPngDimensions(
        layer.dataUrl,
        `${layerPath}.dataUrl`,
      );
      if (dimensions.width !== width || dimensions.height !== height) {
        throw new AppBackupError(
          `${layerPath}.dataUrlの寸法がキャンバスと一致しません`,
        );
      }
    }
  });
  if (
    value.activeLayerId !== undefined &&
    (typeof value.activeLayerId !== "string" ||
      !ids.has(value.activeLayerId))
  ) {
    throw new AppBackupError(`${path}の選択レイヤーが正しくありません`);
  }
}

function validateColoringProgress(value: JsonValue, path: string) {
  if (
    !backupRecord(value) ||
    typeof value.dataUrl !== "string" ||
    typeof value.sourceId !== "string" ||
    value.sourceId.length === 0 ||
    value.sourceId.length > 160 ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(new Date(value.updatedAt).getTime())
  ) {
    throw new AppBackupError(`${path}の塗り絵データが正しくありません`);
  }
  const dimensions = embeddedPngDimensions(value.dataUrl, `${path}.dataUrl`);
  if (dimensions.width !== 920 || dimensions.height !== 720) {
    throw new AppBackupError(`${path}.dataUrlの寸法が塗り絵と一致しません`);
  }
}

function validateBackupEntryValue(
  store: KeyValueStoreName,
  key: string,
  value: JsonValue,
  path: string,
) {
  validateResourceStrings(value, path);
  if (store === "artworks" && key === "main") {
    validateArtwork(value, path);
  }
  if (store === "coloring" && key.startsWith("progress-")) {
    validateColoringProgress(value, path);
  }
  if (
    store === "settings" &&
    key === "coloring-tools" &&
    backupRecord(value) &&
    value.uploadedImage !== undefined
  ) {
    if (typeof value.uploadedImage !== "string") {
      throw new AppBackupError(`${path}.uploadedImageが正しくありません`);
    }
    const dimensions = embeddedPngDimensions(
      value.uploadedImage,
      `${path}.uploadedImage`,
    );
    if (dimensions.width !== 920 || dimensions.height !== 720) {
      throw new AppBackupError(
        `${path}.uploadedImageの寸法が塗り絵と一致しません`,
      );
    }
  }
}

function normalizeBackupEntries(
  value: unknown,
  store: KeyValueStoreName,
): AppBackupEntry[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_BACKUP_ENTRIES_PER_STORE
  ) {
    throw new AppBackupError(
      `${store}は${MAX_BACKUP_ENTRIES_PER_STORE}件以下の配列にしてください`,
    );
  }

  const seen = new Set<string>();
  const state = { nodes: 0 };
  return value.map((entry, index) => {
    if (!backupRecord(entry)) {
      throw new AppBackupError(`${store}[${index}]が正しくありません`);
    }
    const key = backupKey(entry.key, `${store}[${index}]のキー`);
    if (seen.has(key)) {
      throw new AppBackupError(`${store}内でキー「${key}」が重複しています`);
    }
    seen.add(key);
    const path = `${store}[${index}].value`;
    const sanitized = sanitizeJsonValue(entry.value, state, path);
    validateBackupEntryValue(store, key, sanitized, path);
    return { key, value: sanitized };
  });
}

function decodeBackup(input: string | unknown) {
  let serialized: string;
  if (typeof input === "string") {
    serialized = input;
  } else {
    try {
      const encoded = JSON.stringify(input);
      if (encoded === undefined) {
        throw new Error("not serializable");
      }
      serialized = encoded;
    } catch {
      throw new AppBackupError("バックアップがJSONとして読み取れません");
    }
  }
  if (serialized.length > MAX_APP_BACKUP_JSON_CHARS) {
    throw new AppBackupError("バックアップファイルが大きすぎます");
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new AppBackupError("バックアップJSONの構文が正しくありません");
  }
}

/** Validates and normalizes a full four-store backup before any write occurs. */
export function parseAppBackupJson(input: string | unknown): AppBackup {
  const decoded = decodeBackup(input);
  if (!backupRecord(decoded)) {
    throw new AppBackupError("バックアップの形が正しくありません");
  }
  if (decoded.kind !== APP_BACKUP_KIND) {
    throw new AppBackupError("カラーレシピの全体バックアップではありません");
  }
  if (decoded.version !== APP_BACKUP_VERSION) {
    throw new AppBackupError(
      `対応していないバックアップ版です（対応版: ${APP_BACKUP_VERSION}）`,
    );
  }
  if (!backupRecord(decoded.stores)) {
    throw new AppBackupError("バックアップにstoresがありません");
  }

  let parsedColors;
  try {
    parsedColors = parseSavedColorsJson(
      {
        version: SAVED_COLOR_SCHEMA_VERSION,
        colors: decoded.stores.colors,
      },
      { allowEmpty: true },
    );
  } catch (error) {
    throw new AppBackupError(
      `保存色が正しくありません: ${
        error instanceof Error ? error.message : "不明なエラー"
      }`,
    );
  }
  if (parsedColors.rejected) {
    throw new AppBackupError(
      `保存色に不正な項目があります: ${parsedColors.issues[0]?.message}`,
    );
  }

  return {
    kind: APP_BACKUP_KIND,
    version: APP_BACKUP_VERSION,
    exportedAt: backupDate(decoded.exportedAt, "書き出し日時"),
    stores: {
      colors: parsedColors.colors,
      settings: normalizeBackupEntries(decoded.stores.settings, "settings"),
      artworks: normalizeBackupEntries(decoded.stores.artworks, "artworks"),
      coloring: normalizeBackupEntries(decoded.stores.coloring, "coloring"),
    },
  };
}

async function loadAllMirroredEntries(
  store: KeyValueStoreName,
): Promise<AppBackupEntry[]> {
  const merged = new Map<string, unknown>();
  readFallbackEntries(store).forEach(({ key, value }) => merged.set(key, value));
  try {
    const primary = await idbGetEntries(store);
    primary.forEach(({ key, value }) => merged.set(key, value));
  } catch {
    // The LocalStorage mirror above is still exportable.
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ja"))
    .map(([key, value]) => ({
      key,
      value: sanitizeJsonValue(value, { nodes: 0 }, `${store}.${key}`),
    }));
}

/** Collects a validated, versioned backup of all four local stores. */
export async function exportAppBackup(): Promise<AppBackup> {
  const [colors, settings, artworks, coloring] = await Promise.all([
    loadColors(),
    loadAllMirroredEntries("settings"),
    loadAllMirroredEntries("artworks"),
    loadAllMirroredEntries("coloring"),
  ]);
  const backup: AppBackup = {
    kind: APP_BACKUP_KIND,
    version: APP_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    stores: { colors, settings, artworks, coloring },
  };
  const serialized = JSON.stringify(backup);
  if (serialized.length > MAX_APP_BACKUP_JSON_CHARS) {
    throw new AppBackupError("バックアップ全体が大きすぎます");
  }
  return parseAppBackupJson(serialized);
}

async function writeBackupEntry(
  store: KeyValueStoreName,
  entry: AppBackupEntry,
) {
  await writeToAtLeastOneBackend(
    store,
    `${store}の「${entry.key}」`,
    () => idbPut(store, entry.value, entry.key),
    () => writeFallback(store, entry.key, entry.value),
  );
}

/**
 * Restores a fully validated backup. Validation finishes before the first
 * mutation. A same-ID colour or same-key record is replaced by the backup copy.
 */
export async function importAppBackup(
  input: string | unknown,
  options: AppBackupImportOptions = {},
): Promise<AppBackupImportResult> {
  const backup = parseAppBackupJson(input);
  const mode = options.mode ?? "merge";

  let colors = backup.stores.colors;
  if (mode === "merge") {
    const existing = await loadColors();
    const importedIds = new Set(colors.map((color) => color.id));
    colors = [
      ...colors,
      ...existing.filter((color) => !importedIds.has(color.id)),
    ];
  }
  await saveColors(colors.map((color, order) => ({ ...color, order })));

  const stores = ["settings", "artworks", "coloring"] as const;
  if (mode === "replace") {
    for (const store of stores) {
      await clearFromAtLeastOneBackend(store, `${store}の既存データ`);
    }
  }
  for (const store of stores) {
    for (const entry of backup.stores[store]) {
      await writeBackupEntry(store, entry);
    }
  }

  return {
    mode,
    colors: backup.stores.colors.length,
    settings: backup.stores.settings.length,
    artworks: backup.stores.artworks.length,
    coloring: backup.stores.coloring.length,
  };
}

export function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
