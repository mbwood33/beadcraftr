import { strToU8, zipSync } from "fflate";

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
  /** A stable printable pattern token, assigned by the pattern model. */
  symbol?: string;
};

export type PatternExportMetadata = {
  title?: string;
  /** The generation limit, which may be lower than manually edited colors. */
  maxColorDepth?: number;
  /** Physical board dimensions for boundary and assembly metadata. */
  boardWidth?: number;
  boardHeight?: number;
  /** On-hand quantities, keyed by stable bead id. */
  inventoryByBeadId?: Readonly<Record<string, number | undefined>>;
  /** Symbols keyed by id take precedence over optional per-cell symbols. */
  symbolsByBeadId?: Readonly<Record<string, string | undefined>>;
};

export type PatternExportModel = {
  width: number;
  height: number;
  cells: ReadonlyArray<ReadonlyArray<BeadExportColor | null>>;
  metadata?: PatternExportMetadata;
};

export type MaterialExportRow = BeadExportColor & {
  symbol?: string;
  requiredQuantity: number;
  sparePercentage: number;
  recommendedQuantity: number;
  onHandQuantity: number;
  quantityToBuy: number;
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

function alphaLabel(index: number): string {
  let value = index;
  let label = "";
  do { label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return label;
}

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

function nonNegativeInteger(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function symbolFor(pattern: PatternExportModel, bead: BeadExportColor): string | undefined {
  return pattern.metadata?.symbolsByBeadId?.[bead.id] ?? bead.symbol;
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
      symbol: symbolFor(pattern, bead),
      requiredQuantity: quantity,
      sparePercentage,
      recommendedQuantity: Math.ceil(quantity * (1 + sparePercentage / 100)),
      onHandQuantity: nonNegativeInteger(pattern.metadata?.inventoryByBeadId?.[bead.id]),
      quantityToBuy: 0,
    }))
    .map((row) => ({ ...row, quantityToBuy: Math.max(0, row.recommendedQuantity - row.onHandQuantity) }))
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
  const headers = ["Symbol", "Brand", "Code", "Color", "Hex", "Required quantity", "Spare percentage", "Recommended quantity", "On hand", "Quantity to buy"];
  const lines = rows.map((row) => [
    row.symbol ?? "",
    row.brand,
    row.code,
    row.name,
    row.hex.toUpperCase(),
    row.requiredQuantity,
    row.sparePercentage,
    row.recommendedQuantity,
    row.onHandQuantity,
    row.quantityToBuy,
  ].map(csvField).join(","));
  // BOM makes the file open as UTF-8 in older desktop spreadsheet software.
  return `\uFEFF${headers.map(csvField).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

/**
 * CSV representation of every peg. Coordinates are one-based for makers;
 * the grid remains row-major internally as cells[y][x].
 */
export function patternGridToCsv(pattern: PatternExportModel): string {
  assertPattern(pattern);
  const headers = ["Column (x)", "Row (y)", "Occupied", "Symbol", "Bead ID", "Brand", "Code", "Color", "Hex"];
  const lines: string[] = [];
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const bead = pattern.cells[y][x];
      lines.push([
        x + 1,
        y + 1,
        bead ? "Yes" : "No",
        bead ? symbolFor(pattern, bead) ?? "" : "",
        bead?.id ?? "",
        bead?.brand ?? "",
        bead?.code ?? "",
        bead?.name ?? "",
        bead?.hex.toUpperCase() ?? "",
      ].map(csvField).join(","));
    }
  }
  return `\uFEFF${headers.map(csvField).join(",")}\r\n${lines.join("\r\n")}\r\n`;
}

type WorksheetCell = string | number | boolean | null;
type XlsxSheet = { name: string; rows: WorksheetCell[][]; widths: number[] };

/* A compact OpenXML writer: XLSX is a ZIP of XML files, so no server or large
 * spreadsheet library is needed for these export-only workbooks. */
function xml(value: string | number | boolean): string {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function excelColumn(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

function xlsxCell(value: WorksheetCell, column: number, row: number): string {
  if (value === null || value === "") return "";
  const address = `${excelColumn(column)}${row}`;
  const style = row === 1 ? ' s="1"' : "";
  if (typeof value === "number") return `<c r="${address}"${style}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${address}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${address}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const dimension = `A1:${excelColumn(Math.max(0, ...sheet.rows.map((row) => row.length - 1)))}${Math.max(1, sheet.rows.length)}`;
  const columns = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rows = sheet.rows.map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, columnIndex) => xlsxCell(value, columnIndex, rowIndex + 1)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${rows}</sheetData></worksheet>`;
}

function xlsxBlob(sheets: XlsxSheet[], title: string, subject: string): Blob {
  const now = "2000-01-01T00:00:00Z"; // Stable metadata makes equivalent exports deterministic.
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF385C77"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>'),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:subject>${xml(subject)}</dc:subject><dc:creator>BeadCraftr</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>BeadCraftr</Application><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${xml(sheet.name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet)); });
  const compressed = zipSync(files, { level: 6 });
  // Copy into a browser-owned ArrayBuffer; TypeScript otherwise permits a
  // SharedArrayBuffer-backed typed array that Blob intentionally rejects.
  const bytes = new Uint8Array(compressed.byteLength);
  bytes.set(compressed);
  return new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Creates a self-contained browser-downloadable XLSX materials workbook. */
export function createMaterialsXlsxBlob(rows: ReadonlyArray<MaterialExportRow>, title = "BeadCraftr materials"): Blob {
  return xlsxBlob([{ name: "Materials", rows: [
    ["Symbol", "Brand", "Code", "Color", "Hex", "Required quantity", "Spare percentage", "Recommended quantity", "On hand", "Quantity to buy"],
    ...rows.map((row) => [row.symbol ?? "", row.brand, row.code, row.name, row.hex.toUpperCase(), row.requiredQuantity, `${row.sparePercentage}%`, row.recommendedQuantity, row.onHandQuantity, row.quantityToBuy]),
  ], widths: [10, 16, 14, 24, 12, 18, 18, 23, 12, 18] }], title, "Fuse bead materials list");
}

/**
 * Creates a workbook with a visual grid and a long-form Peg data sheet. The
 * second sheet makes the export easy to filter, while the first is easy to
 * inspect or print.
 */
export function createPatternGridXlsxBlob(pattern: PatternExportModel, title = "BeadCraftr pattern"): Blob {
  assertPattern(pattern);
  const gridRows: WorksheetCell[][] = [
    ["Row \\ Column", ...Array.from({ length: pattern.width }, (_, x) => x + 1)],
    ...pattern.cells.map((row, y) => [y + 1, ...row.map((bead) => bead ? (symbolFor(pattern, bead) ?? bead.code) : "")]),
  ];

  const pegRows: WorksheetCell[][] = [["Column (x)", "Row (y)", "Occupied", "Symbol", "Bead ID", "Brand", "Code", "Color", "Hex"]];
  for (let y = 0; y < pattern.height; y += 1) for (let x = 0; x < pattern.width; x += 1) {
    const bead = pattern.cells[y][x];
    pegRows.push([x + 1, y + 1, Boolean(bead), bead ? symbolFor(pattern, bead) ?? "" : "", bead?.id ?? "", bead?.brand ?? "", bead?.code ?? "", bead?.name ?? "", bead?.hex.toUpperCase() ?? ""]);
  }
  return xlsxBlob([
    { name: "Pattern grid", rows: gridRows, widths: [14, ...Array.from({ length: pattern.width }, () => 6)] },
    { name: "Peg data", rows: pegRows, widths: [13, 11, 11, 10, 28, 16, 14, 24, 12] },
    { name: "Pattern info", rows: [
    ["Property", "Value"],
    ["Pattern width", pattern.width],
    ["Pattern height", pattern.height],
    ["Board width", pattern.metadata?.boardWidth ?? ""],
    ["Board height", pattern.metadata?.boardHeight ?? ""],
    ["Generation color limit", pattern.metadata?.maxColorDepth ?? ""],
    ], widths: [28, 22] },
  ], title, "Fuse bead pattern grid");
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
    const boardWidth = pattern.metadata?.boardWidth;
    const boardHeight = pattern.metadata?.boardHeight;
    if ((Number.isInteger(boardWidth) && (boardWidth as number) > 0) || (Number.isInteger(boardHeight) && (boardHeight as number) > 0)) {
      context.strokeStyle = "rgba(0, 70, 60, 0.85)";
      context.lineWidth = Math.max(2, Math.round(cellSize / 10));
      context.beginPath();
      if (Number.isInteger(boardWidth) && (boardWidth as number) > 0) for (let x = boardWidth as number; x < pattern.width; x += boardWidth as number) {
        const position = x * cellSize;
        context.moveTo(position, 0);
        context.lineTo(position, canvas.height);
      }
      if (Number.isInteger(boardHeight) && (boardHeight as number) > 0) for (let y = boardHeight as number; y < pattern.height; y += boardHeight as number) {
        const position = y * cellSize;
        context.moveTo(0, position);
        context.lineTo(canvas.width, position);
      }
      context.stroke();
      if (Number.isInteger(boardWidth) && (boardWidth as number) > 0 && Number.isInteger(boardHeight) && (boardHeight as number) > 0) {
        context.font = `bold ${Math.max(8, Math.round(cellSize * 0.48))}px sans-serif`;
        context.textBaseline = "top";
        for (let row = 0, y = 0; y < pattern.height; row += 1, y += boardHeight as number) for (let column = 0, x = 0; x < pattern.width; column += 1, x += boardWidth as number) {
          const label = `${alphaLabel(row)}${column + 1}`;
          const labelWidth = context.measureText(label).width + 6;
          context.fillStyle = "rgba(255, 255, 255, 0.88)";
          context.fillRect(x * cellSize + 1, y * cellSize + 1, labelWidth, Math.max(10, cellSize * 0.58));
          context.fillStyle = "#075e52";
          context.fillText(label, x * cellSize + 4, y * cellSize + 2);
        }
      }
    }
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
  const materialRows = materials.map((row) => `<tr><td>${escapeHtml(row.symbol ?? "")}</td><td><span class="swatch" style="background:${escapeHtml(row.hex)}"></span></td><td>${escapeHtml(row.brand)}</td><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.name)}</td><td>${row.requiredQuantity}</td><td>${row.recommendedQuantity}</td><td>${row.onHandQuantity}</td><td>${row.quantityToBuy}</td></tr>`).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { margin: 0.5in; } body { font-family: Arial, sans-serif; color: #111; } h1 { font-size: 18pt; margin: 0 0 6pt; } p { margin: 0 0 14pt; } .pattern { max-width: 100%; image-rendering: pixelated; border: 1px solid #777; } table { border-collapse: collapse; margin-top: 16pt; width: 100%; font-size: 10pt; } th, td { border: 1px solid #aaa; padding: 5pt; text-align: left; } th { background: #eee; } .swatch { display: block; width: 16pt; height: 16pt; border: 1px solid #555; border-radius: 50%; } @media print { .print { display: none; } }
  </style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><h1>${escapeHtml(title)}</h1><p>${pattern.width} x ${pattern.height} pegs · ${materials.reduce((total, row) => total + row.requiredQuantity, 0)} beads · ${pattern.width * pattern.height - materials.reduce((total, row) => total + row.requiredQuantity, 0)} empty pegs</p><img class="pattern" alt="${escapeHtml(title)} grid pattern" src="${canvas.toDataURL("image/png")}"><h2>Materials</h2><table><thead><tr><th></th><th>Brand</th><th>Code</th><th>Color</th><th>Required</th><th>Recommended</th></tr></thead><tbody>${materialRows}</tbody></table></body></html>`);
  popup.document.close();
  const headerRow = popup.document.querySelector("thead tr");
  if (headerRow) headerRow.innerHTML = "<th>Symbol</th><th></th><th>Brand</th><th>Code</th><th>Color</th><th>Required</th><th>Recommended</th><th>On hand</th><th>To buy</th>";
  return popup;
}
