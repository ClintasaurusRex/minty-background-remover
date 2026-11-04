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
├── canvas/selectionOverlayRenderer.ts  the only overlay drawing code (tile cache, canvas,
│                          boundary pattern changes)
├── canvas/marchingAnts.ts       when the marching ants step: timing, reduced motion, page
│                          visibility, cost budget (pure; injected clock)
├── components/Workspace/SelectionOverlayCanvas.tsx  the overlay canvas over the image canvas;
│                          connects the renderer and the ants to the browser
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
- Marching ants (Step 11) run outside React: no state changes, renders or effects per step. `canvas/marchingAnts.ts` decides when a step is due (a timer, then one animation frame) and calls the renderer's `setPattern`; the component only creates both, feeds them the `prefers-reduced-motion` media query and `visibilitychange`, and disposes them on unmount, so a remount (React Strict Mode) never leaves a second loop running.
- A boundary pattern change never rasterises again or reads the selection. When a tile is rasterised it keeps where its boundary is (`OverlayBoundary`: one bit per device pixel for "boundary" and one for "selected", only for the rows and 32-pixel columns holding boundary pixels, at most 16 KB a tile). A step repaints only the boundary area of the visible tiles that have one: once a tile's area pixels are kept, a step flips the quarter of its boundary pixels where the stripes move, uploads the area to the tile canvas (`putImageData` with a dirty rectangle) and copies just that area to the overlay canvas. Tiles without boundary (inside or outside the selection) and the tint are never touched, and the number of canvas calls per step is three per visible boundary tile, however many edges the selection has.
- Tiles kept out of view are brought up to date when they come back into view; new tiles are rasterised in the current phase.
- Both canvases skip a frame identical to the last one they drew (Step 12). The overlay renderer compares the selection and the tile placement; `workspaceRenderer` compares the bitmap and the frame plan (`sameFramePlan` in `canvas/rendering.ts`). React renders that do not move the view (a click, a selection action, an option, every tolerance slider movement) therefore never draw the image again.
- The first image of a session makes the Magic Wand active, so the options row appears above the workspace in the same commit and the workspace shrinks just after the image was placed. That import sets `placeOnNextResize`, and the resize it causes places the image again (`initialViewport`) instead of keeping its centre; any change of view clears it. Later images find the row already shown (Step 12).

#### Final Phase 2 data flow

```text
pointer / key / button
  → selectionCommands (pure; Magic Wand, combine, grow / shrink / invert computed here,
    tagged with the document version)
  → editorReducer (accepts or discards: version, size, recorded operation, Add / Subtract base)
  → App render
      → ImageCanvas → workspaceRenderer (skips unchanged frames)
      → SelectionOverlayCanvas → planSelectionOverlay → selectionOverlayRenderer (tiles,
        boundary geometry) ← marchingAnts (timer → frame → setPattern, outside React)
      → StatusBar (count, bounds, announcement), ToolOptions (availability, tolerance)
```

Everything is synchronous on the main thread; no Web Workers (see Web Workers).

#### Test coverage (end of Phase 2)

Vitest, Node environment, 706 tests in 39 files. Pixel algorithms are tested against character-map fixtures (`image/selection/testFixtures.ts`) and brute-force references: colour distance boundaries; Contiguous and Global wands (four-connectivity, narrow and winding one-pixel corridors, large images without recursion, a breadth-first reference on random images); combine, invert, grow and shrink; the mask builder. Editor state, commands and tolerance input are tested as pure reducers and functions, including stale-version, replay and placement cases. The overlay rasteriser is compared with a per-pixel reference rasteriser over a range of zoom levels, line widths and tiles, at every marching-ants phase, and both renderers run against fake canvases that count drawing calls. Components are rendered to static markup. Browser behaviour (hit-testing against what the browser draws, the overlay against a fresh render, timing, memory) is checked with headless Chrome and Firefox scripts kept outside the repository (see `IMAGE_PROCESSING_SPEC.md`, Final Phase 2 Measurements). Since Phase 3 Step 4 a maintained subset is in `scripts/browser/`.

### Phase 3 Modules

Phase 3 adds pixel edits (Delete Selection, edge cleanup, Auto Trim) with Undo / Redo. Decisions P3-D1–D12 are recorded in `IMPLEMENTATION_PLAN.md` (Phase 3) and the feature and processing specifications.

Step 1 (pixel buffers and revisions):

```text
src/
├── editor/types.ts        PixelBuffer (width, height, read-only RGBA bytes); ImageDocument.pixels
│                          is a PixelBuffer, and `revision` identifies its pixel content
├── image/pixelBuffer.ts   validatePixelBuffer, createPixelBuffer, copyPixelData,
│                          sharesPixelMemory (pure; no canvas, no ImageData)
├── editor/imageDocument.ts  createImageDocument (revision 0), createEditedDocument (same id,
│                          new pixels, new revision; rejects pixels sharing the current memory)
└── canvas/imageData.ts    toImageData: a PixelBuffer as ImageData for canvas APIs, without
                           copying (decoded ImageData is passed through)
```

Step 2 (Delete Selection algorithm):

```text
src/
└── image/edit/deleteSelection.ts  deleteSelectedPixels: alpha 0 for every selected pixel, colour
                                   kept hidden; one copy of the image, only when a pixel changes;
                                   returns the new pixels, count and bounds of the change, or null
                                   (pure; not yet called by the application)
```

Step 3 (history building blocks):

```text
src/editor/history/
├── wordRuns.ts        run-length encoding of 32-bit pixel values (SKIP / FILL / LITERAL tokens;
│                      alpha-only literals kept as one byte), validation, decoder
├── pixelPatch.ts      createPixelPatch (old XOR new over a region, or null), applyPixelPatch
│                      (the same patch undoes and redoes)
├── cropPatch.ts       cropPixels, createCropPatch (removed pixels in row order), restoreCroppedPixels
├── selectionCodec.ts  encodeSelection / decodeSelection (varint row runs or packed bits)
├── historyBytes.ts    retainedBytes: distinct buffers plus object estimates
└── geometry.ts        rectangle and dimension validation
```

Contract for the Undo / Redo history, which Step 5 implements on these without changing them:

- An entry holds one patch (`PixelPatch` for same-size edits, `CropPatch` for crops), the selection from before the edit (`EncodedSelection | null`, plus the recorded Magic Wand click with its own `base` mask encoded) and the selection after it. It never holds a pixel buffer, a document, a revision number or an `ImageBitmap`.
- Undo of a pixel patch: `applyPixelPatch(current.pixels, patch)`; Redo: the same call on the pixels Undo produced. Undo of a crop: `restoreCroppedPixels(current.pixels, patch)`; Redo: `cropPixels(current.pixels, patch.kept)`. Each result becomes a new revision through `createEditedDocument`, the selection comes back through `decodeSelection`, and the restored Magic Wand click is rebound to the new version.
- All of this is pixel work, done in commands outside the reducer. The reducer only checks the version and that the entry is the one on top.
- The history's size is `retainedBytes` over the payloads of all its entries, so anything shared between entries is counted once.

Step 4 (display image and renderer invalidation):

```text
src/canvas/
├── displayImage.ts       createDisplayImage: a document's pixels as a drawable image, synchronously
│                         (OffscreenCanvas → transferToImageBitmap, or a canvas element where that is
│                         unavailable; both kept in main memory); releaseDisplayImage,
│                         isReleasedDisplayImage, displayContentKey (document id and revision),
│                         createDisplayImageOwner (releases an image once another is shown)
├── workspaceRenderer.ts  render(plan, { image, key }), invalidate(), redraw on contextrestored
└── selectionOverlayRenderer.ts  also redraws on contextrestored, with new tiles

scripts/browser/          manual browser checks, outside npm test (README.md there): rendering
                          smoke test, opt-in GPU process crash test, display-image bench
```

Who holds what:

| Resource | Held by | Released |
| --- | --- | --- |
| The current display image (`documentBitmap`) | The editor state | By `ImageCanvas` (its `createDisplayImageOwner`), after the commit that replaces it, once the replacement is drawn |
| A display image a command has created but not dispatched | The command | By the command, if it is stale or anything fails (Step 5's history commands create it last, so nothing fails after it) |
| A display image whose action the reducer rejected, or that was replaced before it was drawn | Nobody | Garbage collection; from Step 6, released by the dispatcher once the action is committed and the image is not current (see Step 5) |
| Edit history (patches and encoded selections; no images or pixel buffers) | The editor state (`history`) | Garbage collection, when entries are dropped by the limits, Redo is cleared by a new edit, or another image opens |
| An import's bitmap that lost to a newer import | The import runner | Closed by the runner |
| Image canvas backing store and checkerboard pattern | `workspaceRenderer` (one per `ImageCanvas` mount) | `dispose()` in the effect clean-up; the pattern is remade on restoration |
| Overlay backing store, tile canvases and pixel buffers | `selectionOverlayRenderer` (one per `SelectionOverlayCanvas` mount) | When the selection is cleared, the zoom, ratio or selection changes, tiles leave the kept area, on restoration, and on `dispose()` |
| Marching-ants timers | `marchingAnts` (one per overlay mount) | `dispose()` |

Ownership of display images (for the edit commands of Steps 5 and 6):

- `createDisplayImage` returns an image only its caller holds. A command creates it synchronously in its event handler, right after the edited document, never in a reducer or state updater (React Strict Mode runs those twice), and dispatches both in one action, so the canvas never shows the pixels of another revision. Before dispatching, the command checks that its result is still current (the document version it was computed from is still the open one, as the reducer will check); if it is not, or anything fails after creation, the command releases the image itself. If creation fails, nothing stays allocated and the current document and image stay.
- Once the editor has accepted it, the editor state holds it and `ImageCanvas` releases it: it draws the new image and only then releases the one it replaced. Nothing is released in effect clean-ups, which React Strict Mode runs while the image is still shown, and the renderer never releases images. A remounted `ImageCanvas` gets a new owner, which takes over the image shown.
- The canvas releases only images it has shown. An image whose action the reducer rejects after dispatch, or that a later action in the same commit replaces, is not released explicitly: only the committed state tells whether it is in use (React can process a queued action against another state than the command saw), so an earlier release could blank the canvas. Garbage collection frees it; commands keep the case rare by checking currency just before dispatching.
- Display images are never kept in history or reused for another revision, and no state may bring back an image that an earlier state replaced (it may have been released). Undo and Redo create a new one with the new revision.

Step 5 (edit history in the editor state; not yet called by the application):

```text
src/editor/
├── history/historyEntry.ts  HistoryEntry: edit kind, patch, the encoded selection before and after
│                            the edit, the Magic Wand click before it (its previous selection
│                            encoded); createHistoryEntry (each mask encoded once and shared),
│                            restoreSelectionBefore / restoreSelectionAfter (new masks)
├── history/editHistory.ts   EditHistory: limits, the version it is bound to, Undo and Redo stacks,
│                            retained bytes; recordEdit / recordUndo / recordRedo, nextUndo / nextRedo,
│                            clearEditHistory (pure and cheap; runs in the reducer)
├── historyCommands.ts       completedEditCommand, undoCommand, redoCommand (patches, selections, the
│                            new revision and, last, its display image, outside the reducer);
│                            availableHistoryActions
└── editorState.ts           history and editError; edit-applied, edit-undone, edit-redone, edit-failed,
                             edit-error-dismissed; documentBitmap is a DisplayImage
```

- The history is bound to the document version its stacks apply to, and every accepted edit, Undo and Redo rebinds it in the same reducer step. Revisions are never reused, so an entry can only meet the pixels it was made for; a history bound to any other version offers nothing.
- Edit, Undo and Redo actions carry the version they were computed from, the new document and its display image; Undo and Redo also carry the entry they applied, which must still be the next one, and an edit the selection and Magic Wand click it was computed with (identity). The reducer also requires a newer revision of the same image with its own pixel memory, and matching patch, image and selection sizes. A rejected action returns the state itself.
- Versions only move forward, so a rejected action is rejected by every later state. Step 6 relies on this to release a rejected action's display image: dispatch inside `flushSync`, then release the image unless the committed state holds it (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 5).
- Undo restores the selection and Magic Wand click from before the edit, the click bound to the new version; Redo restores the selection the edit left, with no click.
- Limits: 25 entries and 256 MiB over both stacks (`retainedBytes`, shared payloads once), oldest dropped first, newest always kept. A new edit clears Redo; selection changes never touch the history; a successful import clears it and a failed one keeps it.

Planned for later steps (subject to review at each step): `image/edit/` (edge band, cleanup, feather), `image/trim/autoTrim.ts`, `editor/editCommands.ts` (Delete Selection, using `completedEditCommand`) and the edit and Undo / Redo controls and shortcuts.

Key rules:

- Copy-on-write: a document's pixel buffer is never written. An edit writes a copy, and `createEditedDocument` makes a new document from it; the previous document is unchanged. Pixel work (copying, editing, building history patches) runs in commands outside the reducer, as selection work does; the reducer only accepts or discards a finished result. Creating a document is constant time.
- `ImageDocument.revision` comes from one session-wide counter: an opened image is revision 0, and every later content state, including an Undo or Redo, gets a revision never given out before. Results computed outside the reducer are tagged with `documentVersion()` and discarded for any other version, so work computed before an edit, Undo or Redo is never applied after it.
- Undo restores earlier pixels as a new revision. The selection and the Magic Wand click recorded before the edit are restored with it, and the click's `version` is rebound to the new revision; a stale version is never restored.
- Pixels become `ImageData` only at the canvas boundary (`toImageData`). Pixel algorithms take and return `PixelBuffer`s, so they run in Node tests and could move to a Web Worker unchanged.
- Edited pixels reach the screen only through a new display image (`createDisplayImage`, Step 4): writing pixel memory never changes what the canvas shows, because `workspaceRenderer` draws from the display image, its own copy. Imports still create theirs with `createImageBitmap`; both show the same bytes.
- `workspaceRenderer` skips a frame only when the display image, the content key (`displayContentKey`: document id and revision) and the frame plan all equal the last frame drawn. A new revision is therefore always drawn, even with the same image object, and so is a new image. `invalidate()` forces the next frame to be drawn; nothing needs it yet.
- When the browser restores a lost 2D context (after a GPU process restart), both renderers draw their last frame again at once, without waiting for user action. The workspace renderer makes a new checkerboard pattern: one made before the loss made every later draw produce nothing in Chrome. The overlay renderer drops all its tiles, which come back blank, and rasterises the visible ones again in the current boundary pattern, as a zoom change does. Display images are kept in main memory (`willReadFrequently`), because GPU-backed images lose their pixels when the GPU process restarts. Neither renderer cancels `contextlost`, which would stop the restoration.

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

Phase 3 pixel edits also start synchronous (P3-D11) and are measured at 4K and 50 MP. Copy-on-write buffers are what a later move to a Worker would need: a Worker can receive a copy of the pixels and return a new buffer without touching the document.

---

## Error Boundaries

Unexpected UI errors should eventually be handled gracefully.

Image-processing failures should not silently corrupt the working document.

---

## Git Architecture Rules

Agents may inspect Git.

Agents must not modify repository history or create commits unless explicitly authorised by the project owner.

See `AGENTS.md`.
