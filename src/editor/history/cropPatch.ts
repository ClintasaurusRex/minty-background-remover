import { createPixelBuffer, validatePixelBuffer } from '../../image/pixelBuffer'
import type { PixelBuffer, Rectangle } from '../types'
import { validateDimensions, validateRectangleWithin } from './geometry'
import { WordRunDecoder, WordRunEncoder, type WordRuns, pixelWords, validateWordRuns } from './wordRuns'

/*
 * Crop patches: what a crop to a smaller rectangle (Auto Trim) removes, so that Undo can
 * rebuild the image before it exactly.
 *
 * The patch keeps the original size, the rectangle kept, and every removed pixel: the pixels
 * outside the kept rectangle in row order (the rows above it, then each kept row's left and
 * right parts, then the rows below), so no pixel, corner or otherwise, is stored twice. They
 * are run-length encoded (wordRuns.ts) as they are, RGBA, including colour hidden under
 * alpha 0: borders of fully transparent black or of one colour take a few bytes, varied ones
 * up to 4 bytes per pixel. The kept pixels are not stored; they are the cropped image.
 *
 * Redo crops again (cropPixels with `kept`); Undo calls restoreCroppedPixels. Patches do not
 * refer to documents or revisions, and are never modified once created.
 */

export interface CropPatch {
  readonly kind: 'crop-patch'
  /** Size of the image before the crop. */
  readonly width: number
  readonly height: number
  /** The rectangle kept, in the pixels of the image before the crop; the cropped image's size. */
  readonly kept: Readonly<Rectangle>
  /** The removed pixels, row by row: (width × height − kept area) values. */
  readonly removed: WordRuns
}

/**
 * The pixels inside `kept`, as a new kept.width × kept.height image. `pixels` is not written.
 * Throws a RangeError for an invalid buffer or a rectangle not lying within the image.
 */
export function cropPixels(pixels: PixelBuffer, kept: Readonly<Rectangle>): PixelBuffer {
  validatePixelBuffer(pixels)
  validateRectangleWithin(kept, pixels.width, pixels.height, 'Crop rectangle')
  const { width } = pixels
  const source = pixels.data
  const rowBytes = kept.width * 4
  const data = new Uint8ClampedArray(rowBytes * kept.height)
  for (let row = 0; row < kept.height; row++) {
    const from = ((kept.y + row) * width + kept.x) * 4
    data.set(source.subarray(from, from + rowBytes), row * rowBytes)
  }
  return createPixelBuffer(kept.width, kept.height, data)
}

/**
 * What cropping `original` to `kept` removes, or null when `kept` is the whole image and
 * nothing would be removed. `original` is not written, and nothing of it is kept but the
 * encoded removed pixels.
 *
 * Throws a RangeError for an invalid buffer or a rectangle not lying within the image.
 */
export function createCropPatch(original: PixelBuffer, kept: Readonly<Rectangle>): CropPatch | null {
  validatePixelBuffer(original)
  const { width, height } = original
  const rect: Rectangle = { x: kept.x, y: kept.y, width: kept.width, height: kept.height }
  validateRectangleWithin(rect, width, height, 'Crop rectangle')
  const removedCount = width * height - rect.width * rect.height
  if (removedCount === 0) return null

  const words = pixelWords(original.data)
  const encoder = new WordRunEncoder(removedCount)
  const below = rect.y + rect.height
  const right = rect.x + rect.width
  encoder.pushWords(words, 0, rect.y * width)
  for (let y = rect.y; y < below; y++) {
    const rowStart = y * width
    encoder.pushWords(words, rowStart, rowStart + rect.x)
    encoder.pushWords(words, rowStart + right, rowStart + width)
  }
  encoder.pushWords(words, below * width, height * width)
  return { kind: 'crop-patch', width, height, kept: rect, removed: encoder.finish() }
}

/**
 * The image before the crop: `cropped` (the kept pixels) put back in place inside the removed
 * pixels from `patch`, as new memory. Exact, byte for byte. `cropped` and `patch` are never
 * written.
 *
 * Throws a RangeError for an invalid buffer, a cropped image whose size is not the kept
 * rectangle's, or a malformed patch; nothing is allocated then.
 */
export function restoreCroppedPixels(cropped: PixelBuffer, patch: CropPatch): PixelBuffer {
  validatePixelBuffer(cropped)
  validateCropPatch(patch)
  const { width, height, kept } = patch
  if (cropped.width !== kept.width || cropped.height !== kept.height) {
    throw new RangeError(
      `The patch keeps ${kept.width} × ${kept.height} pixels; the cropped image is ${cropped.width} × ${cropped.height}`,
    )
  }

  // New memory is zero, which the decoder relies on for runs of zeros.
  const data = new Uint8ClampedArray(width * height * 4)
  const words = pixelWords(data)
  const bytes = new Uint8Array(data.buffer)
  const decoder = new WordRunDecoder(patch.removed)
  const source = cropped.data
  const rowBytes = kept.width * 4
  const below = kept.y + kept.height
  const right = kept.x + kept.width
  decoder.writeInto(words, bytes, 0, kept.y * width)
  for (let y = kept.y; y < below; y++) {
    const rowStart = y * width
    decoder.writeInto(words, bytes, rowStart, kept.x)
    const from = (y - kept.y) * rowBytes
    data.set(source.subarray(from, from + rowBytes), (rowStart + kept.x) * 4)
    decoder.writeInto(words, bytes, rowStart + right, width - right)
  }
  decoder.writeInto(words, bytes, below * width, (height - below) * width)
  return createPixelBuffer(width, height, data)
}

/** Throws a RangeError unless `patch` is well formed. Reads the run tokens, not the pixel values. */
function validateCropPatch(patch: CropPatch): void {
  if (patch.kind !== 'crop-patch') throw new RangeError(`Not a crop patch: ${String(patch.kind)}`)
  validateDimensions(patch.width, patch.height, 'crop patch image')
  validateRectangleWithin(patch.kept, patch.width, patch.height, 'Kept rectangle')
  const removedCount = patch.width * patch.height - patch.kept.width * patch.kept.height
  if (removedCount === 0) throw new RangeError('A crop patch must remove at least one pixel')
  validateWordRuns(patch.removed, removedCount)
}
