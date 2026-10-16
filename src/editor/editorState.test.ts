import { describe, expect, it } from 'vitest'
import { viewportToImage, viewportToPixel } from '../canvas/coordinates'
import { planFrame } from '../canvas/rendering'
import { MAX_ZOOM, MIN_ZOOM } from '../canvas/viewport'
import { createImportError } from '../image/import/errors'
import { fakeImageData } from '../image/import/testFixtures'
import {
  type EditorAction,
  type EditorImportResult,
  type EditorState,
  type WorkspaceMetrics,
  displayViewport,
  editorReducer,
  initialEditorState,
  isImporting,
} from './editorState'
import { createImageDocument } from './imageDocument'

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

describe('editorReducer: imports', () => {
  it('starts with no document, viewport or error', () => {
    expect(initialEditorState).toEqual({
      document: null,
      documentBitmap: null,
      viewport: null,
      workspace: null,
      pendingImportId: null,
      importError: null,
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
    )
    const state = reduce(opened, {
      type: 'workspace-resized',
      workspace: { size: { width: 1200, height: 700 }, devicePixelRatio: 1 },
    })
    expect(state.viewport!.zoom).toBe(opened.viewport!.zoom)
    expect(state.viewport!.offset.x).toBeCloseTo(opened.viewport!.offset.x + 100, 9)
    expect(state.viewport!.offset.y).toBeCloseTo(opened.viewport!.offset.y + 50, 9)
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
    )
    const start = state.viewport!
    for (let i = 0; i < 50; i++) {
      const width = i % 2 === 0 ? 1000.4 : 1000
      state = reduce(state, {
        type: 'workspace-resized',
        workspace: { size: { width, height: 600 }, devicePixelRatio: 1.5 },
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
