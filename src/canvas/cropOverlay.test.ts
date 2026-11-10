import { describe, expect, it } from 'vitest'
import type { Rectangle, ViewportState } from '../editor/types'
import { imageIndexAtDevicePixel } from './coordinates'
import {
  CROP_GRAB_DISTANCE,
  cropCursor,
  cropHandlePositions,
  cropLabelPosition,
  cropRectOnScreen,
  hitTestCrop,
} from './cropOverlay'
import { snapToDevicePixels } from './devicePixels'

/*
 * The crop rectangle on screen (Phase 4). The decisive property: at every zoom and device pixel
 * ratio, the overlay's edges fall exactly on the device pixels where the image canvas starts drawing
 * the first kept pixel (and stops drawing the last one), by the canvas's own rule
 * (imageIndexAtDevicePixel), so the darkened area never covers a kept pixel or leaves a removed one
 * uncovered.
 */

const ZOOMS = [0.1, 0.25, 1 / 3, 0.5, 2 / 3, 0.9183, 1, 1.5, 2, 2.5, 3, 4, 7.3, 8, 12, 32]
const RATIOS = [1, 1.25, 1.5, 2, 2.5, 3]

describe('cropRectOnScreen', () => {
  it('puts every edge where the canvas draws the pixel boundary, at every zoom and ratio', () => {
    let checked = 0
    for (const zoom of ZOOMS) {
      for (const ratio of RATIOS) {
        // The display viewport: its offset on a device pixel edge.
        const viewport = snapToDevicePixels({ zoom, offset: { x: 37.3, y: 11.9 } }, ratio)
        const scale = zoom * ratio
        // Only zooms where one device pixel shows at most one image pixel have a single boundary.
        if (scale < 1) continue
        for (const edge of [0, 1, 2, 3, 7, 10, 33, 99, 100]) {
          const r: Rectangle = { x: edge, y: edge, width: 1, height: 1 }
          const screen = cropRectOnScreen(r, viewport, ratio)
          const corner = Math.round(viewport.offset.x * ratio)
          // The overlay's left edge in whole device pixels from the image's corner.
          const device = Math.round(screen.x * ratio) - corner
          expect(Math.abs(screen.x * ratio - Math.round(screen.x * ratio))).toBeLessThan(1e-9)
          // The device pixel just inside shows the pixel at `edge`; the one just outside the pixel before.
          expect(imageIndexAtDevicePixel(device, scale)).toBe(edge)
          expect(imageIndexAtDevicePixel(device - 1, scale)).toBe(edge - 1)
          // And the right edge after one pixel: inside is `edge`, outside `edge + 1`.
          const right = Math.round((screen.x + screen.width) * ratio) - corner
          expect(imageIndexAtDevicePixel(right - 1, scale)).toBe(edge)
          expect(imageIndexAtDevicePixel(right, scale)).toBe(edge + 1)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
  })

  it('is the plain mapping at whole scales: offset + edge × zoom', () => {
    const viewport: ViewportState = { zoom: 4, offset: { x: 10, y: 20 } }
    expect(cropRectOnScreen({ x: 3, y: 5, width: 7, height: 2 }, viewport, 1)).toEqual({ x: 22, y: 40, width: 28, height: 8 })
    expect(cropRectOnScreen({ x: 3, y: 5, width: 7, height: 2 }, viewport, 2)).toEqual({ x: 22, y: 40, width: 28, height: 8 })
  })

  it('gives the same edge to adjacent rectangles, so they tile without gaps or overlaps', () => {
    const viewport = snapToDevicePixels({ zoom: 1.37, offset: { x: 5.2, y: 3.3 } }, 1.5)
    const a = cropRectOnScreen({ x: 0, y: 0, width: 13, height: 4 }, viewport, 1.5)
    const b = cropRectOnScreen({ x: 13, y: 0, width: 9, height: 4 }, viewport, 1.5)
    expect(a.x + a.width).toBe(b.x)
  })
})

describe('hitTestCrop', () => {
  const screen: Rectangle = { x: 100, y: 100, width: 200, height: 120 } // right 300, bottom 220

  it('grabs corners and edges from just outside and just inside', () => {
    expect(hitTestCrop(screen, { x: 100, y: 100 })).toEqual({ kind: 'handle', handle: 'nw' })
    expect(hitTestCrop(screen, { x: 95, y: 95 })).toEqual({ kind: 'handle', handle: 'nw' })
    expect(hitTestCrop(screen, { x: 305, y: 225 })).toEqual({ kind: 'handle', handle: 'se' })
    expect(hitTestCrop(screen, { x: 304, y: 96 })).toEqual({ kind: 'handle', handle: 'ne' })
    expect(hitTestCrop(screen, { x: 96, y: 222 })).toEqual({ kind: 'handle', handle: 'sw' })
    expect(hitTestCrop(screen, { x: 200, y: 94 })).toEqual({ kind: 'handle', handle: 'n' })
    expect(hitTestCrop(screen, { x: 200, y: 226 })).toEqual({ kind: 'handle', handle: 's' })
    expect(hitTestCrop(screen, { x: 93, y: 160 })).toEqual({ kind: 'handle', handle: 'w' })
    expect(hitTestCrop(screen, { x: 307, y: 160 })).toEqual({ kind: 'handle', handle: 'e' })
    expect(hitTestCrop(screen, { x: 106, y: 160 })).toEqual({ kind: 'handle', handle: 'w' })
  })

  it('moves from inside and starts a new rectangle from further outside', () => {
    expect(hitTestCrop(screen, { x: 200, y: 160 })).toEqual({ kind: 'inside' })
    expect(hitTestCrop(screen, { x: 100 + CROP_GRAB_DISTANCE + 1, y: 160 })).toEqual({ kind: 'inside' })
    expect(hitTestCrop(screen, { x: 100 - CROP_GRAB_DISTANCE - 1, y: 160 })).toEqual({ kind: 'outside' })
    expect(hitTestCrop(screen, { x: 200, y: 50 })).toEqual({ kind: 'outside' })
    expect(hitTestCrop(screen, { x: 90, y: 90 })).toEqual({ kind: 'outside' })
    expect(hitTestCrop(screen, { x: Number.NaN, y: 160 })).toEqual({ kind: 'outside' })
  })

  it('keeps the middle third of a small rectangle for moving, and resolves an edge to the nearer side', () => {
    const small: Rectangle = { x: 50, y: 50, width: 9, height: 9 }
    expect(hitTestCrop(small, { x: 54.5, y: 54.5 })).toEqual({ kind: 'inside' })
    expect(hitTestCrop(small, { x: 51, y: 54.5 })).toEqual({ kind: 'handle', handle: 'w' })
    expect(hitTestCrop(small, { x: 58, y: 54.5 })).toEqual({ kind: 'handle', handle: 'e' })
    // A rectangle 1 CSS px wide (a single pixel at 100%): grabbing near it resizes from the nearer side.
    const tiny: Rectangle = { x: 50, y: 50, width: 1, height: 30 }
    expect(hitTestCrop(tiny, { x: 49, y: 65 })).toEqual({ kind: 'handle', handle: 'w' })
    expect(hitTestCrop(tiny, { x: 52, y: 65 })).toEqual({ kind: 'handle', handle: 'e' })
  })
})

describe('cropCursor', () => {
  it('shows what a press would do', () => {
    expect(cropCursor({ kind: 'outside' })).toBe('crosshair')
    expect(cropCursor({ kind: 'inside' })).toBe('move')
    expect(cropCursor({ kind: 'handle', handle: 'ne' })).toBe('ne-resize')
    expect(cropCursor({ kind: 'handle', handle: 's' })).toBe('s-resize')
  })
})

describe('cropHandlePositions', () => {
  it('draws eight handles on corners and edge middles, and only the corners when an edge is short on screen', () => {
    const big = cropHandlePositions({ x: 0, y: 0, width: 100, height: 40 })
    expect(big.map((h) => h.handle).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
    expect(big.find((h) => h.handle === 'e')).toEqual({ handle: 'e', x: 100, y: 20 })
    const narrow = cropHandlePositions({ x: 0, y: 0, width: 10, height: 40 })
    expect(narrow.map((h) => h.handle).sort()).toEqual(['e', 'ne', 'nw', 'se', 'sw', 'w'])
    expect(cropHandlePositions({ x: 0, y: 0, width: 2, height: 2 })).toHaveLength(4)
  })
})

describe('cropLabelPosition', () => {
  const workspace = { width: 800, height: 600 }
  it('sits above the rectangle, or inside it at the top of the workspace, and starts inside the workspace', () => {
    expect(cropLabelPosition({ x: 100, y: 100, width: 50, height: 50 }, workspace, 22)).toEqual({ x: 100, y: 74 })
    expect(cropLabelPosition({ x: 100, y: 10, width: 50, height: 50 }, workspace, 22)).toEqual({ x: 100, y: 14 })
    expect(cropLabelPosition({ x: -40, y: -30, width: 500, height: 500 }, workspace, 22)).toEqual({ x: 0, y: 4 })
  })
})
