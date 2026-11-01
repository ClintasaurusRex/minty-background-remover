import { describe, expect, it } from 'vitest'
import type { FloodMode, PixelCoordinate, SelectionMask } from '../../editor/types'
import { fakeImageData } from '../import/testFixtures'
import { colourDistanceSquared, toleranceThreshold } from './colourDistance'
import { createMagicWandSelection } from './magicWand'
import { createSelectionMask } from './selectionMask'
import { type Rgba, imageFromRows, maskRows } from './testFixtures'

const WHITE: Rgba = [255, 255, 255, 255]
const BLACK: Rgba = [0, 0, 0, 255]
const RED: Rgba = [255, 0, 0, 255]

/** `.` white, `#` black, `r` red. */
const PALETTE = { '.': WHITE, '#': BLACK, r: RED }

/** Checks that the mask holds only 0s and 1s and that its count and bounds describe its data. */
function expectConsistent(mask: SelectionMask): void {
  const rebuilt = createSelectionMask(mask.width, mask.height, mask.data)
  expect({ count: rebuilt?.count, bounds: rebuilt?.bounds }).toEqual({ count: mask.count, bounds: mask.bounds })
}

/** Runs the wand and checks that the result is consistent. */
function wand(image: ImageData, x: number, y: number, tolerance = 20, floodMode: FloodMode = 'contiguous'): SelectionMask {
  const mask = createMagicWandSelection(image, { x, y }, { tolerance, floodMode })
  expectConsistent(mask)
  return mask
}

/** The wand's selection as a character map: `#` selected, `.` not. */
function select(image: ImageData, x: number, y: number, tolerance = 20, floodMode: FloodMode = 'contiguous'): string[] {
  return maskRows(wand(image, x, y, tolerance, floodMode))
}

/** Straightforward breadth-first reference, with no shortcuts: what the wand must select. */
function referenceRows(image: ImageData, seed: PixelCoordinate, tolerance: number, floodMode: FloodMode): string[] {
  const { width, height, data } = image
  const threshold = toleranceThreshold(tolerance)
  const s = (seed.y * width + seed.x) * 4
  const matchesSeed = (x: number, y: number) => {
    const p = (y * width + x) * 4
    const distance = colourDistanceSquared(
      data[s], data[s + 1], data[s + 2], data[s + 3],
      data[p], data[p + 1], data[p + 2], data[p + 3],
    )
    return distance <= threshold
  }

  const selected = Array.from({ length: height }, () => Array<boolean>(width).fill(false))
  if (floodMode === 'global') {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) selected[y][x] = matchesSeed(x, y)
  } else {
    const queue: PixelCoordinate[] = [seed]
    selected[seed.y][seed.x] = true
    const visit = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height || selected[y][x] || !matchesSeed(x, y)) return
      selected[y][x] = true
      queue.push({ x, y })
    }
    for (let head = 0; head < queue.length; head++) {
      const { x, y } = queue[head]
      visit(x - 1, y)
      visit(x + 1, y)
      visit(x, y - 1)
      visit(x, y + 1)
    }
  }
  return selected.map((row) => row.map((isSelected) => (isSelected ? '#' : '.')).join(''))
}

/** Deterministic noise over a palette weighted towards a light background, with near matches and transparency. */
function randomImage(width: number, height: number, seed: number): ImageData {
  const palette: Rgba[] = [
    [200, 200, 200, 255],
    [200, 200, 200, 255],
    [200, 200, 200, 255],
    [210, 205, 195, 255],
    [30, 60, 90, 255],
    [0, 0, 0, 0],
    [255, 0, 0, 0],
    [200, 200, 200, 60],
  ]
  const image = fakeImageData(width, height)
  let state = seed
  for (let i = 0; i < width * height; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    image.data.set(palette[(state >>> 16) % palette.length], i * 4)
  }
  return image
}

describe('createMagicWandSelection', () => {
  it('selects the only pixel of a 1 × 1 image', () => {
    const image = imageFromRows(PALETTE, 'r')
    for (const floodMode of ['contiguous', 'global'] as const) {
      expect(wand(image, 0, 0, 0, floodMode)).toMatchObject({ count: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } })
    }
  })

  it('selects all of a uniform image from any seed', () => {
    const image = imageFromRows(PALETTE, 'rrrrr', 'rrrrr', 'rrrrr')
    for (const [x, y] of [[0, 0], [4, 0], [0, 2], [4, 2], [2, 1]]) {
      for (const floodMode of ['contiguous', 'global'] as const) {
        expect(wand(image, x, y, 0, floodMode)).toMatchObject({ count: 15, bounds: { x: 0, y: 0, width: 5, height: 3 } })
      }
    }
  })

  it('stops at pixels that do not match', () => {
    const image = imageFromRows(PALETTE,
      '. . # . .',
      '. . # . .',
      '. . # . .',
    )
    expect(select(image, 0, 0)).toEqual(['##...', '##...', '##...'])
    expect(select(image, 4, 2)).toEqual(['...##', '...##', '...##'])
    expect(wand(image, 0, 0).bounds).toEqual({ x: 0, y: 0, width: 2, height: 3 })
  })

  it('leaves out an enclosed region of the same colour unless Global', () => {
    const image = imageFromRows(PALETTE,
      '. . . . . .',
      '. # # # # .',
      '. # . . # .',
      '. # . . # .',
      '. # # # # .',
      '. . . . . .',
    )
    expect(select(image, 0, 0)).toEqual(['######', '#....#', '#....#', '#....#', '#....#', '######'])
    expect(select(image, 3, 3)).toEqual(['......', '......', '..##..', '..##..', '......', '......'])
    expect(select(image, 0, 0, 20, 'global')).toEqual(['######', '#....#', '#.##.#', '#.##.#', '#....#', '######'])
    expect(wand(image, 3, 3).bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 })
  })

  it('selects separate regions of the same colour only in Global mode', () => {
    const image = imageFromRows(PALETTE,
      'r r . . .',
      'r r . . r',
      '. . . r r',
    )
    expect(select(image, 0, 0)).toEqual(['##...', '##...', '.....'])
    expect(select(image, 4, 2)).toEqual(['.....', '....#', '...##'])
    expect(select(image, 1, 1, 20, 'global')).toEqual(['##...', '##..#', '...##'])
    expect(wand(image, 1, 1, 20, 'global').bounds).toEqual({ x: 0, y: 0, width: 5, height: 3 })
  })

  it('does not connect pixels that touch only diagonally', () => {
    const diagonal = imageFromRows(PALETTE,
      'r . .',
      '. r .',
      '. . r',
    )
    expect(select(diagonal, 1, 1)).toEqual(['...', '.#.', '...'])
    expect(select(diagonal, 1, 1, 20, 'global')).toEqual(['#..', '.#.', '..#'])

    const checkerboard = imageFromRows(PALETTE,
      'r . r .',
      '. r . r',
      'r . r .',
    )
    expect(select(checkerboard, 1, 0)).toEqual(['.#..', '....', '....'])
    expect(select(checkerboard, 1, 0, 20, 'global')).toEqual(['.#.#', '#.#.', '.#.#'])
  })

  it('follows narrow corridors through turns in every direction', () => {
    const maze = imageFromRows(PALETTE,
      '. . . . . . . #',
      '# # # # # # . #',
      '. . . . . . . #',
      '. # # # # # # #',
      '. . . . . . . .',
      '# # # # # # # .',
      '. . # . . . . .',
      '. . # # # # # #',
    )
    const corridor = [
      '#######.',
      '......#.',
      '#######.',
      '#.......',
      '########',
      '.......#',
      '...#####',
      '........',
    ]
    // The same corridor from either end; the pocket at the bottom left is unreachable.
    expect(select(maze, 0, 0)).toEqual(corridor)
    expect(select(maze, 3, 6)).toEqual(corridor)
    expect(select(maze, 0, 7)).toEqual(['........', '........', '........', '........', '........', '........', '##......', '##......'])
  })

  it('works from seeds at every corner and edge', () => {
    const image = imageFromRows(PALETTE,
      '. . . . .',
      '. # # # .',
      '. # r # .',
      '. # # # .',
      '. . . . .',
    )
    const frame = ['#####', '#...#', '#...#', '#...#', '#####']
    for (const [x, y] of [[0, 0], [4, 0], [0, 4], [4, 4], [2, 0], [0, 2], [4, 2], [2, 4]]) {
      expect(select(image, x, y)).toEqual(frame)
    }
    expect(select(image, 2, 2)).toEqual(['.....', '.....', '..#..', '.....', '.....'])
  })

  it('matches only identical colours at tolerance 0', () => {
    const image = imageFromRows(
      { a: [100, 100, 100, 255], b: [100, 100, 101, 255], c: [100, 100, 100, 254] },
      'a b a',
      'a a c',
    )
    // The second `a` in the top row is walled off by non-matching pixels.
    expect(select(image, 0, 0, 0)).toEqual(['#..', '##.'])
    expect(select(image, 0, 0, 0, 'global')).toEqual(['#.#', '##.'])
    expect(select(image, 0, 0, 1)).toEqual(['###', '###'])
  })

  it('uses the exact tolerance boundaries at 20, and selects everything at 100', () => {
    const image = imageFromRows(
      { W: WHITE, C: [204, 204, 204, 255], c: [203, 203, 203, 255], t: [0, 0, 0, 0], k: BLACK },
      'W C c W t k',
    )
    expect(select(image, 0, 0)).toEqual(['##....'])
    expect(select(image, 0, 0, 20, 'global')).toEqual(['##.#..'])
    expect(select(image, 0, 0, 100)).toEqual(['######'])
    expect(select(image, 0, 0, 100, 'global')).toEqual(['######'])
  })

  it('treats transparent pixels as one colour and selects soft edges by opacity', () => {
    const image = imageFromRows(
      {
        t: [0, 0, 0, 0],
        u: [255, 0, 0, 0],
        v: [12, 34, 56, 0],
        s: [200, 100, 0, 51],
        S: [200, 100, 0, 52],
        O: [200, 100, 0, 255],
      },
      't u v t',
      'u s O S',
      'v t u t',
    )
    expect(select(image, 0, 0, 0)).toEqual(['####', '#...', '####'])
    expect(select(image, 0, 0, 20)).toEqual(['####', '##..', '####'])
    expect(select(image, 0, 0, 20, 'global')).toEqual(['####', '##..', '####'])
    expect(select(image, 0, 0, 99)).toEqual(['####', '##.#', '####'])
    expect(select(image, 0, 0, 100)).toEqual(['####', '####', '####'])
    // From the opaque pixel, its soft edges match at 99 (D = 0.8) but fully transparent
    // pixels stay out below 100, whatever their hidden colour.
    expect(select(image, 2, 1, 99, 'global')).toEqual(['....', '.###', '....'])
  })

  it('never changes the source pixels', () => {
    const image = randomImage(17, 11, 7)
    const before = image.data.slice()
    for (const floodMode of ['contiguous', 'global'] as const) {
      const mask = createMagicWandSelection(image, { x: 3, y: 4 }, { tolerance: 20, floodMode })
      expect(mask.data.buffer).not.toBe(image.data.buffer)
    }
    expect(image.data).toEqual(before)
  })

  it('agrees with a breadth-first reference on random images', () => {
    const images = [
      randomImage(13, 9, 1),
      randomImage(13, 9, 2),
      randomImage(1, 17, 3),
      randomImage(17, 1, 4),
      randomImage(40, 30, 5),
    ]
    const failures: string[] = []
    for (const [n, image] of images.entries()) {
      const pixelCount = image.width * image.height
      const step = pixelCount > 1000 ? 13 : pixelCount > 100 ? 2 : 1
      for (let index = 0; index < pixelCount; index += step) {
        const seed = { x: index % image.width, y: Math.floor(index / image.width) }
        for (const tolerance of [0, 3, 20, 60, 99, 100]) {
          for (const floodMode of ['contiguous', 'global'] as const) {
            const mask = wand(image, seed.x, seed.y, tolerance, floodMode)
            if (maskRows(mask).join('/') !== referenceRows(image, seed, tolerance, floodMode).join('/')) {
              failures.push(`image ${n}, seed (${seed.x}, ${seed.y}), tolerance ${tolerance}, ${floodMode}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('rejects malformed images, seeds outside the image and invalid tolerances', () => {
    const options = { tolerance: 20, floodMode: 'contiguous' } as const
    expect(() => createMagicWandSelection(fakeImageData(0, 1, 0), { x: 0, y: 0 }, options)).toThrow(RangeError)
    expect(() => createMagicWandSelection(fakeImageData(1.5, 2, 12), { x: 0, y: 0 }, options)).toThrow(RangeError)
    expect(() => createMagicWandSelection(fakeImageData(2, 2, 15), { x: 0, y: 0 }, options)).toThrow(RangeError)
    expect(() => createMagicWandSelection(fakeImageData(2, 2, 17), { x: 0, y: 0 }, options)).toThrow(RangeError)

    const image = fakeImageData(3, 2)
    for (const seed of [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 3, y: 0 }, { x: 0, y: 2 }, { x: 0.5, y: 0 }, { x: Number.NaN, y: 0 }]) {
      expect(() => createMagicWandSelection(image, seed, options)).toThrow(RangeError)
    }
    for (const tolerance of [-1, 101, 20.5, Number.NaN]) {
      expect(() => createMagicWandSelection(image, { x: 0, y: 0 }, { ...options, tolerance })).toThrow(RangeError)
    }

    // Pixel data must start on a 4-byte boundary, as it does in every ImageData from a canvas.
    const unaligned = { ...fakeImageData(1, 1), data: new Uint8ClampedArray(new ArrayBuffer(5), 1, 4) }
    expect(() => createMagicWandSelection(unaligned, { x: 0, y: 0 }, options)).toThrow(RangeError)
  })

  it('selects all of a large uniform image without recursion', () => {
    const image = fakeImageData(2048, 2048)
    for (const floodMode of ['contiguous', 'global'] as const) {
      const mask = wand(image, 1000, 1500, 0, floodMode)
      expect(mask).toMatchObject({ count: 2048 * 2048, bounds: { x: 0, y: 0, width: 2048, height: 2048 } })
    }
  })

  it('follows a long winding one-pixel corridor', () => {
    // Columns at even x form a corridor that runs down, across a gap at the bottom, up,
    // across a gap at the top, and so on: 501 columns of 1001 pixels plus 500 gaps.
    // The corridor is transparent; walls are opaque black (alpha 255).
    const size = 1001
    const image = fakeImageData(size, size)
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size; x += 2) {
        const gapRow = x % 4 === 1 ? size - 1 : 0
        if (y !== gapRow) image.data[(y * size + x) * 4 + 3] = 255
      }
    }
    const mask = wand(image, 0, 0, 0)
    expect(mask).toMatchObject({ count: 501 * size + 500, bounds: { x: 0, y: 0, width: size, height: size } })
  })

  it('handles more pending scan requests than its initial stack holds', () => {
    // A bar along the top with 2,049 one-pixel teeth hanging from it: scanning below the bar
    // finds 2,049 separate runs at once, each queueing a request for the row beneath it.
    const width = 4097
    const teeth = Array.from({ length: 3 }, () => '.#'.repeat(2048) + '.')
    const image = imageFromRows(PALETTE, '.'.repeat(width), ...teeth)
    const mask = wand(image, 0, 0)
    expect(mask).toMatchObject({ count: width + 2049 * 3, bounds: { x: 0, y: 0, width, height: 4 } })
  })
})
