import { findBead } from "./catalogue";
import type { Bead, Rgb } from "./types";

/** A user-confirmed RGB completion for a catalogue row that has no published RGB. */
export type CatalogueColorOverride = Readonly<{ beadId: string; rgb: Rgb }>;

/**
 * Browser-local palette choices. These choices never invent a material: each ID
 * must refer to a catalogue record, and colour completions are only allowed for
 * records whose catalogue RGB is currently unknown.
 */
export type PalettePreferences = Readonly<{
  favoriteBeadIds: readonly string[];
  editorAddedBeadIds: readonly string[];
  lastSelectedBeadId: string | null;
  colorOverrides: readonly CatalogueColorOverride[];
}>;

export const PALETTE_PREFERENCES_VERSION = 1;
export const PALETTE_PREFERENCES_STORAGE_KEY = "beadcraftr.palette-preferences.v1";
export const emptyPalettePreferences = (): PalettePreferences => ({
  favoriteBeadIds: [], editorAddedBeadIds: [], lastSelectedBeadId: null, colorOverrides: [],
});

export function isRgb(value: unknown): value is Rgb {
  return Boolean(value) && typeof value === "object" && ["r", "g", "b"].every((channel) => {
    const component = (value as Record<string, unknown>)[channel];
    return Number.isInteger(component) && (component as number) >= 0 && (component as number) <= 255;
  });
}

/** Accepts #RRGGBB or RRGGBB, never shorthand or guessed values. */
export function parseRgbHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) };
}

export function rgbToHex(rgb: Rgb): string {
  if (!isRgb(rgb)) throw new Error("RGB completion values must be integers from 0 through 255.");
  return `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`.toUpperCase();
}

export function createCatalogueColorOverride(catalogue: readonly Bead[], beadId: string, rgb: Rgb): CatalogueColorOverride {
  const bead = findBead(catalogue, beadId);
  if (!bead) throw new Error("The selected bead is not in the current catalogue.");
  if (bead.rgb) throw new Error("This catalogue bead already has an RGB value and cannot be overridden.");
  if (!isRgb(rgb)) throw new Error("RGB completion values must be integers from 0 through 255.");
  return { beadId: bead.id, rgb: { ...rgb } };
}

/** Applies only user-confirmed completions, never a guessed fallback for unknown rows. */
export function applyCatalogueColorOverrides(catalogue: readonly Bead[], overrides: readonly CatalogueColorOverride[]): Bead[] {
  const byId = new Map<string, Rgb>();
  for (const override of overrides) {
    const bead = findBead(catalogue, override.beadId);
    if (!bead || bead.rgb || !isRgb(override.rgb)) continue;
    byId.set(bead.id, override.rgb);
  }
  return catalogue.map((bead) => {
    const rgb = byId.get(bead.id);
    return rgb ? { ...bead, rgb: { ...rgb }, html: rgbToHex(rgb) } : bead;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueKnownIds(ids: unknown, catalogue: readonly Bead[]): string[] {
  if (!Array.isArray(ids)) return [];
  const known = new Set(catalogue.map((bead) => bead.id));
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

/** Parses untrusted JSON/local-storage data and discards invalid or stale choices. */
export function parsePalettePreferences(value: unknown, catalogue: readonly Bead[]): PalettePreferences {
  if (!isRecord(value)) return emptyPalettePreferences();
  const favoriteBeadIds = uniqueKnownIds(value.favoriteBeadIds, catalogue);
  const editorAddedBeadIds = uniqueKnownIds(value.editorAddedBeadIds, catalogue);
  const lastSelectedBeadId = typeof value.lastSelectedBeadId === "string" && findBead(catalogue, value.lastSelectedBeadId) ? value.lastSelectedBeadId : null;
  const colorOverrides = Array.isArray(value.colorOverrides) ? value.colorOverrides.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.beadId !== "string" || !isRgb(entry.rgb)) return [];
    try { return [createCatalogueColorOverride(catalogue, entry.beadId, entry.rgb)]; } catch { return []; }
  }) : [];
  const deduplicatedOverrides = [...new Map(colorOverrides.map((override) => [override.beadId, override])).values()];
  return { favoriteBeadIds, editorAddedBeadIds, lastSelectedBeadId, colorOverrides: deduplicatedOverrides };
}

export function serializePalettePreferences(preferences: PalettePreferences): string {
  return JSON.stringify({ version: PALETTE_PREFERENCES_VERSION, ...preferences });
}

export function loadPalettePreferences(storage: Pick<Storage, "getItem"> | undefined, catalogue: readonly Bead[]): PalettePreferences {
  if (!storage) return emptyPalettePreferences();
  try { return parsePalettePreferences(JSON.parse(storage.getItem(PALETTE_PREFERENCES_STORAGE_KEY) ?? "null"), catalogue); } catch { return emptyPalettePreferences(); }
}

export function savePalettePreferences(storage: Pick<Storage, "setItem"> | undefined, preferences: PalettePreferences): void {
  if (!storage) return;
  try { storage.setItem(PALETTE_PREFERENCES_STORAGE_KEY, serializePalettePreferences(preferences)); } catch { /* Storage can be blocked or full; project export remains available. */ }
}
