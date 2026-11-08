import { cropPixels } from '../../editor/history/cropPatch'
import type { PixelBuffer, Rectangle } from '../../editor/types'
import { validatePixelBuffer } from '../pixelBuffer'

/*
 * Auto Trim (Phase 3 Step 10): the rectangle of visible content, the rectangle to keep around it
 * with padding, and the trimmed image. Pure and synchronous: no DOM, canvas or editor state, so
 * it runs in Node tests and could move to a Web Worker unchanged. The application calls it through
 * autoTrimCommand (editor/editCommands.ts, Phase 3 Step 11), which records the plan's crop.
 *
 * Visibility comes from alpha alone (P3-D6): a pixel is visible when its alpha is above the
 * threshold, 0 by default, so every pixel with alpha 1 or more counts, however faint (anti-aliased
 * edges, feathered edges, 1-pixel lines). The colour of a fully transparent pixel is never read:
 * colour hidden under alpha 0 by Delete (P3-D2) is not content.
 *
 * Padding keeps up to that many pixels of the image around the visible content on each side,
 * clipped at the image's edges, each side on its own: Auto Trim only removes pixels, never adds
 * any, so the result is always a rectangle of the original image, cropped at whole pixels.
 *
 * Nothing to do is a result, not an error: an image with no visible pixel ('nothing-visible'),
 * and an image whose padded content already reaches every edge ('unchanged'), give no rectangle
 * to crop, so no image of zero size and no edit that changes nothing can come from Auto Trim.
 *
 * The trimmed pixels come from cropPixels, the crop that the edit history uses: a 'crop' plan's
 * `kept` rectangle is what an Auto Trim edit records (`CompletedCrop.kept`), and Redo crops with
 * the same function, so the edit, its Undo and its Redo all agree byte for byte.
 */

/** The default alpha threshold: every pixel with alpha 1 or more is visible. */
export const DEFAULT_ALPHA_THRESHOLD = 0

/** The highest alpha threshold: only fully opaque pixels are visible. */
export const MAX_ALPHA_THRESHOLD = 254

export interface AutoTrimOptions {
  /**
   * Pixels of the image kept around the visible content on each side, where the image has them:
   * a whole number, 0 or more. Clipped at each edge on its own, so content touching an edge keeps
   * no padding on that side (the image is never enlarged).
   */
  readonly padding: number
  /**
   * A pixel is visible when its alpha is above this: a whole number from 0 to 254,
   * DEFAULT_ALPHA_THRESHOLD (0) when omitted. Above 0, faint pixels at the outside of the content
   * (alpha up to the threshold) can be cut away by the trim.
   */
  readonly alphaThreshold?: number
}

/** No pixel is visible: there is nothing to trim to, and nothing changes. */
export interface AutoTrimNothingVisible {
  readonly kind: 'nothing-visible'
}

/** The visible content with its padding already reaches every edge: nothing to remove. */
export interface AutoTrimUnchanged {
  readonly kind: 'unchanged'
  /** The smallest rectangle containing every visible pixel. */
  readonly visible: Readonly<Rectangle>
}

/** Pixels outside `kept` can be removed. */
export interface AutoTrimCrop {
  readonly kind: 'crop'
  /** The smallest rectangle containing every visible pixel, in the image's pixels. */
  readonly visible: Readonly<Rectangle>
  /**
   * The rectangle to keep, in the image's pixels: `visible` with the padding, clipped to the
   * image. Always within the image, at least 1 × 1, smaller than the image, and containing
   * `visible`; its size is the trimmed image's size.
   */
  readonly kept: Readonly<Rectangle>
}

/** What Auto Trim would do to an image (planAutoTrim). */
export type AutoTrimPlan = AutoTrimNothingVisible | AutoTrimUnchanged | AutoTrimCrop

/** A crop with the trimmed image. */
export interface AutoTrimmed extends AutoTrimCrop {
  /** The pixels inside `kept`, every byte as it was, as new memory of exactly that size. */
  readonly pixels: PixelBuffer
}

/** What Auto Trim did to an image (autoTrimPixels). */
export type AutoTrimResult = AutoTrimNothingVisible | AutoTrimUnchanged | AutoTrimmed

/**
 * The smallest rectangle containing every pixel whose alpha is above `alphaThreshold`, or null
 * when there is none. Only alpha bytes are read; `pixels` is not written and nothing proportional
 * to the image is allocated.
 *
 * Each pixel is read at most once (apart from at most two per row), and pixels inside the
 * rectangle found so far are not read at all: the rows above and below the content are read
 * until the first visible pixel, then each row in between only to the left and right of the
 * content found so far. A fully transparent image is read entirely; a fully opaque one in about
 * width + height reads.
 *
 * Throws a RangeError for an invalid pixel buffer or a threshold that is not a whole number from
 * 0 to MAX_ALPHA_THRESHOLD.
 */
export function findVisibleBounds(pixels: PixelBuffer, alphaThreshold: number = DEFAULT_ALPHA_THRESHOLD): Rectangle | null {
  validatePixelBuffer(pixels)
  validateAlphaThreshold(alphaThreshold)
  const { width, height, data } = pixels

  // The top row with a visible pixel, and its first and last ones.
  let top = 0
  let left = -1
  for (; top < height; top++) {
    left = firstVisible(data, top * width, 0, width, alphaThreshold)
    if (left >= 0) break
  }
  if (left < 0) return null
  let right = lastVisible(data, top * width, left, width, alphaThreshold)

  // The bottom row with a visible pixel (row `top` has one), widening left and right by its own.
  let bottom = height - 1
  for (; bottom > top; bottom--) {
    const first = firstVisible(data, bottom * width, 0, width, alphaThreshold)
    if (first < 0) continue
    left = Math.min(left, first)
    right = Math.max(right, lastVisible(data, bottom * width, Math.max(first, right + 1), width, alphaThreshold))
    break
  }

  // The rows in between: only what lies outside the columns found so far.
  for (let y = top + 1; y < bottom && (left > 0 || right < width - 1); y++) {
    const row = y * width
    const first = firstVisible(data, row, 0, left, alphaThreshold)
    if (first >= 0) left = first
    const last = lastVisible(data, row, right + 1, width, alphaThreshold)
    if (last >= 0) right = last
  }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * What Auto Trim would do to `pixels`: the visible content's bounds (findVisibleBounds) and the
 * rectangle to keep, the bounds with `options.padding` on each side clipped to the image. Reads
 * alpha bytes only and allocates nothing proportional to the image.
 *
 * - 'nothing-visible' when no pixel is visible (a fully transparent image, hidden colour or not).
 * - 'unchanged' when the kept rectangle would be the whole image (the content, with its padding,
 *   reaches every edge; for example an image already trimmed with this padding or more).
 * - 'crop' otherwise, with the kept rectangle.
 *
 * Throws a RangeError for an invalid pixel buffer, padding that is not a whole number of at least
 * 0, or an invalid threshold (see AutoTrimOptions).
 */
export function planAutoTrim(pixels: PixelBuffer, options: AutoTrimOptions): AutoTrimPlan {
  const { padding, alphaThreshold = DEFAULT_ALPHA_THRESHOLD } = options
  validatePadding(padding)
  const visible = findVisibleBounds(pixels, alphaThreshold)
  if (!visible) return { kind: 'nothing-visible' }
  const { width, height } = pixels
  const x = Math.max(0, visible.x - padding)
  const y = Math.max(0, visible.y - padding)
  const right = Math.min(width, visible.x + visible.width + padding)
  const bottom = Math.min(height, visible.y + visible.height + padding)
  if (x === 0 && y === 0 && right === width && bottom === height) return { kind: 'unchanged', visible }
  return { kind: 'crop', visible, kept: { x, y, width: right - x, height: bottom - y } }
}

/**
 * Auto Trim of `pixels`: planAutoTrim, and for a crop the trimmed image (cropPixels with the kept
 * rectangle), whose every byte is the original's at the same place in the kept rectangle,
 * colour hidden under alpha 0 included. Nothing is resampled, recoloured or moved by less than a
 * pixel. `pixels` is never written; only a crop allocates, exactly the trimmed image's size.
 *
 * Throws a RangeError as planAutoTrim.
 */
export function autoTrimPixels(pixels: PixelBuffer, options: AutoTrimOptions): AutoTrimResult {
  const plan = planAutoTrim(pixels, options)
  return plan.kind === 'crop' ? { ...plan, pixels: cropPixels(pixels, plan.kept) } : plan
}

/** Throws a RangeError unless `alphaThreshold` is a whole number from 0 to MAX_ALPHA_THRESHOLD. */
export function validateAlphaThreshold(alphaThreshold: number): void {
  if (!Number.isSafeInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > MAX_ALPHA_THRESHOLD) {
    throw new RangeError(`Invalid alpha threshold: ${alphaThreshold} (a whole number from 0 to ${MAX_ALPHA_THRESHOLD})`)
  }
}

/** Throws a RangeError unless `padding` is a whole number of at least 0. */
export function validatePadding(padding: number): void {
  if (!Number.isSafeInteger(padding) || padding < 0) {
    throw new RangeError(`Invalid Auto Trim padding: ${padding} (a whole number of pixels, at least 0)`)
  }
}

type PixelBytes = Readonly<Uint8ClampedArray<ArrayBuffer>>

/** The first x from `from` up to (not including) `to` in the row starting at pixel `row` whose alpha is above `threshold`, or -1. */
function firstVisible(data: PixelBytes, row: number, from: number, to: number, threshold: number): number {
  for (let x = from, alpha = (row + from) * 4 + 3; x < to; x++, alpha += 4) {
    if (data[alpha] > threshold) return x
  }
  return -1
}

/** The last x from `from` up to (not including) `to` in that row whose alpha is above `threshold`, read from the right, or -1. */
function lastVisible(data: PixelBytes, row: number, from: number, to: number, threshold: number): number {
  for (let x = to - 1, alpha = (row + x) * 4 + 3; x >= from; x--, alpha -= 4) {
    if (data[alpha] > threshold) return x
  }
  return -1
}
