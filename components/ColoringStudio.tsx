"use client";

import {
  Brush,
  CakeSlice,
  CarFront,
  Download,
  Flower2,
  Grid2X2Plus,
  ImagePlus,
  PawPrint,
  Rabbit,
  Redo2,
  Ribbon,
  SlidersHorizontal,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  fillEnclosedRegion,
  prepareUploadedLineArt,
} from "../lib/paintEngine";
import {
  loadColoringProgress,
  loadSetting,
  saveColoringProgress,
  saveSetting,
} from "../lib/storage";
import type { MixedColorSnapshot } from "../lib/types";
import {
  CanvasZoomControls,
  useCanvasPan,
  useCanvasViewport,
} from "./CanvasViewport";

type ColoringStudioProps = {
  color: MixedColorSnapshot;
  colorName: string;
  onOpenPalette: () => void;
};

type TemplateId =
  | "bear"
  | "rabbit"
  | "ribbon"
  | "flower"
  | "car"
  | "cake"
  | "upload";

type TemplateDefinition = {
  id: Exclude<TemplateId, "upload">;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
};

type StoredColoringSettings = {
  template: TemplateId;
  paintMode: "fill" | "brush";
  tolerance: number;
  gapGuard: number;
  brushSize: number;
  uploadedImage?: string;
  uploadedImageId?: string;
};

type StoredColoringProgress = {
  dataUrl: string;
  sourceId: string;
  updatedAt: string;
};

const TEMPLATES: TemplateDefinition[] = [
  { id: "bear", label: "くま", description: "にっこりテディベア", icon: PawPrint },
  { id: "rabbit", label: "うさぎ", description: "にんじんとうさぎ", icon: Rabbit },
  { id: "ribbon", label: "リボン", description: "おおきなリボン", icon: Ribbon },
  { id: "flower", label: "おはな", description: "5まいの大きなお花", icon: Flower2 },
  { id: "car", label: "くるま", description: "まるいくるま", icon: CarFront },
  { id: "cake", label: "ケーキ", description: "いちごのケーキ", icon: CakeSlice },
];

const WIDTH = 920;
const HEIGHT = 720;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_DIMENSION = 8192;
const MAX_UPLOAD_PIXELS = 32_000_000;
const MAX_STORED_IMAGE_CHARS = 12_000_000;
const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function setupLineContext(context: CanvasRenderingContext2D) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = "#2f2b27";
  context.fillStyle = "transparent";
  context.lineWidth = 13;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function ellipse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation = 0,
) {
  context.beginPath();
  context.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  context.stroke();
}

function closedPath(
  context: CanvasRenderingContext2D,
  draw: () => void,
) {
  context.beginPath();
  draw();
  context.closePath();
  context.stroke();
}

function filledDot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) {
  context.save();
  context.fillStyle = context.strokeStyle;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawBear(context: CanvasRenderingContext2D) {
  setupLineContext(context);

  ellipse(context, 460, 520, 205, 165);
  ellipse(context, 350, 646, 88, 50, -0.08);
  ellipse(context, 570, 646, 88, 50, 0.08);

  closedPath(context, () => {
    context.moveTo(282, 186);
    context.bezierCurveTo(218, 114, 276, 54, 350, 118);
    context.bezierCurveTo(420, 84, 500, 84, 570, 118);
    context.bezierCurveTo(644, 54, 702, 114, 638, 186);
    context.bezierCurveTo(724, 274, 686, 423, 570, 454);
    context.bezierCurveTo(510, 472, 410, 472, 350, 454);
    context.bezierCurveTo(234, 423, 196, 274, 282, 186);
  });
  ellipse(context, 314, 151, 43, 38, -0.25);
  ellipse(context, 606, 151, 43, 38, 0.25);
  ellipse(context, 460, 354, 92, 70);
  ellipse(context, 460, 545, 105, 93);
  filledDot(context, 380, 286, 13);
  filledDot(context, 540, 286, 13);
  filledDot(context, 460, 338, 15);
  context.beginPath();
  context.moveTo(460, 354);
  context.quadraticCurveTo(428, 389, 397, 365);
  context.moveTo(460, 354);
  context.quadraticCurveTo(492, 389, 523, 365);
  context.stroke();
}

function drawRabbit(context: CanvasRenderingContext2D) {
  setupLineContext(context);

  ellipse(context, 360, 150, 62, 132, -0.12);
  ellipse(context, 510, 144, 62, 138, 0.12);
  ellipse(context, 362, 151, 25, 88, -0.12);
  ellipse(context, 508, 146, 25, 92, 0.12);
  ellipse(context, 435, 538, 174, 148);
  ellipse(context, 435, 315, 193, 157);
  ellipse(context, 435, 558, 88, 80);
  ellipse(context, 604, 472, 47, 47);

  filledDot(context, 365, 300, 12);
  filledDot(context, 505, 300, 12);
  filledDot(context, 435, 350, 13);
  context.beginPath();
  context.moveTo(435, 363);
  context.quadraticCurveTo(408, 393, 382, 372);
  context.moveTo(435, 363);
  context.quadraticCurveTo(462, 393, 488, 372);
  context.stroke();

  closedPath(context, () => {
    context.moveTo(675, 430);
    context.quadraticCurveTo(748, 442, 780, 485);
    context.lineTo(676, 650);
    context.quadraticCurveTo(636, 540, 675, 430);
  });
  closedPath(context, () => {
    context.moveTo(704, 438);
    context.quadraticCurveTo(664, 374, 715, 347);
    context.quadraticCurveTo(748, 386, 742, 448);
  });
  closedPath(context, () => {
    context.moveTo(731, 443);
    context.quadraticCurveTo(746, 370, 803, 382);
    context.quadraticCurveTo(801, 431, 766, 468);
  });
}

function drawRibbon(context: CanvasRenderingContext2D) {
  setupLineContext(context);

  closedPath(context, () => {
    context.moveTo(413, 304);
    context.bezierCurveTo(332, 186, 175, 175, 151, 294);
    context.bezierCurveTo(129, 405, 276, 462, 421, 363);
  });
  closedPath(context, () => {
    context.moveTo(507, 304);
    context.bezierCurveTo(588, 186, 745, 175, 769, 294);
    context.bezierCurveTo(791, 405, 644, 462, 499, 363);
  });
  closedPath(context, () => {
    context.moveTo(427, 380);
    context.lineTo(320, 625);
    context.lineTo(423, 578);
    context.lineTo(466, 650);
    context.lineTo(472, 393);
  });
  closedPath(context, () => {
    context.moveTo(493, 380);
    context.lineTo(600, 625);
    context.lineTo(497, 578);
    context.lineTo(454, 650);
    context.lineTo(448, 393);
  });
  context.beginPath();
  context.roundRect(400, 286, 120, 124, 34);
  context.closePath();
  context.stroke();

  [
    [235, 112, 0.75],
    [685, 112, 0.75],
  ].forEach(([x, y, scale]) => {
    closedPath(context, () => {
      context.moveTo(x, y + 32 * scale);
      context.bezierCurveTo(
        x - 64 * scale,
        y - 8 * scale,
        x - 25 * scale,
        y - 57 * scale,
        x,
        y - 22 * scale,
      );
      context.bezierCurveTo(
        x + 25 * scale,
        y - 57 * scale,
        x + 64 * scale,
        y - 8 * scale,
        x,
        y + 32 * scale,
      );
    });
  });
}

function drawFlower(context: CanvasRenderingContext2D) {
  setupLineContext(context);
  [
    [460, 157, 70, 112, 0],
    [596, 258, 70, 112, 1.23],
    [544, 422, 70, 112, 2.5],
    [376, 422, 70, 112, -2.5],
    [324, 258, 70, 112, -1.23],
  ].forEach(([x, y, radiusX, radiusY, rotation]) =>
    ellipse(context, x, y, radiusX, radiusY, rotation),
  );
  ellipse(context, 460, 310, 92, 92);
  context.beginPath();
  context.moveTo(460, 404);
  context.bezierCurveTo(450, 495, 468, 570, 454, 672);
  context.stroke();
  ellipse(context, 354, 538, 95, 47, 0.55);
  ellipse(context, 564, 588, 95, 47, -0.55);
  filledDot(context, 425, 295, 9);
  filledDot(context, 495, 295, 9);
  context.beginPath();
  context.arc(460, 324, 35, 0.15, Math.PI - 0.15);
  context.stroke();
}

function drawCar(context: CanvasRenderingContext2D) {
  setupLineContext(context);
  closedPath(context, () => {
    context.moveTo(146, 420);
    context.quadraticCurveTo(155, 340, 247, 324);
    context.lineTo(326, 220);
    context.quadraticCurveTo(354, 180, 412, 180);
    context.lineTo(575, 180);
    context.quadraticCurveTo(628, 183, 654, 226);
    context.lineTo(714, 326);
    context.quadraticCurveTo(798, 343, 808, 422);
    context.lineTo(808, 526);
    context.lineTo(148, 526);
  });
  closedPath(context, () => {
    context.moveTo(345, 239);
    context.lineTo(432, 239);
    context.lineTo(432, 326);
    context.lineTo(285, 326);
  });
  closedPath(context, () => {
    context.moveTo(462, 239);
    context.lineTo(568, 239);
    context.lineTo(630, 326);
    context.lineTo(462, 326);
  });
  ellipse(context, 292, 526, 78, 78);
  ellipse(context, 292, 526, 31, 31);
  ellipse(context, 664, 526, 78, 78);
  ellipse(context, 664, 526, 31, 31);
  ellipse(context, 724, 408, 35, 25);
  context.beginPath();
  context.moveTo(176, 454);
  context.lineTo(780, 454);
  context.stroke();
}

function drawCake(context: CanvasRenderingContext2D) {
  setupLineContext(context);
  ellipse(context, 460, 650, 310, 42);
  context.beginPath();
  context.roundRect(210, 390, 500, 220, 34);
  context.closePath();
  context.stroke();
  context.beginPath();
  context.roundRect(270, 250, 380, 175, 32);
  context.closePath();
  context.stroke();
  closedPath(context, () => {
    context.moveTo(270, 307);
    context.bezierCurveTo(318, 345, 340, 277, 385, 316);
    context.bezierCurveTo(430, 355, 464, 280, 505, 318);
    context.bezierCurveTo(550, 356, 590, 286, 650, 309);
    context.lineTo(650, 250);
    context.lineTo(270, 250);
  });
  closedPath(context, () => {
    context.moveTo(460, 211);
    context.bezierCurveTo(390, 177, 406, 92, 460, 72);
    context.bezierCurveTo(514, 92, 530, 177, 460, 211);
  });
  closedPath(context, () => {
    context.moveTo(456, 84);
    context.quadraticCurveTo(425, 40, 386, 65);
    context.quadraticCurveTo(415, 98, 456, 102);
  });
  closedPath(context, () => {
    context.moveTo(464, 84);
    context.quadraticCurveTo(495, 40, 534, 65);
    context.quadraticCurveTo(505, 98, 464, 102);
  });
  ellipse(context, 360, 500, 42, 42);
  ellipse(context, 460, 500, 42, 42);
  ellipse(context, 560, 500, 42, 42);
}

const DRAW_TEMPLATE: Record<
  Exclude<TemplateId, "upload">,
  (ctx: CanvasRenderingContext2D) => void
> = {
  bear: drawBear,
  rabbit: drawRabbit,
  ribbon: drawRibbon,
  flower: drawFlower,
  car: drawCar,
  cake: drawCake,
};

async function loadImage(dataUrl: string) {
  if (!isSafeStoredImageDataUrl(dataUrl)) {
    throw new Error("画像データの形式が安全ではありません");
  }
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("画像を読み込めません"));
    image.src = dataUrl;
  });
  assertSafeImageDimensions(image.naturalWidth, image.naturalHeight);
  return image;
}

function isSafeStoredImageDataUrl(value: unknown): value is string {
  const prefix = "data:image/png;base64,";
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STORED_IMAGE_CHARS ||
    !value.startsWith(prefix)
  ) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value.slice(prefix.length))) {
    return false;
  }
  try {
    const header = atob(value.slice(prefix.length, prefix.length + 44));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      header.length < 24 ||
      !signature.every((byte, index) => header.charCodeAt(index) === byte)
    ) {
      return false;
    }
    const dimension = (offset: number) =>
      ((header.charCodeAt(offset) << 24) |
        (header.charCodeAt(offset + 1) << 16) |
        (header.charCodeAt(offset + 2) << 8) |
        header.charCodeAt(offset + 3)) >>>
      0;
    assertSafeImageDimensions(dimension(16), dimension(20));
    return true;
  } catch {
    return false;
  }
}

function assertSafeImageDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_UPLOAD_DIMENSION ||
    height > MAX_UPLOAD_DIMENSION ||
    width * height > MAX_UPLOAD_PIXELS
  ) {
    throw new Error("画像の寸法が大きすぎます");
  }
}

async function normalizeUploadedImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    assertSafeImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像を処理できません");

    const scale = Math.min(WIDTH / bitmap.width, HEIGHT / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.drawImage(
      bitmap,
      (WIDTH - width) / 2,
      (HEIGHT - height) / 2,
      width,
      height,
    );
    const pixels = context.getImageData(0, 0, WIDTH, HEIGHT);
    prepareUploadedLineArt(pixels);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

function dataUrlBytes(dataUrl: string) {
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("画像データの形式が正しくありません");
  const binary = atob(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function stableImageId(dataUrl: string) {
  const bytes = dataUrlBytes(dataUrl);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      bytes.buffer,
    );
    return `sha256-${Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("")}`;
  }

  // 古いWebViewでも、同じ画像には同じ進捗キーを割り当てる。
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${bytes.length}`;
}

export function ColoringStudio({
  color,
  colorName,
  onOpenPalette,
}: ColoringStudioProps) {
  const [template, setTemplate] = useState<TemplateId>("bear");
  const [paintMode, setPaintMode] = useState<"fill" | "brush">("fill");
  const [tolerance, setTolerance] = useState(28);
  const [gapGuard, setGapGuard] = useState(2);
  const [brushSize, setBrushSize] = useState(34);
  const [uploadedImage, setUploadedImage] = useState<string>();
  const [uploadedImageId, setUploadedImageId] = useState<string>();
  const [status, setStatus] = useState("くまの線画を選択中");
  const [zoom, setZoom] = useState(100);
  const [panEnabled, setPanEnabled] = useState(false);
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const mobileInspector = useRef<HTMLElement>(null);
  const mobileInspectorToggle = useRef<HTMLButtonElement>(null);
  const fillCanvas = useRef<HTMLCanvasElement>(null);
  const lineCanvas = useRef<HTMLCanvasElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const pointerId = useRef<number | undefined>(undefined);
  const previousPoint = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const redrawGeneration = useRef(0);
  const [historyAvailability, setHistoryAvailability] = useState({
    undo: 0,
    redo: 0,
  });
  const {
    viewportRef,
    stageStyle,
    changeZoomAroundCenter,
  } = useCanvasViewport({
    intrinsicWidth: WIDTH,
    intrinsicHeight: HEIGHT,
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
    loadSetting<StoredColoringSettings>("coloring-tools")
      .then(async (stored) => {
        if (!stored || cancelled) return;
        if (stored.paintMode === "fill" || stored.paintMode === "brush") {
          setPaintMode(stored.paintMode);
        }
        if (Number.isFinite(stored.tolerance)) {
          setTolerance(Math.max(4, Math.min(72, stored.tolerance)));
        }
        if (Number.isFinite(stored.gapGuard)) {
          setGapGuard(Math.max(0, Math.min(5, stored.gapGuard)));
        }
        if (Number.isFinite(stored.brushSize)) {
          setBrushSize(Math.max(4, Math.min(120, stored.brushSize)));
        }
        if (isSafeStoredImageDataUrl(stored.uploadedImage)) {
          const imageId =
            stored.uploadedImageId ??
            (await stableImageId(stored.uploadedImage));
          if (cancelled) return;
          setUploadedImage(stored.uploadedImage);
          setUploadedImageId(imageId);
        }
        if (stored.template === "upload") {
          setTemplate(
            isSafeStoredImageDataUrl(stored.uploadedImage)
              ? "upload"
              : "bear",
          );
        } else if (TEMPLATES.some((entry) => entry.id === stored.template)) {
          setTemplate(stored.template);
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    const timer = window.setTimeout(() => {
      void saveSetting<StoredColoringSettings>("coloring-tools", {
        template,
        paintMode,
        tolerance,
        gapGuard,
        brushSize,
        uploadedImage,
        uploadedImageId,
      }).catch(() => {
        setStatus("設定を端末に保存できませんでした");
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    brushSize,
    gapGuard,
    paintMode,
    settingsHydrated,
    template,
    tolerance,
    uploadedImage,
    uploadedImageId,
  ]);

  const activeProgressKey =
    template === "upload"
      ? uploadedImageId
        ? `progress-upload-${uploadedImageId}`
        : undefined
      : `progress-v2-${template}`;

  const redrawTemplate = useCallback(
    async (restore = true) => {
      const generation = redrawGeneration.current + 1;
      redrawGeneration.current = generation;
      const fill = fillCanvas.current;
      const line = lineCanvas.current;
      if (!fill || !line) return;
      const fillContext = fill.getContext("2d", { willReadFrequently: true });
      const lineContext = line.getContext("2d", { willReadFrequently: true });
      if (!fillContext || !lineContext) return;
      fillContext.clearRect(0, 0, WIDTH, HEIGHT);
      fillContext.fillStyle = "#fffdf8";
      fillContext.fillRect(0, 0, WIDTH, HEIGHT);
      lineContext.clearRect(0, 0, WIDTH, HEIGHT);

      if (template === "upload" && uploadedImage) {
        const image = await loadImage(uploadedImage);
        if (generation !== redrawGeneration.current) return;
        const scale = Math.min(WIDTH / image.width, HEIGHT / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const x = (WIDTH - width) / 2;
        const y = (HEIGHT - height) / 2;
        lineContext.drawImage(image, x, y, width, height);
        const pixels = lineContext.getImageData(0, 0, WIDTH, HEIGHT);
        prepareUploadedLineArt(pixels);
        lineContext.putImageData(pixels, 0, 0);
        fillContext.drawImage(line, 0, 0);
      } else if (template !== "upload") {
        DRAW_TEMPLATE[template](lineContext);
        fillContext.drawImage(line, 0, 0);
      }

      if (restore && activeProgressKey) {
        const saved =
          await loadColoringProgress<StoredColoringProgress>(activeProgressKey);
        if (generation !== redrawGeneration.current) return;
        if (isSafeStoredImageDataUrl(saved?.dataUrl)) {
          const image = await loadImage(saved.dataUrl);
          if (generation !== redrawGeneration.current) return;
          fillContext.clearRect(0, 0, WIDTH, HEIGHT);
          fillContext.drawImage(image, 0, 0, WIDTH, HEIGHT);
        }
      }
      undoStack.current = [];
      redoStack.current = [];
      refreshHistory();
    },
    [activeProgressKey, refreshHistory, template, uploadedImage],
  );

  useEffect(() => {
    if (!settingsHydrated) return;
    void redrawTemplate(true).catch(() => {
      setStatus("線画を読み込めませんでした。別の画像を選んでください");
    });
  }, [redrawTemplate, settingsHydrated]);

  const canvasPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          WIDTH - 1,
          ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          HEIGHT - 1,
          ((event.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT,
        ),
      ),
    };
  };

  const persist = useCallback(async () => {
    const dataUrl = fillCanvas.current?.toDataURL("image/png");
    if (!dataUrl || !activeProgressKey) return;
    await saveColoringProgress(activeProgressKey, {
      dataUrl,
      sourceId: template === "upload" ? uploadedImageId! : template,
      updatedAt: new Date().toISOString(),
    } satisfies StoredColoringProgress);
    setStatus("進み具合を保存しました");
  }, [activeProgressKey, template, uploadedImageId]);

  const pushHistory = useCallback((before: string) => {
    if (!fillCanvas.current) return;
    undoStack.current = [...undoStack.current.slice(-11), before];
    redoStack.current = [];
    refreshHistory();
    void persist();
  }, [persist, refreshHistory]);

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

  const drawSnapshot = async (dataUrl: string) => {
    const canvas = fillCanvas.current;
    if (!canvas) return;
    const image = await loadImage(dataUrl);
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, WIDTH, HEIGHT);
    context?.drawImage(image, 0, 0);
  };

  const undo = () => {
    const snapshot = undoStack.current.pop();
    if (!snapshot || !fillCanvas.current) return;
    redoStack.current.push(fillCanvas.current.toDataURL("image/png"));
    void drawSnapshot(snapshot).then(() => persist());
    refreshHistory();
  };

  const redo = () => {
    const snapshot = redoStack.current.pop();
    if (!snapshot || !fillCanvas.current) return;
    undoStack.current.push(fillCanvas.current.toDataURL("image/png"));
    void drawSnapshot(snapshot).then(() => persist());
    refreshHistory();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panEnabled) return;
    const canvas = fillCanvas.current;
    const line = lineCanvas.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    const lineContext = line?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !line || !context || !lineContext) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerId.current = event.pointerId;
    const point = canvasPoint(event);
    const before = canvas.toDataURL("image/png");
    previousPoint.current = point;
    (event.currentTarget as HTMLDivElement).dataset.before = before;

    if (paintMode === "fill") {
      const imageData = context.getImageData(0, 0, WIDTH, HEIGHT);
      const lineImageData = lineContext.getImageData(0, 0, WIDTH, HEIGHT);
      const value = color.hex.replace("#", "");
      const rgb = [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
      ] as const;
      const result = fillEnclosedRegion(
        lineImageData,
        imageData,
        point.x,
        point.y,
        [rgb[0], rgb[1], rgb[2], Math.max(5, Math.round(color.opacity * 255))],
        {
          boundaryAlphaThreshold: Math.max(12, 96 - tolerance),
          gapGuardRadius: gapGuard,
          maxPixels: WIDTH * HEIGHT,
        },
      );
      if (result.changedPixels > 0) {
        context.putImageData(imageData, 0, 0);
        pushHistory(before);
        setStatus(`${colorName}で${result.changedPixels.toLocaleString()}画素を塗りました`);
      } else {
        setStatus(
          result.reason === "boundary"
            ? "線の上ではなく、枠の内側をタップしてください"
            : result.reason === "open-region"
              ? "線のすき間が大きいため塗れません。線のすき間補正を上げてください"
            : result.reason === "no-change"
              ? "この枠はすでに同じ色で塗られています"
              : "塗りたい枠の内側をタップしてください",
        );
      }
      event.currentTarget.releasePointerCapture(event.pointerId);
      pointerId.current = undefined;
      previousPoint.current = undefined;
      delete event.currentTarget.dataset.before;
      return;
    }

    context.save();
    context.globalAlpha = Math.max(0.02, color.opacity);
    context.fillStyle = color.hex;
    context.beginPath();
    context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      paintMode !== "brush" ||
      pointerId.current !== event.pointerId ||
      !previousPoint.current
    ) {
      return;
    }
    const canvas = fillCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const point = canvasPoint(event);
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.globalAlpha = Math.max(0.02, color.opacity);
    context.strokeStyle = color.hex;
    context.beginPath();
    context.moveTo(previousPoint.current.x, previousPoint.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
    previousPoint.current = point;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (paintMode !== "brush" || pointerId.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerId.current = undefined;
    previousPoint.current = undefined;
    const before = event.currentTarget.dataset.before;
    delete event.currentTarget.dataset.before;
    const after = fillCanvas.current?.toDataURL("image/png");
    if (before && after && before !== after) {
      pushHistory(before);
      setStatus(`${colorName}でブラシ塗りしました`);
    } else {
      setStatus("キャンバスに変化はありませんでした");
    }
  };

  const selectTemplate = (next: TemplateId) => {
    setTemplate(next);
    const label = TEMPLATES.find((entry) => entry.id === next)?.label ?? "読み込んだ線画";
    setStatus(`${label}の線画を選択中`);
  };

  const exportPng = () => {
    const fill = fillCanvas.current;
    const line = lineCanvas.current;
    if (!fill || !line) return;
    const output = document.createElement("canvas");
    output.width = WIDTH;
    output.height = HEIGHT;
    const context = output.getContext("2d");
    if (!context) return;
    context.drawImage(fill, 0, 0);
    context.drawImage(line, 0, 0);
    const anchor = document.createElement("a");
    anchor.href = output.toDataURL("image/png");
    anchor.download = `カラーレシピぬりえ-${template}.png`;
    anchor.click();
  };

  return (
    <div className="studio studio--coloring" data-testid="coloring-studio">
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
            <span>ぬりえの色</span>
            <strong>{colorName}</strong>
          </div>
        </div>
        <div className="paint-mode-switch" role="group" aria-label="塗り方">
          <button
            type="button"
            className={paintMode === "fill" ? "is-selected" : ""}
            aria-pressed={paintMode === "fill"}
            onClick={() => setPaintMode("fill")}
          >
            <Grid2X2Plus size={17} aria-hidden="true" />
            タップで枠内を塗る
          </button>
          <button
            type="button"
            className={paintMode === "brush" ? "is-selected" : ""}
            aria-pressed={paintMode === "brush"}
            onClick={() => setPaintMode("brush")}
          >
            <Brush size={17} aria-hidden="true" />
            ブラシで塗る
          </button>
        </div>
        <div className="toolbar-actions">
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
          <button
            type="button"
            className="primary-toolbar-button"
            aria-label="PNG保存"
            onClick={exportPng}
          >
            <Download size={17} aria-hidden="true" /> <span>PNG保存</span>
          </button>
          <button
            ref={mobileInspectorToggle}
            type="button"
            className="mobile-inspector-toggle"
            aria-expanded={mobileInspectorOpen}
            aria-controls="coloring-inspector"
            aria-label="調整"
            onClick={() => setMobileInspectorOpen(true)}
          >
            <SlidersHorizontal size={17} aria-hidden="true" /> <span>調整</span>
          </button>
        </div>
      </div>

      <div className="coloring-layout">
        <aside className="template-rail" aria-label="線画テンプレート">
          <div className="template-rail__heading">
            <p className="eyebrow">線画を選ぶ</p>
            <h2>{TEMPLATES.length}つの絵</h2>
          </div>
          <div className="template-grid">
            {TEMPLATES.map((entry) => {
              const Icon = entry.icon;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={template === entry.id ? "is-selected" : ""}
                  aria-pressed={template === entry.id}
                  data-testid={`coloring-template-${entry.id}`}
                  onClick={() => selectTemplate(entry.id)}
                >
                  <span>
                    <Icon size={28} aria-hidden={true} />
                  </span>
                  <strong>{entry.label}</strong>
                  <small>{entry.description}</small>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="upload-line-button"
            onClick={() => uploadInput.current?.click()}
          >
            <ImagePlus size={19} aria-hidden="true" />
            自分の線画を読み込む
          </button>
          <input
            ref={uploadInput}
            data-testid="coloring-upload"
            type="file"
            tabIndex={-1}
            accept="image/png,image/jpeg,image/webp"
            className="visually-hidden"
            aria-label="PNG、JPEG、WebPの線画を読み込む"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              event.currentTarget.value = "";
              if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
                setStatus("この画像は読み込めません。PNG・JPEG・WebPを選んでください");
                return;
              }
              if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
                setStatus("画像は8MB以下のファイルを選んでください");
                return;
              }
              try {
                const dataUrl = await normalizeUploadedImage(file);
                const imageId = await stableImageId(dataUrl);
                setUploadedImage(dataUrl);
                setUploadedImageId(imageId);
                setTemplate("upload");
                setStatus("読み込んだ線画を選択中");
              } catch {
                setStatus("画像を読み込めませんでした。別の画像を選んでください");
              }
            }}
          />
        </aside>

        <section className="coloring-paper-shell" aria-label="ぬりえキャンバス">
          <CanvasZoomControls
            label="ぬりえキャンバス"
            zoom={zoom}
            panEnabled={panEnabled}
            onZoomChange={changeZoom}
            onPanEnabledChange={setPanEnabled}
          />
          <div
            ref={viewportRef}
            className={`canvas-viewport ${panEnabled ? "is-pan-enabled" : ""} ${isPanning ? "is-panning" : ""}`}
            role="region"
            aria-label="ぬりえキャンバスの表示領域"
            tabIndex={0}
            data-testid="coloring-viewport"
            {...panHandlers}
          >
            <div className="canvas-scroll-content">
              <div
                className="canvas-zoom-stage"
                style={{
                  ...stageStyle,
                  "--canvas-zoom": zoom,
                } as React.CSSProperties}
                data-testid="coloring-zoom-stage"
              >
                <div
                  className="coloring-paper"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  data-testid="coloring-canvas"
                >
                  <canvas
                    ref={fillCanvas}
                    width={WIDTH}
                    height={HEIGHT}
                    className="coloring-layer coloring-layer--fill"
                    aria-hidden="true"
                  />
                  <canvas
                    ref={lineCanvas}
                    width={WIDTH}
                    height={HEIGHT}
                    className="coloring-layer coloring-layer--line"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="canvas-status-message" aria-live="polite">
            {status}
          </p>
        </section>

        <button
          type="button"
          className={`inspector-drawer-scrim ${mobileInspectorOpen ? "is-open" : ""}`}
          aria-label="塗りの調整を閉じる"
          tabIndex={mobileInspectorOpen ? 0 : -1}
          onClick={() => setMobileInspectorOpen(false)}
        />
        <aside
          ref={mobileInspector}
          id="coloring-inspector"
          className={`coloring-inspector ${mobileInspectorOpen ? "is-mobile-open" : ""}`}
          role={mobileInspectorOpen ? "dialog" : undefined}
          aria-modal={mobileInspectorOpen ? "true" : undefined}
          aria-label="塗りの調整"
        >
          <button
            type="button"
            className="mobile-inspector-close"
            aria-label="塗りの調整を閉じる"
            onClick={() => setMobileInspectorOpen(false)}
          >
            <X size={18} aria-hidden="true" /> 閉じる
          </button>
          <section className="inspector-section">
            <p className="eyebrow">塗りの調整</p>
            <h3>{paintMode === "fill" ? "タップ塗り" : "ブラシ塗り"}</h3>
            {paintMode === "fill" ? (
              <>
                <label className="range-control">
                  <span>
                    線の感度
                    <strong>{tolerance}</strong>
                  </span>
                  <input
                    type="range"
                    min="4"
                    max="72"
                    value={tolerance}
                    onChange={(event) => setTolerance(Number(event.target.value))}
                  />
                </label>
                <label className="range-control">
                  <span>
                    線のすき間をとじる
                    <strong>{gapGuard}px</strong>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="5"
                    value={gapGuard}
                    onChange={(event) => setGapGuard(Number(event.target.value))}
                  />
                </label>
              </>
            ) : (
              <label className="range-control">
                <span>
                  ブラシサイズ
                  <strong>{brushSize}</strong>
                </span>
                <input
                  type="range"
                  min="4"
                  max="120"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              </label>
            )}
          </section>
          <section className="coloring-guide">
            <Upload size={21} aria-hidden="true" />
            <div>
              <strong>線はいつも一番上</strong>
              <p>
                色を重ねても線画は消えません。少し開いた線も、すき間補正が外への漏れを抑えます。
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
