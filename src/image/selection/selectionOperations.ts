import type { Rectangle, SelectionMask, SelectionMode } from '../../editor/types'

/*
 * Selection operations. Masks are immutable: inputs are never written, and a result may be one
 * of the inputs itself when nothing changes (for example adding a selection that is already
 * covered), so no-op operations allocate nothing. Work outside the masks' bounds is skipped.
 */

/**
 * Combines the current selection with an incoming one (for example a Magic Wand result):
 * New replaces it, Add takes the union, Subtract removes the incoming pixels.
 *
 * Throws a RangeError when both masks exist but their dimensions differ.
 */
export function combineSelections(
  existing: SelectionMask | null,
  incoming: SelectionMask | null,
  mode: SelectionMode,
): SelectionMask | null {
  if (existing && incoming && (existing.width !== incoming.width || existing.height !== incoming.height)) {
    throw new RangeError(
      `Cannot combine a ${existing.width} × ${existing.height} selection with a ${incoming.width} × ${incoming.height} one`,
    )
  }
  if (mode === 'new') return incoming
  if (mode === 'add') return addSelections(existing, incoming)
  return subtractSelection(existing, incoming)
}

function addSelections(a: SelectionMask | null, b: SelectionMask | null): SelectionMask | null {
  if (!a) return b
  if (!b) return a
  const { width } = a
  const added = b.count - countOverlap(b, a.data)
  if (added === 0) return a // b lies within a
  if (b.count - added === a.count) return b // a lies within b

  const data = a.data.slice()
  writeWhereSelected(b, data, 1)
  return { width, height: a.height, data, count: a.count + added, bounds: union(a.bounds, b.bounds) }
}

function subtractSelection(a: SelectionMask | null, b: SelectionMask | null): SelectionMask | null {
  if (!a || !b) return a
  const removed = countOverlap(b, a.data)
  if (removed === 0) return a
  if (removed === a.count) return null

  const data = a.data.slice()
  writeWhereSelected(b, data, 0)
  // What is left lies within the original bounds.
  const bounds = selectedBounds(data, a.width, a.bounds)
  return { width: a.width, height: a.height, data, count: a.count - removed, bounds: bounds! }
}

/** A mask with every pixel of a width × height image selected. Throws a RangeError for invalid dimensions. */
export function selectAll(width: number, height: number): SelectionMask {
  validateDimensions(width, height)
  return {
    width,
    height,
    data: new Uint8Array(width * height).fill(1),
    count: width * height,
    bounds: { x: 0, y: 0, width, height },
  }
}

/**
 * Selects exactly the pixels that are not selected. Inverting no selection selects the whole
 * image; inverting a full selection gives null.
 *
 * Throws a RangeError for invalid dimensions or a selection of a different size.
 */
export function invertSelection(selection: SelectionMask | null, width: number, height: number): SelectionMask | null {
  validateDimensions(width, height)
  if (!selection) return selectAll(width, height)
  if (selection.width !== width || selection.height !== height) {
    throw new RangeError(`Cannot invert a ${selection.width} × ${selection.height} selection in a ${width} × ${height} image`)
  }
  const pixelCount = width * height
  if (selection.count === pixelCount) return null

  // Everything outside the old bounds becomes selected; inside them, each pixel flips.
  const data = new Uint8Array(pixelCount).fill(1)
  const { x, y, width: w, height: h } = selection.bounds
  const source = selection.data
  for (let row = y; row < y + h; row++) {
    for (let i = row * width + x, end = i + w; i < end; i++) data[i] = 1 - source[i]
  }
  const bounds = selectedBounds(data, width, { x: 0, y: 0, width, height })
  return { width, height, data, count: pixelCount - selection.count, bounds: bounds! }
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid selection dimensions: ${width} × ${height}`)
  }
}

/** How many of the mask's selected pixels are also selected in `other`. Scans only the mask's bounds. */
function countOverlap(mask: SelectionMask, other: Readonly<Uint8Array>): number {
  const { width, data } = mask
  const { x, y, width: w, height: h } = mask.bounds
  let count = 0
  for (let row = y; row < y + h; row++) {
    for (let i = row * width + x, end = i + w; i < end; i++) count += data[i] & other[i]
  }
  return count
}

/** Sets `target` to `value` wherever the mask is selected. Scans only the mask's bounds. */
function writeWhereSelected(mask: SelectionMask, target: Uint8Array, value: number): void {
  const { width, data } = mask
  const { x, y, width: w, height: h } = mask.bounds
  for (let row = y; row < y + h; row++) {
    for (let i = row * width + x, end = i + w; i < end; i++) {
      if (data[i] === 1) target[i] = value
    }
  }
}

function union(a: Readonly<Rectangle>, b: Readonly<Rectangle>): Rectangle {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  }
}

/**
 * Tight bounds of the selected pixels within `region`, or null if none. Stops early: rows are
 * scanned inwards from the top and bottom, and within rows only up to the edges found so far.
 */
function selectedBounds(data: Uint8Array, width: number, region: Readonly<Rectangle>): Rectangle | null {
  const left = region.x
  const right = region.x + region.width - 1
  let top = region.y
  let bottom = region.y + region.height - 1
  while (top <= bottom && !rowHasSelection(data, top * width + left, top * width + right + 1)) top++
  if (top > bottom) return null
  while (!rowHasSelection(data, bottom * width + left, bottom * width + right + 1)) bottom--

  let minX = right
  let maxX = left
  for (let row = top; row <= bottom; row++) {
    const rowStart = row * width
    for (let x = left; x < minX; x++) {
      if (data[rowStart + x] === 1) {
        minX = x
        break
      }
    }
    for (let x = right; x > maxX; x--) {
      if (data[rowStart + x] === 1) {
        maxX = x
        break
      }
    }
  }
  return { x: minX, y: top, width: maxX - minX + 1, height: bottom - top + 1 }
}

function rowHasSelection(data: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (data[i] === 1) return true
  return false
}
