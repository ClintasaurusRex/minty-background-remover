import type { PixelCoordinate, Point, Rectangle, Size, ViewportState } from '../editor/types'
import { devicePixelIndex, imageDrawBias } from './devicePixels'

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
 * changes cannot shift hit-testing — and the current device pixel ratio. The element
 * must have no border or padding.
 *
 * Viewport space starts at the canvas's corner as the browser places it on screen: on the
 * device pixel nearest its layout position (browsers round each edge to a device pixel). Where
 * layout puts the canvas on a fractional device pixel (ratios such as 1.1), measuring from the
 * unrounded position would put pointers up to half a device pixel off, and in the device pixel
 * before the one under the hotspot when the corner was rounded down (Phase 4 zoom follow-up).
 */
export function clientToViewport(
  client: Point,
  elementRect: { readonly left: number; readonly top: number },
  devicePixelRatio: number,
): Point {
  return {
    x: client.x - screenCorner(elementRect.left, devicePixelRatio),
    y: client.y - screenCorner(elementRect.top, devicePixelRatio),
  }
}

/** Where the browser puts an element edge at layout position `position` (CSS px): the nearest device pixel. */
function screenCorner(position: number, devicePixelRatio: number): number {
  return devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? Math.round(position * devicePixelRatio) / devicePixelRatio : position
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
 * How close (in image pixels) a computed coordinate may come to a whole number and still count as
 * on it, for the zoomed-out spans. Covers floating-point error only.
 */
const EDGE_TOLERANCE = 1e-6

/**
 * The image pixel shown under the pointer at `point` (viewport space), or null outside the
 * image. Pass the display viewport (toDisplayViewport), the one the image is drawn with, so its
 * scale is a grid scale and its corner lies on a device pixel edge.
 *
 * The pointer is in one device pixel (devicePixelIndex), and that device pixel shows the image
 * pixel imageIndexAtDevicePixel gives: the rule the workspace renderer makes every browser follow
 * (devicePixels.ts, the display scale grid and imageDrawBias). Every pointer tool (Magic Wand,
 * Eyedropper, the status bar readout) therefore gets exactly the pixel the user sees under the
 * pointer, at every zoom, pan and device pixel ratio, fractional ones included. Unlike
 * viewportToPixel, which takes the exact pointer position, an image pixel edge inside the
 * pointer's device pixel does not matter.
 */
export function pixelUnderPointer(
  viewport: ViewportState,
  point: Point,
  imageSize: Size,
  devicePixelRatio: number,
): PixelCoordinate | null {
  const scale = viewport.zoom * devicePixelRatio
  const bias = imageDrawBias(scale)
  const x = imageIndexAtDevicePixel(devicePixelIndex(point.x, devicePixelRatio) - imageCornerDevicePixel(viewport.offset.x, devicePixelRatio), scale, bias)
  const y = imageIndexAtDevicePixel(devicePixelIndex(point.y, devicePixelRatio) - imageCornerDevicePixel(viewport.offset.y, devicePixelRatio), scale, bias)
  // Written so NaN fails every comparison and returns null.
  if (!(x >= 0 && x < imageSize.width && y >= 0 && y < imageSize.height)) return null
  return { x, y }
}

/**
 * The device pixel (counted from the canvas's corner) holding the image's top-left corner, for a
 * display viewport offset (CSS px), whose offset lies on a device pixel edge.
 */
export function imageCornerDevicePixel(offset: number, devicePixelRatio: number): number {
  return Math.round(offset * devicePixelRatio)
}

/**
 * The image column (or row) the canvas draws at a device pixel: the image pixel under the device
 * pixel's centre, with the image drawn `bias` device pixels right of (below) its corner, which is
 * imageDrawBias(scale) unless given (pass it in loops, to work it out once).
 *
 * `devicePixel` counts whole device pixels from the image's top-left corner, which the display
 * viewport puts on a device pixel edge (imageCornerDevicePixel); `scale` is device pixels per image
 * pixel (zoom × device pixel ratio). The result is not clamped: below 0 or at the image size and
 * beyond, the device pixel is outside the image.
 *
 * At a grid scale (every unsmoothed display viewport; devicePixels.ts) no device pixel centre is
 * within 1/128 device pixel of an image pixel edge in exact arithmetic (1/162 at 100% on a ratio
 * accepted within the grid's tolerance), so the browser has no tie to break and draws
 * exactly this pixel. This is the single rule for what is shown where: the renderer's transform
 * uses the same bias, the selection overlay is rasterised with it, the crop overlay's edges and
 * the checkerboard come from it (devicePixelBoundary), and pointer tools hit-test with it
 * (pixelUnderPointer).
 */
export function imageIndexAtDevicePixel(devicePixel: number, scale: number, bias = imageDrawBias(scale)): number {
  return Math.floor((devicePixel + 0.5 - bias) / scale)
}

/**
 * The first device pixel (from the image's corner, as for imageIndexAtDevicePixel) that shows image
 * column (or row) `edge` or a later one: where the boundary in front of `edge` is drawn. 0 for the
 * image's first column; the number of device pixels showing the image for its width.
 *
 * Found from imageIndexAtDevicePixel itself, so an outline drawn there separates exactly the device
 * pixels showing the pixels before `edge` from those showing `edge` and after.
 */
export function devicePixelBoundary(edge: number, scale: number, bias = imageDrawBias(scale)): number {
  // The estimate is exact except within floating-point error of a centre; settle it by the rule.
  let device = Math.ceil(edge * scale - 0.5 + bias)
  while (imageIndexAtDevicePixel(device - 1, scale, bias) >= edge) device--
  while (imageIndexAtDevicePixel(device, scale, bias) < edge) device++
  return device
}

/**
 * The first and last image columns (or rows) a device pixel overlaps, when zoomed out far enough
 * that one device pixel can cover several image pixels. Arguments are as for
 * imageIndexAtDevicePixel; pixels that only touch the device pixel's edge are not included. The
 * result is not clamped to the image.
 *
 * Zoomed out, the image is drawn smoothed, so a device pixel shows a blend rather than one pixel and
 * there is no tie for the browser to break: this conservative coverage rule ignores imageDrawBias
 * (at most 1/4 device pixel, and 0 at smoothed scales that are not grid scales), so no selected
 * pixel can ever be left unmarked.
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
