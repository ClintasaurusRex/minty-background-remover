import type { CropPatch } from './cropPatch'
import type { PixelPatch } from './pixelPatch'
import type { EncodedSelection } from './selectionCodec'

/*
 * Memory accounting for Undo / Redo history, for the 25-entry / 256 MB limits (P3-D8). The
 * limits themselves are enforced by the history (Phase 3 Step 5).
 *
 * What a payload retains is the typed-array memory it keeps alive plus its objects. Typed
 * arrays are counted by their whole ArrayBuffer, since a view keeps all of it alive. A buffer
 * or payload referenced more than once, within one entry or across entries, is counted once.
 */

/** Anything history keeps that holds typed-array memory. */
export type HistoryPayload = PixelPatch | CropPatch | EncodedSelection

/**
 * Estimated size of a payload's objects (the payload, its rectangle and its run object),
 * rounded up. Small next to typed-array memory; it keeps tiny entries from counting as free.
 */
export const PAYLOAD_OVERHEAD_BYTES = 256
/** Estimated size of the objects behind one typed array (view, ArrayBuffer, backing store record), rounded up. */
export const ARRAY_OVERHEAD_BYTES = 256

/**
 * Bytes retained by `payloads` together: every distinct ArrayBuffer's full size plus
 * ARRAY_OVERHEAD_BYTES, and PAYLOAD_OVERHEAD_BYTES per distinct payload. Nulls (no selection)
 * cost nothing. Linear in the number of payloads; reads no typed-array contents.
 */
export function retainedBytes(payloads: Iterable<HistoryPayload | null>): number {
  const seenPayloads = new Set<HistoryPayload>()
  const seenBuffers = new Set<ArrayBufferLike>()
  let total = 0
  for (const payload of payloads) {
    if (!payload || seenPayloads.has(payload)) continue
    seenPayloads.add(payload)
    total += PAYLOAD_OVERHEAD_BYTES
    for (const array of arraysOf(payload)) {
      if (seenBuffers.has(array.buffer)) continue
      seenBuffers.add(array.buffer)
      total += array.buffer.byteLength + ARRAY_OVERHEAD_BYTES
    }
  }
  return total
}

function arraysOf(payload: HistoryPayload): readonly ArrayBufferView[] {
  switch (payload.kind) {
    case 'pixel-patch':
      return [payload.changes.tokens, payload.changes.literals]
    case 'crop-patch':
      return [payload.removed.tokens, payload.removed.literals]
    case 'selection':
      return [payload.data]
  }
}
