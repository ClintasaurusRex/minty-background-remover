// Delete Selection, Undo and Redo in the production build, in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/edit-workflow.mjs [--browser chrome|firefox|all] [--dpr 1] [--no-perf] [--no-stress]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real key presses and pointer clicks, for PNG, JPEG, WebP and SVG images (opaque,
// transparent, partially transparent, 1-pixel details, disconnected selections, 4K):
//
// - Delete makes exactly the selected pixels transparent (alpha 0, colour kept hidden), keeps
//   every other byte, the size, the view and a fresh revision; the selection and the Magic Wand
//   click are cleared; one history entry; the canvas shows the result exactly; the replaced
//   display image is released and no other one is left live.
// - Undo restores every byte, the selection and the click (re-applying a committed tolerance
//   gives what it gave before the Delete); Redo restores the result; repeated cycles stay exact
//   with fresh revisions.
// - Several Deletes, Add / Subtract context, no-op Delete, held Delete, text-field protection,
//   the Delete Selection and Undo / Redo buttons, failures, and the replace confirmation for the
//   file picker, paste and drop.
//
// Then (unless --no-perf) it times Delete, Undo and Redo at 4K and, unless --no-stress, near
// 50 megapixels: the whole synchronous handler, display-image creation (putImageData and
// transferToImageBitmap) and drawing, and the time to the next frame; and history memory and live
// images over repeated cycles (in Chrome also the JavaScript heap and ArrayBuffer memory after
// garbage collection). Timings are reported, never checked.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, openApp, serveBuild, settle } from './lib/app.mjs'
import { EDIT_HELPERS, fileBase64, openWithAnswer } from './lib/edit.mjs'
import { ensureEditFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    dpr: { type: 'string', default: '1' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const ratios = values.dpr.split(',').map(Number)
const report = createReport()

const ev = (browser, expression) => browser.eval(expression)
const edit = (browser, call) => browser.eval(`window.__mintyEdit.${call}`)
const summary = (browser) => edit(browser, 'summary()')
const json = (value) => JSON.stringify(value)

async function load(browser, url) {
  await openApp(browser, url)
  if (!(await ev(browser, EDIT_HELPERS))) throw new Error('Could not install the editing helpers')
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

async function clickButton(browser, name) {
  const button = await edit(browser, `button(${json(name)})`)
  if (!button) throw new Error(`No button named ${name}`)
  await browser.click(button.x, button.y)
  await settle(browser)
  return button
}

/** Places the image at 100% (whole device pixels at DPR 1 and 2), slightly panned. */
async function placeForChecks(browser) {
  await dispatch(browser, { type: 'zoom-actual-size' })
  await dispatch(browser, { type: 'wheel-panned', delta: { x: -37, y: 23 } })
  await settle(browser)
}

const sameView = (a, b) => a.zoom === b.zoom && a.x === b.x && a.y === b.y

async function checkCanvas(browser, label) {
  const result = await ev(browser, 'window.__minty.compareImage()')
  if (result.skipped) return report.check(`${label}: canvas`, false, result.skipped)
  report.check(`${label}: canvas shows the document exactly`, result.failures === 0, `${json(result.n)}${result.failures ? ` wrong ${json(result.wrong)} first ${json(result.first)}` : ''}`)
}

async function checkImages(browser, label) {
  const images = await edit(browser, 'liveImages()')
  report.check(`${label}: one live display image, the current one`, images.live === 1 && images.currentLive, json(images))
}

/**
 * The whole cycle for one image and one Magic Wand click: Delete (key), Undo (key), Redo (key),
 * then Undo (button) / Redo (Ctrl+Shift+Z) twice more, with every check.
 */
async function cycle(browser, fixtures, { file, seed, flood = 'contiguous', label = file }) {
  await openWithAnswer(browser, path.join(fixtures, file), 'continue')
  await placeForChecks(browser)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: flood })
  await edit(browser, 'commitTolerance(20)')
  await clickPixel(browser, seed[0], seed[1])
  const selected = await edit(browser, 'save("before")')
  report.check(`${label}: Magic Wand selects`, selected.selected > 0, json(selected))
  // What re-applying tolerance 35 gives on the original pixels, to compare after Undo.
  await edit(browser, 'commitTolerance(35)')
  const wider = await edit(browser, 'selectionHash()')
  await edit(browser, 'commitTolerance(20)')
  report.check(`${label}: tolerance 20 re-applied before Delete gives the click's selection`, await edit(browser, 'sameSelection("before")'))
  const start = await summary(browser)

  await browser.press('Delete')
  await settle(browser)
  const deleted = await summary(browser)
  const check = await edit(browser, 'deleteCheck("before")')
  report.check(
    `${label}: Delete makes exactly the selected pixels transparent, colour kept, every other byte unchanged`,
    check.wrong === 0 && check.deleted > 0,
    json(check),
  )
  report.check(
    `${label}: Delete keeps the size and view, makes a fresh revision, clears the selection and click, records one entry`,
    deleted.revision > start.revision &&
      deleted.id === start.id &&
      json(deleted.size) === json(start.size) &&
      sameView(deleted.viewport, start.viewport) &&
      deleted.selected === 0 &&
      deleted.operation === null &&
      deleted.undo === start.undo + 1 &&
      deleted.redo === 0 &&
      deleted.depth === start.depth + 1,
    json(deleted),
  )
  await edit(browser, 'save("after")')
  await checkCanvas(browser, `${label} after Delete`)
  await checkImages(browser, `${label} after Delete`)
  const overlay = await ev(browser, 'window.__minty.checkOverlay()')
  report.check(`${label}: no selection overlay after Delete`, overlay.selection === false && overlay.backingStore[0] === 0, json(overlay))
  const announced = await edit(browser, 'announcement()')
  report.check(`${label}: Delete announced with the pixel count`, /^Selection deleted: [\d,]+ pixels? (is|are) now transparent\.$/.test(announced ?? ''), announced)

  await browser.press('z', { ctrl: true })
  await settle(browser)
  const undone = await summary(browser)
  report.check(
    `${label}: Ctrl+Z restores every byte (hidden colour included), with a fresh revision and the same view`,
    (await edit(browser, 'samePixels("before")')) && undone.revision > deleted.revision && sameView(undone.viewport, start.viewport) && undone.undo === start.undo && undone.redo === 1,
    json(undone),
  )
  report.check(`${label}: Undo restores the selection`, await edit(browser, 'sameSelection("before")'))
  report.check(
    `${label}: Undo restores the Magic Wand click, bound to the new revision`,
    undone.operation?.bound === true && undone.operation.tolerance === 20 && undone.operation.mode === 'new',
    json(undone.operation),
  )
  await checkCanvas(browser, `${label} after Undo`)
  const overlayBack = await ev(browser, 'window.__minty.checkOverlay()')
  report.check(`${label}: selection overlay back after Undo`, overlayBack.selection && overlayBack.wrongTint === 0 && overlayBack.wrongClear === 0 && overlayBack.tint + overlayBack.edge > 0, json(overlayBack))
  await edit(browser, 'commitTolerance(35)')
  const reapplied = await edit(browser, 'selectionHash()')
  await edit(browser, 'commitTolerance(20)')
  report.check(
    `${label}: after Undo, committed tolerances re-apply the click exactly as before the Delete`,
    reapplied === wider && (await edit(browser, 'sameSelection("before")')),
    `${reapplied} vs ${wider}`,
  )

  await browser.press('y', { ctrl: true })
  await settle(browser)
  const redone = await summary(browser)
  report.check(
    `${label}: Ctrl+Y restores the Delete exactly, fresh revision, no selection`,
    (await edit(browser, 'samePixels("after")')) && redone.revision > undone.revision && redone.selected === 0 && redone.undo === start.undo + 1 && redone.redo === 0,
    json(redone),
  )
  await checkCanvas(browser, `${label} after Redo`)

  // More cycles: the Undo button and Ctrl+Shift+Z.
  let revision = redone.revision
  let exact = true
  let fresh = true
  for (let i = 0; i < 2; i++) {
    await clickButton(browser, 'Undo Delete Selection')
    exact &&= await edit(browser, 'samePixels("before")')
    exact &&= await edit(browser, 'sameSelection("before")')
    let now = await summary(browser)
    fresh &&= now.revision > revision
    revision = now.revision
    await browser.press('z', { ctrl: true, shift: true })
    await settle(browser)
    exact &&= await edit(browser, 'samePixels("after")')
    now = await summary(browser)
    fresh &&= now.revision > revision && now.selected === 0
    revision = now.revision
  }
  report.check(`${label}: two more Undo (button) / Redo (Ctrl+Shift+Z) cycles stay exact with fresh revisions`, exact && fresh)
  await checkImages(browser, `${label} after the cycles`)
  // Leave it as opened, so the next image opens without the confirmation.
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(`${label}: back to the opened pixels, no unexported edits`, (await edit(browser, 'samePixels("before")')) && (await summary(browser)).depth === 0)
  await edit(browser, 'forget("before")')
  await edit(browser, 'forget("after")')
}

async function multipleDeletes(browser, fixtures) {
  await openWithAnswer(browser, path.join(fixtures, 'details.png'))
  await placeForChecks(browser)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  await edit(browser, 'save("original")')
  const steps = [[45, 185], [145, 205], [5, 5]]
  for (const [i, [x, y]] of steps.entries()) {
    await clickPixel(browser, x, y)
    await edit(browser, `save("step${i}")`)
    await browser.press('Delete')
    await settle(browser)
    const check = await edit(browser, `deleteCheck("step${i}")`)
    report.check(`several Deletes: Delete ${i + 1} exact`, check.wrong === 0 && check.deleted > 0, json(check))
  }
  await edit(browser, 'save("all")')
  const all = await summary(browser)
  report.check('several Deletes: three entries', all.undo === 3 && all.depth === 3, json(all))
  for (let i = steps.length - 1; i >= 0; i--) {
    await browser.press('z', { ctrl: true })
    await settle(browser)
    report.check(`several Deletes: Undo back to before Delete ${i + 1}, selection included`, (await edit(browser, `samePixels("step${i}")`)) && (await edit(browser, `sameSelection("step${i}")`)))
  }
  report.check('several Deletes: all undone gives the opened pixels', await edit(browser, 'samePixels("original")'))
  for (let i = 0; i < steps.length; i++) await browser.press('y', { ctrl: true })
  await settle(browser)
  report.check('several Deletes: Redo three times gives the final result', await edit(browser, 'samePixels("all")'))
  await checkCanvas(browser, 'several Deletes after Redo')
  await checkImages(browser, 'several Deletes after Redo')
  // A new edit after Undo clears Redo.
  await browser.press('z', { ctrl: true })
  await clickPixel(browser, 255, 175)
  await browser.press('Delete')
  await settle(browser)
  const cleared = await summary(browser)
  report.check('a new Delete after Undo clears Redo', cleared.redo === 0 && cleared.undo === 3, json(cleared))
  for (let i = 0; i < 3; i++) await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check('several Deletes: undone again to the opened pixels', (await edit(browser, 'samePixels("original")')) && (await summary(browser)).depth === 0)
}

async function addSubtractContext(browser, fixtures) {
  await openWithAnswer(browser, path.join(fixtures, 'details.png'))
  await placeForChecks(browser)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  // Add: one red square, then Add (chosen in the options) on another. Subtract: all three red squares
  // (Global), then Subtract one of them (Contiguous).
  for (const [mode, first, firstFlood, second] of [
    ['add', [45, 185], 'contiguous', [145, 205]],
    ['subtract', [45, 185], 'global', [255, 175]],
  ]) {
    await dispatch(browser, { type: 'magic-wand-selection-mode-changed', selectionMode: 'new' })
    await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: firstFlood })
    await clickPixel(browser, first[0], first[1])
    await dispatch(browser, { type: 'magic-wand-selection-mode-changed', selectionMode: mode })
    await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
    await clickPixel(browser, second[0], second[1])
    await edit(browser, 'save("combined")')
    const made = await summary(browser)
    await edit(browser, 'commitTolerance(45)')
    const wider = await edit(browser, 'selectionHash()')
    await edit(browser, 'commitTolerance(20)')
    report.check(`${mode}: the combined selection`, made.operation?.mode === mode && made.selected > 0, json(made))
    await browser.press('Delete')
    await browser.press('z', { ctrl: true })
    await settle(browser)
    const undone = await summary(browser)
    report.check(
      `${mode}: Undo restores the combined selection, the ${mode} click and its previous selection`,
      (await edit(browser, 'sameSelection("combined")')) && (await edit(browser, 'sameBase("combined")')) && undone.operation?.mode === mode && undone.operation.bound,
      json(undone.operation),
    )
    await edit(browser, 'commitTolerance(45)')
    report.check(`${mode}: after Undo the ${mode} click re-applies as before the Delete`, (await edit(browser, 'selectionHash()')) === wider)
    await edit(browser, 'commitTolerance(20)')
    await dispatch(browser, { type: 'selection-cleared' })
  }
  await dispatch(browser, { type: 'magic-wand-selection-mode-changed', selectionMode: 'new' })
}

async function keyboardAndControls(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'details.png'))
  await placeForChecks(browser)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })

  // Buttons before anything is selected or edited.
  let buttons = await edit(browser, 'historyButtons()')
  report.check('Undo and Redo unavailable with nothing to undo', buttons.undo.disabled === 'true' && buttons.redo.disabled === 'true' && buttons.undo.name === 'Undo', json(buttons))
  let del = await edit(browser, 'button("Delete Selection")')
  report.check('Delete Selection unavailable without a selection', del.disabled === 'true', json(del))
  await clickButton(browser, 'Delete Selection')
  report.check('Delete Selection does nothing without a selection', (await summary(browser)).undo === 0)

  // The button deletes, and keeps focus (aria-disabled once nothing is selected).
  await clickPixel(browser, 5, 5)
  del = await edit(browser, 'button("Delete Selection")')
  report.check('Delete Selection available with a selection', del.disabled === 'false', json(del))
  await edit(browser, 'save("buttons")')
  await clickButton(browser, 'Delete Selection')
  const check = await edit(browser, 'deleteCheck("buttons")')
  report.check('Delete Selection button deletes exactly', check.wrong === 0 && check.deleted > 0, json(check))
  del = await edit(browser, 'button("Delete Selection")')
  report.check('Delete Selection unavailable again after deleting', del.disabled === 'true')
  if (name === 'chrome') {
    // Headless Firefox has no window focus, so focus is only checked in Chrome.
    const active = await edit(browser, 'activeElement()')
    report.check('focus stays on Delete Selection after deleting', active.text.trim() === 'Delete Selection', json(active))
  }
  // Clicking again (a double click) deletes nothing more.
  await clickButton(browser, 'Delete Selection')
  report.check('a second click deletes nothing more', (await summary(browser)).undo === 1)
  buttons = await edit(browser, 'historyButtons()')
  report.check(
    'Undo names the edit; Redo unavailable',
    buttons.undo.name === 'Undo Delete Selection' && buttons.undo.disabled === 'false' && buttons.undo.title === 'Undo Delete Selection (Ctrl+Z)' && buttons.redo.disabled === 'true',
    json(buttons),
  )
  await clickButton(browser, 'Undo Delete Selection')
  buttons = await edit(browser, 'historyButtons()')
  report.check('after Undo: Undo unavailable, Redo names the edit', buttons.undo.disabled === 'true' && buttons.redo.name === 'Redo Delete Selection' && buttons.redo.disabled === 'false', json(buttons))
  report.check('Undo announced', (await edit(browser, 'announcement()')) === 'Undone: Delete Selection.')
  await clickButton(browser, 'Redo Delete Selection')
  report.check('Redo button redoes', (await edit(browser, 'samePixels("buttons")')) === false && (await summary(browser)).undo === 1)
  report.check('Redo announced', (await edit(browser, 'announcement()')) === 'Redone: Delete Selection.')
  await browser.press('z', { ctrl: true })
  await settle(browser)

  // Held Delete: an auto-repeated press never deletes.
  await clickPixel(browser, 45, 185)
  const before = await summary(browser)
  if (name === 'chrome') {
    await browser.press('Delete', { repeat: true })
    await settle(browser)
    const held = await summary(browser)
    report.check('a repeated (held) Delete deletes nothing', held.revision === before.revision && held.selected === before.selected, json(await edit(browser, 'lastKey()')))
  } else {
    // WebDriver: press and hold Delete (deletes once), select again, then the held key repeats.
    await browser.press('Delete', { repeat: true })
    await settle(browser)
    const once = await summary(browser)
    await clickPixel(browser, 145, 205)
    await browser.press('Delete', { repeat: true })
    await settle(browser)
    await browser.release()
    const held = await summary(browser)
    report.check(
      'holding Delete deletes once; the repeat deletes nothing',
      once.undo === before.undo + 1 && held.undo === once.undo && held.selected > 0,
      `${json(await edit(browser, 'lastKey()'))} ${json(held)}`,
    )
    await browser.press('z', { ctrl: true })
  }
  await dispatch(browser, { type: 'selection-cleared' })
  await settle(browser)

  // Text fields keep Delete and Ctrl+Z.
  await clickPixel(browser, 5, 5)
  const start = await summary(browser)
  await ev(browser, `(() => { const field = document.querySelector('input.tool-options__number'); field.focus(); field.setSelectionRange(0, 0); return true })()`)
  const focused = await ev(browser, 'document.activeElement?.className')
  if (focused !== 'tool-options__number') {
    report.note(`  (not checked in ${name}: the tolerance field could not be focused headless)`)
  } else {
    await browser.press('Delete')
    await settle(browser)
    const typed = await ev(browser, 'document.querySelector("input.tool-options__number").value')
    const afterDelete = await summary(browser)
    report.check('Delete in the tolerance field edits the text, not the image', afterDelete.revision === start.revision && afterDelete.selected === start.selected && typed === '0', `field "${typed}" ${json(afterDelete)}`)
    await browser.press('z', { ctrl: true })
    await settle(browser)
    const key = await edit(browser, 'lastKey()')
    report.check('Ctrl+Z in the tolerance field is left to the field', (await summary(browser)).revision === start.revision && !key.prevented, json(key))
    await browser.press('Escape')
    await ev(browser, '(document.activeElement.blur(), true)')
    await settle(browser)
  }

  // A no-op Delete: only fully transparent pixels selected (the hidden-colour block).
  await dispatch(browser, { type: 'selection-cleared' })
  await clickPixel(browser, 340, 190)
  const noop = await summary(browser)
  await browser.press('Delete')
  await settle(browser)
  const after = await summary(browser)
  report.check(
    'Delete of only transparent pixels changes nothing, keeps the selection, records nothing',
    after.revision === noop.revision && after.selected === noop.selected && noop.selected > 0 && after.undo === noop.undo,
    json(after),
  )
  report.check('the no-op is announced as nothing deleted', (await edit(browser, 'announcement()')) === 'Nothing was deleted: the selected pixels are already transparent.')

  // A failure: display-image creation throws once.
  await clickPixel(browser, 5, 5)
  const failing = await summary(browser)
  await edit(browser, 'failNextTransfers(1)')
  await browser.press('Delete')
  await settle(browser)
  const failed = await summary(browser)
  const alert = await edit(browser, 'alert()')
  report.check(
    'a failed Delete changes nothing and shows an error',
    failed.revision === failing.revision && failed.selected === failing.selected && failed.undo === failing.undo && failed.editError === 'delete-selection' && /^The selected pixels could not be deleted\. The image and selection have not changed\./.test(alert ?? ''),
    `${alert} ${json(failed)}`,
  )
  await checkImages(browser, 'after a failed Delete')
  await browser.press('Delete')
  await settle(browser)
  const retried = await summary(browser)
  report.check('Delete again succeeds and clears the error', retried.undo === failing.undo + 1 && retried.editError === null && (await edit(browser, 'alert()')) === null, json(retried))
  await edit(browser, 'failNextTransfers(1)')
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check('a failed Undo changes nothing and says so', (await summary(browser)).revision === retried.revision && /^Undo could not be completed\./.test((await edit(browser, 'alert()')) ?? ''))
  await clickButton(browser, 'Dismiss message')
  report.check('the error can be dismissed', (await edit(browser, 'alert()')) === null)
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check('Undo works after the failure', (await summary(browser)).depth === 0)
}

async function replaceConfirmation(browser, fixtures, url) {
  await load(browser, url)
  const file = (name) => path.join(fixtures, name)
  report.check('first image: no confirmation', (await openWithAnswer(browser, file('details.png'))) === 'opened')
  report.check('unedited image: no confirmation', (await openWithAnswer(browser, file('graphic.png'))) === 'opened')
  await placeForChecks(browser)
  await clickPixel(browser, 300, 260)
  await browser.press('Delete')
  await settle(browser)
  await edit(browser, 'save("edited")')
  const edited = await summary(browser)

  // File picker: Cancel keeps everything.
  report.check('edited image, file picker: asks, Cancel', (await openWithAnswer(browser, file('logo.svg'), 'cancel')) === 'cancelled')
  const kept = await summary(browser)
  report.check(
    'Cancel keeps the document, its pixels, history and edits',
    kept.id === edited.id && kept.revision === edited.revision && kept.undo === edited.undo && kept.depth === 1 && (await edit(browser, 'samePixels("edited")')),
    json(kept),
  )
  await checkImages(browser, 'after Cancel')

  // The question while it is open: wording, focus, modality, keys and a second image ignored.
  const focusedBefore = await edit(browser, 'activeElement()')
  await browser.setFile('input[type=file]', file('logo.svg'))
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the confirmation' })
  const dialog = await edit(browser, 'dialog()')
  report.check(
    'the confirmation is modal, names the image, explains the loss, focuses Cancel',
    dialog.modal && /Discard unexported edits\?/.test(dialog.text) && /“logo\.svg”/.test(dialog.text) && /discard those edits and its Undo history/.test(dialog.text) && (browser.name.startsWith('Firefox') || dialog.focus === 'Cancel'),
    json(dialog),
  )
  await browser.press('Delete')
  await browser.press('z', { ctrl: true })
  await edit(browser, `paste(${json(fileBase64(file('graphic.webp')))}, 'x.webp', 'image/webp')`)
  await settle(browser)
  const during = await summary(browser)
  const dialogs = await edit(browser, 'dialog()')
  report.check(
    'while asking: Delete, Ctrl+Z and a pasted image do nothing; still one question',
    during.revision === edited.revision && during.undo === edited.undo && !during.importing && dialogs.count === 1 && /logo\.svg/.test(dialogs.text),
    json({ during, dialogs }),
  )
  if (browser.name.startsWith('Chrome')) {
    await browser.press('Escape')
    await settle(browser)
    report.check('Escape cancels', !(await edit(browser, 'dialog()')).open && (await summary(browser)).revision === edited.revision)
    const active = await edit(browser, 'activeElement()')
    report.check('focus returns to where it was after the dialog closes', json(active) === json(focusedBefore), `${json(active)} vs ${json(focusedBefore)}`)
  } else {
    await clickButton(browser, 'Cancel')
    report.note('  (Escape not checked in Firefox: headless Firefox has no window focus)')
  }

  // Paste: Cancel, then Continue.
  await edit(browser, `paste(${json(fileBase64(file('graphic.webp')))}, 'clip.webp', 'image/webp')`)
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the confirmation for a paste' })
  report.check('paste asks, naming the pasted image', /Opening the pasted image will replace it/.test((await edit(browser, 'dialog()')).text))
  await clickButton(browser, 'Cancel')
  report.check('paste, Cancel: unchanged', (await summary(browser)).revision === edited.revision)
  // Drop: Cancel.
  await edit(browser, `drop(${json(fileBase64(file('logo.svg')))}, 'dropped.svg', 'image/svg+xml')`)
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the confirmation for a drop' })
  report.check('drop asks, naming the file', /“dropped\.svg”/.test((await edit(browser, 'dialog()')).text))
  await clickButton(browser, 'Cancel')
  report.check('drop, Cancel: unchanged', (await summary(browser)).revision === edited.revision && (await edit(browser, 'samePixels("edited")')))

  // Continue with an image that fails to open: the edited image and its history stay.
  await browser.setFile('input[type=file]', file('broken.png'))
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the confirmation' })
  await clickButton(browser, 'Continue')
  await waitFor(async () => (await summary(browser)).importError !== null, { what: 'the import to fail' })
  const failed = await summary(browser)
  report.check(
    'a failed import after Continue keeps the edited image, its history and edits',
    failed.revision === edited.revision && failed.undo === edited.undo && failed.depth === 1 && failed.importError !== null && (await edit(browser, 'samePixels("edited")')),
    json(failed),
  )

  // Paste, Continue: the pasted image replaces the edited one.
  await ev(browser, '(window.__previousBitmap = window.__minty.state().documentBitmap, true)')
  await edit(browser, `paste(${json(fileBase64(file('graphic.webp')))}, 'clip.webp', 'image/webp')`)
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the confirmation for a paste' })
  await clickButton(browser, 'Continue')
  await waitFor(async () => (await summary(browser)).id !== edited.id && !(await summary(browser)).importing, { what: 'the pasted image to open' })
  await settle(browser)
  const replaced = await summary(browser)
  report.check(
    'paste, Continue: opens the pasted image, history cleared, no unexported edits',
    replaced.id !== edited.id && replaced.revision === 0 && replaced.undo === 0 && replaced.redo === 0 && replaced.depth === 0 && (await ev(browser, 'window.__minty.state().document.source')) === 'paste',
    json(replaced),
  )
  report.check('the edited display image was released', await ev(browser, 'window.__previousBitmap.width === 0'))
  await checkImages(browser, 'after replacing the edited image')

  // Undoing every edit leaves nothing unexported: no question.
  await openWithAnswer(browser, file('graphic.png'))
  await placeForChecks(browser)
  await clickPixel(browser, 300, 260)
  await browser.press('Delete')
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check('after undoing every edit: no confirmation', (await openWithAnswer(browser, file('logo.svg'), 'cancel')) === 'opened')
}

/** While another image is opening, Delete, Undo and Redo do nothing (the import would discard them). */
async function blockedWhileImporting(browser, fixtures) {
  await openWithAnswer(browser, path.join(fixtures, 'details.png'))
  await placeForChecks(browser)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  await clickPixel(browser, 45, 185)
  await browser.press('Delete')
  await browser.press('z', { ctrl: true })
  await clickPixel(browser, 5, 5)
  const before = await summary(browser)
  // Nothing unexported (the Delete was undone), so the image opens without a question; it is held
  // while decoding, so the keys are certainly pressed while it opens.
  await edit(browser, 'holdImports()')
  await browser.setFile('input[type=file]', path.join(fixtures, 'graphic.png'))
  await waitFor(async () => (await summary(browser)).importing, { what: 'the import to start' })
  await browser.press('Delete')
  await browser.press('y', { ctrl: true })
  const during = await summary(browser)
  const del = await edit(browser, 'button("Delete Selection")')
  const buttons = await edit(browser, 'historyButtons()')
  report.check(
    'while another image opens: Delete and Redo do nothing, their controls are unavailable',
    during.importing && during.revision === before.revision && during.selected === before.selected && during.redo === before.redo && del.disabled === 'true' && buttons.redo.disabled === 'true' && buttons.undo.disabled === 'true',
    json({ before, during, del: del.disabled, buttons }),
  )
  await edit(browser, 'releaseImports()')
  await waitFor(async () => !(await summary(browser)).importing, { what: 'the image to open' })
  report.check('the image then opens', json((await summary(browser)).size) === json([800, 600]))
}

async function perf(browser, fixtures, name, { file, seed, label, cycles = 3 }) {
  await openWithAnswer(browser, path.join(fixtures, file), 'continue', { timeout: 120000 })
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  await dispatch(browser, { type: 'zoom-fitted' })
  await settle(browser)
  const rows = []
  const memory = []
  const heap = async () => {
    if (!browser.cdp) return null
    await browser.cdp('HeapProfiler.enable')
    await browser.cdp('HeapProfiler.collectGarbage')
    const usage = await browser.cdp('Runtime.getHeapUsage')
    return { heapMB: +(usage.usedSize / 2 ** 20).toFixed(1), arrayBuffersMB: usage.backingStorageSize === undefined ? null : +(usage.backingStorageSize / 2 ** 20).toFixed(1) }
  }
  // Two renders first: React keeps the previous render's state until the next one.
  await dispatch(browser, { type: 'zoom-stepped', direction: 1 })
  await dispatch(browser, { type: 'zoom-fitted' })
  await settle(browser)
  memory.push({ when: 'opened', ...(await heap()), ...(await edit(browser, 'liveImages()')) })
  for (let i = 0; i < cycles; i++) {
    await clickPixel(browser, seed[0], seed[1])
    const row = { selected: (await summary(browser)).selected }
    row.delete = await edit(browser, 'timeKey("Delete")')
    row.undo = await edit(browser, 'timeKey("z", { ctrl: true })')
    row.redo = await edit(browser, 'timeKey("y", { ctrl: true })')
    row.bytes = (await summary(browser)).bytes
    rows.push(row)
    await edit(browser, 'timeKey("z", { ctrl: true })')
    await dispatch(browser, { type: 'selection-cleared' })
    await dispatch(browser, { type: 'zoom-stepped', direction: 1 })
    await dispatch(browser, { type: 'zoom-fitted' })
    await settle(browser)
    memory.push({ when: `after cycle ${i + 1}`, ...(await heap()), ...(await edit(browser, 'liveImages()')), historyBytes: (await summary(browser)).bytes })
  }
  const ok = rows.every((row) => row.delete.changed && row.undo.changed && row.redo.changed)
  report.check(`${label}: timed Delete, Undo and Redo each changed the image`, ok)
  const fmt = (t) => `total ${t.total.toFixed(0)} ms (create ${(t.put + t.transfer).toFixed(0)}: put ${t.put.toFixed(0)} + transfer ${t.transfer.toFixed(0)}; draw call ${t.draw.toFixed(1)}), next frame ${t.framed.toFixed(0)} ms`
  for (const [i, row] of rows.entries()) {
    report.note(`  ${label} cycle ${i + 1}: Delete of ${row.selected.toLocaleString('en-CA')} selected pixels: ${fmt(row.delete)}`)
    report.note(`  ${label} cycle ${i + 1}: Undo   ${fmt(row.undo)}`)
    report.note(`  ${label} cycle ${i + 1}: Redo   ${fmt(row.redo)}; history ${(row.bytes / 1024).toFixed(1)} KB`)
  }
  for (const entry of memory) report.note(`  ${label} memory ${json(entry)}`)
  const last = memory.at(-1)
  report.check(`${label}: one live display image after ${cycles} cycles`, last.live === 1 && last.currentLive, json(last))
  await edit(browser, 'timeKey("z", { ctrl: true })')
}

async function run(name, dpr, url, fixtures) {
  const browser = await launch(name, { dpr, width: 1400, height: 900 })
  report.note(`\n=== ${browser.name} — ${url}`)
  try {
    await replaceConfirmation(browser, fixtures, url)
    await load(browser, url)
    for (const spec of [
      { file: 'graphic.png', seed: [300, 260], label: 'PNG, opaque object on transparency' },
      { file: 'graphic.jpg', seed: [10, 10], label: 'JPEG, white background' },
      { file: 'graphic.webp', seed: [300, 260], label: 'WebP, opaque object on transparency' },
      { file: 'logo.svg', seed: [5, 5], label: 'SVG, opaque background' },
      { file: 'logo-alpha.svg', seed: [240, 100], label: 'SVG, half-transparent shape' },
      { file: 'alpha.png', seed: [128, 150], flood: 'global', label: 'PNG, partial alpha, Global (disconnected)' },
      { file: 'alpha.webp', seed: [128, 150], flood: 'global', label: 'WebP, partial alpha, Global (disconnected)' },
      { file: 'details.png', seed: [5, 5], label: 'PNG, white around 1-pixel details' },
      { file: 'details.png', seed: [50, 190], flood: 'global', label: 'PNG, three disconnected squares, Global' },
      { file: 'shot4k.png', seed: [560, 150], label: '4K screenshot background' },
    ]) {
      await cycle(browser, fixtures, spec)
    }
    await multipleDeletes(browser, fixtures)
    await addSubtractContext(browser, fixtures)
    await keyboardAndControls(browser, fixtures, name)
    await blockedWhileImporting(browser, fixtures)
    if (!values['no-perf']) {
      await perf(browser, fixtures, name, { file: 'shot4k.png', seed: [560, 150], label: 'perf 3840 × 2160', cycles: 5 })
      if (!values['no-stress']) await perf(browser, fixtures, name, { file: 'big50mp.png', seed: [10, 10], label: 'perf 8660 × 5773', cycles: 3 })
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

const fixtures = await ensureEditFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) for (const dpr of ratios) await run(name, dpr, server.url, fixtures)
} finally {
  await server.close()
}
report.finish()
