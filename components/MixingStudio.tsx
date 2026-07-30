"use client";

import {
  Check,
  Droplet,
  Eraser,
  HelpCircle,
  Pipette,
  RefreshCw,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import type {
  CanvasTexture,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderer,
} from "three";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MaterialId,
  MixedColorSnapshot,
  MixGesture,
  MixerTool,
  PaintSize,
  PaintStep,
  PaintShape,
  RecipeUnits,
  SavedColor,
} from "../lib/types";
import {
  MATERIAL_COLORS,
  MATERIAL_IDS,
  MATERIAL_LABELS,
  MATERIAL_REGISTRY,
  PIGMENT_IDS,
} from "../lib/types";
import {
  createSpatialPaintSampler,
  sampleSpatialPaint,
  type SpatialPaintSample,
} from "../lib/spatialMix";
import {
  appendStrokeSamples,
  beginStrokeSampling,
  finishStrokeSampling,
  MAX_MIXER_STROKE_POINTS,
  type StrokePoint,
  type StrokeSamplerState,
} from "../lib/strokeSampling";
import { rgbToHex, rgbToHsl } from "../lib/colorScience";
import { paintStepUnits } from "../lib/paintSteps";
import { RecipeInspector } from "./RecipeInspector";

type MixerState = {
  recipe: RecipeUnits;
  steps: PaintStep[];
  mixGestures: MixGesture[];
};

type MixingStudioProps = {
  state: MixerState;
  mixed: MixedColorSnapshot;
  selectedMaterial: MixerTool;
  size: PaintSize;
  detailed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  announcement: string;
  recipeColors: SavedColor[];
  selectedRecipeColor?: SavedColor;
  onSelectMaterial: (material: MixerTool) => void;
  onSelectRecipeColor: (color: SavedColor) => void;
  onSizeChange: (size: PaintSize) => void;
  onAdd: (
    material: MaterialId,
    size: PaintSize,
    x: number,
    y: number,
    placement?: PaintPlacement,
  ) => void;
  onStretchMaterial: (
    material: MaterialId,
    size: PaintSize,
    points: Array<{ x: number; y: number }>,
    originDeposit: number,
    waveSeed: number,
  ) => boolean;
  onAddRecipe: (
    color: SavedColor,
    size: PaintSize,
    x: number,
    y: number,
    placement?: PaintPlacement,
  ) => void;
  onStretchRecipe: (
    color: SavedColor,
    size: PaintSize,
    points: Array<{ x: number; y: number }>,
    originDeposit: number,
    waveSeed: number,
  ) => boolean;
  onErase: (x: number, y: number) => void;
  onMixAll: () => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDetailed: () => void;
  onHelp: () => void;
  onRegisterColor: (sample?: SpatialPaintSample) => void;
};

const CANVAS_WIDTH = 1100;
const DEFAULT_CANVAS_HEIGHT = 760;
const HOLD_THRESHOLD_MS = 320;
const HOLD_UNIT_INTERVAL_MS = 260;
const HOLD_MAX_DEPOSIT = 8;
const STRETCH_SPACING_FACTOR = 0.62;

type PaintPlacement = {
  deposit?: number;
  shape?: PaintShape;
  waveSeed?: number;
};

type HoldPreview = {
  x: number;
  y: number;
  deposit: number;
  color: string;
  seed: number;
  role: "pigment" | "water";
};

type ActivePointerSelection = {
  material: MixerTool;
  recipeColorId?: string;
  recipeColor?: SavedColor;
  size: PaintSize;
  previewColor?: string;
  water: boolean;
  eraser: boolean;
};

type PointerSample = Pick<
  PointerEvent,
  "clientX" | "clientY" | "pressure" | "pointerType" | "timeStamp"
>;

function collectPointerSamples(event: PointerEvent): PointerSample[] {
  if (typeof event.getCoalescedEvents === "function") {
    try {
      const samples = event.getCoalescedEvents();
      return samples.length > 0 ? samples : [event];
    } catch {
      // Older WebViews can expose this method without implementing it.
    }
  }
  return [event];
}

const sizeRadius: Record<PaintSize, number> = {
  small: 48,
  medium: 76,
  large: 108,
};

function holdDepositForDuration(durationMs: number) {
  if (durationMs < HOLD_THRESHOLD_MS) return 1;
  return Math.min(
    HOLD_MAX_DEPOSIT,
    2 +
      Math.floor(
        Math.max(0, durationMs - HOLD_THRESHOLD_MS) /
          HOLD_UNIT_INTERVAL_MS,
      ),
  );
}

function holdWaveAmplitude(deposit: number) {
  if (deposit <= 1) return 0;
  return Math.min(0.085, 0.028 + Math.max(0, deposit - 2) * 0.008);
}

function holdSpread(deposit: number) {
  if (deposit <= 1) return 1;
  return Math.min(1.3, 1.16 + Math.max(0, deposit - 2) * 0.024);
}

function holdClipPath(seed: number, deposit: number) {
  if (deposit <= 1) return "circle(50% at 50% 50%)";
  const amplitude = holdWaveAmplitude(deposit);
  const phase = seed * Math.PI * 2;
  const support = 1 + amplitude;
  const points = Array.from({ length: 36 }, (_, index) => {
    const angle = (index / 36) * Math.PI * 2;
    const wave =
      1 +
      amplitude *
        (0.68 * Math.sin(angle * 6 + phase) +
          0.32 * Math.sin(angle * 11 - phase * 0.73));
    const radius = (50 / support) * wave;
    return `${50 + Math.cos(angle) * radius}% ${50 + Math.sin(angle) * radius}%`;
  });
  return `polygon(${points.join(",")})`;
}

const materialButtons: Array<{
  id: MixerTool;
  label: string;
  shortcut: string;
}> = [
  ...MATERIAL_IDS.map((id) => ({
    id,
    label: MATERIAL_REGISTRY[id].label,
    shortcut: MATERIAL_REGISTRY[id].shortcut,
  })),
  { id: "eraser", label: "消す", shortcut: "E" },
  { id: "picker", label: "スポイト", shortcut: "I" },
];

const isMaterialTool = (tool: MixerTool): tool is MaterialId =>
  (MATERIAL_IDS as readonly MixerTool[]).includes(tool);

function hashNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawPaintDab(
  context: CanvasRenderingContext2D,
  step: PaintStep,
  index: number,
  canvasHeight: number,
  offset = { x: 0, y: 0 },
) {
  const x = step.x * CANVAS_WIDTH + offset.x;
  const y = step.y * canvasHeight + offset.y;
  const radius = sizeRadius[step.size];
  const waterUnits = paintStepUnits(step, "water");
  const pigmentUnits = PIGMENT_IDS.reduce(
    (total, pigment) => total + paintStepUnits(step, pigment),
    0,
  );

  if (waterUnits > 0) {
    context.save();
    context.globalAlpha =
      0.25 + 0.75 * (waterUnits / Math.max(1, waterUnits + pigmentUnits));
    context.globalCompositeOperation = "screen";
    const gradient = context.createRadialGradient(
      x - radius * 0.25,
      y - radius * 0.3,
      2,
      x,
      y,
      radius * 1.25,
    );
    gradient.addColorStop(0, "rgba(255,255,255,.3)");
    gradient.addColorStop(0.35, "rgba(159,211,219,.1)");
    gradient.addColorStop(0.8, "rgba(74,147,160,.025)");
    gradient.addColorStop(1, "rgba(74,147,160,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius * 1.42, radius * 1.42, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(
      x - radius * 0.26,
      y - radius * 0.3,
      radius * 0.24,
      radius * 0.1,
      -0.2,
      0,
      Math.PI * 2,
    );
    context.strokeStyle = "rgba(255,255,255,.5)";
    context.lineWidth = 1.4;
    context.stroke();
    context.restore();
    return;
  }

  const color = MATERIAL_COLORS[step.material];
  const irregularity = 0.08 + hashNoise(index + 8) * 0.08;
  const points = 28;
  context.save();
  context.globalAlpha = step.material === "white" ? 0.78 : 0.94;
  context.beginPath();
  for (let point = 0; point <= points; point += 1) {
    const angle = (point / points) * Math.PI * 2;
    const wobble =
      1 +
      Math.sin(angle * 5 + index) * irregularity +
      Math.sin(angle * 9 + index * 0.7) * 0.025;
    const px = x + Math.cos(angle) * radius * wobble;
    const py = y + Math.sin(angle) * radius * wobble * 0.82;
    if (point === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
  const gradient = context.createRadialGradient(
    x - radius * 0.28,
    y - radius * 0.34,
    radius * 0.08,
    x,
    y,
    radius * 1.05,
  );
  gradient.addColorStop(0, hexToRgba(color, step.material === "white" ? 0.84 : 0.9));
  gradient.addColorStop(0.5, hexToRgba(color, 0.9));
  gradient.addColorStop(0.8, hexToRgba(color, 0.72));
  gradient.addColorStop(1, hexToRgba(color, 0.12));
  context.fillStyle = gradient;
  context.shadowColor = hexToRgba(color, 0.12);
  context.shadowBlur = 15;
  context.shadowOffsetY = 2;
  context.fill();
  context.shadowColor = "transparent";

  context.strokeStyle =
    step.material === "white"
      ? "rgba(117,101,84,.14)"
      : hexToRgba(color, 0.16);
  context.lineWidth = 1.15;
  context.stroke();

  context.beginPath();
  context.ellipse(
    x - radius * 0.24,
    y - radius * 0.3,
    radius * 0.34,
    radius * 0.12,
    -0.2,
    0,
    Math.PI * 2,
  );
  context.strokeStyle = "rgba(255,255,255,.25)";
  context.lineWidth = Math.max(1.5, radius * 0.025);
  context.stroke();
  context.restore();
}

function drawSpatialMixField(
  context: CanvasRenderingContext2D,
  state: MixerState,
  canvasHeight: number,
) {
  if (state.steps.length === 0 && state.mixGestures.length === 0) return;
  const complexity = state.steps.length + state.mixGestures.length * 4;
  const targetPixels =
    complexity > 96 ? 24_000 : complexity > 48 ? 38_000 : 68_000;
  const aspectRatio = CANVAS_WIDTH / canvasHeight;
  const fieldWidth = Math.max(
    112,
    Math.round(Math.sqrt(targetPixels * aspectRatio)),
  );
  const fieldHeight = Math.max(
    96,
    Math.round(fieldWidth / aspectRatio),
  );
  const field = document.createElement("canvas");
  field.width = fieldWidth;
  field.height = fieldHeight;
  const fieldContext = field.getContext("2d");
  if (!fieldContext) return;
  const pixels = fieldContext.createImageData(fieldWidth, fieldHeight);
  const colourCache = new Map<string, SpatialPaintSample["mixed"]>();
  const sample = createSpatialPaintSampler(state, {
    width: CANVAS_WIDTH,
    height: canvasHeight,
  });

  for (let y = 0; y < fieldHeight; y += 1) {
    for (let x = 0; x < fieldWidth; x += 1) {
      const sampledPixel = sample(
        (x + 0.5) / fieldWidth,
        (y + 0.5) / fieldHeight,
        colourCache,
      );
      if (sampledPixel.coverage <= 0.002) continue;
      const offset = (y * fieldWidth + x) * 4;
      const dryBody = (1 - sampledPixel.waterRatio) ** 2;
      // Undiluted tube paint forms a dense body with a clean boundary.
      // Water continues to bypass this body mask and uses the softer raw
      // coverage below, so only deliberately wetted areas become a wash.
      const edgeStart = 0.045;
      const edgeProgress = Math.min(
        1,
        Math.max(0, (sampledPixel.coverage - edgeStart) / 0.18),
      );
      const bodyCoverage =
        edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
      const renderedCoverage = Math.min(
        1,
        Math.max(
          0,
          (sampledPixel.coverage * (1 - dryBody) +
            bodyCoverage *
              (0.86 + 0.14 * sampledPixel.coverage) *
              dryBody),
        ),
      );
      pixels.data[offset] = sampledPixel.mixed.rgb.r;
      pixels.data[offset + 1] = sampledPixel.mixed.rgb.g;
      pixels.data[offset + 2] = sampledPixel.mixed.rgb.b;
      pixels.data[offset + 3] = Math.round(
        renderedCoverage *
          sampledPixel.mixed.opacity *
          255,
      );
    }
  }

  fieldContext.putImageData(pixels, 0, 0);
  context.save();
  context.imageSmoothingEnabled = true;
  context.globalCompositeOperation = "source-over";
  context.drawImage(field, 0, 0, CANVAS_WIDTH, canvasHeight);
  context.restore();
}

export function MixingStudio({
  state,
  mixed,
  selectedMaterial,
  size,
  detailed,
  canUndo,
  canRedo,
  announcement,
  recipeColors,
  selectedRecipeColor,
  onSelectMaterial,
  onSelectRecipeColor,
  onSizeChange,
  onAdd,
  onStretchMaterial,
  onAddRecipe,
  onStretchRecipe,
  onErase,
  onMixAll,
  onClear,
  onUndo,
  onRedo,
  onToggleDetailed,
  onHelp,
  onRegisterColor,
}: MixingStudioProps) {
  const paintSurface = useRef<HTMLDivElement>(null);
  const paintCanvas = useRef<HTMLCanvasElement>(null);
  const glossCanvas = useRef<HTMLCanvasElement>(null);
  const gesturePreviewCanvas = useRef<HTMLCanvasElement>(null);
  const textureRef = useRef<CanvasTexture | undefined>(undefined);
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined);
  const shaderMaterialRef = useRef<ShaderMaterial | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const renderRef = useRef<(() => void) | undefined>(undefined);
  const initializeGlossRef = useRef<(() => void) | undefined>(undefined);
  const webglLoadingRef = useRef(false);
  const pointerStroke = useRef<StrokeSamplerState | undefined>(undefined);
  const pendingSamplePoint = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const sampleFrameRef = useRef<number | undefined>(undefined);
  const gestureClearFrameRef = useRef<number | undefined>(undefined);
  const holdFrameRef = useRef<number | undefined>(undefined);
  const holdStartedAtRef = useRef<number | undefined>(undefined);
  const holdDepositRef = useRef(1);
  const holdSeedRef = useRef(0);
  const stretching = useRef(false);
  const gestureCancelled = useRef(false);
  const stretchOriginDepositRef = useRef(1);
  const activePointerId = useRef<number | undefined>(undefined);
  const activePointerSelection = useRef<
    ActivePointerSelection | undefined
  >(undefined);
  const [webglReady, setWebglReady] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_HEIGHT);
  const [samplePoint, setSamplePoint] = useState<{ x: number; y: number }>();
  const [sampledPaint, setSampledPaint] = useState<SpatialPaintSample>();
  const [holdPreview, setHoldPreview] = useState<HoldPreview>();
  const isPicker = !selectedRecipeColor && selectedMaterial === "picker";
  const isWater = !selectedRecipeColor && selectedMaterial === "water";
  const isEraser = !selectedRecipeColor && selectedMaterial === "eraser";
  const activeSampledPaint =
    isPicker ? sampledPaint : undefined;
  const pigmentUnits = useMemo(
    () =>
      PIGMENT_IDS.reduce(
        (total, material) => total + state.recipe[material],
        0,
      ),
    [state.recipe],
  );
  const recipeUnits = useMemo(
    () =>
      MATERIAL_IDS.reduce(
        (total, material) => total + state.recipe[material],
        0,
      ),
    [state.recipe],
  );
  const hasPaletteContent =
    recipeUnits > 0 ||
    state.steps.length > 0 ||
    state.mixGestures.length > 0;
  const sampleAnnouncement = useMemo(() => {
    if (!activeSampledPaint) return "";
    const ratio = PIGMENT_IDS
      .filter((material) => activeSampledPaint.pigmentRatio[material] > 0.0001)
      .map(
        (material) =>
          `${MATERIAL_LABELS[material]} ${(
            activeSampledPaint.pigmentRatio[material] * 100
          ).toFixed(1)}パーセント`,
      )
      .join("、");
    return ratio
      ? `スポイト結果。${activeSampledPaint.mixed.name}。${ratio}。`
      : activeSampledPaint.weights.water > 0.0001
        ? `スポイト結果。透明な水。水分量${Math.round(activeSampledPaint.waterRatio * 100)}パーセント。`
        : "スポイト結果。この場所には絵の具がありません。";
  }, [activeSampledPaint]);

  useEffect(() => {
    const surface = paintSurface.current;
    if (!surface) return;
    const updateCanvasHeight = () => {
      const rect = surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextHeight = Math.max(
        480,
        Math.min(2200, Math.round((CANVAS_WIDTH * rect.height) / rect.width)),
      );
      setCanvasHeight((current) =>
        Math.abs(current - nextHeight) > 2 ? nextHeight : current,
      );
    };
    updateCanvasHeight();
    const observer = new ResizeObserver(updateCanvasHeight);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const updateTexture = useCallback(() => {
    if (textureRef.current) textureRef.current.needsUpdate = true;
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => renderRef.current?.());
  }, []);

  const readRenderedPixel = useCallback(
    (point: { x: number; y: number }) => {
      const target = glossCanvas.current;
      const renderer = rendererRef.current;
      if (webglReady && target && renderer) {
        try {
          if (textureRef.current) textureRef.current.needsUpdate = true;
          renderRef.current?.();
          const context = renderer.getContext();
          if (!context.isContextLost()) {
            const pixel = new Uint8Array(4);
            const x = Math.max(
              0,
              Math.min(target.width - 1, Math.floor(point.x * target.width)),
            );
            const y = Math.max(
              0,
              Math.min(
                target.height - 1,
                target.height - 1 - Math.floor(point.y * target.height),
              ),
            );
            context.readPixels(
              x,
              y,
              1,
              1,
              context.RGBA,
              context.UNSIGNED_BYTE,
              pixel,
            );
            return pixel;
          }
        } catch {
          // Fall through to the visible 2D layer.
        }
      }

      const source = paintCanvas.current;
      const context = source?.getContext("2d", { willReadFrequently: true });
      if (!source || !context) return undefined;
      const x = Math.max(
        0,
        Math.min(source.width - 1, Math.floor(point.x * source.width)),
      );
      const y = Math.max(
        0,
        Math.min(source.height - 1, Math.floor(point.y * source.height)),
      );
      return context.getImageData(x, y, 1, 1).data;
    },
    [webglReady],
  );

  const captureSample = useCallback(
    (point: { x: number; y: number }) => {
      const sample = sampleSpatialPaint(
        state,
        point.x,
        point.y,
        undefined,
        { width: CANVAS_WIDTH, height: canvasHeight },
      );
      const pixel = readRenderedPixel(point);
      if (pixel && pixel[3] > 0) {
        const rgb = { r: pixel[0], g: pixel[1], b: pixel[2] };
        sample.mixed = {
          ...sample.mixed,
          hex: rgbToHex(rgb),
          rgb,
          hsl: rgbToHsl(rgb),
          opacity: Math.round((pixel[3] / 255) * 1_000) / 1_000,
        };
      }
      setSampledPaint(sample);
      return sample;
    },
    [canvasHeight, readRenderedPixel, state],
  );

  const captureSampleAt = useCallback(
    (point: { x: number; y: number }) => {
      setSamplePoint(point);
      return captureSample(point);
    },
    [captureSample],
  );

  const scheduleSampleAt = useCallback(
    (point: { x: number; y: number }) => {
      setSamplePoint(point);
      pendingSamplePoint.current = point;
      if (sampleFrameRef.current) return;
      sampleFrameRef.current = window.requestAnimationFrame(() => {
        sampleFrameRef.current = undefined;
        const pending = pendingSamplePoint.current;
        pendingSamplePoint.current = undefined;
        if (pending) captureSample(pending);
      });
    },
    [captureSample],
  );

  const clearSample = useCallback(() => {
    if (sampleFrameRef.current) {
      window.cancelAnimationFrame(sampleFrameRef.current);
      sampleFrameRef.current = undefined;
    }
    pendingSamplePoint.current = undefined;
    setSamplePoint(undefined);
    setSampledPaint(undefined);
  }, []);

  const redraw = useCallback(() => {
    const canvas = paintCanvas.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, CANVAS_WIDTH, canvasHeight);
    drawSpatialMixField(context, state, canvasHeight);
    state.steps.forEach((step, index) => {
      if (paintStepUnits(step, "water") > 0) {
        drawPaintDab(context, step, index, canvasHeight);
      }
    });
    updateTexture();
  }, [canvasHeight, state, updateTexture]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!isPicker || !samplePoint) return;
    const point = samplePoint;
    const frame = window.requestAnimationFrame(() => captureSample(point));
    return () => window.cancelAnimationFrame(frame);
  }, [captureSample, isPicker, samplePoint]);

  useEffect(
    () => () => {
      if (sampleFrameRef.current) {
        window.cancelAnimationFrame(sampleFrameRef.current);
      }
      if (holdFrameRef.current) {
        window.cancelAnimationFrame(holdFrameRef.current);
      }
      if (gestureClearFrameRef.current) {
        window.cancelAnimationFrame(gestureClearFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const target = glossCanvas.current;
    const source = paintCanvas.current;
    if (!target || !source) return;

    let disposed = false;
    let renderer: WebGLRenderer | undefined;
    let material: ShaderMaterial | undefined;
    let geometry: PlaneGeometry | undefined;

    initializeGlossRef.current = () => {
      if (
        disposed ||
        rendererRef.current ||
        webglLoadingRef.current
      ) {
        return;
      }
      webglLoadingRef.current = true;
      void import("three")
        .then((THREE) => {
          if (disposed) return;
          try {
            renderer = new THREE.WebGLRenderer({
              canvas: target,
              alpha: true,
              antialias: false,
              depth: false,
              premultipliedAlpha: false,
              powerPreference: "low-power",
            });
            // The source canvas already renders above CSS-pixel resolution.
            // A second device-pixel scaling pass wastes memory on phones.
            renderer.setPixelRatio(1);
            renderer.setSize(source.width, source.height, false);
            rendererRef.current = renderer;

            const scene = new THREE.Scene();
            const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
            camera.position.z = 1;
            const texture = new THREE.CanvasTexture(source);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.LinearFilter;
            textureRef.current = texture;
            geometry = new THREE.PlaneGeometry(2, 2);
            material = new THREE.ShaderMaterial({
              transparent: false,
              blending: THREE.NoBlending,
              depthWrite: false,
              uniforms: {
                paintMap: { value: texture },
                texel: {
                  value: new THREE.Vector2(
                    1 / source.width,
                    1 / source.height,
                  ),
                },
              },
              vertexShader: `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
              }
            `,
              fragmentShader: `
              precision highp float;
              varying vec2 vUv;
              uniform sampler2D paintMap;
              uniform vec2 texel;
              void main() {
                vec4 base = texture2D(paintMap, vUv);
                if (base.a < .005) discard;
                float leftA = texture2D(paintMap, vUv - vec2(texel.x * 4.0, 0.)).a;
                float rightA = texture2D(paintMap, vUv + vec2(texel.x * 4.0, 0.)).a;
                float downA = texture2D(paintMap, vUv - vec2(0., texel.y * 4.0)).a;
                float upA = texture2D(paintMap, vUv + vec2(0., texel.y * 4.0)).a;
                vec3 normal = normalize(vec3((leftA-rightA)*.72, (downA-upA)*.72, .78));
                vec3 light = normalize(vec3(-.42, .66, .82));
                float diffuse = .9 + max(dot(normal, light), 0.) * .1;
                float specular = pow(max(dot(reflect(-light, normal), vec3(0.,0.,1.)), 0.), 18.0);
                float grain = sin(vUv.x * 740. + vUv.y * 430.) * .009;
                vec3 color = base.rgb * (diffuse + grain) + vec3(specular * .09 * base.a);
                gl_FragColor = vec4(color, base.a);
                #include <colorspace_fragment>
              }
            `,
            });
            shaderMaterialRef.current = material;
            scene.add(new THREE.Mesh(geometry, material));
            renderRef.current = () => renderer?.render(scene, camera);
            texture.needsUpdate = true;
            renderRef.current();
            window.requestAnimationFrame(() => {
              if (!disposed) setWebglReady(true);
            });
          } catch {
            // Canvas 2D remains visible as the no-WebGL fallback.
          }
        })
        .finally(() => {
          webglLoadingRef.current = false;
        });
    };

    return () => {
      disposed = true;
      initializeGlossRef.current = undefined;
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      renderRef.current = undefined;
      textureRef.current?.dispose();
      material?.dispose();
      geometry?.dispose();
      renderer?.dispose();
      textureRef.current = undefined;
      shaderMaterialRef.current = undefined;
      rendererRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (state.steps.length > 0) initializeGlossRef.current?.();
  }, [state.steps.length]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setWebglReady(false);
    renderer.setSize(CANVAS_WIDTH, canvasHeight, false);
    const texel = shaderMaterialRef.current?.uniforms.texel?.value;
    if (texel && typeof texel.set === "function") {
      texel.set(1 / CANVAS_WIDTH, 1 / canvasHeight);
    }
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      if (textureRef.current) textureRef.current.needsUpdate = true;
      renderRef.current?.();
      setWebglReady(true);
    });
  }, [canvasHeight]);

  const toNormalizedPoint = (
    sample: PointerSample,
    surfaceRect?: DOMRect,
  ): StrokePoint => {
    const rect =
      surfaceRect ?? paintCanvas.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        x: 0,
        y: 0,
        time: sample.timeStamp,
        pressure: sample.pressure > 0 ? sample.pressure : 0.5,
      };
    }
    return {
      x: Math.max(0, Math.min(1, (sample.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (sample.clientY - rect.top) / rect.height)),
      time: sample.timeStamp,
      pressure: sample.pressure > 0 ? sample.pressure : 0.5,
    };
  };

  const clearGesturePreview = () => {
    if (gestureClearFrameRef.current) {
      window.cancelAnimationFrame(gestureClearFrameRef.current);
      gestureClearFrameRef.current = undefined;
    }
    const canvas = gesturePreviewCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const clearGesturePreviewAfterCommit = () => {
    if (gestureClearFrameRef.current) {
      window.cancelAnimationFrame(gestureClearFrameRef.current);
    }
    // Keep the live paint visible until React has committed and redrawn the
    // authoritative canvas. Two frames avoid a blank flash on WebKit where
    // passive effects can land after the first animation callback.
    gestureClearFrameRef.current = window.requestAnimationFrame(() => {
      gestureClearFrameRef.current = window.requestAnimationFrame(() => {
        gestureClearFrameRef.current = undefined;
        const canvas = gesturePreviewCanvas.current;
        const context = canvas?.getContext("2d");
        if (canvas && context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
        }
      });
    });
  };

  const previewStretch = (path: readonly StrokePoint[]) => {
    const canvas = gesturePreviewCanvas.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (path.length === 0) return;

    const startedSelection = activePointerSelection.current;
    const selectedColor = startedSelection?.previewColor;
    if (!startedSelection || !selectedColor) return;
    const radius = sizeRadius[startedSelection.size];
    const first = path[0];
    const current = path[path.length - 1];
    const startX = first.x * CANVAS_WIDTH;
    const startY = first.y * canvasHeight;
    const endX = current.x * CANVAS_WIDTH;
    const endY = current.y * canvasHeight;

    const tracePath = () => {
      context.beginPath();
      context.moveTo(startX, startY);
      for (let index = 1; index < path.length; index += 1) {
        context.lineTo(
          path[index].x * CANVAS_WIDTH,
          path[index].y * canvasHeight,
        );
      }
    };

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    tracePath();
    if (startedSelection.water) {
      context.globalCompositeOperation = "screen";
      context.strokeStyle = "rgba(106, 176, 190, 0.24)";
      context.lineWidth = radius * 2 * 1.42;
      context.stroke();
      if (path.length === 1) {
        context.fillStyle = "rgba(106, 176, 190, 0.24)";
        context.beginPath();
        context.arc(endX, endY, radius * 1.42, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      // This is a placement preview, not a mix preview. Keep the selected
      // paint visually dominant even when the path crosses an existing mix.
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = hexToRgba(selectedColor, 0.95);
      context.lineWidth = radius * 1.9;
      context.stroke();
      tracePath();
      context.strokeStyle = hexToRgba(selectedColor, 0.995);
      context.lineWidth = radius * 1.12;
      context.stroke();
    }

    if (!startedSelection.water) {
      const phase =
        hashNoise(
          holdSeedRef.current * 1_337 +
            current.x * 1_913 +
            current.y * 2_539 +
            path.length * 0.618,
        ) *
        Math.PI *
        2;
      context.fillStyle = hexToRgba(selectedColor, 0.98);
      context.beginPath();
      for (let index = 0; index <= 28; index += 1) {
        const angle = (index / 28) * Math.PI * 2;
        const wave =
          0.92 +
          Math.sin(angle * 6 + phase) * 0.055 +
          Math.sin(angle * 11 - phase * 0.7) * 0.025;
        const x = endX + Math.cos(angle) * radius * wave;
        const y = endY + Math.sin(angle) * radius * wave;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    }
    context.restore();
  };

  const stopHoldPreview = () => {
    if (holdFrameRef.current) {
      window.cancelAnimationFrame(holdFrameRef.current);
      holdFrameRef.current = undefined;
    }
    holdStartedAtRef.current = undefined;
    holdDepositRef.current = 1;
    setHoldPreview(undefined);
  };

  const startHoldPreview = (point: { x: number; y: number }) => {
    const startedSelection = activePointerSelection.current;
    if (
      !startedSelection ||
      startedSelection.material === "picker" ||
      startedSelection.eraser
    ) {
      return;
    }
    const role = startedSelection?.water ? "water" : "pigment";
    const color = startedSelection?.previewColor;
    if (!color) return;
    const startedAt = performance.now();
    const seed = hashNoise(
      point.x * 997 + point.y * 619 + startedAt * 0.001,
    );
    holdStartedAtRef.current = startedAt;
    holdDepositRef.current = 1;
    holdSeedRef.current = seed;
    setHoldPreview({
      x: point.x,
      y: point.y,
      deposit: 1,
      color,
      seed,
      role,
    });

    const update = () => {
      if (
        activePointerId.current === undefined ||
        stretching.current ||
        holdStartedAtRef.current === undefined
      ) {
        holdFrameRef.current = undefined;
        return;
      }
      const deposit = holdDepositForDuration(
        performance.now() - holdStartedAtRef.current,
      );
      if (deposit !== holdDepositRef.current) {
        holdDepositRef.current = deposit;
        setHoldPreview({
          x: point.x,
          y: point.y,
          deposit,
          color,
          seed,
          role,
        });
      }
      holdFrameRef.current = window.requestAnimationFrame(update);
    };
    holdFrameRef.current = window.requestAnimationFrame(update);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (
      !event.isPrimary ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    if (activePointerId.current !== undefined) return;
    const startedSelection: ActivePointerSelection = {
      material: selectedMaterial,
      recipeColorId: selectedRecipeColor?.id,
      recipeColor: selectedRecipeColor
        ? {
            ...selectedRecipeColor,
            recipe: { ...selectedRecipeColor.recipe },
          }
        : undefined,
      size,
      previewColor: selectedRecipeColor
        ? (selectedRecipeColor.capturedAppearance?.hex ??
          selectedRecipeColor.mixed.hex)
        : isMaterialTool(selectedMaterial)
          ? MATERIAL_COLORS[selectedMaterial]
          : undefined,
      water: isWater,
      eraser: isEraser,
    };
    activePointerId.current = event.pointerId;
    activePointerSelection.current = startedSelection;
    event.currentTarget.setPointerCapture(event.pointerId);
    const surfaceRect =
      paintCanvas.current?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    const point = toNormalizedPoint(event.nativeEvent, surfaceRect);
    pointerStroke.current = beginStrokeSampling(point);
    clearGesturePreview();
    stretching.current = false;
    gestureCancelled.current = false;
    stretchOriginDepositRef.current = 1;
    if (startedSelection.material === "picker") {
      captureSampleAt({ x: point.x, y: point.y });
    } else {
      startHoldPreview(point);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const startedSelection = activePointerSelection.current;
    const stroke = pointerStroke.current;
    if (!startedSelection || !stroke) return;
    const surfaceRect =
      paintCanvas.current?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    const samples = collectPointerSamples(event.nativeEvent).map((sample) =>
      toNormalizedPoint(sample, surfaceRect),
    );
    const point = samples[samples.length - 1];
    if (startedSelection.material === "picker") {
      scheduleSampleAt({ x: point.x, y: point.y });
      return;
    }
    if (gestureCancelled.current) {
      return;
    }
    const origin = stroke.placements[0];
    const distancePixels = origin
      ? Math.hypot(
          (point.x - origin.x) * surfaceRect.width,
          (point.y - origin.y) * surfaceRect.height,
        )
      : 0;
    // Keep tiny finger jitter as a centred tap, but begin a real stroke as
    // soon as the user intentionally moves—no long-press wait.
    const dragThreshold = startedSelection.eraser
      ? event.pointerType === "touch"
        ? 10
        : 5
      : event.pointerType === "touch"
        ? 6
        : 3;
    if (distancePixels < dragThreshold) return;

    if (!stretching.current) {
      const deposit =
        holdStartedAtRef.current === undefined
          ? 1
          : holdDepositForDuration(
              performance.now() - holdStartedAtRef.current,
            );
      if (startedSelection.eraser) {
        // Erasing remains a deliberate tap; pigments, saved recipes, and
        // water begin stretching immediately.
        gestureCancelled.current = true;
        stopHoldPreview();
        redraw();
        return;
      }
      stretchOriginDepositRef.current = deposit;
      stretching.current = true;
      stopHoldPreview();
    }

    const samplingOptions = {
      spacing: sizeRadius[startedSelection.size] * STRETCH_SPACING_FACTOR,
      scaleX: CANVAS_WIDTH,
      scaleY: canvasHeight,
      maxPoints: MAX_MIXER_STROKE_POINTS,
    };
    const appended = appendStrokeSamples(stroke, samples, samplingOptions);
    pointerStroke.current = appended.state;
    // Show the live tail immediately, even before it reaches the next fixed
    // placement. The authoritative state still uses fixed-distance samples,
    // and pointerup finalises the same tail with the same function.
    const preview = finishStrokeSampling(
      appended.state,
      point,
      samplingOptions,
    );
    previewStretch(preview.state.placements);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    const surfaceRect =
      paintCanvas.current?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    const pointerUpSamples = collectPointerSamples(event.nativeEvent).map(
      (sample) => toNormalizedPoint(sample, surfaceRect),
    );
    const point = toNormalizedPoint(event.nativeEvent, surfaceRect);
    const stroke =
      pointerStroke.current ?? beginStrokeSampling(point);
    // A finger can drift a few pixels before pointerup without becoming a
    // drag. Keep a tap anchored to its first contact so the dab is centred
    // exactly where the user touched.
    const tapPoint = stroke.placements[0] ?? point;
    const holdDuration =
      holdStartedAtRef.current === undefined
        ? 0
        : performance.now() - holdStartedAtRef.current;
    const wasStretching = stretching.current;
    const wasCancelled = gestureCancelled.current;
    const deposit = wasStretching
      ? stretchOriginDepositRef.current
      : holdDepositForDuration(holdDuration);
    const placement: PaintPlacement =
      deposit > 1
        ? {
            deposit,
            shape: "hold",
            waveSeed: holdSeedRef.current,
          }
        : { shape: "tap" };
    const startedSelection = activePointerSelection.current;
    const selectionIsUnchanged =
      startedSelection !== undefined &&
      startedSelection.material === selectedMaterial &&
      startedSelection.recipeColorId === selectedRecipeColor?.id &&
      startedSelection.size === size;
    activePointerId.current = undefined;
    activePointerSelection.current = undefined;
    stopHoldPreview();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!selectionIsUnchanged || !startedSelection || wasCancelled) {
      clearGesturePreview();
      redraw();
    } else if (startedSelection.material === "picker") {
      clearGesturePreview();
      if (sampleFrameRef.current) {
        window.cancelAnimationFrame(sampleFrameRef.current);
        sampleFrameRef.current = undefined;
      }
      pendingSamplePoint.current = undefined;
      captureSampleAt({ x: point.x, y: point.y });
    } else if (wasStretching) {
      const samplingOptions = {
        spacing:
          sizeRadius[startedSelection.size] * STRETCH_SPACING_FACTOR,
        scaleX: CANVAS_WIDTH,
        scaleY: canvasHeight,
        maxPoints: MAX_MIXER_STROKE_POINTS,
      };
      const beforeEndpoint = appendStrokeSamples(
        stroke,
        pointerUpSamples,
        samplingOptions,
      );
      const finished = finishStrokeSampling(
        beforeEndpoint.state,
        point,
        samplingOptions,
      );
      const stretchPoints = finished.state.placements.map(
        ({ x, y }) => ({ x, y }),
      );
      const added = startedSelection.recipeColor
        ? onStretchRecipe(
            startedSelection.recipeColor,
            startedSelection.size,
            stretchPoints,
            deposit,
            holdSeedRef.current,
          )
        : isMaterialTool(startedSelection.material)
          ? onStretchMaterial(
              startedSelection.material,
              startedSelection.size,
              stretchPoints,
              deposit,
              holdSeedRef.current,
            )
          : false;
      if (added) {
        clearGesturePreviewAfterCommit();
      } else {
        clearGesturePreview();
        redraw();
      }
    } else if (startedSelection.recipeColor) {
      clearGesturePreview();
      onAddRecipe(
        startedSelection.recipeColor,
        startedSelection.size,
        tapPoint.x,
        tapPoint.y,
        placement,
      );
    } else {
      clearGesturePreview();
      if (startedSelection.eraser) onErase(tapPoint.x, tapPoint.y);
      else if (isMaterialTool(startedSelection.material)) {
        onAdd(
          startedSelection.material,
          startedSelection.size,
          tapPoint.x,
          tapPoint.y,
          placement,
        );
      }
    }
    pointerStroke.current = undefined;
    stretching.current = false;
    gestureCancelled.current = false;
    stretchOriginDepositRef.current = 1;
  };

  return (
    <div className="studio studio--mix">
      <div className="mix-layout">
        <section className="mixing-card" aria-labelledby="mixing-heading">
          <div className="mixing-card__bar">
            <div>
              <p className="eyebrow">混色パレット</p>
              <h2 id="mixing-heading">絵の具を置いて、そのまま伸ばす</h2>
            </div>
            <div className="canvas-status">
              <span className={webglReady ? "status-dot is-active" : "status-dot"} />
              {webglReady ? "絵の具の光沢 ON" : "軽量表示"}
            </div>
          </div>

          <div className="paint-surface-shell">
            <div
              ref={paintSurface}
              className={`paint-surface ${isPicker ? "is-sampling" : ""}`}
              role="application"
              tabIndex={0}
              aria-label={
                selectedRecipeColor
                  ? `混色パレット。保存色「${selectedRecipeColor.name}」はタップで1バッチ、触れたまま動かすと元の配合のまま波状に伸ばせます。`
                  : isPicker
                    ? "混色パレット。調べたい場所をタップまたはなぞると、その地点の配合比率を表示します。矢印キーでも調べる場所を移動できます。"
                    : isWater
                      ? "混色パレット。タップで真円に濡らし、触れたまま動かすとその地点から水を伸ばします。"
                      : "混色パレット。選択中の絵の具はタップで真円の1単位、触れたまま動かすとすぐに選択色を波状に伸ばせます。長押しすると中心が濃くなります。"
              }
              data-testid="mix-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={(event) => {
                if (activePointerId.current !== event.pointerId) return;
                activePointerId.current = undefined;
                activePointerSelection.current = undefined;
                stopHoldPreview();
                pointerStroke.current = undefined;
                clearGesturePreview();
                stretching.current = false;
                gestureCancelled.current = false;
                stretchOriginDepositRef.current = 1;
                redraw();
              }}
              onLostPointerCapture={(event) => {
                if (activePointerId.current !== event.pointerId) return;
                activePointerId.current = undefined;
                activePointerSelection.current = undefined;
                stopHoldPreview();
                pointerStroke.current = undefined;
                clearGesturePreview();
                stretching.current = false;
                gestureCancelled.current = false;
                stretchOriginDepositRef.current = 1;
                redraw();
              }}
              onContextMenu={(event) => {
                if (activePointerId.current !== undefined) {
                  event.preventDefault();
                }
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (
                  isPicker &&
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  const amount = event.shiftKey ? 0.01 : 0.025;
                  const point = samplePoint ?? { x: 0.5, y: 0.5 };
                  captureSampleAt({
                    x: Math.max(
                      0,
                      Math.min(
                        1,
                        point.x +
                          (event.key === "ArrowRight"
                            ? amount
                            : event.key === "ArrowLeft"
                              ? -amount
                              : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1,
                        point.y +
                          (event.key === "ArrowDown"
                            ? amount
                            : event.key === "ArrowUp"
                              ? -amount
                              : 0),
                      ),
                    ),
                  });
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (selectedRecipeColor) {
                    onAddRecipe(selectedRecipeColor, size, 0.5, 0.5);
                  } else if (isPicker) {
                    captureSampleAt({ x: 0.5, y: 0.5 });
                  } else if (isEraser) onErase(0.5, 0.5);
                  else if (isMaterialTool(selectedMaterial)) {
                    onAdd(selectedMaterial, size, 0.5, 0.5);
                  }
                }
              }}
            >
              <canvas
                ref={paintCanvas}
                className={`paint-layer paint-layer--source ${webglReady ? "is-webgl" : ""}`}
                width={CANVAS_WIDTH}
                height={canvasHeight}
                aria-hidden="true"
              />
              {isPicker && samplePoint && (
                <span
                  className="sample-point-marker"
                  style={{
                    left: `${samplePoint.x * 100}%`,
                    top: `${samplePoint.y * 100}%`,
                  }}
                  aria-hidden="true"
                >
                  <Pipette size={15} />
                </span>
              )}
              <canvas
                ref={glossCanvas}
                className={`paint-layer paint-layer--gloss ${webglReady ? "is-ready" : ""}`}
                width={CANVAS_WIDTH}
                height={canvasHeight}
                aria-hidden="true"
              />
              <canvas
                ref={gesturePreviewCanvas}
                className="paint-layer paint-layer--gesture-preview"
                width={CANVAS_WIDTH}
                height={canvasHeight}
                data-testid="paint-stroke-preview"
                aria-hidden="true"
              />
              {holdPreview && (
                <span
                  className={`paint-hold-preview ${
                    holdPreview.deposit > 1 ? "is-holding" : ""
                  } ${holdPreview.role === "water" ? "is-water" : "is-pigment"}`}
                  style={
                    {
                      left: `${holdPreview.x * 100}%`,
                      top: `${holdPreview.y * 100}%`,
                      width: `${
                        (sizeRadius[size] *
                          2 *
                          (holdPreview.role === "water"
                            ? 1.42
                            : holdSpread(holdPreview.deposit) *
                              (1 +
                                holdWaveAmplitude(
                                  holdPreview.deposit,
                                ))) *
                          100) /
                        CANVAS_WIDTH
                      }%`,
                      background:
                        holdPreview.role === "water"
                          ? `radial-gradient(circle at 50% 48%, ${hexToRgba(
                              holdPreview.color,
                              Math.min(
                                0.9,
                                0.56 + holdPreview.deposit * 0.04,
                              ),
                            )} 0 18%, ${hexToRgba(
                              holdPreview.color,
                              Math.min(
                                0.82,
                                0.44 + holdPreview.deposit * 0.035,
                              ),
                            )} 52%, ${hexToRgba(
                              holdPreview.color,
                              0.12,
                            )} 86%, transparent 100%)`
                          : `radial-gradient(circle at 31% 24%, rgba(255,255,255,.32) 0 5%, rgba(255,255,255,0) 19%), radial-gradient(circle at 50% 48%, ${hexToRgba(
                              holdPreview.color,
                              0.995,
                            )} 0 70%, ${hexToRgba(
                              holdPreview.color,
                              0.98,
                            )} 82%, ${hexToRgba(
                              holdPreview.color,
                              0.86,
                            )} 94%, ${hexToRgba(
                              holdPreview.color,
                              0.36,
                            )} 99%, transparent 100%)`,
                      clipPath:
                        holdPreview.role === "water"
                          ? "circle(50% at 50% 50%)"
                          : holdClipPath(
                              holdPreview.seed,
                              holdPreview.deposit,
                            ),
                    } as React.CSSProperties
                  }
                  data-deposit={holdPreview.deposit}
                  data-testid="paint-hold-preview"
                  aria-hidden="true"
                />
              )}
              <div
                className="canvas-size-switcher"
                aria-label="絵の具の表示サイズ"
                onPointerDown={(event) => event.stopPropagation()}
              >
                {(["small", "medium", "large"] as PaintSize[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={size === value ? "is-selected" : ""}
                    aria-pressed={size === value}
                    onClick={() => onSizeChange(value)}
                  >
                    {{ small: "小", medium: "中", large: "大" }[value]}
                  </button>
                ))}
              </div>
              {state.steps.length === 0 && (
                <div className="canvas-onboarding" aria-hidden="true">
                  <span className="onboarding-drop">
                    <Droplet size={28} />
                  </span>
                  <strong>
                    {selectedRecipeColor
                      ? `「${selectedRecipeColor.name}」をここに置く`
                      : isWater
                        ? "ここをなぞって、紙を濡らす"
                        : "絵の具を選んで、ここに置く"}
                  </strong>
                  <p>
                    {selectedRecipeColor
                      ? "タップで元レシピを1バッチ"
                      : isWater
                        ? "触れたまま動かすと水が伸びます"
                        : "タップは真円で1単位"}
                    <br />
                    {selectedRecipeColor
                      ? "そのまま動かしても元の配合比率を保ちます"
                      : isWater
                        ? "選んだ部分だけに水が広がります"
                        : "触れたまま動かすと選んだ色がすぐ伸びます"}
                  </p>
                </div>
              )}
            </div>
            <div className="canvas-floating-actions">
              <button
                type="button"
                className="subtle-button"
                onClick={() => {
                  clearSample();
                  onClear();
                }}
                disabled={!hasPaletteContent}
              >
                <Trash2 size={16} aria-hidden="true" />
                まっさらに
              </button>
              <button
                type="button"
                className="mix-all-button"
                onClick={onMixAll}
                disabled={!pigmentUnits}
                data-testid="mix-all"
              >
                <Sparkles size={17} aria-hidden="true" />
                すべて混ぜる
              </button>
            </div>
          </div>
        </section>

        <RecipeInspector
          recipe={state.recipe}
          mixed={mixed}
          sampled={activeSampledPaint}
          sampling={isPicker}
          detailed={detailed}
          onToggleDetailed={onToggleDetailed}
          onClearSample={clearSample}
          onRegister={() => onRegisterColor(activeSampledPaint)}
        />
      </div>

      <div className="material-dock" aria-label="材料と操作">
        <div
          className="materials-group"
          role="toolbar"
          aria-label="絵の具と保存レシピ色を選ぶ"
        >
          {materialButtons.map((material) => {
            const selected =
              !selectedRecipeColor && selectedMaterial === material.id;
            return (
              <button
                key={material.id}
                className={`material-button material-button--${material.id} ${selected ? "is-selected" : ""}`}
                type="button"
                aria-pressed={selected}
                aria-label={`${material.label}を選ぶ`}
                onClick={() => {
                  clearSample();
                  onSelectMaterial(material.id);
                }}
                data-testid={`material-${material.id}`}
              >
                <span className="material-button__blob" aria-hidden="true">
                  {material.id === "water" && <Droplet size={22} />}
                  {material.id === "eraser" && <Eraser size={22} />}
                  {material.id === "picker" && <Pipette size={21} />}
                </span>
                <span>{material.label}</span>
                {selected && (
                  <span className="material-selected-mark" aria-hidden="true">
                    <Check size={11} strokeWidth={3} />
                  </span>
                )}
                <kbd>{material.shortcut}</kbd>
              </button>
            );
          })}
          {recipeColors.length > 0 && (
            <span className="recipe-material-label" aria-hidden="true">
              レシピ色
            </span>
          )}
          {recipeColors.map((color, index) => {
            const selected = selectedRecipeColor?.id === color.id;
            const summary = MATERIAL_IDS
              .filter((material) => color.recipe[material] > 0)
              .map(
                (material) =>
                  `${MATERIAL_LABELS[material]}${color.recipe[material]}`,
              )
              .join("・");
            return (
              <button
                key={color.id}
                className={`material-button material-button--recipe ${selected ? "is-selected" : ""}`}
                type="button"
                aria-pressed={selected}
                aria-label={`保存色「${color.name}」を混色材料にする。配合は${summary}`}
                title={`${color.name}：${summary}`}
                onClick={() => {
                  clearSample();
                  onSelectRecipeColor(color);
                }}
                data-testid={`recipe-material-${index}`}
              >
                <span
                  className="material-button__blob"
                  aria-hidden="true"
                  style={
                    {
                      "--recipe-material": color.mixed.hex,
                      "--recipe-material-opacity": `${Math.round(
                        Math.max(0.3, color.mixed.opacity) * 100,
                      )}%`,
                    } as React.CSSProperties
                  }
                />
                <span>{color.name}</span>
                {selected && (
                  <span className="material-selected-mark" aria-hidden="true">
                    <Check size={11} strokeWidth={3} />
                  </span>
                )}
                <small className="recipe-material-ratio">{summary}</small>
              </button>
            );
          })}
        </div>
        <div className="dock-separator" aria-hidden="true" />
        <div className="history-controls" aria-label="操作履歴">
          <button
            type="button"
            className="dock-icon-button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="元に戻す"
            data-testid="undo"
          >
            <Undo2 size={21} aria-hidden="true" />
            <span>戻す</span>
          </button>
          <button
            type="button"
            className="dock-icon-button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="やり直す"
            data-testid="redo"
          >
            <RefreshCw size={20} aria-hidden="true" />
            <span>やり直す</span>
          </button>
          <button
            type="button"
            className="dock-icon-button"
            onClick={onHelp}
            aria-label="使い方を見る"
          >
            <HelpCircle size={20} aria-hidden="true" />
            <span>ヘルプ</span>
          </button>
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {sampleAnnouncement}
      </p>
    </div>
  );
}
