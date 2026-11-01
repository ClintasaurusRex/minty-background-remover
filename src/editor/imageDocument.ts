import { sharesPixelMemory, validatePixelBuffer } from '../image/pixelBuffer'
import type { ImageDocument, ImageFormat, ImageSource, PixelBuffer } from './types'

export interface ImageDocumentInput {
  readonly name: string
  readonly format: ImageFormat
  readonly source: ImageSource
  readonly fileSizeBytes: number
  readonly pixels: PixelBuffer
}

let nextDocumentId = 1
/** The latest revision given out. Session-wide, so a revision is never given out twice. */
let lastRevision = 0

/**
 * Creates a document from decoded pixels, at revision 0. Dimensions come from the pixel
 * buffer itself, so they cannot disagree with it. The document takes ownership of the
 * pixels without copying them.
 *
 * Throws a RangeError if the buffer is not a complete width × height RGBA image.
 */
export function createImageDocument(input: ImageDocumentInput): ImageDocument {
  const { pixels } = input
  validatePixelBuffer(pixels)

  return {
    id: nextDocumentId++,
    name: input.name,
    format: input.format,
    source: input.source,
    fileSizeBytes: input.fileSizeBytes,
    width: pixels.width,
    height: pixels.height,
    pixels,
    revision: 0,
  }
}

/**
 * A new content state of `document` with `pixels` as its pixels: the same image (id, name,
 * format, source and file size), with dimensions taken from `pixels`, which may differ in
 * size (Auto Trim, and undoing it). `document` is not changed.
 *
 * The revision is new: never given out before in the session and larger than every earlier
 * one. This holds for every content state, including Undo and Redo, which restore earlier
 * pixels as a new revision, so work tagged with any earlier version is never accepted.
 *
 * Copy-on-write: the new document takes ownership of `pixels` without copying them, and
 * nothing may write to them afterwards. An edit writes new memory (see copyPixelData).
 * Pixels sharing memory with the document's current pixels are rejected: that is what an
 * edit made in place looks like, and it would have changed the current revision too.
 *
 * Constant time: only sizes are checked, never pixel values.
 *
 * Throws a RangeError if `pixels` is not a complete RGBA image, and an Error if it shares
 * memory with the current pixels. Nothing is changed when it throws.
 */
export function createEditedDocument(document: ImageDocument, pixels: PixelBuffer): ImageDocument {
  validatePixelBuffer(pixels)
  if (sharesPixelMemory(pixels, document.pixels)) {
    throw new Error('Edited pixels share memory with the current pixels; an edit must write a copy')
  }

  return {
    ...document,
    width: pixels.width,
    height: pixels.height,
    pixels,
    revision: ++lastRevision,
  }
}
