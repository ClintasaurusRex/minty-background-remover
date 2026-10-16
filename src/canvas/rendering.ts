import type { Point, Rectangle, Size, ViewportState } from '../editor/types'
import { imageRectInViewport, viewportToImage } from './coordinates'
import { type CanvasTransform, backingStoreSize, deviceTransform } from './devicePixels'

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
}

export interface CheckerDraw {
  /** Visible part of the image, in backing-store pixels. */
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

export function planFrame({ imageSize, viewport, viewportSize, devicePixelRatio }: FrameInput): FramePlan {
  const backingStore = backingStoreSize(viewportSize, devicePixelRatio)
  const visible = intersect(imageRectInViewport(viewport, imageSize), {
    x: 0,
    y: 0,
    width: viewportSize.width,
    height: viewportSize.height,
  })
  const source = visible && visibleSourceRect(viewport, imageSize, visible)
  if (!visible || !source) return { backingStore, checker: null, image: null }

  return {
    backingStore,
    checker: {
      rect: {
        x: visible.x * devicePixelRatio,
        y: visible.y * devicePixelRatio,
        width: visible.width * devicePixelRatio,
        height: visible.height * devicePixelRatio,
      },
      origin: {
        x: Math.round(viewport.offset.x * devicePixelRatio),
        y: Math.round(viewport.offset.y * devicePixelRatio),
      },
      squareSize: checkerSquareSize(devicePixelRatio),
    },
    image: {
      transform: deviceTransform(viewport, devicePixelRatio),
      source,
      smoothing: usesSmoothing(viewport.zoom),
    },
  }
}

export function usesSmoothing(zoom: number): boolean {
  return zoom < 1
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
