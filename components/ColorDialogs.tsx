"use client";

import {
  Beaker,
  Brush,
  Copy,
  Heart,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppMode, MixedColorSnapshot, RecipeUnits, SavedColor } from "../lib/types";
import {
  MATERIAL_IDS,
  MATERIAL_LABELS,
  PIGMENT_IDS,
} from "../lib/types";

function useDialogFocus(
  active: boolean,
  onClose: () => void,
  initialFocus?: React.RefObject<HTMLElement | null>,
) {
  const dialog = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!active) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const frame = window.requestAnimationFrame(() => {
      initialFocus?.current?.focus();
      if (!initialFocus?.current) {
        dialog.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
      }
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const focusTarget = previousFocus.current;
      const canRestorePreviousFocus =
        focusTarget?.isConnected &&
        focusTarget.getClientRects().length > 0 &&
        window.getComputedStyle(focusTarget).display !== "none" &&
        window.getComputedStyle(focusTarget).visibility !== "hidden";
      if (canRestorePreviousFocus) {
        focusTarget.focus();
      } else {
        document
          .querySelector<HTMLElement>('[data-testid="palette-toggle"]')
          ?.focus();
      }
    };
  }, [active, initialFocus]);

  return dialog;
}

type SaveColorDialogProps = {
  open: boolean;
  mixed: MixedColorSnapshot;
  recipe: RecipeUnits;
  sampled?: boolean;
  onClose: () => void;
  onSave: (name: string, note: string) => void;
};

export function SaveColorDialog({
  open,
  mixed,
  recipe,
  sampled = false,
  onClose,
  onSave,
}: SaveColorDialogProps) {
  const [name, setName] = useState(mixed.name);
  const [note, setNote] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus(open, onClose, nameInput);

  if (!open) return null;

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="dialog-card save-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="閉じる"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div
          className={`dialog-paint-preview ${sampled ? "is-captured" : ""}`}
          style={{
            "--preview-color": mixed.hex,
            "--preview-opacity": sampled
              ? mixed.opacity
              : Math.max(0.45, mixed.opacity),
          } as React.CSSProperties}
        >
          <Sparkles size={22} aria-hidden="true" />
        </div>
        <p className="eyebrow">
          {sampled ? "スポイト地点の色を残す" : "できた色を残す"}
        </p>
        <h2 id="save-dialog-title">この色を登録</h2>
        <label>
          色の名前
          <input
            ref={nameInput}
            value={name}
            maxLength={30}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          ひとことメモ <span>任意</span>
          <textarea
            value={note}
            maxLength={120}
            placeholder="例：夕方の空を描くための色"
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="save-dialog__summary">
          <span>{mixed.hex.toUpperCase()}</span>
          <span>
            {MATERIAL_IDS
              .filter((key) => recipe[key] > 0)
              .map((key) => `${MATERIAL_LABELS[key]}${recipe[key]}`)
              .join("・")}
          </span>
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={!name.trim()}
          onClick={() => onSave(name.trim(), note.trim())}
          data-testid="confirm-save-color"
        >
          <Heart size={18} fill="currentColor" aria-hidden="true" />
          パレットに保存
        </button>
      </section>
    </div>
  );
}

type ColorDetailDialogProps = {
  color?: SavedColor;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (color: SavedColor) => void;
  onDelete: (id: string) => void;
  onReopen: (color: SavedColor) => void;
  onUseInMixer: (color: SavedColor) => void;
  onUse: (color: SavedColor, mode: AppMode) => void;
};

export function ColorDetailDialog({
  color,
  onClose,
  onRename,
  onDuplicate,
  onDelete,
  onReopen,
  onUseInMixer,
  onUse,
}: ColorDetailDialogProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(color?.name ?? "");
  const dialogRef = useDialogFocus(Boolean(color), onClose);

  if (!color) return null;
  const pigmentTotal = PIGMENT_IDS.reduce(
    (sum, key) => sum + color.recipe[key],
    0,
  );

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="dialog-card color-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="color-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
        data-testid="recipe-dialog"
      >
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="閉じる"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div className="color-detail__top">
          <div
            className={`color-detail__swatch ${color.capturedAppearance ? "is-captured" : ""}`}
            style={{
              "--detail-swatch": color.mixed.hex,
              "--detail-opacity": color.capturedAppearance
                ? color.mixed.opacity
                : Math.max(0.48, color.mixed.opacity),
            } as React.CSSProperties}
          />
          <div>
            <p className="eyebrow">保存したレシピ</p>
            {editing ? (
              <>
                <h2 id="color-detail-title" className="visually-hidden">
                  {color.name}
                </h2>
                <div className="inline-edit">
                  <input
                    aria-label="色の名前"
                    value={name}
                    maxLength={30}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label="名前を保存"
                    onClick={() => {
                      if (name.trim()) onRename(color.id, name.trim());
                      setEditing(false);
                    }}
                  >
                    <Save size={16} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <button
                className="editable-title"
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`${color.name}の名前を変更`}
              >
                <h2 id="color-detail-title">{color.name}</h2>
                <span>名前を変更</span>
              </button>
            )}
            <p className="color-detail__date">
              {new Intl.DateTimeFormat("ja-JP", {
                year: "numeric",
                month: "short",
                day: "numeric",
              }).format(new Date(color.createdAt))}
            </p>
          </div>
        </div>

        <div className="color-detail__values">
          <div>
            <span>HEX</span>
            <strong>{color.mixed.hex.toUpperCase()}</strong>
          </div>
          <div>
            <span>RGB</span>
            <strong>
              {color.mixed.rgb.r}, {color.mixed.rgb.g}, {color.mixed.rgb.b}
            </strong>
          </div>
          <div>
            <span>水分</span>
            <strong>{Math.round(color.mixed.waterRatio * 100)}%</strong>
          </div>
        </div>

        <p className="color-detail__method" data-testid="mix-method">
          作り方：{color.mixMethod}
        </p>

        <div className="color-detail__recipe">
          <h3>配合</h3>
          {PIGMENT_IDS
            .filter((key) => color.recipe[key] > 0)
            .map((key) => (
              <div key={key}>
                <span>{MATERIAL_LABELS[key]}</span>
                <div aria-hidden="true">
                  <i
                    className={`recipe-dot recipe-dot--${key}`}
                    style={{
                      width: `${(color.recipe[key] / Math.max(1, pigmentTotal)) * 100}%`,
                    }}
                  />
                </div>
                <strong>{color.recipe[key]}単位</strong>
              </div>
            ))}
          {color.recipe.water > 0 && (
            <div>
              <span>水</span>
              <div aria-hidden="true">
                <i
                  className="recipe-dot recipe-dot--water"
                  style={{
                    width: `${color.mixed.waterRatio * 100}%`,
                  }}
                />
              </div>
              <strong>{color.recipe.water}単位</strong>
            </div>
          )}
        </div>

        {color.note && <p className="color-detail__note">{color.note}</p>}

        <div className="dialog-actions-grid">
          <button type="button" onClick={() => onUseInMixer(color)}>
            <Beaker size={17} aria-hidden="true" />
            混色材料にする
          </button>
          <button type="button" onClick={() => onReopen(color)}>
            <RotateCcw size={17} aria-hidden="true" />
            もう一度つくる
          </button>
          <button type="button" onClick={() => onDuplicate(color)}>
            <Copy size={17} aria-hidden="true" />
            複製
          </button>
          <button type="button" onClick={() => onUse(color, "draw")}>
            <Brush size={17} aria-hidden="true" />
            おえかきで使う
          </button>
          <button type="button" onClick={() => onUse(color, "color")}>
            <Palette size={17} aria-hidden="true" />
            ぬりえで使う
          </button>
        </div>
        <button
          className="danger-text-button"
          type="button"
          onClick={() => onDelete(color.id)}
        >
          <Trash2 size={16} aria-hidden="true" />
          この色を削除
        </button>
      </section>
    </div>
  );
}
