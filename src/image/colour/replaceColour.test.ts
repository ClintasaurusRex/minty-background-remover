import { describe, expect, it } from 'vitest'
import { randomImage, randomMask, randomSource } from '../../editor/history/testFixtures'
import type { PixelBuffer } from '../../editor/types'
import { createPixelBuffer } from '../pixelBuffer'
import { createSelectionMask } from '../selection/selectionMask'
import type { Rgba } from './colour'
import { replaceColour } from './replaceColour'

/*
 * Basic Replace Colour (Phase 4, algorithm only; the tool awaits owner decisions). Expected results
 * come from an independent reference written here with floating-point distances, not the integer
 * arithmetic the algorithm uses.
 */

const rgba = (r: number, g: number, b: number, a: number): Rgba => ({ r, g, b, a })

function imageOf(width: number, height: number, colours: Rgba[]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  colours.forEach((c, p) => data.set([c.r, c.g, c.b, c.a], p * 4))
  return createPixelBuffer(width, height, data)
}

/** The specification's rule, computed independently: D from the formula in IMAGE_PROCESSING_SPEC.md. */
function reference(pixels: PixelBuffer, source: Rgba, replacement: Rgba, tolerance: number, within: Uint8Array | null) {
  const out = pixels.data.slice()
  let count = 0
  for (let p = 0; p < pixels.width * pixels.height; p++) {
    const i = p * 4
    const [r, g, b, a] = [out[i], out[i + 1], out[i + 2], out[i + 3]]
    if (a === 0 || (within && !within[p])) continue
    const w = Math.min(a, source.a) / 255
    const d2 = (w * ((r - source.r) ** 2 + (g - source.g) ** 2 + (b - source.b) ** 2)) / 3 / 255 ** 2 + (a - source.a) ** 2 / 255 ** 2
    if (Math.sqrt(d2) > tolerance / 100 + 1e-12) continue
    if (r === replacement.r && g === replacement.g && b === replacement.b) continue
    out.set([replacement.r, replacement.g, replacement.b], i)
    count++
  }
  return { data: out, count }
}

describe('replaceColour', () => {
  const grey = rgba(161, 161, 161, 255)
  const white = rgba(255, 255, 255, 255)

  it('replaces exactly the source colour at tolerance 0, keeping every other byte', () => {
    const pixels = imageOf(3, 2, [grey, rgba(160, 161, 161, 255), grey, rgba(0, 0, 0, 255), grey, rgba(161, 161, 161, 254)])
    const before = pixels.data.slice()
    const result = replaceColour(pixels, { source: grey, replacement: rgba(10, 20, 30, 255), tolerance: 0 })!
    expect(result.count).toBe(3)
    expect([...result.pixels.data]).toEqual([10, 20, 30, 255, 160, 161, 161, 255, 10, 20, 30, 255, 0, 0, 0, 255, 10, 20, 30, 255, 161, 161, 161, 254])
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 2 })
    // The input is never written.
    expect(pixels.data).toEqual(before)
  })

  it('replaces near colours within the tolerance, with the Magic Wand distance', () => {
    const pixels = imageOf(4, 1, [grey, rgba(150, 150, 150, 255), rgba(100, 100, 100, 255), white])
    expect(replaceColour(pixels, { source: grey, replacement: rgba(0, 0, 255, 255), tolerance: 5 })!.count).toBe(2)
    expect(replaceColour(pixels, { source: grey, replacement: rgba(0, 0, 255, 255), tolerance: 30 })!.count).toBe(3) // white is 94 / 255 ≈ 0.37 away
    expect(replaceColour(pixels, { source: grey, replacement: rgba(0, 0, 255, 255), tolerance: 37 })!.count).toBe(4)
  })

  it('preserves every pixel’s alpha, never uses the replacement’s alpha, and never changes fully transparent pixels', () => {
    const pixels = imageOf(4, 1, [rgba(161, 161, 161, 200), rgba(161, 161, 161, 128), rgba(161, 161, 161, 0), rgba(9, 9, 9, 0)])
    const result = replaceColour(pixels, { source: rgba(161, 161, 161, 128), replacement: rgba(1, 2, 3, 7), tolerance: 100 })!
    expect([...result.pixels.data]).toEqual([1, 2, 3, 200, 1, 2, 3, 128, 161, 161, 161, 0, 9, 9, 9, 0])
    expect(result.count).toBe(2)
  })

  it('changes only selected pixels when limited to a selection', () => {
    const pixels = imageOf(3, 1, [grey, grey, grey])
    const within = createSelectionMask(3, 1, new Uint8Array([0, 1, 0]))
    const result = replaceColour(pixels, { source: grey, replacement: white, tolerance: 0, within })!
    expect(result.count).toBe(1)
    expect(result.bounds).toEqual({ x: 1, y: 0, width: 1, height: 1 })
    expect([...result.pixels.data.slice(0, 4), ...result.pixels.data.slice(8)]).toEqual([161, 161, 161, 255, 161, 161, 161, 255])
  })

  it('returns null, allocating nothing, when nothing would change', () => {
    const pixels = imageOf(2, 1, [white, rgba(0, 0, 0, 255)])
    expect(replaceColour(pixels, { source: grey, replacement: rgba(1, 1, 1, 255), tolerance: 0 })).toBeNull()
    expect(replaceColour(pixels, { source: white, replacement: white, tolerance: 0 })).toBeNull()
  })

  it('refuses invalid tolerances, colours and mask sizes', () => {
    const pixels = imageOf(2, 1, [white, white])
    expect(() => replaceColour(pixels, { source: grey, replacement: white, tolerance: 101 })).toThrow(RangeError)
    expect(() => replaceColour(pixels, { source: grey, replacement: white, tolerance: 2.5 })).toThrow(RangeError)
    expect(() => replaceColour(pixels, { source: rgba(256, 0, 0, 0), replacement: white, tolerance: 0 })).toThrow(RangeError)
    const wrong = createSelectionMask(1, 1, new Uint8Array([1]))
    expect(() => replaceColour(pixels, { source: grey, replacement: white, tolerance: 0, within: wrong })).toThrow(RangeError)
  })

  it('matches the independent reference on random images, colours, tolerances and selections', () => {
    const random = randomSource(21)
    for (let i = 0; i < 300; i++) {
      const width = 1 + Math.floor(random() * 20)
      const height = 1 + Math.floor(random() * 20)
      const pixels = randomImage(width, height, random)
      // A source taken from the image half the time, so that there are matches.
      const p = Math.floor(random() * width * height) * 4
      const source = random() < 0.5 ? rgba(pixels.data[p], pixels.data[p + 1], pixels.data[p + 2], pixels.data[p + 3]) : rgba(...([0, 0, 0, 0].map(() => Math.floor(random() * 256)) as [number, number, number, number]))
      const replacement = rgba(Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256))
      const tolerance = Math.floor(random() * 101)
      const within = random() < 0.3 ? randomMask(width, height, random) : null
      const expected = reference(pixels, source, replacement, tolerance, within?.data ?? null)
      const result = replaceColour(pixels, { source, replacement, tolerance, within })
      if (expected.count === 0) {
        expect(result).toBeNull()
        continue
      }
      expect(result!.count).toBe(expected.count)
      expect(result!.pixels.data).toEqual(expected.data)
    }
  })
})
