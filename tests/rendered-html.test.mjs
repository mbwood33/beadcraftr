import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("exports a static BeadCraftr pattern workspace", async () => {
  const html = await readFile(new URL("../dist/client/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>BeadCraftr \| Fuse bead pattern maker<\/title>/i);
  assert.match(html, /Make the picture\. Count every bead\./);
  assert.match(html, /Fuse bead pattern studio/);
  assert.match(html, /Local in your browser/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Building your site/i);
});

test("removes the disposable starter preview and its dependency", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(page, /ImageCropWorkspace/);
  assert.match(page, /convertRasterToPattern/);
  assert.match(layout, /BeadCraftr/);
  assert.doesNotMatch(page, /max="100"|Math\.min\(100/);
  assert.match(css, /\.bead-grid \.pattern-cell \{ position:relative; border:0;/);
  assert.match(css, /\.bead-grid \.pattern-cell\.occupied:after \{ content:""; position:absolute; inset:0;/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("../app/_sites-preview", import.meta.url)), []);
});
