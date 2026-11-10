// The Eyedropper and the colour picker (Phase 4) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/colour.mjs [--browser chrome|firefox|all] [--dpr 1,2]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real clicks, drags and key presses:
// - The Eyedropper tool: real clicks at Fit, 100%, 150% and 400%, on an opaque image whose every
//   pixel differs and on a partially transparent one: the colour is exactly the bytes of the
//   pixel the canvas shows under the pointer (read from the canvas itself), the row shows hex, RGBA,
//   alpha and the pixel, and the reading is announced. Sampling never changes the image, the
//   selection or the history. Clicks outside the image read nothing.
// - The colour picker, opened from the swatch: focus starts on the saturation / brightness area;
//   arrow keys, a pointer drag and the hue and alpha sliders change the new colour; Escape and
//   Cancel change nothing and return focus to the swatch; a typed hex value and Apply set the
//   colour exactly; Apply without changes keeps the colour exactly; Escape in the hex field cancels
//   only the entry; Delete, Ctrl + Z and Escape do not reach the editor while it is open.
// - No page errors or console warnings.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, dispatch, settle } from './lib/app.mjs'
import { serveBuild } from './lib/app.mjs'
import { edit, ev, json, load } from './lib/edges.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { ensureCropFixtures, ensureEdgeFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1,2' },
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
  window.__mintyColour = {
    toolButton: () => centre([...document.querySelectorAll('.toolbar__tool')].find((b) => b.textContent.trim() === 'Eyedropper')),
    colour: () => m.state().colour,
    fingerprint() {
      const s = m.state()
      return { revision: s.document.revision, pixels: hash(s.document.pixels.data), undo: s.history.undo.length, selected: s.selection?.count ?? 0 }
    },
    /** The document pixel the canvas draws at client point (x, y): the device pixel's image index. */
    shownPixel(x, y) {
      const s = m.state(), v = s.viewport, dpr = devicePixelRatio, r = canvas().getBoundingClientRect()
      const scale = v.zoom * dpr
      const e = Math.round(v.offset.x * dpr), f = Math.round(v.offset.y * dpr)
      const X = Math.floor((x - r.left) * dpr + 0.01), Y = Math.floor((y - r.top) * dpr + 0.01)
      const index = (d) => Math.ceil((d + 0.5) / scale - 1e-6) - 1
      const px = index(X - e), py = index(Y - f)
      if (px < 0 || py < 0 || px >= s.document.width || py >= s.document.height) return null
      const i = (py * s.document.width + px) * 4, d = s.document.pixels.data
      return { pixel: { x: px, y: py }, rgba: { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] } }
    },
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
 * A real click at `client`: what the app read, and what the canvas shows there. Agreement means the
 * same pixel and values, or (on or past the image's edge) nothing shown and nothing read.
 */
async function sampleAt(browser, client) {
  const before = await colour(browser, 'colour()')
  await browser.click(client.x, client.y)
  await settle(browser)
  const state = await colour(browser, 'colour()')
  const shown = await colour(browser, `shownPixel(${client.x}, ${client.y})`)
  const agrees = shown
    ? !!state && json(state.value) === json(shown.rgba) && json(state.sample?.pixel) === json(shown.pixel)
    : json(state) === json(before)
  return { state, shown, agrees }
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

  // Real clicks at several zoom levels, at pixel centres and near pixel edges.
  const zooms = [['Fit', null], ['100%', 1], ['150%', 1.5], ['400%', 4]]
  let samples = 0
  let read = 0
  let wrong = []
  for (const [label, zoom] of zooms) {
    if (zoom === null) await dispatch(browser, { type: 'zoom-fitted' })
    else {
      await dispatch(browser, { type: 'zoom-actual-size' })
      if (zoom !== 1) await dispatch(browser, { type: 'zoom-scaled', anchor: await ev(browser, 'window.__minty.workspacePoint(0, 0)'), factor: zoom })
    }
    await settle(browser)
    for (const [x, y] of [[0, 0], [7, 3], [60, 41], [119, 79], [33, 70]]) {
      for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.9], [0.9, 0.1]]) {
        const client = await pointIn(browser, x, y, fx, fy)
        const { state, shown, agrees } = await sampleAt(browser, client)
        samples++
        if (shown) read++
        if (!agrees) wrong.push({ label, x, y, fx, fy, state, shown })
      }
    }
  }
  report.check(
    tag(`${samples} real clicks at Fit, 100%, 150% and 400% read exactly the pixel the canvas shows under the pointer (${read} on the image, the rest exactly on its far edge, reading nothing)`),
    wrong.length === 0 && read >= samples - 12,
    json(wrong.slice(0, 3)),
  )
  report.check(tag('sampling never changed the image, the selection or the history'), json(await colour(browser, 'fingerprint()')) === json(before), json(await colour(browser, 'fingerprint()')))
  const shownRow = await colour(browser, 'row()')
  report.check(tag('the row shows hex, RGBA, alpha and the pixel, and the reading is announced'), /^#[0-9A-F]{6} \| RGBA \d+, \d+, \d+, 255 \| Alpha 100% \| from pixel \d+, \d+$/.test(shownRow.text) && shownRow.status.startsWith('Colour read from pixel'), json(shownRow))
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
      const { state, shown, agrees } = await sampleAt(browser, await pointIn(browser, x, y, 0.5, 0.5))
      if (shown?.rgba.a > 0 && shown.rgba.a < 255) partial++
      if (shown?.rgba.a === 0) transparent++
      if (!agrees || !shown) wrong.push({ x, y, state, shown })
    }
  }
  report.check(
    tag(`on a partially transparent image, every value is read exactly (${partial} partly transparent, ${transparent} fully transparent pixels among them)`),
    wrong.length === 0 && partial > 0 && transparent > 0,
    json(wrong.slice(0, 3)),
  )

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
  report.check(tag('Apply sets the colour exactly; the row shows it without a pixel'), json(chosen) === json({ value: { r: 26, g: 43, b: 60, a: 128 }, sample: null }) && row.text === '#1A2B3C80 | RGBA 26, 43, 60, 128 | Alpha 50%', json(row))
  await browser.click(row.swatch.x, row.swatch.y)
  await settle(browser)
  picker = await colour(browser, 'picker()')
  await browser.click(picker.apply.x, picker.apply.y)
  await settle(browser)
  report.check(tag('Apply without changes keeps the colour exactly'), json(await colour(browser, 'colour()')) === json(chosen))
  report.check(tag('the image never changed while choosing colours'), json(await colour(browser, 'fingerprint()')) === json(fingerprint))

  const errors = await ev(browser, 'window.__minty.errors')
  const messages = await edit(browser, 'consoleMessages()')
  report.check(tag('no page errors or console warnings'), errors.length === 0 && messages.length === 0, json([...errors, ...messages]))
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
  }
} finally {
  await server.close()
}
report.finish()
