import type { PixelBuffer, Rectangle, SelectionMask } from '../../editor/types'
import { createPixelBuffer } from '../pixelBuffer'
import { type DeleteSelectionResult, deleteSelectedPixelData, deleteSelectedPixels } from './deleteSelection'
import { type BoundsTracker, DEFAULT_STRIP_ROWS, emptyBounds, includePixel, trackedBounds } from './edgeBand'
import { cleanSelectionEdges } from './edgeCleanup'
import { featherSelectionEdges } from './feather'

/*
 * Delete Selection with its edge settings (Phase 3 Step 8; FEATURE_SPEC.md §8–9): the exact
 * Delete, then edge cleanup (edgeCleanup.ts) and feathering (feather.ts) of the unselected pixels
 * along the deleted area, as one edit on one copy of the image.
 *
 * Both settings are optional and default to 0 (P3-D4). With both at 0 this is exactly
 * deleteSelectedPixels: the same bytes, count and bounds.
 */

/** The largest edge cleanup and feather amounts, in pixels (owner decision, Step 8). */
export const MAX_EDGE_PIXELS = 5

/** How Delete treats the edge it leaves. Whole numbers of pixels, 0 to MAX_EDGE_PIXELS. */
export interface EdgeSettings {
  /** Edge cleanup distance: how far inward background colour is removed. 0: none. */
  readonly cleanup: number
  /** Feather distance: how far inward the edge is faded. 0: none. */
  readonly feather: number
}

export const NO_EDGE_TREATMENT: EdgeSettings = { cleanup: 0, feather: 0 }

/** What Delete Selection with edge settings changed. */
export interface DeleteWithEdgesResult extends DeleteSelectionResult {
  /**
   * Smallest rectangle containing every changed pixel: the deleted ones and the edge pixels
   * cleanup and feathering changed. (`count` is still the selected pixels made transparent.)
   */
  readonly bounds: Readonly<Rectangle>
  /** Unselected pixels changed by cleanup or feathering, each counted once. 0 with both settings at 0. */
  readonly edgePixels: number
}

/**
 * Delete Selection (deleteSelectedPixels), then the edge settings. Returns null when nothing would
 * change: no selection, or only fully transparent pixels selected. Cleanup and feathering then do
 * not run either: they treat the edge a Delete leaves, and the colours behind an already
 * transparent selection are not known.
 *
 * - Every selected pixel is deleted exactly as by deleteSelectedPixels; the edge settings change
 *   only unselected pixels, within their distance of the selection, and only lower their alpha
 *   or correct their colour (never raise alpha, never show a hidden colour).
 * - One copy of the image, written by all three steps; the input pixels and selection are never
 *   written.
 *
 * Throws a RangeError for settings that are not whole numbers from 0 to MAX_EDGE_PIXELS, and as
 * deleteSelectedPixels for invalid pixels or selections.
 */
export function deleteSelectionWithEdges(
  pixels: PixelBuffer,
  selection: SelectionMask | null,
  settings: EdgeSettings,
  stripRows: number = DEFAULT_STRIP_ROWS,
): DeleteWithEdgesResult | null {
  validateEdgeSettings(settings)
  if (settings.cleanup === 0 && settings.feather === 0) {
    const exact = deleteSelectedPixels(pixels, selection)
    return exact && { ...exact, edgePixels: 0 }
  }
  const deleted = deleteSelectedPixelData(pixels, selection)
  if (!deleted || !selection) return null

  const changed: BoundsTracker = emptyBounds()
  const { x, y, width, height } = deleted.bounds
  includePixel(changed, y * pixels.width + x, pixels.width)
  includePixel(changed, (y + height - 1) * pixels.width + x + width - 1, pixels.width)
  const cleaned = cleanSelectionEdges(pixels, selection, deleted.data, settings.cleanup, changed, stripRows)
  const feathered = featherSelectionEdges(pixels, selection, deleted.data, settings.feather, changed, stripRows)

  return {
    pixels: createPixelBuffer(pixels.width, pixels.height, deleted.data),
    count: deleted.count,
    // Never null: it includes the deleted pixels' bounds.
    bounds: trackedBounds(changed) ?? deleted.bounds,
    edgePixels: cleaned.changed + feathered.changedFromSource,
  }
}

/** Throws a RangeError unless both settings are whole numbers from 0 to MAX_EDGE_PIXELS. */
export function validateEdgeSettings(settings: EdgeSettings): void {
  for (const [name, value] of [
    ['Edge cleanup', settings.cleanup],
    ['Feather', settings.feather],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_EDGE_PIXELS) {
      throw new RangeError(`${name} must be a whole number of pixels from 0 to ${MAX_EDGE_PIXELS}; got ${value}`)
    }
  }
}
