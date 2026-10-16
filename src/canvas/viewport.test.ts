import { describe, expect, it } from 'vitest'
import type { Point, Size, ViewportState } from '../editor/types'
import { imageRectInViewport, imageToViewport, viewportToImage, viewportToPixel } from './coordinates'
import {
  DEFAULT_FIT_MARGIN,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  centredOffset,
  clampZoom,
  fitViewport,
  fitZoom,
  nextZoomStep,
  panBy,
  resizeViewport,
  zoomAt,
  zoomAtCentre,
} from './viewport'

function expectPointClose(actual: Point, expected: Point, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
}

function centreOf(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 }
}

describe('clampZoom', () => {
  it('keeps zoom within 1%–3200%', () => {
    expect(clampZoom(0.001)).toBe(MIN_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(-2)).toBe(MIN_ZOOM)
    expect(clampZoom(100)).toBe(MAX_ZOOM)
    expect(clampZoom(0.37)).toBe(0.37)
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
  })

  it('handles non-finite input', () => {
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('uses the approved range', () => {
    expect(MIN_ZOOM).toBe(0.01)
    expect(MAX_ZOOM).toBe(32)
  })
})

describe('ZOOM_STEPS', () => {
  it('ascends strictly from MIN_ZOOM to MAX_ZOOM and includes 100%', () => {
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM)
    expect(ZOOM_STEPS.at(-1)).toBe(MAX_ZOOM)
    expect(ZOOM_STEPS).toContain(1)
    for (let i = 1; i < ZOOM_STEPS.length; i++) {
      expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1])
    }
  })
})

describe('nextZoomStep', () => {
  it('moves one stop from a stop', () => {
    expect(nextZoomStep(1, 1)).toBe(1.5)
    expect(nextZoomStep(1, -1)).toBe(2 / 3)
    expect(nextZoomStep(0.5, -1)).toBe(1 / 3)
  })

  it('moves to the nearest stop in that direction from an off-ladder zoom', () => {
    expect(nextZoomStep(0.9, 1)).toBe(1)
    expect(nextZoomStep(0.9, -1)).toBe(2 / 3)
    expect(nextZoomStep(0.2384, 1)).toBe(0.25)
    expect(nextZoomStep(0.2384, -1)).toBe(1 / 6)
  })

  it('ignores floating-point noise around a stop', () => {
    expect(nextZoomStep(1.0000000000001, 1)).toBe(1.5)
    expect(nextZoomStep(0.9999999999999, -1)).toBe(2 / 3)
    expect(nextZoomStep(0.333333333333, 1)).toBe(0.5)
  })

  it('stays at the limits', () => {
    expect(nextZoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(nextZoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('walks the whole ladder in both directions', () => {
    const up = [MIN_ZOOM]
    while (up.at(-1) !== MAX_ZOOM) up.push(nextZoomStep(up.at(-1)!, 1))
    expect(up).toEqual(ZOOM_STEPS)

    const down = [MAX_ZOOM]
    while (down.at(-1) !== MIN_ZOOM) down.push(nextZoomStep(down.at(-1)!, -1))
    expect(down).toEqual([...ZOOM_STEPS].reverse())
  })
})

describe('zoomAt', () => {
  const start: ViewportState = { zoom: 1.5, offset: { x: 37.25, y: -112.5 } }
  const anchors: Point[] = [
    { x: 0, y: 0 },
    { x: 412.75, y: 300.125 },
    { x: 1919, y: 1079 },
    { x: -40, y: 25 }, // anchors outside the image are still kept fixed
  ]
  const targets = [0.01, 0.1, 0.5, 1, 2, 3.7, 32]

  it('keeps the image point under the anchor fixed', () => {
    for (const anchor of anchors) {
      for (const zoom of targets) {
        const before = viewportToImage(start, anchor)
        const next = zoomAt(start, anchor, zoom)
        expect(next.zoom).toBe(zoom)
        expectPointClose(viewportToImage(next, anchor), before)
      }
    }
  })

  it('keeps the same pixel under the pointer', () => {
    const image: Size = { width: 3840, height: 2160 }
    const vp: ViewportState = { zoom: 0.25, offset: { x: 20.5, y: 30.5 } }
    const pointer = { x: 500.3, y: 270.7 }
    const pixel = viewportToPixel(vp, pointer, image)
    for (const zoom of [0.5, 1, 4, 32]) {
      expect(viewportToPixel(zoomAt(vp, pointer, zoom), pointer, image)).toEqual(pixel)
    }
  })

  it('clamps the requested zoom and still keeps the anchor fixed', () => {
    const anchor = { x: 250, y: 125 }
    const before = viewportToImage(start, anchor)

    const zoomedIn = zoomAt(start, anchor, 500)
    expect(zoomedIn.zoom).toBe(MAX_ZOOM)
    expectPointClose(viewportToImage(zoomedIn, anchor), before)

    const zoomedOut = zoomAt(start, anchor, 0)
    expect(zoomedOut.zoom).toBe(MIN_ZOOM)
    expectPointClose(viewportToImage(zoomedOut, anchor), before)
  })

  it('leaves the offset unchanged when the anchor is the image origin', () => {
    const next = zoomAt(start, start.offset, 4)
    expectPointClose(next.offset, start.offset)
  })

  it('leaves the viewport unchanged when the zoom does not change', () => {
    const next = zoomAt(start, { x: 500, y: 400 }, start.zoom)
    expectPointClose(next.offset, start.offset)
    expect(next.zoom).toBe(start.zoom)
  })

  it('returns to the original viewport after zooming in and back out at the same anchor', () => {
    let vp = start
    const anchor = { x: 321.5, y: 123.25 }
    // 150% → 2400% and back, staying below the clamp so every step is reversible.
    for (let i = 0; i < 8; i++) vp = zoomAt(vp, anchor, nextZoomStep(vp.zoom, 1))
    expect(vp.zoom).toBe(24)
    for (let i = 0; i < 8; i++) vp = zoomAt(vp, anchor, nextZoomStep(vp.zoom, -1))
    expect(vp.zoom).toBe(start.zoom)
    expectPointClose(vp.offset, start.offset)
  })

  it('does not mutate its input', () => {
    const vp: ViewportState = { zoom: 1, offset: { x: 5, y: 6 } }
    zoomAt(vp, { x: 100, y: 100 }, 2)
    expect(vp).toEqual({ zoom: 1, offset: { x: 5, y: 6 } })
  })
})

describe('zoomAtCentre', () => {
  it('keeps the image point at the viewport centre fixed', () => {
    const size: Size = { width: 1280, height: 720 }
    const vp: ViewportState = { zoom: 0.37, offset: { x: -55.5, y: 12.75 } }
    const before = viewportToImage(vp, centreOf(size))
    const next = zoomAtCentre(vp, size, 1)
    expect(next.zoom).toBe(1)
    expectPointClose(viewportToImage(next, centreOf(size)), before)
  })
})

describe('centredOffset', () => {
  it('centres the image, using negative offsets when it overflows', () => {
    expect(centredOffset({ width: 100, height: 50 }, { width: 1000, height: 800 }, 1)).toEqual({
      x: 450,
      y: 375,
    })
    expect(centredOffset({ width: 4000, height: 3000 }, { width: 1000, height: 800 }, 1)).toEqual({
      x: -1500,
      y: -1100,
    })
  })

  it('places the image centre at the viewport centre at any zoom', () => {
    const image: Size = { width: 333, height: 777 }
    const view: Size = { width: 1001, height: 599 }
    for (const zoom of [0.05, 0.5, 1, 2.5, 32]) {
      const vp = { zoom, offset: centredOffset(image, view, zoom) }
      expectPointClose(imageToViewport(vp, centreOf(image)), centreOf(view))
    }
  })
})

describe('fitZoom / fitViewport', () => {
  const view: Size = { width: 1000, height: 800 }

  it('uses the workspace padding as the default margin', () => {
    expect(DEFAULT_FIT_MARGIN).toBe(24)
  })

  it('scales a larger image down to fit and centres it', () => {
    const vp = fitViewport({ width: 4000, height: 2000 }, view, 0)
    expect(vp.zoom).toBe(0.25)
    expect(vp.offset).toEqual({ x: 0, y: 150 })
  })

  it('is limited by the tighter axis', () => {
    // Tall image: height is the constraint.
    expect(fitZoom({ width: 500, height: 4000 }, view, 0)).toBe(0.2)
    // Wide image: width is the constraint.
    expect(fitZoom({ width: 5000, height: 1000 }, view, 0)).toBe(0.2)
  })

  it('leaves the margin on the constrained axis', () => {
    const image: Size = { width: 3840, height: 2160 }
    const vp = fitViewport(image, view)
    expect(vp.zoom).toBeCloseTo((1000 - 48) / 3840, 12)
    const rect = imageRectInViewport(vp, image)
    expect(rect.x).toBeCloseTo(DEFAULT_FIT_MARGIN, 9)
    expect(rect.x + rect.width).toBeCloseTo(view.width - DEFAULT_FIT_MARGIN, 9)
    expect(rect.y).toBeGreaterThan(DEFAULT_FIT_MARGIN)
    expect(rect.y + rect.height).toBeLessThan(view.height - DEFAULT_FIT_MARGIN)
  })

  it('shows smaller images at 100% without upscaling, centred', () => {
    const vp = fitViewport({ width: 100, height: 50 }, view)
    expect(vp.zoom).toBe(1)
    expect(vp.offset).toEqual({ x: 450, y: 375 })
  })

  it('shows an image that exactly fits the available area at 100%', () => {
    expect(fitZoom({ width: 952, height: 752 }, view)).toBe(1)
    expect(fitZoom({ width: 953, height: 752 }, view)).toBeLessThan(1)
  })

  it('keeps the whole fitted image inside the margin for a range of sizes', () => {
    const images: Size[] = [
      { width: 1, height: 1 },
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 7680, height: 4320 },
      { width: 16384, height: 3052 },
    ]
    for (const image of images) {
      const rect = imageRectInViewport(fitViewport(image, view), image)
      expect(rect.x).toBeGreaterThanOrEqual(DEFAULT_FIT_MARGIN - 1e-9)
      expect(rect.y).toBeGreaterThanOrEqual(DEFAULT_FIT_MARGIN - 1e-9)
      expect(rect.x + rect.width).toBeLessThanOrEqual(view.width - DEFAULT_FIT_MARGIN + 1e-9)
      expect(rect.y + rect.height).toBeLessThanOrEqual(view.height - DEFAULT_FIT_MARGIN + 1e-9)
    }
  })

  it('clamps to MIN_ZOOM when even 1% does not fit, and still centres', () => {
    const image: Size = { width: 16384, height: 16384 }
    const tiny: Size = { width: 100, height: 100 }
    const vp = fitViewport(image, tiny)
    expect(vp.zoom).toBe(MIN_ZOOM)
    expectPointClose(imageToViewport(vp, centreOf(image)), centreOf(tiny))
  })

  it('produces finite values for a zero-sized viewport or an oversized margin', () => {
    for (const vp of [
      fitViewport({ width: 800, height: 600 }, { width: 0, height: 0 }),
      fitViewport({ width: 800, height: 600 }, { width: 30, height: 30 }, 100),
    ]) {
      expect(vp.zoom).toBe(MIN_ZOOM)
      expect(Number.isFinite(vp.offset.x)).toBe(true)
      expect(Number.isFinite(vp.offset.y)).toBe(true)
    }
  })

  it('does not change the image size it is given', () => {
    const image: Size = { width: 3840, height: 2160 }
    fitViewport(image, view)
    expect(image).toEqual({ width: 3840, height: 2160 })
  })
})

describe('panBy', () => {
  const start: ViewportState = { zoom: 2.5, offset: { x: 10.25, y: -4.5 } }

  it('moves the image by the drag distance without changing zoom', () => {
    const next = panBy(start, { x: 30.5, y: -12.25 })
    expect(next.zoom).toBe(2.5)
    expect(next.offset).toEqual({ x: 40.75, y: -16.75 })
  })

  it('moves every image point on screen by the same delta', () => {
    const delta = { x: -123.5, y: 77.75 }
    const next = panBy(start, delta)
    for (const point of [{ x: 0, y: 0 }, { x: 99.5, y: 3.25 }]) {
      const before = imageToViewport(start, point)
      expectPointClose(imageToViewport(next, point), { x: before.x + delta.x, y: before.y + delta.y })
    }
  })

  it('keeps the same pixel under a pointer that moves with the drag', () => {
    const image: Size = { width: 64, height: 64 }
    const pointer = { x: 50.3, y: 60.6 }
    const delta = { x: 17.9, y: -8.4 }
    const pixel = viewportToPixel(start, pointer, image)
    const moved = { x: pointer.x + delta.x, y: pointer.y + delta.y }
    expect(viewportToPixel(panBy(start, delta), moved, image)).toEqual(pixel)
  })

  it('is reversible', () => {
    const delta = { x: 0.1, y: 1234.567 }
    const back = panBy(panBy(start, delta), { x: -delta.x, y: -delta.y })
    expectPointClose(back.offset, start.offset)
  })
})

describe('resizeViewport', () => {
  const vp: ViewportState = { zoom: 0.75, offset: { x: -20.5, y: 33.25 } }
  const sizes: [Size, Size][] = [
    [{ width: 1000, height: 800 }, { width: 1400, height: 800 }],
    [{ width: 1000, height: 800 }, { width: 1000, height: 500 }],
    [{ width: 1000, height: 800 }, { width: 640, height: 1200 }],
    [{ width: 1000, height: 800 }, { width: 1001, height: 799 }],
  ]

  it('keeps the image point at the centre of the viewport', () => {
    for (const [previous, next] of sizes) {
      const before = viewportToImage(vp, centreOf(previous))
      const resized = resizeViewport(vp, previous, next)
      expect(resized.zoom).toBe(vp.zoom)
      expectPointClose(viewportToImage(resized, centreOf(next)), before)
    }
  })

  it('leaves the viewport unchanged when the size does not change', () => {
    const size = { width: 900, height: 700 }
    expect(resizeViewport(vp, size, size)).toEqual(vp)
  })

  it('keeps a centred image centred', () => {
    const image: Size = { width: 300, height: 200 }
    const previous: Size = { width: 1000, height: 800 }
    const next: Size = { width: 1700, height: 650 }
    const centred = fitViewport(image, previous)
    expect(resizeViewport(centred, previous, next)).toEqual(fitViewport(image, next))
  })
})
