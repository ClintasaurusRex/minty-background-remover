import { snapToDevicePixels } from '../canvas/devicePixels'
import type { DisplayImage } from '../canvas/displayImage'
import { keepImageReachable, limitPan } from '../canvas/pan'
import { clampZoom, fitViewport, nextZoomStep, panBy, resizeViewport, zoomAt } from '../canvas/viewport'
import { type EdgeSettings, MAX_EDGE_PIXELS, NO_EDGE_TREATMENT } from '../image/edit/deleteWithEdges'
import type { ImportError } from '../image/import/errors'
import { sharesPixelMemory } from '../image/pixelBuffer'
import type { MagicWandOptions } from '../image/selection/magicWand'
import {
  type EditHistory,
  clearEditHistory,
  createEditHistory,
  recordEdit,
  recordRedo,
  recordUndo,
  replaceLatestEdit,
} from './history/editHistory'
import { type EditKind, type HistoryEntry, sizeAfter, sizeBefore } from './history/historyEntry'
import { clampTolerance } from './toleranceInput'
import { TOOLS } from './tools'
import type {
  DocumentVersion,
  FloodMode,
  ImageDocument,
  PixelCoordinate,
  Point,
  SelectionMask,
  SelectionMode,
  Size,
  ToolId,
  ViewportState,
} from './types'

export type { DocumentVersion } from './types'

/** The workspace area the image is shown in, in CSS pixels. */
export interface WorkspaceMetrics {
  readonly size: Size
  readonly devicePixelRatio: number
}

/**
 * A finished import as the editor receives it. A successful import includes the
 * drawable bitmap for its pixels, created before the import is accepted so an image
 * that cannot be displayed is reported as a failed import.
 */
export type EditorImportResult =
  | { readonly ok: true; readonly document: ImageDocument; readonly bitmap: ImageBitmap }
  | { readonly ok: false; readonly error: ImportError }

export interface EditorState {
  /** The open image, or null before the first successful import. */
  readonly document: ImageDocument | null
  /**
   * A drawable copy of the document's pixels, always replaced together with the
   * document: the import's bitmap, or the display image an edit, Undo or Redo created
   * for its new revision (canvas/displayImage.ts). The workspace canvas releases it once
   * it has been replaced. Never kept in history, and never brought back once replaced.
   */
  readonly documentBitmap: DisplayImage | null
  /**
   * How the document is presented, in CSS pixels and not snapped to device pixels.
   * Null until both a document and a non-empty workspace size are known.
   * Read it through displayViewport().
   */
  readonly viewport: ViewportState | null
  /** Null until the workspace has been measured. */
  readonly workspace: WorkspaceMetrics | null
  /**
   * Whether the next workspace resize places the image again, as when it was opened,
   * instead of keeping its centre. Set by the import that first makes a tool active:
   * that tool's options row then appears above the workspace and makes it smaller, and
   * an image fitted to the workspace without the row would be too large for it (or
   * overflow it where the row wraps). Cleared by that resize and by any change of view.
   */
  readonly placeOnNextResize: boolean
  /** The most recent import still in progress. Results of any other import are stale. */
  readonly pendingImportId: number | null
  /** The last import failure, shown until dismissed or the next import starts. */
  readonly importError: ImportError | null
  /** The Space + drag pan in progress, or null. */
  readonly pan: PanDrag | null
  /** An informational message about the latest import, shown until dismissed or the next import starts. */
  readonly importNotice: ImportNotice | null
  /** The tool used by clicks on the image. Null until an image is open. */
  readonly activeTool: ToolId | null
  /** Magic Wand options. Kept for the session, across image imports and tool changes. */
  readonly magicWand: MagicWandSettings
  /**
   * Edge cleanup and feather amounts for the next Delete Selection (Phase 3 Step 8), whole
   * pixels from 0 to 5, both 0 by default (P3-D4). Like the Magic Wand options, kept for the
   * session. Changing them never changes the image by itself; a committed change also makes the
   * last Delete again while it can still be adjusted (adjustableEdit, Phase 3 Step 9), through
   * its own action.
   */
  readonly edgeSettings: EdgeSettings
  /**
   * The selected pixels of the open document, or null for no selection. Always the
   * document's size. Cleared when another image is opened; kept on tool changes.
   */
  readonly selection: SelectionMask | null
  /**
   * The most recent Magic Wand click, for re-applying it when a tolerance change is
   * committed. Whenever it is set, `selection` is exactly its result at its tolerance.
   * Null when there is nothing to re-apply: before the first click, after the selection
   * was changed in any other way (Select All, Clear, Invert, Grow, Shrink) and after
   * another image opened. After an edit or Redo it is null (the pixels it was made on have
   * changed); Undo restores the one from before the edit, bound to the restored version.
   */
  readonly lastMagicWandOperation: MagicWandOperation | null
  /**
   * Undo / Redo of image edits (editor/history/editHistory.ts), bound to the document's
   * current version. Selection changes are not entries and never change it. Cleared when
   * another image opens; kept when an import fails.
   */
  readonly history: EditHistory
  /**
   * The Delete Selection that a committed Edge cleanup or Feather amount makes again (Phase 3
   * Step 9): its history entry, from the moment the Delete is applied, made again or redone, until
   * anything else changes the selection (a Magic Wand click or re-apply, Select All, Clear, Invert,
   * Grow, Shrink), the image or the history (another edit, Undo, another image). Null otherwise.
   * View changes, option and amount changes, announcements and failed attempts keep it.
   *
   * Only usable while it is still the history's next Undo for the open document's version and
   * nothing can be redone (adjustableDelete in editCommands.ts checks this).
   */
  readonly adjustableEdit: HistoryEntry | null
  /** The last edit, Undo or Redo that failed, until dismissed or a later outcome (editNotice) replaces it. */
  readonly editError: EditError | null
  /**
   * How many edits the open image's pixels are away from the image as opened: every accepted
   * edit and Redo adds one, every Undo takes one away. The history is a single line and Undo
   * restores pixels exactly, so this is 0 exactly when the pixels are the opened ones (once
   * the limits have dropped the oldest entries, Undo can no longer bring it back to 0). Opening
   * an image sets it to 0. Read through hasUnexportedEdits (editCommands.ts); it never compares
   * images.
   */
  readonly editDepth: number
  /**
   * The latest edit, Undo or Redo that succeeded or changed nothing, for announcing it. Null
   * once a later one failed (editError) and after another image opened.
   */
  readonly editNotice: EditNotice | null
  /**
   * Increases with every new edit outcome (editError or editNotice set), so the same message
   * is announced again when the same thing happens twice.
   */
  readonly editFeedbackId: number
}

/** What a successful edit, Undo or Redo did, or an edit that changed nothing. */
export type EditNotice =
  /**
   * `changedPixels`: how many pixels the edit changed, when the tool reports it. `edgePixels`:
   * for a Delete with edge cleanup or feathering, how many edge pixels those changed besides.
   */
  | {
      readonly kind: 'applied'
      readonly operation: EditKind
      readonly changedPixels: number | null
      readonly edgePixels?: number
    }
  | { readonly kind: 'undone' | 'redone'; readonly operation: EditKind }
  /** The edit would have changed no pixel (Delete with only fully transparent pixels selected): nothing happened. */
  | { readonly kind: 'unchanged'; readonly operation: EditKind }
  /**
   * The latest edit was made again with other amounts (Phase 3 Step 9: the last Delete with the
   * Edge cleanup and Feather amounts committed): `edgeSettings` as used, and how many edge pixels
   * they changed besides the deleted ones.
   */
  | {
      readonly kind: 'adjusted'
      readonly operation: EditKind
      readonly edgeSettings: EdgeSettings
      readonly edgePixels: number
    }

/**
 * An edit, Undo or Redo that could not be completed (for example, for lack of memory). The
 * document, its selection and the history are unchanged. `adjust`: making the last Delete again
 * with new edge amounts (Phase 3 Step 9).
 */
export interface EditError {
  readonly operation: EditKind | 'undo' | 'redo' | 'adjust'
  /** Developer-facing cause. Not intended for display. */
  readonly detail?: string
}

/** The Magic Wand's options as chosen in the editor. */
export interface MagicWandSettings extends MagicWandOptions {
  /** How a Magic Wand result combines with the current selection. */
  readonly selectionMode: SelectionMode
}

export const DEFAULT_MAGIC_WAND_SETTINGS: MagicWandSettings = {
  tolerance: 20,
  floodMode: 'contiguous',
  selectionMode: 'new',
}

/**
 * A Magic Wand click as made, kept so it can be re-applied with another tolerance. Its
 * result is always `combineSelections(base, createMagicWandSelection(pixels, seed,
 * { tolerance, floodMode }), selectionMode)`, for the click and for every re-apply, so
 * re-applying never builds on an earlier re-applied result.
 *
 * Everything is captured when the click is made: later changes to the chosen options do
 * not alter the click being re-applied.
 */
export interface MagicWandOperation {
  /** The document version clicked; the click is never re-applied to any other. */
  readonly version: DocumentVersion
  /** The clicked image pixel. */
  readonly seed: PixelCoordinate
  /** Contiguous or Global, as chosen when clicking. */
  readonly floodMode: FloodMode
  /** New, Add or Subtract as actually used, including a Shift or Ctrl override. */
  readonly selectionMode: SelectionMode
  /**
   * The selection immediately before the click, shared rather than copied (masks are
   * immutable). Null for New: its result does not depend on the previous selection, so
   * that mask is not kept alive.
   */
  readonly base: SelectionMask | null
  /** The tolerance that produced the current selection. */
  readonly tolerance: number
}

/** Informational import messages, less serious than an ImportError. */
export type ImportNotice =
  /** Only one image can be open, so other dropped files were not opened. */
  | { readonly kind: 'ignored-files'; readonly count: number }
  /** Ctrl+V was pressed with no supported image on the clipboard. */
  | { readonly kind: 'no-clipboard-image' }

/**
 * A drag pan: the viewport when the drag started and the pointer movement since.
 * Each move is applied to the starting viewport rather than added to the previous
 * one, so the image tracks the pointer exactly with no accumulated rounding.
 */
export interface PanDrag {
  readonly origin: ViewportState
  readonly delta: Point
}

export type EditorAction =
  | { readonly type: 'import-started'; readonly importId: number; readonly ignoredFileCount?: number }
  /**
   * An import that could not start, e.g. a drop containing only folders. Keeps the
   * current image and does not cancel an import already in progress.
   */
  | { readonly type: 'import-rejected'; readonly error: ImportError }
  | { readonly type: 'import-notice-shown'; readonly notice: ImportNotice }
  | { readonly type: 'import-finished'; readonly importId: number; readonly result: EditorImportResult }
  | { readonly type: 'import-error-dismissed' }
  | { readonly type: 'import-notice-dismissed' }
  | { readonly type: 'workspace-resized'; readonly workspace: WorkspaceMetrics }
  /** Multiplies the zoom, keeping the image point under `anchor` (workspace CSS px) fixed. */
  | { readonly type: 'zoom-scaled'; readonly anchor: Point; readonly factor: number }
  /** Zoom In / Zoom Out to the next stop, about the workspace centre. */
  | { readonly type: 'zoom-stepped'; readonly direction: 1 | -1 }
  /** Fit to Screen: fit larger images, show smaller ones at 100%, centred. */
  | { readonly type: 'zoom-fitted' }
  /** 100%, about the workspace centre. */
  | { readonly type: 'zoom-actual-size' }
  | { readonly type: 'pan-drag-started' }
  /** `delta` is the total pointer movement since the drag started, in CSS px. */
  | { readonly type: 'pan-dragged'; readonly delta: Point }
  | { readonly type: 'pan-drag-ended' }
  /** Moves the image by `delta` CSS px (wheel and trackpad scrolling). */
  | { readonly type: 'wheel-panned'; readonly delta: Point }
  /** Ignored until an image is open, and for tools that are not available yet. */
  | { readonly type: 'tool-selected'; readonly tool: ToolId }
  /** Rounded to a whole number and clamped to 0–100; values that are not finite are ignored. */
  | { readonly type: 'magic-wand-tolerance-changed'; readonly tolerance: number }
  | { readonly type: 'magic-wand-flood-mode-changed'; readonly floodMode: FloodMode }
  | { readonly type: 'magic-wand-selection-mode-changed'; readonly selectionMode: SelectionMode }
  /**
   * Sets the edge cleanup and / or feather amount used by the next Delete Selection. Each is
   * rounded to a whole number and clamped to 0–5; values that are not finite are ignored.
   */
  | { readonly type: 'edge-settings-changed'; readonly settings: Partial<EdgeSettings> }
  /**
   * Replaces the selection with one computed for `version` of the open document (null
   * selects nothing). Ignored unless `version` is the open document's current version
   * and the mask is the document's size. The state keeps the mask itself, without
   * copying, and never modifies it. Used for every change other than a Magic Wand
   * click, so a change forgets the last Magic Wand operation.
   */
  | { readonly type: 'selection-applied'; readonly version: DocumentVersion; readonly selection: SelectionMask | null }
  /** Clears the selection and forgets the last Magic Wand operation. */
  | { readonly type: 'selection-cleared' }
  /**
   * A Magic Wand click: replaces the selection with its result and records the click as
   * the operation a committed tolerance change re-applies, even when the selection does
   * not change. Ignored for any other document version, a mask of another size, or an
   * Add or Subtract whose base is no longer the current selection.
   */
  | { readonly type: 'magic-wand-applied'; readonly operation: MagicWandOperation; readonly selection: SelectionMask | null }
  /**
   * `operation` re-applied with `tolerance`. Ignored unless `operation` is still the last
   * Magic Wand operation (so nothing has changed the selection since) and the result fits
   * the open document.
   */
  | {
      readonly type: 'magic-wand-reapplied'
      readonly operation: MagicWandOperation
      readonly tolerance: number
      readonly selection: SelectionMask | null
    }
  /**
   * A completed image edit of `version`: `document` (the same image, a new revision) and
   * the display image created for it, with its history entry and the selection it leaves.
   * Ignored unless `version` is the open document's current version, the selection and
   * Magic Wand click it was computed with are still the state's own, and everything fits
   * (a new revision of the same image, the image's size, the patch's sizes). Clears Redo.
   */
  | {
      readonly type: 'edit-applied'
      readonly version: DocumentVersion
      readonly selectionBefore: SelectionMask | null
      readonly magicWandOperationBefore: MagicWandOperation | null
      readonly entry: HistoryEntry
      readonly document: ImageDocument
      readonly image: DisplayImage
      readonly selection: SelectionMask | null
      /** How many pixels the edit changed, when the tool reports it (for the announcement). */
      readonly changedPixels?: number
      /** Edge pixels changed by Delete's edge cleanup and feathering, when there were any (for the announcement). */
      readonly edgePixels?: number
    }
  /**
   * An edit of `version` that would have changed no pixel, so nothing was recorded and nothing
   * changes but the announcement. Ignored for any other version.
   */
  | { readonly type: 'edit-unchanged'; readonly version: DocumentVersion; readonly operation: EditKind }
  /**
   * Undo of `entry`, computed from `version`: the restored pixels as a new revision, its
   * display image, and the selection and Magic Wand click from before the edit, the click
   * bound to the new revision. Ignored unless `version` is the open document's current
   * version, the history is bound to it and `entry` is its next Undo.
   */
  | {
      readonly type: 'edit-undone'
      readonly version: DocumentVersion
      readonly entry: HistoryEntry
      readonly document: ImageDocument
      readonly image: DisplayImage
      readonly selection: SelectionMask | null
      readonly magicWandOperation: MagicWandOperation | null
    }
  /** Redo of `entry`, computed from `version`, with the selection after the edit. Checked as Undo is. */
  | {
      readonly type: 'edit-redone'
      readonly version: DocumentVersion
      readonly entry: HistoryEntry
      readonly document: ImageDocument
      readonly image: DisplayImage
      readonly selection: SelectionMask | null
    }
  /**
   * The latest edit, `entry`, made again from the pixels before it (Phase 3 Step 9: the last
   * Delete with other edge amounts), computed from `version`: `document` (a new revision of the
   * result) and its display image, with `replacement` taking `entry`'s place in the history. The
   * selection stays empty and the number of entries the same. Ignored unless `version` is the
   * open document's current version, `entry` is the state's adjustable edit and the history's next
   * Undo with nothing to redo, nothing is selected, and everything fits (a new revision of the
   * same image, of the same size).
   */
  | {
      readonly type: 'edit-adjusted'
      readonly version: DocumentVersion
      readonly entry: HistoryEntry
      readonly replacement: HistoryEntry
      readonly document: ImageDocument
      readonly image: DisplayImage
      /** Edge pixels the new amounts changed besides the deleted ones (for the announcement). */
      readonly edgePixels: number
    }
  /** An edit, Undo or Redo failed; nothing else changes. */
  | { readonly type: 'edit-failed'; readonly error: EditError }
  | { readonly type: 'edit-error-dismissed' }

export const initialEditorState: EditorState = {
  document: null,
  documentBitmap: null,
  viewport: null,
  workspace: null,
  placeOnNextResize: false,
  pendingImportId: null,
  importError: null,
  pan: null,
  importNotice: null,
  activeTool: null,
  magicWand: DEFAULT_MAGIC_WAND_SETTINGS,
  edgeSettings: NO_EDGE_TREATMENT,
  selection: null,
  lastMagicWandOperation: null,
  history: createEditHistory(),
  adjustableEdit: null,
  editError: null,
  editDepth: 0,
  editNotice: null,
  editFeedbackId: 0,
}

const FLOOD_MODES: readonly FloodMode[] = ['contiguous', 'global']
const SELECTION_MODES: readonly SelectionMode[] = ['new', 'add', 'subtract']

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'import-started':
      return {
        ...state,
        pendingImportId: action.importId,
        importError: null,
        importNotice: action.ignoredFileCount ? { kind: 'ignored-files', count: action.ignoredFileCount } : null,
      }

    case 'import-rejected':
      return { ...state, importError: action.error, importNotice: null }

    case 'import-notice-shown':
      return { ...state, importNotice: action.notice }

    case 'import-finished': {
      // An older import finishing after a newer one started must not replace anything.
      if (action.importId !== state.pendingImportId) return state
      const { result } = action
      if (!result.ok) {
        // The current document, viewport, tool, selection and history are kept.
        return { ...state, pendingImportId: null, importError: result.error }
      }
      return {
        ...state,
        document: result.document,
        documentBitmap: result.bitmap,
        viewport: initialViewport(result.document, state.workspace),
        // The first image makes the Magic Wand active, and its options row is about to
        // take room from the workspace.
        placeOnNextResize: state.activeTool === null,
        pendingImportId: null,
        importError: null,
        pan: null,
        // The selection and the click that made it belonged to the previous image.
        // Magic Wand options are kept.
        activeTool: 'magic-wand',
        selection: null,
        lastMagicWandOperation: null,
        // Edits of the previous image cannot apply to this one.
        history: clearEditHistory(state.history),
        adjustableEdit: null,
        editError: null,
        editDepth: 0,
        editNotice: null,
      }
    }

    case 'import-error-dismissed':
      return state.importError === null ? state : { ...state, importError: null }

    case 'import-notice-dismissed':
      return state.importNotice === null ? state : { ...state, importNotice: null }

    case 'workspace-resized':
      return resizeWorkspace(state, action.workspace)

    case 'zoom-scaled':
      return withViewport(state, (viewport, workspace, document) =>
        Number.isFinite(action.factor) && action.factor > 0
          ? keepImageReachable(zoomTo(viewport, action.anchor, viewport.zoom * action.factor), document, workspace.size)
          : viewport,
      )

    case 'zoom-stepped':
      return withViewport(state, (viewport, workspace, document) => {
        const next = zoomTo(viewport, centreOf(workspace.size), nextZoomStep(viewport.zoom, action.direction))
        return settled(keepImageReachable(next, document, workspace.size), viewport, workspace)
      })

    case 'zoom-fitted':
      return withViewport(state, (_viewport, workspace, document) =>
        settled(fitViewport(document, workspace.size), null, workspace),
      )

    case 'zoom-actual-size':
      return withViewport(state, (viewport, workspace, document) => {
        const next = zoomTo(viewport, centreOf(workspace.size), 1)
        return settled(keepImageReachable(next, document, workspace.size), viewport, workspace)
      })

    case 'pan-drag-started':
      if (!state.viewport || !state.document) return state
      return { ...state, pan: { origin: state.viewport, delta: { x: 0, y: 0 } }, placeOnNextResize: false }

    case 'pan-dragged': {
      const { pan } = state
      if (!pan) return state
      const next = withViewport(state, (_viewport, workspace, document) =>
        // Snapped when stored: the image moves in whole device pixels with the pointer,
        // and a later wheel zoom starts from exactly what is displayed.
        snapToDevicePixels(
          limitPan(panBy(pan.origin, action.delta), pan.origin, document, workspace.size),
          workspace.devicePixelRatio,
        ),
      )
      return { ...next, pan: { origin: pan.origin, delta: action.delta } }
    }

    case 'pan-drag-ended':
      return state.pan ? { ...state, pan: null } : state

    case 'wheel-panned':
      // Not snapped when stored: small trackpad movements would otherwise be rounded
      // away. They add up exactly and are snapped only for display.
      return withViewport(state, (viewport, workspace, document) =>
        Number.isFinite(action.delta.x) && Number.isFinite(action.delta.y)
          ? limitPan(panBy(viewport, action.delta), viewport, document, workspace.size)
          : viewport,
      )

    case 'tool-selected':
      if (!state.document || action.tool === state.activeTool) return state
      return isAvailableTool(action.tool) ? { ...state, activeTool: action.tool } : state

    case 'magic-wand-tolerance-changed': {
      if (!Number.isFinite(action.tolerance)) return state
      return withMagicWand(state, { tolerance: clampTolerance(action.tolerance) })
    }

    case 'magic-wand-flood-mode-changed':
      return FLOOD_MODES.includes(action.floodMode) ? withMagicWand(state, { floodMode: action.floodMode }) : state

    case 'magic-wand-selection-mode-changed':
      return SELECTION_MODES.includes(action.selectionMode)
        ? withMagicWand(state, { selectionMode: action.selectionMode })
        : state

    case 'edge-settings-changed':
      return withEdgeSettings(state, action.settings)

    case 'selection-applied': {
      const { version, selection } = action
      if (!fitsDocument(state, version, selection) || selection === state.selection) return state
      // The selection is no longer a Magic Wand result, so a tolerance change must not
      // re-apply a click over it. Selecting also ends adjusting the last Delete.
      return { ...state, selection, lastMagicWandOperation: null, adjustableEdit: null }
    }

    case 'selection-cleared':
      return state.selection === null
        ? state
        : { ...state, selection: null, lastMagicWandOperation: null, adjustableEdit: null }

    case 'magic-wand-applied': {
      const { operation, selection } = action
      if (!fitsDocument(state, operation.version, selection)) return state
      // Add and Subtract were combined with `base`; if the selection has changed since,
      // the result (and the recorded base) would be stale. New does not depend on it.
      if (operation.selectionMode !== 'new' && operation.base !== state.selection) return state
      // A click starts the next selection: the edge amounts are for the next Delete from now on.
      return { ...state, selection, lastMagicWandOperation: operation, adjustableEdit: null }
    }

    case 'magic-wand-reapplied': {
      const { operation, tolerance, selection } = action
      if (operation !== state.lastMagicWandOperation || !fitsDocument(state, operation.version, selection)) return state
      return { ...state, selection, lastMagicWandOperation: { ...operation, tolerance }, adjustableEdit: null }
    }

    case 'edit-applied':
      return applyEdit(state, action)

    case 'edit-undone':
      return undoEdit(state, action)

    case 'edit-redone':
      return redoEdit(state, action)

    case 'edit-adjusted':
      return adjustEdit(state, action)

    case 'edit-unchanged': {
      const { document } = state
      if (!document || !isVersionOf(action.version, document)) return state
      return withEditFeedback(state, null, { kind: 'unchanged', operation: action.operation })
    }

    case 'edit-failed':
      return withEditFeedback(state, action.error, null)

    case 'edit-error-dismissed':
      return state.editError === null ? state : { ...state, editError: null }
  }
}

type EditAction<T extends EditorAction['type']> = Extract<EditorAction, { readonly type: T }>

/*
 * Document changes (edits, Undo, Redo). Everything is computed outside the reducer (pixels,
 * patches, encoded and decoded selections, display images); these only check, in constant
 * time apart from the history's memory accounting, that the result belongs to the current
 * state, and then replace the document, its display image, the selection and the history
 * together. A rejected action returns `state` itself: nothing is partly applied.
 */

function applyEdit(state: EditorState, action: EditAction<'edit-applied'>): EditorState {
  const { version, entry, document: next, image, selection } = action
  const current = state.document
  if (!current || !isVersionOf(version, current) || !isNewContentState(current, next, image)) return state
  // The edit was computed with this selection (Delete deletes it) and recorded this click for
  // Undo: if either has changed since, the result and its entry are stale.
  if (action.selectionBefore !== state.selection || action.magicWandOperationBefore !== state.lastMagicWandOperation) {
    return state
  }
  if (!patchFits(entry, current, next) || !fitsSize(selection, next)) return state
  const notice: EditNotice = {
    kind: 'applied',
    operation: entry.kind,
    changedPixels: action.changedPixels ?? null,
    ...(action.edgePixels ? { edgePixels: action.edgePixels } : {}),
  }
  return {
    ...withEditFeedback(state, null, notice),
    ...moveContent(state, next, contentShift(entry, 1)),
    document: next,
    documentBitmap: image,
    selection,
    lastMagicWandOperation: null,
    history: recordEdit(state.history, version, entry, versionOf(next)),
    adjustableEdit: adjustableAfter(entry, selection),
    editDepth: state.editDepth + 1,
  }
}

function undoEdit(state: EditorState, action: EditAction<'edit-undone'>): EditorState {
  const { version, entry, document: next, image, selection, magicWandOperation } = action
  const current = state.document
  if (!current || !isVersionOf(version, current) || !isNewContentState(current, next, image)) return state
  // The restored image is the one before the edit; the current one the one after it.
  if (!patchFits(entry, next, current) || !fitsSize(selection, next)) return state
  if (magicWandOperation && (!isVersionOf(magicWandOperation.version, next) || !fitsSize(magicWandOperation.base, next))) {
    return state
  }
  const history = recordUndo(state.history, version, entry, versionOf(next))
  if (!history) return state
  return {
    ...withEditFeedback(state, null, { kind: 'undone', operation: entry.kind }),
    ...moveContent(state, next, contentShift(entry, -1)),
    document: next,
    documentBitmap: image,
    selection,
    lastMagicWandOperation: magicWandOperation,
    history,
    // The selection is back, ready for the next Delete: the amounts set what that Delete does.
    adjustableEdit: null,
    editDepth: state.editDepth - 1,
  }
}

function redoEdit(state: EditorState, action: EditAction<'edit-redone'>): EditorState {
  const { version, entry, document: next, image, selection } = action
  const current = state.document
  if (!current || !isVersionOf(version, current) || !isNewContentState(current, next, image)) return state
  if (!patchFits(entry, current, next) || !fitsSize(selection, next)) return state
  const history = recordRedo(state.history, version, entry, versionOf(next))
  if (!history) return state
  return {
    ...withEditFeedback(state, null, { kind: 'redone', operation: entry.kind }),
    ...moveContent(state, next, contentShift(entry, 1)),
    document: next,
    documentBitmap: image,
    selection,
    lastMagicWandOperation: null,
    history,
    adjustableEdit: adjustableAfter(entry, selection),
    editDepth: state.editDepth + 1,
  }
}

/**
 * The latest edit made again from the pixels before it (Phase 3 Step 9). Constant time apart from
 * the history's memory accounting, like the other document changes. The edit depth is unchanged:
 * the image is still one edit away from where it was before `entry`.
 */
function adjustEdit(state: EditorState, action: EditAction<'edit-adjusted'>): EditorState {
  const { version, entry, replacement, document: next, image } = action
  const current = state.document
  if (!current || !isVersionOf(version, current) || !isNewContentState(current, next, image)) return state
  // Only the edit the user has just made, applied again or redone, and only while nothing has been
  // selected since: a selection is the start of the next edit, which the amounts then configure.
  if (entry !== state.adjustableEdit || replacement.kind !== entry.kind) return state
  if (state.selection !== null || state.lastMagicWandOperation !== null) return state
  if (!sameSize(current, next) || !patchFits(replacement, current, next)) return state
  const history = replaceLatestEdit(state.history, version, entry, replacement, versionOf(next))
  if (!history || !replacement.edgeSettings) return state
  return {
    ...withEditFeedback(state, null, {
      kind: 'adjusted',
      operation: replacement.kind,
      edgeSettings: replacement.edgeSettings,
      edgePixels: action.edgePixels,
    }),
    document: next,
    documentBitmap: image,
    history,
    adjustableEdit: replacement,
  }
}

/**
 * The edit a committed edge amount makes again after `entry` was applied or redone, leaving
 * `selection`: a Delete Selection recorded with its edge amounts, which leaves nothing selected.
 */
function adjustableAfter(entry: HistoryEntry, selection: SelectionMask | null): HistoryEntry | null {
  return entry.kind === 'delete-selection' && entry.edgeSettings && entry.patch.kind === 'pixel-patch' && selection === null
    ? entry
    : null
}

/** `state` reporting a new edit outcome: an error or a notice (the other is cleared). */
function withEditFeedback(state: EditorState, error: EditError | null, notice: EditNotice | null): EditorState {
  return { ...state, editError: error, editNotice: notice, editFeedbackId: state.editFeedbackId + 1 }
}

function isVersionOf(version: DocumentVersion, document: ImageDocument): boolean {
  return version.documentId === document.id && version.revision === document.revision
}

function versionOf(document: ImageDocument): DocumentVersion {
  return { documentId: document.id, revision: document.revision }
}

/**
 * Whether `next` can follow `current`: the same image, a revision newer than any it has had
 * (revisions only increase, so an earlier document or revision can never come back), its own
 * pixel memory (copy-on-write), and a display image of its size.
 *
 * A released display image has no size (releaseDisplayImage), so an action whose image has been
 * released is never accepted, whatever the state: once app/editDispatch.ts has released the image
 * of a rejected action, React processing that action again cannot bring the image back.
 */
function isNewContentState(current: ImageDocument, next: ImageDocument, image: DisplayImage): boolean {
  return (
    next.id === current.id &&
    next.revision > current.revision &&
    next.width === next.pixels.width &&
    next.height === next.pixels.height &&
    image.width === next.width &&
    image.height === next.height &&
    !sharesPixelMemory(next.pixels, current.pixels)
  )
}

/** Whether `entry`'s patch turns an image of `original`'s size into one of `edited`'s. */
function patchFits(entry: HistoryEntry, original: Size, edited: Size): boolean {
  return sameSize(sizeBefore(entry.patch), original) && sameSize(sizeAfter(entry.patch), edited)
}

function sameSize(a: Size, b: Size): boolean {
  return a.width === b.width && a.height === b.height
}

function fitsSize(mask: SelectionMask | null, size: Size): boolean {
  return !mask || sameSize(mask, size)
}

/**
 * Where the new image's top-left pixel was in the current image, in image pixels: the kept
 * rectangle's corner for a crop or its Redo (direction 1), the opposite for its Undo (-1),
 * nothing for same-size edits.
 */
function contentShift(entry: HistoryEntry, direction: 1 | -1): Point {
  const { patch } = entry
  if (patch.kind !== 'crop-patch') return { x: 0, y: 0 }
  return { x: direction * patch.kept.x, y: direction * patch.kept.y }
}

/**
 * The view after the document changes to `next`. Same-size edits keep it exactly. When the
 * size changes (a crop, or its Undo), the zoom is kept and the image moves so that the pixels
 * both images have stay where they were on screen, then is kept reachable; Undo of a crop
 * therefore returns to the view before it. (Provisional: the view after Auto Trim is
 * confirmed in Phase 3 Step 10, P3-D6.)
 */
function moveContent(state: EditorState, next: ImageDocument, shift: Point): Pick<EditorState, 'viewport' | 'pan'> {
  const { viewport, workspace, document: current } = state
  if (!viewport || !workspace || !current || (sameSize(current, next) && shift.x === 0 && shift.y === 0)) {
    return { viewport, pan: state.pan }
  }
  const moved: ViewportState = {
    zoom: viewport.zoom,
    offset: { x: viewport.offset.x + shift.x * viewport.zoom, y: viewport.offset.y + shift.y * viewport.zoom },
  }
  const reachable = keepImageReachable(moved, next, workspace.size)
  return { viewport: reachable, pan: rebasePan(state.pan, reachable) }
}

/**
 * Whether a selection computed for `version` can be applied: it is the open document's
 * current version and the mask (if any) is the document's size.
 */
function fitsDocument(state: EditorState, version: DocumentVersion, selection: SelectionMask | null): boolean {
  const { document } = state
  if (!document || version.documentId !== document.id || version.revision !== document.revision) return false
  return !selection || (selection.width === document.width && selection.height === document.height)
}

/** The open document's current version, for tagging a selection computed from it. Null without a document. */
export function documentVersion(state: EditorState): DocumentVersion | null {
  const { document } = state
  return document ? { documentId: document.id, revision: document.revision } : null
}

function isAvailableTool(id: ToolId): boolean {
  return TOOLS.some((tool) => tool.id === id && tool.available)
}

/** Changes Magic Wand options, returning the state unchanged when nothing differs. */
function withMagicWand(state: EditorState, change: Partial<MagicWandSettings>): EditorState {
  const current = state.magicWand
  const next = { ...current, ...change }
  if (
    next.tolerance === current.tolerance &&
    next.floodMode === current.floodMode &&
    next.selectionMode === current.selectionMode
  ) {
    return state
  }
  return { ...state, magicWand: next }
}

/** A Delete edge amount as the editor keeps it: a whole number of pixels from 0 to 5. */
function clampEdgePixels(value: number): number {
  return Math.min(MAX_EDGE_PIXELS, Math.max(0, Math.round(value)))
}

/**
 * `current` with `change` applied as `edge-settings-changed` applies it: each given amount rounded
 * and clamped to 0–5, values that are not finite ignored. `current` itself when nothing differs.
 */
export function mergeEdgeSettings(current: EdgeSettings, change: Partial<EdgeSettings>): EdgeSettings {
  const pick = (value: number | undefined, previous: number) =>
    value !== undefined && Number.isFinite(value) ? clampEdgePixels(value) : previous
  const cleanup = pick(change.cleanup, current.cleanup)
  const feather = pick(change.feather, current.feather)
  return cleanup === current.cleanup && feather === current.feather ? current : { cleanup, feather }
}

/** Changes the edge settings, ignoring values that are not finite; the state itself when nothing differs. */
function withEdgeSettings(state: EditorState, change: Partial<EdgeSettings>): EditorState {
  const edgeSettings = mergeEdgeSettings(state.edgeSettings, change)
  return edgeSettings === state.edgeSettings ? state : { ...state, edgeSettings }
}

/**
 * Zooms about `anchor`, clamped to the supported range. At a limit the viewport is
 * returned as it is, so pressing against a limit cannot nudge the image.
 */
function zoomTo(viewport: ViewportState, anchor: Point, zoom: number): ViewportState {
  const next = clampZoom(zoom)
  return next === viewport.zoom ? viewport : zoomAt(viewport, anchor, next)
}

function centreOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 }
}

/**
 * Applies a viewport change when an image is shown. Zoom changes work on the stored,
 * unsnapped viewport, so zooming in and back out returns exactly to where it started
 * and repeated zooming never accumulates snapping error. The state is returned
 * unchanged when the zoom would not change (for example, at a zoom limit).
 */
function withViewport(
  state: EditorState,
  change: (viewport: ViewportState, workspace: WorkspaceMetrics, document: ImageDocument) => ViewportState,
): EditorState {
  const { viewport, workspace, document } = state
  if (!viewport || !workspace || !document) return state
  const next = change(viewport, workspace, document)
  if (next.zoom === viewport.zoom && next.offset.x === viewport.offset.x && next.offset.y === viewport.offset.y) {
    return state
  }
  return { ...state, viewport: next, pan: rebasePan(state.pan, next), placeOnNextResize: false }
}

/**
 * Keeps a drag in progress consistent when something else (a zoom or resize) moves
 * the image: the drag continues from the new position instead of jumping back.
 */
function rebasePan(pan: PanDrag | null, viewport: ViewportState | null): PanDrag | null {
  if (!pan || !viewport) return pan
  return { origin: panBy(viewport, { x: -pan.delta.x, y: -pan.delta.y }), delta: pan.delta }
}

function resizeWorkspace(state: EditorState, workspace: WorkspaceMetrics): EditorState {
  const previous = state.workspace
  if (
    previous &&
    previous.size.width === workspace.size.width &&
    previous.size.height === workspace.size.height &&
    previous.devicePixelRatio === workspace.devicePixelRatio
  ) {
    return state
  }

  let viewport = state.viewport
  if (viewport && previous && state.document && !state.placeOnNextResize) {
    viewport = keepImageReachable(resizeViewport(viewport, previous.size, workspace.size), state.document, workspace.size)
  } else if (state.document) {
    // The image arrived before the workspace had a usable size, or was placed for the
    // workspace as it was before the first tool's options row appeared.
    viewport = initialViewport(state.document, workspace)
  }
  return { ...state, workspace, viewport, pan: rebasePan(state.pan, viewport), placeOnNextResize: false }
}

/** Initial placement: fit larger images, show smaller ones at 100%, centred. */
function initialViewport(document: ImageDocument, workspace: WorkspaceMetrics | null): ViewportState | null {
  if (!workspace || workspace.size.width <= 0 || workspace.size.height <= 0) return null
  return settled(fitViewport(document, workspace.size), null, workspace)
}

/**
 * Snaps a viewport set by a discrete action (initial placement, Fit, 100%, Zoom In /
 * Out) to whole device pixels, so what is displayed is exactly what is stored. Wheel
 * zoom that starts from here then keeps the pixel the user sees under the pointer.
 *
 * Wheel zoom and resizing are not snapped when stored, only when displayed, so
 * zooming in and back out returns exactly to the start and nothing accumulates.
 */
function settled(
  viewport: ViewportState,
  previous: ViewportState | null,
  workspace: WorkspaceMetrics,
): ViewportState {
  // Unchanged (e.g. already at a zoom limit): leave it exactly as it was.
  if (viewport === previous) return viewport
  return snapToDevicePixels(viewport, workspace.devicePixelRatio)
}

/**
 * The viewport to draw and hit-test with: the stored viewport snapped to whole
 * device pixels. Rendering and pointer-to-pixel conversion must both use this value
 * so they always agree. Wheel zoom and resizes store unsnapped values (see settled)
 * so they never accumulate rounding.
 */
export function displayViewport(state: EditorState): ViewportState | null {
  if (!state.viewport || !state.workspace) return null
  return snapToDevicePixels(state.viewport, state.workspace.devicePixelRatio)
}

export function isImporting(state: EditorState): boolean {
  return state.pendingImportId !== null
}
