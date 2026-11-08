import { beforeEach, describe, expect, it } from 'vitest'
import { createImportError } from '../image/import/errors'
import { deleteSelectedPixels } from '../image/edit/deleteSelection'
import { createPixelBuffer } from '../image/pixelBuffer'
import { createMagicWandSelection } from '../image/selection/magicWand'
import { combineSelections, selectAll } from '../image/selection/selectionOperations'
import { type Rgba, imageFromRows } from '../image/selection/testFixtures'
import {
  type EditorAction,
  type EditorState,
  type MagicWandOperation,
  documentVersion,
  editorReducer,
  initialEditorState,
} from './editorState'
import { type HistoryLimits, createEditHistory, historyRetainedBytes } from './history/editHistory'
import type { HistoryEntry } from './history/historyEntry'
import {
  type FakeDisplayImages,
  WORKSPACE,
  accepted,
  edited,
  fakeBitmap,
  fakeDisplayImages,
  isDrawable,
  mask,
  opened,
  randomImage,
  randomInt,
  randomMask,
  randomSource,
  reachable,
  reduce,
  sameBytes,
  sameSelection,
} from './history/testFixtures'
import {
  type CompletedEdit,
  type CompletedPixelEdit,
  availableHistoryActions,
  completedEditCommand,
  redoCommand,
  undoCommand,
} from './historyCommands'
import { createEditedDocument, createImageDocument } from './imageDocument'
import { reapplyMagicWandCommand } from './selectionCommands'
import type { FloodMode, PixelBuffer, PixelCoordinate, Rectangle, SelectionMask, SelectionMode } from './types'

/*
 * Edit history integration: completed edits, Undo and Redo computed by the commands and applied
 * by the reducer, as Phase 3 Step 6 will connect them. Display images are fakes that record what
 * was created.
 */

const palette: Readonly<Record<string, Rgba>> = {
  a: [200, 200, 200, 255],
  b: [150, 160, 140, 255],
  c: [20, 40, 60, 255],
  t: [90, 10, 10, 128],
  // Hidden colour under alpha 0, which every restoration must keep byte for byte.
  h: [77, 88, 99, 0],
}

/** A 5 × 4 picture: light background (a, b), a dark object (c), translucent and hidden pixels. */
function picture(): PixelBuffer {
  return imageFromRows(palette, 'aaaab', 'abcca', 'bbcth', 'aahba')
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })

/** A measured workspace with `pixels` opened, and optionally other history limits. */
function start(pixels: PixelBuffer = picture(), limits?: HistoryLimits): EditorState {
  return opened(pixels, limits ? { ...measured, history: createEditHistory(limits) } : measured)
}

function withSelection(state: EditorState, selection: SelectionMask | null): EditorState {
  return accepted(state, { type: 'selection-applied', version: documentVersion(state)!, selection })
}

/** What a Magic Wand click selects: the same formula as selectionCommands uses. */
function wandResult(pixels: PixelBuffer, op: Omit<MagicWandOperation, 'version'>, tolerance = op.tolerance): SelectionMask | null {
  if (op.selectionMode === 'subtract' && !op.base) return null
  const found = createMagicWandSelection(pixels, op.seed, { tolerance, floodMode: op.floodMode })
  return combineSelections(op.base, found, op.selectionMode)
}

function wandAction(
  state: EditorState,
  seed: PixelCoordinate,
  selectionMode: SelectionMode,
  tolerance = 20,
  floodMode: FloodMode = 'contiguous',
): EditorAction {
  const operation: MagicWandOperation = {
    version: documentVersion(state)!,
    seed,
    floodMode,
    selectionMode,
    base: selectionMode === 'new' ? null : state.selection,
    tolerance,
  }
  return { type: 'magic-wand-applied', operation, selection: wandResult(state.document!.pixels, operation) }
}

function wand(state: EditorState, seed: PixelCoordinate, mode: SelectionMode, tolerance = 20, floodMode: FloodMode = 'contiguous') {
  return accepted(state, wandAction(state, seed, mode, tolerance, floodMode))
}

/** Delete Selection as Phase 3 Step 6 will compute it: the deleted pixels over their bounds, clearing the selection. */
function deleteEdit(state: EditorState): CompletedPixelEdit {
  const result = deleteSelectedPixels(state.document!.pixels, state.selection)
  if (!result) throw new Error('Nothing to delete')
  return {
    kind: 'delete-selection',
    version: documentVersion(state)!,
    change: 'pixels',
    pixels: result.pixels,
    region: result.bounds,
    selection: null,
  }
}

/** An arbitrary same-size edit (every channel), leaving `selection`. */
function changeEdit(
  state: EditorState,
  change: (data: Uint8ClampedArray, width: number) => void,
  selection: SelectionMask | null = null,
): CompletedPixelEdit {
  return {
    kind: 'delete-selection',
    version: documentVersion(state)!,
    change: 'pixels',
    pixels: edited(state.document!.pixels, change),
    selection,
  }
}

function cropEdit(state: EditorState, kept: Rectangle, selection: SelectionMask | null = null): CompletedEdit {
  return { kind: 'auto-trim', version: documentVersion(state)!, change: 'crop', kept, selection }
}

/** Sets every channel of pixel (x, y) to `value`. */
const paint = (x: number, y: number, value: number) => (data: Uint8ClampedArray, width: number) => {
  data.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 4)
}

let images: FakeDisplayImages
beforeEach(() => {
  images = fakeDisplayImages()
})

const editAction = (state: EditorState, completed: CompletedEdit) => completedEditCommand(state, completed, images.create)
const edit = (state: EditorState, completed: CompletedEdit) => accepted(state, editAction(state, completed))
const undoAction = (state: EditorState) => undoCommand(state, images.create)
const redoAction = (state: EditorState) => redoCommand(state, images.create)
const undo = (state: EditorState) => accepted(state, undoAction(state))
const redo = (state: EditorState) => accepted(state, redoAction(state))

/** Recursively freezes a state's plain objects and arrays (not typed arrays or images), as a check that nothing writes them. */
function deepFreeze<T>(value: T): T {
  const seen = new Set<object>()
  const visit = (item: unknown) => {
    if (typeof item !== 'object' || item === null || seen.has(item)) return
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer || isDrawable(item)) return
    seen.add(item)
    Object.freeze(item)
    for (const key of Object.keys(item)) visit((item as Record<string, unknown>)[key])
  }
  visit(value)
  return value
}

describe('edit history: recording edits', () => {
  it('starts with nothing to undo or redo, and creates nothing for Undo or Redo', () => {
    const state = start()
    expect(state.history.undo).toEqual([])
    expect(state.history.redo).toEqual([])
    expect(state.history.version).toBeNull()
    expect(availableHistoryActions(state)).toEqual({ undo: false, redo: false })
    expect(undoAction(state)).toBeNull()
    expect(redoAction(state)).toBeNull()
    expect(availableHistoryActions(initialEditorState)).toEqual({ undo: false, redo: false })
    expect(undoAction(initialEditorState)).toBeNull()
    expect(images.created).toEqual([])
  })

  it('applies a valid edit as a new revision with its display image and an Undo entry', () => {
    const before = withSelection(start(), mask('####.', '#....', '.....', '.....'))
    const completed = deleteEdit(before)
    const action = editAction(before, completed)!
    expect(action.type).toBe('edit-applied')
    const after = accepted(before, action)

    expect(after.document!.id).toBe(before.document!.id)
    expect(after.document!.revision).toBeGreaterThan(before.document!.revision)
    expect(after.document!.pixels).toBe(completed.pixels)
    expect(after.documentBitmap).toBe(images.created[0])
    expect(images.created).toHaveLength(1)
    expect(images.created[0].pixels).toBe(completed.pixels)
    expect(images.created[0].released).toBe(false)
    expect(after.selection).toBeNull()
    expect(after.lastMagicWandOperation).toBeNull()
    expect(after.history.undo).toHaveLength(1)
    expect(after.history.undo[0]).toBe(action.type === 'edit-applied' && action.entry)
    expect(after.history.version).toEqual(documentVersion(after))
    expect(after.history.retainedBytes).toBe(after.history.undo[0].retainedBytes)
    expect(availableHistoryActions(after)).toEqual({ undo: true, redo: false })
    // The view and everything unrelated are kept.
    expect(after.viewport).toBe(before.viewport)
    expect(after.activeTool).toBe(before.activeTool)
    expect(after.magicWand).toBe(before.magicWand)
    // The state before is untouched.
    expect(before.history.undo).toEqual([])
    expect(before.document!.pixels.data[3]).toBe(255)
  })

  it('records nothing and creates nothing for an edit that changes no pixel', () => {
    const state = start()
    const unchanged = changeEdit(state, () => {})
    expect(editAction(state, unchanged)).toBeNull()
    // A crop to the whole image removes nothing.
    expect(editAction(state, cropEdit(state, { x: 0, y: 0, width: 5, height: 4 }))).toBeNull()
    expect(images.created).toEqual([])
  })

  it('computes nothing for an edit made from another version', () => {
    const state = start()
    const completed = changeEdit(state, paint(0, 0, 9))
    const later = edit(state, changeEdit(state, paint(1, 0, 9)))
    expect(editAction(later, completed)).toBeNull()
    expect(editAction(later, { ...completed, version: { documentId: 999, revision: 0 } })).toBeNull()
    expect(editAction(initialEditorState, completed)).toBeNull()
    expect(images.created).toHaveLength(1)
  })

  it('rejects an edit result that arrives after the document changed revision', () => {
    const state = start()
    const stale = editAction(state, changeEdit(state, paint(0, 0, 9)))!
    const later = edit(state, changeEdit(state, paint(1, 0, 9)))
    expect(editorReducer(later, stale)).toBe(later)
    // Also after an Undo restored the very pixels the stale edit was computed from.
    const undone = undo(later)
    expect(sameBytes(undone.document!.pixels, state.document!.pixels)).toBe(true)
    expect(editorReducer(undone, stale)).toBe(undone)
  })

  it('rejects an edit for a different image, even one of the same size and revision', () => {
    const first = start()
    const action = editAction(first, changeEdit(first, paint(0, 0, 9)))!
    const second = start(picture(), undefined)
    expect(second.document!.revision).toBe(first.document!.revision)
    expect(editorReducer(second, action)).toBe(second)
    // An image opened after it, replacing the first one.
    const replaced = opened(picture(), first)
    expect(editorReducer(replaced, action)).toBe(replaced)
  })

  it('rejects an edit computed with a selection or Magic Wand click that has changed since', () => {
    const state = wand(start(), { x: 0, y: 0 }, 'new')
    const action = editAction(state, deleteEdit(state))!
    // The selection changes without a new revision: the Delete would delete the wrong pixels.
    const reselected = withSelection(state, mask('.....', '.....', '..##.', '.....'))
    expect(documentVersion(reselected)).toEqual(documentVersion(state))
    expect(editorReducer(reselected, action)).toBe(reselected)
    // A tolerance re-apply records a new operation (even with the same selection).
    const reapplied = accepted(state, reapplyMagicWandCommand(state, 90))
    expect(editorReducer(reapplied, action)).toBe(reapplied)
    // The unchanged state accepts it.
    expect(editorReducer(state, action)).not.toBe(state)
  })

  it('accepts only the first of two edits computed from the same state', () => {
    const state = start()
    const first = editAction(state, changeEdit(state, paint(0, 0, 1)))!
    const second = editAction(state, changeEdit(state, paint(1, 1, 2)))!
    const after = reduce(state, first, second)
    expect(after.document).toBe(first.type === 'edit-applied' && first.document)
    expect(after.history.undo).toHaveLength(1)
    // Rapid edits computed in order each apply.
    const a = edit(state, changeEdit(state, paint(0, 0, 1)))
    const b = edit(a, changeEdit(a, paint(1, 1, 2)))
    expect(b.history.undo).toHaveLength(2)
  })

  it('clears Redo when a new edit is accepted, and only then', () => {
    const state = start()
    const a = edit(state, changeEdit(state, paint(0, 0, 1)))
    const b = edit(a, changeEdit(a, paint(1, 0, 2)))
    const undone = undo(b)
    expect(availableHistoryActions(undone)).toEqual({ undo: true, redo: true })
    const c = edit(undone, changeEdit(undone, paint(2, 0, 3)))
    expect(c.history.redo).toEqual([])
    expect(c.history.undo).toHaveLength(2)
    expect(redoAction(c)).toBeNull()
    expect(availableHistoryActions(c)).toEqual({ undo: true, redo: false })
  })
})

describe('edit history: Undo and Redo', () => {
  /** Three successive edits from `state`, painting pixels (0, 0), (1, 0) and (2, 0). */
  function threeEdits(state: EditorState): EditorState[] {
    const states = [state]
    for (let i = 0; i < 3; i++) {
      const current = states[i]
      states.push(edit(current, changeEdit(current, paint(i, 0, 10 + i))))
    }
    return states
  }

  it('undoes and redoes in stack order, one entry at a time', () => {
    const [s0, s1, s2, s3] = threeEdits(start())
    const u1 = undo(s3)
    const u2 = undo(u1)
    const u3 = undo(u2)
    expect(undoAction(u3)).toBeNull()
    expect([u1, u2, u3].map((s) => sameBytes(s.document!.pixels, [s2, s1, s0][[u1, u2, u3].indexOf(s)].document!.pixels))).toEqual([true, true, true])
    expect(u3.history.redo).toEqual([...s3.history.undo].reverse())

    const r1 = redo(u3)
    const r2 = redo(r1)
    const r3 = redo(r2)
    expect(redoAction(r3)).toBeNull()
    for (const [redone, original] of [[r1, s1], [r2, s2], [r3, s3]] as const) {
      expect(sameBytes(redone.document!.pixels, original.document!.pixels)).toBe(true)
    }
    expect(r3.history.undo).toEqual(s3.history.undo)
    for (let i = 0; i < 3; i++) expect(r3.history.undo[i]).toBe(s3.history.undo[i])
  })

  it('gives every edit, Undo and Redo a fresh revision, never reused', () => {
    const [s0, , , s3] = threeEdits(start())
    const states = [s3]
    for (let i = 0; i < 3; i++) states.push(undo(states.at(-1)!))
    for (let i = 0; i < 2; i++) states.push(redo(states.at(-1)!))
    states.push(undo(states.at(-1)!))
    const revisions = states.map((s) => s.document!.revision)
    for (let i = 1; i < revisions.length; i++) expect(revisions[i]).toBeGreaterThan(revisions[i - 1])
    expect(new Set(revisions).size).toBe(revisions.length)
    // Undo back to the opened pixels does not bring back revision 0.
    expect(sameBytes(states[3].document!.pixels, s0.document!.pixels)).toBe(true)
    expect(states[3].document!.revision).not.toBe(0)
    for (const s of states) {
      expect(s.document!.id).toBe(s0.document!.id)
      expect(s.history.version).toEqual(documentVersion(s))
    }
  })

  it('restores pixels byte for byte, hidden colour included, for alpha-only and arbitrary edits', () => {
    const random = randomSource(11)
    const original = randomImage(9, 7, random)
    const s0 = withSelection(start(original), randomMask(9, 7, random, 0.6))
    const s1 = edit(s0, deleteEdit(s0))
    // Delete keeps the hidden colour: only alpha changed.
    const deleted = s1.document!.pixels
    for (let i = 0; i < deleted.data.length; i += 4) {
      expect([deleted.data[i], deleted.data[i + 1], deleted.data[i + 2]]).toEqual([original.data[i], original.data[i + 1], original.data[i + 2]])
    }
    const s2 = edit(s1, changeEdit(s1, (data) => {
      for (let i = 0; i < data.length; i++) if (random() < 0.5) data[i] = randomInt(random, 256)
    }))
    const u1 = undo(s2)
    expect(sameBytes(u1.document!.pixels, s1.document!.pixels)).toBe(true)
    const u2 = undo(u1)
    expect(sameBytes(u2.document!.pixels, original)).toBe(true)
    expect(sameBytes(redo(redo(u2)).document!.pixels, s2.document!.pixels)).toBe(true)
    // Every restored image is new memory with its own display image.
    for (const s of [u1, u2]) {
      expect(s.document!.pixels).not.toBe(original)
      expect(s.documentBitmap).toBe(images.created.find((image) => image.pixels === s.document!.pixels))
    }
  })

  it('restores crops: size, every pixel, the selection of each size, and the view', () => {
    const random = randomSource(5)
    const original = randomImage(8, 6, random)
    const before = withSelection(start(original), mask('........', '..##....', '..##....', '........', '........', '........'))
    const kept = { x: 2, y: 1, width: 5, height: 3 }
    const after = mask('##...', '##...', '.....')
    const cropped = edit(before, cropEdit(before, kept, after))
    expect(cropped.document).toMatchObject({ width: 5, height: 3 })
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++) {
        const from = ((y + 1) * 8 + x + 2) * 4
        expect([...cropped.document!.pixels.data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 4)]).toEqual([...original.data.subarray(from, from + 4)])
      }
    }
    expect(cropped.selection).toBe(after)
    // A size change fits the new image to the workspace, exactly as Fit does (Phase 3 Step 11):
    // Fit then changes nothing.
    expect(cropped.viewport).not.toEqual(before.viewport)
    expect(reduce(cropped, { type: 'zoom-fitted' })).toBe(cropped)

    const undone = undo(cropped)
    expect(undone.document).toMatchObject({ width: 8, height: 6 })
    expect(sameBytes(undone.document!.pixels, original)).toBe(true)
    expect(sameSelection(undone.selection, before.selection)).toBe(true)
    // The opened image was placed by fitting it, so fitting it again gives the same view.
    expect(undone.viewport).toEqual(before.viewport)
    expect(reduce(undone, { type: 'zoom-fitted' })).toBe(undone)
    expect(undone.documentBitmap).toMatchObject({ width: 8, height: 6 })

    const redone = redo(undone)
    expect(sameBytes(redone.document!.pixels, cropped.document!.pixels)).toBe(true)
    expect(sameSelection(redone.selection, after)).toBe(true)
    expect(redone.selection).not.toBe(after)
    expect(redone.viewport).toEqual(cropped.viewport)
  })

  it('fits a cropped image, and the image restored by Undo, whatever the view was', () => {
    const state = start(randomImage(400, 300, randomSource(3)))
    // Zoomed in on the image's right edge, then everything but the left column is cropped away.
    const zoomed = reduce(state, { type: 'zoom-scaled', anchor: { x: 990, y: 300 }, factor: 32 })
    const cropped = edit(zoomed, cropEdit(zoomed, { x: 0, y: 0, width: 1, height: 300 }))
    expect(reduce(cropped, { type: 'zoom-fitted' })).toBe(cropped)
    const { offset, zoom } = cropped.viewport!
    expect(offset.x).toBeGreaterThanOrEqual(0)
    expect(offset.x + zoom).toBeLessThanOrEqual(WORKSPACE.size.width)
    expect(offset.y).toBeGreaterThanOrEqual(0)
    expect(offset.y + 300 * zoom).toBeLessThanOrEqual(WORKSPACE.size.height)
    // Zoomed in again, then undone: the whole image is fitted again, not the zoom kept.
    const rezoomed = reduce(cropped, { type: 'zoom-scaled', anchor: { x: 500, y: 300 }, factor: 4 })
    const undone = undo(rezoomed)
    expect(reduce(undone, { type: 'zoom-fitted' })).toBe(undone)
    expect(undone.viewport).toEqual(state.viewport)
  })

  it('restores the selection from before the edit on Undo and the one after it on Redo', () => {
    const selection = mask('##...', '#....', '.....', '.....')
    const state = withSelection(start(), selection)
    const deleted = edit(state, deleteEdit(state))
    expect(deleted.selection).toBeNull()
    const undone = undo(deleted)
    expect(sameSelection(undone.selection, selection)).toBe(true)
    expect(undone.selection).not.toBe(selection)
    expect(redo(undone).selection).toBeNull()

    // No selection before; an edit that keeps the selection.
    const plain = start()
    expect(undo(edit(plain, changeEdit(plain, paint(0, 0, 1)))).selection).toBeNull()
    const keeping = edit(state, changeEdit(state, paint(4, 3, 7), selection))
    expect(keeping.selection).toBe(selection)
    const keptUndone = undo(keeping)
    expect(sameSelection(keptUndone.selection, selection)).toBe(true)
    expect(sameSelection(redo(keptUndone).selection, selection)).toBe(true)
  })

  it('restores the Magic Wand click bound to the new revision, so a new tolerance re-applies it', () => {
    const clicked = wand(start(), { x: 0, y: 0 }, 'new', 20)
    const op = clicked.lastMagicWandOperation!
    const narrow = reapplyMagicWandCommand(clicked, 0)
    const wide = reapplyMagicWandCommand(clicked, 60)
    // The tolerances give different selections, so the checks below mean something.
    expect(sameSelection(narrow?.type === 'magic-wand-reapplied' ? narrow.selection : null, clicked.selection)).toBe(false)

    const deleted = edit(clicked, deleteEdit(clicked))
    expect(deleted.lastMagicWandOperation).toBeNull()
    expect(reapplyMagicWandCommand(deleted, 60)).toBeNull()
    // The tolerance setting may have changed meanwhile; the recorded click keeps its own.
    const adjusted = reduce(deleted, { type: 'magic-wand-tolerance-changed', tolerance: 45 })
    const undone = undo(adjusted)

    const restored = undone.lastMagicWandOperation!
    expect(restored).toEqual({ ...op, version: documentVersion(undone) })
    expect(restored.version.revision).not.toBe(op.version.revision)
    expect(sameSelection(undone.selection, clicked.selection)).toBe(true)
    expect(undone.magicWand.tolerance).toBe(45)

    // Re-applying gives exactly what it gave before the edit, and the reducer accepts it.
    for (const [tolerance, expected] of [[0, narrow], [60, wide]] as const) {
      const action = reapplyMagicWandCommand(undone, tolerance)!
      expect(action.type).toBe('magic-wand-reapplied')
      const reapplied = accepted(undone, action)
      expect(sameSelection(reapplied.selection, expected?.type === 'magic-wand-reapplied' ? expected.selection : null)).toBe(true)
    }
    // The click as recorded before the edit is stale: its version never comes back.
    expect(editorReducer(undone, { type: 'magic-wand-reapplied', operation: op, tolerance: 60, selection: null })).toBe(undone)
    // Redo forgets it again.
    expect(redo(undone).lastMagicWandOperation).toBeNull()
  })

  it('restores the previous selection of an Add or Subtract click for its re-apply', () => {
    for (const mode of ['add', 'subtract'] as const) {
      const first = wand(start(), { x: 2, y: 1 }, 'new', 10, 'global')
      const second = wand(first, { x: 0, y: 0 }, mode, 20)
      const op = second.lastMagicWandOperation!
      expect(op.base).toBe(first.selection)
      const expected = (tolerance: number) => wandResult(second.document!.pixels, op, tolerance)

      const undone = undo(edit(second, deleteEdit(second)))
      const restored = undone.lastMagicWandOperation!
      expect(restored.selectionMode).toBe(mode)
      expect(sameSelection(restored.base, first.selection)).toBe(true)
      expect(restored.base).not.toBe(first.selection)
      expect(sameSelection(undone.selection, second.selection)).toBe(true)

      for (const tolerance of [0, 35, 80]) {
        const action = reapplyMagicWandCommand(undone, tolerance)
        if (tolerance === op.tolerance) continue
        const reapplied = accepted(undone, action)
        expect(sameSelection(reapplied.selection, expected(tolerance))).toBe(true)
        // The base is still the restored previous selection, never the re-applied result.
        expect(reapplied.lastMagicWandOperation!.base).toBe(restored.base)
      }
      // A new Add click after Undo combines with the restored selection.
      const added = wand(undone, { x: 4, y: 3 }, 'add')
      expect(added.lastMagicWandOperation!.base).toBe(undone.selection)
    }
  })

  it('restores a click whose previous selection was the selection itself as one shared mask', () => {
    // An Add click on a pixel already selected: the result is the previous selection.
    const first = wand(start(), { x: 0, y: 0 }, 'new')
    const second = accepted(first, {
      type: 'magic-wand-applied',
      operation: { ...first.lastMagicWandOperation!, selectionMode: 'add', base: first.selection, seed: { x: 1, y: 0 } },
      selection: first.selection,
    })
    const undone = undo(edit(second, deleteEdit(second)))
    expect(undone.lastMagicWandOperation!.base).toBe(undone.selection)
    expect(sameSelection(undone.selection, first.selection)).toBe(true)
  })

  it('never applies a patch twice: a second Undo or Redo computed from the same state is rejected', () => {
    const state = start()
    const a = edit(state, changeEdit(state, paint(0, 0, 1)))
    const b = edit(a, changeEdit(a, paint(0, 0, 2)))
    // Both computed from b: applied twice, the XOR patch would turn the pixels back into b's.
    const first = undoAction(b)!
    const second = undoAction(b)!
    const undone = reduce(b, first, second)
    expect(undone.document).toBe(first.type === 'edit-undone' && first.document)
    expect(sameBytes(undone.document!.pixels, a.document!.pixels)).toBe(true)
    expect(undone.history.undo).toHaveLength(1)
    expect(undone.history.redo).toHaveLength(1)

    const redoFirst = redoAction(undone)!
    const redoSecond = redoAction(undone)!
    const redone = reduce(undone, redoFirst, redoSecond)
    expect(sameBytes(redone.document!.pixels, b.document!.pixels)).toBe(true)
    expect(redone.history.redo).toHaveLength(0)
    // An Undo computed before the Redo stays stale after it.
    expect(editorReducer(redone, second)).toBe(redone)
  })

  it('rejects stale work after Undo, even though the restored pixels are identical', () => {
    const s0 = wand(start(), { x: 0, y: 0 }, 'new')
    const version0 = documentVersion(s0)!
    const staleSelection: EditorAction = { type: 'selection-applied', version: version0, selection: selectAll(5, 4) }
    const staleClick = wandAction(s0, { x: 2, y: 1 }, 'new')
    const staleReapply = reapplyMagicWandCommand(s0, 70)!
    const staleEdit = editAction(s0, changeEdit(s0, paint(3, 3, 5)))!

    const s1 = edit(s0, deleteEdit(s0))
    const staleUndo = undoAction(s1)!
    const s2 = undo(s1)
    expect(sameBytes(s2.document!.pixels, s0.document!.pixels)).toBe(true)
    const staleRedo = redoAction(s2)!
    const s3 = redo(s2)
    const s4 = undo(s3)

    for (const state of [s2, s3, s4]) {
      for (const action of [staleSelection, staleClick, staleReapply, staleEdit, staleUndo]) {
        expect(editorReducer(state, action)).toBe(state)
      }
    }
    expect(editorReducer(s4, staleRedo)).toBe(s4)
    // Work computed from the current state is accepted.
    expect(editorReducer(s4, { ...staleSelection, version: documentVersion(s4)! })).not.toBe(s4)
  })

  it('keeps every transition exact when an edit returns the pixels to an earlier state', () => {
    const s0 = start()
    const s1 = edit(s0, changeEdit(s0, paint(0, 0, 9)))
    const original = [...s0.document!.pixels.data.subarray(0, 4)]
    const s2 = edit(s1, changeEdit(s1, (data) => data.set(original, 0)))
    expect(sameBytes(s2.document!.pixels, s0.document!.pixels)).toBe(true)
    expect(s2.document!.revision).toBeGreaterThan(s1.document!.revision)
    // The two patches are equal in content but are distinct entries.
    expect(s2.history.undo).toHaveLength(2)
    expect(s2.history.undo[0]).not.toBe(s2.history.undo[1])
    const u1 = undo(s2)
    expect(sameBytes(u1.document!.pixels, s1.document!.pixels)).toBe(true)
    const u2 = undo(u1)
    expect(sameBytes(u2.document!.pixels, s0.document!.pixels)).toBe(true)
    const r2 = redo(redo(u2))
    expect(sameBytes(r2.document!.pixels, s0.document!.pixels)).toBe(true)
    expect(new Set([s0, s1, s2, u1, u2, r2].map((s) => s.document!.revision)).size).toBe(6)
  })

  it('offers nothing when the history is not bound to the document version', () => {
    const state = start()
    const edited1 = edit(state, changeEdit(state, paint(0, 0, 1)))
    // A document changed without going through history (nothing does this; a guard).
    const document = edited1.document!
    const unbound: EditorState = {
      ...edited1,
      document: createEditedDocument(document, createPixelBuffer(5, 4, document.pixels.data.slice())),
    }
    expect(availableHistoryActions(unbound)).toEqual({ undo: false, redo: false })
    expect(undoAction(unbound)).toBeNull()
    // An Undo computed for the bound version is rejected for the unbound document.
    expect(editorReducer(unbound, undoAction(edited1)!)).toBe(unbound)
    // A new edit starts a new history: the unbound entries can never apply to these pixels.
    const next = edit(unbound, changeEdit(unbound, paint(1, 1, 1)))
    expect(next.history.undo).toHaveLength(1)
    expect(next.history.undo[0]).not.toBe(edited1.history.undo[0])
  })
})

describe('edit history: rejected document changes', () => {
  /** A state with two edits, one of them undone, and valid actions computed from it. */
  function prepared() {
    const s0 = withSelection(start(), mask('##...', '.....', '.....', '.....'))
    const s1 = edit(s0, deleteEdit(s0))
    const s2 = edit(s1, changeEdit(s1, paint(4, 3, 3)))
    const state = undo(s2)
    const edited2 = editAction(state, changeEdit(state, paint(2, 2, 2)))!
    const undone = undoAction(state)!
    const redone = redoAction(state)!
    if (edited2.type !== 'edit-applied' || undone.type !== 'edit-undone' || redone.type !== 'edit-redone') throw new Error('setup')
    return { s0, s1, s2, state, edit: edited2, undo: undone, redo: redone }
  }

  it('changes nothing for every kind of invalid action', () => {
    const { s0, s2, state, edit: e, undo: u, redo: r } = prepared()
    const document = state.document!
    const foreign = createImageDocument({ name: 'x', format: 'png', source: 'paste', fileSizeBytes: 1, pixels: picture() })
    const sharedMemory = { ...e.document, pixels: createPixelBuffer(5, 4, document.pixels.data as Uint8ClampedArray<ArrayBuffer>) }
    const wrongImage = { width: 4, height: 4, close: () => {} }
    const wrongMask = mask('##..', '....', '....')
    const invalid: EditorAction[] = [
      // Wrong version, document or revision.
      { ...e, version: { ...e.version, revision: e.version.revision - 1 } },
      { ...e, version: { ...e.version, documentId: 999 } },
      { ...e, document: foreign },
      { ...e, document: document },
      { ...e, document: { ...e.document, revision: document.revision } },
      { ...e, document: s0.document! },
      { ...e, document: sharedMemory },
      { ...e, image: wrongImage },
      { ...e, selection: wrongMask },
      { ...e, selectionBefore: wrongMask },
      { ...e, entry: { ...e.entry, patch: { ...e.entry.patch, width: 6 } } as HistoryEntry },
      // Undo: not the next entry, wrong documents, sizes or click.
      { ...u, entry: s2.history.undo[0] === u.entry ? s2.history.undo[1] : s2.history.undo[0] },
      { ...u, entry: state.history.redo[0] },
      { ...u, version: { ...u.version, revision: u.version.revision + 1 } },
      { ...u, document: s0.document! },
      { ...u, document: { ...u.document, id: 999 } },
      { ...u, image: wrongImage },
      { ...u, selection: wrongMask },
      {
        ...u,
        magicWandOperation: {
          version: u.version,
          seed: { x: 0, y: 0 },
          floodMode: 'contiguous',
          selectionMode: 'new',
          base: null,
          tolerance: 20,
        },
      },
      // Redo: the Undo entry, an older document, wrong sizes.
      { ...r, entry: state.history.undo[0] },
      { ...r, document: s2.document! },
      { ...r, image: wrongImage },
      { ...r, selection: wrongMask },
    ]
    const frozen = deepFreeze(state)
    const history = state.history
    for (const action of invalid) {
      const result = editorReducer(frozen, action)
      expect(result).toBe(state)
    }
    expect(state.history).toBe(history)
    expect(state.history.undo).toHaveLength(1)
    expect(state.history.redo).toHaveLength(1)
    // The valid actions are accepted.
    for (const action of [e, u, r]) expect(editorReducer(state, action)).not.toBe(state)
  })

  it('never lets a rejected action become valid in any later state', () => {
    const { state, edit: e, undo: u, redo: r } = prepared()
    const after = [redo(state), undo(state), edit(state, changeEdit(state, paint(0, 3, 4)))]
    for (const later of after) {
      // Each later state accepted one of these; the others, and the accepted one again, are stale.
      for (const action of [e, u, r]) expect(editorReducer(later, action)).toBe(later)
    }
  })

  it('needs an open document', () => {
    const { edit: e, undo: u, redo: r } = prepared()
    for (const action of [e, u, r]) expect(editorReducer(initialEditorState, action)).toBe(initialEditorState)
  })
})

describe('edit history: selection changes', () => {
  it('adds no entry and keeps Undo and Redo available when the selection changes', () => {
    const s0 = start()
    const s1 = edit(s0, changeEdit(s0, paint(0, 0, 1)))
    const s2 = edit(s1, changeEdit(s1, paint(1, 0, 2)))
    const undone = undo(s2)
    const history = undone.history
    const version = documentVersion(undone)!
    let state = undone
    const steps: ((s: EditorState) => EditorAction | null)[] = [
      (s) => wandAction(s, { x: 0, y: 0 }, 'new'),
      (s) => reapplyMagicWandCommand(s, 70),
      (s) => wandAction(s, { x: 2, y: 1 }, 'add'),
      () => ({ type: 'selection-applied', version, selection: selectAll(5, 4) }),
      () => ({ type: 'selection-cleared' }),
      () => ({ type: 'selection-applied', version, selection: mask('.....', '.##..', '.....', '.....') }),
      () => ({ type: 'magic-wand-tolerance-changed', tolerance: 3 }),
      () => ({ type: 'tool-selected', tool: 'magic-wand' }),
      () => ({ type: 'zoom-stepped', direction: 1 }),
    ]
    for (const step of steps) {
      const action = step(state)
      if (action) state = editorReducer(state, action)
      expect(state.history).toBe(history)
      expect(availableHistoryActions(state)).toEqual({ undo: true, redo: true })
    }
    // Redo still applies, and restores the selection the edit left (none), not the one made since.
    const redone = redo(state)
    expect(sameBytes(redone.document!.pixels, s2.document!.pixels)).toBe(true)
    expect(redone.selection).toBeNull()
    // Undo restores the selection from before the edit, not the one made since.
    const again = undo(redone)
    expect(sameSelection(again.selection, undone.selection)).toBe(true)
  })
})

describe('edit history: imports', () => {
  function withHistory() {
    const s0 = start(picture(), { maxEntries: 9, maxBytes: 99_999 })
    const s1 = edit(s0, changeEdit(s0, paint(0, 0, 1)))
    const s2 = edit(s1, changeEdit(s1, paint(1, 0, 2)))
    return undo(s2)
  }

  it('clears the history when another image opens successfully, keeping its limits', () => {
    const state = withHistory()
    const staleUndo = undoAction(state)!
    const staleRedo = redoAction(state)!
    const replaced = opened(picture(), state)
    expect(replaced.history).toEqual({ limits: { maxEntries: 9, maxBytes: 99_999 }, version: null, undo: [], redo: [], retainedBytes: 0 })
    expect(availableHistoryActions(replaced)).toEqual({ undo: false, redo: false })
    expect(editorReducer(replaced, staleUndo)).toBe(replaced)
    expect(editorReducer(replaced, staleRedo)).toBe(replaced)
  })

  it('keeps the image and its history when an import fails, is rejected, is superseded or is still running', () => {
    const state = withHistory()
    const failed = { ok: false, error: createImportError('decode-failed', 'bad data') } as const
    const document = createImageDocument({ name: 'b.png', format: 'png', source: 'drop', fileSizeBytes: 1, pixels: picture() })
    const outcomes = [
      reduce(state, { type: 'import-started', importId: 1 }, { type: 'import-finished', importId: 1, result: failed }),
      reduce(state, { type: 'import-rejected', error: createImportError('unsupported-format', 'folder') }),
      reduce(
        state,
        { type: 'import-started', importId: 2 },
        { type: 'import-started', importId: 3 },
        { type: 'import-finished', importId: 2, result: { ok: true, document, bitmap: fakeBitmap(5, 4) } },
        { type: 'import-finished', importId: 3, result: failed },
      ),
      reduce(state, { type: 'import-started', importId: 4 }),
    ]
    for (const outcome of outcomes) {
      expect(outcome.history).toBe(state.history)
      expect(outcome.document).toBe(state.document)
      expect(outcome.documentBitmap).toBe(state.documentBitmap)
      expect(availableHistoryActions(outcome)).toEqual({ undo: true, redo: true })
      // Undo and Redo still work afterwards.
      expect(sameBytes(redo(outcome).document!.pixels, redo(state).document!.pixels)).toBe(true)
    }
  })
})

describe('edit history: limits', () => {
  /** `count` successive one-pixel edits from `state`. */
  function edits(state: EditorState, count: number): EditorState[] {
    const states = [state]
    for (let i = 0; i < count; i++) {
      const current = states[i]
      states.push(edit(current, changeEdit(current, paint(i % 5, Math.floor(i / 5) % 4, 100 + i))))
    }
    return states
  }

  it('keeps the 25 most recent edits by default', () => {
    const states = edits(start(), 30)
    let state = states[30]
    expect(state.history.undo).toHaveLength(25)
    for (let i = 0; i < 25; i++) state = undo(state)
    expect(undoAction(state)).toBeNull()
    expect(sameBytes(state.document!.pixels, states[5].document!.pixels)).toBe(true)
    expect(state.history.redo).toHaveLength(25)
  })

  it('drops the oldest edits once the retained memory exceeds the budget', () => {
    // Room for exactly the last three of six edits (entries differ slightly in size).
    const reference = edits(start(), 6)[6].history.undo
    const budget = historyRetainedBytes(reference.slice(3))
    const states = edits(start(picture(), { maxEntries: 25, maxBytes: budget }), 6)
    let state = states[6]
    expect(state.history.undo).toHaveLength(3)
    expect(state.history.retainedBytes).toBe(budget)
    for (let i = 0; i < 3; i++) state = undo(state)
    expect(undoAction(state)).toBeNull()
    expect(sameBytes(state.document!.pixels, states[3].document!.pixels)).toBe(true)
    // One byte less and only two fit.
    expect(edits(start(picture(), { maxEntries: 25, maxBytes: budget - 1 }), 6)[6].history.undo).toHaveLength(2)
  })

  it('keeps the newest edit even when it alone exceeds the budget', () => {
    const states = edits(start(picture(), { maxEntries: 25, maxBytes: 0 }), 3)
    const last = states[3]
    expect(last.history.undo).toHaveLength(1)
    expect(last.history.retainedBytes).toBeGreaterThan(0)
    const undone = undo(last)
    expect(sameBytes(undone.document!.pixels, states[2].document!.pixels)).toBe(true)
    expect(undoAction(undone)).toBeNull()
    expect(sameBytes(redo(undone).document!.pixels, last.document!.pixels)).toBe(true)
  })
})

describe('edit history: failures', () => {
  it('reports an edit, Undo or Redo whose display image cannot be created, changing nothing else', () => {
    const s0 = start()
    const s1 = edit(s0, changeEdit(s0, paint(0, 0, 1)))
    const s2 = withSelection(undo(edit(s1, changeEdit(s1, paint(1, 0, 2)))), mask('.#...', '.....', '.....', '.....'))
    images.failing = true
    const created = images.created.length
    const attempts = [
      [editAction(s2, changeEdit(s2, paint(2, 0, 3))), 'delete-selection'],
      [undoAction(s2), 'undo'],
      [redoAction(s2), 'redo'],
    ] as const
    for (const [action, operation] of attempts) {
      expect(action).toMatchObject({ type: 'edit-failed', error: { operation, detail: expect.stringContaining('Out of memory') } })
      const failed = editorReducer(s2, action!)
      expect(failed.editError).toEqual(action!.type === 'edit-failed' && action!.error)
      expect(failed.document).toBe(s2.document)
      expect(failed.documentBitmap).toBe(s2.documentBitmap)
      expect(failed.selection).toBe(s2.selection)
      expect(failed.history).toBe(s2.history)
      expect(failed.viewport).toBe(s2.viewport)
    }
    expect(images.created).toHaveLength(created)
  })

  it('reports edits that cannot be recorded instead of applying them', () => {
    const state = withSelection(start(), mask('#....', '.....', '.....', '.....'))
    const pixels = state.document!.pixels
    const inPlace: CompletedEdit = { ...changeEdit(state, () => {}), pixels }
    const wrongSize: CompletedEdit = { ...changeEdit(state, () => {}), pixels: randomImage(4, 4, randomSource(1)) }
    const badRegion: CompletedEdit = { ...changeEdit(state, paint(0, 0, 1)), region: { x: 3, y: 3, width: 5, height: 5 } }
    const badCrop = cropEdit(state, { x: 2, y: 2, width: 9, height: 1 })
    const badCropSelection = cropEdit(state, { x: 0, y: 0, width: 2, height: 2 }, mask('#....', '.....', '.....', '.....'))
    for (const completed of [inPlace, wrongSize, badRegion, badCrop, badCropSelection]) {
      const action = editAction(state, completed)
      expect(action).toMatchObject({ type: 'edit-failed', error: { operation: completed.kind } })
    }
    expect(images.created).toEqual([])
  })

  it('reports an Undo or Redo of a damaged entry, keeping the entry and the image', () => {
    const s0 = withSelection(start(), mask('##...', '.....', '.....', '.....'))
    const s1 = edit(s0, deleteEdit(s0))
    const entry = s1.history.undo[0]
    const damaged: HistoryEntry = { ...entry, selectionBefore: { ...entry.selectionBefore!, count: 99 } }
    const state: EditorState = { ...s1, history: { ...s1.history, undo: [damaged] } }
    const action = undoAction(state)
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'undo' } })
    const failed = editorReducer(state, action!)
    expect(failed.history).toBe(state.history)
    expect(failed.document).toBe(state.document)
    // A patch for another image size never meets these pixels.
    const resized: HistoryEntry = { ...entry, patch: { ...entry.patch, width: 6 } as HistoryEntry['patch'] }
    expect(undoAction({ ...s1, history: { ...s1.history, undo: [resized] } })).toMatchObject({ type: 'edit-failed' })
  })

  it('never redoes a crop on an image of another size, even one containing its rectangle', () => {
    const s0 = start(randomImage(8, 6, randomSource(9)))
    const undone = undo(edit(s0, cropEdit(s0, { x: 1, y: 1, width: 3, height: 2 })))
    const entry = undone.history.redo[0]
    if (entry.patch.kind !== 'crop-patch') throw new Error('setup')
    // As if the entry had been recorded for a 9 × 6 image: its rectangle lies within this one too.
    const other: HistoryEntry = { ...entry, patch: { ...entry.patch, width: 9 } }
    const action = redoAction({ ...undone, history: { ...undone.history, redo: [other] } })
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'redo' } })
    expect(images.created).toHaveLength(2)
  })

  it('keeps the error until it is dismissed, a later edit, Undo or Redo succeeds, or another image opens', () => {
    const s0 = start()
    const error = { type: 'edit-failed', error: { operation: 'undo', detail: 'test' } } as const
    const failed = editorReducer(s0, error)
    expect(failed.editError).toEqual({ operation: 'undo', detail: 'test' })
    expect(editorReducer(failed, { type: 'edit-error-dismissed' }).editError).toBeNull()
    expect(editorReducer(s0, { type: 'edit-error-dismissed' })).toBe(s0)
    const editedAfter = edit(failed, changeEdit(failed, paint(0, 0, 1)))
    expect(editedAfter.editError).toBeNull()
    expect(undo(editorReducer(editedAfter, error)).editError).toBeNull()
    expect(opened(picture(), failed).editError).toBeNull()
    const failedImport = reduce(
      failed,
      { type: 'import-started', importId: 77 },
      { type: 'import-finished', importId: 77, result: { ok: false, error: createImportError('decode-failed') } },
    )
    expect(failedImport.editError).toEqual(failed.editError)
    // Selection changes and rejected actions leave it.
    expect(withSelection(failed, selectAll(5, 4)).editError).toBe(failed.editError)
  })
})

describe('edit history: React Strict Mode', () => {
  it('gives the same result when the reducer runs twice, and never writes its input', () => {
    const s0 = wand(start(), { x: 0, y: 0 }, 'new')
    const s1 = edit(s0, deleteEdit(s0))
    const s2 = undo(s1)
    const cases: [EditorState, EditorAction][] = [
      [s0, editAction(s0, deleteEdit(s0))!],
      [s1, undoAction(s1)!],
      [s2, redoAction(s2)!],
      [s2, { type: 'edit-failed', error: { operation: 'redo' } }],
      [s2, editAction(s2, cropEdit(s2, { x: 1, y: 1, width: 3, height: 2 }))!],
    ]
    for (const [state, action] of cases) {
      deepFreeze(state)
      const created = images.created.length
      const first = editorReducer(state, action)
      const second = editorReducer(state, action)
      expect(second).toEqual(first)
      expect(second).not.toBe(state)
      for (const key of ['document', 'documentBitmap', 'selection', 'lastMagicWandOperation', 'editError'] as const) {
        expect(second[key]).toBe(first[key])
      }
      second.history.undo.forEach((entry, i) => expect(entry).toBe(first.history.undo[i]))
      second.history.redo.forEach((entry, i) => expect(entry).toBe(first.history.redo[i]))
      // The reducer never creates display images.
      expect(images.created).toHaveLength(created)
    }
  })
})

describe('edit history: what it keeps', () => {
  it('holds no pixels, documents, masks or display images: only patches and encoded selections', () => {
    const random = randomSource(21)
    let state = wand(start(randomImage(12, 9, random)), { x: 3, y: 3 }, 'new', 40)
    state = wand(state, { x: 8, y: 2 }, 'add', 30)
    const visited: EditorState[] = [state]
    state = edit(state, deleteEdit(state))
    visited.push(state)
    state = edit(state, cropEdit(state, { x: 1, y: 1, width: 10, height: 6 }, randomMask(10, 6, random)))
    visited.push(state)
    state = undo(state)
    visited.push(state)

    const { objects, buffers } = reachable(state.history)
    for (const s of visited) {
      expect(objects.has(s.document!)).toBe(false)
      expect(objects.has(s.document!.pixels)).toBe(false)
      expect(buffers.has(s.document!.pixels.data.buffer)).toBe(false)
      if (s.selection) expect(buffers.has(s.selection.data.buffer)).toBe(false)
      if (s.lastMagicWandOperation?.base) expect(objects.has(s.lastMagicWandOperation.base)).toBe(false)
    }
    for (const object of objects) expect(isDrawable(object)).toBe(false)
    // Entries name no document version; only the history's binding does.
    const entries = [...state.history.undo, ...state.history.redo]
    for (const object of reachable(entries).objects) expect(Object.keys(object)).not.toContain('revision')
    expect(state.history.version).toEqual(documentVersion(state))
    // Every buffer it keeps is counted.
    expect(state.history.retainedBytes).toBe(historyRetainedBytes(entries))
    let counted = 0
    for (const buffer of buffers) counted += buffer.byteLength
    expect(counted).toBeLessThan(state.history.retainedBytes)
  })
})

describe('edit history: randomized edits, Undo and Redo', () => {
  interface ModelEntry {
    readonly selectionBefore: SelectionMask | null
    readonly clickBefore: Omit<MagicWandOperation, 'version'> | null
    readonly selectionAfter: SelectionMask | null
  }

  it('restores every state exactly and rejects every stale action', () => {
    let steps = 0
    for (let seed = 1; seed <= 40; seed++) {
      const random = randomSource(seed * 7919)
      const width = 2 + randomInt(random, 7)
      const height = 2 + randomInt(random, 6)
      const maxEntries = 1 + randomInt(random, 6)
      const pixels = randomImage(width, height, random)
      for (let i = 3; i < pixels.data.length; i += 4) {
        // Some fully and partly transparent pixels, with colour hidden under alpha 0.
        const roll = random()
        if (roll < 0.15) (pixels.data as Uint8ClampedArray)[i] = 0
        else if (roll < 0.3) (pixels.data as Uint8ClampedArray)[i] = 1 + randomInt(random, 254)
      }
      let state = start(pixels, { maxEntries, maxBytes: 64 * 1024 * 1024 })

      // The model: every content state's pixels (copies), the entries between them, and where we are.
      const timeline: Uint8ClampedArray[] = [pixels.data.slice()]
      const sizes = [{ width, height }]
      const entries: (ModelEntry | null)[] = [null]
      let index = 0
      let oldest = 0
      let selection: SelectionMask | null = null
      let click: Omit<MagicWandOperation, 'version'> | null = null
      const revisions = new Set<number>([state.document!.revision])
      const past: EditorAction[] = []

      const check = (where: string) => {
        const document = state.document!
        expect(document.width, where).toBe(sizes[index].width)
        expect(document.height, where).toBe(sizes[index].height)
        expect(sameBytes(document.pixels, createPixelBuffer(document.width, document.height, timeline[index] as Uint8ClampedArray<ArrayBuffer>)), where).toBe(true)
        expect(sameSelection(state.selection, selection), where).toBe(true)
        const op = state.lastMagicWandOperation
        if (!click) expect(op, where).toBeNull()
        else {
          expect(op, where).not.toBeNull()
          const { version, base, ...rest } = op!
          const { base: modelBase, ...modelRest } = click
          expect(version, where).toEqual(documentVersion(state))
          expect(rest, where).toEqual(modelRest)
          expect(sameSelection(base, modelBase), where).toBe(true)
        }
        expect(state.history.undo.length, where).toBe(index - oldest)
        expect(state.history.redo.length, where).toBe(timeline.length - 1 - index)
        expect(state.history.retainedBytes, where).toBe(historyRetainedBytes([...state.history.undo, ...state.history.redo]))
        expect(availableHistoryActions(state), where).toEqual({ undo: index > oldest, redo: index < timeline.length - 1 })
      }

      /** Applies a document change and checks it got a fresh revision and its own display image. */
      const changeDocument = (action: EditorAction | null, where: string): boolean => {
        if (!action) return false
        expect(action.type, where).not.toBe('edit-failed')
        const next = editorReducer(state, action)
        expect(next, where).not.toBe(state)
        expect(revisions.has(next.document!.revision), where).toBe(false)
        expect(next.document!.revision, where).toBeGreaterThan(state.document!.revision)
        revisions.add(next.document!.revision)
        expect(next.documentBitmap, where).toBe(images.created.at(-1))
        expect((next.documentBitmap as unknown as { pixels: PixelBuffer }).pixels, where).toBe(next.document!.pixels)
        past.push(action)
        state = next
        return true
      }

      const recordEditInModel = (after: Uint8ClampedArray, size: { width: number; height: number }, selectionAfter: SelectionMask | null) => {
        timeline.splice(index + 1)
        sizes.splice(index + 1)
        entries.splice(index + 1)
        timeline.push(after)
        sizes.push(size)
        entries.push({ selectionBefore: selection, clickBefore: click, selectionAfter })
        index++
        oldest = Math.max(oldest, index - maxEntries)
        selection = selectionAfter
        click = null
      }

      for (let step = 0; step < 60; step++, steps++) {
        const where = `seed ${seed}, step ${step}`
        const { width: w, height: h } = sizes[index]
        const version = documentVersion(state)!
        const roll = random()
        if (roll < 0.22) {
          // A same-size edit: Delete, or an arbitrary change in a region.
          let completed: CompletedEdit | null = null
          if (state.selection && random() < 0.5) {
            const result = deleteSelectedPixels(state.document!.pixels, state.selection)
            if (result) completed = { kind: 'delete-selection', version, change: 'pixels', pixels: result.pixels, region: result.bounds, selection: null }
          } else {
            const x = randomInt(random, w)
            const y = randomInt(random, h)
            const region = { x, y, width: 1 + randomInt(random, w - x), height: 1 + randomInt(random, h - y) }
            const alphaOnly = random() < 0.5
            const selectionAfter = random() < 0.3 ? state.selection : random() < 0.5 ? randomMask(w, h, random) : null
            completed = changeEdit(state, (data, rowWidth) => {
              for (let yy = region.y; yy < region.y + region.height; yy++) {
                for (let xx = region.x; xx < region.x + region.width; xx++) {
                  if (random() < 0.4) continue
                  const p = (yy * rowWidth + xx) * 4
                  if (alphaOnly) data[p + 3] = randomInt(random, 256)
                  else data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), randomInt(random, 256)], p)
                }
              }
            }, selectionAfter)
            completed = { ...completed, region }
          }
          if (completed && completed.change === 'pixels') {
            const after = completed.pixels.data.slice()
            if (changeDocument(editAction(state, completed), where)) recordEditInModel(after, { width: w, height: h }, completed.selection)
          }
        } else if (roll < 0.3) {
          // A crop to a smaller rectangle.
          if (w * h > 1) {
            let kept: Rectangle
            do {
              const x = randomInt(random, w)
              const y = randomInt(random, h)
              kept = { x, y, width: 1 + randomInt(random, w - x), height: 1 + randomInt(random, h - y) }
            } while (kept.width === w && kept.height === h)
            const selectionAfter = random() < 0.5 ? randomMask(kept.width, kept.height, random) : null
            const action = editAction(state, cropEdit(state, kept, selectionAfter))
            const document = state.document!
            const after = new Uint8ClampedArray(kept.width * kept.height * 4)
            for (let y = 0; y < kept.height; y++) {
              const from = ((kept.y + y) * document.width + kept.x) * 4
              after.set(document.pixels.data.subarray(from, from + kept.width * 4), y * kept.width * 4)
            }
            if (changeDocument(action, where)) recordEditInModel(after, { width: kept.width, height: kept.height }, selectionAfter)
          }
        } else if (roll < 0.48) {
          const action = undoAction(state)
          expect(action !== null, where).toBe(index > oldest)
          if (changeDocument(action, where)) {
            const entry = entries[index]!
            index--
            selection = entry.selectionBefore
            click = entry.clickBefore
            // The restored click re-applies exactly as it would have before the edit.
            if (click && random() < 0.5) {
              const tolerance = randomInt(random, 101)
              const reapplied = reapplyMagicWandCommand(state, tolerance)
              if (tolerance !== click.tolerance) {
                const next = accepted(state, reapplied)
                const expected = wandResult(state.document!.pixels, click, tolerance)
                expect(sameSelection(next.selection, expected), where).toBe(true)
                past.push(reapplied!)
                state = next
                selection = next.selection
                click = { ...click, tolerance }
              }
            }
          }
        } else if (roll < 0.62) {
          const action = redoAction(state)
          expect(action !== null, where).toBe(index < timeline.length - 1)
          if (changeDocument(action, where)) {
            index++
            selection = entries[index]!.selectionAfter
            click = null
          }
        } else if (roll < 0.74) {
          // Selection changes: never history.
          const history = state.history
          const choice = random()
          let action: EditorAction
          if (choice < 0.4) action = { type: 'selection-applied', version, selection: randomMask(w, h, random) }
          else if (choice < 0.6) action = { type: 'selection-cleared' }
          else action = { type: 'selection-applied', version, selection: selectAll(w, h) }
          const next = editorReducer(state, action)
          if (next !== state) {
            selection = next.selection
            click = null
            if (action.type === 'selection-applied') past.push(action)
          }
          state = next
          expect(state.history, where).toBe(history)
        } else if (roll < 0.86) {
          // A Magic Wand click, sometimes Add or Subtract.
          const history = state.history
          const modes: SelectionMode[] = ['new', 'add', 'subtract']
          const action = wandAction(
            state,
            { x: randomInt(random, w), y: randomInt(random, h) },
            modes[randomInt(random, 3)],
            randomInt(random, 101),
            random() < 0.5 ? 'contiguous' : 'global',
          )
          state = accepted(state, action)
          past.push(action)
          selection = state.selection
          const { seed, floodMode, selectionMode, base, tolerance } = state.lastMagicWandOperation!
          click = { seed, floodMode, selectionMode, base, tolerance }
          expect(state.history, where).toBe(history)
        } else if (roll < 0.97) {
          // Every action computed for an earlier version is rejected, whatever happened since.
          const current = documentVersion(state)!
          const stale = past.filter((action) => {
            const tagged =
              action.type === 'magic-wand-reapplied' || action.type === 'magic-wand-applied' ? action.operation.version : 'version' in action ? action.version : null
            return tagged && (tagged.documentId !== current.documentId || tagged.revision !== current.revision)
          })
          if (stale.length > 0) {
            const action = stale[randomInt(random, stale.length)]
            expect(editorReducer(state, action), `${where}: ${action.type}`).toBe(state)
          }
        } else {
          // A failed import keeps everything.
          const next = reduce(
            state,
            { type: 'import-started', importId: 9000 + step },
            { type: 'import-finished', importId: 9000 + step, result: { ok: false, error: createImportError('decode-failed') } },
          )
          expect(next.history, where).toBe(state.history)
          state = next
        }
        check(where)
      }

      // Back to the oldest state still kept, and forward to the newest.
      while (index > oldest) {
        const entry = entries[index]!
        expect(changeDocument(undoAction(state), `seed ${seed}, final undo`)).toBe(true)
        index--
        selection = entry.selectionBefore
        click = entry.clickBefore
        check(`seed ${seed}, final undo to ${index}`)
      }
      expect(undoAction(state)).toBeNull()
      while (index < timeline.length - 1) {
        expect(changeDocument(redoAction(state), `seed ${seed}, final redo`)).toBe(true)
        index++
        selection = entries[index]!.selectionAfter
        click = null
        check(`seed ${seed}, final redo to ${index}`)
      }
      expect(redoAction(state)).toBeNull()
    }
    expect(steps).toBe(40 * 60)
  })
})

describe('edit history: large images', () => {
  it('keeps a 4K background Delete in kilobytes and restores it exactly', () => {
    const width = 3840
    const height = 2400
    // A screenshot-like image: a flat background around a noisy object, with an anti-aliased edge.
    const data = new Uint8ClampedArray(width * height * 4)
    const random = randomSource(4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4
        const inside = x >= 1000 && x < 2800 && y >= 600 && y < 1800
        if (inside) data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), 255], p)
        else data.set([240, 240, 240, (x === 999 || x === 2800) && y >= 600 && y < 1800 ? 128 : 255], p)
      }
    }
    const pixels = createPixelBuffer(width, height, data)
    const before = wand(start(pixels), { x: 5, y: 5 }, 'new', 20)
    expect(before.selection!.count).toBeGreaterThan(5_000_000)

    const deleted = edit(before, deleteEdit(before))
    const entry = deleted.history.undo[0]
    // The patch and the encoded selection (with the Magic Wand click) are kilobytes, not the
    // 36.9 MB of the image or the 9.2 MB of the mask.
    expect(entry.retainedBytes).toBeLessThan(64 * 1024)
    expect(deleted.history.retainedBytes).toBe(entry.retainedBytes)
    const { buffers } = reachable(deleted.history)
    for (const buffer of buffers) expect(buffer.byteLength).toBeLessThan(width * height)

    const undone = undo(deleted)
    expect(sameBytes(undone.document!.pixels, pixels)).toBe(true)
    expect(sameSelection(undone.selection, before.selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toEqual({ ...before.lastMagicWandOperation, version: documentVersion(undone) })
    const redone = redo(undone)
    expect(sameBytes(redone.document!.pixels, deleted.document!.pixels)).toBe(true)
    expect(redone.history.retainedBytes).toBe(entry.retainedBytes)
  })
})
