import { beforeEach, describe, expect, it } from 'vitest'
import { createImportError } from '../image/import/errors'
import { deleteSelectedPixels } from '../image/edit/deleteSelection'
import { type EdgeSettings, deleteSelectionWithEdges } from '../image/edit/deleteWithEdges'
import { disc, edgeCases, randomEdgeCase, rect, ring, scene, solid, stroke } from '../image/edit/edgeTestFixtures'
import { createPixelBuffer } from '../image/pixelBuffer'
import { selectAll } from '../image/selection/selectionOperations'
import { type Rgba, imageFromRows } from '../image/selection/testFixtures'
import { adjustDeleteCommand, adjustableDelete, availableEditActions, editActionCommand, hasUnexportedEdits } from './editCommands'
import { editErrorMessage, editNoticeText } from './editFeedback'
import {
  type EditorAction,
  type EditorState,
  displayViewport,
  documentVersion,
  editorReducer,
  initialEditorState,
  mergeEdgeSettings,
} from './editorState'
import { createEditHistory, historyRetainedBytes } from './history/editHistory'
import type { HistoryEntry } from './history/historyEntry'
import { applyPixelPatch } from './history/pixelPatch'
import {
  type FakeDisplayImages,
  WORKSPACE,
  accepted,
  fakeDisplayImages,
  opened,
  randomSource,
  reachable,
  reduce,
  sameBytes,
  sameSelection,
} from './history/testFixtures'
import { createImageDocument } from './imageDocument'
import { commitToleranceCommand, magicWandClick, selectionActionCommand } from './selectionCommands'
import type { PixelBuffer, SelectionMask, SelectionMode } from './types'

/*
 * Adjusting the last Delete (Phase 3 Step 9): after Delete Selection, a committed Edge cleanup or
 * Feather amount makes the Delete again from the pixels before it and the selection it deleted,
 * replacing its history entry. Commands and reducer together, with real Magic Wand clicks; display
 * images are fakes recording what was created and released.
 */

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
const open = (pixels: PixelBuffer, limits?: { maxEntries: number; maxBytes: number }) =>
  opened(pixels, limits ? { ...measured, history: createEditHistory(limits) } : measured)

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const command = (state: EditorState, action: 'delete-selection' | 'undo' | 'redo') => editActionCommand(state, action, images.create)
const run = (state: EditorState, action: 'delete-selection' | 'undo' | 'redo') => accepted(state, command(state, action))

/** A real Magic Wand click on image pixel (x, y), as the canvas reports it. */
function click(state: EditorState, x: number, y: number, mode: SelectionMode = 'new'): EditorState {
  const viewport = displayViewport(state)!
  const point = { x: viewport.offset.x + (x + 0.5) * viewport.zoom, y: viewport.offset.y + (y + 0.5) * viewport.zoom }
  return accepted(state, magicWandClick(state, point, mode))
}

const tolerance = (state: EditorState, value: number) => reduce(state, { type: 'magic-wand-tolerance-changed', tolerance: value })
const amounts = (state: EditorState, settings: Partial<EdgeSettings>) => reduce(state, { type: 'edge-settings-changed', settings })
const select = (state: EditorState, selection: SelectionMask | null) => accepted(state, { type: 'selection-applied', version: documentVersion(state)!, selection })

/**
 * A finished amount adjustment as the application runs it (app/useEditCommands.ts): the amount is
 * set, then the adjustment computed from the state before it, with the full amounts it gives, is
 * dispatched after it. Returns the state and the adjustment action (null when nothing was adjusted).
 */
function commitAmounts(state: EditorState, change: Partial<EdgeSettings>): { state: EditorState; action: EditorAction | null } {
  const action = adjustDeleteCommand(state, mergeEdgeSettings(state.edgeSettings, change), images.create)
  const set = reduce(state, { type: 'edge-settings-changed', settings: change })
  return { state: action ? editorReducer(set, action) : set, action }
}

/** commitAmounts, which must adjust the Delete: fails the test otherwise. */
function adjusted(state: EditorState, change: Partial<EdgeSettings>): EditorState {
  const { state: next, action } = commitAmounts(state, change)
  if (!action) throw new Error('Nothing was adjusted')
  if (action.type === 'edit-failed') throw new Error(`The adjustment failed: ${action.error.detail}`)
  if (next.document === state.document) throw new Error('The reducer rejected the adjustment')
  return next
}

/** The anti-aliased logo scene (Step 7 kind) with its background clicked at tolerance 10. */
function logoSelected(): EditorState {
  const logo = edgeCases().find((c) => c.name === 'anti-aliased logo on blue')!
  return click(tolerance(open(logo.observed), 10), 0, 0)
}

/** `state` (with a selection) deleted with `settings`: the state before and after, and what Delete must leave. */
function deleteWith(state: EditorState, settings: EdgeSettings) {
  const before = amounts(state, settings)
  const deleted = run(before, 'delete-selection')
  return { before, deleted, original: Uint8ClampedArray.from(before.document!.pixels.data), selection: before.selection! }
}

const expected = (original: PixelBuffer, selection: SelectionMask, settings: EdgeSettings) => deleteSelectionWithEdges(original, selection, settings)!
const latest = (state: EditorState): HistoryEntry => state.history.undo.at(-1)!

/** Byte-for-byte equality of two byte arrays (pixels, patch runs). */
function equalBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** The image before the latest edit, from its patch (a pixel patch for Delete). */
function beforeLatest(state: EditorState): PixelBuffer {
  const { patch } = latest(state)
  if (patch.kind !== 'pixel-patch') throw new Error('Expected a pixel patch')
  return applyPixelPatch(state.document!.pixels, patch)
}

describe('Adjusting the last Delete (Phase 3 Step 9)', () => {
  it('right after a Delete, Edge cleanup makes it again from the original pixels and selection, as one edit', () => {
    const { before, deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const entry = latest(deleted)
    expect(adjustableDelete(deleted)).toBe(entry)
    expect(entry.edgeSettings).toEqual({ cleanup: 0, feather: 0 })
    const created = images.created.length

    const after = adjusted(deleted, { cleanup: 2 })
    const result = expected(before.document!.pixels, before.selection!, { cleanup: 2, feather: 0 })
    expect(result.edgePixels).toBeGreaterThan(0)
    expect(sameBytes(after.document!.pixels, result.pixels)).toBe(true)
    // One edit: the entry replaced, the same depth, nothing to redo.
    expect(after.history.undo).toHaveLength(1)
    expect(after.history.redo).toHaveLength(0)
    expect(latest(after)).not.toBe(entry)
    expect(latest(after).edgeSettings).toEqual({ cleanup: 2, feather: 0 })
    expect(latest(after).selectionBefore).toBe(entry.selectionBefore)
    expect(latest(after).magicWandBefore).toBe(entry.magicWandBefore)
    expect(after.editDepth).toBe(1)
    expect(hasUnexportedEdits(after)).toBe(true)
    // A new revision and its own display image; selection and click still clear; the view and settings kept.
    expect(after.document!.revision).toBeGreaterThan(deleted.document!.revision)
    expect(after.document!.id).toBe(deleted.document!.id)
    expect(images.created).toHaveLength(created + 1)
    expect(after.documentBitmap).toBe(images.created.at(-1))
    expect(images.created.every((image) => !image.released)).toBe(true)
    expect(after.selection).toBeNull()
    expect(after.lastMagicWandOperation).toBeNull()
    expect(after.viewport).toBe(deleted.viewport)
    expect(after.edgeSettings).toEqual({ cleanup: 2, feather: 0 })
    // Still adjustable, now through the replacement.
    expect(after.adjustableEdit).toBe(latest(after))
    expect(adjustableDelete(after)).toBe(latest(after))
    expect(after.editNotice).toEqual({ kind: 'adjusted', operation: 'delete-selection', edgeSettings: { cleanup: 2, feather: 0 }, edgePixels: result.edgePixels })
    expect(after.editFeedbackId).toBe(deleted.editFeedbackId + 1)
  })

  it('Feather makes it again in the same way', () => {
    const { before, deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    const after = adjusted(deleted, { feather: 3 })
    const result = expected(before.document!.pixels, before.selection!, { cleanup: 1, feather: 3 })
    expect(sameBytes(after.document!.pixels, result.pixels)).toBe(true)
    expect(latest(after).edgeSettings).toEqual({ cleanup: 1, feather: 3 })
    expect(after.history.undo).toHaveLength(1)
  })

  it('consecutive adjustments never build on earlier results; the same amounts always give the same bytes', () => {
    const { before, deleted, original } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const pixels = before.document!.pixels
    const results = new Map<string, Uint8ClampedArray>()
    let state = deleted
    let revision = deleted.document!.revision
    for (const [cleanup, feather] of [[1, 0], [3, 0], [3, 2], [5, 5], [0, 5], [2, 2], [1, 0], [5, 5], [0, 0], [3, 2]]) {
      state = adjusted(state, { cleanup, feather })
      const tag = `${cleanup}/${feather}`
      const fresh = expected(pixels, before.selection!, { cleanup, feather })
      expect(sameBytes(state.document!.pixels, fresh.pixels), tag).toBe(true)
      const seen = results.get(tag)
      if (seen) expect(equalBytes(seen, state.document!.pixels.data), tag).toBe(true)
      results.set(tag, Uint8ClampedArray.from(state.document!.pixels.data))
      // The entry's patch still gives back the original image exactly.
      expect(equalBytes(beforeLatest(state).data, original), tag).toBe(true)
      expect(state.history.undo, tag).toHaveLength(1)
      expect(state.history.retainedBytes, tag).toBe(historyRetainedBytes(state.history.undo))
      expect(state.document!.revision, tag).toBeGreaterThan(revision)
      revision = state.document!.revision
      expect(state.editDepth, tag).toBe(1)
    }
  })

  it('back at 0 / 0 it is exactly the Step 6 Delete, with the same patch as a Delete made at 0 / 0', () => {
    const { before, deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const plain = latest(deleted)
    const back = adjusted(adjusted(adjusted(deleted, { cleanup: 4 }), { feather: 2 }), { cleanup: 0, feather: 0 })
    const exact = deleteSelectedPixels(before.document!.pixels, before.selection)!
    expect(sameBytes(back.document!.pixels, exact.pixels)).toBe(true)
    expect(sameBytes(back.document!.pixels, deleted.document!.pixels)).toBe(true)
    const patch = latest(back).patch
    if (patch.kind !== 'pixel-patch' || plain.patch.kind !== 'pixel-patch') throw new Error('Expected pixel patches')
    expect(patch.region).toEqual(plain.patch.region)
    expect(patch.changedPixels).toBe(plain.patch.changedPixels)
    expect(equalBytes(patch.changes.tokens, plain.patch.changes.tokens)).toBe(true)
    expect(equalBytes(patch.changes.literals, plain.patch.changes.literals)).toBe(true)
    expect(latest(back).retainedBytes).toBe(plain.retainedBytes)
    expect(back.editNotice).toEqual({ kind: 'adjusted', operation: 'delete-selection', edgeSettings: { cleanup: 0, feather: 0 }, edgePixels: 0 })
  })

  it('one Undo restores the image before the Delete byte for byte, with its selection and click; Redo the latest result', () => {
    const { before, deleted, original } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    const after = adjusted(adjusted(adjusted(deleted, { cleanup: 5 }), { feather: 4 }), { cleanup: 2 })
    const result = Uint8ClampedArray.from(after.document!.pixels.data)
    const undone = run(after, 'undo')
    expect(equalBytes(undone.document!.pixels.data, original)).toBe(true)
    expect(sameSelection(undone.selection, before.selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toMatchObject({ seed: { x: 0, y: 0 }, tolerance: 10, selectionMode: 'new' })
    expect(undone.editDepth).toBe(0)
    expect(hasUnexportedEdits(undone)).toBe(false)
    expect(availableEditActions(undone)).toEqual({ deleteSelection: true, autoTrim: true, crop: false, undo: null, redo: 'delete-selection' })
    // The click re-applies exactly as before the Delete.
    const reapplied = reduce(undone, ...commitToleranceCommand(undone, 30))
    expect(sameSelection(reduce(reapplied, ...commitToleranceCommand(reapplied, 10)).selection, before.selection)).toBe(true)
    // Redo: the latest adjusted result, which can be adjusted again.
    const redone = run(undone, 'redo')
    expect(equalBytes(redone.document!.pixels.data, result)).toBe(true)
    expect(redone.selection).toBeNull()
    expect(redone.editDepth).toBe(1)
    expect(adjustableDelete(redone)).toBe(latest(after))
    const again = adjusted(redone, { cleanup: 0, feather: 0 })
    expect(sameBytes(again.document!.pixels, deleteSelectedPixels(before.document!.pixels, before.selection)!.pixels)).toBe(true)
    expect(equalBytes(run(again, 'undo').document!.pixels.data, original)).toBe(true)
  })

  it('random images and selections: every RGB and alpha byte exact, hidden colour included, through adjustments, Undo and Redo', () => {
    const random = randomSource(9)
    const amount = () => Math.floor(random() * 6)
    let cases = 0
    for (let seed = 0; cases < 40 && seed < 200; seed++) {
      const generated = randomEdgeCase(random)
      if (!generated) continue
      const start = select(open(generated.pixels), generated.selection)
      const first = { cleanup: amount(), feather: amount() }
      const action = command(amounts(start, first), 'delete-selection')!
      if (action.type !== 'edit-applied') continue // only fully transparent pixels selected: nothing to adjust
      cases++
      const original = Uint8ClampedArray.from(generated.pixels.data)
      let state = editorReducer(amounts(start, first), action)
      for (let n = 0; n < 4; n++) {
        const settings = { cleanup: amount(), feather: amount() }
        const sameAsNow = settings.cleanup === latest(state).edgeSettings!.cleanup && settings.feather === latest(state).edgeSettings!.feather
        const committed = commitAmounts(state, settings)
        if (sameAsNow) {
          expect(committed.action).toBeNull()
          state = committed.state
          continue
        }
        state = committed.state
        expect(sameBytes(state.document!.pixels, expected(generated.pixels, generated.selection, settings).pixels), `case ${seed}, ${n}`).toBe(true)
        expect(state.history.undo).toHaveLength(1)
      }
      const last = Uint8ClampedArray.from(state.document!.pixels.data)
      const undone = run(state, 'undo')
      expect(equalBytes(undone.document!.pixels.data, original), `case ${seed} Undo`).toBe(true)
      expect(sameSelection(undone.selection, generated.selection)).toBe(true)
      expect(equalBytes(run(undone, 'redo').document!.pixels.data, last), `case ${seed} Redo`).toBe(true)
    }
    expect(cases).toBe(40)
  })

  it('leaves earlier Deletes alone: their entries, the count and the accounting', () => {
    const logo = edgeCases().find((c) => c.name === 'anti-aliased logo on blue')!
    let state = tolerance(open(logo.observed), 10)
    // Two earlier Deletes (the white stroke's area, then the ring's inside), then the background.
    state = run(click(state, 60, 20), 'delete-selection')
    state = run(click(state, 25, 30), 'delete-selection')
    const earlier = [...state.history.undo]
    const { before, deleted } = deleteWith(click(state, 0, 0), { cleanup: 0, feather: 0 })
    const replaced = latest(deleted)
    const after = adjusted(adjusted(deleted, { cleanup: 3, feather: 1 }), { cleanup: 5 })
    expect(after.history.undo).toHaveLength(3)
    expect(after.history.undo[0]).toBe(earlier[0])
    expect(after.history.undo[1]).toBe(earlier[1])
    expect(after.editDepth).toBe(3)
    expect(after.history.retainedBytes).toBe(historyRetainedBytes(after.history.undo))
    // The replaced entries' patches are no longer kept; the shared selection is kept once.
    const kept = reachable(after.history).buffers
    if (replaced.patch.kind !== 'pixel-patch') throw new Error('Expected a pixel patch')
    expect(kept.has(replaced.patch.changes.tokens.buffer)).toBe(false)
    expect(latest(after).selectionBefore).toBe(replaced.selectionBefore)
    expect(sameBytes(after.document!.pixels, expected(before.document!.pixels, before.selection!, { cleanup: 5, feather: 1 }).pixels)).toBe(true)
    // Three Undos go back to the opened image; Undo of the adjusted Delete first.
    const once = run(after, 'undo')
    expect(sameBytes(once.document!.pixels, before.document!.pixels)).toBe(true)
    const all = run(run(once, 'undo'), 'undo')
    expect(sameBytes(all.document!.pixels, logo.observed)).toBe(true)
    expect(all.editDepth).toBe(0)
  })

  it('a larger result can drop the oldest entries to stay within the memory limit, never the Delete itself', () => {
    const logo = edgeCases().find((c) => c.name === 'anti-aliased logo on blue')!
    // Measure the entries first, then set a budget that two plain Deletes fit and the 5 / 5 one does not.
    const probe = run(click(tolerance(open(logo.observed), 10), 60, 20), 'delete-selection')
    const firstBytes = probe.history.retainedBytes
    const plain = run(click(probe, 0, 0), 'delete-selection')
    const budget = plain.history.retainedBytes + 16
    let state = tolerance(open(logo.observed, { maxEntries: 25, maxBytes: budget }), 10)
    state = run(click(state, 60, 20), 'delete-selection')
    const deleted = run(click(state, 0, 0), 'delete-selection')
    expect(deleted.history.undo).toHaveLength(2)
    const after = adjusted(deleted, { cleanup: 5, feather: 5 })
    expect(latest(after).retainedBytes + firstBytes).toBeGreaterThan(budget)
    expect(after.history.undo).toEqual([latest(after)])
    expect(after.history.retainedBytes).toBe(latest(after).retainedBytes)
    // The Delete itself still undoes exactly; the dropped one can no longer be undone.
    const undone = run(after, 'undo')
    expect(sameBytes(undone.document!.pixels, state.document!.pixels)).toBe(true)
    expect(availableEditActions(undone).undo).toBeNull()
  })
})

describe('When the last Delete is not adjusted (Phase 3 Step 9)', () => {
  /** Whether committing `change` in `state` computes or changes anything. */
  function expectNothingAdjusted(state: EditorState, change: Partial<EdgeSettings>, what: string) {
    const created = images.created.length
    expect(adjustableDelete(state), what).toBeNull()
    const { state: next, action } = commitAmounts(state, change)
    expect(action, what).toBeNull()
    expect(images.created, what).toHaveLength(created)
    expect(next.document, what).toBe(state.document)
    expect(next.history, what).toBe(state.history)
    expect(next.selection, what).toBe(state.selection)
    expect(next.lastMagicWandOperation, what).toBe(state.lastMagicWandOperation)
    return next
  }

  it('the amounts only set the next Delete without an image, before any Delete and with a selection', () => {
    expectNothingAdjusted(measured, { cleanup: 3 }, 'no image')
    const selected = logoSelected()
    const set = expectNothingAdjusted(selected, { cleanup: 3, feather: 1 }, 'a selection, no Delete yet')
    expect(set.edgeSettings).toEqual({ cleanup: 3, feather: 1 })
  })

  it('a new selection after the Delete is for the next Delete: the amounts set it, the earlier Delete stays', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    // Click inside the ring (the blue there) for a second Delete.
    const selected = click(deleted, 25, 30)
    expect(selected.adjustableEdit).toBeNull()
    const set = expectNothingAdjusted(selected, { cleanup: 4, feather: 2 }, 'a new selection')
    const second = run(set, 'delete-selection')
    expect(sameBytes(second.document!.pixels, expected(selected.document!.pixels, selected.selection!, { cleanup: 4, feather: 2 }).pixels)).toBe(true)
    expect(second.history.undo).toHaveLength(2)
    expect(latest(second).edgeSettings).toEqual({ cleanup: 4, feather: 2 })
    // The second Delete is now the adjustable one.
    expect(adjustableDelete(second)).toBe(latest(second))
  })

  it('any selection change ends it, even one that leaves nothing selected again', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    const all = select(deleted, selectAll(deleted.document!.width, deleted.document!.height))
    expect(all.adjustableEdit).toBeNull()
    const cleared = reduce(all, { type: 'selection-cleared' })
    expect(cleared.selection).toBeNull()
    expectNothingAdjusted(cleared, { cleanup: 3 }, 'Select All, then Clear')
    // Select All, then Invert: nothing selected again, through selection-applied.
    const inverted = accepted(all, selectionActionCommand(all, 'invert'))
    expect(inverted.selection).toBeNull()
    expectNothingAdjusted(inverted, { cleanup: 3 }, 'Select All, then Invert')
    // Each selection action forgets the adjustable Delete by itself, not only through the selection it leaves.
    const forced = { ...all, adjustableEdit: deleted.adjustableEdit }
    expect(reduce(forced, { type: 'selection-cleared' }).adjustableEdit).toBeNull()
    // A Subtract click with nothing selected selects nothing but records the click.
    const subtracted = click(deleted, 25, 30, 'subtract')
    expect(subtracted.selection).toBeNull()
    expectNothingAdjusted(subtracted, { cleanup: 3 }, 'a Subtract click with nothing selected')
  })

  it('Undo brings back the selection for the next Delete: the amounts set it, and the click is not re-applied', () => {
    const { before, deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    const undone = run(deleted, 'undo')
    expect(undone.adjustableEdit).toBeNull()
    const set = expectNothingAdjusted(undone, { cleanup: 3, feather: 2 }, 'after Undo')
    expect(sameSelection(set.selection, before.selection)).toBe(true)
    // Delete again uses the new amounts.
    const again = run(set, 'delete-selection')
    expect(sameBytes(again.document!.pixels, expected(before.document!.pixels, before.selection!, { cleanup: 3, feather: 2 }).pixels)).toBe(true)
    expect(again.history.redo).toHaveLength(0)
  })

  it('not while something can be redone: an earlier Delete redone under a later one stays as it is', () => {
    const logo = edgeCases().find((c) => c.name === 'anti-aliased logo on blue')!
    let state = tolerance(open(logo.observed), 10)
    state = run(click(state, 0, 0), 'delete-selection')
    state = run(click(state, 25, 30), 'delete-selection')
    const redoneFirst = run(run(run(state, 'undo'), 'undo'), 'redo')
    expect(redoneFirst.history.redo).toHaveLength(1)
    expect(redoneFirst.selection).toBeNull()
    expectNothingAdjusted(redoneFirst, { cleanup: 2 }, 'with a Delete left to redo')
    // Redoing the second makes it the adjustable one.
    const redone = run(redoneFirst, 'redo')
    expect(adjustableDelete(redone)).toBe(latest(redone))
  })

  it('not after another image is opened, nor while one is opening; a failed import keeps it', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    expectNothingAdjusted(opened(imageFromRows({ w: [250, 250, 250, 255] }, 'ww', 'ww'), deleted), { cleanup: 3 }, 'another image')
    const opening = reduce(deleted, { type: 'import-started', importId: 501 })
    expectNothingAdjusted(opening, { cleanup: 3 }, 'while another image opens')
    const failed = reduce(opening, { type: 'import-finished', importId: 501, result: { ok: false, error: createImportError('decode-failed') } })
    expect(adjustableDelete(failed)).toBe(latest(deleted))
    expect(adjusted(failed, { cleanup: 3 }).history.undo).toHaveLength(1)
  })

  it('committing the amounts its result was made with computes nothing', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 2, feather: 1 })
    const created = images.created.length
    expect(adjustDeleteCommand(deleted, { cleanup: 2, feather: 1 }, images.create)).toBeNull()
    expect(commitAmounts(deleted, { cleanup: 2 }).action).toBeNull()
    expect(images.created).toHaveLength(created)
    // After Redo, the amounts set meanwhile can differ from the result's: committing them adjusts it.
    const undone = amounts(run(deleted, 'undo'), { cleanup: 4 })
    const redone = run(undone, 'redo')
    expect(redone.edgeSettings).toEqual({ cleanup: 4, feather: 1 })
    expect(latest(redone).edgeSettings).toEqual({ cleanup: 2, feather: 1 })
    expect(latest(adjusted(redone, { cleanup: 4 })).edgeSettings).toEqual({ cleanup: 4, feather: 1 })
  })

  it('Magic Wand options are not Delete adjustments: they change neither the image nor what can be adjusted', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 1, feather: 0 })
    let state = reduce(deleted, ...commitToleranceCommand(deleted, 45))
    state = reduce(state, { type: 'magic-wand-flood-mode-changed', floodMode: 'global' }, { type: 'magic-wand-selection-mode-changed', selectionMode: 'add' })
    expect(state.document).toBe(deleted.document)
    expect(state.history).toBe(deleted.history)
    expect(state.selection).toBeNull()
    expect(adjustableDelete(state)).toBe(latest(deleted))
    // View changes and dismissals keep it as well.
    state = reduce(state, { type: 'zoom-stepped', direction: 1 }, { type: 'wheel-panned', delta: { x: 5, y: 3 } }, { type: 'edit-error-dismissed' })
    expect(adjustableDelete(state)).toBe(latest(deleted))
  })
})

describe('Adjustment actions the reducer rejects (Phase 3 Step 9)', () => {
  const adjustAction = (state: EditorState, settings: EdgeSettings) => {
    const action = adjustDeleteCommand(state, settings, images.create)
    if (!action || action.type !== 'edit-adjusted') throw new Error('Expected an adjustment')
    return action
  }

  it('two adjustments computed from the same state apply once', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const first = adjustAction(deleted, { cleanup: 1, feather: 0 })
    const second = adjustAction(deleted, { cleanup: 2, feather: 0 })
    const after = accepted(deleted, first)
    expect(editorReducer(after, second)).toBe(after)
  })

  it('an adjustment computed before a selection change, Undo, another image or a later adjustment is stale', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const action = adjustAction(deleted, { cleanup: 3, feather: 0 })
    const clicked = click(deleted, 25, 30)
    expect(editorReducer(clicked, action)).toBe(clicked)
    const cleared = reduce(clicked, { type: 'selection-cleared' })
    expect(editorReducer(cleared, action)).toBe(cleared)
    const undone = run(deleted, 'undo')
    expect(editorReducer(undone, action)).toBe(undone)
    const redone = run(undone, 'redo')
    expect(editorReducer(redone, action)).toBe(redone)
    const another = opened(deleted.document!.pixels, deleted)
    expect(editorReducer(another, action)).toBe(another)
    const later = adjusted(deleted, { feather: 2 })
    expect(editorReducer(later, action)).toBe(later)
  })

  it('refuses an entry that is not the adjustable one, and results of another size or image', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const action = adjustAction(deleted, { cleanup: 1, feather: 0 })
    const frozen = deepFreeze(deleted)
    expect(editorReducer(frozen, { ...action, entry: action.replacement })).toBe(frozen)
    expect(editorReducer(frozen, { ...action, replacement: { ...action.replacement, kind: 'auto-trim' } })).toBe(frozen)
    const other = createImageDocument({ name: 'x.png', format: 'png', source: 'file-picker', fileSizeBytes: 1, pixels: action.document.pixels })
    expect(editorReducer(frozen, { ...action, document: { ...other, revision: action.document.revision } })).toBe(frozen)
    const small = createPixelBuffer(2, 2, new Uint8ClampedArray(16))
    expect(editorReducer(frozen, { ...action, document: { ...action.document, width: 2, height: 2, pixels: small } })).toBe(frozen)
    expect(editorReducer(frozen, { ...action, document: { ...action.document, revision: deleted.document!.revision } })).toBe(frozen)
    expect(accepted(frozen, action).document).toBe(action.document)
  })

  it('refuses an adjustment while something is selected or a click is recorded, even if the state still named the Delete', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const action = adjustAction(deleted, { cleanup: 2, feather: 0 })
    const clicked = click(deleted, 25, 30)
    const withSelection = { ...deleted, selection: clicked.selection }
    expect(editorReducer(withSelection, action)).toBe(withSelection)
    const withClick = { ...deleted, lastMagicWandOperation: clicked.lastMagicWandOperation }
    expect(editorReducer(withClick, action)).toBe(withClick)
    expect(accepted(deleted, action).document).toBe(action.document)
  })

  it('never accepts an adjustment whose display image has been released', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const action = adjustAction(deleted, { cleanup: 2, feather: 0 })
    const image = images.created.at(-1)!
    // A released fake image, like a closed bitmap, has no size.
    Object.assign(image, { width: 0, height: 0 })
    expect(editorReducer(deleted, action)).toBe(deleted)
  })

  it('a failure changes nothing, reports the adjustment, and leaves the Delete adjustable', () => {
    const { before, deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    images.failing = true
    const { state: failed, action } = commitAmounts(deleted, { cleanup: 2 })
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'adjust' } })
    expect(failed.document).toBe(deleted.document)
    expect(failed.documentBitmap).toBe(deleted.documentBitmap)
    expect(failed.history).toBe(deleted.history)
    expect(failed.editError?.operation).toBe('adjust')
    expect(editErrorMessage(failed.editError!)).toBe(
      'The last Delete Selection could not be updated with the new Edge cleanup and Feather amounts. The image and selection have not changed. There may not be enough memory for an image this large.',
    )
    expect(adjustableDelete(failed)).toBe(latest(deleted))
    images.failing = false
    const retried = adjusted(failed, { cleanup: 2 })
    expect(sameBytes(retried.document!.pixels, expected(before.document!.pixels, before.selection!, { cleanup: 2, feather: 0 }).pixels)).toBe(true)
    expect(retried.editError).toBeNull()
  })

  it('React Strict Mode: running the reducer twice gives the same state and image, creating and releasing nothing', () => {
    const { deleted } = deleteWith(logoSelected(), { cleanup: 0, feather: 0 })
    const action = adjustAction(deleted, { cleanup: 2, feather: 2 })
    const created = images.created.length
    const once = editorReducer(deleted, action)
    const twice = editorReducer(deleted, action)
    expect(images.created).toHaveLength(created)
    expect(twice.document).toBe(once.document)
    expect(twice.documentBitmap).toBe(once.documentBitmap)
    expect(twice.history.undo[0]).toBe(once.history.undo[0])
    expect(twice.adjustableEdit).toBe(once.adjustableEdit)
    expect(images.created.every((image) => !image.released)).toBe(true)
  })
})

describe('Adjusting on particular images (Phase 3 Step 9)', () => {
  it('selected pixels already transparent or partly transparent, and hidden colour, stay exact', () => {
    const palette: Readonly<Record<string, Rgba>> = {
      w: [250, 250, 250, 255],
      k: [10, 10, 10, 255],
      t: [40, 200, 90, 128],
      h: [77, 88, 99, 0],
      g: [130, 130, 130, 255],
    }
    const pixels = imageFromRows(palette, 'wwwwwwww', 'whhwkkgw', 'wttwkkgw', 'wwwwggww', 'wwwwwwww')
    const start = tolerance(open(pixels), 40)
    const selected = reduce(start, { type: 'magic-wand-flood-mode-changed', floodMode: 'global' })
    const state = click(selected, 0, 0)
    // The selection covers the light background and some of the hidden-colour pixels' neighbours.
    const { before, deleted, original } = deleteWith(state, { cleanup: 0, feather: 0 })
    let adjustedState = deleted
    for (const settings of [{ cleanup: 5, feather: 0 }, { cleanup: 2, feather: 3 }, { cleanup: 0, feather: 0 }]) {
      adjustedState = adjusted(adjustedState, settings)
      expect(sameBytes(adjustedState.document!.pixels, expected(before.document!.pixels, before.selection!, settings).pixels)).toBe(true)
    }
    const undone = run(adjustedState, 'undo')
    expect(equalBytes(undone.document!.pixels.data, original)).toBe(true)
    // The hidden colour under alpha 0 is still there.
    expect([...undone.document!.pixels.data.subarray(4 * 9, 4 * 9 + 4)]).toEqual([77, 88, 99, 0])
  })

  it('thin lines and wiring: every adjustment equals a single Delete with those amounts, and the lines stay', () => {
    const lines = edgeCases().find((c) => c.name === 'lines and wiring')!
    const state = select(open(lines.observed), lines.selection)
    const { deleted } = deleteWith(state, { cleanup: 0, feather: 0 })
    let current = deleted
    for (const settings of [{ cleanup: 5, feather: 0 }, { cleanup: 5, feather: 5 }, { cleanup: 1, feather: 2 }]) {
      current = adjusted(current, settings)
      const fresh = expected(lines.observed, lines.selection, settings)
      expect(sameBytes(current.document!.pixels, fresh.pixels)).toBe(true)
      // Every pixel the Magic Wand left unselected and opaque on the 1 px horizontal line keeps some alpha.
      for (let x = 5; x < 75; x++) expect(current.document!.pixels.data[(5 * 80 + x) * 4 + 3]).toBeGreaterThan(0)
    }
  })

  it('a 1920 × 1080 image: several adjustments, Undo and Redo, exact', () => {
    const big = scene(1920, 1080, solid([236, 239, 244, 255]), [
      { shape: disc(500, 500, 300), colour: [30, 60, 120] },
      { shape: ring(1300, 520, 200, 260), colour: [200, 80, 20] },
      { shape: rect(900, 850, 1700, 1000), colour: [20, 20, 20] },
      { shape: stroke(100, 1000, 1800, 100, 1.5), colour: [0, 0, 0] },
    ], 2)
    const start = click(tolerance(open(big.observed), 12), 2, 2)
    const { before, deleted, original } = deleteWith(start, { cleanup: 1, feather: 0 })
    let state = deleted
    for (const settings of [{ cleanup: 3, feather: 0 }, { cleanup: 3, feather: 2 }, { cleanup: 0, feather: 0 }, { cleanup: 2, feather: 1 }]) {
      state = adjusted(state, settings)
      expect(sameBytes(state.document!.pixels, expected(before.document!.pixels, before.selection!, settings).pixels)).toBe(true)
      expect(state.history.undo).toHaveLength(1)
    }
    const result = Uint8ClampedArray.from(state.document!.pixels.data)
    const undone = run(state, 'undo')
    expect(equalBytes(undone.document!.pixels.data, original)).toBe(true)
    expect(equalBytes(run(undone, 'redo').document!.pixels.data, result)).toBe(true)
    // The entry stays compact: kilobytes, never an image or mask.
    expect(latest(state).retainedBytes).toBeLessThan(1024 * 1024)
    expect(reachable(state.history).buffers.size).toBeLessThan(10)
  })
})

describe('Announcing an adjusted Delete', () => {
  it('names the amounts used and the edge pixels they changed', () => {
    expect(editNoticeText({ kind: 'adjusted', operation: 'delete-selection', edgeSettings: { cleanup: 2, feather: 1 }, edgePixels: 1204 })).toBe(
      'Delete Selection updated with Edge cleanup 2 px and Feather 1 px: 1,204 edge pixels were cleaned up or feathered.',
    )
    expect(editNoticeText({ kind: 'adjusted', operation: 'delete-selection', edgeSettings: { cleanup: 1, feather: 0 }, edgePixels: 1 })).toBe(
      'Delete Selection updated with Edge cleanup 1 px and Feather 0 px: 1 edge pixel was cleaned up or feathered.',
    )
    expect(editNoticeText({ kind: 'adjusted', operation: 'delete-selection', edgeSettings: { cleanup: 0, feather: 0 }, edgePixels: 0 })).toBe(
      'Delete Selection updated with Edge cleanup 0 px and Feather 0 px: no edge pixels were changed.',
    )
  })
})

/** `value` and everything reachable from it frozen (typed arrays excepted), so any write throws. */
function deepFreeze<T>(value: T): T {
  const seen = new Set<object>()
  const visit = (v: unknown) => {
    if (typeof v !== 'object' || v === null || seen.has(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return
    seen.add(v)
    if (typeof (v as { close?: unknown }).close === 'function') return
    Object.freeze(v)
    for (const key of Object.keys(v)) visit((v as Record<string, unknown>)[key])
  }
  visit(value)
  return value
}
