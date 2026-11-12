// The Phase 4 zoom follow-up (Codex, 2026-11-11) and Actual Size (owner decision, Option D) in
// headless Chrome and Firefox (software rendering).
//
//   npm run build
//   node scripts/browser/zoom-anchor.mjs [--browser chrome|firefox|all] [--dpr 1,1.01,1.1,1.19,1.25,1.5,2,3]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// The oracle is what the browser is actually given and shows, never the app's coordinate mapping:
// the transform and smoothing flag of every drawImage call that draws the image on the workspace
// canvas (recorded from the canvas context itself, CanvasRenderingContext2D.getTransform), the
// positions the browser delivered presses and wheel events at, canvas readback and screenshots
// (crop-columns.png: red / 2 is the column, green / 3 the row) and the controls' DOM state. Input is
// real (trusted) unless stated: clicks and Ctrl + wheel through the Chrome DevTools Protocol and
// WebDriver BiDi; tool choices and the screen check's setup are dispatched actions. For each ratio:
// - Actual Size (a real click on the 100% button) displays exactly 100%: devicePixelRatio device
//   pixels per image pixel, readout 100%. Where the ratio is a display grid scale (worked out here)
//   it is crisp, an exact nearest-neighbour enlargement; elsewhere (Chrome at 1.01 and 1.19) it is
//   smoothed, and real Eyedropper clicks read the exact stored bytes of the pixel nearest the device
//   pixel centre, the largest part of the blended colour shown there.
// - With each tool's options row above the canvas (each moves it, often to a fractional device
//   pixel), the canvas bitmap is the size of the box the browser lays it out in, and the screenshot
//   equals canvas readback exactly at the device pixel the browser puts its corner on.
// - Real Ctrl + wheel input (one 100 px notch at a time, as a mouse wheel sends it) at fixed
//   pointers over the image: 15 notches up and 15 back return to exactly the 100% transform, and
//   from 100% to 3200% the image point drawn under the delivered pointer position at 100% stays
//   drawn within one device pixel of it at every step (Codex measured 7.5 device pixels at 150%
//   scaling before the fix).
// - Zoom In clicked repeatedly from 100% to 3200%: the image point drawn at the workspace centre
//   stays within one device pixel of it.
// - At the requested 3200%: the displayed zoom and readout are not above 3200%, Zoom In is disabled
//   (also where the displayed zoom is below 3200%), and a real click on it and a Ctrl + wheel notch
//   change nothing; Zoom Out is enabled.
// No page errors or console warnings.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, dispatch, settle, serveBuild } from './lib/app.mjs'
import { decodePng } from './lib/png.mjs'
import { ev, json, load } from './lib/edges.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { ensureCropFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,1.01,1.1,1.19,1.25,1.5,2,3' },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()
const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name)

/** Installed as window.__mintyAnchor. */
const ANCHOR_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const canvas = () => document.querySelector('canvas.workspace__canvas')
  // Every transform the image is drawn with, as the canvas context holds it at the drawImage call.
  const draws = []
  const drawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (args.length === 9 && this.canvas === canvas()) {
      const t = this.getTransform()
      draws.push({ a: t.a, d: t.d, e: t.e, f: t.f, smoothing: this.imageSmoothingEnabled })
      if (draws.length > 50) draws.shift()
    }
    return drawImage.apply(this, args)
  }
  let lastDown = null
  addEventListener('pointerdown', (e) => { const r = canvas().getBoundingClientRect(), d = devicePixelRatio; lastDown = { x: e.clientX - Math.round(r.left * d) / d, y: e.clientY - Math.round(r.top * d) / d } }, true)
  // The position each wheel event was delivered at, relative to the canvas's corner on screen (the
  // device pixel nearest its layout position, where the browser draws it from), in CSS px.
  let lastWheel = null
  addEventListener('wheel', (e) => { const r = canvas().getBoundingClientRect(), d = devicePixelRatio; lastWheel = { x: e.clientX - Math.round(r.left * d) / d, y: e.clientY - Math.round(r.top * d) / d } }, true)
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); return warn.apply(console, args) }
  const button = (title) => document.querySelector('.status-bar__zoom button[title="' + title + '"]')
  window.__mintyAnchor = {
    warnings: () => warnings,
    drawn: () => draws.at(-1) ?? null,
    lastWheel: () => lastWheel,
    stored: () => m.state().viewport.zoom,
    ratio: () => devicePixelRatio,
    zoomText: () => document.querySelector('.status-bar__zoom-value [aria-hidden]')?.textContent ?? null,
    /** A button's centre (client CSS px) and whether it is disabled. */
    button(title) { const b = button(title), r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled } },
    /** A point on the canvas (client CSS px) at a fraction of its size. */
    point(fx, fy) { const r = canvas().getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy, left: r.left, top: r.top, width: r.width, height: r.height } },
    /** The last press, in CSS px from the canvas's corner on screen. */
    lastDown: () => lastDown,
    colour: () => m.state().colour,
    documentPixel(x, y) { const d = m.state().document, i = (y * d.width + x) * 4, p = d.pixels.data; return { r: p[i], g: p[i + 1], b: p[i + 2], a: p[i + 3] } },
    /** The canvas's colour at device pixel (X, Y) of its bitmap. */
    canvasPixel(X, Y) {
      const c = canvas(), k = document.createElement('canvas'); k.width = k.height = 1
      const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(c, X, Y, 1, 1, 0, 0, 1, 1)
      const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data
      return { r, g, b, a }
    },
    /** The whole bitmap (RGBA) and where the browser lays the canvas out, and its device-pixel-content-box. */
    async layout() {
      const c = canvas(), r = c.getBoundingClientRect(), d = devicePixelRatio
      const box = await new Promise((resolve) => { const o = new ResizeObserver((e) => { o.disconnect(); const s = e[0].devicePixelContentBoxSize?.[0]; resolve(s ? { width: s.inlineSize, height: s.blockSize } : null) }); o.observe(c, { box: 'device-pixel-content-box' }) })
      const k = document.createElement('canvas'); k.width = c.width; k.height = c.height
      const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0)
      const data = Array.from(x.getImageData(0, 0, c.width, c.height).data)
      return { backing: { width: c.width, height: c.height }, box, top: r.top * d, left: r.left * d, data }
    },
    /** The image columns shown along the middle row of the drawn image (crop-columns.png: red / 2). */
    columns() {
      const c = canvas(), copy = document.createElement('canvas')
      copy.width = c.width; copy.height = c.height
      const x = copy.getContext('2d', { willReadFrequently: true })
      x.drawImage(c, 0, 0)
      const data = x.getImageData(0, 0, c.width, c.height).data
      let Y0 = -1, Y1 = -1
      for (let Y = 0; Y < c.height; Y++) { let any = false; for (let X = 0; X < c.width; X++) if (data[(Y * c.width + X) * 4 + 3]) { any = true; break } if (any) { if (Y0 < 0) Y0 = Y; Y1 = Y } }
      const Y = Math.floor((Y0 + Y1) / 2), shown = []
      for (let X = 0; X < c.width; X++) { const i = (Y * c.width + X) * 4; if (data[i + 3] === 255) shown.push(data[i] / 2) }
      copy.width = copy.height = 0
      return shown
    },
  }
  return true
})()`

const anchor = (browser, call) => browser.eval(`window.__mintyAnchor.${call}`)

/**
 * Whether `ratio` is a display grid scale (p / q with p, q ≤ 64, or a whole number, to within 1e-7),
 * worked out here independently of the app: Actual Size is crisp there and smoothed elsewhere.
 */
function onGrid(ratio) {
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(ratio * q)
    if (p >= 1 && (q === 1 || p <= 64) && Math.abs(p / q - ratio) <= 1e-7 * ratio) return true
  }
  return false
}

/** Whether `shown` is each of 0 … count - 1 once, in order, with runs differing by at most one device pixel. */
function enlargement(shown, count) {
  if (shown.some((v) => !Number.isInteger(v))) return false
  const lengths = []
  for (let i = 0; i < shown.length; i++) {
    if (i === 0 || shown[i] !== shown[i - 1]) {
      if (shown[i] !== (i === 0 ? 0 : shown[i - 1] + 1)) return false
      lengths.push(1)
    } else lengths[lengths.length - 1]++
  }
  return lengths.length === count && Math.max(...lengths) - Math.min(...lengths) <= 1
}

async function clickButton(browser, title) {
  const b = await anchor(browser, `button(${json(title)})`)
  await browser.click(b.x, b.y)
  await settle(browser)
}

async function run(browser, url, name, requestedRatio) {
  const tag = (text) => `${name}: ${text}`
  await load(browser, url)
  if (!(await ev(browser, ANCHOR_HELPERS))) throw new Error('Could not install the anchor helpers')
  const ratio = await anchor(browser, 'ratio()')
  const firefox = name.startsWith('Firefox')

  // Actual Size (owner decision, Option D): exactly 100% everywhere; crisp where the ratio is a
  // display grid scale (worked out here independently), smoothed where it is not.
  await openWithAnswer(browser, fixture('crop-columns.png'))
  await settle(browser)
  await clickButton(browser, 'Zoom In')
  await clickButton(browser, 'Actual Size (100%)')
  const actual = await anchor(browser, 'drawn()')
  const stored = await anchor(browser, 'stored()')
  const text = await anchor(browser, 'zoomText()')
  const crisp = onGrid(ratio)
  // Both browsers hold canvas transforms in single precision, so the scale read back is the
  // float32 nearest the one drawn with: within 1e-6 (0.58% separates 101% scaling's two candidates).
  const exact = Math.abs(actual.a - ratio) <= 1e-6 * ratio && Math.abs(actual.d - ratio) <= 1e-6 * ratio
  const detail = json({ devicePixelRatio: ratio, drawnScale: actual.a, displayed: `${((actual.a / ratio) * 100).toFixed(4)}%`, smoothing: actual.smoothing, stored, readout: text })
  report.check(
    tag(`Actual Size at ratio ${ratio} (requested ${requestedRatio}) displays exactly 100%: ${ratio} device pixels per image pixel, readout 100%, drawn ${crisp ? 'crisp (ratio on the display grid)' : 'smoothed (ratio off the display grid)'}`),
    exact && text === '100%' && stored === 1 && actual.smoothing === !crisp,
    detail,
  )
  if (crisp) {
    const shown = await anchor(browser, 'columns()')
    report.check(tag(`Actual Size at ratio ${ratio}: an exact nearest-neighbour enlargement, 120 columns once each across ${shown.length} device pixels`), enlargement(shown, 120) && Math.abs(shown.length - 120 * actual.a) <= 1, json(shown.slice(0, 12)))
  } else {
    // Smoothed: real Eyedropper clicks read the exact stored bytes of the pixel nearest the device
    // pixel's centre (from the transform the browser was given), and that pixel is the largest
    // part of the colour shown there (crop-columns.png: red / 2 is the column).
    await dispatch(browser, { type: 'tool-selected', tool: 'eyedropper' })
    await settle(browser)
    const t = await anchor(browser, 'drawn()')
    const corner = await anchor(browser, 'point(0, 0)')
    const wrong = []
    let clicks = 0
    for (let i = 0; i < 40; i++) {
      const X = Math.round(t.e) + 3 + Math.floor(i * 2.9 * t.a), Y = Math.round(t.f) + 5 + Math.floor(i * 1.7 * t.a)
      const screenLeft = Math.round(corner.left * ratio) / ratio, screenTop = Math.round(corner.top * ratio) / ratio
      const cx = screenLeft + (X + 0.5) / ratio, cy = screenTop + (Y + 0.5) / ratio
      await browser.click(firefox ? Math.round(cx) : cx, firefox ? Math.round(cy) : cy)
      await settle(browser)
      const down = await anchor(browser, 'lastDown()')
      const DX = Math.floor(down.x * ratio + 0.01), DY = Math.floor(down.y * ratio + 0.01)
      const pixel = { x: Math.floor((DX + 0.5 - t.e) / t.a), y: Math.floor((DY + 0.5 - t.f) / t.d) }
      if (pixel.x < 0 || pixel.y < 0 || pixel.x >= 120 || pixel.y >= 80) continue
      clicks++
      const state = await anchor(browser, 'colour()')
      const bytes = await anchor(browser, `documentPixel(${pixel.x}, ${pixel.y})`)
      const shownColour = await anchor(browser, `canvasPixel(${DX}, ${DY})`)
      const dominant = Math.abs(shownColour.r / 2 - pixel.x) <= 0.75 && Math.abs(shownColour.g / 3 - pixel.y) <= 0.75
      if (!(json(state?.sample?.pixel) === json(pixel) && json(state?.value) === json(bytes) && dominant)) wrong.push({ DX, DY, pixel, read: state?.sample?.pixel, value: state?.value, bytes, shownColour })
    }
    report.check(tag(`Actual Size smoothed at ratio ${ratio}: ${clicks} real Eyedropper clicks read the exact stored bytes of the pixel nearest the device pixel centre, which dominates the colour shown`), clicks >= 30 && wrong.length === 0, json(wrong.slice(0, 3)))
  }

  // What is on screen is exactly the canvas: its bitmap is the size of the box the browser lays it
  // out in, and the screenshot (overlays hidden) equals canvas readback at the device pixel the
  // browser puts the canvas's corner on, with each tool's options row above (each moves the canvas).
  for (const tool of ['magic-wand', 'eyedropper', 'crop', 'auto-trim']) {
    await openWithAnswer(browser, fixture('crop-columns.png'))
    await dispatch(browser, { type: 'zoom-actual-size' })
    await dispatch(browser, { type: 'zoom-scaled', anchor: { x: 400, y: 300 }, factor: 1.4765625 })
    await dispatch(browser, { type: 'tool-selected', tool })
    if (tool === 'crop') for (const [field, value] of [['width', 41], ['height', 33], ['x', 1], ['y', 1]]) await dispatch(browser, { type: 'crop-field-changed', field, value })
    await settle(browser)
    await ev(browser, "(document.querySelectorAll('.crop-overlay, .workspace__overlay').forEach((e) => (e.style.visibility = 'hidden')), true)")
    await settle(browser)
    const l = await anchor(browser, 'layout()')
    const shot = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
    const dy = Math.round(l.top), dx = Math.round(l.left)
    let mismatches = 0, compared = 0
    for (let Y = 0; Y < l.backing.height; Y += 3) for (let X = 0; X < l.backing.width; X += 3) {
      const i = (Y * l.backing.width + X) * 4
      if (!l.data[i + 3]) continue
      const j = ((Y + dy) * shot.width + X + dx) * 4
      compared++
      if (l.data[i] !== shot.data[j] || l.data[i + 1] !== shot.data[j + 1] || l.data[i + 2] !== shot.data[j + 2]) mismatches++
    }
    const sized = !l.box || (l.box.width === l.backing.width && l.box.height === l.backing.height)
    report.check(
      tag(`with the ${tool} tool (canvas laid out at device ${l.top.toFixed(3)}), the canvas bitmap is the browser's device box (${json(l.backing)} vs ${json(l.box)}) and the screen shows exactly its pixels (${compared} compared at the corner device pixel ${dy})`),
      sized && compared > 1000 && mismatches === 0,
      json({ mismatches }),
    )
  }

  // Real Ctrl + wheel from 100% to 3200% at a fixed pointer, then back.
  // Pointers over the image (fractions of its width and height at 100%), one at the workspace centre.
  for (const [fx, fy] of [[0.37, 0.41], [0.5, 0.5], [0.613, 0.287]]) {
    await openWithAnswer(browser, fixture('crop-columns.png'))
    await settle(browser)
    await clickButton(browser, 'Actual Size (100%)')
    const shownAt = await anchor(browser, 'drawn()')
    const c = await anchor(browser, 'point(0, 0)')
    const p = { x: c.left + (shownAt.e + 120 * shownAt.a * fx) / ratio, y: c.top + (shownAt.f + 80 * shownAt.d * fy) / ratio }
    // Chrome takes fractional positions; Firefox's driver whole CSS pixels.
    const at = firefox ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: p.x + 0.137, y: p.y + 0.291 }
    await browser.wheel(at.x, at.y, { deltaY: 1, ctrl: true })
    await settle(browser)
    await clickButton(browser, 'Actual Size (100%)')
    const start = await anchor(browser, 'drawn()')
    const delivered = await anchor(browser, 'lastWheel()')
    // The image point drawn under the delivered pointer position at 100%.
    const target = { x: (delivered.x * ratio - start.e) / start.a, y: (delivered.y * ratio - start.f) / start.d }
    const notch = async (deltaY) => {
      await browser.wheel(at.x, at.y, { deltaY, ctrl: true })
      await settle(browser)
      const t = await anchor(browser, 'drawn()')
      const w = await anchor(browser, 'lastWheel()')
      return Math.max(Math.abs(t.a * target.x + t.e - w.x * ratio), Math.abs(t.d * target.y + t.f - w.y * ratio))
    }
    // 15 notches up (2842%) and 15 back: below the limit, so the way back is the exact reverse.
    for (let i = 0; i < 15; i++) await notch(-100)
    for (let i = 0; i < 15; i++) await notch(100)
    const back = await anchor(browser, 'drawn()')
    const same = back.a === start.a && Math.abs(back.e - start.e) < 1e-6 && Math.abs(back.f - start.f) < 1e-6
    report.check(tag(`real Ctrl + wheel at (${fx}, ${fy}) of the image, 15 notches up and 15 back, returns to exactly the 100% transform`), same, json({ start, back, stored: await anchor(browser, 'stored()') }))
    // Then up to the limit.
    let worst = 0
    let steps = 0
    const moved = []
    while ((await anchor(browser, 'stored()')) < 32 && steps < 30) {
      const off = await notch(-100)
      steps++
      moved.push(+off.toFixed(3))
      worst = Math.max(worst, off)
    }
    const top = await anchor(browser, 'stored()')
    report.check(
      tag(`real Ctrl + wheel at (${fx}, ${fy}) of the image, ${steps} notches from 100% to ${(top * 100).toFixed(0)}%: the image point drawn under the pointer at 100% stays within 1 device pixel of it (worst ${worst.toFixed(3)})`),
      top === 32 && worst <= 1 + 1e-6,
      json(moved),
    )
  }

  // Zoom In from 100% to 3200%, about the workspace centre.
  await openWithAnswer(browser, fixture('crop-columns.png'))
  await settle(browser)
  await clickButton(browser, 'Actual Size (100%)')
  const centre = await anchor(browser, 'point(0.5, 0.5)')
  const middle = { x: centre.width / 2, y: centre.height / 2 }
  const first = await anchor(browser, 'drawn()')
  const target = { x: (middle.x * ratio - first.e) / first.a, y: (middle.y * ratio - first.f) / first.d }
  let worst = 0
  let presses = 0
  while (!(await anchor(browser, 'button("Zoom In")')).disabled && presses < 20) {
    await clickButton(browser, 'Zoom In')
    presses++
    const t = await anchor(browser, 'drawn()')
    worst = Math.max(worst, Math.abs(t.a * target.x + t.e - middle.x * ratio), Math.abs(t.d * target.y + t.f - middle.y * ratio))
  }
  const top = await anchor(browser, 'stored()')
  report.check(tag(`${presses} Zoom In clicks from 100% to ${(top * 100).toFixed(0)}% keep the image point drawn at the workspace centre within 1 device pixel (worst ${worst.toFixed(3)})`), top === 32 && worst <= 1 + 1e-6)

  // At the requested maximum.
  const zoomIn = await anchor(browser, 'button("Zoom In")')
  const zoomOut = await anchor(browser, 'button("Zoom Out")')
  const before = await anchor(browser, 'drawn()')
  const readout = await anchor(browser, 'zoomText()')
  await browser.click(zoomIn.x, zoomIn.y)
  await settle(browser)
  const p = await anchor(browser, 'point(0.5, 0.5)')
  await browser.wheel(Math.round(p.x), Math.round(p.y), { deltaY: -100, ctrl: true })
  await settle(browser)
  const after = await anchor(browser, 'drawn()')
  const displayed = before.a / ratio
  report.check(
    tag(`at the requested 3200% (displayed ${(displayed * 100).toFixed(2)}%, readout ${readout}): not above 3200%, Zoom In is disabled, Zoom Out enabled, and a click on Zoom In or a Ctrl + wheel notch changes nothing`),
    zoomIn.disabled && !zoomOut.disabled && (await anchor(browser, 'stored()')) === 32 && json(after) === json(before) && displayed <= 32 * (1 + 1e-6) && parseFloat(readout) <= 3200,
    json({ zoomIn: zoomIn.disabled, zoomOut: zoomOut.disabled, before, after }),
  )

  const errors = await ev(browser, 'window.__minty.errors')
  const warnings = await anchor(browser, 'warnings()')
  report.check(tag('no page errors or console warnings'), errors.length === 0 && warnings.length === 0, json([...errors, ...warnings].slice(0, 3)))
}

ensureCropFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) {
    for (const dpr of ratios) {
      const browser = await launch(name, { dpr })
      try {
        await run(browser, server.url, browser.name, dpr)
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
