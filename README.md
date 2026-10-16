# Minty Background Remover

A focused image-cleanup application for removing backgrounds, trimming transparent space, cropping images, changing colours, and preparing graphics for use elsewhere.

Minty Background Remover is intentionally designed to do a small number of image-editing tasks well rather than becoming a full graphics editor.

---

## Project Status

Early development.

The current project is being built incrementally using React, Vite, TypeScript, and Canvas 2D.

---

## Planned Core Workflow

```text
Open Image
    ↓
Magic Wand
    ↓
Select Background
    ↓
Delete Background
    ↓
Clean Edges
    ↓
Auto Trim
    ↓
Crop / Recolour if Needed
    ↓
Export
```

---

## Planned Features

### Background Removal

- Paint.NET-style Magic Wand
- Adjustable tolerance
- Contiguous selection
- Global colour selection
- Add/subtract selection
- Invert selection
- Grow/shrink selection
- Delete to transparency
- Edge cleanup
- Optional feathering

### Image Preparation

- Auto Trim transparent space
- Adjustable trim padding
- Manual crop
- Eyedropper
- Replace Colour
- Colour picker
- Resize
- Rotate
- Flip
- Brightness
- Contrast
- Grayscale
- Background colour
- Outline/stroke

### Import

Planned:

- PNG
- JPEG/JPG
- WebP
- SVG
- Drag and drop
- Clipboard paste

### Export

Planned:

- PNG
- JPEG
- WebP
- Copy to clipboard

---

## Privacy

Minty Background Remover is designed around local processing.

Images should not be uploaded to remote servers.

The project currently requires:

- No account
- No login
- No cloud storage
- No analytics
- No tracking
- No remote image processing

---

## Technology

```text
React
Vite
TypeScript
Plain CSS
Canvas 2D
Vitest
```

A future desktop version is planned using Tauri.

Primary desktop targets:

- Linux
- Windows

---

## Development Approach

The project is developed in clearly defined phases.

Major image-processing features are tested independently from the React UI where practical.

Claude Code is currently the primary implementation agent, with project planning, prompts, and review handled by the project owner and ChatGPT.

The project owner alone performs Git commits, pushes, merges, rebases, force-pushes, and other Git history changes unless explicitly stated otherwise.

---

## Project Documentation

The source-of-truth documentation is:

- [`docs/PROJECT_BRIEF.md`](docs/PROJECT_BRIEF.md) — highest-level project requirements and scope
- [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md) — detailed feature expectations
- [`docs/UI_UX_SPEC.md`](docs/UI_UX_SPEC.md) — UI and interaction direction
- [`docs/IMAGE_PROCESSING_SPEC.md`](docs/IMAGE_PROCESSING_SPEC.md) — pixel-processing and algorithm expectations
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — technical architecture
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phased development roadmap
- [`docs/AGENTS.md`](docs/AGENTS.md) — mandatory rules for coding agents

If documentation conflicts, `docs/PROJECT_BRIEF.md` takes precedence unless the project owner explicitly overrides it.

---

## Development Roadmap

High-level phases:

- Phase 0 — Project foundation
- Phase 1 — Image workspace
- Phase 2 — Selection system and Magic Wand
- Phase 3 — Background removal and cleanup
- Phase 4 — Crop and colour tools
- Phase 5 — Image utility tools
- Phase 6 — Export and workflow polish
- Phase 7 — Tauri desktop application
- Phase 8 — Experimental SVG vectorisation

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for details.

---

## Experimental SVG Vectorisation

A later experimental phase may provide raster-to-vector SVG tracing for suitable assets such as:

- Icons
- Logos
- HMI graphics
- Technical drawings
- Flat illustrations
- Limited-colour images

This will not be treated as perfect photographic vector conversion.

---

## Scope

Minty Background Remover is not intended to replace Photoshop, GIMP, Paint.NET, or other full image editors.

Its focus is:

- Background removal
- Image cleanup
- Cropping
- Colour adjustment
- Asset preparation
- Export

Features outside that purpose should generally remain out of scope.

---

## License

The project is intended to be public.

A final open-source license should be selected before the first public release. MIT is a likely candidate, but licensing should be confirmed by the project owner before release.
