import { describe, expect, it } from 'vitest'
import { createPixelBuffer, sharesPixelMemory } from '../../image/pixelBuffer'
import type { PixelBuffer, Rectangle } from '../types'
import { type CropPatch, createCropPatch, cropPixels, restoreCroppedPixels } from './cropPatch'

/** Deterministic pseudo-random numbers in [0, 1). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

/** Random RGBA, with a share of fully transparent pixels that still have colour. */
function randomImage(width: number, height: number, random: () => number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)
  for (let i = 3; i < data.length; i += 4) if (random() < 0.3) data[i] = 0
  return createPixelBuffer(width, height, data)
}

function sameBytes(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** The kept rectangle, pixel by pixel. */
function referenceCrop(pixels: PixelBuffer, rect: Rectangle): number[] {
  const out: number[] = []
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const p = (y * pixels.width + x) * 4
      out.push(...pixels.data.subarray(p, p + 4))
    }
  }
  return out
}

/** Crops, stores the patch, then restores: the round trip Auto Trim and its Undo make. */
function roundTrip(original: PixelBuffer, kept: Rectangle): { cropped: PixelBuffer; patch: CropPatch; restored: PixelBuffer } {
  const cropped = cropPixels(original, kept)
  const patch = createCropPatch(original, kept)!
  return { cropped, patch, restored: restoreCroppedPixels(cropped, patch) }
}

const patchBytes = (patch: CropPatch) => patch.removed.tokens.byteLength + patch.removed.literals.byteLength

describe('cropPixels', () => {
  it('copies exactly the kept rectangle into new memory', () => {
    const random = randomSource(1)
    const pixels = randomImage(9, 7, random)
    for (const rect of [
      { x: 0, y: 0, width: 9, height: 7 },
      { x: 2, y: 1, width: 5, height: 4 },
      { x: 8, y: 6, width: 1, height: 1 },
      { x: 0, y: 3, width: 9, height: 1 },
      { x: 4, y: 0, width: 1, height: 7 },
    ]) {
      const cropped = cropPixels(pixels, rect)
      expect(cropped).toMatchObject({ width: rect.width, height: rect.height })
      expect(Array.from(cropped.data)).toEqual(referenceCrop(pixels, rect))
      expect(sharesPixelMemory(cropped, pixels)).toBe(false)
    }
  })

  it('rejects rectangles that are empty, fractional or outside the image', () => {
    const pixels = randomImage(4, 3, randomSource(2))
    for (const rect of [
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 1, y: 1, width: 4, height: 1 },
      { x: 0, y: 2, width: 1, height: 2 },
      { x: -1, y: 0, width: 2, height: 2 },
      { x: 0, y: 0, width: 1.5, height: 1 },
    ]) {
      expect(() => cropPixels(pixels, rect)).toThrow(RangeError)
    }
  })
})

describe('createCropPatch and restoreCroppedPixels', () => {
  it('rebuild the original exactly when borders are removed from any side or sides', () => {
    const random = randomSource(3)
    const width = 12
    const height = 9
    const original = randomImage(width, height, random)
    const cases: Record<string, Rectangle> = {
      top: { x: 0, y: 3, width, height: 6 },
      bottom: { x: 0, y: 0, width, height: 5 },
      left: { x: 4, y: 0, width: 8, height },
      right: { x: 0, y: 0, width: 7, height },
      'all four': { x: 2, y: 1, width: 7, height: 5 },
      'top-left corner kept': { x: 0, y: 0, width: 3, height: 2 },
      'top-right corner kept': { x: 9, y: 0, width: 3, height: 2 },
      'bottom-left corner kept': { x: 0, y: 7, width: 3, height: 2 },
      'bottom-right corner kept': { x: 9, y: 7, width: 3, height: 2 },
      'one pixel in the middle': { x: 6, y: 4, width: 1, height: 1 },
      'one full row': { x: 0, y: 4, width, height: 1 },
      'one full column': { x: 5, y: 0, width: 1, height },
    }
    for (const [name, kept] of Object.entries(cases)) {
      const { cropped, patch, restored } = roundTrip(original, kept)
      expect(cropped, name).toMatchObject({ width: kept.width, height: kept.height })
      // Every removed pixel once: no corner stored twice.
      expect(patch.removed.length, name).toBe(width * height - kept.width * kept.height)
      expect(patch, name).toMatchObject({ kind: 'crop-patch', width, height, kept })
      expect(sameBytes(restored, original), name).toBe(true)
    }
  })

  it('keep the colour hidden under alpha 0 in removed borders', () => {
    // A transparent background whose pixels still hold colour, as after Delete Selection.
    const width = 6
    const height = 5
    const data = new Uint8ClampedArray(width * height * 4)
    for (let p = 0; p < width * height; p++) data.set([p * 7, 255 - p, 13, 0], p * 4)
    data.set([10, 20, 30, 255], (2 * width + 3) * 4)
    const original = createPixelBuffer(width, height, data)
    const { cropped, restored } = roundTrip(original, { x: 3, y: 2, width: 1, height: 1 })
    expect(Array.from(cropped.data)).toEqual([10, 20, 30, 255])
    expect(sameBytes(restored, original)).toBe(true)
  })

  it('return null when nothing would be removed, including for a 1 × 1 image', () => {
    const random = randomSource(4)
    expect(createCropPatch(randomImage(1, 1, random), { x: 0, y: 0, width: 1, height: 1 })).toBeNull()
    expect(createCropPatch(randomImage(5, 3, random), { x: 0, y: 0, width: 5, height: 3 })).toBeNull()
  })

  it('handle 1-pixel-wide and 1-pixel-high images', () => {
    const random = randomSource(5)
    for (const [width, height, kept] of [
      [1, 6, { x: 0, y: 2, width: 1, height: 3 }],
      [6, 1, { x: 1, y: 0, width: 4, height: 1 }],
      [2, 1, { x: 1, y: 0, width: 1, height: 1 }],
      [1, 2, { x: 0, y: 0, width: 1, height: 1 }],
    ] as const) {
      const original = randomImage(width, height, random)
      expect(sameBytes(roundTrip(original, kept).restored, original)).toBe(true)
    }
  })

  it('store transparent black and single-colour borders in a few bytes', () => {
    const width = 400
    const height = 300
    const kept = { x: 100, y: 80, width: 200, height: 140 }
    const object = (data: Uint8ClampedArray) => {
      for (let y = kept.y; y < kept.y + kept.height; y++) data.fill(200, (y * width + kept.x) * 4, (y * width + kept.x + kept.width) * 4)
    }
    const transparentBlack = new Uint8ClampedArray(width * height * 4)
    object(transparentBlack)
    const hiddenColour = new Uint8ClampedArray(width * height * 4)
    for (let p = 0; p < width * height; p++) hiddenColour.set([240, 240, 240, 0], p * 4)
    object(hiddenColour)
    for (const data of [transparentBlack, hiddenColour]) {
      const original = createPixelBuffer(width, height, data)
      const { patch, restored } = roundTrip(original, kept)
      // One run above, one per kept row (right part of a row joins the next row's left part), one below.
      expect(patchBytes(patch)).toBeLessThanOrEqual(8 * (kept.height + 2))
      expect(sameBytes(restored, original)).toBe(true)
    }
  })

  it('never take more than 4 bytes per removed pixel, plus 4', () => {
    const random = randomSource(6)
    const original = randomImage(64, 48, random)
    const kept = { x: 10, y: 5, width: 30, height: 20 }
    const { patch, restored } = roundTrip(original, kept)
    expect(patchBytes(patch)).toBeLessThanOrEqual(4 * patch.removed.length + 4)
    expect(sameBytes(restored, original)).toBe(true)
  })

  it('never write their inputs, and return new memory', () => {
    const random = randomSource(7)
    const original = randomImage(10, 8, random)
    const bytes = Array.from(original.data)
    const kept = { x: 2, y: 2, width: 5, height: 4 }
    const cropped = cropPixels(original, kept)
    const croppedBytes = Array.from(cropped.data)
    const patch = createCropPatch(original, kept)!
    const tokens = Array.from(patch.removed.tokens)
    const restored = restoreCroppedPixels(cropped, patch)
    expect(Array.from(original.data)).toEqual(bytes)
    expect(Array.from(cropped.data)).toEqual(croppedBytes)
    expect(Array.from(patch.removed.tokens)).toEqual(tokens)
    expect(sharesPixelMemory(restored, original)).toBe(false)
    expect(sharesPixelMemory(restored, cropped)).toBe(false)
    // The kept rectangle is copied, not shared with the caller.
    const rect = { ...kept }
    const own = createCropPatch(original, rect)!
    rect.x = 0
    expect(own.kept.x).toBe(2)
  })

  it('reject invalid rectangles, a cropped image of the wrong size and malformed patches', () => {
    const random = randomSource(8)
    const original = randomImage(8, 6, random)
    expect(() => createCropPatch(original, { x: 5, y: 0, width: 4, height: 2 })).toThrow(RangeError)
    expect(() => createCropPatch(original, { x: 0, y: 0, width: 0, height: 2 })).toThrow(RangeError)
    expect(() => createCropPatch({ width: 8, height: 6, data: new Uint8ClampedArray(10) }, { x: 0, y: 0, width: 1, height: 1 })).toThrow(RangeError)

    const kept = { x: 1, y: 1, width: 5, height: 3 }
    const cropped = cropPixels(original, kept)
    const patch = createCropPatch(original, kept)!
    expect(() => restoreCroppedPixels(cropPixels(original, { x: 1, y: 1, width: 3, height: 5 }), patch)).toThrow(RangeError)
    const { removed } = patch
    const malformed: [string, CropPatch][] = [
      ['another kind', { ...patch, kind: 'pixel-patch' } as unknown as CropPatch],
      ['invalid size', { ...patch, height: -6 }],
      ['kept outside the image', { ...patch, kept: { x: 4, y: 1, width: 5, height: 3 } }],
      ['nothing removed', { ...patch, width: 5, height: 3, kept: { x: 0, y: 0, width: 5, height: 3 } }],
      ['removed pixels for another size', { ...patch, width: 9 }],
      ['truncated runs', { ...patch, removed: { ...removed, tokens: removed.tokens.subarray(1) } }],
      ['truncated literals', { ...patch, removed: { ...removed, literals: removed.literals.subarray(4) } }],
    ]
    for (const [name, candidate] of malformed) {
      expect(() => restoreCroppedPixels(cropped, candidate), name).toThrow(RangeError)
    }
  })

  it('rebuild random images exactly for random kept rectangles', () => {
    const random = randomSource(42)
    const failures: string[] = []
    for (const [width, height] of [[1, 1], [2, 2], [1, 8], [8, 1], [7, 5], [16, 9], [31, 17]]) {
      for (let trial = 0; trial < 25; trial++) {
        const original = randomImage(width, height, random)
        const x = Math.floor(random() * width)
        const y = Math.floor(random() * height)
        const kept = { x, y, width: 1 + Math.floor(random() * (width - x)), height: 1 + Math.floor(random() * (height - y)) }
        const label = `${width} × ${height}, trial ${trial}, ${JSON.stringify(kept)}`
        const cropped = cropPixels(original, kept)
        if (Array.from(cropped.data).join() !== referenceCrop(original, kept).join()) failures.push(`${label}: crop`)
        const patch = createCropPatch(original, kept)
        if (kept.width === width && kept.height === height) {
          if (patch !== null) failures.push(`${label}: expected null`)
          continue
        }
        if (!patch || !sameBytes(restoreCroppedPixels(cropped, patch), original)) failures.push(`${label}: restore`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('crop patches on large images', () => {
  it('trim a 4K image with a transparent background holding hidden colour, and restore it exactly', () => {
    const width = 3840
    const height = 2400
    const words = new Uint32Array(width * height)
    const data = new Uint8ClampedArray(words.buffer)
    // A deleted single-colour background (alpha 0, colour kept), and a noisy opaque object.
    for (let p = 0; p < width * height; p++) data.set([235, 238, 240, 0], p * 4)
    let state = 5
    const kept = { x: 1000, y: 700, width: 1500, height: 900 }
    for (let y = kept.y; y < kept.y + kept.height; y++) {
      for (let x = kept.x; x < kept.x + kept.width; x++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0
        words[y * width + x] = state
        data[(y * width + x) * 4 + 3] = 255
      }
    }
    const original = createPixelBuffer(width, height, data)
    const { cropped, patch, restored } = roundTrip(original, kept)
    expect(cropped).toMatchObject({ width: 1500, height: 900 })
    expect(patch.removed.length).toBe(width * height - 1500 * 900)
    expect(patchBytes(patch)).toBeLessThanOrEqual(8 * (kept.height + 2))
    expect(sameBytes(restored, original)).toBe(true)
  })
})
