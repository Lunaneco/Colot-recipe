import {
  mixPaintProportions,
  mixPaintProportionsFromRgb,
  type MixedPaintColor,
} from "./colorScience";
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
import { paintStepDeposit, paintStepUnits } from "./paintSteps";

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
  /** Compact integer proxy for display/saving; exact colour uses `weights`. */
  recipe: RecipeUnits;
  pigmentRatio: Record<PigmentId, number>;
  waterRatio: number;
  coverage: number;
  mixed: MixedPaintColor;
  /** Alpha read from the rendered palette when sampled by the eyedropper. */
  renderedAlpha?: number;
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
const COLOUR_RATIO_SUBDIVISIONS = 64;
// Keep a sampled recipe within the persistence schema's per-material limit
// while retaining ratios as small as one part in 500 (for example 998:2).
const MAX_LOCAL_RECIPE_UNITS = 1_000;
// Stop at the smallest integer recipe whose summed material-share error is at
// most 0.2 percentage points. This keeps ordinary sampled recipes reusable
// instead of needlessly consuming the full persistence allowance.
const MAX_LOCAL_RECIPE_TOTAL_SHARE_ERROR = 0.002;
// At or below a 0.2% pigment share, absolute total-recipe error can hide a
// colourant in water. Preserve these traces against the pigment-only ratio to
// within 0.1%; 998:2 therefore remains the exact reduced ratio 499:1.
const TRACE_PIGMENT_SHARE = 1 / 500;
const MAX_TRACE_PIGMENT_RELATIVE_ERROR = 0.001;

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
  role: "pigment" | "water" = "pigment",
) {
  const holdSpread =
    role === "pigment" && step.shape === "hold"
      ? clamp(
          1.16 + Math.max(0, paintStepDeposit(step) - 2) * 0.024,
          1.16,
          1.3,
        )
      : 1;
  const radius = SIZE_RADIUS[step.size] * holdSpread;
  const horizontalScale = role === "water" ? 1.42 : 1;
  const verticalScale = role === "water" ? 1.42 : 1;
  return {
    x: (radius * horizontalScale * radiusScale) / viewport.width,
    y: (radius * verticalScale * radiusScale) / viewport.height,
  };
}

function stableWaveSeed(step: PaintStep) {
  if (step.waveSeed !== undefined) return clamp(step.waveSeed);
  let hash = 2166136261;
  for (let index = 0; index < step.id.length; index += 1) {
    hash ^= step.id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function paintWaveAmplitude(step: PaintStep) {
  if (step.shape === "stroke") return 0.038;
  if (step.shape !== "hold") return 0;
  return clamp(
    0.028 + Math.max(0, paintStepDeposit(step) - 2) * 0.008,
    0.028,
    0.085,
  );
}

function paintWaveScale(step: PaintStep, angle: number) {
  const amplitude = paintWaveAmplitude(step);
  if (amplitude === 0) return 1;
  const phase = stableWaveSeed(step) * Math.PI * 2;
  return (
    1 +
    amplitude *
      (0.68 * Math.sin(angle * 6 + phase) +
        0.32 * Math.sin(angle * 11 - phase * 0.73))
  );
}

function dabSupportRadii(
  step: PaintStep,
  viewport: SpatialSampleViewport,
  radiusScale = 1,
  role: "pigment" | "water" = "pigment",
) {
  const radii = dabRadii(step, viewport, radiusScale, role);
  const waveSupport = role === "pigment" ? 1 + paintWaveAmplitude(step) : 1;
  return {
    x: radii.x * waveSupport,
    y: radii.y * waveSupport,
  };
}

export function paintDabContribution(
  step: PaintStep,
  x: number,
  y: number,
  viewport: SpatialSampleViewport,
  radiusScale = 1,
  role: "pigment" | "water" = "pigment",
) {
  const radii = dabRadii(step, viewport, radiusScale, role);
  const dx = (x - step.x) / radii.x;
  const dy = (y - step.y) / radii.y;
  const radialDistance = Math.hypot(dx, dy);
  const waveScale =
    role === "pigment" ? paintWaveScale(step, Math.atan2(dy, dx)) : 1;
  const squaredDistance = (radialDistance / waveScale) ** 2;
  if (squaredDistance >= 1) return 0;

  // A smooth compact kernel keeps a tap exactly circular in physical pixels.
  // When water expands both radii by s, raising the exponent from p to
  // s²(p + 1) - 1 preserves the analytic kernel integral while keeping the
  // centre contribution exactly one unit. This spreads/thins the shoulder
  // without either creating pigment mass or corrupting a centre 1:1 ratio.
  const dryExponent = 1.55;
  const kernelExponent =
    role === "pigment" && radiusScale > 1
      ? radiusScale ** 2 * (dryExponent + 1) - 1
      : dryExponent;
  return (1 - squaredDistance) ** kernelExponent;
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
 * Quantised colour proxy used only when a caller supplies a render cache.
 * Direct samples must send their continuous weights to the colour engine.
 */
function colourRecipeFromWeights(
  weights: Record<MaterialId, number>,
): Required<RecipeUnits> {
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

  const scale = PROXY_PIGMENT_UNITS / pigmentWeight;
  const quantize = (value: number) =>
    Math.round(value * COLOUR_RATIO_SUBDIVISIONS) /
    COLOUR_RATIO_SUBDIVISIONS;
  return Object.fromEntries(
    MATERIAL_IDS.map((material) => [
      material,
      quantize(weights[material] * scale),
    ]),
  ) as Required<RecipeUnits>;
}

function compactRecipeFromWeights(
  weights: Record<MaterialId, number>,
): RecipeUnits {
  const totalWeight = MATERIAL_IDS.reduce(
    (total, material) => total + weights[material],
    0,
  );
  if (totalWeight <= 0) return { ...EMPTY_RECIPE };

  const activeMaterials = MATERIAL_IDS.filter(
    (material) => weights[material] > 1e-8,
  );
  const pigmentWeight = PIGMENT_IDS.reduce(
    (total, pigment) => total + weights[pigment],
    0,
  );
  const dominantPigment =
    pigmentWeight > 0
      ? PIGMENT_IDS.reduce((largest, pigment) =>
          weights[pigment] > weights[largest] ? pigment : largest,
        )
      : undefined;
  const minimumRepresentableShare = 0.5 / MAX_LOCAL_RECIPE_UNITS;
  const requiredMaterials = new Set<MaterialId>(
    PIGMENT_IDS.filter(
      (pigment) =>
        pigmentWeight > 0 &&
        weights[pigment] / pigmentWeight >= minimumRepresentableShare,
    ),
  );
  if (weights.water / totalWeight >= minimumRepresentableShare) {
    requiredMaterials.add("water");
  }
  if (dominantPigment) requiredMaterials.add(dominantPigment);
  let bestRecipe: RecipeUnits | undefined;
  let bestError = Number.POSITIVE_INFINITY;

  for (
    let totalUnits = activeMaterials.length;
    totalUnits <= MAX_LOCAL_RECIPE_UNITS;
    totalUnits += 1
  ) {
    const exactUnits = MATERIAL_IDS.map(
      (material) => (weights[material] / totalWeight) * totalUnits,
    );
    const units = exactUnits.map(Math.floor);
    const remaining =
      totalUnits - units.reduce((sum, value) => sum + value, 0);
    const remainderOrder = MATERIAL_IDS.map((_, index) => index).sort(
      (left, right) =>
        exactUnits[right] - units[right] -
          (exactUnits[left] - units[left]) ||
        left - right,
    );
    for (let index = 0; index < remaining; index += 1) {
      units[remainderOrder[index]] += 1;
    }

    for (const material of requiredMaterials) {
      const materialIndex = MATERIAL_IDS.indexOf(material);
      if (units[materialIndex] > 0) continue;
      const donorIndex = units.reduce(
        (largestIndex, value, index) =>
          value > units[largestIndex] ? index : largestIndex,
        0,
      );
      if (units[donorIndex] <= 1) continue;
      units[donorIndex] -= 1;
      units[materialIndex] = 1;
    }

    const error = MATERIAL_IDS.reduce((sum, material, index) => {
      const exactShare = weights[material] / totalWeight;
      const candidateShare = units[index] / totalUnits;
      return sum + Math.abs(exactShare - candidateShare);
    }, 0);
    const candidatePigmentUnits = PIGMENT_IDS.reduce(
      (sum, pigment) => sum + units[MATERIAL_IDS.indexOf(pigment)],
      0,
    );
    const preservesTracePigments = PIGMENT_IDS.every((pigment) => {
      if (
        weights[pigment] <= 0 ||
        pigmentWeight <= 0 ||
        !requiredMaterials.has(pigment)
      ) {
        return true;
      }
      const exactPigmentShare = weights[pigment] / pigmentWeight;
      if (exactPigmentShare > TRACE_PIGMENT_SHARE + 1e-12) return true;
      if (candidatePigmentUnits <= 0) return false;
      const candidatePigmentShare =
        units[MATERIAL_IDS.indexOf(pigment)] / candidatePigmentUnits;
      return (
        Math.abs(candidatePigmentShare - exactPigmentShare) /
          exactPigmentShare <=
        MAX_TRACE_PIGMENT_RELATIVE_ERROR
      );
    });
    const candidateRecipe = Object.fromEntries(
      MATERIAL_IDS.map((material, index) => [material, units[index]]),
    ) as RecipeUnits;
    if (
      error <= MAX_LOCAL_RECIPE_TOTAL_SHARE_ERROR + 1e-12 &&
      preservesTracePigments
    ) {
      return candidateRecipe;
    }
    if (error + 1e-12 < bestError) {
      bestError = error;
      bestRecipe = candidateRecipe;
    }
  }

  if (bestRecipe) return bestRecipe;
  if (dominantPigment) {
    return {
      ...EMPTY_RECIPE,
      [dominantPigment]: 1,
    };
  }
  return {
    ...EMPTY_RECIPE,
    water: weights.water > 0 ? 1 : 0,
  };
}

/**
 * Samples the locally overlapping paint at a normalised palette coordinate.
 * The returned ratio is spatial: moving through an overlap changes the recipe
 * continuously, while every original dab still represents exactly one unit.
 * Without a colour cache, the spectral engine receives those continuous
 * weights unchanged. Supplying a cache explicitly opts rendering into a
 * bounded ratio quantisation so neighbouring pixels can reuse colours.
 */
export function sampleSpatialPaint(
  state: SpatialMixState,
  x: number,
  y: number,
  colourCache?: Map<string, MixedPaintColor>,
  requestedViewport?: SpatialSampleViewport,
): SpatialPaintSample {
  const sample = sampleSpatialPaintFromSteps(
    state,
    state.steps,
    x,
    y,
    colourCache,
    normaliseViewport(requestedViewport),
  );
  return {
    ...sample,
    recipe: compactRecipeFromWeights(sample.weights),
  };
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
    const waterUnits = paintStepUnits(step, "water");
    if (waterUnits <= 0) continue;
    weights.water += waterUnits * paintDabContribution(
      step,
      point.x,
      point.y,
      viewport,
      1,
      "water",
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
    const hasPigment = PIGMENT_IDS.some(
      (pigment) => paintStepUnits(step, pigment) > 0,
    );
    if (!hasPigment) continue;
    const contribution = paintDabContribution(
      step,
      point.x,
      point.y,
      viewport,
      wetSpread,
      "pigment",
    );
    for (const pigment of PIGMENT_IDS) {
      weights[pigment] += paintStepUnits(step, pigment) * contribution;
    }
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
  const mixed = (() => {
    if (!colourCache) {
      return mixPaintProportions(weights);
    }

    // Dense field rendering deliberately trades sub-pixel ratio precision for
    // cache reuse. Picker/direct sampling never enters this branch.
    const colourRecipe = colourRecipeFromWeights(weights);
    const cacheKey = PIGMENT_IDS.map(
      (pigment) =>
        Math.round(colourRecipe[pigment] * COLOUR_RATIO_SUBDIVISIONS),
    ).join(":");
    const cached = colourCache.get(cacheKey);
    if (cached) {
      return mixPaintProportionsFromRgb(weights, cached.rgb);
    }

    const calculated = mixPaintProportions(colourRecipe);
    colourCache.set(cacheKey, calculated);
    return mixPaintProportionsFromRgb(weights, calculated.rgb);
  })();

  return {
    point,
    weights,
    recipe,
    pigmentRatio,
    waterRatio,
    coverage: clamp(1 - Math.exp(-2.2 * pigmentWeight ** 0.82)),
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
    const hasPigment = PIGMENT_IDS.some(
      (pigment) => paintStepUnits(step, pigment) > 0,
    );
    const hasWater = paintStepUnits(step, "water") > 0;
    const pigmentRadii = hasPigment
      ? dabSupportRadii(step, viewport, 1.32, "pigment")
      : { x: 0, y: 0 };
    const waterRadii = hasWater
      ? dabSupportRadii(step, viewport, 1, "water")
      : { x: 0, y: 0 };
    const radii = {
      x: Math.max(pigmentRadii.x, waterRadii.x),
      y: Math.max(pigmentRadii.y, waterRadii.y),
    };
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
