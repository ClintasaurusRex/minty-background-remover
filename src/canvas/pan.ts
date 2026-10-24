import type { Point, Size, ViewportState } from '../editor/types'
import { DOM_DELTA_LINE, DOM_DELTA_PAGE, WHEEL_LINE_PX } from './wheelZoom'

/*
 * Panning helpers: wheel and trackpad deltas, and soft limits that stop the image
 * being moved completely out of the workspace. All values are CSS pixels.
 */

/**
 * How much of the image (in CSS pixels on screen) must stay inside the workspace
 * on each axis when panning, or all of it if it is smaller than this.
 */
export const PAN_KEEP_VISIBLE_PX = 64

export interface WheelInput {
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaMode: number
  readonly shiftKey: boolean
}

/**
 * The image movement for a plain (non-Ctrl) wheel event. Scrolling down moves the
 * image up, as scrolling a page would; trackpads report both axes, and the
 * operating system's natural-scrolling setting is already reflected in the deltas.
 *
 * Shift + wheel pans horizontally. Some browsers already report it as deltaX, others
 * as deltaY; either way it becomes horizontal movement.
 */
export function wheelPanDelta(input: WheelInput, pageSize: Size): Point {
  const x = toPixels(input.deltaX, input.deltaMode, pageSize.width)
  const y = toPixels(input.deltaY, input.deltaMode, pageSize.height)
  if (input.shiftKey) return { x: -(x !== 0 ? x : y), y: 0 }
  return { x: -x, y: -y }
}

function toPixels(delta: number, deltaMode: number, pageLength: number): number {
  if (!Number.isFinite(delta)) return 0
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return delta * WHEEL_LINE_PX
    case DOM_DELTA_PAGE:
      return delta * pageLength
    default:
      return delta
  }
}

/** The range of offsets on one axis that keeps enough of the image visible. */
export function panRange(imageLength: number, zoom: number, viewportLength: number): readonly [number, number] {
  const shown = imageLength * zoom
  const keep = Math.min(PAN_KEEP_VISIBLE_PX, shown)
  const low = keep - shown
  const high = viewportLength - keep
  // A workspace too small for the margin: allow only the centred position.
  if (low > high) {
    const centre = (low + high) / 2
    return [centre, centre]
  }
  return [low, high]
}

/**
 * Limits a pan from `current` to `next`. Movement that would leave less than
 * PAN_KEEP_VISIBLE_PX of the image visible stops at that point. If the image is
 * already further out than that (for example after zooming), it can stay there and
 * move back in, but not further out, so the limit never makes the image jump.
 */
export function limitPan(
  next: ViewportState,
  current: ViewportState,
  imageSize: Size,
  viewportSize: Size,
): ViewportState {
  return {
    zoom: next.zoom,
    offset: {
      x: limitAxis(next.offset.x, current.offset.x, panRange(imageSize.width, next.zoom, viewportSize.width)),
      y: limitAxis(next.offset.y, current.offset.y, panRange(imageSize.height, next.zoom, viewportSize.height)),
    },
  }
}

function limitAxis(next: number, current: number, [low, high]: readonly [number, number]): number {
  return Math.min(Math.max(next, Math.min(low, current)), Math.max(high, current))
}

/**
 * Brings the image back into view if a zoom or resize left none of it inside the
 * workspace. Viewports with any part of the image visible are returned unchanged,
 * so zooming about a point on the image is never affected.
 */
export function keepImageReachable(viewport: ViewportState, imageSize: Size, viewportSize: Size): ViewportState {
  const { zoom, offset } = viewport
  const visible =
    offset.x < viewportSize.width &&
    offset.x + imageSize.width * zoom > 0 &&
    offset.y < viewportSize.height &&
    offset.y + imageSize.height * zoom > 0
  if (visible) return viewport
  const [lowX, highX] = panRange(imageSize.width, zoom, viewportSize.width)
  const [lowY, highY] = panRange(imageSize.height, zoom, viewportSize.height)
  return {
    zoom,
    offset: {
      x: Math.min(Math.max(offset.x, lowX), highX),
      y: Math.min(Math.max(offset.y, lowY), highY),
    },
  }
}
