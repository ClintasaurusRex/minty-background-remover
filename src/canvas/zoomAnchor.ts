import type { Point, ViewportState } from '../editor/types'
import { imageIndexAtDevicePixel } from './coordinates'
import { deviceTransform, devicePixelIndex, displayZoom, imageDrawBias } from './devicePixels'

/*
 * Zoom anchoring against the image as drawn (Phase 4 zoom follow-up, Codex 2026-11-11).
 *
 * Zooming keeps the image point the user sees under the pointer there. "Sees" means as drawn: the
 * image is drawn with the display viewport (display zoom, offset snapped to whole device pixels)
 * and the drawing bias of its scale (devicePixels.ts), not with the stored viewport, and a point
 * measured with the stored viewport is up to the bias plus the snapping (3/4 device pixel) away
 * from it. Every later zoom magnifies such an error: zooming from 100% to 3200% at 150% scaling
 * moved the point 7.5 device pixels.
 *
 * Both directions therefore go through the drawing transform: imagePointAtPointer measures the
 * point with deviceTransform, and viewportDrawingAt places it with the exact inverse, on whole
 * device pixels. The error left is that one snap, at most a device pixel, and it is never
 * magnified: a zoom continuing a gesture keeps the gesture's first point (editor/editorState.ts,
 * zoomAbout), and placing it never starts from an earlier snapped result.
 */

/**
 * The image point drawn at viewport point `point` (CSS px) with the display viewport `display`
 * (toDisplayViewport): measured through the very transform the image is drawn with, including its
 * snapped offset and drawing bias.
 */
export function imagePointAtPointer(display: ViewportState, point: Point, devicePixelRatio: number): Point {
  const transform = deviceTransform(display, devicePixelRatio)
  return {
    x: (point.x * devicePixelRatio - transform.e) / transform.a,
    y: (point.y * devicePixelRatio - transform.f) / transform.d,
  }
}

/** How close (device px) an exact placement may be to a whole device pixel and still count as on it. */
const WHOLE_TOLERANCE = 1e-6

/**
 * The viewport at stored zoom `zoom` that draws image point `image` at viewport point `point`, as
 * nearly as an offset on whole device pixels allows (so the display viewport is this viewport).
 *
 * Of the two whole device pixel offsets either side of the exact one, the nearer is used unless
 * only the other shows image pixel floor(`image`) in the device pixel containing `point`, the pixel
 * pointer tools read there (pixelUnderPointer): then that one, so the pixel under the pointer stays
 * the same as zooming in brings it closer. The point therefore stays within half a device pixel of
 * `point`, or within one device pixel where keeping its pixel needs it. An exact placement (on a
 * whole device pixel already, as when zooming back to where a gesture started) is always kept.
 */
export function viewportDrawingAt(image: Point, point: Point, zoom: number, devicePixelRatio: number): ViewportState {
  const scale = displayZoom(zoom, devicePixelRatio) * devicePixelRatio
  const bias = imageDrawBias(scale)
  const corner = (imagePosition: number, position: number): number => {
    // Where the image's corner goes, in device pixels from the canvas's corner, to draw the point
    // exactly at `position`.
    const exact = position * devicePixelRatio - bias - imagePosition * scale
    const nearer = Math.round(exact)
    if (Math.abs(exact - nearer) <= WHOLE_TOLERANCE) return nearer
    const other = nearer < exact ? nearer + 1 : nearer - 1
    const device = devicePixelIndex(position, devicePixelRatio)
    const pixel = Math.floor(imagePosition)
    const keeps = (candidate: number) => imageIndexAtDevicePixel(device - candidate, scale, bias) === pixel
    return keeps(nearer) || !keeps(other) ? nearer : other
  }
  return {
    zoom,
    offset: {
      x: corner(image.x, point.x) / devicePixelRatio,
      y: corner(image.y, point.y) / devicePixelRatio,
    },
  }
}
