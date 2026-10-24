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
- The selection model keeps no persistent full-image buffers other than masks: the current selection and, for tolerance re-apply, the selection as it was before the last Magic Wand operation.
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

Near the 50-megapixel limit the main thread can block noticeably. How to respond (time-slicing on the main thread or a Web Worker) is an open owner decision, to be made with real images at the Step 7 checkpoint.

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
