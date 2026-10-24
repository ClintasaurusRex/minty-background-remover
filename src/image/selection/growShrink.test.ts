import { describe, expect, it } from 'vitest'
import type { SelectionMask } from '../../editor/types'
import { growSelection, shrinkSelection } from './growShrink'
import { createSelectionMask } from './selectionMask'
import { selectAll } from './selectionOperations'
import { maskBytes, maskRows } from './testFixtures'

function mask(...rows: string[]): SelectionMask | null {
  const { width, height, data } = maskBytes(...rows)
  return createSelectionMask(width, height, data)
}

/** The result as a character map, after checking its count and bounds describe its data. */
function rows(result: SelectionMask | null): string[] | null {
  if (!result) return null
  const rebuilt = createSelectionMask(result.width, result.height, result.data)
  expect({ count: rebuilt?.count, bounds: rebuilt?.bounds }).toEqual({ count: result.count, bounds: result.bounds })
  return maskRows(result)
}

const grow = (...map: string[]) => rows(growSelection(mask(...map)))
const shrink = (...map: string[]) => rows(shrinkSelection(mask(...map)))

/** Naive reference: checks all nine neighbours of every pixel. */
function reference(selection: SelectionMask, isGrow: boolean): Uint8Array {
  const { width, height, data } = selection
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let any = false
      let all = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          const inside = nx >= 0 && ny >= 0 && nx < width && ny < height
          const selected = inside ? data[ny * width + nx] === 1 : !isGrow
          any ||= selected
          all &&= selected
        }
      }
      out[y * width + x] = (isGrow ? any : all) ? 1 : 0
    }
  }
  return out
}

describe('growSelection', () => {
  it('returns null for an empty selection', () => {
    expect(growSelection(null)).toBeNull()
  })

  it('grows a single pixel into a 3 × 3 block', () => {
    expect(grow('.....', '.....', '..#..', '.....', '.....')).toEqual(['.....', '.###.', '.###.', '.###.', '.....'])
  })

  it('grows a corner pixel into a 2 × 2 block', () => {
    expect(grow('#..', '...', '...')).toEqual(['##.', '##.', '...'])
    expect(grow('...', '...', '..#')).toEqual(['...', '.##', '.##'])
  })

  it('grows horizontally, vertically and diagonally', () => {
    expect(grow('.....', '.....', '.###.', '.....', '.....')).toEqual(['.....', '#####', '#####', '#####', '.....'])
    expect(grow('.....', '..#..', '..#..', '..#..', '.....')).toEqual(['.###.', '.###.', '.###.', '.###.', '.###.'])
    // Diagonal neighbours are included: two diagonal pixels grow into one connected block.
    expect(grow('......', '.#....', '..#...', '......')).toEqual(['###...', '####..', '####..', '.###..'])
  })

  it('fills one-pixel holes', () => {
    expect(grow('#####', '##.##', '#####')).toEqual(['#####', '#####', '#####'])
  })

  it('returns a full selection unchanged', () => {
    const full = selectAll(4, 3)
    expect(growSelection(full)).toBe(full)
  })

  it('stays within the image at every edge', () => {
    expect(grow('#...#', '.....', '#...#')).toEqual(['##.##', '##.##', '##.##'])
    expect(growSelection(mask('#'))).toMatchObject({ count: 1 })
  })
})

describe('shrinkSelection', () => {
  it('returns null for an empty selection', () => {
    expect(shrinkSelection(null)).toBeNull()
  })

  it('shrinks a 3 × 3 block to its centre', () => {
    expect(shrink('.....', '.###.', '.###.', '.###.', '.....')).toEqual(['.....', '.....', '..#..', '.....', '.....'])
  })

  it('shrinks single pixels and one-pixel lines to nothing', () => {
    expect(shrinkSelection(mask('...', '.#.', '...'))).toBeNull()
    expect(shrinkSelection(mask('.....', '#####', '.....'))).toBeNull()
    expect(shrinkSelection(mask('..#..', '..#..', '..#..'))).toBeNull()
  })

  it('treats pixels outside the image as selected', () => {
    // A frame along the border keeps its outer edge; only the inside edge recedes.
    expect(shrink('#####', '#####', '##.##', '#####', '#####')).toEqual(['#####', '#...#', '#...#', '#...#', '#####'])
    // A background touching the top edge shrinks away from the content below it, not from the edge.
    expect(shrink('#####', '#####', '#####', '.....')).toEqual(['#####', '#####', '.....', '.....'])
    // A one-pixel line along the border still disappears: the row inside it is unselected.
    expect(shrinkSelection(mask('#####', '.....'))).toBeNull()
  })

  it('returns a full selection unchanged', () => {
    const full = selectAll(5, 3)
    expect(shrinkSelection(full)).toBe(full)
  })

  it('enlarges holes by one pixel in every direction', () => {
    expect(shrink('#######', '#######', '#######', '###.###', '#######', '#######', '#######')).toEqual([
      '#######',
      '#######',
      '##...##',
      '##...##',
      '##...##',
      '#######',
      '#######',
    ])
  })

  it('keeps rows supported by the image edge', () => {
    expect(shrink('###', '###', '...')).toEqual(['###', '...', '...'])
  })
})

describe('Grow and Shrink together', () => {
  it('repeat predictably: n grows move the edge n pixels, and shrinking undoes it for a block', () => {
    let selection = mask('.........', '.........', '.........', '.........', '....#....', '.........', '.........', '.........', '.........')
    selection = growSelection(growSelection(selection))
    expect(selection).toMatchObject({ count: 25, bounds: { x: 2, y: 2, width: 5, height: 5 } })
    selection = growSelection(growSelection(selection))
    expect(selection).toMatchObject({ count: 81, bounds: { x: 0, y: 0, width: 9, height: 9 } })
    expect(growSelection(selection)).toBe(selection)
    // Full image: shrink keeps it, because outside the image counts as selected.
    expect(shrinkSelection(selection)).toBe(selection)

    let block = mask('.......', '.#####.', '.#####.', '.#####.', '.#####.', '.#####.', '.......')
    block = shrinkSelection(block)
    expect(block).toMatchObject({ count: 9, bounds: { x: 2, y: 2, width: 3, height: 3 } })
    block = shrinkSelection(block)
    expect(block).toMatchObject({ count: 1, bounds: { x: 3, y: 3, width: 1, height: 1 } })
    expect(shrinkSelection(block)).toBeNull()
  })

  it('never change their input', () => {
    const selection = mask('.#.', '###', '.#.')!
    const before = selection.data.slice()
    growSelection(selection)
    shrinkSelection(selection)
    expect(selection.data).toEqual(before)
    expect(selection).toMatchObject({ count: 5, bounds: { x: 0, y: 0, width: 3, height: 3 } })
  })

  it('agree with a nine-neighbour reference on random masks of odd sizes', () => {
    let state = 7
    const random = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
    const failures: string[] = []
    for (const [width, height] of [[1, 1], [1, 7], [7, 1], [3, 5], [9, 7], [13, 11]]) {
      for (let trial = 0; trial < 25; trial++) {
        const density = random()
        const data = Uint8Array.from({ length: width * height }, () => (random() < density ? 1 : 0))
        const selection = createSelectionMask(width, height, data)
        if (!selection) continue
        for (const isGrow of [true, false]) {
          const result = isGrow ? growSelection(selection) : shrinkSelection(selection)
          const expected = createSelectionMask(width, height, reference(selection, isGrow))
          const same = result === null ? expected === null
            : expected !== null && result.count === expected.count &&
              JSON.stringify(result.bounds) === JSON.stringify(expected.bounds) &&
              result.data.every((value, i) => value === expected.data[i])
          if (!same) failures.push(`${width} × ${height}, trial ${trial}, ${isGrow ? 'grow' : 'shrink'}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('handle a large image with a selection touching its edges', () => {
    const width = 2049
    const height = 1025
    const data = new Uint8Array(width * height).fill(1)
    // A hole in the middle and a notch in the right edge.
    for (let y = 500; y < 520; y++) data.fill(0, y * width + 1000, y * width + 1030)
    data.fill(0, 300 * width + 2040, 300 * width + 2049)
    const selection = createSelectionMask(width, height, data)!

    const grown = growSelection(selection)!
    expect(grown).toMatchObject({ count: width * height - 18 * 28, bounds: { x: 0, y: 0, width, height } })
    const shrunk = shrinkSelection(selection)!
    expect(shrunk).toMatchObject({ count: width * height - 22 * 32 - 3 * 10, bounds: { x: 0, y: 0, width, height } })
  })
})
