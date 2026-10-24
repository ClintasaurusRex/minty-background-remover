import type { Size } from '../../editor/types'

/** Raw attribute values from an SVG root element; absent attributes are null or undefined. */
export interface SvgSizeAttributes {
  readonly width?: string | null
  readonly height?: string | null
  readonly viewBox?: string | null
}

/**
 * A parsed width or height attribute:
 * - number:     an absolute length in CSS pixels
 * - 'auto':     absent, 'auto' or relative (%, em, vw, …), so it does not define a size
 * - 'invalid':  malformed, zero, negative or non-finite
 */
export type SvgLength = number | 'auto' | 'invalid'

/** CSS pixels per unit for absolute lengths (CSS: 1in = 96px). */
const ABSOLUTE_UNITS: Readonly<Record<string, number>> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
}

const RELATIVE_UNITS = new Set([
  '%', 'em', 'ex', 'ch', 'rem', 'cap', 'ic', 'lh', 'rlh',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax',
])

const LENGTH_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

export function parseSvgLength(value: string | null | undefined): SvgLength {
  if (value == null) return 'auto'
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'auto') return 'auto'

  const match = LENGTH_PATTERN.exec(trimmed)
  if (!match) return 'invalid'

  const unit = match[2].toLowerCase()
  if (RELATIVE_UNITS.has(unit)) return 'auto'
  const scale = ABSOLUTE_UNITS[unit]
  if (scale === undefined) return 'invalid'

  const pixels = Number(match[1]) * scale
  return Number.isFinite(pixels) && pixels > 0 ? pixels : 'invalid'
}

/** Width and height of a viewBox ("min-x min-y width height"), or null if unusable. */
export function parseViewBoxSize(value: string | null | undefined): Size | null {
  if (value == null) return null
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4 || !parts.every((part) => NUMBER_PATTERN.test(part))) return null

  const [, , width, height] = parts.map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * The raster size, in whole pixels, to render an SVG at on import:
 *
 * 1. Absolute width and height are used as given (px, unitless, or converted from
 *    in/cm/mm/Q/pt/pc).
 * 2. If only one is absolute, the other follows the viewBox aspect ratio.
 * 3. If neither is absolute (absent, 'auto' or relative such as 100%), the viewBox
 *    width and height are used.
 *
 * Returns null when no usable size exists, including when width or height is
 * malformed, zero or negative. No default size is ever assumed.
 *
 * Results are rounded to whole pixels (minimum 1). Limits are not checked here;
 * pass the result to validateDimensions.
 */
export function resolveSvgSize(attributes: SvgSizeAttributes): Size | null {
  const width = parseSvgLength(attributes.width)
  const height = parseSvgLength(attributes.height)
  if (width === 'invalid' || height === 'invalid') return null

  if (typeof width === 'number' && typeof height === 'number') {
    return toPixelSize(width, height)
  }

  const viewBox = parseViewBoxSize(attributes.viewBox)
  if (!viewBox) return null

  if (typeof width === 'number') {
    return toPixelSize(width, (width * viewBox.height) / viewBox.width)
  }
  if (typeof height === 'number') {
    return toPixelSize((height * viewBox.width) / viewBox.height, height)
  }
  return toPixelSize(viewBox.width, viewBox.height)
}

function toPixelSize(width: number, height: number): Size | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}
