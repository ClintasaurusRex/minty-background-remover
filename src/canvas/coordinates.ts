import type { PixelCoordinate, Point, Rectangle, Size, ViewportState } from '../editor/types'

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

/** The area the whole image occupies in viewport space. */
export function imageRectInViewport(viewport: ViewportState, imageSize: Size): Rectangle {
  return {
    x: viewport.offset.x,
    y: viewport.offset.y,
    width: imageSize.width * viewport.zoom,
    height: imageSize.height * viewport.zoom,
  }
}
