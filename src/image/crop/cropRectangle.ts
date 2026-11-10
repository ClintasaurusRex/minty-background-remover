import type { Point, Rectangle, Size } from '../../editor/types'

/*
 * Manual Crop rectangles (Phase 4; FEATURE_SPEC.md §11), in image pixels. Pure geometry: no
 * pixels, viewport, DOM or React. The crop itself is cropPixels (editor/history/cropPatch.ts),
 * the same exact cut Auto Trim and its Redo use.
 *
 * A crop rectangle always has whole-number edges on image pixel boundaries, is at least 1 × 1
 * and lies within the image, so it can never be empty, cut a pixel in half or reach outside the
 * image. Pointer positions are fractional image coordinates; every function here turns them into
 * whole pixel edges (the nearest one) and clamps them to the image, so dragging outside the image
 * stops at its edge.
 */

/** A side or corner of the crop rectangle that can be dragged to resize it. */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const CROP_HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The crop rectangle's position and size fields, as the options row edits them. */
export type CropField = 'x' | 'y' | 'width' | 'height'

/**
 * Whether `rect` is a crop rectangle for an image of `size`: whole numbers, at least 1 × 1, within
 * the image.
 */
export function isValidCropRect(rect: Readonly<Rectangle>, size: Size): boolean {
  const { x, y, width, height } = rect
  return (
    Number.isSafeInteger(x) &&
    Number.isSafeInteger(y) &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    x >= 0 &&
    y >= 0 &&
    width >= 1 &&
    height >= 1 &&
    x + width <= size.width &&
    y + height <= size.height
  )
}

/** Whether `rect` keeps the whole image, so applying it would change nothing. */
export function isWholeImage(rect: Readonly<Rectangle>, size: Size): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height
}

/** The whole image as a crop rectangle. */
export function wholeImageRect(size: Size): Rectangle {
  return { x: 0, y: 0, width: size.width, height: size.height }
}

/**
 * The pixel edge nearest to `value` (a fractional image coordinate), clamped to 0…`max` (the
 * image's width or height). Exactly halfway between two edges rounds up. Not finite: null.
 */
export function nearestEdge(value: number, max: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(0, Math.round(value)))
}

/**
 * The pixel edges nearest to `point`, clamped to the image: the corner a new crop drag starts
 * from, or reaches. Null when `point` is not finite.
 */
export function nearestCorner(point: Point, size: Size): Point | null {
  const x = nearestEdge(point.x, size.width)
  const y = nearestEdge(point.y, size.height)
  return x === null || y === null ? null : { x, y }
}

/**
 * The rectangle between two pixel corners (in either order), or null when it would be empty (the
 * corners share a row or column edge): a click without a drag, or a drag along one edge.
 */
export function rectBetween(a: Point, b: Point): Rectangle | null {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const width = Math.abs(a.x - b.x)
  const height = Math.abs(a.y - b.y)
  return width >= 1 && height >= 1 ? { x, y, width, height } : null
}

/**
 * `start` moved by `delta` image pixels (rounded to whole pixels), keeping its size and staying
 * within the image: dragged against an edge, it stops there. `start` must be a valid crop
 * rectangle; a delta that is not finite leaves it where it is.
 */
export function moveCropRect(start: Readonly<Rectangle>, delta: Point, size: Size): Rectangle {
  const dx = Number.isFinite(delta.x) ? Math.round(delta.x) : 0
  const dy = Number.isFinite(delta.y) ? Math.round(delta.y) : 0
  return {
    x: clamp(start.x + dx, 0, size.width - start.width),
    y: clamp(start.y + dy, 0, size.height - start.height),
    width: start.width,
    height: start.height,
  }
}

/**
 * `start` resized by dragging `handle` by `delta` image pixels (rounded to whole pixels). Only the
 * edges `handle` names move; the opposite edges stay. A moved edge stops at the image's edge and
 * at least 1 pixel from the opposite edge, so the rectangle never turns inside out or becomes
 * empty. `start` must be a valid crop rectangle; a delta that is not finite changes nothing on its
 * axis.
 */
export function resizeCropRect(start: Readonly<Rectangle>, handle: CropHandle, delta: Point, size: Size): Rectangle {
  const dx = Number.isFinite(delta.x) ? Math.round(delta.x) : 0
  const dy = Number.isFinite(delta.y) ? Math.round(delta.y) : 0
  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height
  if (handle.includes('w')) left = clamp(left + dx, 0, right - 1)
  if (handle.includes('e')) right = clamp(right + dx, left + 1, size.width)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - 1)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + 1, size.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The largest value each field of `rect` can take, for the options row's ranges: the position so
 * that the rectangle, at its size, stays within the image; the size so that it stays within the
 * image from its position. The smallest is 0 for the position and 1 for the size.
 */
export function cropFieldMaximum(rect: Readonly<Rectangle>, field: CropField, size: Size): number {
  switch (field) {
    case 'x':
      return size.width - rect.width
    case 'y':
      return size.height - rect.height
    case 'width':
      return size.width - rect.x
    case 'height':
      return size.height - rect.y
  }
}

/**
 * `rect` with one field set to `value`, rounded to a whole number and clamped (cropFieldMaximum):
 * X and Y move the rectangle and keep its size; Width and Height resize it from its top-left
 * corner. A value that is not finite leaves `rect` unchanged. `rect` must be a valid crop
 * rectangle.
 */
export function setCropField(rect: Readonly<Rectangle>, field: CropField, value: number, size: Size): Rectangle {
  const next: Rectangle = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  if (!Number.isFinite(value)) return next
  const min = field === 'width' || field === 'height' ? 1 : 0
  next[field] = clamp(Math.round(value), min, cropFieldMaximum(rect, field, size))
  return next
}

/** Whether two rectangles are equal. */
export function sameRect(a: Readonly<Rectangle> | null, b: Readonly<Rectangle> | null): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
