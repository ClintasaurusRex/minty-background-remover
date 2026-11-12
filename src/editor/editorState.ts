import { viewportToImage } from '../canvas/coordinates'
import { cropRectOnScreen, hitTestCrop } from '../canvas/cropOverlay'
import { snapToDevicePixels, toDisplayViewport } from '../canvas/devicePixels'
import type { DisplayImage } from '../canvas/displayImage'
import { keepImageReachable, limitPan } from '../canvas/pan'
import { MAX_ZOOM, MIN_ZOOM, clampZoom, fitViewport, nextZoomStep, panBy, resizeViewport } from '../canvas/viewport'
import { imagePointAtPointer, viewportDrawingAt } from '../canvas/zoomAnchor'
import {
  type CropField,
  type CropHandle,
  isValidCropRect,
  moveCropRect,
  nearestCorner,
  rectBetween,
  resizeCropRect,
  sameRect,
  setCropField,
  wholeImageRect,
} from '../image/crop/cropRectangle'
import { type Rgba, isRgba } from '../image/colour/colour'
import { type EdgeSettings, MAX_EDGE_PIXELS, NO_EDGE_TREATMENT } from '../image/edit/deleteWithEdges'
import type { ImportError } from '../image/import/errors'
import { sharesPixelMemory } from '../image/pixelBuffer'
import type { MagicWandOptions } from '../image/selection/magicWand'
import { DEFAULT_AUTO_TRIM_PADDING, clampAutoTrimPadding } from './autoTrimPadding'
import {
  type EditHistory,
  clearEditHistory,
  createEditHistory,
  isBoundTo,
  nextUndo,
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
  Rectangle,
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
  /**
   * The canvas's content box in device pixels as the browser lays it out (device-pixel-content-box),
   * when the browser reports it: the canvas backing store (backingStoreSize, canvas/devicePixels.ts).
   */
  readonly deviceSize?: Size | null
}

/**
 * A finished import as the editor receives it. A successful import includes the
 * drawable bitmap for its pixels, created before the import is accepted so an image
 * that cannot be displayed is reported as a failed import.
 */
export type EditorImportResult =
  | { readonly ok: true; readonly document: ImageDocument; readonly bitmap: ImageBitmap }
  | { readonly ok: false; readonly error: ImportError }

/** The image point a zoom kept at its anchor (imagePointAtPointer), and the viewport it did that for. */
export interface ZoomAnchor {
  readonly viewport: ViewportState
  readonly devicePixelRatio: number
  /** Viewport point (CSS px). */
  readonly anchor: Point
  /** Image point (image px) drawn at the anchor. */
  readonly image: Point
}

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
   * instead of keeping its centre. Set by an import that makes the Magic Wand active when
   * it was not (the first image, or one opened while Auto Trim was active): its options row
   * then replaces the previous one (or none) above the workspace and can change its height,
   * and an image fitted to the workspace as it was would no longer fit it (or overflow it where
   * the row wraps). Cleared by that resize and by any change of view.
   */
  readonly placeOnNextResize: boolean
  /** The most recent import still in progress. Results of any other import are stale. */
  readonly pendingImportId: number | null
  /** The last import failure, shown until dismissed or the next import starts. */
  readonly importError: ImportError | null
  /** The Space + drag pan in progress, or null. */
  readonly pan: PanDrag | null
  /**
   * The image point the last zoom kept under its anchor, so the next zoom about the same anchor
   * keeps exactly that point rather than one re-measured from the snapped display (see zoomAbout).
   * Valid only while `viewport` is still the very viewport that zoom produced.
   */
  readonly zoomAnchor: ZoomAnchor | null
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
   * Auto Trim's padding (Phase 3 Step 11): whole pixels from 0 to 50 kept around the visible
   * pixels on each side, as far as the image reaches. 5 by default, and set back to 5 whenever
   * another image is opened. Changing it never changes the image; Trim uses it.
   */
  readonly autoTrimPadding: number
  /**
   * The Crop tool's rectangle being chosen and the drag adjusting it (Phase 4, Manual Crop). Only
   * meaningful while Crop is the active tool; read the rectangle through pendingCrop(). Choosing a
   * tool, opening another image and any change of the image's size (Crop, Auto Trim, their Undo
   * and Redo) clear it; edits that keep the size (Delete Selection, its Undo and Redo) keep it, as
   * its pixel coordinates still mean the same area. Never touches pixels.
   */
  readonly crop: CropState
  /**
   * The colour the Eyedropper read or the colour picker set (Phase 4), or null before either. Kept
   * for the session, across tools and images, like the tool options; it is a value, not part of
   * the image, and choosing it never changes a pixel.
   */
  readonly colour: ChosenColour | null
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
  /**
   * The PNG export being written (editor/exportCommands.ts), or null. One at a time: Export is
   * unavailable until it finishes or fails. It continues if another image is opened meanwhile, and
   * still saves the image it started with.
   */
  readonly exporting: ExportJob | null
  /**
   * The content state the open image's last finished export saved, or null when it has not been
   * exported. hasUnexportedEdits (editCommands.ts) compares it with the current one. Cleared when
   * another image is opened.
   */
  readonly lastExport: LastExport | null
}

/**
 * One content state of the open image, identified without comparing pixels: the document, its edit
 * depth and the history's next Undo (null when there is none). The history is one line and entries
 * are never changed (a remade Delete is a new entry), so while the image stays open these identify
 * the pixels exactly: Undo then Redo returns to the same three, and any other change does not.
 */
export interface ExportedContent {
  readonly documentId: number
  readonly editDepth: number
  readonly entry: HistoryEntry | null
}

/**
 * What state.lastExport remembers of the content state an export saved: ExportedContent with its
 * history entry held weakly. An export must not keep an entry's patch alive (up to hundreds of MB)
 * once the history has dropped it; an entry nothing else holds can never be the history's next Undo
 * again, so it then no longer matters which entry it was.
 */
export interface LastExport {
  readonly documentId: number
  readonly editDepth: number
  readonly entry: WeakRef<HistoryEntry> | null
}

/** A PNG export in progress (PNG export, brought forward from Phase 6). */
export interface ExportJob {
  /** Identifies the export's outcome. Never reused in the session. */
  readonly id: number
  /** The suggested file name, for example "pump-station-cleaned.png". */
  readonly fileName: string
  /** The content state being written, as it was when the export started. */
  readonly content: ExportedContent
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
      /** For an edit that changed the image's size (Auto Trim): its size before and after. */
      readonly resized?: { readonly from: Size; readonly to: Size }
      /**
       * Undo steps the history dropped to stay within its limits (25 entries, 256 MiB) when it
       * recorded this edit, oldest first; absent when none. Redo steps a new edit always discards
       * are not counted.
       */
      readonly droppedUndoSteps?: number
    }
  | { readonly kind: 'undone' | 'redone'; readonly operation: EditKind }
  /**
   * The edit would have changed no pixel (Delete with only fully transparent pixels selected, Auto
   * Trim with nothing to trim): nothing happened. `trim`: why Auto Trim had nothing to do.
   */
  | { readonly kind: 'unchanged'; readonly operation: EditKind; readonly trim?: AutoTrimNoChange }
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
  /** The image was exported as a PNG file named `fileName` (handed to the browser to download). */
  | { readonly kind: 'exported'; readonly fileName: string }

/** Why Auto Trim changed nothing (Phase 3 Step 11). */
export type AutoTrimNoChange =
  /** No pixel of the image is visible: every alpha is 0. */
  | { readonly kind: 'nothing-visible' }
  /** The visible pixels, with `padding` around them, already reach every edge of the image. */
  | { readonly kind: 'no-border'; readonly padding: number }

/**
 * An edit, Undo or Redo that could not be completed (for example, for lack of memory). The
 * document, its selection and the history are unchanged. `adjust`: making the last Delete again
 * with new edge amounts (Phase 3 Step 9). `export`: a PNG export that could not be written; nothing
 * was downloaded.
 */
export interface EditError {
  readonly operation: EditKind | 'undo' | 'redo' | 'adjust' | 'export'
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

/**
 * The Crop tool's state (Phase 4): the rectangle to keep, in image pixels, and the pointer drag
 * changing it. Both null when nothing has been chosen.
 */
export interface CropState {
  /**
   * The rectangle Apply Crop would keep: whole pixels, at least 1 × 1, within the image
   * (image/crop/cropRectangle.ts), or null. While a new rectangle is being dragged out it is null
   * until the drag covers at least one pixel each way.
   */
  readonly rect: Rectangle | null
  readonly drag: CropDrag | null
}

/**
 * A pointer drag on the image with the Crop tool. Positions are image coordinates, so the drag
 * follows the image if the view changes meanwhile (a wheel zoom). Each move is applied to the
 * rectangle as it was when the drag started, never added to the previous move, so nothing
 * accumulates.
 */
export type CropDrag =
  /** Drawing a new rectangle from `anchor`, the pixel corner nearest the press. */
  | { readonly kind: 'new'; readonly anchor: Point }
  /** Moving `start` with the pointer, from the press at `origin`. */
  | { readonly kind: 'move'; readonly origin: Point; readonly start: Rectangle }
  /** Resizing `start` by dragging `handle`, from the press at `origin`. */
  | { readonly kind: 'resize'; readonly handle: CropHandle; readonly origin: Point; readonly start: Rectangle }

export const NO_CROP: CropState = { rect: null, drag: null }

/** A colour chosen with the Eyedropper or the colour picker (Phase 4). */
export interface ChosenColour {
  /** Exact 8-bit straight RGBA. */
  readonly value: Rgba
  /**
   * Where the Eyedropper read it: the pixel and the content state it was read from. Null when the
   * colour picker set it. Read through sampledPixel(), which shows it only while it is still the
   * open image's current content.
   */
  readonly sample: { readonly version: DocumentVersion; readonly pixel: PixelCoordinate } | null
  /**
   * How many Eyedropper readings the session has made, this one included (the colour picker's
   * Apply keeps the count). Each deliberate reading, of the same pixel again included, has its own
   * number, so its announcement is made again, and nothing else changes it (Phase 4 audit, L3).
   */
  readonly readings: number
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
   * Sets Auto Trim's padding, rounded to a whole number and clamped to 0–50; values that are not
   * finite are ignored. Never changes the image.
   */
  | { readonly type: 'auto-trim-padding-changed'; readonly padding: number }
  /**
   * A primary-button press on the image canvas with the Crop tool, at `point` (workspace CSS px).
   * On a handle or edge of the rectangle it starts resizing it, inside it moving it, anywhere else
   * drawing a new one (the previous one is dropped; a press without a drag leaves none). Ignored
   * unless Crop is active and an image is shown.
   */
  | { readonly type: 'crop-drag-started'; readonly point: Point }
  /** The pointer of a crop drag moved to `point` (workspace CSS px). Ignored without a drag. */
  | { readonly type: 'crop-dragged'; readonly point: Point }
  /** The crop drag ended (button released, cancelled, capture lost). */
  | { readonly type: 'crop-drag-ended' }
  /**
   * One field of the crop rectangle typed or stepped in the options row: X and Y move it, Width and
   * Height resize it from its top-left corner, rounded and clamped to the image
   * (setCropField). Without a rectangle, the whole image is the starting point.
   */
  | { readonly type: 'crop-field-changed'; readonly field: CropField; readonly value: number }
  /** Escape or Cancel: the rectangle and any drag are dropped. The image is unchanged. */
  | { readonly type: 'crop-cancelled' }
  /**
   * An Eyedropper click (Phase 4): `colour` read from `pixel` of `version`. Ignored unless the
   * Eyedropper is active, `version` is the open document's current version and the pixel lies in it.
   */
  | { readonly type: 'colour-sampled'; readonly version: DocumentVersion; readonly pixel: PixelCoordinate; readonly colour: Rgba }
  /** The colour picker's Apply (Phase 4): `colour` becomes the chosen colour. Ignored unless it is valid 8-bit RGBA. */
  | { readonly type: 'colour-chosen'; readonly colour: Rgba }
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
   * changes but the announcement. Ignored for any other version. `trim`: why Auto Trim had
   * nothing to do.
   */
  | {
      readonly type: 'edit-unchanged'
      readonly version: DocumentVersion
      readonly operation: EditKind
      readonly trim?: AutoTrimNoChange
    }
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
  /** Hides the latest edit outcome's message (the ones shown in the workspace, editFeedback.ts). */
  | { readonly type: 'edit-notice-dismissed' }
  /**
   * A PNG export of the open image has started (exportStartCommand). Ignored while another export
   * is running or another image is being opened, or unless `job.content` is the open image's
   * current content state.
   */
  | { readonly type: 'export-started'; readonly job: ExportJob }
  /**
   * Export `id` has been written and handed to the browser to download: the image it saved
   * becomes the last export, if it is still the one open. Ignored unless `id` is the running export.
   */
  | { readonly type: 'export-finished'; readonly id: number }
  /** Export `id` could not be written; nothing was downloaded. Ignored unless `id` is the running export. */
  | { readonly type: 'export-failed'; readonly id: number; readonly detail?: string }

export const initialEditorState: EditorState = {
  document: null,
  documentBitmap: null,
  viewport: null,
  workspace: null,
  placeOnNextResize: false,
  pendingImportId: null,
  importError: null,
  pan: null,
  zoomAnchor: null,
  importNotice: null,
  activeTool: null,
  magicWand: DEFAULT_MAGIC_WAND_SETTINGS,
  edgeSettings: NO_EDGE_TREATMENT,
  autoTrimPadding: DEFAULT_AUTO_TRIM_PADDING,
  crop: NO_CROP,
  colour: null,
  selection: null,
  lastMagicWandOperation: null,
  history: createEditHistory(),
  adjustableEdit: null,
  editError: null,
  editDepth: 0,
  editNotice: null,
  editFeedbackId: 0,
  exporting: null,
  lastExport: null,
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
        // The image makes the Magic Wand active: for the first image, or after Auto Trim, its
        // options row is about to take the place of none or another one above the workspace.
        placeOnNextResize: state.activeTool !== 'magic-wand',
        pendingImportId: null,
        importError: null,
        pan: null,
        // The selection and the click that made it belonged to the previous image.
        // Magic Wand options are kept.
        activeTool: 'magic-wand',
        // Auto Trim's padding starts at its default for every image (owner decision, Step 11).
        autoTrimPadding: DEFAULT_AUTO_TRIM_PADDING,
        crop: NO_CROP,
        selection: null,
        lastMagicWandOperation: null,
        // Edits of the previous image cannot apply to this one.
        history: clearEditHistory(state.history),
        adjustableEdit: null,
        editError: null,
        editDepth: 0,
        editNotice: null,
        // A running export continues and saves the previous image; it is not this one's export.
        lastExport: null,
      }
    }

    case 'import-error-dismissed':
      return state.importError === null ? state : { ...state, importError: null }

    case 'import-notice-dismissed':
      return state.importNotice === null ? state : { ...state, importNotice: null }

    case 'workspace-resized':
      return resizeWorkspace(state, action.workspace)

    case 'zoom-scaled':
      if (!Number.isFinite(action.factor) || !(action.factor > 0)) return state
      return zoomAbout(state, action.anchor, (zoom) => zoom * action.factor, false)

    case 'zoom-stepped':
      return state.workspace
        ? zoomAbout(state, centreOf(state.workspace.size), (zoom) => nextZoomStep(zoom, action.direction), true)
        : state

    case 'zoom-fitted':
      return withViewport(state, (_viewport, workspace, document) =>
        settled(fitViewport(document, workspace.size), null, workspace),
      )

    case 'zoom-actual-size':
      return state.workspace ? zoomAbout(state, centreOf(state.workspace.size), () => 1, true) : state

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
      // A crop rectangle belongs to the Crop tool: choosing any tool drops it.
      return isAvailableTool(action.tool) ? { ...state, activeTool: action.tool, crop: NO_CROP } : state

    case 'crop-drag-started':
      return startCropDrag(state, action.point)

    case 'crop-dragged':
      return continueCropDrag(state, action.point)

    case 'crop-drag-ended':
      return state.crop.drag ? { ...state, crop: { rect: state.crop.rect, drag: null } } : state

    case 'crop-field-changed': {
      const { document } = state
      if (state.activeTool !== 'crop' || !document || !Number.isFinite(action.value)) return state
      const rect = setCropField(pendingCrop(state) ?? wholeImageRect(document), action.field, action.value, document)
      return withCropRect(state, rect, null)
    }

    case 'crop-cancelled':
      return state.crop.rect || state.crop.drag ? { ...state, crop: NO_CROP } : state

    case 'colour-sampled': {
      const { version, pixel, colour } = action
      const { document } = state
      if (state.activeTool !== 'eyedropper' || !document || !isVersionOf(version, document) || !isRgba(colour)) return state
      if (!(pixel.x >= 0 && pixel.y >= 0 && pixel.x < document.width && pixel.y < document.height)) return state
      const readings = (state.colour?.readings ?? 0) + 1
      return { ...state, colour: { value: { ...colour }, sample: { version, pixel: { x: pixel.x, y: pixel.y } }, readings } }
    }

    case 'colour-chosen':
      return isRgba(action.colour) ? { ...state, colour: { value: { ...action.colour }, sample: null, readings: state.colour?.readings ?? 0 } } : state

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

    case 'auto-trim-padding-changed': {
      if (!Number.isFinite(action.padding)) return state
      const padding = clampAutoTrimPadding(action.padding)
      return padding === state.autoTrimPadding ? state : { ...state, autoTrimPadding: padding }
    }

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
      return withEditFeedback(state, null, {
        kind: 'unchanged',
        operation: action.operation,
        ...(action.trim ? { trim: action.trim } : {}),
      })
    }

    case 'edit-failed':
      return withEditFeedback(state, action.error, null)

    case 'edit-error-dismissed':
      return state.editError === null ? state : { ...state, editError: null }

    case 'edit-notice-dismissed':
      return state.editNotice === null ? state : { ...state, editNotice: null }

    case 'export-started': {
      const { job } = action
      if (state.exporting !== null || isImporting(state) || !sameContent(job.content, currentContent(state))) {
        return state
      }
      return { ...state, exporting: job }
    }

    case 'export-finished': {
      const job = state.exporting
      if (!job || job.id !== action.id) return state
      // Saved even if the image has been edited since; hasUnexportedEdits then still says so.
      const saved = state.document?.id === job.content.documentId ? rememberedExport(job.content) : state.lastExport
      return {
        ...withEditFeedback(state, null, { kind: 'exported', fileName: job.fileName }),
        exporting: null,
        lastExport: saved,
      }
    }

    case 'export-failed': {
      const job = state.exporting
      if (!job || job.id !== action.id) return state
      const error: EditError = { operation: 'export', ...(action.detail !== undefined ? { detail: action.detail } : {}) }
      return { ...withEditFeedback(state, error, null), exporting: null }
    }
  }
}

/**
 * The open image's current content state (ExportedContent), or null without an image. Constant
 * time.
 */
export function currentContent(state: EditorState): ExportedContent | null {
  const version = documentVersion(state)
  if (!state.document || !version) return null
  return { documentId: state.document.id, editDepth: state.editDepth, entry: nextUndo(state.history, version) }
}

/** Whether `a` and `b` are the same content state of the same image (both null: no image). */
export function sameContent(a: ExportedContent | null, b: ExportedContent | null): boolean {
  if (a === null || b === null) return a === b
  return a.documentId === b.documentId && a.editDepth === b.editDepth && a.entry === b.entry
}

/** Whether `content` is the content state `saved` remembers (an export of it). */
export function isExportedContent(saved: LastExport | null, content: ExportedContent | null): boolean {
  if (saved === null || content === null) return false
  if (saved.documentId !== content.documentId || saved.editDepth !== content.editDepth) return false
  return saved.entry === null ? content.entry === null : saved.entry.deref() === content.entry
}

function rememberedExport(content: ExportedContent): LastExport {
  return {
    documentId: content.documentId,
    editDepth: content.editDepth,
    entry: content.entry ? new WeakRef(content.entry) : null,
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
  const history = recordEdit(state.history, version, entry, versionOf(next))
  const dropped = droppedUndoSteps(state.history, version, history)
  const notice: EditNotice = {
    kind: 'applied',
    operation: entry.kind,
    changedPixels: action.changedPixels ?? null,
    ...(action.edgePixels ? { edgePixels: action.edgePixels } : {}),
    ...(sameSize(current, next) ? {} : { resized: { from: sizeOf(current), to: sizeOf(next) } }),
    ...(dropped > 0 ? { droppedUndoSteps: dropped } : {}),
  }
  return {
    ...withEditFeedback(state, null, notice),
    ...viewAfterEdit(state, next),
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
 * How many Undo steps recording an edit of the document at `from` dropped: the entries `before`
 * offered for Undo there, plus the new one, that `after` no longer holds. The history drops the
 * oldest entries when the new one would exceed its limits (editHistory.ts, recordEdit). Redo
 * entries, which a new edit always discards, are not Undo steps and are not counted.
 */
function droppedUndoSteps(before: EditHistory, from: DocumentVersion, after: EditHistory): number {
  const offered = isBoundTo(before, from) ? before.undo.length : 0
  return offered + 1 - after.undo.length
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
    ...viewAfterEdit(state, next),
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
    ...viewAfterEdit(state, next),
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

function sizeOf(size: Size): Size {
  return { width: size.width, height: size.height }
}

/**
 * The view after the document changes to `next`. Same-size edits (Delete Selection, its Undo,
 * Redo and adjustments) keep it exactly. When the size changes (Auto Trim, its Undo and its Redo,
 * the only size changes so far) the new image is fitted to the workspace exactly as Fit does:
 * larger images fitted, smaller ones at 100%, centred (owner decision for Phase 3 Step 11; it
 * replaces the provisional crop view of Step 5, which kept the zoom and moved the image).
 */
function viewAfterEdit(
  state: EditorState,
  next: ImageDocument,
): Pick<EditorState, 'viewport' | 'pan' | 'placeOnNextResize' | 'crop'> {
  const { viewport, workspace, document: current } = state
  // A crop rectangle is in the image's pixel coordinates: still the same area after an edit that
  // keeps the size, meaningless after one that changes it (Phase 4).
  const crop = current && sameSize(current, next) ? state.crop : NO_CROP
  if (!viewport || !workspace || !current || sameSize(current, next)) {
    return { viewport, pan: state.pan, placeOnNextResize: state.placeOnNextResize, crop }
  }
  const fitted = settled(fitViewport(next, workspace.size), null, workspace)
  return { viewport: fitted, pan: rebasePan(state.pan, fitted), placeOnNextResize: false, crop }
}

/*
 * Manual Crop (Phase 4). The rectangle and its drag are view state: constant-time geometry here
 * (image/crop/cropRectangle.ts, canvas/cropOverlay.ts), no pixels. Applying the crop is an edit
 * like Auto Trim (editCommands.ts, cropCommand).
 */

/**
 * The crop rectangle the Crop tool shows and Apply Crop would keep, or null: none chosen, Crop is
 * not the active tool, or no image. Always a valid crop rectangle for the open image.
 */
export function pendingCrop(state: EditorState): Rectangle | null {
  const { rect } = state.crop
  const { document } = state
  if (!rect || !document || state.activeTool !== 'crop') return null
  return isValidCropRect(rect, document) ? rect : null
}

/**
 * The pixel the chosen colour was read from by the Eyedropper, while the open image is still the
 * content state it was read from; otherwise null (picked with the colour picker, or the image has
 * changed or been replaced since).
 */
export function sampledPixel(state: EditorState): PixelCoordinate | null {
  const sample = state.colour?.sample
  return sample && state.document && isVersionOf(sample.version, state.document) ? sample.pixel : null
}

/** The workspace point (CSS px) as fractional image coordinates in the display viewport, or null. */
function imagePointAt(state: EditorState, point: Point): Point | null {
  const viewport = displayViewport(state)
  if (!viewport || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return viewportToImage(viewport, point)
}

function startCropDrag(state: EditorState, point: Point): EditorState {
  const { document, workspace } = state
  const viewport = displayViewport(state)
  const image = imagePointAt(state, point)
  if (state.activeTool !== 'crop' || !document || !viewport || !workspace || !image) return state
  const rect = pendingCrop(state)
  if (rect) {
    const hit = hitTestCrop(cropRectOnScreen(rect, viewport, workspace.devicePixelRatio), point)
    if (hit.kind === 'handle') {
      return { ...state, crop: { rect, drag: { kind: 'resize', handle: hit.handle, origin: image, start: rect } } }
    }
    if (hit.kind === 'inside') return { ...state, crop: { rect, drag: { kind: 'move', origin: image, start: rect } } }
  }
  // Outside the rectangle (or without one): a new rectangle from the nearest pixel corner. The
  // previous one is dropped, so a press without a drag leaves none.
  const anchor = nearestCorner(image, document)
  return anchor ? { ...state, crop: { rect: null, drag: { kind: 'new', anchor } } } : state
}

function continueCropDrag(state: EditorState, point: Point): EditorState {
  const { drag } = state.crop
  const { document } = state
  const image = imagePointAt(state, point)
  if (!drag || !document || state.activeTool !== 'crop' || !image) return state
  let rect: Rectangle | null
  switch (drag.kind) {
    case 'new': {
      const corner = nearestCorner(image, document)
      if (!corner) return state
      rect = rectBetween(drag.anchor, corner)
      break
    }
    case 'move':
    case 'resize': {
      // The image cannot have changed size during the drag: that clears the crop and its drag.
      if (!isValidCropRect(drag.start, document)) return state
      const delta = { x: image.x - drag.origin.x, y: image.y - drag.origin.y }
      rect = drag.kind === 'move' ? moveCropRect(drag.start, delta, document) : resizeCropRect(drag.start, drag.handle, delta, document)
      break
    }
  }
  return withCropRect(state, rect, drag)
}

/** `state` with the crop rectangle `rect` and `drag`; the state itself when nothing changes. */
function withCropRect(state: EditorState, rect: Rectangle | null, drag: CropDrag | null): EditorState {
  if (sameRect(rect, state.crop.rect) && drag === state.crop.drag) return state
  return { ...state, crop: { rect, drag } }
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
 * Zooms about `anchor` (a viewport point) to `zoomFor(current zoom)`, clamped to the supported
 * range. At a limit the state is returned as it is, so pressing against a limit cannot nudge the
 * image.
 *
 * The image point the user sees under the anchor stays under it as drawn (canvas/zoomAnchor.ts):
 * it is measured through the transform the image is actually drawn with (imagePointAtPointer:
 * display zoom, snapped offset and drawing bias), and the new viewport draws it at the anchor again
 * (viewportDrawingAt), on whole device pixels, preferring the offset that keeps its image pixel in
 * the anchor's device pixel. The point moves by at most a device pixel, and later zooming never
 * magnifies that.
 *
 * Re-measuring at every step would add up each step's snapping instead (a trackpad pinch sends
 * hundreds of steps), so a zoom about the same anchor continuing from the viewport the previous
 * zoom produced keeps that zoom's image point (state.zoomAnchor) exactly. The stored zoom stays as
 * requested, so small pinch movements add up, and zooming in and back out about one anchor returns
 * exactly to the start as displayed. `settle` is for discrete commands: a zoom that had to move the
 * image to keep it reachable is snapped to whole device pixels again (settled).
 */
function zoomAbout(
  state: EditorState,
  anchor: Point,
  zoomFor: (zoom: number) => number,
  settle: boolean,
): EditorState {
  const { viewport, workspace, document } = state
  if (!viewport || !workspace || !document) return state
  const zoom = exactActualSize(clampZoom(zoomFor(viewport.zoom)))
  if (zoom === viewport.zoom) return state
  const ratio = workspace.devicePixelRatio
  const image =
    continuedZoomPoint(state.zoomAnchor, viewport, anchor, ratio) ??
    imagePointAtPointer(toDisplayViewport(viewport, ratio), anchor, ratio)
  const anchored = viewportDrawingAt(image, anchor, zoom, ratio)
  const reachable = keepImageReachable(anchored, document, workspace.size)
  const next = settle && reachable !== anchored ? settled(reachable, viewport, workspace) : reachable
  const zoomed = withViewport(state, () => next)
  if (zoomed === state) return state
  // A zoom that had to move the image to keep it reachable no longer has the point at the anchor.
  const zoomAnchor = reachable === anchored ? { viewport: next, devicePixelRatio: ratio, anchor, image } : null
  return { ...zoomed, zoomAnchor }
}

/**
 * Relative distance from 100% within which a requested zoom is 100%: floating-point error only, as
 * left by wheel notches up and back down (1.25^15 × 0.8^15 is not exactly 1).
 */
const ACTUAL_SIZE_TOLERANCE = 1e-9

/**
 * 100% for a zoom within floating-point error of it. Without this, wheel zooming back to 100% could
 * store 99.99999999999992%: smoothed (blurred) and off the display scale grid, while the readout
 * says 100%.
 */
function exactActualSize(zoom: number): number {
  return Math.abs(zoom - 1) <= ACTUAL_SIZE_TOLERANCE ? 1 : zoom
}

/** The image point the previous zoom kept at `anchor`, when this zoom continues from its result. */
function continuedZoomPoint(
  remembered: ZoomAnchor | null,
  viewport: ViewportState,
  anchor: Point,
  devicePixelRatio: number,
): Point | null {
  if (
    !remembered ||
    remembered.viewport !== viewport ||
    remembered.devicePixelRatio !== devicePixelRatio ||
    remembered.anchor.x !== anchor.x ||
    remembered.anchor.y !== anchor.y
  ) {
    return null
  }
  return remembered.image
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
    previous.devicePixelRatio === workspace.devicePixelRatio &&
    (previous.deviceSize?.width ?? null) === (workspace.deviceSize?.width ?? null) &&
    (previous.deviceSize?.height ?? null) === (workspace.deviceSize?.height ?? null)
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
 * The viewport to draw and hit-test with: the stored viewport with its offset snapped to
 * whole device pixels and, at 100% and above, its zoom moved to the display scale grid
 * (toDisplayViewport, canvas/devicePixels.ts), so every browser draws exactly the image
 * pixel the tools expect at every device pixel. Rendering, overlays, pointer-to-pixel
 * conversion and the zoom readout must all use this value so they always agree. Wheel
 * zoom and resizes store unsnapped values (see settled) so they never accumulate rounding.
 */
export function displayViewport(state: EditorState): ViewportState | null {
  if (!state.viewport || !state.workspace) return null
  return toDisplayViewport(state.viewport, state.workspace.devicePixelRatio)
}

/**
 * Whether Zoom In and Zoom Out can change the zoom: decided by the stored (requested) zoom, which
 * the reducer clamps, not by the displayed zoom, which the display scale grid can put just below
 * 3200% (at 101% scaling, 3200% is displayed as 3168%) while the requested zoom is at the limit.
 */
export function zoomAvailability(state: EditorState): { readonly zoomIn: boolean; readonly zoomOut: boolean } {
  const zoom = state.viewport && state.workspace && state.document ? state.viewport.zoom : null
  return { zoomIn: zoom !== null && zoom < MAX_ZOOM, zoomOut: zoom !== null && zoom > MIN_ZOOM }
}

export function isImporting(state: EditorState): boolean {
  return state.pendingImportId !== null
}
