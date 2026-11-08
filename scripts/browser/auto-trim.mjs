// Auto Trim (Phase 3 Step 11) in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/auto-trim.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
//                                      [--kill-test-gpu-process]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real clicks, key presses and typing:
// - The toolbar's Auto Trim tool and its options row: the padding presets (0, 5, 10, 20), the field
//   (0–50 px: typing, Enter, Escape, clamping, text that is not a number, arrows and Page keys), the
//   unit, the Trim button, names, tooltips and tab order. Changing the padding computes nothing.
//   Clicks on the image select nothing while Auto Trim is the tool.
// - Magic Wand, Delete, then Trim: the document is exactly the rectangle a full alpha scan in the
//   page gives, cropped from the image before the trim, byte for byte (hidden colour included);
//   one entry; the selection and click cleared; the view is Fit; the canvas shows the result;
//   the announcement gives both sizes; Step 9's adjusting of the last Delete ends. Undo, Undo,
//   Redo, Redo (keys and header buttons) are exact, with the selection back on the second Undo.
// - Nothing to trim (the padding already reaches every edge, an opaque image, a fully transparent
//   image, content touching every edge): nothing changes, and a visible, dismissible message says
//   why. A transparent PNG with soft shadows: trimmed exactly, its faintest pixels kept; padding
//   50 clipped at the edges.
// - Unavailable while another image opens; nothing happens behind the replace confirmation; the
//   padding goes back to 5 when another image opens. Keyboard only. 25 edits then a trim: the
//   oldest Undo step is dropped and a visible message says so. Narrow windows. One live display
//   image at the end; no page errors or console warnings.
// - --kill-test-gpu-process (Chrome on Linux): after a trim, the GPU process is killed and the
//   canvas is restored showing the trimmed image exactly.
// - Unless --no-perf: Delete, Trim, Undo and Redo times (the synchronous handlers, display image
//   included), history size, live display images and, in Chrome, the JavaScript heap, at 4K and
//   (unless --no-stress) near 50 MP, plus the no-op scans. Times are reported, never checked.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch, sleep, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, serveBuild, settle } from './lib/app.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { clickPixel, edges, edit, ev, json, load, select, summary } from './lib/edges.mjs'
import { gpuProcesses } from './lib/gpu.mjs'
import { ensureEditFixtures, ensureTrimFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
    'kill-test-gpu-process': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const report = createReport()

/** Installed after the edit and edge helpers as window.__mintyTrim. */
const TRIM_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const centre = (element) => {
    const r = element.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }
  const row = () => document.querySelector('.tool-options[aria-label="Auto Trim options"]')
  const trimButton = () => [...(row()?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === 'Trim')
  const copy = (data) => new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const saved = {}
  window.__mintyTrim = {
    save(name) {
      const d = m.state().document
      saved[name] = { width: d.width, height: d.height, data: copy(d.pixels.data) }
      return [d.width, d.height]
    },
    forget(name) { delete saved[name]; return true },
    /**
     * The rectangle Auto Trim must keep of saved[name] with \`padding\`: the bounds of every pixel
     * with alpha above 0, by a full scan (independent of the app's), padded and clipped per side.
     */
    expectedKept(name, padding) {
      const { width, height, data } = saved[name]
      let left = Infinity, top = Infinity, right = -1, bottom = -1
      for (let y = 0; y < height; y++) {
        const row = y * width * 4
        for (let x = 0; x < width; x++) {
          if (data[row + x * 4 + 3] === 0) continue
          if (x < left) left = x
          if (x > right) right = x
          if (y < top) top = y
          bottom = y
        }
      }
      if (right < 0) return null
      const x0 = Math.max(0, left - padding), y0 = Math.max(0, top - padding)
      const x1 = Math.min(width, right + 1 + padding), y1 = Math.min(height, bottom + 1 + padding)
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, visible: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } }
    },
    /** Whether the open document is exactly the \`kept\` rectangle of saved[name], every byte (hidden colour included). */
    isCropOf(name, kept) {
      const s = saved[name], d = m.state().document, now = d.pixels.data
      if (d.width !== kept.width || d.height !== kept.height) return { ok: false, size: [d.width, d.height] }
      for (let y = 0; y < kept.height; y++) {
        const from = ((kept.y + y) * s.width + kept.x) * 4, to = y * kept.width * 4
        for (let i = 0; i < kept.width * 4; i++) {
          if (now[to + i] !== s.data[from + i]) return { ok: false, y, i, got: now[to + i], expected: s.data[from + i] }
        }
      }
      return { ok: true }
    },
    /** Whether the open document is saved[name], size and every byte. */
    same(name) {
      const s = saved[name], d = m.state().document
      if (d.width !== s.width || d.height !== s.height) return false
      const now = d.pixels.data
      for (let i = 0; i < now.length; i++) if (now[i] !== s.data[i]) return false
      return true
    },
    /** Partly transparent pixels of the open document, the faintest alpha, and fully transparent ones whose colour is not 0, 0, 0. */
    alphaStats() {
      const data = m.state().document.pixels.data
      let partial = 0, faintest = 256, transparent = 0, hidden = 0
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i]
        if (a === 0) { transparent++; if (data[i - 3] || data[i - 2] || data[i - 1]) hidden++ }
        else if (a < 255) { partial++; faintest = Math.min(faintest, a) }
      }
      return { partial, faintest, transparent, hidden }
    },
    padding: () => m.state().autoTrimPadding,
    tool: () => m.state().activeTool,
    notice: () => m.state().editNotice,
    toolButton(label) {
      const b = [...document.querySelectorAll('.toolbar__tool')].find((b) => b.textContent.trim() === label)
      return b && { disabled: b.disabled, pressed: b.getAttribute('aria-pressed'), title: b.title, ...centre(b) }
    },
    focusTool(label) {
      const b = [...document.querySelectorAll('.toolbar__tool')].find((b) => b.textContent.trim() === label)
      b.focus()
      return document.activeElement === b
    },
    options() {
      const r = row()
      if (!r) return { shown: false, magicWandRow: !!document.querySelector('.tool-options[aria-label="Magic Wand options"]') }
      const field = r.querySelector('input[type=text]'), trim = trimButton()
      const group = r.querySelector('.tool-options__padding')
      return {
        shown: true,
        magicWandRow: !!document.querySelector('.tool-options[aria-label="Magic Wand options"]'),
        label: document.getElementById(group.getAttribute('aria-labelledby'))?.textContent ?? null,
        presetsName: r.querySelector('.tool-options__segmented')?.getAttribute('aria-label') ?? null,
        presets: [...r.querySelectorAll('.tool-options__choice')].map((b) => ({ text: b.textContent, name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), ...centre(b) })),
        field: { value: field.value, name: field.getAttribute('aria-label'), inputMode: field.inputMode, ...centre(field) },
        unit: r.querySelector('.tool-options__unit')?.textContent ?? null,
        trim: { disabled: trim.getAttribute('aria-disabled'), title: trim.title, text: trim.textContent.trim(), ...centre(trim) },
        height: Math.round(r.getBoundingClientRect().height),
      }
    },
    focusField() {
      const field = row().querySelector('input[type=text]')
      field.focus()
      field.select()
      return document.activeElement === field
    },
    selectField() { row().querySelector('input[type=text]').select(); return true },
    /** A click on Trim dispatched in the page (synchronous: the edit is committed when it returns). */
    clickTrim() { trimButton().click(); return true },
    active() {
      const a = document.activeElement
      return { tag: a?.tagName ?? null, text: a?.textContent?.trim() ?? '', name: a?.getAttribute('aria-label') ?? null, type: a?.type ?? null }
    },
    /** The edit message shown in the workspace (not the visually hidden announcement), or null. */
    message: () => document.querySelector('.workspace__status .workspace-message__text')?.textContent ?? null,
    dismissButton() {
      const b = document.querySelector('.workspace__status .workspace-message__dismiss')
      return b && centre(b)
    },
    /** Whether the view is exactly Fit: Fit leaves the state's viewport as it is. */
    async fitted() {
      const before = m.state().viewport
      m.dispatch({ type: 'zoom-fitted' })
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      return m.state().viewport === before
    },
    layout() {
      const r = document.querySelector('.tool-options'), toolbar = document.querySelector('.toolbar'), trim = trimButton()
      return {
        rowWidth: r.clientWidth, rowScroll: r.scrollWidth, rowHeight: Math.round(r.getBoundingClientRect().height),
        toolbarWidth: toolbar.clientWidth, toolbarScroll: toolbar.scrollWidth,
        docWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        trim: trim && centre(trim),
        groups: [...r.children].map((g) => ({ text: g.textContent.trim().slice(0, 24), ...centre(g) })),
      }
    },
    /** Selects the single pixel (x, y): a selection change, as Select All or the Magic Wand make (test set-up only). */
    selectPixel(x, y) {
      const d = m.state().document, data = new Uint8Array(d.width * d.height)
      data[y * d.width + x] = 1
      m.dispatch({ type: 'selection-applied', version: { documentId: d.id, revision: d.revision }, selection: { width: d.width, height: d.height, data, count: 1, bounds: { x, y, width: 1, height: 1 } } })
      return true
    },
  }
  return true
})()`

const trimEval = (browser, call) => browser.eval(`window.__mintyTrim.${call}`)
const options = (browser) => trimEval(browser, 'options()')

async function chooseTool(browser, label) {
  const button = await trimEval(browser, `toolButton(${json(label)})`)
  await browser.click(button.x, button.y)
  await settle(browser)
}

/** A real click on Trim. */
async function clickTrim(browser) {
  const { trim } = await options(browser)
  await browser.click(trim.x, trim.y)
  await settle(browser)
}

async function clickPreset(browser, value) {
  const preset = (await options(browser)).presets.find((p) => p.text === String(value))
  await browser.click(preset.x, preset.y)
  await settle(browser)
}

/** Types into the padding field as a user would: click it, select its text, type, then `finish` (a key or null). */
async function typePadding(browser, text, finish = 'Enter') {
  const { field } = await options(browser)
  await browser.click(field.x, field.y)
  await trimEval(browser, 'selectField()')
  await browser.type(text)
  if (finish) await browser.press(finish)
  await settle(browser)
}

const announcement = (browser) => edit(browser, 'announcement()')

/** After a trim of saved[name] with `padding`: exact crop, sizes, one more entry, nothing selected, Fit, announced. */
async function expectTrim(browser, tag, name, padding, { entries, depth, from }) {
  const kept = await trimEval(browser, `expectedKept(${json(name)}, ${padding})`)
  const crop = await trimEval(browser, `isCropOf(${json(name)}, ${json(kept)})`)
  report.check(`${tag}: exactly the rectangle a full alpha scan gives with ${padding} px, every byte`, crop.ok, json({ kept, crop }))
  const s = await summary(browser)
  report.check(
    `${tag}: one entry more (${entries}), nothing to redo, depth ${depth}, nothing selected, no Magic Wand click`,
    s.undo === entries && s.redo === 0 && s.depth === depth && s.selected === 0 && s.operation === null && s.editError === null,
    json(s),
  )
  const text = await announcement(browser)
  const expected = `Auto Trim applied: ${from[0].toLocaleString('en-CA')} × ${from[1].toLocaleString('en-CA')} px trimmed to ${kept.width.toLocaleString('en-CA')} × ${kept.height.toLocaleString('en-CA')} px.`
  report.check(`${tag}: announced with both sizes, no visible message`, text === expected && (await trimEval(browser, 'message()')) === null, json(text))
  report.check(`${tag}: the trimmed image is fitted to the workspace`, await trimEval(browser, 'fitted()'))
  const compared = await ev(browser, 'window.__minty.compareImage()')
  report.check(`${tag}: the canvas shows the trimmed image`, !compared.skipped && compared.failures === 0, json({ skipped: compared.skipped, n: compared.n, wrong: compared.wrong, first: compared.first }))
  return kept
}

async function interaction(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'trim-pump.png'))
  const tool = await trimEval(browser, 'toolButton("Auto Trim")')
  report.check(`${name}: the toolbar's Auto Trim is available with an image open, not pressed`, !tool.disabled && tool.pressed === 'false' && tool.title === 'Remove empty transparent space around the image', json(tool))
  const rowBefore = await ev(browser, 'Math.round(document.querySelector(".tool-options").getBoundingClientRect().height)')
  await chooseTool(browser, 'Auto Trim')
  const shown = await options(browser)
  report.check(
    `${name}: choosing it presses it and shows its options instead of the Magic Wand's: Padding, presets 0 5 10 20 (5 pressed), the field (5) with "px", Trim`,
    (await trimEval(browser, 'tool()')) === 'auto-trim' &&
      (await trimEval(browser, 'toolButton("Auto Trim")')).pressed === 'true' &&
      shown.shown && !shown.magicWandRow && shown.label === 'Padding' && shown.presetsName === 'Padding presets' &&
      json(shown.presets.map((p) => [p.text, p.name, p.pressed])) === json([['0', '0 px', 'false'], ['5', '5 px', 'true'], ['10', '10 px', 'false'], ['20', '20 px', 'false']]) &&
      shown.field.value === '5' && shown.field.name === 'Padding in pixels, 0 to 50' && shown.field.inputMode === 'numeric' && shown.unit === 'px' &&
      shown.trim.text === 'Trim' && shown.trim.disabled === 'false' && shown.trim.title.startsWith('Trim the image to its visible pixels with 5 px of padding'),
    json(shown),
  )
  report.check(`${name}: the Auto Trim row is no taller than the Magic Wand row (the workspace keeps its size)`, shown.height <= rowBefore, json({ rowBefore, height: shown.height }))

  // Nothing but Trim changes the image while Auto Trim is the tool.
  await edit(browser, 'save("opened")')
  const before = await summary(browser)
  const images = (await edit(browser, 'liveImages()')).created
  await clickPixel(browser, 300, 250)
  report.check(`${name}: a click on the image selects nothing while Auto Trim is the tool`, (await summary(browser)).selected === 0)
  await clickPreset(browser, 10)
  let o = await options(browser)
  report.check(`${name}: preset 10 sets the padding and is the one pressed`, (await trimEval(browser, 'padding()')) === 10 && o.field.value === '10' && o.presets.filter((p) => p.pressed === 'true').map((p) => p.text).join() === '10')
  await typePadding(browser, '37', null)
  report.check(`${name}: typing 37 applies it as typed, no preset pressed`, (await trimEval(browser, 'padding()')) === 37 && (await options(browser)).presets.every((p) => p.pressed === 'false'))
  await browser.press('Enter')
  await typePadding(browser, '75', null)
  const waiting = await trimEval(browser, 'padding()')
  await browser.press('Enter')
  await settle(browser)
  // Chrome's driver inserts the text at once (37 stays); Firefox's types it key by key, so the 7 alone,
  // a valid padding, applies before the 5. Either way 75 itself never applies before Enter.
  report.check(`${name}: 75 waits for Enter (37, or 7 when typed key by key, while typed), then is clamped to 50`, [37, 7].includes(waiting) && (await trimEval(browser, 'padding()')) === 50 && (await options(browser)).field.value === '50', json({ waiting }))
  await typePadding(browser, 'abc')
  report.check(`${name}: text that is not a number restores the padding on Enter`, (await trimEval(browser, 'padding()')) === 50 && (await options(browser)).field.value === '50')
  await typePadding(browser, '3', null)
  const typed = await trimEval(browser, 'padding()')
  await browser.press('Escape')
  await settle(browser)
  report.check(`${name}: Escape cancels an unfinished entry, back to 50`, typed === 3 && (await trimEval(browser, 'padding()')) === 50 && (await options(browser)).field.value === '50', json({ typed }))
  await trimEval(browser, 'focusField()')
  await browser.press('ArrowDown')
  await browser.press('PageDown')
  await settle(browser)
  report.check(`${name}: Down steps by 1 and Page Down by 10 in the field`, (await trimEval(browser, 'padding()')) === 39)
  await browser.press('Tab')
  await settle(browser)
  const after = await summary(browser)
  report.check(
    `${name}: changing the padding computed nothing: same revision, history and depth, no display image created`,
    after.revision === before.revision && after.undo === 0 && after.depth === 0 && (await edit(browser, 'liveImages()')).created === images && (await edit(browser, 'samePixels("opened")')),
    json({ before, after }),
  )
  await clickPreset(browser, 5)

  // An opaque image (its own grey background) has nothing to trim: said visibly.
  await clickTrim(browser)
  report.check(
    `${name}: Trim on the opaque image changes nothing and says why, visibly`,
    (await trimEval(browser, 'message()')) === 'Nothing to trim: no side has more than 5 px of transparent space.' && (await revision(browser)) === before.revision && (await summary(browser)).undo === 0,
    json(await trimEval(browser, 'message()')),
  )
  const dismiss = await trimEval(browser, 'dismissButton()')
  await browser.click(dismiss.x, dismiss.y)
  await settle(browser)
  report.check(`${name}: the message is dismissed with its button`, (await trimEval(browser, 'message()')) === null)

  // Magic Wand, Delete, Trim.
  await chooseTool(browser, 'Magic Wand')
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await edit(browser, 'save("original")')
  await trimEval(browser, 'save("original")')
  await browser.press('Delete')
  await settle(browser)
  report.check(`${name}: after Delete, the edge amounts would update it (Step 9)`, await edges(browser, 'adjustable()'))
  await trimEval(browser, 'save("deleted")')
  await chooseTool(browser, 'Auto Trim')
  const created = (await edit(browser, 'liveImages()')).created
  await clickTrim(browser)
  const kept = await expectTrim(browser, `${name}, pump after Delete, padding 5`, 'deleted', 5, { entries: 2, depth: 2, from: [640, 480] })
  report.check(`${name}: the 1-pixel wire reaching x = 579 is inside the bounds, so the right side keeps 5 px`, kept.visible.x + kept.visible.width - 1 === 579 && kept.x + kept.width === 585, json(kept))
  report.check(`${name}: one display image created; one live`, (await edit(browser, 'liveImages()')).created === created + 1 && (await edit(browser, 'liveImages()')).live === 1)
  report.check(`${name}: the trim ends adjusting the last Delete; the status bar note is gone`, !(await edges(browser, 'adjustable()')) && !(await edges(browser, 'note()')).shown)
  const history = await edit(browser, 'historyButtons()')
  report.check(`${name}: the header offers "Undo Auto Trim"`, history.undo.name === 'Undo Auto Trim' && history.undo.disabled === 'false', json(history))
  if (name.startsWith('Chrome')) report.check(`${name}: focus stays on Trim`, (await trimEval(browser, 'active()')).text === 'Trim', json(await trimEval(browser, 'active()')))
  await trimEval(browser, 'save("trimmed")')

  // Undo, Undo, Redo, Redo; then the header buttons.
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(
    `${name}: Ctrl + Z: exactly the Delete result again (640 × 480, hidden colour included), fitted, announced`,
    (await trimEval(browser, 'same("deleted")')) && (await trimEval(browser, 'fitted()')) && (await announcement(browser)) === 'Undone: Auto Trim.',
  )
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(`${name}: Ctrl + Z again: the original image and its selection`, (await edit(browser, 'samePixels("original")')) && (await edit(browser, 'sameSelection("original")')) && (await summary(browser)).depth === 0)
  await browser.press('y', { ctrl: true })
  await settle(browser)
  report.check(`${name}: Ctrl + Y: the Delete result, nothing selected`, (await trimEval(browser, 'same("deleted")')) && (await summary(browser)).selected === 0)
  await browser.press('z', { ctrl: true, shift: true })
  await settle(browser)
  report.check(`${name}: Ctrl + Shift + Z: the trimmed image exactly, fitted`, (await trimEval(browser, 'same("trimmed")')) && (await trimEval(browser, 'fitted()')))
  for (const [index, expected] of [[0, 'deleted'], [1, 'trimmed']]) {
    const button = await ev(browser, `(() => { const r = document.querySelectorAll('.app-header__actions .button--icon')[${index}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
    await browser.click(button.x, button.y)
    await settle(browser)
    report.check(`${name}: the header's ${index ? 'Redo' : 'Undo'} button: ${expected}`, await trimEval(browser, `same(${json(expected)})`))
  }
  const compared = await ev(browser, 'window.__minty.compareImage()')
  report.check(`${name}: after the Undo / Redo cycles the canvas shows the trimmed image`, !compared.skipped && compared.failures === 0, json({ wrong: compared.wrong, first: compared.first }))

  // Trim again at 5: nothing to trim; at 0: trims the 5 px band.
  const rev = await revision(browser)
  await clickTrim(browser)
  report.check(
    `${name}: a second Trim at 5 px changes nothing (no revision, entry or depth change) and says why`,
    (await revision(browser)) === rev && (await summary(browser)).undo === 2 && (await summary(browser)).depth === 2 && (await trimEval(browser, 'message()')) === 'Nothing to trim: no side has more than 5 px of transparent space.',
  )
  await clickPreset(browser, 0)
  await clickTrim(browser)
  await expectTrim(browser, `${name}, trimmed again at 0 px`, 'trimmed', 0, { entries: 3, depth: 3, from: [kept.width, kept.height] })
  await browser.press('z', { ctrl: true })
  await settle(browser)
  await clickPreset(browser, 5)
  for (const n of ['original', 'deleted', 'trimmed']) await trimEval(browser, `forget(${json(n)})`)
  await edit(browser, 'forget("original")')
}

const revision = async (browser) => (await summary(browser)).revision

async function images(browser, fixtures, name) {
  // A transparent PNG with a soft shadow: trimmed as it is, its faintest pixels kept.
  await openWithAnswer(browser, path.join(fixtures, 'trim-valve.png'))
  report.check(`${name}: opening another image makes the Magic Wand active and resets the padding to 5`, (await trimEval(browser, 'tool()')) === 'magic-wand' && (await trimEval(browser, 'padding()')) === 5)
  await chooseTool(browser, 'Auto Trim')
  await trimEval(browser, 'save("valve")')
  const opened = await trimEval(browser, 'alphaStats()')
  for (const padding of [0, 50]) {
    if (padding === 0) await clickPreset(browser, 0)
    else await typePadding(browser, '50')
    await clickTrim(browser)
    const kept = await expectTrim(browser, `${name}, transparent valve PNG, padding ${padding}`, 'valve', padding, { entries: 1, depth: 1, from: [360, 240] })
    if (padding === 0) {
      const stats = await trimEval(browser, 'alphaStats()')
      report.check(`${name}: the shadow's and the line's partly transparent pixels are all kept, the faintest included`, stats.partial === opened.partial && stats.faintest === opened.faintest && stats.faintest <= 3, json({ opened, stats }))
    } else {
      report.check(`${name}: with 50 px the padding is clipped at the image's edges`, kept.x === 0 || kept.y === 0 || kept.x + kept.width === 360 || kept.y + kept.height === 240, json(kept))
    }
    await browser.press('z', { ctrl: true })
    await settle(browser)
    report.check(`${name}: Undo restores the valve exactly`, await trimEval(browser, 'same("valve")'))
  }
  await trimEval(browser, 'forget("valve")')

  // Nothing visible; content in every edge.
  for (const [file, padding, message] of [
    ['trim-empty.png', 5, 'Nothing to trim: the image has no visible pixels.'],
    ['trim-edges.png', 0, 'Nothing to trim: visible pixels already reach every edge of the image.'],
  ]) {
    await openWithAnswer(browser, path.join(fixtures, file))
    await chooseTool(browser, 'Auto Trim')
    if (padding !== 5) await clickPreset(browser, padding)
    const s = await summary(browser)
    await clickTrim(browser)
    const now = await summary(browser)
    report.check(
      `${name}: ${file}: nothing changes (no revision, entry, depth or edit) and the message says why`,
      now.revision === s.revision && now.undo === 0 && now.depth === 0 && (await trimEval(browser, 'message()')) === message,
      json({ message: await trimEval(browser, 'message()'), now }),
    )
    // The hidden announcement does not repeat what the message says.
    report.check(`${name}: ${file}: announced once, by the message's own status region`, (await announcement(browser)) === '')
  }
}

async function availability(browser, fixtures, name) {
  // While another image opens: Trim unavailable, padding reset afterwards.
  await openWithAnswer(browser, path.join(fixtures, 'trim-valve.png'))
  await chooseTool(browser, 'Auto Trim')
  await clickPreset(browser, 20)
  await edit(browser, 'holdImports()')
  const before = await summary(browser)
  await browser.setFile('input[type=file]', path.join(fixtures, 'trim-pump.png'))
  await waitFor(() => browser.eval('window.__minty.state().pendingImportId !== null'), { what: 'the import to start' })
  await settle(browser)
  const o = await options(browser)
  await browser.click(o.trim.x, o.trim.y)
  await settle(browser)
  report.check(
    `${name}: while another image opens, Trim is aria-disabled with its reason, and clicking it does nothing`,
    o.trim.disabled === 'true' && o.trim.title.endsWith('— not available while another image is opening') && (await revision(browser)) === before.revision && (await summary(browser)).undo === 0,
    json(o.trim),
  )
  await edit(browser, 'releaseImports()')
  await waitFor(() => browser.eval('window.__minty.state().pendingImportId === null && window.__minty.state().document.width === 640'), { what: 'the import to finish' })
  await settle(browser)
  report.check(`${name}: the new image resets the padding to 5 and makes the Magic Wand active`, (await trimEval(browser, 'padding()')) === 5 && (await trimEval(browser, 'tool()')) === 'magic-wand')

  // Behind the replace confirmation nothing can trim.
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await browser.press('Delete')
  await settle(browser)
  await chooseTool(browser, 'Auto Trim')
  const trimButton = (await options(browser)).trim
  const asked = await summary(browser)
  await browser.setFile('input[type=file]', path.join(fixtures, 'trim-valve.png'))
  await waitFor(() => browser.eval('!!document.querySelector("dialog[open]")'), { what: 'the replace confirmation' })
  await browser.click(trimButton.x, trimButton.y)
  await settle(browser)
  report.check(`${name}: with the replace confirmation open, a click where Trim is does nothing`, (await revision(browser)) === asked.revision && (await summary(browser)).undo === 1)
  const cancel = await edit(browser, 'button("Cancel")')
  await browser.click(cancel.x, cancel.y)
  await waitFor(() => browser.eval('!document.querySelector("dialog[open]")'), { what: 'the dialog to close' })
  await settle(browser)
  await clickTrim(browser)
  report.check(`${name}: after Cancel, Trim works`, (await summary(browser)).undo === 2 && (await summary(browser)).size[0] < 640)
}

/**
 * Enter or Space as a user presses it on a focused button. Chrome activates a button only for key
 * events that carry the key's text, which the driver's press() leaves out (it suits text fields).
 */
async function activate(browser, key) {
  if (!browser.cdp) return browser.press(key)
  const text = key === 'Enter' ? '\r' : ' '
  const event = { key: key === 'Enter' ? 'Enter' : ' ', code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 32, nativeVirtualKeyCode: key === 'Enter' ? 13 : 32 }
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text, unmodifiedText: text, ...event })
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event })
}

async function keyboard(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'trim-pump.png'))
  // Headless Firefox has no window focus: it moves focus with Tab and handles keys in the field,
  // but Enter and Space on a focused button do nothing there. Button activation is checked in Chrome.
  const buttonKeys = !!browser.cdp
  await trimEval(browser, 'focusTool("Auto Trim")')
  if (buttonKeys) {
    await activate(browser, 'Enter')
    await settle(browser)
    report.check(`${name}: keyboard: Enter on the focused Auto Trim tool chooses it`, (await trimEval(browser, 'tool()')) === 'auto-trim')
  } else {
    await chooseTool(browser, 'Auto Trim')
    await trimEval(browser, 'focusTool("Auto Trim")')
    report.note(`  ${name}: Enter and Space on buttons not checked (headless Firefox has no window focus)`)
  }
  const order = []
  for (let i = 0; i < 6; i++) {
    await browser.press('Tab')
    const a = await trimEval(browser, 'active()')
    order.push(a.name ?? a.text)
  }
  report.check(`${name}: keyboard: Tab from the Auto Trim tool goes through the presets, the field, then Trim`, json(order) === json(['0 px', '5 px', '10 px', '20 px', 'Padding in pixels, 0 to 50', 'Trim']), json(order))
  for (let i = 0; i < 3; i++) await browser.press('Tab', { shift: true })
  report.check(`${name}: keyboard: Shift + Tab goes back`, (await trimEval(browser, 'active()')).name === '10 px')
  if (buttonKeys) {
    await activate(browser, 'Space')
    await settle(browser)
    report.check(`${name}: keyboard: Space on a preset sets it`, (await trimEval(browser, 'padding()')) === 10)
  } else {
    await clickPreset(browser, 10)
    await trimEval(browser, 'focusTool("Auto Trim")')
    for (let i = 0; i < 3; i++) await browser.press('Tab')
  }
  await browser.press('Tab')
  await browser.press('Tab')
  await browser.press('ArrowUp')
  await browser.press('Tab')
  await settle(browser)
  report.check(`${name}: keyboard: Up in the field steps the padding, Tab reaches Trim`, (await trimEval(browser, 'padding()')) === 11 && (await trimEval(browser, 'active()')).text === 'Trim')
  if (!buttonKeys) return
  const rev = await revision(browser)
  await activate(browser, 'Enter')
  await settle(browser)
  const first = await trimEval(browser, 'message()')
  const feedback = await ev(browser, 'window.__minty.state().editFeedbackId')
  await activate(browser, 'Space')
  await settle(browser)
  report.check(
    `${name}: keyboard: Enter, then Space, on Trim run it (here nothing to trim, said each time), focus stays on Trim`,
    (await ev(browser, 'window.__minty.state().editFeedbackId')) === feedback + 1 &&
      first === 'Nothing to trim: no side has more than 11 px of transparent space.' && (await trimEval(browser, 'message()')) === first && (await revision(browser)) === rev && (await trimEval(browser, 'active()')).text === 'Trim',
  )
}

async function eviction(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'trim-pump.png'))
  // 24 single opaque pixels of the pump body, then the background: 25 Delete steps, the limit.
  for (let i = 0; i < 24; i++) {
    await trimEval(browser, `selectPixel(${290 + i}, 250)`)
    await settle(browser)
    await browser.press('Delete')
  }
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await browser.press('Delete')
  await settle(browser)
  const full = await summary(browser)
  report.check(`${name}: 25 Deletes fill the history (25 steps)`, full.undo === 25 && full.depth === 25, json(full))
  await chooseTool(browser, 'Auto Trim')
  await clickTrim(browser)
  const s = await summary(browser)
  const message = await trimEval(browser, 'message()')
  report.check(
    `${name}: the trim that makes a 26th step drops the oldest one and says so, visibly`,
    s.undo === 25 && s.depth === 26 && /^Auto Trim applied: 640 × 480 px trimmed to \d+ × \d+ px\. Undo history is full, so the oldest Undo step is no longer available\.$/.test(message ?? ''),
    json({ s, message }),
  )
  report.check(`${name}: and does not announce it a second time`, (await announcement(browser)) === '')
  // Undo of every step left stops one step short of the opened image.
  for (let i = 0; i < 25; i++) await browser.press('z', { ctrl: true })
  await settle(browser)
  const back = await summary(browser)
  report.check(`${name}: 25 Undos later nothing is left to undo, and the image is still edited (depth 1)`, back.undo === 0 && back.depth === 1, json(back))
}

async function narrow(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'trim-pump.png'))
  await chooseTool(browser, 'Auto Trim')
  for (const width of [800, 640, 480]) {
    await browser.resize(width, 800)
    await sleep(150)
    await settle(browser)
    const layout = await trimEval(browser, 'layout()')
    const row = layout.rowScroll <= layout.rowWidth && layout.trim.right <= layout.viewport && layout.trim.left >= 0
    const page = layout.docWidth <= layout.viewport && layout.toolbarScroll <= layout.toolbarWidth
    // The app is at least 640 px wide (min-width since Phase 1): narrower windows scroll sideways
    // for every tool, so they are reported only.
    if (width >= 640) report.check(`${name}: ${width} px wide: the Auto Trim row wraps within the window, Trim on screen; no sideways scrolling`, row && page, json(layout))
    else report.note(`  ${name}: ${width} px wide: Auto Trim row fits ${row}; page and toolbar without sideways scrolling ${page} ${json({ docWidth: layout.docWidth, toolbarScroll: layout.toolbarScroll, toolbarWidth: layout.toolbarWidth, rowHeight: layout.rowHeight })}`)
  }
  await browser.resize(1400, 900)
  await sleep(150)
  await settle(browser)
}

async function gpuCrash(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'trim-pump.png'))
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await browser.press('Delete')
  await settle(browser)
  await chooseTool(browser, 'Auto Trim')
  await clickTrim(browser)
  const before = await ev(browser, 'window.__minty.compareImage()')
  const gpu = gpuProcesses(browser.pid)
  if (gpu.length !== 1) throw new Error(`Expected one GPU process under Chrome ${browser.pid}, found ${gpu.length}`)
  const events = (await ev(browser, 'window.__minty.contextEvents')).length
  process.kill(gpu[0], 'SIGKILL')
  await waitFor(async () => (await ev(browser, 'window.__minty.contextEvents')).slice(events).includes('image restored'), { timeout: 15000, what: 'the image canvas to be restored' })
  await settle(browser)
  const after = await ev(browser, 'window.__minty.compareImage()')
  report.check(`${name}: after a trim and a GPU process crash, the canvas is restored showing the trimmed image exactly`, before.failures === 0 && !after.skipped && after.failures === 0, json({ before: before.wrong, after: after.wrong ?? after.skipped }))
  await browser.press('z', { ctrl: true })
  await settle(browser)
  const undone = await ev(browser, 'window.__minty.compareImage()')
  report.check(`${name}: Undo after the restoration shows the image before the trim`, !undone.skipped && undone.failures === 0)
}

const heap = async (browser) => {
  if (!browser.cdp) return null
  await browser.cdp('HeapProfiler.enable')
  await browser.cdp('HeapProfiler.collectGarbage')
  const usage = await browser.cdp('Runtime.getHeapUsage')
  return { heapMB: +(usage.usedSize / 2 ** 20).toFixed(1), arrayBuffersMB: usage.backingStorageSize === undefined ? null : +(usage.backingStorageSize / 2 ** 20).toFixed(1) }
}
const fmt = (t) => `${t.total.toFixed(0)} ms (display image ${(t.put + t.transfer).toFixed(0)})`

/** Delete (when `seed`), Trim, Undo and Redo timed; exactness checked in the page. */
async function perf(browser, fixtures, { file, seed, tolerance, label }) {
  await openWithAnswer(browser, path.join(fixtures, file), 'continue', { timeout: 120000 })
  let deleted = ''
  if (seed) {
    await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
    await edit(browser, `commitTolerance(${tolerance})`)
    await dispatch(browser, { type: 'zoom-fitted' })
    await settle(browser)
    await clickPixel(browser, seed[0], seed[1])
    const selected = (await summary(browser)).selected
    const del = await edit(browser, 'timeKey("Delete")')
    deleted = `${selected.toLocaleString('en-CA')} selected, Delete ${fmt(del)}; `
  }
  await chooseTool(browser, 'Auto Trim')
  const size = await trimEval(browser, 'save("before")')
  const kept = await trimEval(browser, 'expectedKept("before", 5)')
  const t = await edit(browser, 'timeInput(() => window.__mintyTrim.clickTrim())')
  await settle(browser)
  if (kept && (kept.width !== size[0] || kept.height !== size[1])) {
    const crop = await trimEval(browser, `isCropOf("before", ${json(kept)})`)
    report.check(`${label}: trimmed exactly (${size.join(' × ')} → ${kept.width} × ${kept.height})`, t.changed && crop.ok, json(crop))
  } else {
    report.check(`${label}: nothing to trim, nothing changed`, !t.changed, json(await trimEval(browser, 'message()')))
  }
  const s = await summary(browser)
  const message = await trimEval(browser, 'message()')
  if (!t.changed) {
    report.note(`  ${label}: ${deleted}Trim (nothing to trim) ${fmt(t)}; "${message}"`)
    await trimEval(browser, 'forget("before")')
    return
  }
  report.note(`  ${label}: ${deleted}Trim ${fmt(t)}; history ${(s.bytes / 2 ** 20).toFixed(1)} MB in ${s.undo} entries${message ? `; message "${message}"` : ''}`)
  const undo = await edit(browser, 'timeKey("z", { ctrl: true })')
  const undoneExact = await trimEval(browser, 'same("before")')
  // The page's own copy of the image goes before memory is measured.
  await trimEval(browser, 'forget("before")')
  const redo = await edit(browser, 'timeKey("y", { ctrl: true })')
  const after = { ...(await heap(browser)), ...(await edit(browser, 'liveImages()')) }
  report.check(`${label}: Undo restores every byte; Redo trims again`, undoneExact && redo.changed && (await summary(browser)).size[0] === kept.width)
  report.note(`  ${label}: Undo ${fmt(undo)}; Redo ${fmt(redo)}; memory after Redo (trimmed image, history) ${json(after)}`)
  report.check(`${label}: one live display image at the end`, after.live === 1 && after.currentLive, json(after))
}

async function run(name, url, fixtures) {
  const browser = await launch(name, { dpr: 1, width: 1400, height: 900 })
  report.note(`\n=== ${browser.name} — ${url}`)
  try {
    await load(browser, url)
    if (!(await ev(browser, TRIM_HELPERS))) throw new Error('Could not install the Auto Trim helpers')
    // Keyboard first: in headless Firefox, after the other sections, Tab alternated between the first
    // two buttons of the options row (the Magic Wand's as well), which a fresh session does not do.
    await keyboard(browser, fixtures, browser.name)
    await interaction(browser, fixtures, browser.name)
    await images(browser, fixtures, browser.name)
    await availability(browser, fixtures, browser.name)
    await eviction(browser, fixtures, browser.name)
    await narrow(browser, fixtures, browser.name)
    if (values['kill-test-gpu-process'] && browser.name.startsWith('Chrome')) await gpuCrash(browser, fixtures, browser.name)
    const live = await edit(browser, 'liveImages()')
    report.check(`${browser.name}: one live display image after all of it`, live.live === 1 && live.currentLive, json(live))
    if (!values['no-perf']) {
      await perf(browser, fixtures, { file: 'trim-4k.png', seed: [2, 2], tolerance: 10, label: `${browser.name} perf 3840 × 2160, flat background` })
      await perf(browser, fixtures, { file: 'trim-photo-4k.png', seed: [2, 2], tolerance: 20, label: `${browser.name} perf 3840 × 2160, photographic background` })
      if (!values['no-stress']) {
        await perf(browser, fixtures, { file: 'big50mp.png', seed: [10, 10], tolerance: 20, label: `${browser.name} perf 8660 × 5773, flat background` })
        await perf(browser, fixtures, { file: 'trim-photo-50mp.png', seed: [2, 2], tolerance: 20, label: `${browser.name} perf 8660 × 5773, photographic background` })
        await perf(browser, fixtures, { file: 'trim-empty-50mp.png', label: `${browser.name} perf 8660 × 5773, fully transparent (longest scan)` })
        await perf(browser, fixtures, { file: 'big50mp.png', label: `${browser.name} perf 8660 × 5773, opaque (shortest scan)` })
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
const fixtures = await ensureTrimFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) await run(name, server.url, fixtures)
} finally {
  await server.close()
}
report.finish()
