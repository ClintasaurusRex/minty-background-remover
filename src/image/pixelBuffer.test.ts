import { describe, expect, it } from 'vitest'
import type { PixelBuffer } from '../editor/types'
import { fakeImageData } from './import/testFixtures'
import { copyPixelData, createPixelBuffer, sharesPixelMemory, validatePixelBuffer } from './pixelBuffer'

/** Width × height RGBA bytes where neighbouring bytes differ, so a misplaced byte is noticed. */
function patterned(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 255
  return data
}

/** Byte-for-byte equality, fast enough for 4K buffers (expect().toEqual is not). */
function sameBytes(a: Readonly<Uint8ClampedArray>, b: Readonly<Uint8ClampedArray>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const buffer = (width: number, height: number, data: Uint8ClampedArray<ArrayBuffer>): PixelBuffer => ({ width, height, data })

describe('validatePixelBuffer', () => {
  it('accepts complete RGBA buffers, small and large, plain or ImageData', () => {
    for (const [width, height] of [[1, 1], [3, 2], [1, 7], [3840, 2400]]) {
      expect(() => validatePixelBuffer(buffer(width, height, new Uint8ClampedArray(width * height * 4)))).not.toThrow()
    }
    expect(() => validatePixelBuffer(fakeImageData(5, 4))).not.toThrow()
  })

  it('rejects dimensions that are not whole numbers of at least 1', () => {
    for (const [width, height] of [[0, 1], [1, 0], [-1, 4], [1.5, 2], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1], [2 ** 53, 1]]) {
      expect(() => validatePixelBuffer(buffer(width, height, new Uint8ClampedArray(16)))).toThrow(RangeError)
    }
  })

  it('rejects buffers with too few or too many bytes', () => {
    for (const length of [0, 4, 15, 17, 32]) {
      expect(() => validatePixelBuffer(buffer(2, 2, new Uint8ClampedArray(length)))).toThrow(RangeError)
    }
    // Width and height swapped still has the right length, so it is a valid (different) image.
    expect(() => validatePixelBuffer(buffer(2, 3, new Uint8ClampedArray(24)))).not.toThrow()
    expect(() => validatePixelBuffer(buffer(3, 2, new Uint8ClampedArray(24)))).not.toThrow()
  })

  it('rejects a buffer whose memory was transferred away', () => {
    const data = new Uint8ClampedArray(16)
    structuredClone(data.buffer, { transfer: [data.buffer] })
    expect(data.length).toBe(0)
    expect(() => validatePixelBuffer(buffer(2, 2, data))).toThrow(RangeError)
  })

  it('rejects a view that does not start on a 4-byte boundary, which 32-bit pixel reads need', () => {
    const memory = new ArrayBuffer(24)
    expect(() => validatePixelBuffer(buffer(2, 2, new Uint8ClampedArray(memory, 2, 16)))).toThrow(RangeError)
    expect(() => validatePixelBuffer(buffer(2, 2, new Uint8ClampedArray(memory, 4, 16)))).not.toThrow()
  })
})

describe('createPixelBuffer', () => {
  it('wraps the bytes without copying them', () => {
    const data = patterned(3, 2)
    const pixels = createPixelBuffer(3, 2, data)
    expect(pixels).toEqual({ width: 3, height: 2, data })
    expect(pixels.data).toBe(data)
  })

  it('rejects sizes that do not form a complete RGBA image', () => {
    expect(() => createPixelBuffer(2, 2, new Uint8ClampedArray(15))).toThrow(RangeError)
    expect(() => createPixelBuffer(0, 4, new Uint8ClampedArray(0))).toThrow(RangeError)
    expect(() => createPixelBuffer(2.5, 2, new Uint8ClampedArray(20))).toThrow(RangeError)
  })

  it('is read-only through its type', () => {
    const pixels = createPixelBuffer(1, 1, new Uint8ClampedArray(4))
    // Never called: the checks are the expected type errors, enforced by `npm run typecheck`.
    const writes = () => {
      // @ts-expect-error A pixel buffer's bytes cannot be written through it (copy-on-write).
      pixels.data[0] = 255
      // @ts-expect-error Its dimensions cannot be changed either.
      pixels.width = 2
    }
    expect(writes).toBeTypeOf('function')
    expect(pixels.data[0]).toBe(0)
  })
})

describe('copyPixelData', () => {
  it('copies the bytes into new memory', () => {
    const source = createPixelBuffer(3, 2, patterned(3, 2))
    const copy = copyPixelData(source)
    expect(copy).not.toBe(source.data)
    expect(copy.buffer).not.toBe(source.data.buffer)
    expect(copy.byteOffset).toBe(0)
    expect(Array.from(copy)).toEqual(Array.from(source.data))
  })

  it('leaves the source untouched when the copy is written', () => {
    const data = patterned(4, 4)
    const original = Array.from(data)
    const source = createPixelBuffer(4, 4, data)
    const copy = copyPixelData(source)
    copy.fill(0)
    copy[3] = 99
    expect(Array.from(source.data)).toEqual(original)
    expect(source.data).toBe(data)
  })

  it('copies only the pixels of a view inside larger memory', () => {
    const memory = new ArrayBuffer(4 + 16 + 8)
    const view = new Uint8ClampedArray(memory, 4, 16)
    view.set(patterned(2, 2))
    const copy = copyPixelData(createPixelBuffer(2, 2, view))
    expect(copy.buffer.byteLength).toBe(16)
    expect(Array.from(copy)).toEqual(Array.from(view))
  })

  it('copies decoded ImageData too', () => {
    const decoded = fakeImageData(2, 1)
    decoded.data.set([1, 2, 3, 4, 5, 6, 7, 8])
    const copy = copyPixelData(decoded)
    expect(Array.from(copy)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(copy.buffer).not.toBe(decoded.data.buffer)
  })

  it('copies a 4K image exactly', () => {
    const source = createPixelBuffer(3840, 2400, patterned(3840, 2400))
    const copy = copyPixelData(source)
    expect(copy.length).toBe(3840 * 2400 * 4)
    expect(sameBytes(copy, source.data)).toBe(true)
    copy[copy.length - 1] ^= 1
    expect(sameBytes(copy, source.data)).toBe(false)
  })
})

describe('sharesPixelMemory', () => {
  it('detects buffers that use the same memory', () => {
    const data = patterned(2, 2)
    const a = createPixelBuffer(2, 2, data)
    expect(sharesPixelMemory(a, a)).toBe(true)
    expect(sharesPixelMemory(a, createPixelBuffer(2, 2, data))).toBe(true)
    expect(sharesPixelMemory(a, createPixelBuffer(1, 1, data.subarray(4, 8)))).toBe(true)
  })

  it('treats a copy as separate memory', () => {
    const a = createPixelBuffer(2, 2, patterned(2, 2))
    expect(sharesPixelMemory(a, createPixelBuffer(2, 2, copyPixelData(a)))).toBe(false)
  })
})
