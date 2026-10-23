import { describe, expect, it } from 'vitest'
import { type ClipboardItemLike, clipboardFiles, installPasteHandler } from './clipboardPaste'

const fileItem = (file: File): ClipboardItemLike => ({ kind: 'file', type: file.type, getAsFile: () => file })
const stringItem = (type: string): ClipboardItemLike => ({ kind: 'string', type, getAsFile: () => null })

/** A fake element: `matches` decides whether closest() finds an editable ancestor. */
const element = (matches: boolean, isContentEditable = false) => ({
  closest: () => (matches ? {} : null),
  isContentEditable,
})

describe('clipboardFiles', () => {
  it('returns pasted image files and skips text, HTML and URLs', () => {
    const png = new File(['x'], 'image.png', { type: 'image/png' })
    const items = [stringItem('text/html'), stringItem('text/plain'), stringItem('text/uri-list'), fileItem(png)]
    expect(clipboardFiles({ items })).toEqual([png])
  })

  it('puts items the browser marks as images first', () => {
    const other = new File(['x'], 'notes.bin', { type: 'application/octet-stream' })
    const png = new File(['x'], 'image.png', { type: 'image/png' })
    expect(clipboardFiles({ items: [fileItem(other), fileItem(png)] })).toEqual([png, other])
  })

  it('falls back to DataTransfer.files', () => {
    const png = new File(['x'], 'image.png', { type: 'image/png' })
    expect(clipboardFiles({ items: [], files: [png] })).toEqual([png])
  })

  it('handles an empty or missing clipboard', () => {
    expect(clipboardFiles({ items: [] })).toEqual([])
    expect(clipboardFiles({})).toEqual([])
    expect(clipboardFiles(null)).toEqual([])
    expect(clipboardFiles({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }] })).toEqual([])
  })
})

describe('installPasteHandler', () => {
  function paste(target: EventTarget, clipboardData: unknown, eventTarget?: unknown) {
    const event = new Event('paste', { cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: clipboardData })
    if (eventTarget) Object.defineProperty(event, 'target', { value: eventTarget })
    target.dispatchEvent(event)
    return event
  }

  function setUp() {
    const target = new EventTarget()
    const calls: string[] = []
    const remove = installPasteHandler(target, {
      onFiles: (files) => calls.push(`files:${files.map((file) => file.name).join(',')}`),
      onNoImage: () => calls.push('no-image'),
    })
    return { target, calls, remove }
  }

  const png = new File(['x'], 'image.png', { type: 'image/png' })

  it('imports pasted image files and prevents the default paste', () => {
    const { target, calls } = setUp()
    const event = paste(target, { items: [fileItem(png)] })
    expect(calls).toEqual(['files:image.png'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('reports a text-only or empty clipboard without preventing the default paste', () => {
    const { target, calls } = setUp()
    expect(paste(target, { items: [stringItem('text/plain')] }).defaultPrevented).toBe(false)
    expect(paste(target, { items: [] }).defaultPrevented).toBe(false)
    expect(paste(target, null).defaultPrevented).toBe(false)
    expect(calls).toEqual(['no-image', 'no-image', 'no-image'])
  })

  it('leaves pastes into editable fields alone, even with an image on the clipboard', () => {
    const { target, calls } = setUp()
    const event = paste(target, { items: [fileItem(png)] }, element(true))
    expect(calls).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    paste(target, { items: [stringItem('text/plain')] }, element(false, true))
    expect(calls).toEqual([])
  })

  it('ignores pastes another handler has already taken', () => {
    const { target, calls } = setUp()
    const event = new Event('paste', { cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { items: [fileItem(png)] } })
    event.preventDefault()
    target.dispatchEvent(event)
    expect(calls).toEqual([])
  })

  it('stops listening once removed', () => {
    const { target, calls, remove } = setUp()
    remove()
    paste(target, { items: [fileItem(png)] })
    expect(calls).toEqual([])
  })
})
