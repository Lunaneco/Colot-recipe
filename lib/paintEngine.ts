/**
 * Canvas/paint primitives shared by the drawing and colouring modes.
 *
 * The maths and flood-fill routines in this module are deliberately free of
 * DOM access so they can run in a worker or in Node tests. Browser APIs are
 * only touched by the pointer and high-DPI canvas helpers.
 */

export type PointerKind = "mouse" | "pen" | "touch" | "unknown";

export interface PointerPoint {
  /** Canvas-local x coordinate in CSS pixels. */
  x: number;
  /** Canvas-local y coordinate in CSS pixels. */
  y: number;
  /** Normalised Pointer Events pressure (0..1). */
  pressure: number;
  /** DOMHighResTimeStamp-compatible timestamp in milliseconds. */
  time: number;
  pointerId?: number;
  pointerType?: PointerKind;
  tiltX?: number;
  tiltY?: number;
  twist?: number;
}

export type PointerPointInput = Pick<PointerPoint, "x" | "y"> &
  Partial<Omit<PointerPoint, "x" | "y">>;

export interface BrushSettings {
  /** Nominal brush diameter in CSS pixels. */
  size: number;
  /** Maximum deposited opacity (0..1). */
  opacity: number;
  /** How strongly pointer pressure changes the stamp (0..1). */
  pressureSensitivity: number;
  /** Lowest usable pressure response, preventing a disappearing stroke. */
  minimumPressure: number;
  /** Amount of water in the loaded paint (0..1). */
  moisture: number;
  /** Amount of capillary spread/bleed (0..1). */
  bleed: number;
  /** Edge hardness (0 is very soft, 1 is crisp). */
  hardness: number;
  /** Nominal stamp spacing as a fraction of the current diameter. */
  spacing: number;
}

export interface BrushStampMetrics {
  radius: number;
  alpha: number;
  spacing: number;
  /** Useful for radial-gradient stamp rendering (0..1). */
  edgeSoftness: number;
  /** Suggested off-stamp diffusion radius in CSS pixels. */
  diffusionRadius: number;
}

export const DEFAULT_BRUSH_SETTINGS: Readonly<BrushSettings> = Object.freeze({
  size: 24,
  opacity: 0.88,
  pressureSensitivity: 0.72,
  minimumPressure: 0.14,
  moisture: 0.28,
  bleed: 0.18,
  hardness: 0.64,
  spacing: 0.16,
});

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  /** Byte alpha (0..255), matching ImageData. */
  a: number;
}

export type RgbaTuple = readonly [r: number, g: number, b: number, a: number];

export interface ImageDataLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FloodFillBlendMode = "replace" | "source-over";

export interface FloodFillOptions {
  /**
   * Maximum per-channel difference from the tapped pixel (0..255).
   * Alpha has a separate override because transparent line-art layers often
   * need a lower alpha tolerance than their RGB tolerance.
   */
  tolerance?: number;
  alphaTolerance?: number;
  connectivity?: 4 | 8;
  /**
   * Temporarily grows detected boundaries by this many pixels. A radius of 1
   * closes gaps up to roughly two pixels wide. Set to 0 to disable the guard.
   */
  gapGuardRadius?: number;
  /**
   * Paint the guarded band back from the safe interior without crossing the
   * original boundary. This avoids a pale halo at the edge of a filled area.
   */
  reclaimGuardedEdge?: boolean;
  blendMode?: FloodFillBlendMode;
  /**
   * Safety cap. If the connected safe region exceeds the cap, no pixels are
   * changed and the result reports `limit-exceeded`.
   */
  maxPixels?: number;
}

export interface EnclosedRegionFillOptions {
  /**
   * Pixels on the line-art layer at or above this alpha become boundaries.
   * Lower values recognise fainter uploaded lines.
   */
  boundaryAlphaThreshold?: number;
  gapGuardRadius?: number;
  maxPixels?: number;
  /**
   * Reject regions connected to a canvas edge. Defaults to true so a broken
   * outline cannot turn a tap inside a drawing into a full-page fill.
   */
  requireEnclosed?: boolean;
}

export type FloodFillReason =
  | "filled"
  | "no-change"
  | "out-of-bounds"
  | "boundary"
  | "guarded-start"
  | "limit-exceeded"
  | "open-region";

export interface FloodFillResult {
  reason: FloodFillReason;
  changedPixels: number;
  regionPixels: number;
  bounds: PixelBounds | null;
  aborted: boolean;
}

export interface CanvasResizeOptions {
  /** Explicit CSS dimensions are useful before the canvas has been laid out. */
  cssWidth?: number;
  cssHeight?: number;
  /** Defaults to window.devicePixelRatio in a browser and 1 elsewhere. */
  dpr?: number;
  /** Mobile GPUs rarely benefit from values above 3 for paint canvases. */
  maxDpr?: number;
  /** Prevent accidental multi-hundred-megabyte backing stores. */
  maxPixels?: number;
  /**
   * The context whose transform should be reset to CSS-pixel coordinates.
   * When omitted, the helper asks the canvas for its 2D context.
   */
  context?: CanvasRenderingContext2D | null;
  applyTransform?: boolean;
}

export interface CanvasResizeResult {
  changed: boolean;
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  /** Requested DPR after maxDpr/maxPixels limiting, before integer rounding. */
  dpr: number;
  /** Exact backing-store scale after integer rounding. */
  scaleX: number;
  scaleY: number;
}

export type PaintHistoryKind =
  | "stroke"
  | "fill"
  | "erase"
  | "clear"
  | "resize"
  | "layer";

/**
 * A compact dirty-rectangle snapshot. Keeping before/after patches instead of
 * whole canvases makes undo practical on mobile.
 */
export interface PixelPatch {
  bounds: PixelBounds;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

export interface PaintHistoryEntry<Payload = unknown> {
  id: string;
  kind: PaintHistoryKind;
  timestamp: number;
  layerId?: string;
  label?: string;
  patch?: PixelPatch;
  payload?: Payload;
}

export interface PaintHistoryState<Entry extends PaintHistoryEntry = PaintHistoryEntry> {
  past: readonly Entry[];
  future: readonly Entry[];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const clampUnit = (value: number): number => clamp(value, 0, 1);

const clampByte = (value: number): number => Math.round(clamp(value, 0, 255));

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

/**
 * Normalises a point created by application code, imported recordings, or a
 * PointerEvent. It is safe to call this in workers/Node.
 */
export function createPointerPoint(input: PointerPointInput): PointerPoint {
  const pointerType: PointerKind =
    input.pointerType === "mouse" ||
    input.pointerType === "pen" ||
    input.pointerType === "touch"
      ? input.pointerType
      : "unknown";

  return {
    x: finiteOr(input.x, 0),
    y: finiteOr(input.y, 0),
    pressure: clampUnit(finiteOr(input.pressure, 0.5)),
    time: Math.max(0, finiteOr(input.time, 0)),
    pointerId: input.pointerId,
    pointerType,
    tiltX: clamp(finiteOr(input.tiltX, 0), -90, 90),
    tiltY: clamp(finiteOr(input.tiltY, 0), -90, 90),
    twist: clamp(finiteOr(input.twist, 0), 0, 359),
  };
}

/**
 * Converts browser Pointer Events to CSS-pixel canvas coordinates. Coalesced
 * events can be passed to this function one by one for high-frequency strokes.
 */
export function pointerEventToCanvasPoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): PointerPoint {
  const rect = canvas.getBoundingClientRect();
  // Active mouse pointers report 0.5 in compliant browsers, but the fallback
  // keeps drawing usable in browsers/devices which always report zero.
  const pressure =
    event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0;

  return createPointerPoint({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure,
    time: event.timeStamp,
    pointerId: event.pointerId,
    pointerType:
      event.pointerType === "mouse" ||
      event.pointerType === "pen" ||
      event.pointerType === "touch"
        ? event.pointerType
        : "unknown",
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
  });
}

export function normaliseBrushSettings(
  settings: Partial<BrushSettings> = {},
): BrushSettings {
  return {
    size: clamp(finiteOr(settings.size, DEFAULT_BRUSH_SETTINGS.size), 0.5, 1024),
    opacity: clampUnit(
      finiteOr(settings.opacity, DEFAULT_BRUSH_SETTINGS.opacity),
    ),
    pressureSensitivity: clampUnit(
      finiteOr(
        settings.pressureSensitivity,
        DEFAULT_BRUSH_SETTINGS.pressureSensitivity,
      ),
    ),
    minimumPressure: clamp(
      finiteOr(
        settings.minimumPressure,
        DEFAULT_BRUSH_SETTINGS.minimumPressure,
      ),
      0.01,
      1,
    ),
    moisture: clampUnit(
      finiteOr(settings.moisture, DEFAULT_BRUSH_SETTINGS.moisture),
    ),
    bleed: clampUnit(finiteOr(settings.bleed, DEFAULT_BRUSH_SETTINGS.bleed)),
    hardness: clampUnit(
      finiteOr(settings.hardness, DEFAULT_BRUSH_SETTINGS.hardness),
    ),
    spacing: clamp(
      finiteOr(settings.spacing, DEFAULT_BRUSH_SETTINGS.spacing),
      0.01,
      2,
    ),
  };
}

/**
 * Resolves a single dab from pressure and brush properties.
 *
 * Wet/bleeding paint spreads farther, deposits less pigment per dab, and uses
 * tighter spacing so a stroke remains continuous. Pressure affects both radius
 * and deposition but never collapses a live stroke to zero.
 */
export function computeBrushStampMetrics(
  pointOrPressure: Pick<PointerPoint, "pressure"> | number,
  brushInput: Partial<BrushSettings> = {},
): BrushStampMetrics {
  const brush = normaliseBrushSettings(brushInput);
  const rawPressure =
    typeof pointOrPressure === "number"
      ? pointOrPressure
      : pointOrPressure.pressure;
  const pressure = clampUnit(finiteOr(rawPressure, 0.5));
  const curvedPressure = Math.pow(pressure, 1.35);
  const pressureResponse =
    brush.minimumPressure + (1 - brush.minimumPressure) * curvedPressure;
  const pressureScale =
    1 + brush.pressureSensitivity * (pressureResponse - 1);

  const softness = 1 - brush.hardness;
  const spread =
    1 + brush.moisture * 0.2 + brush.bleed * 0.34 + softness * 0.1;
  const radius = Math.max(0.25, (brush.size * 0.5) * pressureScale * spread);

  const pressureDeposit =
    1 -
    brush.pressureSensitivity *
      (1 - pressureResponse) *
      0.72;
  const dilution = 1 - brush.moisture * 0.58;
  const bleedLoss = 1 - brush.bleed * 0.16;
  const edgeDeposit = 0.84 + brush.hardness * 0.16;
  const alpha = clampUnit(
    brush.opacity * pressureDeposit * dilution * bleedLoss * edgeDeposit,
  );

  const continuity =
    1 -
    brush.moisture * 0.34 -
    brush.bleed * 0.24 -
    softness * 0.12;
  const spacing = Math.max(
    0.25,
    radius * 2 * brush.spacing * clamp(continuity, 0.24, 1),
  );

  return {
    radius,
    alpha,
    spacing,
    edgeSoftness: clampUnit(
      0.06 + softness * 0.76 + brush.moisture * 0.12,
    ),
    diffusionRadius:
      radius * (brush.moisture * 0.12 + brush.bleed * 0.3) * (0.65 + softness),
  };
}

/** ImageData-compatible Porter-Duff source-over composition. */
export function compositeRgba(
  foreground: RgbaColor | RgbaTuple,
  background: RgbaColor | RgbaTuple,
): RgbaColor {
  const source = toRgbaColor(foreground);
  const destination = toRgbaColor(background);
  const sourceAlpha = clampByte(source.a) / 255;
  const destinationAlpha = clampByte(destination.a) / 255;
  const outputAlpha =
    sourceAlpha + destinationAlpha * (1 - sourceAlpha);

  if (outputAlpha <= Number.EPSILON) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const destinationFactor = destinationAlpha * (1 - sourceAlpha);
  return {
    r: clampByte(
      (clampByte(source.r) * sourceAlpha +
        clampByte(destination.r) * destinationFactor) /
        outputAlpha,
    ),
    g: clampByte(
      (clampByte(source.g) * sourceAlpha +
        clampByte(destination.g) * destinationFactor) /
        outputAlpha,
    ),
    b: clampByte(
      (clampByte(source.b) * sourceAlpha +
        clampByte(destination.b) * destinationFactor) /
        outputAlpha,
    ),
    a: clampByte(outputAlpha * 255),
  };
}

function toRgbaColor(colour: RgbaColor | RgbaTuple): RgbaColor {
  if (Array.isArray(colour)) {
    return {
      r: colour[0],
      g: colour[1],
      b: colour[2],
      a: colour[3],
    };
  }
  return colour as RgbaColor;
}

function colourMatches(
  data: Uint8ClampedArray,
  offset: number,
  target: RgbaColor,
  tolerance: number,
  alphaTolerance: number,
): boolean {
  return (
    Math.abs(data[offset] - target.r) <= tolerance &&
    Math.abs(data[offset + 1] - target.g) <= tolerance &&
    Math.abs(data[offset + 2] - target.b) <= tolerance &&
    Math.abs(data[offset + 3] - target.a) <= alphaTolerance
  );
}

/**
 * Dilates all non-candidate pixels with a square (Chebyshev) kernel. The
 * two-pass sliding window is O(width * height), regardless of guard radius.
 */
function buildGuardMask(
  candidate: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const pixelCount = width * height;
  const horizontal = new Uint8Array(pixelCount);
  const guarded = new Uint8Array(pixelCount);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let boundaryCount = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) {
      boundaryCount += candidate[row + x] === 0 ? 1 : 0;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = boundaryCount > 0 ? 1 : 0;
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) {
        boundaryCount -= candidate[row + leaving] === 0 ? 1 : 0;
      }
      if (entering < width) {
        boundaryCount += candidate[row + entering] === 0 ? 1 : 0;
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    let boundaryCount = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) {
      boundaryCount += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      guarded[index] = boundaryCount > 0 ? 1 : 0;
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) {
        boundaryCount -= horizontal[leaving * width + x];
      }
      if (entering < height) {
        boundaryCount += horizontal[entering * width + x];
      }
    }
  }

  return guarded;
}

function findNearestSafeSeed(
  startX: number,
  startY: number,
  width: number,
  height: number,
  candidate: Uint8Array,
  guarded: Uint8Array,
  searchRadius: number,
): number {
  const startIndex = startY * width + startX;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 1;
  queue[0] = startIndex;
  visited[startIndex] = 1;

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (guarded[index] === 0) return index;

    for (const [dx, dy] of FOUR_NEIGHBOURS) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (
        nextX < 0 ||
        nextY < 0 ||
        nextX >= width ||
        nextY >= height ||
        Math.abs(nextX - startX) > searchRadius ||
        Math.abs(nextY - startY) > searchRadius
      ) {
        continue;
      }
      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex] !== 0 || candidate[nextIndex] === 0) continue;
      visited[nextIndex] = 1;
      queue[tail] = nextIndex;
      tail += 1;
    }
  }

  return -1;
}

const FOUR_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const EIGHT_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  ...FOUR_NEIGHBOURS,
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Mutating flood fill with tolerance and a boundary-gap guard.
 *
 * The guard first expands non-matching (usually ink) pixels, fills only the
 * resulting safe interior, then optionally grows the result back toward the
 * real boundary by the same radius. Since that last growth is bounded, it
 * cannot walk through the small gap that the first phase closed.
 */
export function floodFillImageData(
  imageData: ImageDataLike,
  startXInput: number,
  startYInput: number,
  fillColourInput: RgbaColor | RgbaTuple,
  options: FloodFillOptions = {},
): FloodFillResult {
  const width = Math.max(0, Math.floor(imageData.width));
  const height = Math.max(0, Math.floor(imageData.height));
  const pixelCount = width * height;

  if (
    pixelCount === 0 ||
    imageData.data.length < pixelCount * 4 ||
    !Number.isFinite(startXInput) ||
    !Number.isFinite(startYInput)
  ) {
    return emptyFillResult("out-of-bounds");
  }

  const startX = Math.floor(startXInput);
  const startY = Math.floor(startYInput);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return emptyFillResult("out-of-bounds");
  }

  const tolerance = clamp(
    Math.floor(finiteOr(options.tolerance, 20)),
    0,
    255,
  );
  const alphaTolerance = clamp(
    Math.floor(finiteOr(options.alphaTolerance, tolerance)),
    0,
    255,
  );
  const guardRadius = clamp(
    Math.floor(finiteOr(options.gapGuardRadius, 1)),
    0,
    16,
  );
  const maxPixels = clamp(
    Math.floor(finiteOr(options.maxPixels, pixelCount)),
    1,
    pixelCount,
  );
  const connectivity = options.connectivity === 8 ? 8 : 4;
  const neighbours =
    connectivity === 8 ? EIGHT_NEIGHBOURS : FOUR_NEIGHBOURS;
  const reclaimGuardedEdge = options.reclaimGuardedEdge !== false;
  const blendMode: FloodFillBlendMode =
    options.blendMode === "replace" ? "replace" : "source-over";

  const startIndex = startY * width + startX;
  const startOffset = startIndex * 4;
  const targetColour: RgbaColor = {
    r: imageData.data[startOffset],
    g: imageData.data[startOffset + 1],
    b: imageData.data[startOffset + 2],
    a: imageData.data[startOffset + 3],
  };
  const fillColour = toRgbaColor(fillColourInput);
  const source: RgbaColor = {
    r: clampByte(fillColour.r),
    g: clampByte(fillColour.g),
    b: clampByte(fillColour.b),
    a: clampByte(fillColour.a),
  };

  const candidate = new Uint8Array(pixelCount);
  for (let index = 0, offset = 0; index < pixelCount; index += 1, offset += 4) {
    candidate[index] = colourMatches(
      imageData.data,
      offset,
      targetColour,
      tolerance,
      alphaTolerance,
    )
      ? 1
      : 0;
  }

  if (candidate[startIndex] === 0) {
    return emptyFillResult("boundary");
  }

  const guarded =
    guardRadius > 0
      ? buildGuardMask(candidate, width, height, guardRadius)
      : new Uint8Array(pixelCount);
  let safeStartIndex = startIndex;
  if (guarded[safeStartIndex] !== 0) {
    safeStartIndex = findNearestSafeSeed(
      startX,
      startY,
      width,
      height,
      candidate,
      guarded,
      guardRadius + 2,
    );
    if (safeStartIndex < 0) {
      return emptyFillResult("guarded-start");
    }
  }

  const region = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 1;
  let limitExceeded = false;
  queue[0] = safeStartIndex;
  region[safeStartIndex] = 1;

  while (head < tail && !limitExceeded) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);

    for (const [dx, dy] of neighbours) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (
        nextX < 0 ||
        nextY < 0 ||
        nextX >= width ||
        nextY >= height
      ) {
        continue;
      }
      const nextIndex = nextY * width + nextX;
      if (
        region[nextIndex] !== 0 ||
        candidate[nextIndex] === 0 ||
        guarded[nextIndex] !== 0
      ) {
        continue;
      }
      if (tail >= maxPixels) {
        limitExceeded = true;
        break;
      }
      region[nextIndex] = 1;
      queue[tail] = nextIndex;
      tail += 1;
    }
  }

  if (limitExceeded) {
    return {
      ...emptyFillResult("limit-exceeded"),
      aborted: true,
    };
  }

  // Reclaim no farther than the amount by which the boundary was expanded.
  // Resetting the queue head makes the entire safe interior the first frontier.
  if (guardRadius > 0 && reclaimGuardedEdge) {
    head = 0;
    const edgeNeighbours = EIGHT_NEIGHBOURS;
    for (let distance = 0; distance < guardRadius; distance += 1) {
      const frontierEnd = tail;
      while (head < frontierEnd) {
        const index = queue[head];
        head += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of edgeNeighbours) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (
            nextX < 0 ||
            nextY < 0 ||
            nextX >= width ||
            nextY >= height
          ) {
            continue;
          }
          const nextIndex = nextY * width + nextX;
          if (region[nextIndex] !== 0 || candidate[nextIndex] === 0) {
            continue;
          }
          if (tail >= maxPixels) {
            limitExceeded = true;
            break;
          }
          region[nextIndex] = 1;
          queue[tail] = nextIndex;
          tail += 1;
        }
        if (limitExceeded) {
          break;
        }
      }
      if (limitExceeded) {
        break;
      }
    }
  }

  if (limitExceeded) {
    return {
      ...emptyFillResult("limit-exceeded"),
      aborted: true,
    };
  }

  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let queueIndex = 0; queueIndex < tail; queueIndex += 1) {
    const pixelIndex = queue[queueIndex];
    const offset = pixelIndex * 4;
    const previous: RgbaColor = {
      r: imageData.data[offset],
      g: imageData.data[offset + 1],
      b: imageData.data[offset + 2],
      a: imageData.data[offset + 3],
    };
    const next =
      blendMode === "replace"
        ? source
        : compositeRgba(source, previous);

    if (
      previous.r === next.r &&
      previous.g === next.g &&
      previous.b === next.b &&
      previous.a === next.a
    ) {
      continue;
    }

    imageData.data[offset] = next.r;
    imageData.data[offset + 1] = next.g;
    imageData.data[offset + 2] = next.b;
    imageData.data[offset + 3] = next.a;
    changedPixels += 1;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    reason: changedPixels > 0 ? "filled" : "no-change",
    changedPixels,
    regionPixels: tail,
    bounds:
      changedPixels > 0
        ? {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          }
        : null,
    aborted: false,
  };
}

/**
 * Fill an entire line-art enclosure, independently of colours already painted
 * inside it. The line layer is treated as the authoritative boundary mask, so
 * old brush strokes cannot split the region or leave unpainted islands.
 */
export function fillEnclosedRegion(
  lineImageData: ImageDataLike,
  targetImageData: ImageDataLike,
  startXInput: number,
  startYInput: number,
  fillColourInput: RgbaColor | RgbaTuple,
  options: EnclosedRegionFillOptions = {},
): FloodFillResult {
  const width = Math.max(0, Math.floor(lineImageData.width));
  const height = Math.max(0, Math.floor(lineImageData.height));
  const pixelCount = width * height;
  if (
    pixelCount === 0 ||
    targetImageData.width !== width ||
    targetImageData.height !== height ||
    lineImageData.data.length < pixelCount * 4 ||
    targetImageData.data.length < pixelCount * 4 ||
    !Number.isFinite(startXInput) ||
    !Number.isFinite(startYInput)
  ) {
    return emptyFillResult("out-of-bounds");
  }

  const startX = Math.floor(startXInput);
  const startY = Math.floor(startYInput);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return emptyFillResult("out-of-bounds");
  }

  const boundaryAlphaThreshold = clamp(
    Math.floor(finiteOr(options.boundaryAlphaThreshold, 64)),
    1,
    255,
  );
  const startOffset = (startY * width + startX) * 4;
  if (lineImageData.data[startOffset + 3] >= boundaryAlphaThreshold) {
    return emptyFillResult("boundary");
  }

  const baseMask: ImageDataLike = {
    width,
    height,
    data: new Uint8ClampedArray(pixelCount * 4),
  };
  for (let offset = 0; offset < baseMask.data.length; offset += 4) {
    const boundary =
      lineImageData.data[offset + 3] >= boundaryAlphaThreshold;
    const value = boundary ? 0 : 255;
    baseMask.data[offset] = value;
    baseMask.data[offset + 1] = value;
    baseMask.data[offset + 2] = value;
    baseMask.data[offset + 3] = 255;
  }

  const marker: RgbaTuple = [1, 254, 2, 255];
  const requestedGuardRadius = clamp(
    Math.floor(finiteOr(options.gapGuardRadius, 1)),
    0,
    16,
  );
  const guardAttempts = [
    0,
    ...Array.from(
      { length: requestedGuardRadius },
      (_, index) => index + 1,
    ),
  ];
  const requireEnclosed = options.requireEnclosed !== false;
  let mask: ImageDataLike | undefined;
  let region: FloodFillResult | undefined;
  let openRegion: FloodFillResult | undefined;

  for (const gapGuardRadius of guardAttempts) {
    const candidateMask: ImageDataLike = {
      width,
      height,
      data: new Uint8ClampedArray(baseMask.data),
    };
    const candidateRegion = floodFillImageData(
      candidateMask,
      startX,
      startY,
      marker,
      {
        tolerance: 0,
        alphaTolerance: 0,
        gapGuardRadius,
        maxPixels: options.maxPixels,
        blendMode: "replace",
      },
    );
    if (
      candidateRegion.reason === "limit-exceeded" ||
      candidateRegion.reason === "out-of-bounds" ||
      candidateRegion.reason === "boundary"
    ) {
      return candidateRegion;
    }
    if (candidateRegion.reason !== "filled" || !candidateRegion.bounds) {
      continue;
    }
    const bounds = candidateRegion.bounds;
    const touchesEdge =
      bounds.x <= 0 ||
      bounds.y <= 0 ||
      bounds.x + bounds.width >= width ||
      bounds.y + bounds.height >= height;
    if (requireEnclosed && touchesEdge) {
      openRegion = candidateRegion;
      continue;
    }
    mask = candidateMask;
    region = candidateRegion;
    break;
  }

  if (!mask || !region || !region.bounds) {
    if (openRegion) {
      return {
        ...emptyFillResult("open-region"),
        regionPixels: openRegion.regionPixels,
      };
    }
    return emptyFillResult("guarded-start");
  }

  const fill = toRgbaColor(fillColourInput);
  const next = {
    r: clampByte(fill.r),
    g: clampByte(fill.g),
    b: clampByte(fill.b),
    a: clampByte(fill.a),
  };
  let changedPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const endX = region.bounds.x + region.bounds.width;
  const endY = region.bounds.y + region.bounds.height;
  for (let y: number = region.bounds.y; y < endY; y += 1) {
    for (let x: number = region.bounds.x; x < endX; x += 1) {
      const offset = (y * width + x) * 4;
      if (
        mask.data[offset] !== marker[0] ||
        mask.data[offset + 1] !== marker[1] ||
        mask.data[offset + 2] !== marker[2] ||
        mask.data[offset + 3] !== marker[3]
      ) {
        continue;
      }
      if (
        targetImageData.data[offset] === next.r &&
        targetImageData.data[offset + 1] === next.g &&
        targetImageData.data[offset + 2] === next.b &&
        targetImageData.data[offset + 3] === next.a
      ) {
        continue;
      }
      targetImageData.data[offset] = next.r;
      targetImageData.data[offset + 1] = next.g;
      targetImageData.data[offset + 2] = next.b;
      targetImageData.data[offset + 3] = next.a;
      changedPixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    reason: changedPixels > 0 ? "filled" : "no-change",
    changedPixels,
    regionPixels: region.regionPixels,
    bounds:
      changedPixels > 0
        ? {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          }
        : null,
    aborted: region.aborted,
  };
}

/**
 * Converts an uploaded raster to the app's line layer. Alpha is composited
 * against white before measuring darkness, so transparent PNG padding remains
 * transparent instead of becoming solid black ink.
 */
export function prepareUploadedLineArt(
  imageData: ImageDataLike,
): ImageDataLike {
  const pixelCount =
    Math.max(0, Math.floor(imageData.width)) *
    Math.max(0, Math.floor(imageData.height));
  if (imageData.data.length < pixelCount * 4) return imageData;

  for (let offset = 0; offset < pixelCount * 4; offset += 4) {
    const sourceAlpha = imageData.data[offset + 3] / 255;
    const sourceLuminance =
      imageData.data[offset] * 0.2126 +
      imageData.data[offset + 1] * 0.7152 +
      imageData.data[offset + 2] * 0.0722;
    const visibleLuminance =
      sourceLuminance * sourceAlpha + 255 * (1 - sourceAlpha);
    const alpha =
      visibleLuminance < 210
        ? Math.round((210 - visibleLuminance) * 2.8)
        : 0;
    imageData.data[offset] = 45;
    imageData.data[offset + 1] = 42;
    imageData.data[offset + 2] = 38;
    imageData.data[offset + 3] = Math.min(255, alpha);
  }

  return imageData;
}

function emptyFillResult(reason: FloodFillReason): FloodFillResult {
  return {
    reason,
    changedPixels: 0,
    regionPixels: 0,
    bounds: null,
    aborted: false,
  };
}

/**
 * Keeps a canvas crisp on high-DPI screens while allowing all drawing code to
 * stay in CSS-pixel coordinates. Calling this repeatedly is cheap; backing
 * dimensions are only assigned when they changed.
 */
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  options: CanvasResizeOptions = {},
): CanvasResizeResult {
  const rect = canvas.getBoundingClientRect();
  const browserDpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1;
  const requestedDpr = clamp(
    finiteOr(options.dpr, browserDpr),
    0.25,
    clamp(finiteOr(options.maxDpr, 3), 0.25, 8),
  );

  const fallbackCssWidth =
    canvas.clientWidth > 0
      ? canvas.clientWidth
      : canvas.width / Math.max(requestedDpr, 0.25);
  const fallbackCssHeight =
    canvas.clientHeight > 0
      ? canvas.clientHeight
      : canvas.height / Math.max(requestedDpr, 0.25);
  const cssWidth = Math.max(
    1,
    finiteOr(
      options.cssWidth,
      rect.width > 0 ? rect.width : Math.max(1, fallbackCssWidth),
    ),
  );
  const cssHeight = Math.max(
    1,
    finiteOr(
      options.cssHeight,
      rect.height > 0 ? rect.height : Math.max(1, fallbackCssHeight),
    ),
  );
  const maxPixels = Math.max(
    1,
    finiteOr(options.maxPixels, 16_777_216),
  );
  const pixelLimitedDpr = Math.sqrt(maxPixels / (cssWidth * cssHeight));
  const dpr = Math.max(0.25, Math.min(requestedDpr, pixelLimitedDpr));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  const changed =
    canvas.width !== pixelWidth || canvas.height !== pixelHeight;

  if (options.cssWidth !== undefined) {
    canvas.style.width = `${cssWidth}px`;
  }
  if (options.cssHeight !== undefined) {
    canvas.style.height = `${cssHeight}px`;
  }
  if (changed) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const scaleX = pixelWidth / cssWidth;
  const scaleY = pixelHeight / cssHeight;
  if (options.applyTransform !== false) {
    const context =
      options.context === undefined ? canvas.getContext("2d") : options.context;
    context?.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  }

  return {
    changed,
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    dpr,
    scaleX,
    scaleY,
  };
}
