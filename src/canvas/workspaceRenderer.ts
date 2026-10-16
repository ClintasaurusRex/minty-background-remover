import { CHECKER_COLOURS, type FramePlan } from './rendering'

/*
 * Draws frame plans onto the workspace canvas. The only module that touches the
 * canvas context; all geometry comes from planFrame().
 *
 * The image is drawn from an ImageBitmap copy of the document's pixels, so rendering
 * never reads from or writes to the document's ImageData after the copy is made.
 */

export interface WorkspaceRenderer {
  /** Draws a frame. With no image, the canvas is cleared. */
  render(plan: FramePlan, image: ImageBitmap | null): void
  /** Releases the canvas backing store. */
  dispose(): void
}

export function createWorkspaceRenderer(canvas: HTMLCanvasElement): WorkspaceRenderer | null {
  const context = canvas.getContext('2d')
  if (!context) return null

  let checker: { squareSize: number; pattern: CanvasPattern } | null = null

  const checkerPattern = (squareSize: number): CanvasPattern | null => {
    if (checker?.squareSize === squareSize) return checker.pattern
    const tile = document.createElement('canvas')
    tile.width = tile.height = squareSize * 2
    const tileContext = tile.getContext('2d')
    if (!tileContext) return null
    tileContext.fillStyle = CHECKER_COLOURS.light
    tileContext.fillRect(0, 0, squareSize * 2, squareSize * 2)
    tileContext.fillStyle = CHECKER_COLOURS.dark
    tileContext.fillRect(0, 0, squareSize, squareSize)
    tileContext.fillRect(squareSize, squareSize, squareSize, squareSize)
    // createPattern copies the tile, so the tile canvas can be discarded.
    const pattern = context.createPattern(tile, 'repeat')
    tile.width = tile.height = 0
    if (!pattern) return null
    checker = { squareSize, pattern }
    return pattern
  }

  return {
    render(plan, image) {
      const { backingStore } = plan
      // Resizing the backing store clears it, so only do it when the size changes.
      if (canvas.width !== backingStore.width) canvas.width = backingStore.width
      if (canvas.height !== backingStore.height) canvas.height = backingStore.height

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (!image || !plan.checker || !plan.image) return

      const { rect, origin, squareSize } = plan.checker
      const pattern = checkerPattern(squareSize)
      if (pattern) {
        pattern.setTransform(new DOMMatrix([1, 0, 0, 1, origin.x, origin.y]))
        context.fillStyle = pattern
        context.fillRect(rect.x, rect.y, rect.width, rect.height)
      }

      const { transform: t, source: s, smoothing } = plan.image
      context.imageSmoothingEnabled = smoothing
      context.imageSmoothingQuality = 'high'
      context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
      context.drawImage(image, s.x, s.y, s.width, s.height, s.x, s.y, s.width, s.height)
    },

    dispose() {
      checker = null
      canvas.width = canvas.height = 0
    },
  }
}
