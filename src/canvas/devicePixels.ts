import type { Size, ViewportState } from '../editor/types'

/*
 * Device pixel ratio is applied only here, at the rendering boundary. Viewport state
 * and hit-testing stay in CSS pixels so they are identical on every display.
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
