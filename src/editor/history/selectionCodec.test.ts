import { describe, expect, it } from 'vitest'
import { createSelectionMask } from '../../image/selection/selectionMask'
import { selectAll } from '../../image/selection/selectionOperations'
import { maskBytes, maskRows } from '../../image/selection/testFixtures'
import type { SelectionMask } from '../types'
import { type EncodedSelection, decodeSelection, encodeSelection } from './selectionCodec'

/** Deterministic pseudo-random numbers in [0, 1). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

function mask(...rows: string[]): SelectionMask {
  const { width, height, data } = maskBytes(...rows)
  const selection = createSelectionMask(width, height, data)
  if (!selection) throw new Error('Test mask selects nothing')
  return selection
}

function fromPredicate(width: number, height: number, selected: (x: number, y: number) => boolean): SelectionMask {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = selected(x, y) ? 1 : 0
  return createSelectionMask(width, height, data)!
}

/** Exactly the same selection: size, every pixel, count and bounds. */
function sameSelection(a: SelectionMask | null, b: SelectionMask | null): boolean {
  if (!a || !b) return a === b
  if (a.width !== b.width || a.height !== b.height || a.count !== b.count) return false
  if (JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

const roundTrip = (selection: SelectionMask | null) => decodeSelection(encodeSelection(selection))

describe('encodeSelection and decodeSelection', () => {
  it('keep no selection as null', () => {
    expect(encodeSelection(null)).toBeNull()
    expect(decodeSelection(null)).toBeNull()
  })

  it('restore small selections exactly: single pixels, rings with holes, edges and 1 × 1 images', () => {
    for (const selection of [
      mask('#'),
      mask('...', '.#.', '...'),
      mask('#####', '#...#', '#.#.#', '#...#', '#####'),
      mask('#....', '.....', '....#'),
      mask('##..##', '......', '##..##'),
      mask('.#.', '###', '.#.'),
    ]) {
      const decoded = roundTrip(selection)
      expect(sameSelection(decoded, selection), maskRows(selection).join('/')).toBe(true)
    }
  })

  it('store only the bounds, as runs that may continue onto the next row', () => {
    const full = selectAll(1000, 800)
    const encoded = encodeSelection(full)!
    // One empty unselected run, then 800,000 selected pixels: 1 + 3 bytes.
    expect(encoded).toMatchObject({ kind: 'selection', format: 'runs', count: 800_000, bounds: full.bounds })
    expect(Array.from(encoded.data)).toEqual([0, 0x80 | (800_000 % 128), 0x80 | (Math.floor(800_000 / 128) % 128), Math.floor(800_000 / 16384)])
    expect(sameSelection(decodeSelection(encoded), full)).toBe(true)

    // A 20 × 20 block: bounds of 400 pixels, all selected (bits would take 50 bytes).
    const block = fromPredicate(30, 30, (x, y) => x >= 5 && x < 25 && y >= 3 && y < 23)
    expect(Array.from(encodeSelection(block)!.data)).toEqual([0, 0x80 | (400 % 128), Math.floor(400 / 128)])
    // Tiny bounds pack into fewer bytes as bits.
    expect(encodeSelection(mask('.....', '.##..', '.##..', '.....'))).toMatchObject({ format: 'bits', data: Uint8Array.from([0b1111]) })
  })

  it('choose runs for smooth selections and packed bits for noisy ones, whichever is smaller', () => {
    const random = randomSource(1)
    const disc = fromPredicate(500, 400, (x, y) => (x - 250) ** 2 + (y - 200) ** 2 < 150 ** 2)
    const noise = fromPredicate(500, 400, () => random() < 0.5)
    const dots = fromPredicate(500, 400, (x, y) => x % 40 === 0 && y % 40 === 0)
    const encodedDisc = encodeSelection(disc)!
    const encodedNoise = encodeSelection(noise)!
    const encodedDots = encodeSelection(dots)!
    expect(encodedDisc.format).toBe('runs')
    // About two runs per row of the disc, 2 bytes each.
    expect(encodedDisc.data.length).toBeLessThan(4 * 300 + 8)
    expect(encodedNoise.format).toBe('bits')
    expect(encodedNoise.data.length).toBe(Math.ceil((noise.bounds.width * noise.bounds.height) / 8))
    expect(encodedDots.format).toBe('runs')
    for (const [selection, encoded] of [[disc, encodedDisc], [noise, encodedNoise], [dots, encodedDots]] as const) {
      expect(encoded.data.length).toBeLessThanOrEqual(Math.ceil((selection.bounds.width * selection.bounds.height) / 8))
      expect(sameSelection(decodeSelection(encoded), selection)).toBe(true)
    }
  })

  it('return masks the caller owns, sharing no memory with the original or each other', () => {
    const selection = mask('.##.', '#..#', '.##.')
    const before = Array.from(selection.data)
    const encoded = encodeSelection(selection)!
    expect(encoded.data.buffer).not.toBe(selection.data.buffer)
    expect(Array.from(selection.data)).toEqual(before)
    const a = decodeSelection(encoded)!
    const b = decodeSelection(encoded)!
    expect(a.data.buffer).not.toBe(b.data.buffer)
    expect(a.bounds).not.toBe(encoded.bounds)
    a.data.fill(0)
    expect(sameSelection(b, selection)).toBe(true)
    expect(sameSelection(decodeSelection(encoded), selection)).toBe(true)
  })

  it('reject malformed encodings', () => {
    // A 16 × 6 block in a 20 × 10 image: runs [0, 96].
    const smooth = encodeSelection(fromPredicate(20, 10, (x, y) => x >= 2 && x < 18 && y >= 2 && y < 8))!
    const noisy = encodeSelection(fromPredicate(16, 16, (x, y) => (x * 7 + y * 13) % 3 === 0))!
    expect(smooth.format).toBe('runs')
    expect(noisy.format).toBe('bits')
    const malformed: [string, EncodedSelection][] = [
      ['another kind', { ...smooth, kind: 'pixel-patch' } as unknown as EncodedSelection],
      ['unknown format', { ...smooth, format: 'png' } as unknown as EncodedSelection],
      ['invalid size', { ...smooth, width: 0 }],
      ['bounds outside the image', { ...smooth, bounds: { x: 10, y: 2, width: 16, height: 6 } }],
      ['count of 0', { ...smooth, count: 0 }],
      ['wrong count', { ...smooth, count: 95 }],
      // Runs that cover the larger bounds, but leave its first column unselected.
      ['bounds larger than the selection', { ...smooth, bounds: { x: 1, y: 2, width: 17, height: 6 }, data: Uint8Array.from([1, 16, 1, 16, 1, 16, 1, 16, 1, 16, 1, 16]) }],
      ['runs ending inside a number', { ...smooth, data: Uint8Array.from([0, 0x88]) }],
      ['runs longer than the bounds', { ...smooth, data: Uint8Array.from([0, 97]) }],
      ['runs shorter than the bounds', { ...smooth, data: Uint8Array.from([0, 95]) }],
      ['a run of length 0 after the first', { ...smooth, data: Uint8Array.from([0, 48, 0, 48]) }],
      ['an overlong number', { ...smooth, data: Uint8Array.from([0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]) }],
      ['bits of the wrong length', { ...noisy, data: noisy.data.subarray(1) }],
      ['bits set beyond the bounds', { ...encodeSelection(mask('#.#'))!, format: 'bits', data: Uint8Array.from([0b1101]) }],
    ]
    for (const [name, candidate] of malformed) {
      expect(() => decodeSelection(candidate), name).toThrow(RangeError)
    }
  })

  it('reject masks whose data or bounds do not fit their size', () => {
    const selection = mask('.#.', '##.')
    expect(() => encodeSelection({ ...selection, data: new Uint8Array(5) })).toThrow(RangeError)
    expect(() => encodeSelection({ ...selection, bounds: { x: 1, y: 0, width: 3, height: 2 } })).toThrow(RangeError)
  })

  it('agree with the original on random masks of odd sizes, densities and buffer offsets', () => {
    const random = randomSource(42)
    const failures: string[] = []
    const formats = new Set<string>()
    for (const [width, height] of [[1, 1], [1, 9], [9, 1], [3, 5], [13, 11], [40, 3], [17, 17], [64, 64]]) {
      for (let trial = 0; trial < 25; trial++) {
        const offset = trial % 5
        const data = new Uint8Array(width * height + offset).subarray(offset)
        const kind = trial % 3
        const density = random()
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            // Noise, horizontal stripes of random length, or a blob.
            const on = kind === 0 ? random() < density : kind === 1 ? (x + y * 3) % (2 + (trial % 7)) < 2 : (x - width / 2) ** 2 + (y - height / 2) ** 2 < density * width * height / 3
            data[y * width + x] = on ? 1 : 0
          }
        }
        const selection = createSelectionMask(width, height, data)
        const encoded = encodeSelection(selection)
        if (encoded) formats.add(encoded.format)
        if (!sameSelection(decodeSelection(encoded), selection)) failures.push(`${width} × ${height}, trial ${trial}`)
      }
    }
    expect(failures).toEqual([])
    expect(formats).toEqual(new Set(['runs', 'bits']))
  })
})

describe('encoded selections of 50-megapixel images', () => {
  it('store a large smooth selection in kilobytes and restore it exactly', () => {
    const width = 8660
    const height = 5773
    // The background around a rectangular object with a round hole: what a Delete might use.
    const data = new Uint8Array(width * height).fill(1)
    for (let y = 1500; y < 4300; y++) data.fill(0, y * width + 2000, y * width + 6600)
    for (let y = 2700; y < 3100; y++) data.fill(1, y * width + 4100, y * width + 4500)
    const selection = createSelectionMask(width, height, data)!
    const encoded = encodeSelection(selection)!
    expect(encoded.format).toBe('runs')
    expect(encoded.data.byteLength).toBeLessThan(32 * 1024)
    expect(encoded.data.buffer.byteLength).toBe(encoded.data.byteLength)
    expect(sameSelection(decodeSelection(encoded), selection)).toBe(true)
  })
})
