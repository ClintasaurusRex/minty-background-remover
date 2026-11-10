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
| A display image whose action the reducer rejected (an edit, Undo, Redo, or since Step 9 an adjusted Delete) | The dispatcher (`app/editDispatch.ts`, Step 6) | Released right after `flushSync` has committed the action, when the committed state does not hold it. (An image replaced before it was drawn cannot occur: each action is committed on its own.) |
| Edit history (patches and encoded selections; no images or pixel buffers) | The editor state (`history`) | Garbage collection, when entries are dropped by the limits, Redo is cleared by a new edit, or another image opens |
| An import's bitmap that lost to a newer import | The import runner | Closed by the runner |
| Image canvas backing store and checkerboard pattern | `workspaceRenderer` (one per `ImageCanvas` mount) | `dispose()` in the effect clean-up; the pattern is remade on restoration |
| Overlay backing store, tile canvases and pixel buffers | `selectionOverlayRenderer` (one per `SelectionOverlayCanvas` mount) | When the selection is cleared, the zoom, ratio or selection changes, tiles leave the kept area, on restoration, and on `dispose()` |
| Marching-ants timers | `marchingAnts` (one per overlay mount) | `dispose()` |

Ownership of display images (for the edit commands of Steps 5 and 6):

- `createDisplayImage` returns an image only its caller holds. A command creates it synchronously in its event handler, right after the edited document, never in a reducer or state updater (React Strict Mode runs those twice), and dispatches both in one action, so the canvas never shows the pixels of another revision. Before dispatching, the command checks that its result is still current (the document version it was computed from is still the open one, as the reducer will check); if it is not, or anything fails after creation, the command releases the image itself. If creation fails, nothing stays allocated and the current document and image stay.
- Once the editor has accepted it, the editor state holds it and `ImageCanvas` releases it: it draws the new image and only then releases the one it replaced. Nothing is released in effect clean-ups, which React Strict Mode runs while the image is still shown, and the renderer never releases images. A remounted `ImageCanvas` gets a new owner, which takes over the image shown.
- The canvas releases only images it has shown. An image whose action the reducer rejects is released by the code that dispatched it, once the action is committed and only the committed state can tell whether it is in use (Step 6: `dispatchEditAction` dispatches inside `flushSync`, then releases the image unless the committed state holds it). Releasing earlier could blank the canvas: React can process a queued action against another state than the command saw. Before Step 6 garbage collection freed such images.
- Display images are never kept in history or reused for another revision, and no state may bring back an image that an earlier state replaced (it may have been released). Undo and Redo create a new one with the new revision.

Step 5 (edit history in the editor state; called by the application from Step 6):

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

Step 6 (Delete Selection, Undo and Redo in the application; the replace confirmation):

```text
src/
├── editor/editCommands.ts         availableEditActions (constant time; nothing while an import runs), editActionCommand
│                                  (the one entry for Delete Selection, Undo and Redo), deleteSelectionCommand,
│                                  hasUnexportedEdits (editDepth), editShortcut
├── editor/editFeedback.ts         announcement and error texts
├── editor/replaceConfirmation.ts  the replace question as a store: confirmReplace for the import sources,
│                                  question / answer / subscribe for the dialog (useSyncExternalStore)
├── editor/importSources.ts        confirmReplace asked just before any source starts its import
├── editor/editorState.ts          editDepth, editNotice, editFeedbackId; edit-unchanged
├── app/editDispatch.ts            dispatchEditAction: flushSync, then release the image unless held
├── app/useEditCommands.ts         Delete / Ctrl + Z / Ctrl + Y / Ctrl + Shift + Z, and the controls' callback
├── app/useImageImport.ts          the confirmation; import-started committed at once (flushSync)
└── components/                    AppHeader (Undo / Redo), MagicWandOptions (Delete Selection),
                                   DiscardEditsDialog, Workspace/EditErrorMessage and the announcement region

scripts/browser/                   edit-workflow.mjs (the whole workflow, timings, memory),
                                   edit-ownership.mjs + edit-ownership/ (display images with real React)
```

- Every edit, Undo and Redo goes through `editActionCommand` (availability) and `dispatchEditAction` (commit and release). The command computes from the latest committed state (`stateRef`); `flushSync` commits the action, runs the canvas's layout effect (draw the new image, release the replaced one) and updates `stateRef` before the next input is handled, so actions are never computed from a stale state.
- The reducer's checks decide everything else, and it never accepts a released image (no size), so releasing a rejected action's image is safe even if React processes the action again. React 19 renders pending default- and continuous-priority updates in order inside `flushSync`; only transitions are processed again later, and editor actions must never be dispatched in a transition: a transition-priority selection change queued before a Delete would make React return to the image before the Delete, already released (`scripts/browser/edit-ownership.mjs` shows both).
- Availability rules that are not permanent (an import in progress) live in the commands, never in the reducer.
- `import-started` is committed at once, so edits are unavailable from the moment an import starts: together with the confirmation, no edit can slip in between the decision to replace the image and the replacement.

Step 8 (edge cleanup and feathering as part of Delete Selection):

```text
src/
├── image/edit/deleteSelection.ts  deleteSelectedPixelData: the Delete returning its still-writable copy
├── image/edit/deleteWithEdges.ts  deleteSelectionWithEdges: Delete, cleanup, feather on one copy; EdgeSettings
├── image/edit/edgeBand.ts         strips with a halo, the 32-bit seed scan, changed-bounds tracking
├── image/edit/edgeCleanup.ts      background-colour decontamination (Candidate B)
├── image/edit/feather.ts          inward feathering, thin features protected by local thickness
├── editor/editorState.ts          edgeSettings (0–5 px each, default 0), edge-settings-changed
├── editor/editCommands.ts         Delete uses the state's edge settings
└── components/Toolbar/MagicWandOptions.tsx  the Edge cleanup and Feather controls

scripts/browser/edge-cleanup.mjs   the controls, exact results against the algorithm run in Node
                                   (lib/source.mjs imports src/), Undo / Redo, Step 7 fixtures, timings
```

- The edge passes are pure (`PixelBuffer` and `SelectionMask` in, the edited copy out), so they run in Node tests and could move to a Worker with Delete. They write only the copy Delete made, before it becomes a document: copy-on-write is unchanged, and Delete with edges still makes exactly one image-sized copy.
- The patch region is the bounds of every changed pixel, so the existing XOR pixel patches record the colour and alpha changes; history, Undo, Redo, version checks and display-image ownership are unchanged.
- The amounts are editor state like the Magic Wand options: the reducer only stores them (rounded, clamped); the command reads them when Delete runs.

Step 9 (re-applying the last Delete when an edge amount changes):

```text
src/
├── editor/history/historyEntry.ts   edgeSettings in a Delete's entry; remadeHistoryEntry (same encoded
│                                    selections and click, new patch and amounts)
├── editor/history/editHistory.ts    replaceLatestEdit: the next Undo replaced in place (Redo must be empty)
├── editor/editorState.ts            adjustableEdit; the edit-adjusted action; mergeEdgeSettings
├── editor/editCommands.ts           adjustableDelete (constant time), adjustDeleteCommand
├── app/useEditCommands.ts           commitEdgeSettings: the amount, then the adjustment through
│                                    dispatchEditAction (never while the confirmation is open)
└── components/Toolbar/MagicWandOptions.tsx  the amount controls commit like the tolerance control

scripts/browser/edge-adjust.mjs      drags, held keys, typing, exact results against Node, Undo / Redo,
                                     when nothing may be adjusted, timings; lib/edges.mjs (shared with
                                     edge-cleanup.mjs)
```

- No pixel buffer is kept for this. The Delete's history entry already holds everything: its XOR patch applied backwards to the current pixels gives the pixels before the Delete exactly, its encoded selection the selection it deleted, and (new) the amounts it was made with. `adjustDeleteCommand` rebuilds the pixels before the Delete, runs `deleteSelectionWithEdges` on them with the new amounts, makes a patch between the two, a new revision and, last, its display image. Each adjustment starts from those pixels, never from the previous result.
- The entry is replaced, not added to: `remadeHistoryEntry` shares the old entry's encoded selections and click (never encoded again), and `replaceLatestEdit` puts it in the old entry's place, recounts the retained bytes (dropping the oldest entries if a larger patch exceeds the budget, never the Delete itself) and binds the history to the new version. Redo must be empty: a Redo entry's patch was made from the old result.
- `adjustableEdit` (editor state) names the Delete that can be adjusted. It is set when a Delete is applied, adjusted or redone, and forgotten by every selection change (click, re-apply, Select All, Clear, Invert, Grow, Shrink), Undo and another image; view changes, option and amount changes, announcements and failures keep it. `adjustableDelete` additionally requires it to be the history's next Undo for the open version, nothing to redo, nothing selected, no Magic Wand click and no import in progress; the reducer checks the same (except the import, a non-permanent availability rule kept in the commands) plus the usual version, new-content and size checks, so a stale adjustment is rejected permanently and its display image released by `dispatchEditAction`.
- The controls commit only actual changes (review correction): `finishAdjustment` compares a finished adjustment with the amount its interaction started from (focus, slider press, previous adjustment), kept per control in a ref; an unchanged finish only sets the amount (`edge-settings-changed`). `App` computes `adjustableDelete` once per render for the controls' tooltips and the status bar's `LastDeleteNote`.
- Committing an amount dispatches `edge-settings-changed` (always) and, unless the replace confirmation is open, the adjustment computed from the committed state with the full new amounts, inside `flushSync` like every edit. React 19 renders the queued amount change and the adjustment in order in that pass. The edit depth does not change.

Step 10 (Auto Trim algorithm; called by the Auto Trim tool since Step 11):

```text
src/image/trim/
└── autoTrim.ts   findVisibleBounds (alpha above a threshold, 0 by default; reads alpha bytes only,
                  never the content's inside), planAutoTrim ('nothing-visible' | 'unchanged' |
                  'crop' with the visible and kept rectangles; padding clipped at each edge),
                  autoTrimPixels (the plan plus the trimmed image, cut by cropPixels)
```

- Pure like the other pixel algorithms: `PixelBuffer` in, plain data or a new `PixelBuffer` out. Planning allocates nothing proportional to the image; only a crop allocates, exactly the kept size. The input is never written.
- The trimmed pixels come from `cropPixels` in `editor/history/cropPatch.ts`, so the edit, its Undo (`restoreCroppedPixels`) and its Redo (`cropPixels`) share one crop. It is the first module under `image/` to import from `editor/history/`; moving `cropPixels` to `image/` would be a separate refactor.
- A `crop` plan's `kept` rectangle is what the existing `CompletedCrop` takes, so Step 11 needs no new history type. `completedEditCommand` records the crop patch, makes the trimmed pixels, a new revision and its display image. The reducer, version binding, limits and display-image ownership are unchanged. A whole-image rectangle records nothing (`createCropPatch` returns null). `autoTrimHistory.test.ts` shows the round trips through the real commands and reducer.

Step 11 (the Auto Trim tool):

```text
src/
├── editor/autoTrimPadding.ts             the padding the tool offers: 5 by default, 0–50, presets
│                                         0 / 5 / 10 / 20, the field's range, clamping
├── editor/editCommands.ts                'auto-trim' edit action (availableEditActions.autoTrim),
│                                         autoTrimCommand
├── editor/editorState.ts                 autoTrimPadding (reset by each successful import),
│                                         auto-trim-padding-changed, the reason in edit-unchanged,
│                                         sizes and dropped Undo steps in the applied notice,
│                                         edit-notice-dismissed, Fit after a size change
├── editor/editFeedback.ts                Auto Trim texts; isShownEditNotice
├── components/Toolbar/AutoTrimOptions.tsx  the options row: Padding presets and field, Trim
├── components/Toolbar/ToolOptions.tsx    the row of the active tool
└── components/Workspace/EditNoticeMessage.tsx  outcomes shown as well as announced
scripts/browser/auto-trim.mjs             the tool in Chrome and Firefox; lib/gpu.mjs (shared with
                                          gpu-crash.mjs)
```

- No new history type, command path or ownership rule: `autoTrimCommand` calls `planAutoTrim` with the state's padding (threshold 0) and passes a `crop` plan's `kept` to `completedEditCommand`, which records the crop patch, crops once with `cropPixels`, makes the new revision and, last, its display image. `nothing-visible` and `unchanged` plans become `edit-unchanged` with the reason; an exception becomes `edit-failed`. It runs through `editActionCommand` and `dispatchEditAction` like Delete Selection (availability decided in the commands, `flushSync` dispatch, release of a rejected action's image).
- The reducer's checks are those of every edit. What is new there: a size change (Auto Trim, its Undo and Redo) fits the new image to the workspace, replacing the provisional crop view of Step 5; the applied notice carries the sizes before and after, and the number of older Undo steps `recordEdit` dropped to stay within the limits (counted for every edit, shown only for Auto Trim); `edit-notice-dismissed` hides a shown notice.
- The padding lives in the editor state, not in the control, so the command always computes with the padding the user sees; it is reset to 5 by each successful import and kept by a failed one. Nothing is persisted.
- `ToolOptions` shows the active tool's row. The Workspace shows notices that `isShownEditNotice` selects (Auto Trim with nothing to trim, a trim that dropped Undo steps) in its polite status region, and announces all other outcomes in the hidden one, so each outcome is announced once.

Step 12 (final quality assurance) changed no module. It added `src/editor/phase3Workflow.test.ts`, which runs the application's own commands together against a model of every content state: Delete Selection, edge adjustments, Auto Trim, Undo, Redo, selection changes and imports, with no-ops, stale replays and failures (`IMPLEMENTATION_PLAN.md`, Phase 3 Step 12).

### PNG Export Modules (brought forward from Phase 6, 2026-11-08)

```text
src/
├── image/export/pngEncoder.ts    encodePng(pixels, { yieldControl, sliceBytes }) → Promise<Blob>:
│                                 8-bit RGBA PNG, exact bytes, alpha 0 written as 0,0,0,0, adaptive
│                                 row filters, CompressionStream('deflate'), 256 KiB slices with a
│                                 MessageChannel task between them (pure apart from those platform
│                                 APIs, which Node also has)
├── image/export/crc32.ts         CRC-32 for PNG chunks
├── image/export/testPng.ts       test-only independent PNG reader (bitwise CRC, inflate, unfilter)
├── editor/exportCommands.ts      canExport, exportStartCommand (constant time), exportFileName
├── editor/editorState.ts         exporting (ExportJob), lastExport (ExportedContent);
│                                 export-started / export-finished / export-failed; currentContent,
│                                 sameContent; the 'exported' notice and the 'export' error
├── editor/editCommands.ts        hasUnexportedEdits measured from the last export
├── app/exportImage.ts            runExport: start (flushSync), encode, download, record the outcome;
│                                 browser steps injected, so the flow is tested in Node
├── app/downloadFile.ts           the only browser download code: a blob: URL and a temporary link
├── app/useExportCommand.ts       the Export button's handler (blocked behind the replace dialog)
├── components/AppHeader/         Export button: ready (names the file), "Exporting…", unavailable
│                                 (no image, or another image opening)
└── components/StatusBar/         UnexportedEditsNote
scripts/browser/png-export.mjs    the workflow and every exported file in Chrome and Firefox
```

- The export runs outside the reducer like edits: `exportStartCommand` reads the committed state and returns the `export-started` action with the document's pixel buffer (shared, never copied: buffers are immutable, P3-D1). `runExport` commits the start with `flushSync`, so a second click finds the export running; the reducer also refuses a second start, a start while another image is opening, or one computed for an earlier content state.
- Export and imports (corrected 2026-11-09 after the independent audit of `586495a`): `canExport` is false while an import is pending (`isImporting`), as `availableEditActions` already is for edits, so no export starts for an image about to be replaced. The reverse order is allowed: an import may start while an export is being written. That export keeps its own pixel buffer and finishes; `export-finished` records it as the last export only if its document is still open.
- The content state an export saved is identified without comparing pixels (`ExportedContent`: document id, edit depth and the history's next Undo entry). The history is one line and entries are immutable (a remade Delete is a new entry), so Undo then Redo returns to the same three values and any other change does not. The marker is taken when the export starts; edits during the export keep the image unexported. `state.lastExport` (`LastExport`) holds the entry through a `WeakRef`, so an export never keeps a history entry's patch alive after the history has dropped it (outside the 256 MiB budget); an entry nothing else holds can never be the next Undo again, so the comparison does not depend on garbage collection.
- No new dependency and no worker: the encoder uses `CompressionStream` and yields between slices; it could move to a Web Worker unchanged if profiling ever shows the need (it takes and returns transferable data).
- Desktop (Phase 7): `downloadFile` is the one piece to replace with a native Save dialog; the encoder and commands do not depend on the browser's download behaviour.

### Phase 4 Modules (Crop and colour tools; awaiting owner review)

```text
src/
├── image/crop/cropRectangle.ts       crop rectangle geometry in image pixels: validity (whole pixels, ≥ 1 × 1,
│                                     within the image), nearest pixel edge, move, resize by handle, fields
├── canvas/cropOverlay.ts             the rectangle in workspace CSS px on the device pixels where the canvas
│                                     draws the boundaries (cropRectOnScreen), hit-testing (handles, edges,
│                                     inside), cursors, handle and label positions
├── editor/editorState.ts             crop (CropState: rect, drag) and crop-drag-started / -dragged / -ended,
│                                     crop-field-changed, crop-cancelled; pendingCrop(); colour (ChosenColour),
│                                     colour-sampled, colour-chosen; sampledPixel()
├── editor/editCommands.ts            'crop' edit action (availableEditActions.crop), cropCommand
├── editor/cropCommands.ts            cropShortcut (Enter / Escape), applyCropTitle
├── editor/colourCommands.ts          eyedropperClick (pixelUnderPointer + sampleColour)
├── editor/colourPicker.ts            the picker's rules: PickerColour, withHsv / withAlpha / withHex, svAtPoint,
│                                     svKey, value texts
├── image/colour/colour.ts            Rgba, sampleColour, hex parse / format, HSV conversions
├── image/colour/replaceColour.ts     basic Replace Colour (algorithm only; no tool uses it yet)
├── app/useCropCommands.ts            Enter / Escape for the crop (window, capture phase)
└── components/                       Toolbar/CropOptions, Toolbar/EyedropperOptions, Workspace/CropOverlay (SVG,
                                      pointer-events none), ColourPicker/ (modal popover);
                                      workspaceInput.useCropPointer (pointer capture, hover cursor)
scripts/browser/                      crop.mjs, colour.mjs; fixtures.mjs ensureCropFixtures (crop-columns.png)
```

- No new history type, command path or ownership rule: Apply Crop passes the rectangle to `completedEditCommand` as a `CompletedCrop`, like Auto Trim, so the crop patch, Undo / Redo, history limits, version checks, `dispatchEditAction` and display-image ownership are unchanged. `EditKind` gains `crop`.
- The crop rectangle and its drag are view state in the reducer, constant time (like the pan drag); no pixels are touched until Apply. The drag stores image coordinates, so view changes during a drag are harmless. The rectangle is dropped by tool changes, imports and size changes (`viewAfterEdit`), and kept by same-size edits.
- The overlay is SVG in workspace CSS pixels over the canvases; it cannot reach the image or an export. Hit-testing happens in the reducer from the workspace point and the display viewport, so drawing and hit-testing use the same mapping.
- The Eyedropper reads pixels in a command outside the reducer (tagged with the document version, like a Magic Wand click); the reducer only stores the colour. The chosen colour is session state, not image state.
- The colour picker is a self-contained component with its rules in a pure module; no dependency was added (decision recorded in `IMPLEMENTATION_PLAN.md`, Phase 4 Status).

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

- Native file dialogs (export currently hands the PNG to the browser as a download through `app/downloadFile.ts`, the one module to replace)
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
- Last Auto Trim padding (not persisted; Phase 3 Step 11 resets it to 5 px whenever another image is opened, owner's provisional decision)
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
