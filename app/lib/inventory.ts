import type { Bead } from "./types";

export type MaterialRequirement = Readonly<{
  beadId: string;
  required: number;
  recommended: number;
  onHand: number;
  toBuy: number;
}>;

function count(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return Math.floor(value);
}

/** Calculates shopping needs; recommended quantities are always rounded up. */
export function materialRequirements(
  requiredCounts: ReadonlyMap<string, number>,
  inventory: ReadonlyMap<string, number> = new Map(),
  sparePercentage = 10,
): MaterialRequirement[] {
  if (!Number.isFinite(sparePercentage) || sparePercentage < 0) throw new Error("Spare percentage must be non-negative.");
  return [...requiredCounts.entries()].map(([beadId, amount]) => {
    const required = count(amount, "Required quantity");
    const onHand = count(inventory.get(beadId) ?? 0, "On-hand quantity");
    const recommended = Math.ceil(required * (1 + sparePercentage / 100));
    return { beadId, required, recommended, onHand, toBuy: Math.max(0, recommended - onHand) };
  }).sort((a, b) => a.beadId < b.beadId ? -1 : a.beadId > b.beadId ? 1 : 0);
}

export function validInventory(inventory: ReadonlyMap<string, number>, eligible: readonly Bead[]): Map<string, number> {
  const ids = new Set(eligible.map((bead) => bead.id));
  return new Map([...inventory.entries()].filter(([id, amount]) => ids.has(id) && Number.isFinite(amount) && amount >= 0).map(([id, amount]) => [id, Math.floor(amount)]));
}
