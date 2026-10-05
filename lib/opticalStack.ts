/** DOM-free appearance of a saved, ordered set of physical paint films. */
import { applySpectralFilm, blendSpectralSurface, cloneSpectralSurface, spectralSurfaceFromLinearRgb, spectralSurfaceToLinearRgb, type LinearRGBColor, type SpectralSurface } from "./colorScience";
import { sharedPaintFilmCache } from "./paintFilm";
import type { OpticalPaintLayer } from "./types";

const appearance = new WeakMap<readonly OpticalPaintLayer[], Map<string, LinearRGBColor>>();

/** Scale every physical thickness together; preserve the opacity of each layer group. */
export function renderOpticalStackRgb(stack: readonly OpticalPaintLayer[], massScale: number, background: LinearRGBColor): LinearRGBColor {
  if (massScale <= 0 || !stack.length) return background;
  let cache = appearance.get(stack);
  if (!cache) { cache = new Map(); appearance.set(stack, cache); }
  const key = `${background.r}:${background.g}:${background.b}/${Math.round(massScale * 1e6)}`;
  const found = cache.get(key);
  if (found) return found;
  const apply = (surface: SpectralSurface, coat: OpticalPaintLayer) => {
    if (!coat.children?.length) { applySpectralFilm(surface, sharedPaintFilmCache.film(coat.pigment, coat.mass * massScale), coat.opacity ?? 1, coat.lighting ?? 1); return; }
    const below = (coat.opacity ?? 1) < 1 ? cloneSpectralSurface(surface) : undefined;
    for (const child of coat.children) apply(surface, child);
    if (below) { blendSpectralSurface(below, surface, coat.opacity ?? 1); surface.reflectance.set(below.reflectance); surface.residual.set(below.residual); }
  };
  const surface = spectralSurfaceFromLinearRgb(background);
  for (const coat of stack) apply(surface, coat);
  const rgb = spectralSurfaceToLinearRgb(surface);
  if (cache.size >= 32768) cache.clear();
  cache.set(key, rgb);
  return rgb;
}
