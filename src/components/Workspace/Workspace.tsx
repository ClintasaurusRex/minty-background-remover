import { useCallback, useRef } from 'react'
import { clientToViewport } from '../../canvas/coordinates'
import { cropRectOnScreen } from '../../canvas/cropOverlay'
import type { DisplayImage } from '../../canvas/displayImage'
import type { EditError, EditNotice, ImportNotice, WorkspaceMetrics } from '../../editor/editorState'
import { editNoticeText, isShownEditNotice } from '../../editor/editFeedback'
import type { PanGestureEffect } from '../../editor/panGesture'
import type { PointerPress } from '../../editor/selectionCommands'
import type { ImageDocument, Point, Rectangle, SelectionMask, ViewportState } from '../../editor/types'
import type { ImportError } from '../../image/import/errors'
import { OpenIcon } from '../icons/icons'
import { CropOverlay } from './CropOverlay'
import { EditErrorMessage } from './EditErrorMessage'
import { EditNoticeMessage } from './EditNoticeMessage'
import { EmptyState } from './EmptyState'
import { ImageCanvas } from './ImageCanvas'
import { ImportErrorMessage } from './ImportErrorMessage'
import { ImportNoticeMessage } from './ImportNoticeMessage'
import { SelectionOverlayCanvas } from './SelectionOverlayCanvas'
import {
  type CropPointerEvent,
  useCropPointer,
  useFileDrop,
  usePointerPosition,
  useSpacePan,
  useWheelInput,
} from './workspaceInput'
import './Workspace.css'

interface WorkspaceProps {
  document: ImageDocument | null
  /** The document's display image (an import's bitmap, or an edit's display image). */
  documentBitmap: DisplayImage | null
  /** The open document's selection, shown over the image. */
  selection: SelectionMask | null
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
  importing: boolean
  importError: ImportError | null
  importNotice: ImportNotice | null
  /** The last failed edit, Undo or Redo, shown until dismissed or replaced. */
  editError: EditError | null
  /**
   * The last successful edit outcome, announced to assistive technology (the image itself shows
   * it). Some are also shown as a message (isShownEditNotice: Auto Trim with nothing to trim, or
   * dropping older Undo steps).
   */
  editNotice: EditNotice | null
  /** Changes with every new edit outcome, so a repeated message is announced again. */
  editFeedbackId: number
  onResize: (workspace: WorkspaceMetrics) => void
  onDismissError: () => void
  onDismissEditError: () => void
  /** Hides the edit outcome's message. */
  onDismissEditNotice: () => void
  onDismissNotice: () => void
  onDropFiles: (files: readonly File[], skippedCount: number) => void
  onOpenImage: () => void
  /** Ctrl + wheel zoom: multiply the zoom by `factor` about `anchor` (canvas CSS px). */
  onWheelZoom: (anchor: Point, factor: number) => void
  /** Wheel and trackpad panning: move the image by `delta` CSS px. */
  onWheelPan: (delta: Point) => void
  /** Space + drag panning. */
  onPanGesture: (effect: PanGestureEffect) => void
  /** Show the precise (crosshair) pointer over the image: the Magic Wand and the Eyedropper. */
  crosshairPointer: boolean
  /**
   * The Crop tool is active (Phase 4): primary-button presses on the image drag the crop rectangle
   * (onCropPointer) instead of reaching onImagePress.
   */
  cropActive: boolean
  /** The crop rectangle in image pixels (pendingCrop), drawn over the image, or null. */
  cropRect: Rectangle | null
  /** A crop drag's press, moves and end (canvas CSS px). */
  onCropPointer: (event: CropPointerEvent) => void
  /**
   * A pointer press on the image canvas (any button) that panning did not take.
   * `point` is in canvas CSS px.
   */
  onImagePress: (point: Point, press: PointerPress) => void
  /** The pointer's position over the canvas (canvas CSS px), or null when it is not over it. */
  onPointerPosition: (point: Point | null) => void
}

export function Workspace({
  document,
  documentBitmap,
  selection,
  viewport,
  workspace,
  importing,
  importError,
  importNotice,
  editError,
  editNotice,
  editFeedbackId,
  onResize,
  onDismissError,
  onDismissEditError,
  onDismissEditNotice,
  onDismissNotice,
  onDropFiles,
  onOpenImage,
  onWheelZoom,
  onWheelPan,
  onPanGesture,
  crosshairPointer,
  cropActive,
  cropRect,
  onCropPointer,
  onImagePress,
  onPointerPosition,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageShown = viewport !== null
  useWheelInput(workspaceRef, canvasRef, imageShown, { onWheelZoom, onWheelPan })
  const cropShown = imageShown && cropActive && document !== null && workspace !== null
  const cropScreen = cropShown && cropRect && viewport ? cropRectOnScreen(cropRect, viewport, workspace.devicePixelRatio) : null
  const startCropPress = useCropPointer(canvasRef, cropShown, cropScreen, onCropPointer)
  // Only presses on the canvas itself count: not on messages or other content above it.
  const handleToolPress = useCallback(
    (event: PointerEvent) => {
      const canvas = canvasRef.current
      if (!canvas || event.target !== canvas) return
      if (cropShown) return startCropPress(event)
      onImagePress(clientToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect(), window.devicePixelRatio), event)
    },
    [onImagePress, cropShown, startCropPress],
  )
  const pan = useSpacePan(workspaceRef, imageShown, onPanGesture, handleToolPress)
  usePointerPosition(workspaceRef, canvasRef, imageShown, onPointerPosition)
  const dropActive = useFileDrop(workspaceRef, onDropFiles)
  // An outcome shown as a message is announced by its own status region, not again by the hidden one.
  const shownNotice = editNotice !== null && isShownEditNotice(editNotice)

  const className = [
    'workspace',
    pan.ready && !pan.dragging && 'workspace--pan-ready',
    pan.dragging && 'workspace--panning',
    imageShown && crosshairPointer && !pan.ready && !pan.dragging && 'workspace--crosshair',
    cropShown && !pan.ready && !pan.dragging && 'workspace--crop',
    dropActive && 'workspace--drop-target',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    // tabIndex -1: clicking the workspace takes focus away from a toolbar button, so
    // Space pans instead of pressing that button. It is not in the Tab order.
    <main
      ref={workspaceRef}
      className={className}
      aria-label="Image workspace"
      aria-busy={importing}
      tabIndex={-1}
    >
      <ImageCanvas
        canvasRef={canvasRef}
        document={document}
        image={documentBitmap}
        viewport={viewport}
        workspace={workspace}
        onResize={onResize}
      />
      <SelectionOverlayCanvas selection={selection} viewport={viewport} workspace={workspace} />
      {cropShown && viewport && (
        <CropOverlay rect={cropRect} imageSize={document} viewport={viewport} workspace={workspace} />
      )}

      {!document && <EmptyState onOpenImage={onOpenImage} />}

      {dropActive && (
        <div className="workspace__drop-target" aria-hidden="true">
          <p className="workspace-message">
            <OpenIcon className="workspace-message__icon workspace-message__icon--accent" />
            Drop to open the image
          </p>
        </div>
      )}

      <div className="workspace__messages">
        <div className="workspace__status" role="status">
          {dropActive && <span className="visually-hidden">Drop to open the image.</span>}
          {importing && <p className="workspace-message workspace-message--progress">Opening image…</p>}
          {importNotice && !(importing && importNotice.kind === 'ignored-files') && (
            // The ignored-files notice waits until the import it belongs to has finished.
            <ImportNoticeMessage notice={importNotice} onDismiss={onDismissNotice} />
          )}
          {/* A new key per outcome, so the same message is announced again. */}
          {editNotice && shownNotice && (
            <EditNoticeMessage key={editFeedbackId} notice={editNotice} onDismiss={onDismissEditNotice} />
          )}
        </div>
        {importError && <ImportErrorMessage error={importError} onDismiss={onDismissError} />}
        {/* A new key per failure, so the same message is announced again. */}
        {editError && <EditErrorMessage key={editFeedbackId} error={editError} onDismiss={onDismissEditError} />}
      </div>
      {/* Announced once per outcome: a new element for each, never on re-renders. */}
      <div className="visually-hidden" role="status">
        {editNotice && !shownNotice && <span key={editFeedbackId}>{editNoticeText(editNotice)}</span>}
      </div>
    </main>
  )
}
