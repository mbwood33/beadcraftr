"use client";
import { ChangeEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { applyImageAdjustments, defaultImageAdjustments, type ImageAdjustments } from "../lib/image-adjustments";
import { defaultBackgroundMask, resolveBackgroundMask, type BackgroundMaskSettings, type MaskBrushMode, type MaskBrushStroke } from "../lib/background-mask";

export type FitMode = "cover" | "contain";
export type PaddingAlignment = "top-left" | "center";
export type ImageComparisonMode = "original" | "cropped" | "adjusted" | "mask";

export type SourceImageColorSample = {
  /** The sampled prepared pixel, suitable for closestEligibleBead. */
  rgb: { r: number; g: number; b: number };
  alpha: number;
  /** Zero-based pixel position in the transformed prepared source. */
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
  mode: Exclude<ImageComparisonMode, "mask">;
};

export type CropRect = {
  /** Percentages in unrotated source-image coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImagePreparationValue = {
  /** Browser-local data URL. This is never uploaded by this component. */
  sourceUrl: string | null;
  fileName: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  crop: CropRect;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  fitMode: FitMode;
  paddingAlignment: PaddingAlignment;
  lockAspectRatio: boolean;
  adjustments: ImageAdjustments;
  /** Local-only background-removal configuration and normalized refinement strokes. */
  backgroundMask: BackgroundMaskSettings;
};

/** Alias used by the app-level conversion pipeline. */
export type PreparedImage = ImagePreparationValue;

export const defaultImagePreparation: ImagePreparationValue = {
  sourceUrl: null,
  fileName: null,
  sourceWidth: null,
  sourceHeight: null,
  crop: { x: 0, y: 0, width: 100, height: 100 },
  zoom: 1,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  fitMode: "cover",
  paddingAlignment: "top-left",
  lockAspectRatio: true,
  adjustments: defaultImageAdjustments,
  backgroundMask: defaultBackgroundMask,
};

type Props = {
  value: ImagePreparationValue;
  onChange: (value: ImagePreparationValue) => void;
  /** Convenience callback for consumers that only need the prepared-image payload. */
  onPreparedImageChange?: (image: PreparedImage | null) => void;
  /** Controlled when supplied; omit it to let the component retain the selected tab. */
  comparisonMode?: ImageComparisonMode;
  onComparisonModeChange?: (mode: ImageComparisonMode) => void;
  /** Receives browser-local RGB data only; matching it to a bead remains parent-owned. */
  onSourceColorSample?: (sample: SourceImageColorSample) => void;
  boardWidth?: number;
  boardHeight?: number;
  disabled?: boolean;
  className?: string;
};

type DragAction = "move" | "nw" | "ne" | "sw" | "se";
type DragState = { action: DragAction; startX: number; startY: number; crop: CropRect };

const MIN_CROP = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function transformedAspect(value: Pick<ImagePreparationValue, "sourceWidth" | "sourceHeight" | "rotation">): number {
  if (!value.sourceWidth || !value.sourceHeight) return 1;
  return value.rotation === 90 || value.rotation === 270
    ? value.sourceHeight / value.sourceWidth
    : value.sourceWidth / value.sourceHeight;
}

export function normalizeCrop(crop: CropRect, lockAspectRatio: boolean, boardRatio: number, imageAspect = 1): CropRect {
  let width = clamp(crop.width, MIN_CROP, 100);
  let height = clamp(crop.height, MIN_CROP, 100);
  if (lockAspectRatio && boardRatio > 0 && imageAspect > 0) {
    height = (width * imageAspect) / boardRatio;
    if (height > 100) {
      height = 100;
      width = (height * boardRatio) / imageAspect;
    }
  }
  const x = clamp(crop.x, 0, 100 - width);
  const y = clamp(crop.y, 0, 100 - height);
  return { x, y, width, height };
}

function centeredCrop(boardRatio: number, imageAspect: number): CropRect {
  const crop = normalizeCrop({ x: 0, y: 0, width: 100, height: 100 }, true, boardRatio, imageAspect);
  return { ...crop, x: (100 - crop.width) / 2, y: (100 - crop.height) / 2 };
}

/**
 * Client-only image preparation controls. The parent owns the serializable state
 * so it can feed a conversion pipeline or a project file without scraping UI.
 */
export function ImageCropWorkspace({
  value,
  onChange,
  onPreparedImageChange,
  comparisonMode,
  onComparisonModeChange,
  onSourceColorSample,
  boardWidth = 29,
  boardHeight = 29,
  disabled = false,
  className = "",
}: Props) {
  const imageViewportRef = useRef<HTMLDivElement>(null);
  const adjustedCanvasRef = useRef<HTMLCanvasElement>(null);
  const rawCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const maskStrokeRef = useRef<MaskBrushStroke | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uncontrolledComparisonMode, setUncontrolledComparisonMode] = useState<ImageComparisonMode>("adjusted");
  const [isSampling, setIsSampling] = useState(false);
  const [maskBrushMode, setMaskBrushMode] = useState<MaskBrushMode>("remove");
  const [maskBrushSize, setMaskBrushSize] = useState(0.035);
  const [isMaskPainting, setIsMaskPainting] = useState(false);
  const ratio = boardWidth > 0 && boardHeight > 0 ? boardWidth / boardHeight : 1;
  const imageAspect = transformedAspect(value);
  const activeComparisonMode = comparisonMode ?? uncontrolledComparisonMode;

  const renderMaskPreview = () => {
    const sourceCanvas = adjustedCanvasRef.current, maskCanvas = maskCanvasRef.current;
    if (!sourceCanvas || !maskCanvas || !sourceCanvas.width || !sourceCanvas.height) return;
    maskCanvas.width = sourceCanvas.width; maskCanvas.height = sourceCanvas.height;
    const context = maskCanvas.getContext("2d", { willReadFrequently: true });
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!context || !sourceContext) return;
    const image = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const mask = resolveBackgroundMask({ width: sourceCanvas.width, height: sourceCanvas.height, data: image.data }, value.backgroundMask);
    const preview = context.createImageData(maskCanvas.width, maskCanvas.height);
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4; const alpha = mask[index];
      preview.data[offset] = alpha; preview.data[offset + 1] = alpha; preview.data[offset + 2] = alpha; preview.data[offset + 3] = 255;
    }
    context.putImageData(preview, 0, 0);
  };

  useEffect(() => {
    if (!value.sourceUrl || !value.sourceWidth || !value.sourceHeight || !adjustedCanvasRef.current || !rawCanvasRef.current) return;
    const rawCanvas = rawCanvasRef.current;
    const canvas = adjustedCanvasRef.current;
    const quarterTurn = value.rotation === 90 || value.rotation === 270;
    const width = quarterTurn ? value.sourceHeight : value.sourceWidth;
    const height = quarterTurn ? value.sourceWidth : value.sourceHeight;
    rawCanvas.width = width;
    rawCanvas.height = height;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const rawContext = rawCanvas.getContext("2d");
    if (!context || !rawContext) return;
    const image = new Image();
    image.onload = () => {
      rawContext.clearRect(0, 0, rawCanvas.width, rawCanvas.height);
      rawContext.save();
      rawContext.translate(rawCanvas.width / 2, rawCanvas.height / 2);
      rawContext.rotate((value.rotation * Math.PI) / 180);
      rawContext.scale(value.flipHorizontal ? -1 : 1, value.flipVertical ? -1 : 1);
      rawContext.drawImage(image, -value.sourceWidth! / 2, -value.sourceHeight! / 2);
      rawContext.restore();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(rawCanvas, 0, 0);
      const preview = context.getImageData(0, 0, canvas.width, canvas.height);
      preview.data.set(applyImageAdjustments(preview.data, value.adjustments));
      context.putImageData(preview, 0, 0);
      renderMaskPreview();
    };
    image.src = value.sourceUrl;
  // renderMaskPreview intentionally reads current mask state when this image redraws.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.sourceUrl, value.sourceWidth, value.sourceHeight, value.rotation, value.flipHorizontal, value.flipVertical, value.adjustments, activeComparisonMode]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { renderMaskPreview(); }, [value.backgroundMask]); // Mask edits update independently of image transforms.

  // The crop only needs normalization when the board shape changes; including the
  // controlled object here would re-emit it after every parent render.
  useEffect(() => {
    if (value.lockAspectRatio) {
      const nextCrop = normalizeCrop(value.crop, true, ratio, imageAspect);
      if (JSON.stringify(nextCrop) !== JSON.stringify(value.crop)) onChange({ ...value, crop: nextCrop });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardWidth, boardHeight, imageAspect]); // React to board or transformed-image shape changes.

  const emit = (next: ImagePreparationValue) => {
    onChange(next);
    onPreparedImageChange?.(next.sourceUrl ? next : null);
  };
  const update = (patch: Partial<ImagePreparationValue>) => emit({ ...value, ...patch });
  const setComparisonMode = (mode: ImageComparisonMode) => {
    if (comparisonMode === undefined) setUncontrolledComparisonMode(mode);
    onComparisonModeChange?.(mode);
    if (mode === "mask") setIsSampling(false);
  };

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type)) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const sourceUrl = String(reader.result);
      const image = new Image();
      image.onload = () => {
        const next = {
          ...defaultImagePreparation,
          sourceUrl,
          fileName: file.name,
          sourceWidth: image.naturalWidth,
          sourceHeight: image.naturalHeight,
          crop: centeredCrop(ratio, image.naturalWidth / image.naturalHeight),
        };
        emit(next);
      };
      image.src = sourceUrl;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, action: DragAction) => {
    if (disabled || !value.sourceUrl || !imageViewportRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { action, startX: event.clientX, startY: event.clientY, crop: value.crop };
    setIsDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bounds = imageViewportRef.current?.getBoundingClientRect();
    if (!drag || !bounds) return;
    const dx = ((event.clientX - drag.startX) / bounds.width) * 100;
    const dy = ((event.clientY - drag.startY) / bounds.height) * 100;
    const next = { ...drag.crop };
    if (drag.action === "move") {
      next.x += dx;
      next.y += dy;
    } else {
      if (drag.action.includes("w")) { next.x += dx; next.width -= dx; }
      if (drag.action.includes("e")) next.width += dx;
      if (drag.action.includes("n")) { next.y += dy; next.height -= dy; }
      if (drag.action.includes("s")) next.height += dy;
      if (next.width < MIN_CROP) {
        if (drag.action.includes("w")) next.x = drag.crop.x + drag.crop.width - MIN_CROP;
        next.width = MIN_CROP;
      }
      if (next.height < MIN_CROP) {
        if (drag.action.includes("n")) next.y = drag.crop.y + drag.crop.height - MIN_CROP;
        next.height = MIN_CROP;
      }
    }
    update({ crop: normalizeCrop(next, value.lockAspectRatio, ratio, imageAspect) });
  };

  const endDrag = () => { dragRef.current = null; setIsDragging(false); };
  const samplePreparedImage = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isSampling || !onSourceColorSample || activeComparisonMode === "mask") return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const x = clamp(Math.floor(((event.clientX - bounds.left) / bounds.width) * canvas.width), 0, canvas.width - 1);
    const y = clamp(Math.floor(((event.clientY - bounds.top) / bounds.height) * canvas.height), 0, canvas.height - 1);
    const data = canvas.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (!data) return;
    onSourceColorSample({
      rgb: { r: data[0], g: data[1], b: data[2] }, alpha: data[3], x, y,
      normalizedX: x / Math.max(1, canvas.width - 1), normalizedY: y / Math.max(1, canvas.height - 1),
      mode: activeComparisonMode,
    });
    setIsSampling(false);
  };
  const reset = () => emit({
    ...defaultImagePreparation,
    sourceUrl: value.sourceUrl,
    fileName: value.fileName,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    crop: centeredCrop(ratio, value.sourceWidth && value.sourceHeight ? value.sourceWidth / value.sourceHeight : 1),
  });
  const rotate = () => {
    const rotation = ((value.rotation + 90) % 360) as ImagePreparationValue["rotation"];
    const nextAspect = transformedAspect({ ...value, rotation });
    update({ rotation, crop: centeredCrop(ratio, nextAspect), zoom: 1 });
  };
  const changeZoom = (zoom: number) => {
    const factor = value.zoom / zoom;
    const centerX = value.crop.x + value.crop.width / 2;
    const centerY = value.crop.y + value.crop.height / 2;
    const crop = normalizeCrop({
      x: centerX - (value.crop.width * factor) / 2,
      y: centerY - (value.crop.height * factor) / 2,
      width: value.crop.width * factor,
      height: value.crop.height * factor,
    }, value.lockAspectRatio, ratio, imageAspect);
    update({ zoom, crop });
  };
  const updateAdjustment = (key: keyof ImageAdjustments, amount: number) => update({ adjustments: { ...value.adjustments, [key]: amount } });
  const setBackgroundMask = (backgroundMask: BackgroundMaskSettings) => update({ backgroundMask });
  const normalizedPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1), y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) };
  };
  const startMaskStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || activeComparisonMode !== "mask") return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    maskStrokeRef.current = { mode: maskBrushMode, radius: maskBrushSize, points: [normalizedPointer(event)] };
    setIsMaskPainting(true);
  };
  const extendMaskStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    const stroke = maskStrokeRef.current;
    if (!stroke) return;
    maskStrokeRef.current = { ...stroke, points: [...stroke.points, normalizedPointer(event)] };
    // Preview each movement without storing an unbounded undo history in the parent.
    const pending = { ...value.backgroundMask, strokes: [...value.backgroundMask.strokes, maskStrokeRef.current] };
    const sourceCanvas = adjustedCanvasRef.current, maskCanvas = maskCanvasRef.current;
    if (!sourceCanvas || !maskCanvas) return;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true }); const context = maskCanvas.getContext("2d");
    if (!sourceContext || !context) return;
    const image = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const mask = resolveBackgroundMask({ width: sourceCanvas.width, height: sourceCanvas.height, data: image.data }, pending);
    const preview = context.createImageData(maskCanvas.width, maskCanvas.height);
    for (let index = 0; index < mask.length; index += 1) { const offset = index * 4; preview.data[offset] = mask[index]; preview.data[offset + 1] = mask[index]; preview.data[offset + 2] = mask[index]; preview.data[offset + 3] = 255; }
    context.putImageData(preview, 0, 0);
  };
  const finishMaskStroke = () => {
    const stroke = maskStrokeRef.current; maskStrokeRef.current = null; setIsMaskPainting(false);
    if (stroke) setBackgroundMask({ ...value.backgroundMask, strokes: [...value.backgroundMask.strokes, stroke] });
  };
  const cropStyle = { left: `${value.crop.x}%`, top: `${value.crop.y}%`, width: `${value.crop.width}%`, height: `${value.crop.height}%` };
  const stageAspect = 4 / 3;
  const imageViewportStyle = imageAspect >= stageAspect
    ? { width: "100%", height: `${(stageAspect / imageAspect) * 100}%` }
    : { width: `${(imageAspect / stageAspect) * 100}%`, height: "100%" };
  const cropPreviewCanvasStyle = {
    left: `${-(value.crop.x / value.crop.width) * 100}%`,
    top: `${-(value.crop.y / value.crop.height) * 100}%`,
    width: `${(100 / value.crop.width) * 100}%`,
    height: `${(100 / value.crop.height) * 100}%`,
  };

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`} aria-label="Image preparation">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Prepare image</h2>
          <p className="text-sm text-slate-500">Your image stays in this browser until you export a project.</p>
        </div>
        <label className="cursor-pointer rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 focus-within:ring-2 focus-within:ring-teal-500 focus-within:ring-offset-2">
          Upload image
          <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange={onUpload} disabled={disabled} />
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2" aria-label="Image comparison view">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label="Image view">
          {([
            ["original", "Original"],
            ["cropped", "Cropped"],
            ["adjusted", "Adjusted"],
            ["mask", "Background mask"],
          ] as const).map(([mode, label]) => (
            <button key={mode} type="button" role="tab" aria-selected={activeComparisonMode === mode} onClick={() => setComparisonMode(mode)} className={`rounded-md px-3 py-1.5 text-sm font-medium ${activeComparisonMode === mode ? "bg-white text-teal-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
          ))}
        </div>
        {onSourceColorSample && activeComparisonMode !== "mask" && activeComparisonMode !== "original" && value.sourceUrl && (
          <button type="button" aria-pressed={isSampling} onClick={() => setIsSampling((current) => !current)} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${isSampling ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
            {isSampling ? "Click image to sample" : "Sample source color"}
          </button>
        )}
      </div>

      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0px]">
        {value.sourceUrl && activeComparisonMode === "original" ? (
          // eslint-disable-next-line @next/next/no-img-element -- the user-selected local data URL must not be uploaded for optimization.
          <img src={value.sourceUrl} alt={value.fileName ? `Original image: ${value.fileName}` : "Original source image"} className="max-h-full max-w-full object-contain" draggable={false} />
        ) : value.sourceUrl && activeComparisonMode === "mask" ? (
          <div className="relative h-full w-full" style={imageViewportStyle}>
            <canvas ref={rawCanvasRef} aria-hidden="true" className="hidden" />
            <canvas ref={adjustedCanvasRef} aria-hidden="true" className="hidden" />
            <canvas ref={maskCanvasRef} aria-label="Background removal mask: white is kept and black is removed" className={`h-full w-full ${isMaskPainting ? "cursor-crosshair" : "cursor-cell"}`} onPointerDown={startMaskStroke} onPointerMove={extendMaskStroke} onPointerUp={finishMaskStroke} onPointerCancel={finishMaskStroke} />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/80 px-2 py-1 text-xs text-white">White: keep · Black: remove</span>
          </div>
        ) : value.sourceUrl && activeComparisonMode === "cropped" ? (
          <div className="relative max-h-full max-w-full overflow-hidden" style={{ aspectRatio: ratio, width: ratio >= stageAspect ? "100%" : "auto", height: ratio < stageAspect ? "100%" : "auto" }}>
            <canvas ref={rawCanvasRef} aria-label={value.fileName ? `Cropped image: ${value.fileName}` : "Cropped source image"} className={`absolute ${isSampling ? "cursor-crosshair" : ""}`} style={cropPreviewCanvasStyle} onPointerDown={samplePreparedImage} />
            <canvas ref={adjustedCanvasRef} aria-hidden="true" className="hidden" />
          </div>
        ) : value.sourceUrl ? (
          <div ref={imageViewportRef} className="relative overflow-visible" style={imageViewportStyle} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <canvas ref={rawCanvasRef} aria-hidden={activeComparisonMode !== "cropped"} className={`absolute inset-0 h-full w-full ${activeComparisonMode === "cropped" ? "" : "hidden"} ${isSampling ? "cursor-crosshair" : ""}`} onPointerDown={samplePreparedImage} />
            <canvas ref={adjustedCanvasRef} aria-label={activeComparisonMode === "adjusted" ? (value.fileName ? `Adjusted image: ${value.fileName}` : "Adjusted source image") : undefined} aria-hidden={activeComparisonMode !== "adjusted"} className={`absolute inset-0 h-full w-full ${activeComparisonMode === "adjusted" ? "" : "hidden"} ${isSampling ? "cursor-crosshair" : ""}`} onPointerDown={samplePreparedImage} />
            {!isSampling && <div className={`absolute border-2 border-teal-400 bg-teal-400/10 shadow-[0_0_0_999px_rgba(15,23,42,.42)] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`} style={cropStyle}>
              <button aria-label="Move crop" className="absolute inset-2 cursor-inherit" onPointerDown={(e) => beginDrag(e, "move")} />
              {(["nw", "ne", "sw", "se"] as DragAction[]).map((handle) => (
                <button key={handle} aria-label={`Resize crop ${handle}`} className={`absolute h-4 w-4 rounded-full border-2 border-white bg-teal-600 ${handle === "nw" ? "-left-2 -top-2 cursor-nwse-resize" : handle === "ne" ? "-right-2 -top-2 cursor-nesw-resize" : handle === "sw" ? "-bottom-2 -left-2 cursor-nesw-resize" : "-bottom-2 -right-2 cursor-nwse-resize"}`} onPointerDown={(e) => beginDrag(e, handle)} />
              ))}
            </div>}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-slate-500">Upload a PNG, JPEG, or WebP to start. Transparent PNG areas will remain empty unless a background is selected later.</div>
      )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Crop & transform</legend>
          <label className="block text-sm text-slate-700">Zoom <span className="float-right tabular-nums text-slate-500">{value.zoom.toFixed(2)}×</span>
            <input className="mt-1 w-full accent-teal-600" type="range" min="1" max="3" step="0.01" value={value.zoom} onChange={(e) => changeZoom(Number(e.target.value))} />
          </label>
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Image adjustments</summary>
            <div className="mt-3 space-y-2">
              <label className="block text-xs text-slate-700">Brightness <span className="float-right">{value.adjustments.brightness}</span><input className="mt-1 w-full accent-teal-600" type="range" min="-100" max="100" value={value.adjustments.brightness} onChange={(event) => updateAdjustment("brightness", Number(event.target.value))} /></label>
              <label className="block text-xs text-slate-700">Contrast <span className="float-right">{value.adjustments.contrast}</span><input className="mt-1 w-full accent-teal-600" type="range" min="-100" max="100" value={value.adjustments.contrast} onChange={(event) => updateAdjustment("contrast", Number(event.target.value))} /></label>
              <label className="block text-xs text-slate-700">Saturation <span className="float-right">{value.adjustments.saturation}</span><input className="mt-1 w-full accent-teal-600" type="range" min="-100" max="100" value={value.adjustments.saturation} onChange={(event) => updateAdjustment("saturation", Number(event.target.value))} /></label>
              <label className="block text-xs text-slate-700">Hue <span className="float-right">{value.adjustments.hue} degrees</span><input className="mt-1 w-full accent-teal-600" type="range" min="-180" max="180" value={value.adjustments.hue} onChange={(event) => updateAdjustment("hue", Number(event.target.value))} /></label>
              <label className="block text-xs text-slate-700">Gamma <span className="float-right">{value.adjustments.gamma.toFixed(2)}</span><input className="mt-1 w-full accent-teal-600" type="range" min="0.4" max="2.5" step="0.01" value={value.adjustments.gamma} onChange={(event) => updateAdjustment("gamma", Number(event.target.value))} /></label>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={rotate}>Rotate 90°</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => update({ flipHorizontal: !value.flipHorizontal })}>Flip horizontal</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => update({ flipVertical: !value.flipVertical })}>Flip vertical</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={reset}>Reset</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-teal-600" checked={value.lockAspectRatio} onChange={(e) => update({ lockAspectRatio: e.target.checked, crop: normalizeCrop(value.crop, e.target.checked, ratio, imageAspect) })} /> Lock crop to {boardWidth} × {boardHeight} board</label>
        </fieldset>

        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Board layout</legend>
          <label className="block text-sm text-slate-700">Fit image to board
            <select className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2" value={value.fitMode} onChange={(e) => update({ fitMode: e.target.value as FitMode })}>
              <option value="cover">Fill & crop</option><option value="contain">Padding / contain</option>
            </select>
          </label>
          <label className="block text-sm text-slate-700">Padding placement
            <select className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2" value={value.paddingAlignment} onChange={(e) => update({ paddingAlignment: e.target.value as PaddingAlignment })} disabled={value.fitMode !== "contain"}>
              <option value="top-left">Top-left</option><option value="center">Center</option>
            </select>
          </label>
          <p className="text-xs leading-5 text-slate-500">Fill crops to the board shape. Padding keeps the full crop; top-left is the default placement for unused pegs.</p>
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-3" open={activeComparisonMode === "mask"}>
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">Background removal & mask</summary>
            <p className="mt-2 text-xs leading-5 text-slate-600">Runs locally in your browser. Automatic removal identifies border-connected colors similar to the top-left edge; repair ambiguous areas with the mask brush.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => { setBackgroundMask({ ...value.backgroundMask, automatic: true }); setComparisonMode("mask"); }}>Auto remove background</button>
              <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => { setBackgroundMask(defaultBackgroundMask); setComparisonMode("mask"); }}>Reset mask</button>
            </div>
            <label className="mt-3 block text-xs text-slate-700">Automatic sensitivity <span className="float-right">{value.backgroundMask.threshold}</span><input className="mt-1 w-full accent-teal-600" type="range" min="0" max="180" value={value.backgroundMask.threshold} disabled={!value.backgroundMask.automatic} onChange={(event) => setBackgroundMask({ ...value.backgroundMask, threshold: Number(event.target.value) })} /></label>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-700"><span>Mask brush</span><button type="button" className={`rounded border px-2 py-1 ${maskBrushMode === "remove" ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-300"}`} onClick={() => { setMaskBrushMode("remove"); setComparisonMode("mask"); }}>Remove</button><button type="button" className={`rounded border px-2 py-1 ${maskBrushMode === "keep" ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-300"}`} onClick={() => { setMaskBrushMode("keep"); setComparisonMode("mask"); }}>Keep</button><label className="min-w-32 flex-1">Size <input className="ml-2 w-20 accent-teal-600" type="range" min="0.005" max="0.15" step="0.005" value={maskBrushSize} onChange={(event) => setMaskBrushSize(Number(event.target.value))} /></label></div>
          </details>
        </fieldset>
      </div>
    </section>
  );
}
