import { hexToRgb, mixPaint, mixPaintProportionsFromRgb, rgbToHsl } from "./colorScience";
import {
  MATERIAL_IDS,
  PIGMENT_IDS,
  type CapturedColorAppearance,
  type ExactPaint,
  type MaterialId,
  type MixGesture,
  type PaintShape,
  type MixedColorSnapshot,
  type OpticalPaintLayer,
  type PaintSize,
  type PaintStep,
  type RecipeUnits,
  type SavedColor,
} from "./types";

export const SAVED_COLOR_SCHEMA_VERSION = 4;
export const MAX_IMPORTED_COLORS = 1_000;
export const MAX_RECIPE_UNITS_PER_MATERIAL = 1_000;
export const MAX_TOTAL_RECIPE_UNITS = 2_500;
export const MAX_COLOR_IMPORT_JSON_CHARS = 8_000_000;

const PAINT_SIZES = ["small", "medium", "large"] as const;
const PAINT_SHAPES = ["tap", "hold", "stroke"] as const;
const MAX_STEPS_PER_COLOR = 5_000;
const MAX_STEP_DEPOSIT = 8;
const MAX_GESTURES_PER_COLOR = 2_000;
const MAX_PATH_POINTS_PER_GESTURE = 2_000;
const MAX_ID_LENGTH = 160;
const MAX_NAME_LENGTH = 160;
const MAX_NOTE_LENGTH = 8_000;
const MAX_METHOD_LENGTH = 500;

type UnknownRecord = Record<string, unknown>;

export type SavedColorImportIssue = {
  index: number;
  message: string;
};

export type SavedColorImportResult = {
  /** `0` denotes the legacy unversioned array/object shape. */
  version: 0 | 1 | 2 | 3 | typeof SAVED_COLOR_SCHEMA_VERSION;
  colors: SavedColor[];
  rejected: number;
  issues: SavedColorImportIssue[];
};

export type SavedColorParseOptions = {
  /** Makes migrations deterministic in tests and server-side tooling. */
  now?: Date | string;
  /** Persistence recovery may legitimately contain no colours. */
  allowEmpty?: boolean;
};

export class SavedColorImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedColorImportError";
  }
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMaterialId = (value: unknown): value is MaterialId =>
  typeof value === "string" &&
  (MATERIAL_IDS as readonly string[]).includes(value);

const isPaintSize = (value: unknown): value is PaintSize =>
  typeof value === "string" &&
  (PAINT_SIZES as readonly string[]).includes(value);

const isPaintShape = (value: unknown): value is PaintShape =>
  typeof value === "string" &&
  (PAINT_SHAPES as readonly string[]).includes(value);

const finiteNumber = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SavedColorImportError(`${label}が範囲外です`);
  }
  return value;
};

const hasDisallowedControlCharacter = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    ) {
      return true;
    }
  }
  return false;
};

const boundedString = (
  value: unknown,
  label: string,
  maximumLength: number,
  fallback?: string,
) => {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new SavedColorImportError(`${label}がありません`);
  }
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    hasDisallowedControlCharacter(value)
  ) {
    throw new SavedColorImportError(`${label}が正しくありません`);
  }
  return value;
};

const identifier = (value: unknown, label: string, fallback?: string) => {
  const result = boundedString(value, label, MAX_ID_LENGTH, fallback).trim();
  if (!result) throw new SavedColorImportError(`${label}が空です`);
  return result;
};

const normalizeNow = (value: Date | string | undefined) => {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    throw new SavedColorImportError("基準日時が正しくありません");
  }
  return date.toISOString();
};

const isoDate = (value: unknown, label: string, fallback: string) => {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value)
  ) {
    throw new SavedColorImportError(`${label}がISO日時ではありません`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SavedColorImportError(`${label}が正しくありません`);
  }
  return date.toISOString();
};

const normalizeRecipe = (value: unknown): RecipeUnits => {
  if (!isRecord(value)) {
    throw new SavedColorImportError("配合がありません");
  }

  const recipe = Object.fromEntries(
    MATERIAL_IDS.map((material) => {
      const units = value[material] ?? 0;
      if (
        typeof units !== "number" ||
        !Number.isSafeInteger(units) ||
        units < 0 ||
        units > MAX_RECIPE_UNITS_PER_MATERIAL
      ) {
        throw new SavedColorImportError(
          `${material}の単位は0〜${MAX_RECIPE_UNITS_PER_MATERIAL}の整数にしてください`,
        );
      }
      return [material, units];
    }),
  ) as RecipeUnits;

  const total = MATERIAL_IDS.reduce(
    (sum, material) => sum + recipe[material],
    0,
  );
  if (total > MAX_TOTAL_RECIPE_UNITS) {
    throw new SavedColorImportError(
      `配合の合計は${MAX_TOTAL_RECIPE_UNITS}単位以下にしてください`,
    );
  }
  return recipe;
};

const normalizeStep = (
  value: unknown,
  index: number,
  fallbackDate: string,
): PaintStep => {
  if (!isRecord(value)) {
    throw new SavedColorImportError(`手順${index + 1}が正しくありません`);
  }
  if (!isMaterialId(value.material)) {
    throw new SavedColorImportError(`手順${index + 1}の材料が不明です`);
  }
  if (value.size !== undefined && !isPaintSize(value.size)) {
    throw new SavedColorImportError(`手順${index + 1}の量が不明です`);
  }
  if (value.shape !== undefined && !isPaintShape(value.shape)) {
    throw new SavedColorImportError(`手順${index + 1}の形が不明です`);
  }
  const deposit =
    value.deposit === undefined
      ? undefined
      : finiteNumber(
          value.deposit,
          `手順${index + 1}の重なり量`,
          1,
          MAX_STEP_DEPOSIT,
        );
  if (deposit !== undefined && !Number.isSafeInteger(deposit)) {
    throw new SavedColorImportError(
      `手順${index + 1}の重なり量は整数にしてください`,
    );
  }
  const waveSeed =
    value.waveSeed === undefined
      ? undefined
      : finiteNumber(
          value.waveSeed,
          `手順${index + 1}の波形`,
          0,
          1,
        );
  const recipe =
    value.recipe === undefined ? undefined : normalizeRecipe(value.recipe);

  return {
    id: identifier(value.id, `手順${index + 1}のID`, `import-step-${index}`),
    material: value.material,
    ...(recipe === undefined ? {} : { recipe }),
    ...(deposit === undefined ? {} : { deposit }),
    ...(value.shape === undefined ? {} : { shape: value.shape }),
    ...(waveSeed === undefined ? {} : { waveSeed }),
    ...(value.amount === undefined ? {} : {
      amount: finiteNumber(value.amount, `手順${index + 1}の連続量`, 0, 100_000),
    }),
    size: value.size ?? "medium",
    x: finiteNumber(value.x, `手順${index + 1}の横位置`, 0, 1),
    y: finiteNumber(value.y, `手順${index + 1}の縦位置`, 0, 1),
    createdAt: isoDate(
      value.createdAt,
      `手順${index + 1}の日時`,
      fallbackDate,
    ),
  };
};

const normalizePath = (value: unknown, gestureIndex: number) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_PATH_POINTS_PER_GESTURE) {
    throw new SavedColorImportError(
      `混ぜ方${gestureIndex + 1}の軌跡が大きすぎるか不正です`,
    );
  }
  return value.map((point, pointIndex) => {
    if (!isRecord(point)) {
      throw new SavedColorImportError(
        `混ぜ方${gestureIndex + 1}の軌跡${pointIndex + 1}が不正です`,
      );
    }
    return {
      x: finiteNumber(
        point.x,
        `混ぜ方${gestureIndex + 1}の軌跡${pointIndex + 1}の横位置`,
        0,
        1,
      ),
      y: finiteNumber(
        point.y,
        `混ぜ方${gestureIndex + 1}の軌跡${pointIndex + 1}の縦位置`,
        0,
        1,
      ),
    };
  });
};

const normalizeGesture = (
  value: unknown,
  index: number,
  fallbackDate: string,
): MixGesture => {
  if (!isRecord(value)) {
    throw new SavedColorImportError(`混ぜ方${index + 1}が正しくありません`);
  }
  if (
    value.kind !== undefined &&
    value.kind !== "gesture" &&
    value.kind !== "all"
  ) {
    throw new SavedColorImportError(`混ぜ方${index + 1}の種類が不明です`);
  }

  const points = finiteNumber(
    value.points,
    `混ぜ方${index + 1}の点数`,
    0,
    100_000,
  );
  if (!Number.isInteger(points)) {
    throw new SavedColorImportError(`混ぜ方${index + 1}の点数が整数ではありません`);
  }

  const path = normalizePath(value.path, index);
  const recipe =
    value.recipe === undefined ? undefined : normalizeRecipe(value.recipe);
  let stepIds: string[] | undefined;
  if (value.stepIds !== undefined) {
    if (!Array.isArray(value.stepIds) || value.stepIds.length > MAX_STEPS_PER_COLOR) {
      throw new SavedColorImportError(`混ぜ方${index + 1}の手順参照が不正です`);
    }
    stepIds = value.stepIds.map((id) => identifier(id, "混ぜ方の手順ID"));
  }
  return {
    id: identifier(value.id, `混ぜ方${index + 1}のID`, `import-mix-${index}`),
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    distance: finiteNumber(
      value.distance,
      `混ぜ方${index + 1}の距離`,
      0,
      10_000_000,
    ),
    speed: finiteNumber(
      value.speed,
      `混ぜ方${index + 1}の速度`,
      0,
      100_000,
    ),
    points,
    ...(path === undefined ? {} : { path }),
    ...(recipe === undefined ? {} : { recipe }),
    ...(stepIds === undefined ? {} : { stepIds }),
    createdAt: isoDate(
      value.createdAt,
      `混ぜ方${index + 1}の日時`,
      fallbackDate,
    ),
  };
};

const normalizeArray = <T>(
  value: unknown,
  label: string,
  maximumLength: number,
  normalize: (entry: unknown, index: number) => T,
) => {
  if (value === undefined || value === null) return [] as T[];
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new SavedColorImportError(
      `${label}は${maximumLength}件以下の配列にしてください`,
    );
  }
  return value.map(normalize);
};

const calculatedSnapshot = (recipe: RecipeUnits): MixedColorSnapshot => {
  const calculated = mixPaint(recipe);
  return {
    hex: calculated.hex,
    rgb: calculated.rgb,
    hsl: calculated.hsl,
    pigmentRatio: calculated.pigmentRatio,
    opacity: calculated.opacity,
    waterRatio: calculated.waterRatio,
    intensity: calculated.intensity,
    viscosity: calculated.viscosity,
    spread: calculated.spread,
    dryingSpeed: calculated.dryingSpeed,
    name: calculated.name,
  };
};

const normalizeCapturedAppearance = (
  value: unknown,
): CapturedColorAppearance | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new SavedColorImportError("スポイトの見た目情報が正しくありません");
  }
  if (
    typeof value.hex !== "string" ||
    !/^#[0-9A-F]{6}$/iu.test(value.hex)
  ) {
    throw new SavedColorImportError("スポイトのHEX色が正しくありません");
  }
  return {
    hex: value.hex.toUpperCase(),
    opacity: finiteNumber(
      value.opacity,
      "スポイトの透明度",
      0,
      1,
    ),
  };
};

const assertStepsMatchRecipe = (
  steps: PaintStep[],
  recipe: RecipeUnits,
) => {
  // Legacy colours may only contain their final recipe. When placement
  // history exists, however, it must describe exactly the same quantities.
  // This prevents a forged compound step plus `deposit` from bypassing the
  // recipe limits and producing a different local eyedropper result.
  if (steps.length === 0) return;

  const aggregate = Object.fromEntries(
    MATERIAL_IDS.map((material) => [material, 0]),
  ) as RecipeUnits;
  for (const step of steps) {
    const deposit = step.amount ?? step.deposit ?? 1;
    for (const material of MATERIAL_IDS) {
      const batchUnits =
        step.recipe === undefined
          ? step.material === material
            ? 1
            : 0
          : step.recipe[material];
      aggregate[material] += batchUnits * deposit;
    }
  }

  if (
    MATERIAL_IDS.some(
      (material) => aggregate[material] !== recipe[material],
    )
  ) {
    throw new SavedColorImportError(
      "絵の具の手順合計が色の配合と一致しません",
    );
  }
};

const normalizeExactPaint = (value: unknown): ExactPaint | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !isRecord(value.weights)) {
    throw new SavedColorImportError("連続顔料量が正しくありません");
  }
  const inputWeights = value.weights;
  const weights = Object.fromEntries(MATERIAL_IDS.map((material) => [material,
    finiteNumber(inputWeights[material] ?? 0, `${material}の連続量`, 0, 100_000),
  ])) as RecipeUnits;
  if (PIGMENT_IDS.reduce((sum, p) => sum + weights[p], 0) <= 0) {
    throw new SavedColorImportError("連続顔料量に顔料がありません");
  }
  let layerCount = 0;
  const normalizeFilm = (entry: unknown, depth = 0): OpticalPaintLayer => {
      layerCount += 1;
      if (depth > 32 || layerCount > 2048) throw new SavedColorImportError("測定顔料膜の階層が大きすぎます");
      if (!isRecord(entry) || !Array.isArray(entry.pigment) || entry.pigment.length !== PIGMENT_IDS.length) {
        throw new SavedColorImportError("測定顔料膜の顔料比が正しくありません");
      }
      let pigment = entry.pigment.map((amount) => finiteNumber(amount, "測定顔料膜の顔料比", 0, 1));
      const sum = pigment.reduce((a, b) => a + b, 0);
      if (sum <= 0 || Math.abs(sum - 1) > 0.001) throw new SavedColorImportError("測定顔料膜の顔料比が正規化されていません");
      let mass = finiteNumber(entry.mass, "測定顔料膜の厚み", 0, 100_000);
      let children: OpticalPaintLayer[] | undefined;
      if (entry.children !== undefined) {
        if (!Array.isArray(entry.children) || !entry.children.length || entry.children.length > 64) {
          throw new SavedColorImportError("測定顔料膜の子階層が正しくありません");
        }
        children = entry.children.map((child) => normalizeFilm(child, depth + 1));
        mass = children.reduce((total, child) => total + child.mass, 0);
        if (mass <= 0 || mass > 100_000) throw new SavedColorImportError("測定顔料膜の子階層の厚みが範囲外です");
        pigment = PIGMENT_IDS.map((_, p) => children!.reduce((total, child) => total + child.pigment[p] * child.mass, 0) / mass);
      }
      return { pigment, mass,
        ...(entry.opacity === undefined ? {} : { opacity: finiteNumber(entry.opacity, "測定顔料膜の透明度", 0, 1) }),
        ...(entry.lighting === undefined ? {} : { lighting: finiteNumber(entry.lighting, "測定顔料膜の照明", 0, 4) }),
        ...(children === undefined ? {} : { children }),
      };
  };
  const opticalStack = value.opticalStack === undefined ? undefined
    : normalizeArray(value.opticalStack, "測定顔料膜", 64, (entry) => normalizeFilm(entry));
  return { weights, opticalMass: finiteNumber(value.opticalMass, "光学厚み", 0, 100_000),
    ...(opticalStack === undefined ? {} : { opticalStack }) };
};

/**
 * Normalizes one legacy/current SavedColor. Recipe data is authoritative:
 * all derived colour values are recalculated and never trusted from JSON.
 */
export function normalizeSavedColor(
  value: unknown,
  index = 0,
  options: SavedColorParseOptions = {},
): SavedColor {
  if (!isRecord(value)) {
    throw new SavedColorImportError("色データがオブジェクトではありません");
  }

  const now = normalizeNow(options.now);
  const id = identifier(value.id, "色のID");
  const recipe = normalizeRecipe(value.recipe);
  const mixedValue = value.mixed;
  if (mixedValue !== undefined && mixedValue !== null) {
    if (!isRecord(mixedValue)) {
      throw new SavedColorImportError("色の計算結果が正しくありません");
    }
    if (
      mixedValue.hex !== undefined &&
      (typeof mixedValue.hex !== "string" ||
        !/^#[0-9A-F]{6}$/iu.test(mixedValue.hex))
    ) {
      throw new SavedColorImportError("HEX色が正しくありません");
    }
  }

  if (
    value.order !== undefined &&
    (!Number.isSafeInteger(value.order) ||
      (value.order as number) < 0 ||
      (value.order as number) > MAX_IMPORTED_COLORS * 10)
  ) {
    throw new SavedColorImportError("並び順が正しくありません");
  }

  const createdAt = isoDate(value.createdAt, "作成日時", now);
  const updatedAt = isoDate(value.updatedAt, "更新日時", createdAt);
  const capturedAppearance = normalizeCapturedAppearance(
    value.capturedAppearance,
  );
  const exactPaint = normalizeExactPaint(value.exactPaint);
  const calculated = calculatedSnapshot(recipe);
  const capturedRgb = capturedAppearance
    ? hexToRgb(capturedAppearance.hex)
    : undefined;
  const physical = exactPaint
    ? mixPaintProportionsFromRgb(exactPaint.weights, capturedRgb ?? calculated.rgb)
    : calculated;
  const mixed = capturedAppearance && capturedRgb
    ? {
        ...physical,
        hex: capturedAppearance.hex,
        rgb: capturedRgb,
        hsl: rgbToHsl(capturedRgb),
        opacity: capturedAppearance.opacity,
        ...(exactPaint ? { exactPaint } : {}),
      }
    : { ...physical, ...(exactPaint ? { exactPaint } : {}) };
  const name = boundedString(value.name, "色名", MAX_NAME_LENGTH, mixed.name);
  const steps = normalizeArray(
    value.steps,
    "絵の具の手順",
    MAX_STEPS_PER_COLOR,
    (entry, stepIndex) => normalizeStep(entry, stepIndex, createdAt),
  );
  if (!exactPaint) assertStepsMatchRecipe(steps, recipe);

  return {
    id,
    name: name.trim() || mixed.name,
    note: boundedString(value.note, "メモ", MAX_NOTE_LENGTH, ""),
    recipe,
    mixed,
    ...(capturedAppearance === undefined ? {} : { capturedAppearance }),
    ...(exactPaint === undefined ? {} : { exactPaint }),
    steps,
    mixGestures: normalizeArray(
      value.mixGestures,
      "混ぜ方",
      MAX_GESTURES_PER_COLOR,
      (entry, gestureIndex) =>
        normalizeGesture(entry, gestureIndex, createdAt),
    ),
    mixMethod: boundedString(
      value.mixMethod,
      "混ぜ方の説明",
      MAX_METHOD_LENGTH,
      "保存済みの配合",
    ),
    createdAt,
    updatedAt,
    order:
      value.order === undefined
        ? index
        : (value.order as number),
  };
}

const decodePayload = (input: string | unknown) => {
  if (typeof input !== "string") return input;
  if (input.length > MAX_COLOR_IMPORT_JSON_CHARS) {
    throw new SavedColorImportError("JSONファイルが大きすぎます");
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new SavedColorImportError("JSONの構文が正しくありません");
  }
};

/**
 * Parses an exported payload or a legacy bare SavedColor array.
 *
 * Invalid entries are reported and skipped so one damaged record does not
 * discard an otherwise recoverable palette. A payload with no valid entries
 * still fails unless `allowEmpty` is explicitly enabled.
 */
export function parseSavedColorsJson(
  input: string | unknown,
  options: SavedColorParseOptions = {},
): SavedColorImportResult {
  const decoded = decodePayload(input);
  let version: SavedColorImportResult["version"] = 0;
  let candidates: unknown;

  if (Array.isArray(decoded)) {
    candidates = decoded;
  } else if (isRecord(decoded)) {
    if (decoded.version !== undefined) {
      if (
        !Number.isSafeInteger(decoded.version) ||
        (decoded.version !== 0 &&
          decoded.version !== 1 &&
          decoded.version !== 2 &&
          decoded.version !== 3 &&
          decoded.version !== SAVED_COLOR_SCHEMA_VERSION)
      ) {
        throw new SavedColorImportError(
          `対応していないデータ版です（対応版: ${SAVED_COLOR_SCHEMA_VERSION}）`,
        );
      }
      version = decoded.version as SavedColorImportResult["version"];
    }
    candidates = decoded.colors;
  } else {
    throw new SavedColorImportError("色データの形が正しくありません");
  }

  if (!Array.isArray(candidates)) {
    throw new SavedColorImportError("colors配列がありません");
  }
  if (candidates.length > MAX_IMPORTED_COLORS) {
    throw new SavedColorImportError(
      `一度に読み込める色は${MAX_IMPORTED_COLORS}色までです`,
    );
  }

  const colors: SavedColor[] = [];
  const issues: SavedColorImportIssue[] = [];
  const seenIds = new Set<string>();
  const importOptions = { ...options, now: normalizeNow(options.now) };
  candidates.forEach((candidate, index) => {
    try {
      const color = normalizeSavedColor(candidate, colors.length, importOptions);
      if (seenIds.has(color.id)) {
        throw new SavedColorImportError("同じIDがファイル内で重複しています");
      }
      seenIds.add(color.id);
      colors.push(color);
    } catch (error) {
      issues.push({
        index,
        message:
          error instanceof Error ? error.message : "色データが正しくありません",
      });
    }
  });

  if (!colors.length && !options.allowEmpty) {
    const detail = issues[0]?.message;
    throw new SavedColorImportError(
      detail ? `読み込める色がありません: ${detail}` : "読み込める色がありません",
    );
  }

  return {
    version,
    colors,
    rejected: issues.length,
    issues,
  };
}

type SavedColorIdentity = string | Pick<SavedColor, "id">;

const identityValue = (value: SavedColorIdentity) =>
  typeof value === "string" ? value : value.id;

/** Central same-ID check for import collision handling. */
export function hasSameSavedColorId(
  left: SavedColorIdentity,
  right: SavedColorIdentity,
) {
  return identityValue(left) === identityValue(right);
}

export function containsSavedColorId(
  colors: readonly Pick<SavedColor, "id">[],
  candidate: SavedColorIdentity,
) {
  const id = identityValue(candidate);
  return colors.some((color) => color.id === id);
}
