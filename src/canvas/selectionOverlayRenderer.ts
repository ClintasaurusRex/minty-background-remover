import type { Rectangle, SelectionMask } from '../editor/types'
import { intersect } from './rendering'
import { OVERLAY_TILE_SIZE, type SelectionOverlayPlan, rasteriseSelectionOverlay } from './selectionOverlay'

/*
 * Draws selection overlay plans onto the overlay canvas: the only module that touches its
 * context. All geometry comes from planSelectionOverlay(), all pixels from
 * rasteriseSelectionOverlay().
 *
 * Each tile is rasterised once into a small canvas and reused for as long as the selection, zoom
 * and device pixel ratio stay the same, so panning only rasterises tiles coming into view. Tiles
 * that move well out of view are released. With nothing selected, the canvas has no backing store.
 */

export interface SelectionOverlayRenderer {
  /** Draws the overlay for `selection`. With no plan or no selection, the canvas is emptied. */
  render(plan: SelectionOverlayPlan | null, selection: SelectionMask | null): void
  /** Releases the canvas and every tile. */
  dispose(): void
}

interface Tile {
  readonly rect: Rectangle
  /** Null when the tile has nothing to draw. */
  readonly canvas: HTMLCanvasElement | null
}

export function createSelectionOverlayRenderer(canvas: HTMLCanvasElement): SelectionOverlayRenderer | null {
  const context = canvas.getContext('2d')
  if (!context) return null

  // Tiles by grid position, and what they were rasterised for.
  const tiles = new Map<string, Tile>()
  let tilesFor: { selection: SelectionMask; scale: number; lineWidth: number } | null = null
  // The last frame drawn, so an identical frame is not drawn again.
  let drawn: { plan: SelectionOverlayPlan; selection: SelectionMask } | null = null
  // One tile's pixels, reused for every tile rasterised.
  let pixels: ImageData | null = null

  const release = (tile: Tile) => {
    if (tile.canvas) tile.canvas.width = tile.canvas.height = 0
  }

  const releaseTiles = () => {
    tiles.forEach(release)
    tiles.clear()
    tilesFor = null
  }

  const rasteriseTile = (selection: SelectionMask, plan: SelectionOverlayPlan, rect: Rectangle): HTMLCanvasElement | null => {
    pixels ??= new ImageData(OVERLAY_TILE_SIZE, OVERLAY_TILE_SIZE)
    const out = new Uint32Array(pixels.data.buffer)
    if (!rasteriseSelectionOverlay(selection, plan.scale, plan.lineWidth, rect, out, OVERLAY_TILE_SIZE)) return null
    const tile = document.createElement('canvas')
    tile.width = rect.width
    tile.height = rect.height
    const tileContext = tile.getContext('2d')
    if (!tileContext) return null
    tileContext.putImageData(pixels, 0, 0, 0, 0, rect.width, rect.height)
    return tile
  }

  return {
    render(plan, selection) {
      if (!plan || !selection) {
        // Setting the size releases the backing store and clears the canvas.
        if (canvas.width !== 0 || canvas.height !== 0) canvas.width = canvas.height = 0
        releaseTiles()
        drawn = null
        return
      }
      if (drawn && drawn.selection === selection && samePlacement(drawn.plan, plan)) return

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
      for (const { column, row, rect } of plan.tiles) {
        const key = `${column},${row}`
        let tile = tiles.get(key)
        if (!tile) {
          tile = { rect, canvas: rasteriseTile(selection, plan, rect) }
          tiles.set(key, tile)
        }
        if (tile.canvas) context.drawImage(tile.canvas, origin.x + rect.x, origin.y + rect.y)
      }
      for (const [key, tile] of tiles) {
        if (!intersect(tile.rect, plan.keep)) {
          release(tile)
          tiles.delete(key)
        }
      }
      drawn = { plan, selection }
    },

    dispose() {
      releaseTiles()
      canvas.width = canvas.height = 0
      pixels = null
      drawn = null
    },
  }
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
