import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { planFrame } from '../../canvas/rendering'
import { type WorkspaceRenderer, createWorkspaceRenderer } from '../../canvas/workspaceRenderer'
import type { WorkspaceMetrics } from '../../editor/editorState'
import type { ImageDocument, Size, ViewportState } from '../../editor/types'

interface ImageCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  document: ImageDocument | null
  /** The document's drawable bitmap, replaced together with the document. */
  bitmap: ImageBitmap | null
  /** The display (snapped) viewport. */
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
  onResize: (workspace: WorkspaceMetrics) => void
}

/**
 * The canvas covering the workspace. It reports its size and device pixel ratio,
 * and draws the document's bitmap at the given viewport.
 */
export function ImageCanvas({ canvasRef, document, bitmap, viewport, workspace, onResize }: ImageCanvasProps) {
  const rendererRef = useRef<WorkspaceRenderer | null>(null)
  const drawnBitmapRef = useRef<ImageBitmap | null>(null)

  useLayoutEffect(() => {
    const renderer = canvasRef.current && createWorkspaceRenderer(canvasRef.current)
    rendererRef.current = renderer
    return () => {
      renderer?.dispose()
      rendererRef.current = null
    }
  }, [canvasRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    return observeWorkspace(canvas, onResize)
  }, [canvasRef, onResize])

  useLayoutEffect(() => {
    // The previous image's bitmap is no longer in the editor state once it has been
    // replaced, so release its memory now rather than waiting for garbage collection.
    if (drawnBitmapRef.current && drawnBitmapRef.current !== bitmap) drawnBitmapRef.current.close()
    drawnBitmapRef.current = bitmap

    const renderer = rendererRef.current
    if (!renderer || !workspace) return
    const plan = planFrame({
      imageSize: document ?? { width: 0, height: 0 },
      viewport: viewport ?? { zoom: 1, offset: { x: 0, y: 0 } },
      viewportSize: workspace.size,
      devicePixelRatio: workspace.devicePixelRatio,
    })
    renderer.render(plan, document && viewport ? bitmap : null)
  }, [document, bitmap, viewport, workspace])

  const label = document
    ? `${document.name}, ${document.width} by ${document.height} pixels`
    : undefined

  return (
    <canvas
      ref={canvasRef}
      className="workspace__canvas"
      role={document ? 'img' : undefined}
      aria-label={label}
      aria-hidden={document ? undefined : true}
    />
  )
}

/**
 * Reports the element's CSS size and the device pixel ratio whenever either changes
 * (window resizes, browser zoom, moving to another display). Returns a cleanup function.
 */
function observeWorkspace(element: Element, onResize: (workspace: WorkspaceMetrics) => void): () => void {
  let size: Size | null = null
  const report = () => {
    if (size) onResize({ size, devicePixelRatio: window.devicePixelRatio })
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entries[entries.length - 1].contentRect
    size = { width, height }
    report()
  })
  resizeObserver.observe(element)

  // A resolution media query matching the current ratio stops matching when it changes.
  let ratioQuery: MediaQueryList | null = null
  const onRatioChange = () => {
    watchRatio()
    report()
  }
  const watchRatio = () => {
    ratioQuery?.removeEventListener('change', onRatioChange)
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    ratioQuery.addEventListener('change', onRatioChange)
  }
  watchRatio()

  return () => {
    resizeObserver.disconnect()
    ratioQuery?.removeEventListener('change', onRatioChange)
  }
}
