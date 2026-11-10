import { pixelUnderPointer } from '../canvas/coordinates'
import { sampleColour } from '../image/colour/colour'
import { type EditorAction, type EditorState, displayViewport, documentVersion } from './editorState'
import type { Point } from './types'

/*
 * Eyedropper input (Phase 4; FEATURE_SPEC.md §12, IMAGE_PROCESSING_SPEC.md, Eyedropper): a click on
 * the image turned into the colour of the pixel shown under the pointer. Read here, outside the
 * reducer, from the latest committed state and tagged with the document version it was read from.
 * Reading never changes the image.
 */

/**
 * The Eyedropper click at `point` (workspace canvas CSS px): the exact values of the image pixel
 * shown under the pointer, found as the Magic Wand finds it (pixelUnderPointer with the display
 * viewport, so zoom, pan and the device pixel ratio are accounted for), colour hidden under alpha 0
 * included. Null when there is nothing to read: no image, another tool, or a point outside the
 * image.
 */
export function eyedropperClick(state: EditorState, point: Point): EditorAction | null {
  const { document, workspace } = state
  const viewport = displayViewport(state)
  const version = documentVersion(state)
  if (!document || !viewport || !workspace || !version || state.activeTool !== 'eyedropper') return null
  const pixel = pixelUnderPointer(viewport, point, document, workspace.devicePixelRatio)
  if (!pixel) return null
  return { type: 'colour-sampled', version, pixel, colour: sampleColour(document.pixels, pixel) }
}
