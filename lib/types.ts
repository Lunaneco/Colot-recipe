/**
 * The single source of truth for materials available to the mixer.
 *
 * Keep the object order intentional: it is also the order used by recipes,
 * import/export and material pickers. Adding a pigment here makes the type
 * system require its optical data in colorScience.ts.
 */
export const MATERIAL_REGISTRY = {
  red: {
    label: "赤",
    color: "#c73e3a",
    shortcut: "R",
    role: "pigment",
  },
  blue: {
    label: "青",
    color: "#285a9f",
    shortcut: "B",
    role: "pigment",
  },
  yellow: {
    label: "黄",
    color: "#e7b82d",
    shortcut: "Y",
    role: "pigment",
  },
  white: {
    label: "白",
    color: "#f8f3e8",
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
export type MaterialRole =
  (typeof MATERIAL_REGISTRY)[MaterialId]["role"];
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

export type PaintStep = {
  id: string;
  material: MaterialId;
  size: PaintSize;
  x: number;
  y: number;
  createdAt: string;
};

export type MixGesture = {
  id: string;
  kind?: "gesture" | "all";
  /** Material amounts captured when the gesture was made. */
  recipe?: RecipeUnits;
  distance: number;
  speed: number;
  points: number;
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
  dataUrl?: string;
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
  MATERIAL_IDS.map((material) => [
    material,
    MATERIAL_REGISTRY[material].color,
  ]),
) as Record<MaterialId, string>;
