// Serving the app, and the helpers the scripts install in its page.
import fs from 'node:fs'
import path from 'node:path'
import { createServer, preview } from 'vite'
import { waitFor } from './browsers.mjs'

export const ROOT = path.resolve(import.meta.dirname, '../../..')

/** The production build (dist/) on Vite's preview server, or the app at APP_URL when set. */
export async function serveBuild() {
  if (process.env.APP_URL) return { url: process.env.APP_URL, close: async () => {} }
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
    throw new Error('No production build in dist/: run "npm run build" first, or set APP_URL.')
  }
  const server = await preview({
    root: ROOT,
    logLevel: 'warn',
    preview: { host: '127.0.0.1', port: 4180, strictPort: false, open: false },
  })
  return { url: server.resolvedUrls.local[0], close: () => server.close() }
}

/** The source on Vite's dev server, without the app's plugins: for pages importing src/ modules. */
export async function serveSource() {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: 5180, strictPort: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  await server.listen()
  return { url: server.resolvedUrls.local[0], close: () => server.close() }
}

/** Loads the app and installs window.__minty (PAGE_HELPERS). */
export async function openApp(browser, url) {
  await browser.open(url, '!!document.querySelector("main.workspace")')
  if (!(await browser.eval(PAGE_HELPERS))) throw new Error('The page helpers could not find the editor state')
}

/** Opens `file` with the app's file input and waits until it is shown. */
export async function openImage(browser, file) {
  const before = await browser.eval('window.__minty.state().document?.id ?? 0')
  await browser.setFile('input[type=file]', file)
  await waitFor(
    () =>
      browser.eval(`(() => {
        const s = window.__minty.state()
        return s.document !== null && s.document.id !== ${before} && s.viewport !== null && s.pendingImportId === null
      })()`),
    { what: `${path.basename(file)} to open` },
  )
  // The first image shows the tool options row, which shrinks the workspace; the resize that
  // follows places the image again (placeOnNextResize). Zooming before then would be undone.
  await waitFor(() => browser.eval('!window.__minty.state().placeOnNextResize'), { what: 'the image to be placed' })
}

export const dispatch = (browser, action) => browser.eval(`(window.__minty.dispatch(${JSON.stringify(action)}), true)`)

/**
 * Installed in the app's page as window.__minty.
 *
 * The editor state is found through React's internal fiber tree (the reducer whose state has
 * `pendingImportId`), since the app exposes no test hooks. That is the one part tied to React's
 * internals: if a React upgrade breaks it, openApp() fails with a clear message.
 *
 * Canvases are read by drawing them onto a separate main-memory canvas, never with their own
 * getImageData: in Chrome, reading a canvas back can move it off the GPU, which would hide what
 * a GPU process crash does to it.
 */
export const PAGE_HELPERS = `(() => {
  const find = () => {
    const container = document.getElementById('root')
    const key = container && Object.keys(container).find((k) => k.startsWith('__reactContainer$'))
    if (!key) return null
    const stack = [container[key].stateNode.current]
    while (stack.length) {
      const fiber = stack.pop()
      if (!fiber) continue
      for (let hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
        const s = hook.memoizedState
        if (s && typeof s === 'object' && 'pendingImportId' in s) return { state: s, dispatch: hook.queue.dispatch }
      }
      stack.push(fiber.sibling, fiber.child)
    }
    return null
  }
  if (!find()) return false

  const imageCanvas = () => document.querySelector('canvas.workspace__canvas')
  const overlayCanvas = () => document.querySelector('canvas.workspace__overlay')
  const errors = []
  addEventListener('error', (e) => errors.push(String(e.message)))
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)))

  // Image draws onto each layer.
  const draws = { image: 0, overlay: 0 }
  const drawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas === imageCanvas()) draws.image++
    else if (this.canvas === overlayCanvas()) draws.overlay++
    return drawImage.apply(this, args)
  }

  // Context loss and restoration of each layer.
  const contextEvents = []
  for (const [name, canvas] of [['image', imageCanvas()], ['overlay', overlayCanvas()]]) {
    canvas.addEventListener('contextlost', () => contextEvents.push(name + ' lost'))
    canvas.addEventListener('contextrestored', () => contextEvents.push(name + ' restored'))
  }

  const read = (canvas) => {
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    if (canvas.width && canvas.height) context.drawImage(canvas, 0, 0)
    const data = context.getImageData(0, 0, Math.max(1, copy.width), Math.max(1, copy.height)).data
    copy.width = copy.height = 0
    return data
  }

  // The image's corner and scale in device pixels; whole scales only, where every device pixel
  // shows exactly one image pixel and no expected value depends on a rounding tie.
  const placement = () => {
    const s = find().state, v = s.viewport, dpr = devicePixelRatio
    const S = v.zoom * dpr
    return { s, S, e: Math.round(v.offset.x * dpr), f: Math.round(v.offset.y * dpr), whole: Math.abs(S - Math.round(S)) < 1e-9 }
  }

  let snapshot = null

  window.__minty = {
    state: () => find().state,
    dispatch: (action) => find().dispatch(action),
    errors,
    draws,
    contextEvents,

    /** Workspace coordinates (zoom anchors) of image pixel (x, y). */
    workspacePoint(x, y) {
      const v = find().state.viewport
      return { x: v.offset.x + x * v.zoom, y: v.offset.y + y * v.zoom }
    },

    /** Client coordinates of image pixel (x, y). */
    clientPoint(x, y) {
      const v = find().state.viewport, r = imageCanvas().getBoundingClientRect()
      return { x: Math.round(r.left + v.offset.x + (x + 0.5) * v.zoom), y: Math.round(r.top + v.offset.y + (y + 0.5) * v.zoom) }
    },

    /**
     * The image layer against the document's pixels over the checkerboard: opaque pixels exact,
     * transparent ones exactly the checkerboard, partial alpha within 2 levels.
     */
    compareImage() {
      const { s, S, e, f, whole } = placement()
      if (!whole) return { skipped: 'device scale ' + S }
      const canvas = imageCanvas(), dpr = devicePixelRatio
      const { width, height, data } = s.document.pixels
      const x0 = Math.max(0, e), y0 = Math.max(0, f)
      const x1 = Math.min(canvas.width, e + width * S), y1 = Math.min(canvas.height, f + height * S)
      if (x1 <= x0 || y1 <= y0) return { skipped: 'nothing visible' }
      const shown = read(canvas)
      const square = Math.max(1, Math.round(8 * dpr))
      const n = { opaque: 0, transparent: 0, partial: 0 }, wrong = { opaque: 0, transparent: 0, partial: 0 }
      let first = null, maxPartial = 0
      for (let Y = y0; Y < y1; Y++) {
        const iy = Math.floor((Y - f) / S)
        for (let X = x0; X < x1; X++) {
          const ix = Math.floor((X - e) / S), i = (iy * width + ix) * 4, j = (Y * canvas.width + X) * 4
          const u = (((X - e) % (2 * square)) + 2 * square) % (2 * square), w = (((Y - f) % (2 * square)) + 2 * square) % (2 * square)
          const background = (u < square) === (w < square) ? 0x2c : 0x3a
          const a = data[i + 3], kind = a === 255 ? 'opaque' : a === 0 ? 'transparent' : 'partial'
          n[kind]++
          let error = shown[j + 3] === 255 ? 0 : 255
          for (let k = 0; k < 3; k++) error = Math.max(error, Math.abs(shown[j + k] - (data[i + k] * a + background * (255 - a)) / 255))
          if (kind === 'partial') maxPartial = Math.max(maxPartial, error)
          if (error > (kind === 'partial' ? 2 : 0.5)) {
            wrong[kind]++
            first ??= { X, Y, ix, iy, rgba: [data[i], data[i + 1], data[i + 2], a], background, shown: [...shown.subarray(j, j + 4)] }
          }
        }
      }
      return { S, n, wrong, failures: wrong.opaque + wrong.transparent + wrong.partial, maxPartial: +maxPartial.toFixed(2), first }
    },

    /** Inside the image at Fit: drawn (opaque) and not only checkerboard. */
    drawnAtFit() {
      const { s, e, f } = placement()
      const canvas = imageCanvas(), dpr = devicePixelRatio, zoom = s.viewport.zoom
      const w = Math.floor(s.document.width * zoom * dpr) - 2, h = Math.floor(s.document.height * zoom * dpr) - 2
      const shown = read(canvas)
      let notOpaque = 0, notChecker = 0
      for (let Y = Math.max(0, f) + 1; Y < Math.min(canvas.height, f + 1 + h); Y++) {
        for (let X = Math.max(0, e) + 1; X < Math.min(canvas.width, e + 1 + w); X++) {
          const j = (Y * canvas.width + X) * 4, c = shown[j]
          if (shown[j + 3] !== 255) notOpaque++
          if (!((c === 0x2c || c === 0x3a) && shown[j + 1] === c && shown[j + 2] === c)) notChecker++
        }
      }
      return { zoom, notOpaque, notChecker }
    },

    /**
     * The overlay layer against the selection: away from the selection's edges, every device
     * pixel over a selected image pixel shows exactly the mint tint and every other one shows
     * nothing; near the edges, the boundary is drawn (opaque pixels).
     */
    checkOverlay() {
      const { s, S, e, f, whole } = placement()
      if (!whole) return { skipped: 'device scale ' + S }
      const canvas = overlayCanvas(), selection = s.selection
      if (!selection) return { selection: false, backingStore: [canvas.width, canvas.height] }
      const { width, height, data } = selection
      // Selected pixels in [0, x) × [0, y), to tell whether a neighbourhood is uniform.
      const sums = new Int32Array((width + 1) * (height + 1))
      for (let y = 0; y < height; y++) {
        let row = 0
        for (let x = 0; x < width; x++) {
          row += data[y * width + x]
          sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + row
        }
      }
      const count = (x0, y0, x1, y1) => sums[y1 * (width + 1) + x1] - sums[y0 * (width + 1) + x1] - sums[y1 * (width + 1) + x0] + sums[y0 * (width + 1) + x0]
      const shown = read(canvas)
      const margin = 2 * Math.max(1, Math.floor(devicePixelRatio)) + 2
      const result = { selection: true, S, tint: 0, clear: 0, edge: 0, boundary: 0, painted: 0, wrongTint: 0, wrongClear: 0, strange: 0, first: null }
      // The overlay holds only nothing, tint (alpha 89) and black or white boundary pixels.
      for (let i = 0; i < shown.length; i += 4) {
        const a = shown[i + 3]
        if (a) result.painted++
        const plain = (shown[i] === 0 && shown[i + 1] === 0 && shown[i + 2] === 0) || (shown[i] === 255 && shown[i + 1] === 255 && shown[i + 2] === 255)
        if (a !== 0 && a !== 89 && !(a === 255 && plain)) result.strange++
      }
      const x0 = Math.max(0, e), y0 = Math.max(0, f)
      const x1 = Math.min(canvas.width, e + width * S), y1 = Math.min(canvas.height, f + height * S)
      for (let Y = y0; Y < y1; Y++) {
        const iy = Math.floor((Y - f) / S)
        const top = Math.floor((Y - margin - f) / S), bottom = Math.floor((Y + margin - f) / S) + 1
        for (let X = x0; X < x1; X++) {
          const ix = Math.floor((X - e) / S), j = (Y * canvas.width + X) * 4
          const left = Math.floor((X - margin - e) / S), right = Math.floor((X + margin - e) / S) + 1
          const selected = data[iy * width + ix] === 1
          const inside = left >= 0 && top >= 0 && right <= width && bottom <= height
          const n = count(Math.max(0, left), Math.max(0, top), Math.min(width, right), Math.min(height, bottom))
          const area = (right - left) * (bottom - top)
          if (selected ? inside && n === area : n === 0) {
            if (selected) {
              result.tint++
              const ok = shown[j + 3] === 89 && Math.abs(shown[j] - 110) <= 3 && Math.abs(shown[j + 1] - 231) <= 3 && Math.abs(shown[j + 2] - 183) <= 3
              if (!ok) { result.wrongTint++; result.first ??= { X, Y, ix, iy, selected, shown: [...shown.subarray(j, j + 4)] } }
            } else {
              result.clear++
              if (shown[j + 3] !== 0) { result.wrongClear++; result.first ??= { X, Y, ix, iy, selected, shown: [...shown.subarray(j, j + 4)] } }
            }
          } else {
            result.edge++
            if (shown[j + 3] === 255) result.boundary++
          }
        }
      }
      return result
    },

    /** Remembers the overlay as shown now. */
    snapshotOverlay() {
      snapshot = read(overlayCanvas())
      return snapshot.length / 4
    },

    /** Pixels differing from the snapshot, in colour and in coverage (painted or not). */
    compareOverlayWithSnapshot() {
      const now = read(overlayCanvas())
      if (!snapshot || now.length !== snapshot.length) return { error: 'no snapshot of this size' }
      let pixels = 0, coverage = 0
      for (let i = 0; i < now.length; i += 4) {
        if (now[i] !== snapshot[i] || now[i + 1] !== snapshot[i + 1] || now[i + 2] !== snapshot[i + 2] || now[i + 3] !== snapshot[i + 3]) pixels++
        if ((now[i + 3] === 0) !== (snapshot[i + 3] === 0)) coverage++
      }
      return { pixels, coverage }
    },
  }
  return true
})()`

/** Waits until the page has drawn two more frames. */
export const settle = (browser) => browser.eval('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 20))))')

/** PASS/FAIL lines as checks run, and the exit code. */
export function createReport() {
  let failures = 0
  return {
    check(name, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
      if (!ok) failures++
    },
    note: (text) => console.log(text),
    finish() {
      console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
      process.exitCode = failures ? 1 : 0
    },
  }
}
