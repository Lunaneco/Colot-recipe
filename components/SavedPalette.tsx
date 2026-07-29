"use client";

import {
  Download,
  GripVertical,
  Palette,
  PanelRightClose,
  Redo2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SavedColor } from "../lib/types";

type SavedPaletteProps = {
  colors: SavedColor[];
  selectedId?: string;
  open: boolean;
  onClose: () => void;
  onSelect: (color: SavedColor) => void;
  onOpenDetails: (color: SavedColor) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
};

export function SavedPalette({
  colors,
  selectedId,
  open,
  onClose,
  onSelect,
  onOpenDetails,
  onReorder,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExport,
  onImport,
  onExportBackup,
  onImportBackup,
}: SavedPaletteProps) {
  const [draggedId, setDraggedId] = useState<string>();
  const [pointerDraggedId, setPointerDraggedId] = useState<string>();
  const [pointerTargetId, setPointerTargetId] = useState<string>();
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [detailsReadyId, setDetailsReadyId] = useState<string>();
  const [compactDrawer, setCompactDrawer] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const pointerSource = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
  } | undefined>(undefined);
  const pointerTarget = useRef<string | undefined>(undefined);
  const pointerDragActive = useRef(false);
  const longPressTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1020px)");
    const update = () => setCompactDrawer(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || !compactDrawer) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = asideRef.current;
    const focusableSelector =
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    window.requestAnimationFrame(() => {
      panel?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(focusableSelector)];
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
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [compactDrawer, open]);

  useEffect(
    () => () => {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  const clearPointerReorder = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
    pointerSource.current = undefined;
    pointerTarget.current = undefined;
    pointerDragActive.current = false;
    setPointerDraggedId(undefined);
    setPointerTargetId(undefined);
  };

  const reorderWithAnnouncement = (sourceId: string, targetId: string) => {
    const source = colors.find((color) => color.id === sourceId);
    const targetIndex = colors.findIndex((color) => color.id === targetId);
    if (!source || targetIndex < 0 || sourceId === targetId) return;
    onReorder(sourceId, targetId);
    setReorderAnnouncement(
      `${source.name}を${targetIndex + 1}番に移動しました`,
    );
  };

  const beginPointerReorder = (
    event: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    event.stopPropagation();
    pointerSource.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    const activate = () => {
      if (!pointerSource.current || pointerSource.current.id !== id) return;
      pointerDragActive.current = true;
      pointerTarget.current = id;
      setPointerDraggedId(id);
      setPointerTargetId(id);
      const source = colors.find((color) => color.id === id);
      setReorderAnnouncement(
        `${source?.name ?? "色"}を並べ替え中です。移動先までドラッグしてください`,
      );
    };
    if (event.pointerType === "mouse") activate();
    else longPressTimer.current = window.setTimeout(activate, 320);
  };

  const movePointerReorder = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const source = pointerSource.current;
    if (!source || source.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - source.x, event.clientY - source.y);
    if (!pointerDragActive.current) {
      if (moved > 12) clearPointerReorder();
      return;
    }
    event.preventDefault();
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("[data-color-id]") as HTMLElement | null;
    const targetId = target?.dataset.colorId;
    if (!targetId || targetId === pointerTarget.current) return;
    pointerTarget.current = targetId;
    setPointerTargetId(targetId);
  };

  const finishPointerReorder = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    const source = pointerSource.current;
    if (!source || source.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const targetId = pointerTarget.current;
    if (
      pointerDragActive.current &&
      targetId &&
      targetId !== source.id
    ) {
      reorderWithAnnouncement(source.id, targetId);
    } else if (pointerDragActive.current) {
      setReorderAnnouncement("並べ替えを終了しました");
    }
    clearPointerReorder();
  };

  return (
    <>
      <button
        className={`drawer-scrim ${open ? "is-open" : ""}`}
        type="button"
        aria-label="保存パレットを閉じる"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        id="saved-palette-panel"
        tabIndex={-1}
        className={`saved-palette ${open ? "is-open" : ""}`}
        role={compactDrawer && open ? "dialog" : undefined}
        aria-modal={compactDrawer && open ? "true" : undefined}
        aria-label="保存した色"
        data-testid="saved-palette"
      >
        <div className="saved-palette__header">
          <div>
            <p className="eyebrow">
              <Palette size={14} aria-hidden="true" /> わたしの色
            </p>
            <h2>
              保存パレット <span>{colors.length}</span>
            </h2>
          </div>
          <button
            className="icon-button palette-close"
            type="button"
            aria-label="保存パレットを閉じる"
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>

        <div className="palette-utility">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="保存パレットの操作を元に戻す"
            data-testid="palette-undo"
          >
            <Undo2 size={15} aria-hidden="true" />
            戻す
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="保存パレットの操作をやり直す"
            data-testid="palette-redo"
          >
            <Redo2 size={15} aria-hidden="true" />
            進む
          </button>
          <button type="button" onClick={onExport} disabled={!colors.length}>
            <Download size={15} aria-hidden="true" />
            レシピ保存
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            <Upload size={15} aria-hidden="true" />
            レシピ読込
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            tabIndex={-1}
            accept="application/json,.json"
            aria-label="カラーレシピJSONを読み込む"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImport(file);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" onClick={onExportBackup}>
            <Download size={15} aria-hidden="true" />
            全データ保存
          </button>
          <button
            type="button"
            onClick={() => backupFileInput.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            全データ復元
          </button>
          <input
            ref={backupFileInput}
            className="visually-hidden"
            type="file"
            tabIndex={-1}
            accept="application/json,.json"
            aria-label="カラーレシピの全データバックアップを復元する"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportBackup(file);
              event.currentTarget.value = "";
            }}
          />
        </div>

        {colors.length ? (
          <>
            <p id="palette-reorder-help" className="visually-hidden">
              色のボタンではAltキーと上下矢印、並べ替えハンドルでは上下矢印を使って順番を変更できます。
            </p>
            <div className="swatch-grid" role="list">
              {colors.map((color, index) => {
                const readyForDetails =
                  detailsReadyId === color.id && selectedId === color.id;
                return (
                  <div
                    className={`saved-swatch-wrap ${selectedId === color.id ? "is-selected" : ""} ${pointerDraggedId === color.id ? "is-pointer-dragged" : ""} ${pointerTargetId === color.id && pointerDraggedId !== color.id ? "is-drop-target" : ""}`}
                    key={color.id}
                    role="listitem"
                    data-color-id={color.id}
                    draggable={!compactDrawer}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", color.id);
                      setDraggedId(color.id);
                      setReorderAnnouncement(`${color.name}を並べ替え中です`);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedId && draggedId !== color.id) {
                        reorderWithAnnouncement(draggedId, color.id);
                      }
                      setDraggedId(undefined);
                    }}
                    onDragEnd={() => setDraggedId(undefined)}
                  >
                    <button
                      className="saved-swatch"
                      type="button"
                      aria-label={
                        readyForDetails
                          ? `${index + 1}番 ${color.name}。選択中。もう一度押すとレシピを見る`
                          : selectedId === color.id
                            ? `${index + 1}番 ${color.name}。選択中。この色を選び直す`
                            : `${index + 1}番 ${color.name}を選ぶ`
                      }
                      aria-pressed={selectedId === color.id}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      aria-describedby="palette-reorder-help"
                      title="Alt＋上下矢印で並べ替え"
                      onClick={() => {
                        if (readyForDetails) {
                          onOpenDetails(color);
                          return;
                        }
                        setDetailsReadyId(color.id);
                        onSelect(color);
                      }}
                      onKeyDown={(event) => {
                        if (!event.altKey) return;
                        if (event.key === "ArrowUp" && index > 0) {
                          event.preventDefault();
                          reorderWithAnnouncement(color.id, colors[index - 1].id);
                        }
                        if (event.key === "ArrowDown" && index < colors.length - 1) {
                          event.preventDefault();
                          reorderWithAnnouncement(color.id, colors[index + 1].id);
                        }
                      }}
                      data-testid={`saved-color-${index}`}
                    >
                      <span
                        className={`saved-swatch__paint ${color.capturedAppearance ? "is-captured" : ""}`}
                        style={{
                          "--swatch": color.mixed.hex,
                          "--swatch-opacity": color.capturedAppearance
                            ? color.mixed.opacity
                            : Math.max(0.48, color.mixed.opacity),
                        } as React.CSSProperties}
                      >
                        <span className="saved-swatch__number">{index + 1}</span>
                      </span>
                      <span className="saved-swatch__name">{color.name}</span>
                    </button>
                    {!compactDrawer && (
                      <button
                        className="swatch-grip"
                        type="button"
                        aria-label={`${color.name}を並べ替える`}
                        aria-describedby="palette-reorder-help"
                        aria-keyshortcuts="ArrowUp ArrowDown"
                        title="長押しまたはドラッグで並べ替え"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowUp" && index > 0) {
                            event.preventDefault();
                            reorderWithAnnouncement(
                              color.id,
                              colors[index - 1].id,
                            );
                          }
                          if (
                            event.key === "ArrowDown" &&
                            index < colors.length - 1
                          ) {
                            event.preventDefault();
                            reorderWithAnnouncement(
                              color.id,
                              colors[index + 1].id,
                            );
                          }
                        }}
                        onPointerDown={(event) =>
                          beginPointerReorder(event, color.id)
                        }
                        onPointerMove={movePointerReorder}
                        onPointerUp={finishPointerReorder}
                        onPointerCancel={clearPointerReorder}
                      >
                        <GripVertical size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="palette-empty">
            <span className="palette-empty__rings" aria-hidden="true" />
            <p>気に入った色を保存すると、ここに並びます。</p>
            <small>色をつくって ♡ を押してみましょう</small>
          </div>
        )}

        <div className="palette-tip">
          <PanelRightClose size={16} aria-hidden="true" />
          <span>1回で色を選択、同じ色をもう一度押すとレシピを確認できます</span>
        </div>
        <p className="visually-hidden" role="status" aria-live="polite">
          {reorderAnnouncement}
        </p>
      </aside>
    </>
  );
}
