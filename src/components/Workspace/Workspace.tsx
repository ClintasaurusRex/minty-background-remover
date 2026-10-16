import { type RefObject, useEffect, useRef } from 'react'
import { clientToViewport } from '../../canvas/coordinates'
import { wheelDeltaPixels, wheelZoomFactor } from '../../canvas/wheelZoom'
import type { WorkspaceMetrics } from '../../editor/editorState'
import type { ImageDocument, Point, ViewportState } from '../../editor/types'
import type { ImportError } from '../../image/import/errors'
import { EmptyState } from './EmptyState'
import { ImageCanvas } from './ImageCanvas'
import { ImportErrorMessage } from './ImportErrorMessage'
import './Workspace.css'

interface WorkspaceProps {
  document: ImageDocument | null
  documentBitmap: ImageBitmap | null
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
  importing: boolean
  importError: ImportError | null
  onResize: (workspace: WorkspaceMetrics) => void
  onDismissError: () => void
  onOpenImage: () => void
  /** Ctrl + wheel zoom: multiply the zoom by `factor` about `anchor` (canvas CSS px). */
  onWheelZoom: (anchor: Point, factor: number) => void
}

export function Workspace({
  document,
  documentBitmap,
  viewport,
  workspace,
  importing,
  importError,
  onResize,
  onDismissError,
  onOpenImage,
  onWheelZoom,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useWheelZoom(workspaceRef, canvasRef, viewport !== null, onWheelZoom)

  return (
    <main ref={workspaceRef} className="workspace" aria-label="Image workspace" aria-busy={importing}>
      <ImageCanvas
        canvasRef={canvasRef}
        document={document}
        bitmap={documentBitmap}
        viewport={viewport}
        workspace={workspace}
        onResize={onResize}
      />

      {!document && <EmptyState onOpenImage={onOpenImage} />}

      <div className="workspace__messages">
        <div role="status">
          {importing && <p className="workspace-message workspace-message--progress">Opening image…</p>}
        </div>
        {importError && <ImportErrorMessage error={importError} onDismiss={onDismissError} />}
      </div>
    </main>
  )
}

/**
 * Ctrl + wheel (and trackpad pinch, which browsers report the same way) zooms about
 * the pointer while an image is shown. The listener is non-passive so it can stop
 * the browser zooming the page; it only does so over the workspace, and plain wheel
 * events are left alone. Events are combined into one zoom change per frame.
 */
function useWheelZoom(
  workspaceRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  onWheelZoom: (anchor: Point, factor: number) => void,
) {
  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !enabled) return

    let factor = 1
    let anchor: Point | null = null
    let frame = 0

    const onWheel = (event: WheelEvent) => {
      const canvas = canvasRef.current
      if (!event.ctrlKey || !canvas) return
      event.preventDefault()
      const pixels = wheelDeltaPixels(event.deltaY, event.deltaMode, workspace.clientHeight)
      if (pixels === 0) return
      factor *= wheelZoomFactor(pixels)
      anchor = clientToViewport({ x: event.clientX, y: event.clientY }, canvas.getBoundingClientRect())
      if (frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (anchor) onWheelZoom(anchor, factor)
          factor = 1
        })
      }
    }

    workspace.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      workspace.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(frame)
    }
  }, [workspaceRef, canvasRef, enabled, onWheelZoom])
}
