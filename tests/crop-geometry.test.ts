import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCrop } from "../app/components/ImageCropWorkspace";

test("locks a wide source to a centered-square-compatible crop shape", () => {
  const crop = normalizeCrop({ x: 0, y: 0, width: 100, height: 100 }, true, 1, 16 / 9);
  assert.equal(crop.height, 100);
  assert.equal(crop.width, 56.25);
});

test("locks a portrait source using its actual pixel aspect ratio", () => {
  const crop = normalizeCrop({ x: 0, y: 0, width: 100, height: 100 }, true, 1, 9 / 16);
  assert.equal(crop.width, 100);
  assert.equal(crop.height, 56.25);
});

test("keeps unlocked crops inside source bounds", () => {
  const crop = normalizeCrop({ x: 92, y: 95, width: 25, height: 20 }, false, 1, 16 / 9);
  assert.deepEqual(crop, { x: 75, y: 80, width: 25, height: 20 });
});
