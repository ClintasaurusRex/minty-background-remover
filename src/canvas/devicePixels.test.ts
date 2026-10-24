import { describe, expect, it } from 'vitest'
import type { Point, Size, ViewportState } from '../editor/types'
import { imageToViewport, viewportToImage, viewportToPixel } from './coordinates'
import {
  type CanvasTransform,
  backingStoreSize,
  deviceTransform,
  snapToDevicePixels,
} from './devicePixels'
import { fitViewport, panBy, zoomAt } from './viewport'

const RATIOS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function applyTransform(t: CanvasTransform, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f }
}

function invertTransform(t: CanvasTransform, p: Point): Point {
  // Valid for the scale + translate transforms produced by deviceTransform.
  return { x: (p.x - t.e) / t.a, y: (p.y - t.f) / t.d }
}

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
})

describe('deviceTransform', () => {
  it('is the viewport transform at a device pixel ratio of 1', () => {
    const vp: ViewportState = { zoom: 2.5, offset: { x: 10.25, y: -3 } }
    expect(deviceTransform(vp, 1)).toEqual({ a: 2.5, b: 0, c: 0, d: 2.5, e: 10.25, f: -3 })
  })

  it('scales zoom and offset by the device pixel ratio', () => {
    const vp: ViewportState = { zoom: 0.5, offset: { x: 100, y: 40 } }
    expect(deviceTransform(vp, 2)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 200, f: 80 })
  })

  it('draws every image point at its viewport position × device pixel ratio', () => {
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
        expect(device.x).toBeCloseTo(css.x * ratio, 9)
        expect(device.y).toBeCloseTo(css.y * ratio, 9)
      }
    }
  })
})

describe('device pixel ratio independence', () => {
  const image: Size = { width: 3840, height: 2160 }
  const vp: ViewportState = { zoom: 0.37, offset: { x: 15.5, y: -60.25 } }

  it('hit-tests the same pixel that is drawn under a device pixel, at every ratio', () => {
    // A pointer reported in CSS pixels sits over device pixel (css × ratio). The image
    // point drawn there must be the one hit-testing returns.
    const pointers: Point[] = [
      { x: 16, y: 1 },
      { x: 700.5, y: 400.75 },
      { x: 1435.1, y: 738.9 },
    ]
    for (const ratio of RATIOS) {
      const transform = deviceTransform(vp, ratio)
      for (const pointer of pointers) {
        const drawn = invertTransform(transform, { x: pointer.x * ratio, y: pointer.y * ratio })
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

  it('puts the image origin on a whole device pixel', () => {
    for (const ratio of RATIOS) {
      for (const offset of offsets) {
        const snapped = snapToDevicePixels({ zoom: 2, offset }, ratio)
        const { e, f } = deviceTransform(snapped, ratio)
        expect(e).toBeCloseTo(Math.round(e), 9)
        expect(f).toBeCloseTo(Math.round(f), 9)
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
