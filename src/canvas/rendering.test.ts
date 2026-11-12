import { describe, expect, it } from 'vitest'
import { viewportToPixel } from './coordinates'
import { imageDrawBias, snapToDevicePixels } from './devicePixels'
import {
  CHECKER_SQUARE_CSS_PX,
  checkerSquareSize,
  intersect,
  planFrame,
  sameFramePlan,
  usesSmoothing,
  visibleSourceRect,
} from './rendering'

const VIEWPORT_SIZE = { width: 1000, height: 600 }

describe('planFrame', () => {
  it('sizes the backing store to the visible workspace, not the image', () => {
    const plan = planFrame({
      imageSize: { width: 16384, height: 3000 },
      viewport: { zoom: 32, offset: { x: -1000, y: -1000 } },
      viewportSize: VIEWPORT_SIZE,
      devicePixelRatio: 2,
    })
    expect(plan.backingStore).toEqual({ width: 2000, height: 1200 })
    // At 3200% only about 32 × 19 image pixels are visible, so only those are drawn.
    expect(plan.image?.source).toEqual({ x: 31, y: 31, width: 32, height: 19 })
  })

  it('draws the checkerboard only inside the image bounds', () => {
    const plan = planFrame({
      imageSize: { width: 400, height: 200 },
      viewport: { zoom: 1, offset: { x: 300, y: 200 } },
      viewportSize: VIEWPORT_SIZE,
      devicePixelRatio: 1,
    })
    expect(plan.checker).toEqual({
      rect: { x: 300, y: 200, width: 400, height: 200 },
      origin: { x: 300, y: 200 },
      squareSize: CHECKER_SQUARE_CSS_PX,
    })
    expect(plan.image).toEqual({
      // At a whole-number scale the image is drawn on its corner (imageDrawBias, devicePixels.ts).
      transform: { a: 1, b: 0, c: 0, d: 1, e: 300, f: 200 },
      source: { x: 0, y: 0, width: 400, height: 200 },
      smoothing: false,
    })
  })

  it('clips the checkerboard to the workspace when the image is partly outside it', () => {
    const plan = planFrame({
      imageSize: { width: 400, height: 200 },
      viewport: { zoom: 2, offset: { x: -100, y: 500 } },
      viewportSize: VIEWPORT_SIZE,
      devicePixelRatio: 1,
    })
    expect(plan.checker?.rect).toEqual({ x: 0, y: 500, width: 700, height: 100 })
    // The pattern stays anchored to the image's corner, even off-screen.
    expect(plan.checker?.origin).toEqual({ x: -100, y: 500 })
    expect(plan.image?.source).toEqual({ x: 50, y: 0, width: 350, height: 50 })
  })

  it('draws nothing when the image is entirely outside the workspace', () => {
    const plan = planFrame({
      imageSize: { width: 400, height: 200 },
      viewport: { zoom: 1, offset: { x: 1000, y: 0 } },
      viewportSize: VIEWPORT_SIZE,
      devicePixelRatio: 1,
    })
    expect(plan).toEqual({ backingStore: { width: 1000, height: 600 }, checker: null, image: null })
  })

  it('draws nothing in an empty workspace or for an empty image', () => {
    const viewport = { zoom: 1, offset: { x: 0, y: 0 } }
    expect(
      planFrame({ imageSize: { width: 10, height: 10 }, viewport, viewportSize: { width: 0, height: 0 }, devicePixelRatio: 1 }),
    ).toEqual({ backingStore: { width: 0, height: 0 }, checker: null, image: null })
    expect(
      planFrame({ imageSize: { width: 0, height: 0 }, viewport, viewportSize: VIEWPORT_SIZE, devicePixelRatio: 1 }).image,
    ).toBeNull()
  })

  it('scales to device pixels at fractional ratios', () => {
    const plan = planFrame({
      imageSize: { width: 400, height: 200 },
      viewport: { zoom: 0.5, offset: { x: 300.8, y: 200 } },
      viewportSize: { width: 1000.8, height: 600 },
      devicePixelRatio: 1.25,
    })
    expect(plan.backingStore).toEqual({ width: 1251, height: 750 })
    // Scale 0.625 = 5/8, an even denominator: drawn 1/16 device pixel past its corner.
    expect(plan.image?.transform).toEqual({ a: 0.625, b: 0, c: 0, d: 0.625, e: 376 + 1 / 16, f: 250 + 1 / 16 })
    expect(plan.checker?.rect).toEqual({ x: 376, y: 250, width: 250, height: 125 })
    expect(plan.checker?.squareSize).toBe(10)
    expect(plan.image?.smoothing).toBe(true)
  })

  it('keeps the checkerboard edge and the image edge in the same place', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2, 3]) {
      for (const zoom of [0.137, 0.5, 1, 1.5, 3]) {
        const viewport = snapToDevicePixels({ zoom, offset: { x: 123.45, y: 67.8 } }, devicePixelRatio)
        const plan = planFrame({
          imageSize: { width: 300, height: 200 },
          viewport,
          viewportSize: { width: 2000, height: 2000 },
          devicePixelRatio,
        })
        const { transform } = plan.image!
        const { rect, origin } = plan.checker!
        // Snapped offsets put the image corner on a whole device pixel; the image is drawn the
        // bias past it.
        expect(origin.x).toBe(rect.x)
        expect(origin.y).toBe(rect.y)
        expect(transform.e - imageDrawBias(transform.a)).toBeCloseTo(origin.x, 9)
        expect(transform.f - imageDrawBias(transform.a)).toBeCloseTo(origin.y, 9)
        // Whole device pixels only, so no edge pixel is partly covered.
        for (const value of [rect.x, rect.y, rect.width, rect.height]) expect(Number.isInteger(value)).toBe(true)
        // Exactly the device pixels whose centres lie inside the image as drawn.
        const inside = (device: number, start: number, size: number) => device + 0.5 > start && device + 0.5 < start + size
        expect(inside(rect.x, transform.e, 300 * transform.a)).toBe(true)
        expect(inside(rect.x + rect.width - 1, transform.e, 300 * transform.a)).toBe(true)
        expect(inside(rect.x + rect.width, transform.e, 300 * transform.a)).toBe(false)
        expect(inside(rect.y + rect.height - 1, transform.f, 200 * transform.d)).toBe(true)
        expect(inside(rect.y + rect.height, transform.f, 200 * transform.d)).toBe(false)
      }
    }
  })
})

describe('rendering helpers', () => {
  it('smooths only below 100%', () => {
    expect(usesSmoothing(0.99, 1)).toBe(true)
    expect(usesSmoothing(1, 1)).toBe(false)
    expect(usesSmoothing(32, 1)).toBe(false)
    // Exactly 100% where the ratio is off the display grid (Actual Size, Option D): smoothed.
    expect(usesSmoothing(1, 1.0099999904632568)).toBe(true)
    expect(usesSmoothing(1, 1.100000023841858)).toBe(false)
  })

  it('keeps checkerboard squares a constant on-screen size', () => {
    expect(checkerSquareSize(1)).toBe(8)
    expect(checkerSquareSize(1.25)).toBe(10)
    expect(checkerSquareSize(1.5)).toBe(12)
    expect(checkerSquareSize(0.01)).toBe(1)
  })

  it('finds the source pixels under the visible area, including partial pixels', () => {
    const viewport = { zoom: 4, offset: { x: -6, y: -2 } }
    // Viewport x 0..10 covers image x 1.5..4, so pixels 1..3 are drawn.
    expect(visibleSourceRect(viewport, { width: 100, height: 100 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x: 1,
      y: 0,
      width: 3,
      height: 3,
    })
  })

  it('draws every pixel that hit-testing can report as visible', () => {
    const viewport = snapToDevicePixels({ zoom: 2.5, offset: { x: -37.3, y: 11.1 } }, 1.5)
    const imageSize = { width: 64, height: 48 }
    const plan = planFrame({ imageSize, viewport, viewportSize: { width: 100, height: 80 }, devicePixelRatio: 1.5 })
    const source = plan.image!.source
    for (let y = 0; y < 80; y += 0.5) {
      for (let x = 0; x < 100; x += 0.5) {
        const pixel = viewportToPixel(viewport, { x, y }, imageSize)
        if (!pixel) continue
        expect(pixel.x).toBeGreaterThanOrEqual(source.x)
        expect(pixel.x).toBeLessThan(source.x + source.width)
        expect(pixel.y).toBeGreaterThanOrEqual(source.y)
        expect(pixel.y).toBeLessThan(source.y + source.height)
      }
    }
  })

  it('intersects rectangles', () => {
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    })
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBeNull()
  })
})

describe('sameFramePlan', () => {
  const plan = (zoom: number, x: number, y: number, devicePixelRatio = 1, viewportSize = VIEWPORT_SIZE) =>
    planFrame({ imageSize: { width: 400, height: 200 }, viewport: { zoom, offset: { x, y } }, viewportSize, devicePixelRatio })

  it('matches plans for the same view, however they were made', () => {
    expect(sameFramePlan(plan(0.5, 10, 20), plan(0.5, 10, 20))).toBe(true)
    expect(sameFramePlan(plan(2, -100, 3, 1.5), plan(2, -100, 3, 1.5))).toBe(true)
    // Nothing of the image in view, both times.
    expect(sameFramePlan(plan(1, 5000, 0), plan(1, 6000, 0))).toBe(true)
  })

  it('tells apart any change of view, size or scaling', () => {
    const base = plan(0.5, 10, 20)
    expect(sameFramePlan(base, plan(0.5, 11, 20))).toBe(false) // panned one pixel
    expect(sameFramePlan(base, plan(0.5, 10, 19))).toBe(false)
    expect(sameFramePlan(base, plan(0.51, 10, 20))).toBe(false) // zoomed
    expect(sameFramePlan(base, plan(0.5, 10, 20, 1.25))).toBe(false) // display scaling
    expect(sameFramePlan(base, plan(0.5, 10, 20, 1, { width: 1001, height: 600 }))).toBe(false) // workspace size
    expect(sameFramePlan(base, plan(1, 5000, 0))).toBe(false) // image out of view
    expect(sameFramePlan(plan(1, 5000, 0), base)).toBe(false)
  })

  it('tells apart smoothing, which changes at 100%', () => {
    const a = plan(1, 0, 0)
    const b = { ...a, image: { ...a.image!, smoothing: !a.image!.smoothing } }
    expect(sameFramePlan(a, b)).toBe(false)
  })
})
