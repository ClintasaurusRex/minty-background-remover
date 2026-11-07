import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cropPixels } from '../../editor/history/cropPatch'
import { randomInt, randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer, Rectangle } from '../../editor/types'
import { type EdgeSettings, deleteSelectionWithEdges } from '../edit/deleteWithEdges'
import { LINES, edgeCases, wand } from '../edit/edgeTestFixtures'
import { createPixelBuffer } from '../pixelBuffer'
import { type Rgba, imageFromRows } from '../selection/testFixtures'
import {
  type AutoTrimPlan,
  type AutoTrimResult,
  DEFAULT_ALPHA_THRESHOLD,
  MAX_ALPHA_THRESHOLD,
  autoTrimPixels,
  findVisibleBounds,
  planAutoTrim,
} from './autoTrim'

// Counts crops: Auto Trim crops once, with the kept rectangle, and never when nothing changes.
vi.mock('../../editor/history/cropPatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../editor/history/cropPatch')>()
  return { ...actual, cropPixels: vi.fn(actual.cropPixels) }
})
const crops = vi.mocked(cropPixels)

beforeEach(() => {
  crops.mockClear()
})

/**
 * `.` transparent black; `h` and `H` fully transparent with a hidden colour (as Delete leaves
 * pixels); `#` and `r` opaque; `s` half transparent; `g` alpha 8 and `f` alpha 1 (faint
 * anti-aliasing).
 */
const PALETTE: Readonly<Record<string, Rgba>> = {
  '.': [0, 0, 0, 0],
  h: [255, 0, 0, 0],
  H: [255, 255, 255, 0],
  '#': [0, 0, 0, 255],
  r: [220, 30, 30, 255],
  s: [40, 90, 160, 128],
  g: [10, 200, 10, 8],
  f: [10, 200, 10, 1],
}

const image = (...rows: string[]): PixelBuffer => imageFromRows(PALETTE, ...rows)

/** A fully transparent image, every pixel holding `hidden` as its colour. */
function blank(width: number, height: number, hidden: Rgba = [0, 0, 0, 0]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([hidden[0], hidden[1], hidden[2], 0], p * 4)
  return createPixelBuffer(width, height, data)
}

/** A copy of `pixels` with the given pixels set. */
function painted(pixels: PixelBuffer, ...points: readonly (readonly [x: number, y: number, colour: Rgba])[]): PixelBuffer {
  const data = pixels.data.slice()
  for (const [x, y, colour] of points) data.set(colour, (y * pixels.width + x) * 4)
  return createPixelBuffer(pixels.width, pixels.height, data)
}

/** Per-pixel reference: the bounds of every pixel whose alpha is above `threshold`, written as plainly as possible. */
function referenceBounds(pixels: PixelBuffer, threshold = 0): Rectangle | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      if (pixels.data[(y * pixels.width + x) * 4 + 3] > threshold) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** The bytes of `rect`, pixel by pixel. */
function referenceCrop(pixels: PixelBuffer, rect: Rectangle): number[] {
  const out: number[] = []
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const p = (y * pixels.width + x) * 4
      out.push(pixels.data[p], pixels.data[p + 1], pixels.data[p + 2], pixels.data[p + 3])
    }
  }
  return out
}

/** Every pixel with alpha above 0, as "x,y:r,g,b,a", positions relative to (dx, dy). */
function visiblePixels(pixels: PixelBuffer, dx = 0, dy = 0): string[] {
  const out: string[] = []
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const p = (y * pixels.width + x) * 4
      if (pixels.data[p + 3] > 0) out.push(`${x - dx},${y - dy}:${Array.from(pixels.data.subarray(p, p + 4)).join(',')}`)
    }
  }
  return out
}

/** `pixels` with reads of its bytes counted, alpha bytes and colour bytes separately. */
function countingReads(pixels: PixelBuffer): { pixels: PixelBuffer; alphaReads: () => number; colourReads: () => number } {
  let alphaReads = 0
  let colourReads = 0
  const data = new Proxy(pixels.data, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        if (Number(key) % 4 === 3) alphaReads++
        else colourReads++
      }
      return Reflect.get(target, key)
    },
  })
  return { pixels: { width: pixels.width, height: pixels.height, data }, alphaReads: () => alphaReads, colourReads: () => colourReads }
}

/** The plan, failing the test unless it is a crop. */
function cropPlan(plan: AutoTrimPlan): Extract<AutoTrimPlan, { kind: 'crop' }> {
  if (plan.kind !== 'crop') throw new Error(`Expected a crop, got ${plan.kind}`)
  return plan
}

/** The result, failing the test unless it is a crop. */
function trimmed(result: AutoTrimResult): Extract<AutoTrimResult, { kind: 'crop' }> {
  if (result.kind !== 'crop') throw new Error(`Expected a crop, got ${result.kind}`)
  return result
}

/**
 * Random images for property checks, with colour hidden under every transparent pixel: nothing
 * visible, everything visible, a few scattered pixels, or a block of content (with holes, faint
 * pixels and a stray dot), at random alphas.
 */
function randomImage(random: () => number): PixelBuffer {
  const width = 1 + randomInt(random, 24)
  const height = 1 + randomInt(random, 24)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([randomInt(random, 256), randomInt(random, 256), randomInt(random, 256), 0], p * 4)
  const alpha = () => (random() < 0.3 ? 1 + randomInt(random, 8) : 1 + randomInt(random, 255))
  const set = (x: number, y: number, a: number) => (data[(y * width + x) * 4 + 3] = a)
  const kind = random()
  if (kind < 0.1) {
    // Nothing visible.
  } else if (kind < 0.2) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, alpha())
  } else if (kind < 0.5) {
    for (let n = 1 + randomInt(random, 5); n > 0; n--) set(randomInt(random, width), randomInt(random, height), alpha())
  } else {
    const x0 = randomInt(random, width)
    const y0 = randomInt(random, height)
    const x1 = x0 + randomInt(random, width - x0)
    const y1 = y0 + randomInt(random, height - y0)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (random() < 0.7) set(x, y, random() < 0.2 ? 0 : alpha())
    if (random() < 0.5) set(randomInt(random, width), randomInt(random, height), alpha())
  }
  return createPixelBuffer(width, height, data)
}

const randomThreshold = (random: () => number) => [0, 0, 0, 1, 7, 8, 128, 254][randomInt(random, 8)]

describe('findVisibleBounds', () => {
  it('finds a single visible pixel anywhere, including every corner and edge', () => {
    for (const [width, height] of [[1, 1], [5, 4], [1, 6], [6, 1]]) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          for (const colour of [PALETTE['#'], PALETTE.f]) {
            const pixels = painted(blank(width, height, [9, 9, 9, 0]), [x, y, colour])
            expect(findVisibleBounds(pixels)).toEqual({ x, y, width: 1, height: 1 })
          }
        }
      }
    }
  })

  it('counts every pixel with alpha 1 or more by default, however faint', () => {
    expect(DEFAULT_ALPHA_THRESHOLD).toBe(0)
    expect(findVisibleBounds(image('.....', '..f..', '.....'))).toEqual({ x: 2, y: 1, width: 1, height: 1 })
    expect(findVisibleBounds(image('f....', '.....', '....g'))).toEqual({ x: 0, y: 0, width: 5, height: 3 })
    expect(findVisibleBounds(image('.....', '.s#s.', '.....'))).toEqual({ x: 1, y: 1, width: 3, height: 1 })
  })

  it('never counts colour hidden under alpha 0, and never reads it', () => {
    expect(findVisibleBounds(image('hHhH', 'HhHh', 'hHhH'))).toBeNull()
    expect(findVisibleBounds(blank(7, 5, [255, 255, 255, 0]))).toBeNull()
    expect(findVisibleBounds(image('HHHHH', 'HHHHH', 'HH#HH', 'HHHHH'))).toEqual({ x: 2, y: 2, width: 1, height: 1 })

    const counted = countingReads(image('hHhHh', 'Hh#hH', 'hHhHh', 'HhHhf'))
    expect(findVisibleBounds(counted.pixels)).toEqual({ x: 2, y: 1, width: 3, height: 3 })
    expect(counted.colourReads()).toBe(0)
    expect(counted.alphaReads()).toBeGreaterThan(0)
  })

  it('returns null for completely transparent images of any size, including 1 × 1', () => {
    for (const [width, height] of [[1, 1], [3, 1], [1, 3], [7, 5]]) {
      expect(findVisibleBounds(blank(width, height))).toBeNull()
      expect(findVisibleBounds(blank(width, height, [12, 34, 56, 0]))).toBeNull()
    }
  })

  it('returns the whole image when it is fully opaque or has content at every edge', () => {
    expect(findVisibleBounds(image('###', '#r#', '###'))).toEqual({ x: 0, y: 0, width: 3, height: 3 })
    expect(findVisibleBounds(image('#'))).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    // A frame around a transparent hole.
    expect(findVisibleBounds(image('#####', '#hhh#', '#hhh#', '#####'))).toEqual({ x: 0, y: 0, width: 5, height: 4 })
    // One pixel at the middle of each edge.
    expect(findVisibleBounds(image('..f..', '.....', 'f...f', '.....', '..f..'))).toEqual({ x: 0, y: 0, width: 5, height: 5 })
  })

  it('finds 1-pixel horizontal and vertical lines, also along the edges', () => {
    const width = 9
    const height = 7
    for (let y = 0; y < height; y++) {
      const line = blank(width, height, [255, 255, 255, 0])
      const points = [2, 3, 4, 5, 6].map((x) => [x, y, PALETTE.f] as const)
      expect(findVisibleBounds(painted(line, ...points))).toEqual({ x: 2, y, width: 5, height: 1 })
    }
    for (let x = 0; x < width; x++) {
      const line = blank(width, height, [255, 255, 255, 0])
      const points = [1, 2, 3, 4].map((y) => [x, y, PALETTE['#']] as const)
      expect(findVisibleBounds(painted(line, ...points))).toEqual({ x, y: 1, width: 1, height: 4 })
    }
    expect(findVisibleBounds(image('#########', '.........'))).toEqual({ x: 0, y: 0, width: 9, height: 1 })
    expect(findVisibleBounds(image('...#', '...#', '...#'))).toEqual({ x: 3, y: 0, width: 1, height: 3 })
  })

  it('spans small islands far apart, whichever row reaches furthest', () => {
    expect(findVisibleBounds(image('f.........', '..........', '..........', '.........f'))).toEqual({ x: 0, y: 0, width: 10, height: 4 })
    expect(findVisibleBounds(image('.........f', '..........', '..........', 'f.........'))).toEqual({ x: 0, y: 0, width: 10, height: 4 })
    // The furthest left and right pixels lie in rows between the top and bottom rows.
    expect(
      findVisibleBounds(
        image(
          '..........',
          '....#.....',
          '..........',
          '.........f',
          '..........',
          'g.........',
          '..........',
          '.....#....',
          '..........',
        ),
      ),
    ).toEqual({ x: 0, y: 1, width: 10, height: 7 })
    // Widest in the middle, as a disc is.
    expect(findVisibleBounds(image('.......', '...#...', '..###..', '.#####.', '..###..', '...#...', '.......'))).toEqual({
      x: 1,
      y: 1,
      width: 5,
      height: 5,
    })
  })

  it('finds content touching each edge', () => {
    expect(findVisibleBounds(image('.....', '##...', '#....', '.....'))).toEqual({ x: 0, y: 1, width: 2, height: 2 })
    expect(findVisibleBounds(image('.....', '...##', '....#', '.....'))).toEqual({ x: 3, y: 1, width: 2, height: 2 })
    expect(findVisibleBounds(image('.##..', '..#..', '.....', '.....'))).toEqual({ x: 1, y: 0, width: 2, height: 2 })
    expect(findVisibleBounds(image('.....', '.....', '..#..', '.##..'))).toEqual({ x: 1, y: 2, width: 2, height: 2 })
  })

  it('ignores transparent holes inside the content', () => {
    expect(findVisibleBounds(image('.......', '.#####.', '.#hhh#.', '.#h.h#.', '.#####.', '.......'))).toEqual({
      x: 1,
      y: 1,
      width: 5,
      height: 4,
    })
  })

  it('includes partially transparent and anti-aliased pixels at the outside of the content', () => {
    const soft = image(
      '.........',
      '...fgf...',
      '..gs#sg..',
      '.fs###sf.',
      '..gs#sg..',
      '...fgf...',
      '.........',
    )
    expect(findVisibleBounds(soft)).toEqual({ x: 1, y: 1, width: 7, height: 5 })
  })

  it('counts only alpha above the threshold as visible', () => {
    // Alpha 1 (f), 8 (g), 128 (s) and 255 (#), each furthest out on one side.
    const layered = image('...f...', '.......', '..g#...', '.......', '...#..s', '.......', '...#...')
    expect(findVisibleBounds(layered, 0)).toEqual({ x: 2, y: 0, width: 5, height: 7 })
    expect(findVisibleBounds(layered, 1)).toEqual({ x: 2, y: 2, width: 5, height: 5 })
    expect(findVisibleBounds(layered, 7)).toEqual({ x: 2, y: 2, width: 5, height: 5 })
    // Alpha equal to the threshold is not above it.
    expect(findVisibleBounds(layered, 8)).toEqual({ x: 3, y: 2, width: 4, height: 5 })
    expect(findVisibleBounds(layered, 127)).toEqual({ x: 3, y: 2, width: 4, height: 5 })
    expect(findVisibleBounds(layered, 128)).toEqual({ x: 3, y: 2, width: 1, height: 5 })
    expect(findVisibleBounds(layered, MAX_ALPHA_THRESHOLD)).toEqual({ x: 3, y: 2, width: 1, height: 5 })
    expect(findVisibleBounds(image('fgs', 'gfs'), 128)).toBeNull()
  })

  it('handles very wide and very tall images, up to the largest side allowed', () => {
    const side = 16_384
    const wide = blank(side, 1, [1, 2, 3, 0])
    expect(findVisibleBounds(wide)).toBeNull()
    expect(findVisibleBounds(painted(wide, [side - 1, 0, PALETTE.f]))).toEqual({ x: side - 1, y: 0, width: 1, height: 1 })
    expect(findVisibleBounds(painted(wide, [0, 0, PALETTE.f], [side - 1, 0, PALETTE.f]))).toEqual({ x: 0, y: 0, width: side, height: 1 })
    const tall = blank(1, side, [1, 2, 3, 0])
    expect(findVisibleBounds(tall)).toBeNull()
    expect(findVisibleBounds(painted(tall, [0, side - 1, PALETTE.f]))).toEqual({ x: 0, y: side - 1, width: 1, height: 1 })
    expect(findVisibleBounds(painted(tall, [0, 7, PALETTE['#']], [0, 9000, PALETTE.s]))).toEqual({ x: 0, y: 7, width: 1, height: 8994 })
  })

  it('agrees with a per-pixel reference on random images and thresholds', () => {
    const random = randomSource(1010)
    for (let n = 0; n < 600; n++) {
      const pixels = randomImage(random)
      const threshold = randomThreshold(random)
      expect(findVisibleBounds(pixels, threshold), `case ${n}, threshold ${threshold}`).toEqual(referenceBounds(pixels, threshold))
    }
  })

  it('does not read the content once its extent is known', () => {
    // Fully opaque: the first row from both ends and the last row's first pixel; nothing else.
    const solid = countingReads(createPixelBuffer(300, 200, new Uint8ClampedArray(300 * 200 * 4).fill(255)))
    expect(findVisibleBounds(solid.pixels)).toEqual({ x: 0, y: 0, width: 300, height: 200 })
    expect(solid.alphaReads()).toBeLessThanOrEqual(4)

    // A block in the middle of a transparent border: the border plus at most two reads per row.
    const width = 200
    const height = 120
    const block = new Uint8ClampedArray(width * height * 4)
    for (let y = 30; y < 90; y++) block.fill(255, (y * width + 50) * 4, (y * width + 150) * 4)
    const framed = countingReads(createPixelBuffer(width, height, block))
    expect(findVisibleBounds(framed.pixels)).toEqual({ x: 50, y: 30, width: 100, height: 60 })
    const border = width * height - 100 * 60
    expect(framed.alphaReads()).toBeGreaterThanOrEqual(border)
    expect(framed.alphaReads()).toBeLessThanOrEqual(border + 2 * height)
    expect(framed.colourReads()).toBe(0)

    // Fully transparent: every alpha byte once, no colour byte.
    const empty = countingReads(blank(width, height, [255, 255, 255, 0]))
    expect(findVisibleBounds(empty.pixels)).toBeNull()
    expect(empty.alphaReads()).toBe(width * height)
    expect(empty.colourReads()).toBe(0)
  })

  it('reads each pixel at most about once, for any content', () => {
    const random = randomSource(77)
    for (let n = 0; n < 200; n++) {
      const pixels = randomImage(random)
      const counted = countingReads(pixels)
      findVisibleBounds(counted.pixels, randomThreshold(random))
      expect(counted.alphaReads()).toBeLessThanOrEqual(pixels.width * pixels.height + 2 * pixels.height)
      expect(counted.colourReads()).toBe(0)
    }
  })

  it('never writes the pixels', () => {
    const pixels = image('hH#', 'fs.', 'Hhg')
    const before = Array.from(pixels.data)
    for (let threshold = 0; threshold <= MAX_ALPHA_THRESHOLD; threshold += 50) findVisibleBounds(pixels, threshold)
    expect(Array.from(pixels.data)).toEqual(before)
  })

  it('rejects invalid pixel buffers and thresholds before reading any pixel', () => {
    const data = new Uint8ClampedArray(16)
    expect(() => findVisibleBounds({ width: 0, height: 4, data: new Uint8ClampedArray(0) })).toThrow(RangeError)
    expect(() => findVisibleBounds({ width: -2, height: -2, data })).toThrow(RangeError)
    expect(() => findVisibleBounds({ width: 1.5, height: 2, data: new Uint8ClampedArray(12) })).toThrow(RangeError)
    expect(() => findVisibleBounds({ width: Number.NaN, height: 1, data })).toThrow(RangeError)
    expect(() => findVisibleBounds({ width: 2, height: 3, data })).toThrow(RangeError)
    expect(() => findVisibleBounds({ width: 1, height: 1, data: new Uint8ClampedArray(new ArrayBuffer(8), 1, 4) })).toThrow(RangeError)

    const counted = countingReads(createPixelBuffer(2, 2, data))
    for (const threshold of [-1, 255, 256, 0.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => findVisibleBounds(counted.pixels, threshold), String(threshold)).toThrow(RangeError)
    }
    expect(counted.alphaReads() + counted.colourReads()).toBe(0)
  })
})

describe('planAutoTrim', () => {
  // 20 × 16 with content at x 6–9, y 5–7.
  const content = (): PixelBuffer => {
    const rows: string[] = []
    for (let y = 0; y < 16; y++) rows.push(y >= 5 && y <= 7 ? 'hhhhhh#ss#hhhhhhhhhh' : 'hhhhhhhhhhhhhhhhhhhh')
    return image(...rows)
  }

  it('keeps the visible bounds with the padding on each side', () => {
    const pixels = content()
    const visible = { x: 6, y: 5, width: 4, height: 3 }
    expect(planAutoTrim(pixels, { padding: 0 })).toEqual({ kind: 'crop', visible, kept: visible })
    expect(planAutoTrim(pixels, { padding: 1 })).toEqual({ kind: 'crop', visible, kept: { x: 5, y: 4, width: 6, height: 5 } })
    expect(planAutoTrim(pixels, { padding: 3 })).toEqual({ kind: 'crop', visible, kept: { x: 3, y: 2, width: 10, height: 9 } })
  })

  it('clips the padding at each edge on its own, never beyond the image', () => {
    const pixels = content()
    const visible = { x: 6, y: 5, width: 4, height: 3 }
    // Left 6 and top 5 available: padding 5 reaches the top edge only.
    expect(planAutoTrim(pixels, { padding: 5 })).toEqual({ kind: 'crop', visible, kept: { x: 1, y: 0, width: 14, height: 13 } })
    // Padding 7: left and top clipped at 0; right (10 available) and bottom (8 available) not yet.
    expect(planAutoTrim(pixels, { padding: 7 })).toEqual({ kind: 'crop', visible, kept: { x: 0, y: 0, width: 17, height: 15 } })
    // Padding 8: only the right side still has room.
    expect(planAutoTrim(pixels, { padding: 8 })).toEqual({ kind: 'crop', visible, kept: { x: 0, y: 0, width: 18, height: 16 } })
    expect(planAutoTrim(pixels, { padding: 10 })).toEqual({ kind: 'unchanged', visible })
    expect(planAutoTrim(pixels, { padding: Number.MAX_SAFE_INTEGER })).toEqual({ kind: 'unchanged', visible })
  })

  it('keeps no padding on a side the content touches, and the padding on the others', () => {
    // 9 × 7 images, padding 2: only the side the content touches loses its padding.
    const empty = '.........'
    const sides: readonly [name: string, rows: readonly string[], kept: Rectangle][] = [
      ['left', [empty, empty, empty, '##.......', empty, empty, empty], { x: 0, y: 1, width: 4, height: 5 }],
      ['right', [empty, empty, empty, '.......##', empty, empty, empty], { x: 5, y: 1, width: 4, height: 5 }],
      ['top', ['....#....', '....#....', empty, empty, empty, empty, empty], { x: 2, y: 0, width: 5, height: 4 }],
      ['bottom', [empty, empty, empty, empty, empty, '....#....', '....#....'], { x: 2, y: 3, width: 5, height: 4 }],
    ]
    for (const [name, rows, kept] of sides) {
      expect(cropPlan(planAutoTrim(image(...rows), { padding: 2 })).kept, name).toEqual(kept)
    }
  })

  it('changes nothing when there is no removable border', () => {
    const unchanged = (pixels: PixelBuffer, padding: number) => planAutoTrim(pixels, { padding }).kind
    for (const padding of [0, 1, 5, 20]) {
      expect(unchanged(image('###', '#r#', '###'), padding)).toBe('unchanged')
      expect(unchanged(image('#'), padding)).toBe('unchanged')
      expect(unchanged(image('f..', '...', '..f'), padding)).toBe('unchanged')
      expect(unchanged(image('.f.', 'f.f', '.f.'), padding)).toBe('unchanged')
      expect(unchanged(image('#hh#'), padding)).toBe('unchanged')
    }
    // The padding itself reaches every edge.
    expect(unchanged(image('.....', '.....', '..#..', '.....', '.....'), 2)).toBe('unchanged')
    expect(unchanged(image('.....', '.....', '..#..', '.....', '.....'), 1)).toBe('crop')
  })

  it('reports nothing visible for transparent images, with no rectangle at all', () => {
    for (const pixels of [blank(1, 1), blank(1, 1, [255, 255, 255, 0]), blank(40, 30, [200, 100, 50, 0]), image('hH', 'Hh')]) {
      for (const padding of [0, 5]) expect(planAutoTrim(pixels, { padding })).toStrictEqual({ kind: 'nothing-visible' })
    }
    // Content only below the threshold is not visible.
    expect(planAutoTrim(image('..f', 'g..'), { padding: 0, alphaThreshold: 8 })).toStrictEqual({ kind: 'nothing-visible' })
  })

  it('trims all four sides at once, by different amounts', () => {
    const pixels = image(
      '.........',
      '.........',
      '.........',
      '......#..',
      '.....s...',
      '.........',
    )
    expect(planAutoTrim(pixels, { padding: 0 })).toEqual({
      kind: 'crop',
      visible: { x: 5, y: 3, width: 2, height: 2 },
      kept: { x: 5, y: 3, width: 2, height: 2 },
    })
    expect(cropPlan(planAutoTrim(pixels, { padding: 1 })).kept).toEqual({ x: 4, y: 2, width: 4, height: 4 })
  })

  it('gives valid, tight geometry for random images, paddings and thresholds', () => {
    const random = randomSource(2024)
    let cropCount = 0
    for (let n = 0; n < 600; n++) {
      const pixels = randomImage(random)
      const padding = randomInt(random, 4) === 0 ? randomInt(random, 40) : randomInt(random, 6)
      const threshold = randomThreshold(random)
      const plan = planAutoTrim(pixels, { padding, alphaThreshold: threshold })
      const visible = referenceBounds(pixels, threshold)
      const label = `case ${n}, padding ${padding}, threshold ${threshold}`
      if (!visible) {
        expect(plan, label).toStrictEqual({ kind: 'nothing-visible' })
        continue
      }
      expect(plan.kind, label).not.toBe('nothing-visible')
      if (plan.kind === 'nothing-visible') continue
      expect(plan.visible, label).toEqual(visible)
      const left = Math.min(padding, visible.x)
      const top = Math.min(padding, visible.y)
      const right = Math.min(padding, pixels.width - visible.x - visible.width)
      const bottom = Math.min(padding, pixels.height - visible.y - visible.height)
      const expected = { x: visible.x - left, y: visible.y - top, width: visible.width + left + right, height: visible.height + top + bottom }
      if (plan.kind === 'unchanged') {
        expect(expected, label).toEqual({ x: 0, y: 0, width: pixels.width, height: pixels.height })
        continue
      }
      cropCount++
      const { kept } = plan
      expect(kept, label).toEqual(expected)
      expect(Number.isInteger(kept.x) && Number.isInteger(kept.y) && kept.width >= 1 && kept.height >= 1, label).toBe(true)
      expect(kept.x >= 0 && kept.y >= 0 && kept.x + kept.width <= pixels.width && kept.y + kept.height <= pixels.height, label).toBe(true)
      expect(kept.width < pixels.width || kept.height < pixels.height, label).toBe(true)
    }
    expect(cropCount).toBeGreaterThan(200)
  })

  it('cuts away faint pixels only when a threshold above 0 is asked for', () => {
    // A solid shape with a soft shadow (alpha 1–8) reaching two pixels further right and down.
    const shadowed = image(
      '..........',
      '.##.......',
      '.##fg.....',
      '..ggff....',
      '...f......',
      '..........',
    )
    expect(planAutoTrim(shadowed, { padding: 0 })).toEqual({
      kind: 'crop',
      visible: { x: 1, y: 1, width: 5, height: 4 },
      kept: { x: 1, y: 1, width: 5, height: 4 },
    })
    // Threshold 8: the shadow no longer counts, and the trim would remove the part outside the shape.
    const tight = cropPlan(planAutoTrim(shadowed, { padding: 0, alphaThreshold: 8 }))
    expect(tight.kept).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    const result = trimmed(autoTrimPixels(shadowed, { padding: 0, alphaThreshold: 8 }))
    expect(visiblePixels(result.pixels).length).toBe(4)
    expect(visiblePixels(shadowed).length).toBe(11)
  })

  it('treats an image already trimmed with the same padding or more as unchanged, and trims it further with less', () => {
    const random = randomSource(31)
    for (let n = 0; n < 300; n++) {
      const pixels = randomImage(random)
      const padding = randomInt(random, 6)
      const first = autoTrimPixels(pixels, { padding })
      if (first.kind !== 'crop') continue
      const label = `case ${n}, padding ${padding}`
      expect(planAutoTrim(first.pixels, { padding }).kind, label).toBe('unchanged')
      expect(planAutoTrim(first.pixels, { padding: padding + 3 }).kind, label).toBe('unchanged')
      // Trimming again with less padding gives what trimming the original with it gives.
      const less = randomInt(random, padding + 1)
      const again = autoTrimPixels(first.pixels, { padding: less })
      const direct = autoTrimPixels(pixels, { padding: less })
      const finalPixels = (result: AutoTrimResult, fallback: PixelBuffer) => (result.kind === 'crop' ? result.pixels : fallback)
      expect(Array.from(finalPixels(again, first.pixels).data), label).toEqual(Array.from(finalPixels(direct, pixels).data))
    }
  })

  it('rejects invalid padding and thresholds before reading any pixel', () => {
    const counted = countingReads(image('.#.', '...'))
    for (const padding of [-1, -0.5, 0.5, 2.25, Number.NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(() => planAutoTrim(counted.pixels, { padding }), String(padding)).toThrow(RangeError)
    }
    for (const alphaThreshold of [-1, 255, 1.5, Number.NaN, Infinity]) {
      expect(() => planAutoTrim(counted.pixels, { padding: 0, alphaThreshold }), String(alphaThreshold)).toThrow(RangeError)
    }
    expect(counted.alphaReads() + counted.colourReads()).toBe(0)
    expect(() => planAutoTrim({ width: 3, height: 3, data: new Uint8ClampedArray(12) }, { padding: 0 })).toThrow(RangeError)
  })
})

describe('autoTrimPixels', () => {
  it('crops to the kept rectangle with every byte as it was, hidden colour included', () => {
    const pixels = image(
      'hhHHhhHHhh',
      'hHhH#rhHhh',
      'hhH#HHs#Hh',
      'Hh#hf.hH#h',
      'hhHgrrgHhH',
      'HHhhHhHhhh',
      'hhhHHHhhhh',
    )
    for (const padding of [0, 1]) {
      const result = trimmed(autoTrimPixels(pixels, { padding }))
      expect(result.pixels.width).toBe(result.kept.width)
      expect(result.pixels.height).toBe(result.kept.height)
      expect(Array.from(result.pixels.data), `padding ${padding}`).toEqual(referenceCrop(pixels, result.kept))
    }
    // Padding 2 reaches every edge.
    expect(autoTrimPixels(pixels, { padding: 2 }).kind).toBe('unchanged')
    // The hidden colours inside the kept rectangle are still there: transparent red, then white.
    const tight = trimmed(autoTrimPixels(pixels, { padding: 0 }))
    expect(tight.kept).toEqual({ x: 2, y: 1, width: 7, height: 4 })
    expect(Array.from(tight.pixels.data.subarray(0, 8))).toEqual([255, 0, 0, 0, 255, 255, 255, 0])
  })

  it('keeps every visible pixel, byte for byte, at its place in the kept rectangle', () => {
    const random = randomSource(4242)
    let cropCount = 0
    for (let n = 0; n < 400; n++) {
      const pixels = randomImage(random)
      const padding = randomInt(random, 5)
      const result = autoTrimPixels(pixels, { padding })
      if (result.kind !== 'crop') continue
      cropCount++
      const label = `case ${n}, padding ${padding}`
      expect(visiblePixels(result.pixels), label).toEqual(visiblePixels(pixels, result.kept.x, result.kept.y))
      expect(Array.from(result.pixels.data), label).toEqual(referenceCrop(pixels, result.kept))
    }
    expect(cropCount).toBeGreaterThan(150)
  })

  it('returns new memory of exactly the trimmed size, and never writes the source', () => {
    const pixels = image('hhhhh', 'h#sfh', 'hhgHh', 'hhhhh')
    const before = Array.from(pixels.data)
    const result = trimmed(autoTrimPixels(pixels, { padding: 0 }))
    expect(result.kept).toEqual({ x: 1, y: 1, width: 3, height: 2 })
    expect(result.pixels.data.buffer).not.toBe(pixels.data.buffer)
    expect(result.pixels.data.byteOffset).toBe(0)
    expect(result.pixels.data.buffer.byteLength).toBe(3 * 2 * 4)
    expect(Array.from(pixels.data)).toEqual(before)
  })

  it('crops once with the kept rectangle, and never when nothing changes', () => {
    const result = trimmed(autoTrimPixels(image('...', '.#.', '...'), { padding: 0 }))
    expect(crops).toHaveBeenCalledTimes(1)
    expect(crops.mock.calls[0][1]).toBe(result.kept)

    crops.mockClear()
    expect(autoTrimPixels(image('###'), { padding: 0 })).toStrictEqual({ kind: 'unchanged', visible: { x: 0, y: 0, width: 3, height: 1 } })
    expect(autoTrimPixels(image('...', '.#.', '...'), { padding: 1 })).toStrictEqual({
      kind: 'unchanged',
      visible: { x: 1, y: 1, width: 1, height: 1 },
    })
    expect(autoTrimPixels(blank(50, 40, [9, 9, 9, 0]), { padding: 0 })).toStrictEqual({ kind: 'nothing-visible' })
    expect(crops).not.toHaveBeenCalled()
  })

  it('crops a 1 × 1 result from any image with one visible pixel', () => {
    for (const [x, y] of [[0, 0], [4, 0], [0, 3], [4, 3], [2, 1]]) {
      const pixels = painted(blank(5, 4, [255, 255, 255, 0]), [x, y, PALETTE.f])
      const result = trimmed(autoTrimPixels(pixels, { padding: 0 }))
      expect(result.kept).toEqual({ x, y, width: 1, height: 1 })
      expect(Array.from(result.pixels.data)).toEqual([...PALETTE.f])
    }
  })

  it('keeps 1-pixel lines, a hairline, single pixels and faint edge pixels whole after a Delete', () => {
    const lines = LINES().observed
    const selection = wand(lines, { x: 0, y: 0, tolerance: 20, global: true })
    let faintest = 255
    for (const settings of [{ cleanup: 0, feather: 0 }, { cleanup: 1, feather: 0 }, { cleanup: 0, feather: 2 }, { cleanup: 5, feather: 5 }]) {
      const source = deleteSelectionWithEdges(lines, selection, settings)!.pixels
      const label = `${settings.cleanup} / ${settings.feather}`
      const result = trimmed(autoTrimPixels(source, { padding: 0 }))
      const { kept } = result
      expect(kept, label).toEqual(referenceBounds(source))
      expect(visiblePixels(result.pixels), label).toEqual(visiblePixels(source, kept.x, kept.y))
      // The two single pixels.
      for (const [x, y] of [[50, 10], [60, 12]]) expect(result.pixels.data[((y - kept.y) * kept.width + x - kept.x) * 4 + 3], label).toBe(255)
      for (let p = 3; p < source.data.length; p += 4) if (source.data[p] > 0) faintest = Math.min(faintest, source.data[p])
    }
    // Edge cleanup leaves the anti-aliased pixels partly transparent: kept too.
    expect(faintest).toBeLessThan(128)
  })

  it('trims images after the Magic Wand, Delete Selection, Edge cleanup and Feather, keeping every visible pixel', () => {
    const settings: readonly EdgeSettings[] = [
      { cleanup: 0, feather: 0 },
      { cleanup: 1, feather: 0 },
      { cleanup: 0, feather: 2 },
      { cleanup: 3, feather: 3 },
      { cleanup: 5, feather: 5 },
    ]
    const kinds = new Set<string>()
    for (const edgeCase of edgeCases()) {
      for (const setting of settings) {
        const deleted = deleteSelectionWithEdges(edgeCase.observed, edgeCase.selection, setting)
        if (!deleted) throw new Error(`${edgeCase.name}: nothing deleted`)
        const source = deleted.pixels
        const sourceBytes = Array.from(source.data)
        for (const padding of [0, 5]) {
          const label = `${edgeCase.name}, ${setting.cleanup} / ${setting.feather}, padding ${padding}`
          const result = autoTrimPixels(source, { padding })
          kinds.add(result.kind)
          const visible = referenceBounds(source)
          if (!visible) {
            expect(result.kind, label).toBe('nothing-visible')
            continue
          }
          if (result.kind === 'nothing-visible') throw new Error(`${label}: nothing visible`)
          expect(result.visible, label).toEqual(visible)
          if (result.kind === 'unchanged') continue
          expect(visiblePixels(result.pixels), label).toEqual(visiblePixels(source, result.kept.x, result.kept.y))
          expect(Array.from(result.pixels.data), label).toEqual(referenceCrop(source, result.kept))
        }
        expect(Array.from(source.data)).toEqual(sourceBytes)
      }
    }
    // The fixtures include content touching the border (nothing to trim) and content to trim.
    expect(kinds).toEqual(new Set(['crop', 'unchanged']))
  })
})

describe('Auto Trim on large images', () => {
  // Assertions here never print a pixel buffer: a failure must report, not format 200 MB.
  const summary = (result: AutoTrimResult): AutoTrimPlan => {
    if (result.kind !== 'crop') return result
    return { kind: result.kind, visible: result.visible, kept: result.kept }
  }
  // One buffer for every 50 MP case, so the test holds one large image at a time.
  const MAX_PIXELS = 50_000_000
  let shared: ArrayBuffer | null = null
  /** A w × h image in the shared memory, every pixel `fill` (RGBA). */
  function large(width: number, height: number, fill: Rgba): PixelBuffer {
    shared ??= new ArrayBuffer(MAX_PIXELS * 4)
    const data = new Uint8ClampedArray(shared, 0, width * height * 4)
    const word = new Uint32Array(new Uint8ClampedArray(fill).buffer)[0]
    new Uint32Array(shared, 0, width * height).fill(word)
    return createPixelBuffer(width, height, data)
  }
  const set = (pixels: PixelBuffer, x: number, y: number, colour: Rgba) => (pixels.data as Uint8ClampedArray).set(colour, (y * pixels.width + x) * 4)
  /** Fills x0–x1, y0–y1 (exclusive) with opaque colours that differ from pixel to pixel. */
  function fillVaried(pixels: PixelBuffer, x0: number, y0: number, x1: number, y1: number): void {
    const data = pixels.data as Uint8ClampedArray
    for (let y = y0; y < y1; y++) {
      for (let x = x0, p = (y * pixels.width + x0) * 4; x < x1; x++, p += 4) {
        data[p] = (x * 7) & 255
        data[p + 1] = (y * 3) & 255
        data[p + 2] = (x ^ y) & 255
        data[p + 3] = 255
      }
    }
  }
  /** A cheap fingerprint of every byte, to show the source is not written. */
  function fingerprint(pixels: PixelBuffer): number {
    const words = new Uint32Array(pixels.data.buffer, pixels.data.byteOffset, pixels.width * pixels.height)
    let hash = 0
    for (let i = 0; i < words.length; i++) hash = (Math.imul(hash, 31) + words[i]) | 0
    return hash
  }
  /** Whether the trimmed image holds exactly the source's pixels in `kept`, row by row. */
  function sameAsSource(trimmedPixels: PixelBuffer, source: PixelBuffer, kept: Rectangle): boolean {
    const out = new Uint32Array(trimmedPixels.data.buffer, 0, kept.width * kept.height)
    const src = new Uint32Array(source.data.buffer, source.data.byteOffset, source.width * source.height)
    for (let y = 0; y < kept.height; y++) {
      const from = (kept.y + y) * source.width + kept.x
      const to = y * kept.width
      for (let x = 0; x < kept.width; x++) if (out[to + x] !== src[from + x]) return false
    }
    return true
  }

  const HIDDEN: Rgba = [235, 238, 240, 0]

  it('trims a 50 MP deleted background around content, with faint pixels and a 1-pixel line at the edges', () => {
    const width = 8660
    const height = 5773
    const pixels = large(width, height, HIDDEN)
    fillVaried(pixels, 3000, 2000, 5000, 3500)
    set(pixels, 2500, 4000, [10, 200, 10, 1])
    for (let y = 1000; y < 3000; y++) set(pixels, 6000, y, [0, 0, 0, 255])
    const before = fingerprint(pixels)

    const plan = cropPlan(planAutoTrim(pixels, { padding: 5 }))
    expect(plan.visible).toEqual({ x: 2500, y: 1000, width: 3501, height: 3001 })
    expect(plan.kept).toEqual({ x: 2495, y: 995, width: 3511, height: 3011 })
    const result = trimmed(autoTrimPixels(pixels, { padding: 5 }))
    expect(result.pixels.data.byteLength).toBe(3511 * 3011 * 4)
    expect(sameAsSource(result.pixels, pixels, result.kept)).toBe(true)
    expect(fingerprint(pixels)).toBe(before)
  })

  it('handles 50 MP images that are fully transparent, fully opaque, or two pixels far apart', () => {
    const width = 8660
    const height = 5773
    expect(summary(autoTrimPixels(large(width, height, HIDDEN), { padding: 5 }))).toStrictEqual({ kind: 'nothing-visible' })
    expect(summary(autoTrimPixels(large(width, height, [20, 40, 60, 255]), { padding: 0 }))).toStrictEqual({
      kind: 'unchanged',
      visible: { x: 0, y: 0, width, height },
    })
    const sparse = large(width, height, HIDDEN)
    set(sparse, 1, 1, [0, 0, 0, 1])
    set(sparse, width - 2, height - 2, [0, 0, 0, 1])
    expect(planAutoTrim(sparse, { padding: 0 })).toEqual({
      kind: 'crop',
      visible: { x: 1, y: 1, width: width - 2, height: height - 2 },
      kept: { x: 1, y: 1, width: width - 2, height: height - 2 },
    })
    expect(planAutoTrim(sparse, { padding: 1 }).kind).toBe('unchanged')
    expect(crops.mock.calls.length).toBe(0)
  })

  it('trims the widest and tallest images allowed', () => {
    const wide = large(16_384, 3051, HIDDEN)
    for (let y = 3000; y < 3051; y++) for (let x = 16_000; x < 16_384; x++) set(wide, x, y, [255, 0, 0, 200])
    const wideResult = trimmed(autoTrimPixels(wide, { padding: 20 }))
    expect(wideResult.kept).toEqual({ x: 15_980, y: 2980, width: 404, height: 71 })
    expect(sameAsSource(wideResult.pixels, wide, wideResult.kept)).toBe(true)

    const tall = large(3051, 16_384, HIDDEN)
    for (let y = 9; y < 12; y++) for (let x = 0; x < 2; x++) set(tall, x, y, [0, 0, 255, 255])
    const tallResult = trimmed(autoTrimPixels(tall, { padding: 10 }))
    expect(tallResult.kept).toEqual({ x: 0, y: 0, width: 12, height: 22 })
    expect(sameAsSource(tallResult.pixels, tall, tallResult.kept)).toBe(true)
  })
})
