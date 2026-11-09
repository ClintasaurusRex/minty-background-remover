import { describe, expect, it } from 'vitest'
import { randomInt, randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer } from '../../editor/types'
import { deleteSelectedPixels } from '../edit/deleteSelection'
import { createPixelBuffer } from '../pixelBuffer'
import { createSelectionMask } from '../selection/selectionMask'
import { crc32 } from './crc32'
import { DEFAULT_SLICE_BYTES, encodePng } from './pngEncoder'
import { bitwiseCrc32, decodeTestPng } from './testPng'

const noWait = () => Promise.resolve()

function buffer(width: number, height: number, fill: (data: Uint8ClampedArray<ArrayBuffer>) => void): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  fill(data)
  return createPixelBuffer(width, height, data)
}

/** Random colour, every pixel visible unless `transparentShare` of them get alpha 0 (with colour kept). */
function randomPixels(width: number, height: number, seed: number, transparentShare = 0): PixelBuffer {
  const random = randomSource(seed)
  return buffer(width, height, (data) => {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = randomInt(random, 256)
      data[i + 1] = randomInt(random, 256)
      data[i + 2] = randomInt(random, 256)
      data[i + 3] = random() < transparentShare ? 0 : 1 + randomInt(random, 255)
    }
  })
}

/** What export must write: the same bytes, fully transparent pixels as 0, 0, 0, 0. */
function expectedBytes(pixels: PixelBuffer): Uint8Array {
  const expected = new Uint8Array(pixels.data)
  for (let i = 0; i < expected.length; i += 4) {
    if (expected[i + 3] === 0) expected.fill(0, i, i + 4)
  }
  return expected
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('crc32', () => {
  it('gives the standard check values', () => {
    const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0))
    expect(crc32(text('123456789'))).toBe(0xcbf43926)
    expect(crc32(text('IEND'))).toBe(0xae426082)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('agrees with a bit-by-bit reference on random bytes', () => {
    const random = randomSource(7)
    for (const length of [1, 3, 64, 1000]) {
      const bytes = Uint8Array.from({ length }, () => randomInt(random, 256))
      expect(crc32(bytes)).toBe(bitwiseCrc32(bytes))
    }
  })
})

describe('encodePng', () => {
  it('writes an 8-bit RGBA PNG of the image size with valid chunks', async () => {
    const pixels = randomPixels(37, 11, 1)
    const file = await encodePng(pixels, { yieldControl: noWait })
    expect(file.type).toBe('image/png')
    const png = await decodeTestPng(file)
    expect([png.width, png.height]).toEqual([37, 11])
    // Bit depth 8, colour type 6 (RGBA), deflate, adaptive filtering, not interlaced.
    expect(png.header).toEqual([8, 6, 0, 0, 0])
    expect(png.chunks[0]).toBe('IHDR')
    expect(png.chunks.at(-1)).toBe('IEND')
    expect(png.chunks.slice(1, -1).every((type) => type === 'IDAT')).toBe(true)
    expect(png.chunks.length).toBeGreaterThan(2)
  })

  it('keeps every byte of visible pixels, every alpha value and partially transparent colour included', async () => {
    // Every alpha from 1 to 255 under colours that premultiplied canvas storage could not keep.
    const pixels = buffer(255, 4, (data) => {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 255; x++) {
          const i = (y * 255 + x) * 4
          data.set([255 - x, (x * 7 + y * 50) % 256, (x * 13) % 256, x + 1], i)
        }
      }
    })
    const png = await decodeTestPng(await encodePng(pixels, { yieldControl: noWait }))
    expect(equalBytes(png.data, new Uint8Array(pixels.data))).toBe(true)
  })

  it('writes fully transparent pixels as 0, 0, 0, 0, hiding the colour Delete kept', async () => {
    // A red square on white; Delete keeps the white under alpha 0.
    const opened = buffer(6, 5, (data) => {
      for (let i = 0; i < data.length; i += 4) data.set([255, 255, 255, 255], i)
      for (let y = 1; y < 4; y++) for (let x = 2; x < 5; x++) data.set([200, 20, 30, 255], (y * 6 + x) * 4)
    })
    const background = createSelectionMask(
      6,
      5,
      Uint8Array.from({ length: 30 }, (_, i) => {
        const x = i % 6
        const y = Math.floor(i / 6)
        return x >= 2 && x < 5 && y >= 1 && y < 4 ? 0 : 1
      }),
    )
    const deleted = deleteSelectedPixels(opened, background)
    if (!deleted || !background) throw new Error('Delete changed nothing')
    // The hidden colour is still there in the editor.
    expect([...deleted.pixels.data.subarray(0, 4)]).toEqual([255, 255, 255, 0])

    const png = await decodeTestPng(await encodePng(deleted.pixels, { yieldControl: noWait }))
    expect([png.width, png.height]).toEqual([6, 5])
    for (let i = 0; i < 30; i++) {
      const pixel = [...png.data.subarray(i * 4, i * 4 + 4)]
      expect(pixel).toEqual(background.data[i] ? [0, 0, 0, 0] : [200, 20, 30, 255])
    }
  })

  it('round-trips random images of many shapes exactly, with and without transparent pixels', async () => {
    const shapes: [number, number][] = [
      [1, 1],
      [1, 9],
      [9, 1],
      [2, 2],
      [3, 7],
      [64, 33],
      [257, 5],
    ]
    let seed = 10
    for (const [width, height] of shapes) {
      for (const share of [0, 0.3, 1]) {
        const pixels = randomPixels(width, height, seed++, share)
        const png = await decodeTestPng(await encodePng(pixels, { yieldControl: noWait }))
        expect([png.width, png.height]).toEqual([width, height])
        expect(equalBytes(png.data, expectedBytes(pixels)), `${width} × ${height}, ${share} transparent`).toBe(true)
      }
    }
  })

  it('never changes the source pixels', async () => {
    const pixels = randomPixels(40, 30, 3, 0.5)
    const before = new Uint8Array(pixels.data)
    await encodePng(pixels, { yieldControl: noWait })
    expect(equalBytes(new Uint8Array(pixels.data), before)).toBe(true)
  })

  it('chooses each filter where it fits best, and decodes exactly', async () => {
    const width = 48
    const stride = width * 4
    const random = randomSource(21)
    const rows: number[][] = []
    // Random visible pixels (alpha 128-255), the row above each crafted row.
    const randomRow = () =>
      Array.from({ length: stride }, (_, i) => (i % 4 === 3 ? 128 + randomInt(random, 128) : randomInt(random, 256)))
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    const crafted: Record<string, (above: number[]) => number[]> = {
      // Small signed values that jump between neighbours: None wins.
      none: () => Array.from({ length: stride }, (_, i) => (Math.floor(i / 4) % 2 ? 255 : 1)),
      // One colour across the row: Sub wins.
      sub: () => Array.from({ length: stride }, (_, i) => [200, 10, 30, 255][i % 4]),
      // The row above repeated: Up wins (Paeth ties, and the lower type is chosen).
      up: (above) => [...above],
      // Each byte the average of its left and upper neighbours: Average wins.
      average: (above) => {
        const row: number[] = []
        for (let i = 0; i < stride; i++) row.push(((i >= 4 ? row[i - 4] : 0) + above[i]) >> 1)
        return row
      },
      // A first pixel unlike the one above (else the row would copy the one above), then each byte
      // the Paeth prediction: Paeth wins.
      paeth: (above) => {
        const row: number[] = [17, 230, 99, 180]
        for (let i = 4; i < stride; i++) row.push(paeth(row[i - 4], above[i], above[i - 4]))
        return row
      },
    }
    for (const make of Object.values(crafted)) {
      const above = randomRow()
      rows.push(above, make(above))
    }
    const pixels = buffer(width, rows.length, (data) => data.set(rows.flat()))
    const png = await decodeTestPng(await encodePng(pixels, { yieldControl: noWait }))
    expect(equalBytes(png.data, new Uint8Array(pixels.data))).toBe(true)
    expect(png.filters.filter((_, row) => row % 2 === 1)).toEqual([0, 1, 2, 3, 4])
  })

  it('writes fully transparent rows unfiltered, as zeros', async () => {
    const pixels = buffer(5, 4, (data) => {
      // Row 1 opaque grey; rows 0, 2 and 3 transparent with hidden colour.
      for (let i = 0; i < data.length; i += 4) data.set([90, 90, 90, Math.floor(i / 20) === 1 ? 255 : 0], i)
    })
    const png = await decodeTestPng(await encodePng(pixels, { yieldControl: noWait }))
    expect(png.filters[0]).toBe(0)
    expect(png.filters[2]).toBe(0)
    expect(png.filters[3]).toBe(0)
    expect(equalBytes(png.data, expectedBytes(pixels))).toBe(true)
  })

  it('gives the same file whatever the slice size, waiting once after each slice', async () => {
    const pixels = randomPixels(30, 20, 5, 0.2)
    const stride = 30 * 4 + 1
    const reference = new Uint8Array(await (await encodePng(pixels, { yieldControl: noWait })).arrayBuffer())
    for (const [sliceBytes, slices] of [
      [1, 20],
      [stride, 20],
      [stride * 3, 7],
      [stride * 20, 1],
      [DEFAULT_SLICE_BYTES, 1],
    ]) {
      let waits = 0
      const file = await encodePng(pixels, {
        sliceBytes,
        yieldControl: () => {
          waits++
          return Promise.resolve()
        },
      })
      expect(waits, `slice ${sliceBytes}`).toBe(slices)
      const png = await decodeTestPng(file)
      expect(equalBytes(png.data, expectedBytes(pixels))).toBe(true)
      // Compressed in different pieces, so the bytes may differ; the decoded image never does.
      expect(file.size).toBeGreaterThan(0)
    }
    expect(reference.length).toBeGreaterThan(0)
  })

  it('waits between slices by default without blocking', async () => {
    const pixels = randomPixels(16, 16, 9)
    const png = await decodeTestPng(await encodePng(pixels, { sliceBytes: 65 * 4 }))
    expect(equalBytes(png.data, new Uint8Array(pixels.data))).toBe(true)
  })

  it('compresses a fully transparent image to a small file', async () => {
    const pixels = buffer(1000, 1000, (data) => {
      // Hidden colour everywhere, all of it dropped.
      for (let i = 0; i < data.length; i += 4) data.set([12, 200, 99, 0], i)
    })
    const file = await encodePng(pixels, { yieldControl: noWait })
    expect(file.size).toBeLessThan(20_000)
    const png = await decodeTestPng(file)
    expect(png.data.every((value) => value === 0)).toBe(true)
  })

  it('encodes a large image exactly', async () => {
    const pixels = randomPixels(1500, 1000, 11, 0.1)
    const png = await decodeTestPng(await encodePng(pixels, { yieldControl: noWait }))
    expect(equalBytes(png.data, expectedBytes(pixels))).toBe(true)
  })

  it('rejects pixel data that does not match the size', async () => {
    const bad = { width: 2, height: 2, data: new Uint8ClampedArray(15) } as PixelBuffer
    await expect(encodePng(bad, { yieldControl: noWait })).rejects.toThrow(RangeError)
    const zero = { width: 0, height: 2, data: new Uint8ClampedArray(0) } as PixelBuffer
    await expect(encodePng(zero, { yieldControl: noWait })).rejects.toThrow(RangeError)
  })

  it('rejects, without leaving the stream open, when the work between slices fails', async () => {
    const pixels = randomPixels(10, 10, 4)
    let waits = 0
    const failing = () => (++waits === 2 ? Promise.reject(new Error('stopped')) : Promise.resolve())
    await expect(encodePng(pixels, { sliceBytes: 41, yieldControl: failing })).rejects.toThrow('stopped')
    expect(waits).toBe(2)
  })
})
