/**
 * Brush behaviour on top of the pigment field: pressure and speed dynamics,
 * entry taper, finite paint load, bristle streaks, dirty-brush pick-up and
 * per-tool stamp shapes. DOM-free.
 */

import {
  createBrushReservoir,
  createStrokeFilm,
  depositStamp,
  eraseStamp,
  liftStamp,
  massForCoverage,
  pickUpIntoReservoir,
  shadowBeforeWrite,
  smoothStamp,
  stampBounds,
  type BrushReservoir,
  type PigmentField,
  type SettleOptions,
  type StampShape,
  type StrokeFilm,
  type StrokeShadow,
} from "./pigmentField";
import type { PixelBounds } from "./paintEngine";
import type { StrokePoint } from "./strokeSampling";
import type { BrushTool, ExactPaint } from "./types";

export interface BrushDynamicsSettings {
  /** Brush diameter in canvas pixels. */
  size: number;
  /** 0..1 */
  opacity: number;
  /** 0..1 */
  pressureSensitivity: number;
  /** Added water 0..1 */
  water: number;
  /** 0..1 */
  bleed: number;
  /** 0..1 */
  hardness: number;
  /** Stamp spacing as a fraction of the diameter. */
  spacing: number;
}

export interface PaintLoad {
  /** Normalised pigment vector (PIGMENT_IDS order). */
  pigment: Float32Array;
  /** Water share of the loaded paint 0..1. */
  waterRatio: number;
  /** Coverage of one body-paint layer of this colour, 0..1. */
  opacity: number;
  /** Exact deposited thickness from a sampled paint pixel. */
  opticalMass?: number;
  /** Bottom-to-top optical layers retained by a sampled paint pixel. */
  opticalStack?: ExactPaint["opticalStack"];
}

interface ToolProfile {
  radiusScale: number;
  /** Mass at full pressure before colour opacity/water scaling. */
  massBase: number;
  /**
   * Body of the deposit 0..1: paint film that stands up from the surface
   * (relief) versus graphite, ink or mist that sits flat in the paper.
   */
  body: number;
  /** Pressure changes mass by this much (0 = constant, 1 = fully). */
  pressureMass: number;
  /** Baseline water content added by the tool itself. */
  wetness: number;
  /**
   * Freshness of the paint the tool leaves behind (0..1): body paint stays
   * wet and workable for a while; dry media and inks set at once.
   */
  fresh: number;
  hardness: number | "setting";
  shape: "disc" | "flat" | "chisel";
  /** Nominal stroke length in diameters held by a fresh, finite load. */
  capacity: number;
  pickup: number;
  lift: number;
  taper: number;
  spacingScale: number;
  wetMixing: number;
  grain?: { strength: number; fill: number | "pressure" };
  bristles: number;
  speedThinning: number;
}

const PROFILES: Record<BrushTool, ToolProfile> = {
  round: {
    radiusScale: 1,
    massBase: 1,
    body: 1,
    pressureMass: 0.55,
    wetness: 0,
    fresh: 0.55,
    hardness: "setting",
    shape: "disc",
    capacity: 40,
    pickup: 0.06,
    lift: 0,
    taper: 1.1,
    spacingScale: 1,
    wetMixing: 0.38,
    // A light touch skips over the paper tooth; pressure fills it.
    grain: { strength: 0.3, fill: "pressure" },
    bristles: 0.14,
    speedThinning: 0.28,
  },
  flat: {
    radiusScale: 1.05,
    massBase: 1,
    body: 1,
    pressureMass: 0.5,
    wetness: 0,
    fresh: 0.55,
    hardness: "setting",
    shape: "flat",
    capacity: 30,
    pickup: 0.08,
    lift: 0,
    taper: 0.8,
    spacingScale: 0.55,
    wetMixing: 0.38,
    grain: { strength: 0.3, fill: "pressure" },
    bristles: 0.35,
    speedThinning: 0.25,
  },
  pencil: {
    radiusScale: 0.16,
    massBase: 0.9,
    body: 0,
    pressureMass: 0.75,
    wetness: 0,
    fresh: 0,
    hardness: 0.92,
    shape: "disc",
    capacity: 800,
    pickup: 0,
    lift: 0,
    taper: 0.3,
    spacingScale: 0.5,
    wetMixing: 0.1,
    grain: { strength: 0.85, fill: "pressure" },
    bristles: 0,
    speedThinning: 0.35,
  },
  watercolor: {
    radiusScale: 1.35,
    massBase: 0.34,
    body: 0.12,
    pressureMass: 0.5,
    wetness: 0.7,
    fresh: 0.7,
    // A wash has a defined boundary (the puddle's edge); its softness comes
    // from diffusion when it settles, not from a feathered stamp.
    hardness: 0.78,
    shape: "disc",
    capacity: 55,
    pickup: 0.1,
    lift: 0,
    // A loaded wash brush lands round; only a short taper.
    taper: 0.35,
    spacingScale: 0.7,
    wetMixing: 0.62,
    grain: { strength: 0.22, fill: 0.85 },
    bristles: 0,
    speedThinning: 0.35,
  },
  airbrush: {
    radiusScale: 1.65,
    massBase: 0.08,
    body: 0.05,
    pressureMass: 0.7,
    wetness: 0.05,
    fresh: 0,
    hardness: 0.04,
    shape: "disc",
    capacity: 240,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 0.5,
    wetMixing: 0.1,
    bristles: 0,
    speedThinning: 0.45,
  },
  marker: {
    radiusScale: 1.2,
    massBase: 0.32,
    body: 0.1,
    pressureMass: 0.15,
    wetness: 0.15,
    fresh: 0,
    hardness: 0.88,
    shape: "chisel",
    capacity: 600,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 0.5,
    wetMixing: 0.2,
    bristles: 0,
    speedThinning: 0.1,
  },
  mixer: {
    radiusScale: 1,
    massBase: 0.85,
    body: 1,
    pressureMass: 0.4,
    wetness: 0.3,
    fresh: 0.55,
    hardness: 0.6,
    shape: "disc",
    capacity: 0,
    pickup: 0.5,
    lift: 1,
    taper: 0,
    spacingScale: 0.5,
    wetMixing: 0.7,
    // A smear shows the bristles that dragged it.
    bristles: 0.3,
    speedThinning: 0.2,
  },
  eraser: {
    radiusScale: 1,
    massBase: 0,
    body: 0,
    pressureMass: 0,
    wetness: 0,
    fresh: 0,
    hardness: "setting",
    shape: "disc",
    capacity: 0,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 1,
    wetMixing: 0,
    bristles: 0,
    speedThinning: 0,
  },
  blur: {
    radiusScale: 1.1,
    massBase: 0,
    body: 0,
    pressureMass: 0,
    wetness: 0,
    fresh: 0,
    hardness: 0.2,
    shape: "disc",
    capacity: 0,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 0.7,
    wetMixing: 0,
    bristles: 0,
    speedThinning: 0,
  },
  eyedropper: {
    radiusScale: 1,
    massBase: 0,
    body: 0,
    pressureMass: 0,
    wetness: 0,
    fresh: 0,
    hardness: 1,
    shape: "disc",
    capacity: 0,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 1,
    wetMixing: 0,
    bristles: 0,
    speedThinning: 0,
  },
  fill: {
    radiusScale: 1,
    massBase: 0,
    body: 1,
    pressureMass: 0,
    wetness: 0,
    fresh: 0.5,
    hardness: 1,
    shape: "disc",
    capacity: 0,
    pickup: 0,
    lift: 0,
    taper: 0,
    spacingScale: 1,
    wetMixing: 0,
    bristles: 0,
    speedThinning: 0,
  },
};

const MINIMUM_PRESSURE = 0.14;
const MARKER_ANGLE = 0.72;
/** Carried mass density at the nominal brush size, fixed at stroke start. */
const MIXER_LOAD_LIMIT = 3;
/** Share of the carried paint a mixer lays down per footprint of travel. */
const MIXER_RELEASE = 1;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
const clampUnit = (value: number) => clamp(value, 0, 1);
const smoothstep = (t: number) => {
  const x = clampUnit(t);
  return x * x * (3 - 2 * x);
};

/** Small deterministic PRNG so a stroke's bristle pattern is reproducible. */
export function seededRandom(seed: number) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bristleProfile(count: number, seed: number): Float32Array {
  const random = seededRandom(seed);
  const profile = new Float32Array(Math.max(2, count));
  for (let index = 0; index < profile.length; index += 1) {
    profile[index] = 0.5 + random() * 0.5;
  }
  // Edges of a flat brush carry a little less paint.
  profile[0] *= 0.8;
  profile[profile.length - 1] *= 0.8;
  return profile;
}

export interface StrokeDynamicsState {
  tool: BrushTool;
  reservoir: BrushReservoir;
  /** Absolute mass capacity, fixed when loaded; pressure never creates paint. */
  reservoirCapacity: number;
  opticalStack?: ExactPaint["opticalStack"];
  travelled: number;
  previous?: StrokePoint;
  /** Unit direction of travel, smoothed. */
  directionX: number;
  directionY: number;
  /** Smoothed speed in px/ms. */
  speed: number;
  bristles: Float32Array;
  /** Mass a full-pressure stamp of the loaded colour deposits. */
  fullMass: number;
  /** Water content of the loaded paint. */
  paintWetness: number;
  /**
   * Wetness the deposit is left with: water content, or the freshness of
   * body paint straight off the brush, which stays workable until it dries.
   */
  depositWetness: number;
  /** Radius of the most recent stamp (drives adaptive spacing). */
  lastRadius: number;
  /** Number of stamps placed so far. */
  stamps: number;
  /** Time (ms) of the first touch; the entry taper settles with dwell. */
  startTime: number;
  /**
   * Coverage this stroke has laid down so far; created on the first stamp.
   * Paint and erasing go through it so overlapping stamps never pile up.
   */
  film?: StrokeFilm;
}

const pressureResponse = (pressure: number) =>
  MINIMUM_PRESSURE + (1 - MINIMUM_PRESSURE) * clampUnit(pressure) ** 1.35;

const spacingContinuity = (settings: BrushDynamicsSettings) => {
  const wet = clampUnit(settings.water);
  return clamp(1 - wet * 0.3 - clampUnit(settings.bleed) * 0.2, 0.3, 1);
};

/** Stamp spacing in canvas pixels for a tool at nominal pressure. */
export function strokeSpacing(tool: BrushTool, settings: BrushDynamicsSettings) {
  const profile = PROFILES[tool];
  const diameter = Math.max(1, settings.size) * profile.radiusScale;
  return Math.max(
    0.5,
    diameter *
      clamp(settings.spacing, 0.01, 2) *
      profile.spacingScale *
      spacingContinuity(settings),
  );
}

/**
 * Stamp spacing that follows the stamp actually being placed, so a light
 * (small) touch does not fall apart into separate dots.
 */
export function spacingForRadius(
  tool: BrushTool,
  settings: BrushDynamicsSettings,
  radius: number,
) {
  const profile = PROFILES[tool];
  return Math.max(
    0.5,
    Math.min(
      strokeSpacing(tool, settings),
      radius *
        2 *
        clamp(settings.spacing, 0.01, 2) *
        profile.spacingScale *
        spacingContinuity(settings),
    ),
  );
}

/** Spacing to use for the next placement of a stroke in progress. */
export function nextSpacing(
  state: StrokeDynamicsState,
  settings: BrushDynamicsSettings,
) {
  return state.lastRadius > 0
    ? spacingForRadius(state.tool, settings, state.lastRadius)
    : strokeSpacing(state.tool, settings);
}

export function beginStrokeDynamics(
  tool: BrushTool,
  settings: BrushDynamicsSettings,
  paint: PaintLoad,
  seed = Date.now(),
): StrokeDynamicsState {
  const profile = PROFILES[tool];
  const exactOptical = paint.opticalStack && paint.opticalStack.length > 0;
  const paintWetness = clampUnit(
    Math.max(settings.water, paint.waterRatio, profile.wetness),
  );
  // One body-paint layer of the colour reproduces the palette's coverage;
  // added water thins the deposit like it thins the palette mix.
  const bodyMass = exactOptical ? Math.max(0, paint.opticalMass ??
    paint.opticalStack!.reduce((total, layer) => total + layer.mass, 0)) : clamp(
    massForCoverage(clamp(paint.opacity, 0.02, 0.995), paint.pigment),
    0.04,
    1.4,
  );
  const dilution = 1 - clampUnit(Math.max(settings.water, paint.waterRatio)) * 0.55;
  const fullMass = exactOptical ? bodyMass :
    profile.massBase * bodyMass * dilution * clampUnit(settings.opacity);
  // Fresh body paint is wet (workable, glossy, mixes with the next stroke)
  // even without added water; it dries over the following seconds.
  const depositWetness = exactOptical ? 0 : clampUnit(Math.max(paintWetness, profile.fresh));
  const nominalDiameter = Math.max(1, settings.size) * profile.radiusScale;
  const reservoirCapacity = tool === "mixer"
    ? Math.PI * (nominalDiameter / 2) ** 2 * MIXER_LOAD_LIMIT
    : fullMass * nominalDiameter ** 2 * profile.capacity * 0.5;
  const reservoir = createBrushReservoir(paint.pigment, 0, depositWetness, exactOptical ? 0 : profile.body);
  // `load` is total mass, rather than thickness averaged over the current
  // stamp. A changing radius therefore only changes where paint is released.
  reservoir.load = tool === "mixer" ? 0 : Math.max(0, reservoirCapacity);
  return {
    tool,
    reservoir,
    reservoirCapacity,
    opticalStack: exactOptical ? paint.opticalStack : undefined,
    travelled: 0,
    previous: undefined,
    directionX: 1,
    directionY: 0,
    speed: 0,
    bristles: bristleProfile(tool === "flat" ? 16 : 10, seed),
    fullMass,
    paintWetness,
    depositWetness,
    lastRadius: 0,
    stamps: 0,
    startTime: 0,
  };
}

export interface StampPlan {
  radius: number;
  /**
   * Mass of the paint film this stamp lays down at full coverage. Deposits
   * go through the stroke film, so overlapping stamps add nothing where the
   * stroke has already covered the paper.
   */
  mass: number;
  /**
   * Share of a footprint the brush advanced by since the previous stamp
   * (0..1); scales the per-stamp pick-up, lift and smoothing.
   */
  flow: number;
  wetness: number;
  hardness: number;
  shape: StampShape;
  bristleStrength: number;
  grain?: { strength: number; fill: number };
  pickup: number;
  lift: number;
  erase: number;
  smooth: number;
  wetMixing: number;
}

/**
 * Advances the stroke to `point` and returns what the stamp there should do.
 * Pressure sets size and deposit, speed thins the line, the entry tapers,
 * and the paint load runs down along the stroke.
 */
export interface StampOverrides {
  /** Share of a footprint to deposit instead of the distance-based flow. */
  flow?: number;
  /** Treat the brush as fully set down (no entry taper). */
  settled?: boolean;
}

/** Dwell time after which a resting brush has fully spread on the paper. */
const SETTLE_MS = 90;
/** Footprint share at the very first touch, before the bristles spread. */
const ENTRY_TAPER = 0.45;

export function planStamp(
  state: StrokeDynamicsState,
  point: StrokePoint,
  settings: BrushDynamicsSettings,
  overrides: StampOverrides = {},
): StampPlan {
  const profile = PROFILES[state.tool];
  const response = pressureResponse(point.pressure);
  const sensitivity = clampUnit(settings.pressureSensitivity);
  const pressureScale = 1 + sensitivity * (response - 1);
  const firstStamp = !state.previous;
  if (firstStamp) state.startTime = point.time;

  let step = 0;
  if (state.previous) {
    const dx = point.x - state.previous.x;
    const dy = point.y - state.previous.y;
    step = Math.hypot(dx, dy);
    if (step > 1e-6) {
      const follow = clamp(step / Math.max(4, settings.size * 0.5), 0.15, 1);
      const nx = state.directionX + (dx / step - state.directionX) * follow;
      const ny = state.directionY + (dy / step - state.directionY) * follow;
      const length = Math.hypot(nx, ny) || 1;
      state.directionX = nx / length;
      state.directionY = ny / length;
    }
    const deltaTime = Math.max(1, point.time - state.previous.time);
    const instantSpeed = step / deltaTime;
    state.speed += (instantSpeed - state.speed) * 0.35;
  }
  state.previous = point;
  state.travelled += step;

  const diameter = Math.max(1, settings.size) * profile.radiusScale;
  const speedFactor = clampUnit(state.speed / 5);
  // Entry taper: the bristles spread as the brush is set down, whether it
  // travels (distance) or rests on the spot (dwell time). A brush that is
  // pressed and lifted in place leaves a full footprint.
  const taperLength = diameter * profile.taper;
  const settle = Math.max(
    taperLength > 0 ? state.travelled / taperLength : 1,
    (point.time - state.startTime) / SETTLE_MS,
  );
  const taper = overrides.settled
    ? 1
    : ENTRY_TAPER + (1 - ENTRY_TAPER) * smoothstep(settle);
  const softness =
    profile.hardness === "setting" ? 1 - clampUnit(settings.hardness) : 1 - profile.hardness;
  const spread = 1 + clampUnit(settings.bleed) * 0.3 + softness * 0.08;
  const radius = Math.max(
    0.35,
    (diameter / 2) *
      pressureScale *
      spread *
      taper *
      (1 - 0.12 * speedFactor * profile.speedThinning * 2),
  );

  // Only a successful transfer to the surface consumes paint. Planning,
  // moving over an existing stroke film and travelling outside the page do
  // not silently discard the brush's supply.
  const load = state.reservoirCapacity > 0
    ? clampUnit(state.reservoir.load / state.reservoirCapacity)
    : 0;
  // A well-loaded brush lays down paint evenly; the deposit only thins once
  // the load runs low, and the last of it comes off as dry, streaky paint.
  const loadFactor =
    state.tool === "mixer" ? load : clampUnit(load / 0.45) ** 0.7;
  const dryness = clampUnit((0.4 - load) / 0.4) * (1 - state.paintWetness);

  const pressureDeposit = state.opticalStack ? 1 : 1 - profile.pressureMass * (1 - response);
  const thinning = state.opticalStack ? 1 : 1 - profile.speedThinning * speedFactor;
  const footprintMass = state.fullMass * pressureDeposit * thinning * loadFactor;

  const travelAngle = Math.atan2(state.directionY, state.directionX);
  let shape: StampShape = { kind: "disc", angle: travelAngle };
  let alongTravel = radius * 2;
  if (profile.shape === "flat") {
    shape = { kind: "rect", angle: travelAngle, aspect: 0.45 };
    alongTravel = radius * 2 * 0.45;
  } else if (profile.shape === "chisel") {
    shape = { kind: "rect", angle: MARKER_ANGLE, aspect: 0.6 };
    alongTravel = radius * 2 * 0.6;
  }

  // Share of a footprint the brush advanced by since the last stamp. The
  // stroke film keeps deposits spacing-independent; this only scales the
  // per-stamp pick-up, lift and smoothing so they do not depend on spacing.
  const flow =
    overrides.flow !== undefined
      ? clampUnit(overrides.flow)
      : firstStamp
        ? 0.5
        : clamp(step / Math.max(0.5, alongTravel), 0, 1);
  const mass = footprintMass;
  state.lastRadius = radius;
  state.stamps += 1;

  const hardness =
    profile.hardness === "setting"
      ? clamp(settings.hardness * (1 - state.paintWetness * 0.35), 0.02, 0.98)
      : profile.hardness;

  const grain = profile.grain
    ? {
        strength: profile.grain.strength,
        fill:
          profile.grain.fill === "pressure"
            ? 0.3 + 0.7 * response
            : profile.grain.fill,
      }
    : undefined;

  const bristleStrength = state.opticalStack ? 0 : clampUnit(profile.bristles + dryness * 0.75);

  return {
    radius,
    mass,
    flow,
    wetness: clampUnit(
      state.tool === "mixer" ? state.reservoir.wetness : state.depositWetness,
    ),
    hardness,
    shape,
    bristleStrength,
    grain: state.opticalStack ? undefined : grain,
    pickup: state.opticalStack ? 0 : profile.pickup,
    lift: profile.lift * (firstStamp ? 0.5 : Math.min(1, flow * 2)),
    // One pass of the eraser removes this share once (via the stroke film).
    erase: state.tool === "eraser" ? clampUnit(settings.opacity) * response : 0,
    smooth: state.tool === "blur" ? 0.45 * response * Math.min(1, flow * 2) : 0,
    wetMixing: profile.wetMixing,
  };
}

/**
 * Applies one stamp of the current stroke to the field. Returns the dirty
 * bounds, or null when nothing changed. When a `shadow` is given, the pixels
 * about to change are recorded first so the stroke can be undone.
 */
export function applyStamp(
  field: PigmentField,
  state: StrokeDynamicsState,
  point: StrokePoint,
  settings: BrushDynamicsSettings,
  shadow?: StrokeShadow,
  overrides?: StampOverrides,
): PixelBounds | null {
  const plan = planStamp(state, point, settings, overrides);
  if (shadow) {
    const footprint = stampBounds(field, point.x, point.y, plan.radius);
    if (footprint) shadowBeforeWrite(shadow, footprint);
  }
  if (
    !state.film ||
    state.film.width !== field.width ||
    state.film.height !== field.height
  ) {
    state.film = createStrokeFilm(field);
  }
  if (plan.erase > 0) {
    return eraseStamp(
      field,
      point.x,
      point.y,
      plan.radius,
      plan.hardness,
      plan.erase,
      state.film,
    );
  }
  if (plan.smooth > 0) {
    return smoothStamp(field, point.x, point.y, plan.radius, plan.smooth);
  }

  let bounds: PixelBounds | null = null;
  const pickupShare = plan.lift > 0
    ? plan.lift
    : plan.pickup * Math.min(1, plan.flow * 2);
  if (pickupShare > 0) {
    // Ordinary brushes become dirty by removing real paint too. Reading a
    // colour without lifting its mass would copy the underlying pigment.
    const lifted = liftStamp(
      field,
      point.x,
      point.y,
      plan.radius,
      plan.hardness,
      pickupShare,
      Math.max(0, state.reservoirCapacity - state.reservoir.load),
    );
    bounds = lifted.bounds;
    const liftedMass = lifted.totalMass ?? 0;
    if (liftedMass > 0) {
      pickUpIntoReservoir(
        state.reservoir,
        lifted,
        liftedMass,
        state.reservoirCapacity,
      );
    }
  }

  // A mixer releases a share of the paint it carries per footprint of
  // travel, so a smear fades out over one to two brush widths. It smears
  // additively (no film): dragging back over a smear thickens it.
  const mixer = state.tool === "mixer";
  const footprintArea = Math.max(1, Math.PI * plan.radius ** 2);
  const mass = mixer
    ? state.reservoir.load / footprintArea * plan.flow * MIXER_RELEASE
    : plan.mass;
  if (mass <= 0 || state.reservoir.load <= 0) return bounds;
  let depositedMass = 0;
  const deposited = depositStamp(field, point.x, point.y, plan.radius, {
    pigment: state.reservoir.pigment,
    mass,
    wetness: state.reservoir.wetness,
    body: state.reservoir.body,
    hardness: plan.hardness,
    shape: plan.shape,
    bristles: plan.bristleStrength > 0 ? state.bristles : undefined,
    bristleStrength: plan.bristleStrength,
    grain: plan.grain,
    wetMixing: plan.wetMixing,
    film: mixer ? undefined : state.film,
    massBudget: state.reservoir.load,
    onDeposit: (actualMass) => { depositedMass = actualMass; },
    opticalStack: state.opticalStack,
  });
  // Charge all tools for the exact sum placed across the footprint, including
  // grain, edge falloff and the part the stroke film has already reached.
  state.reservoir.load = Math.max(0, state.reservoir.load - depositedMass);
  if (!deposited) return bounds;
  if (!bounds) return deposited;
  const x = Math.min(bounds.x, deposited.x);
  const y = Math.min(bounds.y, deposited.y);
  return {
    x,
    y,
    width: Math.max(bounds.x + bounds.width, deposited.x + deposited.width) - x,
    height: Math.max(bounds.y + bounds.height, deposited.y + deposited.height) - y,
  };
}

/**
 * Finishes a stroke that never left its starting footprint. The stamps so
 * far were placed at the entry-taper size, so a plain dab completes itself
 * to the brush's full footprint (the stroke film fills only the outer ring).
 */
export function completeTap(
  field: PigmentField,
  state: StrokeDynamicsState,
  point: StrokePoint,
  settings: BrushDynamicsSettings,
  shadow?: StrokeShadow,
): PixelBounds | null {
  if (state.stamps === 0) return null;
  if (state.travelled >= Math.max(1, state.lastRadius * 0.75)) return null;
  return applyStamp(field, state, point, settings, shadow, {
    flow: 0.5,
    settled: true,
  });
}

/**
 * Watercolour settling parameters for a finished stroke. Pass the stroke's
 * dynamics so only the paint it wetted settles.
 */
export function wetSettleOptions(
  tool: BrushTool,
  settings: BrushDynamicsSettings,
  state?: StrokeDynamicsState,
): SettleOptions | null {
  if (tool !== "watercolor") return null;
  const water = clampUnit(settings.water);
  const bleed = clampUnit(settings.bleed);
  const width = Math.max(1, settings.size) * PROFILES.watercolor.radiusScale;
  return {
    diffusion: Math.max(1, settings.size * (0.06 + bleed * 0.16 + water * 0.06)),
    edgeStrength: 0.45 + water * 0.4,
    // The drying rim is a band roughly a seventh of the wash width.
    edgeWidth: Math.max(3, width * 0.14),
    granulation: 0.55,
    film: state?.film,
  };
}
