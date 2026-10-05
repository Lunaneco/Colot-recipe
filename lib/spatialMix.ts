import {
  mixPaintProportions,
  mixPaintProportionsFromRgb,
  type MixedPaintColor,
} from "./colorScience";
import {
  EMPTY_RECIPE,
  MATERIAL_IDS,
  PIGMENT_IDS,
  type ExactPaint,
  type MaterialId,
  type MixGesture,
  type PaintSize,
  type PaintStep,
  type OpticalPaintLayer,
  type PigmentId,
  type RecipeUnits,
} from "./types";

import { paintStepUnits, paintStepDeposit } from "./paintSteps";

export type SpatialMixState = {
  recipe: RecipeUnits;
  steps: PaintStep[];
  mixGestures: MixGesture[];
  /** A re-expanded measured stack, retained until the paint is manipulated. */
  reopenedPaint?: ExactPaint;
};
export type SpatialSampleViewport = { width: number; height: number };
export type SpatialPaintSample = {
  point: { x: number; y: number };
  /** Continuous local material amounts, including water. */
  weights: Record<MaterialId, number>;
  /** Compact integer summary only; `exactPaint` is authoritative for reuse. */
  recipe: RecipeUnits;
  pigmentRatio: Record<PigmentId, number>;
  waterRatio: number;
  coverage: number;
  mixed: MixedPaintColor;
  exactPaint: ExactPaint;
  renderedAlpha?: number;
  opticalStack?: OpticalPaintLayer[];
  opticalStackScale?: number;
};
const SIZE_RADIUS: Record<PaintSize, number> = { small: 48, medium: 76, large: 108 };
const DEFAULT_VIEWPORT = { width: 1100, height: 760 };
const PROXY_PIGMENT_UNITS = 32;
const COLOUR_RATIO_SUBDIVISIONS = 64;
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


export const MAX_WATER_SPREAD = 1.32;
const GRID_SPACING = 4;
const MATERIAL_COUNT = MATERIAL_IDS.length;
const EMPTY_MIXED = mixPaintProportions(EMPTY_RECIPE);
const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));
const emptyWeights = (): RecipeUnits => ({ ...EMPTY_RECIPE });
const normaliseViewport = (viewport?: SpatialSampleViewport) => ({
  width: Math.max(1, viewport?.width ?? DEFAULT_VIEWPORT.width),
  height: Math.max(1, viewport?.height ?? DEFAULT_VIEWPORT.height),
});
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

export function paintDabSupportRadii(
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
  // A recipe unit is total material, independent of dab width, hold spread,
  // or the wider water footprint. Normalise the analytic kernel integral to
  // the medium circular dab (π * 76² / 2.55). Water expansion changes the
  // exponent above, so its radiusScale is already accounted for there.
  const baseRadii = dabRadii(step, viewport, 1, role);
  const waveAmplitude = role === "pigment" ? paintWaveAmplitude(step) : 0;
  const waveArea = 1 + waveAmplitude ** 2 * (0.68 ** 2 + 0.32 ** 2) / 2;
  const radiusRatio = SIZE_RADIUS.medium / (baseRadii.x * viewport.width);
  const normalisation = radiusRatio ** 2 / waveArea;
  return normalisation * (1 - squaredDistance) ** kernelExponent;
}

function supportRadii(step: PaintStep, viewport: SpatialSampleViewport, scale = 1) {
  const p = paintDabSupportRadii(step, viewport, scale);
  const w = paintStepUnits(step, "water") > 0 ? paintDabSupportRadii(step, viewport, 1, "water") : {x: 0, y: 0};
  return { x: Math.max(p.x, w.x), y: Math.max(p.y, w.y) };
}
function baseWeightsAt(steps: readonly PaintStep[], x: number, y: number,
  viewport: SpatialSampleViewport, weights: RecipeUnits, spreads: Map<PaintStep, number>) {
  for (const step of steps) for (const material of MATERIAL_IDS) {
    const units = paintStepUnits(step, material);
    if (units > 0) weights[material] += units * paintDabContribution(step, x, y, viewport, material === "water" ? 1 : spreads.get(step) ?? 1, material === "water" ? "water" : "pigment");
  }
  return weights;
}

function waterSpreads(steps: readonly PaintStep[], viewport: SpatialSampleViewport) {
  return new Map(steps.map(step => {
    let water = 0;
    for (const source of steps) water += paintStepUnits(source, "water") * paintDabContribution(source, step.x, step.y, viewport, 1, "water");
    return [step, 1 + (MAX_WATER_SPREAD - 1) * (1 - Math.exp(-water * 1.6))];
  }));
}

/** Cartesian cells represent material mass, rather than path coordinates.
 * Revisited cells therefore take part in every exchange: loops and reversals
 * cannot duplicate their pigment. Each transfer conserves every material. */
type MaterialGrid = {
  columns: number; rows: number; dx: number; dy: number; area: number;
  amounts: Float64Array;
};
type PreparedPalette = { grid?: MaterialGrid; laterSteps: PaintStep[] };
const preparedCache = new WeakMap<SpatialMixState, Map<string, PreparedPalette>>();
function makeGrid(viewport: SpatialSampleViewport): MaterialGrid {
  const columns = Math.ceil(viewport.width / GRID_SPACING);
  const rows = Math.ceil(viewport.height / GRID_SPACING);
  const dx = viewport.width / columns, dy = viewport.height / rows;
  return { columns, rows, dx, dy, area: dx * dy,
    amounts: new Float64Array(columns * rows * MATERIAL_COUNT) };
}
function addDab(grid: MaterialGrid, step: PaintStep, viewport: SpatialSampleViewport, scale = 1) {
  const radii = supportRadii(step, viewport, scale);
  const x0 = Math.max(0, Math.floor((step.x - radii.x) * grid.columns));
  const x1 = Math.min(grid.columns - 1, Math.ceil((step.x + radii.x) * grid.columns));
  const y0 = Math.max(0, Math.floor((step.y - radii.y) * grid.rows));
  const y1 = Math.min(grid.rows - 1, Math.ceil((step.y + radii.y) * grid.rows));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let p = 0; p < MATERIAL_COUNT; p++) {
    const material = MATERIAL_IDS[p], units = paintStepUnits(step, material);
    if (units > 0) grid.amounts[(y * grid.columns + x) * MATERIAL_COUNT + p] += units * paintDabContribution(step, (x+.5)/grid.columns, (y+.5)/grid.rows, viewport, material === "water" ? 1 : scale, material === "water" ? "water" : "pigment");
  }
}
function brushPath(gesture: MixGesture, viewport: SpatialSampleViewport, spacing: number) {
  const input = gesture.path ?? [];
  if (input.length < 2) return [];
  const vertices = input.map(p => ({ x: clamp(p.x) * viewport.width, y: clamp(p.y) * viewport.height }));
  const arcs = [0];
  for (let i = 1; i < vertices.length; i += 1) arcs.push(arcs[i - 1] +
    Math.hypot(vertices[i].x - vertices[i - 1].x, vertices[i].y - vertices[i - 1].y));
  const length = arcs[arcs.length - 1];
  if (length <= 0) return [vertices[0]];
  const count = Math.min(4096, Math.max(1, Math.ceil(length / spacing)));
  const result: Array<{ x: number; y: number }> = [];
  let segment = 1;
  for (let i = 0; i <= count; i += 1) {
    const arc = length * i / count;
    while (segment < vertices.length - 1 && arcs[segment] < arc) segment += 1;
    const span = arcs[segment] - arcs[segment - 1];
    const t = span > 0 ? (arc - arcs[segment - 1]) / span : 0;
    result.push({ x: vertices[segment - 1].x + (vertices[segment].x - vertices[segment - 1].x) * t,
      y: vertices[segment - 1].y + (vertices[segment].y - vertices[segment - 1].y) * t });
  }
  return result;
}
function footprint(grid: MaterialGrid, point: { x: number; y: number }, radius: number, exchange: number) {
  const cells: Array<{ offset: number; exchange: number }> = [];
  let area = 0;
  const x0 = Math.max(0, Math.floor((point.x - radius) / grid.dx));
  const x1 = Math.min(grid.columns - 1, Math.ceil((point.x + radius) / grid.dx));
  const y0 = Math.max(0, Math.floor((point.y - radius) / grid.dy));
  const y1 = Math.min(grid.rows - 1, Math.ceil((point.y + radius) / grid.dy));
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const squared = (((x + .5) * grid.dx - point.x) / radius) ** 2 +
      (((y + .5) * grid.dy - point.y) / radius) ** 2;
    if (squared >= 1) continue;
    const e = exchange * (1 - squared) ** 1.5;
    cells.push({ offset: (y * grid.columns + x) * MATERIAL_COUNT, exchange: e });
    area += e * grid.area;
  }
  return { cells, area };
}
function dragPaint(grid: MaterialGrid, gesture: MixGesture, viewport: SpatialSampleViewport) {
  const radius = clamp(.035 + gesture.speed * .018, .035, .09) * DEFAULT_VIEWPORT.width;
  const points = brushPath(gesture, viewport, radius / 6);
  if (!points.length) return;
  const strength = clamp(.92 - gesture.speed * .2, .5, .92);
  const exchange = 1 - (1 - strength) ** (1 / 12);
  const carried = new Float64Array(MATERIAL_COUNT);
  const lifted = new Float64Array(MATERIAL_COUNT);
  for (let i = 0; i < points.length; i += 1) {
    const mask = footprint(grid, points[i], radius, exchange);
    if (mask.area <= 0) continue;
    const distance = i > 0 ? Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) : radius / 6;
    const release = 1 - Math.exp(-distance / (radius * 1.5));
    lifted.fill(0);
    for (const cell of mask.cells) for (let p = 0; p < MATERIAL_COUNT; p += 1) {
      const before = grid.amounts[cell.offset + p];
      lifted[p] += before * cell.exchange * grid.area;
      grid.amounts[cell.offset + p] = before * (1 - cell.exchange) +
        carried[p] * release * cell.exchange / mask.area;
    }
    for (let p = 0; p < MATERIAL_COUNT; p += 1) carried[p] = carried[p] * (1 - release) + lifted[p];
  }
  const mask = footprint(grid, points[points.length - 1], radius, exchange);
  if (mask.area > 0) for (const cell of mask.cells) for (let p = 0; p < MATERIAL_COUNT; p += 1) {
    grid.amounts[cell.offset + p] += carried[p] * cell.exchange / mask.area;
  }
}
function mixAll(grid: MaterialGrid, viewport: SpatialSampleViewport) {
  const total = new Float64Array(MATERIAL_COUNT);
  const shape = new Float64Array(grid.columns * grid.rows);
  let norm = 0;
  for (let y = 0; y < grid.rows; y += 1) for (let x = 0; x < grid.columns; x += 1) {
    const index = y * grid.columns + x;
    for (let p = 0; p < MATERIAL_COUNT; p += 1) total[p] += grid.amounts[index * MATERIAL_COUNT + p] * grid.area;
    const d = (((x + .5) * grid.dx - viewport.width * .5) / 235) ** 2 +
      (((y + .5) * grid.dy - viewport.height * .51) / 137) ** 2;
    shape[index] = d >= 1 ? 0 : (1 - d) ** 1.35;
    norm += shape[index] * grid.area;
  }
  if (norm <= 0) return;
  for (let index = 0; index < shape.length; index += 1) for (let p = 0; p < MATERIAL_COUNT; p += 1)
    grid.amounts[index * MATERIAL_COUNT + p] = total[p] * shape[index] / norm;
}
function preparePalette(state: SpatialMixState, viewport: SpatialSampleViewport): PreparedPalette {
  if (!state.mixGestures.length) return { laterSteps: state.steps };
  const key = `${viewport.width}:${viewport.height}`;
  let versions = preparedCache.get(state);
  if (!versions) { versions = new Map(); preparedCache.set(state, versions); }
  const found = versions.get(key);
  if (found) return found;
  const grid = makeGrid(viewport);
  const consumed = new Set<string>();
  for (const gesture of state.mixGestures) {
    if (gesture.kind !== "all" && (gesture.path?.length ?? 0) < 2) continue;
    const ids = gesture.stepIds ? new Set(gesture.stepIds) : undefined;
    const participating = state.steps.filter(step => ids ? ids.has(step.id) : step.createdAt <= gesture.createdAt);
    const spreads = waterSpreads(participating, viewport);
    const legacyCounts = emptyWeights();
    for (const step of state.steps) {
      for (const material of MATERIAL_IDS) legacyCounts[material] += paintStepUnits(step, material);
      if (consumed.has(step.id)) continue;
      if (ids ? !ids.has(step.id) : step.createdAt > gesture.createdAt) continue;
      // Legacy snapshots predate IDs; recipe counts resolve same-ms additions.
      if (!ids && gesture.recipe && legacyCounts[step.material] > (gesture.recipe[step.material] ?? 0)) continue;
      addDab(grid, step, viewport, spreads.get(step));
      consumed.add(step.id);
    }
    if (gesture.kind === "all") mixAll(grid, viewport);
    else dragPaint(grid, gesture, viewport);
  }
  const result = { grid, laterSteps: state.steps.filter(s => !consumed.has(s.id)) };
  if (versions.size >= 2) versions.clear();
  versions.set(key, result);
  return result;
}
function sampleGrid(grid: MaterialGrid, x: number, y: number, weights: RecipeUnits) {
  const gx = x * grid.columns - .5, gy = y * grid.rows - .5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
  for (let dy = 0; dy <= 1; dy += 1) for (let dx = 0; dx <= 1; dx += 1) {
    const px = x0 + dx, py = y0 + dy;
    if (px < 0 || py < 0 || px >= grid.columns || py >= grid.rows) continue;
    const share = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
    const offset = (py * grid.columns + px) * MATERIAL_COUNT;
    for (let p = 0; p < MATERIAL_COUNT; p += 1) weights[MATERIAL_IDS[p]] += grid.amounts[offset + p] * share;
  }
  return weights;
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

/** Exact local material and finite-film state retained independently of UI units. */
export function exactPaintFromWeights(weights: RecipeUnits): ExactPaint {
  const mass = PIGMENT_IDS.reduce((sum, p) => sum + weights[p], 0);
  const concentration = mass / Math.max(1e-12, mass + weights.water * 1.45);
  return { weights: { ...weights }, opticalMass: mass * concentration ** .8 };
}
/** Re-expand a measured local film without changing its pigment or water mass. */
export function stepsFromExactPaint(paint: ExactPaint, createdAt: string): PaintStep[] {
  return MATERIAL_IDS.filter((material) => paint.weights[material] > 0).map((material) => ({
    id: `measured-${material}-${createdAt}`, material, size: "medium",
    x: 0.5, y: 0.51, amount: paint.weights[material] * (material === "water" ? 1.42 ** 2 : 1), createdAt,
  }));
}
export function scaleOpticalStack(stack: readonly OpticalPaintLayer[], scale: number): OpticalPaintLayer[] {
  return stack.map((layer) => ({ ...layer, pigment: [...layer.pigment], mass: layer.mass * scale,
    ...(layer.children ? { children: scaleOpticalStack(layer.children, scale) } : {}) }));
}
function sampledPaint(weights: RecipeUnits, point: { x: number; y: number }, cache?: Map<string, MixedPaintColor>): SpatialPaintSample {
  const pigmentWeight = PIGMENT_IDS.reduce((sum, p) => sum + weights[p], 0);
  const total = pigmentWeight + weights.water;
  const ratio = Object.fromEntries(PIGMENT_IDS.map(p => [p, pigmentWeight > 0 ? weights[p] / pigmentWeight : 0])) as Record<PigmentId, number>;
  let mixed: MixedPaintColor;
  if (pigmentWeight <= 0 && weights.water <= 0) mixed = EMPTY_MIXED;
  else if (!cache || pigmentWeight <= 0) mixed = mixPaintProportions(weights);
  else {
    const scale = PROXY_PIGMENT_UNITS * COLOUR_RATIO_SUBDIVISIONS / pigmentWeight;
    const values = PIGMENT_IDS.map(p => Math.round(weights[p] * scale));
    const key = values.join(":");
    let colour = cache.get(key);
    if (!colour) {
      colour = mixPaintProportions(Object.fromEntries(PIGMENT_IDS.map((p, i) => [p, values[i]])));
      cache.set(key, colour);
    }
    mixed = mixPaintProportionsFromRgb(weights, colour.rgb);
  }
  return { point, weights, recipe: compactRecipeFromWeights(weights), pigmentRatio: ratio,
    waterRatio: total > 0 ? weights.water / total : 0,
    coverage: clamp(1 - Math.exp(-2.2 * pigmentWeight ** .82)), mixed,
    exactPaint: exactPaintFromWeights(weights) };
}
/** Rendering reads material quantities without constructing recipe summaries. */
export function createSpatialMaterialSampler(state: SpatialMixState, requestedViewport?: SpatialSampleViewport) {
  const viewport = normaliseViewport(requestedViewport);
  const prepared = preparePalette(state, viewport);
  const spreads = waterSpreads(prepared.laterSteps, viewport);
  const columns = 16, rows = Math.max(8, Math.round(columns * viewport.height / viewport.width));
  const bins = Array.from({ length: columns * rows }, () => [] as PaintStep[]);
  for (const step of prepared.laterSteps) {
    const radii = supportRadii(step, viewport, spreads.get(step));
    const x0 = Math.max(0, Math.floor((step.x - radii.x) * columns));
    const x1 = Math.min(columns - 1, Math.floor((step.x + radii.x) * columns));
    const y0 = Math.max(0, Math.floor((step.y - radii.y) * rows));
    const y1 = Math.min(rows - 1, Math.floor((step.y + radii.y) * rows));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) bins[y * columns + x].push(step);
  }
  return (x: number, y: number) => {
    const point = { x: clamp(x), y: clamp(y) };
    const weights = prepared.grid ? sampleGrid(prepared.grid, point.x, point.y, emptyWeights()) : emptyWeights();
    const bx = Math.min(columns - 1, Math.floor(point.x * columns));
    const by = Math.min(rows - 1, Math.floor(point.y * rows));
    baseWeightsAt(bins[by * columns + bx], point.x, point.y, viewport, weights, spreads);
    const pigmentWeight = PIGMENT_IDS.reduce((sum, p) => sum + weights[p], 0);
    const total = pigmentWeight + weights.water;
    const sample: Pick<SpatialPaintSample, "point" | "weights" | "waterRatio" | "coverage" | "opticalStack" | "opticalStackScale"> = {
      point, weights, waterRatio: total > 0 ? weights.water / total : 0,
      coverage: clamp(1 - Math.exp(-2.2 * pigmentWeight ** .82)),
    };
    if (state.reopenedPaint?.opticalStack && !state.mixGestures.length) {
      const measured = state.reopenedPaint;
      const originalMass = PIGMENT_IDS.reduce((sum, p) => sum + measured.weights[p], 0);
      const currentMass = PIGMENT_IDS.reduce((sum, p) => sum + weights[p], 0);
      sample.opticalStack = measured.opticalStack;
      sample.opticalStackScale = originalMass > 0 ? currentMass / originalMass : 0;
    }
    return sample;
  };
}
/** A sampler replays operations once and derives the inspector at the selected point. */
export function createSpatialPaintSampler(state: SpatialMixState, requestedViewport?: SpatialSampleViewport) {
  const sampleMaterial = createSpatialMaterialSampler(state, requestedViewport);
  return (x: number, y: number, cache?: Map<string, MixedPaintColor>) => {
    const material = sampleMaterial(x, y);
    const sample = sampledPaint(material.weights, material.point, cache);
    if (material.opticalStack) {
      sample.opticalStack = material.opticalStack;
      sample.opticalStackScale = material.opticalStackScale;
      sample.exactPaint.opticalMass = state.reopenedPaint!.opticalMass * material.opticalStackScale!;
    }
    return sample;
  };
}
export function sampleSpatialPaint(state: SpatialMixState, x: number, y: number,
  cache?: Map<string, MixedPaintColor>, viewport?: SpatialSampleViewport) {
  return createSpatialPaintSampler(state, viewport)(x, y, cache);
}
