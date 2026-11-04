import { describe, expect, it } from 'vitest'
import type { DocumentVersion } from '../types'
import {
  DEFAULT_HISTORY_LIMITS,
  type EditHistory,
  clearEditHistory,
  createEditHistory,
  historyRetainedBytes,
  isBoundTo,
  nextRedo,
  nextUndo,
  recordEdit,
  recordRedo,
  recordUndo,
} from './editHistory'
import { ARRAY_OVERHEAD_BYTES, PAYLOAD_OVERHEAD_BYTES, retainedBytes } from './historyBytes'
import { type HistoryEntry, createHistoryEntry } from './historyEntry'
import type { PixelPatch } from './pixelPatch'
import { encodeSelection } from './selectionCodec'
import { mask } from './testFixtures'

const MiB = 1024 * 1024

/**
 * An entry whose patch retains about `bytes` (a typed array of that size; never decoded here).
 * Buffers are allocated but never written, so even 191 MB entries cost almost no real memory.
 */
function entryOf(bytes: number, width = 4, height = 3): HistoryEntry {
  const patch: PixelPatch = {
    kind: 'pixel-patch',
    width,
    height,
    region: { x: 0, y: 0, width, height },
    changedPixels: 1,
    changes: { length: width * height, tokens: new Uint32Array(1), literals: new Uint8Array(bytes), alphaOnly: false },
  }
  return createHistoryEntry({ kind: 'delete-selection', patch, selectionBefore: null, magicWandBefore: null, selectionAfter: null })
}

/** What an entryOf(bytes) retains: the payload, its token array and its literal array. */
const entryBytes = (bytes: number) => PAYLOAD_OVERHEAD_BYTES + 2 * ARRAY_OVERHEAD_BYTES + 4 + bytes

/** The same entries, by identity, in order (deep equality would compare large typed arrays byte by byte). */
function expectEntries(actual: readonly HistoryEntry[], expected: readonly HistoryEntry[]) {
  expect(actual.length).toBe(expected.length)
  actual.forEach((entry, i) => expect(entry).toBe(expected[i]))
}

const v = (revision: number, documentId = 1): DocumentVersion => ({ documentId, revision })

/** Records `entries` as successive edits from revision `start`; the history ends bound to start + entries.length. */
function recordAll(history: EditHistory, entries: readonly HistoryEntry[], start = 0): EditHistory {
  return entries.reduce((h, entry, i) => recordEdit(h, v(start + i), entry, v(start + i + 1)), history)
}

describe('edit history', () => {
  it('starts empty, unbound, with the approved limits', () => {
    const history = createEditHistory()
    expect(history).toEqual({
      limits: { maxEntries: 25, maxBytes: 256 * MiB },
      version: null,
      undo: [],
      redo: [],
      retainedBytes: 0,
    })
    expect(DEFAULT_HISTORY_LIMITS).toEqual({ maxEntries: 25, maxBytes: 268_435_456 })
    expect(nextUndo(history, v(0))).toBeNull()
    expect(nextRedo(history, v(0))).toBeNull()
    expect(isBoundTo(history, v(0))).toBe(false)
  })

  it('rejects limits that are not whole numbers in range', () => {
    for (const limits of [
      { maxEntries: 0, maxBytes: 10 },
      { maxEntries: 1.5, maxBytes: 10 },
      { maxEntries: Number.NaN, maxBytes: 10 },
      { maxEntries: 3, maxBytes: -1 },
      { maxEntries: 3, maxBytes: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => createEditHistory(limits)).toThrow(RangeError)
    }
    expect(createEditHistory({ maxEntries: 1, maxBytes: 0 }).limits).toEqual({ maxEntries: 1, maxBytes: 0 })
  })

  it('records an edit as the next Undo, bound to the edited version', () => {
    const entry = entryOf(100)
    const history = recordEdit(createEditHistory(), v(0), entry, v(7))
    expectEntries(history.undo, [entry])
    expect(history.undo[0]).toBe(entry)
    expectEntries(history.redo, [])
    expect(history.version).toEqual(v(7))
    expect(history.retainedBytes).toBe(entryBytes(100))
    expect(nextUndo(history, v(7))).toBe(entry)
    expect(nextUndo(history, v(0))).toBeNull()
    expect(nextRedo(history, v(7))).toBeNull()
  })

  it('offers nothing for another revision or another document', () => {
    const history = recordAll(createEditHistory(), [entryOf(1), entryOf(2)])
    expect(nextUndo(history, v(2))).toBe(history.undo[1])
    for (const version of [v(1), v(3), v(2, 2), null]) {
      expect(nextUndo(history, version)).toBeNull()
      expect(isBoundTo(history, version)).toBe(false)
    }
  })

  it('undoes and redoes in stack order, moving entries without copying them', () => {
    const [a, b, c] = [entryOf(1), entryOf(2), entryOf(3)]
    const recorded = recordAll(createEditHistory(), [a, b, c])
    expectEntries(recorded.undo, [a, b, c])

    const undoneC = recordUndo(recorded, v(3), c, v(10))!
    expectEntries(undoneC.undo, [a, b])
    expectEntries(undoneC.redo, [c])
    expect(undoneC.version).toEqual(v(10))
    const undoneB = recordUndo(undoneC, v(10), b, v(11))!
    expectEntries(undoneB.undo, [a])
    expectEntries(undoneB.redo, [c, b])
    expect(nextRedo(undoneB, v(11))).toBe(b)

    const redoneB = recordRedo(undoneB, v(11), b, v(12))!
    expectEntries(redoneB.undo, [a, b])
    expectEntries(redoneB.redo, [c])
    const redoneC = recordRedo(redoneB, v(12), c, v(13))!
    expectEntries(redoneC.undo, [a, b, c])
    expectEntries(redoneC.redo, [])
    for (const h of [undoneC, undoneB, redoneB, redoneC]) expect(h.retainedBytes).toBe(recorded.retainedBytes)
  })

  it('refuses Undo and Redo of anything but the next entry for the bound version', () => {
    const [a, b] = [entryOf(1), entryOf(2)]
    const history = recordAll(createEditHistory(), [a, b])
    expect(recordUndo(history, v(2), a, v(9))).toBeNull()
    expect(recordUndo(history, v(1), b, v(9))).toBeNull()
    expect(recordUndo(history, v(2, 5), b, v(9, 5))).toBeNull()
    expect(recordRedo(history, v(2), b, v(9))).toBeNull()
    const undone = recordUndo(history, v(2), b, v(9))!
    expect(recordRedo(undone, v(2), b, v(10))).toBeNull()
    expect(recordRedo(undone, v(9), a, v(10))).toBeNull()
    expect(recordUndo(undone, v(9), b, v(10))).toBeNull()
    expect(recordUndo(createEditHistory(), v(0), a, v(1))).toBeNull()
  })

  it('clears Redo when a new edit is recorded', () => {
    const [a, b, c] = [entryOf(1), entryOf(2), entryOf(3)]
    const undone = recordUndo(recordAll(createEditHistory(), [a, b]), v(2), b, v(3))!
    expectEntries(undone.redo, [b])
    const history = recordEdit(undone, v(3), c, v(4))
    expectEntries(history.undo, [a, c])
    expectEntries(history.redo, [])
    expect(history.retainedBytes).toBe(historyRetainedBytes([a, c]))
  })

  it('drops entries bound to another version than the one edited', () => {
    const history = recordAll(createEditHistory(), [entryOf(1), entryOf(2)])
    const entry = entryOf(3)
    const rebound = recordEdit(history, v(99), entry, v(100))
    expectEntries(rebound.undo, [entry])
    expectEntries(rebound.redo, [])
    expect(rebound.version).toEqual(v(100))
  })

  it('keeps at most 25 entries, dropping the oldest first', () => {
    const entries = Array.from({ length: 30 }, () => entryOf(10))
    let history = createEditHistory()
    entries.forEach((entry, i) => {
      history = recordEdit(history, v(i), entry, v(i + 1))
      expect(history.undo.length).toBe(Math.min(i + 1, 25))
      expect(history.undo.at(-1)).toBe(entry)
    })
    expectEntries(history.undo, entries.slice(5))
    expect(history.retainedBytes).toBe(25 * entryBytes(10))
  })

  it('counts Redo entries towards the limit only until a new edit clears them', () => {
    const limits = { maxEntries: 3, maxBytes: 1_000_000 }
    const [a, b, c, d] = [entryOf(1), entryOf(2), entryOf(3), entryOf(4)]
    let history = recordAll(createEditHistory(limits), [a, b, c])
    history = recordUndo(history, v(3), c, v(4))!
    history = recordUndo(history, v(4), b, v(5))!
    expect(history.undo.length + history.redo.length).toBe(3)
    history = recordEdit(history, v(5), d, v(6))
    expectEntries(history.undo, [a, d])
    expectEntries(history.redo, [])
  })

  it('drops the oldest entries until the retained memory fits the budget', () => {
    const limits = { maxEntries: 25, maxBytes: 3 * entryBytes(1000) }
    const entries = Array.from({ length: 6 }, () => entryOf(1000))
    const history = recordAll(createEditHistory(limits), entries)
    expectEntries(history.undo, entries.slice(3))
    expect(history.retainedBytes).toBe(3 * entryBytes(1000))

    // One byte less and only two fit.
    const tighter = recordAll(createEditHistory({ ...limits, maxBytes: limits.maxBytes - 1 }), entries)
    expectEntries(tighter.undo, entries.slice(4))
  })

  it('drops older entries to make room for a large new one', () => {
    // Room for the large entry and exactly two small ones.
    const limits = { maxEntries: 25, maxBytes: entryBytes(6000) + 2 * entryBytes(1000) }
    const small = Array.from({ length: 5 }, () => entryOf(1000))
    expect(recordAll(createEditHistory(limits), small).undo.length).toBe(5)
    const large = entryOf(6000)
    const history = recordEdit(recordAll(createEditHistory(limits), small), v(5), large, v(6))
    expectEntries(history.undo, [...small.slice(3), large])
    expect(history.retainedBytes).toBe(limits.maxBytes)
  })

  it('always keeps the newest entry, even when it alone exceeds the budget', () => {
    const limits = { maxEntries: 25, maxBytes: 5000 }
    const older = [entryOf(100), entryOf(100)]
    const huge = entryOf(50_000)
    const history = recordEdit(recordAll(createEditHistory(limits), older), v(2), huge, v(3))
    expectEntries(history.undo, [huge])
    expect(history.retainedBytes).toBe(entryBytes(50_000))
    expect(nextUndo(history, v(3))).toBe(huge)

    // The next edit, small again, drops it.
    const next = entryOf(100)
    expectEntries(recordEdit(history, v(3), next, v(4)).undo, [next])
    // With a budget of 0, every edit keeps exactly itself.
    expectEntries(recordAll(createEditHistory({ maxEntries: 25, maxBytes: 0 }), older).undo, [older[1]])
  })

  it('counts payloads and buffers shared by entries once', () => {
    const selection = encodeSelection(mask('##..', '#...', '....'))
    const shared = entryOf(500)
    // A second entry sharing the first one's patch and an encoded selection.
    const twin: HistoryEntry = { ...shared, selectionBefore: selection, selectionAfter: selection }
    const history = recordAll(createEditHistory(), [shared, twin])
    expect(history.retainedBytes).toBe(retainedBytes([shared.patch, selection]))
    expect(history.retainedBytes).toBeLessThan(shared.retainedBytes + twin.retainedBytes)
    expect(historyRetainedBytes([shared, shared])).toBe(shared.retainedBytes)
  })

  it('accounts for 50-megapixel worst-case entries within the 256 MB budget', () => {
    // An edit changing every pixel of an 8660 × 5773 image differently: 4 bytes per pixel
    // (IMPLEMENTATION_PLAN.md, Phase 3 Step 3), about 190.7 MB.
    const worst = 8660 * 5773 * 4
    const typical = 35 * 1024
    const a = entryOf(typical, 8660, 5773)
    const b = entryOf(worst, 8660, 5773)
    const c = entryOf(typical, 8660, 5773)
    const d = entryOf(worst, 8660, 5773)
    let history = recordAll(createEditHistory(), [a, b, c])
    expectEntries(history.undo, [a, b, c])
    expect(history.retainedBytes).toBe(2 * entryBytes(typical) + entryBytes(worst))
    expect(history.retainedBytes).toBeLessThan(256 * MiB)

    // A second worst case does not fit next to the first: the oldest go until it does.
    history = recordEdit(history, v(3), d, v(4))
    expectEntries(history.undo, [c, d])
    expect(history.retainedBytes).toBe(entryBytes(typical) + entryBytes(worst))

    // A single entry beyond the budget (a 300 MB patch) is kept on its own.
    const over = entryOf(300 * MiB, 8660, 5773)
    history = recordEdit(history, v(4), over, v(5))
    expectEntries(history.undo, [over])
    expect(history.retainedBytes).toBeGreaterThan(256 * MiB)
  })

  it('clears to an empty history with the same limits', () => {
    const limits = { maxEntries: 4, maxBytes: 99_999 }
    const recorded = recordAll(createEditHistory(limits), [entryOf(1), entryOf(2)])
    // Something on both stacks.
    const full = recordUndo(recorded, v(2), recorded.undo[1], v(3))!
    expect(full.undo.length + full.redo.length).toBe(2)
    const cleared = clearEditHistory(full)
    expect(cleared).toEqual({ limits, version: null, undo: [], redo: [], retainedBytes: 0 })
    expect(cleared.limits).toBe(full.limits)
    expect(clearEditHistory(cleared)).toBe(cleared)
  })

  it('never modifies a history, its stacks or its version', () => {
    const [a, b, c] = [entryOf(1), entryOf(2), entryOf(3)]
    const history = recordAll(createEditHistory({ maxEntries: 2, maxBytes: 1_000_000 }), [a, b])
    const snapshot = { ...history, undo: [...history.undo], redo: [...history.redo], version: { ...history.version! } }
    Object.freeze(history.undo)
    Object.freeze(history.redo)
    Object.freeze(history.version)
    Object.freeze(history)
    recordEdit(history, v(2), c, v(3))
    const undone = recordUndo(history, v(2), b, v(3))!
    recordRedo(undone, v(3), b, v(4))
    clearEditHistory(history)
    expect(history).toEqual(snapshot)
  })
})
