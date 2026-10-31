import { pixelUnderPointer } from '../canvas/coordinates'
import { createMagicWandSelection } from '../image/selection/magicWand'
import { combineSelections, selectAll } from '../image/selection/selectionOperations'
import { isEditableTarget } from '../utils/domTargets'
import { type EditorAction, type EditorState, displayViewport, documentVersion } from './editorState'
import type { Point, SelectionMode } from './types'

/*
 * Selection commands: pointer and keyboard input turned into editor actions. The pixel
 * work happens here, outside the reducer; the reducer only accepts or rejects the result.
 *
 * Every result is tagged with the document version it was computed from, captured before
 * the computation starts, so a result that arrives after the image was replaced or its
 * pixels changed is discarded by the reducer.
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
 * selection using `mode`. Hit-testing uses the display viewport the image is drawn with,
 * at the centre of the pointer's device pixel, so the clicked pixel is exactly the one
 * shown under the pointer.
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

  const found = createMagicWandSelection(document.pixels, seed, state.magicWand)
  return { type: 'selection-applied', version, selection: combineSelections(state.selection, found, mode) }
}

/** Select All, or null without an image or when everything is already selected. */
export function selectAllCommand(state: EditorState): EditorAction | null {
  const { document, selection } = state
  const version = documentVersion(state)
  if (!document || !version) return null
  if (selection && selection.count === document.width * document.height) return null
  return { type: 'selection-applied', version, selection: selectAll(document.width, document.height) }
}

/** Clear Selection, or null when nothing is selected. */
export function clearSelectionCommand(state: EditorState): EditorAction | null {
  return state.selection ? { type: 'selection-cleared' } : null
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
