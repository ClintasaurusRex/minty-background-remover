import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type DisplayImage, createDisplayImageOwner, displayContentKey } from '../../canvas/displayImage'
import { planFrame } from '../../canvas/rendering'
import { type WorkspaceRenderer, createWorkspaceRenderer } from '../../canvas/workspaceRenderer'
import type { WorkspaceMetrics } from '../../editor/editorState'
import type { ImageDocument, Size, ViewportState } from '../../editor/types'

interface ImageCanvasProps {
  canvasRef: RefObject<HTMLCanvasElement | null>
  document: ImageDocument | null
  /** The document's display image, replaced together with the document. */
  image: DisplayImage | null
  /** The display (snapped) viewport. */
  viewport: ViewportState | null
  workspace: WorkspaceMetrics | null
  onResize: (workspace: WorkspaceMetrics) => void
}

/**
 * The canvas covering the workspace. It reports its size and device pixel ratio,
 * and draws the document's display image at the given viewport.
 */
export function ImageCanvas({ canvasRef, document, image, viewport, workspace, onResize }: ImageCanvasProps) {
  const rendererRef = useRef<WorkspaceRenderer | null>(null)
  // Releases each display image once the canvas has moved on from it (see displayImage.ts).
  const [owner] = useState(createDisplayImageOwner)

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
    const renderer = rendererRef.current
    if (renderer && workspace) {
      const plan = planFrame({
        imageSize: document ?? { width: 0, height: 0 },
        viewport: viewport ?? { zoom: 1, offset: { x: 0, y: 0 } },
        viewportSize: workspace.size,
        devicePixelRatio: workspace.devicePixelRatio,
        deviceSize: workspace.deviceSize,
      })
      // The content key says which document revision the image shows, so a new revision is
      // always drawn, whatever image object it comes with.
      renderer.render(plan, document && viewport && image ? { image, key: displayContentKey(document) } : null)
    }
    // The previous image is no longer in the editor state once it has been replaced: release
    // its memory now, after the renderer has moved on to the new one, rather than waiting for
    // garbage collection.
    owner.show(image)
  }, [document, image, viewport, workspace, owner])

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
 * Reports the element's CSS size, its size in device pixels as the browser lays it out (its
 * device-pixel-content-box, where the browser reports it) and the device pixel ratio whenever
 * any changes (window resizes, browser zoom, moving to another display, and layout above the
 * canvas moving it to another fractional device pixel position). Returns a cleanup function.
 */
function observeWorkspace(element: Element, onResize: (workspace: WorkspaceMetrics) => void): () => void {
  let size: Size | null = null
  let deviceSize: Size | null = null
  const report = () => {
    if (size) onResize({ size, devicePixelRatio: window.devicePixelRatio, deviceSize })
  }

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1]
    const { width, height } = entry.contentRect
    size = { width, height }
    const device = entry.devicePixelContentBoxSize?.[0]
    deviceSize = device ? { width: device.inlineSize, height: device.blockSize } : null
    report()
  })
  try {
    // Fires when the device pixel size changes even where the CSS size does not.
    resizeObserver.observe(element, { box: 'device-pixel-content-box' })
  } catch {
    // Browsers without device-pixel-content-box: the CSS size, rounded (backingStoreSize).
    resizeObserver.observe(element)
  }

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
