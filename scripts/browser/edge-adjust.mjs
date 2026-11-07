// Adjusting the last Delete with Edge cleanup and Feather (Phase 3 Step 9) in headless Chrome and
// Firefox.
//
//   npm run build
//   node scripts/browser/edge-adjust.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// - Right after a Delete, with real pointer drags, key presses, held keys and typing: dragging a
//   slider or holding a key computes nothing until it is released, then the Delete is made again
//   once; typing waits for Enter (or leaving the field), Escape cancels. Every result is exactly the
//   bytes the application's algorithm gives in Node for the original pixels and selection with the
//   amounts now set (so never built on an earlier result); one history entry throughout; the
//   canvas shows the result; one Undo restores every byte and the selection, Redo the latest
//   result; 0 / 0 is the Step 6 Delete; the tooltips say which Delete the amounts apply to.
// - After Redo with other amounts shown than the Delete was made with: moving through the controls
//   with the keyboard, focusing and leaving them, and changing an amount and back within one
//   adjustment (drag, held keys, retyping, Escape) never update the Delete; an actual change does.
// - The status bar's note that the amounts update the last Delete: shown only then, no height change,
//   hidden below 800 px.
// - Nothing is adjusted with a selection (the amounts set the next Delete, which then uses them),
//   after Select All and Clear, while the replace confirmation is open (also when opening it moves
//   focus out of a field being edited), or while another image opens.
// - For several images, a sequence of adjustments from the field, each compared with Node.
// - Unless --no-perf: the time of each adjustment (the synchronous commit handler, including the
//   display image) at 4K and (unless --no-stress) near 50 MP, Undo and Redo, history size, live
//   display images and, in Chrome, the JavaScript heap. Timings are reported, never checked.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { launch, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, serveBuild, settle } from './lib/app.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { bytesOf, clickPixel, edges, edit, ev, firstDifference, hash, json, load, placeForChecks, sameBytes, select, setAmounts, summary } from './lib/edges.mjs'
import { importSource } from './lib/source.mjs'
import { ensureEdgeFixtures, ensureEditFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const report = createReport()

// The application's own code, run in Node for the expected results.
const { deleteSelectionWithEdges } = await importSource('image/edit/deleteWithEdges.ts')
const { deleteSelectedPixels } = await importSource('image/edit/deleteSelection.ts')
const { createSelectionMask } = await importSource('image/selection/selectionMask.ts')

/** The open document's pixels and selection as Node values. */
async function capture(browser) {
  const document = await edges(browser, 'document()')
  const selected = await edges(browser, 'selection()')
  return {
    pixels: { width: document.width, height: document.height, data: bytesOf(document.pixels) },
    selection: selected && createSelectionMask(document.width, document.height, new Uint8Array(Buffer.from(selected.data, 'base64'))),
  }
}

/**
 * Checks that the document is exactly the Delete of `original` with `settings` (Node), made as one
 * edit: one entry recorded with those amounts, nothing to redo, the depth `depth`.
 */
async function expectResult(browser, tag, original, settings, { depth = 1, entries = 1, canvas = false } = {}) {
  const expected = deleteSelectionWithEdges(original.pixels, original.selection, settings)
  const shown = bytesOf((await edges(browser, 'document()')).pixels)
  const exact = sameBytes(shown, expected.pixels.data)
  report.check(`${tag}: exactly the application's Delete of the original pixels and selection with ${settings.cleanup} / ${settings.feather}`, exact, exact ? `${expected.edgePixels} edge pixels` : json(firstDifference(shown, expected.pixels.data)))
  const s = await summary(browser)
  const recorded = await edges(browser, 'latestSettings()')
  report.check(
    `${tag}: still one edit: ${entries} entr${entries === 1 ? 'y' : 'ies'}, nothing to redo, depth ${depth}, the entry recorded with those amounts, nothing selected`,
    s.undo === entries && s.redo === 0 && s.depth === depth && json(recorded) === json(settings) && s.selected === 0 && s.operation === null,
    json({ s, recorded }),
  )
  if (canvas) {
    const compared = await ev(browser, 'window.__minty.compareImage()')
    report.check(`${tag}: the canvas shows the result`, !compared.skipped && compared.failures === 0, json({ n: compared.n, wrong: compared.wrong, first: compared.first }))
  }
  return expected
}

const revision = async (browser) => (await summary(browser)).revision
const created = async (browser) => (await edit(browser, 'liveImages()')).created

/** Where a 0–5 slider's thumb is for `value`, in client pixels (the thumb's half-width inset at both ends). */
function sliderX(slider, value, inset) {
  return slider.left + inset + ((slider.right - slider.left - 2 * inset) * value) / 5
}

/** The interaction: drags, keys, typing, Undo / Redo, and when nothing may be adjusted. */
async function interaction(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'edge-hmi.png'))
  await setAmounts(browser, 0, 0)
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await placeForChecks(browser)
  const original = await capture(browser)
  report.check(`${name}: with a selection, the amounts are for the next Delete (not adjusting)`, !(await edges(browser, 'adjustable()')) && (await edges(browser, 'control("Edge cleanup")')).slider.title.startsWith('Edge cleanup for the next Delete:'))
  const noteBefore = await edges(browser, 'note()')
  await edit(browser, 'save("before")')
  await browser.press('Delete')
  await settle(browser)
  const deletedHash = await edit(browser, 'pixelsHash()')
  const note = await edges(browser, 'note()')
  report.check(
    `${name}: the status bar says the edge settings update the last Delete, without changing the toolbar or status bar height`,
    note.shown && note.text === 'Edge settings update last Delete' && note.rowHeight === noteBefore.rowHeight && note.statusHeight === noteBefore.statusHeight && !noteBefore.shown,
    json({ noteBefore, note }),
  )
  const tooltips = await Promise.all(['Edge cleanup', 'Feather'].map((label) => edges(browser, `control(${json(label)})`)))
  report.check(
    `${name}: right after the Delete, the amounts adjust it, and both controls' tooltips say so`,
    (await edges(browser, 'adjustable()')) && tooltips.every((c, i) => [c.slider.title, c.field.title].every((t) => t.startsWith(`${['Edge cleanup', 'Feather'][i]}, updating the last Delete:`))),
    json(tooltips.map((c) => c.slider.title)),
  )

  // A pointer drag on the Edge cleanup slider: the amount follows, nothing is computed until release.
  const slider = (await edges(browser, 'control("Edge cleanup")')).slider
  const inset = 8
  let rev = await revision(browser)
  let images = await created(browser)
  await browser.mouseDown(sliderX(slider, 0, inset), slider.y)
  const during = []
  for (const value of [1, 2, 4, 5, 4, 3]) {
    await browser.mouseMove(sliderX(slider, value, inset), slider.y)
    await settle(browser)
    during.push((await edges(browser, 'settings()')).cleanup)
  }
  const midDrag = { revision: await revision(browser), images: await created(browser) }
  report.check(
    `${name}: while dragging the Edge cleanup slider the amount follows, but nothing is computed and the image does not change`,
    during.some((v) => v >= 4) && during.at(-1) === 3 && midDrag.revision === rev && midDrag.images === images,
    json({ during, midDrag, rev, images }),
  )
  await browser.mouseUp(sliderX(slider, 3, inset), slider.y)
  await settle(browser)
  let settings = await edges(browser, 'settings()')
  report.check(`${name}: releasing the slider makes the Delete again once`, (await revision(browser)) > rev && (await created(browser)) === images + 1 && settings.cleanup === 3, json({ settings }))
  await expectResult(browser, `${name}: after the drag`, original, settings, { canvas: true })
  const announced = await edit(browser, 'announcement()')
  report.check(`${name}: the update is announced with the amounts`, announced?.startsWith('Delete Selection updated with Edge cleanup 3 px and Feather 0 px:'), announced)

  // Keyboard on the Feather slider: each step committed at its key's release; a held key once.
  await edges(browser, 'focus("Feather", "slider")')
  const steps = []
  for (let i = 0; i < 2; i++) {
    rev = await revision(browser)
    await browser.press('ArrowRight')
    await settle(browser)
    steps.push({ feather: (await edges(browser, 'settings()')).feather, adjusted: (await revision(browser)) > rev })
  }
  report.check(`${name}: each arrow press on the Feather slider makes the Delete again at its release`, json(steps) === json([{ feather: 1, adjusted: true }, { feather: 2, adjusted: true }]), json(steps))
  rev = await revision(browser)
  images = await created(browser)
  await browser.keyDown('ArrowRight')
  for (let i = 0; i < 3; i++) await browser.keyDown('ArrowRight', { repeat: true })
  await settle(browser)
  const held = { feather: (await edges(browser, 'settings()')).feather, revision: await revision(browser), images: await created(browser) }
  await browser.keyUp('ArrowRight')
  await settle(browser)
  settings = await edges(browser, 'settings()')
  report.check(
    `${name}: holding the arrow steps the amount to 5 without computing; releasing it makes the Delete again once`,
    held.feather === 5 && held.revision === rev && held.images === images && (await revision(browser)) > rev && (await created(browser)) === images + 1 && settings.feather === 5,
    json({ held, settings }),
  )
  await expectResult(browser, `${name}: after holding the key`, original, settings)

  // Typing in the Edge cleanup field: applied on Enter, Escape cancels, leaving commits.
  await edges(browser, 'focus("Edge cleanup", "field")')
  rev = await revision(browser)
  await browser.type('1')
  await settle(browser)
  const typed = { cleanup: (await edges(browser, 'settings()')).cleanup, revision: await revision(browser) }
  await browser.press('Enter')
  await settle(browser)
  report.check(`${name}: typing 1 shows it at once but computes nothing; Enter makes the Delete again`, typed.cleanup === 1 && typed.revision === rev && (await revision(browser)) > rev, json(typed))
  await expectResult(browser, `${name}: after Enter`, original, { cleanup: 1, feather: 5 })
  rev = await revision(browser)
  await edges(browser, 'selectField("Edge cleanup")')
  await browser.type('4')
  await browser.press('Escape')
  await settle(browser)
  report.check(`${name}: Escape cancels a typed amount: back to 1, nothing computed`, (await edges(browser, 'settings()')).cleanup === 1 && (await revision(browser)) === rev)
  await edges(browser, 'selectField("Edge cleanup")')
  await browser.type('0')
  if (await ev(browser, 'document.hasFocus()')) {
    await browser.press('Tab')
    await settle(browser)
    report.check(`${name}: leaving the field after typing 0 makes the Delete again`, (await revision(browser)) > rev && (await edges(browser, 'settings()')).cleanup === 0)
  } else {
    report.note(`  ${name}: leaving the field not checked: the headless window has no focus, so no blur event fires (Enter used)`)
    await browser.press('Enter')
    await settle(browser)
  }
  await expectResult(browser, `${name}: cleanup 0, feather 5`, original, { cleanup: 0, feather: 5 })
  // Arrow keys in the Feather field: committed when released.
  await edges(browser, 'focus("Feather", "field")')
  rev = await revision(browser)
  await browser.press('ArrowDown')
  await settle(browser)
  report.check(`${name}: an arrow step in the Feather field makes the Delete again`, (await revision(browser)) > rev && (await edges(browser, 'settings()')).feather === 4)
  const last = await expectResult(browser, `${name}: cleanup 0, feather 4`, original, { cleanup: 0, feather: 4 }, { canvas: true })
  await edges(browser, 'blur()')
  // Committing the amounts the result already has computes nothing (a second change event, a blur).
  rev = await revision(browser)
  await edges(browser, 'commitSlider("Feather", 4)')
  await settle(browser)
  report.check(`${name}: committing the amounts the result was made with computes nothing`, (await revision(browser)) === rev)

  // One Undo restores the original exactly, with the selection; Redo the latest result, adjustable again.
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(`${name}: one Ctrl + Z restores every byte and the selection from before the Delete`, (await edit(browser, 'samePixels("before")')) && (await edit(browser, 'sameSelection("before")')) && (await summary(browser)).depth === 0)
  report.check(`${name}: after Undo the amounts are for the next Delete again`, !(await edges(browser, 'adjustable()')))
  await browser.press('y', { ctrl: true })
  await settle(browser)
  report.check(`${name}: Ctrl + Y restores the latest adjusted result, which can be adjusted again`, (await edit(browser, 'pixelsHash()')) === hash(last.pixels.data) && (await edges(browser, 'adjustable()')))
  await setAmounts(browser, 0, 0)
  const exact = deleteSelectedPixels(original.pixels, original.selection)
  report.check(`${name}: back to 0 / 0 after Redo: exactly the Step 6 Delete, the same bytes as the first Delete`, (await edit(browser, 'pixelsHash()')) === hash(exact.pixels.data) && (await edit(browser, 'pixelsHash()')) === deletedHash)
  await expectResult(browser, `${name}: 0 / 0`, original, { cleanup: 0, feather: 0 })
  // The header buttons as well.
  for (const button of ['Undo Delete Selection', 'Redo Delete Selection']) {
    const b = await edit(browser, `button(${json(button)})`)
    await browser.click(b.x, b.y)
    await settle(browser)
  }
  report.check(`${name}: the Undo and Redo buttons restore exactly`, (await edit(browser, 'pixelsHash()')) === deletedHash && (await summary(browser)).undo === 1)
  await edit(browser, 'forget("before")')

  // A selection means the next Delete: the amounts set it and the earlier Delete stays.
  const selectAll = await edit(browser, 'button("Select All")')
  await browser.click(selectAll.x, selectAll.y)
  await settle(browser)
  rev = await revision(browser)
  await edges(browser, 'commitSlider("Edge cleanup", 2)')
  await settle(browser)
  const withSelection = { revision: await revision(browser), settings: await edges(browser, 'settings()'), title: (await edges(browser, 'control("Edge cleanup")')).slider.title }
  report.check(
    `${name}: with something selected, a committed amount only sets the next Delete, and the status bar note is gone`,
    withSelection.revision === rev && withSelection.settings.cleanup === 2 && withSelection.title.startsWith('Edge cleanup for the next Delete:') && !(await edges(browser, 'note()')).shown,
    json(withSelection),
  )
  await browser.press('Escape')
  await settle(browser)
  await edges(browser, 'commitSlider("Edge cleanup", 4)')
  await settle(browser)
  report.check(`${name}: after Select All and Clear, nothing selected again: still only the next Delete`, (await revision(browser)) === rev && !(await edges(browser, 'adjustable()')))
  await setAmounts(browser, 0, 0)

  // Make the first Delete adjustable again (Undo, then Delete), then open the replace confirmation
  // while an amount is typed but not committed: opening it moves focus out of the field.
  await browser.press('z', { ctrl: true })
  await settle(browser)
  await browser.press('Delete')
  await settle(browser)
  await edges(browser, 'focus("Edge cleanup", "field")')
  await browser.type('3')
  await settle(browser)
  rev = await revision(browser)
  await browser.setFile('input[type=file]', path.join(fixtures, 'edge-lines.png'))
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the replace confirmation' })
  await settle(browser)
  const asking = { revision: await revision(browser), settings: await edges(browser, 'settings()'), recorded: await edges(browser, 'latestSettings()'), focus: await edit(browser, 'activeElement()') }
  report.check(
    `${name}: while the replace confirmation is open, nothing changes the image (the typed amount is only set)`,
    asking.revision === rev && json(asking.recorded) === json({ cleanup: 0, feather: 0 }),
    json(asking),
  )
  const cancel = await edit(browser, 'button("Cancel")')
  await browser.click(cancel.x, cancel.y)
  await waitFor(() => ev(browser, '!document.querySelector("dialog[open]")'), { what: 'the dialog to close' })
  await settle(browser)
  report.check(`${name}: after Cancel the Delete is unchanged and still adjustable`, (await revision(browser)) === rev && (await edges(browser, 'adjustable()')))
  // The amount typed before the dialog is set (where leaving the field committed it); changing it now updates the Delete.
  await edges(browser, 'focus("Edge cleanup", "field")')
  await edges(browser, 'selectField("Edge cleanup")')
  await browser.type('2')
  await browser.press('Enter')
  await settle(browser)
  await expectResult(browser, `${name}: a change after Cancel`, original, { cleanup: 2, feather: 0 })
  await edges(browser, 'blur()')

  // Narrow windows drop the note rather than the selection and pointer readouts; nothing scrolls sideways.
  await browser.resize(760, 800)
  await settle(browser)
  const narrow = await edges(browser, 'note()')
  await browser.resize(1400, 900)
  await settle(browser)
  const wide = await edges(browser, 'note()')
  report.check(`${name}: below 800 px the note is hidden and nothing scrolls sideways; it is back at full width`, !narrow.shown && narrow.docWidth <= narrow.viewport && wide.shown, json({ narrow, wide }))

  // While another image opens (held), a committed amount changes nothing.
  await edit(browser, 'holdImports()')
  await browser.setFile('input[type=file]', path.join(fixtures, 'edge-lines.png'))
  await waitFor(() => ev(browser, '!!document.querySelector("dialog[open]")'), { what: 'the replace confirmation' })
  const go = await edit(browser, 'button("Continue")')
  await browser.click(go.x, go.y)
  await waitFor(() => ev(browser, 'window.__minty.state().pendingImportId !== null'), { what: 'the import to start' })
  rev = await revision(browser)
  await edges(browser, 'commitSlider("Edge cleanup", 5)')
  await settle(browser)
  report.check(`${name}: while another image opens, a committed amount changes nothing`, (await revision(browser)) === rev && (await edges(browser, 'settings()')).cleanup === 5 && !(await edges(browser, 'adjustable()')))
  await edit(browser, 'releaseImports()')
  await waitFor(() => ev(browser, '(() => { const s = window.__minty.state(); return s.pendingImportId === null && s.history.undo.length === 0 })()'), { what: 'the new image' })
  await settle(browser)
  report.check(`${name}: the new image has nothing to adjust`, !(await edges(browser, 'adjustable()')))
  await setAmounts(browser, 0, 0)
  const live = await edit(browser, 'liveImages()')
  report.check(`${name}: one live display image`, live.live === 1 && live.currentLive, json(live))
}

/**
 * After Redo the amounts shown can differ from those the redone Delete was made with. Moving
 * through the controls, or changing an amount and back within one adjustment, must not update it;
 * an actual change does, with the amounts now shown.
 */
async function redoMismatch(browser, fixtures, name) {
  await openWithAnswer(browser, path.join(fixtures, 'edge-hmi.png'))
  await setAmounts(browser, 1, 0)
  await select(browser, [{ x: 2, y: 2, tolerance: 10 }])
  await placeForChecks(browser)
  const original = await capture(browser)
  await browser.press('Delete')
  await settle(browser)
  await browser.press('z', { ctrl: true })
  await settle(browser)
  await setAmounts(browser, 3, 2) // with the selection back: for the next Delete only
  await browser.press('y', { ctrl: true })
  await settle(browser)
  const start = { revision: await revision(browser), images: await created(browser), settings: await edges(browser, 'settings()'), recorded: await edges(browser, 'latestSettings()') }
  report.check(
    `${name}: Redo mismatch: the controls show 3 / 2, the redone Delete was made with 1 / 0, and it can be adjusted`,
    json(start.settings) === json({ cleanup: 3, feather: 2 }) && json(start.recorded) === json({ cleanup: 1, feather: 0 }) && (await edges(browser, 'adjustable()')) && (await edges(browser, 'note()')).shown,
    json(start),
  )
  const unchanged = async (what) => {
    await settle(browser)
    const now = { revision: await revision(browser), images: await created(browser), recorded: await edges(browser, 'latestSettings()') }
    report.check(`${name}: Redo mismatch: ${what}: nothing is computed and the Delete keeps 1 / 0`, now.revision === start.revision && now.images === start.images && json(now.recorded) === json(start.recorded), json(now))
  }

  // Keyboard only: Tab forward through both controls to Delete Selection, then Shift + Tab back.
  await edges(browser, 'focusButton("Shrink Selection")')
  const forward = []
  for (let i = 0; i < 5; i++) {
    await browser.press('Tab')
    forward.push((await edges(browser, 'active()')).name)
  }
  const backward = []
  for (let i = 0; i < 5; i++) {
    await browser.press('Tab', { shift: true })
    backward.push((await edges(browser, 'active()')).name)
  }
  report.check(
    `${name}: Redo mismatch: Tab and Shift + Tab reach every part of both controls`,
    json(forward) === json(['Edge cleanup', 'Edge cleanup in pixels, 0 to 5', 'Feather', 'Feather in pixels, 0 to 5', 'Delete Selection']) && backward.at(-1) === 'Shrink Selection',
    json({ forward, backward }),
  )
  await unchanged('Tab and Shift + Tab through both controls')
  for (const [label, part] of [['Edge cleanup', 'slider'], ['Edge cleanup', 'field'], ['Feather', 'slider'], ['Feather', 'field']]) {
    await edges(browser, `focus(${json(label)}, ${json(part)})`)
    await edges(browser, 'blur()')
  }
  await unchanged('focusing and leaving each part')

  // Changed and back within one adjustment.
  const slider = (await edges(browser, 'control("Edge cleanup")')).slider
  const inset = 8
  await browser.mouseDown(sliderX(slider, 3, inset), slider.y)
  for (const value of [4, 5, 4, 3]) await browser.mouseMove(sliderX(slider, value, inset), slider.y)
  await browser.mouseUp(sliderX(slider, 3, inset), slider.y)
  const dragged = (await edges(browser, 'settings()')).cleanup
  report.check(`${name}: Redo mismatch: the drag ended where it started`, dragged === 3, String(dragged))
  await edges(browser, 'blur()')
  await unchanged('a slider drag from 3 to 5 and back to 3')
  await edges(browser, 'focus("Feather", "slider")')
  await browser.keyDown('ArrowRight')
  await browser.keyDown('ArrowLeft')
  await browser.keyUp('ArrowRight')
  await browser.keyUp('ArrowLeft')
  await edges(browser, 'blur()')
  await unchanged('ArrowRight and ArrowLeft held together, then released')
  await edges(browser, 'focus("Edge cleanup", "field")')
  await browser.type('4')
  await edges(browser, 'selectField("Edge cleanup")')
  await browser.type('3')
  await browser.press('Enter')
  await unchanged('typing 4, then 3 again, and Enter')
  await edges(browser, 'selectField("Edge cleanup")')
  await browser.type('5')
  await browser.press('Escape')
  await unchanged('typing 5, then Escape')
  report.check(`${name}: Redo mismatch: Escape restored the amount shown`, json(await edges(browser, 'settings()')) === json({ cleanup: 3, feather: 2 }))
  await browser.press('Enter')
  await edges(browser, 'blur()')
  await unchanged('Enter and leaving the field without a change')

  // An actual change updates the Delete with the amounts now shown.
  await edges(browser, 'focus("Feather", "field")')
  await browser.type('0')
  await browser.press('Enter')
  await settle(browser)
  await expectResult(browser, `${name}: Redo mismatch: Feather changed to 0`, original, { cleanup: 3, feather: 0 })
  const after = await revision(browser)
  await edges(browser, 'focusButton("Shrink Selection")')
  for (let i = 0; i < 5; i++) await browser.press('Tab')
  await edges(browser, 'blur()')
  await settle(browser)
  report.check(`${name}: Redo mismatch: tabbing through again changes nothing`, (await revision(browser)) === after)
  await setAmounts(browser, 0, 0)
}

const SEQUENCE_SPECS = [
  { file: 'edge-hmi.png', clicks: [{ x: 2, y: 2, tolerance: 10 }], label: 'HMI pump graphic' },
  { file: 'edge-lines.png', clicks: [{ x: 1, y: 1, tolerance: 20, flood: 'global' }], label: 'thin lines and wiring' },
  { file: 'edge-alpha.png', clicks: [{ x: 30, y: 30, tolerance: 10 }], label: 'partially transparent PNG' },
  { file: 'edge-photo.jpg', clicks: [{ x: 2, y: 2, tolerance: 25 }], label: 'soft photo, JPEG' },
  { file: 'edge-svg.svg', clicks: [{ x: 2, y: 2, tolerance: 20 }], label: 'rasterised SVG' },
]

// Each step commits one amount from its field, as a user would (cleanup, feather).
const SEQUENCE = [['cleanup', 3], ['feather', 2], ['cleanup', 5], ['feather', 5], ['cleanup', 0], ['feather', 0], ['cleanup', 1]]

/** A Delete adjusted through a sequence of amounts, each compared with Node; Undo and Redo exact. */
async function sequence(browser, fixtures, name, spec) {
  await openWithAnswer(browser, path.join(fixtures, spec.file))
  await setAmounts(browser, 1, 1)
  await select(browser, spec.clicks)
  await placeForChecks(browser)
  const original = await capture(browser)
  await edit(browser, 'save("before")')
  await browser.press('Delete')
  await settle(browser)
  const tag = `${name}: ${spec.label}`
  let settings = { cleanup: 1, feather: 1 }
  let result = await expectResult(browser, `${tag}, Delete at 1 / 1`, original, settings)
  let allExact = true
  for (const [which, value] of SEQUENCE) {
    settings = { ...settings, [which]: value }
    const label = which === 'cleanup' ? 'Edge cleanup' : 'Feather'
    await edges(browser, `focus(${json(label)}, "field")`)
    await edges(browser, `selectField(${json(label)})`)
    await browser.type(String(value))
    await browser.press('Enter')
    await settle(browser)
    result = deleteSelectionWithEdges(original.pixels, original.selection, settings)
    const shown = bytesOf((await edges(browser, 'document()')).pixels)
    const s = await summary(browser)
    const ok = sameBytes(shown, result.pixels.data) && s.undo === 1 && s.depth === 1
    allExact &&= ok
    if (!ok) report.check(`${tag}, ${settings.cleanup} / ${settings.feather}: exact, one entry`, false, json({ s, first: firstDifference(shown, result.pixels.data) }))
  }
  await edges(browser, 'blur()')
  report.check(`${tag}: ${SEQUENCE.length} adjustments from the fields, each exactly the Delete of the original with those amounts, one entry throughout`, allExact)
  const compared = await ev(browser, 'window.__minty.compareImage()')
  report.check(`${tag}: the canvas shows the last result`, !compared.skipped && compared.failures === 0, json({ wrong: compared.wrong, first: compared.first }))
  await browser.press('z', { ctrl: true })
  await settle(browser)
  report.check(`${tag}: one Undo restores every byte and the selection`, (await edit(browser, 'samePixels("before")')) && (await edit(browser, 'sameSelection("before")')))
  await browser.press('y', { ctrl: true })
  await settle(browser)
  report.check(`${tag}: Redo restores the last result`, (await edit(browser, 'pixelsHash()')) === hash(result.pixels.data))
  await edit(browser, 'forget("before")')
  await setAmounts(browser, 0, 0)
}

// Each adjustment changes one amount; the sequence ends at 0 / 0, which must equal the first Delete.
const PERF_STEPS = [['cleanup', 1], ['cleanup', 3], ['cleanup', 5], ['feather', 5], ['cleanup', 0], ['feather', 2], ['cleanup', 2], ['feather', 0], ['cleanup', 0]]

/** Times adjustments (the synchronous commit handler), then Undo and Redo; exactness by hash. */
async function perf(browser, fixtures, { file, seed, tolerance, label }) {
  await openWithAnswer(browser, path.join(fixtures, file), 'continue', { timeout: 120000 })
  await setAmounts(browser, 0, 0)
  await dispatch(browser, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })
  await edit(browser, `commitTolerance(${tolerance})`)
  await dispatch(browser, { type: 'zoom-fitted' })
  await settle(browser)
  await clickPixel(browser, seed[0], seed[1])
  const selected = (await summary(browser)).selected
  const original = await edit(browser, 'pixelsHash()')
  const del = await edit(browser, 'timeKey("Delete")')
  const deleted = await edit(browser, 'pixelsHash()')
  const heap = async () => {
    if (!browser.cdp) return null
    await browser.cdp('HeapProfiler.enable')
    await browser.cdp('HeapProfiler.collectGarbage')
    const usage = await browser.cdp('Runtime.getHeapUsage')
    return { heapMB: +(usage.usedSize / 2 ** 20).toFixed(1), arrayBuffersMB: usage.backingStorageSize === undefined ? null : +(usage.backingStorageSize / 2 ** 20).toFixed(1) }
  }
  const fmt = (t) => `${t.total.toFixed(0)} ms (display image ${(t.put + t.transfer).toFixed(0)})`
  report.note(`  ${label}: ${selected.toLocaleString('en-CA')} selected; Delete at 0 / 0 ${fmt(del)}; history ${((await summary(browser)).bytes / 1024).toFixed(0)} KB; memory ${json({ ...(await heap()), ...(await edit(browser, 'liveImages()')) })}`)
  const settings = { cleanup: 0, feather: 0 }
  const byAmounts = new Map([['0/0', deleted]])
  let consistent = true
  let allAdjusted = true
  for (const [which, value] of PERF_STEPS) {
    settings[which] = value
    const control = which === 'cleanup' ? 'Edge cleanup' : 'Feather'
    const t = await edit(browser, `timeInput(() => window.__mintyEdges.commitSlider(${json(control)}, ${value}))`)
    const h = await edit(browser, 'pixelsHash()')
    const key = `${settings.cleanup}/${settings.feather}`
    if (byAmounts.has(key)) consistent &&= byAmounts.get(key) === h
    byAmounts.set(key, h)
    allAdjusted &&= t.changed
    const s = await summary(browser)
    report.note(`  ${label}, adjusted to ${key}: ${fmt(t)}; history ${(s.bytes / 1024).toFixed(0)} KB, ${s.undo} entry`)
  }
  report.check(`${label}: every adjustment made the Delete again, and 0 / 0 at the end is exactly the first Delete`, allAdjusted && consistent && byAmounts.get('0/0') === deleted)
  const undo = await edit(browser, 'timeKey("z", { ctrl: true })')
  const undone = await edit(browser, 'pixelsHash()')
  const redo = await edit(browser, 'timeKey("y", { ctrl: true })')
  const redone = await edit(browser, 'pixelsHash()')
  report.check(`${label}: after the adjustments, one Undo restores the original and Redo the latest result`, undone === original && redone === deleted)
  const memory = { ...(await heap()), ...(await edit(browser, 'liveImages()')) }
  report.note(`  ${label}: Undo ${fmt(undo)}; Redo ${fmt(redo)}; memory ${json(memory)}`)
  report.check(`${label}: one live display image at the end`, memory.live === 1 && memory.currentLive, json(memory))
}

async function run(name, url, fixtures) {
  const browser = await launch(name, { dpr: 1, width: 1400, height: 900 })
  report.note(`\n=== ${browser.name} — ${url}`)
  try {
    await load(browser, url)
    await interaction(browser, fixtures, browser.name)
    await redoMismatch(browser, fixtures, browser.name)
    for (const spec of SEQUENCE_SPECS) await sequence(browser, fixtures, browser.name, spec)
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
