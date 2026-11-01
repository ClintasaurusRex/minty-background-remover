import { describe, expect, it } from 'vitest'
import { createPixelBuffer } from '../../image/pixelBuffer'
import { createSelectionMask } from '../../image/selection/selectionMask'
import { createCropPatch } from './cropPatch'
import { ARRAY_OVERHEAD_BYTES, PAYLOAD_OVERHEAD_BYTES, retainedBytes } from './historyBytes'
import { type PixelPatch, createPixelPatch } from './pixelPatch'
import { encodeSelection } from './selectionCodec'

function noise(width: number, height: number, seed: number) {
  let state = seed
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    data[i] = state >>> 24
  }
  return createPixelBuffer(width, height, data)
}

const pixelPatch = (seed: number) => createPixelPatch(noise(20, 10, seed), noise(20, 10, seed + 1))!

/** What a payload's own arrays and objects cost, counted by hand. */
function expectedPixelPatchBytes(patch: PixelPatch): number {
  return PAYLOAD_OVERHEAD_BYTES + patch.changes.tokens.buffer.byteLength + patch.changes.literals.buffer.byteLength + 2 * ARRAY_OVERHEAD_BYTES
}

describe('retainedBytes', () => {
  it('counts each typed array buffer and an estimate for objects', () => {
    const patch = pixelPatch(1)
    expect(patch.changes.literals.byteLength).toBeGreaterThan(700)
    expect(retainedBytes([patch])).toBe(expectedPixelPatchBytes(patch))

    const crop = createCropPatch(noise(20, 10, 3), { x: 2, y: 2, width: 10, height: 5 })!
    expect(retainedBytes([crop])).toBe(
      PAYLOAD_OVERHEAD_BYTES + crop.removed.tokens.byteLength + crop.removed.literals.byteLength + 2 * ARRAY_OVERHEAD_BYTES,
    )

    const selection = encodeSelection(createSelectionMask(4, 2, Uint8Array.from([0, 1, 1, 0, 1, 1, 1, 1])))!
    expect(retainedBytes([selection])).toBe(PAYLOAD_OVERHEAD_BYTES + selection.data.byteLength + ARRAY_OVERHEAD_BYTES)
  })

  it('costs nothing for no payloads or no selection', () => {
    expect(retainedBytes([])).toBe(0)
    expect(retainedBytes([null, null])).toBe(0)
    const patch = pixelPatch(5)
    expect(retainedBytes([null, patch, null])).toBe(retainedBytes([patch]))
  })

  it('adds up separate payloads', () => {
    const a = pixelPatch(7)
    const b = pixelPatch(9)
    const selection = encodeSelection(createSelectionMask(3, 1, Uint8Array.from([1, 0, 1])))
    expect(retainedBytes([a, b, selection])).toBe(retainedBytes([a]) + retainedBytes([b]) + retainedBytes([selection]))
  })

  it('counts a payload or a buffer referenced more than once only once', () => {
    const a = pixelPatch(11)
    expect(retainedBytes([a, a, a])).toBe(retainedBytes([a]))
    // Another payload sharing a's literal memory, as history might if it reused one.
    const b: PixelPatch = { ...pixelPatch(13), changes: { ...pixelPatch(13).changes, literals: a.changes.literals } }
    const bOwnTokens = b.changes.tokens.buffer.byteLength + ARRAY_OVERHEAD_BYTES
    expect(retainedBytes([a, b])).toBe(retainedBytes([a]) + PAYLOAD_OVERHEAD_BYTES + bOwnTokens)
  })

  it('counts the whole buffer behind a view, which the view keeps alive', () => {
    const a = pixelPatch(15)
    const memory = new Uint8Array(10_000)
    const viewed: PixelPatch = { ...a, changes: { ...a.changes, literals: memory.subarray(0, a.changes.literals.byteLength) } }
    expect(retainedBytes([viewed])).toBe(
      PAYLOAD_OVERHEAD_BYTES + a.changes.tokens.buffer.byteLength + 10_000 + 2 * ARRAY_OVERHEAD_BYTES,
    )
  })

  it('reads no array contents, so it is cheap for large payloads', () => {
    const a = pixelPatch(17)
    const unreadable: PixelPatch = {
      ...a,
      changes: {
        ...a.changes,
        literals: new Proxy(a.changes.literals, {
          get(target, key) {
            if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error('read an element')
            return Reflect.get(target, key)
          },
        }),
      },
    }
    expect(retainedBytes([unreadable])).toBe(retainedBytes([a]))
  })
})
