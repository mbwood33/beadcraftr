/** Printable symbols deliberately omit ambiguous I/l/1/O/0 and support unlimited active colors. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type SymbolAssignments = ReadonlyMap<string, string>;

function tokenAt(index: number): string {
  let value = index;
  let output = "";
  do { output = ALPHABET[value % ALPHABET.length] + output; value = Math.floor(value / ALPHABET.length) - 1; } while (value >= 0);
  return output;
}

/**
 * Preserves valid existing assignments first; new bead IDs receive the next
 * available deterministic token in sorted ID order. Existing absent IDs are dropped.
 */
export function assignSymbols(activeBeadIds: Iterable<string>, previous: SymbolAssignments = new Map()): Map<string, string> {
  const active = [...new Set(activeBeadIds)].sort();
  const activeSet = new Set(active);
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const [id, token] of previous) {
    if (activeSet.has(id) && /^[A-HJ-KM-NP-Z2-9]+$/.test(token) && !used.has(token)) { result.set(id, token); used.add(token); }
  }
  let cursor = 0;
  for (const id of active) {
    if (result.has(id)) continue;
    let token = tokenAt(cursor++);
    while (used.has(token)) token = tokenAt(cursor++);
    result.set(id, token); used.add(token);
  }
  return result;
}
