// Page and driver helpers for the Edge cleanup and Feather checks (Phase 3 Steps 8 and 9):
// edge-cleanup.mjs and edge-adjust.mjs. EDGE_HELPERS is installed as window.__mintyEdges after
// PAGE_HELPERS and EDIT_HELPERS; the other exports drive the app as a user would.
import { dispatch, openApp, settle } from './app.mjs'
import { EDIT_HELPERS } from './edit.mjs'
import { importSource } from './source.mjs'

// The application's own code, run in Node for the expected results.
const { deleteSelectionWithEdges } = await importSource('image/edit/deleteWithEdges.ts')
const { createSelectionMask } = await importSource('image/selection/selectionMask.ts')

export const ev = (browser, expression) => browser.eval(expression)
export const edit = (browser, call) => browser.eval(`window.__mintyEdit.${call}`)
export const edges = (browser, call) => browser.eval(`window.__mintyEdges.${call}`)
export const summary = (browser) => edit(browser, 'summary()')
export const json = (value) => JSON.stringify(value)

export const EDGE_HELPERS = `(() => {
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
    /** Whether a committed amount would make the last Delete again (Phase 3 Step 9), as editCommands.adjustableDelete decides. */
    adjustable() {
      const s = m.state(), e = s.adjustableEdit
      return !!e && s.history.undo.at(-1) === e && s.history.redo.length === 0 && !s.selection && !s.lastMagicWandOperation && s.pendingImportId === null
    },
    /** The edge amounts the latest history entry was made with (a Delete's), or null. */
    latestSettings: () => m.state().history.undo.at(-1)?.edgeSettings ?? null,
    /** The status bar's note that the amounts update the last Delete, and the heights of the rows around it. */
    note() {
      const note = document.querySelector('.status-bar__adjust:not(.status-bar__divider)')
      const bar = document.querySelector('.status-bar'), row = document.querySelector('.tool-options'), info = document.querySelector('.status-bar__info')
      return {
        shown: !!note && getComputedStyle(note).display !== 'none' && note.getBoundingClientRect().width > 0,
        text: note?.textContent ?? null,
        statusHeight: Math.round(bar.getBoundingClientRect().height),
        rowHeight: Math.round(row.getBoundingClientRect().height),
        infoOverflows: info.scrollWidth > info.clientWidth + 1,
        docWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }
    },
    /** Commits an amount as assistive technology sets a slider: the value, then a change event (synchronous). */
    commitSlider(label, value) {
      const c = find(label)
      c.slider.value = String(value)
      c.slider.dispatchEvent(new Event('change', { bubbles: true }))
      return m.state().edgeSettings
    },
    layout() {
      const row = document.querySelector('.tool-options')
      const groups = [...row.children].map((g) => ({ text: g.textContent.trim().slice(0, 30), ...centre(g) }))
      return { rowWidth: row.clientWidth, scrollWidth: row.scrollWidth, docWidth: document.documentElement.scrollWidth, viewport: innerWidth, groups }
    },
  }
  return true
})()`

export async function load(browser, url) {
  await openApp(browser, url)
  if (!(await ev(browser, EDIT_HELPERS))) throw new Error('Could not install the editing helpers')
  if (!(await ev(browser, EDGE_HELPERS))) throw new Error('Could not install the edge helpers')
}

/** A real click on image pixel (x, y), panning it into view first if it is outside. */
export async function clickPixel(browser, x, y) {
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
export async function select(browser, clicks) {
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
export async function typeAmount(browser, label, value) {
  const control = await edges(browser, `control(${json(label)})`)
  await browser.click(control.field.x, control.field.y)
  await edges(browser, `selectField(${json(label)})`)
  await browser.type(String(value))
  await browser.press('Enter')
  await settle(browser)
}

export async function setAmounts(browser, cleanup, feather) {
  const now = await edges(browser, 'settings()')
  if (now.cleanup !== cleanup) await typeAmount(browser, 'Edge cleanup', cleanup)
  if (now.feather !== feather) await typeAmount(browser, 'Feather', feather)
  // Leave the field, so that Delete deletes rather than editing its text.
  await edges(browser, 'blur()')
  await settle(browser)
  const after = await edges(browser, 'settings()')
  if (after.cleanup !== cleanup || after.feather !== feather) throw new Error(`Could not set the amounts with the controls: ${json(after)}`)
}

export async function placeForChecks(browser) {
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'wheel-panned', delta: { x: -37, y: 23 } })
  await settle(browser)
}

export const bytesOf = (base64) => new Uint8ClampedArray(Buffer.from(base64, 'base64'))
export const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0
/** The page's pixelsHash (FNV-1a over the bytes). */
export function hash(bytes) {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619)
  return h >>> 0
}
export function changedPixelCount(a, b) {
  let n = 0
  for (let p = 0; p < a.length; p += 4) if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || a[p + 3] !== b[p + 3]) n++
  return n
}
export function firstDifference(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pixel: i >> 2, got: [...a.subarray(i & ~3, (i & ~3) + 4)], expected: [...b.subarray(i & ~3, (i & ~3) + 4)] }
  return null
}

/** The document and selection as Node values, and what Delete with `settings` must produce. */
export async function expectation(browser, settings) {
  const document = await edges(browser, 'document()')
  const selected = await edges(browser, 'selection()')
  const pixels = { width: document.width, height: document.height, data: bytesOf(document.pixels) }
  const selection = selected && createSelectionMask(document.width, document.height, new Uint8Array(Buffer.from(selected.data, 'base64')))
  const result = deleteSelectionWithEdges(pixels, selection, settings)
  return { pixels, selection, result }
}
