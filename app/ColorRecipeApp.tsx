"use client";

import {
  Beaker,
  BookOpen,
  Brush,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Menu,
  Palette,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColorDetailDialog, SaveColorDialog } from "../components/ColorDialogs";
import { MixingStudio } from "../components/MixingStudio";
import { SavedPalette } from "../components/SavedPalette";
import { mixPaint } from "../lib/colorScience";
import type { SpatialPaintSample } from "../lib/spatialMix";
import {
  exportAppBackup,
  importAppBackup,
  downloadJson,
  loadColors,
  loadSetting,
  parseSavedColorsJson,
  SAVED_COLOR_SCHEMA_VERSION,
  saveColors,
  saveSetting,
} from "../lib/storage";
import type {
  AppMode,
  MaterialId,
  MixedColorSnapshot,
  MixGesture,
  MixerTool,
  PaintSize,
  RecipeUnits,
  SavedColor,
} from "../lib/types";
import {
  EMPTY_RECIPE,
  MATERIAL_IDS,
  MATERIAL_LABELS,
  MATERIAL_REGISTRY,
  PIGMENT_IDS,
} from "../lib/types";
import { useHistory } from "../lib/useHistory";

const DrawingStudio = dynamic(
  () => import("../components/DrawingStudio").then((module) => module.DrawingStudio),
  {
    ssr: false,
    loading: () => <div className="mode-loading">おえかきの道具を準備しています…</div>,
  },
);

const ColoringStudio = dynamic(
  () =>
    import("../components/ColoringStudio").then((module) => module.ColoringStudio),
  {
    ssr: false,
    loading: () => <div className="mode-loading">ぬりえを準備しています…</div>,
  },
);

type MixerState = {
  recipe: typeof EMPTY_RECIPE;
  steps: SavedColor["steps"];
  mixGestures: SavedColor["mixGestures"];
};

type MixerUiSettings = {
  selectedMaterial: MixerTool;
  paintSize: PaintSize;
  detailedRecipe: boolean;
};

type SaveDraft = {
  recipe: RecipeUnits;
  mixed: MixedColorSnapshot;
  sampled: boolean;
};

const MODES: Array<{
  id: AppMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}> = [
  { id: "mix", label: "いろをつくる", description: "絵の具を混ぜる", icon: Beaker },
  { id: "draw", label: "おえかき", description: "自由に描く", icon: Brush },
  { id: "color", label: "ぬりえ", description: "線画を彩る", icon: BookOpen },
];

const INITIAL_MIXER: MixerState = {
  recipe: { ...EMPTY_RECIPE },
  steps: [],
  mixGestures: [],
};

const MIXER_TOOL_IDS: MixerTool[] = [
  ...MATERIAL_IDS,
  "eraser",
  "picker",
];
const MAX_COLOR_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_IMPORT_BYTES = 64 * 1024 * 1024;

const MIXER_SHORTCUTS = {
  ...Object.fromEntries(
    MATERIAL_IDS.map((material) => [
      MATERIAL_REGISTRY[material].shortcut.toLowerCase(),
      material,
    ]),
  ),
  e: "eraser",
  i: "picker",
} as Record<string, MixerTool>;

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function mixedSnapshot(recipe: typeof EMPTY_RECIPE): MixedColorSnapshot {
  const result = mixPaint(recipe);
  return {
    hex: result.hex,
    rgb: result.rgb,
    hsl: result.hsl,
    pigmentRatio: result.pigmentRatio,
    opacity: result.opacity,
    waterRatio: result.waterRatio,
    intensity: result.intensity,
    viscosity: result.viscosity,
    spread: result.spread,
    dryingSpeed: result.dryingSpeed,
    name: result.name,
  };
}

function cloneMixedSnapshot(mixed: MixedColorSnapshot): MixedColorSnapshot {
  return {
    ...mixed,
    rgb: { ...mixed.rgb },
    hsl: { ...mixed.hsl },
    pigmentRatio: { ...mixed.pigmentRatio },
  };
}

function snapshotFromHex(hex: string): MixedColorSnapshot {
  const value = hex.replace("#", "");
  const rgb = {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
  const red = rgb.r / 255;
  const green = rgb.g / 255;
  const blue = rgb.b / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hex,
    rgb,
    hsl: {
      h: Math.round(hue),
      s: Math.round(saturation * 100),
      l: Math.round(lightness * 100),
    },
    pigmentRatio: Object.fromEntries(
      PIGMENT_IDS.map((pigment) => [pigment, 0]),
    ) as MixedColorSnapshot["pigmentRatio"],
    opacity: 1,
    waterRatio: 0,
    intensity: 1,
    viscosity: 0.65,
    spread: 0.3,
    dryingSpeed: 0.65,
    name: "スポイトで見つけた色",
  };
}

export default function ColorRecipeApp() {
  const mixer = useHistory<MixerState>(INITIAL_MIXER, 60);
  const paletteHistory = useHistory<SavedColor[]>([], 50);
  const resetPaletteHistory = paletteHistory.reset;
  const savedColors = paletteHistory.state;
  const [mode, setMode] = useState<AppMode>("mix");
  const [selectedMaterial, setSelectedMaterial] = useState<MixerTool>("red");
  const [paintSize, setPaintSize] = useState<PaintSize>("medium");
  const [detailedRecipe, setDetailedRecipe] = useState(false);
  const [activeColorId, setActiveColorId] = useState<string>();
  const [recentColorIds, setRecentColorIds] = useState<string[]>([]);
  const [sampledColor, setSampledColor] = useState<MixedColorSnapshot>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDraft, setSaveDraft] = useState<SaveDraft>();
  const [detailColor, setDetailColor] = useState<SavedColor>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [compactLayout, setCompactLayout] = useState(false);
  const helpDialogRef = useRef<HTMLElement>(null);
  const helpPreviousFocus = useRef<HTMLElement | null>(null);

  const currentMixed = useMemo(
    () => mixedSnapshot(mixer.state.recipe),
    [mixer.state.recipe],
  );
  const pigmentUnits = PIGMENT_IDS.reduce(
    (total, pigment) => total + mixer.state.recipe[pigment],
    0,
  );
  const activeSavedColor = savedColors.find((color) => color.id === activeColorId);
  const fallbackColor = useMemo(() => mixedSnapshot({ ...EMPTY_RECIPE, red: 1 }), []);
  const activeDrawingColor =
    activeSavedColor?.mixed ??
    sampledColor ??
    (pigmentUnits > 0 ? currentMixed : fallbackColor);
  const activeDrawingColorName =
    activeSavedColor?.name ??
    sampledColor?.name ??
    (pigmentUnits > 0 ? currentMixed.name : "はじめの赤");

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => {
      setToast((current) => (current === message ? undefined : current));
    }, 2800);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadColors(),
      loadSetting<AppMode>("last-mode"),
      loadSetting<string | null>("active-color"),
      loadSetting<MixerUiSettings>("mixer-ui"),
      loadSetting<string[]>("recent-color-ids"),
    ]).then(([colors, lastMode, savedActiveColor, mixerUi, savedRecentColorIds]) => {
      if (cancelled) return;
      resetPaletteHistory(colors);
      if (lastMode && ["mix", "draw", "color"].includes(lastMode)) {
        setMode(lastMode);
      }
      if (savedActiveColor && colors.some((color) => color.id === savedActiveColor)) {
        setActiveColorId(savedActiveColor);
      }
      if (
        mixerUi &&
        MIXER_TOOL_IDS.includes(mixerUi.selectedMaterial)
      ) {
        setSelectedMaterial(mixerUi.selectedMaterial);
      }
      if (mixerUi && ["small", "medium", "large"].includes(mixerUi.paintSize)) {
        setPaintSize(mixerUi.paintSize);
      }
      if (typeof mixerUi?.detailedRecipe === "boolean") {
        setDetailedRecipe(mixerUi.detailedRecipe);
      }
      if (Array.isArray(savedRecentColorIds)) {
        setRecentColorIds(
          savedRecentColorIds
            .filter(
              (id, index, values) =>
                typeof id === "string" &&
                values.indexOf(id) === index &&
                colors.some((color) => color.id === id),
            )
            .slice(0, 12),
        );
      }
      setHydrated(true);
    }).catch(() => {
      if (cancelled) return;
      setHydrated(true);
      showToast("保存データの一部を読み込めませんでした");
    });
    return () => {
      cancelled = true;
    };
  }, [resetPaletteHistory, showToast]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1020px)");
    const updateLayout = () => {
      setCompactLayout(media.matches);
      if (!media.matches) setPaletteOpen(false);
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void saveSetting("last-mode", mode).catch(() => {
      showToast("モード設定を保存できませんでした");
    });
  }, [hydrated, mode, showToast]);

  useEffect(() => {
    if (!hydrated) return;
    void saveSetting<string | null>("active-color", activeColorId ?? null).catch(
      () => {
        showToast("選択中の色を保存できませんでした");
      },
    );
  }, [activeColorId, hydrated, showToast]);

  useEffect(() => {
    if (!hydrated) return;
    void saveSetting("recent-color-ids", recentColorIds).catch(() => {
      showToast("最近使った色を保存できませんでした");
    });
  }, [hydrated, recentColorIds, showToast]);

  useEffect(() => {
    if (!hydrated) return;
    void saveColors(savedColors).catch(() => {
      showToast("保存できませんでした。端末の空き容量をご確認ください");
    });
  }, [hydrated, savedColors, showToast]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (
        activeColorId &&
        !savedColors.some((color) => color.id === activeColorId)
      ) {
        setActiveColorId(undefined);
      }
      setRecentColorIds((current) => {
        const filtered = current.filter((id) =>
          savedColors.some((color) => color.id === id),
        );
        return filtered.length === current.length ? current : filtered;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeColorId, savedColors]);

  useEffect(() => {
    if (!hydrated) return;
    void saveSetting<MixerUiSettings>("mixer-ui", {
      selectedMaterial,
      paintSize,
      detailedRecipe,
    }).catch(() => {
      showToast("混色ツールの設定を保存できませんでした");
    });
  }, [detailedRecipe, hydrated, paintSize, selectedMaterial, showToast]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const compactPaletteOpen =
        paletteOpen && window.matchMedia("(max-width: 1020px)").matches;
      if (saveDialogOpen || detailColor || helpOpen || compactPaletteOpen) return;
      if (isEditableTarget(event.target)) return;
      if (event.altKey && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        setMode(MODES[Number(event.key) - 1].id);
        return;
      }
      if (mode === "mix" && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) mixer.redo();
        else mixer.undo();
        return;
      }
      if (mode === "mix") {
        const material = MIXER_SHORTCUTS[event.key.toLowerCase()];
        if (material) setSelectedMaterial(material);
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    detailColor,
    helpOpen,
    mixer,
    mode,
    paletteOpen,
    saveDialogOpen,
  ]);

  useEffect(() => {
    if (!helpOpen) return;
    helpPreviousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => {
      helpDialogRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (event.key !== "Tab" || !helpDialogRef.current) return;
      const focusable = [
        ...helpDialogRef.current.querySelectorAll<HTMLElement>(selector),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyboard);
      helpPreviousFocus.current?.focus();
    };
  }, [helpOpen]);

  const addMaterial = (
    material: MaterialId,
    size: PaintSize,
    x: number,
    y: number,
  ) => {
    mixer.commit((current) => ({
      ...current,
      recipe: {
        ...current.recipe,
        [material]: current.recipe[material] + 1,
      },
      steps: [
        ...current.steps,
        {
          id: createId("step"),
          material,
          size,
          x,
          y,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    const nextCount = mixer.state.recipe[material] + 1;
    const nextTotal =
      Object.values(mixer.state.recipe).reduce((sum, count) => sum + count, 0) + 1;
    setAnnouncement(
      `${MATERIAL_LABELS[material]}を1単位追加。${MATERIAL_LABELS[material]}は${nextCount}単位、合計${nextTotal}単位`,
    );
  };

  const addMaterialStroke = (
    material: MaterialId,
    size: PaintSize,
    points: Array<{ x: number; y: number }>,
  ) => {
    const placements = points.slice(0, 80);
    if (!placements.length) return;
    const createdAt = new Date().toISOString();
    mixer.commit((current) => ({
      ...current,
      recipe: {
        ...current.recipe,
        [material]: current.recipe[material] + placements.length,
      },
      steps: [
        ...current.steps,
        ...placements.map((point) => ({
          id: createId("step"),
          material,
          size,
          x: point.x,
          y: point.y,
          createdAt,
        })),
      ],
    }));
    setAnnouncement(
      `${MATERIAL_LABELS[material]}をなぞった場所へ${placements.length}単位追加しました`,
    );
  };

  const eraseNearest = (x: number, y: number) => {
    if (!mixer.state.steps.length) return;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    mixer.state.steps.forEach((step, index) => {
      const distance = Math.hypot(step.x - x, step.y - y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestIndex < 0 || nearestDistance > 0.24) {
      showToast("消したい絵の具の近くをタップしてください");
      return;
    }
    const target = mixer.state.steps[nearestIndex];
    mixer.commit((current) => ({
      ...current,
      recipe: {
        ...current.recipe,
        [target.material]: Math.max(0, current.recipe[target.material] - 1),
      },
      steps: current.steps.filter((_, index) => index !== nearestIndex),
    }));
    setAnnouncement(`${MATERIAL_LABELS[target.material]}を1単位消しました`);
  };

  const addMixGesture = (gesture: Omit<MixGesture, "id" | "createdAt">) => {
    mixer.commit((current) => ({
      ...current,
      mixGestures: [
        ...current.mixGestures,
        {
          ...gesture,
          recipe: { ...current.recipe },
          id: createId("mix"),
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setAnnouncement("絵の具をなじませました");
  };

  const mixAll = () => {
    if (!pigmentUnits) return;
    addMixGesture({
      kind: "all",
      distance: 1200,
      speed: 0.7,
      points: 16,
    });
    showToast(`${currentMixed.name}まで、なめらかに混ざりました`);
  };

  const markColorAsRecent = (id: string) => {
    setRecentColorIds((current) => [id, ...current.filter((entry) => entry !== id)].slice(0, 12));
  };

  const openSaveDialog = (sample?: SpatialPaintSample) => {
    const recipe = sample?.recipe ?? mixer.state.recipe;
    const targetPigmentUnits = PIGMENT_IDS.reduce(
      (total, pigment) => total + recipe[pigment],
      0,
    );
    if (
      !targetPigmentUnits ||
      (sample && sample.coverage <= 0.002)
    ) {
      return;
    }
    setSaveDraft({
      recipe: { ...recipe },
      mixed: cloneMixedSnapshot(sample?.mixed ?? currentMixed),
      sampled: Boolean(sample),
    });
    setSaveDialogOpen(true);
  };

  const closeSaveDialog = () => {
    setSaveDialogOpen(false);
    setSaveDraft(undefined);
  };

  const saveCurrentColor = (name: string, note: string) => {
    if (!saveDraft) return;
    const targetPigments = PIGMENT_IDS.reduce(
      (total, pigment) => total + saveDraft.recipe[pigment],
      0,
    );
    if (!targetPigments) return;
    const now = new Date().toISOString();
    const savingSample = saveDraft.sampled;
    const color: SavedColor = {
      id: createId("color"),
      name,
      note,
      recipe: { ...saveDraft.recipe },
      mixed: cloneMixedSnapshot(saveDraft.mixed),
      ...(savingSample
        ? {
            capturedAppearance: {
              hex: saveDraft.mixed.hex,
              opacity: saveDraft.mixed.opacity,
            },
          }
        : {}),
      steps: savingSample ? [] : [...mixer.state.steps],
      mixGestures: savingSample ? [] : [...mixer.state.mixGestures],
      mixMethod: savingSample
        ? "スポイト地点の局所配合"
        : (() => {
            const hasMixAll = mixer.state.mixGestures.some(
              (gesture) => gesture.kind === "all",
            );
            const hasManualMix = mixer.state.mixGestures.some(
              (gesture) => gesture.kind !== "all",
            );
            if (hasMixAll && hasManualMix) return "すべて混ぜる＋手混ぜ";
            if (hasMixAll) return "すべて混ぜる";
            if (hasManualMix) return "指やマウスでなぞって混色";
            return "絵の具を重ね置き";
          })(),
      createdAt: now,
      updatedAt: now,
      order: 0,
    };
    const next = [color, ...savedColors].map((entry, order) => ({ ...entry, order }));
    paletteHistory.commit(next);
    setActiveColorId(color.id);
    markColorAsRecent(color.id);
    setSampledColor(undefined);
    closeSaveDialog();
    showToast(
      savingSample
        ? `「${name}」をスポイト地点のレシピとして登録しました`
        : `「${name}」を保存パレットに登録しました`,
    );
  };

  const renameColor = (id: string, name: string) => {
    const next = savedColors.map((color) =>
      color.id === id
        ? { ...color, name, updatedAt: new Date().toISOString() }
        : color,
    );
    paletteHistory.commit(next);
    setDetailColor((current) => (current?.id === id ? { ...current, name } : current));
    showToast("色の名前を変更しました");
  };

  const duplicateColor = (color: SavedColor) => {
    const now = new Date().toISOString();
    const duplicate: SavedColor = {
      ...color,
      id: createId("color"),
      name: `${color.name}のコピー`,
      createdAt: now,
      updatedAt: now,
      order: 0,
    };
    const next = [duplicate, ...savedColors].map((entry, order) => ({ ...entry, order }));
    paletteHistory.commit(next);
    setActiveColorId(duplicate.id);
    markColorAsRecent(duplicate.id);
    setDetailColor(duplicate);
    showToast("色を複製しました");
  };

  const removeColor = (id: string) => {
    const next = savedColors
      .filter((color) => color.id !== id)
      .map((color, order) => ({ ...color, order }));
    paletteHistory.commit(next);
    if (activeColorId === id) setActiveColorId(undefined);
    setDetailColor(undefined);
    showToast("色を削除しました");
  };

  const reopenColor = (color: SavedColor) => {
    const steps =
      color.steps?.length > 0
        ? color.steps
        : Object.entries(color.recipe).flatMap(([material, count], materialIndex) =>
            Array.from({ length: count }, (_, index) => ({
              id: createId("step"),
              material: material as MaterialId,
              size: "medium" as PaintSize,
              x: 0.32 + ((materialIndex * 0.13 + index * 0.07) % 0.42),
              y: 0.34 + ((index * 0.11) % 0.32),
              createdAt: new Date().toISOString(),
            })),
          );
    mixer.reset({
      recipe: { ...color.recipe },
      steps,
      mixGestures: color.mixGestures ?? [],
    });
    setSelectedMaterial("red");
    setMode("mix");
    setDetailColor(undefined);
    setPaletteOpen(false);
    showToast(`「${color.name}」を混色パレットに広げました`);
  };

  const useColor = (color: SavedColor, nextMode: AppMode) => {
    setActiveColorId(color.id);
    markColorAsRecent(color.id);
    setSampledColor(undefined);
    setMode(nextMode);
    setDetailColor(undefined);
    setPaletteOpen(false);
    showToast(`「${color.name}」を選びました`);
  };

  const reorderColors = (sourceId: string, targetId: string) => {
    const sourceIndex = savedColors.findIndex((color) => color.id === sourceId);
    const targetIndex = savedColors.findIndex((color) => color.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...savedColors];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    const ordered = next.map((color, order) => ({ ...color, order }));
    paletteHistory.commit(ordered);
    showToast("パレットの順番を変更しました");
  };

  const importColors = async (file: File) => {
    try {
      if (file.size === 0 || file.size > MAX_COLOR_IMPORT_BYTES) {
        throw new Error("Recipe import file is too large");
      }
      const result = parseSavedColorsJson(await file.text());
      const seenIds = new Set(savedColors.map((color) => color.id));
      const imported = result.colors.map((color) => {
        let id = color.id;
        while (seenIds.has(id)) id = createId("color");
        seenIds.add(id);
        return { ...color, id };
      });
      const merged = [
        ...imported,
        ...savedColors,
      ].map((color, order) => ({ ...color, order }));
      paletteHistory.commit(merged);
      showToast(
        result.rejected
          ? `${imported.length}色を読み込み、${result.rejected}件は安全のため除外しました`
          : `${imported.length}色のレシピを読み込みました`,
      );
    } catch {
      showToast("このJSONは読み込めません。カラーレシピのデータを選んでください");
    }
  };

  const exportFullBackup = async () => {
    try {
      const backup = await exportAppBackup();
      downloadJson("カラーレシピ-全データ.json", backup);
      showToast("全データのバックアップを書き出しました");
    } catch {
      showToast("全データを書き出せませんでした");
    }
  };

  const importFullBackup = async (file: File) => {
    try {
      if (file.size === 0 || file.size > MAX_BACKUP_IMPORT_BYTES) {
        throw new Error("Backup import file is too large");
      }
      const result = await importAppBackup(await file.text(), { mode: "merge" });
      const restoredColors = await loadColors();
      resetPaletteHistory(restoredColors);
      showToast(
        `全データを復元しました（保存色 ${result.colors}色・作品や設定も復元）`,
      );
      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      showToast("このバックアップは復元できません。ファイルをご確認ください");
    }
  };

  const selectMode = (nextMode: AppMode) => {
    setMode(nextMode);
    setPaletteOpen(false);
  };

  const openOrFocusPalette = () => {
    if (compactLayout) {
      setPaletteOpen(true);
      return;
    }
    document.getElementById("saved-palette-panel")?.focus();
  };

  return (
    <div
      className="color-recipe-app"
      data-app-ready={hydrated ? "true" : "false"}
    >
      <header className="app-header">
        <a className="brand" href="#main" aria-label="カラーレシピ ホーム">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>カラーレシピ</strong>
            <small>COLOR RECIPE</small>
          </span>
        </a>

        <nav className="mode-tabs" aria-label="制作モード" role="tablist">
          {MODES.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                id={`${entry.id}-tab`}
                type="button"
                role="tab"
                aria-selected={mode === entry.id}
                aria-controls={`${entry.id}-panel`}
                tabIndex={mode === entry.id ? 0 : -1}
                className={mode === entry.id ? "is-selected" : ""}
                onClick={() => selectMode(entry.id)}
                onKeyDown={(event) => {
                  const currentIndex = MODES.findIndex(
                    (candidate) => candidate.id === entry.id,
                  );
                  let nextIndex = currentIndex;
                  if (event.key === "ArrowRight") {
                    nextIndex = (currentIndex + 1) % MODES.length;
                  } else if (event.key === "ArrowLeft") {
                    nextIndex = (currentIndex - 1 + MODES.length) % MODES.length;
                  } else if (event.key === "Home") {
                    nextIndex = 0;
                  } else if (event.key === "End") {
                    nextIndex = MODES.length - 1;
                  } else {
                    return;
                  }
                  event.preventDefault();
                  selectMode(MODES[nextIndex].id);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [nextIndex]?.focus();
                }}
                data-testid={`mode-${entry.id}`}
              >
                <Icon size={19} aria-hidden={true} />
                <span>
                  <strong>{entry.label}</strong>
                  <small>{entry.description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="header-actions">
          <div className="mobile-history">
            <button
              type="button"
              aria-label="元に戻す"
              disabled={mode !== "mix" || !mixer.canUndo}
              onClick={mixer.undo}
            >
              <Undo2 size={19} />
            </button>
            <button
              type="button"
              aria-label="やり直す"
              disabled={mode !== "mix" || !mixer.canRedo}
              onClick={mixer.redo}
            >
              <Redo2 size={19} />
            </button>
          </div>
          <button
            className="palette-toggle"
            type="button"
            aria-label={
              compactLayout
                ? `保存パレットを${paletteOpen ? "閉じる" : "開く"}。${savedColors.length}色`
                : `保存パレットへ移動。${savedColors.length}色`
            }
            aria-expanded={compactLayout ? paletteOpen : undefined}
            aria-controls="saved-palette-panel"
            onClick={() => {
              if (compactLayout) setPaletteOpen((open) => !open);
              else openOrFocusPalette();
            }}
            data-testid="palette-toggle"
          >
            <Palette size={19} aria-hidden="true" />
            <span className="palette-toggle__label">保存パレット</span>
            <span className="palette-count">{savedColors.length}</span>
            <Menu className="mobile-menu-icon" size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="app-content">
        <main id="main" className="main-stage">
          <section
            id="mix-panel"
            role="tabpanel"
            aria-labelledby="mix-tab"
            hidden={mode !== "mix"}
          >
            {mode === "mix" && (
              <MixingStudio
                state={mixer.state}
                mixed={currentMixed}
                selectedMaterial={selectedMaterial}
                size={paintSize}
                detailed={detailedRecipe}
                canUndo={mixer.canUndo}
                canRedo={mixer.canRedo}
                announcement={announcement}
                onSelectMaterial={setSelectedMaterial}
                onSizeChange={setPaintSize}
                onAdd={addMaterial}
                onAddStroke={addMaterialStroke}
                onErase={eraseNearest}
                onMix={addMixGesture}
                onMixAll={mixAll}
                onClear={() => {
                  mixer.commit(INITIAL_MIXER);
                  setAnnouncement("混色パレットをまっさらにしました");
                }}
                onUndo={mixer.undo}
                onRedo={mixer.redo}
                onToggleDetailed={() => setDetailedRecipe((value) => !value)}
                onHelp={() => setHelpOpen(true)}
                onRegisterColor={openSaveDialog}
              />
            )}
          </section>
          <section
            id="draw-panel"
            role="tabpanel"
            aria-labelledby="draw-tab"
            hidden={mode !== "draw"}
          >
            {mode === "draw" && (
              <DrawingStudio
                color={activeDrawingColor}
                colorName={activeDrawingColorName}
                onOpenPalette={openOrFocusPalette}
                onSampleColor={(hex) => {
                  setSampledColor(snapshotFromHex(hex));
                  setActiveColorId(undefined);
                  showToast("スポイトで色を取りました");
                }}
              />
            )}
          </section>
          <section
            id="color-panel"
            role="tabpanel"
            aria-labelledby="color-tab"
            hidden={mode !== "color"}
          >
            {mode === "color" && (
              <ColoringStudio
                color={activeDrawingColor}
                colorName={activeDrawingColorName}
                onOpenPalette={openOrFocusPalette}
              />
            )}
          </section>
        </main>

        <SavedPalette
          colors={savedColors}
          selectedId={activeColorId}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onSelect={(color) => {
            setActiveColorId(color.id);
            setSampledColor(undefined);
            showToast(`「${color.name}」を選びました。もう一度押すと詳細を開きます`);
          }}
          onOpenDetails={(color) => {
            if (compactLayout) setPaletteOpen(false);
            setDetailColor(color);
          }}
          onReorder={reorderColors}
          canUndo={paletteHistory.canUndo}
          canRedo={paletteHistory.canRedo}
          onUndo={() => {
            paletteHistory.undo();
            showToast("保存パレットの操作を元に戻しました");
          }}
          onRedo={() => {
            paletteHistory.redo();
            showToast("保存パレットの操作をやり直しました");
          }}
          onExport={() =>
            downloadJson("カラーレシピ-保存色.json", {
              app: "カラーレシピ",
              version: SAVED_COLOR_SCHEMA_VERSION,
              exportedAt: new Date().toISOString(),
              colors: savedColors,
            })
          }
          onImport={importColors}
          onExportBackup={() => {
            void exportFullBackup();
          }}
          onImportBackup={(file) => {
            void importFullBackup(file);
          }}
        />
      </div>

      {saveDialogOpen && saveDraft && (
        <SaveColorDialog
          open
          mixed={saveDraft.mixed}
          recipe={saveDraft.recipe}
          sampled={saveDraft.sampled}
          onClose={closeSaveDialog}
          onSave={saveCurrentColor}
        />
      )}
      {detailColor && (
        <ColorDetailDialog
          color={detailColor}
          onClose={() => setDetailColor(undefined)}
          onRename={renameColor}
          onDuplicate={duplicateColor}
          onDelete={removeColor}
          onReopen={reopenColor}
          onUse={useColor}
        />
      )}
      {helpOpen && (
        <div className="dialog-layer" role="presentation" onMouseDown={() => setHelpOpen(false)}>
          <section
            ref={helpDialogRef}
            className="dialog-card help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="icon-button dialog-close"
              aria-label="閉じる"
              onClick={() => setHelpOpen(false)}
            >
              <X size={20} />
            </button>
            <p className="eyebrow">
              <HelpCircle size={14} /> 使い方
            </p>
            <h2 id="help-title">3つの手順で、自分だけの色</h2>
            <div className="help-video">
              <video
                controls
                playsInline
                preload="metadata"
                poster="/tutorial/color-recipe-tutorial-poster.webp"
              >
                <source
                  src="/tutorial/color-recipe-tutorial.mp4"
                  type="video/mp4"
                />
                <track
                  kind="captions"
                  src="/tutorial/color-recipe-tutorial.ja.vtt"
                  srcLang="ja"
                  label="日本語"
                  default
                />
                お使いのブラウザは動画再生に対応していません。
              </video>
              <p>約65秒で、混色から作品・データ保存まで確認できます。</p>
            </div>
            <ol className="help-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>絵の具を選ぶ</strong>
                  <p>赤・青・黄・白・水から、置きたい材料を選びます。</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>パレットをタップ</strong>
                  <p>1回で1単位。小・中・大は見た目の広がりだけが変わります。</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>なぞって混ぜる</strong>
                  <p>速く動かすと広く、ゆっくり動かすと丁寧に混ざります。</p>
                </div>
              </li>
            </ol>
            <div className="shortcut-note">
              <kbd>⌘ Z</kbd>
              <span>元に戻す</span>
              <kbd>Alt 1–3</kbd>
              <span>モードを切り替える</span>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={() => setHelpOpen(false)}
            >
              やってみる <ChevronRight size={17} />
            </button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} aria-hidden="true" />
          {toast}
        </div>
      )}
    </div>
  );
}
