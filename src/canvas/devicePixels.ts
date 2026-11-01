import type { Point, Size, ViewportState } from '../editor/types'

/*
 * Device pixel ratio is applied only here, at the rendering boundary. Viewport state
 * and hit-testing stay in CSS pixels so they are identical on every display; the one
 * exception is finding the device pixel a pointer is in (devicePixelCentre).
 */

/** Arguments for CanvasRenderingContext2D.setTransform(a, b, c, d, e, f). */
export interface CanvasTransform {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

/**
 * The canvas backing-store size for an element of `cssSize`, so one backing-store
 * pixel maps to one device pixel.
 */
export function backingStoreSize(cssSize: Size, devicePixelRatio: number): Size {
  return {
    width: Math.max(0, Math.round(cssSize.width * devicePixelRatio)),
    height: Math.max(0, Math.round(cssSize.height * devicePixelRatio)),
  }
}

/** Maps image coordinates to backing-store (device) pixels for drawing the image. */
export function deviceTransform(viewport: ViewportState, devicePixelRatio: number): CanvasTransform {
  const scale = viewport.zoom * devicePixelRatio
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: viewport.offset.x * devicePixelRatio,
    f: viewport.offset.y * devicePixelRatio,
  }
}

/**
 * Rounds the offset to whole device pixels so image pixel edges land on device pixel
 * edges, keeping nearest-neighbour rendering crisp.
 *
 * Apply this to the viewport shared by rendering and hit-testing (see
 * displayViewport in editor/editorState.ts), never inside the renderer alone, so the
 * image is drawn and hit-tested with exactly the same offset.
 */
export function snapToDevicePixels(
  viewport: ViewportState,
  devicePixelRatio: number,
): ViewportState {
  return {
    zoom: viewport.zoom,
    offset: {
      x: Math.round(viewport.offset.x * devicePixelRatio) / devicePixelRatio,
      y: Math.round(viewport.offset.y * devicePixelRatio) / devicePixelRatio,
    },
  }
}

/**
 * Mouse positions lie exactly on device pixel edges (the top-left corner of the device
 * pixel under the hotspot). Browsers round DOM coordinates (Firefox to 32-bit floats, and
 * element positions such as 101.333… CSS px at 150% scaling), so a position computed from
 * them can land a hair before that edge. Positions this close (in device pixels) to the
 * next device pixel count as inside it.
 */
const DEVICE_EDGE_TOLERANCE = 0.01

/**
 * The centre of the device pixel containing `point` (CSS px, relative to the canvas).
 *
 * The canvas shows each device pixel in the colour of the image pixel at its centre. At
 * zoom levels where image pixel edges fall inside device pixels, the exact pointer
 * position can lie on one side of such an edge while its device pixel shows the image
 * pixel on the other side. Hit-testing this centre instead selects exactly the image
 * pixel shown under the pointer.
 */
export function devicePixelCentre(point: Point, devicePixelRatio: number): Point {
  return {
    x: (Math.floor(point.x * devicePixelRatio + DEVICE_EDGE_TOLERANCE) + 0.5) / devicePixelRatio,
    y: (Math.floor(point.y * devicePixelRatio + DEVICE_EDGE_TOLERANCE) + 0.5) / devicePixelRatio,
  }
}
