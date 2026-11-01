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

Near the 50-megapixel limit the main thread can block noticeably. How to respond (time-slicing on the main thread or a Web Worker) is an open owner decision, to be made with real images at the Step 7 checkpoint.

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

---

## Delete Selection

For selected pixels:

```text
alpha = 0
```

RGB values may remain internally unchanged because fully transparent RGB values are visually irrelevant.

The operation must be undoable.

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

Potential techniques may include:

- Small alpha erosion
- Neighbour-aware cleanup
- Background-colour decontamination

Do not implement an overly complex edge-matting system without clear need.

---

## Feathering

Feathering softens the edge by varying alpha.

Default:

```text
0 px
```

Because many target assets are technical or flat graphics, crisp edges are preferred.

Feathering should be optional.

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

### Fully Transparent Image

If no visible pixels are found, Auto Trim must not create invalid dimensions.

The UI should inform the user that there is nothing visible to trim.

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
