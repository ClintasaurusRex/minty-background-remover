import { type DisplayImage, isReleasedDisplayImage } from './displayImage'
import { CHECKER_COLOURS, type FramePlan, sameFramePlan } from './rendering'

/*
 * Draws frame plans onto the workspace canvas. The only module that touches the
 * canvas context; all geometry comes from planFrame().
 *
 * The image is drawn from a display image (canvas/displayImage.ts): a copy of the document's
 * pixels, so rendering never reads from or writes to the document's pixels.
 *
 * A frame identical to the last one drawn (same display image, same content key, same plan) is
 * skipped: the canvas already shows it. Renders that do not move the view, such as selection
 * changes and tolerance adjustments, therefore cost nothing here. A new display image, a new
 * content key (a new document or revision) or any change of view draws the frame, and so does
 * the next render after invalidate().
 *
 * When the browser restores a lost 2D context (after a GPU process restart, for example), the
 * canvas is blank: the last frame is drawn again straight away. The renderer never releases
 * display images; their owner does (see displayImage.ts).
 */

/** What the workspace shows: a display image and the content it shows. */
export interface DisplayContent {
  readonly image: DisplayImage
  /** The document id and revision the image shows (displayContentKey). */
  readonly key: string
}

export interface WorkspaceRenderer {
  /** Draws a frame, unless it is the frame last drawn. With no content, the canvas is cleared. */
  render(plan: FramePlan, content: DisplayContent | null): void
  /**
   * The canvas may no longer show the last frame drawn: the next render draws, even an identical
   * frame. For the rare case where what is shown changed without a new image, key or plan.
   */
  invalidate(): void
  /** Releases the canvas backing store and stops listening for context restoration. */
  dispose(): void
}

interface Frame {
  readonly plan: FramePlan
  readonly content: DisplayContent | null
}

export function createWorkspaceRenderer(canvas: HTMLCanvasElement): WorkspaceRenderer | null {
  const context = canvas.getContext('2d')
  if (!context) return null

  let checker: { squareSize: number; pattern: CanvasPattern } | null = null
  // The last frame asked for, and whether the canvas shows it.
  let last: Frame | null = null
  let shown = false

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

  const draw = ({ plan, content }: Frame) => {
    const { backingStore } = plan
    // Resizing the backing store clears it, so only do it when the size changes.
    if (canvas.width !== backingStore.width) canvas.width = backingStore.width
    if (canvas.height !== backingStore.height) canvas.height = backingStore.height

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    // A released image cannot be drawn (drawImage would throw); its owner releases it only once
    // another image has been drawn, so this is a safeguard, never the normal path.
    if (!content || isReleasedDisplayImage(content.image) || !plan.checker || !plan.image) return

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
    context.drawImage(content.image, s.x, s.y, s.width, s.height, s.x, s.y, s.width, s.height)
  }

  const invalidate = () => {
    shown = false
    // A pattern from before a context loss may not survive it; it is cheap to make again.
    checker = null
  }

  // The browser cleared the canvas and reset its context when it restored it. The event is
  // never cancelled (that would stop the browser restoring the context).
  const onContextRestored = () => {
    invalidate()
    if (!last) return
    draw(last)
    shown = true
  }
  canvas.addEventListener('contextrestored', onContextRestored)

  return {
    render(plan, content) {
      if (shown && last && sameContent(last.content, content) && sameFramePlan(last.plan, plan)) return
      last = { plan, content }
      // Not shown until drawn: if drawing throws, the next render tries again.
      shown = false
      draw(last)
      shown = true
    },

    invalidate,

    dispose() {
      canvas.removeEventListener('contextrestored', onContextRestored)
      checker = null
      last = null
      shown = false
      canvas.width = canvas.height = 0
    },
  }
}

function sameContent(a: DisplayContent | null, b: DisplayContent | null): boolean {
  if (a === null || b === null) return a === b
  return a.image === b.image && a.key === b.key
}
