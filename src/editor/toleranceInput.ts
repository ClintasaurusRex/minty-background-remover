import { MAX_EDGE_PIXELS } from '../image/edit/deleteWithEdges'
import { MAX_TOLERANCE } from '../image/selection/colourDistance'

/*
 * The Magic Wand's tolerance controls: what text typed into the field means, and when an
 * adjustment of the slider or the field is finished. The field keeps whatever the user
 * types while they edit.
 *
 * The Delete Selection edge amounts (edge cleanup and feather, 0–5 px; Phase 3 Step 8) use the
 * same text field and slider behaviour with their own range. A finished adjustment of an amount
 * makes the last Delete again while it can still be adjusted (Phase 3 Step 9), as a finished
 * tolerance adjustment re-applies the last Magic Wand click.
 */

/** The whole numbers a slider and text field pair accepts, from 0 to `max`. */
export interface WholeNumberRange {
  readonly max: number
  /** Step of Page Up / Page Down in the text field, as on the slider. */
  readonly pageStep: number
}

export const TOLERANCE_RANGE: WholeNumberRange = { max: MAX_TOLERANCE, pageStep: 10 }

/** Edge cleanup and feather, in pixels. */
export const EDGE_PIXEL_RANGE: WholeNumberRange = { max: MAX_EDGE_PIXELS, pageStep: 1 }

/**
 * A whole number from 0 to 100 (the range's maximum) typed exactly: applied as the user types, so the
 * slider follows. At most three digits, or as many as the maximum has when it has more (the Crop
 * fields, up to 16,384; Phase 4).
 */
export function exactToleranceInput(text: string, range: WholeNumberRange = TOLERANCE_RANGE): number | null {
  const trimmed = text.trim()
  const digits = Math.max(3, String(range.max).length)
  if (!/^\d+$/.test(trimmed) || trimmed.length > digits) return null
  const value = Number(trimmed)
  return value <= range.max ? value : null
}

/**
 * The tolerance a committed entry (Enter or leaving the field) stands for: any finite
 * number, rounded to a whole number and clamped to 0–100. Null for text that is not a
 * number (including an empty field), which restores the current tolerance instead.
 */
export function committedToleranceInput(text: string, range: WholeNumberRange = TOLERANCE_RANGE): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return clampTolerance(value, range)
}

/** Rounds to a whole number and clamps to 0–100 (the range's maximum), the rule the editor applies to every tolerance. */
export function clampTolerance(value: number, range: WholeNumberRange = TOLERANCE_RANGE): number {
  return Math.min(range.max, Math.max(0, Math.round(value)))
}

/**
 * Keyboard steps in the text field, like the slider's: Up / Down arrows by 1, Page Up /
 * Page Down by 10. Null for other keys (Home and End keep moving the text cursor).
 */
export function steppedTolerance(current: number, key: string, range: WholeNumberRange = TOLERANCE_RANGE): number | null {
  switch (key) {
    case 'ArrowUp':
      return clampTolerance(current + 1, range)
    case 'ArrowDown':
      return clampTolerance(current - 1, range)
    case 'PageUp':
      return clampTolerance(current + range.pageStep, range)
    case 'PageDown':
      return clampTolerance(current - range.pageStep, range)
    default:
      return null
  }
}

/**
 * The tolerance an entry in the text field commits to (Enter or leaving the field): the
 * typed number, rounded and clamped, or the current tolerance when the field was not
 * edited or holds text that is not a number.
 */
export function toleranceToCommit(draft: string | null, current: number, range: WholeNumberRange = TOLERANCE_RANGE): number {
  return (draft === null ? null : committedToleranceInput(draft, range)) ?? current
}

/*
 * Finished adjustments. The slider and the text field change the tolerance while the user
 * adjusts it, so the number and the slider always show it, but the last Magic Wand click
 * is re-applied only when an adjustment is finished (committed):
 *
 * - Slider, pointer: when the thumb is released (the native change event, which also
 *   covers values set by assistive technology).
 * - Slider and text field, keyboard: when the last adjustment key is released. Holding an
 *   arrow key repeats the step, and is re-applied once, at the end.
 * - Text field, typing: Enter or leaving the field. Escape cancels the unfinished entry,
 *   restoring the tolerance from before it, which is already committed.
 * - Leaving either control finishes whatever adjustment was still in progress.
 *
 * Committing the tolerance the selection was already made with computes nothing, so an
 * adjustment reported finished twice (by a change event, then by leaving the slider) is
 * computed once.
 */

/** Adjustment keys held down on a control, while a keyboard adjustment is in progress. */
export type HeldKeys = ReadonlySet<string>

export const NO_KEYS_HELD: HeldKeys = new Set()

/** Keys with which browsers change a range input's value. */
export const SLIDER_ADJUSTMENT_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

/** Keys that step the tolerance in the text field (see steppedTolerance). */
export const FIELD_ADJUSTMENT_KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'])

/** After a key press: `held` with `key` added if it is one of `adjustmentKeys`. Repeats change nothing. */
export function pressAdjustmentKey(held: HeldKeys, key: string, adjustmentKeys: ReadonlySet<string>): HeldKeys {
  return adjustmentKeys.has(key) && !held.has(key) ? new Set([...held, key]) : held
}

/** After a key release: the keys still held, and whether that finished the keyboard adjustment. */
export function releaseAdjustmentKey(held: HeldKeys, key: string): { held: HeldKeys; finished: boolean } {
  if (!held.has(key)) return { held, finished: false }
  const next = new Set(held)
  next.delete(key)
  return { held: next, finished: next.size === 0 }
}

/** Events of the tolerance slider that can finish an adjustment. Movements themselves apply at once. */
export type ToleranceSliderEvent =
  | { readonly type: 'key-down'; readonly key: string }
  | { readonly type: 'key-up'; readonly key: string }
  /** A pointer press on the slider, which starts a pointer adjustment. */
  | { readonly type: 'pointer-down' }
  /** The native change event: the browser's signal that the user committed a value. */
  | { readonly type: 'change' }
  | { readonly type: 'blur' }

/** Whether the slider's adjustment is finished, so its value is committed, and the keys still held. */
export interface ToleranceSliderResult {
  readonly held: HeldKeys
  readonly commit: boolean
}

/**
 * The slider's behaviour: pointer adjustments commit on release (the change event), keyboard
 * adjustments when the last adjustment key is released, and leaving the slider commits
 * whatever is in progress.
 */
export function toleranceSliderEvent(held: HeldKeys, event: ToleranceSliderEvent): ToleranceSliderResult {
  switch (event.type) {
    case 'key-down':
      return { held: pressAdjustmentKey(held, event.key, SLIDER_ADJUSTMENT_KEYS), commit: false }
    case 'key-up': {
      const released = releaseAdjustmentKey(held, event.key)
      return { held: released.held, commit: released.finished }
    }
    case 'pointer-down':
      // A pointer press ends a keyboard adjustment, committing it. So a pointer adjustment
      // always commits on release, even after a key release that was never reported (macOS
      // reports none while ⌘ is held).
      return { held: NO_KEYS_HELD, commit: held.size > 0 }
    case 'change':
      // Browsers fire change for every keyboard step too; those wait for the key's release.
      return { held, commit: held.size === 0 }
    case 'blur':
      return { held: NO_KEYS_HELD, commit: true }
  }
}

/**
 * The tolerance text field's own state. An entry is in progress from the first typed
 * character or step key until it is finished (Enter, Escape, the last step key released or
 * leaving the field).
 */
export interface ToleranceFieldState {
  /** The text being typed, or null to show the current tolerance. */
  readonly draft: string | null
  /**
   * The tolerance from just before the entry in progress began: what Escape restores,
   * cancelling only the unfinished entry. Captured when the entry begins, so it is always the
   * committed tolerance, however the tolerance changed since the field gained focus.
   */
  readonly committed: number
  /** Step keys held down (see FIELD_ADJUSTMENT_KEYS). */
  readonly held: HeldKeys
}

export function initialToleranceFieldState(tolerance: number): ToleranceFieldState {
  return { draft: null, committed: tolerance, held: NO_KEYS_HELD }
}

export type ToleranceFieldEvent =
  | { readonly type: 'focus' }
  | { readonly type: 'input'; readonly text: string }
  | { readonly type: 'key-down'; readonly key: string }
  | { readonly type: 'key-up'; readonly key: string }
  | { readonly type: 'blur' }

/** What the text field does after an event. */
export interface ToleranceFieldResult {
  readonly state: ToleranceFieldState
  /** A tolerance to show and use at once while the adjustment continues (the slider follows it). */
  readonly change?: number
  /** The adjustment is finished at this tolerance. */
  readonly commit?: number
  /** The key was handled here: its default action, and the editor's shortcuts, must not run. */
  readonly handled?: boolean
}

/**
 * The text field's behaviour, given the current tolerance:
 *
 * - Typing a whole number from 0 to 100 applies it at once; other text waits.
 * - Enter or leaving the field commits the entry, rounded and clamped; text that is not a
 *   number commits the current tolerance.
 * - Escape cancels the unfinished entry: it restores and commits the tolerance from before
 *   the entry began, which is already committed, so it re-applies nothing.
 * - Up / Down arrows and Page Up / Page Down step the tolerance at once and commit it when
 *   the last of them is released.
 */
export function toleranceFieldEvent(
  state: ToleranceFieldState,
  event: ToleranceFieldEvent,
  tolerance: number,
  range: WholeNumberRange = TOLERANCE_RANGE,
): ToleranceFieldResult {
  // Without an entry in progress, the current tolerance is the committed one: an entry
  // beginning now is cancelled back to it.
  const committed = state.draft !== null || state.held.size > 0 ? state.committed : tolerance
  switch (event.type) {
    case 'focus':
      return { state: initialToleranceFieldState(tolerance) }

    case 'input': {
      const next = { ...state, draft: event.text, committed }
      const exact = exactToleranceInput(event.text, range)
      return exact === null ? { state: next } : { state: next, change: exact }
    }

    case 'key-down': {
      if (event.key === 'Enter') return finishField(toleranceToCommit(state.draft, tolerance, range))
      // Handled here, so Escape does not also clear the selection.
      if (event.key === 'Escape') return { ...finishField(committed), handled: true }
      const stepped = steppedTolerance(committedToleranceInput(state.draft ?? '', range) ?? tolerance, event.key, range)
      if (stepped === null) return { state }
      const held = pressAdjustmentKey(state.held, event.key, FIELD_ADJUSTMENT_KEYS)
      return { state: { draft: null, committed, held }, change: stepped, handled: true }
    }

    case 'key-up': {
      const { held, finished } = releaseAdjustmentKey(state.held, event.key)
      if (finished) return finishField(tolerance)
      return held === state.held ? { state } : { state: { ...state, held } }
    }

    case 'blur':
      return finishField(toleranceToCommit(state.draft, tolerance, range))
  }
}

/**
 * A finished adjustment of a control whose commits can edit the image (the Delete edge amounts,
 * which can update the last Delete; Phase 3 Step 9): it counts as a change only when it ends on
 * another value than the one the interaction started from. `start` is that value: the amount when
 * the control gained focus or the slider was pressed, or the value of the previous finished
 * adjustment. Moving focus through the control, or changing the value and back before finishing
 * (dragging back, holding keys back, retyping it, Escape), is therefore never a change.
 *
 * Returns whether it changed, and the start of the next interaction (the value just finished).
 */
export function finishAdjustment(start: number, value: number): { readonly changed: boolean; readonly start: number } {
  return { changed: value !== start, start: value }
}

/** Ends the entry in progress, committing `value`. */
function finishField(value: number): ToleranceFieldResult {
  return { state: initialToleranceFieldState(value), commit: value }
}
