"use client";
/* eslint-disable @next/next/no-img-element -- source data URLs intentionally remain browser-local. */

import { ChangeEvent, PointerEvent, useEffect, useRef, useState } from "react";

export type FitMode = "cover" | "contain";
export type PaddingAlignment = "top-left" | "center";

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
  crop: CropRect;
  zoom: number;
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  fitMode: FitMode;
  paddingAlignment: PaddingAlignment;
  lockAspectRatio: boolean;
};

/** Alias used by the app-level conversion pipeline. */
export type PreparedImage = ImagePreparationValue;

export const defaultImagePreparation: ImagePreparationValue = {
  sourceUrl: null,
  fileName: null,
  crop: { x: 0, y: 0, width: 100, height: 100 },
  zoom: 1,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  fitMode: "cover",
  paddingAlignment: "top-left",
  lockAspectRatio: true,
};

type Props = {
  value: ImagePreparationValue;
  onChange: (value: ImagePreparationValue) => void;
  /** Convenience callback for consumers that only need the prepared-image payload. */
  onPreparedImageChange?: (image: PreparedImage | null) => void;
  boardWidth?: number;
  boardHeight?: number;
  disabled?: boolean;
  className?: string;
};

type DragAction = "move" | "nw" | "ne" | "sw" | "se";
type DragState = { action: DragAction; startX: number; startY: number; crop: CropRect };

const MIN_CROP = 8;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function normalizeCrop(crop: CropRect, lockAspectRatio: boolean, ratio: number): CropRect {
  let width = clamp(crop.width, MIN_CROP, 100);
  let height = clamp(crop.height, MIN_CROP, 100);
  if (lockAspectRatio && ratio > 0) {
    height = width / ratio;
    if (height > 100) {
      height = 100;
      width = height * ratio;
    }
  }
  const x = clamp(crop.x, 0, 100 - width);
  const y = clamp(crop.y, 0, 100 - height);
  return { x, y, width, height };
}

/**
 * Client-only image preparation controls. The parent owns the serializable state
 * so it can feed a conversion pipeline or a project file without scraping UI.
 */
export function ImageCropWorkspace({
  value,
  onChange,
  onPreparedImageChange,
  boardWidth = 29,
  boardHeight = 29,
  disabled = false,
  className = "",
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const ratio = boardWidth > 0 && boardHeight > 0 ? boardWidth / boardHeight : 1;

  // The crop only needs normalization when the board shape changes; including the
  // controlled object here would re-emit it after every parent render.
  useEffect(() => {
    if (value.lockAspectRatio) {
      const nextCrop = normalizeCrop(value.crop, true, ratio);
      if (JSON.stringify(nextCrop) !== JSON.stringify(value.crop)) onChange({ ...value, crop: nextCrop });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardWidth, boardHeight]); // Intentionally only react to a board shape change.

  const emit = (next: ImagePreparationValue) => {
    onChange(next);
    onPreparedImageChange?.(next.sourceUrl ? next : null);
  };
  const update = (patch: Partial<ImagePreparationValue>) => emit({ ...value, ...patch });

  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type)) {
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => emit({ ...defaultImagePreparation, sourceUrl: String(reader.result), fileName: file.name });
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const beginDrag = (event: PointerEvent<HTMLButtonElement>, action: DragAction) => {
    if (disabled || !value.sourceUrl || !stageRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { action, startX: event.clientX, startY: event.clientY, crop: value.crop };
    setIsDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bounds = stageRef.current?.getBoundingClientRect();
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
    update({ crop: normalizeCrop(next, value.lockAspectRatio, ratio) });
  };

  const endDrag = () => { dragRef.current = null; setIsDragging(false); };
  const reset = () => emit({ ...defaultImagePreparation, sourceUrl: value.sourceUrl, fileName: value.fileName });
  const rotate = () => update({ rotation: ((value.rotation + 90) % 360) as ImagePreparationValue["rotation"] });
  const cropStyle = { left: `${value.crop.x}%`, top: `${value.crop.y}%`, width: `${value.crop.width}%`, height: `${value.crop.height}%` };
  const imageTransform = `scale(${value.zoom}) rotate(${value.rotation}deg) scale(${value.flipHorizontal ? -1 : 1}, ${value.flipVertical ? -1 : 1})`;

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

      <div
        ref={stageRef}
        className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0px]"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {value.sourceUrl ? (
          <img src={value.sourceUrl} alt={value.fileName ? `Selected image: ${value.fileName}` : "Selected source image"} className="absolute h-full w-full object-contain transition-transform" style={{ transform: imageTransform }} draggable={false} />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-slate-500">Upload a PNG, JPEG, or WebP to start. Transparent PNG areas will remain empty unless a background is selected later.</div>
        )}
        {value.sourceUrl && (
          <div className={`absolute border-2 border-teal-400 bg-teal-400/10 shadow-[0_0_0_999px_rgba(15,23,42,.42)] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`} style={cropStyle}>
            <button aria-label="Move crop" className="absolute inset-2 cursor-inherit" onPointerDown={(e) => beginDrag(e, "move")} />
            {(["nw", "ne", "sw", "se"] as DragAction[]).map((handle) => (
              <button key={handle} aria-label={`Resize crop ${handle}`} className={`absolute h-4 w-4 rounded-full border-2 border-white bg-teal-600 ${handle === "nw" ? "-left-2 -top-2 cursor-nwse-resize" : handle === "ne" ? "-right-2 -top-2 cursor-nesw-resize" : handle === "sw" ? "-bottom-2 -left-2 cursor-nesw-resize" : "-bottom-2 -right-2 cursor-nwse-resize"}`} onPointerDown={(e) => beginDrag(e, handle)} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Crop & transform</legend>
          <label className="block text-sm text-slate-700">Zoom <span className="float-right tabular-nums text-slate-500">{value.zoom.toFixed(2)}×</span>
            <input className="mt-1 w-full accent-teal-600" type="range" min="1" max="3" step="0.01" value={value.zoom} onChange={(e) => update({ zoom: Number(e.target.value) })} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={rotate}>Rotate 90°</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => update({ flipHorizontal: !value.flipHorizontal })}>Flip horizontal</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => update({ flipVertical: !value.flipVertical })}>Flip vertical</button>
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" onClick={reset}>Reset</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" className="accent-teal-600" checked={value.lockAspectRatio} onChange={(e) => update({ lockAspectRatio: e.target.checked, crop: normalizeCrop(value.crop, e.target.checked, ratio) })} /> Lock crop to {boardWidth} × {boardHeight} board</label>
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
        </fieldset>
      </div>
    </section>
  );
}
