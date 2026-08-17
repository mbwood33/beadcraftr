import type { ConvertedPattern, Rgb } from "./types";

export type ColorSubstitutionSuggestion = Readonly<{
  fromId: string;
  toId: string;
  quantity: number;
  distance: number;
  label: "very close" | "close";
}>;

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function lab(color: Rgb): [number, number, number] {
  const r = srgbToLinear(color.r), g = srgbToLinear(color.g), b = srgbToLinear(color.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function perceptualDistance(first: Rgb, second: Rgb): number {
  const [firstL, firstA, firstB] = lab(first), [secondL, secondA, secondB] = lab(second);
  return Math.sqrt((firstL - secondL) ** 2 + (firstA - secondA) ** 2 + (firstB - secondB) ** 2);
}

/** Finds optional low-impact merges; it never changes a pattern by itself. */
export function suggestColorSubstitutions(pattern: ConvertedPattern, maxSuggestions = 3): ColorSubstitutionSuggestion[] {
  const used = [...pattern.counts.entries()]
    .map(([id, quantity]) => ({ bead: pattern.beadsById.get(id), quantity }))
    .filter((entry): entry is { bead: NonNullable<typeof entry.bead>; quantity: number } => Boolean(entry.bead?.rgb));
  return used
    .filter(({ quantity }) => quantity <= 12)
    .flatMap(({ bead: source, quantity }) => used
      .filter(({ bead: target, quantity: targetQuantity }) => target.id !== source.id && targetQuantity > quantity)
      .map(({ bead: target }) => ({ fromId: source.id, toId: target.id, quantity, distance: perceptualDistance(source.rgb!, target.rgb!) })))
    .filter((suggestion) => suggestion.distance <= 20)
    .sort((first, second) => first.distance - second.distance || first.quantity - second.quantity || first.fromId.localeCompare(second.fromId))
    .slice(0, maxSuggestions)
    .map((suggestion) => ({ ...suggestion, label: suggestion.distance <= 10 ? "very close" : "close" }));
}

export function substitutePatternColor(pattern: ConvertedPattern, fromId: string, toId: string): ConvertedPattern {
  if (fromId === toId || !pattern.beadsById.has(fromId) || !pattern.beadsById.has(toId)) return pattern;
  const cells = pattern.cells.map((cell) => cell.beadId === fromId ? { ...cell, beadId: toId } : cell);
  const counts = new Map<string, number>();
  cells.forEach((cell) => { if (cell.beadId) counts.set(cell.beadId, (counts.get(cell.beadId) ?? 0) + 1); });
  return { ...pattern, cells, counts };
}
