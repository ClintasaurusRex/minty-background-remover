import { describe, expect, it } from 'vitest'
import type { Rectangle, Size } from '../../editor/types'
import {
  CROP_HANDLES,
  type CropField,
  cropFieldMaximum,
  isValidCropRect,
  isWholeImage,
  moveCropRect,
  nearestCorner,
  nearestEdge,
  rectBetween,
  resizeCropRect,
  sameRect,
  setCropField,
  wholeImageRect,
} from './cropRectangle'

/*
 * Crop rectangle geometry (Phase 4, Manual Crop): every result is checked to be a valid crop
 * rectangle (whole pixels, at least 1 × 1, within the image), and against values worked out by hand.
 */

const SIZE: Size = { width: 100, height: 60 }
const rect = (x: number, y: number, width: number, height: number): Rectangle => ({ x, y, width, height })

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296
}

describe('isValidCropRect', () => {
  it('accepts whole-pixel rectangles of at least 1 × 1 within the image, including the whole image and single pixels', () => {
    for (const r of [rect(0, 0, 100, 60), rect(0, 0, 1, 1), rect(99, 59, 1, 1), rect(10, 5, 90, 55)]) {
      expect(isValidCropRect(r, SIZE)).toBe(true)
    }
  })

  it('rejects empty, inside-out, fractional, non-finite and out-of-image rectangles', () => {
    const invalid = [
      rect(0, 0, 0, 10),
      rect(0, 0, 10, 0),
      rect(5, 5, -1, 3),
      rect(0.5, 0, 10, 10),
      rect(0, 0, 10.5, 10),
      rect(Number.NaN, 0, 10, 10),
      rect(0, 0, Infinity, 10),
      rect(-1, 0, 10, 10),
      rect(0, -1, 10, 10),
      rect(91, 0, 10, 10),
      rect(0, 51, 10, 10),
      rect(0, 0, 101, 60),
    ]
    for (const r of invalid) expect(isValidCropRect(r, SIZE)).toBe(false)
  })
})

describe('isWholeImage and wholeImageRect', () => {
  it('recognises only the whole image', () => {
    expect(wholeImageRect(SIZE)).toEqual(rect(0, 0, 100, 60))
    expect(isWholeImage(wholeImageRect(SIZE), SIZE)).toBe(true)
    expect(isWholeImage(rect(0, 0, 99, 60), SIZE)).toBe(false)
    expect(isWholeImage(rect(1, 0, 99, 60), SIZE)).toBe(false)
    expect(isWholeImage(rect(0, 0, 100, 59), SIZE)).toBe(false)
  })
})

describe('nearestEdge and nearestCorner', () => {
  it('rounds to the nearest pixel edge, halves up, and clamps to the image (dragging outside it stops at its edge)', () => {
    expect(nearestEdge(10.49, 100)).toBe(10)
    expect(nearestEdge(10.5, 100)).toBe(11)
    expect(nearestEdge(10.51, 100)).toBe(11)
    expect(nearestEdge(-0.4, 100)).toBe(0)
    expect(nearestEdge(-500, 100)).toBe(0)
    expect(nearestEdge(100.2, 100)).toBe(100)
    expect(nearestEdge(1e9, 100)).toBe(100)
  })

  it('returns null for positions that are not finite', () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) expect(nearestEdge(value, 100)).toBeNull()
    expect(nearestCorner({ x: Number.NaN, y: 3 }, SIZE)).toBeNull()
    expect(nearestCorner({ x: 3, y: Infinity }, SIZE)).toBeNull()
  })

  it('gives both edges of a corner, clamped on each axis', () => {
    expect(nearestCorner({ x: 12.6, y: -3 }, SIZE)).toEqual({ x: 13, y: 0 })
    expect(nearestCorner({ x: 250, y: 59.4 }, SIZE)).toEqual({ x: 100, y: 59 })
  })
})

describe('rectBetween', () => {
  it('normalises corners given in any order', () => {
    const expected = rect(10, 5, 30, 20)
    expect(rectBetween({ x: 10, y: 5 }, { x: 40, y: 25 })).toEqual(expected)
    expect(rectBetween({ x: 40, y: 25 }, { x: 10, y: 5 })).toEqual(expected)
    expect(rectBetween({ x: 40, y: 5 }, { x: 10, y: 25 })).toEqual(expected)
    expect(rectBetween({ x: 10, y: 25 }, { x: 40, y: 5 })).toEqual(expected)
  })

  it('gives null for empty rectangles: a click without a drag, or a drag along an edge (no zero-area crops)', () => {
    expect(rectBetween({ x: 10, y: 5 }, { x: 10, y: 5 })).toBeNull()
    expect(rectBetween({ x: 10, y: 5 }, { x: 10, y: 50 })).toBeNull()
    expect(rectBetween({ x: 10, y: 5 }, { x: 60, y: 5 })).toBeNull()
  })

  it('makes single-pixel rectangles', () => {
    expect(rectBetween({ x: 99, y: 59 }, { x: 100, y: 60 })).toEqual(rect(99, 59, 1, 1))
  })
})

describe('moveCropRect', () => {
  const start = rect(20, 10, 30, 20)

  it('moves by whole pixels, rounding the pointer movement, and keeps the size', () => {
    expect(moveCropRect(start, { x: 5, y: -3 }, SIZE)).toEqual(rect(25, 7, 30, 20))
    expect(moveCropRect(start, { x: 5.4, y: -2.6 }, SIZE)).toEqual(rect(25, 7, 30, 20))
    expect(moveCropRect(start, { x: 0.4, y: 0.4 }, SIZE)).toEqual(start)
  })

  it('stops at the image edges, however far the pointer goes outside', () => {
    expect(moveCropRect(start, { x: -1000, y: -1000 }, SIZE)).toEqual(rect(0, 0, 30, 20))
    expect(moveCropRect(start, { x: 1000, y: 1000 }, SIZE)).toEqual(rect(70, 40, 30, 20))
  })

  it('cannot move a whole-image rectangle, and ignores movements that are not finite', () => {
    expect(moveCropRect(wholeImageRect(SIZE), { x: 7, y: -7 }, SIZE)).toEqual(wholeImageRect(SIZE))
    expect(moveCropRect(start, { x: Number.NaN, y: 4 }, SIZE)).toEqual(rect(20, 14, 30, 20))
  })
})

describe('resizeCropRect', () => {
  const start = rect(20, 10, 30, 20) // right 50, bottom 30

  it('moves only the edges the handle names', () => {
    expect(resizeCropRect(start, 'e', { x: 5, y: 99 }, SIZE)).toEqual(rect(20, 10, 35, 20))
    expect(resizeCropRect(start, 'w', { x: 5, y: 99 }, SIZE)).toEqual(rect(25, 10, 25, 20))
    expect(resizeCropRect(start, 'n', { x: 99, y: 4 }, SIZE)).toEqual(rect(20, 14, 30, 16))
    expect(resizeCropRect(start, 's', { x: 99, y: 4 }, SIZE)).toEqual(rect(20, 10, 30, 24))
    expect(resizeCropRect(start, 'nw', { x: -5, y: -5 }, SIZE)).toEqual(rect(15, 5, 35, 25))
    expect(resizeCropRect(start, 'ne', { x: 5, y: -5 }, SIZE)).toEqual(rect(20, 5, 35, 25))
    expect(resizeCropRect(start, 'se', { x: 5, y: 5 }, SIZE)).toEqual(rect(20, 10, 35, 25))
    expect(resizeCropRect(start, 'sw', { x: -5, y: 5 }, SIZE)).toEqual(rect(15, 10, 35, 25))
  })

  it('stops at the image edges', () => {
    expect(resizeCropRect(start, 'nw', { x: -1000, y: -1000 }, SIZE)).toEqual(rect(0, 0, 50, 30))
    expect(resizeCropRect(start, 'se', { x: 1000, y: 1000 }, SIZE)).toEqual(rect(20, 10, 80, 50))
  })

  it('never turns inside out or empty: a dragged edge stops 1 pixel from the opposite edge', () => {
    expect(resizeCropRect(start, 'e', { x: -1000, y: 0 }, SIZE)).toEqual(rect(20, 10, 1, 20))
    expect(resizeCropRect(start, 'w', { x: 1000, y: 0 }, SIZE)).toEqual(rect(49, 10, 1, 20))
    expect(resizeCropRect(start, 'n', { x: 0, y: 1000 }, SIZE)).toEqual(rect(20, 29, 30, 1))
    expect(resizeCropRect(start, 's', { x: 0, y: -1000 }, SIZE)).toEqual(rect(20, 10, 30, 1))
    expect(resizeCropRect(start, 'nw', { x: 1000, y: 1000 }, SIZE)).toEqual(rect(49, 29, 1, 1))
  })

  it('rounds the pointer movement to whole pixels and ignores movements that are not finite', () => {
    expect(resizeCropRect(start, 'se', { x: 2.5, y: 2.49 }, SIZE)).toEqual(rect(20, 10, 33, 22))
    expect(resizeCropRect(start, 'se', { x: Number.NaN, y: 3 }, SIZE)).toEqual(rect(20, 10, 30, 23))
  })
})

describe('setCropField and cropFieldMaximum', () => {
  const start = rect(20, 10, 30, 20)

  it('gives each field its range: the position keeps the size within the image; the size reaches the image edge from the position', () => {
    expect(cropFieldMaximum(start, 'x', SIZE)).toBe(70)
    expect(cropFieldMaximum(start, 'y', SIZE)).toBe(40)
    expect(cropFieldMaximum(start, 'width', SIZE)).toBe(80)
    expect(cropFieldMaximum(start, 'height', SIZE)).toBe(50)
    expect(cropFieldMaximum(wholeImageRect(SIZE), 'x', SIZE)).toBe(0)
  })

  it('moves with X and Y and resizes with Width and Height, rounded and clamped', () => {
    expect(setCropField(start, 'x', 33, SIZE)).toEqual(rect(33, 10, 30, 20))
    expect(setCropField(start, 'x', 500, SIZE)).toEqual(rect(70, 10, 30, 20))
    expect(setCropField(start, 'x', -4, SIZE)).toEqual(rect(0, 10, 30, 20))
    expect(setCropField(start, 'y', 12.6, SIZE)).toEqual(rect(20, 13, 30, 20))
    expect(setCropField(start, 'width', 45, SIZE)).toEqual(rect(20, 10, 45, 20))
    expect(setCropField(start, 'width', 0, SIZE)).toEqual(rect(20, 10, 1, 20))
    expect(setCropField(start, 'width', 1e6, SIZE)).toEqual(rect(20, 10, 80, 20))
    expect(setCropField(start, 'height', -3, SIZE)).toEqual(rect(20, 10, 30, 1))
  })

  it('ignores values that are not finite and never changes its input', () => {
    const frozen = Object.freeze(rect(20, 10, 30, 20))
    for (const field of ['x', 'y', 'width', 'height'] as CropField[]) {
      expect(setCropField(frozen, field, Number.NaN, SIZE)).toEqual(frozen)
      expect(setCropField(frozen, field, Infinity, SIZE)).toEqual(frozen)
    }
  })
})

describe('every operation keeps a valid crop rectangle', () => {
  it('holds for 20,000 random moves, resizes and field changes on random images', () => {
    const next = random(42)
    const int = (below: number) => Math.floor(next() * below)
    for (let i = 0; i < 20_000; i++) {
      const size = { width: 1 + int(40), height: 1 + int(40) }
      const x = int(size.width)
      const y = int(size.height)
      const start = rect(x, y, 1 + int(size.width - x), 1 + int(size.height - y))
      expect(isValidCropRect(start, size)).toBe(true)
      const delta = { x: (next() - 0.5) * 120, y: (next() - 0.5) * 120 }
      const results = [
        moveCropRect(start, delta, size),
        resizeCropRect(start, CROP_HANDLES[int(8)], delta, size),
        setCropField(start, (['x', 'y', 'width', 'height'] as const)[int(4)], (next() - 0.3) * 80, size),
      ]
      for (const result of results) {
        if (!isValidCropRect(result, size)) throw new Error(`Invalid ${JSON.stringify({ start, size, delta, result })}`)
      }
      const a = nearestCorner({ x: (next() - 0.2) * size.width * 1.5, y: (next() - 0.2) * size.height * 1.5 }, size)!
      const b = nearestCorner({ x: (next() - 0.2) * size.width * 1.5, y: (next() - 0.2) * size.height * 1.5 }, size)!
      const between = rectBetween(a, b)
      if (between && !isValidCropRect(between, size)) throw new Error(`Invalid ${JSON.stringify({ a, b, between })}`)
    }
  })
})

describe('sameRect', () => {
  it('compares by value, with null only equal to null', () => {
    expect(sameRect(rect(1, 2, 3, 4), rect(1, 2, 3, 4))).toBe(true)
    expect(sameRect(rect(1, 2, 3, 4), rect(1, 2, 3, 5))).toBe(false)
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect(null, rect(1, 2, 3, 4))).toBe(false)
  })
})
