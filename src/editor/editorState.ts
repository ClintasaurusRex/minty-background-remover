import { snapToDevicePixels } from '../canvas/devicePixels'
import { keepImageReachable, limitPan } from '../canvas/pan'
import { clampZoom, fitViewport, nextZoomStep, panBy, resizeViewport, zoomAt } from '../canvas/viewport'
import type { ImportError } from '../image/import/errors'
import type { MagicWandOptions } from '../image/selection/magicWand'
import { clampTolerance } from './toleranceInput'
import { TOOLS } from './tools'
import type {
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
   * document. The workspace canvas closes it once it has been replaced.
   */
  readonly documentBitmap: ImageBitmap | null
  /**
   * How the document is presented, in CSS pixels and not snapped to device pixels.
   * Null until both a document and a non-empty workspace size are known.
   * Read it through displayViewport().
   */
  readonly viewport: ViewportState | null
  /** Null until the workspace has been measured. */
  readonly workspace: WorkspaceMetrics | null
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
   * The selected pixels of the open document, or null for no selection. Always the
   * document's size. Cleared when another image is opened; kept on tool changes.
   */
  readonly selection: SelectionMask | null
  /**
   * The most recent Magic Wand click, for re-applying it when a tolerance change is
   * committed. Whenever it is set, `selection` is exactly its result at its tolerance.
   * Null when there is nothing to re-apply: before the first click, after the selection
   * was changed in any other way (Select All, Clear, Invert, Grow, Shrink) and after
   * another image opened.
   */
  readonly lastMagicWandOperation: MagicWandOperation | null
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
 * The document version a selection was computed from. Selections are computed outside
 * the reducer, so by the time a result arrives another image may be open or the pixels
 * may have changed; a result for any other version is discarded.
 */
export interface DocumentVersion {
  readonly documentId: number
  readonly revision: number
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

export const initialEditorState: EditorState = {
  document: null,
  documentBitmap: null,
  viewport: null,
  workspace: null,
  pendingImportId: null,
  importError: null,
  pan: null,
  importNotice: null,
  activeTool: null,
  magicWand: DEFAULT_MAGIC_WAND_SETTINGS,
  selection: null,
  lastMagicWandOperation: null,
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
        // The current document, viewport, tool and selection are kept.
        return { ...state, pendingImportId: null, importError: result.error }
      }
      return {
        ...state,
        document: result.document,
        documentBitmap: result.bitmap,
        viewport: initialViewport(result.document, state.workspace),
        pendingImportId: null,
        importError: null,
        pan: null,
        // The selection and the click that made it belonged to the previous image.
        // Magic Wand options are kept.
        activeTool: 'magic-wand',
        selection: null,
        lastMagicWandOperation: null,
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
      return { ...state, pan: { origin: state.viewport, delta: { x: 0, y: 0 } } }

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

    case 'selection-applied': {
      const { version, selection } = action
      if (!fitsDocument(state, version, selection) || selection === state.selection) return state
      // The selection is no longer a Magic Wand result, so a tolerance change must not
      // re-apply a click over it.
      return { ...state, selection, lastMagicWandOperation: null }
    }

    case 'selection-cleared':
      return state.selection === null ? state : { ...state, selection: null, lastMagicWandOperation: null }

    case 'magic-wand-applied': {
      const { operation, selection } = action
      if (!fitsDocument(state, operation.version, selection)) return state
      // Add and Subtract were combined with `base`; if the selection has changed since,
      // the result (and the recorded base) would be stale. New does not depend on it.
      if (operation.selectionMode !== 'new' && operation.base !== state.selection) return state
      return { ...state, selection, lastMagicWandOperation: operation }
    }

    case 'magic-wand-reapplied': {
      const { operation, tolerance, selection } = action
      if (operation !== state.lastMagicWandOperation || !fitsDocument(state, operation.version, selection)) return state
      return { ...state, selection, lastMagicWandOperation: { ...operation, tolerance } }
    }
  }
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
  return { ...state, viewport: next, pan: rebasePan(state.pan, next) }
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
  if (viewport && previous && state.document) {
    viewport = keepImageReachable(resizeViewport(viewport, previous.size, workspace.size), state.document, workspace.size)
  } else if (state.document) {
    // The image arrived before the workspace had a usable size.
    viewport = initialViewport(state.document, workspace)
  }
  return { ...state, workspace, viewport, pan: rebasePan(state.pan, viewport) }
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
