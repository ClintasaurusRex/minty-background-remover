import type { Rectangle, SelectionMask } from '../editor/types'
import { intersect } from './rendering'
import {
  type BoundaryPattern,
  OVERLAY_TILE_SIZE,
  type OverlayBoundary,
  type SelectionOverlayPlan,
  rasteriseOverlayTile,
  repaintOverlayBoundary,
} from './selectionOverlay'

/*
 * Draws selection overlay plans onto the overlay canvas: the only module that touches its
 * context. All geometry comes from planSelectionOverlay(), all pixels from
 * rasteriseOverlayTile() and repaintOverlayBoundary().
 *
 * Each tile is rasterised once into a small canvas and reused for as long as the selection, zoom
 * and device pixel ratio stay the same, so panning only rasterises tiles coming into view. Tiles
 * that move well out of view are released. With nothing selected, the canvas has no backing store.
 *
 * The boundary pattern (static, or a marching-ants phase) changes without rasterising again:
 * tiles keep where their boundary is, so a new pattern repaints only the boundary area of the
 * visible tiles that have one, and copies just that area to the canvas. The tint and the tiles
 * without boundary are never touched, and the selection is not read. Visible tiles also keep
 * their boundary area's pixels once the pattern has changed, so each marching-ants step only
 * flips the pixels that move.
 *
 * When the browser restores the canvas's lost context (after the GPU process restarts, for
 * example), the last frame is drawn again straight away, with new tiles: the old ones came back
 * blank. See onContextRestored.
 */

export interface SelectionOverlayRenderer {
  /**
   * Draws the overlay for `selection`, its boundary in `pattern`. With no plan or no selection,
   * the canvas is emptied.
   */
  render(plan: SelectionOverlayPlan | null, selection: SelectionMask | null, pattern: BoundaryPattern): void
  /** Shows the last frame drawn with another boundary pattern; tiles drawn later use it too. */
  setPattern(pattern: BoundaryPattern): void
  /**
   * How many device pixels the boundary areas of the last frame's visible tiles cover (0 without
   * boundary): what a new pattern repaints.
   */
  visibleBoundaryArea(): number
  /** Releases the canvas and every tile, and stops redrawing when the context is restored. */
  dispose(): void
}

interface Tile {
  readonly rect: Rectangle
  /** Null when the tile has nothing to draw. */
  readonly canvas: HTMLCanvasElement | null
  readonly context: CanvasRenderingContext2D | null
  /** Null when the tile has no boundary pixels: its pixels never change. */
  readonly boundary: OverlayBoundary | null
  /** The boundary pattern the tile's canvas shows. */
  pattern: BoundaryPattern
  /**
   * The boundary area's pixels as the canvas shows them, kept while the tile is in view after its
   * pattern first changes, so that a marching-ants step only changes the pixels that move.
   */
  area: { readonly image: ImageData; readonly pixels: Uint32Array } | null
  /** The last frame the tile was drawn in. */
  frame: number
}

export function createSelectionOverlayRenderer(canvas: HTMLCanvasElement): SelectionOverlayRenderer | null {
  const context = canvas.getContext('2d')
  if (!context) return null

  // Tiles by grid position, and what they were rasterised for.
  const tiles = new Map<string, Tile>()
  let tilesFor: { selection: SelectionMask; scale: number; lineWidth: number } | null = null
  // The last frame drawn, so an identical frame is not drawn again, and its number.
  let drawn: { plan: SelectionOverlayPlan; selection: SelectionMask } | null = null
  let frame = 0
  // Device pixels in the boundary areas of that frame's visible tiles.
  let boundaryArea = 0
  // The pattern tiles are drawn in.
  let pattern: BoundaryPattern | null = null
  // One tile's pixels, reused for every tile rasterised.
  let pixels: ImageData | null = null

  const release = (tile: Tile) => {
    if (tile.canvas) tile.canvas.width = tile.canvas.height = 0
    tile.area = null
  }

  const releaseTiles = () => {
    tiles.forEach(release)
    tiles.clear()
    tilesFor = null
  }

  const createTile = (selection: SelectionMask, plan: SelectionOverlayPlan, rect: Rectangle, shown: BoundaryPattern): Tile => {
    pixels ??= new ImageData(OVERLAY_TILE_SIZE, OVERLAY_TILE_SIZE)
    const out = new Uint32Array(pixels.data.buffer)
    const raster = rasteriseOverlayTile(selection, plan.scale, plan.lineWidth, rect, out, OVERLAY_TILE_SIZE, shown)
    const tile = raster.drawn ? document.createElement('canvas') : null
    const tileContext = tile?.getContext('2d') ?? null
    if (!tile || !tileContext) {
      if (tile) tile.width = tile.height = 0
      return { rect, canvas: null, context: null, boundary: null, pattern: shown, area: null, frame }
    }
    tile.width = rect.width
    tile.height = rect.height
    tileContext.putImageData(pixels, 0, 0, 0, 0, rect.width, rect.height)
    return { rect, canvas: tile, context: tileContext, boundary: raster.boundary, pattern: shown, area: null, frame }
  }

  /** Shows `next` in a tile's canvas, changing only its boundary area. */
  const repaintBoundary = (tile: Tile, boundary: OverlayBoundary, tileContext: CanvasRenderingContext2D, next: BoundaryPattern) => {
    let shown: BoundaryPattern | null = tile.pattern
    if (!tile.area) {
      const image = new ImageData(boundary.area.width, boundary.area.height)
      tile.area = { image, pixels: new Uint32Array(image.data.buffer) }
      shown = null
    }
    repaintOverlayBoundary(boundary, shown, next, tile.area.pixels)
    tileContext.putImageData(tile.area.image, boundary.area.x, boundary.area.y)
    tile.pattern = next
  }

  const setPattern = (next: BoundaryPattern) => {
    if (next === pattern) return
    pattern = next
    if (!drawn || boundaryArea === 0) return
    const { origin } = drawn.plan
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.imageSmoothingEnabled = false
    for (const { column, row } of drawn.plan.tiles) {
      const tile = tiles.get(`${column},${row}`)
      if (!tile?.boundary || !tile.context || !tile.canvas || tile.pattern === next) continue
      repaintBoundary(tile, tile.boundary, tile.context, next)
      // Boundary pixels are opaque, but the area also holds tint, which must not be drawn twice.
      const { area } = tile.boundary
      const x = origin.x + tile.rect.x + area.x
      const y = origin.y + tile.rect.y + area.y
      context.clearRect(x, y, area.width, area.height)
      context.drawImage(tile.canvas, area.x, area.y, area.width, area.height, x, y, area.width, area.height)
    }
  }

  const renderer: SelectionOverlayRenderer = {
    render(plan, selection, nextPattern) {
      if (!plan || !selection) {
        // Setting the size releases the backing store and clears the canvas.
        if (canvas.width !== 0 || canvas.height !== 0) canvas.width = canvas.height = 0
        releaseTiles()
        drawn = null
        boundaryArea = 0
        pattern = nextPattern
        return
      }
      if (drawn && drawn.selection === selection && samePlacement(drawn.plan, plan)) {
        // Same tiles in the same places: at most the boundary pattern changes.
        setPattern(nextPattern)
        return
      }
      pattern = nextPattern
      frame++

      if (tilesFor?.selection !== selection || tilesFor.scale !== plan.scale || tilesFor.lineWidth !== plan.lineWidth) {
        releaseTiles()
        tilesFor = { selection, scale: plan.scale, lineWidth: plan.lineWidth }
      }

      const { backingStore, origin } = plan
      // Resizing the backing store clears it, so only do it when the size changes.
      if (canvas.width !== backingStore.width) canvas.width = backingStore.width
      if (canvas.height !== backingStore.height) canvas.height = backingStore.height
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      // Tiles are drawn at whole device pixels and their own size, so nothing is resampled.
      context.imageSmoothingEnabled = false
      boundaryArea = 0
      for (const { column, row, rect } of plan.tiles) {
        const key = `${column},${row}`
        let tile = tiles.get(key)
        if (!tile) {
          tile = createTile(selection, plan, rect, pattern)
          tiles.set(key, tile)
        } else if (tile.boundary && tile.context && tile.pattern !== pattern) {
          // Kept out of view while the pattern changed.
          repaintBoundary(tile, tile.boundary, tile.context, pattern)
        }
        tile.frame = frame
        if (tile.boundary) boundaryArea += tile.boundary.area.width * tile.boundary.area.height
        if (tile.canvas) context.drawImage(tile.canvas, origin.x + rect.x, origin.y + rect.y)
      }
      for (const [key, tile] of tiles) {
        if (!intersect(tile.rect, plan.keep)) {
          release(tile)
          tiles.delete(key)
        } else if (tile.frame !== frame) {
          // Out of view: only visible tiles keep their boundary area's pixels.
          tile.area = null
        }
      }
      drawn = { plan, selection }
    },

    setPattern,

    visibleBoundaryArea() {
      return boundaryArea
    },

    dispose() {
      canvas.removeEventListener('contextrestored', onContextRestored)
      releaseTiles()
      canvas.width = canvas.height = 0
      pixels = null
      drawn = null
      boundaryArea = 0
    },
  }

  /*
   * After a lost context is restored, this canvas is blank, and so is every tile: in Chrome 156 a
   * GPU process restart blanks every canvas that lived on the GPU, tiles included (they are
   * restored just before this canvas). A pan would reuse them blank, so every tile is dropped and
   * the last frame is drawn again in the current pattern. Only the visible tiles are rasterised,
   * as after a zoom change. contextlost is not cancelled: that would stop the restoration.
   */
  const onContextRestored = () => {
    const last = drawn
    releaseTiles()
    drawn = null
    boundaryArea = 0
    if (last && pattern) renderer.render(last.plan, last.selection, pattern)
  }
  canvas.addEventListener('contextrestored', onContextRestored)

  return renderer
}

/** Whether two plans put the same tiles in the same places. */
function samePlacement(a: SelectionOverlayPlan, b: SelectionOverlayPlan): boolean {
  return (
    a.scale === b.scale &&
    a.lineWidth === b.lineWidth &&
    a.origin.x === b.origin.x &&
    a.origin.y === b.origin.y &&
    a.backingStore.width === b.backingStore.width &&
    a.backingStore.height === b.backingStore.height
  )
}
