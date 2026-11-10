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
- P3-D6: Auto Trim uses alpha-based visible bounds and adjustable padding. The threshold, padding at the image edge, and the effect on the selection and the view are confirmed in Step 10. (Step 10 implemented the algorithm with a provisional threshold of 0, every alpha of 1 or more visible, and padding clipped at each image edge. Step 11 uses them as the owner's provisional decisions for the tool, with the selection cleared and the view fitted after a trim. See Steps 10 and 11.)
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
8. Edge cleanup and feathering. Its manual QA also runs the nine deferred Step 6 checks. Implemented; its manual QA reconciled in Step 12.
9. Re-apply the last Delete when cleanup or feathering changes. Provisionally approved and committed as a checkpoint; its manual QA reconciled in Step 12.
10. Auto Trim algorithm. Committed as a checkpoint (`d16b997`).
11. Auto Trim tool (second manual checkpoint). Implemented and committed as a checkpoint (`d9fb99e`); its manual QA reconciled in Step 12.
12. Final quality assurance, performance, memory and Phase 3 readiness. Revisits Step 6 owner decision 1 (synchronous Delete, Undo and Redo on large images). Phase 3 sign-off and merge require every deferred Step 6 check to be completed or explicitly dispositioned. Verification done, with no defect found; awaiting owner review and the three required owner items listed in Step 12.

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

Viewport for size changes (provisional): a crop, and its Redo, keep the zoom and move the image so the pixels both images have stay where they were on screen; Undo of a crop moves it back, returning exactly to the view before the crop. The image is kept reachable. Same-size edits never change the view. The view after Auto Trim is confirmed in Step 10 (P3-D6). (Replaced in Step 11: a size change now fits the new image to the workspace, as Fit does.)

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

Deferred checks schedule: run the nine deferred checks after the next substantive coding round, preferably together with the Step 8 manual QA. Each must be completed or explicitly dispositioned by the owner (for example accepted as a known limitation, or moved to a later phase) before final Phase 3 sign-off and merge (Step 12). Status of each after Step 12: see Step 12, Reconciliation (five passed by automated checks or the owner's priority session; 15, 19, 21 and 23 still need a manual part or a disposition).

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

#### Step 8: Edge Cleanup and Feathering (committed as a checkpoint, `f2861e4`; manual QA reconciled in Step 12)

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

Manual QA checklist (owner, desktop, Chrome and Firefox). Not run as a whole; the status of each check after the owner's priority manual QA and Step 12's automated verification is in Step 12, Reconciliation. Images: `node scripts/browser/fixtures.mjs` writes the generated ones (`edge-*.png`, `edge-*.jpg`, `edge-svg.svg`) to `scripts/browser/fixtures/`; real VTScada screenshots and equipment photos are just as important. Look at results at 400–800% over the checkerboard.

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

#### Step 9: Re-applying the Last Delete When Edge Settings Change (provisionally approved; committed as a checkpoint; manual QA reconciled in Step 12)

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

Manual QA checklist (owner, desktop, Chrome and Firefox). Not run as a whole; the status of each check is in Step 12, Reconciliation. Images from `node scripts/browser/fixtures.mjs` (`scripts/browser/fixtures/`), plus your own screenshots. Look at results at 400–800% over the checkerboard.

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

#### Step 10: Auto Trim Algorithm (committed as a checkpoint, `d16b997`)

The Auto Trim algorithm as pure functions, tested on their own. Nothing in the application calls them yet: the Auto Trim tool, its padding controls, Trim Tight, its edit, Undo / Redo integration in the editor, the selection and view after a trim, and its messages are Step 11. The manual QA of Steps 8 and 9 (with the nine deferred Step 6 checks) is still outstanding and is not affected: no existing module changed.

Modules:

```text
src/image/trim/
├── autoTrim.ts              findVisibleBounds, planAutoTrim, autoTrimPixels, validatePadding,
│                            validateAlphaThreshold; DEFAULT_ALPHA_THRESHOLD (0), MAX_ALPHA_THRESHOLD (254)
├── autoTrim.test.ts         bounds, padding, crops, every edge case, random properties, read counts,
│                            4K to 50 MP and the widest and tallest images allowed
└── autoTrimHistory.test.ts  Auto Trim results through the existing crop patches, history commands and reducer
```

No other source file changed, and no dependency was added or removed. The trimmed pixels come from the existing `cropPixels` (`editor/history/cropPatch.ts`, Step 3), the function the history's Redo uses, so there is one crop in the code base.

API (all three validate their input before reading any pixel, throwing a RangeError, and never write it):

| Function | Returns |
| --- | --- |
| `findVisibleBounds(pixels, alphaThreshold = 0)` | The smallest rectangle containing every pixel whose alpha is above the threshold, or null when there is none |
| `planAutoTrim(pixels, { padding, alphaThreshold? })` | `{ kind: 'nothing-visible' }`, `{ kind: 'unchanged', visible }` or `{ kind: 'crop', visible, kept }`; reads alpha only and allocates nothing proportional to the image |
| `autoTrimPixels(pixels, options)` | The same, with the trimmed image (`pixels`) added to a crop |

Visibility (P3-D6; provisional, awaiting owner confirmation):

- A pixel is visible when its alpha is above the threshold. The threshold is 0 unless one is given, so every pixel with alpha 1 or more is content, however faint: anti-aliased edges, 1-pixel lines, feathered edges and soft shadows are kept whole.
- Only alpha bytes are read (the tests count every read: no colour byte is ever read), so colour hidden under alpha 0 by Delete (P3-D2) is never mistaken for content, whatever it is.
- The pure functions accept a threshold from 0 to 254 (254: only fully opaque pixels count). The application will pass none unless the owner decides otherwise. A threshold above 0 can remove visible content: a faint pixel outside the content found is cut off with the border. The measurements below quantify this.
- Isolated pixels count like any other. One faint speck far from the content, even at alpha 1, keeps that side from being trimmed. A threshold would help here (two alpha 1–2 specks near the corners: nothing trimmed beyond them at 0, both cut at 2), which is the case for considering one.
- Transparent holes inside the content make no difference: only the outermost visible pixel on each side counts.

Padding:

- Up to `padding` pixels of the image are kept around the visible bounds on each side, each side clipped at the image's edge on its own. Content touching the left edge keeps no padding on the left and the full padding elsewhere, so the padding of a result can be uneven.
- The image is never enlarged and no pixel is invented: the result is always a rectangle of the original. This follows FEATURE_SPEC ("the canvas is then reduced to those bounds plus padding") and the brief's "remove unnecessary transparent space"; a crop patch also cannot record added pixels.
- Any whole number of 0 or more is accepted; a padding larger than the space available keeps everything on that side. The algorithm has no default: the default of 5 px, the presets 0, 5, 10, 20 and Custom, and Trim Tight at 0 (PROJECT_BRIEF, FEATURE_SPEC §10, UI_UX_SPEC) are Step 11, as is the range allowed for Custom.

Nothing to do (no-op contract):

- `nothing-visible`: no pixel is above the threshold. This covers a fully transparent image of any size, including 1 × 1, whatever colour is hidden in it. No rectangle is returned at all, so no zero-size document can come from Auto Trim. Step 11 is to say there is nothing visible to trim (IMAGE_PROCESSING_SPEC) and change nothing.
- `unchanged`: the kept rectangle would be the whole image. This happens when the content with its padding reaches every edge: a fully opaque image, content at all four edges, or an image already trimmed with this padding or more. `visible` is returned, but no crop is made and nothing is allocated.
- Trimming is idempotent and composes. Trimming a result again with the same or a larger padding is `unchanged`; with a smaller padding it gives exactly what trimming the original with that padding gives (random images, byte for byte).
- Even if the whole image were passed on as a crop, `completedEditCommand` returns null (no entry, revision or display image): no meaningless edit can be recorded.

The crop:

- `kept` is in whole pixels, within the image, at least 1 × 1, smaller than the image in at least one direction, and contains `visible`. `kept.x` and `kept.y` are where the trimmed image's top-left pixel was.
- `autoTrimPixels` copies exactly the kept rectangle, row by row, into new memory of exactly `kept.width × kept.height × 4` bytes. Every byte is unchanged, including colour hidden in transparent pixels that are kept (holes, padding). Nothing is resampled, smoothed, recoloured, scaled or moved by less than a pixel. The source is never written (the tests compare every byte; at 50 MP a fingerprint of the whole image).

Reading the pixels:

- Rows are read from the top until the first visible pixel and from the bottom until the last. Then each row in between is read only to the left and to the right of the columns found so far. Pixels inside the bounds found are never read.
- Each pixel is read at most once, apart from at most two per row. The tests count reads: at most width × height + 2 × height, never a colour byte.
- A fully transparent image must be read entirely, which is the worst case. A fully opaque one takes 3 reads, and the 200 by 120 test image with a transparent border reads exactly its border plus 3.
- Reading bytes measured faster than reading 32-bit words (40 against 46 ms for a transparent 50 MP image, median of 7 runs in a separate comparison). A plain scan of every pixel took 53–74 ms at 50 MP whatever the content.

History compatibility (for Step 11; demonstrated in tests, not connected):

- A `crop` plan's `kept` is all an Auto Trim edit needs: `{ kind: 'auto-trim', change: 'crop', version, kept, selection }` is the existing `CompletedCrop`.
- `completedEditCommand` then records the crop patch: the original size, the kept rectangle, and every removed pixel, hidden colour included. It also makes the trimmed pixels with the same `cropPixels`, a new revision and its display image. Undo is `restoreCroppedPixels` and Redo is `cropPixels`.
- `autoTrimHistory.test.ts` drives the real commands and reducer through these cases:
  - A trim, then Undo and Redo three times: the original size and every byte back after each Undo (removed pixels and their hidden colours, each pixel's hidden colour distinct), the trim byte for byte after each Redo, a new revision every time.
  - A real Magic Wand click, Delete with Edge cleanup 1 and Feather 1, then Auto Trim: two Undos give the opened pixels exactly, the selection and the click (re-appliable, bound to the new version); two Redos give the trim.
  - A Delete of a photograph's surroundings (varied hidden colour), a trim, then two Undos: the original exactly.
  - 4K images with a border of transparent black or one hidden colour: under 4 KB retained.
  - Random trims, also two in a row, all undone and redone.
- Why the removed hidden colour must be kept: an earlier Delete's patch restores colour by flipping alpha only. If a trim's patch stored transparent black instead, undoing the trim and then the Delete would show wrong colours. This is what makes a trim of a deleted photographic background expensive to record (limitations below).
- After an Auto Trim, Step 9's adjustable Delete no longer applies: `adjustableAfter` gives null for an `auto-trim` entry, and the Delete is no longer the next Undo.

Tests: 43 added (1,152 in total, 65 files).

- `autoTrim.test.ts` (37). Bounds:
  - a single pixel at every position, alpha 1 counted, hidden colour never counted or read, transparent images of every shape;
  - opaque images, frames and edge midpoints;
  - 1-pixel lines along every row and column, islands whose extremes lie in middle rows;
  - content at each edge, holes, soft anti-aliased edges;
  - every threshold boundary, 16,384 × 1 and 1 × 16,384;
  - 600 random images and thresholds against a per-pixel reference, read counts, input never written, invalid input.

  Planning:
  - padding on each side, clipping at each edge on its own, content touching one side;
  - no removable border, nothing visible, all four sides at once;
  - 600 random cases checking exact geometry, what a threshold cuts, idempotence and composition (300 random cases), invalid padding and thresholds rejected before any read.

  Cropping:
  - every byte with hidden colour, every visible pixel at its place (400 random cases), new memory of exact size, one crop and none for no-ops, 1 × 1 results;
  - thin lines, a hairline and single pixels after Delete with four edge settings;
  - the eight Step 7 / 8 scenes after Magic Wand and Delete at five edge settings and two paddings.

  Large images:
  - 50 MP with a deleted background, a faint pixel and a 1-pixel line at the extremes;
  - transparent, opaque and two-corner-pixel 50 MP images;
  - 16,384 × 3,051 and 3,051 × 16,384.
- `autoTrimHistory.test.ts` (6): the cases above.
- Mutation testing: 25 deliberately introduced defects in `autoTrim.ts` were each caught. They covered threshold off by one, colour bytes read, unclipped or off-by-one padding on each side, off-by-one bounds, the middle, bottom and top row logic, early exits, the no-op checks, validation, the default and the cropped rectangle.
- Three temporary defects in the crop history path (`cropPatch.ts`) were also caught by the new tests alone: Undo dropping hidden colour, a crop shifted by a column, and Undo misplacing rows. Every file was restored and checked identical.
- Two of the first defects made the test runner crash instead of failing, because a failing 50 MP assertion printed a result holding the image. Those assertions now compare summaries, and the same defects fail cleanly.

Measurements (Node 24, x64, i7-14700HX; median of 5–21 runs in one process; padding 5; every transparent pixel hides a colour; the browser timings come with the tool in Step 11):

| Image | Content | Visible bounds | Plain scan (reference) | `autoTrimPixels` | Result | Crop patch (the edit) | Patch | Undo | Redo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 64 × 64 | Object | 0.01 ms | 0.02 ms | 0.01 ms | 44 × 44 | 0.02 ms | 8 B | 0.02 ms | 0.01 ms |
| 256 × 256 | Object | 0.06 ms | 0.08 ms | 0.08 ms | 140 × 140 | 0.06 ms | 8 B | 0.1 ms | 0.03 ms |
| 1920 × 1080 | Object | 0.9 ms | 2.4 ms | 1.6 ms | 972 × 552 | 1.9 ms | 8 B | 0.9 ms | 0.2 ms |
| 3840 × 2160 | Object | 3.7 ms | 9.4 ms | 4.8 ms | 1932 × 1092 | 11 ms | 8 B | 10 ms | 1.7 ms |
| | HMI | 1.0 ms | 12 ms | 11 ms | 3466 × 1954 | 2.8 ms | 8 B | 4.9 ms | 4.0 ms |
| | Sparse | 3.7 ms | 8.9 ms | 4.9 ms | 1899 × 1084 | 11 ms | 8 B | 4.2 ms | 1.1 ms |
| | Transparent | 4.8 ms | 8.9 ms | 4.8 ms | Nothing visible | | | | |
| | Opaque | 0.00 ms | 11 ms | 0.00 ms | Unchanged | | | | |
| | Deleted photo | 3.7 ms | 9.5 ms | 4.8 ms | 1932 × 1092 | 52 ms | 23.6 MB | 5.0 ms | 1.4 ms |
| 8660 × 5773 (50 MP) | Object | 22 ms | 57 ms | 41 ms | 4342 × 2899 | 65 ms | 8 B | 60 ms | 19 ms |
| | HMI | 6.2 ms | 74 ms | 66 ms | 7804 × 5207 | 17 ms | 8 B | 72 ms | 60 ms |
| | Sparse | 22 ms | 53 ms | 41 ms | 4268 × 2880 | 65 ms | 8 B | 60 ms | 18 ms |
| | Two corner pixels | 0.05 ms | 53 ms | 0.05 ms | Unchanged | | | | |
| | Transparent | 29 ms | 53 ms | 32 ms | Nothing visible | | | | |
| | Opaque | 0.00 ms | 66 ms | 0.00 ms | Unchanged | | | | |
| | Deleted photo | 22 ms | 57 ms | 41 ms | 4342 × 2899 | 339 ms | 142.7 MB | 74 ms | 19 ms |
| 16384 × 3051 | Object | 22 ms | 57 ms | 40 ms | 8204 × 1539 | 61 ms | 8 B | 60 ms | 19 ms |
| | Transparent | 29 ms | 53 ms | 29 ms | Nothing visible | | | | |
| 3051 × 16384 | Object | 23 ms | 57 ms | 43 ms | 1539 × 8204 | 62 ms | 8 B | 61 ms | 20 ms |
| | Transparent | 29 ms | 53 ms | 29 ms | Nothing visible | | | | |

The content kinds:

- Object: a dense opaque block over the middle quarter, ringed by a 1-pixel line at alpha 1, on a background deleted to one hidden colour.
- HMI: shapes and 1-pixel lines filling the image to within 5% of each edge.
- Sparse: 200 isolated pixels of random alpha over the middle half.
- Deleted photo: the object on a background whose every pixel hides a different colour.

In a new process, before the JavaScript engine has optimised the code, the first call takes longer:

- Planning a 50 MP image takes 40–54 ms, and `autoTrimPixels` 60–75 ms.
- The whole computation of a Step 11 edit (plan, patch, crop) takes 25 ms at 4K and 138 ms at 50 MP on a flat background, and 70 ms and 426 ms after a deleted photo background.
- The browser adds the display image: 13–26 ms at 4K and 77–138 ms at 50 MP (Step 4).

Memory (Node, resident high-water mark above the open image, each case in its own process):

| Case | Peak | Kept |
| --- | --- | --- |
| Visible bounds or plan, 4K or 50 MP, any content | 3 MB, the same at both sizes: nothing proportional to the image | 3 MB |
| `autoTrimPixels`, 50 MP object (48 MB result) / HMI (155 MB result) | 51 / 156 MB | 51 / 156 MB |
| Edit computation, flat background: 4K / 50 MP | 11 / 51 MB | 11 / 51 MB |
| Edit computation, deleted photo background: 4K / 50 MP | 58 / 339 MB | 41 / 196 MB (result and patch) |
| Undo, 50 MP | 191 MB (the restored image) | 191 MB |
| Redo, 50 MP object | 48 MB | 48 MB |

Threshold study: what an alpha threshold would cut. The table counts visible pixels outside the kept rectangle, at padding 0 / padding 5, with the highest alpha cut. The images are the Step 7 / 8 scenes and the thin-line scene after Magic Wand and Delete at 0 / 0, 1 / 0, 0 / 3 and 5 / 5, plus two transparent PNG cases:

| Image | Threshold 0 | 1–16 | 32 | 64 |
| --- | --- | --- | --- | --- |
| Nine Delete results × four edge settings | Nothing | Nothing | Up to 48 outermost feathered pixels (alpha ≤ 26) at padding 0; none at 5 | Up to 48 (alpha ≤ 43) at 0; none at 5 |
| An icon with a soft drop shadow | Nothing | 48 (at 1) to 488 (at 16) shadow pixels at 0; none at 5 | 800 / 128 | 1,355 / 496 |
| Content with alpha 1 and 2 specks near two corners | Nothing cut; trimmed only to the specks | Specks cut (one at 1, both from 2); trimmed to the content | As 2 | As 2 |

Known limitations (Step 10):

- History size of a trim after deleting a photographic background. The removed pixels' hidden colours are stored exactly (4 bytes per removed pixel): 143 MB for a 50 MP image trimmed to a quarter. Creating it peaks at 339 MB and takes 0.34–0.43 s. Exact Undo needs it (above). It fits the 256 MiB budget, but drops older entries. Flat, transparent and single-colour backgrounds cost a few bytes.
- At threshold 0, a single faint stray pixel blocks trimming on its side, and Auto Trim cannot tell it from content.
- Clipped padding can leave a result's padding uneven, and there is no way to add transparent space beyond the image.
- Measured in Node only; browser timings, the display image and the whole edit's time come with Step 11.
- `cropPixels` stays in `editor/history/cropPatch.ts`, so `image/trim/autoTrim.ts` is the first application module under `image/` to import from `editor/history/`. Moving it to `image/` would be a separate refactor; it was not done.

Owner decisions before Step 11:

1. Visibility threshold: keep 0 (recommended: nothing visible is ever cut; the study shows thresholds up to 16 change nothing on Delete results, but cut soft shadows), or offer a threshold, and if so where and how it is described.
2. Padding at the image's edges: clip each side (implemented and recommended), or extend the image with transparent pixels to give full padding (a new kind of edit, larger than Step 11).
3. Padding presets and default: the brief already gives 5 px by default, presets 0, 5, 10, 20 and Custom, and Trim Tight at 0. Still open: the range allowed for Custom, and whether the last padding is remembered for the session (ARCHITECTURE, Persistence, lists "Last Auto Trim padding").
4. Selection after Auto Trim (P3-D6): cleared, as for crops in IMAGE_PROCESSING_SPEC, or cropped to the kept rectangle. Undo restores the selection from before the trim either way.
5. View after Auto Trim (P3-D6): the provisional crop behaviour from Step 5 (zoom kept, the kept pixels stay where they were on screen, kept reachable) or Fit.
6. Messages: wording for nothing visible, nothing to trim, and the trim itself. `editFeedback.ts` already has "Auto Trim applied." and "Auto Trim changed nothing." from Step 6.
7. The history cost of trimming a deleted photographic background near 50 MP (about 143 MB): accept, or add a warning.
8. Whether Auto Trim shows the kept rectangle before applying it (UI_UX_SPEC: "Where practical, the user should see changes before permanently applying them"). This would also reveal a stray pixel that blocks trimming.

Step 11 integration notes (not decisions):

- The command should call `planAutoTrim` and pass `plan.kept` to `completedEditCommand`, which crops once. `autoTrimPixels` would crop a second time; it is for callers that need the pixels themselves.
- A plan is computed from one document version and is only valid for it, like every other edit (the version tag already guarantees this).
- These belong to Step 11:
  - the tool's place (the toolbar's `auto-trim` tool exists but is unavailable), its options row, Trim and Trim Tight;
  - shortcuts and availability (no image, an import in progress);
  - focus after trimming and announcements;
  - the selection and view (decisions 4 and 5), and browser timings and manual QA.

#### Step 11: Auto Trim Tool (committed as a checkpoint, `d9fb99e`; manual QA reconciled in Step 12)

The second manual checkpoint. Auto Trim works in the application: the toolbar's Auto Trim tool, its options row (padding presets, a padding field and Trim), one Undo step per trim, messages when there is nothing to trim, and a message when a trim makes the history drop older Undo steps. The Step 10 algorithm is used as it is (`planAutoTrim`, threshold 0); the Magic Wand, Delete Selection, Edge cleanup, Feather and Step 9's adjusting are unchanged. The manual QA of Steps 8 and 9, with the nine deferred Step 6 checks, is still outstanding and is not replaced by this step's checklist.

The owner's provisional decisions for Step 11, as applied:

1. Visibility threshold 0 (every alpha of 1 or more is visible); no threshold control.
2. Padding is clipped at the image's edges; no pixel is ever added.
3. Padding: 5 px by default, whole numbers from 0 to 50, back to 5 px when another image is opened successfully (a failed import keeps it). Changing it never changes the image.
4. A trim clears the selection and the Magic Wand click; Undo restores both (the click bound to the restored version, so a committed tolerance re-applies it exactly).
5. The trimmed image is fitted to the workspace, exactly as Fit does. Applied as well to Undo and Redo of a trim (see decision 2 below).
6. Short messages for a trim, for an image with no visible pixels, and for an image with nothing to trim (below).
7. The 256 MiB budget is unchanged. Older Undo steps actually dropped by a trim are counted, and a message says so; nothing warns by image size, and nothing blocks.
8. No preview: one click on Trim trims; Undo takes it back.

Conflicts with approved specifications, flagged rather than settled silently:

- Presets: `PROJECT_BRIEF.md`, `FEATURE_SPEC.md` §10 and `UI_UX_SPEC.md` (Auto Trim UX) ask for quick options 0, 5, 10 and 20 px and a custom value. They are implemented as four preset buttons and a field taking any whole number from 0 to 50 (the custom value). The range 0–50 is the owner's; the specifications gave none.
- Trim Tight: the brief says a one-click Trim Tight action "may" use 0 px, and the Phase 3 work list names it. It is not added as its own control: preset 0, then Trim. Owner decision 1 below.
- Where Trim lives: Auto Trim is a toolbar tool with its own options row, as the Toolbar section of `UI_UX_SPEC.md` lists it, so trimming after a Delete means choosing Auto Trim, then Trim (two clicks). `UI_UX_SPEC.md` says Auto Trim "may be surfaced prominently" after a Delete; nothing was added to the Magic Wand row. Owner decision 1 below.
- Nothing to trim is shown as a message in the workspace as well as announced. Step 6 decision 5 had a Delete that changes nothing announced only; Delete keeps that behaviour. Owner decision 3 below.
- The view: Step 5's provisional crop view (zoom kept, kept pixels stationary) is replaced by Fit (owner decision 5), for the trim, its Undo and its Redo.
- `ARCHITECTURE.md` (Persistence) lists "Last Auto Trim padding" as a possible preference; the padding now goes back to 5 px with each image, and nothing is stored.

Modules:

```text
src/
├── editor/autoTrimPadding.ts           DEFAULT_AUTO_TRIM_PADDING (5), MAX_AUTO_TRIM_PADDING (50),
│                                       the presets, the field's range (Page keys step 10),
│                                       paddingFieldEvent (the field), clamping
├── editor/editCommands.ts              EditAction 'auto-trim', availableEditActions.autoTrim (an
│                                       image open, no import running), autoTrimCommand
├── editor/editorState.ts               autoTrimPadding (reset by a successful import), the action
│                                       auto-trim-padding-changed, AutoTrimNoChange in edit-unchanged,
│                                       resized and droppedUndoSteps in the applied notice,
│                                       edit-notice-dismissed, Fit after a size change, and
│                                       placeOnNextResize after an import while Auto Trim is active
├── editor/editFeedback.ts              Auto Trim texts; isShownEditNotice
├── editor/tools.ts                     Auto Trim available
├── components/Toolbar/AutoTrimOptions.tsx    the options row
├── components/Toolbar/ToolOptions.tsx        the active tool's row (Magic Wand or Auto Trim)
├── components/Workspace/EditNoticeMessage.tsx  an outcome shown as a dismissible message
├── components/Workspace/Workspace.tsx        shown outcomes in the polite status region
└── app/App.tsx                               wiring
```

Also changed: `ToolOptions.css`, `Workspace.css`; comments in `image/trim/autoTrim.ts`, `historyCommands.ts` and `autoTrimHistory.test.ts`. Browser scripts: `auto-trim.mjs` (new), `fixtures.mjs` (the `trim-*` fixtures), `lib/gpu.mjs` (the GPU-process lookup, moved out of `gpu-crash.mjs` so both scripts share it), `lib/browsers.mjs` (a Space key), `README.md`. The Step 10 algorithm, the Magic Wand, Delete, Edge cleanup, Feather and Step 9 code are unchanged. No dependency was added or removed.

The tool:

- The toolbar's Auto Trim (its icon, the label and the tooltip "Remove empty transparent space around the image") is available whenever an image is open. Choosing it presses it and replaces the Magic Wand's options row with its own: "Padding", the presets 0, 5, 10 and 20 (toggle buttons, the one equal to the padding pressed, none for other amounts; accessible names "0 px" to "20 px"), the field ("Padding in pixels, 0 to 50", unit "px"), then Trim (an icon and "Trim").
- The field follows the tolerance field's conventions (`toleranceInput.ts`) with the range 0–50: a whole number from 0 to 50 applies as it is typed; other text waits for Enter or leaving the field, when a number is rounded and clamped and anything else restores the padding; Up / Down step by 1, Page Up / Page Down by 10; Escape cancels an unfinished entry. Every change only sets the padding (`auto-trim-padding-changed`); Enter never trims.
- Trim's tooltip says what it will keep ("…with 5 px of padding on each side, where the image has that much"; at 0 px "…removing all the transparent space around them"). While another image is opening it is `aria-disabled` and its tooltip adds "— not available while another image is opening". Its label and size never change; focus stays on it after a trim.
- While Auto Trim is the tool, clicks on the image do nothing (the Magic Wand's crosshair is gone). Space panning, wheel zoom, Delete, Ctrl + Z / Y / Shift + Z, Ctrl + A and Escape work as before. Opening another image makes the Magic Wand active, as before, and the next workspace resize places the image again (its row can be taller than Auto Trim's).
- No keyboard shortcut runs Auto Trim.

Integration:

- `autoTrimCommand` plans with the state's padding (`planAutoTrim`, threshold 0). A `crop` plan goes to `completedEditCommand` as `{ kind: 'auto-trim', change: 'crop', kept, selection: null }`: the crop patch (every removed pixel, hidden colour included), the trimmed pixels cut once by `cropPixels`, a new revision and, last, its display image. `nothing-visible` and `unchanged` become `edit-unchanged` with the reason, computing and allocating nothing more. An exception becomes `edit-failed` ('auto-trim').
- It runs like Delete Selection: `editActionCommand` (availability: an image open, no import running), `useEditCommands` (nothing while the replace confirmation is open), `dispatchEditAction` (`flushSync`, then the image released if the reducer rejected the action).
- The reducer applies a trim with the checks every edit has (version, the selection and click it was computed with, a newer revision with its own memory, a display image of its size, the patch's sizes). Stale trims (two from one state, one computed before a selection change, another edit, Undo or another image) are rejected permanently, and their display images released.
- Accepted: one entry (Redo cleared), the selection and click cleared, the edit depth up by one (an unexported edit), Step 9's adjustable Delete forgotten, the view fitted, and the notice with the sizes before and after and the Undo steps dropped.
- Undo and Redo use the existing crop patches: Undo restores the original size and every byte, the selection and the click from before the trim; Redo crops again. Both fit the image they restore.
- No-ops change nothing but the announcement: no entry, revision, display image or depth change; Redo is kept.

Messages (`editFeedback.ts`):

| Outcome | Text | Shown |
| --- | --- | --- |
| Trim | "Auto Trim applied: 1,920 × 1,080 px trimmed to 642 × 410 px." | Announced (the image shows it) |
| Trim dropping older Undo steps | The same, then "Undo history is full, so the oldest Undo step is no longer available." or "…the 3 oldest Undo steps are no longer available." | Message in the workspace, announced once |
| No visible pixels | "Nothing to trim: the image has no visible pixels." | Message, announced once |
| Padding reaches every edge | "Nothing to trim: no side has more than 5 px of transparent space." (0 px: "Nothing to trim: visible pixels already reach every edge of the image.") | Message, announced once |
| Undo / Redo | "Undone: Auto Trim." / "Redone: Auto Trim." | Announced |
| Failure | "Auto Trim could not be completed. The image and selection have not changed." (with the memory hint when it applies) | Alert, as other edit failures |

A shown message sits in the workspace's polite status region (with the import messages), so it is announced once and not again by the hidden region. It has a dismiss button, and goes when a later outcome replaces it or another image opens.

History eviction: when `recordEdit` keeps the history within its limits (25 entries, 256 MiB) it drops the oldest entries. The reducer counts the Undo steps the history offered before the edit, plus the new one, that it no longer holds (`droppedUndoSteps`). Redo entries, which every new edit discards, are not counted. It is counted for every edit but shown only for Auto Trim; Delete keeps its Step 6 announcement. Both limits count: in the browsers the 26th step (a trim after 25 Deletes) drops one, and in the unit tests a trim's large entry drops older ones by bytes. Near 50 MP a trim of a deleted photographic background retains about 150 MB (below), so a history already holding over about 100 MB loses its oldest steps.

Tests: 39 added (1,191 in total, 66 files, all passing): `autoTrimCommand.test.ts` (23: padding 0 / 5 / 50, clipping, sizes and Fit, thin lines and partial alpha after real Magic Wand Deletes with hidden colour, fully transparent, opaque, every-edge and already-trimmed no-ops, Redo and depth kept by no-ops, selection and click cleared and restored, three Undo / Redo cycles, Magic Wand + Delete with Edge cleanup and Feather + Trim + two Undos + two Redos, Step 9 eligibility, availability and padding reset, stale trims, release of a rejected trim's image, Strict Mode replays, failures, eviction by bytes and by count, a 4K trim, padding clamping), plus feedback texts (4), markup (6 options row, 2 workspace) and the padding field (4). Existing tests updated for the new tool, availability and the Fit view. 30 deliberately introduced defects (the padding ignored, the visible bounds kept instead of the padded ones, silent or wrong no-ops, availability, the padding not reset, clamped or validated, re-placing after Auto Trim, dropped steps miscounted, sizes missing, Undo not fitted, fitting the wrong image, notices not dismissible, not shown, shown for Delete or announced twice, wrong texts, range and default, presets never pressed, `disabled` instead of `aria-disabled`, the row or the tool missing) were each caught. One only after a change: the padding field using the tolerance's 0–100 range survived, because the reducer clamps every padding to 50 anyway (the only effect: 51–100 applied while typed instead of on Enter). The field's behaviour moved into `paddingFieldEvent` (`autoTrimPadding.ts`), which the field test now drives, and the browser script checks that 75 waits for Enter.

Browser verification: `scripts/browser/auto-trim.mjs` (headless Chrome and Firefox, device pixel ratio 1):

- Production build: 146 checks pass without timings (Chrome 75, Firefox 71), 174 with them. With `--kill-test-gpu-process` Chrome passes 77: after a trim the GPU process is killed and the canvas is restored showing the trimmed image exactly, and Undo afterwards shows the image before the trim.
- Development server (React Strict Mode): the same 146 checks pass, with no React warnings or console errors in either browser. (A first Strict Mode run was discarded: the defect-injection run was editing `src/` while the development server served it.)
- One live display image after every section in both browsers.
- Regressions, all passing: `smoke.mjs` 340, `edit-workflow.mjs --no-perf` 507, `edit-ownership.mjs` 52, `edge-cleanup.mjs --no-perf` 885, `edge-adjust.mjs --no-perf` 175, `gpu-crash.mjs --kill-test-gpu-process` 23.
- Not checked headless: Enter and Space on buttons in Firefox (headless Firefox has no window focus and does not activate buttons from keys; checked in Chrome); in Firefox, Tab order is checked in a fresh session (after the other sections, Tab alternated between the first two buttons of an options row, the Magic Wand's as well); the visible focus ring; screen readers; the real clipboard and drag and drop.

Measurements: production build, headless, this machine, one run each. Times are the whole synchronous handler (the click on Trim or the key press, to the commit and its layout effects, display image included); every trim was checked byte for byte in the page, and every Undo:

| Image | Browser | Delete | Trim | Undo | Redo | History after the trim |
| --- | --- | --- | --- | --- | --- | --- |
| 3840 × 2160, flat background → 470 × 295 | Chrome | 177 ms | 36 ms | 27 ms | 3 ms | under 0.05 MB |
| | Firefox | 95 ms | 26 ms | 45 ms | 4 ms | under 0.05 MB |
| 3840 × 2160, photographic background → 970 × 650 | Chrome | 122 ms | 100 ms | 30 ms | 4 ms | 29.2 MB |
| | Firefox | 97 ms | 118 ms | 45 ms | 7 ms | 29.2 MB |
| 8660 × 5773, flat background (`big50mp.png`) → 7410 × 4710 | Chrome | 808 ms | 248 ms | 162 ms | 124 ms | 0.2 MB |
| | Firefox | 502 ms | 212 ms | 232 ms | 160 ms | 0.2 MB |
| 8660 × 5773, photographic background → 470 × 294 | Chrome | 513 ms | 797 ms | 153 ms | 9 ms | 143.1 MB |
| | Firefox | 499 ms | 694 ms | 232 ms | 12 ms | 143.1 MB |

- Nothing to trim near 50 MP: a fully transparent image (the longest scan) 259 ms in Chrome and 48 ms in Firefox (Chrome's first call of the scan; Node measured about 30 ms warm in Step 10); an opaque one 1 ms in both.
- Display image: 14 ms (Chrome) and 25 ms (Firefox) at 4K for Undo; 59 ms and 103 ms for the 7410 × 4710 trim; 80 ms and 150 ms for a full 50 MP Undo; about 1 ms for the small trimmed images. The rest of a trim is the crop patch (every removed pixel, run-length encoded) and the crop itself.
- On the 50 MP photographic fixture the Magic Wand also took the flat box around the pump, so the trim kept only the pump: about 37.5 million removed pixels hid different colours (the noise), the rest one colour. Its 143.1 MB entry matches Step 10's Node figure. The 4K one kept the box (970 × 650).
- Memory (Chrome, JavaScript heap 3.1 MB and ArrayBuffers after garbage collection, measured after Redo): 34 MB (4K flat), 65 MB (4K photographic: the 29 MB entry and the image), 326 MB (50 MP flat) and 336 MB (50 MP photographic: the 143 MB entry, plus the full-size image React's previous render still holds until its next render). One live display image after every step, in both browsers.

Known limitations (Step 11):

- Synchronous like Delete: near 50 MP a trim of a deleted photographic background pauses the page for about 0.7–0.8 s (0.2–0.25 s for a flat background), with no progress indication; at 4K about 0.1 s at most (Step 6 decision 1, revisited in Step 12).
- A 50 MP trim of a deleted photographic background retains about 150 MB of history; older steps are dropped when the history already holds over about 100 MB (the message says so).
- Threshold 0: a faint stray pixel blocks trimming on its side; no preview reveals it.
- Clipped padding can be uneven.
- Trimming after a Delete takes two clicks (choose Auto Trim, then Trim).
- Where the Magic Wand row wraps (75 px at 1400 px wide, Auto Trim's 39 px), switching tools resizes the workspace; the view keeps its centre.
- A nothing-to-trim message stays until dismissed, replaced or another image opens.
- Delete and Step 9 adjustments can also drop Undo steps; they stay silent, as before.
- Headless Firefox: Enter and Space on buttons are not checkable, and Tab alternated between two buttons after long sessions (also in the Magic Wand row).

Owner decisions raised (Step 11):

1. Where Trim lives: a tool with its own row (implemented), or also a Trim action in the Magic Wand row after a Delete; and whether a separate Trim Tight control is wanted.
2. View after Undo and Redo of a trim: Fit (implemented) or something else.
3. Nothing-to-trim and eviction shown as visible messages (implemented) versus announced only like Delete's no-op; and whether Delete should report dropped steps too.
4. Eviction message for both limits (implemented) or only the memory budget.
5. Padding control: presets plus a 0–50 field, no slider, reset per image.
6. Message wording.
7. Large-image synchronous pauses (Step 12).

Manual QA checklist (owner, desktop, Chrome and Firefox). Not run as a whole; the status of each check is in Step 12, Reconciliation. Images: `node scripts/browser/fixtures.mjs` writes `trim-*.png` (and the earlier fixtures) to `scripts/browser/fixtures/`; your own pump, valve and VTScada images are just as important. Look at results at 100–800% over the checkerboard.

| Check | Action | Passes when | Known limitation |
| --- | --- | --- | --- |
| 11.1 The tool | Open `trim-pump.png`; click Auto Trim in the toolbar; click on the image | Auto Trim is pressed; the row shows "Padding", 0 5 10 20 (5 pressed), the field "5" and "px", then Trim; the Magic Wand row is gone; the status bar says "Tool: Auto Trim"; clicking the image selects nothing | — |
| 11.2 Padding computes nothing | Click 10, 20, 0; type 37 and Enter; 75 and Enter; "abc" and Enter; 3 then Escape; Up, Down, Page Up, Page Down in the field | The pressed preset follows (none for 37); 75 becomes 50; "abc" and Escape restore the previous value; the image, the status bar size and Undo never change | — |
| 11.3 Pump after Delete | Magic Wand, tolerance 10, click the grey background (top-left corner); Delete; Auto Trim, padding 5, Trim | The image shrinks to the pump, valve, wires, status light and text with 5 px around them; the 1-pixel black wire's right end and the "P-101 RUN" box are inside; the whole result is fitted in the workspace; no selection outline; the status bar shows the new size | — |
| 11.4 Your pump and valve images | Your own equipment graphics (and `trim-valve.png`): Delete the background if it has one, then Trim at 0, Undo, at 20, Undo, at 50 | 0: tight to the outermost visible pixels, faint shadow and anti-aliasing included; 20 and 50: padding stops at the image's edges where there is not that much room (sides can differ); the image is never enlarged | A faint stray pixel or a soft shadow far from the object keeps that side from being trimmed (threshold 0) |
| 11.5 Thin lines and faint edges | `edge-lines.png`: Magic Wand Global, click the white, Edge cleanup 1, Delete; Auto Trim at 0 | Every line, the hairline, the dots and the sub-pixel dot are kept; at 400–800% no faint edge pixel along the result's border is cut | — |
| 11.6 Fit | Zoom to 400% and pan to a corner, then Trim | The whole trimmed image is shown, fitted (or at 100% if it is smaller than the workspace), centred | — |
| 11.7 Undo and Redo | After 11.3: Ctrl + Z, Ctrl + Z, Ctrl + Y, Ctrl + Shift + Z; then the header's Undo and Redo | First Undo: the full-size image with its deleted (checkerboard) border, fitted; second: the original with its selection (marching ants); Redo: the Delete result; Redo: the trimmed image exactly as before. The buttons read "Undo Auto Trim" / "Redo Auto Trim" | — |
| 11.8 Selection after Undo | After the second Undo in 11.7, drag the tolerance slider and release | The selection is re-applied from the original click, as before the Delete | — |
| 11.9 After a Delete (Step 9) | Delete; note "Edge settings update last Delete" in the status bar; Trim; go back to the Magic Wand and change Edge cleanup | The note is gone after the trim; changing the amount does not change the image (it is for the next Delete) | — |
| 11.10 Nothing to trim | After 11.3 press Trim again at 5; open `trim-empty.png` and Trim; open `trim-edges.png`, padding 0, Trim; open any opaque screenshot and Trim | A message at the top of the workspace says why ("…no side has more than 5 px of transparent space.", "…the image has no visible pixels.", "…visible pixels already reach every edge of the image."); the image, its size and Undo do not change; the × closes the message | — |
| 11.11 Already trimmed | After 11.3: Trim at 0 | The 5 px border goes; one more Undo step; Undo brings it back | — |
| 11.12 Opening images | Set padding 20 and open another image | The padding is back to 5, the Magic Wand is active, the new image is fitted | — |
| 11.13 Replace confirmation | After a trim, open another image (button, drop or Ctrl + V); while the dialog is open try Trim; Cancel; Trim again | Nothing happens behind the dialog; after Cancel the trimmed image and Undo are unchanged and Trim works | — |
| 11.14 Keyboard only | Tab to Auto Trim in the toolbar, Enter; Tab through the presets and press Space on one; in the field use the arrows and Enter; Tab to Trim, press Enter, then Space | Every control shows a focus ring; Enter and Space activate; Enter in the field never trims; focus stays on Trim; Shift + Tab goes back | Please check in Firefox: button keys could not be checked in headless Firefox |
| 11.15 Screen reader (Orca) | Move through the row; Trim; Trim again | Presets read as toggle buttons "5 px" (pressed or not); the field reads "Padding in pixels, 0 to 50"; the trim is announced once with both sizes; the nothing-to-trim message is read once | — |
| 11.16 Large images | `trim-4k.png` and `trim-photo-4k.png` (Magic Wand at 2, 2, tolerance 10 and 20, Delete, Trim, Undo, Redo); then `trim-photo-50mp.png` (tolerance 20) and `big50mp.png` (tolerance 20 at 10, 10) | 4K: each step well under half a second; 50 MP: Trim, Undo and Redo pause the page for about the times in the measurements above; no error; Undo exact | The page pauses with no progress indication (synchronous, as Delete) |
| 11.17 History eviction (where reproducible) | `trim-pump.png`, Magic Wand at tolerance 0: 25 separate Deletes (for example 24 single clicks on different shades of the pipes, then the background), then Trim | A message: "…Undo history is full, so the oldest Undo step is no longer available."; Undo reaches back 25 steps, not to the opened image | Large-image eviction needs over about 100 MB of earlier history before a 50 MP photographic trim |
| 11.18 Firefox | Repeat 11.1, 11.3, 11.7, 11.10 and 11.14 in Firefox | As in Chrome | — |
| 11.19 Narrow window | About 640 px wide: switch between the Magic Wand and Auto Trim; Trim; show a nothing-to-trim message | The Auto Trim row stays on one line with Trim visible; no sideways scrolling; the message fits; the image stays in view when the row height changes | Below 640 px the app scrolls sideways (its minimum width since Phase 1) |

Still outstanding from earlier steps, unchanged by this checklist: the Step 8 manual QA (8.1–8.23), the Step 9 manual QA (9.1–9.16), and the nine deferred Step 6 checks (12, 14, 15, 16, 19, 20, 21, 22, 23). None of them is passed by Step 11's testing.

#### Step 12: Final Quality Assurance and Release Readiness (verification done; awaiting owner review)

Final QA of everything Phase 3 delivers: the owner's manual results recorded, every outstanding manual check reconciled, a full automated regression in Chrome and Firefox (production build and React Strict Mode), pixel integrity and history, large-image performance and memory, edge cases, failures and accessibility.

No product defect was found, and no application code changed: the production bundle is byte-identical to `d9fb99e`'s (`index-DHnWpORN.js`). One regression test file was added (`src/editor/phase3Workflow.test.ts`), and no dependency was added or removed. No Phase 4 work was started.

Readiness in one paragraph: every automated check passes in both browsers, in production and under Strict Mode, including GPU process loss. Every content state checked is restored byte for byte through Delete, edge adjustments, Auto Trim, Undo, Redo, no-ops, failures and image replacement, and history stays within its limits. Memory returns to the same level over long sessions and when images are replaced. Nothing has failed. What remains is manual: 19 of the 67 numbered checks, in whole or in part, mostly a screen-reader session, the owner's judgement of the large-image pauses, and Firefox focus behaviour that headless Firefox cannot show. Three of these must be completed or explicitly dispositioned before the merge (Remaining Owner QA below). Recommendation: **READY FOR OWNER REVIEW**. This is not a merge approval; the owner and ChatGPT decide.

##### Owner Priority Manual QA (owner-reported)

The project owner, with ChatGPT, ran a focused nine-test manual session in real desktop browsers and reported it at the start of Step 12 (recorded 2026-11-08). **All nine passed; no issues were reported.** These tests were performed by the owner, not by Claude; Claude has not repeated or observed them. `pump.png` and `valve.png` are the images named in the owner's report.

| Test | What the owner checked | Result |
| --- | --- | --- |
| T1 | Magic Wand background deletion on `pump.png` | Passed |
| T2 | Edge cleanup visual quality at 1 px | Passed |
| T3 | Feathering at 3 px, inspecting the pump's outlines and fine details | Passed |
| T4 | Adjusting the previous Delete by changing Feather after deleting | Passed |
| T5 | Single-step Undo / Redo after edge adjustments | Passed |
| T6 | Auto Trim with 5 px padding: geometry, content preservation and Fit | Passed |
| T7 | Undo / Redo across both background deletion and Auto Trim | Passed |
| T8 | Image replacement safety with `pump.png` and `valve.png`: Cancel, the confirmation, and the padding reset | Passed |
| T9 | Real desktop Firefox: keyboard operation, editing, Auto Trim, Undo / Redo, and the responsive layout around 640 px | Passed |

A numbered check below is marked passed by this session only where an owner test covers its full requirement as described; where it covers part of a check, the rest is shown separately.

##### Reconciliation of every outstanding manual check

Status codes:

- **A**: passed by automated verification (evidence named). Headless browsers drive real input through Chrome's DevTools protocol and Firefox's WebDriver BiDi; this is not counted as a screen reader, a visual judgement, or physical interaction on a real display.
- **O**: passed by the owner's nine-test session (test named).
- **O + A**: the owner's session and automated checks together cover the whole check (each part named).
- **M**: manual verification still required (the part not covered is named).
- **L**: known limitation or accepted risk; needs the owner's disposition where marked.
- **F**: failed or blocked. None.

Evidence abbreviations: `edit-workflow`, `edge-cleanup`, `edge-adjust`, `auto-trim`, `smoke`, `edit-ownership`, `gpu-crash` are the scripts in `scripts/browser/` (Step 12 runs below; production build in Chrome 157 and Firefox 159, and the development server under React Strict Mode); "unit" is `npm test`; "workflow test" is the new `src/editor/phase3Workflow.test.ts`; "Step 12 scratch QA" is the supplementary browser script described under Automated Regression.

Step 6 deferred checks (the nine that must be completed or dispositioned before Phase 3 sign-off and merge):

| Check | Status | Evidence / what remains |
| --- | --- | --- |
| 12 Steps 1, 3, 4 with JPEG, WebP, SVG, soft-edged PNG, 1-px lines | A | `edit-workflow` (both browsers, production and Strict Mode): Delete exact byte for byte, Undo exact with the selection, committed tolerances re-apply after Undo exactly, for a PNG, WebP, JPEG, SVG, half-transparent SVG, every-alpha PNG and WebP, a 1-pixel-line PNG and a 4K screenshot |
| 14 Delete on an already-transparent selection | A | `edit-workflow` no-op, Step 12 scratch QA (1 × 1 transparent image), unit: nothing changes, selection kept, "Nothing was deleted…" placed in the status region. Hearing it spoken belongs to check 21 |
| 15 4K and near-50 MP responsiveness | M, L | Re-measured in Step 12 (Performance below). The feel is the owner's judgement; the pauses are an accepted-for-now limitation awaiting the Step 6 decision 1 revisit. **Disposition needed before merge** |
| 16 No question without edits or after undoing every edit | A | `edit-workflow`: first and unedited images (picker), after undoing every edit (picker); paste and drop with synthetic events; the decision is the same function for every source (`hasUnexportedEdits`). Real drag-and-drop and Ctrl + V already passed manually with the confirmation in Step 6 check 18 |
| 19 While the dialog is open nothing else happens; focus returns | A (Chrome), M (Firefox focus return) | `edit-workflow` (Delete, Ctrl + Z, a pasted image; Escape and focus return in Chrome); Step 12 scratch QA (Ctrl + O opens no picker and is prevented, a dropped file, no second question, both browsers). Firefox focus return after the dialog cannot be checked headless |
| 20 Continue with an invalid file keeps the edits | A | `edit-workflow` (truncated PNG); Step 12 scratch QA (truncated PNG, a text file named `.png`, an SVG with a script, an empty file, in both browsers): an error, the edited pixels, revision, Undo history and depth unchanged, Undo still works |
| 21 Screen reader (Orca) | M | Not performed. Automated checks only establish the names, roles, live regions and texts (Accessibility below) |
| 22 About 640 px wide | O + A | T9 (layout around 640 px, Firefox); `edge-cleanup` and `auto-trim` (rows wrap as units at 640 px); Step 12 scratch QA (the dialog fits a 640 px window, no sideways scrolling, both browsers) |
| 23 Firefox: Step 6 checks 1, 3, 9, 10, 17 | O + A, M (17 in Firefox) | T9 covers 1 and 3 in real Firefox; `edit-workflow` covers 9 (held Delete, held Ctrl + Z) and 10 (Delete and Ctrl + Z in the tolerance field) in Firefox; 17 in Firefox (Escape and focus return) remains manual |

Step 8 checks:

| Check | Status | Evidence / what remains |
| --- | --- | --- |
| 8.1 Defaults | A | `edge-cleanup`: both controls at 0 px, labels, units, range, Tab position |
| 8.2 0 / 0 is Step 6 | A (+ T1) | `edge-cleanup`: at 0 / 0 the document is byte for byte the Step 6 Delete on `edge-hmi.png` and nine other images; T1 on `pump.png` |
| 8.3 Cleanup on HMI art | O + A | T2 (`pump.png` at 1 px, visual); `edge-cleanup`: `edge-hmi.png` at 1 px byte for byte the algorithm's output in Node, in both browsers |
| 8.4 Undo / Redo exact | O + A | T5, T7; `edge-cleanup`, `edge-adjust`: every byte restored, Redo exact, one step per Delete |
| 8.5 Re-apply after Undo | A | `edit-workflow` (committed tolerances re-apply exactly after Undo); unit (Undo restores the click bound to the new revision; workflow test) |
| 8.6 Thin lines, Edge cleanup 5 | A | unit (`edgeCleanup.test.ts`: all lines and their faint anti-aliasing kept); `edge-cleanup`: `edge-lines.png` byte-exact in both browsers. A visual look is optional |
| 8.7 Feather spares thin features | A | unit (`feather.test.ts`, `adjustDelete.test.ts` thin lines: lines unchanged at every amount); `edge-cleanup`, `edge-adjust` (`edge-lines.png` byte-exact) |
| 8.8 Feather on thick shapes | O | T3 (feather 3 px, outlines and fine details inspected on `pump.png`, no issues). The fading of outlines on thick shapes is the known effect of Step 8 decision 1 |
| 8.9 Combined on a soft photo | M (low) | Bytes verified (`edge-cleanup`, `edge-photo.jpg` at 2 / 2 and 5 / 5); the owner has not looked at cleanup with feathering on a photograph |
| 8.10 Logo on colour | A | Cleanup is byte-identical to the Step 7 prototype the owner reviewed visually on the same kind of scene (13,140 comparisons, Step 8); `edge-cleanup` `edge-logo.png` byte-exact |
| 8.11 Corners and text | A | As 8.10 (`edge-corners.png`); unit (corners restored, small text kept) |
| 8.12 Partially transparent PNG | A, L | As 8.10 (`edge-alpha.png`); limitation: flattened colour cannot be separated, and the browsers' import alters some partial-alpha colours (Step 8) |
| 8.13 Image border | A | unit (border never background); `edge-cleanup` (`edge-border.png` byte-exact) |
| 8.14 JPEG artwork | A, L | `edge-cleanup` (`edge-hmi.jpg` byte-exact); limitation recorded (grey next to a dark outline at larger amounts) |
| 8.15 SVG | A, L | `edge-cleanup` (`edge-svg.svg` byte-exact); limitation recorded (as 8.14) |
| 8.16 Keyboard | A, M (Firefox: leaving an emptied field) | `edge-cleanup`: Tab order, arrows, Home / End, typing, clamping, Escape, Delete inside a field, in both browsers; leaving an emptied field in Chrome. T9 (keyboard in Firefox, general) |
| 8.17 Nothing while adjusting | A | `edge-cleanup` (with a selection nothing is computed), `edge-adjust` (drags and held keys compute nothing until finished) |
| 8.18 Kept for the session | A | `edge-cleanup` (kept across a Delete, its Undo and opening another image); unit (kept across Redo); nothing is persisted, so a reload resets |
| 8.19 No-op with amounts | A | unit (no-op whatever the amounts); workflow test (no-op Deletes with random amounts change nothing, keep Redo); spoken part: Orca |
| 8.20 Screen reader | M | Not performed |
| 8.21 Narrow window | O + A | T9; `edge-cleanup` (640 px: each amount control wraps as a unit) |
| 8.22 Large images | M, L | Re-measured in Step 12; feel and acceptance as check 15 |
| 8.23 Real assets | M (low; partly T2, T3) | `pump.png` passed at 1 px cleanup and 3 px feather; other VTScada screenshots and equipment photos not reported. Recommended, not blocking |

Step 9 checks:

| Check | Status | Evidence / what remains |
| --- | --- | --- |
| 9.1 Slider drag | O + A | T4 (adjusting Feather after a Delete on a real desktop); `edge-adjust`: a pointer drag with six moves computes nothing until release, then adjusts once; status bar note and "updating the last Delete" tooltip shown |
| 9.2 Keyboard | A, M (low: the visible focus ring) | `edge-adjust`: each arrow press adjusts once at release; holding adjusts once (both browsers); focus stays on the slider (Chrome). T9's keyboard operation in Firefox passed, but the focus ring was not reported separately |
| 9.3 Typing | A | `edge-adjust`: nothing until Enter; Escape restores |
| 9.4 No build-up | A | `edge-adjust` and unit: every adjustment equals one fresh Delete with those amounts; 0 / 0 is the exact Delete; repeated amounts give identical bytes. Step 12 workflow test: 10 consecutive adjustments on three scenes and 76 random ones |
| 9.5 One Undo | O + A | T5; `edge-adjust`: one Ctrl + Z restores every byte and the selection, Ctrl + Y the latest result, which can be adjusted again |
| 9.6 Next Delete | A | `edge-adjust`, unit: with a selection the amounts set the next Delete; the first Delete unchanged; Undo one at a time |
| 9.7 Magic Wand options | A | unit (`adjustDelete.test.ts`: options neither change the image nor end adjusting) |
| 9.8 After Undo | A | unit; workflow test (Undo always ends adjusting; the restored selection is for the next Delete) |
| 9.9 Confirmation | A (Chrome), M (Firefox, low) | `edge-adjust`: a typed amount while the dialog opens is set, not applied; after Cancel, Enter applies. The Firefox path depends on the blur that headless Firefox never fires |
| 9.10 Thin lines | A | `edge-adjust` (`edge-lines.png`, seven adjustments, byte-exact), unit |
| 9.11 Screen reader | M | Not performed |
| 9.12 Large images | M, L | Re-measured in Step 12; as check 15 |
| 9.13 Firefox | O + A, M (Tab out of an edited field in Firefox) | T4, T9 in real Firefox; `edge-adjust` 9.1–9.3 in Firefox except blur. Leaving a field commits through the same code as the tolerance field, which passed manually in Firefox in Phase 2 |
| 9.14 Real assets | M (low; partly T4, T5) | As 8.23 |
| 9.15 Redo with other amounts shown | A (Chrome), M (Firefox, low) | `edge-adjust`: Tab / Shift + Tab, focus moves, drag back, held keys, retyping, Escape never update the Delete; an actual change does. Focus events do not fire in headless Firefox |
| 9.16 Status bar note | A | `edge-adjust`: shown only while adjustable, gone with a selection, back after Redo, hidden below 800 px with no height change |

Step 11 checks:

| Check | Status | Evidence / what remains |
| --- | --- | --- |
| 11.1 The tool | O + A | T6; `auto-trim`: row contents, presets, field, Trim, status bar, clicks select nothing |
| 11.2 Padding computes nothing | A | `auto-trim`: presets, 37, 75 → 50, "abc", Escape, arrows, Page keys; image, size and Undo unchanged |
| 11.3 Pump after Delete | O + A | T6 (5 px, geometry, content, Fit); `auto-trim` (`trim-pump.png` trimmed to exactly the full-scan rectangle, every byte) |
| 11.4 Own pump and valve at 0, 20, 50 | A, M (low) | `auto-trim` and unit: 0 tight to the faintest pixel, 50 clipped per edge, never enlarged, byte-exact; T6 covered 5 px on `pump.png` only. The owner's pump and valve images at 0 / 20 / 50: recommended, not blocking |
| 11.5 Thin lines and faint edges | A | unit (lines, hairline, single pixels after Deletes with four edge settings, trimmed at 0); `auto-trim` (faintest pixels of a soft shadow kept) |
| 11.6 Fit | O + A | T6; `auto-trim` (fitted after the trim, Undo and Redo); unit (fitted whatever the zoom and pan were before) |
| 11.7 Undo and Redo | O + A | T7; `auto-trim` (keys and header buttons, "Undo Auto Trim" / "Redo Auto Trim", exact) |
| 11.8 Selection after Undo | A | unit (the click re-applies exactly after the second Undo); workflow test |
| 11.9 After a Delete (Step 9) | A | `auto-trim`, unit: the note goes, the amounts then set the next Delete |
| 11.10 Nothing to trim | A | `auto-trim` (four cases, messages, dismissal, both browsers); Step 12 scratch QA (1 × 1 images) |
| 11.11 Already trimmed | A | unit (same or larger padding: nothing; smaller: trims further, one more step) |
| 11.12 Opening images | O + A | T8 (padding reset); `auto-trim` |
| 11.13 Replace confirmation | O + A | T8 (Cancel, the confirmation); `auto-trim` (Trim does nothing behind the dialog) |
| 11.14 Keyboard only | O + A | T9 (keyboard operation including Auto Trim in real Firefox, where headless button activation is impossible); `auto-trim` in Chrome |
| 11.15 Screen reader | M | Not performed |
| 11.16 Large images | M, L | Re-measured in Step 12; as check 15 |
| 11.17 History eviction | A | `auto-trim` (25 Deletes then a trim: message, oldest step dropped, both browsers); unit and workflow test (counts and bytes; the dropped count in the notice checked after every recorded edit) |
| 11.18 Firefox | O + A | T9 (11.1, 11.3, 11.7, 11.14 in real Firefox); `auto-trim` (11.10 in Firefox) |
| 11.19 Narrow window | O + A | T9; `auto-trim` (640 px: one line, Trim visible, message fits, no sideways scrolling) |

Totals (67 numbered checks: 9 + 23 + 16 + 19; T1–T9 recorded separately):

- Failed or blocked: none.
- Fully passed (A, O or O + A, some with a recorded limitation): 48.
- Still manual, in whole or in part: 19. They group into five short sessions:
  - Screen reader (6.21, 8.20, 9.11, 11.15): one Orca session.
  - Large-image pauses (6.15, 8.22, 9.12, 11.16): one judgement plus the owner's disposition.
  - Firefox focus and blur (6.19 focus return, 6.23 check 17, 8.16 emptied field, 9.9, 9.13 Tab out, 9.15).
  - Visual review of real assets (8.9, 8.23, 9.14, 11.4).
  - The visible focus ring (9.2).

11.14 is counted as passed by T9. Operating Auto Trim by keyboard in real Firefox, the part headless Firefox cannot do, is taken to include seeing where focus is. If the owner did not look at the focus rings during T9, 11.14 joins 9.2 for that part only.

##### Remaining owner QA, ranked by risk

Required before the Phase 3 merge (each completed, or explicitly dispositioned by the owner, as the Step 6 deferral requires):

1. **Large-image pauses** (6.15, 8.22, 9.12, 11.16; Step 6 decision 1, revisited below). On the desktop, Chrome and Firefox: open `edge-hmi-50mp.png` (`node scripts/browser/fixtures.mjs` writes it to `scripts/browser/fixtures/`), Magic Wand tolerance 10 at the top-left corner, Delete; type 1 in Edge cleanup and press Enter, then 5 in Feather and Enter; Ctrl + Z, Ctrl + Y. Then `trim-photo-50mp.png`, tolerance 20 at the top-left, Delete, Auto Trim, Trim, Ctrl + Z, Ctrl + Y. Expect the pauses in the Performance table below (up to about 2.2–2.7 s for 5 / 5 on the edge-dense image, about 0.6–0.8 s for the photographic trim), no error, and the page responding again afterwards. Decide whether they are acceptable for Phase 3.
2. **Screen reader, Orca on Linux** (6.21, 8.20, 9.11, 11.15), about 15 minutes, or an explicit decision to defer it to a dedicated accessibility pass. Check:
   - After Delete: "Selection deleted: … pixels are now transparent." is read once. Ctrl + Z / Ctrl + Y read "Undone: Delete Selection." / "Redone: Delete Selection." once each.
   - Tabbing to the header buttons reads "Undo Delete Selection" / "Redo Delete Selection".
   - Opening another image after a Delete reads the dialog's title "Discard unexported edits?" and its text.
   - The Edge cleanup slider reads "Edge cleanup" and "0 px"; its field reads "Edge cleanup in pixels, 0 to 5".
   - Right after a Delete, changing an amount with the keyboard reads "Delete Selection updated with Edge cleanup … px and Feather … px: …" once.
   - In the Auto Trim row, the presets read as toggle buttons "5 px" with their pressed state, and the field reads "Padding in pixels, 0 to 50".
   - Trim reads "Auto Trim applied: … trimmed to … px." once. Pressing Trim again reads the nothing-to-trim message once.
3. **Firefox dialog** (6.19 focus return, 6.23 check 17), 2 minutes, in real Firefox: Delete, then open another image with the button; press Escape. The dialog closes, nothing changes, and focus is back on the Open button. Repeat with Cancel.

Recommended, not blocking (low risk; the logic is shared with paths already verified):

4. **Firefox, leaving fields** (8.16, 9.9, 9.13, 9.15): in real Firefox, right after a Delete, type 2 in Edge cleanup and press Tab. The Delete updates once, and the status bar note stays. Clear the field, then Tab away: the value comes back and nothing is computed. Then the 9.15 sequence by keyboard.
5. **Visual review on real assets** (8.9, 8.23, 9.14, 11.4, and the 9.2 focus ring): `edge-photo.jpg` at Edge cleanup 2 and Feather 2; your VTScada screenshots at cleanup 1; your valve trimmed at 0, 20 and 50 px. Note anything that looks worse than expected.

##### Automated regression (Step 12)

Unit and build (this machine, Node 24.18):

| Command | Result |
| --- | --- |
| `npm run lint` | Clean |
| `npm run typecheck` | Clean |
| `npm test` | 67 files, 1,195 tests, all passing (baseline 66 files, 1,191; 4 added) |
| `npm run build` | Passes; bundle unchanged (351.87 kB, 111.51 kB gzip) |

Browser scripts (`scripts/browser/`, headless Chrome 157 and Firefox 159, device pixel ratio 1 unless stated). Passed means every check passed; nothing failed, and no check was skipped other than those the scripts skip by design: headless-Firefox focus, blur and button keys, which are reported in their output.

| Script | Production build | Development server (React Strict Mode) |
| --- | --- | --- |
| `smoke.mjs` (formats, rendering, overlay at ratios 1 and 2) | 340 passed | — |
| `edit-workflow.mjs` | 507 passed with `--no-perf`; 515 with timings and the 50 MP stress run | 507 passed |
| `edit-ownership.mjs --mode both` | 52 passed (production and development) | (included) |
| `edge-cleanup.mjs` | 885 passed with `--no-perf`; 901 with timings | 885 passed |
| `edge-adjust.mjs` | 175 passed with `--no-perf`; 199 with timings | 175 passed |
| `auto-trim.mjs` | 146 passed with `--no-perf`; 174 with timings; 77 with `--kill-test-gpu-process` (Chrome) | 146 passed |
| `gpu-crash.mjs --kill-test-gpu-process` | 23 passed (software rendering), 23 (`--gpu`), 46 (`--dpr 1,2`) | — |

The Strict Mode runs used the owner's own Vite development server, already running from this working tree on port 5173 (it was left running). No React warnings or console errors appeared in any run.

Supplementary Step 12 browser QA (scratch scripts in the session's scratchpad, not added to the repository, which reuse `scripts/browser/lib/`). Production build, both browsers, all passing:

- 1 × 1 images (opaque, alpha 1, alpha 0): Trim, Select All, Delete, Trim again, Undo and Redo are exact, with the right messages (18 checks per browser).
- Phase 2 selection operations in the real application: Magic Wand New, Add and Subtract, Contiguous and Global; a committed tolerance re-applying an Add over its recorded base; Grow, Shrink, Invert, Select All and Clear. Each selection is identical to the same algorithms run in Node, and none adds history (16 checks per browser).
- Invalid input after an edit (truncated PNG, text renamed `.png`, SVG with a script, empty file): an error each time; the edited pixels, revision, Undo history and depth are kept, and Undo still works.
- Display-image failures in the middle of the workflow, for an adjustment, a trim and a Redo: an error, nothing changed, and the retry succeeds.
- While the replace dialog is open: Ctrl + O, Delete, Ctrl + Z, a paste and a file drop do nothing and ask no second question. The dialog fits a 640 px window.
- Long session: 20 cycles of replace, Delete, adjust, Trim, Undo × 2, Redo × 2 at 4K, alternating a flat and a photographic background, every state exact (30 cycles in Chrome in a second run).
- 50 MP photographic Delete and trim, replaced twice.
- Peak memory at 50 MP (Chrome).

##### Pixel integrity and editing history

`src/editor/phase3Workflow.test.ts` (4 tests, about 1 s) drives the application's own commands together:

- `editActionCommand` for Delete Selection, Auto Trim, Undo and Redo; `adjustDeleteCommand` for committed amounts; real Magic Wand clicks and selection actions.
- Mixed at random over 60 seeds × 90 steps with no-ops, replayed stale actions, display-image failures, imports in progress, failed and successful imports, under three history regimes: 1–5 entries; a 0-byte budget, which keeps only the newest entry; and the defaults, 25 entries and 256 MiB.
- Its model keeps a copy of every content state, hidden colour included. Expected results come from the model's own copies, never from history:
  - A trim, by a full alpha scan.
  - A Delete at 0 / 0, by setting alpha 0 on the selected pixels.
  - An adjusted Delete, by a fresh Delete of the model's copy of the pixels before it.
- After every step it checks: the document byte for byte; the selection; the Magic Wand click, bound to the current revision; both stacks and their kinds; the retained-bytes recount; the 25-entry and byte limits; the dropped-steps count in the notice; edit depth and unexported state; adjustability; availability; padding and amounts; and a fresh revision with the action's own display image.
- One run covered 284 Deletes, 76 adjustments, 76 trims, 303 Undos, 103 Redos, 565 no-ops, 726 stale replays, 49 failures, 167 imports and 25 evicted steps.
- A fixed sequence on the thin-line, icon and JPEG-icon scenes: Delete, ten adjustments (some repeated, one back to 0 / 0), Trim at 0, Undo, Undo, Redo, Redo, Undo, Undo.
- 13 deliberately introduced defects were run against it. It caught 11:
  - adjustments building on the previous result;
  - Undo keeping the edit depth;
  - the dropped-steps count;
  - Redo never adjustable;
  - imports keeping the history or the depth;
  - padding off by one;
  - the selection before an edit not recorded;
  - the entry limit off by one;
  - adjusting while something can be redone;
  - a trim keeping the Magic Wand click.

  The other two are caught by the existing tests: Undo keeping the Delete adjustable (equivalent in this test, because Undo of a Delete always restores a selection, which blocks adjusting on its own), and an adjustment never evicting by bytes (not reachable with this test's budgets). The defects were introduced only in a scratch copy of `src/`, never in the repository, because the owner's development server was serving the working tree.

How each pixel-integrity requirement is verified:

| Requirement | Verified by |
| --- | --- |
| No-op operations leave the image byte-identical | Workflow test: no-op Deletes and trims return the same document, image and history objects; selection and option changes never touch pixels. Browser: the no-op checks in `edit-workflow` and `auto-trim` |
| Deleted pixels keep their hidden RGB | Unit (Step 2 onwards); `edit-workflow` compares every RGB byte under alpha 0; the workflow test's guarantees check |
| Edge cleanup and feathering are deterministic | `edge-cleanup` / `edge-adjust`: Chrome, Firefox and Node give identical bytes; the same amounts always give the same bytes |
| Repeated adjustments never degrade | Workflow test and `adjustDelete.test.ts`: each adjustment equals one fresh Delete; back at 0 / 0, exactly the first Delete, with the same patch size |
| Undo restores exact bytes; Redo recreates them | Every timed and checked Undo / Redo in the browser scripts; the workflow test at every step |
| Auto Trim keeps every retained byte; its Undo restores pixels, size, selection and click | `auto-trim` (byte for byte against an in-page full scan); unit; workflow test |
| No-ops keep Redo and create no entry | Workflow test (565 no-ops); `autoTrimCommand.test.ts` |
| Mixed sequences (Delete → adjust → Trim → Undo → Redo) | Workflow test (fixed sequence and random mixes); scratch long session in both browsers |
| Replacement never reuses another image's history | Workflow test (167 imports, then every earlier action replayed and rejected); `edit-workflow`; scratch 50 MP replacement |
| 25-step and 256 MiB limits | Unit (`editHistory.test.ts`, 50 MP-sized entries); `auto-trim` (25 Deletes then a trim); workflow test (three regimes) |

The only byte difference found anywhere is the browsers' import of partly transparent pixels, which store colour premultiplied (Phase 1 behaviour, recorded in Step 8). For example, a 1 × 1 pixel `(10, 200, 30, 1)` opens as `(0, 255, 0, 1)` in Chrome and `(255, 255, 255, 1)` in Firefox, and colour under alpha 0 in a file opens as 0, 0, 0. Alpha is always exact. Phase 3 edits work on the pixels as imported.

##### Performance and memory (measured in Step 12)

Production build, headless, this machine (i7-14700HX, 32 GB), one run each unless a range is given. Times are the whole synchronous handler, from the key press or click to the commit and its layout effects, display image included. They agree with the Step 6–11 measurements: nothing has regressed.

| Operation | 3840 × 2160, Chrome / Firefox | 8660 × 5773 (50 MP), Chrome / Firefox |
| --- | --- | --- |
| Delete at 0 / 0, flat or screenshot background | 92–130 / 85–98 ms | 493–800 / 453–484 ms |
| Delete at 0 / 0, edge-dense HMI | 91 / 84 ms | 517 / 500 ms |
| Delete, Edge cleanup 1 / 5 (HMI) | 217 / 298 ms; 202 / 359 ms | 1,051 / 1,481 ms; 1,229 / 1,681 ms |
| Delete, Feather 5 (HMI) | 221 / 241 ms | 1,291 / 1,425 ms |
| Delete at 5 / 5 (HMI) | 437 / 462 ms | 2,247 / 2,590 ms |
| Adjusting the last Delete (HMI, 1 / 0 to 5 / 5) | 187–378 / 200–462 ms | 1,060–2,227 / 1,177–2,722 ms |
| Undo, Redo of a Delete | 34–66 / 48–85 ms | 196–324 / 247–347 ms |
| Auto Trim, flat background | 23–66 / 29 ms | 235 / 199 ms |
| Auto Trim, photographic background | 99–137 / 123 ms | 541–796 / 604–697 ms |
| Undo of a trim | 26–30 / 48 ms | 146–157 / 218–237 ms |
| Redo of a trim | 2–4 / 4–7 ms | 8–109 / 11–155 ms |
| Nothing to trim, fully transparent image | — | 265 / 52 ms |

Memory:

- Live display images: exactly one after every section of every script, in both browsers.
- Retained memory (Chrome, JavaScript heap and ArrayBuffers after garbage collection) was the same after every cycle:
  - 4K Delete, Undo and Redo, 5 cycles: 37.1 MB.
  - 50 MP, 3 cycles: 195.4 MB.
  - 50 MP edge-dense, through ten Deletes at different amounts: 245–255 MB (the history entry grows from 2.1 to 10.6 MB with the amounts).
  - After a 50 MP photographic trim: 382 MB. This is the 142.8 MB entry, the trimmed image, and the full image React's previous render keeps until its next render. Replacing the image brings it to 1.8 MB, twice in a row.
- Peak resident memory of Chrome's renderer during 50 MP operations: 378–509 MB above its level just before (2–2.7 image-sized buffers), all returned afterwards.
  - Delete at 0 / 0: +383 MB.
  - Adjusting to cleanup 5: +422 MB; to 5 / 5: +509 MB.
  - Undo / Redo: +430 / +378 MB.
  - Photographic trim: +385 MB; its Undo +378 MB, its Redo +92 MB.
  - The renderer peaked at 1.0–1.35 GB in total.
- Long session (4K, 20 cycles in each browser, 30 more in Chrome):
  - Every state was exact, with one live display image.
  - ArrayBuffers were 32.8 MB (flat) and 63.9 MB (photographic, with its 29.2 MB entry) after every cycle.
  - The JavaScript heap went from 2.4 to 3.3 MB over 30 cycles, rising less each time (+0.6, +0.2, +0.1 MB per ten cycles). This includes the test harness's own record of every bitmap created.
  - No operation slowed progressively. Chrome's flat 4K trim stepped once, from 23–40 ms to 60–66 ms at the fifth or sixth cycle, then stayed flat to cycle 30. The same happened with only one kind of image, which suggests the JavaScript engine re-optimising, not anything the application accumulates. Firefox was flat throughout.
- Edge-dense and flat 50 MP history entries stay at a few megabytes. Only the photographic trim is large (142.8 MB), as Step 10 measured.

Feedback during long operations: there is none. The work is synchronous (P3-D11), so the page does not paint, and does not respond, until it ends. The cursor does not change and no message appears.

- At 4K every operation finishes in under half a second (at most 0.46 s, Delete or an adjustment at 5 / 5). Without edge amounts, Delete, Undo, Redo and trims take about 0.15 s or less; with them, 0.16–0.46 s.
- Near 50 MP, Delete, Undo, Redo and trims without edge amounts take 0.2–0.8 s. Edge cleanup and feathering on edge-dense images take about 0.9–2.7 s.
- No error or hang was observed in any run. By design (Step 6), input that arrives during a pause is handled afterwards and computed from the committed state, so it never applies to a stale image. Input during a pause was not tested separately in Step 12.

##### Edge cases and failures

All verified in the browsers (production) and in unit tests unless stated; none failed.

- Fully transparent images (1 × 1, small, 50 MP): Delete changes nothing; Trim says there is nothing visible.
- Already trimmed and fully opaque images: Trim says why there is nothing to trim. Single-pixel images: all of the above, and Delete / Undo / Redo exact.
- Thin lines and wiring, anti-aliased text and logos, semi-transparent pixels, HMI graphics: the edge fixtures, byte-exact against Node at every amount; lines and small text kept (unit).
- Large photographic images: the 4K and 50 MP photographic fixtures.
- Malformed or unsupported input, and failed decoding, while an edited image is open: an error, and everything kept. The Phase 1 import checks cover the rest.
- A failed edit, Undo, Redo, adjustment or trim (display image creation forced to fail): an error message, nothing changed, the display image released, and a retry works.
- Replacing an image after editing: the confirmation every time; Cancel keeps everything; Continue clears the history and releases the old image and its history (memory measured).
- Editing during dialogs and imports: nothing happens behind the dialog; edits are unavailable while an import runs (held imports in `edit-workflow`, `edge-adjust` and `auto-trim`).
- GPU process loss: the canvas and overlay are restored exactly with no user action, also after a trim (Chrome: software rendering at ratios 1 and 2, GPU rendering at ratio 1). Headless Firefox has no GPU process to stop; its restoration wiring is verified with a synthetic event (Step 4).
- Undo / Redo near the history limits: 25 Deletes and a trim (oldest step dropped, message shown); random sequences at 1–5 entries and at a 0-byte budget.

##### Accessibility and real-browser limitations

What automated checks establish:

- Every control has an accessible name, and the toggle buttons and tools expose `aria-pressed`. Unavailable actions use `aria-disabled`, so focus stays on them. The fields' names give their ranges, and the sliders' value text has its unit.
- Edit errors are alerts. Outcomes are announced once each, in polite status regions: the hidden one, or the workspace's for shown notices.
- The dialog is modal (`showModal`), with its title and text as its name and description. Focus starts on Cancel and returns afterwards (Chrome), and Escape cancels (Chrome).
- Keyboard: Tab order, arrows, Page, Home and End, Enter, Escape, held keys, and Space and Enter on buttons (Chrome; in Firefox through T9).
- Numeric fields round, clamp and restore, and their range is validated (unit and browsers).
- Reduced motion stops the marching ants and shortens transitions to effectively none (Phase 2, Step 11).
- At 640 px the options rows wrap as units, the header stays usable, the dialog fits, and nothing scrolls sideways. Below 640 px the app scrolls sideways, its minimum width since Phase 1.

What they cannot establish, and how it is covered:

- What a screen reader actually says, and in what order: Remaining Owner QA 2.
- Whether focus rings are visible enough on a real display: T9 in part, and item 5.
- Firefox's focus, blur and dialog Escape, which headless Firefox cannot show: items 3 and 4.
- Real drag and drop from a file manager, and the real clipboard: passed manually in Step 6 check 18 and Phase 1–2. The scripts use synthetic events.
- Colour contrast was not measured in Step 12 (no colours changed).

##### Defects found and fixed in Step 12

None. No confirmed defect was found in Phase 3 functionality, so no application code was changed, and no accepted Step 8, 9, 10 or 11 behaviour was altered. Things investigated and found not to be defects:

- Chrome's one-time trim slowdown in long sessions: the JavaScript engine, not the application (above).
- The heap's slow early growth: it saturates, and it includes the harness's own records.
- The import colour quantisation of faint pixels: Phase 1 browser behaviour, recorded.
- Chrome's 265 ms scan of a fully transparent 50 MP image, against Firefox's 52 ms: as in Step 11.

##### Known limitations and accepted risks of Phase 3

Moderate:

- Synchronous pauses near 50 MP: 0.2–0.8 s for Delete, Undo, Redo and trims, and 1–2.7 s for Delete or adjustments with edge amounts on edge-dense images. There is no progress indication. The decision is below.
- Screen-reader behaviour is unverified in Phase 3 (Remaining Owner QA 2).
- A 50 MP trim of a deleted photographic background retains about 143 MB of history, and older steps are dropped when the history already holds more than about 100 MB. Peak renderer memory during 50 MP operations is up to about 0.5 GB above the open image.
- Fractional display scaling (`devicePixelContentBoxSize`, open since Phase 2 Step 8), and the Chrome DPR 1.5 one-row checkerboard level: unchanged.

Minor:

- The faint edge left by exact Delete at 0 px, by design (P3-D4).
- Cleanup trusts the selection, and flattened colour cannot be recovered.
- The grey-next-to-outline case at higher cleanup amounts; feathering fades the outlines of thick shapes.
- An amount changed right after a Delete updates that Delete.
- After Redo, the amounts shown can differ from those the result was made with.
- Threshold 0 lets a faint stray pixel block trimming.
- Clipped padding can be uneven.
- Trimming takes two clicks after a Delete, and there is no separate Trim Tight control.
- A nothing-to-trim message stays until it is dismissed.
- Delete and adjustments drop Undo steps silently.
- The browsers' import changes the colour of faint partly transparent pixels.
- No "edited" marker, and no warning when closing the tab.
- Editor actions must never be dispatched in a React transition: a convention, not enforced.

Test coverage only:

- Headless Firefox: no window focus, blur, dialog Escape or button activation by keys.
- Synthetic paste and drop events.
- WebKitGTK is deferred to desktop testing (Phase 7).

##### Decisions for the owner

1. Step 6 decision 1, revisited as planned: should large-image edits stay synchronous?
   - Recommendation: keep them synchronous for Phase 3, with no Web Worker and no architecture change now, and record the pauses as a known limitation.
   - Measured evidence: 4K and smaller images, the main use case (screenshots, HMI graphics), never pause more than 0.46 s. Only images near the 50 MP limit with edge amounts exceed 1 s, and nothing fails or is lost.
   - A "Processing…" indication would need the work to start after a frame is painted, which changes the synchronous `flushSync` dispatch the display-image ownership relies on. That would be its own reviewed change. A Worker would add copying, asynchronous commits and stale-result handling to every edit.
   - If wanted, propose the indication in Phase 6 (workflow polish), after export exists.
2. Earlier decisions still recorded as provisional or unanswered. The owner's T3, T6 and T8 results agree with them as implemented, but this document does not mark them decided:
   - Step 8: 1, ship the thickness-limited feathering; 2, the amounts kept for the session; 3, synchronous (as 1 above); 4, the wording.
   - Step 11: 1–7, including where Trim lives and Trim Tight, Fit on Undo and Redo, visible no-op and eviction messages, and the padding control.
   - P3-D6: threshold 0, and padding clipped at the edges.
3. Orca: run it before the merge (recommended), or defer it explicitly to a dedicated accessibility pass.
4. Whether to commit the Step 12 scratch checks as maintained scripts. They are not needed for the merge: their findings are recorded here, and the maintained scripts cover the same paths, except Grow, Shrink and Invert in the browser and peak memory.

##### Release-readiness checklist

- [x] Lint, type checking, unit tests (1,195) and the production build pass.
- [x] Every browser script passes in Chrome and Firefox, in production and Strict Mode, including GPU process loss.
- [x] Pixel integrity: exact bytes through every mixed sequence tested, with no-ops byte-identical and no degradation from repeated adjustments.
- [x] History: exact Undo / Redo, limits respected, no reuse across images, no-ops keep Redo.
- [x] Memory: one live display image, no growth over long sessions, history released on replacement.
- [x] Failures: errors shown, state preserved, resources released, retries work.
- [x] Owner priority manual QA T1–T9 recorded (owner-reported, all passed).
- [x] All 67 outstanding manual checks reconciled; none failed.
- [ ] Large-image pauses judged and Step 6 decision 1 dispositioned (Remaining Owner QA 1). **Required before merge.**
- [ ] Orca session, or an explicit deferral (Remaining Owner QA 2). **Required before merge.**
- [ ] Firefox dialog Escape and focus return (Remaining Owner QA 3). **Required before merge.**
- [ ] Recommended checks 4–5, and the provisional decisions confirmed (Decisions 2).
- [ ] Owner and ChatGPT final review; Phase 3 checkpoint commit and merge (owner only).

Recommendation: **READY FOR OWNER REVIEW.** No blocker was found in the implementation. The merge still needs the three required owner items above.

---

## Milestone: First Working Background Removal (2026-11-08)

Assigned by the project owner as one larger, explicitly authorised milestone: the complete workflow open → Magic Wand → tolerance → inspect → Delete → transparent result → Undo / Redo → transparent PNG export, then Auto Trim if it could be done safely. Worked on the `phase/03-background-deletion` branch. The owner committed the initial PNG export implementation as `586495a`; the audit corrections below are uncommitted on the same branch (the owner commits).

### Recovery check after the power outage

Before any change: `git fsck --full` reported no corruption (only Git's standard empty tree as dangling); the working tree matched `HEAD` (cce524d, the Phase 3 Step 12 QA commit); no empty or truncated source files; type checking (also forced, `tsc -b --force`), lint, 1,195 unit tests and the production build all passed. No evidence of lost work.

### What already existed (verified, not reimplemented)

| Requirement | Where | Status |
| --- | --- | --- |
| Magic Wand tool, contiguous non-recursive scanline fill, tolerance slider and field, New replaces the selection, overlay with marching ants, Clear and Esc, source pixels never changed | Phase 2 (`image/selection/magicWand.ts`, `MagicWandOptions`, `selectionOverlay*`) | Done, merged in Phase 2 |
| Screen-to-image mapping with zoom, pan, canvas position and device pixel ratio; Zoom & Pan | Phase 1 (`canvas/coordinates.ts`: `pixelUnderPointer`) | Done |
| Delete key and Delete Selection button, alpha 0, unselected pixels unchanged, size kept, checkerboard, selection cleared, no-op and no-selection protection | Phase 3 Steps 2 and 6 | Done (Phase 3 owner review pending) |
| Original preserved for recovery | Undo back to the opened pixels (exact), within the history limits; the opened file is never written | Done, with the limit noted below |
| Undo / Redo: Ctrl + Z, Ctrl + Y, Ctrl + Shift + Z, header buttons; bounded patches, no full snapshots (25 entries, 256 MiB) | Phase 3 Steps 3, 5 and 6 | Done |
| Auto Trim: alpha bounds, padding presets 0 / 5 / 10 / 20, default 5, Trim Tight, fully transparent image, Undo / Redo, exact bytes | Phase 3 Steps 10 and 11 | Done (owner's provisional decisions) |
| Edge cleanup and feathering | Phase 3 Steps 8 and 9 | Exist, default 0 px; not extended (out of this milestone's scope) |

### What this milestone added: PNG export

PNG export was the one missing step (Phase 6 in this plan, brought forward by the owner's assignment). Behaviour: `FEATURE_SPEC.md` §22 and §1; encoding and measurements: `IMAGE_PROCESSING_SPEC.md` (PNG Export); UI: `UI_UX_SPEC.md` (Status Bar, Export Button, User Feedback, Error Handling); modules: `ARCHITECTURE.md` (PNG Export Modules).

- The header's Export button (previously a disabled placeholder) writes the image as an exact 8-bit RGBA PNG at its current size, fully transparent pixels as 0, 0, 0, 0, named `<name>-cleaned.png`, and hands it to the browser as a download.
- A small encoder of the application's own (`image/export/pngEncoder.ts`) instead of the canvas encoder, which changed the colour of 36,857 of 37,336 partially transparent pixels of a test image in Firefox. It uses the platform's `CompressionStream`; no dependency was added.
- "Unexported edits" is now measured from the last export (it was measured from opening), shown in the status bar, and used by the existing replace confirmation (P3-D12).
- Supporting changes: `EditNotice` gains `exported`, `EditError.operation` gains `export`; the app's development log of a failed export reads "Export failed: …", and `scripts/browser/lib/edit.mjs` accepts it as expected.

### Verification

- Unit tests: 1,240 pass (45 new): `pngEncoder.test.ts` (15; every output decoded by an independent reader, every byte compared), `exportCommands.test.ts` (20; names, availability, reducer outcomes, unexported edits through edits, Undo, Redo, adjustments, Auto Trim and imports, and that a discarded history entry is not kept reachable by the export marker), `exportImage.test.ts` (6; the whole workflow with the real commands and encoder, every exported pixel compared after Delete, Undo, Redo, Auto Trim at 5 px and 0 px, Select All), AppHeader (3) and StatusBar (1) markup.
- Type checking, lint and the production build pass.
- Mutation check: 28 deliberate faults in the new code (encoder filters, alpha handling, CRC, header, slicing, error paths, unexported-edits rule, reducer guards, file names, flow) were each caught by the tests.
- Browser: `scripts/browser/png-export.mjs` passes in Chrome and Firefox, production build (103 checks with timings) and React Strict Mode dev server (95 checks, without timings): real clicks and keys, every file checked with Node's zlib and decoded by the browser, a real Chrome download compared byte for byte. Existing scripts still pass: `smoke.mjs` 340, `edit-workflow.mjs --no-perf` 507, `auto-trim.mjs --no-perf` 146.
- Performance (table in `IMAGE_PROCESSING_SPEC.md`): 0.3–0.4 s for 4K graphics, about 1.7 s for a worst-case noisy 4K image, 1.3–1.9 s near 50 MP for graphics; the page keeps drawing throughout.
- Not done: owner manual QA of export in a real (non-headless) browser, including the browser's download prompt and a Save dialog cancelled in Firefox; WebKitGTK and WebView2.

### Known limitations

- The browser does not report whether a download was kept, so handing the file over counts as exported.
- Only the latest export is remembered: returning to an image exported before the latest export counts as unexported (conservative).
- No cancel for a running export (it cannot freeze the page; a worst-case 50 MP export would take several seconds).
- The original stays recoverable through Undo only while the history holds every edit (25 entries / 256 MiB, P3-D8); after older steps are dropped, the opened file on disk is the original. No extra full-resolution copy is kept (memory), and there is no "Revert to original" command.
- No Ctrl + S shortcut (Phase 6 shortcut work).
- No colour profile chunk; pixels are sRGB as decoded (Phase 1 limitation).

### Decisions for the owner (as raised on 2026-11-08)

1. Accept the application's own PNG encoder (no dependency) over the canvas encoder.
2. Export availability: allowed while another image opens and with a selection (it ignores the selection); one export at a time.
3. Unexported edits measured from the latest export only; a handed-over download counts as exported.
4. Wording: "Export", "Exporting…", "Unexported edits", "Exported as …", the failure message; the replace dialog text is unchanged.
5. Whether to add Ctrl + S now or keep it for Phase 6.
6. Whether a "Revert to original" command or keeping the opened pixels outside the history limits is wanted (not implemented: memory cost of one more full-resolution image).
7. These changes sit uncommitted on the Phase 3 branch; the owner may prefer to commit them on a branch of their own after the Phase 3 merge.

The owner's answers are recorded below.

### Owner review and audit corrections (2026-11-09)

An independent read-only review by Codex of commit `586495a` (the initial PNG export implementation, committed by the owner on `phase/03-background-deletion`) found no critical or high-severity defects. The custom PNG encoder passed its technical review, all 1,240 unit tests and every browser suite it ran passed, and the project owner completed seven manual background-removal workflow checks, all passed (owner-reported; performed by the owner, not by Claude). The review found two code issues and outdated documentation, which the owner authorised Claude to correct, and only those.

Owner decisions (2026-11-09):

| # | Decision |
| --- | --- |
| 1 | The application's own PNG encoder is approved, following the independent code review and the successful manual QA. |
| 2 | Seven owner-performed background-removal workflow checks passed. |
| 3 | Export is permitted while a selection is active (it ignores the selection). |
| 4 | Export must be disabled while another image is loading (reverses this milestone's original choice, decision 2 above). |
| 5 | Latest-export-only tracking of unexported edits is approved. |
| 6 | The wording "Export", "Exporting…" and "Unexported edits" is approved. |
| 7 | Ctrl + S is deferred to Phase 6. |
| 8 | "Revert to original" is deferred until a memory-conscious design exists. |
| 9 | Starting the browser download counts as an export; actually saving the file cannot be confirmed (accepted limitation). |
| 10 | What Firefox does when its Save dialog is cancelled remains unverified. |
| 11 | Commit `586495a` contains the initial PNG export implementation. |

These do not complete or approve Phase 3: its required owner items (Step 12, Remaining owner QA 1–3) are unchanged and still open, and Phase 3 is not approved for merge.

Corrections made:

1. **Export unavailable while another image is opening.** `canExport` (`editor/exportCommands.ts`) now also requires that no import is pending (`isImporting`), as the edit actions already did, and the reducer refuses an `export-started` that arrives while an import is pending (a start computed just before the import began). The header's Export button is then `aria-disabled` with the tooltip and accessible description "Export — not available while another image is opening" (new `ExportStatus` kind `importing`). With a selection and no import, Export is available as before. Race analysis: no export can start for an image that is about to be replaced. An export already running when an import starts (Open Image stays available) keeps its own immutable pixel buffer, finishes, downloads the image it started with, and is recorded as the last export only if its document is still open, unchanged from `586495a`. A failed import keeps the image, and Export is available again.
2. **Suggested name never equal to the opened name.** Reproduced: `exportFileName('a' × 200 + '-cleaned.png')` returned the same name, because the 200-character stem limit cut exactly the `-cleaned`. Now, when the suggestion equals the opened name (ignoring case, as Windows and macOS file systems do), the stem is cut by one more character (whole code points; trailing spaces and dots dropped again), giving `'a' × 199 + '-cleaned.png'`. Every other name is unchanged, `-cleaned.png` is kept, and the result is never empty or invalid.
3. **Documentation**: this section; `FEATURE_SPEC.md` §22; `UI_UX_SPEC.md` (Export Button, shortcuts); `IMAGE_PROCESSING_SPEC.md` (PNG Export); `ARCHITECTURE.md` (PNG Export Modules); `scripts/browser/README.md`.

The PNG encoder (`src/image/export/`) is unchanged, so every exported file is byte for byte as before. No dependency was added or removed.

Verification of the corrections:

- Unit tests: 1,245 pass (5 new). `exportCommands.test.ts`: Export unavailable during an import and available again after it succeeds or fails, a start computed before the import refused, Export with a selection; the audit's exact collision and its variants (case, a folder, characters of two UTF-16 units, a cut ending in spaces and dots); a sweep of 12,474 names (lengths 0–230 with several fillers and endings), each giving a valid name, different from the opened one ignoring case, with a stem of at most 200 characters. `exportImage.test.ts`: nothing starts during an import, and the export afterwards is exact; the workflow test now also checks that the selection stays through an export. `AppHeader.test.ts`: the importing state's markup. Run against the previous `exportCommands.ts`, exactly the three new availability and name tests fail.
- Type checking (forced), lint and the production build pass.
- Browser: `scripts/browser/png-export.mjs` passes in Chrome and Firefox: 127 checks in the production build with timings (was 103) and 119 under React Strict Mode (was 95). The 12 new checks per browser: Export with an active selection (exact file, selection kept), Export `aria-disabled` with the new tooltip while a held import runs, a click then starting and downloading nothing, and Export available and exact once the image has opened. Export timings unchanged (Chrome 0.37 s at 4K, 1.9 s near 50 MP; Firefox 0.27 s and 1.3–1.4 s).
- Existing browser regression suites, production build, Chrome and Firefox, all passing: `smoke.mjs` 340, `edit-workflow.mjs` 515, `auto-trim.mjs` 174, `edge-adjust.mjs` 199, `edit-ownership.mjs` 52 (`edit-workflow` and `auto-trim` with their timing checks this time, hence more than the earlier `--no-perf` counts). Image loading, edits during imports, Undo / Redo and replacement behave as before.

### Remaining manual QA

Phase 3's required items are unchanged: Step 12, Remaining owner QA 1 (large-image pauses), 2 (Orca, or an explicit deferral) and 3 (Firefox dialog Escape and focus return). Not verified by anyone yet, and recommended rather than required unless the owner decides otherwise: what Firefox does when its Save dialog is cancelled (decision 10; the application counts the export either way, decision 9), Export's announcements and its unavailable-while-opening description with Orca, and a look at Export being unavailable while a large image opens in a real browser. None of these is marked passed here.

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

- PNG export. (Brought forward on 2026-11-08; see Milestone: First Working Background Removal.)
- JPEG export.
- WebP export.
- Export naming. (PNG: `<name>-cleaned.png`, done with PNG export.)
- Save/download flow. (Browser download done with PNG export; Save As and the desktop dialog remain.)
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
