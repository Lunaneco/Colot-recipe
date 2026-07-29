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
  RecipeUnits,
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
import { rgbToHex, rgbToHsl } from "../lib/colorScience";
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
  onSelectMaterial: (material: MixerTool) => void;
  onSizeChange: (size: PaintSize) => void;
  onAdd: (material: MaterialId, size: PaintSize, x: number, y: number) => void;
  onAddStroke: (
    material: MaterialId,
    size: PaintSize,
    points: Array<{ x: number; y: number }>,
  ) => void;
  onErase: (x: number, y: number) => void;
  onMix: (gesture: Omit<MixGesture, "id" | "createdAt">) => void;
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

const sizeRadius: Record<PaintSize, number> = {
  small: 48,
  medium: 76,
  large: 108,
};

function resamplePath(
  path: Array<{ x: number; y: number }>,
  size: PaintSize,
  canvasHeight: number,
) {
  if (path.length === 0) return [];
  const spacing = sizeRadius[size] * 0.62;
  const sampled = [{ x: path[0].x, y: path[0].y }];
  let previous = path[0];
  let carried = 0;

  for (let index = 1; index < path.length && sampled.length < 80; index += 1) {
    const current = path[index];
    const dx = (current.x - previous.x) * CANVAS_WIDTH;
    const dy = (current.y - previous.y) * canvasHeight;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) continue;
    let nextDistance = spacing - carried;
    while (nextDistance <= distance && sampled.length < 80) {
      const amount = nextDistance / distance;
      sampled.push({
        x: previous.x + (current.x - previous.x) * amount,
        y: previous.y + (current.y - previous.y) * amount,
      });
      nextDistance += spacing;
    }
    carried = Math.max(0, distance - (nextDistance - spacing));
    previous = current;
  }

  const last = path[path.length - 1];
  const tail = sampled[sampled.length - 1];
  if (
    sampled.length < 80 &&
    Math.hypot(
      (last.x - tail.x) * CANVAS_WIDTH,
      (last.y - tail.y) * canvasHeight,
    ) >
      spacing * 0.4
  ) {
    sampled.push({ x: last.x, y: last.y });
  }
  return sampled;
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

  if (step.material === "water") {
    context.save();
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
    context.ellipse(x, y, radius * 1.42, radius * 1.08, -0.14, 0, Math.PI * 2);
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
      const structureNoise = hashNoise(
        Math.floor(x / 2) * 1.91 + Math.floor(y / 2) * 23.17,
      );
      const dryBody = (1 - sampledPixel.waterRatio) ** 2;
      const edgeStart =
        0.08 + (structureNoise - 0.5) * 0.1 * dryBody;
      const edgeProgress = Math.min(
        1,
        Math.max(0, (sampledPixel.coverage - edgeStart) / 0.4),
      );
      const bodyCoverage =
        edgeProgress * edgeProgress * (3 - 2 * edgeProgress);
      const grain =
        1 +
        (hashNoise(x * 0.73 + y * 19.31) - 0.5) *
          0.06 *
          dryBody *
          (1 - bodyCoverage);
      const renderedCoverage = Math.min(
        1,
        Math.max(
          0,
          sampledPixel.coverage *
            ((1 - dryBody) + bodyCoverage * dryBody) *
            grain,
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
  onSelectMaterial,
  onSizeChange,
  onAdd,
  onAddStroke,
  onErase,
  onMix,
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
  const textureRef = useRef<CanvasTexture | undefined>(undefined);
  const rendererRef = useRef<WebGLRenderer | undefined>(undefined);
  const shaderMaterialRef = useRef<ShaderMaterial | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const renderRef = useRef<(() => void) | undefined>(undefined);
  const initializeGlossRef = useRef<(() => void) | undefined>(undefined);
  const webglLoadingRef = useRef(false);
  const pointerPath = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const pendingSamplePoint = useRef<{ x: number; y: number } | undefined>(
    undefined,
  );
  const sampleFrameRef = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  const activePointerId = useRef<number | undefined>(undefined);
  const [webglReady, setWebglReady] = useState(false);
  const [canvasHeight, setCanvasHeight] = useState(DEFAULT_CANVAS_HEIGHT);
  const [samplePoint, setSamplePoint] = useState<{ x: number; y: number }>();
  const [sampledPaint, setSampledPaint] = useState<SpatialPaintSample>();
  const activeSampledPaint =
    selectedMaterial === "picker" ? sampledPaint : undefined;
  const pigmentUnits = useMemo(
    () =>
      PIGMENT_IDS.reduce(
        (total, material) => total + state.recipe[material],
        0,
      ),
    [state.recipe],
  );
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
      if (step.material === "water") {
        drawPaintDab(context, step, index, canvasHeight);
      }
    });
    updateTexture();
  }, [canvasHeight, state, updateTexture]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (selectedMaterial !== "picker" || !samplePoint) return;
    const point = samplePoint;
    const frame = window.requestAnimationFrame(() => captureSample(point));
    return () => window.cancelAnimationFrame(frame);
  }, [captureSample, samplePoint, selectedMaterial]);

  useEffect(
    () => () => {
      if (sampleFrameRef.current) {
        window.cancelAnimationFrame(sampleFrameRef.current);
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

  const toNormalizedPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect =
      paintCanvas.current?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      time: event.timeStamp,
    };
  };

  const previewStroke = (path: Array<{ x: number; y: number; time: number }>) => {
    if (path.length < 2 || !paintCanvas.current) return;
    const context = paintCanvas.current.getContext("2d");
    if (!context) return;
    const current = path[path.length - 1];
    const previous = path[path.length - 2];
    const elapsed = Math.max(1, current.time - previous.time);
    const distance = Math.hypot(
      (current.x - previous.x) * CANVAS_WIDTH,
      (current.y - previous.y) * canvasHeight,
    );
    const speed = distance / elapsed;
    context.save();
    context.lineCap = "round";
    if (selectedMaterial === "water") {
      context.globalCompositeOperation = "screen";
      context.strokeStyle = "rgba(106, 176, 190, 0.24)";
    } else {
      context.strokeStyle = hexToRgba(mixed.hex, 0.24);
    }
    context.lineWidth = Math.max(34, Math.min(130, 44 + speed * 70));
    context.beginPath();
    context.moveTo(previous.x * CANVAS_WIDTH, previous.y * canvasHeight);
    context.lineTo(current.x * CANVAS_WIDTH, current.y * canvasHeight);
    context.stroke();
    context.restore();
    updateTexture();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toNormalizedPoint(event);
    pointerPath.current = [point];
    dragging.current = false;
    if (selectedMaterial === "picker") {
      captureSampleAt({ x: point.x, y: point.y });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = toNormalizedPoint(event);
    if (selectedMaterial === "picker") {
      scheduleSampleAt({ x: point.x, y: point.y });
      return;
    }
    const previous = pointerPath.current[pointerPath.current.length - 1];
    const distance = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y)
      : 0;
    if (distance < 0.004) return;
    pointerPath.current.push(point);
    if (pointerPath.current.length > 1) {
      dragging.current = true;
      if (selectedMaterial === "water" || pigmentUnits > 0) {
        previewStroke(pointerPath.current);
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    const point = toNormalizedPoint(event);
    const path = [...pointerPath.current, point];
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (selectedMaterial === "picker") {
      if (sampleFrameRef.current) {
        window.cancelAnimationFrame(sampleFrameRef.current);
        sampleFrameRef.current = undefined;
      }
      pendingSamplePoint.current = undefined;
      captureSampleAt({ x: point.x, y: point.y });
    } else if (!dragging.current) {
      if (selectedMaterial === "eraser") onErase(point.x, point.y);
      else onAdd(selectedMaterial, size, point.x, point.y);
    } else if (selectedMaterial === "water") {
      onAddStroke(
        "water",
        size,
        resamplePath(path, size, canvasHeight),
      );
    } else if (pigmentUnits > 0) {
      let distance = 0;
      for (let index = 1; index < path.length; index += 1) {
        distance += Math.hypot(
          (path[index].x - path[index - 1].x) * CANVAS_WIDTH,
          (path[index].y - path[index - 1].y) * canvasHeight,
        );
      }
      const duration = Math.max(1, path[path.length - 1].time - path[0].time);
      onMix({
        kind: "gesture",
        distance,
        speed: distance / duration,
        points: path.length,
        path: path.map(({ x, y }) => ({ x, y })),
      });
    }
    pointerPath.current = [];
    dragging.current = false;
    activePointerId.current = undefined;
  };

  return (
    <div className="studio studio--mix">
      <div className="mix-layout">
        <section className="mixing-card" aria-labelledby="mixing-heading">
          <div className="mixing-card__bar">
            <div>
              <p className="eyebrow">混色パレット</p>
              <h2 id="mixing-heading">絵の具を置いて、なぞって混ぜる</h2>
            </div>
            <div className="canvas-status">
              <span className={webglReady ? "status-dot is-active" : "status-dot"} />
              {webglReady ? "絵の具の光沢 ON" : "軽量表示"}
            </div>
          </div>

          <div
            ref={paintSurface}
            className={`paint-surface ${selectedMaterial === "picker" ? "is-sampling" : ""}`}
            role="application"
            tabIndex={0}
            aria-label={
              selectedMaterial === "picker"
                ? "混色パレット。調べたい場所をタップまたはなぞると、その地点の配合比率を表示します。矢印キーでも調べる場所を移動できます。"
                : selectedMaterial === "water"
                  ? "混色パレット。タップまたはなぞって、触れた場所だけを濡らします。"
                : "混色パレット。選択中の材料を置くにはタップ、混ぜるにはドラッグします。"
            }
            data-testid="mix-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              pointerPath.current = [];
              dragging.current = false;
              activePointerId.current = undefined;
              redraw();
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (
                selectedMaterial === "picker" &&
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
                if (selectedMaterial === "picker") {
                  captureSampleAt({ x: 0.5, y: 0.5 });
                } else if (selectedMaterial === "eraser") onErase(0.5, 0.5);
                else onAdd(selectedMaterial, size, 0.5, 0.5);
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
            {selectedMaterial === "picker" && samplePoint && (
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
            <div className="canvas-size-switcher" aria-label="絵の具の表示サイズ">
              {(["small", "medium", "large"] as PaintSize[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={size === value ? "is-selected" : ""}
                  aria-pressed={size === value}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSizeChange(value)}
                >
                  {{ small: "小", medium: "中", large: "大" }[value]}
                </button>
              ))}
            </div>
            {state.steps.length > 0 && (
              <p className="canvas-gesture-hint" aria-hidden="true">
                {selectedMaterial === "picker"
                  ? "タップ／なぞる：その場所の配合を調べる"
                  : selectedMaterial === "water"
                    ? "タップ／なぞる：触れた場所を濡らす"
                    : "タップ：1単位　・　なぞる：混ぜる"}
              </p>
            )}
            {state.steps.length === 0 && (
              <div className="canvas-onboarding" aria-hidden="true">
                <span className="onboarding-drop">
                  <Droplet size={28} />
                </span>
                <strong>
                  {selectedMaterial === "water"
                    ? "ここをなぞって、紙を濡らす"
                    : "絵の具を選んで、ここに置く"}
                </strong>
                <p>
                  {selectedMaterial === "water"
                    ? "タップでも、なぞっても使えます"
                    : "1回のタップで1単位"}
                  <br />
                  {selectedMaterial === "water"
                    ? "選んだ部分だけに水が広がります"
                    : "なぞるほど、なめらかに混ざります"}
                </p>
              </div>
            )}
            <div className="canvas-floating-actions">
              <button
                type="button"
                className="subtle-button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={onClear}
                disabled={!state.steps.length}
              >
                <Trash2 size={16} aria-hidden="true" />
                まっさらに
              </button>
              <button
                type="button"
                className="mix-all-button"
                onPointerDown={(event) => event.stopPropagation()}
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
          sampling={selectedMaterial === "picker"}
          detailed={detailed}
          onToggleDetailed={onToggleDetailed}
          onClearSample={clearSample}
          onRegister={() => onRegisterColor(activeSampledPaint)}
        />
      </div>

      <div className="material-dock" aria-label="材料と操作">
        <div className="materials-group" role="toolbar" aria-label="絵の具を選ぶ">
          {materialButtons.map((material) => {
            const selected = selectedMaterial === material.id;
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
