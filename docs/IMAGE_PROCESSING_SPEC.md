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

### Contiguous Mode

Recommended algorithm family:

```text
Flood Fill
```

Potential implementation approaches include:

- Queue-based breadth-first traversal
- Stack-based traversal
- Scanline flood fill

Avoid deeply recursive implementations because large images may overflow the JavaScript call stack.

### Selection Mask

Selections should be represented independently from pixel colour data.

A practical representation may be:

```text
Uint8Array
```

where each entry represents whether the corresponding pixel is selected.

Example:

```text
0 = not selected
1 = selected
```

Alternative efficient representations may be considered if justified.

---

## Colour Distance

The user-facing tolerance should be intuitive.

An initial implementation may compare channels using RGB/RGBA distance.

Example concept:

```text
distance = difference between clicked colour and candidate colour
```

The exact formula should be documented in code and covered by tests.

A later implementation may use a perceptual colour space if testing demonstrates significant benefit.

Do not prematurely complicate the first implementation.

---

## Transparency During Selection

Alpha differences should be considered carefully.

Transparent pixels should not unexpectedly match opaque colours simply because RGB channels happen to contain similar values.

---

## Global Colour Selection

Global mode evaluates all pixels rather than only connected neighbours.

For each pixel:

```text
if colourDistance(pixel, target) <= tolerance
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

---

## Invert Selection

For each selection mask value:

```text
0 → 1
1 → 0
```

---

## Grow Selection

Grow expands selection outward by a specified radius.

Possible implementation:

- Morphological dilation
- Neighbour-based expansion

Initial radius may be:

```text
1 px
```

with repeated application or adjustable control.

---

## Shrink Selection

Shrink removes boundary pixels.

Possible implementation:

- Morphological erosion

Care must be taken around image edges.

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
