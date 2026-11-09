// PNG export and the whole first background-removal workflow, in headless Chrome and Firefox.
//
//   npm run build
//   node scripts/browser/png-export.mjs [--browser chrome|firefox|all] [--no-perf] [--no-stress]
//
// Set APP_URL to test a running server instead (npm run dev runs under React Strict Mode).
//
// With real clicks and key presses: open an image, Magic Wand, Delete, Export, Ctrl + Z, Ctrl + Y,
// Auto Trim, a partially transparent PNG, a feathered Delete. Every exported file is captured in the
// page (the link the app clicks), checked chunk by chunk with Node's zlib (CRC, chunk order, header)
// and decoded in Node: its pixels must be exactly the document's, with fully transparent pixels as
// 0, 0, 0, 0 and the size unchanged. The browser must decode it too. In Chrome one export is also
// downloaded for real into a temporary folder and compared with the captured file.
//
// It also checks the Export button (name, tooltip, "Exporting…", one export at a time), the
// "Unexported edits" note, the replace confirmation after an export, a failed export's message, and
// that no console errors appear. For partially transparent pixels it reports, for comparison, how
// many a canvas encoder (convertToBlob) would have changed.
//
// Then (unless --no-perf) it times exports at 4K and (unless --no-stress) near 50 megapixels, with
// the longest gap between animation frames while the file is written. Times are reported, never
// checked.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'
import { launch, sleep, waitFor } from './lib/browsers.mjs'
import { createReport, dispatch, serveBuild, settle } from './lib/app.mjs'
import { bytesOf, edges, edit, ev, json, load, select } from './lib/edges.mjs'
import { openWithAnswer } from './lib/edit.mjs'
import { decodePng } from './lib/png.mjs'
import { ensureEdgeFixtures, ensureEditFixtures, ensureTrimFixtures } from './fixtures.mjs'

const { values } = parseArgs({
  options: {
    browser: { type: 'string', default: 'all' },
    'no-perf': { type: 'boolean', default: false },
    'no-stress': { type: 'boolean', default: false },
  },
})
const browsers = values.browser === 'all' ? ['chrome', 'firefox'] : values.browser.split(',')
const report = createReport()
const FIXTURES = path.join(import.meta.dirname, 'fixtures')
const fixture = (name) => path.join(FIXTURES, name)

/** Installed after the edit and edge helpers as window.__mintyExport. */
const EXPORT_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const base64 = (bytes) => {
    let out = ''
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(out)
  }
  // Every download the app starts: the link's name and the file behind its blob: URL. The download
  // itself is suppressed unless passThrough is set (Chrome, into a temporary folder).
  // The blob behind each blob: URL the page creates, kept by URL (no fetch needed).
  const captures = []
  const blobs = new Map()
  const createObjectURL = URL.createObjectURL
  URL.createObjectURL = function (object) {
    const url = createObjectURL.call(URL, object)
    blobs.set(url, object)
    return url
  }
  let passThrough = false
  const click = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) {
      captures.push({ fileName: this.download, at: performance.now(), blob: blobs.get(this.href) ?? null, inDocument: this.isConnected })
      if (!passThrough) return
    }
    return click.call(this)
  }
  // The longest gap between animation frames while watching.
  let watching = false, last = 0, longest = 0, frames = 0
  const tick = (now) => {
    if (!watching) return
    if (last) longest = Math.max(longest, now - last)
    last = now
    frames++
    requestAnimationFrame(tick)
  }
  const exportButton = () => document.querySelector('.app-header__export')
  let realCompression = null
  window.__mintyExport = {
    setPassThrough(value) { passThrough = value; return true },
    count: () => captures.length,
    /** Whether export number \`index\` (from 0) has been captured with its file. */
    has: (index) => !!captures[index]?.blob,
    info: (index) => ({ fileName: captures[index].fileName, size: captures[index].blob.size, type: captures[index].blob.type, inDocument: captures[index].inDocument, at: captures[index].at }),
    async bytes(index) { return base64(new Uint8Array(await captures[index].blob.arrayBuffer())) },
    button() {
      const b = exportButton(), r = b.getBoundingClientRect()
      return { text: b.textContent.trim(), disabled: b.getAttribute('aria-disabled'), title: b.title, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width }
    },
    note: () => document.querySelector('.status-bar__unexported')?.textContent ?? null,
    watchFrames() { watching = true; last = 0; longest = 0; frames = 0; requestAnimationFrame(tick); return true },
    stopFrames() { watching = false; return { longest, frames } },
    /** The capture decoded by the browser itself, compared with the document as export must write it. */
    async browserDecode(index) {
      const bitmap = await createImageBitmap(captures[index].blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      const decoded = context.getImageData(0, 0, bitmap.width, bitmap.height).data
      const d = m.state().document, doc = d.pixels.data
      const result = { width: bitmap.width, height: bitmap.height, sameSize: bitmap.width === d.width && bitmap.height === d.height, opaqueWrong: 0, transparentWrong: 0, partial: 0, partialMaxDiff: 0 }
      bitmap.close()
      if (!result.sameSize) return result
      for (let i = 0; i < doc.length; i += 4) {
        const a = doc[i + 3]
        if (a === 0) { if (decoded[i] | decoded[i + 1] | decoded[i + 2] | decoded[i + 3]) result.transparentWrong++ }
        else if (a === 255) { if (decoded[i] !== doc[i] || decoded[i + 1] !== doc[i + 1] || decoded[i + 2] !== doc[i + 2] || decoded[i + 3] !== 255) result.opaqueWrong++ }
        else {
          result.partial++
          for (let k = 0; k < 4; k++) result.partialMaxDiff = Math.max(result.partialMaxDiff, Math.abs(decoded[i + k] - doc[i + k]))
        }
      }
      return result
    },
    /** The document written by the browser's own canvas encoder, for comparison. */
    async canvasEncoded() {
      const d = m.state().document
      const canvas = new OffscreenCanvas(d.width, d.height)
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.pixels.data), d.width, d.height), 0, 0)
      return base64(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))
    },
    /** Makes the next export fail as if compression were impossible. */
    failNextExport() {
      realCompression = window.CompressionStream
      window.CompressionStream = class { constructor() { window.CompressionStream = realCompression; throw new TypeError('Test failure: no compression') } }
      return true
    },
  }
  return true
})()`

const xp = (browser, call) => ev(browser, `window.__mintyExport.${call}`)

/** The PNG's chunks checked with Node's zlib: signature, CRCs, order, header; then its pixels. */
function readPng(bytes) {
  const buffer = Buffer.from(bytes)
  const problems = []
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) problems.push('signature')
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const crc = buffer.readUInt32BE(offset + 8 + length)
    if ((zlib.crc32(buffer.subarray(offset + 4, offset + 8 + length)) >>> 0) !== crc) problems.push(`CRC of ${type}`)
    if (type === 'IHDR') {
      const header = [...buffer.subarray(offset + 16, offset + 21)]
      if (header.join() !== '8,6,0,0,0') problems.push(`header ${header.join()}`)
    }
    chunks.push(type)
    offset += 12 + length
  }
  if (chunks[0] !== 'IHDR' || chunks.at(-1) !== 'IEND' || chunks.slice(1, -1).some((type) => type !== 'IDAT')) problems.push(`chunks ${chunks.join(',')}`)
  const image = decodePng(buffer)
  return { ...image, problems, chunks: chunks.length }
}

/** Mismatches between an exported image and the document it should be. */
function compare(image, document) {
  const doc = bytesOf(document.pixels)
  const result = { sameSize: image.width === document.width && image.height === document.height, wrong: 0, transparent: 0, hiddenColour: 0, partial: 0 }
  if (!result.sameSize) return result
  for (let i = 0; i < doc.length; i += 4) {
    const alpha = doc[i + 3]
    if (alpha === 0) {
      result.transparent++
      if (doc[i] | doc[i + 1] | doc[i + 2]) result.hiddenColour++
    } else if (alpha < 255) result.partial++
    for (let k = 0; k < 4; k++) if (image.data[i + k] !== (alpha === 0 ? 0 : doc[i + k])) { result.wrong++; break }
  }
  return result
}

/** Clicks Export and waits for the file; returns its index. */
async function clickExport(browser, { timeout = 60000 } = {}) {
  const before = await xp(browser, 'count()')
  const button = await xp(browser, 'button()')
  await browser.click(button.x, button.y)
  await waitFor(() => xp(browser, `has(${before})`), { timeout, what: 'the exported file' }).catch(async (error) => {
    const state = await ev(browser, '(() => { const s = window.__minty.state(); return { exporting: s.exporting, editError: s.editError, editNotice: s.editNotice, count: window.__mintyExport.count() } })()')
    throw new Error(`${error.message}: ${json(state)}`)
  })
  await settle(browser)
  return before
}

/** Exports and checks the file against the document now open. */
async function exportAndCheck(browser, label, expectedName) {
  const document = await edges(browser, 'document()')
  const index = await clickExport(browser)
  const info = await xp(browser, `info(${index})`)
  const png = readPng(Buffer.from(await xp(browser, `bytes(${index})`), 'base64'))
  const result = compare(png, document)
  report.check(`${label}: file name ${expectedName}`, info.fileName === expectedName && info.type === 'image/png', `${info.fileName}, ${info.type}`)
  report.check(`${label}: valid PNG (signature, CRCs, IHDR 8-bit RGBA, IDAT chunks, IEND)`, png.problems.length === 0, png.problems.join('; ') || `${png.chunks} chunks`)
  report.check(
    `${label}: ${document.width} × ${document.height}, every pixel exact (fully transparent as 0,0,0,0)`,
    result.sameSize && result.wrong === 0,
    `${png.width} × ${png.height}, ${result.wrong} wrong, ${result.transparent} transparent (${result.hiddenColour} with hidden colour), ${result.partial} partial`,
  )
  const decoded = await xp(browser, `browserDecode(${index})`)
  report.check(
    `${label}: the browser decodes it (opaque and transparent pixels exact)`,
    decoded.sameSize && decoded.opaqueWrong === 0 && decoded.transparentWrong === 0,
    `${json(decoded)}`,
  )
  return { index, document, result, info, bytes: png }
}

async function run(name, url) {
  const downloads = name === 'chrome' ? fs.mkdtempSync(path.join(os.tmpdir(), 'minty-downloads-')) : null
  const browser = await launch(name, { width: 1400, height: 900 })
  try {
    report.note(`\n# ${browser.name}`)
    if (downloads) {
      try {
        await browser.cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
      } catch {
        await browser.cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
      }
    }
    await load(browser, url)
    if (!(await ev(browser, EXPORT_HELPERS))) throw new Error('Could not install the export helpers')

    let button = await xp(browser, 'button()')
    report.check('Export unavailable without an image', button.disabled === 'true' && button.text === 'Export' && button.title === 'Export — no image open', json(button))

    // An HMI pump and valve on a flat background.
    await openWithAnswer(browser, fixture('trim-pump.png'))
    const opened = await edges(browser, 'document()')
    button = await xp(browser, 'button()')
    report.check('Export available, naming the file', button.disabled === 'false' && button.title === 'Export as PNG: trim-pump-cleaned.png', json(button))
    report.check('No "Unexported edits" note for an unedited image', (await xp(browser, 'note()')) === null)

    // Magic Wand on the background, real Delete key.
    await select(browser, [{ x: 2, y: 2, tolerance: 20 }])
    const selected = (await edges(browser, 'selection()'))?.count ?? 0
    report.check('Magic Wand selects the background', selected > 1000, `${selected} px`)
    await browser.press('Delete')
    await settle(browser)
    const afterDelete = await edges(browser, 'document()')
    report.check('Delete makes the background transparent, same size', afterDelete.revision !== opened.revision && afterDelete.width === opened.width && afterDelete.height === opened.height)
    report.check('"Unexported edits" note after Delete', (await xp(browser, 'note()')) === 'Unexported edits')

    // Export (in Chrome also downloaded for real into the temporary folder).
    if (downloads) await xp(browser, 'setPassThrough(true)')
    const first = await exportAndCheck(browser, 'Export after Delete', 'trim-pump-cleaned.png')
    if (downloads) {
      await xp(browser, 'setPassThrough(false)')
      const file = path.join(downloads, 'trim-pump-cleaned.png')
      await waitFor(() => fs.existsSync(file) && fs.statSync(file).size === first.info.size, { what: 'the real download', timeout: 20000 }).catch(() => {})
      const saved = fs.existsSync(file) ? fs.readFileSync(file) : null
      const captured = Buffer.from(await xp(browser, `bytes(${first.index})`), 'base64')
      report.check('Chrome downloads the file under its suggested name, byte for byte', !!saved && saved.equals(captured), saved ? `${saved.length} bytes` : `not found in ${downloads}: ${fs.readdirSync(downloads).join(', ')}`)
    }
    report.check('Deleted background exported fully transparent, hidden colour dropped', first.result.transparent >= selected && first.result.hiddenColour >= selected)
    report.check('"Unexported edits" note gone after Export', (await xp(browser, 'note()')) === null)
    report.check('Export announced', (await edit(browser, 'announcement()')) === 'Exported as trim-pump-cleaned.png.', await edit(browser, 'announcement()'))
    report.check('The link is removed from the page after the download starts', (await ev(browser, 'document.querySelectorAll("a[download]").length')) === 0)

    // Undo, Redo and the note. Undoing to the opened image leaves nothing to lose; redoing returns
    // to the exported image.
    await browser.press('z', { ctrl: true })
    await settle(browser)
    report.check('Ctrl + Z back to the opened image: no unexported edits', (await xp(browser, 'note()')) === null)
    await browser.press('y', { ctrl: true })
    await settle(browser)
    report.check('Ctrl + Y back to the exported image: no unexported edits', (await xp(browser, 'note()')) === null)
    // Exporting the opened image after Undo makes it the last export; Redo then differs from it.
    await browser.press('z', { ctrl: true })
    await settle(browser)
    const undone = await exportAndCheck(browser, 'Export after Undo', 'trim-pump-cleaned.png')
    report.check('Export after Undo is the opened image', Buffer.from(bytesOf(undone.document.pixels)).equals(Buffer.from(bytesOf(opened.pixels))))
    await browser.press('y', { ctrl: true })
    await settle(browser)
    report.check('Ctrl + Y after exporting the opened image: unexported edits', (await xp(browser, 'note()')) === 'Unexported edits')
    const redone = await exportAndCheck(browser, 'Export after Redo', 'trim-pump-cleaned.png')
    report.check('Export after Redo is the deleted image', redone.document.pixels === first.document.pixels)

    // Auto Trim with the default 5 px padding.
    const tool = await edit(browser, 'button("Auto Trim")')
    await browser.click(tool.x, tool.y)
    await settle(browser)
    const trim = await edit(browser, 'button("Trim")')
    await browser.click(trim.x, trim.y)
    await settle(browser)
    const trimmed = await edges(browser, 'document()')
    report.check('Auto Trim makes the image smaller', trimmed.width < opened.width && trimmed.height < opened.height, `${trimmed.width} × ${trimmed.height}`)
    report.check('"Unexported edits" note after Auto Trim', (await xp(browser, 'note()')) === 'Unexported edits')
    await exportAndCheck(browser, 'Export after Auto Trim', 'trim-pump-cleaned.png')

    // Exported: another image opens without asking.
    report.check('No confirmation when the exported image is replaced', (await openWithAnswer(browser, fixture('edge-alpha.png'))) === 'opened')

    // Partially transparent pixels are written exactly; a canvas encoder would change some.
    const alpha = await exportAndCheck(browser, 'Partially transparent PNG', 'edge-alpha-cleaned.png')
    const canvas = compare(decodePng(Buffer.from(await xp(browser, 'canvasEncoded()'), 'base64')), alpha.document)
    report.note(`  (for comparison, this browser's canvas encoder (putImageData + convertToBlob) changes ${canvas.wrong} of ${canvas.partial} partially transparent pixels of this image; Export changes ${alpha.result.wrong})`)

    // A feathered Delete: partial alpha made by the app, written exactly.
    await dispatch(browser, { type: 'tool-selected', tool: 'magic-wand' })
    await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup: 1, feather: 2 } })
    await settle(browser)
    await openWithAnswer(browser, fixture('edge-hmi.png'))
    await select(browser, [{ x: 3, y: 3, tolerance: 12 }])
    await browser.press('Delete')
    await settle(browser)
    const feathered = await exportAndCheck(browser, 'Export after a feathered Delete', 'edge-hmi-cleaned.png')
    report.check('The feathered Delete left partially transparent pixels to check', feathered.result.partial > 0, `${feathered.result.partial}`)
    await dispatch(browser, { type: 'edge-settings-changed', settings: { cleanup: 0, feather: 0 } })

    // Unexported edits are asked about; exported ones are not.
    await select(browser, [{ x: 3, y: 3, tolerance: 40 }])
    await browser.press('Delete')
    await settle(browser)
    report.check('Unexported edits: the replace confirmation is asked', (await openWithAnswer(browser, fixture('trim-pump.png'), 'cancel')) === 'cancelled')

    // A failed export changes nothing and says so.
    const beforeFailure = await edges(browser, 'document()')
    const count = await xp(browser, 'count()')
    await xp(browser, 'failNextExport()')
    button = await xp(browser, 'button()')
    await browser.click(button.x, button.y)
    await waitFor(() => edit(browser, 'alert()'), { what: 'the export error' })
    report.check(
      'Failed export: message shown, nothing downloaded, image unchanged',
      (await edit(browser, 'alert()')) === 'The image could not be exported. Nothing was downloaded, and the image has not changed.' &&
        (await xp(browser, 'count()')) === count &&
        (await edges(browser, 'document()')).revision === beforeFailure.revision,
      await edit(browser, 'alert()'),
    )
    report.check('Export available again after the failure, edits still unexported', (await xp(browser, 'button()')).disabled === 'false' && (await xp(browser, 'note()')) === 'Unexported edits')

    if (!values["no-perf"]) await timeExports(browser)

    const messages = await edit(browser, 'consoleMessages()')
    report.check('No console errors or warnings', messages.length === 0, messages.join(' | '))
  } finally {
    await browser.close()
    if (downloads) fs.rmSync(downloads, { recursive: true, force: true })
  }
}

/** Export times and the longest frame gap meanwhile, at 4K and near 50 MP; exactness checked in the page. */
async function timeExports(browser) {
  const sizes = values['no-stress'] ? ['4k'] : ['4k', '50mp']
  for (const size of sizes) {
    for (const [fileName, click] of [
      [`edge-hmi-${size}.png`, { x: 3, y: 3, tolerance: 12 }],
      [`trim-photo-${size}.png`, null],
    ]) {
      await openWithAnswer(browser, fixture(fileName), 'continue', { timeout: 120000 })
      if (click) {
        await select(browser, [click])
        await browser.press('Delete')
        await settle(browser)
      }
      const before = await xp(browser, 'count()')
      await xp(browser, 'watchFrames()')
      const button = await xp(browser, 'button()')
      const start = Date.now()
      await browser.click(button.x, button.y)
      // A second click while the file is written does nothing.
      await sleep(30)
      const busy = await xp(browser, 'button()')
      await browser.click(button.x, button.y)
      await waitFor(() => xp(browser, `has(${before})`), { timeout: 300000, what: 'the exported file' })
      const elapsed = Date.now() - start
      const frames = await xp(browser, 'stopFrames()')
      await sleep(100)
      const decoded = await xp(browser, `browserDecode(${before})`)
      const info = await xp(browser, `info(${before})`)
      report.check(
        `${fileName}: exported once, exact (browser decode), "Exporting…" while written`,
        (await xp(browser, 'count()')) === before + 1 && decoded.sameSize && decoded.opaqueWrong === 0 && decoded.transparentWrong === 0 && decoded.partial === 0 && (busy.text === 'Exporting…' || elapsed < 200),
        `${json(decoded)}, label ${busy.text}`,
      )
      report.note(`  ${fileName}${click ? ' (background deleted)' : ''}: ${elapsed} ms to the download, ${(info.size / 1e6).toFixed(2)} MB, longest frame gap ${frames.longest.toFixed(0)} ms over ${frames.frames} frames`)
    }
  }
}

await ensureEditFixtures()
await ensureEdgeFixtures()
await ensureTrimFixtures()
const server = await serveBuild()
try {
  for (const name of browsers) await run(name, server.url)
} finally {
  await server.close()
}
report.finish()
