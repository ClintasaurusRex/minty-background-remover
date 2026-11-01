import { copyPixelData, createPixelBuffer, validatePixelBuffer } from '../../image/pixelBuffer'
import type { PixelBuffer, Rectangle } from '../types'
import { validateDimensions, validateRectangleWithin } from './geometry'
import { WordRunDecoder, WordRunEncoder, type WordRuns, pixelWords, validateWordRuns } from './wordRuns'

/*
 * Pixel patches: the difference between two states of an image of the same size, for Undo
 * and Redo of edits such as Delete Selection.
 *
 * A patch stores, for every pixel of a region, the old pixel value XOR the new one, run-length
 * encoded (wordRuns.ts): unchanged pixels are zeros, and the many pixels an edit changes the
 * same way (Delete on an opaque background) form one run. XOR is its own inverse, so one patch
 * serves both directions: applied to the edited pixels it gives the pixels before the edit,
 * and applied to those it gives the edited pixels again. Every byte is restored exactly,
 * including the colour hidden under alpha 0.
 *
 * Patches do not refer to documents or revisions: Undo and Redo apply them to the current
 * pixels and make a new revision from the result (IMAGE_PROCESSING_SPEC.md, Pixel Buffers and
 * Revisions). A patch is never modified once created.
 */

export interface PixelPatch {
  readonly kind: 'pixel-patch'
  /** Size of the image; the patch applies only to pixels of this size. */
  readonly width: number
  readonly height: number
  /** The rectangle the patch covers. Pixels outside it are never changed. */
  readonly region: Readonly<Rectangle>
  /** Number of pixels that differ between the two states. At least 1. */
  readonly changedPixels: number
  /** Old XOR new for every pixel of `region`, row by row. */
  readonly changes: WordRuns
}

/**
 * The patch between `before` and `after`, two states of the same image, or null when they are
 * identical. Only `region` is compared and stored; by default the whole image. The caller
 * guarantees that no pixel outside `region` differs, for example by passing the bounds a
 * Delete Selection result reports.
 *
 * Reads both buffers once over the region and writes neither. The patch's memory is its
 * encoded size: about 4 bytes per changed pixel at worst, a few bytes per row for a typical
 * Delete Selection (IMAGE_PROCESSING_SPEC.md, History / Undo).
 *
 * Throws a RangeError for an invalid buffer, buffers of different sizes, or a region that
 * does not lie within the image.
 */
export function createPixelPatch(
  before: PixelBuffer,
  after: PixelBuffer,
  region?: Readonly<Rectangle>,
): PixelPatch | null {
  validatePixelBuffer(before)
  validatePixelBuffer(after)
  const { width, height } = before
  if (after.width !== width || after.height !== height) {
    throw new RangeError(`Cannot compare a ${width} × ${height} image with a ${after.width} × ${after.height} one`)
  }
  const area: Rectangle = region
    ? { x: region.x, y: region.y, width: region.width, height: region.height }
    : { x: 0, y: 0, width, height }
  validateRectangleWithin(area, width, height, 'Patch region')

  const oldWords = pixelWords(before.data)
  const newWords = pixelWords(after.data)
  const encoder = new WordRunEncoder(area.width * area.height)
  if (area.width === width) {
    // Whole rows are contiguous in memory: one segment.
    encoder.pushXor(oldWords, newWords, area.y * width, (area.y + area.height) * width)
  } else {
    for (let y = area.y; y < area.y + area.height; y++) {
      const start = y * width + area.x
      encoder.pushXor(oldWords, newWords, start, start + area.width)
    }
  }
  const changes = encoder.finish()
  if (encoder.nonZero === 0) return null
  return { kind: 'pixel-patch', width, height, region: area, changedPixels: encoder.nonZero, changes }
}

/**
 * `pixels` with `patch` applied, as new memory: one copy of `pixels`, then the region's
 * changes. Applied to either state the patch was made from, it gives the other one exactly.
 * Applied to any other pixels of the same size the result is meaningless, so the caller must
 * keep track of which state the patch belongs to.
 *
 * `pixels` and `patch` are never written. Throws a RangeError for an invalid buffer, pixels
 * of another size than the patch's image, or a malformed patch; nothing is copied then.
 */
export function applyPixelPatch(pixels: PixelBuffer, patch: PixelPatch): PixelBuffer {
  validatePixelBuffer(pixels)
  validatePixelPatch(patch)
  const { width, height } = patch
  if (pixels.width !== width || pixels.height !== height) {
    throw new RangeError(`A patch for a ${width} × ${height} image cannot apply to a ${pixels.width} × ${pixels.height} one`)
  }

  const data = copyPixelData(pixels)
  const words = pixelWords(data)
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new WordRunDecoder(patch.changes)
  const { region } = patch
  if (region.width === width) {
    decoder.xorInto(words, bytes, region.y * width, region.height * width)
  } else {
    for (let y = region.y; y < region.y + region.height; y++) {
      decoder.xorInto(words, bytes, y * width + region.x, region.width)
    }
  }
  return createPixelBuffer(width, height, data)
}

/** Throws a RangeError unless `patch` is well formed. Reads the run tokens, not the pixel values. */
function validatePixelPatch(patch: PixelPatch): void {
  if (patch.kind !== 'pixel-patch') throw new RangeError(`Not a pixel patch: ${String(patch.kind)}`)
  validateDimensions(patch.width, patch.height, 'patch image')
  validateRectangleWithin(patch.region, patch.width, patch.height, 'Patch region')
  const area = patch.region.width * patch.region.height
  if (!Number.isSafeInteger(patch.changedPixels) || patch.changedPixels < 1 || patch.changedPixels > area) {
    throw new RangeError(`Invalid changed pixel count ${patch.changedPixels} for a region of ${area} pixels`)
  }
  validateWordRuns(patch.changes, area)
}
