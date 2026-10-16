import { describe, expect, it } from 'vitest'
import { fakeImageData } from '../image/import/testFixtures'
import { createImageDocument } from './imageDocument'

const input = { name: 'a.png', format: 'png', source: 'file-picker', fileSizeBytes: 123 } as const

describe('createImageDocument', () => {
  it('takes its dimensions from the pixel buffer', () => {
    const pixels = fakeImageData(3840, 2160)
    const document = createImageDocument({ ...input, pixels })
    expect(document).toMatchObject({ ...input, width: 3840, height: 2160, revision: 0 })
    expect(document.pixels).toBe(pixels)
  })

  it('assigns increasing ids', () => {
    const a = createImageDocument({ ...input, pixels: fakeImageData(1, 1) })
    const b = createImageDocument({ ...input, pixels: fakeImageData(1, 1) })
    expect(b.id).toBeGreaterThan(a.id)
  })

  it('rejects invalid dimensions and incomplete buffers', () => {
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(0, 1, 0) })).toThrow(RangeError)
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(2, 2, 15) })).toThrow(RangeError)
    expect(() => createImageDocument({ ...input, pixels: fakeImageData(2, 2, 17) })).toThrow(RangeError)
  })
})
