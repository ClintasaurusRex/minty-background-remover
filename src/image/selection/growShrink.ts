import type { SelectionMask } from '../../editor/types'

/**
 * Grows the selection by one pixel in all eight directions (a 3 × 3 dilation), within the
 * image. Growing nothing gives null; a full selection is returned unchanged.
 */
export function growSelection(selection: SelectionMask | null): SelectionMask | null {
  if (!selection) return null
  if (selection.count === selection.width * selection.height) return selection
  return morph(selection, true)
}

/**
 * Shrinks the selection by one pixel in all eight directions (a 3 × 3 erosion): a pixel stays
 * selected only if it and its eight neighbours are selected. Pixels outside the image count as
 * selected, so edges touching the image border stay put. Shrinking nothing, or a selection too
 * thin to survive, gives null; a full selection is returned unchanged.
 */
export function shrinkSelection(selection: SelectionMask | null): SelectionMask | null {
  if (!selection) return null
  if (selection.count === selection.width * selection.height) return selection
  return morph(selection, false)
}

/**
 * The 3 × 3 operation is done in two passes per row: first each row is combined with its left
 * and right neighbours (OR to grow, AND to shrink), then each output row combines three of
 * those rows. Only three rows of scratch space are needed, and only the area the result can
 * occupy is visited: the old bounds plus one pixel for Grow, the old bounds for Shrink.
 * Inputs are never written; the result is a new mask, or null when nothing is left.
 */
function morph(selection: SelectionMask, grow: boolean): SelectionMask | null {
  const { width, height, data: source, bounds } = selection
  const margin = grow ? 1 : 0
  const left = Math.max(0, bounds.x - margin)
  const right = Math.min(width - 1, bounds.x + bounds.width - 1 + margin)
  const top = Math.max(0, bounds.y - margin)
  const bottom = Math.min(height - 1, bounds.y + bounds.height - 1 + margin)
  const span = right - left + 1

  // Rows above, at and below the output row, each already combined horizontally.
  let above = new Uint8Array(span)
  let current = new Uint8Array(span)
  let below = new Uint8Array(span)
  combineRow(source, width, height, top - 1, left, span, grow, above)
  combineRow(source, width, height, top, left, span, grow, current)

  const data = new Uint8Array(width * height)
  let count = 0
  let minX = width
  let maxX = -1
  let minY = -1
  let maxY = -1
  for (let y = top; y <= bottom; y++) {
    combineRow(source, width, height, y + 1, left, span, grow, below)
    const out = data.subarray(y * width + left, y * width + left + span)
    let rowCount = 0
    if (grow) {
      for (let i = 0; i < span; i++) rowCount += out[i] = above[i] | current[i] | below[i]
    } else {
      for (let i = 0; i < span; i++) rowCount += out[i] = above[i] & current[i] & below[i]
    }
    if (rowCount > 0) {
      count += rowCount
      if (minY < 0) minY = y
      maxY = y
      minX = Math.min(minX, left + out.indexOf(1))
      maxX = Math.max(maxX, left + out.lastIndexOf(1))
    }
    const recycled = above
    above = current
    current = below
    below = recycled
  }

  // A selection that is neither empty nor full always changes, so the result is always new.
  if (count === 0) return null
  return { width, height, data, count, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } }
}

/**
 * Writes row y combined with its left and right neighbours into `out`, for columns
 * left .. left + span - 1. Outside the image a pixel counts as unselected when growing and as
 * selected when shrinking, so a row outside the image is all 0s or all 1s.
 */
function combineRow(
  source: Readonly<Uint8Array>,
  width: number,
  height: number,
  y: number,
  left: number,
  span: number,
  grow: boolean,
  out: Uint8Array,
): void {
  const outside = grow ? 0 : 1
  if (y < 0 || y >= height) {
    out.fill(outside)
    return
  }
  // Slide a window of three pixels along the row: west, centre, east.
  const start = y * width + left
  const end = start + span - 1
  let west = left > 0 ? source[start - 1] : outside
  let centre = source[start]
  const eastOfEnd = left + span < width ? source[end + 1] : outside
  if (grow) {
    for (let i = 0; i < span - 1; i++) {
      const east = source[start + i + 1]
      out[i] = west | centre | east
      west = centre
      centre = east
    }
    out[span - 1] = west | centre | eastOfEnd
  } else {
    for (let i = 0; i < span - 1; i++) {
      const east = source[start + i + 1]
      out[i] = west & centre & east
      west = centre
      centre = east
    }
    out[span - 1] = west & centre & eastOfEnd
  }
}
