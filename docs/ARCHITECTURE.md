# Minty Background Remover Architecture

`PROJECT_BRIEF.md` is the highest-level source of truth.

---

## Technology Stack

Initial stack:

```text
React
Vite
TypeScript
Plain CSS
HTML Canvas 2D
Vitest
```

Future desktop packaging:

```text
Tauri
```

---

## Architecture Goals

The architecture should:

- Keep image-processing logic independent from React where practical.
- Remain understandable.
- Avoid unnecessary dependencies.
- Support both web and future desktop builds.
- Keep all image processing local.
- Allow algorithm testing without rendering React components.
- Remain responsive with modern images.
- Avoid premature abstraction.

---

## Application Layers

Preferred conceptual structure:

```text
UI Layer
    ↓
Editor State / Commands
    ↓
Image Processing Functions
    ↓
Canvas / ImageData
```

React components should primarily manage:

- UI
- Tool state
- User interactions
- Presentation
- Command invocation

Pixel algorithms should not depend heavily on React.

---

## Suggested Source Structure

This structure is directional rather than mandatory.

```text
src/
├── app/
│   ├── App.tsx
│   └── app.css
│
├── components/
│   ├── Toolbar/
│   ├── Workspace/
│   ├── ToolOptions/
│   ├── ColorPicker/
│   └── StatusBar/
│
├── editor/
│   ├── types.ts
│   ├── editorState.ts
│   ├── commands/
│   └── history/
│
├── image/
│   ├── selection/
│   ├── crop/
│   ├── trim/
│   ├── colour/
│   ├── transforms/
│   └── export/
│
├── canvas/
│   ├── viewport.ts
│   ├── coordinates.ts
│   └── rendering.ts
│
├── hooks/
│
├── utils/
│
└── test/
```

Do not create directories merely because they appear here.

Create structure when functionality requires it.

### Phase 1 Modules

```text
src/
├── app/            App, useImageImport (picker, drop, paste wiring), clipboardPaste
├── components/     AppHeader, Toolbar, StatusBar, Workspace (canvas, messages, input hooks)
├── editor/         editorState (reducer), importRunner, importSources, panGesture, dropTarget
├── canvas/         coordinates, viewport, devicePixels, rendering (frame plans),
│                   workspaceRenderer (the only Canvas 2D drawing), wheelZoom, pan
├── image/import/   formats, limits, headerDimensions, svgSize, svgSafety, pngEnding,
│                   importImage (orchestration), browserDecoder (the only decoding DOM code)
└── utils/          domTargets
```

Key rules:

- Viewport maths is in CSS pixels; the device pixel ratio is applied only at the rendering boundary.
- Rendering and pointer hit-testing both use `displayViewport()` (the stored viewport snapped to device pixels), so they always agree.
- Pointer hit-testing (`pixelUnderPointer`) finds the device pixel the pointer is in and tests its centre, where the canvas samples the image. Mouse positions lie on device pixel edges, so a 0.01 device pixel tolerance absorbs browser rounding of DOM coordinates. An image pixel edge passing exactly through a device pixel centre is given to the left / upper pixel, as Firefox and Chrome usually draw it.
- Every import goes through `importImage` and the import runner. The newest action that has image data wins, and a failed import never replaces the open image.
- Interaction logic (pan gesture, drop target, import ordering) is written as pure functions with Node tests; React hooks only connect them to DOM events.

### Phase 2 Modules

```text
src/
├── editor/types.ts        SelectionMask (empty selection = null), FloodMode, SelectionMode
├── editor/editorState.ts  active tool, Magic Wand settings, the current selection and the last
│                          Magic Wand operation (for tolerance re-apply)
├── editor/selectionCommands.ts  click modifier policy, Magic Wand click and its re-apply on a
│                          committed tolerance, selection actions (Select All, Clear, Invert,
│                          Grow, Shrink) and their availability, Ctrl + A / Esc recognition
│                          (pure; pixel work outside the reducer)
├── app/useSelectionShortcuts.ts, app/pointerPosition.ts (pointer readout store)
├── editor/toleranceInput.ts     typed tolerance: exact (applied while typing), committed (rounded,
│                          clamped), keyboard steps; the clamp the reducer also uses; when a
│                          slider or text field adjustment is finished (pure event handling)
├── components/Toolbar/ToolOptions.tsx, MagicWandOptions.tsx  contextual second toolbar row
├── canvas/selectionOverlay.ts  overlay tile plans and rasterising (pure; typed arrays only)
├── canvas/selectionOverlayRenderer.ts  the only overlay drawing code (tile cache, canvas)
├── components/Workspace/SelectionOverlayCanvas.tsx  the overlay canvas over the image canvas
└── image/selection/       selectionMask (builder: validates, counts, bounds),
                           colourDistance (alpha-aware distance, tolerance threshold),
                           magicWand (Contiguous scanline fill, Global pass),
                           selectionOperations (New / Add / Subtract, Select All, Invert),
                           growShrink (one-pixel 3 × 3 Grow and Shrink),
                           testFixtures (character-map masks and images for tests)
```

Later Phase 2 steps add colour distance, the Magic Wand, combine / invert / grow / shrink, reducer state and the selection overlay. Key rules:

- Selection algorithms are pure functions over plain width / height / data inputs, independent of React, the DOM and Canvas.
- Masks are immutable; the editor state holds one reference to the current mask.
- Selections are computed outside the reducer and applied with `selection-applied`, tagged with the document version (`documentVersion()`: document id and revision) they were computed from. The reducer discards a result for any other version, or one whose size differs from the document's, so a late result can never land on a different image.
- A successful import clears the selection and activates the Magic Wand; a failed, rejected or superseded import changes neither. Magic Wand settings last for the session. Zoom, pan and workspace resizing never touch the selection.
- A Magic Wand click is applied with `magic-wand-applied`, which also records it as `lastMagicWandOperation`: the document version, the clicked pixel, Contiguous or Global, the New / Add / Subtract mode actually used, the selection from before the click (null for New) and the tolerance of the current result. A committed tolerance re-applies it with `magic-wand-reapplied`, computed in `selectionCommands` from the recorded operation, never from the current selection, so re-applies never accumulate. The reducer accepts a re-applied result only while its operation is still the recorded one and its version is the open document's; an Add or Subtract click only while its recorded selection is still the current one. Every other selection change (`selection-applied`, `selection-cleared`) and a successful import forget the operation.
- The tolerance controls change the tolerance on every movement but commit it only when an adjustment is finished (`toleranceInput.ts`); only a commit re-applies. The slider's commit is the native `change` event (React's `onChange` reports every movement), key releases and leaving the slider.
- Magic Wand clicks are computed synchronously in the pointer-down handler from the latest committed state, then dispatched. Panning takes priority: `useSpacePan` passes a press to the tool only when Space is not held and no drag is in progress. Only presses directly on the canvas count.
- The pointer position for the status bar lives in a small external store read with `useSyncExternalStore`, so pointer movement re-renders only the readout, never the image canvas.
- The selection overlay is a separate canvas layer aligned with the image renderer, using the same transform. `workspaceRenderer` remains the only image drawing code; the overlay gets its own renderer.
- The overlay canvas has the image canvas's size and backing store and is planned from the same display viewport, so the image's top-left corner falls on the same device pixel in both. It never reads or writes image pixels, and with `pointer-events: none` every pointer, wheel and drop event still reaches the image canvas.
- Which image pixel a device pixel shows is decided by `imageIndexAtDevicePixel` (`canvas/coordinates.ts`), the same rule as `pixelUnderPointer`; tests check that the two agree at every device pixel, so the overlay marks exactly the pixels a click would pick. Below 100% (in device pixels) a device pixel shows the selection when any image pixel it covers is selected (`imageSpanAtDevicePixel`).
- The overlay is rasterised in plain typed arrays at device-pixel resolution, only where it can be seen, in 256 × 256 device-pixel tiles counted from the image's top-left corner. No full-resolution RGBA overlay is ever allocated, and tiles away from the selection's bounds are never created. Tiles are kept while the selection, zoom and device pixel ratio stay the same, so panning only rasterises tiles coming into view; tiles more than one tile out of view are released. With no selection the overlay canvas has no backing store.
- Drawing a frame is one `drawImage` per visible tile, whatever the selection's shape. The boundary is found per device pixel with states packed 32 to a word, so its cost does not depend on how many edges the selection has.
- Planning and rasterising run in the overlay's layout effect, after the image is drawn in the same commit, never during React rendering.

---

## React Responsibilities

React should manage things such as:

- Active tool
- Tool options
- Dialog visibility
- Current zoom
- Current application state
- Toolbar state
- User feedback

React should not perform expensive per-pixel work directly during rendering.

---

## Canvas Responsibilities

Canvas is responsible for:

- Displaying raster image data
- Presenting zoomed image content
- Image rendering
- Selection visualisation where appropriate

Zoom and pan must remain separate from actual image dimensions.

---

## Image Processing

Image-processing modules should preferably expose pure or mostly pure functions.

Example:

```ts
magicWand(imageData, startPoint, options)
```

rather than:

```ts
magicWand(componentState, canvasElement, DOMEvent, ...)
```

This improves:

- Testing
- Maintainability
- Reuse
- Debugging

---

## TypeScript

Avoid unnecessary use of:

```ts
any
```

Important concepts should use explicit types.

Examples:

```ts
Point
Rectangle
RGBAColor
SelectionMask
ToolId
CropState
ViewportState
ImageDocument
HistoryEntry
```

---

## State Management

Do not add Redux, Zustand, MobX, or another external state library during early development without a demonstrated need.

Begin with appropriate React state, reducers, and plain TypeScript modules.

Introduce a state library only if application complexity clearly justifies it.

---

## CSS

Use plain CSS.

Do not add:

- Tailwind
- Bootstrap
- Material UI
- CSS-in-JS frameworks

unless the project owner explicitly changes this decision.

Use a maintainable CSS organisation with variables for recurring values.

Potential CSS variables include:

```css
--color-bg
--color-surface
--color-border
--color-text
--color-muted
--color-accent
--radius-sm
--radius-md
--space-sm
--space-md
```

---

## External Dependencies

Dependencies should be kept minimal.

Before adding a production dependency, consider:

1. Is this difficult to implement correctly ourselves?
2. Is the dependency actively maintained?
3. Is it lightweight enough?
4. Does it create lock-in?
5. Does it work in web and Tauri?
6. Does it respect local-only processing?

Examples of dependencies that may eventually be justified:

- Compact React colour picker
- SVG tracing library
- Tauri packages

The image editor should not become dependent on a large graphics framework without strong justification.

---

## Testing

Use Vitest for image algorithm unit tests.

React component testing may be added where useful.

Algorithms should be tested separately from UI.

---

## Desktop Architecture

The web application remains the core frontend.

Tauri should later wrap the same application.

Platform-specific desktop features may include:

- Native file dialogs
- Remembered file paths
- Native Save As
- Last export directory
- Application menu integration

Core image-processing algorithms must not depend on Tauri APIs.

---

## Browser Compatibility

Target modern evergreen browsers.

The application does not need to support obsolete browsers.

---

## Persistence

Initial web application should avoid unnecessary persistent storage.

Potential local preferences may eventually include:

- Last Magic Wand tolerance (not persisted yet; Phase 2 keeps it for the current session only)
- Last Auto Trim padding
- UI preferences

Browser storage may be used later for small preferences.

Images should not be permanently stored in browser storage by default.

---

## Security and Privacy

Do not transmit image contents.

Avoid remote scripts.

Avoid analytics.

Avoid dependencies that unexpectedly perform remote processing.

All file handling should remain local.

---

## Web Workers

Do not start with Web Workers unless needed.

When large image operations begin causing noticeable UI stalls, evaluate moving pure processing functions into workers.

The architecture should make that migration possible by keeping image algorithms independent of React.

Phase 2 selection algorithms start synchronous on the main thread. Performance is measured early in production browser builds; significant UI freezes are not acceptable. Workers are introduced only when profiling demonstrates the need and the project owner approves.

---

## Error Boundaries

Unexpected UI errors should eventually be handled gracefully.

Image-processing failures should not silently corrupt the working document.

---

## Git Architecture Rules

Agents may inspect Git.

Agents must not modify repository history or create commits unless explicitly authorised by the project owner.

See `AGENTS.md`.
