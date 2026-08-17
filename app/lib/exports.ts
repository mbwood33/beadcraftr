/**
 * Browser-only export helpers.  The grid is row-major: cells[y][x], with a
 * null cell representing an empty peg (and never a clear bead).
 */

export type BeadExportColor = {
  /** Stable catalogue identifier, normally `${normalizedBrand}:${normalizedCode}`. */
  id: string;
  brand: string;
  code: string;
  name: string;
  /** A valid CSS hexadecimal colour, for example #1a2b3c. */
  hex: string;
};

export type PatternExportModel = {
  width: number;
  height: number;
  cells: ReadonlyArray<ReadonlyArray<BeadExportColor | null>>;
};

export type MaterialExportRow = BeadExportColor & {
  requiredQuantity: number;
  sparePercentage: number;
  recommendedQuantity: number;
};

export type PatternRenderOptions = {
  includeGrid?: boolean;
  /** Pixel is clearest for instruction sheets; bead resembles a real board. */
  style?: "pixel" | "bead";
  cellSize?: number;
  emptyColor?: string;
  gridColor?: string;
};

const DEFAULT_CELL_SIZE = 24;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function assertPattern(pattern: PatternExportModel): void {
  if (!Number.isInteger(pattern.width) || !Number.isInteger(pattern.height) || pattern.width < 1 || pattern.height < 1) {
    throw new Error("Pattern dimensions must be positive integers.");
  }
  if (pattern.cells.length !== pattern.height) {
    throw new Error("Pattern cell row count does not match its height.");
  }
  pattern.cells.forEach((row, y) => {
    if (row.length !== pattern.width) {
      throw new Error(`Pattern row ${y} does not match its width.`);
    }
    row.forEach((cell) => {
      if (cell && (!cell.id || !HEX_COLOR.test(cell.hex))) {
        throw new Error("Every occupied pattern cell needs an id and a #RRGGBB colour.");
      }
    });
  });
}

/** Builds a stable, brand-aware materials list directly from occupied pegs. */
export function buildMaterialsRows(
  pattern: PatternExportModel,
  sparePercentage = 10,
): MaterialExportRow[] {
  assertPattern(pattern);
  if (!Number.isFinite(sparePercentage) || sparePercentage < 0) {
    throw new Error("Spare percentage must be a non-negative number.");
  }

  const counts = new Map<string, { bead: BeadExportColor; quantity: number }>();
  for (const row of pattern.cells) {
    for (const bead of row) {
      if (!bead) continue;
      const existing = counts.get(bead.id);
      if (existing) existing.quantity += 1;
      else counts.set(bead.id, { bead, quantity: 1 });
    }
  }

  return [...counts.values()]
    .map(({ bead, quantity }) => ({
      ...bead,
      requiredQuantity: quantity,
      sparePercentage,
      recommendedQuantity: Math.ceil(quantity * (1 + sparePercentage / 100)),
    }))
    .sort((a, b) =>
      a.brand.localeCompare(b.brand) || a.code.localeCompare(b.code) || a.name.localeCompare(b.name),
    );
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** UTF-8 CSV text for the Phase 1 shopping/materials list. */
export function materialsToCsv(rows: ReadonlyArray<MaterialExportRow>): string {
  const headers = ["Brand", "Code", "Color", "Hex", "Required quantity", "Spare percentage", "Recommended quantity"];
  const lines = rows.map((row) => [
    row.brand,
    row.code,
    row.name,
    row.hex.toUpperCase(),
    row.requiredQuantity,
    row.sparePercentage,
    row.recommendedQuantity,
  ].map(csvField).join(","));
  // BOM makes the file open as UTF-8 in older desktop spreadsheet software.
  return `\uFEFF${headers.map(csvField).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

/** Create a canvas for PNG export. This requires a browser DOM. */
export function createPatternCanvas(
  pattern: PatternExportModel,
  options: PatternRenderOptions = {},
): HTMLCanvasElement {
  assertPattern(pattern);
  if (typeof document === "undefined") throw new Error("PNG exports are only available in a browser.");

  const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  if (!Number.isInteger(cellSize) || cellSize < 2 || cellSize > 256) {
    throw new Error("Cell size must be an integer from 2 to 256.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = pattern.width * cellSize;
  canvas.height = pattern.height * cellSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create a drawing canvas.");

  const emptyColor = options.emptyColor ?? "#ffffff";
  const includeGrid = options.includeGrid ?? true;
  const style = options.style ?? "pixel";
  context.fillStyle = emptyColor;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const bead = pattern.cells[y][x];
      if (!bead) continue;
      const left = x * cellSize;
      const top = y * cellSize;
      context.fillStyle = bead.hex;
      if (style === "bead") {
        context.beginPath();
        context.arc(left + cellSize / 2, top + cellSize / 2, cellSize * 0.42, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(left, top, cellSize, cellSize);
      }
    }
  }

  if (includeGrid) {
    context.strokeStyle = options.gridColor ?? "rgba(0, 0, 0, 0.24)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= pattern.width; x += 1) {
      const position = x * cellSize + 0.5;
      context.moveTo(position, 0);
      context.lineTo(position, canvas.height);
    }
    for (let y = 0; y <= pattern.height; y += 1) {
      const position = y * cellSize + 0.5;
      context.moveTo(0, position);
      context.lineTo(canvas.width, position);
    }
    context.stroke();
  }
  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode PNG.")), "image/png");
  });
}

export async function createPatternPngBlob(
  pattern: PatternExportModel,
  options: PatternRenderOptions = {},
): Promise<Blob> {
  return canvasToPngBlob(createPatternCanvas(pattern, options));
}

/** Trigger a local download. Call this in response to a user action. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") throw new Error("Downloads are only available in a browser.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/**
 * Opens a print-friendly document. Browsers' "Save to PDF" is deliberately
 * used here so Phase 1 stays dependency-free and works entirely locally.
 */
export function openPrintablePattern(
  pattern: PatternExportModel,
  options: PatternRenderOptions & { title?: string; sparePercentage?: number } = {},
): Window {
  if (typeof window === "undefined") throw new Error("Printable exports are only available in a browser.");
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) throw new Error("The print window was blocked. Allow pop-ups and try again.");
  const canvas = createPatternCanvas(pattern, { ...options, includeGrid: true, style: "pixel", cellSize: 28 });
  const materials = buildMaterialsRows(pattern, options.sparePercentage ?? 10);
  const title = options.title ?? "BeadCraftr pattern";
  const materialRows = materials.map((row) => `<tr><td><span class="swatch" style="background:${escapeHtml(row.hex)}"></span></td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${row.requiredQuantity}</td><td>${row.recommendedQuantity}</td></tr>`).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { margin: 0.5in; } body { font-family: Arial, sans-serif; color: #111; } h1 { font-size: 18pt; margin: 0 0 6pt; } p { margin: 0 0 14pt; } .pattern { max-width: 100%; image-rendering: pixelated; border: 1px solid #777; } table { border-collapse: collapse; margin-top: 16pt; width: 100%; font-size: 10pt; } th, td { border: 1px solid #aaa; padding: 5pt; text-align: left; } th { background: #eee; } .swatch { display: block; width: 16pt; height: 16pt; border: 1px solid #555; border-radius: 50%; } @media print { .print { display: none; } }
  </style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><h1>${escapeHtml(title)}</h1><p>${pattern.width} x ${pattern.height} pegs · ${materials.reduce((total, row) => total + row.requiredQuantity, 0)} beads · ${pattern.width * pattern.height - materials.reduce((total, row) => total + row.requiredQuantity, 0)} empty pegs</p><img class="pattern" alt="${escapeHtml(title)} grid pattern" src="${canvas.toDataURL("image/png")}"><h2>Materials</h2><table><thead><tr><th></th><th>Brand</th><th>Code</th><th>Color</th><th>Required</th><th>Recommended</th></tr></thead><tbody>${materialRows}</tbody></table></body></html>`);
  popup.document.close();
  return popup;
}
