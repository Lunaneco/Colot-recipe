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
import { computeBrushStampMetrics, floodFillImageData } from "../lib/paintEngine";
import {
  loadArtwork,
  loadSetting,
  saveArtwork,
  saveSetting,
} from "../lib/storage";
import type {
  BrushSettings as UiBrushSettings,
  BrushTool,
  DrawingLayer,
  MixedColorSnapshot,
} from "../lib/types";
import {
  CanvasZoomControls,
  useCanvasPan,
  useCanvasViewport,
} from "./CanvasViewport";

type DrawingStudioProps = {
  color: MixedColorSnapshot;
  colorName: string;
  onOpenPalette: () => void;
  onSampleColor: (hex: string) => void;
};

type HistoryEntry =
  | {
      kind: "canvas";
      layerId: string;
      before: string;
      after: string;
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
const MAX_STORED_IMAGE_CHARS = 16_000_000;
const MAX_STORED_IMAGE_DIMENSION = 8192;
const MAX_STORED_IMAGE_PIXELS = 32_000_000;

function safePngDimensions(dataUrl: string) {
  const prefix = "data:image/png;base64,";
  if (
    dataUrl.length === 0 ||
    dataUrl.length > MAX_STORED_IMAGE_CHARS ||
    !dataUrl.startsWith(prefix) ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(dataUrl.slice(prefix.length))
  ) {
    throw new Error("Artwork image is not a safe PNG");
  }
  const header = atob(dataUrl.slice(prefix.length, prefix.length + 44));
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    header.length < 24 ||
    !signature.every((byte, index) => header.charCodeAt(index) === byte)
  ) {
    throw new Error("Artwork image has an invalid PNG header");
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
    width > MAX_STORED_IMAGE_DIMENSION ||
    height > MAX_STORED_IMAGE_DIMENSION ||
    width * height > MAX_STORED_IMAGE_PIXELS
  ) {
    throw new Error("Artwork image dimensions are unsafe");
  }
  return { width, height };
}

function newLayer(index: number): DrawingLayer {
  return {
    id: `layer-${Date.now()}-${index}`,
    name: `レイヤー ${index}`,
    visible: true,
    opacity: 100,
  };
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0"))
    .join("")}`;
}

async function drawDataUrl(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  clear = true,
) {
  safePngDimensions(dataUrl);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Artwork image could not load"));
    image.src = dataUrl;
  });
  const context = canvas.getContext("2d");
  if (!context) return;
  if (clear) context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

async function resizeDataUrl(
  dataUrl: string,
  width: number,
  height: number,
) {
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  await drawDataUrl(output, dataUrl);
  return output.toDataURL("image/png");
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
  const [background, setBackground] = useState("#fffdf8");
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
  const canvasRefs = useRef(new Map<string, HTMLCanvasElement>());
  const loadedUrls = useRef(new Map<string, string>());
  const activePointer = useRef<number | undefined>(undefined);
  const previousPoint = useRef<
    { x: number; y: number; pressure: number } | undefined
  >(undefined);
  const strokeBefore = useRef<string>("");
  const mixerSource = useRef<ImageData | undefined>(undefined);
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

  useEffect(() => {
    layers.forEach((layer) => {
      const canvas = canvasRefs.current.get(layer.id);
      if (!canvas || !layer.dataUrl) return;
      if (loadedUrls.current.get(layer.id) === layer.dataUrl) return;
      loadedUrls.current.set(layer.id, layer.dataUrl);
      void drawDataUrl(canvas, layer.dataUrl);
    });
  }, [canvasSize, layers]);

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

  const setLayerDataUrl = useCallback(
    (layerId: string, dataUrl: string) => {
      loadedUrls.current.set(layerId, dataUrl);
      setLayers((current) => {
        return current.map((layer) =>
          layer.id === layerId ? { ...layer, dataUrl } : layer,
        );
      });
    },
    [],
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

  const pushHistory = useCallback((entry: HistoryEntry) => {
    undoStack.current = [...undoStack.current.slice(-13), entry];
    redoStack.current = [];
    refreshHistory();
  }, [refreshHistory]);

  const captureDocument = useCallback(
    (): StoredArtwork => ({
      layers: layers.map((layer) => {
        const canvas = canvasRefs.current.get(layer.id);
        return {
          ...layer,
          dataUrl: canvas?.toDataURL("image/png") ?? layer.dataUrl,
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

  const restoreHistoryData = useCallback(
    async (layerId: string, dataUrl: string) => {
      const canvas = canvasRefs.current.get(layerId);
      if (!canvas) return;
      if (dataUrl) await drawDataUrl(canvas, dataUrl);
      else canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      setLayerDataUrl(layerId, dataUrl);
    },
    [setLayerDataUrl],
  );

  const restoreDocumentHistory = useCallback((restored: StoredArtwork) => {
    loadedUrls.current.clear();
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
      void restoreHistoryData(entry.layerId, entry.before);
    } else {
      restoreDocumentHistory(entry.before);
    }
    refreshHistory();
  }, [refreshHistory, restoreDocumentHistory, restoreHistoryData]);

  const redo = useCallback(() => {
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry);
    if (entry.kind === "canvas") {
      void restoreHistoryData(entry.layerId, entry.after);
    } else {
      restoreDocumentHistory(entry.after);
    }
    refreshHistory();
  }, [refreshHistory, restoreDocumentHistory, restoreHistoryData]);

  const changeLayers = useCallback(
    (
      nextLayers: DrawingLayer[],
      label: string,
      nextActiveLayerId = activeLayerId,
    ) => {
      const before = captureDocument();
      const currentDataUrls = new Map(
        before.layers.map((layer) => [layer.id, layer.dataUrl]),
      );
      const after: StoredArtwork = {
        ...before,
        layers: nextLayers.map((layer) => ({
          ...layer,
          dataUrl: currentDataUrls.get(layer.id) ?? layer.dataUrl,
        })),
        activeLayerId: nextActiveLayerId,
      };
      pushHistory({
        kind: "document",
        before,
        after,
        label,
      });
      setLayers(after.layers);
      setActiveLayerId(nextActiveLayerId);
    },
    [activeLayerId, captureDocument, pushHistory],
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

  const canvasPoint = (
    event: React.PointerEvent<HTMLDivElement>,
    canvas: HTMLCanvasElement,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const pointPressure =
      event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35;
    return {
      x: Math.max(
        0,
        Math.min(
          canvas.width - 1,
          ((event.clientX - rect.left) / Math.max(1, rect.width)) *
            canvas.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height - 1,
          ((event.clientY - rect.top) / Math.max(1, rect.height)) *
            canvas.height,
        ),
      ),
      pressure: pointPressure,
    };
  };

  const renderComposite = useCallback(
    (includeBackground = true) => {
      const output = document.createElement("canvas");
      output.width = canvasSize.width;
      output.height = canvasSize.height;
      const context = output.getContext("2d", { willReadFrequently: true });
      if (!context) return output;
      if (includeBackground) {
        context.fillStyle = background;
        context.fillRect(0, 0, output.width, output.height);
      }
      layers.forEach((layer) => {
        const canvas = canvasRefs.current.get(layer.id);
        if (!canvas || !layer.visible) return;
        context.save();
        context.globalAlpha = layer.opacity / 100;
        context.drawImage(canvas, 0, 0, output.width, output.height);
        context.restore();
      });
      return output;
    },
    [background, canvasSize.height, canvasSize.width, layers],
  );

  const paintSegment = useCallback(
    (
      canvas: HTMLCanvasElement,
      from: { x: number; y: number; pressure: number },
      to: { x: number; y: number; pressure: number },
    ) => {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      const rgb = hexToRgb(color.hex);
      const metrics = computeBrushStampMetrics(to.pressure, {
        size: tool === "pencil" ? Math.max(1, settings.size * 0.16) : settings.size,
        opacity: (settings.opacity / 100) * color.opacity,
        pressureSensitivity: settings.pressure / 100,
        moisture: Math.max(settings.water / 100, color.waterRatio),
        bleed: settings.bleed / 100,
        hardness: settings.hardness / 100,
        spacing: settings.spacing / 100,
      });
      const alpha = Math.max(0.02, metrics.alpha);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, metrics.spacing)));

      context.save();
      if (tool === "eraser") context.globalCompositeOperation = "destination-out";
      else if (tool === "mixer") context.globalCompositeOperation = "source-over";
      else if (tool === "watercolor") context.globalCompositeOperation = "multiply";

      for (let index = 0; index <= steps; index += 1) {
        const progress = index / steps;
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;
        const radius =
          metrics.radius *
          (tool === "flat" ? 1.05 : tool === "marker" ? 1.25 : 1);

        if (tool === "airbrush") {
          const spray = context.createRadialGradient(x, y, 0, x, y, radius * 1.65);
          spray.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.18})`);
          spray.addColorStop(0.55, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.07})`);
          spray.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
          context.fillStyle = spray;
          context.beginPath();
          context.arc(x, y, radius * 1.65, 0, Math.PI * 2);
          context.fill();
        } else if (tool === "watercolor") {
          const wash = context.createRadialGradient(x, y, radius * 0.08, x, y, radius * 1.45);
          wash.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.28})`);
          wash.addColorStop(0.72, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.17})`);
          wash.addColorStop(0.9, `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha * 0.26})`);
          wash.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
          context.fillStyle = wash;
          context.beginPath();
          context.arc(x, y, radius * 1.45, 0, Math.PI * 2);
          context.fill();
        } else if (tool === "blur") {
          const diameter = Math.max(4, radius * 2);
          context.filter = `blur(${Math.max(2, metrics.diffusionRadius + 2)}px)`;
          context.globalAlpha = 0.42;
          context.drawImage(
            canvas,
            Math.max(0, x - radius),
            Math.max(0, y - radius),
            diameter,
            diameter,
            x - radius,
            y - radius,
            diameter,
            diameter,
          );
          context.filter = "none";
        } else {
          const source = mixerSource.current;
          const sourceX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x)));
          const sourceY = Math.max(0, Math.min(canvas.height - 1, Math.floor(y)));
          const sourceOffset = (sourceY * canvas.width + sourceX) * 4;
          const stampRgb =
            tool === "mixer" && source
              ? {
                  r: Math.round(source.data[sourceOffset] * 0.72 + rgb.r * 0.28),
                  g: Math.round(source.data[sourceOffset + 1] * 0.72 + rgb.g * 0.28),
                  b: Math.round(source.data[sourceOffset + 2] * 0.72 + rgb.b * 0.28),
                }
              : rgb;
          const stampAlpha =
            tool === "marker"
              ? Math.min(0.36, alpha)
              : tool === "mixer"
                ? Math.min(0.28, alpha)
                : alpha;
          if (tool === "flat" || tool === "marker") {
            context.globalAlpha = stampAlpha;
            context.fillStyle = `rgb(${stampRgb.r},${stampRgb.g},${stampRgb.b})`;
            context.fillRect(x - radius, y - radius * 0.45, radius * 2, radius * 0.9);
          } else {
            const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
            const solidUntil = Math.max(0, Math.min(0.98, 1 - metrics.edgeSoftness));
            const gradientColor =
              tool === "eraser"
                ? `rgba(0,0,0,${stampAlpha})`
                : `rgba(${stampRgb.r},${stampRgb.g},${stampRgb.b},${stampAlpha})`;
            const transparentColor =
              tool === "eraser"
                ? "rgba(0,0,0,0)"
                : `rgba(${stampRgb.r},${stampRgb.g},${stampRgb.b},0)`;
            gradient.addColorStop(0, gradientColor);
            gradient.addColorStop(solidUntil, gradientColor);
            gradient.addColorStop(1, transparentColor);
            context.globalAlpha = 1;
            context.fillStyle = gradient;
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
          }
        }
      }
      context.restore();
    },
    [color, settings, tool],
  );

  const fillAt = useCallback(
    (canvas: HTMLCanvasElement, point: { x: number; y: number }) => {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      const composite = renderComposite(true);
      const compositeContext = composite.getContext("2d", {
        willReadFrequently: true,
      });
      if (!compositeContext) return false;
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
        [rgb.r, rgb.g, rgb.b, Math.round(255 * color.opacity * settings.opacity / 100)],
        {
          tolerance: 28,
          alphaTolerance: 38,
          gapGuardRadius: 1,
          maxPixels: imageData.width * imageData.height,
        },
      );
      if (!result.changedPixels) return false;
      const activeImage = context.getImageData(0, 0, canvas.width, canvas.height);
      const bounds = result.bounds ?? {
        x: 0,
        y: 0,
        width: imageData.width,
        height: imageData.height,
      };
      for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
        for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
          const offset = (y * imageData.width + x) * 4;
          if (
            imageData.data[offset] === before[offset] &&
            imageData.data[offset + 1] === before[offset + 1] &&
            imageData.data[offset + 2] === before[offset + 2] &&
            imageData.data[offset + 3] === before[offset + 3]
          ) {
            continue;
          }
          activeImage.data[offset] = imageData.data[offset];
          activeImage.data[offset + 1] = imageData.data[offset + 1];
          activeImage.data[offset + 2] = imageData.data[offset + 2];
          activeImage.data[offset + 3] = imageData.data[offset + 3];
        }
      }
      context.putImageData(activeImage, 0, 0);
      return true;
    },
    [color, renderComposite, settings.opacity],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panEnabled) return;
    if (!activeLayer) return;
    const canvas = canvasRefs.current.get(activeLayer.id);
    if (!canvas) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    const point = canvasPoint(event, canvas);
    strokeBefore.current = canvas.toDataURL("image/png");

    if (tool === "eyedropper") {
      const composite = renderComposite(true);
      const context = composite.getContext("2d", { willReadFrequently: true });
      const sampleX = Math.max(
        0,
        Math.min(composite.width - 1, Math.floor(point.x)),
      );
      const sampleY = Math.max(
        0,
        Math.min(composite.height - 1, Math.floor(point.y)),
      );
      const pixel = context?.getImageData(
        sampleX,
        sampleY,
        1,
        1,
      ).data;
      if (pixel && pixel[3] > 0) {
        onSampleColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
      }
      event.currentTarget.releasePointerCapture(event.pointerId);
      activePointer.current = undefined;
      return;
    }
    if (tool === "fill") {
      const changed = fillAt(canvas, point);
      if (!changed) {
        event.currentTarget.releasePointerCapture(event.pointerId);
        activePointer.current = undefined;
        return;
      }
      const after = canvas.toDataURL("image/png");
      pushHistory({
        kind: "canvas",
        layerId: activeLayer.id,
        before: strokeBefore.current,
        after,
        label: "塗りつぶし",
      });
      setLayerDataUrl(activeLayer.id, after);
      event.currentTarget.releasePointerCapture(event.pointerId);
      activePointer.current = undefined;
      return;
    }
    if (tool === "mixer") {
      const composite = renderComposite(true);
      mixerSource.current = composite
        .getContext("2d", { willReadFrequently: true })
        ?.getImageData(0, 0, composite.width, composite.height);
    } else {
      mixerSource.current = undefined;
    }
    previousPoint.current = point;
    paintSegment(canvas, point, point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId || !activeLayer || !previousPoint.current) {
      return;
    }
    const canvas = canvasRefs.current.get(activeLayer.id);
    if (!canvas) return;
    const nextPoint = canvasPoint(event, canvas);
    const stabilization = settings.stabilization / 100;
    const smoothed = {
      x: previousPoint.current.x * stabilization + nextPoint.x * (1 - stabilization),
      y: previousPoint.current.y * stabilization + nextPoint.y * (1 - stabilization),
      pressure: nextPoint.pressure,
    };
    paintSegment(canvas, previousPoint.current, smoothed);
    previousPoint.current = smoothed;
  };

  const endStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== event.pointerId || !activeLayer) return;
    const canvas = canvasRefs.current.get(activeLayer.id);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointer.current = undefined;
    previousPoint.current = undefined;
    mixerSource.current = undefined;
    if (!canvas) return;
    const after = canvas.toDataURL("image/png");
    pushHistory({
      kind: "canvas",
      layerId: activeLayer.id,
      before: strokeBefore.current,
      after,
      label: tool === "eraser" ? "消去" : "描画",
    });
    setLayerDataUrl(activeLayer.id, after);
  };

  const clearActiveLayer = () => {
    if (!activeLayer) return;
    const canvas = canvasRefs.current.get(activeLayer.id);
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const before = canvas.toDataURL("image/png");
    context.clearRect(0, 0, canvas.width, canvas.height);
    const after = canvas.toDataURL("image/png");
    pushHistory({
      kind: "canvas",
      layerId: activeLayer.id,
      before,
      after,
      label: "全消去",
    });
    setLayerDataUrl(activeLayer.id, after);
  };

  const exportPng = () => {
    const output = document.createElement("canvas");
    output.width = canvasSize.width;
    output.height = canvasSize.height;
    const context = output.getContext("2d");
    if (!context) return;
    context.fillStyle = background;
    context.fillRect(0, 0, output.width, output.height);
    layers.forEach((layer) => {
      const canvas = canvasRefs.current.get(layer.id);
      if (!canvas || !layer.visible) return;
      context.save();
      context.globalAlpha = layer.opacity / 100;
      context.drawImage(canvas, 0, 0);
      context.restore();
    });
    const anchor = document.createElement("a");
    anchor.href = output.toDataURL("image/png");
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
      const resizedLayers = await Promise.all(
        before.layers.map(async (layer) => ({
          ...layer,
          dataUrl: layer.dataUrl
            ? await resizeDataUrl(layer.dataUrl, next.width, next.height)
            : undefined,
        })),
      );
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
      setZoom(100);
      setPanEnabled(false);
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
        <div className="current-paint">
          <button
            type="button"
            className="current-paint__swatch"
            style={{
              "--current-paint": color.hex,
              "--current-opacity": Math.max(0.45, color.opacity),
            } as React.CSSProperties}
            onClick={onOpenPalette}
            aria-label={`現在の色は${colorName}。保存パレットから変更`}
          />
          <div>
            <span>現在の色</span>
            <strong>{colorName}</strong>
          </div>
        </div>
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
                  data-testid="drawing-canvas"
                >
                  {layers.map((layer) => (
                    <canvas
                      key={layer.id}
                      ref={(node) => {
                        if (node) canvasRefs.current.set(layer.id, node);
                        else canvasRefs.current.delete(layer.id);
                      }}
                      width={canvasSize.width}
                      height={canvasSize.height}
                      className="drawing-layer-canvas"
                      style={{
                        opacity: layer.visible ? layer.opacity / 100 : 0,
                        zIndex: layers.indexOf(layer),
                      }}
                      aria-hidden="true"
                    />
                  ))}
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
