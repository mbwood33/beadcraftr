# BeadCraftr development guide

## Product purpose

BeadCraftr is a privacy-friendly, browser-first application that converts an image into a fuse-bead pattern. Its default target is a 29 x 29 Perler peg board, while supporting configurable board dimensions. It is also a hands-on pattern authoring tool: automatic conversion gives users a strong starting point, and a full peg editor lets them make the final artistic decisions.

Unless a feature explicitly requires a server, image processing and project persistence should occur in the browser. Do not upload an image by default. Make any external or AI-based background-removal service opt-in and explain its data implications.

## Current source data

- The root file `perlercolor - Printable.csv` is the initial bead catalogue.
- Its columns are `CODE`, `NAME`, `R`, `G`, `B`, `HTML`, `BRAND`, and `NOTES`.
- The current valid automatic palette contains 108 entries: 87 Perler and 21 Artkal.
- Twenty-eight specialty rows contain `???` for RGB/HTML values. Treat them as catalogue entries but exclude them from automatic palette matching and source-image eyedropper matching until valid color values are provided.
- Normalize inputs at load time: trim whitespace, normalize brand casing, parse hex strings with or without `#`, and preserve the original code/name/notes for display and export.
- A catalogue bead identity is `normalized brand + normalized code`; do not use its name or RGB value as an ID. A visually similar bead from another brand is a distinct material.
- Do not silently substitute unknown-RGB rows with a guessed color.

## Product vocabulary and non-negotiable rules

- **Peg:** one coordinate in the board grid.
- **Empty peg / no bead:** no physical bead is required. This is distinct from a transparent or clear bead.
- **Clear bead:** a specific, optional bead color, only available when its catalogue color is valid or a user explicitly adds it.
- **Background:** may be empty, a selected bead color, or (where available) a clear bead. Transparency in an input PNG defaults to empty pegs.
- **Palette:** the currently eligible bead colors after brand selection, disabled colors, valid RGB filtering, and any user additions.
- **Active pattern palette:** colors currently used by at least one peg in the pattern.
- **Availability:** whether an otherwise valid catalogue color can be used by automatic matching, suggestions, and editor selection.
- **Inventory:** an optional user-recorded quantity of an available bead color that is already on hand. Availability and inventory are independent.
- **Required quantity:** exact count of occupied pegs for a bead color.
- **Recommended quantity:** required count plus an optional, configurable spare/waste percentage. The default spare percentage should be visible and easy to disable.

Never treat an empty peg as a clear bead, and never count empty pegs in a shopping list.

## Canonical defaults

- Grid: 29 x 29.
- Fit mode: fill/crop.
- Padding alignment: top-left.
- Brand palette: Perler.
- Background: empty/no bead.
- Dithering: none.
- Source type/resampling: photo/area averaging; provide a pixel-art/nearest-neighbor alternative.
- Automatic maximum colors: 16.
- Spare percentage: 10%, visible and user-adjustable down to zero.
- Alpha threshold: 50%, user-adjustable in advanced controls.

Defaults are starting points, not hidden behavior: display them in the relevant controls and save them in projects.

## Primary user workflow

1. Upload an image (including transparent PNGs).
2. Prepare the image: crop, position, rotate/flip, adjust visual settings, and choose/remove/refine background.
3. Choose grid dimensions (default 29 x 29), fit mode, placement, bead brand palette, disabled/owned colors, maximum color depth, and optional dithering.
4. Generate and compare the bead pattern against the source stages.
5. Refine the result with the peg editor and palette tools.
6. Review color substitutions and material quantities.
7. Export a pattern, materials list, or editable JSON project.

The application should preserve all relevant settings and edits in an exportable project file so users can reopen and continue work later.

## Functional requirements

### Image preparation

- Support standard raster uploads, especially PNG, JPEG, and WebP.
- Provide a draggable crop rectangle with resize handles, image zoom, reset, 90-degree rotation, horizontal flip, vertical flip, and optional board-aspect-ratio lock.
- Default fit mode is **fill/crop**. Provide a padding/contain mode.
- In padding/contain mode, default image placement to **top-left** and provide a center option.
- Provide brightness, contrast, saturation, hue, and gamma (or equivalent clearly documented controls). All changes must be non-destructive and reversible.
- Provide a before/after workspace that can display Original, Cropped, Background/Mask, and Bead Pattern states.
- For transparent input, default fully transparent pixels to empty pegs. Let users override this with a chosen background bead color or clear bead behavior.
- Define alpha handling explicitly. Pixels below the alpha threshold become empty in an empty-background pattern. With a bead or clear background enabled, composite partial-alpha source pixels against that selected background before color matching. Do not let RGB data in fully transparent pixels contaminate visible edge colors.
- Use area/box averaging as the default image-to-grid resampling mode for photographs and nearest-neighbor for existing pixel art. Keep the choice explicit, process colors consistently, and preserve alpha correctly during resizing.
- Background removal may begin with local/basic automatic methods. If an external/AI remover is added, it must be opt-in. Include refinement controls: keep brush and remove brush, and make the mask previewable before generating the pattern.

### Conversion

- Support any positive grid width and height, default 29 x 29. Do not impose an arbitrary maximum; validate positive safe integers and clearly warn that large boards can take longer to generate or export.
- Match generated colors only to eligible bead catalogue records. The result must retain bead ID, brand, name, code, RGB, and the source color used for matching.
- Brand choices must include Perler, Artkal, and both where valid data exists. When both are selected, clearly identify brand in every palette, legend, and material count.
- Permit users to disable colors they do not own or do not want used. Disabled colors must be excluded from matching and substitution suggestions.
- Include a strict maximum-color-depth setting: automatic generation and dithering must not exceed the chosen number of different non-empty bead colors. Manual edits may exceed it, but must show a clear `used / generation limit` warning and offer simplification suggestions without silently changing the pattern.
- Recommend a palette-aware quantization flow: prepare alpha/background, resize to the grid, quantize to at most the requested depth, then match to eligible physical bead colors. Ensure final count remains within the limit after palette matching.
- Do not choose one matching metric blindly. Keep the matching logic isolated and testable; perceptual color distance is preferred over naive RGB Euclidean distance.
- Offer dithering as an advanced, optional palette-constrained mapping mode:
  - None (default): clean pixel-art result.
  - Floyd-Steinberg: can help photographic shading but may create isolated-bead noise.
  - Ordered/Bayer: structured texture that often suits bead art.
- Dithering distributes error while mapping pixels to the final eligible palette; it must obey the maximum-color-depth setting and run before manual peg edits. It must never produce an ineligible bead color.

### Peg editor and palette management

The editor is a first-class pattern-making surface, not a minor correction control. It must support:

- Pencil, eraser/no-bead, eyedropper, fill bucket, drag painting, undo, and redo.
- Bead view (colored circles), pixel view (solid squares), and symbol view (stable letter/symbol per active color).
- A filtered color picker showing brand, code, name, swatch, and current quantity. Make recently used colors quick to access.
- Manually adding a valid existing catalogue color to the active/available editor palette even when the automatic converter did not choose it.
- Source-image eyedropper sampling: a user may sample a color from the prepared original/cropped image and request the closest eligible bead color. Sampling must respect selected brands and disabled colors. It should *suggest or add the closest real bead color*; it must not invent a non-catalogue bead.
- If user-defined/custom colors are ever supported, make them explicit as non-catalogue colors and exclude them from brand shopping totals unless they are mapped to a real bead later.
- Every direct cell edit must update quantities, symbols, active palette, exports, and undo/redo history consistently.
- Symbol assignments must support more than 26 colors with a deterministic, printable token sequence. Avoid ambiguous symbols such as `I`, `l`, `1`, `O`, and `0`, and retain existing symbols where possible when the pattern is edited.

### Palette simplification

- Suggest, never silently apply, low-impact color substitutions. Example: replace a color used twice with a visually similar color already used heavily.
- Each suggestion must state the original bead, replacement bead, affected quantity, and an understandable visual-difference score or label.
- Users must be able to accept, reject, and manually choose a replacement.
- Honor brand choices, disabled colors, and max-color-depth requirements. Recalculate counts after every accepted substitution.

### Results, quantities, and printability

- Show total pegs, total beads, empty pegs, and used colors versus allowed maximum (for example, `14 / 16 colors`).
- Show a materials table with swatch, symbol, brand, code, color name, required quantity, recommended quantity, on-hand inventory, and quantity to buy. The optional spare percentage applies to recommended quantity, and shortages are calculated from it.
- Provide an optional 29 x 29 board-boundary overlay for larger patterns, show the implied board layout/count, and include board/tile labels in relevant printable exports.
- Symbol assignments must be deterministic within a project and legible in a printable legend. Do not rely on color alone for accessible instructions.
- Export targets:
  - PNG pattern with grid.
  - PNG pattern without grid.
  - Printable PDF pattern and material legend.
  - CSV and XLSX materials list.
  - CSV and XLSX pattern/grid data.
  - Versioned JSON project file containing the final grid, dimensions, palette choices, availability/inventory data, crop/transforms, mask/background choices, conversion settings, manual edits, symbols, and version metadata. It may optionally embed the source image as a data URL for a portable project. Without an embedded image, clearly state that reopening supports viewing/editing the final grid but requires the original image to regenerate from source settings.
- Design PDFs for eventual multi-page/tiled output when a board is too large for one printable page. Tiles need overlap and alignment marks. A single-page layout is sufficient for the first implementation if the export architecture supports later tiling.

## Suggested technical architecture

Keep UI, domain logic, and file/export code separate.

- `catalogue`: CSV parsing, validation, stable bead identities, brand filtering, availability/inventory state, palette eligibility, and nearest-color lookup.
- `image pipeline`: transform state, crop geometry, alpha/mask handling, image adjustments, color-safe raster-to-grid sampling, and source-image sampling.
- `conversion`: quantization, color matching, dithering, and substitution suggestions. Keep deterministic functions independent of UI state.
- `pattern model`: grid cells, palette references, symbols, occupancy/count/shortage calculations, board-boundary layout, and edit commands.
- `editor`: renderer, tools, keyboard shortcuts, pointer/drag behavior, and undo/redo command stack.
- `exports`: PNG, PDF, CSV, XLSX, and versioned JSON serializers.
- `UI state`: selection and view preferences only; avoid duplicating canonical grid/count data.

Use a coordinate convention consistently and document it: `x` is column from left, `y` is row from top, both zero-based internally. Serialize project versions explicitly so later releases can migrate saved JSON safely.

## Performance and accessibility expectations

- Keep interaction responsive for practical custom board sizes. Debounce expensive preview recalculation and cancel stale renders when settings change.
- Never block drawing while a new conversion preview is computing; retain the last confirmed pattern until the new result is accepted.
- Provide keyboard-accessible controls, visible focus, sensible labels, accessible contrast, and text/symbol alternatives to color-only meaning.
- Support undo/redo keyboard shortcuts and expose them in the editor.
- Show clear error states for unsupported images, invalid CSV rows, failed exports, and an empty eligible palette.
- Do not permanently mutate the original uploaded file or image data.

## Delivery phases

### Phase 1 - usable converter

- App shell and responsive workspace.
- Catalogue loading with valid/invalid RGB handling.
- Image upload, basic crop/zoom/rotate/flip, 29 x 29 default grid, and custom dimensions.
- Fill/crop and padding behavior, top-left/center placement.
- Brand palette, availability controls, max color depth, valid palette matching, alpha/background rules, and photo/pixel-art resampling.
- Bead/pixel preview, core count table, PNG with/without grid, CSV materials export, and simple printable PDF.

### Phase 2 - authoring workflow

- Image adjustment controls and comparison views.
- Full peg editor with tools, drag painting, history, manually added catalogue colors, source-image eyedropper matching, and symbol view.
- Dithering modes and preview.
- Suggested color substitutions.
- XLSX and pattern/grid exports, board-boundary overlay, and materials shortages from optional inventory.
- Versioned JSON save/open projects with optional embedded source image and clear portable/non-portable status.

### Phase 3 - advanced refinement and print

- Automatic background removal plus local keep/remove mask brush refinement.
- Robust tiled/multi-page PDF layouts with overlap/alignment marks.
- Further catalogue tooling for specialty bead RGB completion and user palette preferences.

## Testing and acceptance criteria

Test domain logic independently from the UI. At minimum, cover:

- CSV parsing, brand filtering, invalid/unknown RGB exclusion, and input normalization.
- Transparent pixels becoming empty pegs by default.
- Partially transparent edges respecting alpha thresholds and selected background compositing.
- Background color and clear-bead selections producing counted occupied pegs.
- Width/height dimensions, area versus nearest-neighbor resampling, and top-left versus centered padding placement.
- Max-color-depth being honored after matching/dithering.
- Manual additions being allowed to exceed the automatic color limit while displaying the correct warning.
- Disabled colors never being selected or suggested as substitutions.
- Manual drawing, fill, erasing, eyedropper, and undo/redo yielding correct grid and quantity state.
- Source eyedropper offering an eligible real bead rather than an invented color.
- Quantities, inventory shortages, symbols, CSV/XLSX/PDF/PNG outputs agreeing with the final grid.
- JSON save/open round-tripping settings and manual edits, with and without an embedded source image.
- Board-boundary overlay and board labels correctly reflecting patterns larger than 29 x 29.
- Deterministic conversion: a fixture image, catalogue version, and settings must always produce the same grid.

Maintain small committed visual fixtures for an opaque photo, a transparent anti-aliased PNG, a pixel-art sprite, a padded wide image, a mixed-brand palette, and a dithered gradient. Use them for deterministic grid and export regression checks.

Before claiming a UI task complete, exercise the core flow manually: upload an opaque image, upload a transparent PNG, generate a 29 x 29 pattern, alter a color in the editor, verify counts, and inspect at least one exported artifact.

## Agent working rules

- Read this file and inspect existing code before changing architecture or dependencies.
- Make focused, reversible changes; preserve unrelated user work in a dirty worktree.
- Prefer deterministic local processing and explicit user choices over hidden automatic changes.
- Never silently change the selected brand, add a bead color, replace a color, or fill transparent pegs.
- Keep automatic conversion results separate from edits so regeneration can be previewed without destroying user work. Setting changes create a candidate result while the confirmed edited pattern stays intact. Ask before replacing manual edits, or provide a duplicate/branch flow; do not merge undo history across unrelated candidate generations.
- Update relevant tests with feature work. Run formatting, type checks, and targeted tests before handoff.
- When adding a dependency, document why it is needed and favor well-maintained browser-compatible packages.
- Keep export schemas backwards-conscious; increment the JSON project version for incompatible changes.
