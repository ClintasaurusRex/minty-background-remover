import { useLayoutEffect, useRef } from 'react'
import { type AnimationClock, type MarchingAnts, createMarchingAnts } from '../../canvas/marchingAnts'
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

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const browserClock: AnimationClock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(() => callback()),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
}

/**
 * The selection overlay, on its own canvas laid exactly over the image canvas and drawn with the
 * same display viewport. It is drawn after the image in the same commit, so both change in the
 * same frame. Pointer events pass through it to the image canvas, and it is hidden from
 * assistive technology: the status bar describes the selection in words.
 *
 * The boundary's marching ants are moved outside React (canvas/marchingAnts.ts): they stop while
 * the page is hidden and stay static when the system asks for reduced motion.
 */
export function SelectionOverlayCanvas({ selection, viewport, workspace }: SelectionOverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<{ renderer: SelectionOverlayRenderer; ants: MarchingAnts } | null>(null)

  useLayoutEffect(() => {
    const renderer = canvasRef.current && createSelectionOverlayRenderer(canvasRef.current)
    if (!renderer) return
    const motion = window.matchMedia(REDUCED_MOTION_QUERY)
    const ants = createMarchingAnts(renderer, browserClock, { reducedMotion: motion.matches, hidden: document.hidden })
    const onMotionChange = () => ants.setReducedMotion(motion.matches)
    const onVisibilityChange = () => ants.setHidden(document.hidden)
    motion.addEventListener('change', onMotionChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    overlayRef.current = { renderer, ants }
    return () => {
      motion.removeEventListener('change', onMotionChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      ants.dispose()
      renderer.dispose()
      overlayRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    // Planning is cheap (a handful of tiles); the renderer skips frames identical to the last.
    const plan =
      selection && viewport && workspace
        ? planSelectionOverlay({
            selection,
            viewport,
            viewportSize: workspace.size,
            devicePixelRatio: workspace.devicePixelRatio,
            deviceSize: workspace.deviceSize,
          })
        : null
    overlay.renderer.render(plan, selection, overlay.ants.pattern())
    // Starts the ants when a boundary is in view, stops them when none is.
    overlay.ants.update()
  }, [selection, viewport, workspace])

  return <canvas ref={canvasRef} className="workspace__overlay" aria-hidden="true" />
}
