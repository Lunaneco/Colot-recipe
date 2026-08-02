"use client";

import { ChevronRight, Palette } from "lucide-react";
import type { MixedColorSnapshot } from "../lib/types";

type CurrentPaintPickerProps = {
  color: MixedColorSnapshot;
  colorName: string;
  label: "現在の色" | "ぬりえの色";
  testId: "drawing-color-picker" | "coloring-color-picker";
  onOpenPalette: () => void;
};

export function CurrentPaintPicker({
  color,
  colorName,
  label,
  testId,
  onOpenPalette,
}: CurrentPaintPickerProps) {
  return (
    <button
      type="button"
      className="studio-color-picker"
      style={{
        "--current-paint": color.hex,
        "--current-opacity": Math.max(0.45, color.opacity),
      } as React.CSSProperties}
      onClick={onOpenPalette}
      aria-label={`現在の色は${colorName}。保存パレットから変更`}
      aria-controls="saved-palette-panel"
      data-testid={testId}
    >
      <span className="studio-color-picker__swatch" aria-hidden="true" />
      <span className="studio-color-picker__copy">
        <span>{label}</span>
        <strong>{colorName}</strong>
      </span>
      <span className="studio-color-picker__action" aria-hidden="true">
        <Palette size={16} />
        <span>色を変える</span>
        <ChevronRight size={15} />
      </span>
    </button>
  );
}
