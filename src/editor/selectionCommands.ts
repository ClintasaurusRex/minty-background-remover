import { pixelUnderPointer } from '../canvas/coordinates'
import { createMagicWandSelection } from '../image/selection/magicWand'
import { growSelection, shrinkSelection } from '../image/selection/growShrink'
import { combineSelections, invertSelection, selectAll } from '../image/selection/selectionOperations'
import { isEditableTarget } from '../utils/domTargets'
import { type EditorAction, type EditorState, type MagicWandOperation, displayViewport, documentVersion } from './editorState'
import { clampTolerance } from './toleranceInput'
import type { Point, SelectionMask, SelectionMode } from './types'

/*
 * Selection commands: pointer and keyboard input turned into editor actions. The pixel
 * work happens here, outside the reducer; the reducer only accepts or rejects the result.
 *
 * Every result is tagged with the document version it was computed from, captured before
 * the computation starts, so a result that arrives after the image was replaced or its
 * pixels changed is discarded by the reducer.
 *
 * A Magic Wand click is recorded with its result, so that a committed tolerance change can
 * re-apply it (reapplyMagicWandCommand).
 */

/** The parts of a pointer or mouse event the Magic Wand reads. */
export interface PointerPress {
  readonly button: number
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

const PRIMARY_BUTTON = 0

/**
 * How a Magic Wand click combines with the current selection, or null when the press
 * does not use the Magic Wand (any button other than the primary one).
 *
 * Modifier policy, in priority order:
 *
 * 1. Ctrl (or ⌘ Command) held: Subtract, whether or not Shift is also held.
 * 2. Shift held: Add.
 * 3. Neither: the mode chosen in the editor (New by default).
 *
 * Alt has no effect: several Linux desktops reserve Alt + click for moving windows.
 * Contiguous / Global is never chosen by a modifier.
 */
export function clickSelectionMode(press: PointerPress, chosen: SelectionMode): SelectionMode | null {
  if (press.button !== PRIMARY_BUTTON) return null
  if (press.ctrlKey || press.metaKey) return 'subtract'
  if (press.shiftKey) return 'add'
  return chosen
}

/**
 * A Magic Wand click at `point` (workspace canvas CSS px), combined with the current
 * selection using `mode` (the mode actually used, after any Shift or Ctrl override).
 * Hit-testing uses the display viewport the image is drawn with, at the centre of the
 * pointer's device pixel, so the clicked pixel is exactly the one shown under the pointer.
 *
 * The action also records the click (see MagicWandOperation), so a committed tolerance
 * change can re-apply it.
 *
 * Returns null when there is nothing to do: no image, another active tool, or a click
 * outside the image.
 */
export function magicWandClick(state: EditorState, point: Point, mode: SelectionMode): EditorAction | null {
  const { document, workspace } = state
  const viewport = displayViewport(state)
  const version = documentVersion(state)
  if (!document || !viewport || !workspace || !version || state.activeTool !== 'magic-wand') return null
  const seed = pixelUnderPointer(viewport, point, document, workspace.devicePixelRatio)
  if (!seed) return null

  const { tolerance, floodMode } = state.magicWand
  const operation: MagicWandOperation = {
    version,
    seed,
    floodMode,
    selectionMode: mode,
    // New replaces the selection whatever it was, so the previous mask is not kept.
    base: mode === 'new' ? null : state.selection,
    tolerance,
  }
  return { type: 'magic-wand-applied', operation, selection: operationResult(document.pixels, operation, tolerance) }
}

/**
 * What `operation` selects with `tolerance`: the Magic Wand result from its seed, combined
 * with the selection from before the click. The single formula for a click and for every
 * re-apply, so re-applying always equals clicking once at the latest tolerance.
 */
function operationResult(pixels: ImageData, operation: MagicWandOperation, tolerance: number): SelectionMask | null {
  const found = createMagicWandSelection(pixels, operation.seed, { tolerance, floodMode: operation.floodMode })
  return combineSelections(operation.base, found, operation.selectionMode)
}

/**
 * Re-applies the most recent Magic Wand click with a committed tolerance: the same seed,
 * flood mode and New / Add / Subtract mode as the click (whatever the options are now),
 * combined with the selection from before the click, never with an earlier re-applied
 * result. Add therefore never grows and Subtract never removes cumulatively.
 *
 * Returns null, computing nothing, when there is nothing to re-apply: no click recorded
 * (none yet, the selection was changed another way since, or another image opened), the
 * click was made on another document version, or `tolerance`, rounded and clamped to
 * 0–100, is the one the current selection was made with. Values that are not finite are
 * ignored.
 */
export function reapplyMagicWandCommand(state: EditorState, tolerance: number): EditorAction | null {
  const { document, lastMagicWandOperation: operation } = state
  if (!document || !operation || !Number.isFinite(tolerance)) return null
  const { version } = operation
  if (version.documentId !== document.id || version.revision !== document.revision) return null
  const value = clampTolerance(tolerance)
  if (value === operation.tolerance) return null
  const selection = operationResult(document.pixels, operation, value)
  return { type: 'magic-wand-reapplied', operation, tolerance: value, selection }
}

/**
 * The actions for a finished tolerance adjustment (slider released, typed value committed):
 * the tolerance itself, then the re-applied last click when it needs recomputing. Computing
 * the same committed tolerance twice is avoided, because once re-applied the selection is
 * recorded as made with it.
 */
export function commitToleranceCommand(state: EditorState, tolerance: number): readonly EditorAction[] {
  const reapplied = reapplyMagicWandCommand(state, tolerance)
  const changed: EditorAction = { type: 'magic-wand-tolerance-changed', tolerance }
  return reapplied ? [changed, reapplied] : [changed]
}

/** The selection actions offered as buttons (Select All and Clear also have shortcuts). */
export type SelectionAction = 'select-all' | 'clear' | 'invert' | 'grow' | 'shrink'

/**
 * Which selection actions would change anything. Constant time (it reads only the
 * selection's count, never its pixels), so the toolbar can check it on every render.
 *
 * - Select All: an image is open and not everything is selected.
 * - Clear: something is selected.
 * - Invert: an image is open (no selection inverts to everything, everything to nothing).
 * - Grow and Shrink: something, but not everything, is selected. Growing a full selection
 *   changes nothing, and neither does shrinking it, as the area outside the image counts
 *   as selected.
 */
export function availableSelectionActions(state: EditorState): Readonly<Record<SelectionAction, boolean>> {
  const { document, selection } = state
  const full = document !== null && selection !== null && selection.count === document.width * document.height
  const partial = document !== null && selection !== null && !full
  return {
    'select-all': document !== null && !full,
    clear: document !== null && selection !== null,
    invert: document !== null,
    grow: partial,
    shrink: partial,
  }
}

/**
 * The editor action for a selection action, computed from `state`, or null when the
 * action is unavailable (see availableSelectionActions). The new mask is computed here,
 * outside the reducer, by the selection operations, which never modify the current mask.
 */
export function selectionActionCommand(state: EditorState, action: SelectionAction): EditorAction | null {
  const { document, selection } = state
  const version = documentVersion(state)
  if (!document || !version || !availableSelectionActions(state)[action]) return null
  switch (action) {
    case 'clear':
      return { type: 'selection-cleared' }
    case 'select-all':
      return { type: 'selection-applied', version, selection: selectAll(document.width, document.height) }
    case 'invert':
      return { type: 'selection-applied', version, selection: invertSelection(selection, document.width, document.height) }
    case 'grow':
      return { type: 'selection-applied', version, selection: growSelection(selection) }
    case 'shrink':
      return { type: 'selection-applied', version, selection: shrinkSelection(selection) }
  }
}

/** Select All, or null without an image or when everything is already selected. */
export function selectAllCommand(state: EditorState): EditorAction | null {
  return selectionActionCommand(state, 'select-all')
}

/** Clear Selection, or null when nothing is selected. */
export function clearSelectionCommand(state: EditorState): EditorAction | null {
  return selectionActionCommand(state, 'clear')
}

/** The parts of a KeyboardEvent read by selectionShortcut, so tests can provide plain objects. */
export interface ShortcutKey {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
  readonly defaultPrevented?: boolean
  readonly target: EventTarget | null
}

export type SelectionShortcut = 'select-all' | 'clear-selection'

/**
 * The selection shortcut a key press asks for: Ctrl + A (or ⌘ Command + A) selects all and
 * Escape clears the selection. Keys typed into text fields, during text composition or
 * already handled elsewhere are left alone, as are other modifier combinations.
 */
export function selectionShortcut(event: ShortcutKey): SelectionShortcut | null {
  if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return null
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event
  if (key === 'Escape' && !ctrlKey && !metaKey && !altKey && !shiftKey) return 'clear-selection'
  if ((ctrlKey || metaKey) && !altKey && !shiftKey && key.toLowerCase() === 'a') return 'select-all'
  return null
}
