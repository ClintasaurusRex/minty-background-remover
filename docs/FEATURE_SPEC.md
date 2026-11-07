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

Only image data on the clipboard is used; HTML and links that come with an image copied from a web page are ignored, so pasting never fetches anything. A paste into a text field is left to that field. Pressing Ctrl + V elsewhere with no supported image on the clipboard shows a short informational notice, and does not cancel an import already in progress. Pasted images are named from the time of pasting and their detected format, for example `pasted-image-2026-10-22-143005.png`.

If several files are dropped at once, the first supported image is opened and the user is told that the others were ignored.

Only drags that carry files highlight the workspace and open an image. Dropping text, links, or a file anywhere outside the workspace is refused (except into a text field), so the browser cannot navigate away from the app. Dropped folders are skipped and counted as ignored; a drop of only folders shows an error but does not cancel an import already in progress.

When imports overlap (file picker, drop and paste in any combination), the most recent action that has image data wins.

Opening a new image replaces the current one without confirmation while the open image has no pixel edits. Replacing it discards its edits and its Undo / Redo history; a failed import keeps both.

Approved for Phase 3 (P3-D12): when the open image has unsaved pixel edits, the user is warned before another image replaces it. As implemented (Phase 3 Step 6; export does not exist yet, so the edits are called unexported):

- The image has unexported edits when an edit is applied and not undone: each edit and Redo counts one, each Undo takes one away, without comparing images. Undoing every edit returns the image to the file as opened, so there is nothing to lose (even with edits left to redo). The first image of a session and an unedited image are never asked about.
- The question comes just before another image would replace the edited one, the same way for the file picker, drop and paste, and only when there is an image to open (not for a cancelled picker, an empty clipboard or a drop with nothing usable).
- A dialog titled "Discard unexported edits?" explains that opening the image (named, or "the pasted image") will replace the current one and discard its edits and Undo history, with Cancel (the default, also Escape) and Continue.
- Cancel keeps the image, its edits and its history. Continue opens the new image; if that import fails, the edited image and its history stay.
- One question at a time: while it is open, other images arriving are not opened and the editing shortcuts do nothing.
- While another image is opening, Delete, Undo and Redo are unavailable, so no edit can be made between the decision and the replacement.

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
- Place every image, including the first one of a session, exactly as Fit would: the first image makes the Magic Wand options row appear above the workspace, and the image is placed again for the smaller workspace that leaves (Phase 2 Step 12). Later window resizes keep the image's centre and zoom.
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

Trackpad scrolling pans on both axes. Space only starts panning when focus is not on a control such as a button, so Space still presses buttons; clicking the workspace moves focus there. Releasing Space ends a drag even if the mouse button is still held. Panning stops when only 64 CSS pixels of the image (or all of it, if smaller) remain inside the workspace, so the image cannot be lost; if a zoom or window resize would leave none of the image visible, it is brought back to that margin.

Panning must not alter image pixels.

---

## 5. Magic Wand

The Magic Wand is a primary tool.

It becomes the active tool automatically when an image is successfully opened.

### Default Mode

Contiguous selection.

When the user clicks a pixel:

1. Read the clicked pixel's colour.
2. Compare each candidate pixel with the clicked pixel's colour (not with its neighbour, which would let the selection creep along gradients).
3. Include pixels within tolerance.
4. Continue only through pixels connected to the clicked pixel by their four edge neighbours (up, down, left, right). Diagonal contact alone does not connect.

This should behave similarly to traditional flood-fill Magic Wand tools.

Clicks outside the image do nothing.

### Tolerance

Tolerance should use an intuitive user-facing range:

```text
0 - 100
```

Initial default:

```text
20
```

The colour-distance formula is defined in `IMAGE_PROCESSING_SPEC.md` (Colour Distance). The default and the formula are initial choices, to be confirmed with automated tests and real images.

Changing the tolerance re-applies the most recent Magic Wand operation with the new value, including its New / Add / Subtract mode, against the selection as it was before that operation. The recalculation happens when the slider interaction finishes or a typed value is committed, not on every slider movement.

The operation is re-applied as it was made: the clicked pixel, Contiguous or Global, and the mode actually used (including a Shift or Ctrl override), whatever options are chosen later. Every re-apply starts again from the selection before that click, so repeated changes never add or subtract cumulatively: the result is always what one click at the latest tolerance would have produced. There is nothing to re-apply before the first click, after Select All, Clear, Invert, Grow or Shrink, or after another image is opened; a failed import keeps it. The details of when an adjustment counts as finished are in `UI_UX_SPEC.md` (Magic Wand UX).

The tolerance is not remembered between application sessions.

### Global Mode

A visible **Contiguous / Global** toggle switches between:

```text
Contiguous
```

and:

```text
Global
```

Global mode searches the entire image for sufficiently similar colours, whether or not they are connected to the clicked pixel.

---

## 6. Selection Visualisation

Selections should be clearly visible.

Approved direction:

- Mint-coloured selection tint, initially about 35% opacity (adjusted after visual testing if necessary).
- High-contrast two-tone selection boundary that stays visible over light and dark images.
- Marching ants are optional and must respect reduced-motion preferences.

The overlay is drawn on a separate canvas layer aligned exactly with the image.

Visual selection effects must not modify the image pixels themselves.

The overlay shows the current selection however it was made (Contiguous or Global; New, Add or Subtract; Select All) and disappears when the selection is cleared. Separate regions and holes each get their own boundary. Zoom, pan, window resizing and changes of display scaling redraw it in place; they never change the selection. Its appearance is specified in `UI_UX_SPEC.md` (Selection UX).

Marching ants (Step 11): the boundary's black and white pattern moves slowly along it, while the tint and the selection stay still. It is static when reduced motion is requested, and pauses when nothing is selected, no boundary is in view, the page is hidden, or the boundary in view is too large to repaint cheaply (`UI_UX_SPEC.md`, Selection UX). There is no user setting for it.

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

Approved interaction model:

```text
Click         = new selection
Shift + Click = add to selection
Ctrl + Click  = subtract from selection
Ctrl + A      = select all
Esc           = clear selection
```

Visible **New / Add / Subtract** controls provide the same modes, so modifier keys are never required. Alt is not used as a selection modifier (several Linux desktops reserve Alt + drag for moving windows). Global mode comes from its own toggle, not from a modifier.

Modifier policy for Magic Wand clicks, in priority order:

1. Ctrl (or ⌘ Command) held: Subtract, even when Shift is also held.
2. Shift held: Add.
3. Neither: the mode chosen in the editor (New by default).

Alt held with a click has no effect on the mode. Only the primary mouse button uses the Magic Wand; other buttons do nothing. While Space is held, or a Space + drag pan is in progress, presses pan and never select.

Ctrl + A and Escape work wherever keyboard focus is, except in text fields and editable content, where they keep their usual meaning. Without an open image they are left to the browser. Select All when everything is already selected, and Escape with no selection, change nothing.

Grow and Shrink move the selection edge by one pixel per action, including diagonal neighbours. When shrinking, the area outside the image counts as selected, so a selection touching the image border is not pulled away from it.

Selections persist when changing tools and are cleared when a different image is successfully opened. A failed import keeps the current selection.

Further selection shortcuts (for example Invert or Deselect key combinations) are deferred to the planned keyboard shortcut work.

Selection changes are not undoable in Phase 2. They should eventually support Undo / Redo; the selection representation must not prevent an efficient history later.

Approved for Phase 3 (P3-D7): Undo / Redo covers image edits, not individual selection changes. Undoing an edit restores the selection from just before that edit (see §8 and §21).

---

## 8. Delete Selection

Pressing:

```text
Delete
```

should set selected pixels to transparent.

A visible **Delete Selection** action should also be available.

Deleting pixels must be undoable.

Approved for Phase 3:

- Delete sets the alpha of every selected pixel to 0 and keeps its RGB values internally, hidden, so that Undo stays compact (P3-D2). Hidden colour must never become visible again in the editor, and export (Phase 6) writes fully transparent pixels as 0, 0, 0, 0, so deleted content never leaves the application.
- Unselected pixels are never changed by Delete itself; edge cleanup and feathering (§9) are the only exceptions, and both default to 0 px.
- Delete needs a selection, and clears the selection when it is done. Undo restores both the pixels and the selection from before the Delete (P3-D3).
- Delete behaves the same for every source format (PNG, JPEG, WebP, SVG): all images are edited as 8-bit RGBA, so transparency can be added to a JPEG as to a PNG.
- The Delete key is ignored while a text field has focus and does not repeat when held (P3-D9).

As implemented (Phase 3 Step 6; details in `IMPLEMENTATION_PLAN.md`):

- Delete (the key) and the Delete Selection control in the Magic Wand options row make every selected pixel fully transparent at once, as one undoable step. The image keeps its size, the view does not move, and the selection and the Magic Wand click that made it are cleared.
- When every selected pixel is already transparent, nothing changes: no Undo step, the selection stays, and this is announced.
- Delete is available whenever something is selected and no other image is opening.
- Exact deletion only: edge cleanup and feathering come later in Phase 3.

As implemented (Phase 3 Step 8): Delete applies the Edge cleanup and Feather amounts set beside it (§9) to the edge it leaves, in the same single Undo step. With both at 0, the default, Delete is exactly as above.

---

## 9. Edge Cleanup

After background deletion, the user may adjust the visible object's edge.

Possible settings:

```text
Cleanup: 0 - 5 px
Feather: 0 - 5 px
```

Initial desired behaviour:

- Cleanup available, but 0 px by default (owner decision, Phase 3).
- Conservative cleanup.
- Crisp edge priority.
- Feather default: 0 px.

Edge cleanup should avoid aggressively eroding legitimate image details.

Approved for Phase 3:

- Cleanup and feathering both default to 0 px, so fine lines and anti-aliasing in 2D technical graphics are never changed unless the user asks (P3-D4). With both at 0, Delete changes only selected pixels.
- The cleanup algorithm is not decided. It is chosen after a prototype comparison on representative images (Phase 3 Step 7; P3-D5). Whether cleanup and feathering run as part of Delete or as a separate action is decided with it.

Decided after the Step 7 comparison (owner): background-colour decontamination (Candidate B), run as part of Delete Selection with one history entry; Edge cleanup 0–5 px and Feather 0–5 px, both 0 by default.

As implemented (Phase 3 Step 8; details in `IMAGE_PROCESSING_SPEC.md` and `IMPLEMENTATION_PLAN.md`):

- Two controls beside Delete Selection, "Edge cleanup" and "Feather", each 0–5 px in whole pixels. They set what the next Delete does: changing them never changes the image by itself. (Since Phase 3 Step 9, a finished change right after a Delete also updates that Delete; see below.)
- Edge cleanup removes the deleted background's colour from the unselected edge pixels up to that many pixels in: their alpha is lowered and their colour corrected, so the edge looks right over any background. Pixels it cannot explain as a blend of the object and the background are left alone. 1 px suits screenshots, icons and vector art; 2–4 px soft photographs.
- Feather fades the object's edge inward over that many pixels. Lines, wiring, small text and other features up to about 3–4 px across are never feathered, and every shape keeps its middle at full strength; thicker shapes' edges fade, outlines included.
- Neither ever restores deleted pixels, grows the object, raises alpha or shows deleted colour; the image border and transparency already in the image are never treated as deleted background.
- Delete, cleanup and feathering are one edit: one Undo step restores every pixel exactly, and Redo repeats it.
- Limits: colour flattened onto the background in the file cannot be recovered; cleanup trusts the selection (a selection that leaked into the object makes the damage larger); at larger amounts a solid grey part next to a dark outline can be taken for a blend. Near 50 megapixels Delete with these amounts can take one to a few seconds.
- The amounts are kept for the session, like the Magic Wand options.

As implemented (Phase 3 Step 9, re-applying the last Delete; details in `IMPLEMENTATION_PLAN.md`):

- Right after Delete Selection (and after Redo of one), while nothing has been selected since, a finished change of Edge cleanup or Feather updates that Delete: it is made again with the amounts now set, as if it had been made with them. The user can try amounts without Undo, reselecting and Delete.
- A change is finished when the slider is released, the last arrow, Page, Home or End key is released, Enter is pressed, or focus leaves the control, as for the tolerance. Dragging or holding a key computes nothing until then; typing applies on Enter; Escape cancels. Only an actual change counts: moving through the controls, or changing an amount and back before finishing, never updates the Delete, even when the amounts shown differ from the result's (after Redo).
- Every update starts again from the image as it was before the Delete and the selection it deleted, never from the previous result, so updating any number of times gives exactly what one Delete with the final amounts gives, and returning to earlier amounts gives exactly the earlier result (0 / 0: the exact Delete).
- It stays one edit: one Undo restores the image as it was before the Delete, with its selection and Magic Wand click; Redo restores the latest result. No Undo steps are added, and nothing else in the history changes.
- Once anything is selected (a Magic Wand click, Select All, Invert, Grow, Shrink, including a selection cleared again), after Undo, after another edit, and while another image opens or the replace confirmation is open, the amounts only set the next Delete again. Magic Wand options never update a Delete.
- The update is announced, for example "Delete Selection updated with Edge cleanup 2 px and Feather 1 px: 1,204 edge pixels were cleaned up or feathered." The tooltips of the two controls say whether they set the next Delete or are updating the last one, and while they would update it the status bar shows "Edge settings update last Delete".
- Near 50 megapixels an update takes about as long as the Delete itself with those amounts (one to a few seconds on edge-dense images), and the page pauses meanwhile, as for Delete.

---

## 10. Auto Trim

Auto Trim finds the bounding rectangle around visible pixels.

Pixels should generally count as visible when their alpha value is above the configured transparency threshold.

Approved for Phase 3 (P3-D6): Auto Trim finds visible bounds from alpha alone and supports adjustable padding. The threshold value, how padding behaves at the image edge, and what happens to the selection and the view are confirmed when Auto Trim is implemented (Phase 3 Step 10).

The tool should determine:

```text
minimum X
maximum X
minimum Y
maximum Y
```

for visible content.

The canvas is then reduced to those bounds plus padding.

Algorithm implemented in Phase 3 Step 10, not yet available in the application (the tool is Step 11). The threshold and the edge behaviour below are provisional until the owner confirms P3-D6:

- Visible means alpha of 1 or more (threshold 0), so faint anti-aliasing, feathered edges, 1-pixel lines and soft shadows are never cut off. Colour hidden under fully transparent pixels by Delete never counts.
- One faint stray pixel far from the content therefore keeps that side from being trimmed.
- Padding keeps up to that many pixels of the image on each side, each side stopping at the image's edge. Auto Trim never makes the image larger and never adds pixels: content touching an edge gets no padding on that side.
- Every kept pixel stays exactly as it was. Nothing is resampled, blurred, recoloured or scaled.
- A fully transparent image has nothing visible to trim. An image whose content with its padding already reaches every edge (for example one already trimmed) has nothing to trim. Neither changes the image or adds an Undo step.
- An Auto Trim is one Undo step. Undo restores the original size and every pixel exactly; Redo trims again.
- Still open for Step 11: whether a threshold is ever offered, the range for custom padding, and the selection and view after a trim.

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
Ctrl + Z         = Undo
Ctrl + Y         = Redo
Ctrl + Shift + Z = Redo (alternative, approved for Phase 3, P3-D9)
```

Visible toolbar actions are required.

History must be bounded.

The implementation should account for memory usage when handling large images.

Approved for Phase 3:

- History holds image edits only (P3-D7): Delete (with any cleanup or feathering) and Auto Trim, and later pixel tools. Selection changes are not entries; undoing an edit restores the selection from just before it, and the Magic Wand click that made it can again be re-applied with a new tolerance.
- A new edit clears Redo. Opening another image clears the history; a failed import keeps it.
- Limits (P3-D8): at most 25 entries and 256 MB of history data. The oldest entries are dropped first. The newest entry is always kept, even when it alone exceeds 256 MB, so the last edit can always be undone.
- Undo and Redo shortcuts keep their text-editing meaning in text fields.

Phase 3 Step 5 implements the history in the editor state; Step 6 connects it to the Undo and Redo controls and shortcuts, with Delete Selection as the first edit. As implemented: Undo restores the pixels, the selection and the Magic Wand click (re-applicable with a new tolerance) from just before the edit; Redo restores the pixels and the selection the edit left (none after Delete). Both replace whatever is selected at the time. An edit, Undo or Redo that fails (for example for lack of memory) changes nothing and shows a message saying so. Undo and Redo name the edit they would apply ("Undo Delete Selection"), are unavailable while another image is opening, and repeat while their keys are held.

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
