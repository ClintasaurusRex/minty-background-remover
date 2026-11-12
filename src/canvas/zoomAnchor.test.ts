import { describe, expect, it } from 'vitest'
import { pixelUnderPointer } from './coordinates'
import { toDisplayViewport } from './devicePixels'
import { planFrame } from './rendering'
import { imagePointAtPointer, viewportDrawingAt } from './zoomAnchor'

/*
 * Zoom anchoring against the renderer's own transform (planFrame), the independent oracle: where
 * the image point is drawn, and which image pixel is drawn in the pointer's device pixel.
 */
const IMAGE = { width: 4000, height: 3000 }
const RATIOS = [1, 1.01, 1.1, 1.25, 1.5, 2, 2.25, 3]

function transformOf(viewport: { zoom: number; offset: { x: number; y: number } }, ratio: number) {
  return planFrame({ imageSize: IMAGE, viewport: toDisplayViewport(viewport, ratio), viewportSize: { width: 1200, height: 800 }, devicePixelRatio: ratio }).image!.transform
}

describe('imagePointAtPointer', () => {
  it('is the image point the renderer draws at the pointer', () => {
    for (const ratio of RATIOS) {
      for (const viewport of [{ zoom: 1, offset: { x: 10.3, y: -7.9 } }, { zoom: 3.7, offset: { x: -1234.5, y: -987.6 } }]) {
        const t = transformOf(viewport, ratio)
        const point = { x: 411.37, y: 233.91 }
        const image = imagePointAtPointer(toDisplayViewport(viewport, ratio), point, ratio)
        expect(t.a * image.x + t.e).toBeCloseTo(point.x * ratio, 9)
        expect(t.d * image.y + t.f).toBeCloseTo(point.y * ratio, 9)
      }
    }
  })
})

describe('viewportDrawingAt', () => {
  it('draws the point within a device pixel of the pointer, on whole device pixels, keeping its pixel when zooming in', () => {
    let kept = 0
    let checked = 0
    for (const ratio of RATIOS) {
      for (let i = 0; i < 400; i++) {
        // Deterministic spread of pointers, image points and zoom levels from 100% to 3200%.
        const point = { x: 100 + ((i * 97.31) % 1000), y: 50 + ((i * 61.77) % 700) }
        const image = { x: 1000 + ((i * 13.137) % 2000), y: 700 + ((i * 7.731) % 1500) }
        const zoom = 1 * Math.pow(32, ((i * 0.6180339) % 1))
        const viewport = viewportDrawingAt(image, point, zoom, ratio)
        expect(viewport.zoom).toBe(zoom)
        // Already on whole device pixels: the display viewport keeps the offset.
        expect(toDisplayViewport(viewport, ratio).offset.x).toBeCloseTo(viewport.offset.x, 9)
        const t = transformOf(viewport, ratio)
        expect(Math.abs(t.a * image.x + t.e - point.x * ratio)).toBeLessThanOrEqual(1 + 1e-9)
        expect(Math.abs(t.d * image.y + t.f - point.y * ratio)).toBeLessThanOrEqual(1 + 1e-9)
        // The pixel under the pointer (as drawn, and as the tools read it) is the point's pixel
        // whenever the exact placement would show it there.
        const D = Math.floor(point.x * ratio + 0.01)
        const exactShows = Math.floor(image.x + (D + 0.5 - point.x * ratio) / t.a) === Math.floor(image.x)
        const drawn = Math.floor((D + 0.5 - t.e) / t.a)
        const hit = pixelUnderPointer(toDisplayViewport(viewport, ratio), point, IMAGE, ratio)
        expect(hit?.x).toBe(drawn)
        if (exactShows) {
          expect(drawn).toBe(Math.floor(image.x))
          kept++
        }
        checked++
      }
    }
    expect(kept).toBeGreaterThan(checked / 2)
  })

  it('keeps an exact placement exactly, so returning to a gesture start returns to its transform', () => {
    for (const ratio of RATIOS) {
      const start = { zoom: 1, offset: { x: Math.round(37.3 * ratio) / ratio, y: Math.round(-12.6 * ratio) / ratio } }
      const point = { x: 517.29, y: 333.61 }
      const image = imagePointAtPointer(toDisplayViewport(start, ratio), point, ratio)
      const back = viewportDrawingAt(image, point, 1, ratio)
      expect(transformOf(back, ratio)).toEqual(transformOf(start, ratio))
    }
  })
})
