import type { Rectangle } from '../types'

/**
 * Throws a RangeError unless `rect` has whole-number coordinates, is at least 1 × 1 and lies
 * within a width × height image. `what` names the rectangle in the message.
 */
export function validateRectangleWithin(rect: Readonly<Rectangle>, width: number, height: number, what: string): void {
  const { x, y, width: w, height: h } = rect
  const valid =
    Number.isSafeInteger(x) && Number.isSafeInteger(y) && Number.isSafeInteger(w) && Number.isSafeInteger(h) &&
    x >= 0 && y >= 0 && w >= 1 && h >= 1 && x + w <= width && y + h <= height
  if (!valid) {
    throw new RangeError(`${what} ${x}, ${y}, ${w} × ${h} does not lie within the ${width} × ${height} image`)
  }
}

/** Throws a RangeError unless `width` and `height` are whole numbers of at least 1. */
export function validateDimensions(width: number, height: number, what: string): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid ${what} dimensions: ${width} × ${height}`)
  }
}
