import { describe, expect, it } from 'vitest'
import {
  DOM_DELTA_LINE,
  DOM_DELTA_PAGE,
  DOM_DELTA_PIXEL,
  MAX_WHEEL_DELTA_PX,
  WHEEL_ZOOM_PER_100PX,
  wheelDeltaPixels,
  wheelZoomFactor,
} from './wheelZoom'

describe('wheelDeltaPixels', () => {
  it('normalises pixel, line and page deltas', () => {
    expect(wheelDeltaPixels(100, DOM_DELTA_PIXEL, 800)).toBe(100)
    expect(wheelDeltaPixels(3, DOM_DELTA_LINE, 800)).toBeCloseTo(100, 9)
    expect(wheelDeltaPixels(-1, DOM_DELTA_PAGE, 800)).toBe(-800)
  })

  it('treats unknown modes as pixels and ignores non-finite deltas', () => {
    expect(wheelDeltaPixels(10, 7, 800)).toBe(10)
    expect(wheelDeltaPixels(Number.NaN, DOM_DELTA_PIXEL, 800)).toBe(0)
    expect(wheelDeltaPixels(Number.POSITIVE_INFINITY, DOM_DELTA_LINE, 800)).toBe(0)
  })
})

describe('wheelZoomFactor', () => {
  it('zooms in when scrolling up and out when scrolling down', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(WHEEL_ZOOM_PER_100PX, 12)
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / WHEEL_ZOOM_PER_100PX, 12)
    expect(wheelZoomFactor(0)).toBe(1)
  })

  it('gives the same result for one large movement or several small ones', () => {
    const small = wheelZoomFactor(-10) ** 10
    expect(small).toBeCloseTo(wheelZoomFactor(-100), 12)
  })

  it('cancels out for equal movements up and down', () => {
    expect(wheelZoomFactor(-37) * wheelZoomFactor(37)).toBeCloseTo(1, 15)
  })

  it('limits the effect of a single huge event', () => {
    expect(wheelZoomFactor(-10_000)).toBe(wheelZoomFactor(-MAX_WHEEL_DELTA_PX))
    expect(wheelZoomFactor(10_000)).toBe(wheelZoomFactor(MAX_WHEEL_DELTA_PX))
  })
})
