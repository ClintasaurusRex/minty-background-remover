# Minty Background Remover

## Project Status

Early development.

The project is currently being established and should be built incrementally in clearly defined phases.

---

## Project Summary

Minty Background Remover is a focused image-cleanup application designed around a small number of common image-preparation tasks.

Its primary purpose is to make it fast and easy to:

1. Open an image.
2. Select a background using a Paint.NET-style Magic Wand.
3. Delete the selected background to transparency.
4. Clean up the resulting edges.
5. Remove unnecessary transparent space around the image.
6. Crop manually when needed.
7. Replace or adjust image colours.
8. Perform a small set of useful image adjustments.
9. Export the cleaned image.

The application is intentionally **not** intended to become a full graphics editor such as:

- Photoshop
- GIMP
- Paint.NET
- Affinity Photo

The project should remain focused on image cleanup and asset preparation.

---

## Product Name

**Minty Background Remover**

The project may eventually be released publicly and is being developed as a public GitHub project.

---

## Primary Use Case

A typical workflow looks like:

```text
Take screenshot
    ↓
Open or drag image into Minty Background Remover
    ↓
Select background using Magic Wand
    ↓
Adjust selection tolerance if necessary
    ↓
Delete background
    ↓
Clean up edges
    ↓
Auto Trim transparent space
    ↓
Optionally crop manually
    ↓
Optionally recolour or adjust image
    ↓
Export transparent PNG
```

The application should make this workflow fast and predictable.

---

## Core Product Philosophy

Minty Background Remover should be:

- Focused
- Fast
- Predictable
- Easy to understand
- Local-first
- Privacy-friendly
- Keyboard-friendly
- Mouse-friendly
- Suitable for technical graphics and screenshots
- Useful without requiring an account or internet connection

The application should favour a small number of excellent tools over a large number of mediocre tools.

---

## Platforms

### Initial Platform

Web application.

The initial implementation uses:

- React
- Vite
- TypeScript
- Plain CSS
- HTML Canvas / Canvas 2D

### Future Desktop Platform

The same frontend should later be packaged with Tauri.

Target desktop platforms:

- Linux
- Windows

macOS compatibility is welcome if it comes naturally from the architecture, but it is not currently a primary requirement.

The web application must remain usable independently of the desktop version.

---

## Privacy

Minty Background Remover is a local image-processing tool.

Images must not be uploaded to a remote server.

The project must not introduce:

- User accounts
- Authentication
- Cloud image storage
- Remote image processing
- Analytics
- Tracking
- Telemetry
- Advertising
- AI APIs
- External image-processing APIs

without explicit approval from the project owner.

All image processing should happen locally.

---

## Core Features

The core application is expected to support:

- PNG import
- JPEG/JPG import
- WebP import
- SVG import into the raster workspace
- Drag-and-drop image opening
- File picker
- Clipboard image paste
- Transparency checkerboard
- Zoom
- Pan
- Magic Wand selection
- Adjustable colour tolerance
- Contiguous selection
- Optional global similar-colour selection
- Add to selection
- Subtract from selection
- Select all
- Invert selection
- Grow selection
- Shrink selection
- Delete selection to transparency
- Edge cleanup
- Optional edge feathering
- Manual crop
- Automatic transparent-space trimming
- Adjustable trim padding
- Eyedropper
- Replace Colour
- Colour picker popover/window
- Resize image
- Rotate image
- Flip image
- Brightness adjustment
- Contrast adjustment
- Grayscale
- Solid background option
- Image outline/stroke
- Undo
- Redo
- PNG export
- JPEG export
- WebP export
- Copy image to clipboard
- Keyboard shortcuts
- Accessibility support

Not all features should be implemented at once.

The project must be developed in phases.

---

## Magic Wand Behaviour

The Magic Wand is one of the most important features in the application.

Its behaviour should feel familiar to users of Paint.NET.

Default behaviour:

- Select contiguous pixels similar to the clicked pixel.
- Use adjustable colour tolerance.
- Display selection visually.
- Allow deletion of the selected region.
- Allow adding and subtracting from selections.

A Global Selection mode should also exist for selecting similar colours throughout the entire image rather than only contiguous regions.

Initial recommended user-facing tolerance default:

```text
20 / 100
```

This may be adjusted after testing.

---

## Background Removal

Background removal is intentionally manual.

The project does not currently require AI-powered automatic background removal.

The user should be able to:

1. Select the unwanted background.
2. Preview the selection.
3. Delete it.
4. Adjust edges if necessary.

The Delete keyboard key should remove selected pixels by setting them transparent.

A visible Delete Selection action should also be provided.

---

## Edge Cleanup

Background removal should support optional edge cleanup.

Initial direction:

- Edge cleanup enabled by default.
- Crisp results prioritised.
- Conservative default cleanup amount.
- Initial default cleanup target: approximately 1 px.
- Feathering should exist but default to 0 px.

The application is expected to work well with:

- Technical graphics
- Icons
- HMI graphics
- Equipment images
- Screenshots
- Flat-colour graphics
- Logos

Sharp edges are therefore often more desirable than heavily feathered photographic edges.

---

## Auto Trim

Auto Trim removes unnecessary transparent canvas space surrounding visible content.

Expected behaviour:

- Detect the outer bounds of non-transparent pixels.
- Trim all four sides independently.
- Support adjustable padding.
- Default padding: 5 px.
- Quick padding options should include:

```text
0 px
5 px
10 px
20 px
```

A custom padding value should also be possible.

A one-click **Trim Tight** action may use 0 px padding.

---

## Crop

The manual crop tool should support:

- Click-and-drag crop rectangle.
- Darkened area outside the crop.
- Resizable crop handles.
- Live crop width and height.
- Enter to confirm.
- Escape to cancel.

Aspect-ratio presets are not required for the initial implementation.

---

## Colour Tools

The application should support a dedicated Replace Colour workflow.

Expected tools:

- Eyedropper
- Original colour
- Replacement colour
- Colour picker
- HEX input
- RGBA/alpha-aware colour handling

The user should be able to open a small colour picker interface and select the desired replacement colour.

Colour replacement should eventually support preserving original shading where appropriate rather than forcing every pixel to an identical flat colour.

---

## Canvas Navigation

Expected behaviour:

- Ctrl + mouse wheel zoom
- Space + drag to pan
- Zoom in button
- Zoom out button
- Fit to Screen
- 100% zoom
- Visible zoom percentage

The canvas should remain usable on:

- Standard laptop displays
- Large desktop displays
- Ultrawide monitors

---

## Undo and Redo

Keyboard shortcuts:

```text
Ctrl + Z = Undo
Ctrl + Y = Redo
```

Visible toolbar controls should also exist.

Undo history must be memory-aware.

The application must **not** indefinitely store full-resolution ImageData snapshots for every action.

A practical history limit and/or more efficient history representation should be used.

An initial target of approximately 25 history entries is acceptable, subject to memory constraints.

---

## Export

Primary export format:

- PNG

Additional formats:

- JPEG
- WebP

PNG should preserve transparency.

The original source file should not be overwritten automatically.

Default export naming may follow this pattern:

```text
original-name-cleaned.png
```

The application should eventually support:

- Save As
- Copy Image to Clipboard
- Remember last export directory in the desktop application

---

## Additional Image Tools

Planned secondary tools include:

- Resize
- Rotate 90°
- Flip horizontal
- Flip vertical
- Brightness
- Contrast
- Grayscale
- Solid background
- Outline/stroke

These must not distract from the main background-removal workflow.

---

## Experimental SVG Export

Raster-to-vector SVG conversion is desirable but is **not** part of the critical initial feature set.

The feature should be treated as experimental.

It may be especially useful for:

- Technical graphics
- Icons
- Logos
- HMI assets
- Flat illustrations
- Limited-colour images

It should not be marketed as perfect photographic vectorisation.

This feature should be implemented only after the core editor is stable.

---

## UI Direction

The interface should be:

- Dark
- Modern
- Clean
- Focused
- Original

It should not visually copy Paint.NET.

Primary tools should use:

- Icons
- Visible text labels
- Shortcut hints where useful

The image workspace should occupy most of the available screen.

The main editing tools should be presented through a clear toolbar.

Touch-specific design is not required.

Mouse and keyboard are the primary input methods.

---

## Development Style

Development is agent-assisted.

Claude Code is currently the primary implementation agent.

ChatGPT and the project owner will:

- Define requirements
- Prepare implementation prompts
- Review Claude's work
- Identify corrections
- Control scope
- Review architecture decisions
- Review testing results

Claude should implement only the currently assigned phase.

---

## Git Ownership

The project owner alone performs Git write operations.

Agents must **not**:

- Commit
- Push
- Merge
- Rebase
- Force-push
- Delete branches
- Rewrite Git history

unless explicitly instructed otherwise by the project owner.

Agents may inspect Git status, Git diff, Git log, and branches.

---

## Source of Truth

This file is the highest-level source of truth for the project.

If another project document conflicts with `PROJECT_BRIEF.md`, this file takes precedence.

More detailed specifications are located in:

- `FEATURE_SPEC.md`
- `UI_UX_SPEC.md`
- `IMAGE_PROCESSING_SPEC.md`
- `ARCHITECTURE.md`
- `IMPLEMENTATION_PLAN.md`
- `AGENTS.md`

Agents must read the relevant documentation before making changes.

---

## Scope Rule

Do not expand Minty Background Remover into a general-purpose graphics editor.

When a proposed feature does not directly support:

- Background removal
- Image cleanup
- Cropping
- Colour adjustment
- Asset preparation
- Export

it should normally be considered out of scope.
