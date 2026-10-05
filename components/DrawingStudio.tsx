"use client";

import {
  Blend,
  Brush,
  Circle,
  Download,
  Droplets,
  Eraser,
  Eye,
  EyeOff,
  Grid2X2Plus,
  Highlighter,
  Layers3,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  SprayCan,
  Square,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  applyStamp,
  beginStrokeDynamics,
  completeTap,
  nextSpacing,
  strokeSpacing,
  wetSettleOptions,
  type BrushDynamicsSettings,
  type PaintLoad,
  type StrokeDynamicsState,
} from "../lib/brushDynamics";
import { hexToRgb } from "../lib/colorScience";
import { floodFillImageData, type PixelBounds } from "../lib/paintEngine";
import {
  applyPigmentPatch,
  capturePigmentPatch,
  clearPigmentField,
  createPigmentField,
  createStrokeShadow,
  expandBounds,
  shadowBeforeWrite,
  shadowPatch,
  fillPigmentRegion,
  fullBounds,
  massForCoverage,
  pigmentPatchBytes,
  pigmentVectorFromRatio,
  ratioFromPigmentVector,
  resamplePigmentField,
  settleMargin,
  settleWetPaint,
  samplePigmentLayers,
  unionBounds,
  wetBounds,
  type PigmentField,
  type PigmentPatch,
  type StrokeShadow,
} from "../lib/pigmentField";
import { pigmentsFromRgb } from "../lib/pigmentInverse";
import { advancePaintDrying, PAINT_DRYING_INTERVAL_MS } from "../lib/paintDrying";
import {
  decodeStoredPigmentField,
  renderCompositeToCanvas,
  snapshotPigmentLayer,
} from "../lib/pigmentLayer";
import {
  loadArtwork,
  loadSetting,
  saveArtwork,
  saveSetting,
} from "../lib/storage";
import {
  appendStrokeSamples,
  beginStrokeSampling,
  finishStrokeSampling,
  stabilizeStrokePoint,
  type StrokePoint,
  type StrokeSamplerState,
} from "../lib/strokeSampling";
import type {
  BrushSettings as UiBrushSettings,
  BrushTool,
  DrawingLayer,
  ExactPaint,
  MixedColorSnapshot,
  PigmentId,
} from "../lib/types";
import {
  CanvasZoomControls,
  useCanvasPan,
  useCanvasViewport,
} from "./CanvasViewport";
import { CurrentPaintPicker } from "./CurrentPaintPicker";

export type SampledPaint = {
  pigmentRatio: Record<PigmentId, number>;
  waterRatio: number;
  /** Display bytes of the sampled pixel, so the swatch matches exactly. */
  rgb: { r: number; g: number; b: number };
  /** The films producing the visible pixel, including their layer opacity. */
  exactPaint?: ExactPaint;
};

type DrawingStudioProps = {
  color: MixedColorSnapshot;
  colorName: string;
  onOpenPalette: () => void;
  onSampleColor: (sample: SampledPaint) => void;
};

type HistoryEntry =
  | {
      kind: "canvas";
      layerId: string;
      before: PigmentPatch;
      after: PigmentPatch;
      label: string;
    }
  | {
      kind: "document";
      before: StoredArtwork;
      after: StoredArtwork;
      label: string;
    };

type StoredArtwork = {
  layers: DrawingLayer[];
  width: number;
  height: number;
  background: string;
  activeLayerId?: string;
};

type StoredDrawingSettings = {
  version?: number;
  tool: BrushTool;
  brush: UiBrushSettings;
};

type ActiveStroke = {
  layerId: string;
  sampler: StrokeSamplerState;
  dynamics: StrokeDynamicsState;
  settings: BrushDynamicsSettings;
  spacing: number;
  /** Lazily records the paint under the stroke for undo. */
  shadow: StrokeShadow;
  bounds: PixelBounds | null;
};

const TOOL_OPTIONS: Array<{
  id: BrushTool;
  label: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}> = [
  { id: "round", label: "丸筆", icon: Brush },
  { id: "flat", label: "平筆", icon: Square },
  { id: "pencil", label: "鉛筆", icon: Pencil },
  { id: "watercolor", label: "水彩筆", icon: Droplets },
  { id: "airbrush", label: "エアブラシ", icon: SprayCan },
  { id: "marker", label: "マーカー", icon: Highlighter },
  { id: "eyedropper", label: "スポイト", icon: MousePointer2 },
  { id: "eraser", label: "消しゴム", icon: Eraser },
  { id: "fill", label: "塗りつぶし", icon: Grid2X2Plus },
  { id: "blur", label: "ぼかし", icon: WandSparkles },
  { id: "mixer", label: "混色ブラシ", icon: Blend },
];

const LEGACY_DEFAULT_SETTINGS: UiBrushSettings = {
  size: 34,
  opacity: 84,
  pressure: 72,
  water: 28,
  bleed: 18,
  hardness: 64,
  spacing: 16,
  stabilization: 30,
};

const DEFAULT_SETTINGS: UiBrushSettings = {
  ...LEGACY_DEFAULT_SETTINGS,
  opacity: 100,
  water: 0,
  bleed: 0,
  hardness: 82,
};

const DRAWING_SETTINGS_VERSION = 2;

function isUnchangedLegacyBrush(brush: UiBrushSettings) {
  return (
    Object.entries(LEGACY_DEFAULT_SETTINGS) as Array<
      [keyof UiBrushSettings, number]
    >
  ).every(([key, value]) => brush[key] === value);
}

const CANVAS_SIZES = {
  landscape: { width: 1000, height: 700, label: "よこ長" },
  square: { width: 820, height: 820, label: "ましかく" },
  portrait: { width: 700, height: 1000, label: "たて長" },
};

/** Undo memory budget for pigment patches (bytes). */
const HISTORY_BYTE_BUDGET = 160 * 1024 * 1024;
const HISTORY_ENTRY_LIMIT = 30;

function newLayer(index: number): DrawingLayer {
  return {
    id: `layer-${Date.now()}-${index}`,
    name: `レイヤー ${index}`,
    visible: true,
    opacity: 100,
  };
}

function paintLoadFromColor(color: MixedColorSnapshot): PaintLoad {
  let pigment = pigmentVectorFromRatio(color.pigmentRatio ?? {});
  let total = 0;
  for (const value of pigment) total += value;
  if (total <= 0) {
    // Colours without a recipe (typed HEX) get their closest paint match.
    pigment = pigmentsFromRgb(hexToRgb(color.hex));
  }
  return {
    pigment,
    waterRatio: Math.min(0.97, Math.max(0, color.waterRatio ?? 0)),
    opacity: Math.min(1, Math.max(0.02, color.opacity ?? 1)),
    opticalMass: color.exactPaint?.opticalMass,
    opticalStack: color.exactPaint?.opticalStack,
  };
}

function coalescedPointerSamples(
  event: React.PointerEvent<HTMLDivElement>,
): PointerEvent[] {
  const nativeEvent = event.nativeEvent;
  if (typeof nativeEvent.getCoalescedEvents !== "function") {
    return [nativeEvent];
  }
  try {
    const samples = nativeEvent.getCoalescedEvents();
    return samples.length > 0 ? samples : [nativeEvent];
  } catch {
    // Older WebViews can expose this method without implementing it.
    return [nativeEvent];
  }
}

export function DrawingStudio({
  color,
  colorName,
  onOpenPalette,
  onSampleColor,
}: DrawingStudioProps) {
  const [tool, setTool] = useState<BrushTool>("round");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layers, setLayers] = useState<DrawingLayer[]>([newLayer(1)]);
  const [activeLayerId, setActiveLayerId] = useState<string>();
  const [background, setBackground] = useState("#ffffff");
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 700 });
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "error"
  >("saved");
  const [zoom, setZoom] = useState(100);
  const [panEnabled, setPanEnabled] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const mobileInspector = useRef<HTMLElement>(null);
  const mobileInspectorToggle = useRef<HTMLButtonElement>(null);
  /** The one canvas on screen: every layer composited over the paper. */
  const displayCanvas = useRef<HTMLCanvasElement>(null);
  const fields = useRef(new Map<string, PigmentField>());
  const loadedUrls = useRef(new Map<string, string>());
  const loadGenerations = useRef(new Map<string, number>());
  const pendingLoads = useRef(new Set<string>());
  const activePointer = useRef<number | undefined>(undefined);
  const stroke = useRef<ActiveStroke | null>(null);
  const resizeInFlight = useRef(false);
  const layerOpacityStart = useRef<
    { layerId: string; before: StoredArtwork } | undefined
  >(undefined);
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [historyAvailability, setHistoryAvailability] = useState({
    undo: 0,
    redo: 0,
  });
  const hydrated = useRef(false);
  const pendingCommits = useRef(new Set<string>());
  const commitTimer = useRef<number | undefined>(undefined);
  const wetRegions = useRef(new Map<string, PixelBounds>());
  const dryingTimer = useRef<number | undefined>(undefined);
  const dryingLastTime = useRef(0);
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];
  const {
    viewportRef,
    stageStyle,
    changeZoomAroundCenter,
  } = useCanvasViewport({
    intrinsicWidth: canvasSize.width,
    intrinsicHeight: canvasSize.height,
    zoom,
  });
  const { handlers: panHandlers, isPanning } = useCanvasPan(
    viewportRef,
    panEnabled,
  );

  const changeZoom = useCallback(
    (nextZoom: number) => {
      if (nextZoom <= 100) setPanEnabled(false);
      changeZoomAroundCenter(nextZoom, setZoom);
    },
    [changeZoomAroundCenter],
  );

  const refreshHistory = useCallback(() => {
    setHistoryAvailability({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadArtwork<StoredArtwork>("main"),
      loadSetting<StoredDrawingSettings>("drawing-tools"),
    ])
      .then(([stored, storedSettings]) => {
        if (cancelled) return;
        if (stored?.layers?.length) {
          setLayers(stored.layers);
          setActiveLayerId(
            stored.activeLayerId &&
              stored.layers.some((layer) => layer.id === stored.activeLayerId)
              ? stored.activeLayerId
              : stored.layers[stored.layers.length - 1].id,
          );
        }
        if (stored?.width && stored.height) {
          setCanvasSize({ width: stored.width, height: stored.height });
        }
        if (stored?.background) setBackground(stored.background);
        if (
          storedSettings?.tool &&
          TOOL_OPTIONS.some((entry) => entry.id === storedSettings.tool)
        ) {
          setTool(storedSettings.tool);
        }
        if (storedSettings?.brush) {
          const shouldMigrateLegacyDefaults =
            (storedSettings.version ?? 1) < DRAWING_SETTINGS_VERSION &&
            isUnchangedLegacyBrush(storedSettings.brush);
          setSettings(
            shouldMigrateLegacyDefaults
              ? DEFAULT_SETTINGS
              : { ...DEFAULT_SETTINGS, ...storedSettings.brush },
          );
        }
      })
      .finally(() => {
        hydrated.current = true;
        if (!cancelled) setSettingsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Latest layer stack and paper colour for the renderer, without making the
  // render callback change identity on every edit.
  const layerStack = useRef(layers);
  const latestDocument = useRef<StoredArtwork>({
    layers,
    width: canvasSize.width,
    height: canvasSize.height,
    background,
    activeLayerId,
  });
  const paperColour = useRef(background);
  useEffect(() => {
    layerStack.current = layers;
    paperColour.current = background;
    latestDocument.current = {
      layers,
      width: canvasSize.width,
      height: canvasSize.height,
      background,
      activeLayerId,
    };
  }, [activeLayerId, background, canvasSize, layers]);

  /**
   * Redraws `bounds` (or everything) of the picture: all visible layers
   * composited over the paper in linear light, from the pigment fields.
   */
  const renderView = useCallback((bounds: PixelBounds | null) => {
    const canvas = displayCanvas.current;
    if (!canvas) return;
    const sources = layerStack.current.flatMap((layer) => {
      const field = fields.current.get(layer.id);
      if (!field || !layer.visible) return [];
      if (field.width !== canvas.width || field.height !== canvas.height) return [];
      return [{ kind: "paint" as const, field, opacity: layer.opacity / 100 }];
    });
    let paper: { r: number; g: number; b: number };
    try {
      paper = hexToRgb(paperColour.current);
    } catch {
      paper = { r: 255, g: 253, b: 248 };
    }
    renderCompositeToCanvas(canvas, paper, sources, bounds);
  }, []);

  // Layer order, visibility, opacity and the paper colour change what the
  // composite looks like without touching any field.
  const stackSignature = `${background}|${canvasSize.width}x${canvasSize.height}|${layers
    .map((layer) => `${layer.id}:${layer.visible ? 1 : 0}:${layer.opacity}`)
    .join(",")}`;
  useEffect(() => {
    renderView(null);
  }, [renderView, stackSignature]);

  const persist = useCallback(
    async (nextLayers: DrawingLayer[]) => {
      setSaveState("saving");
      try {
        await saveArtwork("main", {
          layers: nextLayers,
          width: canvasSize.width,
          height: canvasSize.height,
          background,
          activeLayerId,
        } satisfies StoredArtwork);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [activeLayerId, background, canvasSize.height, canvasSize.width],
  );

  useEffect(() => {
    if (!hydrated.current) return;
    const timer = window.setTimeout(() => {
      void persist(layers);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [layers, persist]);

  useEffect(() => {
    if (!settingsHydrated) return;
    const timer = window.setTimeout(() => {
      void saveSetting<StoredDrawingSettings>("drawing-tools", {
        version: DRAWING_SETTINGS_VERSION,
        tool,
        brush: settings,
      }).catch(() => setSaveState("error"));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [settings, settingsHydrated, tool]);

  const getField = useCallback(
    (layerId: string): PigmentField => {
      const existing = fields.current.get(layerId);
      if (
        existing &&
        existing.width === canvasSize.width &&
        existing.height === canvasSize.height
      ) {
        return existing;
      }
      const field = createPigmentField(canvasSize.width, canvasSize.height);
      fields.current.set(layerId, field);
      return field;
    },
    [canvasSize.height, canvasSize.width],
  );

  /**
   * Encodes changed layers for storage a moment after the interaction so
   * the stroke itself never waits on PNG encoding.
   */
  const scheduleCommit = useCallback((layerId: string) => {
    pendingCommits.current.add(layerId);
    if (commitTimer.current !== undefined) return;
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = undefined;
      const ids = [...pendingCommits.current];
      pendingCommits.current.clear();
      const snapshots = new Map<string, ReturnType<typeof snapshotPigmentLayer>>();
      ids.forEach((id) => {
        const field = fields.current.get(id);
        if (!field) return;
        snapshots.set(id, snapshotPigmentLayer(field));
      });
      if (!snapshots.size) return;
      setLayers((current) =>
        current.map((layer) => {
          const snapshot = snapshots.get(layer.id);
          const field = fields.current.get(layer.id);
          if (!snapshot || !field) return layer;
          loadedUrls.current.set(
            layer.id,
            `${field.width}x${field.height}:${snapshot.dataUrl}`,
          );
          return {
            ...layer,
            dataUrl: snapshot.dataUrl,
            pigmentDataUrls: snapshot.pigmentDataUrls,
            pigmentSavedAt: snapshot.pigmentSavedAt,
          };
        }),
      );
    }, 60);
  }, []);

  // A mode switch can unmount the studio before either debounce has run.
  const flushPendingPaint = useCallback(() => {
    if (!hydrated.current) return;
    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = undefined;
    }
    pendingCommits.current.clear();
    const document = latestDocument.current;
    const savedLayers = document.layers.map((layer) => {
      const field = fields.current.get(layer.id);
      if (!field || pendingLoads.current.has(layer.id)) return layer;
      return { ...layer, ...snapshotPigmentLayer(field) };
    });
    void saveArtwork("main", { ...document, layers: savedLayers }).catch(() => {});
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", flushPendingPaint);
    return () => {
      window.removeEventListener("pagehide", flushPendingPaint);
      flushPendingPaint();
    };
  }, [flushPendingPaint]);

  const stopDrying = useCallback(() => {
    if (dryingTimer.current !== undefined) {
      window.clearInterval(dryingTimer.current);
      dryingTimer.current = undefined;
    }
  }, []);

  const ensureDrying = useCallback(() => {
    if (dryingTimer.current !== undefined) return;
    dryingLastTime.current = Date.now();
    dryingTimer.current = window.setInterval(() => {
      if (!wetRegions.current.size) {
        stopDrying();
        return;
      }
      const now = Date.now();
      const previousTime = dryingLastTime.current;
      dryingLastTime.current = now;
      wetRegions.current.forEach((bounds, layerId) => {
        const field = fields.current.get(layerId);
        if (!field) {
          wetRegions.current.delete(layerId);
          return;
        }
        const stillWet = advancePaintDrying(field, previousTime, now, bounds);
        renderView(bounds);
        if (stillWet) wetRegions.current.set(layerId, stillWet);
        else {
          wetRegions.current.delete(layerId);
          scheduleCommit(layerId);
        }
      });
    }, PAINT_DRYING_INTERVAL_MS);
  }, [renderView, scheduleCommit, stopDrying]);

  useEffect(() => () => stopDrying(), [stopDrying]);

  const markWet = useCallback(
    (layerId: string, bounds: PixelBounds | null) => {
      if (!bounds) return;
      wetRegions.current.set(
        layerId,
        unionBounds(wetRegions.current.get(layerId), bounds) ?? bounds,
      );
      ensureDrying();
    },
    [ensureDrying],
  );

  /**
   * Keeps each layer's pigment field in step with its stored data. Fields
   * are only rebuilt when the stored data changed underneath us (hydration,
   * document undo, resize); strokes update the field directly.
   */
  useEffect(() => {
    let touched = false;
    layers.forEach((layer) => {
      const token = `${canvasSize.width}x${canvasSize.height}:${layer.dataUrl ?? ""}`;
      if (loadedUrls.current.get(layer.id) === token) return;
      loadedUrls.current.set(layer.id, token);
      const generation = (loadGenerations.current.get(layer.id) ?? 0) + 1;
      loadGenerations.current.set(layer.id, generation);
      if (!layer.dataUrl && !layer.pigmentDataUrls) {
        const field = createPigmentField(canvasSize.width, canvasSize.height);
        fields.current.set(layer.id, field);
        touched = true;
        return;
      }
      pendingLoads.current.add(layer.id);
      void decodeStoredPigmentField(layer, canvasSize.width, canvasSize.height)
        .then((field) => {
          if (loadGenerations.current.get(layer.id) !== generation) return;
          fields.current.set(layer.id, field);
          markWet(layer.id, wetBounds(field));
          renderView(null);
        })
        .catch(() => {
          if (loadGenerations.current.get(layer.id) !== generation) return;
          const field = createPigmentField(canvasSize.width, canvasSize.height);
          fields.current.set(layer.id, field);
          renderView(null);
        })
        .finally(() => {
          if (loadGenerations.current.get(layer.id) === generation) {
            pendingLoads.current.delete(layer.id);
          }
        });
    });
    if (touched) renderView(null);
  }, [canvasSize, layers, markWet, renderView]);

  const trimHistory = useCallback(() => {
    let bytes = 0;
    const entries = undoStack.current;
    for (const entry of entries) {
      if (entry.kind === "canvas") {
        bytes += pigmentPatchBytes(entry.before) + pigmentPatchBytes(entry.after);
      }
    }
    while (
      entries.length > HISTORY_ENTRY_LIMIT ||
      (bytes > HISTORY_BYTE_BUDGET && entries.length > 1)
    ) {
      const dropped = entries.shift();
      if (dropped?.kind === "canvas") {
        bytes -= pigmentPatchBytes(dropped.before) + pigmentPatchBytes(dropped.after);
      }
    }
  }, []);

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      undoStack.current = [...undoStack.current, entry];
      redoStack.current = [];
      trimHistory();
      refreshHistory();
    },
    [refreshHistory, trimHistory],
  );

  const captureDocument = useCallback(
    (): StoredArtwork => ({
      layers: layers.map((layer) => {
        const field = fields.current.get(layer.id);
        if (!field) return { ...layer };
        const snapshot = snapshotPigmentLayer(field);
        return {
          ...layer,
          dataUrl: snapshot.dataUrl,
          pigmentDataUrls: snapshot.pigmentDataUrls,
          pigmentSavedAt: snapshot.pigmentSavedAt,
        };
      }),
      width: canvasSize.width,
      height: canvasSize.height,
      background,
      activeLayerId: activeLayer?.id,
    }),
    [
      activeLayer?.id,
      background,
      canvasSize.height,
      canvasSize.width,
      layers,
    ],
  );

  const restorePatch = useCallback(
    (layerId: string, patch: PigmentPatch) => {
      const field = fields.current.get(layerId);
      if (!field) return;
      applyPigmentPatch(field, patch);
      renderView(patch.bounds);
      markWet(layerId, wetBounds(field, patch.bounds));
      scheduleCommit(layerId);
    },
    [markWet, renderView, scheduleCommit],
  );

  const restoreDocumentHistory = useCallback((restored: StoredArtwork) => {
    loadedUrls.current.clear();
    wetRegions.current.clear();
    setCanvasSize({ width: restored.width, height: restored.height });
    setBackground(restored.background);
    setLayers(restored.layers.map((layer) => ({ ...layer })));
    setActiveLayerId(
      restored.activeLayerId &&
        restored.layers.some((layer) => layer.id === restored.activeLayerId)
        ? restored.activeLayerId
        : restored.layers[restored.layers.length - 1]?.id,
    );
  }, []);

  const undo = useCallback(() => {
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry);
    if (entry.kind === "canvas") {
      restorePatch(entry.layerId, entry.before);
    } else {
      restoreDocumentHistory(entry.before);
    }
    refreshHistory();
  }, [refreshHistory, restoreDocumentHistory, restorePatch]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    if (entry.kind === "canvas") {
      restorePatch(entry.layerId, entry.after);
    } else {
      restoreDocumentHistory(entry.after);
    }
    refreshHistory();
  }, [refreshHistory, restoreDocumentHistory, restorePatch]);

  const changeLayers = useCallback(
    (
      nextLayers: DrawingLayer[],
      label: string,
      nextActiveLayerId = activeLayerId,
    ) => {
      const before = captureDocument();
      const currentData = new Map(
        before.layers.map((layer) => [layer.id, layer]),
      );
      const after: StoredArtwork = {
        ...before,
        layers: nextLayers.map((layer) => {
          const stored = currentData.get(layer.id);
          return {
            ...layer,
            dataUrl: stored?.dataUrl ?? layer.dataUrl,
            pigmentDataUrls: stored?.pigmentDataUrls ?? layer.pigmentDataUrls,
          };
        }),
        activeLayerId: nextActiveLayerId,
      };
      pushHistory({
        kind: "document",
        before,
        after,
        label,
      });
      after.layers.forEach((layer) => {
        loadedUrls.current.set(
          layer.id,
          `${canvasSize.width}x${canvasSize.height}:${layer.dataUrl ?? ""}`,
        );
      });
      setLayers(after.layers);
      setActiveLayerId(nextActiveLayerId);
    },
    [activeLayerId, canvasSize.height, canvasSize.width, captureDocument, pushHistory],
  );

  const changeActiveLayer = useCallback(
    (nextActiveLayerId: string) => {
      if (nextActiveLayerId === activeLayer?.id) return;
      const before = captureDocument();
      const after = { ...before, activeLayerId: nextActiveLayerId };
      pushHistory({
        kind: "document",
        before,
        after,
        label: "作業レイヤーを変更",
      });
      setActiveLayerId(nextActiveLayerId);
    },
    [activeLayer?.id, captureDocument, pushHistory],
  );

  const changeBackground = useCallback(
    (nextBackground: string) => {
      if (nextBackground === background) return;
      const before = captureDocument();
      const after = { ...before, background: nextBackground };
      pushHistory({
        kind: "document",
        before,
        after,
        label: "背景色を変更",
      });
      setBackground(nextBackground);
    },
    [background, captureDocument, pushHistory],
  );

  const beginLayerOpacityChange = useCallback(
    (layerId: string) => {
      if (layerOpacityStart.current?.layerId === layerId) return;
      layerOpacityStart.current = {
        layerId,
        before: captureDocument(),
      };
    },
    [captureDocument],
  );

  const finishLayerOpacityChange = useCallback(() => {
    const transaction = layerOpacityStart.current;
    if (!transaction) return;
    layerOpacityStart.current = undefined;
    const after = captureDocument();
    const beforeOpacity = transaction.before.layers.find(
      (layer) => layer.id === transaction.layerId,
    )?.opacity;
    const afterOpacity = after.layers.find(
      (layer) => layer.id === transaction.layerId,
    )?.opacity;
    if (beforeOpacity === afterOpacity) return;
    pushHistory({
      kind: "document",
      before: transaction.before,
      after,
      label: "レイヤーの不透明度を変更",
    });
  }, [captureDocument, pushHistory]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [redo, undo]);

  useEffect(() => {
    if (!mobileInspectorOpen) return;
    const panel = mobileInspector.current;
    const trigger = mobileInspectorToggle.current;
    const selector =
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => {
      panel?.querySelector<HTMLElement>(selector)?.focus();
    });
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileInspectorOpen(false);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(selector)];
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
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyboard);
      trigger?.focus();
    };
  }, [mobileInspectorOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const closeOutsideMobile = () => {
      if (!media.matches) setMobileInspectorOpen(false);
    };
    closeOutsideMobile();
    media.addEventListener("change", closeOutsideMobile);
    return () => media.removeEventListener("change", closeOutsideMobile);
  }, []);

  const canvasPoint = (event: PointerEvent, rect: DOMRect): StrokePoint => {
    const pressure =
      event.pressure > 0
        ? event.pressure
        : event.pointerType === "mouse"
          ? 0.5
          : 0.35;
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvasSize.width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvasSize.height,
      pressure,
      time: event.timeStamp,
    };
  };

  const dynamicsSettings = (): BrushDynamicsSettings => ({
    size: settings.size,
    opacity: settings.opacity / 100,
    pressureSensitivity: settings.pressure / 100,
    water: settings.water / 100,
    bleed: settings.bleed / 100,
    hardness: settings.hardness / 100,
    spacing: settings.spacing / 100,
  });

  /**
   * Flood-fills the visible region under the tap — read from the very pixels
   * on screen — and lays body paint of the current colour on the active
   * layer there.
   */
  const fillAt = useCallback(
    (layerId: string, point: StrokePoint) => {
      const field = getField(layerId);
      const composite = displayCanvas.current;
      const compositeContext = composite?.getContext("2d", {
        willReadFrequently: true,
      });
      if (!composite || !compositeContext) return false;
      const imageData = compositeContext.getImageData(
        0,
        0,
        composite.width,
        composite.height,
      );
      const before = new Uint8ClampedArray(imageData.data);
      const rgb = hexToRgb(color.hex);
      const result = floodFillImageData(
        imageData,
        point.x,
        point.y,
        [rgb.r, rgb.g, rgb.b, 255],
        {
          tolerance: 28,
          alphaTolerance: 38,
          gapGuardRadius: 1,
          maxPixels: imageData.width * imageData.height,
        },
      );
      if (!result.changedPixels || !result.bounds) return false;
      const bounds = result.bounds;
      const mask = new Uint8Array(bounds.width * bounds.height);
      for (let y = 0; y < bounds.height; y += 1) {
        for (let x = 0; x < bounds.width; x += 1) {
          const offset = ((bounds.y + y) * imageData.width + bounds.x + x) * 4;
          if (
            imageData.data[offset] !== before[offset] ||
            imageData.data[offset + 1] !== before[offset + 1] ||
            imageData.data[offset + 2] !== before[offset + 2] ||
            imageData.data[offset + 3] !== before[offset + 3]
          ) {
            mask[y * bounds.width + x] = 1;
          }
        }
      }
      const paint = paintLoadFromColor(color);
      const beforePatch = capturePigmentPatch(field, bounds);
      fillPigmentRegion(
        field,
        bounds,
        mask,
        paint.pigment,
        massForCoverage(
          Math.min(0.995, paint.opacity * (settings.opacity / 100)),
          paint.pigment,
        ),
        paint.waterRatio * 0.5,
      );
      const afterPatch = capturePigmentPatch(field, bounds);
      renderView(bounds);
      if (beforePatch && afterPatch) {
        pushHistory({
          kind: "canvas",
          layerId,
          before: beforePatch,
          after: afterPatch,
          label: "塗りつぶし",
        });
      }
      scheduleCommit(layerId);
      markWet(layerId, wetBounds(field, bounds));
      return true;
    },
    [
      color,
      getField,
      markWet,
      pushHistory,
      renderView,
      scheduleCommit,
      settings.opacity,
    ],
  );

  /** Samples the complete visible film stack and the actual displayed bytes. */
  const sampleAt = (point: StrokePoint) => {
    const x = Math.max(0, Math.min(canvasSize.width - 1, Math.floor(point.x)));
    const y = Math.max(0, Math.min(canvasSize.height - 1, Math.floor(point.y)));
    const canvas = displayCanvas.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    const bytes = context.getImageData(x, y, 1, 1).data;
    const rgb = { r: bytes[0], g: bytes[1], b: bytes[2] };
    let paper: { r: number; g: number; b: number };
    try {
      paper = hexToRgb(background);
    } catch {
      paper = { r: 255, g: 253, b: 248 };
    }
    const sources = layers.flatMap((layer) => {
      const field = fields.current.get(layer.id);
      if (!field || !layer.visible || layer.opacity <= 0) return [];
      return [{ kind: "paint" as const, field, opacity: layer.opacity / 100 }];
    });
    const sampled = samplePigmentLayers(paper, sources, x, y);
    const pigment = pigmentVectorFromRatio(sampled.exactPaint.weights);
    const pigmentMass = Object.entries(sampled.exactPaint.weights)
      .reduce((total, [material, amount]) => material === "water" ? total : total + amount, 0);
    const water = sampled.exactPaint.weights.water;
    onSampleColor({
      pigmentRatio: ratioFromPigmentVector(pigmentMass > 0 ? pigment : pigmentsFromRgb(rgb)),
      waterRatio: pigmentMass + water > 0 ? water / (pigmentMass + water) : 0,
      rgb,
      ...(pigmentMass > 0 ? { exactPaint: sampled.exactPaint } : {}),
    });
  };

  const stampPlacements = (
    current: ActiveStroke,
    field: PigmentField,
    placements: readonly StrokePoint[],
    render = true,
  ) => {
    let dirty: PixelBounds | null = null;
    for (const placement of placements) {
      dirty = unionBounds(
        dirty,
        applyStamp(
          field,
          current.dynamics,
          placement,
          current.settings,
          current.shadow,
        ),
      );
    }
    // Spacing follows the stamp size so a light touch stays a continuous line.
    current.spacing = nextSpacing(current.dynamics, current.settings);
    if (dirty) {
      current.bounds = unionBounds(current.bounds, dirty);
      if (render) renderView(dirty);
    }
    return dirty;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      panEnabled ||
      !event.isPrimary ||
      activePointer.current !== undefined ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    if (!activeLayer) return;
    if (pendingLoads.current.has(activeLayer.id)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = canvasPoint(event.nativeEvent, rect);

    if (tool === "eyedropper") {
      sampleAt(point);
      return;
    }
    if (tool === "fill") {
      fillAt(activeLayer.id, point);
      return;
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Safari can drop the pointer before React dispatches a fast tap; the
      // stroke still works, it just is not captured.
    }
    activePointer.current = event.pointerId;
    const field = getField(activeLayer.id);
    const brushSettings = dynamicsSettings();
    const current: ActiveStroke = {
      layerId: activeLayer.id,
      sampler: beginStrokeSampling(point),
      dynamics: beginStrokeDynamics(
        tool,
        brushSettings,
        paintLoadFromColor(color),
        Math.floor(point.x * 7919 + point.y * 104729 + point.time),
      ),
      settings: brushSettings,
      spacing: strokeSpacing(tool, brushSettings),
      shadow: createStrokeShadow(field),
      bounds: null,
    };
    stroke.current = current;
    stampPlacements(current, field, [point]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || activePointer.current !== event.pointerId) return;
    const field = fields.current.get(current.layerId);
    if (!field) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const stabilization = settings.stabilization / 100;
    let previous = current.sampler.lastInput;
    const inputs = coalescedPointerSamples(event).map((sample) => {
      const next = stabilizeStrokePoint(
        previous,
        canvasPoint(sample, rect),
        stabilization,
      );
      previous = next;
      return next;
    });

    let samplingState = current.sampler;
    let remaining: StrokePoint[] = inputs;
    let eventDirty: PixelBounds | null = null;
    do {
      // One placement per pass so the spacing can adapt to the stamp size.
      const sampled = appendStrokeSamples(samplingState, remaining, {
        spacing: current.spacing,
        maxPoints: 2,
      });
      eventDirty = unionBounds(eventDirty, stampPlacements(current, field, sampled.added, false));
      const latest = sampled.state.placements[sampled.state.placements.length - 1];
      samplingState = { ...sampled.state, placements: [latest] };
      remaining = sampled.remainingInput;
    } while (remaining.length > 0);
    current.sampler = samplingState;
    if (eventDirty) renderView(eventDirty);
  };

  const endStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || activePointer.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointer.current = undefined;
    stroke.current = null;
    const field = fields.current.get(current.layerId);
    if (!field) return;

    if (event.type === "pointerup") {
      const rect = event.currentTarget.getBoundingClientRect();
      const endpoint = stabilizeStrokePoint(
        current.sampler.lastInput,
        canvasPoint(event.nativeEvent, rect),
        settings.stabilization / 100,
      );
      const finished = finishStrokeSampling(current.sampler, endpoint, {
        spacing: current.spacing,
        maxPoints: 4_096,
      });
      stampPlacements(current, field, finished.added);
      // A dab that never moved gets its second half.
      const topped = completeTap(
        field,
        current.dynamics,
        finished.state.placements[finished.state.placements.length - 1] ?? endpoint,
        current.settings,
        current.shadow,
      );
      if (topped) {
        current.bounds = unionBounds(current.bounds, topped);
        renderView(topped);
      }
    }

    if (!current.bounds) return;

    let strokeBounds: PixelBounds = current.bounds;
    const settle = wetSettleOptions(tool, current.settings, current.dynamics);
    if (settle) {
      shadowBeforeWrite(
        current.shadow,
        expandBounds(strokeBounds, settleMargin(settle)),
      );
      const settled = settleWetPaint(field, strokeBounds, settle);
      if (settled) {
        strokeBounds = unionBounds(strokeBounds, settled) ?? strokeBounds;
        renderView(settled);
      }
    }
    if (current.dynamics.depositWetness > 0.04 || tool === "mixer") {
      markWet(current.layerId, strokeBounds);
    }

    const beforePatch = shadowPatch(current.shadow, strokeBounds);
    const afterPatch = capturePigmentPatch(field, strokeBounds);
    if (beforePatch && afterPatch) {
      pushHistory({
        kind: "canvas",
        layerId: current.layerId,
        before: beforePatch,
        after: afterPatch,
        label: tool === "eraser" ? "消去" : "描画",
      });
    }
    scheduleCommit(current.layerId);
  };

  const clearActiveLayer = () => {
    if (!activeLayer) return;
    const field = getField(activeLayer.id);
    const bounds = fullBounds(field);
    const before = capturePigmentPatch(field, bounds);
    clearPigmentField(field);
    wetRegions.current.delete(activeLayer.id);
    const after = capturePigmentPatch(field, bounds);
    renderView(bounds);
    if (before && after) {
      pushHistory({
        kind: "canvas",
        layerId: activeLayer.id,
        before,
        after,
        label: "全消去",
      });
    }
    scheduleCommit(activeLayer.id);
  };

  /** Saves exactly the pixels on screen: the same linear-light composite. */
  const exportPng = () => {
    const canvas = displayCanvas.current;
    if (!canvas) return;
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `カラーレシピ作品-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
  };

  const changeCanvasSize = async (key: keyof typeof CANVAS_SIZES) => {
    const next = CANVAS_SIZES[key];
    if (
      resizeInFlight.current ||
      (next.width === canvasSize.width && next.height === canvasSize.height)
    ) {
      return;
    }
    resizeInFlight.current = true;
    try {
      const before = captureDocument();
      const resizedLayers = before.layers.map((layer) => {
        const field = fields.current.get(layer.id);
        if (!field) return { ...layer, dataUrl: undefined, pigmentDataUrls: undefined };
        const snapshot = snapshotPigmentLayer(
          resamplePigmentField(field, next.width, next.height),
        );
        return {
          ...layer,
          dataUrl: snapshot.dataUrl,
          pigmentDataUrls: snapshot.pigmentDataUrls,
          pigmentSavedAt: snapshot.pigmentSavedAt,
        };
      });
      const after: StoredArtwork = {
        ...before,
        layers: resizedLayers,
        width: next.width,
        height: next.height,
      };
      pushHistory({
        kind: "document",
        before,
        after,
        label: "用紙サイズを変更",
      });
      loadedUrls.current.clear();
      wetRegions.current.clear();
      setCanvasSize({ width: next.width, height: next.height });
      setLayers(resizedLayers);
      setActiveLayerId(after.activeLayerId);
    } finally {
      resizeInFlight.current = false;
    }
  };

  const activeTool = TOOL_OPTIONS.find((entry) => entry.id === tool);

  return (
    <div className="studio studio--draw" data-testid="drawing-studio">
      <div className="mode-toolbar">
        <div className="mode-toolbar__primary">
          <CurrentPaintPicker
            color={color}
            colorName={colorName}
            label="現在の色"
            testId="drawing-color-picker"
            onOpenPalette={onOpenPalette}
          />
          <div className="toolbar-actions">
          <span className="autosave-state" aria-live="polite">
            <Save size={14} aria-hidden="true" />
            {saveState === "saving"
              ? "保存中…"
              : saveState === "error"
                ? "保存できませんでした"
                : "自動保存済み"}
          </span>
          <label className="compact-field">
            背景
            <input
              type="color"
              value={background}
              onChange={(event) => changeBackground(event.target.value)}
              aria-label="背景色"
            />
          </label>
          <label className="compact-field">
            用紙
            <select
              aria-label="キャンバスサイズ"
              value={
                Object.entries(CANVAS_SIZES).find(
                  ([, value]) =>
                    value.width === canvasSize.width && value.height === canvasSize.height,
                )?.[0] ?? "landscape"
              }
              onChange={(event) =>
                void changeCanvasSize(event.target.value as keyof typeof CANVAS_SIZES)
              }
            >
              {Object.entries(CANVAS_SIZES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label="戻す"
            onClick={undo}
            disabled={!historyAvailability.undo}
          >
            <Undo2 size={17} aria-hidden="true" /> <span>戻す</span>
          </button>
          <button
            type="button"
            aria-label="やり直す"
            onClick={redo}
            disabled={!historyAvailability.redo}
          >
            <Redo2 size={17} aria-hidden="true" /> <span>やり直す</span>
          </button>
          <button type="button" aria-label="全消去" onClick={clearActiveLayer}>
            <Trash2 size={17} aria-hidden="true" /> <span>全消去</span>
          </button>
          <button
            ref={mobileInspectorToggle}
            type="button"
            className="mobile-inspector-toggle"
            aria-expanded={mobileInspectorOpen}
            aria-controls="drawing-inspector"
            aria-label="調整"
            onClick={() => setMobileInspectorOpen(true)}
          >
            <SlidersHorizontal size={17} aria-hidden="true" /> <span>調整</span>
          </button>
          <button
            type="button"
            className="primary-toolbar-button"
            aria-label="PNG保存"
            onClick={exportPng}
            data-testid="export-png"
          >
            <Download size={17} aria-hidden="true" /> <span>PNG保存</span>
          </button>
          </div>
        </div>
      </div>

      <div className="draw-layout">
        <section className="tool-rail" aria-label="描画ツール">
          <p>筆を選ぶ</p>
          <div className="tool-grid">
            {TOOL_OPTIONS.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={tool === entry.id ? "is-selected" : ""}
                  aria-pressed={tool === entry.id}
                  title={entry.label}
                  onClick={() => setTool(entry.id)}
                >
                  <Icon size={20} aria-hidden={true} />
                  <span>{entry.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="drawing-paper-shell" aria-label="おえかきキャンバス">
          <CanvasZoomControls
            label="おえかきキャンバス"
            zoom={zoom}
            panEnabled={panEnabled}
            onZoomChange={changeZoom}
            onPanEnabledChange={setPanEnabled}
          />
          <div
            ref={viewportRef}
            className={`canvas-viewport ${panEnabled ? "is-pan-enabled" : ""} ${isPanning ? "is-panning" : ""}`}
            role="region"
            aria-label="おえかきキャンバスの表示領域"
            tabIndex={0}
            data-testid="drawing-viewport"
            {...panHandlers}
          >
            <div className="canvas-scroll-content">
              <div
                className="canvas-zoom-stage"
                style={{
                  ...stageStyle,
                  "--canvas-zoom": zoom,
                } as React.CSSProperties}
                data-testid="drawing-zoom-stage"
              >
                <div
                  className="drawing-paper"
                  style={{
                    aspectRatio: `${canvasSize.width} / ${canvasSize.height}`,
                    background,
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endStroke}
                  onPointerCancel={endStroke}
                  onLostPointerCapture={endStroke}
                  data-testid="drawing-canvas"
                >
            <canvas
              ref={displayCanvas}
              width={canvasSize.width}
              height={canvasSize.height}
              className="drawing-layer-canvas"
              aria-hidden="true"
            />

            <span className="drawing-cursor-label" aria-hidden="true">
              {activeTool?.label}
            </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <button
          type="button"
          className={`inspector-drawer-scrim ${mobileInspectorOpen ? "is-open" : ""}`}
          aria-label="筆の調整を閉じる"
          tabIndex={mobileInspectorOpen ? 0 : -1}
          onClick={() => setMobileInspectorOpen(false)}
        />
        <aside
          ref={mobileInspector}
          id="drawing-inspector"
          className={`draw-inspector ${mobileInspectorOpen ? "is-mobile-open" : ""}`}
          role={mobileInspectorOpen ? "dialog" : undefined}
          aria-modal={mobileInspectorOpen ? "true" : undefined}
          aria-label="筆とレイヤーの調整"
        >
          <button
            type="button"
            className="mobile-inspector-close"
            aria-label="筆の調整を閉じる"
            onClick={() => setMobileInspectorOpen(false)}
          >
            <X size={18} aria-hidden="true" /> 閉じる
          </button>
          <section className="inspector-section brush-controls">
            <div className="inspector-heading">
              <div>
                <p className="eyebrow">筆の調整</p>
                <h3>{activeTool?.label}</h3>
              </div>
              <span className="brush-size-preview">
                <Circle size={Math.max(8, Math.min(34, settings.size / 2))} fill="currentColor" />
              </span>
            </div>
            {(
              [
                ["size", "ブラシサイズ", 2, 140, ""],
                ["opacity", "不透明度", 5, 100, "%"],
                ["pressure", "筆圧", 0, 100, "%"],
                ["water", "水分量", 0, 100, "%"],
                ["bleed", "にじみ", 0, 100, "%"],
                ["hardness", "硬さ", 0, 100, "%"],
                ["spacing", "間隔", 2, 100, "%"],
                ["stabilization", "手ぶれ補正", 0, 92, "%"],
              ] as Array<[keyof UiBrushSettings, string, number, number, string]>
            ).map(([key, label, min, max, suffix]) => (
              <label className="range-control" key={key}>
                <span>
                  {label}
                  <strong>
                    {settings[key]}
                    {suffix}
                  </strong>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={settings[key]}
                  aria-label={label}
                  aria-valuetext={`${settings[key]}${suffix}`}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </section>

          <section className="inspector-section mobile-paper-controls">
            <div className="inspector-heading">
              <div>
                <p className="eyebrow">用紙の調整</p>
                <h3>背景とサイズ</h3>
              </div>
            </div>
            <div className="paper-control-grid">
              <label>
                <span>背景色</span>
                <input
                  type="color"
                  value={background}
                  onChange={(event) => changeBackground(event.target.value)}
                  aria-label="背景色"
                />
              </label>
              <label>
                <span>用紙サイズ</span>
                <select
                  aria-label="キャンバスサイズ"
                  value={
                    Object.entries(CANVAS_SIZES).find(
                      ([, value]) =>
                        value.width === canvasSize.width &&
                        value.height === canvasSize.height,
                    )?.[0] ?? "landscape"
                  }
                  onChange={(event) =>
                    void changeCanvasSize(
                      event.target.value as keyof typeof CANVAS_SIZES,
                    )
                  }
                >
                  {Object.entries(CANVAS_SIZES).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}（{value.width}×{value.height}）
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="inspector-section layer-panel">
            <div className="inspector-heading">
              <div>
                <p className="eyebrow">
                  <Layers3 size={14} aria-hidden="true" /> レイヤー
                </p>
                <h3>{layers.length}枚</h3>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="レイヤーを追加"
                onClick={() => {
                  const layer = newLayer(layers.length + 1);
                  changeLayers(
                    [...layers, layer],
                    "レイヤーを追加",
                    layer.id,
                  );
                }}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="layer-list">
              {[...layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  className={`layer-row ${activeLayer?.id === layer.id ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="layer-visibility"
                    aria-label={`${layer.name}を${layer.visible ? "非表示" : "表示"}`}
                    onClick={() => {
                      changeLayers(
                        layers.map((entry) =>
                          entry.id === layer.id
                            ? { ...entry, visible: !entry.visible }
                            : entry,
                        ),
                        `${layer.name}を${layer.visible ? "非表示" : "表示"}`,
                      );
                    }}
                  >
                    {layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    type="button"
                    className="layer-select"
                    aria-pressed={activeLayer?.id === layer.id}
                    onClick={() => changeActiveLayer(layer.id)}
                  >
                    <span>{layer.name}</span>
                    <small>{layer.opacity}%</small>
                  </button>
                </div>
              ))}
            </div>
            {activeLayer && (
              <label className="range-control layer-opacity">
                <span>
                  レイヤーの不透明度
                  <strong>{activeLayer.opacity}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={activeLayer.opacity}
                  aria-label={`${activeLayer.name}の不透明度`}
                  onFocus={() => beginLayerOpacityChange(activeLayer.id)}
                  onPointerDown={() => beginLayerOpacityChange(activeLayer.id)}
                  onPointerUp={finishLayerOpacityChange}
                  onPointerCancel={finishLayerOpacityChange}
                  onBlur={finishLayerOpacityChange}
                  onChange={(event) => {
                    const opacity = Number(event.target.value);
                    setLayers((current) =>
                      current.map((layer) =>
                        layer.id === activeLayer.id
                          ? { ...layer, opacity }
                          : layer,
                      ),
                    );
                  }}
                />
              </label>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
