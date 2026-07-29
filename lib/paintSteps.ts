import {
  EMPTY_RECIPE,
  MATERIAL_IDS,
  PIGMENT_IDS,
  type MaterialId,
  type PaintStep,
  type RecipeUnits,
} from "./types";

export function paintStepUnits(step: PaintStep, material: MaterialId): number {
  return step.recipe?.[material] ?? (step.material === material ? 1 : 0);
}

export function paintStepRecipe(step: PaintStep): RecipeUnits {
  if (step.recipe) return { ...step.recipe };
  return {
    ...EMPTY_RECIPE,
    [step.material]: 1,
  };
}

export function primaryMaterialForRecipe(recipe: RecipeUnits): MaterialId {
  const pigments = PIGMENT_IDS.filter((material) => recipe[material] > 0);
  if (pigments.length) {
    return pigments.reduce((primary, material) =>
      recipe[material] > recipe[primary] ? material : primary,
    );
  }
  return MATERIAL_IDS.reduce((primary, material) =>
    recipe[material] > recipe[primary] ? material : primary,
  );
}
