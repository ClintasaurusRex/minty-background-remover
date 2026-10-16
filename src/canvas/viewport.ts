import type { Point, Size, ViewportState } from '../editor/types'
import { viewportToImage } from './coordinates'

export const MIN_ZOOM = 0.01
export const MAX_ZOOM = 32

/** Zoom In / Zoom Out stops, ascending, from MIN_ZOOM to MAX_ZOOM. */
export const ZOOM_STEPS: readonly number[] = [
  0.01, 0.02, 0.03, 0.05, 0.08, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8,
  12, 16, 24, 32,
]

/**
 * Space left around an image fitted to the viewport, in CSS pixels.
 * Matches the workspace padding (--space-5).
 */
export const DEFAULT_FIT_MARGIN = 24

/** Relative tolerance so zoom values with floating-point noise still match a step. */
const STEP_EPSILON = 1e-9

export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * The next zoom stop above (direction 1) or below (direction -1) the current zoom.
 * Off-ladder zoom levels (e.g. after Fit or wheel zoom) move to the nearest stop in
 * that direction. At either end of the range, the limit is returned.
 */
export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = ZOOM_STEPS.find((step) => step > zoom * (1 + STEP_EPSILON))
    return next ?? MAX_ZOOM
  }
  const previous = ZOOM_STEPS.findLast((step) => step < zoom * (1 - STEP_EPSILON))
  return previous ?? MIN_ZOOM
}

/**
 * Changes zoom while keeping the image point under `anchor` (a viewport point) fixed
 * on screen. Use the pointer position for wheel zoom and the viewport centre for
 * toolbar zoom. The requested zoom is clamped to the supported range.
 */
export function zoomAt(viewport: ViewportState, anchor: Point, zoom: number): ViewportState {
  const nextZoom = clampZoom(zoom)
  const imagePoint = viewportToImage(viewport, anchor)
  return {
    zoom: nextZoom,
    offset: {
      x: anchor.x - imagePoint.x * nextZoom,
      y: anchor.y - imagePoint.y * nextZoom,
    },
  }
}

/** Zooms about the centre of a viewport of the given size. */
export function zoomAtCentre(
  viewport: ViewportState,
  viewportSize: Size,
  zoom: number,
): ViewportState {
  return zoomAt(viewport, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, zoom)
}

/** The offset that centres an image of the given size at the given zoom. */
export function centredOffset(imageSize: Size, viewportSize: Size, zoom: number): Point {
  return {
    x: (viewportSize.width - imageSize.width * zoom) / 2,
    y: (viewportSize.height - imageSize.height * zoom) / 2,
  }
}

/**
 * The largest zoom at which the whole image fits inside the viewport minus `margin`
 * on every side, never above 100% (small images are not upscaled) and never below
 * MIN_ZOOM (so a huge image in a tiny viewport may still overflow).
 */
export function fitZoom(imageSize: Size, viewportSize: Size, margin = DEFAULT_FIT_MARGIN): number {
  const availableWidth = Math.max(0, viewportSize.width - margin * 2)
  const availableHeight = Math.max(0, viewportSize.height - margin * 2)
  return clampZoom(
    Math.min(1, availableWidth / imageSize.width, availableHeight / imageSize.height),
  )
}

/**
 * Fit to Screen, also used for initial placement: larger images are scaled down to
 * fit, smaller images are shown at 100%, and the image is centred either way.
 */
export function fitViewport(
  imageSize: Size,
  viewportSize: Size,
  margin = DEFAULT_FIT_MARGIN,
): ViewportState {
  const zoom = fitZoom(imageSize, viewportSize, margin)
  return { zoom, offset: centredOffset(imageSize, viewportSize, zoom) }
}

/** Moves the image by `delta` CSS pixels; dragging right by 10 px moves the image right by 10 px. */
export function panBy(viewport: ViewportState, delta: Point): ViewportState {
  return {
    zoom: viewport.zoom,
    offset: { x: viewport.offset.x + delta.x, y: viewport.offset.y + delta.y },
  }
}

/**
 * Adjusts the viewport when the workspace changes size so the image point at the
 * centre of the old viewport stays at the centre of the new one. Zoom is unchanged.
 */
export function resizeViewport(
  viewport: ViewportState,
  previousSize: Size,
  nextSize: Size,
): ViewportState {
  return panBy(viewport, {
    x: (nextSize.width - previousSize.width) / 2,
    y: (nextSize.height - previousSize.height) / 2,
  })
}
