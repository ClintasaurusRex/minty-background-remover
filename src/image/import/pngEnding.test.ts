import { describe, expect, it } from 'vitest'
import { PNG_IEND_BYTES, findPngEndingProblem, hasIendChunk } from './pngEnding'
import { ascii, bytes, concat, pngFile, PNG_IEND } from './testFixtures'

const blob = (content: Uint8Array<ArrayBuffer>) => new Blob([content])

describe('findPngEndingProblem', () => {
  it('accepts a PNG that ends with an IEND chunk', async () => {
    expect(await findPngEndingProblem(blob(pngFile(4, 3)))).toBeNull()
    // The CRC is not checked.
    const wrongCrc = pngFile(4, 3)
    wrongCrc.set(bytes(0, 0, 0, 0), wrongCrc.length - 4)
    expect(await findPngEndingProblem(blob(wrongCrc))).toBeNull()
  })

  it('rejects a PNG cut off before or inside the IEND chunk', async () => {
    const complete = pngFile(4, 3)
    for (const cut of [1, 4, 8, PNG_IEND_BYTES, 20]) {
      expect(await findPngEndingProblem(blob(complete.subarray(0, complete.length - cut)))).not.toBeNull()
    }
  })

  it('rejects files too small to hold a header and an IEND chunk', async () => {
    expect(await findPngEndingProblem(blob(PNG_IEND))).toMatch(/truncated/)
    expect(await findPngEndingProblem(blob(new Uint8Array(0)))).toMatch(/truncated/)
  })

  it('rejects a malformed final chunk', async () => {
    const malformed = [
      concat(pngFile(4, 3).subarray(0, -PNG_IEND_BYTES), bytes(0, 0, 0, 1), ascii('IEND'), bytes(0, 0, 0, 0)), // non-zero length
      concat(pngFile(4, 3).subarray(0, -PNG_IEND_BYTES), bytes(0, 0, 0, 0), ascii('iend'), bytes(0, 0, 0, 0)), // wrong case
      concat(pngFile(4, 3).subarray(0, -PNG_IEND_BYTES), bytes(0, 0, 0, 0), ascii('IDAT'), bytes(0, 0, 0, 0)), // wrong type
      concat(pngFile(4, 3), ascii('trailing')), // data after IEND
    ]
    for (const content of malformed) {
      expect(await findPngEndingProblem(blob(content))).toMatch(/IEND/)
    }
  })

  it('reads only the final chunk', async () => {
    const content = blob(concat(pngFile(4, 3).subarray(0, -PNG_IEND_BYTES), new Uint8Array(1_000_000), PNG_IEND))
    const ranges: [number, number][] = []
    const spy = {
      size: content.size,
      slice: (start: number, end?: number) => {
        ranges.push([start, end ?? content.size])
        return content.slice(start, end)
      },
    } as unknown as Blob
    expect(await findPngEndingProblem(spy)).toBeNull()
    expect(ranges).toEqual([[content.size - PNG_IEND_BYTES, content.size]])
  })
})

describe('hasIendChunk', () => {
  it('requires exactly 12 bytes', () => {
    expect(hasIendChunk(PNG_IEND)).toBe(true)
    expect(hasIendChunk(PNG_IEND.subarray(0, 11))).toBe(false)
  })
})
