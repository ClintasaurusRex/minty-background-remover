import type { DocumentVersion } from '../types'
import { retainedBytes } from './historyBytes'
import { type HistoryEntry, entryPayloads } from './historyEntry'

/*
 * The Undo / Redo history of the open document: two stacks of entries (historyEntry.ts), bound
 * to the document version they apply to, within the approved limits (P3-D8).
 *
 * Binding: `version` is the content state the stacks belong to. The top Undo entry turns exactly
 * those pixels back into the previous state, and the top Redo entry turns them forward. Every
 * accepted edit, Undo and Redo makes a new revision and rebinds the history to it in the same
 * reducer step, so the binding always names the open document's version. Revisions are never
 * reused, so no other content state, of this image or another, ever has that version: an entry
 * can only be applied to the pixels it was made for, which a patch alone (with only a size)
 * could not ensure. A history bound to any other version than the open document's is unusable;
 * nothing in it is offered for Undo or Redo.
 *
 * Limits: at most `maxEntries` entries and `maxBytes` of retained memory over both stacks. A new
 * edit clears Redo, so only recording an edit, or replacing the latest one (replaceLatestEdit),
 * can exceed them; Undo and Redo move entries between the stacks without changing what is kept. The oldest entries go first, and the newest entry is
 * always kept, even when it alone exceeds the budget, so the last edit can always be undone.
 *
 * Pure and cheap: no pixel work and no typed-array contents are read (memory accounting reads only
 * buffer sizes, over at most maxEntries + 1 entries), so these run inside the editor reducer.
 * Histories are never modified; every change returns a new one.
 */

export interface HistoryLimits {
  /** At least 1. */
  readonly maxEntries: number
  /** Retained bytes allowed over both stacks; at least 0. The newest entry is kept regardless. */
  readonly maxBytes: number
}

/** 25 entries and 256 MB (MiB, 2^20 bytes, as elsewhere in the documentation): P3-D8. */
export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { maxEntries: 25, maxBytes: 256 * 1024 * 1024 }

export interface EditHistory {
  readonly limits: HistoryLimits
  /** The document version both stacks apply to. Null when there are no entries. */
  readonly version: DocumentVersion | null
  /** Entries that can be undone, oldest first: the last is undone next. */
  readonly undo: readonly HistoryEntry[]
  /** Entries that can be redone: the last (the most recently undone) is redone next. */
  readonly redo: readonly HistoryEntry[]
  /** retainedBytes over every entry's payloads, a payload or buffer shared by entries counted once. */
  readonly retainedBytes: number
}

/** An empty history with `limits`. Throws a RangeError for limits that are not whole numbers in range. */
export function createEditHistory(limits: HistoryLimits = DEFAULT_HISTORY_LIMITS): EditHistory {
  const { maxEntries, maxBytes } = limits
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError(`Invalid history limits: ${maxEntries} entries, ${maxBytes} bytes`)
  }
  return { limits: { maxEntries, maxBytes }, version: null, undo: [], redo: [], retainedBytes: 0 }
}

/** `history` without entries and with the same limits (`history` itself when it has none). */
export function clearEditHistory(history: EditHistory): EditHistory {
  if (history.undo.length === 0 && history.redo.length === 0 && history.version === null) return history
  return { limits: history.limits, version: null, undo: [], redo: [], retainedBytes: 0 }
}

/** Whether `history`'s entries apply to `version`. */
export function isBoundTo(history: EditHistory, version: DocumentVersion | null): boolean {
  const bound = history.version
  return bound !== null && version !== null && bound.documentId === version.documentId && bound.revision === version.revision
}

/** The entry Undo would apply to the document at `version`, or null (none, or bound to another version). */
export function nextUndo(history: EditHistory, version: DocumentVersion | null): HistoryEntry | null {
  return isBoundTo(history, version) ? (history.undo.at(-1) ?? null) : null
}

/** The entry Redo would apply to the document at `version`, or null (none, or bound to another version). */
export function nextRedo(history: EditHistory, version: DocumentVersion | null): HistoryEntry | null {
  return isBoundTo(history, version) ? (history.redo.at(-1) ?? null) : null
}

/**
 * `history` after an edit turned the document at `from` into the one at `to`: Redo cleared,
 * `entry` added as the next Undo, the oldest entries dropped until the limits hold (never
 * `entry`), bound to `to`. Entries bound to any other version than `from` cannot apply to the
 * edited image and are dropped as well.
 */
export function recordEdit(
  history: EditHistory,
  from: DocumentVersion,
  entry: HistoryEntry,
  to: DocumentVersion,
): EditHistory {
  const { maxEntries, maxBytes } = history.limits
  const kept = isBoundTo(history, from) ? history.undo : []
  let undo = [...kept, entry]
  if (undo.length > maxEntries) undo = undo.slice(undo.length - maxEntries)
  let bytes = historyRetainedBytes(undo)
  // Payloads can be shared between entries, so the total is counted again after each drop.
  while (bytes > maxBytes && undo.length > 1) {
    undo = undo.slice(1)
    bytes = historyRetainedBytes(undo)
  }
  return { limits: history.limits, version: copyVersion(to), undo, redo: [], retainedBytes: bytes }
}

/**
 * `history` after the latest edit, `entry`, was made again differently (Phase 3 Step 9: the last
 * Delete with other edge amounts), turning the document at `from` into the one at `to`: `entry`
 * replaced by `replacement` in place, so the number of entries stays the same and one Undo still
 * goes back to the image before the edit. The oldest entries are dropped while the retained bytes
 * exceed the limit (never `replacement`), as when recording an edit. Bound to `to`.
 *
 * Null, changing nothing, unless `entry` is the next Undo for `from` and nothing can be redone: a
 * Redo entry was made from `entry`'s result and could not apply to another one.
 */
export function replaceLatestEdit(
  history: EditHistory,
  from: DocumentVersion,
  entry: HistoryEntry,
  replacement: HistoryEntry,
  to: DocumentVersion,
): EditHistory | null {
  if (nextUndo(history, from) !== entry || history.redo.length > 0) return null
  let undo = [...history.undo.slice(0, -1), replacement]
  let bytes = historyRetainedBytes(undo)
  while (bytes > history.limits.maxBytes && undo.length > 1) {
    undo = undo.slice(1)
    bytes = historyRetainedBytes(undo)
  }
  return { limits: history.limits, version: copyVersion(to), undo, redo: [], retainedBytes: bytes }
}

/**
 * `history` after Undo of `entry` turned the document at `from` into the one at `to`: `entry`
 * moved to the Redo stack and the history bound to `to`. Null, changing nothing, unless `entry`
 * is the next Undo for `from`.
 */
export function recordUndo(
  history: EditHistory,
  from: DocumentVersion,
  entry: HistoryEntry,
  to: DocumentVersion,
): EditHistory | null {
  if (nextUndo(history, from) !== entry) return null
  return { ...history, version: copyVersion(to), undo: history.undo.slice(0, -1), redo: [...history.redo, entry] }
}

/**
 * `history` after Redo of `entry` turned the document at `from` into the one at `to`: `entry`
 * moved back to the Undo stack and the history bound to `to`. Null, changing nothing, unless
 * `entry` is the next Redo for `from`.
 */
export function recordRedo(
  history: EditHistory,
  from: DocumentVersion,
  entry: HistoryEntry,
  to: DocumentVersion,
): EditHistory | null {
  if (nextRedo(history, from) !== entry) return null
  return { ...history, version: copyVersion(to), undo: [...history.undo, entry], redo: history.redo.slice(0, -1) }
}

/** Bytes retained by `entries` together, anything shared between them counted once. */
export function historyRetainedBytes(entries: Iterable<HistoryEntry>): number {
  const payloads = []
  for (const entry of entries) payloads.push(...entryPayloads(entry))
  return retainedBytes(payloads)
}

function copyVersion(version: DocumentVersion): DocumentVersion {
  return { documentId: version.documentId, revision: version.revision }
}
