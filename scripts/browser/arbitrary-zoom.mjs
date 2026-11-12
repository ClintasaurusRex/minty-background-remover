// The arbitrary-zoom regression (Codex, 2026-11-11) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/arbitrary-zoom.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// Zoom levels reached through the workspace's Ctrl + wheel handler, as a user reaches them:
// - Codex's reproduction: one pixel-mode Ctrl + wheel event that takes 100% to exactly 147.65625%
//   (189/128), and events landing just above and just below it. These need a fractional delta,
//   which WebDriver's wheel input cannot send (whole pixels only), so they are wheel events
//   dispatched to the workspace's canvas: the app's own wheel listener handles them like any other.
// - Real wheel input (Chrome DevTools Protocol and WebDriver BiDi, trusted events with Control held):
//   147.77% (one 175 px movement), 108.61%, 210.21% and 362.37% (two movements).
// - 100% (also Fit, for this small image), and 237.37% (Codex's other arbitrary level).
// - Just above 100% (100.01%), and just below and just above a point where the display changes
//   from one grid scale to the next (near 133%; the two grid scales are worked out here).
// Each also panned by fractional amounts, at device pixel ratios 1, 1.25, 1.5, 2 and 3 by default.
//
// The oracle never uses the app's coordinate mapping. What the screen shows is read from the canvas
// (crop-columns.png: red / 2 is the column, green / 3 the row) and from screenshots; where the user
// clicked is the position the browser delivered with the press (Firefox moves pointers to whole CSS
// pixels), and the device pixel containing it. For each view:
// - The canvas is an exact nearest-neighbour enlargement: every column and row once, in order, each
//   for n or n + 1 device pixels (n the whole part of the scale actually drawn).
// - Eyedropper: real clicks on the first and last device pixels of image pixels (0, 0), (1, 1) (the
//   pixel Codex's click read wrongly), (2, 2), (37, 21) and (77, 53), and on the device pixel just
//   before each: the pixel read is exactly the one the screen shows there, with its exact bytes.
// - Magic Wand at tolerance 0 (every pixel unique): the click selects exactly that one pixel, and the
//   status bar names it.
// - Crop: for rectangles starting at (1, 1) and at (37, 21), the overlay's edges are exactly where the
//   canvas starts and stops drawing the kept columns and rows, and on screen (screenshots with the
//   overlay hidden and shown) it darkens exactly the removed columns and rows and no pixel partly.
// Then, on colour-stripes.png (sharp alternating colours, rows of alpha 255 and 128, every third
// diagonal fully transparent): Eyedropper clicks on every device pixel along the diagonal from the
// image's corner read exactly the document's stored bytes of a pixel which, drawn over the
// checkerboard, is exactly what the screen shows (no neighbour looks the same), at the tie and
// real-wheel views.
// No page errors or console warnings.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, dispatch, serveBuild, settle } from './lib/app.mjs'
import { ev, json, load } from './lib/edges.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { decodePng } from './lib/png.mjs'
import { ensureCropFixtures, stripePixel } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,1.25,1.5,2,3' },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()
const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name)

const TIE = 189 / 128
/** The pixel-mode wheel delta (CSS px) that multiplies the zoom by `factor` (wheelZoom.ts: 1.25 per 100 px). */
const deltaFor = (factor) => (-100 * Math.log(factor)) / Math.log(1.25)

/** Installed as window.__mintyZoom. */
const ZOOM_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const canvas = () => document.querySelector('canvas.workspace__canvas')
  const read = (c) => {
    const copy = document.createElement('canvas')
    copy.width = c.width
    copy.height = c.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.drawImage(c, 0, 0)
    const data = context.getImageData(0, 0, c.width, c.height).data
    copy.width = copy.height = 0
    return data
  }
  // Whether the image was last drawn smoothed (Actual Size at a ratio off the display grid).
  let smoothed = null
  const drawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (args.length === 9 && this.canvas === canvas()) smoothed = this.imageSmoothingEnabled
    return drawImage.apply(this, args)
  }
  // The position each pointer press was delivered at, as the app received it.
  let lastDown = null
  addEventListener('pointerdown', (e) => { lastDown = { x: e.clientX, y: e.clientY } }, true)
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); return warn.apply(console, args) }
  window.__mintyZoom = {
    warnings: () => warnings,
    smoothed: () => smoothed,
    /** A Ctrl + wheel event at the canvas's centre, handled by the workspace's own wheel listener. */
    wheelEvent(deltaY) {
      const c = canvas(), r = c.getBoundingClientRect()
      c.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
      return true
    },
    centre() { const r = canvas().getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } },
    /**
     * The canvas as drawn: the device pixels showing the image (alpha 0 outside it), and which image
     * column each device column shows along a row through the image, and which row each device row
     * shows along a column (crop-columns.png: red / 2, green / 3). Also the canvas's corner on screen.
     */
    canvasMap() {
      const c = canvas(), shown = read(c), r = c.getBoundingClientRect(), dpr = devicePixelRatio
      let X0 = Infinity, X1 = -1, Y0 = Infinity, Y1 = -1
      for (let Y = 0; Y < c.height; Y++) for (let X = 0; X < c.width; X++) {
        if (shown[(Y * c.width + X) * 4 + 3]) { X0 = Math.min(X0, X); X1 = Math.max(X1, X); Y0 = Math.min(Y0, Y); Y1 = Math.max(Y1, Y) }
      }
      if (X1 < 0) return null
      const midY = Math.floor((Y0 + Y1) / 2), midX = Math.floor((X0 + X1) / 2)
      const columns = [], rows = []
      for (let X = X0; X <= X1; X++) { const i = (midY * c.width + X) * 4; columns.push(shown[i + 3] === 255 ? shown[i] / 2 : null) }
      for (let Y = Y0; Y <= Y1; Y++) { const i = (Y * c.width + midX) * 4; rows.push(shown[i + 3] === 255 ? shown[i + 1] / 3 : null) }
      return { X0, X1, Y0, Y1, columns, rows, left: r.left, top: r.top, dpr, width: c.width, height: c.height }
    },
    /** The device pixel the last press was delivered in, and the canvas's colour there. */
    observed() {
      if (!lastDown) return null
      const c = canvas(), dpr = devicePixelRatio, r = c.getBoundingClientRect()
      // The canvas is on screen from the device pixel nearest its layout position (browsers round
      // each edge; at ratios such as 1.1 layout puts it on a fractional device pixel), so the
      // device pixel under the pointer is counted from there. Within 0.01 device px of a corner
      // counts as on it (the browsers round DOM coordinates).
      const X = Math.floor(lastDown.x * dpr + 0.01) - Math.round(r.left * dpr), Y = Math.floor(lastDown.y * dpr + 0.01) - Math.round(r.top * dpr)
      if (X < 0 || Y < 0 || X >= c.width || Y >= c.height) return { X, Y, rgba: null }
      const copy = document.createElement('canvas')
      copy.width = copy.height = 1
      const context = copy.getContext('2d', { willReadFrequently: true })
      context.drawImage(c, X, Y, 1, 1, 0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return { X, Y, client: lastDown, rgba: { r: red, g: green, b: blue, a: alpha } }
    },
    colour: () => m.state().colour,
    documentPixel(x, y) {
      const d = m.state().document, i = (y * d.width + x) * 4, p = d.pixels.data
      return { r: p[i], g: p[i + 1], b: p[i + 2], a: p[i + 3] }
    },
    selection() {
      const s = m.state().selection
      if (!s) return null
      const pixels = []
      for (let i = 0; i < s.data.length && pixels.length < 4; i++) if (s.data[i]) pixels.push({ x: i % s.width, y: Math.floor(i / s.width) })
      return { count: s.count, pixels }
    },
    statusPixel: () => document.querySelector('.status-bar__pointer-value')?.textContent ?? null,
    zoomText: () => [...document.querySelectorAll('.status-bar *')].map((e) => e.textContent).find((t) => /^\\d+(\\.\\d+)?%$/.test(t)) ?? null,
    overlay() {
      const o = document.querySelector('.crop-overlay')
      if (!o) return null
      const numbers = o.querySelector('.crop-overlay__shade').getAttribute('d').match(/-?[\\d.]+(e-?\\d+)?/g).map(Number)
      const [x, y, w, h] = numbers.slice(5, 9)
      return { x, y, width: w, height: h }
    },
    /** Whether the overlay's edges are where the canvas starts and stops drawing the rectangle's columns and rows. */
    alignment() {
      const r = m.state().crop.rect, o = this.overlay(), dpr = devicePixelRatio
      const c = canvas(), shown = read(c)
      const L = Math.round(o.x * dpr), T = Math.round(o.y * dpr), R = Math.round((o.x + o.width) * dpr), B = Math.round((o.y + o.height) * dpr)
      const exactEdges = [o.x, o.y, o.x + o.width, o.y + o.height].every((v) => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6)
      const at = (X, Y) => (X < 0 || Y < 0 || X >= c.width || Y >= c.height || shown[(Y * c.width + X) * 4 + 3] !== 255 ? null : { column: shown[(Y * c.width + X) * 4] / 2, row: shown[(Y * c.width + X) * 4 + 1] / 3 })
      const midY = Math.floor((T + B) / 2), midX = Math.floor((L + R) / 2)
      const got = {
        insideLeft: at(L, midY)?.column, outsideLeft: at(L - 1, midY)?.column,
        insideRight: at(R - 1, midY)?.column, outsideRight: at(R, midY)?.column,
        insideTop: at(midX, T)?.row, outsideTop: at(midX, T - 1)?.row,
        insideBottom: at(midX, B - 1)?.row, outsideBottom: at(midX, B)?.row,
      }
      const want = {
        insideLeft: r.x, outsideLeft: r.x - 1, insideRight: r.x + r.width - 1, outsideRight: r.x + r.width,
        insideTop: r.y, outsideTop: r.y - 1, insideBottom: r.y + r.height - 1, outsideBottom: r.y + r.height,
      }
      const wrong = Object.keys(want).filter((k) => want[k] >= 0 && want[k] < (k.endsWith('Left') || k.endsWith('Right') ? 120 : 80) && got[k] !== want[k])
      return { ok: exactEdges && wrong.length === 0, exactEdges, wrong, got, want }
    },
    /** For the screenshot check: as crop.mjs's screenGeometry. */
    screenGeometry() {
      const c = canvas(), dpr = devicePixelRatio, r = c.getBoundingClientRect(), shown = read(c), o = this.overlay()
      let X0 = Infinity, X1 = -1, Y0 = Infinity, Y1 = -1
      for (let Y = 0; Y < c.height; Y++) for (let X = 0; X < c.width; X++) {
        if (shown[(Y * c.width + X) * 4 + 3]) { X0 = Math.min(X0, X); X1 = Math.max(X1, X); Y0 = Math.min(Y0, Y); Y1 = Math.max(Y1, Y) }
      }
      const clampY = (v) => Math.min(Math.max(v, Y0), Y1), clampX = (v) => Math.min(Math.max(v, X0), X1)
      const row = clampY(Math.floor((o.y + o.height / 4) * dpr)), column = clampX(Math.floor((o.x + o.width / 4) * dpr))
      return { left: r.left * dpr, top: r.top * dpr, X0, X1, Y0, Y1, row, column, line: Math.max(1, Math.floor(dpr)), rect: m.state().crop.rect }
    },
    showOverlay(visible, label = false) {
      document.querySelector('.crop-overlay').style.visibility = visible ? '' : 'hidden'
      document.querySelector('.crop-overlay__label').style.visibility = label ? '' : 'hidden'
      return true
    },
  }
  return true
})()`

const zoom = (browser, call) => browser.eval(`window.__mintyZoom.${call}`)

/**
 * Whether colour `c` (straight RGBA), drawn over one of the checkerboard's two greys, is `shown`
 * (canvas RGBA): exactly when opaque, within 2 levels when partly transparent (as colour.mjs).
 */
function composites(c, shown) {
  return [0x2c, 0x3a].some((grey) => {
    const limit = c.a === 255 ? 0 : 2
    return [c.r, c.g, c.b].every((v, k) => Math.abs((v * c.a + grey * (255 - c.a)) / 255 - [shown.r, shown.g, shown.b][k]) <= limit + 0.5) && shown.a === 255
  })
}

/** The device runs (first and last device pixel, canvas coordinates) showing each image column / row, from the canvas map. */
function runs(map) {
  const along = (values, start) => {
    const result = new Map()
    values.forEach((v, i) => {
      if (v === null || !Number.isInteger(v)) return
      const run = result.get(v)
      if (run) run.last = start + i
      else result.set(v, { first: start + i, last: start + i })
    })
    return result
  }
  return { columns: along(map.columns, map.X0), rows: along(map.rows, map.Y0) }
}

/**
 * The canvas is an exact nearest-neighbour enlargement along both lines: image columns (rows) in
 * order, none skipped or repeated after another, each shown for n or n + 1 device pixels (the first
 * and last runs may be cut by the canvas edge).
 */
function nearestNeighbour(map, size) {
  const problems = []
  for (const [name, values, count, start, limit] of [['column', map.columns, size.width, map.X0, map.width], ['row', map.rows, size.height, map.Y0, map.height]]) {
    if (values.some((v) => v === null || !Number.isInteger(v))) { problems.push(`${name}: a device pixel shows no single image pixel`); continue }
    for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1] && values[i] !== values[i - 1] + 1) problems.push(`${name}: ${values[i - 1]} then ${values[i]} at device ${start + i}`)
    const lengths = []
    let length = 1
    for (let i = 1; i <= values.length; i++) {
      if (i < values.length && values[i] === values[i - 1]) length++
      else { lengths.push(length); length = 1 }
    }
    const cut = { first: start === 0, last: start + values.length === limit }
    const inner = lengths.slice(cut.first ? 1 : 0, cut.last ? -1 : undefined)
    if (inner.length && Math.max(...inner) - Math.min(...inner) > 1) problems.push(`${name}: runs of ${Math.min(...inner)} to ${Math.max(...inner)} device pixels`)
    if (!cut.first && values[0] !== 0) problems.push(`${name}: starts at ${values[0]}`)
    if (!cut.last && values.at(-1) !== count - 1) problems.push(`${name}: ends at ${values.at(-1)}`)
  }
  return problems
}

/**
 * Screenshots with the crop overlay hidden and shown, along a row and a column through the
 * rectangle (as crop.mjs's screenAlignment): removed columns and rows darkened, the outline's light
 * line just inside each edge, every other pixel showing a kept column or row unchanged.
 */
async function screenAlignment(browser) {
  const g = await zoom(browser, 'screenGeometry()')
  await zoom(browser, 'showOverlay(false)')
  await settle(browser)
  const plain = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  await zoom(browser, 'showOverlay(true)')
  await settle(browser)
  const shaded = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  await zoom(browser, 'showOverlay(true, true)')
  const left = Math.round(g.left), top = Math.round(g.top)
  const at = (png, X, Y) => png.data.subarray(((Y + top) * png.width + X + left) * 4, ((Y + top) * png.width + X + left) * 4 + 3)
  const problems = []
  const line = (axis) => {
    const along = axis === 'x' ? [g.X0, g.X1] : [g.Y0, g.Y1]
    const point = (D) => (axis === 'x' ? [D, g.row] : [g.column, D])
    const [start, size] = axis === 'x' ? [g.rect.x, g.rect.width] : [g.rect.y, g.rect.height]
    const decode = (rgb) => (axis === 'x' ? rgb[0] / 2 : rgb[1] / 3)
    let first = null, after = null
    for (let D = along[0]; D <= along[1]; D++) {
      const index = decode(at(plain, ...point(D)))
      if (!Number.isInteger(index)) { problems.push(`${axis} ${D}: no image pixel on screen`); return null }
      if (first === null && index >= start) first = D
      if (after === null && index >= start + size) after = D
    }
    after ??= along[1] + 1
    for (let D = along[0]; D <= along[1]; D++) {
      const a = at(plain, ...point(D)), b = at(shaded, ...point(D))
      const same = a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
      const darkened = [0, 1, 2].every((k) => b[k] <= a[k] * 0.4 + 2) && (!same || Math.max(a[0], a[1], a[2]) <= 3)
      const white = b[0] === 255 && b[1] === 255 && b[2] === 255
      const kind = D < first || D >= after ? 'darkened' : D < first + g.line || D >= after - g.line ? 'white' : 'same'
      const ok = kind === 'darkened' ? darkened : kind === 'white' ? white : same
      if (!ok) problems.push(`${axis} ${D} (image ${decode(a)}): want ${kind}, got [${[...b]}] over [${[...a]}]`)
    }
    return { first, after }
  }
  const x = line('x'), y = line('y')
  return { ok: problems.length === 0, problems: problems.slice(0, 6), x, y, rect: g.rect }
}

/**
 * A real click in device pixel (X, Y) of the canvas: at its centre in Chrome; in Firefox, whose
 * driver sends whole CSS pixels, at a whole CSS pixel inside it when there is one (at fractional
 * ratios some device pixels contain none, and the click lands next to them; it is checked there).
 * Returns what was delivered and shown (observed()).
 */
async function clickDevice(browser, map, X, Y) {
  // Device pixel D of the canvas is screen device pixel D plus the canvas's corner, which the
  // browser puts on the device pixel nearest its layout position.
  const at = (D, layout) => {
    const origin = Math.round(layout * map.dpr) / map.dpr
    const centre = origin + (D + 0.5) / map.dpr
    if (!browser.name.startsWith('Firefox')) return centre
    const whole = Math.ceil(origin + (D - 0.01) / map.dpr)
    return Math.floor((whole - origin) * map.dpr + 0.01) === D ? whole : Math.round(centre)
  }
  await browser.click(at(X, map.left), at(Y, map.top))
  await settle(browser)
  return zoom(browser, 'observed()')
}

/** The device pixels to click: the first and last device pixels of each target pixel, and the one just before it. */
function targets(map, pixels) {
  const { columns, rows } = runs(map)
  const points = []
  for (const [x, y] of pixels) {
    const c = columns.get(x), r = rows.get(y)
    if (!c || !r) continue
    points.push([c.first, r.first], [c.last, r.last], [c.first, r.last], [c.last, r.first], [c.first - 1, r.first - 1])
  }
  return points
}

const PIXELS = [[0, 0], [1, 1], [2, 2], [37, 21], [77, 53]]

const percent = (zoom) => `${(zoom * 100).toFixed(2)}%`

/**
 * Two neighbouring display grid scales (p / q with p, q ≤ 64, or whole numbers) either side of
 * `scale`, worked out here independently of the app: the zooms just below and just above the point
 * where the display changes from one to the other must both be drawn and read consistently.
 */
function gridTransition(scale) {
  const values = new Set()
  for (let q = 1; q <= 64; q++) for (let p = 1; p <= 64 * q; p++) if ((q === 1 || p <= 64) && Math.abs(p / q - scale) < 0.05 * scale) values.add(p / q)
  const sorted = [...values].sort((a, b) => a - b)
  const i = sorted.findIndex((v) => v > scale)
  return (sorted[i - 1] + sorted[i]) / 2
}

/** The views: [label, how to get there from 100%, whether to also check the stripes, the zoom it must reach]. */
function views(browser, ratio) {
  const transition = gridTransition(1.33 * ratio) / ratio
  return [
    ['100% (Fit for this image)', async () => dispatch(browser, { type: 'zoom-fitted' }), false],
    ['100.01%: just above 100% (Ctrl + wheel)', async () => zoom(browser, `wheelEvent(${deltaFor(1.0001)})`), false],
    [`${percent(transition)}: just below a display grid transition (Ctrl + wheel)`, async () => zoom(browser, `wheelEvent(${deltaFor(transition * (1 - 1e-7))})`), false],
    [`${percent(transition)}: just above a display grid transition (Ctrl + wheel)`, async () => zoom(browser, `wheelEvent(${deltaFor(transition * (1 + 1e-7))})`), false],
    ['147.65625%: one Ctrl + wheel event from 100% (Codex)', async () => zoom(browser, `wheelEvent(${deltaFor(TIE)})`), true, TIE],
    ['just above 147.65625% (Ctrl + wheel)', async () => zoom(browser, `wheelEvent(${deltaFor(TIE * (1 + 1e-6))})`), false],
    ['just below 147.65625% (Ctrl + wheel)', async () => zoom(browser, `wheelEvent(${deltaFor(TIE * (1 - 1e-6))})`), false],
    ['237.37% (Ctrl + wheel)', async () => zoom(browser, `wheelEvent(${deltaFor(2.3737)})`), false],
    [`${percent(1.25 ** 1.75)}: real Ctrl + wheel, 175 px`, async () => browser.wheel(...Object.values(await zoom(browser, 'centre()')), { deltaY: -175, ctrl: true }), true],
    [`${percent(1.25 ** 0.37)}: real Ctrl + wheel, 37 px`, async () => browser.wheel(...Object.values(await zoom(browser, 'centre()')), { deltaY: -37, ctrl: true }), false],
    [`${percent(1.25 ** 3.33)}: real Ctrl + wheel, 120 px then 213 px`, async () => {
      const c = await zoom(browser, 'centre()')
      await browser.wheel(c.x, c.y, { deltaY: -120, ctrl: true })
      await settle(browser)
      await browser.wheel(c.x, c.y, { deltaY: -213, ctrl: true })
    }, true],
    [`${percent(1.25 ** 5.77)}: real Ctrl + wheel, 300 px then 277 px`, async () => {
      const c = await zoom(browser, 'centre()')
      await browser.wheel(c.x, c.y, { deltaY: -300, ctrl: true })
      await settle(browser)
      await browser.wheel(c.x, c.y, { deltaY: -277, ctrl: true })
    }, false],
  ]
}

const PANS = [['', null], [', panned', { x: 13.3, y: -7.7 }], [', panned again', { x: -29.9, y: 17.45 }]]

async function run(browser, url, name) {
  const tag = (text) => `${name}: ${text}`
  await load(browser, url)
  if (!(await ev(browser, ZOOM_HELPERS))) throw new Error('Could not install the zoom helpers')

  const ratio = await ev(browser, 'devicePixelRatio')
  for (const [label, reach, stripes, expectZoom] of views(browser, ratio)) {
    // Two fractional pans at Codex's level and the first real-wheel level, one elsewhere.
    for (const [pan, delta] of stripes ? PANS : PANS.slice(0, 2)) {
      // Fresh state for each view: crop-columns.png at 100%, then the zoom as a user reaches it.
      await openWithAnswer(browser, fixture('crop-columns.png'))
      await dispatch(browser, { type: 'zoom-actual-size' })
      await settle(browser)
      await reach()
      await settle(browser)
      if (delta) {
        await dispatch(browser, { type: 'wheel-panned', delta })
        await settle(browser)
      }
      const view = `${label}${pan}`
      const stored = await ev(browser, 'window.__minty.state().viewport.zoom')
      if (expectZoom !== undefined && !pan) report.check(tag(`${view}: the wheel event zoomed to ${expectZoom} (stored ${stored})`), Math.abs(stored - expectZoom) < 1e-12)

      // Exactly 100% at a ratio off the display grid is drawn smoothed (Actual Size, Option D): the
      // canvas shows blends, so the checks below, which decode single image pixels from the screen,
      // do not apply. They are reported as skipped, not passed; zoom-anchor.mjs checks that view.
      if (await zoom(browser, 'smoothed()')) {
        for (const check of ['nearest-neighbour enlargement', 'Eyedropper', 'Magic Wand and status bar', 'crop overlay (canvas and screen)'])
          report.skip(tag(`${view}: ${check}`), 'smoothed 100% view at a ratio off the display grid; covered by zoom-anchor.mjs')
        continue
      }

      // The canvas as drawn.
      const map = await zoom(browser, 'canvasMap()')
      const problems = map ? nearestNeighbour(map, { width: 120, height: 80 }) : ['nothing drawn']
      report.check(tag(`${view}: the canvas is an exact nearest-neighbour enlargement (${map ? `${map.X1 - map.X0 + 1} device columns for ${new Set(map.columns).size} image columns` : ''})`), problems.length === 0, json(problems.slice(0, 4)))
      if (!map) continue

      // Eyedropper. Each tool's options row has its own height, which moves the canvas: the canvas
      // is read again after choosing the tool.
      await dispatch(browser, { type: 'tool-selected', tool: 'eyedropper' })
      await settle(browser)
      const eyedropperMap = await zoom(browser, 'canvasMap()')
      const wrong = []
      let clicks = 0
      let onTarget = 0
      for (const [X, Y] of targets(eyedropperMap, PIXELS)) {
        const seen = await clickDevice(browser, eyedropperMap, X, Y)
        if (seen && seen.X === X && seen.Y === Y) onTarget++
        const state = await zoom(browser, 'colour()')
        clicks++
        if (!seen?.rgba || seen.rgba.a === 0) continue
        const pixel = { x: seen.rgba.r / 2, y: seen.rgba.g / 3 }
        const bytes = await zoom(browser, `documentPixel(${pixel.x}, ${pixel.y})`)
        if (!(json(state?.sample?.pixel) === json(pixel) && json(state?.value) === json(bytes) && json(state?.value) === json(seen.rgba))) wrong.push({ X, Y, seen, pixel, read: state?.sample?.pixel, value: state?.value })
      }
      // Firefox delivers pointers at whole CSS pixels, so at fractional ratios some clicks land on a
      // neighbouring device pixel; they are still checked there.
      report.check(tag(`${view}: ${clicks} Eyedropper clicks on the first and last device pixels of image pixels (0, 0), (1, 1), (2, 2), (37, 21), (77, 53) (${onTarget} delivered exactly there) read exactly the pixel the screen shows there`), wrong.length === 0 && clicks >= 20, json(wrong.slice(0, 3)))

      // Magic Wand at tolerance 0 and the status bar.
      await dispatch(browser, { type: 'tool-selected', tool: 'magic-wand' })
      await dispatch(browser, { type: 'magic-wand-tolerance-changed', tolerance: 0 })
      await settle(browser)
      const wandMap = await zoom(browser, 'canvasMap()')
      const wandWrong = []
      let wandClicks = 0
      for (const [X, Y] of targets(wandMap, PIXELS).filter((_, i) => i % 5 !== 2)) {
        await dispatch(browser, { type: 'selection-cleared' })
        const seen = await clickDevice(browser, wandMap, X, Y)
        const selection = await zoom(browser, 'selection()')
        const status = await zoom(browser, 'statusPixel()')
        wandClicks++
        if (!seen?.rgba || seen.rgba.a === 0) {
          if (selection !== null) wandWrong.push({ X, Y, seen, selection })
          continue
        }
        const pixel = { x: seen.rgba.r / 2, y: seen.rgba.g / 3 }
        if (!(selection?.count === 1 && json(selection.pixels[0]) === json(pixel) && status === `${pixel.x}, ${pixel.y}`)) wandWrong.push({ X, Y, seen, pixel, selection, status })
      }
      await dispatch(browser, { type: 'selection-cleared' })
      report.check(tag(`${view}: ${wandClicks} Magic Wand clicks at tolerance 0 select exactly the pixel the screen shows under the pointer, and the status bar names it`), wandWrong.length === 0 && wandClicks >= 15, json(wandWrong.slice(0, 3)))

      // Crop.
      await dispatch(browser, { type: 'tool-selected', tool: 'crop' })
      for (const rect of [{ x: 1, y: 1, width: 41, height: 33 }, { x: 37, y: 21, width: 41, height: 33 }]) {
        await dispatch(browser, { type: 'crop-cancelled' })
        for (const field of ['width', 'height', 'x', 'y']) await dispatch(browser, { type: 'crop-field-changed', field, value: rect[field] })
        await settle(browser)
        const a = await zoom(browser, 'alignment()')
        report.check(tag(`${view}: the crop overlay for ${json(rect)} has its edges exactly where the canvas starts and stops drawing the kept columns and rows`), a.ok, json(a))
        const screen = await screenAlignment(browser)
        report.check(tag(`${view}: on screen, the crop overlay for ${json(rect)} darkens exactly the removed columns and rows, nothing partly`), screen.ok, json(screen))
      }
      await dispatch(browser, { type: 'crop-cancelled' })

      // Sharp alternating colours and transparency at the same view.
      if (stripes && !pan) {
        await openWithAnswer(browser, fixture('colour-stripes.png'))
        await dispatch(browser, { type: 'zoom-actual-size' })
        await settle(browser)
        await reach()
        await settle(browser)
        await dispatch(browser, { type: 'tool-selected', tool: 'eyedropper' })
        await settle(browser)
        const stripeMap = await zoom(browser, 'canvasMap()')
        const bad = []
        let transparent = 0, partial = 0, n = 0
        // Every device pixel along the diagonal from the image's corner, over its first 12 pixels.
        const length = Math.min(stripeMap.X1 - stripeMap.X0, stripeMap.Y1 - stripeMap.Y0, Math.ceil(12 * (stripeMap.X1 - stripeMap.X0 + 1) / 60))
        for (let D = -1; D <= length; D++) {
          const before = await zoom(browser, 'colour()')
          const seen = await clickDevice(browser, stripeMap, stripeMap.X0 + D, stripeMap.Y0 + D)
          const state = await zoom(browser, 'colour()')
          n++
          if (!seen?.rgba || seen.rgba.a === 0) {
            if (json(state) !== json(before)) bad.push({ D, seen, read: state?.sample?.pixel })
            continue
          }
          const p = state?.sample?.pixel
          // The bytes the document stores (the browser's PNG decoder already changed hidden colour
          // under alpha 0, and rounds partly transparent colours; Phase 1), and the pixel's alpha
          // in the fixture, which names its row and diagonal.
          const stored = p && (await zoom(browser, `documentPixel(${p.x}, ${p.y})`))
          const exact = !!p && json(state.value) === json(stored) && state.value.a === stripePixel(p.x, p.y)[3]
          if (state?.value.a === 0) transparent++
          else if (state?.value.a < 255) partial++
          if (!(exact && composites(state.value, seen.rgba))) bad.push({ D, seen, read: p, value: state?.value })
        }
        report.check(
          tag(`${view}: ${n} Eyedropper clicks along the diagonal of sharp alternating colours read exactly the pixel shown, stored bytes included (${transparent} fully, ${partial} partly transparent)`),
          bad.length === 0 && transparent > 0 && partial > 0,
          json(bad.slice(0, 3)),
        )
      }
    }
  }
  const errors = await ev(browser, 'window.__minty.errors')
  const warnings = await zoom(browser, 'warnings()')
  report.check(tag('no page errors or console warnings'), errors.length === 0 && warnings.length === 0, json([...errors, ...warnings].slice(0, 3)))
}

ensureCropFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) {
    for (const dpr of ratios) {
      const browser = await launch(name, { dpr })
      try {
        await run(browser, server.url, browser.name)
      } catch (error) {
        report.check(`${browser.name}: completed`, false, error.stack ?? String(error))
      } finally {
        await browser.close()
      }
    }
  }
} finally {
  await server.close()
}
report.finish()
