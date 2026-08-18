"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import catalogueCsv from "../perlercolor - Printable.csv?raw";
import { defaultImagePreparation, ImageCropWorkspace, type ImageComparisonMode, type ImagePreparationValue, type SourceImageColorSample } from "./components/ImageCropWorkspace";
import { applyBackgroundMask, normalizeBackgroundMask } from "./lib/background-mask";
import { boardLayout } from "./lib/boards";
import { eligibleBeads, parseCatalogue } from "./lib/catalogue";
import { closestEligibleBead, convertRasterToPattern } from "./lib/conversion";
import { applyImageAdjustments } from "./lib/image-adjustments";
import { buildMaterialsRows, createMaterialsXlsxBlob, createPatternGridXlsxBlob, createPatternPngBlob, downloadBlob, materialsToCsv, openPrintablePattern, patternGridToCsv, type PatternExportModel } from "./lib/exports";
import { floodPatternCells, setPatternCell } from "./lib/pattern-edits";
import { applyCatalogueColorOverrides, createCatalogueColorOverride, emptyPalettePreferences, loadPalettePreferences, parseRgbHex, rgbToHex, savePalettePreferences, type PalettePreferences } from "./lib/palette-preferences";
import { parseProject, serializeProject } from "./lib/projects";
import { suggestColorSubstitutions, substitutePatternColor } from "./lib/substitutions";
import { assignSymbols } from "./lib/symbols";
import type { Bead, ConvertedPattern, DitherMode, RgbaRaster } from "./lib/types";

type SourceType = "photo" | "pixel-art";
type PreviewStyle = "bead" | "pixel" | "symbol";
type EditorTool = "pencil" | "eraser" | "eyedropper" | "fill";
type PrintLayoutMode = "auto" | "single" | "tiled";
const baseCatalogue = parseCatalogue(catalogueCsv);

function readImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = src;
  });
}

function localPaletteStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
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
  const transformedImage = transformedContext.getImageData(0, 0, transformed.width, transformed.height);
  const maskedImage = applyBackgroundMask({ width: transformed.width, height: transformed.height, data: applyImageAdjustments(transformedImage.data, preparation.adjustments) }, preparation.backgroundMask);
  transformedContext.putImageData(new ImageData(maskedImage.data, maskedImage.width, maskedImage.height), 0, 0);
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

function toExportPattern(pattern: ConvertedPattern, maxColorDepth: number, inventory: ReadonlyMap<string, number>, symbols: ReadonlyMap<string, string>): PatternExportModel {
  return { width: pattern.width, height: pattern.height, metadata: { maxColorDepth, boardWidth: 29, boardHeight: 29, inventoryByBeadId: Object.fromEntries(inventory), symbolsByBeadId: Object.fromEntries(symbols) }, cells: Array.from({ length: pattern.height }, (_, y) => Array.from({ length: pattern.width }, (_, x) => {
    const cell = pattern.cells[y * pattern.width + x];
    const bead = cell.beadId ? pattern.beadsById.get(cell.beadId) : undefined;
    return bead?.html ? { id: bead.id, brand: bead.brand, code: bead.code, name: bead.name, hex: bead.html, symbol: symbols.get(bead.id) } : null;
  })) };
}

function Swatch({ bead }: { bead: Bead }) { return <span className="swatch" style={{ backgroundColor: bead.html ?? "transparent" }} aria-hidden="true" />; }

export default function Home() {
  const [preparation, setPreparation] = useState(defaultImagePreparation);
  const [width, setWidth] = useState(29); const [height, setHeight] = useState(29);
  const [brand, setBrand] = useState("PERLER"); const [disabledIds, setDisabledIds] = useState<string[]>([]);
  const [maxColors, setMaxColors] = useState(16); const [backgroundId, setBackgroundId] = useState("empty");
  const [sourceType, setSourceType] = useState<SourceType>("photo"); const [dither, setDither] = useState<DitherMode>("none"); const [sparePercentage, setSparePercentage] = useState(10); const [alphaThreshold, setAlphaThreshold] = useState(128);
  const [previewStyle, setPreviewStyle] = useState<PreviewStyle>("bead"); const [pattern, setPattern] = useState<ConvertedPattern | null>(null);
  const [editorTool, setEditorTool] = useState<EditorTool>("pencil"); const [selectedBeadId, setSelectedBeadId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ConvertedPattern[]>([]); const [redoStack, setRedoStack] = useState<ConvertedPattern[]>([]);
  const [includeSourceInProject, setIncludeSourceInProject] = useState(true);
  const [comparisonMode, setComparisonMode] = useState<ImageComparisonMode>("adjusted");
  const [inventory, setInventory] = useState<Map<string, number>>(new Map());
  const [savedSymbols, setSavedSymbols] = useState<Map<string, string>>(new Map());
  const [showBoardBoundaries, setShowBoardBoundaries] = useState(true);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [recentBeadIds, setRecentBeadIds] = useState<string[]>([]);
  const [rejectedSubstitutions, setRejectedSubstitutions] = useState<Set<string>>(new Set());
  const [replacementBySource, setReplacementBySource] = useState<Record<string, string>>({});
  const [palettePreferences, setPalettePreferences] = useState<PalettePreferences>(emptyPalettePreferences);
  const [palettePreferencesReady, setPalettePreferencesReady] = useState(false);
  const [specialtyHexDrafts, setSpecialtyHexDrafts] = useState<Record<string, string>>({});
  const [printLayout, setPrintLayout] = useState<PrintLayoutMode>("auto"); const [printOverlap, setPrintOverlap] = useState(1);
  const [patternZoom, setPatternZoom] = useState(100);
  const patternRef = useRef<ConvertedPattern | null>(null); const isPainting = useRef(false);
  const [message, setMessage] = useState("Upload an image, set your board, then generate a local pattern."); const [isGenerating, setIsGenerating] = useState(false);
  const catalogue = useMemo(() => applyCatalogueColorOverrides(baseCatalogue, palettePreferences.colorOverrides), [palettePreferences.colorOverrides]);
  const eligible = useMemo(() => eligibleBeads(catalogue, brand, new Set(disabledIds)), [brand, catalogue, disabledIds]);
  const symbolByBeadId = useMemo(() => pattern ? assignSymbols(pattern.counts.keys(), savedSymbols) : new Map<string, string>(), [pattern, savedSymbols]);
  const exportPattern = useMemo(() => pattern ? toExportPattern(pattern, maxColors, inventory, symbolByBeadId) : null, [inventory, maxColors, pattern, symbolByBeadId]);
  const materials = useMemo(() => exportPattern ? buildMaterialsRows(exportPattern, sparePercentage) : [], [exportPattern, sparePercentage]);
  const substitutionSuggestions = useMemo(() => pattern ? suggestColorSubstitutions(pattern, 3, new Set(eligible.map((bead) => bead.id))).filter((suggestion) => !rejectedSubstitutions.has(`${suggestion.fromId}:${suggestion.toId}`)) : [], [eligible, pattern, rejectedSubstitutions]);
  const selectedEditorBead = useMemo(() => selectedBeadId ? pattern?.beadsById.get(selectedBeadId) ?? eligible.find((bead) => bead.id === selectedBeadId) : undefined, [eligible, pattern, selectedBeadId]);
  const physicalBoards = useMemo(() => boardLayout(pattern?.width ?? width, pattern?.height ?? height), [height, pattern?.height, pattern?.width, width]);
  const boardLabelByOrigin = useMemo(() => new Map(physicalBoards.tiles.map((tile) => [`${tile.x}:${tile.y}`, tile.label])), [physicalBoards]);
  const recentBeads = useMemo(() => recentBeadIds.map((id) => pattern?.beadsById.get(id) ?? eligible.find((bead) => bead.id === id)).filter((bead): bead is Bead => Boolean(bead)), [eligible, pattern, recentBeadIds]);
  const totalBeads = materials.reduce((sum, row) => sum + row.requiredQuantity, 0);
  const overColorLimit = Boolean(pattern && pattern.counts.size > maxColors);
  const paletteRows = useMemo(() => catalogue.filter((bead) => bead.rgb && (brand === "BOTH" || bead.brand === brand)).sort((first, second) => Number(palettePreferences.favoriteBeadIds.includes(second.id)) - Number(palettePreferences.favoriteBeadIds.includes(first.id)) || first.name.localeCompare(second.name)), [brand, catalogue, palettePreferences.favoriteBeadIds]);
  const specialtyRows = useMemo(() => baseCatalogue.filter((bead) => !bead.rgb && (brand === "BOTH" || bead.brand === brand)), [brand]);
  useEffect(() => {
    const timeout = window.setTimeout(() => { setPalettePreferences(loadPalettePreferences(localPaletteStorage(), baseCatalogue)); setPalettePreferencesReady(true); }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (palettePreferencesReady) savePalettePreferences(localPaletteStorage(), palettePreferences);
  }, [palettePreferences, palettePreferencesReady]);
  const updateDimension = (setter: (value: number) => void, value: string) => {
    const parsed = Number.parseInt(value, 10);
    setter(Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1);
  };
  const toggleDisabled = (id: string) => setDisabledIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleFavorite = (id: string) => setPalettePreferences((current) => ({ ...current, favoriteBeadIds: current.favoriteBeadIds.includes(id) ? current.favoriteBeadIds.filter((item) => item !== id) : [...current.favoriteBeadIds, id] }));
  const applySpecialtyColor = (id: string) => {
    const rgb = parseRgbHex(specialtyHexDrafts[id] ?? "");
    if (!rgb) { setMessage("Enter a six-digit hex color such as #1A2B3C."); return; }
    try {
      const override = createCatalogueColorOverride(baseCatalogue, id, rgb);
      setPalettePreferences((current) => ({ ...current, colorOverrides: [...current.colorOverrides.filter((item) => item.beadId !== id), override] }));
      setMessage(`Added the confirmed specialty color ${rgbToHex(rgb)} to your local palette.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "That specialty color could not be saved."); }
  };
  const removeSpecialtyColor = (id: string) => {
    setPalettePreferences((current) => ({ ...current, colorOverrides: current.colorOverrides.filter((item) => item.beadId !== id), favoriteBeadIds: current.favoriteBeadIds.filter((item) => item !== id), editorAddedBeadIds: current.editorAddedBeadIds.filter((item) => item !== id), lastSelectedBeadId: current.lastSelectedBeadId === id ? null : current.lastSelectedBeadId }));
    setSpecialtyHexDrafts((current) => ({ ...current, [id]: "" }));
    setDisabledIds((current) => current.filter((item) => item !== id));
    setMessage("Removed the local specialty color value. The original unknown catalogue row remains unchanged.");
  };
  const selectEditorBead = (id: string | null) => {
    setSelectedBeadId(id);
    if (id) setRecentBeadIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, 6));
    setPalettePreferences((current) => ({ ...current, lastSelectedBeadId: id, editorAddedBeadIds: id && !current.editorAddedBeadIds.includes(id) ? [...current.editorAddedBeadIds, id] : current.editorAddedBeadIds }));
    setEditorTool("pencil");
  };
  const updateInventory = (id: string, value: string) => {
    const quantity = Math.max(0, Number.parseInt(value, 10) || 0);
    setInventory((current) => new Map(current).set(id, quantity));
  };
  const sampleSourceColor = (sample: SourceImageColorSample) => {
    const bead = closestEligibleBead(sample.rgb, catalogue, { brand, disabledBeadIds: new Set(disabledIds) });
    if (!bead) { setMessage("No enabled bead color is available for that sample."); return; }
    selectEditorBead(bead.id);
    setMessage(`Selected the closest bead to the source pixel: ${bead.brand} ${bead.name} (${bead.code}).`);
  };
  const replacePattern = (next: ConvertedPattern, recordHistory = true) => {
    const current = patternRef.current;
    if (!current || current === next) return;
    if (recordHistory) {
      setUndoStack((history) => [...history, current].slice(-100));
      setRedoStack([]);
    }
    patternRef.current = next;
    setPattern(next);
    setSavedSymbols((current) => assignSymbols(next.counts.keys(), current));
    if (recordHistory) setHasManualEdits(true);
  };
  const editCell = (x: number, y: number) => {
    const current = patternRef.current;
    if (!current) return;
    const cell = current.cells[y * current.width + x];
    if (editorTool === "eyedropper") {
      if (cell?.beadId) selectEditorBead(cell.beadId);
      else setEditorTool("pencil");
      return;
    }
    const beadId = editorTool === "eraser" ? null : selectedBeadId;
    if (editorTool === "pencil" && !beadId) {
      setMessage("Choose a bead color before using the pencil.");
      return;
    }
    replacePattern(editorTool === "fill" ? floodPatternCells(current, x, y, beadId) : setPatternCell(current, x, y, beadId));
  };
  const undo = () => {
    const current = patternRef.current; const previous = undoStack.at(-1);
    if (!current || !previous) return;
    setUndoStack((history) => history.slice(0, -1)); setRedoStack((history) => [...history, current].slice(-100));
    patternRef.current = previous; setPattern(previous); setSavedSymbols((symbols) => assignSymbols(previous.counts.keys(), symbols));
  };
  const redo = () => {
    const current = patternRef.current; const following = redoStack.at(-1);
    if (!current || !following) return;
    setRedoStack((history) => history.slice(0, -1)); setUndoStack((history) => [...history, current].slice(-100));
    patternRef.current = following; setPattern(following); setSavedSymbols((symbols) => assignSymbols(following.counts.keys(), symbols));
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  const generate = async () => {
    if (pattern && hasManualEdits && !window.confirm("Generate a new pattern and replace your manual peg edits? You can save the project first if you want to keep them.")) return;
    try {
      setIsGenerating(true); setMessage("Preparing your image and matching it to real bead colors...");
      const raster = await rasterFromPreparation(preparation, width, height, sourceType);
      const next = convertRasterToPattern(raster, catalogue, { width, height, brand, disabledBeadIds: new Set(disabledIds), maxColors, alphaThreshold, dither, background: backgroundId === "empty" ? { kind: "empty" } : { kind: "bead", beadId: backgroundId } });
      patternRef.current = next; setPattern(next); setUndoStack([]); setRedoStack([]); setHasManualEdits(false); setRejectedSubstitutions(new Set()); setSavedSymbols((current) => assignSymbols(next.counts.keys(), current)); selectEditorBead((palettePreferences.lastSelectedBeadId && eligible.some((bead) => bead.id === palettePreferences.lastSelectedBeadId) ? palettePreferences.lastSelectedBeadId : null) ?? next.counts.keys().next().value ?? eligible[0]?.id ?? null); setMessage(`Pattern ready: ${next.width} x ${next.height} pegs, ${next.emptyPegs} empty.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The pattern could not be generated."); } finally { setIsGenerating(false); }
  };
  const saveProject = () => {
    if (!pattern) return;
    const text = serializeProject({ width, height, settings: { brand, disabledIds, maxColors, backgroundId, sourceType, dither, sparePercentage, alphaThreshold }, preparation, includeSourceImage: includeSourceInProject, pattern, inventory, symbols: symbolByBeadId, palettePreferences, backgroundMask: preparation.backgroundMask as unknown as Record<string, unknown> });
    downloadBlob(new Blob([text], { type: "application/json;charset=utf-8" }), "beadcraftr-project.json");
  };
  const openProject = async (file: File | undefined) => {
    if (!file) return;
    try {
      const loaded = parseProject(await file.text(), baseCatalogue);
      setWidth(loaded.width); setHeight(loaded.height); setBrand(loaded.settings.brand); setDisabledIds(loaded.settings.disabledIds); setMaxColors(loaded.settings.maxColors); setBackgroundId(loaded.settings.backgroundId); setSourceType(loaded.settings.sourceType); setDither(loaded.settings.dither); setSparePercentage(loaded.settings.sparePercentage); setAlphaThreshold(loaded.settings.alphaThreshold ?? 128); setPalettePreferences(loaded.palettePreferences);
      if (loaded.preparation && typeof loaded.preparation === "object") setPreparation({ ...defaultImagePreparation, ...(loaded.preparation as ImagePreparationValue), backgroundMask: normalizeBackgroundMask((loaded.preparation as Partial<ImagePreparationValue>).backgroundMask ?? loaded.backgroundMask) });
      patternRef.current = loaded.pattern; setPattern(loaded.pattern); setInventory(new Map(loaded.inventory)); setSavedSymbols(new Map(loaded.symbols)); setUndoStack([]); setRedoStack([]); setHasManualEdits(true); selectEditorBead((loaded.palettePreferences.lastSelectedBeadId && loaded.pattern.beadsById.has(loaded.palettePreferences.lastSelectedBeadId) ? loaded.palettePreferences.lastSelectedBeadId : null) ?? loaded.pattern.counts.keys().next().value ?? null);
      setMessage(loaded.sourceEmbedded ? "Project opened. Its final grid and source image are ready." : "Project opened. Its final grid is ready; the source image was not embedded, so upload it again before regenerating.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The project could not be opened."); }
  };
  const downloadPattern = async (includeGrid: boolean) => {
    if (!exportPattern) return;
    downloadBlob(await createPatternPngBlob(exportPattern, { includeGrid, style: previewStyle === "bead" ? "bead" : "pixel", cellSize: 24 }), `beadcraftr-${width}x${height}${includeGrid ? "-grid" : ""}.png`);
  };
  const printPattern = () => {
    if (!exportPattern) return;
    try {
      openPrintablePattern(exportPattern, { sparePercentage, title: `BeadCraftr ${width} x ${height} pattern`, layout: printLayout, overlap: printOverlap });
      setMessage("Opened a pixel-grid print view with tile instructions and the complete color list. Choose Print / Save as PDF there.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The printable pattern could not be opened."); }
  };
  return <main className="site-shell">
    <header className="topbar"><a className="brand" href="#workspace" aria-label="BeadCraftr home"><span className="brand-mark">BC</span><span>BeadCraftr</span></a><p>Turn an image into a pattern you can actually make.</p><span className="local-badge">Local in your browser</span></header>
    <section className="hero" aria-labelledby="page-title"><div><p className="eyebrow">Fuse bead pattern studio</p><h1 id="page-title">Make the picture. Count every bead.</h1><p className="hero-copy">Crop your image, choose the beads you have, and get a clear 29 x 29 pattern with a ready-to-shop materials list.</p></div><div className="hero-art" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <span key={index} className={`hero-bead hero-bead-${index % 5}`} />)}</div></section>
    <section id="workspace" className="workspace" aria-label="Pattern generator">
      <aside className="controls-panel"><div className="panel-heading"><p className="eyebrow">01. Configure</p><h2>Your board & beads</h2></div><div className="control-grid two-columns"><label>Width <input type="number" min="1" value={width} onChange={(event) => updateDimension(setWidth, event.target.value)} /></label><label>Height <input type="number" min="1" value={height} onChange={(event) => updateDimension(setHeight, event.target.value)} /></label></div><p className="control-note">Default Perler board: 29 x 29 pegs. Large boards may take longer to generate.</p>
        <label>Bead brands<select value={brand} onChange={(event) => { setBrand(event.target.value); setBackgroundId("empty"); }}><option value="PERLER">Perler</option><option value="ARTKAL">Artkal</option><option value="BOTH">Perler + Artkal</option></select></label>
        <label>Maximum generated colors <span className="field-value">{maxColors}</span><input type="range" min="1" max="32" value={maxColors} onChange={(event) => setMaxColors(Number(event.target.value))} /></label>
        <label>Source type<select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}><option value="photo">Photo (smooth sampling)</option><option value="pixel-art">Pixel art (crisp sampling)</option></select></label>
        <label>Dithering<select value={dither} onChange={(event) => setDither(event.target.value as DitherMode)}><option value="none">None (clean pixel art)</option><option value="floyd-steinberg">Floyd-Steinberg (photo shading)</option><option value="ordered">Ordered / Bayer (structured texture)</option></select></label>
        <label>Alpha cutoff <span className="field-value">{Math.round(alphaThreshold / 255 * 100)}%</span><input type="range" min="0" max="255" step="1" value={alphaThreshold} onChange={(event) => setAlphaThreshold(Number(event.target.value))} /></label>
        <label>Transparent areas<select value={backgroundId} onChange={(event) => setBackgroundId(event.target.value)}><option value="empty">Leave empty / no bead</option>{eligible.map((bead) => <option key={bead.id} value={bead.id}>{bead.brand}: {bead.name} ({bead.code})</option>)}</select></label>
        <details className="palette-details"><summary>Allowed colors <span>{eligible.length} available</span></summary><p>Turn off colors you do not own. Favorites stay at the top and are saved on this device.</p><div className="palette-list">{paletteRows.map((bead) => <label key={bead.id} className={disabledIds.includes(bead.id) ? "palette-item is-disabled" : "palette-item"}><input type="checkbox" checked={!disabledIds.includes(bead.id)} onChange={() => toggleDisabled(bead.id)} /><Swatch bead={bead} /><span>{bead.name}</span><small>{bead.code}</small><button type="button" className={palettePreferences.favoriteBeadIds.includes(bead.id) ? "favorite-button active" : "favorite-button"} aria-label={`${palettePreferences.favoriteBeadIds.includes(bead.id) ? "Remove" : "Add"} ${bead.name} ${palettePreferences.favoriteBeadIds.includes(bead.id) ? "from" : "to"} favorites`} title="Favorite color" onClick={(event) => { event.preventDefault(); toggleFavorite(bead.id); }}>{palettePreferences.favoriteBeadIds.includes(bead.id) ? "★" : "☆"}</button></label>)}</div></details>
        <details className="palette-details specialty-details"><summary>Specialty color values <span>{palettePreferences.colorOverrides.length} added</span></summary><p>These catalogue rows do not have published RGB values. Enter a verified six-digit hex value to make one eligible; BeadCraftr never guesses it.</p><div className="specialty-list">{specialtyRows.map((bead) => { const override = palettePreferences.colorOverrides.find((item) => item.beadId === bead.id); const value = specialtyHexDrafts[bead.id] ?? (override ? rgbToHex(override.rgb) : ""); return <div key={bead.id} className="specialty-row"><div><strong>{bead.name}</strong><span>{bead.brand} {bead.code}</span></div><input aria-label={`Hex color for ${bead.name}`} placeholder="#RRGGBB" value={value} onChange={(event) => setSpecialtyHexDrafts((current) => ({ ...current, [bead.id]: event.target.value }))} /><button type="button" onClick={() => applySpecialtyColor(bead.id)}>{override ? "Update" : "Add"}</button>{override && <button type="button" onClick={() => removeSpecialtyColor(bead.id)}>Remove</button>}</div>; })}</div><button type="button" className="reset-preferences" onClick={() => { setPalettePreferences(emptyPalettePreferences()); setSpecialtyHexDrafts({}); setMessage("Reset local palette favorites and specialty color values."); }}>Reset palette preferences</button></details>
        <button className="primary-button" type="button" onClick={generate} disabled={isGenerating || !preparation.sourceUrl || eligible.length === 0}>{isGenerating ? "Generating..." : "Generate pattern"}</button><p className="status-message" role="status">{message}</p>
      </aside>
      <div className="main-workspace"><ImageCropWorkspace value={preparation} onChange={setPreparation} boardWidth={width} boardHeight={height} comparisonMode={comparisonMode} onComparisonModeChange={setComparisonMode} onSourceColorSample={sampleSourceColor} /><section className="pattern-card" aria-labelledby="pattern-heading"><div className="pattern-toolbar"><div><p className="eyebrow">02. Review</p><h2 id="pattern-heading">Your bead pattern</h2></div><div className="segmented" aria-label="Pattern preview style"><button type="button" className={previewStyle === "bead" ? "active" : ""} onClick={() => setPreviewStyle("bead")}>Bead view</button><button type="button" className={previewStyle === "pixel" ? "active" : ""} onClick={() => setPreviewStyle("pixel")}>Pixel view</button><button type="button" className={previewStyle === "symbol" ? "active" : ""} onClick={() => setPreviewStyle("symbol")}>Symbols</button></div></div>
        {pattern ? <>
          <div className="editor-toolbar" aria-label="Pattern editor">
            <div className="tool-buttons"><button type="button" className={editorTool === "pencil" ? "active" : ""} onClick={() => setEditorTool("pencil")}>Pencil</button><button type="button" className={editorTool === "eraser" ? "active" : ""} onClick={() => setEditorTool("eraser")}>Eraser</button><button type="button" className={editorTool === "eyedropper" ? "active" : ""} onClick={() => setEditorTool("eyedropper")}>Pattern eyedropper</button><button type="button" className={editorTool === "fill" ? "active" : ""} onClick={() => setEditorTool("fill")}>Fill</button></div>
            <label>Bead color<span className="editor-color-select">{selectedEditorBead ? <Swatch bead={selectedEditorBead} /> : <span className="editor-color-empty" aria-hidden="true" />}<select value={selectedBeadId ?? ""} onChange={(event) => selectEditorBead(event.target.value || null)}><option value="">Choose a color</option>{eligible.map((bead) => <option key={bead.id} value={bead.id}>{bead.brand}: {bead.name} ({bead.code}) — {pattern.counts.get(bead.id) ?? 0}</option>)}</select></span></label>
            <div className="history-buttons"><button type="button" disabled={!undoStack.length} onClick={undo}>Undo</button><button type="button" disabled={!redoStack.length} onClick={redo}>Redo</button></div>
          </div>
          {recentBeads.length > 0 && <div className="recent-colors"><span>Recent:</span>{recentBeads.map((bead) => <button type="button" key={bead.id} title={`${bead.brand} ${bead.name}`} onClick={() => selectEditorBead(bead.id)}><Swatch bead={bead} />{bead.name}</button>)}</div>}
          <div className="board-options"><label><input type="checkbox" checked={showBoardBoundaries} onChange={(event) => setShowBoardBoundaries(event.target.checked)} /> Show 29 × 29 board boundaries</label><span>{physicalBoards.count} physical board{physicalBoards.count === 1 ? "" : "s"} ({physicalBoards.columns} across × {physicalBoards.rows} down)</span></div>
          <div className="pattern-zoom" role="group" aria-label="Pattern zoom"><span>Pattern zoom</span><button type="button" onClick={() => setPatternZoom((current) => Math.max(25, current - 25))} disabled={patternZoom <= 25} aria-label="Zoom pattern out">−</button><input type="range" min="25" max="400" step="25" value={patternZoom} onChange={(event) => setPatternZoom(Number(event.target.value))} aria-label="Pattern zoom percentage" /><button type="button" onClick={() => setPatternZoom((current) => Math.min(400, current + 25))} disabled={patternZoom >= 400} aria-label="Zoom pattern in">+</button><button type="button" onClick={() => setPatternZoom(100)}>Reset</button><strong>{patternZoom}%</strong></div>
          {overColorLimit && <p className="phase-warning" role="status">Manual edits now use {pattern.counts.size} colors, above the generated limit of {maxColors}. The pattern is valid, but the materials list and exports include every used color.</p>}
          {substitutionSuggestions.length > 0 && <div className="substitution-suggestions"><strong>Optional color merges</strong>{substitutionSuggestions.map((suggestion) => { const from = pattern.beadsById.get(suggestion.fromId); const suggested = pattern.beadsById.get(suggestion.toId); const selectedReplacement = replacementBySource[suggestion.fromId] ?? suggestion.toId; return from && suggested ? <div key={`${suggestion.fromId}-${suggestion.toId}`}><span><Swatch bead={from} /> Replace {suggestion.quantity} {from.name} with <Swatch bead={suggested} /> {suggested.name} ({suggestion.label}, Δ {suggestion.distance.toFixed(1)})</span><div className="substitution-actions"><select aria-label={`Replacement for ${from.name}`} value={selectedReplacement} onChange={(event) => setReplacementBySource((current) => ({ ...current, [suggestion.fromId]: event.target.value }))}>{eligible.filter((bead) => bead.id !== suggestion.fromId).map((bead) => <option key={bead.id} value={bead.id}>{bead.brand}: {bead.name}</option>)}</select><button type="button" onClick={() => replacePattern(substitutePatternColor(pattern, suggestion.fromId, selectedReplacement))}>Merge</button><button type="button" onClick={() => setRejectedSubstitutions((current) => new Set(current).add(`${suggestion.fromId}:${suggestion.toId}`))}>Dismiss</button></div></div> : null; })}</div>}
          <div className="pattern-preview-wrap" style={{ justifyItems: patternZoom > 100 ? "start" : "center" }}><div className={`${previewStyle === "bead" ? "pattern-grid bead-grid" : "pattern-grid"} ${previewStyle === "symbol" ? "symbol-grid" : ""}`} style={{ gridTemplateColumns: `repeat(${pattern.width}, minmax(0, 1fr))`, aspectRatio: `${pattern.width} / ${pattern.height}`, width: `${patternZoom}%` }} aria-label={`${pattern.width} by ${pattern.height} bead pattern at ${patternZoom}% zoom`} onPointerUp={() => { isPainting.current = false; }} onPointerLeave={() => { isPainting.current = false; }}>{pattern.cells.map((cell) => { const bead = cell.beadId ? pattern.beadsById.get(cell.beadId) : undefined; const label = bead ? `${bead.brand} ${bead.name} (${bead.code})` : "Empty peg"; const boundaryClasses = `${showBoardBoundaries && cell.x > 0 && cell.x % 29 === 0 ? " board-boundary-left" : ""}${showBoardBoundaries && cell.y > 0 && cell.y % 29 === 0 ? " board-boundary-top" : ""}`; const boardLabel = showBoardBoundaries ? boardLabelByOrigin.get(`${cell.x}:${cell.y}`) : undefined; return <button type="button" key={`${cell.x}-${cell.y}`} className={`${bead ? "pattern-cell occupied" : "pattern-cell"}${boundaryClasses}`} style={bead?.html ? { "--bead-color": bead.html } as React.CSSProperties : undefined} title={label} aria-label={label} onPointerDown={(event) => { event.preventDefault(); isPainting.current = true; editCell(cell.x, cell.y); }} onPointerEnter={() => { if (isPainting.current && (editorTool === "pencil" || editorTool === "eraser")) editCell(cell.x, cell.y); }}>{boardLabel && <span className="board-label">{boardLabel}</span>}{previewStyle === "symbol" && (bead ? symbolByBeadId.get(bead.id) : "·")}</button>; })}</div></div>
          {previewStyle === "symbol" && <div className="symbol-key">{[...symbolByBeadId.entries()].map(([id, symbol]) => { const bead = pattern.beadsById.get(id); return bead ? <span key={id}><b>{symbol}</b><Swatch bead={bead} />{bead.brand} {bead.name} ({pattern.counts.get(id)})</span> : null; })}</div>}
        </> : <div className="empty-preview"><span className="empty-preview-icon">+</span><p>Your generated pattern will appear here.</p><small>Transparent areas remain empty unless you choose a background bead.</small></div>}</section></div>
      <aside className="materials-panel"><div className="panel-heading"><p className="eyebrow">03. Materials</p><h2>What you need</h2></div><div className="stat-grid"><div><strong>{pattern ? pattern.width * pattern.height : 0}</strong><span>pegs</span></div><div><strong>{totalBeads}</strong><span>beads</span></div><div><strong>{pattern?.emptyPegs ?? 0}</strong><span>empty</span></div><div><strong>{materials.length} / {maxColors}</strong><span>colors</span></div></div><label>Recommended spare <span className="field-value">{sparePercentage}%</span><input type="range" min="0" max="25" step="1" value={sparePercentage} onChange={(event) => setSparePercentage(Number(event.target.value))} /></label>
        {materials.length ? <div className="materials-list">{materials.map((row) => <div className="material-row" key={row.id}><span className="swatch swatch-large" style={{ backgroundColor: row.hex }} /><div><strong>{row.symbol ? `${row.symbol} · ` : ""}{row.name}</strong><span>{row.brand} {row.code}</span><label className="inventory-field">On hand <input type="number" min="0" value={inventory.get(row.id) ?? 0} onChange={(event) => updateInventory(row.id, event.target.value)} /></label></div><div className="material-count"><strong>{row.requiredQuantity}</strong><span>recommend {row.recommendedQuantity}</span><em>buy {row.quantityToBuy}</em></div></div>)}</div> : <p className="muted-copy">Generate a pattern to see your exact shopping list.</p>}
        <div className="print-options"><label>Print layout<select value={printLayout} onChange={(event) => setPrintLayout(event.target.value as PrintLayoutMode)}><option value="auto">Auto (tile large patterns)</option><option value="tiled">Always tile by board</option><option value="single">Single page</option></select></label><label>Tile overlap<input type="number" min="0" max="8" value={printOverlap} onChange={(event) => setPrintOverlap(Math.max(0, Math.min(8, Number.parseInt(event.target.value, 10) || 0)))} /> pegs</label></div>
        <p className="print-help">The print view always uses solid pixel squares, includes exact and recommended color quantities, and can be printed or saved as a PDF. Large patterns can span labeled pages with alignment marks.</p>
        <div className="export-actions"><button type="button" disabled={!exportPattern} onClick={() => void downloadPattern(true)}>PNG with grid</button><button type="button" disabled={!exportPattern} onClick={() => void downloadPattern(false)}>PNG clean</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && downloadBlob(new Blob([materialsToCsv(materials)], { type: "text/csv;charset=utf-8" }), "beadcraftr-materials.csv")}>CSV materials</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && downloadBlob(new Blob([patternGridToCsv(exportPattern)], { type: "text/csv;charset=utf-8" }), "beadcraftr-pattern-grid.csv")}>CSV grid</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && downloadBlob(createMaterialsXlsxBlob(materials), "beadcraftr-materials.xlsx")}>Excel materials</button><button type="button" disabled={!exportPattern} onClick={() => exportPattern && downloadBlob(createPatternGridXlsxBlob(exportPattern), "beadcraftr-pattern-grid.xlsx")}>Excel grid</button><button type="button" disabled={!exportPattern} onClick={printPattern}>Print / Save PDF</button><button type="button" disabled={!pattern} onClick={saveProject}>Save project</button><label className="project-open">Open project<input type="file" accept="application/json,.json" onChange={(event) => void openProject(event.target.files?.[0])} /></label></div><label className="project-source"><input type="checkbox" checked={includeSourceInProject} onChange={(event) => setIncludeSourceInProject(event.target.checked)} /> Include uploaded image when saving</label><p className="control-note">Including the source makes the project larger, but preserves crop and regeneration. Without it, the final editable grid still reopens.</p>
      </aside>
    </section>
  </main>;
}
