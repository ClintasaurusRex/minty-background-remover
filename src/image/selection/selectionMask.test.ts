import { describe, expect, it } from 'vitest'
import { createSelectionMask } from './selectionMask'
import { maskBytes, maskRows } from './testFixtures'

function mask(...rows: string[]) {
  const { width, height, data } = maskBytes(...rows)
  return createSelectionMask(width, height, data)
}

describe('createSelectionMask', () => {
  it('returns null when nothing is selected', () => {
    expect(mask('...', '...')).toBeNull()
    expect(mask('.')).toBeNull()
  })

  it('describes a single selected pixel', () => {
    const result = mask(
      '. . . .',
      '. . # .',
      '. . . .',
    )
    expect(result).toMatchObject({ width: 4, height: 3, count: 1, bounds: { x: 2, y: 1, width: 1, height: 1 } })
  })

  it('selects the only pixel of a 1 × 1 image', () => {
    expect(mask('#')).toMatchObject({ width: 1, height: 1, count: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } })
  })

  it('counts multiple pixels and bounds them tightly', () => {
    const result = mask(
      '. . . . . .',
      '. . # . . .',
      '. . . . # .',
      '. # . . . .',
      '. . . . . .',
    )
    expect(result).toMatchObject({ count: 3, bounds: { x: 1, y: 1, width: 4, height: 3 } })
  })

  it('bounds disconnected regions and holes as one rectangle', () => {
    const result = mask(
      '# # # . . .',
      '# . # . . .',
      '# # # . . .',
      '. . . . . #',
    )
    expect(result).toMatchObject({ count: 9, bounds: { x: 0, y: 0, width: 6, height: 4 } })
  })

  it('handles selections touching every image edge', () => {
    expect(mask('#..', '...', '..#')).toMatchObject({ count: 2, bounds: { x: 0, y: 0, width: 3, height: 3 } })
    expect(mask('.#.', '...', '.#.')).toMatchObject({ count: 2, bounds: { x: 1, y: 0, width: 1, height: 3 } })
    expect(mask('...', '#.#', '...')).toMatchObject({ count: 2, bounds: { x: 0, y: 1, width: 3, height: 1 } })
    expect(mask('...', '...', '..#')).toMatchObject({ count: 1, bounds: { x: 2, y: 2, width: 1, height: 1 } })
  })

  it('describes a fully selected image', () => {
    expect(mask('###', '###')).toMatchObject({ count: 6, bounds: { x: 0, y: 0, width: 3, height: 2 } })
  })

  it('handles single-row and single-column images', () => {
    expect(mask('..##.#.')).toMatchObject({ width: 7, height: 1, count: 3, bounds: { x: 2, y: 0, width: 4, height: 1 } })
    expect(mask('.', '#', '#', '.')).toMatchObject({ width: 1, height: 4, count: 2, bounds: { x: 0, y: 1, width: 1, height: 2 } })
  })

  it('rejects dimensions that are not positive whole numbers', () => {
    for (const [width, height] of [
      [0, 1],
      [1, 0],
      [-1, 1],
      [1.5, 2],
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
      [2 ** 53, 1],
    ]) {
      expect(() => createSelectionMask(width, height, new Uint8Array(1))).toThrow(RangeError)
    }
  })

  it('rejects buffers whose length is not width × height', () => {
    expect(() => createSelectionMask(2, 2, new Uint8Array(3))).toThrow(RangeError)
    expect(() => createSelectionMask(2, 2, new Uint8Array(5))).toThrow(RangeError)
    expect(() => createSelectionMask(2, 2, new Uint8Array(0))).toThrow(RangeError)
  })

  it('rejects bytes other than 0 and 1', () => {
    expect(() => createSelectionMask(2, 1, Uint8Array.of(0, 2))).toThrow(RangeError)
    expect(() => createSelectionMask(2, 1, Uint8Array.of(255, 1))).toThrow(RangeError)
  })

  it('keeps the given buffer without copying or changing it', () => {
    const data = Uint8Array.of(0, 1, 1, 0, 1, 0)
    const before = Array.from(data)
    const result = createSelectionMask(3, 2, data)
    expect(result?.data).toBe(data)
    expect(Array.from(data)).toEqual(before)
  })

  it('produces independent masks from independent buffers', () => {
    const first = mask('#.', '..')
    const second = mask('#.', '..')
    expect(first?.data).not.toBe(second?.data)
    expect(maskRows(first!)).toEqual(maskRows(second!))
  })

  it('handles a fully selected 4K mask', () => {
    const width = 3840
    const height = 2160
    const result = createSelectionMask(width, height, new Uint8Array(width * height).fill(1))
    expect(result).toMatchObject({ count: width * height, bounds: { x: 0, y: 0, width, height } })
  })

  it('handles a sparse mask at the 50-megapixel import limit', () => {
    const width = 10_000
    const height = 5_000
    const data = new Uint8Array(width * height)
    data[123 * width + 4_567] = 1
    data[4_321 * width + 9_999] = 1
    data[(height - 1) * width + 17] = 1
    expect(createSelectionMask(width, height, data)).toMatchObject({
      count: 3,
      bounds: { x: 17, y: 123, width: 9_999 - 17 + 1, height: height - 123 },
    })
  })

  it('returns null for a large empty mask', () => {
    expect(createSelectionMask(16_384, 1_024, new Uint8Array(16_384 * 1_024))).toBeNull()
  })
})

describe('mask fixtures', () => {
  it('round-trip through a character map', () => {
    const rows = ['.#..', '##.#', '...#']
    const { width, height, data } = maskBytes(...rows)
    expect([width, height]).toEqual([4, 3])
    expect(maskRows(createSelectionMask(width, height, data)!)).toEqual(rows)
  })

  it('reject malformed maps', () => {
    expect(() => maskBytes('##', '#')).toThrow()
    expect(() => maskBytes('#x')).toThrow()
  })
})
