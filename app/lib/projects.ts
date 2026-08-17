import { findBead } from "./catalogue";
import type { Bead, ConvertedPattern, Rgb } from "./types";

export const PROJECT_VERSION = 1;

export type ProjectSettings = Readonly<{
  brand: string;
  disabledIds: string[];
  maxColors: number;
  backgroundId: string;
  sourceType: "photo" | "pixel-art";
  dither: "none" | "floyd-steinberg" | "ordered";
  sparePercentage: number;
}>;

export type ProjectSaveInput = Readonly<{
  width: number;
  height: number;
  settings: ProjectSettings;
  preparation: unknown;
  includeSourceImage: boolean;
  pattern: ConvertedPattern;
}>;

export type LoadedProject = Readonly<{
  width: number;
  height: number;
  settings: ProjectSettings;
  preparation: unknown;
  pattern: ConvertedPattern;
}>;

type SavedCell = Readonly<{ beadId: string | null; sourceRgb: Rgb | null }>;

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function asPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}
function toRgb(value: unknown): Rgb | null {
  if (value === null) return null;
  if (!isRecord(value) || ![value.r, value.g, value.b].every((channel) => Number.isInteger(channel) && (channel as number) >= 0 && (channel as number) <= 255)) throw new Error("Project contains an invalid source color.");
  return { r: value.r as number, g: value.g as number, b: value.b as number };
}
function validateSettings(value: unknown): ProjectSettings {
  if (!isRecord(value) || typeof value.brand !== "string" || !Array.isArray(value.disabledIds) || !value.disabledIds.every((id) => typeof id === "string") || !Number.isSafeInteger(value.maxColors) || typeof value.backgroundId !== "string" || (value.sourceType !== "photo" && value.sourceType !== "pixel-art") || !["none", "floyd-steinberg", "ordered"].includes(value.dither as string) || !Number.isFinite(value.sparePercentage)) throw new Error("Project settings are invalid.");
  return { brand: value.brand, disabledIds: [...value.disabledIds], maxColors: value.maxColors as number, backgroundId: value.backgroundId, sourceType: value.sourceType, dither: value.dither as ProjectSettings["dither"], sparePercentage: value.sparePercentage as number };
}

/** Serializes a portable project. `includeSourceImage` controls whether its local data URL is embedded. */
export function serializeProject(input: ProjectSaveInput): string {
  const preparation = isRecord(input.preparation) ? { ...input.preparation } : input.preparation;
  if (!input.includeSourceImage && isRecord(preparation)) delete preparation.sourceUrl;
  return JSON.stringify({
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    width: input.width,
    height: input.height,
    settings: input.settings,
    preparation,
    sourceEmbedded: input.includeSourceImage,
    pattern: { cells: input.pattern.cells.map((cell) => ({ beadId: cell.beadId, sourceRgb: cell.sourceRgb })) },
  }, null, 2);
}

/** Reconstructs a grid against the current catalogue without inventing missing bead records. */
export function parseProject(text: string, catalogue: readonly Bead[]): LoadedProject {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("This is not a valid BeadCraftr project file."); }
  if (!isRecord(value) || value.version !== PROJECT_VERSION) throw new Error(`This project needs BeadCraftr project version ${PROJECT_VERSION}.`);
  const width = asPositiveInteger(value.width, "Project width"), height = asPositiveInteger(value.height, "Project height");
  const settings = validateSettings(value.settings);
  if (!isRecord(value.pattern) || !Array.isArray(value.pattern.cells) || value.pattern.cells.length !== width * height) throw new Error("Project grid does not match its dimensions.");
  const savedCells = value.pattern.cells.map((cell): SavedCell => {
    if (!isRecord(cell) || (cell.beadId !== null && typeof cell.beadId !== "string")) throw new Error("Project contains an invalid grid cell.");
    return { beadId: cell.beadId as string | null, sourceRgb: toRgb(cell.sourceRgb) };
  });
  const usedIds = new Set(savedCells.flatMap((cell) => cell.beadId ? [cell.beadId] : []));
  const missing = [...usedIds].find((id) => !findBead(catalogue, id)?.rgb);
  if (missing) throw new Error(`Project needs bead ${missing}, which is unavailable in this catalogue.`);
  const beadsById = new Map(catalogue.filter((bead) => bead.rgb).map((bead) => [bead.id, bead]));
  const counts = new Map<string, number>();
  const cells = savedCells.map((cell, index) => {
    if (cell.beadId) counts.set(cell.beadId, (counts.get(cell.beadId) ?? 0) + 1);
    return { x: index % width, y: Math.floor(index / width), ...cell };
  });
  return { width, height, settings, preparation: value.preparation, pattern: { width, height, cells, beadsById, counts, emptyPegs: cells.filter((cell) => !cell.beadId).length } };
}
