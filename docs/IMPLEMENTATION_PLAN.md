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
