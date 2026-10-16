/*
 * Converts Ctrl + wheel input into zoom factors. Mouse wheels, trackpad pinches
 * (reported as Ctrl + wheel) and different browsers report deltas in different
 * units, so everything is normalised to pixels first.
 */

/** WheelEvent.deltaMode values. */
export const DOM_DELTA_PIXEL = 0
export const DOM_DELTA_LINE = 1
export const DOM_DELTA_PAGE = 2

/** Pixels per line, so three lines (a typical Firefox notch) match a 100 px Chrome notch. */
export const WHEEL_LINE_PX = 100 / 3

/** Zoom multiplier per 100 px of wheel movement (one typical mouse wheel notch). */
export const WHEEL_ZOOM_PER_100PX = 1.25

/** Largest movement honoured from a single event, so unusual devices cannot jump wildly. */
export const MAX_WHEEL_DELTA_PX = 300

/** The vertical wheel movement in CSS pixels. `pageHeight` is used for page-based deltas. */
export function wheelDeltaPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (!Number.isFinite(deltaY)) return 0
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return deltaY * WHEEL_LINE_PX
    case DOM_DELTA_PAGE:
      return deltaY * pageHeight
    default:
      return deltaY
  }
}

/**
 * The zoom multiplier for a wheel movement in pixels. Scrolling up (negative delta)
 * zooms in. Factors multiply, so equal movements up and down cancel out exactly.
 */
export function wheelZoomFactor(deltaPixels: number): number {
  const clamped = Math.max(-MAX_WHEEL_DELTA_PX, Math.min(MAX_WHEEL_DELTA_PX, deltaPixels))
  return WHEEL_ZOOM_PER_100PX ** (-clamped / 100)
}
