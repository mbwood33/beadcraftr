import assert from "node:assert/strict";
import test from "node:test";
import { boardLayout } from "../app/lib/boards";
import { closestEligibleBead } from "../app/lib/conversion";
import { materialRequirements, validInventory } from "../app/lib/inventory";
import { assignSymbols } from "../app/lib/symbols";
import type { Bead } from "../app/lib/types";

test("board layout labels partial physical boards deterministically", () => {
  const layout = boardLayout(58, 31);
  assert.deepEqual({ columns: layout.columns, rows: layout.rows, count: layout.count }, { columns: 2, rows: 2, count: 4 });
  assert.deepEqual(layout.tiles.map((tile) => [tile.label, tile.width, tile.height]), [["A1", 29, 29], ["A2", 29, 29], ["B1", 29, 2], ["B2", 29, 2]]);
});

test("inventory distinguishes exact, recommended, on-hand, and to-buy quantities", () => {
  const rows = materialRequirements(new Map([["black", 317], ["white", 10]]), new Map([["black", 300]]), 10);
  assert.deepEqual(rows[0], { beadId: "black", required: 317, recommended: 349, onHand: 300, toBuy: 49 });
  assert.deepEqual(rows[1], { beadId: "white", required: 10, recommended: 11, onHand: 0, toBuy: 11 });
});

test("inventory filtering keeps only available valid beads", () => {
  const bead = { id: "PERLER:BLACK" } as Bead;
  assert.deepEqual([...validInventory(new Map([[bead.id, 4.8], ["OTHER", 7]]), [bead])], [[bead.id, 4]]);
});

test("stable symbols preserve previous assignments and omit ambiguous tokens", () => {
  const symbols = assignSymbols(["b", "a", "c"], new Map([["b", "Z"]]));
  assert.equal(symbols.get("b"), "Z");
  assert.equal(symbols.get("a"), "A");
  assert.equal(symbols.get("c"), "B");
  assert.ok([...symbols.values()].every((symbol) => !/[I1O0]/.test(symbol)));
});

test("source-image sampling resolves to an enabled catalogue bead", () => {
  const disabled = { id: "PERLER:DISABLED", brand: "PERLER", code: "DISABLED", name: "Disabled", notes: "", rgb: { r: 100, g: 100, b: 100 }, html: "#646464" } as Bead;
  const enabled = { id: "PERLER:ENABLED", brand: "PERLER", code: "ENABLED", name: "Enabled", notes: "", rgb: { r: 110, g: 110, b: 110 }, html: "#6E6E6E" } as Bead;
  const match = closestEligibleBead({ r: 101, g: 101, b: 101 }, [disabled, enabled], { brand: "PERLER", disabledBeadIds: new Set([disabled.id]) });
  assert.equal(match.id, enabled.id);
});
