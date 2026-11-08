# Minty Background Remover Image Processing Specification

This document defines technical expectations for pixel-level image operations.

`PROJECT_BRIEF.md` remains the highest-level source of truth.

---

## Core Principle

Image-processing algorithms should be separated from React UI code wherever practical.

Prefer structures such as:

```text
src/
  image/
    selection/
    crop/
    trim/
    colour/
    transforms/
```

over embedding pixel algorithms directly inside React components.

Image-processing functions should be independently testable.

---

## Internal Pixel Representation

Canvas `ImageData` uses RGBA pixel data.

Each pixel contains:

```text
R
G
B
A
```

with channel values generally ranging from:

```text
0 - 255
```

Alpha:

```text
0   = fully transparent
255 = fully opaque
```

In the editor, pixels are held as a `PixelBuffer` (`editor/types.ts`): width, height and 8-bit straight (non-premultiplied) sRGB RGBA bytes, row-major. Decoded `ImageData` already has this shape and is used as it is; edits produce plain typed-array buffers, so pixel algorithms run without a canvas and are tested in Node. Every source format (PNG, JPEG, WebP, SVG) is decoded into this one representation, so transparency is handled the same way whatever the file was.

---

## Pixel Buffers and Revisions

Approved for Phase 3 (P3-D1), implemented in Phase 3 Step 1.

Copy-on-write:

- A pixel buffer is never written once it belongs to a document. An edit copies the current pixels (`copyPixelData`), writes only to the copy and wraps it (`createPixelBuffer`), then makes a new document from it (`createEditedDocument`). The previous document and its pixels stay exactly as they were.
- Buffers must be complete: width and height whole numbers of at least 1, exactly width × height × 4 bytes, starting on a 4-byte boundary so pixels can be read as 32-bit values (`validatePixelBuffer`). Imported and edited documents are validated the same way. A buffer whose memory was transferred away has no bytes and is rejected.
- A new document takes ownership of its buffer without copying it. Pixels that share memory with the document's current pixels are rejected: that is what an edit made in place looks like.
- The type makes a document's pixel bytes read-only (`Readonly<Uint8ClampedArray>`), so an indexed write is a compile error. Mutating methods (`set`, `fill`) and other views of the same memory are excluded by rule, not by the type.
- Copying is proportional to the image (about 15 ms at 4K and 70 ms at 50 MP in Node), so it happens in commands, never inside the editor reducer. Validating and creating a document only check sizes and take constant time.

Revisions:

- A document keeps its `id` across edits; `revision` identifies its pixel content. An opened image starts at revision 0. Every later content state gets a revision never given out before in the session, larger than any earlier one. Revisions come from one session-wide counter, so they are unique across all images, and `id` with `revision` (the `DocumentVersion`) never repeats.
- This includes Undo and Redo: restoring earlier pixels creates a new revision with a copy of them, never the earlier revision number. Work tagged with any earlier version (a selection, a Magic Wand click or re-apply, and later edits computed outside the reducer) can therefore never be accepted, even when the restored pixels are identical.
- Undo must still restore the selection and the Magic Wand click that can be re-applied. The recorded click is rebound to the new version (its `version` replaced with the restored document's) when it is restored, which is valid because the restored pixels and selection are exactly those it was made on. Stale version identifiers are never restored: history keeps the click without any version. (Implemented in the editor state in Phase 3 Step 5; reachable from Undo / Redo in Step 6.)

### Display Images

Implemented in Phase 3 Step 4 (`canvas/displayImage.ts`); verifies P3-D10.

- The canvas never draws a document's pixels directly. It draws a display image: a copy made once per content state, synchronously (`createDisplayImage`), so an edit can replace the document and its display image together. The pixels are written into a canvas with `putImageData` and handed over as an `ImageBitmap` (`transferToImageBitmap`); where that is unavailable, the canvas itself is the display image. The pixel buffer is never copied beforehand or written.
- Canvases store colour premultiplied by alpha. A display image therefore shows opaque pixels exactly, fully transparent pixels as transparent black (hidden colour can never be displayed, as P3-D2 requires), and partially transparent pixels with the alpha exact and the colour within one premultiplied level. Measured in Chrome 156 and Firefox 158, it shows exactly the same bytes as the import path's `createImageBitmap`, with both strategies.
- Display images live in main memory (`willReadFrequently`): GPU-backed images lose their pixels when the browser's GPU process restarts, and the workspace must be able to draw the image again when its canvas is restored.
- Each content state (every revision) gets its own display image, identified by the document id and revision; display images are never kept in history. Creation takes about 13 ms at 4K and 77 ms at 50 MP in Chrome, and 25 ms and 138 ms in Firefox, whose transfer copies the pixels once more (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 4).

---

## Source Image Integrity

Loading an image must not unnecessarily change:

- Resolution
- Aspect ratio
- Pixel dimensions

The browser's EXIF orientation handling is applied on import, so a rotated photo opens upright with its displayed dimensions.

PNG export should not intentionally degrade the image.

---

## Magic Wand

### Goal

Select pixels sufficiently similar to the clicked source pixel.

Every candidate is compared with the clicked pixel's colour, never with its neighbour.

### Contiguous Mode

A four-connected (edge neighbours only) flood fill from the clicked pixel, implemented in `src/image/selection/magicWand.ts` as a scanline fill:

- An explicit stack of row-segment scan requests replaces recursion, so no image is too large for the call stack.
- Each run of matching pixels is selected whole. The row beyond it is queued in full; the row it came from only where the run reaches past the request.
- Pixels are compared only when the fill reaches them, and at most once: a rejected pixel is remembered until the fill ends. The work follows the selected region and its outline, not the image, so a small region in a 50-megapixel image takes under a millisecond.
- Pixels with exactly the clicked pixel's RGBA skip the distance calculation.
- The selection's count and bounds are tracked during the fill, so no further pass over the mask is needed.

The clicked pixel always matches itself, so a result is never empty. A seed outside the image is rejected with a `RangeError`; the editor ignores clicks outside the image before calling the wand.

### Selection Mask

Selections are represented independently from pixel colour data, as a `SelectionMask` (`src/editor/types.ts`, built by `src/image/selection/selectionMask.ts`):

```text
width, height   always the image's dimensions
data            Uint8Array, row-major, one entry per pixel: 0 = not selected, 1 = selected
count           number of selected pixels, always at least 1
bounds          smallest rectangle containing every selected pixel
```

Rules:

- An empty selection is `null`, never a mask with no selected pixels.
- Masks are immutable. Every operation produces a new mask and never writes to its inputs, so masks can be shared (renderer caches, a future undo history).
- The builder takes ownership of the buffer it is given, without copying it. It rejects invalid dimensions, a length other than width × height, and values other than 0 or 1 with a `RangeError`.
- The selection model keeps no persistent full-image buffers other than masks: the current selection and, for tolerance re-apply, the selection as it was before the last Magic Wand operation (only for Add and Subtract, whose result depends on it; shared, never copied).
- At the 50-megapixel import limit a mask uses 50 MB.

Alternative efficient representations (bit packing, run-length encoding for history) may be considered if justified.

---

## Colour Distance

The user-facing tolerance is a whole number from 0 to 100, default 20.

The initial formula is an alpha-aware RGB distance between the clicked colour A and a candidate colour B, with channels 0–255:

```text
w   = min(alphaA, alphaB) / 255
D²  = ( w × (ΔR² + ΔG² + ΔB²) / 3  +  ΔA² ) / 255²
select when D ≤ tolerance / 100
```

- D lies between 0 and 1. Opaque black against opaque white is 1; fully transparent against any opaque colour is also 1.
- Colour differences count in proportion to the less opaque pixel's alpha, so the hidden RGB values of fully transparent pixels never matter: all fully transparent pixels are the same colour and match each other even at tolerance 0.
- Alpha differences always count in full. Transparent never matches opaque below tolerance 100; at 100 every colour matches.
- Raising the tolerance never removes a match.

`src/image/selection/colourDistance.ts` computes this with exact whole numbers and no square roots, so boundary cases are deterministic:

```text
distance  = min(alphaA, alphaB) × (ΔR² + ΔG² + ΔB²) + 765 × ΔA²     (= D² × 3 × 255³, from 0 to 49,744,125)
threshold = floor(49,744,125 × tolerance² / 100²)
select when distance ≤ threshold
```

Tolerance must be a whole number from 0 to 100; any other value is rejected with a `RangeError`. The editor clamps and rounds user input before it reaches the algorithm.

Boundaries at the default tolerance of 20 (D = 0.2):

- Opaque white selects `#CCCCCC` (51 levels on every channel) but not `#CBCBCB`.
- Opaque red selects rgb(255, 88, 0) but not rgb(255, 89, 0).
- Opaque white selects white at alpha 204 but not at alpha 203.
- Fully transparent selects any colour at alpha 51 but not at alpha 52.

This is an initial choice, subject to automated and real-image testing. A perceptual colour space may be considered later if testing demonstrates significant benefit.

---

## Transparency During Selection

Alpha differences should be considered carefully.

Transparent pixels must not match opaque colours simply because RGB channels happen to contain similar values, and fully transparent pixels must not be distinguished by their hidden RGB values (see Colour Distance).

---

## Global Colour Selection

Global mode evaluates all pixels rather than only connected neighbours, in one pass that also tracks the selection's count and bounds:

```text
for each pixel:
    if colourDistanceSquared(pixel, clicked) <= toleranceThreshold(tolerance)
        select pixel
```

Performance must be considered for large images.

---

## Add / Subtract Selection

Selection operations should manipulate the selection mask.

Examples:

```text
ADD:
existing OR newSelection

SUBTRACT:
existing AND NOT newSelection
```

These operations should not modify image pixels until an edit action is applied.

Implemented in `src/image/selection/selectionOperations.ts` (`combineSelections` with mode New, Add or Subtract; `selectAll`; `invertSelection`):

- New returns the incoming selection; an empty incoming selection (`null`) clears the selection.
- Add with nothing selected returns the other selection; Subtract from nothing is nothing; a result with no pixels is `null`.
- Masks of different dimensions are rejected with a `RangeError`.
- Inputs are never written. When nothing changes, the existing mask itself is returned (for example adding a region already inside the selection), so no-op operations allocate nothing. Otherwise the result is a new mask: one copy of the existing data, then work only inside the incoming mask's bounds.
- Count and bounds are derived from the inputs where possible and otherwise found by scanning inwards from the edges of the old bounds.
- Masks are processed a byte at a time, so they need no particular buffer alignment.

---

## Invert Selection

For each selection mask value:

```text
0 → 1
1 → 0
```

Inverting no selection selects the whole image; inverting a full selection gives `null`. Pixels outside the old bounds all become selected, so only the old bounds need flipping one by one.

---

## Grow Selection

Grow expands the selection by one pixel per action, including diagonal neighbours (a 3 × 3 neighbourhood dilation). Repeated actions grow further.

---

## Shrink Selection

Shrink removes, per action, every selected pixel that has an unselected pixel among its eight neighbours (a 3 × 3 erosion).

Pixels outside the image bounds count as selected, so a selection touching the image edge stays attached to it. A shrink that leaves nothing selected produces `null`.

Grow and Shrink are implemented in `src/image/selection/growShrink.ts` as a separable 3 × 3 operation: each row is first combined with its left and right neighbours, then each output row combines three such rows. Only three rows of scratch space are used, and only the old bounds (plus one pixel for Grow) are visited. Growing or shrinking nothing gives `null`; a full selection is returned unchanged by both. Any other selection always changes, so the result is a new mask with its count and bounds tracked as it is built.

---

## Selection Performance

- Begin with synchronous pure algorithms on the main thread.
- Algorithms stay independent of React, the DOM and Canvas, so they can move to a Web Worker unchanged.
- Measure early with production browser builds (`npm run build` and `npm run preview`), not only Node benchmarks. Benchmarks may be manually run scripts without additional dependencies.
- Significant UI freezes are not acceptable. Web Workers are introduced only when profiling shows the need and the project owner approves.

Magic Wand measurements at Step 3 (whole calls including the mask, production builds in headless Chrome 156 and Firefox 158 on an i7-14700HX):

- Screenshots up to 4K: about 5–40 ms per click. The first few clicks of a session are up to twice as slow while the browser optimises the code.
- 4K, whole-image selection on a noisy, photo-like background: about 45–90 ms.
- 50 megapixels: about 100–300 ms on flat backgrounds; 250–520 ms for whole-image selections on noisy backgrounds; up to about 0.9 s on synthetic worst cases (random noise, one-pixel mazes).

Step 7 browser measurements (whole pointer-down handling: Magic Wand, combine and React commit, excluding paint; production build, headless Chrome 156 and Firefox 158, device pixel ratios 1–1.5):

- 4K screenshot-like image (3840 × 2400): typically 2–7 ms in Chrome and 7–16 ms in Firefox; about 20–40 ms when the click selects most of the image (7 million pixels).
- 4K noisy image where one click selects all 8.3 million pixels: about 55–70 ms in both browsers.
- Each mask is one byte per pixel (8.3 MB at 4K). A New click replaces the selection with the Magic Wand result; Add and Subtract briefly hold that result and the combined mask alongside the current selection.

Near the 50-megapixel limit the main thread can block noticeably. How to respond (time-slicing on the main thread or a Web Worker) is an open owner decision, to be made with real images at the Step 7 checkpoint. Step 12 measured 0.15–0.4 s per operation at 50 megapixels (Final Phase 2 Measurements, below) and recommends keeping the work synchronous for Phase 2 and re-evaluating in Phase 3 (`IMPLEMENTATION_PLAN.md`, Phase 2 Step 12).

### Tolerance Re-apply

A committed tolerance change (Step 10) re-applies the last Magic Wand click as `combineSelections(before, createMagicWandSelection(pixels, seed, { tolerance, floodMode }), mode)`, where `before` is the selection from before the click. It is the same formula, and the same work, as the click itself: one Magic Wand pass and one combine, computed outside the reducer. Nothing is computed while the tolerance is being adjusted, when the committed tolerance is the one the selection was made with, or for a Subtract made with nothing selected (whose result is always nothing).

Memory: the editor state holds the current selection and, for Add and Subtract, the mask from before the click: at most two full-image masks. During a re-apply the new Magic Wand result and, for Add and Subtract, the combined mask are briefly held as well: four masks for Add or Subtract (33 MB at 4K, 200 MB at 50 megapixels) and two for New. React keeps the selection of its previous render until it renders again, at most one more mask. Heap snapshots in Chromium after ten re-applies of each mode found exactly the masks above (one for New, two for Add and Subtract, plus React's previous one until the next render): the number of live masks never grows with the number of re-applies.

Step 10 measurements (production build, headless Chromium 153, device pixel ratio 1, 1280 × 800 window, on a 4-core 2.1 GHz Xeon cloud container that is markedly slower than the machine used for Steps 3–8; whole event handling including the React commit and overlay drawing, excluding paint):

- 4K screenshot-like image (3840 × 2160, 3–5 million pixels selected): a click 100–170 ms; a re-apply 55–80 ms (median) when the slider is released or Enter is pressed, up to about 240 ms.
- 50 megapixels (8192 × 6100, 18–34 million pixels selected): a click 460–1040 ms; a re-apply 290–420 ms (median), up to about 1 s.
- Slider movements, typing, a commit of the same tolerance and Escape in the text field: under 2 ms, with no pixel work.

### Selection Overlay

The overlay (Step 8; see `ARCHITECTURE.md`, Phase 2 Modules) reads only the selection mask, never writes it, and never touches image pixels.

Memory follows the screen, not the image:

- The overlay canvas has the workspace's backing store while something is selected (8 MB at 1920 × 1080 device pixels, 33 MB at 3840 × 2160) and none otherwise.
- Tiles of at most 256 × 256 device pixels (256 KB) are created only where the selection's bounds are visible, and kept only within one tile of the view: at most about 20 MB at 1920 × 1080 and 55 MB at 3840 × 2160, usually much less.
- Zoomed out, a copy of the mask packed one bit per pixel (one eighth of the mask, 6.25 MB at 50 megapixels) is built once per selection and freed with it.
- No full-resolution RGBA overlay is ever allocated.

Complexity budget: a frame is one `clearRect` and one `drawImage` per visible tile (about 40 tiles at 1920 × 1080, 140 at 3840 × 2160), whatever the selection's shape. Boundaries are found with bit operations, 32 device pixels at a time, so a million holes or a random-noise selection never becomes a million drawing operations; their cost is bounded by the visible area. Areas entirely inside or outside the selection are filled without per-pixel work. Panning reuses tiles; a selection, zoom or display-scaling change rasterises the visible tiles again.

Step 8 measurements (production builds, headless Chrome 156 and Firefox 158, i7-14700HX). Overlay drawing alone, 1920 × 1080 CSS workspace at device pixel ratio 1:

- 4K screenshot-like background selection: about 9–25 ms after a selection change, 6–17 ms per zoom step, under 0.2 ms (Chrome) or about 3 ms (Firefox) per pan frame.
- Pathological 4K selections (50% random noise): 15–37 ms per full redraw.
- 50 megapixels, fitted: 37–45 ms after a large selection change (including the packed copy), 14–18 ms per zoom step; 53–70 ms and 43–60 ms for a million scattered pixels. A single selected pixel: under 4 ms.
- At device pixel ratio 2 (3840 × 2160 device pixels) costs are about 2–3 times higher: 10–64 ms for a 4K screenshot-like selection, up to about 180 ms for the 50-megapixel scattered-pixel worst case.

Added to whole interactions (pointer-down or button click including the React commit, median, compared with the same build without the overlay, device pixel ratio 1):

- Magic Wand click on a 4K screenshot: +2 ms (Chrome) and +3 ms (Firefox); a click selecting all 8.3 million pixels of a 4K image: +12 to +14 ms.
- 50-megapixel clicks, which already take 210–430 ms: +19 to +47 ms.
- Zoom In / Out, Fit and 100% with a selection: 15–42 ms instead of under 13 ms.

#### Marching Ants (Step 11)

The boundary pattern moves without touching the selection: which pixels are boundary, tint or transparent is decided once per tile, and a step only changes black and white boundary pixels (see `ARCHITECTURE.md`, Phase 2 Modules, and `UI_UX_SPEC.md`, Selection UX).

What a step costs:

- No mask reads, no Magic Wand or selection work, no rasterising and no React work. The steps run on timers (one every 150 ms at most) followed by one animation frame, never on every frame, and none at all with reduced motion, while the page is hidden, or when no boundary is in view.
- Pixel work: in each visible tile with boundary, the quarter of its boundary pixels where the stripes move are flipped between black and white, found 32 at a time with bit masks. Tiles without boundary are skipped.
- Canvas work: per visible tile with boundary, one `putImageData` of its boundary area (a dirty rectangle, usually much smaller than the tile), one `clearRect` and one `drawImage` of that area onto the overlay. A selection with a million disconnected pixels is still at most one set of three calls per visible tile (about 40 at 1920 × 1080, 140 at 3840 × 2160 device pixels).
- Budget: steps are timed, and when they take longer than 7.5 ms the next one waits 20 times as long, so steps never take more than about a twentieth of the main thread. The ants pause while the boundary areas in view exceed 10 million device pixels.

Memory, in addition to Step 8 (all of it freed with the selection):

- Boundary geometry: two bits per device pixel for the rows and 32-pixel columns of each tile that hold boundary, at most 16 KB a tile; 0.04–0.85 MB in the cases below, 2.3 MB for noise filling a 3840 × 2160 view.
- Once the pattern changes (the first step, or reduced motion being switched on or off), each visible tile with boundary keeps its boundary area's pixels (4 bytes per device pixel of that area), so a step only changes the pixels that move: 0.5–4.6 MB at 1920 × 1080 and 0.9–13 MB at 3840 × 2160 device pixels for the screenshot-like and large connected selections below, 6–11 MB and 25–36 MB for noise-like ones. Tiles out of view drop theirs; with reduced motion from the start none are kept.

Step 11 measurements (production builds, i7-14700HX, headless Chrome 156 and Firefox 158, 1920 × 1080 CSS workspace; medians). Chrome was measured both with GPU-accelerated canvas and compositing (`--enable-gpu`, closest to a desktop browser) and with its default headless software rendering; Firefox headless renders canvases in software.

Main-thread time while idle with a selection on screen (Chrome `TaskDuration` over 6 s; Step 10, and Step 11 with reduced motion or without a selection: 0.1–2 ms/s in every case):

| Selection (view) | GPU, DPR 1 | GPU, DPR 2 | Software, DPR 1 | Software, DPR 2 |
| --- | --- | --- | --- | --- |
| 1280 × 800 screenshot background (Fit) | 15 ms/s | 26 ms/s | 37 ms/s | 63 ms/s |
| Same, 200% | 11 ms/s | 17 ms/s | 29 ms/s | 59 ms/s |
| 3840 × 2400 screenshot background (Fit) | 17 ms/s | 27 ms/s | 38 ms/s | 65 ms/s |
| 4K noisy image, everything selected (Fit) | 14 ms/s | 24 ms/s | 31 ms/s | 60 ms/s |
| 4K noisy image, fragmented Global selection (100%) | 48 ms/s | 48 ms/s | 65 ms/s | 65 ms/s |
| 50 MP, background with a million dots as holes (Fit) | 19 ms/s | 24 ms/s | 41 ms/s | 62 ms/s |
| Same, 100% inside an unselected area (no boundary in view) | 0.3 ms/s | 0.3 ms/s | 1.2 ms/s | 1.3 ms/s |

With GPU rendering that is about 1–3% of one core for screenshot-like and large connected selections, and about 5% (the step budget) for fragmented ones. With software rendering it is 3–6.5%: presenting the changed overlay canvas then costs more than the step itself (the difference between the main-thread and script times), as the whole canvas is composited again on the CPU. Desktop browsers usually composite on the GPU, but this has not been measured on real displays.

Cost of one step (JavaScript time of the renderer, overlay pipeline alone):

- Chrome (GPU): 1–4 ms for screenshot-like and large connected selections at device pixel ratio 1, 1–6 ms at ratio 2; 4–8 ms and 9–12 ms for noise-like ones. A single selected pixel: 0.1 ms.
- Firefox: 3–7 ms and 6–10 ms for screenshot-like selections, 8–11 ms and 18–25 ms for noise-like ones. Firefox has a floor of about 2–3 ms at ratio 1 and 6 ms at ratio 2 even for a single selected pixel (apparently the copy of the whole overlay canvas after the compositor has shown it; its pan frames show the same floor since Step 8). Steps over 7.5 ms are spaced out by the budget, so in Firefox at ratio 2 noise-like boundaries step every 360–500 ms instead of 150 ms.

Effect on the rest of the overlay (Step 10 → Step 11, Chrome software rendering, which varies least between runs): a selection change or zoom step costs about the same for screenshot-like and large connected selections (0–3 ms, up to about 10% more), and 5–20% more for noise-like ones (for example 18.6 → 21.9 ms at ratio 1 and 57.8 → 66.3 ms at ratio 2 for 50% noise at 100%), mainly because tiles are now rasterised in two passes (boundary geometry, then colours) so that the geometry can be kept; Firefox is similar. Pan frames are unchanged.

### Final Phase 2 Measurements (Step 12)

Production build with the Step 12 fixes, headless Chrome 156 (default software rendering and `--enable-gpu`) and Firefox 158, i7-14700HX (the machine of Steps 3–8 and 11), device pixel ratio 1, 1920 × 1200 window, image fitted unless stated. Times are whole interactions as in Steps 7 and 8: from the event to the end of its handling, including the selection work, the React commit and the overlay drawing, excluding paint. Medians (maximum in brackets where it differs noticeably). Firefox reports whole milliseconds.

| Image (selection) | Operation | Chrome | Chrome GPU | Firefox |
| --- | --- | --- | --- | --- |
| Technical graphic 800 × 600, transparent background (0.35 MP) | Contiguous click | 2.2 ms | 2.2 ms | 4 ms |
| | Global click | 6.7 ms | 7.2 ms | 9 ms |
| | Re-apply (New / Add) | 4.6 / 6.0 ms | 4.6 / 5.2 ms | 9 / 8 ms |
| | Grow, Shrink, Invert | 8–17 ms | 7–13 ms | 5–8 ms |
| Screenshot 1280 × 800 (0.70 MP background) | Contiguous click | 2.1 ms | 2.6 ms | 4 ms |
| | Re-apply (New / Add) | 8.2 / 6.6 ms | 8.2 / 6.3 ms | 17 / 10 ms |
| | Grow, Shrink, Invert | 11–22 ms | 10–15 ms | 7–11 ms |
| Photograph 4032 × 3024 JPEG (4.7 MP sky) | Contiguous click | 49 ms | 46 ms | 55 ms |
| | Global click | 109 ms (180) | 82 ms (152) | 76 ms |
| | Re-apply (New / Add, 10 MP) | 52 / 90 ms | 51 / 117 ms (194) | 59 / 72 ms |
| | Grow, Shrink, Invert | 25–102 ms | 25–53 ms | 23–30 ms |
| 4K screenshot 3840 × 2400 | Contiguous click (0.05–6.3 MP) | 4.5 ms (37) | 4.8 ms (36) | 6 ms (45) |
| | Global click (2.5 MP) | 58 ms | 61 ms | 56 ms |
| | Invert, Select All (9.2 MP) | 18–27 ms | 15–26 ms | 19–26 ms |
| 4K noisy image 3840 × 2160 (all 8.3 MP) | Contiguous click | 66 ms | 66 ms | 70 ms |
| | Global click, tolerance 2 (1.5 MP fragmented) | 89 ms | 88 ms | 91 ms |
| | Re-apply | 65–66 ms | 65 ms | 63–68 ms |
| 50 MP 8660 × 5773, background with 1 million dots as holes (36 MP) | Contiguous click | 230 ms | 232 ms | 254 ms |
| | Global click | 199 ms | 211 ms | 201 ms |
| | Re-apply (New / Add, 49 MP) | 227 / 202 ms (293) | 226 / 182 ms | 253 / 161 ms (188) |
| | Grow, Shrink | 181–182 ms | 179–181 ms | 135–137 ms |
| | Invert, Select All | 46–238 ms | 46–281 ms | 51–103 ms |
| 50 MP at the side limit 16384 × 3051 (15 MP) | Contiguous click | 56 ms | 48 ms | 57 ms |
| | Global click (35 MP) | 197 ms | 201 ms | 185 ms |
| | Invert (35 MP / 15 MP) | 164 / 271 ms | 200 / 382 ms | 76 / 91 ms |

Navigation with a selection on screen (same cases):

- Zoom In / Out buttons: 1–13 ms up to 4K in Chrome (12–21 ms in Firefox), 21–23 ms at 50 MP (39 ms in Firefox).
- Main-thread time per wheel event (Chrome): panning 2.6–4.4 ms with software rendering and 1.3–2.3 ms with GPU rendering, whatever the image size; Ctrl + wheel zoom, which rasterises the visible overlay tiles again, 4–15 ms up to 4K and 11–23 ms at 50 MP.

Comparison with earlier steps (same machine and browsers, where the cases match):

- 4K screenshot clicks: 2–7 ms (Chrome) and 7–16 ms (Firefox) in Step 7, 4.5 ms and 6 ms (medians) now. Clicks selecting all 8.3 million pixels of the noisy 4K image: 55–70 ms in Step 7, plus 12–14 ms for the overlay in Step 8; 66–70 ms now.
- 50 MP background clicks: 210–430 ms in Step 8 (with the overlay); 230–254 ms now.
- Grow and Shrink at 50 MP: 90–125 ms for the algorithm in Step 5 (126 ms in Node now, unchanged); 135–182 ms as whole interactions including the overlay.
- Step 10's re-apply figures were measured on a slower cloud machine and cannot be compared directly; on this machine a re-apply costs the same as the click it repeats, as designed.
- The marching ants (idle overhead below) and Step 12 changed none of the selection algorithms.

What is slow at 50 megapixels: in Node the algorithms alone take 210 ms (Contiguous or Global over 50 MP), 126 ms (Grow, Shrink), 53 ms (Add, Invert) and 16 ms (Select All). In the browser, rasterising the overlay for a large new selection adds 40–50 ms (Step 8), and allocating 50 MB masks sometimes triggers a garbage collection, which is why the same Invert takes 140 ms once and 240–380 ms another time in Chrome. No measured interaction exceeded 0.4 s; the Step 3 synthetic worst cases (random noise and one-pixel mazes filling 50 MP) reach about 0.9 s. Up to 12-megapixel photographs and 4K screenshots, interaction medians stay at or below about 120 ms; single slower runs on the photograph reached 150–194 ms.

Redundant image redraws (fixed in Step 12): before Step 12 every React render drew the whole image again, although only the view changes it. Since Phase 2 that includes every click, selection action, option change and tolerance slider movement. Skipping frames identical to the last one (`ARCHITECTURE.md`, Phase 2 Modules) leaves main-thread time unchanged in Chrome, which rasterises canvases elsewhere, but removes that raster work from the input path. Measured with 20 tolerance slider steps (nothing to re-apply) and the image fitted, keydown to keyup:

| | Before | After |
| --- | --- | --- |
| Chrome software rendering, ratio 1 (4K / 50 MP) | 19 / 19 ms | 3.0 / 3.1 ms |
| Chrome software rendering, ratio 2 | 43 / 62 ms | 5.4 / 5.3 ms |
| Chrome GPU rendering, ratio 1 | 2.1 / 2.5 ms | 2.3 / 3.1 ms |
| Firefox, ratio 1 | 14 / 13 ms | 6 / 5 ms |
| Firefox, ratio 2 | 24 / 28 ms | 4 / 5 ms |

In Firefox the redraw also ran inside the event: a 4K Magic Wand click took 27 → 20 ms (ratio 1) and 46 → 29 ms (ratio 2).

Memory (Chrome, JavaScript heap plus array buffers after garbage collection, measured after two further renders so that React no longer holds the state of its previous render; one mask is 9.2 MB for the 3840 × 2400 screenshot):

- An image open with nothing selected is the baseline. A New click adds 1.4 masks: the mask, its zoomed-out packed copy (one eighth) and the visible tiles' boundary-area pixels kept for the ants.
- Ten re-applies of a New click: still 1.4 masks. An Add click and ten re-applies: 2.5 masks (the selection and the base it was added to). A Subtract that removed nothing returns the existing mask, so nothing is added. Grow, Shrink and Invert end re-applying and the base is dropped: 1.4 masks.
- Escape: back to the baseline (+0.1 mask). Six image replacements, each with Add clicks and re-applies, then the first image again: back to the baseline (+0.1 mask). Previous documents, bitmaps, masks and tile caches are released.
- Without the extra renders, React keeps the selection (and after an import, the previous image) of its previous render until it renders again: one more of each at most, never accumulating.
- At 50 megapixels (8660 × 5773, one mask 50 MB, pixels 200 MB) the same sequence gives the same picture: a background click adds 1.2 masks (the mask, its 6.25 MB packed copy, the ants' areas), ten re-applies add nothing, and after six replacements by 50-megapixel images with clicks and re-applies the memory is back at the baseline (+1 MB).

Main-thread time while idle with a selection on screen and the marching ants running (Chrome `TaskDuration` over 6 s, 1920 × 1080 window, the Step 11 method and cases plus the photograph):

| Selection (view) | Software, DPR 1 | Software, DPR 2 | GPU, DPR 1 | GPU, DPR 2 |
| --- | --- | --- | --- | --- |
| 1280 × 800 screenshot background (Fit) | 18 ms/s | 39 ms/s | 9 ms/s | 15 ms/s |
| Same, 200% | 19 ms/s | 31 ms/s | 7 ms/s | 11 ms/s |
| 3840 × 2400 screenshot background (Fit) | 22 ms/s | 39 ms/s | 9 ms/s | 12 ms/s |
| Photograph 4032 × 3024, sky (Fit) | 15 ms/s | 35 ms/s | 8 ms/s | 11 ms/s |
| Same, 100% | 16 ms/s | 40 ms/s | 6 ms/s | 13 ms/s |
| 4K noisy image, everything selected (Fit) | 18 ms/s | 35 ms/s | 9 ms/s | 13 ms/s |
| 4K noisy image, fragmented Global selection (100%) | 48 ms/s | 71 ms/s | 32 ms/s | 48 ms/s |
| 50 MP, background with a million dots as holes (Fit) | 20 ms/s | 37 ms/s | 9 ms/s | 16 ms/s |
| Same, 100% inside an unselected area (no boundary in view) | 0.1 ms/s | 0.1 ms/s | 0.1 ms/s | 0.1 ms/s |

With reduced motion, or without a selection, every case measured 0.0–1.1 ms/s: nothing runs. The ants take about 1.5–2% of the main thread for ordinary selections with software rendering at ratio 1, 3–4% at ratio 2, and under 1–1.5% with GPU rendering; fragmented selections stay within the 5% step budget for script time (29–46 ms/s), plus compositing. These values are lower than the Step 11 table, but the Step 11 build measured now with the same script gives the same values as Step 12 (software 15–23 ms/s and GPU 7–11 ms/s at ratio 1 for the same cases), so the difference comes from the measuring conditions of that session, not from a change in the app. Interaction latency while the ants run, timer counts and memory were checked as well: at most one step is ever pending, none after Escape, after image replacements or while the page is hidden (including a real tab switch in Chrome), and steps continue every 150 ms after rapid clicks, zoom changes and re-applies.

---

## Delete Selection

For selected pixels:

```text
alpha = 0
```

RGB values may remain internally unchanged because fully transparent RGB values are visually irrelevant.

The operation must be undoable.

Approved for Phase 3 (P3-D2): Delete keeps the RGB values of deleted pixels internally, hidden, so its Undo record stays small (about 45 KB when deleting a smooth-edged background from a 50 MP image in the planning measurements, against roughly 4 bytes per deleted pixel of a photograph when RGB is cleared as well). Consequences that later work must respect:

- No operation may make a fully transparent pixel visible again without also setting its colour, so hidden colour never reappears in the editor.
- Export (Phase 6) writes every fully transparent pixel as 0, 0, 0, 0, so deleted content never leaves the application.
- Operations that resample (resize, rotation by other angles) must work on premultiplied colour, so hidden colour cannot bleed into visible neighbours.
- Delete clears the selection; Undo restores it (P3-D3).

Implemented in Phase 3 Step 2 (`image/edit/deleteSelection.ts`, `deleteSelectedPixels`):

- Input: the image's pixels and the selection (null for none). The selection must be the image's size.
- Output: the new pixels, the number of pixels made transparent and the smallest rectangle containing them; or null when nothing would change.
- A selected pixel whose alpha is above 0, including alpha 1, gets alpha 0; nothing else about it changes. A selected pixel that is already fully transparent keeps every byte and is not counted. Unselected pixels are never touched.
- The input pixels and the selection are never written. The image is copied once, and only when at least one pixel changes; no other buffer proportional to the image is allocated. Work is limited to the selection's bounds.
- Node measurements: 39 ms for a 4K background and 162 ms at 50 MP, of which the copy is 15 ms and 78 ms (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 2). Browser timings are measured with the Delete command (Step 6).

Connected to the application in Phase 3 Step 6 (`editor/editCommands.ts`, `deleteSelectionCommand`): the result is recorded through the edit history (the deleted pixels' bounds as the patch region), becomes a new revision with its display image, and clears the selection. A selection of only fully transparent pixels changes nothing and records nothing. Whole Delete, from the key press until the new image is committed and drawn (production build, headless, `IMPLEMENTATION_PLAN.md` Phase 3 Step 6):

| | Chrome 157 | Firefox 159 |
| --- | --- | --- |
| 3840 × 2160, 7.27 M pixels selected | 98–131 ms (display image 13–15 ms) | 89–105 ms (display image 22–37 ms) |
| 8660 × 5773, 27.96 M pixels selected | 509–634 ms (display image 77–86 ms) | 464–482 ms (display image 138–170 ms) |

Undo and Redo of those Deletes take 44–86 ms at 4K and 232–326 ms at 50 MP. History kept: 937 KB for the 4K screenshot background (mostly the selection around anti-aliased text) and 197 KB at 50 MP.

---

## Edge Cleanup

Edge cleanup should primarily target fringe pixels left after deleting a background.

Initial goals:

- Conservative behaviour
- Crisp output
- Avoid excessive erosion
- Adjustable cleanup amount
- Undoable

Exact implementation should be prototyped and visually tested.

Approved for Phase 3: cleanup defaults to 0 px, so Delete alone never changes unselected pixels and fine technical lines are protected (P3-D4). The algorithm remains undecided until the prototype comparison (Phase 3 Step 7, P3-D5), which compares conservative fringe removal with background-colour decontamination on screenshots, anti-aliased logos, HMI graphics with one-pixel lines, photographs, SVG renders, gradients and text.

Potential techniques may include:

- Small alpha erosion
- Neighbour-aware cleanup
- Background-colour decontamination

Do not implement an overly complex edge-matting system without clear need.

Decided after the Step 7 comparison (owner): background-colour decontamination (Candidate B), run as part of Delete Selection, 0–5 px, default 0. Implemented in Phase 3 Step 8 (`image/edit/edgeCleanup.ts`, called through `deleteSelectionWithEdges` in `image/edit/deleteWithEdges.ts`):

- Model: in premultiplied RGBA (colour × alpha, and alpha, 0–255), an edge pixel is a blend v = a · F + (1 − a) · B + r of a foreground colour F and the local background B with coverage a.
- B comes from the original colours of the selected pixels nearby (Delete keeps them hidden, and cleanup runs inside Delete with the source pixels): the mean of the "core" selected pixels (all 8 neighbours selected) within 2 px, else of the selected 8-neighbours; their spread gives a noise level ν = max(6, 2.5 σ). Already transparent selected pixels count as transparent background; their hidden colour is never read.
- The band: unselected, not fully transparent pixels up to the distance in 8-connected steps from the selection, entered only while the contrast to B does not drop by more than ν (an outline protects what lies behind it).
- F: from the pixel's unselected neighbours, a deeper band pixel offering its own estimate (so estimates propagate outward from solid material), any other neighbour its colour (a transparent one "transparent material"). A neighbour counts only if it contrasts with B by 24 or more and explains the pixel within max(2ν, 8% of the contrast); the most foreground-like wins. A neighbour farther from the selection with the pixel's own colour (within ν) means solid material: the pixel is left alone (the twin rule).
- Result per band pixel: unchanged without a reliable estimate, within noise of the foreground, or for twins; fully transparent (colour kept hidden) within noise of the background or when its new alpha rounds to 0; otherwise colour F + r and alpha a · alpha(F + r), never above its own alpha.
- Guarantees: only band pixels change; alpha never increases; selected and fully transparent pixels are never changed; the image border is never background; inputs are never written; the result does not depend on the strips (256 rows with a halo) the region is processed in.
- Verified identical, byte for byte, to the Step 7 prototype on the 14 Step 7 fixtures at every distance, and in Chrome and Firefox to the same code in Node. Accuracy as in the Step 7 report (mean edge error over 13 fixtures with ground truth: 11.88 after exact Delete, 6.89 at 1 px, 6.50 at 4 px; all 14 thin lines and their faint anti-aliasing kept).
- Limits: colour flattened onto the background cannot be recovered; cleanup trusts the selection and never restores deleted pixels; a solid mid-grey part next to a dark outline is protected only while the distance stays inside it (at larger distances the grey column touching the outline is taken for a blend); sub-pixel (LCD) text fringes are not representable. Measurements: `IMPLEMENTATION_PLAN.md`, Phase 3 Step 8.

---

## Feathering

Feathering softens the edge by varying alpha.

Default:

```text
0 px
```

Because many target assets are technical or flat graphics, crisp edges are preferred.

Feathering should be optional.

Feathering must respect the hidden-colour rule under Delete Selection: it may not raise the alpha of a deleted pixel without setting its colour.

Implemented in Phase 3 Step 8 (`image/edit/feather.ts`), run as part of Delete Selection after edge cleanup, 0–5 px, default 0:

- d: each kept pixel's distance (centre to centre) to the nearest selected pixel, measured through kept pixels (unselected, not fully transparent in the source) by vector propagation. Only the deleted selection starts a feather; the image border and transparency already in the image do not.
- Thin features are protected by the shape's local thickness h, the largest d reachable by stepping uphill (to neighbours at least 0.5 px deeper; a neighbour beyond feather + 2 counts as unlimited). The fade runs over L = min(feather, h − 1.5) px: alpha × clamp((d − 0.5) / L, 0, 1), and nothing when L ≤ 0. Features up to about 3–4 px across (lines, wiring, small text, dots) are never feathered; every shape keeps its middle at full alpha.
- Why not plain feathering (alpha × clamp((d − 0.5) / feather)): it fades every 1-pixel line (Step 7: 13 of 14 test lines damaged at 1 px). The Step 7 "thin features protected" rule (skip pixels with no deeper neighbour) still split 2 anti-aliased lines and faded small text. The thickness rule keeps all 14 lines and the small text at 1–5 px.
- Alpha only ever decreases and colour is never changed, except that a pixel faded to 0 gets its original colour back, hidden. Changes stay within the feather distance of the selection; the result does not depend on the strips.
- Known effect: shapes thicker than about 4 px fade along every deleted edge, outlines drawn on that edge included.

### Re-applying the Last Delete (Phase 3 Step 9)

When the Edge cleanup or Feather amount is changed right after a Delete, the Delete is made again from its inputs, never from its result:

- The pixels before the Delete are rebuilt from its history entry: the XOR patch applied to the current pixels gives them back byte for byte, hidden colour included. The selection is the one the entry recorded (decoded), so it is exactly the mask that was deleted, whatever has happened to the selection settings since.
- The result is `deleteSelectionWithEdges(pixels before, selection, new amounts)`: exactly what Delete with those amounts would have given, with 0 / 0 exactly the Step 6 Delete. Cleanup reads the original colours of the selected pixels as it does inside Delete; feathering measures distances from the same selection.
- Because each adjustment starts from the same pixels and selection, adjustments never accumulate: no edge is cleaned or faded twice, and the same amounts always give the same bytes, however often and in whatever order they are tried.
- The history entry is replaced by one with the new patch (over the bounds of every pixel changed by the new amounts) and the new amounts; its encoded selections and Magic Wand click are shared, not encoded again. Undo therefore returns exactly to the image before the Delete, and Redo to the latest result.
- Peak memory during an adjustment: the current pixels, the pixels before the Delete, the result and the decoded selection, plus Delete's strip scratch. Measured at 50 MP (edge-dense): 380–430 MB above the open image, about one image (190 MB) more than the Delete itself, all released afterwards. Nothing is kept between adjustments.
- Time: about that of a Delete with the same amounts, plus 30–120 ms (Node) to rebuild the image before it and decode the selection; in the browsers 0.2–0.47 s at 4K and 0.6–2.7 s near 50 MP (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 9).

---

## Auto Trim

Auto Trim determines the visible pixel bounds.

Pseudo logic:

```text
minX = width
minY = height
maxX = -1
maxY = -1

for each pixel:
    if alpha > threshold:
        update bounds
```

The resulting bounds are expanded by configured padding.

### Transparency Threshold

A small threshold may be used instead of requiring:

```text
alpha > 0
```

because anti-aliased edge pixels may contain extremely low alpha.

The chosen threshold must be documented and tested.

Approved for Phase 3 (P3-D6): visible bounds come from alpha alone, with adjustable padding. The threshold value is fixed and tested in Phase 3 Step 10 (recommendation: alpha > 0, so faint anti-aliasing is never cut off).

Phase 3 Step 10 (provisional, awaiting owner confirmation of P3-D6): the threshold is 0, so every pixel with alpha 1 or more is visible. The pure functions also accept a whole-number threshold from 0 to 254, which nothing in the application passes.

- Above 0, a threshold can cut off visible content. Faint pixels outside the content found (soft shadows, the outermost feathered edge pixels) are removed with the border.
- A threshold helps only against faint stray specks, which at 0 stop that side from being trimmed.
- Measured: thresholds up to 16 cut nothing from Magic Wand and Delete results at any edge setting; threshold 1 already cuts the rim of a soft drop shadow.

Only alpha is read: colour hidden under alpha 0 (Delete Selection, P3-D2) is never content.

### Fully Transparent Image

If no visible pixels are found, Auto Trim must not create invalid dimensions.

The UI should inform the user that there is nothing visible to trim.

Phase 3 Step 10: such an image gives the result `nothing-visible`, with no rectangle at all, so no image of zero size can be made. An image whose content with its padding already reaches every edge, for example one already trimmed with that padding, gives `unchanged`. Neither is an edit.

Phase 3 Step 11: the tool shows and announces "Nothing to trim: the image has no visible pixels." for the first, and "Nothing to trim: no side has more than 5 px of transparent space." (at 0 px: "…visible pixels already reach every edge of the image.") for the second. Nothing is recorded, and the revision, Redo and the unexported-edits state stay as they are.

### Implementation (Phase 3 Step 10)

`image/trim/autoTrim.ts`, pure and synchronous like the other pixel algorithms. The Auto Trim tool (Phase 3 Step 11) calls `planAutoTrim` with the padding it shows and threshold 0, and records a `crop` plan's kept rectangle as below.

- `findVisibleBounds(pixels, alphaThreshold = 0)`: the smallest rectangle containing every visible pixel, or null.
  - It reads rows from the top and from the bottom until the first visible pixel, then each row in between only outside the columns found so far.
  - Pixels inside the content are never read, and each pixel is read at most once (apart from two per row).
  - A fully transparent image must be read entirely, which is the worst case: about 30 ms at 50 MP in Node. A fully opaque one takes 3 reads.
- `planAutoTrim(pixels, { padding, alphaThreshold? })`: `nothing-visible`, `unchanged` (with the visible bounds), or `crop` with the visible bounds and the rectangle to keep.
  - Padding is a whole number of pixels, 0 or more, kept around the visible bounds on each side where the image has them.
  - Each side is clipped at the image's edge on its own: the image is never enlarged and no pixel is invented, so the padding of a result can be uneven.
  - The default (5 px) and presets belong to the tool.
- `autoTrimPixels(pixels, options)`: the plan, with the trimmed image for a crop.
  - The image is cut at whole pixels from the original by `cropPixels` (`editor/history/cropPatch.ts`, the crop the history's Redo uses), into new memory of exactly the kept size.
  - Every byte is unchanged, including colour hidden in kept transparent pixels. Nothing is resampled, recoloured or scaled.
- The input is validated before any pixel is read (RangeError), and never written. Planning allocates nothing proportional to the image.

For history, a `crop` plan's kept rectangle is what an Auto Trim edit records (`CompletedCrop.kept`): a crop patch with the original size, the kept rectangle and every removed pixel (see History / Undo).

- The removed pixels' hidden colour must be kept exactly. An earlier Delete's patch restores colour by flipping alpha only, so undoing a trim and then that Delete would otherwise show wrong colours.
- A removed border of transparent black or one hidden colour therefore costs a few bytes. A deleted photographic background costs 4 bytes per removed pixel: about 143 MB for a 50 MP image trimmed to a quarter of its area.

Measurements, tests and the threshold study: `IMPLEMENTATION_PLAN.md`, Phase 3 Step 10. The tool, its browser timings and memory: Phase 3 Step 11.

In the editor (Phase 3 Step 11): a trim is one edit through `completedEditCommand`, with a new revision of the kept size and its display image. It clears the selection and the Magic Wand click (Undo restores both). The trimmed image, and the image Undo or Redo of a trim restores, is fitted to the workspace. The history keeps its limits; when recording a trim drops older Undo steps, the user is told how many.

---

## Crop

Crop creates a new pixel buffer using the selected rectangle.

The crop rectangle must be clamped to the image bounds.

Applying crop updates:

- Image dimensions
- Canvas dimensions
- Image pixel buffer

Selection state should normally be cleared after applying crop.

---

## Replace Colour

Basic Replace Colour should:

1. Identify pixels matching a source colour within tolerance.
2. Replace the relevant colour values.
3. Preserve alpha unless explicitly changed.

---

## Shading-Preserving Recolour

This is more advanced than flat colour replacement.

Potential approach:

1. Determine source pixel relative luminance.
2. Determine replacement hue/chroma.
3. Apply replacement while retaining luminance variation.

This feature should be implemented only after basic replacement works correctly.

It requires visual testing.

---

## Eyedropper

Eyedropper reads the exact pixel beneath the pointer.

Return:

```text
r
g
b
a
hex
```

Coordinate conversion must correctly account for:

- Zoom
- Pan
- Canvas position

---

## Brightness

Brightness changes should operate on RGB channels while preserving alpha.

Clamp values to:

```text
0 - 255
```

---

## Contrast

Contrast should use a documented mathematical transformation.

Avoid repeated destructive previews.

Preview should preferably operate from the original state for that adjustment rather than repeatedly transforming already-previewed pixels.

---

## Grayscale

Initial grayscale may use luminance weighting.

A common model is approximately:

```text
0.2126 R
0.7152 G
0.0722 B
```

Alpha should remain unchanged.

---

## Rotation

90° rotation changes dimensions:

```text
width ↔ height
```

Pixel mapping must be deterministic and independently testable.

---

## Flip

Horizontal flip mirrors X coordinates.

Vertical flip mirrors Y coordinates.

No interpolation is required.

---

## Resize

Resize changes pixel dimensions.

The browser Canvas 2D API may be used initially.

High-quality smoothing should be enabled when appropriate.

Avoid accidental resize during ordinary zoom operations.

---

## Solid Background

Compositing onto a solid background should preserve the visible appearance of semi-transparent pixels.

This is especially important before JPEG export.

---

## Outline / Stroke

Outline generation may be based on the alpha mask.

A simple approach may involve:

- Dilating the alpha mask
- Subtracting the original mask
- Filling resulting outline pixels with the chosen colour

This is a later feature.

---

## History / Undo

Avoid maintaining unlimited:

```text
ImageData(width × height × 4)
```

snapshots.

A 4K RGBA image can consume tens of megabytes per full snapshot.

Possible history strategies:

- Bounded full snapshots
- Operation-based history
- Region snapshots
- Hybrid approach

Correctness is more important than premature optimisation, but memory must remain bounded.

A reasonable early target is approximately:

```text
25 history entries
```

subject to memory constraints.

Approved for Phase 3:

- History covers image edits, not individual selection changes (P3-D7).
- At most 25 entries and 256 MB of history data; oldest entries are dropped first, and the newest entry is always kept even if it alone exceeds the budget (P3-D8).
- Undo and Redo produce new revisions (see Pixel Buffers and Revisions); they never reuse a revision number.
- History never holds full-image snapshots or display bitmaps. Each edit is a compact patch (implemented in Phase 3 Step 3, `editor/history/`):
  - Same-size edits (Delete Selection, later cleanup and colour tools): old XOR new for every pixel of the changed region, run-length encoded. Unchanged pixels and pixels changed the same way form runs; other values are stored one by one, with only their alpha byte when only alpha changed. XOR is its own inverse, so one patch serves Undo and Redo, and every byte is restored exactly, hidden colour included.
  - Size changes (Auto Trim): the original size, the kept rectangle and every removed pixel once, in row order, run-length encoded as raw RGBA, hidden colour included.
  - Selections: only their bounds, as varint row runs or packed bits, whichever is smaller.
  - Size: a typical background Delete patch is tens of kilobytes even at 50 MP, and a crop of a transparent or single-colour border under a kilobyte. The worst cases are 1 byte per deleted pixel (every alpha different), 4 bytes per changed pixel for arbitrary edits, and 4 bytes per removed pixel for a crop of a varied background: up to about 191 MB for a whole 50 MP image. Measurements are in `IMPLEMENTATION_PLAN.md` (Phase 3 Step 3).

Implemented in the editor state in Phase 3 Step 5 (`editor/history/editHistory.ts`, `historyEntry.ts`, `editor/historyCommands.ts`; details in `IMPLEMENTATION_PLAN.md`, Phase 3 Step 5):

- An entry keeps the patch, the encoded selection before the edit, the Magic Wand click before it (its previous selection encoded, shared with the selection when it is the same mask) and the encoded selection after it. Nothing else: no pixel buffer, document, revision, display image or mask.
- The 256 MB budget is 256 MiB (268,435,456 bytes) of retained memory over both stacks, measured with `retainedBytes` (each distinct buffer and payload once). Only history is counted, not the current document or its display image.
- Undo applies the patch backwards to the current pixels (`applyPixelPatch`, or `restoreCroppedPixels` for a crop) and Redo forwards (`applyPixelPatch`, or `cropPixels`); each result is a new revision, every byte exact, hidden colour included.
- A patch is applied only to the content state it belongs to: the history is bound to the document version its entries apply to, and the action applying an entry must carry that version and that entry. Size checks come on top of this, never instead of it: same-size patches would otherwise fit any state of the image, and a crop any image containing its rectangle.

Phase 3 Step 9: a Delete's entry also records the edge amounts it was made with. Adjusting the last Delete (see Edge Cleanup, Re-applying the Last Delete) replaces that entry in place rather than adding one: the same number of entries, the same encoded selections, a new patch. Only the next Undo, with nothing to redo, can be replaced, and the history is recounted against its limits (a larger patch can drop the oldest entries; the Delete itself is always kept).

---

## Performance

Normal screenshots and 4K images should remain practical to edit.

Expensive operations should be benchmarked.

Potential future performance tools:

- Web Workers
- OffscreenCanvas
- Typed arrays
- Chunked processing

Do not introduce these until profiling demonstrates a need.

Phase 3 Step 8: edge cleanup and feathering add to Delete's time in proportion to the edge length, not the image size: at 4K about 0.1 s more at 1 px and up to about 0.35 s more at 5 / 5; near 50 MP on an edge-dense image 0.5–0.7 s more at cleanup 1, 0.9–1.2 s at 5, and 1.7–2.1 s more at 5 / 5 (Chrome and Firefox; a flat 50 MP background: at most about 0.35 s more). Undo and Redo times do not change. Work is done in strips of 256 rows, so scratch memory (about 25–95 MB at 50 MP besides Delete's copy) follows the image width. Details: `IMPLEMENTATION_PLAN.md`, Phase 3 Step 8.

Phase 3 Step 9: adjusting the last Delete with other edge amounts recomputes it synchronously from the image before it and takes about as long as a Delete with those amounts (plus up to about 0.2 s at 50 MP to rebuild that image and decode the selection); nothing is computed while a slider is dragged or a key held. Details: `IMPLEMENTATION_PLAN.md`, Phase 3 Step 9.

Phase 3 (P3-D11): pixel edits start synchronous on the main thread, like Phase 2 selection work, and are measured at 4K and 50 MP before anything else is decided. Measured in Step 6 (Delete Selection above): about 0.1 s at 4K in both browsers, about 0.5–0.65 s for a Delete and 0.23–0.33 s for Undo or Redo near 50 MP. Whether large images need a progress indication or a Worker is an open owner decision (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 6). Copy-on-write buffers can be handed to a Web Worker later without changing the algorithms. How the display image is rebuilt after an edit (P3-D10) was verified in Phase 3 Step 4: synchronously through `OffscreenCanvas` (see Display Images), 13–15 ms at 4K and 77 ms at 50 MP in Chrome, 23–26 ms and 138 ms in Firefox.

---

## Testing

Important algorithms should have automated tests.

Priority test areas:

- Colour distance
- Flood fill
- Contiguous Magic Wand
- Global selection
- Add selection
- Subtract selection
- Invert selection
- Grow
- Shrink
- Delete to transparency
- Auto Trim bounds
- Auto Trim padding
- Crop calculations
- Rotation
- Flip
- Colour replacement
- History behaviour

Use small deterministic fixture images for algorithm tests.

Do not require human visual inspection for every correctness test.

Visual testing should supplement automated tests.

---

## SVG Input

SVG import should render the SVG into the raster workspace at an appropriate resolution.

The raster size is the SVG's intrinsic size, falling back to its `viewBox`. See "SVG Sizing" in `FEATURE_SPEC.md`. SVGs without a usable size are rejected rather than given an assumed size.

Imported SVGs are untrusted. They are rendered only through an image element from a local object URL, never inserted into the application DOM, and never allowed to load remote resources. Validation is conservative: unsupported content is rejected, not sanitised. SVGs are rejected if they contain:

- Scripts, event handlers, `foreignObject`, HTML content or embedded web content.
- A DOCTYPE declaration or entity definition. This is checked in the raw markup before parsing, so entity expansion never reaches the XML parser.
- External stylesheets, links or resource references, including hyperlinks, in `href`/`xlink:href` attributes, CSS `url()` (in attributes and stylesheets), `@import` and `image-set()`.
- Nested SVG data (`data:image/svg+xml`), which would bypass these checks.
- CSS escape sequences in style and presentation attributes or stylesheets, which could disguise a reference.

Only same-document references (`#id`) and embedded PNG, JPEG, WebP and GIF data URLs are allowed.

The application does not initially preserve SVG objects as editable vectors.

---

## Experimental SVG Output

Raster-to-vector conversion belongs to a later experimental phase.

It should be isolated from core raster editing architecture.

A specialised tracing library may be considered rather than building a vector tracer from scratch.

Any such dependency requires review before being added.
