import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toImageData } from './imageData'

/** Stands in for the browser's ImageData, which Node lacks. */
class FakeImageData {
  readonly colorSpace = 'srgb'
  readonly data: Uint8ClampedArray
  readonly width: number
  readonly height: number

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

describe('toImageData', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageData', FakeImageData)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns decoded ImageData as it is', () => {
    const decoded = new ImageData(new Uint8ClampedArray(8), 2, 1)
    expect(toImageData(decoded)).toBe(decoded)
  })

  it('wraps a plain pixel buffer without copying its bytes', () => {
    const data = new Uint8ClampedArray(24)
    const wrapped = toImageData({ width: 3, height: 2, data })
    expect(wrapped).toBeInstanceOf(FakeImageData)
    expect(wrapped).toMatchObject({ width: 3, height: 2 })
    expect(wrapped.data).toBe(data)
  })
})
