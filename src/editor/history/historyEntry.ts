import type { EdgeSettings } from '../../image/edit/deleteWithEdges'
import type { FloodMode, PixelCoordinate, SelectionMask, SelectionMode, Size } from '../types'
import type { CropPatch } from './cropPatch'
import { type HistoryPayload, retainedBytes } from './historyBytes'
import type { PixelPatch } from './pixelPatch'
import { type EncodedSelection, decodeSelection, encodeSelection } from './selectionCodec'

/*
 * Undo / Redo history entries: one image edit, as compact patches and encoded selections
 * (Phase 3 Step 3 building blocks), so that Undo can restore the pixels, the selection and the
 * Magic Wand click from before the edit, and Redo the pixels and selection after it.
 *
 * An entry holds no pixel buffer, document, revision, display image or selection mask: only the
 * patch and encoded copies. It does not say which document version it applies to; the edit
 * history (editHistory.ts) is bound to the version its top entries apply to, and the editor
 * reducer checks that binding before anything is applied.
 *
 * Creating an entry encodes selections (pixel work), and restoring one decodes them, so both run
 * in commands (historyCommands.ts), never in the reducer. Entries are never modified.
 */

/** The image edits that make history entries (FEATURE_SPEC.md §21). */
export type EditKind = 'delete-selection' | 'auto-trim'

/**
 * A Magic Wand click without the document version it was made on (MagicWandOperation in
 * editorState.ts has this shape plus `version`). History keeps it without a version; restoring
 * it binds it to the restored document's new version.
 */
export interface MagicWandClick {
  readonly seed: PixelCoordinate
  readonly floodMode: FloodMode
  readonly selectionMode: SelectionMode
  /** The selection before the click, or null (always for New). */
  readonly base: SelectionMask | null
  readonly tolerance: number
}

/** A Magic Wand click as history keeps it: its `base` encoded. */
export interface RecordedMagicWandClick {
  readonly seed: PixelCoordinate
  readonly floodMode: FloodMode
  readonly selectionMode: SelectionMode
  /**
   * The encoded selection before the click, or null. When the click's base was the selection
   * itself (an Add that added nothing), this is the same object as the entry's
   * `selectionBefore`, stored and counted once.
   */
  readonly base: EncodedSelection | null
  readonly tolerance: number
}

export interface HistoryEntry {
  readonly kind: EditKind
  /**
   * The change: a pixel patch for edits that keep the image's size (applied to either state it
   * gives the other), or a crop patch for edits that make it smaller.
   */
  readonly patch: PixelPatch | CropPatch
  /** The selection just before the edit, restored by Undo. Null for no selection. */
  readonly selectionBefore: EncodedSelection | null
  /**
   * The Magic Wand click that could be re-applied just before the edit, restored by Undo, or
   * null. Whenever it is set, `selectionBefore` is exactly its result at its tolerance.
   */
  readonly magicWandBefore: RecordedMagicWandClick | null
  /**
   * The selection just after the edit, restored by Redo (null for Delete, which clears it).
   * No Magic Wand click can be re-applied after an edit: its pixels have changed. The same
   * object as `selectionBefore` when the edit kept the selection.
   */
  readonly selectionAfter: EncodedSelection | null
  /**
   * For Delete Selection: the edge cleanup and feather amounts its result was made with. With the
   * patch (which gives back the pixels before the Delete) and `selectionBefore` (the selection it
   * deleted), they are everything needed to make the same Delete again with other amounts (Phase 3
   * Step 9). Absent for other edits.
   */
  readonly edgeSettings?: EdgeSettings
  /** Bytes this entry retains on its own (retainedBytes over its payloads). */
  readonly retainedBytes: number
}

export interface HistoryEntryInput {
  readonly kind: EditKind
  readonly patch: PixelPatch | CropPatch
  /** The selection the edit started from (the editor state's mask). */
  readonly selectionBefore: SelectionMask | null
  /** The Magic Wand click recorded when the edit started, if any. */
  readonly magicWandBefore: MagicWandClick | null
  /** The selection the edit leaves, the size of the edited image. */
  readonly selectionAfter: SelectionMask | null
  /** For Delete Selection, the edge amounts it was made with (copied). */
  readonly edgeSettings?: EdgeSettings
}

/**
 * A history entry for an edit, with every selection encoded (selectionCodec.ts). A mask used in
 * more than one place (the selection kept by the edit, or the Magic Wand click's base when it
 * is the selection itself) is encoded once and shared.
 *
 * The masks are not written and nothing of them is kept but the encoded copies. Throws a
 * RangeError when a selection is not the size of the image it belongs to: the image before the
 * patch for `selectionBefore` and the click's base, after it for `selectionAfter`.
 */
export function createHistoryEntry(input: HistoryEntryInput): HistoryEntry {
  const { kind, patch, selectionBefore, magicWandBefore, selectionAfter } = input
  const before = sizeBefore(patch)
  const after = sizeAfter(patch)
  checkSize(selectionBefore, before, 'The selection before the edit')
  checkSize(magicWandBefore?.base ?? null, before, "The Magic Wand click's previous selection")
  checkSize(selectionAfter, after, 'The selection after the edit')

  const encodings = new Map<SelectionMask, EncodedSelection | null>()
  const encode = (mask: SelectionMask | null): EncodedSelection | null => {
    if (!mask) return null
    let encoded = encodings.get(mask)
    if (encoded === undefined) {
      encoded = encodeSelection(mask)
      encodings.set(mask, encoded)
    }
    return encoded
  }

  const encodedBefore = encode(selectionBefore)
  const recordedClick: RecordedMagicWandClick | null = magicWandBefore && {
    seed: { x: magicWandBefore.seed.x, y: magicWandBefore.seed.y },
    floodMode: magicWandBefore.floodMode,
    selectionMode: magicWandBefore.selectionMode,
    base: encode(magicWandBefore.base),
    tolerance: magicWandBefore.tolerance,
  }
  // A mask of one size cannot be the selection after a crop, so sharing never crosses sizes.
  const encodedAfter = encode(selectionAfter)
  const entry = {
    kind,
    patch,
    selectionBefore: encodedBefore,
    magicWandBefore: recordedClick,
    selectionAfter: encodedAfter,
    ...(input.edgeSettings ? { edgeSettings: copyEdgeSettings(input.edgeSettings) } : {}),
  }
  return { ...entry, retainedBytes: retainedBytes(entryPayloads(entry)) }
}

/**
 * `entry` made again with another result (Phase 3 Step 9, re-applying the last Delete with other
 * edge amounts): the same kind, the same encoded selections and Magic Wand click (shared, never
 * encoded again, so they cannot drift however often the edit is re-made), with `patch` and
 * `edgeSettings` in place of its own, and its retained bytes counted again.
 *
 * `patch` must be a pixel patch between the same image before the edit and a result of the same
 * size: the edit it describes started from the same pixels and selection. Throws a RangeError
 * otherwise. `entry` is not changed.
 */
export function remadeHistoryEntry(entry: HistoryEntry, patch: PixelPatch, edgeSettings: EdgeSettings): HistoryEntry {
  if (entry.patch.kind !== 'pixel-patch' || patch.kind !== 'pixel-patch') {
    throw new RangeError('Only an edit recorded as a pixel patch can be made again with another pixel patch')
  }
  const before = sizeBefore(entry.patch)
  if (patch.width !== before.width || patch.height !== before.height) {
    throw new RangeError(`The new patch is for a ${patch.width} × ${patch.height} image; the edit is on a ${before.width} × ${before.height} one`)
  }
  const remade = {
    kind: entry.kind,
    patch,
    selectionBefore: entry.selectionBefore,
    magicWandBefore: entry.magicWandBefore,
    selectionAfter: entry.selectionAfter,
    edgeSettings: copyEdgeSettings(edgeSettings),
  }
  return { ...remade, retainedBytes: retainedBytes(entryPayloads(remade)) }
}

function copyEdgeSettings(settings: EdgeSettings): EdgeSettings {
  return { cleanup: settings.cleanup, feather: settings.feather }
}

/** Everything an entry keeps that holds typed-array memory, for retainedBytes. */
export function entryPayloads(
  entry: Pick<HistoryEntry, 'patch' | 'selectionBefore' | 'magicWandBefore' | 'selectionAfter'>,
): (HistoryPayload | null)[] {
  return [entry.patch, entry.selectionBefore, entry.magicWandBefore?.base ?? null, entry.selectionAfter]
}

/** What Undo restores besides the pixels: the selection and Magic Wand click from before the edit. */
export interface RestoredSelectionBefore {
  readonly selection: SelectionMask | null
  /** The click without a document version; the caller binds it to the restored document's. */
  readonly magicWand: MagicWandClick | null
}

/**
 * The selection and Magic Wand click from before the edit, decoded into new masks the caller
 * owns. When the click's base was recorded as the selection itself, both are the same mask, as
 * they were when the edit was made.
 *
 * Throws a RangeError for malformed data (decodeSelection).
 */
export function restoreSelectionBefore(entry: HistoryEntry): RestoredSelectionBefore {
  const selection = decodeSelection(entry.selectionBefore)
  const click = entry.magicWandBefore
  if (!click) return { selection, magicWand: null }
  const base = click.base === entry.selectionBefore ? selection : decodeSelection(click.base)
  return {
    selection,
    magicWand: {
      seed: { x: click.seed.x, y: click.seed.y },
      floodMode: click.floodMode,
      selectionMode: click.selectionMode,
      base,
      tolerance: click.tolerance,
    },
  }
}

/** The selection just after the edit, decoded into a new mask the caller owns (or null). */
export function restoreSelectionAfter(entry: HistoryEntry): SelectionMask | null {
  return decodeSelection(entry.selectionAfter)
}

/** Size of the image before the edit: the image Undo produces. */
export function sizeBefore(patch: PixelPatch | CropPatch): Size {
  return { width: patch.width, height: patch.height }
}

/** Size of the image after the edit: the image Redo produces. */
export function sizeAfter(patch: PixelPatch | CropPatch): Size {
  return patch.kind === 'crop-patch'
    ? { width: patch.kept.width, height: patch.kept.height }
    : { width: patch.width, height: patch.height }
}

function checkSize(mask: SelectionMask | null, size: Size, what: string): void {
  if (mask && (mask.width !== size.width || mask.height !== size.height)) {
    throw new RangeError(`${what} is ${mask.width} × ${mask.height}; the image is ${size.width} × ${size.height}`)
  }
}
