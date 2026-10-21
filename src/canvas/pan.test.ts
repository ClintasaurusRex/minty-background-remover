import { describe, expect, it } from 'vitest'
import { PAN_KEEP_VISIBLE_PX, keepImageReachable, limitPan, panRange, wheelPanDelta } from './pan'
import { DOM_DELTA_LINE, DOM_DELTA_PAGE, DOM_DELTA_PIXEL, WHEEL_LINE_PX } from './wheelZoom'

const PAGE = { width: 1000, height: 600 }
const wheel = (deltaX: number, deltaY: number, deltaMode = DOM_DELTA_PIXEL, shiftKey = false) => ({
  deltaX,
  deltaY,
  deltaMode,
  shiftKey,
})

describe('wheelPanDelta', () => {
  it('moves the image up when scrolling down, and down when scrolling up', () => {
    expect(wheelPanDelta(wheel(0, 100), PAGE)).toEqual({ x: -0, y: -100 })
    expect(wheelPanDelta(wheel(0, -100), PAGE)).toEqual({ x: -0, y: 100 })
  })

  it('pans both axes for trackpad scrolling, including fractional deltas', () => {
    expect(wheelPanDelta(wheel(12.5, -3.25), PAGE)).toEqual({ x: -12.5, y: 3.25 })
  })

  it('pans horizontally with Shift, whichever axis the browser reports', () => {
    // Reported as vertical (e.g. Firefox on Linux)…
    expect(wheelPanDelta(wheel(0, 100, DOM_DELTA_PIXEL, true), PAGE)).toEqual({ x: -100, y: 0 })
    // …or already converted to horizontal (e.g. Chrome).
    expect(wheelPanDelta(wheel(100, 0, DOM_DELTA_PIXEL, true), PAGE)).toEqual({ x: -100, y: 0 })
    expect(wheelPanDelta(wheel(0, -100, DOM_DELTA_PIXEL, true), PAGE)).toEqual({ x: 100, y: 0 })
  })

  it('converts line and page deltas per axis', () => {
    expect(wheelPanDelta(wheel(0, 3, DOM_DELTA_LINE), PAGE).y).toBeCloseTo(-3 * WHEEL_LINE_PX, 9)
    expect(wheelPanDelta(wheel(1, 1, DOM_DELTA_PAGE), PAGE)).toEqual({ x: -1000, y: -600 })
    expect(wheelPanDelta(wheel(0, 1, DOM_DELTA_PAGE, true), PAGE)).toEqual({ x: -600, y: 0 })
  })

  it('ignores non-finite deltas', () => {
    expect(wheelPanDelta(wheel(Number.NaN, Number.POSITIVE_INFINITY), PAGE)).toEqual({ x: -0, y: -0 })
  })
})

describe('panRange', () => {
  it('keeps PAN_KEEP_VISIBLE_PX of a large image inside the workspace', () => {
    // 2000 px image at 100% in a 1000 px workspace.
    expect(panRange(2000, 1, 1000)).toEqual([PAN_KEEP_VISIBLE_PX - 2000, 1000 - PAN_KEEP_VISIBLE_PX])
  })

  it('scales with zoom', () => {
    expect(panRange(400, 4, 1000)).toEqual([64 - 1600, 936])
    expect(panRange(400, 0.25, 1000)).toEqual([64 - 100, 936])
  })

  it('keeps all of an image smaller than the margin', () => {
    // 10 px image at 300%: 30 px on screen, all of it must stay visible.
    expect(panRange(10, 3, 1000)).toEqual([0, 970])
    expect(panRange(400, 0.01, 1000)).toEqual([0, 996])
  })

  it('falls back to the centred position in a tiny workspace', () => {
    // A 20 px image must stay fully visible, but the workspace is only 10 px wide.
    const [low, high] = panRange(20, 1, 10)
    expect(low).toBe(high)
    expect(low).toBe((10 - 20) / 2)
  })
})

describe('limitPan', () => {
  const image = { width: 400, height: 200 }
  const viewport = { width: 1000, height: 600 }
  const at = (x: number, y: number, zoom = 1) => ({ zoom, offset: { x, y } })

  it('allows pans that keep enough of the image visible', () => {
    expect(limitPan(at(500, 300), at(300, 200), image, viewport)).toEqual(at(500, 300))
  })

  it('stops at the margin on each edge', () => {
    expect(limitPan(at(5000, 5000), at(300, 200), image, viewport)).toEqual(at(936, 536))
    expect(limitPan(at(-5000, -5000), at(300, 200), image, viewport)).toEqual(at(64 - 400, 64 - 200))
  })

  it('never pulls an image that is already further out back in with a jump', () => {
    // Already right of the limit (e.g. after zooming): may stay, may move back, may not go further.
    const outside = at(990, 200)
    expect(limitPan(at(995, 200), outside, image, viewport)).toEqual(outside)
    expect(limitPan(at(980, 200), outside, image, viewport)).toEqual(at(980, 200))
    expect(limitPan(at(990, 210), outside, image, viewport)).toEqual(at(990, 210))
  })

  it('applies the margin at high zoom', () => {
    // 400 px at 3200% is 12,800 px wide.
    const limited = limitPan(at(-20_000, 0, 32), at(0, 0, 32), image, viewport)
    expect(limited.offset.x).toBe(64 - 12_800)
    expect(limited.zoom).toBe(32)
  })
})

describe('keepImageReachable', () => {
  const image = { width: 400, height: 200 }
  const viewport = { width: 1000, height: 600 }

  it('leaves any viewport with part of the image visible untouched', () => {
    const edge = { zoom: 1, offset: { x: 999, y: -199 } }
    expect(keepImageReachable(edge, image, viewport)).toBe(edge)
  })

  it('brings a completely hidden image back to the margin', () => {
    expect(keepImageReachable({ zoom: 1, offset: { x: 1500, y: 100 } }, image, viewport)).toEqual({
      zoom: 1,
      offset: { x: 936, y: 100 },
    })
    expect(keepImageReachable({ zoom: 2, offset: { x: 100, y: -900 } }, image, viewport)).toEqual({
      zoom: 2,
      offset: { x: 100, y: 64 - 400 },
    })
  })
})
