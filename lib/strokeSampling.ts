export type StrokePoint = {
  x: number;
  y: number;
  time: number;
  pressure: number;
};

export type StrokeSamplerState = {
  /** The latest input point, whether or not it emitted a placement. */
  lastInput: StrokePoint;
  /** Fixed-distance placements. The first contact is always index zero. */
  placements: StrokePoint[];
  /** Physical distance travelled since the latest emitted placement. */
  carriedDistance: number;
};

export type StrokeSamplerOptions = {
  spacing: number;
  scaleX?: number;
  scaleY?: number;
  maxPoints?: number;
};

// A held origin can deposit up to eight units. 2,493 following/origin
// placements therefore fit the app's 2,500-unit persisted-recipe ceiling
// even at that maximum load (8 + 2,493 - 1 = 2,500).
export const MAX_MIXER_STROKE_POINTS = 2_493;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

function safePoint(point: StrokePoint): StrokePoint {
  return {
    x: finiteOr(point.x, 0),
    y: finiteOr(point.y, 0),
    time: Math.max(0, finiteOr(point.time, 0)),
    pressure: clamp(finiteOr(point.pressure, 0.5), 0, 1),
  };
}

function interpolatePoint(
  from: StrokePoint,
  to: StrokePoint,
  progress: number,
): StrokePoint {
  const amount = clamp(progress, 0, 1);
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    time: from.time + (to.time - from.time) * amount,
    pressure: from.pressure + (to.pressure - from.pressure) * amount,
  };
}

function physicalDistance(
  from: Pick<StrokePoint, "x" | "y">,
  to: Pick<StrokePoint, "x" | "y">,
  scaleX: number,
  scaleY: number,
) {
  return Math.hypot(
    (to.x - from.x) * scaleX,
    (to.y - from.y) * scaleY,
  );
}

function normaliseOptions(options: StrokeSamplerOptions) {
  return {
    spacing: Math.max(0.25, finiteOr(options.spacing, 1)),
    scaleX: Math.max(0.0001, finiteOr(options.scaleX ?? 1, 1)),
    scaleY: Math.max(0.0001, finiteOr(options.scaleY ?? 1, 1)),
    maxPoints: Math.max(
      1,
      Math.trunc(finiteOr(options.maxPoints ?? 4_096, 4_096)),
    ),
  };
}

export function beginStrokeSampling(origin: StrokePoint): StrokeSamplerState {
  const first = safePoint(origin);
  return {
    lastInput: first,
    placements: [first],
    carriedDistance: 0,
  };
}

/**
 * Converts arbitrarily dense or sparse input events into fixed-distance
 * placements. The result therefore depends on the physical path, not on a
 * browser or device's pointer-event frequency.
 */
export function appendStrokeSamples(
  state: StrokeSamplerState,
  input: readonly StrokePoint[],
  rawOptions: StrokeSamplerOptions,
) {
  const options = normaliseOptions(rawOptions);
  const placements = [...state.placements];
  const added: StrokePoint[] = [];
  let previous = safePoint(state.lastInput);
  let carriedDistance = clamp(
    finiteOr(state.carriedDistance, 0),
    0,
    options.spacing,
  );

  for (let inputIndex = 0; inputIndex < input.length; inputIndex += 1) {
    if (placements.length >= options.maxPoints) {
      return {
        state: {
          lastInput: previous,
          placements,
          carriedDistance,
        } satisfies StrokeSamplerState,
        added,
        remainingInput: input.slice(inputIndex).map(safePoint),
        limitReached: true,
      };
    }

    const rawPoint = input[inputIndex];
    const current = safePoint(rawPoint);
    const distance = physicalDistance(
      previous,
      current,
      options.scaleX,
      options.scaleY,
    );
    if (distance <= 1e-6) {
      previous = current;
      continue;
    }

    let emittedAt = -1;
    let nextDistance = Math.max(1e-6, options.spacing - carriedDistance);
    while (
      nextDistance <= distance + 1e-6 &&
      placements.length < options.maxPoints
    ) {
      const placement = interpolatePoint(
        previous,
        current,
        nextDistance / distance,
      );
      placements.push(placement);
      added.push(placement);
      emittedAt = nextDistance;
      nextDistance += options.spacing;
    }

    if (
      placements.length >= options.maxPoints &&
      emittedAt >= 0 &&
      emittedAt < distance - 1e-6
    ) {
      const lastPlacement = placements[placements.length - 1];
      return {
        state: {
          lastInput: lastPlacement,
          placements,
          carriedDistance: 0,
        } satisfies StrokeSamplerState,
        added,
        remainingInput: [
          current,
          ...input.slice(inputIndex + 1).map(safePoint),
        ],
        limitReached: true,
      };
    }

    carriedDistance =
      emittedAt >= 0
        ? Math.max(0, distance - emittedAt)
        : Math.min(options.spacing, carriedDistance + distance);
    previous = current;
  }

  return {
    state: {
      lastInput: previous,
      placements,
      carriedDistance,
    } satisfies StrokeSamplerState,
    added,
    remainingInput: [] as StrokePoint[],
    limitReached: false,
  };
}

/**
 * Adds the real pointer endpoint when the remaining tail is visibly long.
 * The same returned placements can drive both preview and committed paint.
 */
export function finishStrokeSampling(
  state: StrokeSamplerState,
  endpoint: StrokePoint,
  rawOptions: StrokeSamplerOptions,
  tailThreshold = 0.35,
) {
  const options = normaliseOptions(rawOptions);
  const appended = appendStrokeSamples(state, [endpoint], options);
  const placements = [...appended.state.placements];
  const added = [...appended.added];
  const lastPlacement = placements[placements.length - 1];
  const tail = physicalDistance(
    lastPlacement,
    appended.state.lastInput,
    options.scaleX,
    options.scaleY,
  );

  if (
    placements.length < options.maxPoints &&
    tail >= options.spacing * clamp(tailThreshold, 0, 1)
  ) {
    const finalPoint = safePoint(appended.state.lastInput);
    placements.push(finalPoint);
    added.push(finalPoint);
    return {
      state: {
        lastInput: finalPoint,
        placements,
        carriedDistance: 0,
      } satisfies StrokeSamplerState,
      added,
    };
  }

  return appended;
}

/**
 * A time-based stabilizer keeps the same response at 60 Hz and 120 Hz. Fast
 * motion receives more follow-through so the brush does not visibly trail the
 * pointer; the first contact is never passed through this function.
 */
export function stabilizeStrokePoint(
  previous: StrokePoint,
  currentInput: StrokePoint,
  stabilization: number,
  scaleX = 1,
  scaleY = 1,
): StrokePoint {
  const current = safePoint(currentInput);
  const amount = clamp(finiteOr(stabilization, 0), 0, 0.98);
  if (amount <= 0) return current;

  const deltaTime = Math.max(1, current.time - previous.time);
  const distance = physicalDistance(previous, current, scaleX, scaleY);
  const speed = distance / deltaTime;
  const timeConstant = 2 + amount * 18;
  // Speed changes the filter's time constant instead of adding a per-event
  // follow amount. Exponential response remains comparable at 60 Hz, 120 Hz,
  // and the much denser raw sample streams produced by modern pens.
  const speedBoost =
    1 + clamp(speed / 2.4, 0, 1) * amount * 8;
  const follow = clamp(
    1 - Math.exp(-deltaTime / (timeConstant / speedBoost)),
    0,
    1,
  );
  const point = interpolatePoint(previous, current, follow);
  return {
    ...point,
    time: current.time,
    pressure: current.pressure,
  };
}

export function strokeVelocity(
  from: StrokePoint,
  to: StrokePoint,
  scaleX = 1,
  scaleY = 1,
) {
  return (
    physicalDistance(from, to, scaleX, scaleY) /
    Math.max(1, to.time - from.time)
  );
}
