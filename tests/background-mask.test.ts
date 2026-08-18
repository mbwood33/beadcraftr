import assert from "node:assert/strict";
import test from "node:test";
import { applyBackgroundMask, automaticMask, defaultBackgroundMask, normalizeBackgroundMask, resolveBackgroundMask } from "../app/lib/background-mask";
import type { RgbaRaster } from "../app/lib/types";

function raster(width: number, height: number, pixels: readonly number[]): RgbaRaster {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

test("automatic mask removes only border-connected matching background", () => {
  const image = raster(3, 3, [
    240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255,
    240, 240, 240, 255, 220, 30, 30, 255, 240, 240, 240, 255,
    240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255,
  ]);
  const mask = automaticMask(image, 20);
  assert.equal(mask[0], 0);
  assert.equal(mask[4], 255);
  assert.equal(mask[8], 0);
});

test("automatic mask removes border-connected colors within its configured sensitivity", () => {
  const image = raster(3, 3, [
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 253, 253, 253, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
  ]);
  // The center is connected through matching neighbors, so it should still remove.
  assert.equal(automaticMask(image, 5)[4], 0);
});

test("keep and remove brush strokes override automatic output in normalized coordinates", () => {
  const image = raster(5, 1, [
    240, 240, 240, 255, 240, 240, 240, 255, 220, 30, 30, 255, 240, 240, 240, 255, 240, 240, 240, 255,
  ]);
  const mask = resolveBackgroundMask(image, {
    automatic: true, threshold: 20,
    strokes: [
      { mode: "keep", radius: 0.02, points: [{ x: 0, y: 0 }] },
      { mode: "remove", radius: 0.02, points: [{ x: 0.5, y: 0 }] },
    ],
  });
  assert.equal(mask[0], 255);
  assert.equal(mask[2], 0);
});

test("applying a mask multiplies alpha without touching RGB or inventing transparent colors", () => {
  const image = raster(2, 1, [12, 34, 56, 200, 99, 88, 77, 0]);
  const output = applyBackgroundMask(image, { ...defaultBackgroundMask, strokes: [{ mode: "remove", radius: 0.1, points: [{ x: 0, y: 0 }] }] });
  assert.deepEqual([...output.data], [12, 34, 56, 0, 99, 88, 77, 0]);
});

test("untrusted saved masks are normalized to safe settings", () => {
  const normalized = normalizeBackgroundMask({ automatic: true, threshold: 999, strokes: [{ mode: "remove", radius: 5, points: [{ x: -2, y: 3 }, { nope: true }] }, { mode: "invalid", radius: 1, points: [] }] });
  assert.equal(normalized.automatic, true);
  assert.equal(normalized.threshold, 441);
  assert.deepEqual(normalized.strokes, [{ mode: "remove", radius: 1, points: [{ x: 0, y: 1 }] }]);
});
