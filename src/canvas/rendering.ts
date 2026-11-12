import type { Point, Rectangle, Size, ViewportState } from '../editor/types'
import { devicePixelBoundary, imageCornerDevicePixel, imageRectInViewport, viewportToImage } from './coordinates'
import { type CanvasTransform, backingStoreSize, deviceTransform, isGridScale } from './devicePixels'

/*
 * Pure frame planning for the workspace canvas. The canvas covers only the visible
 * workspace, so its backing store never grows with zoom. Everything outside the
 * image is left transparent so the workspace's CSS dot grid shows through.
 */

/** Checkerboard square size, in CSS pixels. Constant on screen at every zoom. */
export const CHECKER_SQUARE_CSS_PX = 8

/** Neutral dark greys for the transparency checkerboard (UI only, never exported). */
export const CHECKER_COLOURS = { light: '#3a3a3a', dark: '#2c2c2c' } as const

export interface FrameInput {
  readonly imageSize: Size
  /** The display viewport (already snapped), in CSS pixels. */
  readonly viewport: ViewportState
  /** The canvas element's size, in CSS pixels. */
  readonly viewportSize: Size
  readonly devicePixelRatio: number
  /** The canvas's content box in device pixels as the browser lays it out, when known (backingStoreSize). */
  readonly deviceSize?: Size | null
}

export interface CheckerDraw {
  /**
   * Visible part of the image in whole backing-store pixels: exactly the device pixels the image is
   * drawn on (shownDeviceRect), so no edge pixel is partly covered.
   */
  readonly rect: Rectangle
  /** Where a square starts, in whole backing-store pixels, so the pattern stays anchored to the image. */
  readonly origin: Point
  /** Square size in whole backing-store pixels. */
  readonly squareSize: number
}

export interface ImageDraw {
  /** Maps image pixels to backing-store pixels. */
  readonly transform: CanvasTransform
  /** Whole image pixels covering the visible area; drawn at the same image coordinates. */
  readonly source: Rectangle
  /** Smooth when downscaling (below 100%), nearest-neighbour at 100% and above. */
  readonly smoothing: boolean
}

export interface FramePlan {
  readonly backingStore: Size
  /** Null when no part of the image is visible. */
  readonly checker: CheckerDraw | null
  readonly image: ImageDraw | null
}

export function planFrame({ imageSize, viewport, viewportSize, devicePixelRatio, deviceSize }: FrameInput): FramePlan {
  const backingStore = backingStoreSize(viewportSize, devicePixelRatio, deviceSize)
  const visible = intersect(imageRectInViewport(viewport, imageSize), {
    x: 0,
    y: 0,
    width: viewportSize.width,
    height: viewportSize.height,
  })
  const source = visible && visibleSourceRect(viewport, imageSize, visible)
  if (!visible || !source) return { backingStore, checker: null, image: null }

  const origin = {
    x: imageCornerDevicePixel(viewport.offset.x, devicePixelRatio),
    y: imageCornerDevicePixel(viewport.offset.y, devicePixelRatio),
  }
  const checker = shownDeviceRect(origin, imageSize, viewport.zoom * devicePixelRatio, backingStore)
  if (!checker) return { backingStore, checker: null, image: null }

  return {
    backingStore,
    checker: {
      rect: checker,
      origin,
      squareSize: checkerSquareSize(devicePixelRatio),
    },
    image: {
      transform: deviceTransform(viewport, devicePixelRatio),
      source,
      smoothing: usesSmoothing(viewport.zoom, devicePixelRatio),
    },
  }
}

/**
 * The device pixels the image is drawn on, clipped to the backing store: from its corner (`origin`,
 * whole device pixels) to the boundary after its last column and row (devicePixelBoundary). The
 * canvas fills a device pixel with the image when its centre is inside the drawn image (which starts
 * imageDrawBias(scale) past the corner), which is exactly this rectangle. Null when none is visible.
 */
export function shownDeviceRect(origin: Point, imageSize: Size, scale: number, backingStore: Size): Rectangle | null {
  const left = Math.max(0, origin.x)
  const top = Math.max(0, origin.y)
  const right = Math.min(backingStore.width, origin.x + devicePixelBoundary(imageSize.width, scale))
  const bottom = Math.min(backingStore.height, origin.y + devicePixelBoundary(imageSize.height, scale))
  if (!(right > left && bottom > top)) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * Whether two plans draw exactly the same frame of the same image: same backing store,
 * checkerboard and image placement. The renderer skips such frames, so renders that do not
 * change the view (selection changes, Magic Wand options, the tolerance) never draw the image
 * again.
 */
export function sameFramePlan(a: FramePlan, b: FramePlan): boolean {
  if (a.backingStore.width !== b.backingStore.width || a.backingStore.height !== b.backingStore.height) return false
  if (a.checker === null || b.checker === null) {
    if (a.checker !== b.checker) return false
  } else if (
    !sameRectangle(a.checker.rect, b.checker.rect) ||
    a.checker.origin.x !== b.checker.origin.x ||
    a.checker.origin.y !== b.checker.origin.y ||
    a.checker.squareSize !== b.checker.squareSize
  ) {
    return false
  }
  if (a.image === null || b.image === null) return a.image === b.image
  const [s, t] = [a.image.transform, b.image.transform]
  return (
    s.a === t.a &&
    s.b === t.b &&
    s.c === t.c &&
    s.d === t.d &&
    s.e === t.e &&
    s.f === t.f &&
    sameRectangle(a.image.source, b.image.source) &&
    a.image.smoothing === b.image.smoothing
  )
}

function sameRectangle(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * Whether the image is drawn smoothed at display zoom `zoom`: below 100%, and at exactly 100% where
 * the device pixel ratio is not a grid scale (Actual Size, Option D: exactly 100% but no guaranteed
 * crisp drawing; devicePixels.ts, displayZoom). Smoothing changes only what is shown, a blend of
 * neighbouring image pixels; tools still read the stored pixel nearest the pointer's device pixel
 * centre (pixelUnderPointer), the largest part of that blend, and every edit uses the stored pixels.
 */
export function usesSmoothing(zoom: number, devicePixelRatio: number): boolean {
  return zoom < 1 || (zoom === 1 && !isGridScale(devicePixelRatio))
}

export function checkerSquareSize(devicePixelRatio: number): number {
  return Math.max(1, Math.round(CHECKER_SQUARE_CSS_PX * devicePixelRatio))
}

/**
 * The whole image pixels that cover a visible viewport rectangle, clamped to the
 * image. Drawing only these keeps large, highly zoomed images cheap to draw.
 */
export function visibleSourceRect(
  viewport: ViewportState,
  imageSize: Size,
  visible: Rectangle,
): Rectangle | null {
  const topLeft = viewportToImage(viewport, visible)
  const bottomRight = viewportToImage(viewport, {
    x: visible.x + visible.width,
    y: visible.y + visible.height,
  })
  const left = Math.max(0, Math.floor(topLeft.x))
  const top = Math.max(0, Math.floor(topLeft.y))
  const right = Math.min(imageSize.width, Math.ceil(bottomRight.x))
  const bottom = Math.min(imageSize.height, Math.ceil(bottomRight.y))
  if (!(right > left && bottom > top)) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The overlap of two rectangles, or null if they do not overlap. */
export function intersect(a: Rectangle, b: Rectangle): Rectangle | null {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (!(right > left && bottom > top)) return null
  return { x: left, y: top, width: right - left, height: bottom - top }
}
