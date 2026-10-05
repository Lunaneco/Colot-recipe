/**
 * The single source of truth for materials available to the mixer.
 *
 * Keep the object order intentional: it is also the order used by recipes,
 * import/export and material pickers. Adding a pigment here makes the type
 * system require its formulation in paintCalibration.ts.
 *
 * `color` is the spectral masstone of the pure paint as rendered by
 * `mixPaint({ [id]: 1 })`; a unit test keeps the two in sync so the swatch a
 * user taps is exactly the paint that lands on the palette.
 */
export const MATERIAL_REGISTRY = {
  red: {
    label: "赤",
    color: "#BD0015",
    shortcut: "R",
    role: "pigment",
  },
  blue: {
    label: "青",
    color: "#00547F",
    shortcut: "B",
    role: "pigment",
  },
  yellow: {
    label: "黄",
    color: "#FED200",
    shortcut: "Y",
    role: "pigment",
  },
  black: {
    label: "黒",
    color: "#1D1E20",
    shortcut: "K",
    role: "pigment",
  },
  white: {
    label: "白",
    color: "#faf2e5",
    shortcut: "W",
    role: "pigment",
  },
  water: {
    label: "水",
    color: "#90cbd3",
    shortcut: "A",
    role: "diluent",
  },
} as const;

export type MaterialId = keyof typeof MATERIAL_REGISTRY;
export type PigmentId = {
  [Id in MaterialId]: (typeof MATERIAL_REGISTRY)[Id]["role"] extends "pigment"
    ? Id
    : never;
}[MaterialId];

export const MATERIAL_IDS = Object.freeze(
  Object.keys(MATERIAL_REGISTRY) as MaterialId[],
);
export const PIGMENT_IDS = Object.freeze(
  MATERIAL_IDS.filter(
    (material): material is PigmentId =>
      MATERIAL_REGISTRY[material].role === "pigment",
  ),
);

export type MixerTool = MaterialId | "eraser" | "picker";

export type PaintSize = "small" | "medium" | "large";

export type RecipeUnits = Record<MaterialId, number>;

export type PaintShape = "tap" | "hold" | "stroke";

export type PaintStep = {
  id: string;
  material: MaterialId;
  /**
   * A saved colour placed as one batch. When omitted, the step contributes
   * exactly one unit of `material`, preserving all legacy paint steps.
   */
  recipe?: RecipeUnits;
  /**
   * Number of recipe batches deposited at this point. A short tap omits this
   * field and remains exactly one unit; a long press stores its accumulated
   * load as one undoable action.
   */
  deposit?: number;
  /**
   * Geometry of the placement. Missing legacy values behave as circular taps.
   */
  shape?: PaintShape;
  /** Stable 0–1 phase used to redraw a held paint edge deterministically. */
  waveSeed?: number;
  size: PaintSize;
  x: number;
  y: number;
  createdAt: string;
  /** Continuous deposited amount; omitted legacy dabs contribute one unit. */
  amount?: number;
};

export type MixGesture = {
  id: string;
  kind?: "gesture" | "all";
  /**
   * Material amounts captured when the gesture was made. "Mix all" folds
   * these into the palette centre; manual strokes ignore them and instead
   * drag whatever paint the brush actually passes over along `path`.
   */
  recipe?: RecipeUnits;
  /** Dabs present when this operation occurred, including same-ms ordering. */
  stepIds?: string[];
  /** Path length in canvas pixels. */
  distance: number;
  /** Average pointer speed in canvas pixels per millisecond. */
  speed: number;
  points: number;
  /** Normalised (0–1) pointer positions of a manual stroke, in order. */
  path?: Array<{ x: number; y: number }>;
  createdAt: string;
};

export type MixedColorSnapshot = {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  pigmentRatio: Record<PigmentId, number>;
  opacity: number;
  waterRatio: number;
  intensity: number;
  viscosity: number;
  spread: number;
  dryingSpeed: number;
  name: string;
  /** Absolute local material amounts and effective finite-film thickness. */
  exactPaint?: ExactPaint;
};

export interface OpticalPaintLayer {
  pigment: number[];
  mass: number;
  opacity?: number;
  lighting?: number;
  /** Compose all children first, then apply this group's opacity once. */
  children?: OpticalPaintLayer[];
}

export type ExactPaint = {
  weights: RecipeUnits;
  opticalMass: number;
  opticalStack?: OpticalPaintLayer[];
};

export type CapturedColorAppearance = {
  hex: string;
  opacity: number;
};

export type SavedColor = {
  id: string;
  name: string;
  note: string;
  recipe: RecipeUnits;
  mixed: MixedColorSnapshot;
  /** Exact rendered RGBA captured by the mixing-palette eyedropper. */
  capturedAppearance?: CapturedColorAppearance;
  /** Physical sample independent of the compact, integer recipe summary. */
  exactPaint?: ExactPaint;
  steps: PaintStep[];
  mixGestures: MixGesture[];
  mixMethod: string;
  createdAt: string;
  updatedAt: string;
  order: number;
};

export type AppMode = "mix" | "draw" | "color";

export type BrushTool =
  | "round"
  | "flat"
  | "pencil"
  | "watercolor"
  | "airbrush"
  | "marker"
  | "eyedropper"
  | "eraser"
  | "fill"
  | "blur"
  | "mixer";

export type BrushSettings = {
  size: number;
  opacity: number;
  pressure: number;
  water: number;
  bleed: number;
  hardness: number;
  spacing: number;
  stabilization: number;
};

export type DrawingLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /** Rendered RGBA appearance (thumbnail/export compatible). */
  dataUrl?: string;
  /**
   * Pigment field encoded by `encodePigmentField`: [red/blue/yellow,
   * black/white/mass, body], plus an optional fourth wetness plane and fifth lossless glaze payload.
   * Two-image files predate the body plane. Missing
   * on legacy artworks, which are rebuilt from `dataUrl` through the pigment
   * inverse.
   */
  pigmentDataUrls?: string[];
  /** Epoch time of the pigment snapshot, used to resume physical drying. */
  pigmentSavedAt?: number;
};

export const EMPTY_RECIPE = Object.fromEntries(
  MATERIAL_IDS.map((material) => [material, 0]),
) as RecipeUnits;

/** Backward-compatible projections for existing UI call sites. */
export const MATERIAL_LABELS = Object.fromEntries(
  MATERIAL_IDS.map((material) => [
    material,
    MATERIAL_REGISTRY[material].label,
  ]),
) as Record<MaterialId, string>;

export const MATERIAL_COLORS = Object.fromEntries(
  MATERIAL_IDS.map((material) => [material, MATERIAL_REGISTRY[material].color]),
) as Record<MaterialId, string>;
