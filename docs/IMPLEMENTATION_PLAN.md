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
  - Neither canvas handles a lost 2D context: if the browser drops it (rare, mainly GPU process crashes), the canvas stays blank until the view changes. Since Step 12 a selection change no longer repaints the image.
- Test coverage only (not product defects):
  - Headless Firefox never has window focus, so blur commits, `:focus-visible` and Space / Enter on buttons cannot be automated there; they were verified in the Step 9–11 manual reviews.
  - Constructed paste events in Firefox carry no files, so Firefox paste is verified manually only.
  - The Step 9 browser script still asserts pre-Step 10 tolerance behaviour.

Decisions remaining for the project owner:

1. Main-thread time near 50 megapixels (D9, open since Step 7): keep everything synchronous, time-slice, or move selection work to a Web Worker. Recommendation: keep it synchronous for Phase 2. Everything up to 4K and 12-megapixel photographs responds in about 120 ms or less, and only images near the limit pause for 0.15–0.4 s. Re-evaluate with real images in Phase 3, where Delete and Undo add more full-image work, and introduce a Worker only if that testing shows the pauses matter.
2. Size the canvas backing stores from `ResizeObserver`'s `devicePixelContentBoxSize` to keep both canvases pixel-exact at fractional scaling (open since Step 8). It touches Phase 1 image rendering, so it would be its own small, separately reviewed change.
3. Whether to commit the benchmark and browser-check scripts (M6). They would need to become dependency-free scripts under `scripts/`; Chrome and Firefox are driven over their own protocols.
4. Optional: keep a just-opened image fitted on every window resize until the user zooms or pans, instead of only for the options row's resize. Recommendation: keep the current, narrower rule.

After the merge: decision 1 carries into Phase 3 as P3-D11 (pixel edits stay synchronous until measured). Decisions 2 and 3 remain open.

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
2. Delete algorithm (pure). (Implemented; awaiting review.)
3. History building blocks: pixel patches, crop patches, selection encoding, byte accounting.
4. Display image for edited pixels and render invalidation (verifies P3-D10).
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

#### Step 2: Delete Selection Algorithm (implemented; awaiting review)

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
