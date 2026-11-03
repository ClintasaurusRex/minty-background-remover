# Browser regression scripts

Manual checks that need a real browser: what the canvas actually shows, how the browser restores
lost canvases, and how long display images take to create. They are not part of `npm test` or CI,
and they need no extra dependencies.

## Requirements

- Node 24 or later (the scripts use Node's built-in WebSocket).
- Google Chrome and/or Firefox installed. Set `CHROME` or `FIREFOX` to use another binary.
- `gpu-crash.mjs` also needs Linux.

Each browser starts headless with a new temporary profile, which is deleted afterwards. Your own
browser windows and profiles are never touched.

The scripts generate the images they open into `scripts/browser/fixtures/`, which Git ignores.
They do this on first use. Run `node scripts/browser/fixtures.mjs` to regenerate them.

## Scripts

Run them from the repository root. Each prints PASS or FAIL lines and exits with code 1 if any
check fails.

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

## Maintenance notes

- `lib/app.mjs` finds the editor state through React's internal fiber tree, because the app has
  no test hooks. It is the one part that depends on React internals. If a React upgrade breaks it,
  `openApp` fails with a clear message.
- The scripts dispatch editor actions directly (`zoom-scaled`, `wheel-panned`, and so on). If an
  action is renamed, update the scripts too.
- Canvases are read by drawing them onto a separate canvas, never with their own `getImageData`.
  In Chrome, reading a canvas back can move it off the GPU, and then a crash would not affect it.
