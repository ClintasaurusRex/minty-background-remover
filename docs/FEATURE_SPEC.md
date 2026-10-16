# Minty Background Remover Feature Specification

This document defines the expected behaviour of major product features.

`PROJECT_BRIEF.md` remains the highest-level source of truth.

---

## 1. Image Import

### Required Formats

The application should support:

- PNG
- JPG
- JPEG
- WebP
- SVG

SVG files are imported into the raster editing workspace.

SVG import does not need to preserve editable vector structure.

### Import Methods

#### File Picker

A visible **Open Image** action.

#### Drag and Drop

The user may drag an image directly into the editor.

#### Clipboard

The user may paste an image using:

```text
Ctrl + V
```

when image data exists in the clipboard.

If several files are dropped at once, the first supported image is opened and the user is told that the others were ignored.

Opening a new image replaces the current one without confirmation during Phase 1.

### Format Detection

The file format is identified from the file's content (its signature), not from its name or MIME type. A file whose content is not PNG, JPEG, WebP or SVG is rejected even if its name or type claims otherwise.

### Import Limits

Approved Phase 1 limits:

```text
Maximum file size:   50 MB (52,428,800 bytes)
Maximum dimension:   16,384 px per side
Maximum image area:  50 megapixels (50,000,000 px)
```

Dimensions are checked before the application allocates its full-resolution pixel buffer. PNG and WebP dimensions, and usually JPEG dimensions, are read from the file header before decoding, which prevents most oversized decodes. This does not fully bound memory: browser decoding itself allocates image memory, and when a JPEG's header cannot be inspected the file is decoded first and its size checked afterwards, so an oversized JPEG of that kind is fully decoded before it is rejected.

### SVG Sizing

SVGs are rasterised at their intrinsic size:

1. Absolute `width` and `height` (px, unitless, or physical units at 96 px per inch).
2. If only one side is absolute, the other follows the `viewBox` aspect ratio.
3. If neither is absolute (missing or relative, such as `100%`), the `viewBox` size is used.

An SVG with no usable size is rejected with a clear message. No default size is assumed.

A sizing dialog is deferred.

### Import Errors

Import failures are shown in a dismissible message in the workspace. A failed import keeps the current image.

A PNG that does not end with an `IEND` chunk is treated as truncated and rejected; some browsers would otherwise show the missing part as transparent. An image that is read successfully but cannot be prepared for display (for example, when memory runs out) is reported as a failed import, so a blank image is never shown as opened.

---

## 2. Image Workspace

The workspace should:

- Display the current image.
- Display transparency using a checkerboard pattern.
- Centre images initially.
- Initially fit images larger than the viewport; show smaller images at 100%.
- Support zooming.
- Support panning.
- Handle images larger than the viewport.
- Avoid modifying the image simply by displaying it.

---

## 3. Zoom

Required controls:

- Ctrl + mouse wheel
- Zoom In
- Zoom Out
- Fit to Screen
- 100%

The current zoom percentage should be visible.

Zoom range: 1% to 3200%.

Fit to Screen does not upscale images beyond 100%.

Ctrl + mouse wheel zooms around the pointer. Keyboard zoom shortcuts are deferred to avoid conflicts with browser zoom.

Ctrl + mouse wheel (and trackpad pinch) zooms the image only while the pointer is over the workspace and an image is open; elsewhere, browser zoom is unaffected. Zoom In and Zoom Out step through fixed zoom levels about the workspace centre, and 100% also zooms about the workspace centre.

Images are rendered with nearest-neighbour sampling at 100% and above, and smooth downscaling below 100%.

Zoom should affect only viewport presentation.

It must not alter the underlying image dimensions.

---

## 4. Pan

Pan behaviour:

```text
Hold Space + drag
```

The mouse wheel without Ctrl pans vertically; Shift + mouse wheel pans horizontally.

Panning must not alter image pixels.

---

## 5. Magic Wand

The Magic Wand is a primary tool.

### Default Mode

Contiguous selection.

When the user clicks a pixel:

1. Read the pixel colour.
2. Compare neighbouring pixels.
3. Include neighbouring pixels within tolerance.
4. Continue through connected matching pixels.

This should behave similarly to traditional flood-fill Magic Wand tools.

### Tolerance

Tolerance should use an intuitive user-facing range:

```text
0 - 100
```

The internal colour-distance algorithm may use a different representation.

Initial recommended default:

```text
20
```

The final default may be adjusted based on testing.

### Global Mode

The user may switch from:

```text
Contiguous
```

to:

```text
Global
```

Global mode searches the entire image for sufficiently similar colours.

---

## 6. Selection Visualisation

Selections should be clearly visible.

Preferred direction:

- Semi-transparent selection overlay
- Selection boundary
- Marching-ants-style edge if practical

Visual selection effects must not modify the image pixels themselves.

---

## 7. Selection Operations

Required operations:

- New selection
- Add to selection
- Subtract from selection
- Select All
- Clear Selection
- Invert Selection
- Grow Selection
- Shrink Selection

Suggested interaction model:

```text
Click = new selection
Shift + Click = add
Alt + Click = subtract
Ctrl + A = select all
Esc = clear selection
```

Exact modifiers may be adjusted for platform compatibility.

---

## 8. Delete Selection

Pressing:

```text
Delete
```

should set selected pixels to transparent.

A visible **Delete Selection** action should also be available.

Deleting pixels must be undoable.

---

## 9. Edge Cleanup

After background deletion, the user may adjust the visible object's edge.

Possible settings:

```text
Cleanup: 0 - 5 px
Feather: 0 - 5 px
```

Initial desired behaviour:

- Cleanup enabled by default.
- Conservative cleanup.
- Crisp edge priority.
- Initial cleanup target: approximately 1 px.
- Feather default: 0.

Edge cleanup should avoid aggressively eroding legitimate image details.

---

## 10. Auto Trim

Auto Trim finds the bounding rectangle around visible pixels.

Pixels should generally count as visible when their alpha value is above the configured transparency threshold.

The tool should determine:

```text
minimum X
maximum X
minimum Y
maximum Y
```

for visible content.

The canvas is then reduced to those bounds plus padding.

### Padding

Required options:

```text
0 px
5 px
10 px
20 px
Custom
```

Default:

```text
5 px
```

### Trim Tight

A shortcut/action may immediately trim with:

```text
0 px padding
```

---

## 11. Manual Crop

Crop workflow:

1. Activate Crop.
2. Click and drag.
3. Display crop rectangle.
4. Darken outside area.
5. Allow adjustment using handles.
6. Show current width/height.
7. Press Enter to apply.
8. Press Escape to cancel.

Applying crop must be undoable.

Aspect ratio presets are not required initially.

---

## 12. Eyedropper

The Eyedropper reads a pixel's colour.

Display useful values including:

```text
HEX
RGBA
```

The selected colour may be used by Replace Colour.

---

## 13. Replace Colour

Replace Colour should allow the user to define:

```text
Source colour
Replacement colour
Tolerance
```

The colour picker should open as a compact popover/window.

The user should also be able to manually enter HEX colour values.

### Shading Preservation

A future/advanced Replace Colour mode should preserve the original image's relative shading and highlights.

Example:

A grey shaded object replaced with blue should retain:

- Dark areas
- Midtones
- Highlights

rather than becoming a single flat blue shape.

The exact algorithm should be designed and tested separately.

---

## 14. Resize Image

Resize should support:

- Width
- Height
- Maintain aspect ratio

Resampling should use a suitable high-quality browser-supported technique.

Resize changes actual image dimensions.

---

## 15. Rotate

Required:

- Rotate 90° clockwise
- Rotate 90° counter-clockwise

Optional later:

- 180° shortcut

---

## 16. Flip

Required:

- Flip horizontal
- Flip vertical

---

## 17. Brightness and Contrast

Provide simple image adjustments for:

- Brightness
- Contrast

Adjustments should have:

- Preview
- Apply
- Cancel or Reset

Applying adjustments must be undoable.

---

## 18. Grayscale

The user may convert the image to grayscale.

The operation must be undoable.

---

## 19. Solid Background

The user may place a solid colour behind transparent pixels.

This should be useful when exporting formats such as JPEG.

The user should choose the background colour.

---

## 20. Outline / Stroke

A simple outline may be added around visible image content.

Possible settings:

- Colour
- Width

This is a secondary feature and should not complicate early phases.

---

## 21. Undo and Redo

Required shortcuts:

```text
Ctrl + Z = Undo
Ctrl + Y = Redo
```

Visible toolbar actions are required.

History must be bounded.

The implementation should account for memory usage when handling large images.

---

## 22. Export

Supported formats:

- PNG
- JPEG
- WebP

PNG should preserve alpha transparency.

JPEG does not support transparency, so transparent pixels must be handled intentionally.

### Suggested Filename

Example:

```text
pump-station.png
```

may export as:

```text
pump-station-cleaned.png
```

The application should protect the original source file from accidental overwrite.

---

## 23. Clipboard Export

The user should eventually be able to copy the resulting image directly to the clipboard.

---

## 24. SVG Vectorisation

Status:

```text
Experimental / Later Phase
```

Expected workflow:

```text
Raster image
→ cleanup
→ reduce unnecessary background
→ vector trace
→ preview
→ SVG export
```

Vectorisation should be positioned as most appropriate for:

- Icons
- Technical graphics
- Logos
- Flat artwork
- Limited-colour graphics

It should not be represented as lossless conversion of photographs.

---

## 25. Explicitly Out of Scope

Unless future requirements change, Minty Background Remover does not need:

- Painting brushes
- Pencil tool
- Layers system
- Text layout editor
- Shape drawing suite
- Photo library
- Cloud sync
- Collaboration
- Accounts
- Social sharing
- Generative AI
- Filters marketplace
- Plugin marketplace
- Full Photoshop-style editing
