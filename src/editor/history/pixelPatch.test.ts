import { describe, expect, it } from 'vitest'
import { deleteSelectedPixels } from '../../image/edit/deleteSelection'
import { createPixelBuffer, sharesPixelMemory } from '../../image/pixelBuffer'
import { createSelectionMask } from '../../image/selection/selectionMask'
import { type Rgba, imageFromRows, maskBytes } from '../../image/selection/testFixtures'
import type { PixelBuffer, Rectangle } from '../types'
import { type PixelPatch, applyPixelPatch, createPixelPatch } from './pixelPatch'

/** Deterministic pseudo-random numbers in [0, 1). */
function randomSource(seed: number): () => number {
  let state = seed
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

function randomImage(width: number, height: number, random: () => number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random() * 256)
  return createPixelBuffer(width, height, data)
}

/** A copy of `pixels` changed by `change`, as an edit would make it. */
function edited(pixels: PixelBuffer, change: (data: Uint8ClampedArray, width: number) => void): PixelBuffer {
  const data = pixels.data.slice()
  change(data, pixels.width)
  return createPixelBuffer(pixels.width, pixels.height, data)
}

/** Byte-for-byte equality; fast enough for 4K images. */
function sameBytes(a: PixelBuffer, b: PixelBuffer): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** Both directions restore exactly. */
function expectReversible(before: PixelBuffer, after: PixelBuffer, patch: PixelPatch) {
  expect(sameBytes(applyPixelPatch(after, patch), before)).toBe(true)
  expect(sameBytes(applyPixelPatch(before, patch), after)).toBe(true)
}

const patchBytes = (patch: PixelPatch) => patch.changes.tokens.byteLength + patch.changes.literals.byteLength

/** The changed pixels' count and tight bounds, pixel by pixel. */
function referenceChanges(before: PixelBuffer, after: PixelBuffer): { count: number; bounds: Rectangle | null } {
  const { width, height } = before
  let count = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      if ([0, 1, 2, 3].every((c) => before.data[p + c] === after.data[p + c])) continue
      count++
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return { count, bounds: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null }
}

const PALETTE: Readonly<Record<string, Rgba>> = {
  w: [255, 255, 255, 255],
  r: [220, 30, 30, 255],
  s: [40, 90, 160, 128],
  h: [255, 0, 0, 0],
}

describe('createPixelPatch and applyPixelPatch', () => {
  it('restore both states of a Delete Selection exactly, including colour hidden under alpha 0', () => {
    const before = imageFromRows(PALETTE, 'wwhs', 'wrrw', 'swwh')
    const { width, height, data } = maskBytes('####', '#..#', '####')
    const deleted = deleteSelectedPixels(before, createSelectionMask(width, height, data))!
    const patch = createPixelPatch(before, deleted.pixels, deleted.bounds)!
    expect(patch).toMatchObject({ kind: 'pixel-patch', width: 4, height: 3, region: deleted.bounds, changedPixels: deleted.count })
    expect(patch.changes.alphaOnly).toBe(true)
    expectReversible(before, deleted.pixels, patch)
  })

  it('stores the deletion of an opaque background as a few runs per row', () => {
    const random = randomSource(1)
    const width = 300
    const height = 200
    const photo = edited(randomImage(width, height, random), (data) => {
      for (let i = 3; i < data.length; i += 4) data[i] = 255
    })
    const mask = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) mask[y * width + x] = ((x - 150) / 90) ** 2 + ((y - 100) / 60) ** 2 > 1 ? 1 : 0
    }
    const deleted = deleteSelectedPixels(photo, createSelectionMask(width, height, mask))!
    const patch = createPixelPatch(photo, deleted.pixels, deleted.bounds)!
    // A fill and a skip per row through the object, one fill for the rows above and below.
    // (Where the object is only one or two pixels wide, those pixels become literals.)
    expect(patchBytes(patch)).toBeLessThanOrEqual(12 * height + 16)
    expectReversible(photo, deleted.pixels, patch)
  })

  it('restore edits to every RGBA channel exactly', () => {
    const random = randomSource(2)
    const before = randomImage(37, 23, random)
    const after = randomImage(37, 23, random)
    const patch = createPixelPatch(before, after)!
    expect(patch.changes.alphaOnly).toBe(false)
    expect(patch.changedPixels).toBe(referenceChanges(before, after).count)
    expectReversible(before, after, patch)
    // Changes to one channel at a time.
    for (let channel = 0; channel < 4; channel++) {
      const changed = edited(before, (data) => {
        for (let i = channel; i < data.length; i += 8) data[i] ^= 0x5a
      })
      expectReversible(before, changed, createPixelPatch(before, changed)!)
    }
  })

  it('restore changes to the hidden colour of fully transparent pixels', () => {
    const before = imageFromRows(PALETTE, 'hhh', 'hwh')
    const after = edited(before, (data) => {
      data.set([1, 2, 3, 0], 0)
      data.set([0, 0, 0, 0], 8)
    })
    const patch = createPixelPatch(before, after)!
    expect(patch).toMatchObject({ changedPixels: 2, region: { x: 0, y: 0, width: 3, height: 2 } })
    expectReversible(before, after, patch)
  })

  it('handle one changed pixel and a fully changed image', () => {
    const random = randomSource(4)
    const before = randomImage(9, 7, random)
    const one = edited(before, (data) => {
      data[(3 * 9 + 5) * 4 + 1] ^= 1
    })
    const patch = createPixelPatch(before, one, { x: 5, y: 3, width: 1, height: 1 })!
    expect(patch).toMatchObject({ changedPixels: 1, region: { x: 5, y: 3, width: 1, height: 1 } })
    expectReversible(before, one, patch)

    const all = edited(before, (data) => {
      for (let i = 0; i < data.length; i++) data[i] ^= 0xff
    })
    expect(createPixelPatch(before, all)).toMatchObject({ changedPixels: 63, region: { x: 0, y: 0, width: 9, height: 7 } })
    expectReversible(before, all, createPixelPatch(before, all)!)
  })

  it('handle scattered and contiguous changes', () => {
    const random = randomSource(5)
    const before = randomImage(64, 48, random)
    const scattered = edited(before, (data) => {
      for (let p = 0; p < 64 * 48; p++) if (random() < 0.1) data[p * 4 + Math.floor(random() * 4)] ^= 1 + Math.floor(random() * 255)
    })
    expectReversible(before, scattered, createPixelPatch(before, scattered)!)
    const block = edited(before, (data, width) => {
      for (let y = 10; y < 30; y++) data.fill(7, (y * width + 20) * 4, (y * width + 50) * 4)
    })
    const patch = createPixelPatch(before, block, { x: 20, y: 10, width: 30, height: 20 })!
    expect(patch.changedPixels).toBe(600)
    expectReversible(before, block, patch)
  })

  it('handle changes touching each edge, with regions that are full rows or narrower', () => {
    const random = randomSource(6)
    const width = 11
    const height = 8
    const before = randomImage(width, height, random)
    const edges: Record<string, (x: number, y: number) => boolean> = {
      top: (_, y) => y === 0,
      bottom: (_, y) => y === height - 1,
      left: (x) => x === 0,
      right: (x) => x === width - 1,
      corners: (x, y) => (x === 0 || x === width - 1) && (y === 0 || y === height - 1),
      'two edges apart': (x) => x === 0 || x === width - 1,
    }
    for (const [name, isChanged] of Object.entries(edges)) {
      const after = edited(before, (data) => {
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (isChanged(x, y)) data[(y * width + x) * 4] ^= 0x80
      })
      const { count, bounds } = referenceChanges(before, after)
      const patch = createPixelPatch(before, after, bounds!)!
      expect(patch, name).toMatchObject({ changedPixels: count, region: bounds })
      expectReversible(before, after, patch)
    }
  })

  it('give the same result whether the region is the change bounds or the whole image', () => {
    const random = randomSource(7)
    const before = randomImage(20, 15, random)
    const after = edited(before, (data, width) => {
      for (let y = 4; y < 9; y++) for (let x = 3; x < 12; x++) data[(y * width + x) * 4 + 3] = 0
    })
    const tight = createPixelPatch(before, after, { x: 3, y: 4, width: 9, height: 5 })!
    const whole = createPixelPatch(before, after)!
    expect(whole.region).toEqual({ x: 0, y: 0, width: 20, height: 15 })
    expect(tight.changedPixels).toBe(whole.changedPixels)
    expect(sameBytes(applyPixelPatch(after, tight), applyPixelPatch(after, whole))).toBe(true)
    // The region is copied, not shared with the caller.
    const region = { x: 3, y: 4, width: 9, height: 5 }
    const own = createPixelPatch(before, after, region)!
    region.x = 0
    expect(own.region.x).toBe(3)
  })

  it('return null when nothing differs', () => {
    const random = randomSource(8)
    const before = randomImage(10, 10, random)
    const copy = createPixelBuffer(10, 10, before.data.slice())
    expect(createPixelPatch(before, copy)).toBeNull()
    expect(createPixelPatch(before, before)).toBeNull()
    const outside = edited(before, (data) => {
      data[0] ^= 1
    })
    // Only the region is compared.
    expect(createPixelPatch(before, outside, { x: 5, y: 5, width: 5, height: 5 })).toBeNull()
  })

  it('never write their inputs, and return new memory', () => {
    const random = randomSource(9)
    const before = randomImage(16, 12, random)
    const after = randomImage(16, 12, random)
    const beforeBytes = Array.from(before.data)
    const afterBytes = Array.from(after.data)
    const patch = createPixelPatch(before, after)!
    const tokens = Array.from(patch.changes.tokens)
    const literals = Array.from(patch.changes.literals)
    const undone = applyPixelPatch(after, patch)
    const again = applyPixelPatch(after, patch)
    expect(Array.from(before.data)).toEqual(beforeBytes)
    expect(Array.from(after.data)).toEqual(afterBytes)
    expect(Array.from(patch.changes.tokens)).toEqual(tokens)
    expect(Array.from(patch.changes.literals)).toEqual(literals)
    expect(sharesPixelMemory(undone, after)).toBe(false)
    expect(sharesPixelMemory(undone, again)).toBe(false)
    expect(sameBytes(undone, again)).toBe(true)
  })

  it('reject images of different sizes, invalid buffers and regions outside the image', () => {
    const random = randomSource(10)
    const a = randomImage(4, 3, random)
    expect(() => createPixelPatch(a, randomImage(3, 4, random))).toThrow(RangeError)
    expect(() => createPixelPatch(a, { width: 4, height: 3, data: new Uint8ClampedArray(47) })).toThrow(RangeError)
    for (const region of [
      { x: -1, y: 0, width: 2, height: 2 },
      { x: 3, y: 0, width: 2, height: 1 },
      { x: 0, y: 2, width: 1, height: 2 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0.5, y: 0, width: 1, height: 1 },
    ]) {
      expect(() => createPixelPatch(a, a, region)).toThrow(RangeError)
    }
    const patch = createPixelPatch(a, randomImage(4, 3, random))!
    expect(() => applyPixelPatch(randomImage(3, 4, random), patch)).toThrow(RangeError)
    expect(() => applyPixelPatch(randomImage(4, 4, random), patch)).toThrow(RangeError)
  })

  it('reject malformed patches', () => {
    const random = randomSource(12)
    const before = randomImage(6, 5, random)
    // Each pixel changed differently, so the patch has literals.
    const after = edited(before, (data) => {
      for (let i = 40; i < 80; i++) data[i] ^= 1 + (i % 3)
    })
    const patch = createPixelPatch(before, after)!
    const { changes } = patch
    expect(changes.literals.byteLength).toBeGreaterThan(4)
    const malformed: [string, PixelPatch][] = [
      ['another kind', { ...patch, kind: 'crop-patch' } as unknown as PixelPatch],
      ['invalid image size', { ...patch, width: 0 }],
      ['region outside the image', { ...patch, region: { x: 1, y: 0, width: 6, height: 5 } }],
      ['no changed pixels', { ...patch, changedPixels: 0 }],
      ['more changes than pixels', { ...patch, changedPixels: 31 }],
      ['runs for another region', { ...patch, region: { x: 0, y: 0, width: 6, height: 4 } }],
      ['truncated tokens', { ...patch, changes: { ...changes, tokens: changes.tokens.subarray(0, changes.tokens.length - 1) } }],
      ['truncated literals', { ...patch, changes: { ...changes, literals: changes.literals.subarray(0, changes.literals.length - 4) } }],
      ['unknown token', { ...patch, changes: { ...changes, tokens: Uint32Array.from(changes.tokens, (t, i) => (i === 0 ? t | 3 : t)) } }],
    ]
    for (const [name, candidate] of malformed) {
      expect(() => applyPixelPatch(before, candidate), name).toThrow(RangeError)
    }
  })

  it('agree with a per-pixel reference on random images, edits and regions', () => {
    const random = randomSource(42)
    const failures: string[] = []
    for (const [width, height] of [[1, 1], [1, 9], [9, 1], [5, 3], [13, 11], [33, 4], [17, 17]]) {
      for (let trial = 0; trial < 20; trial++) {
        // Pixels at a 4-byte-aligned offset inside larger memory.
        const memory = new ArrayBuffer((width * height + 2) * 4)
        const data = new Uint8ClampedArray(memory, 4 * (trial % 3), width * height * 4)
        for (let i = 0; i < data.length; i++) data[i] = random() < 0.3 ? 0 : Math.floor(random() * 256)
        const before = createPixelBuffer(width, height, data)
        const mode = trial % 3 // 0: alpha only, 1: colour only, 2: any byte
        const density = random()
        const after = edited(before, (bytes) => {
          for (let p = 0; p < width * height; p++) {
            if (random() >= density) continue
            const channel = mode === 0 ? 3 : mode === 1 ? Math.floor(random() * 3) : Math.floor(random() * 4)
            bytes[p * 4 + channel] = random() < 0.5 ? 0 : Math.floor(random() * 256)
          }
        })
        const { count, bounds } = referenceChanges(before, after)
        // Sometimes the tight bounds, sometimes a larger region, sometimes the whole image.
        let region: Rectangle | undefined
        if (bounds && trial % 4 === 1) region = bounds
        if (bounds && trial % 4 === 2) {
          const x = Math.floor(random() * (bounds.x + 1))
          const y = Math.floor(random() * (bounds.y + 1))
          region = { x, y, width: bounds.x + bounds.width - x, height: bounds.y + bounds.height - y }
        }
        const patch = createPixelPatch(before, after, region)
        const label = `${width} × ${height}, trial ${trial}`
        if (count === 0) {
          if (patch !== null) failures.push(`${label}: expected null`)
          continue
        }
        if (!patch || patch.changedPixels !== count) {
          failures.push(`${label}: count`)
          continue
        }
        if (mode === 0 && patch.changes.literals.byteLength > 0 && !patch.changes.alphaOnly) failures.push(`${label}: alpha only`)
        if (!sameBytes(applyPixelPatch(after, patch), before)) failures.push(`${label}: undo`)
        if (!sameBytes(applyPixelPatch(before, patch), after)) failures.push(`${label}: redo`)
        if (patchBytes(patch) > 4 * patch.region.width * patch.region.height + 4) failures.push(`${label}: size`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('pixel patches on large images', () => {
  it('undo and redo a 4K background deletion exactly from a small patch', () => {
    const width = 3840
    const height = 2400
    const words = new Uint32Array(width * height)
    let state = 99
    for (let i = 0; i < words.length; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0
      words[i] = state
    }
    const data = new Uint8ClampedArray(words.buffer)
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    const photo = createPixelBuffer(width, height, data)
    const mask = new Uint8Array(width * height).fill(1)
    for (let y = 600; y < 1800; y++) mask.fill(0, y * width + 960, y * width + 2880)
    const deleted = deleteSelectedPixels(photo, createSelectionMask(width, height, mask))!

    const patch = createPixelPatch(photo, deleted.pixels, deleted.bounds)!
    expect(patch.changedPixels).toBe(width * height - 1200 * 1920)
    // One fill and one skip per row through the object, plus the rows above and below.
    expect(patchBytes(patch)).toBeLessThanOrEqual(12 * 1200 + 64)
    expect(sameBytes(applyPixelPatch(deleted.pixels, patch), photo)).toBe(true)
    expect(sameBytes(applyPixelPatch(photo, patch), deleted.pixels)).toBe(true)
  })

  it('keeps one byte per deleted pixel when every alpha differs, and stays within 4 bytes per pixel for any edit', () => {
    const width = 1024
    const height = 512
    const random = randomSource(13)
    const noisy = createPixelBuffer(width, height, Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 1 + Math.floor(random() * 255) : Math.floor(random() * 256),
    ))
    const all = createSelectionMask(width, height, new Uint8Array(width * height).fill(1))
    const deleted = deleteSelectedPixels(noisy, all)!
    const deletePatch = createPixelPatch(noisy, deleted.pixels, deleted.bounds)!
    expect(deletePatch.changes.alphaOnly).toBe(true)
    expect(patchBytes(deletePatch)).toBeLessThanOrEqual(width * height * 1.01 + 64)
    expect(sameBytes(applyPixelPatch(deleted.pixels, deletePatch), noisy)).toBe(true)

    const anything = randomImage(width, height, random)
    const worst = createPixelPatch(noisy, anything)!
    expect(patchBytes(worst)).toBeLessThanOrEqual(4 * width * height + 4)
    expect(sameBytes(applyPixelPatch(anything, worst), noisy)).toBe(true)
  })
})
