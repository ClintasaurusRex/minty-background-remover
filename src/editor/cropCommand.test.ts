import { beforeEach, describe, expect, it } from 'vitest'
import { type ExportTarget, runExport } from '../app/exportImage'
import { LINES } from '../image/edit/edgeTestFixtures'
import { encodePng } from '../image/export/pngEncoder'
import { decodeTestPng } from '../image/export/testPng'
import { createImportError } from '../image/import/errors'
import { createPixelBuffer } from '../image/pixelBuffer'
import { cropShortcut } from './cropCommands'
import { availableEditActions, cropCommand, editActionCommand } from './editCommands'
import { editNoticeText, isShownEditNotice } from './editFeedback'
import {
  type EditorAction,
  type EditorState,
  type WorkspaceMetrics,
  NO_CROP,
  displayViewport,
  editorReducer,
  initialEditorState,
  pendingCrop,
} from './editorState'
import { createEditHistory } from './history/editHistory'
import {
  type FakeDisplayImages,
  WORKSPACE,
  accepted,
  fakeDisplayImages,
  opened,
  randomImage,
  randomInt,
  randomSource,
  reachable,
  reduce,
  sameBytes,
  sameSelection,
} from './history/testFixtures'
import { magicWandClick } from './selectionCommands'
import type { PixelBuffer, Point, Rectangle } from './types'

/*
 * Manual Crop as the application runs it (Phase 4): pointer drags through the real reducer (new,
 * move, resize, clicks, dragging outside the image, zoom and device pixel ratio), the fields, Cancel,
 * what clears the rectangle, then Apply Crop through editActionCommand: the kept bytes, the image's
 * size, the selection, the view, history, Undo and Redo, availability, stale and failed actions, and
 * the exported PNG. Display images are fakes recording what was created.
 *
 * Expected pixels are computed here by indexing the original image, never by the crop code itself.
 */

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const measuredAt = (workspace: WorkspaceMetrics) => reduce(initialEditorState, { type: 'workspace-resized', workspace })
const measured = measuredAt(WORKSPACE)

type Action = 'delete-selection' | 'auto-trim' | 'crop' | 'undo' | 'redo'
const run = (state: EditorState, action: Action) => accepted(state, editActionCommand(state, action, images.create))
const cropTool = (state: EditorState) => reduce(state, { type: 'tool-selected', tool: 'crop' })

/** The workspace point (CSS px) over image coordinates (x, y), in the display viewport. */
function at(state: EditorState, x: number, y: number): Point {
  const viewport = displayViewport(state)!
  return { x: viewport.offset.x + x * viewport.zoom, y: viewport.offset.y + y * viewport.zoom }
}

/** A pointer drag through image coordinates `points` (press at the first, release after the last). */
function drag(state: EditorState, ...points: [number, number][]): EditorState {
  const [first, ...rest] = points
  let next = reduce(state, { type: 'crop-drag-started', point: at(state, ...first) })
  for (const point of rest) next = reduce(next, { type: 'crop-dragged', point: at(next, ...point) })
  return reduce(next, { type: 'crop-drag-ended' })
}

/** The pixels of `rect` in `pixels`, by indexing (independent of cropPixels). */
function expectedCrop(pixels: PixelBuffer, rect: Rectangle): PixelBuffer {
  const data = new Uint8ClampedArray(rect.width * rect.height * 4)
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      for (let k = 0; k < 4; k++) data[(y * rect.width + x) * 4 + k] = pixels.data[((rect.y + y) * pixels.width + rect.x + x) * 4 + k]
    }
  }
  return createPixelBuffer(rect.width, rect.height, data)
}

/** A 40 × 30 image whose every pixel differs, with alpha 0–255 and hidden colour under alpha 0. */
function varied(): PixelBuffer {
  const width = 40
  const height = 30
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    data.set([p % 251, (p * 7) % 253, (p * 13) % 255, p % 9 === 0 ? 0 : (p * 3) % 256], p * 4)
  }
  return createPixelBuffer(width, height, data)
}

describe('crop rectangle: dragging with the pointer', () => {
  it('draws a new rectangle from the press to the pointer, in whole image pixels', () => {
    const state = cropTool(opened(varied(), measured))
    expect(state.activeTool).toBe('crop')
    expect(pendingCrop(state)).toBeNull()
    const started = reduce(state, { type: 'crop-drag-started', point: at(state, 5, 4) })
    expect(started.crop.drag).toEqual({ kind: 'new', anchor: { x: 5, y: 4 } })
    expect(pendingCrop(started)).toBeNull()
    const moved = reduce(started, { type: 'crop-dragged', point: at(started, 25.3, 19.4) })
    expect(pendingCrop(moved)).toEqual({ x: 5, y: 4, width: 20, height: 15 })
    // Dragging back up and left past the start turns the rectangle the other way, never inside out.
    const back = reduce(moved, { type: 'crop-dragged', point: at(moved, 1, 2) })
    expect(pendingCrop(back)).toEqual({ x: 1, y: 2, width: 4, height: 2 })
    const ended = reduce(back, { type: 'crop-drag-ended' })
    expect(ended.crop).toEqual({ rect: { x: 1, y: 2, width: 4, height: 2 }, drag: null })
    // Nothing about the image changed.
    expect(ended.document).toBe(state.document)
    expect(ended.history).toBe(state.history)
  })

  it('stops at the image edges when the pointer goes outside, including starting outside', () => {
    const state = cropTool(opened(varied(), measured))
    expect(pendingCrop(drag(state, [-50, -80], [500, 400]))).toEqual({ x: 0, y: 0, width: 40, height: 30 })
    expect(pendingCrop(drag(state, [30, 20], [-3, 100]))).toEqual({ x: 0, y: 20, width: 30, height: 10 })
  })

  it('leaves no rectangle after a click without a drag, or a drag along one edge (no zero-area crops)', () => {
    const state = cropTool(opened(varied(), measured))
    expect(pendingCrop(drag(state, [10, 10]))).toBeNull()
    expect(pendingCrop(drag(state, [10, 10], [10.2, 25]))).toBeNull()
    expect(pendingCrop(drag(state, [10, 10], [-5, 10]))).toBeNull()
    // A click outside an existing rectangle drops it.
    const chosen = drag(state, [5, 5], [20, 20])
    expect(pendingCrop(drag(chosen, [35, 25]))).toBeNull()
  })

  it('moves the rectangle from inside it, stopping at the image edges', () => {
    const chosen = drag(cropTool(opened(varied(), measured)), [5, 5], [20, 15]) // 15 × 10
    expect(pendingCrop(drag(chosen, [12, 10], [15, 8]))).toEqual({ x: 8, y: 3, width: 15, height: 10 })
    expect(pendingCrop(drag(chosen, [12, 10], [100, 100]))).toEqual({ x: 25, y: 20, width: 15, height: 10 })
    expect(pendingCrop(drag(chosen, [12, 10], [-100, -100]))).toEqual({ x: 0, y: 0, width: 15, height: 10 })
  })

  it('resizes from each handle without jumping, and never below 1 × 1', () => {
    const chosen = drag(cropTool(opened(varied(), measured)), [5, 5], [25, 20]) // x 5–25, y 5–20, zoom 1
    // Pressing 3 CSS px outside the corner and moving 4 pixels moves the corner exactly 4 pixels.
    expect(pendingCrop(drag(chosen, [28, 23], [32, 27]))).toEqual({ x: 5, y: 5, width: 24, height: 19 })
    expect(pendingCrop(drag(chosen, [4, 4], [2, 1]))).toEqual({ x: 3, y: 2, width: 22, height: 18 })
    expect(pendingCrop(drag(chosen, [15, 5], [15, 9]))).toEqual({ x: 5, y: 9, width: 20, height: 11 })
    expect(pendingCrop(drag(chosen, [25, 12], [200, 12]))).toEqual({ x: 5, y: 5, width: 35, height: 15 })
    expect(pendingCrop(drag(chosen, [25, 12], [-200, 12]))).toEqual({ x: 5, y: 5, width: 1, height: 15 })
    expect(pendingCrop(drag(chosen, [5, 5], [300, 300]))).toEqual({ x: 24, y: 19, width: 1, height: 1 })
  })

  it('maps the pointer to the nearest pixel edge at high zoom', () => {
    const state = cropTool(opened(varied(), measured))
    const zoomed = reduce(state, { type: 'zoom-scaled', anchor: at(state, 20, 15), factor: 8 })
    expect(displayViewport(zoomed)!.zoom).toBe(8)
    // 10.4 → 10, 12.6 → 13 (an eighth of a pixel is one CSS px here).
    expect(pendingCrop(drag(zoomed, [10.4, 12.6], [17.49, 18.51]))).toEqual({ x: 10, y: 13, width: 7, height: 6 })
  })

  it('works the same at device pixel ratio 2 and with fractional zoom', () => {
    const state = cropTool(opened(varied(), measuredAt({ size: { width: 300, height: 200 }, devicePixelRatio: 2 })))
    const zoomed = reduce(state, { type: 'zoom-scaled', anchor: { x: 150, y: 100 }, factor: 2.37 })
    const viewport = displayViewport(zoomed)!
    expect(Math.abs(viewport.offset.x * 2 - Math.round(viewport.offset.x * 2))).toBeLessThan(1e-9)
    expect(pendingCrop(drag(zoomed, [3, 4], [11, 9]))).toEqual({ x: 3, y: 4, width: 8, height: 5 })
  })

  it('keeps following the image when the view changes during a drag', () => {
    const state = cropTool(opened(varied(), measured))
    const started = reduce(state, { type: 'crop-drag-started', point: at(state, 5, 5) })
    const zoomed = reduce(started, { type: 'zoom-scaled', anchor: { x: 0, y: 0 }, factor: 3 })
    const moved = reduce(zoomed, { type: 'crop-dragged', point: at(zoomed, 30, 20) })
    expect(pendingCrop(moved)).toEqual({ x: 5, y: 5, width: 25, height: 15 })
  })

  it('ignores drags with other tools, without an image, without a press, and points that are not finite', () => {
    const state = opened(varied(), measured)
    expect(reduce(state, { type: 'crop-drag-started', point: at(state, 5, 5) })).toBe(state)
    expect(reduce(measured, { type: 'crop-drag-started', point: { x: 1, y: 1 } })).toBe(measured)
    const crop = cropTool(state)
    expect(reduce(crop, { type: 'crop-dragged', point: at(crop, 5, 5) })).toBe(crop)
    expect(reduce(crop, { type: 'crop-drag-ended' })).toBe(crop)
    expect(reduce(crop, { type: 'crop-drag-started', point: { x: Number.NaN, y: 3 } })).toBe(crop)
    const started = reduce(crop, { type: 'crop-drag-started', point: at(crop, 5, 5) })
    expect(reduce(started, { type: 'crop-dragged', point: { x: Infinity, y: 3 } })).toBe(started)
  })
})

describe('crop rectangle: fields, Cancel and what clears it', () => {
  it('starts from the whole image when a field is edited without a rectangle; X / Y move, Width / Height resize, clamped', () => {
    const state = cropTool(opened(varied(), measured))
    const narrower = reduce(state, { type: 'crop-field-changed', field: 'width', value: 25 })
    expect(pendingCrop(narrower)).toEqual({ x: 0, y: 0, width: 25, height: 30 })
    const moved = reduce(narrower, { type: 'crop-field-changed', field: 'x', value: 99 })
    expect(pendingCrop(moved)).toEqual({ x: 15, y: 0, width: 25, height: 30 })
    expect(pendingCrop(reduce(moved, { type: 'crop-field-changed', field: 'height', value: 0 }))).toEqual({ x: 15, y: 0, width: 25, height: 1 })
    expect(reduce(moved, { type: 'crop-field-changed', field: 'y', value: Number.NaN })).toBe(moved)
    expect(reduce(moved, { type: 'crop-field-changed', field: 'x', value: 15 })).toBe(moved)
    // Only with the Crop tool.
    const wand = opened(varied(), measured)
    expect(reduce(wand, { type: 'crop-field-changed', field: 'width', value: 5 })).toBe(wand)
  })

  it('Cancel drops the rectangle and a drag in progress, changing nothing else', () => {
    const chosen = drag(cropTool(opened(varied(), measured)), [5, 5], [20, 20])
    const cancelled = reduce(chosen, { type: 'crop-cancelled' })
    expect(cancelled.crop).toBe(NO_CROP)
    expect(cancelled.document).toBe(chosen.document)
    expect(reduce(cancelled, { type: 'crop-cancelled' })).toBe(cancelled)
    const dragging = reduce(chosen, { type: 'crop-drag-started', point: at(chosen, 12, 12) })
    expect(reduce(dragging, { type: 'crop-cancelled' }).crop).toBe(NO_CROP)
  })

  it('choosing a tool or opening another image drops the rectangle; a failed import keeps it', () => {
    const chosen = drag(cropTool(opened(varied(), measured)), [5, 5], [20, 20])
    expect(reduce(chosen, { type: 'tool-selected', tool: 'magic-wand' }).crop).toBe(NO_CROP)
    expect(pendingCrop(cropTool(reduce(chosen, { type: 'tool-selected', tool: 'magic-wand' })))).toBeNull()
    expect(opened(varied(), chosen).crop).toBe(NO_CROP)
    const failed = reduce(
      chosen,
      { type: 'import-started', importId: 77 },
      { type: 'import-finished', importId: 77, result: { ok: false, error: createImportError('decode-failed') } },
    )
    expect(pendingCrop(failed)).toEqual({ x: 5, y: 5, width: 15, height: 15 })
  })

  it('keeps the rectangle through edits that keep the size (Delete Selection, its Undo and Redo), not through size changes', () => {
    let state = cropTool(opened(varied(), measured))
    state = reduce(state, { type: 'selection-applied', version: { documentId: state.document!.id, revision: 0 }, selection: null })
    const selectAll = (s: EditorState) =>
      accepted(s, { type: 'selection-applied', version: { documentId: s.document!.id, revision: s.document!.revision }, selection: maskAll(s) })
    state = drag(selectAll(state), [5, 5], [20, 20])
    const deleted = run(state, 'delete-selection')
    expect(pendingCrop(deleted)).toEqual({ x: 5, y: 5, width: 15, height: 15 })
    expect(pendingCrop(run(deleted, 'undo'))).toEqual({ x: 5, y: 5, width: 15, height: 15 })
    const cropped = run(deleted, 'crop')
    expect(cropped.crop).toBe(NO_CROP)
    // Undo of the crop changes the size back: the old rectangle does not come back.
    expect(run(cropped, 'undo').crop).toBe(NO_CROP)
  })
})

function maskAll(state: EditorState) {
  const { width, height } = state.document!
  return { width, height, data: new Uint8Array(width * height).fill(1), count: width * height, bounds: { x: 0, y: 0, width, height } }
}

describe('Apply Crop', () => {
  it('keeps exactly the rectangle’s bytes (alpha and hidden colour included), as a new revision of that size, fitted', () => {
    const original = varied()
    const chosen = drag(cropTool(opened(original, measured)), [7, 3], [31, 22])
    const rect = pendingCrop(chosen)!
    expect(rect).toEqual({ x: 7, y: 3, width: 24, height: 19 })
    expect(availableEditActions(chosen).crop).toBe(true)
    const cropped = run(chosen, 'crop')
    const document = cropped.document!
    expect([document.width, document.height]).toEqual([24, 19])
    expect(document.id).toBe(chosen.document!.id)
    expect(document.revision).toBeGreaterThan(chosen.document!.revision)
    expect(sameBytes(document.pixels, expectedCrop(original, rect))).toBe(true)
    // The opened pixels are untouched (copy-on-write).
    expect(sameBytes(chosen.document!.pixels, varied())).toBe(true)
    expect(images.created.at(-1)!.pixels).toBe(document.pixels)
    expect(cropped.documentBitmap).toBe(images.created.at(-1))
    expect(cropped.crop).toBe(NO_CROP)
    expect(cropped.activeTool).toBe('crop')
    expect(cropped.editDepth).toBe(1)
    expect(cropped.history.undo).toHaveLength(1)
    expect(cropped.history.undo[0].kind).toBe('crop')
    expect(cropped.history.undo[0].patch.kind).toBe('crop-patch')
    // Fitted like Fit: a small image at 100%, centred.
    expect(cropped.viewport!.zoom).toBe(1)
    expect(cropped.editNotice).toEqual({
      kind: 'applied',
      operation: 'crop',
      changedPixels: null,
      resized: { from: { width: 40, height: 30 }, to: { width: 24, height: 19 } },
    })
    expect(editNoticeText(cropped.editNotice!)).toBe('Crop applied: 40 × 30 px cropped to 24 × 19 px.')
    expect(isShownEditNotice(cropped.editNotice!)).toBe(false)
  })

  it('Undo restores every byte, the size, the selection and the Magic Wand click; Redo crops again exactly', () => {
    const original = varied()
    let state = opened(original, measured)
    const viewport = displayViewport(state)!
    state = accepted(state, magicWandClick(state, { x: viewport.offset.x + 0.5, y: viewport.offset.y + 0.5 }, 'new'))
    const selection = state.selection
    const click = state.lastMagicWandOperation!
    state = drag(cropTool(state), [2, 2], [12, 9])
    expect(state.selection).toBe(selection) // kept while choosing
    const cropped = run(state, 'crop')
    expect(cropped.selection).toBeNull()
    expect(cropped.lastMagicWandOperation).toBeNull()
    const undone = run(cropped, 'undo')
    expect(sameBytes(undone.document!.pixels, original)).toBe(true)
    expect([undone.document!.width, undone.document!.height]).toEqual([40, 30])
    expect(sameSelection(undone.selection, selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toMatchObject({ seed: click.seed, tolerance: click.tolerance, selectionMode: click.selectionMode })
    expect(undone.lastMagicWandOperation!.version.revision).toBe(undone.document!.revision)
    expect(editNoticeText(undone.editNotice!)).toBe('Undone: Crop.')
    expect(availableEditActions(cropped).undo).toBe('crop')
    const redone = run(undone, 'redo')
    expect(sameBytes(redone.document!.pixels, expectedCrop(original, { x: 2, y: 2, width: 10, height: 7 }))).toBe(true)
    expect(redone.selection).toBeNull()
    expect(editNoticeText(redone.editNotice!)).toBe('Redone: Crop.')
    // Repeated Undo / Redo stays exact.
    let cycle = redone
    for (let i = 0; i < 5; i++) {
      cycle = run(run(cycle, 'undo'), 'redo')
      expect(sameBytes(cycle.document!.pixels, redone.document!.pixels)).toBe(true)
    }
    expect(sameBytes(run(cycle, 'undo').document!.pixels, original)).toBe(true)
  })

  it('crops transparent images, results of Delete and Auto Trim, and objects touching the edges exactly', () => {
    const { observed } = LINES()
    // Delete the white background (Select All of white only is the Magic Wand at 0 from a corner).
    let state = opened(observed, measured)
    const v = displayViewport(state)!
    state = accepted(state, magicWandClick(state, { x: v.offset.x + 0.5, y: v.offset.y + 0.5 }, 'new'))
    state = run(state, 'delete-selection')
    const deleted = state.document!.pixels
    state = reduce(state, { type: 'auto-trim-padding-changed', padding: 0 })
    state = run(state, 'auto-trim')
    const trimmed = state.document!.pixels
    expect(trimmed.width).toBeLessThan(80)
    // The black frame lines now touch the image's top and left edges: crop a rectangle along them.
    state = cropTool(state)
    state = reduce(state, { type: 'crop-field-changed', field: 'width', value: 30 }, { type: 'crop-field-changed', field: 'height', value: 25 })
    const rect = pendingCrop(state)!
    expect(rect).toEqual({ x: 0, y: 0, width: 30, height: 25 })
    const cropped = run(state, 'crop')
    expect(sameBytes(cropped.document!.pixels, expectedCrop(trimmed, rect))).toBe(true)
    // Undo twice returns the deleted image, every hidden colour included.
    expect(sameBytes(run(run(cropped, 'undo'), 'undo').document!.pixels, deleted)).toBe(true)
    // A fully transparent image crops too: every pixel stays alpha 0 with its hidden colour.
    const empty = createPixelBuffer(9, 7, new Uint8ClampedArray(9 * 7 * 4).map((_, i) => (i % 4 === 3 ? 0 : (i * 5) % 256)))
    const emptyState = reduce(cropTool(opened(empty, measured)), { type: 'crop-field-changed', field: 'width', value: 4 })
    expect(sameBytes(run(emptyState, 'crop').document!.pixels, expectedCrop(empty, { x: 0, y: 0, width: 4, height: 7 }))).toBe(true)
  })

  it('crops to a single pixel at any corner, and to the right and bottom edges', () => {
    const original = varied()
    for (const [x, y] of [[0, 0], [39, 0], [0, 29], [39, 29], [17, 11]]) {
      const state = drag(cropTool(opened(original, measured)), [x, y], [x + 1, y + 1])
      expect(pendingCrop(state)).toEqual({ x, y, width: 1, height: 1 })
      const cropped = run(state, 'crop')
      expect(sameBytes(cropped.document!.pixels, expectedCrop(original, { x, y, width: 1, height: 1 }))).toBe(true)
      expect(sameBytes(run(cropped, 'undo').document!.pixels, original)).toBe(true)
    }
    const right = drag(cropTool(opened(original, measured)), [25, 10], [99, 99])
    expect(pendingCrop(right)).toEqual({ x: 25, y: 10, width: 15, height: 20 })
    expect(sameBytes(run(right, 'crop').document!.pixels, expectedCrop(original, pendingCrop(right)!))).toBe(true)
  })

  it('is exact for random rectangles on random images, through Undo and Redo', () => {
    const random = randomSource(9)
    for (let i = 0; i < 60; i++) {
      const width = 1 + randomInt(random, 30)
      const height = 1 + randomInt(random, 30)
      const original = randomImage(width, height, random)
      const x = randomInt(random, width)
      const y = randomInt(random, height)
      const rect = { x, y, width: 1 + randomInt(random, width - x), height: 1 + randomInt(random, height - y) }
      let state = cropTool(opened(original, measured))
      for (const field of ['width', 'height', 'x', 'y'] as const) state = reduce(state, { type: 'crop-field-changed', field, value: rect[field] })
      expect(pendingCrop(state)).toEqual(rect)
      const whole = rect.width === width && rect.height === height
      expect(availableEditActions(state).crop).toBe(!whole)
      if (whole) continue
      const cropped = run(state, 'crop')
      expect(sameBytes(cropped.document!.pixels, expectedCrop(original, rect))).toBe(true)
      const undone = run(cropped, 'undo')
      expect(sameBytes(undone.document!.pixels, original)).toBe(true)
      expect(sameBytes(run(undone, 'redo').document!.pixels, cropped.document!.pixels)).toBe(true)
    }
  })

  it('is exact at 4K, keeping only the removed pixels in history (no full-image snapshot)', () => {
    const random = randomSource(4)
    const original = randomImage(3840, 2160, random)
    const state = reduce(cropTool(opened(original, measured)), ...fields({ x: 1000, y: 500, width: 1920, height: 1080 }))
    const cropped = run(state, 'crop')
    expect(sameBytes(cropped.document!.pixels, expectedCrop(original, { x: 1000, y: 500, width: 1920, height: 1080 }))).toBe(true)
    const entry = cropped.history.undo[0]
    const removed = 3840 * 2160 - 1920 * 1080
    // Random pixels are stored as literals: at most 4 bytes per removed pixel plus run tokens.
    expect(entry.retainedBytes).toBeLessThan(removed * 4 * 1.01 + 4096)
    // The history holds no image-sized buffer of either size.
    const buffers = [...reachable(cropped.history).buffers]
    expect(buffers.some((b) => b.byteLength === 3840 * 2160 * 4 || b.byteLength === 1920 * 1080 * 4)).toBe(false)
    expect(sameBytes(run(cropped, 'undo').document!.pixels, original)).toBe(true)
  })

  it('is unavailable without a rectangle, for the whole image, while another image opens, and with another tool', () => {
    const state = cropTool(opened(varied(), measured))
    expect(availableEditActions(state).crop).toBe(false)
    expect(editActionCommand(state, 'crop', images.create)).toBeNull()
    const whole = drag(state, [-5, -5], [99, 99])
    expect(pendingCrop(whole)).toEqual({ x: 0, y: 0, width: 40, height: 30 })
    expect(availableEditActions(whole).crop).toBe(false)
    expect(cropCommand(whole, images.create)).toBeNull()
    const chosen = drag(state, [5, 5], [20, 20])
    const importing = reduce(chosen, { type: 'import-started', importId: 99 })
    expect(availableEditActions(importing).crop).toBe(false)
    expect(editActionCommand(importing, 'crop', images.create)).toBeNull()
    expect(availableEditActions({ ...chosen, activeTool: 'magic-wand' }).crop).toBe(false)
    expect(images.created).toHaveLength(0)
  })

  it('rejects a stale Apply computed before another edit, and fails without changing anything when the image cannot be made', () => {
    let state = cropTool(opened(varied(), measured))
    state = accepted(state, { type: 'selection-applied', version: { documentId: state.document!.id, revision: 0 }, selection: maskAll(state) })
    state = drag(state, [5, 5], [20, 20])
    const stale = editActionCommand(state, 'crop', images.create)!
    const deleted = run(state, 'delete-selection')
    expect(editorReducer(deleted, stale)).toBe(deleted)

    images.failing = true
    const failure = editActionCommand(deleted, 'crop', images.create) as EditorAction
    expect(failure.type).toBe('edit-failed')
    const failed = editorReducer(deleted, failure)
    expect(failed.document).toBe(deleted.document)
    expect(failed.history).toBe(deleted.history)
    expect(pendingCrop(failed)).toEqual(pendingCrop(deleted))
    expect(failed.editError).toMatchObject({ operation: 'crop' })
  })

  it('counts against the history limits, dropping the oldest step and saying so', () => {
    let state = opened(varied(), { ...measured, history: createEditHistory({ maxEntries: 2, maxBytes: 1 << 30 }) })
    state = cropTool(state)
    for (const width of [38, 36, 34]) state = run(reduce(state, { type: 'crop-field-changed', field: 'width', value: width }), 'crop')
    expect(state.history.undo).toHaveLength(2)
    expect(state.editNotice).toMatchObject({ operation: 'crop', droppedUndoSteps: 1 })
    expect(isShownEditNotice(state.editNotice!)).toBe(true)
    expect(editNoticeText(state.editNotice!)).toBe(
      'Crop applied: 36 × 30 px cropped to 34 × 30 px. Undo history is full, so the oldest Undo step is no longer available.',
    )
  })

  it('exports exactly the cropped image; a rectangle not applied is never part of an export', async () => {
    const original = varied()
    let state = drag(cropTool(opened(original, measured)), [3, 2], [30, 25])
    const downloads: Blob[] = []
    const target: ExportTarget = {
      committedState: () => state,
      dispatch: (action) => {
        state = editorReducer(state, action)
      },
      flush: (update) => update(),
      encode: (pixels) => encodePng(pixels, { yieldControl: () => Promise.resolve() }),
      download: (file) => downloads.push(file),
    }
    await runExport(target, 1)
    expectExport(await decodeTestPng(downloads[0]), original)
    expect(pendingCrop(state)).toEqual({ x: 3, y: 2, width: 27, height: 23 })
    state = run(state, 'crop')
    await runExport(target, 2)
    expectExport(await decodeTestPng(downloads[1]), expectedCrop(original, { x: 3, y: 2, width: 27, height: 23 }))
  })
})

function fields(rect: Rectangle): EditorAction[] {
  return (['width', 'height', 'x', 'y'] as const).map((field) => ({ type: 'crop-field-changed', field, value: rect[field] }))
}

/** The export of `pixels`: every byte, fully transparent pixels written as 0, 0, 0, 0. */
function expectExport(png: { width: number; height: number; data: Uint8Array }, pixels: PixelBuffer) {
  expect([png.width, png.height]).toEqual([pixels.width, pixels.height])
  let mismatches = 0
  for (let i = 0; i < pixels.data.length; i += 4) {
    const alpha = pixels.data[i + 3]
    for (let k = 0; k < 4; k++) if (png.data[i + k] !== (alpha === 0 ? 0 : pixels.data[i + k])) mismatches++
  }
  expect(mismatches).toBe(0)
}

describe('cropShortcut', () => {
  const key = (k: string, extra: Partial<Parameters<typeof cropShortcut>[0]> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...extra,
  })
  const element = (tag: string, type?: string) => ({
    closest: (selector: string) => (selector.split(',').some((s) => s.trim() === tag || s.trim().startsWith(`${tag}`)) ? { type } : null),
  }) as unknown as EventTarget

  it('Enter applies and Escape cancels while a crop is pending', () => {
    expect(cropShortcut(key('Enter'), true)).toBe('apply')
    expect(cropShortcut(key('Escape'), true)).toBe('cancel')
    expect(cropShortcut(key('Enter'), false)).toBeNull()
    expect(cropShortcut(key('Escape'), false)).toBeNull()
  })

  it('leaves text fields, controls (for Enter), modifiers, repeats, composition and handled keys alone', () => {
    expect(cropShortcut(key('Enter', { target: element('input', 'text') }), true)).toBeNull()
    expect(cropShortcut(key('Escape', { target: element('input', 'text') }), true)).toBeNull()
    expect(cropShortcut(key('Enter', { target: element('button') }), true)).toBeNull()
    expect(cropShortcut(key('Escape', { target: element('button') }), true)).toBe('cancel')
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      expect(cropShortcut(key('Enter', { [modifier]: true }), true)).toBeNull()
    }
    expect(cropShortcut(key('Enter', { repeat: true }), true)).toBeNull()
    expect(cropShortcut(key('Enter', { isComposing: true }), true)).toBeNull()
    expect(cropShortcut(key('Escape', { defaultPrevented: true }), true)).toBeNull()
    expect(cropShortcut(key('Delete'), true)).toBeNull()
  })
})
