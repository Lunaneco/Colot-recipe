import {
  compositeSpectralFilm,
  compositePigmentOpticsRgb,
  displayLinearColor,
  decodeSrgbByte,
  encodeSrgbByte,
  mixPigmentFilm,
  preparePigmentOptics,
  filmFromPigmentOptics,
  type PigmentOptics,
  type LinearRGBColor,
  type RGBColor,
  type SpectralPaintFilm,
  type SpectralSurface,
} from "./colorScience";
import { PIGMENT_IDS } from "./types";

// Relative to the measured K/S curves. One body-paint unit is an optically
// thick film; fractional deposits retain wavelength-dependent transmission.
export const OPTICAL_DEPTH_PER_MASS = 24;
export const MIXING_PAPER: Readonly<RGBColor> = { r: 255, g: 255, b: 255 };
export const MIXING_PAPER_LINEAR: Readonly<LinearRGBColor> = {
  r: decodeSrgbByte(MIXING_PAPER.r),
  g: decodeSrgbByte(MIXING_PAPER.g),
  b: decodeSrgbByte(MIXING_PAPER.b),
};

// Display-cache bins only: the pigment field and transported mass are never
// quantised. Square roots retain the optical effect of trace tints and washes.
const PIXEL_PIGMENT_STEPS = 4095;
const PIXEL_DEPTH_STEPS = 4096;
const PIXEL_LIGHT_STEPS = 4096;

interface FilmAppearance { rgb?: RGBColor; linear: LinearRGBColor }

/** Bounded, two-generation cache; sqrt quantisation preserves dilute tints. */
export class PaintFilmCache {
  private current = new Map<string, LinearRGBColor>();
  private previous = new Map<string, LinearRGBColor>();
  private films = new Map<string, SpectralPaintFilm>();
  private optics = new Map<string, PigmentOptics>();
  private currentPixels = new Map<string, FilmAppearance>();
  private previousPixels = new Map<string, FilmAppearance>();
  private groundIds = new WeakMap<SpectralSurface, number>();
  private nextGroundId = 0;

  /** One opaque-ground film, integrated directly without transient film arrays. */
  rgb(
    amounts: ArrayLike<number>, mass: number, ground: SpectralSurface,
    opacity = 1, lighting = 1, offset = 0,
  ): RGBColor {
    const appearance = this.appearance(amounts, mass, ground, opacity, lighting, offset);
    if (!appearance.rgb) {
      const shown = displayLinearColor(appearance.linear);
      appearance.rgb = { r: encodeSrgbByte(shown.r), g: encodeSrgbByte(shown.g), b: encodeSrgbByte(shown.b) };
    }
    return appearance.rgb;
  }

  /** Physical linear light for later image composition; no intermediate gamut map. */
  linear(
    amounts: ArrayLike<number>, mass: number, ground: SpectralSurface,
    opacity = 1, lighting = 1, offset = 0,
  ): LinearRGBColor {
    return this.appearance(amounts, mass, ground, opacity, lighting, offset).linear;
  }

  private appearance(
    amounts: ArrayLike<number>, mass: number, ground: SpectralSurface,
    opacity: number, lighting: number, offset: number,
  ): FilmAppearance {
    let total = 0;
    for (let p = 0; p < PIGMENT_IDS.length; p += 1) total += amounts[offset + p];
    let mixtureKey = "";
    const shares = new Array<number>(PIGMENT_IDS.length);
    for (let p = 0; p < PIGMENT_IDS.length; p += 1) {
      const share = total > 0 ? amounts[offset + p] / total : 0;
      const code = Math.round(Math.sqrt(Math.max(0, share)) * PIXEL_PIGMENT_STEPS);
      shares[p] = (code / PIXEL_PIGMENT_STEPS) ** 2;
      mixtureKey += `${p > 0 ? ":" : ""}${code}`;
    }
    let groundId = this.groundIds.get(ground);
    if (groundId === undefined) {
      groundId = this.nextGroundId++;
      this.groundIds.set(ground, groundId);
    }
    const alpha = Math.min(1, Math.max(0, opacity));
    const depth = Math.round(Math.sqrt(Math.max(0, mass)) * PIXEL_DEPTH_STEPS);
    const light = Math.round(lighting * PIXEL_LIGHT_STEPS);
    const key = `${groundId}/${alpha}/${depth}/${light}/${mixtureKey}`;
    const cached = this.currentPixels.get(key) ?? this.previousPixels.get(key);
    if (cached) return cached;
    const opticalKey = `pixel:${mixtureKey}`;
    let optics = this.optics.get(opticalKey);
    if (!optics) {
      optics = preparePigmentOptics(shares);
      if (this.optics.size >= this.limit) this.optics.clear();
      this.optics.set(opticalKey, optics);
    }
    const linear = compositePigmentOpticsRgb(optics,
      (depth / PIXEL_DEPTH_STEPS) ** 2 * OPTICAL_DEPTH_PER_MASS,
      ground, alpha, light / PIXEL_LIGHT_STEPS, false);
    const appearance = { linear };
    if (this.currentPixels.size >= this.limit * 2) {
      this.previousPixels = this.currentPixels;
      this.currentPixels = new Map();
    }
    this.currentPixels.set(key, appearance);
    return appearance;
  }

  film(amounts: ArrayLike<number>, mass: number, offset = 0): SpectralPaintFilm {
    let total = 0;
    for (let p = 0; p < PIGMENT_IDS.length; p += 1) total += amounts[offset + p];
    const ratios = PIGMENT_IDS.map((_, p) => total > 0 ? amounts[offset + p] / total : 0);
    const mixtureKey = ratios.map(v => Math.round(v * 1e6)).join(":");
    const key = `${mixtureKey}/${Math.round(mass * 1e6)}`;
    let film = this.films.get(key);
    if (!film) {
      let optics = this.optics.get(mixtureKey);
      if (!optics) { optics = preparePigmentOptics(ratios); if (this.optics.size >= this.limit) this.optics.clear(); this.optics.set(mixtureKey, optics); }
      film = filmFromPigmentOptics(optics, mass * OPTICAL_DEPTH_PER_MASS);
      if (this.films.size >= this.limit) this.films.clear();
      this.films.set(key, film);
    }
    return film;
  }
  constructor(private readonly limit = 32768) {}

  over(
    amounts: ArrayLike<number>,
    mass: number,
    background: LinearRGBColor,
    offset = 0,
  ): LinearRGBColor {
    if (mass <= 0) return background;
    let total = 0;
    for (let p = 0; p < PIGMENT_IDS.length; p += 1) total += amounts[offset + p];
    if (total <= 0) return background;
    const ratios = PIGMENT_IDS.map((_, p) =>
      Math.round(Math.sqrt(Math.max(0, amounts[offset + p] / total)) * 2047),
    );
    const depth = Math.round(Math.sqrt(Math.min(64, mass)) * 2048);
    const ground = [background.r, background.g, background.b].map((v) =>
      Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 4095),
    );
    const key = `${ratios.join(":")}/${depth}/${ground.join(":")}`;
    const found = this.current.get(key);
    if (found) return found;
    let result = this.previous.get(key);
    if (!result) {
      const film = mixPigmentFilm(
        ratios.map((v) => (v / 2047) ** 2),
        (depth / 2048) ** 2 * OPTICAL_DEPTH_PER_MASS,
      );
      result = compositeSpectralFilm(film, {
        r: (ground[0] / 4095) ** 2,
        g: (ground[1] / 4095) ** 2,
        b: (ground[2] / 4095) ** 2,
      });
    }
    if (this.current.size >= this.limit) {
      this.previous = this.current;
      this.current = new Map();
    }
    this.current.set(key, result);
    return result;
  }
}

export const sharedPaintFilmCache = new PaintFilmCache();

/**
 * Encode a paper-composited physical colour into browser straight-alpha RGBA.
 * Alpha retains the relief signal; the RGB encoding compensates for the
 * browser's gamma-space composition so the displayed result matches `shown`.
 */
export function paletteFilmRgba(shown: LinearRGBColor, bodyCoverage: number) {
  const target = [shown.r, shown.g, shown.b].map(encodeSrgbByte);
  const paper = [MIXING_PAPER.r, MIXING_PAPER.g, MIXING_PAPER.b];
  let alpha = Math.min(1, Math.max(0, bodyCoverage));
  for (let c = 0; c < 3; c += 1) {
    if (target[c] === paper[c]) continue;
    alpha = Math.max(alpha, target[c] < paper[c]
      ? 1 - target[c] / paper[c]
      : (target[c] - paper[c]) / (255 - paper[c]));
  }
  // Round upward so all straight channels remain representable after packing.
  const byteAlpha = Math.ceil(Math.min(1, alpha) * 255);
  alpha = byteAlpha / 255;
  return [
    ...target.map((value, c) => alpha > 0
      ? Math.round(Math.min(255, Math.max(0, (value - paper[c] * (1 - alpha)) / alpha)))
      : 0),
    byteAlpha,
  ];
}

export function displayedPaletteRgb(pixel: ArrayLike<number>): RGBColor {
  const alpha = pixel[3] / 255;
  return {
    r: Math.round(pixel[0] * alpha + MIXING_PAPER.r * (1 - alpha)),
    g: Math.round(pixel[1] * alpha + MIXING_PAPER.g * (1 - alpha)),
    b: Math.round(pixel[2] * alpha + MIXING_PAPER.b * (1 - alpha)),
  };
}
