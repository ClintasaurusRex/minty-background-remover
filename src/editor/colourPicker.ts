import { type Hsv, type Rgba, formatAlphaPercent, formatHex, hsvToRgb, parseHex, rgbToHsv } from '../image/colour/colour'
import type { Point, Size } from './types'

/*
 * The colour picker's behaviour (Phase 4; UI_UX_SPEC.md, Colour Picker UX), pure so it is tested in
 * Node; components/ColourPicker connects it to the DOM.
 *
 * The picker edits a PickerColour: the exact 8-bit colour it would apply, and the HSV the visual
 * controls show. The 8-bit colour is the source of truth: a colour given to the picker (the
 * current colour, typed hex) is kept exactly, so applying without changes returns exactly the
 * colour it was opened with. Only moving the saturation / brightness area or the hue slider sets
 * the colour from the HSV.
 */

export interface PickerColour {
  /** The colour Apply would choose (alpha included). */
  readonly rgba: Rgba
  /** What the saturation / brightness area and the hue slider show. */
  readonly hsv: Hsv
}

/** The colour the picker opens with when there is no current colour: opaque white. */
export const DEFAULT_PICKER_COLOUR: Rgba = { r: 255, g: 255, b: 255, a: 255 }

export function pickerColour(rgba: Rgba, previousHue = 0): PickerColour {
  return { rgba, hsv: rgbToHsv(rgba, previousHue) }
}

/** The picker colour with `hsv` (from the visual controls), keeping its alpha. */
export function withHsv(colour: PickerColour, hsv: Hsv): PickerColour {
  const h = ((hsv.h % 360) + 360) % 360
  const next = { h, s: clamp01(hsv.s), v: clamp01(hsv.v) }
  return { rgba: hsvToRgb(next, colour.rgba.a), hsv: next }
}

/** The picker colour with alpha `alpha` (0–255, rounded and clamped); its RGB unchanged. */
export function withAlpha(colour: PickerColour, alpha: number): PickerColour {
  if (!Number.isFinite(alpha)) return colour
  return { ...colour, rgba: { ...colour.rgba, a: Math.min(255, Math.max(0, Math.round(alpha))) } }
}

/**
 * The colour typed in the hex field (parseHex), or null when the text is not a colour. Typed hex
 * with alpha digits sets the alpha too; without them the colour is opaque.
 */
export function withHex(colour: PickerColour, text: string): PickerColour | null {
  const parsed = parseHex(text)
  return parsed ? pickerColour(parsed, colour.hsv.h) : null
}

/**
 * Saturation and value for a pointer at `point` in a saturation / brightness area of `size` (both in
 * the area's CSS pixels, from its top-left corner): saturation grows to the right, value upwards.
 * Points outside the area are clamped to its edge, so dragging past it reaches full or none.
 */
export function svAtPoint(point: Point, size: Size): { s: number; v: number } {
  const s = size.width > 0 ? clamp01(point.x / size.width) : 0
  const v = size.height > 0 ? 1 - clamp01(point.y / size.height) : 0
  return { s, v }
}

/**
 * A key on the saturation / brightness area: Left / Right change saturation and Down / Up brightness
 * by 1%, or 10% with Shift (Page Up / Page Down change brightness by 10%); Home / End set saturation
 * to 0% / 100%. Null for other keys.
 */
export function svKey(hsv: Hsv, key: string, shift: boolean): Hsv | null {
  const step = shift ? 0.1 : 0.01
  const snap = (value: number) => clamp01(Math.round(value * 100) / 100)
  switch (key) {
    case 'ArrowLeft':
      return { ...hsv, s: snap(hsv.s - step) }
    case 'ArrowRight':
      return { ...hsv, s: snap(hsv.s + step) }
    case 'ArrowDown':
      return { ...hsv, v: snap(hsv.v - step) }
    case 'ArrowUp':
      return { ...hsv, v: snap(hsv.v + step) }
    case 'PageDown':
      return { ...hsv, v: snap(hsv.v - 0.1) }
    case 'PageUp':
      return { ...hsv, v: snap(hsv.v + 0.1) }
    case 'Home':
      return { ...hsv, s: 0 }
    case 'End':
      return { ...hsv, s: 1 }
    default:
      return null
  }
}

/** The saturation / brightness area's value for assistive technology: "Saturation 40%, brightness 80%". */
export function svValueText(hsv: Hsv): string {
  return `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`
}

/** A colour in words for assistive technology and tooltips: "#1A2B3C, alpha 100%". */
export function describeColour(colour: Rgba): string {
  return `${formatHex(colour)}, alpha ${formatAlphaPercent(colour.a)}`
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
