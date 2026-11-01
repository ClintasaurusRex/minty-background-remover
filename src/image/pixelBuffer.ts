import type { PixelBuffer } from '../editor/types'

/*
 * Pixel buffers: validation, wrapping and copy-on-write copies (see PixelBuffer in
 * editor/types.ts). Pure and synchronous, with no canvas or ImageData, so edits run the
 * same in Node tests as in the browser.
 *
 * An edit copies the current pixels (copyPixelData), writes only to the copy, and wraps the
 * result (createPixelBuffer) for a new document revision (createEditedDocument). Copying is
 * proportional to the image, about 15 ms at 4K and 70 ms at 50 MP, so it runs in commands,
 * never in the editor reducer.
 */

/**
 * Throws a RangeError unless `pixels` is a complete RGBA image: width and height whole
 * numbers of at least 1, and `data` exactly width × height × 4 bytes starting on a 4-byte
 * boundary. A detached buffer has no bytes, so it is rejected.
 *
 * Constant time: only sizes are checked, never pixel values.
 */
export function validatePixelBuffer(pixels: PixelBuffer): void {
  const { width, height, data } = pixels
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid pixel dimensions: ${width} × ${height}`)
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(
      `Pixel buffer has ${data.length} bytes; expected ${width * height * 4} for ${width} × ${height} RGBA`,
    )
  }
  if (data.byteOffset % 4 !== 0) {
    throw new RangeError(`Pixel buffer starts at byte ${data.byteOffset}, not on a 4-byte boundary`)
  }
}

/**
 * Wraps `data` as a width × height pixel buffer, without copying. The buffer takes
 * ownership: the caller must not write to `data` afterwards.
 *
 * Throws a RangeError if the sizes do not form a complete RGBA image (validatePixelBuffer).
 */
export function createPixelBuffer(width: number, height: number, data: Uint8ClampedArray<ArrayBuffer>): PixelBuffer {
  const pixels: PixelBuffer = { width, height, data }
  validatePixelBuffer(pixels)
  return pixels
}

/**
 * A writable copy of `source`'s bytes in new memory, the starting point of a same-size edit.
 * `source` is not changed, and later writes to the copy never reach it.
 */
export function copyPixelData(source: PixelBuffer): Uint8ClampedArray<ArrayBuffer> {
  return source.data.slice()
}

/** Whether two pixel buffers use any of the same memory, so that writing one could change the other. */
export function sharesPixelMemory(a: PixelBuffer, b: PixelBuffer): boolean {
  return a.data.buffer === b.data.buffer
}
