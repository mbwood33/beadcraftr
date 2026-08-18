import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCatalogueColorOverrides,
  createCatalogueColorOverride,
  parsePalettePreferences,
  parseRgbHex,
  rgbToHex,
} from "../app/lib/palette-preferences";
import { parseProject, serializeProject } from "../app/lib/projects";
import type { Bead, ConvertedPattern } from "../app/lib/types";

const known: Bead = { id: "PERLER:BLACK", brand: "PERLER", code: "BLACK", name: "Black", notes: "", rgb: { r: 0, g: 0, b: 0 }, html: "#000000" };
const specialty: Bead = { id: "PERLER:P??:ROW-2", brand: "PERLER", code: "P??", name: "Specialty", notes: "RGB pending", rgb: null, html: null };
const pattern: ConvertedPattern = { width: 1, height: 1, cells: [{ x: 0, y: 0, beadId: specialty.id, sourceRgb: { r: 12, g: 34, b: 56 } }], beadsById: new Map(), counts: new Map([[specialty.id, 1]]), emptyPegs: 0 };
const settings = { brand: "PERLER", disabledIds: [], maxColors: 16, backgroundId: "empty", sourceType: "photo" as const, dither: "none" as const, sparePercentage: 10 };

test("specialty RGB completions require a known unknown-RGB bead and an explicit valid color", () => {
  assert.deepEqual(parseRgbHex("#0c2238"), { r: 12, g: 34, b: 56 });
  assert.equal(parseRgbHex("#abc"), null);
  assert.equal(rgbToHex({ r: 12, g: 34, b: 56 }), "#0C2238");
  const completion = createCatalogueColorOverride([known, specialty], specialty.id, { r: 12, g: 34, b: 56 });
  const effective = applyCatalogueColorOverrides([known, specialty], [completion]);
  assert.deepEqual(effective[1].rgb, { r: 12, g: 34, b: 56 });
  assert.equal(effective[1].html, "#0C2238");
  assert.throws(() => createCatalogueColorOverride([known, specialty], known.id, { r: 1, g: 2, b: 3 }));
  assert.throws(() => createCatalogueColorOverride([known, specialty], specialty.id, { r: 256, g: 2, b: 3 }));
});

test("palette preferences discard stale IDs and invalid completions without guessing", () => {
  const preferences = parsePalettePreferences({
    favoriteBeadIds: [known.id, "missing", known.id],
    editorAddedBeadIds: [specialty.id],
    lastSelectedBeadId: "missing",
    colorOverrides: [{ beadId: specialty.id, rgb: { r: 1, g: 2, b: 3 } }, { beadId: known.id, rgb: { r: 4, g: 5, b: 6 } }],
  }, [known, specialty]);
  assert.deepEqual(preferences.favoriteBeadIds, [known.id]);
  assert.equal(preferences.lastSelectedBeadId, null);
  assert.deepEqual(preferences.colorOverrides, [{ beadId: specialty.id, rgb: { r: 1, g: 2, b: 3 } }]);
});

test("version 3 projects preserve preferences and let explicit specialty completions reopen grids", () => {
  const text = serializeProject({
    width: 1, height: 1, settings, preparation: {}, includeSourceImage: false, pattern,
    palettePreferences: { favoriteBeadIds: [specialty.id], editorAddedBeadIds: [specialty.id], lastSelectedBeadId: specialty.id, colorOverrides: [{ beadId: specialty.id, rgb: { r: 12, g: 34, b: 56 } }] },
    backgroundMask: { version: 1, edits: ["keep"] },
  });
  const loaded = parseProject(text, [known, specialty]);
  assert.equal(loaded.settings.alphaThreshold, 128);
  assert.deepEqual(loaded.pattern.beadsById.get(specialty.id)?.rgb, { r: 12, g: 34, b: 56 });
  assert.deepEqual(loaded.backgroundMask, { version: 1, edits: ["keep"] });
  assert.equal(loaded.palettePreferences.lastSelectedBeadId, specialty.id);
});
