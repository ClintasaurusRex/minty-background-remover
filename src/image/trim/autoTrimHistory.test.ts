import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSelectionCommand } from '../../editor/editCommands'
import { type EditorState, displayViewport, documentVersion } from '../../editor/editorState'
import type { CropPatch } from '../../editor/history/cropPatch'
import {
  type FakeDisplayImages,
  accepted,
  fakeDisplayImages,
  opened,
  randomInt,
  randomSource,
  reduce,
  sameBytes,
  sameSelection,
} from '../../editor/history/testFixtures'
import { type CompletedCrop, completedEditCommand, redoCommand, undoCommand } from '../../editor/historyCommands'
import { magicWandClick } from '../../editor/selectionCommands'
import type { PixelBuffer, Rectangle } from '../../editor/types'
import { edgeCases } from '../edit/edgeTestFixtures'
import { createPixelBuffer } from '../pixelBuffer'
import { createSelectionMask } from '../selection/selectionMask'
import { type AutoTrimPlan, autoTrimPixels, planAutoTrim } from './autoTrim'

/*
 * Auto Trim and the existing edit history (Phase 3 Step 10): a 'crop' plan's kept rectangle is
 * all an Auto Trim edit needs (CompletedCrop.kept), and the Step 3 crop patches and Step 5
 * history commands then record, undo and redo it exactly. These tests drive the commands and the
 * reducer directly; the application's Auto Trim (autoTrimCommand, Phase 3 Step 11) does the same,
 * tested in editor/autoTrimCommand.test.ts.
 */

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

/** The Auto Trim edit Step 11 would record for `plan`, computed from `state`. */
function trimEdit(state: EditorState, kept: Readonly<Rectangle>): CompletedCrop {
  return { kind: 'auto-trim', version: documentVersion(state)!, change: 'crop', kept, selection: null }
}

function cropPlan(plan: AutoTrimPlan): Extract<AutoTrimPlan, { kind: 'crop' }> {
  if (plan.kind !== 'crop') throw new Error(`Expected a crop, got ${plan.kind}`)
  return plan
}

/** Auto Trim of the open document as an accepted edit, with its plan. */
function trim(state: EditorState, padding: number): { state: EditorState; kept: Readonly<Rectangle> } {
  const { kept } = cropPlan(planAutoTrim(state.document!.pixels, { padding }))
  return { state: accepted(state, completedEditCommand(state, trimEdit(state, kept), images.create)), kept }
}
const undo = (state: EditorState) => accepted(state, undoCommand(state, images.create))
const redo = (state: EditorState) => accepted(state, redoCommand(state, images.create))

/** The trimmed pixels autoTrimPixels gives for `pixels`, failing unless it crops. */
function trimmedPixels(pixels: PixelBuffer, padding: number): PixelBuffer {
  const result = autoTrimPixels(pixels, { padding })
  if (result.kind !== 'crop') throw new Error(`Expected a crop, got ${result.kind}`)
  return result.pixels
}

/**
 * A width × height image: transparent everywhere, each pixel hiding its own colour (so a pixel
 * restored to another place shows), with content of varied alpha in `content`, holes included.
 */
function framedImage(width: number, height: number, content: Rectangle, random: () => number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), 0], p * 4)
  for (let y = content.y; y < content.y + content.height; y++) {
    for (let x = content.x; x < content.x + content.width; x++) {
      if (random() < 0.8) data[(y * width + x) * 4 + 3] = 1 + randomInt(random, 255)
    }
  }
  // The content's corners are visible, so its bounds are exactly `content`.
  for (const [x, y] of [[content.x, content.y], [content.x + content.width - 1, content.y + content.height - 1]]) data[(y * width + x) * 4 + 3] = 1
  return createPixelBuffer(width, height, data)
}

describe('Auto Trim with the edit history', () => {
  it('is recorded as a crop that Undo and Redo restore exactly, hidden colour and all', () => {
    const original = framedImage(14, 10, { x: 3, y: 2, width: 7, height: 5 }, randomSource(7))
    const start = opened(original)
    const { state: trimmed, kept } = trim(start, 1)
    expect(kept).toEqual({ x: 2, y: 1, width: 9, height: 7 })

    // The edit: the trimmed image, a new revision, its own display image, one crop entry.
    const expected = trimmedPixels(original, 1)
    expect(trimmed.document).toMatchObject({ id: start.document!.id, width: 9, height: 7 })
    expect(sameBytes(trimmed.document!.pixels, expected)).toBe(true)
    expect(trimmed.document!.revision).toBeGreaterThan(start.document!.revision)
    expect(trimmed.documentBitmap).toBe(images.created.at(-1))
    expect(trimmed.history.undo).toHaveLength(1)
    const patch = trimmed.history.undo[0].patch as CropPatch
    expect(patch).toMatchObject({ kind: 'crop-patch', width: 14, height: 10, kept })
    expect(trimmed.history.undo[0].kind).toBe('auto-trim')

    // Undo, Redo, three times over: the original size and every byte (removed pixels included), then the trim again.
    let state = trimmed
    let revision = trimmed.document!.revision
    for (let cycle = 0; cycle < 3; cycle++) {
      state = undo(state)
      expect(state.document).toMatchObject({ width: 14, height: 10 })
      expect(sameBytes(state.document!.pixels, original)).toBe(true)
      expect(state.document!.revision).toBeGreaterThan(revision)
      revision = state.document!.revision
      expect(state.documentBitmap).toMatchObject({ width: 14, height: 10 })

      state = redo(state)
      expect(state.document).toMatchObject({ width: 9, height: 7 })
      expect(sameBytes(state.document!.pixels, expected)).toBe(true)
      expect(state.document!.revision).toBeGreaterThan(revision)
      revision = state.document!.revision
    }
    // The opened pixels were never written.
    expect(sameBytes(start.document!.pixels, original)).toBe(true)
  })

  it('records nothing for a rectangle that keeps the whole image', () => {
    const pixels = framedImage(6, 5, { x: 0, y: 0, width: 6, height: 5 }, randomSource(3))
    const state = opened(pixels)
    expect(planAutoTrim(pixels, { padding: 0 }).kind).toBe('unchanged')
    // Even if an 'unchanged' result were passed on as the whole image, no entry or revision would be made.
    expect(completedEditCommand(state, trimEdit(state, { x: 0, y: 0, width: 6, height: 5 }), images.create)).toBeNull()
    expect(images.created).toHaveLength(0)
  })

  it('follows a Magic Wand click and Delete with edge settings; two Undos give back the original and its selection', () => {
    const logo = edgeCases().find((edgeCase) => edgeCase.name === 'anti-aliased logo on blue')!
    let state = opened(logo.observed)
    state = reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: 10 }, { type: 'edge-settings-changed', settings: { cleanup: 1, feather: 1 } })
    // A real click on the blue background, as the canvas reports it.
    const viewport = displayViewport(state)!
    state = accepted(state, magicWandClick(state, { x: viewport.offset.x + 0.5 * viewport.zoom, y: viewport.offset.y + 0.5 * viewport.zoom }, 'new'))
    const selected = state
    const deleted = accepted(state, deleteSelectionCommand(state, images.create))
    const deletedPixels = deleted.document!.pixels

    const { state: trimmed, kept } = trim(deleted, 5)
    expect(sameBytes(trimmed.document!.pixels, trimmedPixels(deletedPixels, 5))).toBe(true)
    expect(kept.width).toBeLessThan(logo.observed.width)
    expect(trimmed.history.undo.map((entry) => entry.kind)).toEqual(['delete-selection', 'auto-trim'])

    const untrimmed = undo(trimmed)
    expect(sameBytes(untrimmed.document!.pixels, deletedPixels)).toBe(true)
    expect(untrimmed.selection).toBeNull()
    const restored = undo(untrimmed)
    // Exactly the opened pixels: the trim kept the colour hidden under the deleted background,
    // which the Delete's own patch needs to restore it.
    expect(sameBytes(restored.document!.pixels, logo.observed)).toBe(true)
    expect(sameSelection(restored.selection, selected.selection)).toBe(true)
    expect(restored.lastMagicWandOperation).toMatchObject({ seed: { x: 0, y: 0 }, tolerance: 10, version: documentVersion(restored) })

    const again = redo(redo(restored))
    expect(sameBytes(again.document!.pixels, trimmed.document!.pixels)).toBe(true)
  })

  it('keeps hidden colour in the trimmed-off border exactly, so undoing an earlier Delete still restores its colours', () => {
    // A photo-like image whose surroundings are deleted: the border holds varied hidden colour.
    const random = randomSource(99)
    const width = 40
    const height = 30
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = randomInt(random, 256)
    for (let p = 0; p < width * height; p++) data[p * 4 + 3] = 255
    const original = createPixelBuffer(width, height, data)
    let state = opened(original)
    const outside = new Uint8Array(width * height).fill(1)
    for (let y = 10; y < 20; y++) outside.fill(0, y * width + 12, y * width + 30)
    state = accepted(state, { type: 'selection-applied', version: documentVersion(state)!, selection: createSelectionMask(width, height, outside) })
    state = accepted(state, deleteSelectionCommand(state, images.create))
    const { state: trimmed } = trim(state, 0)
    expect(trimmed.document).toMatchObject({ width: 18, height: 10 })
    const back = undo(undo(trimmed))
    expect(sameBytes(back.document!.pixels, original)).toBe(true)
  })

  it('stores the removed border compactly when it is transparent black or one hidden colour', () => {
    const width = 3840
    const height = 2160
    for (const hidden of [[0, 0, 0], [235, 238, 240]]) {
      const data = new Uint8ClampedArray(width * height * 4)
      for (let p = 0; p < width * height; p++) data.set([hidden[0], hidden[1], hidden[2], 0], p * 4)
      for (let y = 900; y < 1300; y++) for (let x = 1700; x < 2100; x++) data.set([x & 255, y & 255, 90, 255], (y * width + x) * 4)
      const original = createPixelBuffer(width, height, data)
      const { state: trimmed } = trim(opened(original), 5)
      expect(trimmed.document).toMatchObject({ width: 410, height: 410 })
      // About 8.1 M removed pixels, in a few hundred bytes plus the object estimates.
      expect(trimmed.history.retainedBytes).toBeLessThan(4096)
      expect(sameBytes(undo(trimmed).document!.pixels, original)).toBe(true)
    }
  })

  it('records, undoes and redoes random trims exactly, also one after another', () => {
    const random = randomSource(1234)
    let trims = 0
    let secondTrims = 0
    for (let n = 0; n < 60; n++) {
      const width = 2 + randomInt(random, 20)
      const height = 2 + randomInt(random, 20)
      const cw = 1 + randomInt(random, width - 1)
      const ch = 1 + randomInt(random, height - 1)
      const content = { x: randomInt(random, width - cw + 1), y: randomInt(random, height - ch + 1), width: cw, height: ch }
      const original = framedImage(width, height, content, random)
      const label = `case ${n}`
      const first = randomInt(random, 4) + 2
      const start = opened(original)
      const plan = planAutoTrim(original, { padding: first })
      if (plan.kind !== 'crop') continue
      trims++
      const { state: once } = trim(start, first)
      expect(sameBytes(once.document!.pixels, trimmedPixels(original, first)), label).toBe(true)

      // A tighter trim of the trimmed image, then both undone and redone.
      const secondPlan = planAutoTrim(once.document!.pixels, { padding: 0 })
      let last = once
      if (secondPlan.kind === 'crop') {
        secondTrims++
        last = trim(once, 0).state
        expect(sameBytes(last.document!.pixels, trimmedPixels(original, 0)), label).toBe(true)
        expect(sameBytes(undo(last).document!.pixels, once.document!.pixels), label).toBe(true)
        last = redo(undo(last))
      }
      let state = last
      while (state.history.undo.length > 0) state = undo(state)
      expect(sameBytes(state.document!.pixels, original), label).toBe(true)
      while (state.history.redo.length > 0) state = redo(state)
      expect(sameBytes(state.document!.pixels, last.document!.pixels), label).toBe(true)
    }
    expect(trims).toBeGreaterThanOrEqual(20)
    expect(secondTrims).toBeGreaterThanOrEqual(10)
  })
})
