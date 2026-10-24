import type { ImageDocument, ImageFormat, ImageSource } from './types'

export interface ImageDocumentInput {
  readonly name: string
  readonly format: ImageFormat
  readonly source: ImageSource
  readonly fileSizeBytes: number
  readonly pixels: ImageData
}

let nextDocumentId = 1

/**
 * Creates a document from decoded pixels. Dimensions come from the pixel buffer
 * itself, so they cannot disagree with it.
 *
 * Throws a RangeError if the buffer is not a complete width × height RGBA image.
 */
export function createImageDocument(input: ImageDocumentInput): ImageDocument {
  const { width, height, data } = input.pixels
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid pixel dimensions: ${width} × ${height}`)
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(
      `Pixel buffer has ${data.length} bytes; expected ${width * height * 4} for ${width} × ${height} RGBA`,
    )
  }

  return {
    id: nextDocumentId++,
    name: input.name,
    format: input.format,
    source: input.source,
    fileSizeBytes: input.fileSizeBytes,
    width,
    height,
    pixels: input.pixels,
    revision: 0,
  }
}
