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
 * pixel maps to one device pixel: `deviceSize` when the browser reported it (the element's
 * device-pixel-content-box, ImageCanvas.tsx), else the CSS size times the ratio, rounded.
 *
 * The browser places an element's edges on device pixels by rounding each edge. Where the
 * element's top or left lies on a fractional device pixel (layout above it of fractional height,
 * common at ratios such as 1.1), the rounded size can be one device pixel larger or smaller than
 * the box the browser actually gives the canvas, and the browser then scales the whole bitmap to
 * fit: nothing on screen is then exactly the canvas's pixel (Phase 4 zoom follow-up, 2026-11-11).
 */
export function backingStoreSize(cssSize: Size, devicePixelRatio: number, deviceSize?: Size | null): Size {
  if (deviceSize && deviceSize.width >= 0 && deviceSize.height >= 0 && Number.isInteger(deviceSize.width) && Number.isInteger(deviceSize.height)) {
    return { width: deviceSize.width, height: deviceSize.height }
  }
  return {
    width: Math.max(0, Math.round(cssSize.width * devicePixelRatio)),
    height: Math.max(0, Math.round(cssSize.height * devicePixelRatio)),
  }
}

/*
 * The display scale grid (Phase 4 audit corrections; arbitrary-zoom regression of 2026-11-11).
 *
 * Without smoothing, the canvas fills each device pixel with the image pixel at its centre. When a
 * boundary between two image pixels passes exactly (or within the browser's rounding) through a
 * device pixel centre, which side the browser draws is not specified, and Chrome and Firefox were
 * measured choosing differently with position, scale and the floating-point error of the scale's
 * inverse. Every tool would then have to guess. No fixed offset avoids that at every zoom: wheel
 * zoom and trackpad pinch reach any scale, and for any fixed offset some scale puts a boundary
 * exactly on a centre (the fixed 3/128 offset used before failed at 189/128, 147.65625%).
 *
 * Instead, unsmoothed views (100% and above) are displayed at the nearest *grid scale*: a fraction
 * p / q (lowest terms) with p and q at most GRID_LIMIT, or a whole number. With the image's corner
 * on a device pixel edge, image pixel boundaries then lie at multiples of 1 / q device pixel, and
 * imageDrawBias(scale) shifts them by half a step where needed (q even).
 *
 * What is proved, and what is only observed (Codex follow-up, 2026-11-11):
 * - Exact arithmetic, scale exactly p / q: no device pixel centre is closer than 1 / (2q) device
 *   pixels (at least 1/128) to any boundary, which is also at least 1 / (2p) image pixels (at least
 *   1/128 of a texel) inside the image pixel. (With q odd, boundaries are at multiples of 1 / q and
 *   centres at odd multiples of 1 / 2; with q even, the shift puts boundaries at odd multiples of
 *   1 / (2q); either way the distance is a nonzero multiple of 1 / (2q).) Zooms above 100% are
 *   displayed at grid scales up to double-precision rounding (about 1e-15 relatively), which moves
 *   boundaries by under 1e-9 device pixels across the largest image (16,384 pixels).
 * - Exactly 100%: the scale is the device pixel ratio itself, accepted as grid scale g = p / q when
 *   within GRID_TOLERANCE of it (single-precision ratios, such as Chrome's 1.100000023841858).
 *   Boundary k then moves k·|s − g|, so the bound is 1 / (2q) − N·|s − g| for an image N pixels
 *   across: with N ≤ 16,384 and |s − g| ≤ 1e-7·g, g ≤ 64 / q, at least 0.395 / q device pixels
 *   (at least 1/162) and 0.395 / p texels. Codex's ratio 1.0158731073015872 (9.1e-8 above 64/63)
 *   leaves 0.00644 device pixels at boundary 16,348: below 1/128, above this bound.
 * - Not proved: what the browsers compute. They hold canvas transforms in single precision and GPUs
 *   sample with limited sub-texel precision; the margins above are many times the rounding measured
 *   in headless Chrome and Firefox (about 0.001 device pixels), and the browser tests check the
 *   result there, but real GPUs and drivers have not been measured.
 *
 * The displayed zoom differs from the requested zoom by at most 0.80% up to a device scale of 4,
 * 0.95% up to 16, 1.15% up to 32 and 1.54% above (measured; above a device scale of 32 only whole
 * numbers remain, so neighbouring displayed scales are up to 3.1% apart). Every zoom step at
 * display scaling in quarters (device pixel ratios 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4) is a
 * grid scale already, as is every step up to 200% at browser zoom levels such as 110% and 133% and
 * Firefox's 60 / n ratios (12/11, 30/17), so they are displayed exactly as requested. At ratios
 * that are not within GRID_TOLERANCE of a grid scale (Chrome at 101% scaling) exactly 100% is
 * still displayed at exactly 100%, smoothed (displayZoom, usesSmoothing); any other zoom from 100%
 * up is displayed at a grid scale (101% at 1.01 is drawn at 64/63, 100.58%).
 */

/** The largest numerator and denominator of a fractional grid scale. */
export const GRID_LIMIT = 64

/**
 * Relative distance within which a scale counts as a grid scale: covers device pixel ratios that
 * browsers store in single precision (Chrome reports 1.100000023841858 for 110%). Distinct grid
 * scales are always more than 3.8e-6 apart relatively, so this never confuses two of them.
 */
const GRID_TOLERANCE = 1e-7

/** A grid scale: its value and its denominator in lowest terms (1 for whole numbers). */
interface GridScale {
  readonly value: number
  readonly denominator: number
}

/**
 * The largest zoom displayed: MAX_ZOOM (canvas/viewport.ts, 3200%; FEATURE_SPEC.md §3, "Zoom range:
 * 1% to 3200%"), repeated here so this module needs nothing above it; a test checks they agree.
 * Without it, 3200% at Firefox's 60/59 (101% scaling) was displayed at device scale 33: 3245%.
 */
export const MAX_DISPLAY_ZOOM = 32

/**
 * The grid scale nearest to `scale` that is at least `minimum` and at most `maximum` (ties: the
 * smaller denominator). Whole numbers are always candidates, so there is one whenever `minimum` ≤
 * ceil(`scale`) and some whole number lies between `minimum` and `maximum`.
 */
function nearestGridScale(scale: number, minimum: number, maximum = Infinity): GridScale | null {
  let value = NaN
  let denominator = 0
  let bestError = Infinity
  for (let q = 1; q <= GRID_LIMIT; q++) {
    const below = Math.floor(scale * q)
    for (let p = below; p <= below + 1; p++) {
      if (p < 1 || (q > 1 && p > GRID_LIMIT)) continue
      const candidate = p / q
      const error = Math.abs(candidate - scale)
      // Denominators ascend and only a strictly better value replaces the best, so an equal value
      // found again (a fraction not in lowest terms) never does: the denominator is in lowest terms.
      if (candidate >= minimum && candidate <= maximum && error < bestError) {
        value = candidate
        denominator = q
        bestError = error
      }
    }
  }
  return denominator === 0 ? null : { value, denominator }
}

/**
 * The zoom an unsmoothed view is displayed at: `zoom` (CSS px per image pixel, 1 = 100%) moved to
 * the nearest grid scale for this device pixel ratio, never below 100%. Below 100% the image is
 * drawn smoothed, a blend with no tie to break, so the zoom is displayed exactly as requested.
 *
 * Exactly 100% (Actual Size; owner decision, Option D, Phase 4 zoom follow-up) is always displayed
 * as exactly 100%: one image pixel per CSS pixel, the scale being the device pixel ratio itself.
 * Where that ratio is a grid scale (isGridScale) it is drawn crisp, with the grid's guarantee;
 * where it is not (Chrome at 101% custom scaling, for example) no drawing offset can be guaranteed
 * to keep device pixel centres clear of image pixel edges, so it is drawn smoothed (usesSmoothing).
 *
 * Rendering and hit-testing must both use the displayed zoom (displayViewport in
 * editor/editorState.ts); the stored zoom stays as requested, so small trackpad pinch movements
 * still add up and zooming in and back out returns exactly to the start.
 */
export function displayZoom(zoom: number, devicePixelRatio: number): number {
  if (!(zoom >= 1) || !Number.isFinite(zoom) || !(devicePixelRatio > 0) || !Number.isFinite(devicePixelRatio)) return zoom
  if (zoom === 1) return 1
  // Never above 3200% either: the nearest grid scale at or below 3200% × ratio at the top of the
  // range (3147% at 60/59). A whole number always lies between the limits for ratios above 1/31.
  const grid = nearestGridScale(
    zoom * devicePixelRatio,
    devicePixelRatio * (1 - GRID_TOLERANCE),
    MAX_DISPLAY_ZOOM * devicePixelRatio * (1 + GRID_TOLERANCE),
  )
  if (!grid) return zoom
  // At 100% the scale is the ratio itself, which a single-precision ratio puts a hair above the
  // grid scale: keep exactly 100% (still within GRID_TOLERANCE of the grid scale).
  return Math.max(1, grid.value / devicePixelRatio)
}

/**
 * Whether `scale` (device pixels per image pixel) is a grid scale, to within GRID_TOLERANCE: a
 * scale the image can be drawn at unsmoothed with every device pixel centre clear of every image
 * pixel edge (the guarantee above). Every displayed zoom above 100% is one; at exactly 100% the
 * scale is the device pixel ratio, which may not be.
 */
export function isGridScale(scale: number): boolean {
  if (!(scale > 0) || !Number.isFinite(scale)) return false
  const grid = nearestGridScale(scale, 0)
  return grid !== null && Math.abs(grid.value - scale) <= GRID_TOLERANCE * scale
}

/**
 * How far right of and below its device pixel corner the image is drawn at `scale` (device pixels
 * per image pixel), in device pixels: 1 / (2q) when `scale` is a grid scale p / q with q even, and
 * 0 when q is odd (whole numbers included) or `scale` is not a grid scale (smoothed views).
 *
 * With q odd, boundaries lie at multiples of 1 / q and centres at odd multiples of 1 / 2, which never
 * meet; with q even, the shift moves boundaries to odd multiples of 1 / (2q), which never meet the
 * centres either. Either way every centre is at least 1 / (2q) device pixels from every boundary.
 * The same function gives the renderer's shift (deviceTransform) and the mapping back from device
 * pixels to image pixels (coordinates.ts, imageIndexAtDevicePixel), so they cannot disagree.
 */
export function imageDrawBias(scale: number): number {
  if (!isGridScale(scale)) return 0
  const grid = nearestGridScale(scale, 0)!
  return grid.denominator % 2 === 0 ? 1 / (2 * grid.denominator) : 0
}

/**
 * The viewport the image is displayed with: `viewport` with its zoom moved to the grid
 * (displayZoom) and its offset snapped to whole device pixels (snapToDevicePixels). Rendering and
 * every hit-test, outline and readout use this one viewport, so they always agree.
 */
export function toDisplayViewport(viewport: ViewportState, devicePixelRatio: number): ViewportState {
  const snapped = snapToDevicePixels(viewport, devicePixelRatio)
  return { zoom: displayZoom(viewport.zoom, devicePixelRatio), offset: snapped.offset }
}

/**
 * Maps image coordinates to backing-store (device) pixels for drawing the image: the display
 * viewport's transform, shifted by imageDrawBias for its scale.
 */
export function deviceTransform(viewport: ViewportState, devicePixelRatio: number): CanvasTransform {
  const scale = viewport.zoom * devicePixelRatio
  const bias = imageDrawBias(scale)
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: viewport.offset.x * devicePixelRatio + bias,
    f: viewport.offset.y * devicePixelRatio + bias,
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
    x: (devicePixelIndex(point.x, devicePixelRatio) + 0.5) / devicePixelRatio,
    y: (devicePixelIndex(point.y, devicePixelRatio) + 0.5) / devicePixelRatio,
  }
}

/**
 * The whole device pixel containing a position along one axis (CSS px, relative to the canvas),
 * counted from the canvas's corner: the one under the pointer.
 */
export function devicePixelIndex(position: number, devicePixelRatio: number): number {
  return Math.floor(position * devicePixelRatio + DEVICE_EDGE_TOLERANCE)
}
