import { describe, expect, it } from 'vitest'
import { fakeImageData } from '../image/import/testFixtures'
import { copyPixelData, createPixelBuffer } from '../image/pixelBuffer'
import { createEditedDocument, createImageDocument } from './imageDocument'
import type { ImageDocument, PixelBuffer } from './types'

const input = { name: 'a.png', format: 'png', source: 'file-picker', fileSizeBytes: 123 } as const

describe('createImageDocument', () => {
  it('takes its dimensions from the pixel buffer', () => {
    const pixels = fakeImageData(3840, 2160)
    const document = createImageDocument({ ...input, pixels })
    expect(document).toMatchObject({ ...input, width: 3840, height: 2160, revision: 0 })
    expect(document.pixels).toBe(pixels)
  })

  it('assigns increasing ids', () => {
    const a = createImageDocument({ ...input, pixels: fakeImageData(1, 1) })
    const b = createImageDocument({ ...input, pixels: fakeImageData(1, 1) })
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('rejects invalid dimensions and incomplete buffers', () => {
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(0, 1, 0) })).toThrow(RangeError)
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(2, 2, 15) })).toThrow(RangeError)
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(2, 2, 17) })).toThrow(RangeError)
  })

  it('rejects a buffer that does not start on a 4-byte boundary', () => {
    const data = new Uint8ClampedArray(new ArrayBuffer(20), 1, 16)
    expect(() => createImageDocument({ ...input, pixels: { width: 2, height: 2, data } })).toThrow(RangeError)
  })
})

function opened(width = 3, height = 2): ImageDocument {
  const pixels = fakeImageData(width, height)
  for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = (i * 13) & 255
  return createImageDocument({ ...input, pixels })
}

/** New pixels for `document`, made the way an edit makes them: a copy, then changed. */
function editedPixels(document: ImageDocument): PixelBuffer {
  const data = copyPixelData(document.pixels)
  for (let i = 3; i < data.length; i += 4) data[i] = 0
  return createPixelBuffer(document.width, document.height, data)
}

/** A copy of an earlier revision's pixels, as Undo or Redo will restore them. */
function restoredPixels(earlier: ImageDocument): PixelBuffer {
  return createPixelBuffer(earlier.width, earlier.height, copyPixelData(earlier.pixels))
}

describe('createEditedDocument', () => {
  it('keeps the image identity and metadata, with the new pixels and a new revision', () => {
    const document = opened()
    const pixels = editedPixels(document)
    const edited = createEditedDocument(document, pixels)
    expect(edited).toEqual({ ...document, pixels, revision: edited.revision })
    expect(edited).toMatchObject({ id: document.id, ...input, width: 3, height: 2 })
    expect(edited.revision).toBeGreaterThan(document.revision)
    // Owned, not copied.
    expect(edited.pixels).toBe(pixels)
  })

  it('takes its dimensions from the new pixels, which may change size', () => {
    const document = opened(3, 2)
    const trimmed = createEditedDocument(document, createPixelBuffer(1, 2, new Uint8ClampedArray(8)))
    expect(trimmed).toMatchObject({ width: 1, height: 2 })
    const untrimmed = createEditedDocument(trimmed, restoredPixels(document))
    expect(untrimmed).toMatchObject({ width: 3, height: 2 })
  })

  it('leaves the previous document and its pixels unchanged', () => {
    const document = opened()
    const fields = { ...document }
    const bytes = Array.from(document.pixels.data)
    createEditedDocument(document, editedPixels(document))
    createEditedDocument(document, editedPixels(document))
    expect(document).toEqual(fields)
    expect(document.pixels).toBe(fields.pixels)
    expect(Array.from(document.pixels.data)).toEqual(bytes)
  })

  it('gives every new content state a revision never given before, in increasing order', () => {
    let a = opened()
    let b = opened()
    const revisions: number[] = []
    for (let i = 0; i < 6; i++) {
      // Interleaved edits of two images still never share a revision.
      a = createEditedDocument(a, editedPixels(a))
      b = createEditedDocument(b, editedPixels(b))
      revisions.push(a.revision, b.revision)
    }
    expect(new Set(revisions).size).toBe(revisions.length)
    expect([...revisions].sort((x, y) => x - y)).toEqual(revisions)
    expect(revisions[0]).toBeGreaterThan(0)
  })

  it('gives a new revision even when the pixels return to an earlier state (Undo, Redo)', () => {
    const original = opened()
    const edited = createEditedDocument(original, editedPixels(original))
    const undone = createEditedDocument(edited, restoredPixels(original))
    const redone = createEditedDocument(undone, restoredPixels(edited))
    expect(Array.from(undone.pixels.data)).toEqual(Array.from(original.pixels.data))
    expect(Array.from(redone.pixels.data)).toEqual(Array.from(edited.pixels.data))
    expect(undone.revision).toBeGreaterThan(edited.revision)
    expect(redone.revision).toBeGreaterThan(undone.revision)
    expect(new Set([original.revision, edited.revision, undone.revision, redone.revision]).size).toBe(4)
    expect(new Set([original.id, edited.id, undone.id, redone.id]).size).toBe(1)
  })

  it('rejects pixels that share memory with the current pixels (copy-on-write)', () => {
    const document = opened()
    const { data } = document.pixels
    const before = { ...document }
    expect(() => createEditedDocument(document, document.pixels)).toThrow(/share memory/)
    expect(() => createEditedDocument(document, { width: 3, height: 2, data })).toThrow(/share memory/)
    expect(() => createEditedDocument(document, { width: 1, height: 1, data: data.subarray(0, 4) })).toThrow(/share memory/)
    expect(document).toEqual(before)
  })

  it('rejects only memory shared with the current pixels; never-written earlier pixels may be shared', () => {
    const original = opened()
    const edited = createEditedDocument(original, editedPixels(original))
    expect(() => createEditedDocument(edited, edited.pixels)).toThrow(/share memory/)
    // Buffers are never written once owned, so sharing an earlier revision's is safe.
    const undone = createEditedDocument(edited, original.pixels)
    expect(undone.pixels).toBe(original.pixels)
    expect(undone.revision).toBeGreaterThan(edited.revision)
  })

  it('rejects incomplete pixel buffers', () => {
    const document = opened()
    expect(() => createEditedDocument(document, { width: 3, height: 2, data: new Uint8ClampedArray(23) })).toThrow(RangeError)
    expect(() => createEditedDocument(document, { width: 0, height: 2, data: new Uint8ClampedArray(0) })).toThrow(RangeError)
    expect(() => createEditedDocument(document, { width: 3, height: 2.5, data: new Uint8ClampedArray(30) })).toThrow(RangeError)
  })

  it('takes a 50 MP buffer without copying it', () => {
    const document = opened(1, 1)
    const data = new Uint8ClampedArray(8660 * 5773 * 4)
    const edited = createEditedDocument(document, createPixelBuffer(8660, 5773, data))
    expect(edited).toMatchObject({ id: document.id, width: 8660, height: 5773 })
    expect(edited.pixels.data).toBe(data)
  })

  it('keeps pixels and documents read-only through their types', () => {
    const document = opened()
    // Never called: the checks are the expected type errors, enforced by `npm run typecheck`.
    const writes = () => {
      // @ts-expect-error A document's pixels cannot be written (copy-on-write).
      document.pixels.data[0] = 255
      // @ts-expect-error Nor can its revision be changed in place.
      document.revision = 7
    }
    expect(writes).toBeTypeOf('function')
  })
})
