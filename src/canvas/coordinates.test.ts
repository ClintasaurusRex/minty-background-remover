import { describe, expect, it } from 'vitest'
import type { Point, Size, ViewportState } from '../editor/types'
import {
  clientToViewport,
  imageIndexAtDevicePixel,
  imageRectInViewport,
  imageSpanAtDevicePixel,
  imageToViewport,
  pixelUnderPointer,
  viewportToImage,
  viewportToPixel,
} from './coordinates'
import { snapToDevicePixels } from './devicePixels'

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

describe('pixelUnderPointer', () => {
  const size: Size = { width: 10, height: 10 }

  it('hit-tests the centre of the pointer\'s device pixel', () => {
    // Pixel edge at x = 4.37 lies inside device pixel 4 (ratio 1), which shows pixel 1.
    const view = viewport(4.37, { x: 0, y: 0 })
    expect(viewportToPixel(view, { x: 4, y: 0 }, size)).toEqual({ x: 0, y: 0 })
    expect(pixelUnderPointer(view, { x: 4, y: 0 }, size, 1)).toEqual({ x: 1, y: 0 })
    expect(pixelUnderPointer(view, { x: 4.9, y: 0 }, size, 1)).toEqual({ x: 1, y: 0 })
    expect(pixelUnderPointer(view, { x: 3.9, y: 0 }, size, 1)).toEqual({ x: 0, y: 0 })
    // At ratio 2 the same CSS position is in device pixel 8, centred at CSS 4.25: pixel 0.
    expect(pixelUnderPointer(view, { x: 4, y: 0 }, size, 2)).toEqual({ x: 0, y: 0 })
  })

  it('gives an edge through a device pixel centre to the left or upper pixel, as the canvas draws it', () => {
    // Zoom 1.5, ratio 1: device pixel 1 is centred at 1.5, exactly on the edge between
    // image pixels 0 and 1. Chrome and Firefox fill it with pixel 0.
    const view = viewport(1.5, { x: 0, y: 0 })
    expect(pixelUnderPointer(view, { x: 1.2, y: 1.2 }, size, 1)).toEqual({ x: 0, y: 0 })
    expect(pixelUnderPointer(view, { x: 2, y: 2 }, size, 1)).toEqual({ x: 1, y: 1 })
    // Zoom 1, ratio 1.25 (125% display scaling): device pixel 2 is centred at CSS 2.0.
    expect(pixelUnderPointer(viewport(1, { x: 0, y: 0 }), { x: 1.7, y: 0 }, size, 1.25)).toEqual({ x: 1, y: 0 })
    // With a snapped fractional offset, where floating-point error lands either side of the edge.
    const offset = viewport(2.5, { x: 444.8, y: 146.4 })
    for (let device = 556; device < 600; device++) {
      const centre = (device + 0.5) / 1.25
      const exact = (device + 0.5 - 556) / (2.5 * 1.25)
      const expected = Number.isInteger(exact) ? exact - 1 : Math.floor(exact)
      expect(pixelUnderPointer(offset, { x: centre, y: 150 }, { width: 100, height: 100 }, 1.25)?.x).toBe(expected)
    }
  })

  it('agrees with viewportToPixel wherever no edge passes through a device pixel centre', () => {
    const view = viewport(3, { x: 6, y: 9 })
    for (let x = 0; x < 50; x += 0.5) {
      expect(pixelUnderPointer(view, { x, y: x }, size, 2)).toEqual(viewportToPixel(view, { x, y: x }, size))
    }
  })

  it('returns null outside the image', () => {
    const view = viewport(2, { x: 10, y: 10 })
    expect(pixelUnderPointer(view, { x: 9.9, y: 15 }, size, 1)).toBeNull()
    expect(pixelUnderPointer(view, { x: 30, y: 15 }, size, 1)).toBeNull()
    expect(pixelUnderPointer(view, { x: Number.NaN, y: 15 }, size, 1)).toBeNull()
    expect(pixelUnderPointer(view, { x: 29.9, y: 29.9 }, size, 1)).toEqual({ x: 9, y: 9 })
    expect(pixelUnderPointer(view, { x: 10, y: 10 }, size, 1)).toEqual({ x: 0, y: 0 })
  })
})

describe('imageIndexAtDevicePixel', () => {
  it('gives the pixel at the device pixel centre, an edge through the centre going left or up', () => {
    // 150%: device pixel 1 is centred at image x = 1, exactly on the edge between pixels 0 and 1.
    expect([0, 1, 2, 3].map((device) => imageIndexAtDevicePixel(device, 1.5))).toEqual([0, 0, 1, 2])
    expect([0, 1, 2].map((device) => imageIndexAtDevicePixel(device, 1))).toEqual([0, 1, 2])
    expect(imageIndexAtDevicePixel(-1, 4)).toBe(-1)
    expect(imageIndexAtDevicePixel(31, 32)).toBe(0)
    expect(imageIndexAtDevicePixel(32, 32)).toBe(1)
  })

  it('agrees with pixelUnderPointer for every device pixel, at any snapped zoom, offset and ratio', () => {
    const size: Size = { width: 40, height: 30 }
    for (const ratio of [1, 1.25, 1.5, 2, 2.5]) {
      for (const zoom of [1, 1.5, 2.5, 3, 4.37, 8, 32, 1 / ratio]) {
        if (zoom * ratio < 1) continue
        const view = snapToDevicePixels({ zoom, offset: { x: 13.37, y: -7.9 } }, ratio)
        const origin = Math.round(view.offset.x * ratio)
        for (let device = 0; device < 400; device++) {
          const expected = pixelUnderPointer(view, { x: (device + 0.5) / ratio, y: 1 }, { width: 1e6, height: 1e6 }, ratio)
          const index = imageIndexAtDevicePixel(device - origin, zoom * ratio)
          expect(index >= 0 ? index : null).toBe(expected ? expected.x : null)
        }
        // Rows use the same rule.
        const top = Math.round(view.offset.y * ratio)
        for (let device = 0; device < 100; device++) {
          const expected = pixelUnderPointer(view, { x: view.offset.x + 0.5 * zoom, y: (device + 0.5) / ratio }, size, ratio)
          const index = imageIndexAtDevicePixel(device - top, zoom * ratio)
          expect(index >= 0 && index < size.height ? index : null).toBe(expected ? expected.y : null)
        }
      }
    }
  })
})

describe('imageSpanAtDevicePixel', () => {
  it('lists the image pixels a device pixel overlaps when zoomed out', () => {
    // 50%: each device pixel covers exactly two image pixels.
    expect(imageSpanAtDevicePixel(0, 0.5)).toEqual({ first: 0, last: 1 })
    expect(imageSpanAtDevicePixel(3, 0.5)).toEqual({ first: 6, last: 7 })
    // 40%: device pixel 1 covers image x 2.5 to 5, so pixels 2, 3 and 4.
    expect(imageSpanAtDevicePixel(1, 0.4)).toEqual({ first: 2, last: 4 })
    expect(imageSpanAtDevicePixel(-1, 0.5)).toEqual({ first: -2, last: -1 })
  })

  it('covers every image pixel, sharing only pixels that straddle a device pixel edge', () => {
    for (const scale of [0.9, 0.5, 0.37, 0.1, 1 / 3, 0.0625]) {
      let previous = imageSpanAtDevicePixel(0, scale)
      expect(previous.first).toBe(0)
      for (let device = 1; device < 200; device++) {
        const span = imageSpanAtDevicePixel(device, scale)
        expect(span.first).toBeLessThanOrEqual(span.last)
        // No gap; an overlap only when the boundary falls inside an image pixel.
        const edge = device / scale
        const straddles = Math.abs(edge - Math.round(edge)) > 1e-6
        expect(span.first).toBe(straddles ? previous.last : previous.last + 1)
        previous = span
      }
    }
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
