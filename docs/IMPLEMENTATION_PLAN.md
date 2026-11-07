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
- P3-D4: Edge cleanup and feathering default to 0 px, to protect fine 2D technical graphics. Whether they run as part of Delete or as a separate action is decided with P3-D5. (Resolved after Step 7: both run as part of Delete Selection, one history entry, 0–5 px each, default 0.)
- P3-D5: The cleanup algorithm stays undecided until the prototype comparison (Step 7). (Resolved: Candidate B, background-colour decontamination, approved by the owner after reviewing the Step 7 comparison; implemented in Step 8.)
- P3-D6: Auto Trim uses alpha-based visible bounds and adjustable padding. The threshold, padding at the image edge, and the effect on the selection and the view are confirmed in Step 10.
- P3-D7: Undo / Redo covers image edits, not individual selection changes.
- P3-D8: History limits: 25 entries and 256 MB, always keeping the newest entry even if it alone exceeds the budget.
- P3-D9: Shortcuts: Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z.
- P3-D10: The display-image creation strategy is verified in Step 4.
- P3-D11: Large-image edits stay synchronous initially, pending measurements.
- P3-D12: Warn before replacing an image that has unsaved pixel edits. Implemented in Step 6 (approved for checkpoint commit; part of its manual QA deferred), described as unexported edits until export exists.
- Revision model (correction to the proposal): document revisions are never reused within the session. Every pixel edit, Undo and Redo gets a new revision. Undo still restores the earlier pixels, the selection and the Magic Wand click that can be re-applied; the click is rebound to the new document version rather than restoring a stale version identifier, so stale results can never be accepted.

Phase 3 is implemented in twelve reviewed steps, each stopping for review:

1. Record decisions; pixel buffer and revision model. Done.
2. Delete algorithm (pure). Done.
3. History building blocks: pixel patches, crop patches, selection encoding, byte accounting. Done.
4. Display image for edited pixels and render invalidation (verifies P3-D10). Done.
5. Edit history in the editor state. Done; approved.
6. Delete Selection, Undo and Redo (first manual checkpoint). Approved for checkpoint commit with outstanding manual QA: 14 of 23 checks passed, 9 deferred (see Step 6).
7. Edge cleanup prototype and visual comparison (owner decision P3-D5). Done; Candidate B approved.
8. Edge cleanup and feathering. Its manual QA also runs the nine deferred Step 6 checks. Implemented; awaiting owner manual QA.
9. Re-apply the last Delete when cleanup or feathering changes. Implemented; awaiting owner review (Step 8 manual QA still outstanding).
10. Auto Trim algorithm.
11. Auto Trim tool (second manual checkpoint).
12. Final quality assurance, performance, memory and Phase 3 readiness. Revisits Step 6 owner decision 1 (synchronous Delete, Undo and Redo on large images). Phase 3 sign-off and merge require every deferred Step 6 check to be completed or explicitly dispositioned.

The unsaved-edits warning (P3-D12) is implemented with Step 6, which first gives the editor edits to protect.

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

#### Step 4: Display Image and Renderer Invalidation (done; approved)

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

#### Step 5: Edit History in the Editor State (done; approved)

The editor state keeps an Undo / Redo history of image edits, and commands turn a completed edit, Undo and Redo into editor actions. Nothing in the application calls the commands yet: Delete Selection and the Undo / Redo controls and shortcuts are Step 6. The application looks and behaves exactly as at the end of Step 4; imports now also clear the (always empty) history.

Modules:

- `editor/history/historyEntry.ts`: `HistoryEntry`: the edit's kind (`delete-selection` or `auto-trim`), its patch (`PixelPatch` or `CropPatch`), the selection before the edit, the Magic Wand click that could be re-applied before it (seed, flood mode, New / Add / Subtract, tolerance and its previous selection), the selection after the edit, and its retained bytes. Every selection is stored with the Step 3 codec. `createHistoryEntry` encodes each mask once: when the edit keeps the selection, or the click's previous selection is the selection itself (an Add that added nothing), one encoded copy is shared. `restoreSelectionBefore` and `restoreSelectionAfter` decode into new masks, one shared mask where one copy was shared. Entries hold no pixel buffer, document, version, revision, display image or mask.
- `editor/history/editHistory.ts`: `EditHistory` (limits, the version it is bound to, the Undo and Redo stacks, retained bytes), `recordEdit`, `recordUndo`, `recordRedo`, `nextUndo`, `nextRedo`, `clearEditHistory`, `historyRetainedBytes`. Pure and cheap (no pixel work; accounting reads buffer sizes only), so it runs inside the reducer.
- `editor/historyCommands.ts`: `completedEditCommand(state, edit, createImage)`, `undoCommand`, `redoCommand` and `availableHistoryActions` (constant time, for the Step 6 controls). A `CompletedEdit` is what a tool computed from the open document: its version, the edited pixels and optionally the rectangle containing every change (Delete's bounds), or a crop rectangle; and the selection it leaves. `createImage` defaults to `createDisplayImage` and is injected in tests.
- `editor/editorState.ts`: `history` and `editError` in the state; `documentBitmap` widened to `DisplayImage`; actions `edit-applied`, `edit-undone`, `edit-redone`, `edit-failed` and `edit-error-dismissed`. `DocumentVersion` moved to `types.ts` (still exported from `editorState.ts`). `Workspace` takes a `DisplayImage`.

What happens where:

- Commands (outside the reducer, in the future event handlers): the patch (`createPixelPatch` over the edit's region, or `createCropPatch` and `cropPixels`), the encoded selections, the new revision (`createEditedDocument`) and, last, its display image. Undo applies the patch backwards (`applyPixelPatch` or `restoreCroppedPixels`) to the current pixels, Redo forwards (`applyPixelPatch` or `cropPixels`), and both decode the selection they restore. Any failure (an exception from these, including running out of memory or a damaged entry) gives an `edit-failed` action and creates nothing; since the display image is created last, nothing can fail once it exists. An edit that changes no pixel returns null: no entry, no revision, no image.
- Reducer: constant-time checks (plus the history's accounting), then the document, display image, selection, Magic Wand click and history change together. A rejected action returns the state object itself, so nothing is ever partly applied. `edit-failed` only records the error; the document, selection and history stay.

Transitions:

| | Document | Selection | Magic Wand click | History |
| --- | --- | --- | --- | --- |
| Edit accepted | New revision, its display image | The one the edit leaves (none for Delete) | None | Redo cleared, entry added, oldest dropped to the limits, bound to the new version |
| Undo | Pixels before the edit, as a new revision | From just before the edit | From just before the edit, bound to the new version | Top entry moved to Redo, bound to the new version |
| Redo | Pixels after the edit, as a new revision | The one the edit left | None | Top Redo entry moved back, bound to the new version |
| Edit, Undo or Redo failed | Unchanged | Unchanged | Unchanged | Unchanged; `editError` set |
| Selection change, Magic Wand click or re-apply | Unchanged | Changed | As in Phase 2 | Unchanged: no entry, Undo and Redo stay available |
| Another image opened | Replaced | None | None | Cleared (limits kept); `editError` cleared |
| Import failed, rejected, superseded or in progress | Unchanged | Unchanged | Unchanged | Unchanged |

`editError` is cleared by `edit-error-dismissed`, the next accepted edit, Undo or Redo, and a successful import. How it is shown is Step 6.

Preventing a patch from being applied to the wrong pixels. A pixel patch is an XOR: applied to the wrong state, or twice, it silently produces a wrong image, so applicability is never judged by the patch's size alone:

1. Binding: the history records the document version (id and revision) its stacks apply to. Every accepted edit, Undo and Redo rebinds it to the new version in the same reducer step, and revisions are never reused, so no other content state, of this image or another, ever has that version. A history bound to any other version offers nothing (`nextUndo` and `nextRedo` return null), and the next edit drops its entries.
2. Version tags: every action carries the version it was computed from, and the reducer accepts it only for the open document's current version.
3. Entry identity: Undo and Redo carry the entry they applied, which must still be the next one on the bound history. Two Undos computed from the same state therefore apply once: the second is stale.
4. A new content state: the action's document must be the same image (id), with a revision greater than the current one (an earlier document or revision can never come back), pixel memory of its own (copy-on-write), and a display image of its size.
5. Sizes: the patch must turn an image of the current size into one of the new size (in the right direction for Undo), and every selection, and the restored click's previous selection, must be the new document's size.
6. Edit basis: an edit must have been computed with the state's current selection and Magic Wand click (identity). Selection changes do not change the revision, so without this a Delete computed before a selection change could delete pixels that are no longer selected.
7. The commands compute only for the current version, and the patch functions refuse pixels of another size. Redo of a crop also checks the image's size before cropping, since any image containing the kept rectangle could be cropped by it.
8. Rejection is permanent: versions only move forward, so an action rejected once, or accepted once, is rejected by every later state. Undo restoring identical pixels does not make earlier work valid again. This is what lets a rejected action's display image be released safely (below).

Selection and Magic Wand context:

- Undo restores the selection from just before the edit and the Magic Wand click recorded then, including the previous selection of an Add or Subtract click, all decoded into new masks. The click's `version` is the restored document's new version, never the one recorded at the time: the restored pixels and selection are exactly those it was made on, so it can be re-applied, and the stale version it had can never be accepted again. Its tolerance is the one that produced the selection, whatever the tolerance setting is now, so a committed tolerance that differs re-applies it exactly as it would have before the edit.
- Redo restores the selection the edit left (none after Delete) and no click: the pixels it was made on have changed.
- Both replace whatever the selection is at the time of the Undo or Redo; selections made in between are not history (P3-D7). No selection (`null`) is restored as no selection.

Limits and memory accounting (P3-D8):

- At most 25 entries and 256 MB (MiB, 2^20 bytes, as elsewhere in these documents) retained, counted over both stacks with `retainedBytes`: each distinct buffer and payload once, so a selection shared between an entry's before and after is counted once.
- Only recording can exceed the limits: a new edit clears Redo first, and Undo and Redo move entries without changing what is kept. The oldest entries are dropped first, by count and then by bytes (the total is counted again after each drop, as entries can share payloads). The newest entry is always kept, even alone above the budget.
- Typical entries are kilobytes: a 4K background Delete with its selection and Magic Wand click retains under 64 KB in the tests (the image is 36.9 MB, the mask 9.2 MB). The budget matters for the worst cases measured in Step 3 (up to 191 MB for an edit changing every pixel of a 50 MP image differently): one such entry fits with smaller ones, a second drops everything older until it fits, and a single 300 MB entry is kept on its own.
- What history does not count: the current document's pixels, its display image, and the previous document React keeps until its next render (one more image-sized buffer for a moment). The limits are for history only, as approved.

Revisions: every accepted edit, Undo and Redo gets a revision from the session-wide counter (`createEditedDocument`), larger than any before. Undo back to the opened pixels does not bring back revision 0. Revisions are made by the commands; the reducer refuses any document whose revision is not newer than the current one.

Display images and resource ownership (the Step 4 contract, unchanged):

| Case | What happens to the display image |
| --- | --- |
| Edit, Undo or Redo accepted | Held by the state; the canvas releases the one it replaced once the new one is drawn |
| Command fails (no image created) | Nothing to release: the image is created last |
| Action rejected as stale | Never held by any state. Left to garbage collection today; the Step 6 safeguard below releases it |
| Rapid actions computed from the same state | The first is accepted, the rest rejected as stale (as above) |
| Accepted, then replaced in the same commit before it was drawn | Never shown, so the canvas does not release it; garbage collection (Step 6 safeguard) |
| React Strict Mode runs the reducer twice | Both runs store the same image object from the action; reducers never create or release images |
| Successful import | Replaces the image; the canvas releases the edited one after drawing the import |
| Failed import | Nothing changes |

Undo and Redo always create a new display image for their new revision; history never holds one, and no state can bring back an image a state replaced.

Required Step 6 safeguard (abandoned display images). Commands compute from the latest committed state, but an action can still be processed against a later state than the one it was computed from (two key presses before React commits), and then it is rejected, or it replaces the image before it is drawn. Only the committed state tells whether the image is in use. For Step 6:

1. Dispatch each edit, Undo and Redo action inside `flushSync`, so that the action is processed and committed, and the layout effect that keeps the latest committed state has run, before the handler continues.
2. Then, if the committed state's `documentBitmap` is not the action's image, release it (`releaseDisplayImage`).

This is safe because no state can hold that image later: only its own action carries it, that action has been processed, rejection is permanent (point 8 above), and no state brings back a replaced image. Releasing is idempotent, so an image the canvas has already released is harmless to release again. The approach must be verified in the browser with Step 6, including React Strict Mode; if it is not adopted, such images stay with garbage collection, as approved in Step 4.

Viewport for size changes (provisional): a crop, and its Redo, keep the zoom and move the image so the pixels both images have stay where they were on screen; Undo of a crop moves it back, returning exactly to the view before the crop. The image is kept reachable. Same-size edits never change the view. The view after Auto Trim is confirmed in Step 10 (P3-D6).

Tests: 64 added (921 in total).

- `editHistory.test.ts` (17): empty history and limits validation, binding to versions of the same and other documents, stack order, refusal of anything but the next entry, Redo cleared by a new edit, unbound entries dropped, eviction by count (25) and by bytes, room made for a large entry, the oversized newest entry kept, shared payloads counted once, 50 MP worst-case entries against the 256 MB budget (allocated, never written), clearing with the same limits, and immutability.
- `historyEntry.test.ts` (7): what an entry keeps (an object-graph walk finds only the payloads' own buffers), restoring the selection and an Add / Subtract click's previous selection exactly as new masks, the shared mask, no selection, New and Subtract-from-nothing clicks, a selection kept by the edit, crops with selections of both sizes, size validation, inputs never written.
- `historyCommands.test.ts` (40), the commands and the reducer together: the 24 cases asked for (including a valid edit, stale revisions, other documents, Redo cleared, stack order, fresh revisions, exact pixel and crop restoration with hidden colour, selection, Magic Wand and Add / Subtract restoration with re-applies checked against fresh results, selection changes without entries and with Redo kept, imports, limits, the oversized entry, rejected actions on a deeply frozen state, Strict Mode replays, no-ops and failures), plus edits computed with a selection that has since changed, two Undos or Redos computed from one state, stale work after Undo to identical pixels, edits that return the pixels to an earlier state, an unbound history, damaged entries, a crop's Redo on another image size, the view after crops, and a 4K background Delete (entry under 64 KB, no buffer as large as the mask in history, exact Undo and Redo).
- Randomized: 40 seeds × 60 steps of edits (Delete and arbitrary changes, alpha-only or every channel, regions), crops, Undo, Redo, selection changes, Magic Wand clicks of every mode and re-applies, failed imports and replays of every earlier version-tagged action, on images of 2–8 × 2–7 pixels with transparent and hidden-colour pixels and limits of 1–6 entries. After every step: pixels byte for byte against a model, sizes, selection, Magic Wand click (and its version), stack sizes, availability, accounting, a fresh revision and its own display image for every document change; every replayed stale action is rejected; restored clicks re-apply exactly as computed from the model.
- `editorState.test.ts`: the initial state includes the empty history and no edit error.
- 38 deliberately introduced defects (missing version, revision, memory, size, basis, binding and entry checks, wrong eviction, accounting, sharing, restoration, rebinding and view) were each caught; two only after a test was strengthened (a failure test now has a selection to keep, and a crop's Redo on an image of another size is tested). The Undo size check in the command was removed instead: the patch functions already make it.

Measurements (Node 24, x64, two runs each; a Magic Wand click on the flat background around a noisy object, then Delete, Undo and Redo; display images are test fakes, so creating them is not included):

| Image | Selected | Entry retained | Delete itself | Edit command (patch, selections, revision) | Reducer | Undo command | Redo command |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3840 × 2400 | 7.1 M pixels | 22 KB | 34 ms | 49–52 ms | 0.2 ms | 26–27 ms | 26 ms |
| 8660 × 5773 (50 MP) | 38.2 M pixels | 51 KB | 164–170 ms | 226–228 ms | under 0.1 ms | 129–137 ms | 111–115 ms |

In the browser, creating the display image adds about 13–26 ms at 4K and 77–138 ms at 50 MP (Step 4), so a 50 MP Delete will take about 0.5 s and an Undo about 0.25 s before drawing. Step 6 measures them in Chrome and Firefox.

Known limitations (Step 5):

- Not connected to the application: no Delete, Undo or Redo can be performed yet; browser timings and memory for whole cycles come with Step 6. At the peak of an Undo the current pixels, the restored pixels, the decoded selection masks and the new display image exist together (in Firefox the display image briefly twice, while transferring).
- A display image whose action is rejected or replaced before it is drawn is left to garbage collection until the Step 6 safeguard above is in place.
- Undo and Redo replace the current selection with the recorded one; a selection made after Undo is lost on Redo (P3-D7: selections are not history).
- No content check: applicability rests on the version binding, entry identity and sizes. A write into a document's pixels that bypassed copy-on-write would not be detected (the read-only type and the shared-memory checks guard against it). A checksum was considered and not added: it would read the whole changed region on every Undo and Redo.
- Patch regions are trusted: a `CompletedPixelEdit` whose region misses some changed pixels would make an entry that cannot undo them. Delete Selection's bounds are exact (Step 2 tests); other tools must report correct regions or omit them.
- Edits are accepted while an import is still running; when it succeeds it replaces the edited image and clears its history. (Step 6: edit actions are unavailable while an import runs, and the unsaved-edits warning is implemented.)

Owner decisions (Step 5 was approved; these carried into Step 6):

1. Redo restores the selection recorded just after the edit (none after Delete), replacing any selection made since the Undo; Undo likewise replaces the current selection with the one from before the edit.
2. The Step 6 safeguard for abandoned display images (`flushSync` dispatch, then release when not current), replacing garbage collection for those images. (Approved as an option to evaluate; evaluated and adopted in Step 6, below. Accepted with the Step 6 approval, together with its restriction that no editor action is ever dispatched in a React transition.)
3. The provisional view behaviour for crops above, until Step 10.
4. `editError` records failures in the state only; the message, its wording and where it is shown are Step 6. (Done in Step 6.)
5. "256 MB" read as 256 MiB (268,435,456 bytes), matching how sizes are given elsewhere in these documents.


#### Step 6: Delete Selection, Undo and Redo (approved for checkpoint commit; manual QA partly deferred)

The first interactive editing checkpoint. Delete Selection, Undo and Redo work from the controls and the keyboard, on every supported format, and the unexported-edits warning (P3-D12) protects edited images. Delete is exact: no edge cleanup or feathering (Steps 7–9).

Modules:

```text
src/
├── editor/editCommands.ts        availableEditActions (constant time; nothing while an import runs),
│                                 editActionCommand (the one entry for Delete Selection, Undo, Redo),
│                                 deleteSelectionCommand, hasUnexportedEdits, editShortcut
├── editor/editFeedback.ts        announcement and error texts, edit names
├── editor/replaceConfirmation.ts the replace question as a small store (no DOM, tested in Node)
├── app/editDispatch.ts           dispatchEditAction: flushSync, then release the image unless held
├── app/useEditCommands.ts        the Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z shortcuts
├── components/DiscardEditsDialog/  the confirmation (a modal <dialog>)
└── components/Workspace/EditErrorMessage.tsx
```

Changed: `editorState.ts` (`editDepth`, `editNotice`, `editFeedbackId`, the `edit-unchanged` action, `changedPixels` on `edit-applied`), `historyCommands.ts` (passes `changedPixels` through; `describeCause` exported), `importSources.ts` (`confirmReplace`), `useImageImport.ts`, `useSelectionShortcuts.ts`, `App.tsx`, `AppHeader`, `MagicWandOptions`, `Workspace`, the icons (a Delete icon). Browser scripts: `edit-workflow.mjs`, `edit-ownership.mjs` and `edit-ownership/`, `lib/edit.mjs`, key presses in `lib/browsers.mjs`, three generated fixtures. No dependency was added or removed.

Delete Selection:

- `deleteSelectionCommand` runs the Step 2 algorithm on the open document and the selection, and records the result through the Step 5 `completedEditCommand`: the deleted pixels' bounds as the patch region, no selection afterwards, and the number of pixels made transparent for the announcement. One copy of the image (copy-on-write), a fresh revision, its display image created last, all in one action, so the document, display image, selection, Magic Wand click and history change together or not at all.
- Selected pixels get alpha 0 with their colour kept hidden; every other byte stays; the size and the view (zoom and pan) stay. The selection and the click that made it are cleared (Undo brings both back).
- When every selected pixel is already fully transparent, nothing changes: no entry, no revision, no image, the selection stays, and "Nothing was deleted: the selected pixels are already transparent." is announced (`edit-unchanged`). Deciding this before pressing would mean reading the selected pixels on every render, so the control is available whenever something is selected.
- Unavailable without an image or a selection, and while another image is opening (that import would replace the image and discard the edit). Selection changes stay available meanwhile.

Controls (UI_UX_SPEC.md, Undo / Redo and Magic Wand UX):

- Delete Selection: last in the Magic Wand options row, in its own group after Shrink, with a delete icon and the visible label "Delete Selection" (also its accessible name), `aria-keyshortcuts="Delete"` and the tooltip "Make the selected pixels transparent (Delete)". Unavailable, it is `aria-disabled` (keyboard focus stays on it after deleting, as for the selection actions) and its tooltip adds "— nothing to delete". Its label and size never change, so the row never re-wraps or resizes the workspace when it becomes available.
- Undo and Redo in the header: icon buttons whose accessible name says what they would do ("Undo Delete Selection", "Redo Delete Selection"; "Undo" and "Redo" when unavailable), with the shortcuts in their tooltips ("Undo Delete Selection (Ctrl+Z)", "Redo … (Ctrl+Y or Ctrl+Shift+Z)") and in `aria-keyshortcuts`. Unavailable, they are `aria-disabled` and look disabled; focus stays on them.
- Clicking an unavailable control does nothing. A double click on Delete Selection deletes once: the second click finds no selection.

Shortcuts (P3-D9), wherever focus is except in text fields, editable content and lists, and never while the replace confirmation is open:

| Keys | Action | Notes |
| --- | --- | --- |
| Delete | Delete Selection | Ignored while held (auto-repeat) and with any modifier; Backspace is not a shortcut |
| Ctrl + Z (⌘ Z) | Undo | Repeats while held, as in other editors |
| Ctrl + Y, Ctrl + Shift + Z (⌘ Y, ⌘ Shift Z) | Redo | Repeats while held |

With an image open, Ctrl + Z / Y / Shift + Z are taken over (default prevented) even when there is nothing to undo or redo, as Ctrl + A is; without an image every key keeps its browser meaning. In the tolerance text field Delete and Ctrl + Z keep their text-editing meaning; on the tolerance slider and buttons the shortcuts work. Space panning, Ctrl + A, Escape and Ctrl + O are unchanged.

Undo and Redo (as Step 5): Undo restores the pixels byte for byte (hidden colour included), the selection and the Magic Wand click from before the edit, bound to the new revision, so a committed tolerance re-applies the click exactly as it would have before (New, Add and Subtract, Contiguous and Global, with the click's previous selection). Redo restores the result and no selection. Every edit, Undo and Redo makes a new revision; a new edit after Undo clears Redo; selection changes make no entry; the 25-entry and 256 MiB limits are unchanged.

Display images (Step 5 decision 2, evaluated and adopted):

- `dispatchEditAction` dispatches every edit, Undo and Redo action inside `flushSync`, then releases the action's display image unless the committed state holds it. Measured in Chrome and Firefox, development (Strict Mode) and production React: `flushSync` returns only after the commit's layout effects ran, so the canvas has drawn the new image and released the one it replaced, and App has recorded the committed state.
- Commands always compute from the latest committed state, and each action is committed before the next key press or click is handled, so in the application an action is never stale: the release path is a safeguard. It was exercised directly, with real React, by `scripts/browser/edit-ownership.mjs`: actions computed from the same state, and lower-priority updates queued just before them.
- Why releasing is safe: the reducer never accepts an action whose image has been released. A released bitmap or canvas has no size, and the reducer requires the image to be the new document's size (now stated in `isNewContentState` and tested). So even when React processes the action again later, its image cannot come back.
- What React 19 does (measured): `flushSync` renders pending default-priority (timers, promises) and continuous-input updates in order with the edit, in the same pass; only transition-priority updates are skipped and processed again later on top of the edit ("rebasing"). The application dispatches no editor action in a transition (none exists in `src/`).
- The boundary of the argument, shown by the script and documented in `editDispatch.ts`: if a selection change were dispatched as a transition before a Delete, React would process the Delete again after it, find it no longer fits, and return to the image before it, which the canvas has already released. Editor actions must therefore never be dispatched in a transition.
- Alternatives considered: garbage collection only (the Step 4 status: up to 191 MB per abandoned image at 50 MP, released at an unknown time); releasing in a ledger after each commit (unsafe without `flushSync`: an action can still be queued); creating display images in the canvas instead of the commands (removes the ownership question entirely, but moves display failures after the commit; an architectural change, not made).
- React Strict Mode: reducers run twice with the same action and both runs hold the same image; nothing is released in effect clean-ups (unchanged since Step 4). No React warnings in either build.
- Correction found while testing: drops and pastes start their import after a short asynchronous check, where React left `import-started` pending until its next render. A Delete pressed in that gap was computed from a state without the import, accepted, and then discarded by the import without a question. `import-started` is now committed at once (`flushSync`), so edits are unavailable from the moment an import starts.

Unexported edits (P3-D12):

- `editDepth` counts edits away from the opened image: each accepted edit and Redo adds one, each Undo takes one away; opening an image sets it to 0. History is a single line and Undo is exact, so 0 means the pixels are the opened ones. Once the limits have dropped the oldest entries, Undo can no longer bring it back to 0, so the image stays edited. No images are compared. `hasUnexportedEdits` = an image is open and the depth is not 0. Undoing every edit leaves nothing unexported (the image equals the file), even with edits left to redo.
- Asked just before another image would replace it, the same way for the file picker, drop and paste: only when something would actually be opened (not for a cancelled picker, an empty clipboard or a drop with nothing usable), and never for the first image or an unedited one.
- A modal dialog: "Discard unexported edits?" — "The current image has edits that have not been exported. Opening “photo.png” will replace it and discard those edits and its Undo history." (for a paste: "the pasted image"). Cancel (focused first) and Continue (marked with the error colours). Escape cancels. Focus returns to where it was. Export does not exist yet, so the wording never mentions saving.
- Cancel keeps the document, its pixels, selection, history and edits. Continue starts the import; if it fails, the edited image and its history stay (and a later attempt asks again); if it succeeds, the image is replaced and its history cleared.
- One question at a time: while it is open, another image arriving (paste, drop) is not opened, Ctrl + O does nothing (and the browser's Open dialog is prevented), and Delete, Undo, Redo, Ctrl + A and Escape belong to the dialog. The rest of the page is inert.

Errors and announcements:

- A failed Delete, Undo or Redo (for example for lack of memory) changes nothing and shows a dismissible message in the workspace, in the style of import errors: "The selected pixels could not be deleted." / "Undo could not be completed." / "Redo could not be completed.", then "The image and selection have not changed.", and "There may not be enough memory for an image this large." when the cause looks like memory. It is an alert (announced at once), replaced by the next outcome, and dismissed with its button. The developer detail is logged in development only.
- Successful outcomes are announced in a visually hidden polite status region: "Selection deleted: 31,428 pixels are now transparent.", "Undone: Delete Selection.", "Redone: Delete Selection.", and the no-op message above. The image change itself is the visible feedback. Each outcome gets a new element (keyed by `editFeedbackId`), so repeating the same action announces again and re-renders never do. The status bar's selection announcement still follows the selection.

Tests: 79 added (1,000 in total, 58 files).

- `editCommands.test.ts` (37): Delete from a real Magic Wand click (alpha 0, hidden colour kept, every other byte, 1-pixel lines and separate squares kept), size, view, revision, entry, patch region, selection and click cleared, one image created and none released, inputs never written, already transparent pixels, the no-op (nothing recorded, selection kept, stale reports ignored), availability (no image, no selection, while importing, after a failed import), failures (display image, algorithm), pressing twice, a Delete computed before a selection change, a released image never accepted; several Deletes undone and redone one at a time with their selections and only new revisions; 30 random images round-tripped bit for bit; Undo restoring the click (committed tolerances re-apply exactly), Add and Subtract with their previous selections; selection changes after Undo; a new Delete clearing Redo; two Undos or Redos from one state; Undo / Redo unavailable while importing; announcements and failures replacing each other; Strict Mode double reducer runs; `availableEditActions`; `hasUnexportedEdits` through edits, Undo, Redo, no-ops, failures, eviction by the limits, imports and failed imports; `editShortcut` (keys, ⌘, held keys, modifiers, Backspace, text fields, editable content, lists, slider, composition); a 1024 × 768 background Delete.
- `editDispatch.test.ts` (7), with a stand-in for React: accepted images kept; rejected images released once, after the commit; nothing for actions without images; failures while committing; Strict Mode; a released action rejected by every state, including the one it was computed from; Undo and Redo with stale twins.
- `replaceConfirmation.test.ts` (7), `importSources.test.ts` (7 added: asked per source with its request, Cancel, Continue, nothing to open, immediate refusal, a newer import while asking, and the whole flow with the reducer: Cancel for each source, a failed import after Continue, a successful one), `editFeedback.test.ts` (7), and markup tests for the Delete Selection control (3), the header's Undo and Redo (4), the dialog (3) and the workspace's feedback (4).
- 21 deliberately introduced defects were each caught (Delete repeating, text fields not protected, edits while importing, the no-op unreported, Delete keeping the selection, unexported edits read from the Undo stack, the pixel count missing, Undo adding depth, imports keeping depth, stale no-op reports accepted, the feedback id not advancing, released images accepted, accepted images released, images never released, released before the commit, overlapping questions, a stale confirmation starting its import, an immediate refusal importing anyway, a weak memory hint, `disabled` instead of `aria-disabled`, generic Undo / Redo names); one only after a test was added (the immediate refusal).

Browser verification (production build unless stated; headless Chrome 157 and Firefox 159, device pixel ratio 1):

- `edit-workflow.mjs`: 515 checks pass (Chrome 259, Firefox 256), with real key presses and clicks. For a PNG and a WebP with an opaque object on transparency, a JPEG and an SVG on white, an SVG with a half-transparent shape, a PNG and a WebP with every alpha value deleted in Global mode (disconnected bands of partial alpha), a PNG of 1-pixel lines and dots, three disconnected squares (Global), and a 4K screenshot: Delete is exact in the document (every byte compared), keeps the view, clears the selection and click, makes one entry and a fresh revision; the canvas shows the document exactly at 100% (opaque exact, transparent exactly the checkerboard, partial alpha within 2 levels); the overlay is gone; the announcement is made; exactly one display image is live. Ctrl + Z restores every byte, the selection, the overlay and the click (committed tolerances re-apply exactly as before the Delete); Ctrl + Y and Ctrl + Shift + Z redo exactly; two more cycles with the Undo button stay exact with fresh revisions. Also: three Deletes undone and redone one at a time, a new Delete clearing Redo, Add and Subtract context, the buttons (availability, names, focus kept in Chrome, a second click), held Delete, Delete and Ctrl + Z in the tolerance field, the no-op, failures of Delete and Undo (error message, nothing changed, dismissal, recovery), Delete and Redo unavailable while an image opens, and the confirmation for the picker, paste and drop (first and unedited images not asked, Cancel, Continue, Escape in Chrome, focus returning in Chrome, Delete / Ctrl + Z / a second image ignored while asking, a failed import after Continue keeping the edits, the replaced image's display image released, no question after undoing every edit). No page errors.
- The same script against the development server (React Strict Mode), without the timings: 507 checks pass (Chrome 255, Firefox 252), with no React warnings or console errors in either browser.
- `edit-ownership.mjs`: 52 checks pass (Chrome and Firefox, development with Strict Mode and production).
- `smoke.mjs` (rendering, Phases 1–2): 340 checks pass, Chrome and Firefox, ratios 1 and 2, as in Step 5. `gpu-crash.mjs --kill-test-gpu-process`: 23 checks pass.
- Not checked headless: Escape in the dialog and focus return in Firefox (headless Firefox has no window focus); real clipboard and drag-and-drop (synthetic events carrying files are used; Firefox's event constructors ignore the files given, so the script sets them on the event).

Measurements (production build, headless, this machine; times are the whole synchronous handler, from the key press until the commit and its layout effects, including the canvas draw call; "creation" is the display image's `putImageData` plus `transferToImageBitmap`):

| | Selected | Delete | Undo | Redo | Display image creation | History kept |
| --- | --- | --- | --- | --- | --- | --- |
| Chrome, 3840 × 2160 screenshot background | 7.27 M pixels | 98–131 ms | 61–64 ms | 44–51 ms | 13–15 ms | 937 KB |
| Firefox, same | 7.27 M pixels | 89–105 ms | 69–86 ms | 50–55 ms | 22–37 ms (transfer 10–16) | 937 KB |
| Chrome, 8660 × 5773 flat background | 27.96 M pixels | 509–634 ms | 232–242 ms | 311–326 ms | 77–86 ms | 197 KB |
| Firefox, same | 27.96 M pixels | 464–482 ms | 308–323 ms | 265–317 ms | 138–170 ms (transfer 67–98) | 197 KB |

- Drawing: Chrome defers the work (the draw call takes under 0.1 ms; the next frame starts 11–15 ms later at 4K and 31–41 ms later at 50 MP); Firefox's draw call takes 1–4 ms. The 4K entry is mostly the selection from before the Delete: the background around anti-aliased text is a complicated mask.
- Memory (Chrome, JavaScript heap and ArrayBuffers after garbage collection): 36.1 MB with the 4K image open, 37.1 MB after each of 5 cycles; 195.2 MB with the 50 MP image open, 195.4 MB after each of 3 cycles: one image-sized buffer and the history, no growth. One live display image after every operation, in both browsers. Whole-browser resident memory (Linux, indicative only: caches and shared pages count): over 20 cycles at 4K, Chrome 1.49 GB at opening and 1.81–1.93 GB afterwards, Firefox 1.24 GB and 1.61–1.84 GB; over 5 cycles at 50 MP, Chrome levels at 2.63–2.67 GB and Firefox varies between 1.96 and 2.67 GB as garbage collection runs. No upward trend.

Known limitations (Step 6):

- Large images pause the page: near 50 MP a Delete takes about half a second and Undo or Redo about a quarter to a third of a second, with no progress indication, since the work is synchronous (P3-D11) and nothing is painted until it ends. At 4K and below everything stays near or under 0.1 s. See owner decision 1.
- Exact deletion leaves anti-aliased edge pixels that the Magic Wand did not select (a faint outline around a deleted object at tolerance 20); removing them is the edge cleanup of Steps 7 and 8.
- Delete Selection is offered whenever something is selected, even if every selected pixel is already transparent; pressing it then changes nothing and says so.
- The display-image ownership argument relies on no editor action being dispatched in a React transition (see above). Nothing enforces this; `edit-ownership.mjs` shows what would go wrong.
- The edited state is not shown anywhere (no "edited" marker), and closing or reloading the tab with unexported edits does not warn (only opening another image does).
- Not verified headless: Escape and focus return in Firefox's dialog, the real clipboard and drag-and-drop, screen readers. WebKitGTK remains for desktop testing.

Owner decisions (all seven accepted):

1. Large images: keep Delete, Undo and Redo synchronous for now (P3-D11), or add a "Processing…" indication (which needs the work to start after a frame is painted) or a Worker. Recommendation: keep synchronous for Phase 3 and revisit in the Step 12 performance review; the history-patch and selection-encoding costs that dominate at 50 MP (Step 3 limitations) can be reduced first. (Accepted: Delete, Undo and Redo stay synchronous, with no Web Worker and no processing indication for now. Revisit in Step 12 after evaluating real-browser performance and memory, particularly with 4K and near-50 MP images. Large-image manual QA (check 15) remains outstanding regardless of this decision.)
2. Unexported edits are counted from the opened image, so undoing every edit means nothing is unexported (no question), even with Redo history; Phase 6 will count from the last export. (Accepted.)
3. The question appears after the image to open is chosen (picker), dropped or pasted, for all three alike, rather than before the file picker opens. (Accepted.)
4. Delete, Undo and Redo are unavailable while another image is opening. (Accepted.)
5. A Delete that would change nothing keeps the selection and is announced, not shown visibly. (Accepted.)
6. Undo and Redo repeat while their keys are held; Delete never does. (Accepted.)
7. The visible label "Delete Selection" (other actions use short labels such as "Clear"), so it is not confused with clearing the selection. (Accepted.)

Manual QA results (owner, desktop): approved for a checkpoint commit with deferred testing. This is not a complete pass: 14 of the 23 checks were performed and passed, 9 were intentionally skipped, and none failed.

- Passed (14): 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 17, 18.
- Deferred, intentionally skipped (9): 12, 14, 15, 16, 19, 20, 21, 22, 23. They keep the numbers and descriptions below.
- Failed: none reported.

Deferred checks schedule: run the nine deferred checks after the next substantive coding round, preferably together with the Step 8 manual QA. Each must be completed or explicitly dispositioned by the owner (for example accepted as a known limitation, or moved to a later phase) before final Phase 3 sign-off and merge (Step 12).

| Check | Description (summary; full text below) | Status |
|---|---|---|
| 12 | Steps 1, 3 and 4 with JPEG, WebP, SVG, soft-edged transparent PNG and a 1-pixel-line screenshot | Deferred |
| 14 | Delete on an already-transparent selection changes nothing and keeps the selection | Deferred |
| 15 | 4K and near-50 MP responsiveness of Delete, Undo and Redo | Deferred |
| 16 | No question when there are no edits, or after every edit is undone (button, drop, paste) | Deferred |
| 19 | While the dialog is open, other shortcuts, paste and drop do nothing; focus returns afterwards | Deferred |
| 20 | Continue with an invalid file: error shown, edits and Undo history kept | Deferred |
| 21 | Screen reader (Orca): announcements, Undo/Redo button names, dialog title and text | Deferred |
| 22 | Window about 640 px wide: options row, header and dialog fit | Deferred |
| 23 | Steps 1, 3, 9, 10 and 17 repeated in Firefox | Deferred |

Manual QA checklist (owner, desktop; results above):

1. Open a PNG with a solid background. Click the background with the Magic Wand, press Delete: the background becomes the checkerboard at once, the selection outline disappears, the status bar shows "No selection", and the view does not move.
2. Look closely at the result at 400–800%: thin lines and small details next to the deleted area are unchanged; a faint anti-aliased outline may remain (expected until edge cleanup).
3. Press Ctrl + Z: the background comes back exactly and the same selection reappears (marching ants). Press Ctrl + Y, then Ctrl + Z, then Ctrl + Shift + Z: the image alternates correctly every time.
4. After Ctrl + Z, drag the tolerance slider and release it: the selection is re-applied from the original click exactly as before the Delete. Repeat with an Add (Shift + Click) and a Subtract (Ctrl + Click) selection.
5. Delete three separate regions one after another; undo them one at a time (each selection returns), then redo all three.
6. Undo once, make a new selection and Delete: Redo is no longer available.
7. Use the Delete Selection button instead of the key, and the header's Undo and Redo buttons. Hover them: tooltips name the edit and the shortcut. Check that unavailable buttons look disabled, and that a double click on Delete Selection deletes only once.
8. Keyboard only: Tab to Delete Selection and press Enter or Space; focus stays on the button. Tab to Undo and press Enter until nothing is left; focus stays on Undo.
9. Hold Delete with a selection: one Delete only. Hold Ctrl + Z after several Deletes: they are undone one after another.
10. Click in the tolerance number field, press Delete and Ctrl + Z: they edit the text only; the image does not change. Press Escape to restore the value.
11. Hold Space and drag to pan, zoom with Ctrl + wheel, then Delete, Undo and Redo: the view stays where it is and the overlay stays aligned.
12. Repeat steps 1, 3 and 4 with a JPEG, a WebP, a supported SVG, a PNG with transparency and soft (partially transparent) edges, and a screenshot with 1-pixel lines.
13. Use Global mode to select disconnected areas of one colour and delete them together.
14. Select an area that is already transparent and press Delete: nothing changes, the selection stays (a screen reader announces "Nothing was deleted…").
15. A 4K image: Delete, Undo and Redo feel prompt. If practical, a large image near 50 megapixels: note how long each pause feels.
16. With no edits, open another image (button, drag and drop, Ctrl + V): no question. After Undo of every edit: no question.
17. After a Delete, open another image with the button: the dialog appears. Read the wording. Cancel: the edited image, its selection state and Undo history are unchanged. Repeat and press Escape: the same.
18. Repeat step 17 with drag and drop and with Ctrl + V; then choose Continue: the new image opens, Undo is unavailable.
19. While the dialog is open, press Delete, Ctrl + Z, Ctrl + O and Ctrl + V, and try dropping a file: nothing else happens and no second dialog appears. After closing the dialog, focus is back where it was.
20. After a Delete, choose Continue for a file that is not a valid image: the error appears and the edited image and its Undo history are still there.
21. With a screen reader (Orca on Linux): Delete, Undo and Redo are announced once each; the Undo and Redo buttons announce "Undo Delete Selection" / "Redo Delete Selection"; the dialog announces its title and text.
22. Narrow the window to about 640 px: the options row wraps with Delete Selection as one unit, the header stays usable, the dialog fits.
23. In Firefox as well as Chrome, repeat steps 1, 3, 9, 10 and 17 (Escape and focus return could not be checked in headless Firefox).

#### Step 7: Edge Cleanup Prototype and Comparison (done; Candidate B approved)

An investigation outside the repository (nothing in the application changed). Three candidates were prototyped on 14 fixtures, 13 with exact ground truth (an icon on white, an anti-aliased logo on colour, 1-pixel lines, an HMI pump graphic, text and sharp corners, a JPEG photo, a gradient background, a partially transparent PNG, a rasterised SVG, shapes touching the border, sub-pixel text, hard-edged art, an HMI JPEG and a soft-focus photo), and compared on a local page and with quantitative measures (worst-case composite error over any background, thin-line survival, corners, border, timing and memory at 4K and 50 MP):

- A, conservative fringe removal (alpha only, all or nothing, with a topology guard); B, background-colour decontamination; H, a crisp hybrid of both; plus inward feathering, plain and with thin features protected.
- B was the only one to improve every fixture with a fringe (mean edge error 11.88 → 6.89 at 1 px over the 13 fixtures) while keeping all 14 test lines and their faint anti-aliasing, the image border and hard-edged art; antialiased graphics gain nothing beyond 1 px, a soft photo up to 4 px, nothing beyond 4 px.
- Owner decisions (after reviewing the comparison and screenshots of all 14 fixtures): Candidate B approved for Step 8; it runs as part of Delete Selection with one history entry; Edge cleanup and Feather 0–5 px each, both 0 by default. The Feathering comparison was not yet approved visually: the thin-feature-protected approach is preferred if it protects fine detail (see Step 8).

The prototype, the comparison page and the report are kept by the owner outside the repository (`~/minty-step7-review`).

#### Step 8: Edge Cleanup and Feathering (implemented; awaiting owner manual QA)

Delete Selection now applies the Edge cleanup and Feather amounts set beside it, as one edit with one Undo step. Both default to 0 px, and then Delete is byte for byte the Step 6 Delete. Step 9 (re-applying the last Delete when an amount changes) was not part of this step; it is implemented in Step 9 below.

Modules:

```text
src/image/edit/
├── deleteSelection.ts   deleteSelectedPixelData: the Step 2 Delete returning its still-writable copy
│                        (deleteSelectedPixels wraps it; behaviour unchanged)
├── deleteWithEdges.ts   deleteSelectionWithEdges(pixels, selection, { cleanup, feather }): Delete, then
│                        cleanup, then feathering, on one copy; MAX_EDGE_PIXELS (5), validation
├── edgeBand.ts          strips with a halo, the 32-bit seed scan, changed-bounds tracking (shared)
├── edgeCleanup.ts       Candidate B (cleanSelectionEdges)
├── feather.ts           inward feathering with thin features protected (featherSelectionEdges)
└── edgeTestFixtures.ts  test scenes with exact ground truth (supersampled shapes, a JPEG-like block
                         quantiser), Magic Wand selections, the Step 7 error measure
```

Changed: `editorState.ts` (`edgeSettings`, the `edge-settings-changed` action, `edgePixels` in the announcement), `editCommands.ts` (Delete uses `deleteSelectionWithEdges` with the state's settings), `historyCommands.ts` (passes `edgePixels` through), `editFeedback.ts`, `toleranceInput.ts` (the text-field logic takes a range: 0–100 for the tolerance, 0–5 for the amounts), `MagicWandOptions.tsx` and `ToolOptions.css` (the two controls), `App.tsx`. Browser scripts: `edge-cleanup.mjs`, `lib/source.mjs` (imports `src/` modules into the Node scripts), `lib/png.mjs` (a decoder), `lib/browsers.mjs` (more keys, typing), `fixtures.mjs` (the edge fixtures). No dependency was added or removed.

Edge cleanup (Candidate B; IMAGE_PROCESSING_SPEC.md, Edge Cleanup):

- The production code is the prototype's decontamination mode, reviewed and restructured (the other candidates, ablations and statistics removed): same model, same constants, same arithmetic. On the 14 Step 7 fixtures, 60 random images, every combination of cleanup and feather from 0 to 5 and five strip sizes, its output was compared byte for byte with the Step 7 prototype followed by the feather prototype: 13,140 comparisons, no difference, and the reported bounds always contained every changed pixel.
- It runs after Delete on the same copy and reads the original pixels and the selection; only unselected, not fully transparent pixels within the distance change; alpha never rises; selected pixels stay exactly as Delete leaves them; pixels it makes transparent keep their colour hidden; the image border and transparency already in the image are never background.

Feathering (IMAGE_PROCESSING_SPEC.md, Feathering):

- Investigated first, as asked, on the Step 7 fixtures. Plain inward feathering damages 13 of 14 test lines at 1 px and erases 12 at 2 px. The Step 7 "thin features protected" rule (skip pixels with no deeper neighbour) keeps 12 of 14 but splits two anti-aliased lines and still fades 136 pixels of the medium-size text and 15 of the 9 px text in the text fixture at 3 px.
- Implemented instead: the same inward fade, limited by the shape's local thickness (the deepest point reachable uphill from the pixel): fade over min(feather, thickness − 1.5) px, nothing for features up to about 3–4 px across. On the Step 7 fixtures at 1, 2, 3 and 5 px: all 14 lines intact with no faint pixel lost and no split; the medium and 9 px text unchanged; the bold title's edges and thick shapes feathered as intended. It is new: the owner has not yet seen it in the comparison (decision 1 below).
- Alpha only, inward only, never raised, within the feather distance of the selection; never starts at the image border or at existing transparency; a pixel faded to alpha 0 gets its original colour back, hidden.
- Known effect: on shapes thicker than about 4 px every edge pixel fades, including an outline drawn along the shape's edge (the HMI pump's dark rim, a box border), so a wire attached to an outlined shape can look detached where the outline fades.

Integration (Delete, history, Undo / Redo):

- `deleteSelectionCommand` passes `state.edgeSettings` to `deleteSelectionWithEdges`. One copy of the image, one new revision, one display image, one history entry; the patch region is the smallest rectangle containing every changed pixel, edge pixels included, and the existing XOR patches store colour as well as alpha changes, so Undo restores every byte and Redo reproduces the result exactly (tested in Node and in both browsers).
- Unchanged: version checks, selection and Magic Wand click cleared after Delete and restored by Undo (a committed tolerance re-applies the click exactly), the no-op (a selection of only transparent pixels changes nothing, whatever the amounts: the colours behind it are not known), failures (an exception changes nothing and shows the Delete error), display-image ownership and Strict Mode behaviour.
- The announcement adds the edge pixels: "Selection deleted: 31,428 pixels are now transparent. 1,204 edge pixels were cleaned up or feathered."
- The amounts are kept for the session like the Magic Wand options (across Deletes, Undo, Redo and imports; not saved between sessions) and apply only to the next Delete. Changing them computes nothing.

Controls (UI_UX_SPEC.md, Magic Wand UX): between Shrink and Delete Selection, "Edge cleanup" and "Feather", each a 0–5 slider (step 1) and a text field with the unit "px", built with the tolerance control's conventions (typing, Enter, Escape, arrows; the slider applies at once). The slider's accessible name is its label and its value text "2 px"; the field is "Edge cleanup in pixels, 0 to 5" / "Feather in pixels, 0 to 5". Tooltips say what each does and that it applies to the next Delete. Each control wraps as one unit.

Tests: 65 added (1,065 in total, 61 files): `edgeCleanup.test.ts` (23: guarantees over the scenes and 120 random images, hidden colour never read, strip independence, inputs never written, accuracy against ground truth for an icon, a logo on colour, lines, a gradient, a half-transparent background, the border, corners, JPEG artefacts, colour as well as alpha corrected, thin lines and small text kept, corners restored, hard-edged art unchanged, twin and monotone rules, a pixel no neighbour explains), `feather.test.ts` (9), `deleteWithEdges.test.ts` (12: 0/0 identical to Step 6 on 200 random cases, tight bounds, Undo / Redo patches, one copy, no-op, existing transparency, Global selections, validation, a regression lock of exact outputs, a 1200 × 800 image), editor tests (7 command tests, 5 reducer tests, 4 field-range tests, 1 announcement test, 4 markup tests). 16 deliberately introduced defects were each caught; two only after a test was added (existing transparency next to the selection; the hidden colour of a pixel cleaned and then faded out).

Browser verification (production build, headless Chrome and Firefox, device pixel ratio 1; `scripts/browser/edge-cleanup.mjs`):

- 1,109 checks with `--step7`, all passing (Chrome and Firefox). Controls: defaults, names, units, Tab order, slider keys, typing, clamping, Escape, Delete inside the field, nothing computed while adjusting, values kept across Delete, Undo and imports, 640 px wrapping. For 10 generated fixtures (HMI pump PNG and JPEG, thin lines and wiring, a logo on colour, text and corners, a gradient, a partially transparent PNG, shapes touching the border, a soft JPEG photo, an SVG) at cleanup / feather 0/0, 1/0, 3/0, 5/0, 0/2, 2/2 and 5/5 set with the controls: the document is byte for byte what the application's algorithm gives in Node for the same pixels and selection (so Chrome, Firefox and Node agree exactly), 0/0 is the Step 6 Delete, one entry, selection cleared, the announcement, the canvas shows the result, Undo restores every byte and the selection, Redo the result.
- The 14 Step 7 fixtures, opened in the browsers and deleted with their recorded Magic Wand clicks at 0, 1, 2 and 4 px: identical bytes to Node, and the same mean edge error as the Step 7 report (to 0.005 level) for every fixture with ground truth, except the partially transparent PNG: both browsers import it with other colour bytes than the file holds in 103 (Chrome) and 142 (Firefox) partially transparent pixels (the import's canvas stores colour premultiplied; a Phase 1 behaviour, not changed here), so its figures are not comparable with Step 7's (they differ by up to 0.01 level) and are reported, not checked.
- In headless Firefox the window has no focus and no blur event fires, so "leaving an emptied field restores its value" is checked in Chrome only (as in Step 6).
- Development server (React Strict Mode): the same checks without timings and Step 7 fixtures, 885 passing, and `edit-workflow.mjs` 507 (as in Step 6), with no React warnings or console errors. Regression in production: `edit-workflow.mjs` 511 checks (production, without the 50 MP stress run), `edit-ownership.mjs` 52, `smoke.mjs` 340, `gpu-crash.mjs` 23, all passing.

Measurements (production build, headless, this machine; the whole synchronous Delete handler, key press to commit, including the display image; edge-dense tiled HMI images are a worst case):

| Image | Browser | 0 / 0 | Cleanup 1 | Cleanup 3 | Cleanup 5 | Feather 1 | Feather 5 | 2 / 2 | 5 / 5 | Undo, Redo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3840 × 2160 HMI, tiled | Chrome | 87 ms | 210 ms | 280 ms | 298 ms | 168 ms | 222 ms | 359 ms | 428 ms | 35–65 ms |
| | Firefox | 92 ms | 212 ms | 261 ms | 282 ms | 183 ms | 248 ms | 346 ms | 451 ms | 49–74 ms |
| 3840 × 2160 screenshot | Chrome | 97 ms | 236 ms | 294 ms | 311 ms | 163 ms | 183 ms | 348 ms | 399 ms | 44–67 ms |
| | Firefox | 88 ms | 229 ms | 283 ms | 307 ms | 167 ms | 198 ms | 361 ms | 409 ms | 51–81 ms |
| 8660 × 5773 HMI, tiled | Chrome | 524 ms | 1,057 ms | 1,364 ms | 1,468 ms | 939 ms | 1,279 ms | 1,773 ms | 2,224 ms | 209–267 ms |
| | Firefox | 510 ms | 1,221 ms | 1,573 ms | 1,669 ms | 1,021 ms | 1,414 ms | 2,087 ms | 2,609 ms | 287–370 ms |
| 8660 × 5773 flat background | Chrome | 626 ms | 609 ms | 768 ms | 784 ms | 596 ms | 637 ms | 849 ms | 829 ms | 235–331 ms |
| | Firefox | 481 ms | 614 ms | 635 ms | 634 ms | 596 ms | 654 ms | 762 ms | 811 ms | 261–343 ms |

- History kept per Delete: 4K HMI 354 KB at 0/0, 739 KB at cleanup 1, 1.08 MB at 5, 1.76 MB at 5/5; 50 MP HMI 2.1 MB, 4.5 MB, 6.6 MB and 10.6 MB; the flat 50 MP background 197–339 KB.
- Memory: one live display image after every operation; Chrome's JavaScript heap 3.8–3.9 MB and ArrayBuffers 42–43 MB (4K) and 245–255 MB (50 MP) after garbage collection, over ten Delete / Undo / Redo cycles each, with no growth beyond the history entry. Transient memory during the Delete (Node, resident high-water mark at 50 MP, edge-dense): 191 MB for Delete's copy alone; cleanup adds 48–94 MB, feathering 22–26 MB, both 85–96 MB, released afterwards. Work is done in strips of 256 rows, so scratch memory follows the image width, not its size.
- Undo and Redo times are unchanged by the amounts (they apply the patch); the display image takes 13–15 ms (Chrome) and 22–27 ms (Firefox) at 4K, 77–89 ms and 137–177 ms at 50 MP, as before.

Known limitations (Step 8):

- Colour that was flattened onto the background cannot be recovered (a semi-transparent object saved onto an opaque background stays opaque); the remaining error on the Step 7 transparent-PNG fixture is all of that kind.
- Cleanup trusts the selection: a Magic Wand selection that leaked into the object enlarges the damage, and pixels Delete removed are never brought back.
- A solid mid-grey part next to a dark outline is protected only while the cleanup distance stays inside it: once the distance reaches the outline, the grey column touching it is taken for a grey-and-black blend and loses about half its alpha (Step 7: 24 such pixels on the rasterised SVG at 2 px and more; JPEG artwork: 48 at 1 px, more at higher amounts). 1 px suits screenshots and vector art; 2–4 px only soft photographs.
- Feathering fades every edge of shapes thicker than about 4 px, outlines included (see above), and is not a quality fix: against ground truth it always increases the error, by design.
- Large images pause the page: near 50 MP up to about 2.2–2.6 s at 5 / 5 on edge-dense images (about 1.1–1.7 s for cleanup alone), synchronous, with no progress indication (Step 6 decision 1, revisited in Step 12).
- The browsers' import changes the colour bytes of some partially transparent pixels (premultiplied canvas); cleanup works on the pixels as imported.
- Sub-pixel (LCD) text fringes cannot be represented in RGBA and are not removed.

Owner decisions raised (Step 8):

1. Feathering: ship the thickness-limited feathering as implemented (protects lines and text up to about 3–4 px; fades outlines of thicker shapes), or hide the Feather control until its visual results are reviewed, or another variant.
2. Should the amounts be kept for the session (as implemented, like the Magic Wand options), or reset to 0 when another image is opened, so that settings chosen for a photo never apply to the next technical graphic by surprise?
3. Large images: the synchronous pause grows to about 1–2.6 s near 50 MP with cleanup or feathering; keep synchronous until Step 12 (as Step 6 decision 1) or plan a progress indication.
4. The announcement wording ("… 1,204 edge pixels were cleaned up or feathered.").

Manual QA checklist (owner, desktop, Chrome and Firefox). Not yet run: none of these is marked passed. Images: `node scripts/browser/fixtures.mjs` writes the generated ones (`edge-*.png`, `edge-*.jpg`, `edge-svg.svg`) to `scripts/browser/fixtures/`; real VTScada screenshots and equipment photos are just as important. Look at results at 400–800% over the checkerboard.

| Check | Action | Passes when | Known limitation |
| --- | --- | --- | --- |
| 8.1 Defaults | Open any image and look at the options row | Between Shrink and Delete Selection: "Edge cleanup" and "Feather", each a slider and a field showing 0 and "px" | — |
| 8.2 0 / 0 is Step 6 | `edge-hmi.png`, Magic Wand tolerance 10 on the grey background, Delete | Exactly as in Step 6: the background goes, a faint grey fringe stays around the wires, pump and box; Ctrl + Z restores it | The fringe is expected at 0 px |
| 8.3 Cleanup on HMI art | Undo; type 1 in Edge cleanup, Enter; click the background again; Delete | The grey fringe is gone from the wires, the pump's and box's edges and the LED glow; wires stay continuous and dark; the 9 px "TAG-0042" text stays readable; nothing else changes | A soft glow keeps a faint edge where it is not a blend of its colour and the background |
| 8.4 Undo / Redo exact | After 8.3: Ctrl + Z, Ctrl + Y, Ctrl + Z, then the header buttons | The original (fringe included) and the selection come back exactly; Redo gives the cleaned result; one Undo step per Delete | — |
| 8.5 Re-apply after Undo | After Ctrl + Z, drag the tolerance slider and release | The selection is re-applied from the original click, as before the Delete | — |
| 8.6 Thin lines | `edge-lines.png`, Global, click the white, Edge cleanup 5, Delete | Every line, the hairline, the red and blue wires, the dots and the 1 px box remain whole and dark; their light fringe is gone | — |
| 8.7 Feather spares thin features | Undo; Edge cleanup 0, Feather 5; Delete | Nothing on the lines changes at all | — |
| 8.8 Feather on thick shapes | `edge-hmi.png`, Edge cleanup 0, Feather 3, Delete | Pump, pipes and box edges fade inward over about 3 px; wires and small text unchanged; nothing further than 3 px from the deleted area changes; no new halo | The pump's rim and the box border fade with the edge, so the black wire can look detached from the box (decision 1) |
| 8.9 Combined on a photo | `edge-photo.jpg`, tolerance 25, click the background; Edge cleanup 2, Feather 2; Delete | Softer edges with no grey or noisy halo; the red ring stays a ring; Undo exact | Background left unselected by the wand stays |
| 8.10 Logo on colour | `edge-logo.png`, tolerance 10; Edge cleanup 1; Delete (also click inside the ring with Shift) | No blue outline remains around the white ring, orange triangle or text over the checkerboard | — |
| 8.11 Corners and text | `edge-corners.png`, Global; Edge cleanup 1; Delete | Diamond, star and spike corners stay sharp; all three text sizes stay readable and crisp | The wand may select a spike's faintest tip pixels; cleanup cannot bring them back |
| 8.12 Partially transparent PNG | `edge-alpha.png`, tolerance 10, click the half-transparent panel; Edge cleanup 2; Delete | The orange circle and white text keep their colours, without a dark rim | Flattened semi-transparent colour cannot be separated |
| 8.13 Image border | `edge-border.png`, Global, click the white middle; Edge cleanup 5; Delete | Shapes cut by the image edges keep full strength along the border | — |
| 8.14 JPEG artwork | `edge-hmi.jpg`, tolerance 12; Edge cleanup 1, then (after Undo) 3 | The fringe and JPEG noise around edges are reduced at 1 px | At higher amounts a solid grey column next to a dark outline can turn semi-transparent |
| 8.15 SVG | `edge-svg.svg`, tolerance 20; Edge cleanup 1, then 5 | Edges of the grey circle, the orange box and the thin lines are clean at 1 px | At 4–5 px the grey column touching the dark stroke can lose about half its alpha |
| 8.16 Keyboard | Tab from Shrink; arrows, Home, End on each slider; in each field type 9 + Enter, "abc" + Enter, 2 then Escape; Delete and Backspace in a field; Tab away from an emptied field | Tab order: Edge cleanup slider, field, Feather slider, field, Delete Selection; arrows step by 1, Home / End give 0 / 5, the field follows; 9 becomes 5, "abc" and Escape restore the previous value; Delete only edits the text; leaving an emptied field restores the value (please check this in Firefox: not checkable headless) | — |
| 8.17 Nothing while adjusting | With a selection, drag both sliders back and forth and type values | The image, selection and Undo do not change; only the next Delete uses the amounts | — |
| 8.18 Kept for the session | Set 2 / 1; Delete, Undo, Redo; open another image | The controls still show 2 and 1, and the next Delete uses them; reloading the page resets them to 0 | Decision 2 |
| 8.19 No-op | Undo a Delete made with cleanup 5, keep the amounts, select an area that is already fully transparent (for example in `edge-alpha.png` outside the panel) and press Delete | Nothing changes, the selection stays; a screen reader hears "Nothing was deleted…" | — |
| 8.20 Screen reader (Orca) | Delete with Edge cleanup 1; move through the two controls | "Selection deleted: … pixels are now transparent. … edge pixels were cleaned up or feathered." is read once; the sliders read "Edge cleanup" / "Feather" with "0 px"; the fields read their names with "0 to 5" | — |
| 8.21 Narrow window | About 640 px wide | Edge cleanup and Feather each wrap as one unit; Delete Selection stays whole; no horizontal scrolling | — |
| 8.22 Large images | `edge-hmi-4k.png` and `edge-hmi-50mp.png` (tolerance 10 at the top-left): Delete at 0 / 0, cleanup 1, 3 and 5, feather 5 and 5 / 5, then Undo and Redo | 4K: about 0.1 s at 0 / 0, 0.2–0.45 s with the amounts; 50 MP: about 0.5 s at 0 / 0, 1–1.7 s with cleanup, up to about 2.6 s at 5 / 5; Undo / Redo 0.2–0.35 s; no error; Undo exact | The page pauses with no indication (decision 3) |
| 8.23 Real assets | Your VTScada screenshots and equipment photos: cleanup 1 for screenshots and vector art, 2–4 for soft photos, feather 1–2 where wanted | Fringes reduced, fine lines, text and small symbols intact; note any case where cleanup or feathering makes things worse | — |

Carried forward from Step 6 (still deferred; the owner decides each before Phase 3 sign-off). Their numbers and meaning are unchanged; run them with both amounts at 0 unless stated:

| Step 6 check | Action | Passes when | Known limitation |
| --- | --- | --- | --- |
| 12 | Repeat Step 6 checks 1, 3 and 4 with a JPEG, a WebP, a supported SVG, a PNG with transparency and soft edges, and a screenshot with 1-pixel lines | Each deletes as in check 1, undoes exactly with the selection (check 3), and re-applies the tolerance after Undo (check 4) | — |
| 14 | Select an already transparent area and press Delete | Nothing changes, the selection stays; "Nothing was deleted…" is announced | — |
| 15 | A 4K image, and if practical one near 50 MP: Delete, Undo, Redo (now also with the amounts, as in 8.22) | They feel prompt at 4K; note how long each pause feels near 50 MP | Synchronous pauses (Step 6 decision 1) |
| 16 | With no edits, open another image by button, drag and drop and Ctrl + V; then edit, undo every edit and open again | No question in either case | — |
| 19 | While the "Discard unexported edits?" dialog is open: Delete, Ctrl + Z, Ctrl + O, Ctrl + V, drop a file; then close it | Nothing else happens, no second dialog; focus returns where it was | — |
| 20 | After a Delete, Continue with a file that is not a valid image | The error appears; the edited image and its Undo history remain | — |
| 21 | Orca: Delete, Undo, Redo; the Undo / Redo buttons; the dialog | Each announced once; buttons read "Undo Delete Selection" / "Redo Delete Selection"; the dialog reads its title and text | — |
| 22 | Window about 640 px wide | The options row wraps with Delete Selection (and now each amount control) as one unit; the header stays usable; the dialog fits | — |
| 23 | In Firefox as well as Chrome, repeat Step 6 checks 1, 3, 9, 10 and 17 | All behave as in Chrome, including Escape and focus return in the dialog | Not checkable in headless Firefox |

#### Step 9: Re-applying the Last Delete When Edge Settings Change (provisionally approved; review correction implemented, awaiting checkpoint)

Right after a Delete, a finished change of Edge cleanup or Feather updates that Delete instead of only setting the next one: the Delete is made again, from the image as it was before it and the selection it deleted, with the amounts now set. It stays one edit with one Undo step. Step 8's algorithms, its synchronous processing and its session-wide amounts are unchanged; Step 8's manual QA, including the nine deferred Step 6 checks, is still outstanding and is not affected by this step's own checklist below.

Modules:

```text
src/
├── editor/history/historyEntry.ts  edgeSettings: the amounts a Delete was made with (recorded in its entry);
│                                   remadeHistoryEntry: the same entry with another patch and amounts
├── editor/history/editHistory.ts   replaceLatestEdit: the next Undo replaced in place, Redo empty
├── editor/editorState.ts           adjustableEdit, the edit-adjusted action, the 'adjusted' notice and
│                                   'adjust' error, mergeEdgeSettings (the reducer's clamping, shared)
├── editor/editCommands.ts          adjustableDelete (constant time), adjustDeleteCommand; Delete records
│                                   its amounts
├── editor/editFeedback.ts          the announcement and error texts
├── app/editDispatch.ts             edit-adjusted carries a display image like edits, Undo and Redo
├── app/useEditCommands.ts          commitEdgeSettings
└── components/Toolbar/MagicWandOptions.tsx  the amount controls commit like the tolerance control;
                                    tooltips say which Delete the amounts apply to
```

Also changed: `historyCommands.ts` (passes the amounts into the entry), `App.tsx`, `toleranceInput.ts` (comment only). Browser scripts: `edge-adjust.mjs` (new), `lib/edges.mjs` (the page helpers and input steps of `edge-cleanup.mjs`, moved so both scripts share them, plus three Step 9 helpers), `lib/browsers.mjs` (mouse down / move / up and key down / up as separate steps), `lib/edit.mjs` (`timeInput`). No dependency was added or removed.

How the image before the Delete is rebuilt (no snapshot is kept):

- A Delete's history entry already holds an XOR patch over every pixel it changed, edge pixels included, and the selection it deleted (encoded). Step 9 adds the two amounts it was made with.
- `adjustDeleteCommand` applies the patch to the current pixels, which gives the image before the Delete byte for byte (hidden colour included; the same exact operation as Undo), decodes the selection, and runs `deleteSelectionWithEdges` on them with the new amounts: exactly what Delete with those amounts would have produced. Then, as for any edit: a patch between the image before the Delete and the new result (over the new result's changed bounds), a new revision and, last, its display image.
- The entry is replaced in place (`remadeHistoryEntry`, `replaceLatestEdit`): same kind, same encoded selection and Magic Wand click objects (never encoded again, so they cannot drift), new patch and amounts, retained bytes counted again. The number of entries does not change, Redo stays empty, and the history is bound to the new version.
- Each adjustment starts from the same pixels and selection, never from the previous result, so nothing accumulates: the same amounts always give the same bytes, and 0 / 0 gives exactly the Step 6 Delete with the same patch as a Delete made at 0 / 0.

When a change updates the last Delete (`adjustableDelete`, checked in constant time on every render):

- The Delete was just applied, adjusted or redone, and since then nothing has been selected: `adjustableEdit` is set by those three and forgotten by every Magic Wand click and re-apply, Select All, Clear, Invert, Grow and Shrink (even when the selection ends up empty again), Undo, and another image. View changes, Magic Wand option changes, amount changes, announcements, dismissals and failed attempts keep it.
- It is still the history's next Undo for the open document's version, nothing can be redone (a Redo entry's patch was made from the old result and would no longer apply), nothing is selected, no Magic Wand click is recorded, and no other image is opening.
- The replace confirmation is not open (checked where the commit is handled, `useEditCommands`).
- Otherwise the amounts only set the next Delete, exactly as in Step 8.

What a committed change does (`commitEdgeSettings`):

- It always sets the amount (`edge-settings-changed`). Then, unless the confirmation is open, it computes `adjustDeleteCommand` from the latest committed state with both amounts as they now are, and dispatches the result through `dispatchEditAction` (inside `flushSync`; React 19 renders the queued amount change and the adjustment in order in that pass; the display image is released if the reducer rejects the action).
- Nothing is computed when there is no Delete to adjust, or when the amounts are those the result already has (a second commit of the same value, leaving an unchanged control).
- The reducer (`edit-adjusted`) accepts only an adjustment of the current version whose entry is still the state's adjustable edit and the history's next Undo with nothing to redo, with nothing selected and no click recorded, of the same image and size with a newer revision and its own pixel memory and display image. Versions only move forward, so a rejected adjustment is rejected by every later state. The document, display image, history and adjustable edit change together; the selection, click, view, amounts and edit depth do not.
- A failure (for example for lack of memory) changes nothing and shows "The last Delete Selection could not be updated with the new Edge cleanup and Feather amounts. The image and selection have not changed." (with the memory hint when it applies). The Delete stays adjustable.
- The outcome is announced: "Delete Selection updated with Edge cleanup 2 px and Feather 1 px: 1,204 edge pixels were cleaned up or feathered." (or "…: no edge pixels were changed.").

Interaction (the tolerance control's conventions, `toleranceInput.ts`): while the slider is dragged or a key is held the amount and the number follow, nothing is computed; an adjustment is finished when the slider is released (the native `change` event), when the last held arrow, Page, Home or End key is released, on Enter, or when focus leaves the slider or field. Holding a key updates once, at its release; each separate press is its own adjustment. Escape cancels a typed entry. No timers are used. Since the review correction below, a finished adjustment commits only when it ends on another amount than it started from. The tooltips of both controls read "Edge cleanup for the next Delete: …" or, while a change would update the last Delete, "Edge cleanup, updating the last Delete: …" (likewise for Feather); nothing else in the row changes size or text, and the status bar shows "Edge settings update last Delete" (correction below).

Undo / Redo and history:

| | Image | Entries | Selection, click | Depth |
| --- | --- | --- | --- | --- |
| Delete | Result with the amounts | +1 (with the amounts) | Cleared | +1 |
| Adjust (any number of times) | Result with the new amounts, a new revision | Unchanged: the top entry replaced | Stay cleared | Unchanged |
| Undo | Exactly the image before the Delete | Moved to Redo | The selection and click from before the Delete | −1 |
| Redo | Exactly the latest adjusted result | Moved back | Cleared; adjustable again | +1 |

Tests: 37 added (1,102 in total, 62 files): `adjustDelete.test.ts` (27, commands and reducer with real Magic Wand clicks: cleanup and feather adjustments against a fresh Delete of the original, ten consecutive adjustments with repeated amounts giving identical bytes and the patch always restoring the original exactly, 0 / 0 equal to the Step 6 Delete with the same patch bytes, one Undo to the original with selection and click after several adjustments and Redo to the latest, 40 random images and selections of every kind through random adjustments, Undo and Redo bit for bit, earlier entries kept by identity with the replaced patch no longer retained, eviction by the byte limit with the Delete kept, not adjusting without an image, before a Delete, with a new selection (the next Delete then uses the amounts), after Select All and Clear, Select All and Invert or a Subtract click that leave nothing selected, after Undo, with something to redo, after another image, while one opens, and keeping it after a failed import, no work for unchanged amounts, a differing amount after Redo, Magic Wand options and view changes keeping it, stale actions (two from one state, after a click, Clear, Undo, Redo, another image, a later adjustment), forged entries, kinds, documents, sizes and revisions on a frozen state, a selection or click forced into the state, a released image, failure and retry, Strict Mode double reducer runs, transparent and hidden-colour pixels, thin lines, a 1920 × 1080 image, the announcement); `editHistory.test.ts` (4), `historyEntry.test.ts` (3), `editDispatch.test.ts` (1), `ToolOptions.test.ts` (1), `toleranceInput.test.ts` (1). 23 deliberately introduced defects were each caught; four only after tests were added (selection changes through `selection-applied` and Clear, Undo, and the reducer's own selection check, each of which the other safeguards also cover).

Browser verification (production build, headless Chrome and Firefox, device pixel ratio 1; `scripts/browser/edge-adjust.mjs`):

- 167 checks pass (143 without timings: Chrome 72, Firefox 71), with real pointer drags, key presses, held keys and typing. On `edge-hmi.png` after a Delete at 0 / 0: while the Edge cleanup slider is dragged (six pointer moves, up to 5 and back to 3) the amount follows but the revision and the number of display images do not change; the release makes the Delete again once. Each arrow press on the Feather slider adjusts once at its release; holding the arrow (three repeats) steps to 5 without computing and adjusts once at the release. Typing 1 in the field computes nothing until Enter; Escape cancels; leaving the field commits (Chrome; headless Firefox fires no blur, Enter used); an arrow step in the field commits at its release; committing the amounts the result has computes nothing. After every adjustment the document is byte for byte the application's Delete in Node of the pixels and selection from before the Delete with the amounts now set, with one entry recorded with those amounts, nothing to redo, depth 1, nothing selected; the canvas shows the result; the announcement names the amounts. One Ctrl + Z restores every byte and the selection; Ctrl + Y the latest result, which can be adjusted again; back to 0 / 0 it is exactly the Step 6 Delete and the first Delete's bytes; the header Undo and Redo buttons as well. The tooltips switch between "for the next Delete" and "updating the last Delete". Nothing is adjusted with Select All active, after Select All and Clear, while the replace confirmation is open (Chrome: opening it took focus from the field with 3 typed, which set the amount only; after Cancel, Enter in the field adjusted), or while another image opens (held import); then the new image has nothing to adjust. One live display image at the end.
- Five images (HMI graphic, thin lines and wiring, partially transparent PNG, soft JPEG photo, SVG), each deleted at 1 / 1 then adjusted seven times from the fields: every result exactly the Delete of the original with those amounts, one entry throughout, the canvas exact, one Undo exact with the selection, Redo exact.
- Development server (React Strict Mode): the same 143 checks pass in both browsers, with no React warnings or console errors.
- Regressions: production `edge-cleanup.mjs --no-perf` 885 (it now imports its helpers from `lib/edges.mjs`; run without the owner's Step 7 fixtures), `edit-workflow.mjs --no-perf` 507, `edit-ownership.mjs` 52, `smoke.mjs` 340; development `edge-cleanup.mjs` 885 and `edit-workflow.mjs` 507. All passing.
- Not checked headless: leaving a field in Firefox, the real clipboard and drag-and-drop (the file picker opens the confirmation here), screen readers, a real (non-headless) desktop.

Measurements (production build, headless, this machine, one run each; an adjustment is the whole synchronous handler, from the slider's change event to the commit and its layout effects, display image included; each column commits one amount, in this order, from a Delete at 0 / 0; edge-dense tiled HMI images are a worst case):

| Image | Browser | Delete 0 / 0 | 1 / 0 | 3 / 0 | 5 / 0 | 5 / 5 | 0 / 5 | 0 / 2 | 2 / 2 | 2 / 0 | 0 / 0 | Undo, Redo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3840 × 2160 HMI, tiled | Chrome | 95 ms | 227 ms | 320 ms | 287 ms | 383 ms | 228 ms | 189 ms | 303 ms | 216 ms | 95 ms | 56, 36 ms |
| | Firefox | 88 ms | 222 ms | 284 ms | 311 ms | 466 ms | 256 ms | 201 ms | 361 ms | 276 ms | 102 ms | 69, 51 ms |
| 3840 × 2160 screenshot | Chrome | 98 ms | 258 ms | 356 ms | 275 ms | 358 ms | 195 ms | 183 ms | 319 ms | 249 ms | 103 ms | 52, 37 ms |
| | Firefox | 100 ms | 252 ms | 315 ms | 317 ms | 427 ms | 219 ms | 197 ms | 379 ms | 290 ms | 102 ms | 76, 50 ms |
| 8660 × 5773 HMI, tiled | Chrome | 524 ms | 1,108 ms | 1,466 ms | 1,535 ms | 2,269 ms | 1,349 ms | 1,081 ms | 1,756 ms | 1,270 ms | 710 ms | 260, 205 ms |
| | Firefox | 519 ms | 1,278 ms | 1,640 ms | 1,863 ms | 2,706 ms | 1,571 ms | 1,175 ms | 2,197 ms | 1,538 ms | 632 ms | 340, 288 ms |
| 8660 × 5773 flat background | Chrome | 637 ms | 626 ms | 894 ms | 774 ms | 902 ms | 656 ms | 849 ms | 845 ms | 733 ms | 529 ms | 227, 184 ms |
| | Firefox | 481 ms | 681 ms | 751 ms | 733 ms | 860 ms | 736 ms | 708 ms | 833 ms | 720 ms | 525 ms | 323, 263 ms |

- An adjustment costs about what a Delete with the same amounts costs (Step 8 table: Chrome, 50 MP HMI, cleanup 1: Delete 1,057 ms, adjustment 1,108 ms; 5 / 5: 2,224 and 2,269 ms; Firefox 1,221 and 1,278 ms, 2,609 and 2,706 ms). Rebuilding the image before the Delete and decoding its selection add about 30–120 ms (Node), up to about 0.2 s at 50 MP in the browsers (0 / 0: 524 ms for the Delete, 632–710 ms for the adjustment back to it). Single runs: individual values vary by tens of percent.
- The display image takes 13–15 ms (Chrome) and 24–28 ms (Firefox) at 4K, 76–85 ms and 140–212 ms at 50 MP, as in Step 8. Nothing at all is computed while a slider is dragged or a key held.
- History: always one entry, whose size follows the amounts exactly as a Delete made with them would (4K HMI 354 KB at 0 / 0 to 1.76 MB at 5 / 5; 50 MP HMI 2.1 to 10.6 MB; flat 50 MP 197–339 KB); back at 0 / 0 it is the first entry's size again.
- Memory: one live display image after every adjustment in both browsers. Chrome's JavaScript heap and ArrayBuffers after garbage collection did not change from the Delete through the nine adjustments, Undo and Redo: 3.1–3.2 MB and 73.2–73.7 MB at 4K, 435.9–437.8 MB at 50 MP. (Measured right after a change, these include React's previous render, which keeps the previous document and a selection mask until its next render: two images and one mask.)
- Transient memory (Node, resident high-water mark above the open image and its state, 50 MP edge-dense image, each case in its own process): Delete 191 MB at 0 / 0, 218 MB at cleanup 1, 242 MB at 5 / 5; adjusting 0 / 0 → 1 / 0 416 MB, 0 / 0 → 5 / 5 431 MB, 5 / 5 → 0 / 0 381 MB, 1 / 0 → 5 / 5 412 MB. About one image (190 MB) more than the Delete: the image before the Delete, rebuilt for the adjustment and released afterwards. Node times: Delete 445, 1,239 and 2,754 ms; those adjustments 1,271, 2,872, 623 and 2,798 ms.

Known limitations (Step 9):

- Changing an amount right after a Delete updates that Delete, even when it was meant for the next one; select the next area first (as with the tolerance, which re-applies the last click). Setting the amount back restores the earlier result exactly. The status bar note (correction below) says when this applies.
- After Redo, or after an amount set while the Delete could not be adjusted (with a selection, or while the replace confirmation was open), the amounts shown can differ from those the result was made with. Nothing reconciles them until the user actually changes an amount; that change then updates the Delete with both amounts as shown (for example, shown 3 / 2 over a 1 / 0 result, changing Feather to 0 gives 3 / 0). Re-entering the same amount does not apply it.
- Each committed step is a full recomputation, synchronous like Delete: near 50 MP one to a few seconds per step on edge-dense images; three separate arrow presses are three recomputations (holding the key is one).
- One image-sized buffer more than Delete at the peak of an adjustment (the image before the Delete is rebuilt for it); nothing is kept between adjustments.
- A larger adjusted patch can make the history drop its oldest entries to stay within 256 MiB, and they do not come back when the amounts are reduced (Delete entries are kilobytes to a few megabytes, so this needs a history already near the limit).
- Two separate key presses that go up and back (Right, released, then Left, released) are two finished adjustments and update the Delete twice, the second back to the earlier result's exact bytes; only changes made and undone within one adjustment (a drag, keys held together, retyping before Enter, Escape) are not commits.

Owner decisions raised (Step 9) and the owner's answers (review of the first implementation; architecture, functionality and automated results provisionally approved):

1. When the amounts update the last Delete: right after a Delete (or its adjustment or Redo) until anything is selected, Undo or another edit. (Kept as implemented.)
2. Leaving a control committed the amount shown (tolerance convention), so after Redo the Delete could be updated by tabbing through. (Changed: only actual user changes commit; see the correction below.)
3. Indication: a small visible indication in an existing status area if feasible without toolbar layout changes. (Added in the status bar; see below.)
4. The announcement wording. (Accepted as is.)
5. Large images: each committed step recomputes synchronously. (Kept synchronous until the Phase 3 final performance review, Step 12.)

##### Review correction: only actual changes commit

Problem found in review: after Redo the controls can show other amounts than the redone Delete was made with, and merely focusing a control and tabbing away committed the amount shown, recomputing the image.

- `finishAdjustment(start, value)` (`toleranceInput.ts`): a finished adjustment is a change only when it ends on another amount than the interaction started from. Each edge control keeps that start (shared by its slider and field): the amount when the slider or field gains focus, when the slider is pressed, and after each finished adjustment. A change commits (`onEdgeSettingsCommit`: the amount, then the Delete updated if it can be); anything else only sets the amount again (`onEdgeSettingsChange`), so Escape still restores it and nothing is computed.
- So moving focus through the controls (Tab, Shift + Tab, clicking in and out), Enter or leaving a field without a change, a drag that ends where it began, keys held and stepped back before release, retyping the same number, and Escape never edit the image. Drags, key releases and typed values that end on another amount commit as before; the hook's own check (amounts already those of the result) and every Undo / Redo rule are unchanged. The tolerance control is unchanged.
- Visible indication: while a change would update the last Delete, the status bar shows "Edge settings update last Delete" after the selection readout ("No selection"), in the accent colour, with a tooltip "Changing Edge cleanup or Feather now updates the last Delete. Select something to set them for the next Delete instead." (`LastDeleteNote` in `StatusBar.tsx`). It is text, not a live region (the update announcements already speak), changes neither the toolbar nor the status bar height (checked in both browsers), and is hidden below 800 px, where the selection and pointer readouts keep the room (the tooltips still say it).
- Changed: `toleranceInput.ts` (`finishAdjustment`), `MagicWandOptions.tsx` (`EdgeAmountControl`), `StatusBar.tsx` and `StatusBar.css`, `App.tsx`; tests in `toleranceInput.test.ts` (6: the control's slider, keyboard and field behaviour composed from the same functions, including focus-through, drag back, held keys back, retyping, Escape, clamping) and `StatusBar.test.ts` (1, new); `scripts/browser/edge-adjust.mjs` and `lib/edges.mjs`.
- Browser: `edge-adjust.mjs` adds the Redo mismatch (3 / 2 shown over a 1 / 0 result): Tab five times and Shift + Tab five times through both controls, focusing and leaving each part, a drag from 3 to 5 and back, ArrowRight and ArrowLeft held together, typing 4 then 3 and Enter, typing 5 then Escape, Enter and leaving without a change: nothing computed and the entry still 1 / 0; then Feather changed to 0 updates the Delete to exactly 3 / 0, and tabbing through again changes nothing. Also the status bar note (shown only while adjustable, gone with a selection, hidden at 760 px with no sideways scrolling, no height change). With the old behaviour put back on purpose, exactly the seven Redo mismatch checks fail.
- The confirmation case changed accordingly: an amount committed by the focus move into the dialog is set (not applied); after Cancel, a different amount updates the Delete, while re-entering the same amount does not (a known limitation above).

Manual QA checklist (owner, desktop, Chrome and Firefox). Not yet run: none is marked passed. Images from `node scripts/browser/fixtures.mjs` (`scripts/browser/fixtures/`), plus your own screenshots. Look at results at 400–800% over the checkerboard.

| Check | Action | Passes when |
| --- | --- | --- |
| 9.1 Slider drag | `edge-hmi.png`, tolerance 10, click the grey background, Delete at 0 / 0. Look at the status bar and hover Edge cleanup. Drag its slider slowly to 3, pausing midway, then release | The status bar shows "Edge settings update last Delete" and the tooltip says "updating the last Delete"; nothing changes while dragging; at release the grey fringe disappears at once; the header still offers one "Undo Delete Selection" |
| 9.2 Keyboard | Tab to the Feather slider; press Right twice; then hold Right until 5 and release | Each press updates the image once (feathered edges grow); holding updates once, at release; the focus ring stays on the slider |
| 9.3 Typing | Click the Edge cleanup field, type 1 (image unchanged), Enter (updates); select the text, type 4, Escape | Enter updates; Escape returns the field to 1 and the image does not change |
| 9.4 No build-up | Set 5 / 5, then 0 / 0, then 1 / 0 twice | At 0 / 0 the image is exactly the plain Delete again (the faint fringe of 8.2 is back); both 1 / 0 results look identical |
| 9.5 One Undo | After several adjustments: Ctrl + Z once, then Ctrl + Y | Ctrl + Z restores the original image and its selection (marching ants); Ctrl + Y gives the latest adjusted result; adjusting again still works |
| 9.6 Next Delete | After a Delete, click another area (the tooltip now says "for the next Delete"); change Feather to 3; Delete | The first Delete does not change when Feather changes; the second Delete uses Feather 3; Undo undoes them one at a time |
| 9.7 Magic Wand options | After a Delete, change the tolerance (slider release), Contiguous / Global and New / Add / Subtract | The image does not change; the amounts still update the Delete afterwards |
| 9.8 After Undo | Delete, Ctrl + Z, then change Edge cleanup | The image and restored selection do not change; Delete then uses the new amount; Redo is no longer offered |
| 9.9 Confirmation | After a Delete, type 3 in Edge cleanup without Enter, then open another image (button, drop or Ctrl + V); Cancel; then type 2 in the field and press Enter | Nothing changes behind the dialog; after Cancel the image is still unchanged; Enter with 2 updates the Delete |
| 9.10 Thin lines | `edge-lines.png`, Global, click the white, Delete; then Edge cleanup 5 and Feather 5 by slider | Lines, hairline and dots stay whole after each update (as in 8.6 and 8.7) |
| 9.11 Screen reader (Orca) | After a Delete, adjust with the keyboard | "Delete Selection updated with Edge cleanup … px and Feather … px: …" is read once per update; the tooltips' wording is available as the controls' description |
| 9.12 Large images | `edge-hmi-4k.png` and `edge-hmi-50mp.png`: Delete at 0 / 0, then release the slider at 1, 3 and 5, then Feather 5 | 4K: each update well under half a second; 50 MP: about as long as Delete with those amounts (up to about 2–3 s), no error; dragging itself never stalls |
| 9.13 Firefox | Repeat 9.1–9.3 in Firefox, and Tab out of an edited field | As in Chrome; leaving the field commits (not checkable headless) |
| 9.15 Redo with other amounts shown | `edge-hmi.png`: Edge cleanup 1, Feather 0; click the background, Delete; Ctrl + Z; set Edge cleanup 3 and Feather 2 (the selection is back: only the next Delete); Ctrl + Y. Then keyboard only: Tab from Shrink through both sliders and fields to Delete Selection and Shift + Tab back; in a field type the same number and Enter; type another and Escape; on a slider press Right and Left together and release | The image never changes (the Delete stays at 1 / 0) and nothing is announced. Then change Feather to 0 and Enter: the Delete updates once, to 3 / 0 |
| 9.16 Status bar note | After 9.1, click the image to select; then Escape; then Ctrl + Z, Ctrl + Y; narrow the window below 800 px | The note disappears on selecting and stays away after Escape; it is back after Ctrl + Y; below 800 px it is hidden and the toolbar and status bar do not change height |
| 9.14 Real assets | Your VTScada screenshots: Delete at 0 / 0, then try Edge cleanup 1–2 and Feather 1 | Easier tuning than Undo and Delete; note anything surprising |

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
