import { useRef } from 'react'
import type { ImportNotice, WorkspaceMetrics } from '../../editor/editorState'
import type { PanGestureEffect } from '../../editor/panGesture'
import type { ImageDocument, Point, ViewportState } from '../../editor/types'
import type { ImportError } from '../../image/import/errors'
import { OpenIcon } from '../icons/icons'
import { EmptyState } from './EmptyState'
import { ImageCanvas } from './ImageCanvas'
import { ImportErrorMessage } from './ImportErrorMessage'
import { ImportNoticeMessage } from './ImportNoticeMessage'
import { useFileDrop, useSpacePan, useWheelInput } from './workspaceInput'
import './Workspace.css'

interface WorkspaceProps {
  document: ImageDocument | null
  documentBitmap: ImageBitmap | null
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
  importing: boolean
  importError: ImportError | null
  importNotice: ImportNotice | null
  onResize: (workspace: WorkspaceMetrics) => void
  onDismissError: () => void
  onDismissNotice: () => void
  onDropFiles: (files: readonly File[], skippedCount: number) => void
  onOpenImage: () => void
  /** Ctrl + wheel zoom: multiply the zoom by `factor` about `anchor` (canvas CSS px). */
  onWheelZoom: (anchor: Point, factor: number) => void
  /** Wheel and trackpad panning: move the image by `delta` CSS px. */
  onWheelPan: (delta: Point) => void
  /** Space + drag panning. */
  onPanGesture: (effect: PanGestureEffect) => void
}

export function Workspace({
  document,
  documentBitmap,
  viewport,
  workspace,
  importing,
  importError,
  importNotice,
  onResize,
  onDismissError,
  onDismissNotice,
  onDropFiles,
  onOpenImage,
  onWheelZoom,
  onWheelPan,
  onPanGesture,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageShown = viewport !== null
  useWheelInput(workspaceRef, canvasRef, imageShown, { onWheelZoom, onWheelPan })
  const pan = useSpacePan(workspaceRef, imageShown, onPanGesture)
  const dropActive = useFileDrop(workspaceRef, onDropFiles)

  const className = [
    'workspace',
    pan.ready && !pan.dragging && 'workspace--pan-ready',
    pan.dragging && 'workspace--panning',
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
        bitmap={documentBitmap}
        viewport={viewport}
        workspace={workspace}
        onResize={onResize}
      />

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
        <div role="status">
          {dropActive && <span className="visually-hidden">Drop to open the image.</span>}
          {importing && <p className="workspace-message workspace-message--progress">Opening image…</p>}
          {importNotice && !(importing && importNotice.kind === 'ignored-files') && (
            // The ignored-files notice waits until the import it belongs to has finished.
            <ImportNoticeMessage notice={importNotice} onDismiss={onDismissNotice} />
          )}
        </div>
        {importError && <ImportErrorMessage error={importError} onDismiss={onDismissError} />}
      </div>
    </main>
  )
}
