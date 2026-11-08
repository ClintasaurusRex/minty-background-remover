import {
  type ToleranceFieldEvent,
  type ToleranceFieldResult,
  type ToleranceFieldState,
  type WholeNumberRange,
  toleranceFieldEvent,
} from './toleranceInput'

/*
 * Auto Trim's padding as the editor offers it (Phase 3 Step 11; owner's provisional decisions):
 * whole pixels from 0 to 50, 5 by default, reset to 5 whenever another image is opened. The
 * algorithm itself (image/trim/autoTrim.ts) accepts any whole number of 0 or more; the limit of 50
 * is the control's.
 */

/** PROJECT_BRIEF.md, Auto Trim: "Default padding: 5 px". */
export const DEFAULT_AUTO_TRIM_PADDING = 5

/** The largest padding the control accepts (owner's provisional decision for Step 11). */
export const MAX_AUTO_TRIM_PADDING = 50

/** The quick padding options of PROJECT_BRIEF.md (Auto Trim) and UI_UX_SPEC.md (Auto Trim UX). */
export const AUTO_TRIM_PADDING_PRESETS: readonly number[] = [0, 5, 10, 20]

/** The padding text field: 0–50, Page Up / Page Down by 10. */
export const AUTO_TRIM_PADDING_RANGE: WholeNumberRange = { max: MAX_AUTO_TRIM_PADDING, pageStep: 10 }

/**
 * The padding text field's behaviour: the tolerance field's (toleranceFieldEvent) with the range
 * 0–50, so a whole number from 0 to 50 applies as it is typed and anything larger waits for Enter.
 */
export function paddingFieldEvent(state: ToleranceFieldState, event: ToleranceFieldEvent, padding: number): ToleranceFieldResult {
  return toleranceFieldEvent(state, event, padding, AUTO_TRIM_PADDING_RANGE)
}

/** Rounds to a whole number and clamps to 0–50: the rule the editor applies to every padding it is given. */
export function clampAutoTrimPadding(value: number): number {
  return Math.min(MAX_AUTO_TRIM_PADDING, Math.max(0, Math.round(value)))
}
