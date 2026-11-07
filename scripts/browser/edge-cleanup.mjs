// Delete Selection with edge cleanup and feathering (Phase 3 Step 8) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/edge-cleanup.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
//        [--step7 <Step 7 fixtures folder>] [--sheets <folder>]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// - The Edge cleanup and Feather controls: defaults (0 px), labels, units, range, tab order,
//   the slider's keys, typing, clamping, Escape, the Delete key inside the field, nothing computed
//   while adjusting, values kept across Deletes and images, and wrapping in a 640 px window.
// - For an HMI pump graphic (PNG and JPEG), thin lines and wiring, an anti-aliased logo, text and
//   sharp corners, a gradient background, a partially transparent PNG, shapes touching the
//   border, a soft JPEG photo and an SVG, at several cleanup and feather amounts set with the
//   controls: Delete produces exactly the bytes the application's own algorithm produces in Node
//   (imported from src/), with 0 / 0 exactly the Step 6 Delete; one history entry, the selection
//   cleared, the announcement, the canvas showing the result; Undo restores every byte and the
//   selection; Redo restores the result.
// - With --step7, the Step 7 fixtures (folders holding observed.png, meta.json and truth.png) are
//   deleted with their recorded Magic Wand clicks at cleanup 1, 2 and 4 px, compared byte for byte
//   with Node, and measured against their ground truth (mean edge error, as in the Step 7 report).
// - With --sheets, before / after images of each fixture's detail area are written as PNGs.
// - Unless --no-perf: Delete, Undo and Redo times at 4K and (unless --no-stress) near 50 MP for
//   each amount, history size, Undo / Redo exactness, live display images and, in Chrome, the
//   JavaScript heap. Timings are reported, never checked.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch } from './lib/browsers.mjs'
import { createReport, dispatch, openApp, serveBuild, settle } from './lib/app.mjs'
import { EDIT_HELPERS, openWithAnswer } from './lib/edit.mjs'
import { decodePng, encodePng } from './lib/png.mjs'
import { importSource } from './lib/source.mjs'
import { ensureEdgeFixtures, ensureEditFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
    step7: { type: 'string' },
    sheets: { type: 'string' },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const report = createReport()

// The application's own code, run in Node for the expected results.
const { deleteSelectionWithEdges } = await importSource('image/edit/deleteWithEdges.ts')
const { deleteSelectedPixels } = await importSource('image/edit/deleteSelection.ts')
const { createSelectionMask } = await importSource('image/selection/selectionMask.ts')

const ev = (browser, expression) => browser.eval(expression)
const edit = (browser, call) => browser.eval(`window.__mintyEdit.${call}`)
const edges = (browser, call) => browser.eval(`window.__mintyEdges.${call}`)
const summary = (browser) => edit(browser, 'summary()')
const json = (value) => JSON.stringify(value)

const EDGE_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const base64 = (bytes) => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(out)
  }
  const find = (label) => {
    const group = [...document.querySelectorAll('.tool-options__amount')].find((g) => g.querySelector('.tool-options__label')?.textContent === label)
    return group && { group, slider: group.querySelector('input[type=range]'), field: group.querySelector('input[type=text]') }
  }
  const centre = (element) => {
    const r = element.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right }
  }
  const nameOf = (element) => {
    if (!element) return null
    if (element.getAttribute('aria-label')) return element.getAttribute('aria-label')
    const by = element.getAttribute('aria-labelledby')
    return by ? document.getElementById(by)?.textContent ?? null : element.textContent.trim()
  }
  window.__mintyEdges = {
    settings: () => m.state().edgeSettings,
    control(label) {
      const c = find(label)
      if (!c) return null
      return {
        slider: { value: c.slider.value, min: c.slider.min, max: c.slider.max, step: c.slider.step, valuetext: c.slider.getAttribute('aria-valuetext'), name: nameOf(c.slider), title: c.slider.title, ...centre(c.slider) },
        field: { value: c.field.value, name: nameOf(c.field), title: c.field.title, inputMode: c.field.inputMode, ...centre(c.field) },
        unit: c.group.querySelector('.tool-options__unit')?.textContent ?? null,
        group: centre(c.group),
      }
    },
    focus(label, part) {
      const c = find(label)
      const element = part === 'field' ? c.field : c.slider
      element.focus()
      if (part === 'field') c.field.select()
      return document.activeElement === element
    },
    selectField(label) { find(label).field.select(); return true },
    focusButton(name) { [...document.querySelectorAll('button')].find((b) => nameOf(b) === name).focus(); return true },
    blur() { document.activeElement?.blur(); return true },
    active: () => ({ tag: document.activeElement?.tagName ?? null, type: document.activeElement?.type ?? null, name: nameOf(document.activeElement) }),
    document() {
      const d = m.state().document
      return { width: d.width, height: d.height, revision: d.revision, pixels: base64(d.pixels.data) }
    },
    selection() {
      const s = m.state().selection
      return s && { data: base64(s.data), count: s.count }
    },
    layout() {
      const row = document.querySelector('.tool-options')
      const groups = [...row.children].map((g) => ({ text: g.textContent.trim().slice(0, 30), ...centre(g) }))
      return { rowWidth: row.clientWidth, scrollWidth: row.scrollWidth, docWidth: document.documentElement.scrollWidth, viewport: innerWidth, groups }
    },
  }
  return true
})()`

async function load(browser, url) {
  await openApp(browser, url)
  if (!(await ev(browser, EDIT_HELPERS))) throw new Error('Could not install the editing helpers')
  if (!(await ev(browser, EDGE_HELPERS))) throw new Error('Could not install the edge helpers')
}

/** A real click on image pixel (x, y), panning it into view first if it is outside. */
async function clickPixel(browser, x, y) {
  const outside = await ev(browser, `(() => {
    const p = window.__minty.workspacePoint(${x} + 0.5, ${y} + 0.5), r = document.querySelector('canvas.workspace__canvas').getBoundingClientRect()
    return p.x < 20 || p.y < 20 || p.x > r.width - 20 || p.y > r.height - 20 ? { x: Math.round(r.width / 2 - p.x), y: Math.round(r.height / 2 - p.y) } : null
  })()`)
  if (outside) {
    await dispatch(browser, { type: 'wheel-panned', delta: outside })
    await settle(browser)
  }
  const point = await ev(browser, `window.__minty.clientPoint(${x}, ${y})`)
  await browser.click(point.x, point.y)
  await settle(browser)
}

/**
 * Magic Wand clicks: each { x, y, tolerance, flood = 'contiguous', mode = 'new' }, at 400% so that
 * a click at a pixel's centre cannot land on its neighbour (Firefox rounds pointer positions to
 * whole CSS pixels). The tolerance is set without committing it, which would re-apply the
 * previous click at the next click's tolerance.
 */
async function select(browser, clicks) {
  await dispatch(browser, { type: 'selection-cleared' })
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'zoom-scaled', anchor: { x: 0, y: 0 }, factor: 4 })
  await settle(browser)
  for (const { x, y, tolerance, flood = 'contiguous', mode = 'new' } of clicks) {
    await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: flood })
    await dispatch(browser, { type: 'magic-wand-selection-mode-changed', selectionMode: mode })
    await dispatch(browser, { type: 'magic-wand-tolerance-changed', tolerance })
    await clickPixel(browser, x, y)
  }
  await dispatch(browser, { type: 'magic-wand-selection-mode-changed', selectionMode: 'new' })
}

/** Sets an amount with the controls, as a user would: click the field, select its text, type, Enter. */
async function typeAmount(browser, label, value) {
  const control = await edges(browser, `control(${json(label)})`)
  await browser.click(control.field.x, control.field.y)
  await edges(browser, `selectField(${json(label)})`)
  await browser.type(String(value))
  await browser.press('Enter')
  await settle(browser)
}

async function setAmounts(browser, cleanup, feather) {
  const now = await edges(browser, 'settings()')
  if (now.cleanup !== cleanup) await typeAmount(browser, 'Edge cleanup', cleanup)
  if (now.feather !== feather) await typeAmount(browser, 'Feather', feather)
  // Leave the field, so that Delete deletes rather than editing its text.
  await edges(browser, 'blur()')
  await settle(browser)
  const after = await edges(browser, 'settings()')
  if (after.cleanup !== cleanup || after.feather !== feather) throw new Error(`Could not set the amounts with the controls: ${json(after)}`)
}

async function placeForChecks(browser) {
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'wheel-panned', delta: { x: -37, y: 23 } })
  await settle(browser)
}

const bytesOf = (base64) => new Uint8ClampedArray(Buffer.from(base64, 'base64'))
const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0
/** The page's pixelsHash (FNV-1a over the bytes). */
function hash(bytes) {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619)
  return h >>> 0
}
function changedPixelCount(a, b) {
  let n = 0
  for (let p = 0; p < a.length; p += 4) if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) n++
  return n
}
function firstDifference(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pixel: i >> 2, got: [...a.subarray(i & ~3, (i & ~3) + 4)], expected: [...b.subarray(i & ~3, (i & ~3) + 4)] }
  return null
}

/** The document and selection as Node values, and what Delete with `settings` must produce. */
async function expectation(browser, settings) {
  const document = await edges(browser, 'document()')
  const selected = await edges(browser, 'selection()')
  const pixels = { width: document.width, height: document.height, data: bytesOf(document.pixels) }
  const selection = selected && createSelectionMask(document.width, document.height, new Uint8Array(Buffer.from(selected.data, 'base64')))
  const result = deleteSelectionWithEdges(pixels, selection, settings)
  return { pixels, selection, result }
}

const AMOUNTS = [
  [0, 0],
  [1, 0],
  [3, 0],
  [5, 0],
  [0, 2],
  [2, 2],
  [5, 5],
]

const FIXTURE_SPECS = [
  { file: 'edge-hmi.png', clicks: [{ x: 2, y: 2, tolerance: 10 }], label: 'HMI pump graphic', detail: [130, 10, 120, 70] },
  { file: 'edge-hmi.jpg', clicks: [{ x: 2, y: 2, tolerance: 12 }], label: 'HMI graphic, JPEG', detail: [130, 10, 120, 70] },
  { file: 'edge-lines.png', clicks: [{ x: 1, y: 1, tolerance: 20, flood: 'global' }], label: 'thin lines and wiring', detail: [130, 20, 120, 70] },
  { file: 'edge-logo.png', clicks: [{ x: 2, y: 2, tolerance: 10 }], label: 'anti-aliased logo on solid colour', detail: [20, 50, 160, 80] },
  { file: 'edge-corners.png', clicks: [{ x: 1, y: 1, tolerance: 20, flood: 'global' }], label: 'text and sharp corners', detail: [10, 60, 160, 90] },
  { file: 'edge-gradient.png', clicks: [{ x: 2, y: 2, tolerance: 15 }, { x: 2, y: 236, tolerance: 15, mode: 'add' }], label: 'gradient background', detail: [130, 60, 170, 110] },
  { file: 'edge-alpha.png', clicks: [{ x: 30, y: 30, tolerance: 10 }], label: 'partially transparent PNG', detail: [50, 50, 160, 100] },
  { file: 'edge-border.png', clicks: [{ x: 120, y: 80, tolerance: 20, flood: 'global' }], label: 'shapes touching the border', detail: [0, 0, 120, 80] },
  { file: 'edge-photo.jpg', clicks: [{ x: 2, y: 2, tolerance: 25 }], label: 'soft photo, uneven JPEG background', detail: [150, 50, 110, 110] },
  { file: 'edge-svg.svg', clicks: [{ x: 2, y: 2, tolerance: 20 }], label: 'rasterised SVG', detail: [20, 30, 160, 100] },
]

/** The controls: defaults, names, keyboard, typing, persistence, and nothing computed while adjusting. */
async function controls(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'edge-hmi.png'))
  await placeForChecks(browser)
  for (const [label, field] of [
    ['Edge cleanup', 'Edge cleanup in pixels, 0 to 5'],
    ['Feather', 'Feather in pixels, 0 to 5'],
  ]) {
    const c = await edges(browser, `control(${json(label)})`)
    report.check(
      `${name}: ${label}: 0–5 px slider and field, both 0 by default, labelled with the unit`,
      c &&
        c.slider.value === '0' && c.slider.min === '0' && c.slider.max === '5' && c.slider.step === '1' &&
        c.slider.valuetext === '0 px' && c.slider.name === label && c.field.value === '0' && c.field.name === field &&
        c.field.inputMode === 'numeric' && c.unit === 'px' && c.slider.title.includes('0–5 px'),
      json(c),
    )
  }
  report.check(`${name}: the editor starts with no edge cleanup and no feathering`, json(await edges(browser, 'settings()')) === json({ cleanup: 0, feather: 0 }))

  // Tab order: Shrink, Edge cleanup slider and field, Feather slider and field, Delete Selection.
  await edges(browser, 'focusButton("Shrink Selection")')
  const order = []
  for (let i = 0; i < 5; i++) {
    await browser.press('Tab')
    order.push((await edges(browser, 'active()')).name)
  }
  report.check(
    `${name}: Tab reaches Edge cleanup (slider, field), Feather (slider, field), then Delete Selection`,
    json(order) === json(['Edge cleanup', 'Edge cleanup in pixels, 0 to 5', 'Feather', 'Feather in pixels, 0 to 5', 'Delete Selection']),
    json(order),
  )

  const start = await summary(browser)
  // The slider's own keys.
  await edges(browser, 'focus("Edge cleanup", "slider")')
  const steps = []
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'End', 'ArrowRight', 'ArrowLeft', 'Home', 'ArrowLeft', 'PageUp', 'PageDown']) {
    await browser.press(key)
    await settle(browser)
    const c = await edges(browser, 'control("Edge cleanup")')
    steps.push([key, (await edges(browser, 'settings()')).cleanup, c.field.value, c.slider.valuetext])
  }
  const expected = [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowUp', 3], ['End', 5], ['ArrowRight', 5], ['ArrowLeft', 4], ['Home', 0], ['ArrowLeft', 0]]
  report.check(
    `${name}: Edge cleanup slider: arrows step by 1, Home / End go to 0 / 5, the field and value text follow`,
    expected.every(([, value], i) => steps[i][1] === value && steps[i][2] === String(value) && steps[i][3] === `${value} px`),
    json(steps),
  )
  report.note(`  ${name}: Page Up / Page Down on the 0–5 slider: ${json(steps.slice(8))}`)

  // Typing in the field.
  const typed = []
  const field = async (action) => {
    await action()
    await settle(browser)
    typed.push([(await edges(browser, 'settings()')).feather, (await edges(browser, 'control("Feather")')).field.value])
  }
  await edges(browser, 'focus("Feather", "field")')
  await field(() => browser.type('3')) // applied while typing
  await field(() => browser.press('Enter'))
  await edges(browser, 'selectField("Feather")')
  await field(() => browser.type('9')) // out of range: waits
  await field(() => browser.press('Enter')) // clamped to 5
  await edges(browser, 'selectField("Feather")')
  await field(() => browser.type('2'))
  await field(() => browser.press('Escape')) // cancels the entry: back to 5
  await edges(browser, 'selectField("Feather")')
  await field(() => browser.type('x'))
  await field(() => browser.press('Enter')) // not a number: restored
  await field(() => browser.press('ArrowDown'))
  await field(() => browser.press('ArrowUp'))
  report.check(
    `${name}: Feather field: whole numbers apply as typed, larger values clamp to 5 on Enter, Escape cancels, other text is restored, arrows step`,
    json(typed) === json([[3, '3'], [3, '3'], [3, '9'], [5, '5'], [2, '2'], [5, '5'], [5, 'x'], [5, '5'], [4, '4'], [5, '5']]),
    json(typed),
  )

  // Delete inside the field edits the text, never the image; leaving the field restores the value.
  await clickPixel(browser, 2, 2)
  const selected = await summary(browser)
  await edges(browser, 'focus("Feather", "field")')
  await browser.press('Delete')
  await settle(browser)
  const afterKey = await summary(browser)
  const emptied = (await edges(browser, 'control("Feather")')).field.value
  report.check(
    `${name}: Delete in the Feather field edits its text only, not the image or the selection`,
    emptied === '' && afterKey.revision === selected.revision && afterKey.selected === selected.selected,
    json({ emptied, selected, afterKey }),
  )
  await browser.press('Tab')
  await settle(browser)
  const restored = (await edges(browser, 'control("Feather")')).field.value
  if (await ev(browser, 'document.hasFocus()')) {
    report.check(`${name}: leaving the emptied field restores its value`, restored === '5', restored)
  } else {
    // Headless Firefox has no window focus and fires no focus or blur events (as in Step 6).
    report.note(`  ${name}: leaving the field not checked: the headless window has no focus, so no blur event fires`)
    await typeAmount(browser, 'Feather', 5)
  }
  const adjusted = await summary(browser)
  report.check(
    `${name}: adjusting the amounts computes and records nothing`,
    adjusted.revision === start.revision && adjusted.undo === start.undo && adjusted.bytes === start.bytes,
    json({ start, adjusted }),
  )

  // Kept for the session: across a Delete (and its Undo) and another image.
  await setAmounts(browser, 2, 1)
  await browser.press('Delete')
  await settle(browser)
  await browser.press('z', { ctrl: true })
  await settle(browser)
  await openWithAnswer(browser, path.join(fixtures, 'edge-lines.png'))
  const kept = await edges(browser, 'settings()')
  const shown = [(await edges(browser, 'control("Edge cleanup")')).field.value, (await edges(browser, 'control("Feather")')).field.value]
  report.check(`${name}: the amounts stay as set after a Delete, its Undo and opening another image`, json(kept) === json({ cleanup: 2, feather: 1 }) && json(shown) === json(['2', '1']), json({ kept, shown }))
  await setAmounts(browser, 0, 0)

  // A 640 px window: every group stays whole, nothing scrolls sideways.
  await browser.resize(640, 800)
  await settle(browser)
  const narrow = await edges(browser, 'layout()')
  const amountGroups = narrow.groups.filter((g) => /^(Edge cleanup|Feather)/.test(g.text))
  report.check(
    `${name}: at 640 px the options row wraps whole groups, the amount controls stay on one line, nothing scrolls sideways`,
    narrow.scrollWidth <= narrow.rowWidth && narrow.docWidth <= narrow.viewport && amountGroups.length === 2 && amountGroups.every((g) => g.bottom - g.top <= 32) && narrow.groups.every((g) => g.right <= narrow.viewport),
    json(narrow),
  )
  await browser.resize(1400, 900)
  await settle(browser)
}

/** One fixture at every amount: exact bytes, history, selection, announcement, canvas, Undo, Redo. */
async function fixture(browser, fixtures, name, spec, sheets) {
  await openWithAnswer(browser, path.join(fixtures, spec.file))
  await placeForChecks(browser)
  const label = `${name}: ${spec.label}`
  const results = []
  for (const [cleanup, feather] of AMOUNTS) {
    const settings = { cleanup, feather }
    await setAmounts(browser, cleanup, feather)
    await select(browser, spec.clicks)
    await placeForChecks(browser)
    const { pixels, selection, result } = await expectation(browser, settings)
    const tag = `${label}, cleanup ${cleanup} px, feather ${feather} px`
    if (!selection || !result) {
      report.check(`${tag}: something to delete`, false, json({ selected: selection?.count ?? 0 }))
      continue
    }
    if (cleanup === 0 && feather === 0) {
      const exact = deleteSelectedPixels(pixels, selection)
      report.check(`${tag}: (Node) with both at 0 the result is exactly the Step 6 Delete`, sameBytes(result.pixels.data, exact.pixels.data) && json(result.bounds) === json(exact.bounds) && result.edgePixels === 0)
    }
    await edit(browser, 'save("before")')
    const start = await summary(browser)
    await browser.press('Delete')
    await settle(browser)
    const after = await summary(browser)
    const shown = bytesOf((await edges(browser, 'document()')).pixels)
    const exact = sameBytes(shown, result.pixels.data)
    report.check(`${tag}: Delete gives exactly the bytes of the application's algorithm`, exact, exact ? `${result.count} deleted, ${result.edgePixels} edge pixels` : json(firstDifference(shown, result.pixels.data)))
    report.check(
      `${tag}: one history entry, a fresh revision, selection and click cleared`,
      after.undo === start.undo + 1 && after.redo === 0 && after.revision > start.revision && after.selected === 0 && after.operation === null,
      json({ start, after }),
    )
    const announced = await edit(browser, 'announcement()')
    const count = result.count.toLocaleString('en-CA')
    const edge = result.edgePixels.toLocaleString('en-CA')
    report.check(
      `${tag}: announced`,
      announced?.includes(`${count} pixel`) && (result.edgePixels === 0 ? !announced.includes('edge pixel') : announced.includes(`${edge} edge pixel`)),
      announced ?? 'none',
    )
    const canvas = await ev(browser, 'window.__minty.compareImage()')
    report.check(`${tag}: the canvas shows the result`, !canvas.skipped && canvas.failures === 0, json({ n: canvas.n, wrong: canvas.wrong, maxPartial: canvas.maxPartial, first: canvas.first, skipped: canvas.skipped }))
    await browser.press('z', { ctrl: true })
    await settle(browser)
    report.check(`${tag}: Undo restores every byte and the selection`, (await edit(browser, 'samePixels("before")')) && (await edit(browser, 'sameSelection("before")')))
    await browser.press('y', { ctrl: true })
    await settle(browser)
    report.check(`${tag}: Redo restores the result exactly`, (await edit(browser, 'pixelsHash()')) === hash(result.pixels.data))
    await browser.press('z', { ctrl: true })
    await settle(browser)
    results.push({ cleanup, feather, deleted: result.count, edgePixels: result.edgePixels, bounds: result.bounds, history: after.bytes, pixels: result.pixels, original: pixels })
  }
  await edit(browser, 'forget("before")')
  for (const r of results) report.note(`  ${label}: cleanup ${r.cleanup}, feather ${r.feather}: ${r.deleted} deleted, ${r.edgePixels} edge pixels changed, bounds ${json(r.bounds)}, history ${(r.history / 1024).toFixed(1)} KB`)
  if (sheets && results.length) writeSheet(path.join(sheets, `${name}-${path.parse(spec.file).name}.png`), spec.detail, results)
}

/**
 * A before / after sheet for the detail rectangle [x, y, w, h], 4× enlarged, over a neutral grey
 * checkerboard: the original, then each amount's result.
 */
function writeSheet(file, [x0, y0, w, h], results) {
  const scale = 4
  const gap = 6
  const panels = [results[0].original, ...results.map((r) => r.pixels)]
  const width = panels.length * (w * scale + gap)
  const height = h * scale
  const out = new Uint8Array(width * height * 4)
  panels.forEach((image, n) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < w * scale; x++) {
        const sx = x0 + Math.floor(x / scale)
        const sy = y0 + Math.floor(y / scale)
        const k = (sy * image.width + sx) * 4
        const a = image.data[k + 3] / 255
        const background = (Math.floor(x / 8) + Math.floor(y / 8)) & 1 ? 150 : 112
        const o = (y * width + n * (w * scale + gap) + x) * 4
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(image.data[k + c] * a + background * (1 - a))
        out[o + 3] = 255
      }
    }
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, encodePng(width, height, out))
}

// Step 7 ground-truth measure: worst-case composite error over black and white, averaged over
// pixels within 3 px of a truth edge (the Step 7 report's "mean edge error").
function compositeError(o, t, k) {
  const oA = o[k + 3]
  const tA = t[k + 3]
  let worst = 0
  for (let c = 0; c < 3; c++) {
    const op = o[k + c] * oA
    const tp = t[k + c] * tA
    worst = Math.max(worst, Math.abs(op - tp) / 255, Math.abs(op + 255 * (255 - oA) - tp - 255 * (255 - tA)) / 255)
  }
  return worst
}
function meanEdgeError(out, truth) {
  const { width: W, height: H } = truth
  const t = truth.data
  const edge = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = t[(y * W + x) * 4 + 3]
      let e = a !== 0 && a !== 255
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (e || x + dx >= W || y + dy >= H) continue
        const b = t[((y + dy) * W + x + dx) * 4 + 3]
        if ((b === 0) !== (a === 0) || (b === 255) !== (a === 255)) e = true
      }
      if (e) edge[y * W + x] = 1
    }
  }
  let sum = 0
  let n = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let near = false
      for (let yy = Math.max(0, y - 3); yy <= Math.min(H - 1, y + 3) && !near; yy++) for (let xx = Math.max(0, x - 3); xx <= Math.min(W - 1, x + 3) && !near; xx++) near = edge[yy * W + xx] === 1
      if (!near) continue
      sum += compositeError(out, t, (y * W + x) * 4)
      n++
    }
  }
  return sum / Math.max(1, n)
}

/** The Step 7 fixtures in the real browsers: same bytes as Node, and the Step 7 accuracy. */
async function step7(browser, name, folder) {
  const results = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(folder, '..', 'results.json'), 'utf8')).results
    } catch {
      return null
    }
  })()
  for (const id of fs.readdirSync(folder).filter((d) => fs.existsSync(path.join(folder, d, 'meta.json'))).sort()) {
    const meta = JSON.parse(fs.readFileSync(path.join(folder, id, 'meta.json'), 'utf8'))
    const truth = meta.hasTruth ? decodePng(fs.readFileSync(path.join(folder, id, 'truth.png'))) : null
    await openWithAnswer(browser, path.join(folder, id, 'observed.png'))
    // The browser's import goes through a canvas, which stores colour premultiplied: partially
    // transparent pixels can come back with slightly different colour than the file holds.
    const file = decodePng(fs.readFileSync(path.join(folder, id, 'observed.png')))
    const imported = bytesOf((await edges(browser, 'document()')).pixels)
    const importChanged = changedPixelCount(file.data, imported)
    if (importChanged) report.note(`  ${name}: Step 7 ${id}: the browser imported ${importChanged} partially transparent pixels with other colour bytes than the file holds`)
    const clicks = meta.clicks.map((c) => ({ x: c.x, y: c.y, tolerance: c.tolerance, flood: c.floodMode, mode: c.mode }))
    const row = []
    for (const cleanup of [0, 1, 2, 4]) {
      await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup, feather: 0 } })
      await select(browser, clicks)
      const { result } = await expectation(browser, { cleanup, feather: 0 })
      await browser.press('Delete')
      await settle(browser)
      const shown = bytesOf((await edges(browser, 'document()')).pixels)
      report.check(`${name}: Step 7 ${id}, cleanup ${cleanup} px: same bytes as Node`, !!result && sameBytes(shown, result.pixels.data), result ? '' : 'nothing selected')
      const error = truth ? meanEdgeError(shown, truth) : null
      const key = cleanup === 0 ? 'exact' : `B-${cleanup}`
      const reference = results?.[id]?.rows?.[key]?.metrics?.compMeanEdge
      row.push(`${cleanup} px ${error === null ? 'no truth' : error.toFixed(2)}${reference === undefined ? '' : ` (Step 7 ${reference.toFixed(2)})`}`)
      // Only comparable when the browser imported exactly the file's bytes, as Step 7 read them.
      if (error !== null && reference !== undefined && !importChanged) {
        report.check(`${name}: Step 7 ${id}, cleanup ${cleanup} px: mean edge error as in Step 7`, Math.abs(error - reference) < 0.005, `${error.toFixed(3)} vs ${reference.toFixed(3)}`)
      }
      await browser.press('z', { ctrl: true })
      await settle(browser)
    }
    report.note(`  ${name}: Step 7 ${id} mean edge error: ${row.join(', ')}`)
  }
  await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup: 0, feather: 0 } })
}

const PERF_AMOUNTS = [[0, 0], [1, 0], [3, 0], [4, 0], [5, 0], [0, 1], [0, 3], [0, 5], [2, 2], [5, 5]]

/** Times Delete, Undo and Redo at each amount; checks Undo and Redo exactness by hash. */
async function perf(browser, fixtures, { file, seed, tolerance, label }) {
  await openWithAnswer(browser, path.join(fixtures, file), 'continue', { timeout: 120000 })
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  await edit(browser, `commitTolerance(${tolerance})`)
  await dispatch(browser, { type: 'zoom-fitted' })
  await settle(browser)
  const heap = async () => {
    if (!browser.cdp) return null
    await browser.cdp('HeapProfiler.enable')
    await browser.cdp('HeapProfiler.collectGarbage')
    const usage = await browser.cdp('Runtime.getHeapUsage')
    return { heapMB: +(usage.usedSize / 2 ** 20).toFixed(1), arrayBuffersMB: usage.backingStorageSize === undefined ? null : +(usage.backingStorageSize / 2 ** 20).toFixed(1) }
  }
  const fmt = (t) => `${t.total.toFixed(0)} ms (display image ${(t.put + t.transfer).toFixed(0)})`
  let exact = true
  let lastMemory = null
  for (const [cleanup, feather] of PERF_AMOUNTS) {
    await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup, feather } })
    await clickPixel(browser, seed[0], seed[1])
    const selected = (await summary(browser)).selected
    const original = await edit(browser, 'pixelsHash()')
    const del = await edit(browser, 'timeKey("Delete")')
    const result = await edit(browser, 'pixelsHash()')
    const bytes = (await summary(browser)).bytes
    const undo = await edit(browser, 'timeKey("z", { ctrl: true })')
    const undone = await edit(browser, 'pixelsHash()')
    const redo = await edit(browser, 'timeKey("y", { ctrl: true })')
    const redone = await edit(browser, 'pixelsHash()')
    await edit(browser, 'timeKey("z", { ctrl: true })')
    await dispatch(browser, { type: 'selection-cleared' })
    await settle(browser)
    const ok = del.changed && undo.changed && redo.changed && undone === original && redone === result
    exact &&= ok
    lastMemory = { ...(await heap()), ...(await edit(browser, 'liveImages()')) }
    report.note(
      `  ${label}, cleanup ${cleanup} px, feather ${feather} px: ${selected.toLocaleString('en-CA')} selected; Delete ${fmt(del)}; Undo ${fmt(undo)}; Redo ${fmt(redo)}; history ${(bytes / 1024).toFixed(0)} KB; exact ${ok}; memory ${json(lastMemory)}`,
    )
  }
  report.check(`${label}: every timed Delete changed the image, and Undo / Redo restored it exactly`, exact)
  report.check(`${label}: one live display image at the end`, lastMemory.live === 1 && lastMemory.currentLive, json(lastMemory))
  await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup: 0, feather: 0 } })
}

async function run(name, url, fixtures) {
  const browser = await launch(name, { dpr: 1, width: 1400, height: 900 })
  report.note(`\n=== ${browser.name} — ${url}`)
  try {
    await load(browser, url)
    await controls(browser, fixtures, browser.name)
    for (const spec of FIXTURE_SPECS) await fixture(browser, fixtures, browser.name, spec, values.sheets)
    if (values.step7) await step7(browser, browser.name, values.step7)
    if (!values['no-perf']) {
      await perf(browser, fixtures, { file: 'edge-hmi-4k.png', seed: [2, 2], tolerance: 10, label: `${browser.name} perf HMI 3840 × 2160` })
      await perf(browser, fixtures, { file: 'shot4k.png', seed: [560, 150], tolerance: 20, label: `${browser.name} perf screenshot 3840 × 2160` })
      if (!values['no-stress']) {
        await perf(browser, fixtures, { file: 'edge-hmi-50mp.png', seed: [2, 2], tolerance: 10, label: `${browser.name} perf HMI 8660 × 5773` })
        await perf(browser, fixtures, { file: 'big50mp.png', seed: [10, 10], tolerance: 20, label: `${browser.name} perf flat 8660 × 5773` })
      }
    }
    const errors = await ev(browser, 'window.__minty.errors')
    report.check(`${browser.name}: no page errors`, errors.length === 0, errors.join('; '))
    const messages = await edit(browser, 'consoleMessages()')
    report.check(`${browser.name}: no unexpected console errors or warnings (React's included)`, messages.length === 0, messages.join('; '))
  } catch (error) {
    report.check(`${browser.name}: run`, false, error.stack)
  } finally {
    await browser.close()
  }
}

await ensureEditFixtures()
const fixtures = await ensureEdgeFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) await run(name, server.url, fixtures)
} finally {
  await server.close()
}
report.finish()
