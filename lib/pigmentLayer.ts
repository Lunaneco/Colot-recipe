/**
 * Browser glue between a `PigmentField` and the `<canvas>` that shows it.
 * The field is the source of truth; the canvas is a rendered view.
 */

import {
  RENDER_MARGIN,
  compositePigmentLayers,
  createPigmentField,
  decodePigmentField,
  decodePigmentGlazes,
  encodePigmentField,
  encodePigmentWetness,
  encodePigmentGlazes,
  expandBounds,
  fullBounds,
  pigmentFieldFromRgba,
  renderPigmentField,
  resamplePigmentField,
  type CompositeBase,
  type CompositeSource,
  type PigmentField,
  type RenderOptions,
} from "./pigmentField";
import { pigmentsFromRgb } from "./pigmentInverse";
import { resumeStoredPaint } from "./paintDrying";
import type { ImageDataLike, PixelBounds } from "./paintEngine";

export interface StoredPigmentLayer {
  dataUrl?: string;
  /** Pigment planes, optional water, and an optional ordered glaze payload. */
  pigmentDataUrls?: string[];
  /** Time the stored water content was captured, in Unix milliseconds. */
  pigmentSavedAt?: number;
}

/** Validate the PNG envelope before any browser decode or canvas allocation. */
export function assertStoredPng(dataUrl: string) {
  if (typeof dataUrl !== "string" || dataUrl.length > 16_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw new Error("Invalid artwork PNG");
  const bytes = atob(dataUrl.slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 65));
  if (bytes.length < 24 || [137,80,78,71,13,10,26,10].some((byte,i) => bytes.charCodeAt(i) !== byte) || bytes.slice(12,16) !== "IHDR") throw new Error("Invalid artwork PNG header");
  const dimension = (offset: number) => bytes.charCodeAt(offset) * 0x1000000 + bytes.charCodeAt(offset+1) * 0x10000 + bytes.charCodeAt(offset+2) * 0x100 + bytes.charCodeAt(offset+3);
  const width = dimension(16), height = dimension(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 32_000_000) throw new Error("Artwork PNG dimensions exceed limits");
  return {width, height};
}

export function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  assertStoredPng(dataUrl);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Artwork image could not load"));
    image.src = dataUrl;
  });
}

/**
 * Decodes a data URL into pixels. With `width`/`height` the picture is
 * scaled to that size (for pictures); without them the stored pixels are
 * returned exactly, which data planes need — scaling would blend the bytes
 * of neighbouring pixels.
 */
export async function imageDataFromDataUrl(
  dataUrl: string,
  width?: number,
  height?: number,
): Promise<ImageData> {
  const image = await loadImageElement(dataUrl);
  const targetWidth = width ?? image.naturalWidth;
  const targetHeight = height ?? image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D context unavailable");
  context.drawImage(image, 0, 0, targetWidth, targetHeight);
  return context.getImageData(0, 0, targetWidth, targetHeight);
}

export function dataUrlFromImageData(image: ImageDataLike): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D context unavailable");
  const pixels = context.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

export function encodeStoredPigmentField(field: PigmentField): string[] {
  const planes = [...encodePigmentField(field), encodePigmentWetness(field)];
  const glazes = encodePigmentGlazes(field);
  if (glazes) planes.push(glazes);
  return planes.map(dataUrlFromImageData);
}

/**
 * Restores a field from storage. Layers saved before the pigment engine only
 * have an RGBA image; their colours are decomposed into the closest paint
 * mixture so they stay paintable with the same rules.
 */
export async function decodeStoredPigmentField(
  layer: StoredPigmentLayer,
  width: number,
  height: number,
): Promise<PigmentField> {
  if (layer.pigmentDataUrls && layer.pigmentDataUrls.length >= 2) {
    if (layer.pigmentDataUrls.length > 5) throw new Error("Too many pigment planes");
    const sizes = layer.pigmentDataUrls.map(assertStoredPng);
    // Data planes become multiple floating-point fields, unlike an ordinary
    // decoded image. Limit them to the largest supported artwork allocation.
    if (sizes[0].width * sizes[0].height > 1_000_000) throw new Error("Pigment field dimensions exceed limits");
    if (sizes.slice(0,4).some(size => size.width !== sizes[0].width || size.height !== sizes[0].height)) throw new Error("Pigment plane dimensions differ");
    // Planes are decoded at their stored size: the bytes are data, and a
    // change of paper size is applied to the field, not to the image.
    const [a, b, c, wetness, glazes] = await Promise.all(
      layer.pigmentDataUrls.map((url) => imageDataFromDataUrl(url)),
    );
    const decoded = decodePigmentField(a, b, c, wetness);
    if (glazes) decodePigmentGlazes(decoded, glazes);
    const restored = decoded.width === width && decoded.height === height
      ? decoded
      : resamplePigmentField(decoded, width, height);
    resumeStoredPaint(restored, layer.pigmentSavedAt);
    return restored;
  }
  if (layer.dataUrl) {
    const image = await imageDataFromDataUrl(layer.dataUrl, width, height);
    return pigmentFieldFromRgba(image, pigmentsFromRgb);
  }
  return createPigmentField(width, height);
}

/**
 * Draws the picture — `sources` stacked over `base` in linear light — into
 * `canvas`, for `bounds` (the whole canvas when null). This is the only way
 * pixels reach the screen, the PNG export and the fill tool, so all three see
 * the same bytes.
 */
export function renderCompositeToCanvas(
  canvas: HTMLCanvasElement,
  base: CompositeBase,
  sources: readonly CompositeSource[],
  bounds: PixelBounds | null = null,
  options?: RenderOptions,
) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  // Relief shading reads neighbours, so pixels next to a change change too.
  const area = bounds
    ? expandBounds(bounds, RENDER_MARGIN)
    : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.min(canvas.width, Math.ceil(area.x + area.width)) - x;
  const height = Math.min(canvas.height, Math.ceil(area.y + area.height)) - y;
  if (width <= 0 || height <= 0) return;
  const image = context.createImageData(width, height);
  compositePigmentLayers(base, sources, image, { x, y, width, height }, options);
  context.putImageData(image, x, y);
}

export interface LayerSnapshot {
  dataUrl: string;
  pigmentDataUrls: string[];
  pigmentSavedAt: number;
}

/**
 * Pigment data plus a stand-alone rendering of the layer (transparent PNG,
 * dry appearance) for storage and history.
 */
export function snapshotPigmentLayer(field: PigmentField): LayerSnapshot {
  const pigmentSavedAt = Date.now();
  const image: ImageDataLike = {
    width: field.width,
    height: field.height,
    data: new Uint8ClampedArray(field.width * field.height * 4),
  };
  renderPigmentField(field, image, fullBounds(field), { wetDarkening: 0 });
  return {
    dataUrl: dataUrlFromImageData(image),
    pigmentDataUrls: encodeStoredPigmentField(field),
    pigmentSavedAt,
  };
}
