import { snapToDevicePixels } from '../canvas/devicePixels'
import { clampZoom, fitViewport, nextZoomStep, resizeViewport, zoomAt } from '../canvas/viewport'
import type { ImportError } from '../image/import/errors'
import type { ImageDocument, Point, Size, ViewportState } from './types'

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
}

export type EditorAction =
  | { readonly type: 'import-started'; readonly importId: number }
  | { readonly type: 'import-finished'; readonly importId: number; readonly result: EditorImportResult }
  | { readonly type: 'import-error-dismissed' }
  | { readonly type: 'workspace-resized'; readonly workspace: WorkspaceMetrics }
  /** Multiplies the zoom, keeping the image point under `anchor` (workspace CSS px) fixed. */
  | { readonly type: 'zoom-scaled'; readonly anchor: Point; readonly factor: number }
  /** Zoom In / Zoom Out to the next stop, about the workspace centre. */
  | { readonly type: 'zoom-stepped'; readonly direction: 1 | -1 }
  /** Fit to Screen: fit larger images, show smaller ones at 100%, centred. */
  | { readonly type: 'zoom-fitted' }
  /** 100%, about the workspace centre. */
  | { readonly type: 'zoom-actual-size' }

export const initialEditorState: EditorState = {
  document: null,
  documentBitmap: null,
  viewport: null,
  workspace: null,
  pendingImportId: null,
  importError: null,
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'import-started':
      return { ...state, pendingImportId: action.importId, importError: null }

    case 'import-finished': {
      // An older import finishing after a newer one started must not replace anything.
      if (action.importId !== state.pendingImportId) return state
      const { result } = action
      if (!result.ok) {
        // The current document and viewport are kept.
        return { ...state, pendingImportId: null, importError: result.error }
      }
      return {
        ...state,
        document: result.document,
        documentBitmap: result.bitmap,
        viewport: initialViewport(result.document, state.workspace),
        pendingImportId: null,
        importError: null,
      }
    }

    case 'import-error-dismissed':
      return state.importError === null ? state : { ...state, importError: null }

    case 'workspace-resized':
      return resizeWorkspace(state, action.workspace)

    case 'zoom-scaled':
      return withViewport(state, (viewport) =>
        Number.isFinite(action.factor) && action.factor > 0
          ? zoomTo(viewport, action.anchor, viewport.zoom * action.factor)
          : viewport,
      )

    case 'zoom-stepped':
      return withViewport(state, (viewport, workspace) =>
        settled(zoomTo(viewport, centreOf(workspace.size), nextZoomStep(viewport.zoom, action.direction)), viewport, workspace),
      )

    case 'zoom-fitted':
      return withViewport(state, (_viewport, workspace, document) =>
        settled(fitViewport(document, workspace.size), null, workspace),
      )

    case 'zoom-actual-size':
      return withViewport(state, (viewport, workspace) =>
        settled(zoomTo(viewport, centreOf(workspace.size), 1), viewport, workspace),
      )
  }
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
  return { ...state, viewport: next }
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
  if (viewport && previous) {
    viewport = resizeViewport(viewport, previous.size, workspace.size)
  } else if (state.document) {
    // The image arrived before the workspace had a usable size.
    viewport = initialViewport(state.document, workspace)
  }
  return { ...state, workspace, viewport }
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
