import type { Bead, BrandSelection, Rgb } from "./types";

const normalize = (value: string) => value.trim().toUpperCase();

export function beadId(brand: string, code: string): string {
  return `${normalize(brand)}:${normalize(code)}`;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n") { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseRgb(row: Record<string, string>): Rgb | null {
  const r = Number(row.R), g = Number(row.G), b = Number(row.B);
  if ([r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return { r, g, b };
  const hex = (row.HTML ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  return null;
}

/** Parses the supplied catalogue without guessing unknown specialty-color RGB values. */
export function parseCatalogue(csv: string): Bead[] {
  const rows = parseCsvRows(csv);
  if (!rows.length) return [];
  const header = rows[0].map(normalize);
  const required = ["CODE", "NAME", "R", "G", "B", "HTML", "BRAND", "NOTES"];
  if (required.some((column) => !header.includes(column))) throw new Error("Catalogue CSV is missing required columns.");
  const seen = new Set<string>();
  return rows.slice(1).flatMap((values, rowIndex) => {
    const row = Object.fromEntries(header.map((column, index) => [column, values[index] ?? ""]));
    const code = row.CODE.trim(), brand = normalize(row.BRAND);
    if (!code || !brand) return [];
    const rgb = parseRgb(row);
    const baseId = beadId(brand, code);
    // The supplied catalogue reuses placeholder codes such as P?? for several
    // distinct colors (including a few valid RGB entries). Preserve the source
    // code for display/export and add a stable source-row suffix only on a
    // collision, rather than discarding usable catalogue colors.
    const id = seen.has(baseId) ? `${baseId}:ROW-${rowIndex + 2}` : baseId;
    if (seen.has(id)) throw new Error(`Duplicate catalogue bead identity: ${baseId}`);
    seen.add(id);
    const html = rgb ? `#${rgb.r.toString(16).padStart(2, "0")}${rgb.g.toString(16).padStart(2, "0")}${rgb.b.toString(16).padStart(2, "0")}`.toUpperCase() : null;
    return [{ id, code, name: row.NAME.trim(), brand, notes: row.NOTES.trim(), rgb, html }];
  });
}

export function isBrandSelected(bead: Bead, selection: BrandSelection): boolean {
  return normalize(selection) === "BOTH" || bead.brand === normalize(selection);
}

/** Only records with an actual catalogue RGB value are eligible for automatic matching. */
export function eligibleBeads(catalogue: readonly Bead[], brand: BrandSelection, disabled: ReadonlySet<string> = new Set()): Bead[] {
  return catalogue.filter((bead) => bead.rgb !== null && isBrandSelected(bead, brand) && !disabled.has(bead.id));
}

export function findBead(catalogue: readonly Bead[], id: string): Bead | undefined {
  return catalogue.find((bead) => bead.id === id);
}
