import assert from "node:assert/strict";
import test from "node:test";
import { convertRasterToPattern } from "../app/lib/conversion";
import type { Bead, RgbaRaster } from "../app/lib/types";

const black: Bead = { id: "PERLER:BLACK", brand: "PERLER", code: "BLACK", name: "Black", notes: "", rgb: { r: 0, g: 0, b: 0 }, html: "#000000" };
const white: Bead = { id: "PERLER:WHITE", brand: "PERLER", code: "WHITE", name: "White", notes: "", rgb: { r: 255, g: 255, b: 255 }, html: "#FFFFFF" };
const gray: Bead = { id: "PERLER:GRAY", brand: "PERLER", code: "GRAY", name: "Gray", notes: "", rgb: { r: 128, g: 128, b: 128 }, html: "#808080" };
const raster: RgbaRaster = { width: 4, height: 2, data: new Uint8ClampedArray([80, 80, 80, 255, 112, 112, 112, 255, 144, 144, 144, 255, 176, 176, 176, 255, 80, 80, 80, 255, 112, 112, 112, 255, 144, 144, 144, 255, 176, 176, 176, 255]) };

test("every dithering mode respects the final maximum palette", () => {
  for (const dither of ["none", "floyd-steinberg", "ordered"] as const) {
    const pattern = convertRasterToPattern(raster, [black, white, gray], { width: 4, height: 2, brand: "PERLER", maxColors: 2, dither });
    assert.ok(pattern.counts.size <= 2, `${dither} should not add a third color`);
    assert.ok([...pattern.counts.keys()].every((id) => [black.id, white.id, gray.id].includes(id)));
  }
});
