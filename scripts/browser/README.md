# Browser regression scripts

Manual checks that need a real browser: what the canvas actually shows, how the browser restores
lost canvases, how long display images take to create, and the Delete / Undo / Redo workflow. They
are not part of `npm test` or CI, and they need no extra dependencies.

## Requirements

- Node 24 or later (the scripts use Node's built-in WebSocket).
- Google Chrome and/or Firefox installed. Set `CHROME` or `FIREFOX` to use another binary.
- `gpu-crash.mjs` also needs Linux.

Each browser starts headless with a new temporary profile, which is deleted afterwards. Your own
browser windows and profiles are never touched.

The scripts generate the images they open into `scripts/browser/fixtures/`, which Git ignores.
They do this on first use. Run `node scripts/browser/fixtures.mjs` to regenerate them. The editing
script also generates `details.png` (1-pixel lines and dots, separate squares, every alpha value,
hidden colour), `big50mp.png` (8660 × 5773) and `broken.png` (a truncated PNG). The edge cleanup
script generates `edge-*.png`, `edge-*.jpg` and `edge-svg.svg` (an HMI pump graphic, thin lines and
wiring, a logo on colour, text and corners, a gradient, a partially transparent PNG, shapes touching
the border, a soft photo, an SVG, and the HMI graphic repeated to 4K and to 50 megapixels); they are
also useful for manual checks.

## Scripts

Run them from the repository root. Each prints PASS or FAIL lines and exits with code 1 if any
check fails. A check the harness cannot perform in a configuration is printed as SKIP with the
reason: it is not verified, it counts neither as a pass nor as a failure, and it does not change the
exit code. The last line gives the counts (passed, failed, skipped).

### Rendering smoke test

```sh
npm run build
node scripts/browser/smoke.mjs                                  # Chrome and Firefox, DPR 1 and 2
node scripts/browser/smoke.mjs --browser chrome --dpr 1,1.5,2 --gpu
```

This serves `dist/` with Vite's preview server. Set `APP_URL` to test a running server instead,
for example `npm run dev`, which runs under React Strict Mode.

It opens PNG, JPEG, WebP and SVG images, including ones with transparency. For each one it checks
that:

- The image opens at revision 0, and the previous image's display image is released.
- At 100%, 200% and 400%, before and after a pan, opaque pixels are exact, fully transparent pixels
  show exactly the checkerboard, and partially transparent pixels are within 2 levels.
- The image is drawn at Fit.

It then selects a background with the Magic Wand and checks the selection overlay at each zoom
level:

- The mint tint is exact over selected pixels.
- Nothing is drawn over unselected pixels.
- A black-and-white boundary runs along the edges.

Finally it checks redraws. Tolerance changes and clearing the selection don't redraw the image. A
zoom step, a pan and a window resize each redraw it once.

Known result: Chrome at DPR 1.5 fails 20 checks. They start on one device row and are one level
off. The same failures appear in builds from before Phase 3 Step 4. Chrome at DPR 1 and 2, and
Firefox, pass every check.

### GPU process crash (opt-in)

```sh
npm run build
node scripts/browser/gpu-crash.mjs --kill-test-gpu-process [--gpu] [--dpr 1,2]
```

This starts its own headless Chrome, selects part of an image, and kills that Chrome's GPU process
with `SIGKILL`. It finds the process among the descendants of the Chrome it started, so no other
browser is ever affected. Chrome then restarts the process and restores its canvases.

The script runs twice: once with reduced motion, so the boundary is static, and once with
marching ants. Without any user action after the crash, it checks that:

- Both layers lost and regained their contexts.
- The image layer is exact.
- The overlay is complete and aligned. With reduced motion it must be identical to before the
  crash; with marching ants it must cover the same pixels.
- The selection, document and view are unchanged.
- Nothing is redrawn while the app is idle.
- A pan afterwards still draws correctly.

Firefox is not covered, because headless Firefox has no separate GPU process to stop.

The three overlay checks (correct before the crash, complete after it, complete after a pan) use
`checkOverlay`, which supports whole device scales only. At 200% with a device pixel ratio of 1.25
(device scale 2.5) they are reported as SKIP: fractional-scale overlay restoration is not verified
by this script. The other checks there (both layers restored, image exact, overlay identical to /
covering the same pixels as its snapshot from before the crash, view unchanged, one redraw) run
and must pass.

### Display-image bench

```sh
node scripts/browser/display-image-bench.mjs [--browser chrome|firefox|all] [--gpu]
     [--sizes 1920x1080,3840x2160,8660x5773] [--content opaque,deleted] [--reps 5]
```

This serves the source with Vite's dev server, so no build is needed, and runs
`display-image-bench/` in each browser. It checks `createDisplayImage`:

- Each strategy shows the same bytes as the import path: the transfer path and both forced
  fallbacks.
- The source pixels are left unchanged.
- A released image is never drawn.
- The renderer redraws when the content or view changes, and skips identical frames.
- The largest accepted images can be created.

It then prints median creation times and the time to the first frame for three strategies:
`transferToImageBitmap`, the canvas-element fallback and `createImageBitmap`. Times depend on the
machine, so compare strategies and browsers within the same run.

### Delete, Undo and Redo workflow

```sh
npm run build
node scripts/browser/edit-workflow.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
APP_URL=http://127.0.0.1:5173/ node scripts/browser/edit-workflow.mjs --no-perf   # npm run dev: Strict Mode
```

With real key presses and clicks, on PNG, JPEG, WebP and SVG images (transparent, partially
transparent, 1-pixel details, disconnected selections, 4K), it checks that:

- Delete makes exactly the selected pixels transparent in the document (every byte compared,
  hidden colour kept), keeps the view, clears the selection, and the canvas shows the result
  exactly; only the current display image is live.
- Ctrl + Z restores every byte, the selection and the Magic Wand click (committed tolerances
  re-apply as before the Delete); Ctrl + Y and Ctrl + Shift + Z redo; several Deletes, Add and
  Subtract, the buttons and their names, held keys, the tolerance field, a Delete that changes
  nothing, failures, and edits while another image opens.
- The replace confirmation for the file picker, paste and drop: when it is asked, Cancel,
  Continue, Escape, and that nothing else happens while it is open.
- No page errors, and no React warnings or console errors.

Then it times Delete, Undo and Redo at 4K and (unless `--no-stress`) near 50 megapixels, splitting
out display-image creation, and reports history memory and live display images over repeated
cycles (in Chrome also the JavaScript heap and ArrayBuffers after garbage collection). Timings are
reported, never checked.

Headless Firefox has no window focus, so focus and Escape in the dialog are checked in Chrome
only. Paste and drop use synthetic events carrying the file.

### Display-image ownership with real React

```sh
node scripts/browser/edit-ownership.mjs [--browser chrome|firefox|all] [--mode dev|prod|both]
```

This runs `edit-ownership/` with the project's reducer, edit commands, `dispatchEditAction` and
`ImageCanvas`, in development React under Strict Mode and in a production build. It makes actions
stale on purpose and queues updates of lower priority just before them, which the app never does,
and checks that:

- An accepted action's image is committed, drawn and kept before `dispatchEditAction` returns.
- A stale action's image is released at once and never held later, also when React processes the
  actions again after a transition.
- Every replaced image ends up released, and no React warnings appear.

It also reports what happens if a selection change is dispatched in a transition before a Delete
(the app never does this): React returns to the image before the Delete, which is already
released. That note shows where the ownership argument in `src/app/editDispatch.ts` ends.

### Edge cleanup and feathering (Phase 3 Step 8)

```sh
npm run build
node scripts/browser/edge-cleanup.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
     [--step7 ~/minty-step7-review/out/fixtures] [--sheets <folder>]
APP_URL=http://127.0.0.1:5173/ node scripts/browser/edge-cleanup.mjs --no-perf   # npm run dev: Strict Mode
```

With real clicks, typing and key presses, it checks that:

- The Edge cleanup and Feather controls start at 0 px with their labels, units and range; Tab
  reaches them between Shrink and Delete Selection; the sliders' keys, typing, clamping and Escape
  work; Delete inside a field edits only its text; adjusting computes nothing; the amounts are kept
  across Deletes and images; a 640 px window wraps each control as one unit.
- For ten images at several cleanup and feather amounts set with the controls, Delete produces
  exactly the bytes the application's own algorithm produces in Node for the same pixels and
  selection (`lib/source.mjs` imports `src/` into the script), and with both amounts at 0 exactly
  the Step 6 Delete; one history entry, the selection cleared, the announcement, the canvas
  showing the result; Undo restores every byte and the selection, Redo the result.
- With `--step7`, the Step 7 fixtures are deleted with their recorded Magic Wand clicks and
  compared with Node and with the Step 7 report's accuracy figures.
- With `--sheets`, it writes before / after PNGs of each image's detail area, 4× enlarged.

Then (unless `--no-perf`) it times Delete, Undo and Redo at each amount at 4K and (unless
`--no-stress`) near 50 megapixels, and reports history size and memory. Timings are reported, never
checked. Headless Firefox has no window focus and fires no blur events, so leaving an emptied field
is checked in Chrome only.

### Adjusting the last Delete (Phase 3 Step 9)

```sh
npm run build
node scripts/browser/edge-adjust.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
APP_URL=http://127.0.0.1:5173/ node scripts/browser/edge-adjust.mjs --no-perf   # npm run dev: Strict Mode
```

Right after a Delete, with real pointer drags, key presses, held keys and typing, it checks that:

- Dragging a slider or holding a key changes the amount shown but computes nothing until it is
  released; then the Delete is made again once. Typing waits for Enter or leaving the field, and
  Escape cancels. Committing the amounts the result already has computes nothing.
- Every result is exactly the bytes the application's algorithm gives in Node for the pixels and
  selection from before the Delete with the amounts now set; one history entry throughout; the
  canvas shows the result; the update is announced; one Undo restores every byte and the
  selection, Redo the latest result, which can be adjusted again; 0 / 0 is the Step 6 Delete.
- The tooltips say whether the amounts set the next Delete or update the last one.
- Nothing is adjusted with a selection (the amounts set the next Delete), after Select All and
  Clear, while the replace confirmation is open (also when opening it takes focus from a field
  being edited) or while another image opens.
- After Redo with other amounts shown than the Delete was made with: Tab and Shift + Tab through
  both controls, focusing and leaving each part, a drag back to its start, keys held and stepped
  back, retyping the same number and Escape never update the Delete; an actual change does.
- The status bar note "Edge settings update last Delete": shown only while a change would update
  the Delete, no toolbar or status bar height change, hidden below 800 px.
- For five images, seven adjustments from the fields, each compared with Node.

Then (unless `--no-perf`) it times each adjustment (the synchronous commit handler, including the
display image), Undo and Redo, at 4K and (unless `--no-stress`) near 50 megapixels. Timings are
reported, never checked.

`lib/edges.mjs` holds the page helpers and input steps shared with `edge-cleanup.mjs`.

### Auto Trim (Phase 3 Step 11)

```sh
npm run build
node scripts/browser/auto-trim.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
     [--kill-test-gpu-process]
APP_URL=http://127.0.0.1:5173/ node scripts/browser/auto-trim.mjs --no-perf   # npm run dev: Strict Mode
```

It generates `trim-*.png` on first use (an HMI pump and valve on a flat background, a valve on
transparency with a soft shadow, an empty image, a 1-pixel frame, and 4K and 50-megapixel images
with flat and photographic backgrounds). With real clicks, key presses and typing, it checks that:

- Auto Trim in the toolbar shows its options row: the padding presets (0, 5, 10, 20), the field
  (0–50: typing, Enter, Escape, clamping, text that is not a number, arrows and Page keys), the
  unit and Trim, with their names, tooltips and Tab order. Changing the padding computes nothing,
  and clicks on the image select nothing while Auto Trim is the tool.
- After Magic Wand and Delete, Trim gives exactly the rectangle a full alpha scan in the page
  gives, cut from the image before the trim, every byte (hidden colour included). One entry; the
  selection and click are cleared; the view is Fit; the canvas shows the result; the announcement
  gives both sizes. Undo, Undo, Redo, Redo (keys and header buttons) are exact.
- Nothing to trim (an opaque image, padding that reaches every edge, a fully transparent image, a
  frame in every edge) changes nothing and shows a dismissible message. A transparent PNG keeps its
  faintest pixels; padding 50 is clipped at the edges.
- Trim is unavailable while another image opens and does nothing behind the replace confirmation;
  the padding goes back to 5 with a new image. Keyboard only (button activation in Chrome only:
  headless Firefox ignores Enter and Space on buttons). 25 Deletes then a trim: the oldest Undo
  step is dropped and a message says so. 800 and 640 px windows (narrower ones are reported: the app
  is at least 640 px wide).
- With `--kill-test-gpu-process` (Chrome on Linux), the canvas shows the trimmed image exactly
  after the GPU process is killed and restored.

Then (unless `--no-perf`) it times Delete, Trim, Undo and Redo and reports the history size, live
display images and, in Chrome, the JavaScript heap, at 4K and (unless `--no-stress`) near 50
megapixels, with the longest and shortest no-op scans. Timings are reported, never checked.

The keyboard section runs first: in headless Firefox, after the other sections in the same
session, Tab alternated between the first two buttons of an options row (the Magic Wand's too),
which a fresh session does not do.

### PNG export and the first workflow (2026-11-08)

```sh
npm run build
node scripts/browser/png-export.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
APP_URL=http://127.0.0.1:5173/ node scripts/browser/png-export.mjs --no-perf   # npm run dev: Strict Mode
```

With real clicks and key presses it opens an image, selects the background with the Magic Wand,
presses Delete, clicks Export, presses Ctrl + Z and Ctrl + Y, uses Auto Trim, opens a partially
transparent PNG, exports it with a selection active, opens another image while holding its import,
and makes a feathered Delete. It captures every file the app hands to the browser
(by wrapping `URL.createObjectURL` and the link's `click`), and checks that:

- Each file is a valid PNG (signature, every CRC with Node's zlib, IHDR 8-bit RGBA, IDAT chunks,
  IEND) named `<name>-cleaned.png`, at the document's size, with every pixel exactly the
  document's and fully transparent pixels as 0, 0, 0, 0 (hidden colour dropped). The browser
  decodes it too (opaque and transparent pixels exact).
- In Chrome, one export is really downloaded into a temporary folder and matches byte for byte.
- Export with a selection writes the whole image and keeps the selection. While another image is
  opening, Export is unavailable with the tooltip "Export — not available while another image is
  opening", and a click starts and downloads nothing; once the image has opened, Export names it.
- The Export button's name, tooltip and availability; the "Unexported edits" note after Delete,
  Auto Trim, Export, Undo and Redo; the announcement; the replace confirmation asked only for
  unexported edits; a failed export's message, with nothing downloaded; no console errors.
- For comparison it reports how many partially transparent pixels the browser's canvas encoder
  would change (Firefox: most of them; Export: none).

Then (unless `--no-perf`) it times exports at 4K and (unless `--no-stress`) near 50 megapixels,
checks that a second click while one runs does nothing and that the button says "Exporting…",
and reports the longest gap between animation frames meanwhile. Timings are reported, never
checked.

## Maintenance notes

- `lib/app.mjs` finds the editor state through React's internal fiber tree, because the app has
  no test hooks. It is the one part that depends on React internals. If a React upgrade breaks it,
  `openApp` fails with a clear message.
- The scripts dispatch editor actions directly (`zoom-scaled`, `wheel-panned`, and so on). If an
  action is renamed, update the scripts too.
- `lib/edit.mjs` wraps `transferToImageBitmap`, `putImageData`, `createImageBitmap` and
  `drawImage` in the page to count live display images and time their creation and drawing.
- `lib/source.mjs` runs the app's TypeScript in Node 24 by type stripping, adding `.ts` to the
  app's extensionless imports. It needs the erasable-only TypeScript the project already uses.
- `lib/gpu.mjs` finds the GPU process of the Chrome a script started (`gpu-crash.mjs`,
  `auto-trim.mjs`).
- Canvases are read by drawing them onto a separate canvas, never with their own `getImageData`.
  In Chrome, reading a canvas back can move it off the GPU, and then a crash would not affect it.

### Manual Crop (Phase 4)

```sh
npm run build
node scripts/browser/crop.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3] [--no-perf] [--no-stress]
```

Real drags draw, move and resize the crop rectangle at 400% (nearest pixel edges, stopping at the
image's edges, a click removing it); the overlay's edges are compared with what the canvas draws at
Fit, 100%, 150%, 200%, 300% and 800%, each also after two fractional pans, at device pixel ratios 1,
1.25, 1.5, 2 and 3 by default (on `crop-columns.png`, whose red and green channels give the column
and row), and on screen: screenshots with the overlay hidden and shown must show exactly the removed
columns and rows darkened, no pixel partly; Escape, the fields, Enter, Apply Crop, Cancel and keyboard-only use (Chrome); the
cropped document byte for byte, the canvas, Undo and Redo; export after a crop (decoded in Node) and
that a rectangle not applied never reaches an export; tool changes, imports and Apply being
unavailable while an image opens. Unless `--no-perf`, Apply, Undo and Redo times at 4K and (unless
`--no-stress`) near 50 MP.

### Eyedropper and colour picker (Phase 4)

```sh
npm run build
node scripts/browser/colour.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3] [--no-forced-colours]
```

Real clicks at Fit, 100%, 150%, 200%, 300% and 400%, some after fractional pans, read exactly the
pixel the screen shows under the pointer, on an opaque image, a partly transparent one and
`colour-stripes.png` (sharp alternating colours and transparency), without changing the image. The
oracle is observed, not computed with the app's mapping: the pointer position the browser delivered
(Firefox moves synthesized pointers to the nearest device pixel corner) and the canvas's colour at
that device pixel. The Magic Wand (tolerance 0) and the status bar are checked the same way. Also:
each reading announced (the same pixel twice included); the colour picker's focus, keyboard,
pointer, sliders, hex field, Cancel, Escape and Apply; that editor shortcuts do nothing while it is
open and no pasted or dropped image is imported behind it (real Ctrl + V in Chrome, whose headless
clipboard is its own, never the desktop's); placement after resizing to 640 × 480 and 640 × 360;
and, once per browser unless `--no-forced-colours`, forced colours mode (Chrome's emulation,
Firefox's colour override).

At fractional device scales `compareImage` (lib/app.mjs) reads which image column and row each
device column and row shows from the canvas itself and requires an exact nearest-neighbour
enlargement; `checkOverlay` still supports whole scales only (it reports "skipped"; `gpu-crash.mjs`
records those checks as SKIP).

### Arbitrary zoom levels (Phase 4, Codex's regression of 2026-11-11)

```sh
npm run build
node scripts/browser/arbitrary-zoom.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3]
```

Zoom levels reached through the workspace's Ctrl + wheel handler: Codex's reproduction (one
pixel-mode Ctrl + wheel event from 100% to exactly 147.65625%, and events landing just above and
below it; these need fractional deltas, which WebDriver's wheel input cannot send, so they are wheel
events dispatched to the canvas and handled by the app's own wheel listener), real trusted Ctrl +
wheel input in both browsers (`wheel()` in `lib/browsers.mjs`; 147.77%, 108.61%, 210.24%, 362.39%),
237.37%, 100% (also Fit for this image), just above 100% (100.01%) and either side of a point where
the display changes from one grid scale to the next (near 133%; the grid scales are worked out in the
script); each panned by fractional amounts, at device pixel ratios 1, 1.25, 1.5, 2 and 3 (`--dpr
1.01,1.1` also works). The oracle never uses the app's mapping: the canvas must be an exact
nearest-neighbour enlargement (decoded from `crop-columns.png`); real Eyedropper and Magic Wand
clicks (tolerance 0) on the first and last device pixels of chosen image pixels, and just before
them, must read and select exactly the pixel the canvas shows at the delivered position, with the
status bar naming it; the crop overlay's edges must be where the canvas starts and stops drawing the
kept columns and rows, and on screen (screenshots) it must darken exactly the removed ones; on
`colour-stripes.png`, clicks on every device pixel along the diagonal must read the document's
exact bytes of a pixel that, over the checkerboard, is exactly what the screen shows. Against the
build before the display scale grid (fixed 3/128 offset) it fails 42 checks at DPR 1 (147.65625% and
just below it, both browsers).

### Zoom anchoring, Actual Size, the screen and the zoom limit (Phase 4, 2026-11-11)

```sh
npm run build
node scripts/browser/zoom-anchor.mjs [--browser chrome|firefox|all] [--dpr 1,1.01,1.1,1.19,1.25,1.5,2,3]
```

The oracle is what the browser is given and shows: the transform and smoothing flag of each
`drawImage` call drawing the image (read from the canvas context; both browsers keep transforms in
single precision), the delivered press and wheel positions (counted from the device pixel the
browser puts the canvas's corner on), canvas readback, screenshots and the controls' DOM state.
- Actual Size (a real click) displays exactly 100%; crisp (exact enlargement) where the ratio is a
  display grid scale, worked out in the script; smoothed elsewhere (Chrome at 1.01 and 1.19), where
  40 real Eyedropper clicks must read the exact stored bytes of the pixel nearest the device pixel
  centre, which must dominate the colour shown.
- With the Magic Wand, Eyedropper, Crop and Auto Trim options rows above the canvas (each moves it,
  often to a fractional device pixel), the canvas bitmap must be the browser's
  device-pixel-content-box and the screenshot must equal canvas readback exactly.
- Real Ctrl + wheel notches at three pointers: 15 up and 15 back return exactly; 100% to 3200% keeps
  the point within one device pixel. Zoom In clicks to 3200% likewise. At the requested 3200%: not
  displayed above 3200%, Zoom In disabled, a click or wheel notch there changes nothing.

Against the build before the anchoring fix it fails 14 checks at DPR 1.5 and 1.01; with the
device-box and screen-corner fix reverted, 19 at 1.01 and 1.1.

In `arbitrary-zoom.mjs`, a view drawn smoothed (exactly 100% at a ratio off the display grid) reports
its nearest-neighbour checks as SKIP (they decode single pixels from the screen, which a blend does
not show); `zoom-anchor.mjs` covers that view.

`fixtures.mjs` also writes `crop-columns.png` (120 × 80, opaque; red = 2 × column, green = 3 × row)
and `colour-stripes.png` (60 × 40; red / blue columns, alpha 255 / 128 rows, transparent diagonals).
