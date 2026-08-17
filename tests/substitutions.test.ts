import assert from "node:assert/strict";
import test from "node:test";
import { substitutePatternColor, suggestColorSubstitutions } from "../app/lib/substitutions";
import type { Bead, ConvertedPattern } from "../app/lib/types";

const gray: Bead = { id: "PERLER:GRAY", brand: "PERLER", code: "GRAY", name: "Gray", notes: "", rgb: { r: 100, g: 100, b: 100 }, html: "#646464" };
const nearGray: Bead = { id: "PERLER:NEAR_GRAY", brand: "PERLER", code: "NEAR_GRAY", name: "Near gray", notes: "", rgb: { r: 105, g: 105, b: 105 }, html: "#696969" };
const pattern: ConvertedPattern = { width: 3, height: 1, cells: [{ x: 0, y: 0, beadId: gray.id, sourceRgb: gray.rgb }, { x: 1, y: 0, beadId: nearGray.id, sourceRgb: nearGray.rgb }, { x: 2, y: 0, beadId: nearGray.id, sourceRgb: nearGray.rgb }], beadsById: new Map([[gray.id, gray], [nearGray.id, nearGray]]), counts: new Map([[gray.id, 1], [nearGray.id, 2]]), emptyPegs: 0 };

test("substitutions are suggestions until explicitly applied", () => {
  const [suggestion] = suggestColorSubstitutions(pattern);
  assert.equal(suggestion.fromId, gray.id);
  assert.equal(suggestion.toId, nearGray.id);
  const updated = substitutePatternColor(pattern, suggestion.fromId, suggestion.toId);
  assert.equal(updated.counts.size, 1);
  assert.equal(updated.counts.get(nearGray.id), 3);
});
