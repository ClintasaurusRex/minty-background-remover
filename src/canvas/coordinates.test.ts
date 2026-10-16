import { describe, expect, it } from 'vitest'
import type { Point, Size, ViewportState } from '../editor/types'
import {
  clientToViewport,
  imageRectInViewport,
  imageToViewport,
  viewportToImage,
  viewportToPixel,
} from './coordinates'

const ZOOMS = [0.01, 0.1, 0.25, 0.5, 1, 1.5, 3.7, 32]
const OFFSETS: Point[] = [
  { x: 0, y: 0 },
  { x: 10.25, y: -7.5 },
  { x: 333.5, y: 0.125 },
  { x: -1234.567, y: 89.1 },
]

function viewport(zoom: number, offset: Point): ViewportState {
  return { zoom, offset }
}

describe('clientToViewport', () => {
  it('subtracts the element position, keeping fractional values', () => {
    expect(clientToViewport({ x: 150.5, y: 220.25 }, { left: 100, top: 120.25 })).toEqual({
      x: 50.5,
      y: 100,
    })
  })

  it('returns negative values for points above or left of the element', () => {
    expect(clientToViewport({ x: 90, y: 100 }, { left: 100, top: 120 })).toEqual({
      x: -10,
      y: -20,
    })
  })
})

describe('imageToViewport / viewportToImage', () => {
  it('maps known points with a fractional offset', () => {
    const vp = viewport(2, { x: 10.5, y: -3.25 })
    expect(imageToViewport(vp, { x: 0, y: 0 })).toEqual({ x: 10.5, y: -3.25 })
    expect(imageToViewport(vp, { x: 3, y: 4 })).toEqual({ x: 16.5, y: 4.75 })
    expect(viewportToImage(vp, { x: 16.5, y: 4.75 })).toEqual({ x: 3, y: 4 })
  })

  it('maps the image origin to the offset at every zoom', () => {
    for (const zoom of ZOOMS) {
      for (const offset of OFFSETS) {
        expect(imageToViewport(viewport(zoom, offset), { x: 0, y: 0 })).toEqual(offset)
      }
    }
  })

  it('round-trips image → viewport → image across zooms and offsets', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 17.3, y: 4021.9 },
      { x: 3839.999, y: 2159.001 },
      { x: -12, y: 16384 },
    ]
    for (const zoom of ZOOMS) {
      for (const offset of OFFSETS) {
        const vp = viewport(zoom, offset)
        for (const point of points) {
          const result = viewportToImage(vp, imageToViewport(vp, point))
          expect(result.x).toBeCloseTo(point.x, 6)
          expect(result.y).toBeCloseTo(point.y, 6)
        }
      }
    }
  })

  it('round-trips viewport → image → viewport across zooms and offsets', () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 640.5, y: 360.25 },
      { x: -50, y: 2000.75 },
    ]
    for (const zoom of ZOOMS) {
      for (const offset of OFFSETS) {
        const vp = viewport(zoom, offset)
        for (const point of points) {
          const result = imageToViewport(vp, viewportToImage(vp, point))
          expect(result.x).toBeCloseTo(point.x, 6)
          expect(result.y).toBeCloseTo(point.y, 6)
        }
      }
    }
  })
})

describe('viewportToPixel', () => {
  const image: Size = { width: 5, height: 4 }

  it('maps the centre of every pixel back to that pixel at every zoom and offset', () => {
    for (const zoom of ZOOMS) {
      for (const offset of OFFSETS) {
        const vp = viewport(zoom, offset)
        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            const centre = imageToViewport(vp, { x: x + 0.5, y: y + 0.5 })
            expect(viewportToPixel(vp, centre, image)).toEqual({ x, y })
          }
        }
      }
    }
  })

  describe('half-open boundaries (zoom 2, offset 0.5, 0.25; image 4 × 3)', () => {
    // Exactly representable values, so boundaries are tested without float noise.
    // Image x edges in viewport space: 0.5, 2.5, 4.5, 6.5, 8.5. Y edges: 0.25 … 6.25.
    const vp = viewport(2, { x: 0.5, y: 0.25 })
    const size: Size = { width: 4, height: 3 }

    it('includes the left and top image edges', () => {
      expect(viewportToPixel(vp, { x: 0.5, y: 0.25 }, size)).toEqual({ x: 0, y: 0 })
    })

    it('assigns a shared pixel boundary to the right/lower pixel', () => {
      expect(viewportToPixel(vp, { x: 2.5, y: 2.25 }, size)).toEqual({ x: 1, y: 1 })
      expect(viewportToPixel(vp, { x: 2.4375, y: 2.1875 }, size)).toEqual({ x: 0, y: 0 })
    })

    it('includes points just inside the right and bottom edges', () => {
      expect(viewportToPixel(vp, { x: 8.4375, y: 6.1875 }, size)).toEqual({ x: 3, y: 2 })
    })

    it('excludes the right and bottom edges themselves', () => {
      expect(viewportToPixel(vp, { x: 8.5, y: 1 }, size)).toBeNull()
      expect(viewportToPixel(vp, { x: 1, y: 6.25 }, size)).toBeNull()
    })

    it('excludes points just outside the left and top edges', () => {
      expect(viewportToPixel(vp, { x: 0.4375, y: 1 }, size)).toBeNull()
      expect(viewportToPixel(vp, { x: 1, y: 0.1875 }, size)).toBeNull()
    })
  })

  it('returns null for out-of-bounds pointer positions', () => {
    const vp = viewport(1.5, { x: 100.25, y: 50.75 })
    const outside: Point[] = [
      { x: 0, y: 0 },
      { x: -1000, y: 60 },
      { x: 105, y: -1000 },
      { x: 1e9, y: 60 },
      { x: 105, y: 1e9 },
      { x: Number.NaN, y: 60 },
      { x: 105, y: Number.NaN },
      { x: Number.POSITIVE_INFINITY, y: 60 },
    ]
    for (const point of outside) {
      expect(viewportToPixel(vp, point, image)).toBeNull()
    }
  })

  it('returns integer pixels when zoomed out so one CSS pixel spans several image pixels', () => {
    const vp = viewport(0.25, { x: 0, y: 0 })
    const big: Size = { width: 3840, height: 2160 }
    expect(viewportToPixel(vp, { x: 0.3, y: 0.9 }, big)).toEqual({ x: 1, y: 3 })
    expect(viewportToPixel(vp, { x: 959.99, y: 539.99 }, big)).toEqual({ x: 3839, y: 2159 })
    expect(viewportToPixel(vp, { x: 960, y: 10 }, big)).toBeNull()
  })

  it('resolves sub-pixel positions at maximum zoom', () => {
    // At 3200% each image pixel spans 32 CSS pixels.
    const vp = viewport(32, { x: -100, y: -100 })
    const big: Size = { width: 100, height: 100 }
    expect(viewportToPixel(vp, { x: 0, y: 0 }, big)).toEqual({ x: 3, y: 3 })
    expect(viewportToPixel(vp, { x: 27.999, y: 27.999 }, big)).toEqual({ x: 3, y: 3 })
    expect(viewportToPixel(vp, { x: 28, y: 28 }, big)).toEqual({ x: 4, y: 4 })
  })

  it('works for a 1 × 1 image', () => {
    const vp = viewport(1, { x: 10, y: 10 })
    const one: Size = { width: 1, height: 1 }
    expect(viewportToPixel(vp, { x: 10, y: 10 }, one)).toEqual({ x: 0, y: 0 })
    expect(viewportToPixel(vp, { x: 10.999, y: 10.999 }, one)).toEqual({ x: 0, y: 0 })
    expect(viewportToPixel(vp, { x: 11, y: 10 }, one)).toBeNull()
  })
})

describe('imageRectInViewport', () => {
  it('places the image at the offset, scaled by zoom', () => {
    expect(imageRectInViewport(viewport(0.5, { x: 12.5, y: -3 }), { width: 3840, height: 2160 })).toEqual({
      x: 12.5,
      y: -3,
      width: 1920,
      height: 1080,
    })
  })

  it('does not change the image size it is given', () => {
    const size: Size = { width: 800, height: 600 }
    imageRectInViewport(viewport(4, { x: 0, y: 0 }), size)
    expect(size).toEqual({ width: 800, height: 600 })
  })
})
