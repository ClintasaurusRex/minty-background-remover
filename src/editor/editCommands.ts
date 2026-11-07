import { createDisplayImage } from '../canvas/displayImage'
import { type EdgeSettings, deleteSelectionWithEdges } from '../image/edit/deleteWithEdges'
import { isEditableTarget } from '../utils/domTargets'
import { type EditorAction, type EditorState, documentVersion, isImporting } from './editorState'
import { nextRedo, nextUndo } from './history/editHistory'
import { type EditKind, type HistoryEntry, remadeHistoryEntry } from './history/historyEntry'
import { applyPixelPatch, createPixelPatch } from './history/pixelPatch'
import { decodeSelection } from './history/selectionCodec'
import { type CreateDisplayImage, completedEditCommand, describeCause, redoCommand, undoCommand } from './historyCommands'
import { createEditedDocument } from './imageDocument'
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
 * colour kept hidden, then the edge cleanup and feathering chosen in `state.edgeSettings`
 * (§9; both 0 by default, and then exactly the Step 6 Delete) treat the edge it leaves
 * (deleteSelectionWithEdges). One edit: a new revision with its display image and one history
 * entry, whose patch covers every pixel changed, edge pixels included. The selection is cleared,
 * and Undo brings it back with the Magic Wand click that made it.
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
    result = deleteSelectionWithEdges(document.pixels, selection, state.edgeSettings)
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
      ...(result.edgePixels > 0 ? { edgePixels: result.edgePixels } : {}),
      edgeSettings: state.edgeSettings,
    },
    createImage,
  )
}

/*
 * Adjusting the last Delete (Phase 3 Step 9; FEATURE_SPEC.md §9). Right after Delete Selection,
 * while nothing has been selected since, committing another Edge cleanup or Feather amount makes
 * that Delete again with the new amounts, as if it had been made with them, instead of setting
 * them only for the next Delete. It stays one edit: its history entry is replaced, not added to.
 *
 * Everything needed is in the Delete's history entry: its patch gives back the pixels before it
 * (applied backwards to the current pixels, exactly), and it recorded the selection it deleted and
 * the amounts it was made with. Each adjustment starts again from those pixels and that selection,
 * never from an earlier result, so adjusting never builds on earlier cleanup or feathering.
 */

/**
 * The Delete Selection that committed edge amounts would make again, or null. Constant time, so
 * the controls can check it on every render.
 *
 * It is the Delete just applied, made again or redone, while it is still the latest thing done to
 * the image: the state's adjustable edit (editorState.ts: forgotten as soon as anything is
 * selected or the image or history changes otherwise), still the history's next Undo for the open
 * document with nothing to redo, with nothing selected and no Magic Wand click recorded, and no
 * other image opening (that would replace the result anyway).
 */
export function adjustableDelete(state: EditorState): HistoryEntry | null {
  const entry = state.adjustableEdit
  const version = documentVersion(state)
  if (!entry || !version || isImporting(state)) return null
  if (state.selection !== null || state.lastMagicWandOperation !== null || state.history.redo.length > 0) return null
  if (nextUndo(state.history, version) !== entry) return null
  return entry.kind === 'delete-selection' && entry.edgeSettings && entry.patch.kind === 'pixel-patch' ? entry : null
}

/**
 * The last Delete Selection made again with `settings` (whole pixels from 0 to 5, as the editor
 * keeps them):
 *
 * - The pixels before the Delete: its patch applied backwards to the current pixels, byte for byte
 *   (hidden colour included). The selection: the one its entry recorded, decoded.
 * - The result: deleteSelectionWithEdges of those with `settings`, exactly what Delete would have
 *   given with them (with 0 / 0 the exact Delete of Step 6). A new revision and its display image.
 * - The entry replaced by one with the new patch and amounts and the same selection and Magic Wand
 *   click, so one Undo still restores the image before the Delete, with its selection, and Redo
 *   the latest result.
 *
 * Returns null, computing nothing, when there is no Delete to adjust (adjustableDelete) or its
 * result was made with `settings` already. Returns `edit-failed` (operation 'adjust'), changing
 * nothing, when the result cannot be made or displayed (for example for lack of memory).
 *
 * Peak memory: the current pixels, the pixels before the Delete, the result and the decoded
 * selection, plus Delete's own strips: one image-sized buffer more than the Delete itself.
 */
export function adjustDeleteCommand(
  state: EditorState,
  settings: EdgeSettings,
  createImage: CreateDisplayImage = createDisplayImage,
): EditorAction | null {
  const entry = adjustableDelete(state)
  const { document } = state
  const version = documentVersion(state)
  if (!entry || !document || !version || !entry.edgeSettings || entry.patch.kind !== 'pixel-patch') return null
  if (entry.edgeSettings.cleanup === settings.cleanup && entry.edgeSettings.feather === settings.feather) return null
  try {
    const before = applyPixelPatch(document.pixels, entry.patch)
    const selection = decodeSelection(entry.selectionBefore)
    const result = deleteSelectionWithEdges(before, selection, settings)
    // The Delete changed pixels when it was made from these pixels and this selection, so it does
    // again; a result without changes would mean a damaged entry.
    const patch = result && createPixelPatch(before, result.pixels, result.bounds)
    if (!result || !patch) throw new Error('The Delete made again from its history entry changed nothing')
    const replacement = remadeHistoryEntry(entry, patch, settings)
    const next = createEditedDocument(document, result.pixels)
    const image = createImage(next.pixels)
    return { type: 'edit-adjusted', version, entry, replacement, document: next, image, edgePixels: result.edgePixels }
  } catch (cause) {
    return { type: 'edit-failed', error: { operation: 'adjust', detail: describeCause(cause) } }
  }
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
