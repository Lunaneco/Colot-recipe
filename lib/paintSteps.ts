import {
  MATERIAL_IDS,
  PIGMENT_IDS,
  type MaterialId,
  type PaintStep,
  type RecipeUnits,
} from "./types";

export function paintStepDeposit(step: PaintStep): number {
  return step.deposit ?? 1;
}

export function paintStepUnits(step: PaintStep, material: MaterialId): number {
  const batchUnits =
    step.recipe === undefined
      ? step.material === material
        ? 1
        : 0
      : (step.recipe[material] ?? 0);
  return batchUnits * paintStepDeposit(step);
}

export function paintStepRecipe(step: PaintStep): RecipeUnits {
  const deposit = paintStepDeposit(step);
  return Object.fromEntries(
    MATERIAL_IDS.map((material) => [
      material,
      (step.recipe === undefined
        ? step.material === material
          ? 1
          : 0
        : (step.recipe[material] ?? 0)) * deposit,
    ]),
  ) as RecipeUnits;
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
