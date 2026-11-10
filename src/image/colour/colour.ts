import type { PixelBuffer, PixelCoordinate } from '../../editor/types'

/*
 * Colours as the colour tools use them (Phase 4: Eyedropper and colour picker; FEATURE_SPEC.md §12,
 * IMAGE_PROCESSING_SPEC.md, Eyedropper). Pure: no DOM, canvas or React.
 *
 * An Rgba is one pixel's straight (not premultiplied) 8-bit sRGB values, exactly as the image
 * stores them: r, g and b from 0 to 255, and alpha from 0 (transparent) to 255 (opaque). Hex text is
 * #RRGGBB for an opaque colour and #RRGGBBAA otherwise (CSS Color 4), upper case.
 *
 * The colour picker works in HSV (hue, saturation, value) with fractional values, so that moving
 * through greys and black never loses the hue the user chose; it rounds to whole 8-bit values only
 * when a colour leaves it.
 */

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** Hue in degrees [0, 360), saturation and value from 0 to 1. */
export interface Hsv {
  readonly h: number
  readonly s: number
  readonly v: number
}

/**
 * The exact values of pixel (x, y) of `pixels`, colour hidden under alpha 0 included. Reading never
 * changes the image. Throws a RangeError for a pixel outside the image.
 */
export function sampleColour(pixels: PixelBuffer, pixel: PixelCoordinate): Rgba {
  const { x, y } = pixel
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) {
    throw new RangeError(`Pixel ${x}, ${y} is outside the ${pixels.width} × ${pixels.height} image`)
  }
  const i = (y * pixels.width + x) * 4
  const { data } = pixels
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
}

/** Whether `colour` is four whole numbers from 0 to 255. */
export function isRgba(colour: Rgba): boolean {
  return [colour.r, colour.g, colour.b, colour.a].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
}

function hexByte(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

/** #RRGGBB, or #RRGGBBAA when the colour is not fully opaque. */
export function formatHex(colour: Rgba): string {
  const rgb = `#${hexByte(colour.r)}${hexByte(colour.g)}${hexByte(colour.b)}`
  return colour.a === 255 ? rgb : `${rgb}${hexByte(colour.a)}`
}

/** "26, 43, 60, 255": the four values as the colour readouts list them. */
export function formatRgba(colour: Rgba): string {
  return `${colour.r}, ${colour.g}, ${colour.b}, ${colour.a}`
}

/** Alpha as a percentage of opaque, rounded to a whole number: "50%". */
export function formatAlphaPercent(alpha: number): string {
  return `${Math.round((alpha / 255) * 100)}%`
}

/**
 * The colour typed as hex: #RGB, #RGBA, #RRGGBB or #RRGGBBAA, with or without the #, in either case,
 * surrounding spaces ignored. Without alpha digits the colour is opaque. Null for anything else.
 */
export function parseHex(text: string): Rgba | null {
  const match = /^#?([0-9a-f]+)$/i.exec(text.trim())
  if (!match) return null
  let digits = match[1]
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join('')
  if (digits.length !== 6 && digits.length !== 8) return null
  const byte = (index: number) => Number.parseInt(digits.slice(index, index + 2), 16)
  return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) : 255 }
}

/**
 * The HSV of an 8-bit colour (alpha ignored). Greys have saturation 0 and black value 0; their hue
 * is then meaningless and given as `fallbackHue` (the hue the picker showed), so passing through
 * them never resets the hue.
 */
export function rgbToHsv(colour: Rgba, fallbackHue = 0): Hsv {
  const r = colour.r / 255
  const g = colour.g / 255
  const b = colour.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const s = max === 0 ? 0 : delta / max
  if (delta === 0) return { h: fallbackHue, s, v: max }
  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, v: max }
}

/** The 8-bit colour of `hsv`, with alpha `a`. Hue wraps; saturation and value are clamped to 0–1. */
export function hsvToRgb(hsv: Hsv, a = 255): Rgba {
  const h = ((hsv.h % 360) + 360) % 360
  const s = clamp01(hsv.s)
  const v = clamp01(hsv.v)
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const sector = Math.floor(h / 60)
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector]
  const byte = (value: number) => Math.round((value + m) * 255)
  return { r: byte(r), g: byte(g), b: byte(b), a: Math.min(255, Math.max(0, Math.round(a))) }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** Whether two colours have the same four values. */
export function sameColour(a: Rgba | null, b: Rgba | null): boolean {
  if (!a || !b) return a === b
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

/** The colour as CSS (rgb() with alpha), for swatches. */
export function cssColour(colour: Rgba): string {
  return `rgb(${colour.r} ${colour.g} ${colour.b} / ${(colour.a / 255).toFixed(4)})`
}
