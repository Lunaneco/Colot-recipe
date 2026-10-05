/** One drying clock for live paint, persisted paint and restored history. */
import { dryPigmentField, wetBounds, type PigmentField } from "./pigmentField";
import type { PixelBounds } from "./paintEngine";

export const PAINT_DRYING_INTERVAL_MS = 280;
/** Body paint at wetness 0.55 dries in about twelve seconds. */
const DRYING_RATE_PER_MS = 0.012 / PAINT_DRYING_INTERVAL_MS;

/** Advance by wall-clock time, including a throttled tab or an app restart. */
export function advancePaintDrying(
  field: PigmentField,
  previousTime: number,
  now = Date.now(),
  bounds?: PixelBounds,
): PixelBounds | null {
  const elapsed = Number.isFinite(previousTime) && previousTime >= 0 && Number.isFinite(now)
    ? Math.max(0, now - previousTime)
    : 0;
  if (elapsed <= 0) return wetBounds(field, bounds);
  return dryPigmentField(field, elapsed * DRYING_RATE_PER_MS, bounds);
}

/** Missing timestamps in older documents resume from their stored water. */
export function resumeStoredPaint(
  field: PigmentField,
  savedAt: number | undefined,
  now = Date.now(),
): PixelBounds | null {
  return advancePaintDrying(field, savedAt ?? now, now);
}
