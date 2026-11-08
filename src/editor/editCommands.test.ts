import { beforeEach, describe, expect, it } from 'vitest'
import type { DisplayImage } from '../canvas/displayImage'
import { createImportError } from '../image/import/errors'
import { deleteSelectedPixels } from '../image/edit/deleteSelection'
import { deleteSelectionWithEdges } from '../image/edit/deleteWithEdges'
import { edgeCases } from '../image/edit/edgeTestFixtures'
import { createPixelBuffer } from '../image/pixelBuffer'
import { createMagicWandSelection } from '../image/selection/magicWand'
import { combineSelections, selectAll } from '../image/selection/selectionOperations'
import { createSelectionMask } from '../image/selection/selectionMask'
import { type Rgba, imageFromRows } from '../image/selection/testFixtures'
import {
  type AvailableEditActions,
  availableEditActions,
  deleteSelectionCommand,
  editActionCommand,
  editShortcut,
  hasUnexportedEdits,
} from './editCommands'
import {
  type EditorState,
  displayViewport,
  documentVersion,
  editorReducer,
  initialEditorState,
} from './editorState'
import { createEditHistory } from './history/editHistory'
import {
  type FakeDisplayImages,
  WORKSPACE,
  accepted,
  fakeBitmap,
  fakeDisplayImages,
  mask,
  opened,
  randomInt,
  randomMask,
  randomSource,
  reduce,
  sameBytes,
  sameSelection,
} from './history/testFixtures'
import { createImageDocument } from './imageDocument'
import { commitToleranceCommand, magicWandClick } from './selectionCommands'
import type { PixelBuffer, SelectionMask, SelectionMode } from './types'

/*
 * Delete Selection, Undo and Redo as the application runs them (editActionCommand), with the
 * reducer: the Phase 3 Step 6 integration of the Step 2 algorithm and the Step 5 history.
 * Display images are fakes recording what was created.
 */

const palette: Readonly<Record<string, Rgba>> = {
  w: [250, 250, 250, 255],
  v: [244, 246, 241, 255],
  k: [10, 10, 10, 255],
  r: [220, 30, 30, 255],
  t: [40, 200, 90, 128],
  // Hidden colour under alpha 0: Delete must keep it, and nothing may show it.
  h: [77, 88, 99, 0],
}

/** 7 × 5: a light background (w, v) around a 1-pixel black line, two separate red squares, translucent and transparent pixels. */
function picture(): PixelBuffer {
  return imageFromRows(palette, 'wwvwwww', 'wrrwkwr', 'wrrwkwr', 'wwwwkwt', 'hhvwwwt')
}

const measured = reduce(initialEditorState, { type: 'workspace-resized', workspace: WORKSPACE })
const start = (pixels: PixelBuffer = picture(), limits?: { maxEntries: number; maxBytes: number }) =>
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

function withOptions(state: EditorState, options: { tolerance?: number; floodMode?: 'contiguous' | 'global' }): EditorState {
  let next = state
  if (options.tolerance !== undefined) next = reduce(next, { type: 'magic-wand-tolerance-changed', tolerance: options.tolerance })
  if (options.floodMode) next = reduce(next, { type: 'magic-wand-flood-mode-changed', floodMode: options.floodMode })
  return next
}

function select(state: EditorState, selection: SelectionMask | null): EditorState {
  return accepted(state, { type: 'selection-applied', version: documentVersion(state)!, selection })
}

/** The state after committing `tolerance` in the options row (re-applying the last click). */
function commit(state: EditorState, tolerance: number): EditorState {
  return reduce(state, ...commitToleranceCommand(state, tolerance))
}

/** Every pixel of `after` against `before` after deleting `selection`. */
function expectDeleted(before: PixelBuffer, after: PixelBuffer, selection: SelectionMask) {
  expect(after.width).toBe(before.width)
  expect(after.height).toBe(before.height)
  for (let p = 0; p < before.width * before.height; p++) {
    const i = p * 4
    const expected = [before.data[i], before.data[i + 1], before.data[i + 2], selection.data[p] ? 0 : before.data[i + 3]]
    expect([after.data[i], after.data[i + 1], after.data[i + 2], after.data[i + 3]]).toEqual(expected)
  }
}

const copyBytes = (pixels: PixelBuffer) => Uint8ClampedArray.from(pixels.data)

describe('Delete Selection', () => {
  it('deletes a Magic Wand selection: alpha 0, colour kept hidden, every other byte unchanged', () => {
    const before = click(start(), 0, 0)
    const selection = before.selection!
    expect(selection.count).toBeGreaterThan(10)
    // The 1-pixel black line, the squares and the translucent pixels are not selected.
    expect(selection.data[1 * 7 + 4]).toBe(0)
    expect(selection.data[1 * 7 + 1]).toBe(0)
    const after = run(before, 'delete-selection')
    expectDeleted(before.document!.pixels, after.document!.pixels, selection)
  })

  it('keeps the image, size and view, makes a fresh revision, clears the selection and click, records one entry', () => {
    const before = click(start(), 0, 0)
    const after = run(before, 'delete-selection')
    expect(after.document!.id).toBe(before.document!.id)
    expect(after.document!.revision).toBeGreaterThan(before.document!.revision)
    expect([after.document!.width, after.document!.height]).toEqual([7, 5])
    expect(after.viewport).toBe(before.viewport)
    expect(after.selection).toBeNull()
    expect(after.lastMagicWandOperation).toBeNull()
    expect(after.history.undo).toHaveLength(1)
    expect(after.history.redo).toHaveLength(0)
    expect(after.history.undo[0].kind).toBe('delete-selection')
    expect(after.history.undo[0].patch.kind).toBe('pixel-patch')
    expect(after.history.version).toEqual(documentVersion(after))
    expect(after.editDepth).toBe(1)
    expect(after.editNotice).toEqual({ kind: 'applied', operation: 'delete-selection', changedPixels: before.selection!.count })
    expect(after.editFeedbackId).toBe(before.editFeedbackId + 1)
    expect(after.editError).toBeNull()
    expect(availableEditActions(after)).toEqual({ deleteSelection: false, autoTrim: true, undo: 'delete-selection', redo: null })
  })

  it('creates one display image of the new pixels, held by the state, and releases nothing', () => {
    const after = run(click(start(), 0, 0), 'delete-selection')
    expect(images.created).toHaveLength(1)
    expect(images.created[0].pixels).toBe(after.document!.pixels)
    expect(after.documentBitmap).toBe(images.created[0])
    expect(images.created[0].released).toBe(false)
  })

  it('records the patch over the deleted pixels only', () => {
    // Background around a 3 × 2 opaque block in the corner: the deleted pixels' bounds.
    const pixels = imageFromRows(palette, 'kkkk', 'krrk', 'krrk', 'kkkk')
    const after = run(select(start(pixels), mask('....', '.##.', '.##.', '....')), 'delete-selection')
    const { patch } = after.history.undo[0]
    expect(patch.kind === 'pixel-patch' && patch.region).toEqual({ x: 1, y: 1, width: 2, height: 2 })
  })

  it('never writes the current pixels or the selection', () => {
    const before = click(start(), 0, 0)
    const pixels = copyBytes(before.document!.pixels)
    const selected = Uint8Array.from(before.selection!.data)
    run(before, 'delete-selection')
    expect(before.document!.pixels.data).toEqual(pixels)
    expect(before.selection!.data).toEqual(selected)
  })

  it('counts and changes only pixels that are not already transparent', () => {
    // The two hidden-colour pixels (row 4) and a background pixel next to them.
    const before = select(start(), mask('.......', '.......', '.......', '.......', '###....'))
    const after = run(before, 'delete-selection')
    expect(after.editNotice).toEqual({ kind: 'applied', operation: 'delete-selection', changedPixels: 1 })
    expectDeleted(before.document!.pixels, after.document!.pixels, before.selection!)
    // Hidden colour under alpha 0 is kept byte for byte.
    expect(Array.from(after.document!.pixels.data.subarray(28 * 4, 28 * 4 + 4))).toEqual([77, 88, 99, 0])
  })

  it('changes nothing and records nothing when only fully transparent pixels are selected', () => {
    const before = select(start(), mask('.......', '.......', '.......', '.......', '##.....'))
    const action = command(before, 'delete-selection')
    expect(action).toEqual({ type: 'edit-unchanged', version: documentVersion(before), operation: 'delete-selection' })
    expect(images.created).toHaveLength(0)
    const after = reduce(before, action!)
    expect(after.document).toBe(before.document)
    expect(after.documentBitmap).toBe(before.documentBitmap)
    expect(after.selection).toBe(before.selection)
    expect(after.history).toBe(before.history)
    expect(after.editDepth).toBe(0)
    expect(after.editNotice).toEqual({ kind: 'unchanged', operation: 'delete-selection' })
    expect(after.editFeedbackId).toBe(before.editFeedbackId + 1)
    expect(hasUnexportedEdits(after)).toBe(false)
  })

  it('ignores a "nothing changed" report for another version', () => {
    const before = select(start(), mask('.......', '.......', '.......', '.......', '##.....'))
    const stale = command(before, 'delete-selection')!
    const later = run(select(before, mask('#......', '.......', '.......', '.......', '.......')), 'delete-selection')
    expect(reduce(later, stale)).toBe(later)
  })

  it('is unavailable without an image, without a selection and while another image opens', () => {
    expect(command(initialEditorState, 'delete-selection')).toBeNull()
    const state = start()
    expect(command(state, 'delete-selection')).toBeNull()
    const selected = click(state, 0, 0)
    const importing = reduce(selected, { type: 'import-started', importId: 99 })
    expect(availableEditActions(importing)).toEqual({ deleteSelection: false, autoTrim: false, undo: null, redo: null })
    expect(command(importing, 'delete-selection')).toBeNull()
    // A failed import makes it available again, with the selection kept.
    const failed = reduce(importing, { type: 'import-finished', importId: 99, result: { ok: false, error: createImportError('decode-failed') } })
    expect(availableEditActions(failed).deleteSelection).toBe(true)
    expect(images.created).toHaveLength(0)
  })

  it('reports a failure to display the result without changing anything', () => {
    const before = click(start(), 0, 0)
    images.failing = true
    const action = command(before, 'delete-selection')!
    expect(action.type).toBe('edit-failed')
    const after = reduce(before, action)
    for (const key of ['document', 'documentBitmap', 'selection', 'lastMagicWandOperation', 'history', 'viewport', 'editDepth'] as const) {
      expect(after[key]).toBe(before[key])
    }
    expect(after.editError).toMatchObject({ operation: 'delete-selection', detail: 'Error: Out of memory (test)' })
    expect(after.editNotice).toBeNull()
    expect(after.editFeedbackId).toBe(before.editFeedbackId + 1)
    expect(images.created).toHaveLength(0)
  })

  it('reports an exception from the Delete algorithm as a failure', () => {
    const state = start()
    // A selection of another size, as only a defect could produce.
    const broken: EditorState = { ...state, selection: createSelectionMask(2, 2, new Uint8Array([1, 0, 0, 0])) }
    const action = deleteSelectionCommand(broken, images.create)
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'delete-selection', detail: expect.stringMatching(/^RangeError/) } })
    expect(images.created).toHaveLength(0)
  })

  it('deletes once when pressed twice: a second Delete from the same state is stale, a second from the new state has nothing', () => {
    const before = click(start(), 0, 0)
    const first = command(before, 'delete-selection')!
    const second = command(before, 'delete-selection')!
    const after = accepted(before, first)
    expect(reduce(after, second)).toBe(after)
    expect(command(after, 'delete-selection')).toBeNull()
  })

  it('rejects a Delete computed before the selection changed', () => {
    const before = click(start(), 0, 0)
    const stale = command(before, 'delete-selection')!
    const changed = click(before, 1, 1)
    expect(reduce(changed, stale)).toBe(changed)
  })

  it('never accepts an action whose display image has been released', () => {
    const before = click(start(), 0, 0)
    // A display image that loses its size when released, as bitmaps and canvases do.
    const releasable = (pixels: PixelBuffer): DisplayImage => {
      const image = { width: pixels.width, height: pixels.height, close: () => Object.assign(image, { width: 0, height: 0 }) }
      return image as unknown as DisplayImage
    }
    const action = editActionCommand(before, 'delete-selection', releasable)!
    if (action.type !== 'edit-applied') throw new Error('Expected an edit')
    ;(action.image as unknown as { close(): void }).close()
    expect(reduce(before, action)).toBe(before)
  })
})

describe('Delete Selection with Undo and Redo', () => {
  it('several independent Deletes undo and redo exactly, one at a time, with their selections', () => {
    let state = start()
    const steps: { pixels: Uint8ClampedArray; selection: SelectionMask; revision: number }[] = []
    // A red square (contiguous), the line, then the background.
    for (const [x, y] of [[1, 1], [4, 1], [0, 0]]) {
      state = click(state, x, y)
      steps.push({ pixels: copyBytes(state.document!.pixels), selection: state.selection!, revision: state.document!.revision })
      const before = state.document!.pixels
      state = run(state, 'delete-selection')
      expectDeleted(before, state.document!.pixels, steps.at(-1)!.selection)
    }
    const final = copyBytes(state.document!.pixels)
    expect(state.history.undo).toHaveLength(3)
    const revisions = [state.document!.revision]
    for (let i = steps.length - 1; i >= 0; i--) {
      state = run(state, 'undo')
      expect(state.document!.pixels.data).toEqual(steps[i].pixels)
      expect(sameSelection(state.selection, steps[i].selection)).toBe(true)
      revisions.push(state.document!.revision)
    }
    expect(state.editDepth).toBe(0)
    expect(command(state, 'undo')).toBeNull()
    for (let i = 0; i < steps.length; i++) {
      state = run(state, 'redo')
      expect(state.selection).toBeNull()
      revisions.push(state.document!.revision)
    }
    expect(state.document!.pixels.data).toEqual(final)
    expect(command(state, 'redo')).toBeNull()
    // Every revision is new.
    for (let i = 1; i < revisions.length; i++) expect(revisions[i]).toBeGreaterThan(revisions[i - 1])
    expect(new Set([...steps.map((s) => s.revision), ...revisions]).size).toBe(steps.length + revisions.length)
  })

  it('round-trips random images and selections bit for bit, hidden colour included', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const random = randomSource(seed)
      const width = 1 + randomInt(random, 9)
      const height = 1 + randomInt(random, 7)
      const data = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < data.length; i++) data[i] = randomInt(random, 256)
      // Many pixels already transparent, with hidden colour.
      for (let p = 0; p < width * height; p++) if (random() < 0.3) data[p * 4 + 3] = 0
      const pixels = createPixelBuffer(width, height, data)
      const selection = randomMask(width, height, random, 0.5)
      if (!selection) continue
      const state = select(start(pixels), selection)
      const action = command(state, 'delete-selection')!
      if (action.type === 'edit-unchanged') {
        expect(selection.data.every((selected, p) => !selected || data[p * 4 + 3] === 0)).toBe(true)
        continue
      }
      const deleted = accepted(state, action)
      expectDeleted(pixels, deleted.document!.pixels, state.selection!)
      const undone = run(deleted, 'undo')
      expect(sameBytes(undone.document!.pixels, pixels)).toBe(true)
      expect(sameSelection(undone.selection, state.selection)).toBe(true)
      const redone = run(undone, 'redo')
      expect(sameBytes(redone.document!.pixels, deleted.document!.pixels)).toBe(true)
      expect(redone.selection).toBeNull()
    }
  })

  it('Undo restores the click: a committed tolerance re-applies it exactly as before the Delete', () => {
    const tolerance20 = click(withOptions(start(), { tolerance: 20 }), 0, 0)
    // 70 also takes the translucent pixels, 0 only the exact white.
    const wider = commit(tolerance20, 70).selection
    const narrower = commit(tolerance20, 0).selection
    expect(sameSelection(wider, tolerance20.selection)).toBe(false)
    expect(sameSelection(narrower, tolerance20.selection)).toBe(false)
    const back = commit(commit(tolerance20, 70), 20)
    const undone = run(run(back, 'delete-selection'), 'undo')
    expect(sameSelection(undone.selection, tolerance20.selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toMatchObject({ seed: { x: 0, y: 0 }, selectionMode: 'new', tolerance: 20, version: documentVersion(undone) })
    expect(sameSelection(commit(undone, 70).selection, wider)).toBe(true)
    expect(sameSelection(commit(undone, 0).selection, narrower)).toBe(true)
  })

  it('Undo restores an Add click and the selection it was added to', () => {
    const first = click(withOptions(start(), { tolerance: 10 }), 1, 1)
    const added = click(first, 6, 1, 'add')
    expect(added.selection!.count).toBe(first.selection!.count + 2)
    const undone = run(run(added, 'delete-selection'), 'undo')
    expect(sameSelection(undone.selection, added.selection)).toBe(true)
    expect(undone.lastMagicWandOperation!.selectionMode).toBe('add')
    expect(sameSelection(undone.lastMagicWandOperation!.base, first.selection)).toBe(true)
    // Re-applied with another tolerance: combined with that base, never with the current selection.
    const pixels = undone.document!.pixels
    const expected = combineSelections(first.selection, createMagicWandSelection(pixels, { x: 6, y: 1 }, { tolerance: 90, floodMode: 'contiguous' }), 'add')
    expect(sameSelection(commit(undone, 90).selection, expected)).toBe(true)
  })

  it('Undo restores a Subtract click and the selection it was subtracted from', () => {
    const everything = select(withOptions(start(), { tolerance: 10, floodMode: 'global' }), selectAll(7, 5))
    const subtracted = click(everything, 1, 1, 'subtract')
    expect(subtracted.selection!.count).toBe(35 - 6)
    const undone = run(run(subtracted, 'delete-selection'), 'undo')
    expect(sameSelection(undone.selection, subtracted.selection)).toBe(true)
    expect(undone.lastMagicWandOperation).toMatchObject({ selectionMode: 'subtract', floodMode: 'global' })
    expect(sameSelection(undone.lastMagicWandOperation!.base, everything.selection)).toBe(true)
    const pixels = undone.document!.pixels
    const expected = combineSelections(everything.selection, createMagicWandSelection(pixels, { x: 1, y: 1 }, { tolerance: 100, floodMode: 'global' }), 'subtract')
    expect(sameSelection(commit(undone, 100).selection, expected)).toBe(true)
  })

  it('selection changes after Undo are not history: Redo replaces them with the Delete result', () => {
    const undone = run(run(click(start(), 0, 0), 'delete-selection'), 'undo')
    const reselected = click(undone, 4, 1)
    expect(availableEditActions(reselected).redo).toBe('delete-selection')
    const redone = run(reselected, 'redo')
    expect(redone.selection).toBeNull()
    expect(redone.history.undo).toHaveLength(1)
  })

  it('a new Delete after Undo clears Redo', () => {
    const undone = run(run(click(start(), 0, 0), 'delete-selection'), 'undo')
    const again = run(click(undone, 1, 1), 'delete-selection')
    expect(again.history.redo).toHaveLength(0)
    expect(again.history.undo).toHaveLength(1)
    expect(command(again, 'redo')).toBeNull()
  })

  it('applies two Undos or two Redos computed from one state once', () => {
    let state = run(click(start(), 1, 1), 'delete-selection')
    state = run(click(state, 0, 0), 'delete-selection')
    const undoA = command(state, 'undo')!
    const undoB = command(state, 'undo')!
    const once = accepted(state, undoA)
    expect(reduce(once, undoB)).toBe(once)
    expect(once.history.undo).toHaveLength(1)
    const redoA = command(once, 'redo')!
    const redoB = command(once, 'redo')!
    const redone = accepted(once, redoA)
    expect(reduce(redone, redoB)).toBe(redone)
  })

  it('Undo and Redo are unavailable while another image opens', () => {
    const deleted = run(click(start(), 0, 0), 'delete-selection')
    const importing = reduce(deleted, { type: 'import-started', importId: 7 })
    expect(command(importing, 'undo')).toBeNull()
    const undone = run(deleted, 'undo')
    expect(command(reduce(undone, { type: 'import-started', importId: 8 }), 'redo')).toBeNull()
    expect(availableEditActions(importing)).toEqual({ deleteSelection: false, autoTrim: false, undo: null, redo: null })
  })

  it('announces Undo and Redo, and a later failure replaces the announcement', () => {
    const deleted = run(click(start(), 0, 0), 'delete-selection')
    const undone = run(deleted, 'undo')
    expect(undone.editNotice).toEqual({ kind: 'undone', operation: 'delete-selection' })
    const redone = run(undone, 'redo')
    expect(redone.editNotice).toEqual({ kind: 'redone', operation: 'delete-selection' })
    expect(redone.editFeedbackId).toBe(deleted.editFeedbackId + 2)
    images.failing = true
    const failed = reduce(redone, command(redone, 'undo')!)
    expect(failed.editNotice).toBeNull()
    expect(failed.editError).toMatchObject({ operation: 'undo' })
    images.failing = false
    const recovered = run(failed, 'undo')
    expect(recovered.editError).toBeNull()
    expect(recovered.editNotice).toEqual({ kind: 'undone', operation: 'delete-selection' })
  })

  it('React Strict Mode: running the reducer twice gives the same state, holding the same image, creating and releasing nothing', () => {
    const selected = click(start(), 0, 0)
    const deleted = run(selected, 'delete-selection')
    for (const [state, action] of [
      [selected, command(selected, 'delete-selection')!],
      [deleted, command(deleted, 'undo')!],
    ] as const) {
      const created = images.created.length
      const once = editorReducer(state, action)
      const twice = editorReducer(state, action)
      expect(images.created).toHaveLength(created)
      expect(twice.documentBitmap).toBe(once.documentBitmap)
      expect(twice.document).toBe(once.document)
      expect(twice.selection).toBe(once.selection)
      expect(twice.history.undo).toEqual(once.history.undo)
      expect(twice.editDepth).toBe(once.editDepth)
      expect(twice.editFeedbackId).toBe(once.editFeedbackId)
      expect(images.created.every((image) => !image.released)).toBe(true)
    }
  })
})

describe('availableEditActions', () => {
  const none: AvailableEditActions = { deleteSelection: false, autoTrim: false, undo: null, redo: null }
  // With an image open, Auto Trim is always offered (it says when there is nothing to trim).
  const opened: AvailableEditActions = { ...none, autoTrim: true }

  it('names the edits Undo and Redo would apply', () => {
    expect(availableEditActions(initialEditorState)).toEqual(none)
    const state = start()
    expect(availableEditActions(state)).toEqual(opened)
    const selected = click(state, 0, 0)
    expect(availableEditActions(selected)).toEqual({ ...opened, deleteSelection: true })
    const deleted = run(selected, 'delete-selection')
    expect(availableEditActions(deleted)).toEqual({ ...opened, undo: 'delete-selection' })
    const undone = run(deleted, 'undo')
    expect(availableEditActions(undone)).toEqual({ ...opened, deleteSelection: true, redo: 'delete-selection' })
  })

  it('offers nothing from a history bound to another version', () => {
    const deleted = run(click(start(), 0, 0), 'delete-selection')
    const other = { ...deleted, history: { ...deleted.history, version: { documentId: deleted.document!.id, revision: 0 } } }
    expect(availableEditActions(other)).toEqual(opened)
    expect(command(other, 'undo')).toBeNull()
  })
})

describe('hasUnexportedEdits', () => {
  it('follows edits, Undo and Redo, never comparing images', () => {
    expect(hasUnexportedEdits(initialEditorState)).toBe(false)
    let state = start()
    expect(hasUnexportedEdits(state)).toBe(false)
    state = run(click(state, 0, 0), 'delete-selection')
    expect(hasUnexportedEdits(state)).toBe(true)
    state = run(state, 'undo')
    // Back to the opened pixels: nothing would be lost but Redo.
    expect(hasUnexportedEdits(state)).toBe(false)
    expect(availableEditActions(state).redo).toBe('delete-selection')
    state = run(state, 'redo')
    expect(hasUnexportedEdits(state)).toBe(true)
  })

  it('a new edit after Undo, selection changes, no-ops and failures', () => {
    let state = run(click(start(), 0, 0), 'delete-selection')
    state = run(click(run(state, 'undo'), 1, 1), 'delete-selection')
    expect(state.editDepth).toBe(1)
    state = run(state, 'undo')
    expect(hasUnexportedEdits(state)).toBe(false)
    state = click(state, 4, 1)
    expect(hasUnexportedEdits(state)).toBe(false)
    // Delete of only transparent pixels changes nothing.
    state = select(state, mask('.......', '.......', '.......', '.......', '##.....'))
    state = reduce(state, command(state, 'delete-selection')!)
    expect(state.editNotice?.kind).toBe('unchanged')
    expect(hasUnexportedEdits(state)).toBe(false)
    // A failed Delete changes nothing either.
    state = click(state, 0, 0)
    images.failing = true
    state = reduce(state, command(state, 'delete-selection')!)
    expect(state.editError).not.toBeNull()
    expect(hasUnexportedEdits(state)).toBe(false)
  })

  it('stays true once the limits have dropped the oldest edits', () => {
    let state = start(picture(), { maxEntries: 2, maxBytes: 1 << 20 })
    for (const [x, y] of [[1, 1], [4, 1], [0, 0]]) state = run(click(state, x, y), 'delete-selection')
    expect(state.history.undo).toHaveLength(2)
    state = run(run(state, 'undo'), 'undo')
    expect(command(state, 'undo')).toBeNull()
    expect(state.editDepth).toBe(1)
    expect(hasUnexportedEdits(state)).toBe(true)
  })

  it('opening another image clears it; a failed import keeps it', () => {
    const edited = run(click(start(), 0, 0), 'delete-selection')
    const failed = reduce(
      edited,
      { type: 'import-started', importId: 50 },
      { type: 'import-finished', importId: 50, result: { ok: false, error: createImportError('decode-failed') } },
    )
    expect(hasUnexportedEdits(failed)).toBe(true)
    expect(failed.history).toBe(edited.history)
    const document = createImageDocument({ name: 'b.png', format: 'png', source: 'drop', fileSizeBytes: 1, pixels: picture() })
    const replaced = reduce(
      failed,
      { type: 'import-started', importId: 51 },
      { type: 'import-finished', importId: 51, result: { ok: true, document, bitmap: fakeBitmap(7, 5) } },
    )
    expect(hasUnexportedEdits(replaced)).toBe(false)
    expect(replaced.editNotice).toBeNull()
    expect(replaced.history.undo).toHaveLength(0)
  })
})

describe('editShortcut', () => {
  /** A fake element whose closest() matches only the given selector fragments. */
  function element(matching: string[] = [], isContentEditable = false, type?: string): EventTarget {
    const fake = {
      isContentEditable,
      type,
      closest: (selector: string) => (matching.some((part) => selector.split(',').map((s) => s.trim()).includes(part)) ? fake : null),
    }
    return fake as unknown as EventTarget
  }
  const key = (name: string, options: Partial<Parameters<typeof editShortcut>[0]> = {}) =>
    editShortcut({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, ...options })

  it('maps Delete, Ctrl + Z, Ctrl + Y and Ctrl + Shift + Z (and ⌘ Command)', () => {
    expect(key('Delete')).toBe('delete-selection')
    expect(key('z', { ctrlKey: true })).toBe('undo')
    expect(key('z', { metaKey: true })).toBe('undo')
    expect(key('y', { ctrlKey: true })).toBe('redo')
    expect(key('Y', { ctrlKey: true })).toBe('redo')
    expect(key('Z', { ctrlKey: true, shiftKey: true })).toBe('redo')
    expect(key('z', { ctrlKey: true, shiftKey: true })).toBe('redo')
    expect(key('Z', { metaKey: true, shiftKey: true })).toBe('redo')
  })

  it('never repeats Delete while it is held; Undo and Redo repeat', () => {
    expect(key('Delete', { repeat: true })).toBeNull()
    expect(key('z', { ctrlKey: true, repeat: true })).toBe('undo')
    expect(key('y', { ctrlKey: true, repeat: true })).toBe('redo')
  })

  it('ignores Delete with modifiers, Backspace, Alt combinations and other keys', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) expect(key('Delete', { [modifier]: true })).toBeNull()
    expect(key('Backspace')).toBeNull()
    expect(key('z')).toBeNull()
    expect(key('y')).toBeNull()
    expect(key('z', { ctrlKey: true, altKey: true })).toBeNull()
    expect(key('y', { ctrlKey: true, shiftKey: true })).toBeNull()
    expect(key('x', { ctrlKey: true })).toBeNull()
  })

  it('works with focus on the page, buttons and the tolerance slider', () => {
    expect(key('Delete', { target: element(['button']) })).toBe('delete-selection')
    expect(key('z', { ctrlKey: true, target: element(['input'], false, 'range') })).toBe('undo')
  })

  it('leaves text fields, editable content and lists alone, and composition or handled keys', () => {
    for (const target of [element(['input'], false, 'text'), element(['input'], false, 'number'), element(['textarea']), element(['select']), element([], true)]) {
      expect(key('Delete', { target })).toBeNull()
      expect(key('z', { ctrlKey: true, target })).toBeNull()
      expect(key('y', { ctrlKey: true, target })).toBeNull()
    }
    expect(key('Delete', { isComposing: true })).toBeNull()
    expect(key('z', { ctrlKey: true, defaultPrevented: true })).toBeNull()
  })
})

describe('Delete Selection at 1024 × 768', () => {
  it('deletes a large background exactly, with a compact entry, and undoes and redoes it', () => {
    const width = 1024
    const height = 768
    const data = new Uint8ClampedArray(width * height * 4)
    for (let p = 0; p < width * height; p++) {
      const x = p % width
      const y = Math.floor(p / width)
      const inside = (x - 512) ** 2 + (y - 384) ** 2 < 200 ** 2
      data.set(inside ? [(x * 7) & 255, (y * 3) & 255, 90, 255] : [240, 242, 245, 255], p * 4)
    }
    const pixels = createPixelBuffer(width, height, data)
    const before = click(start(pixels), 0, 0)
    expect(before.selection!.count).toBeGreaterThan(width * height * 0.8)
    const deleted = run(before, 'delete-selection')
    expectDeleted(pixels, deleted.document!.pixels, before.selection!)
    expect(deleted.history.retainedBytes).toBeLessThan(32 * 1024)
    const undone = run(deleted, 'undo')
    expect(sameBytes(undone.document!.pixels, pixels)).toBe(true)
    expect(sameSelection(undone.selection, before.selection)).toBe(true)
    expect(sameBytes(run(undone, 'redo').document!.pixels, deleted.document!.pixels)).toBe(true)
  })
})


describe('Delete Selection with edge cleanup and feathering (Step 8)', () => {
  /** The anti-aliased logo scene (Step 7 kind), opened and clicked like the user would. */
  function logoSelected(): EditorState {
    const logo = edgeCases().find((c) => c.name === 'anti-aliased logo on blue')!
    return click(withOptions(start(logo.observed), { tolerance: 10 }), 0, 0)
  }
  const withEdges = (state: EditorState, cleanup: number, feather: number) => reduce(state, { type: 'edge-settings-changed', settings: { cleanup, feather } })

  it('deletes with the settings in the editor: exactly deleteSelectionWithEdges, one entry, one image, selection cleared', () => {
    for (const [cleanup, feather] of [[1, 0], [3, 0], [0, 2], [2, 2], [5, 5]]) {
      const before = withEdges(logoSelected(), cleanup, feather)
      const created = images.created.length
      const action = command(before, 'delete-selection')!
      const deleted = accepted(before, action)
      const expected = deleteSelectionWithEdges(before.document!.pixels, before.selection, { cleanup, feather })!
      expect(sameBytes(deleted.document!.pixels, expected.pixels), `${cleanup}/${feather}`).toBe(true)
      expect(expected.edgePixels).toBeGreaterThan(0)
      expect(images.created).toHaveLength(created + 1)
      expect(deleted.documentBitmap).toBe(images.created.at(-1))
      expect(deleted.history.undo).toHaveLength(1)
      expect(deleted.selection).toBeNull()
      expect(deleted.lastMagicWandOperation).toBeNull()
      expect(deleted.edgeSettings).toEqual({ cleanup, feather })
      expect(deleted.editNotice).toEqual({ kind: 'applied', operation: 'delete-selection', changedPixels: expected.count, edgePixels: expected.edgePixels })
    }
  })

  it('with both settings at 0 (the default) deletes exactly as in Step 6', () => {
    const before = logoSelected()
    expect(before.edgeSettings).toEqual({ cleanup: 0, feather: 0 })
    const deleted = run(before, 'delete-selection')
    expect(sameBytes(deleted.document!.pixels, deleteSelectedPixels(before.document!.pixels, before.selection)!.pixels)).toBe(true)
    expect(deleted.editNotice).toEqual({ kind: 'applied', operation: 'delete-selection', changedPixels: before.selection!.count })
  })

  it('records every changed colour and alpha byte: Undo restores the image, selection and click exactly; Redo the result', () => {
    for (const [cleanup, feather] of [[1, 0], [5, 0], [0, 5], [5, 5]]) {
      const before = withEdges(logoSelected(), cleanup, feather)
      const original = copyBytes(before.document!.pixels)
      const deleted = run(before, 'delete-selection')
      const result = copyBytes(deleted.document!.pixels)
      const undone = run(deleted, 'undo')
      expect(undone.document!.pixels.data).toEqual(original)
      expect(sameSelection(undone.selection, before.selection)).toBe(true)
      expect(undone.lastMagicWandOperation?.tolerance).toBe(10)
      expect(undone.document!.revision).toBeGreaterThan(deleted.document!.revision)
      // The restored click re-applies exactly as before the Delete.
      const reapplied = commit(commit(undone, 30), 10)
      expect(sameSelection(reapplied.selection, before.selection)).toBe(true)
      const redone = run(undone, 'redo')
      expect(redone.document!.pixels.data).toEqual(result)
      expect(redone.selection).toBeNull()
      // And again: still exact, with fresh revisions.
      const again = run(run(redone, 'undo'), 'redo')
      expect(again.document!.pixels.data).toEqual(result)
      expect(again.document!.revision).toBeGreaterThan(redone.document!.revision)
    }
  })

  it('changes nothing when the selected pixels are already transparent, whatever the settings', () => {
    const before = withEdges(logoSelected(), 5, 5)
    const deleted = run(before, 'delete-selection')
    // Select the deleted area again and press Delete.
    const again = select(deleted, selectAll(deleted.document!.width, deleted.document!.height))
    const transparentOnly = select(again, before.selection)
    const action = command(transparentOnly, 'delete-selection')
    expect(action).toEqual({ type: 'edit-unchanged', version: documentVersion(transparentOnly), operation: 'delete-selection' })
    const after = reduce(transparentOnly, action!)
    expect(after.document).toBe(transparentOnly.document)
    expect(after.selection).toBe(transparentOnly.selection)
    expect(after.history.undo).toHaveLength(1)
  })

  it('keeps the settings for the session: unchanged by Delete, Undo, Redo and opening another image', () => {
    const before = withEdges(logoSelected(), 3, 2)
    const deleted = run(before, 'delete-selection')
    const undone = run(deleted, 'undo')
    const redone = run(undone, 'redo')
    for (const state of [deleted, undone, redone, opened(picture(), redone)]) expect(state.edgeSettings).toEqual({ cleanup: 3, feather: 2 })
  })

  it('React Strict Mode: running the reducer twice on a Delete with edge settings gives the same state and image', () => {
    const before = withEdges(logoSelected(), 2, 2)
    const action = command(before, 'delete-selection')!
    const created = images.created.length
    const once = editorReducer(before, action)
    const twice = editorReducer(before, action)
    expect(images.created).toHaveLength(created)
    expect(twice.document).toBe(once.document)
    expect(twice.documentBitmap).toBe(once.documentBitmap)
    expect(twice.history.undo).toEqual(once.history.undo)
    expect(images.created.every((image) => !image.released)).toBe(true)
  })

  it('reports a failure of the edge passes like any Delete failure, changing nothing', () => {
    // Settings outside 0–5 cannot come from the reducer; forced here to make the algorithm throw.
    const before = { ...logoSelected(), edgeSettings: { cleanup: 9, feather: 0 } }
    const action = command(before, 'delete-selection')
    expect(action).toMatchObject({ type: 'edit-failed', error: { operation: 'delete-selection', detail: expect.stringMatching(/^RangeError/) } })
    const after = reduce(before, action!)
    expect(after.document).toBe(before.document)
    expect(after.selection).toBe(before.selection)
    expect(images.created.every((image) => !image.released)).toBe(true)
  })
})
