import type { PixelCoordinate, Point, Rectangle, Size, ViewportState } from '../editor/types'
import { devicePixelCentre } from './devicePixels'

/*
 * Coordinate spaces:
 *
 * - Client:   CSS pixels relative to the browser window (PointerEvent.clientX/Y).
 * - Viewport: CSS pixels relative to the workspace canvas's top-left corner.
 * - Image:    fractional image pixels; (0, 0) is the image's top-left corner.
 * - Pixel:    integer pixel indices within the image (see PixelCoordinate).
 *
 *   viewport = offset + image × zoom
 *   image    = (viewport − offset) / zoom
 */

/**
 * Converts a pointer position to viewport space. Pass the element's current
 * getBoundingClientRect() — read it at event time rather than caching it, so layout
 * changes cannot shift hit-testing. The element must have no border or padding.
 */
export function clientToViewport(
  client: Point,
  elementRect: { readonly left: number; readonly top: number },
): Point {
  return { x: client.x - elementRect.left, y: client.y - elementRect.top }
}

export function viewportToImage(viewport: ViewportState, point: Point): Point {
  return {
    x: (point.x - viewport.offset.x) / viewport.zoom,
    y: (point.y - viewport.offset.y) / viewport.zoom,
  }
}

export function imageToViewport(viewport: ViewportState, point: Point): Point {
  return {
    x: viewport.offset.x + point.x * viewport.zoom,
    y: viewport.offset.y + point.y * viewport.zoom,
  }
}

/**
 * Returns the image pixel under a viewport point, or null when the point is outside
 * the image. Pixel edges are half-open: a point exactly on the boundary between two
 * pixels belongs to the right/lower pixel, and the image's right and bottom edges
 * are outside it.
 */
export function viewportToPixel(
  viewport: ViewportState,
  point: Point,
  imageSize: Size,
): PixelCoordinate | null {
  const image = viewportToImage(viewport, point)
  // Written so NaN fails every comparison and returns null.
  if (!(image.x >= 0 && image.x < imageSize.width && image.y >= 0 && image.y < imageSize.height)) {
    return null
  }
  return { x: Math.floor(image.x), y: Math.floor(image.y) }
}

/**
 * How far below a whole number an image coordinate may be computed and still count as
 * exactly on that pixel edge. Covers floating-point error only.
 */
const EDGE_TOLERANCE = 1e-6

/**
 * The image pixel shown under the pointer at `point` (viewport space), or null outside the
 * image. Pass the display viewport, the one the image is drawn with, so image edges lie on
 * device pixel edges.
 *
 * This follows how the canvas draws the image without smoothing: each device pixel shows
 * the image pixel at its centre, and when an edge between two image pixels passes exactly
 * through that centre (common at zoom × device pixel ratio values such as 1.5 or 2.5),
 * Chrome and Firefox both show the left or upper pixel. Unlike viewportToPixel, which
 * assigns a point on an edge to the right or lower pixel, the result is therefore exactly
 * the pixel the user sees under the pointer.
 */
export function pixelUnderPointer(
  viewport: ViewportState,
  point: Point,
  imageSize: Size,
  devicePixelRatio: number,
): PixelCoordinate | null {
  const image = viewportToImage(viewport, devicePixelCentre(point, devicePixelRatio))
  const x = Math.ceil(image.x - EDGE_TOLERANCE) - 1
  const y = Math.ceil(image.y - EDGE_TOLERANCE) - 1
  // Written so NaN fails every comparison and returns null.
  if (!(x >= 0 && x < imageSize.width && y >= 0 && y < imageSize.height)) return null
  return { x, y }
}

/**
 * The image column (or row) drawn at a device pixel, by the same rule as pixelUnderPointer: the
 * pixel at the device pixel's centre, with an edge exactly through that centre given to the left
 * or upper pixel.
 *
 * `devicePixel` counts whole device pixels from the image's top-left corner, which the display
 * viewport puts on a device pixel edge; `scale` is device pixels per image pixel (zoom × device
 * pixel ratio). The result is not clamped: below 0 or at the image size and beyond, the device
 * pixel is outside the image.
 */
export function imageIndexAtDevicePixel(devicePixel: number, scale: number): number {
  return Math.ceil((devicePixel + 0.5) / scale - EDGE_TOLERANCE) - 1
}

/**
 * The first and last image columns (or rows) a device pixel overlaps, when zoomed out far enough
 * that one device pixel can cover several image pixels. Arguments are as for
 * imageIndexAtDevicePixel; pixels that only touch the device pixel's edge are not included. The
 * result is not clamped to the image.
 */
export function imageSpanAtDevicePixel(devicePixel: number, scale: number): { first: number; last: number } {
  return {
    first: Math.floor(devicePixel / scale + EDGE_TOLERANCE),
    last: Math.ceil((devicePixel + 1) / scale - EDGE_TOLERANCE) - 1,
  }
}

/** The area the whole image occupies in viewport space. */
export function imageRectInViewport(viewport: ViewportState, imageSize: Size): Rectangle {
  return {
    x: viewport.offset.x,
    y: viewport.offset.y,
    width: imageSize.width * viewport.zoom,
    height: imageSize.height * viewport.zoom,
  }
}
