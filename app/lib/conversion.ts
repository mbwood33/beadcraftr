import { eligibleBeads, findBead } from "./catalogue";
import type { Bead, ConversionOptions, ConvertedPattern, Rgb, RgbaRaster } from "./types";

const DEFAULT_MAX_COLORS = 16;
const DEFAULT_ALPHA_THRESHOLD = 128;

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function rgbToLab(rgb: Rgb): [number, number, number] {
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (v: number) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function distance(a: Rgb, b: Rgb): number {
  const [al, aa, ab] = rgbToLab(a), [bl, ba, bb] = rgbToLab(b);
  return (al - bl) ** 2 + (aa - ba) ** 2 + (ab - bb) ** 2;
}
function closest(color: Rgb, beads: readonly Bead[]): Bead {
  let best = beads[0]; let bestDistance = Number.POSITIVE_INFINITY;
  for (const bead of beads) {
    const candidateDistance = distance(color, bead.rgb!);
    if (candidateDistance < bestDistance || (candidateDistance === bestDistance && bead.id < best.id)) { best = bead; bestDistance = candidateDistance; }
  }
  return best;
}
function composite(foreground: Rgb, alpha: number, background: Rgb): Rgb {
  const opacity = alpha / 255;
  return {
    r: Math.round(foreground.r * opacity + background.r * (1 - opacity)),
    g: Math.round(foreground.g * opacity + background.g * (1 - opacity)),
    b: Math.round(foreground.b * opacity + background.b * (1 - opacity)),
  };
}

/** Maps an already resized RGBA raster (one pixel per target peg) to an eligible physical palette. */
export function convertRasterToPattern(raster: RgbaRaster, catalogue: readonly Bead[], options: ConversionOptions): ConvertedPattern {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("Pattern dimensions must be positive integers.");
  if (raster.width !== width || raster.height !== height || raster.data.length !== width * height * 4) throw new Error("Raster dimensions must exactly match pattern dimensions.");
  const maxColors = options.maxColors ?? DEFAULT_MAX_COLORS;
  if (!Number.isInteger(maxColors) || maxColors < 1) throw new Error("Maximum colors must be a positive integer.");
  const palette = eligibleBeads(catalogue, options.brand, options.disabledBeadIds);
  if (!palette.length) throw new Error("No eligible bead colors are available for this conversion.");
  const threshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw new Error("Alpha threshold must be between 0 and 255.");
  let background: Bead | undefined;
  if (options.background?.kind === "bead") {
    background = findBead(catalogue, options.background.beadId);
    if (!background?.rgb || !palette.some((bead) => bead.id === background!.id)) throw new Error("The selected background bead must be eligible.");
  }

  const prepared: (Rgb | null)[] = [];
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4, alpha = raster.data[offset + 3];
    const foreground = { r: raster.data[offset], g: raster.data[offset + 1], b: raster.data[offset + 2] };
    if (background) prepared.push(alpha === 255 ? foreground : composite(foreground, alpha, background.rgb!));
    else prepared.push(alpha < threshold ? null : foreground);
  }
  // First pass obtains deterministic candidate usage; second pass constrains all cells to its most-used colors.
  const firstPass = prepared.map((color) => color ? closest(color, palette) : null);
  const usage = new Map<string, number>();
  firstPass.forEach((bead) => { if (bead) usage.set(bead.id, (usage.get(bead.id) ?? 0) + 1); });
  const finalPalette = [...usage.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, maxColors)
    .map(([id]) => palette.find((bead) => bead.id === id)!);
  const cells = prepared.map((sourceRgb, index) => {
    const bead = sourceRgb ? closest(sourceRgb, finalPalette) : null;
    return { x: index % width, y: Math.floor(index / width), beadId: bead?.id ?? null, sourceRgb };
  });
  const counts = new Map<string, number>();
  cells.forEach((cell) => { if (cell.beadId) counts.set(cell.beadId, (counts.get(cell.beadId) ?? 0) + 1); });
  return { width, height, cells, beadsById: new Map(palette.map((bead) => [bead.id, bead])), counts, emptyPegs: cells.filter((cell) => !cell.beadId).length };
}

/** Exposed for source-image eyedropper and focused tests; returns no invented colors. */
export function closestEligibleBead(color: Rgb, catalogue: readonly Bead[], options: Pick<ConversionOptions, "brand" | "disabledBeadIds">): Bead {
  const palette = eligibleBeads(catalogue, options.brand, options.disabledBeadIds);
  if (!palette.length) throw new Error("No eligible bead colors are available.");
  return closest(color, palette);
}
