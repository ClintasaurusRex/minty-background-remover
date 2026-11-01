import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PixelBuffer, Rectangle, SelectionMask } from '../../editor/types'
import { fakeImageData } from '../import/testFixtures'
import { copyPixelData, createPixelBuffer, sharesPixelMemory } from '../pixelBuffer'
import { createSelectionMask } from '../selection/selectionMask'
import { selectAll } from '../selection/selectionOperations'
import { type Rgba, imageFromRows, maskBytes } from '../selection/testFixtures'
import { type DeleteSelectionResult, deleteSelectedPixels } from './deleteSelection'

// Counts full-image copies: Delete makes exactly one, and only when a pixel changes.
vi.mock('../pixelBuffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pixelBuffer')>()
  return { ...actual, copyPixelData: vi.fn(actual.copyPixelData) }
})
const copies = vi.mocked(copyPixelData)

beforeEach(() => {
  copies.mockClear()
})

/**
 * Lower case: pixels as they are. Upper case: the same colour deleted (alpha 0, RGB kept).
 * `t` is transparent black and `h` transparent with a hidden colour, as Delete leaves pixels.
 */
const PALETTE: Readonly<Record<string, Rgba>> = {
  w: [255, 255, 255, 255],
  W: [255, 255, 255, 0],
  r: [220, 30, 30, 255],
  R: [220, 30, 30, 0],
  s: [40, 90, 160, 128],
  S: [40, 90, 160, 0],
  f: [10, 200, 10, 1],
  F: [10, 200, 10, 0],
  t: [0, 0, 0, 0],
  h: [255, 0, 0, 0],
}

const image = (...rows: string[]) => imageFromRows(PALETTE, ...rows)

function mask(...rows: string[]): SelectionMask | null {
  const { width, height, data } = maskBytes(...rows)
  return createSelectionMask(width, height, data)
}

/** Deletes, failing the test if nothing changed. */
function deleted(pixels: PixelBuffer, selection: SelectionMask | null): DeleteSelectionResult {
  const result = deleteSelectedPixels(pixels, selection)
  if (!result) throw new Error('Delete changed nothing')
  return result
}

const bytes = (pixels: PixelBuffer) => Array.from(pixels.data)

/** Deterministic pseudo-random numbers in [0, 1). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

/** Per-pixel reference: what Delete must produce, written as plainly as possible. */
function reference(pixels: PixelBuffer, selection: SelectionMask | null) {
  const { width, height } = pixels
  const data = Array.from(pixels.data)
  let count = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (selection?.data[i] !== 1 || data[i * 4 + 3] === 0) continue
      data[i * 4 + 3] = 0
      count++
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  if (count === 0) return null
  const bounds: Rectangle = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return { data, count, bounds }
}

describe('deleteSelectedPixels', () => {
  it('makes one selected opaque pixel transparent, keeping its colour hidden', () => {
    const result = deleted(image('www', 'wrw', 'www'), mask('...', '.#.', '...'))
    expect(bytes(result.pixels)).toEqual(bytes(image('www', 'wRw', 'www')))
    expect(result).toMatchObject({ count: 1, bounds: { x: 1, y: 1, width: 1, height: 1 } })
    expect(result.pixels).toMatchObject({ width: 3, height: 3 })
  })

  it('deletes several selected pixels, counting and bounding them', () => {
    const block = deleted(image('rrww', 'rrww', 'wwww'), mask('##..', '##..', '....'))
    expect(bytes(block.pixels)).toEqual(bytes(image('RRww', 'RRww', 'wwww')))
    expect(block).toMatchObject({ count: 4, bounds: { x: 0, y: 0, width: 2, height: 2 } })

    const scattered = deleted(image('wwww', 'wwww', 'wwww'), mask('.#..', '...#', '..#.'))
    expect(bytes(scattered.pixels)).toEqual(bytes(image('wWww', 'wwwW', 'wwWw')))
    expect(scattered).toMatchObject({ count: 3, bounds: { x: 1, y: 0, width: 3, height: 3 } })
  })

  it('deletes a fully selected image', () => {
    const all = deleted(image('rws', 'wrf'), selectAll(3, 2))
    expect(bytes(all.pixels)).toEqual(bytes(image('RWS', 'WRF')))
    expect(all).toMatchObject({ count: 6, bounds: { x: 0, y: 0, width: 3, height: 2 } })

    // A transparent margin is selected but does not change, so it is outside the bounds.
    const margin = deleted(image('tttt', 'twrt', 'hhtt'), selectAll(4, 3))
    expect(bytes(margin.pixels)).toEqual(bytes(image('tttt', 'tWRt', 'hhtt')))
    expect(margin).toMatchObject({ count: 2, bounds: { x: 1, y: 1, width: 2, height: 1 } })
  })

  it('deletes disconnected regions and leaves internal holes untouched', () => {
    const result = deleted(
      image('wwwwwww', 'wrwwwww', 'wwwwwww', 'wwwwwww', 'wwwwwww'),
      mask('###....', '#.#..##', '###..##', '.......', '....#..'),
    )
    expect(bytes(result.pixels)).toEqual(bytes(image('WWWwwww', 'WrWwwWW', 'WWWwwWW', 'wwwwwww', 'wwwwWww')))
    expect(result).toMatchObject({ count: 13, bounds: { x: 0, y: 0, width: 7, height: 5 } })
  })

  it('deletes a selection touching every edge of the image', () => {
    const frame = deleted(image('wwwww', 'wrrrw', 'wrrrw', 'wwwww'), mask('#####', '#...#', '#...#', '#####'))
    expect(bytes(frame.pixels)).toEqual(bytes(image('WWWWW', 'WrrrW', 'WrrrW', 'WWWWW')))
    expect(frame).toMatchObject({ count: 14, bounds: { x: 0, y: 0, width: 5, height: 4 } })

    // Each corner on its own.
    const pixels = image('rwwr', 'wwww', 'rwwr')
    for (const [x, y] of [[0, 0], [3, 0], [0, 2], [3, 2]]) {
      const data = new Uint8Array(12)
      data[y * 4 + x] = 1
      const corner = deleted(pixels, createSelectionMask(4, 3, data))
      expect(corner).toMatchObject({ count: 1, bounds: { x, y, width: 1, height: 1 } })
      expect(corner.pixels.data[(y * 4 + x) * 4 + 3]).toBe(0)
    }

    // A whole column at the right edge and a whole row at the bottom.
    expect(deleted(pixels, mask('...#', '...#', '...#'))).toMatchObject({ count: 3, bounds: { x: 3, y: 0, width: 1, height: 3 } })
    expect(deleted(pixels, mask('....', '....', '####'))).toMatchObject({ count: 4, bounds: { x: 0, y: 2, width: 4, height: 1 } })
  })

  it('deletes the only pixel of a 1 × 1 image unless it is already transparent', () => {
    expect(bytes(deleted(image('r'), selectAll(1, 1)).pixels)).toEqual([220, 30, 30, 0])
    expect(bytes(deleted(image('s'), selectAll(1, 1)).pixels)).toEqual([40, 90, 160, 0])
    expect(deleted(image('f'), selectAll(1, 1))).toMatchObject({ count: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } })
    expect(deleteSelectedPixels(image('t'), selectAll(1, 1))).toBeNull()
    expect(deleteSelectedPixels(image('h'), selectAll(1, 1))).toBeNull()
  })

  it('makes opaque and partially transparent pixels transparent, down to alpha 1', () => {
    const result = deleted(image('rsfth'), mask('#####'))
    expect(bytes(result.pixels)).toEqual(bytes(image('RSFth')))
    expect(result).toMatchObject({ count: 3, bounds: { x: 0, y: 0, width: 3, height: 1 } })
  })

  it('keeps the red, green and blue bytes of every deleted pixel', () => {
    const random = randomSource(5)
    const pixels = fakeImageData(16, 9)
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = Math.floor(random() * 256)
    const result = deleted(pixels, selectAll(16, 9))
    for (let i = 0; i < pixels.data.length; i += 4) {
      expect([...result.pixels.data.subarray(i, i + 3)]).toEqual([...pixels.data.subarray(i, i + 3)])
      expect(result.pixels.data[i + 3]).toBe(0)
    }
  })

  it('leaves unselected pixels bit-for-bit identical, including transparent ones with hidden colour', () => {
    const pixels = image('rshtf', 'fthsr', 'wwwww')
    const selection = mask('#.#.#', '.#.#.', '.....')!
    const result = deleted(pixels, selection)
    for (let i = 0; i < 15; i++) {
      const p = i * 4
      const expected = selection.data[i] === 1 ? [...pixels.data.subarray(p, p + 3), 0] : [...pixels.data.subarray(p, p + 4)]
      expect([...result.pixels.data.subarray(p, p + 4)]).toEqual(expected)
    }
  })

  it('never changes the source pixels or the selection, and returns new memory', () => {
    const pixels = image('rwsf', 'wrhw', 'twwr')
    const selection = mask('##..', '.##.', '..##')!
    const pixelBytes = bytes(pixels)
    const maskData = Array.from(selection.data)
    const maskFields = { count: selection.count, bounds: { ...selection.bounds } }

    const first = deleted(pixels, selection)
    const second = deleted(pixels, selection)
    expect(bytes(pixels)).toEqual(pixelBytes)
    expect(Array.from(selection.data)).toEqual(maskData)
    expect(selection).toMatchObject(maskFields)
    expect(sharesPixelMemory(first.pixels, pixels)).toBe(false)
    expect(sharesPixelMemory(first.pixels, second.pixels)).toBe(false)
    expect(bytes(second.pixels)).toEqual(bytes(first.pixels))
  })

  it('copies the image once when pixels change, into memory of exactly the image size', () => {
    // The source lives inside larger memory, as a view.
    const memory = new ArrayBuffer(8 + 2 * 2 * 4 + 8)
    const view = new Uint8ClampedArray(memory, 8, 16)
    view.set(image('rw', 'wr').data)
    const result = deleted(createPixelBuffer(2, 2, view), mask('#.', '..'))
    expect(copies).toHaveBeenCalledTimes(1)
    expect(result.pixels.data.byteOffset).toBe(0)
    expect(result.pixels.data.buffer.byteLength).toBe(16)
    expect(bytes(result.pixels)).toEqual(bytes(image('Rw', 'wr')))
  })

  it('does not count or bound selected pixels that are already fully transparent', () => {
    const result = deleted(image('tthr', 'wtth', 'hhhh'), selectAll(4, 3))
    expect(bytes(result.pixels)).toEqual(bytes(image('tthR', 'Wtth', 'hhhh')))
    expect(result).toMatchObject({ count: 2, bounds: { x: 0, y: 0, width: 4, height: 2 } })

    const inner = deleted(image('hrth', 'tttw'), selectAll(4, 2))
    expect(inner).toMatchObject({ count: 2, bounds: { x: 1, y: 0, width: 3, height: 2 } })
  })

  it('returns null and allocates nothing when no pixel would change', () => {
    const pixels = image('thw', 'htw')
    expect(deleteSelectedPixels(pixels, null)).toBeNull()
    expect(deleteSelectedPixels(pixels, mask('##.', '##.'))).toBeNull()
    expect(copies).not.toHaveBeenCalled()

    // Deleting the same selection again changes nothing.
    const selection = mask('.##', '..#')!
    const once = deleted(pixels, selection)
    copies.mockClear()
    expect(deleteSelectedPixels(once.pixels, selection)).toBeNull()
    expect(copies).not.toHaveBeenCalled()
  })

  it('rejects invalid pixel buffers and selections that do not fit the image', () => {
    const pixels = image('rw', 'wr', 'ww')
    expect(() => deleteSelectedPixels({ width: 2, height: 3, data: new Uint8ClampedArray(23) }, selectAll(2, 3))).toThrow(RangeError)
    expect(() => deleteSelectedPixels({ width: 0, height: 3, data: new Uint8ClampedArray(0) }, null)).toThrow(RangeError)
    // Same number of pixels, other shape.
    expect(() => deleteSelectedPixels(pixels, selectAll(3, 2))).toThrow(RangeError)
    expect(() => deleteSelectedPixels(pixels, selectAll(2, 2))).toThrow(RangeError)
    expect(() => deleteSelectedPixels(pixels, selectAll(2, 4))).toThrow(RangeError)

    // Masks not built by createSelectionMask: wrong length, or bounds outside the image.
    const good = selectAll(2, 3)
    expect(() => deleteSelectedPixels(pixels, { ...good, data: new Uint8Array(5).fill(1) })).toThrow(RangeError)
    for (const bounds of [
      { x: -1, y: 0, width: 2, height: 3 },
      { x: 1, y: 0, width: 2, height: 3 },
      { x: 0, y: 1, width: 2, height: 3 },
      { x: 0, y: 0, width: 0, height: 3 },
      { x: 0.5, y: 0, width: 1, height: 3 },
    ]) {
      expect(() => deleteSelectedPixels(pixels, { ...good, bounds })).toThrow(RangeError)
    }
    expect(copies).not.toHaveBeenCalled()
  })

  it('agrees with a per-pixel reference on random images and masks of odd sizes and offsets', () => {
    const random = randomSource(42)
    const colours = Object.values(PALETTE)
    const failures: string[] = []
    let changedCases = 0
    for (const [width, height] of [[1, 1], [1, 7], [7, 1], [3, 5], [13, 11], [32, 3], [17, 17]]) {
      for (let trial = 0; trial < 25; trial++) {
        // Pixels at a 4-byte-aligned offset in larger memory; the mask at any byte offset.
        const memory = new ArrayBuffer((width * height + 2) * 4)
        const data = new Uint8ClampedArray(memory, 4 * (trial % 3), width * height * 4)
        for (let i = 0; i < width * height; i++) data.set(colours[Math.floor(random() * colours.length)], i * 4)
        const pixels = createPixelBuffer(width, height, data)
        const offset = trial % 5
        const maskData = new Uint8Array(width * height + offset).subarray(offset)
        const density = random()
        for (let i = 0; i < maskData.length; i++) maskData[i] = random() < density ? 1 : 0
        const selection = createSelectionMask(width, height, maskData)

        const before = Array.from(data)
        const result = deleteSelectedPixels(pixels, selection)
        const expected = reference(pixels, selection)
        const same = expected === null ? result === null
          : result !== null && result.count === expected.count &&
            JSON.stringify(result.bounds) === JSON.stringify(expected.bounds) &&
            result.pixels.width === width && result.pixels.height === height &&
            result.pixels.data.every((value, i) => value === expected.data[i])
        if (!same) failures.push(`${width} × ${height}, trial ${trial}`)
        if (data.some((value, i) => value !== before[i])) failures.push(`${width} × ${height}, trial ${trial}: source changed`)
        if (result) changedCases++
      }
    }
    expect(failures).toEqual([])
    // The random cases cover both outcomes.
    expect(changedCases).toBeGreaterThan(100)
    expect(changedCases).toBeLessThan(175)
  })
})

describe('deleteSelectedPixels on large images', () => {
  it('deletes the background of a 4K image around an opaque object, with one copy', () => {
    const width = 3840
    const height = 2160
    const pixels = fakeImageData(width, height)
    const words = new Uint32Array(pixels.data.buffer)
    // Background: two near-white colours; the object: a dark rectangle.
    for (let i = 0; i < words.length; i++) words[i] = i % 7 === 0 ? 0xfff0f0f0 : 0xfffafafa
    const objectRows = [700, 1500]
    const objectColumns = [1200, 2600]
    const background = new Uint8Array(width * height).fill(1)
    for (let y = objectRows[0]; y < objectRows[1]; y++) {
      words.fill(0xff203040, y * width + objectColumns[0], y * width + objectColumns[1])
      background.fill(0, y * width + objectColumns[0], y * width + objectColumns[1])
    }
    const selection = createSelectionMask(width, height, background)!
    const source = pixels.data.slice()

    const result = deleted(pixels, selection)
    expect(copies).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ count: selection.count, bounds: { x: 0, y: 0, width, height } })
    const out = result.pixels.data
    let wrong = 0
    for (let i = 0; i < width * height; i++) {
      const p = i * 4
      const alpha = background[i] === 1 ? 0 : source[p + 3]
      if (out[p] !== source[p] || out[p + 1] !== source[p + 1] || out[p + 2] !== source[p + 2] || out[p + 3] !== alpha) wrong++
    }
    expect(wrong).toBe(0)
    expect(pixels.data.every((value, i) => value === source[i])).toBe(true)
  })

  it('reads only the pixels within the selection bounds', () => {
    const width = 3840
    const height = 2160
    const pixels = fakeImageData(width, height)
    pixels.data.fill(255)
    const data = new Uint8Array(width * height)
    for (let y = 1000; y < 1040; y++) data.fill(1, y * width + 2000, y * width + 2040)
    const selection = createSelectionMask(width, height, data)!
    let reads = 0
    const counted = new Proxy(selection.data, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key)
      },
    })
    const result = deleted(pixels, { ...selection, data: counted })
    expect(result).toMatchObject({ count: 1600, bounds: { x: 2000, y: 1000, width: 40, height: 40 } })
    expect(reads).toBe(40 * 40)
  })

  it('returns null for a 50 MP image with nothing to delete, without copying it', () => {
    const width = 8660
    const height = 5773
    // Fully transparent, as after deleting everything.
    const pixels = createPixelBuffer(width, height, new Uint8ClampedArray(width * height * 4))
    expect(deleteSelectedPixels(pixels, selectAll(width, height))).toBeNull()
    expect(copies).not.toHaveBeenCalled()
  })
})
