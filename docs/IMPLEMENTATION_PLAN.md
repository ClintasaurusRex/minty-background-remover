# Minty Background Remover Implementation Plan

Development must proceed incrementally.

Do not skip directly to later features simply because they appear interesting.

Each phase should be tested before moving forward.

`PROJECT_BRIEF.md` remains the highest-level source of truth.

---

## Phase 0 — Project Foundation

### Goals

Establish the project structure without implementing major image-editing features.

### Work

- Confirm React/Vite/TypeScript project health.
- Clean unnecessary starter content.
- Establish plain CSS structure.
- Establish dark application shell.
- Create toolbar shell.
- Create workspace shell.
- Create empty-state UI.
- Add TypeScript domain types where useful.
- Configure Vitest.
- Confirm lint.
- Confirm TypeScript checks.
- Confirm production build.
- Establish documentation.
- Establish agent rules.

### Do Not Implement Yet

- Magic Wand algorithm
- Background removal
- Crop algorithm
- Auto Trim algorithm
- Colour replacement
- Tauri
- SVG tracing

### Checkpoint

Stop after foundation is stable.

The project owner reviews before Phase 1.

---

## Phase 1 — Image Workspace

### Goals

Load and display images correctly.

### Work

- PNG import.
- JPG/JPEG import.
- WebP import.
- SVG raster import.
- File picker.
- Drag and drop.
- Clipboard paste.
- Canvas rendering.
- Checkerboard transparency.
- Image metadata display where useful.
- Zoom.
- Pan.
- Fit to Screen.
- 100% zoom.
- Coordinate conversion utilities.

### Tests

Test:

- Image dimensions remain correct.
- Zoom does not modify actual image dimensions.
- Coordinate conversions.
- Drag/drop validation.
- Unsupported file handling.

### Checkpoint

User must be able to reliably open and navigate images.

### Phase 1 Status and Known Limitations

Phase 1 was implemented in nine reviewed steps. Behaviour is specified in `FEATURE_SPEC.md` §1–4 and `IMAGE_PROCESSING_SPEC.md` (SVG Input); module layout is in `ARCHITECTURE.md` (Phase 1 Modules).

Known limitations accepted for Phase 1:

- Device-pixel snapping: near a pixel edge at fractional device pixel ratios, the pixel under the pointer can flip by one during wheel zoom or drag panning. Rendering and pointer hit-testing always agree.
- Wheel sensitivity: Chrome's emulated device scale factor divides wheel deltas by the ratio; behaviour on real high-DPI hardware is unverified.
- A JPEG whose header cannot be inspected is fully decoded before its size is checked; the canvas read-back briefly needs about twice the image's memory.
- An image is held twice while open (pixel buffer and drawable bitmap).
- The browser decoder cannot be interrupted: a superseded import finishes its current decode step, then skips the rest.
- Canvas 2D reduces 16-bit PNGs to 8 bits per channel and converts colour profiles to sRGB.
- SVGs with a DOCTYPE (including default Adobe Illustrator exports) are rejected.
- Firefox decodes some truncated JPEGs partially; truncated PNGs are rejected.
- Not yet verified on physical hardware: real file-manager drag and drop, the Linux desktop clipboard (Flameshot, copy image from browsers), trackpads, browser zoom changes and moving between monitors with different scaling.

---

## Phase 2 — Selection System and Magic Wand

### Goals

Create the application's primary selection system.

### Work

- Selection mask.
- Magic Wand contiguous flood fill.
- Tolerance.
- Global mode.
- Selection overlay.
- Selection boundary.
- Add selection.
- Subtract selection.
- Select All.
- Clear Selection.
- Invert Selection.
- Grow Selection.
- Shrink Selection.

### Tests

Automated tests for:

- Flood fill.
- Tolerance behaviour.
- Contiguous selection.
- Global selection.
- Mask combination.
- Invert.
- Grow.
- Shrink.

### Performance

Test using:

- Small fixtures.
- Typical screenshot.
- Large image.
- 4K image.

### Checkpoint

Do not proceed until Magic Wand behaviour is predictable.

### Phase 2 Approved Decisions and Steps

Approved decisions (D1–D9 and smaller defaults) are recorded in `FEATURE_SPEC.md` §5–7, `IMAGE_PROCESSING_SPEC.md` (Magic Wand through Selection Performance), `UI_UX_SPEC.md` (Magic Wand UX, Selection UX, Status Bar) and `ARCHITECTURE.md` (Phase 2 Modules, Web Workers).

Phase 2 is implemented in twelve reviewed steps, each stopping for review:

1. Record decisions; selection mask model. Done.
2. Colour distance and tolerance. Done.
3. Magic Wand: Contiguous and Global. Done.
4. Combine (New / Add / Subtract), Select All and Invert. Done.
5. Grow and Shrink. Done.
6. Editor state for the active tool, Magic Wand options and selection. Done.
7. Magic Wand click, Ctrl + A / Esc and status bar (first manual checkpoint). Done.
8. Selection overlay. Done.
9. Magic Wand options row. Done.
10. Re-apply on tolerance change. Done.
11. Marching ants (optional). Done.
12. Final quality assurance, performance review and Phase 2 readiness assessment. Done.

Phase 2 was approved by the project owner and merged into `main` (d329646).

Known limitation (Step 7): where an image pixel edge passes exactly through the centre of a device pixel (for example at 150% zoom, or 100% zoom with 150% display scaling), that device pixel is split equally between two image pixels and the browser decides which one it shows. Hit-testing picks the left / upper pixel, as both browsers usually draw it. Chrome sometimes shows the other pixel, and the Step 8 checks of whole neighbourhoods found Firefox doing so occasionally too, so a click there can select the neighbouring pixel. Everywhere else the clicked pixel is exactly the one drawn under the pointer.

Known limitations (Step 8):

- The overlay follows the hit-testing rule exactly, so at those exact ties its boundary can sit one device pixel away from the edge the browser drew.
- When the workspace's CSS size times the device pixel ratio is not a whole number of device pixels (seen after changing Chrome's display scaling at runtime), the browser stretches both canvases by a fraction of a pixel and resamples them. The overlay stays aligned with the image, but neither is pixel-exact. Sizing backing stores from `ResizeObserver`'s `devicePixelContentBoxSize` would avoid this; it changes image rendering, so it awaits an owner decision.
- Zoomed out, a screen pixel shows the selection when any image pixel it covers is selected: the selection can look up to one screen pixel larger, and holes smaller than a screen pixel are not shown.
- The boundary is about one CSS pixel on each side of an edge, so near 100% it covers one- or two-pixel features; a selection with many tiny holes looks speckled with black and white until zoomed in.
- Overlay tiles are rasterised synchronously on the main thread when the selection, zoom or display scaling changes (measurements in `IMAGE_PROCESSING_SPEC.md`, Selection Overlay). On large displays with very complex selections a zoom step can take over 100 ms.

Known limitations (Step 10):

- A re-apply runs on the main thread, like a click: about 55–80 ms for a 4K screenshot and 0.3–1 s near the 50-megapixel limit in the Step 10 measurements (`IMAGE_PROCESSING_SPEC.md`, Selection Performance). The time-slicing or Web Worker decision from Step 7 applies to both.
- While an Add or Subtract click can be re-applied, the selection from before it is kept: one more full-image mask (8.3 MB at 4K, 50 MB at 50 megapixels) until the next click, another selection change or another image.
- Clear and Escape do nothing when nothing is selected, so after a Subtract that removed everything they do not end re-applying: lowering the tolerance afterwards gives back the pixels that Subtract no longer reaches.
- A click on the image while a typed tolerance is not yet committed uses the typed value. The click is handled before the text field loses focus, so the earlier click is not re-applied with that value first; the click becomes the one re-applied.
- Firefox was not available in the cloud session used for Step 10; its tolerance interactions were verified in the Step 10 manual review.

Known limitations (Step 11):

- The ants are diagonal stripes moved one step at a time, not dashes traced along each outline (tracing outlines would cost more the more edges a selection has). Dashes therefore move right along horizontal edges and down along vertical ones everywhere, rather than circling each region, and on edges at exactly 45° rising to the right (parallel to the stripes) they do not travel: one-pixel diagonals of the line swap colour in turn instead.
- Steps that take longer than about 7.5 ms are spaced further apart (at most a twentieth of the main thread), so on very complex boundaries, large high-DPI screens or slower computers the ants move more slowly. They pause while the boundary in view covers more than 10 million device pixels, which in practice means noise-like selections filling a screen larger than 4K.
- Visible tiles keep their boundary area's pixels while the ants run, so a step only changes the pixels that move: 0.5–13 MB for screenshot-like and large connected selections, up to 36 MB for noise-like selections filling a 4K screen (`IMAGE_PROCESSING_SPEC.md`, Selection Overlay). The first step after a selection, zoom or window change repaints these areas in full.
- While the ants run, Chrome's main thread is busy about 1–3% of the time for screenshot-like selections with GPU rendering, and 3–6.5% with software rendering, where presenting the changed overlay canvas costs more than the step itself; fragmented selections reach the 5% step budget. Nothing runs with reduced motion, without a selection or with no boundary in view.
- Tiles are now rasterised in two passes (boundary geometry, then colours) so the geometry can be kept: a selection change or zoom step costs about the same as in Step 10 for screenshot-like selections and 5–20% more for noise-like ones. Pan frames are unchanged.
- In headless Firefox every step costs 2–3 ms at device pixel ratio 1 and about 6 ms at ratio 2 however little boundary is in view, apparently because the whole overlay canvas is copied once the compositor has shown it; Firefox's pan frames show the same floor since Step 8. Behaviour with hardware-accelerated canvases on real displays is unverified.
- The ants keep moving while the window is visible but not focused; only a hidden page (another tab, a minimised window) pauses them.
- Measured in headless Chrome 156 and Firefox 158; the appearance, the 150 ms speed, reduced motion and performance on a real display were approved in the Step 11 manual review on Linux Mint. The Step 7 and Step 8 limitations (exact ties, fractional display scaling) are unchanged: the moving pattern follows the same pixels as the static one.

#### Step 12: Final Review (done; Phase 2 approved and merged)

Readiness: every Phase 2 feature works together as specified in Chrome 156 and Firefox 158 (headless, production build), at device pixel ratios 1–2, from 25% to 3200% zoom (and Fit, down to about 20% for 50-megapixel images), in narrow and ultrawide windows, and with reduced motion. The Magic Wand is predictable: re-applied results equal fresh clicks at the committed tolerance in every mode, nothing accumulates, and stale results are discarded. Screenshots, technical graphics, 12-megapixel photographs and 4K images respond in about 120 ms or less, and memory stays bounded across selections, re-applies and image replacements. Two defects were found and fixed. What remains is the main-thread time near the 50-megapixel limit (0.15–0.4 s per operation), awaiting the owner decision below. Phase 2 is ready for the owner's final manual review; it is not approved until then.

Fixed in Step 12:

- First image of a session placed for the wrong workspace (introduced in Step 9). The first successful import makes the Magic Wand active, and its options row appears above the workspace in the same update, after the image has been placed. The image was then only re-centred: images larger than the workspace opened about 6–7% larger than Fit, with 4.5 px instead of 24 px of margin, and where the row wraps (75 px at 1024 px wide) they overflowed the workspace by 13.5 px at the top and bottom. Images shown at 100% were centred half a pixel differently from Fit, which was the Firefox "half-pixel centring" harness discrepancy noted in Step 11. The resize caused by the row now places the image again, so it opens exactly as Fit shows it; later resizes still keep its centre (`editorState.ts`, `placeOnNextResize`; 6 reducer tests). The Firefox overlay suite went from 285 to 288 of 288 checks passing.
- The whole image redrawn on every React render. Since Phase 2 that includes every click, selection action, option change and tolerance slider movement. Both canvases now skip frames identical to the last one drawn (`sameFramePlan`; 7 tests). Slider step latency fell from 19–62 ms to 3–5 ms with Chrome's software rendering and from 13–28 ms to 4–6 ms in Firefox, and Firefox clicks on 4K images got 7–17 ms faster (`IMAGE_PROCESSING_SPEC.md`, Final Phase 2 Measurements).

Verification: 706 automated tests (13 added in Step 12), lint, type checking and the production build pass. Headless browser scripts (kept outside the repository) re-ran the Step 7–11 checks, adding imports of every format, failed imports, re-apply against fresh clicks, keyboard-only use, animation lifecycle, a real tab switch and memory.

Known limitations of Phase 2, by severity (details in the step lists above):

- Moderate:
  - Near the 50-megapixel limit, clicks, re-applies, Grow, Shrink and Invert that cover much of the image block the main thread for 0.15–0.4 s, with no progress indication (a click on a small region takes about 50 ms). Synthetic worst cases (noise or one-pixel mazes filling the image) reach about 0.9 s. (Owner decision 1.)
  - After a runtime change of display scaling or browser zoom, when the workspace's size in device pixels is fractional, the browser resamples both canvases, so neither is pixel-exact. In Step 12's window this happened at 125% and 150% (Step 8; owner decision 2).
  - At exact ties (an image pixel edge through a device pixel centre) a click can select the neighbouring pixel the browser drew (Step 7).
- Minor:
  - Zoomed out, the overlay can look one screen pixel larger and hides holes smaller than a screen pixel. Selections with many tiny holes look speckled near 100% (Step 8).
  - The ants are diagonal stripes, not dashes tracing each outline. They slow down on very complex boundaries, pause above 10 million boundary pixels in view, and keep moving in an unfocused but visible window (Step 11).
  - Memory: an Add or Subtract click keeps the selection from before it for re-applying (one more mask: 9.2 MB at 4K, 50 MB at 50 MP). React keeps the selection (and, just after an import, the previous image) of its previous render until it renders again.
  - Clear and Escape do nothing with nothing selected, so they do not end re-applying after a Subtract that removed everything. A click made while a typed tolerance is uncommitted uses the typed value (Step 10).
  - Neither canvas handles a lost 2D context: if the browser drops it (rare, mainly GPU process crashes), the canvas stays blank until the view changes. Since Step 12 a selection change no longer repaints the image. (Both canvases fixed in Phase 3 Step 4, which also found that the image canvas stayed blank after view changes too, and the overlay until the zoom changed.)
- Test coverage only (not product defects):
  - Headless Firefox never has window focus, so blur commits, `:focus-visible` and Space / Enter on buttons cannot be automated there; they were verified in the Step 9–11 manual reviews.
  - Constructed paste events in Firefox carry no files, so Firefox paste is verified manually only.
  - The Step 9 browser script still asserts pre-Step 10 tolerance behaviour.

Decisions remaining for the project owner:

1. Main-thread time near 50 megapixels (D9, open since Step 7): keep everything synchronous, time-slice, or move selection work to a Web Worker. Recommendation: keep it synchronous for Phase 2. Everything up to 4K and 12-megapixel photographs responds in about 120 ms or less, and only images near the limit pause for 0.15–0.4 s. Re-evaluate with real images in Phase 3, where Delete and Undo add more full-image work, and introduce a Worker only if that testing shows the pauses matter.
2. Size the canvas backing stores from `ResizeObserver`'s `devicePixelContentBoxSize` to keep both canvases pixel-exact at fractional scaling (open since Step 8). It touches Phase 1 image rendering, so it would be its own small, separately reviewed change.
3. Whether to commit the benchmark and browser-check scripts (M6). They would need to become dependency-free scripts under `scripts/`; Chrome and Firefox are driven over their own protocols. (Resolved in Phase 3 Step 4: a maintained subset is in `scripts/browser/`.)
4. Optional: keep a just-opened image fitted on every window resize until the user zooms or pans, instead of only for the options row's resize. Recommendation: keep the current, narrower rule.

After the merge: decision 1 carries into Phase 3 as P3-D11 (pixel edits stay synchronous until measured). Decision 2 remains open; decision 3 was resolved in Phase 3 Step 4.

Recommended final manual QA (Linux Mint, Chrome and Firefox, real display):

1. Start a fresh session in a window about 1024 × 768 and open a 4K screenshot: the image is fully visible with a margin, and pressing Fit right away changes nothing (same zoom percentage). Repeat in a wide window.
2. With a selection on a large photograph or 4K screenshot, drag the tolerance slider continuously: the slider follows smoothly and the selection is re-applied once, on release.
3. Open an image near the limit (for example 16384 × 3051 or 8660 × 5773): click, Shift + Click, change the tolerance, then Grow, Shrink and Invert. Judge whether the 0.15–0.4 s pauses are acceptable (decision 1).
4. At 125% or 150% display scaling, and after browser zoom changes (Ctrl + + / Ctrl + −) while an image is open: overlay and image stay aligned; the ants stay smooth.
5. Keyboard only: Tab through the options row, Enter and Space on New / Add / Subtract and Contiguous / Global, arrow keys on the slider (re-applies on release), Ctrl + A and Escape.
6. Switch reduced motion on and off while a selection is shown; switch tabs and minimise while the ants run, then return.
7. Open PNG, JPEG, WebP and SVG files with the picker, by dragging from the file manager and by pasting a screenshot. Then try a renamed non-image file and an SVG with a script: an error message, and the image and selection stay.
8. Replace the image repeatedly while the ants run, watching the browser task manager (Chrome: Shift + Esc): memory returns to the same level each time.

Out of Phase 2: deleting selected pixels, edge cleanup, Auto Trim (Phase 3) and selection Undo / Redo.

---

## Phase 3 — Background Removal and Cleanup

### Goals

Make background removal genuinely useful.

### Work

- Delete Selection.
- Delete keyboard support.
- Transparency handling.
- Edge cleanup.
- Feather control.
- Auto Trim.
- Padding presets.
- Custom padding.
- Trim Tight.
- Undo support for operations.

### Tests

Automated tests for:

- Delete to transparency.
- Bounds detection.
- Padding.
- Fully transparent image.
- Edge conditions.
- Undo restoration.

### Visual Review

Test:

- Screenshots.
- Flat graphics.
- Technical equipment graphics.
- Anti-aliased edges.

### Checkpoint

At this point the application should already perform its primary job:

```text
Open
→ Wand
→ Delete
→ Cleanup
→ Trim
→ Export
```

### Phase 3 Approved Decisions and Steps

Decisions approved by the project owner after review of the Phase 3 architecture proposal. They are recorded in `FEATURE_SPEC.md` (§1, §7–10, §21), `IMAGE_PROCESSING_SPEC.md` (Internal Pixel Representation, Pixel Buffers and Revisions, Delete Selection to History / Undo, Performance), `UI_UX_SPEC.md` (Undo / Redo, Keyboard Shortcuts, Destructive Operations), `ARCHITECTURE.md` (Phase 3 Modules, Web Workers) and `PROJECT_BRIEF.md` (Edge Cleanup).

- P3-D1: Copy-on-write pixel buffers. An edit writes a copy and becomes a new document revision; buffers are never written once they belong to a document.
- P3-D2: Delete sets alpha to 0 and keeps the RGB values internally, hidden, for compact Undo. Hidden colour never becomes visible again, and export (Phase 6) writes fully transparent pixels as 0, 0, 0, 0.
- P3-D3: Delete needs a selection and clears it; Undo restores it.
- P3-D4: Edge cleanup and feathering default to 0 px, to protect fine 2D technical graphics. Whether they run as part of Delete or as a separate action is decided with P3-D5.
- P3-D5: The cleanup algorithm stays undecided until the prototype comparison (Step 7).
- P3-D6: Auto Trim uses alpha-based visible bounds and adjustable padding. The threshold, padding at the image edge, and the effect on the selection and the view are confirmed in Step 10.
- P3-D7: Undo / Redo covers image edits, not individual selection changes.
- P3-D8: History limits: 25 entries and 256 MB, always keeping the newest entry even if it alone exceeds the budget.
- P3-D9: Shortcuts: Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z.
- P3-D10: The display-image creation strategy is verified in Step 4.
- P3-D11: Large-image edits stay synchronous initially, pending measurements.
- P3-D12: Warn before replacing an image that has unsaved pixel edits. Implemented at a later checkpoint, to be agreed.
- Revision model (correction to the proposal): document revisions are never reused within the session. Every pixel edit, Undo and Redo gets a new revision. Undo still restores the earlier pixels, the selection and the Magic Wand click that can be re-applied; the click is rebound to the new document version rather than restoring a stale version identifier, so stale results can never be accepted.

Phase 3 is implemented in twelve reviewed steps, each stopping for review:

1. Record decisions; pixel buffer and revision model. Done.
2. Delete algorithm (pure). Done.
3. History building blocks: pixel patches, crop patches, selection encoding, byte accounting. Done.
4. Display image for edited pixels and render invalidation (verifies P3-D10). (Implemented; awaiting review.)
5. Edit history in the editor state.
6. Delete Selection, Undo and Redo (first manual checkpoint).
7. Edge cleanup prototype and visual comparison (owner decision P3-D5).
8. Edge cleanup and feathering.
9. Optional, depending on P3-D4 and P3-D5: re-apply the last Delete when cleanup or feathering changes.
10. Auto Trim algorithm.
11. Auto Trim tool (second manual checkpoint).
12. Final quality assurance, performance, memory and Phase 3 readiness.

The unsaved-edits warning (P3-D12) needs Undo / Redo (Step 6) to know whether edits exist; its checkpoint is still to be agreed.

#### Step 1: Pixel Buffers and Revisions (done; approved)

- `ImageDocument.pixels` is a `PixelBuffer`: width, height and read-only RGBA bytes. Decoded `ImageData` already has this shape and is stored as it is; the Magic Wand and selection commands take any `PixelBuffer`.
- `image/pixelBuffer.ts`: `validatePixelBuffer` (whole dimensions of at least 1, exact length, 4-byte alignment), `createPixelBuffer` (wraps without copying), `copyPixelData` (the copy-on-write starting point), `sharesPixelMemory`.
- `createEditedDocument` (`editor/imageDocument.ts`) keeps the document's id, name, format, source and file size, takes its dimensions from the new pixels, rejects pixels sharing memory with the current ones, and gives a revision from a session-wide counter: never reused and always increasing. Imported documents keep revision 0. Imports and edits share the same buffer validation.
- `canvas/imageData.ts`: `toImageData` hands a `PixelBuffer` to canvas APIs without copying. The import's display bitmap uses it; for imported pixels it returns the decoded `ImageData` itself, so import behaviour is unchanged.
- Nothing calls `createEditedDocument` yet: the application looks and behaves exactly as at the end of Phase 2.

#### Step 2: Delete Selection Algorithm (done; approved)

- `image/edit/deleteSelection.ts`: `deleteSelectedPixels(pixels, selection)` returns `{ pixels, count, bounds }` (the edited image, the number of pixels made transparent, and the smallest rectangle containing them), or null when nothing would change. Pure: no DOM, no canvas, no `ImageData`.
- Every selected pixel gets alpha 0; only its alpha byte is written, so its colour stays hidden (P3-D2). Unselected pixels, and selected pixels that are already fully transparent, keep every byte; the latter are neither counted nor bounded.
- Copy-on-write: the input pixels and the selection are never written. The scan looks for the first pixel that changes; only then is the image copied (`copyPixelData`), once. A null selection, or one covering only fully transparent pixels, returns null without allocating anything.
- Only the selection's bounds are scanned, and each pixel in them is read once: up to the first change in the source, after it in the copy, so the loop touches one full-size buffer. Nothing else proportional to the image is allocated.
- Throws a RangeError for an invalid pixel buffer, or a selection of another size or whose bounds lie outside the image (constant-time checks).
- 18 tests (`deleteSelection.test.ts`): one pixel, several pixels, full selections, disconnected regions and holes, every edge and corner, 1 × 1 images, opaque, partially transparent (down to alpha 1) and transparent pixels, hidden colour kept, unselected pixels bit-identical, inputs unchanged, one copy only when something changes, no-ops, invalid input, 175 random cases against a per-pixel reference, and 4K and 50 MP cases. Six deliberately introduced defects were each caught by the tests.
- Nothing calls it yet; the production bundle is byte-identical to Step 1's.

Measurements (Node 24, x64, this development machine; browser timings come with the Delete command in Step 6):

| Image | Copy alone | Background (80%) | Everything | 400 × 400 selection | Nothing to delete (all selected, transparent image) |
| --- | --- | --- | --- | --- | --- |
| 1280 × 800 | 0.4 ms | 6 ms | 6 ms | 0.8 ms | 3 ms |
| 3840 × 2400 | 15 ms | 39 ms | 42 ms | 16 ms | 13 ms |
| 8660 × 5773 (50 MP) | 78 ms | 162 ms | 170 ms | 84 ms | 68 ms |

Memory: a Delete that changes something keeps exactly one new image-sized buffer (35 MB at 4K, 191 MB at 50 MP); a no-op allocates nothing.

Known limitations (Step 2):

- The copy is the floor: even a small selection costs a whole-image copy (78 ms of the 84 ms at 50 MP). That is the approved copy-on-write trade-off (P3-D1).
- Copying row by row and deleting while each row is still in cache measured about 10% faster at 50 MP (about 145 ms instead of 162 ms). It was not adopted, to keep `copyPixelData` as the single copy-on-write path; it remains an option if Step 6 browser measurements call for it.
- While the edited image exists, the previous one is kept as well (one more image-sized buffer) until the editor lets go of it; Step 5 and Step 6 decide when that happens.

#### Step 3: History Building Blocks (done; approved)

Pure modules in `editor/history/`, not yet used by the application (the production bundle does not include them):

- `wordRuns.ts`: run-length encoding of 32-bit pixel values, shared by both patch kinds. Tokens SKIP (zeros), FILL (one repeated value) and LITERAL (values stored one by one); runs shorter than 3 are stored as literals, so an encoding never exceeds 4 bytes per value plus 4. Literal values keep only their alpha byte while every literal is alpha-only (always so for Delete): one byte per value, also while encoding. A validator checks the token structure, and the decoder also throws, rather than looping or reading past the end, on malformed input.
- `pixelPatch.ts`: `createPixelPatch(before, after, region?)` stores old XOR new over a region (the Delete result's bounds, or the whole image), or returns null when nothing differs. `applyPixelPatch(pixels, patch)` returns a new buffer (one copy plus the changes); because XOR is its own inverse, the same patch turns the edited pixels back into the original and the original into the edited pixels, byte for byte, hidden colour included.
- `cropPatch.ts`: `cropPixels(pixels, kept)`, `createCropPatch(original, kept)` (null when nothing is removed) and `restoreCroppedPixels(cropped, patch)`. The patch keeps the original size, the kept rectangle and every removed pixel once, in row order (rows above, each kept row's left and right parts, rows below), run-length encoded as raw RGBA. Not the Auto Trim algorithm: that finds the rectangle (Step 10).
- `selectionCodec.ts`: `encodeSelection(mask | null)` stores only the bounds, as varint row runs or packed bits, whichever is smaller (never more than an eighth of the bounds' area in bytes); `decodeSelection` returns a new mask the caller owns and checks its count and bounds.
- `historyBytes.ts`: `retainedBytes(payloads)` sums each distinct ArrayBuffer's full size plus estimated object overhead (256 bytes per payload and per array), counting shared buffers and repeated payloads once.
- Patches and encoded selections refer to no document, revision or bitmap. Step 5 applies them to the current pixels and makes a new revision (`createEditedDocument`).
- 53 tests: round trips in both directions on random images and edits (alpha only, colour only, all channels), hidden colour, single pixels, full images, scattered and contiguous changes, every edge and corner, regions of full rows and narrower ones, crops removing any combination of sides including 1-pixel images, sparse, dense, noisy, empty and full selections, ownership and immutability, malformed input of every kind, byte accounting with shared buffers and views, size bounds, and 4K and 50 MP cases. Twelve deliberately introduced defects were each caught.

Measurements (Node 24, x64; each case in its own process; browser timings come with Undo / Redo in Step 6):

| 50 MP (8660 × 5773) case | Stored | Create | Apply / restore | Peak above inputs |
| --- | --- | --- | --- | --- |
| Delete, background around an object, opaque photo or flat colour | 35 KB | 150 ms (88 ms in isolation) | 110 ms | none measurable |
| Delete, same, anti-aliased (partly transparent) edge | 97 KB | 152 ms | 113 ms | none measurable |
| Delete, every pixel a different alpha (worst Delete) | 47.7 MB (1 byte per pixel) | 444 ms | 142 ms | 149 MB |
| Any edit changing every pixel differently (worst case) | 190.7 MB (4 bytes per pixel) | about 490 ms | 138 ms | 324 MB |
| Crop removing 18 M pixels of transparent black or one colour | 0.8 KB | 27–35 ms | 56–76 ms | none measurable |
| Crop removing 18 M pixels of a deleted photo background | 68.7 MB (4 bytes per pixel) | 170 ms | 80 ms | 170 MB |
| Selection: background of an ellipse, full, sparse dots | 0–62 KB (runs) | 97 ms | 4–19 ms | none measurable |
| Selection: text-like or noise | 6.0 MB (bits) | 116–135 ms | 107–114 ms | 17 MB |

At 4K (3840 × 2400) the same cases take about a fifth of the time: a background Delete patch is 15–42 KB, created in 30 ms and applied in 25 ms; a selection encodes in 20–31 ms.

Known limitations (Step 3):

- An edit that changes many pixels in different ways costs up to 4 bytes per changed pixel: a whole 50 MP image changed arbitrarily makes a 191 MB entry, and creating it briefly needs about 1.7 times that. Delete costs at most 1 byte per deleted pixel (48 MB at 50 MP, when every alpha differs), and a crop of a varied (for example photographic) background 4 bytes per removed pixel. Typical Delete and Auto Trim entries are kilobytes. Such large entries are what the 256 MB budget and the "keep the newest entry" rule (P3-D8, Step 5) are for.
- Patches hold pixel values in the platform's byte order. History lives only in memory, so this never matters; it would if history were ever saved.
- At 50 MP a Delete with Undo will cost about 0.15 s for the patch and 0.1 s to encode the selection, on top of the Delete itself (Node). Reading the mask four bytes at a time measured about a third faster, and a Delete patch could be built from the selection instead of comparing whole images; both are left for the Step 12 performance review, if browser measurements call for them.
- Undo of a Magic Wand Add or Subtract click must also keep the selection from before that click (`MagicWandOperation.base`); Step 5 stores it as an encoded selection too.

#### Step 4: Display Image and Renderer Invalidation (implemented; awaiting review)

Verifies P3-D10: edited pixels can reach the screen synchronously, so an edit can replace the document and the image that shows it in one editor update. Nothing creates edited display images yet (Step 6); imports still create their bitmap with `createImageBitmap`.

- `canvas/displayImage.ts`: `createDisplayImage(pixels)` validates the buffer (RangeError before anything is allocated), writes it once with `putImageData` into an `OffscreenCanvas` and takes the result with `transferToImageBitmap`. Where `OffscreenCanvas`, its 2D context or `transferToImageBitmap` is missing, a canvas element (never added to the page) is the display image instead: also synchronous, also drawable by the renderer. `DisplayImage` is `ImageBitmap | HTMLCanvasElement`. The pixel buffer is wrapped (`toImageData`), never copied or written. A strategy that is unavailable passes to the next; one that fails (for example a canvas too large for memory) releases what it allocated and throws.
- Both canvases are created with `willReadFrequently`, which keeps them in main memory. Measured in Chrome 156 with GPU rendering: after the GPU process restarts, a GPU-backed bitmap or canvas silently draws nothing, so the image could not be drawn again; main-memory bitmaps survive, as the import path's bitmaps do. It also makes edited display images show exactly the bytes imported ones show (with GPU-backed canvases Chrome rounded 22 colour values of partially transparent pixels, out of 1,024 test pixels, one level differently).
- `releaseDisplayImage` (closes a bitmap, empties a canvas), `isReleasedDisplayImage`, `displayContentKey(document)` (`id:revision`) and `createDisplayImageOwner` (releases the image shown before once another has been shown; showing the same image again releases nothing).
- `workspaceRenderer.render(plan, content)` takes `{ image, key }`. A frame is skipped only when the image, the content key and the frame plan all equal the last frame drawn, so a new revision is drawn even with the same image object, and a new image even with the same key. `invalidate()` makes the next render draw even an identical frame; nothing calls it yet. A frame that throws while drawing is not counted as shown. A released image is never drawn (drawImage would throw): the canvas is cleared instead.
- Context restoration: on `contextrestored` the renderer draws the last frame again at once, and makes the checkerboard pattern again. A pattern made before the loss turned out to make every later draw on the restored canvas produce nothing in Chrome, which is why the Phase 2 canvas stayed blank even after the view changed. The event is never cancelled (that would stop the browser restoring the context).
- `ImageCanvas` passes the content key, draws the new image first and only then releases the replaced one (`createDisplayImageOwner`, kept in state across effect re-runs). Nothing is released in effect clean-ups, which React Strict Mode runs while the image is still shown.
- Selection overlay restoration (added after the first review): on `contextrestored` the overlay renderer drops every tile and draws its last frame again in the current boundary pattern, so the tint and boundary come back at once, with no zoom, pan or other action. See "Corrections after the first review" below.

Ownership contract for Steps 5 and 6 (also in `displayImage.ts` and `ARCHITECTURE.md`, which has a table of who holds what):

- A command creates the display image synchronously in its event handler, never in a reducer or state updater (React Strict Mode runs those twice), and dispatches it in the same action as the document it shows. Before dispatching it checks the result is still current, as the reducer will; if it is not, or anything fails after creation, it releases the image itself.
- Once accepted, the editor state holds it, and the workspace canvas releases it after the commit that replaces it, once the replacement is drawn. A remounted canvas takes over the image shown.
- The canvas releases only images it has shown. An image whose action the reducer rejects after dispatch, or that a later action in the same commit replaces, is left to garbage collection: only the committed state tells whether it is in use, so an explicit release there could blank the canvas.
- Display images are never kept in history or reused for another revision, and no state may bring back an image an earlier state replaced. Undo and Redo create new ones.

Tests: 46 added (857 in total), 8 of them after the first review (below). `displayImage.test.ts` (24) against fake canvases that keep their own pixel copy: sizes, every alpha value 0–255 with hidden colour, no copy before the write and none written to the pixels (also after release and after failures), independent images, `willReadFrequently`, the OffscreenCanvas canvas released after the transfer, all three fallback triggers, invalid buffers (no canvas created), no 2D context of either kind, write, transfer and size failures (everything released), release and the owner's Strict Mode sequences. `workspaceRenderer.test.ts` (18, replacing 4): skipped identical frames, key and image changes, every kind of view change, invalidation, retry after a failed draw, restoration (last frame, frames asked for while lost, nothing before the first frame, listener removed on dispose, event not cancelled), released images, replacement order, Strict Mode re-creation, and device-pixel alignment at ratios 1–3 and zooms 25–800% through invalidation and restoration. Sixteen deliberately introduced defects were each caught (one only after a test was strengthened).

Browser verification (production build, headless Chrome 156 and Firefox 158):

- Imports of PNG, JPEG, WebP and SVG, with and without transparency (including a PNG and WebP with every alpha value and hidden colour under alpha 0, and an SVG with partial opacity) and a 4K screenshot, at 100%, 200% and 400% (whole device scales), before and after panning, at device pixel ratios 1, 1.5 and 2 (Firefox 1 and 2) and with Chrome GPU rendering: every opaque pixel shows exactly, every fully transparent pixel shows exactly the checkerboard, partially transparent pixels are within 1.3 levels of the exact blend; images are drawn at Fit. All 87 checks pass in each configuration at ratio 1 (71 at ratio 2). At ratio 1.5 in Chrome, 20 of 71 checks fail on a single device row where the checkerboard shows through (alpha 254, one level off; opaque pixels exact), identically with the build before Step 4.
- Redraws: a Magic Wand click, 20 tolerance changes and clearing the selection draw the image 0 times; a zoom step, a pan and a workspace resize once each. The replaced image's bitmap is released and the current one stays live.
- The same checks pass with the development build, where React Strict Mode runs.
- A GPU process crash (its process killed, headless Chrome with GPU): the workspace canvas fires `contextlost` and `contextrestored` and redraws the image at once with every pixel exact and no app activity. Before Step 4 it stayed blank, also after zooming.
- `createDisplayImage` itself, built from the project's modules: an `ImageBitmap` in both browsers, a canvas element when the fallback is forced (no `OffscreenCanvas`, or no `transferToImageBitmap`); every path shows the same bytes as `createImageBitmap` of the same pixels (opaque exact, alpha 0 as transparent black, alpha exact, colour within one premultiplied level); pixels unchanged; 16384 × 3051 and 8660 × 5773 created.

Creation time, synchronous (median of 5 runs, opaque and deleted-background content alike, ratio 1; Node has no canvas, so there are no Node timings):

| Image | Chrome | Chrome, GPU rendering | Firefox | Firefox, canvas element | `createImageBitmap` (import path; Chrome / Firefox) |
| --- | --- | --- | --- | --- | --- |
| 1280 × 800 | 3.5–3.9 ms | 1.7–2.2 ms | 4–6 ms | 3–4 ms | 3–5 / 3–4 ms |
| 1920 × 1080 | 3.1 ms | 3.1 ms | 6–8 ms | 3–5 ms | 4.4 / 5–6 ms |
| 3840 × 2160 | 13 ms | 13 ms | 23–25 ms | 12 ms | 16–18 / 20 ms |
| 3840 × 2400 | 14.5 ms | 14 ms | 26 ms | 13 ms | 18–20 / 23 ms |
| 4032 × 3024 | 19 ms | 19 ms | 33–34 ms | 17 ms | 24–25 / 30–31 ms |
| 8660 × 5773 (50 MP) | 77 ms | 77 ms | 137–139 ms | 69–70 ms | 98–99 / 126 ms |
| 16384 × 3051 (50 MP) | 76 ms | 75–77 ms | 138–139 ms | 68–69 ms | 101 / 124–125 ms |

In Chrome the canvas element takes the same time as the transfer. Until the first frame is on the canvas (creation, drawing at Fit, finishing the drawing): 31–34 ms at 4K and 106–118 ms at 50 MP in Chrome, 28–30 ms and 140–144 ms in Firefox.

Memory (resident memory of the browser's processes, Linux):

- Chrome: creating a display image needs exactly the image's size (35 MB at 4K, 191 MB at 50 MP) and no more at its peak, for both strategies; the transfer copies nothing. Released images give it back. After a transferred bitmap's first draw, the page's process keeps about one more image's size at 4K and a third to half of one at 50 MP; it stays constant over repeated create, draw and release cycles (no accumulation) and does not occur with canvas elements or `createImageBitmap`.
- Firefox: the transfer copies, so creation briefly needs twice the image's size (68 MB at 4K, 378 MB at 50 MP), the same as `createImageBitmap` on import; the canvas element needs once its size. Sixteen cycles at 4K rose to 1.5 images and fell back to 0.4: no accumulation.

##### Corrections after the first review

The review approved the display-image architecture, the transfer-first strategy with the canvas-element fallback, the content key and the image canvas's restoration in principle, and asked for three things before the step is committed.

Selection overlay recovery after context restoration:

- Root cause: the overlay renderer did not listen for `contextrestored`, and its tile cache kept canvases whose pixels the browser had lost. Measured in Chrome 156 (headless, with and without `--enable-gpu`): a GPU process restart blanks every canvas that lived on the GPU, including every 256 × 256 tile canvas, and restores the tiles just before the overlay canvas. Nothing redrew the overlay canvas. Marching-ants steps repaint only each tile's boundary area from pixels kept in memory, so with the ants about half the overlay came back (211,883 of 421,608 pixels) and with reduced motion none of it. A pan reused the blank tiles; only a zoom change, which rasterises every tile again, recovered.
- Fix (`selectionOverlayRenderer.ts`): on `contextrestored` the renderer releases every tile and draws its last frame again in the current boundary pattern. That rasterises only the visible tiles, once, as a zoom change does. The selection is only read; the editor state, the tile approach, device-pixel placement and reduced-motion behaviour are unchanged. `dispose()` removes the listener, and `contextlost` is not cancelled. Making the tiles `willReadFrequently` instead would not have been enough: in Chrome's software mode even main-memory canvas elements came back blank.
- Tests (`selectionOverlayRenderer.test.ts`, 6 added): fake canvases that draw nothing while the "GPU" is lost and come back blank, tiles first, as measured. They check that the overlay comes back exactly (static and marching, at zooms 25–800% and ratios 1–2 with fractional offsets), that later steps and pans never reuse blank tiles, that frames asked for while lost are drawn, that each restoration draws once and rasterises only the visible tiles, that reduced motion stays static with nothing scheduled, and that nothing happens without a selection or after disposal. Without the fix, 5 of them fail. Four other deliberate defects were each caught: keeping the blank tiles, skipping the redraw, redrawing in the static pattern, and leaving the listener after disposal.

Display-image ownership review: no image is released before its last draw, and no correction to the code was needed.

- An image replaced in the state is released after the replacement is drawn.
- A rejected stale import's bitmap is closed by the import runner.
- Effect replays and remounts release nothing.
- A remounted canvas's new owner takes over the image shown.
- A released image left in the renderer's last frame is never drawn, also on restoration.

The analysis found one case to document rather than change. An image whose action is rejected, or replaced within one commit, can only be left to garbage collection: only the committed state tells whether it is in use. The ownership contract above now states this, and that reducers never create or release images. Two tests were added (`displayImage.test.ts`): the owner releases only images it has shown, and a remounted canvas takes over.

Browser scripts (M6): `scripts/browser/` holds dependency-free, manually run scripts, outside `npm test`; see its `README.md`.

- `smoke.mjs`: the rendering smoke test, now also checking the overlay's tint, emptiness and boundary against the selection, pixel by pixel.
- `gpu-crash.mjs`: opt-in, Linux. It kills only the GPU process of the headless Chrome it started, found among that browser's own descendants.
- `display-image-bench.mjs`: correctness and timing.
- `fixtures.mjs`: generates the images into a Git-ignored folder.

Not kept from the investigation scripts:

- The one-off API probes, whose findings are recorded here.
- The `/proc`-based memory measurements, which depend on Chrome's and Firefox's process trees and spare processes, so they are fragile.
- The Fast Refresh experiment, which did not work.
- The Phase 2 overlay and Step 9 scripts, which assert older behaviour.

Verification of the corrections (production build, headless Chrome 156 and Firefox 159):

- `smoke.mjs`: Chrome and Firefox pass every check at ratio 1 (94 checks) and ratio 2 (76). The checks cover 8 files, the overlay at 100–400% before and after panning, redraw counts and release. The development build (React Strict Mode) passes all 94 in both browsers. Chrome at ratio 1.5 passes 56 and fails the same 20 checks, with the same counts, as the build before Step 4: the existing limitation below.
- `gpu-crash.mjs`, in Chrome's default headless mode and with `--enable-gpu`, at ratios 1 and 2, each with reduced motion and with marching ants (46 checks per mode, all passing). Without any action after the crash:
  - Both layers lose and regain their contexts.
  - The image is exact.
  - The overlay is complete and aligned: identical to before the crash with reduced motion, the same coverage with the ants.
  - The selection, document and view are the same objects as before.
  - The image is drawn once, and with reduced motion nothing is drawn while idle.
  - A pan that moves the view still draws correctly.

  The same script against the Step 4 build without the overlay fix fails exactly where expected. With reduced motion the overlay is blank (0 pixels painted); with the ants half of it is missing; after the pan it is still missing. The image layer passes there too.
- Firefox: a synthetic `contextrestored` on both canvases, after blanking them, redraws the overlay completely and the image exactly (Chrome the same). This checks the wiring only: a real context loss cannot be caused in headless Firefox.
- `display-image-bench.mjs`: all correctness checks pass in both browsers. Timings agree with the table above. At 3840 × 2160 and 8660 × 5773, the transfer took 13.1 and 78 ms in Chrome and 24 and 138 ms in Firefox; Firefox's canvas element took 12 and 70 ms, and `createImageBitmap` 16.6 and 100 ms in Chrome and 21 and 129 ms in Firefox.

Known limitations (Step 4):

- Firefox copies the canvas in `transferToImageBitmap` (11 ms at 4K, 68 ms at 50 MP), doubling creation time and peak memory against the canvas element. Accepted for now (owner decision); to be revisited with whole-Delete measurements in Step 6 or the Step 12 performance review.
- Keeping display images in main memory costs Chrome with GPU rendering a CPU write at creation (13 ms at 4K, 77 ms at 50 MP) where a GPU-backed canvas defers the work (time to first frame at 50 MP 111 ms instead of 49 ms in the measurement of the variants), in exchange for surviving a GPU process restart and matching imported pixels exactly.
- Existing limitation, recorded rather than changed: in Chrome at device pixel ratio 1.5, one device row of the image canvas is left very slightly transparent (alpha 254 instead of 255) where the image is transparent or partly transparent, so the checkerboard there is one level off; opaque pixels are exact. Builds before Step 4 behave identically. It belongs with the `devicePixelContentBoxSize` carry-over from Phase 2.
- Deferred to desktop compatibility testing: WebKitGTK, the engine of the planned Linux desktop build.
- Not verified: context restoration after a real context loss in Firefox, whose headless mode has no separate GPU process to crash. The listener wiring is verified with a synthetic event. A manual check on a desktop would need a GPU reset.
- Fast Refresh with an image open did not re-run the effects in the browser, so re-creating the renderers with an image shown is verified by unit tests only.

Owner decisions (from the first review):

1. Display image strategy: keep `transferToImageBitmap` first and the canvas-element fallback. Reconsider the trade-off when the whole Delete workflow can be measured (Step 6) or in the Step 12 performance review.
2. Selection overlay restoration: done in this step (above).
3. Browser scripts (M6): approved; added under `scripts/browser/`.

---

## Phase 4 — Crop and Colour Tools

### Goals

Complete the primary image-preparation workflow.

### Work

#### Crop

- Click/drag crop.
- Dark outside region.
- Handles.
- Width/height.
- Enter confirm.
- Escape cancel.

#### Colour

- Eyedropper.
- HEX display.
- RGBA display.
- Colour picker.
- Replace Colour.
- Colour tolerance.
- Preview.
- Apply.
- Undo.

### Later in Phase if Stable

Prototype shading-preserving recolour.

### Tests

- Crop bounds.
- Crop dimensions.
- Coordinate conversion.
- Exact colour replacement.
- Tolerance replacement.
- Alpha preservation.

---

## Phase 5 — Image Utilities

### Goals

Add useful secondary editing tools without bloating the application.

### Work

- Resize.
- Rotate 90° clockwise.
- Rotate 90° counter-clockwise.
- Flip horizontal.
- Flip vertical.
- Brightness.
- Contrast.
- Grayscale.
- Solid background.
- Outline/stroke.

Each feature should be:

- Undoable.
- Tested.
- Kept simple.

---

## Phase 6 — Export and Workflow Polish

### Goals

Make the web version feel complete.

### Work

- PNG export.
- JPEG export.
- WebP export.
- Export naming.
- Save/download flow.
- Clipboard copy.
- Keyboard shortcuts.
- Focus handling.
- Accessibility review.
- Performance review.
- Memory review.
- History limit.
- Error handling.
- Empty states.
- Loading states.
- Responsive polish.

### Performance Target

Normal screenshots and 4K images should remain practical to edit without severe freezes.

Optimise only after profiling.

---

## Phase 7 — Desktop Application

### Technology

Tauri.

### Goals

Package the existing web application rather than rebuilding it.

### Platforms

Primary:

- Linux
- Windows

### Work

- Tauri setup.
- Native Open dialog.
- Native Save As.
- File path handling.
- Last export directory.
- Application packaging.
- Linux testing.
- Windows testing.

Core image-processing code must remain platform-independent.

---

## Phase 8 — Experimental SVG Vectorisation

### Status

Optional / Experimental.

Do not begin until the raster editor is stable.

### Goals

Convert suitable cleaned images into vector SVG output.

### Work

Potentially:

- Evaluate SVG tracing libraries.
- Build vectorisation preview.
- Detail level controls.
- Colour reduction options.
- Smooth vs sharp tracing.
- SVG export.
- Compare output quality.

### Suitable Content

Best candidates:

- Technical graphics.
- HMI assets.
- Logos.
- Icons.
- Flat illustrations.
- Limited-colour images.

### Important

Do not promise perfect vector conversion of photographic images.

---

## Phase Development Rules

For every phase:

1. Read relevant documentation.
2. Inspect existing implementation.
3. Define the exact task.
4. Make only required changes.
5. Run tests during development.
6. Run lint/type/build checks.
7. Stop at the phase checkpoint.
8. Report changed files.
9. Report tests.
10. Report unresolved problems.
11. Do not commit or push.

---

## Agent Usage

Claude Code is currently expected to perform most implementation work.

ChatGPT and the project owner will provide tightly scoped prompts.

Agents should not independently jump between phases.

A review pass may be performed before moving to the next phase.
