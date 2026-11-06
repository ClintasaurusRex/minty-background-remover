// Page helpers for the editing checks (edit-workflow.mjs), installed after PAGE_HELPERS as
// window.__mintyEdit. They read the editor state through window.__minty.
import fs from 'node:fs'
import path from 'node:path'
import { waitFor } from './browsers.mjs'

export const EDIT_HELPERS = `(() => {
  const m = window.__minty
  if (!m) return false
  const imageCanvas = () => document.querySelector('canvas.workspace__canvas')

  // Every bitmap the app creates (display images and import bitmaps), to count those still live,
  // and how long display-image creation and image drawing take.
  const images = []
  const timing = { put: 0, transfer: 0, draw: 0 }
  let failTransfers = 0
  const transfer = OffscreenCanvas.prototype.transferToImageBitmap
  OffscreenCanvas.prototype.transferToImageBitmap = function (...args) {
    const start = performance.now()
    try {
      if (failTransfers > 0) {
        failTransfers--
        throw new DOMException('Test failure: out of memory', 'UnknownError')
      }
      const bitmap = transfer.apply(this, args)
      images.push(bitmap)
      return bitmap
    } finally {
      timing.transfer += performance.now() - start
    }
  }
  const put = OffscreenCanvasRenderingContext2D.prototype.putImageData
  OffscreenCanvasRenderingContext2D.prototype.putImageData = function (...args) {
    const start = performance.now()
    try { return put.apply(this, args) } finally { timing.put += performance.now() - start }
  }
  // Imports can be held (decoding and display bitmaps wait) to check what happens meanwhile.
  let held = null
  const createBitmap = window.createImageBitmap
  window.createImageBitmap = async function (...args) {
    if (held) await held.promise
    const bitmap = await createBitmap.apply(this, args)
    images.push(bitmap)
    return bitmap
  }
  const drawImage = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas !== imageCanvas()) return drawImage.apply(this, args)
    const start = performance.now()
    try { return drawImage.apply(this, args) } finally { timing.draw += performance.now() - start }
  }

  // Console errors and warnings (React reports misuse there, for example of flushSync). The app's
  // own development logs of import and edit failures are expected.
  const consoleMessages = []
  for (const level of ['error', 'warn']) {
    const original = console[level]
    console[level] = (...args) => {
      const text = args.map(String).join(' ')
      if (!/^(Import|Edit) failed \\(/.test(text)) consoleMessages.push(level + ': ' + text.slice(0, 300))
      return original.apply(console, args)
    }
  }

  // Default-prevented state of every keydown, read after the app's own listeners ran.
  let lastKey = null
  addEventListener('keydown', (event) => { lastKey = { key: event.key, prevented: event.defaultPrevented, repeat: event.repeat } })

  const copy = (array) => (array ? new Uint8Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength)) : null)
  const equalBytes = (a, b) => {
    if (!a || !b) return a === b
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  const hash = (array) => {
    if (!array) return null
    let h = 0x811c9dc5
    for (let i = 0; i < array.length; i++) h = Math.imul(h ^ array[i], 16777619)
    return h >>> 0
  }
  const saved = {}
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

  window.__mintyEdit = {
    /** Remembers the document pixels, selection and Magic Wand click as they are now. */
    save(name) {
      const s = m.state()
      saved[name] = {
        pixels: copy(s.document.pixels.data),
        selection: copy(s.selection?.data),
        base: copy(s.lastMagicWandOperation?.base?.data),
        operation: s.lastMagicWandOperation && { seed: s.lastMagicWandOperation.seed, mode: s.lastMagicWandOperation.selectionMode, flood: s.lastMagicWandOperation.floodMode, tolerance: s.lastMagicWandOperation.tolerance },
        revision: s.document.revision,
      }
      return { selected: s.selection?.count ?? 0, revision: s.document.revision }
    },
    forget(name) { delete saved[name]; return true },

    /** The document against saved[name] after Delete of saved[name]'s selection. */
    deleteCheck(name) {
      const before = saved[name], s = m.state(), now = s.document.pixels.data, sel = before.selection
      const result = { deleted: 0, alreadyTransparent: 0, kept: 0, wrong: 0, first: null, size: [s.document.width, s.document.height] }
      for (let p = 0, i = 0; i < now.length; p++, i += 4) {
        const selected = sel && sel[p] === 1, alpha = before.pixels[i + 3]
        const expectA = selected ? 0 : alpha
        const ok = now[i] === before.pixels[i] && now[i + 1] === before.pixels[i + 1] && now[i + 2] === before.pixels[i + 2] && now[i + 3] === expectA
        if (!ok) { result.wrong++; result.first ??= { p, before: [...before.pixels.subarray(i, i + 4)], now: [...now.subarray(i, i + 4)], selected } }
        else if (selected && alpha > 0) result.deleted++
        else if (selected) result.alreadyTransparent++
        else result.kept++
      }
      return result
    },
    samePixels: (name) => equalBytes(copy(m.state().document.pixels.data), saved[name].pixels),
    sameSelection: (name) => equalBytes(copy(m.state().selection?.data), saved[name].selection),
    sameBase: (name) => equalBytes(copy(m.state().lastMagicWandOperation?.base?.data), saved[name].base),
    savedOperation: (name) => saved[name].operation,
    selectionHash: () => hash(m.state().selection?.data),
    pixelsHash: () => hash(m.state().document.pixels.data),

    /** Bitmaps the app created that are not released, and whether the current one is among them. */
    liveImages() {
      const current = m.state().documentBitmap
      const live = images.filter((image) => image.width > 0)
      return { live: live.length, created: images.length, currentLive: !!current && current.width > 0 && live.includes(current) }
    },
    failNextTransfers(count) { failTransfers = count; return true },
    holdImports() {
      let release
      held = { promise: new Promise((resolve) => (release = resolve)), release }
      return true
    },
    releaseImports() { held?.release(); held = null; return true },

    summary() {
      const s = m.state()
      return {
        revision: s.document?.revision ?? null,
        id: s.document?.id ?? null,
        size: s.document ? [s.document.width, s.document.height] : null,
        selected: s.selection?.count ?? 0,
        operation: s.lastMagicWandOperation && { mode: s.lastMagicWandOperation.selectionMode, tolerance: s.lastMagicWandOperation.tolerance, bound: s.lastMagicWandOperation.version.revision === s.document.revision },
        undo: s.history.undo.length,
        redo: s.history.redo.length,
        bytes: s.history.retainedBytes,
        depth: s.editDepth,
        viewport: s.viewport && { zoom: s.viewport.zoom, x: s.viewport.offset.x, y: s.viewport.offset.y },
        importing: s.pendingImportId !== null,
        importError: s.importError?.code ?? null,
        editError: s.editError?.operation ?? null,
      }
    },

    /** Commits a tolerance as assistive technology sets a slider: value, then a change event. */
    commitTolerance(value) {
      const slider = document.querySelector('input[type=range]')
      slider.value = String(value)
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      return m.state().magicWand.tolerance
    },

    /** A key press dispatched in the page (not real input): timed, since edits complete synchronously. */
    async timeKey(key, { ctrl = false, shift = false } = {}) {
      timing.put = timing.transfer = timing.draw = 0
      const before = m.state().document.revision
      const start = performance.now()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, shiftKey: shift, bubbles: true, cancelable: true }))
      const total = performance.now() - start
      await frame()
      const framed = performance.now() - start
      return { total, framed, put: timing.put, transfer: timing.transfer, draw: timing.draw, changed: m.state().document.revision !== before }
    },
    lastKey: () => lastKey,
    consoleMessages: () => consoleMessages,

    /** The visually hidden edit announcement, the edit error message and the dialog, as shown. */
    announcement: () => document.querySelector('.workspace > .visually-hidden[role=status]')?.textContent ?? null,
    alert: () => document.querySelector('.workspace-message--error[role=alert] .workspace-message__text')?.textContent ?? null,
    dialog() {
      const dialogs = document.querySelectorAll('dialog')
      const open = document.querySelector('dialog[open]')
      return { count: dialogs.length, open: !!open, modal: !!open && open.matches(':modal'), text: open?.textContent ?? null, focus: document.activeElement?.textContent ?? document.activeElement?.tagName }
    },
    activeElement: () => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent ?? '', label: document.activeElement?.getAttribute('aria-label') }),

    /** The client centre and state of the button whose text or accessible name is \`name\`. */
    button(name) {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name || b.getAttribute('aria-label') === name)
      if (!button) return null
      const r = button.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: button.getAttribute('aria-disabled'), name: button.textContent.trim(), title: button.title }
    },
    historyButtons() {
      const read = (index) => {
        const b = document.querySelectorAll('.app-header__actions .button--icon')[index]
        return { name: b.textContent.trim(), disabled: b.getAttribute('aria-disabled'), title: b.title }
      }
      return { undo: read(0), redo: read(1) }
    },

    /**
     * A file from base64 bytes, pasted or dropped as the browser would deliver it. The transfer is
     * set on the event itself as well: Firefox's event constructors give synthetic events an empty
     * DataTransfer of their own.
     */
    paste(base64, name, type) {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      document.body.dispatchEvent(event)
      return true
    },
    drop(base64, name, type) {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type }))
      const workspace = document.querySelector('main.workspace')
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const event = new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: transfer })
        workspace.dispatchEvent(event)
      }
      return true
    },
  }
  return true
})()`

/** Base64 of a file, for paste() and drop(). */
export const fileBase64 = (file) => fs.readFileSync(file).toString('base64')

/**
 * Opens `file` with the file input. If the replace confirmation appears, `answer` ('continue' or
 * 'cancel') is clicked. Resolves to what happened: 'opened', 'asked-and-opened', 'cancelled'.
 */
export async function openWithAnswer(browser, file, answer = 'continue', { timeout = 20000 } = {}) {
  const before = await browser.eval('window.__minty.state().document?.id ?? 0')
  await browser.setFile('input[type=file]', file)
  const outcome = await waitFor(
    () =>
      browser.eval(`(() => {
        const s = window.__minty.state()
        if (document.querySelector('dialog[open]')) return 'asked'
        return s.document && s.document.id !== ${before} && s.viewport && s.pendingImportId === null ? 'opened' : null
      })()`),
    { timeout, what: `${path.basename(file)} to open or the confirmation to appear` },
  )
  if (outcome === 'opened') return waitPlaced(browser).then(() => 'opened')
  const button = await browser.eval(`window.__mintyEdit.button(${JSON.stringify(answer === 'continue' ? 'Continue' : 'Cancel')})`)
  await browser.click(button.x, button.y)
  if (answer === 'cancel') {
    await waitFor(() => browser.eval('!document.querySelector("dialog[open]")'), { what: 'the dialog to close' })
    return 'cancelled'
  }
  await waitFor(
    () => browser.eval(`(() => { const s = window.__minty.state(); return s.document && s.document.id !== ${before} && s.pendingImportId === null })()`),
    { timeout, what: `${path.basename(file)} to open after Continue` },
  )
  await waitPlaced(browser)
  return 'asked-and-opened'
}

const waitPlaced = (browser) => waitFor(() => browser.eval('!window.__minty.state().placeOnNextResize'), { what: 'the image to be placed' })
