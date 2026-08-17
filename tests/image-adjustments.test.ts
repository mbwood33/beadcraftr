import assert from "node:assert/strict";
import test from "node:test";
import { applyImageAdjustments, defaultImageAdjustments } from "../app/lib/image-adjustments";

test("default image adjustments preserve visible pixels", () => {
  const original = new Uint8ClampedArray([12, 88, 190, 255, 0, 0, 0, 0]);
  assert.deepEqual(applyImageAdjustments(original, defaultImageAdjustments), original);
});

test("brightness adjustments alter visible pixels without changing alpha", () => {
  const output = applyImageAdjustments(new Uint8ClampedArray([80, 80, 80, 123]), { ...defaultImageAdjustments, brightness: 30 });
  assert.ok(output[0] > 80);
  assert.equal(output[3], 123);
});
