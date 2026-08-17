import assert from "node:assert/strict";
import test from "node:test";
import { parseProject, serializeProject } from "../app/lib/projects";
import type { Bead, ConvertedPattern } from "../app/lib/types";

const bead: Bead = { id: "PERLER:BLACK", brand: "PERLER", code: "BLACK", name: "Black", notes: "", rgb: { r: 0, g: 0, b: 0 }, html: "#000000" };
const pattern: ConvertedPattern = { width: 2, height: 1, cells: [{ x: 0, y: 0, beadId: bead.id, sourceRgb: bead.rgb }, { x: 1, y: 0, beadId: null, sourceRgb: null }], beadsById: new Map([[bead.id, bead]]), counts: new Map([[bead.id, 1]]), emptyPegs: 1 };
const settings = { brand: "PERLER", disabledIds: [], maxColors: 16, backgroundId: "empty", sourceType: "photo" as const, dither: "none" as const, sparePercentage: 10 };

test("projects round-trip their grid and can omit a source image", () => {
  const text = serializeProject({ width: 2, height: 1, settings, preparation: { sourceUrl: "data:image/png;base64,abc", zoom: 1 }, includeSourceImage: false, pattern, inventory: new Map([[bead.id, 25]]), symbols: new Map([[bead.id, "A"]]) });
  assert.doesNotMatch(text, /data:image/);
  const loaded = parseProject(text, [bead]);
  assert.equal(loaded.pattern.cells[0].beadId, bead.id);
  assert.equal(loaded.pattern.emptyPegs, 1);
  assert.equal(loaded.inventory.get(bead.id), 25);
  assert.equal(loaded.symbols.get(bead.id), "A");
  assert.equal(loaded.sourceEmbedded, false);
});

test("version 1 projects migrate without inventory or symbols", () => {
  const value = JSON.parse(serializeProject({ width: 2, height: 1, settings, preparation: { sourceUrl: "data:image/png;base64,abc" }, includeSourceImage: true, pattern }));
  value.version = 1;
  delete value.inventory;
  delete value.symbols;
  delete value.sourceEmbedded;
  const loaded = parseProject(JSON.stringify(value), [bead]);
  assert.equal(loaded.inventory.size, 0);
  assert.equal(loaded.symbols.size, 0);
  assert.equal(loaded.sourceEmbedded, true);
});
