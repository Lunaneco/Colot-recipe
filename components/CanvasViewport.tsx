"use client";

import {
  Hand,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

export const MIN_CANVAS_ZOOM = 50;
export const MAX_CANVAS_ZOOM = 300;
export const CANVAS_ZOOM_STEP = 25;

type CanvasZoomControlsProps = {
  label: string;
  zoom: number;
  panEnabled: boolean;
  onZoomChange: (zoom: number) => void;
  onPanEnabledChange: (enabled: boolean) => void;
};

export function CanvasZoomControls({
  label,
  zoom,
  panEnabled,
  onZoomChange,
  onPanEnabledChange,
}: CanvasZoomControlsProps) {
  return (
    <div
      className="canvas-zoom-controls"
      role="group"
      aria-label={`${label}の拡大縮小`}
    >
      <button
        type="button"
        aria-label={`${label}を縮小`}
        disabled={zoom <= MIN_CANVAS_ZOOM}
        onClick={() =>
          onZoomChange(Math.max(MIN_CANVAS_ZOOM, zoom - CANVAS_ZOOM_STEP))
        }
      >
        <ZoomOut size={18} aria-hidden="true" />
      </button>
      <output aria-label={`${label}の表示倍率`} aria-live="polite">
        {zoom}%
      </output>
      <button
        type="button"
        aria-label={`${label}を拡大`}
        disabled={zoom >= MAX_CANVAS_ZOOM}
        onClick={() =>
          onZoomChange(Math.min(MAX_CANVAS_ZOOM, zoom + CANVAS_ZOOM_STEP))
        }
      >
        <ZoomIn size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={`${label}を全体表示に戻す`}
        disabled={zoom === 100}
        onClick={() => onZoomChange(100)}
      >
        <RotateCcw size={17} aria-hidden="true" />
        <span>全体表示</span>
      </button>
      <button
        type="button"
        className={panEnabled ? "is-selected" : ""}
        aria-label={`${label}を移動`}
        aria-pressed={panEnabled}
        disabled={zoom <= 100}
        onClick={() => onPanEnabledChange(!panEnabled)}
      >
        <Hand size={17} aria-hidden="true" />
        <span>移動</span>
      </button>
    </div>
  );
}

type CanvasViewportOptions = {
  intrinsicWidth: number;
  intrinsicHeight: number;
  zoom: number;
};

export function useCanvasViewport({
  intrinsicWidth,
  intrinsicHeight,
  zoom,
}: CanvasViewportOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState<number>();

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const availableWidth = Math.max(1, viewport.clientWidth);
      const availableHeight = Math.max(1, viewport.clientHeight);
      const nextScale = Math.min(
        availableWidth / Math.max(1, intrinsicWidth),
        availableHeight / Math.max(1, intrinsicHeight),
      );
      setFitScale((current) =>
        current !== undefined && Math.abs(current - nextScale) < 0.001
          ? current
          : nextScale,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [intrinsicHeight, intrinsicWidth]);

  const stageStyle = useMemo<CSSProperties>(() => {
    if (fitScale === undefined) {
      return {
        width: "100%",
        aspectRatio: `${intrinsicWidth} / ${intrinsicHeight}`,
      };
    }
    const displayScale = fitScale * (zoom / 100);
    return {
      width: `${Math.max(1, intrinsicWidth * displayScale)}px`,
      height: `${Math.max(1, intrinsicHeight * displayScale)}px`,
    };
  }, [fitScale, intrinsicHeight, intrinsicWidth, zoom]);

  const changeZoomAroundCenter = useCallback(
    (nextZoom: number, apply: (zoom: number) => void) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        apply(nextZoom);
        return;
      }
      const centerX =
        (viewport.scrollLeft + viewport.clientWidth / 2) /
        Math.max(1, viewport.scrollWidth);
      const centerY =
        (viewport.scrollTop + viewport.clientHeight / 2) /
        Math.max(1, viewport.scrollHeight);
      apply(nextZoom);
      window.requestAnimationFrame(() => {
        viewport.scrollLeft =
          centerX * viewport.scrollWidth - viewport.clientWidth / 2;
        viewport.scrollTop =
          centerY * viewport.scrollHeight - viewport.clientHeight / 2;
      });
    },
    [],
  );

  return {
    viewportRef,
    stageStyle,
    changeZoomAroundCenter,
  };
}

type CanvasPanHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function useCanvasPan(
  viewportRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): { handlers: CanvasPanHandlers; isPanning: boolean } {
  const drag = useRef<
    | {
        pointerId: number;
        clientX: number;
        clientY: number;
        scrollLeft: number;
        scrollTop: number;
      }
    | undefined
  >(undefined);
  const [isPanning, setIsPanning] = useState(false);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (
        !enabled ||
        !viewport ||
        !event.isPrimary ||
        event.button !== 0 ||
        drag.current
      ) {
        return;
      }
      event.preventDefault();
      viewport.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      setIsPanning(true);
    },
    [enabled, viewportRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      const current = drag.current;
      if (
        !enabled ||
        !viewport ||
        !current ||
        current.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      viewport.scrollLeft =
        current.scrollLeft - (event.clientX - current.clientX);
      viewport.scrollTop =
        current.scrollTop - (event.clientY - current.clientY);
    },
    [enabled, viewportRef],
  );

  const finishPan = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!drag.current || drag.current.pointerId !== event.pointerId) return;
      if (viewport?.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      drag.current = undefined;
      setIsPanning(false);
    },
    [viewportRef],
  );

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPan,
      onPointerCancel: finishPan,
    },
    isPanning: enabled && isPanning,
  };
}
