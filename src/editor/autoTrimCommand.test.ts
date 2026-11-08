import { beforeEach, describe, expect, it } from 'vitest'
import { type EditDispatch, dispatchEditAction } from '../app/editDispatch'
import { type EdgeSettings, deleteSelectionWithEdges } from '../image/edit/deleteWithEdges'
import { LINES, edgeCases } from '../image/edit/edgeTestFixtures'
import { createImportError } from '../image/import/errors'
import { createPixelBuffer } from '../image/pixelBuffer'
import { createMagicWandSelection } from '../image/selection/magicWand'
import { createSelectionMask } from '../image/selection/selectionMask'
import { DEFAULT_AUTO_TRIM_PADDING, MAX_AUTO_TRIM_PADDING } from './autoTrimPadding'
import {
  adjustDeleteCommand,
  adjustableDelete,
  autoTrimCommand,
  availableEditActions,
  editActionCommand,
  hasUnexportedEdits,
} from './editCommands'
import { editErrorMessage, editNoticeText, isShownEditNotice } from './editFeedback'
import { type EditorAction, type EditorState, displayViewport, documentVersion, editorReducer, initialEditorState } from './editorState'
import type { CropPatch } from './history/cropPatch'
import { createEditHistory } from './history/editHistory'
import {
  type FakeDisplayImage,
  type FakeDisplayImages,
  WORKSPACE,
  accepted,
  fakeBitmap,
  fakeDisplayImages,
  opened,
  randomInt,
  randomSource,
  reduce,
  sameBytes,
  sameSelection,
} from './history/testFixtures'
import { createImageDocument } from './imageDocument'
import { commitToleranceCommand, magicWandClick } from './selectionCommands'
import type { PixelBuffer, Rectangle, SelectionMask, SelectionMode } from './types'

/*
 * Auto Trim as the application runs it (Phase 3 Step 11): editActionCommand('auto-trim') with the
 * reducer, from the padding in the editor state through the Step 10 plan, the crop recorded in
 * history, Undo and Redo, the selection, the view, availability, stale actions, failures and the
 * history budget. Display images are fakes recording what was created and released.
 *
 * Every expected result is computed here independently of the algorithm: the visible bounds by a
 * full scan of every alpha value, the kept rectangle by clipping the padded bounds, and the kept
 * bytes by indexing the original.
 */

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
const start = (pixels: PixelBuffer, limits?: { maxEntries: number; maxBytes: number }) =>
  opened(pixels, limits ? { ...measured, history: createEditHistory(limits) } : measured)

type Action = 'delete-selection' | 'auto-trim' | 'undo' | 'redo'
const command = (state: EditorState, action: Action) => editActionCommand(state, action, images.create)
const run = (state: EditorState, action: Action) => accepted(state, command(state, action))
const withPadding = (state: EditorState, padding: number) => reduce(state, { type: 'auto-trim-padding-changed', padding })
const trim = (state: EditorState, padding?: number) => run(padding === undefined ? state : withPadding(state, padding), 'auto-trim')

/** A real Magic Wand click on image pixel (x, y), as the canvas reports it. */
function click(state: EditorState, x: number, y: number, mode: SelectionMode = 'new'): EditorState {
  const viewport = displayViewport(state)!
  const point = { x: viewport.offset.x + (x + 0.5) * viewport.zoom, y: viewport.offset.y + (y + 0.5) * viewport.zoom }
  return accepted(state, magicWandClick(state, point, mode))
}

function select(state: EditorState, selection: SelectionMask | null): EditorState {
  return accepted(state, { type: 'selection-applied', version: documentVersion(state)!, selection })
}

/** The visible bounds by a full scan of every alpha value, or null when nothing is visible. */
function referenceBounds(pixels: PixelBuffer): Rectangle | null {
  let left = Infinity
  let top = Infinity
  let right = -1
  let bottom = -1
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/** The rectangle Auto Trim should keep: the visible bounds plus `padding`, each side clipped to the image. */
function referenceKept(pixels: PixelBuffer, padding: number): Rectangle | null {
  const bounds = referenceBounds(pixels)
  if (!bounds) return null
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  const right = Math.min(pixels.width, bounds.x + bounds.width + padding)
  const bottom = Math.min(pixels.height, bounds.y + bounds.height + padding)
  return { x, y, width: right - x, height: bottom - y }
}

/** Whether `trimmed` is exactly the `kept` rectangle of `original`, byte for byte. */
function isCropOf(trimmed: PixelBuffer, original: PixelBuffer, kept: Rectangle): boolean {
  if (trimmed.width !== kept.width || trimmed.height !== kept.height) return false
  for (let y = 0; y < kept.height; y++) {
    for (let x = 0; x < kept.width * 4; x++) {
      if (trimmed.data[y * kept.width * 4 + x] !== original.data[((kept.y + y) * original.width + kept.x) * 4 + x]) return false
    }
  }
  return true
}

/**
 * A width × height image, transparent everywhere with a different hidden colour in every pixel,
 * and opaque content in `content` whose outermost ring is partly transparent (alpha 1 at its
 * corners, 128 elsewhere): anti-aliased edges, the faintest pixels exactly on the bounds.
 */
function framed(width: number, height: number, content: Rectangle, seed = 1): PixelBuffer {
  const random = randomSource(seed)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), 0], p * 4)
  const right = content.x + content.width - 1
  const bottom = content.y + content.height - 1
  for (let y = content.y; y <= bottom; y++) {
    for (let x = content.x; x <= right; x++) {
      const edgeX = x === content.x || x === right
      const edgeY = y === content.y || y === bottom
      data[(y * width + x) * 4 + 3] = edgeX && edgeY ? 1 : edgeX || edgeY ? 128 : 255
    }
  }
  return createPixelBuffer(width, height, data)
}

/**
 * dispatchEditAction (app/editDispatch.ts) with a stand-in for React whose flush runs the reducer
 * and commits, as flushSync does; real React is checked in the browsers.
 */
function standIn(initial: EditorState) {
  let committed = initial
  const queue: EditorAction[] = []
  const deps: EditDispatch = {
    dispatch: (action) => queue.push(action),
    flush: (update) => {
      update()
      for (const action of queue.splice(0)) committed = editorReducer(committed, action)
    },
    committedState: () => committed,
    release: (image) => (image as unknown as FakeDisplayImage).close(),
  }
  return { send: (action: EditorAction) => dispatchEditAction(action, deps), state: () => committed }
}

/** Fit would change nothing: the view is exactly what Fit gives. */
const isFitted = (state: EditorState) => reduce(state, { type: 'zoom-fitted' }) === state

describe('Auto Trim command', () => {
  it('trims with padding 0, 5 and 50: exactly the kept bytes, the new size, one entry, a fresh revision, one display image', () => {
    const original = framed(200, 150, { x: 40, y: 30, width: 40, height: 30 })
    for (const padding of [0, 5, 50]) {
      const before = withPadding(start(original), padding)
      const created = images.created.length
      const after = run(before, 'auto-trim')
      const kept = referenceKept(original, padding)!
      expect(isCropOf(after.document!.pixels, original, kept)).toBe(true)
      expect([after.document!.width, after.document!.height]).toEqual([kept.width, kept.height])
      expect(after.document!.id).toBe(before.document!.id)
      expect(after.document!.revision).toBeGreaterThan(before.document!.revision)
      expect(after.history.undo).toHaveLength(1)
      expect(after.history.undo[0].kind).toBe('auto-trim')
      expect((after.history.undo[0].patch as CropPatch).kept).toEqual(kept)
      expect(images.created).toHaveLength(created + 1)
      expect(after.documentBitmap).toBe(images.created.at(-1))
      expect(after.documentBitmap).toMatchObject({ width: kept.width, height: kept.height })
      expect(after.editDepth).toBe(1)
      expect(hasUnexportedEdits(after)).toBe(true)
      expect(after.autoTrimPadding).toBe(padding)
    }
    // 0: the content only; 5: five pixels around it; 50: clipped at the left and top edges.
    expect(referenceKept(original, 0)).toEqual({ x: 40, y: 30, width: 40, height: 30 })
    expect(referenceKept(original, 5)).toEqual({ x: 35, y: 25, width: 50, height: 40 })
    expect(referenceKept(original, 50)).toEqual({ x: 0, y: 0, width: 130, height: 110 })
  })

  it('clips the padding at each image edge separately and never enlarges the image', () => {
    // Content touching the left and top edges, with room on the right and bottom.
    const original = framed(60, 40, { x: 0, y: 0, width: 20, height: 10 })
    const after = trim(start(original), 5)
    expect((after.history.undo[0].patch as CropPatch).kept).toEqual({ x: 0, y: 0, width: 25, height: 15 })
    expect(isCropOf(after.document!.pixels, original, { x: 0, y: 0, width: 25, height: 15 })).toBe(true)
    // With 50 px only the right and bottom sides move in.
    const wide = trim(start(framed(100, 80, { x: 10, y: 0, width: 20, height: 10 })), MAX_AUTO_TRIM_PADDING)
    expect((wide.history.undo[0].patch as CropPatch).kept).toEqual({ x: 0, y: 0, width: 80, height: 60 })
  })

  it('reports the sizes before and after, and fits the trimmed image to the workspace', () => {
    const before = start(framed(400, 300, { x: 100, y: 50, width: 20, height: 10 }))
    const zoomed = reduce(before, { type: 'zoom-scaled', anchor: { x: 900, y: 500 }, factor: 8 })
    expect(isFitted(zoomed)).toBe(false)
    const after = trim(zoomed, 5)
    expect(after.editNotice).toEqual({
      kind: 'applied',
      operation: 'auto-trim',
      changedPixels: null,
      resized: { from: { width: 400, height: 300 }, to: { width: 30, height: 20 } },
    })
    expect(editNoticeText(after.editNotice!)).toBe('Auto Trim applied: 400 × 300 px trimmed to 30 × 20 px.')
    // Announced only: the image itself shows the change.
    expect(isShownEditNotice(after.editNotice!)).toBe(false)
    expect(isFitted(after)).toBe(true)
    expect(after.placeOnNextResize).toBe(false)
  })

  it('keeps partly transparent edges, one-pixel lines and hidden colour after a real Magic Wand Delete', () => {
    const { observed } = LINES()
    for (const [settings, padding] of [
      [{ cleanup: 0, feather: 0 }, 0],
      [{ cleanup: 0, feather: 0 }, 5],
      [{ cleanup: 1, feather: 0 }, 0],
      [{ cleanup: 1, feather: 1 }, 5],
    ] as const) {
      let state = reduce(start(observed), { type: 'magic-wand-flood-mode-changed', floodMode: 'global' })
      state = reduce(state, { type: 'edge-settings-changed', settings })
      state = run(click(state, 0, 0), 'delete-selection')
      const deleted = state.document!.pixels
      const after = trim(state, padding)
      const kept = referenceKept(deleted, padding)!
      expect(isCropOf(after.document!.pixels, deleted, kept)).toBe(true)
      // Every visible pixel of the Delete result is kept, including the faintest anti-aliased ones.
      let faintest = 255
      for (let p = 0; p < deleted.width * deleted.height; p++) {
        const alpha = deleted.data[p * 4 + 3]
        if (alpha === 0) continue
        faintest = Math.min(faintest, alpha)
        const x = p % deleted.width
        const y = Math.floor(p / deleted.width)
        expect(x >= kept.x && x < kept.x + kept.width && y >= kept.y && y < kept.y + kept.height).toBe(true)
      }
      // The lines are opaque over white; Edge cleanup makes their anti-aliased fringe partly transparent.
      if (settings.cleanup > 0) expect(faintest).toBeLessThan(128)
      else expect(faintest).toBe(255)
      if (settings.cleanup > 0) continue
      // Hidden colour is kept in transparent pixels that stay: the colour each had when opened, as Delete left it.
      let hidden = 0
      const data = after.document!.pixels.data
      for (let p = 0; p < kept.width * kept.height; p++) {
        if (data[p * 4 + 3] !== 0) continue
        const source = ((kept.y + Math.floor(p / kept.width)) * observed.width + kept.x + (p % kept.width)) * 4
        expect([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]).toEqual([...observed.data.subarray(source, source + 3)])
        hidden++
      }
      expect(hidden).toBeGreaterThan(0)
    }
  })

  it('a fully transparent image has nothing to trim: no entry, revision, image, view, selection or depth change', () => {
    // Hidden colour under alpha 0 never counts as visible.
    const original = createPixelBuffer(30, 20, new Uint8ClampedArray(30 * 20 * 4).map((_, i) => (i % 4 === 3 ? 0 : 200)))
    const before = select(start(original), createSelectionMask(30, 20, new Uint8Array(600).fill(1)))
    const action = command(before, 'auto-trim')
    expect(action).toEqual({
      type: 'edit-unchanged',
      version: documentVersion(before),
      operation: 'auto-trim',
      trim: { kind: 'nothing-visible' },
    })
    const after = accepted(before, action)
    expect(after.document).toBe(before.document)
    expect(after.documentBitmap).toBe(before.documentBitmap)
    expect(after.history).toBe(before.history)
    expect(after.viewport).toBe(before.viewport)
    expect(after.selection).toBe(before.selection)
    expect(after.editDepth).toBe(0)
    expect(hasUnexportedEdits(after)).toBe(false)
    expect(images.created).toHaveLength(0)
    expect(after.editFeedbackId).toBe(before.editFeedbackId + 1)
    expect(editNoticeText(after.editNotice!)).toBe('Nothing to trim: the image has no visible pixels.')
    expect(isShownEditNotice(after.editNotice!)).toBe(true)
  })

  it('a fully opaque image, and content with its padding reaching every edge, have nothing to trim', () => {
    const opaque = createPixelBuffer(9, 7, new Uint8ClampedArray(9 * 7 * 4).fill(255))
    for (const padding of [0, 5, 50]) {
      const before = withPadding(start(opaque), padding)
      const after = accepted(before, command(before, 'auto-trim'))
      expect(after.document).toBe(before.document)
      expect(after.editNotice).toEqual({ kind: 'unchanged', operation: 'auto-trim', trim: { kind: 'no-border', padding } })
    }
    const near = withPadding(start(framed(30, 20, { x: 3, y: 2, width: 24, height: 16 })), 3)
    const noBorder = accepted(near, command(near, 'auto-trim'))
    expect(noBorder.document).toBe(near.document)
    expect(editNoticeText(noBorder.editNotice!)).toBe('Nothing to trim: no side has more than 3 px of transparent space.')
    // Visible pixels in every edge, at padding 0.
    const edges = withPadding(start(framed(10, 10, { x: 0, y: 0, width: 10, height: 10 })), 0)
    const atZero = accepted(edges, command(edges, 'auto-trim'))
    expect(atZero.document).toBe(edges.document)
    expect(editNoticeText(atZero.editNotice!)).toBe('Nothing to trim: visible pixels already reach every edge of the image.')
    expect(images.created).toHaveLength(0)
  })

  it('an already trimmed image changes nothing at the same or a larger padding, and trims further at a smaller one', () => {
    const once = trim(start(framed(80, 60, { x: 20, y: 20, width: 30, height: 10 })), 10)
    for (const padding of [10, 20, 50]) {
      const again = withPadding(once, padding)
      const after = accepted(again, command(again, 'auto-trim'))
      expect(after.document).toBe(once.document)
      expect(after.history).toBe(once.history)
      expect(after.editDepth).toBe(1)
    }
    const tighter = trim(once, 0)
    expect([tighter.document!.width, tighter.document!.height]).toEqual([30, 10])
    expect(tighter.history.undo).toHaveLength(2)
  })

  it('a no-op keeps Redo, the edit depth and the unexported state', () => {
    let state = start(framed(40, 30, { x: 10, y: 10, width: 10, height: 10 }))
    state = trim(state, 0)
    state = run(state, 'undo')
    expect(availableEditActions(state).redo).toBe('auto-trim')
    // Padding 50 reaches every edge of the 40 × 30 image: nothing to trim.
    const noop = accepted(withPadding(state, 50), command(withPadding(state, 50), 'auto-trim'))
    expect(noop.history).toBe(state.history)
    expect(availableEditActions(noop).redo).toBe('auto-trim')
    expect(noop.editDepth).toBe(0)
    expect(hasUnexportedEdits(noop)).toBe(false)
    // A real trim then discards Redo, as every new edit does.
    const trimmed = trim(noop, 1)
    expect(trimmed.history.redo).toHaveLength(0)
    expect(trimmed.editNotice).not.toHaveProperty('droppedUndoSteps')
  })

  it('clears the selection and the Magic Wand click; Undo restores both, and the click re-applies exactly', () => {
    const original = framed(50, 40, { x: 15, y: 10, width: 20, height: 20 })
    let state = reduce(start(original), { type: 'magic-wand-tolerance-changed', tolerance: 30 })
    state = click(state, 25, 20)
    const selection = state.selection!
    const operation = state.lastMagicWandOperation!
    const trimmed = trim(state, 5)
    expect(trimmed.selection).toBeNull()
    expect(trimmed.lastMagicWandOperation).toBeNull()
    expect(trimmed.history.undo[0].selectionAfter).toBeNull()

    const undone = run(trimmed, 'undo')
    expect(sameSelection(undone.selection, selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toMatchObject({
      seed: operation.seed,
      floodMode: operation.floodMode,
      selectionMode: operation.selectionMode,
      tolerance: 30,
      version: documentVersion(undone),
    })
    // A committed tolerance re-applies the click on the restored pixels as a fresh click would.
    const reapplied = reduce(undone, ...commitToleranceCommand(undone, 60))
    const fresh = createMagicWandSelection(original, operation.seed, { tolerance: 60, floodMode: operation.floodMode })
    expect(sameSelection(reapplied.selection, fresh)).toBe(true)
    // Redo: the trimmed image and no selection.
    const redone = run(undone, 'redo')
    expect(redone.selection).toBeNull()
    expect(redone.lastMagicWandOperation).toBeNull()
  })

  it('Undo restores the original size and every byte, Redo the trimmed image, each time as a fresh revision fitted to the workspace', () => {
    const original = framed(64, 48, { x: 7, y: 9, width: 31, height: 17 }, 9)
    const before = start(original)
    let state = trim(before, 5)
    const trimmedPixels = state.document!.pixels
    const revisions = new Set([before.document!.revision, state.document!.revision])
    for (let round = 0; round < 3; round++) {
      state = run(state, 'undo')
      expect([state.document!.width, state.document!.height]).toEqual([64, 48])
      expect(sameBytes(state.document!.pixels, original)).toBe(true)
      expect(state.document!.pixels).not.toBe(original)
      expect(state.editDepth).toBe(0)
      expect(hasUnexportedEdits(state)).toBe(false)
      expect(isFitted(state)).toBe(true)
      expect(editNoticeText(state.editNotice!)).toBe('Undone: Auto Trim.')
      revisions.add(state.document!.revision)

      state = run(state, 'redo')
      expect(sameBytes(state.document!.pixels, trimmedPixels)).toBe(true)
      expect(state.editDepth).toBe(1)
      expect(isFitted(state)).toBe(true)
      expect(editNoticeText(state.editNotice!)).toBe('Redone: Auto Trim.')
      revisions.add(state.document!.revision)
    }
    expect(revisions.size).toBe(8)
    // One display image per trim, Undo and Redo; the commands release none.
    expect(images.created).toHaveLength(7)
    expect(images.created.every((image) => !image.released)).toBe(true)
  })

  it('Magic Wand, Delete with Edge cleanup and Feather, Auto Trim, two Undos and two Redos', () => {
    const icon = edgeCases().find((c) => c.name === 'icon on white')!
    const settings: EdgeSettings = { cleanup: 1, feather: 1 }
    let state = reduce(start(icon.observed), { type: 'edge-settings-changed', settings })
    state = click(state, 0, 0)
    const selection = state.selection!
    const clickBefore = state.lastMagicWandOperation!
    expect(sameSelection(selection, icon.selection)).toBe(true)

    const deleted = run(state, 'delete-selection')
    const expectedDelete = deleteSelectionWithEdges(icon.observed, selection, settings)!
    expect(expectedDelete.edgePixels).toBeGreaterThan(0)
    expect(sameBytes(deleted.document!.pixels, expectedDelete.pixels)).toBe(true)

    const trimmed = trim(deleted, 5)
    const kept = referenceKept(deleted.document!.pixels, 5)!
    expect(kept.width).toBeLessThan(64)
    expect(isCropOf(trimmed.document!.pixels, deleted.document!.pixels, kept)).toBe(true)
    expect(trimmed.history.undo.map((entry) => entry.kind)).toEqual(['delete-selection', 'auto-trim'])
    expect(trimmed.editDepth).toBe(2)

    const undoTrim = run(trimmed, 'undo')
    expect(sameBytes(undoTrim.document!.pixels, deleted.document!.pixels)).toBe(true)
    expect(undoTrim.selection).toBeNull()
    expect(availableEditActions(undoTrim).undo).toBe('delete-selection')
    const undoDelete = run(undoTrim, 'undo')
    expect(sameBytes(undoDelete.document!.pixels, icon.observed)).toBe(true)
    expect(sameSelection(undoDelete.selection, selection)).toBe(true)
    expect(undoDelete.lastMagicWandOperation).toMatchObject({ seed: clickBefore.seed, tolerance: clickBefore.tolerance })
    expect(undoDelete.editDepth).toBe(0)

    const redoDelete = run(undoDelete, 'redo')
    expect(sameBytes(redoDelete.document!.pixels, expectedDelete.pixels)).toBe(true)
    expect(redoDelete.selection).toBeNull()
    const redoTrim = run(redoDelete, 'redo')
    expect(sameBytes(redoTrim.document!.pixels, trimmed.document!.pixels)).toBe(true)
    expect(redoTrim.history.redo).toHaveLength(0)
    expect(redoTrim.editDepth).toBe(2)
  })

  it('ends adjusting the last Delete (Step 9): a later amount sets only the next Delete; the Delete stays undoable', () => {
    const icon = edgeCases().find((c) => c.name === 'icon on white')!
    const deleted = run(click(start(icon.observed), 0, 0), 'delete-selection')
    expect(adjustableDelete(deleted)).not.toBeNull()
    const trimmed = trim(deleted, 5)
    expect(trimmed.adjustableEdit).toBeNull()
    expect(adjustableDelete(trimmed)).toBeNull()
    expect(adjustDeleteCommand(trimmed, { cleanup: 2, feather: 0 }, images.create)).toBeNull()
    // Setting an amount now changes nothing but the amount.
    const amounts = reduce(trimmed, { type: 'edge-settings-changed', settings: { cleanup: 2 } })
    expect(amounts.document).toBe(trimmed.document)
    expect(amounts.edgeSettings).toEqual({ cleanup: 2, feather: 0 })
    // Neither Undo nor Redo of the trim makes the Delete adjustable again (Step 9: Undo ends it, and
    // the trim waiting to be redone was made from the Delete's result).
    const undone = run(trimmed, 'undo')
    expect(adjustableDelete(undone)).toBeNull()
    expect(adjustableDelete(run(undone, 'redo'))).toBeNull()
    expect(adjustableDelete(run(run(undone, 'undo'), 'redo'))).toBeNull()
    // The Delete is still undone exactly after the trim is.
    const before = run(undone, 'undo')
    expect(sameBytes(before.document!.pixels, icon.observed)).toBe(true)
    expect(sameSelection(before.selection, icon.selection)).toBe(true)
  })

  it('is unavailable without an image and while another image opens; padding goes back to 5 when another image opens', () => {
    expect(availableEditActions(initialEditorState).autoTrim).toBe(false)
    expect(command(initialEditorState, 'auto-trim')).toBeNull()
    expect(autoTrimCommand(initialEditorState, images.create)).toBeNull()
    const state = withPadding(start(framed(30, 20, { x: 5, y: 5, width: 5, height: 5 })), 12)
    expect(availableEditActions(state).autoTrim).toBe(true)
    const importing = reduce(state, { type: 'import-started', importId: 501 })
    expect(availableEditActions(importing).autoTrim).toBe(false)
    expect(command(importing, 'auto-trim')).toBeNull()
    // A failed import keeps the image, the padding and Auto Trim.
    const failed = reduce(importing, { type: 'import-finished', importId: 501, result: { ok: false, error: createImportError('decode-failed') } })
    expect(failed.autoTrimPadding).toBe(12)
    expect(availableEditActions(failed).autoTrim).toBe(true)
    // A successful one resets the padding and makes the Magic Wand active again.
    const onTool = reduce(failed, { type: 'tool-selected', tool: 'auto-trim' })
    expect(onTool.activeTool).toBe('auto-trim')
    const next = opened(framed(10, 10, { x: 2, y: 2, width: 3, height: 3 }), onTool)
    expect(next.autoTrimPadding).toBe(DEFAULT_AUTO_TRIM_PADDING)
    expect(next.activeTool).toBe('magic-wand')
    // The Magic Wand's options row replaces Auto Trim's: the next resize places the image again.
    expect(next.placeOnNextResize).toBe(true)
    expect(images.created).toHaveLength(0)
  })

  it('rejects stale Trims: two from one state, one computed before a selection change, another edit, Undo or another image', () => {
    const base = click(start(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 })), 30, 20)
    const first = command(base, 'auto-trim')!
    const twin = command(base, 'auto-trim')!
    const once = accepted(base, first)
    expect(editorReducer(once, twin)).toBe(once)

    const cleared = reduce(base, { type: 'selection-cleared' })
    expect(editorReducer(cleared, command(base, 'auto-trim')!)).toBe(cleared)

    const deleted = run(base, 'delete-selection')
    expect(editorReducer(deleted, command(base, 'auto-trim')!)).toBe(deleted)

    const undone = run(once, 'undo')
    expect(editorReducer(undone, command(once, 'auto-trim') ?? { type: 'edit-error-dismissed' })).toBe(undone)
    expect(editorReducer(undone, twin)).toBe(undone)

    const other = opened(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 }))
    expect(editorReducer(other, twin)).toBe(other)
    // A stale no-op report is ignored as well.
    const noop: EditorAction = { type: 'edit-unchanged', version: documentVersion(base)!, operation: 'auto-trim', trim: { kind: 'nothing-visible' } }
    expect(editorReducer(once, noop)).toBe(once)
  })

  it('releases the display image of a Trim the reducer rejects, and keeps the accepted one', () => {
    const base = start(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 }))
    const first = command(base, 'auto-trim')!
    const twin = command(base, 'auto-trim')!
    const target = standIn(base)
    target.send(first)
    target.send(twin)
    const [kept, rejected] = images.created
    expect(target.state().documentBitmap).toBe(kept)
    expect(kept.released).toBe(false)
    expect(rejected.released).toBe(true)
  })

  it('runs the same in React Strict Mode: the reducer twice with one action gives the same state and holds the same image', () => {
    const base = start(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 }))
    const action = command(base, 'auto-trim')!
    const a = editorReducer(base, action)
    const b = editorReducer(base, action)
    expect(b.document).toBe(a.document)
    expect(b.documentBitmap).toBe(a.documentBitmap)
    expect(b.history.undo).toEqual(a.history.undo)
    expect(b.viewport).toEqual(a.viewport)
    expect(images.created).toHaveLength(1)
  })

  it('changes nothing when the display image cannot be created or the pixels cannot be read', () => {
    const before = click(start(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 })), 30, 20)
    images.failing = true
    const action = command(before, 'auto-trim')
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'auto-trim' } })
    const failed = editorReducer(before, action!)
    expect(failed.document).toBe(before.document)
    expect(failed.selection).toBe(before.selection)
    expect(failed.lastMagicWandOperation).toBe(before.lastMagicWandOperation)
    expect(failed.history).toBe(before.history)
    expect(failed.viewport).toBe(before.viewport)
    expect(failed.editDepth).toBe(0)
    expect(editErrorMessage(failed.editError!)).toBe(
      'Auto Trim could not be completed. The image and selection have not changed. There may not be enough memory for an image this large.',
    )
    expect(images.created).toHaveLength(0)
    images.failing = false
    // Trying again works, and clears the error.
    const retried = run(failed, 'auto-trim')
    expect(retried.editError).toBeNull()

    // Damaged pixels (a buffer of the wrong length) are reported, not thrown.
    const damaged: EditorState = {
      ...before,
      document: { ...before.document!, pixels: { width: 60, height: 40, data: new Uint8ClampedArray(12) } },
    }
    expect(autoTrimCommand(damaged, images.create)).toMatchObject({ type: 'edit-failed', error: { operation: 'auto-trim' } })
    expect(images.created).toHaveLength(1)
  })

  it('notices when making room for the trim drops older Undo steps, by memory or by count', () => {
    // A transparent border of different hidden colours: every removed pixel costs about 4 bytes.
    const original = framed(100, 80, { x: 30, y: 20, width: 40, height: 40 }, 4)
    /** Delete of the single pixel (x, 20) of the open image. */
    const smallDelete = (state: EditorState, x: number) => {
      const { width, height } = state.document!
      const data = new Uint8Array(width * height)
      data[20 * width + x] = 1
      return run(select(state, createSelectionMask(width, height, data)), 'delete-selection')
    }
    const withDeletes = (state: EditorState) => smallDelete(smallDelete(smallDelete(state, 40), 42), 44)

    // Measured with the default limits: three small Deletes, then the trim.
    const roomy = trim(withDeletes(start(original)), 0)
    const [d1, d2, d3, trimEntry] = roomy.history.undo
    expect(roomy.editNotice).not.toHaveProperty('droppedUndoSteps')
    expect(trimEntry.retainedBytes).toBeGreaterThan(20_000)
    expect(d1.retainedBytes + d2.retainedBytes + d3.retainedBytes).toBeLessThan(trimEntry.retainedBytes)

    // A budget with room for the trim and one Delete: the two oldest Deletes go.
    const maxBytes = trimEntry.retainedBytes + d3.retainedBytes
    const tight = trim(withDeletes(start(original, { maxEntries: 25, maxBytes })), 0)
    expect(tight.history.undo.map((entry) => entry.kind)).toEqual(['delete-selection', 'auto-trim'])
    expect(tight.history.retainedBytes).toBeLessThanOrEqual(maxBytes)
    expect(tight.editNotice).toMatchObject({ kind: 'applied', operation: 'auto-trim', droppedUndoSteps: 2 })
    expect(editNoticeText(tight.editNotice!)).toBe(
      'Auto Trim applied: 100 × 80 px trimmed to 40 × 40 px. Undo history is full, so the 2 oldest Undo steps are no longer available.',
    )
    expect(isShownEditNotice(tight.editNotice!)).toBe(true)
    // Undo still reaches the newest Delete kept, exactly.
    const back = run(run(tight, 'undo'), 'undo')
    expect(availableEditActions(back).undo).toBeNull()

    // The trim alone above the budget is kept, every older step dropped.
    const beforeAlone = withDeletes(start(original, { maxEntries: 25, maxBytes: 1000 }))
    expect(beforeAlone.history.undo.length).toBeGreaterThan(0)
    const alone = trim(beforeAlone, 0)
    expect(alone.history.undo).toHaveLength(1)
    expect(alone.editNotice).toMatchObject({ droppedUndoSteps: beforeAlone.history.undo.length })

    // By count: the 26th step of a history limited to 3 drops the oldest one.
    const counted = trim(withDeletes(start(original, { maxEntries: 3, maxBytes: 256 * 1024 * 1024 })), 0)
    expect(counted.editNotice).toMatchObject({ droppedUndoSteps: 1 })
    expect(editNoticeText(counted.editNotice!)).toContain('Undo history is full, so the oldest Undo step is no longer available.')

    // Delete records what it dropped too, but keeps its Step 6 announcement and is not shown.
    const fourth = smallDelete(counted, 12)
    expect(fourth.editNotice).toMatchObject({ operation: 'delete-selection', droppedUndoSteps: 1 })
    expect(editNoticeText(fourth.editNotice!)).toBe('Selection deleted: 1 pixel is now transparent.')
    expect(isShownEditNotice(fourth.editNotice!)).toBe(false)
  })

  it('a 4K image: a deleted background trimmed exactly, with a tiny history entry', () => {
    const width = 3840
    const height = 2160
    const data = new Uint8ClampedArray(width * height * 4)
    // Delete leaves one hidden colour (the white background) everywhere outside the object.
    for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 0], i)
    for (let y = 700; y < 1500; y++) {
      for (let x = 1200; x < 2600; x++) data.set([x & 255, y & 255, 90, y === 700 || x === 1200 ? 3 : 255], (y * width + x) * 4)
    }
    const original = createPixelBuffer(width, height, data)
    const trimmed = trim(start(original), 5)
    const kept = { x: 1195, y: 695, width: 1410, height: 810 }
    expect((trimmed.history.undo[0].patch as CropPatch).kept).toEqual(kept)
    expect(isCropOf(trimmed.document!.pixels, original, kept)).toBe(true)
    expect(trimmed.history.retainedBytes).toBeLessThan(4096)
    const undone = run(trimmed, 'undo')
    expect(undone.document!.pixels.data.length).toBe(data.length)
    expect(sameBytes(undone.document!.pixels, original)).toBe(true)
  })
})

describe('Auto Trim padding', () => {
  it('rounds and clamps to 0–50, ignores values that are not finite, and never touches the image', () => {
    const state = start(framed(30, 20, { x: 5, y: 5, width: 5, height: 5 }))
    expect(state.autoTrimPadding).toBe(5)
    const cases: [number, number][] = [
      [0, 0],
      [7, 7],
      [50, 50],
      [51, 50],
      [1e9, 50],
      [-3, 0],
      [12.4, 12],
      [12.5, 13],
    ]
    for (const [given, expected] of cases) {
      const next = withPadding(state, given)
      expect(next.autoTrimPadding).toBe(expected)
      expect(next.document).toBe(state.document)
      expect(next.history).toBe(state.history)
      expect(next.selection).toBe(state.selection)
      expect(next.viewport).toBe(state.viewport)
      expect(next.editFeedbackId).toBe(state.editFeedbackId)
    }
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(withPadding(state, bad)).toBe(state)
    // Setting the padding it already has returns the state itself.
    expect(withPadding(state, 5)).toBe(state)
    expect(images.created).toHaveLength(0)
  })

  it('is kept across trims, Undo and Redo, and used by the next Trim only', () => {
    let state = withPadding(start(framed(60, 40, { x: 20, y: 10, width: 20, height: 20 })), 3)
    state = trim(state)
    expect(state.autoTrimPadding).toBe(3)
    state = withPadding(state, 0)
    // Changing it after a trim does not touch the trimmed image.
    expect(state.document!.width).toBe(26)
    state = run(state, 'undo')
    expect(state.autoTrimPadding).toBe(0)
    state = run(state, 'redo')
    expect(state.autoTrimPadding).toBe(0)
    expect(trim(state).document!.width).toBe(20)
  })
})

describe('the edit notice message', () => {
  it('is dismissed without changing anything else', () => {
    const state = start(createPixelBuffer(4, 4, new Uint8ClampedArray(64)))
    const noop = accepted(state, command(state, 'auto-trim'))
    const dismissed = reduce(noop, { type: 'edit-notice-dismissed' })
    expect(dismissed.editNotice).toBeNull()
    expect(dismissed.editFeedbackId).toBe(noop.editFeedbackId)
    expect({ ...dismissed, editNotice: noop.editNotice }).toEqual(noop)
    expect(reduce(dismissed, { type: 'edit-notice-dismissed' })).toBe(dismissed)
  })

  it('is cleared when another image opens', () => {
    const state = start(createPixelBuffer(4, 4, new Uint8ClampedArray(64)))
    const noop = accepted(state, command(state, 'auto-trim'))
    const document = createImageDocument({ name: 'b.png', format: 'png', source: 'paste', fileSizeBytes: 1, pixels: createPixelBuffer(2, 2, new Uint8ClampedArray(16)) })
    const next = reduce(
      noop,
      { type: 'import-started', importId: 777 },
      { type: 'import-finished', importId: 777, result: { ok: true, document, bitmap: fakeBitmap(2, 2) } },
    )
    expect(next.editNotice).toBeNull()
  })
})
