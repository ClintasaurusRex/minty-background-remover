import { describe, expect, it } from 'vitest'
import { deleteSelectedPixels } from '../../image/edit/deleteSelection'
import { createPixelBuffer } from '../../image/pixelBuffer'
import type { PixelBuffer, SelectionMask } from '../types'
import { createCropPatch } from './cropPatch'
import { retainedBytes } from './historyBytes'
import { deleteSelectionWithEdges } from '../../image/edit/deleteWithEdges'
import {
  type MagicWandClick,
  createHistoryEntry,
  entryPayloads,
  remadeHistoryEntry,
  restoreSelectionAfter,
  restoreSelectionBefore,
  sizeAfter,
  sizeBefore,
} from './historyEntry'
import { createPixelPatch } from './pixelPatch'
import { mask, randomImage, randomSource, reachable, sameSelection } from './testFixtures'

const random = randomSource(7)
const image = randomImage(4, 3, random)

/** A Delete of `selection` from `pixels`, as Step 6 will record it: the patch over the deleted bounds. */
function deletePatch(pixels: PixelBuffer, selection: SelectionMask) {
  const result = deleteSelectedPixels(pixels, selection)!
  return createPixelPatch(pixels, result.pixels, result.bounds)!
}

function click(base: SelectionMask | null, change: Partial<MagicWandClick> = {}): MagicWandClick {
  return { seed: { x: 1, y: 2 }, floodMode: 'global', selectionMode: base ? 'add' : 'new', base, tolerance: 37, ...change }
}

const corner = () => mask('##..', '#...', '....')
const side = () => mask('...#', '...#', '...#')

describe('history entries', () => {
  it('keep the patch and encoded copies of the selections and click, and nothing else', () => {
    const selection = corner()
    const base = side()
    const patch = deletePatch(image, selection)
    const entry = createHistoryEntry({
      kind: 'delete-selection',
      patch,
      selectionBefore: selection,
      magicWandBefore: click(base),
      selectionAfter: null,
    })
    expect(entry.kind).toBe('delete-selection')
    expect(entry.patch).toBe(patch)
    expect(entry.selectionBefore).toMatchObject({ kind: 'selection', width: 4, height: 3, count: 3 })
    expect(entry.magicWandBefore).toMatchObject({ seed: { x: 1, y: 2 }, floodMode: 'global', selectionMode: 'add', tolerance: 37 })
    expect(entry.magicWandBefore!.base).toMatchObject({ kind: 'selection', count: 3 })
    expect(entry.selectionAfter).toBeNull()
    expect(entry.retainedBytes).toBe(retainedBytes(entryPayloads(entry)))

    // No mask, pixel buffer, version or revision is kept: only the payloads' own arrays.
    const { objects, buffers } = reachable(entry)
    for (const kept of [selection, base, selection.data, base.data, image, image.data]) expect(objects.has(kept)).toBe(false)
    expect(buffers.has(image.data.buffer)).toBe(false)
    expect(buffers.has(selection.data.buffer as ArrayBuffer)).toBe(false)
    expect(JSON.stringify(Object.keys(entry))).not.toMatch(/version|revision|document/)
    const payloadBuffers = new Set(
      [patch.changes.tokens, patch.changes.literals, entry.selectionBefore!.data, entry.magicWandBefore!.base!.data].map(
        (array) => array.buffer,
      ),
    )
    expect(buffers).toEqual(payloadBuffers)
  })

  it('restore the selection and the click with its previous selection exactly, as new masks', () => {
    const selection = corner()
    const base = side()
    const recorded = click(base, { selectionMode: 'subtract' })
    const entry = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(image, selection),
      selectionBefore: selection,
      magicWandBefore: recorded,
      selectionAfter: null,
    })
    const restored = restoreSelectionBefore(entry)
    expect(sameSelection(restored.selection, selection)).toBe(true)
    expect(restored.selection).not.toBe(selection)
    expect(restored.magicWand).toMatchObject({ seed: recorded.seed, floodMode: 'global', selectionMode: 'subtract', tolerance: 37 })
    expect(restored.magicWand!.seed).not.toBe(recorded.seed)
    expect(sameSelection(restored.magicWand!.base, base)).toBe(true)
    expect(restored.magicWand!.base).not.toBe(restored.selection)
    expect(Object.keys(restored.magicWand!)).not.toContain('version')
    expect(restoreSelectionAfter(entry)).toBeNull()

    // Restoring again gives new, equal masks: an entry can be undone, redone and undone again.
    const again = restoreSelectionBefore(entry)
    expect(again.selection).not.toBe(restored.selection)
    expect(sameSelection(again.selection, selection)).toBe(true)
  })

  it('encode a click whose previous selection was the selection itself once, and restore one shared mask', () => {
    // An Add click that added nothing: the result is the previous selection.
    const selection = corner()
    const entry = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(image, selection),
      selectionBefore: selection,
      magicWandBefore: click(selection),
      selectionAfter: null,
    })
    expect(entry.magicWandBefore!.base).toBe(entry.selectionBefore)
    const restored = restoreSelectionBefore(entry)
    expect(restored.magicWand!.base).toBe(restored.selection)
    expect(sameSelection(restored.selection, selection)).toBe(true)
    expect(entry.retainedBytes).toBe(retainedBytes([entry.patch, entry.selectionBefore]))
  })

  it('handle no selection, a New click and a selection kept by the edit', () => {
    const none = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(image, corner()),
      selectionBefore: null,
      magicWandBefore: null,
      selectionAfter: null,
    })
    expect(none.selectionBefore).toBeNull()
    expect(restoreSelectionBefore(none)).toEqual({ selection: null, magicWand: null })
    expect(none.retainedBytes).toBe(retainedBytes([none.patch]))

    // A Subtract from nothing records no previous selection; New never does.
    const subtracted = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(image, corner()),
      selectionBefore: null,
      magicWandBefore: click(null, { selectionMode: 'subtract' }),
      selectionAfter: null,
    })
    expect(restoreSelectionBefore(subtracted)).toMatchObject({ selection: null, magicWand: { selectionMode: 'subtract', base: null } })

    // An edit that keeps the selection stores it once for both directions.
    const selection = side()
    const kept = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(image, corner()),
      selectionBefore: selection,
      magicWandBefore: click(null),
      selectionAfter: selection,
    })
    expect(kept.selectionAfter).toBe(kept.selectionBefore)
    const after = restoreSelectionAfter(kept)
    expect(sameSelection(after, selection)).toBe(true)
    expect(after).not.toBe(selection)
  })

  it('record crops with selections of each image size', () => {
    const before = randomImage(6, 5, random)
    const patch = createCropPatch(before, { x: 1, y: 2, width: 4, height: 2 })!
    expect(sizeBefore(patch)).toEqual({ width: 6, height: 5 })
    expect(sizeAfter(patch)).toEqual({ width: 4, height: 2 })
    const selectionBefore = mask('......', '.##...', '.##...', '......', '......')
    const selectionAfter = mask('##..', '##..')
    const entry = createHistoryEntry({
      kind: 'auto-trim',
      patch,
      selectionBefore,
      magicWandBefore: click(selectionBefore),
      selectionAfter,
    })
    expect(sameSelection(restoreSelectionBefore(entry).selection, selectionBefore)).toBe(true)
    expect(sameSelection(restoreSelectionAfter(entry), selectionAfter)).toBe(true)
  })

  it('reject selections that are not the size of their image', () => {
    const patch = deletePatch(image, corner())
    const wrong = mask('##.', '#..', '...')
    const input = { kind: 'delete-selection' as const, patch, selectionBefore: null, magicWandBefore: null, selectionAfter: null }
    expect(() => createHistoryEntry({ ...input, selectionBefore: wrong })).toThrow(RangeError)
    expect(() => createHistoryEntry({ ...input, selectionAfter: wrong })).toThrow(RangeError)
    expect(() => createHistoryEntry({ ...input, magicWandBefore: click(wrong) })).toThrow(RangeError)

    // A crop's selection after it is the cropped size, not the original one.
    const crop = createCropPatch(image, { x: 0, y: 0, width: 2, height: 2 })!
    expect(() => createHistoryEntry({ ...input, patch: crop, selectionAfter: corner() })).toThrow(RangeError)
    expect(() => createHistoryEntry({ ...input, patch: crop, selectionBefore: mask('##', '#.') })).toThrow(RangeError)
  })

  it('never write the masks or pixels they are made from', () => {
    const selection = corner()
    const base = side()
    const pixels = createPixelBuffer(4, 3, image.data.slice())
    const copies = [selection.data.slice(), base.data.slice(), pixels.data.slice()]
    const entry = createHistoryEntry({
      kind: 'delete-selection',
      patch: deletePatch(pixels, selection),
      selectionBefore: selection,
      magicWandBefore: click(base),
      selectionAfter: null,
    })
    restoreSelectionBefore(entry)
    expect([selection.data, base.data, pixels.data]).toEqual(copies)
  })
})

describe('history entries made again (Phase 3 Step 9)', () => {
  /** A 12 × 9 object on a light background, its background selected, deleted with `settings`. */
  function scene() {
    const data = new Uint8ClampedArray(12 * 9 * 4)
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 12; x++) {
        const inside = x >= 3 && x < 9 && y >= 2 && y < 7
        const edge = inside && (x === 3 || x === 8 || y === 2 || y === 6)
        data.set(inside ? (edge ? [120, 120, 140, 255] : [20, 20, 60, 255]) : [240, 240, 240, 255], (y * 12 + x) * 4)
      }
    }
    const pixels = createPixelBuffer(12, 9, data)
    const rows = Array.from({ length: 9 }, (_, y) => Array.from({ length: 12 }, (_, x) => (x >= 3 && x < 9 && y >= 2 && y < 7 ? '.' : '#')).join(''))
    return { pixels, selection: mask(...rows) }
  }
  const patchFor = (pixels: PixelBuffer, selection: SelectionMask, cleanup: number, feather: number) => {
    const result = deleteSelectionWithEdges(pixels, selection, { cleanup, feather })!
    return createPixelPatch(pixels, result.pixels, result.bounds)!
  }

  it('record the edge amounts a Delete was made with, as a copy', () => {
    const { pixels, selection } = scene()
    const settings = { cleanup: 2, feather: 1 }
    const entry = createHistoryEntry({ kind: 'delete-selection', patch: patchFor(pixels, selection, 2, 1), selectionBefore: selection, magicWandBefore: null, selectionAfter: null, edgeSettings: settings })
    expect(entry.edgeSettings).toEqual(settings)
    expect(entry.edgeSettings).not.toBe(settings)
    // Other edits record none.
    const plain = createHistoryEntry({ kind: 'delete-selection', patch: patchFor(pixels, selection, 0, 0), selectionBefore: selection, magicWandBefore: null, selectionAfter: null })
    expect('edgeSettings' in plain).toBe(false)
  })

  it('keep the same encoded selections and click, with the new patch, amounts and retained bytes', () => {
    const { pixels, selection } = scene()
    const base = mask(...Array.from({ length: 9 }, () => '#...........'))
    const entry = createHistoryEntry({ kind: 'delete-selection', patch: patchFor(pixels, selection, 0, 0), selectionBefore: selection, magicWandBefore: click(base), selectionAfter: null, edgeSettings: { cleanup: 0, feather: 0 } })
    const patch = patchFor(pixels, selection, 3, 2)
    const remade = remadeHistoryEntry(entry, patch, { cleanup: 3, feather: 2 })
    expect(remade.kind).toBe('delete-selection')
    expect(remade.patch).toBe(patch)
    expect(remade.selectionBefore).toBe(entry.selectionBefore)
    expect(remade.magicWandBefore).toBe(entry.magicWandBefore)
    expect(remade.selectionAfter).toBeNull()
    expect(remade.edgeSettings).toEqual({ cleanup: 3, feather: 2 })
    expect(remade.retainedBytes).toBe(retainedBytes(entryPayloads(remade)))
    expect(remade.retainedBytes).not.toBe(entry.retainedBytes)
    // The selection and click come back exactly as from the original entry.
    const restored = restoreSelectionBefore(remade)
    expect(sameSelection(restored.selection, selection)).toBe(true)
    expect(sameSelection(restored.magicWand!.base, base)).toBe(true)
    // The original entry is untouched.
    expect(entry.edgeSettings).toEqual({ cleanup: 0, feather: 0 })
    expect(entry.patch).not.toBe(patch)
  })

  it('refuse a patch for another image size, and crops', () => {
    const { pixels, selection } = scene()
    const entry = createHistoryEntry({ kind: 'delete-selection', patch: patchFor(pixels, selection, 0, 0), selectionBefore: selection, magicWandBefore: null, selectionAfter: null, edgeSettings: { cleanup: 0, feather: 0 } })
    const other = deletePatch(image, corner())
    expect(() => remadeHistoryEntry(entry, other, { cleanup: 1, feather: 0 })).toThrow(RangeError)
    const crop = createHistoryEntry({ kind: 'auto-trim', patch: createCropPatch(pixels, { x: 1, y: 1, width: 4, height: 4 })!, selectionBefore: null, magicWandBefore: null, selectionAfter: null })
    expect(() => remadeHistoryEntry(crop, patchFor(pixels, selection, 1, 0), { cleanup: 1, feather: 0 })).toThrow(RangeError)
  })
})
