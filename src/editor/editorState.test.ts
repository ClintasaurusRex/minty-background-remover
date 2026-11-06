import { describe, expect, it } from 'vitest'
import { viewportToImage, viewportToPixel } from '../canvas/coordinates'
import { planFrame } from '../canvas/rendering'
import { MAX_ZOOM, MIN_ZOOM } from '../canvas/viewport'
import { createImportError } from '../image/import/errors'
import { fakeImageData } from '../image/import/testFixtures'
import { copyPixelData, createPixelBuffer } from '../image/pixelBuffer'
import { createSelectionMask } from '../image/selection/selectionMask'
import { selectAll } from '../image/selection/selectionOperations'
import { maskBytes, maskRows } from '../image/selection/testFixtures'
import {
  type DocumentVersion,
  type EditorAction,
  type EditorImportResult,
  type EditorState,
  type MagicWandOperation,
  type WorkspaceMetrics,
  displayViewport,
  documentVersion,
  editorReducer,
  initialEditorState,
  isImporting,
} from './editorState'
import { createEditedDocument, createImageDocument } from './imageDocument'
import type { FloodMode, SelectionMask, SelectionMode, ToolId } from './types'

function documentOf(width: number, height: number, name = 'a.png') {
  return createImageDocument({
    name,
    format: 'png',
    source: 'file-picker',
    fileSizeBytes: 100,
    pixels: fakeImageData(width, height),
  })
}

function succeeded(width: number, height: number, name?: string): EditorImportResult {
  return { ok: true, document: documentOf(width, height, name), bitmap: { width, height, close: () => {} } }
}

const failed: EditorImportResult = { ok: false, error: createImportError('decode-failed', 'bad data') }

const WORKSPACE: WorkspaceMetrics = { size: { width: 1000, height: 600 }, devicePixelRatio: 1 }

function reduce(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state)
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })

/** `state` with its image edited the copy-on-write way: the same image, unchanged pixels, a new revision. */
function withEditedPixels(state: EditorState): EditorState {
  const document = state.document!
  const pixels = createPixelBuffer(document.width, document.height, copyPixelData(document.pixels))
  return { ...state, document: createEditedDocument(document, pixels) }
}

describe('editorReducer: imports', () => {
  it('starts with no document, viewport or error', () => {
    expect(initialEditorState).toEqual({
      document: null,
      documentBitmap: null,
      viewport: null,
      workspace: null,
      placeOnNextResize: false,
      pendingImportId: null,
      importError: null,
      pan: null,
      importNotice: null,
      activeTool: null,
      magicWand: { tolerance: 20, floodMode: 'contiguous', selectionMode: 'new' },
      selection: null,
      lastMagicWandOperation: null,
      history: {
        limits: { maxEntries: 25, maxBytes: 256 * 1024 * 1024 },
        version: null,
        undo: [],
        redo: [],
        retainedBytes: 0,
      },
      editError: null,
      editDepth: 0,
      editNotice: null,
      editFeedbackId: 0,
    })
    expect(isImporting(initialEditorState)).toBe(false)
  })

  it('tracks an import in progress', () => {
    const state = reduce(measured, { type: 'import-started', importId: 1 })
    expect(isImporting(state)).toBe(true)
    expect(state.pendingImportId).toBe(1)
  })

  it('opens a successful import centred at 100% when it fits', () => {
    const result = succeeded(400, 200)
    const state = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result },
    )
    expect(result.ok && state.document).toBe(result.ok && result.document)
    expect(result.ok && state.documentBitmap).toBe(result.ok && result.bitmap)
    expect(state.viewport).toEqual({ zoom: 1, offset: { x: 300, y: 200 } })
    expect(isImporting(state)).toBe(false)
    expect(state.importError).toBeNull()
  })

  it('fits a large image inside the workspace without changing its dimensions', () => {
    const state = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(3840, 2160) },
    )
    expect(state.document).toMatchObject({ width: 3840, height: 2160 })
    expect(state.viewport!.zoom).toBeCloseTo((1000 - 48) / 3840, 12)
  })

  it('keeps the current document and viewport when an import fails', () => {
    const opened = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200) },
    )
    const state = reduce(
      opened,
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: failed },
    )
    expect(state.document).toBe(opened.document)
    expect(state.documentBitmap).toBe(opened.documentBitmap)
    expect(state.viewport).toBe(opened.viewport)
    expect(state.importError).toEqual(failed.ok ? null : failed.error)
    expect(isImporting(state)).toBe(false)
  })

  it('replaces the document and its viewport on a new successful import', () => {
    const state = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200, 'first.png') },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(100, 100, 'second.png') },
    )
    expect(state.document?.name).toBe('second.png')
    expect(state.viewport).toEqual({ zoom: 1, offset: { x: 450, y: 250 } })
  })

  it('ignores an older import that finishes after a newer one started', () => {
    const state = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(100, 100, 'newer.png') },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200, 'older.png') },
    )
    expect(state.document?.name).toBe('newer.png')
    expect(isImporting(state)).toBe(false)
  })

  it('ignores an older result while the newer import is still running', () => {
    const state = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200, 'older.png') },
    )
    expect(state.document).toBeNull()
    expect(state.pendingImportId).toBe(2)

    const failedLate = reduce(state, { type: 'import-finished', importId: 1, result: failed })
    expect(failedLate).toBe(state)
  })

  it('clears an error when it is dismissed or a new import starts', () => {
    const errored = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: failed },
    )
    expect(errored.importError?.code).toBe('decode-failed')
    expect(reduce(errored, { type: 'import-error-dismissed' }).importError).toBeNull()
    expect(reduce(errored, { type: 'import-started', importId: 2 }).importError).toBeNull()
    expect(reduce(measured, { type: 'import-error-dismissed' })).toBe(measured)
  })
})

describe('editorReducer: workspace size', () => {
  it('places an image that arrived before the workspace was measured', () => {
    const unmeasured = reduce(
      initialEditorState,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200) },
    )
    expect(unmeasured.viewport).toBeNull()
    const state = reduce(unmeasured, { type: 'workspace-resized', workspace: WORKSPACE })
    expect(state.viewport).toEqual({ zoom: 1, offset: { x: 300, y: 200 } })
  })

  it('does not place an image in an empty workspace', () => {
    const state = reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace: { size: { width: 0, height: 0 }, devicePixelRatio: 1 } },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200) },
    )
    expect(state.viewport).toBeNull()
  })

  it('keeps the image centre in place and the zoom unchanged on resize', () => {
    const opened = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(3840, 2160) },
      // The Magic Wand options row appears.
      { type: 'workspace-resized', workspace: { size: { width: 1000, height: 561 }, devicePixelRatio: 1 } },
    )
    const state = reduce(opened, {
      type: 'workspace-resized',
      workspace: { size: { width: 1200, height: 661 }, devicePixelRatio: 1 },
    })
    expect(state.viewport!.zoom).toBe(opened.viewport!.zoom)
    expect(state.viewport!.offset.x).toBeCloseTo(opened.viewport!.offset.x + 100, 9)
    expect(state.viewport!.offset.y).toBeCloseTo(opened.viewport!.offset.y + 50, 9)
  })

  describe('when the first image makes the options row appear', () => {
    // The Magic Wand options row takes 39 CSS px from the workspace, or 75 px where it wraps.
    const withRow = (height: number): EditorAction => ({
      type: 'workspace-resized',
      workspace: { size: { width: WORKSPACE.size.width, height }, devicePixelRatio: 1 },
    })
    const firstImage = (width: number, height: number, from: EditorState = measured) =>
      reduce(from, { type: 'import-started', importId: 1 }, { type: 'import-finished', importId: 1, result: succeeded(width, height) })
    const fitted = (state: EditorState) => reduce(state, { type: 'zoom-fitted' }).viewport

    it('places the image again for the smaller workspace, exactly as Fit does', () => {
      for (const rowHeight of [39, 75]) {
        const opened = firstImage(3840, 2400)
        expect(opened.placeOnNextResize).toBe(true)
        const state = reduce(opened, withRow(600 - rowHeight))
        expect(state.placeOnNextResize).toBe(false)
        expect(state.viewport).toEqual(fitted(state))
        // Fitted with the 24 px margin, so it never overflows the workspace.
        const { zoom, offset } = state.viewport!
        expect(offset.y).toBe(24)
        expect(offset.y + 2400 * zoom).toBeLessThanOrEqual(600 - rowHeight - 24 + 1e-9)
      }
    })

    it('centres an image shown at 100% exactly as Fit does, with no half-pixel shift', () => {
      // A 39 px row would shift a centred image by 19.5 px, rounded once on import and once on display.
      const opened = firstImage(400, 201, reduce(initialEditorState, withRow(601)))
      const state = reduce(opened, withRow(562))
      expect(state.viewport).toEqual(fitted(state))
      expect(displayViewport(state)).toEqual(state.viewport)
    })

    it('keeps the centre on later resizes', () => {
      const state = reduce(firstImage(3840, 2400), withRow(561))
      const resized = reduce(state, withRow(461))
      expect(resized.viewport!.zoom).toBe(state.viewport!.zoom)
      expect(resized.viewport!.offset.y).toBeCloseTo(state.viewport!.offset.y - 50, 9)
    })

    it('keeps the centre for later images, as the row is already shown', () => {
      let state = reduce(firstImage(400, 200), withRow(561))
      state = reduce(state, { type: 'import-started', importId: 2 }, { type: 'import-finished', importId: 2, result: succeeded(3840, 2400) })
      expect(state.placeOnNextResize).toBe(false)
      const resized = reduce(state, withRow(461))
      expect(resized.viewport!.zoom).toBe(state.viewport!.zoom)
      expect(resized.viewport!.offset.y).toBeCloseTo(state.viewport!.offset.y - 50, 9)
    })

    it('keeps a view changed before the resize', () => {
      for (const change of [
        { type: 'zoom-stepped', direction: 1 },
        { type: 'wheel-panned', delta: { x: 0, y: 30 } },
        { type: 'pan-drag-started' },
      ] satisfies EditorAction[]) {
        const state = reduce(firstImage(3840, 2400), change)
        expect(state.placeOnNextResize).toBe(false)
        const resized = reduce(state, withRow(561))
        expect(resized.viewport!.zoom).toBe(state.viewport!.zoom)
        expect(resized.viewport!.offset.y).toBeCloseTo(state.viewport!.offset.y - 19.5, 9)
      }
    })

    it('is not set by a failed import', () => {
      const state = reduce(measured, { type: 'import-started', importId: 1 }, { type: 'import-finished', importId: 1, result: failed })
      expect(state.placeOnNextResize).toBe(false)
    })
  })

  it('returns the same state when nothing changed', () => {
    expect(reduce(measured, { type: 'workspace-resized', workspace: { ...WORKSPACE } })).toBe(measured)
  })
})

describe('displayViewport', () => {
  it('is null until a viewport exists', () => {
    expect(displayViewport(initialEditorState)).toBeNull()
    expect(displayViewport(measured)).toBeNull()
  })

  it('stores initial placement already snapped, so what is shown is what is stored', () => {
    const state = reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace: { size: { width: 1001, height: 601 }, devicePixelRatio: 1.25 } },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200) },
    )
    expect(displayViewport(state)).toEqual(state.viewport)
    // Centred (300.5, 200.5) moves by no more than half a device pixel.
    expect(Math.abs(state.viewport!.offset.x - 300.5) * 1.25).toBeLessThanOrEqual(0.5)
    expect(Math.abs(state.viewport!.offset.y - 200.5) * 1.25).toBeLessThanOrEqual(0.5)
  })

  it('snaps wheel-zoomed viewports for display without changing the stored viewport', () => {
    const opened = reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace: { size: { width: 1001, height: 601 }, devicePixelRatio: 1.25 } },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200) },
    )
    const state = reduce(opened, { type: 'zoom-scaled', anchor: { x: 333.3, y: 222.2 }, factor: 1.7 })
    const stored = state.viewport!
    const display = displayViewport(state)!
    expect(display.zoom).toBe(stored.zoom)
    for (const [value, exact] of [
      [display.offset.x, stored.offset.x],
      [display.offset.y, stored.offset.y],
    ]) {
      expect(Math.abs(value * 1.25 - Math.round(value * 1.25))).toBeLessThan(1e-9)
      expect(Math.abs(value - exact) * 1.25).toBeLessThanOrEqual(0.5)
    }
  })

  it('does not accumulate snapping across repeated resizes', () => {
    let state = reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace: { size: { width: 1000, height: 600 }, devicePixelRatio: 1.5 } },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(401, 201) },
      // The Magic Wand options row appears.
      { type: 'workspace-resized', workspace: { size: { width: 1000, height: 561 }, devicePixelRatio: 1.5 } },
    )
    const start = state.viewport!
    for (let i = 0; i < 50; i++) {
      const width = i % 2 === 0 ? 1000.4 : 1000
      state = reduce(state, {
        type: 'workspace-resized',
        workspace: { size: { width, height: 561 }, devicePixelRatio: 1.5 },
      })
    }
    expect(state.viewport!.offset.x).toBeCloseTo(start.offset.x, 9)
  })
})

describe('editorReducer: zoom', () => {
  function opened(width: number, height: number, workspace: WorkspaceMetrics = WORKSPACE) {
    return reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(width, height) },
    )
  }

  /** The image point shown under a viewport point, using the display (snapped) viewport. */
  function imagePointUnder(state: EditorState, point: { x: number; y: number }) {
    const view = displayViewport(state)!
    return viewportToImage(view, point)
  }

  it('does nothing without an image', () => {
    for (const action of [
      { type: 'zoom-scaled', anchor: { x: 1, y: 1 }, factor: 2 },
      { type: 'zoom-stepped', direction: 1 },
      { type: 'zoom-fitted' },
      { type: 'zoom-actual-size' },
    ] as const) {
      expect(reduce(measured, action)).toBe(measured)
    }
  })

  it('keeps the image point under the pointer fixed', () => {
    const state = opened(3840, 2160)
    const anchor = { x: 613.4, y: 287.9 }
    const before = viewportToImage(state.viewport!, anchor)
    let zoomed = state
    for (const factor of [1.25, 1.25, 3, 0.4, 7.7]) {
      zoomed = reduce(zoomed, { type: 'zoom-scaled', anchor, factor })
      const after = viewportToImage(zoomed.viewport!, anchor)
      expect(after.x).toBeCloseTo(before.x, 9)
      expect(after.y).toBeCloseTo(before.y, 9)
    }
  })

  it('keeps what the user saw under the pointer there, to within snapping precision', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2, 2.25]) {
      let state = opened(1000, 700, { size: { width: 1003.2, height: 611.7 }, devicePixelRatio })
      const startZoom = state.viewport!.zoom
      const anchor = { x: 377.3, y: 201.6 }
      // The image point drawn under the pointer before zooming.
      const target = imagePointUnder(state, anchor)
      for (let i = 0; i < 12; i++) {
        state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1.3 })
        const view = displayViewport(state)!
        const drawnAt = { x: view.offset.x + target.x * view.zoom, y: view.offset.y + target.y * view.zoom }
        // Snapping can put the point up to half a device pixel from the pointer, measured
        // at the starting zoom (where the user aimed), plus half a device pixel now.
        const bound = 0.5 * (view.zoom / startZoom) + 0.5 + 1e-6
        expect(Math.abs(drawnAt.x - anchor.x) * devicePixelRatio).toBeLessThanOrEqual(bound)
        expect(Math.abs(drawnAt.y - anchor.y) * devicePixelRatio).toBeLessThanOrEqual(bound)
        // In image pixels that is under one screen pixel at the starting zoom.
        expect(Math.abs(viewportToImage(view, anchor).x - target.x) * startZoom * devicePixelRatio).toBeLessThanOrEqual(
          0.5 + (0.5 * startZoom) / view.zoom + 1e-6,
        )
      }
    }
  })

  it('returns to the same place after zooming in and back out, without drift', () => {
    const start = opened(3840, 2160, { size: { width: 1001, height: 601 }, devicePixelRatio: 1.25 })
    let state = start
    const anchor = { x: 123.45, y: 456.78 }
    for (let cycle = 0; cycle < 100; cycle++) {
      for (let i = 0; i < 6; i++) state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1.25 })
      for (let i = 0; i < 6; i++) state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1 / 1.25 })
    }
    expect(state.viewport!.zoom).toBeCloseTo(start.viewport!.zoom, 12)
    expect(state.viewport!.offset.x).toBeCloseTo(start.viewport!.offset.x, 6)
    expect(state.viewport!.offset.y).toBeCloseTo(start.viewport!.offset.y, 6)
    const [end, begin] = [displayViewport(state)!, displayViewport(start)!]
    expect(end.zoom).toBeCloseTo(begin.zoom, 12)
    expect(end.offset.x).toBeCloseTo(begin.offset.x, 9)
    expect(end.offset.y).toBeCloseTo(begin.offset.y, 9)
  })

  it('clamps to 1% and 3200% without moving the image at the limits', () => {
    let state = opened(400, 200)
    const anchor = { x: 10, y: 10 }
    state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1e6 })
    expect(state.viewport!.zoom).toBe(MAX_ZOOM)
    expect(reduce(state, { type: 'zoom-scaled', anchor, factor: 2 })).toBe(state)
    expect(reduce(state, { type: 'zoom-stepped', direction: 1 })).toBe(state)

    state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1e-9 })
    expect(state.viewport!.zoom).toBe(MIN_ZOOM)
    expect(reduce(state, { type: 'zoom-scaled', anchor, factor: 0.5 })).toBe(state)
    expect(reduce(state, { type: 'zoom-stepped', direction: -1 })).toBe(state)
  })

  it('ignores invalid wheel factors', () => {
    const state = opened(400, 200)
    for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reduce(state, { type: 'zoom-scaled', anchor: { x: 1, y: 1 }, factor })).toBe(state)
    }
  })

  it('steps through the zoom stops about the workspace centre', () => {
    let state = opened(400, 200)
    const centre = { x: 500, y: 300 }
    const target = viewportToImage(state.viewport!, centre)
    const zooms: number[] = []
    for (let i = 0; i < 3; i++) {
      state = reduce(state, { type: 'zoom-stepped', direction: 1 })
      zooms.push(state.viewport!.zoom)
      const after = viewportToImage(state.viewport!, centre)
      expect(after.x).toBeCloseTo(target.x, 9)
      expect(after.y).toBeCloseTo(target.y, 9)
    }
    expect(zooms).toEqual([1.5, 2, 3])
    state = reduce(state, { type: 'zoom-stepped', direction: -1 }, { type: 'zoom-stepped', direction: -1 })
    expect(state.viewport!.zoom).toBe(1.5)
  })

  it('steps from an off-ladder zoom to the next stop', () => {
    let state = opened(400, 200)
    state = reduce(state, { type: 'zoom-scaled', anchor: { x: 0, y: 0 }, factor: 1.1 })
    expect(reduce(state, { type: 'zoom-stepped', direction: 1 }).viewport!.zoom).toBe(1.5)
    expect(reduce(state, { type: 'zoom-stepped', direction: -1 }).viewport!.zoom).toBe(1)
  })

  it('fits a large image and centres it, after any zooming', () => {
    const start = opened(3840, 2160)
    const zoomed = reduce(start, { type: 'zoom-scaled', anchor: { x: 50, y: 70 }, factor: 9 })
    const fitted = reduce(zoomed, { type: 'zoom-fitted' })
    expect(fitted.viewport).toEqual(start.viewport)
    expect(fitted.viewport!.zoom).toBeLessThan(1)
  })

  it('never enlarges a small image beyond 100% when fitting', () => {
    const start = opened(40, 30)
    const zoomed = reduce(start, { type: 'zoom-scaled', anchor: { x: 1, y: 1 }, factor: 8 })
    const fitted = reduce(zoomed, { type: 'zoom-fitted' })
    expect(fitted.viewport).toEqual({ zoom: 1, offset: { x: 480, y: 285 } })
  })

  it('shows 100% about the workspace centre', () => {
    const start = opened(3840, 2160)
    const actual = reduce(start, { type: 'zoom-actual-size' })
    expect(actual.viewport!.zoom).toBe(1)
    // The image point at the workspace centre stays there (to within snapping).
    const before = viewportToImage(start.viewport!, { x: 500, y: 300 })
    const after = viewportToImage(actual.viewport!, { x: 500, y: 300 })
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5)
    expect(displayViewport(actual)).toEqual(actual.viewport)
    expect(reduce(actual, { type: 'zoom-actual-size' })).toBe(actual)
  })

  it('never changes the document or its pixels', () => {
    const start = opened(3840, 2160)
    const state = reduce(
      start,
      { type: 'zoom-scaled', anchor: { x: 5, y: 5 }, factor: 30 },
      { type: 'zoom-stepped', direction: -1 },
      { type: 'zoom-fitted' },
      { type: 'zoom-actual-size' },
    )
    expect(state.document).toBe(start.document)
    expect(state.document).toMatchObject({ width: 3840, height: 2160 })
    expect(state.documentBitmap).toBe(start.documentBitmap)
  })

  it('hit-tests the pixel that is drawn under the pointer', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      let state = opened(64, 48, { size: { width: 801.6, height: 599.2 }, devicePixelRatio })
      state = reduce(state, { type: 'zoom-scaled', anchor: { x: 400.3, y: 300.7 }, factor: 7.3 })
      const view = displayViewport(state)!
      const plan = planFrame({ imageSize: { width: 64, height: 48 }, viewport: view, viewportSize: state.workspace!.size, devicePixelRatio })
      const { a, e, f } = plan.image!.transform
      // Check device pixel centres across the canvas: the pixel drawn there (by the
      // canvas transform) must be the pixel hit-testing reports for that position.
      for (let dy = 0.5; dy < plan.backingStore.height; dy += 37) {
        for (let dx = 0.5; dx < plan.backingStore.width; dx += 41) {
          const drawn = { x: Math.floor((dx - e) / a), y: Math.floor((dy - f) / a) }
          const hit = viewportToPixel(view, { x: dx / devicePixelRatio, y: dy / devicePixelRatio }, { width: 64, height: 48 })
          if (drawn.x < 0 || drawn.y < 0 || drawn.x >= 64 || drawn.y >= 48) expect(hit).toBeNull()
          else expect(hit).toEqual(drawn)
        }
      }
    }
  })
})

describe('editorReducer: pixel under the pointer', () => {
  it('keeps the exact pixel under the pointer when wheel zooming from a placed image', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      // An odd workspace size centres the image on a half pixel before snapping.
      let state = reduce(
        initialEditorState,
        { type: 'workspace-resized', workspace: { size: { width: 1440, height: 761 }, devicePixelRatio } },
        { type: 'import-started', importId: 1 },
        { type: 'import-finished', importId: 1, result: succeeded(256, 256) },
      )
      const view = displayViewport(state)!
      // Pointer 0.3 px into pixel (40, 200), close to its edge.
      const anchor = { x: view.offset.x + 40.6, y: view.offset.y + 200.3 }
      const size = { width: 256, height: 256 }
      expect(viewportToPixel(view, anchor, size)).toEqual({ x: 40, y: 200 })
      for (let i = 0; i < 16; i++) {
        state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1.25 })
        expect(viewportToPixel(displayViewport(state)!, anchor, size)).toEqual({ x: 40, y: 200 })
      }
    }
  })
})

describe('editorReducer: panning', () => {
  function opened(width: number, height: number, workspace: WorkspaceMetrics = WORKSPACE) {
    return reduce(
      initialEditorState,
      { type: 'workspace-resized', workspace },
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(width, height) },
    )
  }
  const wheelPan = (x: number, y: number): EditorAction => ({ type: 'wheel-panned', delta: { x, y } })
  const drag = (x: number, y: number): EditorAction => ({ type: 'pan-dragged', delta: { x, y } })

  it('does nothing without an image', () => {
    for (const action of [wheelPan(10, 10), { type: 'pan-drag-started' } as const, drag(5, 5)]) {
      expect(reduce(measured, action)).toBe(measured)
    }
    expect(reduce(measured, { type: 'pan-drag-started' }).pan).toBeNull()
  })

  it('moves the image vertically and horizontally with the wheel', () => {
    const start = opened(3840, 2160)
    const { x, y } = start.viewport!.offset
    expect(reduce(start, wheelPan(0, -100)).viewport!.offset).toEqual({ x, y: y - 100 })
    expect(reduce(start, wheelPan(100, 0)).viewport!.offset).toEqual({ x: x + 100, y })
    expect(reduce(start, wheelPan(12.5, -3.25)).viewport!.offset).toEqual({ x: x + 12.5, y: y - 3.25 })
  })

  it('never changes the zoom, the document or its dimensions', () => {
    const start = opened(3840, 2160)
    const state = reduce(start, wheelPan(37, -12), { type: 'pan-drag-started' }, drag(-80, 45), { type: 'pan-drag-ended' })
    expect(state.viewport!.zoom).toBe(start.viewport!.zoom)
    expect(state.document).toBe(start.document)
    expect(state.document).toMatchObject({ width: 3840, height: 2160 })
    expect(state.documentBitmap).toBe(start.documentBitmap)
  })

  it('adds up small trackpad movements exactly, with no drift', () => {
    const start = opened(400, 200, { size: { width: 1000, height: 600 }, devicePixelRatio: 1.25 })
    let state = start
    for (let i = 0; i < 400; i++) state = reduce(state, wheelPan(0.3, -0.7))
    expect(state.viewport!.offset.x).toBeCloseTo(start.viewport!.offset.x + 120, 9)
    expect(state.viewport!.offset.y).toBeCloseTo(start.viewport!.offset.y - 280, 9)
    for (let i = 0; i < 400; i++) state = reduce(state, wheelPan(-0.3, 0.7))
    expect(state.viewport!.offset.x).toBeCloseTo(start.viewport!.offset.x, 9)
    expect(displayViewport(state)).toEqual(displayViewport(start))
  })

  it('stops panning so some of the image stays visible, at any zoom', () => {
    for (const factor of [1, 0.1, 4, 128]) {
      let state = reduce(opened(400, 200), { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor })
      const zoom = state.viewport!.zoom
      state = reduce(state, wheelPan(1e6, 1e6))
      const shownWidth = 400 * zoom
      expect(state.viewport!.offset.x).toBeCloseTo(1000 - Math.min(64, shownWidth), 9)
      state = reduce(state, wheelPan(-1e7, -1e7))
      expect(state.viewport!.offset.x + shownWidth).toBeCloseTo(Math.min(64, shownWidth), 9)
      expect(state.viewport!.zoom).toBe(zoom)
    }
  })

  it('drags the image with the pointer, stored snapped to device pixels', () => {
    const start = opened(3840, 2160, { size: { width: 1001, height: 601 }, devicePixelRatio: 1.25 })
    let state = reduce(start, { type: 'pan-drag-started' })
    expect(state.pan).toEqual({ origin: start.viewport, delta: { x: 0, y: 0 } })
    state = reduce(state, drag(10, 7))
    const { offset } = state.viewport!
    expect(Math.abs(offset.x - (start.viewport!.offset.x + 10)) * 1.25).toBeLessThanOrEqual(0.5)
    expect(Math.abs(offset.y - (start.viewport!.offset.y + 7)) * 1.25).toBeLessThanOrEqual(0.5)
    expect(displayViewport(state)).toEqual(state.viewport)
    expect(state.pan?.delta).toEqual({ x: 10, y: 7 })
  })

  it('tracks the pointer without accumulating rounding over many moves', () => {
    const start = opened(3840, 2160, { size: { width: 1001, height: 601 }, devicePixelRatio: 1.5 })
    let state = reduce(start, { type: 'pan-drag-started' })
    for (let i = 1; i <= 500; i++) state = reduce(state, drag(i * 0.37, -i * 0.21))
    // Only the final total matters: 185, -105.
    const direct = reduce(reduce(start, { type: 'pan-drag-started' }), drag(500 * 0.37, -500 * 0.21))
    expect(state.viewport).toEqual(direct.viewport)
    // Dragging back to the start returns exactly.
    state = reduce(state, drag(0, 0), { type: 'pan-drag-ended' })
    expect(state.viewport).toEqual(start.viewport)
    expect(state.pan).toBeNull()
  })

  it('limits drags too, without a jump at the start', () => {
    const start = opened(400, 200)
    let state = reduce(start, { type: 'pan-drag-started' }, drag(5000, 0))
    expect(state.viewport!.offset.x).toBe(1000 - 64)
    state = reduce(state, drag(0, 0))
    expect(state.viewport).toEqual(start.viewport)
  })

  it('ignores moves when no drag is in progress, and ends cleanly', () => {
    const start = opened(400, 200)
    expect(reduce(start, drag(50, 50))).toBe(start)
    expect(reduce(start, { type: 'pan-drag-ended' })).toBe(start)
  })

  it('continues a drag smoothly after a zoom during the drag', () => {
    const start = opened(3840, 2160)
    let state = reduce(start, { type: 'pan-drag-started' }, drag(30, 20))
    state = reduce(state, { type: 'zoom-scaled', anchor: { x: 400, y: 300 }, factor: 2 })
    const zoomed = state.viewport!
    state = reduce(state, drag(40, 25))
    // The extra 10, 5 of pointer movement moves the image by 10, 5 from where the zoom left it.
    expect(state.viewport!.offset.x).toBeCloseTo(zoomed.offset.x + 10, 9)
    expect(state.viewport!.offset.y).toBeCloseTo(zoomed.offset.y + 5, 9)
    expect(state.viewport!.zoom).toBe(zoomed.zoom)
  })

  it('ends a drag when a new image is opened', () => {
    const dragging = reduce(opened(400, 200), { type: 'pan-drag-started' })
    const state = reduce(
      dragging,
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(100, 100) },
    )
    expect(state.pan).toBeNull()
    expect(reduce(state, drag(100, 100))).toBe(state)
  })

  it('keeps Ctrl + wheel zoom anchored at the pointer after panning', () => {
    let state = opened(256, 256, { size: { width: 1440, height: 761 }, devicePixelRatio: 1.25 })
    state = reduce(state, { type: 'pan-drag-started' }, drag(-123, 47), { type: 'pan-drag-ended' })
    const view = displayViewport(state)!
    const anchor = { x: view.offset.x + 40.6 * view.zoom, y: view.offset.y + 200.4 * view.zoom }
    const size = { width: 256, height: 256 }
    for (let i = 0; i < 12; i++) {
      state = reduce(state, { type: 'zoom-scaled', anchor, factor: 1.25 })
      expect(viewportToPixel(displayViewport(state)!, anchor, size)).toEqual({ x: 40, y: 200 })
    }
  })

  it('brings the image back if zooming about empty space would lose it', () => {
    const start = opened(400, 200)
    // Zoom in a long way about the far left of the workspace, away from the image.
    const state = reduce(start, { type: 'zoom-scaled', anchor: { x: 1, y: 300 }, factor: 32 })
    const { offset, zoom } = state.viewport!
    expect(zoom).toBe(32)
    expect(offset.x).toBeLessThan(1000)
    expect(offset.x + 400 * zoom).toBeGreaterThan(0)
  })

  it('brings the image back if the workspace shrinks around it', () => {
    let state = opened(400, 200)
    state = reduce(state, wheelPan(5000, 0))
    state = reduce(state, { type: 'workspace-resized', workspace: { size: { width: 400, height: 600 }, devicePixelRatio: 1 } })
    expect(state.viewport!.offset.x).toBeLessThan(400)
  })

  it('hit-tests the drawn pixel after repeated panning at fractional ratios', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      let state = opened(64, 48, { size: { width: 801.6, height: 599.2 }, devicePixelRatio })
      state = reduce(state, { type: 'zoom-scaled', anchor: { x: 400.3, y: 300.7 }, factor: 7.3 })
      for (let i = 0; i < 25; i++) state = reduce(state, wheelPan(3.7, -2.9))
      state = reduce(state, { type: 'pan-drag-started' }, drag(-41.3, 17.9), { type: 'pan-drag-ended' })
      const view = displayViewport(state)!
      const plan = planFrame({ imageSize: { width: 64, height: 48 }, viewport: view, viewportSize: state.workspace!.size, devicePixelRatio })
      const { a, e, f } = plan.image!.transform
      for (let dy = 0.5; dy < plan.backingStore.height; dy += 37) {
        for (let dx = 0.5; dx < plan.backingStore.width; dx += 41) {
          const drawn = { x: Math.floor((dx - e) / a), y: Math.floor((dy - f) / a) }
          const hit = viewportToPixel(view, { x: dx / devicePixelRatio, y: dy / devicePixelRatio }, { width: 64, height: 48 })
          if (drawn.x < 0 || drawn.y < 0 || drawn.x >= 64 || drawn.y >= 48) expect(hit).toBeNull()
          else expect(hit).toEqual(drawn)
        }
      }
    }
  })
})

describe('editorReducer: dropped files', () => {
  function opened() {
    return reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: succeeded(400, 200, 'first.png') },
    )
  }

  it('records ignored dropped files for the notice, and clears them on the next import', () => {
    const state = reduce(opened(), { type: 'import-started', importId: 2, ignoredFileCount: 3 })
    expect(state.importNotice).toEqual({ kind: 'ignored-files', count: 3 })
    const finished = reduce(state, { type: 'import-finished', importId: 2, result: succeeded(10, 10) })
    expect(finished.importNotice).toEqual({ kind: 'ignored-files', count: 3 })
    expect(reduce(finished, { type: 'import-started', importId: 3 }).importNotice).toBeNull()
    expect(reduce(finished, { type: 'import-notice-dismissed' }).importNotice).toBeNull()
    const none = opened()
    expect(reduce(none, { type: 'import-notice-dismissed' })).toBe(none)
  })

  it('shows a clipboard notice without affecting the image or an import in progress', () => {
    const start = reduce(opened(), { type: 'import-started', importId: 2 })
    const state = reduce(start, { type: 'import-notice-shown', notice: { kind: 'no-clipboard-image' } })
    expect(state.importNotice).toEqual({ kind: 'no-clipboard-image' })
    expect(state.importError).toBeNull()
    expect(state.document).toBe(start.document)
    expect(state.pendingImportId).toBe(2)
    const finished = reduce(state, { type: 'import-finished', importId: 2, result: succeeded(10, 10, 'second.png') })
    expect(finished.document?.name).toBe('second.png')
  })

  it('keeps the current image when a dropped file fails to import', () => {
    const start = opened()
    const state = reduce(
      start,
      { type: 'import-started', importId: 2, ignoredFileCount: 1 },
      { type: 'import-finished', importId: 2, result: failed },
    )
    expect(state.document).toBe(start.document)
    expect(state.viewport).toBe(start.viewport)
    expect(state.importError).not.toBeNull()
  })

  it('rejects a drop with nothing to open, keeping the image and any import in progress', () => {
    const start = reduce(opened(), { type: 'import-started', importId: 2 })
    const error = createImportError('unsupported-format')
    const rejected = reduce(start, { type: 'import-rejected', error })
    expect(rejected.importError).toBe(error)
    expect(rejected.document).toBe(start.document)
    expect(rejected.pendingImportId).toBe(2)
    // The import that was running still completes.
    const finished = reduce(rejected, { type: 'import-finished', importId: 2, result: succeeded(10, 10, 'valid.png') })
    expect(finished.document?.name).toBe('valid.png')
  })

  it('opens a dropped image fitted and centred, replacing any zoom, pan or drag in progress', () => {
    let state = reduce(
      opened(),
      { type: 'zoom-scaled', anchor: { x: 10, y: 10 }, factor: 6 },
      { type: 'wheel-panned', delta: { x: 40, y: -30 } },
      { type: 'pan-drag-started' },
    )
    state = reduce(
      state,
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(100, 100, 'dropped.png') },
    )
    expect(state.document?.name).toBe('dropped.png')
    expect(state.viewport).toEqual({ zoom: 1, offset: { x: 450, y: 250 } })
    expect(state.pan).toBeNull()
  })
})

describe('editorReducer: tools and Magic Wand options', () => {
  function opened(width = 4, height = 3, importId = 1) {
    return reduce(
      measured,
      { type: 'import-started', importId },
      { type: 'import-finished', importId, result: succeeded(width, height) },
    )
  }

  it('has no active tool and default Magic Wand options before an image is open', () => {
    expect(initialEditorState.activeTool).toBeNull()
    expect(initialEditorState.magicWand).toEqual({ tolerance: 20, floodMode: 'contiguous', selectionMode: 'new' })
    expect(initialEditorState.selection).toBeNull()
  })

  it('activates the Magic Wand when an image opens successfully', () => {
    const state = opened()
    expect(state.activeTool).toBe('magic-wand')
    expect(state.magicWand).toBe(initialEditorState.magicWand)
  })

  it('does not activate a tool when an import fails, is rejected or is superseded', () => {
    const failedImport = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-finished', importId: 1, result: failed },
    )
    expect(failedImport.activeTool).toBeNull()

    const rejected = reduce(measured, { type: 'import-rejected', error: createImportError('unsupported-format', 'folder') })
    expect(rejected.activeTool).toBeNull()

    const superseded = reduce(
      measured,
      { type: 'import-started', importId: 1 },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 1, result: succeeded(4, 3) },
    )
    expect(superseded.activeTool).toBeNull()
    expect(superseded.document).toBeNull()
  })

  /**
   * Only the Magic Wand is available in Phase 2, so another active tool cannot be reached
   * through actions yet. These tests start from such a state directly.
   */
  function withCropActive(state: EditorState): EditorState {
    return { ...state, activeTool: 'crop' }
  }

  it('ignores tool changes until an image is open', () => {
    expect(reduce(measured, { type: 'tool-selected', tool: 'magic-wand' })).toBe(measured)
  })

  it('activates an available tool once an image is open', () => {
    const state = reduce(withCropActive(opened()), { type: 'tool-selected', tool: 'magic-wand' })
    expect(state.activeTool).toBe('magic-wand')
    expect(reduce(state, { type: 'tool-selected', tool: 'magic-wand' })).toBe(state)
  })

  it('ignores tools that are not available yet', () => {
    const state = opened()
    for (const tool of ['crop', 'replace-color', 'auto-trim'] as const) {
      expect(reduce(state, { type: 'tool-selected', tool })).toBe(state)
    }
  })

  it('ignores unknown and malformed tool ids', () => {
    const state = opened()
    for (const tool of ['lasso', '', 'Magic-Wand', 'magic-wand ', null, undefined, 3, {}]) {
      expect(reduce(state, { type: 'tool-selected', tool: tool as ToolId })).toBe(state)
    }
  })

  it('reactivates the Magic Wand when another image opens', () => {
    const state = reduce(
      withCropActive(opened()),
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(5, 5) },
    )
    expect(state.activeTool).toBe('magic-wand')
  })

  it('keeps the active tool when an import fails', () => {
    const state = reduce(
      withCropActive(opened()),
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: failed },
    )
    expect(state.activeTool).toBe('crop')
  })

  it('changes the tolerance, flood mode and selection mode', () => {
    const state = reduce(
      opened(),
      { type: 'magic-wand-tolerance-changed', tolerance: 35 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' },
    )
    expect(state.magicWand).toEqual({ tolerance: 35, floodMode: 'global', selectionMode: 'subtract' })
  })

  it('accepts option changes before an image is open', () => {
    const state = reduce(
      initialEditorState,
      { type: 'magic-wand-tolerance-changed', tolerance: 0 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' },
    )
    expect(state.magicWand).toEqual({ tolerance: 0, floodMode: 'global', selectionMode: 'add' })
    expect(state.document).toBeNull()
    expect(state.activeTool).toBeNull()
    expect(state.selection).toBeNull()
  })

  it('rounds the tolerance to a whole number and clamps it to 0–100', () => {
    const tolerance = (value: number) =>
      reduce(initialEditorState, { type: 'magic-wand-tolerance-changed', tolerance: value }).magicWand.tolerance
    expect(tolerance(100)).toBe(100)
    expect(tolerance(0)).toBe(0)
    expect(tolerance(42.4)).toBe(42)
    expect(tolerance(42.5)).toBe(43)
    expect(tolerance(150)).toBe(100)
    expect(tolerance(-3)).toBe(0)
    expect(tolerance(-0.4)).toBe(0)
    expect(Object.is(tolerance(-0.4), -0)).toBe(false)
  })

  it('ignores invalid option values', () => {
    const state = reduce(opened(), { type: 'magic-wand-tolerance-changed', tolerance: 30 })
    for (const tolerance of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(reduce(state, { type: 'magic-wand-tolerance-changed', tolerance })).toBe(state)
    }
    expect(reduce(state, { type: 'magic-wand-flood-mode-changed', floodMode: 'diagonal' as FloodMode })).toBe(state)
    expect(
      reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'intersect' as SelectionMode }),
    ).toBe(state)
  })

  it('returns the same state when an option does not change', () => {
    const state = opened()
    expect(reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 20 })).toBe(state)
    expect(reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 19.6 })).toBe(state)
    expect(reduce(state, { type: 'magic-wand-flood-mode-changed', floodMode: 'contiguous' })).toBe(state)
    expect(reduce(state, { type: 'magic-wand-selection-mode-changed', selectionMode: 'new' })).toBe(state)
  })

  it('keeps Magic Wand options across successful, failed and superseded imports', () => {
    const state = reduce(
      opened(),
      { type: 'magic-wand-tolerance-changed', tolerance: 55 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: failed },
      { type: 'import-started', importId: 3 },
      { type: 'import-started', importId: 4 },
      { type: 'import-finished', importId: 3, result: succeeded(9, 9) },
      { type: 'import-finished', importId: 4, result: succeeded(6, 6) },
      { type: 'tool-selected', tool: 'magic-wand' },
    )
    expect(state.document).toMatchObject({ width: 6, height: 6 })
    expect(state.magicWand).toEqual({ tolerance: 55, floodMode: 'global', selectionMode: 'add' })
  })
})

describe('editorReducer: selection', () => {
  function opened(width = 4, height = 3, importId = 1, state: EditorState = measured) {
    return reduce(
      state,
      { type: 'import-started', importId },
      { type: 'import-finished', importId, result: succeeded(width, height) },
    )
  }

  function mask(...rows: string[]): SelectionMask {
    const { width, height, data } = maskBytes(...rows)
    const selection = createSelectionMask(width, height, data)
    if (!selection) throw new Error('Test mask selects nothing')
    return selection
  }

  function apply(state: EditorState, selection: SelectionMask | null, version = documentVersion(state)!) {
    return reduce(state, { type: 'selection-applied', version, selection })
  }

  /** A 4 × 3 selection. */
  const corner = () => mask('##..', '#...', '....')

  it('reports the open document version, or null without a document', () => {
    expect(documentVersion(measured)).toBeNull()
    const state = opened()
    expect(documentVersion(state)).toEqual({ documentId: state.document!.id, revision: 0 })
  })

  it('applies a selection, keeping the mask itself', () => {
    const selection = corner()
    const state = apply(opened(), selection)
    expect(state.selection).toBe(selection)
    expect(maskRows(state.selection!)).toEqual(['##..', '#...', '....'])
  })

  it('replaces the selection with a later one', () => {
    const second = mask('....', '....', '..##')
    const state = apply(apply(opened(), corner()), second)
    expect(state.selection).toBe(second)
  })

  it('clears the selection by applying null or with Clear Selection', () => {
    const selected = apply(opened(), corner())
    expect(apply(selected, null).selection).toBeNull()
    expect(reduce(selected, { type: 'selection-cleared' }).selection).toBeNull()
  })

  it('returns the same state when the selection does not change', () => {
    const state = opened()
    expect(apply(state, null)).toBe(state)
    expect(reduce(state, { type: 'selection-cleared' })).toBe(state)
    const selected = apply(state, corner())
    expect(apply(selected, selected.selection)).toBe(selected)
  })

  it('ignores selection changes without an open image', () => {
    const version: DocumentVersion = { documentId: 1, revision: 0 }
    const selectAction = { type: 'selection-applied', version, selection: corner() } as const
    expect(reduce(measured, selectAction)).toBe(measured)
    expect(reduce(initialEditorState, selectAction)).toBe(initialEditorState)
    expect(reduce(measured, { type: 'selection-cleared' })).toBe(measured)

    // Also while the first image is still importing.
    const importing = reduce(measured, { type: 'import-started', importId: 1 })
    expect(reduce(importing, selectAction)).toBe(importing)
  })

  it('rejects a mask that is not the size of the image', () => {
    const state = opened(4, 3)
    expect(apply(state, mask('###', '...', '...'))).toBe(state)
    expect(apply(state, mask('####', '....'))).toBe(state)
    expect(apply(state, mask('###.', '....', '....', '....'))).toBe(state)
    expect(apply(state, mask('...#', '....', '....'))).not.toBe(state)
  })

  it('rejects a selection computed for a different image', () => {
    const first = opened(4, 3, 1)
    const firstVersion = documentVersion(first)!
    const second = opened(4, 3, 2, first)
    // Same size, so only the version tells them apart.
    expect(second.document!.id).not.toBe(first.document!.id)
    expect(apply(second, corner(), firstVersion)).toBe(second)
  })

  it('rejects a selection computed for a different revision of the image', () => {
    const state = opened()
    const { documentId } = documentVersion(state)!
    expect(apply(state, corner(), { documentId, revision: 1 })).toBe(state)
  })

  it('rejects a selection computed before a pixel edit, and accepts one computed after it', () => {
    const state = opened()
    const before = documentVersion(state)!
    const edited = withEditedPixels(state)
    const after = documentVersion(edited)!
    expect(after.documentId).toBe(before.documentId)
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(apply(edited, corner(), before)).toBe(edited)
    const selection = corner()
    expect(apply(edited, selection, after).selection).toBe(selection)
  })

  it('rejects a selection result that arrives after its image was replaced', () => {
    // The result is computed while a new image is still importing, then delivered late.
    let state = apply(opened(4, 3, 1), selectAll(4, 3))
    const version = documentVersion(state)!
    state = reduce(state, { type: 'import-started', importId: 2 })
    state = reduce(state, { type: 'import-finished', importId: 2, result: succeeded(4, 3) })
    expect(apply(state, corner(), version)).toBe(state)
    expect(state.selection).toBeNull()
  })

  it('accepts a selection for the open image while another import is in progress', () => {
    const importing = reduce(opened(), { type: 'import-started', importId: 2 })
    const selection = corner()
    expect(apply(importing, selection).selection).toBe(selection)
  })

  it('clears the selection when another image opens successfully', () => {
    const state = reduce(
      apply(opened(), corner()),
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(4, 3) },
    )
    expect(state.selection).toBeNull()
  })

  it('keeps the document and selection when an import fails, is rejected or is superseded', () => {
    const selected = apply(opened(), corner())

    const failedImport = reduce(
      selected,
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: failed },
    )
    expect(failedImport.document).toBe(selected.document)
    expect(failedImport.selection).toBe(selected.selection)

    const rejected = reduce(selected, { type: 'import-rejected', error: createImportError('unsupported-format', 'folder') })
    expect(rejected.document).toBe(selected.document)
    expect(rejected.selection).toBe(selected.selection)

    // The older import finishes after a newer one started (its cancelled result is discarded),
    // then the newer one fails too.
    const superseded = reduce(
      selected,
      { type: 'import-started', importId: 2 },
      { type: 'import-started', importId: 3 },
      { type: 'import-finished', importId: 2, result: succeeded(8, 8) },
      { type: 'import-finished', importId: 3, result: failed },
    )
    expect(superseded.document).toBe(selected.document)
    expect(superseded.selection).toBe(selected.selection)

    // An import that only starts keeps the selection until it succeeds.
    const started = reduce(selected, { type: 'import-started', importId: 2 })
    expect(started.selection).toBe(selected.selection)
  })

  it('keeps the selection when the tool or Magic Wand options change', () => {
    const selected = apply(opened(), corner())
    const state = reduce(
      // Only the Magic Wand is available in Phase 2; another tool is set directly.
      { ...selected, activeTool: 'crop' },
      { type: 'tool-selected', tool: 'magic-wand' },
      { type: 'magic-wand-tolerance-changed', tolerance: 70 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' },
    )
    expect(state.selection).toBe(selected.selection)
  })

  it('never changes the selection when zooming, panning or resizing the workspace', () => {
    const selected = apply(opened(400, 200), selectAll(400, 200))
    const state = reduce(
      selected,
      { type: 'zoom-scaled', anchor: { x: 100, y: 100 }, factor: 3 },
      { type: 'zoom-stepped', direction: 1 },
      { type: 'zoom-stepped', direction: -1 },
      { type: 'zoom-fitted' },
      { type: 'zoom-actual-size' },
      { type: 'wheel-panned', delta: { x: 30, y: -20 } },
      { type: 'pan-drag-started' },
      { type: 'pan-dragged', delta: { x: 15, y: 5 } },
      { type: 'pan-drag-ended' },
      { type: 'workspace-resized', workspace: { size: { width: 700, height: 500 }, devicePixelRatio: 1.25 } },
    )
    expect(state.viewport).not.toEqual(selected.viewport)
    expect(state.selection).toBe(selected.selection)
    expect(state.selection!.data).toEqual(selectAll(400, 200).data)
  })

  it('never modifies the previous state, its Magic Wand options or the mask', () => {
    const selection = corner()
    const before = apply(opened(), selection)
    const frozenOptions = { ...before.magicWand }
    const frozenState = { ...before }
    const bytes = selection.data.slice()

    reduce(
      before,
      { type: 'magic-wand-tolerance-changed', tolerance: 80 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'tool-selected', tool: 'magic-wand' },
      { type: 'selection-applied', version: documentVersion(before)!, selection: mask('....', '....', '...#') },
      { type: 'selection-cleared' },
      { type: 'import-started', importId: 2 },
      { type: 'import-finished', importId: 2, result: succeeded(4, 3) },
    )

    expect(before).toEqual(frozenState)
    expect(before.magicWand).toEqual(frozenOptions)
    expect(before.selection).toBe(selection)
    expect(selection.data).toEqual(bytes)
    expect(initialEditorState.magicWand).toEqual({ tolerance: 20, floodMode: 'contiguous', selectionMode: 'new' })
  })

  it('stores a new options object rather than changing the shared default', () => {
    const state = reduce(initialEditorState, { type: 'magic-wand-tolerance-changed', tolerance: 90 })
    expect(state.magicWand).not.toBe(initialEditorState.magicWand)
    expect(initialEditorState.magicWand.tolerance).toBe(20)
  })
})

describe('editorReducer: Magic Wand operations', () => {
  function opened(width = 4, height = 3, importId = 1, state: EditorState = measured) {
    return reduce(
      state,
      { type: 'import-started', importId },
      { type: 'import-finished', importId, result: succeeded(width, height) },
    )
  }

  function mask(...rows: string[]): SelectionMask {
    const { width, height, data } = maskBytes(...rows)
    const selection = createSelectionMask(width, height, data)
    if (!selection) throw new Error('Test mask selects nothing')
    return selection
  }

  /** A recorded click on `state`'s document, as magicWandClick builds it. */
  function operation(state: EditorState, change: Partial<MagicWandOperation> = {}): MagicWandOperation {
    return {
      version: documentVersion(state)!,
      seed: { x: 0, y: 0 },
      floodMode: 'contiguous',
      selectionMode: 'new',
      base: null,
      tolerance: 20,
      ...change,
    }
  }

  function applied(state: EditorState, op: MagicWandOperation, selection: SelectionMask | null) {
    return reduce(state, { type: 'magic-wand-applied', operation: op, selection })
  }

  const corner = () => mask('##..', '#...', '....')
  const side = () => mask('...#', '...#', '...#')

  it('records a click with its result, even when the selection does not change', () => {
    const state = opened()
    const op = operation(state)
    const selection = corner()
    const clicked = applied(state, op, selection)
    expect(clicked.selection).toBe(selection)
    expect(clicked.lastMagicWandOperation).toBe(op)

    // Adding a region already selected: same mask, but this click is now the one re-applied.
    const again = operation(clicked, { selectionMode: 'add', base: clicked.selection, seed: { x: 1, y: 0 } })
    const unchanged = applied(clicked, again, clicked.selection)
    expect(unchanged.selection).toBe(selection)
    expect(unchanged.lastMagicWandOperation).toBe(again)
  })

  it('rejects an Add or Subtract click whose base is no longer the selection', () => {
    const before = opened()
    const state = applied(before, operation(before), corner())
    const stale = operation(state, { selectionMode: 'add', base: side() })
    expect(applied(state, stale, side())).toBe(state)
    expect(applied(state, { ...stale, selectionMode: 'subtract' }, null)).toBe(state)
    // New does not depend on the selection before it.
    expect(applied(state, operation(state), side()).selection).toBeTruthy()
  })

  it('rejects a click for another document version or a mask of another size', () => {
    const first = opened(4, 3, 1)
    const op = operation(first)
    const second = opened(4, 3, 2, first)
    expect(applied(second, op, corner())).toBe(second)
    expect(applied(second, operation(second, { version: { ...documentVersion(second)!, revision: 1 } }), corner())).toBe(second)
    expect(applied(second, operation(second), mask('##.', '#..', '...'))).toBe(second)
  })

  it('rejects a click or re-apply recorded before a pixel edit until it is rebound to the new revision', () => {
    const state = opened()
    const op = operation(state)
    const edited = withEditedPixels(applied(state, op, corner()))
    expect(applied(edited, op, corner())).toBe(edited)
    expect(reduce(edited, { type: 'magic-wand-reapplied', operation: op, tolerance: 60, selection: side() })).toBe(edited)

    // The same click tagged with the current version (how Undo is planned to restore it) is accepted.
    const rebound: MagicWandOperation = { ...op, version: documentVersion(edited)! }
    const restored: EditorState = { ...edited, lastMagicWandOperation: rebound }
    const selection = side()
    const reapplied = reduce(restored, { type: 'magic-wand-reapplied', operation: rebound, tolerance: 60, selection })
    expect(reapplied.selection).toBe(selection)
    expect(reapplied.lastMagicWandOperation).toEqual({ ...rebound, tolerance: 60 })
  })

  it('re-applies only the latest operation, keeping everything but the tolerance', () => {
    const state = opened()
    const op = operation(state, { selectionMode: 'add', base: null, seed: { x: 3, y: 2 }, floodMode: 'global' })
    const clicked = applied(state, op, corner())
    const reapplied = reduce(clicked, { type: 'magic-wand-reapplied', operation: op, tolerance: 55, selection: side() })
    expect(reapplied.selection).toEqual(side())
    expect(reapplied.lastMagicWandOperation).toEqual({ ...op, tolerance: 55 })
    expect(reapplied.lastMagicWandOperation!.base).toBe(op.base)

    // A result computed from the previous operation arrives after this re-apply.
    expect(reduce(reapplied, { type: 'magic-wand-reapplied', operation: op, tolerance: 70, selection: corner() })).toBe(reapplied)
  })

  it('rejects a re-applied result once the operation is forgotten, the image changed or the mask does not fit', () => {
    const state = opened()
    const op = operation(state)
    const clicked = applied(state, op, corner())
    const action = (selection: SelectionMask | null): EditorAction => ({ type: 'magic-wand-reapplied', operation: op, tolerance: 60, selection })

    const cleared = reduce(clicked, { type: 'selection-cleared' })
    expect(reduce(cleared, action(side()))).toBe(cleared)
    const replaced = opened(4, 3, 2, clicked)
    expect(reduce(replaced, action(side()))).toBe(replaced)
    expect(reduce(clicked, action(mask('###', '...', '...')))).toBe(clicked)
    const revised: EditorState = { ...clicked, document: { ...clicked.document!, revision: 1 } }
    expect(reduce(revised, action(side()))).toBe(revised)
  })

  it('forgets the operation when another change replaces the selection, or another image opens', () => {
    const state = opened()
    const clicked = applied(state, operation(state), corner())
    const version = documentVersion(state)!
    expect(reduce(clicked, { type: 'selection-applied', version, selection: side() }).lastMagicWandOperation).toBeNull()
    expect(reduce(clicked, { type: 'selection-applied', version, selection: null }).lastMagicWandOperation).toBeNull()
    expect(reduce(clicked, { type: 'selection-cleared' }).lastMagicWandOperation).toBeNull()
    expect(opened(4, 3, 2, clicked).lastMagicWandOperation).toBeNull()

    // A change that changes nothing keeps it.
    expect(reduce(clicked, { type: 'selection-applied', version, selection: clicked.selection })).toBe(clicked)
    // As does a result for another image, which is ignored.
    expect(reduce(clicked, { type: 'selection-applied', version: { ...version, documentId: 999 }, selection: side() })).toBe(clicked)
  })

  it('keeps the operation when an import fails, is rejected, is superseded or is still running', () => {
    const state = opened()
    const clicked = applied(state, operation(state), corner())
    const op = clicked.lastMagicWandOperation
    const outcomes = [
      reduce(clicked, { type: 'import-started', importId: 2 }, { type: 'import-finished', importId: 2, result: failed }),
      reduce(clicked, { type: 'import-rejected', error: createImportError('unsupported-format', 'folder') }),
      reduce(
        clicked,
        { type: 'import-started', importId: 2 },
        { type: 'import-started', importId: 3 },
        { type: 'import-finished', importId: 2, result: succeeded(8, 8) },
        { type: 'import-finished', importId: 3, result: failed },
      ),
      reduce(clicked, { type: 'import-started', importId: 2 }),
    ]
    for (const outcome of outcomes) {
      expect(outcome.lastMagicWandOperation).toBe(op)
      expect(outcome.selection).toBe(clicked.selection)
    }
  })

  it('keeps the operation through tolerance and option changes, tools, zoom, panning and resizing', () => {
    const state = opened(400, 200)
    const clicked = applied(state, operation(state), selectAll(400, 200))
    const moved = reduce(
      { ...clicked, activeTool: 'crop' },
      { type: 'tool-selected', tool: 'magic-wand' },
      { type: 'magic-wand-tolerance-changed', tolerance: 70 },
      { type: 'magic-wand-tolerance-changed', tolerance: 3 },
      { type: 'magic-wand-flood-mode-changed', floodMode: 'global' },
      { type: 'magic-wand-selection-mode-changed', selectionMode: 'subtract' },
      { type: 'zoom-scaled', anchor: { x: 100, y: 100 }, factor: 3 },
      { type: 'zoom-fitted' },
      { type: 'wheel-panned', delta: { x: 30, y: -20 } },
      { type: 'pan-drag-started' },
      { type: 'pan-dragged', delta: { x: 15, y: 5 } },
      { type: 'pan-drag-ended' },
      { type: 'workspace-resized', workspace: { size: { width: 700, height: 500 }, devicePixelRatio: 1.25 } },
    )
    expect(moved.lastMagicWandOperation).toBe(clicked.lastMagicWandOperation)
    expect(moved.selection).toBe(clicked.selection)
  })
})
