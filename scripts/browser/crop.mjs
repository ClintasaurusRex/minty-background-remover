// Manual Crop (Phase 4) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/crop.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3] [--no-perf] [--no-stress]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real pointer drags, clicks and key presses:
// - The toolbar's Crop tool and its options row: pressed state, fields, hint, Apply Crop and Cancel
//   (unavailable but focusable without a rectangle).
// - Drawing, moving and resizing the rectangle with the mouse at 400%: whole image pixels, the
//   nearest edges; dragging outside the image stops at its edges; a click without a drag leaves
//   none. The overlay's size label and the fields follow.
// - Alignment: at several zoom levels (Fit, 100%, 150%, 200%, 300%, 800%), each with fractional
//   pans, at device pixel ratios 1, 1.25, 1.5, 2 and 3 by default: the overlay's edges lie exactly
//   on the device pixels where the image canvas starts showing the first kept column and row and
//   stops after the last (read from the canvas itself), and on screen (screenshots, the overlay
//   hidden and shown) the overlay darkens exactly the removed columns and rows and no pixel partly.
//   At fractional scales the canvas is also checked to be an exact nearest-neighbour enlargement
//   (compareImage, which reads the column and row mapping from the canvas, not from the app).
// - Escape cancels a pending crop without clearing the selection; with nothing pending it still
//   clears the selection. Fields: typing, Enter (never crops), Escape.
// - Apply with Enter, with the Apply Crop button, and by keyboard only (Chrome): the document is
//   exactly the rectangle cut from the image before it (every byte, in the page), the canvas shows
//   it, the selection is cleared, the view is fitted; Undo and Redo (keys) are exact.
// - Export after a crop writes exactly the cropped image (decoded in Node); a rectangle not applied
//   is never part of an export.
// - Choosing another tool or opening another image drops the rectangle; Apply is unavailable while
//   another image opens. One live display image at the end; no page errors or console warnings.
// - Unless --no-perf: Apply, Undo and Redo times (the synchronous handlers, display image included)
//   and the history size at 4K and (unless --no-stress) near 50 MP. Times are reported, never checked.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, serveBuild, settle } from './lib/app.mjs'
import { edit, ev, json, load } from './lib/edges.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { decodePng } from './lib/png.mjs'
import { ensureCropFixtures, ensureEdgeFixtures, ensureTrimFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,1.25,1.5,2,3' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()
const FIXTURES = path.join(import.meta.dirname, 'fixtures')
const fixture = (name) => path.join(FIXTURES, name)

/** Installed after the edit and edge helpers as window.__mintyCrop. */
const CROP_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const base64 = (bytes) => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(out)
  }
  const canvas = () => document.querySelector('canvas.workspace__canvas')
  const read = (source) => {
    const copy = document.createElement('canvas')
    copy.width = source.width
    copy.height = source.height
    const context = copy.getContext('2d', { willReadFrequently: true })
    context.drawImage(source, 0, 0)
    const data = context.getImageData(0, 0, copy.width, copy.height).data
    copy.width = copy.height = 0
    return data
  }
  // Every file the app downloads, captured from its blob: URL; the download itself is suppressed.
  const blobs = new Map(), captures = []
  const createObjectURL = URL.createObjectURL
  URL.createObjectURL = function (object) {
    const url = createObjectURL.call(URL, object)
    blobs.set(url, object)
    return url
  }
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) { captures.push(blobs.get(this.href)); return }
    return click.call(this)
  }
  let saved = null
  const nameOf = (element) => element?.getAttribute('aria-label') ?? element?.textContent.trim() ?? null
  window.__mintyCrop = {
    rect: () => m.state().crop.rect,
    drag: () => m.state().crop.drag,
    /** Client coordinates of image edge position (x, y) (pixel corners), in the display viewport. */
    edgePoint(x, y) {
      const s = m.state(), dpr = devicePixelRatio, v = s.viewport, r = canvas().getBoundingClientRect()
      const ox = Math.round(v.offset.x * dpr) / dpr, oy = Math.round(v.offset.y * dpr) / dpr
      return { x: r.left + ox + x * v.zoom, y: r.top + oy + y * v.zoom }
    },
    row() {
      const row = document.querySelector('.tool-options[aria-label="Crop options"]')
      if (!row) return null
      const fields = [...row.querySelectorAll('input')].map((input) => ({ name: input.getAttribute('aria-label'), value: input.value }))
      const button = (label) => {
        const b = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
        const r = b.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.getAttribute('aria-disabled'), title: b.title }
      }
      return { fields, hint: row.querySelector('.tool-options__hint')?.textContent ?? null, apply: button('Apply Crop'), cancel: button('Cancel') }
    },
    toolButton() {
      const b = [...document.querySelectorAll('.toolbar__tool')].find((b) => b.textContent.trim() === 'Crop')
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), title: b.title }
    },
    overlay() {
      const o = document.querySelector('.crop-overlay')
      if (!o) return null
      const numbers = o.querySelector('.crop-overlay__shade').getAttribute('d').match(/-?[\\d.]+(e-?\\d+)?/g).map(Number)
      // The second sub-path is the rectangle: M x y h w v h ...
      const [x, y, w, h] = numbers.slice(5, 9)
      return { x, y, width: w, height: h, label: o.querySelector('.crop-overlay__label').textContent, handles: o.querySelectorAll('.crop-overlay__handle').length, hidden: o.getAttribute('aria-hidden') }
    },
    /**
     * Whether the overlay's edges are where the canvas starts and stops drawing the rectangle's
     * columns and rows: red / 2 is the column, green / 3 the row (crop-columns.png).
     */
    alignment() {
      const r = m.state().crop.rect, o = this.overlay(), dpr = devicePixelRatio
      const c = canvas(), shown = read(c)
      const L = Math.round(o.x * dpr), T = Math.round(o.y * dpr), R = Math.round((o.x + o.width) * dpr), B = Math.round((o.y + o.height) * dpr)
      const exactEdges = [o.x, o.y, o.x + o.width, o.y + o.height].every((v) => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6)
      const at = (X, Y) => (X < 0 || Y < 0 || X >= c.width || Y >= c.height ? null : { column: shown[(Y * c.width + X) * 4] / 2, row: shown[(Y * c.width + X) * 4 + 1] / 3 })
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
      const wrong = Object.keys(want).filter((k) => got[k] !== undefined && want[k] >= 0 && want[k] < (k.endsWith('Left') || k.endsWith('Right') ? 120 : 80) && got[k] !== want[k])
      return { ok: exactEdges && wrong.length === 0, exactEdges, wrong, got, want, zoom: m.state().viewport.zoom }
    },
    /**
     * For the screenshot check: the canvas's corner on screen and the device pixels showing the
     * image (read from the canvas: alpha 0 outside it), a row and a column through the rectangle
     * away from its handles, and the outline width. All in device pixels.
     */
    screenGeometry() {
      const c = canvas(), dpr = devicePixelRatio, r = c.getBoundingClientRect(), shown = read(c), o = this.overlay()
      let X0 = Infinity, X1 = -1, Y0 = Infinity, Y1 = -1
      for (let Y = 0; Y < c.height; Y++) for (let X = 0; X < c.width; X++) {
        if (shown[(Y * c.width + X) * 4 + 3]) { X0 = Math.min(X0, X); X1 = Math.max(X1, X); Y0 = Math.min(Y0, Y); Y1 = Math.max(Y1, Y) }
      }
      const clampY = (v) => Math.min(Math.max(v, Y0), Y1), clampX = (v) => Math.min(Math.max(v, X0), X1)
      // A quarter of the way along each edge, clear of the corner and middle handles.
      const row = clampY(Math.floor((o.y + o.height / 4) * dpr)), column = clampX(Math.floor((o.x + o.width / 4) * dpr))
      return { left: r.left * dpr, top: r.top * dpr, X0, X1, Y0, Y1, row, column, line: Math.max(1, Math.floor(dpr)), rect: m.state().crop.rect }
    },
    /** The overlay shown or hidden; its size label (not under test, it covers the shade above the rectangle) hidden unless \`label\`. */
    showOverlay(visible, label = false) {
      document.querySelector('.crop-overlay').style.visibility = visible ? '' : 'hidden'
      document.querySelector('.crop-overlay__label').style.visibility = label ? '' : 'hidden'
      return true
    },
    save() {
      const d = m.state().document
      saved = { width: d.width, data: new Uint8Array(d.pixels.data) }
      return true
    },
    /** The document against the saved image cut to \`rect\`, every byte. */
    croppedFromSaved(rect) {
      const d = m.state().document, now = d.pixels.data
      if (d.width !== rect.width || d.height !== rect.height) return { ok: false, size: [d.width, d.height] }
      let wrong = 0
      for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
          for (let k = 0; k < 4; k++) if (now[(y * rect.width + x) * 4 + k] !== saved.data[((rect.y + y) * saved.width + rect.x + x) * 4 + k]) wrong++
        }
      }
      return { ok: wrong === 0, wrong }
    },
    sameAsSaved() {
      const d = m.state().document, now = d.pixels.data
      if (d.width !== saved.width || now.length !== saved.data.length) return false
      for (let i = 0; i < now.length; i++) if (now[i] !== saved.data[i]) return false
      return true
    },
    focusField(name) {
      const input = [...document.querySelectorAll('.tool-options input')].find((i) => i.getAttribute('aria-label').startsWith(name))
      input.focus()
      input.select()
      return document.activeElement === input
    },
    active: () => nameOf(document.activeElement),
    blur() { document.activeElement?.blur(); return true },
    captures: () => captures.length,
    async capture(index) { return base64(new Uint8Array(await captures[index].arrayBuffer())) },
    documentBytes: () => base64(m.state().document.pixels.data),
  }
  return true
})()`

const crop = (browser, call) => browser.eval(`window.__mintyCrop.${call}`)

async function mouseDrag(browser, from, to, steps = 3) {
  await browser.mouseDown(from.x, from.y)
  for (let i = 1; i <= steps; i++) {
    await browser.mouseMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  }
  await browser.mouseUp(to.x, to.y)
  await settle(browser)
}

/** A drag between image edge positions (pixel corners). */
async function dragEdges(browser, [x0, y0], [x1, y1]) {
  await mouseDrag(browser, await crop(browser, `edgePoint(${x0}, ${y0})`), await crop(browser, `edgePoint(${x1}, ${y1})`))
}

/**
 * Enter on a focused button as a user presses it. Chrome activates a button only for key events
 * that carry the key's text, which the driver's press() leaves out (as in auto-trim.mjs).
 */
async function activateWithEnter(browser) {
  if (!browser.cdp) return browser.press('Enter')
  const event = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...event })
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

async function chooseCrop(browser) {
  const tool = await crop(browser, 'toolButton()')
  await browser.click(tool.x, tool.y)
  await settle(browser)
  await settle(browser)
}

/** 400% with the image's corner in view. */
async function zoom400(browser) {
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'zoom-scaled', anchor: { x: 0, y: 0 }, factor: 4 })
  const corner = await ev(browser, `window.__minty.state().viewport.offset`)
  await dispatch(browser, { type: 'wheel-panned', delta: { x: 40 - corner.x, y: 40 - corner.y } })
  await settle(browser)
}

async function setRect(browser, rect) {
  await dispatch(browser, { type: 'crop-cancelled' })
  for (const field of ['width', 'height', 'x', 'y']) await dispatch(browser, { type: 'crop-field-changed', field, value: rect[field] })
  await settle(browser)
}

/**
 * The crop overlay as composited on screen (screenshots in device pixels), against the image the
 * screen shows, along a row and a column through the rectangle. Independent of the app's mapping:
 * which image column and row each screen pixel shows is decoded from crop-columns.png's colours
 * (red / 2, green / 3) in a screenshot with the overlay hidden. With the overlay shown, every screen
 * pixel showing a removed column or row must be darkened (the shade, or the dark outline over it),
 * the first and last device pixels inside each edge must be the light outline, and every other
 * pixel showing a kept column or row must be exactly as without the overlay: no partly shaded or
 * misplaced pixel anywhere along the line.
 */
async function screenAlignment(browser) {
  const g = await crop(browser, 'screenGeometry()')
  await crop(browser, 'showOverlay(false)')
  await settle(browser)
  const plain = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  await crop(browser, 'showOverlay(true)')
  await settle(browser)
  const shaded = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  await crop(browser, 'showOverlay(true, true)')
  const left = Math.round(g.left), top = Math.round(g.top)
  const at = (png, X, Y) => png.data.subarray(((Y + top) * png.width + X + left) * 4, ((Y + top) * png.width + X + left) * 4 + 3)
  const problems = []
  const line = (axis) => {
    const along = axis === 'x' ? [g.X0, g.X1] : [g.Y0, g.Y1]
    const point = (D) => (axis === 'x' ? [D, g.row] : [g.column, D])
    const [start, size] = axis === 'x' ? [g.rect.x, g.rect.width] : [g.rect.y, g.rect.height]
    const decode = (rgb) => (axis === 'x' ? rgb[0] / 2 : rgb[1] / 3)
    // The device pixels where the kept columns (rows) start and stop on screen.
    let first = null, after = null
    for (let D = along[0]; D <= along[1]; D++) {
      const index = decode(at(plain, ...point(D)))
      if (!Number.isInteger(index)) { problems.push(`${axis} ${D}: no image pixel on screen`); return }
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
  return { ok: problems.length === 0, problems: problems.slice(0, 6), x, y, rect: g.rect, line: g.line }
}

async function exportedPixels(browser) {
  const before = await crop(browser, 'captures()')
  const button = await edit(browser, 'button("Export")')
  await browser.click(button.x, button.y)
  await waitFor(async () => (await crop(browser, 'captures()')) > before, { what: 'the export', timeout: 60000 })
  await waitFor(() => ev(browser, '!window.__minty.state().exporting'), { what: 'the export to finish', timeout: 60000 })
  return decodePng(Buffer.from(await crop(browser, `capture(${before})`), 'base64'))
}

function sameExport(png, base64) {
  const doc = Buffer.from(base64, 'base64')
  if (png.data.length !== doc.length) return false
  for (let i = 0; i < doc.length; i += 4) {
    const alpha = doc[i + 3]
    for (let k = 0; k < 4; k++) if (png.data[i + k] !== (alpha === 0 ? 0 : doc[i + k])) return false
  }
  return true
}

async function workflow(browser, url, name) {
  const tag = (text) => `${name}: ${text}`
  await load(browser, url)
  if (!(await ev(browser, CROP_HELPERS))) throw new Error('Could not install the crop helpers')
  await openWithAnswer(browser, fixture('crop-columns.png'))

  // The tool and its row.
  let tool = await crop(browser, 'toolButton()')
  report.check(tag('Crop is available in the toolbar once an image is open'), !tool.disabled && tool.pressed === 'false', json(tool))
  await chooseCrop(browser)
  tool = await crop(browser, 'toolButton()')
  let row = await crop(browser, 'row()')
  report.check(tag('choosing Crop presses it and shows its options row'), tool.pressed === 'true' && row !== null && (await ev(browser, 'window.__minty.state().activeTool')) === 'crop')
  report.check(
    tag('without a rectangle: the whole image in the fields, the hint, Apply Crop and Cancel unavailable'),
    json(row.fields.map((f) => f.value)) === json(['0', '0', '120', '80']) && row.hint !== null && row.apply.disabled === 'true' && row.cancel.disabled === 'true',
    json(row),
  )
  report.check(tag('field names give their ranges'), row.fields[2].name === 'Crop width in pixels, 1 to 120', row.fields[2].name)

  // Drawing, moving, resizing with the mouse at 400%.
  await zoom400(browser)
  await dragEdges(browser, [10, 8], [30, 20])
  report.check(tag('dragging draws a rectangle between the nearest pixel edges'), json(await crop(browser, 'rect()')) === json({ x: 10, y: 8, width: 20, height: 12 }), json(await crop(browser, 'rect()')))
  let overlay = await crop(browser, 'overlay()')
  row = await crop(browser, 'row()')
  report.check(tag('the overlay shows the size and eight handles; hidden from assistive technology'), overlay.label === '20 × 12 px' && overlay.handles === 8 && overlay.hidden === 'true', json(overlay))
  report.check(tag('the fields follow the rectangle; Apply Crop and Cancel are available'), json(row.fields.map((f) => f.value)) === json(['10', '8', '20', '12']) && row.apply.disabled === 'false' && row.cancel.disabled === 'false' && row.hint === null)
  report.check(tag('no drag remains after release'), (await crop(browser, 'drag()')) === null)
  await dragEdges(browser, [20, 14], [25, 16])
  report.check(tag('dragging inside moves it'), json(await crop(browser, 'rect()')) === json({ x: 15, y: 10, width: 20, height: 12 }), json(await crop(browser, 'rect()')))
  await dragEdges(browser, [35, 22], [38, 24])
  report.check(tag('dragging the bottom-right corner resizes it without a jump'), json(await crop(browser, 'rect()')) === json({ x: 15, y: 10, width: 23, height: 14 }), json(await crop(browser, 'rect()')))
  await dragEdges(browser, [25, 10], [25, 13])
  report.check(tag('dragging the top edge moves only that edge'), json(await crop(browser, 'rect()')) === json({ x: 15, y: 13, width: 23, height: 11 }), json(await crop(browser, 'rect()')))
  const corner = await crop(browser, 'edgePoint(15, 13)')
  await mouseDrag(browser, corner, { x: 2, y: 2 })
  report.check(tag('dragging a handle outside the image (and the canvas) stops at the image edge'), json(await crop(browser, 'rect()')) === json({ x: 0, y: 0, width: 38, height: 24 }), json(await crop(browser, 'rect()')))
  const far = await crop(browser, 'edgePoint(200, 200)')
  const page = await ev(browser, '({ w: innerWidth, h: innerHeight })')
  await mouseDrag(browser, await crop(browser, 'edgePoint(60, 50)'), { x: Math.min(far.x, page.w - 5), y: Math.min(far.y, page.h - 5) })
  report.check(tag('a new drag from outside the rectangle to beyond the image stops at the image edges'), json(await crop(browser, 'rect()')) === json({ x: 60, y: 50, width: 60, height: 30 }), json(await crop(browser, 'rect()')))
  const click = await crop(browser, 'edgePoint(5, 70)')
  await browser.click(click.x, click.y)
  await settle(browser)
  report.check(tag('a click outside the rectangle without a drag removes it'), (await crop(browser, 'rect()')) === null && (await crop(browser, 'overlay()')) === null)

  // Alignment at several zoom levels and pans: in the canvas's pixels, and on screen.
  await setRect(browser, { x: 37, y: 21, width: 41, height: 33 })
  const zooms = [['Fit', null], ['100%', 1], ['150%', 1.5], ['200%', 2], ['300%', 3], ['800%', 8]]
  for (const [label, zoom] of zooms) {
    if (zoom === null) await dispatch(browser, { type: 'zoom-fitted' })
    else {
      await dispatch(browser, { type: 'zoom-actual-size' })
      if (zoom !== 1) await dispatch(browser, { type: 'zoom-scaled', anchor: await ev(browser, 'window.__minty.workspacePoint(57, 37)'), factor: zoom })
    }
    await settle(browser)
    // Fractional pans move the image's corner to other device pixels.
    for (const [pan, delta] of [['', null], [', panned', { x: 13.3, y: -7.7 }], [', panned again', { x: -29.9, y: 17.45 }]]) {
      if (delta) {
        await dispatch(browser, { type: 'wheel-panned', delta })
        await settle(browser)
      }
      const a = await crop(browser, 'alignment()')
      report.check(tag(`at ${label}${pan} the overlay's edges are exactly where the canvas draws the rectangle's first and last columns and rows`), a.ok, json(a))
      const screen = await screenAlignment(browser)
      report.check(tag(`at ${label}${pan} on screen, the overlay darkens exactly the removed columns and rows, nothing partly`), screen.ok, json(screen))
    }
  }

  // Escape: crop first, then the selection.
  await zoom400(browser)
  await crop(browser, 'blur()')
  await browser.press('a', { ctrl: true })
  await setRect(browser, { x: 5, y: 5, width: 20, height: 20 })
  await browser.press('Escape')
  await settle(browser)
  report.check(tag('Escape cancels the pending crop and keeps the selection'), (await crop(browser, 'rect()')) === null && (await ev(browser, 'window.__minty.state().selection?.count')) === 120 * 80)
  await browser.press('Escape')
  await settle(browser)
  report.check(tag('with nothing pending, Escape clears the selection as before'), (await ev(browser, 'window.__minty.state().selection')) === null)

  // Fields: typing and Enter never crop; Escape cancels the entry.
  const revision = await ev(browser, 'window.__minty.state().document.revision')
  await crop(browser, 'focusField("Crop width")')
  await browser.type('50')
  await browser.press('Enter')
  await settle(browser)
  report.check(tag('typing a width and Enter sets the rectangle and crops nothing'), json(await crop(browser, 'rect()')) === json({ x: 0, y: 0, width: 50, height: 80 }) && (await ev(browser, 'window.__minty.state().document.revision')) === revision, json(await crop(browser, 'rect()')))
  await crop(browser, 'focusField("Crop left edge")')
  await browser.type('999')
  await browser.press('Enter')
  await settle(browser)
  report.check(tag('a position too large is clamped on Enter'), json(await crop(browser, 'rect()')) === json({ x: 70, y: 0, width: 50, height: 80 }), json(await crop(browser, 'rect()')))
  await crop(browser, 'focusField("Crop height")')
  await browser.type('3')
  await browser.press('Escape')
  await settle(browser)
  report.check(tag('Escape in a field cancels the entry and keeps the rectangle'), json(await crop(browser, 'rect()')) === json({ x: 70, y: 0, width: 50, height: 80 }), json(await crop(browser, 'rect()')))

  // Apply with Enter.
  await setRect(browser, { x: 11, y: 7, width: 64, height: 45 })
  await crop(browser, 'save()')
  await crop(browser, 'blur()')
  await browser.press('Enter')
  await settle(browser)
  let result = await crop(browser, 'croppedFromSaved({ x: 11, y: 7, width: 64, height: 45 })')
  const after = await ev(browser, '(() => { const s = window.__minty.state(); return { tool: s.activeTool, crop: s.crop, selection: s.selection, zoom: s.viewport.zoom, undo: s.history.undo.map((e) => e.kind), notice: s.editNotice } })()')
  report.check(tag('Enter crops: every byte of the rectangle, nothing else'), result.ok, json(result))
  report.check(tag('after the crop: no rectangle, no selection, Crop still active, one "crop" Undo step, fitted'), after.crop.rect === null && after.selection === null && after.tool === 'crop' && json(after.undo) === json(['crop']) && after.zoom === 1, json(after))
  report.check(tag('the crop is announced with both sizes'), (await edit(browser, 'announcement()')) === 'Crop applied: 120 × 80 px cropped to 64 × 45 px.', await edit(browser, 'announcement()'))
  await dispatch(browser, { type: 'zoom-actual-size' })
  await settle(browser)
  const shown = await ev(browser, 'window.__minty.compareImage()')
  const everyPixelShown = shown.fractional
    ? shown.shownLines.columns === 64 && shown.shownLines.rows === 45 && shown.n.opaque === shown.devicePixels
    : shown.n.opaque === 64 * 45 * shown.S * shown.S
  report.check(tag('the canvas shows the cropped image exactly'), shown.failures === 0 && everyPixelShown, json(shown))
  const cropped = await crop(browser, 'documentBytes()')
  await crop(browser, 'blur()')
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(tag('Ctrl + Z restores every byte and the size'), await crop(browser, 'sameAsSaved()'))
  await browser.press('y', { ctrl: true })
  await settle(browser)
  report.check(tag('Ctrl + Y crops again exactly'), (await crop(browser, 'documentBytes()')) === cropped)
  await browser.press('z', { ctrl: true })
  await settle(browser)

  // The Apply Crop and Cancel buttons.
  await zoom400(browser)
  await dragEdges(browser, [2, 3], [40, 30])
  row = await crop(browser, 'row()')
  await browser.click(row.cancel.x, row.cancel.y)
  await settle(browser)
  report.check(tag('Cancel removes the rectangle and changes nothing'), (await crop(browser, 'rect()')) === null && (await crop(browser, 'sameAsSaved()')))
  await dragEdges(browser, [2, 3], [40, 30])
  row = await crop(browser, 'row()')
  report.check(tag('Apply Crop names the size and its shortcut'), row.apply.title === 'Crop the image to 38 × 27 px (Enter)', row.apply.title)
  await browser.click(row.apply.x, row.apply.y)
  await settle(browser)
  result = await crop(browser, 'croppedFromSaved({ x: 2, y: 3, width: 38, height: 27 })')
  report.check(tag('the Apply Crop button crops exactly'), result.ok, json(result))
  report.check(tag('focus stays on Apply Crop, now unavailable'), (await crop(browser, 'active()')) === 'Apply Crop' && (await crop(browser, 'row()')).apply.disabled === 'true')
  await crop(browser, 'blur()')
  await browser.press('z', { ctrl: true })
  await settle(browser)

  // Keyboard only (headless Firefox cannot activate buttons with keys).
  if (name.startsWith('Chrome')) {
    await crop(browser, 'focusField("Crop width")')
    await browser.type('30')
    await browser.press('Tab')
    await browser.type('20')
    await browser.press('Tab')
    report.check(tag('Tab goes from the last field to Apply Crop'), (await crop(browser, 'active()')) === 'Apply Crop', await crop(browser, 'active()'))
    await activateWithEnter(browser)
    await settle(browser)
    result = await crop(browser, 'croppedFromSaved({ x: 0, y: 0, width: 30, height: 20 })')
    report.check(tag('keyboard only: fields, Tab, Enter on Apply Crop crops exactly'), result.ok, json(result))
    await crop(browser, 'blur()')
    await browser.press('z', { ctrl: true })
    await settle(browser)
  }

  // Export.
  await openWithAnswer(browser, fixture('edge-alpha.png'))
  await chooseCrop(browser)
  await setRect(browser, { x: 20, y: 10, width: 70, height: 50 })
  let png = await exportedPixels(browser)
  report.check(tag('a rectangle not applied is not part of the export'), sameExport(png, await crop(browser, 'documentBytes()')) && png.width === (await ev(browser, 'window.__minty.state().document.width')), `${png.width} × ${png.height}`)
  await crop(browser, 'save()')
  await crop(browser, 'blur()')
  await browser.press('Enter')
  await settle(browser)
  result = await crop(browser, 'croppedFromSaved({ x: 20, y: 10, width: 70, height: 50 })')
  png = await exportedPixels(browser)
  report.check(tag('a partially transparent image crops exactly and exports exactly the cropped pixels'), result.ok && png.width === 70 && png.height === 50 && sameExport(png, await crop(browser, 'documentBytes()')), json(result))

  // What drops the rectangle; unavailable while another image opens.
  await setRect(browser, { x: 1, y: 1, width: 10, height: 10 })
  await dispatch(browser, { type: 'tool-selected', tool: 'magic-wand' })
  await chooseCrop(browser)
  report.check(tag('choosing another tool drops the rectangle'), (await crop(browser, 'rect()')) === null && (await crop(browser, 'overlay()')) === null)
  await setRect(browser, { x: 1, y: 1, width: 10, height: 10 })
  await edit(browser, 'holdImports()')
  await browser.setFile('input[type=file]', fixture('crop-columns.png'))
  await waitFor(() => ev(browser, `!!document.querySelector('dialog[open]') || window.__minty.state().pendingImportId !== null`), { what: 'the import or question' })
  if (await ev(browser, `!!document.querySelector('dialog[open]')`)) {
    const button = await edit(browser, 'button("Continue")')
    await browser.click(button.x, button.y)
    await waitFor(() => ev(browser, 'window.__minty.state().pendingImportId !== null'), { what: 'the import to start' })
  }
  await settle(browser)
  row = await crop(browser, 'row()')
  const heldRevision = await ev(browser, 'window.__minty.state().document.revision')
  await crop(browser, 'blur()')
  await browser.press('Enter')
  await settle(browser)
  report.check(tag('while another image opens Apply Crop is unavailable, and Enter crops nothing'), row.apply.disabled === 'true' && row.apply.title.endsWith('not available while another image is opening') && (await ev(browser, 'window.__minty.state().document.revision')) === heldRevision, json(row.apply))
  await edit(browser, 'releaseImports()')
  await waitFor(() => ev(browser, 'window.__minty.state().pendingImportId === null'), { what: 'the import to finish' })
  await settle(browser)
  report.check(tag('opening another image drops the rectangle and makes the Magic Wand active'), (await ev(browser, 'window.__minty.state().crop.rect')) === null && (await ev(browser, 'window.__minty.state().activeTool')) === 'magic-wand')

  const live = await edit(browser, 'liveImages()')
  report.check(tag('one live display image'), live.live === 1 && live.currentLive, json(live))
  const errors = await ev(browser, 'window.__minty.errors')
  const messages = await edit(browser, 'consoleMessages()')
  report.check(tag('no page errors or console warnings'), errors.length === 0 && messages.length === 0, json([...errors, ...messages]))
}

async function performance(browser, url, name, file) {
  await load(browser, url)
  if (!(await ev(browser, CROP_HELPERS))) throw new Error('Could not install the crop helpers')
  await openWithAnswer(browser, fixture(file), 'continue', { timeout: 120000 })
  await chooseCrop(browser)
  const size = await ev(browser, '({ w: window.__minty.state().document.width, h: window.__minty.state().document.height })')
  const rect = { x: Math.floor(size.w / 4), y: Math.floor(size.h / 4), width: Math.floor(size.w / 2), height: Math.floor(size.h / 2) }
  await setRect(browser, rect)
  const apply = await edit(browser, 'timeKey("Enter")')
  const bytes = await ev(browser, 'window.__minty.state().history.retainedBytes')
  const undo = await edit(browser, 'timeKey("z", { ctrl: true })')
  const redo = await edit(browser, 'timeKey("y", { ctrl: true })')
  const ok = apply.changed && undo.changed && redo.changed && (await ev(browser, `window.__minty.state().document.width === ${rect.width}`))
  report.check(`${name}: ${file} ${size.w} × ${size.h} cropped to the middle quarter, undone and redone`, ok)
  report.note(
    `  ${name} ${file}: Apply ${apply.total.toFixed(0)} ms, Undo ${undo.total.toFixed(0)} ms, Redo ${redo.total.toFixed(0)} ms; history ${(bytes / 1e6).toFixed(1)} MB`,
  )
}

ensureCropFixtures()
await ensureEdgeFixtures()
if (!values['no-perf']) await ensureTrimFixtures()
const server = await serveBuild()
try {
  for (const which of browsers) {
    for (const dpr of ratios) {
      const browser = await launch(which, { dpr })
      try {
        await workflow(browser, server.url, browser.name)
        if (!values['no-perf'] && dpr === ratios[0]) {
          await performance(browser, server.url, browser.name, 'trim-photo-4k.png')
          if (!values['no-stress']) await performance(browser, server.url, browser.name, 'trim-photo-50mp.png')
        }
      } catch (error) {
        report.check(`${browser.name}: completed without an exception`, false, error.stack)
      } finally {
        await browser.close()
      }
    }
  }
} finally {
  await server.close()
}
report.finish()
