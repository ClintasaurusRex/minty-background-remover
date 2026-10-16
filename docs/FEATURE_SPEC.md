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

---

## 2. Image Workspace

The workspace should:

- Display the current image.
- Display transparency using a checkerboard pattern.
- Centre images initially.
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

Zoom should affect only viewport presentation.

It must not alter the underlying image dimensions.

---

## 4. Pan

Pan behaviour:

```text
Hold Space + drag
```

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
