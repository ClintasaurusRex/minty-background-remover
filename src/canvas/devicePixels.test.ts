import { describe, expect, it } from 'vitest'
import type { Point, Size, ViewportState } from '../editor/types'
import { imageToViewport, viewportToImage, viewportToPixel } from './coordinates'
import {
  type CanvasTransform,
  backingStoreSize,
  devicePixelCentre,
  devicePixelIndex,
  deviceTransform,
  displayZoom,
  imageDrawBias,
  MAX_DISPLAY_ZOOM,
  snapToDevicePixels,
} from './devicePixels'
import { MAX_ZOOM, fitViewport, panBy, zoomAt } from './viewport'

const RATIOS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function applyTransform(t: CanvasTransform, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f }
}

function invertTransform(t: CanvasTransform, p: Point): Point {
  // Valid for the scale + translate transforms produced by deviceTransform.
  return { x: (p.x - t.e) / t.a, y: (p.y - t.f) / t.d }
}

describe('MAX_DISPLAY_ZOOM', () => {
  it('is the zoom limit, and no displayed zoom exceeds it', () => {
    expect(MAX_DISPLAY_ZOOM).toBe(MAX_ZOOM)
    for (const ratio of [1, 1.01, 1.0099999904632568, 60 / 59, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4, 60 / 55, 60 / 34]) {
      for (let zoom = 1; zoom <= MAX_ZOOM; zoom *= 1.001) expect(displayZoom(zoom, ratio)).toBeLessThanOrEqual(MAX_ZOOM * (1 + 1e-7))
      expect(displayZoom(MAX_ZOOM, ratio)).toBeLessThanOrEqual(MAX_ZOOM * (1 + 1e-7))
    }
    // Firefox at 101% scaling (60/59): 3200% was displayed as 3245% (device scale 33); now 32.
    expect(displayZoom(MAX_ZOOM, 60 / 59) * (60 / 59)).toBeCloseTo(32, 12)
    // Where 3200% is a grid scale it is displayed exactly.
    for (const ratio of [1, 1.25, 1.5, 2, 3]) expect(displayZoom(MAX_ZOOM, ratio)).toBeCloseTo(MAX_ZOOM, 12)
  })
})

describe('backingStoreSize', () => {
  it('scales the CSS size by the device pixel ratio', () => {
    expect(backingStoreSize({ width: 800, height: 600 }, 1)).toEqual({ width: 800, height: 600 })
    expect(backingStoreSize({ width: 800, height: 600 }, 2)).toEqual({ width: 1600, height: 1200 })
  })

  it('rounds fractional results to whole device pixels', () => {
    expect(backingStoreSize({ width: 1001, height: 601 }, 1.5)).toEqual({ width: 1502, height: 902 })
    expect(backingStoreSize({ width: 1000.5, height: 333.3 }, 1.25)).toEqual({
      width: 1251,
      height: 417,
    })
  })

  it('never returns a negative size', () => {
    expect(backingStoreSize({ width: 0, height: 0 }, 2)).toEqual({ width: 0, height: 0 })
    expect(backingStoreSize({ width: -5, height: 10 }, 2)).toEqual({ width: 0, height: 20 })
  })

  it('uses the device pixel size the browser lays the canvas out at, when reported', () => {
    // Measured (Phase 4 zoom follow-up): Chrome at 1.1 with the Crop tool's options row lays the
    // canvas out 638.07 CSS px tall from device 152.547: rounded edges give 701 device rows, while
    // 638.07 × 1.1 rounds to 702, and the browser then scaled the 702-row bitmap into 701 rows.
    expect(backingStoreSize({ width: 1400, height: 701.875 / 1.100000023841858 }, 1.100000023841858)).toEqual({ width: 1540, height: 702 })
    expect(backingStoreSize({ width: 1400, height: 701.875 / 1.100000023841858 }, 1.100000023841858, { width: 1540, height: 701 })).toEqual({ width: 1540, height: 701 })
    // An unusable report falls back to the rounded size.
    expect(backingStoreSize({ width: 10, height: 10 }, 2, { width: 19.5, height: 20 })).toEqual({ width: 20, height: 20 })
    expect(backingStoreSize({ width: 10, height: 10 }, 2, null)).toEqual({ width: 20, height: 20 })
  })
})

describe('deviceTransform', () => {
  it('is the viewport transform at a device pixel ratio of 1, moved right and down by the bias', () => {
    const vp: ViewportState = { zoom: 2.5, offset: { x: 10.25, y: -3 } }
    // 2.5 = 5/2: boundaries every half device pixel, shifted a quarter so none meets a centre.
    expect(deviceTransform(vp, 1)).toEqual({ a: 2.5, b: 0, c: 0, d: 2.5, e: 10.25 + 1 / 4, f: -3 + 1 / 4 })
  })

  it('scales zoom and offset by the device pixel ratio; the bias is in device pixels, from the scale', () => {
    const vp: ViewportState = { zoom: 0.5, offset: { x: 100, y: 40 } }
    // Scale 1: a whole number, drawn on its corner.
    expect(deviceTransform(vp, 2)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 200, f: 80 })
    // Scale 1.25 = 5/4: an even denominator, drawn 1/8 device pixel past its corner.
    expect(deviceTransform({ zoom: 1.25, offset: { x: 100, y: 40 } }, 1)).toEqual({ a: 1.25, b: 0, c: 0, d: 1.25, e: 100.125, f: 40.125 })
  })

  it('draws every image point at its viewport position × device pixel ratio, plus the bias', () => {
    const vp: ViewportState = { zoom: 3.7, offset: { x: -12.5, y: 41.125 } }
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 250.5, y: 99.25 },
    ]
    for (const ratio of RATIOS) {
      const transform = deviceTransform(vp, ratio)
      for (const point of points) {
        const css = imageToViewport(vp, point)
        const device = applyTransform(transform, point)
        expect(device.x).toBeCloseTo(css.x * ratio + imageDrawBias(vp.zoom * ratio), 9)
        expect(device.y).toBeCloseTo(css.y * ratio + imageDrawBias(vp.zoom * ratio), 9)
      }
    }
  })
})

describe('device pixel ratio independence', () => {
  const image: Size = { width: 3840, height: 2160 }
  const vp: ViewportState = { zoom: 0.37, offset: { x: 15.5, y: -60.25 } }

  it('hit-tests the same pixel that is drawn under a device pixel, at every ratio', () => {
    // A pointer reported in CSS pixels sits over device pixel (css × ratio). The image
    // point drawn there must be the one hit-testing returns: the exact pointer position
    // (viewportToPixel) is the drawn position less the bias.
    const pointers: Point[] = [
      { x: 16, y: 1 },
      { x: 700.5, y: 400.75 },
      { x: 1435.1, y: 738.9 },
    ]
    for (const ratio of RATIOS) {
      const transform = deviceTransform(vp, ratio)
      for (const pointer of pointers) {
        const bias = imageDrawBias(vp.zoom * ratio)
        const drawn = invertTransform(transform, { x: pointer.x * ratio + bias, y: pointer.y * ratio + bias })
        const hit = viewportToImage(vp, pointer)
        expect(hit.x).toBeCloseTo(drawn.x, 9)
        expect(hit.y).toBeCloseTo(drawn.y, 9)
        expect(viewportToPixel(vp, pointer, image)).toEqual({
          x: Math.floor(drawn.x),
          y: Math.floor(drawn.y),
        })
      }
    }
  })

  it('produces the same viewport state from the same CSS inputs at every ratio', () => {
    // Viewport operations take no ratio, so moving between displays cannot shift the
    // view or change which pixel the pointer is over.
    const view: Size = { width: 1280, height: 720 }
    const run = () => panBy(zoomAt(fitViewport(image, view), { x: 300, y: 200 }, 4), { x: 25, y: -10 })
    const results = RATIOS.map(run)
    for (const result of results) expect(result).toEqual(results[0])
  })
})

describe('snapToDevicePixels', () => {
  const offsets: Point[] = [
    { x: 0, y: 0 },
    { x: 333.5, y: 0.125 },
    { x: -1234.567, y: 89.1 },
    { x: 0.2, y: 0.8 },
  ]

  it('puts the image origin on a whole device pixel (drawn the bias past it)', () => {
    for (const ratio of RATIOS) {
      for (const offset of offsets) {
        const snapped = snapToDevicePixels({ zoom: 2, offset }, ratio)
        const { e, f } = deviceTransform(snapped, ratio)
        const bias = imageDrawBias(2 * ratio)
        expect(e - bias).toBeCloseTo(Math.round(e - bias), 9)
        expect(f - bias).toBeCloseTo(Math.round(f - bias), 9)
      }
    }
  })

  it('moves the image by at most half a device pixel and keeps the zoom', () => {
    for (const ratio of RATIOS) {
      for (const offset of offsets) {
        const snapped = snapToDevicePixels({ zoom: 0.75, offset }, ratio)
        expect(snapped.zoom).toBe(0.75)
        expect(Math.abs(snapped.offset.x - offset.x)).toBeLessThanOrEqual(0.5 / ratio + 1e-9)
        expect(Math.abs(snapped.offset.y - offset.y)).toBeLessThanOrEqual(0.5 / ratio + 1e-9)
      }
    }
  })

  it('is idempotent', () => {
    for (const ratio of RATIOS) {
      for (const offset of offsets) {
        const once = snapToDevicePixels({ zoom: 1, offset }, ratio)
        expect(snapToDevicePixels(once, ratio)).toEqual(once)
      }
    }
  })

  it('leaves already-aligned offsets unchanged', () => {
    expect(snapToDevicePixels({ zoom: 1, offset: { x: 12, y: -7 } }, 1).offset).toEqual({
      x: 12,
      y: -7,
    })
    expect(snapToDevicePixels({ zoom: 1, offset: { x: 12.5, y: -7.5 } }, 2).offset).toEqual({
      x: 12.5,
      y: -7.5,
    })
  })
})

describe('devicePixelCentre', () => {
  it('moves any point inside a device pixel to that device pixel\'s centre', () => {
    expect(devicePixelCentre({ x: 4, y: 7.9 }, 1)).toEqual({ x: 4.5, y: 7.5 })
    expect(devicePixelCentre({ x: 4.5, y: 0 }, 2)).toEqual({ x: 4.75, y: 0.25 })
    expect(devicePixelCentre({ x: -0.1, y: 0 }, 1)).toEqual({ x: -0.5, y: 0.5 })
  })

  it('places a position rounded to just before a device pixel edge in the next device pixel', () => {
    // Device row 189 at ratio 1.25 starts at CSS 151.2; DOM rounding can report 151.19999.
    expect(devicePixelCentre({ x: 0, y: 151.19999 }, 1.25).y * 1.25).toBeCloseTo(189.5, 9)
    // 101.333… at ratio 1.5, as an element position, is device pixel 152.
    expect(devicePixelCentre({ x: 101.33333, y: 0 }, 1.5).x * 1.5).toBeCloseTo(152.5, 9)
    // Anything further from the edge stays where it is.
    expect(devicePixelCentre({ x: 151.19, y: 0 }, 1.25).x * 1.25).toBeCloseTo(188.5, 9)
  })

  it('keeps the point inside the same device pixel at every ratio', () => {
    for (const ratio of RATIOS) {
      for (const x of [0, 0.3, 1, 17.77, 401.6, 999.9]) {
        const centre = devicePixelCentre({ x, y: x }, ratio)
        expect(Math.floor(centre.x * ratio)).toBe(Math.floor(x * ratio))
        expect(centre.x * ratio - Math.floor(centre.x * ratio)).toBeCloseTo(0.5, 9)
      }
    }
  })
})

describe('devicePixelIndex', () => {
  it('finds the device pixel of pointer positions as browsers deliver them at fractional ratios', () => {
    // Recorded from headless Firefox (Phase 4 audit): it moves the pointer to the nearest device
    // pixel corner and reports it as a 32-bit float, a hair either side of the corner.
    expect(devicePixelIndex(100.80000305175781, 1.25)).toBe(126)
    expect(devicePixelIndex(103.19999694824219, 1.25)).toBe(129)
    expect(devicePixelIndex(56.79999923706055, 1.25)).toBe(71)
    expect(devicePixelIndex(101.33333587646484, 1.5)).toBe(152)
    expect(devicePixelIndex(57.33333206176758, 1.5)).toBe(86)
    // Chrome reports the position asked for, which may be inside a device pixel.
    expect(devicePixelIndex(100.5, 1.25)).toBe(125)
    expect(devicePixelIndex(102.20000457763672, 1.25)).toBe(127)
  })

  it('agrees with devicePixelCentre', () => {
    for (const ratio of RATIOS) {
      for (const x of [0, 0.3, 1, 17.77, 401.6, 999.9, 151.19999]) {
        expect(devicePixelIndex(x, ratio) + 0.5).toBeCloseTo(devicePixelCentre({ x, y: 0 }, ratio).x * ratio, 9)
      }
    }
  })
})
