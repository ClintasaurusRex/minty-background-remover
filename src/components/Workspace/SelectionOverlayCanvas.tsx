import { useLayoutEffect, useRef } from 'react'
import { planSelectionOverlay } from '../../canvas/selectionOverlay'
import { type SelectionOverlayRenderer, createSelectionOverlayRenderer } from '../../canvas/selectionOverlayRenderer'
import type { WorkspaceMetrics } from '../../editor/editorState'
import type { SelectionMask, ViewportState } from '../../editor/types'

interface SelectionOverlayCanvasProps {
  selection: SelectionMask | null
  /** The display (snapped) viewport: the one the image is drawn and hit-tested with. */
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
}

/**
 * The selection overlay, on its own canvas laid exactly over the image canvas and drawn with the
 * same display viewport. It is drawn after the image in the same commit, so both change in the
 * same frame. Pointer events pass through it to the image canvas, and it is hidden from
 * assistive technology: the status bar describes the selection in words.
 */
export function SelectionOverlayCanvas({ selection, viewport, workspace }: SelectionOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SelectionOverlayRenderer | null>(null)

  useLayoutEffect(() => {
    const renderer = canvasRef.current && createSelectionOverlayRenderer(canvasRef.current)
    rendererRef.current = renderer
    return () => {
      renderer?.dispose()
      rendererRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    // Planning is cheap (a handful of tiles); the renderer skips frames identical to the last.
    const plan =
      selection && viewport && workspace
        ? planSelectionOverlay({
            selection,
            viewport,
            viewportSize: workspace.size,
            devicePixelRatio: workspace.devicePixelRatio,
          })
        : null
    rendererRef.current?.render(plan, selection)
  }, [selection, viewport, workspace])

  return <canvas ref={canvasRef} className="workspace__overlay" aria-hidden="true" />
}
