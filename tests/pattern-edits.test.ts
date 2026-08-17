import assert from "node:assert/strict";
import test from "node:test";
import { floodPatternCells, setPatternCell } from "../app/lib/pattern-edits";
import type { Bead, ConvertedPattern } from "../app/lib/types";

const black: Bead = { id: "PERLER:BLACK", brand: "PERLER", code: "BLACK", name: "Black", notes: "", rgb: { r: 0, g: 0, b: 0 }, html: "#000000" };
const white: Bead = { id: "PERLER:WHITE", brand: "PERLER", code: "WHITE", name: "White", notes: "", rgb: { r: 255, g: 255, b: 255 }, html: "#ffffff" };
const pattern: ConvertedPattern = {
  width: 2,
  height: 2,
  cells: [
    { x: 0, y: 0, beadId: "PERLER:BLACK", sourceRgb: black.rgb }, { x: 1, y: 0, beadId: null, sourceRgb: null },
    { x: 0, y: 1, beadId: null, sourceRgb: null }, { x: 1, y: 1, beadId: "PERLER:BLACK", sourceRgb: black.rgb },
  ],
  beadsById: new Map([[black.id, black], [white.id, white]]),
  counts: new Map([[black.id, 2]]),
  emptyPegs: 2,
};

test("setPatternCell recalculates counts and empty pegs", () => {
  const updated = setPatternCell(pattern, 1, 0, white.id);
  assert.equal(updated.cells[1].beadId, white.id);
  assert.equal(updated.counts.get(black.id), 2);
  assert.equal(updated.counts.get(white.id), 1);
  assert.equal(updated.emptyPegs, 1);
  assert.equal(setPatternCell(pattern, 3, 0, white.id), pattern);
});

test("floodPatternCells changes only a connected component", () => {
  const updated = floodPatternCells(pattern, 1, 0, white.id);
  assert.deepEqual(updated.cells.map((cell) => cell.beadId), [black.id, white.id, null, black.id]);
  assert.equal(updated.counts.get(white.id), 1);
  assert.equal(updated.emptyPegs, 1);
});
