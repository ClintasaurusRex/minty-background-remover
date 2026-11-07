import type { Rectangle, SelectionMask } from '../../editor/types'

/*
 * Shared by edge cleanup (edgeCleanup.ts) and feathering (feather.ts), which both work on the
 * unselected pixels next to a selection that Delete has just made transparent.
 *
 * Both process the region around the selection in horizontal strips: each strip is computed in a
 * window that adds a halo of rows above and below it, large enough that every pixel of the strip's
 * own rows gets exactly the result it would get from one window over the whole region. Scratch
 * memory then follows the strip (width × (rows + 2 × halo)) instead of the image: at 50 MP a few
 * tens of megabytes rather than several hundred.
 */

/** The 8 neighbours, in this order: E, NE, N, NW, W, SW, S, SE. */
export const NEIGHBOUR_X: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1]
export const NEIGHBOUR_Y: readonly number[] = [0, -1, -1, -1, 0, 1, 1, 1]

/** Rows per strip unless a test asks for another number. Results never depend on it. */
export const DEFAULT_STRIP_ROWS = 256

/** One strip: the window computed (own rows plus halo) and the rows whose pixels it writes. */
export interface EdgeStrip {
  /** Window columns [left, right) and rows [top, bottom), within the image. */
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  /** The strip's own rows [ownTop, ownBottom): only pixels in these rows are written. */
  readonly ownTop: number
  readonly ownBottom: number
}

/**
 * Calls `visit` for each strip covering the rows within `reach` of the selection's bounds. Every
 * window spans the selection's columns widened by `halo`, and its own rows widened by `halo`
 * (clipped to the image). `stripRows` 0 means a single strip over the whole region.
 */
export function forEachEdgeStrip(
  width: number,
  height: number,
  bounds: Readonly<Rectangle>,
  reach: number,
  halo: number,
  stripRows: number,
  visit: (strip: EdgeStrip) => void,
): void {
  const regionTop = Math.max(0, bounds.y - reach)
  const regionBottom = Math.min(height, bounds.y + bounds.height + reach)
  const left = Math.max(0, bounds.x - halo)
  const right = Math.min(width, bounds.x + bounds.width + halo)
  const rows = stripRows > 0 ? stripRows : regionBottom - regionTop
  for (let ownTop = regionTop; ownTop < regionBottom; ownTop += rows) {
    const ownBottom = Math.min(regionBottom, ownTop + rows)
    visit({ left, right, top: Math.max(0, ownTop - halo), bottom: Math.min(height, ownBottom + halo), ownTop, ownBottom })
  }
}

/**
 * Calls `visit(index, local)` for every edge seed in the strip's window, in row order: a pixel that
 * is not selected, is not fully transparent in `source`, and has at least one selected 8-neighbour
 * in the image. `index` is the pixel's index in the image, `local` its index in the window
 * (row-major, the window's width).
 *
 * Rows of the mask are scanned four pixels at a time: each row is copied into a 32-bit aligned
 * buffer, OR-ed with its left and right neighbours a word at a time, OR-ed over three rows and
 * masked with "not selected"; words without a candidate are skipped. Mask bytes are 0 or 1, as
 * SelectionMask defines them.
 */
export function forEachEdgeSeed(
  source: Readonly<Uint8ClampedArray>,
  selection: SelectionMask,
  strip: EdgeStrip,
  visit: (index: number, local: number) => void,
): void {
  const { width, height } = selection
  const mask = selection.data
  const { left, right, top, bottom } = strip
  const windowWidth = right - left
  const words = (windowWidth + 3) >> 2
  // One guard word on each side, zero outside the image.
  const rowBytes = 4 * (words + 2)
  const makeRow = () => {
    const bytes = new Uint8Array(rowBytes)
    return { bytes, words: new Uint32Array(bytes.buffer), spread: new Uint32Array(words + 2) }
  }
  type Row = ReturnType<typeof makeRow>
  const loadRow = (y: number, row: Row) => {
    row.bytes.fill(0)
    if (y >= 0 && y < height) {
      const from = Math.max(0, left - 1)
      const to = Math.min(width, right + 1)
      row.bytes.set(mask.subarray(y * width + from, y * width + to), 4 + from - left)
    }
    // Each byte of `spread` is set when the pixel or a horizontal neighbour is selected. Byte
    // order within a word does not matter: shifting by 8 moves one pixel either way.
    const w = row.words
    const s = row.spread
    for (let k = 1; k <= words; k++) s[k] = w[k] | (w[k] << 8) | (w[k] >>> 8) | (w[k - 1] >>> 24) | (w[k + 1] << 24)
  }
  let above = makeRow()
  let current = makeRow()
  let below = makeRow()
  loadRow(top - 1, above)
  loadRow(top, current)
  for (let y = top; y < bottom; y++) {
    loadRow(y + 1, below)
    const localRow = (y - top) * windowWidth
    const imageRow = y * width + left
    for (let k = 1; k <= words; k++) {
      let candidates = (above.spread[k] | current.spread[k] | below.spread[k]) & ~current.words[k] & 0x01010101
      if (candidates === 0) continue
      for (let b = 0; b < 4; b++, candidates >>>= 8) {
        if ((candidates & 1) === 0) continue
        const x = 4 * k - 4 + b
        if (x >= windowWidth) break
        const index = imageRow + x
        if (source[index * 4 + 3] !== 0) visit(index, localRow + x)
      }
    }
    const spare = above
    above = current
    current = below
    below = spare
  }
}

/** The smallest rectangle containing the pixels included so far (mutable, for the edge passes). */
export interface BoundsTracker {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** A tracker containing no pixel yet. */
export function emptyBounds(): BoundsTracker {
  return { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 }
}

/** Grows the tracked rectangle to include pixel `index` of an image `width` pixels wide. */
export function includePixel(tracker: BoundsTracker, index: number, width: number): void {
  const x = index % width
  const y = (index - x) / width
  if (x < tracker.minX) tracker.minX = x
  if (x > tracker.maxX) tracker.maxX = x
  if (y < tracker.minY) tracker.minY = y
  if (y > tracker.maxY) tracker.maxY = y
}

/** The tracked rectangle, or null when nothing was included. */
export function trackedBounds(tracker: BoundsTracker): Rectangle | null {
  if (tracker.maxX < 0) return null
  return { x: tracker.minX, y: tracker.minY, width: tracker.maxX - tracker.minX + 1, height: tracker.maxY - tracker.minY + 1 }
}
