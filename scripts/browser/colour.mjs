// The Eyedropper and the colour picker (Phase 4) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/colour.mjs [--browser chrome|firefox|all] [--dpr 1,1.25,1.5,2,3] [--no-forced-colours]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real clicks, drags and key presses:
// - The Eyedropper tool: real clicks at Fit, 100%, 150%, 200%, 300% and 400%, some panned by
//   fractional amounts, at pixel centres and next to pixel edges, at device pixel ratios 1, 1.25,
//   1.5, 2 and 3 by default, on an opaque image whose colour names its pixel, on a partially
//   transparent one and on sharp alternating colours with transparency. The oracle is observed,
//   not computed with the app's mapping: the position the browser delivered with the press and the
//   canvas's colour at that device pixel. The colour read, over the checkerboard, is exactly the
//   colour shown (and is the pixel the colour names); where no image is shown, nothing is read.
//   The row shows hex, RGBA, alpha and the pixel, and the reading is announced each time, a repeat
//   of the same pixel included. Sampling never changes the image, the selection or the history.
// - The Magic Wand (tolerance 0) and the status bar, which share the mapping, against the same
//   oracle.
// - With the picker open, pasted and dropped images are never imported (real Ctrl + V in Chrome,
//   paste events in both), text still pastes into the hex field, and the editor's shortcuts do
//   nothing; closed, a pasted image opens. Resizing the window (to 640 × 480 and 640 × 360) keeps
//   every control on screen and reachable.
// - Unless --no-forced-colours: once per browser in forced colours mode, the picker's colours are
//   kept on screen, everything around them uses system colours, and the focus ring the highlight.
// - The colour picker, opened from the swatch: focus starts on the saturation / brightness area;
//   arrow keys, a pointer drag and the hue and alpha sliders change the new colour; Escape and
//   Cancel change nothing and return focus to the swatch; a typed hex value and Apply set the
//   colour exactly; Apply without changes keeps the colour exactly; Escape in the hex field cancels
//   only the entry; Delete, Ctrl + Z and Escape do not reach the editor while it is open.
// - No page errors or console warnings.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, settle } from './lib/app.mjs'
import { serveBuild } from './lib/app.mjs'
import { edit, ev, json, load } from './lib/edges.mjs'
import { fileBase64, openWithAnswer } from './lib/edit.mjs'
import { ensureCropFixtures, ensureEdgeFixtures } from './fixtures.mjs'
import { decodePng } from './lib/png.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,1.25,1.5,2,3' },
    'no-forced-colours': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()
const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name)

const COLOUR_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const canvas = () => document.querySelector('canvas.workspace__canvas')
  const row = () => document.querySelector('.tool-options[aria-label="Eyedropper options"]')
  const centre = (element) => {
    const r = element.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }
  }
  const hash = (array) => {
    let h = 0x811c9dc5
    for (let i = 0; i < array.length; i++) h = Math.imul(h ^ array[i], 16777619)
    return h >>> 0
  }
  // The position each pointer press was delivered at, as the app received it.
  let lastDown = null
  addEventListener('pointerdown', (e) => { lastDown = { x: e.clientX, y: e.clientY } }, true)
  window.__mintyColour = {
    toolButton: () => centre([...document.querySelectorAll('.toolbar__tool')].find((b) => b.textContent.trim() === 'Eyedropper')),
    colour: () => m.state().colour,
    fingerprint() {
      const s = m.state()
      return { revision: s.document.revision, pixels: hash(s.document.pixels.data), undo: s.history.undo.length, selected: s.selection?.count ?? 0 }
    },
    /**
     * What the screen showed under the pointer at the last pointer press, observed rather than
     * computed: the position the browser delivered (it may move a requested position, as Firefox
     * does to the nearest device pixel corner), the device pixel containing it (positions within
     * 0.01 device px of a corner count as on it, for the browsers' float rounding), and the canvas's
     * colour there. The canvas lies on whole device pixels with a backing store of its exact device
     * size, so its pixels are the screen's (checked against screenshots in crop.mjs).
     */
    observed() {
      if (!lastDown) return null
      const c = canvas(), dpr = devicePixelRatio, r = c.getBoundingClientRect()
      const X = Math.floor((lastDown.x - r.left) * dpr + 0.01), Y = Math.floor((lastDown.y - r.top) * dpr + 0.01)
      if (X < 0 || Y < 0 || X >= c.width || Y >= c.height) return { X, Y, rgba: null }
      const copy = document.createElement('canvas')
      copy.width = copy.height = 1
      const context = copy.getContext('2d', { willReadFrequently: true })
      context.drawImage(c, X, Y, 1, 1, 0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return { X, Y, client: lastDown, rgba: { r: red, g: green, b: blue, a: alpha } }
    },
    /** The document's bytes at pixel (x, y). */
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
    /** A paste of a file at the focused element, as Ctrl + V sends it; whether its default was prevented. */
    pasteFileAtFocus(base64, name, type) {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      ;(document.activeElement ?? document.body).dispatchEvent(event)
      return event.defaultPrevented
    },
    pasteTextAtFocus(text) {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', text)
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      document.activeElement.dispatchEvent(event)
      return event.defaultPrevented
    },
    /** A file dropped on the workspace (inert behind the modal picker; dispatched anyway, to test the app's own guard). */
    dropFile(base64, name, type) {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      const workspace = document.querySelector('main.workspace')
      for (const kind of ['dragenter', 'dragover', 'drop']) workspace.dispatchEvent(new DragEvent(kind, { dataTransfer: transfer, bubbles: true, cancelable: true }))
      return true
    },
    focusInPicker(which) {
      const d = document.querySelector('dialog.colour-picker[open]')
      if (!d) return false
      const target = which === 'area' ? d.querySelector('.colour-picker__area')
        : which === 'hue' ? d.querySelectorAll('input[type=range]')[0]
        : which === 'alpha' ? d.querySelectorAll('input[type=range]')[1]
        : which === 'hex' ? d.querySelector('.colour-picker__hex-input')
        : [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === which)
      target.focus()
      if (which === 'hex') target.select()
      return document.activeElement === target
    },
    /**
     * Whether each picker control is fully inside the window and is what a click at its centre
     * reaches (not covered, not scrolled away), the dialog's box, and the swatch it opened from.
     */
    pickerReach() {
      const d = document.querySelector('dialog.colour-picker[open]')
      if (!d) return null
      const controls = {
        area: d.querySelector('.colour-picker__area'), hue: d.querySelectorAll('input[type=range]')[0], alpha: d.querySelectorAll('input[type=range]')[1],
        hex: d.querySelector('.colour-picker__hex-input'),
        cancel: [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel'), apply: [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apply'),
      }
      const unreachable = []
      for (const [name, element] of Object.entries(controls)) {
        const r = element.getBoundingClientRect()
        const inside = r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.width > 0 && r.height > 0
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (!inside || !(hit === element || element.contains(hit))) unreachable.push(name)
      }
      const box = d.getBoundingClientRect(), swatch = document.querySelector('.tool-options__swatch').getBoundingClientRect()
      const focus = Object.entries(controls).find(([, element]) => element === document.activeElement)?.[0] ?? document.activeElement?.tagName ?? null
      return { unreachable, box: { top: box.top, left: box.left, bottom: box.bottom, height: box.height }, swatchBottom: swatch.bottom, window: [innerWidth, innerHeight], focus }
    },
    /** Starts recording what is added to the Eyedropper row's live region. */
    watchAnnouncements() {
      const region = row().querySelector('[role=status]')
      const added = []
      new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) added.push(node.textContent)
      }).observe(region, { childList: true, subtree: true, characterData: true })
      window.__mintyAnnouncements = added
      return true
    },
    announcements: () => [...window.__mintyAnnouncements],
    imports: () => { const s = m.state(); return { id: s.document?.id ?? null, pending: s.pendingImportId, error: s.importError?.kind ?? null } },
    row() {
      const r = row()
      if (!r) return null
      return {
        text: [...r.querySelectorAll('output, .tool-options__hint')].map((o) => o.textContent).join(' | '),
        status: r.querySelector('[role=status]').textContent,
        swatch: { ...centre(r.querySelector('.tool-options__swatch')), name: r.querySelector('.tool-options__swatch').getAttribute('aria-label') },
      }
    },
    picker() {
      const d = document.querySelector('dialog.colour-picker[open]')
      if (!d) return null
      const area = d.querySelector('.colour-picker__area')
      const [hue, alpha] = d.querySelectorAll('input[type=range]')
      const button = (label) => centre([...d.querySelectorAll('button')].find((b) => b.textContent.trim() === label))
      return {
        modal: d.matches(':modal'),
        area: { ...centre(area), valuetext: area.getAttribute('aria-valuetext') },
        hue: { ...centre(hue), value: hue.value },
        alpha: { ...centre(alpha), value: alpha.value },
        hex: { ...centre(d.querySelector('.colour-picker__hex-input')), value: d.querySelector('.colour-picker__hex-input').value },
        rgba: d.querySelector('.colour-picker__rgba').textContent,
        apply: button('Apply'),
        cancel: button('Cancel'),
        inside: (() => { const r = d.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })(),
      }
    },
    active: () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? null,
    focusHex() { const i = document.querySelector('.colour-picker__hex-input'); i.focus(); i.select(); return document.activeElement === i },
    setRange(index, value) {
      const input = document.querySelectorAll('dialog.colour-picker input[type=range]')[index]
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return input.value
    },
  }
  return true
})()`

const colour = (browser, call) => browser.eval(`window.__mintyColour.${call}`)

/**
 * Whether colour `c` (straight RGBA), drawn over one of the checkerboard's two greys, is `shown`
 * (canvas RGBA): exactly when opaque, within 2 levels when partly transparent.
 */
function composites(c, shown) {
  return [0x2c, 0x3a].some((grey) => {
    const limit = c.a === 255 ? 0 : 2
    return [c.r, c.g, c.b].every((v, k) => Math.abs((v * c.a + grey * (255 - c.a)) / 255 - [shown.r, shown.g, shown.b][k]) <= limit + 0.5) && shown.a === 255
  })
}

/**
 * A real click at `client`: what the app read, against what the screen showed under the pointer
 * (observed(): the delivered position and the canvas's colour there). Agreement: where the device
 * pixel shows no image, nothing is read; elsewhere the colour read, drawn over the checkerboard, is
 * exactly the colour shown. With `decode` (crop-columns.png, whose colour names its pixel), the
 * pixel read must also be exactly the pixel whose colour is shown.
 */
async function sampleAt(browser, client, { decode = false } = {}) {
  const before = await colour(browser, 'colour()')
  await browser.click(client.x, client.y)
  await settle(browser)
  const state = await colour(browser, 'colour()')
  const seen = await colour(browser, 'observed()')
  const onImage = !!seen?.rgba && seen.rgba.a !== 0
  let agrees
  if (!onImage) agrees = json(state) === json(before)
  else {
    agrees = !!state?.sample && composites(state.value, seen.rgba)
    if (decode) {
      const pixel = { x: seen.rgba.r / 2, y: seen.rgba.g / 3 }
      agrees &&= json(state.sample.pixel) === json(pixel) && json(state.value) === json(seen.rgba)
    }
  }
  return { state, seen, onImage, agrees }
}

/** Pans image pixel (x, y) into view (as clickPixel in lib/edges.mjs), then returns the client point at fraction (fx, fy) inside it. */
async function pointIn(browser, x, y, fx, fy) {
  const outside = await ev(browser, `(() => {
    const p = window.__minty.workspacePoint(${x} + 0.5, ${y} + 0.5), r = document.querySelector('canvas.workspace__canvas').getBoundingClientRect()
    return p.x < 20 || p.y < 20 || p.x > r.width - 20 || p.y > r.height - 20 ? { x: Math.round(r.width / 2 - p.x), y: Math.round(r.height / 2 - p.y) } : null
  })()`)
  if (outside) {
    await dispatch(browser, { type: 'wheel-panned', delta: outside })
    await settle(browser)
  }
  return ev(browser, `(() => { const v = window.__minty.state().viewport, r = document.querySelector('canvas.workspace__canvas').getBoundingClientRect(); return { x: Math.round(r.left + v.offset.x + (${x} + ${fx}) * v.zoom), y: Math.round(r.top + v.offset.y + (${y} + ${fy}) * v.zoom) } })()`)
}

async function run(browser, url, name) {
  const tag = (text) => `${name}: ${text}`
  await load(browser, url)
  if (!(await ev(browser, COLOUR_HELPERS))) throw new Error('Could not install the colour helpers')
  await openWithAnswer(browser, fixture('crop-columns.png'))
  const tool = await colour(browser, 'toolButton()')
  await browser.click(tool.x, tool.y)
  await settle(browser)
  await settle(browser)
  report.check(tag('the Eyedropper is a tool with its own options row, a hint before any colour'), (await ev(browser, 'window.__minty.state().activeTool')) === 'eyedropper' && (await colour(browser, 'row()')).text.includes('Click the image'))
  await browser.press('a', { ctrl: true })
  await settle(browser)
  const before = await colour(browser, 'fingerprint()')

  // Real clicks at several zoom levels and pans, at pixel centres and near pixel edges.
  const zooms = [['Fit', null], ['100%', 1], ['150%', 1.5], ['200%', 2], ['300%', 3], ['400%', 4]]
  const views = []
  for (const [label, zoom] of zooms) {
    views.push([label, zoom, null])
    if (zoom === 1 || zoom === 1.5) views.push([`${label}, panned`, zoom, { x: 13.3, y: -7.7 }])
  }
  const goTo = async (zoom, pan) => {
    if (zoom === null) await dispatch(browser, { type: 'zoom-fitted' })
    else {
      await dispatch(browser, { type: 'zoom-actual-size' })
      if (zoom !== 1) await dispatch(browser, { type: 'zoom-scaled', anchor: await ev(browser, 'window.__minty.workspacePoint(0, 0)'), factor: zoom })
    }
    if (pan) await dispatch(browser, { type: 'wheel-panned', delta: pan })
    await settle(browser)
  }
  let samples = 0
  let read = 0
  let wrong = []
  for (const [label, zoom, pan] of views) {
    await goTo(zoom, pan)
    for (const [x, y] of [[0, 0], [7, 3], [37, 21], [77, 53], [60, 41], [119, 79], [33, 70]]) {
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.9], [0.9, 0.1], [0.02, 0.98], [0.98, 0.02]]) {
        const client = await pointIn(browser, x, y, fx, fy)
        const { state, seen, onImage, agrees } = await sampleAt(browser, client, { decode: true })
        samples++
        if (onImage) read++
        if (!agrees) wrong.push({ label, x, y, fx, fy, state, seen })
      }
    }
  }
  report.check(
    tag(`${samples} real clicks at Fit, 100%, 150%, 200%, 300% and 400%, some panned, read exactly the pixel the screen shows under the pointer (${read} on the image, the rest past its edge, reading nothing)`),
    wrong.length === 0 && read >= samples * 0.8,
    json(wrong.slice(0, 3)),
  )
  report.check(tag('sampling never changed the image, the selection or the history'), json(await colour(browser, 'fingerprint()')) === json(before), json(await colour(browser, 'fingerprint()')))
  const shownRow = await colour(browser, 'row()')
  report.check(tag('the row shows hex, RGBA, alpha and the pixel, and the reading is announced'), /^#[0-9A-F]{6} \| RGBA \d+, \d+, \d+, 255 \| Alpha 100% \| from pixel \d+, \d+$/.test(shownRow.text) && shownRow.status.startsWith('Colour read from pixel'), json(shownRow))
  // Each deliberate reading is announced, the same pixel twice included; nothing else announces.
  await goTo(4, null)
  await colour(browser, 'watchAnnouncements()')
  const same = await pointIn(browser, 20, 10, 0.5, 0.5)
  await sampleAt(browser, same)
  await sampleAt(browser, same)
  const twice = await colour(browser, 'announcements()')
  await dispatch(browser, { type: 'zoom-scaled', anchor: { x: 100, y: 100 }, factor: 1.5 })
  await dispatch(browser, { type: 'wheel-panned', delta: { x: 7, y: -4 } })
  await browser.mouseMove(same.x + 3, same.y + 2)
  await browser.mouseMove(same.x - 2, same.y + 5)
  await settle(browser)
  await settle(browser)
  const after = await colour(browser, 'announcements()')
  report.check(
    tag('reading the same pixel twice announces it twice, briefly; zooming, panning and moving the pointer announce nothing'),
    twice.length === 2 && twice[0] === twice[1] && /^Colour read from pixel 20, 10: #[0-9A-F]{6}, alpha 100%\.$/.test(twice[0]) && after.length === 2,
    json({ twice, after }),
  )
  const outside = await ev(browser, `(() => { const r = document.querySelector('canvas.workspace__canvas').getBoundingClientRect(); return { x: r.left + 5, y: r.top + 5 } })()`)
  await dispatch(browser, { type: 'zoom-fitted' })
  await settle(browser)
  const last = await colour(browser, 'colour()')
  await browser.click(outside.x, outside.y)
  await settle(browser)
  report.check(tag('a click outside the image reads nothing'), json(await colour(browser, 'colour()')) === json(last))

  // Partial alpha and hidden colour.
  await openWithAnswer(browser, fixture('edge-alpha.png'))
  await browser.click(tool.x, tool.y)
  await settle(browser)
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'zoom-scaled', anchor: await ev(browser, 'window.__minty.workspacePoint(0, 0)'), factor: 4 })
  await settle(browser)
  wrong = []
  let partial = 0
  let transparent = 0
  for (let y = 4; y < 200; y += 13) {
    for (let x = 6; x < 320; x += 29) {
      const { state, seen, onImage, agrees } = await sampleAt(browser, await pointIn(browser, x, y, 0.5, 0.5))
      const exact = !!state?.sample && json(state.value) === json(await colour(browser, `documentPixel(${state.sample.pixel.x}, ${state.sample.pixel.y})`))
      if (state?.value.a > 0 && state.value.a < 255) partial++
      if (state?.value.a === 0) transparent++
      if (!agrees || !onImage || !exact) wrong.push({ x, y, state, seen })
    }
  }
  report.check(
    tag(`on a partially transparent image, every value is read exactly and is what the screen shows (${partial} partly transparent, ${transparent} fully transparent pixels among them)`),
    wrong.length === 0 && partial > 0 && transparent > 0,
    json(wrong.slice(0, 3)),
  )

  // Sharp alternating colours and transparency: every pixel looks different from its neighbours, so
  // reading a neighbour of the pixel shown cannot pass. Zoomed, panned, near pixel edges.
  await openWithAnswer(browser, fixture('colour-stripes.png'))
  await browser.click(tool.x, tool.y)
  await settle(browser)
  wrong = []
  samples = 0
  let hidden = 0
  for (const [label, zoom, pan] of [['Fit', null, null], ['100%', 1, null], ['100%, panned', 1, { x: 7.3, y: 3.9 }], ['150%', 1.5, null], ['150%, panned', 1.5, { x: -5.1, y: 11.7 }], ['300%', 3, null]]) {
    await goTo(zoom, pan)
    for (const [x, y] of [[0, 0], [1, 1], [2, 1], [3, 0], [10, 7], [29, 20], [58, 38], [59, 39]]) {
      for (const [fx, fy] of [[0.5, 0.5], [0.05, 0.05], [0.95, 0.95], [0.05, 0.95]]) {
        const { state, seen, onImage, agrees } = await sampleAt(browser, await pointIn(browser, x, y, fx, fy))
        samples++
        if (onImage && state?.value.a === 0) hidden++
        if (!agrees) wrong.push({ label, x, y, fx, fy, state, seen })
      }
    }
  }
  report.check(
    tag(`${samples} clicks on sharp alternating colours and transparency read exactly the pixel shown (${hidden} fully transparent)`),
    wrong.length === 0 && hidden > 0,
    json(wrong.slice(0, 3)),
  )

  // The Magic Wand and the status bar find the pixel under the pointer the same way (shared
  // mapping): at tolerance 0 on crop-columns.png (every pixel unique), a click selects exactly the
  // one pixel the screen shows under the pointer, and the status bar names it.
  await openWithAnswer(browser, fixture('crop-columns.png'))
  await dispatch(browser, { type: 'tool-selected', tool: 'magic-wand' })
  await dispatch(browser, { type: 'magic-wand-tolerance-changed', tolerance: 0 })
  wrong = []
  samples = 0
  for (const [label, zoom, pan] of [['Fit', null, null], ['100%', 1, null], ['100%, panned', 1, { x: 13.3, y: -7.7 }], ['150%', 1.5, null], ['300%', 3, null]]) {
    await goTo(zoom, pan)
    for (const [x, y] of [[0, 0], [37, 21], [77, 53], [78, 54], [119, 79]]) {
      for (const [fx, fy] of [[0.5, 0.5], [0.05, 0.95], [0.95, 0.05]]) {
        const client = await pointIn(browser, x, y, fx, fy)
        await dispatch(browser, { type: 'selection-cleared' })
        await browser.click(client.x, client.y)
        await settle(browser)
        const seen = await colour(browser, 'observed()')
        const selection = await colour(browser, 'selection()')
        const status = await colour(browser, 'statusPixel()')
        samples++
        if (!seen?.rgba || seen.rgba.a === 0) {
          if (selection !== null) wrong.push({ label, x, y, fx, fy, seen, selection })
          continue
        }
        const pixel = { x: seen.rgba.r / 2, y: seen.rgba.g / 3 }
        if (!(selection?.count === 1 && json(selection.pixels[0]) === json(pixel) && status === `${pixel.x}, ${pixel.y}`)) wrong.push({ label, x, y, fx, fy, seen, pixel, selection, status })
      }
    }
  }
  await dispatch(browser, { type: 'selection-cleared' })
  await dispatch(browser, { type: 'tool-selected', tool: 'eyedropper' })
  await settle(browser)
  report.check(tag(`${samples} Magic Wand clicks at tolerance 0 select exactly the pixel the screen shows under the pointer, and the status bar names it`), wrong.length === 0, json(wrong.slice(0, 3)))

  // The picker.
  const start = (await colour(browser, 'colour()')).value
  let row = await colour(browser, 'row()')
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  let picker = await colour(browser, 'picker()')
  report.check(tag('the swatch opens a modal colour picker inside the window, focus on the saturation and brightness area'), picker?.modal === true && picker.inside && (await colour(browser, 'active()')) === 'Saturation and brightness', json(picker))
  report.check(tag('the picker opens with the colour exactly'), picker.hex.value === row.text.split(' | ')[0], `${picker.hex.value} vs ${row.text}`)
  const fingerprint = await colour(browser, 'fingerprint()')
  await browser.press('Delete')
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(tag('Delete and Ctrl + Z do nothing to the image while the picker is open'), json(await colour(browser, 'fingerprint()')) === json(fingerprint) && (await colour(browser, 'picker()')) !== null)
  await browser.press('ArrowRight')
  await browser.press('ArrowUp')
  await settle(browser)
  picker = await colour(browser, 'picker()')
  report.check(tag('arrow keys move the saturation and brightness'), picker.hex.value !== row.text.split(' | ')[0] && /Saturation \d+%, brightness \d+%/.test(picker.area.valuetext), json(picker.area))
  await browser.press('Escape')
  await settle(browser)
  report.check(tag('Escape closes it without changing the colour, and focus returns to the swatch'), (await colour(browser, 'picker()')) === null && json((await colour(browser, 'colour()')).value) === json(start) && (await colour(browser, 'active()')).startsWith('Edit colour'), await colour(browser, 'active()'))

  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  picker = await colour(browser, 'picker()')
  await browser.mouseDown(picker.area.left + picker.area.width * 0.75, picker.area.top + picker.area.height * 0.25)
  // Past the area's top-right corner (kept inside the window, where Firefox accepts pointer moves).
  const page = await ev(browser, '({ w: innerWidth, h: innerHeight })')
  const past = { x: Math.min(picker.area.left + picker.area.width + 40, page.w - 2), y: Math.max(2, picker.area.top - 40) }
  await browser.mouseMove(past.x, past.y)
  await browser.mouseUp(past.x, past.y)
  await settle(browser)
  picker = await colour(browser, 'picker()')
  report.check(tag('dragging in the area past its corner reaches full saturation and brightness'), picker.area.valuetext === 'Saturation 100%, brightness 100%', picker.area.valuetext)
  await colour(browser, 'setRange(0, 120)')
  await colour(browser, 'setRange(1, 128)')
  await settle(browser)
  picker = await colour(browser, 'picker()')
  report.check(tag('the hue and alpha sliders set the new colour'), picker.hex.value === '#00FF0080' && picker.rgba === 'RGBA 0, 255, 0, 128 · Alpha 50%', `${picker.hex.value} ${picker.rgba}`)
  await browser.click(picker.cancel.x, picker.cancel.y)
  await settle(browser)
  report.check(tag('Cancel changes nothing'), json((await colour(browser, 'colour()')).value) === json(start))

  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  await colour(browser, 'focusHex()')
  await browser.type('#12ab')
  await browser.press('Escape')
  await settle(browser)
  picker = await colour(browser, 'picker()')
  report.check(tag('Escape in the hex field cancels only the unfinished entry'), picker !== null && picker.hex.value !== '#12ab', json(picker?.hex))
  await colour(browser, 'focusHex()')
  await browser.type('#1a2b3c80')
  await browser.press('Enter')
  await settle(browser)
  picker = await colour(browser, 'picker()')
  report.check(tag('a typed hex value with alpha is taken exactly on Enter, and Enter does not close the picker'), picker?.hex.value === '#1A2B3C80' && picker.rgba === 'RGBA 26, 43, 60, 128 · Alpha 50%', json(picker?.hex))
  await browser.click(picker.apply.x, picker.apply.y)
  await settle(browser)
  const chosen = await colour(browser, 'colour()')
  row = await colour(browser, 'row()')
  report.check(tag('Apply sets the colour exactly; the row shows it without a pixel'), json(chosen.value) === json({ r: 26, g: 43, b: 60, a: 128 }) && chosen.sample === null && row.text === '#1A2B3C80 | RGBA 26, 43, 60, 128 | Alpha 50%', json(row))
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  picker = await colour(browser, 'picker()')
  await browser.click(picker.apply.x, picker.apply.y)
  await settle(browser)
  report.check(tag('Apply without changes keeps the colour exactly'), json(await colour(browser, 'colour()')) === json(chosen))
  report.check(tag('the image never changed while choosing colours'), json(await colour(browser, 'fingerprint()')) === json(fingerprint))

  await pickerBlocksImports(browser, tag)
  await pickerPlacement(browser, tag)

  const errors = await ev(browser, 'window.__minty.errors')
  const messages = await edit(browser, 'consoleMessages()')
  report.check(tag('no page errors or console warnings'), errors.length === 0 && messages.length === 0, json([...errors, ...messages]))
}

/**
 * Phase 4 audit L1: the picker is placed again when the window changes size, so every control,
 * Cancel and Apply included, stays on screen and reachable, also in a short window; focus stays
 * where it was; and it does not move during ordinary use.
 */
async function pickerPlacement(browser, tag) {
  const tool = await colour(browser, 'toolButton()')
  await browser.click(tool.x, tool.y)
  await settle(browser)
  const row = await colour(browser, 'row()')
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  const opened = await colour(browser, 'pickerReach()')
  report.check(tag('the picker opens just below its swatch, every control reachable'), opened.unreachable.length === 0 && Math.abs(opened.box.top - (opened.swatchBottom + 6)) < 1, json(opened))
  await browser.press('ArrowRight')
  await colour(browser, 'setRange(0, 200)')
  await colour(browser, 'focusInPicker("hue")')
  await settle(browser)
  const used = await colour(browser, 'pickerReach()')
  report.check(tag('using it does not move it'), json(used.box) === json(opened.box), json([opened.box, used.box]))
  const results = []
  for (const [width, height] of [[640, 480], [640, 360], [1400, 900]]) {
    await browser.resize(width, height)
    await waitFor(async () => json((await ev(browser, '[innerWidth, innerHeight]'))) === json([width, height]), { what: `a ${width} × ${height} window` })
    await settle(browser)
    await settle(browser)
    results.push({ size: [width, height], ...(await colour(browser, 'pickerReach()')) })
  }
  report.check(
    tag('after resizing to 640 × 480, to a short 640 × 360 and back, every control stays on screen and reachable, and focus stays on the hue slider'),
    results.every((r) => r.unreachable.length === 0 && r.focus === 'hue'),
    json(results),
  )
  const last = results[results.length - 1]
  report.check(tag('back in a tall window it is again just below its swatch'), Math.abs(last.box.top - (last.swatchBottom + 6)) < 1, json(last))
  await browser.press('Escape')
  await settle(browser)
}

/**
 * Chrome only: puts `blob` ({ type, base64 } or text) on the browser's clipboard and presses
 * Ctrl + V as a user does, so the browser itself sends the paste to the focused element. Headless
 * Chrome has its own clipboard, never the desktop's.
 */
async function realPaste(browser, content) {
  const origin = await ev(browser, 'location.origin')
  for (const name of ['clipboard-read', 'clipboard-write']) {
    await browser.cdp('Browser.setPermission', { origin, permission: { name, ...(name === 'clipboard-write' ? { allowWithoutSanitization: true } : {}) }, setting: 'granted' })
  }
  const written = await ev(browser, `(async () => {
    const content = ${json(content)}
    const blob = content.text !== undefined ? new Blob([content.text], { type: 'text/plain' }) : new Blob([Uint8Array.from(atob(content.base64), (c) => c.charCodeAt(0))], { type: content.type })
    try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); return 'ok' } catch (error) { return String(error) }
  })()`)
  if (written !== 'ok') throw new Error(`Could not write the clipboard: ${written}`)
  const key = { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86, modifiers: 2 }
  await browser.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key, commands: ['paste'] })
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
}

/**
 * Phase 4 audit M3: while the colour picker is open, no image is imported behind it, whichever of
 * its controls has focus and however the paste or drop arrives; its draft colour, Cancel, Apply and
 * Escape are unaffected; text still pastes into the hex field; editing shortcuts do nothing; and
 * once it is closed, pasting an image opens it as before.
 */
async function pickerBlocksImports(browser, tag) {
  const chrome = !!browser.cdp
  const png = { base64: fileBase64(fixture('crop-columns.png')), type: 'image/png' }
  const imports = () => colour(browser, 'imports()')
  const tool = await colour(browser, 'toolButton()')
  await browser.click(tool.x, tool.y)
  await settle(browser)
  const start = await colour(browser, 'colour()')
  let row = await colour(browser, 'row()')
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  // A draft change, which must survive everything below.
  await browser.press('ArrowLeft')
  await browser.press('ArrowDown')
  await settle(browser)
  const draft = (await colour(browser, 'picker()')).hex.value
  const before = await imports()
  const fingerprint = await colour(browser, 'fingerprint()')
  const wrong = []
  for (const target of ['area', 'hue', 'alpha', 'Cancel', 'Apply']) {
    if (!(await colour(browser, `focusInPicker(${json(target)})`))) {
      wrong.push({ target, picker: 'closed before this paste' })
      break
    }
    await colour(browser, `pasteFileAtFocus(${json(png.base64)}, 'pasted.png', 'image/png')`)
    if (chrome) await realPaste(browser, png)
    await colour(browser, `dropFile(${json(png.base64)}, 'dropped.png', 'image/png')`)
    // Pastes and drops start importing after a short asynchronous check.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await settle(browser)
    const now = await imports()
    const picker = await colour(browser, 'picker()')
    if (json(now) !== json(before) || picker === null || picker.hex.value !== draft) wrong.push({ target, now, picker: picker?.hex.value })
  }
  report.check(
    tag(`with the picker open, pasted${chrome ? ' (real Ctrl + V and event)' : ' (event)'} and dropped images are never imported, whatever control has focus; the picker and its draft stay`),
    wrong.length === 0,
    json(wrong),
  )
  await colour(browser, 'focusInPicker("area")')
  await browser.press('a', { ctrl: true })
  await browser.press('Delete')
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(tag('with the picker open, Ctrl + A, Delete and Ctrl + Z do nothing behind it'), json(await colour(browser, 'fingerprint()')) === json(fingerprint) && (await colour(browser, 'picker()')) !== null)

  // Text into the hex field.
  await colour(browser, 'focusInPicker("hex")')
  const prevented = await colour(browser, 'pasteTextAtFocus("#336699")')
  report.check(tag('a text paste into the hex field is left to the browser (not taken by the app)'), prevented === false && (await imports()).id === before.id)
  if (chrome) {
    await colour(browser, 'focusInPicker("hex")')
    await realPaste(browser, { text: '#336699' })
    await settle(browser)
    const typed = (await colour(browser, 'picker()')).hex.value
    await browser.press('Enter')
    await settle(browser)
    const picker = await colour(browser, 'picker()')
    report.check(tag('real Ctrl + V pastes text into the hex field, and Enter takes it'), typed === '#336699' && picker?.hex.value === '#336699', `${typed} then ${picker?.hex.value}`)
  }
  await browser.press('Escape')
  await settle(browser)
  report.check(tag('Escape still closes it without changing the colour, and nothing was imported'), (await colour(browser, 'picker()')) === null && json(await colour(browser, 'colour()')) === json(start) && json(await imports()) === json(before))

  // Apply still works after blocked pastes.
  row = await colour(browser, 'row()')
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  await colour(browser, 'focusInPicker("Apply")')
  await colour(browser, `pasteFileAtFocus(${json(png.base64)}, 'pasted.png', 'image/png')`)
  await new Promise((resolve) => setTimeout(resolve, 300))
  let picker = await colour(browser, 'picker()')
  await browser.click(picker.apply.x, picker.apply.y)
  await settle(browser)
  report.check(tag('Apply still applies after a blocked paste'), (await colour(browser, 'picker()')) === null && json(await imports()) === json(before) && (await colour(browser, 'colour()')).sample === null)

  // Closed: pasting an image opens it as before.
  await colour(browser, `pasteFileAtFocus(${json(png.base64)}, 'pasted.png', 'image/png')`)
  await waitFor(async () => (await imports()).id !== before.id && (await imports()).pending === null, { what: 'the pasted image to open' })
  picker = await colour(browser, 'picker()')
  report.check(tag('with the picker closed, a pasted image opens as before'), picker === null && (await ev(browser, 'window.__minty.state().document.name')).startsWith('pasted'), await ev(browser, 'window.__minty.state().document.name'))
}

/**
 * Phase 4 audit L2, in each browser's forced colours mode (Chrome's emulation, Firefox's "override
 * the page's colours"): the colour-carrying surfaces keep their colours on screen (screenshots),
 * everything around them keeps the system colours, and the focus ring uses the system highlight.
 * Real contrast themes (Windows, GNOME high contrast) still need checking by hand.
 */
async function forcedColours(browser, url, name) {
  const tag = (text) => `${name}: ${text}`
  await load(browser, url)
  if (!(await ev(browser, COLOUR_HELPERS))) throw new Error('Could not install the colour helpers')
  report.check(tag('forced colours are active'), await ev(browser, `matchMedia('(forced-colors: active)').matches`))
  await openWithAnswer(browser, fixture('crop-columns.png'))
  const tool = await colour(browser, 'toolButton()')
  await browser.click(tool.x, tool.y)
  await settle(browser)
  // An opaque colour, read with the Eyedropper (crop-columns.png: a green near pixel (15, 40)).
  await sampleAt(browser, await pointIn(browser, 15, 40, 0.5, 0.5))
  const chosen = (await colour(browser, 'colour()')).value
  const row = await colour(browser, 'row()')
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  const info = await ev(browser, `(() => {
    const d = document.querySelector('dialog.colour-picker[open]')
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }
    const probe = document.createElement('span')
    document.body.append(probe)
    const system = (value) => { probe.style.color = value; return getComputedStyle(probe).color }
    const canvas = system('Canvas'), highlight = system('Highlight')
    probe.remove()
    const adjust = (e) => getComputedStyle(e).forcedColorAdjust
    const buttons = [...d.querySelectorAll('button')]
    return {
      area: box(d.querySelector('.colour-picker__area')), hue: box(d.querySelector('.colour-picker__slider--hue')), alpha: box(d.querySelector('.colour-picker__slider--alpha')),
      swatches: [...d.querySelectorAll('.colour-picker__swatch > span')].map(box), option: box(document.querySelector('.tool-options__swatch > span')),
      dialogBackground: getComputedStyle(d).backgroundColor, canvas, highlight,
      kept: [d.querySelector('.colour-picker__area'), ...d.querySelectorAll('input[type=range]'), ...d.querySelectorAll('.colour-picker__swatch'), document.querySelector('.tool-options__swatch')].map(adjust),
      system: [d, d.querySelector('.colour-picker__hex-input'), ...buttons, d.querySelector('.colour-picker__title')].map(adjust),
    }
  })()`)
  report.check(tag('only the area, the tracks and the swatches keep their colours; the dialog, hex field, buttons and title use system colours'), info.kept.every((v) => v === 'none') && info.system.every((v) => v === 'auto') && info.dialogBackground === info.canvas, json({ kept: info.kept, system: info.system, background: info.dialogBackground, canvas: info.canvas }))
  const png = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  const at = (x, y) => { const i = (Math.round(y) * png.width + Math.round(x)) * 4; return [...png.data.subarray(i, i + 3)] }
  const distinct = ({ x, y, w, h }) => {
    const seen = new Set()
    for (let Y = Math.ceil(y) + 2; Y < y + h - 2; Y += 2) for (let X = Math.ceil(x) + 2; X < x + w - 2; X += 2) seen.add(at(X, Y).join(','))
    return seen.size
  }
  // The area's top-right corner is the colour's hue at full saturation and brightness.
  const { r, g, b } = chosen, max = Math.max(r, g, b), min = Math.min(r, g, b)
  const hue = max === b ? 240 + (60 * (r - g)) / (max - min) : max === g ? 120 + (60 * (b - r)) / (max - min) : (360 + (60 * (g - b)) / (max - min)) % 360
  const pure = [5, 3, 1].map((n) => { const k = (n + hue / 60) % 6; return Math.round(255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)))) })
  // 3 px in from the corner: the white and black gradients add a few levels.
  const corner = at(info.area.x + info.area.w - 3, info.area.y + 3)
  const swatchColours = info.swatches.map((s) => at(s.x + s.w / 2, s.y + s.h / 2))
  const checks = {
    corner: chosen.a === 255 && corner.every((v, k) => Math.abs(v - pure[k]) <= 12),
    area: distinct(info.area) > 500,
    hue: distinct(info.hue) > 30,
    alpha: distinct(info.alpha) > 10,
    // Current and New: exactly the (opaque) colour.
    swatches: swatchColours.every((c) => json(c) === json([chosen.r, chosen.g, chosen.b])),
  }
  report.check(tag('on screen the area shows the hue, the hue and alpha tracks their gradients, and every swatch the colour'), Object.values(checks).every(Boolean), json({ checks, corner, pure, swatchColours, distinct: [distinct(info.area), distinct(info.hue), distinct(info.alpha)] }))
  // Focus: the ring is the system highlight (visible in headless Chrome; headless Firefox draws no rings).
  await browser.press('Tab')
  await browser.press('Tab', { shift: true })
  await settle(browser)
  const ring = await ev(browser, `(() => { const e = document.activeElement, s = getComputedStyle(e); return { focused: e.getAttribute('aria-label'), style: s.outlineStyle, colour: s.outlineColor, visible: e.matches(':focus-visible') } })()`)
  let ok
  if (browser.cdp) {
    // On screen, just outside the area: the ring, the highlight drawn over the dialog's Canvas.
    const shot = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
    const [hr, hg, hb, ha = 1] = info.highlight.match(/[\d.]+/g).map(Number)
    const canvas = info.canvas.match(/\d+/g).map(Number)
    const expected = [hr, hg, hb].map((v, k) => v * ha + canvas[k] * (1 - ha))
    const i = (Math.round(info.area.y + info.area.h / 2) * shot.width + Math.round(info.area.x - 3)) * 4
    ring.screen = [...shot.data.subarray(i, i + 3)]
    ok = ring.focused === 'Saturation and brightness' && ring.visible && ring.style === 'solid' && ring.colour === info.highlight && ring.screen.every((v, k) => Math.abs(v - expected[k]) <= 3)
  } else {
    // Headless Firefox never matches :focus-visible for scripted key presses (no rings are drawn), so
    // the rule itself is checked: in forced colours, the focused area's ring is Highlight.
    ring.rule = await ev(browser, `(() => {
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
        if (rule.media?.mediaText.includes('forced-colors') && rule.matches !== false) {
          for (const inner of rule.cssRules) if (inner.selectorText?.includes('.colour-picker__area:focus-visible')) return inner.style.outline
        }
      }
      return null
    })()`)
    ok = ring.focused === 'Saturation and brightness' && /highlight/i.test(ring.rule ?? '')
  }
  report.check(tag('the focused area has a visible focus ring in the system highlight colour'), ok, json({ ...ring, highlight: info.highlight }))
  await browser.press('Escape')
  await settle(browser)
  // The options row's swatch (no longer under the dialog's backdrop) shows the colour too.
  const option = await ev(browser, `(() => { const r = document.querySelector('.tool-options__swatch > span').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, adjust: getComputedStyle(document.querySelector('.tool-options__swatch')).forcedColorAdjust } })()`)
  const closed = decodePng(Buffer.from(await browser.screenshot(), 'base64'))
  const j = (Math.round(option.y) * closed.width + Math.round(option.x)) * 4
  const optionColour = [...closed.data.subarray(j, j + 3)]
  report.check(tag('the Eyedropper options swatch shows the colour exactly'), json(optionColour) === json([chosen.r, chosen.g, chosen.b]) && option.adjust === 'none', json({ optionColour, chosen }))
  const errors = await ev(browser, 'window.__minty.errors')
  report.check(tag('no page errors'), errors.length === 0, json(errors))
}

ensureCropFixtures()
await ensureEdgeFixtures()
const server = await serveBuild()
try {
  for (const which of browsers) {
    for (const dpr of ratios) {
      const browser = await launch(which, { dpr })
      try {
        await run(browser, server.url, browser.name)
      } catch (error) {
        report.check(`${browser.name}: completed without an exception`, false, error.stack)
      } finally {
        await browser.close()
      }
    }
    if (!values['no-forced-colours']) {
      const browser = await launch(which, { dpr: 1, forcedColors: true })
      try {
        await forcedColours(browser, server.url, browser.name)
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
