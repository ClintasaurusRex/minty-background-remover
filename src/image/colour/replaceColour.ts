import type { PixelBuffer, Rectangle, SelectionMask } from '../../editor/types'
import { copyPixelData, createPixelBuffer, validatePixelBuffer } from '../pixelBuffer'
import { colourDistanceSquared, toleranceThreshold } from '../selection/colourDistance'
import type { Rgba } from './colour'

/*
 * Basic Replace Colour (Phase 4; IMAGE_PROCESSING_SPEC.md, Replace Colour): the algorithm only. The
 * Replace Colour tool is not available in the application yet: where it applies (the whole image or
 * the selection), shading preservation, how an alpha change is requested and the form of its
 * preview await owner decisions (IMPLEMENTATION_PLAN.md, Phase 4). Nothing calls this yet.
 *
 * What the specification states, and this does:
 *
 * 1. Pixels matching `source` within `tolerance` are found with the Magic Wand's alpha-aware colour
 *    distance (colourDistance.ts; tolerance 0–100, 0 = the exact colour).
 * 2. Their colour values become the replacement's red, green and blue: flat replacement, the basic
 *    mode. (Shading preservation is a later, separately designed mode.)
 * 3. Alpha is preserved: every pixel keeps its own alpha. The replacement's alpha is not used.
 *
 * Fully transparent pixels are never changed: their colour is invisible, so replacing it would
 * change nothing visible and only add to the Undo history. `within` limits the change to selected
 * pixels when given (null: the whole image); the caller decides which applies.
 *
 * Pure, like the other pixel algorithms: `pixels` is never written; the result is one new buffer,
 * made only when a pixel actually changes.
 */

export interface ReplaceColourOptions {
  /** The colour to find (alpha counts in the distance, as for the Magic Wand). */
  readonly source: Rgba
  /** The colour whose red, green and blue replace the matching pixels' (its alpha is not used). */
  readonly replacement: Rgba
  /** 0–100, a whole number; 0 matches the source colour exactly. */
  readonly tolerance: number
  /** Only these pixels may change; null for the whole image. Must be the image's size. */
  readonly within?: SelectionMask | null
}

export interface ReplaceColourResult {
  readonly pixels: PixelBuffer
  /** Pixels whose colour changed. */
  readonly count: number
  /** The smallest rectangle containing every changed pixel (for the history patch). */
  readonly bounds: Rectangle
}

/**
 * The image with every matching pixel's colour replaced (see above), or null when no pixel would
 * change: nothing matches, or every match already has the replacement colour. Throws a RangeError
 * for an invalid image, tolerance, colour or mask size.
 */
export function replaceColour(pixels: PixelBuffer, options: ReplaceColourOptions): ReplaceColourResult | null {
  validatePixelBuffer(pixels)
  const { source, replacement, within = null } = options
  const threshold = toleranceThreshold(options.tolerance)
  for (const colour of [source, replacement]) {
    if (![colour.r, colour.g, colour.b, colour.a].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      throw new RangeError(`Invalid colour ${JSON.stringify(colour)}`)
    }
  }
  const { width, height } = pixels
  if (within && (within.width !== width || within.height !== height)) {
    throw new RangeError(`The selection is ${within.width} × ${within.height}; the image is ${width} × ${height}`)
  }
  const data = pixels.data
  const mask = within?.data ?? null
  const { r: sr, g: sg, b: sb, a: sa } = source
  const { r: nr, g: ng, b: nb } = replacement
  let out: Uint8ClampedArray<ArrayBuffer> | null = null
  let count = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let p = 0, i = 0; p < width * height; p++, i += 4) {
    const a = data[i + 3]
    if (a === 0 || (mask !== null && mask[p] === 0)) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (r === nr && g === ng && b === nb) continue
    if (colourDistanceSquared(sr, sg, sb, sa, r, g, b, a) > threshold) continue
    out ??= copyPixelData(pixels)
    out[i] = nr
    out[i + 1] = ng
    out[i + 2] = nb
    count++
    const x = p % width
    const y = (p - x) / width
    if (x < left) left = x
    if (x > right) right = x
    if (y < top) top = y
    bottom = y
  }
  if (!out) return null
  return { pixels: createPixelBuffer(width, height, out), count, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } }
}
