import type { FloodMode, PixelCoordinate, SelectionMask } from '../../editor/types'
import { colourDistanceSquared, toleranceThreshold } from './colourDistance'

export interface MagicWandOptions {
  /** Whole number from 0 to 100 (see colourDistance.ts). */
  readonly tolerance: number
  readonly floodMode: FloodMode
}

/**
 * Selects the pixels whose colour is within `tolerance` of the seed (clicked) pixel's colour.
 * Contiguous mode keeps only those connected to the seed through matching edge neighbours
 * (up, down, left, right; diagonal contact does not connect). Global mode keeps every match.
 *
 * Every pixel is compared with the seed's colour, never with its neighbour. The result is
 * never empty, because the seed always matches itself. `pixels` is never modified.
 *
 * Throws a RangeError for a malformed pixel buffer (including one that does not start on a
 * 4-byte boundary, which ImageData from a canvas always does), a seed outside the image or an
 * invalid tolerance. Callers ignore clicks outside the image before getting here.
 */
export function createMagicWandSelection(
  pixels: ImageData,
  seed: PixelCoordinate,
  options: MagicWandOptions,
): SelectionMask {
  const { width, height, data } = pixels
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid pixel dimensions: ${width} × ${height}`)
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(
      `Pixel buffer has ${data.length} bytes; expected ${width * height * 4} for ${width} × ${height} RGBA`,
    )
  }
  const { x, y } = seed
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new RangeError(`Seed (${x}, ${y}) is outside the ${width} × ${height} image`)
  }

  const threshold = toleranceThreshold(options.tolerance)
  // Each pixel's RGBA as one 32-bit value, for the identical-colour shortcut in matchesSeed.
  const words = new Uint32Array(data.buffer, data.byteOffset, width * height)
  return options.floodMode === 'global'
    ? selectGlobal(pixels, words, seed, threshold)
    : selectContiguous(pixels, words, seed, threshold)
}

/**
 * Whether pixel `index` is within `threshold` of the seed colour, given as one 32-bit value
 * (`seedWord`) and as channels. Pixels identical to the seed skip the distance calculation,
 * the common case on flat backgrounds.
 *
 * The seed is passed as plain numbers rather than an object: Firefox does not optimise
 * object fields read once per pixel, and closures are slower still in both browsers.
 */
function matchesSeed(
  data: Uint8ClampedArray,
  words: Uint32Array,
  index: number,
  seedWord: number,
  r: number,
  g: number,
  b: number,
  a: number,
  threshold: number,
): boolean {
  if (words[index] === seedWord) return true
  const p = index * 4
  return colourDistanceSquared(r, g, b, a, data[p], data[p + 1], data[p + 2], data[p + 3]) <= threshold
}

/** One pass over the image; count and bounds are tracked as matches are found. */
function selectGlobal(pixels: ImageData, words: Uint32Array, seed: PixelCoordinate, threshold: number): SelectionMask {
  const { width, height, data } = pixels
  const seedIndex = seed.y * width + seed.x
  const seedWord = words[seedIndex]
  const r = data[seedIndex * 4]
  const g = data[seedIndex * 4 + 1]
  const b = data[seedIndex * 4 + 2]
  const a = data[seedIndex * 4 + 3]

  const mask = new Uint8Array(width * height)
  let count = 0
  let minX = width
  let maxX = -1
  let minY = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (!matchesSeed(data, words, rowStart + x, seedWord, r, g, b, a, threshold)) continue
      mask[rowStart + x] = 1
      if (first < 0) first = x
      last = x
      count++
    }
    if (first < 0) continue
    if (minY < 0) minY = y
    maxY = y
    if (first < minX) minX = first
    if (last > maxX) maxX = last
  }
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return { width, height, data: mask, count, bounds }
}

/** Marks a pixel that was compared and does not match, so it is never compared again. */
const REJECTED = 2

/** Scan requests the stack holds before it first grows. */
const INITIAL_REQUESTS = 1024

/**
 * Scanline flood fill driven by a stack of scan requests, so nothing recurses. A request
 * (y, from, to, dir) asks for row y to be scanned between columns `from` and `to`; `dir` is
 * +1 when it came from the row above, -1 from the row below and 0 for the seed. Each new run
 * of matching pixels is selected whole, then the row beyond it is queued in full and the row
 * it came from only where the run reaches past the request: the rest of that row is the run
 * that made the request.
 *
 * Pixels are compared only when the fill reaches them, and at most once, so the work is
 * proportional to the selected region and its outline rather than to the image.
 */
function selectContiguous(pixels: ImageData, words: Uint32Array, seed: PixelCoordinate, threshold: number): SelectionMask {
  const { width, height, data } = pixels
  const seedIndex = seed.y * width + seed.x
  const seedWord = words[seedIndex]
  const r = data[seedIndex * 4]
  const g = data[seedIndex * 4 + 1]
  const b = data[seedIndex * 4 + 2]
  const a = data[seedIndex * 4 + 3]

  // Per pixel: 0 = not compared yet, 1 = selected, REJECTED = compared, no match.
  const mask = new Uint8Array(width * height)
  let requests = new Int32Array(INITIAL_REQUESTS * 4)
  let top = queue(requests, 0, seed.y, seed.x, seed.x, 0, height)
  let count = 0
  let minX = seed.x
  let maxX = seed.x
  let minY = seed.y
  let maxY = seed.y

  while (top > 0) {
    top -= 4
    const y = requests[top]
    const from = requests[top + 1]
    const to = requests[top + 2]
    const dir = requests[top + 3]
    const rowStart = y * width

    for (let x = from; x <= to; x++) {
      const i = rowStart + x
      if (mask[i] !== 0) continue
      if (!matchesSeed(data, words, i, seedWord, r, g, b, a, threshold)) {
        mask[i] = REJECTED
        continue
      }

      // A new run starts here: select it in both directions.
      mask[i] = 1
      let left = x
      while (left > 0) {
        const j = rowStart + left - 1
        if (mask[j] !== 0) break
        if (!matchesSeed(data, words, j, seedWord, r, g, b, a, threshold)) {
          mask[j] = REJECTED
          break
        }
        mask[j] = 1
        left--
      }
      let right = x
      while (right < width - 1) {
        const j = rowStart + right + 1
        if (mask[j] !== 0) break
        if (!matchesSeed(data, words, j, seedWord, r, g, b, a, threshold)) {
          mask[j] = REJECTED
          break
        }
        mask[j] = 1
        right++
      }

      count += right - left + 1
      if (left < minX) minX = left
      if (right > maxX) maxX = right
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      // Queue the neighbouring rows (at most three requests).
      if (top + 12 > requests.length) requests = grow(requests)
      if (dir === 0) {
        top = queue(requests, top, y - 1, left, right, -1, height)
        top = queue(requests, top, y + 1, left, right, 1, height)
      } else {
        top = queue(requests, top, y + dir, left, right, dir, height)
        if (left < from) top = queue(requests, top, y - dir, left, from - 1, -dir, height)
        if (right > to) top = queue(requests, top, y - dir, to + 1, right, -dir, height)
      }
      x = right
    }
  }

  // Rejections lie in the selected rows and the rows just above and below them.
  clearRejected(mask, Math.max(0, minY - 1) * width, Math.min(height, maxY + 2) * width)
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return { width, height, data: mask, count, bounds }
}

/** Adds a scan request for row y unless the row is outside the image. Returns the new stack top. */
function queue(requests: Int32Array, top: number, y: number, from: number, to: number, dir: number, height: number): number {
  if (y < 0 || y >= height) return top
  requests[top] = y
  requests[top + 1] = from
  requests[top + 2] = to
  requests[top + 3] = dir
  return top + 4
}

function grow(requests: Int32Array): Int32Array<ArrayBuffer> {
  const grown = new Int32Array(requests.length * 2)
  grown.set(requests)
  return grown
}

/** Turns REJECTED back into 0 in mask[start, end), four pixels at a time (2 & 1 = 0, 1 & 1 = 1). */
function clearRejected(mask: Uint8Array, start: number, end: number): void {
  const words = new Uint32Array(mask.buffer, 0, mask.length >> 2)
  let i = start
  for (; i < end && i % 4 !== 0; i++) mask[i] &= 1
  for (; i + 4 <= end; i += 4) words[i >> 2] &= 0x01010101
  for (; i < end; i++) mask[i] &= 1
}
