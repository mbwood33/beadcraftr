import type { RgbaRaster } from "./types";

export type MaskBrushMode = "keep" | "remove";
export type MaskPoint = Readonly<{ x: number; y: number }>;
export type MaskBrushStroke = Readonly<{
  mode: MaskBrushMode;
  /** Coordinates are normalized to the prepared image (0–1), keeping projects compact. */
  points: readonly MaskPoint[];
  /** Normalized image-width radius. */
  radius: number;
}>;

/** Entirely local background-removal and refinement state, safe to serialize in a project. */
export type BackgroundMaskSettings = Readonly<{
  automatic: boolean;
  /** RGB distance threshold for border-connected background pixels. */
  threshold: number;
  strokes: readonly MaskBrushStroke[];
}>;

export const defaultBackgroundMask: BackgroundMaskSettings = {
  automatic: false,
  threshold: 54,
  strokes: [],
};

/** Normalizes untrusted project data without inventing mask edits. */
export function normalizeBackgroundMask(value: unknown): BackgroundMaskSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultBackgroundMask;
  const record = value as Record<string, unknown>;
  const threshold = typeof record.threshold === "number" && Number.isFinite(record.threshold) ? clamp(record.threshold, 0, 441) : defaultBackgroundMask.threshold;
  const strokes = Array.isArray(record.strokes) ? record.strokes.flatMap((entry): MaskBrushStroke[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const stroke = entry as Record<string, unknown>;
    if ((stroke.mode !== "keep" && stroke.mode !== "remove") || typeof stroke.radius !== "number" || !Number.isFinite(stroke.radius) || !Array.isArray(stroke.points)) return [];
    const points = stroke.points.flatMap((point): MaskPoint[] => {
      if (!point || typeof point !== "object" || Array.isArray(point)) return [];
      const candidate = point as Record<string, unknown>;
      if (typeof candidate.x !== "number" || typeof candidate.y !== "number" || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return [];
      return [{ x: clamp(candidate.x, 0, 1), y: clamp(candidate.y, 0, 1) }];
    });
    return points.length ? [{ mode: stroke.mode, radius: clamp(stroke.radius, 0.001, 1), points }] : [];
  }) : [];
  return { automatic: record.automatic === true, threshold, strokes };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const indexFor = (x: number, y: number, width: number) => y * width + x;

function rgbDistance(data: Uint8ClampedArray, a: number, b: number): number {
  const ao = a * 4, bo = b * 4;
  return Math.hypot(data[ao] - data[bo], data[ao + 1] - data[bo + 1], data[ao + 2] - data[bo + 2]);
}

function borderIndices(width: number, height: number): number[] {
  const result: number[] = [];
  for (let x = 0; x < width; x += 1) { result.push(indexFor(x, 0, width)); if (height > 1) result.push(indexFor(x, height - 1, width)); }
  for (let y = 1; y < height - 1; y += 1) { result.push(indexFor(0, y, width)); if (width > 1) result.push(indexFor(width - 1, y, width)); }
  return result;
}

/**
 * Finds a border-connected, visually similar background. It intentionally makes
 * no network or AI call. This conservative approach preserves enclosed details
 * and lets the user repair ambiguous edges with keep/remove brush strokes.
 */
export function automaticMask(raster: RgbaRaster, threshold = defaultBackgroundMask.threshold): Uint8ClampedArray {
  const { width, height, data } = raster;
  if (data.length !== width * height * 4) throw new Error("Raster dimensions do not match its RGBA data.");
  const mask = new Uint8ClampedArray(width * height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4 + 3] === 0 ? 0 : 255;
  const border = borderIndices(width, height).filter((index) => data[index * 4 + 3] > 0);
  if (!border.length) return mask;

  // Use the top-left nontransparent border pixel as an explicit, deterministic
  // reference. This avoids averaging unrelated border colors into a fake color.
  const reference = border[0];
  const visited = new Uint8Array(width * height);
  const queue = [reference]; visited[reference] = 1;
  const safeThreshold = clamp(Number.isFinite(threshold) ? threshold : defaultBackgroundMask.threshold, 0, 441);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (data[current * 4 + 3] === 0 || rgbDistance(data, current, reference) > safeThreshold) continue;
    mask[current] = 0;
    const x = current % width, y = Math.floor(current / width);
    const neighbors = [x > 0 ? current - 1 : -1, x + 1 < width ? current + 1 : -1, y > 0 ? current - width : -1, y + 1 < height ? current + width : -1];
    for (const next of neighbors) if (next >= 0 && !visited[next]) { visited[next] = 1; queue.push(next); }
  }
  return mask;
}

function paintCircle(mask: Uint8ClampedArray, width: number, height: number, point: MaskPoint, radius: number, value: number) {
  const cx = point.x * Math.max(1, width - 1), cy = point.y * Math.max(1, height - 1);
  const pixelRadius = Math.max(1, radius * width);
  const minX = Math.max(0, Math.floor(cx - pixelRadius)), maxX = Math.min(width - 1, Math.ceil(cx + pixelRadius));
  const minY = Math.max(0, Math.floor(cy - pixelRadius)), maxY = Math.min(height - 1, Math.ceil(cy + pixelRadius));
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    if (Math.hypot(x - cx, y - cy) <= pixelRadius) mask[indexFor(x, y, width)] = value;
  }
}

function paintStroke(mask: Uint8ClampedArray, width: number, height: number, stroke: MaskBrushStroke) {
  const points = stroke.points;
  if (!points.length) return;
  const value = stroke.mode === "keep" ? 255 : 0;
  const radius = clamp(stroke.radius, 0.001, 1);
  paintCircle(mask, width, height, points[0], radius, value);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1], to = points[index];
    const distance = Math.hypot((to.x - from.x) * width, (to.y - from.y) * height);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * width * 0.45)));
    for (let step = 1; step <= steps; step += 1) paintCircle(mask, width, height, { x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }, radius, value);
  }
}

/** Creates the alpha mask at any raster resolution; suitable for preview and conversion. */
export function resolveBackgroundMask(raster: RgbaRaster, settings: BackgroundMaskSettings | undefined): Uint8ClampedArray {
  const effective = normalizeBackgroundMask(settings);
  const mask = effective.automatic ? automaticMask(raster, effective.threshold) : new Uint8ClampedArray(Array.from({ length: raster.width * raster.height }, (_, index) => raster.data[index * 4 + 3] === 0 ? 0 : 255));
  for (const stroke of effective.strokes) paintStroke(mask, raster.width, raster.height, stroke);
  return mask;
}

/** Applies the selected mask by multiplying alpha, never fabricating color in transparent pixels. */
export function applyBackgroundMask(raster: RgbaRaster, settings: BackgroundMaskSettings | undefined): RgbaRaster {
  const mask = resolveBackgroundMask(raster, settings);
  const data = new Uint8ClampedArray(raster.data);
  for (let index = 0; index < mask.length; index += 1) data[index * 4 + 3] = Math.round(data[index * 4 + 3] * mask[index] / 255);
  return { width: raster.width, height: raster.height, data };
}
