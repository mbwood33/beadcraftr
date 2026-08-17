"use client";

import { useMemo, useState } from "react";
import catalogueCsv from "../perlercolor - Printable.csv?raw";
import { defaultImagePreparation, ImageCropWorkspace, type ImagePreparationValue } from "./components/ImageCropWorkspace";
import { eligibleBeads, parseCatalogue } from "./lib/catalogue";
import { convertRasterToPattern } from "./lib/conversion";
import { buildMaterialsRows, createPatternPngBlob, downloadBlob, materialsToCsv, openPrintablePattern, type PatternExportModel } from "./lib/exports";
import type { Bead, ConvertedPattern, RgbaRaster } from "./lib/types";

type SourceType = "photo" | "pixel-art";
type PreviewStyle = "bead" | "pixel";
const catalogue = parseCatalogue(catalogueCsv);

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = src;
  });
}

async function rasterFromPreparation(preparation: ImagePreparationValue, width: number, height: number, sourceType: SourceType): Promise<RgbaRaster> {
  if (!preparation.sourceUrl) throw new Error("Upload an image before generating a pattern.");
  const source = await readImage(preparation.sourceUrl);
  const quarterTurn = preparation.rotation === 90 || preparation.rotation === 270;
  const transformed = document.createElement("canvas");
  transformed.width = quarterTurn ? source.naturalHeight : source.naturalWidth;
  transformed.height = quarterTurn ? source.naturalWidth : source.naturalHeight;
  const transformedContext = transformed.getContext("2d");
  if (!transformedContext) throw new Error("Your browser could not transform the image.");
  transformedContext.translate(transformed.width / 2, transformed.height / 2);
  transformedContext.rotate((preparation.rotation * Math.PI) / 180);
  transformedContext.scale(preparation.flipHorizontal ? -1 : 1, preparation.flipVertical ? -1 : 1);
  transformedContext.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
  const crop = preparation.crop;
  const sx = Math.round((crop.x / 100) * transformed.width);
  const sy = Math.round((crop.y / 100) * transformed.height);
  const sw = Math.max(1, Math.round((crop.width / 100) * transformed.width));
  const sh = Math.max(1, Math.round((crop.height / 100) * transformed.height));
  const cropped = document.createElement("canvas");
  cropped.width = sw; cropped.height = sh;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) throw new Error("Your browser could not prepare the image.");
  croppedContext.drawImage(transformed, sx, sy, sw, sh, 0, 0, sw, sh);
  const destination = document.createElement("canvas");
  destination.width = width; destination.height = height;
  const context = destination.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Your browser could not create the pattern canvas.");
  context.imageSmoothingEnabled = sourceType === "photo";
  context.imageSmoothingQuality = "high";
  const scale = preparation.fitMode === "cover" ? Math.max(width / cropped.width, height / cropped.height) : Math.min(width / cropped.width, height / cropped.height);
  const drawWidth = cropped.width * scale;
  const drawHeight = cropped.height * scale;
  const shouldCenter = preparation.fitMode === "cover" || preparation.paddingAlignment === "center";
  const dx = shouldCenter ? (width - drawWidth) / 2 : 0;
  const dy = shouldCenter ? (height - drawHeight) / 2 : 0;
  context.clearRect(0, 0, width, height);
  context.drawImage(cropped, dx, dy, drawWidth, drawHeight);
  const imageData = context.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}

function toExportPattern(pattern: ConvertedPattern): PatternExportModel {
  return { width: pattern.width, height: pattern.height, cells: Array.from({ length: pattern.height }, (_, y) => Array.from({ length: pattern.width }, (_, x) => {
    const cell = pattern.cells[y * pattern.width + x];
    const bead = cell.beadId ? pattern.beadsById.get(cell.beadId) : undefined;
    return bead?.html ? { id: bead.id, brand: bead.brand, code: bead.code, name: bead.name, hex: bead.html } : null;
  })) };
}

function Swatch({ bead }: { bead: Bead }) { return <span className="swatch" style={{ backgroundColor: bead.html ?? "transparent" }} aria-hidden="true" />; }

export default function Home() {
  const [preparation, setPreparation] = useState(defaultImagePreparation);
  const [width, setWidth] = useState(29); const [height, setHeight] = useState(29);
  const [brand, setBrand] = useState("PERLER"); const [disabledIds, setDisabledIds] = useState<string[]>([]);
  const [maxColors, setMaxColors] = useState(16); const [backgroundId, setBackgroundId] = useState("empty");
  const [sourceType, setSourceType] = useState<SourceType>("photo"); const [sparePercentage, setSparePercentage] = useState(10);
  const [previewStyle, setPreviewStyle] = useState<PreviewStyle>("bead"); const [pattern, setPattern] = useState<ConvertedPattern | null>(null);
  const [message, setMessage] = useState("Upload an image, set your board, then generate a local pattern."); const [isGenerating, setIsGenerating] = useState(false);
  const eligible = useMemo(() => eligibleBeads(catalogue, brand, new Set(disabledIds)), [brand, disabledIds]);
  const exportPattern = useMemo(() => pattern ? toExportPattern(pattern) : null, [pattern]);
  const materials = useMemo(() => exportPattern ? buildMaterialsRows(exportPattern, sparePercentage) : [], [exportPattern, sparePercentage]);
  const totalBeads = materials.reduce((sum, row) => sum + row.requiredQuantity, 0);
  const updateDimension = (setter: (value: number) => void, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setter(Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1);
  };
  const toggleDisabled = (id: string) => setDisabledIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const generate = async () => {
    try {
      setIsGenerating(true); setMessage("Preparing your image and matching it to real bead colors...");
      const raster = await rasterFromPreparation(preparation, width, height, sourceType);
      const next = convertRasterToPattern(raster, catalogue, { width, height, brand, disabledBeadIds: new Set(disabledIds), maxColors, alphaThreshold: 128, background: backgroundId === "empty" ? { kind: "empty" } : { kind: "bead", beadId: backgroundId } });
      setPattern(next); setMessage(`Pattern ready: ${next.width} x ${next.height} pegs, ${next.emptyPegs} empty.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The pattern could not be generated."); } finally { setIsGenerating(false); }
  };
  const downloadPattern = async (includeGrid: boolean) => {
    if (!exportPattern) return;
    downloadBlob(await createPatternPngBlob(exportPattern, { includeGrid, style: previewStyle, cellSize: 24 }), `beadcraftr-${width}x${height}${includeGrid ? "-grid" : ""}.png`);
  };
  return <main className="site-shell">
    <header className="topbar"><a className="brand" href="#workspace" aria-label="BeadCraftr home"><span className="brand-mark">BC</span><span>BeadCraftr</span></a><p>Turn an image into a pattern you can actually make.</p><span className="local-badge">Local in your browser</span></header>
    <section className="hero" aria-labelledby="page-title"><div><p className="eyebrow">Fuse bead pattern studio</p><h1 id="page-title">Make the picture. Count every bead.</h1><p className="hero-copy">Crop your image, choose the beads you have, and get a clear 29 x 29 pattern with a ready-to-shop materials list.</p></div><div className="hero-art" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} className={`hero-bead hero-bead-${index % 5}`} />)}</div></section>
    <section id="workspace" className="workspace" aria-label="Pattern generator">
      <aside className="controls-panel"><div className="panel-heading"><p className="eyebrow">01. Configure</p><h2>Your board & beads</h2></div><div className="control-grid two-columns"><label>Width <input type="number" min="1" value={width} onChange={(event) => updateDimension(setWidth, event.target.value)} /></label><label>Height <input type="number" min="1" value={height} onChange={(event) => updateDimension(setHeight, event.target.value)} /></label></div><p className="control-note">Default Perler board: 29 x 29 pegs. Large boards may take longer to generate.</p>
        <label>Bead brands<select value={brand} onChange={(event) => { setBrand(event.target.value); setBackgroundId("empty"); }}><option value="PERLER">Perler</option><option value="ARTKAL">Artkal</option><option value="BOTH">Perler + Artkal</option></select></label>
        <label>Maximum generated colors <span className="field-value">{maxColors}</span><input type="range" min="1" max="32" value={maxColors} onChange={(event) => setMaxColors(Number(event.target.value))} /></label>
        <label>Source type<select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}><option value="photo">Photo (smooth sampling)</option><option value="pixel-art">Pixel art (crisp sampling)</option></select></label>
        <label>Transparent areas<select value={backgroundId} onChange={(event) => setBackgroundId(event.target.value)}><option value="empty">Leave empty / no bead</option>{eligible.map((bead) => <option key={bead.id} value={bead.id}>{bead.brand}: {bead.name} ({bead.code})</option>)}</select></label>
        <details className="palette-details"><summary>Allowed colors <span>{eligible.length} available</span></summary><p>Turn off colors you do not own. They will not be used in automatic matching.</p><div className="palette-list">{catalogue.filter((bead) => bead.rgb && (brand === "BOTH" || bead.brand === brand)).map((bead) => <label key={bead.id} className={disabledIds.includes(bead.id) ? "palette-item is-disabled" : "palette-item"}><input type="checkbox" checked={!disabledIds.includes(bead.id)} onChange={() => toggleDisabled(bead.id)} /><Swatch bead={bead} /><span>{bead.name}</span><small>{bead.code}</small></label>)}</div></details>
        <button className="primary-button" type="button" onClick={generate} disabled={isGenerating || !preparation.sourceUrl || eligible.length === 0}>{isGenerating ? "Generating..." : "Generate pattern"}</button><p className="status-message" role="status">{message}</p>
      </aside>
      <div className="main-workspace"><ImageCropWorkspace value={preparation} onChange={setPreparation} boardWidth={width} boardHeight={height} /><section className="pattern-card" aria-labelledby="pattern-heading"><div className="pattern-toolbar"><div><p className="eyebrow">02. Review</p><h2 id="pattern-heading">Your bead pattern</h2></div><div className="segmented" aria-label="Pattern preview style"><button type="button" className={previewStyle === "bead" ? "active" : ""} onClick={() => setPreviewStyle("bead")}>Bead view</button><button type="button" className={previewStyle === "pixel" ? "active" : ""} onClick={() => setPreviewStyle("pixel")}>Pixel view</button></div></div>
        {pattern ? <div className="pattern-preview-wrap"><div className={previewStyle === "bead" ? "pattern-grid bead-grid" : "pattern-grid"} style={{ gridTemplateColumns: `repeat(${pattern.width}, minmax(0, 1fr))` }} aria-label={`${pattern.width} by ${pattern.height} bead pattern`}>{pattern.cells.map((cell) => { const bead = cell.beadId ? pattern.beadsById.get(cell.beadId) : undefined; return <span key={`${cell.x}-${cell.y}`} className={bead ? "pattern-cell occupied" : "pattern-cell"} style={bead?.html ? { "--bead-color": bead.html } as React.CSSProperties : undefined} title={bead ? `${bead.brand} ${bead.name} (${bead.code})` : "Empty peg"} />; })}</div></div> : <div className="empty-preview"><span className="empty-preview-icon">+</span><p>Your generated pattern will appear here.</p><small>Transparent areas remain empty unless you choose a background bead.</small></div>}</section></div>
      <aside className="materials-panel"><div className="panel-heading"><p className="eyebrow">03. Materials</p><h2>What you need</h2></div><div className="stat-grid"><div><strong>{totalBeads}</strong><span>beads</span></div><div><strong>{pattern?.emptyPegs ?? 0}</strong><span>empty</span></div><div><strong>{materials.length} / {maxColors}</strong><span>colors</span></div></div><label>Recommended spare <span className="field-value">{sparePercentage}%</span><input type="range" min="0" max="25" step="1" value={sparePercentage} onChange={(event) => setSparePercentage(Number(event.target.value))} /></label>
        {materials.length ? <div className="materials-list">{materials.map((row) => <div className="material-row" key={row.id}><span className="swatch swatch-large" style={{ backgroundColor: row.hex }} /><div><strong>{row.name}</strong><span>{row.brand} {row.code}</span></div><div className="material-count"><strong>{row.requiredQuantity}</strong><span>get {row.recommendedQuantity}</span></div></div>)}</div> : <p className="muted-copy">Generate a pattern to see your exact shopping list.</p>}
        <div className="export-actions"><button type="button" disabled={!exportPattern} onClick={() => void downloadPattern(true)}>PNG with grid</button><button type="button" disabled={!exportPattern} onClick={() => void downloadPattern(false)}>PNG clean</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && downloadBlob(new Blob([materialsToCsv(materials)], { type: "text/csv;charset=utf-8" }), "beadcraftr-materials.csv")}>CSV materials</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && openPrintablePattern(exportPattern, { sparePercentage, title: `BeadCraftr ${width} x ${height} pattern` })}>Print / PDF</button></div>
      </aside>
    </section>
  </main>;
}
