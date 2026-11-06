import { createDisplayImage } from '../canvas/displayImage'
import { deleteSelectedPixels } from '../image/edit/deleteSelection'
import { isEditableTarget } from '../utils/domTargets'
import { type EditorAction, type EditorState, documentVersion, isImporting } from './editorState'
import { nextRedo, nextUndo } from './history/editHistory'
import type { EditKind } from './history/historyEntry'
import { type CreateDisplayImage, completedEditCommand, describeCause, redoCommand, undoCommand } from './historyCommands'
import type { ShortcutKey } from './selectionCommands'

/*
 * Edit commands as the application offers them: Delete Selection, Undo and Redo, from the Magic
 * Wand options row, the header and the keyboard (Phase 3 Step 6).
 *
 * As with selection commands, the pixel work happens here, outside the reducer, from the latest
 * committed state; the reducer only accepts or rejects the result. The actions carry a new
 * display image, so they are dispatched through app/editDispatch.ts, which releases the image if
 * the reducer did not keep it.
 *
 * Availability is decided here and only here (availableEditActions), never in the reducer: the
 * reducer's checks must stay permanent (an action rejected once is rejected by every later
 * state), which is what makes releasing a rejected action's image safe. "An import is running"
 * is not permanent, since an import can fail.
 */

/** The edit actions offered as controls and shortcuts. */
export type EditAction = 'delete-selection' | 'undo' | 'redo'

export interface AvailableEditActions {
  /**
   * Something is selected. Delete may still find only fully transparent pixels; it then changes
   * nothing and says so. Deciding that exactly would mean reading the selected pixels on every
   * render.
   */
  readonly deleteSelection: boolean
  /** The edit Undo would undo, or null when there is nothing to undo. */
  readonly undo: EditKind | null
  /** The edit Redo would redo, or null when there is nothing to redo. */
  readonly redo: EditKind | null
}

const NOTHING_AVAILABLE: AvailableEditActions = { deleteSelection: false, undo: null, redo: null }

/**
 * Which edit actions can run now. Constant time, so the controls can check it on every render.
 *
 * Nothing is available without an open image, or while another image is being opened: the
 * import would replace the image and discard the edit (and was confirmed, if the image had
 * unexported edits, before this edit existed). Selection changes stay available meanwhile.
 */
export function availableEditActions(state: EditorState): AvailableEditActions {
  const version = documentVersion(state)
  if (!version || isImporting(state)) return NOTHING_AVAILABLE
  return {
    deleteSelection: state.selection !== null,
    undo: nextUndo(state.history, version)?.kind ?? null,
    redo: nextRedo(state.history, version)?.kind ?? null,
  }
}

/**
 * The editor action for `action`, computed from `state` (the latest committed state), or null
 * when it is unavailable (availableEditActions). The application runs every edit action through
 * this; `createImage` is injected in tests.
 */
export function editActionCommand(
  state: EditorState,
  action: EditAction,
  createImage: CreateDisplayImage = createDisplayImage,
): EditorAction | null {
  const available = availableEditActions(state)
  switch (action) {
    case 'delete-selection':
      return available.deleteSelection ? deleteSelectionCommand(state, createImage) : null
    case 'undo':
      return available.undo ? undoCommand(state, createImage) : null
    case 'redo':
      return available.redo ? redoCommand(state, createImage) : null
  }
}

/**
 * Delete Selection (FEATURE_SPEC.md §8): every selected pixel becomes fully transparent, its
 * colour kept hidden (deleteSelectedPixels), as a new revision with its display image and a
 * history entry. The selection is cleared, and Undo brings it back with the Magic Wand click
 * that made it.
 *
 * Returns null without an image or a selection. When every selected pixel is already fully
 * transparent, returns `edit-unchanged`: no entry, no revision, no image, and the selection
 * stays. Returns `edit-failed`, changing nothing, when the edit cannot be made or displayed
 * (for example for lack of memory).
 *
 * Does not check availability (an import in progress); editActionCommand does.
 */
export function deleteSelectionCommand(
  state: EditorState,
  createImage: CreateDisplayImage = createDisplayImage,
): EditorAction | null {
  const { document, selection } = state
  const version = documentVersion(state)
  if (!document || !version || !selection) return null
  let result
  try {
    result = deleteSelectedPixels(document.pixels, selection)
  } catch (cause) {
    return { type: 'edit-failed', error: { operation: 'delete-selection', detail: describeCause(cause) } }
  }
  if (!result) return { type: 'edit-unchanged', version, operation: 'delete-selection' }
  return completedEditCommand(
    state,
    {
      kind: 'delete-selection',
      change: 'pixels',
      version,
      selection: null,
      pixels: result.pixels,
      region: result.bounds,
      changedPixels: result.count,
    },
    createImage,
  )
}

/**
 * Whether the open image has pixel edits that would be lost if another image replaced it: some
 * edit is applied and not undone (editDepth). Constant time; no images are compared. Undoing every
 * edit returns the image to the file as opened, so it then has none, even with edits left to redo.
 * Export (Phase 6) will measure from the last export instead of from opening.
 */
export function hasUnexportedEdits(state: EditorState): boolean {
  return state.document !== null && state.editDepth !== 0
}

/** The parts of a KeyboardEvent read by editShortcut. */
export interface EditShortcutKey extends ShortcutKey {
  /** The key is held down and repeating. */
  readonly repeat?: boolean
}

/**
 * The edit shortcut a key press asks for (P3-D9):
 *
 * - Delete: Delete Selection. Ignored while held down (repeats), so it never deletes twice, and
 *   with any modifier. Backspace is not a shortcut.
 * - Ctrl + Z (or ⌘ Command + Z): Undo.
 * - Ctrl + Y and Ctrl + Shift + Z: Redo. Holding Undo or Redo repeats them, as in other editors.
 *
 * Keys typed into text fields or editable content, during text composition or already handled
 * elsewhere are left alone, so text editing keeps its own Delete and Undo. Alt combinations are
 * ignored.
 */
export function editShortcut(event: EditShortcutKey): EditAction | null {
  if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return null
  const { key, ctrlKey, metaKey, altKey, shiftKey } = event
  if (key === 'Delete') return ctrlKey || metaKey || altKey || shiftKey || event.repeat ? null : 'delete-selection'
  if (!(ctrlKey || metaKey) || altKey) return null
  const letter = key.toLowerCase()
  if (letter === 'z') return shiftKey ? 'redo' : 'undo'
  if (letter === 'y' && !shiftKey) return 'redo'
  return null
}
