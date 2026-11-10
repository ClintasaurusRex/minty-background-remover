import { isWholeImage } from '../image/crop/cropRectangle'
import { isEditableTarget, isInteractiveTarget } from '../utils/domTargets'
import type { ShortcutKey } from './selectionCommands'
import type { Rectangle, Size } from './types'

/*
 * The Crop tool's keyboard shortcuts (Phase 4; FEATURE_SPEC.md §11): Enter applies the crop and
 * Escape cancels it. Pure, so the decision is tested in Node; app/useCropCommands.ts connects it
 * to the window.
 */

/** The parts of a KeyboardEvent read by cropShortcut. */
export interface CropShortcutKey extends ShortcutKey {
  readonly repeat?: boolean
}

export type CropShortcut = 'apply' | 'cancel'

/**
 * The crop shortcut a key press asks for, given whether the Crop tool has a rectangle or a drag in
 * progress (`cropPending`):
 *
 * - Escape, with no modifier: cancel. Taken before Escape's Clear Selection (useSelectionShortcuts)
 *   only while a crop is pending, so with nothing pending Escape still clears the selection.
 * - Enter, with no modifier and not repeating: apply. Never when focus is on a control, where
 *   Enter has its own meaning (a button presses itself, a field commits its entry); Apply Crop
 *   itself is such a button.
 *
 * Keys typed into text fields, during text composition or already handled elsewhere are left
 * alone.
 */
export function cropShortcut(event: CropShortcutKey, cropPending: boolean): CropShortcut | null {
  if (!cropPending || event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return null
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null
  if (event.key === 'Escape') return 'cancel'
  if (event.key === 'Enter' && !event.repeat && !isInteractiveTarget(event.target)) return 'apply'
  return null
}

/** Apply Crop's tooltip: what it will do, or why it cannot run now. */
export function applyCropTitle(cropRect: Rectangle | null, imageSize: Size, canApplyCrop: boolean): string {
  if (!cropRect) return 'Apply Crop — drag on the image to choose the area to keep first'
  if (isWholeImage(cropRect, imageSize)) return 'Apply Crop — the rectangle keeps the whole image'
  const action = `Crop the image to ${cropRect.width} × ${cropRect.height} px (Enter)`
  return canApplyCrop ? action : `${action} — not available while another image is opening`
}
