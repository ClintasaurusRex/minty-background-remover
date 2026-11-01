import type { SelectionMask } from '../../editor/types'

/**
 * Builds a selection mask from one byte per image pixel (row-major, 1 = selected,
 * 0 = not selected) and computes its selected-pixel count and bounds in a single pass.
 *
 * Returns null when no pixel is selected, so an empty selection has one representation.
 *
 * Ownership: the mask keeps `data` itself, without copying. The caller hands the buffer
 * over and must not modify it afterwards. This function never writes to `data`.
 *
 * Throws a RangeError for dimensions that are not positive whole numbers, a buffer whose
 * length is not width × height, or a byte other than 0 or 1.
 */
export function createSelectionMask(width: number, height: number, data: Uint8Array): SelectionMask | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid selection dimensions: ${width} × ${height}`)
  }
  const pixelCount = width * height
  if (data.length !== pixelCount) {
    throw new RangeError(
      `Selection buffer has ${data.length} entries; expected ${pixelCount} for ${width} × ${height}`,
    )
  }

  let count = 0
  let minX = width
  let maxX = -1
  let minY = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    let rowFirst = -1
    let rowLast = -1
    for (let x = 0; x < width; x++) {
      const value = data[rowStart + x]
      if (value === 0) continue
      if (value !== 1) {
        throw new RangeError(`Selection value ${value} at (${x}, ${y}); expected 0 or 1`)
      }
      if (rowFirst < 0) rowFirst = x
      rowLast = x
      count++
    }
    if (rowFirst >= 0) {
      if (minY < 0) minY = y
      maxY = y
      if (rowFirst < minX) minX = rowFirst
      if (rowLast > maxX) maxX = rowLast
    }
  }

  if (count === 0) return null
  return {
    width,
    height,
    data,
    count,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}
