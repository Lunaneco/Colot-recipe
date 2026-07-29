import { mixPaint, type MixedPaintColor } from "./colorScience";
import {
  EMPTY_RECIPE,
  MATERIAL_IDS,
  PIGMENT_IDS,
  type MaterialId,
  type MixGesture,
  type PaintSize,
  type PaintStep,
  type PigmentId,
  type RecipeUnits,
} from "./types";

export type SpatialMixState = {
  recipe: RecipeUnits;
  steps: PaintStep[];
  mixGestures: MixGesture[];
};

export type SpatialSampleViewport = {
  width: number;
  height: number;
};

export type SpatialPaintSample = {
  point: { x: number; y: number };
  /**
   * Local material contribution before normalisation. A dab contributes one
   * unit at its centre and fades smoothly toward its irregular edge.
   */
  weights: Record<MaterialId, number>;
  /** Integer proxy recipe used by the spectral colour engine. */
  recipe: RecipeUnits;
  pigmentRatio: Record<PigmentId, number>;
  waterRatio: number;
  coverage: number;
  mixed: MixedPaintColor;
};

const SIZE_RADIUS: Record<PaintSize, number> = {
  small: 48,
  medium: 76,
  large: 108,
};

const DEFAULT_VIEWPORT: SpatialSampleViewport = {
  width: 1100,
  height: 760,
};
const PROXY_PIGMENT_UNITS = 32;
const SPATIAL_INDEX_COLUMNS = 16;
// A single dry dab remains body-paint dense, while a second coat still has
// enough optical headroom to become visibly deeper instead of saturating.
const PIGMENT_COVERAGE_RATE = 2.4;

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

function normaliseViewport(
  viewport: SpatialSampleViewport | undefined,
): SpatialSampleViewport {
  return {
    width: Math.max(1, viewport?.width ?? DEFAULT_VIEWPORT.width),
    height: Math.max(1, viewport?.height ?? DEFAULT_VIEWPORT.height),
  };
}

function emptyWeights(): Record<MaterialId, number> {
  return { ...EMPTY_RECIPE };
}

function dabRadii(
  step: PaintStep,
  viewport: SpatialSampleViewport,
  radiusScale = 1,
) {
  const radius = SIZE_RADIUS[step.size];
  const waterScale = step.material === "water" ? 1.42 : 1;
  return {
    x: (radius * waterScale * radiusScale) / viewport.width,
    y:
      (radius *
        (step.material === "water" ? 1.08 : 0.82) *
        radiusScale) /
      viewport.height,
  };
}

function dabContribution(
  step: PaintStep,
  x: number,
  y: number,
  viewport: SpatialSampleViewport,
  radiusScale = 1,
) {
  const radii = dabRadii(step, viewport, radiusScale);
  const dx = (x - step.x) / radii.x;
  const dy = (y - step.y) / radii.y;
  const squaredDistance = dx * dx + dy * dy;
  if (squaredDistance >= 1) return 0;

  // A smooth compact kernel keeps each placement equal to one unit at the
  // centre while allowing physically plausible, gradual overlap at the edge.
  return (1 - squaredDistance) ** 1.55;
}

function distanceToSegment(
  x: number,
  y: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  viewport: SpatialSampleViewport,
) {
  const pointX = x * viewport.width;
  const pointY = y * viewport.height;
  const startX = start.x * viewport.width;
  const startY = start.y * viewport.height;
  const segmentX = (end.x - start.x) * viewport.width;
  const segmentY = (end.y - start.y) * viewport.height;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }
  const amount = clamp(
    ((pointX - startX) * segmentX + (pointY - startY) * segmentY) /
      lengthSquared,
  );
  return Math.hypot(
    pointX - (startX + segmentX * amount),
    pointY - (startY + segmentY * amount),
  );
}

function gestureInfluence(
  gesture: MixGesture,
  x: number,
  y: number,
  viewport: SpatialSampleViewport,
) {
  if (gesture.kind === "all") {
    const dx = (x - 0.5) / (235 / viewport.width);
    const dy = (y - 0.51) / (137 / viewport.height);
    const distance = dx * dx + dy * dy;
    return distance >= 1 ? 0 : (1 - distance) ** 1.35 * 3.2;
  }

  const path = gesture.path ?? [];
  if (path.length < 2) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToSegment(
        x,
        y,
        path[index - 1],
        path[index],
        viewport,
      ),
    );
  }
  const width =
    clamp(0.035 + gesture.speed * 0.018, 0.035, 0.09) *
    DEFAULT_VIEWPORT.width;
  if (nearest >= width) return 0;
  return (1 - nearest / width) ** 1.5 * 0.9;
}

function proxyRecipeFromWeights(
  weights: Record<MaterialId, number>,
): RecipeUnits {
  const pigmentWeight = PIGMENT_IDS.reduce(
    (total, pigment) => total + weights[pigment],
    0,
  );
  if (pigmentWeight <= 0) {
    return {
      ...EMPTY_RECIPE,
      water: weights.water > 0 ? 1 : 0,
    };
  }

  const recipe = {
    ...EMPTY_RECIPE,
    water: Math.min(
      96,
      Math.max(
        0,
        Math.round((weights.water / pigmentWeight) * PROXY_PIGMENT_UNITS),
      ),
    ),
  } satisfies RecipeUnits;

  for (const pigment of PIGMENT_IDS) {
    recipe[pigment] =
      weights[pigment] <= 0
        ? 0
        : Math.max(
            1,
            Math.round(
              (weights[pigment] / pigmentWeight) * PROXY_PIGMENT_UNITS,
            ),
          );
  }
  return recipe;
}

/**
 * Samples the locally overlapping paint at a normalised palette coordinate.
 * The returned ratio is spatial: moving through an overlap changes the recipe
 * continuously, while every original dab still represents exactly one unit.
 */
export function sampleSpatialPaint(
  state: SpatialMixState,
  x: number,
  y: number,
  colourCache?: Map<string, MixedPaintColor>,
  requestedViewport?: SpatialSampleViewport,
): SpatialPaintSample {
  return sampleSpatialPaintFromSteps(
    state,
    state.steps,
    x,
    y,
    colourCache,
    normaliseViewport(requestedViewport),
  );
}

function sampleSpatialPaintFromSteps(
  state: SpatialMixState,
  steps: PaintStep[],
  x: number,
  y: number,
  colourCache: Map<string, MixedPaintColor> | undefined,
  viewport: SpatialSampleViewport,
): SpatialPaintSample {
  const point = { x: clamp(x), y: clamp(y) };
  const weights = emptyWeights();

  // First measure local water. It can carry nearby pigment slightly beyond
  // the edge of a dry dab, but it never changes a distant, unrelated area.
  for (const step of steps) {
    if (step.material !== "water") continue;
    weights.water += dabContribution(
      step,
      point.x,
      point.y,
      viewport,
    );
  }

  for (const gesture of state.mixGestures) {
    const influence = gestureInfluence(
      gesture,
      point.x,
      point.y,
      viewport,
    );
    if (influence <= 0) continue;
    const gestureRecipe = gesture.recipe ?? state.recipe;
    if (gesture.kind === "all" && gestureRecipe.water > 0) {
      weights.water += gestureRecipe.water * influence;
    }
  }

  const wetness = 1 - Math.exp(-weights.water * 1.6);
  const wetSpread = 1 + wetness * 0.32;

  for (const step of steps) {
    if (step.material === "water") continue;
    weights[step.material] += dabContribution(
      step,
      point.x,
      point.y,
      viewport,
      wetSpread,
    );
  }

  // A mixing stroke uses the material amounts captured when the gesture was
  // made. Manual strokes do not pull remote water through unrelated regions;
  // "mix all" deliberately includes water present at that moment.
  for (const gesture of state.mixGestures) {
    const influence = gestureInfluence(
      gesture,
      point.x,
      point.y,
      viewport,
    );
    if (influence <= 0) continue;
    const gestureRecipe = gesture.recipe ?? state.recipe;
    for (const pigment of PIGMENT_IDS) {
      const total = gestureRecipe[pigment];
      if (total > 0) weights[pigment] += total * influence;
    }
  }

  const pigmentWeight = PIGMENT_IDS.reduce(
    (total, pigment) => total + weights[pigment],
    0,
  );
  const totalWeight = pigmentWeight + weights.water;
  const pigmentRatio = Object.fromEntries(
    PIGMENT_IDS.map((pigment) => [
      pigment,
      pigmentWeight > 0 ? weights[pigment] / pigmentWeight : 0,
    ]),
  ) as Record<PigmentId, number>;
  const waterRatio = totalWeight > 0 ? weights.water / totalWeight : 0;
  const recipe = proxyRecipeFromWeights(weights);
  const cacheKey = MATERIAL_IDS.map((material) => recipe[material]).join(":");
  let mixed = colourCache?.get(cacheKey);
  if (!mixed) {
    mixed = mixPaint(recipe);
    colourCache?.set(cacheKey, mixed);
  }

  return {
    point,
    weights,
    recipe,
    pigmentRatio,
    waterRatio,
    coverage: clamp(
      1 - Math.exp(-pigmentWeight * PIGMENT_COVERAGE_RATE),
    ),
    mixed,
  };
}

/**
 * Builds a lightweight spatial index for dense field rendering. The returned
 * sampler is mathematically equivalent to `sampleSpatialPaint`, but checks
 * only dabs whose compact support can reach the requested cell.
 */
export function createSpatialPaintSampler(
  state: SpatialMixState,
  requestedViewport?: SpatialSampleViewport,
) {
  const viewport = normaliseViewport(requestedViewport);
  const rows = Math.max(
    8,
    Math.round(
      SPATIAL_INDEX_COLUMNS * (viewport.height / viewport.width),
    ),
  );
  const bins = Array.from(
    { length: SPATIAL_INDEX_COLUMNS * rows },
    () => [] as PaintStep[],
  );

  for (const step of state.steps) {
    // Pigment may spread into a neighbouring wet dab by up to 32%, so the
    // spatial index must include that maximum reach.
    const radii = dabRadii(
      step,
      viewport,
      step.material === "water" ? 1 : 1.32,
    );
    const firstColumn = Math.max(
      0,
      Math.floor((step.x - radii.x) * SPATIAL_INDEX_COLUMNS),
    );
    const lastColumn = Math.min(
      SPATIAL_INDEX_COLUMNS - 1,
      Math.floor((step.x + radii.x) * SPATIAL_INDEX_COLUMNS),
    );
    const firstRow = Math.max(0, Math.floor((step.y - radii.y) * rows));
    const lastRow = Math.min(
      rows - 1,
      Math.floor((step.y + radii.y) * rows),
    );

    for (let row = firstRow; row <= lastRow; row += 1) {
      for (
        let column = firstColumn;
        column <= lastColumn;
        column += 1
      ) {
        bins[row * SPATIAL_INDEX_COLUMNS + column].push(step);
      }
    }
  }

  return (
    x: number,
    y: number,
    colourCache?: Map<string, MixedPaintColor>,
  ) => {
    const pointX = clamp(x);
    const pointY = clamp(y);
    const column = Math.min(
      SPATIAL_INDEX_COLUMNS - 1,
      Math.floor(pointX * SPATIAL_INDEX_COLUMNS),
    );
    const row = Math.min(rows - 1, Math.floor(pointY * rows));
    return sampleSpatialPaintFromSteps(
      state,
      bins[row * SPATIAL_INDEX_COLUMNS + column],
      pointX,
      pointY,
      colourCache,
      viewport,
    );
  };
}
