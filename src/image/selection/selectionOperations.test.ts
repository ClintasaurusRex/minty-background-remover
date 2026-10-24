import { describe, expect, it } from 'vitest'
import type { SelectionMask, SelectionMode } from '../../editor/types'
import { createSelectionMask } from './selectionMask'
import { combineSelections, invertSelection, selectAll } from './selectionOperations'
import { maskBytes, maskRows } from './testFixtures'

function mask(...rows: string[]): SelectionMask | null {
  const { width, height, data } = maskBytes(...rows)
  return createSelectionMask(width, height, data)
}

/** Checks the result holds only 0s and 1s and that its count and bounds describe its data. */
function expectConsistent(result: SelectionMask | null): void {
  if (!result) return
  const rebuilt = createSelectionMask(result.width, result.height, result.data)
  expect({ count: rebuilt?.count, bounds: rebuilt?.bounds }).toEqual({ count: result.count, bounds: result.bounds })
}

function rows(result: SelectionMask | null): string[] | null {
  expectConsistent(result)
  return result && maskRows(result)
}

function combine(a: SelectionMask | null, b: SelectionMask | null, mode: SelectionMode): string[] | null {
  return rows(combineSelections(a, b, mode))
}

describe('combineSelections', () => {
  const existing = mask('##..', '##..', '....')
  const incoming = mask('.##.', '.##.', '.##.')

  it('follows the truth tables for New, Add and Subtract', () => {
    // Per pixel (existing, incoming): New = incoming, Add = either, Subtract = existing and not incoming.
    const a = mask('##..')
    const b = mask('#.#.')
    expect(combine(a, b, 'new')).toEqual(['#.#.'])
    expect(combine(a, b, 'add')).toEqual(['###.'])
    expect(combine(a, b, 'subtract')).toEqual(['.#..'])
  })

  it('handles partially overlapping selections', () => {
    expect(combine(existing, incoming, 'new')).toEqual(['.##.', '.##.', '.##.'])
    expect(combine(existing, incoming, 'add')).toEqual(['###.', '###.', '.##.'])
    expect(combine(existing, incoming, 'subtract')).toEqual(['#...', '#...', '....'])
  })

  it('handles selections that do not overlap', () => {
    const left = mask('#...', '#...')
    const right = mask('...#', '..##')
    expect(combine(left, right, 'add')).toEqual(['#..#', '#.##'])
    expect(combineSelections(left, right, 'subtract')).toBe(left)
  })

  it('handles fully overlapping selections', () => {
    const same = mask('.#.', '##.')
    const copy = mask('.#.', '##.')
    expect(combineSelections(same, copy, 'add')).toBe(same)
    expect(combineSelections(same, copy, 'subtract')).toBeNull()
    expect(combineSelections(same, copy, 'new')).toBe(copy)
  })

  it('returns an input unchanged when one contains the other', () => {
    const big = mask('###', '###')
    const small = mask('.#.', '...')
    expect(combineSelections(big, small, 'add')).toBe(big)
    expect(combineSelections(small, big, 'add')).toBe(big)
    expect(combineSelections(small, big, 'subtract')).toBeNull()
    expect(combine(big, small, 'subtract')).toEqual(['#.#', '###'])
  })

  it('handles empty selections', () => {
    const some = mask('.#', '..')
    for (const mode of ['new', 'add', 'subtract'] as const) expect(combineSelections(null, null, mode)).toBeNull()
    expect(combineSelections(some, null, 'new')).toBeNull()
    expect(combineSelections(some, null, 'add')).toBe(some)
    expect(combineSelections(some, null, 'subtract')).toBe(some)
    expect(combineSelections(null, some, 'new')).toBe(some)
    expect(combineSelections(null, some, 'add')).toBe(some)
    expect(combineSelections(null, some, 'subtract')).toBeNull()
  })

  it('subtracting a whole selection leaves nothing, and shrinks the bounds when the edge goes', () => {
    const selection = mask('#..#', '....', '#...')
    expect(combineSelections(selection, mask('####', '####', '####'), 'subtract')).toBeNull()
    expect(combineSelections(selection, mask('#..#', '....', '#...'), 'subtract')).toBeNull()
    const trimmed = combineSelections(selection, mask('...#', '....', '#...'), 'subtract')
    expect(rows(trimmed)).toEqual(['#...', '....', '....'])
    expect(trimmed?.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('reports counts and bounds for the union', () => {
    const result = combineSelections(mask('#....', '.....', '.....'), mask('.....', '.....', '....#'), 'add')
    expect(result).toMatchObject({ count: 2, bounds: { x: 0, y: 0, width: 5, height: 3 } })
  })

  it('rejects selections of different sizes', () => {
    const small = mask('#.', '..')
    const wide = mask('#..', '...')
    const tall = mask('#.', '..', '..')
    for (const mode of ['new', 'add', 'subtract'] as const) {
      expect(() => combineSelections(small, wide, mode)).toThrow(RangeError)
      expect(() => combineSelections(tall, small, mode)).toThrow(RangeError)
    }
  })

  it('never changes its inputs', () => {
    const a = mask('##.', '.#.', '...')!
    const b = mask('.##', '...', '..#')!
    const before = [a.data.slice(), b.data.slice()]
    for (const mode of ['new', 'add', 'subtract'] as const) combineSelections(a, b, mode)
    expect([a.data, b.data]).toEqual(before)
    expect(a).toMatchObject({ count: 3 })
    expect(b).toMatchObject({ count: 3 })
  })

  it('agrees with per-pixel logic (including Invert) on random masks of odd sizes and odd buffer offsets', () => {
    let state = 99
    const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
    const failures: string[] = []
    for (const [width, height] of [[1, 1], [3, 5], [7, 3], [13, 11], [1, 9], [9, 1]]) {
      for (let trial = 0; trial < 20; trial++) {
        // Masks live at odd offsets inside larger buffers: no alignment is assumed.
        const build = (density: number) => {
          const data = new Uint8Array(width * height + 3).subarray(1 + trial % 3, 1 + trial % 3 + width * height)
          for (let i = 0; i < data.length; i++) data[i] = random() < density ? 1 : 0
          return createSelectionMask(width, height, data)
        }
        const a = build(random())
        const b = build(random())
        for (const mode of ['new', 'add', 'subtract'] as const) {
          const expected = new Uint8Array(width * height)
          for (let i = 0; i < expected.length; i++) {
            const inA = a?.data[i] ?? 0
            const inB = b?.data[i] ?? 0
            expected[i] = mode === 'new' ? inB : mode === 'add' ? inA | inB : inA & (1 - inB)
          }
          const result = combineSelections(a, b, mode)
          const reference = createSelectionMask(width, height, expected)
          const same = result === null ? reference === null
            : reference !== null && result.count === reference.count &&
              JSON.stringify(result.bounds) === JSON.stringify(reference.bounds) &&
              result.data.every((value, i) => value === expected[i])
          if (!same) failures.push(`${width} × ${height}, trial ${trial}, ${mode}`)
        }
        const inverted = invertSelection(a, width, height)
        const flipped = createSelectionMask(width, height, Uint8Array.from({ length: width * height }, (_, i) => 1 - (a?.data[i] ?? 0)))
        if (JSON.stringify(inverted && { ...inverted, data: Array.from(inverted.data) }) !==
          JSON.stringify(flipped && { ...flipped, data: Array.from(flipped.data) })) {
          failures.push(`${width} × ${height}, trial ${trial}, invert`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('selectAll', () => {
  it('selects every pixel', () => {
    expect(rows(selectAll(3, 2))).toEqual(['###', '###'])
    expect(selectAll(5, 7)).toMatchObject({ width: 5, height: 7, count: 35, bounds: { x: 0, y: 0, width: 5, height: 7 } })
    expect(selectAll(1, 1)).toMatchObject({ count: 1 })
  })

  it('rejects invalid dimensions', () => {
    for (const [width, height] of [[0, 1], [1, 0], [-2, 3], [1.5, 2], [Number.NaN, 1]]) {
      expect(() => selectAll(width, height)).toThrow(RangeError)
    }
  })
})

describe('invertSelection', () => {
  it('flips every pixel', () => {
    expect(rows(invertSelection(mask('#..', '.#.', '...'), 3, 3))).toEqual(['.##', '#.#', '###'])
    expect(rows(invertSelection(mask('###', '#.#', '###'), 3, 3))).toEqual(['...', '.#.', '...'])
    expect(invertSelection(mask('###', '#.#', '###'), 3, 3)?.bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 })
  })

  it('selects everything when nothing is selected, and nothing when everything is', () => {
    expect(rows(invertSelection(null, 4, 2))).toEqual(['####', '####'])
    expect(invertSelection(mask('###', '###'), 3, 2)).toBeNull()
    expect(invertSelection(selectAll(5, 3), 5, 3)).toBeNull()
  })

  it('gives back the original selection when inverted twice', () => {
    const original = mask('.#...', '.##..', '....#')
    expect(rows(invertSelection(invertSelection(original, 5, 3), 5, 3))).toEqual(maskRows(original!))
  })

  it('tracks bounds that touch the image edges', () => {
    expect(invertSelection(mask('#....', '.....', '....#'), 5, 3)).toMatchObject({
      count: 13,
      bounds: { x: 0, y: 0, width: 5, height: 3 },
    })
    expect(rows(invertSelection(mask('####', '####', '##..'), 4, 3))).toEqual(['....', '....', '..##'])
    expect(rows(invertSelection(mask('#', '.', '#'), 1, 3))).toEqual(['.', '#', '.'])
  })

  it('never changes its input', () => {
    const selection = mask('#.', '.#')!
    const before = selection.data.slice()
    invertSelection(selection, 2, 2)
    expect(selection.data).toEqual(before)
  })

  it('rejects invalid dimensions and selections of a different size', () => {
    expect(() => invertSelection(null, 0, 3)).toThrow(RangeError)
    expect(() => invertSelection(null, 2.5, 3)).toThrow(RangeError)
    expect(() => invertSelection(mask('#.', '..'), 3, 2)).toThrow(RangeError)
    expect(() => invertSelection(mask('#.', '..'), 2, 3)).toThrow(RangeError)
  })
})

describe('large selections', () => {
  it('combine and invert at 4K without copying when nothing changes', () => {
    const width = 3840
    const height = 2160
    const all = selectAll(width, height)
    const square = new Uint8Array(width * height)
    for (let row = 1000; row < 1040; row++) square.fill(1, row * width + 2000, row * width + 2040)
    const small = createSelectionMask(width, height, square)!

    expect(combineSelections(all, small, 'add')).toBe(all)
    const holed = combineSelections(all, small, 'subtract')!
    expect(holed).toMatchObject({ count: width * height - 1600, bounds: { x: 0, y: 0, width, height } })
    expect(invertSelection(holed, width, height)).toMatchObject({
      count: 1600,
      bounds: { x: 2000, y: 1000, width: 40, height: 40 },
    })
    expect(invertSelection(all, width, height)).toBeNull()
  })
})
