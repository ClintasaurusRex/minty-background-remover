import type { PixelBuffer, Rectangle, SelectionMask } from '../../editor/types'
import { copyPixelData, createPixelBuffer, validatePixelBuffer } from '../pixelBuffer'

/** What Delete Selection changed. */
export interface DeleteSelectionResult {
  /** The edited image: new memory, the same size as the input. */
  readonly pixels: PixelBuffer
  /** Pixels made transparent: selected pixels whose alpha was above 0. Always at least 1. */
  readonly count: number
  /** Smallest rectangle containing every changed pixel, in image pixels. */
  readonly bounds: Readonly<Rectangle>
}

/**
 * Delete Selection: makes every selected pixel fully transparent (alpha 0).
 *
 * - Only the alpha byte of a selected pixel is written. Its red, green and blue bytes are
 *   kept, hidden, so the change can be undone compactly; export writes fully transparent
 *   pixels as 0, 0, 0, 0 (IMAGE_PROCESSING_SPEC.md, Delete Selection).
 * - Unselected pixels keep every byte. So do selected pixels that are already fully
 *   transparent; they are not counted, and `bounds` covers only the pixels that changed.
 * - Copy-on-write: neither `pixels` nor `selection` is written. The result is new memory: one
 *   copy of `pixels` (copyPixelData), made only once a pixel that changes has been found.
 *   When nothing would change (no selection, or only fully transparent pixels selected) the
 *   result is null and nothing is allocated.
 * - Only the selection's bounds are scanned, reading the mask and the alpha bytes, and each
 *   pixel in them is visited once: up to the first change in `pixels`, after it in the copy.
 *   Apart from the copy, nothing proportional to the image is allocated.
 *
 * The same for every source format: all images are edited as 8-bit straight RGBA.
 *
 * Throws a RangeError for an invalid pixel buffer, or a selection that is not the image's
 * size or whose bounds do not lie within it.
 */
export function deleteSelectedPixels(pixels: PixelBuffer, selection: SelectionMask | null): DeleteSelectionResult | null {
  const result = deleteSelectedPixelData(pixels, selection)
  return result && { pixels: createPixelBuffer(pixels.width, pixels.height, result.data), count: result.count, bounds: result.bounds }
}

/** deleteSelectedPixels' result before it is wrapped as a pixel buffer. */
export interface DeletedPixelData {
  /**
   * The edited bytes: new memory, the input's size. Still writable, for an edit that goes on
   * changing the same copy before wrapping it (deleteWithEdges.ts); nothing else may write it.
   */
  readonly data: Uint8ClampedArray<ArrayBuffer>
  readonly count: number
  readonly bounds: Readonly<Rectangle>
}

/**
 * deleteSelectedPixels, returning the edited bytes unwrapped so that edge cleanup and feathering
 * can continue on the same copy (Phase 3 Step 8) instead of copying the image again. Identical
 * in every other respect: the same checks, the same single copy, the same bytes, count and bounds.
 */
export function deleteSelectedPixelData(pixels: PixelBuffer, selection: SelectionMask | null): DeletedPixelData | null {
  validatePixelBuffer(pixels)
  if (!selection) return null
  validateSelectionFits(selection, pixels)

  const { width } = pixels
  const mask = selection.data
  const left = selection.bounds.x
  const right = left + selection.bounds.width
  const top = selection.bounds.y
  const bottom = top + selection.bounds.height

  const first = firstChangedPixel(pixels.data, mask, width, left, right, top, bottom)
  if (first < 0) return null

  // After the first change, alpha is read from the copy, which is the only buffer written,
  // so the loop touches one full-size buffer rather than two.
  const edited = copyPixelData(pixels)
  edited[first * 4 + 3] = 0
  const firstY = Math.floor(first / width)
  let count = 1
  let minX = first - firstY * width
  let maxX = minX
  let maxY = firstY
  for (let y = firstY; y < bottom; y++) {
    const rowStart = y * width
    let rowFirst = -1
    let rowLast = -1
    for (let i = y === firstY ? first + 1 : rowStart + left, end = rowStart + right; i < end; i++) {
      if (mask[i] === 0) continue
      const alpha = i * 4 + 3
      if (edited[alpha] === 0) continue
      edited[alpha] = 0
      if (rowFirst < 0) rowFirst = i
      rowLast = i
      count++
    }
    if (rowFirst >= 0) {
      maxY = y
      if (rowFirst - rowStart < minX) minX = rowFirst - rowStart
      if (rowLast - rowStart > maxX) maxX = rowLast - rowStart
    }
  }

  return {
    data: edited,
    count,
    bounds: { x: minX, y: firstY, width: maxX - minX + 1, height: maxY - firstY + 1 },
  }
}

/**
 * Index of the first selected pixel, in row order within the bounds, whose alpha is above 0,
 * or -1 if there is none.
 */
function firstChangedPixel(
  source: Readonly<Uint8ClampedArray>,
  mask: Readonly<Uint8Array>,
  width: number,
  left: number,
  right: number,
  top: number,
  bottom: number,
): number {
  for (let y = top; y < bottom; y++) {
    for (let i = y * width + left, end = y * width + right; i < end; i++) {
      if (mask[i] !== 0 && source[i * 4 + 3] !== 0) return i
    }
  }
  return -1
}

/**
 * Throws a RangeError unless `selection` is the image's size and its bounds lie within it.
 * Constant time: the mask's bytes are not read.
 */
function validateSelectionFits(selection: SelectionMask, pixels: PixelBuffer): void {
  const { width, height } = pixels
  if (selection.width !== width || selection.height !== height) {
    throw new RangeError(
      `Cannot delete a ${selection.width} × ${selection.height} selection from a ${width} × ${height} image`,
    )
  }
  if (selection.data.length !== width * height) {
    throw new RangeError(`Selection has ${selection.data.length} entries; expected ${width * height}`)
  }
  const { x, y, width: w, height: h } = selection.bounds
  const inside =
    Number.isSafeInteger(x) && Number.isSafeInteger(y) && Number.isSafeInteger(w) && Number.isSafeInteger(h) &&
    x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= width && y + h <= height
  if (!inside) {
    throw new RangeError(`Selection bounds ${x}, ${y}, ${w} × ${h} do not lie within the ${width} × ${height} image`)
  }
}
