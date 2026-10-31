import { MAX_TOLERANCE } from '../image/selection/colourDistance'

/*
 * The Magic Wand's typed tolerance. The text field keeps whatever the user types while
 * they edit; these functions decide what that text means.
 */

/** A whole number from 0 to 100 typed exactly: applied as the user types, so the slider follows. */
export function exactToleranceInput(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,3}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value <= MAX_TOLERANCE ? value : null
}

/**
 * The tolerance a committed entry (Enter or leaving the field) stands for: any finite
 * number, rounded to a whole number and clamped to 0–100. Null for text that is not a
 * number (including an empty field), which restores the current tolerance instead.
 */
export function committedToleranceInput(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return clampTolerance(value)
}

/** Rounds to a whole number and clamps to 0–100, the rule the editor applies to every tolerance. */
export function clampTolerance(value: number): number {
  return Math.min(MAX_TOLERANCE, Math.max(0, Math.round(value)))
}

/**
 * Keyboard steps in the text field, like the slider's: Up / Down arrows by 1, Page Up /
 * Page Down by 10. Null for other keys (Home and End keep moving the text cursor).
 */
export function steppedTolerance(current: number, key: string): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampTolerance(current + 1)
    case 'ArrowDown':
      return clampTolerance(current - 1)
    case 'PageUp':
      return clampTolerance(current + 10)
    case 'PageDown':
      return clampTolerance(current - 10)
    default:
      return null
  }
}
